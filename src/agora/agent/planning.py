"""Planning: daily broad-stroke plans, action selection, and reactive re-planning.

A daily plan is a list of ``(minute_of_day, description)`` steps. The current
action is the most recent step whose time has arrived; its description is
resolved to a target location the agent then paths toward. Crucially, planning
retrieves the agent's own relevant memories first -- so an invitation that
reached the agent through conversation can surface here and become a plan step
to attend. That is the mechanism behind emergent coordination.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

from ..config import Config
from ..util import hhmm, parse_event

Step = Tuple[int, str]

_PLAN_LINE = re.compile(r"(\d{1,2}):(\d{2})\s*[-–:]\s*(.+)")

# keyword -> default location when a step names no explicit place
_KEYWORD_LOC = [
    (("breakfast", "wake", "wake up", "get ready"), "home"),
    (("sleep", "wind down", "bed", "rest at home", "go home", "dinner"), "home"),
    (("lunch", "coffee", "cafe"), "Hobbs Cafe"),
    (("work", "job", "shift", "tasks"), "workplace"),
    (("errand", "shop", "groceries", "store"), "General Store"),
    (("read", "study", "research", "library"), "Public Library"),
    (("walk", "park", "garden", "yoga", "relax"), "The Park"),
    (("music", "plaza", "perform", "play"), "Town Plaza"),
    (("paint", "art", "studio"), "Art Studio"),
]


def parse_plan(text: str, day_start_min: int) -> List[Step]:
    steps: List[Step] = []
    for line in text.splitlines():
        m = _PLAN_LINE.search(line)
        if not m:
            continue
        h, mm, desc = int(m.group(1)), int(m.group(2)), m.group(3).strip()
        steps.append((h * 60 + mm, desc))
    steps.sort(key=lambda s: s[0])
    return steps


def make_daily_plan(agent, llm, world, cfg: Config) -> List[Step]:
    persona = agent.persona
    now_tick = world.clock.tick
    now_min = world.clock.minute_of_day
    query = (f"What should {persona.first_name} do today, given their goals, "
             f"routine, and any recent plans or invitations?")
    retrieved = agent.memory.retrieve(query, now_tick, top_k=cfg.retrieval.top_k)
    mem_texts = [s.memory.text for s in retrieved]
    known_locations = list(world.map.locations.keys())

    prompt = (
        f"You are {persona.name}, a {persona.occupation}. "
        f"Traits: {', '.join(persona.traits)}. Goals: {'; '.join(persona.goals)}.\n"
        f"Relevant memories:\n- " + "\n- ".join(mem_texts) + "\n\n"
        f"Write a believable plan for today as lines of 'HH:MM - action'. "
        f"Include any events you have been invited to."
    )
    meta = {
        "name": persona.name, "occupation": persona.occupation,
        "home": persona.home, "day": world.clock.day,
        "memories": mem_texts, "known_locations": known_locations,
        "now_min": now_min,
    }
    resp = llm.generate(prompt, purpose="daily_plan", meta=meta, max_tokens=400)
    plan = parse_plan(resp, cfg.day_start_min)
    if not plan:  # safety net so an agent is never planless
        plan = _fallback_plan(persona)
    agent.daily_plan = plan
    agent.plan_day = world.clock.day
    summary = "; ".join(d for _, d in plan)
    agent.memory.add(f"Made a plan for today: {summary}", kind="plan",
                     importance=3.0, tick=now_tick)
    return plan


def _fallback_plan(persona) -> List[Step]:
    return [
        (8 * 60, f"wake up at {persona.home}"),
        (9 * 60, f"go to work at {persona.workplace}"),
        (12 * 60, "have lunch at Hobbs Cafe"),
        (14 * 60, f"work at {persona.workplace}"),
        (18 * 60, "relax at The Park"),
        (22 * 60, f"sleep at {persona.home}"),
    ]


def current_step(agent, minute_of_day: int) -> Optional[Step]:
    if not agent.daily_plan:
        return None
    applicable = [s for s in agent.daily_plan if s[0] <= minute_of_day]
    return applicable[-1] if applicable else agent.daily_plan[0]


def resolve_target(agent, desc: str, world) -> str:
    """Map a plan-step description to a target location name."""
    low = desc.lower()
    for name in world.map.locations:
        if name.lower() in low:
            return name
    for keywords, target in _KEYWORD_LOC:
        if any(k in low for k in keywords):
            if target == "home":
                return agent.persona.home
            if target == "workplace":
                return agent.persona.workplace
            return target
    return agent.persona.workplace


def event_steps_from_memories(agent, world, cfg: Config) -> List[Step]:
    """Scan retrieved memories for upcoming events; return attendance steps.

    Used to fold newly-learned events into the current plan without waiting for
    the next day's planning pass (reactive re-planning).
    """
    now_tick = world.clock.tick
    now_min = world.clock.minute_of_day
    known = list(world.map.locations.keys())
    retrieved = agent.memory.retrieve("upcoming party event invitation gathering",
                                      now_tick, top_k=cfg.retrieval.top_k)
    steps: List[Step] = []
    for s in retrieved:
        ev = parse_event(s.memory.text, known)
        if ev and ev["time_min"] > now_min:
            steps.append((ev["time_min"],
                          f"go to {ev['location']} at {hhmm(ev['time_min'])} for the event"))
    return steps

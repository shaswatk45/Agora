"""The Agent: perceive -> retrieve -> plan -> act, closing the loop.

An agent owns a persona and a memory stream and a position in the world. Each
tick it perceives its surroundings (creating observation memories), decides its
current action from its daily plan (which may fold in newly learned events), and
takes one step toward the target location. Reflection and daily planning are
driven by the simulation engine at the right cadence.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..embed import Embedder
from .memory import MemoryStream
from .persona import Persona
from . import planning, reflection

Pos = Tuple[int, int]

# tiles an agent can walk in a single tick (one tile per ~2 sim-minutes)
STEP_TILES = 5

_PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0",
    "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324",
    "#800000", "#aaffc3", "#808000",
]


class Agent:
    def __init__(self, persona: Persona, pos: Pos, embedder: Embedder,
                 cfg: Config, color: str):
        self.persona = persona
        self.pos = pos
        self.cfg = cfg
        self.color = color
        self.memory = MemoryStream(persona.name, embedder, cfg.retrieval,
                                   cfg.minutes_per_tick)
        self.daily_plan: List[Tuple[int, str]] = []
        self.plan_day: int = -1
        self.current_action: str = "waking up"
        self.current_target: str = persona.home
        self.current_thought: str = ""
        self.last_reflection_tick: int = 0
        self.last_talked: Dict[str, int] = {}
        self.met: set = set()
        self._last_location: Optional[str] = None
        self._events_scheduled: set = set()   # event times already folded into the plan
        self.roster_first: List[str] = []     # first names of all townsfolk (set by engine)

    @property
    def id(self) -> str:
        return self.persona.name

    # -- importance --------------------------------------------------------
    def score_importance(self, text: str, llm) -> float:
        resp = llm.generate(
            "On a scale of 1 to 10, rate how poignant/important this memory is "
            "(1 = mundane, 10 = life-changing). Respond with only a number.\n"
            f"Memory: {text}",
            purpose="importance", meta={"text": text}, max_tokens=8,
            temperature=0.0)
        m = re.search(r"\d+", resp)
        return float(max(1, min(10, int(m.group()) if m else 3)))

    # -- perception --------------------------------------------------------
    def perceive(self, world, others: List["Agent"]) -> List[str]:
        """Observe the current location and nearby agents; store observations."""
        tick = world.clock.tick
        obs: List[str] = []
        loc = world.location_at(self.pos)

        if loc and loc != self._last_location:
            location = world.map.locations[loc]
            objs = ", ".join(location.objects[:2]) if location.objects else "the place"
            text = f"{self.persona.first_name} arrived at {loc} and noticed {objs}."
            self.memory.add(text, kind="observation", importance=2.0, tick=tick)
            obs.append(text)
            self._last_location = loc

        for other in others:
            if other is self:
                continue
            if _chebyshev(self.pos, other.pos) <= 1:
                first = other.id not in self.met
                self.met.add(other.id)
                imp = 4.0 if first else 2.5
                where = loc or "town"
                text = (f"{self.persona.first_name} saw "
                        f"{other.persona.first_name} at {where}.")
                self.memory.add(text, kind="observation", importance=imp, tick=tick)
                obs.append(text)
        return obs

    # -- planning / action -------------------------------------------------
    def ensure_plan(self, llm, world) -> None:
        if self.plan_day != world.clock.day or not self.daily_plan:
            planning.make_daily_plan(self, llm, world, self.cfg)

    def integrate_events(self, world) -> bool:
        """Fold newly-learned upcoming events into today's plan (re-planning).

        An event dominates its own window: mundane steps that fall inside
        ``[lead, end)`` are dropped so the agent stays at the gathering, and a
        "go home after" step is appended so it eventually leaves.
        """
        added = False
        now = world.clock.minute_of_day
        for etime, desc in planning.event_steps_from_memories(self, world, self.cfg):
            if etime in self._events_scheduled:
                continue
            self._events_scheduled.add(etime)
            end = etime + 120
            lead = max(now + 1, etime - 40)   # start heading over in time to arrive
            if lead >= end:
                continue
            self.daily_plan = [(t, d) for (t, d) in self.daily_plan
                               if not (lead <= t < end)]
            self.daily_plan.append((lead, desc))
            self.daily_plan.append((end, f"head home to {self.persona.home} after the event"))
            self.daily_plan.sort(key=lambda s: s[0])
            added = True
        return added

    def decide_action(self, world) -> None:
        step = planning.current_step(self, world.clock.minute_of_day)
        if step is None:
            self.current_action = "idling"
            self.current_target = self.persona.home
            return
        _, desc = step
        self.current_action = desc
        self.current_target = planning.resolve_target(self, desc, world)
        self.current_thought = desc

    def act(self, world) -> None:
        target_pos = world.anchor_of(self.current_target)
        path = world.path(self.pos, target_pos)
        if path:
            self.pos = path[min(STEP_TILES, len(path)) - 1]

    # -- reflection --------------------------------------------------------
    def maybe_reflect(self, llm, world) -> List[str]:
        if reflection.should_reflect(self, self.cfg):
            return reflection.reflect(self, llm, world, self.cfg)
        return []

    # -- conversation bookkeeping ------------------------------------------
    def note_conversation(self, other: "Agent", tick: int) -> None:
        self.last_talked[other.id] = tick

    def can_talk_with(self, other: "Agent", tick: int, cooldown_ticks: int) -> bool:
        last = self.last_talked.get(other.id, -10 ** 9)
        return tick - last >= cooldown_ticks

    # -- serialisation for the UI -----------------------------------------
    def snapshot(self, world) -> Dict:
        return {
            "id": self.id,
            "name": self.persona.first_name,
            "full_name": self.persona.name,
            "pos": list(self.pos),
            "color": self.color,
            "action": self.current_action,
            "location": world.location_at(self.pos),
            "occupation": self.persona.occupation,
        }

    def inspect(self, world) -> Dict:
        recent = list(reversed(self.memory.recent(8)))
        # show what the agent would retrieve for its current action -- the
        # "why did it do this" explainability payoff.
        query = self.current_action or "what is happening now"
        retrieved = self.memory.retrieve(query, world.clock.tick, top_k=6, touch=False)
        reflections = [m.to_dict() for m in self.memory.all() if m.kind == "reflection"]
        return {
            "persona": self.persona.to_dict(),
            "color": self.color,
            "pos": list(self.pos),
            "location": world.location_at(self.pos),
            "current_action": self.current_action,
            "current_thought": self.current_thought,
            "plan": [{"time": _hhmm(t), "desc": d} for t, d in self.daily_plan],
            "top_retrieved": [s.to_dict() for s in retrieved],
            "recent_memories": [m.to_dict() for m in recent],
            "reflections": reflections[-6:],
            "memory_count": len(self.memory),
            "relationships": self.persona.relationships,
        }


def _chebyshev(a: Pos, b: Pos) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def _hhmm(minute_of_day: int) -> str:
    return f"{minute_of_day // 60:02d}:{minute_of_day % 60:02d}"


def build_agents(personas, world, embedder, cfg: Config) -> List[Agent]:
    agents = []
    for i, p in enumerate(personas):
        home_anchor = world.anchor_of(p.home)
        agents.append(Agent(p, home_anchor, embedder, cfg, _PALETTE[i % len(_PALETTE)]))
    return agents

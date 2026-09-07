"""The simulation engine: ties world + agents + LLM into a stepping loop.

Each ``step()`` advances one tick and runs the full cognitive cycle for every
agent, then resolves conversations between co-located agents, folds in any newly
learned events, and periodically triggers reflection. It records a compact frame
per tick so the UI can scrub back through time, and keeps a rolling event log.
"""
from __future__ import annotations

import random
from collections import deque
from typing import Dict, List, Optional, Tuple

from ..config import Config
from ..embed import build_embedder
from ..llm import build_llm
from ..world import World
from ..agent import SEED_PERSONAS, build_agents, dialogue
from . import metrics

CONVO_COOLDOWN_TICKS = 6           # ~1 sim-hour between talks with the same person
MAX_CONVOS_PER_TICK = 5            # cap dialogue LLM calls per tick
MAX_FRAMES = 4000


class Engine:
    def __init__(self, cfg: Optional[Config] = None):
        self.cfg = cfg or Config()
        self.rng = random.Random(self.cfg.seed)
        self.embedder = build_embedder(
            self.cfg.embed.backend, self.cfg.embed.st_model, self.cfg.embed.hashing_dim)
        self.llm = build_llm(self.cfg.llm)
        self.world = World(self.cfg)
        assert self.world.connectivity_ok(), "town map is not fully connected"
        self.agents = build_agents(SEED_PERSONAS, self.world, self.embedder, self.cfg)
        roster = [a.persona.first_name for a in self.agents]
        for a in self.agents:
            a.roster_first = roster
        self.agents_by_id = {a.id: a for a in self.agents}

        self.events: deque = deque(maxlen=400)
        self.frames: List[Dict] = []
        self.diffusion_series: List[Dict] = []
        self.party: Optional[Dict] = None
        self.party_seeded_tick: Optional[int] = None
        self._seed_memories()

    # -- seeding -----------------------------------------------------------
    def _seed_memories(self) -> None:
        """Give each agent starting memories so day-1 behaviour is grounded."""
        for ag in self.agents:
            p = ag.persona
            ag.memory.add(p.summary(), kind="reflection", importance=6.0, tick=0)
            for goal in p.goals:
                ag.memory.add(f"{p.first_name} wants to {goal}.",
                              kind="reflection", importance=6.0, tick=0)
            for name, rel in p.relationships.items():
                ag.memory.add(f"{name} is {p.first_name}'s {rel}.",
                              kind="observation", importance=5.0, tick=0)
            # reset the reflection accumulator so seeds don't trigger it instantly
            ag.memory.importance_since_reflection = 0.0

    def seed_party(self, host_name: str = "Isabella Rodriguez",
                   location: str = "Hobbs Cafe", time_min: int = 17 * 60) -> Dict:
        host = self.agents_by_id.get(host_name) or self.agents[0]
        hh = f"{time_min // 60:02d}:{time_min % 60:02d}"
        text = (f"{host.persona.first_name} is planning a Valentine's Day party at "
                f"{location} today at {hh}, and wants to invite everyone in town.")
        tick = self.world.clock.tick
        host.memory.add(text, kind="plan", importance=9.0, tick=tick)
        host.memory.add(f"{host.persona.first_name} should tell everyone she meets "
                        f"about the party at {location}.", kind="plan",
                        importance=8.0, tick=tick)
        self.party = {"host": host_name, "location": location, "time_min": time_min,
                      "text": text}
        self.party_seeded_tick = tick
        self._log("party_seed", f"{host.persona.first_name} decided to throw a "
                  f"Valentine's party at {location} at {hh}.")
        return self.party

    # -- main loop ---------------------------------------------------------
    def step(self) -> Dict:
        world = self.world
        tick = world.clock.tick

        for ag in self.agents:
            ag.ensure_plan(self.llm, world)
            ag.decide_action(world)
            ag.act(world)

        for ag in self.agents:
            ag.perceive(world, self.agents)

        self._resolve_conversations()

        for ag in self.agents:
            for insight in ag.maybe_reflect(self.llm, world):
                self._log("reflection", f"{ag.persona.first_name}: {insight}")

        world.clock.advance()
        frame = self._record_frame()
        return frame

    def _resolve_conversations(self) -> None:
        world = self.world
        tick = world.clock.tick
        busy = set()
        convos = 0
        # deterministic-ish pairing: sort pairs by proximity
        pairs: List[Tuple] = []
        for i, a in enumerate(self.agents):
            for b in self.agents[i + 1:]:
                if max(abs(a.pos[0] - b.pos[0]), abs(a.pos[1] - b.pos[1])) <= 1:
                    pairs.append((a, b))
        self.rng.shuffle(pairs)
        for a, b in pairs:
            if convos >= MAX_CONVOS_PER_TICK:
                break
            if a.id in busy or b.id in busy:
                continue
            if not (a.can_talk_with(b, tick, CONVO_COOLDOWN_TICKS)
                    and b.can_talk_with(a, tick, CONVO_COOLDOWN_TICKS)):
                continue
            record = dialogue.converse(a, b, self.llm, world, self.cfg)
            busy.add(a.id)
            busy.add(b.id)
            convos += 1
            # reactive re-planning: attend anything just learned
            a.integrate_events(world)
            b.integrate_events(world)
            desc = record.get("summary", "")
            self._log("dialogue", f"{a.persona.first_name} & {b.persona.first_name}: {desc}",
                      highlight=record.get("learned_event", False))

    # -- recording ---------------------------------------------------------
    def _record_frame(self) -> Dict:
        world = self.world
        known = list(world.map.locations.keys())
        knowers = metrics.party_knowers(self.agents, self.party, known)
        at_party = []
        if self.party:
            present = set(metrics.attendance(self.agents, world, self.party["location"]))
            knower_set = set(knowers)
            # the emergent gathering = agents who *learned* of the party and showed up
            at_party = [i for i in present if i in knower_set]
        frame = {
            "tick": world.clock.tick,
            "clock": world.clock.to_dict(),
            "agents": [a.snapshot(world) for a in self.agents],
            "party": self.party,
            "knowers": knowers,
            "n_knowers": len(knowers),
            "at_party": at_party if self.party else [],
        }
        self.frames.append(frame)
        if len(self.frames) > MAX_FRAMES:
            self.frames = self.frames[-MAX_FRAMES:]
        self.diffusion_series.append({"tick": world.clock.tick,
                                      "day": world.clock.day,
                                      "hhmm": world.clock.hhmm,
                                      "knowers": len(knowers),
                                      "at_party": len(at_party)})
        return frame

    def _log(self, kind: str, text: str, highlight: bool = False) -> None:
        self.events.append({
            "tick": self.world.clock.tick,
            "hhmm": self.world.clock.hhmm,
            "day": self.world.clock.day,
            "kind": kind, "text": text, "highlight": highlight,
        })

    # -- views -------------------------------------------------------------
    def snapshot(self) -> Dict:
        frame = self.frames[-1] if self.frames else self._empty_frame()
        return {
            "clock": self.world.clock.to_dict(),
            "agents": frame["agents"],
            "party": self.party,
            "n_knowers": frame.get("n_knowers", 0),
            "at_party": frame.get("at_party", []),
            "events": list(self.events)[-30:],
            "metrics": self.metrics_summary(),
        }

    def _empty_frame(self) -> Dict:
        return {"agents": [a.snapshot(self.world) for a in self.agents],
                "n_knowers": 0, "at_party": []}

    def frame_at(self, index: int) -> Optional[Dict]:
        if 0 <= index < len(self.frames):
            return self.frames[index]
        return None

    def inspect(self, agent_id: str) -> Optional[Dict]:
        ag = self.agents_by_id.get(agent_id)
        return ag.inspect(self.world) if ag else None

    def metrics_summary(self) -> Dict:
        days = max(self.world.clock.total_minutes / (24 * 60), 1e-6)
        cost = metrics.cost_summary(self.llm, days)
        knowers = self.diffusion_series[-1]["knowers"] if self.diffusion_series else 0
        return {
            "cost": cost,
            "diffusion": {
                "knowers": knowers,
                "total_agents": len(self.agents),
                "seeded": self.party is not None,
                "series": self.diffusion_series[-200:],
            },
            "world": {"tick": self.world.clock.tick, "day": self.world.clock.day,
                      "embedder": self.embedder.name},
        }

    def static_world(self) -> Dict:
        return self.world.map.to_dict()

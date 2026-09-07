"""The World: the town map plus a simulated clock and spatial queries.

The clock advances in ticks (``minutes_per_tick`` simulated minutes each).
Pathfinding is breadth-first over walkable tiles; agents step one tile per tick
toward their target.
"""
from __future__ import annotations

from collections import deque
from typing import Dict, List, Optional, Tuple

from ..config import Config
from .maps import TownMap

Pos = Tuple[int, int]


class Clock:
    def __init__(self, minutes_per_tick: int, day_start_min: int):
        self.minutes_per_tick = minutes_per_tick
        self.day_start_min = day_start_min
        self.tick = 0

    @property
    def total_minutes(self) -> int:
        return self.day_start_min + self.tick * self.minutes_per_tick

    @property
    def day(self) -> int:
        return self.total_minutes // (24 * 60)

    @property
    def minute_of_day(self) -> int:
        return self.total_minutes % (24 * 60)

    @property
    def hhmm(self) -> str:
        m = self.minute_of_day
        return f"{m // 60:02d}:{m % 60:02d}"

    def advance(self) -> None:
        self.tick += 1

    def to_dict(self) -> Dict:
        return {"tick": self.tick, "day": self.day, "minute_of_day": self.minute_of_day,
                "hhmm": self.hhmm}


class World:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.map = TownMap()
        self.clock = Clock(cfg.minutes_per_tick, cfg.day_start_min)

    # -- pathfinding -------------------------------------------------------
    def neighbors(self, pos: Pos) -> List[Pos]:
        x, y = pos
        out = []
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if self.map.is_walkable(n):
                out.append(n)
        return out

    def path(self, start: Pos, goal: Pos) -> List[Pos]:
        """BFS shortest path (excluding start), empty if unreachable."""
        if start == goal:
            return []
        # if the goal tile is blocked (a building interior), aim for its anchor
        if not self.map.is_walkable(goal):
            return []
        frontier = deque([start])
        came: Dict[Pos, Optional[Pos]] = {start: None}
        while frontier:
            cur = frontier.popleft()
            if cur == goal:
                break
            for n in self.neighbors(cur):
                if n not in came:
                    came[n] = cur
                    frontier.append(n)
        if goal not in came:
            return []
        # reconstruct
        path: List[Pos] = []
        node: Optional[Pos] = goal
        while node is not None and node != start:
            path.append(node)
            node = came[node]
        path.reverse()
        return path

    def step_toward(self, pos: Pos, goal: Pos) -> Pos:
        """Return the next tile from ``pos`` toward ``goal`` (one step)."""
        path = self.path(pos, goal)
        return path[0] if path else pos

    # -- spatial queries ---------------------------------------------------
    def location_at(self, pos: Pos) -> Optional[str]:
        return self.map.location_at(pos)

    def anchor_of(self, name: str) -> Pos:
        return self.map.anchor_of(name)

    def connectivity_ok(self) -> bool:
        """Sanity check: every location anchor is reachable from every other."""
        anchors = [loc.anchor for loc in self.map.locations.values()]
        start = anchors[0]
        reachable = {start}
        frontier = deque([start])
        while frontier:
            cur = frontier.popleft()
            for n in self.neighbors(cur):
                if n not in reachable:
                    reachable.add(n)
                    frontier.append(n)
        return all(a in reachable for a in anchors)

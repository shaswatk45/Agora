"""The town map: a grid of walkable tiles with labelled locations and objects.

Buildings are blocking rectangles with a "door" anchor on the street; the Park
and Town Plaza are open (walkable) areas. Location names match the ``home`` and
``workplace`` fields on the personas so agents can path to where they live and
work.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

GRID_W = 40
GRID_H = 30


@dataclass
class Location:
    name: str
    x: int
    y: int
    w: int
    h: int
    kind: str                    # cafe | civic | shop | study | home | park | plaza
    color: str
    blocking: bool = True
    objects: List[str] = field(default_factory=list)

    @property
    def anchor(self) -> Tuple[int, int]:
        """The tile agents stand on when 'at' this location."""
        if self.blocking:
            # a door on the south edge, on the street
            return (self.x + self.w // 2, self.y + self.h)
        return (self.x + self.w // 2, self.y + self.h // 2)

    def contains(self, pos: Tuple[int, int]) -> bool:
        px, py = pos
        return self.x <= px < self.x + self.w and self.y <= py < self.y + self.h

    def to_dict(self) -> Dict:
        return {
            "name": self.name, "x": self.x, "y": self.y, "w": self.w,
            "h": self.h, "kind": self.kind, "color": self.color,
            "blocking": self.blocking, "objects": self.objects,
            "anchor": list(self.anchor),
        }


_SPEC = [
    # top band -- civic / study / shops
    dict(name="Public Library", x=3, y=2, w=6, h=4, kind="study", color="#6b8fb5",
         objects=["reading desks", "research stacks", "quiet corner"]),
    dict(name="Willow School", x=12, y=2, w=6, h=4, kind="civic", color="#c98b52",
         objects=["classroom", "chalkboard", "art supplies"]),
    dict(name="Art Studio", x=21, y=2, w=6, h=4, kind="study", color="#b57eb5",
         objects=["easels", "half-finished paintings", "clay wheel"]),
    dict(name="General Store", x=30, y=2, w=6, h=4, kind="shop", color="#5aa06e",
         objects=["shelves of goods", "cash register", "fresh produce"]),
    # middle band -- cafe + open spaces
    dict(name="Hobbs Cafe", x=6, y=11, w=7, h=4, kind="cafe", color="#d98b5f",
         objects=["espresso machine", "pastry counter", "cozy tables", "corner table"]),
    dict(name="Town Plaza", x=16, y=11, w=8, h=5, kind="plaza", color="#c9c19b",
         blocking=False, objects=["fountain", "benches", "street stage"]),
    dict(name="The Park", x=27, y=11, w=9, h=6, kind="park", color="#7fb069",
         blocking=False, objects=["oak tree", "flower beds", "yoga lawn", "pond"]),
    # bottom band -- homes
    dict(name="Rose Cottage", x=2, y=21, w=4, h=4, kind="home", color="#a56a8a",
         objects=["kitchen", "sofa", "bookshelf"]),
    dict(name="Cedar House", x=8, y=21, w=4, h=4, kind="home", color="#8a6a56",
         objects=["shared kitchen", "study desks", "couch"]),
    dict(name="Oak House", x=14, y=21, w=4, h=4, kind="home", color="#6a7a56",
         objects=["family table", "fireplace", "garden tools"]),
    dict(name="Birch House", x=20, y=21, w=4, h=4, kind="home", color="#56767a",
         objects=["record player", "yoga mats", "kitchen"]),
    dict(name="Willow Flat", x=26, y=21, w=4, h=4, kind="home", color="#7a5676",
         objects=["bookstacks", "small kitchen", "balcony"]),
    dict(name="Maple Flat", x=32, y=21, w=4, h=4, kind="home", color="#566a7a",
         objects=["dual monitors", "art prints", "coffee maker"]),
]


class TownMap:
    def __init__(self):
        self.w = GRID_W
        self.h = GRID_H
        self.locations: Dict[str, Location] = {}
        self._blocked = set()
        for s in _SPEC:
            loc = Location(**s)
            self.locations[loc.name] = loc
            if loc.blocking:
                for gx in range(loc.x, loc.x + loc.w):
                    for gy in range(loc.y, loc.y + loc.h):
                        self._blocked.add((gx, gy))

    def in_bounds(self, pos: Tuple[int, int]) -> bool:
        x, y = pos
        return 0 <= x < self.w and 0 <= y < self.h

    def is_walkable(self, pos: Tuple[int, int]) -> bool:
        return self.in_bounds(pos) and pos not in self._blocked

    def anchor_of(self, name: str) -> Tuple[int, int]:
        return self.locations[name].anchor

    def location_at(self, pos: Tuple[int, int]) -> Optional[str]:
        """Which location an agent standing at ``pos`` is considered to be in."""
        best = None
        best_d = 2  # must be at the anchor or one step away
        for loc in self.locations.values():
            if loc.contains(pos):
                return loc.name
            ax, ay = loc.anchor
            d = abs(ax - pos[0]) + abs(ay - pos[1])
            if d < best_d:
                best, best_d = loc.name, d
        return best

    def to_dict(self) -> Dict:
        return {
            "w": self.w, "h": self.h,
            "locations": [loc.to_dict() for loc in self.locations.values()],
        }

"""Tests for the world (map, pathfinding) and event parsing."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from agora.config import Config
from agora.world import World
from agora.util import parse_event, parse_time_to_minute


def test_map_is_fully_connected():
    assert World(Config()).connectivity_ok()


def test_paths_reach_every_location():
    w = World(Config())
    start = w.anchor_of("Rose Cottage")
    for name in w.map.locations:
        goal = w.anchor_of(name)
        if goal != start:
            assert w.path(start, goal), f"no path to {name}"


def test_location_at_anchor():
    w = World(Config())
    assert w.location_at(w.anchor_of("Hobbs Cafe")) == "Hobbs Cafe"


def test_parse_time():
    assert parse_time_to_minute("meet at 5pm") == 17 * 60
    assert parse_time_to_minute("at 17:00") == 17 * 60
    assert parse_time_to_minute("no time here") is None


def test_parse_event_picks_location_next_to_event():
    locs = ["Art Studio", "Hobbs Cafe", "The Park"]
    text = "There is a party at Hobbs Cafe at 5pm; earlier I was at the Art Studio."
    ev = parse_event(text, locs)
    assert ev["location"] == "Hobbs Cafe"      # not the stray Art Studio mention
    assert ev["time_min"] == 17 * 60


def test_parse_event_requires_event_word():
    assert parse_event("I went to Hobbs Cafe at 5pm", ["Hobbs Cafe"]) is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)

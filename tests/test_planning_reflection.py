"""Tests for planning, reflection, and end-to-end emergence."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from agora.config import Config
from agora.agent import planning
from agora.sim import Engine
from agora.scenarios import run_party_scenario


def _engine():
    cfg = Config()
    cfg.llm.cache_path = ""       # no cache during tests
    return Engine(cfg)


def test_parse_plan():
    steps = planning.parse_plan("08:00 - wake up\n09:00 - go to work", 480)
    assert steps == [(480, "wake up"), (540, "go to work")]


def test_current_step_selects_latest_past():
    class A:
        daily_plan = [(480, "wake"), (540, "work"), (720, "lunch")]
    assert planning.current_step(A(), 600)[1] == "work"
    assert planning.current_step(A(), 1000)[1] == "lunch"


def test_resolve_target_uses_named_location():
    eng = _engine()
    ag = eng.agents[0]
    assert planning.resolve_target(ag, "have lunch at Hobbs Cafe", eng.world) == "Hobbs Cafe"
    assert planning.resolve_target(ag, "go to work", eng.world) == ag.persona.workplace


def test_reflection_creates_reflection_memories():
    eng = _engine()
    ag = eng.agents[0]
    # force the trigger and reflect
    for i in range(30):
        ag.memory.add(f"had an intense experience number {i}", "observation",
                      importance=8, tick=i)
    before = sum(1 for m in ag.memory.all() if m.kind == "reflection")
    ag.maybe_reflect(eng.llm, eng.world)
    after = sum(1 for m in ag.memory.all() if m.kind == "reflection")
    assert after > before


def test_party_emergence():
    """The signature result: seed one agent, most of the town learns of it."""
    r = run_party_scenario()
    assert r["peak_knowers"] >= r["n_agents"] // 2       # majority learned
    assert r["peak_attendance"] >= 3                     # a real gathering formed


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)

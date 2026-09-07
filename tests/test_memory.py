"""Tests for the memory stream and the retrieval scoring function."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src"))

from agora.config import RetrievalConfig
from agora.embed import HashingEmbedder
from agora.agent.memory import MemoryStream


def _stream(**overrides):
    cfg = RetrievalConfig(**overrides)
    return MemoryStream("A", HashingEmbedder(128), cfg, minutes_per_tick=10)


def test_relevance_ranks_matching_memory_first():
    s = _stream(w_recency=0.0, w_importance=0.0, w_relevance=1.0)
    s.add("I love painting landscapes at the studio", "observation", 5, tick=0)
    s.add("The weather is cold and rainy today", "observation", 5, tick=0)
    top = s.retrieve("painting art studio", now_tick=1)
    assert "painting" in top[0].memory.text.lower()


def test_importance_weight_promotes_important_memory():
    s = _stream(w_recency=0.0, w_importance=1.0, w_relevance=0.0)
    s.add("mundane note", "observation", 1, tick=0)
    s.add("life-changing news", "observation", 10, tick=0)
    top = s.retrieve("anything", now_tick=1)
    assert top[0].memory.importance == 10


def test_recency_decay_prefers_recent():
    s = _stream(w_recency=1.0, w_importance=0.0, w_relevance=0.0)
    old = s.add("old memory", "observation", 5, tick=0)
    new = s.add("new memory", "observation", 5, tick=0)
    # age the old memory by moving its last access far into the past
    old.last_access_tick = -500
    top = s.retrieve("x", now_tick=10, touch=False)
    assert top[0].memory is new


def test_ablating_relevance_changes_ranking():
    """Zeroing the relevance weight should demote the topically-matching memory."""
    base = _stream(w_recency=0.0, w_importance=1.0, w_relevance=1.0)
    base.add("party at the cafe tonight", "observation", 2, tick=0)
    base.add("boring unrelated chore", "observation", 9, tick=0)
    with_rel = base.retrieve("party cafe", now_tick=1, touch=False)[0].memory.text

    ablate = _stream(w_recency=0.0, w_importance=1.0, w_relevance=0.0)
    ablate.add("party at the cafe tonight", "observation", 2, tick=0)
    ablate.add("boring unrelated chore", "observation", 9, tick=0)
    without_rel = ablate.retrieve("party cafe", now_tick=1, touch=False)[0].memory.text

    assert "party" in with_rel.lower()
    assert without_rel != with_rel  # importance-only ranking differs


def test_retrieve_updates_last_access():
    s = _stream()
    m = s.add("something", "observation", 5, tick=0)
    s.retrieve("something", now_tick=42)
    assert m.last_access_tick == 42


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)

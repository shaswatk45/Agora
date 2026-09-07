"""The memory stream and its retrieval function -- the technical heart of Agora.

Every experience an agent has becomes a :class:`Memory` with a timestamp, an
importance (poignancy) score, and an embedding. Retrieval ranks candidate
memories by a weighted, per-query-normalised combination of:

    recency    -- exponential decay since the memory was last accessed
    importance -- the poignancy score assigned when the memory was formed
    relevance  -- embedding cosine similarity to the current query

This is a small information-retrieval engine. Keeping it correct is what keeps
20 agents coherent over simulated days, and the per-component breakdown is
surfaced in the UI so any decision is explainable ("it retrieved these
memories, for these reasons").
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

from ..config import RetrievalConfig
from ..embed import Embedder, cosine

_ID = itertools.count(1)


@dataclass
class Memory:
    agent_id: str
    kind: str                       # observation | reflection | plan | dialogue
    text: str
    importance: float               # 1..10
    created_tick: int
    last_access_tick: int
    embedding: List[float] = field(default_factory=list)
    id: int = field(default_factory=lambda: next(_ID))
    # for reflections: ids of the memories that were used as evidence
    evidence: List[int] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "text": self.text,
            "importance": round(self.importance, 1),
            "created_tick": self.created_tick,
            "last_access_tick": self.last_access_tick,
            "evidence": self.evidence,
        }


@dataclass
class ScoredMemory:
    memory: Memory
    score: float
    recency: float
    importance: float
    relevance: float

    def to_dict(self) -> Dict:
        d = self.memory.to_dict()
        d.update({
            "score": round(self.score, 3),
            "components": {
                "recency": round(self.recency, 3),
                "importance": round(self.importance, 3),
                "relevance": round(self.relevance, 3),
            },
        })
        return d


def _minmax(values: Sequence[float]) -> List[float]:
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return [0.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


class MemoryStream:
    def __init__(self, agent_id: str, embedder: Embedder,
                 cfg: RetrievalConfig, minutes_per_tick: int):
        self.agent_id = agent_id
        self.embedder = embedder
        self.cfg = cfg
        self.minutes_per_tick = minutes_per_tick
        self.memories: List[Memory] = []
        # bookkeeping for the reflection trigger
        self.importance_since_reflection = 0.0

    # -- writing -----------------------------------------------------------
    def add(self, text: str, kind: str, importance: float, tick: int,
            embedding: Optional[List[float]] = None,
            evidence: Optional[List[int]] = None) -> Memory:
        if embedding is None:
            embedding = self.embedder.embed(text)
        mem = Memory(
            agent_id=self.agent_id, kind=kind, text=text.strip(),
            importance=float(importance), created_tick=tick,
            last_access_tick=tick, embedding=embedding,
            evidence=evidence or [],
        )
        self.memories.append(mem)
        self.importance_since_reflection += importance
        return mem

    # -- reading -----------------------------------------------------------
    def retrieve(self, query: str, now_tick: int, top_k: Optional[int] = None,
                 kinds: Optional[Sequence[str]] = None,
                 touch: bool = True) -> List[ScoredMemory]:
        top_k = top_k or self.cfg.top_k
        pool = [m for m in self.memories
                if kinds is None or m.kind in kinds]
        if not pool:
            return []

        q_emb = self.embedder.embed(query)
        mins_per_tick = self.minutes_per_tick

        recency_raw, importance_raw, relevance_raw = [], [], []
        for m in pool:
            hours = max(0.0, (now_tick - m.last_access_tick) * mins_per_tick / 60.0)
            recency_raw.append(self.cfg.recency_decay_per_hour ** hours)
            importance_raw.append(m.importance)
            rel = cosine(q_emb, m.embedding)
            relevance_raw.append(max(0.0, rel))

        rec_n = _minmax(recency_raw)
        imp_n = _minmax(importance_raw)
        rel_n = _minmax(relevance_raw)

        scored: List[ScoredMemory] = []
        for i, m in enumerate(pool):
            score = (self.cfg.w_recency * rec_n[i]
                     + self.cfg.w_importance * imp_n[i]
                     + self.cfg.w_relevance * rel_n[i])
            scored.append(ScoredMemory(m, score, rec_n[i], imp_n[i], rel_n[i]))

        scored.sort(key=lambda s: s.score, reverse=True)
        top = scored[:top_k]
        if touch:
            for s in top:
                s.memory.last_access_tick = now_tick
        return top

    def recent(self, n: int, kinds: Optional[Sequence[str]] = None) -> List[Memory]:
        pool = [m for m in self.memories
                if kinds is None or m.kind in kinds]
        return pool[-n:]

    def all(self) -> List[Memory]:
        return list(self.memories)

    def __len__(self) -> int:
        return len(self.memories)

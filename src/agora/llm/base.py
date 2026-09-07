"""Swappable LLM interface with caching, batching and call accounting.

The cognitive modules only ever see :class:`BaseLLM`. Concrete backends
(:mod:`agora.llm.mock`, ``ollama``, ``openai_compat``) implement ``_complete``.

Two things make this "systems-grade" rather than a thin wrapper:

* **On-disk cache** -- identical (prompt, system, params) requests never hit the
  model twice across runs. This is what makes re-running a scenario cheap.
* **Call accounting** -- every request is counted and bucketed by *purpose*
  (importance / reflection / planning / dialogue / ...), so the cost pass can
  report real "LLM calls per simulated day" before and after caching.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence


@dataclass
class LLMStats:
    requests: int = 0            # logical generate() calls
    backend_calls: int = 0       # actual model invocations (cache misses)
    cache_hits: int = 0
    batches: int = 0
    by_purpose: Counter = field(default_factory=Counter)

    def as_dict(self) -> Dict:
        return {
            "requests": self.requests,
            "backend_calls": self.backend_calls,
            "cache_hits": self.cache_hits,
            "batches": self.batches,
            "cache_hit_rate": round(self.cache_hits / self.requests, 3) if self.requests else 0.0,
            "by_purpose": dict(self.by_purpose),
        }


class ResponseCache:
    """Tiny thread-safe SQLite key->value cache."""

    def __init__(self, path: Optional[str]):
        self.path = path
        self._lock = threading.Lock()
        self._enabled = bool(path)
        if self._enabled:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            self._conn = sqlite3.connect(path, check_same_thread=False)
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT)"
            )
            self._conn.commit()

    def get(self, key: str) -> Optional[str]:
        if not self._enabled:
            return None
        with self._lock:
            row = self._conn.execute("SELECT v FROM cache WHERE k=?", (key,)).fetchone()
        return row[0] if row else None

    def put(self, key: str, value: str) -> None:
        if not self._enabled:
            return
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO cache (k, v) VALUES (?, ?)", (key, value)
            )
            self._conn.commit()


class BaseLLM:
    name = "base"

    def __init__(self, cache: Optional[ResponseCache] = None,
                 temperature: float = 0.7, max_tokens: int = 256):
        self.cache = cache
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.stats = LLMStats()

    # -- public API --------------------------------------------------------
    def generate(self, prompt: str, *, system: Optional[str] = None,
                 temperature: Optional[float] = None, max_tokens: Optional[int] = None,
                 purpose: str = "general", meta: Optional[Dict] = None,
                 use_cache: bool = True) -> str:
        temperature = self.temperature if temperature is None else temperature
        max_tokens = self.max_tokens if max_tokens is None else max_tokens
        self.stats.requests += 1
        self.stats.by_purpose[purpose] += 1

        key = self._key(prompt, system, temperature, max_tokens)
        if use_cache and self.cache:
            hit = self.cache.get(key)
            if hit is not None:
                self.stats.cache_hits += 1
                return hit

        text = self._complete(prompt, system, temperature, max_tokens,
                              purpose=purpose, meta=meta or {})
        self.stats.backend_calls += 1
        if use_cache and self.cache:
            self.cache.put(key, text)
        return text

    def generate_batch(self, prompts: Sequence[str], *, system: Optional[str] = None,
                       temperature: Optional[float] = None, max_tokens: Optional[int] = None,
                       purpose: str = "general",
                       metas: Optional[Sequence[Dict]] = None) -> List[str]:
        """Batched generation. Default implementation loops but records it as a
        single batch so the cost pass can show batching wins. Backends that
        support true batched inference may override this."""
        self.stats.batches += 1
        metas = list(metas) if metas is not None else [None] * len(prompts)
        return [
            self.generate(p, system=system, temperature=temperature,
                          max_tokens=max_tokens, purpose=purpose, meta=m)
            for p, m in zip(prompts, metas)
        ]

    # -- to implement ------------------------------------------------------
    def _complete(self, prompt: str, system: Optional[str],
                  temperature: float, max_tokens: int,
                  purpose: str = "general", meta: Optional[Dict] = None) -> str:  # pragma: no cover
        raise NotImplementedError

    # -- helpers -----------------------------------------------------------
    def _key(self, prompt: str, system: Optional[str], temperature: float,
             max_tokens: int) -> str:
        blob = json.dumps(
            {"n": self.name, "m": getattr(self, "model", ""), "s": system or "",
             "p": prompt, "t": round(temperature, 3), "mt": max_tokens},
            sort_keys=True,
        )
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

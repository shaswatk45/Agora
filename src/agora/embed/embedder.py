"""Text embeddings for retrieval relevance.

Two backends behind one interface:

* ``SentenceTransformerEmbedder`` -- real semantic embeddings (optional dep).
* ``HashingEmbedder``            -- a dependency-free, deterministic lexical
  embedder so the whole simulation runs and demos with zero model downloads.

The hashing embedder uses hashed n-gram term frequencies projected into a fixed
dimensional space with L2 normalisation. It is not semantic, but it gives stable
lexical relevance that is more than enough to demonstrate that the retrieval
*ranking* works -- and it swaps out for the real thing by flipping one config
flag.
"""
from __future__ import annotations

import hashlib
import math
import re
from typing import List, Sequence

_TOKEN_RE = re.compile(r"[a-z0-9']+")


def _tokenize(text: str) -> List[str]:
    return _TOKEN_RE.findall(text.lower())


class Embedder:
    """Interface. Subclasses set ``dim`` and implement ``embed_batch``."""

    dim: int = 0
    name: str = "base"

    def embed(self, text: str) -> List[float]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: Sequence[str]) -> List[List[float]]:  # pragma: no cover
        raise NotImplementedError


class HashingEmbedder(Embedder):
    """Deterministic hashed bag-of-(uni+bi)-grams embedder. No dependencies."""

    name = "hashing"

    def __init__(self, dim: int = 256):
        self.dim = dim

    def _hash(self, token: str) -> int:
        h = hashlib.md5(token.encode("utf-8")).digest()
        return int.from_bytes(h[:4], "little") % self.dim

    def embed_batch(self, texts: Sequence[str]) -> List[List[float]]:
        out: List[List[float]] = []
        for text in texts:
            vec = [0.0] * self.dim
            toks = _tokenize(text)
            grams = list(toks)
            grams += [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
            for g in grams:
                vec[self._hash(g)] += 1.0
            norm = math.sqrt(sum(v * v for v in vec))
            if norm > 0:
                vec = [v / norm for v in vec]
            out.append(vec)
        return out


class SentenceTransformerEmbedder(Embedder):
    """Wraps sentence-transformers if it is installed."""

    name = "sentence-transformers"

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer  # lazy import

        self._model = SentenceTransformer(model_name)
        self.dim = int(self._model.get_sentence_embedding_dimension())

    def embed_batch(self, texts: Sequence[str]) -> List[List[float]]:
        vecs = self._model.encode(list(texts), normalize_embeddings=True)
        return [list(map(float, v)) for v in vecs]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity for already-or-not-normalised vectors."""
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def build_embedder(backend: str = "auto", st_model: str = "all-MiniLM-L6-v2",
                   hashing_dim: int = 256) -> Embedder:
    """Factory. 'auto' prefers sentence-transformers, falls back to hashing."""
    if backend in ("auto", "sentence-transformers"):
        try:
            return SentenceTransformerEmbedder(st_model)
        except Exception:
            if backend == "sentence-transformers":
                raise
    return HashingEmbedder(hashing_dim)

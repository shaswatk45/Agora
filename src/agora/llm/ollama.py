"""Local-model backend via Ollama's HTTP API (http://localhost:11434).

Uses only the standard library so there is no extra dependency. Run e.g.
``ollama pull llama3.2:3b`` then launch Agora with ``--llm ollama``.
"""
from __future__ import annotations

import json
import urllib.request
from typing import Dict, Optional

from .base import BaseLLM


class OllamaLLM(BaseLLM):
    name = "ollama"

    def __init__(self, model: str = "llama3.2:3b",
                 url: str = "http://localhost:11434", **kw):
        super().__init__(**kw)
        self.model = model
        self.url = url.rstrip("/")

    def _complete(self, prompt: str, system: Optional[str], temperature: float,
                  max_tokens: int, purpose: str = "general",
                  meta: Optional[Dict] = None) -> str:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system or "",
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        req = urllib.request.Request(
            f"{self.url}/api/generate",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return (data.get("response") or "").strip()

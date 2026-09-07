"""OpenAI-compatible chat-completions backend (OpenAI, Together, Groq, vLLM...).

Standard library only. Reads the API key from an env var (default
``OPENAI_API_KEY``) and talks to ``{base_url}/chat/completions``.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Dict, Optional

from .base import BaseLLM


class OpenAICompatLLM(BaseLLM):
    name = "openai"

    def __init__(self, model: str = "gpt-4o-mini",
                 base_url: str = "https://api.openai.com/v1",
                 api_key_env: str = "OPENAI_API_KEY", **kw):
        super().__init__(**kw)
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = os.environ.get(api_key_env, "")
        if not self.api_key:
            raise RuntimeError(
                f"No API key found in ${api_key_env}. Set it or use --llm mock/ollama."
            )

    def _complete(self, prompt: str, system: Optional[str], temperature: float,
                  max_tokens: int, purpose: str = "general",
                  meta: Optional[Dict] = None) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()

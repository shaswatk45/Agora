from typing import Optional

from ..config import LLMConfig
from .base import BaseLLM, ResponseCache, LLMStats
from .mock import MockLLM


def build_llm(cfg: LLMConfig) -> BaseLLM:
    """Factory that turns an :class:`LLMConfig` into a concrete backend."""
    cache = ResponseCache(cfg.cache_path)
    common = dict(cache=cache, temperature=cfg.temperature, max_tokens=cfg.max_tokens)
    if cfg.backend == "mock":
        return MockLLM(**common)
    if cfg.backend == "ollama":
        from .ollama import OllamaLLM
        return OllamaLLM(model=cfg.model, url=cfg.ollama_url, **common)
    if cfg.backend == "openai":
        from .openai_compat import OpenAICompatLLM
        return OpenAICompatLLM(model=cfg.model, base_url=cfg.openai_base_url,
                               api_key_env=cfg.openai_api_key_env, **common)
    raise ValueError(f"Unknown LLM backend: {cfg.backend}")


__all__ = ["BaseLLM", "ResponseCache", "LLMStats", "MockLLM", "build_llm"]

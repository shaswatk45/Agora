"""Central configuration for Agora.

Every tunable that affects the cognitive architecture lives here so it can be
inspected, logged, and ablated (e.g. zeroing a retrieval weight to prove it
matters). Values are deliberately conservative so a full simulated day runs
cheaply on a small/local model.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict


# --- Simulated time -------------------------------------------------------
# One tick = MINUTES_PER_TICK simulated minutes. The day starts at DAY_START_MIN.
MINUTES_PER_TICK = 10
DAY_START_MIN = 8 * 60          # 08:00
DAY_LENGTH_MIN = 24 * 60
TICKS_PER_DAY = DAY_LENGTH_MIN // MINUTES_PER_TICK


@dataclass
class RetrievalConfig:
    """Weights for the memory-retrieval scoring function.

    score = w_recency * recency + w_importance * importance + w_relevance * relevance

    Each component is min-max normalised to [0, 1] across the candidate set
    (as in Park et al., "Generative Agents"), so the weights are directly
    comparable. Set any weight to 0.0 to ablate that signal.
    """
    w_recency: float = 1.0
    w_importance: float = 1.0
    w_relevance: float = 1.0
    # Exponential recency decay applied per simulated *hour* since last access.
    recency_decay_per_hour: float = 0.99
    top_k: int = 8


@dataclass
class ReflectionConfig:
    # Reflect once the summed importance of memories since the last reflection
    # crosses this threshold (the paper uses 150; we scale down for short runs).
    importance_trigger: float = 100.0
    # How many recent memories to consider when forming reflection questions.
    recent_window: int = 25
    # Number of high-level insights to synthesise per reflection.
    insights_per_reflection: int = 3


@dataclass
class PlanningConfig:
    daily_items: int = 6            # broad-stroke items in a daily plan
    replan_importance: float = 6.0  # a perception this poignant can interrupt a plan


@dataclass
class LLMConfig:
    backend: str = "mock"           # mock | ollama | openai
    model: str = "llama3.2:3b"      # used by ollama/openai backends
    temperature: float = 0.7
    max_tokens: int = 256
    cache_path: str = "data/llm_cache.sqlite"
    # ollama
    ollama_url: str = "http://localhost:11434"
    # openai-compatible
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key_env: str = "OPENAI_API_KEY"


@dataclass
class EmbedConfig:
    backend: str = "auto"           # auto | sentence-transformers | hashing
    st_model: str = "all-MiniLM-L6-v2"
    hashing_dim: int = 256


@dataclass
class Config:
    seed: int = 7
    minutes_per_tick: int = MINUTES_PER_TICK
    day_start_min: int = DAY_START_MIN
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    reflection: ReflectionConfig = field(default_factory=ReflectionConfig)
    planning: PlanningConfig = field(default_factory=PlanningConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    embed: EmbedConfig = field(default_factory=EmbedConfig)
    db_path: str = "data/agora.sqlite"
    # cap conversations so co-located crowds don't explode call counts
    max_dialogue_turns: int = 4

    def to_dict(self) -> Dict:
        return asdict(self)


DEFAULT = Config()

"""Reflection: periodic synthesis of memories into higher-level beliefs.

When the summed importance of an agent's memories since its last reflection
crosses a threshold, the agent:
  1. asks (via the LLM) a few salient questions about its recent experience,
  2. retrieves the memories most relevant to each question,
  3. synthesises an insight from that evidence,
and writes each insight back into the stream as a high-importance ``reflection``
memory. These reflections then compete in retrieval like any other memory, so
they shape future dialogue and planning -- which is how a personality *develops*
rather than staying static.
"""
from __future__ import annotations

from typing import List

from ..config import Config


def should_reflect(agent, cfg: Config) -> bool:
    return agent.memory.importance_since_reflection >= cfg.reflection.importance_trigger


def reflect(agent, llm, world, cfg: Config) -> List[str]:
    persona = agent.persona
    now_tick = world.clock.tick
    recent = agent.memory.recent(cfg.reflection.recent_window)
    recent_texts = [m.text for m in recent]

    # 1. what should the agent reflect on?
    q_prompt = (
        f"{persona.name}'s recent memories:\n- " + "\n- ".join(recent_texts) +
        f"\n\nWhat are {cfg.reflection.insights_per_reflection} high-level questions "
        f"we can answer about {persona.first_name} from these memories?"
    )
    q_meta = {"name": persona.name, "self_name": persona.first_name,
              "memories": recent_texts, "known_agents": agent.roster_first}
    q_resp = llm.generate(q_prompt, purpose="reflection_questions", meta=q_meta,
                          max_tokens=200)
    questions = [ln.split(".", 1)[-1].strip() if "." in ln[:3] else ln.strip()
                 for ln in q_resp.splitlines() if ln.strip()]
    questions = questions[: cfg.reflection.insights_per_reflection] or \
        [f"What does {persona.first_name} care about?"]

    insights: List[str] = []
    for q in questions:
        evidence = agent.memory.retrieve(q, now_tick, top_k=5)
        ev_texts = [s.memory.text for s in evidence]
        ev_ids = [s.memory.id for s in evidence]
        i_prompt = (
            f"Question: {q}\nEvidence:\n- " + "\n- ".join(ev_texts) +
            f"\n\nWrite one insight about {persona.name} supported by this evidence."
        )
        i_meta = {"name": persona.name, "question": q, "evidence": ev_texts}
        insight = llm.generate(i_prompt, purpose="reflection_insight", meta=i_meta,
                               max_tokens=120).strip()
        if insight:
            agent.memory.add(insight, kind="reflection", importance=7.0,
                             tick=now_tick, evidence=ev_ids)
            insights.append(insight)

    agent.memory.importance_since_reflection = 0.0
    agent.last_reflection_tick = now_tick
    return insights

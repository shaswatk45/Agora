"""Believability evaluation: interview agents, score consistency with reality.

We ask each agent a small set of questions about their day. The agent answers
*from its retrieved memories* (the same machinery it uses to act). We then score
each answer against ground truth reconstructed from that agent's actual
experience -- the locations it really visited, the people it really talked to,
and whether it really learned about the party.

The headline number is the mean per-item consistency score. We also report a
contradiction rate: the fraction of answers that assert something that did not
happen (a hallucinated place or person, or a claimed/denied party incorrectly).
This is what turns "looks alive" into a measurable claim.
"""
from __future__ import annotations

import re
from statistics import mean
from typing import Dict, List

from ..sim import metrics

QUESTIONS = [
    ("places", "What did you do today and where did you go?"),
    ("people", "Who did you talk to today?"),
    ("evening", "Do you have any plans for this evening?"),
]


def _ground_truth(agent, engine) -> Dict:
    visited, talked = set(), set()
    for m in agent.memory.all():
        if m.kind == "observation":
            mt = re.search(r"arrived at ([A-Z][\w ]+?) and", m.text)
            if mt:
                visited.add(mt.group(1).strip())
        if m.kind == "dialogue":
            mt = re.search(r"Talked with ([A-Z][\w ]+?)\.", m.text)
            if mt:
                talked.add(mt.group(1).strip())
    known = list(engine.world.map.locations.keys())
    knowers = set(metrics.party_knowers(engine.agents, engine.party, known))
    return {"visited": visited, "talked": talked, "knows_party": agent.id in knowers}


def _interview(agent, question: str, engine) -> str:
    retrieved = agent.memory.retrieve(question, engine.world.clock.tick, top_k=6,
                                      touch=False)
    mem_texts = [s.memory.text for s in retrieved]
    prompt = (f"You are {agent.persona.name}. Answer briefly and truthfully based "
              f"on your memories.\nQuestion: {question}\n"
              f"Memories:\n- " + "\n- ".join(mem_texts))
    return engine.llm.generate(prompt, purpose="interview",
                               meta={"memories": mem_texts,
                                     "name": agent.persona.name}, max_tokens=160).strip()


def _score_item(kind: str, answer: str, gt: Dict, known_locs: List[str],
                first_names: List[str], self_name: str):
    low = answer.lower()
    if kind == "places":
        mentioned = {L for L in known_locs if L.lower() in low}
        if not mentioned:
            return 0.5, False   # vague but not wrong
        correct = mentioned & gt["visited"]
        contradiction = bool(mentioned - gt["visited"])
        return len(correct) / len(mentioned), contradiction
    if kind == "people":
        mentioned = {n for n in first_names
                     if n != self_name and re.search(rf"\b{re.escape(n)}\b", answer)}
        if not mentioned:
            return (0.5 if gt["talked"] else 1.0), False
        gt_first = {t.split()[0] for t in gt["talked"]}
        correct = mentioned & gt_first
        contradiction = bool(mentioned - gt_first)
        return len(correct) / len(mentioned), contradiction
    if kind == "evening":
        says_party = "party" in low
        if gt["knows_party"]:
            return (1.0, False) if says_party else (0.0, False)
        # an agent who never heard about the party should not claim to attend one
        return (0.0, True) if says_party else (1.0, False)
    return 0.5, False


def evaluate(engine, questions=QUESTIONS) -> Dict:
    known_locs = list(engine.world.map.locations.keys())
    first_names = [a.persona.first_name for a in engine.agents]

    all_scores: List[float] = []
    contradictions = 0
    items = 0
    per_agent: List[Dict] = []

    for ag in engine.agents:
        gt = _ground_truth(ag, engine)
        qa = []
        agent_scores = []
        for kind, q in questions:
            answer = _interview(ag, q, engine)
            s, contradiction = _score_item(kind, answer, gt, known_locs,
                                            first_names, ag.persona.first_name)
            all_scores.append(s)
            agent_scores.append(s)
            items += 1
            contradictions += 1 if contradiction else 0
            qa.append({"question": q, "answer": answer, "score": round(s, 2),
                       "contradiction": contradiction})
        per_agent.append({
            "agent": ag.persona.name,
            "score": round(mean(agent_scores), 3),
            "qa": qa,
            "ground_truth": {"visited": sorted(gt["visited"]),
                             "talked": sorted(gt["talked"]),
                             "knows_party": gt["knows_party"]},
        })

    believability = round(mean(all_scores) * 100, 1) if all_scores else 0.0
    return {
        "believability_score": believability,
        "contradiction_rate": round(contradictions / items, 3) if items else 0.0,
        "items_scored": items,
        "n_agents": len(engine.agents),
        "per_agent": per_agent,
    }

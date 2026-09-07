"""Grounded conversations between co-located agents.

Each turn, the speaker retrieves the memories most relevant to talking with the
other person -- news, plans, invitations, and their relationship -- and speaks
grounded in them. Because a party invitation is a high-importance memory, it
surfaces here and gets spoken; the listener then stores a summary of the
conversation as a new memory. That summary is what carries the invitation
onward: it is parseable as an event, so it later drives the listener's planning.
This is the concrete path along which information diffuses through the town.
"""
from __future__ import annotations

from typing import Dict, List

from ..config import Config
from ..util import parse_event


def converse(a, b, llm, world, cfg: Config) -> Dict:
    now_tick = world.clock.tick
    known_locations = list(world.map.locations.keys())
    pair = [a, b]
    history: List[str] = []
    turns: List[Dict] = []

    for i in range(cfg.max_dialogue_turns):
        speaker = pair[i % 2]
        listener = pair[(i + 1) % 2]
        query = (f"catching up with {listener.persona.first_name}: news, plans, "
                 f"invitations to share, and our relationship")
        retrieved = speaker.memory.retrieve(query, now_tick, top_k=5)
        mem_texts = [s.memory.text for s in retrieved]
        rel = speaker.persona.relationships.get(listener.persona.name, "")
        prompt = (
            f"You are {speaker.persona.name} talking to {listener.persona.name}"
            + (f" ({rel})" if rel else "") + ".\n"
            f"Relevant memories:\n- " + "\n- ".join(mem_texts) + "\n"
            f"Conversation so far:\n" + ("\n".join(history) or "(just started)") +
            f"\n\nSay one natural line to {listener.persona.first_name}."
        )
        meta = {
            "speaker": speaker.persona.first_name,
            "listener": listener.persona.first_name,
            "relationship": rel, "memories": mem_texts,
            "history": list(history), "known_locations": known_locations,
        }
        text = llm.generate(prompt, purpose="dialogue", meta=meta, max_tokens=120).strip()
        history.append(f"{speaker.persona.first_name}: {text}")
        turns.append({"speaker": speaker.persona.first_name, "text": text})

    # summarise the conversation into a memory for both participants
    all_text = " ".join(t["text"] for t in turns)
    learned_event = parse_event(all_text, known_locations) is not None
    record = {"a": a.persona.first_name, "b": b.persona.first_name,
              "turns": turns, "learned_event": learned_event}

    for me, other in ((a, b), (b, a)):
        meta = {"speaker": me.persona.first_name, "listener": other.persona.first_name,
                "utterances": [t["text"] for t in turns],
                "known_locations": known_locations}
        summary = llm.generate(
            f"Summarise this conversation between {me.persona.first_name} and "
            f"{other.persona.first_name} in one sentence, keeping any event "
            f"details (place and time):\n" + all_text,
            purpose="dialogue_summary", meta=meta, max_tokens=80).strip()
        text = f"Talked with {other.persona.name}. {summary}"
        importance = me.score_importance(text, llm)
        me.memory.add(text, kind="dialogue", importance=importance, tick=now_tick)
        me.note_conversation(other, now_tick)

    record["summary"] = summary  # last-speaker perspective, for the event feed
    return record

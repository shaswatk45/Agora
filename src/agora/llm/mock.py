"""Deterministic, dependency-free mock LLM.

This is what lets Agora run and *demonstrate emergence* with zero model
downloads and zero API keys. It is not a language model -- it is a set of
deterministic rules keyed on the request ``purpose`` and structured ``meta``.

Design principle: the mock never "cheats" the emergence. It does not know about
the party scenario. It only:
  * rates memory importance from generic salience keywords,
  * in dialogue, surfaces the speaker's single most relevant retrieved memory,
  * in planning, schedules attendance for any *event* it can parse out of the
    agent's own retrieved memories.
Because a party invitation is a high-importance memory, it gets retrieved, so it
gets spoken, so listeners store it, so they later parse and attend it. The
coordination is a consequence of the architecture, not a scripted rule.
"""
from __future__ import annotations

import hashlib
import random
from typing import Dict, List, Optional

from .base import BaseLLM
from ..util import parse_event, hhmm

_HIGH = ("party", "invite", "invitation", "love", "confess", "breakup", "fight",
         "argument", "death", "fired", "engaged", "married", "election",
         "accident", "wedding", "moving", "promotion", "celebration")
_MID = ("plan", "decide", "meeting", "date", "project", "deadline", "worried",
        "excited", "hope", "friend", "neighbor", "conversation", "asked")
_LOW = ("wake", "woke", "breakfast", "lunch", "dinner", "coffee", "walk",
        "brush", "shower", "sleep", "idle", "sat", "arrived", "left")


def _seed(*parts: str) -> random.Random:
    h = hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()
    return random.Random(int(h[:8], 16))


class MockLLM(BaseLLM):
    name = "mock"
    model = "mock-rules-v1"

    def _complete(self, prompt: str, system: Optional[str], temperature: float,
                  max_tokens: int, purpose: str = "general",
                  meta: Optional[Dict] = None) -> str:
        meta = meta or {}
        handler = getattr(self, f"_do_{purpose}", None)
        if handler is None:
            return self._do_general(prompt, meta)
        return handler(prompt, meta)

    # -- importance --------------------------------------------------------
    def _do_importance(self, prompt: str, meta: Dict) -> str:
        text = (meta.get("text") or prompt).lower()
        score = 2
        if any(w in text for w in _MID):
            score = 4
        if any(w in text for w in _HIGH):
            score = 8
        if any(w in text for w in _LOW) and not any(w in text for w in _HIGH):
            score = min(score, 2)
        # a little deterministic jitter so ties break naturally
        score += _seed(text).randint(-1, 1)
        return str(max(1, min(10, score)))

    # -- reflection --------------------------------------------------------
    def _do_reflection_questions(self, prompt: str, meta: Dict) -> str:
        mems: List[str] = meta.get("memories", [])
        name = meta.get("name", "The agent")
        allowed = set(meta.get("known_agents", []))  # only real people are subjects
        subjects = self._salient_subjects(mems, meta.get("self_name", name), allowed)
        qs = []
        for s in subjects[:3]:
            qs.append(f"What is {name}'s relationship with {s}?")
        qs.append(f"What does {name} care about most right now?")
        return "\n".join(f"{i+1}. {q}" for i, q in enumerate(qs[:3]))

    def _do_reflection_insight(self, prompt: str, meta: Dict) -> str:
        name = meta.get("name", "The agent")
        question = meta.get("question", "")
        evidence: List[str] = meta.get("evidence", [])
        subj = question.replace("?", "").split("with")[-1].strip() if "with" in question else ""
        rng = _seed(name, question)
        if subj:
            tone = rng.choice(["values", "is growing closer to", "is intrigued by",
                               "feels a connection with"])
            return f"{name} {tone} {subj}."
        theme = self._theme(evidence, rng)
        return f"{name} seems to care most about {theme} lately."

    # -- planning ----------------------------------------------------------
    def _do_daily_plan(self, prompt: str, meta: Dict) -> str:
        name = meta.get("name", "The agent")
        occupation = meta.get("occupation", "resident")
        home = meta.get("home", "Home")
        rng = _seed(name, str(meta.get("day", 0)))
        base = [
            (8 * 60, f"wake up and have breakfast at {home}"),
            (9 * 60, self._work_line(occupation)),
            (12 * 60, "have lunch at Hobbs Cafe"),
            (14 * 60, self._afternoon_line(occupation, rng)),
            (18 * 60, f"have dinner at {home}"),
            (22 * 60, f"wind down and sleep at {home}"),
        ]
        # fold in any events parsed from relevant memories (emergent attendance)
        events = self._events_from_memories(meta)
        for ev in events:
            base.append((ev["time_min"],
                         f"go to {ev['location']} at {hhmm(ev['time_min'])} for the event"))
        base.sort(key=lambda x: x[0])
        return "\n".join(f"{hhmm(t)} - {desc}" for t, desc in base)

    def _do_reaction(self, prompt: str, meta: Dict) -> str:
        # Decide whether a perception warrants interrupting the plan.
        observation = (meta.get("observation") or "").lower()
        if any(w in observation for w in _HIGH):
            return "REACT: pause and engage with this."
        return "CONTINUE"

    # -- dialogue ----------------------------------------------------------
    def _do_dialogue(self, prompt: str, meta: Dict) -> str:
        speaker = meta.get("speaker", "Someone")
        listener = meta.get("listener", "someone")
        rel = meta.get("relationship", "")
        mems: List[str] = meta.get("memories", [])
        history: List[str] = meta.get("history", [])
        rng = _seed(speaker, listener, str(len(history)))

        # opening turn: greet, grounded in relationship
        if not history:
            greet = rng.choice([
                f"Hi {listener}!", f"Oh, hey {listener}.", f"Good to see you, {listener}.",
                f"Hello {listener}, how are you?",
            ])
        else:
            greet = rng.choice(["Right.", "I see.", "Yeah.", "Makes sense.", "Oh nice."])

        # surface the single most relevant retrieved memory (this is how news spreads)
        share = ""
        top = mems[0] if mems else ""
        ev = parse_event(top, meta.get("known_locations", []))
        if ev and "party" in top.lower():
            share = (f" By the way, {ev['text']} "
                     f"You should come to {ev['location']} at {hhmm(ev['time_min'])}!")
        elif top and len(history) < 2:
            share = f" {self._paraphrase(top, rng)}"

        tail = "" if history else rng.choice(
            [" How about you?", " What have you been up to?", ""])
        return (greet + share + tail).strip()

    def _do_dialogue_summary(self, prompt: str, meta: Dict) -> str:
        a = meta.get("speaker", "A")
        b = meta.get("listener", "B")
        utterances: List[str] = meta.get("utterances", [])
        joined = " ".join(utterances).lower()
        ev = parse_event(" ".join(utterances), meta.get("known_locations", []))
        if ev and "party" in joined:
            return (f"{a} told {b} about a party at {ev['location']} "
                    f"at {hhmm(ev['time_min'])}. {b} was invited.")
        topic = self._topic(utterances)
        return f"{a} and {b} talked about {topic}."

    # -- interview (believability eval) ------------------------------------
    def _do_interview(self, prompt: str, meta: Dict) -> str:
        mems: List[str] = meta.get("memories", [])
        if not mems:
            return "I don't recall much about that."
        # answer straight from the retrieved memories -- consistency is the point
        picked = mems[:3]
        return " ".join(m.rstrip(".") + "." for m in picked)

    # -- fallback ----------------------------------------------------------
    def _do_general(self, prompt: str, meta: Dict) -> str:
        return "Okay."

    # -- internal helpers --------------------------------------------------
    def _events_from_memories(self, meta: Dict) -> List[Dict]:
        out = []
        seen = set()
        now = meta.get("now_min", 0)
        for m in meta.get("memories", []):
            ev = parse_event(m, meta.get("known_locations", []))
            if ev and ev["time_min"] > now:
                key = (ev["location"], ev["time_min"])
                if key not in seen:
                    seen.add(key)
                    out.append(ev)
        return out

    def _salient_subjects(self, mems: List[str], self_name: str,
                          allowed: Optional[set] = None) -> List[str]:
        counts: Dict[str, int] = {}
        for m in mems:
            for tok in m.replace(".", " ").replace(",", " ").split():
                if not tok.istitle() or tok == self_name or len(tok) <= 2:
                    continue
                if allowed and tok not in allowed:   # restrict to real people
                    continue
                counts[tok] = counts.get(tok, 0) + 1
        return [k for k, _ in sorted(counts.items(), key=lambda x: -x[1])]

    def _theme(self, evidence: List[str], rng: random.Random) -> str:
        joined = " ".join(evidence).lower()
        for kw, theme in (("party", "community and celebration"),
                          ("work", "their work"), ("paint", "art"),
                          ("music", "music"), ("friend", "friendship"),
                          ("family", "family")):
            if kw in joined:
                return theme
        return rng.choice(["their daily routine", "the people around them",
                           "their neighborhood"])

    def _work_line(self, occupation: str) -> str:
        return f"head to work and focus on {occupation} tasks"

    def _afternoon_line(self, occupation: str, rng: random.Random) -> str:
        return rng.choice([
            "run errands at the Store",
            "spend time at the Park",
            "read at the Library",
            f"continue {occupation} work",
            "visit a neighbor",
        ])

    def _paraphrase(self, mem: str, rng: random.Random) -> str:
        lead = rng.choice(["I was just thinking,", "You know,", "Honestly,", "By the way,"])
        return f"{lead} {mem.strip().rstrip('.')}."

    def _topic(self, utterances: List[str]) -> str:
        joined = " ".join(utterances).lower()
        for kw in ("party", "work", "art", "music", "family", "weather", "plans"):
            if kw in joined:
                return kw
        return "how things are going"

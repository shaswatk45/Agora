"""Small shared helpers: simulated-time formatting and event parsing.

``parse_event`` is deliberately generic text parsing (event word + known
location + a time). It is *not* hard-coded to the party scenario -- that is what
keeps the party emergence honest: coordination arises because an event memory,
once spread through dialogue, is later parsed out of a listener's own retrieved
memories at planning time. Nothing scripts "everyone attends".
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

EVENT_WORDS = ("party", "gathering", "celebration", "get-together",
               "get together", "meetup", "meet-up", "event", "festival")

_TIME_AMPM = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b")
_TIME_24 = re.compile(r"\b(\d{1,2}):(\d{2})\b")


def hhmm(minute_of_day: int) -> str:
    minute_of_day %= 24 * 60
    return f"{minute_of_day // 60:02d}:{minute_of_day % 60:02d}"


def parse_time_to_minute(text: str) -> Optional[int]:
    """Return minute-of-day for the first time expression found, else None."""
    m = _TIME_AMPM.search(text)
    if m:
        h = int(m.group(1)) % 12
        mm = int(m.group(2) or 0)
        if m.group(3) == "pm":
            h += 12
        return h * 60 + mm
    m = _TIME_24.search(text)
    if m:
        h, mm = int(m.group(1)), int(m.group(2))
        if 0 <= h < 24 and 0 <= mm < 60:
            return h * 60 + mm
    return None


def parse_event(text: str, known_locations: List[str]) -> Optional[Dict]:
    """Extract a schedulable event from free text, or None.

    An event needs: an event word, a recognised location, and a time.
    """
    low = text.lower()
    if not any(w in low for w in EVENT_WORDS):
        return None
    # pick the location that appears earliest in the text -- i.e. the one tied to
    # the "... party at <place> ..." phrasing -- not merely the first in list order.
    # This prevents a stray mention of another place from mutating the event.
    loc, loc_pos = None, len(low) + 1
    for name in known_locations:
        pos = low.find(name.lower())
        if pos != -1 and pos < loc_pos:
            loc, loc_pos = name, pos
    if loc is None:
        return None
    tmin = parse_time_to_minute(low)
    if tmin is None:
        return None
    return {"location": loc, "time_min": tmin, "text": text.strip()}

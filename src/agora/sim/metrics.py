"""Metrics: the numbers that make Agora more than a demo.

* cost/latency  -- LLM calls per simulated day, cache hit rate (the cost pass).
* diffusion     -- how many agents have learned about the seeded event over time.
* attendance    -- how many agents actually gather at the event.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from ..util import parse_event


def party_knowers(agents, party: Optional[Dict], known_locations: List[str]) -> List[str]:
    """Names of agents whose memory contains the seeded event."""
    if not party:
        return []
    out = []
    for ag in agents:
        for m in ag.memory.all():
            ev = parse_event(m.text, known_locations)
            if ev and ev["location"] == party["location"] \
                    and abs(ev["time_min"] - party["time_min"]) <= 1:
                out.append(ag.id)
                break
    return out


def attendance(agents, world, location: str) -> List[str]:
    return [ag.id for ag in agents if world.location_at(ag.pos) == location]


def cost_summary(llm, days_elapsed: float) -> Dict:
    s = llm.stats
    days = max(days_elapsed, 1e-6)
    return {
        "backend": llm.name,
        "requests": s.requests,
        "backend_calls": s.backend_calls,
        "cache_hits": s.cache_hits,
        "cache_hit_rate": round(s.cache_hits / s.requests, 3) if s.requests else 0.0,
        "calls_per_sim_day": round(s.backend_calls / days, 1),
        "requests_per_sim_day": round(s.requests / days, 1),
        "by_purpose": dict(s.by_purpose),
    }

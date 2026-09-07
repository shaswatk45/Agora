"""The party-emergence scenario -- Agora's signature demonstration.

Seed a single agent with the intention to throw a party. Nothing else is told to
anyone. Run the day and watch the invitation propagate agent-to-agent through
ordinary conversation until a crowd gathers at the venue at the right time.

``run_party_scenario`` runs this headlessly and returns the engine plus a summary
of what emerged -- used by the evaluation CLI to produce reproducible numbers.
"""
from __future__ import annotations

from typing import Dict, Optional

from ..config import Config
from ..sim import Engine


def run_party_scenario(cfg: Optional[Config] = None, seed_at_min: int = 10 * 60,
                       run_until_min: int = 23 * 60,
                       host: str = "Isabella Rodriguez") -> Dict:
    cfg = cfg or Config()
    engine = Engine(cfg)

    # run the morning up to the seeding time
    while engine.world.clock.minute_of_day < seed_at_min and engine.world.clock.day == 0:
        engine.step()
    party = engine.seed_party(host_name=host)

    # run the rest of the day
    while not (engine.world.clock.day == 0 and
               engine.world.clock.minute_of_day >= run_until_min) \
            and engine.world.clock.day == 0:
        engine.step()

    peak_knowers = max((d["knowers"] for d in engine.diffusion_series), default=0)
    peak_attend = max((d["at_party"] for d in engine.diffusion_series), default=0)
    # time of first non-host knower (diffusion latency)
    return {
        "engine": engine,
        "party": party,
        "n_agents": len(engine.agents),
        "peak_knowers": peak_knowers,
        "peak_attendance": peak_attend,
        "diffusion_fraction": round(peak_knowers / len(engine.agents), 3),
        "attendance_fraction": round(peak_attend / len(engine.agents), 3),
    }

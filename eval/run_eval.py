"""Headless evaluation: produces the numbers Agora reports.

Runs the party-emergence scenario, measures information diffusion and attendance,
scores the interview-based believability eval, and performs the cost pass
(cold run vs. cache-warm run) to show the caching win in LLM calls per sim-day.

    py -3.12 eval/run_eval.py [--llm mock|ollama|openai] [--model NAME]

Writes a JSON report to data/eval_report.json and prints a summary.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "src"))

from agora.config import Config                     # noqa: E402
from agora.scenarios import run_party_scenario      # noqa: E402
from agora.evaluation import believability          # noqa: E402
from agora.sim import metrics                        # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--llm", default="mock", choices=["mock", "ollama", "openai"])
    ap.add_argument("--model", default=None)
    args = ap.parse_args()

    cache_path = os.path.join(_ROOT, "data", "llm_cache.sqlite")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)

    def make_cfg():
        cfg = Config()
        cfg.llm.backend = args.llm
        if args.model:
            cfg.llm.model = args.model
        cfg.llm.cache_path = cache_path
        return cfg

    # -- cost pass: cold run (empty cache) --------------------------------
    if os.path.exists(cache_path):
        os.remove(cache_path)
    print("Running party scenario (cold cache)...")
    cold = run_party_scenario(make_cfg())
    days_cold = max(cold["engine"].world.clock.total_minutes / (24 * 60), 1e-6)
    cold_cost = metrics.cost_summary(cold["engine"].llm, days_cold)

    # -- cost pass: warm run (cache populated) ----------------------------
    print("Running party scenario again (warm cache)...")
    warm = run_party_scenario(make_cfg())
    days_warm = max(warm["engine"].world.clock.total_minutes / (24 * 60), 1e-6)
    warm_cost = metrics.cost_summary(warm["engine"].llm, days_warm)

    # -- believability eval (on the warm run) -----------------------------
    print("Scoring believability (interviewing agents)...")
    bel = believability.evaluate(warm["engine"])

    report = {
        "config": {"llm": args.llm, "model": args.model or make_cfg().llm.model,
                   "embedder": warm["engine"].embedder.name,
                   "n_agents": warm["n_agents"]},
        "emergence": {
            "peak_knowers": warm["peak_knowers"],
            "diffusion_fraction": warm["diffusion_fraction"],
            "peak_attendance": warm["peak_attendance"],
            "attendance_fraction": warm["attendance_fraction"],
            "party": warm["party"],
        },
        "believability": {
            "score": bel["believability_score"],
            "contradiction_rate": bel["contradiction_rate"],
            "items_scored": bel["items_scored"],
        },
        "cost": {
            "cold_calls_per_sim_day": cold_cost["calls_per_sim_day"],
            "warm_calls_per_sim_day": warm_cost["calls_per_sim_day"],
            "warm_cache_hit_rate": warm_cost["cache_hit_rate"],
            "reduction_pct": round(
                100 * (1 - warm_cost["calls_per_sim_day"] /
                       max(cold_cost["calls_per_sim_day"], 1e-6)), 1),
            "by_purpose": cold_cost["by_purpose"],
        },
        "believability_detail": bel["per_agent"],
    }

    out = os.path.join(_ROOT, "data", "eval_report.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print("\n" + "=" * 60)
    print("AGORA EVALUATION REPORT")
    print("=" * 60)
    e = report["emergence"]
    print(f"Agents: {report['config']['n_agents']}  |  LLM: {report['config']['llm']}"
          f"  |  Embedder: {report['config']['embedder']}")
    print(f"\nEMERGENCE (seeded 1 agent with a party intention)")
    print(f"  Information diffusion : {e['peak_knowers']}/{report['config']['n_agents']} "
          f"agents learned of the party ({e['diffusion_fraction']*100:.0f}%)")
    print(f"  Peak attendance       : {e['peak_attendance']} agents gathered at "
          f"{e['party']['location']}")
    b = report["believability"]
    print(f"\nBELIEVABILITY (interview-based)")
    print(f"  Believability score   : {b['score']}%")
    print(f"  Contradiction rate    : {b['contradiction_rate']*100:.1f}%")
    c = report["cost"]
    print(f"\nCOST / LATENCY (per simulated day)")
    print(f"  Cold cache            : {c['cold_calls_per_sim_day']} LLM calls/sim-day")
    print(f"  Warm cache            : {c['warm_calls_per_sim_day']} calls/sim-day "
          f"({c['warm_cache_hit_rate']*100:.0f}% cache hits, "
          f"{c['reduction_pct']:.0f}% fewer calls)")
    print(f"\nFull report written to data/eval_report.json")


if __name__ == "__main__":
    main()

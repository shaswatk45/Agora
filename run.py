"""Agora entrypoint -- one command to run the town in your browser.

    py -3.12 run.py                 # mock LLM (zero setup), opens the browser
    py -3.12 run.py --llm ollama --model llama3.2:3b
    py -3.12 run.py --llm openai --model gpt-4o-mini   # needs OPENAI_API_KEY

Then open http://localhost:8000 (auto-opened unless --no-open).
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import webbrowser

_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_ROOT, "src"))

from agora.config import Config          # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Run the Agora generative-agent town.")
    ap.add_argument("--llm", default="mock", choices=["mock", "ollama", "openai"],
                    help="LLM backend (default: mock, needs no setup)")
    ap.add_argument("--model", default=None, help="model name for ollama/openai")
    ap.add_argument("--embed", default="auto",
                    choices=["auto", "sentence-transformers", "hashing"])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-open", action="store_true", help="don't open a browser")
    args = ap.parse_args()

    cfg = Config()
    cfg.llm.backend = args.llm
    if args.model:
        cfg.llm.model = args.model
    cfg.embed.backend = args.embed
    cfg.llm.cache_path = os.path.join(_ROOT, "data", "llm_cache.sqlite")

    import uvicorn
    from agora.server import create_app
    app = create_app(cfg)

    url = f"http://{args.host}:{args.port}"
    print(f"\n  Agora is running at {url}")
    print(f"  LLM backend: {args.llm}  |  press Ctrl+C to stop\n")
    if not args.no_open:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

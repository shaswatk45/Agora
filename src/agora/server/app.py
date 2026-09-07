"""FastAPI server: drives the simulation and serves the browser UI.

The engine runs one tick at a time inside a background asyncio task; each tick's
snapshot is pushed to every connected WebSocket client. REST endpoints expose
the static map, per-agent introspection, metrics, recorded frames (for the
scrubber), and simulation controls.
"""
from __future__ import annotations

import asyncio
import os
from typing import Dict, List, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ..config import Config
from ..sim import Engine

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
_UI_DIR = os.path.join(_ROOT, "ui")


class SimState:
    def __init__(self, cfg: Optional[Config] = None):
        self.cfg = cfg or Config()
        self.engine = Engine(self.cfg)
        self.running = False
        self.speed = 3.0                 # ticks per second
        self.lock = asyncio.Lock()
        self.clients: Set[WebSocket] = set()

    async def step_once(self) -> Dict:
        loop = asyncio.get_running_loop()
        async with self.lock:
            # engine.step is CPU-bound (mock LLM + embeddings); keep the loop free
            await loop.run_in_executor(None, self.engine.step)
            return self.engine.snapshot()

    async def broadcast(self, payload: Dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def reset(self) -> None:
        self.engine = Engine(self.cfg)
        self.running = False


def create_app(cfg: Optional[Config] = None) -> FastAPI:
    app = FastAPI(title="Agora")
    state = SimState(cfg)

    async def sim_loop():
        while True:
            if state.running:
                snap = await state.step_once()
                await state.broadcast({"type": "state", **snap})
                await asyncio.sleep(max(0.02, 1.0 / state.speed))
            else:
                await asyncio.sleep(0.1)

    @app.on_event("startup")
    async def _startup():
        app.state.task = asyncio.create_task(sim_loop())

    # -- static UI ---------------------------------------------------------
    @app.get("/")
    async def index():
        return FileResponse(os.path.join(_UI_DIR, "index.html"))

    if os.path.isdir(_UI_DIR):
        app.mount("/ui", StaticFiles(directory=_UI_DIR), name="ui")

    # -- REST --------------------------------------------------------------
    @app.get("/api/world")
    async def world():
        return JSONResponse(state.engine.static_world())

    @app.get("/api/state")
    async def get_state():
        return JSONResponse({"running": state.running, "speed": state.speed,
                             **state.engine.snapshot()})

    @app.get("/api/agent/{agent_id}")
    async def agent(agent_id: str):
        data = state.engine.inspect(agent_id)
        if data is None:
            return JSONResponse({"error": "unknown agent"}, status_code=404)
        return JSONResponse(data)

    @app.get("/api/metrics")
    async def metrics():
        return JSONResponse(state.engine.metrics_summary())

    @app.get("/api/frames_count")
    async def frames_count():
        return JSONResponse({"count": len(state.engine.frames)})

    @app.get("/api/frames/{index}")
    async def frame(index: int):
        f = state.engine.frame_at(index)
        if f is None:
            return JSONResponse({"error": "out of range"}, status_code=404)
        return JSONResponse(f)

    @app.post("/api/control")
    async def control(cmd: Dict):
        action = cmd.get("action")
        if action == "play":
            state.running = True
        elif action == "pause":
            state.running = False
        elif action == "step":
            snap = await state.step_once()
            await state.broadcast({"type": "state", **snap})
        elif action == "speed":
            state.speed = float(cmd.get("value", 3.0))
        elif action == "seed_party":
            async with state.lock:
                state.engine.seed_party()
        elif action == "reset":
            async with state.lock:
                state.reset()
        else:
            return JSONResponse({"error": f"unknown action {action}"}, status_code=400)
        return JSONResponse({"running": state.running, "speed": state.speed,
                             **state.engine.snapshot()})

    @app.get("/api/eval")
    async def run_eval():
        from ..evaluation import believability
        async with state.lock:
            report = believability.evaluate(state.engine)
        return JSONResponse(report)

    # -- WebSocket ---------------------------------------------------------
    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        state.clients.add(websocket)
        # send an initial snapshot immediately
        await websocket.send_json({"type": "state", "running": state.running,
                                   "speed": state.speed, **state.engine.snapshot()})
        try:
            while True:
                await websocket.receive_text()   # keepalive / ignored
        except WebSocketDisconnect:
            state.clients.discard(websocket)
        except Exception:
            state.clients.discard(websocket)

    app.state.sim = state
    return app

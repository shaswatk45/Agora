/* AGORA backend shim.
   If a real Python backend is reachable (same-origin /api/world responds), this
   does nothing and the pages talk to it live. Otherwise it stands up the
   in-browser simulation (agora-sim.js) and serves the /api/* endpoints and the
   /ws stream by overriding fetch + WebSocket — so the exact same frontend runs
   with zero backend (e.g. on Vercel). */
(function () {
  "use strict";

  // ---- probe for a real backend (synchronous, one-time, at startup) ----
  let hasBackend = false;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/world", false);
    xhr.timeout = 1500;
    xhr.send(null);
    hasBackend = xhr.status === 200 && /application\/json/i.test(xhr.getResponseHeader("content-type") || "") && /"locations"/.test(xhr.responseText);
  } catch (e) { hasBackend = false; }

  window.AGORA_DEMO = !hasBackend;
  if (hasBackend) { console.log("[agora] live backend detected"); return; }
  console.log("[agora] no backend — running the in-browser simulation");

  // ---- one sim instance, driven by a ticker ----
  let sim = window.createAgoraSim();
  const clients = new Set();
  let acc = 0, lastT = performance.now();

  function pushAll() {
    const msg = JSON.stringify({ type: "state", ...sim.snapshot() });
    for (const ws of clients) ws._deliver(msg);
  }
  function tickLoop() {
    const now = performance.now(), dt = Math.min(0.5, (now - lastT) / 1000); lastT = now;
    if (sim.running) {
      acc += sim.speed * dt; let steps = 0;
      while (acc >= 1 && steps < 60) { sim.step(); acc -= 1; steps++; }
      if (steps > 0) pushAll();
    } else acc = 0;
  }
  setInterval(tickLoop, 40);   // setInterval (not rAF) so the sim keeps running when the tab is backgrounded

  // ---- fake WebSocket ----
  const NativeWS = window.WebSocket;
  class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      clients.add(this);
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({ type: "open" }); this._deliver(JSON.stringify({ type: "state", ...sim.snapshot() })); }, 0);
    }
    _deliver(data) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data }); }
    send() {}
    close() { this.readyState = 3; clients.delete(this); if (this.onclose) this.onclose({ type: "close" }); }
    addEventListener(t, cb) { if (t === "message") this.onmessage = cb; else if (t === "open") this.onopen = cb; else if (t === "close") this.onclose = cb; else if (t === "error") this.onerror = cb; }
    removeEventListener() {}
  }
  window.WebSocket = function (url, protocols) {
    try { if (String(url).replace(/^[a-z]+:\/\/[^/]+/i, "").startsWith("/ws")) return new FakeWS(url); } catch (e) {}
    return new NativeWS(url, protocols);
  };
  window.WebSocket.prototype = FakeWS.prototype;
  window.WebSocket.OPEN = 1; window.WebSocket.CLOSED = 3; window.WebSocket.CONNECTING = 0; window.WebSocket.CLOSING = 2;

  // ---- fake fetch for /api/* ----
  const nativeFetch = window.fetch.bind(window);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

  window.fetch = function (input, init) {
    let url; try { url = new URL(typeof input === "string" ? input : input.url, location.href); } catch (e) { return nativeFetch(input, init); }
    const p = url.pathname;
    if (!p.startsWith("/api/")) return nativeFetch(input, init);
    try {
      if (p === "/api/world") return Promise.resolve(json(sim.world()));
      if (p === "/api/state") return Promise.resolve(json(sim.snapshot()));
      if (p === "/api/metrics") return Promise.resolve(json(sim.snapshot().metrics));
      if (p === "/api/eval") return Promise.resolve(json(sim.evaluate()));
      if (p.startsWith("/api/agent/")) { const id = decodeURIComponent(p.slice("/api/agent/".length)); const d = sim.inspect(id); return Promise.resolve(d ? json(d) : json({ error: "unknown agent" }, 404)); }
      if (p === "/api/frames_count") return Promise.resolve(json({ count: 0 }));
      if (p.startsWith("/api/frames/")) return Promise.resolve(json({ error: "not recorded in demo" }, 404));
      if (p === "/api/control") {
        const body = init && init.body ? JSON.parse(init.body) : {};
        if (body.action === "reset") { sim = window.createAgoraSim(); acc = 0; setTimeout(pushAll, 0); return Promise.resolve(json({ running: sim.running, speed: sim.speed, ...sim.snapshot() })); }
        const res = sim.control(body.action, body.value);
        setTimeout(pushAll, 0);
        return Promise.resolve(json({ running: sim.running, speed: sim.speed, ...res }));
      }
    } catch (e) { return Promise.resolve(json({ error: String(e) }, 500)); }
    return Promise.resolve(json({ error: "not found" }, 404));
  };
})();

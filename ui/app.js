"use strict";

const $ = (s) => document.querySelector(s);
const canvas = $("#town");
const ctx = canvas.getContext("2d");

let WORLD = null;          // static map
let TILE = 20;
let framesBuffer = [];     // streamed frames for local scrubbing
let liveMode = true;
let selectedId = null;
let latest = null;         // latest snapshot (metrics, events)

// ---------------------------------------------------------------- bootstrap
async function boot() {
  WORLD = await (await fetch("/api/world")).json();
  TILE = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h);
  const st = await (await fetch("/api/state")).json();
  onState(st);
  connectWS();
  wireControls();
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") onState(msg);
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}

// ---------------------------------------------------------------- state
function onState(st) {
  latest = st;
  // buffer frame for scrubbing
  framesBuffer.push({
    clock: st.clock, agents: st.agents,
    n_knowers: st.n_knowers, at_party: st.at_party || [],
  });
  if (framesBuffer.length > 4000) framesBuffer.shift();

  const tl = $("#timeline");
  tl.max = framesBuffer.length - 1;
  if (liveMode) tl.value = framesBuffer.length - 1;

  updateMetrics(st);
  renderFeed(st.events || []);
  if (typeof st.running === "boolean") setPlayLabel(st.running);

  if (liveMode) {
    draw(framesBuffer[framesBuffer.length - 1]);
    if (selectedId) refreshInspector(selectedId);
  }
}

function updateMetrics(st) {
  const n = st.agents ? st.agents.length : 15;
  $("#m-agents").textContent = n;
  $("#m-knowers").textContent = `${st.n_knowers || 0} / ${n}`;
  $("#m-attend").textContent = (st.at_party || []).length;
  const m = st.metrics;
  if (m) {
    $("#m-calls").textContent = m.cost.calls_per_sim_day;
    $("#m-cache").textContent = Math.round(m.cost.cache_hit_rate * 100) + "%";
    $("#m-embed").textContent = m.world.embedder;
  }
  $("#clock-day").textContent = "Day " + st.clock.day;
  $("#clock-time").textContent = st.clock.hhmm;
}

// ---------------------------------------------------------------- drawing
function draw(frame) {
  if (!frame || !WORLD) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // subtle ground grid
  ctx.strokeStyle = "#141824";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD.w; x++) {
    ctx.beginPath(); ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, WORLD.h * TILE); ctx.stroke();
  }
  for (let y = 0; y <= WORLD.h; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * TILE); ctx.lineTo(WORLD.w * TILE, y * TILE); ctx.stroke();
  }

  const partyLoc = latest && latest.party ? latest.party.location : null;

  // locations
  for (const loc of WORLD.locations) {
    const px = loc.x * TILE, py = loc.y * TILE, pw = loc.w * TILE, ph = loc.h * TILE;
    ctx.fillStyle = loc.color + (loc.blocking ? "cc" : "55");
    roundRect(px, py, pw, ph, 5); ctx.fill();
    if (loc.name === partyLoc) {
      ctx.strokeStyle = "#ffd36b"; ctx.lineWidth = 2.5;
      roundRect(px, py, pw, ph, 5); ctx.stroke();
    }
    ctx.fillStyle = "#0c0e14";
    ctx.font = "600 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(loc.name, px + pw / 2, py + ph / 2 + 3);
  }

  // agents
  const attend = new Set(frame.at_party || []);
  for (const a of frame.agents) {
    const cx = a.pos[0] * TILE + TILE / 2;
    const cy = a.pos[1] * TILE + TILE / 2;
    if (attend.has(a.id)) {
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,211,107,0.25)"; ctx.fill();
    }
    if (a.id === selectedId) {
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = a.color; ctx.fill();
    ctx.strokeStyle = "#0c0e14"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "#e6e8ee"; ctx.font = "600 9px system-ui"; ctx.textAlign = "center";
    ctx.fillText(a.name, cx, cy - 10);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- feed
function renderFeed(events) {
  const list = $("#feed-list");
  list.innerHTML = "";
  for (const e of events.slice().reverse()) {
    const div = document.createElement("div");
    div.className = `feed-item kind-${e.kind}` + (e.highlight ? " highlight" : "");
    div.innerHTML = `<span class="t">D${e.day} ${e.hhmm}</span>` +
      `<span class="t2">${escapeHtml(e.text)}</span>`;
    list.appendChild(div);
  }
}

// ---------------------------------------------------------------- inspector
async function refreshInspector(id) {
  try {
    const data = await (await fetch("/api/agent/" + encodeURIComponent(id))).json();
    renderInspector(data);
  } catch (e) { /* ignore */ }
}

function renderInspector(d) {
  $("#inspector-empty").hidden = true;
  const body = $("#inspector-body");
  body.hidden = false;
  const p = d.persona;

  const plan = d.plan.map((s) => {
    const now = d.current_action && s.desc && d.current_action.startsWith(s.desc.slice(0, 12));
    return `<div class="plan-step ${now ? "now" : ""}"><span class="pt">${s.time}</span><span>${escapeHtml(s.desc)}</span></div>`;
  }).join("");

  const retrieved = d.top_retrieved.map((m) => memRow(m, true)).join("");
  const recent = d.recent_memories.map((m) => memRow(m, false)).join("");
  const reflections = (d.reflections || []).map((m) =>
    `<div class="mem"><div class="mem-text">${escapeHtml(m.text)}</div></div>`).join("")
    || `<div class="mem" style="color:var(--muted)">No reflections yet.</div>`;
  const rels = Object.entries(p.relationships || {}).map(([k, v]) =>
    `<div class="rel-item"><b>${escapeHtml(k)}</b> — ${escapeHtml(v)}</div>`).join("");

  body.innerHTML = `
    <div class="insp-name" style="color:${d.color}">${escapeHtml(p.name)}</div>
    <div class="insp-role">${escapeHtml(p.occupation)} · age ${p.age} · at ${escapeHtml(d.location || "—")}</div>

    <div class="insp-section">
      <h4>Right now</h4>
      <div class="insp-thought">${escapeHtml(d.current_action || "…")}</div>
    </div>

    <div class="insp-section">
      <h4>Today's plan</h4>
      ${plan || "<div style='color:var(--muted)'>planning…</div>"}
    </div>

    <div class="insp-section">
      <h4>Retrieved memories (why it's doing this)</h4>
      <div class="legend"><span class="rec">recency</span><span class="imp">importance</span><span class="rel">relevance</span></div>
      ${retrieved || "<div style='color:var(--muted)'>none</div>"}
    </div>

    <div class="insp-section">
      <h4>Reflections (higher-level beliefs)</h4>
      ${reflections}
    </div>

    <div class="insp-section">
      <h4>Recent memories</h4>
      ${recent}
    </div>

    <div class="insp-section">
      <h4>Relationships</h4>
      ${rels || "<div style='color:var(--muted)'>—</div>"}
    </div>

    <div class="insp-section">
      <h4>Persona</h4>
      <div style="font-size:12.5px;color:var(--muted);line-height:1.5">${escapeHtml(p.backstory)}</div>
    </div>`;
}

function memRow(m, withScore) {
  let scoreHtml = "";
  if (withScore && m.components) {
    const c = m.components;
    scoreHtml = `
      <div class="score-bars">
        <div class="bar rec" style="width:${Math.round(c.recency * 34)}px"></div>
        <div class="bar imp" style="width:${Math.round(c.importance * 34)}px"></div>
        <div class="bar rel" style="width:${Math.round(c.relevance * 34)}px"></div>
        <span class="score-total">${m.score.toFixed(2)}</span>
      </div>`;
  }
  return `<div class="mem">
      <div class="mem-text">${escapeHtml(m.text)}</div>
      <div class="mem-meta">
        <span class="badge kind-${m.kind}">${m.kind}</span>
        <span class="badge">imp ${m.importance}</span>
        ${scoreHtml}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- controls
function wireControls() {
  $("#btn-play").onclick = async () => {
    const running = $("#btn-play").dataset.running === "1";
    await control(running ? "pause" : "play");
  };
  $("#btn-step").onclick = () => control("step");
  $("#btn-seed").onclick = () => control("seed_party");
  $("#btn-reset").onclick = async () => {
    framesBuffer = []; selectedId = null;
    $("#inspector-body").hidden = true; $("#inspector-empty").hidden = false;
    await control("reset");
  };
  $("#speed").oninput = (e) => {
    $("#speed-val").textContent = e.target.value + "×";
    control("speed", Number(e.target.value));
  };
  $("#timeline").oninput = (e) => {
    liveMode = false; setLive(false);
    const f = framesBuffer[Number(e.target.value)];
    if (f) { draw(f); $("#timeline-label").textContent = `D${f.clock.day} ${f.clock.hhmm}`; }
  };
  $("#btn-live").onclick = () => {
    liveMode = true; setLive(true);
    draw(framesBuffer[framesBuffer.length - 1]);
  };
  canvas.onclick = onCanvasClick;
  $("#btn-eval").onclick = runEval;
  $("#eval-close").onclick = () => { $("#eval-modal").hidden = true; };
}

async function control(action, value) {
  const r = await fetch("/api/control", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value }),
  });
  const st = await r.json();
  if (action === "reset") { onState(st); }
  if (typeof st.running === "boolean") setPlayLabel(st.running);
}

function setPlayLabel(running) {
  const b = $("#btn-play");
  b.dataset.running = running ? "1" : "0";
  b.textContent = running ? "⏸ Pause" : "▶ Play";
}
function setLive(on) {
  const b = $("#btn-live");
  b.classList.toggle("live-on", on);
  b.textContent = on ? "● LIVE" : "○ live";
}

function onCanvasClick(ev) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
  const mx = (ev.clientX - rect.left) * scaleX;
  const my = (ev.clientY - rect.top) * scaleY;
  const frame = framesBuffer[liveMode ? framesBuffer.length - 1 : Number($("#timeline").value)];
  if (!frame) return;
  let best = null, bestD = 18 * 18;
  for (const a of frame.agents) {
    const cx = a.pos[0] * TILE + TILE / 2, cy = a.pos[1] * TILE + TILE / 2;
    const d = (cx - mx) ** 2 + (cy - my) ** 2;
    if (d < bestD) { bestD = d; best = a; }
  }
  if (best) { selectedId = best.id; refreshInspector(best.id); draw(frame); }
}

// ---------------------------------------------------------------- eval
async function runEval() {
  $("#eval-modal").hidden = false;
  $("#eval-content").innerHTML = "Interviewing every agent and scoring consistency…";
  try {
    const r = await (await fetch("/api/eval")).json();
    $("#eval-content").innerHTML = renderEval(r);
  } catch (e) {
    $("#eval-content").textContent = "Eval failed: " + e;
  }
}

function renderEval(r) {
  const rows = r.per_agent.map((a) => {
    const qa = a.qa.map((x) =>
      `<div class="eval-row"><div class="q">Q: ${escapeHtml(x.question)}</div>` +
      `<div class="a">A: ${escapeHtml(x.answer)}</div>` +
      `<div style="font-size:11px;color:var(--muted)">score ${x.score}` +
      (x.contradiction ? " · <span style='color:var(--hot)'>contradiction</span>" : "") +
      `</div></div>`).join("");
    return `<details><summary><b>${escapeHtml(a.agent)}</b> — ${(a.score * 100).toFixed(0)}%</summary>${qa}</details>`;
  }).join("");
  return `
    <div class="eval-headline">
      <div class="eval-stat"><div class="n">${r.believability_score}%</div><div class="l">believability</div></div>
      <div class="eval-stat"><div class="n">${(r.contradiction_rate * 100).toFixed(0)}%</div><div class="l">contradiction rate</div></div>
      <div class="eval-stat"><div class="n">${r.items_scored}</div><div class="l">answers scored</div></div>
    </div>
    <p style="color:var(--muted);font-size:12px">Each agent is asked about its day and answers from its retrieved memories.
    Answers are scored against what actually happened to that agent (places visited, people met, party learned of).</p>
    ${rows}`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot();

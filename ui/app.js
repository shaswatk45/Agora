/* AGORA frontend: a living town view over the simulation API.
   - WebSocket state -> tweened villager movement along walkable paths
   - procedural 2.5D town (world.js) + procedural avatars (characters.js)
   - day/night lighting, destination trails, party effects, camera, HUD, inspector */
"use strict";

const $ = (s) => document.querySelector(s);
const WORLD = window.AGORA_WORLD, CHARS = window.AGORA_CHARS;
const T = WORLD.TILE;

const canvas = $("#world");
const ctx = canvas.getContext("2d");
const skyCanvas = $("#sky");

const S = {
  model: null, cam: { x: 0, y: 0, z: 1 }, fitZ: 1,
  agents: new Map(), order: [],
  latest: null, viewClock: { minute_of_day: 480, hhmm: "08:00", day: 0 },
  frames: [], live: true, running: false, speed: 4,
  selected: null, follow: false, hoverId: null,
  smoke: [], hearts: [], confetti: [],
  feedSig: "", dpr: 1, lastT: performance.now(), atParty: new Set(), party: null,
  lastEventTick: -1,
};

// world-pixel feet position of a villager, including its crowd-spread offset
function posOf(r) { return { x: (r.rx + r.off[0]) * T + T / 2, y: (r.ry + r.off[1]) * T + T * .82 }; }

// spread villagers that share a tile into a fan below/beside it so crowds read as crowds
function computeSpread() {
  const groups = new Map();
  for (const r of S.order) { const k = r.to[0] + "," + r.to[1]; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  for (const [, g] of groups) {
    g.sort((a, b) => (a.id < b.id ? -1 : 1));
    const n = g.length;
    if (n === 1) { g[0].offT = [0, 0]; continue; }
    const ring1 = Math.min(n, 6), ring2 = n - ring1;
    g.forEach((r, i) => {
      const inR1 = i < ring1, cnt = inR1 ? ring1 : ring2, idx = inR1 ? i : i - ring1;
      const rad = inR1 ? 0.62 : 1.15;
      const ang = -0.18 * Math.PI + (1.36 * Math.PI) * ((idx + 0.5) / cnt);   // a fan: sides + below
      r.offT = [Math.cos(ang) * rad, Math.sin(ang) * rad * 0.62];
    });
  }
}

// =============================================================== boot
async function boot() {
  const world = await (await fetch("/api/world")).json();
  S.model = WORLD.build(world);
  resize(); fitCamera();
  window.addEventListener("resize", () => { resize(); });
  const st = await (await fetch("/api/state")).json();
  onState(st, true);
  connectWS();
  wireControls();
  requestAnimationFrame(loop);
  setTimeout(() => $("#hint").classList.add("gone"), 10000);
}

function resize() {
  S.dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(innerWidth * S.dpr); canvas.height = Math.floor(innerHeight * S.dpr);
  canvas.style.width = innerWidth + "px"; canvas.style.height = innerHeight + "px";
  const wpx = S.model.w * T, hpx = S.model.h * T;
  const { top, bottom } = hudPads();   // measured, so a wrapped top bar still leaves room
  S.fitZ = Math.min((innerWidth - 40) / wpx, (innerHeight - top - bottom) / hpx);
  fitCamera();
}
function hudPads() {
  const tb = document.querySelector("#topbar"), bc = document.querySelector(".hud-bc");
  const top = tb ? tb.getBoundingClientRect().bottom + 12 : 96;
  const bottom = bc ? innerHeight - bc.getBoundingClientRect().top + 12 : 64;
  return { top, bottom };
}
function fitCamera() {
  const wpx = S.model.w * T, hpx = S.model.h * T;
  const { top, bottom } = hudPads();
  S.cam.z = S.fitZ;
  const midY = (innerHeight + top - bottom) / 2;   // centre of the usable band
  S.cam.x = wpx / 2 - innerWidth / 2 / S.cam.z;
  S.cam.y = hpx / 2 - midY / S.cam.z;
}
function clampCam() {
  const wpx = S.model.w * T, hpx = S.model.h * T, m = 240;
  const vw = innerWidth / S.cam.z, vh = innerHeight / S.cam.z;
  S.cam.x = Math.max(-m, Math.min(wpx - vw + m, S.cam.x));
  S.cam.y = Math.max(-m, Math.min(hpx - vh + m, S.cam.y));
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.type === "state") onState(msg); };
  ws.onclose = () => setTimeout(connectWS, 1000);
}

// =============================================================== state
function onState(st, initial) {
  S.latest = st;
  if (typeof st.running === "boolean") { S.running = st.running; setPlayLabel(st.running); }
  if (typeof st.speed === "number") { S.speed = st.speed; $("#speed").value = st.speed; $("#speed-val").textContent = st.speed + "×"; }

  S.frames.push({ clock: st.clock, agents: st.agents, at_party: st.at_party || [], n_knowers: st.n_knowers, party: st.party, events: st.events });
  if (S.frames.length > 4000) S.frames.shift();
  const tl = $("#timeline"); tl.max = S.frames.length - 1; if (S.live) tl.value = S.frames.length - 1;

  if (S.live) applyFrame(S.frames[S.frames.length - 1], initial);
  updateMetrics(st);
  renderFeed(st.events || []);
  if (S.live && S.selected) refreshInspector(S.selected);
}

// apply a frame: tween (live) or snap (scrubbing / initial)
function applyFrame(frame, snap) {
  const now = performance.now();
  S.viewClock = frame.clock; S.party = frame.party || null;
  S.atParty = new Set(frame.at_party || []);
  const seen = new Set();
  for (const a of frame.agents) {
    seen.add(a.id);
    let rec = S.agents.get(a.id);
    if (!rec) {
      rec = { id: a.id, name: a.name, color: a.color, spec: CHARS.make(a.id, a.color, a.occupation),
              rx: a.pos[0], ry: a.pos[1], to: a.pos.slice(), seg: null, t0: 0, dur: 1, facing: "down", walk: 0, walking: false, trail: [], trailKey: "", bubble: null,
              off: [0, 0], offT: [0, 0] };
      S.agents.set(a.id, rec); S.order.push(rec);
    }
    if (snap) { rec.rx = a.pos[0]; rec.ry = a.pos[1]; rec.to = a.pos.slice(); rec.seg = null; rec.walking = false; }
    else if (rec.to[0] !== a.pos[0] || rec.to[1] !== a.pos[1]) {
      const start = [Math.round(rec.rx), Math.round(rec.ry)];
      let p = WORLD.bfs(S.model, start, a.pos);
      if (!p.length) p = [a.pos.slice()];
      rec.seg = [[rec.rx, rec.ry], ...p]; rec.t0 = now;
      rec.dur = Math.max(160, Math.min(1500, (1000 / Math.max(1, S.speed)) * 0.95));
      rec.to = a.pos.slice(); rec.walking = true;
    }
    rec.action = a.action; rec.location = a.location; rec.target = a.target; rec.targetPos = a.target_pos; rec.moving = !!a.moving; rec.occupation = a.occupation;
    const tkey = a.moving && a.target_pos ? `${a.pos}->${a.target_pos}` : "";
    if (tkey !== rec.trailKey) { rec.trailKey = tkey; rec.trail = tkey ? WORLD.bfs(S.model, a.pos, a.target_pos) : []; }
  }
  computeSpread();
  if (snap) for (const r of S.order) r.off = r.offT.slice();
  // dialogue bubbles from fresh events
  const byFirst = {}; for (const r of S.order) byFirst[r.name] = r;
  for (const e of frame.events || []) {
    if (e.kind !== "dialogue" || e.tick < frame.clock.tick - 1 || e.tick <= S.lastEventTick - 1) continue;
    const m = /^(\w+) & (\w+):/.exec(e.text); if (!m) continue;
    for (const nm of [m[1], m[2]]) { const r = byFirst[nm]; if (r) r.bubble = { until: now + 3200, hl: !!e.highlight }; }
  }
  S.lastEventTick = frame.clock.tick;
}

// =============================================================== loop
function loop(now) {
  const dt = Math.min(50, now - S.lastT); S.lastT = now;
  updateAgents(now, dt);
  if (S.follow && S.selected) {
    const r = S.agents.get(S.selected);
    if (r) { const p = posOf(r); const cx = p.x - innerWidth / S.cam.z / 2, cy = p.y - 30 - innerHeight / S.cam.z / 2; S.cam.x += (cx - S.cam.x) * 0.08; S.cam.y += (cy - S.cam.y) * 0.08; }
  }
  updateParticles(now, dt);
  render(now);
  drawSky(now);
  requestAnimationFrame(loop);
}

function updateAgents(now, dt) {
  for (const r of S.order) {
    if (r.seg) {
      const p = Math.min(1, (now - r.t0) / r.dur);
      const segs = r.seg.length - 1, f = p * segs, i = Math.min(segs - 1, Math.floor(f)), fr = f - i;
      const a = r.seg[i], b = r.seg[i + 1];
      const nx = a[0] + (b[0] - a[0]) * fr, ny = a[1] + (b[1] - a[1]) * fr;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (Math.abs(dx) + Math.abs(dy) > 0.01) r.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      r.rx = nx; r.ry = ny;
      if (p >= 1) { r.seg = null; r.walking = false; r.rx = r.to[0]; r.ry = r.to[1]; }
    }
    if (r.walking) r.walk = (r.walk + dt * 0.0038) % 1;
    // ease toward the crowd-spread slot (snap to centre while walking)
    const tx = r.seg ? 0 : r.offT[0], ty = r.seg ? 0 : r.offT[1];
    r.off[0] += (tx - r.off[0]) * Math.min(1, dt * 0.006);
    r.off[1] += (ty - r.off[1]) * Math.min(1, dt * 0.006);
  }
}

// =============================================================== render
function render(now) {
  const m = S.model, z = S.cam.z;
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  ctx.fillStyle = "#26402a"; ctx.fillRect(0, 0, innerWidth, innerHeight);
  ctx.translate(-S.cam.x * z, -S.cam.y * z); ctx.scale(z, z);

  const light = WORLD.lighting(S.viewClock.minute_of_day);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(m.static, 0, 0);

  drawTrails(now);
  drawSprites(now, light);

  // ambient tint (multiply) over the whole world
  if (light.tint[3] > 0.005) {
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(${light.tint[0] | 0},${light.tint[1] | 0},${light.tint[2] | 0},${light.tint[3]})`;
    ctx.fillRect(-400, -400, m.w * T + 800, m.h * T + 800); ctx.restore();
  }
  drawLights(now, light);
  drawOverlays(now, light);
  // fixed-size labels drawn in screen space so they stay legible at any zoom
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  drawScreenOverlays(now);
}

function drawTrails(now) {
  for (const r of S.order) {
    if (!r.trail.length || !r.moving) continue;
    const sel = r.id === S.selected;
    const p0 = posOf(r);
    const pts = [[p0.x, p0.y], ...r.trail.map(p => [p[0] * T + T / 2, p[1] * T + T * .82])];
    const k = Math.max(1, 0.55 / S.cam.z);   // keep trails/pins visible when zoomed out
    ctx.fillStyle = r.color; ctx.globalAlpha = sel ? .95 : .62;
    const step = 15 * k, rad = (sel ? 3.6 : 3.0) * k; let carry = (now / 40) % step;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; const L = Math.hypot(x1 - x0, y1 - y0); let d = carry;
      while (d < L) { const t = d / L; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rad, 0, 7); ctx.fill(); d += step; }
      carry = d - L;
    }
    ctx.globalAlpha = 1;
    // destination pin
    if (r.targetPos) {
      const px = r.targetPos[0] * T + T / 2, py = r.targetPos[1] * T + T * .3 - Math.abs(Math.sin(now / 320 + r.spec.phase0)) * 5 * k - (k - 1) * 10;
      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(px, r.targetPos[1] * T + T * .78, 6 * k, 2.5 * k, 0, 0, 7); ctx.fill();
      ctx.fillStyle = r.color; ctx.beginPath(); ctx.moveTo(px, py + 14 * k); ctx.lineTo(px - 7 * k, py + 2 * k); ctx.arc(px, py, 7.5 * k, Math.PI * .85, Math.PI * 2.15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * k; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 3 * k, 0, 7); ctx.fill();
      if (sel && r.target && S.model.locByName[r.target]) {
        const l = S.model.locByName[r.target]; const pulse = .45 + Math.sin(now / 250) * .25;
        ctx.strokeStyle = r.color; ctx.globalAlpha = pulse; ctx.lineWidth = 4; WORLD.util.rrect(ctx, l.x * T - 14, l.y * T - 8, l.w * T + 28, l.h * T + 16, 18); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }
}

function drawSprites(now, light) {
  const items = [];
  for (const t of S.model.trees) items.push({ y: WORLD.treeBase(t, T).y, k: 0, o: t });
  for (const l of S.model.lamps) items.push({ y: WORLD.lampBase(l, T).y, k: 1, o: l });
  for (const r of S.order) items.push({ y: posOf(r).y, k: 2, o: r });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.k === 0) WORLD.drawTree(ctx, it.o, T, now);
    else if (it.k === 1) WORLD.drawLamp(ctx, it.o, T, light.night);
    else {
      const r = it.o, pp = posOf(r), fx = pp.x, fy = pp.y;
      if (r.id === S.selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.globalAlpha = .55 + Math.sin(now / 200) * .25; ctx.beginPath(); ctx.ellipse(fx, fy + 1, 16, 7, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      if (S.atParty.has(r.id)) { ctx.fillStyle = "rgba(255,200,120,0.18)"; ctx.beginPath(); ctx.ellipse(fx, fy, 18, 8, 0, 0, 7); ctx.fill(); }
      CHARS.draw(ctx, r.spec, fx, fy, { facing: r.facing, walk: r.walk, moving: r.walking, time: now + r.spec.phase0 * 100, scale: Math.min(1.5, Math.max(1, 0.5 / S.cam.z)) });
    }
  }
  // chimney smoke (soft, above sprites)
  for (const p of S.smoke) { ctx.fillStyle = `rgba(230,230,235,${p.life * .35})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
}

function drawLights(now, light) {
  const n = light.night; if (n <= 0.02 && !S.party) return;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  if (n > 0.02) {
    for (const w of S.model.windows) { ctx.fillStyle = `rgba(255,190,90,${0.55 * n})`; ctx.fillRect(w.x, w.y, w.w, w.h); }
    for (const l of S.model.lamps) {
      const { x, y } = WORLD.lampBase(l, T); const g = ctx.createRadialGradient(x, y - 44, 4, x, y - 30, 78);
      g.addColorStop(0, `rgba(255,205,110,${0.42 * n})`); g.addColorStop(1, "rgba(255,190,90,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 30, 78, 0, 7); ctx.fill();
    }
    // door light spill
    for (const l of S.model.locs) if (l.blocking) { const [ax, ay] = l.anchor; const g = ctx.createRadialGradient(ax * T + T / 2, ay * T, 2, ax * T + T / 2, ay * T, 40); g.addColorStop(0, `rgba(255,200,120,${0.25 * n})`); g.addColorStop(1, "rgba(255,200,120,0)"); ctx.fillStyle = g; ctx.fillRect(ax * T - 40, ay * T - 40, T + 80, 80); }
  }
  if (S.party && S.model.locByName[S.party.location]) {
    const l = S.model.locByName[S.party.location]; const cx = (l.x + l.w / 2) * T, cy = (l.y + l.h) * T;
    const active = S.atParty.size > 0;
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, l.w * T * .9);
    const a = (active ? .28 : .12) * (0.6 + n * .6) * (0.85 + Math.sin(now / 400) * .15);
    g.addColorStop(0, `rgba(255,150,170,${a})`); g.addColorStop(1, "rgba(255,150,170,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, l.w * T * .9, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawOverlays(now, light) {
  // string lights on the party venue
  if (S.party && S.model.locByName[S.party.location]) {
    const l = S.model.locByName[S.party.location]; const y0 = l.y * T + l.h * T * .40 + 2, x0 = l.x * T - 8, x1 = (l.x + l.w) * T + 8;
    ctx.strokeStyle = "rgba(40,30,20,0.7)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, y0 + 16, x1, y0); ctx.stroke();
    const cols = ["#ff6b8a", "#ffd166", "#7ae0ff", "#b5e48c", "#ff9f43"];
    for (let i = 0, x = x0 + 10; x < x1 - 4; x += 20, i++) {
      const t = (x - x0) / (x1 - x0), y = y0 + 16 * 4 * t * (1 - t) * .5 + 5;
      const on = (Math.sin(now / 260 + i) + 1) / 2;
      ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = .55 + on * .45; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill();
      ctx.globalAlpha = on * .35; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    }
  }
  // hearts & confetti
  for (const h of S.hearts) drawHeart(h.x, h.y, h.s, `rgba(255,${120 + h.k * 60},${150 + h.k * 40},${h.life})`);
  for (const c of S.confetti) { ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.col; ctx.globalAlpha = Math.min(1, c.life * 2); ctx.fillRect(-3, -1.5, 6, 3); ctx.restore(); }
}

const hhmmOf = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

// screen-space overlays: name tags, speech bubbles and the party banner keep a fixed pixel size
function drawScreenOverlays(now) {
  const z = S.cam.z;
  const toS = (wx, wy) => [(wx - S.cam.x) * z, (wy - S.cam.y) * z];
  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  // party banner above the venue
  if (S.party && S.model.locByName[S.party.location]) {
    const l = S.model.locByName[S.party.location];
    const [bx, by] = toS((l.x + l.w / 2) * T, l.y * T - 6);
    const m = S.viewClock.minute_of_day, here = S.atParty.size;
    const label = here > 0 ? `🎉 Party at ${S.party.location} · ${here} here`
      : m < S.party.time_min ? `💌 Party at ${S.party.location} · ${hhmmOf(S.party.time_min)}` : `🎉 Party at ${S.party.location}`;
    ctx.font = "800 12px Nunito, system-ui, sans-serif";
    const tw = ctx.measureText(label).width + 22, th = 26, bob = Math.sin(now / 480) * 3, top = by - th - 12 + bob;
    ctx.fillStyle = "rgba(0,0,0,0.25)"; WORLD.util.rrect(ctx, bx - tw / 2 + 1, top + 3, tw, th, 13); ctx.fill();
    ctx.fillStyle = "rgba(255,98,140,0.95)"; WORLD.util.rrect(ctx, bx - tw / 2, top, tw, th, 13); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - 7, top + th - 1); ctx.lineTo(bx + 7, top + th - 1); ctx.lineTo(bx, top + th + 8); ctx.closePath(); ctx.fillStyle = "rgba(255,98,140,0.95)"; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(label, bx, top + th / 2 + .5);
  }

  // who is standing next to whom (for "…" bubbles)
  const adj = new Set();
  for (let i = 0; i < S.order.length; i++) for (let j = i + 1; j < S.order.length; j++) {
    const a = S.order[i], b = S.order[j];
    if (Math.max(Math.abs(a.to[0] - b.to[0]), Math.abs(a.to[1] - b.to[1])) <= 1) { adj.add(a.id); adj.add(b.id); }
  }
  for (const r of S.order) {
    const p = posOf(r); const [sx, sy] = toS(p.x, p.y);
    if (sx < -80 || sy < -80 || sx > innerWidth + 80 || sy > innerHeight + 80) continue;
    const sel = r.id === S.selected, hov = r.id === S.hoverId;
    const cs = Math.min(1.5, Math.max(1, 0.5 / z));       // villagers are drawn a bit larger when zoomed out
    const headTop = sy - 46 * z * cs;
    // when zoomed out, only label the people worth tracking (walking / selected / hovered) so crowds stay readable
    const showTag = sel || hov || z >= 0.7 || r.walking;
    let ty = headTop - 3;
    if (showTag) {
      const glyph = glyphFor(r), label = (glyph ? glyph + " " : "") + r.name;
      ctx.font = `800 ${sel ? 12 : 11}px Nunito, system-ui, sans-serif`;
      const tw = ctx.measureText(label).width + 14, th = 17, tx = sx - tw / 2; ty = headTop - th - 3;
      ctx.fillStyle = sel ? r.color : hov ? "rgba(255,255,255,0.94)" : "rgba(20,16,26,0.74)";
      WORLD.util.rrect(ctx, tx, ty, tw, th, 8); ctx.fill();
      if (sel) { ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = sel ? "#fff" : hov ? "#1d1720" : "#f4ecdf"; ctx.fillText(label, sx, ty + th / 2 + .5);
    }
    // speech bubble
    const b = r.bubble && r.bubble.until > now ? r.bubble : (adj.has(r.id) ? { hl: false } : null);
    if (b) {
      const bx = sx + 16, by = ty - 13, bw = 28, bh = 20;
      ctx.fillStyle = b.hl ? "#ffe0ea" : "#fff"; WORLD.util.rrect(ctx, bx - bw / 2, by - bh / 2, bw, bh, 9); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx - 9, by + bh / 2 - 1); ctx.lineTo(bx - 13, by + bh / 2 + 6); ctx.lineTo(bx - 3, by + bh / 2 - 1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; WORLD.util.rrect(ctx, bx - bw / 2, by - bh / 2, bw, bh, 9); ctx.stroke();
      if (b.hl) drawHeart(bx, by + 1, 5.5, "#ff5c8a");
      else { ctx.fillStyle = "#3a2f36"; const ph = Math.floor(now / 300) % 3; for (let i = 0; i < 3; i++) { ctx.globalAlpha = i <= ph ? 1 : .3; ctx.beginPath(); ctx.arc(bx - 6 + i * 6, by, 2, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
    }
  }
}

function drawHeart(x, y, s, col) {
  ctx.fillStyle = col; ctx.beginPath();
  ctx.moveTo(x, y + s * .9); ctx.bezierCurveTo(x - s * 1.6, y - s * .2, x - s * .6, y - s * 1.3, x, y - s * .4);
  ctx.bezierCurveTo(x + s * .6, y - s * 1.3, x + s * 1.6, y - s * .2, x, y + s * .9); ctx.fill();
}

function glyphFor(r) {
  const a = (r.action || "").toLowerCase();
  if (/event|party/.test(a)) return "🎉";
  if (/sleep|wind down|breakfast|wake|dinner|home/.test(a)) return "🏠";
  if (/lunch|coffee|cafe/.test(a)) return "☕";
  if (/library|read|study|research/.test(a)) return "📚";
  if (/art|paint|studio/.test(a)) return "🎨";
  if (/store|errand|shop/.test(a)) return "🛒";
  if (/park|walk|yoga|garden/.test(a)) return "🌳";
  if (/music|plaza|perform|play/.test(a)) return "🎵";
  if (/work|task|focus|teach|class/.test(a)) return "💼";
  return "";
}

// =============================================================== particles
function updateParticles(now, dt) {
  const hr = S.viewClock.minute_of_day / 60;
  // smoke
  for (const ch of S.model.chimneys) {
    const on = ch.kind === "cafe" ? (hr >= 7 && hr <= 19) : (hr < 9 || hr > 17);
    if (on && Math.random() < 0.02) S.smoke.push({ x: ch.x, y: ch.y, vx: (Math.random() - .3) * .12, vy: -.25 - Math.random() * .2, r: 3 + Math.random() * 2, life: 1 });
  }
  for (const p of S.smoke) { p.x += p.vx * dt * .1 + Math.sin(now / 500 + p.y) * .05; p.y += p.vy * dt * .1; p.r += dt * .006; p.life -= dt * .0006; }
  S.smoke = S.smoke.filter(p => p.life > 0).slice(-160);
  // party fx
  if (S.party && S.model.locByName[S.party.location]) {
    const l = S.model.locByName[S.party.location]; const m = S.viewClock.minute_of_day;
    const inWindow = m >= S.party.time_min - 60 && m <= S.party.time_min + 130;
    if (inWindow && Math.random() < 0.08) S.hearts.push({ x: (l.x + Math.random() * l.w) * T, y: (l.y + l.h * .5 + Math.random() * l.h * .6) * T, s: 3 + Math.random() * 4, k: Math.random(), life: 1, vy: -.03 - Math.random() * .03, ph: Math.random() * 6 });
    if (inWindow && S.atParty.size >= 5 && Math.random() < 0.25) S.confetti.push({ x: (l.x - .5 + Math.random() * (l.w + 1)) * T, y: l.y * T - 20, vy: .04 + Math.random() * .05, vx: (Math.random() - .5) * .04, rot: Math.random() * 6, vr: (Math.random() - .5) * .01, col: ["#ff6b8a", "#ffd166", "#7ae0ff", "#b5e48c", "#c77dff"][(Math.random() * 5) | 0], life: 1 });
  }
  for (const h of S.hearts) { h.y += h.vy * dt; h.x += Math.sin(now / 400 + h.ph) * .15; h.life -= dt * .00045; }
  S.hearts = S.hearts.filter(h => h.life > 0);
  for (const c of S.confetti) { c.y += c.vy * dt; c.x += c.vx * dt + Math.sin(now / 300 + c.rot) * .1; c.rot += c.vr * dt; c.life -= dt * .0004; }
  S.confetti = S.confetti.filter(c => c.life > 0);
}

// =============================================================== sky / clock widget
function drawSky(now) {
  const c = skyCanvas.getContext("2d"), size = 84;
  const light = WORLD.lighting(S.viewClock.minute_of_day), hr = light.hour;
  c.clearRect(0, 0, size, size);
  c.save(); c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, 7); c.clip();
  const g = c.createLinearGradient(0, 0, 0, size); g.addColorStop(0, light.sky[0]); g.addColorStop(1, light.sky[1]); c.fillStyle = g; c.fillRect(0, 0, size, size);
  if (light.night > .3) { c.fillStyle = `rgba(255,255,255,${light.night * .9})`; for (let i = 0; i < 14; i++) { const x = (i * 37 + 11) % size, y = (i * 23 + 7) % (size * .7); const tw = (Math.sin(now / 500 + i) + 1) / 2; c.globalAlpha = .3 + tw * .7; c.beginPath(); c.arc(x, y, 1 + (i % 3) * .4, 0, 7); c.fill(); } c.globalAlpha = 1; }
  // sun (6 → 19) and moon (19 → 6)
  const sunT = (hr - 6) / 13;
  if (sunT >= -0.05 && sunT <= 1.05) { const a = Math.PI + sunT * Math.PI, x = size / 2 + 30 * Math.cos(a), y = size * .66 + 26 * Math.sin(a); const gg = c.createRadialGradient(x, y, 2, x, y, 16); gg.addColorStop(0, "rgba(255,240,180,0.95)"); gg.addColorStop(.4, "rgba(255,200,90,0.7)"); gg.addColorStop(1, "rgba(255,200,90,0)"); c.fillStyle = gg; c.beginPath(); c.arc(x, y, 16, 0, 7); c.fill(); c.fillStyle = "#ffe08a"; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); }
  const moonT = ((hr >= 19 ? hr - 19 : hr + 5) / 11);
  if (light.night > .15 && moonT >= 0 && moonT <= 1) { const a = Math.PI + moonT * Math.PI, x = size / 2 + 30 * Math.cos(a), y = size * .66 + 26 * Math.sin(a); c.fillStyle = `rgba(235,240,255,${Math.min(1, light.night + .2)})`; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); c.fillStyle = light.sky[0]; c.beginPath(); c.arc(x + 3, y - 2, 5, 0, 7); c.fill(); }
  // horizon ground
  c.fillStyle = "rgba(40,70,40,0.9)"; c.beginPath(); c.ellipse(size / 2, size * .98, size * .6, size * .22, 0, 0, 7); c.fill();
  c.restore();
  $("#clock-time").textContent = S.viewClock.hhmm;
  $("#clock-day").textContent = "Day " + S.viewClock.day;
  $("#clock-period").textContent = WORLD.periodName(S.viewClock.minute_of_day);
}

// =============================================================== HUD
function updateMetrics(st) {
  const n = st.agents ? st.agents.length : 15;
  $("#m-agents").textContent = n;
  $("#m-knowers").textContent = st.n_knowers || 0;
  $("#m-knowers-bar").style.width = ((st.n_knowers || 0) / n * 100) + "%";
  $("#m-attend").textContent = (st.at_party || []).length;
  if (st.metrics) {
    $("#m-calls").textContent = Math.round(st.metrics.cost.calls_per_sim_day).toLocaleString();
    $("#m-cache").textContent = Math.round(st.metrics.cost.cache_hit_rate * 100) + "%";
  }
}

function renderFeed(events) {
  const sig = events.length ? events[events.length - 1].tick + ":" + events.length + ":" + events[events.length - 1].text.slice(0, 20) : "";
  if (sig === S.feedSig) return; S.feedSig = sig;
  const list = $("#feed-list"); list.innerHTML = "";
  for (const e of events.slice(-40).reverse()) {
    const div = document.createElement("div");
    div.className = `gz-item kind-${e.kind}` + (e.highlight ? " hl" : "");
    div.innerHTML = `<span class="t">D${e.day} ${e.hhmm}</span><span class="dot"></span><span class="tx">${esc(e.text)}</span>`;
    list.appendChild(div);
  }
}

function setPlayLabel(running) {
  const b = $("#btn-play"); b.classList.toggle("playing", running); $("#btn-play-label").textContent = running ? "Pause" : "Play";
}

// =============================================================== inspector
async function refreshInspector(id) {
  try { const d = await (await fetch("/api/agent/" + encodeURIComponent(id))).json(); if (S.selected === id) renderInspector(d); } catch (e) { /* ignore */ }
}

function renderInspector(d) {
  const p = d.persona, rec = S.agents.get(p.name);
  const body = $("#inspector-body");
  const cur = d.current_action || "";
  const nowMin = S.viewClock.minute_of_day;
  const plan = d.plan.map((s) => {
    const [hh, mm] = s.time.split(":").map(Number); const tmin = hh * 60 + mm;
    const isNow = cur && s.desc && cur.slice(0, 18) === s.desc.slice(0, 18);
    const cls = isNow ? "now" : tmin < nowMin ? "done" : "";
    const ev = /event|party/i.test(s.desc) ? " event" : "";
    return `<div class="plan-step ${cls}${ev}"><span class="pt">${s.time}</span><span>${esc(s.desc)}</span></div>`;
  }).join("");
  const retrieved = d.top_retrieved.map(memRow).join("") || `<div class="story">Nothing retrieved yet.</div>`;
  const recent = d.recent_memories.map(m => memRow(m, false)).join("");
  const refl = (d.reflections || []).slice().reverse().map(m => `<div class="refl">${esc(m.text)}</div>`).join("") || `<div class="story">No reflections yet — they form as the day's experiences accumulate.</div>`;
  const rels = Object.entries(p.relationships || {}).map(([k, v]) => { const o = S.agents.get(k); return `<div class="rel"><span class="sw" style="background:${o ? o.color : "#888"}"></span><b>${esc(k)}</b><span>— ${esc(v)}</span></div>`; }).join("");
  const going = rec && rec.moving && rec.target ? `<div class="going">Heading to <b>${esc(rec.target)}</b></div>` : (d.location ? `<div class="going">Currently at <b>${esc(d.location)}</b></div>` : "");

  body.innerHTML = `
    <div class="insp-head">
      <canvas class="insp-portrait" id="portrait"></canvas>
      <div>
        <div class="insp-name" style="color:${d.color}">${esc(p.name)}</div>
        <div class="insp-role">${esc(p.occupation)} · age ${p.age}</div>
        <div class="insp-traits">${p.traits.map(t => `<span class="chip">${esc(t)}</span>`).join("")}<span class="chip loc">🏠 ${esc(p.home)}</span></div>
      </div>
    </div>
    <div class="insp-section"><h4>Right now</h4><div class="thought">${esc(cur || "…")}</div>${going}</div>
    <div class="insp-section"><h4>Today's plan</h4><div class="plan">${plan || "<div class='story'>planning…</div>"}</div></div>
    <div class="insp-section"><h4>Why — retrieved memories</h4>
      <div class="legend"><span><i style="background:var(--sky)"></i>recency</span><span><i style="background:var(--coral)"></i>importance</span><span><i style="background:var(--mint)"></i>relevance</span></div>${retrieved}</div>
    <div class="insp-section"><h4>Reflections</h4>${refl}</div>
    <div class="insp-section"><h4>Recent memories</h4>${recent}</div>
    <div class="insp-section"><h4>Relationships</h4><div class="rel-list">${rels || "<div class='story'>—</div>"}</div></div>
    <div class="insp-section"><h4>Who they are</h4><div class="story">${esc(p.backstory)}<br/><br/><b style="color:var(--text)">Goals:</b> ${esc(p.goals.join("; "))}</div></div>
    <div class="story" style="margin-top:12px;font-size:11px">${d.memory_count} memories in stream</div>`;
  if (rec) CHARS.drawPortrait($("#portrait"), rec.spec, performance.now());
}

function memRow(m, withScore = true) {
  let bars = "";
  if (withScore && m.components) {
    const c = m.components;
    bars = `<div class="bars"><div class="b rec" style="width:${Math.round(c.recency * 34)}px"></div><div class="b imp" style="width:${Math.round(c.importance * 34)}px"></div><div class="b rel" style="width:${Math.round(c.relevance * 34)}px"></div></div><span class="score">${m.score.toFixed(2)}</span>`;
  }
  return `<div class="mem"><div class="mem-text">${esc(m.text)}</div><div class="mem-meta"><span class="badge kind-${m.kind}">${m.kind}</span><span class="badge">imp ${m.importance}</span>${bars}</div></div>`;
}

function selectAgent(id) {
  S.selected = id;
  const insp = $("#inspector");
  if (id) { insp.classList.add("open"); insp.classList.remove("closed"); refreshInspector(id); $("#hint").classList.add("gone"); }
  else { insp.classList.remove("open"); insp.classList.add("closed"); S.follow = false; $("#btn-follow").classList.remove("on"); }
}

// =============================================================== controls & input
function wireControls() {
  $("#btn-play").onclick = () => control(S.running ? "pause" : "play");
  $("#btn-step").onclick = () => control("step");
  $("#btn-seed").onclick = () => control("seed_party");
  $("#btn-reset").onclick = async () => { S.frames = []; S.agents.clear(); S.order = []; S.hearts = []; S.confetti = []; selectAgent(null); S.live = true; setLive(true); await control("reset", undefined, true); };
  $("#btn-follow").onclick = () => { if (!S.selected) return; S.follow = !S.follow; $("#btn-follow").classList.toggle("on", S.follow); };
  $("#speed").oninput = (e) => { const v = Number(e.target.value); S.speed = v; $("#speed-val").textContent = v + "×"; control("speed", v); };
  $("#timeline").oninput = (e) => { S.live = false; setLive(false); const f = S.frames[Number(e.target.value)]; if (f) { applyFrame(f, true); $("#timeline-label").textContent = `D${f.clock.day} ${f.clock.hhmm}`; S.atParty = new Set(f.at_party || []); } };
  $("#btn-live").onclick = () => { S.live = true; setLive(true); const f = S.frames[S.frames.length - 1]; if (f) applyFrame(f, true); $("#timeline").value = S.frames.length - 1; $("#timeline-label").textContent = "live"; };
  $("#insp-close").onclick = () => selectAgent(null);
  $("#gz-toggle").onclick = () => { const g = $("#gazette"); g.classList.toggle("collapsed"); $("#gz-toggle").textContent = g.classList.contains("collapsed") ? "+" : "−"; };
  $("#btn-eval").onclick = runEval;
  $("#eval-close").onclick = () => { $("#eval-modal").hidden = true; };

  // camera: drag / wheel / click
  let drag = null, moved = false;
  canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, cx: S.cam.x, cy: S.cam.y }; moved = false; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; canvas.classList.add("dragging"); S.follow = false; $("#btn-follow").classList.remove("on"); }
      S.cam.x = drag.cx - dx / S.cam.z; S.cam.y = drag.cy - dy / S.cam.z; clampCam();
    } else {
      const hit = pick(e.clientX, e.clientY); S.hoverId = hit ? hit.id : null; canvas.classList.toggle("hover-agent", !!hit);
    }
  });
  canvas.addEventListener("pointerup", (e) => { canvas.classList.remove("dragging"); if (drag && !moved) { const hit = pick(e.clientX, e.clientY); selectAgent(hit ? hit.id : null); } drag = null; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0012), nz = Math.max(S.fitZ * 0.8, Math.min(3.2, S.cam.z * f));
    const wx = e.clientX / S.cam.z + S.cam.x, wy = e.clientY / S.cam.z + S.cam.y;
    S.cam.z = nz; S.cam.x = wx - e.clientX / nz; S.cam.y = wy - e.clientY / nz; clampCam();
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const pan = 40 / S.cam.z;
    if (e.code === "Space") { e.preventDefault(); control(S.running ? "pause" : "play"); }
    else if (e.key === "f" || e.key === "F") $("#btn-follow").click();
    else if (e.key === "Escape") selectAgent(null);
    else if (e.key === "ArrowLeft") S.cam.x -= pan; else if (e.key === "ArrowRight") S.cam.x += pan;
    else if (e.key === "ArrowUp") S.cam.y -= pan; else if (e.key === "ArrowDown") S.cam.y += pan;
    else if (e.key === "0") fitCamera();
    clampCam();
  });
}

function pick(sx, sy) {
  const wx = sx / S.cam.z + S.cam.x, wy = sy / S.cam.z + S.cam.y;
  let best = null, bd = 26 * 26;
  for (const r of S.order) { const pp = posOf(r), fx = pp.x, fy = pp.y - 22; const d = (fx - wx) ** 2 + (fy - wy) ** 2; if (d < bd) { bd = d; best = r; } }
  return best;
}

async function control(action, value, apply) {
  const r = await fetch("/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, value }) });
  const st = await r.json();
  if (typeof st.running === "boolean") { S.running = st.running; setPlayLabel(st.running); }
  if (apply) onState(st, true);
}
function setLive(on) { const b = $("#btn-live"); b.classList.toggle("on", on); b.textContent = on ? "● LIVE" : "○ live"; }

// =============================================================== eval
async function runEval() {
  $("#eval-modal").hidden = false;
  $("#eval-content").innerHTML = `<span class="spinner"></span>Interviewing every villager and scoring their answers against what really happened…`;
  try { const r = await (await fetch("/api/eval")).json(); $("#eval-content").innerHTML = renderEval(r); }
  catch (e) { $("#eval-content").textContent = "Eval failed: " + e; }
}
function renderEval(r) {
  const rows = r.per_agent.map((a) => {
    const rec = S.agents.get(a.agent);
    const qa = a.qa.map((x) => `<div class="eval-row"><div class="q">Q · ${esc(x.question)}</div><div class="a">${esc(x.answer)}</div><div class="s">score ${x.score}${x.contradiction ? ' · <span class="bad">contradiction</span>' : ""}</div></div>`).join("");
    return `<details><summary><span class="sw" style="background:${rec ? rec.color : "#888"}"></span>${esc(a.agent)}<span class="pct">${(a.score * 100).toFixed(0)}%</span></summary>${qa}</details>`;
  }).join("");
  return `<div class="eval-headline">
      <div class="eval-stat good"><div class="n">${r.believability_score}%</div><div class="l">believability</div></div>
      <div class="eval-stat ${r.contradiction_rate > .1 ? "warn" : ""}"><div class="n">${(r.contradiction_rate * 100).toFixed(1)}%</div><div class="l">contradiction rate</div></div>
      <div class="eval-stat"><div class="n">${r.items_scored}</div><div class="l">answers scored</div></div></div>
    <p class="story" style="margin:0 0 12px">Each villager is asked about their day and answers from retrieved memories. Answers are scored against the places they actually visited, the people they actually met, and whether they really learned about the party.</p>${rows}`;
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

boot();

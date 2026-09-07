/* AGORA world renderer: procedural 2.5D town drawn once to an offscreen canvas,
   plus helpers (walkable grid, BFS, lighting, trees & lamps) used every frame.
   Everything here is original procedural art -- no external assets. */
"use strict";
(function () {
  const W = (window.AGORA_WORLD = {});
  const TILE = (W.TILE = 48);

  // ---------------------------------------------------------- utils
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(c) { const m = c.replace("#", ""); return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]; }
  function rgb(a) { return `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`; }
  function mix(c1, c2, t) { const a = hex(c1), b = hex(c2); return rgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  function mixRgb(c1, c2, t) { return mix(toHex(c1), toHex(c2), t); }
  function toHex(c) { if (c.startsWith("#")) return c; const m = c.match(/\d+/g).map(Number); return "#" + m.slice(0, 3).map(v => v.toString(16).padStart(2, "0")).join(""); }
  function lighten(c, t) { return mix(toHex(c), "#ffffff", t); }
  function darken(c, t) { return mix(toHex(c), "#000000", t); }
  function rrect(ctx, x, y, w, h, r) {
    const rr = Array.isArray(r) ? r : [r, r, r, r];
    ctx.beginPath();
    ctx.moveTo(x + rr[0], y);
    ctx.lineTo(x + w - rr[1], y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr[1]);
    ctx.lineTo(x + w, y + h - rr[2]); ctx.quadraticCurveTo(x + w, y + h, x + w - rr[2], y + h);
    ctx.lineTo(x + rr[3], y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr[3]);
    ctx.lineTo(x, y + rr[0]); ctx.quadraticCurveTo(x, y, x + rr[0], y);
    ctx.closePath();
  }
  W.util = { hashStr, rng, mix, lighten, darken, rrect, toHex };

  // ---------------------------------------------------------- BFS
  W.bfs = function (model, start, goal) {
    const [sx, sy] = start, [gx, gy] = goal;
    if (sx === gx && sy === gy) return [];
    if (!model.isWalkable(gx, gy)) return [];
    const w = model.w, h = model.h;
    const prev = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    const q = [sy * w + sx]; seen[q[0]] = 1;
    let head = 0, found = false;
    while (head < q.length) {
      const cur = q[head++]; const cx = cur % w, cy = (cur / w) | 0;
      if (cx === gx && cy === gy) { found = true; break; }
      const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || !model.isWalkable(nx, ny)) continue;
        seen[ni] = 1; prev[ni] = cur; q.push(ni);
      }
    }
    if (!found) return [];
    const path = []; let n = gy * w + gx;
    while (n !== sy * w + sx) { path.push([n % w, (n / w) | 0]); n = prev[n]; }
    return path.reverse();
  };

  // ---------------------------------------------------------- lighting
  // keyframes by hour: [hour, tint rgba (multiplied over the world), sky top/bottom]
  const KF = [
    [0,    [58, 72, 140, 0.66], ["#0a0f2a", "#1c2757"]],
    [4.5,  [58, 72, 140, 0.66], ["#0a0f2a", "#1c2757"]],
    [6,    [255, 165, 150, 0.36], ["#3d3f80", "#f4a27a"]],
    [7.5,  [255, 228, 200, 0.12], ["#7fb2e6", "#ffdcae"]],
    [9,    [255, 255, 255, 0.0], ["#66b0ff", "#d2ebff"]],
    [15.5, [255, 255, 255, 0.0], ["#66b0ff", "#d2ebff"]],
    [17.5, [255, 205, 150, 0.26], ["#5c8ed8", "#ffc47f"]],
    [19,   [230, 140, 150, 0.44], ["#37397c", "#ff8a6b"]],
    [20.5, [58, 72, 140, 0.66], ["#0a0f2a", "#1c2757"]],
    [24,   [58, 72, 140, 0.66], ["#0a0f2a", "#1c2757"]],
  ];
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpHex(a, b, t) { return mix(a, b, t); }
  W.lighting = function (minute) {
    const hr = ((minute % 1440) + 1440) % 1440 / 60;
    let i = 0; while (i < KF.length - 2 && hr >= KF[i + 1][0]) i++;
    const a = KF[i], b = KF[i + 1];
    const t = Math.min(1, Math.max(0, (hr - a[0]) / (b[0] - a[0] || 1)));
    const tint = [lerp(a[1][0], b[1][0], t), lerp(a[1][1], b[1][1], t), lerp(a[1][2], b[1][2], t), lerp(a[1][3], b[1][3], t)];
    // night factor: 0 by day, 1 deep night
    let night = 0;
    if (hr >= 20.5 || hr < 4.5) night = 1;
    else if (hr >= 17 && hr < 20.5) night = (hr - 17) / 3.5;
    else if (hr >= 4.5 && hr < 8) night = 1 - (hr - 4.5) / 3.5;
    return { hour: hr, tint, night: Math.min(1, Math.max(0, night)), sky: [lerpHex(a[2][0], b[2][0], t), lerpHex(a[2][1], b[2][1], t)] };
  };
  W.periodName = function (minute) {
    const h = (minute % 1440) / 60;
    if (h < 5) return "Night"; if (h < 8) return "Dawn"; if (h < 12) return "Morning";
    if (h < 17) return "Afternoon"; if (h < 20) return "Evening"; return "Night";
  };

  // ---------------------------------------------------------- model / static art
  W.build = function (world) {
    const T = TILE, w = world.w, h = world.h;
    const locs = world.locations;
    const locByName = {}; locs.forEach(l => (locByName[l.name] = l));
    const blocked = new Uint8Array(w * h);
    for (const l of locs) if (l.blocking) for (let x = l.x; x < l.x + l.w; x++) for (let y = l.y; y < l.y + l.h; y++) blocked[y * w + x] = 1;
    const model = {
      w, h, T, locs, locByName, blocked,
      isWalkable: (x, y) => x >= 0 && y >= 0 && x < w && y < h && !blocked[y * w + x],
      path: new Set(), trees: [], lamps: [], windows: [], chimneys: [], benches: [],
      locAt(x, y) { for (const l of locs) if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) return l; return null; },
    };

    // --- road network: each door to its 3 nearest doors + the plaza
    const key = (x, y) => x + "," + y;
    const anchors = locs.map(l => l.anchor);
    const plaza = locByName["Town Plaza"] ? locByName["Town Plaza"].anchor : anchors[0];
    const addPath = (a, b) => { for (const p of W.bfs(model, a, b)) model.path.add(key(p[0], p[1])); model.path.add(key(a[0], a[1])); };
    anchors.forEach((a, i) => {
      const near = anchors.map((b, j) => [Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), j]).filter(x => x[1] !== i).sort((p, q) => p[0] - q[0]).slice(0, 2);
      near.forEach(([, j]) => addPath(a, anchors[j]));
      addPath(a, plaza);
    });
    // a ring road around the plaza + park edge to make the centre feel like a square
    const inPark = (x, y) => { const p = locByName["The Park"]; return p && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h; };
    const inPlaza = (x, y) => { const p = locByName["Town Plaza"]; return p && x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h; };

    // --- trees: scattered on free grass, denser in the park
    const r = rng(hashStr("agora-trees"));
    const nearBlocked = (x, y) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; if (blocked[ny * w + nx]) return true; } return false; };
    const nearAnchor = (x, y) => anchors.some(a => Math.abs(a[0] - x) <= 1 && Math.abs(a[1] - y) <= 1);
    const taken = new Set();
    const tryTree = (x, y, type, size) => {
      if (!model.isWalkable(x, y) || model.path.has(key(x, y)) || nearBlocked(x, y) || nearAnchor(x, y) || inPlaza(x, y)) return false;
      for (const t of model.trees) if (Math.abs(t.x - x) + Math.abs(t.y - y) < 2) return false;
      model.trees.push({ x, y, type, size, seed: r() * 100, ox: (r() - .5) * 10, oy: (r() - .5) * 6 });
      taken.add(key(x, y)); return true;
    };
    // park trees
    const park = locByName["The Park"];
    if (park) {
      tryTree(park.x + 2, park.y + 1, "oak", 1.7);
      tryTree(park.x + 6, park.y + 1, "round", 1.15);
      tryTree(park.x + 1, park.y + 4, "blossom", 1.1);
      tryTree(park.x + 7, park.y + 4, "pine", 1.1);
    }
    let attempts = 0;
    while (model.trees.length < 58 && attempts++ < 4000) {
      const x = (r() * w) | 0, y = (r() * h) | 0;
      if (inPark(x, y)) continue;
      const roll = r();
      tryTree(x, y, roll < .55 ? "round" : roll < .82 ? "pine" : "blossom", .85 + r() * .4);
    }
    // --- lamps along roads, spaced out
    const pathTiles = [...model.path].map(k => k.split(",").map(Number));
    const lr = rng(hashStr("agora-lamps"));
    const shuffled = pathTiles.slice().sort(() => lr() - .5);
    for (const [x, y] of shuffled) {
      if (model.lamps.length >= 16) break;
      if (nearAnchor(x, y) || inPlaza(x, y)) continue;
      if (model.lamps.some(l => Math.abs(l.x - x) + Math.abs(l.y - y) < 6)) continue;
      // place on a grass tile beside the road so it doesn't sit in the walkway
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).find(([nx, ny]) => model.isWalkable(nx, ny) && !model.path.has(key(nx, ny)) && !nearBlocked(nx, ny) && !taken.has(key(nx, ny)));
      if (!side) continue;
      model.lamps.push({ x: side[0], y: side[1] }); taken.add(key(side[0], side[1]));
    }

    // ---------------- paint the static canvas
    const cv = document.createElement("canvas"); cv.width = w * T; cv.height = h * T;
    const ctx = cv.getContext("2d");
    paintGrass(ctx, model);
    paintOpenAreas(ctx, model);
    paintRoads(ctx, model);
    for (const l of locs) if (l.blocking) paintShadow(ctx, l, T);
    for (const l of locs) if (l.blocking) paintBuilding(ctx, l, model);
    paintDecor(ctx, model);
    model.static = cv;
    return model;
  };

  function paintGrass(ctx, m) {
    const T = m.T, W_ = m.w * T, H_ = m.h * T;
    const g = ctx.createLinearGradient(0, 0, 0, H_);
    g.addColorStop(0, "#86bf6a"); g.addColorStop(1, "#78b25f");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W_, H_);
    const r = rng(hashStr("grass"));
    // soft mottling
    for (let i = 0; i < 260; i++) {
      const x = r() * W_, y = r() * H_, rad = 40 + r() * 90;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const c = r() < .5 ? "rgba(120,180,90," : "rgba(100,160,80,";
      gg.addColorStop(0, c + (0.18 + r() * .12) + ")"); gg.addColorStop(1, c + "0)");
      ctx.fillStyle = gg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // blades
    ctx.strokeStyle = "rgba(60,120,50,0.35)"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 2600; i++) {
      const x = r() * W_, y = r() * H_;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - .5) * 3, y - 3 - r() * 3); ctx.stroke();
    }
    // little flowers
    for (let i = 0; i < 160; i++) {
      const x = r() * W_, y = r() * H_;
      ctx.fillStyle = ["#fff3a8", "#ffd6e7", "#ffffff", "#ffc78a"][(r() * 4) | 0];
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill();
    }
  }

  function paintOpenAreas(ctx, m) {
    const T = m.T;
    const park = m.locByName["The Park"], plaza = m.locByName["Town Plaza"];
    if (park) {
      const x = park.x * T, y = park.y * T, w = park.w * T, h = park.h * T;
      ctx.fillStyle = "#6faa55"; rrect(ctx, x + 4, y + 4, w - 8, h - 8, 26); ctx.fill();
      // yoga lawn
      ctx.fillStyle = "rgba(190,230,150,0.55)"; ctx.beginPath(); ctx.ellipse(x + w * .33, y + h * .58, T * 1.5, T * .95, 0, 0, 7); ctx.fill();
      // pond
      const px = x + w * .72, py = y + h * .66, pw = T * 1.7, ph = T * 1.05;
      ctx.fillStyle = "rgba(60,90,60,0.35)"; ctx.beginPath(); ctx.ellipse(px, py + 6, pw + 6, ph + 4, 0, 0, 7); ctx.fill();
      const wg = ctx.createRadialGradient(px - pw * .3, py - ph * .3, 4, px, py, pw);
      wg.addColorStop(0, "#9fd8f2"); wg.addColorStop(1, "#4d9ccb");
      ctx.fillStyle = wg; ctx.beginPath(); ctx.ellipse(px, py, pw, ph, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(px - 10 + i * 12, py - 6 + i * 8, 14 + i * 6, 5 + i * 2, 0, 0, 7); ctx.stroke(); }
      ctx.fillStyle = "#4f9a4a"; [[-.5, .2], [.3, .4], [.55, -.3]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(px + a * pw * .8, py + b * ph * .8, 6, 0, 7); ctx.fill(); });
      // flower beds
      const beds = [[x + T * 1.1, y + T * .9], [x + w - T * 1.6, y + T * .9]];
      const r = rng(11);
      for (const [bx, by] of beds) {
        ctx.fillStyle = "#6a4a30"; rrect(ctx, bx - 26, by - 14, 52, 28, 12); ctx.fill();
        for (let i = 0; i < 16; i++) { ctx.fillStyle = ["#ff6b8a", "#ffd166", "#ff9f43", "#c77dff", "#fff"][(r() * 5) | 0]; ctx.beginPath(); ctx.arc(bx - 20 + r() * 40, by - 9 + r() * 18, 3, 0, 7); ctx.fill(); }
      }
      m.benches.push({ x: x + w * .5, y: y + h * .35 }, { x: x + w * .2, y: y + h * .85 });
      paintLabel(ctx, "The Park", x + w / 2, y + 22, "rgba(255,255,255,0.92)");
    }
    if (plaza) {
      const x = plaza.x * T, y = plaza.y * T, w = plaza.w * T, h = plaza.h * T;
      ctx.fillStyle = "#d9cfbc"; rrect(ctx, x + 3, y + 3, w - 6, h - 6, 18); ctx.fill();
      ctx.strokeStyle = "rgba(120,100,80,0.18)"; ctx.lineWidth = 1;
      for (let gx = x + 3; gx < x + w - 3; gx += 24) { ctx.beginPath(); ctx.moveTo(gx, y + 3); ctx.lineTo(gx, y + h - 3); ctx.stroke(); }
      for (let gy = y + 3; gy < y + h - 3; gy += 24) { ctx.beginPath(); ctx.moveTo(x + 3, gy); ctx.lineTo(x + w - 3, gy); ctx.stroke(); }
      // stage (top)
      ctx.fillStyle = "#a4704a"; rrect(ctx, x + w * .28, y + 10, w * .44, T * .8, 6); ctx.fill();
      ctx.strokeStyle = "rgba(80,50,30,0.35)"; for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + w * .28, y + 10 + i * (T * .8 / 5)); ctx.lineTo(x + w * .72, y + 10 + i * (T * .8 / 5)); ctx.stroke(); }
      // fountain
      const cx = x + w / 2, cy = y + h * .6;
      ctx.fillStyle = "rgba(60,50,40,0.25)"; ctx.beginPath(); ctx.ellipse(cx, cy + 6, T * 1.15, T * .75, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#b8ad9a"; ctx.beginPath(); ctx.ellipse(cx, cy, T * 1.1, T * .72, 0, 0, 7); ctx.fill();
      const fg = ctx.createRadialGradient(cx, cy, 2, cx, cy, T);
      fg.addColorStop(0, "#bfe6f7"); fg.addColorStop(1, "#5aa6d3");
      ctx.fillStyle = fg; ctx.beginPath(); ctx.ellipse(cx, cy, T * .9, T * .56, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#a89d8a"; ctx.beginPath(); ctx.ellipse(cx, cy - 4, T * .32, T * .2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#8f8474"; ctx.fillRect(cx - 5, cy - 30, 10, 26);
      m.fountain = { x: cx, y: cy - 30 };
      m.benches.push({ x: x + 26, y: cy }, { x: x + w - 26, y: cy });
      paintLabel(ctx, "Town Plaza", x + w / 2, y + h - 12, "rgba(70,55,40,0.85)");
    }
  }

  function paintLabel(ctx, text, x, y, color) {
    ctx.save();
    ctx.font = "700 15px Fraunces, Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 6; ctx.fillStyle = color; ctx.fillText(text, x, y);
    ctx.restore();
  }

  function paintRoads(ctx, m) {
    const T = m.T, key = (x, y) => x + "," + y;
    const edge = "#c2ab80", inner = "#e3d2ab";
    const tiles = [...m.path].map(k => k.split(",").map(Number));
    for (const [x, y] of tiles) { ctx.fillStyle = edge; ctx.fillRect(x * T - 2, y * T - 2, T + 4, T + 4); }
    for (const [x, y] of tiles) {
      const L = m.path.has(key(x - 1, y)), R = m.path.has(key(x + 1, y)), U = m.path.has(key(x, y - 1)), D = m.path.has(key(x, y + 1));
      const ix = L ? -1 : 6, iw = T - (L ? -1 : 6) - (R ? -1 : 6), iy = U ? -1 : 6, ih = T - (U ? -1 : 6) - (D ? -1 : 6);
      ctx.fillStyle = inner; rrect(ctx, x * T + ix, y * T + iy, iw, ih, [L || U ? 0 : 8, R || U ? 0 : 8, R || D ? 0 : 8, L || D ? 0 : 8]); ctx.fill();
    }
    const r = rng(hashStr("cobbles"));
    ctx.fillStyle = "rgba(150,125,90,0.22)";
    for (const [x, y] of tiles) for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(x * T + 8 + r() * (T - 16), y * T + 8 + r() * (T - 16), 3 + r() * 3, 2 + r() * 2, r() * 3, 0, 7); ctx.fill(); }
  }

  function paintShadow(ctx, l, T) {
    ctx.fillStyle = "rgba(35,28,20,0.28)";
    rrect(ctx, l.x * T + 10, l.y * T + 14, l.w * T, l.h * T, 12); ctx.fill();
  }

  function paintBuilding(ctx, l, m) {
    const T = m.T, x = l.x * T, y = l.y * T, w = l.w * T, h = l.h * T;
    const base = l.color;
    const wallC = mix(base, "#f8f0df", 0.74), wallD = darken(wallC, 0.14);
    const roofL = lighten(base, 0.10), roofD = darken(base, 0.42), roofM = darken(base, 0.18);
    const roofH = Math.round(h * 0.40), wallY = y + roofH, wallH = h - roofH;
    const doorCol = l.anchor[0];

    // wall
    const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, wallC); g.addColorStop(1, wallD);
    ctx.fillStyle = g; rrect(ctx, x, wallY, w, wallH, [0, 0, 9, 9]); ctx.fill();
    ctx.strokeStyle = "rgba(70,45,25,0.35)"; ctx.lineWidth = 2; rrect(ctx, x, wallY, w, wallH, [0, 0, 9, 9]); ctx.stroke();
    ctx.fillStyle = "rgba(70,45,25,0.16)"; ctx.fillRect(x, y + h - 8, w, 8);

    // windows
    const winW = T * .5, winH = T * .56, winY = wallY + wallH * .26;
    for (let c = 0; c < l.w; c++) {
      if (l.x + c === doorCol) continue;
      if (l.w >= 6 && c % 2 === 0) continue;
      if (l.w === 4 && (c === 0 || c === 3) && l.kind === "home") { /* homes: keep corner windows */ }
      const cx = x + c * T + T / 2;
      paintWindow(ctx, cx - winW / 2, winY, winW, winH, m, l);
    }
    // door
    const doorW = T * .58, doorH = T * .92, dx = doorCol * T + T / 2 - doorW / 2, dy = y + h - doorH;
    ctx.fillStyle = "rgba(0,0,0,0.12)"; rrect(ctx, dx - 6, dy - 6, doorW + 12, doorH + 6, [12, 12, 0, 0]); ctx.fill();
    ctx.fillStyle = "#6b4630"; rrect(ctx, dx, dy, doorW, doorH, [10, 10, 0, 0]); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.5; rrect(ctx, dx, dy, doorW, doorH, [10, 10, 0, 0]); ctx.stroke();
    ctx.fillStyle = "#f2d38a"; ctx.beginPath(); ctx.arc(dx + doorW - 7, dy + doorH * .55, 2.2, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,235,190,0.35)"; rrect(ctx, dx + 5, dy + 6, doorW - 10, doorH * .3, 4); ctx.fill();
    // doormat on the street
    ctx.fillStyle = "rgba(140,100,70,0.45)"; rrect(ctx, dx - 4, y + h + 2, doorW + 8, 8, 3); ctx.fill();

    // kind accents on the wall
    if (l.kind === "cafe") paintAwning(ctx, x + 6, wallY + 4, w - 12, "#c8473a", "#fff3e0");
    if (l.kind === "shop") paintAwning(ctx, x + 6, wallY + 4, w - 12, "#3f8a55", "#f3fbe9");
    if (/Library/.test(l.name)) { ctx.fillStyle = lighten(wallC, .3); [dx - 16, dx + doorW + 8].forEach(px => { rrect(ctx, px, wallY + 10, 9, wallH - 10, 3); ctx.fill(); }); }
    if (/Art Studio/.test(l.name)) { const r = rng(5); ["#ff6b8a", "#4cc9f0", "#ffd166", "#b5e48c"].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + 20 + i * 30 + r() * 8, wallY + wallH - 22 + r() * 8, 5 + r() * 3, 0, 7); ctx.fill(); }); }
    if (l.kind === "home") { // window boxes
      ctx.fillStyle = "#5c8a3a"; for (let c = 0; c < l.w; c++) { if (l.x + c === doorCol) continue; const cx = x + c * T + T / 2; rrect(ctx, cx - winW / 2 - 3, winY + winH - 2, winW + 6, 6, 2); ctx.fill(); }
      const r = rng(hashStr(l.name)); for (let c = 0; c < l.w; c++) { if (l.x + c === doorCol) continue; const cx = x + c * T + T / 2; for (let i = 0; i < 4; i++) { ctx.fillStyle = ["#ff7aa2", "#ffd36b", "#ff9f43"][(r() * 3) | 0]; ctx.beginPath(); ctx.arc(cx - winW / 2 + 4 + r() * (winW - 8), winY + winH - 3, 2.2, 0, 7); ctx.fill(); } }
    }

    // roof
    const rx = x - 10, ry = y - 4, rw = w + 20, rh = roofH + 12;
    ctx.fillStyle = "rgba(0,0,0,0.18)"; rrect(ctx, rx, ry + 6, rw, rh, [16, 16, 4, 4]); ctx.fill();
    const rg = ctx.createLinearGradient(0, ry, 0, ry + rh); rg.addColorStop(0, roofL); rg.addColorStop(.6, roofM); rg.addColorStop(1, roofD);
    ctx.fillStyle = rg; rrect(ctx, rx, ry, rw, rh, [16, 16, 4, 4]); ctx.fill();
    ctx.save(); rrect(ctx, rx, ry, rw, rh, [16, 16, 4, 4]); ctx.clip();
    ctx.strokeStyle = "rgba(0,0,0,0.13)"; ctx.lineWidth = 1.2;
    for (let yy = ry + 12; yy < ry + rh; yy += 11) { ctx.beginPath(); ctx.moveTo(rx, yy); ctx.lineTo(rx + rw, yy); ctx.stroke(); }
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(rx + 8, ry + 4); ctx.lineTo(rx + rw - 8, ry + 4); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(40,25,15,0.35)"; ctx.lineWidth = 2; rrect(ctx, rx, ry, rw, rh, [16, 16, 4, 4]); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(rx, ry + rh - 6, rw, 6);
    // roof accents
    if (l.kind === "home" || l.kind === "cafe") {
      const chx = x + w * .74, chy = y - 16;
      ctx.fillStyle = "#8b5a44"; ctx.fillRect(chx, chy, 15, 30); ctx.fillStyle = "#6e4535"; ctx.fillRect(chx - 2, chy - 4, 19, 6);
      m.chimneys.push({ x: chx + 7, y: chy - 4, kind: l.kind });
    }
    if (l.kind === "civic") { // bell cupola + flag
      const cx = x + w / 2; ctx.fillStyle = lighten(wallC, .2); rrect(ctx, cx - 14, y - 22, 28, 26, 4); ctx.fill();
      ctx.fillStyle = roofD; ctx.beginPath(); ctx.moveTo(cx - 18, y - 22); ctx.lineTo(cx, y - 40); ctx.lineTo(cx + 18, y - 22); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e0b64a"; ctx.beginPath(); ctx.arc(cx, y - 8, 5, 0, 7); ctx.fill();
      ctx.strokeStyle = "#5a4a3a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 14, y - 2); ctx.lineTo(x + 14, y - 44); ctx.stroke();
      ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.moveTo(x + 15, y - 44); ctx.lineTo(x + 36, y - 38); ctx.lineTo(x + 15, y - 32); ctx.closePath(); ctx.fill();
    }
    if (/Art Studio/.test(l.name)) { ctx.fillStyle = "rgba(190,230,255,0.85)"; rrect(ctx, x + w * .58, y + 8, w * .3, roofH * .45, 5); ctx.fill(); ctx.strokeStyle = "rgba(40,25,15,0.4)"; ctx.stroke(); }
    if (/Library/.test(l.name)) { ctx.fillStyle = "rgba(255,255,255,0.18)"; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + w * (.25 + i * .25), y + roofH * .5, 7, 0, 7); ctx.fill(); } }

    // sign plaque under the eave
    paintSign(ctx, l.name, doorCol * T + T / 2, wallY + 14, l.kind);
  }

  function paintWindow(ctx, x, y, w, h, m, l) {
    ctx.fillStyle = "#f7efdc"; rrect(ctx, x - 3, y - 3, w + 6, h + 6, 4); ctx.fill();
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, "#cfe8f7"); g.addColorStop(.5, "#9fc7e6"); g.addColorStop(1, "#7fb0d8");
    ctx.fillStyle = g; rrect(ctx, x, y, w, h, 3); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 4, y + h - 4); ctx.lineTo(x + w - 4, y + 4); ctx.stroke();
    ctx.strokeStyle = "rgba(90,70,50,0.45)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
    m.windows.push({ x, y, w, h, loc: l.name });
  }

  function paintAwning(ctx, x, y, w, c1, c2) {
    const hgt = 16, stripe = 13;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, hgt + 8); ctx.clip();
    for (let sx = x, i = 0; sx < x + w; sx += stripe, i++) { ctx.fillStyle = i % 2 ? c2 : c1; ctx.fillRect(sx, y, stripe, hgt); }
    ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.fillRect(x, y + hgt - 4, w, 4);
    for (let sx = x, i = 0; sx < x + w; sx += stripe, i++) { ctx.fillStyle = i % 2 ? c2 : c1; ctx.beginPath(); ctx.arc(sx + stripe / 2, y + hgt, stripe / 2, 0, Math.PI); ctx.fill(); }
    ctx.restore();
  }

  function paintSign(ctx, name, cx, y, kind) {
    ctx.save();
    ctx.font = "700 11px Fraunces, Georgia, serif";
    const tw = ctx.measureText(name).width + 18, th = 18;
    const x = cx - tw / 2;
    ctx.fillStyle = "rgba(0,0,0,0.2)"; rrect(ctx, x + 1, y + 2, tw, th, 6); ctx.fill();
    ctx.fillStyle = kind === "home" ? "#f3e6cf" : "#3a2a20"; rrect(ctx, x, y, tw, th, 6); ctx.fill();
    ctx.strokeStyle = kind === "home" ? "rgba(90,60,40,0.5)" : "rgba(255,220,160,0.55)"; ctx.lineWidth = 1.2; rrect(ctx, x, y, tw, th, 6); ctx.stroke();
    ctx.fillStyle = kind === "home" ? "#4a3428" : "#ffe3b0"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(name, cx, y + th / 2 + .5);
    ctx.restore();
  }

  function paintDecor(ctx, m) {
    for (const b of m.benches) {
      ctx.fillStyle = "rgba(0,0,0,0.18)"; rrect(ctx, b.x - 16, b.y + 3, 32, 10, 3); ctx.fill();
      ctx.fillStyle = "#9c6b45"; rrect(ctx, b.x - 16, b.y - 4, 32, 9, 3); ctx.fill();
      ctx.fillStyle = "#7a5033"; rrect(ctx, b.x - 16, b.y - 10, 32, 5, 2); ctx.fill();
      ctx.fillStyle = "#4a3a2a"; ctx.fillRect(b.x - 13, b.y + 5, 3, 6); ctx.fillRect(b.x + 10, b.y + 5, 3, 6);
    }
    // bushes near a few buildings
    const r = rng(hashStr("bushes"));
    for (const l of m.locs) {
      if (!l.blocking) continue;
      const T = m.T; const y = (l.y + l.h) * T + 6;
      [l.x * T + 6, (l.x + l.w) * T - 20].forEach(bx => {
        if (r() < .35) return;
        ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(bx + 7, y + 8, 12, 5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = "#4f9a4a"; ctx.beginPath(); ctx.arc(bx, y + 2, 8, 0, 7); ctx.arc(bx + 10, y, 9, 0, 7); ctx.arc(bx + 18, y + 3, 7, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.beginPath(); ctx.arc(bx + 8, y - 3, 4, 0, 7); ctx.fill();
      });
    }
  }

  // ---------------------------------------------------------- dynamic sprites
  W.treeBase = (t, T) => ({ x: t.x * T + T / 2 + t.ox, y: t.y * T + T * .82 + t.oy });
  W.drawTree = function (ctx, t, T, time) {
    const { x, y } = W.treeBase(t, T);
    const s = t.size, sway = Math.sin(time / 1100 + t.seed) * 1.6;
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(x + 3, y + 2, 15 * s, 6 * s, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#7a5233"; rrect(ctx, x - 3.5 * s, y - 16 * s, 7 * s, 17 * s, 2); ctx.fill();
    if (t.type === "pine") {
      const cols = ["#2f6b3e", "#3b7f49", "#4a9457"];
      for (let i = 0; i < 3; i++) { const yy = y - 14 * s - i * 13 * s, ww = (24 - i * 5) * s; ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.moveTo(x - ww + sway * .3, yy); ctx.lineTo(x + sway * (i + 1) * .5, yy - 20 * s); ctx.lineTo(x + ww + sway * .3, yy); ctx.closePath(); ctx.fill(); }
      return;
    }
    const pal = t.type === "blossom" ? ["#d96b8f", "#ef8fb0", "#f7b3cc"] : t.type === "oak" ? ["#3e7d3a", "#529a48", "#6fb45f"] : ["#4b8f42", "#5fa852", "#79bf67"];
    const R = (t.type === "oak" ? 20 : 15) * s, cy = y - 24 * s;
    ctx.fillStyle = pal[0]; ctx.beginPath(); ctx.arc(x + sway * .4, cy + 4, R, 0, 7); ctx.fill();
    ctx.fillStyle = pal[1]; ctx.beginPath(); ctx.arc(x - R * .35 + sway * .6, cy - 3, R * .8, 0, 7); ctx.arc(x + R * .4 + sway * .6, cy - 1, R * .75, 0, 7); ctx.fill();
    ctx.fillStyle = pal[2]; ctx.beginPath(); ctx.arc(x - R * .2 + sway * .8, cy - R * .5, R * .5, 0, 7); ctx.fill();
    if (t.type === "blossom") { ctx.fillStyle = "rgba(255,255,255,0.75)"; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.3 + t.seed) * R * .7 + sway * .8, cy + Math.sin(i * 1.7 + t.seed) * R * .6, 1.8, 0, 7); ctx.fill(); } }
    ctx.strokeStyle = "rgba(20,40,20,0.25)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + sway * .4, cy + 4, R, 0, 7); ctx.stroke();
  };

  W.lampBase = (l, T) => ({ x: l.x * T + T / 2, y: l.y * T + T * .8 });
  W.drawLamp = function (ctx, l, T, night) {
    const { x, y } = W.lampBase(l, T);
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 7, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#3b3a44"; ctx.fillRect(x - 2, y - 40, 4, 40); rrect(ctx, x - 6, y - 4, 12, 5, 2); ctx.fill();
    ctx.fillStyle = "#2c2b33"; rrect(ctx, x - 7, y - 50, 14, 12, 3); ctx.fill();
    ctx.fillStyle = night > .2 ? `rgba(255,214,120,${0.55 + night * .45})` : "#d8d3c4"; rrect(ctx, x - 5, y - 48, 10, 8, 2); ctx.fill();
  };
})();

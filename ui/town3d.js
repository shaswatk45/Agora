/* AGORA 3D — a walkable low-poly town rendered with three.js (no bundler).
   Town geometry comes from /api/world; villagers are driven live over /ws.
   Walk it in first- or third-person; walk up to anyone and press E to read
   their mind. Seed the party and watch the news spread, then the cafe bloom. */
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const $ = (s) => document.querySelector(s);
const API = location.origin;

// ------------------------------------------------------------------ helpers
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const lerp = (a, b, t) => a + (b - a) * t;
function col(hex) { return new THREE.Color(hex); }
function mixC(a, b, t) { return a.clone().lerp(b, t); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ state
const S = {
  world: null, W: 40, H: 30,
  agents: new Map(), order: [],
  clock: { minute_of_day: 480, hhmm: "08:00", day: 0 }, party: null,
  atParty: new Set(), knowers: new Set(),
  running: false, speed: 4, selected: null,
  view: "fp", // fp | tp
  events: [], feedSig: "",
  hearts: [],
};

// ------------------------------------------------------------------ three basics
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$("#app").appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.style.position = "fixed";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.pointerEvents = "none";
labelRenderer.domElement.style.zIndex = "5";
$("#app").appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);

// lights
const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x4a6a45, 0.8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
const sc = 30; sun.shadow.camera.left = -sc; sun.shadow.camera.right = sc; sun.shadow.camera.top = sc; sun.shadow.camera.bottom = -sc;
sun.shadow.bias = -0.0004; scene.add(sun); scene.add(sun.target);
const amb = new THREE.AmbientLight(0xffffff, 0.25); scene.add(amb);

// stars (night)
const starGeo = new THREE.BufferGeometry();
{ const N = 600, p = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const r = 120 + Math.random() * 80, th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.5; p[i * 3] = Math.cos(th) * Math.sin(ph) * r; p[i * 3 + 1] = Math.cos(ph) * r * 0.9 + 20; p[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r; } starGeo.setAttribute("position", new THREE.BufferAttribute(p, 3)); }
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, transparent: true, opacity: 0 })); scene.add(stars);

const worldGroup = new THREE.Group(); scene.add(worldGroup);
const emissiveWindows = []; const lampGlows = []; let partyGlow = null, partyLight = null;

// ------------------------------------------------------------------ world build
function W2X(tx) { return tx - S.W / 2; }
function W2Z(ty) { return ty - S.H / 2; }

function buildWorld(world) {
  S.world = world; S.W = world.w; S.H = world.h;
  const W = world.w, H = world.h;

  // ground
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x7bb65f, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 20, H + 20), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 0); ground.receiveShadow = true;
  worldGroup.add(ground);
  // subtle mottle rings
  for (let i = 0; i < 40; i++) { const r = 2 + Math.random() * 5; const m = new THREE.Mesh(new THREE.CircleGeometry(r, 12), new THREE.MeshStandardMaterial({ color: Math.random() < .5 ? 0x74ad57 : 0x84c169, roughness: 1, transparent: true, opacity: .5 })); m.rotation.x = -Math.PI / 2; m.position.set((Math.random() - .5) * W, 0.01, (Math.random() - .5) * H); worldGroup.add(m); }

  const blocked = []; // world AABBs for collision
  const byName = {}; world.locations.forEach(l => byName[l.name] = l);

  // paths: connect each door to plaza + 2 nearest, draw as flat ribbons
  const anchors = world.locations.map(l => ({ n: l.name, a: l.anchor }));
  const plaza = byName["Town Plaza"].anchor;
  const drawn = new Set();
  const drawPath = (a, b) => {
    const key = a.join() + "|" + b.join(); if (drawn.has(key)) return; drawn.add(key);
    const ax = W2X(a[0] + .5), az = W2Z(a[1] + .5), bx = W2X(b[0] + .5), bz = W2Z(b[1] + .5);
    const len = Math.hypot(bx - ax, bz - az); const g = new THREE.Mesh(new THREE.PlaneGeometry(1.6, len), new THREE.MeshStandardMaterial({ color: 0xdcc79a, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.rotation.z = -Math.atan2(bz - az, bx - ax) - Math.PI / 2; g.position.set((ax + bx) / 2, 0.02, (az + bz) / 2); g.receiveShadow = true; worldGroup.add(g);
  };
  anchors.forEach((o, i) => {
    const near = anchors.map((p, j) => [Math.hypot(o.a[0] - p.a[0], o.a[1] - p.a[1]), j]).filter(x => x[1] !== i).sort((p, q) => p[0] - q[0]).slice(0, 2);
    near.forEach(([, j]) => drawPath(o.a, anchors[j].a)); drawPath(o.a, plaza);
  });

  // buildings + open areas
  for (const l of world.locations) {
    const cx = W2X(l.x + l.w / 2), cz = W2Z(l.y + l.h / 2);
    if (!l.blocking) { buildOpenArea(l, cx, cz); continue; }
    const base = col(l.color);
    const wall = mixC(base, col(0xffffff), 0.62), roof = mixC(base, col(0x000000), 0.28);
    const kind = l.kind, hgt = kind === "home" ? 2.3 : kind === "civic" ? 3.0 : 2.7;
    // walls
    const b = new THREE.Mesh(new THREE.BoxGeometry(l.w - 0.3, hgt, l.h - 0.3), new THREE.MeshStandardMaterial({ color: wall, roughness: .9 }));
    b.position.set(cx, hgt / 2, cz); b.castShadow = true; b.receiveShadow = true; worldGroup.add(b);
    // roof (pyramid)
    const roofH = 1.1; const rf = new THREE.Mesh(new THREE.ConeGeometry(Math.max(l.w, l.h) * 0.82, roofH, 4), new THREE.MeshStandardMaterial({ color: roof, roughness: .8 }));
    rf.position.set(cx, hgt + roofH / 2 - 0.05, cz); rf.rotation.y = Math.PI / 4; rf.castShadow = true; worldGroup.add(rf);
    // door on south (facing +z, toward anchor)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.12), new THREE.MeshStandardMaterial({ color: 0x5b3b28, roughness: .7 }));
    door.position.set(W2X(l.anchor[0] + .5), 0.7, cz + (l.h - 0.3) / 2 + 0.02); worldGroup.add(door);
    // windows (emissive)
    const winMat = new THREE.MeshStandardMaterial({ color: 0xbfe0f2, emissive: 0xffcf7a, emissiveIntensity: 0, roughness: .4, metalness: .1 });
    const rows = [cz - (l.h - .3) / 2 - 0.01, cz + (l.h - .3) / 2 + 0.01];
    for (let wx = -(l.w) / 2 + 1; wx <= (l.w) / 2 - 1; wx += 1.4) {
      for (const face of [0, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.7), winMat);
        w.position.set(cx + wx, hgt * 0.55, rows[face]); if (face === 0) w.rotation.y = Math.PI;
        worldGroup.add(w); emissiveWindows.push(w);
      }
      // side windows
      for (const sxi of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.7), winMat); w.position.set(cx + sxi * ((l.w - .3) / 2 + 0.01), hgt * 0.55, cz + wx * 0.6); w.rotation.y = sxi * Math.PI / 2; worldGroup.add(w); emissiveWindows.push(w); }
    }
    // sign label
    const sign = document.createElement("div"); sign.className = "plabel"; sign.textContent = l.name;
    const so = new CSS2DObject(sign); so.position.set(cx, hgt + roofH + 0.5, cz); so.userData.always = true; worldGroup.add(so);
    // awning accent for cafe/shop
    if (kind === "cafe" || kind === "shop") { const aw = new THREE.Mesh(new THREE.BoxGeometry(l.w - 0.3, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: kind === "cafe" ? 0xc8473a : 0x3f8a55 })); aw.position.set(cx, hgt * 0.72, cz + (l.h - 0.3) / 2 + 0.3); worldGroup.add(aw); }
    blocked.push({ x0: cx - (l.w - .3) / 2, x1: cx + (l.w - .3) / 2, z0: cz - (l.h - .3) / 2, z1: cz + (l.h - .3) / 2 });
    if (kind === "cafe") S.cafeCenter = new THREE.Vector3(cx, 0, cz);
  }

  scatterTrees(world, blocked);
  addLamps(world);
  S.blocked = blocked;

  // party glow (hidden until seeded)
  partyGlow = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshBasicMaterial({ color: 0xff8db0, transparent: true, opacity: 0 }));
  partyGlow.rotation.x = -Math.PI / 2; partyGlow.position.y = 0.03; scene.add(partyGlow);
  partyLight = new THREE.PointLight(0xff9ec4, 0, 22, 2); partyLight.position.set(0, 4, 0); scene.add(partyLight);
}

function buildOpenArea(l, cx, cz) {
  const isPark = l.kind === "park";
  const patch = new THREE.Mesh(new THREE.PlaneGeometry(l.w - 0.2, l.h - 0.2), new THREE.MeshStandardMaterial({ color: isPark ? 0x69a94f : 0xd6ccb6, roughness: 1 }));
  patch.rotation.x = -Math.PI / 2; patch.position.set(cx, 0.015, cz); patch.receiveShadow = true; worldGroup.add(patch);
  if (isPark) {
    // pond
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1.4, 24), new THREE.MeshStandardMaterial({ color: 0x4d9ccb, roughness: .2, metalness: .3 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(cx + l.w * .28, 0.03, cz + l.h * .22); worldGroup.add(pond);
    tree(cx - l.w * .3, cz - l.h * .2, 1.5, "oak"); tree(cx + l.w * .1, cz - l.h * .28, 1.2, "blossom"); tree(cx - l.w * .1, cz + l.h * .25, 1.3, "round");
  } else {
    // fountain
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.4, 20), new THREE.MeshStandardMaterial({ color: 0xb8ad9a })); base.position.set(cx, 0.2, cz); base.castShadow = true; worldGroup.add(base);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0x7fc4e8, roughness: .2, metalness: .3, emissive: 0x1a4a66, emissiveIntensity: .2 })); water.position.set(cx, 0.42, cz); worldGroup.add(water);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7), new THREE.MeshStandardMaterial({ color: 0x9f9484 })); stem.position.set(cx, 0.75, cz); worldGroup.add(stem);
  }
  const sign = document.createElement("div"); sign.className = "plabel"; sign.textContent = l.name;
  const so = new CSS2DObject(sign); so.position.set(cx, 2.2, cz); so.userData.always = true; worldGroup.add(so);
}

function tree(x, z, s, type) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.0 * s, 6), new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 1 })); trunk.position.y = 0.5 * s; trunk.castShadow = true; g.add(trunk);
  const pal = type === "blossom" ? 0xef8fb0 : type === "oak" ? 0x3e7d3a : 0x4b8f42;
  const fol = new THREE.Mesh(type === "pine" ? new THREE.ConeGeometry(0.7 * s, 1.6 * s, 7) : new THREE.SphereGeometry(0.8 * s, 8, 7), new THREE.MeshStandardMaterial({ color: pal, roughness: .9, flatShading: true }));
  fol.position.y = (type === "pine" ? 1.4 : 1.5) * s; fol.castShadow = true; g.add(fol);
  if (type !== "pine") { const f2 = new THREE.Mesh(new THREE.SphereGeometry(0.55 * s, 8, 6), new THREE.MeshStandardMaterial({ color: mixC(col(pal), col(0xffffff), .18), roughness: .9, flatShading: true })); f2.position.set(0.3 * s, 1.9 * s, 0.1 * s); g.add(f2); }
  g.position.set(x, 0, z); worldGroup.add(g); return g;
}

function scatterTrees(world, blocked) {
  const inBlocked = (x, z) => blocked.some(b => x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1);
  let n = 0, tries = 0;
  while (n < 46 && tries++ < 2000) {
    const x = (Math.random() - .5) * (world.w + 8), z = (Math.random() - .5) * (world.h + 8);
    if (inBlocked(x, z)) continue;
    const t = Math.random(); tree(x, z, 0.8 + Math.random() * 0.5, t < .5 ? "round" : t < .8 ? "pine" : "blossom"); n++;
  }
}

function addLamps(world) {
  const spots = [[10, 8], [22, 8], [10, 18], [22, 18], [30, 8], [16, 26], [6, 26], [26, 26], [34, 18]];
  for (const [tx, ty] of spots) {
    const x = W2X(tx), z = W2Z(ty); const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x33323c })); post.position.y = 1.1; post.castShadow = true; g.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe6ad, emissive: 0xffcf7a, emissiveIntensity: 0 })); bulb.position.y = 2.25; g.add(bulb);
    g.position.set(x, 0, z); worldGroup.add(g); lampGlows.push(bulb);
  }
}

// ------------------------------------------------------------------ characters
function makeChar(agent) {
  const g = new THREE.Group();
  const accent = new THREE.Color(agent.color || "#" + ((hash(agent.id) & 0xffffff).toString(16).padStart(6, "0")));
  const skinList = [0xf7dcc0, 0xeec19c, 0xd9a274, 0xb97f58, 0x8d5a3c]; const skin = new THREE.Color(skinList[hash(agent.id) % skinList.length]);
  const hairList = [0x2a1b13, 0x4b2f1f, 0x7d4a25, 0xd9b56b, 0xa8433a, 0x1a1a1e]; const hair = new THREE.Color(hairList[(hash(agent.id) >> 3) % hairList.length]);
  // legs (pivoted for walk)
  const legMat = new THREE.MeshStandardMaterial({ color: 0x384a5c, roughness: .9 });
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.4, 3, 6), legMat); legL.position.set(-0.13, 0.35, 0); legL.castShadow = true; g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.13; g.add(legR);
  // body
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 4, 8), new THREE.MeshStandardMaterial({ color: accent, roughness: .8 })); body.position.y = 0.95; body.castShadow = true; g.add(body);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 12), new THREE.MeshStandardMaterial({ color: skin, roughness: .85 })); head.position.y = 1.42; head.castShadow = true; g.add(head);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.265, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: hair, roughness: 1, flatShading: true })); hairM.position.y = 1.45; g.add(hairM);
  // knower ring at feet
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
  // selection ring
  const sel = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })); sel.rotation.x = -Math.PI / 2; sel.position.y = 0.03; g.add(sel);
  // label
  const el = document.createElement("div"); el.className = "label"; el.textContent = agent.name;
  const label = new CSS2DObject(el); label.position.set(0, 2.0, 0); g.add(label);
  scene.add(g);
  return { id: agent.id, name: agent.name, color: accent, g, legL, legR, body, ring, sel, labelEl: el,
    x: W2X(agent.pos[0] + .5), z: W2Z(agent.pos[1] + .5), tx: W2X(agent.pos[0] + .5), tz: W2Z(agent.pos[1] + .5),
    yaw: 0, phase: Math.random() * 6, moving: false, target: agent.target, targetPos: agent.target_pos,
    arc: null };
}

function applyAgents(list) {
  // group agents sharing a tile so crowds fan out instead of stacking
  const groups = new Map();
  for (const a of list) { const k = a.pos[0] + "," + a.pos[1]; (groups.get(k) || groups.set(k, []).get(k)).push(a); }
  const offset = {};
  for (const [, g] of groups) {
    g.sort((p, q) => (p.id < q.id ? -1 : 1));
    if (g.length === 1) { offset[g[0].id] = [0, 0]; continue; }
    g.forEach((a, i) => { const ring = i < 6 ? 0 : 1, cnt = ring === 0 ? Math.min(6, g.length) : g.length - 6, idx = ring === 0 ? i : i - 6, rad = ring === 0 ? 0.85 : 1.6, ang = (2 * Math.PI) * ((idx + 0.5) / cnt); offset[a.id] = [Math.cos(ang) * rad, Math.sin(ang) * rad]; });
  }
  for (const a of list) {
    let r = S.agents.get(a.id);
    if (!r) { r = makeChar(a); S.agents.set(a.id, r); S.order.push(r); }
    const off = offset[a.id] || [0, 0];
    r.tx = W2X(a.pos[0] + .5) + off[0]; r.tz = W2Z(a.pos[1] + .5) + off[1];
    r.moving = !!a.moving; r.target = a.target; r.targetPos = a.target_pos; r.action = a.action; r.location = a.location; r.occupation = a.occupation;
  }
}

function updateChars(dt, now) {
  for (const r of S.order) {
    const dx = r.tx - r.x, dz = r.tz - r.z, d = Math.hypot(dx, dz);
    const speed = 3.2; // units/sec
    if (d > 0.02) {
      const step = Math.min(d, speed * dt); r.x += dx / d * step; r.z += dz / d * step;
      r.yaw = lerp(r.yaw, Math.atan2(dx, dz), 0.2); r.walking = true;
    } else r.walking = false;
    r.g.position.set(r.x, 0, r.z); r.g.rotation.y = r.yaw;
    // walk anim
    if (r.walking) { r.phase += dt * 9; const sw = Math.sin(r.phase) * 0.5; r.legL.rotation.x = sw; r.legR.rotation.x = -sw; r.body.position.y = 0.95 + Math.abs(Math.sin(r.phase)) * 0.04; }
    else { r.legL.rotation.x *= 0.8; r.legR.rotation.x *= 0.8; r.body.position.y = 0.95 + Math.sin(now / 700 + r.phase) * 0.015; }
    // knower / selected rings
    const isK = S.knowers.has(r.id); r.ring.material.opacity = isK ? 0.55 + Math.sin(now / 300) * 0.2 : 0;
    r.labelEl.classList.toggle("knower", isK);
    const isSel = S.selected === r.id; r.sel.material.opacity = isSel ? 0.7 : 0; r.labelEl.classList.toggle("sel", isSel);
    // destination arc for selected
    if (isSel && r.moving && r.targetPos) drawArc(r); else if (r.arc) { r.arc.visible = false; }
  }
}

function drawArc(r) {
  const bx = W2X(r.targetPos[0] + .5), bz = W2Z(r.targetPos[1] + .5);
  const mid = new THREE.Vector3((r.x + bx) / 2, 1.6, (r.z + bz) / 2);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(r.x, 0.4, r.z), mid, new THREE.Vector3(bx, 0.4, bz));
  const pts = curve.getPoints(24);
  if (!r.arc) { r.arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: r.color, transparent: true, opacity: .8 })); scene.add(r.arc); }
  r.arc.geometry.setFromPoints(pts); r.arc.visible = true;
}

// ------------------------------------------------------------------ day / night
function lighting(min) {
  const hr = ((min % 1440) + 1440) % 1440 / 60;
  let night = 0;
  if (hr >= 20.5 || hr < 4.5) night = 1; else if (hr >= 17 && hr < 20.5) night = (hr - 17) / 3.5; else if (hr >= 4.5 && hr < 8) night = 1 - (hr - 4.5) / 3.5;
  night = clamp(night, 0, 1);
  const dawn = clamp(1 - Math.abs(hr - 6.5) / 2, 0, 1), dusk = clamp(1 - Math.abs(hr - 18.5) / 2, 0, 1);
  return { hr, night, warm: Math.max(dawn, dusk) };
}
const cDay = col(0x9ec9ff), cNight = col(0x0c1330), cWarm = col(0xffb27a);
function updateSky(min) {
  const L = lighting(min);
  let sky = mixC(cDay, cNight, L.night); sky = mixC(sky, cWarm, L.warm * 0.5);
  scene.background = sky; if (!scene.fog) scene.fog = new THREE.Fog(sky, 30, 90); else { scene.fog.color.copy(sky); }
  sun.intensity = lerp(1.7, 0.05, L.night); sun.color.copy(mixC(col(0xfff2d6), col(0xffb27a), L.warm));
  hemi.intensity = lerp(0.85, 0.25, L.night); amb.intensity = lerp(0.28, 0.12, L.night);
  // sun position on an arc
  const t = clamp((L.hr - 6) / 12, -0.1, 1.1), ang = Math.PI * (1 - t);
  sun.position.set(Math.cos(ang) * 40, Math.max(2, Math.sin(ang) * 45), 12); sun.target.position.set(0, 0, 0);
  stars.material.opacity = L.night;
  const em = L.night; for (const w of emissiveWindows) w.material.emissiveIntensity = em * 0.9;
  for (const b of lampGlows) b.material.emissiveIntensity = em * 1.1;
}

// ------------------------------------------------------------------ party fx
function updateParty(dt, now) {
  if (!S.party || !S.cafeCenter) { if (partyGlow) partyGlow.material.opacity = 0; if (partyLight) partyLight.intensity = 0; return; }
  const here = S.atParty.size; const active = here > 0;
  partyGlow.position.set(S.cafeCenter.x, 0.03, S.cafeCenter.z);
  partyGlow.material.opacity = (active ? 0.35 : 0.12) * (0.7 + Math.sin(now / 400) * 0.3);
  partyLight.position.set(S.cafeCenter.x, 4, S.cafeCenter.z); partyLight.intensity = active ? 2.4 + Math.sin(now / 300) : 0.4;
  // hearts
  const inWindow = S.party && S.clock.minute_of_day >= S.party.time_min - 60 && S.clock.minute_of_day <= S.party.time_min + 130;
  if (inWindow && Math.random() < 0.5) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff6f91 }));
    h.position.set(S.cafeCenter.x + (Math.random() - .5) * 6, 2.5, S.cafeCenter.z + (Math.random() - .5) * 4); h.userData.vy = 0.4 + Math.random() * 0.4; h.userData.life = 1; scene.add(h); S.hearts.push(h);
  }
  for (const h of S.hearts) { h.position.y += h.userData.vy * dt; h.userData.life -= dt * 0.3; h.material.opacity = clamp(h.userData.life, 0, 1); h.material.transparent = true; h.scale.setScalar(clamp(h.userData.life, 0.2, 1)); }
  S.hearts = S.hearts.filter(h => { if (h.userData.life <= 0) { scene.remove(h); return false; } return true; });
}

// ------------------------------------------------------------------ player controller
const player = { pos: new THREE.Vector3(0, 0, 6), yaw: Math.PI, pitch: -0.05, vel: new THREE.Vector3(), keys: {}, locked: false };
const avatar = new THREE.Group(); // third-person body
{ const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0xffd36b, roughness: .7 })); b.position.y = 1.0; b.castShadow = true; avatar.add(b); const h = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), new THREE.MeshStandardMaterial({ color: 0xf7dcc0 })); h.position.y = 1.5; avatar.add(h); avatar.visible = false; scene.add(avatar); }

function collide(p) {
  const R = 0.45;
  for (const b of S.blocked || []) { if (p.x > b.x0 - R && p.x < b.x1 + R && p.z > b.z0 - R && p.z < b.z1 + R) {
    const dl = p.x - (b.x0 - R), dr = (b.x1 + R) - p.x, dt = p.z - (b.z0 - R), db = (b.z1 + R) - p.z;
    const m = Math.min(dl, dr, dt, db); if (m === dl) p.x = b.x0 - R; else if (m === dr) p.x = b.x1 + R; else if (m === dt) p.z = b.z0 - R; else p.z = b.z1 + R;
  } }
  const bx = S.W / 2 + 4, bz = S.H / 2 + 4; p.x = clamp(p.x, -bx, bx); p.z = clamp(p.z, -bz, bz);
}

function updatePlayer(dt) {
  if (S._spectate) { camera.position.copy(S._spectate.pos); camera.lookAt(S._spectate.look); avatar.visible = false; return; }
  const run = player.keys["shift"] ? 1.9 : 1; const sp = 5.2 * run * dt;
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const move = new THREE.Vector3();
  if (player.keys["w"]) move.add(fwd); if (player.keys["s"]) move.sub(fwd);
  if (player.keys["d"]) move.add(right); if (player.keys["a"]) move.sub(right);
  if (move.lengthSq() > 0) { move.normalize().multiplyScalar(sp); player.pos.add(move); collide(player.pos); }

  if (S.view === "fp") {
    camera.position.set(player.pos.x, 1.7, player.pos.z);
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, "YXZ"));
    avatar.visible = false;
  } else {
    avatar.visible = true; avatar.position.copy(player.pos); avatar.rotation.y = player.yaw + Math.PI;
    const dist = 5.5, h = 3.0;
    const off = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)).multiplyScalar(-dist);
    camera.position.set(player.pos.x + off.x, 1.5 + h + player.pitch * -3, player.pos.z + off.z);
    camera.lookAt(player.pos.x, 1.6, player.pos.z);
  }
}

// ------------------------------------------------------------------ input
const canvas = renderer.domElement;
addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["input", "textarea"].includes((e.target.tagName || "").toLowerCase())) return;
  if (k === " ") { e.preventDefault(); control(S.running ? "pause" : "play"); return; }
  if (k === "shift") player.keys["shift"] = true;
  if (["w", "a", "s", "d"].includes(k)) player.keys[k] = true;
  if (k === "e") inspectNearest();
  if (k === "v") toggleView();
  if (k === "escape") { if (S.selected) selectAgent(null); }
});
addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); if (k === "shift") player.keys["shift"] = false; if (["w", "a", "s", "d"].includes(k)) player.keys[k] = false; });

canvas.addEventListener("click", () => { if (!player.locked) canvas.requestPointerLock(); else clickInspect(); });
document.addEventListener("pointerlockchange", () => { player.locked = document.pointerLockElement === canvas; $("#cross").classList.toggle("on", player.locked); if (player.locked) { $("#enter").hidden = true; setTimeout(() => $("#hint").classList.add("gone"), 8000); } });
document.addEventListener("mousemove", (e) => { if (!player.locked) return; player.yaw -= e.movementX * 0.0022; player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.2, 1.2); });

function inspectNearest() {
  let best = null, bd = 3.0 * 3.0;
  for (const r of S.order) { const d = (r.x - player.pos.x) ** 2 + (r.z - player.pos.z) ** 2; if (d < bd) { bd = d; best = r; } }
  if (best) selectAgent(best.id);
}
const ray = new THREE.Raycaster();
function clickInspect() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const meshes = []; for (const r of S.order) r.g.traverse(o => { if (o.isMesh) { o.userData.aid = r.id; meshes.push(o); } });
  const hit = ray.intersectObjects(meshes, false)[0];
  if (hit && hit.distance < 30) selectAgent(hit.object.userData.aid); else inspectNearest();
}

// ------------------------------------------------------------------ data
async function connect() {
  const world = await (await fetch(API + "/api/world")).json();
  buildWorld(world);
  const st = await (await fetch(API + "/api/state")).json(); onState(st);
  // find a nice spawn: near the plaza
  const pz = world.locations.find(l => l.name === "Town Plaza"); if (pz) player.pos.set(W2X(pz.x + pz.w / 2), 0, W2Z(pz.y + pz.h) + 3);
  $("#load").hidden = true;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "state") onState(m); };
  ws.onclose = () => setTimeout(connect0, 1200);
}
function connect0() { const proto = location.protocol === "https:" ? "wss" : "ws"; const ws = new WebSocket(`${proto}://${location.host}/ws`); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "state") onState(m); }; ws.onclose = () => setTimeout(connect0, 1200); }

function onState(st) {
  S.clock = st.clock; S.party = st.party; S.speed = st.speed ?? S.speed; if (typeof st.running === "boolean") { S.running = st.running; $("#b-play").textContent = st.running ? "⏸ Pause" : "▶ Play"; }
  S.atParty = new Set(st.at_party || []);
  applyAgents(st.agents);
  // knowers: agents whose memory has the party -> approximated by at_party + those the events mention; simplest: use n_knowers by marking via events
  updateKnowers(st);
  S.events = st.events || []; renderFeed();
  // metrics
  const n = st.agents.length; $("#m-agents").textContent = n; $("#m-know").textContent = st.n_knowers || 0;
  $("#m-know-bar").style.width = ((st.n_knowers || 0) / n * 100) + "%";
  $("#m-party").textContent = (st.at_party || []).length;
  if (st.metrics) $("#m-calls").textContent = Math.round(st.metrics.cost.calls_per_sim_day).toLocaleString();
  if (S.selected) refreshInspector(S.selected);
}

// derive knower set from the gazette (party-spread lines name both people)
function updateKnowers(st) {
  if (!st.party) { S.knowers.clear(); return; }
  const first = {}; for (const r of S.order) first[r.name] = r.id;
  // host always knows
  const host = st.party.host; S.knowers.add(host);
  for (const e of st.events || []) {
    if (!/party/i.test(e.text)) continue;
    const m = /^(\w+) & (\w+):/.exec(e.text); if (m) { if (first[m[1]]) S.knowers.add(first[m[1]]); if (first[m[2]]) S.knowers.add(first[m[2]]); }
  }
  for (const id of st.at_party || []) S.knowers.add(id);
}

async function control(action, value) {
  const r = await fetch(API + "/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, value }) });
  const st = await r.json(); onState(st);
}

// ------------------------------------------------------------------ HUD
function renderFeed() {
  const sig = S.events.length ? S.events[S.events.length - 1].tick + ":" + S.events.length : "";
  if (sig === S.feedSig) return; S.feedSig = sig;
  const list = $("#gaz-list"); list.innerHTML = "";
  for (const e of S.events.slice(-30).reverse()) { const d = document.createElement("div"); d.className = "gi kind-" + e.kind + (e.highlight ? " hl" : ""); d.innerHTML = `<span class="t">D${e.day} ${e.hhmm}</span><span class="d"></span><span class="x">${esc(e.text)}</span>`; list.appendChild(d); }
}

function drawSky() {
  const c = $("#sky").getContext("2d"), s = 48; const L = lighting(S.clock.minute_of_day);
  c.clearRect(0, 0, s, s); c.save(); c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, 7); c.clip();
  const g = c.createLinearGradient(0, 0, 0, s); const top = L.night > .5 ? "#0c1330" : L.warm > .4 ? "#5c6bd8" : "#66b0ff", bot = L.night > .5 ? "#1c2757" : L.warm > .4 ? "#ffb27a" : "#d2ebff";
  g.addColorStop(0, top); g.addColorStop(1, bot); c.fillStyle = g; c.fillRect(0, 0, s, s);
  const t = clamp((L.hr - 6) / 12, 0, 1), a = Math.PI + t * Math.PI, x = s / 2 + 15 * Math.cos(a), y = s * .62 + 13 * Math.sin(a);
  if (L.night < .6) { c.fillStyle = "#ffe08a"; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); } else { c.fillStyle = "#eef"; c.beginPath(); c.arc(x, y, 4.5, 0, 7); c.fill(); }
  c.restore();
  $("#c-time").textContent = S.clock.hhmm; $("#c-day").textContent = "Day " + S.clock.day;
  const hr = S.clock.minute_of_day / 60; $("#c-period").textContent = hr < 5 ? "Night" : hr < 8 ? "Dawn" : hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : hr < 20 ? "Evening" : "Night";
}

// ------------------------------------------------------------------ inspector
async function refreshInspector(id) { try { const d = await (await fetch(API + "/api/agent/" + encodeURIComponent(id))).json(); if (S.selected === id) renderInspector(d); } catch (e) { } }
function selectAgent(id) { S.selected = id; const el = $("#insp"); if (id) { el.classList.add("open"); refreshInspector(id); } else el.classList.remove("open"); }

function renderInspector(d) {
  const p = d.persona, r = S.agents.get(p.name), color = "#" + (r ? r.color.getHexString() : "888");
  const nowMin = S.clock.minute_of_day, cur = d.current_action || "";
  const plan = d.plan.map(s => { const [h, m] = s.time.split(":").map(Number); const tm = h * 60 + m; const isNow = cur && s.desc && cur.slice(0, 16) === s.desc.slice(0, 16); const ev = /event|party/i.test(s.desc) ? " event" : ""; return `<div class="pstep ${isNow ? "now" : tm < nowMin ? "done" : ""}${ev}"><span class="pt">${s.time}</span><span>${esc(s.desc)}</span></div>`; }).join("");
  const mem = (arr, sc = true) => arr.map(m => { let bars = ""; if (sc && m.components) { const c = m.components; bars = `<div class="bars"><div class="b rec" style="width:${Math.round(c.recency * 30)}px"></div><div class="b imp" style="width:${Math.round(c.importance * 30)}px"></div><div class="b rel" style="width:${Math.round(c.relevance * 30)}px"></div></div><span class="score">${m.score.toFixed(2)}</span>`; } return `<div class="mem"><div class="tx">${esc(m.text)}</div><div class="mt"><span class="badge kind-${m.kind}">${m.kind}</span><span class="badge">imp ${m.importance}</span>${bars}</div></div>`; }).join("");
  const refl = (d.reflections || []).slice().reverse().map(m => `<div class="refl">${esc(m.text)}</div>`).join("") || `<div class="story">No reflections yet.</div>`;
  const rels = Object.entries(p.relationships || {}).map(([k, v]) => { const o = S.agents.get(k); return `<div class="rel"><span class="sw" style="background:${o ? "#" + o.color.getHexString() : "#888"}"></span><b>${esc(k)}</b><span>— ${esc(v)}</span></div>`; }).join("");
  const going = r && r.moving && r.target ? `<div class="going">Heading to <b>${esc(r.target)}</b></div>` : (d.location ? `<div class="going">At <b>${esc(d.location)}</b></div>` : "");
  const mono = p.name.split(" ").map(w => w[0]).join("").slice(0, 2);
  $("#insp-body").innerHTML = `
    <div class="ihead"><div class="iav" style="background:linear-gradient(135deg,${color},#0008)">${mono}</div>
      <div><div class="iname" style="color:${color}">${esc(p.name)}</div><div class="irole">${esc(p.occupation)} · age ${p.age}</div>
      <div class="chips">${p.traits.map(t => `<span class="chip">${esc(t)}</span>`).join("")}<span class="chip loc">🏠 ${esc(p.home)}</span></div></div></div>
    <div class="sec"><h4>Right now</h4><div class="thought">${esc(cur || "…")}</div>${going}</div>
    <div class="sec"><h4>Today's plan</h4><div class="plan">${plan}</div></div>
    <div class="sec"><h4>Why — retrieved memories</h4><div class="legend"><span><i style="background:var(--sky)"></i>recency</span><span><i style="background:#ff8c69"></i>importance</span><span><i style="background:var(--mint)"></i>relevance</span></div>${mem(d.top_retrieved)}</div>
    <div class="sec"><h4>Reflections</h4>${refl}</div>
    <div class="sec"><h4>Recent</h4>${mem(d.recent_memories, false)}</div>
    <div class="sec"><h4>Relationships</h4>${rels || "<div class='story'>—</div>"}</div>
    <div class="sec"><h4>Who they are</h4><div class="story">${esc(p.backstory)}<br><br><b style="color:var(--text)">Goals:</b> ${esc(p.goals.join("; "))}</div></div>`;
}

function toggleView() { S.view = S.view === "fp" ? "tp" : "fp"; $("#b-view").textContent = S.view === "fp" ? "👁 1st" : "👁 3rd"; }

// ------------------------------------------------------------------ wire HUD
$("#b-play").onclick = () => control(S.running ? "pause" : "play");
$("#b-step").onclick = () => control("step");
$("#b-seed").onclick = () => control("seed_party");
$("#b-reset").onclick = () => { S.knowers.clear(); control("reset"); };
$("#b-view").onclick = toggleView;
$("#speed").oninput = (e) => { $("#speed-v").textContent = e.target.value + "×"; control("speed", Number(e.target.value)); };
$("#insp-x").onclick = () => selectAgent(null);
$("#gaz-t").onclick = () => { const g = $("#gaz"); g.classList.toggle("collapsed"); $("#gaz-t").textContent = g.classList.contains("collapsed") ? "+" : "−"; };
$("#enter").onclick = () => canvas.requestPointerLock();

addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight); });

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ------------------------------------------------------------------ loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updatePlayer(dt);
  updateChars(dt, now);
  updateSky(S.clock.minute_of_day);
  updateParty(dt, now);
  drawSky();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(loop);
}

connect().then(() => requestAnimationFrame(loop)).catch(err => { $("#load").innerHTML = `<div class="t">Couldn't reach the backend</div><div class="s">Run <code>py -3.12 run.py</code> and reload.<br>${esc(String(err))}</div>`; });

// debug hook (for testing / screenshots without pointer lock)
window.T3 = { player, S, camera, control, selectAgent, setView: (v) => { S.view = v; },
  spectate: (px, py, pz, lx, ly, lz) => { S._spectate = { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) }; },
  unspectate: () => { S._spectate = null; } };

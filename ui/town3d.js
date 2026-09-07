/* AGORA 3D — a walkable low-poly town (three.js, no bundler).
   Town geometry is built from /api/world; villagers are driven live over /ws.
   Everything is procedural: textures are painted to canvases, buildings and
   people are assembled from primitives, vegetation is instanced. */
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as BGU from "three/addons/utils/BufferGeometryUtils.js";

const $ = (s) => document.querySelector(s);
const API = location.origin;

// ============================================================ helpers
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const C = (h) => new THREE.Color(h);
const mixC = (a, b, t) => a.clone().lerp(b, t);
const R = rng(1234);

// ============================================================ quality
const QUALITY = localStorage.getItem("agora3d.quality") || "high";
const HI = QUALITY === "high";

// ============================================================ state
const S = {
  world: null, W: 40, H: 30, locs: [], byName: {}, blocked: [], circles: [],
  agents: new Map(), order: [],
  clock: { minute_of_day: 480, hhmm: "08:00", day: 0 }, party: null,
  atParty: new Set(), knowers: new Set(), events: [], feedSig: "", lastEventTick: -1,
  running: false, speed: 4, selected: null, view: "fp",
  hearts: [], confetti: [], smoke: [], lastLoc: null, toastT: 0,
  nearest: null, soundOn: false,
};

// ============================================================ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(HI ? Math.min(2, devicePixelRatio) : 1);
renderer.shadowMap.enabled = HI; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
$("#app").appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: "fixed", top: "0", pointerEvents: "none", zIndex: "5" });
$("#app").appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 600);

let composer = null, bloom = null;
if (HI) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.65, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

// lights
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x5b7a4a, 0.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d2, 1.8);
sun.castShadow = HI; sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
const sc = 34; Object.assign(sun.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc });
sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.02; scene.add(sun); scene.add(sun.target);
const moon = new THREE.DirectionalLight(0x8fa8ff, 0); scene.add(moon);
const amb = new THREE.AmbientLight(0xffffff, 0.3); scene.add(amb);

// ============================================================ procedural textures
function canvasTex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {};
function buildTextures() {
  TEX.grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#6fae55"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const x = R() * w, y = R() * h, r = 10 + R() * 40; const gg = g.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, R() < .5 ? "rgba(120,185,90,.35)" : "rgba(95,155,75,.35)"); gg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gg; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.strokeStyle = "rgba(55,110,45,.45)"; g.lineWidth = 1.2; for (let i = 0; i < 900; i++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 3, y - 3 - R() * 4); g.stroke(); }
    g.strokeStyle = "rgba(160,210,120,.35)"; for (let i = 0; i < 400; i++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 2, y - 2 - R() * 3); g.stroke(); }
    for (let i = 0; i < 26; i++) { g.fillStyle = ["#fff3a8", "#ffd6e7", "#ffffff", "#ffc78a"][(R() * 4) | 0]; g.beginPath(); g.arc(R() * w, R() * h, 1.6, 0, 7); g.fill(); }
  });
  TEX.cobble = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#b8a684"; g.fillRect(0, 0, w, h);
    const n = 6, cw = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const ox = (y % 2) * cw / 2; const px = x * cw + ox + 3 + (R() - .5) * 3, py = y * cw + 3 + (R() - .5) * 3, pw = cw - 6, ph = cw - 6;
      const shade = 200 + R() * 40; g.fillStyle = `rgb(${shade + 10},${shade - 5},${shade - 35})`;
      g.beginPath(); g.roundRect(px, py, pw, ph, 8); g.fill();
      g.fillStyle = "rgba(255,255,255,.18)"; g.beginPath(); g.roundRect(px + 3, py + 3, pw - 6, ph * .4, 6); g.fill();
    }
  });
  TEX.shingle = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "#c9c9c9"; g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let r = 0; r < rows; r++) { const off = (r % 2) * 8; for (let x = -16; x < w; x += 16) { g.fillStyle = `rgba(${190 + R() * 40},${190 + R() * 40},${190 + R() * 40},1)`; g.beginPath(); g.roundRect(x + off, r * rh, 15, rh + 2, [0, 0, 5, 5]); g.fill(); } g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, r * rh + rh - 2, w, 2); }
  });
  TEX.plaster = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "#f2ecdf"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = R() < .5 ? "rgba(0,0,0,.035)" : "rgba(255,255,255,.06)"; g.fillRect(R() * w, R() * h, 2, 2); }
  });
  TEX.wood = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = "#8a5a3c"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) { g.fillStyle = `rgba(0,0,0,${.06 + R() * .08})`; g.fillRect(0, y, w, 2); }
    g.strokeStyle = "rgba(60,35,20,.35)"; for (let i = 0; i < 40; i++) { g.beginPath(); const y = R() * h; g.moveTo(0, y); g.bezierCurveTo(w * .3, y + (R() - .5) * 6, w * .7, y + (R() - .5) * 6, w, y); g.stroke(); }
  });
  TEX.water = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#5fb0dc"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) { g.beginPath(); const y = R() * h; g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / 18 + i) * 4); g.stroke(); }
  }, [2, 2]);
  TEX.awningRed = canvasTex(128, 32, (g, w, h) => { for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? "#fff3e0" : "#c8473a"; g.fillRect(x, 0, 16, h); } }, [4, 1]);
  TEX.awningGreen = canvasTex(128, 32, (g, w, h) => { for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? "#f3fbe9" : "#3f8a55"; g.fillRect(x, 0, 16, h); } }, [4, 1]);
  TEX.blade = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); for (let i = 0; i < 5; i++) { g.strokeStyle = `rgba(${70 + R() * 40},${150 + R() * 50},${60 + R() * 30},1)`; g.lineWidth = 3; g.beginPath(); const x = 10 + i * 11; g.moveTo(x, h); g.quadraticCurveTo(x + (R() - .5) * 10, h * .5, x + (R() - .5) * 16, 4 + R() * 10); g.stroke(); } });
  TEX.blade.wrapS = TEX.blade.wrapT = THREE.ClampToEdgeWrapping;
  TEX.flower = canvasTex(32, 32, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#fff"; for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; g.beginPath(); g.arc(16 + Math.cos(a) * 7, 16 + Math.sin(a) * 7, 6, 0, 7); g.fill(); } g.fillStyle = "#ffd76b"; g.beginPath(); g.arc(16, 16, 4.5, 0, 7); g.fill(); });
  TEX.blob = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); const gg = g.createRadialGradient(64, 64, 4, 64, 64, 60); gg.addColorStop(0, "rgba(255,255,255,1)"); gg.addColorStop(.5, "rgba(255,255,255,.45)"); gg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gg; g.fillRect(0, 0, w, h); });
  TEX.sunTex = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); const gg = g.createRadialGradient(64, 64, 2, 64, 64, 64); gg.addColorStop(0, "rgba(255,250,225,1)"); gg.addColorStop(.18, "rgba(255,230,150,.95)"); gg.addColorStop(.45, "rgba(255,200,110,.35)"); gg.addColorStop(1, "rgba(255,180,90,0)"); g.fillStyle = gg; g.fillRect(0, 0, w, h); });
  TEX.moonTex = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#eef1ff"; g.beginPath(); g.arc(32, 32, 20, 0, 7); g.fill(); g.fillStyle = "rgba(200,205,230,.6)"; [[24, 26, 4], [38, 36, 3], [30, 40, 2.5]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }); });
  TEX.dots = canvasTex(64, 40, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#fff"; g.beginPath(); g.roundRect(2, 2, 60, 30, 12); g.fill(); g.beginPath(); g.moveTo(14, 31); g.lineTo(8, 39); g.lineTo(22, 31); g.fill(); g.fillStyle = "#3a2f36"; [18, 32, 46].forEach(x => { g.beginPath(); g.arc(x, 17, 3.5, 0, 7); g.fill(); }); });
  TEX.heart = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#ff5c8a"; g.beginPath(); g.moveTo(32, 56); g.bezierCurveTo(4, 36, 8, 8, 32, 22); g.bezierCurveTo(56, 8, 60, 36, 32, 56); g.fill(); });
  TEX.heart.wrapS = TEX.heart.wrapT = TEX.dots.wrapS = TEX.dots.wrapT = TEX.flower.wrapS = TEX.flower.wrapT = THREE.ClampToEdgeWrapping;
}
function signTex(text, dark = true) {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = dark ? "#3a2a20" : "#f3e6cf"; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 10); g.fill();
    g.strokeStyle = dark ? "rgba(255,220,160,.7)" : "rgba(90,60,40,.6)"; g.lineWidth = 3; g.stroke();
    g.fillStyle = dark ? "#ffe3b0" : "#4a3428"; g.font = "700 26px Fraunces, Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 1);
  });
}

// ============================================================ sky
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: C(0x5aa6ff) }, bottom: { value: C(0xcfe6ff) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: C(0xfff0d2) }, glow: { value: 1 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vW;
    void main(){ vec3 d = normalize(vW); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.55));
      float s = max(dot(d, normalize(sunDir)), 0.0); c += sunCol * pow(s, 32.0) * glow * 1.4; c += sunCol * pow(s, 4.0) * glow * 0.16;
      gl_FragColor = vec4(c, 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), skyMat); scene.add(sky);
let sunSprite, moonSprite, stars, clouds = [];
function buildSky() {
  sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.sunTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sunSprite.scale.setScalar(70); scene.add(sunSprite);
  moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.moonTex, transparent: true, depthWrite: false })); moonSprite.scale.setScalar(22); scene.add(moonSprite);
  const N = 900, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const th = R() * 6.283, ph = R() * 1.45; const r = 380; p[i * 3] = Math.cos(th) * Math.sin(ph) * r; p[i * 3 + 1] = Math.cos(ph) * r; p[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(p, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, sizeAttenuation: true, fog: false })); scene.add(stars);
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.blob, transparent: true, depthWrite: false, opacity: 0.55, fog: false }));
    const a = R() * 6.283, d = 90 + R() * 120; sp.position.set(Math.cos(a) * d, 48 + R() * 22, Math.sin(a) * d);
    sp.scale.set(40 + R() * 50, 16 + R() * 12, 1); sp.userData.v = 0.6 + R() * 0.8; scene.add(sp); clouds.push(sp);
  }
}

// ============================================================ world
const W2X = (tx) => tx - S.W / 2, W2Z = (ty) => ty - S.H / 2;
const worldGroup = new THREE.Group(); scene.add(worldGroup);
const glowWindows = [], porchLights = [], lampBulbs = [], lampLights = [], chimneys = [];
let waterMats = [];

function buildWorld(world) {
  S.world = world; S.W = world.w; S.H = world.h; S.locs = world.locations; world.locations.forEach(l => S.byName[l.name] = l);
  const W = world.w, H = world.h;

  // ground + hills
  TEX.grass.repeat.set(18, 15);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, H + 40), new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; worldGroup.add(ground);
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283 + R(); const d = W / 2 + 22 + R() * 14; const hill = new THREE.Mesh(new THREE.SphereGeometry(10 + R() * 9, 14, 10), new THREE.MeshStandardMaterial({ color: mixC(C(0x6fae55), C(0x4f8a45), R() * .6), roughness: 1, flatShading: true })); hill.position.set(Math.cos(a) * d, -6 - R() * 3, Math.sin(a) * d); hill.scale.y = 0.55 + R() * 0.3; worldGroup.add(hill); }

  // paths
  const anchors = world.locations.map(l => l.anchor); const plaza = S.byName["Town Plaza"].anchor; const drawn = new Set();
  const path = (a, b) => {
    const k = a.join() + "|" + b.join(); if (drawn.has(k)) return; drawn.add(k);
    const ax = W2X(a[0] + .5), az = W2Z(a[1] + .5), bx = W2X(b[0] + .5), bz = W2Z(b[1] + .5), len = Math.hypot(bx - ax, bz - az);
    const rot = -Math.atan2(bz - az, bx - ax) - Math.PI / 2;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(2.3, len + 0.6), new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 1 })); edge.rotation.x = -Math.PI / 2; edge.rotation.z = rot; edge.position.set((ax + bx) / 2, 0.012, (az + bz) / 2); edge.receiveShadow = true; worldGroup.add(edge);
    const t = TEX.cobble.clone(); t.needsUpdate = true; t.repeat.set(1, len / 2.2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, len + 0.6), new THREE.MeshStandardMaterial({ map: t, roughness: 1 })); m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set((ax + bx) / 2, 0.02, (az + bz) / 2); m.receiveShadow = true; worldGroup.add(m);
  };
  anchors.forEach((a, i) => { const near = anchors.map((b, j) => [Math.hypot(a[0] - b[0], a[1] - b[1]), j]).filter(x => x[1] !== i).sort((p, q) => p[0] - q[0]).slice(0, 2); near.forEach(([, j]) => path(a, anchors[j])); path(a, plaza); });

  for (const l of world.locations) { if (l.blocking) buildBuilding(l); else buildOpen(l); }
  buildVegetation(world);
  buildLamps();
  buildParty();
}

function box(w, h, d, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; }
const MAT = {};
function buildMaterials() {
  MAT.wood = new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: .85 });
  MAT.stone = new THREE.MeshStandardMaterial({ color: 0x9b917f, roughness: 1 });
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xf7f2e8, roughness: .8 });
  MAT.dark = new THREE.MeshStandardMaterial({ color: 0x3a3438, roughness: .8 });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0xbfe0f2, emissive: 0xffcf7a, emissiveIntensity: 0, roughness: .25, metalness: .2 });
  MAT.porch = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd08a, emissiveIntensity: 0 });
  MAT.trunk = new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 1 });
  MAT.leafA = new THREE.MeshStandardMaterial({ color: 0x4f9a48, roughness: .9, flatShading: true });
  MAT.metal = new THREE.MeshStandardMaterial({ color: 0x33323c, roughness: .6, metalness: .3 });
  MAT.bulb = new THREE.MeshStandardMaterial({ color: 0xffe6ad, emissive: 0xffcf7a, emissiveIntensity: 0 });
}

function buildBuilding(l) {
  const g = new THREE.Group();
  const w = l.w - 0.5, d = l.h - 0.5, cx = W2X(l.x + l.w / 2), cz = W2Z(l.y + l.h / 2);
  const kind = l.kind, hgt = kind === "home" ? 2.4 : kind === "civic" ? 3.2 : 2.8;
  const base = C(l.color), wallCol = mixC(base, C(0xfff4e2), 0.66), roofCol = mixC(base, C(0x000000), 0.22);
  const wallMat = new THREE.MeshStandardMaterial({ map: TEX.plaster, color: wallCol, roughness: .95 });
  const roofMat = new THREE.MeshStandardMaterial({ map: TEX.shingle, color: roofCol, roughness: .85 });

  const walls = box(w, hgt, d, wallMat); walls.position.set(0, hgt / 2, 0); g.add(walls);
  const skirt = box(w + 0.12, 0.3, d + 0.12, MAT.stone); skirt.position.y = 0.15; g.add(skirt);
  // gabled roof (ridge along x)
  const pitch = 0.6, rise = (d / 2 + 0.5) * Math.tan(pitch), slope = (d / 2 + 0.5) / Math.cos(pitch);
  for (const s of [-1, 1]) {
    const slab = box(w + 1.0, 0.14, slope, roofMat); slab.rotation.x = s * pitch;
    slab.position.set(0, hgt + rise / 2 - 0.05, s * (d / 4 + 0.25)); g.add(slab);
  }
  const gable = new THREE.Shape(); gable.moveTo(-d / 2 - 0.02, 0); gable.lineTo(d / 2 + 0.02, 0); gable.lineTo(0, rise - 0.08); gable.closePath();
  for (const s of [-1, 1]) { const gm = new THREE.Mesh(new THREE.ShapeGeometry(gable), new THREE.MeshStandardMaterial({ map: TEX.plaster, color: mixC(wallCol, C(0x000000), .08), side: THREE.DoubleSide })); gm.rotation.y = s * Math.PI / 2; gm.position.set(s * (w / 2 - 0.001), hgt, 0); g.add(gm); }
  const ridge = box(w + 1.1, 0.1, 0.22, new THREE.MeshStandardMaterial({ color: mixC(roofCol, C(0), .3) })); ridge.position.y = hgt + rise - 0.02; g.add(ridge);
  if (kind === "home" || kind === "cafe") { const ch = box(0.5, 1.3, 0.5, MAT.stone); ch.position.set(w * 0.3, hgt + rise * 0.55, -d * 0.15); g.add(ch); const cap = box(0.62, 0.1, 0.62, MAT.dark); cap.position.set(w * 0.3, hgt + rise * 0.55 + 0.7, -d * 0.15); g.add(cap); chimneys.push(new THREE.Vector3(cx + w * 0.3, hgt + rise * 0.55 + 0.8, cz - d * 0.15)); }

  // windows on front (+z) and back
  const doorX = W2X(l.anchor[0] + .5) - cx;
  const winY = hgt * 0.55;
  for (let x = -w / 2 + 0.9; x <= w / 2 - 0.9; x += 1.5) {
    for (const s of [1, -1]) {
      if (s === 1 && Math.abs(x - doorX) < 0.9) continue;
      const z = s * (d / 2 + 0.03);
      const frame = box(0.8, 1.0, 0.08, MAT.white); frame.position.set(x, winY, z); g.add(frame);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.82), MAT.glass.clone()); glass.position.set(x, winY, z + s * 0.045); if (s === -1) glass.rotation.y = Math.PI; g.add(glass); glowWindows.push(glass);
      const sill = box(0.9, 0.08, 0.2, MAT.white); sill.position.set(x, winY - 0.54, z + s * 0.06); g.add(sill);
      const bar = box(0.04, 0.82, 0.02, MAT.white); bar.position.set(x, winY, z + s * 0.05); g.add(bar); const bar2 = box(0.62, 0.04, 0.02, MAT.white); bar2.position.set(x, winY, z + s * 0.05); g.add(bar2);
      if (kind === "home") { const fb = box(0.9, 0.16, 0.24, MAT.wood); fb.position.set(x, winY - 0.66, z + s * 0.12); g.add(fb); for (let k = 0; k < 4; k++) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshStandardMaterial({ color: [0xff7aa2, 0xffd36b, 0xff9f43, 0xffffff][k % 4] })); fl.position.set(x - 0.3 + k * 0.2, winY - 0.54, z + s * 0.14); g.add(fl); } }
    }
  }
  // door + step + porch light
  const fz = d / 2;
  const dframe = box(1.1, 1.75, 0.1, MAT.white); dframe.position.set(doorX, 0.88, fz + 0.02); g.add(dframe);
  const door = box(0.9, 1.6, 0.08, MAT.wood); door.position.set(doorX, 0.8, fz + 0.07); g.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf2d38a, metalness: .6, roughness: .3 })); knob.position.set(doorX + 0.3, 0.85, fz + 0.13); g.add(knob);
  const step = box(1.4, 0.16, 0.7, MAT.stone); step.position.set(doorX, 0.08, fz + 0.4); g.add(step);
  const porch = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), MAT.porch.clone()); porch.position.set(doorX, 1.95, fz + 0.15); g.add(porch); porchLights.push(porch);
  // sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshStandardMaterial({ map: signTex(l.name, kind !== "home"), transparent: true })); sign.position.set(doorX, hgt - 0.35, fz + 0.09); g.add(sign);

  // kind extras
  if (kind === "cafe" || kind === "shop") {
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.06, 1.1), new THREE.MeshStandardMaterial({ map: kind === "cafe" ? TEX.awningRed : TEX.awningGreen })); aw.rotation.x = 0.35; aw.position.set(0, hgt * 0.78, fz + 0.5); aw.castShadow = true; g.add(aw);
    if (kind === "cafe") { for (const ox of [-1.7, 1.7]) { const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16), MAT.white); tb.position.set(ox, 0.72, fz + 1.9); tb.castShadow = true; g.add(tb); const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.7, 8), MAT.metal); tp.position.set(ox, 0.36, fz + 1.9); g.add(tp); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), MAT.metal); pole.position.set(ox, 1.4, fz + 1.9); g.add(pole); const um = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.45, 8), new THREE.MeshStandardMaterial({ map: TEX.awningRed })); um.position.set(ox, 2.5, fz + 1.9); um.castShadow = true; g.add(um); for (let k = 0; k < 2; k++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 10), MAT.wood); st.position.set(ox + (k ? 0.55 : -0.55), 0.42, fz + 1.9); g.add(st); } } }
    else { for (let k = 0; k < 2; k++) { const cr = box(0.55, 0.55, 0.55, MAT.wood); cr.position.set(doorX + 1.4 + k * 0.6, 0.28, fz + 0.6 + (k ? 0.3 : 0)); cr.rotation.y = k * 0.4; g.add(cr); } const br = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.7, 12), MAT.wood); br.position.set(doorX - 1.4, 0.35, fz + 0.6); br.castShadow = true; g.add(br); }
  }
  if (/Library/.test(l.name)) { for (const ox of [-1.6, -0.55, 0.55, 1.6]) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, hgt * 0.92, 10), MAT.white); col.position.set(ox, hgt * 0.46, fz + 0.55); col.castShadow = true; g.add(col); } const ped = box(w * 0.7, 0.14, 1.3, MAT.white); ped.position.set(0, hgt - 0.05, fz + 0.5); g.add(ped); const stp = box(w * 0.6, 0.12, 1.2, MAT.stone); stp.position.set(0, 0.06, fz + 0.9); g.add(stp); }
  if (kind === "civic") { const tw = box(1.1, 1.3, 1.1, wallMat); tw.position.set(0, hgt + rise + 0.5, 0); g.add(tw); const tr = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.8, 4), roofMat); tr.rotation.y = Math.PI / 4; tr.position.set(0, hgt + rise + 1.55, 0); g.add(tr); const bell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0xe0b64a, metalness: .7, roughness: .3 })); bell.position.set(0, hgt + rise + 0.85, 0.42); g.add(bell); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), MAT.metal); pole.position.set(-w / 2 + 0.6, 1.6, fz + 1.2); g.add(pole); const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: 0xff6b6b, side: THREE.DoubleSide })); flag.position.set(-w / 2 + 1.07, 2.9, fz + 1.2); g.add(flag); }
  if (/Art Studio/.test(l.name)) { const sk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 1.2), new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: .8, roughness: .1 })); sk.position.set(w * 0.2, hgt + rise * 0.6, d * 0.2); sk.rotation.x = -pitch; g.add(sk); ["#ff6b8a", "#4cc9f0", "#ffd166"].forEach((c, i) => { const can = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 10), new THREE.MeshStandardMaterial({ color: c })); can.position.set(doorX + 1.0 + i * 0.4, 0.14, fz + 0.5); g.add(can); }); }
  if (kind === "home") { for (const side of [-1, 1]) { for (let k = 0; k < 4; k++) { const px = doorX + side * (0.9 + k * 0.35); if (Math.abs(px) > w / 2) break; const pk = box(0.08, 0.55, 0.06, MAT.white); pk.position.set(px, 0.3, fz + 1.4); g.add(pk); } const rail = box(1.3, 0.06, 0.05, MAT.white); rail.position.set(doorX + side * 1.45, 0.42, fz + 1.4); g.add(rail); } const mb = box(0.28, 0.2, 0.42, new THREE.MeshStandardMaterial({ color: 0x4a6a8a })); mb.position.set(doorX + 1.9, 0.95, fz + 1.5); g.add(mb); const mp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), MAT.wood); mp.position.set(doorX + 1.9, 0.45, fz + 1.5); g.add(mp); }

  g.position.set(cx, 0, cz); worldGroup.add(g);
  S.blocked.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
  if (kind === "cafe") { S.cafe = { x: cx, z: cz, w, d, front: cz + d / 2 }; }
}

function buildOpen(l) {
  const w = l.w - 0.2, d = l.h - 0.2, cx = W2X(l.x + l.w / 2), cz = W2Z(l.y + l.h / 2);
  const isPark = l.kind === "park"; const g = new THREE.Group(); g.position.set(cx, 0, cz);
  if (isPark) {
    const t = TEX.grass.clone(); t.needsUpdate = true; t.repeat.set(3, 2);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, color: 0xa8d68c, roughness: 1 })); patch.rotation.x = -Math.PI / 2; patch.position.y = 0.015; patch.receiveShadow = true; g.add(patch);
    // pond
    const px = w * .26, pz = d * .2;
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.85, 28), new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 1 })); rim.rotation.x = -Math.PI / 2; rim.position.set(px, 0.02, pz); g.add(rim);
    const wm = new THREE.MeshStandardMaterial({ map: TEX.water.clone(), color: 0x9fd4ee, roughness: .15, metalness: .25, transparent: true, opacity: .92 }); wm.map.needsUpdate = true; waterMats.push(wm);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1.6, 28), wm); pond.rotation.x = -Math.PI / 2; pond.position.set(px, 0.03, pz); g.add(pond);
    for (let i = 0; i < 4; i++) { const lp = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), new THREE.MeshStandardMaterial({ color: 0x4f9a4a })); lp.rotation.x = -Math.PI / 2; lp.position.set(px + Math.cos(i * 1.8) * 0.9, 0.04, pz + Math.sin(i * 1.8) * 0.8); g.add(lp); }
    for (let i = 0; i < 9; i++) { const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.8 + R() * 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x5f8a3c })); const a = R() * 6.28; reed.position.set(px + Math.cos(a) * 1.75, 0.4, pz + Math.sin(a) * 1.7); reed.rotation.z = (R() - .5) * .3; g.add(reed); }
    S.circles.push({ x: cx + px, z: cz + pz, r: 1.9 });
    // flower beds + benches + picnic
    for (const [bx, bz] of [[-w * .35, -d * .32], [w * .3, -d * .32]]) { const bed = box(1.8, 0.22, 1.0, new THREE.MeshStandardMaterial({ color: 0x6a4a30 })); bed.position.set(bx, 0.11, bz); g.add(bed); for (let i = 0; i < 12; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshStandardMaterial({ color: [0xff6b8a, 0xffd166, 0xff9f43, 0xc77dff, 0xffffff][(R() * 5) | 0] })); f.position.set(bx - 0.75 + R() * 1.5, 0.28, bz - 0.35 + R() * 0.7); g.add(f); } }
    bench(g, -w * .1, d * .35, 0); bench(g, -w * .38, d * .05, Math.PI / 2);
    const blanket = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ color: 0xff8a80 })); blanket.rotation.x = -Math.PI / 2; blanket.rotation.z = .3; blanket.position.set(w * .05, 0.03, -d * .05); g.add(blanket);
    const basket = box(0.35, 0.25, 0.25, MAT.wood); basket.position.set(w * .05, 0.14, -d * .05); g.add(basket);
    treeAt(cx - w * .3, cz - d * .1, 1.8, "oak"); treeAt(cx + w * .38, cz + d * .3, 1.2, "blossom"); treeAt(cx - w * .05, cz + d * .38, 1.1, "round");
  } else {
    const t = TEX.cobble.clone(); t.needsUpdate = true; t.repeat.set(w / 2.2, d / 2.2);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 })); patch.rotation.x = -Math.PI / 2; patch.position.y = 0.018; patch.receiveShadow = true; g.add(patch);
    // fountain
    const fx = 0, fz = d * .12;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.85, 0.5, 24), MAT.stone); basin.position.set(fx, 0.25, fz); basin.castShadow = true; g.add(basin);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x7f776a })); inner.position.set(fx, 0.27, fz); g.add(inner);
    const wm = new THREE.MeshStandardMaterial({ map: TEX.water.clone(), color: 0xa9dcf4, roughness: .12, metalness: .3, transparent: true, opacity: .9 }); wm.map.needsUpdate = true; waterMats.push(wm);
    const wat = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), wm); wat.rotation.x = -Math.PI / 2; wat.position.set(fx, 0.5, fz); g.add(wat);
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.9, 12), MAT.stone); pil.position.set(fx, 0.9, fz); g.add(pil);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.3, 0.3, 16), MAT.stone); bowl.position.set(fx, 1.35, fz); g.add(bowl);
    const bwat = new THREE.Mesh(new THREE.CircleGeometry(0.66, 16), wm); bwat.rotation.x = -Math.PI / 2; bwat.position.set(fx, 1.51, fz); g.add(bwat);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xcfefff, transparent: true, opacity: .55 })); jet.position.set(fx, 1.95, fz); g.add(jet); S.jet = jet;
    S.circles.push({ x: cx + fx, z: cz + fz, r: 2.1 });
    bench(g, -w * .36, fz, Math.PI / 2); bench(g, w * .36, fz, -Math.PI / 2); bench(g, 0, d * .42, Math.PI);
    // market stall
    const sx = -w * .3, sz = -d * .3;
    for (const [ox, oz] of [[-1, -.6], [1, -.6], [-1, .6], [1, .6]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), MAT.wood); p.position.set(sx + ox, 1.1, sz + oz); g.add(p); }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.7), new THREE.MeshStandardMaterial({ map: TEX.awningGreen })); canopy.position.set(sx, 2.25, sz); canopy.rotation.x = 0.12; canopy.castShadow = true; g.add(canopy);
    const counter = box(2.2, 0.8, 0.8, MAT.wood); counter.position.set(sx, 0.4, sz + 0.3); g.add(counter);
    for (let i = 0; i < 6; i++) { const fr = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: [0xff5e3a, 0xffc93c, 0x7ed957][i % 3] })); fr.position.set(sx - 0.8 + i * 0.32, 0.9, sz + 0.3); g.add(fr); }
    // planters
    for (const [px, pz] of [[w * .38, -d * .38], [-w * .38, d * .38], [w * .38, d * .38]]) { const pl = box(0.8, 0.5, 0.8, MAT.stone); pl.position.set(px, 0.25, pz); g.add(pl); const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), MAT.leafA); bush.position.set(px, 0.75, pz); bush.castShadow = true; g.add(bush); }
  }
  const sign = document.createElement("div"); sign.className = "label"; sign.style.background = "transparent"; sign.style.border = "none"; sign.style.fontFamily = "var(--display)"; sign.style.fontSize = "14px"; sign.textContent = l.name;
  const so = new CSS2DObject(sign); so.position.set(0, 2.6, 0); g.add(so);
  worldGroup.add(g);
}

function bench(g, x, z, rot) {
  const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rot;
  const seat = box(1.4, 0.08, 0.45, MAT.wood); seat.position.y = 0.45; b.add(seat);
  const back = box(1.4, 0.4, 0.06, MAT.wood); back.position.set(0, 0.75, -0.2); back.rotation.x = -0.15; b.add(back);
  for (const ox of [-0.55, 0.55]) { const leg = box(0.08, 0.45, 0.4, MAT.metal); leg.position.set(ox, 0.22, 0); b.add(leg); }
  g.add(b);
}

// trees: merged geometry per type, instanced
const treeInst = {};
function treeGeom(type) {
  const parts = [];
  const push = (geo, color, pos, scale) => { geo = geo.toNonIndexed(); const n = geo.attributes.position.count; const col = new Float32Array(n * 3); const c = C(color); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); if (scale) geo.scale(...scale); geo.translate(...pos); parts.push(geo); };
  push(new THREE.CylinderGeometry(0.13, 0.19, 1.1, 7), 0x7a5233, [0, 0.55, 0]);
  if (type === "pine") { push(new THREE.ConeGeometry(0.9, 1.4, 7), 0x2f6b3e, [0, 1.35, 0]); push(new THREE.ConeGeometry(0.7, 1.2, 7), 0x3b7f49, [0, 2.05, 0]); push(new THREE.ConeGeometry(0.45, 0.9, 7), 0x4a9457, [0, 2.7, 0]); }
  else { const pal = type === "blossom" ? [0xd96b8f, 0xef8fb0, 0xf7b3cc] : type === "oak" ? [0x3e7d3a, 0x529a48, 0x6fb45f] : [0x4b8f42, 0x5fa852, 0x79bf67]; const r = type === "oak" ? 1.15 : 0.9; push(new THREE.IcosahedronGeometry(r, 1), pal[0], [0, 1.5 + r * .3, 0]); push(new THREE.IcosahedronGeometry(r * .75, 1), pal[1], [-r * .45, 1.75 + r * .2, r * .2]); push(new THREE.IcosahedronGeometry(r * .7, 1), pal[1], [r * .5, 1.8 + r * .2, -r * .1]); push(new THREE.IcosahedronGeometry(r * .55, 1), pal[2], [-r * .1, 2.1 + r * .5, -r * .3]); }
  return BGU.mergeGeometries(parts, false);
}
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, flatShading: true });
const treePlacements = { round: [], pine: [], blossom: [], oak: [] };
function treeAt(x, z, s, type) { treePlacements[type].push({ x, z, s, r: R() * 6.28 }); }

function buildVegetation(world) {
  const inBlocked = (x, z, m = 1.2) => S.blocked.some(b => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) || S.circles.some(c => Math.hypot(x - c.x, z - c.z) < c.r + m);
  const inPlaza = (x, z) => { const p = S.byName["Town Plaza"]; return x > W2X(p.x) - 1 && x < W2X(p.x + p.w) + 1 && z > W2Z(p.y) - 1 && z < W2Z(p.y + p.h) + 1; };
  const nearAnchor = (x, z) => S.locs.some(l => Math.hypot(W2X(l.anchor[0] + .5) - x, W2Z(l.anchor[1] + .5) - z) < 2.2);
  let n = 0, tries = 0;
  while (n < 70 && tries++ < 4000) {
    const x = (R() - .5) * (world.w + 16), z = (R() - .5) * (world.h + 16);
    if (inBlocked(x, z) || inPlaza(x, z) || nearAnchor(x, z)) continue;
    const all = Object.values(treePlacements).flat(); if (all.some(t => Math.hypot(t.x - x, t.z - z) < 2.4)) continue;
    const t = R(); treeAt(x, z, 0.8 + R() * 0.6, t < .5 ? "round" : t < .78 ? "pine" : t < .92 ? "blossom" : "oak"); n++;
  }
  for (const type of Object.keys(treePlacements)) {
    const list = treePlacements[type]; if (!list.length) continue;
    const im = new THREE.InstancedMesh(treeGeom(type), treeMat, list.length); im.castShadow = true; im.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sv = new THREE.Vector3();
    list.forEach((t, i) => { p.set(t.x, 0, t.z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r); sv.setScalar(t.s); m.compose(p, q, sv); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true; worldGroup.add(im); treeInst[type] = im;
  }
  // bushes
  const bushGeo = new THREE.IcosahedronGeometry(0.45, 1); const bushes = new THREE.InstancedMesh(bushGeo, MAT.leafA, 50); let bi = 0;
  const m = new THREE.Matrix4(); tries = 0;
  while (bi < 50 && tries++ < 3000) { const x = (R() - .5) * (world.w + 6), z = (R() - .5) * (world.h + 6); if (inBlocked(x, z, 0.6) || inPlaza(x, z) || nearAnchor(x, z)) continue; m.compose(new THREE.Vector3(x, 0.3, z), new THREE.Quaternion(), new THREE.Vector3(1, 0.75, 1).multiplyScalar(0.7 + R() * 0.7)); bushes.setMatrixAt(bi++, m); }
  bushes.count = bi; bushes.instanceMatrix.needsUpdate = true; bushes.castShadow = true; worldGroup.add(bushes);
  // grass tufts (crossed quads)
  const tuftCount = HI ? 900 : 350;
  const q1 = new THREE.PlaneGeometry(0.7, 0.55).translate(0, 0.27, 0), q2 = q1.clone().rotateY(Math.PI / 2);
  const tuftGeo = BGU.mergeGeometries([q1, q2]);
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ map: TEX.blade, transparent: true, alphaTest: .5, side: THREE.DoubleSide, roughness: 1 }), tuftCount); let ti = 0; tries = 0;
  while (ti < tuftCount && tries++ < tuftCount * 6) { const x = (R() - .5) * (world.w + 14), z = (R() - .5) * (world.h + 14); if (inBlocked(x, z, 0.3) || inPlaza(x, z) || nearAnchor(x, z, 1.4)) continue; m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 3), new THREE.Vector3(1, 1, 1).multiplyScalar(0.6 + R() * 0.8)); tufts.setMatrixAt(ti++, m); }
  tufts.count = ti; tufts.instanceMatrix.needsUpdate = true; worldGroup.add(tufts);
  // flowers
  const fCount = HI ? 260 : 100; const fGeo = BGU.mergeGeometries([new THREE.PlaneGeometry(0.28, 0.28).translate(0, 0.16, 0), new THREE.PlaneGeometry(0.28, 0.28).translate(0, 0.16, 0).rotateY(Math.PI / 2)]);
  const flowers = new THREE.InstancedMesh(fGeo, new THREE.MeshStandardMaterial({ map: TEX.flower, transparent: true, alphaTest: .5, side: THREE.DoubleSide }), fCount); let fi = 0; tries = 0; const cols = [0xff7aa2, 0xffd36b, 0xff9f43, 0xc77dff, 0xffffff, 0x8fe3c0];
  while (fi < fCount && tries++ < fCount * 6) { const x = (R() - .5) * (world.w + 12), z = (R() - .5) * (world.h + 12); if (inBlocked(x, z, 0.3) || inPlaza(x, z) || nearAnchor(x, z, 1.2)) continue; m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 3), new THREE.Vector3(1, 1, 1)); flowers.setMatrixAt(fi, m); flowers.setColorAt(fi, C(cols[(R() * cols.length) | 0])); fi++; }
  flowers.count = fi; flowers.instanceMatrix.needsUpdate = true; flowers.instanceColor.needsUpdate = true; worldGroup.add(flowers);
}

function buildLamps() {
  const spots = [[10, 8], [22, 8], [10, 18], [22, 18], [30, 8], [16, 26], [6, 26], [26, 26], [34, 18], [4, 16]];
  for (const [tx, ty] of spots) {
    const x = W2X(tx), z = W2Z(ty); const g = new THREE.Group(); g.position.set(x, 0, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 8), MAT.metal); base.position.y = 0.12; g.add(base);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.6, 8), MAT.metal); post.position.y = 1.4; post.castShadow = true; g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), MAT.metal); arm.position.set(0.22, 2.7, 0); g.add(arm);
    const cage = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.22, 6), MAT.metal); cage.rotation.x = Math.PI; cage.position.set(0.45, 2.58, 0); g.add(cage);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), MAT.bulb.clone()); bulb.position.set(0.45, 2.45, 0); g.add(bulb); lampBulbs.push(bulb);
    const light = new THREE.PointLight(0xffc47a, 0, 9, 2); light.position.set(0.45, 2.35, 0); g.add(light); lampLights.push(light);
    worldGroup.add(g);
  }
}

// party dressing (hidden until seeded)
let partyGroup, partyGlow, partyLight, bulbMats = [];
function buildParty() {
  partyGroup = new THREE.Group(); partyGroup.visible = false; scene.add(partyGroup);
  if (!S.cafe) return;
  const { x, z, w, front } = S.cafe;
  // two posts + string lights
  for (const ox of [-w / 2 - 0.6, w / 2 + 0.6]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6), MAT.wood); p.position.set(x + ox, 1.3, front + 2.8); partyGroup.add(p); }
  const cols = [0xff6b8a, 0xffd166, 0x7ae0ff, 0xb5e48c, 0xff9f43];
  const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; const px = x - w / 2 - 0.6 + t * (w + 1.2); const py = 2.55 - Math.sin(t * Math.PI) * 0.45; pts.push(new THREE.Vector3(px, py, front + 2.8)); }
  const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2a2320 })); partyGroup.add(wire);
  pts.forEach((p, i) => { if (i % 1) return; const m = new THREE.MeshStandardMaterial({ color: cols[i % cols.length], emissive: cols[i % cols.length], emissiveIntensity: 1.6 }); const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), m); b.position.copy(p).add(new THREE.Vector3(0, -0.1, 0)); partyGroup.add(b); bulbMats.push(m); });
  // bunting on the building front
  for (let i = 0; i < 9; i++) { const t = i / 8; const tri = new THREE.Mesh(new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-0.18, 0); s.lineTo(0.18, 0); s.lineTo(0, -0.34); return s; })()), new THREE.MeshStandardMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide })); tri.position.set(x - w / 2 + 0.4 + t * (w - 0.8), 2.2 - Math.sin(t * Math.PI) * 0.25, front + 0.15); partyGroup.add(tri); }
  // lanterns by the door
  for (const ox of [-1.2, 1.2]) { const ln = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0xffb27a, emissive: 0xff9a55, emissiveIntensity: 1.4 })); ln.position.set(x + ox, 1.7, front + 0.35); partyGroup.add(ln); }
  partyGlow = new THREE.Mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshBasicMaterial({ color: 0xff8db0, transparent: true, opacity: 0.0, depthWrite: false })); partyGlow.rotation.x = -Math.PI / 2; partyGlow.position.set(x, 0.035, front + 1.5); partyGroup.add(partyGlow);
  partyLight = new THREE.PointLight(0xff9ec4, 0, 26, 2); partyLight.position.set(x, 3.5, front + 1.5); partyGroup.add(partyLight);
}

// ============================================================ characters
const SKINS = [0xf7dcc0, 0xeec19c, 0xd9a274, 0xb97f58, 0x8d5a3c, 0xf2cfae], HAIRS = [0x2a1b13, 0x4b2f1f, 0x7d4a25, 0xb4773a, 0xd9b56b, 0xa8433a, 0x6e6a6a, 0x1a1a1e], PANTS = [0x2e3a5c, 0x3b3b46, 0x5a3f2e, 0x374d3c, 0x4a3a5c];
const bubbleDots = new THREE.SpriteMaterial({ map: TEX.dots, transparent: true, depthWrite: false }), bubbleHeart = new THREE.SpriteMaterial({ map: TEX.heart, transparent: true, depthWrite: false });

function makeChar(a, isPlayer = false) {
  const h = hash(a.id), r = rng(h); const occ = (a.occupation || "").toLowerCase();
  const g = new THREE.Group();
  const accent = isPlayer ? C(0xffd36b) : C(a.color || 0x88aaff);
  const skin = C(SKINS[h % SKINS.length]), hair = C(HAIRS[(h >> 3) % HAIRS.length]), pants = C(PANTS[(h >> 6) % PANTS.length]);
  const skinM = new THREE.MeshStandardMaterial({ color: skin, roughness: .85 }), hairM = new THREE.MeshStandardMaterial({ color: hair, roughness: 1, flatShading: true });
  const shirtM = new THREE.MeshStandardMaterial({ color: accent, roughness: .8 }), pantM = new THREE.MeshStandardMaterial({ color: pants, roughness: .9 });
  const mk = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; };
  // legs (pivot at hip)
  const hipY = 0.78;
  const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.13, hipY, 0); legR.position.set(0.13, hipY, 0);
  for (const lg of [legL, legR]) { const m = mk(new THREE.CapsuleGeometry(0.11, 0.5, 3, 8), pantM); m.position.y = -0.36; lg.add(m); const shoe = mk(new THREE.BoxGeometry(0.2, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2222 })); shoe.position.set(0, -0.73, 0.04); lg.add(shoe); g.add(lg); }
  // torso
  const torso = mk(new THREE.CapsuleGeometry(0.26, 0.42, 4, 10), shirtM); torso.position.y = 1.08; g.add(torso);
  if (/cafe|barista/.test(occ)) { const ap = mk(new THREE.BoxGeometry(0.34, 0.5, 0.06), new THREE.MeshStandardMaterial({ color: 0xf4ecd8 })); ap.position.set(0, 1.0, 0.25); g.add(ap); }
  // arms (pivot at shoulder)
  const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-0.36, 1.3, 0); armR.position.set(0.36, 1.3, 0);
  for (const ar of [armL, armR]) { const s = mk(new THREE.CapsuleGeometry(0.08, 0.22, 3, 8), shirtM); s.position.y = -0.16; ar.add(s); const f = mk(new THREE.CapsuleGeometry(0.075, 0.2, 3, 8), skinM); f.position.y = -0.42; ar.add(f); g.add(ar); }
  // head
  const head = new THREE.Group(); head.position.y = 1.62; g.add(head);
  const hd = mk(new THREE.SphereGeometry(0.24, 16, 14), skinM); head.add(hd);
  const style = h % 6;
  const cap = mk(new THREE.SphereGeometry(0.255, 16, 12, 0, 6.283, 0, 1.55), hairM); cap.position.y = 0.03; head.add(cap);
  if (style === 1 || style === 3) { for (const sx of [-1, 1]) { const side = mk(new THREE.BoxGeometry(0.08, 0.28, 0.2), hairM); side.position.set(sx * 0.24, -0.06, -0.02); head.add(side); } }
  if (style === 3) { const back = mk(new THREE.BoxGeometry(0.34, 0.45, 0.12), hairM); back.position.set(0, -0.15, -0.2); head.add(back); }
  if (style === 2 || /yoga/.test(occ)) { const bun = mk(new THREE.SphereGeometry(0.11, 10, 8), hairM); bun.position.set(0, 0.26, -0.06); head.add(bun); }
  if (style === 4) { for (let i = -2; i <= 2; i++) { const sp = mk(new THREE.ConeGeometry(0.05, 0.16, 5), hairM); sp.position.set(i * 0.08, 0.28, 0); sp.rotation.z = -i * 0.25; head.add(sp); } }
  if (/musician|gardener/.test(occ) || style === 5) { const brim = mk(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 16), new THREE.MeshStandardMaterial({ color: /gardener/.test(occ) ? 0xd9b56b : 0x2b2b33 })); brim.position.y = 0.14; head.add(brim); const top = mk(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 16), brim.material); top.position.y = 0.26; head.add(top); }
  if (/paint|art/.test(occ)) { const beret = mk(new THREE.SphereGeometry(0.25, 12, 8, 0, 6.283, 0, 1.1), new THREE.MeshStandardMaterial({ color: 0xc8473a })); beret.position.set(0.05, 0.1, 0); beret.rotation.z = -0.35; head.add(beret); }
  if (/librarian|researcher|software/.test(occ)) { for (const sx of [-1, 1]) { const ring = mk(new THREE.TorusGeometry(0.06, 0.012, 6, 12), MAT.dark); ring.position.set(sx * 0.09, 0.02, 0.22); head.add(ring); } }
  // eyes
  for (const sx of [-1, 1]) { const eye = mk(new THREE.SphereGeometry(0.028, 6, 6), new THREE.MeshStandardMaterial({ color: 0x2b1d16 })); eye.position.set(sx * 0.085, 0.02, 0.22); head.add(eye); }
  // rings
  const kring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 24), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); kring.rotation.x = -Math.PI / 2; kring.position.y = 0.03; g.add(kring);
  const sring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.58, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); sring.rotation.x = -Math.PI / 2; sring.position.y = 0.035; g.add(sring);
  // bubble sprite
  const bub = new THREE.Sprite(bubbleDots); bub.scale.set(0.7, 0.44, 1); bub.position.set(0.35, 2.25, 0); bub.visible = false; g.add(bub);
  // label
  let labelEl = null;
  if (!isPlayer) { labelEl = document.createElement("div"); labelEl.className = "label"; labelEl.innerHTML = `${a.name}<small>${esc(a.occupation || "")}</small>`; const lab = new CSS2DObject(labelEl); lab.position.set(0, 2.15 + ((h >> 9) % 5) * 0.09, 0); g.add(lab); }   // staggered heights so crowds don't stack labels
  scene.add(g);
  return { id: a.id, name: a.name, color: accent, g, legL, legR, armL, armR, torso, head, kring, sring, bub, labelEl,
    x: 0, z: 0, tx: 0, tz: 0, yaw: 0, phase: r() * 6, walking: false, moving: false, target: null, targetPos: null, arc: null, marker: null, bubbleUntil: 0, bubbleHl: false };
}

function applyAgents(list) {
  const groups = new Map();
  for (const a of list) { const k = a.pos.join(","); (groups.get(k) || groups.set(k, []).get(k)).push(a); }
  const off = {};
  for (const [, g] of groups) { g.sort((p, q) => (p.id < q.id ? -1 : 1)); if (g.length === 1) { off[g[0].id] = [0, 0]; continue; } g.forEach((a, i) => { const ring = i < 6 ? 0 : 1, cnt = ring ? g.length - 6 : Math.min(6, g.length), idx = ring ? i - 6 : i, rad = ring ? 1.7 : 0.95, ang = 6.283 * ((idx + 0.5) / cnt) + 0.4; off[a.id] = [Math.cos(ang) * rad, Math.sin(ang) * rad * 0.8]; }); }
  for (const a of list) {
    let r = S.agents.get(a.id);
    if (!r) { r = makeChar(a); r.x = r.tx = W2X(a.pos[0] + .5); r.z = r.tz = W2Z(a.pos[1] + .5); r.g.position.set(r.x, 0, r.z); S.agents.set(a.id, r); S.order.push(r); }
    const o = off[a.id] || [0, 0];
    r.tx = W2X(a.pos[0] + .5) + o[0]; r.tz = W2Z(a.pos[1] + .5) + o[1];
    r.moving = !!a.moving; r.target = a.target; r.targetPos = a.target_pos; r.action = a.action; r.location = a.location; r.occupation = a.occupation;
  }
}

function updateChars(dt, now) {
  const camPos = camera.position;
  for (const r of S.order) {
    const dx = r.tx - r.x, dz = r.tz - r.z, d = Math.hypot(dx, dz);
    const sp = 3.0;
    if (d > 0.03) { const st = Math.min(d, sp * dt); r.x += dx / d * st; r.z += dz / d * st; const ty = Math.atan2(dx, dz); let dy = ty - r.yaw; while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; r.yaw += dy * Math.min(1, dt * 10); r.walking = true; }
    else r.walking = false;
    r.g.position.set(r.x, 0, r.z); r.g.rotation.y = r.yaw;
    const party = S.atParty.has(r.id);
    if (r.walking) { r.phase += dt * 9.5; const sw = Math.sin(r.phase); r.legL.rotation.x = sw * 0.7; r.legR.rotation.x = -sw * 0.7; r.armL.rotation.x = -sw * 0.6; r.armR.rotation.x = sw * 0.6; r.torso.position.y = 1.08 + Math.abs(Math.cos(r.phase)) * 0.035; r.head.position.y = 1.62 + Math.abs(Math.cos(r.phase)) * 0.035; }
    else { const k = Math.min(1, dt * 8); r.legL.rotation.x *= 1 - k; r.legR.rotation.x *= 1 - k; r.armL.rotation.x *= 1 - k; r.armR.rotation.x *= 1 - k; const breathe = Math.sin(now / 900 + r.phase) * 0.01; r.torso.position.y = 1.08 + breathe; r.head.position.y = 1.62 + breathe;
      if (party) { const b = Math.sin(now / 260 + r.phase); r.torso.position.y += Math.abs(b) * 0.06; r.head.position.y += Math.abs(b) * 0.06; r.g.rotation.y = r.yaw + Math.sin(now / 520 + r.phase) * 0.25; r.armL.rotation.z = 0.5 + b * 0.35; r.armR.rotation.z = -0.5 - b * 0.35; } else { r.armL.rotation.z *= 1 - k; r.armR.rotation.z *= 1 - k; } }
    // glance at the player when close
    const pdx = camPos.x - r.x, pdz = camPos.z - r.z, pd = Math.hypot(pdx, pdz);
    let want = 0; if (pd < 4.5) { let a = Math.atan2(pdx, pdz) - r.g.rotation.y; while (a > Math.PI) a -= 6.283; while (a < -Math.PI) a += 6.283; want = clamp(a, -0.9, 0.9); }
    r.head.rotation.y += (want - r.head.rotation.y) * Math.min(1, dt * 4);
    // rings / label
    const isK = S.knowers.has(r.id); r.kring.material.opacity = isK ? 0.6 + Math.sin(now / 300 + r.phase) * 0.25 : 0;
    const isSel = S.selected === r.id; r.sring.material.opacity = isSel ? 0.85 : 0;
    if (r.labelEl) { r.labelEl.classList.toggle("knower", isK); r.labelEl.classList.toggle("sel", isSel); r.labelEl.classList.toggle("far", pd > 22 && !isSel); r.labelEl.classList.toggle("near", pd < 6); }
    // bubble
    const talking = r.bubbleUntil > now; r.bub.visible = talking; if (talking) { r.bub.material = r.bubbleHl ? bubbleHeart : bubbleDots; r.bub.scale.set(r.bubbleHl ? 0.5 : 0.7, r.bubbleHl ? 0.5 : 0.44, 1); r.bub.position.y = 2.25 + Math.sin(now / 250) * 0.04; }
    // destination arc + marker for the selected villager
    if (isSel && r.moving && r.targetPos) drawArc(r, now); else { if (r.arc) r.arc.visible = false; if (r.marker) r.marker.visible = false; }
  }
}

function drawArc(r, now) {
  const bx = W2X(r.targetPos[0] + .5), bz = W2Z(r.targetPos[1] + .5);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(r.x, 0.6, r.z), new THREE.Vector3((r.x + bx) / 2, 2.2 + Math.hypot(bx - r.x, bz - r.z) * 0.08, (r.z + bz) / 2), new THREE.Vector3(bx, 0.6, bz));
  if (!r.arc) { r.arc = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.05, 6, false), new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: .85 })); scene.add(r.arc); r.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 28), new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false })); r.marker.rotation.x = -Math.PI / 2; scene.add(r.marker); }
  r.arc.geometry.dispose(); r.arc.geometry = new THREE.TubeGeometry(curve, 32, 0.05, 6, false); r.arc.visible = true;
  r.marker.position.set(bx, 0.04, bz); const s = 1 + Math.sin(now / 250) * 0.15; r.marker.scale.set(s, s, 1); r.marker.visible = true;
}

// ============================================================ day / night
const KF = [
  [0, { top: 0x070b22, bot: 0x121c3e, sun: 0x9bb0ff, sunI: 0, hs: 0x2a3560, hg: 0x0f1a12, amb: .16, exp: .8, bloom: .8, cloud: 0x3a4670, night: 1, glow: 0 }],
  [4.8, { top: 0x070b22, bot: 0x121c3e, sun: 0x9bb0ff, sunI: 0, hs: 0x2a3560, hg: 0x0f1a12, amb: .16, exp: .8, bloom: .8, cloud: 0x3a4670, night: 1, glow: 0 }],
  [6.5, { top: 0x4a5fb0, bot: 0xffb08a, sun: 0xffb27a, sunI: 1.0, hs: 0x8aa0e0, hg: 0x4a5a3a, amb: .22, exp: .95, bloom: .5, cloud: 0xffc2a3, night: .35, glow: .9 }],
  [8.5, { top: 0x58a4ff, bot: 0xd3e8ff, sun: 0xfff0d2, sunI: 2.0, hs: 0xbfd9ff, hg: 0x5b7a4a, amb: .3, exp: 1.0, bloom: .28, cloud: 0xffffff, night: 0, glow: 1 }],
  [15.5, { top: 0x58a4ff, bot: 0xd3e8ff, sun: 0xfff0d2, sunI: 2.0, hs: 0xbfd9ff, hg: 0x5b7a4a, amb: .3, exp: 1.0, bloom: .28, cloud: 0xffffff, night: 0, glow: 1 }],
  [17.8, { top: 0x4c78d6, bot: 0xffc27a, sun: 0xffb070, sunI: 1.5, hs: 0xa0b4ea, hg: 0x5a6a3a, amb: .26, exp: 1.0, bloom: .4, cloud: 0xffd2b0, night: .1, glow: 1 }],
  [19.3, { top: 0x2c2f6e, bot: 0xff8a6e, sun: 0xff8a60, sunI: .55, hs: 0x5a5aa0, hg: 0x2a3a2a, amb: .2, exp: .92, bloom: .6, cloud: 0xd98aa0, night: .55, glow: .7 }],
  [21, { top: 0x070b22, bot: 0x121c3e, sun: 0x9bb0ff, sunI: 0, hs: 0x2a3560, hg: 0x0f1a12, amb: .16, exp: .8, bloom: .8, cloud: 0x3a4670, night: 1, glow: 0 }],
  [24, { top: 0x070b22, bot: 0x121c3e, sun: 0x9bb0ff, sunI: 0, hs: 0x2a3560, hg: 0x0f1a12, amb: .16, exp: .8, bloom: .8, cloud: 0x3a4670, night: 1, glow: 0 }],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function lightingAt(min) {
  const hr = ((min % 1440) + 1440) % 1440 / 60; let i = 0; while (i < KF.length - 2 && hr >= KF[i + 1][0]) i++;
  const a = KF[i][1], b = KF[i + 1][1], t = clamp((hr - KF[i][0]) / (KF[i + 1][0] - KF[i][0] || 1), 0, 1);
  const col = (k) => _c1.setHex(a[k]).lerp(_c2.setHex(b[k]), t).clone(); const num = (k) => lerp(a[k], b[k], t);
  return { hr, top: col("top"), bot: col("bot"), sun: col("sun"), sunI: num("sunI"), hs: col("hs"), hg: col("hg"), amb: num("amb"), exp: num("exp"), bloom: num("bloom"), cloud: col("cloud"), night: num("night"), glow: num("glow") };
}
let L = lightingAt(480);
function updateSky(min, now) {
  L = lightingAt(min);
  skyMat.uniforms.top.value.copy(L.top); skyMat.uniforms.bottom.value.copy(L.bot); skyMat.uniforms.sunCol.value.copy(L.sun); skyMat.uniforms.glow.value = L.glow;
  if (!scene.fog) scene.fog = new THREE.Fog(L.bot.clone(), 45, 150); else scene.fog.color.copy(L.bot);
  const ang = Math.PI * (1 - clamp((L.hr - 6) / 12, -0.15, 1.15));
  const sdir = new THREE.Vector3(Math.cos(ang), Math.max(-0.2, Math.sin(ang)), 0.35).normalize();
  skyMat.uniforms.sunDir.value.copy(sdir);
  sun.position.copy(sdir).multiplyScalar(70); sun.target.position.set(0, 0, 0); sun.color.copy(L.sun); sun.intensity = L.sunI;
  sunSprite.position.copy(sdir).multiplyScalar(380); sunSprite.material.opacity = L.glow;
  const mdir = new THREE.Vector3(-sdir.x, Math.abs(sdir.y) + 0.25, -sdir.z).normalize(); moonSprite.position.copy(mdir).multiplyScalar(380); moonSprite.material.opacity = L.night; moon.position.copy(mdir).multiplyScalar(60); moon.intensity = L.night * 0.35;
  hemi.color.copy(L.hs); hemi.groundColor.copy(L.hg); hemi.intensity = lerp(0.95, 0.35, L.night); amb.intensity = L.amb;
  renderer.toneMappingExposure = L.exp; if (bloom) bloom.strength = L.bloom;
  stars.material.opacity = L.night; stars.rotation.y = now / 200000;
  for (const c of clouds) { c.material.color.copy(L.cloud); c.position.x += c.userData.v * 0.004; if (c.position.x > 240) c.position.x = -240; }
  const em = L.night; for (const w of glowWindows) w.material.emissiveIntensity = em * 1.6; for (const p of porchLights) p.material.emissiveIntensity = em * 2.2; for (const b of lampBulbs) b.material.emissiveIntensity = em * 2.2; for (const l of lampLights) l.intensity = em * 2.4;
  for (const wm of waterMats) { wm.map.offset.x = now / 60000; wm.map.offset.y = now / 90000; }
  if (S.jet) { S.jet.scale.y = 1 + Math.sin(now / 200) * 0.1; }
}

// ============================================================ atmosphere
let motes, fireflies;
function buildAtmosphere() {
  const N = HI ? 220 : 80, p = new Float32Array(N * 3); for (let i = 0; i < N; i++) { p[i * 3] = (R() - .5) * 24; p[i * 3 + 1] = R() * 5; p[i * 3 + 2] = (R() - .5) * 24; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  motes = new THREE.Points(g, new THREE.PointsMaterial({ map: TEX.blob, color: 0xfff1c8, size: 0.14, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(motes);
  const M = HI ? 90 : 30, q = new Float32Array(M * 3); const park = S.byName["The Park"]; for (let i = 0; i < M; i++) { const t = treePlacements.round.concat(treePlacements.oak, treePlacements.blossom); const src = t[(R() * t.length) | 0]; const near = park && R() < .4; const bx = near ? W2X(park.x + R() * park.w) : src.x + (R() - .5) * 5, bz = near ? W2Z(park.y + R() * park.h) : src.z + (R() - .5) * 5; q[i * 3] = bx; q[i * 3 + 1] = 0.6 + R() * 2; q[i * 3 + 2] = bz; }
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(q, 3)); fg.userData.base = q.slice();
  fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ map: TEX.blob, color: 0xd8ff7a, size: 0.32, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(fireflies);
}
function updateAtmosphere(dt, now) {
  motes.position.set(camera.position.x, 0, camera.position.z); motes.rotation.y = now / 40000; motes.material.opacity = 0.3 * (1 - L.night) * (0.6 + L.glow * 0.4);
  const pos = fireflies.geometry.attributes.position, base = fireflies.geometry.userData.base;
  for (let i = 0; i < pos.count; i++) { pos.array[i * 3] = base[i * 3] + Math.sin(now / 900 + i) * 0.6; pos.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(now / 700 + i * 1.7) * 0.4; pos.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(now / 1100 + i) * 0.6; }
  pos.needsUpdate = true; fireflies.material.opacity = L.night * (0.7 + Math.sin(now / 300) * 0.3);
  // smoke
  const hr = L.hr; for (const c of chimneys) { if ((hr > 6 && hr < 10) || (hr > 17 && hr < 23)) { if (Math.random() < 0.05) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.blob, color: 0xdedee6, transparent: true, opacity: .35, depthWrite: false })); sp.position.copy(c); sp.scale.setScalar(0.4); sp.userData.life = 1; scene.add(sp); S.smoke.push(sp); } } }
  for (const s of S.smoke) { s.position.y += dt * 0.5; s.position.x += Math.sin(now / 800 + s.position.y) * dt * 0.2; s.scale.addScalar(dt * 0.5); s.userData.life -= dt * 0.28; s.material.opacity = Math.max(0, s.userData.life) * 0.3; }
  S.smoke = S.smoke.filter(s => { if (s.userData.life <= 0) { scene.remove(s); return false; } return true; });
}

// ============================================================ party fx
function updateParty(dt, now) {
  if (!partyGroup) return; partyGroup.visible = !!S.party; if (!S.party) return;
  const here = S.atParty.size, active = here > 0, m = S.clock.minute_of_day, inWin = m >= S.party.time_min - 60 && m <= S.party.time_min + 130;
  partyGlow.material.opacity = (active ? 0.34 : 0.1) * (0.7 + Math.sin(now / 400) * 0.3);
  partyLight.intensity = (active ? 3.2 : 0.8) + Math.sin(now / 300) * 0.4;
  bulbMats.forEach((bm, i) => { bm.emissiveIntensity = 1.0 + Math.max(0, Math.sin(now / 240 + i)) * 1.4; });
  if (inWin && Math.random() < 0.4) { const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.heart, transparent: true, depthWrite: false })); h.position.set(S.cafe.x + (Math.random() - .5) * 7, 1.6 + Math.random(), S.cafe.front + 1 + (Math.random() - .5) * 4); h.scale.setScalar(0.25 + Math.random() * 0.25); h.userData = { vy: 0.5 + Math.random() * 0.5, life: 1, ph: Math.random() * 6 }; scene.add(h); S.hearts.push(h); }
  for (const h of S.hearts) { h.position.y += h.userData.vy * dt; h.position.x += Math.sin(now / 400 + h.userData.ph) * dt * 0.4; h.userData.life -= dt * 0.3; h.material.opacity = clamp(h.userData.life, 0, 1); }
  S.hearts = S.hearts.filter(h => { if (h.userData.life <= 0) { scene.remove(h); return false; } return true; });
  if (inWin && here >= 5 && Math.random() < 0.5) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ color: [0xff6b8a, 0xffd166, 0x7ae0ff, 0xb5e48c, 0xc77dff][(Math.random() * 5) | 0], side: THREE.DoubleSide })); c.position.set(S.cafe.x + (Math.random() - .5) * 8, 4.5, S.cafe.front + 1 + (Math.random() - .5) * 4); c.userData = { vy: 0.6 + Math.random() * 0.4, life: 1, rs: (Math.random() - .5) * 8 }; scene.add(c); S.confetti.push(c); }
  for (const c of S.confetti) { c.position.y -= c.userData.vy * dt; c.rotation.x += c.userData.rs * dt; c.rotation.y += c.userData.rs * 0.7 * dt; c.position.x += Math.sin(now / 300 + c.rotation.x) * dt * 0.4; c.userData.life -= dt * 0.22; }
  S.confetti = S.confetti.filter(c => { if (c.userData.life <= 0 || c.position.y < 0.05) { scene.remove(c); return false; } return true; });
}

// ============================================================ player
const player = { pos: new THREE.Vector3(0, 0, 6), yaw: Math.PI, pitch: -0.05, vel: new THREE.Vector3(), keys: {}, locked: false, bobT: 0 };
let avatar = null;
function collide(p) {
  const rad = 0.42;
  for (const b of S.blocked) { if (p.x > b.x0 - rad && p.x < b.x1 + rad && p.z > b.z0 - rad && p.z < b.z1 + rad) { const dl = p.x - (b.x0 - rad), dr = (b.x1 + rad) - p.x, dt_ = p.z - (b.z0 - rad), db = (b.z1 + rad) - p.z; const m = Math.min(dl, dr, dt_, db); if (m === dl) p.x = b.x0 - rad; else if (m === dr) p.x = b.x1 + rad; else if (m === dt_) p.z = b.z0 - rad; else p.z = b.z1 + rad; } }
  for (const c of S.circles) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz); if (d < c.r + rad && d > 0.001) { p.x = c.x + dx / d * (c.r + rad); p.z = c.z + dz / d * (c.r + rad); } }
  const bx = S.W / 2 + 10, bz = S.H / 2 + 10; p.x = clamp(p.x, -bx, bx); p.z = clamp(p.z, -bz, bz);
}
function updatePlayer(dt, now) {
  if (S._spectate) { camera.position.copy(S._spectate.pos); camera.lookAt(S._spectate.look); if (avatar) avatar.g.visible = false; return; }
  const run = player.keys["shift"] ? 1 : 0; const maxSp = lerp(4.4, 7.6, run);
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)), right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const want = new THREE.Vector3(); if (player.keys["w"]) want.add(fwd); if (player.keys["s"]) want.sub(fwd); if (player.keys["d"]) want.add(right); if (player.keys["a"]) want.sub(right);
  if (want.lengthSq() > 0) want.normalize().multiplyScalar(maxSp);
  const accel = want.lengthSq() > 0 ? 14 : 11; player.vel.lerp(want, Math.min(1, dt * accel));
  if (player.vel.lengthSq() > 1e-4) { player.pos.addScaledVector(player.vel, dt); collide(player.pos); }
  const spN = player.vel.length() / 7.6;
  player.bobT += dt * (7 + 5 * run) * clamp(spN * 1.6, 0, 1);
  const bobY = Math.sin(player.bobT * 2) * 0.05 * spN, bobX = Math.sin(player.bobT) * 0.035 * spN;
  const targetFov = 70 + run * 8 * clamp(spN * 1.5, 0, 1); camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix();
  if (S.view === "fp") {
    camera.position.set(player.pos.x + right.x * bobX, 1.68 + bobY, player.pos.z + right.z * bobX);
    camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, Math.sin(player.bobT) * 0.004 * spN, "YXZ"));
    if (avatar) avatar.g.visible = false;
  } else {
    if (!avatar) { avatar = makeChar({ id: "you", name: "You", color: "#ffd36b", occupation: "" }, true); }
    avatar.g.visible = true; avatar.g.position.copy(player.pos);
    const moving = player.vel.lengthSq() > 0.05; if (moving) { const ty = Math.atan2(player.vel.x, player.vel.z); let dy = ty - avatar.yaw; while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; avatar.yaw += dy * Math.min(1, dt * 10); avatar.phase += dt * (9 + 4 * run); const sw = Math.sin(avatar.phase); avatar.legL.rotation.x = sw * 0.7; avatar.legR.rotation.x = -sw * 0.7; avatar.armL.rotation.x = -sw * 0.6; avatar.armR.rotation.x = sw * 0.6; } else { const k = Math.min(1, dt * 8); avatar.legL.rotation.x *= 1 - k; avatar.legR.rotation.x *= 1 - k; avatar.armL.rotation.x *= 1 - k; avatar.armR.rotation.x *= 1 - k; }
    avatar.g.rotation.y = avatar.yaw;
    const dist = 5.2, h = 2.4 + player.pitch * -2.2;
    const desired = new THREE.Vector3(player.pos.x - fwd.x * dist, h, player.pos.z - fwd.z * dist);
    camera.position.lerp(desired, 1 - Math.exp(-dt * 9));
    camera.lookAt(player.pos.x + fwd.x * 1.2, 1.5, player.pos.z + fwd.z * 1.2);
  }
}

// ============================================================ input
const canvas = renderer.domElement;
addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return; const k = e.key.toLowerCase();
  if (k === " ") { e.preventDefault(); control(S.running ? "pause" : "play"); return; }
  if (k === "shift") player.keys.shift = true; if ("wasd".includes(k) && k.length === 1) player.keys[k] = true;
  if (k === "e") { if (S.nearest) selectAgent(S.nearest.id); }
  if (k === "v") toggleView(); if (k === "escape" && S.selected) selectAgent(null);
});
addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); if (k === "shift") player.keys.shift = false; if ("wasd".includes(k) && k.length === 1) player.keys[k] = false; });
addEventListener("blur", () => { player.keys = {}; });
canvas.addEventListener("click", () => { if (!player.locked) canvas.requestPointerLock(); else clickInspect(); });
document.addEventListener("pointerlockchange", () => { player.locked = document.pointerLockElement === canvas; $("#cross").classList.toggle("on", player.locked); if (player.locked) { $("#enter").hidden = true; setTimeout(() => $("#hint").classList.add("gone"), 9000); if (S.soundOn) audio.resume(); } });
document.addEventListener("mousemove", (e) => { if (!player.locked) return; player.yaw -= e.movementX * 0.0021; player.pitch = clamp(player.pitch - e.movementY * 0.0021, -1.25, 1.25); });
const ray = new THREE.Raycaster();
function clickInspect() { ray.setFromCamera(new THREE.Vector2(0, 0), camera); const meshes = []; for (const r of S.order) r.g.traverse(o => { if (o.isMesh) { o.userData.aid = r.id; meshes.push(o); } }); const hit = ray.intersectObjects(meshes, false)[0]; if (hit && hit.distance < 30) selectAgent(hit.object.userData.aid); else if (S.nearest) selectAgent(S.nearest.id); }

// interaction prompt + location toast
function updateInteraction(now) {
  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw)); let best = null, bd = 3.4;
  for (const r of S.order) { const dx = r.x - player.pos.x, dz = r.z - player.pos.z, d = Math.hypot(dx, dz); if (d > bd) continue; if (S.view === "fp" && (dx * fwd.x + dz * fwd.z) / (d || 1) < 0.45) continue; bd = d; best = r; }
  S.nearest = best; const pr = $("#prompt"); pr.classList.toggle("on", !!best); $("#cross").classList.toggle("hot", !!best);
  if (best) { $("#p-who").textContent = "Talk to " + best.name; $("#p-role").textContent = best.occupation || ""; }
  // toast
  let here = null; const tx = Math.floor(player.pos.x + S.W / 2), tz = Math.floor(player.pos.z + S.H / 2);
  for (const l of S.locs) { if (!l.blocking && tx >= l.x && tx < l.x + l.w && tz >= l.y && tz < l.y + l.h) { here = l; break; } const ax = W2X(l.anchor[0] + .5), az = W2Z(l.anchor[1] + .5); if (Math.hypot(ax - player.pos.x, az - player.pos.z) < 2.2) { here = l; break; } }
  const name = here ? here.name : null;
  if (name !== S.lastLoc) { S.lastLoc = name; if (name) { $("#t-n").textContent = name; $("#t-k").textContent = ({ cafe: "café", study: "library & study", art: "studio", shop: "shop", civic: "school", park: "park", plaza: "town square", home: "home" })[here.kind] || here.kind; $("#toast").classList.add("on"); S.toastT = now + 2600; } }
  if (S.toastT && now > S.toastT) { $("#toast").classList.remove("on"); S.toastT = 0; }
}

// minimap
const mm = $("#minimap"), mctx = mm.getContext("2d");
function drawMinimap() {
  const w = mm.width, h = mm.height, sx = w / (S.W + 4), sz = h / (S.H + 4);
  const X = (wx) => (wx + S.W / 2 + 2) * sx, Z = (wz) => (wz + S.H / 2 + 2) * sz;
  mctx.clearRect(0, 0, w, h); mctx.fillStyle = "#4f8a45"; mctx.fillRect(0, 0, w, h);
  for (const l of S.locs) { const x = X(W2X(l.x)), z = Z(W2Z(l.y)), ww = l.w * sx, hh = l.h * sz; mctx.fillStyle = l.blocking ? l.color : (l.kind === "park" ? "#6fae55" : "#c9bda0"); mctx.beginPath(); mctx.roundRect(x, z, ww, hh, 3); mctx.fill(); }
  if (S.party && S.cafe) { const g = mctx.createRadialGradient(X(S.cafe.x), Z(S.cafe.front), 2, X(S.cafe.x), Z(S.cafe.front), 22); g.addColorStop(0, "rgba(255,120,160,.7)"); g.addColorStop(1, "rgba(255,120,160,0)"); mctx.fillStyle = g; mctx.fillRect(0, 0, w, h); }
  for (const r of S.order) { mctx.fillStyle = "#" + r.color.getHexString(); mctx.beginPath(); mctx.arc(X(r.x), Z(r.z), 2.6, 0, 7); mctx.fill(); if (S.knowers.has(r.id)) { mctx.strokeStyle = "#ffd36b"; mctx.lineWidth = 1.2; mctx.stroke(); } if (S.selected === r.id) { mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(X(r.x), Z(r.z), 4.5, 0, 7); mctx.stroke(); } }
  // player
  const px = X(player.pos.x), pz = Z(player.pos.z), a = player.yaw;
  mctx.fillStyle = "rgba(255,211,107,.25)"; mctx.beginPath(); mctx.moveTo(px, pz); mctx.arc(px, pz, 22, -a - Math.PI / 2 - 0.6 + Math.PI, -a - Math.PI / 2 + 0.6 + Math.PI); mctx.closePath(); mctx.fill();
  mctx.save(); mctx.translate(px, pz); mctx.rotate(-a + Math.PI); mctx.fillStyle = "#ffd36b"; mctx.strokeStyle = "#2a1808"; mctx.lineWidth = 1.2; mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4.5, 5); mctx.lineTo(0, 2.5); mctx.lineTo(-4.5, 5); mctx.closePath(); mctx.fill(); mctx.stroke(); mctx.restore();
}

// ============================================================ audio (procedural ambience, off by default)
const audio = (() => {
  let ctx = null, master = null, timer = null;
  function start() {
    if (ctx) return; ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.0; master.connect(ctx.destination);
    // wind: filtered noise
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; const g = ctx.createGain(); g.gain.value = 0.35; src.connect(lp); lp.connect(g); g.connect(master); src.start();
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 0.15; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    timer = setInterval(() => { if (!S.soundOn) return; if (L.night < 0.5 && Math.random() < 0.55) chirp(); if (L.night > 0.5 && Math.random() < 0.8) cricket(); }, 900);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 1.5);
  }
  function chirp() { const t = ctx.currentTime; for (let i = 0; i < 2 + Math.random() * 3; i++) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; const f = 2200 + Math.random() * 1400, st = t + i * 0.13; o.frequency.setValueAtTime(f, st); o.frequency.exponentialRampToValueAtTime(f * 1.5, st + 0.08); g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.07, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.12); o.connect(g); g.connect(master); o.start(st); o.stop(st + 0.14); } }
  function cricket() { const t = ctx.currentTime; for (let i = 0; i < 6; i++) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = 4300 + Math.random() * 300; const st = t + i * 0.055; g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.012, st + 0.01); g.gain.linearRampToValueAtTime(0, st + 0.04); o.connect(g); g.connect(master); o.start(st); o.stop(st + 0.05); } }
  return { start, resume: () => ctx && ctx.resume(), setOn: (on) => { if (on) { start(); ctx.resume(); master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.5); } else if (master) master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4); } };
})();

// ============================================================ data
function setLoad(pct, text) { $("#load-bar").style.width = pct + "%"; if (text) $("#load-s").textContent = text; }
async function connect() {
  setLoad(8, "painting textures…"); buildTextures(); buildMaterials(); buildSky();
  setLoad(22, "fetching the town…"); const world = await (await fetch(API + "/api/world")).json();
  setLoad(40, "raising buildings…"); buildWorld(world);
  setLoad(72, "planting trees…"); buildAtmosphere();
  setLoad(86, "waking the villagers…"); const st = await (await fetch(API + "/api/state")).json(); onState(st);
  const pz = world.locations.find(l => l.name === "Town Plaza"); if (pz) player.pos.set(W2X(pz.x + pz.w / 2), 0, W2Z(pz.y + pz.h) + 4);
  setLoad(100, "ready"); setTimeout(() => $("#load").classList.add("out"), 300);
  connectWS();
}
function connectWS() { const proto = location.protocol === "https:" ? "wss" : "ws"; const ws = new WebSocket(`${proto}://${location.host}/ws`); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "state") onState(m); }; ws.onclose = () => setTimeout(connectWS, 1200); }

function onState(st) {
  S.clock = st.clock; S.party = st.party; if (typeof st.speed === "number") S.speed = st.speed;
  if (typeof st.running === "boolean") { S.running = st.running; $("#b-play").textContent = st.running ? "⏸ Pause" : "▶ Play"; }
  S.atParty = new Set(st.at_party || []);
  applyAgents(st.agents); updateKnowers(st);
  // bubbles from fresh dialogue events
  const byFirst = {}; for (const r of S.order) byFirst[r.name] = r; const now = performance.now();
  for (const e of st.events || []) { if (e.kind !== "dialogue" || e.tick < st.clock.tick - 1 || e.tick <= S.lastEventTick - 1) continue; const m = /^(\w+) & (\w+):/.exec(e.text); if (!m) continue; for (const nm of [m[1], m[2]]) { const r = byFirst[nm]; if (r) { r.bubbleUntil = now + 3200; r.bubbleHl = !!e.highlight; } } }
  S.lastEventTick = st.clock.tick;
  S.events = st.events || []; renderFeed();
  const n = st.agents.length; $("#m-agents").textContent = n; $("#m-know").textContent = st.n_knowers || 0; $("#m-know-bar").style.width = ((st.n_knowers || 0) / n * 100) + "%"; $("#m-party").textContent = (st.at_party || []).length;
  if (st.metrics) $("#m-calls").textContent = Math.round(st.metrics.cost.calls_per_sim_day).toLocaleString();
  if (S.selected) refreshInspector(S.selected);
}
function updateKnowers(st) {
  if (!st.party) { S.knowers.clear(); return; } const first = {}; for (const r of S.order) first[r.name] = r.id; S.knowers.add(st.party.host);
  for (const e of st.events || []) { if (!/party/i.test(e.text)) continue; const m = /^(\w+) & (\w+):/.exec(e.text); if (m) { if (first[m[1]]) S.knowers.add(first[m[1]]); if (first[m[2]]) S.knowers.add(first[m[2]]); } }
  for (const id of st.at_party || []) S.knowers.add(id);
}
async function control(action, value) { const r = await fetch(API + "/api/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, value }) }); onState(await r.json()); }

// ============================================================ HUD
function renderFeed() {
  const sig = S.events.length ? S.events[S.events.length - 1].tick + ":" + S.events.length : ""; if (sig === S.feedSig) return; S.feedSig = sig;
  const list = $("#gaz-list"); list.innerHTML = "";
  for (const e of S.events.slice(-30).reverse()) { const d = document.createElement("div"); d.className = "gi kind-" + e.kind + (e.highlight ? " hl" : ""); d.innerHTML = `<span class="t">D${e.day} ${e.hhmm}</span><span class="d"></span><span class="x">${esc(e.text)}</span>`; list.appendChild(d); }
}
function drawClock(now) {
  const c = $("#sky").getContext("2d"), s = 48; c.clearRect(0, 0, s, s); c.save(); c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, 7); c.clip();
  const g = c.createLinearGradient(0, 0, 0, s); g.addColorStop(0, "#" + L.top.getHexString()); g.addColorStop(1, "#" + L.bot.getHexString()); c.fillStyle = g; c.fillRect(0, 0, s, s);
  const t = clamp((L.hr - 6) / 12, 0, 1), a = Math.PI + t * Math.PI, x = s / 2 + 15 * Math.cos(a), y = s * .62 + 13 * Math.sin(a);
  if (L.night < .6) { c.fillStyle = "#ffe08a"; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); } else { c.fillStyle = "#eef"; c.beginPath(); c.arc(s / 2 - 15 * Math.cos(a), s * .62 - 13 * Math.sin(a) + 26, 4.5, 0, 7); c.fill(); }
  c.restore();
  $("#c-time").textContent = S.clock.hhmm; $("#c-day").textContent = "Day " + S.clock.day; const hr = S.clock.minute_of_day / 60;
  $("#c-period").textContent = hr < 5 ? "Night" : hr < 8 ? "Dawn" : hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : hr < 20 ? "Evening" : "Night";
}

// ============================================================ inspector
async function refreshInspector(id) { try { const d = await (await fetch(API + "/api/agent/" + encodeURIComponent(id))).json(); if (S.selected === id) renderInspector(d); } catch (e) { } }
function selectAgent(id) { S.selected = id; const el = $("#insp"); document.body.classList.toggle("insp-open", !!id); if (id) { el.classList.add("open"); refreshInspector(id); } else el.classList.remove("open"); }
function renderInspector(d) {
  const p = d.persona, r = S.agents.get(p.name), color = "#" + (r ? r.color.getHexString() : "888"), nowMin = S.clock.minute_of_day, cur = d.current_action || "";
  const plan = d.plan.map(s => { const [h, m] = s.time.split(":").map(Number), tm = h * 60 + m, isNow = cur && s.desc && cur.slice(0, 16) === s.desc.slice(0, 16), ev = /event|party/i.test(s.desc) ? " event" : ""; return `<div class="pstep ${isNow ? "now" : tm < nowMin ? "done" : ""}${ev}"><span class="pt">${s.time}</span><span>${esc(s.desc)}</span></div>`; }).join("");
  const mem = (arr, sc = true) => arr.map(m => { let bars = ""; if (sc && m.components) { const c = m.components; bars = `<div class="bars"><div class="b rec" style="width:${Math.round(c.recency * 30)}px"></div><div class="b imp" style="width:${Math.round(c.importance * 30)}px"></div><div class="b rel" style="width:${Math.round(c.relevance * 30)}px"></div></div><span class="score">${m.score.toFixed(2)}</span>`; } return `<div class="mem"><div class="tx">${esc(m.text)}</div><div class="mt"><span class="badge kind-${m.kind}">${m.kind}</span><span class="badge">imp ${m.importance}</span>${bars}</div></div>`; }).join("");
  const refl = (d.reflections || []).slice().reverse().map(m => `<div class="refl">${esc(m.text)}</div>`).join("") || `<div class="story">No reflections yet.</div>`;
  const rels = Object.entries(p.relationships || {}).map(([k, v]) => { const o = S.agents.get(k); return `<div class="rel"><span class="sw" style="background:${o ? "#" + o.color.getHexString() : "#888"}"></span><b>${esc(k)}</b><span>— ${esc(v)}</span></div>`; }).join("");
  const going = r && r.moving && r.target ? `<div class="going">Heading to <b>${esc(r.target)}</b></div>` : (d.location ? `<div class="going">At <b>${esc(d.location)}</b></div>` : "");
  const mono = p.name.split(" ").map(w => w[0]).join("").slice(0, 2);
  $("#insp-body").innerHTML = `<div class="ihead"><div class="iav" style="background:linear-gradient(135deg,${color},#0008)">${mono}</div><div><div class="iname" style="color:${color}">${esc(p.name)}</div><div class="irole">${esc(p.occupation)} · age ${p.age}</div><div class="chips">${p.traits.map(t => `<span class="chip">${esc(t)}</span>`).join("")}<span class="chip loc">🏠 ${esc(p.home)}</span></div></div></div>
    <div class="sec"><h4>Right now</h4><div class="thought">${esc(cur || "…")}</div>${going}</div>
    <div class="sec"><h4>Today's plan</h4><div class="plan">${plan}</div></div>
    <div class="sec"><h4>Why — retrieved memories</h4><div class="legend"><span><i style="background:var(--sky)"></i>recency</span><span><i style="background:#ff8c69"></i>importance</span><span><i style="background:var(--mint)"></i>relevance</span></div>${mem(d.top_retrieved)}</div>
    <div class="sec"><h4>Reflections</h4>${refl}</div><div class="sec"><h4>Recent</h4>${mem(d.recent_memories, false)}</div>
    <div class="sec"><h4>Relationships</h4>${rels || "<div class='story'>—</div>"}</div>
    <div class="sec"><h4>Who they are</h4><div class="story">${esc(p.backstory)}<br><br><b style="color:var(--text)">Goals:</b> ${esc(p.goals.join("; "))}</div></div>`;
}
function toggleView() { S.view = S.view === "fp" ? "tp" : "fp"; $("#b-view").textContent = S.view === "fp" ? "👁 1st" : "👁 3rd"; }

// wire
$("#b-play").onclick = () => control(S.running ? "pause" : "play"); $("#b-step").onclick = () => control("step"); $("#b-seed").onclick = () => control("seed_party");
$("#b-reset").onclick = () => { S.knowers.clear(); control("reset"); }; $("#b-view").onclick = toggleView;
$("#speed").oninput = (e) => { $("#speed-v").textContent = e.target.value + "×"; control("speed", Number(e.target.value)); };
$("#insp-x").onclick = () => selectAgent(null);
$("#gaz-t").onclick = () => { const g = $("#gaz"); g.classList.toggle("collapsed"); $("#gaz-t").textContent = g.classList.contains("collapsed") ? "+" : "−"; };
$("#enter").onclick = () => canvas.requestPointerLock();
$("#b-quality").textContent = HI ? "✦ High" : "✦ Low"; $("#b-quality").onclick = () => { localStorage.setItem("agora3d.quality", HI ? "low" : "high"); location.reload(); };
$("#b-sound").onclick = () => { S.soundOn = !S.soundOn; $("#b-sound").textContent = S.soundOn ? "🔊" : "🔇"; $("#b-sound").classList.toggle("on", S.soundOn); audio.setOn(S.soundOn); };
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight); if (composer) composer.setSize(innerWidth, innerHeight); });
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ============================================================ loop
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsChecked = false;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updatePlayer(dt, now); updateChars(dt, now); updateSky(S.clock.minute_of_day, now); updateAtmosphere(dt, now); updateParty(dt, now);
  updateInteraction(now); drawMinimap(); drawClock(now);
  if (composer) composer.render(); else renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  if (S._frozen) return;   // debug: pause the loop so a static frame can be captured
  // adaptive quality: if High can't hold ~35fps in the first 8s, drop to Low once
  if (HI && !fpsChecked && now > 4000) { fpsAcc += 1 / Math.max(dt, 1e-3); fpsN++; if (now > 12000) { fpsChecked = true; if (fpsAcc / fpsN < 34 && !sessionStorage.getItem("agora3d.autolow")) { sessionStorage.setItem("agora3d.autolow", "1"); localStorage.setItem("agora3d.quality", "low"); location.reload(); } } }
  requestAnimationFrame(loop);
}
connect().then(() => requestAnimationFrame(loop)).catch(err => { $("#load-s").innerHTML = `Couldn't reach the backend — run <code>py -3.12 run.py</code> and reload.<br>${esc(String(err))}`; });

// debug hook (testing / screenshots without pointer lock)
window.T3 = { player, S, camera, control, selectAgent, setView: (v) => { S.view = v; },
  freeze: (ms = 4000) => { S._frozen = true; setTimeout(() => { S._frozen = false; last = performance.now(); requestAnimationFrame(loop); }, ms); },
  spectate: (px, py, pz, lx, ly, lz) => { S._spectate = { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) }; }, unspectate: () => { S._spectate = null; } };

/* AGORA characters: deterministic procedural avatars.
   Each villager gets a stable look from a hash of its id (skin, hair style &
   colour, outfit, accessories), with its signature colour as the shirt. Drawn
   with canvas primitives -- original art, no sprite sheets. */
"use strict";
(function () {
  const C = (window.AGORA_CHARS = {});
  const U = () => window.AGORA_WORLD.util;

  const SKINS = ["#f7dcc0", "#eec19c", "#d9a274", "#b97f58", "#8d5a3c", "#f2cfae", "#c98e66"];
  const HAIRS = ["#2a1b13", "#4b2f1f", "#7d4a25", "#b4773a", "#d9b56b", "#a8433a", "#6e6a6a", "#1a1a1e", "#e0c8a0"];
  const PANTS = ["#2e3a5c", "#3b3b46", "#5a3f2e", "#374d3c", "#4a3a5c", "#6b4c3b"];
  const HATS = ["#c8473a", "#3b6ea5", "#6f4a8a", "#2f7a5a", "#d18a2b"];

  C.make = function (id, color, occupation) {
    const r = U().rng(U().hashStr(id));
    const occ = (occupation || "").toLowerCase();
    const spec = {
      id, color,
      skin: SKINS[(r() * SKINS.length) | 0],
      hair: HAIRS[(r() * HAIRS.length) | 0],
      style: (r() * 6) | 0,             // 0 short 1 bob 2 bun 3 long 4 spiky 5 cap
      pants: PANTS[(r() * PANTS.length) | 0],
      glasses: r() < 0.22,
      blush: r() < 0.5,
      hat: HATS[(r() * HATS.length) | 0],
      phase0: r() * 6.283,
      apron: false, beret: false, headphones: false, bag: false,
    };
    if (/librarian|researcher|software/.test(occ)) spec.glasses = true;
    if (/cafe|barista/.test(occ)) spec.apron = true;
    if (/paint|art/.test(occ)) spec.beret = true;
    if (/musician/.test(occ)) { spec.style = 5; spec.hat = "#2b2b33"; }
    if (/journalist|student/.test(occ)) spec.bag = true;
    if (/gardener/.test(occ)) { spec.style = 5; spec.hat = "#d9b56b"; }
    if (/yoga/.test(occ)) spec.style = 2;
    return spec;
  };

  // draw a villager with feet at (x, y). o = { facing, walk (0..1 phase), moving, time, scale, dim }
  C.draw = function (ctx, s, x, y, o) {
    const sc = o.scale || 1, facing = o.facing || "down", t = o.time || 0;
    const rr = U().rrect;
    const w2 = 2 * Math.PI;
    const swing = o.moving ? Math.sin(o.walk * w2) : 0;
    const bob = o.moving ? Math.abs(Math.sin(o.walk * w2)) * 1.8 : Math.sin(t / 700 + s.phase0) * 0.7;
    const outline = "rgba(45,30,20,0.85)";
    const side = facing === "left" || facing === "right";
    const dir = facing === "left" ? -1 : 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(0, 1, 11, 4.5, 0, 0, w2); ctx.fill();

    const by = -bob; // body vertical offset
    // long hair behind body
    if (s.style === 3 && facing !== "up") { ctx.fillStyle = s.hair; rr(ctx, -9, -34 + by, 18, 20, 6); ctx.fill(); }
    if (s.style === 3 && facing === "up") { ctx.fillStyle = s.hair; rr(ctx, -9, -34 + by, 18, 22, 6); ctx.fill(); }

    // legs
    ctx.fillStyle = s.pants;
    const legDX = side ? swing * 3.2 : 0, legDY = side ? 0 : swing * 2.2;
    rr(ctx, -6 + legDX, -8 + legDY, 5.5, 8 - legDY * 0.5, 2); ctx.fill();
    rr(ctx, 0.5 - legDX, -8 - legDY, 5.5, 8 + legDY * 0.5, 2); ctx.fill();
    ctx.fillStyle = "#2a2222"; rr(ctx, -6.5 + legDX, -2 + legDY * .5, 6.5, 3, 1.5); ctx.fill(); rr(ctx, 0 - legDX, -2 - legDY * .5, 6.5, 3, 1.5); ctx.fill();

    // body (shirt)
    ctx.fillStyle = s.color; rr(ctx, -8, -22 + by, 16, 15, 5); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.13)"; rr(ctx, 2, -22 + by, 6, 15, [0, 5, 5, 0]); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1.4; rr(ctx, -8, -22 + by, 16, 15, 5); ctx.stroke();
    if (s.apron && facing !== "up") { ctx.fillStyle = "#f4ecd8"; rr(ctx, -5, -18 + by, 10, 11, 3); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1; ctx.stroke(); }
    if (s.bag) { ctx.fillStyle = "#8a5a3c"; rr(ctx, side ? -10 * dir - 2 : 6, -16 + by, 5, 8, 2); ctx.fill(); }
    // collar
    if (facing !== "up") { ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.moveTo(-4, -22 + by); ctx.lineTo(0, -18 + by); ctx.lineTo(4, -22 + by); ctx.closePath(); ctx.fill(); }

    // arms
    const armSwing = -swing * 3;
    ctx.fillStyle = s.skin;
    if (side) {
      rr(ctx, -2.5 + armSwing * .6, -20 + by, 5, 11, 2.5); ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = 1.1; ctx.stroke();
    } else {
      rr(ctx, -12, -20 + by + armSwing * .4, 5, 11, 2.5); ctx.fill(); ctx.stroke();
      rr(ctx, 7, -20 + by - armSwing * .4, 5, 11, 2.5); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.1;
      rr(ctx, -12, -20 + by + armSwing * .4, 5, 11, 2.5); ctx.stroke(); rr(ctx, 7, -20 + by - armSwing * .4, 5, 11, 2.5); ctx.stroke();
    }

    // head
    const hy = -31 + by;
    ctx.fillStyle = s.skin; ctx.beginPath(); ctx.arc(0, hy, 10, 0, w2); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1.4; ctx.stroke();
    // ears (side view)
    if (side) { ctx.fillStyle = s.skin; ctx.beginPath(); ctx.arc(-dir * 8, hy + 1, 2.6, 0, w2); ctx.fill(); }

    // hair
    ctx.fillStyle = s.hair;
    if (facing === "up") {
      ctx.beginPath(); ctx.arc(0, hy, 10.3, 0, w2); ctx.fill();
      if (s.style === 2) { ctx.beginPath(); ctx.arc(0, hy - 10, 4.5, 0, w2); ctx.fill(); }
    } else {
      // cap of hair on top
      ctx.beginPath(); ctx.arc(0, hy - 0.5, 10.3, Math.PI, 2 * Math.PI); ctx.fill();
      if (s.style === 0) { ctx.beginPath(); ctx.ellipse(dir * 3, hy - 8, 6, 3, 0, 0, w2); ctx.fill(); }
      if (s.style === 1 || s.style === 3) { rr(ctx, -10.3, hy - 2, 4, 9, 2); ctx.fill(); rr(ctx, 6.3, hy - 2, 4, 9, 2); ctx.fill(); }
      if (s.style === 2) { ctx.beginPath(); ctx.arc(0, hy - 11, 4.5, 0, w2); ctx.fill(); }
      if (s.style === 4) { for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 4 - 3, hy - 8); ctx.lineTo(i * 4, hy - 16 - Math.abs(i)); ctx.lineTo(i * 4 + 3, hy - 8); ctx.closePath(); ctx.fill(); } }
      // fringe
      if (s.style !== 4 && s.style !== 5) { ctx.beginPath(); ctx.ellipse(-dir * 2, hy - 6, 7, 3.2, 0, 0, w2); ctx.fill(); }
    }
    // hats
    if (s.style === 5) {
      ctx.fillStyle = s.hat; ctx.beginPath(); ctx.arc(0, hy - 3, 10.5, Math.PI, 2 * Math.PI); ctx.fill();
      rr(ctx, -12, hy - 4, 24, 4, 2); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(0, hy - 3, 10.5, Math.PI, 2 * Math.PI); ctx.stroke();
    }
    if (s.beret && facing !== "up") { ctx.fillStyle = "#c8473a"; ctx.beginPath(); ctx.ellipse(-dir * 3, hy - 8, 10, 5, -dir * 0.25, 0, w2); ctx.fill(); ctx.strokeStyle = outline; ctx.lineWidth = 1; ctx.stroke(); }

    // face
    if (facing !== "up") {
      ctx.fillStyle = "#2b1d16";
      if (side) { ctx.beginPath(); ctx.ellipse(dir * 4.5, hy - 0.5, 1.5, 2, 0, 0, w2); ctx.fill(); }
      else { ctx.beginPath(); ctx.ellipse(-3.6, hy - 0.5, 1.5, 2, 0, 0, w2); ctx.ellipse(3.6, hy - 0.5, 1.5, 2, 0, 0, w2); ctx.fill(); }
      if (s.blush) { ctx.fillStyle = "rgba(255,120,130,0.35)"; if (side) { ctx.beginPath(); ctx.arc(dir * 5.5, hy + 3, 2, 0, w2); ctx.fill(); } else { ctx.beginPath(); ctx.arc(-5.5, hy + 3, 2, 0, w2); ctx.arc(5.5, hy + 3, 2, 0, w2); ctx.fill(); } }
      ctx.strokeStyle = "rgba(60,30,25,0.7)"; ctx.lineWidth = 1; ctx.beginPath();
      if (side) ctx.arc(dir * 4.5, hy + 4, 2, dir > 0 ? 0.2 : Math.PI - 1.1, dir > 0 ? 1.1 : Math.PI - 0.2); else ctx.arc(0, hy + 3.5, 2.6, 0.3, Math.PI - 0.3);
      ctx.stroke();
      if (s.glasses) { ctx.strokeStyle = "rgba(30,30,40,0.85)"; ctx.lineWidth = 1.2; if (side) { ctx.beginPath(); ctx.arc(dir * 4.5, hy - 0.5, 3.2, 0, w2); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(-3.6, hy - 0.5, 3.2, 0, w2); ctx.stroke(); ctx.beginPath(); ctx.arc(3.6, hy - 0.5, 3.2, 0, w2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-0.4, hy - 0.5); ctx.lineTo(0.4, hy - 0.5); ctx.stroke(); } }
    }
    ctx.restore();
  };

  // portrait for the inspector (canvas element)
  C.drawPortrait = function (canvas, s, time) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 84;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, U().mix(U().toHex(s.color), "#ffffff", 0.55)); g.addColorStop(1, U().mix(U().toHex(s.color), "#000000", 0.25));
    ctx.fillStyle = g; U().rrect(ctx, 0, 0, size, size, 22); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.beginPath(); ctx.arc(size / 2, size * 0.62, size * 0.36, 0, 7); ctx.fill();
    C.draw(ctx, s, size / 2, size * 0.86, { facing: "down", walk: 0, moving: false, time: time || 0, scale: 1.7 });
  };
})();

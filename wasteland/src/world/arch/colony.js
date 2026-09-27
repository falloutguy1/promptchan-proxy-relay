// Colony structures built by the survivors from scavenged timber, tarps and
// scrap. Everything is emitted in local space (ground at y = 0, front = +Z) with
// real dimensions. Construction is staged: each piece has a build threshold t in
// [0, 1] and is only emitted once progress reaches it, so frames rise, walls fill
// in board by board and roofs go on last. Sites carry stakes, string and a lumber
// pile until finished. Damage removes pieces (missing boards, sheets).
import * as THREE from 'three';
import { Geo } from './geom.js';
import { RNG } from '../../core/rng.js';
import { TILES } from './house.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const COLONY_TILES = { ...TILES, lamp: 1, beacon: 1, redcross: 1, sign: 1 };

const WOOD = ['wood_weathered:#b9ad98', 'wood_weathered:#c4b8a2', 'wood_weathered:#a99b86'];
const DARKWOOD = 'wood_weathered:#94866f';
const CHAR = 'wood_weathered:#4a4038';
const ROPE = 'burlap:#8c7a5a';
const SHEETS = ['corr_rust', 'corr_worn'];

/**
 * type: key of STRUCTURES. Returns { geo: Map(key -> BufferGeometry), models: [...], spots: {...}, height }.
 * opts: { progress 0..1, damage 0..1, growth 0..1 (farm), open (gate), w, d }
 */
export function buildStructure(type, seed, opts = {}) {
  const progress = opts.progress ?? 1;
  const rng = new RNG(seed * 7919 + 13);
  const g = new Geo(COLONY_TILES);
  g.exposure = 1;
  const at = (t) => progress >= t - 1e-6;
  const out = { models: [], spots: {}, height: 2 };
  const ctx = { g, rng, at, out, progress, damage: opts.damage ?? 0, growth: opts.growth ?? 0, open: opts.open ?? true, keep: (p = 0.6) => rng.next() > (opts.damage ?? 0) * p };
  const fn = BUILDERS[type];
  if (fn) fn(ctx);
  if (progress < 1 && type !== 'farm') site(ctx, opts.w ?? 3, opts.d ?? 3, type);
  out.geo = g.build();
  return out;
}

const model = (out, id, x, y, z, ry = 0, s = 1, variant = -1, rx = 0, rz = 0) => out.models.push({ id, x, y, z, ry, s, variant, rx, rz });

/** Construction site dressing: corner stakes with string, lumber pile, sheets. */
function site({ g, rng, out, progress }, w, d, type) {
  if (progress < 0.35) {
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    for (const [x, z] of pts) g.beam(DARKWOOD, V(x, -0.15, z), V(x + rng.float(-0.02, 0.02), 0.5, z), 0.04, 0.04, 0.005);
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      g.tube(ROPE, [V(a[0], 0.34, a[1]), V((a[0] + b[0]) / 2, 0.31, (a[1] + b[1]) / 2), V(b[0], 0.34, b[1])], 0.005, 3);
    }
  }
  // lumber pile beside the site shrinks as it is used up
  const n = Math.ceil(7 * (1 - progress));
  const px = w / 2 + 1.1;
  if (n > 0) {
    g.pushTRS(px, 0, 0, Math.PI / 2 + rng.float(-0.15, 0.15));
    for (const bz of [-0.9, 0.9]) g.box(DARKWOOD, 0, 0.04, bz, 0.9, 0.08, 0.08, 0.01);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 4), k = i % 4;
      g.pushTRS(-0.33 + k * 0.22 + rng.float(-0.02, 0.02), 0.1 + row * 0.045, rng.float(-0.1, 0.1), rng.float(-0.04, 0.04));
      g.box(rng.pick(WOOD), 0, 0, 0, 0.19, 0.035, 2.6 + rng.float(-0.2, 0.2), 0.006);
      g.pop();
    }
    g.pop();
  }
  if (progress < 0.8 && type !== 'campfire' && type !== 'lamp') {
    g.pushTRS(-w / 2 - 0.7, 0, rng.float(-0.4, 0.4), rng.float(-0.3, 0.3), 0, 0);
    for (let i = 0; i < 2; i++) { g.pushTRS(i * 0.12, 0.8, 0, 0, 0, -0.35); g.box(rng.pick(SHEETS), 0, 0, 0, 0.02, 1.7, 0.85, 0); g.pop(); }
    g.pop();
  }
}

// ------------------------------------------------------------------ shared pieces
/** Horizontal board wall between two posts along local X at depth z. */
function boards(g, rng, keep, at, { x0, x1, z, y0 = 0.15, top, openings = [], t0 = 0.35, t1 = 0.8, thick = 0.025, face = 1, keyFn = null }) {
  const rowH = 0.19, gap = 0.012;
  for (let y = y0; ; y += rowH + gap) {
    const topAt = (x) => (typeof top === 'function' ? top(x) : top);
    if (y + rowH * 0.5 > Math.max(topAt(x0), topAt(x1))) break;
    const t = t0 + (t1 - t0) * Math.min(1, (y - y0) / Math.max(0.5, Math.max(topAt(x0), topAt(x1)) - y0));
    if (!at(t)) continue;
    // split around openings
    let segs = [[x0, x1]];
    for (const o of openings) {
      if (y + rowH < o.v0 || y > o.v1) continue;
      const next = [];
      for (const [a, b] of segs) {
        if (o.u1 <= a || o.u0 >= b) { next.push([a, b]); continue; }
        if (o.u0 > a) next.push([a, o.u0]);
        if (o.u1 < b) next.push([o.u1, b]);
      }
      segs = next;
    }
    for (let [a, b] of segs) {
      // trim to a sloped top: keep only where the board fits under the top line
      if (typeof top === 'function') {
        const fits = (x) => y + rowH <= top(x) + 0.02;
        if (!fits(a) && !fits(b)) continue;
        if (!fits(a)) { let lo = a, hi = b; for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; } a = hi; }
        if (!fits(b)) { let lo = a, hi = b; for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; } b = lo; }
      }
      if (b - a < 0.15 || !keep()) continue;
      const jitter = rng.float(-0.012, 0.012);
      g.pushTRS((a + b) / 2, y + rowH / 2 + jitter, z + face * rng.float(0, 0.006), 0, 0, rng.float(-0.012, 0.012));
      g.box(keyFn ? keyFn() : rng.pick(WOOD), 0, 0, 0, b - a + rng.float(-0.02, 0.03), rowH, thick, 0.006);
      g.pop();
    }
  }
}

/** Corrugated sheet roof over [x0,x1] spanning z0..z1, heights y(z). */
function sheetRoof(g, rng, keep, at, { x0, x1, z0, z1, y0, y1, t0 = 0.85, t1 = 1, overhang = 0.25, width = 0.9 }) {
  const n = Math.ceil((x1 - x0 + overhang * 2) / (width * 0.9));
  const len = Math.hypot(z1 - z0 + overhang * 2, y1 - y0);
  const ang = Math.atan2(y1 - y0, z1 - z0);
  for (let i = 0; i < n; i++) {
    if (!at(t0 + ((t1 - t0) * i) / n) || !keep(0.8)) continue;
    const x = x0 - overhang + width / 2 + i * (width * 0.9);
    g.pushTRS(x, (y0 + y1) / 2 + 0.03 + i * 0.004, (z0 + z1) / 2, 0, -ang + rng.float(-0.01, 0.01), rng.float(-0.01, 0.01));
    g.box(rng.pick(SHEETS), 0, 0, 0, width, 0.02, len + rng.float(-0.05, 0.08), 0.004);
    g.pop();
  }
}

function canvasSlope(g, key, a, b, c, d, sag, su = 3, sv = 4, rng) {
  // bilinear patch a(0,0) b(1,0) c(1,1) d(0,1), sagging along its normal direction
  const P = (u, v) => {
    const p = V(0, 0, 0).addScaledVector(a, (1 - u) * (1 - v)).addScaledVector(b, u * (1 - v)).addScaledVector(c, u * v).addScaledVector(d, (1 - u) * v);
    p.y -= sag * Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(Math.PI * v)) + (rng ? rng.float(-0.006, 0.006) : 0);
    return p;
  };
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  if (n.y < 0) n.negate();
  const lu = a.distanceTo(b), lv = a.distanceTo(d);
  for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
    const u0 = i / su, u1 = (i + 1) / su, v0 = j / sv, v1 = (j + 1) / sv;
    const p00 = P(u0, v0), p10 = P(u1, v0), p11 = P(u1, v1), p01 = P(u0, v1);
    const fn = new THREE.Vector3().subVectors(p10, p00).cross(new THREE.Vector3().subVectors(p01, p00)).normalize();
    if (fn.dot(n) < 0) fn.negate();
    g.quad(key, p00, p10, p11, p01, fn, [[u0 * lu, v0 * lv], [u1 * lu, v0 * lv], [u1 * lu, v1 * lv], [u0 * lu, v1 * lv]]);
  }
}

function rope(g, a, b, sag = 0.05) {
  const m = a.clone().lerp(b, 0.5); m.y -= sag;
  g.tube(ROPE, [a, m, b], 0.006, 3);
}

// ------------------------------------------------------------------ builders
const BUILDERS = {
  tent({ g, rng, at, out }) {
    const W = 2.3, L = 3.0, H = 1.62;
    const cloth = `canvas:${rng.pick(['#b8b28c', '#c4bb96', '#a9aa88', '#bfb394'])}`;
    if (at(0)) g.box('burlap:#3b3a33', 0, 0.012, 0, W + 0.1, 0.012, L + 0.1, 0);
    if (at(0.1)) {
      for (const z of [-L / 2, L / 2]) g.beam(DARKWOOD, V(0, -0.1, z), V(0, H + 0.08, z), 0.045, 0.045, 0.008);
      g.beam(DARKWOOD, V(0, H, -L / 2 - 0.06), V(0, H, L / 2 + 0.06), 0.04, 0.04, 0.008);
    }
    if (at(0.4)) for (const s of [-1, 1]) {
      canvasSlope(g, cloth, V(0, H, -L / 2), V(s * W / 2, 0.14, -L / 2), V(s * W / 2, 0.14, L / 2), V(0, H, L / 2), 0.05, 3, 4, rng);
      g.quad(cloth, V(s * W / 2, 0.14, -L / 2), V(s * W / 2, 0.14, L / 2), V(s * W / 2, 0.0, L / 2), V(s * W / 2, 0.0, -L / 2), V(s, 0, 0), [[0, 0], [L, 0], [L, 0.14], [0, 0.14]]);
    }
    if (at(0.7)) {
      g.quad(cloth, V(-W / 2, 0.0, -L / 2), V(W / 2, 0.0, -L / 2), V(W / 2, 0.14, -L / 2), V(-W / 2, 0.14, -L / 2), V(0, 0, -1), [[0, 0], [W, 0], [W, 0.14], [0, 0.14]]);
      g.quad(cloth, V(-W / 2, 0.14, -L / 2), V(W / 2, 0.14, -L / 2), V(0, H, -L / 2), V(0, H, -L / 2), V(0, 0, -1), [[0, 0], [W, 0], [W / 2, H], [W / 2, H]]);
      // front: one flap closed, the other rolled back and tied
      g.quad(cloth, V(-W / 2, 0.0, L / 2), V(0, 0.0, L / 2), V(0, H, L / 2), V(-W / 2, 0.14, L / 2), V(0, 0, 1), [[0, 0], [W / 2, 0], [W / 2, H], [0, 0.14]]);
      g.tube(cloth, [V(0.06, H - 0.12, L / 2 + 0.03), V(0.5, 0.8, L / 2 + 0.05), V(W / 2 - 0.08, 0.2, L / 2 + 0.03)], 0.055, 8, true);
    }
    if (at(0.9)) {
      for (const s of [-1, 1]) {
        rope(g, V(0, H + 0.05, s * (L / 2 + 0.05)), V(0, 0.02, s * (L / 2 + 1.0)), 0.04);
        g.beam(DARKWOOD, V(0, -0.05, s * (L / 2 + 1.0)), V(0, 0.16, s * (L / 2 + 0.96)), 0.035, 0.035, 0.004);
        for (const e of [-1, 1]) {
          rope(g, V(s * W / 2, 0.14, e * L * 0.3), V(s * (W / 2 + 0.55), 0.02, e * L * 0.3), 0.02);
          g.beam(DARKWOOD, V(s * (W / 2 + 0.55), -0.05, e * L * 0.3), V(s * (W / 2 + 0.52), 0.14, e * L * 0.3), 0.03, 0.03, 0.004);
        }
      }
      // bedrolls inside
      for (const x of [-0.5, 0.5]) g.tube(`canvas:${rng.pick(['#5c6e58', '#8a4c40', '#56606e'])}`, [V(x, 0.09, -1.0), V(x, 0.09, 0.8)], 0.08, 8, true);
    }
    out.spots.door = [0, L / 2 + 0.7];
    out.height = H;
  },

  shack({ g, rng, at, out, keep }) {
    const W = 4.0, D = 3.4, Hf = 2.5, Hb = 2.05;
    const h = (z) => Hb + (Hf - Hb) * ((z + D / 2) / D);
    if (at(0)) {
      for (const s of [-1, 1]) { g.box(DARKWOOD, 0, 0.08, s * D / 2, W + 0.1, 0.16, 0.16, 0.01); g.box(DARKWOOD, s * W / 2, 0.08, 0, 0.16, 0.16, D, 0.01); }
      g.box('floor_wood:#8a7a66', 0, 0.17, 0, W - 0.1, 0.03, D - 0.1, 0);
    }
    const posts = [[-W / 2, -D / 2], [0, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [-1.35, D / 2], [-0.45, D / 2], [0.6, D / 2], [W / 2, D / 2], [-W / 2, 0], [W / 2, 0]];
    posts.forEach(([x, z], i) => { if (at(0.12 + 0.18 * (i / posts.length))) g.beam(DARKWOOD, V(x, 0.16, z), V(x, h(z) - 0.05, z), 0.1, 0.1, 0.01); });
    if (at(0.32)) {
      g.beam(DARKWOOD, V(-W / 2, Hf - 0.02, D / 2), V(W / 2, Hf - 0.02, D / 2), 0.1, 0.1, 0.01);
      g.beam(DARKWOOD, V(-W / 2, Hb - 0.02, -D / 2), V(W / 2, Hb - 0.02, -D / 2), 0.1, 0.1, 0.01);
      for (const s of [-1, 1]) g.beam(DARKWOOD, V(s * W / 2, Hb - 0.02, -D / 2), V(s * W / 2, Hf - 0.02, D / 2), 0.1, 0.1, 0.01);
    }
    const door = { u0: -1.3, u1: -0.5, v0: 0, v1: 1.95 }, win = { u0: 0.75, u1: 1.45, v0: 1.0, v1: 1.6 };
    boards(g, rng, keep, at, { x0: -W / 2 - 0.05, x1: W / 2 + 0.05, z: D / 2 + 0.07, top: Hf - 0.05, openings: [door, win], face: 1 });
    boards(g, rng, keep, at, { x0: -W / 2 - 0.05, x1: W / 2 + 0.05, z: -D / 2 - 0.07, top: Hb - 0.05, face: -1, t0: 0.4 });
    for (const s of [-1, 1]) {
      g.pushTRS(s * (W / 2 + 0.07), 0, 0, Math.PI / 2);
      // local x runs along world -z here; top follows the roof slope
      boards(g, rng, keep, at, { x0: -D / 2, x1: D / 2, z: 0, top: (x) => h(-x) - 0.05, face: 1, t0: 0.45, openings: s > 0 ? [{ u0: -0.3, u1: 0.3, v0: 1.1, v1: 1.5 }] : [] });
      g.pop();
    }
    if (at(0.82)) {
      // plank door on its hinge, a little ajar
      g.pushTRS(-1.3, 0.2, D / 2 + 0.09, -0.55);
      for (let i = 0; i < 5; i++) g.box(rng.pick(WOOD), 0.08 + i * 0.16, 0.9, 0, 0.155, 1.78, 0.03, 0.005);
      g.box(DARKWOOD, 0.4, 0.35, 0.03, 0.78, 0.1, 0.025, 0.005); g.box(DARKWOOD, 0.4, 1.45, 0.03, 0.78, 0.1, 0.025, 0.005);
      g.pushTRS(0.4, 0.9, 0.03, 0, 0, Math.atan2(1.1, 0.7)); g.box(DARKWOOD, 0, 0, 0, 1.25, 0.09, 0.025, 0.005); g.pop();
      g.pop();
      // window: frame and hazy plastic sheet
      g.box(DARKWOOD, 1.1, 1.0, D / 2 + 0.1, 0.78, 0.05, 0.05, 0.005); g.box(DARKWOOD, 1.1, 1.6, D / 2 + 0.1, 0.78, 0.05, 0.05, 0.005);
      g.box(DARKWOOD, 0.73, 1.3, D / 2 + 0.1, 0.05, 0.6, 0.05, 0.005); g.box(DARKWOOD, 1.47, 1.3, D / 2 + 0.1, 0.05, 0.6, 0.05, 0.005);
      g.quad('glass', V(0.76, 1.03, D / 2 + 0.08), V(1.44, 1.03, D / 2 + 0.08), V(1.44, 1.57, D / 2 + 0.08), V(0.76, 1.57, D / 2 + 0.08), V(0, 0, 1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    if (at(0.8)) for (const z of [-D / 2 - 0.15, 0, D / 2 + 0.15]) g.beam(DARKWOOD, V(-W / 2 - 0.2, h(z) + 0.05, z), V(W / 2 + 0.2, h(z) + 0.05, z), 0.08, 0.1, 0.01);
    sheetRoof(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2, y0: Hb + 0.1, y1: Hf + 0.1, overhang: 0.3 });
    if (at(0.97)) {
      g.tube('dark', [V(1.25, 0.9, -1.05), V(1.25, h(-1.05) + 0.9, -1.05)], 0.06, 10);
      g.lathe('dark', [[0.001, h(-1.05) + 1.08], [0.16, h(-1.05) + 0.95], [0.16, h(-1.05) + 0.93]], 10);
      out.spots.smoke = [1.25, h(-1.05) + 1.0, -1.05];
    }
    if (at(1)) {
      model(out, 'barrel_stove', 1.25, 0.18, -1.05, 0.4);
      model(out, 'old_bed_frame', -1.3, 0.18, -0.55, 0, 0.95);
      model(out, 'wooden_crate_01', 0.2, 0.18, -1.35, 0.1);
    }
    out.spots.door = [-0.9, D / 2 + 0.8];
    out.height = Hf + 0.3;
  },

  campfire({ g, rng, at, out }) {
    if (at(0)) model(out, 'stone_fire_pit', 0, 0.1, 0, rng.float(0, 6));
    if (at(0.3)) for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng.float(-0.2, 0.2), r = 0.36;
      g.tube(i % 2 ? CHAR : 'wood_weathered:#4e4236', [V(Math.cos(a) * r, 0.08, Math.sin(a) * r), V(Math.cos(a) * 0.05, 0.5 + rng.float(-0.05, 0.05), Math.sin(a) * 0.05)], 0.045, 6, true);
    }
    const seats = [];
    if (at(0.6)) for (const a of [0.35, 2.4, 4.3]) {
      const r = 1.75, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const tx = -Math.sin(a) * 0.75, tz = Math.cos(a) * 0.75;
      g.tube('wood_weathered:#b0a08a', [V(cx - tx, 0.15, cz - tz), V(cx + tx, 0.17, cz + tz)], 0.16, 10, true);
      seats.push([Math.cos(a) * 1.35, Math.sin(a) * 1.35, Math.atan2(-Math.cos(a), -Math.sin(a))]);
    }
    if (at(0.9)) {
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; g.tube('dark', [V(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62), V(0, 1.12, 0)], 0.012, 5); }
      g.tube('dark', [V(0, 1.12, 0), V(0, 0.78, 0)], 0.005, 3);
      g.lathe('dark', [[0.001, 0.58], [0.12, 0.6], [0.15, 0.68], [0.15, 0.78], [0.14, 0.79]], 12);
    }
    out.spots.fire = [0, 0.25, 0];
    out.spots.light = [0, 0.9, 0];
    out.spots.seats = seats;
    out.height = 1.2;
  },

  storage({ g, rng, at, out, keep }) {
    const W = 4.0, D = 2.8, Hf = 2.5, Hb = 1.95;
    const h = (z) => Hb + (Hf - Hb) * ((z + D / 2) / D);
    if (at(0)) for (const px of [-1.3, 0, 1.3]) {
      g.pushTRS(px, 0, -0.2, rng.float(-0.05, 0.05));
      for (const x of [-0.5, 0, 0.5]) g.box(DARKWOOD, x, 0.05, 0, 0.09, 0.09, 1.1, 0.008);
      for (let i = 0; i < 6; i++) g.box(rng.pick(WOOD), 0, 0.115, -0.5 + i * 0.2, 1.15, 0.022, 0.12, 0.004);
      g.pop();
    }
    const posts = [[-W / 2, -D / 2], [0, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]];
    posts.forEach(([x, z], i) => { if (at(0.15 + i * 0.04)) g.beam(DARKWOOD, V(x, -0.2, z), V(x, h(z), z), 0.11, 0.11, 0.01); });
    boards(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z: -D / 2 - 0.07, top: Hb - 0.05, face: -1, t0: 0.4, t1: 0.65 });
    for (const s of [-1, 1]) {
      g.pushTRS(s * (W / 2 + 0.07), 0, 0, Math.PI / 2);
      boards(g, rng, keep, at, { x0: -D / 2, x1: D / 2, z: 0, top: 1.2, face: 1, t0: 0.6, t1: 0.72 });
      g.pop();
    }
    if (at(0.75)) for (const x of [-W / 2, -W / 4, 0, W / 4, W / 2]) g.beam(DARKWOOD, V(x, h(-D / 2) + 0.05, -D / 2 - 0.25), V(x, h(D / 2) + 0.05, D / 2 + 0.25), 0.07, 0.12, 0.01);
    sheetRoof(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2, y0: Hb + 0.14, y1: Hf + 0.14, overhang: 0.3 });
    if (at(1)) {
      model(out, 'wooden_crate_01', -1.3, 0.14, -0.35, rng.float(-0.2, 0.2));
      model(out, 'wooden_crate_01', -1.25, 0.49, -0.3, rng.float(-0.3, 0.3));
      model(out, 'plastic_crate_01', 0.1, 0.14, -0.4, rng.float(-0.3, 0.3));
      model(out, 'cardboard_box_01', 0.35, 0.14, 0.1, rng.float(0, 3));
      model(out, 'cement_bag', -0.2, 0.14, 0.2, rng.float(0, 3));
      model(out, 'Barrel_01', 1.25, 0.14, -0.5, rng.float(0, 6));
      model(out, 'Barrel_02', 1.5, 0.0, 0.8, rng.float(0, 6));
      model(out, 'metal_jerrycan_green', 1.0, 0.14, 0.2, rng.float(0, 6));
      model(out, 'russian_food_cans_01', -1.1, 0.84, -0.3, rng.float(0, 6));
    }
    out.spots.door = [0, D / 2 + 0.7];
    out.height = Hf + 0.2;
  },

  rain_collector({ g, rng, at, out }) {
    const S = 0.85, H = 1.95;
    if (at(0)) model(out, 'Barrel_01', 0, 0, 0, rng.float(0, 6));
    if (at(0.2)) for (const [x, z] of [[-S, -S], [S, -S], [S, S], [-S, S]]) g.beam(DARKWOOD, V(x, -0.2, z), V(x * 0.98, H, z * 0.98), 0.08, 0.08, 0.008);
    if (at(0.4)) for (const [a, b] of [[[-S, -S], [S, -S]], [[S, -S], [S, S]], [[S, S], [-S, S]], [[-S, S], [-S, -S]]]) g.beam(DARKWOOD, V(a[0], H - 0.04, a[1]), V(b[0], H - 0.04, b[1]), 0.06, 0.06, 0.006);
    if (at(0.6)) {
      const tarp = `canvas:${rng.pick(['#71838f', '#809066', '#8f9395'])}`;
      const c = V(0, 1.35, 0);
      const e = [V(-S - 0.08, H + 0.02, -S - 0.08), V(S + 0.08, H + 0.02, -S - 0.08), V(S + 0.08, H + 0.02, S + 0.08), V(-S - 0.08, H + 0.02, S + 0.08)];
      for (let i = 0; i < 4; i++) {
        const a = e[i], b = e[(i + 1) % 4];
        const m = a.clone().lerp(b, 0.5); m.y -= 0.07;
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        if (n.y < 0) n.negate();
        g.quad(tarp, a, m, c, c, n, [[0, 0], [0.9, 0], [0.9, 0.9], [0.9, 0.9]]);
        g.quad(tarp, m, b, c, c, n, [[0.9, 0], [1.8, 0], [0.9, 0.9], [0.9, 0.9]]);
      }
      g.tube('metal_white:#5a5a55', [V(0, 1.37, 0), V(0, 0.9, 0)], 0.035, 8);
    }
    if (at(0.9)) for (const [x, z] of [[-S, -S], [S, -S], [S, S], [-S, S]]) rope(g, V(x * 1.08, H + 0.02, z * 1.08), V(x, H - 0.1, z), 0.01);
    out.spots.work = [0, 1.2];
    out.height = H;
  },

  well({ g, rng, at, out }) {
    const ring = rng.chance(0.5) ? 'concrete:#8f8a80' : 'brick_red:#b0a090';
    if (at(0)) {
      g.lathe(ring, [[0.86, -0.05], [0.86, 0.72], [0.84, 0.78], [0.66, 0.78], [0.64, 0.72], [0.64, -0.6]], 20);
      g.lathe('dark', [[0.001, -0.42], [0.65, -0.42]], 16);
    }
    if (at(0.3)) for (const s of [-1, 1]) g.beam(DARKWOOD, V(s * 0.98, -0.2, 0), V(s * 0.98, 1.95, 0), 0.12, 0.12, 0.01);
    if (at(0.55)) {
      g.tube(DARKWOOD, [V(-0.92, 1.3, 0), V(0.92, 1.3, 0)], 0.075, 10, true);
      g.tube('dark', [V(1.04, 1.3, 0), V(1.2, 1.3, 0), V(1.2, 1.08, 0), V(1.3, 1.08, 0)], 0.014, 6);
      g.tube(ROPE, [V(0, 1.25, 0), V(0, 0.95, 0)], 0.011, 4);
      model(out, 'wooden_bucket_01', 0.42, 0.79, 0.34, rng.float(0, 6), 0.9);
    }
    if (at(0.75)) {
      g.beam(DARKWOOD, V(-1.12, 2.28, 0), V(1.12, 2.28, 0), 0.08, 0.1, 0.01);
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
        const z0 = s * 0.03, z1 = s * 0.85;
        const x = -1.05 + i * 0.42;
        g.pushTRS(x, (2.3 + 1.86) / 2 + 0.03, (z0 + z1) / 2, 0, s * Math.atan2(2.3 - 1.86, 0.82), 0);
        g.box(rng.pick(WOOD), 0, 0, 0, 0.41, 0.025, 0.95, 0.005);
        g.pop();
      }
    }
    out.spots.work = [0, 1.25];
    out.height = 2.4;
  },

  farm({ g, rng, at, out, growth }) {
    const W = 8, D = 6;
    if (at(0.2)) {
      const posts = [[-W / 2, -D / 2], [0, -D / 2], [W / 2, -D / 2], [W / 2, 0], [W / 2, D / 2], [0.8, D / 2], [-0.8, D / 2], [-W / 2, D / 2], [-W / 2, 0]];
      for (const [x, z] of posts) g.beam(DARKWOOD, V(x, -0.2, z), V(x + rng.float(-0.03, 0.03), 0.95, z + rng.float(-0.03, 0.03)), 0.07, 0.07, 0.008);
      if (at(0.5)) for (const y of [0.42, 0.78]) {
        const loop = [[0.8, D / 2], [W / 2, D / 2], [W / 2, 0], [W / 2, -D / 2], [0, -D / 2], [-W / 2, -D / 2], [-W / 2, 0], [-W / 2, D / 2], [-0.8, D / 2]];
        for (let i = 0; i < loop.length - 1; i++) {
          const a = V(loop[i][0], y, loop[i][1]), b = V(loop[i + 1][0], y, loop[i + 1][1]);
          const m = a.clone().lerp(b, 0.5); m.y -= 0.035;
          g.tube('dark', [a, m, b], 0.004, 3);
        }
      }
    }
    if (at(0.8)) {
      // scarecrow
      g.tube(DARKWOOD, [V(3.3, -0.2, -2.5), V(3.3, 1.95, -2.5)], 0.045, 6);
      g.tube(DARKWOOD, [V(2.85, 1.55, -2.5), V(3.75, 1.57, -2.5)], 0.035, 6);
      g.pushTRS(3.3, 1.3, -2.5, 0.2, 0, 0.05); g.box('canvas:#5a4a3a', 0, 0, 0, 0.55, 0.62, 0.2, 0.05); g.pop();
      g.pushTRS(3.3, 0, -2.5, 0);
      g.lathe('burlap:#a08c64', [[0.001, 1.7], [0.1, 1.73], [0.13, 1.82], [0.1, 1.92], [0.001, 1.95]], 10);
      g.lathe('canvas:#5a4e40', [[0.001, 2.06], [0.1, 2.05], [0.11, 1.95], [0.22, 1.93], [0.22, 1.91]], 12);
      g.pop();
      model(out, 'rusted_spade_01', -3.75, 0.35, 2.4, 0.3, 1, -1, -0.25, 0);
      model(out, 'watering_can_metal_01', -3.3, 0, 2.75, rng.float(0, 6));
    }
    if (at(1) && growth > 0.02) {
      // potato rows on the ridges between furrows (leaf-card plants, see cropGeometry)
      out.crops = [];
      const s0 = 0.2 + 0.8 * Math.min(1, growth);
      for (let r = 0; r < 5; r++) for (let i = 0; i < 12; i++) {
        const x = -3.3 + i * 0.6 + rng.float(-0.06, 0.06), z = -2.2 + r * 1.1 + rng.float(-0.05, 0.05);
        out.crops.push({ x, z, s: s0 * rng.float(0.8, 1.15), rot: rng.float(0, Math.PI), sprite: rng.int(0, 1), phase: rng.float(0, 6) });
      }
    }
    const work = [];
    for (let r = 0; r < 4; r++) work.push([-2.5 + (r % 2) * 4, -1.65 + r * 1.1]);
    out.spots.work = work;
    out.spots.door = [0, D / 2 + 0.6];
    out.height = 1.2;
  },

  workshop({ g, rng, at, out, keep }) {
    const W = 4.8, D = 3.8, Hf = 2.7, Hb = 2.25;
    const h = (z) => Hb + (Hf - Hb) * ((z + D / 2) / D);
    if (at(0)) g.box('concrete:#8a857a', 0, 0.04, 0, W, 0.08, D, 0.02);
    const posts = [[-W / 2, -D / 2], [0, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [0, D / 2], [W / 2, D / 2], [-W / 2, 0], [W / 2, 0]];
    posts.forEach(([x, z], i) => { if (at(0.15 + i * 0.025)) g.beam(DARKWOOD, V(x, 0.08, z), V(x, h(z), z), 0.12, 0.12, 0.01); });
    if (at(0.35)) for (let i = 0; i < 6; i++) {
      if (!keep()) continue;
      g.pushTRS(-W / 2 + 0.42 + i * 0.8, 1.15, -D / 2 - 0.08, rng.float(-0.02, 0.02), 0, rng.float(-0.015, 0.015));
      g.box(rng.pick(SHEETS), 0, 0, 0, 0.86, 2.15, 0.02, 0.004);
      g.pop();
    }
    for (const s of [-1, 1]) {
      g.pushTRS(s * (W / 2 + 0.07), 0, 0, Math.PI / 2);
      boards(g, rng, keep, at, { x0: -D / 2, x1: D / 2, z: 0, y0: 0.1, top: 1.35, face: 1, t0: 0.5, t1: 0.7 });
      g.pop();
    }
    if (at(0.75)) for (const x of [-W / 2, -W / 4, 0, W / 4, W / 2]) g.beam(DARKWOOD, V(x, h(-D / 2) + 0.05, -D / 2 - 0.3), V(x, h(D / 2) + 0.05, D / 2 + 0.3), 0.07, 0.13, 0.01);
    sheetRoof(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2, y0: Hb + 0.15, y1: Hf + 0.15, overhang: 0.35 });
    if (at(1)) {
      model(out, 'WoodenTable_01', 0.2, 0.08, -1.45, 0);
      model(out, 'steel_frame_shelves_01', -1.85, 0.08, -1.5, 0);
      model(out, 'Barrel_01', 2.0, 0.08, -1.4, rng.float(0, 6));
      model(out, 'metal_jerrycan_green', 1.75, 0.08, -0.7, 1.2);
      model(out, 'propane_tank', 2.05, 0.08, -0.45, 0.4);
      model(out, 'old_tyre', 1.95, 0.2, 1.2, 0.3, 1, -1, Math.PI / 2, 0);
      model(out, 'old_tyre', 1.95, 0.42, 1.2, 1.1, 1, -1, Math.PI / 2, 0);
      model(out, 'hatchet', 0.7, 0.64, -1.4, 1.2, 1, -1, 0, Math.PI / 2);
      model(out, 'rusted_wheel_rim_01', -0.6, 0.64, -1.5, 0.2);
      // vice on the bench, tools hanging on the back wall, scrap pile
      g.box('metal_green', -0.45, 0.7, -1.3, 0.14, 0.1, 0.12, 0.01);
      for (let i = 0; i < 5; i++) g.box('dark', -0.7 + i * 0.28, 1.35 + rng.float(-0.1, 0.1), -D / 2 + 0.02, 0.03, rng.float(0.2, 0.42), 0.02, 0.004);
      for (let i = 0; i < 7; i++) {
        g.pushTRS(-1.6 + rng.float(-0.4, 0.4), 0.12 + rng.float(0, 0.2), 1.0 + rng.float(-0.4, 0.4), rng.float(0, 6), rng.float(-0.6, 0.6), rng.float(-0.6, 0.6));
        g.box(rng.pick(['corr_rust', 'metal_red', 'metal_green', 'corr_worn']), 0, 0, 0, rng.float(0.2, 0.7), 0.02, rng.float(0.15, 0.5), 0.004);
        g.pop();
      }
    }
    out.spots.work = [0.2, -0.7];
    out.spots.door = [0, D / 2 + 0.6];
    out.height = Hf + 0.3;
  },

  watchtower({ g, rng, at, out, keep }) {
    const B = 1.25, T = 0.98, P = 4.5, R = 6.25;
    const leg = (sx, sz, y) => V(sx * (B + (T - B) * (y / R)), y, sz * (B + (T - B) * (y / R)));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    corners.forEach(([sx, sz], i) => { if (at(0.05 + i * 0.05)) g.beam(DARKWOOD, leg(sx, sz, -0.25), leg(sx, sz, R), 0.17, 0.17, 0.015); });
    if (at(0.3)) for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      for (const [y0, y1] of [[0.3, 2.4], [2.4, 4.4]]) {
        if (!keep(0.4)) continue;
        g.beam(rng.pick(WOOD), leg(ax, az, y0).multiplyScalar(1.02), leg(bx, bz, y1).multiplyScalar(1.02), 0.09, 0.05, 0.006);
        g.beam(rng.pick(WOOD), leg(bx, bz, y0).multiplyScalar(1.03), leg(ax, az, y1).multiplyScalar(1.03), 0.09, 0.05, 0.006);
      }
    }
    if (at(0.5)) {
      for (const s of [-1, 1]) g.beam(DARKWOOD, V(-1.3, P - 0.12, s * 1.02), V(1.3, P - 0.12, s * 1.02), 0.12, 0.16, 0.01);
      for (let i = 0; i < 15; i++) g.box(rng.pick(WOOD), 0, P, -1.3 + 0.08 + i * 0.172, 2.7, 0.05, 0.165, 0.006);
    }
    if (at(0.62)) {
      // ladder up the front
      for (const x of [-0.05, 0.45]) g.beam(DARKWOOD, V(x, -0.1, 1.75), V(x, P + 0.9, 1.08), 0.07, 0.05, 0.006);
      for (let y = 0.3; y < P; y += 0.3) { const z = 1.75 - (0.67 * y) / (P + 1); g.beam(rng.pick(WOOD), V(-0.05, y, z), V(0.45, y, z), 0.035, 0.035, 0.004); }
    }
    if (at(0.72)) {
      // railing + plank parapet (gap at the ladder)
      for (const y of [P + 0.45, P + 0.95]) for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
        const a = leg(ax, az, y), b = leg(bx, bz, y);
        if (i === 2) { const m = a.clone().lerp(b, 0.62); g.beam(rng.pick(WOOD), a, m.clone().setX(0.55), 0.04, 0.14, 0.005); continue; }
        g.beam(rng.pick(WOOD), a, b, 0.04, 0.14, 0.005);
      }
      for (let i = 0; i < 9; i++) if (keep()) g.box('burlap:#b7a88a', -0.9 + (i % 3) * 0.62, P + 0.14 + Math.floor(i / 3) * 0.02, -1.08 + (i > 5 ? 0 : 0), 0.56, 0.2, 0.32, 0.06);
    }
    if (at(0.86)) {
      g.pushTRS(0, R + 0.1, 0, 0);
      for (const s of [-1, 1]) {
        g.pushTRS(0, 0.18, s * 0.72, 0, s * -0.42, 0);
        g.box(rng.pick(SHEETS), 0, 0, 0, 2.7, 0.02, 1.6, 0.004);
        g.pop();
      }
      g.pop();
      g.beam(DARKWOOD, V(-1.3, R + 0.42, 0), V(1.3, R + 0.42, 0), 0.08, 0.1, 0.008);
    }
    if (at(1)) model(out, 'portable_searchlight', 0.9, P + 1.02, 0.92, 0.7, 1.6);
    out.spots.guard = [[0.35, P + 0.03, 0.2], [-0.45, P + 0.03, -0.35]];
    out.spots.ladder = [0.2, 2.2];
    out.spots.light = [0.9, P + 1.3, 0.95];
    out.height = R + 0.6;
  },

  barricade({ g, rng, at, out, keep, damage }) {
    const L = 4.0;
    const posts = [-L / 2 + 0.1, 0, L / 2 - 0.1];
    posts.forEach((x, i) => { if (at(0.08 + i * 0.06)) g.beam(DARKWOOD, V(x, -0.35, 0), V(x + rng.float(-0.06, 0.06), 1.85 + rng.float(-0.12, 0.15), rng.float(-0.05, 0.05)), 0.14, 0.14, 0.012); });
    if (at(0.3)) for (let r = 0; r < 5; r++) {
      if (!at(0.3 + r * 0.08)) continue;
      for (const half of [-1, 1]) {
        if (!keep(0.7)) continue;
        const y = 0.25 + r * 0.34 + rng.float(-0.05, 0.05);
        g.pushTRS(half * L / 4 + rng.float(-0.1, 0.1), y, 0.1 + rng.float(0, 0.02), rng.float(-0.03, 0.03), 0, rng.float(-0.08, 0.08));
        g.box(rng.pick(WOOD), 0, 0, 0, L / 2 + rng.float(0.05, 0.3), rng.float(0.16, 0.24), 0.035, 0.006);
        g.pop();
      }
    }
    if (at(0.55)) for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) if (keep(0.3)) g.beam(DARKWOOD, V(x, 1.5, -0.05), V(x * 0.9, -0.1, -1.0), 0.09, 0.09, 0.008);
    if (at(0.75)) for (let i = 0; i < 3; i++) {
      if (!keep() || rng.chance(0.25)) continue;
      g.pushTRS(-1.3 + i * 1.3 + rng.float(-0.25, 0.25), 0.85 + rng.float(-0.1, 0.15), 0.16, rng.float(-0.06, 0.06), 0, rng.float(-0.12, 0.12));
      g.box(rng.pick(SHEETS), 0, 0, 0, rng.float(0.8, 1.0), rng.float(1.3, 1.7), 0.02, 0.004);
      g.pop();
    }
    if (at(0.85) && rng.chance(0.6)) for (let i = 0; i < 6; i++) if (keep()) g.box('burlap:#b7a88a', -1.5 + (i % 3) * 0.6 + rng.float(-0.05, 0.05), 0.11 + Math.floor(i / 3) * 0.2, 0.42, 0.56, 0.2, 0.32, 0.06);
    if (at(0.92)) for (let i = 0; i < 4; i++) {
      if (!keep()) continue;
      const x = -1.5 + i + rng.float(-0.15, 0.15);
      g.tube(rng.pick(WOOD), [V(x, -0.1, 0.25), V(x + rng.float(-0.1, 0.1), 0.95, 1.05)], [0.055, 0.02], 6, true);
    }
    out.height = 1.9 * (1 - damage * 0.4);
  },

  gate({ g, rng, at, out, open }) {
    const L = 4.0;
    for (const s of [-1, 1]) if (at(0.1)) g.beam(DARKWOOD, V(s * (L / 2 - 0.12), -0.4, 0), V(s * (L / 2 - 0.12), 2.35, 0), 0.2, 0.2, 0.015);
    if (at(0.3)) g.beam(DARKWOOD, V(-L / 2 - 0.1, 2.25, 0), V(L / 2 + 0.1, 2.25, 0), 0.14, 0.16, 0.012);
    if (at(0.9)) {
      // hand-painted name board hung under the lintel, a little crooked
      g.pushTRS(0.15, 1.98, 0.1, 0, 0, rng.float(-0.05, 0.05));
      g.box(rng.pick(WOOD), 0, 0, 0, 1.7, 0.36, 0.03, 0.006);
      g.quad('sign:RUSTWATER', V(-0.8, -0.16, 0.017), V(0.8, -0.16, 0.017), V(0.8, 0.16, 0.017), V(-0.8, 0.16, 0.017), V(0, 0, 1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      g.pop();
      for (const x of [-0.7, 1.0]) rope(g, V(x, 2.18, 0.08), V(x, 2.15, 0.1), 0.0);
    }
    if (at(0.5)) for (const s of [-1, 1]) {
      // leaf hinged on its post; swung inward (-Z) when open
      g.pushTRS(s * (L / 2 - 0.25), 0.1, 0, open ? s * 1.25 : 0);
      g.pushTRS(-s * 0.9, 0, 0);
      for (let i = 0; i < 6; i++) g.box(rng.pick(WOOD), -0.78 + i * 0.31, 0.95, 0, 0.29, 1.7 + rng.float(-0.08, 0.08), 0.035, 0.006);
      g.box(DARKWOOD, 0, 0.35, 0.04, 1.8, 0.11, 0.035, 0.006); g.box(DARKWOOD, 0, 1.55, 0.04, 1.8, 0.11, 0.035, 0.006);
      g.pushTRS(0, 0.95, 0.045, 0, 0, s * Math.atan2(1.2, 1.7)); g.box(DARKWOOD, 0, 0, 0, 2.05, 0.1, 0.03, 0.006); g.pop();
      g.pop(); g.pop();
    }
    out.height = 2.4;
  },

  lamp({ g, rng, at, out }) {
    if (at(0.2)) g.tube('wood_weathered:#8a7a66', [V(0, -0.4, 0), V(rng.float(-0.05, 0.05), 5.3, 0)], [0.11, 0.085], 10, true);
    if (at(0.5)) g.beam(DARKWOOD, V(-0.5, 4.95, 0), V(0.5, 4.95, 0), 0.08, 0.1, 0.008);
    if (at(0.8)) {
      model(out, 'portable_searchlight', 0, 5.07, 0.18, 0, 2.3, -1, -0.45, 0);
      g.tube('dark', [V(0.08, 5.0, 0.05), V(0.1, 3.5, 0.1), V(0.1, 0.4, 0.1), V(0.3, 0.02, 0.5)], 0.012, 4);
    }
    out.spots.light = [0, 5.0, 0.5];
    out.height = 5.4;
  },

  infirmary({ g, rng, at, out }) {
    const W = 4.2, L = 4.8, Hw = 1.55, Hr = 2.75;
    const cloth = 'canvas:#cfcab8';
    const pole = 'metal_white:#8a8a82';
    if (at(0)) g.box('burlap:#4a4a42', 0, 0.012, 0, W, 0.012, L, 0);
    if (at(0.1)) for (const z of [-L / 2, 0, L / 2]) {
      for (const s of [-1, 1]) { g.tube(pole, [V(s * W / 2, 0, z), V(s * W / 2, Hw, z)], 0.025, 6); g.tube(pole, [V(s * W / 2, Hw, z), V(0, Hr, z)], 0.022, 6); }
    }
    if (at(0.5)) {
      for (const s of [-1, 1]) {
        g.quad(cloth, V(s * W / 2, 0, -L / 2), V(s * W / 2, 0, L / 2), V(s * W / 2, Hw, L / 2), V(s * W / 2, Hw, -L / 2), V(s, 0, 0), [[0, 0], [L, 0], [L, Hw], [0, Hw]]);
        canvasSlope(g, cloth, V(0, Hr, -L / 2), V(s * (W / 2 + 0.12), Hw - 0.08, -L / 2), V(s * (W / 2 + 0.12), Hw - 0.08, L / 2), V(0, Hr, L / 2), 0.05, 3, 4, rng);
      }
      g.quad(cloth, V(-W / 2, 0, -L / 2), V(W / 2, 0, -L / 2), V(W / 2, Hw, -L / 2), V(-W / 2, Hw, -L / 2), V(0, 0, -1), [[0, 0], [W, 0], [W, Hw], [0, Hw]]);
      g.quad(cloth, V(-W / 2, Hw, -L / 2), V(W / 2, Hw, -L / 2), V(0, Hr, -L / 2), V(0, Hr, -L / 2), V(0, 0, -1), [[0, 0], [W, 0], [W / 2, 1.2], [W / 2, 1.2]]);
      // front with a door opening, flaps rolled up
      for (const s of [-1, 1]) g.quad(cloth, V(s * 0.6, 0, L / 2), V(s * W / 2, 0, L / 2), V(s * W / 2, Hw, L / 2), V(s * 0.6, Hw + 0.35, L / 2), V(0, 0, 1), [[0, 0], [1.5, 0], [1.5, Hw], [0, Hw]]);
      g.quad(cloth, V(-0.6, Hw + 0.35, L / 2), V(0.6, Hw + 0.35, L / 2), V(0, Hr, L / 2), V(0, Hr, L / 2), V(0, 0, 1), [[0, 0], [1.2, 0], [0.6, 1.2], [0.6, 1.2]]);
      g.tube(cloth, [V(-0.62, Hw + 0.3, L / 2 + 0.04), V(0.62, Hw + 0.3, L / 2 + 0.04)], 0.07, 8, true);
    }
    if (at(0.8)) {
      // red crosses on the roof and over the door
      for (const s of [-1, 1]) {
        const a = Math.atan2(Hr - Hw, W / 2);
        g.pushTRS(s * W / 4, (Hr + Hw) / 2 + 0.03, 0, 0, 0, -s * a);
        g.quad('redcross', V(-0.55, 0, -0.55), V(0.55, 0, -0.55), V(0.55, 0, 0.55), V(-0.55, 0, 0.55), V(0, 1, 0), [[0, 1], [1, 1], [1, 0], [0, 0]]);
        g.pop();
      }
      g.quad('redcross', V(-0.35, Hw + 0.5, L / 2 + 0.02), V(0.35, Hw + 0.5, L / 2 + 0.02), V(0.35, Hw + 1.0, L / 2 + 0.02), V(-0.35, Hw + 1.0, L / 2 + 0.02), V(0, 0, 1), [[0, 1], [1, 1], [1, 0], [0, 0]]);
      for (const s of [-1, 1]) for (const z of [-L / 2, L / 2]) rope(g, V(s * W / 2, Hw, z), V(s * (W / 2 + 0.9), 0.02, z + Math.sign(z) * 0.4), 0.03);
    }
    if (at(1)) {
      model(out, 'old_bed_frame', -1.35, 0.02, -1.1, 0, 0.95);
      model(out, 'old_bed_frame', -1.35, 0.02, 1.15, 0, 0.95);
      model(out, 'old_bed_frame', 1.35, 0.02, -1.1, 0, 0.95);
      model(out, 'old_military_crate', 1.3, 0.02, 1.2, Math.PI / 2 + 0.1, 0.9);
      model(out, 'medical_box', 1.3, 0.3, 1.25, 0.3);
    }
    out.spots.beds = [[-1.35, -1.1], [-1.35, 1.15], [1.35, -1.1]];
    out.spots.work = [0.3, 0.2];
    out.spots.door = [0, L / 2 + 0.7];
    out.height = Hr;
  },

  generator({ g, rng, at, out }) {
    if (at(0)) {
      for (const z of [-0.45, 0.45]) g.box('metal_green:#5a6048', 0, 0.06, z, 1.9, 0.12, 0.12, 0.01);
      for (let i = 0; i < 7; i++) g.box(rng.pick(WOOD), -0.85 + i * 0.28, 0.135, 0, 0.26, 0.03, 1.2, 0.005);
    }
    if (at(0.45)) model(out, 'portable_generator', -0.15, 0.15, 0, 0, 1.55);
    if (at(0.7)) {
      g.tube('dark', [V(0.45, 0.72, -0.25), V(0.62, 0.8, -0.3), V(0.62, 1.75, -0.3)], 0.035, 8);
      g.lathe('dark', [[0.001, 1.9], [0.09, 1.82], [0.09, 1.8]], 10);
    }
    if (at(0.8)) {
      model(out, 'metal_jerrycan_green', 0.8, 0.15, 0.35, 1.4);
      model(out, 'plastic_jerrycan', 0.85, 0.15, -0.1, 0.9);
      model(out, 'metal_jerrycan_green', 1.25, 0, 0.6, 2.5, 1, -1, 0, Math.PI / 2 - 0.1);
    }
    if (at(0.9)) g.tube('dark', [V(-0.75, 0.35, 0.1), V(-0.95, 0.03, 0.2), V(-1.6, 0.02, 0.5), V(-3.0, 0.02, 0.9)], 0.014, 4);
    if (at(0.95)) {
      for (const [x, z] of [[-1.0, -0.75], [1.0, -0.75], [1.0, 0.75], [-1.0, 0.75]]) g.beam(DARKWOOD, V(x, -0.2, z), V(x, z < 0 ? 1.7 : 1.95, z), 0.07, 0.07, 0.006);
      g.pushTRS(0, 1.9, 0, 0, -Math.atan2(0.25, 1.5), 0); g.box(rng.pick(SHEETS), 0, 0, 0, 2.3, 0.02, 1.8, 0.004); g.pop();
    }
    out.spots.smoke = [0.62, 1.95, -0.3];
    out.spots.work = [1.0, 0.9];
    out.height = 2.0;
  },

  radio({ g, rng, at, out, keep }) {
    // radio hut
    const hx = -0.9, hz = 0.7, W = 2.2, D = 2.0, H = 2.2;
    g.pushTRS(hx, 0, hz, 0);
    if (at(0)) g.box('floor_wood:#8a7a66', 0, 0.08, 0, W, 0.08, D, 0.01);
    if (at(0.08)) for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]]) g.beam(DARKWOOD, V(x, 0.08, z), V(x, H, z), 0.1, 0.1, 0.01);
    boards(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z: -D / 2 - 0.06, top: H - 0.05, face: -1, t0: 0.12, t1: 0.25 });
    boards(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z: D / 2 + 0.06, top: H - 0.05, face: 1, t0: 0.12, t1: 0.25, openings: [{ u0: -0.9, u1: -0.1, v0: 0, v1: 1.9 }, { u0: 0.3, u1: 0.9, v0: 1.0, v1: 1.5 }] });
    for (const s of [-1, 1]) { g.pushTRS(s * (W / 2 + 0.06), 0, 0, Math.PI / 2); boards(g, rng, keep, at, { x0: -D / 2, x1: D / 2, z: 0, top: H - 0.05, face: 1, t0: 0.15, t1: 0.28 }); g.pop(); }
    sheetRoof(g, rng, keep, at, { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2, y0: H + 0.05, y1: H + 0.25, t0: 0.28, t1: 0.33, overhang: 0.25 });
    if (at(1)) { model(out, 'WoodenTable_01', 0.2, 0.12, -0.65, 0, 0.62); model(out, 'vintage_radio_transceiver', 0.25, 0.47, -0.62, 0.2); }
    g.pop();
    // lattice mast in sections, alternating red/white paint
    const mx = 1.05, mz = -1.05, MH = 16, SEC = 8, R0 = 0.5, R1 = 0.22;
    const legP = (k, y) => { const a = (k / 3) * Math.PI * 2 + 0.3, r = R0 + (R1 - R0) * (y / MH); return V(mx + Math.cos(a) * r, y, mz + Math.sin(a) * r); };
    for (let s = 0; s < SEC; s++) {
      if (!at(0.36 + (0.54 * s) / SEC)) break;
      const y0 = (s * MH) / SEC, y1 = ((s + 1) * MH) / SEC, key = s % 2 ? 'metal_white:#d8d4cc' : 'metal_red:#b04a3a';
      for (let k = 0; k < 3; k++) {
        g.tube(key, [legP(k, y0 - (s ? 0 : 0.3)), legP(k, y1)], 0.028, 6);
        const n = 2;
        for (let j = 0; j < n; j++) {
          const ya = y0 + ((y1 - y0) * j) / n, yb = y0 + ((y1 - y0) * (j + 1)) / n;
          g.tube(key, [legP(k, ya), legP((k + 1) % 3, yb)], 0.011, 4);
          g.tube(key, [legP(k, yb), legP((k + 1) % 3, yb)], 0.011, 4);
        }
      }
    }
    if (at(0.95)) {
      g.tube('metal_white:#b8b4ac', [V(mx, MH, mz), V(mx, MH + 3.2, mz)], [0.03, 0.01], 6);
      for (let i = 0; i < 4; i++) g.tube('metal_white:#b8b4ac', [V(mx - 0.45, MH - 0.8 + i * 0.01, mz + 0.2 + i * 0.28), V(mx + 0.45, MH - 0.8 + i * 0.01, mz + 0.2 + i * 0.28)], 0.008, 4);
      g.tube('metal_white:#b8b4ac', [V(mx, MH - 0.8, mz), V(mx, MH - 0.79, mz + 1.1)], 0.012, 4);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        const top = V(mx + Math.cos(a) * 0.3, MH * 0.66, mz + Math.sin(a) * 0.3), anc = V(mx + Math.cos(a) * 6.5, 0.1, mz + Math.sin(a) * 6.5);
        g.tube('dark', [top, top.clone().lerp(anc, 0.5).add(V(0, -0.15, 0)), anc], 0.006, 3);
        g.box('concrete', anc.x, 0.05, anc.z, 0.4, 0.3, 0.4, 0.03);
      }
      g.lathe('beacon', [[0.001, MH + 0.02], [0.07, MH + 0.07], [0.07, MH + 0.13], [0.001, MH + 0.2]], 8);
      g.tube('dark', [V(hx + 0.9, 2.0, hz - 1.0), V(mx - 0.3, 1.2, mz + 0.3), V(mx, 0.6, mz)], 0.012, 4);
    }
    out.spots.work = [hx + 0.25, hz - 0.1];
    out.spots.door = [hx - 0.5, hz + D / 2 + 0.7];
    out.spots.beacon = [mx, MH + 0.12, mz];
    out.height = MH + 3;
  },

  cache({ g, rng, at, out }) {
    if (at(0)) for (const px of [-0.8, 0.8]) {
      g.pushTRS(px, 0, 0, rng.float(-0.06, 0.06));
      for (const x of [-0.5, 0, 0.5]) g.box(DARKWOOD, x, 0.05, 0, 0.09, 0.09, 1.1, 0.008);
      for (let i = 0; i < 6; i++) g.box(rng.pick(WOOD), 0, 0.115, -0.5 + i * 0.2, 1.15, 0.022, 0.12, 0.004);
      g.pop();
    }
    if (at(0.5)) {
      // tarp on a rope line between two poles
      const H = 1.75;
      for (const x of [-1.6, 1.6]) g.beam(DARKWOOD, V(x, -0.2, 0), V(x, H + 0.05, 0), 0.07, 0.07, 0.008);
      g.tube(ROPE, [V(-1.62, H, 0), V(0, H - 0.05, 0), V(1.62, H, 0)], 0.006, 3);
      const tarp = `canvas:${rng.pick(['#71838f', '#809066'])}`;
      for (const s of [-1, 1]) canvasSlope(g, tarp, V(-1.55, H, 0), V(-1.55, 0.55, s * 1.25), V(1.55, 0.55, s * 1.25), V(1.55, H, 0), 0.06, 2, 3, rng);
      for (const s of [-1, 1]) for (const x of [-1.5, 1.5]) rope(g, V(x, 0.55, s * 1.25), V(x * 1.08, 0.02, s * 1.55), 0.02);
    }
    if (at(1)) {
      model(out, 'wooden_crate_01', -0.8, 0.14, -0.2, 0.1);
      model(out, 'wooden_crate_01', -0.75, 0.49, -0.15, -0.2);
      model(out, 'old_military_crate', 0.8, 0.14, 0.05, 0.05, 0.62);
      model(out, 'plastic_crate_01', 0.75, 0.14, -0.35, 0.3);
      model(out, 'Barrel_01', -1.9, 0, 0.7, 0.4);
      model(out, 'plastic_jerrycan', 1.9, 0, 0.6, 1.2);
      model(out, 'russian_food_cans_01', 0.6, 0.45, 0.2, 0.7);
      model(out, 'cardboard_box_01', -0.2, 0.0, 0.95, 0.3);
    }
    out.spots.door = [0, 1.9];
    out.height = 1.9;
  },

  grave({ g, rng }) {
    g.lathe('burlap:#6a5a46', [[0.001, 0.26], [0.35, 0.2], [0.52, 0.06], [0.56, -0.05]], 10);
    const tilt = rng.float(-0.08, 0.08);
    g.pushTRS(0, 0, -0.75, rng.float(-0.1, 0.1), tilt, 0);
    g.beam(DARKWOOD, V(0, -0.3, 0), V(0, 1.05, 0), 0.07, 0.05, 0.008);
    g.beam(DARKWOOD, V(-0.3, 0.72, 0.03), V(0.3, 0.72, 0.03), 0.06, 0.05, 0.008);
    g.pop();
  },
};

/** The rounded-rect footprint the ghost shows on the ground. */
export function footprintOutline(w, d) {
  const pts = [];
  const r = Math.min(0.3, w / 4, d / 4), segs = 4;
  const c = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI], [w / 2 - r, -d / 2 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of c) for (let i = 0; i <= segs; i++) { const a = a0 + (i / segs) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}

/**
 * Crop plants as three crossed leaf cards each, textured from the broadleaf
 * cluster atlas (sprites: atlas rects with kind 'broad'). Attributes match the
 * tree foliage material (uv, colour, wind), so crops share its shader.
 */
export function cropGeometry(crops, sprites) {
  const broad = sprites.filter((q) => q.kind === 'broad');
  const pos = [], nor = [], uv = [], col = [], wind = [], wear = [], idx = [];
  for (const c of crops) {
    const rect = broad[c.sprite % broad.length];
    const w = 0.62 * c.s, h = 0.55 * c.s;
    for (let k = 0; k < 3; k++) {
      const a = c.rot + (k * Math.PI) / 3;
      const rx = Math.cos(a), rz = Math.sin(a);
      const base = pos.length / 3;
      const corners = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
      const uvs = [[rect.u0, rect.v1], [rect.u1, rect.v1], [rect.u0, rect.v0], [rect.u1, rect.v0]];
      for (let q = 0; q < 4; q++) {
        const [cu, cv] = corners[q];
        // cards splay outward a little at the top, normals bend up for soft volume shading
        const x = c.x + rx * cu * w * (1 + 0.25 * cv), z = c.z + rz * cu * w * (1 + 0.25 * cv), y = 0.02 + cv * h;
        pos.push(x, y, z);
        const nx = -rz * 0.5 + rx * cu * 0.4, ny = 0.75, nz = rx * 0.5 + rz * cu * 0.4, l = Math.hypot(nx, ny, nz);
        nor.push(nx / l, ny / l, nz / l);
        uv.push(uvs[q][0], uvs[q][1]);
        const ao = 0.55 + 0.45 * cv;
        col.push(0.78 * ao, 0.92 * ao, 0.68 * ao);
        wind.push(0.12 * cv, 0.35 * cv, c.phase);
        wear.push(y, 1);
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 3));
  g.setAttribute('wear', new THREE.Float32BufferAttribute(wear, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

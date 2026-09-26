// Industrial, railway and military structures for the target areas.
import * as THREE from 'three';
import { GB, mat4, gableRoof } from './geo.js';
import { rubble } from './archetypes.js';
import { mulberry32 } from '../core/noise.js';

const deg = THREE.MathUtils.degToRad;

function bayWindows(gb, key, m, L, y0, h, bayW, winW, opts = {}) {
  const ops = [];
  const n = Math.floor(L / bayW);
  const off = (L - n * bayW) / 2;
  for (let i = 0; i < n; i++) ops.push({ x: off + i * bayW + (bayW - winW) / 2, y: y0, w: winW, h });
  return ops;
}

// steel-framed industrial window with a grid of small panes
function steelWindow(gb, m, o, inset = 0.2) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  gb.add('glassInd', new THREE.PlaneGeometry(o.w, o.h), m.clone().multiply(mat4(cx, cy, -inset - 0.01)), { aoGround: false });
  const nx = Math.max(2, Math.round(o.w / 0.55)), ny = Math.max(2, Math.round(o.h / 0.5));
  for (let i = 0; i <= nx; i++) gb.add('steel', new THREE.BoxGeometry(0.035, o.h, 0.05), m.clone().multiply(mat4(o.x + o.w * i / nx, cy, -inset)), { aoGround: false });
  for (let j = 0; j <= ny; j++) gb.add('steel', new THREE.BoxGeometry(o.w, 0.035, 0.05), m.clone().multiply(mat4(cx, o.y + o.h * j / ny, -inset)), { aoGround: false });
  gb.add('stone', new THREE.BoxGeometry(o.w + 0.1, 0.08, 0.3), m.clone().multiply(mat4(cx, o.y - 0.04, 0.02)), { aoGround: false });
}

// ---------------------------------------------------------------- sawtooth hall
export function makeSawtoothHall(seed, p) {
  const rnd = mulberry32(seed);
  const L = p.l, Wd = p.w;            // length along x, width along z
  const eave = p.eave ?? 8.5, tooth = 10, hT = 3.6;
  const nT = Math.max(1, Math.round(Wd / tooth));
  const tw = Wd / nT;
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const t = 0.5;
  // long walls
  for (const s of [1, -1]) {
    const m = s > 0 ? mat4(-L / 2, 0, Wd / 2, 0, 0, 0) : mat4(L / 2, 0, -Wd / 2, 0, Math.PI, 0);
    const ops = bayWindows(lod0, 'fbrick', m, L, 1.4, eave - 3.0, 6, 3.6);
    if (s > 0) { ops[1] = { x: ops[1].x - 0.4, y: 0, w: 4.4, h: 4.6, gate: true }; }
    lod0.wall('fbrick', [[0, -0.8], [L, -0.8], [L, eave], [0, eave]], ops, t, m);
    for (const o of ops) {
      if (o.gate) lod0.add('door', new THREE.BoxGeometry(o.w, o.h, 0.1), m.clone().multiply(mat4(o.x + o.w / 2, o.h / 2, -0.35)), { ao: 0.7 });
      else steelWindow(lod0, m, o);
    }
    // pilasters
    for (let x = 0; x <= L; x += 6) lod0.add('fbrick', new THREE.BoxGeometry(0.7, eave + 0.8, 0.25), m.clone().multiply(mat4(Math.min(Math.max(x, 0.35), L - 0.35), (eave - 0.8) / 2, 0.12)));
    lod0.add('stone', new THREE.BoxGeometry(L + 0.4, 0.45, 0.35), m.clone().multiply(mat4(L / 2, eave - 0.1, 0.12)), { aoGround: false });
    lod1.wall('fbrick', [[0, -0.8], [L, -0.8], [L, eave], [0, eave]], [], 0.3, m);
    for (const o of ops) lod1.add('glassFar', new THREE.PlaneGeometry(o.w, o.h), m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, 0.03)), { aoGround: false });
    const pts = [[0, -0.8], [L, -0.8]];
    for (let k = 10; k >= 0; k--) pts.push([L * k / 10, 1 + rnd() * (eave - 1)]);
    ruin.wall('fbrick', pts, [], t, m, { ao: 0.5 });
  }
  // end walls with sawtooth outline
  for (const s of [1, -1]) {
    const m = s > 0 ? mat4(L / 2, 0, Wd / 2 - t, 0, Math.PI / 2, 0) : mat4(-L / 2, 0, -Wd / 2 + t, 0, -Math.PI / 2, 0);
    const Lw = Wd - 2 * t;
    const outline = [[0, -0.8], [Lw, -0.8]];
    // teeth: walking from x=Lw back to 0. Local x runs along -z (s>0) or +z (s<0).
    for (let i = nT - 1; i >= 0; i--) {
      const a = i * tw, b = (i + 1) * tw;
      // gentle slope rises towards the "north" (glazed) side
      if (s > 0) { outline.push([Math.min(Lw, b), eave], [Math.min(Lw, a + 1.2), eave + hT], [Math.max(0, a), eave]); }
      else { outline.push([Math.min(Lw, b), eave], [Math.max(0, b - 1.2), eave + hT], [Math.max(0, a), eave]); }
    }
    const ops = [{ x: Lw / 2 - 2.5, y: 0, w: 5, h: 5, gate: true }];
    lod0.wall('fbrick', outline, ops, t, m);
    lod0.add('door', new THREE.BoxGeometry(5, 5, 0.1), m.clone().multiply(mat4(Lw / 2, 2.5, -0.35)), { ao: 0.7 });
    lod1.wall('fbrick', outline, [], 0.3, m);
  }
  // roof teeth: z runs from -Wd/2 to Wd/2; glazing faces -z (north)
  for (let i = 0; i < nT; i++) {
    const z0 = -Wd / 2 + i * tw, z1 = z0 + tw;
    const peakZ = z0 + 1.2;
    // solid slope from peak (z0+1.2, eave+hT) down to (z1, eave)
    const run = z1 - peakZ, ang = Math.atan2(hT, run), len = Math.hypot(run, hT);
    for (const gb of [lod0, lod1]) {
      const g = new THREE.BoxGeometry(L + 0.4, 0.14, len + 0.2);
      const uv = g.attributes.uv.array, pos = g.attributes.position.array;
      for (let k = 0; k < uv.length / 2; k++) { uv[k * 2] = pos[k * 3]; uv[k * 2 + 1] = pos[k * 3 + 2]; }
      gb.add('roofFelt', g, mat4(0, eave + hT / 2 + 0.08, (peakZ + z1) / 2, ang, 0, 0), { uv: 'keep', aoGround: false });
      // glazed steep face from (z0, eave) to (peakZ, eave+hT)
      const glen = Math.hypot(1.2, hT), gang = Math.atan2(1.2, hT);
      gb.add('glassRoof', new THREE.PlaneGeometry(L, glen), mat4(0, eave + hT / 2, (z0 + peakZ) / 2, -gang, Math.PI, 0), { aoGround: false });
      if (gb === lod0) {
        for (let x = -L / 2; x <= L / 2; x += 2) lod0.add('steel', new THREE.BoxGeometry(0.06, glen, 0.08), mat4(x, eave + hT / 2, (z0 + peakZ) / 2, -gang, 0, 0), { aoGround: false });
        // truss below valley
        lod0.add('steel', new THREE.BoxGeometry(L, 0.35, 0.25), mat4(0, eave - 0.2, z1), { aoGround: false, ao: 0.5 });
      }
    }
  }
  // interior: floor, columns, machines (visible through skylights)
  lod0.box('concreteFloor', L - 1, 0.2, Wd - 1, 0, 0, 0, 0, { aoGround: false, ao: 0.6 });
  for (let x = -L / 2 + 6; x < L / 2; x += 6) for (let i = 1; i < nT; i++) lod0.box('steel', 0.3, eave, 0.3, x, 0, -Wd / 2 + i * tw, 0, { aoGround: false, ao: 0.6 });
  for (let k = 0; k < L * Wd / 60; k++) {
    const mw = 1.5 + rnd() * 2.5, mh = 1 + rnd() * 1.8;
    lod0.box('machine', mw, mh, 1 + rnd() * 1.5, (rnd() - 0.5) * (L - 6), 0.2, (rnd() - 0.5) * (Wd - 6), rnd() < 0.5 ? 0 : Math.PI / 2, { bevel: 0.05, aoGround: false, ao: 0.6 });
  }
  // ruin: twisted trusses + rubble
  for (let k = 0; k < 10; k++) ruin.box('steel', L * (0.2 + rnd() * 0.4), 0.3, 0.3, (rnd() - 0.5) * L * 0.6, 1 + rnd() * eave * 0.6, (rnd() - 0.5) * Wd * 0.8, rnd() * 0.4, { rz: (rnd() - 0.5) * 0.9, rx: (rnd() - 0.5) * 0.5, aoGround: false, ao: 0.5 });
  rubble(ruin, L * 0.9, Wd * 0.9, eave * 0.7, rnd);
  return { lod0, lod1, ruin, w: L, d: Wd, h: eave + hT, eave };
}

// ---------------------------------------------------------------- multistorey brick block
export function makeBlock(seed, p) {
  const rnd = mulberry32(seed);
  const L = p.l, D = p.d, F = p.floors ?? 4, fh = 3.8;
  const H = F * fh + 0.8;
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const t = 0.55;
  const walls = [
    { m: mat4(-L / 2, 0, D / 2, 0, 0, 0), L },
    { m: mat4(L / 2, 0, -D / 2, 0, Math.PI, 0), L },
    { m: mat4(-L / 2, 0, -D / 2 + t, 0, -Math.PI / 2, 0), L: D - 2 * t },
    { m: mat4(L / 2, 0, D / 2 - t, 0, Math.PI / 2, 0), L: D - 2 * t },
  ];
  for (const wl of walls) {
    const ops = [];
    for (let f = 0; f < F; f++) ops.push(...bayWindows(lod0, 'fbrick', wl.m, wl.L, 1.0 + f * fh, 2.3, 3.2, 1.9));
    lod0.wall('fbrick', [[0, -0.8], [wl.L, -0.8], [wl.L, H], [0, H]], ops, t, wl.m);
    for (const o of ops) steelWindow(lod0, wl.m, o, 0.22);
    lod1.wall('fbrick', [[0, -0.8], [wl.L, -0.8], [wl.L, H], [0, H]], [], 0.3, wl.m);
    for (const o of ops) lod1.add('glassFar', new THREE.PlaneGeometry(o.w, o.h), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, 0.03)), { aoGround: false });
    for (let f = 1; f < F; f++) lod0.add('stone', new THREE.BoxGeometry(wl.L, 0.14, 0.08), wl.m.clone().multiply(mat4(wl.L / 2, f * fh + 0.3, 0.04)), { aoGround: false });
    const pts = [[0, -0.8], [wl.L, -0.8]];
    for (let k = 8; k >= 0; k--) pts.push([wl.L * k / 8, 2 + rnd() * (H * 0.7)]);
    ruin.wall('fbrick', pts, ops.filter(o => o.y + o.h < 2.5), t, wl.m, { ao: 0.5 });
  }
  for (let f = 0; f <= F; f++) lod0.box('interior', L - 2 * t, 0.3, D - 2 * t, 0, f * fh + 0.2, 0, 0, { aoGround: false, ao: 0.55 });
  for (const gb of [lod0, lod1]) {
    gb.box('roofFelt', L - 0.2, 0.3, D - 0.2, 0, H - 0.3, 0, 0, { aoGround: false });
    // parapet cap
    gb.box('stone', L + 0.2, 0.3, 0.7, 0, H, D / 2 - 0.25, 0, { aoGround: false });
    gb.box('stone', L + 0.2, 0.3, 0.7, 0, H, -D / 2 + 0.25, 0, { aoGround: false });
    gb.box('stone', 0.7, 0.3, D, L / 2 - 0.25, H, 0, 0, { aoGround: false });
    gb.box('stone', 0.7, 0.3, D, -L / 2 + 0.25, H, 0, 0, { aoGround: false });
  }
  // stair tower / lift housing
  lod0.box('fbrick', 5, 3, 5, L * 0.3, H, 0, 0, { aoGround: false });
  rubble(ruin, L, D, H * 0.6, rnd);
  return { lod0, lod1, ruin, w: L, d: D, h: H + 3, eave: H };
}

// ---------------------------------------------------------------- tall brick chimney
export function makeChimney(seed, p) {
  const h = p.h ?? 55;
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  lod0.box('fbrick', 7, 6, 7, 0, -0.8, 0, 0, { bevel: 0.05 });
  lod0.cyl('fbrick', 2.9, 1.5, h, 0, 5, 0, 20);
  for (let y = 12; y < h; y += 11) lod0.cyl('fbrick', 3.0 - (y / h) * 1.4 + 0.12, 3.0 - (y / h) * 1.4 + 0.12, 0.5, 0, 5 + y, 0, 20, { aoGround: false });
  lod0.cyl('stone', 1.75, 1.75, 1.2, 0, 5 + h - 0.6, 0, 20, { aoGround: false });
  lod0.cyl('soot', 1.3, 1.3, 0.05, 0, 5 + h + 0.61, 0, 16, { aoGround: false });
  lod1.box('fbrick', 7, 6, 7, 0, -0.8, 0);
  lod1.cyl('fbrick', 2.9, 1.5, h + 1, 0, 5, 0, 10);
  ruin.box('fbrick', 7, 6, 7, 0, -0.8, 0, 0, { ao: 0.6 });
  ruin.cyl('fbrick', 2.9, 2.2, h * 0.3, 0, 5, 0, 16, { ao: 0.6 });
  rubble(ruin, 16, 16, 6, mulberry32(seed));
  return { lod0, lod1, ruin, w: 7, d: 7, h: h + 6, eave: h };
}

// ---------------------------------------------------------------- water tower
export function makeWaterTower(seed) {
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  for (const gb of [lod0, lod1]) {
    gb.cyl('fbrick', 3.4, 3.2, 22, 0, -0.8, 0, gb === lod0 ? 18 : 10);
    gb.cyl('rust', 5.2, 5.2, 7, 0, 21, 0, gb === lod0 ? 24 : 12);
    gb.add('slate', new THREE.ConeGeometry(5.6, 3.2, gb === lod0 ? 24 : 12), mat4(0, 29.6, 0), { uv: 'keep', uvScale: [35, 3.2], aoGround: false });
  }
  for (let i = 0; i < 6; i++) lod0.add('glassInd', new THREE.PlaneGeometry(0.8, 1.6), mat4(Math.sin(i) * 3.42, 8 + (i % 3) * 5, Math.cos(i) * 3.42, 0, i, 0), { aoGround: false });
  ruin.cyl('fbrick', 3.4, 3.2, 9, 0, -0.8, 0, 14, { ao: 0.6 });
  rubble(ruin, 14, 14, 5, mulberry32(seed));
  return { lod0, lod1, ruin, w: 11, d: 11, h: 33, eave: 28 };
}

// ---------------------------------------------------------------- shed (corrugated)
export function makeShed(seed, p) {
  const rnd = mulberry32(seed);
  const L = p.l, D = p.d, eave = p.eave ?? 5;
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const key = p.brick ? 'fbrick' : 'corr';
  const walls = [
    { m: mat4(-L / 2, 0, D / 2, 0, 0, 0), L },
    { m: mat4(L / 2, 0, -D / 2, 0, Math.PI, 0), L },
    { m: mat4(-L / 2, 0, -D / 2 + 0.2, 0, -Math.PI / 2, 0), L: D - 0.4, gable: true },
    { m: mat4(L / 2, 0, D / 2 - 0.2, 0, Math.PI / 2, 0), L: D - 0.4, gable: true },
  ];
  const tanP = Math.tan(deg(22));
  for (const wl of walls) {
    const out = wl.gable ? [[0, -0.5], [wl.L, -0.5], [wl.L, eave], [wl.L / 2, eave + tanP * D / 2 - 0.1], [0, eave]] : [[0, -0.5], [wl.L, -0.5], [wl.L, eave], [0, eave]];
    const ops = wl.gable ? [{ x: wl.L / 2 - 2, y: 0, w: 4, h: Math.min(4.2, eave - 0.4) }] : [];
    lod0.wall(key, out, ops, 0.2, wl.m);
    for (const o of ops) lod0.add('door', new THREE.BoxGeometry(o.w, o.h, 0.08), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.h / 2, -0.15)), { ao: 0.6 });
    lod1.wall(key, out, [], 0.2, wl.m);
    const pts = [[0, -0.5], [wl.L, -0.5]];
    for (let k = 4; k >= 0; k--) pts.push([wl.L * k / 4, 0.5 + rnd() * eave * 0.6]);
    ruin.wall(key, pts, [], 0.2, wl.m, { ao: 0.5 });
  }
  gableRoof(lod0, 'corrRoof', L, D, eave, 22, { eave: 0.3, gable: 0.2, thick: 0.08 });
  gableRoof(lod1, 'corrRoof', L, D, eave, 22, { eave: 0.3, gable: 0.2, thick: 0.1 });
  lod0.box('concreteFloor', L - 0.4, 0.15, D - 0.4, 0, 0, 0, 0, { aoGround: false, ao: 0.5 });
  rubble(ruin, L, D, eave * 0.6, rnd);
  return { lod0, lod1, ruin, w: L, d: D, h: eave + tanP * D / 2, eave };
}

// ---------------------------------------------------------------- fuel tank
export function makeTank(seed, p) {
  const r = p.r ?? 10, h = p.h ?? 11;
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  lod0.cyl('tank', r, r, h, 0, 0, 0, 36);
  lod0.add('tank', new THREE.ConeGeometry(r + 0.15, 1.6, 36, 1, true), mat4(0, h + 0.8, 0), { uv: 'keep', uvScale: [r * 6, 2], aoGround: false });
  for (let y = 2; y < h; y += 2.6) lod0.cyl('tank', r + 0.05, r + 0.05, 0.12, 0, y, 0, 36, { aoGround: false });
  // stair: diagonal ladder boxes
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * 1.4;
    lod0.box('steel', 0.9, 0.06, 0.3, Math.sin(a) * (r + 0.5), i * (h / 12), Math.cos(a) * (r + 0.5), a, { aoGround: false });
  }
  lod0.cyl('steel', 0.04, 0.04, 1.2, 0, h + 1.2, 0, 6, { aoGround: false });
  // bund wall ring
  const ring = new THREE.TorusGeometry(r + 6, 0.8, 4, 40);
  lod0.add('concrete', ring, mat4(0, 0.2, 0, Math.PI / 2, 0, 0), { aoGround: false, ao: 0.9 });
  lod1.cyl('tank', r, r, h, 0, 0, 0, 16);
  lod1.add('tank', new THREE.ConeGeometry(r + 0.15, 1.6, 16), mat4(0, h + 0.8, 0), { uv: 'keep', uvScale: [r * 6, 2], aoGround: false });
  lod1.add('concrete', new THREE.TorusGeometry(r + 6, 0.8, 3, 20), mat4(0, 0.2, 0, Math.PI / 2, 0, 0), { aoGround: false });
  // ruin: torn, collapsed shell
  const g = new THREE.CylinderGeometry(r * 1.05, r, h * 0.35, 28, 3, true);
  const pp = g.attributes.position;
  for (let i = 0; i < pp.count; i++) if (pp.getY(i) > 0) pp.setY(i, pp.getY(i) * (0.2 + Math.abs(Math.sin(i * 2.3)) * 1.8));
  ruin.add('charred', g, mat4(0, h * 0.17, 0), { uv: 'keep', uvScale: [r * 6, 4], ao: 0.5 });
  ruin.add('concrete', ring, mat4(0, 0.2, 0, Math.PI / 2, 0, 0), { aoGround: false, ao: 0.7 });
  ruin.cyl('soot', r + 5, r + 5, 0.05, 0, 0.1, 0, 30, { ao: 0.6 });
  return { lod0, lod1, ruin, w: r * 2 + 12, d: r * 2 + 12, h: h + 2, eave: h, round: true };
}

// ---------------------------------------------------------------- railway rolling stock
export function makeBoxcar(seed, p = {}) {
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const L = 9.8, W = 2.8, H = 3.0, fy = 1.05;
  const body = p.body || 'wagon';
  for (const gb of [lod0, lod1]) {
    gb.box(body, L, H, W, 0, fy, 0, 0, { bevel: gb === lod0 ? 0.04 : 0, aoGround: false });
    const roof = new THREE.CylinderGeometry(W * 0.62, W * 0.62, L + 0.2, gb === lod0 ? 12 : 6, 1, false, Math.PI / 2 - 0.75, 1.5);
    gb.add('wagonRoof', roof, mat4(0, fy + H - W * 0.62 * Math.cos(0.75) + 0.02, 0, 0, 0, Math.PI / 2), { uv: 'keep', uvScale: [3, L], aoGround: false });
  }
  // sliding doors, underframe, wheels, buffers
  for (const s of [-1, 1]) {
    lod0.box(body, 2.2, 2.4, 0.08, 0, fy + 0.2, s * (W / 2 + 0.04), 0, { aoGround: false, ao: 0.85 });
    lod0.box('steelDark', 2.6, 0.08, 0.12, 0, fy + 2.62, s * (W / 2 + 0.08), 0, { aoGround: false });
    lod0.box('steelDark', L + 0.2, 0.35, 0.18, 0, fy - 0.35, s * 0.8, 0, { aoGround: false, ao: 0.6 });
    for (const x of [-2.8, 2.8]) {
      lod0.cyl('steelDark', 0.5, 0.5, 0.14, 0, 0, 0, 14, { matrix: mat4(x, 0.5, s * 0.75, Math.PI / 2, 0, 0), aoGround: false });
      lod0.box('steelDark', 1.6, 0.35, 0.1, x, 0.4, s * 0.92, 0, { aoGround: false, ao: 0.7 });
    }
    for (const bz of [-0.85, 0.85]) lod0.cyl('steelDark', 0.18, 0.18, 0.5, 0, 0, 0, 10, { matrix: mat4(s * (L / 2 + 0.25), fy - 0.1, bz, 0, 0, Math.PI / 2), aoGround: false });
  }
  ruin.box('charred', L, 0.9, W, 0, fy - 0.2, 0, 0.1, { rz: 0.15, ao: 0.5 });
  for (const x of [-2.8, 2.8]) ruin.cyl('steelDark', 0.5, 0.5, 1.5, 0, 0, 0, 10, { matrix: mat4(x, 0.5, 0, Math.PI / 2, 0, 0) });
  return { lod0, lod1, ruin, w: L + 0.8, d: W, h: fy + H + 0.4, eave: fy + H };
}

export function makeOpenWagon(seed) {
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const L = 9.2, W = 2.8, fy = 1.05, sh = 1.4;
  for (const gb of [lod0, lod1]) {
    gb.box('wagon', L, 0.12, W, 0, fy, 0);
    for (const s of [-1, 1]) {
      gb.box('wagon', L, sh, 0.08, 0, fy, s * (W / 2 - 0.04), 0, { aoGround: false });
      gb.box('wagon', 0.08, sh, W, s * (L / 2 - 0.04), fy, 0, 0, { aoGround: false });
    }
    // coal load mound
    const g = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    gb.add('coal', g, mat4(0, fy + sh - 0.35, 0, 0, 0, 0, L * 0.5, 0.9, W * 0.48), { aoGround: false, ao: 0.8 });
  }
  for (const s of [-1, 1]) for (const x of [-2.6, 2.6]) lod0.cyl('steelDark', 0.5, 0.5, 0.14, 0, 0, 0, 14, { matrix: mat4(x, 0.5, s * 0.75, Math.PI / 2, 0, 0), aoGround: false });
  ruin.box('charred', L, 0.7, W, 0, fy - 0.1, 0, 0.2, { rz: 0.1, ao: 0.5 });
  return { lod0, lod1, ruin, w: L + 0.8, d: W, h: fy + sh, eave: fy + sh };
}

export function makeTankWagon(seed) {
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const L = 9.0, fy = 1.05;
  for (const gb of [lod0, lod1]) {
    gb.box('steelDark', L, 0.3, 2.2, 0, fy - 0.2, 0);
    gb.cyl('tankCar', 1.25, 1.25, L - 0.6, 0, 0, 0, gb === lod0 ? 18 : 8, { matrix: mat4(0, fy + 1.35, 0, 0, 0, Math.PI / 2), aoGround: false });
    for (const s of [-1, 1]) gb.add('tankCar', new THREE.SphereGeometry(1.25, gb === lod0 ? 14 : 6, 6, 0, Math.PI), mat4(s * (L / 2 - 0.3), fy + 1.35, 0, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 0.35, 1, 1), { aoGround: false });
  }
  lod0.cyl('tankCar', 0.4, 0.4, 0.5, 0, fy + 2.55, 0, 12, { aoGround: false });
  for (const s of [-1, 1]) for (const x of [-2.6, 2.6]) lod0.cyl('steelDark', 0.5, 0.5, 0.14, 0, 0, 0, 14, { matrix: mat4(x, 0.5, s * 0.75, Math.PI / 2, 0, 0), aoGround: false });
  ruin.cyl('charred', 1.25, 1.1, L * 0.6, 0, 0, 0, 10, { matrix: mat4(0, fy + 0.6, 0, 0.3, 0, Math.PI / 2 + 0.2), ao: 0.5 });
  return { lod0, lod1, ruin, w: L + 0.8, d: 2.8, h: fy + 2.8, eave: fy + 2.6 };
}

export function makeLocomotive(seed) {
  // DR class 52 "Kriegslok" 2-10-0 with tender
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const fy = 1.5;
  for (const gb of [lod0, lod1]) {
    const seg = gb === lod0 ? 20 : 8;
    gb.cyl('loco', 0.9, 0.9, 9.5, 0, 0, 0, seg, { matrix: mat4(-1.2, fy + 1.45, 0, 0, 0, Math.PI / 2), aoGround: false });
    gb.cyl('loco', 1.0, 1.0, 1.4, 0, 0, 0, seg, { matrix: mat4(3.9, fy + 1.45, 0, 0, 0, Math.PI / 2), aoGround: false });
    gb.box('loco', 3.2, 3.0, 3.0, -7.2, fy + 0.2, 0, 0, { aoGround: false });            // cab
    gb.box('loco', 3.4, 0.2, 3.3, -7.2, fy + 3.2, 0, 0, { aoGround: false });            // cab roof
    gb.box('loco', 7.5, 2.8, 3.0, -13.2, fy - 0.2, 0, 0, { aoGround: false });           // tender
    gb.box('coal', 5.5, 0.6, 2.6, -13.5, fy + 2.5, 0, 0, { aoGround: false });
    gb.box('steelDark', 14, 0.5, 2.2, -2, fy - 0.6, 0, 0, { aoGround: false });          // frame
  }
  lod0.cyl('loco', 0.32, 0.38, 1.0, 3.2, fy + 2.2, 0, 12, { aoGround: false });          // chimney
  lod0.cyl('loco', 0.45, 0.5, 0.7, 0.4, fy + 2.2, 0, 12, { aoGround: false });           // dome
  lod0.cyl('loco', 0.35, 0.4, 0.6, -2.2, fy + 2.2, 0, 12, { aoGround: false });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) lod0.cyl('wheelRed', 0.7, 0.7, 0.14, 0, 0, 0, 16, { matrix: mat4(2.2 - i * 1.65, 0.7, s * 0.78, Math.PI / 2, 0, 0), aoGround: false });
    for (let i = 0; i < 4; i++) lod0.cyl('wheelRed', 0.5, 0.5, 0.14, 0, 0, 0, 12, { matrix: mat4(-10.5 - i * 1.7, 0.5, s * 0.78, Math.PI / 2, 0, 0), aoGround: false });
    lod0.box('steelDark', 7, 0.12, 0.08, -1.1, 0.75, s * 0.92, 0, { aoGround: false });    // coupling rod
    lod0.box('loco', 8, 0.08, 0.6, -1.5, fy + 0.4, s * 1.4, 0, { aoGround: false });       // running board
    lod0.add('glassFar', new THREE.PlaneGeometry(0.9, 0.9), mat4(-6.3, fy + 1.9, s * 1.51, 0, s > 0 ? 0 : Math.PI, 0), { aoGround: false });
  }
  ruin.box('charred', 12, 2.2, 3, -2, 0.4, 0.6, 0.2, { rz: 0.4, ao: 0.5 });
  return { lod0, lod1, ruin, w: 22, d: 3.2, h: fy + 3.4, eave: fy + 3 };
}

// ---------------------------------------------------------------- 8.8 cm Flak 36 + emplacement
export function makeFlakEmplacement(seed) {
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  // circular earth-and-sandbag berm, open towards the ammo trench
  const berm = new THREE.TorusGeometry(6.2, 1.25, 6, 28, Math.PI * 1.8);
  const bp = berm.attributes.position;
  for (let i = 0; i < bp.count; i++) { if (bp.getZ(i) < 0) bp.setZ(i, bp.getZ(i) * 0.4); bp.setZ(i, bp.getZ(i) * (0.9 + 0.2 * Math.sin(i * 1.7))); }
  berm.computeVertexNormals();
  for (const gb of [lod0, lod1]) gb.add('earth', berm, mat4(0, 0.1, 0, -Math.PI / 2, 0.4, 0), { aoGround: false, ao: 0.9 });
  // sandbag rows on berm top
  for (let a = 0; a < 26; a++) {
    const ang = a / 26 * Math.PI * 1.8 + 0.4;
    lod0.box('sandbag', 0.6, 0.25, 0.35, Math.cos(ang) * 6.2, 1.1 + (a % 2) * 0.24, -Math.sin(ang) * 6.2, -ang, { bevel: 0.08, aoGround: false });
  }
  // cruciform platform
  lod0.box('gun', 7.0, 0.25, 0.5, 0, 0.35, 0, 0, { bevel: 0.03 });
  lod0.box('gun', 0.5, 0.25, 7.0, 0, 0.35, 0, 0, { bevel: 0.03 });
  lod0.cyl('gun', 0.7, 0.8, 0.9, 0, 0.5, 0, 16);
  for (const [x, z] of [[3.4, 0], [-3.4, 0], [0, 3.4], [0, -3.4]]) lod0.cyl('gun', 0.3, 0.3, 0.15, x, 0.1, z, 10);
  ruin.box('charred', 6, 0.4, 0.6, 0, 0.2, 0, 0.5, { ao: 0.5 });
  ruin.add('earth', berm, mat4(0, 0.1, 0, -Math.PI / 2, 0.4, 0), { aoGround: false, ao: 0.6 });
  return { lod0, lod1, ruin, w: 15, d: 15, h: 3, eave: 2 };
}

// Traversing/elevating part of the gun, origin at trunnion.
export function makeFlakGunTop() {
  const gb = new GB();
  gb.box('gun', 1.6, 1.0, 1.4, 0, -0.6, 0, 0, { bevel: 0.05, aoGround: false });      // cradle carriage
  gb.box('gun', 0.08, 1.4, 2.2, 0.85, -0.6, 0.2, 0, { aoGround: false });             // shield side
  gb.box('gun', 2.6, 1.3, 0.08, 0, -0.5, 1.2, 0, { aoGround: false });               // shield front
  gb.cyl('gun', 0.22, 0.2, 2.6, 0, 0, 0, 12, { matrix: mat4(0, 0, 1.3, Math.PI / 2, 0, 0), aoGround: false }); // recuperator
  gb.cyl('gun', 0.12, 0.1, 6.2, 0, 0, 0, 12, { matrix: mat4(0, 0.2, 3.3, Math.PI / 2, 0, 0), aoGround: false }); // barrel
  gb.cyl('gun', 0.16, 0.16, 0.4, 0, 0, 0, 12, { matrix: mat4(0, 0.2, 6.4, Math.PI / 2, 0, 0), aoGround: false }); // muzzle
  gb.box('gun', 0.7, 0.5, 1.6, 0, 0, -0.9, 0, { bevel: 0.04, aoGround: false });      // breech
  return gb;
}

// ---------------------------------------------------------------- bridges
export function makeTrussBridge(len, deckY, width = 6.5) {
  // Pratt truss, two spans on a river pier; local x along the bridge, deck top at y=0
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const spans = 2, sl = len / spans, h = 9, pan = 6;
  for (let s = 0; s < spans; s++) {
    const x0 = -len / 2 + s * sl;
    for (const gb of [lod0, lod1]) {
      gb.box('bridgeSteel', sl, 0.9, width + 0.6, x0 + sl / 2, -1.2, 0, 0, { aoGround: false });
      for (const z of [-width / 2, width / 2]) {
        gb.box('bridgeSteel', sl, 0.6, 0.5, x0 + sl / 2, -0.3, z, 0, { aoGround: false });
        gb.box('bridgeSteel', sl - pan * 2 + 0.5, 0.6, 0.5, x0 + sl / 2, h, z, 0, { aoGround: false });
      }
    }
    const n = Math.round(sl / pan);
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * sl / n;
      const top = (i > 0 && i < n);
      for (const z of [-width / 2, width / 2]) {
        if (top) lod0.box('bridgeSteel', 0.4, h, 0.4, x, 0, z, 0, { aoGround: false });
        if (i < n) {
          // diagonals slope towards the centre of each span (Pratt)
          const xa = x, xb = x + sl / n;
          const mid = x0 + sl / 2;
          const up = (i === 0) ? [xa, 0, xb, h] : (i === n - 1) ? [xa, h, xb, 0] : (xa + xb) / 2 < mid ? [xa, h, xb, 0] : [xa, 0, xb, h];
          const dx = up[2] - up[0], dy = up[3] - up[1];
          const L = Math.hypot(dx, dy);
          const g = new THREE.BoxGeometry(L, 0.3, 0.3);
          lod0.add('bridgeSteel', g, mat4((up[0] + up[2]) / 2, (up[1] + up[3]) / 2, z, 0, 0, Math.atan2(dy, dx)), { aoGround: false });
          if (i === 0 || i === n - 1) lod1.add('bridgeSteel', g.clone(), mat4((up[0] + up[2]) / 2, (up[1] + up[3]) / 2, z, 0, 0, Math.atan2(dy, dx)), { aoGround: false });
        }
      }
      if (top) lod0.box('bridgeSteel', 0.25, 0.3, width, x, h - 0.2, 0, 0, { aoGround: false });
      lod0.box('bridgeSteel', 0.3, 0.5, width, x, -0.7, 0, 0, { aoGround: false });
    }
    // collapsed span in the ruin: tilted into the river
    ruin.box('bridgeSteel', sl * 0.95, 1.2, width, x0 + sl / 2, -deckY * 0.55, 0, 0, { rz: (s ? -1 : 1) * 0.28, ao: 0.6 });
    ruin.box('bridgeSteel', sl * 0.7, 0.5, 0.5, x0 + sl / 2, -deckY * 0.4, width / 2, 0, { rz: (s ? -1 : 1) * 0.3, rx: 0.2, ao: 0.6 });
  }
  // piers + abutments (dressed sandstone)
  for (const gb of [lod0, lod1, ruin]) {
    gb.box('stoneWall', 5, deckY + 6, width + 4, 0, -deckY - 6, 0, 0, { bevel: gb === lod0 ? 0.1 : 0, ao: gb === ruin ? 0.7 : 1 });
    for (const s of [-1, 1]) gb.box('stoneWall', 6, deckY + 4, width + 5, s * (len / 2 + 2.5), -deckY - 4, 0, 0, { ao: gb === ruin ? 0.7 : 1 });
  }
  lod0.box('stone', 5.6, 0.5, width + 4.6, 0, -1.9, 0, 0, { aoGround: false });
  return { lod0, lod1, ruin, w: len + 12, d: width + 5, h: h + 1, eave: h };
}

export function makeArchBridge(len, deckY, width = 9) {
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const nA = 5, span = len / nA, r = span * 0.42;
  const shape = new THREE.Shape();
  shape.moveTo(-len / 2 - 6, -deckY - 6); shape.lineTo(len / 2 + 6, -deckY - 6); shape.lineTo(len / 2 + 6, 0); shape.lineTo(-len / 2 - 6, 0); shape.lineTo(-len / 2 - 6, -deckY - 6);
  for (let i = 0; i < nA; i++) {
    const cx = -len / 2 + span * (i + 0.5);
    const hp = new THREE.Path();
    const spring = -deckY - 6;
    const top = -1.4 - r;
    hp.moveTo(cx - r, spring);
    hp.lineTo(cx - r, top);
    hp.absarc(cx, top, r, Math.PI, 0, true);
    hp.lineTo(cx + r, spring);
    hp.lineTo(cx - r, spring);
    shape.holes.push(hp);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 10 });
  for (const gb of [lod0, lod1]) gb.add('stoneWall', g.clone(), mat4(0, 0, -width / 2), { ao: 0.95 });
  // parapets + cutwaters
  for (const s of [-1, 1]) {
    lod0.box('stone', len + 12, 1.0, 0.45, 0, 0, s * (width / 2 - 0.22), 0, { bevel: 0.04 });
    lod1.box('stone', len + 12, 1.0, 0.45, 0, 0, s * (width / 2 - 0.22), 0);
  }
  for (let i = 1; i < nA; i++) {
    const cx = -len / 2 + span * i;
    for (const s of [-1, 1]) lod0.add('stoneWall', new THREE.CylinderGeometry(0.1, (span - 2 * r) / 2 + 0.3, deckY + 2, 3), mat4(cx, -deckY / 2 - 4, s * (width / 2 + 0.3), 0, s > 0 ? 0 : Math.PI, 0), { ao: 0.9 });
  }
  const rg = g.clone();
  ruin.add('stoneWall', rg, mat4(0, -3, -width / 2, 0, 0, 0, 1, 0.8, 1), { ao: 0.6 });
  return { lod0, lod1, ruin, w: len + 12, d: width, h: 2, eave: 1 };
}

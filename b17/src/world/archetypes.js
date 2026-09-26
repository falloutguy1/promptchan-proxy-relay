// Procedural building archetypes. Each returns { lod0: GB, lod1: GB, ruin: GB, w, d, h }.
// Local frame: footprint centred on origin, length along x, depth along z, ground at y = 0.
import * as THREE from 'three';
import { GB, mat4, gableRoof } from './geo.js';
import { mulberry32 } from '../core/noise.js';

const T = 0.45;           // wall thickness
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- windows & doors
function windowAssembly(gb, m, o, t, style) {
  // m: wall matrix (wall-local: x along wall, y up, outer face z=0, inside -z)
  const inset = 0.13;
  const fw = 0.065;
  const add = (key, w, h, d, x, y, z, opts) => gb.add(key, new THREE.BoxGeometry(w, h, d), m.clone().multiply(mat4(x, y, z)), opts);
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  // frame
  add('wood', o.w, fw, 0.08, cx, o.y + o.h - fw / 2, -inset, { aoGround: false, ao: 0.9 });
  add('wood', o.w, fw * 1.4, 0.08, cx, o.y + fw * 0.7, -inset, { aoGround: false, ao: 0.9 });
  add('wood', fw, o.h, 0.08, o.x + fw / 2, cy, -inset, { aoGround: false, ao: 0.9 });
  add('wood', fw, o.h, 0.08, o.x + o.w - fw / 2, cy, -inset, { aoGround: false, ao: 0.9 });
  // casement mullion + transom (typical 6-light Franconian window)
  if (o.w > 0.7) add('wood', 0.05, o.h, 0.06, cx, cy, -inset, { aoGround: false });
  const ty = o.y + o.h * 0.7;
  add('wood', o.w, 0.05, 0.06, cx, ty, -inset, { aoGround: false });
  if (style.bars) add('wood', o.w, 0.03, 0.04, cx, o.y + o.h * 0.36, -inset + 0.01, { aoGround: false });
  // glass
  gb.add('glass', new THREE.PlaneGeometry(o.w - fw, o.h - fw), m.clone().multiply(mat4(cx, cy, -inset - 0.02)), { aoGround: false });
  // sill (stone, protruding, sloped slightly) + reveal darkening by baked AO on the wall itself
  add('stone', o.w + 0.16, 0.07, 0.24, cx, o.y - 0.035, 0.03, { bevel: 0.015, aoGround: false });
  // sandstone surround
  if (style.surround) {
    const sw = 0.13;
    add('stone', o.w + sw * 2, sw, 0.05, cx, o.y + o.h + sw / 2, 0.02, { aoGround: false });
    add('stone', sw, o.h, 0.05, o.x - sw / 2, cy, 0.02, { aoGround: false });
    add('stone', sw, o.h, 0.05, o.x + o.w + sw / 2, cy, 0.02, { aoGround: false });
    if (style.keystone) add('stone', 0.22, 0.26, 0.07, cx, o.y + o.h + 0.12, 0.03, { aoGround: false });
  }
  // open shutters flat against the wall
  if (style.shutters) {
    const sw = o.w / 2 + 0.02;
    add('shutter', sw, o.h + 0.04, 0.035, o.x - sw / 2 - 0.02, cy, 0.03, { aoGround: false });
    add('shutter', sw, o.h + 0.04, 0.035, o.x + o.w + sw / 2 + 0.02, cy, 0.03, { aoGround: false });
  }
  // curtains inside
  if (style.curtains) {
    const cw = o.w * 0.3;
    add('fabric', cw, o.h * 0.95, 0.02, o.x + cw / 2 + 0.05, cy, -t - 0.08, { aoGround: false, ao: 0.8 });
    add('fabric', cw, o.h * 0.95, 0.02, o.x + o.w - cw / 2 - 0.05, cy, -t - 0.08, { aoGround: false, ao: 0.8 });
  }
}

function doorAssembly(gb, m, o, t) {
  const add = (key, w, h, d, x, y, z, opts) => gb.add(key, new THREE.BoxGeometry(w, h, d), m.clone().multiply(mat4(x, y, z)), opts);
  const cx = o.x + o.w / 2;
  add('door', o.w, o.h, 0.07, cx, o.y + o.h / 2, -0.28, { aoGround: false, ao: 0.8 });
  // panels
  add('door', o.w * 0.36, o.h * 0.35, 0.03, cx - o.w * 0.22, o.y + o.h * 0.3, -0.23, { aoGround: false, ao: 0.75 });
  add('door', o.w * 0.36, o.h * 0.35, 0.03, cx + o.w * 0.22, o.y + o.h * 0.3, -0.23, { aoGround: false, ao: 0.75 });
  add('door', o.w * 0.36, o.h * 0.3, 0.03, cx - o.w * 0.22, o.y + o.h * 0.72, -0.23, { aoGround: false, ao: 0.75 });
  add('door', o.w * 0.36, o.h * 0.3, 0.03, cx + o.w * 0.22, o.y + o.h * 0.72, -0.23, { aoGround: false, ao: 0.75 });
  // stone surround + step
  add('stone', o.w + 0.36, 0.2, 0.08, cx, o.y + o.h + 0.1, 0.03, { aoGround: false });
  add('stone', 0.18, o.h, 0.08, o.x - 0.09, o.y + o.h / 2, 0.03, { aoGround: false });
  add('stone', 0.18, o.h, 0.08, o.x + o.w + 0.09, o.y + o.h / 2, 0.03, { aoGround: false });
  add('stone', o.w + 0.5, o.y, 0.45, cx, o.y / 2, 0.2, { bevel: 0.02 });
}

// ---------------------------------------------------------------- house
export function makeHouse(seed, p) {
  const rnd = mulberry32(seed);
  const W = p.w, D = p.d, F = p.floors;
  const plinth = 0.55;
  const gH = 3.25, uH = 2.95;
  const eave = plinth + gH + uH * (F - 1) + 0.25;
  const pitch = p.pitch ?? 50;
  const style = {
    surround: rnd() < 0.7, keystone: rnd() < 0.3, shutters: rnd() < (p.shutterChance ?? 0.35), curtains: true, bars: rnd() < 0.5,
  };
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const wallKey = p.brick ? 'brick' : 'plaster';
  const winW = p.winW ?? 1.0, winH = p.winH ?? 1.45;

  // openings per floor for a facade of length Lw
  const facadeOpenings = (Lw, withDoor, density = 1) => {
    const n = Math.max(1, Math.floor((Lw - 1.2) / (2.4 / density)));
    const sp = Lw / n;
    const doorCol = withDoor ? Math.floor(rnd() * n) : -1;
    const ops = [];
    for (let f = 0; f < F; f++) {
      const baseY = f === 0 ? plinth + 0.95 : plinth + gH + (f - 1) * uH + 0.8;
      for (let c = 0; c < n; c++) {
        const x = sp * (c + 0.5);
        if (f === 0 && c === doorCol) ops.push({ x: x - 0.55, y: plinth - 0.2 + 0.2, w: 1.1, h: 2.25, door: true });
        else ops.push({ x: x - winW / 2, y: baseY, w: winW, h: winH });
      }
    }
    return ops;
  };

  const run = D / 2;
  const tanP = Math.tan(deg(pitch));
  const ridgeY = eave + tanP * run;
  const walls = [
    { m: mat4(-W / 2, 0, D / 2, 0, 0, 0), L: W, gable: false, door: true },
    { m: mat4(W / 2, 0, -D / 2, 0, Math.PI, 0), L: W, gable: false, door: rnd() < 0.5, density: 0.8 },
    { m: mat4(-W / 2, 0, -D / 2 + T, 0, -Math.PI / 2, 0), L: D - 2 * T, gable: true, door: false, density: 0.8 },
    { m: mat4(W / 2, 0, D / 2 - T, 0, Math.PI / 2, 0), L: D - 2 * T, gable: true, door: false, density: 0.8 },
  ];
  const ruinTop = () => 1.5 + rnd() * (eave - 1.5);
  for (const wl of walls) {
    const L = wl.L;
    const outline = wl.gable
      ? [[0, -0.8], [L, -0.8], [L, eave + tanP * T], [L / 2, ridgeY - 0.05], [0, eave + tanP * T]]
      : [[0, -0.8], [L, -0.8], [L, eave], [0, eave]];
    let ops = (wl.gable && p.blindGables && rnd() < 0.5) ? [] : facadeOpenings(L, wl.door, wl.density ?? 1);
    if (wl.gable && (ridgeY - eave) > 2.6) ops.push({ x: L / 2 - 0.4, y: eave + 0.5, w: 0.8, h: 1.0, attic: true });
    lod0.wall(wallKey, outline, ops, T, wl.m);
    for (const o of ops) {
      if (o.door) doorAssembly(lod0, wl.m, o, T);
      else windowAssembly(lod0, wl.m, o, T, { ...style, curtains: style.curtains && rnd() < 0.7, shutters: style.shutters && !o.attic });
    }
    // LOD1: flat wall + window quads
    const flat = wl.gable ? outline : outline;
    lod1.wall(wallKey, flat, [], 0.3, wl.m);
    for (const o of ops) lod1.add(o.door ? 'door' : 'glassFar', new THREE.PlaneGeometry(o.w, o.h), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, 0.03)), { aoGround: false });
    // ruin: jagged wall stubs (keep lower openings)
    const pts = [[0, -0.8], [L, -0.8]];
    const segs = Math.max(3, Math.round(L / 1.6));
    for (let k = segs; k >= 0; k--) pts.push([L * k / segs, Math.min(eave, ruinTop() * (0.5 + 0.5 * Math.sin(k * 1.7 + seed)))]);
    const rOps = ops.filter(o => o.y + o.h < 1.2 + Math.min(...pts.slice(2).map(q => q[1])));
    ruin.wall(wallKey, pts, rOps, T, wl.m, { ao: 0.55 });
  }
  // plinth (sandstone base), cornice, string course
  lod0.box('stone', W + 0.08, plinth + 0.8, D + 0.08, 0, -0.8, 0, 0, { ao: 0.9 });
  lod1.box('stone', W + 0.08, plinth + 0.8, D + 0.08, 0, -0.8, 0);
  ruin.box('stone', W + 0.08, plinth + 0.8, D + 0.08, 0, -0.8, 0, 0, { ao: 0.5 });
  for (const s of [1, -1]) {
    lod0.box('stone', W + 0.3, 0.22, 0.2, 0, eave - 0.24, s * (D / 2 + 0.06), 0, { bevel: 0.03, aoGround: false });
    if (p.stringCourse) for (let f = 1; f < F; f++) lod0.box('stone', W + 0.1, 0.12, 0.08, 0, plinth + gH + (f - 1) * uH, s * (D / 2 + 0.02), 0, { aoGround: false });
  }
  // interior: floor slabs + partition + back plaster
  for (let f = 0; f <= F; f++) {
    const y = f === 0 ? plinth - 0.05 : plinth + gH + (f - 1) * uH - 0.25;
    lod0.box('interior', W - 2 * T, 0.25, D - 2 * T, 0, y, 0, 0, { aoGround: false, ao: f === F ? 0.5 : 0.7 });
  }
  lod0.box('interior', W - 2 * T, eave - plinth, 0.14, 0, plinth, -D * 0.1, 0, { aoGround: false, ao: 0.55 });
  if (W > 9) lod0.box('interior', 0.14, eave - plinth, D - 2 * T, W * 0.12, plinth, 0, 0, { aoGround: false, ao: 0.55 });
  // roof
  const roofKey = p.slate ? 'slate' : 'roof';
  gableRoof(lod0, roofKey, W, D, eave, pitch, { eave: 0.5, gable: 0.32 });
  gableRoof(lod1, roofKey, W, D, eave, pitch, { eave: 0.5, gable: 0.32, thick: 0.2 });
  // attic floor/rafters visible through gable window
  // gutters + downpipes
  for (const s of [1, -1]) {
    const gz = s * (D / 2 + 0.5 - 0.02);
    lod0.cyl('zinc', 0.085, 0.085, W + 0.64, 0, 0, 0, 8, { open: true, thetaStart: Math.PI, thetaLength: Math.PI, matrix: mat4(0, eave - 0.5 * tanP - 0.1, gz, 0, 0, Math.PI / 2), aoGround: false });
    for (const sx of [-1, 1]) {
      lod0.cyl('zinc', 0.05, 0.05, eave - 0.3, sx * (W / 2 - 0.25), 0, s * (D / 2 + 0.1), 8, { aoGround: false });
    }
  }
  // chimney(s)
  const nCh = W > 11 ? 2 : 1;
  for (let c = 0; c < nCh; c++) {
    const cx = (nCh === 1 ? (rnd() - 0.5) * W * 0.4 : (c ? 1 : -1) * W * 0.28);
    const cz = (rnd() - 0.5) * 0.8;
    const top = ridgeY + 0.9;
    const bot = ridgeY - tanP * Math.abs(cz) - 1.5;
    lod0.box('brick', 0.62, top - bot, 0.62, cx, bot, cz, 0, { bevel: 0.02, aoGround: false });
    lod0.box('stone', 0.78, 0.1, 0.78, cx, top, cz, 0, { bevel: 0.02, aoGround: false });
    lod1.box('brick', 0.62, top - bot, 0.62, cx, bot, cz, 0, { aoGround: false });
  }
  // dormers
  if (p.dormers && W > 8) {
    const nd = W > 13 ? 2 : 1;
    for (let k = 0; k < nd; k++) {
      const dx = nd === 1 ? 0 : (k ? 1 : -1) * W * 0.22;
      const dz = D / 2 - 1.4;
      const baseY = eave + tanP * (D / 2 - dz) - 0.2;
      const dw = 1.7, dh = 1.55, dd = 2.2;
      const front = dz + 0.2;
      // cheeks
      for (const sx of [-1, 1]) lod0.box(wallKey, 0.12, dh, dd, dx + sx * (dw / 2 - 0.06), baseY, front - dd / 2, 0, { aoGround: false, ao: 0.95 });
      // front wall with opening + window
      const fm = mat4(dx - dw / 2, 0, front);
      const op = { x: dw / 2 - 0.45, y: baseY + 0.3, w: 0.9, h: 1.0 };
      lod0.wall(wallKey, [[0, baseY], [dw, baseY], [dw, baseY + dh], [0, baseY + dh]], [op], 0.12, fm, { aoGround: false });
      windowAssembly(lod0, fm, op, 0.12, { ...style, shutters: false, surround: false, curtains: false });
      lod0.box('interior', dw - 0.2, dh - 0.1, dd - 0.3, dx, baseY, front - dd / 2 - 0.1, 0, { aoGround: false, ao: 0.35 });
      gableRoof(lod0, roofKey, dd + 0.2, dw, baseY + dh, 45, { matrix: mat4(dx, 0, front - dd / 2 + 0.1, 0, Math.PI / 2, 0), eave: 0.15, gable: 0.12, thick: 0.1 });
    }
  }
  // ruin extras: rubble mound + charred beams
  rubble(ruin, W, D, eave, rnd);
  return { lod0, lod1, ruin, w: W, d: D, h: ridgeY + 1, eave };
}

export function rubble(gb, W, D, eave, rnd, key = 'rubble') {
  const g = new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 0.75 + 0.5 * Math.sin(x * 5.3 + z * 3.1 + i) * Math.cos(z * 4.7 - x * 2.2);
    pos.setXYZ(i, x * W * 0.5, y * Math.min(eave * 0.35, 3.2) * n, z * D * 0.5);
  }
  g.computeVertexNormals();
  gb.add(key, g, mat4(0, 0, 0), { ao: 0.75, aoGround: false });
  for (let k = 0; k < 7; k++) {
    const L = 2 + rnd() * Math.min(W, D) * 0.6;
    gb.box('charred', 0.18, 0.2, L, (rnd() - 0.5) * W * 0.7, 0.8 + rnd() * 1.5, (rnd() - 0.5) * D * 0.6, rnd() * 3, { rx: (rnd() - 0.5) * 1.2, rz: (rnd() - 0.5) * 0.6, aoGround: false, ao: 0.6 });
  }
  for (let k = 0; k < 18; k++) {
    const s = 0.3 + rnd() * 0.8;
    gb.box(rnd() < 0.5 ? 'rubble' : 'stone', s, s * 0.6, s * (0.6 + rnd()), (rnd() - 0.5) * W * 1.2, -0.1, (rnd() - 0.5) * D * 1.2, rnd() * 3, { rx: rnd(), rz: rnd(), bevel: 0.05, aoGround: false, ao: 0.7 });
  }
}

// ---------------------------------------------------------------- barn (village)
export function makeBarn(seed, p) {
  const rnd = mulberry32(seed);
  const W = p.w, D = p.d;
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const eave = 4.2, pitch = 48;
  const tanP = Math.tan(deg(pitch));
  const ridgeY = eave + tanP * D / 2;
  // stone ground storey + timber boarded upper gables
  const walls = [
    { m: mat4(-W / 2, 0, D / 2, 0, 0, 0), L: W, front: true },
    { m: mat4(W / 2, 0, -D / 2, 0, Math.PI, 0), L: W },
    { m: mat4(-W / 2, 0, -D / 2 + T, 0, -Math.PI / 2, 0), L: D - 2 * T, gable: true },
    { m: mat4(W / 2, 0, D / 2 - T, 0, Math.PI / 2, 0), L: D - 2 * T, gable: true },
  ];
  for (const wl of walls) {
    const L = wl.L;
    const ops = wl.front ? [{ x: L / 2 - 1.8, y: 0.0, w: 3.6, h: 3.4, gate: true }, { x: 1.0, y: 1.4, w: 0.6, h: 0.6 }, { x: L - 1.6, y: 1.4, w: 0.6, h: 0.6 }] : [{ x: L / 2 - 0.3, y: 1.6, w: 0.6, h: 0.5 }];
    const outline = [[0, -0.8], [L, -0.8], [L, eave], [0, eave]];
    lod0.wall('stoneWall', outline, ops, 0.55, wl.m);
    lod1.wall('stoneWall', outline, [], 0.4, wl.m);
    for (const o of ops) {
      if (o.gate) {
        lod0.add('door', new THREE.BoxGeometry(o.w, o.h, 0.1), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, -0.3)), { ao: 0.7 });
        lod0.add('wood', new THREE.BoxGeometry(o.w + 0.3, 0.25, 0.3), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h + 0.12, 0)), { aoGround: false });
        lod1.add('door', new THREE.PlaneGeometry(o.w, o.h), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, 0.03)));
      } else {
        lod0.add('wood', new THREE.BoxGeometry(o.w, o.h, 0.06), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, -0.25)), { aoGround: false, ao: 0.6 });
      }
    }
    const pts = [[0, -0.8], [L, -0.8]];
    for (let k = 4; k >= 0; k--) pts.push([L * k / 4, 1 + rnd() * (eave - 1)]);
    ruin.wall('stoneWall', pts, [], 0.55, wl.m, { ao: 0.55 });
    if (wl.gable) {
      // boarded gable triangle
      const tri = [[0, eave], [L, eave], [L / 2, ridgeY - 0.1]];
      lod0.wall('boards', tri, [{ x: L / 2 - 0.5, y: eave + 1.2, w: 1.0, h: 1.2 }], 0.08, wl.m.clone().multiply(mat4(0, 0, 0.02)));
      lod0.add('wood', new THREE.BoxGeometry(1.0, 1.2, 0.05), wl.m.clone().multiply(mat4(L / 2, eave + 1.8, -0.1)), { aoGround: false, ao: 0.4 });
      lod1.wall('boards', tri, [], 0.08, wl.m);
    }
  }
  lod0.box('interior', W - 1.1, 0.2, D - 1.1, 0, eave - 0.2, 0, 0, { ao: 0.4, aoGround: false });
  gableRoof(lod0, 'roof', W, D, eave, pitch, { eave: 0.6, gable: 0.4 });
  gableRoof(lod1, 'roof', W, D, eave, pitch, { eave: 0.6, gable: 0.4, thick: 0.2 });
  rubble(ruin, W, D, eave, rnd);
  return { lod0, lod1, ruin, w: W, d: D, h: ridgeY + 0.5, eave };
}

// ---------------------------------------------------------------- church
export function makeChurch(seed, p) {
  const rnd = mulberry32(seed);
  const lod0 = new GB(), lod1 = new GB(), ruin = new GB();
  const W = p.w, D = p.d;             // nave length along x
  const eave = p.nave ?? 11;
  const naveWalls = [
    { m: mat4(-W / 2, 0, D / 2, 0, 0, 0), L: W },
    { m: mat4(W / 2, 0, -D / 2, 0, Math.PI, 0), L: W },
  ];
  const tanP = Math.tan(deg(55));
  const ridgeY = eave + tanP * D / 2;
  for (const wl of naveWalls) {
    const n = Math.floor(W / 4.5);
    const ops = [];
    for (let i = 0; i < n; i++) ops.push({ x: (i + 0.5) * W / n - 0.8, y: 3.2, w: 1.6, h: 5.2 });
    const outline = [[0, -0.8], [W, -0.8], [W, eave], [0, eave]];
    lod0.wall('stoneWall', outline, ops, 0.9, wl.m);
    lod1.wall('stoneWall', outline, [], 0.5, wl.m);
    for (const o of ops) {
      lod0.add('glassLead', new THREE.PlaneGeometry(o.w, o.h), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, -0.3)), { aoGround: false, ao: 0.8 });
      lod0.add('stone', new THREE.BoxGeometry(o.w + 0.3, 0.12, 0.4), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y - 0.06, 0.05)), { aoGround: false });
      lod1.add('glassFar', new THREE.PlaneGeometry(o.w, o.h), wl.m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, 0.03)));
    }
    // buttresses
    for (let i = 0; i <= n; i++) {
      const g = new THREE.BoxGeometry(0.9, eave * 0.8, 1.0);
      lod0.add('stoneWall', g, wl.m.clone().multiply(mat4(i * W / n, eave * 0.4, 0.5)));
    }
    const pts = [[0, -0.8], [W, -0.8]];
    for (let k = 6; k >= 0; k--) pts.push([W * k / 6, 2 + rnd() * (eave - 2)]);
    ruin.wall('stoneWall', pts, [], 0.9, wl.m, { ao: 0.55 });
  }
  // apse end + tower end walls
  for (const s of [-1, 1]) {
    const m = s < 0 ? mat4(-W / 2, 0, -D / 2 + 0.9, 0, -Math.PI / 2, 0) : mat4(W / 2, 0, D / 2 - 0.9, 0, Math.PI / 2, 0);
    const L = D - 1.8;
    const outline = [[0, -0.8], [L, -0.8], [L, eave + tanP * 0.9], [L / 2, ridgeY], [0, eave + tanP * 0.9]];
    const ops = s > 0 ? [{ x: L / 2 - 1.2, y: 5, w: 2.4, h: 5.5 }] : [];
    lod0.wall('stoneWall', outline, ops, 0.9, m);
    lod1.wall('stoneWall', outline, [], 0.5, m);
    for (const o of ops) lod0.add('glassLead', new THREE.PlaneGeometry(o.w, o.h), m.clone().multiply(mat4(o.x + o.w / 2, o.y + o.h / 2, -0.3)), { aoGround: false });
  }
  lod0.box('interior', W - 1.8, 0.3, D - 1.8, 0, 0, 0, 0, { aoGround: false, ao: 0.5 });
  gableRoof(lod0, 'slate', W, D, eave, 55, { eave: 0.5, gable: 0.3 });
  gableRoof(lod1, 'slate', W, D, eave, 55, { eave: 0.5, gable: 0.3, thick: 0.25 });
  // west tower with octagonal spire
  const tw = D * 0.62, tx = -W / 2 - tw / 2 + 0.4, th = p.tower ?? 34;
  for (const gb of [lod0, lod1]) {
    gb.box('stoneWall', tw, th, tw, tx, -0.8, 0, 0, { bevel: gb === lod0 ? 0.08 : 0 });
    gb.box('stone', tw + 0.4, 0.5, tw + 0.4, tx, th - 0.8, 0, 0, { aoGround: false });
    const sp = new THREE.ConeGeometry(tw * 0.62, th * 0.65, 8, 1);
    gb.add('slate', sp, mat4(tx, th - 0.3 + th * 0.325, 0, 0, Math.PI / 8, 0), { uv: 'keep', uvScale: [tw * 4, th * 0.65], aoGround: false });
    gb.cyl('zinc', 0.06, 0.06, 3, tx, th - 0.3 + th * 0.65, 0, 6, { aoGround: false });
  }
  // belfry openings (dark insets)
  for (let a = 0; a < 4; a++) {
    const r = tw / 2 + 0.01;
    const m = mat4(tx + Math.sin(a * Math.PI / 2) * r, th - 5, Math.cos(a * Math.PI / 2) * r, 0, a * Math.PI / 2, 0);
    lod0.add('glassFar', new THREE.PlaneGeometry(1.4, 2.6), m, { aoGround: false, ao: 0.3 });
    lod0.add('stone', new THREE.BoxGeometry(tw * 0.7, 0.9, 0.1), mat4(tx + Math.sin(a * Math.PI / 2) * r, th - 13, Math.cos(a * Math.PI / 2) * r, 0, a * Math.PI / 2, 0), { aoGround: false });
  }
  ruin.box('stoneWall', tw, th * 0.55, tw, tx, -0.8, 0, 0, { ao: 0.6 });
  rubble(ruin, W, D, eave, rnd);
  return { lod0, lod1, ruin, w: W + tw, d: D, h: th * 1.65, eave };
}

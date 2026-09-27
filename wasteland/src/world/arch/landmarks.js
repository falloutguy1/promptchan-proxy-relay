// Landmark buildings of Rustwater Crossing: fuel station (canopy, pump island,
// kiosk, pylon sign), village shop, Rozhnovsky-type water tower and a timber barn.
// Same conventions as house.js: local space, ground at y = 0, entrance toward +Z.
import * as THREE from 'three';
import { Geo } from './geom.js';
import { TILES } from './house.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Flat-roofed masonry box with parapet, shopfront glazing and a door.
function shopBox(g, rng, { W, D, H, wall, frame, cond, front }) {
  const t = 0.4, plinth = 0.3;
  g.exposure = 1;
  g.box('concrete', 0, (plinth - 1) / 2, 0, W + 0.1, plinth + 1, D + 0.1, 0.02);
  const IN = 'wall_interior';
  const walls = [
    { x: -W / 2, z: D / 2 - t / 2, ry: 0, L: W, ops: front, ends: true },
    { x: W / 2, z: -D / 2 + t / 2, ry: Math.PI, L: W, ops: [{ u0: W / 2 - 0.5, u1: W / 2 + 0.45, v0: 0, v1: 2.05, door: true }], ends: true },
    { x: W / 2 - t / 2, z: D / 2 - t, ry: Math.PI / 2, L: D - 2 * t, ops: [{ u0: 1.2, u1: 2.2, v0: 1.4, v1: 2.4 }], ends: false },
    { x: -W / 2 + t / 2, z: -D / 2 + t, ry: -Math.PI / 2, L: D - 2 * t, ops: [], ends: false },
  ];
  for (const w of walls) {
    g.pushTRS(w.x, plinth, w.z, w.ry);
    g.wall(wall, IN, w.L, H, t, w.ops, { top: false, ends: w.ends });
    for (const o of w.ops) {
      const ww = o.u1 - o.u0, hh = o.v1 - o.v0, cx = (o.u0 + o.u1) / 2, zf = t / 2 - 0.12;
      // steel shopfront frames (door or window)
      g.box(frame, o.u0 + 0.04, (o.v0 + o.v1) / 2, zf, 0.08, hh, 0.1, 0.006);
      g.box(frame, o.u1 - 0.04, (o.v0 + o.v1) / 2, zf, 0.08, hh, 0.1, 0.006);
      g.box(frame, cx, o.v1 - 0.04, zf, ww, 0.08, 0.1, 0.006);
      if (!o.door) {
        g.box(frame, cx, o.v0 + 0.04, zf, ww, 0.08, 0.1, 0.006);
        const mul = Math.max(1, Math.round(ww / 1.4));
        for (let k = 1; k < mul; k++) g.box(frame, o.u0 + (ww * k) / mul, (o.v0 + o.v1) / 2, zf, 0.06, hh, 0.09, 0.005);
        // glazing, partly smashed
        for (let k = 0; k < mul; k++) {
          if (rng.next() > cond + 0.15) continue;
          const a0 = o.u0 + (ww * k) / mul + 0.05, a1 = o.u0 + (ww * (k + 1)) / mul - 0.05;
          g.rect('glass', 'z', zf, a0, a1, o.v0 + 0.08, o.v1 - 0.08, 1);
        }
        g.pushTRS(cx, o.v0 - 0.02, t / 2 - 0.02, 0, 0.08);
        g.box('metal_white:#aaa89f', 0, 0, 0, ww + 0.1, 0.025, 0.2, 0.004);
        g.pop();
        if (rng.next() > cond) {
          // corrugated sheets bolted over the broken shopfront
          g.pushTRS(cx, (o.v0 + o.v1) / 2, t / 2 + 0.03, 0, 0, rng.float(-0.05, 0.05));
          g.box(rng.next() < 0.5 ? 'corr_rust' : 'corr_worn', 0, 0, 0, ww * rng.float(0.55, 0.95), hh * rng.float(0.7, 1.0), 0.02, 0.004);
          g.pop();
        }
      } else {
        const lw = ww - 0.1;
        g.pushTRS(o.u0 + 0.05, (hh - 0.06) / 2, zf, rng.float(0.2, 1.3));
        g.box(frame, lw / 2, 0, 0, lw, hh - 0.08, 0.05, 0.005);
        g.pop();
      }
    }
    g.pop();
  }
  // floor, ceiling, flat roof with parapet and coping
  g.exposure = 0;
  g.box('concrete', 0, plinth - 0.05, 0, W - 2 * t, 0.1, D - 2 * t, 0);
  g.rect(IN, 'y', plinth + H - 0.001, -W / 2 + t, W / 2 - t, -D / 2 + t, D / 2 - t, -1);
  g.exposure = 1;
  g.box('concrete', 0, plinth + H + 0.12, 0, W, 0.24, D, 0.01);
  const pH = 0.55;
  for (const [x, z, sx, sz] of [[0, D / 2 - 0.1, W, 0.2], [0, -D / 2 + 0.1, W, 0.2], [W / 2 - 0.1, 0, 0.2, D - 0.4], [-W / 2 + 0.1, 0, 0.2, D - 0.4]]) {
    g.box(wall, x, plinth + H + 0.24 + pH / 2, z, sx, pH, sz, 0.01);
    g.box('metal_white:#8c8f8e', x, plinth + H + 0.24 + pH + 0.02, z, sx + 0.06, 0.04, sz + 0.06, 0.004);
  }
  // roofing felt, patched
  g.box('roof_asbestos:#5d5b57', 0, plinth + H + 0.25, 0, W - 0.4, 0.02, D - 0.4, 0.002);
  return { top: plinth + H + 0.24 + pH, plinth, t };
}

export function buildStore(p, rng) {
  const g = new Geo(TILES);
  const W = p.w, D = p.d, H = 3.3;
  const front = [
    { u0: 0.9, u1: W / 2 - 1.0, v0: 0.75, v1: 2.75 },
    { u0: W / 2 - 0.55, u1: W / 2 + 0.55, v0: 0, v1: 2.2, door: true },
    { u0: W / 2 + 1.0, u1: W - 0.9, v0: 0.75, v1: 2.75 },
  ];
  const r = shopBox(g, rng, { W, D, H, wall: 'brick_white', frame: 'metal_green', cond: 0.35, front });
  // fascia sign band
  const signs = [{ text: 'ПРОДУКТЫ', x: 0, y: r.plinth + H - 0.15, w: W * 0.7, h: 0.75 }];
  g.pushTRS(0, r.plinth + H - 0.18, D / 2 + 0.06);
  g.box('metal_green', 0, 0, 0, W * 0.74, 0.85, 0.08, 0.01);
  g.pop();
  // steps
  g.box('concrete', 0, 0.12, D / 2 + 0.45, 2.4, 0.3, 0.9, 0.015);
  const furniture = [
    { kind: 'steel_frame_shelves_01', x: -W / 2 + 1.2, z: -D / 2 + 0.8, rot: 0, y: r.plinth },
    { kind: 'steel_frame_shelves_01', x: -W / 2 + 3.0, z: -D / 2 + 0.8, rot: 0, y: r.plinth, tipped: true },
    { kind: 'steel_frame_shelves_01', x: W / 2 - 1.5, z: -D / 2 + 0.8, rot: 0, y: r.plinth },
    { kind: 'cardboard_box_01', x: 1.2, z: 0.5, rot: 0.7, y: r.plinth },
    { kind: 'russian_food_cans_01', x: -0.8, z: -0.4, rot: 2.1, y: r.plinth },
  ];
  return { geo: g.build(), signs, furniture, colliders: [{ x: 0, z: 0, hw: W / 2, hd: D / 2, rot: 0 }], height: r.top };
}

export function buildGasStation(p, rng) {
  const g = new Geo(TILES);
  // kiosk at the back of the lot, canopy + pumps toward the road (+Z)
  const kW = 9, kD = 6.5, kH = 3.1;
  g.pushTRS(-4, 0, -p.d / 2 + kD / 2 + 0.5);
  const front = [
    { u0: 0.8, u1: 3.6, v0: 0.8, v1: 2.6 },
    { u0: 4.0, u1: 5.0, v0: 0, v1: 2.2, door: true },
    { u0: 5.5, u1: 8.2, v0: 0.8, v1: 2.6 },
  ];
  const r = shopBox(g, rng, { W: kW, D: kD, H: kH, wall: 'plaster_mossy:#e4e2dc', frame: 'metal_red', cond: 0.3, front });
  g.pushTRS(0, r.plinth + kH - 0.15, kD / 2 + 0.06);
  g.box('metal_red', 0, 0, 0, kW * 0.8, 0.7, 0.08, 0.01);
  g.pop();
  g.pop();

  // canopy on four steel columns
  const cx = 2, cz = p.d / 2 - 7.5, cW = 13, cD = 8, cH = 5.0;
  g.exposure = 1;
  for (const [x, z] of [[-cW / 2 + 1.5, -cD / 2 + 1.2], [cW / 2 - 1.5, -cD / 2 + 1.2], [-cW / 2 + 1.5, cD / 2 - 1.2], [cW / 2 - 1.5, cD / 2 - 1.2]]) {
    g.tube('metal_white:#b9b7b0', [V3(cx + x, -0.3, cz + z), V3(cx + x, cH, cz + z)], 0.16, 14, false);
    g.box('concrete', cx + x, 0.15, cz + z, 0.6, 0.3, 0.6, 0.02);
  }
  g.box('metal_white:#d6d3cb', cx, cH + 0.35, cz, cW, 0.7, cD, 0.02);               // canopy deck
  g.box('metal_red', cx, cH + 0.4, cz + cD / 2 + 0.03, cW + 0.1, 0.62, 0.06, 0.01);   // fascia front
  g.box('metal_red', cx, cH + 0.4, cz - cD / 2 - 0.03, cW + 0.1, 0.62, 0.06, 0.01);
  g.box('metal_red', cx + cW / 2 + 0.03, cH + 0.4, cz, 0.06, 0.62, cD, 0.01);
  g.box('metal_red', cx - cW / 2 - 0.03, cH + 0.4, cz, 0.06, 0.62, cD, 0.01);
  for (let i = -1; i <= 1; i++) g.box('glass', cx + i * 4, cH - 0.02, cz, 1.2, 0.04, 0.35, 0.005); // light fittings (broken)
  // pump island: curb, two dispensers, hoses
  g.box('concrete', cx, 0.12, cz, 1.3, 0.24, 6.2, 0.03);
  g.box('metal_white:#e9e6dc', cx, 0.26, cz, 1.36, 0.04, 6.26, 0.01);
  for (const z of [-1.6, 1.6]) {
    g.pushTRS(cx, 0.28, cz + z, rng.float(-0.03, 0.03));
    g.box('metal_white:#d9d5ca', 0, 0.8, 0, 0.62, 1.6, 0.42, 0.02);
    g.box('metal_red', 0, 1.72, 0, 0.66, 0.24, 0.46, 0.015);
    g.box('dark', 0, 1.2, 0.215, 0.36, 0.22, 0.02, 0.004);
    g.box('glass', 0, 1.2, 0.228, 0.38, 0.24, 0.005, 0.001);
    g.box('metal_white:#55544f', 0.34, 0.95, 0, 0.08, 0.22, 0.12, 0.01);
    g.tube('dark', [V3(0.3, 1.45, 0.05), V3(0.55, 1.2, 0.1), V3(0.65, 0.5, 0.35), V3(0.5, 0.15, 0.65), V3(0.25, 0.08, 0.95)], 0.022, 6, false);
    g.pop();
  }
  // pylon sign by the road
  const sx = p.w / 2 - 2.5, sz = p.d / 2 - 1.2;
  g.tube('metal_white:#9d9b95', [V3(sx, -0.3, sz), V3(sx, 7.2, sz)], 0.12, 12, false);
  g.box('metal_red', sx, 7.6, sz, 2.6, 1.6, 0.25, 0.02);
  g.box('concrete', sx, 0.1, sz, 0.9, 0.3, 0.9, 0.02);
  // forecourt concrete slab
  g.box('concrete', cx - 1, -0.08, cz + 0.5, cW + 6, 0.2, cD + 6, 0.02);
  const signs = [
    { text: 'АЗС', x: sx, y: 7.6, z: sz, w: 2.4, h: 1.4, both: true, bg: '#e7e2d6', fg: '#b3261e' },
    { text: 'БЕНЗИН', x: -4, y: r.plinth + kH - 0.15, z: -p.d / 2 + kD + 0.62, w: kW * 0.76, h: 0.6, bg: '#ece8de', fg: '#1d4f86' },
  ];
  const furniture = [
    { kind: 'steel_frame_shelves_01', x: -6.6, z: -p.d / 2 + 2.2, rot: 0, y: r.plinth },
    { kind: 'metal_trash_can', x: cx + 1.2, z: cz + 3.6, rot: 0.4, y: 0.02 },
  ];
  const colliders = [
    { x: -4, z: -p.d / 2 + kD / 2 + 0.5, hw: kW / 2, hd: kD / 2, rot: 0 },
    { x: cx, z: cz, hw: 0.7, hd: 3.2, rot: 0 },
  ];
  return { geo: g.build(), signs, furniture, colliders, height: cH + 0.8 };
}

export function buildWaterTower(p, rng) {
  // brick shaft + riveted steel tank + conical roof, access door, ladder, railing
  const g = new Geo(TILES);
  g.exposure = 1;
  const shaftR = 1.45, shaftH = 12.5, tankR = 2.6, tankH = 3.6;
  g.lathe('brick_red', [[shaftR * 1.25, -0.6], [shaftR * 1.25, 0.6], [shaftR * 1.02, 0.75], [shaftR, 3], [shaftR * 0.94, shaftH]], 28);
  g.lathe('concrete', [[shaftR * 1.3, shaftH], [tankR * 1.02, shaftH + 0.25], [tankR * 1.02, shaftH + 0.45]], 28);
  g.lathe('metal_white:#c9c7bf', [[tankR, shaftH + 0.45], [tankR, shaftH + 0.45 + tankH]], 32);
  g.lathe('metal_white:#b6b3a9', [[tankR + 0.05, shaftH + 0.45 + tankH], [0.25, shaftH + 0.45 + tankH + 1.6], [0.02, shaftH + 0.45 + tankH + 1.7]], 32);
  // rivet bands
  for (let y = shaftH + 1.2; y < shaftH + tankH; y += 1.1) g.lathe('metal_white:#aaa79d', [[tankR + 0.02, y], [tankR + 0.02, y + 0.06]], 32);
  // walkway ring with railing
  const ringY = shaftH + 0.45;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, a2 = ((i + 1) / 24) * Math.PI * 2;
    const r = tankR + 0.75;
    g.tube('metal_white:#8b8980', [V3(Math.cos(a) * r, ringY + 1.0, Math.sin(a) * r), V3(Math.cos(a2) * r, ringY + 1.0, Math.sin(a2) * r)], 0.03, 5, false);
    g.tube('metal_white:#8b8980', [V3(Math.cos(a) * r, ringY, Math.sin(a) * r), V3(Math.cos(a) * r, ringY + 1.0, Math.sin(a) * r)], 0.025, 5, false);
  }
  g.lathe('metal_white:#7f7d75', [[tankR, ringY - 0.02], [tankR + 0.8, ringY - 0.02], [tankR + 0.8, ringY + 0.03], [tankR, ringY + 0.03]], 32);
  // ladder up the shaft
  const lz = shaftR + 0.25;
  for (const x of [-0.25, 0.25]) g.beam('metal_white:#77756e', V3(x, 0.4, lz), V3(x, ringY, lz + 0.35), 0.05, 0.05, 0.008);
  for (let y = 0.7; y < ringY; y += 0.3) g.beam('metal_white:#77756e', V3(-0.25, y, lz + (y / ringY) * 0.35), V3(0.25, y, lz + (y / ringY) * 0.35), 0.025, 0.025, 0.004);
  // door (steel) in a brick surround
  g.box('metal_green', 0, 1.05, shaftR * 1.02 + 0.03, 0.95, 2.0, 0.06, 0.01);
  return { geo: g.build(), signs: [], furniture: [], colliders: [{ x: 0, z: 0, r: shaftR * 1.3 }], height: ringY + tankH + 2 };
}

export function buildBarn(p, rng) {
  // timber-framed barn with vertical board cladding, big doors, sagging corrugated roof
  const g = new Geo(TILES);
  const W = p.w, D = p.d, H = 4.2, pitch = THREE.MathUtils.degToRad(28);
  g.exposure = 1;
  g.box('concrete', 0, -0.2, 0, W + 0.2, 0.6, D + 0.2, 0.02);
  const t = 0.08;
  const walls = [
    { x: -W / 2, z: D / 2 - t / 2, ry: 0, L: W, ops: [{ u0: W / 2 - 2.2, u1: W / 2 + 2.2, v0: 0, v1: 3.6 }] },
    { x: W / 2, z: -D / 2 + t / 2, ry: Math.PI, L: W, ops: [{ u0: 3, u1: 4.2, v0: 1.6, v1: 2.6 }] },
    { x: W / 2 - t / 2, z: D / 2 - t, ry: Math.PI / 2, L: D - 2 * t, ops: [] },
    { x: -W / 2 + t / 2, z: -D / 2 + t, ry: -Math.PI / 2, L: D - 2 * t, ops: [{ u0: 3, u1: 5, v0: 0.3, v1: 2.2 }] },
  ];
  for (const w of walls) {
    g.pushTRS(w.x, 0.1, w.z, w.ry);
    g.wall('wood_weathered', 'wood_weathered', w.L, H, t, w.ops, { top: true, ends: true });
    // posts
    for (let u = 0; u <= w.L + 0.01; u += w.L / Math.round(w.L / 3)) g.box('wood_weathered:#8a7e70', u, H / 2, -0.12, 0.18, H, 0.18, 0.02);
    if (w.ry === Math.PI / 2 || w.ry === -Math.PI / 2) {
      g.pushTRS(-t, 0, 0);
      g.gable('wood_weathered', 'wood_weathered', w.L + 2 * t, H, (D / 2) * Math.tan(pitch), t);
      g.pop();
    }
    g.pop();
  }
  // big sliding door leaf, half open
  g.pushTRS(-W / 2 + W / 2 - 2.2 - 1.6, 1.85, D / 2 + 0.12);
  g.box('wood_weathered:#9b8c7a', 0, 0, 0, 2.3, 3.7, 0.08, 0.01);
  g.pop();
  // roof: corrugated rusted sheets on purlins, some missing, a sag in the middle
  const ridgeY = 0.1 + H + (D / 2) * Math.tan(pitch);
  const slope = (D / 2 + 0.4) / Math.cos(pitch);
  for (const side of [1, -1]) {
    g.push(new THREE.Matrix4().compose(V3(0, ridgeY, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, side > 0 ? 0 : Math.PI, 0, 'YXZ')), V3(1, 1, 1)));
    const n = Math.round((W + 0.6) / 1.0);
    for (let i = 0; i < n; i++) {
      const x = -(W + 0.6) / 2 + (i + 0.5) * ((W + 0.6) / n);
      if (rng.next() < 0.18) continue;
      const sag = Math.sin((i / (n - 1)) * Math.PI) * 0.12;
      g.pushTRS(x, -sag, slope / 2, 0, rng.float(-0.01, 0.02));
      g.box('corr_rust', 0, 0, 0, (W + 0.6) / n + 0.05, 0.02, slope, 0.003);
      g.pop();
    }
    for (let z = 0.3; z < slope; z += 1.1) g.box('wood_weathered', 0, -0.08, z, W + 0.4, 0.1, 0.08, 0.01);
    g.pop();
  }
  return { geo: g.build(), signs: [], furniture: [{ kind: 'wooden_ladder', x: W / 2 - 1, z: -D / 2 + 0.6, rot: 0.2, y: 0.1, lean: true }], colliders: [{ x: 0, z: 0, hw: W / 2, hd: D / 2, rot: 0 }], height: ridgeY };
}

export function buildShed(p, rng) {
  // small plank shed with a mono-pitch corrugated roof and a plank door
  const g = new Geo(TILES);
  const W = p.w, D = p.d, Hf = 2.3, Hb = 1.9, t = 0.05;
  g.exposure = 1;
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    const h = z > 0 ? Hf : Hb;
    g.box('wood_weathered:#8b8175', x, h / 2 - 0.2, z, 0.1, h + 0.4, 0.1, 0.012);
  }
  const plank = (x0, z0, x1, z1, h0, h1, door) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 0.16);
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      if (door && f > 0.3 && f < 0.72) continue;
      if (rng.next() < 0.04) continue; // missing board
      const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, h = h0 + (h1 - h0) * f;
      g.pushTRS(x, h / 2 + 0.02, z, ang, 0, rng.float(-0.01, 0.01));
      g.box('wood_weathered', 0, 0, 0, L / n - 0.008, h, 0.022, 0.004);
      g.pop();
    }
  };
  plank(-W / 2, D / 2, W / 2, D / 2, Hf, Hf, true);
  plank(W / 2, -D / 2, -W / 2, -D / 2, Hb, Hb, false);
  plank(W / 2, D / 2, W / 2, -D / 2, Hf, Hb, false);
  plank(-W / 2, -D / 2, -W / 2, D / 2, Hb, Hf, false);
  // door leaf (boards + Z brace), ajar
  g.pushTRS(-W / 2 + W * 0.3, 0.98, D / 2 + 0.03, rng.float(0.1, 1.2));
  g.box('wood_weathered:#a39684', W * 0.21, 0, 0, W * 0.42, 1.9, 0.03, 0.005);
  g.pop();
  // roof
  const slope = Math.atan2(Hf - Hb, D);
  g.pushTRS(0, (Hf + Hb) / 2 + 0.06, 0, 0, -slope);
  g.box(rng.next() < 0.5 ? 'corr_rust' : 'corr_worn', 0, 0, 0, W + 0.5, 0.025, Math.hypot(D, Hf - Hb) + 0.5, 0.004);
  g.box('wood_weathered', 0, -0.07, 0, W + 0.2, 0.1, 0.08, 0.01);
  g.pop();
  return { geo: g.build(), signs: [], furniture: [], colliders: [{ x: 0, z: 0, hw: W / 2, hd: D / 2, rot: 0 }], height: Hf };
}

export function buildBusStop(p, rng) {
  // Soviet-era concrete bus shelter: back wall with mosaic panel, side wings, slab roof, bench
  const g = new Geo(TILES);
  const W = p.w, D = p.d, H = 2.5;
  g.exposure = 1;
  g.box('concrete', 0, -0.1, 0, W + 0.6, 0.3, D + 0.8, 0.02);
  g.box('concrete', 0, H / 2 + 0.05, -D / 2 + 0.1, W, H, 0.2, 0.02);
  for (const sx of [-1, 1]) g.box('concrete', sx * (W / 2 - 0.1), H / 2 + 0.05, -0.1, 0.2, H, D - 0.2, 0.02);
  g.pushTRS(0, H + 0.12, 0.2, 0, 0.04);
  g.box('concrete', 0, 0, 0, W + 0.5, 0.2, D + 0.9, 0.03);
  g.pop();
  g.box('wood_painted:#7d8a6a', 0, 0.48, -D / 2 + 0.45, W - 0.6, 0.06, 0.4, 0.008);
  for (const x of [-(W / 2 - 0.6), 0, W / 2 - 0.6]) g.box('concrete', x, 0.23, -D / 2 + 0.45, 0.12, 0.45, 0.35, 0.01);
  return {
    geo: g.build(), signs: [{ text: 'ОСТАНОВКА', x: 0, y: 1.6, z: -D / 2 + 0.21, w: W * 0.7, h: 0.9, bg: '#c9b58a', fg: '#2f4a5c' }],
    furniture: [], colliders: [{ x: 0, z: -D / 2 + 0.1, hw: W / 2, hd: 0.15, rot: 0 }], height: H,
  };
}

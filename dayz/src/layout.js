import { makeSimplex, fbm, smoothstep, clamp, lerp } from './noise.js';

// World layout: one deterministic description of the location that terrain,
// vegetation, props and gameplay all query, so surfaces, plants and objects agree.
//   +x = east, -z = north, y = up, metres.

export const WORLD = {
  size: 1024,          // terrain extent (m)
  res: 1,              // heightfield spacing (m)
  splatSize: 384,      // high-res surface map extent around the farmstead (m)
  splatRes: 1024,      // texels across splatSize (0.375 m / texel)
  house: { x: 0, z: 0, w: 10.4, d: 7.6, rot: 0 },
  pond: { x: 42, z: 58, r: 11, level: 0 },
};

// Layers must match TERRAIN order in tools/build_textures.py
export const L = { grass: 0, meadow: 1, forest: 2, gravel: 3, mud: 4, rock: 5 };

const nA = makeSimplex(11), nB = makeSimplex(23), nC = makeSimplex(37), nD = makeSimplex(59);

// --- Road: Catmull-Rom through control points, resampled at 1 m -------------
const ROAD_CTRL = [[-560, 90], [-380, 58], [-220, 40], [-90, 27], [0, 21], [70, 25], [150, 44], [260, 38], [380, 12], [560, -10]];
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function buildPath(ctrl, step) {
  const pts = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.ceil(len / step);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  pts.push(ctrl[ctrl.length - 1]);
  return pts;
}

class PathField {
  constructor(pts, cell = 16) {
    this.pts = pts; this.cell = cell; this.grid = new Map();
    pts.forEach((p, i) => {
      const k = this.key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
  }
  key(i, j) { return i * 100003 + j; }
  /** nearest point: returns {d, i, side} (d = distance, side = signed lateral offset) or null beyond range */
  nearest(x, z, range = 32) {
    const c = this.cell, r = Math.ceil(range / c);
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = Infinity, bi = -1;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const list = this.grid.get(this.key(i, j));
      if (!list) continue;
      for (const idx of list) {
        const p = this.pts[idx];
        const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
        if (d < best) { best = d; bi = idx; }
      }
    }
    if (bi < 0) return null;
    // refine on the adjacent segments
    let res = { d: Math.sqrt(best), i: bi, t: 0, side: 0 };
    for (const a of [bi - 1, bi]) {
      if (a < 0 || a + 1 >= this.pts.length) continue;
      const p = this.pts[a], q = this.pts[a + 1];
      const dx = q[0] - p[0], dz = q[1] - p[1], L2 = dx * dx + dz * dz;
      const t = clamp(((x - p[0]) * dx + (z - p[1]) * dz) / L2, 0, 1);
      const px = p[0] + dx * t, pz = p[1] + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d <= res.d + 1e-6) {
        const side = ((x - p[0]) * dz - (z - p[1]) * dx) / Math.sqrt(L2);
        res = { d, i: a, t, side };
      }
    }
    return res.d <= range ? res : null;
  }
}

export const road = buildPath(ROAD_CTRL, 1);
export const roadField = new PathField(road);
// Driveway: from the road into the yard, ending at the porch.
export const drive = buildPath([[-4, 21.6], [-3.2, 14], [-2.2, 8.5], [-1.6, 5.2]], 0.5);
export const driveField = new PathField(drive, 8);
// Foot path from the back door into the forest (to the woodpile / stream)
export const trail = buildPath([[2.5, -4.2], [4, -12], [9, -22], [8, -34], [14, -48], [11, -62]], 0.5);
export const trailField = new PathField(trail, 8);

// --- Base height ---------------------------------------------------------------
function baseHeight(x, z) {
  let h = 16 * fbm(nA, x / 420, z / 420, 4) + 4.5 * fbm(nB, x / 110, z / 110, 4) + 0.7 * fbm(nC, x / 22, z / 22, 3);
  h += -0.035 * z;                               // the valley falls gently towards the south
  const r = Math.hypot(x, z);
  h += 55 * smoothstep(260, 520, r) * (0.55 + 0.45 * fbm(nD, x / 160, z / 160, 3)); // horizon hills
  return h;
}

// Road profile along its length: heavily smoothed base height so it never follows small bumps
const roadH = (() => {
  const raw = road.map(([x, z]) => baseHeight(x, z));
  const out = new Float32Array(raw.length);
  const R = 30;
  for (let i = 0; i < raw.length; i++) {
    let s = 0, w = 0;
    for (let k = -R; k <= R; k++) {
      const j = clamp(i + k, 0, raw.length - 1);
      const g = Math.exp(-(k * k) / (2 * 12 * 12));
      s += raw[j] * g; w += g;
    }
    out[i] = s / w;
  }
  return out;
})();

const H = WORLD.house;
export const PAD_Y = baseHeight(H.x, H.z) + 0.1;        // yard level
export const FLOOR_Y = PAD_Y + 0.62;                     // finished floor (on plinth)
WORLD.pond.level = baseHeight(WORLD.pond.x, WORLD.pond.z) - 1.2;

function sdBox(x, z, cx, cz, hw, hd) {
  const dx = Math.abs(x - cx) - hw, dz = Math.abs(z - cz) - hd;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}

/** Full-detail height with all sculpted features. Also returns feature distances for surfacing. */
export function sculpt(x, z, out = {}) {
  let h = baseHeight(x, z);
  // yard pad
  const dHouse = sdBox(x, z, H.x, H.z + 3, 12, 14);
  const padW = 1 - smoothstep(0, 16, dHouse);
  const padNoise = 0.12 * fbm(nC, x / 6, z / 6, 2);
  h = lerp(h, PAD_Y + padNoise - 0.004 * (z - H.z), padW);

  // road corridor: crown, shoulders, ditches
  const rn = roadField.nearest(x, z, 40);
  let dRoad = 1e9;
  if (rn) {
    dRoad = rn.d;
    const rh = lerp(roadH[rn.i], roadH[Math.min(rn.i + 1, roadH.length - 1)], rn.t);
    const core = 2.3, shoulder = 3.3;
    let target = rh + 0.08 - 0.06 * (dRoad / core) ** 2;
    const ditch = -0.45 * smoothstep(shoulder, 4.0, dRoad) * (1 - smoothstep(4.6, 5.8, dRoad));
    const w = 1 - smoothstep(5.5, 16, dRoad);
    // wheel ruts: shallow grooves at ±0.85 m
    const rut = Math.exp(-((Math.abs(rn.side) - 0.85) ** 2) / (2 * 0.22 * 0.22));
    target += ditch - 0.07 * rut;
    h = lerp(h, target, w);
    // Where the yard meets the road, blend the pad into the road embankment
  }
  // driveway
  const dn = driveField.nearest(x, z, 12);
  let dDrive = 1e9;
  if (dn) {
    dDrive = dn.d;
    const w = 1 - smoothstep(1.6, 5, dDrive);
    h = lerp(h, h - 0.06 * (1 - smoothstep(0, 1.4, dDrive)), w);
  }
  const tn = trailField.nearest(x, z, 6);
  const dTrail = tn ? tn.d : 1e9;
  if (tn) h -= 0.05 * (1 - smoothstep(0, 0.7, dTrail));

  // pond: a bowl below the water level with a shallow shelf
  const P = WORLD.pond;
  const dp = Math.hypot((x - P.x) * 1.0, (z - P.z) * 1.35) + 2.5 * fbm(nB, x / 9, z / 9, 2);
  if (dp < P.r + 14) {
    const bowl = P.level - 1.6 * (1 - smoothstep(0, P.r, dp)) - 0.25;
    const shore = smoothstep(P.r - 1.5, P.r + 12, dp);
    h = lerp(Math.min(h, bowl + (P.level + 0.35 - bowl) * smoothstep(P.r - 3, P.r + 1.5, dp)), h, shore);
  }
  out.dHouse = dHouse; out.dRoad = dRoad; out.dDrive = dDrive; out.dTrail = dTrail; out.dPond = dp;
  out.roadSide = rn ? rn.side : 0;
  return h;
}

/** Forest density 0..1: continuous forest to the north, wood lots and hedgerows elsewhere. */
export function forestMask(x, z) {
  const edgeZ = -30 + 10 * fbm(nB, x / 60, 0.5, 3) + 0.00008 * x * x;
  let f = smoothstep(edgeZ + 6, edgeZ - 10, z);
  const lots = smoothstep(0.18, 0.42, fbm(nD, x / 150 + 7, z / 150 - 3, 4));
  f = Math.max(f, lots * smoothstep(90, 150, Math.hypot(x, z - 20)));
  // keep the yard, the road and the pond open
  const dH = sdBox(x, z, 0, 3, 14, 16);
  f *= smoothstep(4, 16, dH);
  const rn = roadField.nearest(x, z, 20);
  if (rn) f *= smoothstep(7, 16, rn.d);
  const P = WORLD.pond;
  f *= smoothstep(P.r + 2, P.r + 12, Math.hypot(x - P.x, z - P.z));
  return f;
}

/** Soil moisture 0..1: low ground, near the pond and the ditches. */
export function moisture(x, z, feat) {
  let m = 0.35 + 0.35 * fbm(nC, x / 45, z / 45, 3);
  if (feat) {
    m += 0.6 * (1 - smoothstep(WORLD.pond.r - 1, WORLD.pond.r + 10, feat.dPond));
    m += 0.25 * (smoothstep(3.3, 4.2, feat.dRoad) * (1 - smoothstep(4.8, 6.5, feat.dRoad)));
  }
  return clamp(m, 0, 1);
}

/**
 * Surface weights for the six terrain layers at (x,z), given height slope.
 * Returns weights into w (length 6, normalized).
 */
export function surface(x, z, h, slope, feat, w) {
  w.fill(0);
  const fm = forestMask(x, z);
  const moist = moisture(x, z, feat);
  const n1 = fbm(nA, x / 7, z / 7, 3), n2 = fbm(nB, x / 2.2, z / 2.2, 2);
  // meadow vs. lawn
  const meadow = smoothstep(-0.25, 0.35, fbm(nD, x / 35, z / 35, 3)) * 0.8 + 0.2;
  w[L.grass] = (1 - meadow) * (1 - fm);
  w[L.meadow] = meadow * (1 - fm);
  w[L.forest] = fm * (0.8 + 0.4 * n1);
  // bare wet patches in meadows / under forest
  w[L.mud] = Math.max(0, moist - 0.62) * 2.2 * (0.5 + n2);
  // road: gravel crown, muddy ruts & puddled edges
  if (feat.dRoad < 7) {
    const core = 1 - smoothstep(1.9, 2.9 + 0.5 * n2, feat.dRoad);
    const rut = Math.exp(-((Math.abs(feat.roadSide) - 0.85) ** 2) / (2 * 0.3 * 0.3)) * core;
    const edge = (1 - smoothstep(2.4, 4.0, feat.dRoad)) * (1 - core * 0.6);
    for (let i = 0; i < 6; i++) w[i] *= 1 - core;
    w[L.gravel] += core * (1 - rut * 0.75);
    w[L.mud] += rut * 1.1 + edge * 0.5 * (0.4 + n1);
    w[L.meadow] += edge * 0.6;
  }
  if (feat.dDrive < 3) {
    const core = 1 - smoothstep(0.9, 1.9 + 0.6 * n2, feat.dDrive);
    for (let i = 0; i < 6; i++) w[i] *= 1 - core;
    w[L.gravel] += core * 0.55 * (0.5 + n1);
    w[L.mud] += core * 0.7;
  }
  if (feat.dTrail < 1.6) {
    const core = 1 - smoothstep(0.25, 0.95 + 0.4 * n2, feat.dTrail);
    for (let i = 0; i < 6; i++) w[i] *= 1 - core * 0.85;
    w[L.mud] += core * 0.9;
  }
  // foundation: splash zone of bare soil & gravel around the plinth
  const dh = sdBox(x, z, H.x, H.z, H.w / 2, H.d / 2);
  if (dh < 1.6) {
    const k = 1 - smoothstep(0.2, 1.3 + 0.5 * n2, dh);
    for (let i = 0; i < 6; i++) w[i] *= 1 - k;
    w[L.mud] += k * 0.6; w[L.gravel] += k * 0.5;
  }
  // pond shore
  if (feat.dPond < WORLD.pond.r + 4) {
    const k = 1 - smoothstep(WORLD.pond.r - 2, WORLD.pond.r + 2.5 + 2 * n2, feat.dPond);
    for (let i = 0; i < 6; i++) w[i] *= 1 - k;
    w[L.mud] += k;
  }
  // rock on steep ground
  const rock = smoothstep(0.55, 0.9, slope + 0.2 * (n1 - 0.5));
  for (let i = 0; i < 6; i++) w[i] *= 1 - rock;
  w[L.rock] += rock;
  let s = 0;
  for (let i = 0; i < 6; i++) { w[i] = Math.max(0, w[i]); s += w[i]; }
  if (s < 1e-4) { w[L.grass] = 1; s = 1; }
  for (let i = 0; i < 6; i++) w[i] /= s;
  return w;
}

/** Heightfield sampled on the terrain grid, plus bilinear/normal queries. */
export class Heightfield {
  constructor(data) {
    const N = WORLD.size / WORLD.res + 1;
    this.N = N;
    if (data) { this.data = data; return; }
    this.data = new Float32Array(N * N);
    const half = WORLD.size / 2, f = {};
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      this.data[j * N + i] = sculpt(-half + i * WORLD.res, -half + j * WORLD.res, f);
    }
  }
  height(x, z) {
    const half = WORLD.size / 2, N = this.N;
    const fx = clamp((x + half) / WORLD.res, 0, N - 1.001), fz = clamp((z + half) / WORLD.res, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const d = this.data, a = d[j * N + i], b = d[j * N + i + 1], c = d[(j + 1) * N + i], e = d[(j + 1) * N + i + 1];
    // match the triangle split used by the terrain mesh (diagonal from (i,j+1) to (i+1,j))
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return e + (c - e) * (1 - u) + (b - e) * (1 - v);
  }
  normal(x, z, out) {
    const e = 0.5;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    out.set(-hx, 2 * e, -hz).normalize();
    return out;
  }
  slope(x, z) {
    const e = 1;
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.hypot(hx, hz);
  }
}

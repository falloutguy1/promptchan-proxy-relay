// The playable location: a Franconian river town with a ball-bearing works,
// marshalling yard, rail bridge and fuel depot (inspired by the 1943 Schweinfurt raids).
// Defines the heightfield and all land-use functions shared by terrain, vegetation and props.
import { fbm, ridged, noise2, hash2i, vnoise, smoothstep, clamp, lerp } from '../core/noise.js';

export const HALF = 8192;           // main terrain half size (m)
export const GRID_N = 2049;         // height grid resolution (8 m)
export const CELL = (HALF * 2) / (GRID_N - 1);
export const WATER_Y = 200;
export const RIVER_W = 105;

export function riverZ(x) {
  return 350 + 500 * Math.sin(x / 2300) + 180 * Math.sin(x / 800 + 1.3) + 40 * Math.sin(x / 260 + 0.4);
}
export function riverDist(x, z) {
  // approximate perpendicular distance using local slope
  const z0 = riverZ(x);
  const dz = (riverZ(x + 5) - riverZ(x - 5)) / 10;
  return Math.abs(z - z0) / Math.sqrt(1 + dz * dz);
}

// ---------- Lines (roads & rail) ----------
function P(x, z) { return { x, z }; }
export const RAIL_MAIN = [P(-8400, -1350), P(-5200, -1250), P(-3000, -1110), P(-1600, -1070), P(-1000, -1060), P(400, -1045), P(1500, -1010), P(2600, -900), P(4000, -700), P(6000, -620), P(8400, -500)];
export const RAIL_BRANCH = [P(-3000, -1110), P(-2450, -950), P(-2150, -620), P(-2030, -200), P(-1990, 150), P(-1850, 600), P(-1500, 1500), P(-1100, 3000), P(-600, 5000), P(-200, 8400)];
export const RAIL_SIDING = [P(300, -1040), P(620, -900), P(760, -560), P(820, -300)];

export const ROADS = [
  // river road, north bank (follows the valley)
  { w: 7, kind: 'asphalt', pts: sampleRiverRoad(-8400, 8400, -230) },
  { w: 6, kind: 'asphalt', pts: sampleRiverRoad(-8400, 8400, 260) },
  // town -> north villages
  { w: 6, kind: 'asphalt', pts: [P(-700, -300), P(-800, -900), P(-1200, -1600), P(-2600, -2300), P(-5000, -2500)] },
  { w: 6, kind: 'asphalt', pts: [P(-600, -300), P(200, -700), P(900, -1500), P(1500, -2800), P(1500, -4800), P(1700, -8400)] },
  { w: 5, kind: 'gravel', pts: [P(900, -1500), P(2400, -2400), P(3800, -3200), P(6000, -3600), P(8400, -3500)] },
  // road bridge (town) and south network
  { w: 7, kind: 'asphalt', pts: [P(-600, -150), P(-560, 120), P(-520, 420), P(-500, 800), P(-900, 1600), P(-2500, 4200), P(-3200, 8400)], bridge: true },
  { w: 5, kind: 'gravel', pts: [P(-500, 800), P(-2000, 1800), P(-4200, 2800), P(-8400, 3300)] },
  { w: 5, kind: 'gravel', pts: [P(-500, 800), P(1200, 1000), P(2100, 1050), P(3500, 1700), P(5200, 2400), P(8400, 2900)] },
  { w: 5, kind: 'gravel', pts: [P(3800, -3200), P(4600, -1200), P(4800, -500)] },
  { w: 4, kind: 'gravel', pts: [P(-5000, -2500), P(-6000, -5000), P(-6400, -8400)] },
];

function sampleRiverRoad(x0, x1, off) {
  const pts = [];
  for (let x = x0; x <= x1; x += 250) pts.push(P(x, riverZ(x) + off + 40 * Math.sin(x / 700)));
  return pts;
}

// ---------- Areas ----------
export const TOWN = { x: -650, z: -330, r: 620 };
export const VILLAGES = [
  { x: -5000, z: -2500, r: 210 }, { x: -4200, z: 2800, r: 190 }, { x: 3800, z: -3200, r: 230 },
  { x: 5200, z: 2400, r: 200 }, { x: -2500, z: 4200, r: 170 }, { x: 1500, z: -4800, r: 200 },
  { x: 4800, z: -500, r: 150 }, { x: -6800, z: 600, r: 160 },
];

export const TARGETS = [
  { id: 'works', name: 'Ball-bearing works', short: 'KUGELLAGER WERK', x: 900, z: -330, r: 330, primary: true },
  { id: 'yard', name: 'Marshalling yard', short: 'RANGIERBAHNHOF', x: 150, z: -1050, r: 420 },
  { id: 'bridge', name: 'Rail bridge', short: 'EISENBAHNBRÜCKE', x: -2010, z: 0, r: 90 },
  { id: 'depot', name: 'Fuel depot', short: 'TANKLAGER', x: 2150, z: 1050, r: 170 },
];

export const FLAK_SITES = [
  { x: -250, z: -700 }, { x: 1700, z: -760 }, { x: 1450, z: 250 }, { x: -1300, z: 900 }, { x: 2900, z: -250 }, { x: -2600, z: -500 },
];

// flattened pads: [x, z, radius, strength]
const PADS = [
  [TOWN.x, TOWN.z, TOWN.r * 1.1, 0.75],
  [TARGETS[0].x, TARGETS[0].z, 380, 1.0],
  [TARGETS[1].x, TARGETS[1].z, 300, 0.0], // yard handled by rail flattening
  [TARGETS[3].x, TARGETS[3].z, 210, 1.0],
  ...VILLAGES.map(v => [v.x, v.z, v.r * 1.2, 0.6]),
  ...FLAK_SITES.map(f => [f.x, f.z, 55, 1.0]),
];

// ---------- Base heights ----------
function baseHeight(x, z) {
  const hills = fbm(x / 4200, z / 4200, 5) * 95;
  const ridges = (ridged(x / 2600 + 3.1, z / 2600 - 1.7, 4) - 0.45) * 90;
  const detail = fbm(x / 600, z / 600, 3) * 9;
  let h = 262 + hills + ridges + detail;
  // Main valley: gentle floodplain + terraces
  const d = riverDist(x, z);
  const floor = 211 + fbm(x / 900, z / 900, 2) * 2.5 + Math.max(0, d - 200) * 0.012;
  const t = smoothstep(180, 1500 + 400 * noise2(x / 3000, 1.7), d);
  h = lerp(floor, h, t);
  // river channel
  const half = RIVER_W / 2;
  const bank = smoothstep(half - 18, half + 22, d);
  h = lerp(WATER_Y - 5.5 + 2.5 * smoothstep(0, half, d), h, bank);
  return h;
}

// ---------- Land use ----------
export function urbanAt(x, z) {
  let u = 0;
  const e = noise2(x / 140, z / 140) * 0.35;
  const dt = Math.hypot(x - TOWN.x, z - TOWN.z) / TOWN.r;
  u = Math.max(u, smoothstep(1.05, 0.75, dt + e * 0.4));
  for (const v of VILLAGES) {
    const d = Math.hypot(x - v.x, z - v.z) / v.r;
    u = Math.max(u, smoothstep(1.05, 0.7, d + e * 0.5));
  }
  for (const t of TARGETS) {
    if (t.id === 'bridge') continue;
    // irregular, roughly rectangular works yards rather than discs
    const c = Math.cos(0.32), sn = Math.sin(0.32);
    const lx = ((x - t.x) * c - (z - t.z) * sn) / t.r, lz = ((x - t.x) * sn + (z - t.z) * c) / (t.r * 0.72);
    const d = Math.pow(Math.pow(Math.abs(lx), 4) + Math.pow(Math.abs(lz), 4), 0.25);
    u = Math.max(u, smoothstep(1.0, 0.75, d + e * 0.55 + noise2(x / 60, z / 60) * 0.12) * 0.92);
  }
  return u;
}

export function forestAt(x, z, h) {
  let n = fbm(x / 2100 + 11.3, z / 2100 - 4.2, 4) + 0.25 * fbm(x / 520, z / 520, 2);
  n += clamp((h - 290) / 160, -0.2, 0.35);
  n -= smoothstep(900, 300, riverDist(x, z)) * 0.45;
  n -= urbanAt(x, z) * 1.5;
  for (const t of TARGETS) n -= smoothstep(t.r + 350, t.r, Math.hypot(x - t.x, z - t.z));
  for (const f of FLAK_SITES) n -= smoothstep(160, 60, Math.hypot(x - f.x, z - f.z));
  return n;
}

// Forest potential is stored (coarse) in the land-use mask; the final crisp edge is
// produced by adding hash-based value noise. The terrain shader does the identical math.
export const FOREST_LO = 0.1, FOREST_HI = 0.2;
export function forestPotentialToMask(n) { return clamp((n - FOREST_LO) / (FOREST_HI - FOREST_LO) * 0.5 + 0.25, 0, 1); }
export function forestEdge(maskVal, x, z) {
  const e = maskVal + (vnoise(x / 55, z / 55, 11) - 0.5) * 0.22 + (vnoise(x / 17, z / 17, 12) - 0.5) * 0.09;
  return smoothstep(0.47, 0.53, e);
}

// Strip-field patchwork typical of Franconia.
// Returns [fieldId(0..1), cropType(0..4), edgeDistance(m), blockEdge(m)]
const _fi = [0, 0, 0, 0, 0];
export function fieldInfo(x, z) {
  const S = 460;
  const gx = Math.floor(x / S), gz = Math.floor(z / S);
  let d1 = 1e9, d2 = 1e9, bx = 0, bz = 0, cx = 0, cz = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const px = (gx + i + 0.15 + 0.7 * hash2i(gx + i, gz + j, 1)) * S;
    const pz = (gz + j + 0.15 + 0.7 * hash2i(gx + i, gz + j, 2)) * S;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < d1) { d2 = d1; d1 = d; bx = gx + i; bz = gz + j; cx = px; cz = pz; } else if (d < d2) d2 = d;
  }
  const blockEdge = (Math.sqrt(d2) - Math.sqrt(d1)) * 0.5;
  const ang = hash2i(bx, bz, 3) * Math.PI;
  const u = (x - cx) * Math.cos(ang) + (z - cz) * Math.sin(ang);
  const sw = 22 + 38 * hash2i(bx, bz, 4);
  const si = Math.floor(u / sw);
  const fr = u / sw - si;
  const fid = hash2i(bx * 131 + si, bz, 5);
  // three-field system: most strips of a block (Gewann) carry the block's crop
  const own = hash2i(bx, bz * 17 + si, 7) < 0.28;
  const r = own ? hash2i(bx, bz * 17 + si, 6) : hash2i(bx, bz, 6);
  // Mid-October: most grain harvested, many fields ploughed.
  const crop = r < 0.24 ? 0 : r < 0.5 ? 1 : r < 0.64 ? 2 : r < 0.93 ? 3 : 4;
  _fi[0] = fid; _fi[1] = crop; _fi[2] = Math.min(fr, 1 - fr) * sw; _fi[3] = blockEdge; _fi[4] = hash2i(bx, bz, 9);
  return _fi;
}

// ---------- Polyline helpers ----------
export function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

// Catmull-Rom smoothing so roads/rails curve naturally
export function smoothLine(pts, step = 10) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ ...pts[pts.length - 1] });
  return out;
}

// ---------- World heightfield ----------
export class Heightfield {
  constructor() {
    this.n = GRID_N;
    this.h = new Float32Array(GRID_N * GRID_N);
    this.lines = [];   // processed lines with per-sample heights
  }

  async generate(progress) {
    const N = this.n, h = this.h;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < N; i++) h[j * N + i] = baseHeight(-HALF + i * CELL, z);
      if ((j & 127) === 0) { progress?.(j / N * 0.7); await nextFrame(); }
    }
    this._pads();
    progress?.(0.8); await nextFrame();
    this._lines();
    progress?.(1);
  }

  _pads() {
    const N = this.n, h = this.h;
    for (const [px, pz, r, s] of PADS) {
      if (s <= 0) continue;
      const target = this._avg(px, pz, r * 0.5);
      const i0 = Math.max(0, Math.floor((px - r + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((px + r + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((pz - r + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((pz + r + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        if (riverDist(x, z) < RIVER_W * 0.5 + 25) continue;
        const d = Math.hypot(x - px, z - pz);
        const w = smoothstep(r, r * 0.55, d) * s;
        if (w > 0) h[j * N + i] = lerp(h[j * N + i], Math.max(target, WATER_Y + 7), w);
      }
    }
  }

  _avg(x, z, r) {
    let s = 0, n = 0;
    for (let a = 0; a < 16; a++) {
      const rr = r * (a % 2 ? 1 : 0.5);
      s += this.heightRaw(x + Math.cos(a) * rr, z + Math.sin(a) * rr); n++;
    }
    return s / n;
  }

  _lines() {
    const N = this.n, h = this.h;
    const wBuf = new Float32Array(N * N), tBuf = new Float32Array(N * N);
    const specs = [
      ...[RAIL_MAIN, RAIL_BRANCH, RAIL_SIDING].map((p, k) => ({ pts: p, w: k === 0 ? 9 : 6, kind: 'rail', smooth: 28, main: k === 0 })),
      ...ROADS.map(r => ({ pts: r.pts, w: r.w, kind: r.kind, smooth: 8 })),
    ];
    for (const spec of specs) {
      const pts = smoothLine(spec.pts, 8);
      const raw = pts.map(p => this.heightRaw(p.x, p.z));
      // smooth along line
      const sm = raw.map((_, i) => {
        let s = 0, n = 0;
        for (let k = -spec.smooth; k <= spec.smooth; k++) { const v = raw[clamp(i + k, 0, raw.length - 1)]; s += v; n++; }
        return s / n;
      });
      const bridge = pts.map((p, i) => riverDist(p.x, p.z) < RIVER_W * 0.5 + 45);
      for (let i = 0; i < pts.length; i++) {
        let y = Math.max(sm[i], WATER_Y + 12);
        if (spec.kind === 'rail' || spec.kind === 'asphalt') {
          // approach ramps to bridge deck
          let near = 1e9;
          for (let k = -25; k <= 25; k++) if (bridge[clamp(i + k, 0, pts.length - 1)]) near = Math.min(near, Math.abs(k));
          if (near < 1e9) y = lerp(WATER_Y + 15, y, smoothstep(6, 25, near));
        }
        pts[i].y = y;
        pts[i].bridge = bridge[i];
      }
      this.lines.push({ ...spec, pts });
      const reach = spec.w * 0.5 + 22;
      for (let s = 0; s < pts.length; s++) {
        const p = pts[s];
        if (p.bridge) continue;
        const i0 = Math.max(0, Math.floor((p.x - reach + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((p.x + reach + HALF) / CELL));
        const j0 = Math.max(0, Math.floor((p.z - reach + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((p.z + reach + HALF) / CELL));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = -HALF + i * CELL, z = -HALF + j * CELL;
          const d = Math.hypot(x - p.x, z - p.z);
          const w = smoothstep(reach, spec.w * 0.5 + 3, d);
          const k = j * N + i;
          if (w > wBuf[k]) { wBuf[k] = w; tBuf[k] = p.y - 0.25; }
        }
      }
    }
    for (let k = 0; k < N * N; k++) if (wBuf[k] > 0) h[k] = lerp(h[k], tBuf[k], wBuf[k]);
  }

  heightRaw(x, z) {
    const N = this.n;
    const fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * N + i, h = this.h;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + N] * (1 - u) + h[k + N + 1] * u) * v;
  }

  // full height incl. fine detail (must match terrain mesh)
  height(x, z) {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return farHeight(x, z);
    return this.heightRaw(x, z);
  }

  normal(x, z, out) {
    const e = 4;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    out.set(-hx, 2 * e, -hz).normalize();
    return out;
  }
}

// Outside the detailed map: continuation hills (low res ring)
export function farHeight(x, z) {
  return baseHeight(x, z);
}

export function nextFrame() {
  return new Promise(r => requestAnimationFrame(() => r()));
}

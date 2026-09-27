// Heightfield generation for Rustwater Crossing, plus the derived data other
// systems need: road splines and height profiles, distance fields, splat
// (material blend) maps, vegetation masks and chunked LOD meshes.
import * as THREE from 'three';
import { Simplex, RNG, clamp, lerp, smoothstep } from '../core/rng.js';
import { TERRAIN_SIZE, ROADS, POND, LOTS, FORESTS, FIELDS, START } from './layout.js';

const RES = 1; // samples per metre
export const LAYERS = ['grass', 'soil', 'forest', 'gravel', 'mud', 'rock'];

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// Catmull-Rom resample of a polyline every `step` metres.
function splineSamples(points, step = 2) {
  const P = points.map((p) => new THREE.Vector2(p[0], p[1]));
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const len = p1.distanceTo(p2);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, z });
    }
  }
  const last = P[P.length - 1];
  out.push({ x: last.x, z: last.y });
  let acc = 0;
  for (let i = 0; i < out.length; i++) {
    if (i > 0) acc += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    out[i].s = acc;
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
    out[i].tx = tx / tl; out[i].tz = tz / tl;
  }
  return out;
}

export class Terrain {
  constructor(seed = 1337) {
    this.seed = seed;
    this.size = TERRAIN_SIZE;
    this.n = TERRAIN_SIZE * RES + 1;
    this.half = TERRAIN_SIZE / 2;
    this.h = new Float32Array(this.n * this.n);
    this.roadDist = new Float32Array(this.n * this.n).fill(1e4); // distance to nearest road edge (m); <0 inside
    this.roadKind = new Uint8Array(this.n * this.n); // 1 asphalt 2 gravel 3 dirt for nearest road
    this.lotMask = new Float32Array(this.n * this.n); // 1 on building lots, fades out
    this.pondDist = new Float32Array(this.n * this.n).fill(1e4); // signed distance to pond shore (<0 in water)
    this.forest = new Float32Array(this.n * this.n); // 0..1 tree density
    this.field = new Float32Array(this.n * this.n); // 0..1 farmland
    this.noise = new Simplex(seed);
    this.noise2 = new Simplex(seed + 17);
    this.roads = ROADS.map((r) => ({ ...r, samples: splineSamples(r.points, 2) }));
    this.waterLevel = 0;
  }

  idx(ix, iz) { return iz * this.n + ix; }
  toGrid(x) { return (x + this.half) * RES; }

  /** Bilinear height at world (x, z). */
  height(x, z) {
    const gx = clamp(this.toGrid(x), 0, this.n - 1.001), gz = clamp(this.toGrid(z), 0, this.n - 1.001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const n = this.n, h = this.h;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = 1;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  slope(x, z) { return 1 - this.normal(x, z, _v).y; }

  sample(arr, x, z) {
    const ix = clamp(Math.round(this.toGrid(x)), 0, this.n - 1), iz = clamp(Math.round(this.toGrid(z)), 0, this.n - 1);
    return arr[iz * this.n + ix];
  }

  // ------------------------------------------------------------------ generation
  async generate(progress = () => {}) {
    const { n, half, h } = this;
    const N = this.noise, N2 = this.noise2;
    progress('Shaping terrain');
    // 1. natural landform
    for (let iz = 0; iz < n; iz++) {
      const z = iz / RES - half;
      for (let ix = 0; ix < n; ix++) {
        const x = ix / RES - half;
        let v = 9.5 * N.fbm(x / 430, z / 430, 4) + 3.2 * N.fbm(x / 130 + 7.1, z / 130 - 3.3, 3) + 0.45 * N2.fbm(x / 26, z / 26, 2);
        v += 0.012 * x - 0.006 * z; // regional tilt towards the east
        const r = Math.hypot(x, z);
        v += smoothstep(260, 520, r) * (14 + 10 * N2.ridged(x / 260, z / 260, 3)); // enclosing hills
        h[iz * n + ix] = v;
      }
      if ((iz & 127) === 0) await yieldFrame();
    }
    this.natural = h.slice();

    // 2. roads: smooth longitudinal profile, flatten corridor, shoulders, ditches
    progress('Cutting roads');
    for (const road of this.roads) {
      const S = road.samples;
      const raw = S.map((p) => this.height(p.x, p.z));
      const win = road.kind === 'asphalt' ? 28 : 12;
      for (let i = 0; i < S.length; i++) {
        let sum = 0, wsum = 0;
        for (let k = -win; k <= win; k++) {
          const j = clamp(i + k, 0, S.length - 1);
          const w = Math.exp(-(k * k) / (2 * (win / 2.5) ** 2));
          sum += raw[j] * w; wsum += w;
        }
        S[i].h = sum / wsum - (road.kind === 'asphalt' ? 0.05 : 0.12);
      }
    }
    this.#rasterRoads();
    await yieldFrame();

    // 3. pond basin (water level follows the natural ground around it)
    progress('Filling the pond');
    let rim = 1e9;
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      rim = Math.min(rim, this.height(POND.x + Math.cos(t) * (POND.radius + 8), POND.z + Math.sin(t) * (POND.radius + 8)));
    }
    this.waterLevel = rim - 0.7;
    const pr = POND.radius;
    const pondR = (ang) => pr * (1 + 0.22 * N2.noise(Math.cos(ang) * 1.3 + 4, Math.sin(ang) * 1.3 - 2) + 0.08 * N.noise(Math.cos(ang) * 4, Math.sin(ang) * 4));
    this.pondRadiusAt = pondR;
    const g0x = Math.floor(this.toGrid(POND.x - pr * 2.2)), g1x = Math.ceil(this.toGrid(POND.x + pr * 2.2));
    const g0z = Math.floor(this.toGrid(POND.z - pr * 2.2)), g1z = Math.ceil(this.toGrid(POND.z + pr * 2.2));
    for (let iz = g0z; iz <= g1z; iz++) for (let ix = g0x; ix <= g1x; ix++) {
      const x = ix / RES - half, z = iz / RES - half;
      const dx = x - POND.x, dz = z - POND.z;
      const d = Math.hypot(dx, dz), R = pondR(Math.atan2(dz, dx));
      const sd = d - R; // signed distance to shore
      const i = iz * n + ix;
      this.pondDist[i] = sd;
      if (sd < 18) {
        const bed = this.waterLevel - POND.depth * smoothstep(0, R * 0.85, -sd) - 0.18;
        const bank = this.waterLevel + 0.12 + Math.max(0, sd) * 0.09;
        const target = sd < 0 ? bed : Math.min(h[i], bank);
        const t = smoothstep(18, 0, sd);
        h[i] = lerp(h[i], Math.min(h[i], target), t);
      }
    }

    // 4. building lots and the start camp: plateaus with soft embankments
    progress('Levelling lots');
    const plateau = (cx, cz, rot, w, d, blend, weight = 1) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      let hsum = 0, hc = 0;
      for (let u = -w / 2; u <= w / 2; u += 2) for (let v = -d / 2; v <= d / 2; v += 2) {
        hsum += this.height(cx + u * c + v * s, cz - u * s + v * c); hc++;
      }
      const target = hsum / hc;
      const ext = Math.max(w, d) / 2 + blend + 2;
      const g0x = Math.floor(this.toGrid(cx - ext)), g1x = Math.ceil(this.toGrid(cx + ext));
      const g0z = Math.floor(this.toGrid(cz - ext)), g1z = Math.ceil(this.toGrid(cz + ext));
      for (let iz = Math.max(0, g0z); iz <= Math.min(n - 1, g1z); iz++) for (let ix = Math.max(0, g0x); ix <= Math.min(n - 1, g1x); ix++) {
        const x = ix / RES - half - cx, z = iz / RES - half - cz;
        const lu = x * c - z * s, lv = x * s + z * c;
        const du = Math.max(0, Math.abs(lu) - w / 2), dv = Math.max(0, Math.abs(lv) - d / 2);
        const dist = Math.hypot(du, dv);
        const t = 1 - smoothstep(0, blend, dist);
        if (t <= 0) continue;
        const i = iz * n + ix;
        h[i] = lerp(h[i], target, t * weight);
        this.lotMask[i] = Math.max(this.lotMask[i], t * weight);
      }
      return target;
    };
    for (const lot of LOTS) lot.y = plateau(lot.x, lot.z, lot.rot, lot.w + 3, lot.d + 3, 16);
    START.y = plateau(START.x, START.z, 0, START.radius * 2, START.radius * 2, 22, 0.75);
    // re-assert only the road deck + shoulders over lot embankments (short blend)
    this.#rasterRoads(true);
    await yieldFrame();

    // 5. masks: forest density, fields
    progress('Mapping forests');
    for (let iz = 0; iz < n; iz++) {
      const z = iz / RES - half;
      for (let ix = 0; ix < n; ix++) {
        const x = ix / RES - half;
        const i = iz * n + ix;
        let f = 0;
        for (const F of FORESTS) {
          const d = Math.hypot(x - F.x, z - F.z) / F.r;
          if (d < 1.25) f = Math.max(f, F.density * (1 - smoothstep(0.55, 1.2, d + 0.25 * N.noise(x / 40, z / 40))));
        }
        // forest thins near roads, lots, water and in open meadows
        f *= smoothstep(4, 18, this.roadDist[i]);
        f *= 1 - this.lotMask[i];
        f *= smoothstep(-1, 6, this.pondDist[i]);
        f *= clamp(0.55 + 0.6 * N2.fbm(x / 70 + 11, z / 70, 2), 0, 1);
        const sd = Math.hypot(x - START.x, z - START.z);
        f *= smoothstep(START.radius + 6, START.radius + 30, sd);
        this.forest[i] = f;
        let fl = 0;
        for (const F of FIELDS) {
          const c = Math.cos(F.rot), s = Math.sin(F.rot);
          const lx = (x - F.x) * c - (z - F.z) * s, lz = (x - F.x) * s + (z - F.z) * c;
          const du = Math.abs(lx) - F.w / 2, dv = Math.abs(lz) - F.d / 2;
          fl = Math.max(fl, 1 - smoothstep(-4, 3, Math.max(du, dv)));
        }
        this.field[i] = fl * smoothstep(2, 8, this.roadDist[i]);
      }
      if ((iz & 255) === 0) await yieldFrame();
    }
    for (let i = 0; i < this.forest.length; i++) this.forest[i] *= 1 - this.field[i] * 0.9;
  }

  #rasterRoads(heightOnly = false) {
    const { n, half, h } = this;
    for (const road of this.roads) {
      const S = road.samples;
      const hw = road.width / 2, sh = road.shoulder;
      const infl = hw + sh + (heightOnly ? 4 : road.kind === 'asphalt' ? 16 : 9);
      const kindId = road.kind === 'asphalt' ? 1 : road.kind === 'gravel' ? 2 : 3;
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i], b = S[i + 1];
        const x0 = Math.min(a.x, b.x) - infl, x1 = Math.max(a.x, b.x) + infl;
        const z0 = Math.min(a.z, b.z) - infl, z1 = Math.max(a.z, b.z) + infl;
        const g0x = Math.max(0, Math.floor(this.toGrid(x0))), g1x = Math.min(n - 1, Math.ceil(this.toGrid(x1)));
        const g0z = Math.max(0, Math.floor(this.toGrid(z0))), g1z = Math.min(n - 1, Math.ceil(this.toGrid(z1)));
        const ex = b.x - a.x, ez = b.z - a.z, el = ex * ex + ez * ez;
        for (let iz = g0z; iz <= g1z; iz++) for (let ix = g0x; ix <= g1x; ix++) {
          const x = ix / RES - half, z = iz / RES - half;
          let t = ((x - a.x) * ex + (z - a.z) * ez) / el;
          t = clamp(t, 0, 1);
          const px = a.x + ex * t, pz = a.z + ez * t;
          const d = Math.hypot(x - px, z - pz);
          const idx = iz * n + ix;
          const edge = d - hw;
          if (!heightOnly && edge < this.roadDist[idx]) { this.roadDist[idx] = edge; this.roadKind[idx] = kindId; }
          if (d > infl) continue;
          const rh = lerp(a.h, b.h, t);
          // cross-section: flat deck (slight camber), shoulder, ditch, embankment
          let target = rh - (road.kind === 'asphalt' ? Math.max(0, d) * 0.012 : 0);
          let w;
          if (d <= hw + sh) w = 1;
          else {
            w = 1 - smoothstep(hw + sh, infl, d);
            if (road.kind === 'asphalt' && !heightOnly) target -= 0.4 * Math.exp(-((d - hw - sh - 1.8) ** 2) / 1.4);
          }
          h[idx] = lerp(h[idx], target, w);
        }
      }
    }
  }

  // ------------------------------------------------------------------ splat maps
  /** Two RGBA8 maps: A = grass, soil, forest, gravel; B = mud, rock, puddle, dryness. */
  buildSplat() {
    const { n, half } = this;
    const S = this.n - 1; // texture size (1024)
    const a = new Uint8Array(S * S * 4), b = new Uint8Array(S * S * 4);
    const N = this.noise, N2 = this.noise2;
    this.grassMask = new Uint8Array(S * S);
    for (let iz = 0; iz < S; iz++) {
      const z = iz / RES - half + 0.5;
      for (let ix = 0; ix < S; ix++) {
        const x = ix / RES - half + 0.5;
        const i = iz * n + ix;
        const hx = this.h[i + 1] - this.h[i], hz = this.h[i + n] - this.h[i];
        const slope = Math.sqrt(hx * hx + hz * hz); // rise per metre
        const rd = this.roadDist[i], rk = this.roadKind[i];
        const nz1 = N.noise(x / 9, z / 9), nz2 = N2.noise(x / 31, z / 31), nz3 = N.fbm(x / 90, z / 90, 2);
        let grass = 1, soil = 0, forest = 0, gravel = 0, mud = 0, rock = 0, puddle = 0;

        // forest floor under canopy
        const f = this.forest[i];
        forest = smoothstep(0.25, 0.7, f + nz2 * 0.15);
        grass *= 1 - forest * 0.85;
        // bare soil patches, trampled lots, farmland
        soil = smoothstep(0.7, 1.0, nz3 * 0.5 + 0.5 + nz1 * 0.1) * 0.14 + this.lotMask[i] * 0.4 * smoothstep(-0.2, 0.6, nz1 + nz2 * 0.5) + this.field[i] * 0.55;
        const sd = Math.hypot(x - START.x, z - START.z);
        soil += (1 - smoothstep(START.radius * 0.35, START.radius * 1.1, sd)) * 0.5;
        // roads: gravel shoulders on the highway, gravel/dirt tracks
        if (rk === 1) {
          const sh = 1.6;
          gravel = Math.max(gravel, (1 - smoothstep(sh - 0.9, sh + 0.2 + nz1 * 0.6, rd)) * 0.85);
          soil = Math.max(soil, (1 - smoothstep(sh - 0.5, sh + 2.2, rd)) * 0.45 * smoothstep(-0.4, 0.4, nz1));
        } else if (rk === 2) {
          gravel = Math.max(gravel, 1 - smoothstep(-0.8, 1.2 + nz1 * 0.8, rd));
          soil = Math.max(soil, (1 - smoothstep(0, 2.5, rd)) * 0.5);
        } else if (rk === 3) {
          soil = Math.max(soil, 1 - smoothstep(-0.8, 1.5 + nz1 * 0.8, rd));
          mud = Math.max(mud, (1 - smoothstep(-1.2, 0.6, rd)) * smoothstep(0.1, 0.6, nz2 + 0.2));
        }
        // water edge mud and wet ground
        const pd = this.pondDist[i];
        mud = Math.max(mud, 1 - smoothstep(0.5, 4.5 + nz1 * 1.5, pd));
        // low damp hollows
        const damp = smoothstep(0.4, 0.9, N2.fbm(x / 55 - 3, z / 55 + 8, 2) * 0.5 + 0.5) * (1 - forest) * 0.6;
        mud = Math.max(mud, damp * smoothstep(0.2, 0.7, nz1 + 0.3) * 0.7);
        // rock on steep ground
        rock = smoothstep(0.55, 0.9, slope + nz1 * 0.08) * smoothstep(2, 10, this.pondDist[i]) * (1 - this.lotMask[i]);
        // puddles: in dirt tracks, low mud
        puddle = clamp(mud * 0.8 + (rk >= 2 ? (1 - smoothstep(-1, 0.5, rd)) * 0.7 : 0), 0, 1) * smoothstep(-0.2, 0.5, N.noise(x / 6, z / 6));

        // normalise with priorities
        grass = Math.max(0, grass - soil - gravel - mud * 0.8 - rock);
        let sum = grass + soil + forest + gravel + mud + rock + 1e-5;
        const o = (iz * S + ix) * 4;
        a[o] = (grass / sum) * 255; a[o + 1] = (soil / sum) * 255; a[o + 2] = (forest / sum) * 255; a[o + 3] = (gravel / sum) * 255;
        b[o] = (mud / sum) * 255; b[o + 1] = (rock / sum) * 255; b[o + 2] = puddle * 255;
        const dry = clamp(0.5 + 0.5 * N2.fbm(x / 140 + 2, z / 140 - 5, 3) + this.field[i] * 0.35 - forest * 0.3, 0, 1);
        b[o + 3] = dry * 255;
        this.grassMask[iz * S + ix] = clamp((grass / sum) * (1 - this.lotMask[i] * 0.5) * 255, 0, 255);
      }
    }
    const mk = (data) => {
      const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      return t;
    };
    this.splatA = mk(a); this.splatB = mk(b);
    this.splatDataA = a; this.splatDataB = b;
    return { splatA: this.splatA, splatB: this.splatB };
  }

  /** Paint trampled soil around a new structure (runtime, e.g. colony builds). */
  paintSoil(x, z, radius, strength = 0.7) {
    const S = this.n - 1;
    const r = Math.ceil(radius + 2);
    const cx = Math.round(this.toGrid(x)), cz = Math.round(this.toGrid(z));
    for (let iz = cz - r; iz <= cz + r; iz++) for (let ix = cx - r; ix <= cx + r; ix++) {
      if (ix < 0 || iz < 0 || ix >= S || iz >= S) continue;
      const d = Math.hypot(ix - cx, iz - cz);
      const t = (1 - smoothstep(radius * 0.5, radius + 1.5, d)) * strength * (0.75 + 0.25 * this.noise.noise(ix / 3, iz / 3));
      if (t <= 0) continue;
      const o = (iz * S + ix) * 4;
      const A = this.splatDataA, B = this.splatDataB;
      const soil = Math.min(255, A[o + 1] + t * 255);
      const scale = (255 - soil) / Math.max(1, A[o] + A[o + 2] + A[o + 3] + B[o] + B[o + 1]);
      A[o] *= scale; A[o + 2] *= scale; A[o + 3] *= scale; B[o] *= scale; B[o + 1] *= scale; A[o + 1] = soil;
      this.grassMask[iz * S + ix] = Math.min(this.grassMask[iz * S + ix], A[o]);
    }
    this.splatA.needsUpdate = true; this.splatB.needsUpdate = true;
  }

  /**
   * Paint a rotated rectangle: layer weights toward soil/gravel, grass cleared.
   * Used for building footprints, yards, forecourts and colony structures.
   */
  paintRect(cx, cz, w, d, rot = 0, { soil = 0.8, gravel = 0, clearGrass = 1, feather = 1.5 } = {}) {
    const S = this.n - 1, c = Math.cos(rot), s = Math.sin(rot);
    const ext = Math.hypot(w, d) / 2 + feather + 1;
    const A = this.splatDataA, B = this.splatDataB;
    const x0 = Math.max(0, Math.floor(this.toGrid(cx - ext))), x1 = Math.min(S - 1, Math.ceil(this.toGrid(cx + ext)));
    const z0 = Math.max(0, Math.floor(this.toGrid(cz - ext))), z1 = Math.min(S - 1, Math.ceil(this.toGrid(cz + ext)));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = ix / RES - this.half + 0.5 - cx, z = iz / RES - this.half + 0.5 - cz;
      const lu = x * c - z * s, lv = x * s + z * c;
      const dist = Math.max(Math.abs(lu) - w / 2, Math.abs(lv) - d / 2);
      const n = this.noise.noise(ix / 4, iz / 4) * 0.8;
      const t = 1 - smoothstep(-feather * 0.3, feather, dist + n);
      if (t <= 0) continue;
      const o = (iz * S + ix) * 4;
      const tot = soil + gravel;
      const keep = 1 - t * Math.min(1, tot);
      for (let k = 0; k < 4; k++) A[o + k] *= keep;
      B[o] *= keep; B[o + 1] *= keep;
      A[o + 1] += 255 * t * soil; A[o + 3] += 255 * t * gravel;
      const gi = iz * S + ix;
      this.grassMask[gi] = this.grassMask[gi] * (1 - t * clearGrass);
    }
    this.splatA.needsUpdate = true; this.splatB.needsUpdate = true;
    this.maskDirty = true;
  }

  // ------------------------------------------------------------------ meshes
  /** Chunked terrain with 4 LODs and skirts. */
  buildMeshes(material, chunk = 64) {
    const group = new THREE.Group();
    group.name = 'terrain';
    const count = this.size / chunk;
    this.chunks = [];
    const steps = [1, 2, 4, 8];
    for (let cz = 0; cz < count; cz++) for (let cx = 0; cx < count; cx++) {
      const x0 = cx * chunk - this.half, z0 = cz * chunk - this.half;
      const lods = steps.map((st) => this.#chunkGeometry(x0, z0, chunk, st));
      const mesh = new THREE.Mesh(lods[1], material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.userData.lods = lods;
      mesh.userData.center = new THREE.Vector3(x0 + chunk / 2, 0, z0 + chunk / 2);
      mesh.userData.lod = 1;
      group.add(mesh);
      this.chunks.push(mesh);
    }
    return group;
  }

  #chunkGeometry(x0, z0, size, step) {
    const q = size / step, vn = q + 1;
    const skirt = 4 * vn;
    const total = vn * vn + skirt;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const idx = [];
    const nv = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const y = this.height(x, z);
      const k = j * vn + i;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      this.normal(x, z, nv);
      nor[k * 3] = nv.x; nor[k * 3 + 1] = nv.y; nor[k * 3 + 2] = nv.z;
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (let j = 0; j < q; j++) for (let i = 0; i < q; i++) {
      const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
      // alternate diagonal to avoid directional artefacts
      if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
    }
    // skirts: duplicate edge vertices 3 m down
    let s = vn * vn;
    const edges = [
      [...Array(vn).keys()].map((i) => i),                       // north (z0)
      [...Array(vn).keys()].map((i) => (vn - 1) * vn + i),       // south
      [...Array(vn).keys()].map((j) => j * vn),                  // west
      [...Array(vn).keys()].map((j) => j * vn + vn - 1),         // east
    ];
    const flips = [true, false, false, true]; // outward-facing skirt winding per edge
    edges.forEach((edge, e) => {
      const start = s;
      for (const k of edge) {
        pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - 3; pos[s * 3 + 2] = pos[k * 3 + 2];
        nor[s * 3] = nor[k * 3]; nor[s * 3 + 1] = nor[k * 3 + 1]; nor[s * 3 + 2] = nor[k * 3 + 2];
        s++;
      }
      for (let i = 0; i < vn - 1; i++) {
        const a = edge[i], b = edge[i + 1], c = start + i, d = start + i + 1;
        if (flips[e]) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, minY - 3, z0), new THREE.Vector3(x0 + size, maxY, z0 + size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  /** Pick chunk LODs from camera distance. detail: 1 (full) .. 0.5 (mobile) */
  updateLod(camPos, detail = 1) {
    if (!this.chunks) return;
    const d0 = 90 * detail, d1 = 200 * detail, d2 = 380 * detail;
    for (const m of this.chunks) {
      const c = m.userData.center;
      const d = Math.hypot(camPos.x - c.x, camPos.z - c.z) + Math.max(0, camPos.y - 40) * 0.6;
      let lod = d < d0 ? 0 : d < d1 ? 1 : d < d2 ? 2 : 3;
      if (detail < 0.75) lod = Math.max(lod, 1);
      if (lod !== m.userData.lod) { m.geometry = m.userData.lods[lod]; m.userData.lod = lod; }
    }
  }

  /** Far landscape ring (beyond the heightfield) so the horizon has hills, fogged. */
  buildHorizon(material) {
    const rings = 28, segs = 160;
    const r0 = this.half - 8, r1 = 3200;
    const pos = [], idx = [], col = [];
    const N = this.noise2;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const r = r0 + (r1 - r0) * Math.pow(t, 1.8);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        let y;
        if (j === 0) y = this.height(clamp(x, -this.half, this.half), clamp(z, -this.half, this.half)) - 0.5;
        else {
          const edge = this.height(clamp(Math.cos(a) * r0, -this.half, this.half), clamp(Math.sin(a) * r0, -this.half, this.half));
          const hills = 26 + 38 * (N.fbm(x / 900, z / 900, 4) * 0.5 + 0.5) + 30 * N.ridged(x / 1400, z / 1400, 3);
          y = lerp(edge, hills, smoothstep(0, 0.35, t)) - t * t * 60;
        }
        pos.push(x, y, z);
        const shade = 0.75 + 0.25 * N.noise(x / 300, z / 300);
        col.push(shade, shade, shade);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.name = 'horizon';
    m.receiveShadow = false;
    m.frustumCulled = false;
    return m;
  }
}

const _v = new THREE.Vector3();

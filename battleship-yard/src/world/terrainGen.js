// Terrain generation (pure JS, runs in a worker). Produces:
//   heights  Float32Array  (nx * nz)  metres, WORLD.cell spacing
//   splatA   Uint8Array RGBA  grass, dry grass, gravel, mud
//   splatB   Uint8Array RGBA  rock, sand, wet(shore moisture), baked AO
import { makeNoise2D, fbm, smoothstep, clamp, lerp, distToPolyline } from '../engine/noise.js';
import { WORLD, QUAY, ROAD, BUILDINGS } from './layout.js';

export function makeTerrainFn(seed = 1337) {
  const n1 = makeNoise2D(seed), n2 = makeNoise2D(seed + 1), n3 = makeNoise2D(seed + 2);

  // Coastline: z value of the waterline for a given x (land is at z < coastZ)
  function coastZ(x) {
    const ax = Math.abs(x);
    const quay = 1 - smoothstep(205, 260, ax);
    // headlands: east reaches further out than west
    const head = x > 0 ? 470 * smoothstep(230, 820, ax) * (1 - 0.55 * smoothstep(1050, 1500, ax))
      : 330 * smoothstep(240, 700, ax) * (1 - 0.6 * smoothstep(900, 1400, ax));
    const wobble = fbm(n1, x / 260, 3.7, 4) * 60 + fbm(n2, x / 70, 9.1, 3) * 12;
    return (1 - quay) * (head + wobble) + quay * QUAY.edgeZ;
  }

  function hills(x, z, dl) {
    const big = fbm(n1, x / 700 + 11, z / 700 - 3, 5) * 0.5 + 0.5;
    const mid = fbm(n2, x / 180, z / 180, 5);
    const ridge = 1 - Math.abs(fbm(n3, x / 420, z / 420, 4));
    const rise = smoothstep(30, 520, dl);
    return rise * (18 + 78 * big + 26 * ridge * ridge) + mid * 7 * smoothstep(10, 120, dl);
  }

  // road heights follow a smoothed hillside (no small-scale noise) so it stays drivable
  function roadInfo(x, z) {
    return distToPolyline(x, z, ROAD);
  }

  function rawHeight(x, z, dl) { // dl: + inland distance to coast, - seaward
    let h;
    if (dl >= 0) {
      const ax = Math.abs(x);
      const cliff = smoothstep(260, 520, ax);
      const shore = lerp(dl * 0.07, Math.min(dl * 0.55, 16 + fbm(n2, x / 40, z / 40, 3) * 6), cliff);
      h = 0.35 + shore + hills(x, z, dl);
    } else {
      const ds = -dl;
      const beach = Math.max(-1.6 - ds * 0.09, -9 - ds * 0.035);
      h = Math.max(beach, -46) + fbm(n3, x / 90, z / 90, 3) * 1.5 * smoothstep(20, 200, ds);
    }
    // dredged fitting-out berth in front of the quay
    const berth = (1 - smoothstep(195, 240, Math.abs(x))) * (1 - smoothstep(110, 230, z)) * smoothstep(-1, 2, z - QUAY.edgeZ);
    h = lerp(h, Math.min(h, QUAY.floorY), berth);
    return h;
  }

  function heightFromDist(x, z, dl) {
    let h = rawHeight(x, z, dl);
    // paved yard platform
    const ax = Math.abs(x);
    const yardX = 1 - smoothstep(QUAY.x1 + 12, QUAY.x1 + 55, ax);
    const yardZ = smoothstep(QUAY.yardZ - 45, QUAY.yardZ - 4, z) * (z <= QUAY.edgeZ + 0.01 ? 1 : 0);
    const yard = yardX * yardZ;
    h = lerp(h, QUAY.topY, yard);
    return h;
  }

  // Coarse continuation beyond the heightfield (distance approximated along z).
  function farHeight(x, z) {
    return rawHeight(x, z, coastZ(x) - z);
  }

  return { heightFromDist, farHeight, coastZ, roadInfo, noise: n2, noise3: n3 };
}

// Two-pass chamfer distance transform (metres) to the nearest cell where mask differs.
function distanceField(mask, nx, nz, cell) {
  const INF = 1e9, d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, m = mask[k];
    const edge = (i > 0 && mask[k - 1] !== m) || (i < nx - 1 && mask[k + 1] !== m) || (j > 0 && mask[k - nx] !== m) || (j < nz - 1 && mask[k + nx] !== m);
    d[k] = edge ? cell * 0.5 : INF;
  }
  const a = cell, b = cell * Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) { v = Math.min(v, d[k - nx] + a); if (i > 0) v = Math.min(v, d[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b); }
    d[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
    if (j < nz - 1) { v = Math.min(v, d[k + nx] + a); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b); if (i > 0) v = Math.min(v, d[k + nx - 1] + b); }
    d[k] = v;
  }
  return d;
}

// Road: a smoothed longitudinal profile sampled from the real terrain, then cut/fill a level
// carriageway with graded shoulders (so it neither trenches into nor floats over the hillside).
function carveRoad(heights, nx, nz, T) {
  const { x0, z0, cell } = WORLD;
  const Hs = (x, z) => heights[clamp(Math.round((z - z0) / cell), 0, nz - 1) * nx + clamp(Math.round((x - x0) / cell), 0, nx - 1)];
  const pts = [];
  let total = 0;
  for (let k = 0; k < ROAD.length - 1; k++) {
    const [ax, az] = ROAD[k], [bx, bz] = ROAD[k + 1], L = Math.hypot(bx - ax, bz - az);
    for (let t = 0; t < L; t += 4) {
      const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L;
      let sum = 0, n = 0;
      for (let dx = -10; dx <= 10; dx += 5) for (let dz = -10; dz <= 10; dz += 5) { sum += Hs(x + dx, z + dz); n++; }
      pts.push({ t: total + t, h: sum / n });
    }
    total += L;
  }
  const prof = pts.map((p, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - 8); k <= Math.min(pts.length - 1, i + 8); k++) { s += pts[k].h; n++; }
    return lerp(QUAY.topY, s / n, smoothstep(0, 70, p.t));
  });
  const profAt = (t) => { const f = Math.min(prof.length - 1.001, Math.max(0, t / 4)); const i = Math.floor(f); return lerp(prof[i], prof[i + 1], f - i); };
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    if (z > -60 || z < -640) continue;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      if (x < -370 || x > 10) continue;
      const r = T.roadInfo(x, z);
      if (r.d > 16) continue;
      const idx = j * nx + i;
      heights[idx] = lerp(heights[idx], profAt(r.t), 1 - smoothstep(4.0, 15, r.d));
    }
  }
}

export function generateTerrain(seed = 1337, onProgress = () => {}) {
  const T = makeTerrainFn(seed);
  const { x0, z0, x1, z1, cell } = WORLD;
  const nx = Math.round((x1 - x0) / cell) + 1, nz = Math.round((z1 - z0) / cell) + 1;
  const coast = new Float32Array(nx);
  for (let i = 0; i < nx; i++) coast[i] = T.coastZ(x0 + i * cell);
  const land = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) land[j * nx + i] = z0 + j * cell < coast[i] ? 1 : 0;
  const dist = distanceField(land, nx, nz, cell);
  onProgress(0.1);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      heights[k] = T.heightFromDist(x0 + i * cell, z, land[k] ? dist[k] : -dist[k]);
    }
    if (j % 64 === 0) onProgress(0.1 + 0.4 * j / nz);
  }
  carveRoad(heights, nx, nz, T);
  const H = (i, j) => heights[clamp(j, 0, nz - 1) * nx + clamp(i, 0, nx - 1)];

  // Baked horizon AO (sky visibility) — the static indirect light term for the terrain.
  const ao = new Float32Array(nx * nz).fill(1);
  const dirs = 8, steps = [1, 2, 4, 8, 16, 32];
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const h0 = H(i, j);
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        const a = (d / dirs) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        let maxSlope = 0;
        for (const s of steps) {
          const hh = H(Math.round(i + dx * s), Math.round(j + dz * s));
          maxSlope = Math.max(maxSlope, (hh - h0) / (s * cell));
        }
        occ += Math.sin(Math.atan(maxSlope));
      }
      ao[j * nx + i] = 1 - occ / dirs;
    }
    if (j % 64 === 0) onProgress(0.6 + 0.25 * j / nz);
  }

  const splatA = new Uint8Array(nx * nz * 4), splatB = new Uint8Array(nx * nz * 4);
  const n = T.noise, n3 = T.noise3;
  const blds = Object.values(BUILDINGS);
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, k = j * nx + i, h = H(i, j);
      const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell), gz = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      const slope = 1 - ny;
      const nA = fbm(n, x / 35, z / 35, 3), nB = fbm(n3, x / 12, z / 12, 2), nC = fbm(n, x / 140 + 7, z / 140, 2);
      const dl = land[k] ? dist[k] : -dist[k];
      const inYard = Math.abs(x) < QUAY.x1 + 14 && z <= QUAY.edgeZ + 0.5 && z > QUAY.yardZ - 6;

      let rock = smoothstep(0.32, 0.5, slope + nA * 0.08) + smoothstep(0.55, 0.8, nC + nB * 0.15) * smoothstep(60, 140, h) * 0.6;
      let sand = (1 - smoothstep(1.2, 3.2, h + nB * 0.8)) * smoothstep(-25, -2, h);
      // seabed: sand with rock outcrops further out
      if (h < -2) { sand = 1; rock = Math.max(rock * 0.5, smoothstep(0.2, 0.6, nA) * 0.7); }
      let wet = 1 - smoothstep(0.2, 1.8, h + nB * 0.4);
      let mud = smoothstep(0.15, 0.6, nA * 0.5 + 0.35 - smoothstep(2, 30, dl) * 0.2) * (1 - smoothstep(6, 25, h)) * 0.8;
      let gravel = 0;
      const nD = fbm(n3, x / 420 + 3, z / 420, 2);
      // drier, thinner grass on high ground, sun-facing (south, +z) slopes and in large patches
      let dry = smoothstep(0.05, 0.65, nD * 0.9 + nC * 0.25 + (h - 70) / 160 + gz * 0.6) * 0.85;
      let grass = 1;

      const r = x > -360 && x < 0 && z < -60 && z > -630 ? T.roadInfo(x, z) : { d: 1e9, t: 0 };
      const road = 1 - smoothstep(3.0 + nB * 0.8, 5.0 + nB, r.d);
      const shoulder = (1 - smoothstep(4.5, 9 + nA * 3, r.d)) * (1 - road);
      gravel = Math.max(gravel, road);
      mud = Math.max(mud, shoulder * (0.55 + nB * 0.4));
      // worn margins of the paved yard and around buildings: gravel and tyre-churned mud
      if (!inYard) {
        const edge = Math.abs(x) < QUAY.x1 + 40 && z < QUAY.edgeZ && z > QUAY.yardZ - 34;
        if (edge) { gravel = Math.max(gravel, 0.75 + nB * 0.3); mud = Math.max(mud, smoothstep(0.1, 0.5, nA) * 0.8); }
      } else { gravel = 1; mud = 0.2 + nB * 0.2; grass = 0; dry = 0; rock = 0; sand = 0; }
      if (z > -120 && z < 0 && x > -120 && x < 200) for (const b of blds) {
        const dx = Math.abs(x - b.x) - b.w / 2, dz = Math.abs(z - b.z) - b.d / 2;
        if (Math.max(dx, dz) < 6) { gravel = Math.max(gravel, 0.8); grass *= 0.2; }
      }
      grass *= (1 - rock) * (1 - sand) * (1 - gravel * 0.9);
      dry *= grass;
      grass = Math.max(0, grass - dry);
      mud *= (1 - rock) * (1 - sand * 0.7);
      const sum = grass + dry + gravel + mud + rock + sand + 1e-4;
      splatA[k * 4] = (grass / sum) * 255; splatA[k * 4 + 1] = (dry / sum) * 255;
      splatA[k * 4 + 2] = (gravel / sum) * 255; splatA[k * 4 + 3] = (mud / sum) * 255;
      splatB[k * 4] = (rock / sum) * 255; splatB[k * 4 + 1] = (sand / sum) * 255;
      splatB[k * 4 + 2] = clamp(wet, 0, 1) * 255; splatB[k * 4 + 3] = clamp(ao[k], 0, 1) * 255;
    }
    if (j % 64 === 0) onProgress(0.85 + 0.15 * j / nz);
  }
  return { heights, splatA, splatB, nx, nz, dist: null };
}

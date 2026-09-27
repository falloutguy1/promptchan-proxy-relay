// Turns Poly Haven HDR skies into (a) sun/moon parameters measured from the HDR
// (direction, colour, illuminance in the HDR's own radiance units) and (b) a
// sun-removed, ground-completed sky stored as 8-bit sRGB JPEG + linear scale.
// The runtime re-inflates the JPEG to HDR (x scale), renders the analytic sun disc
// at the directional light's position and prefilters it with PMREM, so sky, sun,
// reflections and direct light always agree - even while blending times of day.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as cfg from './assets.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const outDir = join(here, '..', 'assets', 'sky');
mkdirSync(outDir, { recursive: true });
const meta = JSON.parse(readFileSync(join(cache, 'meta.json'), 'utf8'));

const GROUND_ALBEDO = [0.11, 0.115, 0.075]; // mixed grass / soil, linear

function loadHdr(file) {
  const loader = new HDRLoader();
  loader.setDataType(THREE.FloatType);
  const b = readFileSync(file);
  const r = loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { w: r.width, h: r.height, d: r.data }; // RGBA float, row 0 = top
}

const lumOf = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

function dirOf(x, y, w, h) {
  const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h;
  const phi = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
  return [Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)];
}

function processSky(name, file) {
  const { w, h, d } = loadHdr(file);
  const n = w * h;
  const dOmegaRow = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    const lat = (1 - (y + 0.5) / h - 0.5) * Math.PI;
    dOmegaRow[y] = (2 * Math.PI / w) * (Math.PI / h) * Math.cos(lat);
  }
  // upper hemisphere statistics
  const lums = [];
  let maxL = 0, maxI = 0;
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x += 4) { const i = (y * w + x) * 4; lums.push(lumOf(d, i)); }
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x++) { const i = (y * w + x); const L = lumOf(d, i * 4); if (L > maxL) { maxL = L; maxI = i; } }
  lums.sort((a, b) => a - b);
  const med = lums[lums.length >> 1];
  const p99 = lums[Math.floor(lums.length * 0.99)];
  const cDir = dirOf(maxI % w, Math.floor(maxI / w), w, h);

  // Sun / moon: clamp luminance inside a 12 deg cone around the peak to a ceiling
  // (keeps the chroma and the structure of the glow, removes the disc energy). The
  // removed energy is the illuminance handed to the directional light.
  const ceil = Math.max(8 * p99, 20 * med);
  const cone = Math.cos(12 * Math.PI / 180);
  let E = [0, 0, 0], wsum = 0, cx = 0, cy = 0, cz = 0;
  let maxAngle = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const L = lumOf(d, i);
      if (L <= ceil) continue;
      const dir = dirOf(x, y, w, h);
      const cd = dir[0] * cDir[0] + dir[1] * cDir[1] + dir[2] * cDir[2];
      if (cd < cone) continue;
      maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, cd)));
      const k = dOmegaRow[y] * (1 - ceil / L);
      E[0] += d[i] * k; E[1] += d[i + 1] * k; E[2] += d[i + 2] * k;
      const wgt = (L - ceil) * dOmegaRow[y];
      cx += dir[0] * wgt; cy += dir[1] * wgt; cz += dir[2] * wgt; wsum += wgt;
      const s = ceil / L;
      d[i] *= s; d[i + 1] *= s; d[i + 2] *= s;
    }
  }
  let sunDir = cDir;
  if (wsum > 0) { const l = Math.hypot(cx, cy, cz); sunDir = [cx / l, cy / l, cz / l]; }
  const illum = 0.2126 * E[0] + 0.7152 * E[1] + 0.0722 * E[2];
  const sunColor = illum > 0 ? E.map((c) => c / Math.max(E[0], E[1], E[2])) : [1, 1, 1];

  // sky irradiance on a horizontal plane, horizon / zenith colours
  let Esky = 0; const hor = [0, 0, 0]; let horW = 0; const zen = [0, 0, 0]; let zenW = 0;
  for (let y = 0; y < h / 2; y++) {
    const lat = (1 - (y + 0.5) / h - 0.5) * Math.PI;
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      Esky += lumOf(d, i) * Math.sin(lat) * dOmegaRow[y] * 2;
      if (lat < 6 * Math.PI / 180) { hor[0] += d[i]; hor[1] += d[i + 1]; hor[2] += d[i + 2]; horW++; }
      if (lat > 70 * Math.PI / 180) { zen[0] += d[i]; zen[1] += d[i + 1]; zen[2] += d[i + 2]; zenW++; }
    }
  }
  const horizon = hor.map((c) => c / horW), zenith = zen.map((c) => c / zenW);
  const hasSun = illum > 0.15 * Esky;
  const sinSun = Math.max(0, sunDir[1]);
  const Etot = Esky + illum * sinSun;
  const ground = GROUND_ALBEDO.map((a) => (a / Math.PI) * Etot);

  // lower hemisphere: ground radiance, blended through a soft horizon band
  for (let y = h / 2 - 1; y < h; y++) {
    const lat = (1 - (y + 0.5) / h - 0.5) * Math.PI; // <= 0
    const t = Math.min(1, Math.max(0, -lat / (5 * Math.PI / 180)));
    const s = t * t * (3 - 2 * t);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = horizon[c] * (1 - s) + ground[c] * s;
    }
  }

  // scale to 8 bit: brightest 0.02% may clip (residual glow)
  const peaks = [];
  for (let p = 0; p < n; p += 3) { const i = p * 4; peaks.push(Math.max(d[i], d[i + 1], d[i + 2])); }
  peaks.sort((a, b) => a - b);
  const scale = peaks[Math.floor(peaks.length * 0.9998)] * 1.02;
  const rgb = Buffer.alloc(n * 3);
  const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(Math.min(1, Math.max(0, toSrgb(d[i + c] / scale))) * 255);
  }
  const azimuth = Math.atan2(sunDir[2], sunDir[0]) * 180 / Math.PI;
  const elevation = Math.asin(sunDir[1]) * 180 / Math.PI;
  return {
    rgb, w, h,
    info: {
      scale, hasSun,
      sun: { dir: sunDir.map((v) => +v.toFixed(5)), azimuthDeg: +azimuth.toFixed(2), elevationDeg: +elevation.toFixed(2), color: sunColor.map((v) => +v.toFixed(4)), illuminance: +illum.toFixed(4), angularRadiusDeg: +(maxAngle * 180 / Math.PI).toFixed(3) },
      skyIrradiance: +Esky.toFixed(4),
      horizon: horizon.map((v) => +v.toFixed(5)), zenith: zenith.map((v) => +v.toFixed(5)), ground: ground.map((v) => +v.toFixed(5)),
    },
  };
}

const out = {};
for (const s of cfg.skies) {
  const t0 = Date.now();
  const { rgb, w, h, info } = processSky(s.name, join(cache, 'sky', `${s.name}.hdr`));
  const img = sharp(rgb, { raw: { width: w, height: h, channels: 3 } });
  await img.clone().jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(join(outDir, `${s.name}_hi.jpg`));
  await img.clone().resize(w / 2, h / 2, { kernel: 'lanczos3' }).jpeg({ quality: 90, mozjpeg: true }).toFile(join(outDir, `${s.name}_lo.jpg`));
  out[s.name] = { ...info, source: meta[s.id] };
  console.log(s.name, `${Date.now() - t0}ms`, JSON.stringify(info.sun), 'scale', info.scale.toFixed(3), 'Esky', info.skyIrradiance);
}
writeFileSync(join(outDir, 'skies.json'), JSON.stringify(out, null, 1));

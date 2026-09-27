// Tileable RGBA value-noise texture used for macro variation, anti-tiling and
// wetness patterns across many shaders.
import * as THREE from 'three';
import { hash2 } from '../core/rng.js';

function periodicNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, base, octaves, seed) {
  let s = 0, amp = 0.5, norm = 0, f = base;
  for (let o = 0; o < octaves; o++) { s += amp * periodicNoise(x * f, y * f, f, seed + o * 31); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

let cached = null;
export function macroNoiseTexture(size = 256) {
  if (cached) return cached;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (y * size + x) * 4;
    const r = fbm(u, v, 4, 5, 11), g = fbm(u, v, 8, 4, 23), b = fbm(u, v, 16, 3, 37);
    data[o] = Math.min(255, Math.max(0, (r - 0.5) * 1.8 * 255 + 128));
    data[o + 1] = Math.min(255, Math.max(0, (g - 0.5) * 1.8 * 255 + 128));
    data[o + 2] = Math.min(255, Math.max(0, (b - 0.5) * 1.8 * 255 + 128));
    data[o + 3] = hash2(x, y, 97) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  cached = t;
  return t;
}

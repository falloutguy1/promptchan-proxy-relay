// Deterministic hashing, RNG and 2D gradient noise used by world generation.
// Everything in the world is seeded so every player sees the same location.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash -> [0,1)
export function hash2i(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash1(x) {
  return hash2i(x, 0x5bd1e995, 7);
}

const GRAD = new Float32Array(512);
const PERM = new Uint16Array(512);
(function initPerm() {
  const r = mulberry32(1943);
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
    const a = r() * Math.PI * 2;
    GRAD[i] = a;
  }
})();
const GX = new Float32Array(256), GY = new Float32Array(256);
for (let i = 0; i < 256; i++) { GX[i] = Math.cos(GRAD[i]); GY[i] = Math.sin(GRAD[i]); }

// Perlin-style gradient noise, returns roughly [-1,1]
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const g00 = PERM[X + PERM[Y]], g10 = PERM[X + 1 + PERM[Y]];
  const g01 = PERM[X + PERM[Y + 1]], g11 = PERM[X + 1 + PERM[Y + 1]];
  const n00 = GX[g00] * xf + GY[g00] * yf;
  const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
  const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
  const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.414;
}

export function fbm(x, y, oct = 5, lac = 2.03, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, y);
    n += a;
    x = x * lac + 17.3; y = y * lac - 9.1;
    a *= gain;
  }
  return s / n;
}

export function ridged(x, y, oct = 4) {
  let s = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise2(x, y));
    s += a * v * v;
    n += a;
    x = x * 2.1 + 3.7; y = y * 2.1 + 1.3;
    a *= 0.5;
  }
  return s / n;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Value noise built only from hash2i so it can be reproduced bit-for-bit in GLSL
// (see terrain shader `vnoise`). Used where CPU placement must match GPU shading.
export function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2i(xi, yi, s), b = hash2i(xi + 1, yi, s), c = hash2i(xi, yi + 1, s), d = hash2i(xi + 1, yi + 1, s);
  return (a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv;
}

import * as THREE from 'three';

// ---------- deterministic random ----------
let _seed = 1337;
export function srand(s) { _seed = s >>> 0; }
export function rand() {
  _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rr = (a, b) => a + (b - a) * rand();
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------- 3D gradient noise (Perlin, improved) ----------
const P = new Uint8Array(512);
(function () {
  const p = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 98765;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z, B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(lerp(lerp(grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z), u),
    lerp(grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z), u), v),
    lerp(lerp(grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1), u),
      lerp(grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v), w);
}
export function fbm3(x, y, z, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; a *= gain; x *= lac; y *= lac; z *= lac; }
  return s / n;
}

// ---------- periodic 2D value noise for tileable textures ----------
const H = new Float32Array(65536);
(function () { let s = 424242; for (let i = 0; i < 65536; i++) { s = (s * 16807) % 2147483647; H[i] = s / 2147483647; } })();
function hp(i, j, px, py, salt) { i = ((i % px) + px) % px; j = ((j % py) + py) % py; return H[((i * 374761 + j * 668265 + salt * 1013) >>> 0) & 65535]; }
export function pnoise(x, y, px, py, salt = 0) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hp(ix, iy, px, py, salt), b = hp(ix + 1, iy, px, py, salt), c = hp(ix, iy + 1, px, py, salt), d = hp(ix + 1, iy + 1, px, py, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
// u,v in [0,1): tileable fbm
export function pfbm(u, v, px, py, oct = 5, salt = 0) {
  let a = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * pnoise(u * px, v * py, px, py, salt + i); n += a; a *= 0.5; px *= 2; py *= 2; }
  return s / n;
}

// ---------- sweep a 2D profile along a 3D polyline ----------
// profile: array of [x,y] (closed loop). scale(s) -> number or [sx,sy].
export function sweep(points, profile, opts = {}) {
  const { scale = () => 1, up = null, caps = true, uvScale = 1 } = opts;
  const n = points.length, m = profile.length;
  const T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  let n0 = up ? up.clone() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(n0.dot(T[0])) > 0.95) n0.set(1, 0, 0);
  n0.sub(T[0].clone().multiplyScalar(n0.dot(T[0]))).normalize();
  N.push(n0); B.push(new THREE.Vector3().crossVectors(T[0], n0));
  for (let i = 1; i < n; i++) {
    const v = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
    const nn = N[i - 1].clone();
    const l = v.length();
    if (l > 1e-6) nn.applyAxisAngle(v.divideScalar(l), Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)));
    N.push(nn); B.push(new THREE.Vector3().crossVectors(T[i], nn));
  }
  const pos = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += points[i].distanceTo(points[i - 1]);
    const s = i / (n - 1);
    let sc = scale(s); if (typeof sc === 'number') sc = [sc, sc];
    for (let j = 0; j <= m; j++) {
      const p = profile[j % m];
      const x = p[0] * sc[0], y = p[1] * sc[1];
      pos.push(points[i].x + N[i].x * x + B[i].x * y, points[i].y + N[i].y * x + B[i].y * y, points[i].z + N[i].z * x + B[i].z * y);
      uv.push(j / m, len * uvScale);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * (m + 1) + j, b = a + 1, c = a + m + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const [i, flip] of [[0, true], [n - 1, false]]) {
      const ci = pos.length / 3;
      pos.push(points[i].x, points[i].y, points[i].z); uv.push(0.5, 0.5);
      for (let j = 0; j < m; j++) {
        const a = i * (m + 1) + j, b = i * (m + 1) + j + 1;
        flip ? idx.push(ci, a, b) : idx.push(ci, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function roundRect(w, h, r = 0.25, seg = 2) {
  // closed loop profile of a rounded rectangle centred at origin
  const pts = [];
  const cx = [w / 2 - r, -w / 2 + r, -w / 2 + r, w / 2 - r];
  const cy = [h / 2 - r, h / 2 - r, -h / 2 + r, -h / 2 + r];
  for (let k = 0; k < 4; k++) for (let s = 0; s <= seg; s++) {
    const a = (k * Math.PI) / 2 + (s / seg) * (Math.PI / 2);
    pts.push([cx[k] + Math.cos(a) * r, cy[k] + Math.sin(a) * r]);
  }
  return pts;
}
export function circle(r = 1, seg = 8) {
  const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } return pts;
}

// ensure geometries share attribute set before merging
export function prep(g, color) {
  if (g.index === null) g = g.toNonIndexed ? g : g;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const cnt = g.attributes.position.count;
  if (!g.attributes.color) {
    const c = new Float32Array(cnt * 3); const col = color || [1, 1, 1];
    for (let i = 0; i < cnt; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (!g.attributes.aDamage) g.setAttribute('aDamage', new THREE.BufferAttribute(new Float32Array(cnt), 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aDamage'].includes(k)) g.deleteAttribute(k);
  if (!g.index) {
    const ix = []; for (let i = 0; i < cnt; i++) ix.push(i); g.setIndex(ix);
  }
  return g;
}

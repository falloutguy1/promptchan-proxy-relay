import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHITE = new THREE.Color(1, 1, 1);

// Normalise a geometry to non-indexed position / normal / color / aS so buckets can merge.
export function prep(geo, color = WHITE, sFn = null) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.color) {
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (!g.attributes.aS) {
    const s = new Float32Array(n);
    const p = g.attributes.position.array;
    for (let i = 0; i < n; i++) s[i] = sFn ? sFn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]) : p[i * 3];
    g.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aS'].includes(k)) g.deleteAttribute(k);
  return g;
}

export class Buckets {
  constructor() { this.map = new Map(); }
  add(key, geo, color, sFn) {
    if (!this.map.has(key)) this.map.set(key, []);
    this.map.get(key).push(prep(geo, color, sFn));
  }
  merged(key) {
    const list = this.map.get(key);
    if (!list || !list.length) return null;
    const g = mergeGeometries(list, false);
    g.computeBoundingSphere();
    return g;
  }
}

// Build an indexed grid surface from rows of 3D points (all rows same length).
// Faces point to the right of the row direction when rows go upward.
export function gridGeo(rows, flip = false, sRows = null) {
  const nr = rows.length, nc = rows[0].length;
  const pos = new Float32Array(nr * nc * 3);
  const sArr = new Float32Array(nr * nc);
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
    const p = rows[j][i], o = (j * nc + i) * 3;
    pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
    sArr[j * nc + i] = sRows ? sRows[j][i] : p[0];
  }
  const idx = [];
  for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nc - 1; i++) {
    const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1;
    if (!flip) { idx.push(a, b, d, a, d, c); } else { idx.push(a, d, b, a, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(sArr, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Arc lengths along a 2D polyline [[x,z],...]
export function arcLen(pts, s0 = 0) {
  const s = [s0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return s;
}

// Vertical wall along a 2D polyline (x,z) between y0 and y1. For a polyline running
// toward +x on the +z side, faces point outward (+z). mirror=true builds the -z copy.
export function wallGeo(pts, y0, y1, { mirror = false, s0 = 0, sIsX = false, flipFace = false } = {}) {
  const sm = mirror ? -1 : 1;
  const s = sIsX ? pts.map((p) => p[0]) : arcLen(pts, s0);
  const rows = [pts.map((p) => [p[0], y0, p[1] * sm]), pts.map((p) => [p[0], y1, p[1] * sm])];
  const sRows = [s, s];
  // gridGeo's default winding faces +z for rows going upward with points toward +x.
  return gridGeo(rows, mirror !== flipFace, sRows);
}

// Horizontal band between two polylines (same length) at height y, facing up (or down).
export function bandGeo(outer, inner, y, { mirror = false, down = false } = {}) {
  const sm = mirror ? -1 : 1;
  const rows = [outer.map((p) => [p[0], y, p[1] * sm]), inner.map((p) => [p[0], y, p[1] * sm])];
  // default winding faces +y on the +z side (outer -> inner, points toward +x)
  return gridGeo(rows, mirror !== down);
}

// Polygon cap from a closed outline of [x,z] at height y facing up/down.
export function capGeo(outline, y, down = false) {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  if (down) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const n = g.attributes.normal.array; for (let i = 1; i < n.length; i += 3) n[i] = -n[i];
  }
  return g;
}

// Closed outline from a half outline (z>=0, ordered stern->bow) by mirroring.
export function fullOutline(half) {
  const port = half.slice().reverse().map((p) => [p[0], -p[1]]);
  const out = half.slice();
  for (const p of port) {
    const q = out[out.length - 1];
    if (Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
  return out;
}

export function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// Offset a 2D polyline sideways (positive = toward +z side normal).
export function offsetLine(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / L) * d, p[1] + (dx / L) * d];
  });
}

// Resample polyline at spacing (returns points with their tangent)
export function samplePolyline(pts, spacing, start = 0) {
  const s = arcLen(pts);
  const total = s[s.length - 1];
  const out = [];
  let j = 0;
  for (let d = start; d <= total + 1e-6; d += spacing) {
    while (j < s.length - 2 && s[j + 1] < d) j++;
    const t = (d - s[j]) / Math.max(1e-6, s[j + 1] - s[j]);
    const a = pts[j], b = pts[j + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx: (b[0] - a[0]) / L, tz: (b[1] - a[1]) / L, s: d });
  }
  return out;
}

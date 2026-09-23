import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { mergeGeometries };

// Deterministic PRNG so every load produces the identical ship.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Lathe with the axis along +Y; points are [radius, y] pairs.
export function lathe(points, segments = 24, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength);
}

// Build an InstancedMesh from a list of Matrix4 (or {p, r, s} descriptors).
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function trs(p, r = [0, 0, 0], s = [1, 1, 1]) {
  if (typeof r === 'number') r = [0, r, 0];
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _p.set(p[0], p[1], p[2]);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function instanced(geometry, material, matrices, { cast = true, receive = true, colors = null } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Bake a transform into a clone of a geometry (for merging).
export function baked(geometry, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.applyMatrix4(trs(p, r, s));
  return g;
}

// Merge geometries that may differ in attribute sets (keeps position/normal/uv).
export function mergeLoose(list) {
  const clean = list.map((g) => {
    let n = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', n.getAttribute('position'));
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    out.setAttribute('normal', n.getAttribute('normal'));
    const uv = n.getAttribute('uv');
    out.setAttribute('uv', uv || new THREE.BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    return out;
  });
  return mergeGeometries(clean, false);
}

// Tube along a list of points.
export function tubeAlong(points, radius, radial = 8, closed = false, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', tension);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 12), radius, radial, closed);
}

export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700;

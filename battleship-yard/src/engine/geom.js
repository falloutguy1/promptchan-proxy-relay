import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxUV } from '../world/materials.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
export const S1 = V(1, 1, 1);

/** Collects geometry per material, transforms it, gives it metre-scale UVs and merges it. */
export class Batch {
  constructor() { this.parts = new Map(); }
  add(mat, geo, pos = V(0, 0, 0), rot = [0, 0, 0], scale = S1, uv = 'box') {
    let g = geo.index ? geo.clone() : geo.clone();
    M.compose(pos, Q.setFromEuler(E.set(rot[0], rot[1], rot[2], 'YXZ')), scale);
    g.applyMatrix4(M);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (uv === 'box' || !g.attributes.uv) boxUV(g, 1);
    if (!g.index) {
      const n = g.attributes.position.count;
      g.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return g;
  }
  build(name) {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = `${name}:${mat.name}`;
      group.add(mesh);
      for (const l of list) l.dispose();
    }
    return group;
  }
}

export const rbox = (w, h, d, r = 0.08) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
export const cyl = (rt, rb, h, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);

export function lathe(profile, seg = 24) {
  // profile: [[r, y], ...] -> revolve around Y
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

/** Extruded plan shape (x, z) with bevelled edges, extruded along +Y. */
export function extrudePlan(points, height, bevel = 0.12) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(Math.PI / 2); // shape XY -> XZ, extrude +Z -> -Y
  g.translate(0, height - bevel, 0); // Rx(90deg) keeps plan z = shape y; extrusion now spans y in [0, height]
  g.computeVertexNormals();
  return g;
}

export function roundedRectPlan(x0, x1, w0, w1, r) {
  // trapezoid-ish plan from x0 (aft) to x1 (fore), half widths w0 (aft) w1 (fore), rounded corners
  const pts = [];
  const corner = (cx, cz, a0) => { for (let i = 0; i <= 4; i++) { const a = a0 + (i / 4) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  corner(x1 - r, w1 - r, 0);
  corner(x0 + r, w0 - r, Math.PI / 2);
  corner(x0 + r, -w0 + r, Math.PI);
  corner(x1 - r, -w1 + r, Math.PI * 1.5);
  return pts;
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry helpers for hand-built architecture:
//  - boxes with real bevels (manufactured edges catch light)
//  - metric box-projected UVs so scanned textures keep real-world scale
//  - a Builder that batches pieces per material into a few merged meshes

const _v = new THREE.Vector3(), _n = new THREE.Vector3();

/** Box-projected UVs in metres. space: geometry is transformed by m before projecting (world-aligned UVs). */
export function boxUV(geo, m = null, offset = [0, 0]) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nor, i);
    if (m) { _v.applyMatrix4(m); _n.applyMatrix3(nm).normalize(); }
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    let u, v;
    if (ax >= ay && ax >= az) { u = _n.x > 0 ? -_v.z : _v.z; v = _v.y; }
    else if (ay >= az) { u = _v.x; v = _n.y > 0 ? -_v.z : _v.z; }
    else { u = _n.z > 0 ? _v.x : -_v.x; v = _v.y; }
    uv[i * 2] = u + offset[0]; uv[i * 2 + 1] = v + offset[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

export function box(w, h, d, bevel = 0) {
  const g = bevel > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d);
  return g;
}

/** Collects pieces per material; UVs are computed in builder space unless localUV is set. */
export class Builder {
  constructor() { this.buckets = new Map(); }
  add(mat, geo, matrix, opts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!opts.keepUV) {
      if (opts.localUV) boxUV(g, opts.uvMatrix || null, opts.uvOffset);
      else boxUV(g, matrix, opts.uvOffset);
    }
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    return g;
  }
  /** Axis-aligned box given min/max corners. */
  aabb(mat, x0, y0, z0, x1, y1, z1, bevel = 0, opts) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const g = box(x1 - x0, y1 - y0, z1 - z0, bevel);
    const m = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return this.add(mat, g, m, opts);
  }
  /** Box of size (w,h,d) centred at p with rotation euler. */
  obox(mat, w, h, d, p, rot = null, bevel = 0, opts) {
    const g = box(w, h, d, bevel);
    const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(rot || new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    return this.add(mat, g, m, opts);
  }
  build(group, { castShadow = true, receiveShadow = true } = {}) {
    for (const [mat, list] of this.buckets) {
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
      mesh.name = mat.name;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/**
 * Decompose a wall with rectangular openings into solid rectangles.
 * wall: length L, height H; openings [{u0,u1,v0,v1}] in wall coords.
 * Returns [{u0,u1,v0,v1}] solid pieces.
 */
export function wallPieces(L, H, openings) {
  const cuts = new Set([0, L]);
  for (const o of openings) { cuts.add(o.u0); cuts.add(o.u1); }
  const us = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < us.length - 1; i++) {
    const u0 = us[i], u1 = us[i + 1], um = (u0 + u1) / 2;
    if (u1 - u0 < 1e-4) continue;
    const holes = openings.filter((o) => o.u0 < um && o.u1 > um).sort((a, b) => a.v0 - b.v0);
    let v = 0;
    for (const h of holes) {
      if (h.v0 > v + 1e-4) out.push({ u0, u1, v0: v, v1: h.v0 });
      v = Math.max(v, h.v1);
    }
    if (H > v + 1e-4) out.push({ u0, u1, v0: v, v1: H });
  }
  return out;
}

// Small geometry toolkit for procedural structures: accumulates parts per material key,
// applies real-world-scale box-projected UVs (metres), baked per-vertex AO and bevelled boxes.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

function ensureNonIndexed(g) { return g.index ? g.toNonIndexed() : g; }

export class GB {
  constructor() { this.parts = new Map(); }

  // opts: { ao: 0..1 constant, uv: 'box'|'keep', uvScale: [u,v], aoGround: true }
  add(key, geom, matrix, opts = {}) {
    let g = ensureNonIndexed(geom);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
    // UVs
    let uv;
    if (opts.uv === 'keep' && g.attributes.uv) {
      uv = g.attributes.uv.array.slice();
      const [su, sv] = opts.uvScale || [1, 1];
      for (let i = 0; i < uv.length; i += 2) { uv[i] *= su; uv[i + 1] *= sv; }
    } else {
      uv = new Float32Array(n * 2);
      const off = opts.uvOffset || 0;
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
        if (ay >= ax && ay >= az) { uv[i * 2] = x + off; uv[i * 2 + 1] = z; }
        else if (ax >= az) { uv[i * 2] = z * Math.sign(nrm[i * 3] || 1) + off; uv[i * 2 + 1] = y; }
        else { uv[i * 2] = -x * Math.sign(nrm[i * 3 + 2] || 1) + off; uv[i * 2 + 1] = y; }
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv instanceof Float32Array ? uv : new Float32Array(uv), 2));
    // baked AO in vertex colour
    const col = new Float32Array(n * 3);
    const base = opts.ao ?? 1;
    for (let i = 0; i < n; i++) {
      let a = base;
      if (opts.aoGround !== false) {
        const y = pos[i * 3 + 1];
        a *= 0.72 + 0.28 * Math.min(1, Math.max(0, y / 2.2));
      }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  box(key, w, h, d, x, y, z, ry = 0, opts = {}) {
    const g = opts.bevel ? new RoundedBoxGeometry(w, h, d, 1, Math.min(opts.bevel, w / 2.01, h / 2.01, d / 2.01)) : new THREE.BoxGeometry(w, h, d);
    return this.add(key, g, mat4(x, y + h / 2, z, opts.rx || 0, ry, opts.rz || 0), opts);
  }

  cyl(key, r0, r1, h, x, y, z, seg = 12, opts = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, !!opts.open, opts.thetaStart || 0, opts.thetaLength || Math.PI * 2);
    const circ = Math.PI * 2 * Math.max(r0, r1);
    return this.add(key, g, opts.matrix || mat4(x, y + h / 2, z, opts.rx || 0, opts.ry || 0, opts.rz || 0), { uv: 'keep', uvScale: [circ, h], ...opts });
  }

  // Wall slab with rectangular openings, built from a Shape: outer/inner faces + reveals + edges.
  // Local frame: wall spans x in [0,W], y in [0,H] (or custom outline), thickness t towards -z (outer face at z=0).
  wall(key, outline, openings, t, matrix, opts = {}) {
    const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p[0], p[1])));
    for (const o of openings) {
      const hp = new THREE.Path();
      hp.moveTo(o.x, o.y); hp.lineTo(o.x, o.y + o.h); hp.lineTo(o.x + o.w, o.y + o.h); hp.lineTo(o.x + o.w, o.y); hp.lineTo(o.x, o.y);
      shape.holes.push(hp);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
    // ExtrudeGeometry extrudes towards +z; move so outer face is z=0 and body extends to -t
    g.translate(0, 0, -t);
    const m = matrix.clone();
    this.add(key, g, m, opts);
  }

  build() {
    const out = new Map();
    for (const [k, list] of this.parts) {
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(k, g);
    }
    return out;
  }
}

// Gable roof along local x: two sloped slabs with eave/gable overhangs and a half-round ridge cap.
// Slab UVs are u along the ridge, v down the slope, in metres. `opts.matrix` = parent transform.
export function gableRoof(gb, key, L, D, eaveY, pitchDeg, opts = {}) {
  const ovE = opts.eave ?? 0.45, ovG = opts.gable ?? 0.3, th = opts.thick ?? 0.16;
  const p = THREE.MathUtils.degToRad(pitchDeg);
  const run = D / 2 + ovE;
  const ridgeY = eaveY + Math.tan(p) * D / 2;
  const slopeLen = run / Math.cos(p);
  const parent = opts.matrix || new THREE.Matrix4();
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(L + ovG * 2, th, slopeLen);
    const uv = g.attributes.uv.array, pos = g.attributes.position.array;
    for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = pos[i * 3]; uv[i * 2 + 1] = pos[i * 3 + 2]; }
    const zm = side * run / 2, ym = ridgeY - Math.tan(p) * run / 2;
    const m = parent.clone()
      .multiply(new THREE.Matrix4().makeTranslation(opts.x || 0, ym + Math.cos(p) * th / 2, zm + side * Math.sin(p) * th / 2))
      .multiply(new THREE.Matrix4().makeRotationX(side * p));
    gb.add(key, g, m, { uv: 'keep', aoGround: false, ao: 0.95 });
  }
  const rc = new THREE.CylinderGeometry(0.14, 0.14, L + ovG * 2, 8, 1, false, 0, Math.PI);
  const rm = parent.clone().multiply(new THREE.Matrix4().makeTranslation(opts.x || 0, ridgeY + th / Math.cos(p) - 0.04, 0)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  gb.add(key, rc, rm, { uv: 'keep', uvScale: [0.9, L], aoGround: false });
  return { ridgeY, run };
}

export { mergeGeometries, mergeVertices };

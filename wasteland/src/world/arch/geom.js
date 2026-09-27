// Geometry builder for procedural architecture. Primitives are emitted in local
// space, transformed by a matrix stack, and accumulated per material so a whole
// building collapses to one draw call per material. UVs are real-world metres
// divided by each material's texture tile size, so texel density is consistent.
//
// Extra vertex attribute 'wear' (vec2): x = height above the building's ground
// (drives splash-back grime / damp), y = exposure 0..1 (outer faces 1, interior 0).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const WHITE = new THREE.Color(1, 1, 1);
const _tints = new Map();
/** '#rrggbb' -> linear-space colour (cached). */
function tintColor(hex) {
  let c = _tints.get(hex);
  if (!c) { c = new THREE.Color(hex); _tints.set(hex, c); }
  return c;
}

export class Geo {
  constructor(tiles = {}) {
    this.tiles = tiles;         // material key -> tile size (m)
    this.parts = new Map();
    this.stack = [new THREE.Matrix4()];
    this.baseY = 0;             // world height of the building's ground for 'wear'
    this.exposure = 1;
    this._col = WHITE;
  }
  get m() { return this.stack[this.stack.length - 1]; }
  push(mat) { this.stack.push(this.m.clone().multiply(mat)); return this; }
  pushTRS(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    return this.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)));
  }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }

  /**
   * Geometry bucket for a material key. 'set:#rrggbb' tints become per-vertex
   * colours, so every tint of a set shares one material (and one batch).
   */
  part(key) {
    const c = key.indexOf(':#');
    const set = c >= 0 ? key.slice(0, c) : key;
    this._col = c >= 0 ? tintColor(key.slice(c + 1)) : WHITE;
    let p = this.parts.get(set);
    if (!p) { p = { pos: [], nor: [], uv: [], wear: [], col: [], idx: [] }; this.parts.set(set, p); }
    return p;
  }
  tile(key) { const k = key.split(':')[0]; return this.tiles[k] || this.tiles[key] || 2; }

  /** raw vertex in local space */
  #vert(p, x, y, z, nx, ny, nz, u, v) {
    _v.set(x, y, z).applyMatrix4(this.m);
    _m3.getNormalMatrix(this.m);
    _n.set(nx, ny, nz).applyMatrix3(_m3).normalize();
    p.pos.push(_v.x, _v.y, _v.z);
    p.nor.push(_n.x, _n.y, _n.z);
    p.uv.push(u, v);
    p.wear.push(_v.y - this.baseY, this.exposure);
    p.col.push(this._col.r, this._col.g, this._col.b);
    return p.pos.length / 3 - 1;
  }

  /**
   * Quad from 4 local corners (any winding); oriented so its normal matches n.
   * uvs: 4 [u,v] in metres (divided by tile size here).
   */
  quad(key, a, b, c, d, n, uvs) {
    const p = this.part(key), t = this.tile(key);
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    const flip = new THREE.Vector3().crossVectors(ab, ac).dot(n) < 0;
    const i0 = this.#vert(p, a.x, a.y, a.z, n.x, n.y, n.z, uvs[0][0] / t, uvs[0][1] / t);
    const i1 = this.#vert(p, b.x, b.y, b.z, n.x, n.y, n.z, uvs[1][0] / t, uvs[1][1] / t);
    const i2 = this.#vert(p, c.x, c.y, c.z, n.x, n.y, n.z, uvs[2][0] / t, uvs[2][1] / t);
    const i3 = this.#vert(p, d.x, d.y, d.z, n.x, n.y, n.z, uvs[3][0] / t, uvs[3][1] / t);
    if (!flip) p.idx.push(i0, i1, i2, i0, i2, i3); else p.idx.push(i0, i2, i1, i0, i3, i2);
  }

  tri(key, a, b, c, na, nb, nc, uvs, outward) {
    const p = this.part(key), t = this.tile(key);
    const ab = new THREE.Vector3().subVectors(b, a), ac = new THREE.Vector3().subVectors(c, a);
    const flip = new THREE.Vector3().crossVectors(ab, ac).dot(outward) < 0;
    const i0 = this.#vert(p, a.x, a.y, a.z, na.x, na.y, na.z, uvs[0][0] / t, uvs[0][1] / t);
    const i1 = this.#vert(p, b.x, b.y, b.z, nb.x, nb.y, nb.z, uvs[1][0] / t, uvs[1][1] / t);
    const i2 = this.#vert(p, c.x, c.y, c.z, nc.x, nc.y, nc.z, uvs[2][0] / t, uvs[2][1] / t);
    if (!flip) p.idx.push(i0, i1, i2); else p.idx.push(i0, i2, i1);
  }

  /** Axis-aligned planar rectangle helper: plane given by axis ('x'|'y'|'z'), offset, and 2D extents. */
  rect(key, axis, off, a0, a1, b0, b1, sign) {
    // for axis x: a = z, b = y ; axis y: a = x, b = z ; axis z: a = x, b = y
    const P = (a, b) => (axis === 'x' ? new THREE.Vector3(off, b, a) : axis === 'y' ? new THREE.Vector3(a, off, b) : new THREE.Vector3(a, b, off));
    const n = axis === 'x' ? new THREE.Vector3(sign, 0, 0) : axis === 'y' ? new THREE.Vector3(0, sign, 0) : new THREE.Vector3(0, 0, sign);
    const uv = (a, b) => (axis === 'y' ? [a, b] : [a * (axis === 'x' ? -sign : sign), -b]);
    this.quad(key, P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1), n, [uv(a0, b0), uv(a1, b0), uv(a1, b1), uv(a0, b1)]);
  }

  /**
   * Box with optional chamfered edges (bevel, metres). Centre (x,y,z), size (sx,sy,sz).
   * Chamfer vertices carry the adjacent face normals, so edges shade as rounded.
   * faces: optional set of face names to skip e.g. { '-y': false }.
   */
  box(key, x, y, z, sx, sy, sz, bevel = 0, skip = null, uvOffset = null) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const b = Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45);
    const ox = uvOffset ? uvOffset[0] : x, oy = uvOffset ? uvOffset[1] : y, oz = uvOffset ? uvOffset[2] : z;
    const p = this.part(key), t = this.tile(key);
    const add = (lx, ly, lz, n) => {
      // uv by dominant axis of the normal (box mapping, metres)
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let u, v;
      const wx = lx + ox, wy = ly + oy, wz = lz + oz;
      if (ay >= ax && ay >= az) { u = wx; v = wz; }
      else if (ax >= az) { u = -wz * Math.sign(n.x || 1); v = -wy; }
      else { u = wx * Math.sign(n.z || 1); v = -wy; }
      return this.#vert(p, x + lx, y + ly, z + lz, n.x, n.y, n.z, u / t, v / t);
    };
    const tri = (i0, i1, i2, out) => {
      const P = p.pos;
      const A = new THREE.Vector3(P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]);
      const B = new THREE.Vector3(P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]);
      const C = new THREE.Vector3(P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]);
      const nn = new THREE.Vector3().crossVectors(B.sub(A), C.sub(A));
      _m3.getNormalMatrix(this.m);
      const o = out.clone().applyMatrix3(_m3);
      if (nn.dot(o) >= 0) p.idx.push(i0, i1, i2); else p.idx.push(i0, i2, i1);
    };
    const faces = [
      ['+x', new THREE.Vector3(1, 0, 0)], ['-x', new THREE.Vector3(-1, 0, 0)],
      ['+y', new THREE.Vector3(0, 1, 0)], ['-y', new THREE.Vector3(0, -1, 0)],
      ['+z', new THREE.Vector3(0, 0, 1)], ['-z', new THREE.Vector3(0, 0, -1)],
    ];
    const H = new THREE.Vector3(hx, hy, hz);
    const comp = (v, i) => (i === 0 ? v.x : i === 1 ? v.y : v.z);
    for (const [name, n] of faces) {
      if (skip && skip[name] === false) continue;
      const ai = Math.abs(n.x) ? 0 : Math.abs(n.y) ? 1 : 2;
      const u = (ai + 1) % 3, w = (ai + 2) % 3;
      const pt = (su, sw) => {
        const v = new THREE.Vector3();
        v.setComponent(ai, comp(n, ai) * comp(H, ai));
        v.setComponent(u, su * (comp(H, u) - b));
        v.setComponent(w, sw * (comp(H, w) - b));
        return v;
      };
      const q = [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)].map((v) => add(v.x, v.y, v.z, n));
      tri(q[0], q[1], q[2], n); tri(q[0], q[2], q[3], n);
    }
    if (b <= 0) return;
    // chamfer strips along the 12 edges
    for (let a1 = 0; a1 < 3; a1++) for (let a2 = a1 + 1; a2 < 3; a2++) {
      const a3 = 3 - a1 - a2;
      for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
        const n1 = new THREE.Vector3(); n1.setComponent(a1, s1);
        const n2 = new THREE.Vector3(); n2.setComponent(a2, s2);
        const e = [];
        for (const s3 of [-1, 1]) {
          const pa = new THREE.Vector3(), pb = new THREE.Vector3();
          pa.setComponent(a1, s1 * comp(H, a1)); pa.setComponent(a2, s2 * (comp(H, a2) - b)); pa.setComponent(a3, s3 * (comp(H, a3) - b));
          pb.setComponent(a1, s1 * (comp(H, a1) - b)); pb.setComponent(a2, s2 * comp(H, a2)); pb.setComponent(a3, s3 * (comp(H, a3) - b));
          e.push(add(pa.x, pa.y, pa.z, n1), add(pb.x, pb.y, pb.z, n2));
        }
        const out = n1.clone().add(n2);
        tri(e[0], e[1], e[3], out); tri(e[0], e[3], e[2], out);
      }
    }
    // corner triangles
    for (const sx_ of [-1, 1]) for (const sy_ of [-1, 1]) for (const sz_ of [-1, 1]) {
      const nx = new THREE.Vector3(sx_, 0, 0), ny = new THREE.Vector3(0, sy_, 0), nz = new THREE.Vector3(0, 0, sz_);
      const i0 = add(sx_ * hx, sy_ * (hy - b), sz_ * (hz - b), nx);
      const i1 = add(sx_ * (hx - b), sy_ * hy, sz_ * (hz - b), ny);
      const i2 = add(sx_ * (hx - b), sy_ * (hy - b), sz_ * hz, nz);
      tri(i0, i1, i2, new THREE.Vector3(sx_, sy_, sz_));
    }
  }

  /** Box between two points (a beam/plank/post) with square section w x h. */
  beam(key, a, b, w, h, bevel = 0.01, roll = 0) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    this.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    this.box(key, 0, 0, 0, w, h, len, bevel);
    this.pop();
  }

  /** Cylinder / tube along a polyline. Open ends unless caps. */
  tube(key, pts, radius, radial = 10, caps = false, uvAround = null) {
    const t = this.tile(key), p = this.part(key);
    const N = pts.length;
    const tang = pts.map((_, i) => new THREE.Vector3().subVectors(pts[Math.min(N - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize());
    let nrm = Math.abs(tang[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    nrm.sub(tang[0].clone().multiplyScalar(nrm.dot(tang[0]))).normalize();
    const rings = [];
    let vl = 0;
    for (let i = 0; i < N; i++) {
      if (i > 0) {
        vl += pts[i].distanceTo(pts[i - 1]);
        const axis = new THREE.Vector3().crossVectors(tang[i - 1], tang[i]);
        if (axis.lengthSq() > 1e-10) nrm.applyAxisAngle(axis.normalize(), Math.acos(THREE.MathUtils.clamp(tang[i - 1].dot(tang[i]), -1, 1)));
      }
      const bin = new THREE.Vector3().crossVectors(tang[i], nrm);
      const r = Array.isArray(radius) ? radius[i] : radius;
      const ring = [];
      const circ = uvAround ?? 2 * Math.PI * r;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const nx = nrm.x * Math.cos(a) + bin.x * Math.sin(a), ny = nrm.y * Math.cos(a) + bin.y * Math.sin(a), nz = nrm.z * Math.cos(a) + bin.z * Math.sin(a);
        ring.push(this.#vert(p, pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r, nx, ny, nz, ((j / radial) * circ) / t, vl / t));
      }
      rings.push(ring);
    }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < radial; j++) {
      const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j], d = rings[i + 1][j + 1];
      p.idx.push(a, b, c, b, d, c);
    }
    if (caps) {
      for (const [i, s] of [[0, -1], [N - 1, 1]]) {
        const n = tang[i].clone().multiplyScalar(s);
        const r = Array.isArray(radius) ? radius[i] : radius;
        const c = this.#vert(p, pts[i].x, pts[i].y, pts[i].z, n.x, n.y, n.z, 0, 0);
        const ring = [];
        const bin = new THREE.Vector3();
        for (let j = 0; j <= radial; j++) {
          const P = p.pos, k = rings[i][j];
          const vx = P[k * 3], vy = P[k * 3 + 1], vz = P[k * 3 + 2];
          ring.push(this.#vertWorld(p, vx, vy, vz, n, (vx - pts[i].x) / t, (vz - pts[i].z) / t));
        }
        for (let j = 0; j < radial; j++) { if (s > 0) p.idx.push(c, ring[j], ring[j + 1]); else p.idx.push(c, ring[j + 1], ring[j]); }
        void bin; void r;
      }
    }
  }
  // vertex already in world space (used by caps)
  #vertWorld(p, x, y, z, n, u, v) {
    _m3.getNormalMatrix(this.m);
    _n.copy(n).applyMatrix3(_m3).normalize();
    p.pos.push(x, y, z); p.nor.push(_n.x, _n.y, _n.z); p.uv.push(u, v); p.wear.push(y - this.baseY, this.exposure); p.col.push(this._col.r, this._col.g, this._col.b);
    return p.pos.length / 3 - 1;
  }

  /** Surface of revolution around local Y from a profile [[r, y], ...]. */
  lathe(key, profile, segs = 24, a0 = 0, a1 = Math.PI * 2, flipNormals = false) {
    const t = this.tile(key), p = this.part(key);
    const rows = [];
    let vl = 0;
    for (let i = 0; i < profile.length; i++) {
      const [r, y] = profile[i];
      if (i > 0) vl += Math.hypot(r - profile[i - 1][0], y - profile[i - 1][1]);
      const pr = profile[Math.max(0, i - 1)], nx_ = profile[Math.min(profile.length - 1, i + 1)];
      let dr = nx_[0] - pr[0], dy = nx_[1] - pr[1];
      const l = Math.hypot(dr, dy) || 1; dr /= l; dy /= l;
      let nr = dy, ny = -dr; // outward normal of the profile curve
      if (flipNormals) { nr = -nr; ny = -ny; }
      const row = [];
      for (let j = 0; j <= segs; j++) {
        const a = a0 + ((a1 - a0) * j) / segs;
        const c = Math.cos(a), s = Math.sin(a);
        row.push(this.#vert(p, r * c, y, r * s, nr * c, ny, nr * s, (a * Math.max(r, 0.3)) / t, -vl / t));
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
      if (!flipNormals) p.idx.push(a, c, b, b, c, d); else p.idx.push(a, b, c, b, d, c);
    }
  }

  /**
   * Wall slab along local +X from 0..L, height 0..H, thickness t (outer face at
   * z = +t/2). Openings: [{ u0, u1, v0, v1 }] cut through with plastered reveals.
   */
  wall(outKey, inKey, L, H, t, openings = [], { top = true, ends = true, revealKey = null } = {}) {
    const us = new Set([0, L]), vs = new Set([0, H]);
    for (const o of openings) { us.add(o.u0); us.add(o.u1); vs.add(o.v0); vs.add(o.v1); }
    const U = [...us].sort((a, b) => a - b), V = [...vs].sort((a, b) => a - b);
    const inside = (u, v) => openings.some((o) => u > o.u0 && u < o.u1 && v > o.v0 && v < o.v1);
    const zo = t / 2, zi = -t / 2;
    const exp = this.exposure;
    for (let i = 0; i < U.length - 1; i++) {
      // merge vertical runs of solid cells
      let j = 0;
      while (j < V.length - 1) {
        if (inside((U[i] + U[i + 1]) / 2, (V[j] + V[j + 1]) / 2)) { j++; continue; }
        let k = j;
        while (k < V.length - 1 && !inside((U[i] + U[i + 1]) / 2, (V[k] + V[k + 1]) / 2)) k++;
        const u0 = U[i], u1 = U[i + 1], v0 = V[j], v1 = V[k];
        this.exposure = exp;
        this.quad(outKey, new THREE.Vector3(u0, v0, zo), new THREE.Vector3(u1, v0, zo), new THREE.Vector3(u1, v1, zo), new THREE.Vector3(u0, v1, zo), new THREE.Vector3(0, 0, 1), [[u0, -v0], [u1, -v0], [u1, -v1], [u0, -v1]]);
        this.exposure = 0;
        this.quad(inKey, new THREE.Vector3(u0, v0, zi), new THREE.Vector3(u1, v0, zi), new THREE.Vector3(u1, v1, zi), new THREE.Vector3(u0, v1, zi), new THREE.Vector3(0, 0, -1), [[-u0, -v0], [-u1, -v0], [-u1, -v1], [-u0, -v1]]);
        j = k;
      }
    }
    this.exposure = exp;
    const rk = revealKey || outKey;
    for (const o of openings) {
      // reveals: sill (bottom), soffit (top), jambs
      if (o.v0 > 0.001) this.quad(rk, new THREE.Vector3(o.u0, o.v0, zi), new THREE.Vector3(o.u1, o.v0, zi), new THREE.Vector3(o.u1, o.v0, zo), new THREE.Vector3(o.u0, o.v0, zo), new THREE.Vector3(0, 1, 0), [[o.u0, zi], [o.u1, zi], [o.u1, zo], [o.u0, zo]]);
      this.quad(rk, new THREE.Vector3(o.u0, o.v1, zi), new THREE.Vector3(o.u1, o.v1, zi), new THREE.Vector3(o.u1, o.v1, zo), new THREE.Vector3(o.u0, o.v1, zo), new THREE.Vector3(0, -1, 0), [[o.u0, zi], [o.u1, zi], [o.u1, zo], [o.u0, zo]]);
      this.quad(rk, new THREE.Vector3(o.u0, o.v0, zi), new THREE.Vector3(o.u0, o.v1, zi), new THREE.Vector3(o.u0, o.v1, zo), new THREE.Vector3(o.u0, o.v0, zo), new THREE.Vector3(1, 0, 0), [[zi, -o.v0], [zi, -o.v1], [zo, -o.v1], [zo, -o.v0]]);
      this.quad(rk, new THREE.Vector3(o.u1, o.v0, zi), new THREE.Vector3(o.u1, o.v1, zi), new THREE.Vector3(o.u1, o.v1, zo), new THREE.Vector3(o.u1, o.v0, zo), new THREE.Vector3(-1, 0, 0), [[zi, -o.v0], [zi, -o.v1], [zo, -o.v1], [zo, -o.v0]]);
    }
    if (top) this.quad(outKey, new THREE.Vector3(0, H, zi), new THREE.Vector3(L, H, zi), new THREE.Vector3(L, H, zo), new THREE.Vector3(0, H, zo), new THREE.Vector3(0, 1, 0), [[0, zi], [L, zi], [L, zo], [0, zo]]);
    if (ends) {
      this.quad(outKey, new THREE.Vector3(0, 0, zi), new THREE.Vector3(0, H, zi), new THREE.Vector3(0, H, zo), new THREE.Vector3(0, 0, zo), new THREE.Vector3(-1, 0, 0), [[zi, 0], [zi, -H], [zo, -H], [zo, 0]]);
      this.quad(outKey, new THREE.Vector3(L, 0, zi), new THREE.Vector3(L, H, zi), new THREE.Vector3(L, H, zo), new THREE.Vector3(L, 0, zo), new THREE.Vector3(1, 0, 0), [[zi, 0], [zi, -H], [zo, -H], [zo, 0]]);
    }
  }

  /** Triangular gable above a wall (local +X 0..L, from y0 up to peak at L/2). */
  gable(outKey, inKey, L, y0, peak, t) {
    const zo = t / 2, zi = -t / 2;
    const exp = this.exposure;
    const A = [0, y0], B = [L, y0], C = [L / 2, y0 + peak];
    const P = (p, z) => new THREE.Vector3(p[0], p[1], z);
    this.tri(outKey, P(A, zo), P(B, zo), P(C, zo), _up3(0, 0, 1), _up3(0, 0, 1), _up3(0, 0, 1), [[A[0], -A[1]], [B[0], -B[1]], [C[0], -C[1]]].map((q) => q.map((x) => x)), new THREE.Vector3(0, 0, 1));
    this.exposure = 0;
    this.tri(inKey, P(A, zi), P(B, zi), P(C, zi), _up3(0, 0, -1), _up3(0, 0, -1), _up3(0, 0, -1), [[-A[0], -A[1]], [-B[0], -B[1]], [-C[0], -C[1]]], new THREE.Vector3(0, 0, -1));
    this.exposure = exp;
  }

  /** Irregular broken top edge for ruined walls: jagged strip from 'base' up to base + [0.1, amp]. */
  jaggedTop(outKey, inKey, L, base, t, rng, amp = 1.2) {
    const zo = t / 2, zi = -t / 2;
    const n = Math.max(3, Math.ceil(L / 0.55));
    const hs = [];
    for (let i = 0; i <= n; i++) hs.push(base + (i === 0 || i === n ? rng.float(0.05, 0.3) : rng.float(0.1, amp)));
    for (let i = 0; i < n; i++) {
      const u0 = (i / n) * L, u1 = ((i + 1) / n) * L, h0 = hs[i], h1 = hs[i + 1];
      for (const [key, z, nz] of [[outKey, zo, 1], [inKey, zi, -1]]) {
        this.exposure = nz > 0 ? 1 : 0;
        this.quad(key, new THREE.Vector3(u0, base, z), new THREE.Vector3(u1, base, z), new THREE.Vector3(u1, h1, z), new THREE.Vector3(u0, h0, z), new THREE.Vector3(0, 0, nz), [[u0 * nz, -base], [u1 * nz, -base], [u1 * nz, -h1], [u0 * nz, -h0]]);
      }
      this.exposure = 1;
      const up = new THREE.Vector3(-(h1 - h0), u1 - u0, 0).normalize();
      this.quad(outKey, new THREE.Vector3(u0, h0, zi), new THREE.Vector3(u1, h1, zi), new THREE.Vector3(u1, h1, zo), new THREE.Vector3(u0, h0, zo), up, [[u0, zi], [u1, zi], [u1, zo], [u0, zo]]);
    }
  }

  build() {
    const out = new Map();
    for (const [key, p] of this.parts) {
      if (!p.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.setAttribute('wear', new THREE.Float32BufferAttribute(p.wear, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
      g.setIndex(p.idx);
      g.computeBoundingBox(); g.computeBoundingSphere();
      out.set(key, g);
    }
    return out;
  }
}

function _up3(x, y, z) { return new THREE.Vector3(x, y, z); }

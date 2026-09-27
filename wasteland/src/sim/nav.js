// Navigation for survivors and the infected: a 2 m grid over the playable land
// with per-cell terrain cost (slope), static obstacles (buildings, water, steep
// ground, tree trunks) and structure flags (solid, wall, gate). A* with a binary
// heap and generation stamps (no clearing between searches), octile moves without
// corner cutting, and line-of-sight smoothing. Walls cost the infected time
// (they break through), survivors climb them slowly and use gates freely.
// A small spatial hash of colliders keeps agents from clipping trunks and corners.
import { WATER_LEVEL } from '../world/layout.js';

export const F_BLOCK = 1, F_WALL = 2, F_GATE = 4, F_WATER = 8, F_TREE = 16, F_STRUCT = 32;
const SQ2 = Math.SQRT2;

export class NavGrid {
  constructor(terrain, { half = 256, cell = 2 } = {}) {
    this.terrain = terrain;
    this.half = half;
    this.cell = cell;
    this.n = Math.round((half * 2) / cell);
    const N = this.n * this.n;
    this.base = new Uint8Array(N);
    this.flags = new Uint8Array(N);
    this.owner = new Int32Array(N).fill(-1);
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 1;
    this.heapI = new Int32Array(N * 2);
    this.heapF = new Float32Array(N * 2);
    this.hsize = 0;
    this.stats = { searches: 0, expanded: 0, ms: 0 };
  }

  /** Terrain cost and static obstacles. colliders: [{x,z,r}|{x,z,hw,hd,rot}] */
  build(colliders) {
    const { n, cell, half, terrain: t } = this;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = -half + (ix + 0.5) * cell, z = -half + (iz + 0.5) * cell;
      const i = iz * n + ix;
      const h = t.height(x, z);
      if (h < WATER_LEVEL + 0.35) { this.flags[i] |= F_WATER; this.base[i] = 0; continue; }
      // slope from central differences (1 m)
      const dx = t.height(x + 1, z) - t.height(x - 1, z), dz = t.height(x, z + 1) - t.height(x, z - 1);
      const slope = Math.hypot(dx, dz) / 2;
      if (slope > 0.9 || ix === 0 || iz === 0 || ix === n - 1 || iz === n - 1) { this.base[i] = 0; this.flags[i] |= F_BLOCK; continue; }
      this.base[i] = Math.min(40, 1 + Math.round(slope * slope * 14));
    }
    for (const c of colliders) {
      if (c.r !== undefined) {
        if (c.r < 0.55) { const i = this.cellOf(c.x, c.z); if (i >= 0) this.flags[i] |= F_TREE; }
        else this.#disc(c.x, c.z, c.r, F_BLOCK);
      } else this.rect(c.x, c.z, c.hw * 2, c.hd * 2, c.rot, F_BLOCK, -1, 0.35);
    }
  }

  cellOf(x, z) {
    const ix = Math.floor((x + this.half) / this.cell), iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }
  cx(i) { return -this.half + ((i % this.n) + 0.5) * this.cell; }
  cz(i) { return -this.half + (Math.floor(i / this.n) + 0.5) * this.cell; }

  #disc(x, z, r, flag) {
    const c = this.cell;
    for (let dz = -r; dz <= r + 0.01; dz += c * 0.5) for (let dx = -r; dx <= r + 0.01; dx += c * 0.5) {
      if (dx * dx + dz * dz > r * r) continue;
      const i = this.cellOf(x + dx, z + dz);
      if (i >= 0) this.flags[i] |= flag;
    }
  }

  /** Mark cells whose centres fall in a rotated rectangle (rot = yaw of the local +Z axis). */
  rect(x, z, w, d, rot, flag, owner = -1, pad = 0.2) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const ext = Math.hypot(w, d) / 2 + pad + this.cell;
    const hw = w / 2 + pad, hd = d / 2 + pad;
    let marked = 0;
    for (let zz = z - ext; zz <= z + ext; zz += this.cell) for (let xx = x - ext; xx <= x + ext; xx += this.cell) {
      const i = this.cellOf(xx, zz);
      if (i < 0) continue;
      const px = this.cx(i) - x, pz = this.cz(i) - z;
      // world -> local (inverse yaw)
      const lx = px * cs - pz * sn, lz = px * sn + pz * cs;
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) { this.flags[i] |= flag; if (owner >= 0) this.owner[i] = owner; marked++; }
    }
    if (!marked) { const i = this.cellOf(x, z); if (i >= 0) { this.flags[i] |= flag; if (owner >= 0) this.owner[i] = owner; } }
  }

  /** Supercover line: every cell a segment touches (walls must not leak diagonally). */
  line(x0, z0, x1, z1, flag, owner = -1) {
    const c = this.cell, h = this.half;
    let fx = (x0 + h) / c, fz = (z0 + h) / c;
    const tx = (x1 + h) / c, tz = (z1 + h) / c;
    let ix = Math.floor(fx), iz = Math.floor(fz);
    const ex = Math.floor(tx), ez = Math.floor(tz);
    const dx = tx - fx, dz = tz - fz;
    const sx = Math.sign(dx), sz = Math.sign(dz);
    const tdx = sx ? Math.abs(1 / dx) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tmx = sx > 0 ? (ix + 1 - fx) * tdx : sx < 0 ? (fx - ix) * tdx : Infinity;
    let tmz = sz > 0 ? (iz + 1 - fz) * tdz : sz < 0 ? (fz - iz) * tdz : Infinity;
    const mark = (a, b) => { if (a < 0 || b < 0 || a >= this.n || b >= this.n) return; const i = b * this.n + a; this.flags[i] |= flag; if (owner >= 0) this.owner[i] = owner; };
    mark(ix, iz);
    for (let guard = 0; guard < 400 && (ix !== ex || iz !== ez); guard++) {
      if (Math.abs(tmx - tmz) < 1e-9) { mark(ix + sx, iz); mark(ix, iz + sz); ix += sx; iz += sz; tmx += tdx; tmz += tdz; }
      else if (tmx < tmz) { ix += sx; tmx += tdx; }
      else { iz += sz; tmz += tdz; }
      mark(ix, iz);
    }
  }

  /** Remove structure flags owned by id. */
  clearOwner(id) {
    const f = this.flags, o = this.owner;
    for (let i = 0; i < o.length; i++) if (o[i] === id) { o[i] = -1; f[i] &= ~(F_STRUCT | F_WALL | F_GATE); }
  }

  cost(i, agent) {
    const f = this.flags[i];
    if (f & (F_BLOCK | F_WATER | F_STRUCT)) return 0;
    let c = this.base[i];
    if (!c) return 0;
    if (f & F_TREE) c += 3;
    if (f & F_WALL) c += agent === 'z' ? 22 : 45;
    else if (f & F_GATE) c += agent === 'z' ? 20 : 0;
    return c;
  }
  walkable(x, z, agent = 's') { const i = this.cellOf(x, z); return i >= 0 && this.cost(i, agent) > 0; }

  nearestFree(i, agent, maxR = 12) {
    if (i < 0) return -1;
    if (this.cost(i, agent) > 0) return i;
    const n = this.n, ix = i % n, iz = Math.floor(i / n);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const a = ix + dx, b = iz + dz;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const j = b * n + a;
        if (this.cost(j, agent) > 0) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = j; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  #push(i, f) {
    let k = this.hsize++;
    const I = this.heapI, F = this.heapF;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= f) break;
      I[k] = I[p]; F[k] = F[p]; k = p;
    }
    I[k] = i; F[k] = f;
  }
  #pop() {
    const I = this.heapI, F = this.heapF;
    const top = I[0];
    const n = --this.hsize;
    if (n > 0) {
      const li = I[n], lf = F[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        I[k] = I[c]; F[k] = F[c]; k = c;
      }
      I[k] = li; F[k] = lf;
    }
    return top;
  }

  /**
   * Path from (sx,sz) to (tx,tz) for agent 's' (survivor) or 'z' (infected).
   * Returns [{x,z,wall}] waypoints (smoothed) or null. With partial=true an
   * unreachable goal yields the path to the closest reachable cell.
   */
  findPath(sx, sz, tx, tz, agent = 's', { maxIter = 60000, partial = true } = {}) {
    const t0 = performance.now();
    const n = this.n;
    const s = this.nearestFree(this.cellOf(sx, sz), agent), t = this.nearestFree(this.cellOf(tx, tz), agent);
    if (s < 0 || t < 0) return null;
    if (s === t) return [{ x: tx, z: tz }];
    const gen = ++this.gen;
    const G = this.g, P = this.parent, ST = this.stamp, CL = this.closed;
    const tix = t % n, tiz = (t / n) | 0;
    const h = (i) => { const dx = Math.abs((i % n) - tix), dz = Math.abs(((i / n) | 0) - tiz); return (dx + dz + (SQ2 - 2) * Math.min(dx, dz)); };
    this.hsize = 0;
    G[s] = 0; P[s] = -1; ST[s] = gen;
    this.#push(s, h(s));
    let best = s, bestH = h(s), iter = 0, found = false;
    const OFF = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (this.hsize > 0 && iter < maxIter) {
      const i = this.#pop();
      if (CL[i] === gen) continue;
      CL[i] = gen;
      iter++;
      if (i === t) { found = true; break; }
      const hi = h(i);
      if (hi < bestH) { bestH = hi; best = i; }
      const ix = i % n, iz = (i / n) | 0;
      const ci = this.cost(i, agent);
      for (let k = 0; k < 8; k++) {
        const ax = ix + OFF[k][0], az = iz + OFF[k][1];
        if (ax < 0 || az < 0 || ax >= n || az >= n) continue;
        const j = az * n + ax;
        if (CL[j] === gen) continue;
        const cj = this.cost(j, agent);
        if (!cj) continue;
        let step = 1;
        if (k >= 4) {
          // no corner cutting past blocked or wall cells
          const a = iz * n + ax, b = az * n + ix;
          const ca = this.cost(a, agent), cb = this.cost(b, agent);
          if (!ca || !cb || (this.flags[a] & (F_WALL | F_GATE)) || (this.flags[b] & (F_WALL | F_GATE))) continue;
          step = SQ2;
        }
        const ng = G[i] + step * (ci + cj) * 0.5;
        if (ST[j] !== gen || ng < G[j]) {
          ST[j] = gen; G[j] = ng; P[j] = i;
          this.#push(j, ng + h(j));
        }
      }
    }
    this.stats.searches++; this.stats.expanded += iter;
    let end = found ? t : partial ? best : -1;
    if (end < 0 || end === s) { this.stats.ms += performance.now() - t0; return end === s && found ? [{ x: tx, z: tz }] : null; }
    const cells = [];
    for (let i = end, guard = 0; i >= 0 && guard < 100000; i = P[i], guard++) cells.push(i);
    cells.reverse();
    const pts = this.#smooth(cells, agent);
    if (found) { const last = pts[pts.length - 1]; if (!last.wall) { last.x = tx; last.z = tz; } }
    this.stats.ms += performance.now() - t0;
    return pts;
  }

  #smooth(cells, agent) {
    const out = [];
    const W = F_WALL | F_GATE;
    let a = 0;
    const pt = (i) => ({ x: this.cx(i), z: this.cz(i), wall: (this.flags[i] & W) ? this.owner[i] : undefined, climb: agent === 's' && (this.flags[i] & F_WALL) ? true : undefined });
    for (let i = 1; i < cells.length; i++) {
      const isWall = (this.flags[cells[i]] & W) !== 0;
      if (isWall) { if (i - 1 > a) out.push(pt(cells[i - 1])); out.push(pt(cells[i])); a = i; continue; }
      if (i - a > 1 && !this.los(cells[a], cells[i], agent)) { out.push(pt(cells[i - 1])); a = i - 1; }
    }
    out.push(pt(cells[cells.length - 1]));
    return out;
  }

  /** Grid line of sight between two cells: no blocked, wall or much costlier cells. */
  los(i0, i1, agent) {
    const n = this.n;
    let x0 = i0 % n, z0 = (i0 / n) | 0;
    const x1 = i1 % n, z1 = (i1 / n) | 0;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    const c0 = Math.max(this.cost(i0, agent), this.cost(i1, agent));
    for (let guard = 0; guard < 600; guard++) {
      const i = z0 * n + x0;
      const c = this.cost(i, agent);
      if (!c || (this.flags[i] & (F_WALL | F_GATE)) || c > c0 + 4) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz && e2 < dx) {
        // diagonal step: both side cells must be open
        const a = z0 * n + x0 + sx, b = (z0 + sz) * n + x0;
        if (!this.cost(a, agent) || !this.cost(b, agent)) return false;
      }
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
    return false;
  }

  /** Random walkable point within r of (x, z). */
  randomNear(x, z, r, rng, agent = 's', tries = 16) {
    for (let k = 0; k < tries; k++) {
      const a = rng.float(0, Math.PI * 2), d = Math.sqrt(rng.next()) * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (this.walkable(px, pz, agent)) return { x: px, z: pz };
    }
    return null;
  }
}

/** Spatial hash of static colliders for local push-out. */
export class ColliderHash {
  constructor(size = 8) { this.size = size; this.map = new Map(); }
  #key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(c) {
    const r = c.r !== undefined ? c.r : Math.hypot(c.hw, c.hd);
    const s = this.size;
    for (let iz = Math.floor((c.z - r) / s); iz <= Math.floor((c.z + r) / s); iz++)
      for (let ix = Math.floor((c.x - r) / s); ix <= Math.floor((c.x + r) / s); ix++) {
        const k = this.#key(ix, iz);
        let b = this.map.get(k);
        if (!b) { b = []; this.map.set(k, b); }
        b.push(c);
      }
  }
  remove(c) { for (const b of this.map.values()) { const i = b.indexOf(c); if (i >= 0) b.splice(i, 1); } }
  /** True if a circle of radius rad at (x, z) overlaps any collider. */
  blocked(x, z, rad = 0.3) {
    const b = this.map.get(this.#key(Math.floor(x / this.size), Math.floor(z / this.size)));
    if (!b) return false;
    for (const c of b) {
      if (c.r !== undefined) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + rad) ** 2) return true; }
      else {
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot), dx = x - c.x, dz = z - c.z;
        if (Math.abs(dx * cs - dz * sn) < c.hw + rad && Math.abs(dx * sn + dz * cs) < c.hd + rad) return true;
      }
    }
    return false;
  }

  /** Push point p (with radius rad) out of any overlapping collider. */
  resolve(p, rad = 0.3) {
    const b = this.map.get(this.#key(Math.floor(p.x / this.size), Math.floor(p.z / this.size)));
    if (!b) return;
    for (const c of b) {
      if (c.r !== undefined) {
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + rad;
        if (d < m && d > 1e-4) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
      } else {
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const dx = p.x - c.x, dz = p.z - c.z;
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const ox = c.hw + rad - Math.abs(lx), oz = c.hd + rad - Math.abs(lz);
        if (ox > 0 && oz > 0) {
          let nx = lx, nz = lz;
          if (ox < oz) nx = Math.sign(lx || 1) * (c.hw + rad); else nz = Math.sign(lz || 1) * (c.hd + rad);
          p.x = c.x + nx * cs + nz * sn; p.z = c.z - nx * sn + nz * cs;
        }
      }
    }
  }
}

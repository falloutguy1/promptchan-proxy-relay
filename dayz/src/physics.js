// Minimal static collision world for a walking player:
//  - 2D oriented boxes / circles with a vertical extent (walls, trunks, props)
//  - walkable surfaces (floors, steps) that override terrain height
// A uniform grid keeps queries local.

const CELL = 8;

export class Collision {
  constructor(hf) {
    this.hf = hf;
    this.grid = new Map();
    this.floors = [];
    this.dynamic = new Set();
  }
  _key(i, j) { return i * 73856093 ^ j * 19349663; }
  _insert(shape) {
    const b = shape.bounds;
    for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++)
      for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) {
        const k = this._key(i, j);
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(shape);
      }
  }
  /** Oriented box: centre (x,z), half extents (hx,hz), rotation ry, vertical span [y0,y1]. */
  box(x, z, hx, hz, ry, y0, y1, tag) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const ex = Math.abs(c * hx) + Math.abs(s * hz), ez = Math.abs(s * hx) + Math.abs(c * hz);
    const shape = { type: 'box', x, z, hx, hz, c, s, y0, y1, tag, enabled: true, bounds: [x - ex, z - ez, x + ex, z + ez] };
    this._insert(shape);
    return shape;
  }
  circle(x, z, r, y0, y1, tag) {
    const shape = { type: 'circle', x, z, r, y0, y1, tag, enabled: true, bounds: [x - r, z - r, x + r, z + r] };
    this._insert(shape);
    return shape;
  }
  /** Walkable horizontal surface (oriented rectangle) at height y. */
  floor(x, z, hx, hz, ry, y) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const f = { x, z, hx, hz, c, s, y };
    this.floors.push(f);
    return f;
  }
  groundHeight(x, z, feetY, step = 0.4) {
    let g = this.hf.height(x, z);
    for (const f of this.floors) {
      const dx = x - f.x, dz = z - f.z;
      const lx = f.c * dx + f.s * dz, lz = -f.s * dx + f.c * dz;
      if (Math.abs(lx) <= f.hx && Math.abs(lz) <= f.hz && f.y <= feetY + step && f.y > g) g = f.y;
    }
    return g;
  }
  near(x, z) {
    return this.grid.get(this._key(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
  }
  /** Push a circle (player) out of all overlapping shapes. Mutates p {x,z}. */
  resolve(p, radius, y0, y1) {
    const seen = new Set();
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const list = this.grid.get(this._key(Math.floor(p.x / CELL) + di, Math.floor(p.z / CELL) + dj));
        if (!list) continue;
        for (const s of list) {
          if (!s.enabled || s.y1 < y0 || s.y0 > y1) continue;
          if (iter === 0) seen.add(s);
          if (s.type === 'circle') {
            const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), m = s.r + radius;
            if (d < m && d > 1e-6) { p.x += (dx / d) * (m - d); p.z += (dz / d) * (m - d); moved = true; }
          } else {
            const dx = p.x - s.x, dz = p.z - s.z;
            const lx = s.c * dx + s.s * dz, lz = -s.s * dx + s.c * dz;
            const qx = Math.max(-s.hx, Math.min(s.hx, lx)), qz = Math.max(-s.hz, Math.min(s.hz, lz));
            let nx = lx - qx, nz = lz - qz, d = Math.hypot(nx, nz);
            if (d < radius) {
              let push;
              if (d < 1e-6) { // centre inside the box: exit along the shallowest axis
                const ox = s.hx - Math.abs(lx), oz = s.hz - Math.abs(lz);
                if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; push = ox + radius; } else { nx = 0; nz = Math.sign(lz) || 1; push = oz + radius; }
              } else { nx /= d; nz /= d; push = radius - d; }
              const wx = s.c * nx - s.s * nz, wz = s.s * nx + s.c * nz;
              p.x += wx * push; p.z += wz * push; moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
  }
  /** Ray (2D, horizontal) vs shapes — used for interaction line-of-sight checks. */
}

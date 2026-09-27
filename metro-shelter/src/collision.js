// Lightweight collision world: analytic walkable regions + axis-aligned boxes + stepped floor boxes.
import { L, EDGE, WALL, TRACK_Y, TRACK_X, TUN_HW, TUN_END } from './layout.js';

class Collision {
  constructor() {
    this.boxes = [];   // solid: {x0,x1,z0,z1,y0,y1}
    this.floors = [];  // walkable tops: {x0,x1,z0,z1,y}
  }
  addBox(x0, x1, z0, z1, y0 = 0, y1 = 3) { const b = { x0, x1, z0, z1, y0, y1 }; this.boxes.push(b); return b; }
  addFloor(x0, x1, z0, z1, y) { this.floors.push({ x0, x1, z0, z1, y }); }

  // Base walkable height from the architecture, or null outside the station.
  baseFloor(x, z) {
    const ax = Math.abs(x), az = Math.abs(z);
    if (az <= L - 0.05) {
      if (ax <= EDGE) return 0;
      if (ax <= WALL - 0.05) return TRACK_Y;
      return null;
    }
    if (az <= TUN_END - 0.5 && Math.abs(ax - TRACK_X) <= TUN_HW - 0.05) return TRACK_Y;
    return null;
  }

  // Highest floor at (x,z) that is not above `maxY`.
  floorAt(x, z, maxY = Infinity) {
    let h = this.baseFloor(x, z);
    if (h === null) return null;
    if (Math.abs(x) > EDGE && Math.abs(x) < EDGE + 0.02) h = 0; // lip of the platform
    for (const f of this.floors) {
      if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.y <= maxY && f.y > h) h = f.y;
    }
    return h;
  }

  // Is a vertical cylinder (radius r) standing at feet height y with height hgt free?
  free(x, z, r, y, hgt = 1.7) {
    // Must be inside the walkable region at all four extremes.
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (this.baseFloor(x + dx, z + dz) === null) return false;
    }
    for (const b of this.boxes) {
      if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1 && y + hgt > b.y0 && y + 0.35 < b.y1) return false;
    }
    return true;
  }
}

export const collision = new Collision();

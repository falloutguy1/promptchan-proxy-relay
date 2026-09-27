// Geometry helpers. All UVs are in metres so materials tile at real-world scale.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

// Extrude a 2D polyline (x,y) along world Z from z0 to z1.
// The visible side is the LEFT of the direction of travel along the polyline.
// Corners sharper than `sharpDeg` get split normals; smooth runs are shaded smoothly.
export function extrudeProfile(pts, z0, z1, { sharpDeg = 35, uOffset = 0 } = {}) {
  const n = pts.length;
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    segN.push([-dy / l, dx / l]);
  }
  // Build a list of "rings" (profile vertices) with normals; split at sharp corners.
  const ring = []; // {x,y,nx,ny,u}
  let u = uOffset;
  const cosSharp = Math.cos(THREE.MathUtils.degToRad(sharpDeg));
  for (let i = 0; i < n; i++) {
    if (i > 0) u += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const a = segN[i - 1], b = segN[i];
    if (a && b) {
      const dot = a[0] * b[0] + a[1] * b[1];
      if (dot < cosSharp) {
        ring.push({ x: pts[i][0], y: pts[i][1], nx: a[0], ny: a[1], u, end: true });
        ring.push({ x: pts[i][0], y: pts[i][1], nx: b[0], ny: b[1], u, start: true });
      } else {
        const nx = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nx, ny) || 1;
        ring.push({ x: pts[i][0], y: pts[i][1], nx: nx / l, ny: ny / l, u });
      }
    } else {
      const s = a || b;
      ring.push({ x: pts[i][0], y: pts[i][1], nx: s[0], ny: s[1], u });
    }
  }
  const pos = [], nor = [], uv = [], idx = [];
  for (const r of ring) {
    pos.push(r.x, r.y, z0, r.x, r.y, z1);
    nor.push(r.nx, r.ny, 0, r.nx, r.ny, 0);
    uv.push(r.u, z0, r.u, z1);
  }
  for (let i = 0; i < ring.length - 1; i++) {
    if (ring[i].end) continue; // split point: no quad between the duplicate pair
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    // Winding so the left-side normal faces the camera.
    if (z1 > z0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Ellipse arc points from angle a0 to a1 (radians), centre (cx,cy), radii (rx,ry).
export function arc(cx, cy, rx, ry, a0, a1, segs) {
  const out = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (a1 - a0) * (i / segs);
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// Sweep a small 2D cross-section along a 2D path lying in the XY plane at depth z.
// profile points (a,b): a = offset along the path's left normal, b = offset along +Z.
export function sweepXY(path, profile, z, { closedProfile = true } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  const P = profile.length;
  let along = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const q = path[Math.min(i + 1, path.length - 1)], o = path[Math.max(i - 1, 0)];
    const tx = q[0] - o[0], ty = q[1] - o[1], tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl, ny = tx / tl;
    if (i > 0) along += Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]);
    let across = 0;
    for (let j = 0; j < P; j++) {
      const [a, b] = profile[j];
      pos.push(p[0] + nx * a, p[1] + ny * a, z + b);
      if (j > 0) across += Math.hypot(a - profile[j - 1][0], b - profile[j - 1][1]);
      uv.push(along, across);
      nor.push(0, 0, 0);
    }
  }
  const cols = closedProfile ? P : P - 1;
  for (let i = 0; i < path.length - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % P;
      const a = i * P + j, b = i * P + j2, c = (i + 1) * P + j, d = (i + 1) * P + j2;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const worldUV = {
  generateTopUV(geometry, v, a, b, c) {
    return [new THREE.Vector2(v[a * 3], v[a * 3 + 1]), new THREE.Vector2(v[b * 3], v[b * 3 + 1]), new THREE.Vector2(v[c * 3], v[c * 3 + 1])];
  },
  generateSideWallUV(geometry, v, a, b, c, d) {
    const ax = v[a * 3], ay = v[a * 3 + 1], az = v[a * 3 + 2];
    const bx = v[b * 3], by = v[b * 3 + 1], bz = v[b * 3 + 2];
    const cx = v[c * 3], cy = v[c * 3 + 1], cz = v[c * 3 + 2];
    const dx = v[d * 3], dy = v[d * 3 + 1], dz = v[d * 3 + 2];
    if (Math.abs(ay - by) < Math.abs(ax - bx)) {
      return [new THREE.Vector2(ax, 1 - az), new THREE.Vector2(bx, 1 - bz), new THREE.Vector2(cx, 1 - cz), new THREE.Vector2(dx, 1 - dz)];
    }
    return [new THREE.Vector2(ay, 1 - az), new THREE.Vector2(by, 1 - bz), new THREE.Vector2(cy, 1 - cz), new THREE.Vector2(dy, 1 - dz)];
  },
};

// Extrude a THREE.Shape `depth` metres along +Z with rounded (bevelled) edges and metric UVs.
export function extrudeShape(shape, depth, bevel = 0.02, curveSegments = 16) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 0.001), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments, UVGenerator: worldUV,
  });
  g.translate(0, 0, bevel);
  return g;
}

// Bevelled box centred on the origin (w along X, h along Y, d along Z).
export function bevelBox(w, h, d, r = 0.015) {
  r = Math.min(r, w / 3, h / 3, d / 3);
  const s = new THREE.Shape();
  const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
  s.moveTo(x0, y0);
  s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
  const g = extrudeShape(s, d, r, 2);
  g.translate(0, 0, -d / 2);
  return g;
}

// A corrugated sheet in the XY plane (width w along X, height h along Y), corrugations run along Y.
export function corrugatedSheet(w, h, pitch = 0.076, depth = 0.018) {
  const pts = [];
  const n = Math.max(2, Math.round(w / pitch * 6));
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + (w * i) / n;
    pts.push([x, Math.sin((x / pitch) * Math.PI * 2) * depth * 0.5]);
  }
  // Profile in (x, z); extrude along y.
  const pos = [], nor = [], uv = [], idx = [];
  let u = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    if (i > 0) u += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const dz = Math.cos((x / pitch) * Math.PI * 2) * depth * 0.5 * Math.PI * 2 / pitch;
    const l = Math.hypot(dz, 1);
    for (const y of [-h / 2, h / 2]) {
      pos.push(x, y, z); nor.push(-dz / l, 0, 1 / l); uv.push(u, y);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Irregular mound (rubble, spoil) of radius r and height h, displaced with seeded noise.
export function mound(r, h, seed = 1, segs = 40) {
  const geo = new THREE.PlaneGeometry(r * 2, r * 2, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bumps = Array.from({ length: 26 }, () => [(rnd() * 2 - 1) * r * 0.8, (rnd() * 2 - 1) * r * 0.8, 0.15 + rnd() * 0.35, 0.1 + rnd() * 0.25]);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x, z) / r;
    let y = d < 1 ? Math.pow(Math.cos(d * Math.PI / 2), 1.6) * h : -0.05;
    for (const [bx, bz, br, bh] of bumps) {
      const dd = Math.hypot(x - bx, z - bz) / (br * r);
      if (dd < 1 && d < 1) y += (1 - dd * dd) * bh * h * 0.35;
    }
    p.setY(i, y);
  }
  geo.computeVertexNormals();
  // Metric UVs from XZ.
  const uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
  return geo;
}

export function merged(geos) {
  const g = mergeGeometries(geos.map((x) => (x.index ? x : mergeVertices(x))), false);
  geos.forEach((x) => x.dispose());
  return g;
}

export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

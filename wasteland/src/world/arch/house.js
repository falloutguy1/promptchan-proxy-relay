// Rural house generator (Eastern-European village type): plastered masonry walls
// with real thickness on a concrete plinth, recessed window assemblies (frame,
// casements, transom, glass, projecting sill, interior board), panel doors, gable
// roof with eaves/verge overhang, fascia, corrugated sheeting, ridge cap, gutters
// and downpipes, brick chimney, interior floor/ceiling/partition. Condition drives
// broken glass, boarded windows, missing roof sheets and exposed rafters.
import * as THREE from 'three';
import { Geo } from './geom.js';
import { ARCH_SETS } from './materials.js';

export const TILES = { ...ARCH_SETS, glass: 1, dark: 1, decal_leak: 1 };

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export const HOUSE_STYLES = {
  plaster: { wall: 'plaster_mossy', tint: '#e8e4da', roof: 'roof_asbestos', frame: '#dcd8cc', plinth: 'concrete' },
  ochre: { wall: 'plaster_ochre', tint: '#ffffff', roof: 'roof_tiles', frame: '#6f8a9a', plinth: 'concrete' },
  brick: { wall: 'brick_red', tint: '#ffffff', roof: 'roof_asbestos', frame: '#7b5b3e', plinth: 'concrete' },
  damaged: { wall: 'plaster_damaged', tint: '#f2eee6', roof: 'corr_rust', frame: '#8a9a78', plinth: 'concrete' },
};

/**
 * Builds a house in local space (front door faces +Z, ground at y = 0).
 * Returns { geo: Map(matKey -> BufferGeometry), furniture: [{kind,x,z,rot}], colliders, anchors }
 */
export function buildHouse(p, rng) {
  const style = HOUSE_STYLES[p.variant] || HOUSE_STYLES.plaster;
  const cond = p.condition ?? 0.6;
  const W = p.w, D = p.d, floors = p.floors || 1;
  const t = 0.38, plinth = 0.45, fh = 2.75;
  const wallTop = plinth + floors * fh;
  const pitch = THREE.MathUtils.degToRad(rng.float(34, 40));
  const eave = 0.5, verge = 0.35;
  const g = new Geo(TILES);
  const ruined = cond < 0.2 || p.ruined;
  const WALL = ruined ? `${style.wall}:#8f887c` : `${style.wall}:${style.tint}`, IN = ruined ? 'wall_interior:#5a534b' : 'wall_interior', FRAME = `wood_painted:${style.frame}`;
  const furniture = [], colliders = [], anchors = { door: null, windows: [] };

  // --- foundation / plinth
  g.exposure = 1;
  g.box(style.plinth, 0, (plinth - 1.2) / 2, 0, W + 0.1, plinth + 1.2, D + 0.1, 0.02);

  // --- openings layout per wall
  const doorW = 0.96, doorH = 2.08;
  const win = { w: rng.float(1.2, 1.4), h: 1.45, sill: 0.88 };
  const layoutWall = (L, withDoor, nWin) => {
    const ops = [];
    const slots = nWin + (withDoor ? 1 : 0);
    const doorSlot = withDoor ? Math.floor(slots / 2 + (rng.next() < 0.5 ? 0 : -0.5)) : -1;
    for (let s = 0; s < slots; s++) {
      const c = (L * (s + 0.5)) / slots;
      for (let f = 0; f < floors; f++) {
        const base = f * fh;
        if (s === doorSlot && f === 0) ops.push({ u0: c - doorW / 2, u1: c + doorW / 2, v0: 0, v1: doorH, door: true });
        else if (s !== doorSlot || f > 0) ops.push({ u0: c - win.w / 2, u1: c + win.w / 2, v0: base + win.sill, v1: base + win.sill + win.h, win: true, floor: f });
      }
    }
    return ops;
  };
  const walls = [
    // name, frame (x, z, rotY), length, openings
    { name: 'front', x: -W / 2, z: D / 2 - t / 2, ry: 0, L: W, ops: layoutWall(W, true, W > 9.5 ? 3 : 2), ends: true },
    { name: 'back', x: W / 2, z: -D / 2 + t / 2, ry: Math.PI, L: W, ops: layoutWall(W, false, 2), ends: true },
    { name: 'right', x: W / 2 - t / 2, z: D / 2 - t, ry: Math.PI / 2, L: D - 2 * t, ops: layoutWall(D - 2 * t, false, 1), ends: false },
    { name: 'left', x: -W / 2 + t / 2, z: -D / 2 + t, ry: -Math.PI / 2, L: D - 2 * t, ops: layoutWall(D - 2 * t, false, 1), ends: false },
  ];

  for (const w of walls) {
    g.pushTRS(w.x, plinth, w.z, w.ry);
    g.exposure = 1;
    if (ruined) {
      // collapsed upper walls: stop above the openings, jagged broken masonry above
      const base = Math.max(...w.ops.map((o) => o.v1), 1.6) + 0.12;
      g.wall(WALL, IN, w.L, base, t, w.ops, { top: false, ends: w.ends });
      g.jaggedTop(WALL, IN, w.L, base, t, rng, rng.float(0.4, 1.3));
    } else g.wall(WALL, IN, w.L, floors * fh, t, w.ops, { top: true, ends: w.ends });
    for (const o of w.ops) {
      if (o.win) windowAssembly(g, o, t, rng, cond, FRAME, anchors, w);
      if (o.door) { doorAssembly(g, o, t, rng, cond, FRAME, anchors); anchors.door.x = -W / 2 + anchors.door.u; }
    }
    // gables on the side walls (ridge runs along X)
    if (!ruined && (w.name === 'right' || w.name === 'left')) {
      g.pushTRS(-t, 0, 0);
      g.gable(WALL, IN, w.L + 2 * t, floors * fh, (D / 2) * Math.tan(pitch), t);
      g.pop();
    }
    g.pop();
  }

  // --- floor, ceiling, partition
  g.exposure = 0;
  g.box('floor_wood', 0, plinth - 0.03, 0, W - 2 * t, 0.06, D - 2 * t, 0);
  for (let f = 1; f <= floors && !ruined; f++) {
    g.rect(IN, 'y', plinth + f * fh - 0.001, -W / 2 + t, W / 2 - t, -D / 2 + t, D / 2 - t, -1);
    if (f < floors) g.box('floor_wood', 0, plinth + f * fh + 0.03, 0, W - 2 * t, 0.06, D - 2 * t, 0);
  }
  const px = rng.float(-0.8, 0.8);
  g.pushTRS(px, plinth, D / 2 - t, Math.PI / 2);
  g.wall(IN, IN, D - 2 * t, fh - 0.01, 0.12, [{ u0: 1.0, u1: 1.85, v0: 0, v1: 2.02 }], { top: false, ends: true });
  g.pop();
  // furniture slots (placed later from Poly Haven models)
  const leftRoom = { x0: -W / 2 + t, x1: px - 0.12, z0: -D / 2 + t, z1: D / 2 - t };
  const rightRoom = { x0: px + 0.12, x1: W / 2 - t, z0: -D / 2 + t, z1: D / 2 - t };
  furniture.push(
    { kind: 'old_bed_frame', x: (leftRoom.x0 + leftRoom.x1) / 2, z: leftRoom.z0 + 1.2, rot: 0, y: plinth },
    { kind: 'painted_wooden_cabinet', x: leftRoom.x0 + 0.35, z: (leftRoom.z0 + leftRoom.z1) / 2 + 0.6, rot: Math.PI / 2, y: plinth },
    { kind: 'scandinavian_masonry_heater', x: rightRoom.x1 - 0.6, z: rightRoom.z0 + 0.7, rot: 0, y: plinth },
    { kind: 'WoodenTable_01', x: (rightRoom.x0 + rightRoom.x1) / 2, z: (rightRoom.z0 + rightRoom.z1) / 2 + 0.3, rot: rng.float(-0.3, 0.3), y: plinth },
    { kind: 'WoodenChair_01', x: (rightRoom.x0 + rightRoom.x1) / 2 + 0.7, z: (rightRoom.z0 + rightRoom.z1) / 2 + 0.2, rot: rng.float(1, 2.4), y: plinth, tipped: rng.next() > cond },
    { kind: 'wooden_bookshelf_worn', x: rightRoom.x0 + 0.3, z: rightRoom.z1 - 1.2, rot: Math.PI / 2, y: plinth },
  );

  if (ruined) {
    g.exposure = 1;
    // charred rafters fallen into the shell, rubble heaps of brick and plaster
    for (let i = 0; i < 6; i++) {
      const x = rng.float(-W / 2 + 1, W / 2 - 1);
      g.beam('wood_weathered:#3b3530', V3(x, plinth + rng.float(0, 0.4), rng.float(-D / 2 + 0.8, 0)), V3(x + rng.float(-1.5, 1.5), plinth + rng.float(1.2, 2.6), rng.float(0, D / 2 - 0.6)), 0.12, 0.16, 0.02, rng.float(0, 1));
    }
    for (let i = 0; i < 40; i++) {
      const inside = i < 26;
      const x = inside ? rng.float(-W / 2 + 0.8, W / 2 - 0.8) : rng.float(-W / 2 - 1.5, W / 2 + 1.5) ;
      const z = inside ? rng.float(-D / 2 + 0.8, D / 2 - 0.8) : (rng.next() < 0.5 ? -1 : 1) * rng.float(D / 2 + 0.3, D / 2 + 1.6);
      const s = rng.float(0.15, 0.55);
      g.pushTRS(x, (inside ? plinth : 0.05) + s * 0.25, z, rng.float(0, 3), rng.float(-0.4, 0.4), rng.float(-0.4, 0.4));
      g.box(rng.next() < 0.6 ? 'brick_red' : 'concrete', 0, 0, 0, s * rng.float(0.8, 1.6), s * 0.6, s, 0.02);
      g.pop();
    }
    colliders.push({ x: 0, z: 0, hw: W / 2, hd: D / 2, rot: 0 });
    return { geo: g.build(), furniture: [], colliders, anchors, height: wallTop, plinth, ruined: true };
  }

  // --- roof
  const ridgeY = wallTop + (D / 2) * Math.tan(pitch);
  const slopeLen = (D / 2 + eave) / Math.cos(pitch);
  const roofW = W + 2 * verge;
  const ROOF = style.roof;
  const missing = Math.max(0, (0.55 - cond)) * 0.9;
  for (const side of [1, -1]) {
    // local frame: origin at the ridge, x along ridge, z down-slope toward side
    const m = new THREE.Matrix4().compose(V3(0, ridgeY, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, side > 0 ? 0 : Math.PI, 0, 'YXZ')), V3(1, 1, 1));
    g.push(m);
    // structural deck (rafters + sheathing) with painted fascia at the eave
    g.exposure = 1;
    const deckT = 0.16;
    const nSheets = Math.round(roofW / 1.05);
    const sheetW = roofW / nSheets;
    for (let s = 0; s < nSheets; s++) {
      const x0 = -roofW / 2 + s * sheetW;
      const gone = rng.next() < missing;
      if (!gone) g.box(ROOF, x0 + sheetW / 2, 0.02, slopeLen / 2, sheetW + 0.04, 0.025, slopeLen + 0.02, 0.004, null, [x0 + sheetW / 2, 0, slopeLen / 2]);
      else if (rng.next() < 0.5) {
        // hanging, slipped sheet
        g.pushTRS(x0 + sheetW / 2, -0.05, slopeLen * 0.6, 0, 0.25, rng.float(-0.2, 0.2));
        g.box(ROOF, 0, 0, 0, sheetW, 0.025, slopeLen * 0.5, 0.004);
        g.pop();
      }
    }
    // rafters (visible through holes and from below at the eaves)
    for (let x = -W / 2 + 0.3; x <= W / 2; x += 0.9) g.box('wood_weathered', x, -deckT / 2 - 0.02, slopeLen / 2, 0.07, deckT, slopeLen, 0.01);
    // soffit boards under the eave overhang
    const eaveStart = slopeLen - eave / Math.cos(pitch);
    g.box('wood_weathered', 0, -deckT - 0.03, (eaveStart + slopeLen) / 2, roofW, 0.02, slopeLen - eaveStart, 0.005);
    // fascia board at the eave and verge boards
    g.box(FRAME, 0, -deckT / 2, slopeLen + 0.012, roofW + 0.04, deckT + 0.05, 0.03, 0.006);
    for (const sx of [-1, 1]) g.box(FRAME, sx * (roofW / 2 + 0.012), -deckT / 2, slopeLen / 2, 0.03, deckT + 0.05, slopeLen, 0.006);
    // gutter (half-round) + hangers
    const gy = -deckT - 0.02, gz = slopeLen + 0.1;
    halfGutter(g, V3(-roofW / 2, gy, gz), V3(roofW / 2, gy, gz), 0.065);
    g.pop();
    // downpipes at both ends of this eave (world-aligned, straight down the wall)
    const ez = side * (D / 2 + eave - 0.08);
    const ey = wallTop - 0.05;
    for (const sx of [-1, 1]) {
      if (rng.next() < 0.25 && cond < 0.6) continue; // fallen off
      const x = sx * (W / 2 - 0.25);
      const zWall = side * (D / 2 + 0.07);
      g.tube('metal_white:#9ea3a2', [V3(x, ey, ez), V3(x, ey - 0.25, ez), V3(x, ey - 0.5, zWall), V3(x, 0.5, zWall), V3(x, 0.22, zWall + side * 0.18)], 0.045, 10, false);
      for (let y = 1.0; y < ey - 0.6; y += 1.6) g.box('metal_white:#8f9392', x, y, side * (D / 2 + 0.02), 0.1, 0.03, 0.12, 0.004);
    }
  }
  // ridge cap
  g.pushTRS(0, ridgeY + 0.02, 0, 0, 0, 0);
  g.push(new THREE.Matrix4().makeRotationX(Math.PI / 4));
  g.box(ROOF, 0, 0, 0, roofW, 0.2, 0.2, 0.01);
  g.pop(); g.pop();
  // chimney
  if (cond > 0.25) {
    const cx = rng.float(-W * 0.25, W * 0.25), cz = -0.6;
    const topY = ridgeY + 0.7;
    const baseY = wallTop - 0.4;
    g.box('brick_red', cx, (baseY + topY) / 2, cz, 0.55, topY - baseY, 0.55, 0.015);
    g.box('concrete', cx, topY + 0.04, cz, 0.68, 0.08, 0.68, 0.01);
    anchors.chimney = V3(cx, topY + 0.1, cz);
  }

  // --- entrance steps
  const door = anchors.door;
  if (door) {
    for (let i = 0; i < 3; i++) {
      const h = plinth - i * 0.15;
      g.box('concrete', door.x, h / 2 - 0.02, D / 2 + 0.2 + i * 0.3, 1.6 - i * 0.1, h + 0.04, 0.3 + (2 - i) * 0.0, 0.015);
    }
    // small sheet canopy over the door on two brackets
    if (rng.next() < 0.7) {
      g.pushTRS(door.x, plinth + doorH + 0.35, D / 2 + 0.45, 0, -0.18);
      g.box('corr_worn', 0, 0, 0, 1.7, 0.03, 0.95, 0.004);
      g.pop();
      for (const sx of [-0.7, 0.7]) g.beam('metal_white:#6d706e', V3(door.x + sx, plinth + doorH + 0.05, D / 2 + 0.02), V3(door.x + sx, plinth + doorH + 0.3, D / 2 + 0.8), 0.04, 0.04, 0.005);
    }
  }

  colliders.push({ x: 0, z: 0, hw: W / 2, hd: D / 2, rot: 0 });
  return { geo: g.build(), furniture, colliders, anchors, height: ridgeY, plinth };
}

function halfGutter(g, a, b, r) {
  // U-shaped channel: outer + inner surfaces of a half cylinder along a->b
  const key = 'metal_white:#9ea3a2';
  const n = 8, pts = [];
  for (let i = 0; i <= n; i++) {
    const ang = Math.PI + (i / n) * Math.PI; // bottom half
    pts.push([Math.cos(ang) * r, Math.sin(ang) * r]);
  }
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(V3(1, 0, 0), dir.normalize());
  g.push(new THREE.Matrix4().compose(a, q, V3(1, 1, 1)));
  for (let i = 0; i < n; i++) {
    const [z0, y0] = pts[i], [z1, y1] = pts[i + 1];
    const nm = V3(0, (y0 + y1) / 2, (z0 + z1) / 2).normalize();
    g.quad(key, V3(0, y0, z0), V3(len, y0, z0), V3(len, y1, z1), V3(0, y1, z1), nm, [[0, z0], [len, z0], [len, z1], [0, z1]]);
    g.quad(key, V3(0, y0 * 0.92, z0 * 0.92), V3(len, y0 * 0.92, z0 * 0.92), V3(len, y1 * 0.92, z1 * 0.92), V3(0, y1 * 0.92, z1 * 0.92), nm.clone().negate(), [[0, z0], [len, z0], [len, z1], [0, z1]]);
  }
  g.pop();
}

function windowAssembly(g, o, t, rng, cond, FRAME, anchors, wall) {
  const w = o.u1 - o.u0, h = o.v1 - o.v0, cx = (o.u0 + o.u1) / 2;
  const recess = 0.13;                // frame set back from the outer face
  const zf = t / 2 - recess;          // frame plane
  const fw = 0.065, fd = 0.075;       // frame member width/depth
  const boarded = rng.next() > cond + 0.25;
  const broken = rng.next() > cond;
  anchors.windows.push({ wall: wall.name, u: cx, v: o.v1, w, floor: o.floor });
  g.exposure = 1;
  // outer frame
  g.box(FRAME, o.u0 + fw / 2, (o.v0 + o.v1) / 2, zf, fw, h, fd, 0.008);
  g.box(FRAME, o.u1 - fw / 2, (o.v0 + o.v1) / 2, zf, fw, h, fd, 0.008);
  g.box(FRAME, cx, o.v1 - fw / 2, zf, w - 2 * fw, fw, fd, 0.008);
  g.box(FRAME, cx, o.v0 + fw / 2, zf, w - 2 * fw, fw, fd, 0.008);
  // transom and mullion (casement layout)
  const trY = o.v0 + h * 0.7;
  g.box(FRAME, cx, trY, zf, w - 2 * fw, 0.055, fd * 0.9, 0.006);
  g.box(FRAME, cx, (o.v0 + trY) / 2, zf, 0.055, trY - o.v0 - fw, fd * 0.9, 0.006);
  // casement sashes, glazed; one may stand open (opening inward)
  const open = !boarded && rng.next() > cond + 0.2;
  for (const sgn of [-1, 1]) {
    const sx0 = sgn < 0 ? o.u0 + fw : cx + 0.028, sx1 = sgn < 0 ? cx - 0.028 : o.u1 - fw;
    const sw = sx1 - sx0, sh = trY - o.v0 - fw - 0.03;
    const hingeX = sgn < 0 ? sx0 : sx1;
    const dir = sgn < 0 ? 1 : -1;            // local extent direction from the hinge
    const ang = open && sgn > 0 ? -rng.float(0.5, 1.2) : 0;
    g.pushTRS(hingeX, o.v0 + fw + 0.015 + sh / 2, zf + fd / 2 - 0.02, ang);
    const xmin = Math.min(0, dir * sw), xmax = Math.max(0, dir * sw), xc = (xmin + xmax) / 2;
    g.box(FRAME, xmin + 0.0225, 0, 0, 0.045, sh, 0.045, 0.005);
    g.box(FRAME, xmax - 0.0225, 0, 0, 0.045, sh, 0.045, 0.005);
    g.box(FRAME, xc, sh / 2 - 0.0225, 0, sw - 0.09, 0.045, 0.045, 0.005);
    g.box(FRAME, xc, -sh / 2 + 0.0225, 0, sw - 0.09, 0.045, 0.045, 0.005);
    if (!broken || rng.next() < 0.4) g.rect('glass', 'z', 0, xmin + 0.04, xmax - 0.04, -sh / 2 + 0.04, sh / 2 - 0.04, 1);
    g.pop();
  }
  // top light glass
  if (!broken) g.rect('glass', 'z', zf, o.u0 + fw, o.u1 - fw, trY + 0.03, o.v1 - fw, 1);
  // projecting exterior sill (sloped metal) with drip edge, interior board
  g.pushTRS(cx, o.v0 - 0.015, t / 2 - recess / 2 + 0.035, 0, 0.09);
  g.box('metal_white:#b8b6ae', 0, 0, 0, w + 0.12, 0.022, recess + 0.08, 0.004);
  g.pop();
  g.exposure = 0;
  g.box('wood_painted:#d8d3c6', cx, o.v0 - 0.01, -t / 2 + 0.05, w + 0.1, 0.03, 0.2, 0.005);
  g.exposure = 1;
  // rain run-off streaks below the sill (decal, just proud of the plaster)
  const dh = Math.min(o.v0 - 0.05, rng.float(0.8, 1.5));
  if (dh > 0.3) {
    const z = t / 2 + 0.004, u0 = o.u0 - 0.08, u1 = o.u1 + 0.08, v1 = o.v0 - 0.02, v0 = v1 - dh;
    const flip = rng.next() < 0.5;
    g.quad('decal_leak', V3(u0, v0, z), V3(u1, v0, z), V3(u1, v1, z), V3(u0, v1, z), V3(0, 0, 1), [[flip ? 1 : 0, 1], [flip ? 0 : 1, 1], [flip ? 0 : 1, 0], [flip ? 1 : 0, 0]]);
  }
  // boarded up from outside
  if (boarded) {
    const n = rng.int(3, 4);
    for (let i = 0; i < n; i++) {
      const y = o.v0 + 0.15 + (i + 0.5) * ((h - 0.3) / n);
      g.pushTRS(cx + rng.float(-0.04, 0.04), y, t / 2 + 0.02, 0, 0, rng.float(-0.12, 0.12));
      g.box('wood_weathered', 0, 0, 0, w + rng.float(0.15, 0.35), rng.float(0.16, 0.22), 0.025, 0.006);
      g.pop();
    }
  }
}

function doorAssembly(g, o, t, rng, cond, FRAME, anchors) {
  const w = o.u1 - o.u0, h = o.v1 - o.v0, cx = (o.u0 + o.u1) / 2;
  const zf = t / 2 - 0.1;
  g.exposure = 1;
  g.box(FRAME, o.u0 + 0.04, h / 2, zf, 0.08, h, 0.1, 0.008);
  g.box(FRAME, o.u1 - 0.04, h / 2, zf, 0.08, h, 0.1, 0.008);
  g.box(FRAME, cx, h - 0.04, zf, w, 0.08, 0.1, 0.008);
  const state = rng.next();
  const lw = w - 0.1, lh = h - 0.07;
  if (state < 0.8) {
    const ang = state < 0.25 ? 0 : rng.float(0.5, 1.6); // opens inward
    g.pushTRS(o.u0 + 0.06, lh / 2, zf + 0.02, ang);
    g.box(FRAME, lw / 2, 0, 0, lw, lh, 0.045, 0.006);
    // raised panels
    g.box(FRAME, lw / 2, lh * 0.22, 0.026, lw * 0.7, lh * 0.32, 0.012, 0.004);
    g.box(FRAME, lw / 2, -lh * 0.22, 0.026, lw * 0.7, lh * 0.32, 0.012, 0.004);
    g.box('metal_white:#5c5a55', lw - 0.1, 0, 0.04, 0.03, 0.14, 0.03, 0.004);
    g.pop();
  }
  anchors.door = { u: cx, x: 0, open: state >= 0.25 };
}

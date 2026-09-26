import * as THREE from 'three';
import { Builder, wallPieces, box, boxUV } from './geom.js';
import { weather, damage } from './shaderlib.js';
import { WORLD, PAD_Y, FLOOR_Y } from './layout.js';
import { spawnModel } from './spawn.js';

// Single-storey rural brick house, plastered, with an asbestos-cement
// corrugated roof: the kind found all over the post-Soviet countryside.
// Real construction depth: 40 cm walls with plaster reveals, casement windows
// set 12 cm into the wall on concrete sills, boxed eaves, board-clad gables,
// half-round gutters and downpipes, and a furnished three-room interior.

export const HOUSE = {
  W: 10.4, D: 7.6, T: 0.4, TI: 0.12, WH: 2.78, CEIL: 2.6, PITCH: THREE.MathUtils.degToRad(35),
};
const { W, D, T, TI, WH, CEIL } = HOUSE;
const GROUND = PAD_Y - FLOOR_Y; // local y of yard level (≈ -0.62)

// Openings: centre (along the wall axis, in house x or z), width, sill, height
const OPENINGS = {
  S: [
    { c: -3.8, w: 1.2, sill: 0.85, h: 1.4, broken: [1, 0, 0] },
    { c: -1.6, w: 1.0, sill: 0, h: 2.1, door: 'front' },
    { c: 1.3, w: 1.2, sill: 0.85, h: 1.4, broken: [0, 0, 0] },
    { c: 3.7, w: 1.2, sill: 0.85, h: 1.4, broken: [0, 1, 1] },
  ],
  N: [
    { c: -3.4, w: 1.0, sill: 1.0, h: 1.2, broken: [0, 0, 1] },
    { c: -1.3, w: 0.9, sill: 0, h: 2.05, door: 'back' },
    { c: 2.2, w: 1.2, sill: 0.85, h: 1.4, broken: [0, 0, 0] },
  ],
  E: [
    { c: 1.6, w: 1.1, sill: 0.85, h: 1.4, broken: [0, 0, 0] },
    { c: -1.9, w: 1.1, sill: 0.85, h: 1.4, broken: [1, 1, 0] },
  ],
  W: [{ c: 0.3, w: 0.9, sill: 1.05, h: 1.05, broken: [0, 0, 0] }],
};

// Wall frames: map (u along wall, v up, d inward from outer face) -> house-local xyz.
const WALLS = {
  S: { L: W, u0: -W / 2, map: (u, v, d) => [u, v, D / 2 - d], axis: 'x' },
  N: { L: W, u0: -W / 2, map: (u, v, d) => [u, v, -D / 2 + d], axis: 'x' },
  E: { L: D - 2 * T, u0: -D / 2 + T, map: (u, v, d) => [W / 2 - d, v, u], axis: 'z' },
  W: { L: D - 2 * T, u0: -D / 2 + T, map: (u, v, d) => [-W / 2 + d, v, u], axis: 'z' },
};

function wb(B, mat, wall, u0, u1, v0, v1, d0, d1, bevel = 0, opts) {
  const a = wall.map(u0, v0, d0), b = wall.map(u1, v1, d1);
  return B.aabb(mat, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), bevel, opts);
}

/** Corrugated sheet surface. Profile phase matches the asbestos_sheet scan (period 1/7 m). */
function corrugated(width, length, amp = 0.019, seg = 8) {
  const period = 2 / 14, phi = -2.26;
  const nu = Math.ceil((width / period) * seg), nv = 3;
  const pos = [], nor = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = (i / nu) * width - width / 2, s = (j / nv) * length;
    const k = (2 * Math.PI) / period;
    const h = amp * Math.sin(k * u + phi), dh = amp * k * Math.cos(k * u + phi);
    pos.push(u, h, s);
    const n = new THREE.Vector3(-dh, 1, 0).normalize();
    nor.push(n.x, n.y, n.z);
    uv.push(u, -s);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g.toNonIndexed();
}

export async function build(ctx) {
  const { assets, scene, collision } = ctx;
  const H = WORLD.house;
  const root = new THREE.Group();
  root.name = 'farmhouse';
  root.position.set(H.x, FLOOR_Y, H.z);
  scene.add(root);
  const toWorld = (x, y, z) => new THREE.Vector3(x + H.x, y + FLOOR_Y, z + H.z);

  // ---------------- materials ----------------
  const [plaster, plasterBrick, concrete, roofSheet, paintedWood, doorMat, floorMat, wallpaper, ceiling, planks, rust, greenMetal] = await Promise.all([
    assets.pbr('plaster'), assets.pbr('plasterBrick'), assets.pbr('concrete'), assets.pbr('roofSheet', { side: THREE.DoubleSide }),
    assets.pbr('paintedWood'), assets.pbr('door'), assets.pbr('floor', { envMapIntensity: 0.3 }), assets.pbr('wallpaper', { envMapIntensity: 0.3 }),
    assets.pbr('ceiling', { envMapIntensity: 0.25 }), assets.pbr('brownPlanks'), assets.pbr('rust', { metal: true, side: THREE.DoubleSide }),
    assets.pbr('greenMetal', { metal: true }),
  ]);
  const plasterBrickSet = { map: plasterBrick.map, normalMap: plasterBrick.normalMap, arm: plasterBrick.roughnessMap };
  damage(plaster, plasterBrickSet, { uvScale: 0.9, groundY: PAD_Y, amount: 0.55 });
  weather(plaster, { groundY: PAD_Y, grimeHeight: 0.9, grime: 0.4, streaks: 0.12, macro: 0.16, tint: 0xf2eadb });
  const trim = plaster.clone();
  trim.name = 'plasterTrim';
  weather(trim, { groundY: PAD_Y, grimeHeight: 0.5, grime: 0.2, streaks: 0.1, macro: 0.1, tint: 0xfffaf0 });
  weather(concrete, { groundY: PAD_Y, grimeHeight: 0.35, grime: 0.45, macro: 0.2 });
  weather(roofSheet, { groundY: FLOOR_Y + 2.2, grimeHeight: 1.4, grime: 0.45, macro: 0.25, tint: 0xd8d4c8 });
  weather(paintedWood, { groundY: PAD_Y, grimeHeight: 0.4, grime: 0.3, macro: 0.2 });
  weather(planks, { groundY: FLOOR_Y + WH, grimeHeight: 0.6, grime: 0.25, macro: 0.25 });
  const woodIn = paintedWood.clone(); woodIn.name = 'paintedWoodIn'; woodIn.envMapIntensity = 0.3;
  const wallIn = wallpaper; // inner faces of all walls
  const chimneyMat = plasterBrick;
  weather(chimneyMat, { groundY: FLOOR_Y + 4, grimeHeight: 0.6, grime: 0.3, macro: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'glass', color: 0x8f9a93, roughness: 0.06, metalness: 0, ior: 1.52, specularIntensity: 1,
    transparent: true, opacity: 0.3, depthWrite: false, envMapIntensity: 1.2, side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshStandardMaterial({ name: 'soot', color: 0x0a0a09, roughness: 1 });

  const B = new Builder();
  const glassB = new Builder();

  // ---------------- plinth & floor ----------------
  B.aabb(concrete, -W / 2 - 0.05, GROUND - 0.5, -D / 2 - 0.05, W / 2 + 0.05, -0.04, D / 2 + 0.05, 0.015);
  // drip ledge where the plinth meets the plaster
  B.aabb(concrete, -W / 2 - 0.07, -0.08, -D / 2 - 0.07, W / 2 + 0.07, -0.02, D / 2 + 0.07, 0.01);
  B.aabb(floorMat, -W / 2 + T, -0.06, -D / 2 + T, W / 2 - T, 0, D / 2 - T);
  B.aabb(ceiling, -W / 2 + T, CEIL, -D / 2 + T, W / 2 - T, CEIL + 0.14, D / 2 - T);
  collision.floor(H.x, H.z, W / 2 - 0.05, D / 2 - 0.05, 0, FLOOR_Y);

  const doors = [];
  const colliders = [];

  // ---------------- exterior walls ----------------
  for (const [key, wall] of Object.entries(WALLS)) {
    const ops = OPENINGS[key].map((o) => ({ ...o, u0: o.c - o.w / 2, u1: o.c + o.w / 2, v0: o.sill, v1: o.sill + o.h }));
    const pieces = wallPieces(wall.L, WH, ops.map((o) => ({ u0: o.u0 - wall.u0, u1: o.u1 - wall.u0, v0: o.v0, v1: o.v1 })));
    for (const p of pieces) {
      const u0 = p.u0 + wall.u0, u1 = p.u1 + wall.u0;
      wb(B, plaster, wall, u0, u1, p.v0, p.v1, 0, T - 0.02);
      if (p.v0 < CEIL) wb(B, wallIn, wall, u0, u1, p.v0, Math.min(p.v1, CEIL), T - 0.02, T);
      if (p.v0 < 1.9) {
        const a = wall.map(u0, 0, 0), b = wall.map(u1, 0, T);
        const cx = (a[0] + b[0]) / 2 + H.x, cz = (a[2] + b[2]) / 2 + H.z;
        colliders.push(collision.box(cx, cz, Math.abs(a[0] - b[0]) / 2, Math.abs(a[2] - b[2]) / 2, 0, FLOOR_Y + p.v0 - 0.7, FLOOR_Y + p.v1));
        // skirting board where the wall meets the floor
        if (p.v0 === 0) wb(B, woodIn, wall, u0 + 0.001, u1 - 0.001, 0, 0.09, T, T + 0.018, 0.004);
      }
    }
    for (const o of ops) {
      if (o.door) {
        const door = buildDoor(B, wall, o, { paintedWood, doorMat, trim, concrete, rust, root });
        const a = wall.map(o.u0, 0, 0.1), b = wall.map(o.u1, 0, 0.3);
        door.collider = collision.box((a[0] + b[0]) / 2 + H.x, (a[2] + b[2]) / 2 + H.z, Math.abs(a[0] - b[0]) / 2, Math.abs(a[2] - b[2]) / 2, 0, FLOOR_Y - 0.5, FLOOR_Y + o.h);
        door.collider.enabled = !door.open;
        door.worldPos = new THREE.Vector3((a[0] + b[0]) / 2 + H.x, FLOOR_Y + 1.1, (a[2] + b[2]) / 2 + H.z);
        doors.push(door);
      }
      else buildWindow(B, glassB, wall, o, { paintedWood, woodIn, trim, concrete, glass, rust }, colliders, collision, H);
    }
  }

  // ---------------- interior partitions ----------------
  const parts = [
    { axis: 'z', at: -0.9, from: -D / 2 + T, to: D / 2 - T, doors: [{ c: 1.2, w: 0.9, h: 2.05 }] },
    { axis: 'x', at: -0.3, from: -0.9 + TI / 2, to: W / 2 - T, doors: [{ c: 0.6, w: 0.9, h: 2.05 }] },
  ];
  for (const p of parts) {
    const L = p.to - p.from;
    const pieces = wallPieces(L, CEIL, p.doors.map((d) => ({ u0: d.c - d.w / 2 - p.from, u1: d.c + d.w / 2 - p.from, v0: 0, v1: d.h })));
    for (const q of pieces) {
      const a = p.from + q.u0, b = p.from + q.u1;
      if (p.axis === 'z') {
        B.aabb(wallIn, p.at - TI / 2, q.v0, a, p.at + TI / 2, q.v1, b);
        if (q.v0 === 0) {
          colliders.push(collision.box(p.at + H.x, (a + b) / 2 + H.z, TI / 2, (b - a) / 2, 0, FLOOR_Y, FLOOR_Y + CEIL));
          B.aabb(woodIn, p.at - TI / 2 - 0.018, 0, a, p.at + TI / 2 + 0.018, 0.09, b, 0.004);
        }
      } else {
        B.aabb(wallIn, a, q.v0, p.at - TI / 2, b, q.v1, p.at + TI / 2);
        if (q.v0 === 0) {
          colliders.push(collision.box((a + b) / 2 + H.x, p.at + H.z, (b - a) / 2, TI / 2, 0, FLOOR_Y, FLOOR_Y + CEIL));
          B.aabb(woodIn, a, 0, p.at - TI / 2 - 0.018, b, 0.09, p.at + TI / 2 + 0.018, 0.004);
        }
      }
    }
    // door casings on the internal doorways
    for (const d of p.doors) {
      const u0 = d.c - d.w / 2, u1 = d.c + d.w / 2, cw = 0.07;
      for (const s of [-1, 1]) {
        if (p.axis === 'z') {
          B.aabb(woodIn, p.at - TI / 2 - 0.02, 0, u0 - cw, p.at + TI / 2 + 0.02, d.h + cw, u0, 0.005);
          B.aabb(woodIn, p.at - TI / 2 - 0.02, 0, u1, p.at + TI / 2 + 0.02, d.h + cw, u1 + cw, 0.005);
          B.aabb(woodIn, p.at - TI / 2 - 0.02, d.h, u0, p.at + TI / 2 + 0.02, d.h + cw, u1, 0.005);
        } else {
          B.aabb(woodIn, u0 - cw, 0, p.at - TI / 2 - 0.02, u0, d.h + cw, p.at + TI / 2 + 0.02, 0.005);
          B.aabb(woodIn, u1, 0, p.at - TI / 2 - 0.02, u1 + cw, d.h + cw, p.at + TI / 2 + 0.02, 0.005);
          B.aabb(woodIn, u0, d.h, p.at - TI / 2 - 0.02, u1, d.h + cw, p.at + TI / 2 + 0.02, 0.005);
        }
        break;
      }
    }
  }

  // ---------------- roof ----------------
  const tanP = Math.tan(HOUSE.PITCH), cosP = Math.cos(HOUSE.PITCH);
  const OV = 0.5, OVG = 0.38;            // eave / gable overhang
  const Y0 = WH + 0.22;                  // roof surface height above the outer wall line
  const ridgeY = Y0 + (D / 2) * tanP;
  const eaveY = Y0 - OV * tanP;
  HOUSE.ridgeY = ridgeY;
  const slopeLen = (D / 2 + OV) / cosP;
  const roofW = W + 2 * OVG;
  for (const side of [1, -1]) {
    const g = corrugated(roofW, slopeLen + 0.04);
    // local: x across, y = corrugation normal, z = down-slope
    const m = new THREE.Matrix4().makeRotationX(HOUSE.PITCH);
    if (side < 0) m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
    m.premultiply(new THREE.Matrix4().makeTranslation(0, ridgeY + 0.02, 0));
    B.add(roofSheet, g, m, { keepUV: true });
    // sheathing boards under the sheets (visible from below at the gable overhang)
    const sb = box(roofW, 0.025, slopeLen);
    const ms = new THREE.Matrix4().makeTranslation(0, -0.03, slopeLen / 2).premultiply(new THREE.Matrix4().makeRotationX(HOUSE.PITCH));
    if (side < 0) ms.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
    ms.premultiply(new THREE.Matrix4().makeTranslation(0, ridgeY + 0.02, 0));
    B.add(planks, sb, ms, { localUV: true });
    // boxed eave: soffit + fascia
    const zEdge = side * (D / 2 + OV);
    B.aabb(planks, -W / 2 - OVG, eaveY - 0.2, Math.min(side * D / 2, zEdge), W / 2 + OVG, eaveY - 0.17, Math.max(side * D / 2, zEdge));
    B.aabb(paintedWood, -W / 2 - OVG - 0.02, eaveY - 0.21, zEdge - (side > 0 ? 0 : 0.03), W / 2 + OVG + 0.02, eaveY + 0.02, zEdge + (side > 0 ? 0.03 : 0), 0.006);
    // gutter (half round, open top) on brackets, with a downpipe at each end of the front
    const gz = zEdge + side * 0.1, gy = eaveY - 0.1;
    const gutter = new THREE.CylinderGeometry(0.065, 0.065, roofW - 0.1, 14, 1, true, Math.PI, Math.PI);
    B.add(rust, gutter, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, gy, gz)), { localUV: true });
    for (const e of [-1, 1]) {
      const cap = new THREE.CircleGeometry(0.065, 12, Math.PI, Math.PI);
      B.add(rust, cap, new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(e * (roofW - 0.1) / 2, gy, gz)), { localUV: true });
    }
    for (let x = -roofW / 2 + 0.3; x < roofW / 2; x += 0.85) {
      B.aabb(rust, x - 0.012, gy - 0.075, zEdge - side * 0.01, x + 0.012, gy + 0.005, zEdge + side * 0.17);
    }
    const pipeXs = side > 0 ? [-W / 2 + 0.12, W / 2 - 0.12] : [W / 2 - 0.12];
    for (const px of pipeXs) buildDownpipe(B, rust, px, gy, gz, side, eaveY, H, collision, ctx);
  }
  // ridge cap
  {
    const cap = new THREE.CylinderGeometry(0.11, 0.11, roofW + 0.02, 12, 1, true, -1.1, 2.2);
    B.add(roofSheet, cap, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, ridgeY - 0.03, 0)), { localUV: true });
  }
  // gables: plastered masonry triangle + vertical board cladding with battens, barge boards
  for (const sx of [1, -1]) {
    const shape = new THREE.Shape([new THREE.Vector2(-D / 2, WH), new THREE.Vector2(D / 2, WH), new THREE.Vector2(0, ridgeY - 0.05)]);
    const tri = new THREE.ExtrudeGeometry(shape, { depth: T - 0.08, bevelEnabled: false });
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(sx > 0 ? W / 2 - T + 0.04 : -W / 2 + 0.04, 0, 0));
    B.add(plaster, tri, m);
    // cladding: boards on battens, 4 cm proud of the masonry
    const clad = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-D / 2 - 0.03, WH - 0.12), new THREE.Vector2(D / 2 + 0.03, WH - 0.12), new THREE.Vector2(0, ridgeY - 0.02)]), { depth: 0.025, bevelEnabled: false });
    const mc = new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(sx * (W / 2 + 0.045) - (sx > 0 ? 0.025 : 0), 0, 0));
    B.add(planks, clad, mc);
    for (let z = -D / 2 + 0.2; z < D / 2 - 0.1; z += 0.42) {
      const top = WH - 0.12 + (ridgeY - 0.05 - (WH - 0.12)) * (1 - Math.abs(z) / (D / 2 + 0.03));
      B.aabb(planks, sx * (W / 2 + 0.045) - 0.012, WH - 0.12, z - 0.025, sx * (W / 2 + 0.045) + 0.028 * sx, top - 0.06, z + 0.025, 0.004);
    }
    // base trim board (weather drip)
    B.aabb(paintedWood, sx > 0 ? W / 2 : -W / 2 - 0.1, WH - 0.2, -D / 2 - 0.05, sx > 0 ? W / 2 + 0.1 : -W / 2, WH - 0.11, D / 2 + 0.05, 0.008);
    // louvred attic vent
    for (let i = 0; i < 4; i++) B.aabb(paintedWood, sx * (W / 2 + 0.08) - 0.03, ridgeY - 1.6 + i * 0.1, -0.3, sx * (W / 2 + 0.08) + 0.03, ridgeY - 1.56 + i * 0.1, 0.3, 0.005);
    B.aabb(dark, sx * (W / 2 + 0.06) - 0.01, ridgeY - 1.62, -0.28, sx * (W / 2 + 0.06) + 0.01, ridgeY - 1.2, 0.28);
    // barge boards following the rake
    for (const sz of [1, -1]) {
      const len = slopeLen + 0.05;
      const g = box(0.035, 0.2, len, 0.006);
      const mb = new THREE.Matrix4().makeTranslation(0, -0.07, len / 2).premultiply(new THREE.Matrix4().makeRotationX(HOUSE.PITCH));
      if (sz < 0) mb.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
      mb.premultiply(new THREE.Matrix4().makeTranslation(sx * (roofW / 2 + 0.018), ridgeY + 0.02, 0));
      B.add(paintedWood, g, mb, { localUV: true });
    }
  }
  // chimney (from the kitchen stove), brick with a precast cap
  {
    const cx = -1.72, cz = -2.35, top = ridgeY + 0.35;
    B.aabb(chimneyMat, cx - 0.27, ridgeY - 2.35 * tanP - 0.6, cz - 0.27, cx + 0.27, top, cz + 0.27, 0.01);
    B.aabb(concrete, cx - 0.34, top, cz - 0.34, cx + 0.34, top + 0.07, cz + 0.34, 0.012);
    B.aabb(dark, cx - 0.1, top + 0.069, cz - 0.1, cx + 0.1, top + 0.0705, cz + 0.1);
  }

  // ---------------- porches ----------------
  // front: concrete landing + two steps, lean-to canopy on steel brackets
  {
    const x0 = -2.55, x1 = -0.65, z0 = D / 2;
    B.aabb(concrete, x0, GROUND - 0.3, z0, x1, -0.03, z0 + 1.3, 0.02);
    B.aabb(concrete, x0 + 0.05, GROUND - 0.3, z0 + 1.3, x1 - 0.05, -0.23, z0 + 1.6, 0.02);
    B.aabb(concrete, x0 + 0.1, GROUND - 0.3, z0 + 1.6, x1 - 0.1, -0.43, z0 + 1.9, 0.02);
    collision.floor((x0 + x1) / 2 + H.x, z0 + 0.65 + H.z, (x1 - x0) / 2, 0.65, 0, FLOOR_Y - 0.03);
    collision.floor((x0 + x1) / 2 + H.x, z0 + 1.45 + H.z, (x1 - x0) / 2 - 0.05, 0.15, 0, FLOOR_Y - 0.23);
    collision.floor((x0 + x1) / 2 + H.x, z0 + 1.75 + H.z, (x1 - x0) / 2 - 0.1, 0.15, 0, FLOOR_Y - 0.43);
    // canopy
    const cy = 2.42, depth = 1.25, fall = 0.18;
    const sheet = box(2.2, 0.012, depth + 0.1, 0.004);
    const ang = Math.atan2(fall, depth);
    B.add(greenMetal, sheet, new THREE.Matrix4().makeRotationX(ang).premultiply(new THREE.Matrix4().makeTranslation(-1.6, cy - fall / 2, z0 + depth / 2)), { localUV: true });
    for (const bx of [-2.55, -0.65]) {
      B.aabb(rust, bx - 0.02, cy - 0.05, z0, bx + 0.02, cy - 0.01, z0 + depth - 0.05);
      const strut = box(0.03, 0.03, 1.0);
      B.add(rust, strut, new THREE.Matrix4().makeRotationX(-0.72).premultiply(new THREE.Matrix4().makeTranslation(bx, cy - 0.35, z0 + 0.35)), { localUV: true });
    }
  }
  // back: a single block step
  {
    const x0 = -1.9, x1 = -0.7, z0 = -D / 2;
    B.aabb(concrete, x0, GROUND - 0.3, z0 - 0.9, x1, -0.25, z0, 0.02);
    collision.floor((x0 + x1) / 2 + H.x, z0 - 0.45 + H.z, (x1 - x0) / 2, 0.45, 0, FLOOR_Y - 0.25);
  }

  B.build(root);
  glassB.build(root, { castShadow: false, receiveShadow: false });
  root.traverse((o) => { if (o.isMesh && o.material === glass) { o.renderOrder = 2; o.userData.noAO = true; } });

  // ---------------- furnishing (environmental storytelling) ----------------
  // Kitchen (west): stove, table with a chair knocked over, shelving stripped bare
  const fl = { onFloor: true, parent: root, envIntensity: 0.35 };
  const items = [
    ['scandinavian_masonry_heater', { x: -1.72, z: -2.62, rot: Math.PI / 2, y: 0, collide: true }],
    ['painted_wooden_table', { x: -3.2, z: 1.5, rot: Math.PI / 2, y: 0, scale: 0.8, collide: true }],
    ['painted_wooden_chair_01', { x: -3.9, z: 0.5, rot: 0.4, y: 0 }],
    ['painted_wooden_chair_01', { x: -2.5, z: 2.5, rot: 1.9, y: 0.0, rz: Math.PI / 2 }], // knocked over
    ['painted_wooden_shelves', { x: -4.62, z: -1.8, rot: Math.PI / 2, y: 0, collide: true }],
    ['painted_wooden_cabinet', { x: -3.4, z: -3.05, rot: 0, y: 0, collide: true }],
    ['pot_enamel_01', { x: -3.1, z: 1.2, y: 0.77 }],
    ['cardboard_box_01', { x: -4.4, z: 2.9, rot: 0.3, y: 0 }],
    ['rubber_boots', { x: -2.2, z: 3.0, rot: -0.3, y: 0 }],
    // Living room (south-east)
    ['wooden_bookshelf_worn', { x: 2.4, z: 3.0, rot: Math.PI, y: 0, collide: true }],
    ['painted_wooden_chair_01', { x: 3.6, z: 1.2, rot: -2.6, y: 0 }],
    // Bedroom (north-east)
    ['old_bed_frame', { x: 3.7, z: -2.3, rot: Math.PI / 2, y: 0, collide: true }],
    ['painted_wooden_cabinet', { x: 0.2, z: -3.05, rot: 0, y: 0, collide: true }],
  ];
  await Promise.all(items.map(([id, o]) => spawnModel(ctx, id, { ...fl, ...o, x: o.x, z: o.z })));
  // colliders registered in house space must be offset into world space
  // (spawnModel registers in world space via bounding boxes, parent is at house origin)

  ctx.house = { root, doors, HOUSE, toWorld, GROUND };
  ctx.doors = (ctx.doors || []).concat(doors);
  ctx.updaters.push({ update: (dt) => doors.forEach((d) => d.update(dt)) });
}

function buildWindow(B, glassB, wall, o, M, colliders, collision, H) {
  const { paintedWood, woodIn, trim, concrete, glass, rust } = M;
  const u0 = o.u0, u1 = o.u1, v0 = o.v0, v1 = o.v1;
  const f = 0.07, d0 = 0.12, d1 = 0.21;
  // raised plaster surround
  const b = 0.11, t = 0.022;
  wb(B, trim, wall, u0 - b, u0, v0, v1 + b, -t, 0, 0.006);
  wb(B, trim, wall, u1, u1 + b, v0, v1 + b, -t, 0, 0.006);
  wb(B, trim, wall, u0, u1, v1, v1 + b, -t, 0, 0.006);
  // external concrete sill with drip, projecting 7 cm
  wb(B, concrete, wall, u0 - 0.07, u1 + 0.07, v0 - 0.06, v0, -0.075, d0 + 0.02, 0.012);
  // frame
  wb(B, paintedWood, wall, u0, u0 + f, v0, v1, d0, d1, 0.006);
  wb(B, paintedWood, wall, u1 - f, u1, v0, v1, d0, d1, 0.006);
  wb(B, paintedWood, wall, u0 + f, u1 - f, v1 - f, v1, d0, d1, 0.006);
  wb(B, paintedWood, wall, u0 + f, u1 - f, v0, v0 + f * 0.8, d0, d1, 0.006);
  const vt = v0 + (v1 - v0) * 0.72;
  wb(B, paintedWood, wall, u0 + f, u1 - f, vt - 0.03, vt + 0.03, d0, d1, 0.006);
  const um = (u0 + u1) / 2;
  // casement sashes (two below the transom, one fanlight above), set slightly proud
  const sashes = [
    [u0 + f, um, v0 + f * 0.8, vt - 0.03], [um, u1 - f, v0 + f * 0.8, vt - 0.03], [u0 + f, u1 - f, vt + 0.03, v1 - f],
  ];
  const s = 0.048;
  sashes.forEach(([a, bb, c, d], i) => {
    wb(B, paintedWood, wall, a, a + s, c, d, d0 - 0.015, d0 + 0.045, 0.005);
    wb(B, paintedWood, wall, bb - s, bb, c, d, d0 - 0.015, d0 + 0.045, 0.005);
    wb(B, paintedWood, wall, a + s, bb - s, c, c + s * 1.2, d0 - 0.015, d0 + 0.045, 0.005);
    wb(B, paintedWood, wall, a + s, bb - s, d - s, d, d0 - 0.015, d0 + 0.045, 0.005);
    if (i < 2) wb(B, paintedWood, wall, a + s, bb - s, (c + d) / 2 - 0.015, (c + d) / 2 + 0.015, d0 - 0.01, d0 + 0.04, 0.004); // glazing bar
    if (!o.broken?.[i]) wb(glassB, glass, wall, a + s, bb - s, c + s, d - s, d0 + 0.012, d0 + 0.016);
    else {
      // a broken pane leaves a jagged shard in the corner
      const shard = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.18, 0), new THREE.Vector2(0.05, 0.08), new THREE.Vector2(0.02, 0.26)]);
      const g = new THREE.ShapeGeometry(shard);
      const p = wall.map(a + s, c + s, d0 + 0.014);
      const m = new THREE.Matrix4();
      if (wall.axis === 'x') m.makeTranslation(p[0], p[1], p[2]);
      else m.makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]));
      glassB.add(glass, g, m, { localUV: true });
    }
  });
  // interior sill board
  wb(B, woodIn, wall, u0 - 0.03, u1 + 0.03, v0 - 0.03, v0, d1, 0.43, 0.006);
  // handle
  wb(B, rust, wall, um - 0.01, um + 0.01, (v0 + vt) / 2 - 0.06, (v0 + vt) / 2 + 0.06, d0 + 0.045, d0 + 0.07);
  // keep the player out of window openings
  const a = wall.map(u0, 0, d0), bb2 = wall.map(u1, 0, d1);
  colliders.push(collision.box((a[0] + bb2[0]) / 2 + H.x, (a[2] + bb2[2]) / 2 + H.z, Math.abs(a[0] - bb2[0]) / 2 + 0.01, Math.abs(a[2] - bb2[2]) / 2 + 0.01, 0, FLOOR_Y + v0 - 0.5, FLOOR_Y + v1));
}

function buildDoor(B, wall, o, M) {
  const { paintedWood, doorMat, concrete, rust, root } = M;
  const u0 = o.u0, u1 = o.u1, h = o.h, jw = 0.075, d0 = 0.1, d1 = 0.27;
  wb(B, paintedWood, wall, u0, u0 + jw, 0, h, d0, d1, 0.006);
  wb(B, paintedWood, wall, u1 - jw, u1, 0, h, d0, d1, 0.006);
  wb(B, paintedWood, wall, u0 + jw, u1 - jw, h - jw, h, d0, d1, 0.006);
  wb(B, paintedWood, wall, u0 + jw, u1 - jw, -0.02, 0.025, d0 - 0.02, T, 0.006); // threshold
  wb(B, M.trim, wall, u0 - 0.11, u0, 0, h + 0.11, -0.022, 0, 0.006);
  wb(B, M.trim, wall, u1, u1 + 0.11, 0, h + 0.11, -0.022, 0, 0.006);
  wb(B, M.trim, wall, u0, u1, h, h + 0.11, -0.022, 0, 0.006);
  // leaf on a hinge pivot (opens inwards)
  const lw = u1 - u0 - 2 * jw - 0.008, lh = h - jw - 0.03, lt = 0.045;
  const pivot = new THREE.Group();
  const hinge = wall.map(u0 + jw + 0.004, 0.028, d1 - 0.02);
  pivot.position.set(...hinge);
  const leafGeo = box(lw, lh, lt, 0.006);
  boxUV(leafGeo, null);
  const leaf = new THREE.Mesh(leafGeo, doorMat);
  leaf.castShadow = leaf.receiveShadow = true;
  const inward = wall.map(0, 0, 1)[wall.axis === 'x' ? 2 : 0] - wall.map(0, 0, 0)[wall.axis === 'x' ? 2 : 0];
  const handle = new THREE.Mesh(box(0.12, 0.022, 0.03, 0.006), rust);
  handle.position.set(lw - 0.09, 1.02 - lh / 2, lt / 2 + 0.02);
  const handle2 = handle.clone(); handle2.position.z = -lt / 2 - 0.02;
  leaf.add(handle, handle2);
  leaf.position.set(lw / 2, lh / 2, 0);
  const inner = new THREE.Group();
  inner.add(leaf);
  // orient the leaf along the wall; opening rotates towards the interior
  if (wall.axis === 'z') inner.rotation.y = -Math.PI / 2 * Math.sign(inward) * -1;
  if (wall.axis === 'x' && inward < 0) inner.rotation.y = 0;
  pivot.add(inner);
  root.add(pivot);
  const dir = wall.axis === 'x' ? -Math.sign(inward) : Math.sign(inward);
  const door = {
    name: o.door, pivot, leaf, open: o.door === 'back', angle: 0, width: lw,
    get openAngle() { return dir * 1.75; },
    update(dt) {
      const target = this.open ? this.openAngle : 0;
      this.angle += (target - this.angle) * (1 - Math.exp(-6 * dt));
      pivot.rotation.y = this.angle;
      if (this.collider) this.collider.enabled = Math.abs(this.angle) < 0.35;
    },
  };
  door.angle = door.open ? door.openAngle : 0;
  pivot.rotation.y = door.angle;
  return door;
}

function buildDownpipe(B, rust, px, gy, gz, side, eaveY, H, collision) {
  const wallZ = side * (D / 2 + 0.07);
  const bottom = GROUND + 0.22;
  const pts = [
    new THREE.Vector3(px, gy - 0.02, gz),
    new THREE.Vector3(px, gy - 0.22, gz),
    new THREE.Vector3(px, gy - 0.42, wallZ + side * 0.02),
    new THREE.Vector3(px, gy - 0.62, wallZ),
    new THREE.Vector3(px, bottom + 0.25, wallZ),
    new THREE.Vector3(px, bottom + 0.08, wallZ + side * 0.08),
    new THREE.Vector3(px, bottom, wallZ + side * 0.22),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
  const tube = new THREE.TubeGeometry(curve, 80, 0.048, 12, false);
  const L = curve.getLength();
  const uv = tube.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * 0.3);
  B.add(rust, tube, null, { keepUV: true });
  for (let y = bottom + 0.6; y < gy - 0.7; y += 1.1) {
    B.aabb(rust, px - 0.055, y - 0.015, wallZ - 0.055, px + 0.055, y + 0.015, wallZ + 0.055);
    B.aabb(rust, px - 0.01, y - 0.012, Math.min(wallZ, side * D / 2), px + 0.01, y + 0.012, Math.max(wallZ, side * D / 2));
  }
  collision.circle(px + H.x, wallZ + H.z, 0.06, FLOOR_Y + bottom, FLOOR_Y + gy);
}

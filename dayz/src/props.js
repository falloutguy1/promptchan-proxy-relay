import * as THREE from 'three';
import { WORLD, FLOOR_Y, PAD_Y, road, roadField, forestMask, trailField, driveField } from './layout.js';
import { Builder, box } from './geom.js';
import { mulberry32 } from './noise.js';
import { spawnModel } from './spawn.js';
import { weather } from './shaderlib.js';

// Outdoor set dressing. Hero props are placed by hand to tell the story of a
// hurriedly abandoned farmstead; natural debris (rocks, stumps, fallen trunks,
// ferns, branches, nettles) is scattered by rules tied to the forest mask and
// instanced with distance culling.

/** Instanced copies of a glTF scene with distance + frustum culling and optional LOD1. */
class Scatter {
  constructor(ctx, src, srcLod, items, { maxDist = 120, lodDist = 40, shadows = true } = {}) {
    this.items = items; this.maxDist = maxDist; this.lodDist = lodDist;
    this.levels = [];
    for (const [lod, s] of [[0, src], [1, srcLod]]) {
      if (!s) continue;
      const parts = [];
      s.updateMatrixWorld(true);
      s.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, items.length);
        im.castShadow = shadows; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        parts.push({ im, local: o.matrixWorld.clone() });
        ctx.scene.add(im);
        if (o.material.alphaTest > 0 || o.material.transparent) ctx.foliage.push(im);
      });
      this.levels[lod] = parts;
    }
    this.mats = items.map((it) => it.m);
    this.tmp = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
    this.radius = new THREE.Box3().setFromObject(src).getBoundingSphere(new THREE.Sphere()).radius;
  }
  update(cam, frustum, scale = 1) {
    for (const l of this.levels) if (l) for (const p of l) p.im.count = 0;
    const md2 = (this.maxDist * scale) ** 2, ld2 = (this.lodDist * scale) ** 2;
    for (const it of this.items) {
      const dx = it.x - cam.position.x, dz = it.z - cam.position.z, d2 = dx * dx + dz * dz;
      if (d2 > md2) continue;
      this.sphere.center.set(it.x, it.y, it.z); this.sphere.radius = this.radius * it.s + 1;
      if (!frustum.intersectsSphere(this.sphere) && d2 > 900) continue;
      const lvl = this.levels[d2 > ld2 && this.levels[1] ? 1 : 0];
      for (const p of lvl) {
        this.tmp.multiplyMatrices(it.m, p.local);
        p.im.instanceMatrix.array.set(this.tmp.elements, p.im.count++ * 16);
      }
    }
    for (const l of this.levels) if (l) for (const p of l) p.im.instanceMatrix.needsUpdate = true;
  }
}

function placement(hf, x, z, rot, s = 1, sink = 0, tiltTo = true) {
  const n = new THREE.Vector3();
  hf.normal(x, z, n);
  const q = new THREE.Quaternion();
  if (tiltTo) q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot));
  const y = hf.height(x, z) - sink * s;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
  return { x, y, z, s, m };
}

export async function build(ctx) {
  const { assets, hf, collision, scene } = ctx;
  const rnd = mulberry32(99);
  const H = WORLD.house;

  // ---------------- hand-placed story props ----------------
  const P = (id, o) => spawnModel(ctx, id, o);
  const hero = [
    // the family car, tarp still on, nosed into the yard off the driveway
    P('covered_car', { x: -8.2, z: 13.2, rot: 0.42, collide: true, tiltAmount: 1 }),
    // tyres and a rim dumped by the east wall
    P('old_tyre', { x: 6.3, z: 4.6, rot: 0.3, rx: -Math.PI / 2 + 0.02 }),
    P('old_tyre', { x: 6.35, z: 4.62, rot: 0.9, rx: -Math.PI / 2, y: hf.height(6.3, 4.6) + 0.16 }),
    P('old_tyre', { x: 6.1, z: 3.2, rot: -1.25, rz: 0.22 }),
    P('rusted_wheel_rim_01', { x: 7.1, z: 5.4, rot: 0.5, rx: -Math.PI / 2 }),
    // rain barrel under the north-east downpipe
    P('barrel_03', { x: 5.05, z: -4.55, rot: 0.3, collide: 'circle' }),
    // back door clutter
    P('wooden_crate_01', { x: -3.1, z: -4.6, rot: 0.15, collide: true }),
    P('wooden_crate_01', { x: -3.05, z: -4.62, rot: -0.2, y: hf.height(-3.1, -4.6) + 0.34 }),
    P('wooden_bucket_01', { x: -0.2, z: -4.5, rot: 1.2 }),
    P('watering_can_metal_01', { x: 0.4, z: -4.35, rot: 2.1, rz: Math.PI / 2 - 0.1 }),
    P('rusted_spade_01', { x: 5.55, z: -2.6, rot: Math.PI / 2, rx: 0.0, rz: -0.26 }),
    P('wooden_ladder', { x: 6.2, z: -1.2, rot: Math.PI / 2 + 0.1, collide: true }),
    // chopping block with the axe still in it
    P('tree_stump_01', { x: 8.0, z: -6.2, rot: 0.8, scale: 0.55, collide: 'circle' }),
    // front yard
    P('plastic_crate_01', { x: 0.1, z: 5.9, rot: 0.6 }),
    P('trashbag', { x: 4.8, z: 17.2, rot: 0.2 }),
    P('trashbag', { x: 5.4, z: 17.5, rot: 1.9, rz: 0.3 }),
    P('wooden_military_crate', { x: -10.6, z: 10.4, rot: 0.42 + Math.PI / 2, collide: true }),
  ];
  await Promise.all(hero);

  // ---------------- nature scatter ----------------
  const sets = [];
  const scatter = async (id, count, where, o = {}) => {
    const items = [];
    let guard = 0;
    while (items.length < count && guard++ < count * 60) {
      const x = (rnd() - 0.5) * (o.range ?? 600) + (o.cx ?? 0), z = (rnd() - 0.5) * (o.range ?? 600) + (o.cz ?? 0);
      if (!where(x, z)) continue;
      const s = (o.scale ?? 1) * (0.75 + rnd() * 0.5);
      const it = placement(hf, x, z, rnd() * Math.PI * 2, s, o.sink ?? 0, o.tilt ?? true);
      items.push(it);
      if (o.collide) collision.circle(x, z, o.collide * s, it.y - 1, it.y + (o.height ?? 1) * s);
    }
    const [src, lod] = await Promise.all([assets.model(id), o.lod ? assets.model(id, 1) : null]);
    if (!src) return;
    sets.push({ set: new Scatter(ctx, src, lod, items, o), dist: o.maxDist ?? 120 });
  };
  const inForest = (lo, hi = 1.01) => (x, z) => { const f = forestMask(x, z); return f >= lo && f < hi && !trailField.nearest(x, z, 1.5); };
  const open = (x, z) => forestMask(x, z) < 0.05 && !roadField.nearest(x, z, 7) && Math.hypot(x - H.x, z - H.z) > 18;
  await Promise.all([
    scatter('fern_02', 900, inForest(0.35), { maxDist: 70, lodDist: 70, shadows: false, scale: 0.9, range: 520 }),
    scatter('dry_branches_medium_01', 320, inForest(0.25), { maxDist: 60, shadows: false, range: 520 }),
    scatter('tree_stump_01', 60, inForest(0.2, 0.7), { maxDist: 140, lodDist: 35, lod: true, collide: 0.45, scale: 0.9, sink: 0.08 }),
    scatter('dead_tree_trunk', 45, inForest(0.3), { maxDist: 140, lodDist: 40, lod: true, scale: 2.2, sink: 0.05 }),
    scatter('rock_moss_set_02', 14, inForest(0.4), { maxDist: 220, lodDist: 60, lod: true, scale: 0.6, sink: 0.15, tilt: false }),
    scatter('boulder_01', 40, (x, z) => forestMask(x, z) > 0.15 || open(x, z), { maxDist: 220, lodDist: 50, lod: true, collide: 0.55, height: 1, sink: 0.25, scale: 0.9 }),
    scatter('shrub_02', 70, inForest(0.08, 0.5), { maxDist: 160, lodDist: 45, lod: true, scale: 0.8, range: 520 }),
    scatter('nettle_plant', 90, (x, z) => {
      // nettles love disturbed, nitrogen-rich soil: along walls, the fence line and the compost corner
      const dh = Math.max(Math.abs(x - H.x) - H.w / 2, Math.abs(z - H.z) - H.d / 2);
      return (dh > 0.25 && dh < 1.4 && !(z > H.d / 2 && Math.abs(x + 1.6) < 1.4)) || (Math.abs(z - 18) < 1 && Math.abs(x) < 13);
    }, { maxDist: 60, shadows: false, range: 40, cz: 6, scale: 1.1 }),
  ]);
  (ctx.grassBlockers ||= []).push({ x: -1.6 + H.x, z: H.d / 2 + 1.0 + H.z, hx: 1.3, hz: 1.1 });

  // ---------------- picket fence around the front yard ----------------
  const planks = await assets.pbr('planks');
  weather(planks, { groundY: PAD_Y - 0.4, grimeHeight: 0.5, grime: 0.35, macro: 0.3 });
  const darkWood = await assets.pbr('brownPlanks', { color: 0x6a5a4a });
  const B = new Builder();
  const fenceLine = [[-13, -6], [-13, 18.2], [-4.7, 18.2], null, [-1.3, 18.2], [13, 18.2], [13, -6]]; // null = gate gap
  const segs = [];
  for (let i = 0; i < fenceLine.length - 1; i++) if (fenceLine[i] && fenceLine[i + 1]) segs.push([fenceLine[i], fenceLine[i + 1]]);
  let seg = 0;
  for (const [a, b] of segs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const ang = Math.atan2(-dz, dx);
    const nPost = Math.ceil(len / 2.4);
    for (let k = 0; k <= nPost; k++) {
      const t = (k / nPost) * len, x = a[0] + dx * t, z = a[1] + dz * t;
      const y = hf.height(x, z);
      const lean = (rnd() - 0.5) * 0.06;
      B.obox(darkWood, 0.1, 1.5, 0.1, new THREE.Vector3(x, y + 0.55, z), new THREE.Euler(lean, ang, lean * 0.5), 0.01, { localUV: true });
      collision.circle(x, z, 0.08, y - 0.5, y + 1.3);
      if (k === nPost) break;
      // one bay: two rails + pickets; some bays have collapsed or lost pickets
      const bay = (seg * 31 + k * 7) % 11;
      const t2 = ((k + 1) / nPost) * len;
      const bx = a[0] + dx * t2, bz = a[1] + dz * t2, by = hf.height(bx, bz);
      const fallen = bay === 3;
      const mid = new THREE.Vector3((x + bx) / 2, 0, (z + bz) / 2);
      const bayLen = t2 - t;
      for (const ry of [0.35, 1.0]) {
        const yy = (y + by) / 2 + (fallen ? ry * 0.25 : ry);
        const tilt = Math.atan2(by - y, bayLen);
        B.obox(darkWood, bayLen, 0.07, 0.035, new THREE.Vector3(mid.x, yy, mid.z), new THREE.Euler(0, ang, tilt + (fallen ? 0.35 : 0), 'YXZ'), 0.006, { localUV: true });
      }
      const n = Math.floor(bayLen / 0.14);
      for (let p = 0; p < n; p++) {
        if (bay === 5 && p % 3 !== 0) continue;           // pickets stripped for firewood
        if (rnd() < 0.05) continue;
        const tp = t + (p + 0.5) * (bayLen / n);
        const px = a[0] + dx * tp, pz = a[1] + dz * tp;
        const py = hf.height(px, pz);
        const h = 1.12 + (rnd() - 0.5) * 0.06;
        const off = new THREE.Vector3(-dz, 0, dx).multiplyScalar(0.04);
        if (fallen) {
          B.obox(planks, 0.085, h, 0.02, new THREE.Vector3(px + off.x - dz * 0.4, py + 0.05, pz + off.z + dx * 0.4), new THREE.Euler(-1.45, ang, 0, 'YXZ'), 0.004, { localUV: true });
        } else {
          B.obox(planks, 0.085, h, 0.02, new THREE.Vector3(px + off.x, py + h / 2 - 0.06, pz + off.z), new THREE.Euler((rnd() - 0.5) * 0.04, ang, (rnd() - 0.5) * 0.05, 'YXZ'), 0.004, { localUV: true });
        }
      }
      if (!fallen) collision.box(mid.x, mid.z, bayLen / 2, 0.06, -ang, Math.min(y, by) - 0.5, Math.max(y, by) + 1.2);
      ctx.grassBlockers.push({ x: mid.x, z: mid.z, hx: Math.abs(dx) * bayLen / 2 + 0.12, hz: Math.abs(dz) * bayLen / 2 + 0.12 });
    }
    seg++;
  }
  // the gate, hanging open on one hinge
  {
    const gx = -4.7, gz = 18.2, y = hf.height(gx, gz);
    const gate = new THREE.Group();
    const G = new Builder();
    for (const ry of [0.3, 0.95]) G.aabb(darkWood, 0, ry, -0.02, 1.7, ry + 0.07, 0.02, 0.006);
    for (let p = 0; p < 11; p++) G.aabb(planks, 0.05 + p * 0.15, 0.05, 0.02, 0.13 + p * 0.15, 1.12, 0.04, 0.004);
    G.obox(darkWood, 1.85, 0.07, 0.035, new THREE.Vector3(0.85, 0.64, -0.0), new THREE.Euler(0, 0, 0.38), 0.006, { localUV: true });
    G.build(gate);
    gate.position.set(gx, y, gz);
    gate.rotation.set(0, -1.2, 0.08);
    scene.add(gate);
  }
  B.build(scene);

  // ---------------- power line along the road (wooden poles, crossarms, insulators, sagging wires) ----------------
  {
    const PB = new Builder();
    const pole = await assets.pbr('brownPlanks', { color: 0x4a3c30 });
    const porcelain = new THREE.MeshStandardMaterial({ name: 'porcelain', color: 0xd8d4c8, roughness: 0.25 });
    const wireMat = new THREE.MeshStandardMaterial({ name: 'wire', color: 0x222222, roughness: 0.6, metalness: 0.5 });
    const tops = [];
    let s = 0;
    for (let i = 0; i < road.length - 1; i += 1) {
      const [x0, z0] = road[i], [x1, z1] = road[i + 1];
      s += Math.hypot(x1 - x0, z1 - z0);
      if (s < 42) continue;
      s = 0;
      const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
      const nx = -dz / L, nz = dx / L;
      const px = x0 + nx * -6.2, pz = z0 + nz * -6.2;
      if (Math.abs(px) > 420 || Math.abs(pz) > 420) continue;
      const y = hf.height(px, pz);
      const h = 8.2, ang = Math.atan2(-dz, dx);
      const lean = (rnd() - 0.5) * 0.05;
      const pg = new THREE.CylinderGeometry(0.1, 0.14, h + 1, 10, 1);
      PB.add(pole, pg, new THREE.Matrix4().compose(new THREE.Vector3(px, y + h / 2 - 0.5, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, ang, lean)), new THREE.Vector3(1, 1, 1)), { localUV: true });
      PB.obox(pole, 1.9, 0.1, 0.1, new THREE.Vector3(px, y + h - 0.45, pz), new THREE.Euler(0, ang + Math.PI / 2, 0), 0.01, { localUV: true });
      const pts = [];
      for (const o of [-0.85, 0, 0.85]) {
        const ix = px + Math.cos(ang + Math.PI / 2) * o, iz = pz - Math.sin(ang + Math.PI / 2) * o;
        const iy = y + h - 0.4 + (o === 0 ? 0.3 : 0);
        PB.add(porcelain, new THREE.CylinderGeometry(0.035, 0.05, 0.14, 10), new THREE.Matrix4().makeTranslation(ix, iy + 0.07, iz), { localUV: true });
        pts.push(new THREE.Vector3(ix, iy + 0.15, iz));
      }
      tops.push(pts);
      collision.circle(px, pz, 0.15, y - 1, y + h);
    }
    for (let i = 0; i < tops.length - 1; i++) for (let w = 0; w < 3; w++) {
      const a = tops[i][w], b = tops[i + 1][w];
      if (a.distanceTo(b) > 70) continue;
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * 0.9; // catenary-like sag
        pts.push(p);
      }
      PB.add(wireMat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.008, 4), null, { keepUV: true });
    }
    const g = new THREE.Group(); g.name = 'powerline';
    PB.build(g);
    g.traverse((o) => { if (o.material === wireMat) o.castShadow = false; });
    scene.add(g);
  }

  // ---------------- update ----------------
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4();
  const last = new THREE.Vector3(1e9), lastDir = new THREE.Vector3(), dir = new THREE.Vector3();
  let t = 0;
  let q = ctx.q;
  ctx.updaters.push({
    update: (dt, cam) => {
      t += dt;
      cam.getWorldDirection(dir);
      if (cam.position.distanceToSquared(last) < 0.25 && dir.dot(lastDir) > 0.9995 && t < 0.5) return;
      t = 0; last.copy(cam.position); lastDir.copy(dir);
      pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pv);
      const k = q.propDist / 160;
      for (const s of sets) s.set.update(cam, frustum, k);
    },
    quality: (nq) => { q = nq; last.set(1e9, 0, 0); },
  });
}

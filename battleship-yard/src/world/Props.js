import * as THREE from 'three';
import { V, Batch, rbox, cyl, mulberry } from '../engine/geom.js';
import { QUAY, BUILDINGS, ROAD } from './layout.js';

const Y0 = QUAY.topY + 0.02;

/** Shipping container: corrugated side panels, door end with locking bars, corner castings. */
function container(b, mats, pos, yaw, color, len = 6.06) {
  const W = 2.44, H = 2.59;
  const e = new THREE.Euler(0, yaw, 0, 'YXZ');
  const at = (x, y, z) => V(x, y, z).applyEuler(e).add(pos);
  const m = mats.box(color);
  // corrugation: vertical ribs as real geometry on the long sides
  b.add(m, new THREE.BoxGeometry(len - 0.3, H - 0.3, W - 0.12), at(0, H / 2, 0), [0, yaw, 0]);
  for (let x = -len / 2 + 0.3; x < len / 2 - 0.3; x += 0.28) for (const s of [-1, 1]) b.add(m, new THREE.BoxGeometry(0.14, H - 0.36, 0.05), at(x, H / 2, s * (W / 2 - 0.04)), [0, yaw, 0]);
  b.add(m, new THREE.BoxGeometry(len - 0.3, 0.08, W - 0.1), at(0, H - 0.1, 0), [0, yaw, 0]);
  // frame rails + corner posts + castings
  for (const y of [0.08, H - 0.08]) for (const s of [-1, 1]) b.add(mats.frame(color), new THREE.BoxGeometry(len, 0.16, 0.12), at(0, y, s * (W / 2 - 0.06)), [0, yaw, 0]);
  for (const x of [-1, 1]) for (const s of [-1, 1]) {
    b.add(mats.frame(color), new THREE.BoxGeometry(0.16, H, 0.16), at(x * (len / 2 - 0.08), H / 2, s * (W / 2 - 0.08)), [0, yaw, 0]);
    for (const y of [0.09, H - 0.09]) b.add(mats.dark, new THREE.BoxGeometry(0.18, 0.18, 0.18), at(x * (len / 2 - 0.09), y, s * (W / 2 - 0.09)), [0, yaw, 0]);
  }
  // doors with locking bars at +x end
  b.add(m, new THREE.BoxGeometry(0.06, H - 0.3, W - 0.3), at(len / 2 - 0.08, H / 2, 0), [0, yaw, 0]);
  for (const z of [-0.85, -0.35, 0.35, 0.85]) {
    b.add(mats.dark, cyl(0.025, 0.025, H - 0.4, 6), at(len / 2 - 0.02, H / 2, z));
    b.add(mats.dark, new THREE.BoxGeometry(0.05, 0.08, 0.16), at(len / 2, 1.2, z + 0.08), [0, yaw, 0]);
  }
}

function puddleGeometry(r, seed) {
  const rnd = mulberry(seed);
  const g = new THREE.CircleGeometry(r, 40);
  const p = g.attributes.position;
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const k = 1 + 0.25 * Math.sin(a * 2 + ph[0]) + 0.15 * Math.sin(a * 5 + ph[1]) + 0.08 * Math.sin(a * 9 + ph[2]);
    p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * k * 0.7);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}

export async function placeProps(assets, lib, terrain) {
  const group = new THREE.Group();
  group.name = 'props';
  const floaters = [], colliders = [];
  const names = ['Barrel_01', 'barrel_03', 'old_military_crate', 'wooden_crate_01', 'wooden_crate_02', 'propane_tank', 'metal_jerrycan',
    'portable_generator', 'portable_welding_cart', 'metal_tool_chest', 'concrete_road_barrier', 'street_lamp_01', 'utility_box_01',
    'water_manhole_cover', 'fire_hydrant', 'lifebuoy', 'ocean_buoy', 'lateral_sea_marker', 'modular_chainlink_fence', 'hand_truck',
    'cement_bag', 'wooden_military_crate', 'plastic_crate_01', 'power_box_01', 'small_lpg_tank', 'metal_trash_can', 'worn_metal_rack'];
  const loaded = await Promise.all(names.map((n) => assets.model(n)));
  const M = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
  const rnd = mulberry(77);
  // Repeated props are drawn as instanced meshes (one draw per sub-mesh per model);
  // per-instance tint gives each copy a different condition.
  const batches = new Map();
  const put = (name, x, z, yaw = 0, opts = {}) => {
    const src = M[name];
    if (!src) return null;
    if (opts.single) {
      const o = src.clone();
      o.position.set(x, opts.y ?? Y0, z);
      o.rotation.set(opts.rx || 0, yaw, opts.rz || 0);
      if (opts.scale) o.scale.setScalar(opts.scale);
      group.add(o);
      return o;
    }
    const m = new THREE.Matrix4().compose(V(x, opts.y ?? Y0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx || 0, yaw, opts.rz || 0)), V(1, 1, 1).multiplyScalar(opts.scale || 1));
    if (!batches.has(name)) batches.set(name, []);
    batches.get(name).push({ m, tint: opts.tint ?? 1, color: opts.color });
    return null;
  };
  const flush = () => {
    for (const [name, list] of batches) {
      const src = M[name];
      src.updateMatrixWorld(true);
      src.traverse((part) => {
        if (!part.isMesh) return;
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        const c = new THREE.Color();
        list.forEach((it, i) => {
          im.setMatrixAt(i, it.m.clone().multiply(part.matrixWorld));
          im.setColorAt(i, it.color ? c.copy(it.color) : c.setScalar(it.tint));
        });
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        im.name = name;
        group.add(im);
      });
    }
  };
  const jit = (a) => (rnd() - 0.5) * a;
  const sh = BUILDINGS.shed, of = BUILDINGS.office, st = BUILDINGS.store;
  const front = sh.z + sh.d / 2;

  // --- shed apron: drums, gas, crates, welding gear (clusters with varied condition) ---
  for (let i = 0; i < 9; i++) {
    const name = i % 3 === 2 ? 'barrel_03' : 'Barrel_01';
    const x = sh.x - 22 + (i % 3) * 0.66 + jit(0.08), z = front + 1.0 + Math.floor(i / 3) * 0.66 + jit(0.08);
    put(name, x, z, rnd() * 6.28, { tint: 0.8 + rnd() * 0.35 });
  }
  put('Barrel_01', sh.x - 18.6, front + 2.4, 1.2, { y: Y0 + 0.29, rx: Math.PI / 2, tint: 0.7 }); // one lying on its side
  for (let i = 0; i < 6; i++) put('propane_tank', sh.x + 24 + (i % 3) * 0.4, front + 0.35 + Math.floor(i / 3) * 0.42, rnd() * 6.28);
  put('worn_metal_rack', sh.x + 24.4, front + 0.2, Math.PI);
  put('portable_welding_cart', sh.x - 4, front - 3.0, 2.2);
  put('metal_tool_chest', sh.x - 9.5, front - 6.0, 0.1);
  put('hand_truck', sh.x - 25.5, front + 0.4, 0.4, { rx: -0.25 });
  put('portable_generator', sh.x + 14, front + 3.2, 0.7);
  put('old_military_crate', sh.x + 31, front + 3, 0.05);
  put('wooden_crate_01', sh.x + 31, front + 4.4, 0.08);
  put('wooden_crate_02', sh.x + 31.2, front + 3.7, -0.04, { y: Y0 + 0.35 });
  put('wooden_military_crate', sh.x + 28.6, front + 4.2, 0.6);
  for (let i = 0; i < 4; i++) put('plastic_crate_01', sh.x - 28 + i * 0.32, front + 0.3, 0, { y: Y0 + (i % 2) * 0.27 });
  for (let i = 0; i < 3; i++) put('metal_jerrycan', sh.x - 26.5 + i * 0.4, front + 1.6, rnd() * 0.4);
  // pallet of cement bags
  const pb = new Batch();
  const pal = lib.make('pallet', 'wood_floor_deck', { color: 0x9c8466 });
  for (const x of [-0.5, 0, 0.5]) pb.add(pal, new THREE.BoxGeometry(0.1, 0.1, 1.0), V(sh.x - 14 + x, Y0 + 0.05, front + 2.2));
  pb.add(pal, new THREE.BoxGeometry(1.2, 0.03, 1.0), V(sh.x - 14, Y0 + 0.115, front + 2.2));
  group.add(pb.build('pallet'));
  for (let i = 0; i < 6; i++) put('cement_bag', sh.x - 14.2 + (i % 2) * 0.48, front + 1.9 + Math.floor((i % 4) / 2) * 0.5, (i % 2) * 0.05, { y: Y0 + 0.13 + Math.floor(i / 4) * 0.18 });
  // --- yard furniture ---
  put('fire_hydrant', of.x + 13, of.z + of.d / 2 + 1.5, 0.3);
  put('utility_box_01', of.x - 13, of.z + of.d / 2 + 0.6, 0);
  put('power_box_01', -10, QUAY.apronZ - 1.2, 0);
  put('metal_trash_can', st.x - 14, st.z + 3, Math.PI / 2);
  put('small_lpg_tank', st.x + 10.5, st.z - 2, 0);
  for (const [x, z] of [[-40, -30], [20, -36], [120, -40], [-110, -60]]) put('water_manhole_cover', x, z, rnd() * 6.28, { y: Y0 - 0.01 });
  // lighting along the back of the apron
  for (let x = QUAY.x0 + 12; x < QUAY.x1; x += 32) put('street_lamp_01', x, QUAY.apronZ + 0.8, Math.PI);
  // lifebuoys on posts along the quay
  const lb = new Batch();
  const red = lib.plain('post-red', 0x8e2a1e, 0.6, 0.1);
  for (let x = QUAY.x0 + 30; x < QUAY.x1; x += 45) {
    lb.add(red, rbox(0.12, 1.5, 0.12, 0.02), V(x, Y0 + 0.75, -2.6));
    lb.add(red, rbox(0.9, 0.08, 0.1, 0.02), V(x, Y0 + 1.42, -2.6));
    put('lifebuoy', x, -2.53, 0, { y: Y0 + 0.62 });
  }
  group.add(lb.build('buoy-posts'));
  // concrete barriers closing the quay ends
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) put('concrete_road_barrier', s * (QUAY.x1 - 3), -6 - k * 1.65, Math.PI / 2 + jit(0.05));

  // --- perimeter fence with a gate at the road ---
  const fenceLen = 8.1;
  const gate = [-48, -10];
  for (let x = -236; x < 236; x += fenceLen) {
    if (x + fenceLen > gate[0] && x < gate[1]) continue;
    put('modular_chainlink_fence', x + fenceLen / 2, QUAY.yardZ - 3, 0);
  }
  for (const s of [-1, 1]) for (let z = QUAY.yardZ - 3 + fenceLen / 2; z < -28; z += fenceLen) put('modular_chainlink_fence', s * 240, z, Math.PI / 2, { y: terrain.heightAt(s * 240, z) });
  colliders.push({ x: 0, z: QUAY.yardZ - 3, w: 480, d: 0.4, gap: gate });

  // --- containers near the store ---
  const cb = new Batch();
  const cmats = {
    cache: new Map(),
    box(c) { if (!this.cache.has(c)) this.cache.set(c, lib.make('container-' + c, 'corrugated_iron_02', { color: c, weather: { macro: 0.3, macroScale: 0.25, grimeHeight: Y0, grimeRange: 2.6, grimeAmount: 0.2 } })); return this.cache.get(c); },
    frame(c) { return this.box(c); },
    dark: lib.plain('container-dark', 0x222222, 0.6, 0.6),
  };
  const cont = [[st.x + 18, st.z + 2, 0, 0x8a3324], [st.x + 18, st.z - 1.0, 0, 0x2d5a7b], [st.x + 18, st.z + 2, 0, 0x4d6b3a, 1], [st.x + 26, st.z + 3, 0.05, 0xb4b0a6], [st.x + 26.2, st.z - 0.2, 0.03, 0x8a3324], [st.x + 22, st.z + 9, 1.57, 0x6b3a2a]];
  for (const [x, z, yaw, c, lvl] of cont) container(cb, cmats, V(x, Y0 + (lvl ? 2.6 : 0), z), yaw, c);
  group.add(cb.build('containers'));

  // --- puddles in shallow dips of the asphalt ---
  const wet = new THREE.MeshStandardMaterial({ name: 'puddle', color: 0x15171a, roughness: 0.04, metalness: 0, envMapIntensity: 1.2 });
  for (let i = 0; i < 9; i++) {
    const x = -150 + rnd() * 300, z = QUAY.yardZ + 6 + rnd() * 40;
    if (Math.abs(x - sh.x) < sh.w / 2 + 3 && Math.abs(z - sh.z) < sh.d / 2 + 3) continue;
    const pm = new THREE.Mesh(puddleGeometry(0.8 + rnd() * 1.8, i + 3), wet);
    pm.position.set(x, Y0 - 0.012, z);
    pm.rotation.y = rnd() * 6.28;
    pm.receiveShadow = true;
    group.add(pm);
  }

  // --- navigation buoys (floating; driven by the wave model) ---
  for (const [name, x, z, off] of [['lateral_sea_marker', -140, 430, -1.2], ['lateral_sea_marker', 150, 470, -1.2], ['ocean_buoy', -330, 260, -0.4], ['ocean_buoy', 300, 640, -0.4]]) {
    const o = put(name, x, z, rnd() * 6.28, { y: 0, single: true });
    if (o) floaters.push({ obj: o, base: V(x, 0, z), offset: off });
  }
  if (M.lateral_sea_marker) {
    // tint the starboard-hand marker green (port-hand stays red)
    const greenOne = floaters.find((f) => f.base.x > 0 && f.obj.name !== 'ocean_buoy');
    greenOne?.obj.traverse((c) => { if (c.isMesh) { c.material = c.material.clone(); c.material.color.setRGB(0.35, 0.9, 0.45); } });
  }
  flush();
  group.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true; } });
  return { group, floaters, colliders };
}

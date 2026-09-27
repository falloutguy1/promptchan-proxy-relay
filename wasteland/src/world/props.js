// Environmental storytelling and natural ground cover built from Poly Haven
// models. Placements are collected by rules, then drawn as spatially chunked
// InstancedMeshes (one per model part per 96 m tile) so the renderer can cull.
// Also: utility poles with sagging/snapped cables, the western checkpoint
// (barriers, sandbags), firewood stacks, abandoned cars.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { enhance } from '../core/shaderlib.js';
import { LOTS, CHECKPOINT, FORESTS, POND, START, inPlay } from './layout.js';
import { Geo } from './arch/geom.js';
import { TILES } from './arch/house.js';
import { CulledSet, viewFrustum } from './instancing.js';

// draw distance per model (m); default 220
const MAXD = { nettle_plant: 55, weed_plant_02: 55, fern_02: 60, dry_branches_medium_01: 45, shrub_03: 110, shrub_04: 90, tree_stump_01: 120, tree_stump_02: 120, dead_tree_trunk: 140, rock_moss_set_01: 170, rock_moss_set_02: 170, russian_food_cans_01: 30, ammo_box: 40, old_gas_mask: 40, watering_can_metal_01: 50, rusted_spade_01: 50, wooden_bucket_01: 70, trashbag: 90, modular_electricity_poles: 600, covered_car: 400, street_lamp_01: 350 };
const PLANTS = { nettle_plant: 0.9, weed_plant_02: 0.6, fern_02: 0.8, shrub_03: 1.2, shrub_04: 0.7 };
const BIG_SHADOW = new Set(['covered_car', 'concrete_road_barrier', 'modular_electricity_poles', 'street_lamp_01', 'rock_moss_set_01', 'rock_moss_set_02', 'dead_tree_trunk', 'Barrel_01', 'Barrel_02', 'old_bed_frame', 'painted_wooden_cabinet', 'wooden_bookshelf_worn', 'scandinavian_masonry_heater', 'WoodenTable_01', 'wooden_picnic_table', 'utility_box_01', 'portable_searchlight']);

const _dir = new THREE.Vector3();

export class Props {
  constructor(world) {
    this.world = world;
    this.terrain = world.terrain;
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.items = [];     // {id, variant, m: Matrix4, shadow}
    this.rng = new RNG(777);
    this.loot = [];      // scavengeable spots for the simulation
    this.buckets = [];
  }

  /** Refill instance buffers with what the camera can see (throttled on movement). */
  update(camera, scale = 1, force = false) {
    if (!this.sets) return;
    const c = camera.position, d = camera.getWorldDirection(_dir);
    if (!force && this.lastCam && c.distanceToSquared(this.lastCam) < 0.5 && d.dot(this.lastDir) > 0.9995) return;
    this.lastCam = (this.lastCam || new THREE.Vector3()).copy(c);
    this.lastDir = (this.lastDir || new THREE.Vector3()).copy(d);
    const f = viewFrustum(camera);
    for (const set of this.sets) set.update(f, c, set.id && PLANTS[set.id] ? scale : 1);
  }

  add(id, x, z, { ry = 0, rx = 0, rz = 0, s = 1, y = null, variant = -1, shadow = true, sink = 0, center = false } = {}) {
    const t = this.terrain;
    const yy = (y ?? t.height(x, z)) - sink;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, yy, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
    this.items.push({ id, variant, m, shadow, center });
  }

  async build(assets, town) {
    const R = this.rng, t = this.terrain;
    town.furnish(this, town.rng);
    this.#houseClutter(town);
    this.#roadside();
    this.#checkpoint();
    this.#nature();
    const cables = this.#poles();
    // load all referenced models and instance them
    const ids = [...new Set(this.items.map((i) => i.id))];
    const models = new Map();
    await Promise.all(ids.map(async (id) => models.set(id, await assets.model(id))));
    // plants: wind sway; leaves never get glossy (tiny cut-out leaves sparkle otherwise, worst at night)
    const matte = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = max( roughnessFactor, 0.72 );'); };
    for (const [id, g] of models) if (g && PLANTS[id]) {
      g.scene.traverse((o) => { if (o.isMesh) enhance(o.material, { wind: { amp: 0.12, flutter: 0.04, height: PLANTS[id] }, porosity: 0.6, key: 'plant-matte', extra: matte }); });
    }
    this.#instance(models);
    this.group.add(cables);
    this.group.add(this.#geoProps(assets));
    return this.group;
  }

  // ------------------------------------------------------------- rules
  #houseClutter(town) {
    const R = this.rng;
    for (const b of town.buildings) {
      const lot = b.lot;
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      const W = (lot.w) / 2, D = (lot.d) / 2;
      const toW = (lx, lz) => [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c];
      if (lot.type === 'house' || lot.type === 'shed' || lot.type === 'store' || lot.type === 'barn') {
        // weeds and nettles hugging the walls
        const n = Math.round((W + D) * 0.8);
        for (let i = 0; i < n; i++) {
          const side = R.int(0, 3);
          const u = R.float(-1, 1);
          const off = R.float(0.35, 1.2);
          const [lx, lz] = side === 0 ? [u * W, D + off] : side === 1 ? [u * W, -D - off] : side === 2 ? [W + off, u * D] : [-W - off, u * D];
          if (side === 0 && lot.type === 'house' && Math.abs(lx - (b.res.anchors?.door?.x ?? 99)) < 1.2) continue;
          const [x, z] = toW(lx, lz);
          this.add(R.chance(0.55) ? 'nettle_plant' : 'weed_plant_02', x, z, { ry: R.float(0, 6.28), s: R.float(0.7, 1.25), variant: R.int(0, 3), shadow: false });
        }
      }
      if (lot.type === 'house') {
        const back = (lx, off = 0.8) => toW(lx, -D - off);
        const [bx, bz] = back(R.float(-W + 1, W - 1));
        this.add('Barrel_01', bx, bz, { ry: R.float(0, 6), rz: R.chance(0.2) ? Math.PI / 2 : 0 });
        if (R.chance(0.6)) { const [x, z] = back(R.float(-W + 1, W - 1), 1.2); this.add('old_tyre', x, z, { rx: Math.PI / 2 * (R.chance(0.5) ? 1 : 0), ry: R.float(0, 6) }); }
        if (R.chance(0.5)) { const [x, z] = toW(W + 0.9, R.float(-D + 1, D - 1)); this.add('wooden_bucket_01', x, z, { ry: R.float(0, 6) }); }
        if (R.chance(0.5)) { const [x, z] = toW(-W - 1, R.float(-D + 1, D - 1)); this.add('trashbag', x, z, { ry: R.float(0, 6), s: R.float(0.9, 1.2) }); }
        if (R.chance(0.35)) { const [x, z] = toW(R.float(-W, W), D + 3.5); this.add('rusted_spade_01', x, z, { ry: R.float(0, 6), rx: Math.PI / 2 - 0.05, y: this.terrain.height(x, z) + 0.03 }); }
        if (R.chance(0.3)) { const [x, z] = toW(R.float(-W, W), D + 5); this.add('watering_can_metal_01', x, z, { ry: R.float(0, 6), rz: R.chance(0.5) ? 1.4 : 0 }); }
        if ((lot.condition ?? 0.5) > 0.4 && R.chance(0.45)) {
          // abandoned car in the yard, tarp still on
          const [x, z] = toW(W + 3.2, D + 2.5);
          this.add('covered_car', x, z, { ry: -lot.rot + R.float(-0.3, 0.3) + Math.PI / 2 });
        }
        // firewood stack against a side wall (procedural logs)
        if (R.chance(0.6)) this.firewood.push({ x: toW(-W - 0.6, R.float(-D + 1.5, D - 1.5)), rot: lot.rot + Math.PI / 2 });
        this.loot.push({ id: lot.id, x: lot.x, z: lot.z, kind: 'house', value: 1 + (1 - (lot.condition ?? 0.5)) * 0.5 });
      }
      if (lot.type === 'gas_station') {
        const pts = [[-9, 6], [-8, 7.2], [6, -4], [7, -3.2], [-3, 9], [10, 8]];
        for (const [lx, lz] of pts) { const [x, z] = toW(lx, lz); this.add(R.pick(['Barrel_02', 'metal_jerrycan_green', 'plastic_jerrycan', 'Barrel_01']), x, z, { ry: R.float(0, 6), rz: R.chance(0.25) ? Math.PI / 2 : 0 }); }
        for (let i = 0; i < 4; i++) { const [x, z] = toW(-11 + i * 0.25, -3 + i * 0.05); this.add('old_tyre', x, z, { rx: Math.PI / 2, ry: R.float(0, 6), y: this.terrain.height(x, z) + 0.08 + i * 0.17 }); }
        { const [x, z] = toW(2, 3.5); this.add('covered_car', x, z, { ry: -lot.rot + 1.45 }); }
        { const [x, z] = toW(-4, -4.5); this.add('street_lamp_01', x, z, { ry: -lot.rot }); }
        this.loot.push({ id: lot.id, x: lot.x, z: lot.z, kind: 'fuel', value: 1.4 });
      }
      if (lot.type === 'store') {
        for (let i = 0; i < 5; i++) { const [x, z] = toW(R.float(-6, 6), D + R.float(1, 3)); this.add(R.pick(['cardboard_box_01', 'plastic_crate_01', 'trashbag', 'wooden_crate_01']), x, z, { ry: R.float(0, 6) }); }
        { const [x, z] = toW(W + 1.5, D + 1.5); this.add('street_lamp_01', x, z, { ry: -lot.rot + 0.3 }); }
        { const [x, z] = toW(-W - 1.2, 0); this.add('metal_trash_can', x, z, { ry: -lot.rot }); }
        this.loot.push({ id: lot.id, x: lot.x, z: lot.z, kind: 'store', value: 1.6 });
      }
      if (lot.type === 'bus_stop') {
        { const [x, z] = toW(1.6, 0.4); this.add('plastic_monobloc_chair_01', x, z, { ry: -lot.rot + 2.5, rz: 1.5 }); }
        { const [x, z] = toW(-3.2, 0.6); this.add('trashbag', x, z, { ry: 1 }); }
      }
      if (lot.type === 'barn') {
        for (let i = 0; i < 6; i++) { const [x, z] = toW(R.float(-W, W), D + R.float(1, 6)); this.add(R.pick(['old_tyre', 'Barrel_02', 'wooden_crate_01', 'cement_bag']), x, z, { ry: R.float(0, 6) }); }
        this.loot.push({ id: lot.id, x: lot.x, z: lot.z, kind: 'farm', value: 1.2 });
      }
    }
  }

  #roadside() {
    const R = this.rng;
    const hw = this.terrain.roads.find((r) => r.id === 'highway');
    // abandoned cars on the highway, some slewed across the lanes
    for (const s of [0.18, 0.31, 0.44, 0.58, 0.77]) {
      const p = hw.samples[Math.floor(s * hw.samples.length)];
      if (!inPlay(p.x, p.z, -60)) continue;
      const lat = R.float(-2.5, 2.5);
      const x = p.x - p.tz * lat, z = p.z + p.tx * lat;
      this.add('covered_car', x, z, { ry: Math.atan2(p.tx, p.tz) + R.float(-0.6, 0.6) + (R.chance(0.5) ? Math.PI : 0) });
      this.add('old_tyre', x + R.float(-3, 3), z + R.float(-3, 3), { rx: Math.PI / 2, ry: R.float(0, 6), y: this.terrain.height(x, z) + 0.08 });
    }
  }

  #checkpoint() {
    const R = this.rng, C = CHECKPOINT;
    const hw = this.terrain.roads.find((r) => r.id === 'highway');
    let best = hw.samples[0], bd = 1e9;
    for (const p of hw.samples) { const d = Math.hypot(p.x - C.x, p.z - C.z); if (d < bd) { bd = d; best = p; } }
    const yaw = Math.atan2(best.tx, best.tz);
    // staggered barrier chicane across the road
    for (let i = -3; i <= 3; i++) {
      const lat = i * 1.5 + (i % 2 ? 0.3 : 0), along = (i % 2) * 3.5;
      const x = best.x - best.tz * lat + best.tx * along, z = best.z + best.tx * lat + best.tz * along;
      if (R.chance(0.15)) continue;
      this.add('concrete_road_barrier', x, z, { ry: yaw + Math.PI / 2 + R.float(-0.12, 0.12) });
    }
    this.checkpoint = { x: best.x, z: best.z, yaw };
    for (const [lat, along, id] of [[6.5, -2, 'old_military_crate'], [7.2, 1, 'wooden_crate_01'], [6.8, 3, 'ammo_box'], [-6.5, 0, 'metal_jerrycan_green'], [7.5, -4, 'portable_searchlight'], [5.5, 5, 'old_gas_mask']]) {
      const x = best.x - best.tz * lat + best.tx * along, z = best.z + best.tx * lat + best.tz * along;
      this.add(id, x, z, { ry: yaw + R.float(-1, 1), variant: 0 });
    }
    this.loot.push({ id: 'checkpoint', x: best.x, z: best.z, kind: 'military', value: 2.0 });
  }

  #nature() {
    const R = this.rng, t = this.terrain;
    const half = t.half - 20;
    for (let i = 0; i < 6000; i++) {
      const x = R.float(-half, half), z = R.float(-half, half);
      const f = t.sample(t.forest, x, z);
      if (t.sample(t.roadDist, x, z) < 3 || t.sample(t.lotMask, x, z) > 0.3 || t.sample(t.pondDist, x, z) < 2) continue;
      const slope = t.slope(x, z);
      if (f > 0.35 && R.chance(0.55)) {
        // forest floor: fern clusters, deadfall, stumps, mossy rocks
        const r = R.next();
        if (r < 0.62) {
          const n = R.int(1, 3);
          for (let k = 0; k < n; k++) this.add('fern_02', x + R.float(-1.6, 1.6), z + R.float(-1.6, 1.6), { ry: R.float(0, 6.28), s: R.float(0.7, 1.3), variant: R.int(0, 3), shadow: false });
        } else if (r < 0.72) this.add('dead_tree_trunk', x, z, { ry: R.float(0, 6.28), s: R.float(0.8, 1.4), sink: 0.08 });
        else if (r < 0.8) this.add(R.chance(0.5) ? 'tree_stump_01' : 'tree_stump_02', x, z, { ry: R.float(0, 6.28), s: R.float(0.7, 1.1), sink: 0.1 });
        else if (r < 0.9) this.add(R.chance(0.5) ? 'rock_moss_set_01' : 'rock_moss_set_02', x, z, { ry: R.float(0, 6.28), s: R.float(0.6, 1.4), variant: R.int(0, 5), sink: 0.15 });
        else this.add('dry_branches_medium_01', x, z, { ry: R.float(0, 6.28), variant: R.int(0, 2), shadow: false });
      } else if (f > 0.08 && f <= 0.35 && R.chance(0.1) && Math.hypot(x - START.x, z - START.z) > 42) {
        // forest edge: shrubs grow in thickets where the ground suits them, not evenly
        const cl = t.noise.noise(x / 37, z / 37) * 0.7 + t.noise.noise(x / 11 + 9, z / 11) * 0.3;
        if (cl < 0.12) continue;
        const n = 1 + Math.floor(R.float(0, 3) * cl * 2);
        for (let k = 0; k < n; k++) {
          const a = R.float(0, 6.28), r = R.float(0, 2.2) * Math.sqrt(k);
          this.add(R.chance(0.55) ? 'shrub_03' : 'shrub_04', x + Math.cos(a) * r, z + Math.sin(a) * r, { ry: R.float(0, 6.28), s: R.float(0.6, 1.5) * (k ? 0.8 : 1), variant: R.int(0, 3), shadow: true });
        }
      } else if (f <= 0.08 && R.chance(0.012)) {
        if (slope > 0.12 && R.chance(0.6)) this.add(R.chance(0.5) ? 'rock_moss_set_01' : 'rock_moss_set_02', x, z, { ry: R.float(0, 6.28), s: R.float(0.5, 1.1), variant: R.int(0, 5), sink: 0.12 });
        else this.add('shrub_03', x, z, { ry: R.float(0, 6.28), s: R.float(0.8, 1.3), variant: R.int(0, 3) });
      }
    }
    // pond margin: nettles/weeds and rocks
    for (let i = 0; i < 40; i++) {
      const a = R.float(0, Math.PI * 2);
      const r = this.terrain.pondRadiusAt(a) + R.float(1.5, 5);
      const x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
      this.add(R.chance(0.7) ? 'weed_plant_02' : 'shrub_04', x, z, { ry: R.float(0, 6), s: R.float(0.8, 1.5), variant: R.int(0, 3), shadow: false });
    }
  }

  // ------------------------------------------------------------- instancing
  #instance(models) {
    const buckets = new Map();
    const _m = new THREE.Matrix4();
    const centres = new Map();
    for (const it of this.items) {
      const g = models.get(it.id);
      if (!g) continue;
      const root = g.scene;
      root.updateMatrixWorld(true);
      const kids = root.children;
      let parts = [];
      let recentre = new THREE.Matrix4();
      if (it.variant >= 0 && kids.length > 1) {
        const k = kids[it.variant % kids.length];
        k.traverse((o) => { if (o.isMesh) parts.push(o); });
        const wp = new THREE.Vector3().setFromMatrixPosition(k.matrixWorld);
        recentre.makeTranslation(-wp.x, 0, -wp.z);
      } else {
        root.traverse((o) => { if (o.isMesh) parts.push(o); });
        if (it.center) {
          if (!centres.has(it.id)) centres.set(it.id, new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()));
          const c = centres.get(it.id);
          recentre.makeTranslation(-c.x, 0, -c.z);
        }
      }
      for (const mesh of parts) {
        let b = buckets.get(mesh.uuid);
        if (!b) { b = { mesh, list: [], shadow: it.shadow, id: it.id }; buckets.set(mesh.uuid, b); }
        _m.multiplyMatrices(it.m, recentre).multiply(mesh.matrixWorld);
        b.list.push(_m.clone());
      }
    }
    this.sets = [];
    // lighter presets: small clutter and plants cast no shadow and are drawn less far
    const v = this.world.settings.values;
    const rich = v.shadowSize >= 4096, dScale = v.drawDistance >= 900 ? 1 : v.drawDistance >= 700 ? 0.8 : 0.6;
    for (const b of buckets.values()) {
      const shadow = b.shadow && (rich || BIG_SHADOW.has(b.id));
      const set = new CulledSet(b.mesh.geometry, b.mesh.material, b.list, { shadow, maxD: (MAXD[b.id] ?? 220) * (BIG_SHADOW.has(b.id) ? 1 : dScale) });
      set.id = b.id;
      this.sets.push(set);
      this.group.add(set.im);
    }
    this.instanceCount = this.items.length;
  }

  // ------------------------------------------------------------- utility poles + cables
  #poles() {
    const grp = new THREE.Group();
    const hw = this.terrain.roads.find((r) => r.id === 'highway');
    const R = this.rng;
    const S = hw.samples;
    const poles = [];
    let acc = 0;
    for (let i = 1; i < S.length; i++) {
      acc += Math.hypot(S[i].x - S[i - 1].x, S[i].z - S[i - 1].z);
      if (acc < 42) continue;
      acc = 0;
      const p = S[i];
      if (!inPlay(p.x, p.z, -120)) continue;
      const off = 8.5;
      const x = p.x + p.tz * off, z = p.z - p.tx * off; // north side
      const yaw = Math.atan2(p.tx, p.tz);
      const lean = R.chance(0.2) ? R.float(-0.12, 0.12) : 0;
      poles.push({ x, z, y: this.terrain.height(x, z), yaw, lean });
      this.add('modular_electricity_poles', x, z, { ry: yaw + Math.PI / 2, rz: lean, sink: 0.3, center: true });
    }
    // cables: catenaries between neighbouring poles, a few snapped
    const g = new Geo(TILES);
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i], b = poles[i + 1];
      if (R.chance(0.12)) continue;
      for (const k of [-0.55, 0, 0.55]) {
        const snapped = R.chance(0.1);
        const pa = new THREE.Vector3(a.x + Math.cos(a.yaw) * k, a.y + 5.55, a.z - Math.sin(a.yaw) * k);
        const pb = new THREE.Vector3(b.x + Math.cos(b.yaw) * k, b.y + 5.55, b.z - Math.sin(b.yaw) * k);
        const pts = [];
        const n = 14;
        for (let j = 0; j <= n; j++) {
          const f = j / n;
          const p = pa.clone().lerp(pb, f);
          p.y -= Math.sin(f * Math.PI) * 0.9;
          if (snapped && f > 0.55) { p.lerp(new THREE.Vector3(pb.x, this.terrain.height(pb.x, pb.z) + 0.05, pb.z), (f - 0.55) / 0.45); }
          pts.push(p);
        }
        g.tube('dark', pts, 0.012, 4, false);
      }
    }
    const built = g.build();
    for (const [, geo] of built) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 0.6, metalness: 0.2 }));
      enhance(m.material, { key: 'cable' });
      m.castShadow = true;
      grp.add(m);
    }
    return grp;
  }

  // ------------------------------------------------------------- procedural props: sandbags, firewood
  firewood = [];
  #geoProps(assets) {
    const R = this.rng, t = this.terrain;
    const g = new Geo(TILES);
    g.exposure = 1;
    // sandbag walls either side of the checkpoint
    const C = this.checkpoint;
    if (C) {
      for (const side of [-1, 1]) {
        const cx = C.x - Math.cos(C.yaw) * 7.5 * side, cz = C.z + Math.sin(C.yaw) * 7.5 * side;
        const y0 = t.height(cx, cz);
        g.pushTRS(cx, y0, cz, C.yaw + Math.PI / 2);
        for (let row = 0; row < 4; row++) for (let i = -4; i <= 4; i++) {
          if (row === 3 && R.chance(0.4)) continue;
          g.pushTRS(i * 0.58 + (row % 2) * 0.29, 0.11 + row * 0.2, 0, R.float(-0.08, 0.08), R.float(-0.04, 0.04), 0);
          g.box('burlap:#b7a88a', 0, 0, 0, 0.56, 0.2, 0.34, 0.06);
          g.pop();
        }
        g.pop();
      }
    }
    // firewood stacks
    for (const f of this.firewood) {
      const [x, z] = f.x;
      const y0 = t.height(x, z);
      g.pushTRS(x, y0, z, f.rot);
      for (let row = 0; row < 5; row++) for (let i = 0; i < 8 - row; i++) {
        const r = R.float(0.07, 0.11);
        const px = -0.9 + i * 0.23 + row * 0.115;
        const py = 0.1 + row * 0.19;
        g.tube('wood_weathered:#8a7a66', [new THREE.Vector3(px, py, -0.45), new THREE.Vector3(px + R.float(-0.02, 0.02), py, 0.45)], r, 7, true);
      }
      g.pop();
    }
    const grp = new THREE.Group();
    const mats = this.world.town.mats;
    for (const [key, geo] of g.build()) {
      const m = new THREE.Mesh(geo, mats.get(key));
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    return grp;
  }
}

// Colony structures in the world: placement rules and wall snapping, the
// placement ghost, staged construction meshes, batching of finished structures
// (one merged mesh per material across the whole colony), furniture models,
// navigation/collider registration, ground painting and lights.
import * as THREE from 'three';
import { STRUCTURES } from './defs.js';
import { buildStructure, COLONY_TILES } from '../world/arch/colony.js';
import { F_STRUCT, F_WALL, F_GATE, F_BLOCK, F_WATER } from './nav.js';
import { WATER_LEVEL, inPlay } from '../world/layout.js';
import { enhance } from '../core/shaderlib.js';

const STAGES = 12;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

export const STRUCTURE_MODELS = [
  'stone_fire_pit', 'barrel_stove', 'old_bed_frame', 'wooden_crate_01', 'plastic_crate_01', 'cardboard_box_01', 'cement_bag', 'Barrel_01', 'Barrel_02',
  'metal_jerrycan_green', 'plastic_jerrycan', 'russian_food_cans_01', 'wooden_bucket_01', 'nettle_plant', 'rusted_spade_01', 'watering_can_metal_01',
  'WoodenTable_01', 'steel_frame_shelves_01', 'propane_tank', 'old_tyre', 'hatchet', 'rusted_wheel_rim_01', 'portable_searchlight', 'old_military_crate',
  'medical_box', 'portable_generator', 'vintage_radio_transceiver',
];

function mergeInto(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const out = new THREE.BufferGeometry();
  const attrs = { position: 3, normal: 3, uv: 2, wear: 2 };
  for (const [name, size] of Object.entries(attrs)) {
    const arr = new Float32Array(nv * size);
    let o = 0;
    for (const g of list) { const a = g.attributes[name].array; arr.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(ni);
  let o = 0, base = 0;
  for (const g of list) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[o++] = a[i] + base; base += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

export class Structures {
  constructor(sim) {
    this.sim = sim;
    this.world = sim.world;
    this.terrain = sim.world.terrain;
    this.nav = sim.nav;
    this.mats = sim.world.town.mats;
    this.dyn = sim.dyn;
    this.list = [];
    this.byId = new Map();
    this.group = new THREE.Group(); this.group.name = 'colony';
    this.building = new THREE.Group(); this.building.name = 'colony-sites';
    this.batch = new THREE.Group(); this.batch.name = 'colony-batch';
    this.group.add(this.building, this.batch);
    this.parts = new Map();   // key -> Map(id -> world geometry)
    this.meshes = new Map();  // key -> merged mesh
    this.dirty = new Set();
    this.matCache = new Map();
    this.nextId = 1;
    this.lampMat = null;
  }

  // ------------------------------------------------------------ materials
  mat(key) {
    if (this.matCache.has(key)) return this.matCache.get(key);
    let m;
    if (key === 'lamp') {
      m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.92, 0.78), emissiveIntensity: 0, roughness: 0.3 });
      enhance(m, { wet: false, key: 'lamp' });
      this.lampMat = m;
    } else if (key === 'beacon') {
      m = new THREE.MeshStandardMaterial({ color: 0x401010, emissive: new THREE.Color(1, 0.12, 0.06), emissiveIntensity: 0, roughness: 0.4 });
      enhance(m, { wet: false, key: 'beacon' });
      this.beaconMat = m;
    } else if (key === 'redcross') {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#d4cfbe'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#a8231c'; g.fillRect(96, 40, 64, 176); g.fillRect(40, 96, 176, 64);
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${90 + Math.random() * 40},${80 + Math.random() * 30},${60},${Math.random() * 0.12})`; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, Math.random() * 14, 0, 7); g.fill(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
      enhance(m, { porosity: 0.9, key: 'redcross' });
    } else if (key === 'glass') m = this.mats.get('glass');
    else if (key === 'dark') m = this.mats.get('dark');
    else if (key.startsWith('canvas')) m = this.mats.get(key, { side: THREE.DoubleSide });
    else if (key.startsWith('metal')) m = this.mats.get(key, { metal: 0.45, rough: 1 });
    else m = this.mats.get(key);
    this.matCache.set(key, m);
    return m;
  }

  // ------------------------------------------------------------ placement
  /** Validate a placement. Returns { ok, reason, y }. */
  check(type, x, z, rot) {
    const def = STRUCTURES[type];
    if (!inPlay(x, z, 8)) return { ok: false, reason: 'Outside the settlement area' };
    if (def.unique && this.count(type, true) >= def.unique) return { ok: false, reason: `Only ${def.unique} allowed` };
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const t = this.terrain, nav = this.nav;
    let lo = Infinity, hi = -Infinity;
    const pad = def.nav === 'wall' || def.nav === 'gate' ? 0 : 0.3;
    const hw = def.w / 2 + pad, hd = def.d / 2 + pad;
    for (let lz = -hd; lz <= hd + 1e-6; lz += Math.max(0.5, hd)) for (let lx = -hw; lx <= hw + 1e-6; lx += Math.max(0.5, Math.min(1, hw))) {
      const wx = x + lx * cs + lz * sn, wz = z - lx * sn + lz * cs;
      const h = t.height(wx, wz);
      if (h < WATER_LEVEL + 0.45) return { ok: false, reason: 'Too close to water' };
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      const i = nav.cellOf(wx, wz);
      if (i < 0) return { ok: false, reason: 'Outside the settlement area' };
      const f = nav.flags[i];
      // walls may touch other walls at their ends (they join into a continuous line)
      const endZone = (def.nav === 'wall' || def.nav === 'gate') && Math.abs(lx) > def.w / 2 - 1.1;
      if ((f & F_STRUCT) || (!endZone && (f & (F_WALL | F_GATE)))) return { ok: false, reason: 'Overlaps another structure' };
      if (f & (F_BLOCK | F_WATER)) return { ok: false, reason: 'Blocked by a building or steep ground' };
    }
    // trees in the footprint
    const tr = this.world.trees.nearest(x, z);
    if (tr && Math.hypot(tr.x - x, tr.z - z) < Math.max(def.w, def.d) * 0.5 + 0.4 && def.nav !== 'wall' && def.nav !== 'gate') return { ok: false, reason: 'A tree is in the way' };
    const limit = def.nav === 'wall' || def.nav === 'gate' ? 1.6 : type === 'farm' ? 1.4 : 1.0;
    if (hi - lo > limit) return { ok: false, reason: 'Ground too uneven' };
    return { ok: true, y: lo + (hi - lo) * 0.35 };
  }

  /** Snap walls/gates end-to-end: returns {x, z, rot} or null. */
  snapWall(x, z, rot) {
    let best = null, bd = 3.2;
    for (const s of this.list) {
      if (s.def.nav !== 'wall' && s.def.nav !== 'gate') continue;
      const ex = Math.cos(s.rot) * s.def.w / 2, ez = -Math.sin(s.rot) * s.def.w / 2;
      for (const sg of [1, -1]) {
        const px = s.x + ex * sg, pz = s.z + ez * sg;
        const d = Math.hypot(x - px, z - pz);
        if (d < bd) { bd = d; best = { px, pz, s, sg }; }
      }
    }
    if (!best) return null;
    let dx = x - best.px, dz = z - best.pz;
    const L = Math.hypot(dx, dz);
    if (L < 0.6) { dx = Math.cos(best.s.rot) * best.sg; dz = -Math.sin(best.s.rot) * best.sg; }
    else { dx /= L; dz /= L; }
    const len = 4.0;
    return { x: best.px + dx * len / 2, z: best.pz + dz * len / 2, rot: Math.atan2(-dz, dx) };
  }

  count(type, includeSites = false) { let n = 0; for (const s of this.list) if (s.type === type && (includeSites || s.built)) n++; return n; }

  // ------------------------------------------------------------ ghost
  ghost(type) {
    if (this.ghostMesh?.userData.type === type) return this.ghostMesh;
    this.clearGhost();
    const def = STRUCTURES[type];
    const res = buildStructure(type, 1, { progress: 1, w: def.w, d: def.d });
    const geos = [...res.geo.values()].map((g) => { const c = new THREE.BufferGeometry(); c.setAttribute('position', g.attributes.position); c.setAttribute('normal', g.attributes.normal); c.setIndex(g.index); return c; });
    const merged = geos.length ? mergeInto(geos.map((g) => { g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.setAttribute('wear', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })) : new THREE.BoxGeometry(def.w, 1, def.d);
    const mat = new THREE.MeshLambertMaterial({ color: 0x86d07a, transparent: true, opacity: 0.42, depthWrite: false, emissive: 0x1a3a18 });
    const mesh = new THREE.Mesh(merged, mat);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.d, Math.ceil(def.w * 2), Math.ceil(def.d * 2)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x86d07a, transparent: true, opacity: 0.22, depthWrite: false }));
    const grp = new THREE.Group();
    grp.add(mesh, pad);
    grp.userData = { type, mesh, pad, models: res.models };
    grp.renderOrder = 5;
    this.ghostMesh = grp;
    this.group.add(grp);
    return grp;
  }
  updateGhost(x, z, rot, ok) {
    const g = this.ghostMesh;
    if (!g) return;
    const y = this.terrain.height(x, z);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    const col = ok ? 0x86d07a : 0xe06050;
    g.userData.mesh.material.color.setHex(col); g.userData.pad.material.color.setHex(col);
    g.userData.mesh.material.emissive.setHex(ok ? 0x1a3a18 : 0x3a1410);
    // drape the pad on the terrain
    const pos = g.userData.pad.geometry.attributes.position, cs = Math.cos(rot), sn = Math.sin(rot);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      pos.setY(i, this.terrain.height(x + lx * cs + lz * sn, z - lx * sn + lz * cs) - y + 0.06);
    }
    pos.needsUpdate = true;
    g.visible = true;
  }
  clearGhost() {
    if (!this.ghostMesh) return;
    this.group.remove(this.ghostMesh);
    this.ghostMesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.ghostMesh = null;
  }

  // ------------------------------------------------------------ lifecycle
  /** Create a structure (a construction site unless built). */
  create(type, x, z, rot, { built = false, progress = 0, hp = null, id = null, seed = null, y = null, extra = {} } = {}) {
    const def = STRUCTURES[type];
    const s = {
      id: id ?? this.nextId++, type, def, x, z, rot, y: y ?? this.check(type, x, z, rot).y ?? this.terrain.height(x, z),
      progress: built ? 1 : progress, built: false, hp: 0, maxHp: def.hp, seed: seed ?? ((Math.random() * 1e6) | 0),
      workers: new Set(), models: [], stage: -1, extra: { growth: 0, open: true, dmgStage: 0, ...extra }, spots: {}, mesh: null,
    };
    this.nextId = Math.max(this.nextId, s.id + 1);
    s.hp = hp ?? (built ? def.hp : Math.max(20, def.hp * 0.25));
    this.list.push(s);
    this.byId.set(s.id, s);
    this.#register(s);
    this.#ground(s);
    if (built) this.complete(s, true); else this.#rebuild(s);
    return s;
  }

  #matrix(s) { return _m.compose(_p.set(s.x, s.y, s.z), _q.setFromAxisAngle(_up, s.rot), _s.set(1, 1, 1)).clone(); }
  toWorld(s, lx, lz, ly = 0) {
    const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
    return { x: s.x + lx * cs + lz * sn, y: s.y + ly, z: s.z - lx * sn + lz * cs };
  }

  #register(s) {
    const def = s.def, nav = this.nav;
    if (def.nav === 'wall' || def.nav === 'gate') {
      const ex = Math.cos(s.rot) * (def.w / 2 - 0.1), ez = -Math.sin(s.rot) * (def.w / 2 - 0.1);
      nav.line(s.x - ex, s.z - ez, s.x + ex, s.z + ez, def.nav === 'wall' ? F_WALL : F_GATE, s.id);
    } else if (def.nav === 'block') {
      const w = s.type === 'campfire' ? 1.5 : def.w, d = s.type === 'campfire' ? 1.5 : def.d;
      nav.rect(s.x, s.z, w, d, s.rot, F_STRUCT, s.id, 0);
      s.collider = { x: s.x, z: s.z, hw: w / 2, hd: d / 2, rot: s.rot };
      this.sim.colliders.add(s.collider);
    }
    this.sim.navVersion++;
  }

  #ground(s) {
    const t = this.terrain, def = s.def;
    // trampled ground: worn grass rather than bare soil, except the fire pit and fields
    if (s.type === 'farm') t.paintRect(s.x, s.z, def.w - 0.4, def.d - 0.4, s.rot, { soil: 0.75, mud: 0.2, stripes: 1.1, feather: 0.9 });
    else if (def.nav === 'wall' || def.nav === 'gate') t.paintRect(s.x, s.z, def.w + 0.4, 1.6, s.rot, { soil: 0.22, clearGrass: 0.7, feather: 1.6 });
    else if (s.type === 'campfire') t.paintRect(s.x, s.z, 3.0, 3.0, s.rot, { soil: 0.55, gravel: 0.05, feather: 1.6 });
    else t.paintRect(s.x, s.z, def.w + 0.6, def.d + 0.6, s.rot, { soil: 0.26, gravel: s.type === 'workshop' || s.type === 'generator' ? 0.12 : 0.02, clearGrass: 0.85, feather: 2.0 });
    this.world.grass.refreshMask();
  }

  /** Called as work is added; rebuilds the site mesh at stage boundaries. */
  setProgress(s, p) {
    s.progress = Math.min(1, p);
    s.hp = Math.max(s.hp, s.def.hp * (0.25 + 0.75 * s.progress));
    if (s.progress >= 1 && !s.built) { this.complete(s); return true; }
    const st = Math.floor(s.progress * STAGES);
    if (st !== s.stage) this.#rebuild(s);
    return false;
  }

  complete(s, silent = false) {
    s.built = true;
    s.progress = 1;
    s.hp = Math.max(s.hp, silent ? s.hp : s.def.hp);
    this.#rebuild(s);
    this.sim.onStructureComplete?.(s, silent);
  }

  /** Rebuild geometry + models for the current stage / state. */
  #rebuild(s) {
    s.stage = Math.floor(s.progress * STAGES);
    const def = s.def;
    const res = buildStructure(s.type, s.seed, { progress: s.built ? 1 : s.progress, damage: 1 - s.hp / s.maxHp > 0.5 ? 0.6 : 1 - s.hp / s.maxHp > 0.25 ? 0.3 : 0, growth: s.extra.growth, open: s.extra.open, w: def.w, d: def.d });
    // spots to world space
    s.spots = {};
    for (const [k, v] of Object.entries(res.spots)) {
      if (!Array.isArray(v)) continue;
      if (typeof v[0] === 'number') s.spots[k] = v.length === 3 ? this.toWorld(s, v[0], v[2], v[1]) : this.toWorld(s, v[0], v[1]);
      else s.spots[k] = v.map((q) => { const w = q.length === 3 && k !== 'seats' ? this.toWorld(s, q[0], q[2], q[1]) : this.toWorld(s, q[0], q[1]); if (k === 'seats') w.yaw = q[2] + s.rot; return w; });
    }
    s.height = res.height;
    // models
    for (const h of s.models) this.dyn.remove(h);
    s.models = [];
    const M = this.#matrix(s);
    for (const md of res.models) {
      const lm = new THREE.Matrix4().compose(new THREE.Vector3(md.x, md.y, md.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(md.rx || 0, md.ry || 0, md.rz || 0, 'YXZ')), new THREE.Vector3(md.s, md.s, md.s));
      const h = this.dyn.add(md.id, M.clone().multiply(lm), md.variant ?? -1, { shadow: md.id !== 'nettle_plant' });
      if (h) s.models.push(h);
    }
    // geometry: finished structures go to the shared batch, sites keep their own meshes
    if (s.mesh) { this.building.remove(s.mesh); s.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); s.mesh = null; }
    for (const [key, map] of this.parts) if (map.delete(s.id)) this.dirty.add(key);
    if (s.built) {
      for (const [key, geo] of res.geo) {
        geo.applyMatrix4(M);
        if (!this.parts.has(key)) this.parts.set(key, new Map());
        this.parts.get(key).set(s.id, geo);
        this.dirty.add(key);
      }
    } else {
      const grp = new THREE.Group();
      grp.position.set(s.x, s.y, s.z); grp.rotation.y = s.rot;
      for (const [key, geo] of res.geo) {
        const mesh = new THREE.Mesh(geo, this.mat(key));
        mesh.castShadow = key !== 'glass'; mesh.receiveShadow = true;
        grp.add(mesh);
      }
      grp.userData.structure = s.id;
      s.mesh = grp;
      this.building.add(grp);
    }
  }

  refresh(s) { this.#rebuild(s); }

  /** Merge dirty material batches (once per frame at most). */
  flush() {
    for (const key of this.dirty) {
      const map = this.parts.get(key);
      const old = this.meshes.get(key);
      if (old) { this.batch.remove(old); old.geometry.dispose(); this.meshes.delete(key); }
      if (!map || !map.size) continue;
      const mesh = new THREE.Mesh(mergeInto([...map.values()]), this.mat(key));
      mesh.castShadow = key !== 'glass' && key !== 'redcross'; mesh.receiveShadow = true;
      mesh.name = 'colony:' + key;
      if (key === 'glass') mesh.renderOrder = 3;
      this.batch.add(mesh);
      this.meshes.set(key, mesh);
    }
    this.dirty.clear();
  }

  damage(s, amount) {
    if (!s || s.hp <= 0) return false;
    const before = s.hp / s.maxHp;
    s.hp -= amount;
    const after = Math.max(0, s.hp / s.maxHp);
    if (s.hp <= 0) { this.destroy(s); return true; }
    const band = (f) => (f < 0.5 ? 2 : f < 0.75 ? 1 : 0);
    if (band(before) !== band(after)) this.#rebuild(s);
    return false;
  }

  repair(s, amount) {
    const before = s.hp / s.maxHp;
    s.hp = Math.min(s.maxHp, s.hp + amount);
    const band = (f) => (f < 0.5 ? 2 : f < 0.75 ? 1 : 0);
    if (band(before) !== band(s.hp / s.maxHp)) this.#rebuild(s);
  }

  destroy(s, { refund = false } = {}) {
    const i = this.list.indexOf(s);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.byId.delete(s.id);
    this.nav.clearOwner(s.id);
    this.sim.navVersion++;
    if (s.collider) this.sim.colliders.remove(s.collider);
    for (const h of s.models) this.dyn.remove(h);
    if (s.mesh) { this.building.remove(s.mesh); s.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
    for (const [key, map] of this.parts) if (map.delete(s.id)) this.dirty.add(key);
    s.dead = true;
    this.sim.onStructureDestroyed?.(s, refund);
  }

  /** Remove every structure and grave (new game / load). */
  resetAll() {
    for (const s of [...this.list]) {
      for (const h of s.models) this.dyn.remove(h);
      if (s.mesh) { this.building.remove(s.mesh); s.mesh.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
      if (s.collider) this.sim.colliders.remove(s.collider);
      this.nav.clearOwner(s.id);
    }
    this.list = [];
    this.byId.clear();
    for (const key of this.parts.keys()) this.dirty.add(key);
    this.parts.clear();
    this.flush();
    this.sim.navVersion++;
  }

  setOpen(s, open) { if (s.extra.open !== open) { s.extra.open = open; this.#rebuild(s); } }
  setGrowth(s, g) {
    const q = Math.round(g * 8) / 8;
    s.extra.growth = g;
    if (q !== s.extra.growthShown) { s.extra.growthShown = q; this.#rebuild(s); }
  }

  /** Structure whose footprint contains (x, z). */
  at(x, z, pad = 0.4) {
    let best = null;
    for (const s of this.list) {
      const cs = Math.cos(s.rot), sn = Math.sin(s.rot), dx = x - s.x, dz = z - s.z;
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) <= s.def.w / 2 + pad && Math.abs(lz) <= s.def.d / 2 + pad) best = s;
    }
    return best;
  }

  /** A walkable standing point next to the structure, nearest to (fx, fz). */
  approach(s, fx, fz, rng) {
    const pref = s.spots.work && !Array.isArray(s.spots.work) ? s.spots.work : s.spots.door;
    if (pref && this.nav.walkable(pref.x, pref.z)) return { x: pref.x, z: pref.z };
    const r = Math.max(s.def.w, s.def.d) / 2 + 1.0;
    let best = null, bd = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + (rng ? rng.float(0, 0.3) : 0);
      const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
      if (!this.nav.walkable(x, z)) continue;
      const d = (x - fx) ** 2 + (z - fz) ** 2;
      if (d < bd) { bd = d; best = { x, z }; }
    }
    return best || { x: s.x + r, z: s.z };
  }

  /** Graves are permanent static geometry. */
  addGrave(x, z, rot) {
    const id = -(this.nextId++);
    const y = this.terrain.height(x, z);
    const res = buildStructure('grave', Math.abs(id) * 31);
    const M = _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, rot), _s.set(1, 1, 1)).clone();
    for (const [key, geo] of res.geo) {
      geo.applyMatrix4(M);
      if (!this.parts.has(key)) this.parts.set(key, new Map());
      this.parts.get(key).set(id, geo);
      this.dirty.add(key);
    }
    this.terrain.paintRect(x, z, 1.4, 2.4, rot, { soil: 0.8, feather: 0.6 });
    this.world.grass.refreshMask();
    return { id, x, z, rot };
  }

  update(dt, night, powered) {
    this.flush();
    const t = performance.now() * 0.001;
    if (this.lampMat) this.lampMat.emissiveIntensity = night && powered ? 7 : 0;
    if (this.beaconMat) this.beaconMat.emissiveIntensity = (t % 1.6) < 0.25 ? (night ? 30 : 8) : 0.2;
  }
}

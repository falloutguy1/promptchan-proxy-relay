// Runtime-placed instanced models (colony furniture, crops, crates, barrels).
// One InstancedMesh per model part, grown by doubling; removal swaps the last
// instance into the freed slot so the buffers stay dense. Models must be
// preloaded (Assets.model caches the glTF).
import * as THREE from 'three';

const _m = new THREE.Matrix4();

// models big enough that their shadow matters on the lighter presets
const BIG = new Set(['old_bed_frame', 'WoodenTable_01', 'steel_frame_shelves_01', 'stone_fire_pit', 'portable_generator', 'Barrel_01', 'Barrel_02', 'barrel_stove', 'old_military_crate', 'wooden_crate_01']);
const NEVER = new Set(['nettle_plant', 'russian_food_cans_01', 'hatchet', 'medical_box', 'rusted_wheel_rim_01', 'watering_can_metal_01']);

export class DynModels {
  constructor(assets, { richShadows = true } = {}) {
    this.richShadows = richShadows;
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'dyn-models';
    this.kinds = new Map();     // key id:variant -> kind
    this.gltf = new Map();
  }

  async preload(ids) {
    await Promise.all(ids.map(async (id) => { if (!this.gltf.has(id)) this.gltf.set(id, await this.assets.model(id)); }));
  }

  #kind(id, variant) {
    const key = `${id}:${variant}`;
    let k = this.kinds.get(key);
    if (k) return k;
    const g = this.gltf.get(id);
    if (!g) return null;
    const root = g.scene;
    root.updateMatrixWorld(true);
    const parts = [];
    let recentre = new THREE.Matrix4();
    const kids = root.children;
    if (variant >= 0 && kids.length > 1) {
      const kid = kids[variant % kids.length];
      kid.traverse((o) => { if (o.isMesh) parts.push(o); });
      const wp = new THREE.Vector3().setFromMatrixPosition(kid.matrixWorld);
      recentre.makeTranslation(-wp.x, 0, -wp.z);
    } else root.traverse((o) => { if (o.isMesh) parts.push(o); });
    const shadow = !NEVER.has(id) && (this.richShadows || BIG.has(id));
    k = { key, slots: [], shadow, meshes: parts.map((p) => ({ src: p, local: new THREE.Matrix4().multiplyMatrices(recentre, p.matrixWorld), im: null, cap: 0 })) };
    this.kinds.set(key, k);
    return k;
  }

  #ensure(k, n) {
    for (const part of k.meshes) {
      if (part.cap >= n) continue;
      const cap = Math.max(8, part.cap * 2, n);
      const im = new THREE.InstancedMesh(part.src.geometry, part.src.material, cap);
      im.castShadow = k.shadow && part.src.castShadow; im.receiveShadow = true;
      im.frustumCulled = true; // bounding sphere over the instances is kept current in update()
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.matrixAutoUpdate = false;
      if (part.im) {
        im.instanceMatrix.array.set(part.im.instanceMatrix.array.subarray(0, part.cap * 16));
        this.group.remove(part.im);
        part.im.dispose();
      }
      im.count = k.slots.length;
      part.im = im; part.cap = cap;
      this.group.add(im);
    }
  }

  /** Add an instance; returns a handle for remove()/set(). */
  add(id, matrix, variant = -1) {
    const k = this.#kind(id, variant);
    if (!k) return null;
    const h = { k, i: k.slots.length, m: matrix.clone() };
    this.#ensure(k, k.slots.length + 1);
    k.slots.push(h);
    for (const part of k.meshes) part.im.count = k.slots.length;
    this.#write(h);
    return h;
  }

  /** Refresh bounding spheres of changed meshes so frustum culling stays right. */
  update() {
    if (!this.dirty?.size) return;
    for (const im of this.dirty) if (im.count > 0) im.computeBoundingSphere();
    this.dirty.clear();
  }

  set(h, matrix) { if (!h || h.i < 0) return; h.m.copy(matrix); this.#write(h); }

  remove(h) {
    if (!h || h.i < 0) return;
    const k = h.k, last = k.slots.pop();
    if (last !== h) { last.i = h.i; k.slots[h.i] = last; this.#write(last); }
    h.i = -1;
    for (const part of k.meshes) { part.im.count = k.slots.length; part.im.instanceMatrix.needsUpdate = true; part.im.visible = part.im.count > 0; (this.dirty ||= new Set()).add(part.im); }
  }

  #write(h) {
    for (const part of h.k.meshes) {
      _m.multiplyMatrices(h.m, part.local);
      part.im.setMatrixAt(h.i, _m);
      part.im.instanceMatrix.needsUpdate = true;
      part.im.visible = part.im.count > 0;
      (this.dirty ||= new Set()).add(part.im);
    }
  }
}

export function trs(x, y, z, ry = 0, s = 1, rx = 0, rz = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
}

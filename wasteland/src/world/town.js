// Builds every pre-collapse building on its lot, turns the per-material geometry
// into meshes, adds painted signs, furnishes interiors with Poly Haven models and
// registers walk-mode colliders.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { enhance } from '../core/shaderlib.js';
import { LOTS } from './layout.js';
import { ArchMaterials } from './arch/materials.js';
import { buildHouse } from './arch/house.js';
import { buildStore, buildGasStation, buildWaterTower, buildBarn, buildShed, buildBusStop } from './arch/landmarks.js';
import { Geo } from './arch/geom.js';
import { TILES } from './arch/house.js';
import { picketFence } from './arch/fence.js';

function mergeGeos(a, b) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'wear']) {
    const A = a.attributes[name], B = b.attributes[name];
    const arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array, 0); arr.set(B.array, A.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const n = a.attributes.position.count;
  const ia = a.index.array, ib = b.index.array;
  const idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + n;
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

export class Town {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'town';
    this.buildings = [];
  }

  async build(assets) {
    this.mats = new ArchMaterials(assets);
    await this.mats.load();
    const leak = await assets.optionalKtx(`decal/leak/${assets.tier}_c.ktx2`, THREE.SRGBColorSpace);
    const decal = new THREE.MeshStandardMaterial({ map: leak, transparent: true, depthWrite: false, roughness: 0.9, color: new THREE.Color(0.55, 0.55, 0.5), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    decal.map.wrapS = decal.map.wrapT = THREE.ClampToEdgeWrapping;
    enhance(decal, { porosity: 0.3, key: 'decal' });
    this.decalMat = decal;

    const rng = new RNG(2024);
    const merged = new Map();
    for (const lot of LOTS) {
      const r = new RNG(lot.id.length * 131 + Math.floor(lot.x * 7 + lot.z * 13));
      let res;
      if (lot.type === 'house') res = buildHouse(lot, r);
      else if (lot.type === 'store') res = buildStore(lot, r);
      else if (lot.type === 'gas_station') res = buildGasStation(lot, r);
      else if (lot.type === 'water_tower') res = buildWaterTower(lot, r);
      else if (lot.type === 'barn') res = buildBarn(lot, r);
      else if (lot.type === 'shed') res = buildShed(lot, r);
      else if (lot.type === 'bus_stop') res = buildBusStop(lot, r);
      else continue;
      this.#ground(lot, res);
      if (lot.fence) this.#fence(lot, res, r);
      const g = new THREE.Group();
      g.name = lot.id;
      g.position.set(lot.x, lot.y, lot.z);
      g.rotation.y = lot.rot;
      g.updateMatrixWorld(true);
      // static architecture is batched per material across the whole village
      for (const [key, geo] of res.geo) {
        geo.applyMatrix4(g.matrixWorld);
        if (!merged.has(key)) merged.set(key, []);
        merged.get(key).push(geo);
      }
      for (const s of res.signs || []) this.#sign(g, s);
      this.group.add(g);
      const b = { lot, group: g, res, looted: 0 };
      this.buildings.push(b);
      // colliders in world space
      for (const c of res.colliders) {
        const p = new THREE.Vector3(c.x, 0, c.z).applyMatrix4(g.matrixWorld);
        if (c.r !== undefined) this.world.colliders.push({ x: p.x, z: p.z, r: c.r });
        else this.world.colliders.push({ x: p.x, z: p.z, hw: c.hw, hd: c.hd, rot: -(lot.rot + (c.rot || 0)) });
      }
    }
    for (const [key, list] of merged) {
      let geo = list[0];
      for (let i = 1; i < list.length; i++) geo = mergeGeos(geo, list[i]);
      const mat = key === 'decal_leak' ? this.decalMat : this.mats.get(key, key.startsWith('metal') ? { metal: 0.45, rough: 1 } : {});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'arch:' + key;
      mesh.castShadow = key !== 'glass' && key !== 'decal_leak';
      mesh.receiveShadow = true;
      if (key === 'glass' || key === 'decal_leak') mesh.renderOrder = 3;
      this.group.add(mesh);
    }
    this.rng = rng;
    return this.group;
  }

  /** Trample the ground around a building and keep grass out of its footprint. */
  #ground(lot, res) {
    const t = this.world.terrain;
    const pad = lot.type === 'gas_station' ? 0 : 1.2;
    t.paintRect(lot.x, lot.z, lot.w + pad, lot.d + pad, lot.rot, { soil: lot.type === 'gas_station' ? 0.35 : 0.55, gravel: lot.type === 'gas_station' ? 0.55 : 0.1, feather: 2.2 });
    if (lot.type === 'house' && res.anchors?.door) {
      // path from the door to the road
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      const lx = res.anchors.door.x, lz = lot.d / 2 + 4;
      const wx = lot.x + lx * c + lz * s, wz = lot.z - lx * s + lz * c;
      t.paintRect(wx, wz, 1.3, 8, lot.rot, { soil: 0.8, gravel: 0.15, feather: 0.8 });
    }
  }

  #fence(lot, res, rng) {
    const W = lot.w, D = lot.d, e = 3.2, f = 7.5;
    const doorX = res.anchors?.door?.x ?? 0;
    const pts = [[-W / 2 - e, -D / 2 + 1], [-W / 2 - e, D / 2 + f], [doorX - 0.8, D / 2 + f], [doorX + 0.8, D / 2 + f], [W / 2 + e, D / 2 + f], [W / 2 + e, -D / 2 + 1]];
    const g = new Geo(TILES);
    g.exposure = 1;
    picketFence(g, pts, rng, { gate: 2, decay: 1 - (lot.condition ?? 0.5) });
    const extra = g.build();
    for (const [k, geo] of extra) {
      if (res.geo.has(k)) {
        // merge into the building's geometry for that material
        const a = res.geo.get(k);
        res.geo.set(k, mergeGeos(a, geo));
      } else res.geo.set(k, geo);
    }
  }

  #sign(group, s) {
    const mat = this.mats.sign(s.text, { bg: s.bg || '#e2ddd0', fg: s.fg || '#9c2f25' });
    const geo = new THREE.PlaneGeometry(s.w, s.h);
    const add = (z, ry) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x || 0, s.y, (s.z ?? 0) + z);
      m.rotation.y = ry;
      m.castShadow = false; m.receiveShadow = true;
      group.add(m);
    };
    if (s.z !== undefined) { add(0.13, 0); if (s.both) add(-0.13, Math.PI); }
    else add(this.#frontZ(group) , 0);
  }
  #frontZ(group) { const lot = LOTS.find((l) => l.id === group.name); return (lot?.d || 8) / 2 + 0.11; }

  /** Interior furniture goes through the instanced prop system (world matrices). */
  furnish(props, rng) {
    for (const b of this.buildings) {
      const lot = b.lot;
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot);
      for (const f of b.res.furniture || []) {
        const x = lot.x + f.x * c + f.z * s, z = lot.z - f.x * s + f.z * c;
        const y = lot.y + (f.y ?? 0.45) + (f.tipped ? 0.25 : 0);
        props.add(f.kind, x, z, {
          y, ry: lot.rot + (f.rot || 0), rz: f.tipped ? (rng.next() < 0.5 ? 1 : -1) * Math.PI / 2 : 0, rx: f.lean ? -0.35 : 0,
          variant: f.kind === 'old_bed_frame' || f.kind === 'painted_wooden_cabinet' ? -1 : 0, shadow: true,
        });
      }
    }
  }
}
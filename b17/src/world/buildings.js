// Instanced building manager: per-type LOD0/LOD1/ruin geometry grouped by material,
// distance-based LOD, per-instance paint variation, destruction into ruins.
import * as THREE from 'three';
import { q } from '../core/settings.js';

const NO_SHADOW = new Set(['glassFar', 'glass', 'fabric', 'wood', 'zinc', 'interior', 'door', 'glassLead', 'machine']);
const TINT_KEYS = { plaster: 'tint', roof: 'roofTint', slate: 'roofTint', wagon: 'tint', shutter: 'tint2', door: 'tint2', tank: 'tint' };

export function buildingMaterials(env, assets, noiseTex) {
  const P = (name, o) => assets.pbr(name, o);
  const plain = (color, rough = 0.9, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const M = {
    plaster: P('white_plaster_rough_01', { tile: 2.4, color: new THREE.Color(2.55, 2.9, 3.9) }),
    brick: P('red_brick', { tile: 1.8 }),
    fbrick: P('factory_brick', { tile: 2.6 }),
    stone: P('concrete_wall_008', { tile: 1.6, color: new THREE.Color(1.5, 1.32, 1.2) }),
    stoneWall: P('concrete_wall_008', { tile: 3.2, color: new THREE.Color(1.3, 1.2, 1.12) }),
    roof: P('clay_roof_tiles_02', { tile: 2.2, color: new THREE.Color(0.62, 0.9, 1.7) }),
    slate: P('grey_roof_tiles', { tile: 2.0, color: new THREE.Color(0.65, 0.76, 1.15) }),
    wood: P('weathered_planks', { tile: 1.2, noMap: true, color: new THREE.Color(0.58, 0.56, 0.52), normal: 0.4 }),
    shutter: P('weathered_planks', { tile: 1.0, color: new THREE.Color(1.3, 1.6, 1.5) }),
    door: P('weathered_planks', { tile: 1.4, color: new THREE.Color(1.6, 1.25, 0.95) }),
    boards: P('weathered_planks', { tile: 2.0, color: new THREE.Color(1.9, 2.0, 2.0) }),
    glass: plain(0x080a0b, 0.06, 0.0, { transparent: true, opacity: 0.78, depthWrite: false }),
    glassFar: plain(0x1b2024, 0.25, 0.0),
    glassLead: plain(0x2b3034, 0.3, 0.1),
    glassInd: plain(0x2c3538, 0.18, 0.0, { transparent: true, opacity: 0.72, depthWrite: false }),
    glassRoof: plain(0x475254, 0.3, 0.0, { transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide }),
    interior: P('white_plaster_rough_01', { tile: 3, color: new THREE.Color(0.6, 0.55, 0.48) }),
    fabric: plain(0x9a8466, 1.0),
    zinc: P('metal_plate', { tile: 1.5, metal: true, noMap: true, color: new THREE.Color(0.42, 0.43, 0.44) }),
    corr: P('corrugated_iron_02', { tile: 2.5, color: new THREE.Color(1.5, 1.5, 1.5) }),
    corrRoof: P('corrugated_iron_02', { tile: 2.5, color: new THREE.Color(0.65, 0.55, 0.48) }),
    roofFelt: P('concrete_wall_008', { tile: 3, color: new THREE.Color(0.2, 0.2, 0.21) }),
    concrete: P('concrete_wall_008', { tile: 3 }),
    concreteFloor: P('concrete_wall_008', { tile: 3, color: new THREE.Color(0.6, 0.6, 0.6) }),
    steel: plain(0x2a2c2c, 0.55, 0.6),
    steelDark: plain(0x1a1a19, 0.6, 0.5),
    bridgeSteel: P('rusty_metal_02', { tile: 2, color: new THREE.Color(0.26, 0.36, 0.7) }),
    machine: plain(0x33413b, 0.5, 0.4),
    rubble: P('red_brick', { tile: 0.9, color: new THREE.Color(0.8, 0.72, 0.66) }),
    charred: plain(0x151311, 0.95),
    soot: plain(0x0a0a0a, 1.0),
    rust: P('rusty_metal_02', { tile: 2, color: new THREE.Color(0.45, 0.5, 0.6) }),
    tank: P('rusty_metal_02', { tile: 4, color: new THREE.Color(0.27, 0.4, 0.68) }),
    tankCar: plain(0x262624, 0.55, 0.5),
    wagon: P('weathered_planks', { tile: 2, color: new THREE.Color(1.6, 0.9, 0.8) }),
    wagonRoof: plain(0x343432, 0.8, 0.2),
    coal: plain(0x0c0c0c, 0.85),
    loco: plain(0x121212, 0.5, 0.35),
    wheelRed: plain(0x6e1a12, 0.6, 0.2),
    earth: P('brown_mud_02', { tile: 3, color: new THREE.Color(1.1, 1.0, 0.9) }),
    sandbag: P('weathered_planks', { tile: 0.8, noMap: true, color: new THREE.Color(0.26, 0.21, 0.13), normal: 0.3 }),
    gun: P('metal_plate', { tile: 2, noMap: true, color: new THREE.Color(0.3, 0.24, 0.12) }),
  };
  const weather = new Set(['plaster', 'brick', 'fbrick', 'stoneWall', 'stone']);
  for (const [k, m] of Object.entries(M)) {
    m.name = k;
    m.vertexColors = true;
    if (weather.has(k)) {
      const u = { tNoise: { value: noiseTex } };
      env.material(m, (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; varying vec3 vLoc;')
          .replace('#include <map_fragment>', `#include <map_fragment>
            {
              // rising damp + splash-back near the ground, rain streaks below openings, soot at the top
              float n1 = texture2D(tNoise, vec2(vLoc.x + vLoc.z, vLoc.y * 0.2) * 0.11).r;
              float n2 = texture2D(tNoise, vec2((vLoc.x + vLoc.z) * 0.37, vLoc.y * 0.03)).g * texture2D(tNoise, vec2(vLoc.x * 0.05 + vLoc.z * 0.07, vLoc.y * 0.08)).b * 1.6;
              float damp = smoothstep(1.4 + n1 * 0.9, 0.2, vLoc.y);
              diffuseColor.rgb *= mix(1.0, 0.62, damp * 0.8);
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.95, 0.8), damp * 0.35);
              float streak = smoothstep(0.6, 0.95, n2) * 0.12;
              diffuseColor.rgb *= 1.0 - streak;
              diffuseColor.rgb *= mix(0.9, 1.06, n1);
            }`);
      }, 'weather_' + k);
    } else {
      env.material(m);
    }
  }
  return M;
}

export class Buildings {
  constructor(scene, env, materials) {
    this.scene = scene;
    this.M = materials;
    this.types = new Map();
    this.records = [];
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);
    this.grid = new Map();
    this.lodDist = q().buildingLod;
    this._t = 0;
    this.onDestroyed = null;
  }

  defineType(name, arch, opts = {}) {
    const t = { name, w: arch.w, d: arch.d, h: arch.h, radius: Math.hypot(arch.w, arch.d) / 2, lods: {}, meshes: {}, list: [], hp: opts.hp ?? 1, cast: opts.cast ?? true };
    for (const lod of ['lod0', 'lod1', 'ruin']) t.lods[lod] = arch[lod].build();
    this.types.set(name, t);
    return t;
  }

  place(typeName, x, y, z, rotY, rec = {}) {
    const t = this.types.get(typeName);
    if (!t) throw new Error('unknown building type ' + typeName);
    const r = {
      type: t, x, y, z, rot: rotY, alive: true, hp: rec.hp ?? t.hp, maxHp: rec.hp ?? t.hp,
      tint: rec.tint || new THREE.Color(1, 1, 1), roofTint: rec.roofTint || new THREE.Color(1, 1, 1), tint2: rec.tint2 || new THREE.Color(1, 1, 1),
      target: rec.target || null, weight: rec.weight ?? 1, id: this.records.length, lod: 1,
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1)),
      burn: 0, kind: rec.kind || 'building',
    };
    t.list.push(r);
    this.records.push(r);
    const key = `${Math.floor(x / 100)}_${Math.floor(z / 100)}`;
    if (!this.grid.has(key)) this.grid.set(key, []);
    this.grid.get(key).push(r);
    return r;
  }

  finalize() {
    for (const t of this.types.values()) {
      const n = t.list.length;
      if (!n) continue;
      for (const lod of ['lod0', 'lod1', 'ruin']) {
        t.meshes[lod] = [];
        for (const [key, geom] of t.lods[lod]) {
          const mat = this.M[key];
          if (!mat) { console.warn('missing material', key); continue; }
          const im = new THREE.InstancedMesh(geom, mat, n);
          im.count = 0;
          im.castShadow = t.cast && !mat.transparent && !NO_SHADOW.has(key);
          im.receiveShadow = true;
          im.frustumCulled = true;
          im.userData.tintKey = TINT_KEYS[key] || null;
          if (im.userData.tintKey) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
          im.name = `${t.name}:${lod}:${key}`;
          this.group.add(im);
          t.meshes[lod].push(im);
        }
      }
    }
    this.update(new THREE.Vector3(0, 1e5, 0), true);
  }

  update(camPos, force = false) {
    this._t++;
    if (!force && this._t > 3 && this._t % 12 !== 1) return;
    const d2 = this.lodDist * this.lodDist;
    for (const t of this.types.values()) {
      if (!t.list.length) continue;
      const buckets = { lod0: [], lod1: [], ruin: [] };
      const lodD2 = d2 * Math.max(1, t.radius / 20);
      for (const r of t.list) {
        if (!r.alive) { buckets.ruin.push(r); continue; }
        const dx = r.x - camPos.x, dy = r.y - camPos.y, dz = r.z - camPos.z;
        buckets[(dx * dx + dy * dy + dz * dz) < lodD2 ? 'lod0' : 'lod1'].push(r);
      }
      for (const lod of ['lod0', 'lod1', 'ruin']) {
        const list = buckets[lod];
        for (const im of t.meshes[lod] || []) {
          im.count = list.length;
          im.visible = list.length > 0;
          const tk = im.userData.tintKey;
          for (let i = 0; i < list.length; i++) {
            im.setMatrixAt(i, list[i].matrix);
            if (tk) im.setColorAt(i, lod === 'ruin' ? _dark.copy(list[i][tk]).multiplyScalar(0.45) : list[i][tk]);
          }
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          if (list.length) im.computeBoundingSphere();
        }
      }
    }
  }

  query(x, z, radius, fn) {
    const r = Math.ceil((radius + 60) / 100);
    const cx = Math.floor(x / 100), cz = Math.floor(z / 100);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const list = this.grid.get(`${cx + i}_${cz + j}`);
      if (list) for (const rec of list) fn(rec);
    }
  }

  // Blast damage; returns destroyed records.
  blast(p, radius, power) {
    const out = [];
    this.query(p.x, p.z, radius + 90, (r) => {
      if (!r.alive) return;
      let d;
      if (r.axis) {
        const A = r.axis, dx = A.bx - A.ax, dz = A.bz - A.az, L2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((p.x - A.ax) * dx + (p.z - A.az) * dz) / L2));
        d = Math.max(0, Math.hypot(p.x - A.ax - dx * t, p.z - A.az - dz * t) - 4);
      } else d = Math.max(0, Math.hypot(r.x - p.x, r.z - p.z) - r.type.radius * 0.7);
      if (d > radius) return;
      if (p.y > r.y + r.type.h + 25) return;
      const dmg = power * (1 - d / radius) ** 1.5;
      r.hp -= dmg;
      if (r.hp <= 0) { r.alive = false; out.push(r); }
    });
    if (out.length) { this.update(p, true); for (const r of out) this.onDestroyed?.(r); }
    return out;
  }

  // Ray/segment test against building boxes (for low-flying collision)
  heightAt(x, z) {
    let h = -Infinity;
    this.query(x, z, 20, (r) => {
      if (!r.alive) return;
      const c = Math.cos(-r.rot), s = Math.sin(-r.rot);
      const lx = (x - r.x) * c - (z - r.z) * s, lz = (x - r.x) * s + (z - r.z) * c;
      if (Math.abs(lx) < r.type.w / 2 && Math.abs(lz) < r.type.d / 2) h = Math.max(h, r.y + r.type.h * 0.85);
    });
    return h;
  }
}
const _dark = new THREE.Color();

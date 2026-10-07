import * as THREE from 'three';
import { generateTree } from './TreeGen.js';
import { makeNoise2D, fbm, mulberry32, smoothstep } from '../engine/noise.js';
import { WORLD, QUAY, BUILDINGS } from './layout.js';
import { LAYER_NO_AO } from '../engine/Renderer.js';

export const windUniforms = {
  uWindT: { value: 0 }, uWindDir: { value: new THREE.Vector2(0.8, 0.6) }, uWindStrength: { value: 1 },
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
};

/** Adds wind sway (and optional leaf translucency) to a standard material. */
export function addWind(mat, { leaves = false, grass = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, windUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aWind;
        uniform float uWindT; uniform vec2 uWindDir; uniform float uWindStrength;
        varying vec3 vVegW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ipos = vec3(0.0);
        mat3 irot = mat3(1.0);
        #ifdef USE_INSTANCING
          ipos = instanceMatrix[3].xyz;
          irot = mat3(instanceMatrix);
        #endif
        float ph = dot(ipos.xz, vec2(0.071, 0.113));
        float gust = 0.6 + 0.4 * sin(uWindT * 0.21 + ipos.x * 0.004) * sin(uWindT * 0.13 + ipos.z * 0.006);
        float sway = (sin(uWindT * 0.85 + ph) * 0.65 + sin(uWindT * 2.1 + ph * 1.9) * 0.25) * gust * uWindStrength;
        vec3 wdir = vec3(uWindDir.x, 0.0, uWindDir.y) * transpose(irot);
        wdir /= max(dot(irot[0], irot[0]), 1e-4);
        ${grass ? 'float bend = uv.y > 0.5 ? 0.0 : 1.0; transformed += wdir * (0.12 * sway + 0.05) * bend;' : `
        transformed += wdir * sway * aWind * ${leaves ? '0.22' : '0.16'};
        ${leaves ? 'transformed += objectNormal * sin(uWindT * 6.3 + dot(position, vec3(3.1, 2.7, 1.9)) + ph) * 0.045 * aWind * gust;' : ''}`}
        vVegW = (modelMatrix * ${'vec4(ipos, 0.0) + modelMatrix * vec4(irot * transformed, 1.0)'}).xyz;`);
    if (leaves || grass) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uSunDirV; uniform vec3 uSunCol; varying vec3 vVegW;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            // thin-leaf translucency: light through the foliage when looking toward the sun
            vec3 V = normalize(cameraPosition - vVegW);
            float back = pow(saturate(dot(-V, uSunDirV)), 3.0) * 0.6 + 0.12;
            reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 1.05, 0.6) * uSunCol * back * ${grass ? '0.25' : '0.45'};
          }`);
    }
  };
  mat.customProgramCacheKey = () => 'wind' + (leaves ? 'L' : '') + (grass ? 'G' : '');
  return mat;
}

const SPECIES = [
  ['pine', 6], ['spruce', 4], ['broadleaf', 6],
];

export class Vegetation {
  constructor(assets, terrain, scene) {
    this.assets = assets;
    this.terrain = terrain;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.variants = [];
    this.instances = [];
    this.lastUpdate = new THREE.Vector3(1e9, 0, 0);
  }

  async load(quality) {
    this.quality = quality;
    const A = this.assets;
    const [conifer, leafA, leafB, grassTex, pineBark, islandBark] = await Promise.all([
      A.texture('veg/conifer.ktx2', { srgb: true, repeat: false }), A.texture('veg/broadleaf_a.ktx2', { srgb: true, repeat: false }),
      A.texture('veg/broadleaf_b.ktx2', { srgb: true, repeat: false }), A.texture('veg/grass.ktx2', { srgb: true, repeat: false }),
      A.pbr('pine_bark'), A.pbr('island_bark'),
    ]);
    const msaa = quality.msaa > 0;
    const leafMat = (map, color) => addWind(new THREE.MeshStandardMaterial({
      name: 'foliage', map, color, alphaTest: 0.42, alphaToCoverage: msaa, side: THREE.DoubleSide, vertexColors: true,
      roughness: 0.78, metalness: 0, envMapIntensity: 0.55,
    }), { leaves: true });
    const barkMat = (s, color) => {
      const m = new THREE.MeshStandardMaterial({ name: 'bark', map: s?.map, normalMap: s?.normalMap, roughnessMap: s?.arm, aoMap: s?.arm, color, roughness: 1, metalness: 0, vertexColors: true });
      if (m.normalMap) m.normalScale.set(1.2, -1.2);
      return addWind(m);
    };
    this.mats = {
      pine: { leaves: leafMat(conifer, new THREE.Color(0.78, 0.82, 0.62)), bark: barkMat(pineBark, new THREE.Color(0.95, 0.85, 0.78)) },
      spruce: { leaves: leafMat(conifer, new THREE.Color(0.5, 0.62, 0.5)), bark: barkMat(pineBark, new THREE.Color(0.7, 0.65, 0.62)) },
      broadleaf: [leafMat(leafA, new THREE.Color(0.92, 0.95, 0.85)), leafMat(leafB, new THREE.Color(0.9, 0.95, 0.8))],
      broadBark: barkMat(islandBark, new THREE.Color(0.85, 0.82, 0.78)),
    };
    this.grassTex = grassTex;
    const [shrubs, ferns, rocks] = await Promise.all([
      Promise.all(['shrub_02', 'shrub_03', 'shrub_04'].map((m) => A.model(m))),
      A.model('fern_02'),
      Promise.all(['boulder_01', 'boulder_01_lod1', 'rock_moss_set_01', 'rock_moss_set_01_lod1', 'rock_moss_set_02', 'rock_moss_set_02_lod1', 'coast_rocks_01', 'coast_rocks_01_lod1', 'tree_stump_01', 'dead_tree_trunk', 'dry_branches_medium_01'].map((m) => A.model(m))),
    ]);
    this.shrubModels = shrubs.filter(Boolean);
    this.fernModel = ferns;
    this.rockModels = rocks;
  }

  /** Builds tree variants (3 LODs each) as instanced meshes. */
  buildVariants() {
    let seed = 1;
    for (const [sp, n] of SPECIES) {
      for (let v = 0; v < n; v++) {
        seed++;
        const lods = [0, 1, 2].map((l) => generateTree(sp, seed, l));
        const leafMat = sp === 'broadleaf' ? this.mats.broadleaf[v % 2] : this.mats[sp].leaves;
        const barkMat = sp === 'broadleaf' ? this.mats.broadBark : this.mats[sp].bark;
        const meshes = lods.map((t, l) => {
          const cap = 2400;
          const b = new THREE.InstancedMesh(t.bark, barkMat, cap);
          const f = new THREE.InstancedMesh(t.leaves, leafMat, cap);
          for (const m of [b, f]) {
            m.count = 0; m.castShadow = l < 2; m.receiveShadow = true; m.frustumCulled = false;
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.group.add(m);
          }
          f.layers.set(LAYER_NO_AO);
          return { b, f };
        });
        this.variants.push({ species: sp, lods, meshes, height: lods[0].height });
      }
    }
  }

  place(seed = 99) {
    const T = this.terrain, q = this.quality;
    const rnd = mulberry32(seed), n = makeNoise2D(seed), n2 = makeNoise2D(seed + 5);
    const cands = [];
    const spacing = 7.5;
    for (let z = -1150; z < 300; z += spacing) {
      for (let x = -1300; x < 1300; x += spacing) {
        const px = x + (rnd() - 0.5) * spacing * 0.9, pz = z + (rnd() - 0.5) * spacing * 0.9;
        const h = T.heightAt(px, pz);
        if (h < 2.2) continue;
        if (this.excluded(px, pz, 6)) continue;
        const s = T.splatAt(px, pz);
        const green = s[0] + s[1];
        if (green < 0.55 || s[2] > 0.25 || s[4] > 0.35 || s[5] > 0.2) continue;
        const nrm = T.normalAt(px, pz);
        if (nrm.y < 0.8) continue;
        // forests grow in clusters; denser in hollows (moisture), sparse on exposed tops
        const cluster = fbm(n, px / 170, pz / 170, 4);
        const moist = smoothstep(120, 10, h) * 0.3 + (fbm(n2, px / 60, pz / 60, 3) * 0.5 + 0.5) * 0.4;
        const dens = smoothstep(-0.12, 0.25, cluster + moist * 0.4 - 0.1) * (0.45 + 0.55 * (1 - s[1] * 0.6));
        if (rnd() > dens * 0.95) continue;
        const dist = Math.hypot(px, pz + 60);
        const pri = rnd() * (0.4 + dist / 900);
        let sp;
        const alt = h + fbm(n2, px / 300, pz / 300, 2) * 40;
        if (alt < 35 && moist > 0.35) sp = rnd() < 0.75 ? 'broadleaf' : 'pine';
        else if (alt > 90) sp = rnd() < 0.6 ? 'spruce' : 'pine';
        else sp = rnd() < 0.45 ? 'pine' : rnd() < 0.5 ? 'spruce' : 'broadleaf';
        cands.push({ x: px, z: pz, h, sp, pri });
      }
    }
    cands.sort((a, b) => a.pri - b.pri);
    const chosen = cands.slice(0, q.treeMax);
    const bySp = { pine: [], spruce: [], broadleaf: [] };
    this.variants.forEach((v, i) => bySp[v.species].push(i));
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (const c of chosen) {
      const list = bySp[c.sp];
      const vi = list[Math.floor(rnd() * list.length)];
      const s = 0.8 + rnd() * 0.45;
      qq.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.06, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.06));
      sc.set(s * (0.92 + rnd() * 0.16), s, s * (0.92 + rnd() * 0.16));
      m.compose(new THREE.Vector3(c.x, c.h - 0.15, c.z), qq, sc);
      const col = new THREE.Color().setHSL(0.0 + (rnd() - 0.5) * 0.03, 0.0, 1).multiplyScalar(0.85 + rnd() * 0.3);
      if (c.sp === 'broadleaf') col.setRGB(0.9 + rnd() * 0.2, 0.9 + rnd() * 0.15, 0.7 + rnd() * 0.2);
      this.instances.push({ v: vi, m: m.clone(), pos: new THREE.Vector3(c.x, c.h, c.z), col, lod: -1 });
    }
    this.trees = chosen;
    this.placeUndergrowth(rnd);
    return chosen.length;
  }

  excluded(x, z, margin = 0) {
    if (Math.abs(x) < QUAY.x1 + 35 + margin && z > QUAY.yardZ - 30 - margin && z < 10) return true;
    for (const b of Object.values(BUILDINGS)) if (Math.abs(x - b.x) < b.w / 2 + 12 + margin && Math.abs(z - b.z) < b.d / 2 + 12 + margin) return true;
    return false;
  }

  /** Distributes instances to LOD meshes by camera distance. */
  update(camPos, force = false) {
    if (!force && camPos.distanceToSquared(this.lastUpdate) < 25) return;
    this.lastUpdate.copy(camPos);
    const [d0, d1] = this.quality.treeLod;
    for (const v of this.variants) for (const l of v.meshes) { l.b.count = 0; l.f.count = 0; }
    for (const it of this.instances) {
      const d = it.pos.distanceTo(camPos);
      const lod = d < d0 ? 0 : d < d1 ? 1 : 2;
      const mm = this.variants[it.v].meshes[lod];
      const i = mm.b.count++;
      mm.f.count++;
      if (i >= mm.b.instanceMatrix.count) { mm.b.count--; mm.f.count--; continue; }
      mm.b.setMatrixAt(i, it.m); mm.f.setMatrixAt(i, it.m);
      mm.f.setColorAt(i, it.col); mm.b.setColorAt(i, it.col);
    }
    for (const v of this.variants) for (const l of v.meshes) for (const m of [l.b, l.f]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.updateGrass(camPos);
  }

  // ---------------- undergrowth: shrubs, ferns, rocks, dead wood ----------------
  instModel(model, transforms, castShadow = true) {
    const parts = [];
    model?.traverse((o) => { if (o.isMesh) parts.push(o); });
    model?.updateMatrixWorld(true);
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, transforms.length);
      const local = p.matrixWorld.clone();
      transforms.forEach((t, i) => im.setMatrixAt(i, t.clone().multiply(local)));
      im.castShadow = castShadow; im.receiveShadow = true;
      if (p.material.alphaTest > 0 || p.material.transparent) {
        p.material.transparent = false; p.material.alphaTest = Math.max(0.4, p.material.alphaTest);
        p.material.side = THREE.DoubleSide;
        im.layers.set(LAYER_NO_AO);
      }
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  placeUndergrowth(rnd) {
    const T = this.terrain;
    const m = (x, z, s, yaw, sink = 0.05, tilt = 0) => {
      const h = T.heightAt(x, z);
      const nrm = T.normalAt(x, z);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm.clone().lerp(new THREE.Vector3(0, 1, 0), 1 - tilt));
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)));
      return new THREE.Matrix4().compose(new THREE.Vector3(x, h - sink * s, z), q, new THREE.Vector3(s, s, s));
    };
    // shrubs on forest edges and road shoulders, ferns beneath trees
    const shrubT = this.shrubModels.map(() => []), fernT = [];
    const near = (this.trees || []).filter((t) => Math.hypot(t.x, t.z + 80) < 420);
    for (const t of near) {
      if (rnd() < 0.22) {
        const a = rnd() * 6.28, r = 2 + rnd() * 5;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        if (!this.excluded(x, z) && T.splatAt(x, z)[2] < 0.3) fernT.push(m(x, z, 0.8 + rnd() * 0.7, rnd() * 6.28, 0.05, 0.5));
      }
      if (rnd() < 0.1) {
        const a = rnd() * 6.28, r = 4 + rnd() * 6;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        if (!this.excluded(x, z)) shrubT[Math.floor(rnd() * shrubT.length)].push(m(x, z, 0.7 + rnd() * 0.8, rnd() * 6.28, 0.08, 0.3));
      }
    }
    // shrub fringe along the yard boundary and the road
    for (let i = 0; i < 140; i++) {
      const x = (rnd() * 2 - 1) * 260, z = QUAY.yardZ - 32 - rnd() * 60;
      if (this.excluded(x, z) || T.splatAt(x, z)[2] > 0.4) continue;
      shrubT[Math.floor(rnd() * shrubT.length)].push(m(x, z, 0.6 + rnd() * 0.9, rnd() * 6.28, 0.08, 0.3));
    }
    this.shrubModels.forEach((mod, i) => shrubT[i].length && this.instModel(mod, shrubT[i], false));
    if (this.fernModel && fernT.length) this.instModel(this.fernModel, fernT, false);

    // rocks: big coastal formations on the natural shore, boulders where the ground is rocky
    const [boulder, boulderL, set1, set1L, set2, set2L, coast, coastL, stump, deadTrunk, branches] = this.rockModels;
    const rockLOD = (hi, lo, mat, dist) => {
      if (!hi) return;
      const lod = new THREE.LOD();
      const a = hi.clone(); a.matrixAutoUpdate = false;
      lod.addLevel(a, 0);
      if (lo) { const b = lo.clone(); b.matrixAutoUpdate = false; lod.addLevel(b, dist); }
      lod.matrixAutoUpdate = false;
      lod.matrix.copy(mat); lod.matrixWorld.copy(mat);
      lod.applyMatrix4(new THREE.Matrix4());
      mat.decompose(lod.position, lod.quaternion, lod.scale);
      lod.updateMatrix();
      lod.matrixAutoUpdate = true;
      this.group.add(lod);
    };
    const shore = [[-330, 60, 0.5], [-420, 140, 0.4], [-560, 225, 0.6], [330, 95, 0.45], [470, 205, 0.55], [640, 330, 0.5], [-270, 25, 0.3], [260, 22, 0.3]];
    for (const [x0, z0, s] of shore) {
      // move onto the actual waterline
      let x = x0, z = z0;
      for (let k = 0; k < 40 && T.heightAt(x, z) < -0.5; k++) z -= 4;
      for (let k = 0; k < 40 && T.heightAt(x, z) > 1.5; k++) z += 4;
      rockLOD(coast, coastL, m(x, z, s * (0.9 + rnd() * 0.3), rnd() * 6.28, 0.04, 0.6), 160);
    }
    let placed = 0;
    for (let i = 0; i < 4000 && placed < 90; i++) {
      const x = (rnd() * 2 - 1) * 900, z = -rnd() * 900 + 150;
      const s = T.splatAt(x, z);
      if (s[4] < 0.35 || this.excluded(x, z) || T.heightAt(x, z) < 0.5) continue;
      const pick = rnd();
      if (pick < 0.5) rockLOD(boulder, boulderL, m(x, z, 1.2 + rnd() * 2.5, rnd() * 6.28, 0.25, 0.7), 90);
      else rockLOD(pick < 0.75 ? set1 : set2, pick < 0.75 ? set1L : set2L, m(x, z, 0.8 + rnd() * 1.2, rnd() * 6.28, 0.12, 0.8), 120);
      placed++;
    }
    // dead wood in the forest
    const dw = [];
    for (const t of near.slice(0, 600)) if (rnd() < 0.05) dw.push(t);
    for (const t of dw) {
      const x = t.x + 4 + rnd() * 4, z = t.z + rnd() * 4;
      const r = rnd();
      const mod = r < 0.35 ? stump : r < 0.65 ? deadTrunk : branches;
      if (!mod) continue;
      const o = mod.clone();
      o.applyMatrix4(m(x, z, 1, rnd() * 6.28, r < 0.35 ? 0.1 : 0.0, 1));
      this.group.add(o);
    }
  }

  // ---------------- grass ----------------
  buildGrass() {
    const q = this.quality;
    const geo = new THREE.BufferGeometry();
    // two crossed cards per clump, normals pointing up so it lights like the ground it grows from
    const pos = [], uv = [], nor = [], idx = [];
    for (let k = 0; k < 2; k++) {
      const a = k * Math.PI / 2 + 0.3, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, o = k * 4;
      pos.push(-cx, 0, -cz, cx, 0, cz, -cx, 1, -cz, cx, 1, cz);
      uv.push(0, 1, 1, 1, 0, 0, 1, 0);
      for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('aWind', new THREE.Float32BufferAttribute(new Array(8).fill(1), 1));
    geo.setIndex(idx);
    // atlas cell per instance via uv offset attribute
    const cap = Math.round(30000 * q.grassDensity * (q.grassRadius / 60) ** 2) + 2000;
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    geo.setAttribute('aCell', cell);
    const mat = new THREE.MeshStandardMaterial({ name: 'grass', map: this.grassTex, alphaTest: 0.38, alphaToCoverage: q.msaa > 0, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
    addWind(mat, { grass: true });
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.uniforms.uGrassR = { value: q.grassRadius };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell; uniform float uGrassR;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uv * 0.5 + aCell;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          { float dC = length(instanceMatrix[3].xz - cameraPosition.xz); transformed.y *= 1.0 - smoothstep(uGrassR * 0.7, uGrassR, dC); }
          #endif`);
    };
    mat.customProgramCacheKey = () => 'grass';
    this.grass = new THREE.InstancedMesh(geo, mat, cap);
    this.grass.count = 0;
    this.grass.frustumCulled = false;
    this.grass.castShadow = false;
    this.grass.receiveShadow = true;
    this.grass.layers.set(LAYER_NO_AO);
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grassCell = cell;
    this.group.add(this.grass);
    this.grassCenter = new THREE.Vector3(1e9, 0, 0);
  }

  updateGrass(camPos) {
    if (!this.grass) return;
    const q = this.quality, R = q.grassRadius;
    if (camPos.distanceTo(this.grassCenter) < R * 0.15 && this.grass.count) return;
    if (camPos.y - this.terrain.heightAt(camPos.x, camPos.z) > R * 1.2) { this.grass.count = 0; this.grassCenter.copy(camPos); return; }
    this.grassCenter.copy(camPos);
    const T = this.terrain;
    const cellSize = 4, dens = q.grassDensity;
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0;
    const cap = this.grass.instanceMatrix.count;
    const c0x = Math.floor((camPos.x - R) / cellSize), c1x = Math.floor((camPos.x + R) / cellSize);
    const c0z = Math.floor((camPos.z - R) / cellSize), c1z = Math.floor((camPos.z + R) / cellSize);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const rnd = mulberry32((cx * 73856093) ^ (cz * 19349663));
      const per = Math.round(14 * dens);
      for (let k = 0; k < per && n < cap; k++) {
        const x = (cx + rnd()) * cellSize, z = (cz + rnd()) * cellSize;
        const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
        if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 > R * R) continue;
        const sp = T.splatAt(x, z);
        const g = sp[0] + sp[1] * 0.8 - sp[2] - sp[4] - sp[5];
        if (g < 0.35 + r1 * 0.4) continue;
        if (this.excluded(x, z, -30)) continue;
        const h = T.heightAt(x, z);
        if (h < 0.6) continue;
        const sc = (0.45 + r2 * 0.5) * (0.6 + 0.4 * g);
        qq.setFromEuler(new THREE.Euler(0, r3 * 6.28, 0));
        s.set(sc * 1.6, sc * (0.8 + r4 * 0.5), sc * 1.6);
        p.set(x, h - 0.04, z);
        m.compose(p, qq, s);
        this.grass.setMatrixAt(n, m);
        const dry = sp[1] / Math.max(0.01, sp[0] + sp[1]);
        col.setRGB(0.85 + dry * 0.3, 0.92 - dry * 0.05, 0.62 - dry * 0.1).multiplyScalar(0.8 + r2 * 0.3);
        this.grass.setColorAt(n, col);
        this.grassCell.setXY(n, (Math.floor(r4 * 4) % 2) * 0.5, Math.floor(r4 * 4) >= 2 ? 0.5 : 0);
        n++;
      }
    }
    this.grass.count = n;
    this.grass.instanceMatrix.needsUpdate = true;
    if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
    this.grassCell.needsUpdate = true;
  }
}

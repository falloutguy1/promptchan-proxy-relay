// Procedural trees: irregular trunks + branch structure + leaf/needle cards, 4 species x 2 variants.
// Near: full geometry (instanced, wind). Far: crossed-quad impostors captured at load time
// (albedo + normal atlas, side + top views), streamed in 512 m cells.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2i, vnoise, smoothstep } from '../core/noise.js';
import { q } from '../core/settings.js';
import { sampleMask } from './terrain.js';
import { forestEdge, fieldInfo, riverDist, RIVER_W, urbanAt, TARGETS, FLAK_SITES } from './layout.js';

const CELL = 512;
const SPECIES = ['spruce', 'pine', 'beech', 'birch'];

// ---------------------------------------------------------------- textures
function foliageAtlas() {
  // 2x2: broadleaf, spruce needles, pine needles, birch leaves. RGBA with alpha cut-out.
  const S = 1024, H = S / 2;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tile = (ix, iy, fn) => { c.save(); c.beginPath(); c.rect(ix * H, iy * H, H, H); c.clip(); c.translate(ix * H, iy * H); fn(); c.restore(); };
  // broadleaf: twigs with ovate leaves
  tile(0, 0, () => {
    c.strokeStyle = '#3b2a1a'; c.lineWidth = 3;
    for (let t = 0; t < 7; t++) { c.beginPath(); const x0 = H / 2 + (rnd() - 0.5) * 60, y0 = H - 10; c.moveTo(x0, y0); c.quadraticCurveTo(x0 + (rnd() - 0.5) * 200, H * 0.5, H * (0.1 + rnd() * 0.8), H * (0.08 + rnd() * 0.3)); c.stroke(); }
    for (let i = 0; i < 420; i++) {
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * H * 0.46;
      const x = H / 2 + Math.cos(a) * r, y = H / 2 + Math.sin(a) * r * 0.95;
      const L = 10 + rnd() * 14, g = 90 + rnd() * 90;
      c.save(); c.translate(x, y); c.rotate(rnd() * 6.28);
      c.fillStyle = `rgb(${Math.round(g * 0.75)},${Math.round(g)},${Math.round(g * 0.4)})`;
      c.beginPath(); c.ellipse(0, 0, L, L * 0.45, 0, 0, 6.28); c.fill();
      c.strokeStyle = 'rgba(40,50,20,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-L, 0); c.lineTo(L, 0); c.stroke();
      c.restore();
    }
  });
  // spruce: flat drooping spray of short needles
  tile(1, 0, () => {
    const branch = (x0, y0, x1, y1, w) => {
      c.strokeStyle = '#2e2418'; c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      const n = Math.hypot(x1 - x0, y1 - y0) / 2.2;
      for (let i = 0; i < n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (const s of [-1, 1]) {
          const g = 55 + rnd() * 50;
          c.strokeStyle = `rgb(${Math.round(g * 0.45)},${Math.round(g * 0.8)},${Math.round(g * 0.5)})`;
          c.lineWidth = 2; c.beginPath(); c.moveTo(x, y);
          const a = Math.atan2(y1 - y0, x1 - x0) + s * (0.9 + rnd() * 0.4);
          const L = 10 + rnd() * 8 * (1 - t * 0.5);
          c.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); c.stroke();
        }
      }
    };
    branch(10, H / 2, H - 20, H / 2 + 30, 5);
    for (let k = 0; k < 9; k++) { const t = 0.1 + k * 0.09; const x = 10 + (H - 30) * t, y = H / 2 + 30 * t; branch(x, y, x + 80 + rnd() * 70, y + (k % 2 ? -1 : 1) * (60 + rnd() * 60) + 20, 3); }
  });
  // pine: tufts of long needles at twig ends
  tile(0, 1, () => {
    for (let k = 0; k < 16; k++) {
      const cx = H * (0.15 + rnd() * 0.7), cy = H * (0.15 + rnd() * 0.7);
      c.strokeStyle = '#4a3322'; c.lineWidth = 3; c.beginPath(); c.moveTo(H / 2, H - 5); c.lineTo(cx, cy); c.stroke();
      for (let i = 0; i < 60; i++) {
        const a = rnd() * 6.28, L = 18 + rnd() * 26, g = 60 + rnd() * 60;
        c.strokeStyle = `rgb(${Math.round(g * 0.55)},${Math.round(g * 0.85)},${Math.round(g * 0.55)})`;
        c.lineWidth = 1.6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); c.stroke();
      }
    }
  });
  // birch: small triangular leaves on hanging twigs
  tile(1, 1, () => {
    for (let k = 0; k < 14; k++) {
      const x0 = H * (0.1 + rnd() * 0.8);
      c.strokeStyle = '#3a2a1c'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x0, 5); c.quadraticCurveTo(x0 + (rnd() - 0.5) * 60, H * 0.5, x0 + (rnd() - 0.5) * 80, H - 10); c.stroke();
      for (let i = 0; i < 28; i++) {
        const t = rnd(), x = x0 + (rnd() - 0.5) * 60 * t, y = 5 + t * (H - 15), g = 120 + rnd() * 100;
        c.fillStyle = `rgb(${Math.round(g)},${Math.round(g * 0.95)},${Math.round(g * 0.35)})`;
        c.save(); c.translate(x, y); c.rotate(rnd() * 6.28); c.beginPath(); c.moveTo(0, -8); c.lineTo(6, 6); c.lineTo(-6, 6); c.closePath(); c.fill(); c.restore();
      }
    }
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

// ---------------------------------------------------------------- geometry builders
function tube(path, radii, seg = 7, vScale = 1) {
  // path: array of Vector3, radii: per point
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const t = path[Math.min(path.length - 1, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
    const n = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(t).normalize() : new THREE.Vector3(1, 0, 0).cross(t).normalize();
    const b = t.clone().cross(n);
    if (i > 0) along += p.distanceTo(path[i - 1]);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const r = radii[i] * (1 + 0.08 * Math.sin(a * 3 + i));
      pos.push(p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r, p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r, p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r);
      uv.push((j / seg) * Math.max(0.6, radii[0] * 6.28) / 1.5, along / 1.5 * vScale);
    }
  }
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b2 = a + seg + 1;
    idx.push(a, a + 1, b2, a + 1, b2 + 1, b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function card(center, size, tile, rot, crownC, tiltUp = 0) {
  const g = new THREE.PlaneGeometry(size, size);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + (tile % 2)) * 0.5, (uv.getY(i) + (1 - Math.floor(tile / 2))) * 0.5);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot.x + tiltUp, rot.y, rot.z, 'YXZ')));
  g.translate(center.x, center.y, center.z);
  // bend normals outward from the crown centre -> soft volumetric shading
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const d = new THREE.Vector3(p.getX(i) - crownC.x, (p.getY(i) - crownC.y) * 0.8, p.getZ(i) - crownC.z).normalize();
    const cn = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i));
    const m = d.multiplyScalar(0.8).add(cn.multiplyScalar(0.2)).normalize();
    n.setXYZ(i, m.x, m.y + 0.15, m.z);
  }
  const h = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) h[i] = p.getY(i);
  return g;
}

function makeTree(species, seed) {
  const rnd = mulberry32(seed);
  const wood = [], leaves = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  let H, crownC;
  if (species === 'spruce' || species === 'pine') {
    const spruce = species === 'spruce';
    H = spruce ? 20 + rnd() * 10 : 18 + rnd() * 9;
    const lean = V((rnd() - 0.5) * 0.04, 1, (rnd() - 0.5) * 0.04).normalize();
    const path = [], radii = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      path.push(V(lean.x * H * t + Math.sin(t * 5 + seed) * 0.12 * (spruce ? 0.3 : 1), H * t, lean.z * H * t + Math.cos(t * 4 + seed) * 0.12 * (spruce ? 0.3 : 1)));
      radii.push((spruce ? 0.28 : 0.24) * (1 - t * 0.92) + 0.02 + (i === 0 ? 0.08 : 0));
    }
    wood.push(tube(path, radii, 8));
    if (spruce) {
      crownC = V(0, H * 0.45, 0);
      for (let y = H * 0.12; y < H - 0.5; y += 0.55) {
        const f = (y - H * 0.12) / (H * 0.88);
        const R = (1 - f) * 3.6 + 0.4;
        const n = Math.max(3, Math.round(R * 2.4));
        for (let k = 0; k < n; k++) {
          const a = k / n * 6.28 + rnd();
          const c = V(Math.cos(a) * R * 0.5, y - R * 0.15, Math.sin(a) * R * 0.5);
          leaves.push(card(c, R * 1.3 + 0.6, 1, V(-Math.PI / 2 + 0.35, -a + Math.PI / 2, 0), crownC));
        }
      }
      leaves.push(card(V(0, H - 0.3, 0), 1.6, 1, V(0, rnd() * 3, 0), crownC));
    } else {
      crownC = V(lean.x * H * 0.85, H * 0.85, lean.z * H * 0.85);
      for (let k = 0; k < 7; k++) {
        const a = rnd() * 6.28, y0 = H * (0.62 + rnd() * 0.3);
        const len = 1.8 + rnd() * 2.2;
        const b0 = V(lean.x * y0, y0, lean.z * y0), b1 = b0.clone().add(V(Math.cos(a) * len, len * 0.45, Math.sin(a) * len));
        wood.push(tube([b0, b0.clone().lerp(b1, 0.5).add(V(0, 0.2, 0)), b1], [0.12, 0.08, 0.04], 5));
        for (let j = 0; j < 5; j++) leaves.push(card(b1.clone().add(V((rnd() - 0.5) * 1.8, (rnd() - 0.2) * 1.0, (rnd() - 0.5) * 1.8)), 2.2 + rnd() * 1.2, 2, V(rnd() * 3, rnd() * 3, rnd() * 3), crownC));
      }
      for (let j = 0; j < 10; j++) leaves.push(card(crownC.clone().add(V((rnd() - 0.5) * 3, (rnd() - 0.3) * 2, (rnd() - 0.5) * 3)), 2.4 + rnd(), 2, V(rnd() * 3, rnd() * 3, rnd() * 3), crownC));
    }
  } else {
    const birch = species === 'birch';
    H = birch ? 15 + rnd() * 6 : 19 + rnd() * 8;
    const trunkH = H * (birch ? 0.4 : 0.35);
    const lean = V((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12);
    const path = [], radii = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      path.push(V(lean.x * trunkH * t * 3 + Math.sin(t * 3 + seed) * 0.2, trunkH * t * 1.25, lean.z * trunkH * t * 3 + Math.cos(t * 2 + seed) * 0.2));
      radii.push((birch ? 0.2 : 0.38) * (1 - t * 0.45) + (i === 0 ? 0.1 : 0));
    }
    wood.push(tube(path, radii, 8));
    const top = path[path.length - 1];
    crownC = V(top.x, H * 0.64, top.z);
    const nb = birch ? 6 : 7 + Math.floor(rnd() * 3);
    for (let k = 0; k < nb; k++) {
      const a = k / nb * 6.28 + rnd() * 0.6;
      const up = 0.6 + rnd() * 0.5;
      const len = (birch ? 4 : 6) + rnd() * 3;
      const b0 = top.clone().add(V(0, -rnd() * 1.5, 0));
      const mid = b0.clone().add(V(Math.cos(a) * len * 0.5, len * up * 0.55, Math.sin(a) * len * 0.5));
      const b1 = b0.clone().add(V(Math.cos(a) * len, len * up, Math.sin(a) * len));
      if (birch) b1.y -= 1.2;
      wood.push(tube([b0, mid, b1], [radii[radii.length - 1] * 0.6, 0.09, 0.03], 5));
      // secondary branches
      for (let s = 0; s < 2; s++) {
        const a2 = a + (s ? 0.9 : -0.9);
        const c0 = mid.clone(), c1 = c0.clone().add(V(Math.cos(a2) * len * 0.45, len * 0.25, Math.sin(a2) * len * 0.45));
        wood.push(tube([c0, c1], [0.06, 0.02], 4));
        for (let j = 0; j < (birch ? 4 : 5); j++) leaves.push(card(c1.clone().add(V((rnd() - 0.5) * 2.6, (rnd() - 0.4) * 2, (rnd() - 0.5) * 2.6)), 2.4 + rnd() * 1.4, birch ? 3 : 0, V(rnd() * 3, rnd() * 3, rnd() * 3), crownC));
      }
      for (let j = 0; j < (birch ? 5 : 7); j++) leaves.push(card(b1.clone().add(V((rnd() - 0.5) * 3, (rnd() - 0.5) * 2.4, (rnd() - 0.5) * 3)), 2.6 + rnd() * 1.6, birch ? 3 : 0, V(rnd() * 3, rnd() * 3, rnd() * 3), crownC));
    }
    // fill crown interior
    for (let j = 0; j < (birch ? 8 : 14); j++) leaves.push(card(crownC.clone().add(V((rnd() - 0.5) * 6, (rnd() - 0.3) * 4, (rnd() - 0.5) * 6)), 2.8 + rnd() * 1.5, birch ? 3 : 0, V(rnd() * 3, rnd() * 3, rnd() * 3), crownC));
  }
  const clean = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); return n; };
  const woodG = mergeGeometries(wood.map(clean));
  const leafG = mergeGeometries(leaves.map(clean));
  woodG.computeBoundingBox(); leafG.computeBoundingBox();
  const bb = leafG.boundingBox.clone().union(woodG.boundingBox);
  return { wood: woodG, leaves: leafG, bb, H: bb.max.y };
}

// ---------------------------------------------------------------- materials
function windPatch(shader, uniforms, strength) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
        ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        float h = max(0.0, position.y) / 20.0;
        float ph = uTime * 1.3 + ip.x * 0.05 + ip.z * 0.07;
        float sw = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25) * h * h * ${strength.toFixed(2)};
        transformed.x += sw;
        transformed.z += sw * 0.5;
        transformed += normal * sin(uTime * 4.0 + position.x * 3.0 + position.z * 2.0) * 0.03 * h;
      }`);
}

export class Vegetation {
  constructor(scene, env, assets, hf, mask, settlement, renderer) {
    this.scene = scene; this.env = env; this.hf = hf; this.mask = mask; this.settlement = settlement; this.renderer = renderer;
    const Q = q();
    this.radius = Q.treeRadius;
    this.near = Q.treeNear;
    this.density = Q.treeDensity;
    this.uniforms = { uTime: { value: 0 } };
    this.impUniforms = { uNear: { value: Q.treeNear }, uCam: { value: new THREE.Vector3() } };
    this.cells = new Map();
    this.group = new THREE.Group(); this.group.name = 'vegetation';
    scene.add(this.group);
    this.foliageTex = foliageAtlas();
    const bark = assets.tex.bark_brown_02 || {}, pine = assets.tex.pine_bark || {};
    const barkMat = (t, color) => {
      const m = new THREE.MeshStandardMaterial({ map: t.diff || null, normalMap: t.nor || null, roughnessMap: t.arm || null, color, roughness: 1 });
      env.material(m, (sh) => windPatch(sh, this.uniforms, 0.35), 'bark');
      return m;
    };
    this.barkMats = { spruce: barkMat(bark, new THREE.Color(0.9, 0.8, 0.75)), pine: barkMat(pine, new THREE.Color(1.3, 0.95, 0.75)), beech: barkMat(bark, new THREE.Color(1.1, 1.08, 1.05)), birch: barkMat(bark, new THREE.Color(3.2, 3.2, 3.1)) };
    this.leafMat = new THREE.MeshStandardMaterial({ map: this.foliageTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    env.material(this.leafMat, (sh) => {
      windPatch(sh, this.uniforms, 0.6);
      // soft translucency: lighten when lit from behind
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.08;`);
    }, 'leaf');
    this.leafMat.alphaToCoverage = Q.msaa > 0;
  }

  async init(progress) {
    this.types = [];
    let k = 0;
    for (const sp of SPECIES) for (let v = 0; v < 2; v++) {
      this.types.push({ species: sp, ...makeTree(sp, 1000 + k * 17), idx: k });
      k++;
    }
    progress?.(0.3);
    await new Promise(r => requestAnimationFrame(r));
    this._captureImpostors();
    progress?.(0.7);
    // near (full geometry) instanced meshes
    this.nearMeshes = this.types.map(t => {
      const cap = 3500;
      const w = new THREE.InstancedMesh(t.wood, this.barkMats[t.species], cap);
      const l = new THREE.InstancedMesh(t.leaves, this.leafMat, cap);
      l.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      for (const m of [w, l]) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m); }
      return { w, l };
    });
    this._impostorMaterial();
    progress?.(1);
  }

  // Render each tree type (side & top) into an albedo and a normal atlas.
  _captureImpostors() {
    const R = this.renderer;
    const tileS = 256, cols = 4, rows = 4;   // 8 types x (side, top)
    const make = () => new THREE.WebGLRenderTarget(tileS * cols, tileS * rows, { samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.albedoRT = make();
    this.normalRT = make();
    this.albedoRT.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const albedoLeaf = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.foliageTex }, tint: { value: new THREE.Color() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform vec3 tint; varying vec2 vUv; void main(){ vec4 c = texture2D(map, vUv); if(c.a < 0.45) discard; gl_FragColor = vec4(c.rgb * tint, 1.0); }',
      side: THREE.DoubleSide,
    });
    const normalLeaf = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.foliageTex } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec3 vN; void main(){ vec4 c = texture2D(map, vUv); if(c.a < 0.45) discard; vec3 n = normalize(vN); if(n.z < 0.0) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
      side: THREE.DoubleSide,
    });
    const albedoWood = new THREE.MeshBasicMaterial({ color: 0x3a3028 });
    const normalWood = new THREE.MeshNormalMaterial();
    const prevTarget = R.getRenderTarget();
    const prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha();
    R.setClearColor(0x000000, 0);
    const prevTM = R.toneMapping; R.toneMapping = THREE.NoToneMapping;
    const wm = new THREE.Mesh(undefined, albedoWood), lm = new THREE.Mesh(undefined, albedoLeaf);
    scene.add(wm, lm);
    for (const pass of ['albedo', 'normal']) {
      const rt = pass === 'albedo' ? this.albedoRT : this.normalRT;
      R.setRenderTarget(rt);
      R.clear();
      wm.material = pass === 'albedo' ? albedoWood : normalWood;
      lm.material = pass === 'albedo' ? albedoLeaf : normalLeaf;
      this.types.forEach((t, i) => {
        wm.geometry = t.wood; lm.geometry = t.leaves;
        const bb = t.bb;
        const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.55;
        t.imp = { w: w * 2, h: bb.max.y, cx: (bb.max.x + bb.min.x) / 2, cz: (bb.max.z + bb.min.z) / 2 };
        for (let view = 0; view < 2; view++) {
          const tile = i * 2 + view;
          const tx = tile % cols, ty = Math.floor(tile / cols);
          R.setViewport(tx * tileS, ty * tileS, tileS, tileS);
          R.setScissor(tx * tileS, ty * tileS, tileS, tileS);
          R.setScissorTest(true);
          if (view === 0) {
            const hh = bb.max.y / 2;
            cam.left = -w; cam.right = w; cam.top = hh * 1.02; cam.bottom = -hh * 1.02;
            cam.position.set(t.imp.cx, hh, t.imp.cz + 100); cam.up.set(0, 1, 0); cam.lookAt(t.imp.cx, hh, t.imp.cz);
          } else {
            cam.left = -w; cam.right = w; cam.top = w; cam.bottom = -w;
            cam.position.set(t.imp.cx, 150, t.imp.cz); cam.up.set(0, 0, -1); cam.lookAt(t.imp.cx, 0, t.imp.cz);
          }
          cam.updateProjectionMatrix();
          R.render(scene, cam);
        }
      });
    }
    R.setScissorTest(false);
    R.setRenderTarget(prevTarget);
    R.setClearColor(prevClear, prevAlpha);
    R.toneMapping = prevTM;
    this.tiles = { cols, rows };
  }

  _impostorMaterial() {
    // crossed vertical quads + one horizontal quad; aView attribute 0 = side, 1 = top
    const quads = [];
    for (const a of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); g.rotateY(a);
      g.setAttribute('aView', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
      quads.push(g);
    }
    const top = new THREE.PlaneGeometry(1, 1); top.rotateX(-Math.PI / 2); top.translate(0, 0.62, 0);
    top.setAttribute('aView', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
    quads.push(top);
    const geom = mergeGeometries(quads);
    this.impGeom = geom;
    const mat = new THREE.MeshStandardMaterial({ map: this.albedoRT.texture, normalMap: this.normalRT.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, transparent: false });
    const T = this.tiles;
    const patch = (sh) => {
      Object.assign(sh.uniforms, this.uniforms, this.impUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        uniform float uNear; uniform vec3 uCam;
        attribute float aView; attribute vec4 aImp; varying vec2 vTile; varying float vView;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vView = aView;
          float tile = aImp.w * 2.0 + aView;
          vTile = vec2(mod(tile, ${T.cols}.0), floor(tile / ${T.cols}.0));`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.x * aImp.x, position.y * aImp.y, position.z * aImp.x);
          if (distance(vec3(instanceMatrix[3]), uCam) < uNear) transformed = vec3(0.0);`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTile; varying float vView;')
        .replace('#include <map_fragment>', `
          vec2 tuv = (vTile + vec2(vMapUv.x, vMapUv.y)) / vec2(${T.cols}.0, ${T.rows}.0);
          vec4 sampledDiffuseColor = texture2D(map, tuv);
          diffuseColor *= sampledDiffuseColor;`)
        .replace('#include <normal_fragment_maps>', `
          vec3 mapN = texture2D(normalMap, tuv).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);`);
    };
    this.env.material(mat, patch, 'impostor');
    mat.alphaToCoverage = q().msaa > 0;
    this.impMat = mat;
    // shadow depth material honouring the atlas alpha
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.albedoRT.texture, alphaTest: 0.5, side: THREE.DoubleSide });
    dm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.impUniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uNear; uniform vec3 uCam; attribute float aView; attribute vec4 aImp; varying vec2 vTile;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nfloat tile = aImp.w * 2.0 + aView; vTile = vec2(mod(tile, ${T.cols}.0), floor(tile / ${T.cols}.0));`)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position.x * aImp.x, position.y * aImp.y, position.z * aImp.x); if (distance(vec3(instanceMatrix[3]), uCam) < uNear) transformed = vec3(0.0);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTile;')
        .replace('#include <map_fragment>', `vec4 sampledDiffuseColor = texture2D(map, (vTile + vMapUv) / vec2(${T.cols}.0, ${T.rows}.0)); diffuseColor *= sampledDiffuseColor;`);
    };
    this.impDepth = dm;
  }

  // ---------------------------------------------------------------- placement
  _cellTrees(cx, cz) {
    const out = [];
    const S = this.settlement;
    const dens = this.density;
    const x0 = cx * CELL, z0 = cz * CELL;
    const add = (x, z, kind) => {
      const h = this.hf.height(x, z);
      if (h < 201) return;
      // keep clear of roads, rails and buildings
      const segs = S.segGrid.get(Math.floor(x / 40) + ',' + Math.floor(z / 40));
      if (segs) for (const { l, a, b } of segs) {
        const clear = l.kind === 'rail' ? 7 : l.w / 2 + 2.5;
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
        if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < clear) return;
      }
      const occ = S.occGrid.get(`${Math.floor(x / 50)}_${Math.floor(z / 50)}`);
      if (occ) for (const o of occ) if (Math.abs(x - o.x) < o.w / 2 + 3 && Math.abs(z - o.z) < o.d / 2 + 3 && Math.hypot(x - o.x, z - o.z) < Math.max(o.w, o.d) / 2 + 3) return;
      const r = hash2i(Math.round(x * 7), Math.round(z * 7), 41);
      const conifer = smoothstep(0.35, 0.65, vnoise(x / 600, z / 600, 44) + (h - 280) / 250);
      let species;
      if (kind === 'forest') species = r < conifer ? (hash2i(Math.round(x), Math.round(z), 42) < 0.7 ? 0 : 1) : (hash2i(Math.round(x), Math.round(z), 43) < 0.8 ? 2 : 3);
      else if (kind === 'river') species = r < 0.5 ? 3 : 2;
      else species = r < 0.12 ? 1 : r < 0.25 ? 3 : 2;
      const v = hash2i(Math.round(x * 3), Math.round(z * 3), 45) < 0.5 ? 0 : 1;
      const scale = 0.7 + hash2i(Math.round(x), Math.round(z), 46) * 0.55 * (kind === 'forest' ? 1 : 0.8);
      const rot = hash2i(Math.round(x), Math.round(z), 47) * 6.28;
      // autumn colouring for broadleaves
      const c = hash2i(Math.round(x), Math.round(z), 48);
      let col;
      if (species === 2) col = c < 0.35 ? [0.9, 0.95, 0.6] : c < 0.65 ? [1.35, 0.95, 0.45] : c < 0.85 ? [1.45, 0.78, 0.35] : [1.0, 1.0, 0.7];
      else if (species === 3) col = c < 0.5 ? [1.45, 1.25, 0.5] : [1.1, 1.15, 0.6];
      else col = [0.72 + c * 0.2, 0.85 + c * 0.15, 0.8];
      out.push({ x, y: h - 0.3, z, t: species * 2 + v, s: scale, r: rot, c: col });
    };
    // forest
    const sp = 7.5 / Math.sqrt(dens);
    for (let z = z0; z < z0 + CELL; z += sp) for (let x = x0; x < x0 + CELL; x += sp) {
      const jx = x + (hash2i(Math.round(x), Math.round(z), 31) - 0.5) * sp * 0.9, jz = z + (hash2i(Math.round(x), Math.round(z), 32) - 0.5) * sp * 0.9;
      const m = sampleMask(this.mask, jx, jz, 0);
      if (m < 0.35) continue;
      if (forestEdge(m, jx, jz) > 0.5) add(jx, jz, 'forest');
    }
    // hedgerows along field-block borders + riverside trees + orchards
    const hs = 8.5 / Math.sqrt(dens);
    for (let z = z0; z < z0 + CELL; z += hs) for (let x = x0; x < x0 + CELL; x += hs) {
      const jx = x + (hash2i(Math.round(x), Math.round(z), 33) - 0.5) * 4, jz = z + (hash2i(Math.round(x), Math.round(z), 34) - 0.5) * 4;
      const rd = riverDist(jx, jz);
      if (Math.abs(rd - (RIVER_W / 2 + 9)) < 4 && vnoise(jx / 40, jz / 40, 21) > 0.45) { add(jx, jz, 'river'); continue; }
      const fi = fieldInfo(jx, jz);
      if (fi[3] < 2.5 && fi[4] > 0.55 && rd > 90 && urbanAt(jx, jz) < 0.3 && sampleMask(this.mask, jx, jz, 0) < 0.45) add(jx, jz, 'hedge');
    }
    for (const g of S.gardens) {
      if (Math.abs(g.cen.x - (x0 + CELL / 2)) > CELL / 2 + 60 || Math.abs(g.cen.z - (z0 + CELL / 2)) > CELL / 2 + 60) continue;
      for (let k = 0; k < 16; k++) {
        const x = g.cen.x + (hash1(k * 7 + g.cen.x) - 0.5) * 50, z = g.cen.z + (hash1(k * 13 + g.cen.z) - 0.5) * 50;
        if (x >= x0 && x < x0 + CELL && z >= z0 && z < z0 + CELL) add(x, z, 'garden');
      }
    }
    return out;
  }

  _buildCell(cx, cz) {
    const trees = this._cellTrees(cx, cz);
    const cell = { trees, mesh: null, cx, cz };
    if (trees.length) {
      const g = new THREE.InstancedBufferGeometry();
      g.index = this.impGeom.index;
      for (const k of ['position', 'normal', 'uv', 'aView']) g.setAttribute(k, this.impGeom.attributes[k]);
      const n = trees.length;
      const mats = new Float32Array(n * 16), imp = new Float32Array(n * 4), col = new Float32Array(n * 3);
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      trees.forEach((t, i) => {
        const T = this.types[t.t];
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r);
        m.compose(p.set(t.x, t.y, t.z), qq, s.setScalar(t.s));
        m.toArray(mats, i * 16);
        imp[i * 4] = T.imp.w; imp[i * 4 + 1] = T.imp.h; imp[i * 4 + 2] = 0; imp[i * 4 + 3] = t.t;
        col.set(t.c, i * 3);
      });
      const mesh = new THREE.InstancedMesh(g, this.impMat, n);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(mats, 16);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
      g.setAttribute('aImp', new THREE.InstancedBufferAttribute(imp, 4));
      mesh.customDepthMaterial = this.impDepth;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 30;
      cell.mesh = mesh;
    }
    return cell;
  }

  update(cam, time, force = false) {
    this.uniforms.uTime.value = time;
    this.impUniforms.uCam.value.copy(cam);
    const moved = !this._last || this._last.distanceTo(cam) > 25;
    if (!moved && !force) return;
    this._last = (this._last || new THREE.Vector3()).copy(cam);
    const R = this.radius;
    const c0x = Math.floor((cam.x - R) / CELL), c1x = Math.floor((cam.x + R) / CELL);
    const c0z = Math.floor((cam.z - R) / CELL), c1z = Math.floor((cam.z + R) / CELL);
    let built = 0;
    const want = new Set();
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const dx = Math.max(0, Math.abs(cam.x - (cx + 0.5) * CELL) - CELL / 2), dz = Math.max(0, Math.abs(cam.z - (cz + 0.5) * CELL) - CELL / 2);
      if (Math.hypot(dx, dz) > R) continue;
      const key = cx + ',' + cz;
      want.add(key);
      if (!this.cells.has(key)) {
        if (built >= (force ? 999 : 2)) { this._last = null; continue; }
        this.cells.set(key, this._buildCell(cx, cz));
        built++;
      }
    }
    for (const [key, cell] of this.cells) {
      const on = want.has(key);
      if (cell.mesh) {
        if (on && !cell.mesh.parent) this.group.add(cell.mesh);
        if (!on && cell.mesh.parent) this.group.remove(cell.mesh);
      }
      if (!on && this.cells.size > 120) { cell.mesh?.geometry.dispose(); this.cells.delete(key); }
    }
    // near trees: full geometry; hide their impostor by distance in the impostor shader? (simple swap: rebuild lists)
    const near = this.near, n2 = near * near;
    const lists = this.types.map(() => []);
    for (const key of want) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      const dx = Math.max(0, Math.abs(cam.x - (cell.cx + 0.5) * CELL) - CELL / 2), dz = Math.max(0, Math.abs(cam.z - (cell.cz + 0.5) * CELL) - CELL / 2);
      if (dx * dx + dz * dz > n2) continue;
      for (const t of cell.trees) {
        const d2 = (t.x - cam.x) ** 2 + (t.y - cam.y) ** 2 + (t.z - cam.z) ** 2;
        if (d2 < n2) lists[t.t].push(t);
      }
    }
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    this.types.forEach((T, i) => {
      const nm = this.nearMeshes[i];
      const L = lists[i];
      const n = Math.min(L.length, nm.w.instanceMatrix.count);
      for (let k = 0; k < n; k++) {
        const t = L[k];
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r);
        m.compose(p.set(t.x, t.y, t.z), qq, s.setScalar(t.s));
        nm.w.setMatrixAt(k, m); nm.l.setMatrixAt(k, m);
        nm.l.setColorAt(k, c.setRGB(t.c[0], t.c[1], t.c[2]));
      }
      nm.w.count = nm.l.count = n;
      nm.w.instanceMatrix.needsUpdate = nm.l.instanceMatrix.needsUpdate = true;
      if (nm.l.instanceColor) nm.l.instanceColor.needsUpdate = true;
    });
    // impostors fade out inside the near radius
    this.impMat.userData.near = near;
  }
}

function hash1(v) { return hash2i(Math.round(v * 13.7), 91, 5); }

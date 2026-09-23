import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as TX from '../textures.js';
import { lathe, baked, mergeLoose, trs, instanced, rng, SAFE } from '../util.js';

export { RoundedBoxGeometry };

let roomEnvCache = null;
export function roomEnv(renderer) {
  if (SAFE.on) return null;
  if (!roomEnvCache) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    roomEnvCache = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  return roomEnvCache;
}

// Real sky + ocean seen through windows.
export function addVista(renderer, scene, { elev = 14, azim = 180, seaY = -14, turbidity = 3, rayleigh = 1.4, clouds = 0.35, gain = 0.4 } = {}) {
  const sky = new Sky();
  // dim the view outside so windows read as sky and sea rather than a blown-out white
  sky.material.fragmentShader = 'uniform float skyGain;\n' + sky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyGain, 1.0 );');
  sky.material.uniforms.skyGain = { value: SAFE.on ? Math.min(1, gain * 1.8) : gain };
  sky.scale.setScalar(8000);
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity; u.rayleigh.value = rayleigh; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = clouds;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azim));
  u.sunPosition.value.copy(sun);
  scene.add(sky);
  const skyScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000);
  for (const k in u) if (k !== 'skyGain' && s2.material.uniforms[k] && u[k].value !== undefined) {
    const v = u[k].value; s2.material.uniforms[k].value = v.clone ? v.clone() : v;
  }
  s2.material.uniforms.showSunDisc.value = 0;
  skyScene.add(s2);
  const skyEnv = SAFE.on ? null : new THREE.PMREMGenerator(renderer).fromScene(skyScene, 0).texture;
  if (SAFE.on) scene.add(new THREE.AmbientLight(0xfff4e8, 0.9));
  const normals = TX.waterNormals();
  normals.repeat.set(260, 260);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), SAFE.on ? new THREE.MeshPhongMaterial({
    color: 0x1f5a82, specular: 0xbfd4e4, shininess: 80, normalMap: normals, normalScale: new THREE.Vector2(0.6, 0.6),
  }) : new THREE.MeshStandardMaterial({
    color: 0x0a2c44, roughness: 0.07, metalness: 0.0, normalMap: normals, normalScale: new THREE.Vector2(0.55, 0.55), envMap: skyEnv, envMapIntensity: gain * 1.6,
  }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = seaY;
  scene.add(sea);
  scene.fog = null;
  return {
    sun, skyEnv, sky,
    update(t) { normals.offset.set(t * 0.004, t * 0.0025); u.time.value = t; },
  };
}

// ---------- materials ----------
export const M = {};
export function initMaterials() {
  if (M.ready) return M;
  M.brass = new THREE.MeshStandardMaterial({ color: 0xd9b26a, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, metalness: 1, roughness: 0.08 });
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0xd8eef2, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.18, envMapIntensity: 2, side: THREE.DoubleSide, depthWrite: false });
  M.whitePaint = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.6 });
  M.darkWood = new THREE.MeshPhysicalMaterial({ map: TX.woodTexture([70, 42, 26], 51), roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  M.lightWood = new THREE.MeshStandardMaterial({ map: TX.woodTexture([168, 124, 84], 53), roughness: 0.5 });
  M.walnut = new THREE.MeshStandardMaterial({ map: TX.woodTexture([98, 62, 40], 57), roughness: 0.45 });
  M.linen = new THREE.MeshStandardMaterial({ map: TX.fabricTexture([236, 232, 224], 61), roughness: 0.92 });
  M.navyFabric = new THREE.MeshPhysicalMaterial({ map: TX.fabricTexture([34, 56, 104], 63), roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x5a78c0), sheenRoughness: 0.6 });
  M.tealFabric = new THREE.MeshPhysicalMaterial({ map: TX.fabricTexture([36, 128, 140], 64), roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0x70d0d8), sheenRoughness: 0.6 });
  M.sandFabric = new THREE.MeshPhysicalMaterial({ map: TX.fabricTexture([214, 196, 168], 65), roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color(0xfff0d8), sheenRoughness: 0.7 });
  M.velvet = new THREE.MeshPhysicalMaterial({ color: 0x7a0f1e, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xff5068), sheenRoughness: 0.45 });
  M.porcelain = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  M.crystal = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.02, transparent: true, opacity: 0.45, envMapIntensity: 3, clearcoat: 1, depthWrite: false });
  M.pianoBlack = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.1, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 });
  M.leaf = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  M.soil = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 1 });
  M.ready = true;
  return M;
}

function leafTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  // palm frond: central rib with many leaflets
  g.strokeStyle = '#6d8a3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(256, 32); g.stroke();
  for (let x = 6; x < 250; x += 7) {
    const L = 30 * Math.sin((x / 256) * Math.PI) + 4;
    for (const s of [1, -1]) {
      const gr = g.createLinearGradient(x, 32, x + 16, 32 + s * L);
      gr.addColorStop(0, '#2f6d2a'); gr.addColorStop(1, '#4f9a3a');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x, 32); g.quadraticCurveTo(x + 10, 32 + s * L * 0.5, x + 18, 32 + s * L); g.quadraticCurveTo(x + 6, 32 + s * L * 0.55, x + 3, 32); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- geometry helpers ----------
// Vertical ribbon along a polyline (for glass balustrades, fascia etc.)
export function ribbon(points, y0, y1) {
  const pos = [], uv = [], idx = [];
  let u = 0;
  points.forEach((p, i) => {
    if (i) u += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    pos.push(p[0], y0, p[1], p[0], y1, p[1]);
    uv.push(u, 0, u, 1);
    if (i) { const a = (i - 1) * 2, b = i * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function railTube(points, y, r = 0.03) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z))), points.length * 4, r, 8, false);
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

export function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

// ---------- furniture ----------
export function sofa(w = 2.4, fabric, { d = 0.95, legs = true, seats = 3 } = {}) {
  const g = new THREE.Group();
  const base = new RoundedBoxGeometry(w, 0.28, d, 3, 0.08);
  g.add(mesh(baked(base, [0, 0.3, 0]), fabric));
  const back = new RoundedBoxGeometry(w, 0.55, 0.22, 3, 0.09);
  g.add(mesh(baked(back, [0, 0.62, -d / 2 + 0.11]), fabric));
  for (const s of [1, -1]) g.add(mesh(baked(new RoundedBoxGeometry(0.2, 0.48, d, 3, 0.08), [s * (w / 2 - 0.1), 0.5, 0]), fabric));
  const cw = (w - 0.44) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -w / 2 + 0.22 + cw * (i + 0.5);
    g.add(mesh(baked(new RoundedBoxGeometry(cw - 0.03, 0.17, d - 0.3, 3, 0.07), [x, 0.52, 0.07]), fabric));
    g.add(mesh(baked(new RoundedBoxGeometry(cw - 0.06, 0.42, 0.16, 3, 0.07), [x, 0.8, -d / 2 + 0.3], [-0.14, 0, 0]), fabric));
  }
  if (legs) for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(mesh(baked(new THREE.CylinderGeometry(0.025, 0.018, 0.16, 8), [x * (w / 2 - 0.12), 0.08, z * (d / 2 - 0.1)]), M.brass));
  return g;
}

export function armchair(fabric) {
  const g = new THREE.Group();
  const shell = lathe([[0, 0.3], [0.42, 0.3], [0.46, 0.4], [0.44, 0.78], [0.38, 0.84], [0.34, 0.8], [0.36, 0.44], [0, 0.44]], 28, Math.PI * 0.2, Math.PI * 1.6);
  shell.rotateY(Math.PI * 0.5);
  g.add(mesh(shell, fabric));
  g.add(mesh(lathe([[0, 0], [0.38, 0], [0.4, 0.06], [0.38, 0.12], [0, 0.12]], 28).translate(0, 0.42, 0.04), fabric));
  g.add(mesh(lathe([[0, 0], [0.12, 0], [0.04, 0.05], [0.04, 0.3], [0, 0.3]], 12), M.brass));
  return g;
}

export function coffeeTable(r = 0.55, top = null) {
  const g = new THREE.Group();
  g.add(mesh(lathe([[0, 0.4], [r, 0.4], [r + 0.02, 0.42], [r, 0.44], [0, 0.44]], 40), top || M.darkWood));
  g.add(mesh(lathe([[0, 0], [r * 0.5, 0], [r * 0.5, 0.02], [0.05, 0.05], [0.05, 0.4], [0, 0.4]], 24), M.brass));
  return g;
}

export function pottedPalm(scale = 1, seed = 1) {
  const g = new THREE.Group();
  const R = rng(seed);
  g.add(mesh(lathe([[0, 0], [0.28, 0], [0.34, 0.1], [0.38, 0.62], [0.4, 0.66], [0.35, 0.66], [0, 0.6]], 24), M.porcelain));
  g.add(mesh(new THREE.CircleGeometry(0.34, 20).rotateX(-Math.PI / 2).translate(0, 0.6, 0), M.soil));
  const fronds = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.4;
    const tilt = 0.5 + R() * 0.7, len = 1.3 + R() * 0.6;
    const pos = [], uv = [], idx = [];
    const seg = 10;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const x = t * len * Math.cos(tilt * 0.6);
      const y = 0.9 + t * len * Math.sin(tilt) - t * t * len * 0.9;
      const w = 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
      pos.push(x, y + w * 0.3, -w, x, y + w * 0.3, w);
      uv.push(t, 0, t, 1);
      if (k) { const b = (k - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    fg.rotateY(a);
    fronds.push(fg);
  }
  fronds.push(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 6).translate(0, 0.85, 0));
  g.add(mesh(mergeLoose(fronds), M.leaf, { cast: true }));
  g.scale.setScalar(scale);
  return g;
}

// Crystal chandelier: concentric rings of hanging rods + glowing core.
export function chandelier({ rings = 5, radius = 2.4, drop = 3, rodLen = 0.9, warm = 0xffd29a, seed = 3 } = {}) {
  const g = new THREE.Group();
  const R = rng(seed);
  const rod = new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, -0.5, 0);
  const drops = new THREE.OctahedronGeometry(0.06, 0);
  const mats = [], dm = [];
  for (let r = 1; r <= rings; r++) {
    const rr = radius * (r / rings);
    const count = Math.round(14 * r * (radius / 2.4));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r * 0.3;
      const len = rodLen + drop * (1 - r / rings) * (0.85 + R() * 0.3);
      mats.push(trs([Math.cos(a) * rr, 0, Math.sin(a) * rr], 0, [1, len, 1]));
      dm.push(trs([Math.cos(a) * rr, -len - 0.05, Math.sin(a) * rr], [0, a, 0], [1, 1.7, 1]));
    }
  }
  g.add(instanced(rod, M.chrome, mats, { cast: false, receive: false }));
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: warm, emissiveIntensity: 2.2, roughness: 0.1, metalness: 0.2 });
  g.add(instanced(drops, glowMat, dm, { cast: false, receive: false }));
  for (let r = 1; r <= rings; r++) {
    const ring = new THREE.TorusGeometry(radius * (r / rings), 0.035, 8, 64).rotateX(Math.PI / 2);
    g.add(mesh(ring, M.brass, { cast: false }));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6).translate(0, 1.5, 0), M.chrome, { cast: false }));
  return g;
}

export function recessedLights(points, y, mat, r = 0.09) {
  const disk = new THREE.CircleGeometry(r, 16).rotateX(Math.PI / 2);
  return instanced(disk, mat, points.map(([x, z]) => trs([x, y - 0.005, z])), { cast: false, receive: false });
}

export function emissiveMat(color, intensity = 3) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false, side: THREE.DoubleSide });
}

// Curtain panel with vertical folds.
export function curtain(w, h, folds = 12, depth = 0.08, mat) {
  const g = new THREE.PlaneGeometry(w, h, folds * 8, 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / w) * folds * Math.PI * 2) * depth);
  g.computeVertexNormals();
  return mesh(g, mat);
}

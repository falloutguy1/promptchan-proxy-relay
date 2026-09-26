import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { makeRust, makeSand, makeBumps } from './textures.js';
import { U } from './materials.js';
import { buildShip } from './ship.js';
import { SUN_DIR, SKY, makeSky, makeTerrain, makeWater, makeDistantLand, sandH, setMounds } from './environment.js';
import { buildAnchor, buildChain, buildRope, buildDebris, buildPerchedGull, buildFlock } from './props.js';
import { buildMirelurk, buildWanderer, placeOnSand } from './creatures.js';
import { rr, srand, rand, smooth } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const HERO = { pos: V(-24, 3.0, 66), tgt: V(16, 8.5, -26), fov: 38 };
const HF = HERO.tgt.clone().sub(HERO.pos).setY(0).normalize(), HR = V(-HF.z, 0, HF.x);
const heroPt = (f, r) => HERO.pos.clone().addScaledVector(HF, f).addScaledVector(HR, r).setY(0);
// ---------------------------------------------------------------- quality tiers
// 0 = desktop, 1 = phone / tablet, 2 = fallback after the GPU dropped the context
const isMobile = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700;
const hashTier = (location.hash.match(/q(\d)/) || [])[1];
const TIER = Math.min(2, Math.max(isMobile ? 1 : 0, hashTier ? +hashTier : 0));
const Q = [
  { shadow: 4096, ao: true, bloom: true, smaa: true, refl: 0.5, dprCap: 2, dpr: 1.5, tex: 1024, terrain: 340 },
  { shadow: 2048, ao: false, bloom: false, smaa: true, refl: 0.33, dprCap: 1.5, dpr: 1.0, tex: 1024, terrain: 240 },
  { shadow: 1024, ao: false, bloom: false, smaa: false, refl: 0.25, dprCap: 1, dpr: 0.75, tex: 512, terrain: 180 },
][TIER];
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: TIER ? 'default' : 'high-performance', stencil: false });
} catch (e) {
  document.getElementById('veil').classList.add('nogl');
  throw e;
}
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (TIER < 2) { location.replace(location.href.split('#')[0] + '#q' + (TIER + 1)); location.reload(); }
}, false);
const maxDPR = Math.min(window.devicePixelRatio || 1, Q.dprCap);
let dpr = Math.min(maxDPR, Q.dpr);
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(SKY.haze.clone(), 0.0021);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 9000);

function build() {
  const rust = makeRust(Q.tex), sand = makeSand(Q.tex), bump = makeBumps(512);
  [rust.map, rust.roughMap, rust.normalMap, sand.map, sand.normalMap, bump].forEach(t => t.anisotropy = renderer.capabilities.getMaxAnisotropy());

  // ---------------- ship placement & sand mounds around the hull
  const placement = { position: V(16, -2.6, -36), yaw: -0.85, pitch: 0.035, roll: 0.08 };
  const ax = V(Math.cos(placement.yaw), 0, -Math.sin(placement.yaw));
  const at = (s) => placement.position.clone().addScaledVector(ax, s);
  setMounds([{ a: at(-44), b: at(40), w: 8.5, fall: 7, h: 1.25 }, { a: at(-50), b: at(-38), w: 3, fall: 9, h: 0.6 }]);

  const sky = makeSky(); scene.add(sky);
  const envScene = new THREE.Scene(); envScene.add(makeSky());
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;

  scene.add(makeTerrain(sand, Q.terrain));
  const water = makeWater(renderer, Q.refl); scene.add(water);
  scene.add(makeDistantLand());

  const ship = buildShip(rust, placement); scene.add(ship.root);
  // the great propeller, torn free and leaning against the hull in the sand
  {
    const pg = ship.propGroup, pr = V(-ax.z, 0, ax.x);
    const p = at(27).addScaledVector(pr, 12.8);
    p.y = sandH(p.x, p.z) + 1.9;
    pg.position.copy(p);
    pg.quaternion.setFromUnitVectors(V(1, 0, 0), pr.clone().multiplyScalar(0.9).add(V(0, 0.5, 0)).addScaledVector(ax, 0.25).normalize());
    pg.rotateX(0.5); pg.scale.setScalar(1.25);
    scene.add(pg);
    ship.prop = p.clone();
  }

  // ---------------- lighting
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffeedd'), 4.2);
  const tgt = V(8, 0, -8);
  sun.position.copy(tgt).addScaledVector(SUN_DIR, 180); sun.target.position.copy(tgt);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const sc = sun.shadow.camera; sc.left = -100; sc.right = 100; sc.top = 90; sc.bottom = -90; sc.near = 20; sc.far = 400;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(new THREE.Color('#9fb3c6'), new THREE.Color('#b89c84'), 0.32));
  const fill = new THREE.DirectionalLight(new THREE.Color('#9fb2d0'), 0.45); fill.position.set(80, 40, -60); scene.add(fill);

  // ---------------- foreground: anchor, gull, chain, wanderer
  const anchorBase = heroPt(15, -5.6); anchorBase.y = sandH(anchorBase.x, anchorBase.z);
  const anchor = buildAnchor(rust, anchorBase); anchor.group.rotation.y = 0.25; anchor.group.scale.setScalar(0.78); scene.add(anchor.group);
  anchor.group.updateMatrixWorld(true);
  const perch = V(1.72, 9.25, 0).applyMatrix4(anchor.group.matrixWorld);
  const gull = buildPerchedGull(); gull.position.copy(perch); gull.rotation.y = -1.1; scene.add(gull);
  const chainPts = [new THREE.Vector3(5.9, 0, 3.8).applyMatrix4(anchor.group.matrixWorld), heroPt(16, -1), heroPt(15, 3), heroPt(18, 7), heroPt(24, 10), heroPt(32, 12), heroPt(40, 15)];
  scene.add(buildChain(rust, chainPts));
  const wanderer = buildWanderer(bump);
  const wp = heroPt(8.2, -3.9); placeOnSand(wanderer, wp.x, wp.z, 0.0); wanderer.position.y = Math.max(wanderer.position.y, -0.35);
  wanderer.lookAt(V(30, wanderer.position.y, -8)); wanderer.rotateY(-Math.PI / 2);
  wanderer.scale.setScalar(1.08);
  scene.add(wanderer);

  // rope from the broken bow down to the sand
  const ropeA = V(-44, 13.5, 8).applyMatrix4(ship.roll.matrixWorld);
  scene.add(buildRope(ropeA, V(-48, 0, 6), 1.2));

  // ---------------- debris field
  srand(3);
  const plates = [], stubs = [], drums = [], rocks = [], weeds = [];
  for (let i = 0; i < 14; i++) { const s = rr(-50, 45); const p = at(s).addScaledVector(V(-ax.z, 0, ax.x), rr(12, 26) * (rand() < 0.7 ? 1 : -1)); plates.push({ x: p.x, z: p.z, w: rr(2, 6), h: rr(1.2, 3.5), tilt: rr(-1.1, -0.3), yaw: rr(0, 6.28) }); }
  for (let i = 0; i < 6; i++) { const p = at(rr(-62, -40)).addScaledVector(V(-ax.z, 0, ax.x), rr(-10, 14)); stubs.push({ x: p.x, z: p.z, len: rr(2, 5), r: rr(0.5, 2), yaw: rr(0, 6.28) }); }
  drums.push({ x: 8, z: 6, tilt: 1.4, yaw: 0.4 }, { x: 36, z: -4, tilt: 1.2, yaw: 2.2 }, { x: -30, z: -6, tilt: 0.2, yaw: 0 });
  for (let i = 0; i < 60; i++) { const x = rr(-70, 80), z = rr(-80, 50); rocks.push({ x, z, s: rr(0.15, 0.7) }); }
  for (let i = 0; i < 14; i++) rocks.push({ x: anchorBase.x + rr(-4, 5), z: anchorBase.z + rr(-3, 4), s: rr(0.2, 0.6) });
  for (let i = 0; i < 40; i++) { const x = rr(-60, 80), z = rr(-75, 40); const h = sandH(x, z); if (h > -0.05 && h < 0.5) weeds.push({ x, z, s: rr(0.2, 0.6) }); }
  scene.add(buildDebris(rust, { plates, stubs, drums, rocks, weeds }));

  // ---------------- mirelurks
  const lurks = [];
  const lurkDefs = [
    { c: V(28, 0, 6), r: 5, sp: 0.06, s: 1.0 }, { c: V(20, 0, 14), r: 4, sp: -0.05, s: 0.9 },
    { c: V(33, 0, 11), r: 3, sp: 0.07, s: 1.1 }, { c: V(46, 0, -4), r: 3, sp: -0.04, s: 0.95 },
  ];
  for (const d of lurkDefs) { const m = buildMirelurk(bump, d.s); m.userData.def = d; m.userData.ph = rr(0, 6.28); scene.add(m); lurks.push(m); }

  const flock = buildFlock(14); scene.add(flock);

  scene.traverse(o => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity ??= 1; });
  return { ship, water, sun, gull, lurks, wanderer, flock, perch, placement, anchor };
}

// ---------------------------------------------------------------- post-processing
let composer, aoPass, gradePass, W;
function setupPost() {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  if (Q.ao) {
    aoPass = new N8AOPass(scene, camera, innerWidth, innerHeight);
    aoPass.configuration.aoRadius = 2.5; aoPass.configuration.distanceFalloff = 0.8; aoPass.configuration.intensity = 2.2;
    aoPass.configuration.halfRes = true; aoPass.configuration.gammaCorrection = false; aoPass.configuration.aoSamples = 12; aoPass.configuration.denoiseSamples = 6;
    composer.addPass(aoPass);
  } else composer.addPass(new RenderPass(scene, camera));
  if (Q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.14, 0.5, 0.95));
  composer.addPass(new OutputPass());
  if (Q.smaa) composer.addPass(new SMAAPass());
  gradePass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5; float r2 = dot(d,d);
        vec3 c;
        c.r = texture2D(tDiffuse, vUv - d*0.0022).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv + d*0.0022).b;
        float l = dot(c, vec3(0.299,0.587,0.114));
        c = mix(c, c*vec3(0.95,1.0,1.05), (1.0-l)*0.6);
        c = mix(c, c*vec3(1.03,1.0,0.97), l*0.5);
        c = mix(vec3(l), c, 1.05);
        c *= 1.0 - r2*0.6;
        c += (hash(vUv*uRes + fract(uTime)*91.0) - 0.5) * 0.022;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(gradePass);
  composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
}

// ---------------------------------------------------------------- views
let views = [];
function makeViews() {
  const pl = W.placement;
  const ax = V(Math.cos(pl.yaw), 0, -Math.sin(pl.yaw)), perp = V(-ax.z, 0, ax.x);
  const c = pl.position.clone().setY(0);
  const prop = c.clone().addScaledVector(ax, 40);
  views = [
    HERO,                               // hero (reference 3)
    { pos: W.ship.prop.clone().addScaledVector(perp, 9).addScaledVector(ax, 9).setY(1.3), tgt: W.ship.prop.clone().addScaledVector(ax, -14).addScaledVector(perp, -1).setY(8), fov: 60 }, // low hull (reference 1)
    { pos: c.clone().addScaledVector(perp, 52).addScaledVector(ax, 2).setY(4.5), tgt: c.clone().setY(8.5), fov: 44 }, // broadside (reference 2)
    (() => { const d = c.clone().sub(W.perch).setY(0).normalize(), sd = V(-d.z, 0, d.x);
      return { pos: W.perch.clone().addScaledVector(d, -5.5).addScaledVector(sd, -1.6).add(V(0, -0.5, 0)), tgt: W.perch.clone().addScaledVector(d, 12).add(V(0, -1.2, 0)), fov: 40 }; })(),  // anchor + gull
    { pos: c.clone().addScaledVector(perp, 70).addScaledVector(ax, 75).setY(55), tgt: c.clone().setY(5), fov: 40 }, // aerial
  ];
}
let tween = null, current = 0;
// widen the vertical field of view on tall screens so the composition still fits
function fitFov(f) {
  const a = camera.aspect, ref = 1.6;
  if (a >= ref) return f;
  const k = 1 + (ref / a - 1) * 0.3;
  return Math.min(80, 2 * Math.atan(Math.tan(f * Math.PI / 360) * k) * 180 / Math.PI);
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.62; controls.minDistance = 3; controls.maxDistance = 420;
controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.8;
// on tall screens also dolly the camera back so the wide shots keep their width
function pose(v) {
  const a = camera.aspect, ref = 1.6;
  if (a >= ref) return v;
  const f = Math.min(1.3, Math.pow(ref / a, 0.3));
  return { pos: v.tgt.clone().addScaledVector(v.pos.clone().sub(v.tgt), f), tgt: v.tgt, fov: v.fov };
}
function setView(i, instant = false) {
  current = i; const v = pose(views[i]);
  document.querySelectorAll('#views button').forEach((b, k) => b.classList.toggle('on', k === i));
  if (instant) { camera.position.copy(v.pos); controls.target.copy(v.tgt); camera.fov = fitFov(v.fov); camera.updateProjectionMatrix(); controls.update(); return; }
  tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), f0: camera.fov, v, f1: fitFov(v.fov) };
}
window.__setView = (i) => setView(i, true);
window.__cam = (p, t, f) => { camera.position.set(...p); controls.target.set(...t); if (f) { camera.fov = f; camera.updateProjectionMatrix(); } controls.update(); };
window.__near = (k, off, f) => { const o = W[k].position; window.__cam([o.x + off[0], o.y + off[1], o.z + off[2]], [o.x, o.y + 0.8, o.z], f); };
window.__lurks = () => [W.ship.prop.toArray(), ...W.lurks.map(m => m.position.toArray().map(v => +v.toFixed(1)))];

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
let frames = 0, acc = 0;
function animate() {
  timer.update(); const dt = Math.min(timer.getDelta(), 0.1), t = timer.getElapsed();
  U.time.value = t;
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 2.4);
    const k = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - Math.pow(-2 * tween.t + 2, 3) / 2;
    const lift = Math.sin(Math.PI * k) * Math.min(12, tween.p0.distanceTo(tween.v.pos) * 0.08);
    camera.position.lerpVectors(tween.p0, tween.v.pos, k).y += lift;
    controls.target.lerpVectors(tween.t0, tween.v.tgt, k);
    camera.fov = tween.f0 + (tween.f1 - tween.f0) * k; camera.updateProjectionMatrix();
    if (tween.t >= 1) tween = null;
  }
  controls.update();
  // keep camera above sand/water
  const gy = Math.max(sandH(camera.position.x, camera.position.z), 0) + 0.6;
  if (camera.position.y < gy) camera.position.y = gy;

  // creatures
  for (const m of W.lurks) {
    const d = m.userData.def, a = m.userData.ph + t * d.sp;
    const x = d.c.x + Math.cos(a) * d.r, z = d.c.z + Math.sin(a) * d.r * 0.6;
    m.position.set(x, sandH(x, z), z);
    m.rotation.y = -Math.atan2(Math.cos(a) * d.r * 0.6 * Math.sign(d.sp), -Math.sin(a) * d.r * Math.sign(d.sp));
    m.userData.update(t + m.userData.ph, 1);
  }
  W.wanderer.userData.update(t);
  W.flock.userData.update(t);
  const hd = W.gull.userData.head;
  hd.rotation.y = Math.sin(t * 0.45) * 0.7 + (Math.sin(t * 0.13) > 0.8 ? 0.6 : 0);
  hd.rotation.x = Math.sin(t * 0.9) * 0.08;
  gradePass.uniforms.uTime.value = t;
  renderer.shadowMap.needsUpdate = true;
  composer.render(dt);

  // adaptive resolution
  frames++; acc += dt;
  if (acc > 2.0) {
    const ms = acc / frames * 1000;
    if (ms > 24 && dpr > 0.7) { dpr = Math.max(0.7, dpr - 0.15); resize(); }
    else if (ms < 13 && dpr < maxDPR) { dpr = Math.min(maxDPR, dpr + 0.1); resize(); }
    frames = 0; acc = 0;
  }
  requestAnimationFrame(animate);
}
function resize() {
  camera.aspect = innerWidth / innerHeight;
  if (!tween && views[current]) camera.fov = fitFov(views[current].fov);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight);
  composer.setPixelRatio(dpr); composer.setSize(innerWidth, innerHeight);
  gradePass.uniforms.uRes.value.set(innerWidth * dpr, innerHeight * dpr);
  const s = new THREE.Vector2(); renderer.getDrawingBufferSize(s);
  W.water.getRenderTarget().setSize(Math.max(256, s.x * Q.refl), Math.max(256, s.y * Q.refl));
}
addEventListener('resize', resize);
addEventListener('keydown', (e) => { const k = parseInt(e.key, 10); if (k >= 1 && k <= views.length) setView(k - 1); });

requestAnimationFrame(() => setTimeout(() => {
  W = build();
  setupPost();
  makeViews();
  const nav = document.getElementById('views');
  views.forEach((_, i) => { const b = document.createElement('button'); b.setAttribute('aria-label', 'View ' + (i + 1)); b.onclick = () => setView(i); nav.appendChild(b); });
  camera.aspect = innerWidth / innerHeight;
  setView(0, true);
  renderer.compile(scene, camera);
  animate();
  setTimeout(() => { document.body.classList.add('ready'); window.__ready = true; }, 300);
  window.__info = () => JSON.stringify({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, dpr, tier: TIER, fov: camera.fov });
}, 30));

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildShip } from './ship.js';
import { createSky, atmo, MOODS, lerpMood } from './sky.js';
import { bakeClouds, makeNoise3D } from './clouds.js';
import { createSkyBaker } from './skybake.js';
import { createWater } from './water.js';
import { shared } from './procmat.js';
import { VIEWS, buildUI } from './ui.js';
import { hullHalfW } from './dims.js';

// Smooth, noise-free PCF: fixed 3x3 kernel of hardware-filtered taps (the shadow map is static).
THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
  /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;\s*shadow = \([\s\S]*?\) \* 0\.2;/,
  `shadow = 0.0;
  for ( int ix = - 1; ix <= 1; ix ++ ) for ( int iy = - 1; iy <= 1; iy ++ )
    shadow += texture( shadowMap, vec3( shadowCoord.xy + vec2( float( ix ), float( iy ) ) * radius, shadowCoord.z ) );
  shadow *= 1.0 / 9.0;`
);

const params = new URLSearchParams(location.search);
const LOCK_Q = params.has('q');

// Quality tier: 0 desktop, 1 phones/tablets, 2 fallback after the GPU dropped the context once.
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } };
const MOBILE = (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));
let tier = Math.max(MOBILE ? 1 : 0, parseInt(ssGet('cruise-tier') || '0', 10) || 0);
if (params.has('tier')) tier = parseInt(params.get('tier'), 10) || 0;
tier = Math.min(2, Math.max(0, tier));
const TIER = [
  { dprCap: 2, q: 1.0, qMin: 0.55, shadow: 4096, samples: 4, refl: 0.5, skyW: 6144, skyH: 1536, tiles: 24 },
  { dprCap: 2, q: 0.72, qMin: 0.5, shadow: 2048, samples: 4, refl: 0.4, skyW: 4096, skyH: 1280, tiles: 32 },
  { dprCap: 1.5, q: 0.62, qMin: 0.45, shadow: 2048, samples: 4, refl: 0.3, skyW: 2048, skyH: 768, tiles: 16 },
][tier];

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('shot') });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const baseDPR = Math.min(window.devicePixelRatio || 1, TIER.dprCap);
let qScale = LOCK_Q ? parseFloat(params.get('q')) || 1 : tier === 0 ? (baseDPR > 1.3 ? 0.8 : 1.0) : TIER.q;
// Half-float render targets need a colour-buffer-float extension; fall back to 8-bit targets without it.
const FLOAT_RT = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
const RT_TYPE = FLOAT_RT ? THREE.HalfFloatType : THREE.UnsignedByteType;

// If the GPU resets the context (driver timeout or memory pressure), reload once at a lighter tier.
let contextLost = false;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  const reloads = parseInt(ssGet('cruise-reloads') || '0', 10) || 0;
  if (reloads < 3) {
    ssSet('cruise-reloads', String(reloads + 1));
    ssSet('cruise-tier', String(Math.min(2, tier + 1)));
    setTimeout(() => location.reload(), 400);
  }
}, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.8, 30000);
camera.layers.enable(1);

// ------------------------------------------------------------------ world
const skyBaker = createSkyBaker(renderer, {
  width: Math.min(TIER.skyW, renderer.capabilities.maxTextureSize),
  height: TIER.skyH,
  cluster: bakeClouds(renderer, 512).texture,
  noise3: makeNoise3D(64),
  tiles: TIER.tiles,
});
const sky = createSky();
scene.add(sky);
const water = createWater({ type: RT_TYPE });
scene.add(water.mesh);
const { ship, anim, materials: shipMats } = buildShip();
scene.add(ship);

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(TIER.shadow, TIER.shadow);
const sc = sun.shadow.camera;
sc.left = -195; sc.right = 195; sc.top = 195; sc.bottom = -195; sc.near = 10; sc.far = 1100;
sc.layers.enable(1);
// bias tuned for a 4096 map; a coarser map needs proportionally more to avoid acne
const shadowK = 4096 / TIER.shadow;
sun.shadow.bias = -0.00003 * shadowK;
sun.shadow.normalBias = 0.06 * shadowK;
sun.shadow.radius = 0.85;
sun.target.position.set(0, 35, 0);
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.3);
scene.add(hemi);

// ------------------------------------------------------------------ environment (PMREM of the sky)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = createSky();
envScene.add(envSky);
const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: RT_TYPE, generateMipmaps: false });
const cubeCam = new THREE.CubeCamera(1, 100, cubeRT);
let envRT = null;
function updateEnv() {
  cubeCam.update(renderer, envScene);
  envRT = pmrem.fromCubemap(cubeRT.texture, envRT);
  scene.environment = envRT.texture;
}

// ------------------------------------------------------------------ post
const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: RT_TYPE, samples: TIER.samples });
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
// A single NaN/Inf pixel from any shader would be smeared over the whole frame by bloom; scrub them first.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = min(max(c.rgb, vec3(0.0)), vec3(6.0e4));
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 1.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.42 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; varying vec2 vUv;
    float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d * vec2(1.1, 1.0), d * vec2(1.1, 1.0)) * uVig;
      c *= v;
      float g = h(gl_FragCoord.xy + fract(uTime * 7.0) * 311.0) - 0.5;
      c += g * 0.014;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(finish);
// The scene always lands in renderTarget2 as long as each frame swaps an even number of times
// (scrub + output); the last pass draws to screen and needs no swap. Only that target needs MSAA.
finish.needsSwap = false;
composer.renderTarget1.samples = 0;

// The page can start at 0x0 (e.g. inside a preview sheet that is still opening); nothing may divide by that.
function viewSize() {
  const de = document.documentElement;
  return [Math.round(window.innerWidth || de.clientWidth || 0), Math.round(window.innerHeight || de.clientHeight || 0)];
}
let sizedW = 0, sizedH = 0, fitPending = false;
function resize() {
  const [w, h] = viewSize();
  if (w < 2 || h < 2) return;
  const dpr = baseDPR * qScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  water.setSize(w * dpr * TIER.refl, h * dpr * TIER.refl);
  sizedW = w; sizedH = h;
  if (fitPending && typeof goView === 'function') { fitPending = false; goView(viewIndex, true); }
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(document.documentElement);

// ------------------------------------------------------------------ moods
const mood = {};
let moodFrom = MOODS[0], moodTo = MOODS[0], moodT = 1, moodIndex = 0;
function applyMood(m) {
  atmo.uSunDir.value.copy(m.sunDir);
  atmo.uSunCol.value.copy(m.sunCol);
  atmo.uZenith.value.copy(m.zenith);
  atmo.uHorizon.value.copy(m.horizon);
  atmo.uGround.value.copy(m.ground);
  atmo.uGlow.value.copy(m.glow);
  atmo.uGlowPow.value = m.glowPow;
  atmo.uCloud.value = m.cloud;
  atmo.uCloudLit.value.copy(m.cloudLit);
  atmo.uCloudShade.value.copy(m.cloudShade);
  atmo.uNightAmt.value = m.night;
  atmo.uMoonDir.value.copy(m.sunDir);
  atmo.uSunDisk.value = m.sunDisk;
  shared.uNight.value = Math.max(0, (m.night - 0.05) / 0.95);
  sun.color.copy(m.sunCol);
  sun.intensity = m.sunI;
  sun.position.copy(sun.target.position).addScaledVector(m.sunDir, 600);
  hemi.color.copy(m.hemiSky); hemi.groundColor.copy(m.hemiGround); hemi.intensity = m.hemiI;
  scene.environmentIntensity = m.envI;
  renderer.toneMappingExposure = m.exposure;
  water.uniforms.uDeep.value.copy(m.deep);
  water.uniforms.uScatter.value.copy(m.scatter);
  water.uniforms.uFogDen.value = m.fog;
  water.uniforms.uSpecI.value = m.specI;
  bloom.strength = m.bloom;
  bloom.threshold = THREE.MathUtils.lerp(1.5, 0.95, m.night);
  const n = shared.uNight.value;
  if (anim.coasterTrack) anim.coasterTrack.emissiveIntensity = n * 0.9;
  for (const l of anim.navLights || []) l.emissiveIntensity = n * 6;
  shipMats.lamp.emissiveIntensity = n * 4.0;
  renderer.shadowMap.needsUpdate = true;
}
function setMood(i) {
  if (i === moodIndex && moodT >= 1) return;
  moodFrom = lerpMood(moodFrom, moodTo, easeInOut(Math.min(1, moodT)), {});
  moodTo = MOODS[i]; moodIndex = i; moodT = 0;
  skyBaker.start(MOODS[i]);
  ui.setMood(i);
}

// ------------------------------------------------------------------ camera views
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 18;
controls.maxDistance = 1800;
controls.maxPolarAngle = Math.PI * 0.62;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.8;
controls.panSpeed = 0.6;

const CENTER = new THREE.Vector3(-5, 32, 0);
let tween = null;
let viewIndex = 0;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function sph(p) {
  const v = p.clone().sub(CENTER);
  const r = v.length();
  return { r, th: Math.atan2(v.z, v.x), ph: Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)) };
}
// pull the camera back on narrow (portrait) screens so the ship still fits
function fitFactor() {
  const a = sizedW / sizedH;
  if (!sizedW || !sizedH || !Number.isFinite(a) || a <= 0) return 1;
  return a >= 1.5 ? 1 : Math.min(3, Math.pow(1.5 / a, 0.62));
}
function goView(i, instant = false, dur = 2.8) {
  viewIndex = i;
  const v = VIEWS[i];
  const toTgt = new THREE.Vector3(...v.target);
  if (!sizedW) fitPending = true;
  const toPos = new THREE.Vector3(...v.pos).sub(toTgt).multiplyScalar(fitFactor()).add(toTgt);
  if (toPos.y < 2.5) toPos.y = 2.5;
  ui.setView(i);
  if (instant) {
    camera.position.copy(toPos); controls.target.copy(toTgt); camera.fov = v.fov; camera.updateProjectionMatrix();
    controls.update(); tween = null; return;
  }
  const a = sph(camera.position), b = sph(toPos);
  let dth = b.th - a.th;
  while (dth > Math.PI) dth -= Math.PI * 2;
  while (dth < -Math.PI) dth += Math.PI * 2;
  tween = { t: 0, dur, a, b, dth, fromT: controls.target.clone(), toT: toTgt, fromFov: camera.fov, toFov: v.fov };
}
function stepTween(dt) {
  if (!tween) return;
  tween.t += dt / tween.dur;
  const k = Math.min(1, tween.t), e = easeInOut(k);
  const { a, b } = tween;
  const bump = Math.max(0, 300 - Math.min(a.r, b.r)) * Math.sin(Math.PI * e) * 0.9 * Math.min(1, Math.abs(tween.dth) / 0.6 + 0.3);
  const r = a.r + (b.r - a.r) * e + bump;
  const th = a.th + tween.dth * e;
  let ph = a.ph + (b.ph - a.ph) * e;
  ph -= Math.sin(Math.PI * e) * 0.12 * Math.min(1, bump / 150);
  camera.position.set(CENTER.x + r * Math.sin(ph) * Math.cos(th), CENTER.y + r * Math.cos(ph), CENTER.z + r * Math.sin(ph) * Math.sin(th));
  if (camera.position.y < 2) camera.position.y = 2;
  controls.target.lerpVectors(tween.fromT, tween.toT, e);
  camera.fov = tween.fromFov + (tween.toFov - tween.fromFov) * e;
  camera.updateProjectionMatrix();
  if (k >= 1) tween = null;
}

// guided tour
let touring = false, tourHold = 0;
function setTour(on) {
  touring = on; tourHold = 0; ui.setTour(on);
  if (on) goView((viewIndex + 1) % VIEWS.length, false, 3.6);
}

// ------------------------------------------------------------------ UI
const ui = buildUI({
  onView: (i) => { if (touring) setTour(false); goView(i); },
  onMood: (i) => setMood(i),
  onTour: () => setTour(!touring),
  onFull: () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  },
});
controls.addEventListener('start', () => { tween = null; if (touring) setTour(false); });
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= VIEWS.length) { if (touring) setTour(false); goView(n - 1); }
  else if (e.key === 'n' || e.key === 'N') setMood((moodIndex + 1) % MOODS.length);
  else if (e.key === ' ') { e.preventDefault(); setTour(!touring); }
  else if (e.key === 'f' || e.key === 'F') ui.toggleFull();
  else if (e.key === 'h' || e.key === 'H') ui.toggleHidden();
  else if (e.key === 'ArrowRight') { if (touring) setTour(false); goView((viewIndex + 1) % VIEWS.length); }
  else if (e.key === 'ArrowLeft') { if (touring) setTour(false); goView((viewIndex + VIEWS.length - 1) % VIEWS.length); }
});

// ------------------------------------------------------------------ animation helpers
const tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
function animateShip(t, dt) {
  if (anim.radars) anim.radars.forEach((r, i) => { r.rotation.y = t * (i ? 2.1 : -2.6) + i; });
  const c = anim.coaster;
  if (c) {
    const g = 9.81;
    const u = ((c.s % c.L) + c.L) % c.L / c.L;
    const p = c.curve.getPointAt(u);
    const v = Math.sqrt(2 * g * (c.yMax - p.y) + 16);
    c.s += v * dt;
    c.cars.forEach((car, i) => {
      const uu = ((((c.s - i * 2.6) % c.L) + c.L) % c.L) / c.L;
      const pp = c.curve.getPointAt(uu);
      const tt = c.curve.getTangentAt(uu);
      const side = tmpV.crossVectors(tt, up).normalize();
      const uup = new THREE.Vector3().crossVectors(side, tt).normalize();
      tmpM.makeBasis(tt, uup, side);
      car.quaternion.setFromRotationMatrix(tmpM);
      car.position.copy(pp).addScaledVector(uup, 0.05);
    });
  }
}

// adaptive resolution
let acc = 0, frames = 0, cooldown = 2;
function adapt(dt) {
  if (LOCK_Q) return;
  acc += dt; frames++;
  if (acc < 1.2) return;
  const ms = (acc / frames) * 1000;
  acc = 0; frames = 0;
  if (cooldown > 0) { cooldown--; return; }
  if (ms > 24 && qScale > TIER.qMin) { qScale = Math.max(TIER.qMin, qScale - 0.1); resize(); cooldown = 1; }
  else if (ms < 12.5 && qScale < 1.0) { qScale = Math.min(1.0, qScale + 0.05); resize(); cooldown = 2; }
}

// ------------------------------------------------------------------ start
resize();
const startView = params.has('view') ? Math.min(VIEWS.length - 1, Math.max(0, parseInt(params.get('view'), 10) - 1)) : 0;
const startMood = params.has('mood') ? Math.min(MOODS.length - 1, Math.max(0, parseInt(params.get('mood'), 10) - 1)) : 0;
moodFrom = moodTo = MOODS[startMood]; moodIndex = startMood;
applyMood(MOODS[startMood]);
skyBaker.start(MOODS[startMood], true);
ui.setMood(moodIndex);
goView(startView, true);

const timer = new THREE.Timer();
timer.connect(document);
let time = params.has('t') ? parseFloat(params.get('t')) : 0;
let envCounter = 0;
const drift = new THREE.Vector3();
let firstFrame = true;

let skyWasBusy = true;
function camOK() {
  const p = camera.position, t = controls.target;
  return Number.isFinite(p.x + p.y + p.z + t.x + t.y + t.z + camera.fov + camera.aspect);
}
function frame() {
  if (contextLost) return;
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);
  const [vw, vh] = viewSize();
  if (vw !== sizedW || vh !== sizedH) resize();
  if (!sizedW) return; // still zero-size: wait
  // first bake the sky (a few strips per frame) while the loader is showing
  if (firstFrame && skyBaker.baking) { skyBaker.update(4, dt); return; }
  time += dt;
  atmo.uSkyRot.value = time * 0.00025;
  shared.uTime.value = time;
  water.uniforms.uTime.value = time;
  atmo.uSkyTime.value = time;
  finish.uniforms.uTime.value = time;

  const skyBusy = skyBaker.update(2, dt);
  if (moodT < 1) {
    moodT = Math.min(1, moodT + dt / 2.2);
    lerpMood(moodFrom, moodTo, easeInOut(moodT), mood);
    applyMood(mood);
  }
  if (moodT < 1 || skyBusy) { if (++envCounter % 5 === 0) updateEnv(); }
  else if (skyWasBusy || envCounter) { updateEnv(); envCounter = 0; }
  skyWasBusy = skyBusy;

  if (touring && !tween) {
    tourHold += dt;
    const k = 0.035 * dt;
    tmpV.copy(camera.position).sub(controls.target).applyAxisAngle(up, k);
    camera.position.copy(controls.target).add(tmpV);
    if (tourHold > 7) { tourHold = 0; goView((viewIndex + 1) % VIEWS.length, false, 3.6); }
  }
  stepTween(dt);
  controls.update();
  if (!camOK()) { tween = null; goView(viewIndex, true); } // never let a bad value stick
  if (camera.position.y < 1.8) camera.position.y = 1.8;
  // keep the camera a few metres off the hull and superstructure
  const cp = camera.position;
  if (cp.x > -178 && cp.x < 184 && cp.y < 66) {
    const hw = cp.x > 176 ? 0 : hullHalfW(Math.min(cp.x, 175), Math.max(0, Math.min(cp.y, 24)));
    const lim = Math.max(hw, cp.y > 24 ? 21 : 0) + 9;
    if (Math.abs(cp.z) < lim) {
      if (cp.x > 176 || cp.x < -176) {} else cp.z = Math.sign(cp.z || 1) * lim;
    }
  }

  // subtle hand-held drift
  const dist = cp.distanceTo(controls.target);
  drift.set(Math.sin(time * 0.21) * 0.5, Math.sin(time * 0.17 + 1.3) * 0.3, Math.cos(time * 0.13) * 0.5).multiplyScalar(dist / 400);
  cp.add(drift);
  camera.updateMatrixWorld();

  animateShip(time, dt);
  water.renderReflection(renderer, scene, camera);
  composer.render(dt);
  cp.sub(drift);

  if (firstFrame) { firstFrame = false; ui.ready(); ssSet('cruise-reloads', '0'); }
  window.__frames = (window.__frames || 0) + 1;
  adapt(dt);
}

async function start() {
  try { await renderer.compileAsync(scene, camera); } catch (e) { /* fall back to lazy compile */ }
  requestAnimationFrame(frame);
}
start();
function moodNow(i) {
  moodFrom = moodTo = MOODS[i]; moodIndex = i; moodT = 1;
  skyBaker.bakeNow(MOODS[i]);
  applyMood(MOODS[i]); updateEnv(); ui.setMood(i);
}
window.__ship = { tier, skyBaker, renderer, scene, camera, goView, setMood, moodNow, controls, setTime: (t) => { time = t; } };

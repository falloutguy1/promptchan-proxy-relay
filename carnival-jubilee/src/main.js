import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildShip } from './ship.js';
import { buildEnvironment, PRESETS } from './environment.js';
import { setAnisotropy } from './textures.js';
import { isMobile, clamp, lerp, SAFE } from './util.js';
import { buildAtrium } from './interiors/atrium.js';
import { buildStateroom } from './interiors/stateroom.js';
import { buildDining } from './interiors/dining.js';
import { buildTheater } from './interiors/theater.js';

const $ = (s) => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const canvas = $('#scene');
const fade = $('#fade');
const loader = $('#loader');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
const maxPR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 2);
let pixelRatio = Math.min(maxPR, isMobile ? 1.25 : 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
// Many mobile GPUs cannot render into half-float targets; without that, PMREM, the water mirror and the
// HDR post chain all produce garbage (a white screen), so fall back to direct rendering.
SAFE.on = Q.has('safe') || !renderer.extensions.has('EXT_color_buffer_float');

const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.5, 80000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.8;
controls.autoRotateSpeed = 0.35;

// ---------------------------------------------------------------- exterior world
const world = new THREE.Scene();
let env, ship;

// ---------------------------------------------------------------- post
const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: isMobile ? 0 : 4 });
const composer = new EffectComposer(renderer, target);
const renderPass = new RenderPass(world, camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 0.92);
// Soft-knee high pass: subtract the threshold and cap hot pixels so bright sky never veils the frame.
bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
  'gl_FragColor = mix( outputColor, texel, alpha );',
  'vec3 hot = max( texel.rgb - vec3( luminosityThreshold ), 0.0 ); gl_FragColor = vec4( min( hot, vec3( 2.5 ) ) * alpha, 1.0 );');
bloom.materialHighPassFilter.needsUpdate = true;
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  // keep the whole ship framed on tall phone screens
  camera.userData.fovScale = w / h < 1 ? clamp(1 / (w / h) * 0.6, 1, 1.45) : 1;
  applyFov();
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  bloom.resolution.set(Math.round(w * pixelRatio / 2), Math.round(h * pixelRatio / 2));
}
let baseFov = 36;
// On narrow screens pull exterior cameras back so the same horizontal slice of the ship stays in frame.
function framed(v) {
  const a = window.innerWidth / window.innerHeight;
  if (a >= 1.3) return v.pos.clone();
  const refH = Math.atan(Math.tan(THREE.MathUtils.degToRad(v.fov) / 2) * 1.6);
  const vf = clamp(v.fov * (a < 1 ? clamp(1 / a * 0.6, 1, 1.45) : 1), 20, 85);
  const curH = Math.atan(Math.tan(THREE.MathUtils.degToRad(vf) / 2) * a);
  const k = clamp(Math.tan(refH) / Math.tan(curH) * 0.88, 1, 2.4);
  return v.target.clone().add(v.pos.clone().sub(v.target).multiplyScalar(k));
}
function applyFov() {
  const s = camera.userData.fovScale || 1;
  const hfovScaled = baseFov * s;
  camera.fov = clamp(hfovScaled, 20, 85);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- views
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const VIEWS = {
  hero: { kind: 'ext', pos: V(300, 58, 292), target: V(-12, 30, 0), fov: 34, shadow: [V(0, 30, 0), 200], min: 90, max: 1100 },
  profile: { kind: 'ext', pos: V(-12, 26, 440), target: V(-4, 28, 0), fov: 32, shadow: [V(0, 30, 0), 200], min: 90, max: 1100 },
  aerial: { kind: 'ext', pos: V(-190, 300, 170), target: V(-12, 40, 0), fov: 36, shadow: [V(0, 30, 0), 200], min: 90, max: 1100 },
  stern: { kind: 'ext', pos: V(-330, 34, -170), target: V(-70, 30, 0), fov: 34, shadow: [V(-60, 30, 0), 180], min: 90, max: 1100 },
  lido: { kind: 'ext', pos: V(-44, 67, 44), target: V(6, 52, 0), fov: 46, shadow: [V(0, 52, 0), 70], min: 18, max: 220 },
  coaster: { kind: 'ext', pos: V(-38, 82, 52), target: V(-94, 63, 0), fov: 44, shadow: [V(-92, 60, 0), 60], min: 20, max: 220 },
  ride: { kind: 'ride', fov: 70, shadow: [V(-92, 60, 0), 60] },
  atrium: { kind: 'int', build: buildAtrium, fov: 58 },
  stateroom: { kind: 'int', build: buildStateroom, fov: 66 },
  dining: { kind: 'int', build: buildDining, fov: 56 },
  theater: { kind: 'int', build: buildTheater, fov: 54 },
};
const ORDER = ['hero', 'profile', 'aerial', 'stern', 'lido', 'coaster', 'ride', 'atrium', 'stateroom', 'dining', 'theater'];
const interiors = {};
let current = null;
let flight = null; // camera tween between exterior views
let timeName = 'day';
let busy = false;

function setExteriorLook() {
  const P = PRESETS[timeName];
  renderer.toneMappingExposure = P.exposure;
  // daylight gets no bloom: the analytic sky is bright enough to veil everything
  bloom.enabled = timeName === 'night' && !Q.has('nobloom');
  bloom.strength = 0.7;
  bloom.threshold = 0.75;
  bloom.radius = 0.55;
  for (const n of ship.night) {
    const k = P.night;
    if (n.color) n.mat.color.copy(n.day).lerp(n.night, k);
    else if (n.uniform) n.mat.uniforms[n.uniform].value = lerp(n.day, n.night, k);
    else n.mat.emissiveIntensity = lerp(n.day, n.night, k);
  }
}

function configureControls(v, inter) {
  controls.enabled = v.kind !== 'ride';
  controls.autoRotate = false;
  if (inter) {
    const iv = inter.view;
    controls.minDistance = iv.minDistance; controls.maxDistance = iv.maxDistance;
    controls.minPolarAngle = iv.minPolar; controls.maxPolarAngle = iv.maxPolar;
  } else {
    controls.minDistance = v.min || 20; controls.maxDistance = (v.max || 1000) * 1.6;
    controls.minPolarAngle = 0.08; controls.maxPolarAngle = 1.53;
  }
}

function fadeTo(on) {
  return new Promise((res) => {
    fade.classList.toggle('on', on);
    setTimeout(res, on ? 420 : 10);
  });
}

async function go(name, { instant = false } = {}) {
  if (busy || name === current) return;
  const v = VIEWS[name];
  const prev = current ? VIEWS[current] : null;
  current = name;
  updateDock();
  const sameWorld = prev && prev.kind === 'ext' && v.kind === 'ext' && !instant;
  if (sameWorld) {
    // fly the camera through a raised arc
    flight = { t: 0, dur: 2.4, p0: camera.position.clone(), t0: controls.target.clone(), p1: framed(v), t1: v.target.clone(), f0: baseFov, f1: v.fov };
    configureControls(v);
    env.focusShadow(v.shadow[0], v.shadow[1]);
    return;
  }
  busy = true;
  if (!instant) await fadeTo(true);
  flight = null;
  camera.up.set(0, 1, 0);
  if (v.kind === 'int') {
    if (!interiors[name]) {
      loader.classList.add('on');
      await new Promise((r) => setTimeout(r, 30));
      interiors[name] = v.build(renderer);
      if (SAFE.on) safeMaterials(interiors[name].scene);
      // compile once so the first frame does not hitch
      renderer.compile(interiors[name].scene, camera);
      loader.classList.remove('on');
    }
    const inter = interiors[name];
    renderPass.scene = inter.scene;
    renderer.toneMappingExposure = inter.exposure;
    bloom.enabled = !Q.has('nobloom'); bloom.strength = inter.bloom; bloom.threshold = inter.bloomThreshold ?? 1.4; bloom.radius = 0.5;
    camera.near = 0.05; camera.far = 20000;
    baseFov = v.fov; applyFov();
    camera.position.copy(inter.view.pos);
    controls.target.copy(inter.view.target);
    configureControls(v, inter);
  } else {
    renderPass.scene = world;
    setExteriorLook();
    camera.near = v.kind === 'ride' ? 0.2 : 0.5; camera.far = 80000;
    baseFov = v.fov; applyFov();
    if (v.kind === 'ext') {
      camera.position.copy(framed(v));
      controls.target.copy(v.target);
    }
    configureControls(v);
    env.focusShadow(v.shadow[0], v.shadow[1]);
  }
  controls.update();
  lastInteract = performance.now();
  if (!instant) await fadeTo(false);
  busy = false;
}

// ---------------------------------------------------------------- UI
const dock = $('#dock');
function updateDock() {
  dock.querySelectorAll('[data-view]').forEach((b) => {
    const on = b.dataset.view === current;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
  $('#timeBtn').disabled = !current || VIEWS[current].kind === 'int';
}
dock.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  stopTour();
  go(b.dataset.view);
});
const TIMES = ['day', 'sunset', 'night'];
$('#timeBtn').addEventListener('click', async () => {
  if (busy || VIEWS[current].kind === 'int') return;
  busy = true;
  await fadeTo(true);
  timeName = TIMES[(TIMES.indexOf(timeName) + 1) % 3];
  env.setPreset(timeName);
  const v = VIEWS[current];
  env.focusShadow(v.shadow[0], v.shadow[1]);
  setExteriorLook();
  document.body.dataset.time = timeName;
  await fadeTo(false);
  busy = false;
});
let tour = null;
function stopTour() {
  if (tour) { clearInterval(tour); tour = null; }
  document.body.classList.remove('touring');
  $('#tourBtn').setAttribute('aria-pressed', 'false');
}
$('#tourBtn').addEventListener('click', () => {
  if (tour) { stopTour(); return; }
  document.body.classList.add('touring');
  $('#tourBtn').setAttribute('aria-pressed', 'true');
  const step = () => { const i = ORDER.indexOf(current); go(ORDER[(i + 1) % ORDER.length]); };
  step();
  tour = setInterval(step, 11000);
});
$('#fsBtn').addEventListener('click', () => {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  } catch (_) { /* optional */ }
});
window.addEventListener('keydown', (e) => {
  const n = parseInt(e.key, 10);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    stopTour();
    const i = ORDER.indexOf(current);
    go(ORDER[(i + (e.key === 'ArrowRight' ? 1 : ORDER.length - 1)) % ORDER.length]);
  } else if (n >= 1 && n <= 9) { stopTour(); go(ORDER[n - 1]); }
});

let lastInteract = performance.now();
controls.addEventListener('start', () => { lastInteract = performance.now(); controls.autoRotate = false; flight = null; });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
let frames = 0, acc = 0;
const tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3(), tmpU = new THREE.Vector3();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function tick() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  const v = VIEWS[current];
  const inInterior = v.kind === 'int';

  if (!inInterior) {
    // gentle sea motion
    ship.group.position.y = Math.sin(t * 0.45) * 0.18;
    ship.group.rotation.x = Math.sin(t * 0.33) * 0.0035;
    ship.group.rotation.z = Math.sin(t * 0.21 + 1) * 0.0018;
    ship.update(t, dt);
    env.update(t, dt);
  } else {
    interiors[current].update(t, dt);
  }

  if (flight) {
    flight.t += dt / flight.dur;
    const k = ease(Math.min(1, flight.t));
    const lift = Math.sin(Math.PI * k) * flight.p0.distanceTo(flight.p1) * 0.18;
    camera.position.lerpVectors(flight.p0, flight.p1, k);
    camera.position.y += lift;
    controls.target.lerpVectors(flight.t0, flight.t1, k);
    baseFov = lerp(flight.f0, flight.f1, k); applyFov();
    if (flight.t >= 1) flight = null;
  }

  if (v.kind === 'ride') {
    const f = ship.coaster.frameAt(ship.coaster.getU());
    ship.group.updateMatrixWorld();
    const mw = ship.group.matrixWorld;
    tmpV.copy(f.p).addScaledVector(f.up, 2.05).addScaledVector(f.t, 1.2).applyMatrix4(mw);
    const ahead = ship.coaster.frameAt(ship.coaster.getU() + 9 / ship.coaster.length);
    tmpL.copy(ahead.p).addScaledVector(ahead.up, 0.9).applyMatrix4(mw);
    tmpU.copy(f.up).transformDirection(mw);
    camera.position.copy(tmpV);
    camera.up.lerp(tmpU, 0.2).normalize();
    camera.lookAt(tmpL);
  } else {
    if (!flight && !tour && performance.now() - lastInteract > 7000) controls.autoRotate = true;
    if (tour) controls.autoRotate = true;
    controls.autoRotateSpeed = inInterior ? 0.18 : 0.3;
    controls.update();
    if (inInterior) {
      const b = interiors[current].view.bounds;
      if (b) camera.position.clamp(b.min, b.max);
    } else if (camera.position.y < 4) camera.position.y = 4;
  }

  if (SAFE.on) renderer.render(renderPass.scene, camera);
  else composer.render(dt);
  if (checks < 3 && ++checkFrame % 4 === 0) healthCheck();

  // adaptive resolution keeps interaction smooth
  frames++; acc += dt;
  if (acc > 1.5 && !Q.has('fixedpr')) {
    const ms = (acc / frames) * 1000;
    let np = pixelRatio;
    if (ms > 26 && pixelRatio > 0.65) np = Math.max(0.65, pixelRatio - 0.15);
    else if (ms < 13 && pixelRatio < maxPR) np = Math.min(maxPR, pixelRatio + 0.1);
    if (np !== pixelRatio) { pixelRatio = np; resize(); }
    frames = 0; acc = 0;
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- boot
// Without environment reflections, metals render black: soften them into lit paint.
function safeMaterials(scene) {
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) if (m.isMeshStandardMaterial && !m.userData.safe) {
      m.userData.safe = true;
      m.metalness = Math.min(m.metalness, 0.25);
      if (m.metalnessMap) { m.metalnessMap = null; m.metalness = 0.1; }
      m.needsUpdate = true;
    }
  });
}

// Sample the finished frame; a uniformly white or black image means the GPU failed the render path.
let checks = 0, checkFrame = 0, safeLevel = SAFE.on ? 1 : 0;
const px = new Uint8Array(4);
function healthCheck() {
  checks++;
  const gl = renderer.getContext();
  renderer.setRenderTarget(null);
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  let white = 0, black = 0, first = null, same = 0;
  for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) {
    gl.readPixels(Math.floor(w * i / 4), Math.floor(h * j / 4), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[0] > 250 && px[1] > 250 && px[2] > 250) white++;
    if (px[0] < 3 && px[1] < 3 && px[2] < 3) black++;
    const key = px.join(',');
    if (first === null) first = key; else if (key === first) same++;
  }
  const broken = white === 9 || black === 9 || same === 8;
  if (!broken || VIEWS[current].kind === 'int') return;
  safeLevel++;
  SAFE.on = true;
  env.enterSafe(safeLevel);
  safeMaterials(world);
  if (pixelRatio < maxPR) { pixelRatio = maxPR; resize(); }
  checks = safeLevel >= 2 ? 3 : 0;
}

// ---------------------------------------------------------------- diagnostics (only visible with #debug)
const DIAG = { t0: performance.now(), marks: [], errors: [] };
const debugOn = location.hash === '#debug';
let diagEl = null;
function mark(m) { DIAG.marks.push(`${((performance.now() - DIAG.t0) / 1000).toFixed(2)}s ${m}`); drawDiag(); }
function report(e) { if (DIAG.errors.length > 20) return; DIAG.errors.push(String(e && (e.stack || e.message) || e).slice(0, 400)); drawDiag(); }
function drawDiag() {
  if (!debugOn) return;
  if (!diagEl) {
    diagEl = document.createElement('pre');
    diagEl.style.cssText = 'position:fixed;left:8px;top:8px;right:8px;max-height:60%;overflow:auto;z-index:20;margin:0;padding:8px;font:11px/1.35 ui-monospace,monospace;color:#cfe;background:rgba(0,0,0,.72);border-radius:8px;white-space:pre-wrap;pointer-events:auto';
    document.body.appendChild(diagEl);
  }
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  diagEl.textContent = [`gpu: ${gpu}`, `safe: ${SAFE.on} level ${safeLevel}  floatRT: ${renderer.extensions.has('EXT_color_buffer_float')}  pr: ${pixelRatio}`,
    `mobile: ${isMobile}  ${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`, ...DIAG.marks, ...DIAG.errors.map((e) => 'ERR ' + e)].join('\n');
}
window.addEventListener('error', (e) => report(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => report(e.reason));
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); report('webgl context lost'); });

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
let started = false;
function finishLoading() {
  if (!started) { started = true; requestAnimationFrame(loop); }
  loader.classList.remove('on');
  document.body.classList.add('ready');
  mark('ready');
}
function loop() {
  try { tick(); } catch (e) { report(e); requestAnimationFrame(loop); }
}

async function bootOnce() {
  document.body.dataset.time = timeName;
  mark('boot start');
  await nextFrame();
  ship = buildShip(renderer);
  world.add(ship.group);
  mark('ship built');
  await nextFrame();
  env = buildEnvironment(renderer, world);
  env.setPreset('day');
  if (SAFE.on) { env.enterSafe(1); safeMaterials(world); }
  world.traverse((o) => {
    if (o.isMesh && o.material && o.material.isMeshStandardMaterial && o.material.envMapIntensity === 1) o.material.envMapIntensity = 0.9;
  });
  mark('environment built');
  resize();
  const start = (location.hash || '').replace('#', '');
  current = null; busy = false;
  await go(VIEWS[start] ? start : 'hero', { instant: true });
  await nextFrame();
  try {
    if (renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) await Promise.race([renderer.compileAsync(world, camera), new Promise((r) => setTimeout(r, 8000))]);
  } catch (e) { report(e); }
  mark('shaders ready');
}

async function boot() {
  window.__jubilee = { go, VIEWS, renderer, camera, controls, get pr() { return pixelRatio; } };
  // never leave the loader up forever
  const watchdog = setTimeout(() => { report('boot watchdog fired'); finishLoading(); }, 30000);
  try {
    await bootOnce();
  } catch (e) {
    report(e);
    if (!SAFE.on) {
      SAFE.on = true; safeLevel = 1;
      world.clear();
      try { await bootOnce(); } catch (e2) { report(e2); }
    }
  }
  clearTimeout(watchdog);
  finishLoading();
}
requestAnimationFrame(() => setTimeout(boot, 40));

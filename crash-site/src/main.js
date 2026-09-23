import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildHelicopter } from './heli.js';
import { hullUniforms } from './hullMaterial.js';
import { envUniforms, FOG_COLOR, makeSky, makeTerrain, makeGrass, makeTrees, makeRain, makeSmoke, terrainH } from './env.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0068);
scene.background = FOG_COLOR.clone();

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 2000);

// --- sky & environment lighting -------------------------------------------
const sky = makeSky(false);
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(makeSky(true));
let envRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
scene.environment = envRT.texture;
scene.environmentIntensity = 1.0;

const hemi = new THREE.HemisphereLight(0x8a96a2, 0x1a2012, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xc9d4de, 1.05);
sun.position.set(40, 60, -18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 10, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 5;
sun.target.position.set(-2, 0, 0);
scene.add(sun, sun.target);
const flashLight = new THREE.DirectionalLight(0xb8c8ff, 0);
flashLight.position.set(30, 80, 120);
scene.add(flashLight);

// --- world -----------------------------------------------------------------
const { heli, tailPivot, smokeWorld } = buildHelicopter();
scene.add(heli);
hullUniforms.uTime = envUniforms.uTime;

// ground occluders (capsules on XZ) from wreck parts: [ax, az, bx, bz, r]
const tailA = new THREE.Vector3(-6.6, 2.7, 0).applyMatrix4(tailPivot.children[0].matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0)));
const tp = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(tailPivot.children[0].matrixWorld);
const tA = tp(-6.6, 2.7, 0), tB = tp(-13.2, 3.0, 0), tFin = tp(-14.0, 5.2, 0);
const occluders = [
  [-6.2, 0, 6.9, 0, 1.3],
  [-1.9, 1.74, 2.4, 1.74, 0.45], [-2.2, -1.74, 2.4, -1.74, 0.45],
  [tA.x, tA.z, tB.x, tB.z, 0.5], [tB.x, tB.z, tFin.x, tFin.z, 0.35],
];
void tailA;
const terrain = makeTerrain([
  new THREE.Vector4(-6.2, 0, 6.9, 0), new THREE.Vector4(tA.x, tA.z, tB.x, tB.z),
  new THREE.Vector4(-1.9, 1.74, 2.4, 1.74), new THREE.Vector4(-2.2, -1.74, 2.4, -1.74),
]);
scene.add(terrain);
const grass = makeGrass(occluders);
scene.add(grass.group);
scene.add(makeTrees());
const rain = makeRain();
scene.add(rain);
const smoke = makeSmoke(smokeWorld);
scene.add(smoke.group);

// --- post-processing ----------------------------------------------------------
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.6, 0.9);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFlash: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform float uAspect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - .5;
      float r2 = dot(c * vec2(uAspect, 1.), c * vec2(uAspect, 1.));
      vec2 off = c * .0025 * r2 * 4.;
      vec3 col = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(vec3(l), col, .82);                         // storm desaturation
      col *= mix(vec3(.93, 1.0, 1.04), vec3(1.03, 1.0, .95), smoothstep(.0, .4, l)); // cool shadows, neutral highs
      col = max(col - .004, 0.) * 1.04;                      // deeper blacks
      col *= 1. - .55 * smoothstep(.12, .75, r2);            // vignette
      col += uFlash * .06;
      col *= 1. + (h(vUv * 1000. + fract(uTime) * 91.) - .5) * .05; // grain
      gl_FragColor = vec4(col, 1.);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

// --- camera views ------------------------------------------------------------
const views = [
  { pos: [8.8, 1.3, -15.2], tgt: [0.6, 3.7, 0.5], fov: 50 },       // hero (reference framing)
  { pos: [11.2, 2.3, -5.2], tgt: [5.0, 2.1, 0.2], fov: 40 },        // nose / cockpit
  { pos: [-16, 20, -19], tgt: [-2.5, 0.8, 0.5], fov: 45 },          // aerial
  { pos: [-19.5, 1.7, -8.5], tgt: [-11, 0.9, 1.5], fov: 44 },       // detached tail
  { pos: [4.2, 1.6, -8.8], tgt: [-1.2, 6.8, 0.8], fov: 62 },        // rotor & smoke from below
  { pos: [-9, 3.2, -9.5], tgt: [-3.5, 2.6, 0], fov: 46 },           // torn fuselage
];
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.5;
controls.maxDistance = 140;
controls.maxPolarAngle = Math.PI * 0.495;
controls.rotateSpeed = 0.6;

const V = (a) => new THREE.Vector3(...a);
camera.position.copy(V(views[0].pos));
controls.target.copy(V(views[0].tgt));
camera.fov = views[0].fov;
camera.updateProjectionMatrix();

let tween = null;
let auto = false;
let current = 0;
function goTo(i) {
  current = i;
  const v = views[i];
  tween = {
    t: 0, dur: 2.4,
    p0: camera.position.clone(), p1: V(v.pos),
    t0: controls.target.clone(), t1: V(v.tgt),
    f0: camera.fov, f1: v.fov,
  };
  setActive(i);
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// icon buttons (no text)
const ICONS = [
  '<path d="M3 17l5-6 4 4 3-3 6 5"/><circle cx="16" cy="7" r="2"/>',
  '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  '<circle cx="12" cy="12" r="1.8"/><path d="M12 10.2V3.5M13.6 12.9l5.8 3.3M10.4 12.9l-5.8 3.3"/>',
  '<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1.5A3.5 3.5 0 0117 18z"/><path d="M9 21l1-2M13 21l1-2"/>',
  '<path d="M4 20l6-8M20 4l-6 8"/><path d="M10 12l1.5-3.5M14 12l-1.5 3.5"/>',
  '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v4h-4"/>',
];
const bar = document.getElementById('bar');
const buttons = ICONS.map((svg, i) => {
  const b = document.createElement('button');
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
  b.setAttribute('aria-label', 'view ' + (i + 1));
  b.addEventListener('click', () => {
    if (i === 6) { auto = !auto; b.classList.toggle('on', auto); controls.autoRotate = auto; return; }
    goTo(i);
  });
  bar.appendChild(b);
  return b;
});
function setActive(i) { buttons.forEach((b, k) => k < 6 && b.classList.toggle('on', k === i)); }
setActive(0);
controls.autoRotateSpeed = 0.35;
window.addEventListener('keydown', (e) => {
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 6) goTo(n - 1);
  if (n === 7 || e.key === 'o') buttons[6].click();
});
controls.addEventListener('start', () => { tween = null; });

// --- resize --------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  grade.uniforms.uAspect.value = w / h;
}
window.addEventListener('resize', resize);
resize();

// --- lightning -------------------------------------------------------------------
let nextStrike = 6 + Math.random() * 6;
let strike = null;
function lightning(t) {
  if (!strike && t > nextStrike) {
    const pulses = [];
    let s = 0;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) { pulses.push([s, 0.05 + Math.random() * 0.1, 0.4 + Math.random() * 0.6]); s += 0.08 + Math.random() * 0.18; }
    strike = { t0: t, pulses, end: s + 0.4 };
    const a = Math.random() * Math.PI * 2;
    envUniforms.uFlashDir.value.set(Math.sin(a), 0.25 + Math.random() * 0.3, Math.cos(a)).normalize();
    flashLight.position.copy(envUniforms.uFlashDir.value).multiplyScalar(150);
  }
  let f = 0;
  if (strike) {
    const lt = t - strike.t0;
    for (const [s, d, a] of strike.pulses) if (lt > s) f = Math.max(f, a * Math.exp(-(lt - s) / d));
    if (lt > strike.end) { strike = null; nextStrike = t + 9 + Math.random() * 14; }
  }
  envUniforms.uFlash.value = f;
  grade.uniforms.uFlash.value = f;
  flashLight.intensity = f * 4.5;
  hemi.intensity = 0.55 + f * 0.8;
}

// --- adaptive quality ------------------------------------------------------------
let q = 1, frames = 0, acc = 0, settled = false;
const params = new URLSearchParams(location.search);
if (params.has('q')) { q = parseFloat(params.get('q')); settled = true; grass.setQuality(q); }
function adapt(dt) {
  if (settled) return;
  frames++; acc += dt;
  if (frames >= 45) {
    const ms = acc / frames * 1000;
    frames = 0; acc = 0;
    if (ms > 26) {
      if (pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); }
      q = Math.max(0.35, q - 0.15); grass.setQuality(q);
      if (q <= 0.35 && pixelRatio <= 0.75) settled = true;
    } else if (ms < 14 && q < 1) {
      q = Math.min(1, q + 0.1); grass.setQuality(q);
    } else settled = ms < 20;
  }
}

// --- loop ----------------------------------------------------------------------------
let last = performance.now();
let elapsed = 0;
const sway = new THREE.Vector3();
const fade = document.getElementById('fade');
let shown = false;
const fixedT = params.has('t') ? parseFloat(params.get('t')) : null;

function frame() {
  const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.1); last = now;
  elapsed += dt;
  const t = fixedT ?? elapsed;
  envUniforms.uTime.value = t;
  grade.uniforms.uTime.value = t;
  lightning(t);

  if (tween) {
    tween.t += dt / tween.dur;
    const k = ease(Math.min(tween.t, 1));
    const p = tween.p0.clone().lerp(tween.p1, k);
    p.y += Math.sin(k * Math.PI) * tween.p0.distanceTo(tween.p1) * 0.12;
    camera.position.copy(p);
    controls.target.copy(tween.t0.clone().lerp(tween.t1, k));
    camera.fov = THREE.MathUtils.lerp(tween.f0, tween.f1, k);
    camera.updateProjectionMatrix();
    if (tween.t >= 1) tween = null;
  }
  controls.update();
  // keep the camera above the ground
  const gy = terrainH(camera.position.x, camera.position.z) + 0.45;
  if (camera.position.y < gy) camera.position.y = gy;

  // subtle hand-held drift
  sway.set(Math.sin(t * 0.41) * 0.025 + Math.sin(t * 1.3) * 0.006, Math.sin(t * 0.53 + 1) * 0.02, Math.cos(t * 0.37) * 0.02);
  camera.position.add(sway);
  sky.position.copy(camera.position);
  grass.update(camera);
  smoke.update(t, camera);
  composer.render(dt);
  camera.position.sub(sway);

  adapt(dt);
  if (!shown) { shown = true; requestAnimationFrame(() => fade.classList.add('gone')); }
  if (!still) requestAnimationFrame(frame);
}
const still = params.has('still');
if (still) { settled = true; fade.remove(); window.__render = () => { const t0 = performance.now(); frame(); renderer.getContext().finish(); return performance.now() - t0; }; }
else requestAnimationFrame(frame);
window.__views = { goTo, snap(i) { const v = views[i]; tween = null; camera.position.copy(V(v.pos)); controls.target.copy(V(v.tgt)); camera.fov = v.fov; camera.updateProjectionMatrix(); controls.update(); } };

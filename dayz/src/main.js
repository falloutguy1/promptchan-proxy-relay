import * as THREE from 'three';
import WebGL from 'three/addons/capabilities/WebGL.js';
import { settings, saveSettings, Q, PRESETS, URLP } from './config.js';
import { Assets } from './assets.js';
import { WORLD, Heightfield, L } from './layout.js';
import { Terrain } from './terrain.js';
import { Sky } from './sky.js';
import { Collision } from './physics.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { Post } from './post.js';
import { shared } from './shaderlib.js';

const $ = (id) => document.getElementById(id);
const ui = {
  progress(frac, text) { $('load-bar').style.width = `${Math.round(frac * 100)}%`; if (text) $('load-text').textContent = text; },
  error(msg) { const e = $('load-error'); e.hidden = false; e.textContent += msg + '\n'; },
};
window.addEventListener('error', (e) => ui.error(`Error: ${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => ui.error(`Error: ${e.reason?.message || e.reason}`));

const game = { ready: false, stats: {} };
window.__dayz = game;

async function boot() {
  if (!WebGL.isWebGL2Available()) {
    game.fatal = true;
    ui.error('WebGL2 is not available in this browser/GPU. Try an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
    return;
  }
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: URLP.has('capture') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  const q = Q();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * q.renderScale);
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 2500);

  // --- loading ---
  const tLoad = performance.now();
  let fileFrac = 0, genDone = false;
  const assets = new Assets(renderer, (l, t, url) => { fileFrac = l / t; ui.progress(fileFrac * 0.8 + (genDone ? 0.1 : 0), `Loading ${url.split('/').pop()} (${l}/${t})`); });
  assets.anisotropy = q.anisotropy;
  game.assets = assets;
  const worker = new Worker(new URL('./worldgen.worker.js', import.meta.url), { type: 'module' });
  const genP = new Promise((res, rej) => { worker.onmessage = (e) => res(e.data); worker.onerror = (e) => rej(new Error('world generation worker failed: ' + (e.message || 'unknown'))); });
  worker.postMessage({});
  await assets.init();
  const man = assets.manifest;
  const [tDiff, tNor, tArh, hdr, backdrop, gen] = await Promise.all([
    assets.ktx(man.terrain.maps.diff, THREE.SRGBColorSpace), assets.ktx(man.terrain.maps.nor), assets.ktx(man.terrain.maps.arh),
    assets.hdri(), assets.image(man.hdri.backdrop), genP,
  ]);
  genDone = true;
  worker.terminate();
  game.stats.genMs = gen.ms;
  const hf = new Heightfield(gen.heights);
  game.hf = hf;

  ui.progress(0.85, 'Building terrain…');
  const sky = new Sky(renderer, scene, hdr, backdrop, man.hdri);
  const terrain = new Terrain(hf, gen, { diff: tDiff, nor: tNor, arh: tArh }, man, q);
  scene.add(terrain.group);
  const collision = new Collision(hf);
  const audio = new Audio();
  const player = new Player(camera, canvas, collision, audio);
  player.sensitivity = settings.sensitivity;
  player.surfaceAt = (x, z) => surfaceName(gen, x, z, collision, player);

  // content modules (house, vegetation, props, loot) register here
  const ctx = { THREE, scene, camera, renderer, assets, hf, collision, player, q, sky, terrain, gen, updaters: [], foliage: [], ui };
  game.ctx = ctx;
  for (const mod of await loadContent()) {
    try {
      ui.progress(0.9, `Building ${mod.name}…`);
      await mod.build(ctx);
    } catch (e) {
      console.error(e);
      ui.error(`Failed to build ${mod.name}: ${e.message}`);
    }
  }
  if (assets.failures.length) ui.error('Some assets failed to load:\n' + assets.failures.join('\n'));

  // --- post ---
  let post;
  const hideForAO = (hide, prev) => {
    if (hide) { const vis = ctx.foliage.map((o) => o.visible); ctx.foliage.forEach((o) => (o.visible = false)); sky.dome.visible = false; return vis; }
    ctx.foliage.forEach((o, i) => (o.visible = prev[i])); sky.dome.visible = true;
  };
  const applyQuality = () => {
    const q = Q();
    ctx.q = q;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * q.renderScale);
    renderer.setSize(innerWidth, innerHeight, false);
    sky.setShadowQuality(q.shadowMapSize, q.shadowRadius);
    post?.dispose();
    post = new Post(renderer, scene, camera, q, hideForAO);
    post.composer.setPixelRatio(renderer.getPixelRatio());
    post.setSize(innerWidth, innerHeight);
    for (const u of ctx.updaters) u.quality?.(q);
    terrain.uniforms.uDetail.value = q.terrainDetail;
  };
  applyQuality();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    post.composer.setPixelRatio(renderer.getPixelRatio());
    post.setSize(innerWidth, innerHeight);
  });

  const spawn = ctx.spawn || { x: -6, z: 30, yaw: 0.35 };
  player.place(spawn.x, spawn.z, spawn.yaw);
  game.stats.loadMs = performance.now() - tLoad;
  buildSettingsUI(applyQuality, camera, player);

  // --- loop ---
  const clock = new THREE.Clock();
  const perf = { frames: 0, acc: 0, fps: 0, ms: 0, samples: [] };
  game.perf = perf;
  let paused = true;
  const step = (dtFixed) => {
    const dt = dtFixed ?? Math.min(clock.getDelta(), 0.1);
    shared.uTime.value += dt;
    if (!paused) player.update(dt);
    terrain.update(camera.position);
    sky.update(camera, player.pos);
    for (const u of ctx.updaters) u.update?.(dt, camera, player);
    renderer.info.reset();
    const t0 = performance.now();
    post.render(dt);
    const cpu = performance.now() - t0;
    perf.frames++; perf.acc += dt;
    perf.samples.push(dt * 1000);
    if (perf.samples.length > 600) perf.samples.shift();
    if (perf.acc >= 0.5) {
      perf.fps = perf.frames / perf.acc; perf.ms = (perf.acc / perf.frames) * 1000; perf.frames = 0; perf.acc = 0;
      if (settings.showPerf) {
        const i = renderer.info;
        $('perf').textContent = `${perf.fps.toFixed(0)} fps  ${perf.ms.toFixed(1)} ms (submit ${cpu.toFixed(1)} ms)\n` +
          `draws ${i.render.calls}  tris ${(i.render.triangles / 1e6).toFixed(2)}M  tex ${i.memory.textures}  geo ${i.memory.geometries}\n` +
          `${settings.quality} @ ${(renderer.getPixelRatio()).toFixed(2)}x  ${renderer.domElement.width}x${renderer.domElement.height}`;
      } else $('perf').textContent = '';
    }
    game.frameCount = (game.frameCount || 0) + 1;
  };
  const frame = () => { step(); requestAnimationFrame(frame); };
  // capture tooling drives frames explicitly (software GL is too slow for a live loop)
  game.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) step(dt); };
  game.grab = () => renderer.domElement.toDataURL('image/png');

  // --- start / pause ---
  const startOverlay = $('start');
  $('loading').hidden = true;
  startOverlay.hidden = false;
  $('play').onclick = () => { audio.start(); canvas.requestPointerLock?.(); resume(); };
  const resume = () => { paused = false; player.enabled = true; startOverlay.hidden = true; $('hud').hidden = false; };
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && !URLP.has('capture')) { paused = true; player.enabled = false; startOverlay.hidden = false; $('play').textContent = 'Resume'; }
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'F2') { e.preventDefault(); game.screenshot(); }
    if (e.code === 'F3') { settings.showPerf = !settings.showPerf; saveSettings(); }
  });
  game.screenshot = () => {
    post.render(0);
    const a = document.createElement('a');
    a.download = `dayz-${Date.now()}.png`; a.href = canvas.toDataURL('image/png'); a.click();
  };
  // Automation hooks for capture/benchmark tooling (tools/capture.mjs)
  game.setView = (x, y, z, yaw, pitch) => {
    player.pos.set(x, y ?? collision.groundHeight(x, z, 1e9), z); player.yaw = yaw; player.pitch = pitch ?? 0;
    player.updateCamera(0);
  };
  game.setCamera = (px, py, pz, tx, ty, tz) => {
    camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    player.yaw = e.y; player.pitch = e.x; player.pos.set(px, py - player.eye, pz);
  };
  game.freeze = (v) => { paused = v; };
  game.renderer = renderer; game.scene = scene; game.camera = camera; game.player = player;
  game.applyQuality = applyQuality;
  if (URLP.has('capture')) { startOverlay.hidden = true; $('hud').hidden = !URLP.has('hud'); }
  if (URLP.has('autoplay')) resume();
  game.ready = true;
  if (!URLP.has('capture')) requestAnimationFrame(frame);
}

function surfaceName(gen, x, z, collision, player) {
  if (collision.groundHeight(x, z, player.pos.y) > game.hf.height(x, z) + 0.05) return 'wood';
  const s = WORLD.splatSize, r = WORLD.splatRes;
  const i = Math.floor(((x + s / 2) / s) * r), j = Math.floor(((z + s / 2) / s) * r);
  if (i < 0 || j < 0 || i >= r || j >= r) return 'grass';
  const k = (j * r + i) * 4, A = gen.fine.A, B = gen.fine.B;
  const w = [A[k], A[k + 1], A[k + 2], A[k + 3], B[k], B[k + 1]];
  const m = w.indexOf(Math.max(...w));
  return ['grass', 'grass', 'forest', 'gravel', 'mud', 'concrete'][m];
}

async function loadContent() {
  const list = [];
  const tryImport = async (name, path) => {
    try { const m = await import(path); list.push({ name, build: m.build }); }
    catch (e) { console.error(e); document.getElementById('load-error').hidden = false; document.getElementById('load-error').textContent += `Module ${name} failed: ${e.message}\n`; }
  };
  await tryImport('farmhouse', './house.js');
  await tryImport('vegetation', './vegetation.js');
  await tryImport('grass', './grass.js');
  await tryImport('props', './props.js');
  await tryImport('water', './water.js');
  await tryImport('gameplay', './gameplay.js');
  return list;
}

function buildSettingsUI(applyQuality, camera, player) {
  const el = document.getElementById('settings');
  el.innerHTML = `
    <label for="s-q">Graphics quality</label>
    <select id="s-q">${Object.keys(PRESETS).map((k) => `<option ${k === settings.quality ? 'selected' : ''}>${k}</option>`).join('')}</select>
    <label for="s-rs">Render resolution</label>
    <select id="s-rs">${[['auto', ''], ['50%', 0.5], ['67%', 0.67], ['75%', 0.75], ['85%', 0.85], ['100%', 1], ['125%', 1.25]]
      .map(([l, v]) => `<option value="${v}" ${String(settings.renderScale ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label for="s-fov">Field of view (vertical)</label>
    <input id="s-fov" type="range" min="45" max="70" step="1" value="${settings.fov}">
    <label for="s-sens">Mouse sensitivity</label>
    <input id="s-sens" type="range" min="0.3" max="2.5" step="0.05" value="${settings.sensitivity}">
    <label for="s-perf">Show performance (F3)</label>
    <input id="s-perf" type="checkbox" ${settings.showPerf ? 'checked' : ''}>
    <div class="note">Quality changes shadows, ambient occlusion, grass density, draw distances and anti-aliasing.</div>`;
  const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);
  on('s-q', 'change', (e) => { settings.quality = e.target.value; saveSettings(); applyQuality(); });
  on('s-rs', 'change', (e) => { settings.renderScale = e.target.value === '' ? null : parseFloat(e.target.value); saveSettings(); applyQuality(); });
  on('s-fov', 'input', (e) => { settings.fov = +e.target.value; camera.fov = settings.fov; camera.updateProjectionMatrix(); saveSettings(); });
  on('s-sens', 'input', (e) => { settings.sensitivity = +e.target.value; player.sensitivity = settings.sensitivity; saveSettings(); });
  on('s-perf', 'change', (e) => { settings.showPerf = e.target.checked; saveSettings(); });
}

boot().catch((e) => { console.error(e); game.fatal = true; ui.error(e.stack || e.message); });

// Metro Shelter — bootstrap, loading flow and main loop.
import * as THREE from 'three';
import { Renderer, PRESETS } from './renderer.js';
import { initLoaders, loadModels, manager, errors, loadHDR, pending, loaders } from './assets.js';
import { loadDwellerAssets } from './dwellers.js';
import { buildMaterials } from './materials.js';
import { buildStation } from './station.js';
import { dressStation, MODEL_IDS, LOD_IDS, animateProps } from './props.js';
import { configureShadows, updateLights } from './lights.js';
import { settings, saveSettings } from './settings.js';
import { installDebug } from './debug.js';
import { startGame } from './game.js';

const $ = (id) => document.getElementById(id);
const loadText = (t) => { $('load-text').textContent = t; };
const fail = (msg) => {
  window.__failed = msg;
  $('load-text').textContent = 'Could not start the game.';
  const li = document.createElement('li'); li.textContent = msg; $('load-errors').appendChild(li);
};

export const game = { t: 0, dt: 0, power01: 1 };

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('quality')) settings.quality = params.get('quality');
  let renderer;
  try {
    renderer = new Renderer($('view'));
  } catch (e) {
    fail(e.message);
    return;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020202);
  // Dusty blue-grey haze, the atmospheric colour of the reference paintings.
  scene.fog = new THREE.FogExp2(0x151b1e, 0.03);
  const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 140);
  camera.position.set(0, 1.65, 10);
  scene.add(camera);
  Object.assign(game, { renderer, scene, camera });

  initLoaders(renderer.r, settings.quality);
  manager.onProgress = (url, done, total) => {
    $('load-fill').style.width = `${Math.round((done / total) * 100)}%`;
    loadText(`Loading ${url.split('/').slice(-2).join('/')} (${done}/${total})`);
  };
  const texturesDone = new Promise((res) => { manager.onLoad = res; });

  loadText('Building station…');
  buildMaterials();
  buildStation(scene);

  loadText('Loading props…');
  await loadModels(MODEL_IDS, LOD_IDS);
  dressStation(scene);
  loadText('Loading dwellers…');
  try {
    game.hasDwellers = await loadDwellerAssets(loaders().gltf, loaders().ktx2);
  } catch (e) { errors.push('characters: ' + (e.message || e)); console.error(e); }

  // Dim image-based fill from a real HDR capture of a concrete tunnel (reflections + bounce),
  // replaced by a capture of the lit station once everything is loaded.
  const pmrem = new THREE.PMREMGenerator(renderer.r);
  try {
    const hdr = await loadHDR('assets/hdri/concrete_tunnel_1k.hdr');
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  } catch (e) { errors.push('hdri: ' + e.message); }
  scene.environmentIntensity = 0.08;

  await Promise.race([texturesDone, new Promise((r) => setTimeout(r, 120000))]);
  loadText('Decoding textures…');
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 60000))]);
  renderer.painterly = settings.painterly;
  renderer.setup(scene, camera, settings.quality);
  renderer.setScale(settings.scale ?? PRESETS[settings.quality].scale);
  configureShadows(renderer.preset);
  addEventListener('resize', () => renderer.resize());

  // Bake a reflection/irradiance capture of the lit station (static "baked" indirect light).
  updateLights(0, 1);
  bakeEnvironment(pmrem);

  if (errors.length) {
    for (const e of errors.slice(0, 8)) { const li = document.createElement('li'); li.textContent = `Missing: ${e}`; $('load-errors').appendChild(li); }
  }
  game.textureRes = PRESETS[settings.quality].textures;
  startGame(game);
  camera.position.set(1.2, 1.65, 6); camera.rotation.set(-0.02, 0.06, 0, 'YXZ');
  game.frame = frame;
  installDebug(game);
  $('loading').classList.add('hidden');
  $('start').classList.remove('hidden');
  window.__ready = true;

  let last = performance.now();
  const loop = (now) => {
    game.dt = Math.min((now - last) / 1000, 0.05); last = now;
    game.t += game.dt;
    if (!game.manualRender) frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function frame() {
  const { renderer } = game;
  updateLights(game.t, game.power01);
  animateProps(game.t, game.dt);
  game.onFrame?.(game.dt);
  renderer.render(game.t);
}

export function bakeEnvironment(pmrem) {
  const { scene, renderer } = game;
  const old = scene.environment;
  scene.environment = null;
  const fog = scene.fog; scene.fog = null;
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 60, { position: new THREE.Vector3(0, 2.2, 0) });
  scene.fog = fog;
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.3;
  old?.dispose?.();
}

boot().catch((e) => { console.error(e); fail(e.stack || e.message || String(e)); });

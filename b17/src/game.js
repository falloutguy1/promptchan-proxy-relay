import * as THREE from 'three';
import { createRenderer, Post } from './core/render.js';
import { Assets } from './core/assets.js';
import { Environment } from './core/env.js';
import { q, settings } from './core/settings.js';
import { Heightfield, nextFrame } from './world/layout.js';
import { Terrain, buildMask, createTerrainMaterial, makeNoiseTexture } from './world/terrain.js';
import { River } from './world/water.js';
import { Roads } from './world/roads.js';
import { Buildings, buildingMaterials } from './world/buildings.js';
import { Settlement } from './world/settlement.js';
import { buildB17 } from './aircraft/b17.js';

const $ = (id) => document.getElementById(id);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.started = false;
    this.params = new URLSearchParams(location.search);
  }

  setLoad(frac, label) {
    $('load-fill').style.width = (frac * 100).toFixed(1) + '%';
    if (label) $('load-label').textContent = label;
  }

  async boot() {
    const t0 = performance.now();
    this.renderer = createRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1.5, 70000);
    this.scene.add(this.camera);

    // 1. assets (0-45%)
    this.assets = new Assets(this.renderer);
    this.assets.onProgress = (f, l) => this.setLoad(f * 0.45, `Loading assets… ${l}`);
    await this.assets.loadAll();
    this.env = new Environment(this.renderer, this.scene, this.camera, this.assets);

    // 2. terrain (45-75%)
    this.hf = new Heightfield();
    await this.hf.generate(f => this.setLoad(0.45 + f * 0.15, 'Generating terrain…'));
    this.mask = await buildMask(this.hf, f => this.setLoad(0.6 + f * 0.1, 'Surveying land use…'));
    this.noiseTex = makeNoiseTexture();
    this.terrainMat = createTerrainMaterial(this.env, this.assets, this.mask, this.noiseTex);
    this.terrain = new Terrain(this.scene, this.hf, this.terrainMat);
    this.river = new River(this.scene, this.env);
    this.roads = new Roads(this.scene, this.env, this.assets, this.hf);

    // 3. settlements & targets (75-90%)
    this.setLoad(0.75, 'Building the town…'); await nextFrame();
    this.bmats = buildingMaterials(this.env, this.assets, this.noiseTex);
    this.buildings = new Buildings(this.scene, this.env, this.bmats);
    this.settlement = new Settlement(this.buildings, this.roads, this.hf);
    this.settlement.defineTypes();
    this.setLoad(0.8, 'Building the town…'); await nextFrame();
    this.settlement.buildTargets();
    this.settlement.buildTown();
    this.setLoad(0.85, 'Building villages…'); await nextFrame();
    this.settlement.buildVillages();
    this.roads.finalize();
    this.buildings.finalize();
    console.log('buildings', this.buildings.records.length);

    this.post = new Post(this.renderer, this.scene, this.camera);
    addEventListener('resize', () => this.post.resize());

    this._debugCam();
    if (this.params.has('b17')) {
      this.b17 = buildB17(this.env);
      const [d, yaw, pitch] = (this.params.get('b17') || '40,30,10').split(',').map(Number);
      const c = this.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
      this.b17.root.position.copy(c.position).addScaledVector(fwd, d);
      this.b17.root.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
      this.scene.add(this.b17.root);
    }
    await this.terrain.warm(this.camera.position);
    this.setLoad(1, `Ready (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    this.started = true;
    $('loading').classList.add('hidden');
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  _debugCam() {
    const c = (this.params.get('cam') || '-2500,1400,1500,-40,-25').split(',').map(Number);
    const [x, y, z, yaw, pitch] = c;
    this.camera.position.set(x, y + (this.params.has('agl') ? this.hf.height(x, z) : 0), z);
    this.camera.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
    if (this.params.get('fov')) { this.camera.fov = +this.params.get('fov'); this.camera.updateProjectionMatrix(); }
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.camera.updateMatrixWorld();
    this.terrain.update(this.camera.position);
    this.buildings.update(this.camera.position);
    this.env.update(this.camera);
    this.river.update(this.clock.elapsedTime);
    this.post.render(dt);
    this.frames = (this.frames || 0) + 1;
  }
}

import * as THREE from 'three';
import { Assets } from '../engine/Assets.js';
import { LAYER_NO_AO } from '../engine/Renderer.js';
import { Sky } from '../world/Sky.js';
import { Terrain } from '../world/Terrain.js';
import { Water } from '../world/Water.js';
import { Waves } from '../world/Waves.js';
import { Vegetation, windUniforms } from '../world/Vegetation.js';
import { MaterialLibrary } from '../world/materials.js';
import { Harbor } from '../world/Harbor.js';
import { ShipMaterials } from '../ship/ShipMaterials.js';
import { Ship } from '../ship/Ship.js';
import { DEFAULT_DESIGN, clampDesign } from '../ship/ShipDesign.js';
import { CameraRig } from './CameraRig.js';
import { Gunnery } from './Gunnery.js';
import { Audio } from './Audio.js';
import { QUAY } from '../world/layout.js';

const TEXTURE_SETS = ['concrete_floor_worn_001', 'concrete_wall_008', 'asphalt_02', 'blue_metal_plate', 'wood_floor_deck', 'metal_plate',
  'corrugated_iron_02', 'factory_brick', 'rusty_corrugated_iron', 'rust_coarse_01', 'painted_concrete'];

export class Game {
  constructor(renderer, quality) {
    this.R = renderer;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 24000);
    this.camera.layers.enable(LAYER_NO_AO);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.mode = 'design';
    this.listeners = {};
    this.stats = { fps: 0, frameMs: 0, frames: 0, acc: 0 };
    this.THREE = THREE; // exposed for automated captures (tools/capture.mjs)
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  async init(progress) {
    const R = this.R;
    R.setup(this.scene, this.camera, this.quality.key);
    const assets = (this.assets = new Assets(R.renderer));
    let assetFrac = 0, terrainFrac = 0;
    const report = (label) => progress(0.05 + terrainFrac * 0.3 + assetFrac * 0.5, label);
    assets.onProgress = (done, total, label) => { assetFrac = total ? done / total : 0; report(`Loading ${label}`); };

    this.sky = new Sky(R.renderer, this.scene);
    this.terrain = new Terrain(assets);
    this.waves = new Waves();
    const terrainP = this.terrain.generate(1337, (p) => { terrainFrac = p; report('Shaping terrain'); });
    const hdrP = assets.hdri('kloofendal_48d_partly_cloudy_puresky');
    this.lib = new MaterialLibrary(assets);
    const libP = this.lib.load(TEXTURE_SETS);
    const [, hdr] = await Promise.all([terrainP, hdrP, libP]);
    if (hdr) this.sky.setHDRI(hdr);
    else { this.scene.background = new THREE.Color(0x9fb4c6); this.scene.add(new THREE.HemisphereLight(0xbcd0e0, 0x4a4030, 1.2)); }
    this.scene.fog = new THREE.FogExp2(this.sky.horizon.clone(), 0.00016);
    windUniforms.uSunDirV.value.copy(this.sky.sunDir);
    windUniforms.uSunCol.value.copy(this.sky.sun.color).multiplyScalar(this.sky.sun.intensity / 3);

    const tmat = await this.terrain.loadMaterial(this.quality);
    this.terrain.buildChunks();
    this.terrain.buildFarRing();
    this.scene.add(this.terrain.group);
    this.water = new Water(this.waves, this.terrain, this.sky);
    this.scene.add(this.water.build(this.quality));

    progress(0.82, 'Growing vegetation');
    this.veg = new Vegetation(assets, this.terrain, this.scene);
    const harborP = (async () => {
      this.harbor = new Harbor(assets, this.lib, this.terrain, this.waves);
      await this.harbor.build(this.quality);
      this.scene.add(this.harbor.group);
    })();
    await this.veg.load(this.quality);
    this.veg.buildVariants();
    this.treeCount = this.veg.place();
    this.veg.buildGrass();
    this.scene.add(this.veg.group);
    await harborP;

    progress(0.92, 'Laying the keel');
    this.shipMats = new ShipMaterials(this.lib);
    this.ship = new Ship(this.shipMats, this.waves, this.terrain);
    this.design = clampDesign(this.loadDesign() || DEFAULT_DESIGN);
    this.ship.build(this.design);
    this.ship.placeAtBerth();
    this.ship.onWake = (p, w) => this.water.addWake(p.x, p.z, w);
    this.scene.add(this.ship.root);
    this.harbor.attachShip(this.ship);
    this.audio = new Audio();
    this.gunnery = new Gunnery(this);
    this.scene.add(this.gunnery.group);

    this.rig = new CameraRig(this.camera, R.renderer.domElement, {
      groundAt: (x, z) => this.harbor.groundAt(x, z),
      waterAt: (x, z) => this.waves.heightAt(x, z, this.time),
      insideOpen: (x, z) => this.harbor.insideOpen(x, z),
    });
    this.rig.onTap = (e) => this.mode === 'trials' && this.gunnery.fireAtScreen(e);
    this.frameShip();
    this.rig.update(0.016, this.ship);
    this.terrain.warm(this.camera.position);
    this.veg.update(this.camera.position, true);
    this.sky.setShadowQuality(this.quality.shadow);
    progress(0.97, 'Compiling shaders');
    await this.R.renderer.compileAsync(this.scene, this.camera);
    progress(1, 'Ready');
    return assets.failed;
  }

  loadDesign() {
    try { return JSON.parse(localStorage.getItem('bsy.design')); } catch { return null; }
  }

  saveDesign() {
    try { localStorage.setItem('bsy.design', JSON.stringify(this.design)); } catch { /* storage unavailable */ }
  }

  setDesign(d) {
    this.design = clampDesign(d);
    this.ship.build(this.design);
    if (this.mode === 'design') this.ship.placeAtBerth();
    this.harbor.attachShip(this.ship);
    this.saveDesign();
    this.emit('design', this.design, this.ship.analysis);
  }

  frameShip(part) {
    const s = this.ship, c = s.position.clone().setY(8);
    if (!part) this.rig.frame(c.add(new THREE.Vector3(0, 6, 0)), s.length * 0.48, 0.55, 0.28);
    else {
      const x = { bow: 0.35, mid: 0, stern: -0.35 }[part] * s.length;
      this.rig.frame(c.add(new THREE.Vector3(x, 10, 0)), s.length * 0.2, part === 'stern' ? -0.6 : 0.9, 0.25);
    }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'design') {
      this.ship.placeAtBerth();
      this.rig.setMode('orbit');
      this.frameShip();
      this.gunnery.reset();
    } else if (mode === 'trials') {
      if (prev !== 'trials') this.gunnery.start();
      this.rig.setMode('chase');
      this.rig.goal.dist = this.ship.length * 1.25;
      this.rig.goal.pitch = 0.22;
      this.rig.goal.yaw = this.ship.heading + Math.PI + 0.5;
    } else if (mode === 'walk') {
      this.rig.setMode('walk');
    }
    this.harbor.setMooringVisible(mode !== 'trials');
    this.emit('mode', mode);
  }

  focusPoint() {
    if (this.mode === 'walk') return this.camera.position.clone();
    if (this.mode === 'trials' || this.mode === 'sight') return this.ship.position.clone();
    return this.rig.target.clone();
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.time += dt;
    const t = this.time;
    const s = this.stats;
    s.acc += dt; s.frames++;
    if (s.acc > 0.5) { s.fps = s.frames / s.acc; s.frameMs = (s.acc / s.frames) * 1000; s.acc = 0; s.frames = 0; this.emit('perf', s); }

    windUniforms.uWindT.value = t;
    this.ship.update(dt, t, this.mode === 'trials' ? 'trials' : 'berth');
    this.gunnery.update(dt, t);
    this.audio.update(this.ship.throttle, Math.abs(this.ship.speed) / this.ship.analysis.speedMs, this.mode);
    this.harbor.update(dt, t, this.camera);
    this.rig.update(dt, this.ship);
    this.water.ship.pos.set(this.ship.position.x, this.ship.position.z, this.ship.heading, Math.abs(this.ship.speed));
    this.water.ship.dim.set(this.ship.length * 0.97, this.ship.beam * 0.98, 0, 0);
    this.water.update(dt, this.camera);
    const cp = this.camera.position;
    this.terrain.update(cp, 2);
    this.veg.update(cp);
    const focus = this.focusPoint();
    const dist = cp.distanceTo(focus);
    const radius = Math.min(700, Math.max(90, dist * 0.9 + 40)) * this.quality.shadowDist;
    this.sky.update(this.mode === 'walk' ? cp.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40)) : focus, this.mode === 'walk' ? 70 : radius);
    this.R.render(dt);
  }
}

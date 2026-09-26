// Asset loading with progress + error tracking. All textures are KTX2 (Basis Universal),
// transcoded to the best GPU format the device supports (ASTC/ETC2/BC7/S3TC).
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { q } from './settings.js';

const HI_RES = new Set(['sparse_grass', 'farm_soil', 'forest_ground_04', 'red_brick', 'clay_roof_tiles_02', 'white_plaster_rough_01', 'aerial_grass_rock', 'corrugated_iron_02']);

export class Assets {
  constructor(renderer) {
    this.renderer = renderer;
    this.ktx2 = new KTX2Loader().setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(renderer);
    this.hdr = new HDRLoader();
    this.gltf = new GLTFLoader();
    this.gltf.setKTX2Loader(this.ktx2);
    this.tex = {};
    this.models = {};
    this.failed = [];
    this.total = 0;
    this.done = 0;
    this.onProgress = null;
  }

  _track(p, label) {
    this.total++;
    return p.then(r => { this.done++; this.onProgress?.(this.done / this.total, label); return r; })
      .catch(e => { this.done++; this.failed.push(label); console.warn('Asset failed', label, e); this.onProgress?.(this.done / this.total, label); return null; });
  }

  ktx(url, label) {
    return this._track(this.ktx2.loadAsync(url), label || url);
  }

  async loadAll() {
    const res = q().texRes;
    const jobs = [];
    const set = (name) => {
      const r = res === '2k' && HI_RES.has(name) ? '2k' : '1k';
      const o = this.tex[name] = {};
      for (const k of ['diff', 'nor', 'arm']) {
        jobs.push(this.ktx(`assets/tex/${name}/${k}_${r}.ktx2`, `${name}/${k}`).then(t => {
          if (!t) return;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = q().anisotropy;
          t.colorSpace = k === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          o[k] = t;
        }));
      }
    };
    ['red_brick', 'factory_brick', 'white_plaster_rough_01', 'clay_roof_tiles_02', 'grey_roof_tiles', 'corrugated_iron_02',
      'concrete_wall_008', 'weathered_planks', 'rusty_metal_02', 'bark_brown_02', 'pine_bark', 'metal_plate', 'aerial_grass_rock', 'brown_mud_02',
    ].forEach(set);
    this.terrain = {};
    for (const k of ['diff', 'nor', 'arm']) {
      jobs.push(this.ktx(`assets/tex/terrain/${k}_array.ktx2`, `terrain/${k}`).then(t => {
        if (!t) return;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = q().anisotropy;
        t.colorSpace = k === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        this.terrain[k] = t;
      }));
    }
    jobs.push(this._track(this.hdr.loadAsync('assets/hdri/sky_env_1k.hdr'), 'sky env HDR').then(t => { this.envHdr = t; }));
    const bgRes = q().texRes === '2k' ? '4k' : '2k';
    jobs.push(this._track(new THREE.TextureLoader().loadAsync(`assets/hdri/sky_bg_${bgRes}.jpg`), 'sky background').then(t => {
      if (!t) return;
      t.colorSpace = THREE.SRGBColorSpace;
      // no mips: the equirect atan seam would otherwise select a tiny mip and draw a line
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      this.skyBg = t;
    }));
    for (const m of ['Barrel_01', 'old_military_crate', 'metal_jerrycan_green', 'ammo_box', 'cement_bag']) {
      jobs.push(this._track(this.gltf.loadAsync(`assets/models/${m}.glb`), `model ${m}`).then(g => { if (g) this.models[m] = g.scene; }));
    }
    await Promise.all(jobs);
  }

  // World-scale PBR material. `tile` = metres covered by one texture repeat.
  pbr(name, opts = {}) {
    const t = this.tex[name] || {};
    const tile = opts.tile || 2;
    const cl = (tx) => {
      if (!tx) return null;
      const c = tx.clone();
      c.repeat.set(1 / tile, 1 / (opts.tileY || tile));
      c.needsUpdate = true;
      return c;
    };
    const m = new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xffffff,
      map: opts.noMap ? null : cl(t.diff),
      normalMap: cl(t.nor),
      roughnessMap: cl(t.arm),
      metalnessMap: opts.metal ? cl(t.arm) : null,
      aoMap: cl(t.arm),
      aoMapIntensity: opts.ao ?? 1,
      roughness: opts.roughness ?? 1,
      metalness: opts.metal ? 1 : 0,
      normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
      side: opts.side ?? THREE.FrontSide,
    });
    if (!t.diff && !opts.noMap) m.color.set(opts.fallback ?? 0x888888);
    m.name = name;
    return m;
  }
}

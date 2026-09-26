import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Central loading: progress reporting, KTX2 transcoding, glTF with meshopt,
// and a PBR material factory fed by assets/manifest.json.

export class Assets {
  constructor(renderer, onProgress) {
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.manager = new THREE.LoadingManager();
    this.manager.onProgress = (url, loaded, total) => this.onProgress?.(loaded, total, url);
    this.ktx2 = new KTX2Loader(this.manager).setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(renderer);
    this.gltf = new GLTFLoader(this.manager).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
    this.hdr = new HDRLoader(this.manager).setDataType(THREE.FloatType);
    this.tex = new THREE.TextureLoader(this.manager);
    this.cache = new Map();
    this.failures = [];
    this.anisotropy = 8;
  }

  async init() {
    const [manifest, models] = await Promise.all([
      fetch('assets/manifest.json').then((r) => { if (!r.ok) throw new Error('manifest.json: HTTP ' + r.status); return r.json(); }),
      fetch('assets/models.json').then((r) => (r.ok ? r.json() : {})),
    ]);
    this.manifest = manifest;
    this.models = models;
  }

  _once(key, fn) {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key);
  }

  ktx(url, colorSpace = THREE.NoColorSpace) {
    return this._once(url, () => this.ktx2.loadAsync(url).then((t) => {
      t.colorSpace = colorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      return t;
    }));
  }

  image(url, colorSpace = THREE.SRGBColorSpace) {
    return this._once(url, () => this.tex.loadAsync(url).then((t) => {
      t.colorSpace = colorSpace;
      t.anisotropy = this.anisotropy;
      return t;
    }));
  }

  /** Loads a GLB; failures are recorded (shown in the UI) and return null instead of throwing. */
  model(id, lod = 0) {
    const entry = this.models[id];
    if (!entry) { this.failures.push(`model ${id} missing from models.json`); return Promise.resolve(null); }
    const url = lod && entry.lod1 ? entry.lod1 : entry.url;
    return this._once(url, () => this.gltf.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const m = o.material;
          if (m.map) m.map.anisotropy = this.anisotropy;
          if (m.normalMap) m.normalMap.anisotropy = this.anisotropy;
        }
      });
      return g.scene;
    }).catch((e) => { this.failures.push(`model ${id}: ${e.message || e}`); return null; }));
  }

  /**
   * Scanned PBR material. Geometry UVs are expected in metres; texture repeat
   * converts to the scan's real-world size so texel density matches reality.
   */
  async pbr(name, opts = {}) {
    const m = this.manifest.materials[name];
    if (!m) throw new Error('unknown material ' + name);
    const [map, normalMap, arm] = await Promise.all([
      this.ktx(m.maps.diff, THREE.SRGBColorSpace),
      this.ktx(m.maps.nor),
      this.ktx(m.maps.arm),
    ]);
    const clone = (t) => {
      const c = t.clone();
      c.repeat.set(1 / m.size_m[0], 1 / m.size_m[1]).multiplyScalar(opts.scale ?? 1);
      c.needsUpdate = true;
      return c;
    };
    const mat = new THREE.MeshStandardMaterial({
      name,
      map: clone(map),
      normalMap: clone(normalMap),
      roughnessMap: clone(arm),
      aoMap: clone(arm),
      aoMapIntensity: opts.aoIntensity ?? 1,
      metalnessMap: opts.metal ? clone(arm) : null,
      metalness: opts.metal ? 1 : 0,
      roughness: opts.roughness ?? 1,
      color: opts.color ?? 0xffffff,
      normalScale: new THREE.Vector2(1, 1).multiplyScalar(opts.normalScale ?? 1),
      envMapIntensity: opts.envMapIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
    return mat;
  }

  async hdri() {
    return this.hdr.loadAsync(this.manifest.hdri.light);
  }
}

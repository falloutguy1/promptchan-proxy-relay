import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL + 'assets/';

/**
 * Central loader: tracks progress for the loading screen, retries transient network failures
 * and records which assets failed so the UI can report them instead of silently rendering holes.
 */
export class Assets {
  constructor(renderer) {
    this.manager = new THREE.LoadingManager();
    this.ktx2 = new KTX2Loader(this.manager).setTranscoderPath(import.meta.env.BASE_URL + 'basis/').detectSupport(renderer);
    this.gltf = new GLTFLoader(this.manager).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
    this.hdr = new HDRLoader(this.manager).setDataType(THREE.HalfFloatType);
    this.cache = new Map();
    this.failed = [];
    this.total = 0;
    this.done = 0;
    this.onProgress = () => {};
  }

  _track(promise, label) {
    this.total++;
    this.onProgress(this.done, this.total, label);
    return promise.then(
      (v) => { this.done++; this.onProgress(this.done, this.total, label); return v; },
      (e) => { this.done++; this.failed.push({ label, error: String(e?.message || e) }); this.onProgress(this.done, this.total, label); return null; },
    );
  }

  async _retry(fn, label, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 400 * 2 ** i)); }
    }
    throw new Error(`${label}: ${last?.message || last}`);
  }

  texture(path, { srgb = false, repeat = true, anisotropy = 8 } = {}) {
    const key = path + srgb;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this._track(this._retry(() => this.ktx2.loadAsync(BASE + path), path).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
      return t;
    }), path);
    this.cache.set(key, p);
    return p;
  }

  /** Loads a PBR set exported by tools/build-assets.mjs: diff (sRGB) + nor + arm (linear). */
  pbr(id) {
    return Promise.all([
      this.texture(`tex/${id}/diff.ktx2`, { srgb: true }),
      this.texture(`tex/${id}/nor.ktx2`),
      this.texture(`tex/${id}/arm.ktx2`),
    ]).then(([map, normalMap, arm]) => ({ map, normalMap, arm, id }));
  }

  model(id) {
    if (this.cache.has('m:' + id)) return this.cache.get('m:' + id);
    const p = this._track(this._retry(() => this.gltf.loadAsync(`${BASE}models/${id}.glb`), id).then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      return g.scene;
    }), id);
    this.cache.set('m:' + id, p);
    return p;
  }

  hdri(id) {
    return this._track(this._retry(() => this.hdr.loadAsync(`${BASE}hdri/${id}.hdr`), id), id);
  }

  json(path) {
    return this._track(this._retry(async () => {
      const r = await fetch(BASE + path);
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }, path), path);
  }
}

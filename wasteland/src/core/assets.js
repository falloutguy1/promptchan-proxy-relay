// Asset loading: KTX2 texture sets, texture arrays, glTF models, skies, manifests.
// Tracks progress for the loading screen and records failures so the game can
// continue with neutral fallbacks and tell the player what is missing.
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { enhanceTree } from './shaderlib.js';

const BASE = new URL('../../', import.meta.url).href; // .../wasteland/
// source-data fixes: Poly Haven's steel_frame_shelves_01 glTF is authored 10x too large
const SCALE_FIX = { steel_frame_shelves_01: 0.1 };

export class Assets {
  constructor(renderer, settings) {
    this.renderer = renderer;
    this.settings = settings;
    this.tier = settings.values.texTier; // 'hi' | 'lo'
    this.anisotropy = Math.min(settings.values.anisotropy, renderer.capabilities.getMaxAnisotropy());
    this.failures = [];
    this.pending = 0;
    this.done = 0;
    this.onProgress = null;
    this.label = '';

    this.manager = new THREE.LoadingManager();
    this.manager.setURLModifier((url) => {
      // model textures ship in two tiers next to each .gltf: name.ktx2 -> name_hi.ktx2
      if (url.endsWith('.ktx2') && url.includes('/models/') && !/_(hi|lo)\.ktx2$/.test(url)) {
        return url.replace(/\.ktx2$/, `_${this.tier}.ktx2`);
      }
      return url;
    });
    this.ktx2 = new KTX2Loader(this.manager)
      .setTranscoderPath(BASE + 'vendor/three/examples/jsm/libs/basis/')
      .setWorkerLimit(Math.min(4, navigator.hardwareConcurrency || 2))
      .detectSupport(renderer);
    this.gltf = new GLTFLoader(this.manager).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
    this.imageLoader = new THREE.TextureLoader(this.manager);
    this.cache = new Map();
    this.fallback = {
      color: solidTexture([128, 128, 128, 255], THREE.SRGBColorSpace),
      normal: solidTexture([128, 128, 255, 128], THREE.NoColorSpace),
      orm: solidTexture([255, 200, 0, 255], THREE.NoColorSpace),
    };
  }

  url(path) { return BASE + 'assets/' + path; }

  track(label, promise) {
    this.pending++;
    this.label = label;
    this.#emit();
    return promise.finally(() => { this.done++; this.#emit(); });
  }
  #emit() { if (this.onProgress) this.onProgress(this.done, this.pending, this.label); }

  fail(what, err) {
    console.warn('asset failed:', what, err);
    this.failures.push({ what, error: String(err?.message || err) });
  }

  async json(path) {
    const key = 'json:' + path;
    if (this.cache.has(key)) return this.cache.get(key);
    // manifests are always revalidated: binaries may be cached for a week
    // (netlify.toml), the index that names them must match the deployed code
    const p = this.track(path, fetch(this.url(path), { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${path}`);
      return r.json();
    }));
    this.cache.set(key, p);
    return p;
  }

  /** Raw KTX2 texture (no fallback). */
  ktx(path, colorSpace) {
    const key = 'ktx:' + path;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.track(path.split('/').slice(-2).join('/'), this.ktx2.loadAsync(this.url(path))).then((t) => {
      t.colorSpace = colorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      t.name = path;
      return t;
    });
    this.cache.set(key, p);
    return p;
  }

  async #safeKtx(path, colorSpace, kind) {
    try { return await this.ktx(path, colorSpace); } catch (e) { this.fail(path, e); return this.fallback[kind]; }
  }

  /** PBR set built by tools/build-textures.mjs: { map, normalMap, ormMap, size } */
  async textureSet(name, folder = 'tex') {
    const key = `set:${folder}/${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = (async () => {
      const t = this.tier;
      const [map, normalMap, ormMap] = await Promise.all([
        this.#safeKtx(`${folder}/${name}/${t}_c.ktx2`, THREE.SRGBColorSpace, 'color'),
        this.#safeKtx(`${folder}/${name}/${t}_n.ktx2`, THREE.NoColorSpace, 'normal'),
        this.#safeKtx(`${folder}/${name}/${t}_orm.ktx2`, THREE.NoColorSpace, 'orm'),
      ]);
      return { map, normalMap, ormMap, name };
    })();
    this.cache.set(key, p);
    return p;
  }

  async optionalKtx(path, colorSpace, kind = 'color') { return this.#safeKtx(path, colorSpace, kind); }

  /**
   * Combine several same-size, same-format compressed textures into one
   * CompressedArrayTexture (used for terrain layers: 1 sampler instead of N).
   */
  static toArray(textures, colorSpace) {
    const first = textures[0];
    const ok = textures.every((t) => t.isCompressedTexture && t.format === first.format && t.image.width === first.image.width && t.mipmaps.length === first.mipmaps.length);
    if (!ok) return null;
    const mips = first.mipmaps.map((m, level) => {
      const size = m.data.byteLength;
      const data = new Uint8Array(size * textures.length);
      textures.forEach((t, i) => data.set(new Uint8Array(t.mipmaps[level].data.buffer, t.mipmaps[level].data.byteOffset, size), i * size));
      return { data, width: m.width, height: m.height };
    });
    const arr = new THREE.CompressedArrayTexture(mips, first.image.width, first.image.height, textures.length, first.format, first.type);
    arr.colorSpace = colorSpace;
    arr.wrapS = arr.wrapT = THREE.RepeatWrapping;
    arr.minFilter = THREE.LinearMipmapLinearFilter;
    arr.magFilter = THREE.LinearFilter;
    arr.anisotropy = first.anisotropy;
    arr.generateMipmaps = false;
    arr.needsUpdate = true;
    return arr;
  }

  /** glTF model from assets/models/<id>/<id>.gltf; resolves to the loaded gltf. */
  model(id) {
    const key = 'model:' + id;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.track(id, this.gltf.loadAsync(this.url(`models/${id}/${id}.gltf`))).then((g) => {
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = this.anisotropy;
            if (m.userData?.cutout || m.alphaTest > 0) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; }
          }
        }
      });
      if (SCALE_FIX[id]) g.scene.scale.multiplyScalar(SCALE_FIX[id]);
      enhanceTree(g.scene, { porosity: 0.7 });
      return g;
    }).catch((e) => { this.fail(`model ${id}`, e); return null; });
    this.cache.set(key, p);
    return p;
  }

  image(path, colorSpace = THREE.SRGBColorSpace) {
    const key = 'img:' + path;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.track(path, this.imageLoader.loadAsync(this.url(path))).then((t) => { t.colorSpace = colorSpace; return t; });
    this.cache.set(key, p);
    return p;
  }

  dispose() { this.ktx2.dispose(); }
}

function solidTexture(rgba, colorSpace) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}

// Asset loading: KTX2/meshopt GLB models and PBR surface texture sets, with progress + error tracking.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { weather } from './weathering.js';

export const manager = new THREE.LoadingManager();
export const errors = [];
manager.onError = (url) => errors.push(url);

let ktx2, gltfLoader, texRes = '2k';
const models = new Map();   // id -> { scene, lod1 }
const texCache = new Map();
export const pending = [];   // material texture assignments still in flight (download + transcode)

export function initLoaders(renderer, quality) {
  texRes = quality === 'low' ? '1k' : '2k';
  ktx2 = new KTX2Loader(manager).setTranscoderPath('vendor/three/addons/libs/basis/').detectSupport(renderer);
  gltfLoader = new GLTFLoader(manager).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

function prepModel(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      if (m && m.map) m.map.anisotropy = 4;
    }
  });
  return root;
}

// ids: array of model ids; lodIds: ids that also have a *_lod1.glb
export function loadModels(ids, lodIds = []) {
  return Promise.all(ids.map(async (id) => {
    try {
      const g = await gltfLoader.loadAsync(`assets/models/${id}.glb`);
      const entry = { scene: prepModel(g.scene), lod1: null };
      if (lodIds.includes(id)) {
        try { entry.lod1 = prepModel((await gltfLoader.loadAsync(`assets/models/${id}_lod1.glb`)).scene); } catch { /* optional */ }
      }
      models.set(id, entry);
    } catch (e) {
      errors.push(`model ${id}: ${e.message || e}`);
    }
  }));
}

export function hasModel(id) { return models.has(id); }

// Returns an Object3D instance of a model (a THREE.LOD when a lod1 exists).
export function instance(id, lodDistance = 14) {
  const e = models.get(id);
  if (!e) {
    // Visible stand-in so missing assets are obvious rather than silently absent.
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
    m.name = `MISSING:${id}`;
    return m;
  }
  if (!e.lod1) return e.scene.clone();
  const lod = new THREE.LOD();
  lod.addLevel(e.scene.clone(), 0);
  lod.addLevel(e.lod1.clone(), lodDistance);
  lod.autoUpdate = true;
  return lod;
}

export function modelBounds(id) {
  const e = models.get(id);
  return e ? new THREE.Box3().setFromObject(e.scene) : new THREE.Box3(new THREE.Vector3(-.2, 0, -.2), new THREE.Vector3(.2, .4, .2));
}

export function forEachModel(fn) { models.forEach((e, id) => fn(id, e)); }

// One network load per KTX2 file; per-material clones share the GPU source but carry their own tiling.
function ktx(url) {
  if (!texCache.has(url)) {
    texCache.set(url, new Promise((resolve) => {
      ktx2.load(url, resolve, undefined, () => { errors.push(url); resolve(null); });
    }));
  }
  return texCache.get(url);
}

// PBR set from assets/textures/<id>/{diff,nor,arm}_<res>.ktx2.
// Geometry UVs are authored in metres; `size` is the real-world width of one texture tile (metres).
export function pbr(id, { size = 2, color = 0xffffff, normalScale = 1, roughness = 1, metalness = 1, weathering = {} } = {}) {
  const base = `assets/textures/${id}/`;
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, normalScale: new THREE.Vector2(normalScale, normalScale) });
  mat.name = id;
  const prep = (t, srgb) => {
    if (!t) return null;
    const c = t.clone();
    c.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.anisotropy = 8;
    c.repeat.set(1 / size, 1 / size);
    c.needsUpdate = true;
    return c;
  };
  const job = Promise.all([ktx(`${base}diff_${texRes}.ktx2`), ktx(`${base}nor_${texRes}.ktx2`), ktx(`${base}arm_${texRes}.ktx2`)]).then(([d, n, a]) => {
    mat.map = prep(d, true);
    mat.normalMap = prep(n, false);
    const arm = prep(a, false);
    if (arm) { mat.aoMap = arm; mat.roughnessMap = arm; mat.metalnessMap = arm; mat.metalness = metalness; }
    mat.needsUpdate = true;
  });
  pending.push(job);
  return weather(mat, weathering);
}

export async function loadHDR(url) {
  return new HDRLoader(manager).loadAsync(url);
}

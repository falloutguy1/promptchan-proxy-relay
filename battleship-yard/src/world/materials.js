import * as THREE from 'three';
import { weather } from '../engine/shaderlib.js';

// Real-world size (metres) covered by one texture tile, from Poly Haven scan metadata.
export const TEX_SIZE = {
  concrete_floor_worn_001: 3.0, concrete_wall_008: 2.71, asphalt_02: 3.0, blue_metal_plate: 2.5,
  metal_plate: 0.5, wood_floor_deck: 1.8, corrugated_iron_02: 2.7, factory_brick: 1.5,
  rusty_corrugated_iron: 2.0, rust_coarse_01: 2.2, pine_bark: 2.0, bark_brown_02: 1.0,
  painted_concrete: 2.0, pine_bark_scan: 1.0, island_bark: 1.0,
};

/**
 * Creates and caches PBR materials. Geometry built by this project uses UVs in metres,
 * so each texture set is scaled once by 1/size to stay at real-world scale.
 */
export class MaterialLibrary {
  constructor(assets) {
    this.assets = assets;
    this.sets = new Map();
    this.mats = new Map();
  }

  async load(ids) {
    await Promise.all(ids.map(async (id) => {
      const s = await this.assets.pbr(id);
      const k = 1 / (TEX_SIZE[id] || 2);
      for (const t of [s.map, s.normalMap, s.arm]) if (t) t.repeat.set(k, k);
      this.sets.set(id, s);
    }));
  }

  /** Standard material from a loaded set. opts: color, normalScale, roughness, metalness, weather, side, envMapIntensity */
  make(name, id, opts = {}) {
    if (this.mats.has(name)) return this.mats.get(name);
    const s = this.sets.get(id);
    const m = new THREE.MeshStandardMaterial({
      name,
      map: s?.map || null,
      normalMap: s?.normalMap || null,
      aoMap: s?.arm || null,
      roughnessMap: s?.arm || null,
      metalnessMap: opts.metalness !== undefined && opts.useMetalMap === false ? null : s?.arm || null,
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 1,
      metalness: opts.metalness ?? 1,
      aoMapIntensity: opts.aoIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      envMapIntensity: opts.envMapIntensity ?? 1,
    });
    if (m.normalMap) m.normalScale.setScalar(opts.normalScale ?? 1);
    if (!s) m.color.set(opts.fallbackColor ?? 0x888888); // asset missing: neutral fallback, reported in UI
    if (opts.weather) weather(m, opts.weather);
    this.mats.set(name, m);
    return m;
  }

  get(name) { return this.mats.get(name); }

  plain(name, color, roughness = 0.6, metalness = 0, extra = {}) {
    if (this.mats.has(name)) return this.mats.get(name);
    const m = new THREE.MeshStandardMaterial({ name, color, roughness, metalness, ...extra });
    this.mats.set(name, m);
    return m;
  }
}

/** Box-projected UVs in metres for procedural geometry (keeps texel density consistent). */
export function boxUV(geo, scale = 1, offset = [0, 0, 0]) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset[0], y = pos.getY(i) + offset[1], z = pos.getZ(i) + offset[2];
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

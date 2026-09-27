// Architecture material library. Every surface is a scanned PBR set (colour, XY
// normal, ORM) with a shared weathering shader: splash-back grime and algae at the
// wall base, faint vertical run-off streaks and exposure-dependent darkening. The
// 'wear' vertex attribute from Geo tells the shader height above ground and whether
// a face is outdoors.
import * as THREE from 'three';
import { enhance } from '../../core/shaderlib.js';
import { macroNoiseTexture } from '../../gfx/noisetex.js';

export const ARCH_SETS = {
  plaster_mossy: 1.8, plaster_damaged: 2.0, plaster_ochre: 2.0, brick_white: 2.0, brick_red: 2.0, concrete: 2.5,
  roof_asbestos: 2.0, roof_tiles: 2.0, corr_rust: 2.0, corr_worn: 2.0, metal_red: 2.0, metal_green: 2.0, metal_white: 2.0,
  wood_weathered: 2.0, wood_painted: 2.0, floor_wood: 2.0, wall_interior: 2.0, canvas: 1.0, burlap: 0.5,
};

// Albedo corrections for scans that do not suit tinting. The weathered planks scan
// is dark brown (mean albedo 0.06): tinted it read as charcoal, so it is partly
// desaturated and brightened until the colony's tints give weathered lumber
// (albedo ~0.15). The linen scan is blue, so it is used as luminance only,
// normalised to a mean of 1: the vertex tint is then the cloth's albedo.
const ALBEDO = {
  wood_weathered: { gain: 5.7, desat: 0.55 },
  canvas: { gain: 1 / 0.398, desat: 1 },
};

const WEATHER = (shader) => {
  shader.uniforms.tWearNoise = { value: macroNoiseTexture() };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 wear;\nvarying vec2 vWear;\nvarying vec3 vArchPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWear = wear;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvArchPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vWear;\nvarying vec3 vArchPos;\nuniform sampler2D tWearNoise;')
    .replace('#include <map_fragment>', /* glsl */`
	#include <map_fragment>
	#ifdef ALBEDO_DESAT
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ALBEDO_DESAT );
	#endif
	{
		float h = vWear.x, ex = vWear.y;
		vec4 n1 = texture2D( tWearNoise, vArchPos.xz * 0.11 + vArchPos.y * 0.03 );
		vec4 n2 = texture2D( tWearNoise, vec2( vArchPos.x * 0.37 + vArchPos.z * 0.37, vArchPos.y * 0.035 ) );
		// splash-back grime and green algae at the base of outdoor walls
		float base = ( 1.0 - smoothstep( 0.05, 0.55 + n1.r * 0.45, h ) ) * ex;
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.64, 0.5 ), base * 0.75 );
		// vertical run-off streaks, strongest high on the wall
		float streak = smoothstep( 0.55, 0.85, n2.g ) * smoothstep( 0.8, 2.6, h ) * ex;
		diffuseColor.rgb *= 1.0 - streak * 0.22;
		// broad weathering variation
		diffuseColor.rgb *= mix( 0.9, 1.06, n1.b ) * mix( 1.0, 0.92, ex * n1.g );
	}`);
};

export class ArchMaterials {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
    this.sets = {};
  }

  async load() {
    await Promise.all(Object.keys(ARCH_SETS).map(async (k) => { this.sets[k] = await this.assets.textureSet(k); }));
    this.tiles = { ...ARCH_SETS, glass: 1, sign: 1, trim: 2, dark: 1 };
  }

  /**
   * key: set name, optionally with ':#rrggbb' tint, e.g. 'wood_painted:#6e8fa3'.
   * opts: { metal, rough, side, alpha }
   */
  get(key, opts = {}) {
    const ck = key + JSON.stringify(opts);
    if (this.cache.has(ck)) return this.cache.get(ck);
    let m;
    if (key === 'glass') {
      m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.58, 0.64, 0.6), roughness: 0.14, metalness: 0, transparent: true, opacity: 0.32, ior: 1.52, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2, vertexColors: true });
      enhance(m, { wet: false, key: 'glass' });
    } else if (key === 'dark') {
      m = new THREE.MeshStandardMaterial({ color: 0x0a0a09, roughness: 1, vertexColors: true });
      enhance(m, { wet: false, key: 'dark' });
    } else {
      // tints arrive as vertex colours (see Geo.part), so one material serves every tint of a set
      const name = key.split(':')[0];
      const set = this.sets[name];
      m = new THREE.MeshStandardMaterial({
        map: set.map, normalMap: set.normalMap, roughnessMap: set.ormMap, aoMap: set.ormMap, metalnessMap: opts.metal ? set.ormMap : null,
        metalness: opts.metal ?? 0, roughness: opts.rough ?? 1, vertexColors: true,
        side: opts.side ?? THREE.FrontSide,
      });
      m.name = key;
      const fix = ALBEDO[name];
      if (fix) { m.color.setScalar(fix.gain); m.defines = { ...m.defines, ALBEDO_DESAT: fix.desat.toFixed(2) }; }
      const porosity = name.startsWith('metal') || name.startsWith('corr') ? 0.35 : name.startsWith('roof') ? 0.6 : 0.9;
      enhance(m, { porosity, key: 'arch', extra: WEATHER });
    }
    this.cache.set(ck, m);
    return m;
  }

  /** Canvas-painted sign texture (faded lettering) as a material. */
  sign(text, { w = 1024, h = 256, bg = '#e2ddd0', fg = '#9c2f25', font = 'bold 150px "Arial Narrow", Arial, sans-serif', fade = 0.6 } = {}) {
    const ck = 'sign:' + text + bg + fg;
    if (this.cache.has(ck)) return this.cache.get(ck);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 6);
    // weathering: flaking, rust bleed, dirt
    let seed = text.length * 97;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900 * fade; i++) {
      const x = rnd() * w, y = rnd() * h, r = rnd() * 9 + 1;
      g.fillStyle = `rgba(${120 + rnd() * 40 | 0},${110 + rnd() * 30 | 0},${95 + rnd() * 25 | 0},${0.15 + rnd() * 0.5})`;
      g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rnd()), rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, len = 20 + rnd() * h;
      const grad = g.createLinearGradient(x, 0, x, len);
      grad.addColorStop(0, 'rgba(110,60,30,0.35)'); grad.addColorStop(1, 'rgba(110,60,30,0)');
      g.fillStyle = grad; g.fillRect(x, 0, 2 + rnd() * 6, len);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.1 });
    enhance(m, { porosity: 0.4, key: 'sign' });
    this.cache.set(ck, m);
    return m;
  }
}

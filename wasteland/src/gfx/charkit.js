// Character kit: skinned parts built by tools/build-characters.mjs from the
// Quaternius CC0 outfits, heads and hairstyles, on one skeleton per body type.
// A character is assembled into a single skinned mesh (one draw call) whose
// material dyes the fabric, tints skin and hair, adds grime from the ground up
// and can turn the whole figure into one of the infected. Shared animation
// clips come from the Universal Animation Library (rotations + hip height, so
// every body keeps its proportions).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { enhance } from '../core/shaderlib.js';

const MAX_PARTS = 16;
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3();

// linear albedo targets; fabric dyes are applied by luminance so the painted
// folds, seams and wear of the outfit textures stay
export const PALETTE = {
  cloth: {
    olive: [0.15, 0.155, 0.085], khaki: [0.3, 0.26, 0.17], drab: [0.2, 0.18, 0.12], rust: [0.27, 0.115, 0.055], navy: [0.085, 0.105, 0.15],
    charcoal: [0.075, 0.075, 0.07], ash: [0.22, 0.22, 0.2], brown: [0.18, 0.115, 0.065], oxblood: [0.2, 0.07, 0.05], sand: [0.38, 0.32, 0.22],
    moss: [0.12, 0.14, 0.085], denim: [0.1, 0.13, 0.18], bone: [0.45, 0.42, 0.35],
  },
  // multipliers on the medium base skin texture
  skin: [[1.5, 1.62, 1.95], [1.28, 1.34, 1.5], [1.08, 1.08, 1.12], [0.9, 0.86, 0.82], [0.62, 0.56, 0.54], [0.38, 0.34, 0.33]],
  // hair texture is neutral grey (~0.3): targets divided by that
  hair: [[0.02, 0.018, 0.015], [0.05, 0.03, 0.018], [0.11, 0.065, 0.032], [0.2, 0.07, 0.03], [0.3, 0.22, 0.12], [0.24, 0.24, 0.23], [0.45, 0.44, 0.42]],
};
const HAIR_LUM = 0.3;
const pick = (rng, a) => a[Math.floor(rng() * a.length)];

const CHAR_PARS_V = /* glsl */`
attribute float part;
varying float vPart;
varying vec3 vBind;
uniform int uHide;
`;
const CHAR_PARS_F = /* glsl */`
varying float vPart;
varying vec3 vBind;
uniform vec4 uTint[${MAX_PARTS}];
uniform vec3 uLeather;
uniform float uGrime;
uniform float uZombie;
uniform float uSeed;
float chHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float chNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( chHash( i ), chHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( chHash( i + vec3( 0, 1, 0 ) ), chHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( chHash( i + vec3( 0, 0, 1 ) ), chHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( chHash( i + vec3( 0, 1, 1 ) ), chHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;
// after map_fragment: diffuseColor = texel (alpha = dye mask)
const CHAR_FRAG = /* glsl */`
{
	int pi = int( vPart + 0.5 );
	vec4 tint = uTint[ pi ];
	float mask = diffuseColor.a;
	diffuseColor.a = 1.0;
	float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	vec3 bp = vBind + uSeed;
	float n1 = chNoise( bp * 9.0 ), n2 = chNoise( bp * 23.0 + 4.1 );
	if ( tint.w > 0.5 ) {
		// fabric: re-dye masked texels by luminance, darken/grey the leather and brass a little
		vec3 dyed = tint.rgb * lum;
		vec3 worn = mix( diffuseColor.rgb, vec3( lum ), 0.25 ) * uLeather;
		diffuseColor.rgb = mix( worn, dyed, mask );
		if ( tint.w > 1.5 ) diffuseColor.rgb *= mix( 1.0, 0.55 + 0.45 * n2, uZombie );
	} else if ( tint.w > -0.5 ) {
		diffuseColor.rgb *= tint.rgb;
	}
	// skin of the infected: grey-green and mottled, with purple bruising and dark veins
	if ( tint.w < -0.5 ) {
		vec3 base = diffuseColor.rgb * tint.rgb;
		vec3 dead = vec3( lum ) * vec3( 0.7, 0.78, 0.6 ) * 1.3;
		dead *= 0.8 + 0.32 * n1;
		dead = mix( dead, dead * vec3( 0.55, 0.42, 0.58 ), smoothstep( 0.55, 0.85, chNoise( bp * 31.0 + 3.0 ) ) * 0.55 );
		float vein = 1.0 - smoothstep( 0.0, 0.05, abs( chNoise( bp * 14.0 + 7.0 ) - 0.5 ) );
		dead *= 1.0 - vein * 0.35;
		diffuseColor.rgb = mix( base, dead, uZombie );
	}
	// grime and dust from the ground up, in blotches
	float up = clamp( vBind.y / 1.7, 0.0, 1.0 );
	float g = uGrime * ( 0.55 * ( 1.0 - up ) + 0.25 ) * smoothstep( 0.35, 0.8, n1 * 0.7 + n2 * 0.3 );
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.5, 0.44 ) + vec3( 0.018, 0.014, 0.01 ), g );
	// dried blood on the infected's clothes (chest, arms, legs)
	float blood = uZombie * smoothstep( 0.7, 0.86, chNoise( bp * 5.0 + 11.0 ) ) * step( 0.5, tint.w );
	diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.075, 0.018, 0.014 ), blood * 0.85 );
}
`;

/** Merged-part geometry with bind-space float attributes and a per-vertex part index. */
function bindSpaceGeometry(sm) {
  // quantised skinned parts carry their dequantisation in the inverse bind
  // matrices: bone * inverseBind is the same matrix T for every joint at rest
  sm.skeleton.bones[0].updateWorldMatrix(true, false);
  const T = _m.multiplyMatrices(sm.skeleton.bones[0].matrixWorld, sm.skeleton.boneInverses[0]).multiply(sm.bindMatrix);
  const g = sm.geometry, n = g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const f32 = (attr, size) => { const a = new Float32Array(n * size); for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) a[i * size + k] = attr.getComponent(i, k); return a; };
  const pos = new THREE.BufferAttribute(f32(g.attributes.position, 3), 3);
  const nor = new THREE.BufferAttribute(f32(g.attributes.normal, 3), 3);
  pos.applyMatrix4(T);
  nor.applyNormalMatrix(_n.getNormalMatrix(T));
  out.setAttribute('position', pos);
  out.setAttribute('normal', nor);
  out.setAttribute('uv', new THREE.BufferAttribute(f32(g.attributes.uv, 2), 2));
  const si = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) si[i * 4 + k] = g.attributes.skinIndex.getComponent(i, k);
  out.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
  const sw = f32(g.attributes.skinWeight, 4);
  for (let i = 0; i < n; i++) { const s = sw[i * 4] + sw[i * 4 + 1] + sw[i * 4 + 2] + sw[i * 4 + 3] || 1; for (let k = 0; k < 4; k++) sw[i * 4 + k] /= s; }
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  return out;
}

export class CharacterKit {
  static async load(assets) {
    const [chars, anims] = await Promise.all([assets.model('characters'), assets.model('char_anims')]);
    if (!chars || !anims) return null;
    return new CharacterKit(chars, anims);
  }

  constructor(chars, anims) {
    this.parts = new Map();
    this.skel = {};
    chars.scene.updateMatrixWorld(true);
    let textures = null;
    chars.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      this.parts.set(o.name, { name: o.name, ...o.userData, geo: bindSpaceGeometry(o) });
      if (!textures) textures = { map: o.material.map, normalMap: o.material.normalMap, orm: o.material.roughnessMap, dyeRef: o.material.userData?.dyeRef || {} };
    });
    this.textures = textures;
    // bones-only skeleton templates and canonical inverse bind matrices per body;
    // joints are named from the kit's joint list (the loader de-duplicates the
    // second body's node names, which would break animation binding)
    const jointNames = chars.scene.userData?.joints;
    for (const g of ['M', 'F']) {
      let sm = null;
      chars.scene.traverse((o) => { if (!sm && o.isSkinnedMesh && o.userData.gender === g) sm = o; });
      const index = new Map(sm.skeleton.bones.map((b, i) => [b, i]));
      const copy = (s) => {
        const b = new THREE.Bone(); b.name = jointNames ? jointNames[index.get(s)] : s.name;
        b.position.copy(s.position); b.quaternion.copy(s.quaternion); b.scale.copy(s.scale);
        for (const c of s.children) if (index.has(c)) b.add(copy(c));
        return b;
      };
      const root = copy(sm.skeleton.bones[0]);
      root.updateMatrixWorld(true);
      const bones = []; root.traverse((b) => bones.push(b));
      const names = bones.map((b) => b.name);
      const inverses = bones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());
      this.skel[g] = { root, names, inverses };
    }
    // animation clips per body: hip translation scaled to the body's hip height
    const meta = anims.scene.userData || {};
    this.speeds = meta.speeds || {};
    const hip0 = meta.hipHeight || 0.917;
    this.clips = { M: new Map(), F: new Map() };
    for (const clip of anims.animations) {
      for (const g of ['M', 'F']) {
        const k = (meta.hips?.[g] || hip0) / hip0;
        const tracks = clip.tracks.map((t) => {
          if (!t.name.endsWith('.position')) return t;
          const c = t.clone(); for (let i = 0; i < c.values.length; i++) c.values[i] *= k; return c;
        });
        this.clips[g].set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));
      }
    }
    // upper-body-only variants (layered over other clips with a dominant weight)
    const UPPER = /^(spine_02|spine_03|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|ring_|pinky_|thumb_)/;
    for (const g of ['M', 'F']) {
      const c = this.clips[g].get('Walk_Carry_Loop');
      if (c) this.clips[g].set('Carry_Arms', new THREE.AnimationClip('Carry_Arms', c.duration, c.tracks.filter((t) => UPPER.test(t.name.split('.')[0]))));
    }
    this.geoCache = new Map();
  }

  clip(g, name) { return this.clips[g].get(name) || null; }

  /** Parts available for a body: { slot: [names] }. */
  slots(g) {
    const out = {};
    for (const p of this.parts.values()) if (p.gender === g) (out[p.slot] ||= []).push(p.name);
    return out;
  }

  /** Seeded wasteland look. kind: 'survivor' | 'infected' | 'trader'. */
  appearance(seed, kind = 'survivor', opts = {}) {
    let s = (seed * 2654435761) >>> 0 || 1;
    const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const g = opts.gender || (rng() < 0.55 ? 'M' : 'F');
    const zombie = kind === 'infected';
    const P = (n) => `${g}_${n}`;
    const ranger = rng() < (zombie ? 0.3 : 0.5);
    const torso = ranger ? 'ranger' : 'peasant';
    const legs = rng() < 0.7 ? torso : torso === 'ranger' ? 'peasant' : 'ranger';
    const feet = rng() < 0.55 ? 'ranger' : 'peasant';
    const parts = [P('head'), P('eyes'), P('brows')];
    const has = (n) => this.parts.has(P(n));
    const add = (n) => { if (has(n)) parts.push(P(n)); };
    if (torso === 'ranger') { add('ranger_body'); add('ranger_arms'); add('ranger_arms_skin'); if (rng() < 0.7) add('ranger_body_belt_1'); if (rng() < 0.35) add('ranger_body_belt_2'); }
    else { add('peasant_body'); add('peasant_arms'); add('peasant_arms_skin'); }
    add(`${legs}_legs`);
    add(feet === 'ranger' ? (g === 'M' ? 'ranger_feet_boots' : 'ranger_feet') : 'peasant_feet');
    if (!zombie && rng() < 0.3) add('ranger_arms_bracer');
    if (!zombie && rng() < 0.18) add(g === 'M' ? 'ranger_acc_pauldron' : 'ranger_acc_pauldrons');
    const hood = !zombie && (torso === 'ranger' ? rng() < 0.55 : rng() < 0.2);
    if (hood) add('ranger_head_hood');
    const hairs = g === 'M' ? ['buzzed', 'parted', null] : ['buns', 'long', 'buzzed'];
    const hair = hood ? null : zombie ? (rng() < 0.5 ? pick(rng, hairs) : null) : pick(rng, hairs);
    if (hair) add(`hair_${hair}`);
    if (g === 'M' && rng() < (zombie ? 0.3 : 0.45)) add('hair_beard');
    const C = PALETTE.cloth;
    const clothKeys = zombie ? ['drab', 'ash', 'brown', 'charcoal', 'khaki', 'denim', 'oxblood'] : Object.keys(C);
    const dye = { torso: C[pick(rng, clothKeys)], legs: C[pick(rng, clothKeys)], hood: C[pick(rng, ['olive', 'drab', 'khaki', 'charcoal', 'moss', 'rust', 'ash', 'sand'])], arms: null };
    dye.arms = rng() < 0.6 ? dye.torso : C[pick(rng, clothKeys)];
    const leatherK = 0.85 + rng() * 0.3;
    return {
      gender: g, parts: [...new Set(parts)], zombie: zombie ? 1 : 0,
      skin: pick(rng, PALETTE.skin), hair: pick(rng, zombie ? PALETTE.hair.slice(4) : PALETTE.hair),
      dye, leather: [leatherK, leatherK * (0.95 + rng() * 0.05), leatherK * (0.88 + rng() * 0.1)],
      grime: zombie ? 0.95 : 0.25 + rng() * 0.55, seed: rng() * 100, hood,
    };
  }

  #geometry(names) {
    const key = names.join('|');
    let g = this.geoCache.get(key);
    if (g) return g;
    const geos = names.map((n, i) => {
      const src = this.parts.get(n).geo;
      const c = src.clone();
      c.setAttribute('part', new THREE.BufferAttribute(new Float32Array(src.attributes.position.count).fill(i), 1));
      return c;
    });
    g = mergeGeometries(geos, false);
    for (const c of geos) c.dispose();
    g.computeBoundingSphere();
    g.boundingSphere.radius = Math.max(g.boundingSphere.radius, 1.0);
    this.geoCache.set(key, g);
    return g;
  }

  #material(look, names) {
    const t = this.textures;
    const tint = Array.from({ length: MAX_PARTS }, () => new THREE.Vector4(1, 1, 1, 0));
    names.forEach((n, i) => {
      const p = this.parts.get(n);
      const v = tint[i];
      if (p.kind === 'skin') { v.set(...look.skin, look.zombie ? -1 : 0); }
      else if (p.kind === 'hair') { v.set(look.hair[0] / HAIR_LUM, look.hair[1] / HAIR_LUM, look.hair[2] / HAIR_LUM, 0); }
      else if (p.kind === 'eyes') { if (look.zombie) v.set(1.25, 1.15, 0.7, 0); }
      else {
        const d = p.slot === 'legs' ? look.dye.legs : p.slot === 'hood' ? look.dye.hood : p.slot === 'arms' ? look.dye.arms : look.dye.torso;
        const ref = p.dyeRef || t.dyeRef?.[p.tex] || 0.06;
        v.set(d[0] / ref, d[1] / ref, d[2] / ref, look.zombie ? 2 : 1);
      }
    });
    const u = {
      uTint: { value: tint }, uLeather: { value: new THREE.Color(...look.leather) }, uGrime: { value: look.grime },
      uZombie: { value: look.zombie }, uSeed: { value: look.seed }, uHide: { value: 0 },
    };
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, aoMap: t.orm, aoMapIntensity: 0.85,
      roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.9, 0.9),
    });
    enhance(m, {
      porosity: 0.85, key: 'character',
      extra: (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${CHAR_PARS_V}`)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = part;\nvBind = position;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nif ( ( ( uHide >> int( part + 0.5 ) ) & 1 ) == 1 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${CHAR_PARS_F}`)
          .replace('#include <map_fragment>', `#include <map_fragment>\n${CHAR_FRAG}`);
      },
    });
    m.userData.u = u;
    return m;
  }

  /**
   * Build one character. Returns { root (Object3D to place), mesh, bones (name -> Bone),
   * look, parts (names in part-index order), mixer, gender, hide(slots) }.
   */
  build(look) {
    const names = look.parts.filter((n) => this.parts.has(n)).slice(0, MAX_PARTS);
    const geo = this.#geometry(names);
    const mat = this.#material(look, names);
    const sk = this.skel[look.gender];
    const root = new THREE.Group();
    const bonesRoot = sk.root.clone(true);
    const byName = new Map();
    bonesRoot.traverse((b) => byName.set(b.name, b));
    const bones = sk.names.map((n) => byName.get(n));
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = 'character';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(bonesRoot, mesh);
    mesh.bind(new THREE.Skeleton(bones, sk.inverses), new THREE.Matrix4());
    const mixer = new THREE.AnimationMixer(bonesRoot);
    const slotBits = (pred) => names.reduce((b, n, i) => (pred(this.parts.get(n)) ? b | (1 << i) : b), 0);
    return {
      root, mesh, bones: byName, look, parts: names, mixer, gender: look.gender, bonesRoot,
      /** hide parts whose slot is in the list (e.g. first person hides the head) */
      hide: (slots) => { mat.userData.u.uHide.value = slots?.length ? slotBits((p) => slots.includes(p.slot)) : 0; },
      dispose: () => { mat.dispose(); mixer.stopAllAction(); },
    };
  }
}

// Terrain shading: six scanned PBR layers (grass, soil, forest floor, gravel, mud,
// rock) packed into three compressed texture arrays, blended by splat maps with
// height-aware transitions, two-scale anti-tiling, macro colour variation,
// world-aligned normal mapping and rain puddles.
import * as THREE from 'three';
import { Assets } from '../core/assets.js';
import { G, FOG_PARS, FOG_FRAG } from '../core/shaderlib.js';
import { macroNoiseTexture } from '../gfx/noisetex.js';
import { LAYERS } from './terrain.js';

// tile size in metres and colour grading per layer
const LAYER_CFG = {
  grass: { scale: 2.6, tint: [0.68, 0.9, 0.5] },
  soil: { scale: 2.4, tint: [0.98, 0.92, 0.84] },
  forest: { scale: 2.5, tint: [0.78, 0.74, 0.66] },
  gravel: { scale: 2.2, tint: [0.92, 0.91, 0.9] },
  mud: { scale: 2.6, tint: [0.85, 0.83, 0.8] },
  rock: { scale: 4.0, tint: [0.9, 0.92, 0.88] },
};

function solidArray(rgba, count, colorSpace) {
  const data = new Uint8Array(4 * count);
  for (let i = 0; i < count; i++) data.set(rgba, i * 4);
  const t = new THREE.DataArrayTexture(data, 1, 1, count);
  t.colorSpace = colorSpace; t.needsUpdate = true;
  return t;
}

export async function createTerrainMaterial(assets, terrain) {
  const sets = await Promise.all(LAYERS.map((n) => assets.textureSet(n)));
  let tAlb = Assets.toArray(sets.map((s) => s.map), THREE.SRGBColorSpace);
  let tNrm = Assets.toArray(sets.map((s) => s.normalMap), THREE.NoColorSpace);
  let tOrm = Assets.toArray(sets.map((s) => s.ormMap), THREE.NoColorSpace);
  if (!tAlb || !tNrm || !tOrm) {
    assets.fail('terrain layer arrays', 'layer textures missing or mismatched; using flat colours');
    tAlb = solidArray([96, 104, 70, 255], LAYERS.length, THREE.SRGBColorSpace);
    tNrm = solidArray([128, 128, 128, 128], LAYERS.length, THREE.NoColorSpace);
    tOrm = solidArray([255, 230, 0, 255], LAYERS.length, THREE.NoColorSpace);
  }
  const { splatA, splatB } = terrain.buildSplat();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = {
    tAlb: { value: tAlb }, tNrm: { value: tNrm }, tOrm: { value: tOrm },
    tSplatA: { value: splatA }, tSplatB: { value: splatB }, tMacro: { value: macroNoiseTexture() },
    uTerrainSize: { value: terrain.size },
    uLayerScale: { value: LAYERS.map((n) => LAYER_CFG[n].scale) },
    uLayerTint: { value: LAYERS.map((n) => new THREE.Vector3(...LAYER_CFG[n].tint)) },
    uNormalStrength: { value: 1.0 },
  };
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tAlb;
uniform sampler2DArray tNrm;
uniform sampler2DArray tOrm;
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2D tMacro;
uniform float uTerrainSize;
uniform float uLayerScale[ ${LAYERS.length} ];
uniform vec3 uLayerTint[ ${LAYERS.length} ];
uniform float uNormalStrength;
uniform float uWetness;
varying vec3 vTPos;
vec2 wlRot( vec2 p, float a ) { float c = cos( a ), s = sin( a ); return vec2( c * p.x - s * p.y, s * p.x + c * p.y ); }
`)
      .replace('#include <fog_pars_fragment>', FOG_PARS)
      .replace('#include <fog_fragment>', FOG_FRAG)
      .replace('#include <map_fragment>', /* glsl */`
	vec2 tuv = ( vTPos.xz + uTerrainSize * 0.5 ) / uTerrainSize;
	vec4 sA = texture2D( tSplatA, tuv );
	vec4 sB = texture2D( tSplatB, tuv );
	vec4 macro = texture2D( tMacro, vTPos.xz / 311.0 );
	vec4 macro2 = texture2D( tMacro, vTPos.xz / 57.0 + 0.31 );
	vec4 micro = texture2D( tMacro, vTPos.xz / 9.0 );
	float w[ 6 ];
	w[ 0 ] = sA.r; w[ 1 ] = sA.g; w[ 2 ] = sA.b; w[ 3 ] = sA.a; w[ 4 ] = sB.r; w[ 5 ] = sB.g;
	float camDist = length( vViewPosition );
	float farT = smoothstep( 12.0, 110.0, camDist );
	// pass 1: per-layer height (AO channel as a cavity/height proxy) for blending
	float hv[ 6 ];
	vec3 ormS[ 6 ];
	float vmax = 0.0;
	for ( int i = 0; i < 6; i ++ ) {
		hv[ i ] = - 1.0;
		ormS[ i ] = vec3( 1.0, 0.8, 0.0 );
		if ( w[ i ] < 0.004 ) continue;
		float fi = float( i );
		vec2 uvA = wlRot( vTPos.xz, fi * 1.31 ) / uLayerScale[ i ];
		vec2 uvB = wlRot( vTPos.xz, fi * 1.31 + 2.1 ) / ( uLayerScale[ i ] * 3.7 ) + 0.37;
		float bb = clamp( 0.28 + ( macro2.r - 0.5 ) * 0.9 + farT * 0.45, 0.0, 0.92 );
		vec3 o = mix( texture( tOrm, vec3( uvA, fi ) ).rgb, texture( tOrm, vec3( uvB, fi ) ).rgb, bb );
		ormS[ i ] = o;
		float edgeNoise = ( micro.r - 0.5 ) * 0.25;
		hv[ i ] = w[ i ] + ( o.r - 0.5 ) * 0.55 + edgeNoise * step( 0.05, w[ i ] ) * step( w[ i ], 0.95 );
		vmax = max( vmax, hv[ i ] );
	}
	float bsum = 0.0;
	float bw[ 6 ];
	for ( int i = 0; i < 6; i ++ ) { bw[ i ] = max( hv[ i ] - ( vmax - 0.16 ), 0.0 ); bsum += bw[ i ]; }
	vec3 tCol = vec3( 0.0 );
	vec3 tNrmTS = vec3( 0.0 );
	vec3 tOrmB = vec3( 0.0 );
	float dryness = clamp( sB.a + ( macro.b - 0.5 ) * 0.4, 0.0, 1.0 );
	// pass 2: colour + normal for contributing layers
	for ( int i = 0; i < 6; i ++ ) {
		float b = bw[ i ] / max( bsum, 1e-4 );
		if ( b < 0.01 ) continue;
		float fi = float( i );
		vec2 uvA = wlRot( vTPos.xz, fi * 1.31 ) / uLayerScale[ i ];
		vec2 uvB = wlRot( vTPos.xz, fi * 1.31 + 2.1 ) / ( uLayerScale[ i ] * 3.7 ) + 0.37;
		float bb = clamp( 0.28 + ( macro2.r - 0.5 ) * 0.9 + farT * 0.45, 0.0, 0.92 );
		vec3 c = mix( texture( tAlb, vec3( uvA, fi ) ).rgb, texture( tAlb, vec3( uvB, fi ) ).rgb, bb ) * uLayerTint[ i ];
		if ( i == 0 ) {
			// meadow patchwork: lush dark-green swards and dry straw-coloured patches at 5-25 m,
			// plus clumpy value noise that stands in for grass blades beyond the grass draw distance
			float n1 = texture2D( tMacro, vTPos.xz / 23.0 + 0.71 ).g;
			float n2 = texture2D( tMacro, vTPos.xz / 6.1 + 0.23 ).b;
			float lush = smoothstep( 0.32, 0.78, n1 * 0.72 + n2 * 0.28 );
			c = mix( c * vec3( 1.1, 1.02, 0.74 ), c * vec3( 0.8, 0.93, 0.72 ), lush );
			c *= mix( 1.0, 0.8 + 0.3 * n2, farT );
			c = mix( c, c * vec3( 1.16, 1.04, 0.72 ), dryness * 0.3 );
		}
		if ( i == 2 ) c = mix( c, vec3( dot( c, vec3( 0.3, 0.55, 0.15 ) ) ), 0.45 ) * 0.9;
		vec4 nA = texture( tNrm, vec3( uvA, fi ) );
		vec4 nB = texture( tNrm, vec3( uvB, fi ) );
		vec2 nxy = mix( vec2( nA.r, nA.a ), vec2( nB.r, nB.a ), bb ) * 2.0 - 1.0;
		tCol += c * b;
		tNrmTS += vec3( nxy, 0.0 ) * b;
		tOrmB += ormS[ i ] * b;
	}
	// large-scale value / hue variation breaks up any remaining repetition
	tCol *= mix( 0.84, 1.1, macro.g ) * mix( 0.93, 1.05, macro2.b );
	tCol = mix( tCol, tCol * vec3( 1.04, 1.0, 0.9 ), ( macro.r - 0.5 ) * 0.6 );
	// rain: puddles gather in ruts / hollows, ground darkens
	float puddle = smoothstep( 0.25, 0.65, sB.b + ( micro.g - 0.5 ) * 0.3 ) * uWetness;
	float wetGround = uWetness * 0.75;
	tCol *= 1.0 - 0.38 * wetGround - 0.25 * puddle;
	diffuseColor.rgb *= tCol;
`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
	float roughnessFactor = clamp( tOrmB.g, 0.04, 1.0 );
	roughnessFactor = mix( roughnessFactor, 0.35, wetGround * 0.6 );
	roughnessFactor = mix( roughnessFactor, 0.03, puddle );
`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
	{
		vec3 wN0 = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
		vec3 T = normalize( vec3( 1.0, 0.0, 0.0 ) - wN0 * wN0.x );
		vec3 B = cross( wN0, T );
		vec2 nxy = tNrmTS.xy * uNormalStrength * ( 1.0 - puddle * 0.9 );
		vec3 tn = vec3( nxy, sqrt( saturate( 1.0 - dot( nxy, nxy ) ) ) );
		vec3 wN = normalize( T * tn.x + B * tn.y + wN0 * tn.z );
		normal = normalize( ( viewMatrix * vec4( wN, 0.0 ) ).xyz );
	}
`)
      .replace('#include <aomap_fragment>', /* glsl */`
	{
		float ambientOcclusion = mix( 1.0, tOrmB.r, 0.85 );
		reflectedLight.indirectDiffuse *= ambientOcclusion;
		#if defined( USE_ENVMAP ) && defined( STANDARD )
			float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
			reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
		#endif
	}
`);
  };
  mat.customProgramCacheKey = () => 'terrain-v2';
  return mat;
}

/** Cheap material for the far horizon ring: vertex tinted, fog does the rest. */
export function createHorizonMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.19, 0.12), roughness: 1, metalness: 0, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', FOG_PARS).replace('#include <fog_fragment>', FOG_FRAG);
  };
  m.customProgramCacheKey = () => 'horizon-v1';
  return m;
}

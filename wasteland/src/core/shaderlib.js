// Shared shader state and material "enhancement":
//  * XY-packed normal maps (ETC1S normal textures store X in RGB, Y in A)
//  * exponential height fog with sun in-scattering (aerial perspective)
//  * rain wetness (darkened albedo, glossy upward-facing surfaces)
//  * wind animation for foliage, applied in world space after instancing
// All enhanced materials share the uniform objects in G, so one update per frame
// drives every shader.
import * as THREE from 'three';

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uFogColor: { value: new THREE.Color(0.5, 0.55, 0.6) },
  uFogSunColor: { value: new THREE.Color(0.9, 0.8, 0.6) },
  uFogDensity: { value: 0.0012 },
  uFogHeight: { value: 0 },
  uFogFalloff: { value: 0.035 },
  uWetness: { value: 0 },
  uWind: { value: new THREE.Vector4(0.8, 0.6, 0.6, 0) }, // dir.xy, strength, gustiness
  uSunLight: { value: new THREE.Color(1, 1, 1) },          // sun colour * intensity (foliage translucency)
};

// --- packed XY normals: patch the built-in chunk once, before any compile ------
let patched = false;
export function patchGlobalChunks() {
  if (patched) return;
  patched = true;
  const c = THREE.ShaderChunk;
  const target = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
  if (!c.normal_fragment_maps.includes(target)) console.warn('normal_fragment_maps changed; XY normal patch not applied');
  c.normal_fragment_maps = c.normal_fragment_maps.replace(
    target,
    `vec4 packedNrm = texture2D( normalMap, vNormalMapUv );
	vec3 mapN = vec3( packedNrm.r * 2.0 - 1.0, packedNrm.a * 2.0 - 1.0, 0.0 );
	mapN.z = sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) );`
  );
}

export const FOG_PARS = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	uniform vec3 fogColor;
	uniform vec3 uFogColor;
	uniform vec3 uFogSunColor;
	uniform float uFogDensity;
	uniform float uFogHeight;
	uniform float uFogFalloff;
	uniform vec3 uSunDir;
	vec3 wlApplyFog( vec3 col, vec3 viewPos ) {
		vec3 ray = transpose( mat3( viewMatrix ) ) * ( - viewPos );
		float dist = length( ray );
		vec3 dir = ray / max( dist, 1e-4 );
		float h0 = cameraPosition.y - uFogHeight;
		float k = uFogFalloff;
		float dy = ray.y;
		float integ = uFogDensity * exp( - k * h0 ) * dist;
		if ( abs( k * dy ) > 1e-3 ) integ *= ( 1.0 - exp( - k * dy ) ) / ( k * dy );
		float amt = 1.0 - exp( - max( integ, 0.0 ) );
		float s = max( dot( dir, uSunDir ), 0.0 );
		vec3 fc = mix( uFogColor, uFogSunColor, s * s * s * s * s * s );
		return mix( col, fc, amt );
	}
#endif
`;

export const FOG_FRAG = /* glsl */`
#ifdef USE_FOG
	gl_FragColor.rgb = wlApplyFog( gl_FragColor.rgb, vViewPosition );
#endif
`;

const WET_PARS = /* glsl */`
uniform float uWetness;
`;
// runs after normal_fragment_maps: normal (view space) is final
const WET_FRAG = /* glsl */`
#ifdef WL_WET
	{
		vec3 wN = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
		float up = smoothstep( 0.15, 0.85, wN.y );
		float wet = uWetness * ( 0.35 + 0.65 * up ) * WL_POROSITY;
		diffuseColor.rgb *= 1.0 - 0.42 * wet;
		roughnessFactor = mix( roughnessFactor, 0.14, wet * 0.85 );
	}
#endif
`;

// World-space wind after instancing. Needs attribute 'wind' (x = bend weight,
// y = flutter weight, z = phase) unless WL_WIND_HEIGHT is defined, in which case
// the bend weight comes from the vertex height (for GLB shrubs without attributes).
const WIND_PARS = /* glsl */`
uniform float uTime;
uniform vec4 uWind;
#ifndef WL_WIND_HEIGHT
	attribute vec3 wind;
#endif
vec3 wlWind( vec3 wp, vec3 local ) {
	#ifdef WL_WIND_HEIGHT
		float bend = clamp( local.y / WL_WIND_HEIGHT, 0.0, 1.0 );
		bend *= bend;
		vec3 w = vec3( bend, bend * 0.6, 0.0 );
	#else
		vec3 w = wind;
	#endif
	float ph = dot( wp.xz, vec2( 0.071, 0.053 ) ) + w.z;
	float gust = 0.55 + 0.45 * sin( uTime * 0.31 + wp.x * 0.012 ) * sin( uTime * 0.17 + wp.z * 0.009 + 1.3 );
	float s = uWind.z * ( 0.6 + uWind.w * gust );
	float sway = ( sin( uTime * 1.1 + ph ) * 0.6 + sin( uTime * 2.3 + ph * 1.7 ) * 0.25 + 0.35 ) * s;
	vec3 off = vec3( uWind.x, 0.0, uWind.y ) * sway * w.x * WL_WIND_AMP;
	float fl = sin( uTime * 7.3 + ph * 5.1 + wp.y * 2.0 ) * s * w.y * WL_FLUTTER;
	off += vec3( fl, fl * 0.4, fl * 0.8 );
	off.y -= length( off.xz ) * 0.25 * w.x;
	return wp + off;
}
`;

const WIND_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelMatrix * mvPosition;
mvPosition.xyz = wlWind( mvPosition.xyz, transformed );
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Adds shared fog / wetness / wind behaviour to a built-in lit material.
 * opts.wind: { amp, flutter, height? } enables wind (height -> derived weights).
 * opts.porosity: 0..1 how much rain darkens the surface (default 1).
 * opts.extra: optional (shader) => void for material-specific patches.
 * opts.key: extra cache key string when opts.extra differs between materials.
 */
export function enhance(mat, opts = {}) {
  const fog = opts.fog !== false;
  const wet = opts.wet !== false;
  const wind = opts.wind || null;
  const porosity = (opts.porosity ?? 1).toFixed(2);
  const key = `wl:${fog ? 1 : 0}:${wet ? porosity : 0}:${wind ? `${wind.amp}:${wind.flutter}:${wind.height || 0}` : 0}:${opts.key || ''}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    if (fog) {
      fs = fs.replace('#include <fog_pars_fragment>', FOG_PARS).replace('#include <fog_fragment>', FOG_FRAG);
    }
    if (wet) {
      fs = fs.replace('#include <common>', `#include <common>\n#define WL_WET\n#define WL_POROSITY ${porosity}\n${WET_PARS}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${WET_FRAG}`);
    }
    if (wind) {
      const defs = `#define WL_WIND_AMP ${wind.amp.toFixed(3)}\n#define WL_FLUTTER ${wind.flutter.toFixed(3)}\n${wind.height ? `#define WL_WIND_HEIGHT ${wind.height.toFixed(3)}\n` : ''}`;
      vs = vs.replace('#include <common>', `#include <common>\n${defs}${WIND_PARS}`).replace('#include <project_vertex>', WIND_PROJECT);
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    if (opts.extra) opts.extra(shader);
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}

/** Depth material for shadow casting that follows the same wind displacement. */
export function windDepthMaterial(wind, alphaMap = null, alphaTest = 0.5) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: alphaMap, alphaTest: alphaMap ? alphaTest : 0 });
  const defs = `#define WL_WIND_AMP ${wind.amp.toFixed(3)}\n#define WL_FLUTTER ${wind.flutter.toFixed(3)}\n${wind.height ? `#define WL_WIND_HEIGHT ${wind.height.toFixed(3)}\n` : ''}`;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defs}${WIND_PARS}`)
      .replace('#include <project_vertex>', WIND_PROJECT);
  };
  m.customProgramCacheKey = () => `wldepth:${wind.amp}:${wind.flutter}:${wind.height || 0}:${alphaMap ? 1 : 0}`;
  return m;
}

/** Walk a loaded glTF scene and enhance every lit material once. */
export function enhanceTree(root, opts = {}) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seen.has(m) || !(m.isMeshStandardMaterial)) continue;
      seen.add(m);
      enhance(m, opts);
    }
  });
}

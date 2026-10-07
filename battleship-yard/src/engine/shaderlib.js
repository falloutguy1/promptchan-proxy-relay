import * as THREE from 'three';
// GLSL snippets + helpers to extend MeshStandardMaterial without forking three's shaders.

export const GLSL_NOISE = /* glsl */ `
float bsy_hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float bsy_vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(bsy_hash12(i), bsy_hash12(i+vec2(1,0)), u.x), mix(bsy_hash12(i+vec2(0,1)), bsy_hash12(i+vec2(1,1)), u.x), u.y);
}
float bsy_fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*bsy_vnoise(p); p=p*2.03+vec2(17.1,9.7); a*=0.5; } return s; }
`;

/**
 * Injects world-space varyings and a weathering layer into a standard material:
 *  - macro: large-scale colour/roughness variation that breaks texture repetition
 *  - grime: darkening toward a ground plane (rain splash / dirt accumulation)
 *  - wetLine: darker, glossier band below a waterline height (tidal moisture, algae tint)
 */
export function weather(mat, o = {}) {
  const opts = {
    macro: 0.18, macroScale: 0.035, grimeHeight: 0, grimeRange: 0, grimeAmount: 0,
    wetLine: -1e4, wetRange: 1.0, algae: 0.0, paint: null, ...o,
  };
  mat.userData.weather = opts;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.uniforms.uMacro = { value: opts.macro };
    shader.uniforms.uMacroScale = { value: opts.macroScale };
    shader.uniforms.uGrime = { value: new Float32Array([opts.grimeHeight, opts.grimeRange, opts.grimeAmount]) };
    shader.uniforms.uWet = { value: new Float32Array([opts.wetLine, opts.wetRange, opts.algae]) };
    shader.uniforms.uPaintCol = { value: opts.paint ? new THREE.Color(opts.paint) : new THREE.Color(0, 0, 0) };
    shader.uniforms.uPaintOn = { value: opts.paint ? 1 : 0 };
    if (!shader.vertexShader.includes('vBsyWorld')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBsyWorld;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vBsyWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #ifdef USE_INSTANCING
            vBsyWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #endif`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBsyWorld;
        uniform float uMacro; uniform float uMacroScale; uniform vec3 uGrime; uniform vec3 uWet; uniform vec3 uPaintCol; uniform float uPaintOn;
        ${shader.fragmentShader.includes('bsy_hash12') ? '' : GLSL_NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        if (uPaintOn > 0.5) {
          // painted surface: the scan supplies relief and wear (luminance relative to its mean), paint supplies albedo
          vec3 bsyAvg = textureLod(map, vMapUv, 12.0).rgb;
          float bsyRel = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(dot(bsyAvg * diffuse, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
          diffuseColor.rgb = uPaintCol * clamp(mix(1.0, bsyRel, 0.6), 0.4, 1.6);
        }
        #endif
        float bsyM = bsy_fbm(vBsyWorld.xz * uMacroScale + vBsyWorld.y * 0.02);
        float bsyM2 = bsy_fbm(vBsyWorld.xz * uMacroScale * 5.3 + 3.1);
        diffuseColor.rgb *= 1.0 + uMacro * (bsyM - 0.5) * 2.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 1.0, 0.94), uMacro * (bsyM2 - 0.5) * 2.0);
        float bsyGrime = uGrime.z * (1.0 - smoothstep(uGrime.x, uGrime.x + uGrime.y, vBsyWorld.y)) * (0.6 + 0.8 * bsyM2);
        diffuseColor.rgb *= 1.0 - clamp(bsyGrime, 0.0, 0.8);
        float bsyWet = 1.0 - smoothstep(uWet.x - uWet.y * 0.3, uWet.x + uWet.y * (0.7 + 0.6 * bsyM2), vBsyWorld.y);
        diffuseColor.rgb *= 1.0 - 0.45 * bsyWet;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.12, 0.06), uWet.z * bsyWet * smoothstep(0.35, 0.7, bsyM2));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + uMacro * (bsyM - 0.5) * 1.5) - 0.35 * bsyWet, 0.04, 1.0);`);
  };
  const key = JSON.stringify(opts);
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + 'w';
  mat.userData.weatherKey = key;
  return mat;
}

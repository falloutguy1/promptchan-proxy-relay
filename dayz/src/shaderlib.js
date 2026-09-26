import * as THREE from 'three';

// Shared GLSL snippets and a small helper to stack onBeforeCompile patches.

export const NOISE_GLSL = /* glsl */ `
float dz_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float dz_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dz_hash12(i), dz_hash12(i + vec2(1, 0)), u.x),
             mix(dz_hash12(i + vec2(0, 1)), dz_hash12(i + vec2(1, 1)), u.x), u.y);
}
float dz_fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * dz_noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
// Gusts travel across the landscape in the wind direction.
float dz_gust(vec2 wp) {
  float t = uTime;
  vec2 q = wp * 0.045 - uWindDir * t * 0.35;
  return 0.55 + 0.45 * sin(q.x * 1.7 + q.y * 1.3) * sin(q.x * 0.61 - q.y * 0.83 + t * 0.21);
}
`;

export const shared = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindStrength: { value: 1 },
};

/**
 * patch(material, { uniforms, vertexHead, fragmentHead, vertex: [[find, replace]], fragment: [[find, replace]], key })
 * Replacements may reference the original chunk with '$&'.
 */
export function patch(material, spec) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, spec.uniforms || {});
    if (spec.vertexHead) shader.vertexShader = shader.vertexShader.replace('void main() {', spec.vertexHead + '\nvoid main() {');
    if (spec.fragmentHead) shader.fragmentShader = shader.fragmentShader.replace('void main() {', spec.fragmentHead + '\nvoid main() {');
    for (const c of spec.expand || []) {
      shader.fragmentShader = shader.fragmentShader.replace(`#include <${c}>`, THREE.ShaderChunk[c]);
    }
    for (const [a, b] of spec.vertex || []) {
      if (!shader.vertexShader.includes(a)) console.warn('patch: vertex chunk not found', a, material.name);
      shader.vertexShader = shader.vertexShader.replace(a, b);
    }
    for (const [a, b] of spec.fragment || []) {
      if (!shader.fragmentShader.includes(a)) console.warn('patch: fragment chunk not found', a, material.name);
      shader.fragmentShader = shader.fragmentShader.replace(a, b);
    }
    material.userData.shader = shader;
  };
  const key = spec.key || 'p';
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|' + key;
  return material;
}

/** Adds a world-position varying (vDzWorld) to a material. Idempotent. */
export function withWorldPos(material) {
  // flag lives on the instance (not userData) so clones, which drop onBeforeCompile, get re-patched
  if (material.__dzWorld) return material;
  material.__dzWorld = true;
  return patch(material, {
    key: 'wpos',
    vertexHead: 'varying vec3 vDzWorld;',
    fragmentHead: 'varying vec3 vDzWorld;',
    vertex: [['#include <project_vertex>', `$&
      {
        vec4 dzw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dzw = instanceMatrix * dzw;
        #endif
        vDzWorld = (modelMatrix * dzw).xyz;
      }`]],
  });
}

/**
 * Physically-motivated weathering for building surfaces:
 *  - large-scale tonal variation (breaks up tiling)
 *  - moisture/splash grime concentrated near the ground line
 *  - vertical run-off streaks below a height (window sills, eaves)
 */
export function weather(material, o = {}) {
  withWorldPos(material);
  const u = {
    uGroundY: { value: o.groundY ?? 0 },
    uGrimeH: { value: o.grimeHeight ?? 0.6 },
    uGrime: { value: o.grime ?? 0.35 },
    uMacro: { value: o.macro ?? 0.18 },
    uStreak: { value: o.streaks ?? 0.0 },
    uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
  };
  material.userData.weather = u;
  return patch(material, {
    key: 'weather',
    uniforms: u,
    fragmentHead: NOISE_GLSL + `
      uniform float uGroundY, uGrimeH, uGrime, uMacro, uStreak; uniform vec3 uTint;`,
    fragment: [['#include <map_fragment>', `$&
      {
        vec2 hp = vDzWorld.xz + vDzWorld.y * 0.37;
        float macro = dz_fbm(hp * 0.35 + vDzWorld.y * 0.2);
        diffuseColor.rgb *= uTint * mix(1.0 - uMacro, 1.0 + uMacro * 0.6, macro);
        float h = vDzWorld.y - uGroundY;
        float edge = uGrimeH * (0.7 + 0.6 * dz_noise(hp * 1.3));
        float grime = 1.0 - smoothstep(0.0, edge, h);
        diffuseColor.rgb *= 1.0 - uGrime * grime * (0.6 + 0.4 * dz_noise(hp * 9.0));
        float along = vDzWorld.x * 0.93 + vDzWorld.z * 1.07;
        float streak = smoothstep(0.55, 0.95, dz_noise(vec2(along * 5.0, vDzWorld.y * 0.35)))
                     * smoothstep(0.0, 1.2, dz_noise(vec2(along * 0.7, 3.1)) * 2.0 - 0.4);
        diffuseColor.rgb *= 1.0 - uStreak * streak;
      }`]],
  });
}

/**
 * Blend in a second scanned material where the first has failed physically:
 * fallen plaster exposing brickwork, concentrated in the splash zone near the
 * ground, at corners (uCorners) and in a few random patches higher up.
 * `second` = { map, normalMap, arm } textures; uvScale converts between scan sizes.
 */
export function damage(material, second, o = {}) {
  withWorldPos(material);
  const u = {
    tMap2: { value: second.map }, tNor2: { value: second.normalMap }, tArm2: { value: second.arm },
    uUv2: { value: o.uvScale ?? 1 }, uDmgGround: { value: o.groundY ?? 0 }, uDmgAmount: { value: o.amount ?? 0.5 },
  };
  return patch(material, {
    key: 'damage',
    uniforms: u,
    expand: ['roughnessmap_fragment', 'normal_fragment_maps', 'aomap_fragment'],
    fragmentHead: NOISE_GLSL.replace(/dz_/g, 'dm_') + `
      uniform sampler2D tMap2, tNor2, tArm2; uniform float uUv2, uDmgGround, uDmgAmount;
      float dzDamage = 0.0; vec2 dzUv2;`,
    fragment: [
      ['#include <map_fragment>', `$&
      {
        dzUv2 = vMapUv * uUv2 + vec2(0.31, 0.17);
        vec2 hp = vDzWorld.xz * 0.9 + vec2(vDzWorld.y * 0.83, vDzWorld.y * 0.61);
        float h = vDzWorld.y - uDmgGround;
        float n = dm_fbm(hp * 1.1 + vDzWorld.y * 0.9);
        float low = 1.0 - smoothstep(0.1, 1.3, h);
        float d = n + low * 0.42 * uDmgAmount * 2.0 - 0.62 + uDmgAmount * 0.12;
        // plaster breaks off with a crisp edge; a thin darker rim marks the broken lip
        dzDamage = smoothstep(0.0, 0.035, d);
        float rim = smoothstep(-0.03, 0.0, d) * (1.0 - dzDamage);
        vec3 brick = texture2D(tMap2, dzUv2).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.35 * rim), brick, dzDamage);
      }`],
      ['roughnessFactor *= texelRoughness.g;', 'roughnessFactor *= mix(texelRoughness.g, texture2D(tArm2, dzUv2).g, dzDamage);'],
      ['vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = mix(texture2D( normalMap, vNormalMapUv ).xyz, texture2D(tNor2, dzUv2).xyz, dzDamage) * 2.0 - 1.0;'],
      ['float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;',
        'float ambientOcclusion = ( mix(texture2D( aoMap, vAoMapUv ).r, texture2D(tArm2, dzUv2).r, dzDamage) - 1.0 ) * aoMapIntensity + 1.0;'],
    ],
  });
}

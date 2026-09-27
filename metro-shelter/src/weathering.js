// World-space weathering layered onto MeshStandardMaterial via onBeforeCompile:
//  - large-scale tonal variation (breaks up texture repetition)
//  - rising damp / grime band at the base of walls (darker, wetter = lower roughness)
//  - vertical water streaks running down from above (vaults, track walls)
//  - optional second, rotated sample of the albedo to hide tiling on big floors
import * as THREE from 'three';

function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const rnd = (() => { let s = 1337; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // Tileable value-noise lattices at several octaves.
  const lattice = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const octs = [4, 8, 16, 32, 64].map((n) => ({ n, a: lattice(n) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = ({ n, a }, u, v) => {
    const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const g = (i, j) => a[((j % n + n) % n) * n + ((i % n + n) % n)];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(g(x0, y0), g(x0 + 1, y0), fx), THREE.MathUtils.lerp(g(x0, y0 + 1), g(x0 + 1, y0 + 1), fx), fy);
  };
  const streak = lattice(64);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const low = sample(octs[0], u, v) * 0.55 + sample(octs[1], u, v) * 0.3 + sample(octs[2], u, v) * 0.15;
      const mid = sample(octs[2], u, v) * 0.5 + sample(octs[3], u, v) * 0.3 + sample(octs[4], u, v) * 0.2;
      // Streaks: noise varying fast across x, slowly down y.
      const sx = u * 64, s0 = Math.floor(sx), fx = smooth(sx - s0);
      const col = THREE.MathUtils.lerp(streak[s0 % 64], streak[(s0 + 1) % 64], fx);
      const st = Math.pow(col, 3) * (0.6 + 0.4 * sample(octs[1], u * 0.5, v));
      const i = (y * size + x) * 4;
      data[i] = low * 255; data[i + 1] = mid * 255; data[i + 2] = st * 255; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export const grimeTexture = makeNoiseTexture();

const DEFAULTS = {
  variation: 0.18,      // strength of large-scale tonal variation
  varScale: 0.08,       // 1/metres
  floorY: 0,            // world height of the floor the damp band rises from
  damp: 0.0,            // rising damp strength
  dampHeight: 0.6,      // metres
  streaks: 0.0,         // streak strength
  streakTop: 6,         // streaks fade in below this height
  detile: 0.0,          // blend of second rotated albedo sample
  tint: [1, 1, 1],      // dirt colour multiplier where grime applies
};

export function weather(mat, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const key = JSON.stringify(o);
  mat.customProgramCacheKey = () => key;
  mat.userData.weather = o;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grimeTexture };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn3 = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn3 = mat3(instanceMatrix) * wn3;
        #endif
        vWPos = (modelMatrix * wp4).xyz;
        vWNrm = normalize(mat3(modelMatrix) * wn3);`);
    const f = (n) => n.toFixed(4);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGrime;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float wDamp = 0.0;`)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          ${o.detile > 0 ? `{
            vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.43 + 0.37;
            vec4 alt = texture2D(map, ruv);
            float m = smoothstep(0.35, 0.65, texture2D(uGrime, vWPos.xz * 0.045).g);
            sampledDiffuseColor = mix(sampledDiffuseColor, alt, m * ${f(o.detile)});
          }` : ''}
          diffuseColor *= sampledDiffuseColor;
        #endif
        {
          vec3 an = abs(vWNrm);
          // Triplanar-ish coordinates in metres for the grime lookups.
          vec2 wc = an.y > 0.7 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
          float n1 = texture2D(uGrime, wc * ${f(o.varScale)}).r;
          float n2 = texture2D(uGrime, wc * 0.37).g;
          diffuseColor.rgb *= mix(1.0 - ${f(o.variation)}, 1.0 + ${f(o.variation * 0.5)}, n1);
          float h = vWPos.y - ${f(o.floorY)};
          wDamp = (1.0 - smoothstep(${f(o.dampHeight * 0.35)}, ${f(o.dampHeight)} * (0.7 + 0.6 * n1), h)) * ${f(o.damp)} * (1.0 - an.y * 0.6);
          float horiz = an.x > an.z ? vWPos.z : vWPos.x;
          float s = texture2D(uGrime, vec2(horiz * 0.55, vWPos.y * 0.035)).b;
          float streak = s * ${f(o.streaks)} * smoothstep(${f(o.streakTop)}, ${f(o.streakTop - 2.5)}, vWPos.y) * (1.0 - an.y);
          vec3 dirt = vec3(${o.tint.map(f).join(',')});
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * dirt * (0.55 + 0.2 * n2), clamp(wDamp + streak * 0.8, 0.0, 1.0));
          wDamp = max(wDamp, streak * 0.6);
        }`)
      // Normal maps are KTX2 UASTC in two-channel "normal mode" (X in RGB, Y in alpha): rebuild Z.
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec4 nTex = texture2D( normalMap, vNormalMapUv );
        vec3 mapN; mapN.xy = vec2(nTex.r, nTex.a) * 2.0 - 1.0;
        mapN.z = sqrt(max(0.0, 1.0 - dot(mapN.xy, mapN.xy)));`))
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, clamp(wDamp, 0.0, 1.0));`);
  };
  return mat;
}

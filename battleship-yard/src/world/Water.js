import * as THREE from 'three';
import { GLSL_WAVES } from './Waves.js';
import { GLSL_NOISE } from '../engine/shaderlib.js';
import { WORLD } from './layout.js';
import { LAYER_NO_AO } from '../engine/Renderer.js';

const MAX_WAKE = 40;
const MAX_SPLASH = 8;

/** Tileable detail-normal texture built from integer-frequency sine waves (periodic by construction). */
function makeDetailNormals(size = 256, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 48; i++) {
    const kx = Math.round((rnd() * 2 - 1) * (2 + i * 0.6)), kz = Math.round((rnd() * 2 - 1) * (2 + i * 0.6));
    if (!kx && !kz) continue;
    waves.push([kx, kz, rnd() * Math.PI * 2, 1 / Math.pow(Math.hypot(kx, kz), 1.35)]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dz = 0;
    const u = x / size, v = y / size;
    for (const [kx, kz, ph, a] of waves) {
      const c = Math.cos(2 * Math.PI * (kx * u + kz * v) + ph) * a * 2 * Math.PI;
      dx += kx * c; dz += kz * c;
    }
    const n = new THREE.Vector3(-dx * 0.012, 1, -dz * 0.012).normalize();
    const i = (y * size + x) * 4;
    data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.z * 0.5 + 0.5) * 255; data[i + 2] = n.y * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Radial grid, dense near the centre, follows the camera. */
function radialGrid(segments, rings, r0, rMax) {
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  const growth = Math.pow(rMax / r0, 1 / (rings - 1));
  for (let r = 0; r < rings; r++) {
    const rad = r0 * Math.pow(growth, r);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  for (let s = 0; s < segments; s++) idx.push(0, 1 + ((s + 1) % segments), 1 + s);
  for (let r = 0; r < rings - 1; r++) for (let s = 0; s < segments; s++) {
    const a = 1 + r * segments + s, b = 1 + r * segments + ((s + 1) % segments);
    const c = a + segments, d = b + segments;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax);
  return g;
}

export class Water {
  constructor(waves, terrain, sky) {
    this.waves = waves;
    this.terrain = terrain;
    this.sky = sky;
    this.time = 0;
    this.wake = new Float32Array(MAX_WAKE * 4); // x, z, age, width
    this.wakeHead = 0;
    this.splash = new Float32Array(MAX_SPLASH * 4); // x, z, age, radius
    this.splashHead = 0;
    this.ship = { pos: new THREE.Vector4(1e6, 1e6, 0, 0), dim: new THREE.Vector4(1, 1, 0, 0) };
  }

  build(quality) {
    const seg = quality.water;
    const geo = radialGrid(seg, Math.round(seg * 0.55), 0.6, 18000);
    this.uniforms = {
      uWaveA: { value: this.waves.uniform }, uWaveB: { value: this.waves.uniform2 },
      uTime: { value: 0 }, tDetail: { value: makeDetailNormals() },
      tHeight: { value: this.terrain.heightTexture() },
      uRect: { value: new THREE.Vector4(WORLD.x0, WORLD.z0, 1 / (WORLD.x1 - WORLD.x0), 1 / (WORLD.z1 - WORLD.z0)) },
      uGridSpacing: { value: (2 * Math.PI) / seg },
      uWake: { value: this.wake }, uSplash: { value: this.splash },
      uShip: { value: this.ship.pos }, uShipDim: { value: this.ship.dim },
      uSunDir: { value: this.sky.sunDir }, uSunColor: { value: this.sky.sun.color },
      uDeep: { value: new THREE.Color(0.010, 0.040, 0.050) }, uShallow: { value: new THREE.Color(0.05, 0.14, 0.12) },
      uSeabed: { value: new THREE.Color(0.32, 0.29, 0.22) },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, envMapIntensity: 1.0 });
    mat.name = 'water';
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          ${GLSL_WAVES}
          uniform float uGridSpacing;
          varying vec3 vWWorld; varying float vCrest; varying vec2 vRest;`)
        .replace('#include <begin_vertex>', `
          vec3 restW = (modelMatrix * vec4(position, 1.0)).xyz;
          float spacing = length(position.xz) * uGridSpacing + 0.3;
          float crest;
          vec3 disp = gerstner(restW.xz, spacing, crest);
          // waves die out over the shallows and against the quay
          vec2 hUV = (restW.xz - uRect.xy) * uRect.zw;
          float ground = (hUV.x > 0.0 && hUV.x < 1.0 && hUV.y > 0.0 && hUV.y < 1.0) ? texture2D(tHeight, hUV).r : -60.0;
          float damp = smoothstep(-0.5, -9.0, ground);
          disp *= mix(0.25, 1.0, damp);
          vec3 transformed = position + disp;
          vCrest = crest * damp; vRest = restW.xz;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
        .replace('#include <common>', '#include <common>\nuniform sampler2D tHeight; uniform vec4 uRect;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          ${GLSL_WAVES}
          ${GLSL_NOISE}
          #define MAX_WAKE ${MAX_WAKE}
          #define MAX_SPLASH ${MAX_SPLASH}
          uniform sampler2D tDetail; uniform sampler2D tHeight; uniform vec4 uRect;
          uniform vec4 uWake[MAX_WAKE]; uniform vec4 uSplash[MAX_SPLASH];
          uniform vec4 uShip; uniform vec4 uShipDim;
          uniform vec3 uSunDir; uniform vec3 uSunColor;
          uniform vec3 uDeep, uShallow, uSeabed;
          varying vec3 vWWorld; varying float vCrest; varying vec2 vRest;
          float wFoam; float wDepth; vec3 wN;`)
        .replace('#include <map_fragment>', `
          vec2 hUV = (vRest - uRect.xy) * uRect.zw;
          float ground = (hUV.x > 0.0 && hUV.x < 1.0 && hUV.y > 0.0 && hUV.y < 1.0) ? texture2D(tHeight, hUV).r : -60.0;
          wDepth = max(vWWorld.y - ground, 0.0);
          float camD = length(vWWorld - cameraPosition);
          float foot = camD * 0.0025 + 0.02;
          float damp = smoothstep(-0.5, -9.0, ground);
          wN = gerstnerNormal(vRest, foot / max(damp, 0.25));
          wN = normalize(mix(vec3(0.0, 1.0, 0.0), wN, mix(0.3, 1.0, damp)));
          // two scrolling detail layers (capillary/chop) fading with distance to avoid shimmer
          vec2 d1 = texture2D(tDetail, vRest / 7.0 + uTime * vec2(0.021, 0.034)).xy * 2.0 - 1.0;
          vec2 d2 = texture2D(tDetail, vRest / 19.0 - uTime * vec2(0.017, -0.011)).xy * 2.0 - 1.0;
          vec2 d3 = texture2D(tDetail, vRest / 61.0 + uTime * vec2(0.006, 0.009)).xy * 2.0 - 1.0;
          float dFade = 1.0 - smoothstep(60.0, 900.0, camD);
          wN = normalize(wN + vec3(d1.x + d2.x * 0.8, 0.0, d1.y + d2.y * 0.8) * 0.33 * dFade + vec3(d3.x, 0.0, d3.y) * 0.25);

          // ---- foam ----
          float n1 = bsy_fbm(vRest * 0.35 + uTime * 0.15), n2 = bsy_fbm(vRest * 1.7 - uTime * 0.3);
          float shore = (1.0 - smoothstep(0.0, 1.4 + n1 * 1.6, wDepth)) * smoothstep(0.25, 0.6, n2 + 0.2 * sin(uTime * 1.3 + wDepth * 4.0));
          float crestF = smoothstep(0.035, 0.085, vCrest + (n1 - 0.5) * 0.04) * smoothstep(0.35, 0.65, n2);
          // ship: hull contact foam, bow wave and wake trail
          vec2 rel = vRest - uShip.xy; float ch = cos(uShip.z), shh = sin(uShip.z);
          vec2 loc = vec2(dot(rel, vec2(shh, ch)), dot(rel, vec2(ch, -shh))); // x along ship, y across
          float hx = loc.x / (uShipDim.x * 0.5), hy = loc.y / (uShipDim.y * 0.5);
          float hullD = (pow(abs(hx), 6.0) + pow(abs(hy), 2.0));
          float hullFoam = (1.0 - smoothstep(1.0, 1.06 + uShip.w * 0.025, hullD)) * smoothstep(0.92, 1.0, hullD);
          float bow = smoothstep(0.55, 1.0, hx) * hullFoam * min(uShip.w * 0.1, 1.0);
          float wakeF = 0.0;
          for (int i = 0; i < MAX_WAKE; i++) {
            vec4 w = uWake[i];
            if (w.z <= 0.0) continue;
            float dd = length(vRest - w.xy);
            float wid = w.w;
            float ring = 1.0 - smoothstep(wid * 0.6, wid, dd);
            wakeF = max(wakeF, ring * (1.0 - w.z) * smoothstep(0.3, 0.7, n2 + 0.25));
          }
          for (int i = 0; i < MAX_SPLASH; i++) {
            vec4 s = uSplash[i];
            if (s.z <= 0.0) continue;
            float dd = length(vRest - s.xy);
            float r = s.w * (0.4 + s.z * 1.4);
            wakeF = max(wakeF, (1.0 - smoothstep(r * 0.5, r, dd)) * (1.0 - s.z) * smoothstep(0.25, 0.65, n2 + 0.2));
          }
          wFoam = clamp(max(max(shore, crestF * 0.8), max(hullFoam * (0.1 + 0.6 * min(uShip.w / 8.0, 1.0)) * smoothstep(0.35, 0.7, n2), max(bow, wakeF))), 0.0, 1.0);

          // ---- body colour: absorption with depth, seabed showing through in the shallows ----
          float vis = exp(-wDepth * 0.55);
          vec3 body = mix(uDeep, uShallow, exp(-wDepth * 0.09));
          body = mix(body, uSeabed * 0.55, vis * 0.85);
          diffuseColor.rgb = mix(body, vec3(0.82, 0.85, 0.86), wFoam);`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.035 + smoothstep(200.0, 4000.0, camD) * 0.05, 0.55, wFoam);`)
        .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // light scattered inside wave crests when looking toward the sun
          vec3 V = normalize(cameraPosition - vWWorld);
          float sss = pow(max(dot(-V, uSunDir) * 0.5 + 0.5, 0.0), 4.0) * clamp(vCrest * 6.0 + 0.15, 0.0, 1.0);
          totalEmissiveRadiance += vec3(0.02, 0.10, 0.09) * uSunColor * sss * 0.35 * (1.0 - wFoam);`);
    };
    mat.customProgramCacheKey = () => 'water';
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'water';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_NO_AO);
    this.mesh.renderOrder = -1;
    return this.mesh;
  }

  addWake(x, z, width) {
    const i = this.wakeHead++ % MAX_WAKE;
    this.wake.set([x, z, 0.0001, width], i * 4);
  }

  addSplash(x, z, radius) {
    const i = this.splashHead++ % MAX_SPLASH;
    this.splash.set([x, z, 0.0001, radius], i * 4);
  }

  update(dt, camera) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    // keep grid centred under the camera, snapped to the finest ring spacing
    const s = 0.6;
    this.mesh.position.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
    for (let i = 0; i < MAX_WAKE; i++) {
      const k = i * 4 + 2;
      if (this.wake[k] > 0) { this.wake[k] += dt / 40; this.wake[k + 1] += dt * 1.6; if (this.wake[k] >= 1) this.wake[k] = 0; }
    }
    for (let i = 0; i < MAX_SPLASH; i++) {
      const k = i * 4 + 2;
      if (this.splash[k] > 0) { this.splash[k] += dt / 9; if (this.splash[k] >= 1) this.splash[k] = 0; }
    }
  }
}

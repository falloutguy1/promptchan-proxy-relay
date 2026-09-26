import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { fbm3, smooth, noise3, clamp } from './util.js';
import { GLSL_NOISE, U } from './materials.js';

export const SUN_DIR = new THREE.Vector3(-0.78, 0.44, 0.22).normalize();
export const SKY = { zenith: new THREE.Color('#4d6a86'), horizon: new THREE.Color('#aab7bd'), haze: new THREE.Color('#9eabb0') };

// ------------------------------------------------------------------ terrain height
let mounds = [];
export function setMounds(m) { mounds = m; }
export function sandH(x, z) {
  const dx = (x - 8) / 78, dz = (z + 30) / 34;
  let h = 1.15 * Math.exp(-(dx * dx + dz * dz)) - 0.48;
  h += 0.28 * Math.exp(-Math.pow((x + 30) / 38, 2) - Math.pow((z - 22) / 9, 2));          // sand spit
  const warp = fbm3(x * 0.012, 0.3, z * 0.012, 3) * 6;
  h += 0.09 * Math.sin(x * 0.07 + z * 0.19 + warp) * smooth(-10, 30, z);      // bars in the shallows
  h += fbm3(x * 0.02, 0.7, z * 0.02, 4) * 0.5 + fbm3(x * 0.09, 1.9, z * 0.09, 3) * 0.1;
  const r = Math.hypot((x - 8) / 1.25, z + 30);
  h -= 3.2 * smooth(95, 280, r);
  for (const m of mounds) {
    // distance to segment
    const px = x - m.a.x, pz = z - m.a.z, bx = m.b.x - m.a.x, bz = m.b.z - m.a.z;
    const t = clamp((px * bx + pz * bz) / (bx * bx + bz * bz), 0, 1);
    const d = Math.hypot(px - bx * t, pz - bz * t);
    h += m.h * Math.exp(-Math.pow(Math.max(0, d - m.w) / m.fall, 2)) * (0.75 + 0.5 * noise3(x * 0.1, 5, z * 0.1));
  }
  return h;
}

// ------------------------------------------------------------------ sky dome
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: U.time, uSun: { value: SUN_DIR }, uZen: { value: SKY.zenith }, uHor: { value: SKY.horizon }, uHaze: { value: SKY.haze } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: GLSL_NOISE + `
      uniform float uTime; uniform vec3 uSun, uZen, uHor, uHaze; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(uHor, uZen, pow(smoothstep(-0.02, 0.75, y), 0.65));
        // darker overcast bank on the far side, like the reference
        float bank = smoothstep(0.05, 0.5, y) * (0.55 + 0.45*d.x);
        col = mix(col, uZen*0.72, bank*0.35);
        // soft cloud layers
        vec2 cp = d.xz / (y + 0.12) * 1.6 + vec2(uTime*0.004, uTime*0.0015);
        float c = fbmv(vec3(cp*0.8, 1.0)); float c2 = fbmv(vec3(cp*2.5 + 7.0, 2.0));
        float cl = smoothstep(0.42, 0.8, c*0.75 + c2*0.35) * smoothstep(0.0, 0.18, y);
        col = mix(col, mix(uHor*1.06, uZen*0.9, 0.35), cl*0.55);
        float wisp = smoothstep(0.55, 0.9, fbmv(vec3(d.x*3.0/(y+0.2) + uTime*0.003, d.z*14.0/(y+0.2), 3.0)));
        col += vec3(0.05,0.055,0.06)*wisp*smoothstep(0.02,0.2,y);
        // sun glow (sun is behind haze)
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0,0.9,0.78) * (pow(s, 6.0)*0.12 + pow(s, 64.0)*0.25);
        // below horizon: sea haze
        col = mix(col, uHaze, smoothstep(0.02, -0.03, y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ------------------------------------------------------------------ terrain
export const TERR = { cx: 0, cz: -40, size: 1100 };
export function makeTerrain(sand, seg = 340) {
  const g = new THREE.PlaneGeometry(1, 1, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let u = p.getX(i) * 2, v = p.getZ(i) * 2; // -1..1
    const f = (a) => Math.sign(a) * Math.pow(Math.abs(a), 1.9);
    const x = TERR.cx + f(u) * TERR.size / 2 + 15, z = TERR.cz + f(v) * TERR.size / 2 + 30;
    p.setXYZ(i, x, sandH(x, z), z);
    uv.setXY(i, x / 6, z / 6);
  }
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: sand.map, normalMap: sand.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.92, metalness: 0, envMapIntensity: 1.0 });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = 'varying vec3 vWp;\n' + s.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix*vec4(transformed,1.0)).xyz;');
    s.fragmentShader = 'varying vec3 vWp;\n' + GLSL_NOISE + s.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 sA = texture2D(map, vMapUv);
        vec4 sB = texture2D(map, vMapUv*0.173 + 0.31);
        vec3 sc = mix(sA.rgb, sB.rgb, 0.45);
        float big = fbmv(vec3(vWp.xz*0.035, 0.5));
        sc *= mix(vec3(0.92,0.9,0.92), vec3(1.07,1.03,0.98), big);
        float h = vWp.y;
        float wet = 1.0 - smoothstep(0.02, 0.55 + 0.25*big, h);
        float damp = 1.0 - smoothstep(0.3, 1.4, h);
        sc *= mix(vec3(1.0), vec3(0.83,0.8,0.8), damp);
        sc *= mix(vec3(1.0), vec3(0.58,0.56,0.58), wet);
        // tide lines
        float tl = smoothstep(0.02,0.0, abs(h - 0.22 - big*0.12)) * 0.25;
        sc = mix(sc, vec3(0.45,0.38,0.3), tl);
        diffuseColor.rgb *= sc;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = mix(0.93, 0.18, wet*wet);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), wet*0.55));`);
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.castShadow = false;
  return m;
}

// ------------------------------------------------------------------ water with planar reflections
export function makeWater(renderer, refl = 0.5) {
  // bake sand heights for depth-aware shading
  const N = 512, data = new Float32Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = TERR.cx - 600 + (i + 0.5) / N * 1200, z = TERR.cz - 600 + (j + 0.5) / N * 1200;
    data[(j * N + i) * 4] = sandH(x, z);
  }
  const ht = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
  ht.magFilter = THREE.LinearFilter; ht.minFilter = THREE.LinearFilter; ht.needsUpdate = true;
  const floatLinear = renderer.extensions.has('OES_texture_float_linear');
  if (!floatLinear) { ht.magFilter = ht.minFilter = THREE.NearestFilter; }

  const shader = {
    name: 'ShoreWater',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      tHeight: { value: null }, uTime: { value: 0 }, uSun: { value: SUN_DIR },
      uTerr: { value: new THREE.Vector3(TERR.cx - 600, TERR.cz - 600, 1200) },
      uDeep: { value: new THREE.Color('#2f4a52') }, uShallow: { value: new THREE.Color('#7f8f86') },
    }]),
    vertexShader: `
      uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vUv = textureMatrix*vec4(position,1.0); vW = (modelMatrix*vec4(position,1.0)).xyz;
        vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: GLSL_NOISE + `
      uniform sampler2D tDiffuse, tHeight; uniform float uTime; uniform vec3 uSun, uTerr, uDeep, uShallow; uniform vec3 color;
      varying vec4 vUv; varying vec3 vW;
      #include <fog_pars_fragment>
      float wh(vec2 p){
        float t = uTime;
        return vn(vec3(p*0.22 + vec2(t*0.05, t*0.03), t*0.1))*1.0 + vn(vec3(p*0.61 - vec2(t*0.09,-t*0.04), t*0.17))*0.5
             + vn(vec3(p*1.7 + vec2(t*0.13, t*0.11), t*0.3))*0.22 + vn(vec3(p*4.3 - vec2(0.0,t*0.25), t*0.5))*0.08;
      }
      void main(){
        vec2 tuv = (vW.xz - uTerr.xy)/uTerr.z;
        float h = (tuv.x<0.0||tuv.y<0.0||tuv.x>1.0||tuv.y>1.0) ? -6.0 : texture2D(tHeight, tuv).r;
        float depth = max(0.0, -h);
        float dist = length(cameraPosition - vW);
        float e = 0.06;
        float amp = mix(0.35, 1.0, smoothstep(0.0, 2.0, depth)) / (1.0 + dist*0.004);
        float h0 = wh(vW.xz);
        vec3 N = normalize(vec3(-(wh(vW.xz+vec2(e,0.0))-h0)/e*amp*0.35, 1.0, -(wh(vW.xz+vec2(0.0,e))-h0)/e*amp*0.35));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec4 ru = vUv; ru.xy += N.xz * ru.w * 0.035;
        vec3 refl = texture2DProj(tDiffuse, ru).rgb;
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 3.5, depth));
        // shoreline foam
        float fn = fbmv(vec3(vW.xz*0.45, uTime*0.15));
        float wave = sin(depth*38.0 - uTime*1.3 + fn*6.0);
        float foam = smoothstep(0.55, 1.0, wave) * (1.0 - smoothstep(0.0, 0.14, depth)) * smoothstep(0.35, 0.65, fn);
        foam += (1.0 - smoothstep(0.0, 0.025, depth)) * 0.5 * smoothstep(0.4, 0.7, fbmv(vec3(vW.xz*1.3, uTime*0.3)));
        vec3 R = reflect(-V, N);
        float spec = pow(max(dot(R, uSun), 0.0), 220.0) * 1.6 + pow(max(dot(R, uSun), 0.0), 18.0)*0.06;
        float a = mix(0.06, 0.96, smoothstep(0.0, 2.8, depth));
        a = max(a, fres * 0.95);
        vec3 col = mix(body, refl, clamp(fres*1.05, 0.0, 1.0));
        col = mix(col, vec3(0.92,0.93,0.9), foam*0.8);
        col += vec3(1.0,0.95,0.85) * spec;
        a = clamp(a + foam*0.7 + spec*0.5, 0.0, 1.0) * smoothstep(0.0, 0.012, depth);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  };
  const size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
  const water = new Reflector(new THREE.PlaneGeometry(9000, 9000), {
    shader, textureWidth: Math.max(256, size.x * refl), textureHeight: Math.max(256, size.y * refl), clipBias: 0.002, multisample: 0,
  });
  water.rotation.x = -Math.PI / 2; water.position.y = 0;
  const mat = water.material;
  mat.transparent = true; mat.depthWrite = false; mat.fog = true;
  mat.uniforms.tHeight.value = ht;
  mat.uniforms.uTime = U.time;
  water.renderOrder = 2;
  return water;
}

// ------------------------------------------------------------------ distant coast
export function makeDistantLand() {
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#8a8c86', roughness: 1, metalness: 0 });
  const strips = [
    { x0: -2600, x1: -300, z: -1500, h: 26 },
    { x0: 700, x1: 2600, z: -1900, h: 40 },
    { x0: -2800, x1: -900, z: -700, h: 14 },
  ];
  for (const s of strips) {
    const nx = 160, g = new THREE.BufferGeometry(), ps = [], ix = [];
    for (let i = 0; i <= nx; i++) {
      const x = s.x0 + (s.x1 - s.x0) * i / nx;
      const env = Math.sin(Math.PI * i / nx) ** 0.5;
      const hh = s.h * env * (0.55 + 0.6 * (fbm3(x * 0.004, s.z, 0.2, 4) + 0.5)) + (fbm3(x * 0.05, 1, s.z, 2) > 0.2 ? 5 : 0) * env;
      ps.push(x, -3, s.z, x, hh, s.z + 30);
    }
    for (let i = 0; i < nx; i++) { const a = i * 2; ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3)); g.setIndex(ix); g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, mat));
  }
  return grp;
}

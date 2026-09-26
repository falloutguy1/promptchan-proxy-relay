import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { SKY_GLSL, atmo } from './sky.js';

function makeNormalMap(size = 512, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const waves = [];
  for (let i = 0; i < 44; i++) {
    const ang = rnd() * Math.PI * 2;
    const k = 2 + Math.floor(Math.pow(rnd(), 1.6) * 34);
    const kx = Math.round(Math.cos(ang) * k), ky = Math.round(Math.sin(ang) * k);
    if (kx === 0 && ky === 0) continue;
    const kk = Math.hypot(kx, ky);
    waves.push([kx, ky, 1 / Math.pow(kk, 1.35), rnd() * Math.PI * 2]);
  }
  const h = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  // separable-ish evaluation: precompute per-row/col sin/cos
  for (const [kx, ky, a, ph] of waves) {
    const cx = new Float32Array(size), sx = new Float32Array(size), cy = new Float32Array(size), sy = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      cx[i] = Math.cos((TAU * kx * i) / size); sx[i] = Math.sin((TAU * kx * i) / size);
      cy[i] = Math.cos((TAU * ky * i) / size + ph); sy[i] = Math.sin((TAU * ky * i) / size + ph);
    }
    for (let y = 0; y < size; y++) {
      const o = y * size, c1 = cy[y], s1 = sy[y];
      for (let x = 0; x < size; x++) {
        // sin(ax + b) with peaked crest shaping
        const v = sx[x] * c1 + cx[x] * s1;
        h[o + x] += a * (v - 0.25 * v * v);
      }
    }
  }
  const data = new Uint8Array(size * size * 4);
  const sc = 7.0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
    const dx = (h[y * size + xr] - h[y * size + xl]) * sc;
    const dy = (h[yd * size + x] - h[yu * size + x]) * sc;
    const L = Math.hypot(dx, dy, 1);
    const o = (y * size + x) * 4;
    data[o] = ((-dx / L) * 0.5 + 0.5) * 255;
    data[o + 1] = ((-dy / L) * 0.5 + 0.5) * 255;
    data[o + 2] = ((1 / L) * 0.5 + 0.5) * 255;
    data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */`
uniform mat4 textureMatrix;
varying vec4 vMirror;
varying vec3 vWorld;
#include <common>
#include <shadowmap_pars_vertex>
void main(){
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  vMirror = textureMatrix * worldPosition;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <shadowmap_vertex>
}`;

const FRAG = NOISE + SKY_GLSL + /* glsl */`
uniform sampler2D tReflect;
uniform sampler2D tNormal;
uniform float uTime;
uniform float uSpeed;
uniform vec3 uEye;
uniform vec3 uDeep;
uniform vec3 uScatter;
uniform float uFogDen;
uniform float uSpecI;
uniform float uReflect;
uniform vec2 uCamRight;
uniform vec2 uCamFwd;
varying vec4 vMirror;
varying vec3 vWorld;
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

float bowTipX(){ return 171.0; }
float shipHW(float x){
  float w = 21.0;
  float xs = 62.0, tip = 171.0;
  if (x > xs) { float t = clamp((x - xs) / (tip - xs), 0.0, 1.0); w = 21.0 * pow(max(0.0, 1.0 - pow(t, 1.95)), 0.88); }
  if (x < -163.0) { float d = -163.0 - x; w = min(w, 14.0 + sqrt(max(0.0, 49.0 - d * d))); }
  if (x < -170.0 || x > tip) w = -1.0;
  return w;
}

vec3 sampleN(vec2 uv){ return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

void main(){
  vec3 wp = vWorld;
  vec3 toEye = uEye - wp;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  float t = uTime;
  vec2 q = wp.xz + vec2(t * uSpeed, 0.0);

  // ---- ship-relative wake masks
  float hw = shipHW(wp.x);
  float az = abs(wp.z);
  float sgn = sign(wp.z);
  float dz = hw > 0.0 ? az - hw : 1e3;
  float db = -168.0 - wp.x;                     // distance behind the stern
  float dbp = max(db, 0.0);
  float edgeN = vnoise(vec2(q.x * 0.012, sgn * 5.0 + 1.0));
  float wakeW = (15.0 + dbp * 0.075) * (0.74 + 0.5 * edgeN + 0.12 * vnoise(q * 0.05));
  float inWake = db > 0.0 ? 1.0 - smoothstep(wakeW * 0.5, wakeW, az) : 0.0;
  inWake *= smoothstep(-2.0, 6.0, db);
  float wakeAge = exp(-dbp / 650.0);
  float bowArm = abs(az - (171.0 - wp.x) * 0.36 - 1.5);
  float armLen = clamp((171.0 - wp.x) / 330.0, 0.0, 1.0);
  float kelvin = db > 0.0 ? abs(az - (21.0 + dbp * 0.34)) : 1e3;

  // ---- normals
  float nFade = mix(1.0, 0.4, smoothstep(250.0, 4000.0, dist));
  vec3 n = sampleN(q / 41.0 + vec2(t * 0.011, t * 0.017)) * 1.0
         + sampleN(q / 23.0 + vec2(-t * 0.017, t * 0.009)) * 0.8
         + sampleN(q / 173.0 + vec2(t * 0.004, -t * 0.005)) * 1.2
         + sampleN(q / 7.7 + vec2(-t * 0.03, -t * 0.024)) * 0.45;
  float nearHull = 1.0 - smoothstep(0.0, 16.0, dz);
  float chop = 1.0 + 1.6 * inWake * wakeAge + 1.2 * nearHull + 0.9 * (1.0 - smoothstep(0.0, 7.0, bowArm)) * (1.0 - armLen);
  n.xy *= nFade * 0.78 * chop;
  vec3 N = normalize(vec3(n.x, n.z, n.y));
  vec3 nl = sampleN(q / 173.0 + vec2(t * 0.004, -t * 0.005)) * 1.2 + sampleN(q / 41.0 + vec2(t * 0.011, t * 0.017)) * 0.7;
  vec2 NL = nl.xy * nFade * chop;

  // ---- foam
  float fn = fbm3(q * 0.085);
  float streak = fbm3(q * vec2(0.035, 0.16) + vec2(0.0, sgn * 3.0));
  float fd = vnoise(q * 0.55 + vec2(t * 0.2, 0.0)) * 0.6 + vnoise(q * 1.9) * 0.4;
  float hullW = 1.2 + 6.0 * smoothstep(125.0, 170.0, wp.x) + 5.0 * smoothstep(-100.0, -170.0, wp.x);
  float hull = hw > 0.0 ? (1.0 - smoothstep(0.0, hullW, dz)) * step(-0.5, dz) : 0.0;
  float bw = (1.0 - smoothstep(0.0, 2.5 + 9.0 * armLen, bowArm)) * pow(1.0 - armLen, 1.5) * step(wp.x, 172.0) * smoothstep(0.3, 0.6, vnoise(q * 0.06 + 2.0) + 0.25 * (1.0 - armLen));
  float wash = exp(-dbp / 140.0);
  float wakeF = inWake * (wash * 0.9 + wakeAge * smoothstep(0.42, 0.72, streak) * 0.9);
  float kel = (1.0 - smoothstep(0.0, 2.0 + dbp * 0.01, kelvin)) * exp(-dbp / 420.0) * 0.42 * step(0.0, db) * smoothstep(0.4, 0.75, vnoise(q * 0.035 + 7.0)) * (0.6 + 0.4 * vnoise(q * 0.3));
  float mask = max(max(hull, bw * 0.85), max(wakeF, kel));
  float foam = smoothstep(0.32, 0.85, mask * (0.5 + 0.7 * fn) + fd * 0.35 * mask);
  foam *= mix(1.0, 0.7, smoothstep(1500.0, 4000.0, dist));
  float aerated = inWake * exp(-dbp / 1100.0) + hull * 0.5 + bw * 0.3;

  // ---- reflection
  float cosT = clamp(dot(V, N), 0.0, 1.0);
  float F = (0.02 + 0.98 * pow(1.0 - cosT, 5.0)) * 0.82;
  float k = 0.0012 + 7.0 / (dist + 60.0);
  vec2 distort = vec2(dot(NL, uCamRight) * 0.35, dot(NL, uCamFwd) * 1.1) * k;
  float bias = 0.6 + 1.6 * smoothstep(80.0, 1400.0, dist);
  vec3 refl = texture2D(tReflect, vMirror.xy / vMirror.w + distort, bias).rgb;
  vec3 skyR = skyGradient(reflect(-V, N));
  refl = mix(skyR, refl, uReflect);

  // ---- body colour + subsurface
  float shadow = getShadowMask();
  float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
  vec3 body = uDeep * (0.35 + 0.65 * sunUp);
  float sss = pow(clamp(dot(V, -vec3(uSunDir.x, 0.0, uSunDir.z)) * 0.5 + 0.5, 0.0, 1.0), 3.0) * clamp(1.0 - N.y + 0.15, 0.0, 1.0);
  body += uScatter * (0.25 + 1.4 * sss) * sunUp * mix(0.45, 1.0, shadow);
  body = mix(body, uScatter * 1.6 + vec3(0.02, 0.06, 0.07), clamp(aerated, 0.0, 1.0) * 0.55 * sunUp);
  vec3 col = mix(body, refl, F);

  // ---- sun glint
  vec3 H = normalize(V + uSunDir);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 1400.0) * 90.0 + pow(nh, 160.0) * 2.2 + pow(nh, 24.0) * 0.08;
  col += uSunCol * spec * uSpecI * shadow * step(0.0, uSunDir.y);

  // ---- foam shading
  vec3 foamCol = vec3(0.88, 0.92, 0.95) * (uSunCol * max(uSunDir.y, 0.0) * 1.3 * mix(0.45, 1.0, shadow) * (1.0 - 0.8 * uNightAmt) + uZenith * 0.6 + uHorizon * 0.35);
  foamCol = max(foamCol, vec3(0.012, 0.016, 0.024));
  col = mix(col, foamCol, foam * 0.92);

  // ---- horizon haze
  vec3 hd = normalize(vec3(-V.x, 0.0, -V.z));
  vec3 hz = skyGradient(vec3(hd.x, 0.0005, hd.z));
  float fog = 1.0 - exp(-pow(dist * uFogDen, 1.35));
  col = mix(col, hz, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createWater({ type = THREE.HalfFloatType } = {}) {
  const normal = makeNormalMap(512);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
    tReflect: { value: null }, tNormal: { value: null }, textureMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 }, uSpeed: { value: 9.0 }, uEye: { value: new THREE.Vector3() },
    uDeep: { value: new THREE.Color() }, uScatter: { value: new THREE.Color() }, uFogDen: { value: 0.0001 },
    uSpecI: { value: 1 }, uReflect: { value: 1 }, uCamRight: { value: new THREE.Vector2(1, 0) }, uCamFwd: { value: new THREE.Vector2(0, 1) },
  }]);
  Object.assign(uniforms, atmo);
  uniforms.tNormal.value = normal;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, lights: true });
  const geo = new THREE.PlaneGeometry(80000, 80000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const rt = new THREE.WebGLRenderTarget(512, 512, { type, samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  uniforms.tReflect.value = rt.texture;
  const mirrorCam = new THREE.PerspectiveCamera();
  mirrorCam.layers.set(0);
  const textureMatrix = uniforms.textureMatrix.value;

  const mirrorPlane = new THREE.Plane(), normalV = new THREE.Vector3(0, 1, 0), mirrorWorld = new THREE.Vector3();
  const camWorld = new THREE.Vector3(), rot = new THREE.Matrix4(), lookAt = new THREE.Vector3(), clipPlane = new THREE.Vector4();
  const view = new THREE.Vector3(), target = new THREE.Vector3(), qv = new THREE.Vector4();

  function renderReflection(renderer, scene, camera) {
    mirrorWorld.set(0, 0, 0);
    camWorld.setFromMatrixPosition(camera.matrixWorld);
    normalV.set(0, 1, 0);
    view.subVectors(mirrorWorld, camWorld);
    if (view.dot(normalV) > 0) return;
    view.reflect(normalV).negate(); view.add(mirrorWorld);
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camWorld);
    target.subVectors(mirrorWorld, lookAt); target.reflect(normalV).negate(); target.add(mirrorWorld);
    mirrorCam.position.copy(view);
    mirrorCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normalV);
    mirrorCam.lookAt(target);
    mirrorCam.far = camera.far; mirrorCam.near = camera.near;
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCam.projectionMatrix);
    textureMatrix.multiply(mirrorCam.matrixWorldInverse);
    mirrorPlane.setFromNormalAndCoplanarPoint(normalV, mirrorWorld);
    mirrorPlane.applyMatrix4(mirrorCam.matrixWorldInverse);
    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const pm = mirrorCam.projectionMatrix;
    qv.x = (Math.sign(clipPlane.x) + pm.elements[8]) / pm.elements[0];
    qv.y = (Math.sign(clipPlane.y) + pm.elements[9]) / pm.elements[5];
    qv.z = -1.0;
    qv.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(qv));
    pm.elements[2] = clipPlane.x; pm.elements[6] = clipPlane.y; pm.elements[10] = clipPlane.z + 1.0; pm.elements[14] = clipPlane.w;
    uniforms.uEye.value.copy(camWorld);
    const e = camera.matrixWorld.elements;
    uniforms.uCamRight.value.set(e[0], e[2]).normalize();
    uniforms.uCamFwd.value.set(-e[8], -e[10]).normalize();

    const prevRT = renderer.getRenderTarget();
    mesh.visible = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, mirrorCam);
    renderer.setRenderTarget(prevRT);
    mesh.visible = true;
  }

  function setSize(w, h) { rt.setSize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h))); }
  return { mesh, uniforms, renderReflection, setSize, rt };
}

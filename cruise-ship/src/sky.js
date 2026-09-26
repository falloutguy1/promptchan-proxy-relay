import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Shared atmosphere uniforms (sky dome, water horizon, fog colour)
export const atmo = {
  uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.7).normalize() },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uGlowPow: { value: 6 },
  uCloud: { value: 0.5 },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
  uNightAmt: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.4, 0.5, 0.6).normalize() },
  uSkyTime: { value: 0 },
  uSunDisk: { value: 1 },
  tCloud: { value: null },
  uCloudT: { value: 0.6 },
  uCloudSun: { value: 1.3 },
  uCloudTile: { value: 36000 },
};

export const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir, uZenith, uHorizon, uGround, uGlow, uSunCol, uCloudLit, uCloudShade, uMoonDir;
uniform float uGlowPow, uCloud, uNightAmt, uSkyTime, uSunDisk;
vec3 skyGradient(vec3 d){
  float h = d.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  float sd = max(dot(normalize(vec3(d.x, max(d.y, 0.0), d.z)), uSunDir), 0.0);
  float band = 1.0 - smoothstep(0.0, 0.55, max(h, 0.0));
  col += uGlow * pow(sd, uGlowPow) * (0.35 + 0.65 * band);
  col += uGlow * 0.25 * pow(sd, 1.5) * band;
  vec3 below = mix(uHorizon, uGround, smoothstep(0.0, -0.08, h));
  return h < 0.0 ? below : col;
}
`;

const SKY_FRAG = NOISE + SKY_GLSL + /* glsl */`
varying vec3 vDir;
uniform sampler2D tCloud;
uniform float uCloudT, uCloudSun, uCloudTile;
vec2 cGX, cGY; float cT0;
float cf(vec2 xz, float lod){ float k = lod; return textureGrad(tCloud, xz / uCloudTile, cGX * k, cGY * k).r; }
// cumulus: coarse search for the cloud surface, bisection, then a short fine integration
const float HB = 1250.0, HT = 3300.0;
float cdenC(vec3 p, vec2 wind, float lod){
  float h = (p.y - HB) / (HT - HB);
  return cf(p.xz + wind, lod) - uCloudT - 0.42 * h * h;
}
float nAmp1, nAmp2;
float cdenS(vec3 p, vec2 wind, float lod, float amp){
  vec2 xz = p.xz + wind;
  float h = (p.y - HB) / (HT - HB);
  return cf(xz, lod) - uCloudT - 0.42 * h * h + (vnoise((xz + p.y * 0.9) / 120.0) - 0.5) * 0.06 * nAmp1;
}
float cden(vec3 p, vec2 wind, float lod, float amp){
  vec2 xz = p.xz + wind;
  return cdenS(p, wind, lod, amp) + (vnoise((xz - p.y * 0.7) / 37.0) - 0.5) * 0.022 * nAmp2;
}
vec4 cumulus(vec3 d){
  vec2 uvb = d.xz * (HB / max(d.y, 0.0035)) / uCloudTile;
  cGX = dFdx(uvb); cGY = dFdy(uvb);
  float gmax = 4.0 / 2048.0;
  if (length(cGX) > gmax) cGX *= gmax / length(cGX);
  if (length(cGY) > gmax) cGY *= gmax / length(cGY);
  if (d.y < 0.0035) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = HB / d.y;
  cT0 = t0;
  if (t0 > 95000.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t1 = min(HT / d.y, t0 + 9000.0);
  vec2 wind = vec2(uSkyTime * 2.2, uSkyTime * 0.8);
  float lod = 1.0;
  float amp = 1.0;
  float foot = t0 * 0.0011 / max(d.y, 0.01);
  nAmp1 = 1.0 - smoothstep(35.0, 130.0, foot);
  nAmp2 = 1.0 - smoothstep(10.0, 40.0, foot);
  // adaptive search on the smooth field (conservative threshold), no jitter
  float t = t0, te = -1.0;
  float minStep = 18.0 + t0 * 0.0005;
  for (int i = 0; i < 56; i++) {
    if (t > t1) break;
    float dd = cdenC(d * t, wind, t / t0) + 0.055;
    if (dd > 0.0) { te = t; break; }
    t += clamp(-dd * 1500.0, minStep, 650.0);
  }
  if (te < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float a = max(t0, te - minStep);
  float cosT = dot(d, uSunDir);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.25;
  vec3 L = vec3(0.0); float T = 1.0;
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float st = 20.0 + t0 * 0.0008;
  t = a + ign * st * 0.8;
  for (int j = 0; j < 11; j++) {
    vec3 p = d * (t + st * 0.5);
    lod = (t + st * 0.5) / t0;
    float den = cden(p, wind, lod, amp);
    if (den > 0.0) {
      float h = clamp((p.y - HB) / (HT - HB), 0.0, 1.0);
      float o1 = cdenC(p + uSunDir * 150.0, wind, lod);
      float o2 = cdenC(p + uSunDir * 480.0, wind, lod);
      float occ = exp(-(max(o1, 0.0) * 10.0 + max(o2, 0.0) * 7.0));
      vec3 amb = mix(uCloudShade, uCloudLit * 0.92, smoothstep(0.0, 0.7, h));
      vec3 S = amb * 0.6 + uSunCol * uCloudSun * occ * (0.5 + 1.7 * hg);
      float al = 1.0 - exp(-den * 0.03 * st);
      L += T * al * S;
      T *= 1.0 - al;
      if (T < 0.02) break;
    }
    t += st; st *= 1.33;
  }
  float haze = 1.0 - exp(-t0 / 30000.0);
  vec3 hz = skyGradient(vec3(d.x, 0.02, d.z));
  L = mix(L, hz * (1.0 - T), haze * 0.9);
  float fade = smoothstep(0.0035, 0.02, d.y) * (1.0 - 0.55 * smoothstep(30000.0, 85000.0, t0));
  return vec4(L * fade, mix(1.0, T, fade));
}
// faint high cirrus for texture
vec4 cirrus(vec3 d){
  if (d.y < 0.02) return vec4(0.0);
  vec2 uv = d.xz * (9000.0 / d.y) / 16000.0 + vec2(uSkyTime * 0.0015, 0.0);
  float n = fbm5(uv * vec2(1.0, 3.2) + fbm3(uv * 2.0) * 0.8);
  float a = smoothstep(0.55, 0.85, n) * 0.28 * smoothstep(0.02, 0.25, d.y);
  vec3 c = mix(uCloudLit, uSunCol, 0.25) * 0.95;
  return vec4(c, a);
}
vec3 stars(vec3 d){
  float th = atan(d.z, d.x);
  float ph = asin(clamp(d.y, -1.0, 1.0));
  vec2 g = vec2(th, ph) * 190.0;
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float h = hash12(id);
  vec2 o = (hash22(id) - 0.5) * 0.6;
  float r = length(f - o);
  float on = step(0.972, h);
  float tw = 0.75 + 0.25 * sin(uSkyTime * (1.5 + h * 3.0) + h * 40.0);
  float b = on * smoothstep(0.16, 0.0, r) * (h - 0.972) / 0.028 * tw;
  vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash12(id + 3.1));
  return sc * b * 2.2 * smoothstep(0.0, 0.2, d.y);
}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyGradient(d);
  float sd = dot(d, uSunDir);
  // sun disk + halo
  float disk = smoothstep(0.99985, 0.99992, sd);
  col += uSunCol * disk * 40.0 * uSunDisk * step(0.0, d.y + 0.01);
  col += uSunCol * pow(max(sd, 0.0), 900.0) * 3.0 * uSunDisk;
  col += uSunCol * pow(max(sd, 0.0), 60.0) * 0.25 * uSunDisk;
  // night
  if (uNightAmt > 0.001) {
    col += stars(d) * uNightAmt;
    float md = dot(d, uMoonDir);
    float mdisk = smoothstep(0.99990, 0.99994, md);
    vec2 mp = (d.xy - uMoonDir.xy) * 900.0;
    float maria = 0.8 + 0.2 * vnoise(mp * 0.5 + 3.0);
    col += vec3(1.0, 0.97, 0.9) * mdisk * 7.0 * maria * uNightAmt;
    col += vec3(0.5, 0.6, 0.8) * pow(max(md, 0.0), 700.0) * 0.8 * uNightAmt;
    col += vec3(0.25, 0.32, 0.5) * pow(max(md, 0.0), 30.0) * 0.12 * uNightAmt;
  }
  vec4 ci = cirrus(d);
  col = mix(col, ci.rgb, ci.a * uCloud);
  vec4 cu = cumulus(d);
  col = col * cu.a + cu.rgb;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky() {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: atmo,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = position;
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

const dir = (elDeg, x, z) => {
  const el = (elDeg * Math.PI) / 180; const L = Math.hypot(x, z);
  return new THREE.Vector3((Math.cos(el) * x) / L, Math.sin(el), (Math.cos(el) * z) / L);
};
const col = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export const MOODS = [
  { // bright tropical day
    sunDir: dir(52, -0.3, 1.0), sunCol: col(0xfff3e2, 1.0), sunI: 4.6,
    zenith: col(0x1a55c8, 0.95), horizon: col(0xa9c8ea, 1.0), ground: col(0x44698c, 0.9),
    glow: col(0xfff0da, 0.3), glowPow: 5, cloud: 0.34, cloudLit: col(0xffffff, 1.25), cloudShade: col(0x8a9ab4, 0.85), cloudSun: 1.5,
    night: 0, sunDisk: 1,
    hemiSky: col(0xbcd6ff), hemiGround: col(0x2a3e52), hemiI: 0.08,
    envI: 0.55, exposure: 0.92, fog: 0.000075,
    deep: col(0x06325f), scatter: col(0x138393, 1.0), specI: 1.0, bloom: 0.32,
  },
  { // golden hour
    sunDir: dir(4.0, -0.25, 1.0), sunCol: col(0xffa257, 1.0), sunI: 3.6,
    zenith: col(0x1a2a78, 0.95), horizon: col(0xa987b0, 0.9), ground: col(0x23284a, 0.9),
    glow: col(0xff7a2a, 2.6), glowPow: 7.0, cloud: 0.3, cloudLit: col(0xd99aa8, 0.75), cloudShade: col(0x3b3d6e, 0.7), cloudSun: 2.1,
    night: 0.05, sunDisk: 1,
    hemiSky: col(0x8a86c8), hemiGround: col(0x3a2a34), hemiI: 0.1,
    envI: 0.7, exposure: 0.98, fog: 0.00011,
    deep: col(0x0a1a3c), scatter: col(0x3d3a5a, 0.7), specI: 1.3, bloom: 0.42,
  },
  { // moonlit night
    sunDir: dir(34, 0.62, 0.78), sunCol: col(0x9fb4ff, 1.0), sunI: 0.42,
    zenith: col(0x020612, 1.0), horizon: col(0x10203a, 1.0), ground: col(0x050b16, 1.0),
    glow: col(0x2a3e66, 0.2), glowPow: 3, cloud: 0.22, cloudLit: col(0x121a2a, 0.8), cloudShade: col(0x05080f, 1.0), cloudSun: 0.22,
    night: 1, sunDisk: 0,
    hemiSky: col(0x3a5080), hemiGround: col(0x06080c), hemiI: 0.55,
    envI: 1.4, exposure: 1.1, fog: 0.00012,
    deep: col(0x010612), scatter: col(0x06202a, 0.6), specI: 0.4, bloom: 0.55,
  },
];

export function lerpMood(a, b, t, out) {
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  out.sunDir = a.sunDir.clone().lerp(b.sunDir, t).normalize();
  for (const k of ['sunCol', 'zenith', 'horizon', 'ground', 'glow', 'cloudLit', 'cloudShade', 'hemiSky', 'hemiGround', 'deep', 'scatter']) out[k] = a[k].clone().lerp(b[k], t);
  for (const k of ['sunI', 'glowPow', 'cloud', 'cloudSun', 'night', 'sunDisk', 'hemiI', 'envI', 'exposure', 'fog', 'specI', 'bloom']) out[k] = L(k);
  return out;
}

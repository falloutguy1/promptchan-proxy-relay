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
  tSkyA: { value: null },
  tSkyB: { value: null },
  uSkyMix: { value: 0 },
  uSkyRot: { value: 0 },
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

// Cloud field, evaluated only by the sky baker (skybake.js).
export const CLOUD_GLSL = /* glsl */`
uniform sampler2D tCloud;
uniform highp sampler3D tNoise3;
uniform float uCloudSun, uCloudTile, uCloudP, uPA;
// Sphere-traced cumulus: each cell of a jittered grid may hold one flat-based cloud built from a
// smooth union of an ellipsoid body and puffs, displaced by tileable 3D billow noise.
const float CS = 2400.0;
const float CS2 = 1500.0;
const float HB = 1150.0;
const float HT = 3000.0;
// layer 0: large cumulus on a 2400 m grid; layer 1: small fair-weather puffs on an offset 1500 m grid
vec4 cellCloud(vec2 cid, float L){
  float cs = L < 0.5 ? CS : CS2;
  vec2 off = L < 0.5 ? vec2(0.0) : vec2(700.0, 1130.0);
  float h = hash12(cid * 0.7131 + vec2(11.3, 5.7) + L * 17.0);
  vec2 cc = (cid + 0.5) * cs + off;
  float cluster = textureLod(tCloud, cc / uCloudTile, 1.0).g;
  float prob = uCloudP * (L < 0.5 ? (0.08 + 1.5 * smoothstep(0.34, 0.64, cluster)) : (0.12 + 0.7 * smoothstep(0.3, 0.6, cluster)));
  if (h > prob) return vec4(0.0, 0.0, 0.0, -1.0);
  vec2 o = hash22(cid + 4.1 + L * 9.0);
  float R = L < 0.5 ? mix(220.0, 900.0, pow(hash12(cid + 9.7), 2.0)) : mix(90.0, 380.0, pow(hash12(cid + 3.3), 1.6));
  float m = cs * 0.5 - 1.6 * R;
  return vec4(cc + (o - 0.5) * 2.0 * m, R, h * 97.0 + 1.0 + L * 500.0);
}
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdEll(vec3 p, vec3 r){ float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
float cloudSDF(vec3 p, vec4 cc){
  float R = cc.z;
  vec3 c0 = vec3(cc.x, HB + 0.52 * R, cc.y);
  float d = sdEll(p - c0, vec3(1.3 * R, 0.7 * R, 1.1 * R));
  for (int k = 0; k < 4; k++) {
    vec2 hk = hash22(vec2(cc.w, float(k) * 3.7 + 1.3));
    float an = hk.x * 6.2832;
    float rr = R * (0.38 + 0.3 * hash12(vec2(cc.w + 7.0, float(k))));
    float spread = k == 0 ? 0.15 : 0.62;
    float up = R * (k == 0 ? 0.95 : 0.3 + 0.5 * hk.y);
    vec3 ck = c0 + vec3(cos(an) * R * spread, up, sin(an) * R * spread * 0.85);
    d = smin(d, length(p - ck) - rr, R * 0.24);
  }
  float n = texture(tNoise3, vec3(p.x + cc.w * 31.0, p.y * 1.15, p.z) / (R * 2.6)).r;
  float n2 = texture(tNoise3, vec3(p.z - cc.w * 17.0, p.y * 1.2, p.x) / (R * 0.9)).r;
  d += (0.52 - n) * R * 0.24 + (0.5 - n2) * R * 0.06;
  return -smin(-d, p.y - HB, R * 0.22); // smooth max: flat base with a rounded rim
}
vec4 cumulus(vec3 d){
  if (d.y < 0.004) return vec4(0.0, 0.0, 0.0, 1.0);
  float t = HB / d.y;
  if (t > 95000.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float tEnd = min(HT / d.y, t + 16000.0);
  vec3 wofs = vec3(uSkyTime * 2.2, 0.0, uSkyTime * 0.8);
  float PA = uPA; // angular size of one baked texel
  float hitT = -1.0; vec4 hitC = vec4(0.0);
  float nearA = 0.0;
  for (int i = 0; i < 96; i++) {
    vec3 p = d * t + wofs;
    float stepT = 1e6;
    for (int L = 0; L < 2; L++) {
      float fl = float(L);
      float cs = L == 0 ? CS : CS2;
      vec2 off = L == 0 ? vec2(0.0) : vec2(700.0, 1130.0);
      vec2 q = p.xz - off;
      vec2 cid = floor(q / cs);
      vec2 lo = cid * cs, hi = lo + cs;
      float tx = d.x > 0.0 ? (hi.x - q.x) / max(d.x, 1e-6) : (lo.x - q.x) / min(d.x, -1e-6);
      float tz = d.z > 0.0 ? (hi.y - q.y) / max(d.z, 1e-6) : (lo.y - q.y) / min(d.z, -1e-6);
      float st = min(tx, tz) + 1.5;
      vec4 cc = cellCloud(cid, fl);
      if (cc.w > 0.0) {
        float sd = cloudSDF(p, cc);
        float eps = t * PA * 0.5;
        if (sd < eps) { hitT = t; hitC = cc; }
        nearA = max(nearA, 1.0 - sd / (t * PA * 3.2));
        st = min(st, max(sd * 0.72, eps));
      }
      stepT = min(stepT, st);
    }
    if (hitT > 0.0) break;
    t += stepT;
    if (t > tEnd) break;
  }
  vec3 col; float alpha;
  float dist = hitT > 0.0 ? hitT : t;
  if (hitT > 0.0) {
    vec3 p = d * hitT + wofs;
    float R = hitC.z;
    float e = max(hitT * PA, R * 0.03);
    vec2 k = vec2(1.0, -1.0);
    vec3 n = normalize(k.xyy * cloudSDF(p + k.xyy * e, hitC) + k.yyx * cloudSDF(p + k.yyx * e, hitC)
                     + k.yxy * cloudSDF(p + k.yxy * e, hitC) + k.xxx * cloudSDF(p + k.xxx * e, hitC));
    float sh = 1.0, sl = R * 0.1;
    for (int j = 0; j < 5; j++) { float sd = cloudSDF(p + uSunDir * sl, hitC); sh = min(sh, clamp(3.0 * sd / sl + 0.15, 0.0, 1.0)); sl += R * 0.24; }
    float h = clamp((p.y - HB) / (1.9 * R), 0.0, 1.0);
    float ndl = dot(n, uSunDir);
    float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
    vec3 amb = mix(uCloudShade, uCloudLit * 0.95, clamp(n.y * 0.5 + 0.5, 0.0, 1.0) * 0.65 + h * 0.35);
    amb *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, R * 0.45, p.y - HB));
    float cosT = dot(d, uSunDir);
    float rim = pow(1.0 - clamp(dot(n, -d), 0.0, 1.0), 3.0) * pow(max(cosT, 0.0), 3.0);
    col = amb * 0.55 + uSunCol * uCloudSun * (wrap * mix(0.25, 1.0, sh) * 0.85 + rim * 1.4);
    alpha = 1.0;
  } else {
    col = mix(uCloudShade, uCloudLit, 0.75);
    alpha = smoothstep(0.0, 1.0, clamp(nearA, 0.0, 1.0)) * 0.8;
  }
  float haze = 1.0 - exp(-dist / 32000.0);
  col = mix(col, skyGradient(vec3(d.x, 0.02, d.z)), haze * 0.85);
  alpha *= smoothstep(0.004, 0.02, d.y) * (1.0 - 0.45 * smoothstep(40000.0, 95000.0, dist));
  return vec4(col * alpha, 1.0 - alpha);
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
`;

const SKY_FRAG = NOISE + SKY_GLSL + /* glsl */`
varying vec3 vDir;
uniform sampler2D tSkyA, tSkyB;
uniform float uSkyMix, uSkyRot;
// Baked clouds: rgb = sqrt(premultiplied colour / 4), a = transmittance, over the upper hemisphere
// (u = azimuth, v = sqrt(elevation / 90deg)).
// Cubic B-spline filtering from four bilinear taps: smooth when the bake is magnified.
vec4 texCubic(sampler2D t, vec2 uv, vec2 gx, vec2 gy){
  vec2 size = vec2(textureSize(t, 0));
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 p0 = (i - 0.5 + w1 / g0) / size, p1 = (i + 1.5 + w3 / g1) / size;
  return (textureGrad(t, vec2(p0.x, p0.y), gx, gy) * g0.x + textureGrad(t, vec2(p1.x, p0.y), gx, gy) * g1.x) * g0.y
       + (textureGrad(t, vec2(p0.x, p1.y), gx, gy) * g0.x + textureGrad(t, vec2(p1.x, p1.y), gx, gy) * g1.x) * g1.y;
}
vec4 bakedClouds(vec3 d){
  if (d.y <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float u = fract(atan(d.z, d.x) * 0.15915494 + uSkyRot);
  float v = sqrt(asin(min(d.y, 1.0)) * 0.63661977);
  vec2 uv = vec2(u, v);
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5); gy.x -= floor(gy.x + 0.5);
  gx.x = clamp(gx.x, -0.004, 0.004); gy.x = clamp(gy.x, -0.004, 0.004);
  vec4 a = texCubic(tSkyA, uv, gx, gy);
  vec3 ca = a.rgb * a.rgb * 4.0;
  if (uSkyMix <= 0.0) return vec4(ca, a.a);
  vec4 b = texCubic(tSkyB, uv, gx, gy);
  vec3 cb = b.rgb * b.rgb * 4.0;
  return vec4(mix(ca, cb, uSkyMix), mix(a.a, b.a, uSkyMix));
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
  vec4 cl = bakedClouds(d);
  col = col * cl.a + cl.rgb;
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
    glow: col(0x2a3e66, 0.2), glowPow: 3, cloud: 0.22, cloudLit: col(0x0d1420, 0.8), cloudShade: col(0x04060b, 1.0), cloudSun: 0.09,
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

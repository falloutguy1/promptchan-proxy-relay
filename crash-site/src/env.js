import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NOISE, BUMP } from './glsl.js';

export const envUniforms = {
  uTime: { value: 0 },
  uFlash: { value: 0 },
  uFlashDir: { value: new THREE.Vector3(0.3, 0.5, 1).normalize() },
  uGrassQ: { value: 1 },
};
export const FOG_COLOR = new THREE.Color(0.30, 0.325, 0.34);
export const WIND = new THREE.Vector2(-1, 0.32).normalize();

// ---------------------------------------------------------------------------
// deterministic JS noise (terrain heights & placement)
// ---------------------------------------------------------------------------
let seed = 90210;
export const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function h2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vn(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz), b = h2(ix + 1, iz), c = h2(ix, iz + 1), d = h2(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x, z) { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vn(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.2; a *= 0.5; } return s / 0.9375; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function terrainH(x, z) {
  const r = Math.hypot(x, z);
  let h = (fbm(x * 0.011 + 3, z * 0.011) - 0.5) * 7 * sstep(12, 60, r);
  h += (vn(x * 0.13, z * 0.13) - 0.5) * 0.14;
  h += sstep(160, 420, r) * 14 * fbm(x * 0.004, z * 0.004);
  return h;
}

// dirt track + crash scar (identical in GLSL below)
function segD(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az; const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(px - ax - abx * t, pz - az - abz * t);
}
export function dirtMask(x, z) {
  const c = 9 + 3.5 * Math.sin(x * 0.045) + 1.2 * Math.sin(x * 0.13 + 1.0);
  const w = 1.5 + 0.6 * Math.sin(x * 0.07) + 0.25 * Math.sin(x * 0.9 + z);
  const track = 1 - sstep(w * 0.55, w, Math.abs(z - c));
  const scar = 1 - sstep(1.2, 2.6 + 0.6 * Math.sin(x * 1.3) * Math.sin(z * 1.7), segD(x, z, 6.5, -0.8, 16, -2.6));
  const scar2 = 1 - sstep(0.8, 2.0 + 0.5 * Math.sin(x * 1.1 + z * 2.1), segD(x, z, 7.8, 1.9, 13, 3.2));
  return Math.max(track, scar * 0.95, scar2 * 0.8);
}
const DIRT_GLSL = /* glsl */ `
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
float dirtMask(vec2 p){
  float c = 9. + 3.5 * sin(p.x * .045) + 1.2 * sin(p.x * .13 + 1.);
  float w = 1.5 + .6 * sin(p.x * .07) + .25 * sin(p.x * .9 + p.y);
  float track = 1. - smoothstep(w * .55, w, abs(p.y - c));
  float scar = 1. - smoothstep(1.2, 2.6 + .6 * sin(p.x * 1.3) * sin(p.y * 1.7), segD(p, vec2(6.5, -.8), vec2(16., -2.6)));
  float scar2 = 1. - smoothstep(.8, 2.0 + .5 * sin(p.x * 1.1 + p.y * 2.1), segD(p, vec2(7.8, 1.9), vec2(13., 3.2)));
  return max(track, max(scar * .95, scar2 * .8));
}
`;

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------
const SKY_FRAG = /* glsl */ `
uniform float uTime; uniform float uFlash; uniform vec3 uFlashDir; uniform float uEnv; uniform vec3 uFog;
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  float el = d.y;
  float az = atan(d.x, d.z);
  vec2 uv = d.xz / (max(el, 0.) + .1);
  vec2 wind = vec2(-.018, .006) * uTime;
  vec2 q = uv * .55 + wind;
  vec2 warp = vec2(fbm2(q * .7 + wind * .5), fbm2(q * .7 + 5.2 - wind * .5));
  float c = fbm2(q * 1.1 + warp * 1.8);
  float c2 = fbm2(q * 3.1 + warp * 2.4 + 3.1 + wind * 2.);
  float dens = smoothstep(.3, .8, c * .8 + c2 * .32);
  float shade = fbm2(q * 1.1 + warp * 1.8 + vec2(.06, .09));
  float lit = clamp((c - shade) * 4. + .5, 0., 1.);

  vec3 top = vec3(.045, .05, .056), mid = vec3(.15, .165, .18);
  vec3 col = mix(uFog * 1.05, mid, smoothstep(.0, .22, el));
  col = mix(col, top, smoothstep(.18, .75, el));
  vec3 cDark = vec3(.035, .038, .043), cLit = vec3(.34, .36, .39);
  vec3 cc = mix(cDark, cLit, lit * .55 + (1. - dens) * .25) * (1. - .45 * smoothstep(.25, .8, el));
  col = mix(col, cc, dens * smoothstep(-.02, .1, el) * .92);
  // brighter break in the cloud deck, low and to the left
  float brk = exp(-pow((az - .75) / .55, 2.)) * exp(-pow((el - .05) / .07, 2.));
  col += vec3(.32, .34, .36) * brk * (1. - dens * .5);
  // shelf cloud ridge
  float ridge = exp(-pow((el - .09 - .03 * sin(az * 2.)) / .025, 2.)) * smoothstep(.2, .9, fbm2(vec2(az * 5., 1.) + wind));
  col += vec3(.12, .13, .14) * ridge * smoothstep(-.4, .9, az);
  // rain shafts hanging from the deck
  float shaft = smoothstep(.45, .8, fbm2(vec2(az * 7. + uTime * .01, 3.)));
  col = mix(col, uFog * .85, shaft * smoothstep(.3, .0, el) * .55);
  col = mix(col, uFog, smoothstep(.07, -.01, el));
  // lightning
  float fl = uFlash * (.35 + dens) * (.35 + .65 * pow(max(dot(d, uFlashDir), 0.), 3.));
  col += fl * vec3(.55, .6, .75);
  if(uEnv > .5) col = mix(col, vec3(.02, .025, .016), smoothstep(.0, -.12, el));
  gl_FragColor = vec4(col, 1.);
}`;

export function makeSky(env = false) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: envUniforms.uTime, uFlash: envUniforms.uFlash, uFlashDir: envUniforms.uFlashDir, uEnv: { value: env ? 1 : 0 }, uFog: { value: FOG_COLOR.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), mat);
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
export function makeTerrain(occ) {
  const N = 360, S = 700;
  const pos = [], idx = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const u = i / N * 2 - 1, v = j / N * 2 - 1;
    const x = Math.sign(u) * Math.pow(Math.abs(u), 2.2) * S, z = Math.sign(v) * Math.pow(Math.abs(v), 2.2) * S;
    pos.push(x, terrainH(x, z) - 0.02 * dirtMask(x, z), z);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = envUniforms.uTime;
    s.uniforms.uOcc = { value: occ };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.)).xyz;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform vec4 uOcc[4]; varying vec3 vW;
      ${NOISE}
      ${BUMP}
      ${DIRT_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec2 wp = vW.xz;
      float r = length(wp);
      float n1 = fbm2(wp * .07), n2 = fbm2(wp * .9), n3 = vnoise2(wp * 6.);
      vec3 under = vec3(.018, .028, .011) * (.7 + .6 * n2);
      vec3 meadow = mix(vec3(.045, .062, .022), vec3(.075, .075, .034), n1);
      meadow = mix(meadow, vec3(.035, .05, .02), smoothstep(.55, .8, fbm2(wp * .02 + 3.)));
      vec3 gcol = mix(under, meadow, smoothstep(30., 70., r));
      float dm = dirtMask(wp) * smoothstep(.2, .6, n2 + .25);
      vec3 mudC = mix(vec3(.05, .04, .028), vec3(.085, .068, .045), n2) * (.8 + .4 * n3);
      float puddle = dm * smoothstep(.62, .68, fbm2(wp * .33 + 7.));
      vec3 gc = mix(gcol, mudC, dm);
      float gr = mix(.88, .5, dm);
      gc = mix(gc, vec3(.015, .018, .02), puddle);
      gr = mix(gr, .03, puddle);
      float gh = .02 * n3 * dm * (1. - puddle) + .01 * n2;
      // rain ripples in puddles
      vec2 rv = voronoi2(wp * 4. );
      float ring = sin((rv.x - fract(uTime * 1.3 + hash12(floor(wp * 4.))) ) * 40.) * smoothstep(.35, .0, rv.x);
      gh += puddle * .0015 * ring;
      // contact darkening under wreck parts
      float ao = 1.;
      for(int i = 0; i < 4; i++){
        vec2 a = uOcc[i].xy; vec2 b = uOcc[i].zw;
        float rr = i == 0 ? 1.4 : .45;
        float dd = segD(wp, a, b) - rr;
        ao *= mix(.35, 1., smoothstep(-.4, 2.2, dd));
      }
      gc *= ao;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = gc;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gr;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturbBump(-vViewPosition, normal, gh, faceDirection);');
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Grass: chunked instanced clumps with distance LOD, wind, wetness
// ---------------------------------------------------------------------------
function clumpGeometry(nBlades, withStalk, wide) {
  const P = [], W = [], T = [], ST = [], N = [], idx = [];
  const segs = wide ? 3 : 4;
  const addBlade = (bx, bz, H, Wd, lean, leanDir, faceDir, stalk) => {
    const base = P.length / 3;
    const lx = Math.cos(leanDir), lz = Math.sin(leanDir);
    const sx = Math.cos(faceDir), sz = Math.sin(faceDir);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const x = bx + lx * lean * H * Math.pow(t, 1.7), z = bz + lz * lean * H * Math.pow(t, 1.7), y = H * t * (1 - 0.12 * lean * t);
      let w = Wd * (1 - Math.pow(t, stalk ? 3.0 : 1.35));
      if (stalk) w = Wd * (t > 0.72 ? 3.2 * Math.sin((t - 0.72) / 0.28 * Math.PI) + 0.6 : 0.6);
      if (k === segs && !stalk) w = 0;
      // blade normal: perpendicular to face direction, tilted by lean
      const nx = -sz, nz = sx;
      for (const sgn of [-1, 1]) {
        P.push(x, y, z); W.push(sx * w * sgn, 0, sz * w * sgn); T.push(t); ST.push(stalk ? 1 : 0);
        N.push(nx + lx * 0.3, 0.4, nz + lz * 0.3);
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  for (let i = 0; i < nBlades; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.16;
    addBlade(Math.cos(a) * r, Math.sin(a) * r, 0.5 + rand() * 0.55, (wide ? 0.06 : 0.022) + rand() * 0.018, 0.1 + rand() * 0.45, a + (rand() - 0.5), rand() * Math.PI, false);
  }
  if (withStalk) addBlade(0.02, -0.03, 1.05 + rand() * 0.25, 0.006, 0.12, rand() * 6, rand() * 3, true);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWid', new THREE.Float32BufferAttribute(W, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(T, 1));
  g.setAttribute('aStalk', new THREE.Float32BufferAttribute(ST, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(idx);
  return g;
}

function grassMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = envUniforms.uTime;
    s.uniforms.uWind = { value: WIND };
    s.uniforms.uWiden = { value: 1 };
    mat.userData.shader = s;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform vec2 uWind; uniform float uWiden;
      attribute vec3 aWid; attribute float aT; attribute float aStalk;
      attribute vec4 aInst; attribute vec4 aVar;
      varying float vT; varying vec4 vVar; varying float vStalk;
      ${NOISE}`)
      .replace('#include <beginnormal_vertex>', `
      float cy = cos(aInst.w), sy = sin(aInst.w);
      vec3 objectNormal = normalize(normal);
      objectNormal = vec3(cy * objectNormal.x - sy * objectNormal.z, objectNormal.y, sy * objectNormal.x + cy * objectNormal.z);
      objectNormal = normalize(mix(objectNormal, vec3(0., 1., 0.), .55));`)
      .replace('#include <begin_vertex>', `
      float sc = aVar.x * (1. - .55 * aVar.w);
      float dcam = distance(cameraPosition.xz, aInst.xz);
      float widen = uWiden * (1. + clamp((dcam - 10.) / 30., 0., 2.5) * (1. - aStalk));
      vec3 transformed = position * vec3(aVar.x, sc, aVar.x) + aWid * widen;
      transformed = vec3(cy * transformed.x - sy * transformed.z, transformed.y, sy * transformed.x + cy * transformed.z);
      float gust = vnoise2(aInst.xz * .06 - uWind * uTime * .9);
      float bend = (.16 + .6 * gust * gust + .07 * sin(uTime * 5.1 + aInst.x * 1.7 + aInst.z * 2.3)) * aT * aT;
      transformed.xz += uWind * bend * sc * .75 + vec2(sin(uTime * 7. + aInst.z * 5.), cos(uTime * 6.3 + aInst.x * 4.)) * .012 * aT;
      transformed.y -= bend * bend * sc * .3;
      transformed += aInst.xyz;
      vT = aT; vVar = aVar; vStalk = aStalk;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
      varying float vT; varying vec4 vVar; varying float vStalk;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 rootC = vec3(.008, .014, .005);
      vec3 tipC = mix(vec3(.05, .095, .022), vec3(.10, .12, .035), fract(vVar.y * 7.));
      tipC = mix(tipC, vec3(.16, .14, .065), vVar.z);
      vec3 gc = mix(rootC, tipC, smoothstep(0., .85, vT));
      if(vStalk > .5){
        gc = mix(vec3(.03, .045, .016), vec3(.08, .07, .038), smoothstep(.6, .8, vT));
        float fsel = fract(vVar.y * 13.);
        if(vT > .9 && fsel > .96) gc = fsel > .98 ? vec3(.3, .23, .02) : vec3(.11, .04, .13);
      }
      gc *= .55 + .45 * (1. - vVar.w);
      diffuseColor.rgb = gc;`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  return mat;
}

export function makeGrass(occluders) {
  const CH = 10, R = 80, MAXN = 1700;
  const geoHi = clumpGeometry(7, true, false);
  const geoLo = clumpGeometry(3, true, true);
  const mat = grassMaterial();
  const group = new THREE.Group();
  const chunks = [];
  const occD = (x, z) => {
    let m = 99;
    for (const o of occluders) m = Math.min(m, segD(x, z, o[0], o[1], o[2], o[3]) - o[4]);
    return m;
  };
  for (let cz = -R; cz < R; cz += CH) for (let cx = -R; cx < R; cx += CH) {
    const inst = new Float32Array(MAXN * 4), vari = new Float32Array(MAXN * 4);
    let n = 0;
    for (let k = 0; k < MAXN * 1.15 && n < MAXN; k++) {
      const x = cx + rand() * CH, z = cz + rand() * CH;
      const dm = dirtMask(x, z);
      if (dm > 0.45 + rand() * 0.3) continue;
      const od = occD(x, z);
      if (od < 0.05) continue;
      const patch = fbm(x * 0.09, z * 0.09);
      if (patch < 0.3 && rand() < 0.5) continue;
      const flat = Math.max(0, 1 - od / 1.6) * 0.8 + dm * 0.6;
      inst.set([x, terrainH(x, z) - 0.04, z, rand() * Math.PI * 2], n * 4);
      const scale = (0.75 + 0.55 * patch + rand() * 0.35) * (1 - 0.35 * dm);
      vari.set([scale, rand(), Math.max(0, fbm(x * 0.05 + 9, z * 0.05) - 0.45) * 2 * rand(), Math.min(1, flat)], n * 4);
      n++;
    }
    const aInst = new THREE.InstancedBufferAttribute(inst, 4), aVar = new THREE.InstancedBufferAttribute(vari, 4);
    const center = new THREE.Vector3(cx + CH / 2, terrainH(cx + CH / 2, cz + CH / 2), cz + CH / 2);
    const mk = (base) => {
      const g = new THREE.InstancedBufferGeometry();
      for (const k of Object.keys(base.attributes)) g.setAttribute(k, base.attributes[k]);
      g.setIndex(base.index);
      g.setAttribute('aInst', aInst); g.setAttribute('aVar', aVar);
      g.instanceCount = n;
      g.boundingSphere = new THREE.Sphere(center, CH * 0.75 + 2);
      g.boundingBox = new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(CH + 2, 6, CH + 2));
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    chunks.push({ hi: mk(geoHi), lo: mk(geoLo), n, center });
  }
  let q = 1;
  return {
    group,
    setQuality(v) { q = v; },
    update(cam) {
      for (const c of chunks) {
        const d = Math.max(0, Math.hypot(cam.position.x - c.center.x, cam.position.z - c.center.z) - 5);
        const near = d < 22 * Math.sqrt(q);
        const f = near ? Math.min(1, q * 1.1) : Math.pow(Math.max(0.05, 1 - d / 95), 1.5) * q;
        const cnt = Math.floor(c.n * f);
        c.hi.visible = near; c.lo.visible = !near && cnt > 0;
        (near ? c.hi : c.lo).geometry.instanceCount = cnt;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Trees, bushes and a power line along the far edge of the field
// ---------------------------------------------------------------------------
function jsN3(x, y, z) { return vn(x + z * 1.7, y + z * 0.3) * 0.5 + vn(y * 1.3 - z, x * 0.7 + 4) * 0.5; }

let leafTex = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + (rand() - 0.5) * 220, 128 + (rand() - 0.5) * 220); g.stroke(); }
  for (let i = 0; i < 150; i++) {
    const a = rand() * 6.28, r = Math.pow(rand(), 0.7) * 110;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const l = 150 + rand() * 105;
    g.fillStyle = `rgb(${l},${l},${l})`;
    g.save(); g.translate(x, y); g.rotate(rand() * 6.28);
    g.beginPath(); g.ellipse(0, 0, 9 + rand() * 6, 4 + rand() * 2.5, 0, 0, 6.28); g.fill();
    g.restore();
  }
  leafTex = new THREE.CanvasTexture(c);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.anisotropy = 4;
  return leafTex;
}

function deciduousGeo(detail, cardsPerBlob = 34) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.28, 5, 8); trunk.translate(0, 2.5, 0);
  parts.push(paint(trunk, [0.03, 0.025, 0.02]));
  for (let i = 0; i < 5; i++) {
    const a = rand() * 6.28;
    const b = new THREE.CylinderGeometry(0.05, 0.1, 2.6, 5); b.translate(0, 1.3, 0);
    b.rotateZ(0.7); b.rotateY(a); b.translate(0, 3.0 + rand() * 1.8, 0);
    parts.push(paint(b, [0.03, 0.025, 0.02]));
  }
  const blobs = 12 + Math.floor(rand() * 6);
  const H = 6.5 + rand() * 2, RX = 3 + rand() * 0.9;
  const cPos = [], cNrm = [], cCol = [], cUv = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let i = 0; i < blobs; i++) {
    const r = 1.2 + rand() * 1.1;
    const g = new THREE.IcosahedronGeometry(r * 0.72, detail);
    const a = rand() * 6.28, rr = Math.sqrt(rand()) * RX * 0.75;
    const cy = H + (rand() - 0.4) * 3.2;
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const p = g.attributes.position;
    const col = [];
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const d = 1 + (jsN3(x * 1.3 + i, y * 1.3, z * 1.3) - 0.5) * 0.7;
      x *= d; y *= d * 0.85; z *= d;
      const wy = y + cy;
      const shade = 0.35 + 0.45 * Math.min(1, Math.max(0, (wy - 3) / (H + 3)));
      col.push(0.022 * shade, 0.036 * shade, 0.016 * shade);
      p.setXYZ(k, x + cx, wy, z + cz);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    parts.push(g);
    // leaf cards around the blob
    for (let k = 0; k < cardsPerBlob; k++) {
      v.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const pr = r * (0.55 + rand() * 0.55);
      const px = cx + v.x * pr, py = cy + v.y * pr * 0.85, pz = cz + v.z * pr;
      const sz = 1.0 + rand() * 0.8;
      q.setFromEuler(e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28));
      const n = new THREE.Vector3(px, py - H * 0.9, pz).normalize();
      n.y += 0.35; n.normalize();
      const shade = (0.45 + 0.55 * Math.min(1, Math.max(0, (py - 3) / (H + 2.5)))) * (0.75 + 0.5 * rand());
      const hue = rand();
      for (const [u, w] of corners) {
        const o = new THREE.Vector3(u * sz, w * sz, 0).applyQuaternion(q);
        cPos.push(px + o.x, py + o.y, pz + o.z);
        cNrm.push(n.x, n.y, n.z);
        cUv.push(u + 0.5, w + 0.5);
        cCol.push((0.05 + 0.03 * hue) * shade, (0.075 + 0.02 * hue) * shade, 0.028 * shade);
      }
    }
  }
  const core = mergeGeometries(parts.map((g) => { const o = g.index ? g.toNonIndexed() : g; if (o.attributes.uv) o.deleteAttribute('uv'); return o; }));
  const cards = new THREE.BufferGeometry();
  cards.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  cards.setAttribute('normal', new THREE.Float32BufferAttribute(cNrm, 3));
  cards.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
  cards.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
  return { core, cards };
}
function paint(g, c) {
  const o = g.index ? g.toNonIndexed() : g;
  if (o.attributes.uv) o.deleteAttribute('uv');
  const col = new Float32Array(o.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set(c, i);
  o.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return o;
}
function coniferGeo() {
  const parts = [];
  const H = 14 + rand() * 6;
  const trunk = new THREE.CylinderGeometry(0.08, 0.3, H, 7); trunk.translate(0, H / 2, 0);
  parts.push(paint(trunk, [0.03, 0.024, 0.02]));
  const tiers = 16;
  for (let t = 0; t < tiers; t++) {
    const y = 1.6 + (H - 1.6) * (t / tiers);
    const R = (2.6 + rand() * 0.4) * Math.pow(1 - t / tiers, 0.95) + 0.25;
    const seg = 14;
    const pos = [], col = [];
    const apex = [0, y + 1.6, 0];
    const rim = [];
    for (let i = 0; i < seg; i++) {
      const a = i / seg * 6.28 + rand() * 0.2;
      const rr = R * (0.65 + rand() * 0.5);
      rim.push([Math.cos(a) * rr, y - 0.35 - rand() * 0.4, Math.sin(a) * rr]);
    }
    const v = 0.55 + 0.45 * (t / tiers);
    for (let i = 0; i < seg; i++) {
      const a = rim[i], b = rim[(i + 1) % seg];
      const inner = [0, y - 0.1, 0];
      pos.push(...apex, ...b, ...a, ...inner, ...a, ...b);
      const k = v * (0.8 + 0.3 * rand());
      for (let j = 0; j < 3; j++) col.push(0.02 * k, 0.038 * k, 0.022 * k);
      for (let j = 0; j < 3; j++) col.push(0.008 * k, 0.014 * k, 0.009 * k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts.map((g) => { const o = g.index ? g.toNonIndexed() : g; if (!o.attributes.normal) o.computeVertexNormals(); for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'color'].includes(k)) o.deleteAttribute(k); return o; }));
}

function foliageMaterial(leaf = false) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  if (leaf) { mat.map = leafTexture(); mat.alphaTest = 0.45; mat.alphaToCoverage = true; mat.roughness = 0.6; }
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = envUniforms.uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * .21 + instanceMatrix[3].z * .17;
      #else
      float ph = 0.;
      #endif
      transformed.x += sin(uTime * 1.1 + ph) * .012 * transformed.y;
      transformed.z += cos(uTime * .9 + ph) * .008 * transformed.y;
      #ifdef USE_INSTANCING
      vW = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
      #else
      vW = (modelMatrix * vec4(transformed, 1.)).xyz;
      #endif`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${NOISE}\n${BUMP}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float leaf = vnoise3(vW * 2.2) * .6 + vnoise3(vW * 6.) * .4;
      diffuseColor.rgb *= .6 + .8 * leaf;`)
      .replace('#include <normal_fragment_maps>', leaf ? '#include <normal_fragment_maps>\nnormal = normalize(vNormal);' : '#include <normal_fragment_maps>\nnormal = perturbBump(-vViewPosition, normal, leaf * .35, faceDirection);');
  };
  mat.customProgramCacheKey = () => 'foliage' + leaf;
  return mat;
}

export function makeTrees() {
  const group = new THREE.Group();
  const mat = foliageMaterial();
  const leafMat = foliageMaterial(true);
  const variants = [deciduousGeo(1), deciduousGeo(1), deciduousGeo(1, 26)];
  const conifers = [coniferGeo(), coniferGeo()];
  const place = { d: [[], [], []], c: [[], []] };
  const push = (x, z, s, conifer) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, terrainH(x, z) - 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * 6.28, 0)), new THREE.Vector3(s, s * (0.9 + rand() * 0.25), s));
    if (conifer) place.c[Math.floor(rand() * 2)].push(m); else place.d[Math.floor(rand() * 3)].push(m);
  };
  // treeline ring: clusters with gaps
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2;
    const band = fbm(Math.cos(a) * 3 + 5, Math.sin(a) * 3);
    if (band < 0.38) continue;
    const r = 95 + rand() * 60 + (1 - band) * 50 + fbm(a * 4, 1) * 40;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const conShare = 0.18 + 0.6 * sstep(0.2, 0.9, fbm(a * 2 + 11, 3));
    push(x, z, 0.85 + rand() * 0.55, rand() < conShare);
  }
  // scattered bushes and lone trees in the mid field
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, r = 32 + rand() * 55;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (dirtMask(x, z) > 0.2) continue;
    push(x, z, rand() < 0.8 ? 0.28 + rand() * 0.25 : 0.7 + rand() * 0.3, rand() < 0.2);
  }
  const add = (geo, list, m = mat) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    group.add(im);
  };
  variants.forEach((g, i) => { add(g.core, place.d[i]); add(g.cards, place.d[i], leafMat); });
  conifers.forEach((g, i) => add(g, place.c[i]));

  // power line
  const wood = [], wires = [];
  const poles = [];
  for (let x = -220; x <= 220; x += 42) {
    const z = 78 + x * 0.12 + Math.sin(x * 0.02) * 4;
    const y = terrainH(x, z);
    poles.push(new THREE.Vector3(x, y, z));
    const p = new THREE.CylinderGeometry(0.1, 0.16, 10, 8); p.translate(x, y + 5, z); wood.push(paint(p, [0.04, 0.032, 0.025]));
    const arm = new THREE.BoxGeometry(0.12, 0.12, 2.2); arm.rotateY(-0.12); arm.translate(x, y + 9.4, z); wood.push(paint(arm, [0.04, 0.032, 0.025]));
    for (const o of [-0.95, 0, 0.95]) {
      const ins = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 8); ins.translate(x - o * 0.12, y + 9.65, z + o); wood.push(paint(ins, [0.12, 0.12, 0.11]));
    }
  }
  for (let i = 0; i < poles.length - 1; i++) {
    for (const o of [-0.95, 0, 0.95]) {
      const a = poles[i].clone().add(new THREE.Vector3(-o * 0.12, 9.8, o)), b = poles[i + 1].clone().add(new THREE.Vector3(-o * 0.12, 9.8, o));
      const pts = [];
      for (let k = 0; k <= 16; k++) { const t = k / 16; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 1.4; pts.push(p); }
      wires.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.025, 4));
    }
  }
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  group.add(new THREE.Mesh(mergeGeometries(wood.map((g) => { const o = g; if (!o.attributes.normal) o.computeVertexNormals(); return o; })), woodMat));
  group.add(new THREE.Mesh(mergeGeometries(wires.map((g) => { g.deleteAttribute('uv'); return g.toNonIndexed(); })), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.5 })));
  return group;
}

// ---------------------------------------------------------------------------
// Rain streaks around the camera
// ---------------------------------------------------------------------------
export function makeRain(count = 42000) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) off.set([rand(), rand(), rand(), rand()], i * 4);
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: envUniforms.uTime, uFlash: envUniforms.uFlash, uBox: { value: new THREE.Vector3(56, 34, 56) }, uVel: { value: new THREE.Vector3(WIND.x * 2.2, -11, WIND.y * 2.2) }, uLight: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uBox; uniform vec3 uVel;
      attribute vec4 aOff; varying float vA; varying float vY;
      void main(){
        vec3 vel = uVel * (.85 + .3 * aOff.w);
        vec3 p = aOff.xyz * uBox + vel * uTime;
        vec3 c = cameraPosition + vec3(0., 4., 0.);
        p = mod(p - c + uBox * .5, uBox) - uBox * .5 + c;
        vec3 dir = normalize(vel);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(dir, toCam));
        float len = .4 + .45 * aOff.w;
        float dist = distance(p, cameraPosition);
        vec3 wp = p + dir * len * position.y + side * position.x * (.006 + dist * .0005);
        vA = smoothstep(.6, 2.5, dist) * (1. - smoothstep(18., 27., dist));
        vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFlash; varying float vA; varying float vY;
      void main(){
        float a = vA * sin(vY * 3.14159) * .13;
        gl_FragColor = vec4(vec3(.62, .66, .7) * (1. + uFlash * 2.5), a);
      }`,
    transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 10;
  return m;
}

// ---------------------------------------------------------------------------
// Smoke column + small fire at the engine
// ---------------------------------------------------------------------------
export function makeSmoke(src) {
  const N = 460, LIFE = 34;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); // xyz size
  const aD = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); // alpha seed rot heat
  aP.setUsage(THREE.DynamicDrawUsage); aD.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', aP); g.setAttribute('aD', aD);
  g.instanceCount = N;
  const seeds = Array.from({ length: N }, () => [rand(), rand(), rand(), rand()]);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: envUniforms.uTime, uFlash: envUniforms.uFlash, uFog: { value: FOG_COLOR }, uDens: { value: 0.0068 } },
    vertexShader: /* glsl */ `
      attribute vec4 aP; attribute vec4 aD;
      varying vec2 vUv; varying vec4 vD; varying float vFog; varying float vH;
      uniform float uDens;
      void main(){
        vUv = uv; vD = aD;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float c = cos(aD.z * 6.28), s = sin(aD.z * 6.28);
        vec2 q = mat2(c, -s, s, c) * position.xy;
        vec3 wp = aP.xyz + (right * q.x + up * q.y) * aP.w;
        vH = aP.y;
        vec4 mv = viewMatrix * vec4(wp, 1.);
        float d = -mv.z;
        vFog = 1. - exp(-uDens * uDens * d * d);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uFlash; uniform vec3 uFog;
      varying vec2 vUv; varying vec4 vD; varying float vFog; varying float vH;
      ${NOISE}
      void main(){
        vec2 p = vUv - .5;
        float r = length(p) * 2.;
        float n = fbm2(vUv * 2.6 + vD.y * 17. + vec2(0., -uTime * .04));
        float n2 = vnoise2(vUv * 7. + vD.y * 9. - uTime * .1);
        float a = 1. - smoothstep(.05, 1., r + (n - .5) * .9 + (n2 - .5) * .25);
        a *= a;
        a *= vD.x;
        float lightTop = clamp(.5 - p.y * .9 + (n - .5), 0., 1.);
        vec3 col = mix(vec3(.008, .008, .009), vec3(.075, .078, .082), lightTop * .55 + smoothstep(10., 70., vH) * .35);
        col += vec3(1., .38, .1) * vD.w * smoothstep(.9, .1, r) * 1.2;
        col += uFlash * vec3(.25, .28, .35);
        col = mix(col, uFog, vFog);
        gl_FragColor = vec4(col, a * (1. - vFog * .5));
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  // flames
  const FN = 46;
  const fg = new THREE.InstancedBufferGeometry();
  fg.setAttribute('position', g.attributes.position); fg.setAttribute('uv', g.attributes.uv); fg.setIndex(g.index);
  const fP = new THREE.InstancedBufferAttribute(new Float32Array(FN * 4), 4), fD = new THREE.InstancedBufferAttribute(new Float32Array(FN * 4), 4);
  fP.setUsage(THREE.DynamicDrawUsage); fD.setUsage(THREE.DynamicDrawUsage);
  fg.setAttribute('aP', fP); fg.setAttribute('aD', fD); fg.instanceCount = FN;
  const fmat = new THREE.ShaderMaterial({
    uniforms: { uTime: envUniforms.uTime },
    vertexShader: mat.vertexShader.replace('uniform float uDens;', 'float uDens = 0.;'),
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv; varying vec4 vD;
      ${NOISE}
      void main(){
        vec2 p = vUv - .5;
        float n = fbm2(vUv * 3. + vD.y * 11. - vec2(0., uTime * 1.5));
        float a = smoothstep(.5, .05, length(p * vec2(1.3, .8)) + (n - .5) * .35) * vD.x;
        vec3 col = mix(vec3(1., .22, .03), vec3(1., .72, .32), smoothstep(.2, .6, n) * (1. - vD.w)) * 1.4;
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.Mesh(fg, fmat);
  flames.frustumCulled = false; flames.renderOrder = 6;
  const fseeds = Array.from({ length: FN }, () => [rand(), rand(), rand()]);

  const light = new THREE.PointLight(0xff6a22, 4, 10, 1.6);
  light.position.copy(src).add(new THREE.Vector3(0, 0.5, 0));

  const group = new THREE.Group();
  group.add(mesh, flames, light);

  const order = Array.from({ length: N }, (_, i) => i);
  const depth = new Float32Array(N);
  const tmp = new Float32Array(N * 8);
  const v = new THREE.Vector3();
  function update(t, cam) {
    for (let i = 0; i < N; i++) {
      const [s0, s1, s2, s3] = seeds[i];
      const age = (t + (i + s0 * 0.8) / N * LIFE) % LIFE;
      const k = age / LIFE;
      const rise = 62 * (1 - Math.exp(-age / 11)) + age * 0.4;
      const drift = age * 1.25 + age * age * 0.03;
      const sw = Math.sin(age * 0.35 + s1 * 6.28) * (0.4 + age * 0.12);
      const x = src.x + WIND.x * drift + sw * 0.7 + (s2 - 0.5) * 0.6;
      const z = src.z + WIND.y * drift + Math.cos(age * 0.3 + s3 * 6.28) * (0.3 + age * 0.1);
      const y = src.y + rise + (s3 - 0.5) * 1.5 * k;
      const size = 1.6 + age * 1.5 + s1 * 3 * k + Math.pow(k, 2) * 14;
      const alpha = Math.min(1, age / 0.8) * (1 - THREE.MathUtils.smoothstep(k, 0.55, 1)) * (0.75 + 0.25 * s2);
      const heat = Math.max(0, 1 - age / 0.45) * 0.35;
      tmp.set([x, y, z, size, alpha, s1, s3 + t * 0.01 * (s2 - 0.5), heat], i * 8);
      v.set(x, y, z);
      depth[i] = v.distanceToSquared(cam.position);
    }
    order.sort((a, b) => depth[b] - depth[a]);
    for (let j = 0; j < N; j++) {
      const i = order[j];
      aP.setXYZW(j, tmp[i * 8], tmp[i * 8 + 1], tmp[i * 8 + 2], tmp[i * 8 + 3]);
      aD.setXYZW(j, tmp[i * 8 + 4], tmp[i * 8 + 5], tmp[i * 8 + 6], tmp[i * 8 + 7]);
    }
    aP.needsUpdate = true; aD.needsUpdate = true;
    for (let i = 0; i < FN; i++) {
      const [s0, s1, s2] = fseeds[i];
      const L = 0.9 + s1 * 0.5;
      const age = (t + s0 * L) % L, k = age / L;
      const x = src.x + (s1 - 0.5) * 0.9 + WIND.x * k * 0.5;
      const z = src.z + (s2 - 0.5) * 0.7 + WIND.y * k * 0.3;
      fP.setXYZW(i, x, src.y - 0.45 + k * 0.8, z, (0.3 + s2 * 0.25) * (1 - k * 0.6));
      fD.setXYZW(i, Math.sin(k * Math.PI) * 0.6, s1, s2, k);
    }
    fP.needsUpdate = true; fD.needsUpdate = true;
    light.intensity = 3.2 + Math.sin(t * 17) * 0.8 + Math.sin(t * 7.3) * 1.0 + Math.sin(t * 29) * 0.4;
  }
  return { group, update };
}

// Quadtree-LOD terrain with skirts, far ring, land-use mask and a PBR splat shader that
// blends scanned texture arrays (grass, soil, forest floor, rock, gravel, mud ...).
import * as THREE from 'three';
import { HALF, CELL, GRID_N, WATER_Y, RIVER_W, forestAt, forestPotentialToMask, urbanAt, farHeight, nextFrame } from './layout.js';
import { GLSL_COMMON } from './terrainShader.js';
import { q } from '../core/settings.js';

export const MASK_HALF = 12288;
const MASK_RES = 1024;
const MIN_NODE = 256;

export function makeNoiseTexture(size = 256) {
  // tileable multi-octave value noise in 4 channels (different seeds)
  const data = new Uint8Array(size * size * 4);
  const lat = (n, seed) => {
    const a = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < n * n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = s / 0x7fffffff; }
    return a;
  };
  for (let c = 0; c < 4; c++) {
    const acc = new Float32Array(size * size);
    let amp = 1, tot = 0;
    for (let o = 0, n = 4; o < 5; o++, n *= 2) {
      const L = lat(n, 99 + c * 31 + o * 7);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = x / size * n, fy = y / size * n;
        const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
        const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
        const g = (i, j) => L[((iy + j) % n) * n + ((ix + i) % n)];
        acc[y * size + x] += amp * ((g(0, 0) * (1 - su) + g(1, 0) * su) * (1 - sv) + (g(0, 1) * (1 - su) + g(1, 1) * su) * sv);
      }
      tot += amp; amp *= 0.55;
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + c] = Math.max(0, Math.min(255, (acc[i] / tot - 0.5) * 1.8 * 255 + 128));
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export async function buildMask(hf, progress) {
  const data = new Uint8Array(MASK_RES * MASK_RES * 4);
  const step = (MASK_HALF * 2) / MASK_RES;
  for (let j = 0; j < MASK_RES; j++) {
    const z = -MASK_HALF + (j + 0.5) * step;
    for (let i = 0; i < MASK_RES; i++) {
      const x = -MASK_HALF + (i + 0.5) * step;
      const h = hf.height(x, z);
      const k = (j * MASK_RES + i) * 4;
      data[k] = forestPotentialToMask(forestAt(x, z, h)) * 255;
      data[k + 1] = urbanAt(x, z) * 255;
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
    if ((j & 63) === 0) { progress?.(j / MASK_RES); await nextFrame(); }
  }
  const tex = new THREE.DataTexture(data, MASK_RES, MASK_RES, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, data, res: MASK_RES, half: MASK_HALF };
}

export function sampleMask(mask, x, z, ch) {
  const f = (v) => (v + mask.half) / (mask.half * 2) * mask.res - 0.5;
  const fx = Math.max(0, Math.min(mask.res - 1.001, f(x))), fz = Math.max(0, Math.min(mask.res - 1.001, f(z)));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, R = mask.res, d = mask.data;
  const g = (a, b) => d[((j + b) * R + i + a) * 4 + ch];
  return ((g(0, 0) * (1 - u) + g(1, 0) * u) * (1 - v) + (g(0, 1) * (1 - u) + g(1, 1) * u) * v) / 255;
}

// ---------------- material ----------------
export function createTerrainMaterial(env, assets, mask, noiseTex) {
  const Q = q();
  const T = assets.terrain;
  const ok = T.diff && T.nor && T.arm;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    tD: { value: T.diff || null }, tN: { value: T.nor || null }, tA: { value: T.arm || null },
    tMask: { value: mask.tex }, tNoise: { value: noiseTex },
    maskHalf: { value: MASK_HALF },
    treeFade: { value: new THREE.Vector2(Q.treeRadius * 0.72, Q.treeRadius * 0.98) },
    craterTex: { value: null },
  };
  mat.userData.uniforms = uniforms;
  const detail = Q.terrainDetail;
  env.material(mat, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2DArray tD; uniform sampler2DArray tN; uniform sampler2DArray tA;
        uniform sampler2D tMask; uniform sampler2D tNoise; uniform float maskHalf; uniform vec2 treeFade;
        ${GLSL_COMMON}
        #define HAS_TEX ${ok ? 1 : 0}
        #define DETAIL ${detail}
        const float LS[9] = float[9](2.6, 2.4, 3.2, 3.0, 7.0, 2.2, 3.4, 4.0, 3.0);
        const vec3 LAVG[9] = vec3[9](vec3(0.080,0.048,0.008), vec3(0.315,0.232,0.103), vec3(0.098,0.051,0.021), vec3(0.147,0.104,0.059), vec3(0.169,0.119,0.049), vec3(0.083,0.051,0.026), vec3(0.077,0.061,0.041), vec3(0.063,0.041,0.028), vec3(0.164,0.143,0.101));
        vec3 T_alb; float T_rough; float T_ao; vec3 T_nrm;
        void sampleLayer(int L, vec2 wp, float dist, float anti, out vec3 c, out vec3 n, out vec3 arm){
          vec2 uv = vec2(wp.x, -wp.y) / LS[L];
        #if HAS_TEX
          c = texture(tD, vec3(uv, float(L))).rgb;
          arm = texture(tA, vec3(uv, float(L))).rgb;
          #if DETAIL > 0
          // de-tiling: blend with a rotated, rescaled second lookup
          vec2 uv2 = mat2(0.8,-0.6,0.6,0.8) * uv * 0.43 + vec2(0.37, 0.71);
          vec3 c2 = texture(tD, vec3(uv2, float(L))).rgb;
          c = mix(c, c2, anti);
          #endif
          if(dist < 1800.0){
            n = texture(tN, vec3(uv, float(L))).xyz * 2.0 - 1.0;
            n.xy *= 1.0 - smoothstep(600.0, 1800.0, dist);
          } else n = vec3(0.0,0.0,1.0);
        #else
          c = LAVG[L]; arm = vec3(1.0, 0.9, 0.0); n = vec3(0.0,0.0,1.0);
        #endif
        }
      `)
      .replace('#include <map_fragment>', `
        {
        vec2 wp = vWPos.xz;
        float dist = length(vWPos - cameraPosition);
        vec3 nW = normalize(vWNrm);
        vec4 nzL = texture(tNoise, wp / 2300.0);
        vec4 nz = texture(tNoise, wp / 610.0);
        vec4 nz2 = texture(tNoise, wp / 71.0);
        vec4 m = texture(tMask, wp / (2.0*maskHalf) + 0.5);
        float fe = m.r + (vnoise(wp/55.0, 11)-0.5)*0.22 + (vnoise(wp/17.0, 12)-0.5)*0.09;
        float forest = smoothstep(0.47, 0.53, fe);
        float urban = m.g;
        float rd = riverDist(wp);
        float hedgeH, along, across;
        vec4 fi = fieldInfo(wp, hedgeH, along, across);
        float w[9]; vec3 C[9];
        for(int i=0;i<9;i++){ w[i]=0.0; C[i]=vec3(0.0); }
        float crop = fi.y;
        // flood plain meadows + gardens around settlements
        float meadowBias = max(smoothstep(520.0, 330.0, rd + (nz.r-0.5)*300.0), smoothstep(0.02, 0.2, urban));
        if(meadowBias > 0.5) crop = 0.0;
        float fv = fi.x;
        float fv2 = fract(fi.x * 7.13);
        // reference albedos (linear) for mid-October Franconia from aerial photography
        vec3 cMeadow = mix(vec3(0.075,0.100,0.038), vec3(0.105,0.125,0.050), fv) * mix(0.8, 1.12, nz2.g);
        vec3 cStubble = mix(vec3(0.21,0.18,0.10), vec3(0.29,0.24,0.13), fv) * mix(0.9, 1.08, nz2.r);
        vec3 cGreen = mix(vec3(0.060,0.095,0.030), vec3(0.085,0.115,0.038), fv);
        vec3 cPlough = mix(vec3(0.085,0.062,0.042), vec3(0.15,0.105,0.066), fv) * mix(0.85, 1.1, nz2.b);
        vec3 cFallow = mix(vec3(0.17,0.16,0.08), vec3(0.2,0.17,0.09), fv);
        vec3 cForest = vec3(0.075,0.062,0.04);
        vec3 cRock = vec3(0.19,0.175,0.15);
        vec3 cGravel = mix(vec3(0.15,0.135,0.11), vec3(0.19,0.17,0.14), nz2.g);
        vec3 cMud = vec3(0.085,0.072,0.052);
        #define ADD(L, W, COL) { float ww = (W); w[L] += ww; C[L] += ww * (COL); }
        if(crop < 0.5){ ADD(0, 0.6 + 0.4*nz2.g, cMeadow); ADD(1, 0.4 + 0.5*nz.b, cMeadow); }
        else if(crop < 1.5){ ADD(1, 1.0, cStubble); ADD(2, 0.3 + 0.3*nz2.r, cStubble * vec3(0.8,0.75,0.7)); }
        else if(crop < 2.5){ ADD(1, 1.0, cGreen); ADD(2, 0.3, cPlough); }
        else if(crop < 3.5){ ADD(2, 1.0, cPlough); ADD(6, 0.25*nz2.b, cPlough); }
        else { ADD(0, 0.7, cFallow); ADD(2, 0.5, cPlough); ADD(1, 0.3, cFallow); }
        // grass margins between strips and farm tracks along block edges
        float margin = 1.0 - smoothstep(0.35, 1.1, fi.z);
        float track = (1.0 - smoothstep(1.2, 2.6, fi.w)) * step(0.35, fract(hedgeH*7.0));
        if(crop > 0.5 && meadowBias < 0.5){ ADD(0, margin * 1.5, cMeadow); }
        ADD(6, track * 2.5 * (1.0 - urban), cMud * 1.3);
        // settlements: packed earth, gravel, garden grass
        float u2 = smoothstep(0.25, 0.75, urban + (nz2.r-0.5)*0.35);
        for(int i=0;i<9;i++){ w[i] *= 1.0 - u2; C[i] *= 1.0 - u2; }
        float uc = smoothstep(0.8, 1.0, urban);
        ADD(5, u2 * (0.2 + 0.5*nz2.g + uc * 0.7), cGravel * 0.62); ADD(6, u2 * (0.35 * nz2.b + 0.4 * uc), cMud); ADD(0, u2 * (0.5 + 0.6 * nz.g) * (1.0 - 0.75 * uc), cMeadow * 0.85);
        // wet river banks
        float bank = smoothstep(${(RIVER_W / 2 + 14).toFixed(1)}, ${(RIVER_W / 2 + 2).toFixed(1)}, rd + (nz2.g-0.5)*8.0);
        for(int i=0;i<9;i++){ w[i] *= 1.0 - bank; C[i] *= 1.0 - bank; }
        ADD(6, bank * 1.5, cMud); ADD(5, bank * 0.5 * nz2.r, cGravel * 0.8);
        // forest floor
        for(int i=0;i<9;i++){ w[i] *= 1.0 - forest; C[i] *= 1.0 - forest; }
        ADD(3, forest * 1.2, cForest);
        // steep slopes: rock
        float rockW = smoothstep(0.24, 0.42, (1.0 - nW.y) + (nz2.r - 0.5) * 0.2);
        for(int i=0;i<9;i++){ w[i] *= 1.0 - rockW; C[i] *= 1.0 - rockW; }
        ADD(4, rockW * 1.5, cRock);
        float fieldW = (1.0 - u2) * (1.0 - forest) * (1.0 - rockW) * (1.0 - bank);
        // choose two dominant layers
        int a = 0, b = 1; float wa = -1.0, wb = -1.0;
        for(int i=0;i<9;i++){ float v = w[i]; if(v > wa){ wb = wa; b = a; wa = v; a = i; } else if(v > wb){ wb = v; b = i; } }
        float tb = clamp(wb / max(wa + wb, 1e-4), 0.0, 1.0);
        vec3 ca, na, aa, cb, nb, ab;
        float anti = 0.25 + 0.5 * nz2.b;
        sampleLayer(a, wp, dist, anti, ca, na, aa);
        if(tb > 0.02) sampleLayer(b, wp, dist, anti, cb, nb, ab); else { cb = ca; nb = na; ab = aa; }
        // texture detail relative to layer mean, applied to the reference colour
        vec3 da = ca / LAVG[a], db = cb / LAVG[b];
        float ha = dot(da, vec3(0.33)) + (1.0 - tb) * 1.5, hb = dot(db, vec3(0.33)) + tb * 1.5;
        float bt = smoothstep(-0.25, 0.25, hb - ha);
        vec3 colA = C[a] / max(w[a], 1e-4), colB = C[b] / max(w[b], 1e-4);
        vec3 det = mix(da, db, bt);
        det = mix(vec3(dot(det, vec3(0.333))), det, 0.55);  // keep texture hue shifts subtle
        T_alb = mix(colA, colB, bt) * clamp(det, 0.0, 3.0);
        vec3 armM = mix(aa, ab, bt);
        T_nrm = normalize(mix(na, nb, bt));
        T_rough = armM.g; T_ao = mix(1.0, armM.r, 0.8);
        // stubble rows / furrows (fade with distance to avoid aliasing)
        float rowFade = 1.0 - smoothstep(40.0, 220.0, dist);
        if(crop > 0.5 && crop < 1.5) T_alb *= 1.0 + 0.10 * sin(along * 26.0) * rowFade * fieldW;
        if(crop > 2.5 && crop < 3.5){ float fr = sin(along * 19.0); T_alb *= 1.0 + 0.16 * fr * rowFade * fieldW; T_nrm.x += 0.35 * cos(along*19.0) * rowFade * fieldW; }
        vec4 nz3 = texture(tNoise, wp / 23.0);
        T_alb *= mix(0.86, 1.1, nz3.r);
        // machine/horse passes along each field: long streaks
        float streak = texture(tNoise, vec2(along / 9.0, across / 400.0 + fv * 13.0)).g;
        T_alb *= mix(1.0, mix(0.88, 1.1, streak), fieldW * step(0.5, crop));
        // large scale colour variation (soil moisture, patchy growth)
        T_alb *= mix(0.82, 1.14, nzL.r) * mix(0.92, 1.06, nz.g);
        T_alb = mix(T_alb, T_alb * vec3(1.06, 0.99, 0.9), nzL.b * 0.5 * fieldW);
        // ---- distant canopy for forest / hedgerows / riverside trees beyond 3D tree range ----
        float hedge = (1.0 - smoothstep(2.0, 4.5, fi.w)) * step(0.55, hedgeH) * (1.0 - u2) * (1.0 - forest) * step(90.0, rd);
        float ripar = (1.0 - smoothstep(4.0, 9.0, abs(rd - ${(RIVER_W / 2 + 9).toFixed(1)}))) * step(0.45, vnoise(wp/40.0, 21));
        float canopyAmt = max(max(forest, hedge), ripar);
        float cfade = smoothstep(treeFade.x, treeFade.y, dist);
        if(canopyAmt * cfade > 0.001){
          vec2 cp = wp / 4.6;
          vec2 ci = floor(cp); float f1 = 9.0; vec2 cv = vec2(0.0); float cid = 0.0;
          for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
            vec2 c = ci + vec2(float(i),float(j));
            int cx = int(c.x), cz = int(c.y);
            vec2 o = c + 0.5 + 0.8*(vec2(h2i(cx,cz,31), h2i(cx,cz,32)) - 0.5);
            float r = 0.62 + 0.4*h2i(cx,cz,33);
            vec2 dd = (cp - o) / r; float d = dot(dd,dd);
            if(d < f1){ f1 = d; cv = dd; cid = h2i(cx,cz,34); }
          }
          float conifer = smoothstep(0.35, 0.65, nz.r + (vWPos.y - 280.0) / 250.0);
          vec3 cc;
          if(cid < conifer) cc = mix(vec3(0.030,0.052,0.028), vec3(0.045,0.062,0.030), fract(cid*13.0));
          else { float s = fract(cid*7.3);
            cc = s < 0.35 ? vec3(0.085,0.095,0.035) : s < 0.6 ? vec3(0.19,0.115,0.035) : s < 0.8 ? vec3(0.13,0.12,0.04) : vec3(0.22,0.18,0.05); }
          float crown = clamp(1.0 - f1, 0.0, 1.0);
          float far = smoothstep(1800.0, 4200.0, dist);
          vec3 cn = normalize(vec3(cv.x * 1.3, 1.0, cv.y * 1.3));
          float gap = smoothstep(0.0, 0.35, crown);
          vec3 canopyC = cc * mix(0.35, 1.0, gap) * (0.85 + 0.3 * nz2.r);
          canopyC = mix(canopyC, mix(vec3(0.05,0.065,0.032), vec3(0.09,0.08,0.035), 1.0 - conifer) * (0.8+0.4*nz.b), far);
          float k = canopyAmt * cfade;
          T_alb = mix(T_alb, canopyC, k);
          T_nrm = normalize(mix(T_nrm, mix(cn.xzy * vec3(1.0,-1.0,1.0), vec3(0.0,0.0,1.0), far), k));
          T_rough = mix(T_rough, 0.8, k);
          T_ao = mix(T_ao, mix(0.35 + 0.65*gap, 0.75, far), k);
        }
        diffuseColor.rgb = T_alb;
        }
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(T_rough, 0.35, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 nW0 = normalize(vWNrm);
          vec3 Tn = normalize(vec3(1.0,0.0,0.0) - nW0 * nW0.x);
          vec3 Bn = normalize(vec3(0.0,0.0,-1.0) + nW0 * nW0.z);
          vec3 nW = normalize(vWNrm);
          vec3 Tn2 = Tn;
          vec3 nP = normalize(Tn * T_nrm.x + Bn * T_nrm.y + nW * max(T_nrm.z, 0.2));
          normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
        }`)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= T_ao;
        reflectedLight.indirectSpecular *= T_ao * T_ao;
      `);
  }, 'terrain' + detail + (ok ? 't' : 'f'));
  return mat;
}

// ---------------- geometry ----------------
function nodeGeometry(hf, cx, cz, size, res) {
  const n = res, verts = (n + 2) * (n + 2);
  const pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3);
  const step = size / (n - 1);
  const x0 = cx - size / 2, z0 = cz - size / 2;
  const skirt = Math.max(4, step * 1.5);
  const tmp = new THREE.Vector3();
  let k = 0;
  // (n+2)^2 grid: outer ring duplicates edge verts pushed down (skirt)
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const ii = Math.min(n - 1, Math.max(0, i)), jj = Math.min(n - 1, Math.max(0, j));
      const x = x0 + ii * step, z = z0 + jj * step;
      let y = hf.height(x, z);
      const edge = i < 0 || j < 0 || i >= n || j >= n;
      if (edge) y -= skirt;
      hf.normal(x, z, tmp);
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      nrm[k * 3] = tmp.x; nrm[k * 3 + 1] = tmp.y; nrm[k * 3 + 2] = tmp.z;
      k++;
    }
  }
  const W = n + 2;
  const idx = new (verts > 65535 ? Uint32Array : Uint16Array)((W - 1) * (W - 1) * 6);
  let t = 0;
  for (let j = 0; j < W - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    // alternate diagonal for better shape
    if ((i + j) & 1) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
    else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function farRingGeometry() {
  const cs = [];
  for (let v = HALF; v <= 16384; v += 512) cs.push(v);
  for (let v = 16384 + 2048; v <= 45056; v += 2048) cs.push(v);
  const inner = [];
  for (let v = -HALF; v <= HALF; v += 1024) inner.push(v);
  const coords = [...cs.slice(1).reverse().map(v => -v), ...inner, ...cs.slice(1)];
  const n = coords.length;
  const pos = [], nrm = [], idx = [];
  const e = 8;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = coords[i], z = coords[j];
    const y = farHeight(x, z) - 1.5;
    const hx = farHeight(x + e, z) - farHeight(x - e, z), hz = farHeight(x, z + e) - farHeight(x, z - e);
    const L = Math.hypot(hx, 2 * e, hz);
    pos.push(x, y, z); nrm.push(-hx / L, 2 * e / L, -hz / L);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const cx = (coords[i] + coords[i + 1]) / 2, cz = (coords[j] + coords[j + 1]) / 2;
    if (Math.abs(cx) < HALF && Math.abs(cz) < HALF) continue;
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Terrain {
  constructor(scene, hf, material) {
    this.hf = hf;
    this.material = material;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.cache = new Map();
    this.res = q().chunkRes;
    this.buildBudget = 6;
    const far = new THREE.Mesh(farRingGeometry(), material);
    far.receiveShadow = true;
    far.name = 'farRing';
    this.group.add(far);
    this.active = new Set();
    this._frame = 0;
  }

  _node(level, cx, cz, size) {
    const key = `${size}_${cx}_${cz}`;
    let m = this.cache.get(key);
    if (!m) {
      if (this.buildBudget <= 0) return null;
      this.buildBudget--;
      m = new THREE.Mesh(nodeGeometry(this.hf, cx, cz, size, this.res), this.material);
      m.receiveShadow = true;
      m.castShadow = false;   // gentle relief at 48 deg sun: terrain self-shadowing not worth the draw calls
      m.matrixAutoUpdate = false;
      m.userData.key = key;
      m.userData.lastUsed = 0;
      this.cache.set(key, m);
    }
    return m;
  }

  // Precompile nodes around a point (used during loading)
  async warm(pos, progress) {
    this.buildBudget = 1e9;
    this.update(pos);
    this.buildBudget = 6;
    progress?.(1);
  }

  update(camPos) {
    this._frame++;
    const want = [];
    const K = 2.2;
    const rec = (cx, cz, size) => {
      const cy = this.hf.height(cx, cz);
      const dx = Math.max(Math.abs(camPos.x - cx) - size / 2, 0);
      const dz = Math.max(Math.abs(camPos.z - cz) - size / 2, 0);
      const d = Math.hypot(dx, dz, (camPos.y - cy) * 0.9);
      if (size > MIN_NODE && d < size * K) {
        const h = size / 4;
        const kids = [[cx - h, cz - h], [cx + h, cz - h], [cx - h, cz + h], [cx + h, cz + h]];
        // only split if all children are ready (or can be built this frame)
        const ms = kids.map(([x, z]) => this._probe(x, z, size / 2));
        if (ms.every(Boolean)) { for (const [x, z] of kids) rec(x, z, size / 2); return; }
      }
      const m = this._node(0, cx, cz, size);
      if (m) want.push(m);
    };
    const root = HALF * 2;
    // root split into 4x4 of 4096 for better culling
    const s = root / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) rec(-HALF + s * (i + 0.5), -HALF + s * (j + 0.5), s);
    const next = new Set(want);
    for (const m of this.active) if (!next.has(m)) this.group.remove(m);
    for (const m of next) { if (!this.active.has(m)) this.group.add(m); m.userData.lastUsed = this._frame; }
    this.active = next;
    this.buildBudget = 6;
    // evict old cache entries
    if (this.cache.size > 900 && (this._frame % 120) === 0) {
      for (const [k, m] of this.cache) if (this._frame - m.userData.lastUsed > 600 && !next.has(m)) { m.geometry.dispose(); this.cache.delete(k); }
    }
  }

  _probe(cx, cz, size) {
    return this._node(0, cx, cz, size);
  }
}

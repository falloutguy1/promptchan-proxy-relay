import * as THREE from 'three';
import { WORLD } from './layout.js';
import { GLSL_NOISE } from '../engine/shaderlib.js';
import { makeTerrainFn } from './terrainGen.js';

const CHUNK_CELLS = 128; // 256 m chunks at 2 m cells
const LOD_STEPS = [1, 2, 4, 16];
// real-world tile size (m) of each terrain layer: grass, dry grass, gravel, mud, rock, sand
const LAYER_SIZE = [15.0, 2.0, 2.25, 1.3, 20.0, 15.0]; // from scan metadata

export class Terrain {
  constructor(assets) {
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = [];
    this.data = null;
  }

  generate(seed = 1337, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        if (e.data.progress !== undefined) onProgress(e.data.progress);
        if (e.data.result) { this.data = e.data.result; w.terminate(); resolve(this.data); }
      };
      w.onerror = (e) => { w.terminate(); reject(new Error('Terrain worker failed: ' + (e.message || 'unknown'))); };
      w.postMessage({ seed });
    });
  }

  heightAt(x, z) {
    const { nx, nz, heights } = this.data;
    const fx = (x - WORLD.x0) / WORLD.cell, fz = (z - WORLD.z0) / WORLD.cell;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return z > 0 ? -60 : 20;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * nx + i;
    const a = heights[k], b = heights[k + 1], c = heights[k + nx], d = heights[k + nx + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = WORLD.cell;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  /** splat weights at a point: [grass, dry, gravel, mud, rock, sand, wet, ao] in 0..1 */
  splatAt(x, z) {
    const { nx, nz, splatA, splatB } = this.data;
    const i = Math.round((x - WORLD.x0) / WORLD.cell), j = Math.round((z - WORLD.z0) / WORLD.cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return [0, 0, 0, 0, 0, 1, 0, 1];
    const k = (j * nx + i) * 4;
    return [splatA[k] / 255, splatA[k + 1] / 255, splatA[k + 2] / 255, splatA[k + 3] / 255, splatB[k] / 255, splatB[k + 1] / 255, splatB[k + 2] / 255, splatB[k + 3] / 255];
  }

  /** Height texture (R16F) used by water for depth colour and shoreline foam. */
  heightTexture() {
    if (this._hTex) return this._hTex;
    const { nx, nz, heights } = this.data;
    const half = new Uint16Array(nx * nz);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    const t = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this._hTex = t;
    return t;
  }

  async loadMaterial(quality) {
    const [colH, nor, arm] = await Promise.all([
      this.assets.texture('terrain/color_height.ktx2', { srgb: true }),
      this.assets.texture('terrain/normal.ktx2'),
      this.assets.texture('terrain/arm.ktx2'),
    ]);
    const { nx, nz, splatA, splatB } = this.data;
    const mkSplat = (d) => {
      const t = new THREE.DataTexture(d, nx, nz, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.needsUpdate = true; return t;
    };
    this.splatTexA = mkSplat(splatA);
    this.splatTexB = mkSplat(splatB);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    mat.name = 'terrain';
    const missing = !colH || !nor || !arm;
    const uniforms = {
      tColH: { value: colH }, tNor: { value: nor }, tArm: { value: arm },
      tSplatA: { value: this.splatTexA }, tSplatB: { value: this.splatTexB },
      uRect: { value: new THREE.Vector4(WORLD.x0, WORLD.z0, 1 / (WORLD.x1 - WORLD.x0), 1 / (WORLD.z1 - WORLD.z0)) },
      uLayerScale: { value: LAYER_SIZE.map((s) => 1 / s) },
    };
    mat.defines = { ANTI_TILE: quality.key === 'low' ? 0 : 1, TERRAIN_FALLBACK: missing ? 1 : 0 };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld; varying vec3 vTNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTWorld = (modelMatrix * vec4(transformed,1.0)).xyz; vTNormal = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          precision highp sampler2DArray;
          varying vec3 vTWorld; varying vec3 vTNormal;
          uniform sampler2DArray tColH, tNor, tArm;
          uniform sampler2D tSplatA, tSplatB;
          uniform vec4 uRect; uniform float uLayerScale[6];
          ${GLSL_NOISE}
          // two rotated/offset samples blended by low-frequency noise hide tile repetition
          vec4 sampleArr(sampler2DArray t, vec2 uv, float layer, float mixT){
            vec4 a = texture(t, vec3(uv, layer));
          #if ANTI_TILE
            if (mixT > 0.01) {
              vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.77 + vec2(0.31, 0.57);
              a = mix(a, texture(t, vec3(uv2, layer)), mixT);
            }
          #endif
            return a;
          }`)
        .replace('#include <map_fragment>', `
          vec2 sUV = (vTWorld.xz - uRect.xy) * uRect.zw;
          vec4 sA = texture(tSplatA, sUV), sB = texture(tSplatB, sUV);
          if (sUV.x < 0.0 || sUV.y < 0.0 || sUV.x > 1.0 || sUV.y > 1.0) {
            // far ring outside the generated heightfield: procedural weights from slope and altitude
            float sl = 1.0 - normalize(vTNormal).y;
            float rockF = smoothstep(0.3, 0.5, sl), sandF = 1.0 - smoothstep(0.2, 1.2, vTWorld.y);
            float dryF = smoothstep(40.0, 160.0, vTWorld.y) * 0.7;
            sA = vec4((1.0 - dryF) * (1.0 - rockF) * (1.0 - sandF), dryF * (1.0 - rockF) * (1.0 - sandF), 0.0, 0.0);
            sB = vec4(rockF * (1.0 - sandF), sandF, 0.0, 1.0);
          }
          float wts[6] = float[6](sA.r, sA.g, sA.b, sA.a, sB.r, sB.g);
          float camD = length(vTWorld - cameraPosition);
          float nLow = bsy_fbm(vTWorld.xz * 0.012);
          float nMid = bsy_fbm(vTWorld.xz * 0.09 + 7.0);
          float mixT = smoothstep(0.35, 0.65, bsy_fbm(vTWorld.xz * 0.045 + 3.0));
          float farT = smoothstep(90.0, 450.0, camD); // distance blending: larger-scale sample hides tile repeats
          vec3 Nw = normalize(vTNormal);
          vec4 cols[6]; vec3 nors[6]; vec3 arms[6]; float vals[6];
          float vmax = -1.0;
          for (int i = 0; i < 6; i++) {
            vals[i] = -1.0;
            if (wts[i] < 0.015) continue;
            vec2 uv = vTWorld.xz * uLayerScale[i];
            float L = float(i);
            if (i == 4) {
              // rock: tri-planar so cliffs are not stretched
              vec3 bw = pow(abs(Nw), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
              vec3 p = vTWorld * uLayerScale[i];
              cols[i] = texture(tColH, vec3(p.zy, L)) * bw.x + sampleArr(tColH, p.xz, L, mixT) * bw.y + texture(tColH, vec3(p.xy, L)) * bw.z;
              vec3 nx_ = texture(tNor, vec3(p.zy, L)).xyz * 2.0 - 1.0, ny_ = texture(tNor, vec3(p.xz, L)).xyz * 2.0 - 1.0, nz_ = texture(tNor, vec3(p.xy, L)).xyz * 2.0 - 1.0;
              // project each planar normal (whiteout-style approximation)
              vec3 tx = vec3(nx_.z * sign(Nw.x), -nx_.y, nx_.x);
              vec3 ty = vec3(ny_.x, ny_.z * sign(Nw.y), -ny_.y);
              vec3 tz = vec3(nz_.x, -nz_.y, nz_.z * sign(Nw.z));
              nors[i] = normalize(tx * bw.x + ty * bw.y + tz * bw.z);
              arms[i] = texture(tArm, vec3(p.xz, L)).xyz;
            } else {
              cols[i] = sampleArr(tColH, uv, L, mixT);
              if (farT > 0.01) cols[i] = mix(cols[i], texture(tColH, vec3(uv * 0.213 + 0.37, L)), farT * 0.65);
              vec3 tn = sampleArr(tNor, uv, L, mixT).xyz * 2.0 - 1.0;
              vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
              vec3 B = normalize(vec3(0.0, 0.0, 1.0) - Nw * Nw.z);
              nors[i] = normalize(T * tn.x - B * tn.y + Nw * tn.z);
              arms[i] = texture(tArm, vec3(uv, L)).xyz;
            }
            // height-blend: layer heights (alpha) decide which material wins in transitions
            float jitter = (nMid - 0.5) * 0.25;
            vals[i] = wts[i] * 1.4 + cols[i].a * 0.6 + jitter;
            vmax = max(vmax, vals[i]);
          }
          vec3 albedo = vec3(0.0), nW = vec3(0.0), armS = vec3(0.0); float wsum = 0.0;
          for (int i = 0; i < 6; i++) {
            if (vals[i] < 0.0) continue;
            float b = max(vals[i] - (vmax - 0.22), 0.0);
            albedo += cols[i].rgb * b; nW += nors[i] * b; armS += arms[i] * b; wsum += b;
          }
          albedo /= wsum; nW = normalize(nW); armS /= wsum;
        #if TERRAIN_FALLBACK
          albedo = mix(vec3(0.25, 0.3, 0.15), vec3(0.45, 0.42, 0.38), wts[2] + wts[4]); nW = Nw; armS = vec3(1.0, 0.9, 0.0);
        #endif
          // large-scale colour variation (patchy growth, soil colour) and grass hue drift
          albedo *= 0.82 + 0.36 * nLow;
          float grassW = (wts[0] + wts[1]);
          albedo = mix(albedo, albedo * vec3(1.08, 1.02, 0.82), grassW * smoothstep(0.4, 0.75, nMid) * 0.6);
          // shoreline / tidal wetness: darker and glossier
          float wet = max(sB.b, 1.0 - smoothstep(0.15, 1.2, vTWorld.y + (nMid - 0.5) * 0.6));
          wet *= step(-0.4, vTWorld.y) * 0.85 + 0.15;
          albedo *= 1.0 - 0.42 * wet;
          float bakedAO = sB.a;
          diffuseColor.rgb *= albedo;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(mix(max(armS.g, 0.72), 0.3, wet), 0.05, 1.0); // dry soil and grass are rough; only wet shore is glossy')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);')
        .replace('#include <aomap_fragment>', `
          float ambientOcclusion = armS.r * mix(0.35, 1.0, bakedAO);
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
          reflectedLight.directDiffuse *= mix(1.0, armS.r, 0.5);`);
    };
    mat.customProgramCacheKey = () => 'terrain' + mat.defines.ANTI_TILE;
    this.material = mat;
    return mat;
  }

  buildChunks() {
    const { nx, nz } = this.data;
    const cx = Math.ceil((nx - 1) / CHUNK_CELLS), cz = Math.ceil((nz - 1) / CHUNK_CELLS);
    for (let j = 0; j < cz; j++) for (let i = 0; i < cx; i++) {
      const c = { i0: i * CHUNK_CELLS, j0: j * CHUNK_CELLS, geos: [], level: -1, mesh: null };
      c.ni = Math.min(CHUNK_CELLS, nx - 1 - c.i0);
      c.nj = Math.min(CHUNK_CELLS, nz - 1 - c.j0);
      c.center = new THREE.Vector3(WORLD.x0 + (c.i0 + c.ni / 2) * WORLD.cell, 0, WORLD.z0 + (c.j0 + c.nj / 2) * WORLD.cell);
      let minH = 1e9, maxH = -1e9;
      for (let jj = 0; jj <= c.nj; jj += 4) for (let ii = 0; ii <= c.ni; ii += 4) {
        const h = this.data.heights[(c.j0 + jj) * nx + c.i0 + ii]; minH = Math.min(minH, h); maxH = Math.max(maxH, h);
      }
      c.center.y = (minH + maxH) / 2;
      c.mesh = new THREE.Mesh(this.chunkGeometry(c, LOD_STEPS[3]), this.material);
      c.geos[3] = c.mesh.geometry;
      c.level = 3;
      c.mesh.receiveShadow = true;
      c.mesh.castShadow = true;
      c.mesh.matrixAutoUpdate = false;
      this.group.add(c.mesh);
      this.chunks.push(c);
    }
  }

  chunkGeometry(c, step) {
    const { nx, heights } = this.data;
    const cols = Math.floor(c.ni / step) + 1, rows = Math.floor(c.nj / step) + 1;
    // grid + one ring of skirt vertices
    const vcount = cols * rows + 2 * (cols + rows);
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3);
    const H = (i, j) => heights[Math.min(Math.max(j, 0), this.data.nz - 1) * nx + Math.min(Math.max(i, 0), nx - 1)];
    let v = 0;
    const put = (gi, gj, drop) => {
      const x = WORLD.x0 + gi * WORLD.cell, z = WORLD.z0 + gj * WORLD.cell;
      pos[v * 3] = x; pos[v * 3 + 1] = H(gi, gj) - drop; pos[v * 3 + 2] = z;
      const e = Math.max(1, step >> 1);
      const dx = H(gi - e, gj) - H(gi + e, gj), dz = H(gi, gj - e) - H(gi, gj + e);
      const n = new THREE.Vector3(dx, 2 * e * WORLD.cell, dz).normalize();
      nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
      return v++;
    };
    const grid = [];
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) grid.push(put(c.i0 + q * step, c.j0 + r * step, 0));
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols - 1; q++) {
      const a = grid[r * cols + q], b = grid[r * cols + q + 1], cc = grid[(r + 1) * cols + q], d = grid[(r + 1) * cols + q + 1];
      idx.push(a, cc, b, b, cc, d);
    }
    // skirts hide cracks between neighbouring chunks at different LODs
    const drop = 1.5 * step * WORLD.cell;
    const edge = (list, flip) => {
      const sk = list.map((g) => { const gi = Math.round((pos[g * 3] - WORLD.x0) / WORLD.cell), gj = Math.round((pos[g * 3 + 2] - WORLD.z0) / WORLD.cell); return put(gi, gj, drop); });
      for (let k = 0; k < list.length - 1; k++) {
        if (flip) idx.push(list[k], list[k + 1], sk[k], sk[k], list[k + 1], sk[k + 1]);
        else idx.push(list[k], sk[k], list[k + 1], list[k + 1], sk[k], sk[k + 1]);
      }
    };
    edge(grid.slice(0, cols), false);
    edge(grid.slice((rows - 1) * cols), true);
    edge(Array.from({ length: rows }, (_, r) => grid[r * cols]), true);
    edge(Array.from({ length: rows }, (_, r) => grid[r * cols + cols - 1]), false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  /** Stream chunk LODs around the camera; builds at most `budget` geometries per call. */
  update(camPos, budget = 2) {
    let built = 0;
    // after a teleport (mode switch, reset) build everything needed now rather than showing skirts
    if (!this._last || this._last.distanceTo(camPos) > 120) budget = Infinity;
    (this._last ||= camPos.clone()).copy(camPos);
    const dists = [380, 800, 1700];
    for (const c of this.chunks) {
      const dx = Math.max(Math.abs(camPos.x - c.center.x) - 128, 0), dz = Math.max(Math.abs(camPos.z - c.center.z) - 128, 0);
      const d = Math.hypot(dx, dz, Math.max(0, camPos.y - c.center.y) * 0.5);
      let want = d < dists[0] ? 0 : d < dists[1] ? 1 : d < dists[2] ? 2 : 3;
      if (want !== c.level) {
        if (!c.geos[want]) {
          if (built >= budget) { want = c.geos.findIndex((g, k) => g && k >= want); if (want < 0) continue; } else { c.geos[want] = this.chunkGeometry(c, LOD_STEPS[want]); built++; }
        }
        c.mesh.geometry = c.geos[want];
        c.level = want;
        // free detailed levels that are far away
        for (let k = 0; k < 2; k++) if (k < want - 1 && c.geos[k]) { c.geos[k].dispose(); c.geos[k] = null; }
      }
    }
    return built;
  }

  /** Low-detail ring continuing the land and seabed out to the horizon (fog hides its coarseness). */
  buildFarRing(R = 9000) {
    const T = makeTerrainFn(1337);
    const { x0, x1, z0, z1 } = WORLD;
    const axis = (a, b) => {
      const out = [];
      for (let v = -R; v < a; v += Math.max(160, (a - v) * 0.25)) out.push(v);
      for (let v = a; v < b; v += 256) out.push(v);
      out.push(b);
      for (let v = b + 160; v < R; v += Math.max(160, (v - b) * 0.25)) out.push(v);
      out.push(R);
      return [...new Set(out)].sort((p, q) => p - q);
    };
    const xs = axis(x0, x1), zs = axis(z0, z1);
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j];
      const cx = Math.min(x1 - 1, Math.max(x0 + 1, x)), cz = Math.min(z1 - 1, Math.max(z0 + 1, z));
      const out = Math.hypot(x - cx, z - cz);
      const edge = this.heightAt(cx, cz);
      const far = z > 1200 ? -80 : T.farHeight(x, z);
      const k = Math.min(1, out / 1400);
      const h = edge + (far - edge) * (k * k * (3 - 2 * k));
      pos.set([x, h - (out > 0 ? 0.3 : 0), z], (j * nx + i) * 3);
    }
    const idx = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const inside = xs[i] >= x0 && xs[i + 1] <= x1 && zs[j] >= z0 && zs[j + 1] <= z1;
      if (inside) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.name = 'terrain-far';
    m.receiveShadow = true;
    this.group.add(m);
  }

  /** Synchronously build everything needed for the current camera (used during loading). */
  warm(camPos) { while (this.update(camPos, 8) > 0); }
}

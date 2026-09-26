import * as THREE from 'three';
import { WORLD } from './layout.js';
import { patch, withWorldPos, NOISE_GLSL } from './shaderlib.js';

// Chunked terrain with distance LODs + skirts, textured by a height-blended
// six-layer splat (texture arrays) with anti-tiling and macro variation.

const CHUNK = 64;
const LOD_STEPS = [1, 2, 4, 8];

export class Terrain {
  constructor(hf, gen, textures, manifest, quality) {
    this.hf = hf;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.chunks = [];
    this.material = this.makeMaterial(gen, textures, manifest, quality);
    const n = WORLD.size / CHUNK;
    const half = WORLD.size / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = -half + i * CHUNK, z0 = -half + j * CHUNK;
      const mesh = new THREE.Mesh(undefined, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      const c = { x0, z0, cx: x0 + CHUNK / 2, cz: z0 + CHUNK / 2, lod: -1, geos: [], mesh };
      this.chunks.push(c);
      this.group.add(mesh);
    }
  }

  buildGeometry(c, lod) {
    const step = LOD_STEPS[lod];
    const n = CHUNK / step + 1;
    const hf = this.hf;
    const skirt = 4 * n - 4;
    const vcount = n * n + skirt;
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3);
    const v = new THREE.Vector3();
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = c.x0 + i * step, z = c.z0 + j * step;
      pos[k * 3] = x; pos[k * 3 + 1] = hf.height(x, z); pos[k * 3 + 2] = z;
      // smoother normals at coarser LODs so shading stays stable across transitions
      const e = Math.max(0.5, step * 0.5);
      v.set(hf.height(x - e, z) - hf.height(x + e, z), 2 * e, hf.height(x, z - e) - hf.height(x, z + e)).normalize();
      nor[k * 3] = v.x; nor[k * 3 + 1] = v.y; nor[k * 3 + 2] = v.z;
      k++;
    }
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      idx.push(a, cc, b, cc, d, b);
    }
    // skirts: duplicate the border ring, pushed down, stitched to the edge
    const ring = [];
    for (let i = 0; i < n; i++) ring.push(i);
    for (let j = 1; j < n; j++) ring.push(j * n + n - 1);
    for (let i = n - 2; i >= 0; i--) ring.push((n - 1) * n + i);
    for (let j = n - 2; j >= 1; j--) ring.push(j * n);
    const drop = 1.5 * step;
    const base = k;
    for (const r of ring) {
      pos[k * 3] = pos[r * 3]; pos[k * 3 + 1] = pos[r * 3 + 1] - drop; pos[k * 3 + 2] = pos[r * 3 + 2];
      nor[k * 3] = nor[r * 3]; nor[k * 3 + 1] = nor[r * 3 + 1]; nor[k * 3 + 2] = nor[r * 3 + 2];
      k++;
    }
    for (let q = 0; q < ring.length; q++) {
      const a = ring[q], b = ring[(q + 1) % ring.length], a2 = base + q, b2 = base + ((q + 1) % ring.length);
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // double-sided so either winding hides the gap
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  update(camPos) {
    for (const c of this.chunks) {
      const d = Math.hypot(camPos.x - c.cx, camPos.z - c.cz);
      const lod = d < 110 ? 0 : d < 230 ? 1 : d < 420 ? 2 : 3;
      if (lod !== c.lod) {
        if (!c.geos[lod]) c.geos[lod] = this.buildGeometry(c, lod);
        c.mesh.geometry = c.geos[lod];
        c.lod = lod;
      }
    }
  }

  makeMaterial(gen, tex, manifest, quality) {
    const mkSplat = (d, res) => {
      const t = new THREE.DataTexture(d, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
      return t;
    };
    const layers = manifest.terrain.layers;
    const scales = layers.map((l) => 1 / l.size_m);
    const mat = new THREE.MeshStandardMaterial({ name: 'terrain', roughness: 1, metalness: 0 });
    withWorldPos(mat);
    const u = {
      tAlb: { value: tex.diff }, tNor: { value: tex.nor }, tArh: { value: tex.arh },
      tFineA: { value: mkSplat(gen.fine.A, WORLD.splatRes) }, tFineB: { value: mkSplat(gen.fine.B, WORLD.splatRes) },
      tCoarseA: { value: mkSplat(gen.coarse.A, 256) }, tCoarseB: { value: mkSplat(gen.coarse.B, 256) },
      uScale: { value: scales },
      uFine: { value: new THREE.Vector2(WORLD.splatSize, WORLD.splatRes) },
      uWorld: { value: WORLD.size },
      uDetail: { value: quality.terrainDetail },
    };
    this.uniforms = u;
    patch(mat, {
      key: 'terrain',
      uniforms: u,
      fragmentHead: NOISE_GLSL + /* glsl */`
        precision highp sampler2DArray;
        uniform sampler2DArray tAlb, tNor, tArh;
        uniform sampler2D tFineA, tFineB, tCoarseA, tCoarseB;
        uniform float uScale[6];
        uniform vec2 uFine;
        uniform float uWorld, uDetail;
        vec3 dzTerrainN;
        float dzTerrainAO, dzTerrainRough;
        void dzSplat(vec2 xz, out float w[6], out float occ, out float forest) {
          vec2 uvC = (xz + 0.5 * uWorld) / uWorld;
          vec4 a = texture(tCoarseA, uvC), b = texture(tCoarseB, uvC);
          vec2 uvF = (xz + 0.5 * uFine.x) / uFine.x;
          vec2 e = min(uvF, 1.0 - uvF);
          float inF = smoothstep(0.0, 0.04, min(e.x, e.y));
          if (inF > 0.0) {
            // jitter the lookup a little so texel-scale blends read as organic edges, not bilinear ramps
            vec2 j = (vec2(dz_noise(xz * 1.7), dz_noise(xz * 1.7 + 19.0)) - 0.5) * (1.1 / uFine.y);
            a = mix(a, texture(tFineA, uvF + j), inF);
            b = mix(b, texture(tFineB, uvF + j), inF);
          }
          w[0] = a.r; w[1] = a.g; w[2] = a.b; w[3] = a.a; w[4] = b.r; w[5] = b.g;
          occ = b.b; forest = b.a;
        }
      `,
      fragment: [
        ['#include <map_fragment>', /* glsl */`
        {
          vec2 xz = vDzWorld.xz;
          float w[6]; float occ, forest;
          dzSplat(xz, w, occ, forest);
          float dist = length(vDzWorld - cameraPosition);
          float detail = uDetail * (1.0 - smoothstep(60.0, 140.0, dist));
          // anti-tiling: second, rotated & scaled sample blended by low-frequency noise
          float blendN = smoothstep(0.3, 0.7, dz_noise(xz * 0.045));
          const mat2 R = mat2(0.8, -0.6, 0.6, 0.8);
          vec3 alb[6]; vec3 arh[6]; float hsum[6];
          float hmax = -1.0;
          for (int i = 0; i < 6; i++) {
            alb[i] = vec3(0.0); arh[i] = vec3(1.0, 1.0, 0.5); hsum[i] = -1.0;
            if (w[i] < 0.004) continue;
            vec2 uv = vec2(xz.x, -xz.y) * uScale[i];
            vec3 a1 = texture(tAlb, vec3(uv, float(i))).rgb;
            vec3 h1 = texture(tArh, vec3(uv, float(i))).rgb;
            if (detail > 0.01) {
              vec2 uv2 = R * uv * 0.61 + vec2(0.37, 0.71);
              vec3 a2 = texture(tAlb, vec3(uv2, float(i))).rgb;
              vec3 h2 = texture(tArh, vec3(uv2, float(i))).rgb;
              float k = blendN * detail;
              a1 = mix(a1, a2, k); h1 = mix(h1, h2, k);
            }
            alb[i] = a1; arh[i] = h1;
            hsum[i] = h1.b + w[i] * 1.6;
            hmax = max(hmax, hsum[i]);
          }
          // height blending: taller material features (stones, grass tufts) win at transitions
          float depth = 0.28;
          vec3 A = vec3(0.0), H = vec3(0.0), Nn = vec3(0.0); float bs = 0.0;
          for (int i = 0; i < 6; i++) {
            if (hsum[i] < 0.0) continue;
            float b = max(hsum[i] - (hmax - depth), 0.0);
            if (b <= 0.0) continue;
            vec2 uv = vec2(xz.x, -xz.y) * uScale[i];
            A += alb[i] * b; H += arh[i] * b;
            Nn += (texture(tNor, vec3(uv, float(i))).xyz * 2.0 - 1.0) * b;
            bs += b;
          }
          A /= bs; H /= bs; Nn /= bs;
          // large-scale variation: sun-bleached dry patches, damp darker hollows, forest shade tint
          float m1 = dz_fbm(xz * 0.018), m2 = dz_fbm(xz * 0.11 + 7.0);
          float grassy = w[0] + w[1];
          A *= mix(0.86, 1.10, m1);
          A = mix(A, A * vec3(1.12, 1.04, 0.78), grassy * smoothstep(0.45, 0.8, m2) * 0.55);
          A = mix(A, A * vec3(0.86, 0.9, 0.82), forest * 0.4);
          diffuseColor.rgb *= A;
          dzTerrainN = normalize(vec3(Nn.xy, max(Nn.z, 0.05)));
          dzTerrainAO = H.r * mix(1.0, occ, 0.9);
          dzTerrainRough = H.g;
        }`],
        ['#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * dzTerrainRough;'],
        ['#include <normal_fragment_maps>', /* glsl */`
        {
          vec3 Nw = normalize(normal * mat3(viewMatrix));            // view -> world
          vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x);
          vec3 B = cross(Nw, T);
          vec3 nw = normalize(T * dzTerrainN.x + B * dzTerrainN.y + Nw * dzTerrainN.z);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`],
        ['#include <aomap_fragment>', /* glsl */`
        {
          float ambientOcclusion = dzTerrainAO;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
          #endif
        }`],
      ],
    });
    return mat;
  }
}

import * as THREE from 'three';
import { WORLD } from './layout.js';
import { mulberry32 } from './noise.js';
import { patch, shared, WIND_GLSL, NOISE_GLSL } from './shaderlib.js';

// Geometric grass: clumps of curved, tapered blades instanced around the
// player. Density follows the terrain splat (grass & meadow layers, thinned
// under forest, absent on roads/mud/rock); height/colour vary with a meadow
// mask. Two geometric LODs; clumps shrink into the ground at the edge of the
// grass radius so there is no visible boundary.

const CELL = 4;

function clumpGeometry(blades, segs, seed, tall) {
  const rnd = mulberry32(seed);
  const pos = [], nor = [], col = [], uv = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const r = Math.sqrt(rnd()) * 0.28, a = rnd() * Math.PI * 2;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = (tall ? 0.28 + rnd() * 0.42 : 0.12 + rnd() * 0.18);
    const w = (tall ? 0.0055 : 0.005) + rnd() * 0.004;
    const facing = rnd() * Math.PI * 2;
    const bend = (0.15 + rnd() * 0.45) * h;
    const fx = Math.cos(facing), fz = Math.sin(facing);   // bend direction
    const sx = -fz, sz = fx;                               // blade width direction
    const shade = 0.75 + rnd() * 0.5;
    const dry = rnd() < (tall ? 0.22 : 0.08) ? 1 : 0;       // some dead straw
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = h * t, off = bend * t * t;
      const ww = w * (1 - t * 0.92);
      const cx = bx + fx * off, cz = bz + fz * off;
      // normal: across-blade normal tilted up (soft, grass-like shading)
      const nx = fx * 0.35, ny = 0.9, nz = fz * 0.35;
      for (const s of [-1, 1]) {
        pos.push(cx + sx * ww * s, y, cz + sz * ww * s);
        nor.push(nx + sx * s * 0.25, ny, nz + sz * s * 0.25);
        uv.push(s * 0.5 + 0.5, t);
        col.push(shade, dry, t);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function grassMaterial() {
  const m = new THREE.MeshStandardMaterial({ name: 'grass', vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  const u = { uPlayer: { value: new THREE.Vector3(1e6, 0, 0) }, uFade: { value: new THREE.Vector2(30, 40) } };
  m.userData.u = u;
  patch(m, {
    key: 'grass',
    uniforms: { ...shared, ...u },
    vertexHead: WIND_GLSL + NOISE_GLSL + `uniform vec3 uPlayer; uniform vec2 uFade; varying vec3 vGrass; varying vec3 vInstTint;`,
    vertex: [
      ['#include <color_vertex>', `
        // colour: vColor = (shade, dry, heightFraction) -> real albedo
        vGrass = color;
        vColor = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vInstTint = instanceColor.rgb;
        #else
          vInstTint = vec3(1.0);
        #endif`],
      ['#include <project_vertex>', /* glsl */`
        vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
        vec2 ip = instanceMatrix[3].xz;
        float t = color.z;
        // shrink at the edge of the grass radius
        float dist = distance(ip, cameraPosition.xz);
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, dist);
        mvPosition.xyz = instanceMatrix[3].xyz + (mvPosition.xyz - instanceMatrix[3].xyz) * vec3(1.0, fade, 1.0);
        // wind: gust field + per-clump phase, grows with blade height^2
        float g = dz_gust(ip) * uWindStrength;
        float ph = dz_hash12(ip * 3.7) * 6.283;
        vec2 w = uWindDir * (0.12 + 0.1 * sin(uTime * 1.9 + ph + ip.x * 0.3)) * g;
        // push away from the player's legs
        vec2 away = ip - uPlayer.xz;
        float pd = length(away);
        vec2 push = pd < 0.9 ? normalize(away + 1e-4) * (0.9 - pd) * 0.9 : vec2(0.0);
        vec2 off = (w + push) * t * t;
        mvPosition.xz += off;
        mvPosition.y -= dot(off, off) * 0.5;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`],
    ],
    fragmentHead: 'varying vec3 vGrass; varying vec3 vInstTint;',
    fragment: [['#include <color_fragment>', /* glsl */`
        {
          vec3 base = vec3(0.025, 0.045, 0.012), tip = vec3(0.13, 0.19, 0.05);
          vec3 straw = vec3(0.26, 0.22, 0.12);
          vec3 c = mix(base, tip, smoothstep(0.0, 1.0, vGrass.z));
          c = mix(c, straw * mix(0.6, 1.0, vGrass.z), vGrass.y);
          diffuseColor.rgb *= c * vGrass.x * vInstTint;
        }`]],
  });
  return m;
}

export async function build(ctx) {
  const { scene, hf, gen, collision } = ctx;
  const mat = grassMaterial();
  const geos = {
    near: [clumpGeometry(26, 5, 1, true), clumpGeometry(32, 3, 2, false)],
    far: [clumpGeometry(12, 3, 3, true), clumpGeometry(14, 2, 4, false)],
  };
  const maxInst = 60000;
  const meshes = {};
  for (const lod of ['near', 'far']) {
    meshes[lod] = geos[lod].map((g, i) => {
      const m = new THREE.InstancedMesh(g, mat, maxInst);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxInst * 3), 3);
      m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false; m.count = 0;
      m.name = `grass-${lod}-${i}`;
      scene.add(m);
      ctx.foliage.push(m);
      return m;
    });
  }

  // Density & character from the fine splat map (0.375 m texels)
  const S = WORLD.splatSize, R = WORLD.splatRes;
  const sample = (x, z) => {
    const i = Math.floor(((x + S / 2) / S) * R), j = Math.floor(((z + S / 2) / S) * R);
    if (i < 0 || j < 0 || i >= R || j >= R) return null;
    const k = (j * R + i) * 4;
    return { grass: gen.fine.A[k] / 255, meadow: gen.fine.A[k + 1] / 255, forest: gen.fine.B[k + 3] / 255, mud: gen.fine.B[k] / 255, occ: gen.fine.B[k + 2] / 255 };
  };
  const houseBox = { x0: WORLD.house.x - WORLD.house.w / 2 - 0.25, x1: WORLD.house.x + WORLD.house.w / 2 + 0.25, z0: WORLD.house.z - WORLD.house.d / 2 - 0.25, z1: WORLD.house.z + WORLD.house.d / 2 + 2.2 };
  const blockers = ctx.grassBlockers || (ctx.grassBlockers = []);

  const cache = new Map();
  const cellData = (ci, cj, density) => {
    const key = ci + ',' + cj;
    if (cache.has(key)) return cache.get(key);
    const rnd = mulberry32((ci * 73856093) ^ (cj * 19349663));
    const out = [];
    const n = Math.round(CELL * CELL * 3.2 * density);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const x = ci * CELL + rnd() * CELL, z = cj * CELL + rnd() * CELL;
      const sp = sample(x, z);
      if (!sp) continue;
      const g = sp.grass + sp.meadow;
      const dens = g * (1 - sp.forest * 0.85) - sp.mud * 0.6;
      if (rnd() > dens * 1.15) continue;
      if (x > houseBox.x0 && x < houseBox.x1 && z > houseBox.z0 && z < houseBox.z1) continue;
      let blocked = false;
      for (const b of blockers) if (Math.abs(x - b.x) < b.hx && Math.abs(z - b.z) < b.hz) { blocked = true; break; }
      if (blocked) continue;
      const tall = rnd() < 0.25 + sp.meadow * 0.7 ? 0 : 1;
      hf.normal(x, z, nrm);
      q.setFromUnitVectors(up, nrm.lerp(up, 0.5).normalize());
      q.multiply(new THREE.Quaternion().setFromEuler(e.set(0, rnd() * 6.283, 0)));
      const sc = (0.75 + rnd() * 0.5) * (tall === 0 ? 0.8 + sp.meadow * 0.35 : 1) * (0.85 + 0.3 * sp.occ);
      m.compose(p.set(x, hf.height(x, z) - 0.02, z), q, s.set(sc, sc * (0.8 + rnd() * 0.4), sc));
      // tint: lush in the lawn, drier/yellower in the meadow, darker under canopy
      const dry = sp.meadow * 0.35 + rnd() * 0.15;
      out.push({ type: tall, m: m.elements.slice(), c: [1 + dry * 0.35, 1 + dry * 0.05, 1 - dry * 0.4].map((v) => v * (0.8 + 0.3 * sp.occ)), x, z });
    }
    cache.set(key, out);
    return out;
  };

  let lastCell = '';
  let q = ctx.q;
  const rebuild = (cam) => {
    const R = q.grassRadius, near = Math.min(16, R * 0.5);
    for (const lod of ['near', 'far']) for (const m of meshes[lod]) m.count = 0;
    const ci0 = Math.floor((cam.position.x - R) / CELL), ci1 = Math.floor((cam.position.x + R) / CELL);
    const cj0 = Math.floor((cam.position.z - R) / CELL), cj1 = Math.floor((cam.position.z + R) / CELL);
    for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) {
      const cx = (ci + 0.5) * CELL - cam.position.x, cz = (cj + 0.5) * CELL - cam.position.z;
      const d = Math.hypot(cx, cz);
      if (d > R + CELL) continue;
      const list = cellData(ci, cj, q.grassDensity);
      const lod = d < near ? 'near' : 'far';
      for (const it of list) {
        const mesh = meshes[lod][it.type];
        if (mesh.count >= maxInst) continue;
        const i = mesh.count++;
        mesh.instanceMatrix.array.set(it.m, i * 16);
        mesh.instanceColor.array.set(it.c, i * 3);
      }
    }
    for (const lod of ['near', 'far']) for (const m of meshes[lod]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    mat.userData.u.uFade.value.set(R * 0.72, R);
  };
  ctx.updaters.push({
    update: (dt, cam, player) => {
      mat.userData.u.uPlayer.value.copy(player.pos);
      const key = Math.floor(cam.position.x / 2) + ',' + Math.floor(cam.position.z / 2);
      if (key !== lastCell) { lastCell = key; rebuild(cam); }
    },
    quality: (nq) => { if (nq.grassDensity !== q.grassDensity) cache.clear(); q = nq; lastCell = ''; },
  });
}

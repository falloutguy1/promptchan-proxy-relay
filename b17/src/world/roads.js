// Road and railway ribbons draped on the (already flattened) terrain, with dirt shoulders,
// sleeper pattern on ballast and real rail geometry. Yard tracks fan out from the main line.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothLine, TARGETS, riverDist, RIVER_W } from './layout.js';

// Material that samples one layer of the terrain texture arrays with ribbon UVs (u across, v along, metres).
export function arrayLayerMaterial(env, assets, layer, opts = {}) {
  const T = assets.terrain;
  const mat = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: opts.offset ?? -2, polygonOffsetUnits: (opts.offset ?? -2) * 4, transparent: !!opts.fadeEdges, depthWrite: !opts.fadeEdges });
  const u = { tD: { value: T.diff || null }, tN: { value: T.nor || null }, tA: { value: T.arm || null } };
  const ok = !!(T.diff && T.nor && T.arm);
  env.material(mat, (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aUV; attribute float aEdge; varying vec2 vRUV; varying float vREdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRUV = aUV; vREdge = aEdge;')
      // pull the ribbon toward the camera with distance so coarse terrain LODs never cover it
      .replace('#include <project_vertex>', `#include <project_vertex>
        { float dd = length(mvPosition.xyz); mvPosition.xyz *= 1.0 - clamp(dd * 0.0022, 0.05, 9.0) / max(dd, 1.0); gl_Position = projectionMatrix * mvPosition; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      precision highp sampler2DArray;
      uniform sampler2DArray tD; uniform sampler2DArray tN; uniform sampler2DArray tA; varying vec2 vRUV; varying float vREdge;
      vec3 R_n; float R_r; float R_ao;`)
      .replace('#include <map_fragment>', `
        {
        vec2 uv = vRUV / ${(opts.tile ?? 3).toFixed(2)};
        ${ok ? `
        vec3 c = texture(tD, vec3(uv, ${layer}.0)).rgb;
        vec3 arm = texture(tA, vec3(uv, ${layer}.0)).rgb;
        R_n = texture(tN, vec3(uv, ${layer}.0)).xyz * 2.0 - 1.0;` : `vec3 c = vec3(0.2); vec3 arm = vec3(1.0,0.9,0.0); R_n = vec3(0,0,1);`}
        ${opts.sleepers ? `
        // timber sleepers every 0.65 m between the rails
        float sl = step(abs(vRUV.x), 1.3) * step(0.62, fract(vRUV.y / 0.65));
        c = mix(c, vec3(0.07,0.055,0.04), sl * 0.85);
        arm.g = mix(arm.g, 0.85, sl);
        ` : ''}
        diffuseColor.rgb *= c;
        R_r = arm.g; R_ao = arm.r;
        ${opts.fadeEdges ? 'diffuseColor.a *= 1.0 - smoothstep(0.55, 1.0, vREdge);' : ''}
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = R_r;')
      .replace('#include <normal_fragment_maps>', `
        normal = normalize(normal + (viewMatrix * vec4(R_n.x, 0.0, R_n.y, 0.0)).xyz * 0.6);`)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= R_ao;');
  }, `arr${layer}_${opts.sleepers ? 's' : ''}${opts.fadeEdges ? 'f' : ''}${ok}`);
  return mat;
}

function ribbon(hf, pts, halfW, lift, edgeInner = 0, deckAt = null) {
  const pos = [], uv = [], edge = [], nrm = [], idx = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    if (i > 0) along += Math.hypot(p.x - a.x, p.z - a.z);
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    const cols = [-1, -0.5, 0, 0.5, 1];
    for (const s of cols) {
      const x = p.x + nx * halfW * s, z = p.z + nz * halfW * s;
      const onBridge = p.bridge;
      const y = onBridge ? p.y + (deckAt ?? 0) : Math.max(hf.height(x, z), p.y - 0.4) + lift;
      pos.push(x, y, z); uv.push(s * halfW, along); edge.push(Math.max(0, (Math.abs(s) - edgeInner) / (1 - edgeInner)));
      nrm.push(0, 1, 0);
    }
    if (i > 0) {
      const b0 = (i - 1) * 5, c0 = i * 5;
      for (let k = 0; k < 4; k++) idx.push(b0 + k, b0 + k + 1, c0 + k, b0 + k + 1, c0 + k + 1, c0 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function railGeometry(hf, pts, gauge = 1.435) {
  // two rails: top + both sides, each 0.07 wide x 0.15 high
  const geoms = [];
  for (const side of [-1, 1]) {
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx;
      const off = side * gauge / 2;
      const cx = p.x + nx * off, cz = p.z + nz * off;
      const y0 = (p.bridge ? p.y : Math.max(hf.height(cx, cz), p.y - 0.4)) + 0.32;
      const w = 0.036;
      pos.push(cx - nx * w, y0, cz - nz * w, cx - nx * w, y0 + 0.15, cz - nz * w, cx + nx * w, y0 + 0.15, cz + nz * w, cx + nx * w, y0, cz + nz * w);
      if (i > 0) {
        const o = (i - 1) * 4, c = i * 4;
        for (let k = 0; k < 3; k++) idx.push(o + k, o + k + 1, c + k, o + k + 1, c + k + 1, c + k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geoms.push(g);
  }
  return mergeGeometries(geoms);
}

function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1;
    return { x: p.x - dz / L * off, z: p.z + dx / L * off, y: p.y, bridge: p.bridge };
  });
}

export class Roads {
  constructor(scene, env, assets, hf) {
    this.group = new THREE.Group();
    this.group.name = 'roads';
    scene.add(this.group);
    const asphalt = arrayLayerMaterial(env, assets, 7, { tile: 4, color: new THREE.Color(2.3, 2.3, 2.4) });
    const cobble = arrayLayerMaterial(env, assets, 8, { tile: 3 });
    const gravel = arrayLayerMaterial(env, assets, 5, { tile: 2.5, color: new THREE.Color(2.2, 2.1, 1.9) });
    const shoulder = arrayLayerMaterial(env, assets, 6, { tile: 3, offset: -1, fadeEdges: true, color: new THREE.Color(1.4, 1.35, 1.25) });
    const ballast = arrayLayerMaterial(env, assets, 5, { tile: 1.6, sleepers: true, color: new THREE.Color(2.0, 2.0, 2.05) });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, metalness: 0.85, roughness: 0.45 });
    env.material(railMat);
    this.railMat = railMat;
    this.yardTracks = [];

    const buckets = new Map();
    const add = (mat, g) => { if (!buckets.has(mat)) buckets.set(mat, []); buckets.get(mat).push(g); };

    for (const line of hf.lines) {
      const pts = line.pts;
      if (line.kind === 'rail') {
        const tracks = [];
        if (line.main) {
          // marshalling yard: 12 tracks fan out between x=-900 and x=1300
          const yard = TARGETS.find(t => t.id === 'yard');
          const N = 12, sp = 4.6;
          for (let k = 0; k < N; k++) {
            const off = (k - (N - 1) / 2) * sp;
            const seg = pts.map((p, i) => {
              const x = p.x;
              const t = Math.min(1, Math.max(0, (x - (yard.x - 1150)) / 200)) * Math.min(1, Math.max(0, ((yard.x + 1150) - x) / 200));
              return { p, i, o: off * (t * t * (3 - 2 * t)) };
            });
            const inYard = seg.filter(s => s.p.x > yard.x - 1200 && s.p.x < yard.x + 1200);
            const tpts = inYard.map(s => { const o = offsetLine(pts, s.o)[s.i]; return o; });
            if (tpts.length > 2) tracks.push(tpts);
          }
          this.yardTracks = tracks;
          // outside the yard: 2 tracks
          for (const o of [-2.3, 2.3]) {
            const outer = offsetLine(pts, o);
            tracks.push(outer.filter(p => p.x < yard.x - 1180), outer.filter(p => p.x > yard.x + 1180));
          }
        } else {
          tracks.push(pts);
        }
        for (const t of tracks) {
          if (t.length < 2) continue;
          add(ballast, ribbon(hf, t, 2.2, 0.28, 0, 0.1));
          add(shoulder, ribbon(hf, t, 4.4, 0.12, 0.45));
          add(railMat, railGeometry(hf, t));
        }
      } else {
        const mat = line.kind === 'asphalt' ? asphalt : gravel;
        add(mat, ribbon(hf, pts, line.w / 2, 0.22, 0, 0.35));
        add(shoulder, ribbon(hf, pts, line.w / 2 + 2.6, 0.1, 0.6));
      }
    }
    // town cobbled streets are generated by the building layout and added via addStreet()
    this.cobble = cobble;
    this.gravel = gravel;
    this.shoulder = shoulder;
    this.buckets = buckets;
    this.hf = hf;
  }

  addStreet(pts, width, gravel = false) {
    const sm = smoothLine(pts, 6).map(p => ({ ...p, y: this.hf.height(p.x, p.z) }));
    const mat = gravel ? this.gravel : this.cobble;
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(ribbon(this.hf, sm, width / 2, 0.2, 0, 0));
    if (!this.buckets.has(this.shoulder)) this.buckets.set(this.shoulder, []);
    this.buckets.get(this.shoulder).push(ribbon(this.hf, sm, width / 2 + 1.8, 0.1, 0.6));
  }

  addPolygon(poly) {
    // flat cobbled plaza: fan triangulation of a convex polygon draped on terrain
    const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, z: a.z + p.z / poly.length }), { x: 0, z: 0 });
    const pos = [], uv = [], idx = [];
    const vs = [c, ...poly];
    for (const v of vs) { pos.push(v.x, this.hf.height(v.x, v.z) + 0.22, v.z); uv.push(v.x, v.z); }
    for (let i = 1; i <= poly.length; i++) idx.push(0, i % poly.length + 1, i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(vs.length), 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.array[1] < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
    if (!this.buckets.has(this.cobble)) this.buckets.set(this.cobble, []);
    this.buckets.get(this.cobble).push(g);
  }

  addPlaza(x, z, w, d) {
    const pts = [];
    for (let k = 0; k <= 8; k++) pts.push({ x: x - w / 2 + w * k / 8, z, y: this.hf.height(x - w / 2 + w * k / 8, z) });
    if (!this.buckets.has(this.cobble)) this.buckets.set(this.cobble, []);
    this.buckets.get(this.cobble).push(ribbon(this.hf, pts, d / 2, 0.22, 0, 0));
  }

  finalize() {
    for (const [mat, list] of this.buckets) {
      // split into spatial chunks so frustum culling works
      const chunks = new Map();
      for (const g of list) {
        g.computeBoundingBox();
        const c = g.boundingBox.getCenter(new THREE.Vector3());
        const key = `${Math.floor(c.x / 2048)}_${Math.floor(c.z / 2048)}`;
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(g);
      }
      for (const gs of chunks.values()) {
        const m = new THREE.Mesh(mergeGeometries(gs.map(g => { if (!g.attributes.aUV) { g.setAttribute('aUV', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.setAttribute('aEdge', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1)); } return g; })), mat);
        m.receiveShadow = true;
        m.renderOrder = mat.transparent ? 2 : 0;
        this.group.add(m);
      }
    }
  }
}

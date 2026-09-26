import * as THREE from 'three';
import { generateTree } from './vendor/eztree/generator.js';
import { PRESETS } from './vendor/eztree/presets.js';
import { WORLD, forestMask, trailField, roadField, driveField } from './layout.js';
import { mulberry32, makeSimplex, fbm, smoothstep } from './noise.js';
import { patch, shared, WIND_GLSL } from './shaderlib.js';

// Trees of a Central/Eastern European mixed forest edge: silver birch,
// Norway spruce, Scots pine, a few old oaks and hazel-like shrubs.
// Each species has several procedurally generated variants (different seeds,
// ages, crown shapes). Instances vary in scale, lean, rotation and leaf colour.
// LOD0 full geometry -> LOD1 (twigs dropped, fewer larger leaf cards) ->
// impostor billboards baked at load time from 8 azimuths under the real sun.

const deep = (o) => JSON.parse(JSON.stringify(o));

function speciesVariants() {
  const V = [];
  const birch = (preset, seed, h, leafMul, tweak = {}) => {
    const o = deep(PRESETS[preset]); o.seed = seed; o.leaves.count = Math.round(o.leaves.count * leafMul);
    o.leaves.size *= 0.85; Object.assign(o.branch.gnarliness, tweak.gn || {});
    if (tweak.angle) o.branch.angle[1] = tweak.angle;
    V.push({ species: 'birch', opt: o, height: h, bark: 'birch', leaf: 'aspen', barkTint: 0xf2f0ea, leafTint: 0x9ed65a });
  };
  birch('aspen_medium', 1811, 17, 2.2);
  birch('aspen_medium', 523, 19, 2.4, { angle: 60 });
  birch('aspen_large', 77, 23, 1.6);
  birch('aspen_small', 9001, 9, 2.4);
  const spruce = (preset, seed, h, tweak = {}) => {
    const o = deep(PRESETS[preset]); o.seed = seed;
    o.leaves.count = Math.round(o.leaves.count * (tweak.leafMul || 1.25));
    o.branch.angle[1] = tweak.angle ?? 118; o.branch.start[1] = tweak.start ?? 0.12;
    o.branch.children[0] = tweak.children ?? o.branch.children[0];
    V.push({ species: tweak.species || 'spruce', opt: o, height: h, bark: 'pine', leaf: 'pine', barkTint: tweak.barkTint ?? 0x8a8078, leafTint: tweak.leafTint ?? 0x5e7a58 });
  };
  spruce('pine_large', 44166, 26);
  spruce('pine_large', 3120, 22, { children: 85 });
  spruce('pine_medium', 812, 15);
  spruce('pine_small', 66, 7, { leafMul: 1.4 });
  // Scots pine: bare lower trunk, crown in the top third, orange upper bark
  spruce('pine_large', 5150, 24, { species: 'pine', start: 0.62, angle: 100, children: 45, leafMul: 1.6, barkTint: 0xd9a27a, leafTint: 0x7c9160 });
  const oak = deep(PRESETS.oak_medium); oak.seed = 2024; oak.leaves.count = Math.round(oak.leaves.count * 1.3);
  V.push({ species: 'oak', opt: oak, height: 15, bark: 'oak', leaf: 'oak', barkTint: 0xb8b0a4, leafTint: 0xc8d8a0 });
  const bush = (preset, seed, h, leaf, tint) => {
    const o = deep(PRESETS[preset]); o.seed = seed; o.leaves.count = Math.round(o.leaves.count * 1.6);
    V.push({ species: 'bush', opt: o, height: h, bark: 'oak', leaf, barkTint: 0x9a8f80, leafTint: tint, bush: true });
  };
  bush('bush_1', 12, 2.6, 'ash', 0xb8cc90);
  bush('bush_2', 34, 2.0, 'aspen', 0x88c060);
  return V;
}

/** Converts generator output into LOD0/LOD1 geometries scaled to real height. */
function buildGeometries(v) {
  const t = generateTree(v.opt);
  const b = t.branches, l = t.leaves;
  let maxY = 0;
  for (let i = 1; i < b.verts.length; i += 3) maxY = Math.max(maxY, b.verts[i]);
  for (let i = 1; i < l.verts.length; i += 3) maxY = Math.max(maxY, l.verts[i]);
  const s = v.height / maxY;
  v.scale = s;
  v.trunkRadius = v.opt.branch.radius[0] * s;
  const barkTile = v.bark === 'birch' ? 1.6 : 1.2; // metres of trunk per texture repeat
  const around = Math.max(1, Math.round((2 * Math.PI * v.trunkRadius) / 0.9));

  const branchGeo = (maxLevel) => {
    const keep = [];
    for (let i = 0; i < b.indices.length; i += 3) {
      if (b.level[b.indices[i]] <= maxLevel) keep.push(b.indices[i], b.indices[i + 1], b.indices[i + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.verts.map((x) => x * s), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
    const uv = new Float32Array(b.uvs.length);
    for (let i = 0; i < b.uvs.length; i += 2) { uv[i] = b.uvs[i] * around; uv[i + 1] = (b.uvs[i + 1] * s) / barkTile; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(b.wind, 1));
    g.setIndex(keep);
    return compact(g);
  };
  // leaf normals bent outward from the crown centre -> soft volumetric shading
  const c = new THREE.Vector3();
  for (let i = 0; i < l.verts.length; i += 3) c.x += l.verts[i], c.y += l.verts[i + 1], c.z += l.verts[i + 2];
  c.multiplyScalar(3 / Math.max(1, l.verts.length));
  const leafGeo = (keepEvery, grow) => {
    const pos = [], nor = [], uv = [], rnd = [], idx = [];
    const per = v.opt.leaves.billboard === 'double' ? 8 : 4;
    const n = l.verts.length / 3 / per;
    const tmp = new THREE.Vector3(), out = new THREE.Vector3(), fn = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      if (k % keepEvery) continue;
      const base = k * per;
      // leaf origin = midpoint of the first quad's bottom edge
      const ox = (l.verts[(base + 1) * 3] + l.verts[(base + 2) * 3]) / 2, oy = (l.verts[(base + 1) * 3 + 1] + l.verts[(base + 2) * 3 + 1]) / 2, oz = (l.verts[(base + 1) * 3 + 2] + l.verts[(base + 2) * 3 + 2]) / 2;
      for (let q = 0; q < per; q++) {
        const vi = base + q;
        tmp.set(l.verts[vi * 3], l.verts[vi * 3 + 1], l.verts[vi * 3 + 2]);
        tmp.set(ox + (tmp.x - ox) * grow, oy + (tmp.y - oy) * grow, oz + (tmp.z - oz) * grow);
        pos.push(tmp.x * s, tmp.y * s, tmp.z * s);
        out.copy(tmp).sub(c); out.y *= 0.6; out.normalize();
        fn.set(l.normals[vi * 3], l.normals[vi * 3 + 1], l.normals[vi * 3 + 2]);
        if (fn.dot(out) < 0) fn.negate();
        fn.lerp(out, 0.75).normalize();
        nor.push(fn.x, fn.y, fn.z);
        uv.push(l.uvs[vi * 2], l.uvs[vi * 2 + 1]);
        rnd.push(l.rand[vi]);
      }
      const o = (pos.length / 3) - per;
      for (let q = 0; q < per; q += 4) idx.push(o + q, o + q + 1, o + q + 2, o + q, o + q + 2, o + q + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 1));
    g.setIndex(idx);
    return g;
  };
  v.geo = [
    { bark: branchGeo(99), leaves: leafGeo(1, 1) },
    { bark: branchGeo(v.opt.type === 'evergreen' ? 0 : 1), leaves: leafGeo(2, 1.38) },
  ];
  for (const g of v.geo) { g.bark.computeBoundingSphere(); g.leaves.computeBoundingSphere(); }
  const box = new THREE.Box3().setFromBufferAttribute(v.geo[0].leaves.attributes.position);
  box.union(new THREE.Box3().setFromBufferAttribute(v.geo[0].bark.attributes.position));
  v.box = box;
}

function compact(g) {
  // drop vertices not referenced by the (possibly filtered) index
  const idx = g.index.array, used = new Int32Array(g.attributes.position.count).fill(-1);
  let n = 0;
  for (const i of idx) if (used[i] < 0) used[i] = n++;
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < used.length; i++) if (used[i] >= 0) for (let k = 0; k < a.itemSize; k++) arr[used[i] * a.itemSize + k] = a.array[i * a.itemSize + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(Array.from(idx, (i) => used[i]));
  return out;
}

const WIND_VERTEX = /* glsl */`
  vec4 mvPosition = vec4( transformed, 1.0 );
  float dzBaseY = 0.0; vec2 dzIP = vec2(0.0); float dzS = 1.0;
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    dzBaseY = instanceMatrix[3].y; dzIP = instanceMatrix[3].xz; dzS = length(instanceMatrix[1].xyz);
  #endif
  {
    float g = dz_gust(dzIP) * uWindStrength;
    float ph = dot(dzIP, vec2(0.131, 0.173));
    float hN = clamp((mvPosition.y - dzBaseY) / (uTreeH * dzS), 0.0, 1.2);
    vec3 wd = vec3(uWindDir.x, 0.0, uWindDir.y);
    // whole-tree sway: quadratic with height, slow
    mvPosition.xyz += wd * (hN * hN) * g * uSway * (0.55 + 0.45 * sin(uTime * 0.7 + ph));
    // branch / leaf flutter
    float f = dzFlutter();
    mvPosition.xyz += (wd * 0.6 + vec3(0.0, 0.5, 0.0)) * f * g * sin(uTime * 3.1 + ph * 7.0 + dzPhase() * 6.283);
  }
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;

function windPatch(mat, v, kind) {
  const u = { uTreeH: { value: v.height }, uSway: { value: v.bush ? 0.05 : 0.09 * (v.height / 20) } };
  const flutter = kind === 'leaves'
    ? 'float dzFlutter(){ return 0.045; } float dzPhase(){ return aRand; }'
    : 'float dzFlutter(){ return aWind * 0.02; } float dzPhase(){ return aWind; }';
  patch(mat, {
    key: 'wind-' + kind,
    uniforms: { ...shared, ...u },
    vertexHead: WIND_GLSL + 'uniform float uTreeH, uSway;\n' + (kind === 'leaves' ? 'attribute float aRand;' : 'attribute float aWind;') + '\n' + flutter,
    vertex: [['#include <project_vertex>', WIND_VERTEX]],
  });
  return mat;
}

function leafMaterial(tex, v) {
  const m = new THREE.MeshStandardMaterial({
    name: 'leaves-' + v.species, map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, metalness: 0,
    color: new THREE.Color(v.leafTint), envMapIntensity: 0.75,
  });
  windPatch(m, v, 'leaves');
  // Alpha-to-mip correction keeps distant crowns from thinning out; simple sun
  // translucency lights leaves from behind.
  patch(m, {
    key: 'leafshade',
    uniforms: { uSunDir: { value: new THREE.Vector3() } },
    fragmentHead: 'uniform vec3 uSunDir;',
    fragment: [
      ['#include <alphatest_fragment>', `
        {
          vec2 dx = dFdx(vMapUv * 1024.0), dy = dFdy(vMapUv * 1024.0);
          float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + mip * 0.22;
        }
        if ( diffuseColor.a < alphaTest ) discard;`],
      ['#include <lights_fragment_end>', `$&
        {
          vec3 V = normalize(vViewPosition);
          float back = pow(saturate(dot(V, -normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz))), 3.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * back * 0.35;
        }`],
    ],
  });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42, side: THREE.DoubleSide });
  windPatch(depth, v, 'leaves');
  return { mat: m, depth };
}

function barkMaterial(set, v) {
  const m = new THREE.MeshStandardMaterial({
    name: 'bark-' + v.species, map: set.diff, normalMap: set.nor, roughnessMap: set.arm, aoMap: set.arm, color: new THREE.Color(v.barkTint),
    roughness: 1, metalness: 0,
  });
  windPatch(m, v, 'bark');
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  windPatch(depth, v, 'bark');
  return { mat: m, depth };
}

// ---------------------------------------------------------------------------
// Impostors: 8 azimuth views per variant rendered under the scene's sun & sky.
const VIEWS = 8, CELL_W = 128, CELL_H = 256;

function bakeImpostors(renderer, variants, sky, mats) {
  const rows = variants.length;
  const rt = new THREE.WebGLRenderTarget(CELL_W * VIEWS, CELL_H * rows, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const scene = new THREE.Scene();
  scene.environment = sky.envRT.texture;
  scene.environmentIntensity = sky.scene.environmentIntensity;
  const sun = new THREE.DirectionalLight(sky.sun.color, sky.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const cam = new THREE.OrthographicCamera();
  const prev = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), tm: renderer.toneMapping };
  shared.uWindStrength.value = 0;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x3a4a2a, 0);
  renderer.clear();
  variants.forEach((v, row) => {
    const g = new THREE.Group();
    const bark = new THREE.Mesh(v.geo[0].bark, mats[row].bark.mat);
    const leaves = new THREE.Mesh(v.geo[0].leaves, mats[row].leaves.mat);
    bark.customDepthMaterial = mats[row].bark.depth; leaves.customDepthMaterial = mats[row].leaves.depth;
    bark.castShadow = leaves.castShadow = true; bark.receiveShadow = leaves.receiveShadow = true;
    g.add(bark, leaves);
    scene.add(g);
    const b = v.box, H = b.max.y - Math.min(0, b.min.y);
    const Wd = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    const halfH = Math.max(H, Wd * 2) / 2 * 1.04, halfW = halfH / 2;
    v.imp = { w: halfW * 2, h: halfH * 2, y0: H / 2 - halfH + Math.min(0, b.min.y) };
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH; cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
    const cy = v.imp.y0 + halfH;
    const R = Math.max(H, Wd) * 1.2;
    sun.position.copy(sky.sunDir).multiplyScalar(R * 2).add(new THREE.Vector3(0, cy, 0));
    sun.target.position.set(0, cy, 0);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 0.1; sc.far = R * 4; sc.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
    for (let i = 0; i < VIEWS; i++) {
      const a = (i / VIEWS) * Math.PI * 2, el = 0.1;
      cam.position.set(Math.sin(a) * 150 * Math.cos(el), cy + 150 * Math.sin(el), Math.cos(a) * 150 * Math.cos(el));
      cam.lookAt(0, cy, 0);
      const x = i * CELL_W, y = row * CELL_H;
      rt.viewport.set(x, y, CELL_W, CELL_H); rt.scissor.set(x, y, CELL_W, CELL_H); rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
    scene.remove(g);
  });
  rt.scissorTest = false;
  rt.viewport.set(0, 0, rt.width, rt.height);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.clear, prev.alpha);
  shared.uWindStrength.value = 1;
  return rt;
}

function impostorMaterial(atlas, rows) {
  return new THREE.ShaderMaterial({
    name: 'treeImpostor',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tAtlas: { value: null }, uRows: { value: rows } }]),
    vertexShader: /* glsl */`
      attribute vec4 iPos; attribute vec4 iSize;
      uniform float uRows;
      varying vec2 vUv; varying float vShade;
      #include <fog_pars_vertex>
      void main() {
        vec3 toCam = cameraPosition - iPos.xyz; toCam.y = 0.0;
        vec3 dir = normalize(toCam + vec3(1e-4, 0.0, 0.0));
        vec3 right = vec3(dir.z, 0.0, -dir.x);
        float ang = atan(dir.x, dir.z) - iPos.w;
        float view = mod(floor(ang / 6.2831853 * ${VIEWS}.0 + 0.5), ${VIEWS}.0);
        vUv = vec2((view + uv.x) / ${VIEWS}.0, (iSize.z + uv.y) / uRows);
        vShade = iSize.w;
        vec3 p = iPos.xyz + right * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tAtlas;
      varying vec2 vUv; varying float vShade;
      #include <fog_pars_fragment>
      void main() {
        vec4 c = texture2D(tAtlas, vUv);
        if (c.a < 0.5) discard;
        gl_FragColor = vec4(c.rgb * vShade, 1.0);
        #include <fog_fragment>
      }`,
    fog: true,
  });
}

// ---------------------------------------------------------------------------
export async function build(ctx) {
  const { assets, scene, hf, collision, sky, renderer, camera } = ctx;
  const variants = speciesVariants();
  variants.forEach(buildGeometries);

  const barkSets = {}, leafTex = {};
  await Promise.all(['birch', 'pine', 'oak'].map(async (b) => {
    const [diff, nor, arm] = await Promise.all([
      assets.ktx(`assets/trees/bark_${b}_diff.ktx2`, THREE.SRGBColorSpace), assets.ktx(`assets/trees/bark_${b}_nor.ktx2`), assets.ktx(`assets/trees/bark_${b}_arm.ktx2`)]);
    barkSets[b] = { diff, nor, arm };
  }));
  await Promise.all(['aspen', 'pine', 'oak', 'ash'].map(async (l) => {
    const t = await assets.ktx(`assets/trees/leaf_${l}.ktx2`, THREE.SRGBColorSpace);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    leafTex[l] = t;
  }));
  const mats = variants.map((v) => ({ bark: barkMaterial(barkSets[v.bark], v), leaves: leafMaterial(leafTex[v.leaf], v) }));
  const setSun = (m) => { const s = m.userData.shader; if (s?.uniforms.uSunDir) s.uniforms.uSunDir.value.copy(sky.sunDir); };

  // ---------------- placement ----------------
  const rnd = mulberry32(4242);
  const nClump = makeSimplex(71);
  const trees = [];
  const half = WORLD.size / 2 - 8;
  const cell = 5.2;
  const byName = (sp) => variants.map((v, i) => (v.species === sp ? i : -1)).filter((i) => i >= 0);
  const V = { birch: byName('birch'), spruce: byName('spruce'), pine: byName('pine'), oak: byName('oak'), bush: byName('bush') };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  for (let gz = -half; gz < half; gz += cell) for (let gx = -half; gx < half; gx += cell) {
    const x = gx + rnd() * cell, z = gz + rnd() * cell;
    const fm = forestMask(x, z);
    const clump = fbm(nClump, x / 38, z / 38, 3);
    const dens = fm * (0.62 + 0.55 * clump) + 0.012 * smoothstep(0.1, 0.6, clump) * (1 - fm);
    if (rnd() > dens) continue;
    if (trailField.nearest(x, z, 3)) continue;
    // species by setting: birch pioneers the edges and open ground; spruce dominates deep shade
    const edge = 1 - smoothstep(0.35, 0.85, fm);
    const r = rnd();
    let vi;
    if (fm < 0.15) vi = r < 0.75 ? pick(V.birch) : r < 0.9 ? pick(V.oak) : pick(V.pine);
    else if (r < edge * 0.65) vi = pick(V.birch);
    else if (r < edge * 0.65 + 0.14) vi = pick(V.pine);
    else vi = pick(V.spruce);
    addTree(vi, x, z, fm);
    // understorey shrubs along edges
    if (edge > 0.3 && fm > 0.1 && rnd() < 0.35) addTree(pick(V.bush), x + (rnd() - 0.5) * 4, z + (rnd() - 0.5) * 4, fm);
  }
  // Specimen trees that frame the farmstead (a yard birch group, an old oak by the road, a lone pine)
  const specimens = [
    [V.oak[0], -13.5, 12.5, 1.15], [V.birch[1], 9.5, -8.5, 1.0], [V.birch[0], 12.2, -6.6, 0.9], [V.birch[2], 11.0, -11.2, 1.05],
    [V.birch[3], -12.0, -7.0, 1.0], [V.bush[0], -9.2, 6.8, 1.0], [V.bush[1], 8.2, 7.2, 0.9], [V.pine[0], 26, 4, 1.0],
    [V.birch[1], 19, 30, 1.1], [V.birch[0], 22, 33, 0.95], [V.bush[0], 16, 12.5, 1.1],
  ];
  for (const [vi, x, z, s] of specimens) addTree(vi, x, z, 0, s);

  function addTree(vi, x, z, fm, forcedScale) {
    if (Math.abs(x) > half || Math.abs(z) > half) return;
    const v = variants[vi];
    if (!forcedScale) {
      // keep clear of the road, driveway, house
      if (roadField.nearest(x, z, 8)) return;
      if (driveField.nearest(x, z, 4)) return;
      if (Math.abs(x - WORLD.house.x) < 13 && Math.abs(z - WORLD.house.z - 2) < 14) return;
      if (Math.hypot(x - WORLD.pond.x, z - WORLD.pond.z) < WORLD.pond.r + 3) return;
    }
    const s = forcedScale ?? (0.78 + rnd() * 0.45) * (v.bush ? 1 : 0.9 + 0.2 * fm);
    const yaw = rnd() * Math.PI * 2;
    // lean: slight, stronger at forest edges (phototropism towards open ground)
    const lean = (v.bush ? 0.02 : 0.035) * rnd() + (fm > 0.1 && fm < 0.6 ? 0.03 : 0);
    const leanDir = rnd() * Math.PI * 2;
    const y = hf.height(x, z) - 0.12 * s;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.cos(leanDir) * lean, yaw, Math.sin(leanDir) * lean, 'YXZ'));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.92 + rnd() * 0.16), s));
    // leaf colour: per-tree hue/brightness jitter, a few birches turning early
    const c = new THREE.Color(1, 1, 1);
    const k = 0.85 + rnd() * 0.25;
    c.setRGB(k * (0.94 + rnd() * 0.12), k, k * (0.9 + rnd() * 0.15));
    if (v.species === 'birch' && rnd() < 0.18) c.setRGB(1.25, 1.05, 0.62);
    const h = v.height * s;
    trees.push({ vi, x, y, z, yaw, s, h, m: m.elements.slice(), c, shade: 0.9 + rnd() * 0.2 });
    if (!v.bush) collision.circle(x, z, Math.max(0.12, v.trunkRadius * s * 0.9), y, y + h);
  }
  ctx.trees = trees;

  // ---------------- meshes ----------------
  const group = new THREE.Group(); group.name = 'vegetation';
  scene.add(group);
  const counts = variants.map((_, i) => trees.filter((t) => t.vi === i).length);
  const buckets = variants.map((v, i) => [0, 1].map((lod) => {
    const n = Math.max(1, counts[i]);
    const bark = new THREE.InstancedMesh(v.geo[lod].bark, mats[i].bark.mat, n);
    const leaves = new THREE.InstancedMesh(v.geo[lod].leaves, mats[i].leaves.mat, n);
    bark.customDepthMaterial = mats[i].bark.depth; leaves.customDepthMaterial = mats[i].leaves.depth;
    for (const m of [bark, leaves]) {
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
      group.add(m);
    }
    ctx.foliage.push(leaves);
    return { bark, leaves };
  }));
  // impostors
  const atlas = bakeImpostors(renderer, variants, sky, mats);
  const impMat = impostorMaterial(atlas, variants.length);
  impMat.uniforms.tAtlas.value = atlas.texture;
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = quad.index; ig.attributes.position = quad.attributes.position; ig.attributes.uv = quad.attributes.uv;
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(trees.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const iSize = new THREE.InstancedBufferAttribute(new Float32Array(trees.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
  ig.setAttribute('iPos', iPos); ig.setAttribute('iSize', iSize);
  ig.instanceCount = 0;
  const imp = new THREE.Mesh(ig, impMat);
  imp.frustumCulled = false;
  imp.name = 'treeImpostors';
  group.add(imp);
  ctx.foliage.push(imp);
  ctx.impostorAtlas = atlas;

  // ---------------- per-frame LOD assignment ----------------
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const lastPos = new THREE.Vector3(1e9), lastDir = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let timer = 0;
  let q = ctx.q;
  const update = (dt, cam) => {
    timer += dt;
    for (const m of mats) setSun(m.leaves.mat);
    cam.getWorldDirection(dir);
    if (cam.position.distanceToSquared(lastPos) < 0.25 && dir.dot(lastDir) > 0.9995 && timer < 0.5) return;
    timer = 0; lastPos.copy(cam.position); lastDir.copy(dir);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    const d0 = (q.treeFullDist * 0.42) ** 2, d1 = q.treeFullDist ** 2, d2 = q.treeImpostorDist ** 2;
    const shadowR2 = (q.shadowRadius * 1.3) ** 2;
    for (const b of buckets) for (const l of b) { l.bark.count = 0; l.leaves.count = 0; }
    let ni = 0;
    const cx = cam.position.x, cz = cam.position.z;
    for (const t of trees) {
      const dx = t.x - cx, dz = t.z - cz, d = dx * dx + dz * dz;
      if (d > d2) continue;
      sphere.center.set(t.x, t.y + t.h * 0.5, t.z); sphere.radius = t.h * 0.6;
      const inView = frustum.intersectsSphere(sphere);
      if (d < d1) {
        if (!inView && d > shadowR2) continue;
        const b = buckets[t.vi][d < d0 ? 0 : 1];
        const i = b.bark.count++;
        b.leaves.count++;
        b.bark.instanceMatrix.array.set(t.m, i * 16);
        b.leaves.instanceMatrix.array.set(t.m, i * 16);
        b.leaves.instanceColor.array[i * 3] = t.c.r; b.leaves.instanceColor.array[i * 3 + 1] = t.c.g; b.leaves.instanceColor.array[i * 3 + 2] = t.c.b;
        b.bark.instanceColor.array[i * 3] = b.bark.instanceColor.array[i * 3 + 1] = b.bark.instanceColor.array[i * 3 + 2] = t.shade;
      } else if (inView) {
        const v = variants[t.vi];
        iPos.array.set([t.x, t.y + v.imp.y0 * t.s, t.z, t.yaw], ni * 4);
        iSize.array.set([v.imp.w * t.s, v.imp.h * t.s, t.vi, t.shade], ni * 4);
        ni++;
      }
    }
    for (const b of buckets) for (const l of b) for (const m of [l.bark, l.leaves]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    ig.instanceCount = ni;
    iPos.needsUpdate = true; iSize.needsUpdate = true;
  };
  ctx.updaters.push({ update: (dt, cam) => update(dt, cam), quality: (nq) => { q = nq; lastPos.set(1e9, 0, 0); } });
  window.__dayz.stats.trees = trees.length;
  window.__dayz.stats.treeTris = variants.map((v) => ({ sp: v.species, lod0: (v.geo[0].bark.index.count + v.geo[0].leaves.index.count) / 3, lod1: (v.geo[1].bark.index.count + v.geo[1].leaves.index.count) / 3 }));
}

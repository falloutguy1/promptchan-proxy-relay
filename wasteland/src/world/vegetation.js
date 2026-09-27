// Trees: procedural species variants (trees.js) placed in natural clusters from
// the terrain's forest density map, drawn with CPU-culled instancing across three
// LODs: full geometry, reduced geometry, and lit billboard impostors captured at
// load time (albedo + normal) so distant forest keeps its shading.
import * as THREE from 'three';
import { RNG, smoothstep } from '../core/rng.js';
import { G, enhance, windDepthMaterial } from '../core/shaderlib.js';
import { growTree, SPECIES } from './trees.js';
import { FORESTS, LOTS, START, inPlay } from './layout.js';

const KINDS = ['conifer', 'birch', 'oak', 'dead'];

// foliage: no back-face normal flip (normals are bent outward), translucency,
// distance-aware alpha so crowns do not thin out in lower mips.
function foliageExtra(atlasSize) {
  return (shader) => {
    const nb = THREE.ShaderChunk.normal_fragment_begin.replaceAll('normal *= faceDirection;', '');
    shader.uniforms.uSunLight = G.uSunLight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSunLight;\n#ifndef USE_FOG\nuniform vec3 uSunDir;\n#endif`)
      .replace('#include <normal_fragment_begin>', nb)
      .replace('#include <alphatest_fragment>', /* glsl */`
	#ifdef USE_ALPHATEST
		{
			vec2 dx = dFdx( vMapUv * ${atlasSize.toFixed(1)} ), dy = dFdy( vMapUv * ${atlasSize.toFixed(1)} );
			float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
			diffuseColor.a *= 1.0 + lod * 0.3;
			if ( diffuseColor.a < alphaTest ) discard;
		}
	#endif`)
      .replace('#include <lights_fragment_end>', /* glsl */`
	#include <lights_fragment_end>
	{
		vec3 Ls = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
		float back = pow( saturate( dot( - geometryViewDir, Ls ) ), 3.0 );
		float wrap = saturate( dot( - normal, Ls ) * 0.5 + 0.5 );
		reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunLight * ( back * 0.3 + wrap * 0.05 );
	}`);
  };
}

const impostorVS = /* glsl */`
attribute vec4 iPos;    // xyz, scale
attribute vec4 iSlot;   // atlas rect u0 v0 u1 v1
attribute vec2 iSize;   // width, height (m) of the captured variant at scale 1
`;

export class Trees {
  constructor(world) {
    this.world = world;
    this.terrain = world.terrain;
    this.settings = world.settings;
    this.group = new THREE.Group();
    this.group.name = 'trees';
    this.instances = [];
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.lastDir = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this.removed = new Set();
  }

  async build(assets) {
    const detail = this.settings.values.treeDetail;
    const texMan = await assets.json('manifest-textures.json');
    const sprites = { fir: texMan.atlases.fir_twig.sprites, clusters: texMan.atlases.leaf_clusters.sprites };
    const [barkSets, firSet, leafSet] = await Promise.all([
      Promise.all(['bark_pine', 'bark_birch', 'bark_oak', 'bark_dead'].map((n) => assets.textureSet(n))),
      assets.textureSet('fir_twig', 'atlas'),
      assets.textureSet('leaf_clusters', 'atlas'),
    ]);
    const barkBy = { conifer: barkSets[0], birch: barkSets[1], oak: barkSets[2], dead: barkSets[3] };
    const windBark = { amp: 0.55, flutter: 0.0 };
    const windLeaf = { amp: 0.55, flutter: 0.06 };

    this.materials = {};
    for (const k of KINDS) {
      const b = barkBy[k];
      const m = new THREE.MeshStandardMaterial({ map: b.map, normalMap: b.normalMap, roughnessMap: b.ormMap, aoMap: b.ormMap, vertexColors: true, roughness: 1, metalness: 0 });
      if (k === 'dead') m.color.setRGB(0.78, 0.76, 0.72);
      enhance(m, { wind: windBark, porosity: 0.8, key: 'bark' });
      this.materials[k] = { bark: m, barkDepth: windDepthMaterial(windBark) };
    }
    const leafMat = (set, size) => {
      const m = new THREE.MeshStandardMaterial({
        map: set.map, normalMap: set.normalMap, roughnessMap: set.ormMap, aoMap: set.ormMap, aoMapIntensity: 0.8,
        vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.42, roughness: 1, metalness: 0,
        normalScale: new THREE.Vector2(0.7, 0.7),
      });
      enhance(m, { wind: windLeaf, porosity: 0.6, key: 'leaf' + size, extra: foliageExtra(size) });
      return m;
    };
    const firMat = leafMat(firSet, 1024), clusterMat = leafMat(leafSet, 1024);
    const firDepth = windDepthMaterial(windLeaf, firSet.map, 0.42), clusterDepth = windDepthMaterial(windLeaf, leafSet.map, 0.42);
    this.materials.conifer.leaf = firMat; this.materials.conifer.leafDepth = firDepth;
    for (const k of ['birch', 'oak']) { this.materials[k].leaf = clusterMat; this.materials[k].leafDepth = clusterDepth; }

    // variants
    const nVar = detail >= 1 ? 4 : detail >= 0.7 ? 3 : 2;
    this.variants = {};
    for (const k of KINDS) {
      this.variants[k] = [];
      for (let v = 0; v < nVar; v++) {
        const seed = 100 + v * 17 + KINDS.indexOf(k) * 1000;
        const lod0 = growTree(k, seed, sprites, 1.0 * Math.max(0.6, detail));
        const lod1 = growTree(k, seed, sprites, 0.32);
        this.variants[k].push({ lod0, lod1, kind: k });
      }
    }
    this.#place();
    this.#buildMeshes();
    this.#buildImpostors(assets);
    return this.group;
  }

  // ------------------------------------------------ placement
  #place() {
    const t = this.terrain, rng = new RNG(4242);
    const cap = { 1.35: 9000, 1: 7500, 0.75: 5200, 0.5: 3200 }[this.settings.values.grassDensity] || 7000;
    const cell = 5.2;
    const half = t.half - 6;
    const pts = [];
    for (let z = -half; z < half; z += cell) {
      for (let x = -half; x < half; x += cell) {
        const px = x + rng.float(0.1, 0.9) * cell, pz = z + rng.float(0.1, 0.9) * cell;
        const f = t.sample(t.forest, px, pz);
        // lone trees in meadows and along field edges
        const meadow = inPlay(px, pz) ? 0.018 : 0.03;
        const p = f > 0.02 ? f : meadow * (1 - t.sample(t.field, px, pz));
        if (rng.next() > p) continue;
        if (t.sample(t.roadDist, px, pz) < 3.5 + rng.float(0, 3)) continue;
        if (t.sample(t.pondDist, px, pz) < 1.5) continue;
        if (t.sample(t.lotMask, px, pz) > 0.25) continue;
        if (Math.hypot(px - START.x, pz - START.z) < START.radius + 4) continue;
        if (t.slope(px, pz) > 0.5) continue;
        // species by region mix, nudged by moisture (birch near water, conifers on high ground)
        let mix = { conifer: 1, birch: 2, oak: 1, dead: 0.35 };
        let best = 1e9;
        for (const F of FORESTS) { const d = Math.hypot(px - F.x, pz - F.z) / F.r; if (d < best) { best = d; mix = F.mix; } }
        const wet = 1 - smoothstep(0, 25, t.sample(t.pondDist, px, pz));
        const high = smoothstep(4, 18, t.height(px, pz));
        const kind = rng.weighted([
          ['conifer', mix.conifer * (1 + high)], ['birch', mix.birch * (1 + wet * 2)], ['oak', mix.oak * (f < 0.1 ? 2 : 1)], ['dead', mix.dead],
        ]);
        pts.push({ x: px, z: pz, kind, f });
      }
    }
    rng.shuffle(pts);
    const chosen = pts.slice(0, cap);
    for (const p of chosen) {
      const vars = this.variants[p.kind];
      const vi = rng.int(0, vars.length - 1);
      const v = vars[vi];
      const age = rng.float(0.55, 1.15) * (p.f > 0.3 ? 1 : rng.float(0.8, 1.1));
      const y = t.height(p.x, p.z);
      this.instances.push({
        x: p.x, y, z: p.z, kind: p.kind, vi, s: age, rot: rng.float(0, Math.PI * 2),
        r: v.lod0.crownRadius * age * 1.3 + 1, h: v.lod0.height * age, lean: 0,
        tint: new THREE.Color(rng.float(0.88, 1.08), rng.float(0.9, 1.06), rng.float(0.82, 1.02)),
        lod: -1,
      });
    }
    // colliders for walk mode (trunks)
    for (const it of this.instances) if (inPlay(it.x, it.z, -40)) this.world.colliders.push({ x: it.x, z: it.z, r: Math.max(0.2, this.variants[it.kind][it.vi].lod0.trunkRadius * it.s * 1.2) });
  }

  // ------------------------------------------------ instanced meshes
  #buildMeshes() {
    this.meshes = [];
    this.proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.byKey = new Map();
    const counts = new Map();
    for (const it of this.instances) counts.set(`${it.kind}:${it.vi}`, (counts.get(`${it.kind}:${it.vi}`) || 0) + 1);
    for (const k of KINDS) {
      this.variants[k].forEach((v, vi) => {
        const cap = counts.get(`${k}:${vi}`) || 0;
        if (!cap) return;
        const mats = this.materials[k];
        const lods = [v.lod0, v.lod1].map((lod, li) => {
          const parts = [];
          const mk = (geo, mat, depth, cast) => {
            const m = new THREE.InstancedMesh(geo, mat, cap);
            m.count = 0;
            m.frustumCulled = false;
            m.castShadow = false;
            m.receiveShadow = true;
            m.customDepthMaterial = depth;
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.setColorAt(0, new THREE.Color(1, 1, 1));
            this.group.add(m);
            this.meshes.push(m);
            return m;
          };
          parts.push(mk(lod.bark, mats.bark, mats.barkDepth, true));
          if (lod.leaves) parts.push(mk(lod.leaves, mats.leaf, mats.leafDepth, li === 0 || this.settings.values.shadowSize >= 4096));
          return parts;
        });
        // shadow proxies: reduced geometry that only draws into the sun's shadow map
        const proxy = [];
        const mkP = (geo, depth, leafMap) => {
          // NB: WebGLShadowMap copies map/alphaTest/side from the object's material onto
          // the custom depth material, so the proxy material carries the cut-out state.
          const pm = leafMap ? this.#leafProxyMaterial(leafMap) : this.proxyMaterial;
          const m = new THREE.InstancedMesh(geo, pm, cap);
          m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = false;
          m.customDepthMaterial = depth;
          // shadow-only: the shadow pass draws all instances; the colour pass draws none
          // (WebGLShadowMap tests layers against the view camera, so layers cannot do this)
          m.onBeforeRender = function () { this.userData.n = this.count; this.count = 0; };
          m.onAfterRender = function () { this.count = this.userData.n; };
          m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          this.group.add(m); this.meshes.push(m);
          return m;
        };
        proxy.push(mkP(v.lod1.bark, mats.barkDepth, null));
        if (v.lod1.leaves) proxy.push(mkP(v.lod1.leaves, mats.leafDepth, mats.leaf.map));
        lods.proxy = proxy;
        this.byKey.set(`${k}:${vi}`, lods);
      });
    }
  }

  #leafProxyMaterial(map) {
    this.leafProxies = this.leafProxies || new Map();
    if (!this.leafProxies.has(map)) this.leafProxies.set(map, new THREE.MeshBasicMaterial({ map, alphaTest: 0.42, side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
    return this.leafProxies.get(map);
  }

  // ------------------------------------------------ impostors
  #buildImpostors() {
    const r = this.world.game.renderer;
    const keys = [...this.byKey.keys()];
    const cols = 8, rows = Math.ceil(keys.length / cols);
    const cw = 192, ch = 384;
    const W = cols * cw, H = rows * ch;
    const rtC = new THREE.WebGLRenderTarget(W, H, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const rtN = new THREE.WebGLRenderTarget(W, H, { samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    rtC.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const capMat = (src, mode) => new THREE.ShaderMaterial({
      uniforms: { map: { value: src.map || null }, useMap: { value: src.map ? 1 : 0 }, mode: { value: mode }, alphaTest: { value: src.alphaTest || 0 } },
      vertexShader: `attribute vec3 color; varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
        void main(){ vUv = uv; vCol = color; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform float useMap; uniform float mode; uniform float alphaTest; varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
        void main(){ vec4 t = useMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
          if (t.a < max(alphaTest, 0.01)) discard;
          vec3 n = normalize(vN); if (!gl_FrontFacing && useMap < 0.5) n = -n;
          gl_FragColor = mode < 0.5 ? vec4(t.rgb * vCol, 1.0) : vec4(n * 0.5 + 0.5, 1.0); }`,
      side: THREE.DoubleSide,
    });
    this.impostorSlots = new Map();
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    for (const [pass, rt] of [[0, rtC], [1, rtN]]) {
      r.setRenderTarget(rt);
      r.setClearColor(pass ? 0x8080ff : 0x000000, 0);
      r.clear(true, true, false);
      keys.forEach((key, i) => {
        const [kind, vi] = key.split(':');
        const v = this.variants[kind][+vi];
        const lod = v.lod1;
        scene.clear();
        const mats = this.materials[kind];
        const bark = new THREE.Mesh(lod.bark, capMat({ map: mats.bark.map }, pass));
        bark.material.uniforms.useMap.value = 1; bark.material.uniforms.alphaTest.value = 0;
        scene.add(bark);
        if (lod.leaves) scene.add(new THREE.Mesh(lod.leaves, capMat({ map: mats.leaf.map, alphaTest: 0.42 }, pass)));
        const bb = new THREE.Box3().setFromObject(scene);
        const halfW = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z)) * 1.02;
        const hgt = bb.max.y - Math.min(0, bb.min.y);
        const hw = Math.max(halfW, hgt / 4);
        cam.left = -hw; cam.right = hw; cam.top = hgt; cam.bottom = 0; cam.near = 0.1; cam.far = hw * 4;
        cam.position.set(0, 0, hw * 2); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
        const cx = i % cols, cy = Math.floor(i / cols);
        r.setViewport(cx * cw, (rows - 1 - cy) * ch, cw, ch);
        r.setScissor(cx * cw, (rows - 1 - cy) * ch, cw, ch);
        r.setScissorTest(true);
        r.render(scene, cam);
        r.setScissorTest(false);
        if (pass === 0) this.impostorSlots.set(key, { u0: (cx * cw) / W, v0: ((rows - 1 - cy) * ch) / H, u1: ((cx + 1) * cw) / W, v1: ((rows - cy) * ch) / H, w: hw * 2, h: hgt });
        scene.traverse((o) => o.material?.dispose?.());
      });
    }
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
    r.setViewport(0, 0, r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio());

    // instanced camera-facing (cylindrical) billboards, lit with the captured normals
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    quad.translate(0, 0.5, 0);
    const n = this.instances.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    geo.attributes.normal = quad.attributes.normal;
    this.impPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.impSlot = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.impSize = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.impPos); geo.setAttribute('iSlot', this.impSlot); geo.setAttribute('iSize', this.impSize);
    geo.instanceCount = 0;
    const mat = new THREE.MeshStandardMaterial({ map: rtC.texture, alphaTest: 0.5, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const normalTex = rtN.texture;
    enhance(mat, {
      porosity: 0.5, key: 'impostor',
      extra: (shader) => {
        shader.uniforms.tImpN = { value: normalTex };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${impostorVS}\nvarying vec2 vImpUv;\nvarying vec3 vImpR;\nvarying vec3 vImpF;`)
          .replace('#include <uv_vertex>', `#include <uv_vertex>\nvImpUv = mix( iSlot.xy, iSlot.zw, uv );\n#ifdef USE_MAP\nvMapUv = vImpUv;\n#endif`)
          .replace('#include <begin_vertex>', /* glsl */`
	vec3 toCam = cameraPosition - iPos.xyz; toCam.y = 0.0;
	vec3 F = normalize( toCam + vec3( 1e-4, 0.0, 0.0 ) );
	vec3 R = normalize( cross( vec3( 0.0, 1.0, 0.0 ), F ) );
	vImpR = R; vImpF = F;
	vec3 transformed = iPos.xyz + R * position.x * iSize.x * iPos.w + vec3( 0.0, 1.0, 0.0 ) * position.y * iSize.y * iPos.w - F * 0.0;`)
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 0.0, 1.0 );')
          .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4( transformed, 1.0 );\ngl_Position = projectionMatrix * mvPosition;')
          .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4( transformed, 1.0 );');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D tImpN;\nvarying vec2 vImpUv;\nvarying vec3 vImpR;\nvarying vec3 vImpF;')
          .replace('#include <normal_fragment_maps>', /* glsl */`
	{
		vec3 cn = texture2D( tImpN, vImpUv ).xyz * 2.0 - 1.0;
		vec3 wN = normalize( vImpR * cn.x + vec3( 0.0, 1.0, 0.0 ) * cn.y + vImpF * cn.z );
		normal = normalize( ( viewMatrix * vec4( wN, 0.0 ) ).xyz );
	}`);
      },
    });
    this.impostors = new THREE.Mesh(geo, mat);
    this.impostors.frustumCulled = false;
    this.impostors.receiveShadow = true;
    this.impostors.castShadow = false;
    this.impostors.name = 'tree-impostors';
    this.group.add(this.impostors);
    this.impRT = [rtC, rtN];
  }

  /** Remove (fell) the tree closest to x,z; returns the removed instance. */
  fell(x, z, maxDist = 4) {
    let best = null, bd = maxDist * maxDist;
    for (const it of this.instances) {
      if (it.removed) continue;
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    if (best) { best.removed = true; this.lastCam.set(1e9, 0, 0); }
    return best;
  }
  nearest(x, z, filter = () => true) {
    let best = null, bd = Infinity;
    for (const it of this.instances) {
      if (it.removed || !filter(it)) continue;
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  // ------------------------------------------------ per-frame LOD + culling
  update(camera, focus, shadowRange, force = false) {
    const cp = camera.position;
    const dir = camera.getWorldDirection(_v);
    if (!force && cp.distanceToSquared(this.lastCam) < 0.8 && dir.dot(this.lastDir) > 0.9995) return;
    const sr2 = shadowRange * shadowRange;
    this.lastCam.copy(cp); this.lastDir.copy(dir);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_pm);
    const d0 = 52 * this.settings.values.treeDetail + 10, d1 = Math.min(this.settings.values.drawDistance * 0.19, 190);
    const counters = new Map();
    for (const m of this.meshes) m.count = 0;
    let imp = 0;
    const iPos = this.impPos.array, iSlot = this.impSlot.array, iSize = this.impSize.array;
    const sph = new THREE.Sphere();
    for (const it of this.instances) {
      if (it.removed) continue;
      const lods = this.byKey.get(`${it.kind}:${it.vi}`);
      if ((it.x - focus.x) ** 2 + (it.z - focus.z) ** 2 < sr2) {
        _m.compose(_p.set(it.x, it.y, it.z), _q.setFromAxisAngle(_up, it.rot), _s.setScalar(it.s));
        for (const mesh of lods.proxy) mesh.setMatrixAt(mesh.count++, _m);
      }
      sph.center.set(it.x, it.y + it.h * 0.5, it.z); sph.radius = Math.max(it.r, it.h * 0.55);
      if (!this.frustum.intersectsSphere(sph)) continue;
      const dist = Math.hypot(cp.x - it.x, cp.z - it.z, (cp.y - it.y) * 0.5);
      if (dist > this.settings.values.drawDistance) continue;
      const key = `${it.kind}:${it.vi}`;
      if (dist < d1) {
        const lod = dist < d0 ? 0 : 1;
        const parts = lods[lod];
        _m.compose(_p.set(it.x, it.y, it.z), _q.setFromAxisAngle(_up, it.rot), _s.setScalar(it.s));
        for (let pi = 0; pi < parts.length; pi++) {
          const mesh = parts[pi];
          const i = mesh.count++;
          mesh.setMatrixAt(i, _m);
          mesh.setColorAt(i, pi === 0 ? _white : it.tint); // part 0 = bark, 1 = foliage
        }
      } else {
        const slot = this.impostorSlots.get(key);
        const k = imp++;
        iPos[k * 4] = it.x; iPos[k * 4 + 1] = it.y - 0.2; iPos[k * 4 + 2] = it.z; iPos[k * 4 + 3] = it.s;
        iSlot[k * 4] = slot.u0; iSlot[k * 4 + 1] = slot.v0; iSlot[k * 4 + 2] = slot.u1; iSlot[k * 4 + 3] = slot.v1;
        iSize[k * 2] = slot.w; iSize[k * 2 + 1] = slot.h;
      }
    }
    for (const m of this.meshes) {
      m.visible = m.count > 0;
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, m.count * 16); m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) { m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, m.count * 3); m.instanceColor.needsUpdate = true; }
    }
    this.impostors.geometry.instanceCount = imp;
    this.impPos.needsUpdate = true; this.impSlot.needsUpdate = true; this.impSize.needsUpdate = true;
    for (const [a, k] of [[this.impPos, 4], [this.impSlot, 4], [this.impSize, 2]]) { a.clearUpdateRanges(); a.addUpdateRange(0, imp * k); }
  }
}

const _white = new THREE.Color(1, 1, 1);
const _v = new THREE.Vector3(), _pm = new THREE.Matrix4(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

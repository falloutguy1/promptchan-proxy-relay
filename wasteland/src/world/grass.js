// GPU grass: two nested instance tiles (dense near field, sparse mid field) that
// wrap around the camera. Every clump samples the terrain height and grass mask in
// the vertex shader, so it is always grounded and follows splat painting (paths,
// soil around new buildings). Cards come from the scanned Poly Haven grass atlas
// (green and dry variants), with wind bending, base occlusion and colour variation.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { G, FOG_PARS, FOG_FRAG } from '../core/shaderlib.js';
import { macroNoiseTexture } from '../gfx/noisetex.js';

// clump sprites in the grass_medium_01 atlas (u0, v0, u1, v1), base at v1
const CLUMPS = [
  [0.20, 0.738, 0.475, 0.893],
  [0.595, 0.748, 0.815, 0.868],
  [0.03, 0.874, 0.205, 0.975],
  [0.245, 0.89, 0.49, 0.998],
  [0.572, 0.886, 0.785, 0.998],
];

function clumpGeometry() {
  const pos = [], uv = [], idx = [];
  const planes = 3;
  for (let p = 0; p < planes; p++) {
    const a = (p / planes) * Math.PI;
    const cx = Math.cos(a), cz = Math.sin(a);
    const base = pos.length / 3;
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 1; i++) {
      const u = i, v = j / 2;
      const x = (u - 0.5) * cx, z = (u - 0.5) * cz;
      pos.push(x, v, z);
      uv.push(u, v);
    }
    for (let j = 0; j < 2; j++) {
      const a0 = base + j * 2, b0 = a0 + 1, c0 = a0 + 2, d0 = a0 + 3;
      idx.push(a0, b0, c0, b0, d0, c0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(world) {
    this.world = world;
    this.terrain = world.terrain;
    this.settings = world.settings;
    this.group = new THREE.Group();
    this.group.name = 'grass';
  }

  async build(assets) {
    const t = this.terrain;
    const set = await assets.textureSet('grass_cards', 'atlas');
    const dry = await assets.optionalKtx(`atlas/grass_cards/${assets.tier}_c2.ktx2`, THREE.SRGBColorSpace);
    // heightfield + mask textures
    const hTex = new THREE.DataTexture(t.h, t.n, t.n, THREE.RedFormat, THREE.FloatType);
    hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true;
    const S = t.n - 1;
    this.maskTex = new THREE.DataTexture(t.grassMask, S, S, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.minFilter = this.maskTex.magFilter = THREE.LinearFilter; this.maskTex.needsUpdate = true;

    const density = this.settings.values.grassDensity;
    const far = this.settings.values.grassDistance;
    this.uniforms = {
      tHeight: { value: hTex }, tMask: { value: this.maskTex }, tSplatB: { value: t.splatB }, tDry: { value: dry }, tNoise: { value: macroNoiseTexture() },
      uTerrain: { value: new THREE.Vector3(t.size, t.half, t.n) },
      uCam: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector2() }, uTile: { value: 32 }, uFade: { value: new THREE.Vector2(0, 16) },
    };
    const geo = clumpGeometry();
    const tiles = [
      { size: 30, spacing: 0.34 / Math.sqrt(density), fade: [0, 15], scale: [0.42, 0.75] },
      { size: far * 2, spacing: 0.85 / Math.sqrt(density), fade: [13, far], scale: [0.55, 0.95] },
    ];
    this.meshes = [];
    tiles.forEach((tile, ti) => {
      const rng = new RNG(900 + ti);
      const n = Math.floor(tile.size / tile.spacing);
      const count = n * n;
      const off = new Float32Array(count * 2), rnd = new Float32Array(count * 4), rect = new Float32Array(count * 4);
      let k = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        off[k * 2] = (i + rng.float(0.05, 0.95)) * tile.spacing; off[k * 2 + 1] = (j + rng.float(0.05, 0.95)) * tile.spacing;
        const tall = rng.next() < 0.08;
        const r = CLUMPS[rng.int(0, CLUMPS.length - 1)];
        rect.set(r, k * 4);
        rnd[k * 4] = rng.float(0, Math.PI);
        rnd[k * 4 + 1] = rng.float(tile.scale[0], tile.scale[1]) * (tall ? 1.45 : 1);
        rnd[k * 4 + 2] = rng.next();
        rnd[k * 4 + 3] = tall ? 1 : 0;
        k++;
      }
      const g = new THREE.InstancedBufferGeometry();
      g.index = geo.index;
      for (const a of ['position', 'uv', 'normal']) g.setAttribute(a, geo.attributes[a]);
      g.setAttribute('gOff', new THREE.InstancedBufferAttribute(off, 2));
      g.setAttribute('gRnd', new THREE.InstancedBufferAttribute(rnd, 4));
      g.setAttribute('gRect', new THREE.InstancedBufferAttribute(rect, 4));
      g.instanceCount = count;
      const mat = this.#material(set, tile);
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = `grass${ti}`;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.meshes.push(mesh);
    });
    return this.group;
  }

  #material(set, tile) {
    const m = new THREE.MeshStandardMaterial({ map: set.map, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    const u = { ...this.uniforms, uTile: { value: tile.size }, uFade: { value: new THREE.Vector2(tile.fade[0], tile.fade[1]) } };
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, G, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
attribute vec2 gOff;
attribute vec4 gRnd;
attribute vec4 gRect;
uniform sampler2D tHeight;
uniform sampler2D tMask;
uniform sampler2D tSplatB;
uniform sampler2D tNoise;
uniform vec3 uTerrain;
uniform vec3 uCam;
uniform vec2 uCenter;
uniform float uTile;
uniform vec2 uFade;
uniform float uTime;
uniform vec4 uWind;
varying float vGrassH;
varying vec3 vGrassTint;
varying float vDry;
float terrainH( vec2 p ) {
	vec2 g = clamp( p + uTerrain.y, vec2( 0.0 ), vec2( uTerrain.x - 0.001 ) );
	ivec2 i = ivec2( floor( g ) );
	vec2 f = fract( g );
	float a = texelFetch( tHeight, i, 0 ).r, b = texelFetch( tHeight, i + ivec2( 1, 0 ), 0 ).r;
	float c = texelFetch( tHeight, i + ivec2( 0, 1 ), 0 ).r, d = texelFetch( tHeight, i + ivec2( 1, 1 ), 0 ).r;
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
	#ifdef USE_MAP
		vMapUv = vec2( mix( gRect.x, gRect.z, uv.x ), mix( gRect.w, gRect.y, uv.y ) );
	#endif`)
        .replace('#include <begin_vertex>', /* glsl */`
	vec2 wp = gOff + uTile * floor( ( uCenter - gOff ) / uTile + 0.5 );
	float dist = length( wp - uCenter );
	vec2 tuv = ( wp + uTerrain.y ) / uTerrain.x;
	float mask = texture2D( tMask, tuv ).r;
	vec4 sb = texture2D( tSplatB, tuv );
	vec4 nz = texture2D( tNoise, wp / 23.0 );
	float dist3 = length( vec3( wp.x, terrainH( wp ), wp.y ) - uCam );
	float fadeIn = smoothstep( uFade.x - 2.0, uFade.x + 1.0, dist );
	float fadeOut = 1.0 - smoothstep( uFade.y * 0.55, uFade.y, dist3 );
	float dens = smoothstep( 0.18 + ( nz.r - 0.5 ) * 0.3, 0.55, mask ) * fadeIn;
	float keep = step( gRnd.z, dens ) * step( gRnd.z * 0.35, fadeOut );
	// far clumps shrink smoothly instead of popping, so the field melts into the terrain
	float sc = gRnd.y * keep * mix( 0.65, 1.15, nz.g ) * ( 0.8 + 0.2 * dens ) * mix( 0.2, 1.0, fadeOut );
	float c = cos( gRnd.x ), s = sin( gRnd.x );
	vec3 transformed = vec3( c * position.x - s * position.z, position.y, s * position.x + c * position.z ) * sc;
	transformed.x *= 1.35; transformed.z *= 1.35;
	float h = position.y;
	// wind: bend tops downwind, gusts travel across the field
	float ph = dot( wp, vec2( 0.13, 0.09 ) );
	float gust = 0.6 + 0.4 * sin( uTime * 0.9 + wp.x * 0.05 - wp.y * 0.03 );
	float sway = ( sin( uTime * 1.7 + ph ) * 0.5 + 0.5 + sin( uTime * 3.1 + ph * 2.3 ) * 0.15 ) * uWind.z * gust;
	transformed.xz += uWind.xy * sway * h * h * 0.35 * sc;
	transformed.y -= length( uWind.xy * sway ) * h * h * 0.12 * sc;
	transformed += vec3( wp.x, terrainH( wp ) - 0.03, wp.y );
	vGrassH = h;
	vDry = clamp( sb.a * 0.9 + ( nz.b - 0.5 ) * 0.5, 0.0, 1.0 );
	vGrassTint = mix( vec3( 1.0, 1.14, 0.74 ), vec3( 1.15, 1.06, 0.76 ), vDry ) * mix( 0.88, 1.12, nz.a );`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4( transformed, 1.0 );\ngl_Position = projectionMatrix * mvPosition;')
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4( transformed, 1.0 );');
      const nb = THREE.ShaderChunk.normal_fragment_begin.replaceAll('normal *= faceDirection;', '');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGrassH;\nvarying vec3 vGrassTint;\nvarying float vDry;\nuniform sampler2D tDry;\nuniform float uWetness;\nuniform vec3 uSunLight;')
        .replace('#include <map_fragment>', /* glsl */`
	vec4 gA = texture2D( map, vMapUv );
	vec4 gB = texture2D( tDry, vMapUv );
	vec4 sampledDiffuseColor = mix( gA, vec4( gB.rgb, gA.a ), smoothstep( 0.35, 0.85, vDry ) );
	diffuseColor *= sampledDiffuseColor;
	diffuseColor.rgb *= vGrassTint * mix( 0.45, 1.0, smoothstep( 0.0, 0.7, vGrassH ) );
	diffuseColor.rgb *= 1.0 - 0.3 * uWetness;`)
        .replace('#include <normal_fragment_begin>', nb)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix( 0.92, 0.45, uWetness );')
        .replace('#include <fog_pars_fragment>', FOG_PARS)
        .replace('#include <fog_fragment>', FOG_FRAG)
        .replace('#include <lights_fragment_end>', /* glsl */`
	#include <lights_fragment_end>
	{
		vec3 Ls = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
		float back = pow( saturate( dot( - geometryViewDir, Ls ) ), 4.0 );
		reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunLight * back * 0.1 * vGrassH;
	}`);
    };
    m.customProgramCacheKey = () => 'grass-v1';
    return m;
  }

  refreshMask() { this.maskTex.needsUpdate = true; }

  /** Grass tiles centre on the point the player looks at (ground below the
   *  camera in walk mode, the orbit target in strategy view). */
  update(camera, focus) {
    const c = camera.position;
    this.uniforms.uCam.value.set(c.x, c.y, c.z);
    const f = focus || c;
    const k = Math.min(1, Math.max(0, (c.y - this.terrain.height(c.x, c.z) - 3) / 40));
    this.uniforms.uCenter.value.set(c.x + (f.x - c.x) * k, c.z + (f.z - c.z) * k);
  }
}

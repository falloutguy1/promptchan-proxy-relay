// Pond water: PBR dielectric (sky reflections from the PMREM environment, sun
// glints, shadows) with depth-based absorption, animated two-layer ripples,
// rain rings and a soft shoreline where water thins over the mud bank.
import * as THREE from 'three';
import { G, enhance } from '../core/shaderlib.js';
import { hash2 } from '../core/rng.js';
import { POND } from './layout.js';

function rippleNormalTexture(size = 256) {
  // tileable height field -> XY-packed normal map
  const H = new Float32Array(size * size);
  const oct = [[4, 0.5], [8, 0.3], [16, 0.16], [32, 0.08]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let h = 0;
    for (const [f, a] of oct) {
      const u = (x / size) * f, v = (y / size) * f;
      const xi = Math.floor(u), yi = Math.floor(v), xf = u - xi, yf = v - yi;
      const s = (t) => t * t * (3 - 2 * t);
      const m = (i) => ((i % f) + f) % f;
      const c00 = hash2(m(xi), m(yi), f), c10 = hash2(m(xi + 1), m(yi), f), c01 = hash2(m(xi), m(yi + 1), f), c11 = hash2(m(xi + 1), m(yi + 1), f);
      const i0 = c00 + (c10 - c00) * s(xf), i1 = c01 + (c11 - c01) * s(xf);
      h += (i0 + (i1 - i0) * s(yf)) * a;
    }
    H[y * size + x] = h;
  }
  const data = new Uint8Array(size * size * 4);
  const k = 6.0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = H[y * size + ((x + 1) % size)] - H[y * size + ((x - 1 + size) % size)];
    const hy = H[((y + 1) % size) * size + x] - H[((y - 1 + size) % size) * size + x];
    let nx = -hx * k, ny = hy * k, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l;
    const o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = (nx * 0.5 + 0.5) * 255;
    data[o + 3] = (ny * 0.5 + 0.5) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export function buildWater(terrain) {
  const R = POND.radius * 1.6;
  const seg = 96;
  const geo = new THREE.CircleGeometry(R, seg, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  // subdivide radially for smoother depth interpolation
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + POND.x, z = pos.getZ(i) + POND.z;
    depth[i] = terrain.waterLevel - terrain.height(x, z);
  }
  // rebuild as a fine grid so depth varies smoothly near the shore
  const n = 110, size = R * 2;
  const g = new THREE.PlaneGeometry(size, size, n, n);
  g.rotateX(-Math.PI / 2);
  const gp = g.attributes.position;
  const d = new Float32Array(gp.count);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i) + POND.x, z = gp.getZ(i) + POND.z;
    d[i] = terrain.waterLevel - terrain.height(x, z);
    gp.setY(i, 0);
  }
  // drop triangles fully above ground (keep a margin so the edge fades in shader)
  const idx = g.index.array, keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (Math.max(d[a], d[b], d[c]) > -0.25) keep.push(a, b, c);
  }
  g.setIndex(keep);
  g.setAttribute('wdepth', new THREE.BufferAttribute(d, 1));
  geo.dispose();

  const normalTex = rippleNormalTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.035, 0.05, 0.035), roughness: 0.04, metalness: 0,
    normalMap: normalTex, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  mat.name = 'water';
  const uniforms = { tRipple: { value: normalTex }, uRain: { value: 0 } };
  enhance(mat, {
    wet: false, key: 'water',
    extra: (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float wdepth;\nvarying float vDepth;\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = wdepth;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDepth;\nvarying vec2 vWXZ;\nuniform sampler2D tRipple;\nuniform float uRain;\nuniform float uTime;')
        .replace('#include <map_fragment>', /* glsl */`
	#include <map_fragment>
	float shoreA = smoothstep( -0.02, 0.35, vDepth );
	float deep = smoothstep( 0.1, 2.2, vDepth );
	// absorption: shallow water shows the bank (low alpha), deep water is dark olive
	diffuseColor.rgb = mix( vec3( 0.075, 0.07, 0.045 ), diffuseColor.rgb, deep );
	diffuseColor.a = mix( 0.35, 0.93, deep ) * shoreA;
	if ( diffuseColor.a < 0.004 ) discard;`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
	{
		vec2 p = vWXZ;
		vec4 a = texture2D( tRipple, p * 0.061 + vec2( uTime * 0.011, uTime * 0.007 ) );
		vec4 b = texture2D( tRipple, p * 0.137 + vec2( - uTime * 0.013, uTime * 0.017 ) );
		vec4 c = texture2D( tRipple, p * 0.53 + vec2( uTime * 0.05, - uTime * 0.041 ) );
		vec2 nxy = ( vec2( a.r, a.a ) - 0.5 ) * 0.9 + ( vec2( b.r, b.a ) - 0.5 ) * 0.6 + ( vec2( c.r, c.a ) - 0.5 ) * 0.25 * ( 0.4 + uRain * 2.0 );
		// rain rings
		if ( uRain > 0.01 ) {
			vec2 cell = floor( p * 1.3 );
			vec2 f = fract( p * 1.3 ) - 0.5;
			float h = fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5 );
			float t = fract( uTime * 0.9 + h );
			vec2 o = vec2( fract( h * 13.1 ), fract( h * 7.7 ) ) - 0.5;
			float r = length( f - o * 0.6 );
			float ring = sin( ( r - t * 0.45 ) * 60.0 ) * smoothstep( 0.45, 0.0, abs( r - t * 0.45 ) * 6.0 ) * ( 1.0 - t );
			nxy += normalize( f - o * 0.6 + 1e-4 ) * ring * 0.35 * uRain;
		}
		nxy *= 0.55;
		vec3 mapN = vec3( nxy, sqrt( saturate( 1.0 - dot( nxy, nxy ) ) ) );
		normal = normalize( tbn * mapN );
	}`)
        .replace('#include <opaque_fragment>', /* glsl */`
	// premultiplied: absorption fades the body colour, reflections stay at full strength
	gl_FragColor = vec4( totalDiffuse * diffuseColor.a + ( totalSpecular + totalEmissiveRadiance ) * shoreA, diffuseColor.a );`);
    },
  });

  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(POND.x, terrain.waterLevel, POND.z);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.name = 'pond';
  mesh.userData.uniforms = uniforms;
  mesh.userData.update = () => { uniforms.uRain.value = G.uWetness.value; };
  return mesh;
}

/**
 * Reeds and cattails in clumps along the pond's shallows (from a little above
 * the waterline to half a metre deep). One batched mesh; blades are tapered
 * tubes with a darker base, and wind bends them by height.
 */
export function buildReeds(terrain, Geo, WATER) {
  const rng = { s: 91, next() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; } };
  const r = (a, b) => a + (b - a) * rng.next();
  const g = new Geo({ reed: 1 });
  const base = WATER - 0.6;
  let clumps = 0;
  for (let i = 0; i < 900 && clumps < 150; i++) {
    const a = r(0, Math.PI * 2);
    const rad = terrain.pondRadiusAt(a) + r(-4, 1.2);
    const cx = POND.x + Math.cos(a) * rad, cz = POND.z + Math.sin(a) * rad;
    const depth = WATER - terrain.height(cx, cz);
    if (depth < -0.3 || depth > 0.55) continue;
    clumps++;
    const n = 6 + Math.floor(r(0, 12));
    for (let k = 0; k < n; k++) {
      const bx = cx + r(-0.45, 0.45), bz = cz + r(-0.45, 0.45);
      const y0 = terrain.height(bx, bz) - base - 0.05;
      const top = WATER - base + r(0.9, 1.9);
      const lx = r(-0.18, 0.18), lz = r(-0.18, 0.18);
      const mid = new THREE.Vector3(bx + lx * 0.35, y0 + (top - y0) * 0.5, bz + lz * 0.35);
      g.tube(`reed:${rng.next() < 0.5 ? '#56633a' : '#4c5a34'}`, [new THREE.Vector3(bx, y0, bz), mid], [0.011, 0.009], 4);
      g.tube(`reed:${rng.next() < 0.5 ? '#8f8a58' : '#a39862'}`, [mid, new THREE.Vector3(bx + lx, top, bz + lz)], [0.009, 0.002], 4);
      if (rng.next() < 0.22) {
        // cattail head on its own stalk
        const hx = bx + lx * 0.8, hz = bz + lz * 0.8, hy = top - 0.35;
        g.tube('reed:#5a3d24', [new THREE.Vector3(hx, hy, hz), new THREE.Vector3(hx + lx * 0.08, hy + 0.2, hz + lz * 0.08)], 0.028, 6, true);
      }
    }
  }
  const geo = g.build().get('reed');
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  enhance(mat, { wind: { amp: 0.3, flutter: 0.06, height: 2.4 }, porosity: 0.5, key: 'reeds' });
  const mesh = new THREE.Mesh(geo || new THREE.BufferGeometry(), mat);
  mesh.position.y = base;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'reeds';
  return mesh;
}

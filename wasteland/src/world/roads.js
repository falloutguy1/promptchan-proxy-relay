// Road surfaces: the asphalt highway as a terrain-hugging ribbon with crumbling
// edges, worn paint and repaired patches; gravel/dirt tracks as a rut decal
// ribbon (tyre tracks) over the terrain's own gravel/soil blend.
import * as THREE from 'three';
import { enhance } from '../core/shaderlib.js';
import { macroNoiseTexture } from '../gfx/noisetex.js';

function ribbon(terrain, road, cols, halfWidth, lift) {
  const S = road.samples;
  const pos = [], uv = [], info = [], nor = [], idx = [];
  const nv = new THREE.Vector3();
  for (let i = 0; i < S.length; i++) {
    const p = S[i];
    const nx = -p.tz, nz = p.tx; // left normal
    for (let c = 0; c <= cols; c++) {
      const lat = -halfWidth + (2 * halfWidth * c) / cols;
      const x = p.x + nx * lat, z = p.z + nz * lat;
      const y = terrain.height(x, z) + lift;
      pos.push(x, y, z);
      terrain.normal(x, z, nv);
      nor.push(nv.x, nv.y, nv.z);
      uv.push(lat, p.s);
      info.push(lat, p.s, halfWidth);
    }
  }
  const w = cols + 1;
  for (let i = 0; i < S.length - 1; i++) for (let c = 0; c < cols; c++) {
    const a = i * w + c, b = a + 1, d = a + w, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('roadInfo', new THREE.Float32BufferAttribute(info, 3));
  g.setIndex(idx);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// Winding check: vertices go left (-hw) -> right (+hw) across, forward along s.
// Triangle (a, b, d) must face up; if the road runs so it faces down we flip.
function ensureUp(g) {
  const p = g.attributes.position.array, ix = g.index.array;
  const a = new THREE.Vector3(p[ix[0] * 3], p[ix[0] * 3 + 1], p[ix[0] * 3 + 2]);
  const b = new THREE.Vector3(p[ix[1] * 3], p[ix[1] * 3 + 1], p[ix[1] * 3 + 2]);
  const c = new THREE.Vector3(p[ix[2] * 3], p[ix[2] * 3 + 1], p[ix[2] * 3 + 2]);
  const n = b.sub(a).cross(c.sub(a));
  if (n.y < 0) for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
}

const ROAD_VS = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 roadInfo;\nvarying vec3 vRoad;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = roadInfo;');
};

export async function buildRoads(terrain, assets) {
  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = await assets.textureSet('asphalt');
  const mud = await assets.textureSet('mud');
  const macro = macroNoiseTexture();

  // ------------------------------------------------ asphalt
  const aMat = new THREE.MeshStandardMaterial({
    map: asphalt.map, normalMap: asphalt.normalMap, roughnessMap: asphalt.ormMap, aoMap: asphalt.ormMap,
    roughness: 1, metalness: 0, color: new THREE.Color(0.92, 0.92, 0.9),
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const uvScale = 1 / 3;
  enhance(aMat, {
    porosity: 0.9, key: 'road',
    extra: (shader) => {
      ROAD_VS(shader);
      shader.uniforms.tRoadNoise = { value: macro };
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
	vec2 wlUv = uv * ${uvScale.toFixed(4)};
	#ifdef USE_MAP
		vMapUv = wlUv;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = wlUv;
	#endif
	#ifdef USE_ROUGHNESSMAP
		vRoughnessMapUv = wlUv;
	#endif
	#ifdef USE_AOMAP
		vAoMapUv = wlUv;
	#endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRoad;\nuniform sampler2D tRoadNoise;\nfloat roadPaint = 0.0;\nfloat roadPatch = 0.0;')
        .replace('#include <map_fragment>', /* glsl */`
	#include <map_fragment>
	{
		float lat = vRoad.x, s = vRoad.y, hw = vRoad.z;
		float e = abs( lat ) / hw;
		vec4 n1 = texture2D( tRoadNoise, vec2( s * 0.021, lat * 0.03 + 0.5 ) );
		vec4 n2 = texture2D( tRoadNoise, vec2( s * 0.11, lat * 0.13 ) );
		// crumbling, broken edges
		float lim = 0.965 - 0.16 * n2.r - 0.12 * smoothstep( 0.55, 0.8, n1.g );
		if ( e > lim ) discard;
		// repaired tar patches, faded
		roadPatch = smoothstep( 0.62, 0.68, n1.r ) * smoothstep( 0.3, 0.5, n1.b );
		diffuseColor.rgb *= mix( 1.0, 0.72, roadPatch );
		// dust and soil washed onto the edges; tyre-polished lanes slightly darker
		float lane = smoothstep( 0.25, 0.0, abs( abs( lat ) - hw * 0.5 ) - 0.45 );
		diffuseColor.rgb *= mix( 1.0, 0.93, lane * 0.6 );
		diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.12, 1.02, 0.84 ), smoothstep( 0.72, 0.96, e ) * 0.8 );
		// worn paint: dashed centre line, solid edge lines
		float dash = step( fract( s / 12.0 ), 0.42 );
		float centre = ( 1.0 - smoothstep( 0.055, 0.085, abs( lat ) ) ) * dash;
		float side = 1.0 - smoothstep( 0.05, 0.08, abs( abs( lat ) - ( hw - 0.32 ) ) );
		float wear = smoothstep( 0.35, 0.62, n2.g + ( diffuseColor.r - 0.18 ) * 1.5 );
		roadPaint = max( centre, side ) * wear * ( 1.0 - roadPatch );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.58, 0.56, 0.5 ), roadPaint * 0.85 );
	}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.62, roadPaint * 0.6 );\nroughnessFactor = mix( roughnessFactor, roughnessFactor * 0.85, roadPatch );');
    },
  });

  // ------------------------------------------------ rut decals for tracks
  const rMat = new THREE.MeshStandardMaterial({
    map: mud.map, normalMap: mud.normalMap, roughnessMap: mud.ormMap,
    roughness: 1, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, color: new THREE.Color(0.9, 0.88, 0.85),
  });
  enhance(rMat, {
    porosity: 1, key: 'ruts',
    extra: (shader) => {
      ROAD_VS(shader);
      shader.uniforms.tRoadNoise = { value: macro };
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
	vec2 wlUv = uv * 0.4;
	#ifdef USE_MAP
		vMapUv = wlUv;
	#endif
	#ifdef USE_NORMALMAP
		vNormalMapUv = wlUv;
	#endif
	#ifdef USE_ROUGHNESSMAP
		vRoughnessMapUv = wlUv;
	#endif`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRoad;\nuniform sampler2D tRoadNoise;')
        .replace('#include <map_fragment>', /* glsl */`
	#include <map_fragment>
	{
		float lat = vRoad.x, s = vRoad.y;
		vec4 n1 = texture2D( tRoadNoise, vec2( s * 0.05, lat * 0.2 + 0.3 ) );
		vec4 n2 = texture2D( tRoadNoise, vec2( s * 0.21, lat * 0.5 ) );
		float wob = ( n1.r - 0.5 ) * 0.35;
		float rutL = 1.0 - smoothstep( 0.12, 0.34, abs( lat - 0.82 + wob ) );
		float rutR = 1.0 - smoothstep( 0.12, 0.34, abs( lat + 0.82 + wob ) );
		float a = max( rutL, rutR ) * smoothstep( 0.25, 0.55, n2.g + 0.2 );
		a *= smoothstep( 0.15, 0.4, n1.b + 0.15 );
		diffuseColor.a *= a * 0.92;
		if ( diffuseColor.a < 0.01 ) discard;
	}`);
    },
  });

  for (const road of terrain.roads) {
    if (road.kind === 'asphalt') {
      const g = ribbon(terrain, road, 12, road.width / 2, 0.04);
      ensureUp(g);
      const m = new THREE.Mesh(g, aMat);
      m.receiveShadow = true;
      m.name = road.id;
      group.add(m);
    } else {
      const g = ribbon(terrain, road, 8, 1.35, 0.03);
      ensureUp(g);
      const m = new THREE.Mesh(g, rMat);
      m.receiveShadow = true;
      m.renderOrder = 1;
      m.name = road.id + '_ruts';
      group.add(m);
    }
  }
  return group;
}

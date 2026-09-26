import * as THREE from 'three';
import { WORLD } from './layout.js';
import { patch, shared, NOISE_GLSL } from './shaderlib.js';

// Farm pond: still, slightly murky water. Depth (water level minus terrain)
// is baked per vertex and drives colour absorption, opacity at the muddy
// shore and a narrow wet band. Surface normals are two scrolling procedural
// ripple layers; reflections come from the HDR sky.

export async function build(ctx) {
  const { scene, hf } = ctx;
  const P = WORLD.pond;
  const R = P.r + 6;
  // concentric rings so the baked depth interpolates smoothly
  const ring = new THREE.RingGeometry(0.01, R, 96, 24).rotateX(-Math.PI / 2);
  const pos = ring.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + P.x, z = pos.getZ(i) + P.z;
    depth[i] = P.level - hf.height(x, z);
  }
  ring.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'water', color: 0x0b0f09, roughness: 0.03, metalness: 0, ior: 1.33, transparent: true, depthWrite: false,
    envMapIntensity: 1.0, specularIntensity: 1,
  });
  patch(mat, {
    key: 'water',
    uniforms: shared,
    vertexHead: 'attribute float aDepth; varying float vDepth; varying vec3 vWP;',
    vertex: [['#include <project_vertex>', '$&\n vDepth = aDepth; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;']],
    fragmentHead: NOISE_GLSL + 'uniform float uTime; varying float vDepth; varying vec3 vWP;',
    fragment: [
      ['#include <normal_fragment_maps>', /* glsl */`
        {
          vec2 p = vWP.xz;
          float e = 0.05;
          float t = uTime;
          #define H(q) (dz_noise((q) * 3.1 + vec2(t * 0.09, t * 0.05)) * 0.6 + dz_noise((q) * 4.3 - vec2(t * 0.13, -t * 0.07)) * 0.4)
          float h0 = H(p), hx = H(p + vec2(e, 0.0)), hz = H(p + vec2(0.0, e));
          vec3 nw = normalize(vec3(-(hx - h0) / e * 0.012, 1.0, -(hz - h0) / e * 0.012));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`],
      ['#include <color_fragment>', /* glsl */`
        float d = max(vDepth, 0.0);
        // absorption: shallow water shows the silty bottom, deep water goes dark olive
        diffuseColor.rgb = mix(vec3(0.09, 0.08, 0.05), diffuseColor.rgb, smoothstep(0.0, 0.6, d));
        diffuseColor.a = mix(smoothstep(-0.02, 0.25, d) * 0.85, 0.97, smoothstep(0.25, 1.0, d));
        if (vDepth < -0.02) discard;`],
    ],
  });
  const mesh = new THREE.Mesh(ring, mat);
  mesh.position.set(P.x, P.level, P.z);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.noAO = true;
  scene.add(mesh);
  ctx.foliage.push(mesh); // transparent: keep out of the GTAO normal pass
}

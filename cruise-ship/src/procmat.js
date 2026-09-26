import * as THREE from 'three';
import { NOISE, SDF } from './glsl.js';

// Uniforms shared by every procedural material.
export const shared = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

const HEAD = /* glsl */`
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vInst;
varying float vS;
uniform float uNight;
uniform float uTime;
`;

// MeshStandardMaterial whose albedo / roughness / metalness / emissive / bump / AO are
// computed per-fragment from object-space position by a GLSL `surface` function:
// void surface(vec3 p, vec3 n, float s, inout vec3 alb, inout float rgh, inout float mtl,
//              inout vec3 emi, inout float bump, inout float ao)
export function procMaterial({ key, surface, uniforms = {}, params = {}, physical = false }) {
  const mat = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + HEAD + 'attribute float aS;\n')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObj = position; vObjN = objectNormal; vS = aS;
        #ifdef USE_INSTANCING
          vInst = instanceMatrix[3].xyz;
        #else
          vInst = vec3(0.0);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + HEAD + NOISE + SDF + surface + /* glsl */`
        vec3 procPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float fd){
          vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
          vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
          float det = dot(sx, R1) * fd;
          if (abs(det) < 1e-12) return surf_norm;
          vec3 g = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
          return normalize(abs(det) * surf_norm - g);
        }
      `)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        vec3 procEmi = vec3(0.0); float procBump = 0.0; float procAO = 1.0;
        {
          vec3 alb = diffuseColor.rgb; float rgh = roughnessFactor; float mtl = metalnessFactor;
          surface(vObj, normalize(vObjN), vS, alb, rgh, mtl, procEmi, procBump, procAO);
          diffuseColor.rgb = alb; roughnessFactor = rgh; metalnessFactor = mtl;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 dh = vec2(dFdx(procBump), dFdy(procBump));
          normal = procPerturb(-vViewPosition, normal, dh, faceDirection);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += procEmi;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          reflectedLight.indirectDiffuse *= procAO;
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float pdNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( pdNV, procAO, material.roughness );
          #endif
        }`);
  };
  mat.customProgramCacheKey = () => 'proc-' + key + (physical ? '-p' : '');
  return mat;
}

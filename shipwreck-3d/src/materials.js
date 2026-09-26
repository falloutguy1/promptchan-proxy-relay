import * as THREE from 'three';

export const U = { time: { value: 0 } };

export const GLSL_NOISE = /* glsl */`
float h31(vec3 p){ p = fract(p*0.3183099+vec3(.1,.2,.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbmv(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=0.5;} return s; }
`;

const DAMAGE_VERT_PARS = `attribute float aDamage; varying float vDamage; varying vec3 vObj;\n`;
const DAMAGE_FRAG_PARS = `uniform float uThresh; uniform vec3 uEdgeCol; varying float vDamage; varying vec3 vObj;\n` + GLSL_NOISE;
const DAMAGE_EVAL = `
  float dn = vDamage + (vn(vObj*1.3)-0.5)*0.26 + (vn(vObj*5.1)-0.5)*0.10 + (vn(vObj*17.0)-0.5)*0.035;
  if (dn > uThresh) discard;
  float edge = smoothstep(uThresh-0.085, uThresh, dn);
`;

function injectDamage(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = DAMAGE_VERT_PARS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vDamage = aDamage; vObj = position;');
  shader.fragmentShader = DAMAGE_FRAG_PARS + shader.fragmentShader.replace('void main() {', 'void main() {\n' + DAMAGE_EVAL);
}

// Rusted steel with procedural tear-outs driven by per-vertex aDamage.
export function rustMaterial(tex, opts = {}) {
  const uniforms = {
    uThresh: { value: opts.threshold ?? 0.6 },
    uEdgeCol: { value: new THREE.Color(opts.edge ?? '#e8a07c').convertSRGBToLinear() },
  };
  const m = new THREE.MeshStandardMaterial({
    map: tex.map, roughnessMap: tex.roughMap, normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(opts.normal ?? 1.1, opts.normal ?? 1.1),
    vertexColors: true, roughness: 1.0, metalness: opts.metalness ?? 0.22, side: THREE.DoubleSide,
    color: opts.color ?? 0xffffff, envMapIntensity: 0.8,
  });
  m.onBeforeCompile = (shader) => {
    injectDamage(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeCol, edge*0.5);
        if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.42,0.34,0.36);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, edge*0.6);`);
  };
  m.customProgramCacheKey = () => 'rust' + (opts.key || '');
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (shader) => injectDamage(shader, uniforms);
  depth.customProgramCacheKey = () => 'rustdepth';
  m.userData.depth = depth;
  m.userData.uniforms = uniforms;
  return m;
}

export function applyMat(mesh, mat, shadows = true) {
  mesh.material = mat;
  if (mat.userData.depth) mesh.customDepthMaterial = mat.userData.depth;
  mesh.castShadow = shadows; mesh.receiveShadow = true;
  return mesh;
}

// Seaweed / algae strands, uv.y = sway weight
export function kelpMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide, color: 0xb0a890 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = U.time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float w = uv.y*uv.y;
      transformed.x += sin(uTime*1.3 + position.y*1.7 + position.z*0.6)*0.10*w;
      transformed.z += cos(uTime*1.1 + position.x*0.9)*0.10*w;`);
  };
  return m;
}

// Box-projected UVs in metres (for props without meaningful UVs)
export function boxUV(g, tile = 4) {
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

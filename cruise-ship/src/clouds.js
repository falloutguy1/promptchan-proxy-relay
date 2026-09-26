import * as THREE from 'three';

// Tileable cumulus coverage field baked once on the GPU.
const FRAG = /* glsl */`
varying vec2 vUv;
float hp(vec2 i, float P){ i = mod(i, P); vec3 p3 = fract(vec3(i.xyx) * 0.1031 + 0.37); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnP(vec2 p, float P){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hp(i, P), hp(i + vec2(1, 0), P), u.x), mix(hp(i + vec2(0, 1), P), hp(i + vec2(1, 1), P), u.x), u.y);
}
float fbmP(vec2 p, float P){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnP(p, P); p *= 2.0; P *= 2.0; a *= 0.5; } return s; }
float billowP(vec2 p, float P){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * abs(vnP(p, P) * 2.0 - 1.0); p *= 2.0; P *= 2.0; a *= 0.5; } return s; }
void main(){
  vec2 p = vUv * 8.0;
  vec2 w = vec2(fbmP(p + vec2(1.7, 9.2), 8.0), fbmP(p + vec2(8.3, 2.8), 8.0));
  vec2 q = p + (w - 0.5) * 1.8;
  float base = fbmP(q, 8.0);
  float cells = 1.0 - billowP(q * 2.0, 16.0);
  float f = base * 0.62 + cells * 0.38;
  gl_FragColor = vec4(f, base, cells, 1.0);
}`;

export function bakeClouds(renderer, size = 2048) {
  const make = (s, mips) => {
    const rt = new THREE.WebGLRenderTarget(s, s, {
      depthBuffer: false, generateMipmaps: mips,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    rt.texture.anisotropy = 4;
    return rt;
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();

  // coarse copy for the coverage histogram
  const small = make(128, false);
  renderer.setRenderTarget(small); renderer.render(scene, cam);
  const px = new Uint8Array(128 * 128 * 4);
  renderer.readRenderTargetPixels(small, 0, 0, 128, 128, px);
  const vals = new Float32Array(128 * 128);
  for (let i = 0; i < vals.length; i++) vals[i] = px[i * 4] / 255;
  vals.sort();
  small.dispose();

  const rt = make(size, true);
  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();

  // threshold for a given sky coverage fraction
  const thresholdFor = (cov) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor((1 - cov) * vals.length)))];
  return { texture: rt.texture, thresholdFor };
}

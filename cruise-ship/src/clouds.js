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
vec2 hp2(vec2 i, float P){ i = mod(i, P); vec3 p3 = fract(vec3(i.xyx) * vec3(0.1031, 0.1030, 0.0973) + 0.21); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// periodic cellular noise: distance to the nearest jittered feature point (cell units)
float worleyP(vec2 p, float P){
  vec2 i = floor(p), f = fract(p); float d = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 r = g + 0.15 + 0.7 * hp2(i + g, P) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
void main(){
  vec2 p = vUv * 8.0;
  vec2 w = vec2(fbmP(p * 2.0 + vec2(1.7, 9.2), 16.0), fbmP(p * 2.0 + vec2(8.3, 2.8), 16.0));
  vec2 q = p + (w - 0.5) * 0.35;
  float cov = fbmP(q, 8.0);
  float w1 = 1.0 - worleyP(q * 3.0, 24.0);
  float w2 = 1.0 - worleyP(q * 7.0, 56.0);
  float w3 = 1.0 - worleyP(q * 15.0, 120.0);
  float n = fbmP(q * 16.0, 128.0);
  float f = w1 * 0.46 + w2 * 0.26 + w3 * 0.13 + n * 0.1 + (cov - 0.45) * 0.55;
  gl_FragColor = vec4(clamp(f * 0.9 + 0.05, 0.0, 1.0), cov, w1, 1.0);
}`;

export function bakeClouds(renderer, size = 512) {
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

  const rt = make(size, true);
  renderer.setRenderTarget(rt); renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();

  return { texture: rt.texture, rt };
}

// Tileable 3D billow noise (inverted Worley, three octaves) for eroding cloud walls into cauliflower puffs.
export function makeNoise3D(N = 64) {
  const octaves = [[4, 0.55], [8, 0.3], [16, 0.15]];
  let seed = 90127;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const feats = octaves.map(([C]) => { const a = new Float32Array(C * C * C * 3); for (let i = 0; i < a.length; i++) a[i] = 0.1 + 0.8 * rnd(); return a; });
  const data = new Uint8Array(N * N * N);
  let lo = 1e9, hi = -1e9;
  const tmp = new Float32Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    octaves.forEach(([C, w], o) => {
      const fx = (x / N) * C, fy = (y / N) * C, fz = (z / N) * C;
      const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
      let m = 9;
      const F = feats[o];
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ix = (cx + dx + C) % C, iy = (cy + dy + C) % C, iz = (cz + dz + C) % C;
        const k = ((iz * C + iy) * C + ix) * 3;
        const px = cx + dx + F[k] - fx, py = cy + dy + F[k + 1] - fy, pz = cz + dz + F[k + 2] - fz;
        const d = px * px + py * py + pz * pz;
        if (d < m) m = d;
      }
      v += w * (1 - Math.min(1, Math.sqrt(m)));
    });
    const i = (z * N + y) * N + x;
    tmp[i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  for (let i = 0; i < tmp.length; i++) data[i] = Math.round(((tmp[i] - lo) / (hi - lo)) * 255);
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

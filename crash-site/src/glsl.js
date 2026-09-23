// Shared GLSL helpers (hashes, value noise, fbm, voronoi, bump perturbation).
export const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise2(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3. - 2. * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3. - 2. * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm2(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a * vnoise2(p); p = p * 2.03 + 17.13; a *= .5; } return s / .96875; }
float fbm3(vec3 p){ float s = 0., a = .5; for(int i = 0; i < 4; i++){ s += a * vnoise3(p); p = p * 2.07 + 13.7; a *= .5; } return s / .9375; }
// returns (F1, F2 - F1)
vec2 voronoi2(vec2 p){
  vec2 n = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
  for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j)); vec2 o = hash22(n + g);
    float d = length(g + o - f);
    if(d < d1){ d2 = d1; d1 = d; } else if(d < d2){ d2 = d; }
  }
  return vec2(d1, d2 - d1);
}
`;
export const BUMP = /* glsl */ `
vec3 perturbBump(vec3 surfPos, vec3 surfNorm, float h, float faceDir){
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

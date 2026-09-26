// GLSL shared by terrain (and reused by the vegetation placement logic on the CPU side).
// hash2i/vnoise/fieldInfo mirror src/core/noise.js + src/world/layout.js exactly.

export const GLSL_COMMON = /* glsl */`
float h2i(int x, int y, int s){
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}
float vnoise(vec2 p, int s){
  vec2 i = floor(p); vec2 f = p - i;
  vec2 u = f*f*(3.0-2.0*f);
  int xi = int(i.x), yi = int(i.y);
  float a = h2i(xi,yi,s), b = h2i(xi+1,yi,s), c = h2i(xi,yi+1,s), d = h2i(xi+1,yi+1,s);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float riverZ(float x){
  return 350.0 + 500.0*sin(x/2300.0) + 180.0*sin(x/800.0+1.3) + 40.0*sin(x/260.0+0.4);
}
float riverDist(vec2 p){
  float z0 = riverZ(p.x);
  float dz = (riverZ(p.x+5.0) - riverZ(p.x-5.0)) / 10.0;
  return abs(p.y - z0) / sqrt(1.0 + dz*dz);
}
// x: field id, y: crop, z: strip edge dist, w: block edge dist; outputs hedge hash + strip axis coord
vec4 fieldInfo(vec2 p, out float hedge, out float along, out float across){
  const float S = 460.0;
  vec2 g = floor(p / S);
  float d1 = 1e9, d2 = 1e9; vec2 bc = vec2(0.0); vec2 cc = vec2(0.0);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    int bx = int(g.x)+i, bz = int(g.y)+j;
    vec2 c = (vec2(float(bx),float(bz)) + 0.15 + 0.7*vec2(h2i(bx,bz,1), h2i(bx,bz,2))) * S;
    vec2 dd = p - c; float d = dot(dd,dd);
    if(d < d1){ d2 = d1; d1 = d; bc = vec2(float(bx),float(bz)); cc = c; } else if(d < d2) d2 = d;
  }
  int bx = int(bc.x), bz = int(bc.y);
  float blockEdge = (sqrt(d2) - sqrt(d1)) * 0.5;
  float ang = h2i(bx,bz,3) * PI;
  vec2 dir = vec2(cos(ang), sin(ang));
  float u = dot(p - cc, dir);
  float sw = 22.0 + 38.0 * h2i(bx,bz,4);
  float si = floor(u / sw);
  float fr = u / sw - si;
  float fid = h2i(bx*131 + int(si), bz, 5);
  bool own = h2i(bx, bz*17 + int(si), 7) < 0.28;
  float r = own ? h2i(bx, bz*17 + int(si), 6) : h2i(bx, bz, 6);
  float crop = r < 0.24 ? 0.0 : r < 0.5 ? 1.0 : r < 0.64 ? 2.0 : r < 0.93 ? 3.0 : 4.0;
  hedge = h2i(bx,bz,9);
  across = u;
  along = dot(p - cc, vec2(-dir.y, dir.x));
  return vec4(fid, crop, min(fr, 1.0-fr)*sw, blockEdge);
}
`;

import * as THREE from 'three';
import { procMaterial } from './procmat.js';

const SIG = 'void surface(vec3 p, vec3 n, float s, inout vec3 alb, inout float rgh, inout float mtl, inout vec3 emi, inout float bump, inout float ao)';

const COMMON = /* glsl */`
const vec3 WARM = vec3(1.0, 0.62, 0.32);
float lineCov(float d, float hw, float px){ float w = max(hw, px); return (1.0 - smoothstep(w - px, w + px, abs(d))) * clamp(hw / px, 0.0, 1.0); }
float pxOf(vec3 p){ return max(length(fwidth(p)) * 0.7, 1e-4); }
`;

// ---------------------------------------------------------------- hull
const HULL = COMMON + /* glsl */`
const vec3 C_WHITE = vec3(0.84, 0.845, 0.85);
const vec3 C_BLUE = vec3(0.006, 0.022, 0.15);
const vec3 C_RED = vec3(0.52, 0.010, 0.020);
float blueTop(float x){ float t = clamp((x - 30.0) / 132.0, 0.0, 1.0); return 2.0 + 23.6 * pow(t, 1.55); }
${SIG} {
  float px = pxOf(p);
  float bt = blueTop(p.x);
  float isBlue = 1.0 - smoothstep(bt - px, bt + px, p.y);
  float isRed = smoothstep(bt - px, bt + px, p.y) - smoothstep(bt + 0.62 - px, bt + 0.62 + px, p.y);
  vec3 col = C_WHITE * (0.975 + 0.05 * vnoise(p.xy * vec2(0.05, 0.35)));
  col = mix(col, C_BLUE * (0.92 + 0.12 * vnoise(p.xy * 0.2)), isBlue);
  col = mix(col, C_RED, isRed);
  rgh = mix(0.34, 0.24, isBlue);
  // waterline grime
  col *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 1.4, p.y)) * (0.6 + 0.4 * vnoise(vec2(s * 0.3, 1.0)));

  // plating seams
  float seam = lineCov(fract(s / 12.2) - 0.5, 0.012, px) * (1.0 - lodFade(1.2, px));
  seam = max(seam, lineCov(fract((p.y - 1.0) / 2.9) - 0.5, 0.008, px) * (1.0 - lodFade(1.0, px)) * 0.6);
  col *= 1.0 - 0.10 * seam;

  // windows
  float winD = 1e3; float cellId = 0.0; float rowId = 0.0;
  {
    float pitch = 2.45; float ci = floor(s / pitch);
    float cx = (fract(s / pitch) - 0.5) * pitch;
    float r = clamp(floor((p.y - 4.9) / 2.9 + 0.5), 0.0, 2.0);
    float cy = p.y - (4.9 + r * 2.9);
    float ok = step(p.y, 12.3) * step(-163.0, p.x) * step(p.x, 150.0 - r * 6.0) * step(0.5, mod(ci, 9.0)) * step(26.0, s);
    float d = sdRBox(vec2(cx, cy), vec2(0.36, 0.40), 0.14);
    if (ok > 0.5) { winD = d; cellId = ci; rowId = r; }
  }
  {
    float pitch = 3.3; float ci = floor((s + 1.1) / pitch);
    float cx = (fract((s + 1.1) / pitch) - 0.5) * pitch;
    float r = clamp(floor((p.y - 14.7) / 2.9 + 0.5), 0.0, 3.0);
    float cy = p.y - (14.7 + r * 2.9);
    float ok = step(12.6, p.y) * step(p.x, 154.0 - r * 3.0) * step(0.5, mod(ci + 3.0, 11.0));
    float d = sdRBox(vec2(cx, cy), vec2(0.66, 0.52), 0.12);
    if (ok > 0.5) { winD = d; cellId = ci + 500.0; rowId = r + 10.0; }
  }
  // hawse pipe
  float hawse = 1e3;
  if (p.x > 148.0) hawse = length((p.xy - vec2(158.5, 19.2)) / vec2(1.5, 1.1)) - 1.0;

  float wc = fillAA(winD, px);
  float fr = fillAA(abs(winD + 0.05) - 0.05, px);
  float lf = smoothstep(0.4, 1.2, px / 0.7);
  float valid = winD < 50.0 ? 1.0 : 0.0;
  wc = mix(wc, 0.2 * valid, lf);
  fr = mix(fr, 0.0, lf);
  float lit = step(0.55, hash12(vec2(cellId, rowId * 3.1 + sign(p.z) * 7.0)));
  vec3 glass = vec3(0.010, 0.012, 0.016);
  col = mix(col, col * 0.8, fr * 0.6);
  alb = mix(col, glass, wc);
  rgh = mix(rgh, 0.05, wc);
  emi += WARM * 0.9 * uNight * lit * wc;
  bump = -min(0.04, px * 0.5) * (1.0 - smoothstep(-px, px, winD)) * (1.0 - lf);

  float hc = fillAA(hawse * 0.9, px);
  alb = mix(alb, vec3(0.012), hc);
  bump -= 0.12 * (1.0 - smoothstep(-0.25, 0.05, hawse));
  mtl = 0.0;
}`;

// ---------------------------------------------------------------- flush wall with windows
const WALL = COMMON + /* glsl */`
uniform vec4 uWin;   // pitch, half w, half h, radius
uniform vec4 uRow;   // first centre y, row pitch, rows, s offset
uniform vec3 uWall;
uniform float uLit;
${SIG} {
  float px = pxOf(p);
  vec3 col = uWall * (0.975 + 0.05 * vnoise(p.xy * vec2(0.08, 0.4) + p.z * 0.1));
  float ri = floor((p.y - uRow.x) / uRow.y + 0.5);
  float valid = step(0.0, ri) * step(ri, uRow.z - 1.0);
  float cy = p.y - (uRow.x + ri * uRow.y);
  float ss = s + uRow.w;
  float ci = floor(ss / uWin.x);
  float cx = (fract(ss / uWin.x) - 0.5) * uWin.x;
  float d = sdRBox(vec2(cx, cy), uWin.yz, uWin.w);
  float cov = fillAA(d, px) * valid;
  float avg = valid * (4.0 * uWin.y * uWin.z) / (uWin.x * uRow.y);
  float lf = lodFade(min(uWin.x, uRow.y) * 0.6, px);
  cov = mix(cov, avg, lf);
  float fr = fillAA(abs(d + 0.05) - 0.05, px) * valid * (1.0 - lf);
  float h = hash12(vec2(ci + sign(p.z) * 311.0, ri + floor(p.y / 40.0) * 13.0));
  vec3 glass = vec3(0.008, 0.011, 0.015);
  col = mix(col, vec3(0.55, 0.57, 0.6), fr * 0.7);
  alb = mix(col, glass, cov);
  rgh = mix(0.36, 0.05, cov);
  mtl = 0.0;
  bump = -min(0.03, px * 0.5) * (1.0 - smoothstep(-px, px, d)) * valid * (1.0 - lf);
  float inner = 0.6 + 0.4 * vnoise(vec2(ss * 0.4, p.y * 0.6));
  emi += WARM * 0.8 * uNight * cov * step(1.0 - uLit, h) * inner;
}`;

// ---------------------------------------------------------------- cabin balcony back wall
const CABIN = COMMON + /* glsl */`
uniform float uBay;
uniform float uBase;
${SIG} {
  float px = pxOf(p);
  float dk = (p.y - uBase) / 2.9;
  float deck = floor(dk);
  float v = fract(dk) * 2.9;
  float bf = s / uBay;
  float bay = floor(bf);
  float u = (fract(bf) - 0.5) * uBay;
  float side = sign(p.z) + (n.x > 0.5 ? 5.0 : 0.0);
  float h1 = hash12(vec2(bay + side * 137.0, deck + 17.0));
  float h2 = hash12(vec2(bay * 1.31 + 9.0 + side, deck * 2.7 + side * 51.0));
  float h3 = hash12(vec2(bay * 0.71 - side * 3.0, deck * 5.3 + 2.0));

  vec3 wall = vec3(0.80, 0.80, 0.79) * (0.97 + 0.05 * vnoise(vec2(s * 0.5, p.y * 0.7)));
  vec2 dc = vec2(-0.12, 1.18);
  float dDoor = sdRBox(vec2(u, v) - dc, vec2(1.18, 1.1), 0.02);
  float lf = lodFade(uBay * 0.5, px);
  float door = fillAA(dDoor, px);
  float frame = fillAA(abs(dDoor + 0.035) - 0.035, px);
  float mull = lineCov(u - dc.x, 0.03, px) * step(abs(v - dc.y), 1.1);
  frame = max(frame, mull);

  // curtains behind glass
  float cover = h2 < 0.35 ? 0.0 : (h2 < 0.8 ? 0.18 + 0.3 * h3 : 0.92);
  float uu = (u - dc.x) / 1.18;
  float curtain = max(1.0 - smoothstep(-1.0 + cover - 0.02, -1.0 + cover + 0.02, uu),
                      smoothstep(1.0 - cover * 0.6 - 0.02, 1.0 - cover * 0.6 + 0.02, uu));
  curtain *= step(0.3, h2);
  float fold = 0.85 + 0.15 * sin(u * 40.0 + h3 * 6.0);
  vec3 cCol = mix(vec3(0.62, 0.55, 0.45), vec3(0.72, 0.72, 0.70), step(0.6, h3)) * fold;

  vec3 glass = vec3(0.006, 0.008, 0.011);
  vec3 inside = mix(glass, cCol * 0.35, curtain);
  float g = door * (1.0 - frame);
  vec3 c = mix(wall, vec3(0.62, 0.63, 0.64), frame * door);
  c = mix(c, inside, g);
  float avgG = 0.62;
  vec3 far = mix(wall, vec3(0.03, 0.035, 0.04), avgG);
  alb = mix(c, far, lf);
  rgh = mix(mix(0.42, mix(0.05, 0.3, curtain), g), 0.2, lf);
  mtl = 0.0;
  bump = -min(0.03, px * 0.5) * door * (1.0 - lf);

  float top = 2.62;
  ao = mix(0.22, 0.62, smoothstep(0.0, 1.6, top - v));
  ao *= mix(0.55, 1.0, smoothstep(0.0, 0.55, uBay * 0.5 - abs(u)));
  ao *= mix(0.8, 1.0, smoothstep(0.0, 0.35, v));
  ao = mix(ao, 0.45, lf);
  alb *= mix(0.75, 1.0, ao);

  float lit = step(0.62, h1);
  float glow = lit * uNight * (0.55 + 0.45 * h3);
  vec3 room = mix(WARM, vec3(1.0, 0.82, 0.62), h2) * (0.8 + 0.4 * h3);
  emi += room * glow * g * mix(0.7, 1.1, curtain) * (1.0 - lf) + room * glow * avgG * 0.45 * lf;
  emi += room * glow * 0.35 * exp(-(top - v) * 2.2) * smoothstep(1.6, 0.2, abs(u)) * (1.0 - g) * (1.0 - lf);
}`;

// ---------------------------------------------------------------- dark glass band with mullions
const GLASSBAND = COMMON + /* glsl */`
uniform vec4 uMull;   // pitch, half width, spandrel height, base y
uniform float uDeckH;
uniform vec3 uGlass;
uniform vec3 uFrame;
uniform float uGlow;
${SIG} {
  float px = pxOf(p);
  float cx = (fract(s / uMull.x) - 0.5) * uMull.x;
  float lf = lodFade(uMull.x * 0.5, px);
  float mull = mix(lineCov(cx, uMull.y, px), 2.0 * uMull.y / uMull.x, lf);
  float v = mod(p.y - uMull.w, uDeckH);
  float sp = uMull.z > 0.0 ? (smoothstep(uDeckH - uMull.z - px, uDeckH - uMull.z + px, v)) : 0.0;
  float tr = uMull.z > 0.0 ? lineCov(v - 1.05, 0.03, px) * (1.0 - lf) : 0.0;
  float frame = clamp(max(max(mull, sp), tr), 0.0, 1.0);
  float nz = vnoise(vec2(s * 0.08, p.y * 0.2));
  vec3 g = uGlass * (0.85 + 0.3 * nz);
  alb = mix(g * 4.0 + vec3(0.02), uFrame, frame);
  rgh = mix(0.04, 0.35, frame);
  mtl = mix(0.55, 0.2, frame);
  float room = 0.25 + 0.75 * smoothstep(0.25, 0.8, vnoise(vec2(s * 0.22, floor((p.y - uMull.w) / uDeckH) * 3.7)));
  emi += WARM * uGlow * uNight * (1.0 - frame) * room;
}`;

// ---------------------------------------------------------------- deck surfaces
const DECK = COMMON + /* glsl */`
uniform float uTeak;
uniform vec3 uPaint;
${SIG} {
  float px = pxOf(p);
  vec2 q = p.xz;
  // painted deck with non-slip texture and wear
  vec3 paint = uPaint * (0.93 + 0.1 * vnoise(q * 0.35) + 0.04 * vnoise(q * 3.0));
  float pl = 1.0 - lodFade(0.5, px);
  float seamP = max(lineCov(fract(q.x / 2.4) - 0.5, 0.004, px / 2.4), lineCov(fract(q.y / 1.2) - 0.5, 0.008, px / 1.2)) * pl;
  paint *= 1.0 - 0.07 * seamP;
  // teak planks along x
  float pw = 0.16;
  float row = floor(q.y / pw);
  float off = hash11(row * 1.7 + 3.0) * 6.0;
  float seg = floor((q.x + off) / 6.0);
  float tone = hash12(vec2(row, seg));
  float grain = vnoise(vec2(q.x * 0.6, q.y * 30.0));
  vec3 teak = vec3(0.34, 0.20, 0.105) * (0.78 + 0.34 * tone) * (0.88 + 0.22 * grain);
  float lf = lodFade(pw, px);
  float caulk = lineCov(fract(q.y / pw) - 0.5, 0.012 / pw, px / pw) * (1.0 - lf);
  float butt = lineCov(fract((q.x + off) / 6.0) - 0.5, 0.006, px / 6.0) * (1.0 - lodFade(0.4, px));
  teak = mix(teak, vec3(0.03, 0.025, 0.02), max(caulk, butt) * 0.8);
  teak = mix(teak, vec3(0.30, 0.19, 0.11), lf * 0.5);
  alb = mix(paint, teak, uTeak);
  rgh = mix(0.62, 0.72, uTeak);
  mtl = 0.0;
}`;

// ---------------------------------------------------------------- white paint (vertex coloured)
const PAINT = COMMON + /* glsl */`
${SIG} {
  alb *= 0.965 + 0.05 * vnoise(p.xy * 0.4 + p.zx * 0.23);
}`;

export function makeMaterials() {
  const M = {};
  M.hull = procMaterial({ key: 'hull', surface: HULL, params: { roughness: 0.34, metalness: 0 } });
  M.hullDS = procMaterial({ key: 'hull', surface: HULL, params: { roughness: 0.34, metalness: 0, side: THREE.DoubleSide } });

  const wall = (win, row, color, lit) => procMaterial({
    key: 'wall', surface: WALL,
    uniforms: { uWin: { value: new THREE.Vector4(...win) }, uRow: { value: new THREE.Vector4(...row) }, uWall: { value: new THREE.Color(color) }, uLit: { value: lit } },
    params: { roughness: 0.4, metalness: 0 },
  });
  M.wallPublic = wall([4.4, 1.9, 1.05, 0.08], [22.55, 2.9, 1, 0.8], 0xd6d7d8, 0.45);
  M.wallPromenade = wall([3.3, 1.2, 1.15, 0.05], [15.0, 2.9, 2, 0.0], 0xcfd0d1, 0.7);
  M.wallStair = wall([2.2, 0.35, 0.45, 0.08], [25.65, 2.9, 12, 0.6], 0xd9dadb, 0.5);
  M.wallHouse = wall([2.6, 1.0, 0.8, 0.06], [60.6, 2.9, 2, 0.3], 0xdcdcdc, 0.7);
  M.wallFunnelBase = wall([3.0, 0.5, 0.35, 0.1], [60.8, 2.9, 1, 0.0], 0xdcdcdc, 0.3);

  M.cabin = procMaterial({ key: 'cabin', surface: CABIN, uniforms: { uBay: { value: 3.3 }, uBase: { value: 24.2 } }, params: { roughness: 0.4, metalness: 0 } });
  M.cabinAft = procMaterial({ key: 'cabin', surface: CABIN, uniforms: { uBay: { value: 3.6 }, uBase: { value: 24.2 } }, params: { roughness: 0.4, metalness: 0 } });

  const gband = (mull, glass, frame, glow) => procMaterial({
    key: 'gband', surface: GLASSBAND,
    uniforms: { uMull: { value: new THREE.Vector4(...mull) }, uDeckH: { value: 2.9 }, uGlass: { value: new THREE.Color(...glass) }, uFrame: { value: new THREE.Color(frame) }, uGlow: { value: glow } },
    params: { roughness: 0.05, metalness: 0 },
  });
  M.glassFront = gband([1.6, 0.05, 0.0, 24.2], [0.012, 0.016, 0.022], 0xbfc3c6, 0.5);
  M.glassBridge = gband([1.25, 0.06, 0.0, 24.2], [0.004, 0.006, 0.01], 0x3a3f44, 0.15);
  M.glassAtrium = gband([2.1, 0.07, 0.0, 12.5], [0.018, 0.026, 0.036], 0xd6d9dc, 0.45);
  M.glassLobby = gband([1.1, 0.05, 0.45, 24.2], [0.01, 0.014, 0.02], 0xdadada, 1.2);
  M.glassHouse = gband([1.5, 0.05, 0.0, 59.0], [0.012, 0.018, 0.024], 0xcfd2d4, 1.0);

  const deck = (teak, paint) => procMaterial({
    key: 'deck', surface: DECK,
    uniforms: { uTeak: { value: teak }, uPaint: { value: new THREE.Color(paint) } },
    params: { roughness: 0.65, metalness: 0 },
  });
  M.deckPaint = deck(0, 0x9aa7ac);
  M.deckLight = deck(0, 0xb9b5ac);
  M.deckTeak = deck(1, 0xffffff);
  M.deckGreen = deck(0, 0x4f6b62);
  M.deckBlue = deck(0, 0x3f7fa8);

  M.paint = procMaterial({ key: 'paint', surface: PAINT, params: { vertexColors: true, roughness: 0.42, metalness: 0 } });
  M.paintDS = procMaterial({ key: 'paint', surface: PAINT, params: { vertexColors: true, roughness: 0.42, metalness: 0, side: THREE.DoubleSide } });

  M.railGlass = new THREE.MeshStandardMaterial({
    color: 0x4d6a72, transparent: true, opacity: 0.26, roughness: 0.05, metalness: 0.0,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.0,
  });
  M.lamp = new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.3, metalness: 0, emissive: 0xffc27a, emissiveIntensity: 0 });
  M.metalDark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.45, metalness: 0.6 });
  M.metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.85 });
  return M;
}

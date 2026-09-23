import * as THREE from 'three';
import { NOISE, BUMP } from './glsl.js';

// Procedural wet, weathered paint / metal material for the helicopter.
// Everything is driven by the object-space position (helicopter frame) so that
// camouflage, panel lines and rivets stay continuous across separate parts.
export const hullUniforms = {
  uTime: { value: 0 },
  uFlash: { value: 0 },
  uSmokeSrc: { value: new THREE.Vector3(-1.0, 3.9, 0.35) },
};

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform vec3 uSmokeSrc;
varying vec3 vLocal;
varying vec3 vLocalN;
${NOISE}
${BUMP}

float lineD(float v, float s){ return abs(fract(v / s + .5) - .5) * s; }

float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }

float tearNoise(vec3 p){
  return .30 * (vnoise3(p * vec3(1., 2.6, 2.6) + 4.) - .5) * 2. + .09 * (vnoise3(p * 9.) - .5) * 2.;
}
`;

const FRAG_MAIN = /* glsl */ `
  vec3 p = vLocal;
  vec3 hCol; float hRough = .62; float hMetal = .08; float hH = 0.; float hCoat = .55; float hGlass = 0.;
  vec3 hEmit = vec3(0.);
  float aaW = max(fwidth(p.x) + fwidth(p.y) + fwidth(p.z), 1e-4);
  float tearEdge = 99.;
  float az = 0.;

#ifdef FUSELAGE
  // sliding door opening (port side, front of cabin)
  if(p.z < -.55 && p.x > 3.05 && p.x < 4.25 && p.y > .64 && p.y < 2.4) discard;
  float tx = -6.3 + tearNoise(p);
  if(p.x < tx) discard;
  tearEdge = p.x - tx;
#endif
#ifdef TAILPIECE
  float tx2 = -6.72 + tearNoise(p + vec3(.4, 0., 0.));
  if(p.x > tx2) discard;
  tearEdge = tx2 - p.x;
#endif

  // ---------------- base paint ----------------
#if defined(CAMO)
  vec3 q = p * vec3(.24, .3, .3);
  q += .75 * vec3(fbm3(q * 1.6 + 3.1), fbm3(q * 1.6 + 8.3), fbm3(q * 1.6 + 1.7));
  float c1 = fbm3(q + 5.);
  float c2 = fbm3(q * 1.25 + 11.);
  vec3 green = vec3(.11, .14, .07), brown = vec3(.2, .13, .075), sand = vec3(.3, .27, .18), dgreen = vec3(.06, .08, .045);
  hCol = green;
  hCol = mix(hCol, brown, smoothstep(.5, .515, c1));
  hCol = mix(hCol, sand, smoothstep(.575, .59, c2) * (1. - smoothstep(.5, .515, c1)));
  hCol = mix(hCol, dgreen, smoothstep(.585, .6, c1) + smoothstep(.43, .415, c2) * .8);
#elif defined(DARK)
  hCol = vec3(.085, .09, .088) * (.8 + .4 * fbm3(p * 2.));
  hMetal = .35; hRough = .5;
#elif defined(STRUT)
  hCol = vec3(.11, .12, .085) * (.8 + .4 * fbm3(p * 3.));
  hMetal = .25; hRough = .45;
#endif

  // fading + blotchy weathering
  float wv = fbm3(p * 2.6 + 7.);
  hCol *= .78 + .42 * wv;
  // vertical rain streaks / drip grime
  float streak = vnoise3(vec3(p.x * 11., p.y * .55, p.z * 11.));
  hCol *= 1. - .22 * smoothstep(.45, .9, streak);
  hRough -= .12 * smoothstep(.5, .9, streak);

#ifdef PANELS
  // panel seams: frames along x, stringers along y and roof lines along z
  float fx = lineD(p.x + .12, .64);
  float fy = min(min(abs(p.y - .92), abs(p.y - 1.52)), min(abs(p.y - 2.48), abs(p.y - 3.42)));
  float fz = p.y > 2.95 ? min(abs(abs(p.z) - .56), abs(p.z)) : 9.;
  float dSeam = min(fx, min(fy, fz));
  float seam = 1. - smoothstep(.0028, .0028 + aaW * .8, dSeam);
  // rivets beside the seams
  float t = p.y + abs(p.z);
  float r1 = length(vec2(abs(lineD(p.x + .12, .64)) - .022, (fract(t / .048) - .5) * .048));
  float r2 = length(vec2(fy - .02, (fract(p.x / .048) - .5) * .048));
  float rv = min(r1, r2);
  float rivet = (1. - smoothstep(.0045, .0065, rv)) * (1. - smoothstep(.004, .012, aaW));
  hH += -.0035 * seam + .0016 * rivet;
  hCol *= 1. - .45 * seam;
  hCol *= 1. + .25 * rivet;
  // subtle skin oil-canning between frames and crash dents
  hH += .004 * (vnoise3(p * vec3(1.6, 4., 4.)) - .5) + .03 * (fbm3(p * .7 + 2.) - .5);
#endif

  // mud and grime on the lower body
  float mud = smoothstep(1.35, .35, p.y) * smoothstep(.25, .75, fbm3(p * vec3(3., 6., 3.) + 3.));
  hCol = mix(hCol, vec3(.07, .058, .04), mud * .85);
  hRough = mix(hRough, .85, mud);

  // chipped paint -> bare aluminium
  float chip = smoothstep(.70, .74, fbm3(p * 9. + 1.3) + .08 * (1. - smoothstep(0., .03, abs(p.y - 2.48))));
#ifdef DARK
  chip *= .4;
#endif
  hCol = mix(hCol, vec3(.42, .43, .44), chip);
  hMetal = mix(hMetal, .95, chip);
  hRough = mix(hRough, .38, chip);
  hH += .0012 * chip;

  // soot from the burning engine and exhaust
  float sd = distance(p, uSmokeSrc);
  float soot = smoothstep(2.6, .2, sd + (fbm3(p * 3.) - .5) * 1.4);
  float exL = step(abs(p.z), 99.) * smoothstep(-1.2, -1.9, p.x) * smoothstep(-5.8, -3.2, p.x);
  float exBand = 1. - smoothstep(.0, .35, abs(p.y - (3.05 + (p.x + 1.6) * .06)) - .1 * vnoise3(p * vec3(1.,8.,8.)));
  soot = max(soot, exL * exBand * step(.8, abs(p.z)) * .85);
  hCol = mix(hCol, vec3(.012, .011, .01), soot);
  hRough = mix(hRough, .92, soot);
  hCol *= 1. - .25 * smoothstep(.3, 0., sd - .9);

  // hot embers glowing inside the soot patch
  float ember = smoothstep(.72, .9, fbm3(p * 6. + vec3(0., -uTime * .35, 0.))) * smoothstep(1.4, .5, sd);
  float flick = .7 + .3 * sin(uTime * 13. + p.x * 7.) * sin(uTime * 7.3);
  hEmit += vec3(1., .32, .06) * ember * flick * 2.2;

#ifdef FUSELAGE
  // ---------- glazing ----------
  vec2 nosePl = vec2(p.x - 5.15, p.z);
  az = atan(nosePl.y, nosePl.x);
  float gl = 0.; float frame = 0.;
  if(p.x > 5.9 && p.y > 1.58 && vLocalN.y < .88){
    float fr = min(abs(az), min(abs(abs(az) - .56), abs(abs(az) - 1.08)));
    float frd = fr * length(nosePl);
    float hf = abs(p.y - 2.2);
    float m = smoothstep(.022, .022 + aaW, min(frd, hf));
    float edge = smoothstep(5.9, 5.94, p.x) * smoothstep(1.58, 1.62, p.y) * smoothstep(.88, .8, vLocalN.y) * step(abs(az), 1.5);
    gl = edge * m;
    frame = edge * (1. - m);
  }
  if(p.x > 6.2 && p.y > .88 && p.y < 1.44 && abs(az) > .1 && abs(az) < .95){
    float m = 1. - smoothstep(.02, .02 + aaW, abs(az) * length(nosePl) - .1 * length(nosePl));
    float hb = min(abs(p.y - .88), abs(p.y - 1.44));
    gl = max(gl, smoothstep(.02, .03, hb) * smoothstep(.1, .14, abs(az)) * smoothstep(.95, .9, abs(az)));
  }
  if(abs(p.z) > .7){
    // side blister windows
    vec2 bw = vec2(p.x - 5.42, p.y - 2.26);
    float bd = sdRoundBox(bw, vec2(.5, .34), .12);
    float bf = abs(p.x - 5.42);
    gl = max(gl, (1. - smoothstep(-.01, .0, bd)) * smoothstep(.02, .03, bf));
    frame = max(frame, (1. - smoothstep(.0, .05, abs(bd))));
    // round cabin portholes
    float side = sign(p.z);
    for(int i = 0; i < 6; i++){
      float cx = -3.4 + float(i) * 1.12;
      if(side < 0. && i == 5) continue;
      float d = length(vec2(p.x - cx, p.y - 2.06));
      float g = 1. - smoothstep(.19 - aaW, .19, d);
      gl = max(gl, g);
      float rim = smoothstep(.19, .2, d) * (1. - smoothstep(.245, .255, d));
      hH += .006 * rim;
      hCol = mix(hCol, vec3(.02), rim * .85);
      hRough = mix(hRough, .8, rim);
    }
    // door frame rim around the opening
    if(side < 0.){
      float dd = sdRoundBox(vec2(p.x - 3.65, p.y - 1.52), vec2(.6, .88), .05);
      float rim = 1. - smoothstep(.0, .05, dd);
      hCol = mix(hCol, vec3(.03, .035, .03), rim * .7);
      hH += .004 * (1. - smoothstep(.02, .05, dd));
    }
  }
  hCol = mix(hCol, hCol * .6, frame);
  hGlass = gl;
#endif
#ifdef DOORPANEL
  {
    float d = length(vec2(p.x - 2.45, p.y - 2.06));
    hGlass = 1. - smoothstep(.19 - aaW, .19, d);
    float rim = smoothstep(.19, .2, d) * (1. - smoothstep(.245, .255, d));
    hH += .006 * rim; hCol = mix(hCol, vec3(.02), rim * .85);
    float handle = 1. - smoothstep(.0, .01, sdRoundBox(vec2(p.x - 2.95, p.y - 1.45), vec2(.02, .12), .01));
    hH += .01 * handle; hCol = mix(hCol, vec3(.25), handle);
  }
#endif

  // torn metal edges: bare metal lip, then burnt paint
  float te = tearEdge;
  hCol = mix(hCol, vec3(.03, .028, .025), (1. - smoothstep(.05, .6 + .3 * vnoise3(p * 5.), te)) * .9);
  float lip = 1. - smoothstep(.02, .06, te);
  hCol = mix(hCol, vec3(.5, .5, .52), lip);
  hMetal = mix(hMetal, 1., lip);
  hRough = mix(hRough, .35, lip);

  // glass
  if(hGlass > 0.){
    vec3 gcol = vec3(.03, .038, .042);
    float gr = .03;
    // crash cracks in one windscreen pane
    vec2 cp = vec2(az * 3.2, p.y * 3.);
    vec2 vr = voronoi2(cp * 3.5);
    float crackZone = step(.56, az) * step(az, 1.08) * step(2.2, p.y) * step(5.9, p.x);
    float crack = crackZone * (1. - smoothstep(.0, .035, vr.y)) * smoothstep(1.1, .0, length(vec2(az - .8, p.y - 2.45) * vec2(2.,3.)));
    gcol += vec3(.28) * crack;
    gr = mix(gr, .45, crack);
    hCol = mix(hCol, gcol, hGlass);
    hRough = mix(hRough, gr, hGlass);
    hMetal = mix(hMetal, 0., hGlass);
    hCoat = mix(hCoat, 1., hGlass);
    hH *= 1. - hGlass;
  }

  // rain beads on the painted skin
  vec2 dropUV = vec2(p.x + p.z * .7, p.y * 1.2 + abs(p.z) * .5) * 34.;
  vec2 dv = voronoi2(dropUV);
  float drop = (1. - smoothstep(.12, .22, dv.x)) * step(.62, hash12(floor(dropUV)));
  hH += .0012 * drop;
  hRough = mix(hRough, .08, drop * .8);

  // interior (back faces)
#if defined(FUSELAGE) || defined(TAILPIECE) || defined(DOORPANEL)
  if(!gl_FrontFacing){
    hCol = vec3(.05, .058, .05) * (.7 + .5 * fbm3(p * 4.));
    hRough = .8; hMetal = .1; hCoat = 0.; hEmit = vec3(0.); hH = 0.;
  }
#endif
`;

export function makeHullMaterial(mode = 'camo', flags = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.1,
    clearcoat: 0.4,
    clearcoatRoughness: 0.14,
    side: flags.single ? THREE.FrontSide : THREE.DoubleSide,
    envMapIntensity: 1.0,
  });
  const defines = {};
  if (mode === 'camo') { defines.CAMO = ''; defines.PANELS = ''; }
  if (mode === 'dark') defines.DARK = '';
  if (mode === 'strut') defines.STRUT = '';
  if (flags.fuselage) defines.FUSELAGE = '';
  if (flags.tail) defines.TAILPIECE = '';
  if (flags.door) defines.DOORPANEL = '';
  if (flags.noPanels) delete defines.PANELS;
  if (window.__dbg) defines.DEBUG_HULL = window.__dbg;
  mat.defines = defines;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, hullUniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vLocalN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;\nvLocalN = normal;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_MAIN)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = hCol;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(hRough, .03, 1.);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(hMetal, 0., 1.);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = perturbBump(-vViewPosition, normal, hH, faceDirection);')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat = hCoat;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += hEmit;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#ifdef DEBUG_HULL\ngl_FragColor = vec4(DEBUG_HULL, 1.);\n#endif');
  };
  mat.customProgramCacheKey = () => 'hull-' + mode + JSON.stringify(flags);
  return mat;
}

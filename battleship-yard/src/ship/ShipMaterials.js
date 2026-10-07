import * as THREE from 'three';
import { GLSL_NOISE } from '../engine/shaderlib.js';
import { PAINTS } from './ShipDesign.js';

/**
 * Ship paint shader (MeshStandardMaterial + injected weathering):
 *  - scanned painted-plate texture drives plate seams and wear; colour comes from the paint scheme
 *  - hull: red anti-fouling below the boot-top, black boot-top band, waterline scum
 *  - rust weeping from deck edges / scuppers, grime under horizontal edges
 *  - optional dazzle camouflage
 */
function paintMaterial(set, name, opts) {
  const m = new THREE.MeshStandardMaterial({
    name, color: 0xffffff, map: set?.map || null, normalMap: set?.normalMap || null,
    roughnessMap: set?.arm || null, aoMap: set?.arm || null, metalness: 0.15, roughness: 1, aoMapIntensity: 0.6,
  });
  if (m.normalMap) m.normalScale.set(0.6, -0.6);
  const u = {
    uPaint: { value: new THREE.Color() }, uIsHull: { value: opts.hull ? 1 : 0 }, uDazzle: { value: 0 },
    uDeckY: { value: 8 }, uRust: { value: opts.rust ?? 1 }, uDazzleB: { value: new THREE.Color().setRGB(0.16, 0.19, 0.22, THREE.SRGBColorSpace) },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSLocal;
        uniform vec3 uPaint; uniform float uIsHull; uniform float uDazzle; uniform float uDeckY; uniform float uRust; uniform vec3 uDazzleB;
        ${GLSL_NOISE}
        float streak(vec3 p, float topY, float density){
          float colW = 1.9;
          float c = floor(p.x / colW + (p.z > 0.0 ? 0.0 : 0.5));
          float h = bsy_hash12(vec2(c, sign(p.z) + 3.0));
          if (h > density) return 0.0;
          float fx = fract(p.x / colW + (p.z > 0.0 ? 0.0 : 0.5));
          float w = 0.05 + 0.12 * bsy_vnoise(vec2(c * 7.1, p.y * 0.8));
          float lane = 1.0 - smoothstep(w * 0.4, w, abs(fx - 0.5 - 0.1 * (bsy_vnoise(vec2(p.y * 0.6, c)) - 0.5)));
          float len = 1.2 + 6.0 * bsy_hash12(vec2(c, 9.0));
          float fall = 1.0 - smoothstep(0.0, len, topY - p.y);
          return lane * fall * (0.4 + 0.6 * bsy_vnoise(vec2(p.x * 3.0, p.y * 0.3)));
        }`)
      .replace('#include <map_fragment>', `
        vec3 paint = uPaint;
        float detail = 1.0;
        #ifdef USE_MAP
          vec4 texel = texture2D(map, vMapUv);
          vec4 avg = textureLod(map, vMapUv, 12.0);
          float lum = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722)), alum = dot(avg.rgb, vec3(0.2126, 0.7152, 0.0722)) + 1e-3;
          detail = clamp(lum / alum, 0.55, 1.45);
        #endif
        vec3 p = vSLocal;
        float big = bsy_fbm(p.xz * 0.05 + p.y * 0.07);
        if (uDazzle > 0.5) {
          float a = dot(p.xy, normalize(vec2(0.8, 0.6))) * 0.11 + bsy_fbm(p.xy * 0.03) * 2.0;
          float b2 = dot(p.xy, normalize(vec2(-0.5, 0.9))) * 0.07;
          float pat = step(0.5, fract(a)) * step(0.35, fract(b2 + 0.2 * sign(p.z)));
          paint = mix(paint, uDazzleB, pat);
        }
        float roughP = 0.62;
        if (uIsHull > 0.5) {
          float boot = smoothstep(-0.55, -0.45, p.y) * (1.0 - smoothstep(0.75, 0.85, p.y));
          float below = 1.0 - smoothstep(-0.55, -0.45, p.y);
          paint = mix(paint, vec3(0.025, 0.026, 0.028), boot);
          paint = mix(paint, vec3(0.16, 0.025, 0.018) * (0.85 + 0.3 * big), below);
          // waterline scum just above the boot-top
          float scum = (1.0 - smoothstep(0.8, 2.2 + big, p.y)) * smoothstep(0.6, 0.9, p.y);
          paint = mix(paint, paint * vec3(0.72, 0.74, 0.62), scum * 0.6);
          roughP = mix(roughP, 0.75, below);
        }
        float topY = uIsHull > 0.5 ? uDeckY : (floor(p.y / 2.6) + 1.0) * 2.6;
        float rust = uRust * streak(p, topY, uIsHull > 0.5 ? 0.33 : 0.2) * (uIsHull > 0.5 ? step(0.85, p.y) : 1.0);
        float edgeGrime = uRust * (0.5 + 0.5 * big) * 0.18;
        paint *= 1.0 - edgeGrime * 0.5;
        paint = mix(paint, vec3(0.09, 0.035, 0.012), clamp(rust * 0.75, 0.0, 0.75));
        diffuseColor.rgb *= paint * mix(1.0, detail, 0.35);`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughP;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= mix(0.75, 1.25, texture2D(roughnessMap, vRoughnessMapUv).g);
        #endif
        roughnessFactor = clamp(roughnessFactor + rust * 0.2, 0.2, 1.0);`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.08;');
  };
  m.customProgramCacheKey = () => 'shippaint';
  return m;
}

function railingTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 64);
  g.fillStyle = '#fff';
  for (let x = 0; x < 512; x += 128) g.fillRect(x + 2, 2, 5, 62); // stanchions every 1.2 m (4 per tile)
  for (const y of [3, 24, 44]) g.fillRect(0, y, 512, 3); // top rail + two wires
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

export class ShipMaterials {
  constructor(lib) {
    const plate = lib.sets.get('blue_metal_plate');
    const deck = lib.sets.get('wood_floor_deck');
    const diamond = lib.sets.get('metal_plate');
    this.hull = paintMaterial(plate, 'ship-hull', { hull: true });
    this.paint = paintMaterial(plate, 'ship-upper', { hull: false });
    this.turret = paintMaterial(plate, 'ship-turret', { hull: false, rust: 0.6 });
    this.deck = new THREE.MeshStandardMaterial({
      name: 'ship-deck', map: deck?.map, normalMap: deck?.normalMap, roughnessMap: deck?.arm, aoMap: deck?.arm,
      color: new THREE.Color(0.95, 0.86, 0.78), metalness: 0, roughness: 1,
    });
    if (this.deck.normalMap) this.deck.normalScale.set(0.8, -0.8);
    // weathered teak: desaturate the scanned planks and add salt-bleached patches
    this.deck.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDL = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDL;\n' + GLSL_NOISE)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float bleach = bsy_fbm(vDL.xz * 0.12);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dl) * vec3(1.15, 1.05, 0.92), 0.45 + 0.25 * bleach);
          diffuseColor.rgb *= 0.95 + 0.25 * bleach;`);
    };
    this.deck.customProgramCacheKey = () => 'shipdeck';
    this.steelDeck = new THREE.MeshStandardMaterial({
      name: 'ship-steel-deck', map: diamond?.map, normalMap: diamond?.normalMap, roughnessMap: diamond?.arm, metalnessMap: diamond?.arm,
      color: new THREE.Color(0.55, 0.57, 0.58), metalness: 1, roughness: 1,
    });
    if (this.steelDeck.normalMap) this.steelDeck.normalScale.set(1, -1);
    this.dark = new THREE.MeshStandardMaterial({ name: 'ship-dark', color: 0x151617, roughness: 0.55, metalness: 0.3 });
    this.soot = new THREE.MeshStandardMaterial({ name: 'ship-soot', color: 0x0b0b0b, roughness: 0.95, metalness: 0 });
    this.canvas = new THREE.MeshStandardMaterial({ name: 'ship-canvas', color: new THREE.Color(0.36, 0.35, 0.3), roughness: 0.95, metalness: 0 });
    this.glass = new THREE.MeshPhysicalMaterial({ name: 'ship-glass', color: 0x0a0d10, roughness: 0.05, metalness: 0, clearcoat: 1, envMapIntensity: 1.4 });
    this.brass = new THREE.MeshStandardMaterial({ name: 'ship-brass', color: 0x8a6a35, roughness: 0.35, metalness: 1 });
    this.chain = new THREE.MeshStandardMaterial({ name: 'ship-chain', color: 0x2a2725, roughness: 0.7, metalness: 0.8 });
    this.railing = new THREE.MeshStandardMaterial({
      name: 'ship-railing', color: 0x7d8387, alphaMap: railingTexture(), alphaTest: 0.45, side: THREE.DoubleSide,
      roughness: 0.6, metalness: 0.2,
    });
    this.flag = new THREE.MeshStandardMaterial({ name: 'ship-flag', color: 0xb8b2a8, roughness: 0.9, side: THREE.DoubleSide });
    this.wood = new THREE.MeshStandardMaterial({ name: 'ship-boat-wood', color: 0x6b4a2e, roughness: 0.7 });
  }

  setPaint(key, deckY) {
    const p = PAINTS[key] || PAINTS.haze;
    this.hull.userData.u.uPaint.value.setRGB(...p.hull, THREE.SRGBColorSpace); // scheme values are sRGB swatches
    this.paint.userData.u.uPaint.value.setRGB(...p.upper, THREE.SRGBColorSpace);
    this.turret.userData.u.uPaint.value.setRGB(...p.deck.map((v, i) => (v + p.upper[i]) / 2), THREE.SRGBColorSpace);
    for (const m of [this.hull, this.paint, this.turret]) {
      m.userData.u.uDazzle.value = p.dazzle ? 1 : 0;
      m.userData.u.uDeckY.value = deckY;
    }
    this.railing.color.setRGB(...p.upper, THREE.SRGBColorSpace).multiplyScalar(0.9);
    this.funnelBuff = !!p.buffFunnel;
  }
}

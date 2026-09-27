// Local light rigs. Intensities are physical (candela for point/spot) and tuned for exposure 1.0 with ACES.
// Each light is coupled to shelter power: brown-outs dim and flicker the electric lights; fire keeps burning.
import * as THREE from 'three';
import { instance } from './assets.js';
import { M } from './materials.js';

export const rigs = [];
let shadowBudget = 0, shadowSize = 1024;

export function configureShadows(preset) {
  shadowBudget = preset.shadows ? preset.maxShadowLights : 0;
  shadowSize = preset.shadowSize;
  // Highest-priority lights get shadows first.
  const sorted = [...rigs].filter((r) => r.shadowPriority > 0).sort((a, b) => b.shadowPriority - a.shadowPriority);
  let n = 0;
  for (const r of rigs) r.light.castShadow = false;
  for (const r of sorted) {
    if (n >= shadowBudget) break;
    // Point-light shadows cost six renders: count them triple.
    const cost = r.light.isPointLight ? 3 : 1;
    if (n + cost > shadowBudget) continue;
    r.light.castShadow = true;
    r.light.shadow.mapSize.set(r.light.isPointLight ? shadowSize / 2 : shadowSize, r.light.isPointLight ? shadowSize / 2 : shadowSize);
    r.light.shadow.map?.dispose(); r.light.shadow.map = null;
    n += cost;
  }
}

function tuneShadow(l, near = 0.1, far = 20) {
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.02;
  l.shadow.radius = 3;
  l.shadow.camera.near = near;
  l.shadow.camera.far = far;
}

// Hanging lamp with a real spot light aimed down and a warm emissive bulb.
export function hangingLamp(scene, x, y, z, { model = 'hanging_industrial_lamp', cd = 90, color = 0xffe4c8, angle = 1.05, priority = 1, electric = true } = {}) {
  const g = new THREE.Group();
  const lamp = instance(model);
  // The fixture surrounds its own light: letting it cast shadows would black out the floor beneath it.
  lamp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  g.add(lamp);
  const drop = model === 'hanging_industrial_lamp' ? -1.2 : -0.62;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), M.bulbOn.clone());
  bulb.position.set(0, drop, 0);
  g.add(bulb);
  const l = new THREE.SpotLight(color, cd, 18, angle, 0.65, 2);
  l.position.set(0, drop - 0.03, 0);
  l.target.position.set(0, -10, 0);
  g.add(l, l.target);
  tuneShadow(l);
  g.position.set(x, y, z);
  scene.add(g);
  const rig = { light: l, extra: [], bulb, base: cd, electric, shadowPriority: priority, phase: Math.random() * 100, kind: 'lamp' };
  rigs.push(rig);
  return rig;
}

export function fireLight(scene, x, y, z) {
  const l = new THREE.PointLight(0xff9a50, 38, 14, 2);
  l.position.set(x, y, z);
  tuneShadow(l, 0.2, 14);
  scene.add(l);
  const rig = { light: l, extra: [], base: 38, electric: false, shadowPriority: 2, phase: 0, kind: 'fire' };
  rigs.push(rig);
  return rig;
}

export function pointLamp(scene, x, y, z, { cd = 12, color = 0xffdcb4, range = 6, electric = true, priority = 0, kind = 'lamp' } = {}) {
  const l = new THREE.PointLight(color, cd, range, 2);
  l.position.set(x, y, z);
  tuneShadow(l, 0.1, range);
  scene.add(l);
  const rig = { light: l, extra: [], base: cd, electric, shadowPriority: priority, phase: Math.random() * 100, kind };
  rigs.push(rig);
  return rig;
}

// power01: 0..1 shelter power level.  t: seconds.
export function updateLights(t, power01) {
  const brown = power01 <= 0 ? 0 : THREE.MathUtils.smoothstep(power01, 0.0, 0.25);
  for (const r of rigs) {
    let k = 1;
    if (r.kind === 'fire') {
      // Layered noise flicker for burning wood in a barrel.
      k = 0.78 + 0.12 * Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1.3) + 0.1 * Math.sin(t * 23.3 + Math.sin(t * 5.1));
    } else if (r.kind === 'emergency') {
      k = 0.85 + 0.15 * Math.sin(t * 2.0 + r.phase);
    } else if (r.electric) {
      k = brown;
      if (power01 < 0.25 && power01 > 0) {
        // brown-out flicker
        const n = Math.sin(t * 31 + r.phase) * Math.sin(t * 7.3 + r.phase * 2.1);
        if (n > 0.55) k *= 0.25;
      }
      if (r.flicker) { const n = Math.sin(t * 17 + r.phase) + Math.sin(t * 29.7); if (n > 1.6) k *= 0.35; }
    }
    r.light.intensity = r.base * k;
    for (const e of r.extra) e.intensity = r.base * 0.12 * k;
    if (r.bulb) r.bulb.material.emissiveIntensity = 6 * k;
  }
}

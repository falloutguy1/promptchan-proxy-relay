// Gear the survivors carry, modelled with the architecture builder so it uses the
// same scanned wood, steel, canvas and hessian as the colony: a bolt-action rifle
// with a sling, axe, hammer, lantern, rucksack with bedroll, and loads carried
// in both arms (split logs, a grain sack, a jerrycan). Geometry is shared per
// kind; each prop is a small group of meshes (one per material).
//
// Frames: hand tools are modelled in grip space (origin in the fist, +Y along
// the handle towards the head, +Z the way the knuckles face); the rifle with its
// origin at the wrist of the stock, +Z towards the muzzle, +Y up; back and
// chest items in character space around the attachment point (+Z forward).
import * as THREE from 'three';
import { Geo } from '../world/arch/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WOOD = 'wood_weathered:#e2c6a2', DARK = 'wood_weathered:#b0906c', GRIP = 'wood_weathered:#8e7258';
const STEEL = 'metal_white:#6c6862', BLUED = 'metal_white:#34322f', RUST = 'metal_red:#9a8a80';
const CANVAS = 'canvas:#7e7552', CANVAS2 = 'canvas:#5f5a44', STRAP = 'burlap:#4e3f2c', ROLL = 'canvas:#556047';

/** Geometry per material key for one gear kind (in its own frame). */
export function gearGeometry(kind, tiles) {
  const g = new Geo(tiles);
  g.exposure = 0; // no façade run-off streaks on hand-held things
  g.baseY = -5;
  if (kind === 'rifle') {
    // stock: butt, wrist, fore-end; blued receiver, barrel with bands, bolt, sights
    g.beam(WOOD, V(0, -0.052, -0.4), V(0, -0.032, -0.2), 0.044, 0.118, 0.01);
    g.beam(WOOD, V(0, -0.032, -0.2), V(0, -0.006, -0.02), 0.036, 0.056, 0.008);
    g.box(BLUED, 0, -0.052, -0.404, 0.046, 0.122, 0.012, 0.003);
    g.beam(BLUED, V(0, 0.012, -0.05), V(0, 0.012, 0.17), 0.032, 0.036, 0.004);
    g.beam(WOOD, V(0, -0.014, 0.13), V(0, -0.008, 0.54), 0.04, 0.042, 0.008);
    g.tube(BLUED, [V(0, 0.016, 0.13), V(0, 0.016, 0.79)], [0.011, 0.0085], 10, true);
    for (const z of [0.3, 0.5]) g.tube(STEEL, [V(0, 0.004, z - 0.008), V(0, 0.004, z + 0.008)], 0.03, 10, true);
    g.box(BLUED, 0, -0.035, 0.07, 0.024, 0.042, 0.075, 0.004);
    g.box(BLUED, 0, -0.03, -0.005, 0.01, 0.03, 0.05, 0.002);
    g.tube(STEEL, [V(0.016, 0.022, 0.03), V(0.052, 0.004, 0.036)], 0.0055, 6, true);
    g.tube(STEEL, [V(0.05, 0.004, 0.036), V(0.06, 0.0, 0.037)], 0.011, 8, true);
    g.box(BLUED, 0, 0.035, 0.2, 0.022, 0.014, 0.016, 0.002);
    g.box(BLUED, 0, 0.032, 0.775, 0.005, 0.02, 0.01, 0.001);
    // sling hanging from the butt to the fore-end band
    const sling = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; sling.push(V(-0.024, -0.075 - Math.sin(t * Math.PI) * 0.1, -0.3 + t * 0.78)); }
    g.tube(STRAP, sling, 0.0065, 5, true);
  } else if (kind === 'axe') {
    g.tube(GRIP, [V(0, -0.14, 0), V(0, 0.52, 0)], [0.018, 0.016], 8, true);
    g.box(STEEL, 0, 0.53, 0.035, 0.024, 0.07, 0.07, 0.005);
    g.beam(STEEL, V(0, 0.53, 0.06), V(0, 0.53, 0.155), 0.012, 0.11, 0.003);
    g.box(RUST, 0, 0.53, -0.025, 0.028, 0.05, 0.03, 0.004);
  } else if (kind === 'hammer') {
    g.tube(GRIP, [V(0, -0.08, 0), V(0, 0.26, 0)], [0.015, 0.013], 8, true);
    g.box(STEEL, 0, 0.27, 0.0, 0.03, 0.03, 0.13, 0.004);
    g.box(STEEL, 0, 0.27, 0.075, 0.036, 0.036, 0.02, 0.004);
  } else if (kind === 'lantern') {
    // hurricane lantern hanging below the fist
    g.pushTRS(0, -0.06, 0);
    g.tube(STEEL, [V(-0.07, -0.02, 0), V(-0.06, 0.02, 0), V(0, 0.05, 0), V(0.06, 0.02, 0), V(0.07, -0.02, 0)], 0.003, 5, true);
    g.lathe(RUST, [[0.001, -0.07], [0.045, -0.07], [0.05, -0.08], [0.05, -0.1], [0.06, -0.1], [0.07, -0.26], [0.001, -0.26]], 14);
    g.lathe('glass', [[0.045, -0.1], [0.055, -0.13], [0.056, -0.2], [0.05, -0.235]], 14);
    g.lathe('lamp', [[0.001, -0.14], [0.012, -0.15], [0.001, -0.19]], 8);
    g.pop();
  } else if (kind === 'pack') {
    // rucksack on the upper back (origin between the shoulder blades), bedroll on top
    // body as a lathe (rounded, slightly sagging), lid, front and side pockets
    g.pushTRS(0, -0.1, -0.2, 0, 0, 0);
    g.push(new THREE.Matrix4().makeScale(1, 1, 0.52));
    g.lathe(CANVAS, [[0.001, -0.22], [0.12, -0.215], [0.165, -0.18], [0.175, -0.05], [0.17, 0.1], [0.15, 0.17], [0.09, 0.2], [0.001, 0.205]], 18);
    g.pop(); g.pop();
    g.box(CANVAS2, 0, 0.075, -0.205, 0.3, 0.1, 0.19, 0.045);
    g.box(CANVAS2, 0, -0.19, -0.3, 0.22, 0.15, 0.07, 0.03);
    for (const s of [-1, 1]) g.box(CANVAS2, s * 0.175, -0.13, -0.2, 0.06, 0.2, 0.11, 0.025);
    g.tube(ROLL, [V(-0.21, 0.19, -0.19), V(0.21, 0.19, -0.19)], 0.065, 12, true);
    for (const s of [-1, 1]) {
      g.tube(STRAP, [V(s * 0.1, 0.12, -0.12), V(s * 0.1, 0.19, -0.02), V(s * 0.1, 0.16, 0.08), V(s * 0.12, 0.04, 0.12)], 0.009, 5, true);
      g.box(STRAP, s * 0.1, 0.19, -0.19, 0.03, 0.14, 0.012, 0.002);
    }
  } else if (kind === 'wood') {
    for (const [x, y, z, r] of [[0, -0.02, 0.3, 0.07], [0.03, 0.1, 0.32, 0.06], [-0.02, -0.01, 0.43, 0.065], [0.01, 0.1, 0.44, 0.055]]) {
      g.tube(DARK, [V(-0.34, y, z), V(0.34, y + 0.01, z + x)], r, 9, true);
    }
  } else if (kind === 'sack') {
    g.pushTRS(0, -0.05, 0.33, 0, 0, Math.PI / 2);
    g.lathe('burlap:#a89878', [[0.001, -0.2], [0.1, -0.19], [0.16, -0.12], [0.17, 0.02], [0.14, 0.14], [0.06, 0.2], [0.03, 0.24], [0.001, 0.25]], 14);
    g.pop();
  } else if (kind === 'water') {
    g.box('metal_green:#8a9a78', 0, -0.05, 0.32, 0.17, 0.34, 0.26, 0.025);
    g.tube(STEEL, [V(-0.04, 0.14, 0.26), V(-0.04, 0.17, 0.3), V(-0.04, 0.17, 0.36), V(-0.04, 0.14, 0.38)], 0.012, 6, true);
    g.tube(STEEL, [V(0.05, 0.12, 0.38), V(0.05, 0.16, 0.4)], 0.022, 8, true);
  }
  return g.build();
}

/** Shared gear geometry + materials; `create(kind)` returns a fresh group. */
export class Gear {
  constructor(mats) {
    this.mats = mats;
    this.geo = new Map();
    this.mat = new Map();
  }
  #material(key) {
    let m = this.mat.get(key);
    if (m) return m;
    if (key === 'glass') m = this.mats.get('glass');
    else if (key === 'lamp') {
      m = new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: new THREE.Color(1.0, 0.62, 0.28), emissiveIntensity: 3, roughness: 0.5 });
    } else if (key.startsWith('metal')) m = this.mats.get(key, { metal: 0.55, rough: 1 });
    else if (key.startsWith('canvas')) m = this.mats.get(key, { side: THREE.DoubleSide });
    else m = this.mats.get(key);
    this.mat.set(key, m);
    return m;
  }
  create(kind) {
    let parts = this.geo.get(kind);
    if (!parts) { parts = gearGeometry(kind, this.mats.tiles); this.geo.set(kind, parts); }
    const grp = new THREE.Group();
    grp.name = 'gear:' + kind;
    // only the bulky gear casts shadows: rifles and hand tools are a few
    // centimetres thick and would cost a shadow draw per material
    const shadows = kind === 'pack' || kind === 'wood' || kind === 'sack' || kind === 'water';
    for (const [key, geo] of parts) {
      const mesh = new THREE.Mesh(geo, this.#material(key));
      mesh.castShadow = shadows && key !== 'glass' && key !== 'lamp';
      mesh.receiveShadow = true;
      grp.add(mesh);
    }
    return grp;
  }
}

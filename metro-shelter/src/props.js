// Set dressing: shacks built into the pylon bays, shelter rooms, lamps, cables, barricades and clutter.
import * as THREE from 'three';
import { instance, modelBounds, hasModel } from './assets.js';
import { M } from './materials.js';
import { bevelBox, corrugatedSheet, merged, seeded, mound } from './geom.js';
import { collision } from './collision.js';
import { hangingLamp, fireLight, pointLamp } from './lights.js';
import * as Lay from './layout.js';

const { L, BAYS, PYLON_OUT, HALL, EDGE, TRACK_X, TRACK_Y, TUN_HW, BARRICADE_Z, HALL_APEX } = Lay;

export const MODEL_IDS = [
  'barrel_stove', 'Barrel_01', 'Barrel_02', 'barrel_03', 'wooden_crate_01', 'wooden_crate_02', 'old_military_crate',
  'wooden_military_crate', 'cardboard_box_01', 'plastic_crate_01', 'metal_jerrycan', 'plastic_jerrycan', 'portable_generator',
  'vintage_radio_transceiver', 'old_bed_frame', 'metal_office_desk', 'metal_stool_01', 'worn_metal_rack', 'metal_toolbox',
  'hanging_industrial_lamp', 'caged_hanging_light', 'trashbag', 'russian_food_cans_01', 'long_life_food', 'medical_box',
  'ammo_box', 'old_gas_mask', 'service_pistol', 'street_rat', 'planter_box_01', 'planter_box_02', 'seeding_tray_01',
  'cement_bag', 'pot_enamel_01', 'can_rusted', 'propane_tank', 'old_tyre', 'concrete_road_barrier',
  'korean_fire_extinguisher_01', 'wall_clock', 'folding_wooden_stool', 'WoodenTable_03', 'plastic_monobloc_chair_01',
  'Lantern_01', 'industrial_pastic_container', 'plastic_bottle_gallon', 'metal_trash_can', 'mousetrap', 'sledgehammer_01',
  'wooden_ladder', 'modular_industrial_pipes_01', 'tool_cart', 'binder_notebook', 'cassette_player', 'rusted_wheel_rim_01',
  'vintage_flashlight', 'plastic_jerrycan',
];
export const LOD_IDS = ['street_rat', 'barrel_stove', 'portable_generator', 'vintage_radio_transceiver', 'old_bed_frame',
  'tool_cart', 'concrete_road_barrier', 'Lantern_01', 'metal_trash_can', 'korean_fire_extinguisher_01', 'old_military_crate',
  'wooden_military_crate', 'plastic_crate_01', 'cardboard_box_01', 'hanging_industrial_lamp', 'caged_hanging_light'];

export const interactables = [];   // {pos, r, kind, label(), use()}
export const roomAnchors = {};     // room id -> {pos, bay}
export const animated = [];        // {update(t,dt)}
let root;

// ---------- helpers ----------
const rnd = seeded(20250927);
const jitter = (a) => (rnd() - 0.5) * 2 * a;

function put(id, x, y, z, rotY = 0, { scale = 1, tiltX = 0, tiltZ = 0, center = false, parent } = {}) {
  const o = instance(id);
  o.name = id;
  if (center && hasModel(id)) {
    const b = modelBounds(id);
    const c = b.getCenter(new THREE.Vector3());
    const inner = new THREE.Group();
    inner.name = id;
    o.position.set(-c.x, -b.min.y, -c.z);
    inner.add(o);
    return put2(inner, x, y, z, rotY, scale, tiltX, tiltZ, parent);
  }
  return put2(o, x, y, z, rotY, scale, tiltX, tiltZ, parent);
}
function put2(o, x, y, z, rotY, scale, tiltX, tiltZ, parent) {
  if (/light|lamp|Lantern/i.test(o.name || '') ) o.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  o.position.set(x, y, z);
  o.rotation.set(tiltX, rotY, tiltZ);
  o.scale.setScalar(scale);
  (parent || root).add(o);
  return o;
}
// Place a model and add a collider from its rotated footprint.
function solid(id, x, y, z, rotY = 0, opts = {}) {
  const o = put(id, x, y, z, rotY, opts);
  o.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o);
  if (b.max.y - b.min.y > 0.25) collision.addBox(b.min.x, b.max.x, b.min.z, b.max.z, b.min.y, b.max.y);
  else collision.addFloor(b.min.x, b.max.x, b.min.z, b.max.z, b.max.y);
  return o;
}

// Geometry batches merged per material at the end (shack walls etc.).
const batches = new Map();
function batch(mat, geo, matrix) {
  geo.applyMatrix4(matrix);
  if (!batches.has(mat)) batches.set(mat, []);
  batches.get(mat).push(geo);
}
const mtx = (x, y, z, ry = 0, rx = 0, rz = 0, sx = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, 1, 1));

// ---------- painted signs ----------
function signTexture(text, { w = 512, h = 160, bg = '#6b5a43', fg = '#e9e0c9', font = 'bold 84px Georgia, serif' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // grain + grime
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,240,210'},${rnd() * 0.06})`;
    g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 40, 1 + rnd() * 2);
  }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fg; g.globalAlpha = 0.88;
  g.fillText(text, w / 2, h / 2 + 4);
  // paint wear
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.5})`; g.fillRect(rnd() * w, rnd() * h, rnd() * 14, rnd() * 5); }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const grad = g.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, 'rgba(20,14,8,.35)'); grad.addColorStop(0.4, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function sign(text, x, y, z, ry, w = 1.1, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ map: signTexture(text, opts), roughness: 0.85, metalness: 0 });
  const board = new THREE.Mesh(bevelBox(w, w * 0.3125, 0.025, 0.006), [mat]);
  // bevelBox uses one material group; give the front face the painted map via UV remap
  const uv = board.geometry.attributes.uv, pos = board.geometry.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / (w * 0.3125) + 0.5);
  board.material = mat;
  board.position.set(x, y, z); board.rotation.y = ry;
  board.castShadow = true; board.receiveShadow = true;
  root.add(board);
  return board;
}

// Station name plates on the track walls.
function nameplates() {
  const tex = signTexture('ЗАРЯ', { w: 1024, h: 256, bg: '#2a2620', fg: '#c9a466', font: 'bold 190px Georgia, serif' });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35 });
  for (const s of [1, -1]) for (const z of [-15, 3, 21]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.04), mat);
    m.position.set(s * (Lay.WALL - 0.03), 2.3, z);
    m.rotation.y = -s * Math.PI / 2;
    m.receiveShadow = true;
    root.add(m);
  }
}

// ---------- shacks ----------
// Built in bay-local space: x = distance from pylon face (0..depth), z along the platform.
function shack(side, zc, { len = 3.2, depth = 2.35, height = 2.25, door = 0.2, label, open = false, seed = 1 } = {}) {
  const r = seeded(seed);
  const base = new THREE.Matrix4().compose(new THREE.Vector3(side * (PYLON_OUT + 0.05), 0, zc),
    new THREE.Quaternion(), new THREE.Vector3(side, 1, 1));
  const B = (mat, g, m) => batch(mat, g, new THREE.Matrix4().multiplyMatrices(base, m));
  const post = (x, z, h = height) => B(M.planks, bevelBox(0.09, h, 0.09, 0.012), mtx(x, h / 2, z, jitter(0.05)));
  const hz = len / 2;
  // frame
  for (const z of [-hz, hz]) { post(0.06, z); post(depth, z); }
  B(M.planks, bevelBox(0.08, 0.1, len + 0.1, 0.012), mtx(depth, height - 0.05, 0));
  for (const z of [-hz, hz]) B(M.planks, bevelBox(depth, 0.08, 0.08, 0.012), mtx(depth / 2, height - 0.04, z));
  const dz = door * len;             // door centre offset
  const dw = 0.86;
  if (!open) {
    post(depth, dz - dw / 2 - 0.05, height); post(depth, dz + dw / 2 + 0.05, height);
    B(M.planks, bevelBox(0.08, 0.08, dw + 0.2, 0.01), mtx(depth, 1.95, dz));
    // front wall: corrugated sheets either side of the door, lapped and slightly skewed
    const spans = [[-hz, dz - dw / 2 - 0.08], [dz + dw / 2 + 0.08, hz]];
    for (const [a, b] of spans) {
      let z = a;
      while (z < b - 0.05) {
        const w = Math.min(0.78, b - z + 0.04);
        const h = height - 0.12 - r() * 0.15;
        const plank = r() < 0.3;
        if (plank) {
          for (let y = 0.08; y < h; y += 0.19) B(M.planks, bevelBox(0.022, 0.175, w, 0.004), mtx(depth + 0.05, y + 0.09, z + w / 2, jitter(0.02), jitter(0.02)));
        } else {
          const g = corrugatedSheet(w, h, 0.076, 0.018);
          B(M.corrugated, g, mtx(depth + 0.05 + r() * 0.02, h / 2 + 0.03, z + w / 2, Math.PI / 2 + jitter(0.03), 0, jitter(0.02)));
        }
        z += w - 0.05;
      }
    }
    // lintel panel above the door
    B(M.corrugated, corrugatedSheet(dw + 0.16, height - 2.0, 0.076, 0.018), mtx(depth + 0.05, (height + 1.95) / 2 + 0.02, dz, Math.PI / 2));
    // curtain
    const cg = new THREE.PlaneGeometry(dw, 1.9, 6, 12);
    cg.translate(0, -0.95, 0);
    const curtain = new THREE.Mesh(cg, r() < 0.5 ? M.cloth : M.clothGreen);
    const cpos = new THREE.Vector3(depth + 0.07, 1.93, dz).applyMatrix4(base);
    curtain.position.copy(cpos);
    curtain.rotation.y = Math.PI / 2;
    curtain.castShadow = true; curtain.receiveShadow = true;
    root.add(curtain);
    const p0 = cg.attributes.position.array.slice();
    const ph = r() * 10;
    animated.push({ update(t) {
      const p = cg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p0[i * 3 + 1], x = p0[i * 3];
        const k = -y / 1.9;   // 0 at rod, 1 at hem
        p.setZ(i, Math.sin(t * 0.9 + ph + x * 3) * 0.035 * k * k + Math.sin(t * 2.3 + y * 4 + ph) * 0.008 * k + Math.sin(x * 18) * 0.02);
      }
      p.needsUpdate = true;
      cg.computeVertexNormals();
    } });
  }
  // side walls: planks or corrugated
  for (const z of [-hz, hz]) {
    if (r() < 0.5) {
      for (let y = 0.05; y < height - 0.1; y += 0.2) B(M.planks, bevelBox(depth - 0.05, 0.18, 0.024, 0.004), mtx(depth / 2, y + 0.09, z + (z > 0 ? 0.05 : -0.05), 0, jitter(0.015), jitter(0.012)));
    } else {
      for (let x = 0.05; x < depth - 0.05; x += 0.73) {
        const w = Math.min(0.78, depth - x);
        const h = height - 0.1;
        B(M.corrugated, corrugatedSheet(w, h, 0.076, 0.018), mtx(x + w / 2, h / 2 + 0.02, z + (z > 0 ? 0.06 : -0.06), 0, 0, jitter(0.02)));
      }
    }
  }
  // roof: corrugated sheets falling toward the platform, weighed down with bricks/tyres
  for (let z = -hz - 0.1; z < hz + 0.05; z += 0.72) {
    const g = corrugatedSheet(0.78, depth + 0.35, 0.076, 0.018);
    B(M.corrugated, g, mtx(depth / 2 + 0.12, height + 0.12, z + 0.39, 0, -Math.PI / 2 + 0.08, 0));
  }
  if (label) {
    const p = new THREE.Vector3(depth + 0.1, height - 0.28, dz + (open ? 0 : 0.95)).applyMatrix4(base);
    sign(label, p.x, p.y, p.z, side * Math.PI / 2, 0.9);
  }
  // colliders (world): side walls, front wall minus door
  const X = (x) => side * (PYLON_OUT + 0.05 + x);
  const xa = Math.min(X(0), X(depth + 0.1)), xb = Math.max(X(0), X(depth + 0.1));
  collision.addBox(xa, xb, zc - hz - 0.1, zc - hz + 0.1, 0, height);
  collision.addBox(xa, xb, zc + hz - 0.1, zc + hz + 0.1, 0, height);
  if (!open) {
    const fx0 = Math.min(X(depth - 0.05), X(depth + 0.12)), fx1 = Math.max(X(depth - 0.05), X(depth + 0.12));
    collision.addBox(fx0, fx1, zc - hz, zc + dz - dw / 2, 0, height);
    collision.addBox(fx0, fx1, zc + dz + dw / 2, zc + hz, 0, height);
  }
  // local-to-world helper for interior dressing
  return { at: (x, z) => new THREE.Vector3(X(x), 0, zc + z), side, zc, depth, len, doorZ: zc + dz, frontX: X(depth + 0.4) };
}

// ---------- catenary cables ----------
const cableGeos = [];
function cable(a, b, sag = 0.25, r = 0.011) {
  const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
  const q1 = a.clone().lerp(b, 0.25); q1.y -= sag * 0.75;
  const q3 = a.clone().lerp(b, 0.75); q3.y -= sag * 0.75;
  const curve = new THREE.CatmullRomCurve3([a, q1, mid, q3, b]);
  cableGeos.push(new THREE.TubeGeometry(curve, Math.max(8, Math.round(a.distanceTo(b) * 3)), r, 5, false));
}

// ---------- mushrooms (procedural lathe, instanced) ----------
function mushrooms(points) {
  const cap = new THREE.LatheGeometry([[0, 0.052], [0.012, 0.051], [0.022, 0.046], [0.027, 0.038], [0.024, 0.034], [0.006, 0.037]].map(([x, y]) => new THREE.Vector2(x, y)), 12);
  const stem = new THREE.CylinderGeometry(0.005, 0.007, 0.042, 6); stem.translate(0, 0.018, 0);
  const g = merged([cap, stem]);
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.7 });
  const inst = new THREE.InstancedMesh(g, mat, points.length * 5);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  // each point becomes a tight cluster of 3-5 caps of different ages
  const pts = [];
  for (const p of points) { const n = 3 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) pts.push(p.clone().add(new THREE.Vector3(jitter(0.035), 0, jitter(0.035)))); }
  points = pts;
  inst.count = 0;
  points.forEach((p, i) => {
    const s = 0.5 + rnd() * 0.8;
    q.setFromEuler(new THREE.Euler(jitter(0.25), rnd() * 6, jitter(0.25)));
    inst.setMatrixAt(i, m4.compose(p, q, new THREE.Vector3(s, s * (0.8 + rnd() * 0.4), s)));
    inst.setColorAt(i, c.setHSL(0.1 + jitter(0.02), 0.12 + rnd() * 0.12, 0.7 + jitter(0.1)));
    inst.count = i + 1;
  });
  inst.castShadow = true; inst.receiveShadow = true;
  root.add(inst);
}

// ---------- loot ----------
function loot(o, kind, contents) {
  const p = new THREE.Vector3(); o.getWorldPosition(p);
  const it = { pos: p.add(new THREE.Vector3(0, 0.4, 0)), r: 1.3, kind: 'loot', contents, searched: false, name: kind,
    label() { return this.searched ? null : `<b>[E]</b> Search ${kind}`; } };
  interactables.push(it);
  return it;
}

// =====================================================================
export function dressStation(scene) {
  root = new THREE.Group(); root.name = 'props';
  scene.add(root);
  nameplates();

  // --- lighting: hanging lamps in the halls ---
  hangingLamp(root, 0, HALL_APEX - 0.05, -17, { cd: 110, priority: 3 });
  hangingLamp(root, 0, HALL_APEX - 0.05, 15, { cd: 100, priority: 3 }).flicker = true;
  for (const s of [1, -1]) {
    hangingLamp(root, s * 8.4, Lay.SIDE_APEX - 0.1, -9, { model: 'caged_hanging_light', cd: 55, priority: 2, angle: 1.2 });
    hangingLamp(root, s * 8.4, Lay.SIDE_APEX - 0.1, 9, { model: 'caged_hanging_light', cd: 55, priority: 1, angle: 1.2 });
  }

  // --- east platform (x > 0) ---
  // Generator bay (open work area)
  {
    const zc = BAYS[0], x0 = PYLON_OUT;
    const pallet = new THREE.Group();
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(bevelBox(1.2, 0.025, 0.12, 0.004), M.planks); b.position.set(0, 0.13, -0.4 + i * 0.2); b.castShadow = b.receiveShadow = true; pallet.add(b); }
    for (const z of [-0.4, 0, 0.4]) { const b = new THREE.Mesh(bevelBox(1.2, 0.1, 0.1, 0.01), M.planks); b.position.set(0, 0.06, z); b.castShadow = b.receiveShadow = true; pallet.add(b); }
    pallet.position.set(x0 + 1.2, 0, zc + 0.3); pallet.rotation.y = 0.05; root.add(pallet);
    solid('portable_generator', x0 + 1.2, 0.145, zc + 0.3, Math.PI / 2 + 0.08);
    collision.addBox(x0 + 0.55, x0 + 1.85, zc - 0.3, zc + 0.9, 0, 0.75);
    solid('metal_jerrycan', x0 + 0.35, 0, zc - 1.1, 0.3);
    solid('metal_jerrycan', x0 + 0.62, 0, zc - 1.2, -0.2);
    put('metal_jerrycan', x0 + 2.3, 0, zc + 1.4, 1.4, { tiltZ: Math.PI / 2 - 0.05 }).position.y = 0.09;
    solid('propane_tank', x0 + 0.3, 0, zc + 1.45, 0);
    solid('Barrel_02', x0 + 0.4, 0, zc - 1.6 + 0.1, 0.5);
    put('korean_fire_extinguisher_01', x0 + 0.2, 0, zc + 0.9, -Math.PI / 2);
    put('sledgehammer_01', x0 + 0.05, 0.75, zc + 1.7, 0, { tiltZ: -0.28 });
    // cables up the pylon and across the vault to the lamps
    const from = new THREE.Vector3(x0 + 0.8, 0.45, zc + 0.3);
    cable(from, new THREE.Vector3(x0 + 0.02, 0.1, zc + 0.6), 0.1, 0.014);
    cable(new THREE.Vector3(x0 + 0.02, 0.1, zc + 0.6), new THREE.Vector3(x0 + 0.02, 3.3, zc + 0.8), 0.02, 0.014);
    cable(new THREE.Vector3(x0 + 0.02, 0.1, zc + 0.7), new THREE.Vector3(x0 + 0.02, 3.3, zc + 0.95), 0.03, 0.01);
    roomAnchors.generator = { pos: new THREE.Vector3(x0 + 1.4, 1.0, zc), side: 1, zc };
    pointLamp(root, x0 + 1.9, 2.4, zc - 0.8, { cd: 8, range: 5, priority: 0 });
    put('caged_hanging_light', x0 + 1.9, 3.1, zc - 0.8, 0, { scale: 0.7 });
    sign('ГЕНЕРАТОР', x0 + 0.04, 2.35, zc, Math.PI / 2, 1.2);
  }
  // Workshop
  {
    const zc = BAYS[1], x0 = PYLON_OUT;
    const s = shack(1, zc, { door: 0.18, label: 'МАСТЕРСКАЯ', seed: 11, open: true });
    solid('metal_office_desk', x0 + 0.62, 0, zc - 0.4, Math.PI / 2);
    put('metal_toolbox', x0 + 0.55, 0.79, zc - 0.9, Math.PI / 2 + 0.2);
    put('ammo_box', x0 + 0.6, 0.79, zc - 0.1, 0.4);
    put('ammo_box', x0 + 0.72, 0.79, zc + 0.05, 0.1);
    put('vintage_flashlight', x0 + 0.75, 0.79, zc - 0.45, 1.1);
    solid('tool_cart', x0 + 1.9, 0, zc + 0.95, 0.4);
    solid('worn_metal_rack', x0 + 0.35, 0, zc + 1.15, Math.PI / 2);
    put('plastic_jerrycan', x0 + 1.5, 0, zc - 1.2, 0.8);
    solid('metal_stool_01', x0 + 1.35, 0, zc - 0.3, 0.3);
    roomAnchors.workshop = { pos: s.at(1.4, 0).setY(1.0), side: 1, zc };
    pointLamp(root, x0 + 1.2, 2.0, zc, { cd: 7, range: 4.5 });
    put('caged_hanging_light', x0 + 1.2, 2.55, zc, Math.PI / 2, { scale: 0.6 });
  }
  // Dwellings, water, storage
  dwelling(1, BAYS[2], 21, 'Anya & Lev');
  dwelling(1, BAYS[3], 22, 'Boris');
  {
    const zc = BAYS[4], x0 = PYLON_OUT;
    // Water purification: settling barrels, a filter column and piping to a tap
    solid('barrel_03', x0 + 0.45, 0, zc - 1.2, 0.3);
    solid('barrel_03', x0 + 0.45, 0, zc - 0.5, 1.2);
    solid('Barrel_01', x0 + 1.15, 0, zc - 1.25, 2.0);
    put('modular_industrial_pipes_01', x0 + 0.2, 1.0, zc + 0.2, Math.PI / 2);
    solid('industrial_pastic_container', x0 + 0.4, 0, zc + 0.9, Math.PI / 2);
    put('industrial_pastic_container', x0 + 0.4, 0.42, zc + 0.9, Math.PI / 2 + 0.05);
    for (let i = 0; i < 6; i++) put('plastic_bottle_gallon', x0 + 1.4 + (i % 3) * 0.2, 0, zc + 0.5 + Math.floor(i / 3) * 0.2, rnd() * 6);
    put('plastic_jerrycan', x0 + 1.9, 0, zc - 0.7, 0.4);
    put('pot_enamel_01', x0 + 1.25, 0.88, zc - 1.25, 0.3);
    roomAnchors.water = { pos: new THREE.Vector3(x0 + 1.3, 1.0, zc), side: 1, zc };
    sign('ВОДА', x0 + 0.04, 2.3, zc, Math.PI / 2, 0.8);
    pointLamp(root, x0 + 1.6, 2.4, zc, { cd: 7, range: 5 });
    put('caged_hanging_light', x0 + 1.6, 3.0, zc, 0, { scale: 0.65 });
    // leak puddle under the pipes
    puddle(x0 + 0.7, zc + 0.1, 0.9);
  }
  dwelling(1, BAYS[5], 23, 'Olga');
  {
    const zc = BAYS[6], x0 = PYLON_OUT;
    // Storage: stacked crates, some of them lootable
    const c1 = solid('wooden_military_crate', x0 + 0.4, 0, zc - 1.0, Math.PI / 2);
    put('wooden_military_crate', x0 + 0.4, 0.46, zc - 1.0, Math.PI / 2 + 0.06);
    solid('wooden_crate_02', x0 + 0.45, 0, zc + 0.2, 0.02);
    put('wooden_crate_01', x0 + 0.45, 0.45, zc + 0.1, Math.PI / 2 + 0.1);
    const c2 = solid('old_military_crate', x0 + 1.5, 0, zc + 0.9, 0.1);
    solid('cardboard_box_01', x0 + 1.4, 0, zc - 0.8, 0.5);
    put('cardboard_box_01', x0 + 1.42, 0.34, zc - 0.8, 0.9);
    for (let i = 0; i < 4; i++) put('cement_bag', x0 + 0.35 + (i % 2) * 0.5, 0.18 * Math.floor(i / 2), zc + 1.25, Math.PI / 2 + jitter(0.1));
    loot(c1, 'military crate', { mgr: 12, rounds: 16 });
    loot(c2, 'old crate', { scrap: 6, medkits: 1 });
    sign('СКЛАД', x0 + 0.04, 2.3, zc, Math.PI / 2, 0.8);
  }
  dwelling(1, BAYS[7], 24, 'Pavel');

  // --- west platform (x < 0) ---
  // Mushroom farm across two bays
  for (const k of [0, 1]) {
    const zc = BAYS[k], x0 = -PYLON_OUT;
    const pts = [];
    for (const dz of [-1.0, 0.25]) {
      solid('worn_metal_rack', x0 - 0.35, 0, zc + dz, Math.PI / 2);
      for (const y of [0.05, 0.62, 1.2]) {
        put('planter_box_01', x0 - 0.35, y + 0.03, zc + dz, Math.PI / 2, { scale: 0.95 });
        for (let i = 0; i < 9; i++) pts.push(new THREE.Vector3(x0 - 0.35 + jitter(0.15), y + 0.38, zc + dz + jitter(0.38)));
      }
    }
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Vector3(x0 - 1.5 + (i % 2) * 0.6, 0, zc - 0.7 + Math.floor(i / 2) * 1.0);
      put('planter_box_02', p.x, 0, p.z, rnd() * 0.1 + Math.PI / 2);
      collision.addBox(p.x - 0.25, p.x + 0.25, p.z - 0.65, p.z + 0.65, 0, 0.45);
      for (let j = 0; j < 14; j++) pts.push(new THREE.Vector3(p.x + jitter(0.18), 0.4, p.z + jitter(0.55)));
    }
    mushrooms(pts);
    if (k === 0) {
      put('seeding_tray_01', x0 - 2.3, 0, zc + 1.3, 0.2);
      put('seeding_tray_01', x0 - 2.5, 0, zc + 1.1, 1.1);
      put('plastic_crate_01', x0 - 2.4, 0, zc - 1.4, 0.3);
      sign('ФЕРМА', x0 - 0.04, 2.3, zc - 0.3, -Math.PI / 2, 0.8);
    }
    if (k === 1) pointLamp(root, x0 - 1.3, 2.3, zc - 3.0, { cd: 14, range: 6, color: 0xffd6b0 });
    put('caged_hanging_light', x0 - 1.3, 2.9, zc - 0.2, Math.PI / 2, { scale: 0.65 });
  }
  roomAnchors.farm = { pos: new THREE.Vector3(-PYLON_OUT - 1.3, 1.0, (BAYS[0] + BAYS[1]) / 2), side: -1, zc: BAYS[0] };
  dwelling(-1, BAYS[2], 31, 'Dasha');
  {
    // Infirmary
    const zc = BAYS[3], x0 = -PYLON_OUT;
    const s = shack(-1, zc, { door: 0.25, label: 'ЛАЗАРЕТ', seed: 41, open: true });
    solid('old_bed_frame', x0 - 0.55, 0, zc - 0.55, 0);
    put('medical_box', x0 - 1.45, 0.88, zc + 1.0, 0.2);
    solid('metal_stool_01', x0 - 1.45, 0, zc + 1.0, 0.2);
    put('plastic_bottle_gallon', x0 - 1.3, 0, zc - 1.3, 0.5);
    const mb = put('medical_box', x0 - 0.3, 0, zc + 1.2, 1.2);
    loot(mb, 'medical box', { medkits: 1 });
    roomAnchors.infirmary = { pos: s.at(1.3, 0).setY(1.0), side: -1, zc };
    pointLamp(root, x0 - 1.2, 2.0, zc, { cd: 6, range: 4.5, color: 0xfff0dc });
    put('caged_hanging_light', x0 - 1.2, 2.55, zc, 0, { scale: 0.6 });
  }
  dwelling(-1, BAYS[4], 32, 'Grisha');
  {
    // Trading post (produces military-grade rounds)
    const zc = BAYS[5], x0 = -PYLON_OUT;
    solid('WoodenTable_03', x0 - 1.7, 0, zc, Math.PI / 2);
    for (let i = 0; i < 7; i++) put('russian_food_cans_01', x0 - 1.7 + jitter(0.18), 0.83, zc - 0.45 + i * 0.13, rnd() * 6, { tiltX: Math.PI / 2 * (i % 3 === 0 ? 0 : 0) });
    put('long_life_food', x0 - 1.6, 0.83, zc + 0.35, 1.4);
    put('Lantern_01', x0 - 1.75, 0.83, zc + 0.05, 0.5);
    solid('plastic_crate_01', x0 - 0.4, 0, zc - 1.1, 0.1);
    put('plastic_crate_01', x0 - 0.4, 0.26, zc - 1.1, 0.2);
    solid('wooden_crate_01', x0 - 0.45, 0, zc + 0.9, Math.PI / 2);
    solid('plastic_monobloc_chair_01', x0 - 0.8, 0, zc + 0.1, -Math.PI / 2 + 0.3);
    put('cassette_player', x0 - 1.85, 0.83, zc - 0.25, 1.3);
    pointLamp(root, x0 - 1.75, 1.1, zc + 0.05, { cd: 3, range: 3.5, color: 0xffb266, electric: false, kind: 'lantern' });
    roomAnchors.market = { pos: new THREE.Vector3(x0 - 1.5, 1.0, zc), side: -1, zc };
    sign('РЫНОК', x0 - 0.04, 2.3, zc, -Math.PI / 2, 0.8);
  }
  dwelling(-1, BAYS[6], 33, 'Marat');
  dwelling(-1, BAYS[7], 34, 'Vera & Tolya');

  // --- central hall ---
  // Overseer's post with the radio
  {
    const z = -22.5;
    solid('metal_office_desk', -2.6, 0, z, 0.08);
    put('vintage_radio_transceiver', -2.95, 0.79, z - 0.1, 0.1);
    put('binder_notebook', -2.2, 0.79, z + 0.1, 2.5);
    put('Lantern_01', -1.85, 0.79, z - 0.25, 0);
    solid('plastic_monobloc_chair_01', -2.6, 0, z + 0.85, Math.PI + 0.2);
    put('wall_clock', -HALL + 0.01, 2.4, z, Math.PI / 2);
    put('korean_fire_extinguisher_01', -HALL + 0.25, 0, z + 1.4, Math.PI / 2);
    pointLamp(root, -1.85, 1.1, z - 0.25, { cd: 4, range: 5, color: 0xffb26b, electric: false, kind: 'lantern' });
    roomAnchors.radio = { pos: new THREE.Vector3(-2.6, 1.0, z), side: 0, zc: z };
    sign('РАДИО', -HALL + 0.03, 2.9, z + 1.2, Math.PI / 2, 0.8);
  }
  // Commons: fire barrel with seating
  {
    solid('barrel_stove', 0.2, 0, 1.5, 0.4);
    fireLight(root, 0.2, 1.15, 1.5);
    embers(new THREE.Vector3(0.2, 0.9, 1.5));
    solid('WoodenTable_03', 2.2, 0, 3.4, 0.25);
    put('pot_enamel_01', 2.0, 0.83, 3.35, 0.4);
    put('can_rusted', 2.45, 0.83, 3.5, 0);
    for (const [x, z, id] of [[-1.1, 1.0, 'folding_wooden_stool'], [1.3, 0.6, 'folding_wooden_stool'], [0.7, 2.8, 'metal_stool_01'], [-0.7, 2.4, 'plastic_monobloc_chair_01']]) {
      solid(id, x, 0, z, Math.atan2(0.2 - x, 1.5 - z));
    }
    put('old_tyre', -1.6, 0.3, 3.2, 0.4, { tiltX: 0.0 });
  }
  // Dormitory: cots down the south end of the hall, laundry lines between pylons
  {
    const cots = [[-3.3, 9, 0], [-3.3, 12.8, 0.03], [3.3, 11.2, 0.02], [3.3, 17.4, -0.03], [-3.3, 19.2, 0.01], [3.3, 22.8, 0], [-3.3, 22.6, 0.05]];
    for (const [x, z, r] of cots) {
      solid('old_bed_frame', x, 0, z, r);
      if (rnd() < 0.6) put(rnd() < 0.5 ? 'cardboard_box_01' : 'wooden_crate_01', x + (x > 0 ? -0.75 : 0.75), 0, z - 0.9 + jitter(0.1), rnd());
    }
    laundry(new THREE.Vector3(-HALL + 0.05, 2.2, 10.5), new THREE.Vector3(HALL - 0.05, 2.3, 11.5));
    laundry(new THREE.Vector3(-HALL + 0.05, 2.25, 20.5), new THREE.Vector3(HALL - 0.05, 2.15, 21.2));
    put('trashbag', 3.7, 0, 25.9, 0.5); put('trashbag', 3.3, 0, 26.3, 2.1);
    put('metal_trash_can', -3.5, 0, 26.2, 0.1);
  }
  // Clutter along the hall and platforms
  scatter();

  // --- tunnel barricades ---
  for (const s of [1, -1]) for (const zs of [1, -1]) barricade(s, zs);

  // --- steps down to the tracks at both ends of both platforms ---
  for (const s of [1, -1]) for (const zs of [1, -1]) steps(s, zs * 25.6);

  // cables across the halls
  for (const z of [-17, 15]) cable(new THREE.Vector3(HALL, 3.55, z - 3), new THREE.Vector3(0, HALL_APEX - 0.05, z), 0.35);
  for (const s of [1, -1]) {
    cable(new THREE.Vector3(s * 6.25, 3.3, -20.2), new THREE.Vector3(s * 8.4, Lay.SIDE_APEX - 0.1, -9), 0.5);
    cable(new THREE.Vector3(s * 8.4, Lay.SIDE_APEX - 0.1, -9), new THREE.Vector3(s * 8.4, Lay.SIDE_APEX - 0.1, 9), 0.9);
    cable(new THREE.Vector3(s * 8.4, Lay.SIDE_APEX - 0.1, 9), new THREE.Vector3(s * 6.25, 3.3, 20), 0.6);
  }
  const cm = new THREE.Mesh(merged(cableGeos), M.cable); cm.castShadow = true; root.add(cm);

  // merge batched shack geometry
  for (const [mat, geos] of batches) {
    const m = new THREE.Mesh(merged(geos), mat);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }
  M.corrugated.side = THREE.DoubleSide;
  M.corrugated.shadowSide = THREE.DoubleSide;
  root.updateMatrixWorld(true);
}

function dwelling(side, zc, seed, owner) {
  const s = shack(side, zc, { door: side > 0 ? 0.22 : -0.22, seed });
  const bedZ = side > 0 ? -0.55 : 0.55;
  const bed = put('old_bed_frame', s.at(0.55, bedZ).x, 0, zc + bedZ, 0);
  bed.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(bed);
  collision.addBox(b.min.x, b.max.x, b.min.z, b.max.z, 0, 0.6);
  const cz = side > 0 ? 1.15 : -1.15;
  const crate = put(rnd() < 0.5 ? 'wooden_crate_01' : 'plastic_crate_01', s.at(1.6, cz).x, 0, zc + cz, rnd() * 0.4 + Math.PI / 2);
  const lx = s.at(1.5, cz).x, lz = zc + cz - 0.05;
  if (rnd() < 0.6) { put('Lantern_01', lx, 0.34, lz, rnd()); glow(lx, 0.47, lz); } else put('can_rusted', lx, 0.34, lz, rnd());
  if (rnd() < 0.6) put('folding_wooden_stool', s.at(1.3, cz * 0.5).x, 0, zc + cz * 0.5, rnd());
  if (rnd() < 0.5) put('cassette_player', s.at(1.7, cz).x, 0.34, zc + cz + 0.12, rnd());
  if (rnd() < 0.5) put('trashbag', s.at(2.0, -cz * 0.9).x, 0, zc - cz * 0.9, rnd() * 6, { scale: 0.8 });
  put('old_gas_mask', s.at(0.08, cz * 0.6).x, 1.7, zc + cz * 0.6, side > 0 ? Math.PI / 2 : -Math.PI / 2);
  const it = loot(crate, 'belongings', { mgr: 2 + Math.floor(rnd() * 4), rounds: rnd() < 0.5 ? 6 : 0, scrap: 1 });
  it.pos.set(s.frontX - side * 1.0, 0.8, zc);
  it.r = 1.6;
  roomAnchors['quarters_' + (side > 0 ? 'e' : 'w') + zc] = { pos: s.at(1.2, 0).setY(1.0), side, zc, owner, kind: 'quarters' };
}

function steps(side, z) {
  // Timber stair from the platform edge down to the trackbed.
  const n = 3, rise = -TRACK_Y / n, run = 0.32, w = 1.1;
  const add = (g, x, y) => { const m = new THREE.Mesh(g, M.planks); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; root.add(m); return m; };
  for (let i = 0; i < n - 1; i++) {
    const topY = -rise * (i + 1);
    const xa = EDGE + 0.02 + run * i;
    add(bevelBox(run + 0.03, 0.05, w, 0.008), side * (xa + run / 2), topY - 0.025);
    add(bevelBox(0.05, rise, w, 0.008), side * (xa + 0.03), topY - rise / 2);
    collision.addFloor(Math.min(side * xa, side * (xa + run)), Math.max(side * xa, side * (xa + run)), z - w / 2, z + w / 2, topY);
  }
  // Stringers
  for (const dz of [-w / 2 - 0.03, w / 2 + 0.03]) {
    const len = Math.hypot(run * n, -TRACK_Y) + 0.1;
    const st = new THREE.Mesh(bevelBox(len, 0.2, 0.05, 0.01), M.planks);
    st.position.set(side * (EDGE + run * n / 2), TRACK_Y / 2 - 0.08, z + dz);
    st.rotation.z = -side * Math.atan2(-TRACK_Y, run * n);
    st.castShadow = st.receiveShadow = true;
    root.add(st);
  }
}

function barricade(side, zs) {
  const z = zs * BARRICADE_Z;
  const x = side * TRACK_X;
  const y = TRACK_Y;
  const face = zs > 0 ? Math.PI : 0;
  solid('concrete_road_barrier', x - 0.85, y, z, face + 0.05);
  solid('concrete_road_barrier', x + 0.95, y, z + 0.1 * zs, face - 0.08);
  for (let i = 0; i < 6; i++) {
    put('cement_bag', x - 1.45 + (i % 3) * 0.48, y + 0.82 + Math.floor(i / 3) * 0.17, z + jitter(0.05), jitter(0.2));
  }
  for (let i = 0; i < 3; i++) put('cement_bag', x + 0.6 + i * 0.47, y + 0.82, z + 0.1 * zs + jitter(0.05), jitter(0.2));
  // a gap under the planks where the rats squeeze through (left open deliberately in the collision)
  collision.addBox(x - TUN_HW, x + TUN_HW, z - 0.4, z + 0.4, y, y + 2.5);
  // guard post on the station side
  const gz = z - zs * 2.2;
  put('folding_wooden_stool', x + 0.9, y, gz, rnd());
  put('Lantern_01', x + 1.3, y, gz - zs * 0.2, 0.3);
  put('rusted_wheel_rim_01', x - 1.5, y + 0.2, gz + zs * 0.8, 0.2, { tiltX: 0.1 });
  // red emergency lamp on the tunnel wall
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a10, emissiveIntensity: 5 }));
  lamp.position.set(x + side * (TUN_HW - 0.1), 1.3, z - zs * 0.6);
  root.add(lamp);
  pointLamp(root, lamp.position.x - side * 0.2, 1.3, lamp.position.z, { cd: 4, range: 9, color: 0xff3a1a, electric: false, kind: 'emergency' });
  // debris beyond the barricade
  const d = new THREE.Mesh(mound(1.4, 0.35, 5 + side + zs * 3), M.debris);
  d.position.set(x + jitter(0.4), y, z + zs * 6);
  d.receiveShadow = true;
  root.add(d);
  put('old_tyre', x + 0.8, y + 0.08, z + zs * 3.5, rnd(), { tiltX: Math.PI / 2 });
  put('Barrel_02', x - 1.1, y, z + zs * 9, rnd(), { tiltZ: Math.PI / 2 - 0.1 }).position.y = y + 0.24;
}

function laundry(a, b) {
  cable(a, b, 0.18, 0.004);
  const n = 4;
  for (let i = 1; i <= n; i++) {
    if (rnd() < 0.2) continue;
    const t = i / (n + 1);
    const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.18;
    const w = 0.5 + rnd() * 0.5, h = 0.6 + rnd() * 0.5;
    const g = new THREE.PlaneGeometry(w, h, 10, 8); g.translate(0, -h / 2, 0);
    const gp = g.attributes.position;
    for (let k = 0; k < gp.count; k++) {
      const x = gp.getX(k), y = gp.getY(k);
      gp.setZ(k, Math.sin(x * 14 + i) * 0.018 + Math.sin(y * 5 + x * 3) * 0.012 * (-y / h));
      gp.setY(k, y - Math.abs(x) * 0.04 * (1 + y / h));   // sags between pegs
    }
    g.computeVertexNormals();
    const mat = [M.clothGrey, M.clothBlue, M.cloth, M.clothGreen][Math.floor(rnd() * 4)];
    const m = new THREE.Mesh(g, mat);
    m.position.copy(p);
    m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2;
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    const ph = rnd() * 10;
    animated.push({ update(t2) { m.rotation.x = Math.sin(t2 * 0.7 + ph) * 0.05; } });
  }
}

function puddle(x, z, r) {
  const g = new THREE.CircleGeometry(r, 24);
  const p = g.attributes.position;
  for (let i = 1; i < p.count; i++) { const k = 0.7 + 0.3 * Math.sin(i * 1.7) * Math.sin(i * 0.63); p.setX(i, p.getX(i) * k); p.setY(i, p.getY(i) * k); }
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z);
  m.receiveShadow = true;
  root.add(m);
}

function scatter() {
  const spots = [];
  // along the pylon faces in the central hall and bottom of the track walls
  for (let i = 0; i < 26; i++) {
    const s = rnd() < 0.5 ? 1 : -1;
    const z = -24 + rnd() * 48;
    const nearOpening = Lay.OPENINGS.some((o) => Math.abs(o - z) < 1.5);
    if (nearOpening) continue;
    spots.push([s * (HALL - 0.25 - rnd() * 0.2), 0, z]);
  }
  const ids = ['can_rusted', 'plastic_bottle_gallon', 'trashbag', 'cardboard_box_01', 'plastic_crate_01', 'can_rusted', 'russian_food_cans_01'];
  for (const [x, y, z] of spots) {
    const id = ids[Math.floor(rnd() * ids.length)];
    const fallen = id === 'can_rusted' && rnd() < 0.5;
    const o = put(id, x, y, z, rnd() * 6, { tiltZ: fallen ? Math.PI / 2 : 0 });
    if (fallen) o.position.y = 0.06;
  }
  // track-level junk
  for (let i = 0; i < 18; i++) {
    const s = rnd() < 0.5 ? 1 : -1;
    const z = -60 + rnd() * 120;
    if (Math.abs(Math.abs(z) - BARRICADE_Z) < 1.5) continue;
    const x = s * (TRACK_X + (rnd() < 0.5 ? -1.2 : 1.05) + jitter(0.1));
    const id = ['can_rusted', 'trashbag', 'rusted_wheel_rim_01', 'plastic_bottle_gallon', 'cement_bag'][Math.floor(rnd() * 5)];
    put(id, x, TRACK_Y, z, rnd() * 6, { tiltZ: id === 'rusted_wheel_rim_01' ? Math.PI / 2 : 0 }).position.y = TRACK_Y + (id === 'rusted_wheel_rim_01' ? 0.07 : 0);
  }
  // mousetraps: someone's losing battle
  for (const [x, z] of [[7.4, -6.2], [-7.2, 5.7], [3.9, 7.3], [-3.95, -11.8]]) put('mousetrap', x, 0, z, rnd() * 6);
  // ladder leaning in a passage, spare barrels
  put('wooden_ladder', HALL - 0.35, 0, -5.4, Math.PI / 2, { tiltX: -0.12 });
  solid('Barrel_01', -HALL + 0.4, 0, -7.6, 1.2);
  solid('Barrel_02', -HALL + 0.45, 0, -8.3, 0.2);
  const lootBarrel = solid('barrel_03', HALL - 0.4, 0, 5.4, 0.7);
  loot(lootBarrel, 'barrel', { scrap: 4, rounds: 8 });
  const tb = put('metal_toolbox', 7.3, 0, 26.2, 0.3);
  loot(tb, 'toolbox', { scrap: 5 });
  const am = put('ammo_box', -12.6, TRACK_Y, 41.8, 1.2);
  loot(am, 'ammo box', { rounds: 12, mgr: 5 });
  const ft = put('wooden_crate_01', 12.9, TRACK_Y, -40.5, 0.3);
  loot(ft, 'abandoned crate', { mgr: 8, medkits: 1 });
  collision.addBox(12.5, 13.3, -40.8, -40.2, TRACK_Y, TRACK_Y + 0.35);
}

function embers(pos) {
  const n = 40;
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), life = new Float32Array(n);
  for (let i = 0; i < n; i++) life[i] = rnd();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffa050, size: 0.025, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  root.add(pts);
  const seedOff = Array.from({ length: n }, () => [jitter(0.18), jitter(0.18), 0.5 + rnd()]);
  animated.push({ update(t, dt) {
    for (let i = 0; i < n; i++) {
      life[i] += dt * 0.45 * seedOff[i][2];
      if (life[i] > 1) life[i] -= 1;
      const l = life[i];
      p[i * 3] = pos.x + seedOff[i][0] * (1 + l) + Math.sin(t * 3 + i) * 0.03 * l;
      p[i * 3 + 1] = pos.y + l * 1.6;
      p[i * 3 + 2] = pos.z + seedOff[i][1] * (1 + l) + Math.cos(t * 2.3 + i) * 0.03 * l;
    }
    g.attributes.position.needsUpdate = true;
  } });
}

// Emissive kerosene flame inside a lantern (no dynamic light: keeps the light count down).
const glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff9a40, emissiveIntensity: 4 });
function glow(x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), glowMat);
  m.scale.y = 1.8; m.position.set(x, y, z); root.add(m);
}

export function animateProps(t, dt) { for (const a of animated) a.update(t, dt); }

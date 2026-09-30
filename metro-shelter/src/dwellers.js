// Visible dwellers: rigged characters (Quaternius Universal Base Characters, CC0) driven by the
// Universal Animation Library clips (CC0, same skeleton). Each dweller walks a route through the
// station graph to its assigned room, works there, and takes breaks by the fire at night.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { OPENINGS, BAYS, HALL } from './layout.js';
import { collision } from './collision.js';
import { outfit } from './outfits.js';

let manifest = null;
const templates = { male: [], female: [] };   // assembled, un-animated character rigs
let clips = {};         // role -> AnimationClip
let altTex = {};        // outfit material name -> alternate colourway texture

// Load every part once, then assemble a small set of templates (sex x outfit x hair) that dwellers clone.
export async function loadDwellerAssets(gltfLoader, ktx2Loader) {
  try {
    manifest = await (await fetch('assets/characters/manifest.json')).json();
  } catch { return false; }
  const base = 'assets/characters/';
  const load = (f) => gltfLoader.loadAsync(base + f);
  const animG = await load(manifest.anims);
  const byName = Object.fromEntries(animG.animations.map((c) => [c.name, c]));
  for (const [role, name] of Object.entries(manifest.clips)) if (byName[name]) clips[role] = byName[name];
  for (const [mat, file] of Object.entries(manifest.altTextures || {})) {
    try {
      const t = await ktx2Loader.loadAsync(base + file);
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
      altTex[mat] = t;
    } catch { /* optional */ }
  }
  const beard = await load(manifest.hair.beard);
  for (const sex of ['male', 'female']) {
    const head = await load(manifest.heads[sex]);
    const hairs = await Promise.all(manifest.hair[sex].map(load));
    const outfits = await Promise.all(manifest.outfits[sex].map(load));
    outfits.forEach((o, oi) => {
      hairs.forEach((h, hi) => {
        const withBeard = sex === 'male' && (oi + hi) % 2 === 0;
        templates[sex].push({ root: assemble(o.scene, [head.scene, h.scene, ...(withBeard ? [beard.scene] : [])]), outfit: oi, hair: hi, beard: withBeard });
      });
    });
  }
  return templates.male.length + templates.female.length > 0;
}

// Graft skinned parts (head, hair) onto the outfit's skeleton by bone name.
function assemble(outfitScene, parts) {
  const root = SkeletonUtils.clone(outfitScene);
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  let meshParent = null;
  root.traverse((o) => { if (o.isSkinnedMesh && !meshParent) meshParent = o.parent; });
  for (const part of parts) {
    const src = SkeletonUtils.clone(part);
    src.updateMatrixWorld(true);
    const meshes = [];
    src.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      if (m.isSkinnedMesh) {
        const nb = m.skeleton.bones.map((b) => bones[b.name]);
        if (nb.some((b) => !b)) continue;
        const bindMatrix = m.bindMatrix.clone();
        m.removeFromParent();
        meshParent.add(m);
        m.bind(new THREE.Skeleton(nb, m.skeleton.boneInverses.map((x) => x.clone())), bindMatrix);
      } else {
        // rigid part parented to a named bone in its own file
        const host = bones[m.parent?.name];
        if (!host) continue;
        const local = m.matrix.clone();
        m.removeFromParent(); host.add(m);
        local.decompose(m.position, m.quaternion, m.scale);
      }
    }
  }
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  return root;
}

// ---------- station walking graph ----------
// Nodes: hall centreline points, pylon-passage mouths on both faces, platform walkway points,
// and per-room work spots. Edges are straight segments that avoid pylons and shacks.
const nodes = [];
const edges = new Map();
function node(x, z) { const id = nodes.length; nodes.push(new THREE.Vector3(x, 0, z)); edges.set(id, []); return id; }
function link(a, b) { edges.get(a).push(b); edges.get(b).push(a); }

let built = false;
const hallNode = {}, walkNode = {};
function buildGraph() {
  if (built) return; built = true;
  for (const z of OPENINGS) {
    hallNode[z] = node(0, z);
    for (const s of [1, -1]) {
      const inner = node(s * (HALL - 0.6), z), outer = node(s * 6.9, z), walk = node(s * 9.2, z);
      walkNode[`${s}:${z}`] = walk;
      link(hallNode[z], inner); link(inner, outer); link(outer, walk);
    }
  }
  for (let i = 0; i < OPENINGS.length - 1; i++) {
    link(hallNode[OPENINGS[i]], hallNode[OPENINGS[i + 1]]);
    for (const s of [1, -1]) link(walkNode[`${s}:${OPENINGS[i]}`], walkNode[`${s}:${OPENINGS[i + 1]}`]);
  }
}

// Add a destination spot, connected to the nearest passage/walkway/hall node on the same side.
export function addSpot(pos) {
  buildGraph();
  const id = node(pos.x, pos.z);
  let best = -1, bd = 1e9;
  for (let i = 0; i < id; i++) {
    const n = nodes[i];
    if (Math.sign(n.x) !== Math.sign(pos.x) && Math.abs(pos.x) > 1 && Math.abs(n.x) > 0.5) continue;
    if (Math.abs(pos.x) > 6 && Math.abs(n.x) < 6) continue;           // platform spots join the walkway
    if (Math.abs(pos.x) < 4.5 && Math.abs(n.x) > 4.5) continue;        // hall spots join the hall
    const d = n.distanceTo(new THREE.Vector3(pos.x, 0, pos.z));
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) link(id, best);
  return id;
}

function path(from, to) {
  // Dijkstra on a ~60 node graph is trivially cheap.
  const dist = new Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(-1), done = new Set();
  dist[from] = 0;
  while (true) {
    let u = -1, du = Infinity;
    for (let i = 0; i < nodes.length; i++) if (!done.has(i) && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0 || u === to) break;
    done.add(u);
    for (const v of edges.get(u)) {
      const d = du + nodes[u].distanceTo(nodes[v]);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  const out = [];
  for (let v = to; v >= 0; v = prev[v]) out.unshift(v);
  return out[0] === from ? out : [to];
}

function nearestNode(p) {
  let best = 0, bd = 1e9;
  nodes.forEach((n, i) => { const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---------- dweller actors ----------
const WALK_SPEED = 1.25;   // m/s, unhurried adult walk
const RUN_SPEED = 3.2;

export class DwellerActors {
  constructor(scene, shelter) {
    this.scene = scene;
    this.shelter = shelter;
    this.actors = new Map();   // dweller id -> actor
    this.spots = {};           // room id -> [spot node ids]
    this.fireSpots = [];
  }

  // room anchor positions come from props.js; work spots are placed in front of the room's equipment
  init(roomAnchors, fireSeats) {
    buildGraph();
    for (const [id, a] of Object.entries(roomAnchors)) {
      if (!a?.pos || id.startsWith('quarters')) continue;
      if (id === 'farm') {
        // kneel in the aisle beside the planter rows of both farm bays
        this.spots.farm = [[-8.55, BAYS[0] - 0.5], [-8.55, BAYS[0] + 0.4], [-8.55, BAYS[1] - 0.4]].map(([x, z]) =>
          ({ node: addSpot(new THREE.Vector3(x, 0, z)), face: Math.PI / 2, taken: null }));
        continue;
      }
      if (id === 'radio') {
        this.spots.radio = [{ node: addSpot(new THREE.Vector3(a.pos.x, 0, a.pos.z + 0.78)), face: Math.PI, taken: null, sit: true },
          { node: addSpot(new THREE.Vector3(a.pos.x + 1.3, 0, a.pos.z + 0.9)), face: -2.4, taken: null }];
        continue;
      }
      // stand clear of the equipment, on the walkway side of the bay, facing into it
      const base = a.pos.clone().setY(0).add(new THREE.Vector3((a.side || 0) * (SPOT_PUSH[id] ?? 0.6), 0, 0));
      const list = [];
      for (let k = 0; k < 3; k++) {
        const p = base.clone().add(new THREE.Vector3((k % 2) * 0.5 * (a.side || 1), 0, (k - 1) * 0.8));
        list.push({ node: addSpot(p), face: a.side ? (a.side > 0 ? -Math.PI / 2 : Math.PI / 2) : 0, taken: null });
      }
      this.spots[id] = list;
    }
    for (const s of fireSeats) this.fireSpots.push({ node: addSpot(s.pos), face: s.face, taken: null, sit: true });
  }

  spawn(d) {
    const sex = FEMALE.has(d.name) ? 'female' : 'male';
    const list = templates[sex];
    if (!list.length) return null;
    const tpl = list[(d.id * 7 + 3) % list.length];
    const root = SkeletonUtils.clone(tpl.root);
    outfit(root, d, altTex);
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const [role, clip] of Object.entries(clips)) actions[role] = mixer.clipAction(clip);
    const g = new THREE.Group();
    g.add(root);
    // height variety within normal adult range (base mesh is ~1.78 m)
    const s = (sex === 'female' ? 0.95 : 1.0) * (0.95 + ((d.id * 37) % 9) / 100);
    root.scale.setScalar(s);
    const start = nodes[this.anyHallNode(d.id)];
    g.position.copy(start);
    this.scene.add(g);
    const a = { d, g, root, mixer, actions, cur: null, route: [], spot: null, state: 'idle', timer: 1 + Math.random() * 3,
      speed: 0, yaw: 0, phase: Math.random() * 10 };
    this.play(a, 'idle', 0);
    this.actors.set(d.id, a);
    return a;
  }

  anyHallNode(i) { const z = OPENINGS[i % OPENINGS.length]; return hallNode[z]; }

  play(a, role, fade = 0.35) {
    const act = a.actions[role] || a.actions.idle;
    if (!act || a.cur === act) return;
    act.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (role === 'walk' || role === 'run') act.time = Math.random() * act.getClip().duration;
    if (a.cur) a.cur.fadeOut(fade);
    a.cur = act; a.role = role;
  }

  release(a) { if (a.spot) { a.spot.taken = null; a.spot = null; } }

  goTo(a, spot, run = false) {
    this.release(a);
    spot.taken = a; a.spot = spot;
    a.route = path(nearestNode(a.g.position), spot.node).map((i) => nodes[i]);
    a.run = run;
    a.state = 'walk';
  }

  pickSpot(list) { return list?.find((s) => !s.taken) || null; }

  update(dt, t, danger, playerPos) {
    this.playerPos = playerPos;
    const sh = this.shelter;
    // keep actors in sync with the sim's dweller list
    for (const d of sh.dwellers) {
      if (d.hp > 0 && !this.actors.has(d.id)) this.spawn(d);
    }
    const hour = ((sh.time / 240) % 1) * 24;
    const breakTime = hour >= 21 || hour < 6;
    for (const a of this.actors.values()) {
      const d = a.d;
      if (d.hp <= 0) {
        if (a.state !== 'dead') { this.release(a); a.state = 'dead'; this.play(a, 'death', 0.2); if (a.cur) { a.cur.setLoop(THREE.LoopOnce, 1); a.cur.clampWhenFinished = true; } }
        a.mixer.update(dt);
        continue;
      }
      // decide what this dweller should be doing
      const wantRoom = breakTime && Math.sin(d.id * 1.7 + Math.floor(sh.time / 60)) > -0.2 ? 'fire' : d.room;
      const spots = wantRoom === 'fire' ? this.fireSpots : this.spots[wantRoom];
      const inRightPlace = a.spot && spots?.includes(a.spot);
      if (!inRightPlace && a.state !== 'walk') {
        const s = spots ? this.pickSpot(spots) : null;
        if (s) this.goTo(a, s, !!danger);
        else if (!wantRoom && a.state !== 'wander') { this.release(a); a.state = 'wander'; a.timer = 0; }
      }
      if (a.state === 'walk') this.walk(a, dt);
      else if (a.state === 'wander') {
        a.timer -= dt;
        if (a.timer <= 0) {
          const n = hallNode[OPENINGS[Math.floor(Math.random() * OPENINGS.length)]];
          a.route = path(nearestNode(a.g.position), n).map((i) => nodes[i]); a.timer = 12 + Math.random() * 10;
        }
        if (a.route.length) this.walk(a, dt, true); else this.play(a, 'idle');
      } else if (a.state === 'work') {
        a.yaw = lerpAngle(a.yaw, a.spot.face, 1 - Math.exp(-dt * 6));
        this.play(a, a.spot.sit ? 'sit' : (wantRoom && WORK_ROLE[wantRoom]) || 'work');
      }
      a.g.rotation.y = a.yaw;
      a.mixer.update(dt * (a.role === 'walk' ? Math.max(0.6, a.speed / WALK_SPEED) : a.role === 'run' ? a.speed / RUN_SPEED : 1));
    }
  }

  walk(a, dt, wander = false) {
    const target = a.route[0];
    if (!target) { if (!wander) { a.state = 'work'; } this.play(a, 'idle'); a.speed = 0; return; }
    const to = new THREE.Vector3(target.x - a.g.position.x, 0, target.z - a.g.position.z);
    const d = to.length();
    const vmax = a.run ? RUN_SPEED : WALK_SPEED;
    // ease into and out of the walk rather than snapping to full speed
    const last = a.route.length === 1;
    const want = last ? Math.min(vmax, d * 1.6 + 0.25) : vmax;
    a.speed = THREE.MathUtils.damp(a.speed, want, 5, dt);
    if (d < 0.08) { a.route.shift(); return; }
    to.normalize();
    // gentle avoidance of the player and of other dwellers so nobody walks through anyone
    // wait politely if the Overseer stands right in the way
    if (this.playerPos) {
      const px = this.playerPos.x - a.g.position.x, pz = this.playerPos.z - a.g.position.z;
      const pd = Math.hypot(px, pz);
      if (pd < 0.9 && (px * to.x + pz * to.z) / (pd || 1) > 0.4) { a.speed = THREE.MathUtils.damp(a.speed, 0, 10, dt); }
    }
    const step = to.multiplyScalar(Math.min(a.speed * dt, d));
    a.g.position.add(step);
    a.yaw = lerpAngle(a.yaw, Math.atan2(to.x, to.z), 1 - Math.exp(-dt * 8));
    this.play(a, a.speed > 2.6 ? 'run' : a.speed > 1.8 ? 'jog' : a.speed > 0.15 ? 'walk' : 'idle', 0.25);
  }

  // colliders so the player bumps into people rather than through them
  blockers() {
    const out = [];
    for (const a of this.actors.values()) if (a.state !== 'dead') out.push(a.g.position);
    return out;
  }
}

const SPOT_PUSH = { generator: 1.0, farm: 0.4, water: 0.7, workshop: 0.2, infirmary: 0.3, market: 0.5 };
const FEMALE = new Set(['Anya', 'Olga', 'Dasha', 'Vera', 'Nina', 'Katya', 'Zoya', 'Lida']);
const WORK_ROLE = { generator: 'kneel', water: 'work', farm: 'kneel', workshop: 'work', infirmary: 'talk', market: 'talk', radio: 'torch' };

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}


// First-person arms for the Overseer: the ranger outfit's arms and bracers on the same skeleton, playing the
// two-handed pistol aim clip. The rig is pinned so its head bone sits at the camera; everything except the
// arms is hidden, and the pistol follows the right hand.
export function makeViewArms() {
  const tpl = templates.male.find((t) => t.outfit === 1) || templates.male[0];
  if (!tpl) return null;
  const root = SkeletonUtils.clone(tpl.root);
  outfit(root, { id: 4 }, altTex);
  let hand = null, head = null;
  root.traverse((o) => {
    if (o.isBone && o.name === 'hand_r') hand = o;
    if (o.isBone && o.name === 'Head') head = o;
    if (o.isMesh) {
      o.visible = /Arms/.test(o.name);
      o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const act = (r) => clips[r] && mixer.clipAction(clips[r]);
  const aim = act('aim') || act('pistolIdle');
  aim?.play();
  const reload = act('reload');
  if (reload) { reload.setLoop(THREE.LoopOnce, 1); reload.clampWhenFinished = false; }
  return { root, mixer, hand, head, aim, reload };
}

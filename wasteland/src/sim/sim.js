// The colony simulation: game clock and day/night (driving the sky), the
// stockpile and storage capacity, survivors and the infected, structures,
// scavenging sites, woodcutting, guard posts, noise, nightly hordes, strangers,
// traders, weather, power, morale, objectives, save/load, and the command API
// used by both the human interface and the AI Overseer.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import {
  HOUR, RES, RES_NAME, BASE_CAPACITY, DIFFICULTY, STRUCTURES, JOBS, TRAITS, OCCUPATIONS, FIRST_NAMES, SURNAMES, LOOT_TABLE, OBJECTIVES,
} from './defs.js';
import { NavGrid, ColliderHash } from './nav.js';
import { Structures, STRUCTURE_MODELS } from './structures.js';
import { Survivor, Infected, isNight } from './agents.js';
import { DynModels, trs } from '../world/dynmodels.js';
import { START, inPlay } from '../world/layout.js';

const SAVE_KEY = 'rustwater.save.v1';
const MAX_INFECTED = 44;
const LOT_NAMES = { gas_station: 'the petrol station', store: 'the village shop', barn: 'the barn', checkpoint: 'the army checkpoint', farmhouse: 'the farmhouse' };
const HOUSE_NAMES = { ochre: 'ochre house', plaster: 'white house', brick: 'brick house', damaged: 'burnt-out house' };
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const compass = (dx, dz) => COMPASS[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8];

export class Colony {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.fx = game.fx;
    this.rng = new RNG(4242);
    this.listeners = {};
    this.speed = 1;
    this.clock = 0;
    this.started = false;
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const f of this.listeners[ev] || []) f(...a); }

  /** One-time world hookup (nav grid, dynamic models). */
  async init(assets) {
    const w = this.world;
    this.nav = new NavGrid(w.terrain, { half: 256, cell: 2 });
    this.nav.build(w.colliders);
    this.colliders = new ColliderHash(8);
    for (const c of w.colliders) this.colliders.add(c);
    this.navVersion = 0;
    this.dyn = new DynModels(assets);
    await this.dyn.preload([...STRUCTURE_MODELS, 'tree_stump_01', 'tree_stump_02']);
    w.scene.add(this.dyn.group);
    this.structures = new Structures(this);
    w.scene.add(this.structures.group);
    this.#lootSites();
  }

  #lootSites() {
    const town = this.world.town;
    this.lootSites = this.world.props.loot.map((l) => {
      const b = town.buildings.find((x) => x.lot.id === l.id);
      let door = { x: l.x, z: l.z }, enter = false, name = LOT_NAMES[l.id] || 'the ruins';
      if (b) {
        const lot = b.lot, c = Math.cos(lot.rot), s = Math.sin(lot.rot);
        const lx = b.res.anchors?.door?.x ?? 0, lz = lot.d / 2 + 1.1;
        door = { x: lot.x + lx * c + lz * s, z: lot.z - lx * s + lz * c };
        enter = true;
        if (lot.type === 'house') name = lot.id === 'farmhouse' ? 'the farmhouse' : `the ${HOUSE_NAMES[lot.variant] || 'house'}`;
      }
      const i = this.nav.nearestFree(this.nav.cellOf(door.x, door.z), 's');
      if (i >= 0 && !this.nav.walkable(door.x, door.z)) door = { x: this.nav.cx(i), z: this.nav.cz(i) };
      return { id: l.id, kind: l.kind, name, x: l.x, z: l.z, door, enter, value: l.value, remaining: 0, max: 0 };
    });
    // abandoned cars along the road and in yards: salvage for scrap and fuel
    let n = 0;
    for (const it of this.world.props.items) {
      if (it.id !== 'covered_car') continue;
      const p = new THREE.Vector3().setFromMatrixPosition(it.m);
      if (!inPlay(p.x, p.z, 8)) continue;
      const i = this.nav.nearestFree(this.nav.cellOf(p.x + 2.6, p.z), 's');
      const door = i >= 0 ? { x: this.nav.cx(i), z: this.nav.cz(i) } : { x: p.x + 2.6, z: p.z };
      this.lootSites.push({ id: `car${n++}`, kind: 'wreck', name: 'a car wreck', x: p.x, z: p.z, door, enter: false, value: 0.7, remaining: 0, max: 0 });
    }
    // disambiguate identical names by direction from the crossroads
    const seen = new Map();
    for (const L of this.lootSites) seen.set(L.name, (seen.get(L.name) || 0) + 1);
    for (const L of this.lootSites) if (seen.get(L.name) > 1) L.name = `${L.name} (${compass(L.x - START.x, L.z - START.z)})`;
  }

  // ================================================================== new game / load
  newGame({ mode = 'human', difficulty = 'normal', seed = (Math.random() * 1e9) | 0 } = {}) {
    this.#clear();
    this.mode = mode;
    this.difficulty = difficulty;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.rng = new RNG(seed);
    this.seed = seed;
    this.day = 1; this.hour = 7.2; this.clock = 0;
    this.res = { ...this.diff.start };
    this.stats = { killed: 0, died: 0, built: 0, scavenged: 0, peak: 0, hordes: 0, arrived: 0 };
    this.moraleMods = [];
    this.morale = 62;
    this.objective = 0;
    this.broadcast = 0;
    this.ended = false;
    this.nextId = 1;
    for (const L of this.lootSites) { L.max = L.remaining = Math.round(L.value * 38 * this.diff.loot); }
    const C = START;
    this.center = { x: C.x, z: C.z };
    // starting camp: fire, supply cache, two tents
    const S = this.structures;
    S.create('campfire', C.x, C.z, 0, { built: true });
    S.create('cache', C.x + 5.5, C.z - 1.5, -Math.PI / 2 + 0.2, { built: true });
    S.create('tent', C.x - 5.5, C.z + 2.5, Math.PI / 2 - 0.3, { built: true });
    S.create('tent', C.x - 3.5, C.z - 5.0, 0.4, { built: true });
    const n = this.diff.survivors;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const d = this.makeIdentity(i < this.diff.armed);
      d.job = ['builder', 'woodcutter', 'scavenger', 'builder', 'idle', 'idle'][i] || 'idle';
      const s = this.spawnSurvivor(d, C.x + Math.cos(a) * 3.2, C.z + Math.sin(a) * 3.2);
      s.c.targetYaw = s.c.yaw = Math.atan2(C.x - s.pos.x, C.z - s.pos.z);
    }
    this.#seedInfected();
    this.world.sky.setWeather('clear', true);
    this.weatherT = 8 + this.rng.float(0, 6);
    this.started = true;
    this.log('ai', `Day 1. ${n} survivors made camp at the crossroads meadow.`);
    this.alert('Day 1 — the crossroads', 'info', null, 'Build shelter before night. Survivors eat and drink from the supply cache.');
    this.emit('start');
  }

  #clear() {
    for (const s of this.survivors || []) this.world.characters.remove(s.c);
    for (const z of this.infected || []) this.world.characters.remove(z.c);
    for (const v of this.visitors || []) this.world.characters.remove(v.c);
    this.survivors = []; this.infected = []; this.visitors = [];
    if (this.structures) this.structures.resetAll();
    // restore felled trees
    if (this.felled?.length) {
      const T = this.world.trees;
      for (const f of this.felled) { const it = T.instances[f.i]; if (it) it.removed = false; this.dyn.remove(f.stump); }
      T.lastCam.set(1e9, 0, 0);
    }
    this.treeReserved = new Set();
    this.felled = [];
    this.graves = [];
    this.logList = [];
    this.alerts = [];
    this.pendingStranger = null;
    this.trader = null;
    this.alarm = false;
    this.alarmT = 0;
    this.horde = null;
    this.hordeDir = null;
  }

  makeIdentity(armedHint = false) {
    const r = this.rng;
    const used = new Set(this.survivors.map((s) => s.first));
    let first = r.pick(FIRST_NAMES);
    for (let k = 0; k < 20 && used.has(first); k++) first = r.pick(FIRST_NAMES);
    const occ = r.pick(OCCUPATIONS);
    const traits = [...occ.traits];
    const extra = r.weighted([[null, 0.35], ['good', 0.4], ['bad', 0.25]]);
    if (extra) {
      const pool = Object.entries(TRAITS).filter(([k, t]) => t.good === (extra === 'good') && !traits.includes(k)).map(([k]) => k);
      const t = r.pick(pool);
      if (!(t === 'frail' && traits.includes('tough')) && !(t === 'tough' && traits.includes('frail'))) traits.push(t);
    }
    const skills = {};
    for (const k of ['build', 'farm', 'scav', 'shoot', 'med', 'craft']) skills[k] = +(r.float(0.72, 1.08) * (occ.skill[k] || 1)).toFixed(2);
    const maxHp = Math.round(100 * (traits.includes('tough') ? 1.3 : 1) * (traits.includes('frail') ? 0.8 : 1));
    return {
      id: this.nextId++, first, name: `${first} ${r.pick(SURNAMES)}`, occupation: occ.name, traits, skills, seed: r.int(1, 1e6),
      armed: !!(occ.armed || armedHint), pack: r.chance(0.8), hp: maxHp, maxHp, food: r.float(65, 90), water: r.float(65, 90), rest: r.float(70, 95), joined: this.day,
    };
  }

  spawnSurvivor(d, x, z) {
    const c = this.world.characters.spawn('survivor', d.seed, x, z, { rifle: d.armed, pack: d.pack });
    const s = new Survivor(this, c, d);
    this.survivors.push(s);
    this.stats && (this.stats.peak = Math.max(this.stats.peak, this.alive().length));
    return s;
  }

  spawnInfected(x, z, horde = false, hp = null) {
    if (this.infected.filter((q) => q.alive).length >= MAX_INFECTED) return null;
    const seed = this.rng.int(1, 1e6);
    const c = this.world.characters.spawn('infected', seed, x, z, { yaw: this.rng.float(0, 6.28) });
    const zb = new Infected(this, c, { id: this.nextId++, horde, hp });
    zb.seed = seed;
    this.infected.push(zb);
    return zb;
  }

  #seedInfected() {
    // a few at the checkpoint and the petrol station make the rich sites dangerous
    for (const L of this.lootSites) {
      const n = L.kind === 'military' ? 4 : L.kind === 'fuel' ? 2 : L.kind === 'store' ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const p = this.nav.randomNear(L.x, L.z, 12, this.rng, 'z');
        if (p) this.spawnInfected(p.x, p.z);
      }
    }
    for (let i = 0; i < this.diff.wanderers; i++) this.#spawnWanderer();
  }

  #spawnWanderer() {
    for (let k = 0; k < 20; k++) {
      const a = this.rng.float(0, Math.PI * 2), r = this.rng.float(90, 200);
      const x = this.center.x + Math.cos(a) * r, z = this.center.z + Math.sin(a) * r;
      if (!inPlay(x, z, 12) || !this.nav.walkable(x, z, 'z')) continue;
      return this.spawnInfected(x, z);
    }
    return null;
  }

  // ================================================================== queries
  alive() { return this.survivors.filter((s) => s.alive); }
  get night() { return isNight(this.hour); }
  get fog() { return this.world.sky.fogBoost; }
  cap(r) { return BASE_CAPACITY + this.structures.count('storage') * STRUCTURES.storage.capacity; }
  get workFactor() { return 0.75 + 0.5 * (this.morale / 100); }
  get cooking() { return this.structures.count('campfire') > 0; }
  get housing() { let n = 0; for (const s of this.structures.list) if (s.built && s.def.housing) n += s.def.housing; return n; }
  get power() {
    let supply = 0, demand = 0;
    for (const s of this.structures.list) {
      if (!s.built) continue;
      if (s.def.power > 0 && this.res.fuel > 0) supply += s.def.power;
      if (s.def.power < 0 && (s.type !== 'lamp' || this.night)) demand -= s.def.power;
    }
    return { supply, demand, ok: supply > 0 && supply >= demand };
  }
  get colonyRadius() {
    let r = 12;
    for (const s of this.structures.list) {
      if (s.def.nav === 'wall' || s.def.nav === 'gate' || s.type === 'lamp') continue;
      r = Math.max(r, Math.hypot(s.x - this.center.x, s.z - this.center.z) + Math.max(s.def.w, s.def.d) / 2);
    }
    return Math.min(r + 3, 60);
  }
  /** Radius of the barricade ring (median wall distance), or null without walls. */
  get wallRadius() {
    const d = this.structures.list.filter((s) => s.def.nav === 'wall' || s.def.nav === 'gate').map((s) => Math.hypot(s.x - this.center.x, s.z - this.center.z)).sort((a, b) => a - b);
    return d.length >= 3 ? d[d.length >> 1] : null;
  }
  occupiedShelterNear(p, r) {
    for (const s of this.survivors) {
      if (!s.alive || !s.c.hidden || s.task?.kind !== 'sleep' || !s.task.home) continue;
      const h = s.task.home;
      if ((h.x - p.x) ** 2 + (h.z - p.z) ** 2 < r * r) return h;
    }
    return null;
  }

  findPath(x, z, tx, tz, kind) { return this.nav.findPath(x, z, tx, tz, kind); }
  canAfford(cost) { return Object.entries(cost).every(([k, v]) => (this.res[k] || 0) >= v); }
  take(r, n = 1) { if ((this.res[r] || 0) < n) return false; this.res[r] -= n; return true; }
  give(r, n) {
    const cap = this.cap(r), before = this.res[r] || 0;
    this.res[r] = Math.min(cap, before + n);
    if (before + n > cap + 0.5 && (this.lastFull || 0) < this.clock - 60) { this.lastFull = this.clock; this.alert(`${RES_NAME[r]} storage is full`, 'warn', null, 'Build a storage shed to hold more.'); }
    return this.res[r] - before;
  }

  nearestInfected(p, r) {
    let best = null, bd = r * r;
    for (const z of this.infected) {
      if (!z.alive) continue;
      const d = (z.pos.x - p.x) ** 2 + (z.pos.z - p.z) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
  infectedNear(p, r) { let n = 0; for (const z of this.infected) if (z.alive && (z.pos.x - p.x) ** 2 + (z.pos.z - p.z) ** 2 < r * r) n++; return n; }
  nearestSurvivor(p, r, visibleOnly = true) {
    let best = null, bd = r * r;
    for (const s of this.survivors) {
      if (!s.alive || (visibleOnly && s.c.hidden)) continue;
      const d = (s.pos.x - p.x) ** 2 + (s.pos.z - p.z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    for (const v of this.visitors) {
      if (!v.alive || v.c.hidden) continue;
      const d = (v.pos.x - p.x) ** 2 + (v.pos.z - p.z) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  litNear(p) {
    if (!this.night) return true;
    for (const s of this.structures.list) {
      if (!s.built) continue;
      const r = s.type === 'campfire' ? 9 : s.type === 'lamp' && this.powered ? 20 : 0;
      if (r && (s.x - p.x) ** 2 + (s.z - p.z) ** 2 < r * r) return true;
    }
    return false;
  }
  infirmary() { for (const s of this.structures.list) if (s.type === 'infirmary' && s.built) return s; return null; }
  medicOnDuty(inf) { return this.survivors.find((s) => s.alive && s.onDuty === inf && s.task?.kind === 'medic' && s.task.phase === 'duty') || null; }
  patients(inf) { let n = 0; for (const s of this.survivors) if (s.alive && s.task?.kind === 'patient' && s.task.phase === 'rest') n++; return n; }

  pickStructure(type, near) {
    let best = null, bd = Infinity;
    for (const s of this.structures.list) {
      if (s.type !== type || !s.built) continue;
      const d = near ? near.distTo(s.x, s.z) : 0;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  pickSite(sv) {
    let best = null, bs = -Infinity;
    for (const s of this.structures.list) {
      if (s.built || s.workers.size >= 3) continue;
      const score = (s.priority ? 1000 : 0) - s.id * 0.5 - sv.distTo(s.x, s.z) * 0.3 - s.workers.size * 8;
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }
  pickRepair(sv) {
    let best = null, bs = -Infinity;
    if (this.res.wood < 2) return null;
    for (const s of this.structures.list) {
      if (!s.built || s.hp >= s.maxHp * 0.8 || s.workers.size >= 2) continue;
      const score = (1 - s.hp / s.maxHp) * 100 - sv.distTo(s.x, s.z) * 0.3;
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }
  pickFarm(sv) {
    let best = null, bs = -Infinity;
    for (const s of this.structures.list) {
      if (s.type !== 'farm' || !s.built || s.workers.size >= 1) continue;
      const score = (s.extra.growth >= 1 ? 50 : 0) - s.extra.growth * 20 - sv.distTo(s.x, s.z) * 0.2;
      if (score > bs) { bs = score; best = s; }
    }
    return best;
  }
  pickLoot(sv) {
    let best = null, bs = -Infinity;
    const need = this.needs();
    for (const L of this.lootSites) {
      if (L.remaining <= 0) continue;
      const d = sv.distTo(L.door.x, L.door.z);
      if (d > 320) continue;
      const danger = this.infectedNear(L, 25);
      let w = 0;
      for (const [r, k] of Object.entries(LOOT_TABLE[L.kind] || {})) w += k * (need[r] || 1);
      const score = w * Math.min(1, L.remaining / 12) * 4 - d * 0.12 - danger * (sv.armed ? 10 : 25) - (L.claimed || 0) * 8;
      if (score > bs) { bs = score; best = L; }
    }
    return best;
  }
  /** How badly each resource is needed (multiplier used to weigh scavenging). */
  needs() {
    const pop = Math.max(1, this.alive().length), out = {};
    const days = { food: this.res.food / (pop * 1.1), water: this.res.water / (pop * 1.5) };
    out.food = days.food < 2 ? 2.5 : days.food < 4 ? 1.4 : 0.7;
    out.water = days.water < 2 ? 2.5 : days.water < 4 ? 1.4 : 0.6;
    out.meds = this.res.meds < 3 ? 2.2 : 1;
    out.ammo = this.res.ammo < 20 ? 2 : 1;
    out.scrap = this.res.scrap < 20 ? 1.8 : 1;
    out.fuel = this.structures.count('generator') && this.res.fuel < 6 ? 2 : 0.6;
    out.wood = 0.6;
    return out;
  }
  pickTree(sv) {
    const T = this.world.trees, cx = this.center.x, cz = this.center.z, R2 = 160 * 160;
    const tree = T.nearest(sv.pos.x, sv.pos.z, (it) => !this.treeReserved.has(it) && (it.x - cx) ** 2 + (it.z - cz) ** 2 < R2 && (it.x - cx) ** 2 + (it.z - cz) ** 2 > 100 && inPlay(it.x, it.z, 10) && it.kind !== 'dead');
    if (!tree) return null;
    tree.trunk = T.variants[tree.kind][tree.vi].lod0.trunkRadius * tree.s;
    return tree;
  }
  fellTree(tree, sv) {
    const T = this.world.trees;
    T.fell(tree.x, tree.z, 0.6);
    this.treeReserved.delete(tree);
    this.fx?.fallTree(T, tree, sv.pos.x, sv.pos.z);
    const stump = this.dyn.add(this.rng.chance(0.5) ? 'tree_stump_01' : 'tree_stump_02', trs(tree.x, tree.y - 0.05, tree.z, tree.rot, Math.max(0.35, (tree.trunk || 0.25) * 3.2)));
    this.felled.push({ i: T.instances.indexOf(tree), stump });
    this.emit('sound', 'treefall', tree);
    const mul = { conifer: 1.2, birch: 0.9, oak: 1.3, dead: 0.7 }[tree.kind] || 1;
    return Math.round((5 + 5 * tree.s) * mul);
  }
  depot(sv) {
    let best = null, bd = Infinity;
    for (const s of this.structures.list) {
      if (!s.built || (s.type !== 'cache' && s.type !== 'storage')) continue;
      const d = sv ? sv.distTo(s.x, s.z) : 0;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return { x: this.center.x + 2, z: this.center.z + 2 };
    return this.structures.approach(best, sv ? sv.pos.x : best.x, sv ? sv.pos.z : best.z, this.rng);
  }
  deposit(sv) {
    const c = sv.carry;
    sv.carry = null; sv.c.carry = null;
    if (!c) return;
    const got = [];
    if (c.bag) { for (const [r, n] of Object.entries(c.bag)) if (n > 0) { this.give(r, n); got.push(`${n} ${RES_NAME[r].toLowerCase()}`); } }
    else { this.give(c.res, c.n); got.push(`${c.n} ${RES_NAME[c.res].toLowerCase()}`); }
    if (c.bag && got.length) this.log('info', `${sv.first} brought back ${got.join(', ')}${c.from ? ` from ${c.from}` : ''}.`);
  }
  loot(L, sv) {
    const pts = Math.min(L.remaining, Math.round((7 + 5 * sv.skills.scav) * (sv.has('scrounger') ? 1.35 : 1) * (0.8 + this.rng.next() * 0.4)));
    L.remaining -= pts;
    const table = Object.entries(LOOT_TABLE[L.kind] || LOOT_TABLE.house);
    const bag = {};
    for (let i = 0; i < pts; i++) {
      const r = this.rng.weighted(table);
      bag[r] = (bag[r] || 0) + (r === 'ammo' ? 3 : 1);
    }
    this.stats.scavenged += pts;
    if (L.remaining <= 0) this.log('info', `${L.name[0].toUpperCase() + L.name.slice(1)} has been picked clean.`);
    return { bag, from: L.name };
  }
  bedFor(sv) {
    const home = sv.home && this.structures.byId.get(sv.home);
    if (home && home.built) return home;
    const used = new Map();
    for (const s of this.survivors) if (s.alive && s !== sv && s.home) used.set(s.home, (used.get(s.home) || 0) + 1);
    let best = null, bd = Infinity;
    for (const s of this.structures.list) {
      if (!s.built || !s.def.housing) continue;
      if ((used.get(s.id) || 0) >= s.def.housing) continue;
      const d = sv.distTo(s.x, s.z) - (s.type === 'shack' ? 20 : 0);
      if (d < bd) { bd = d; best = s; }
    }
    sv.home = best ? best.id : null;
    return best;
  }
  roughSpot(sv) {
    const fire = this.pickStructure('campfire', sv);
    const c = fire || this.center;
    const a = (sv.id * 2.39996) % (Math.PI * 2), r = fire ? 2.6 : 3;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    return this.nav.walkable(x, z) ? { x, z } : (this.nav.randomNear(c.x, c.z, 6, this.rng) || { x: c.x + 3, z: c.z });
  }
  guardPost(sv) {
    for (const t of this.structures.list) {
      if (t.type !== 'watchtower' || !t.built) continue;
      t.extra.slots ||= [{}, {}];
      const i = t.extra.slots.findIndex((q) => !q.taken || !q.taken.alive || q.taken.task?.slot !== q);
      if (i < 0) continue;
      const slot = t.extra.slots[i];
      slot.taken = sv;
      const g = t.spots.guard[i], ladder = t.spots.ladder;
      const ground = this.world.terrain.height(g.x, g.z);
      return { tower: t, site: t, slot, dx: ladder.x, dz: ladder.z, px: g.x, pz: g.z, liftTo: g.y - ground + 0.02, faceX: g.x + (g.x - t.x) * 5, faceZ: g.z + (g.z - t.z) * 5 };
    }
    // perimeter post facing the likely threat
    const guards = this.survivors.filter((s) => s.alive && s.job === 'guard');
    const k = guards.indexOf(sv), n = Math.max(1, guards.length);
    const base = this.hordeDir ?? this.#threatDir();
    const a = base + (k - (n - 1) / 2) * 0.7;
    const wr = this.wallRadius;
    const R = wr ? wr - 2.5 : this.colonyRadius + 2;
    let x = this.center.x + Math.sin(a) * R, z = this.center.z + Math.cos(a) * R;
    const i = this.nav.nearestFree(this.nav.cellOf(x, z), 's');
    if (i >= 0) { x = this.nav.cx(i); z = this.nav.cz(i); }
    return { dx: x, dz: z, faceX: x + Math.sin(a) * 10, faceZ: z + Math.cos(a) * 10 };
  }
  #threatDir() {
    const z = this.nearestInfected(this.center, 400);
    return z ? Math.atan2(z.pos.x - this.center.x, z.pos.z - this.center.z) : 0.8;
  }

  // ================================================================== events from agents
  addWork(site, hours) {
    this.structures.setProgress(site, site.progress + hours / site.def.work);
  }
  noise(kind, pos, dt) {
    const r = kind === 'chop' ? 38 : kind === 'build' ? 26 : 12;
    if (this.rng.next() > dt * 0.25) return;
    for (const z of this.infected) z.hear(pos.x, pos.z, r);
  }
  gunshot(shooter, z, hit) {
    const from = this.world.characters.muzzle(shooter.c);
    const to = new THREE.Vector3(z.pos.x + (hit ? 0 : (Math.random() - 0.5) * 2.5), z.pos.y + 1.2 + (hit ? 0 : Math.random()), z.pos.z + (hit ? 0 : (Math.random() - 0.5) * 2.5));
    this.fx?.flash(from.x, from.y, from.z);
    this.fx?.tracer(from, to);
    if (!hit) this.fx?.dust(to.x, this.world.terrain.height(to.x, to.z), to.z, 2, [0.4, 0.36, 0.3], 0.2);
    this.emit('sound', 'shot', from);
    const r = this.night ? 70 : 55;
    for (const q of this.infected) q.hear(shooter.pos.x, shooter.pos.z, r);
  }
  separate(a) {
    const list = a instanceof Infected ? this.infected : this.survivors;
    for (const b of list) {
      if (b === a || !b.alive) continue;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.36 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (0.6 - d) * 0.5; a.pos.x += (dx / d) * k; a.pos.z += (dz / d) * k; }
    }
  }
  onInfectedDeath(z, by) {
    this.stats.killed++;
    this.emit('sound', 'zdeath', z.pos);
  }
  onSurvivorDeath(s, cause) {
    this.stats.died++;
    this.moraleMods.push({ v: -18, t: 48 });
    for (const t of this.structures.list) if (t.extra.slots) for (const q of t.extra.slots) if (q.taken === s) q.taken = null;
    this.alert(`${s.name} is dead`, 'danger', s.pos, cause === 'infection' ? 'The infection took them.' : `Killed by ${cause}.`);
    this.log('ai', `${s.name} died (${cause}).`);
    this.emit('death', s);
    if (!this.alive().length) this.#gameOver();
  }
  onStructureComplete(s, silent) {
    if (silent) return;
    this.stats.built++;
    this.alert(`${s.def.name} finished`, 'good', s, null, true);
    this.emit('built', s);
    if (s.type === 'campfire' && !this.structures.list.some((q) => q.type === 'campfire' && q !== s && q.built)) this.center = { x: s.x, z: s.z };
  }
  onStructureDestroyed(s, refund) {
    for (const sv of this.survivors) if (sv.home === s.id) sv.home = null;
    if (!refund && s.built) { this.alert(`${s.def.name} destroyed`, 'danger', s); this.moraleMods.push({ v: -5, t: 24 }); }
    this.emit('destroyed', s);
  }
  onStructureHit(s, z) {
    if ((s.lastHitAlert || 0) < this.clock - 40) { s.lastHitAlert = this.clock; this.alert(`The dead are breaking the ${s.def.name.toLowerCase()}`, 'danger', s); }
    this.raiseAlarm();
    if (s.def.housing) for (const sv of this.survivors) if (sv.alive && sv.task?.home === s && sv.c.hidden) { sv.c.hidden = false; sv.reset(); }
  }
  onGroan(z) { this.emit('sound', 'groan', z.pos); }
  raiseAlarm() { this.alarm = true; this.alarmT = 40; }

  // ================================================================== commands (human UI + AI)
  place(type, x, z, rot, by = 'human') {
    const def = STRUCTURES[type];
    if (!def) return { ok: false, reason: 'Unknown structure' };
    if (!this.canAfford(def.cost)) return { ok: false, reason: 'Not enough materials' };
    const chk = this.structures.check(type, x, z, rot);
    if (!chk.ok) return chk;
    for (const [k, v] of Object.entries(def.cost)) this.res[k] -= v;
    const s = this.structures.create(type, x, z, rot, { y: chk.y });
    s.placedBy = by;
    this.emit('placed', s);
    return { ok: true, s };
  }
  cancel(s) {
    const frac = s.built ? 0.3 : 1 - s.progress * 0.5;
    for (const [k, v] of Object.entries(s.def.cost)) this.give(k, Math.floor(v * frac));
    for (const sv of this.survivors) if (sv.task?.site === s) sv.reset();
    this.structures.destroy(s, { refund: true });
  }
  setJob(sv, job, locked = null) {
    if (!JOBS[job] || !sv.alive) return;
    if (sv.job !== job) { sv.job = job; if (!['sleep', 'eat', 'drink', 'patient', 'fight', 'flee', 'treat'].includes(sv.task?.kind)) sv.reset(); }
    if (locked !== null) sv.locked = locked;
    this.emit('job', sv);
  }
  order(sv, o) {
    if (!sv.alive) return;
    sv.order = o;
    sv.reset();
  }
  /** First-person attack by the possessed survivor along a camera ray. */
  playerAttack(sv, origin, dir) {
    if (!sv.alive) return;
    if (sv.armed && this.take('ammo', 1)) {
      let best = null, bt = 75;
      for (const z of this.infected) {
        if (!z.alive) continue;
        const cx = z.pos.x - origin.x, cy = z.pos.y + 1.15 - origin.y, cz = z.pos.z - origin.z;
        const t = cx * dir.x + cy * dir.y + cz * dir.z;
        if (t < 0 || t > bt) continue;
        const px = cx - dir.x * t, py = cy - dir.y * t, pz = cz - dir.z * t;
        if (Math.hypot(px, pz) < 0.42 && py > -1.2 && py < 0.75) { best = { z, t, head: py > 0.3 && Math.hypot(px, pz) < 0.2 }; bt = t; }
      }
      const muzzle = origin.clone().addScaledVector(dir, 0.7); muzzle.y -= 0.12;
      const end = origin.clone().addScaledVector(dir, best ? best.t : 70);
      this.fx?.flash(muzzle.x, muzzle.y, muzzle.z);
      this.fx?.tracer(muzzle, end);
      this.emit('sound', 'shot', muzzle);
      for (const q of this.infected) q.hear(sv.pos.x, sv.pos.z, this.night ? 70 : 55);
      if (best && Math.random() < 0.93) best.z.damage(best.head ? 999 : 36 + Math.random() * 26, sv);
      else if (!best) { const g = this.world.terrain.height(end.x, end.z); if (end.y - g < 1.5) this.fx?.dust(end.x, g, end.z, 2, [0.4, 0.36, 0.3], 0.2); }
      return;
    }
    // melee: whatever is close in front
    sv.c.anim.set('attack');
    let best = null, bd = 2.2;
    for (const z of this.infected) {
      if (!z.alive) continue;
      const dx = z.pos.x - sv.pos.x, dz = z.pos.z - sv.pos.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * dir.x + dz * dir.z) / (d || 1) > 0.5) { bd = d; best = z; }
    }
    if (best) best.damage(16 + Math.random() * 14, sv);
  }

  treatNow(sv) { if (sv.infection > 0 && this.res.meds > 0) { sv.reset(); sv.task = { kind: 'treat', phase: null }; } }

  // strangers & trader
  answerStranger(accept, by = 'human') {
    const p = this.pendingStranger;
    if (!p) return;
    this.pendingStranger = null;
    const v = p.visitor;
    if (accept) {
      this.visitors = this.visitors.filter((q) => q !== v);
      const s = new Survivor(this, v.c, p.data);
      s.pos = v.c.root.position;
      this.survivors.push(s);
      this.stats.arrived++;
      this.stats.peak = Math.max(this.stats.peak, this.alive().length);
      this.alert(`${p.data.name} joined the colony`, 'good', s.pos);
      this.log(by === 'ai' ? 'ai' : 'info', `${p.data.name} (${p.data.occupation.toLowerCase()}) joined${by === 'ai' ? ' — accepted by the Overseer' : ''}.`);
      this.emit('joined', s);
    } else {
      v.leave = true;
      this.log(by === 'ai' ? 'ai' : 'info', `Turned away ${p.data.first}.`);
    }
  }
  trade(i, by = 'human') {
    const t = this.trader;
    if (!t || !t.here) return false;
    const o = t.offers[i];
    if (!o || o.stock <= 0 || (this.res[o.give] || 0) < o.giveN) return false;
    this.res[o.give] -= o.giveN;
    this.give(o.get, o.getN);
    o.stock--;
    this.log(by === 'ai' ? 'ai' : 'info', `Traded ${o.giveN} ${RES_NAME[o.give].toLowerCase()} for ${o.getN} ${RES_NAME[o.get].toLowerCase()}.`);
    this.emit('traded', o);
    return true;
  }

  // ================================================================== messages
  alert(title, kind = 'info', pos = null, detail = null, quiet = false) {
    const a = { title, kind, detail, pos: pos ? { x: pos.x, z: pos.z } : null, day: this.day, hour: this.hour, quiet };
    this.alerts.push(a);
    if (this.alerts.length > 60) this.alerts.shift();
    this.emit('alert', a);
  }
  log(kind, text, detail = null) {
    const e = { kind, text, detail, day: this.day, hour: this.hour };
    this.logList.push(e);
    if (this.logList.length > 120) this.logList.shift();
    this.emit('log', e);
  }
  get timeString() { const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

  // ================================================================== update
  update(dtReal) {
    if (!this.started || this.ended) { this.#visuals(dtReal, 0); return; }
    const total = dtReal * this.speed;
    const steps = Math.max(1, Math.ceil(total / 0.1));
    const dt = total / steps;
    for (let i = 0; i < steps; i++) this.step(dt);
    this.#visuals(dtReal, total);
  }

  /** One simulation step of dt game-seconds (1 game hour = HOUR seconds). */
  step(dt) {
    if (!this.started || this.ended || dt <= 0) return;
    this.clock += dt;
    const prevHour = this.hour;
    this.hour += dt / HOUR;
    if (this.hour >= 24) { this.hour -= 24; this.day++; this.#newDay(); }
    if (Math.floor(prevHour) !== Math.floor(this.hour)) this.#hourly();
    for (const s of this.survivors) s.update(dt);
    for (const z of this.infected) z.update(dt);
    this.#visitors(dt);
    // corpses
    for (let i = this.infected.length - 1; i >= 0; i--) {
      const z = this.infected[i];
      if (!z.alive && z.deadT > 40) { this.world.characters.remove(z.c); this.infected.splice(i, 1); }
    }
    for (let i = this.survivors.length - 1; i >= 0; i--) {
      const s = this.survivors[i];
      if (s.alive) continue;
      if (s.turns && s.deadT > 18) {
        this.world.characters.remove(s.c); this.survivors.splice(i, 1);
        const z = this.spawnInfected(s.pos.x, s.pos.z);
        if (z) this.alert(`${s.first} has risen`, 'danger', s.pos, 'The dead do not stay dead.');
      } else if (!s.turns && s.deadT > 45) {
        this.world.characters.remove(s.c); this.survivors.splice(i, 1);
        this.#grave(s);
      }
    }
    // farms grow slowly on their own, faster in rain
    const rain = this.world.sky.rain;
    for (const st of this.structures.list) {
      if (!st.built) continue;
      if (st.type === 'farm' && st.extra.growth < 1) this.structures.setGrowth(st, Math.min(1, st.extra.growth + (dt / HOUR) * (0.009 + 0.014 * rain)));
      if (st.type === 'rain_collector') { st.extra.acc = (st.extra.acc || 0) + (dt / HOUR) * (0.18 + 2.6 * rain); if (st.extra.acc >= 1) { st.extra.acc -= 1; this.give('water', 1); } }
    }
    // power: generators burn fuel under load
    const pw = this.power;
    this.powered = pw.ok;
    if (pw.ok && pw.demand > 0) { this.fuelAcc = (this.fuelAcc || 0) + (dt / HOUR) / 5; if (this.fuelAcc >= 1) { this.fuelAcc -= 1; if (!this.take('fuel', 1)) this.powered = false; } }
    const radio = this.pickStructure('radio');
    if (radio && this.powered) {
      const before = this.broadcast;
      this.broadcast += dt / HOUR;
      if (before < 48 && this.broadcast >= 48) this.#victory();
      else if (Math.floor(before / 12) !== Math.floor(this.broadcast / 12)) this.alert('Radio contact', 'good', radio, `Broadcasting for ${Math.floor(this.broadcast)} hours. The convoy needs 48.`);
    }
    // alarm: infected close to camp
    const near = this.nearestInfected(this.center, this.colonyRadius + 16);
    if (near) { if (!this.alarm && this.night) this.alert('The dead are at the camp', 'danger', near.pos); this.alarm = this.alarm || this.night; this.alarmT = 30; }
    else if (this.alarm) { this.alarmT -= dt; if (this.alarmT <= 0) this.alarm = false; }
    // gates close at night and when the dead are near
    const wantOpen = !this.night && !near;
    for (const st of this.structures.list) if (st.type === 'gate' && st.built) this.structures.setOpen(st, wantOpen);
    // horde spawning in waves
    if (this.horde && this.horde.left > 0) {
      this.horde.t -= dt;
      if (this.horde.t <= 0) { this.horde.t = 2.5; this.#spawnHordeWave(); }
    }
    this.ai?.update(dt);
  }

  #visuals(dtReal, dtSim) {
    const sky = this.world.sky;
    if (this.started) { sky.time = this.hour; sky.day = this.day; }
    // fires, smoke, lights
    const cam = this.game.camera.position;
    const lights = [];
    // darkness from the sun's elevation (at night the sky's light direction is the moon's)
    const dark = sky.isNight ? 1 : Math.max(0.08, 1 - Math.max(0, Math.min(1, (sky.sunDir.y + 0.05) / 0.35)));
    for (const s of this.structures?.list || []) {
      if (!s.built) continue;
      const far = (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2 > 180 * 180;
      if (s.type === 'campfire' && s.spots.fire) {
        const lit = !s.extra.out;
        if (lit && !far) this.fx?.fire('cf' + s.id, s.spots.fire.x, s.spots.fire.y, s.spots.fire.z, dtReal, 0.55 + 0.45 * dark);
        if (lit) lights.push({ x: s.spots.light.x, y: s.spots.light.y, z: s.spots.light.z, color: 0xff9a4a, intensity: 3.2 * dark, flicker: true, range: 16 });
      } else if (s.type === 'shack' && s.spots.smoke && (this.night || this.hour > 19 || this.hour < 8) && !far) {
        this.fx?.smoke('sh' + s.id, s.spots.smoke.x, s.spots.smoke.y, s.spots.smoke.z, dtReal, 1.2, 0.35, 0.6);
      } else if (s.type === 'generator' && this.powered && !far) {
        this.fx?.smoke('gen' + s.id, s.spots.smoke.x, s.spots.smoke.y, s.spots.smoke.z, dtReal, 2.5, 0.22, 0.4);
      } else if (s.type === 'lamp' && this.powered && this.night) {
        lights.push({ x: s.spots.light.x, y: s.spots.light.y, z: s.spots.light.z, color: 0xe8eeff, intensity: 16, range: 32 });
      }
    }
    this.structures?.update(dtReal, this.night, this.powered);
    this.fx?.updateLights(lights, this.game.rig.focus, performance.now() * 0.001);
    this.world.characters.update(this.started ? dtSim : dtReal, this.game.camera);
  }

  #hourly() {
    const h = Math.floor(this.hour);
    // campfires burn wood through the night
    if (this.night) for (const s of this.structures.list) if (s.type === 'campfire' && s.built) {
      s.extra.burn = (s.extra.burn || 0) + 0.3;
      if (s.extra.burn >= 1) { s.extra.burn -= 1; s.extra.out = !this.take('wood', 1); }
    } else for (const s of this.structures.list) if (s.type === 'campfire') s.extra.out = false;
    this.#morale();
    // weather changes
    this.weatherT -= 1;
    if (this.weatherT <= 0) {
      this.weatherT = 5 + this.rng.float(0, 8);
      const w = this.rng.weighted([['clear', 0.42], ['cloudy', 0.27], ['rain', 0.19], ['fog', 0.12]]);
      if (w !== this.world.sky.weather) { this.world.sky.setWeather(w); this.emit('weather', w); if (w === 'fog') this.alert('Fog is rolling in', 'warn', null, 'The dead can get close unseen.'); }
    }
    // wanderers: top up, and let surplus ones far from anyone drift off the map
    const wanderers = this.infected.filter((z) => z.alive && !z.horde);
    const target = Math.min(16, this.diff.wanderers + Math.floor(this.day / 2));
    if (wanderers.length < target) this.#spawnWanderer();
    for (const z of wanderers) {
      const far = !this.nearestSurvivor(z.pos, 60, false) && Math.hypot(z.pos.x - this.center.x, z.pos.z - this.center.z) > 70;
      if ((z.despawn || wanderers.length > target + 3) && far && (z.state === 'wander' || z.state === 'leave')) { z.alive = false; z.deadT = 999; z.removed = true; }
    }
    // strangers
    if (h >= 8 && h <= 17 && !this.pendingStranger && this.alive().length < 16) {
      const p = 0.035 * (this.pickStructure('radio') && this.powered ? 2.5 : 1) * (this.morale > 50 ? 1.2 : 0.8);
      if (this.rng.next() < p) this.#stranger();
    }
    if (this.pendingStranger && this.clock - this.pendingStranger.t > 6 * HOUR) this.answerStranger(false);
    // trader every third day
    if (h === 10 && this.day % 3 === 0 && !this.trader) this.#traderArrives();
    if (this.trader && h === 17) this.#traderLeaves();
    // nightly horde
    if (h === 22 && this.day >= this.diff.hordeStart && !this.horde) this.#hordeStart();
    if (h === 6 && this.horde) {
      // at dawn the horde drifts back into the woods
      for (const z of this.infected) if (z.horde && z.alive) { z.horde = false; if (z.state !== 'attack' && z.state !== 'chase') { z.state = 'leave'; z.stop(); } }
      if (this.horde.announced) this.log('ai', `The night's horde broke up at dawn. ${this.horde.size} came.`);
      this.horde = null;
    }
    this.#objectives();
    this.emit('hour', h);
  }

  #newDay() {
    const pop = this.alive().length;
    this.log('info', `Day ${this.day}. ${pop} survivor${pop === 1 ? '' : 's'}, food ${Math.floor(this.res.food)}, water ${Math.floor(this.res.water)}, wood ${Math.floor(this.res.wood)}.`);
    this.alert(`Day ${this.day}`, 'info', null, `${pop} survivor${pop === 1 ? '' : 's'} alive. ${this.stats.killed} infected killed so far.`);
    for (const m of this.moraleMods) m.t -= 24;
    this.moraleMods = this.moraleMods.filter((m) => m.t > 0);
    if (this.morale < 18 && pop > 2 && this.rng.chance(0.35)) {
      const s = this.rng.pick(this.alive().filter((q) => !q.possessed));
      if (s) { this.alert(`${s.name} left the colony`, 'danger', s.pos, 'Morale was too low.'); s.reset(); s.alive = false; this.world.characters.remove(s.c); this.survivors.splice(this.survivors.indexOf(s), 1); }
    }
    this.emit('day', this.day);
    this.save();
  }

  #morale() {
    const pop = this.alive().length || 1;
    let m = 55;
    const housed = Math.min(1, this.housing / pop);
    m += housed >= 1 ? 8 : -22 * (1 - housed);
    if (this.structures.count('campfire')) m += 5;
    m += Math.min(8, this.structures.count('shack') * 2);
    const hungry = this.survivors.filter((s) => s.alive && (s.food < 10 || s.water < 10)).length;
    m -= hungry * 8;
    const fd = this.res.food / (pop * 1.1), wd = this.res.water / (pop * 1.5);
    if (fd > 3 && wd > 3) m += 6; else if (fd < 1 || wd < 1) m -= 8;
    if (this.infirmary()) m += 3;
    if (this.pickStructure('radio') && this.powered) m += 6;
    if (this.structures.count('watchtower')) m += 3;
    for (const x of this.moraleMods) m += x.v * Math.min(1, x.t / 24);
    this.morale = Math.max(0, Math.min(100, this.morale + (m - this.morale) * 0.35));
  }

  #objectives() {
    const o = OBJECTIVES[this.objective];
    if (!o) return;
    const S = this.structures;
    const done = {
      shelter: () => this.housing >= this.alive().length,
      water: () => S.count('rain_collector') + S.count('well') > 0,
      food: () => S.count('farm') > 0 && this.survivors.some((s) => s.alive && s.job === 'farmer'),
      tower: () => S.count('watchtower') > 0,
      walls: () => S.count('barricade') >= 8 && S.count('gate') > 0,
      power: () => S.count('generator') > 0 && this.res.fuel > 0,
      radio: () => this.broadcast >= 48,
    }[o.id]();
    if (done && o.id !== 'radio') {
      this.objective++;
      this.moraleMods.push({ v: 6, t: 36 });
      this.alert(`Objective complete: ${o.title}`, 'good', null, OBJECTIVES[this.objective] ? `Next: ${OBJECTIVES[this.objective].title}` : null);
      this.log('info', `Objective complete: ${o.title}.`);
      this.emit('objective', this.objective);
    }
  }
  objectiveProgress() {
    const o = OBJECTIVES[this.objective];
    if (!o) return null;
    const S = this.structures;
    const p = {
      shelter: `${this.housing}/${this.alive().length} beds`,
      water: `${S.count('rain_collector') + S.count('well')}/1`,
      food: `${S.count('farm')} plot${S.count('farm') === 1 ? '' : 's'}, ${this.survivors.filter((s) => s.alive && s.job === 'farmer').length} farmer`,
      tower: `${S.count('watchtower')}/1`,
      walls: `${S.count('barricade')}/8 walls, ${S.count('gate')}/1 gate`,
      power: `${S.count('generator')}/1 generator`,
      radio: S.count('radio') ? `${Math.floor(this.broadcast)}/48 h on air${this.powered ? '' : ' (no power)'}` : 'mast not built',
    }[o.id];
    return { ...o, progress: p, index: this.objective, total: OBJECTIVES.length };
  }

  // ---------------------------------------------------------------- horde
  #hordeStart() {
    const d = this.diff;
    const size = Math.min(d.hordeCap, Math.round(d.hordeBase + d.hordeGrowth * (this.day - d.hordeStart)));
    let dir = this.rng.float(0, Math.PI * 2);
    // prefer a land approach inside the map
    for (let k = 0; k < 12; k++) {
      const x = this.center.x + Math.sin(dir) * 160, z = this.center.z + Math.cos(dir) * 160;
      if (inPlay(x, z, 10) && this.nav.walkable(x, z, 'z')) break;
      dir += 0.55;
    }
    this.hordeDir = dir;
    this.horde = { size, left: size, dir, t: this.rng.float(20, 60), announced: false };
    this.stats.hordes++;
  }
  #spawnHordeWave() {
    const h = this.horde;
    const n = Math.min(h.left, 3 + this.rng.int(0, 2));
    let spawned = 0;
    for (let i = 0; i < n; i++) {
      const a = h.dir + this.rng.float(-0.35, 0.35), r = this.rng.float(135, 175);
      let x = this.center.x + Math.sin(a) * r, z = this.center.z + Math.cos(a) * r;
      x = Math.max(-200, Math.min(200, x)); z = Math.max(-200, Math.min(200, z));
      const p = this.nav.randomNear(x, z, 12, this.rng, 'z');
      if (p && this.spawnInfected(p.x, p.z, true)) spawned++;
    }
    h.left -= n;
    if (!h.announced && spawned) {
      h.announced = true;
      const where = compass(Math.sin(h.dir), Math.cos(h.dir));
      this.alert(`Horde from the ${where}`, 'danger', { x: this.center.x + Math.sin(h.dir) * 120, z: this.center.z + Math.cos(h.dir) * 120 }, `About ${h.size} infected are coming.`);
      this.log('ai', `Horde sighted to the ${where}: about ${h.size} infected.`);
      this.emit('horde', h);
    }
  }

  // ---------------------------------------------------------------- visitors
  #roadEntry(west = this.rng.chance(0.5)) {
    const p = west ? { x: -195, z: 22 } : { x: 195, z: -18 };
    const i = this.nav.nearestFree(this.nav.cellOf(p.x, p.z), 's');
    return i >= 0 ? { x: this.nav.cx(i), z: this.nav.cz(i) } : p;
  }
  #visitor(kind, data, r) {
    const west = this.rng.chance(0.5);
    const e = this.#roadEntry(west);
    const target = this.#edgeSpot(r, west);
    const c = this.world.characters.spawn('survivor', data.seed, e.x, e.z, { rifle: data.armed, pack: true });
    const v = { kind, data, c, pos: c.root.position, alive: true, hp: 100, leave: false, arrived: false, here: false, agent: null };
    const a = new Survivor(this, c, { ...data, id: -this.nextId++ });
    v.agent = a;
    a.moveTo(target.x, target.z);
    v.hurt = (n) => { v.hp -= n; if (v.hp <= 0) { v.alive = false; c.anim.set('dead'); v.deadT = 0; } };
    v.onTower = false;
    this.visitors.push(v);
    return v;
  }
  #visitors(dt) {
    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i];
      if (!v.alive) { v.deadT += dt; if (v.deadT > 40) { this.world.characters.remove(v.c); this.visitors.splice(i, 1); if (this.trader === v.trader) this.trader = null; } continue; }
      const a = v.agent;
      if (v.leave) {
        if (!v.exiting) { v.exiting = true; const e = this.#roadEntry(v.pos.x < this.center.x); a.moveTo(e.x, e.z); }
        const r = a.follow(dt, 1.45);
        v.c.anim.set(v.c.speed > 0 ? 'walk' : 'idle');
        if (r !== 'moving') { this.world.characters.remove(v.c); this.visitors.splice(i, 1); }
        continue;
      }
      const r = a.follow(dt, 1.45);
      v.c.anim.set(v.c.speed > 0 ? 'walk' : 'idle');
      if (r !== 'moving' && !v.arrived) {
        v.arrived = true;
        v.c.targetYaw = Math.atan2(this.center.x - v.pos.x, this.center.z - v.pos.z);
        if (v.kind === 'stranger') { this.emit('stranger', this.pendingStranger); }
        if (v.kind === 'trader' && this.trader) { this.trader.here = true; this.alert('The trader has arrived', 'good', v.pos, 'Open the colony panel to trade until 17:00.'); this.emit('trader', this.trader); }
      }
      if (v.arrived) { v.c.anim.set('idle'); }
    }
  }
  #stranger() {
    const d = this.makeIdentity(this.rng.chance(0.35));
    const v = this.#visitor('stranger', d, 26);
    this.pendingStranger = { data: d, visitor: v, t: this.clock };
    this.alert('A stranger approaches', 'warn', v.pos, `${d.first}, ${d.occupation.toLowerCase()}, is walking toward the camp.`);
  }
  #edgeSpot(r, west) {
    const x = this.center.x + (west ? -r : r), z = this.center.z + 8;
    return this.nav.randomNear(x, z, 6, this.rng) || { x, z };
  }
  #traderArrives() {
    const data = { ...this.makeIdentity(true), name: 'Trader', first: 'The trader', occupation: 'Travelling trader' };
    this.nextId--;
    const v = this.#visitor('trader', data, 30);
    const need = this.needs();
    const offers = [];
    const pick = (get, give, ratio) => ({ get, give, getN: 6, giveN: Math.max(2, Math.round(6 * ratio)), stock: 3 });
    const wants = Object.entries(need).filter(([r]) => r !== 'wood').sort((a, b) => b[1] - a[1]).map(([r]) => r);
    const price = { food: 1, water: 0.8, meds: 3, ammo: 0.6, fuel: 1.6, scrap: 1, wood: 0.7 };
    const pay = ['scrap', 'wood', 'food'];
    for (const get of wants.slice(0, 4)) {
      const give = pay.find((p) => p !== get) || 'scrap';
      offers.push(pick(get, give, price[get] / price[give]));
    }
    this.trader = { visitor: v, offers, here: false };
    v.trader = this.trader;
    this.log('info', 'A trader is on the road toward the camp.');
  }
  #traderLeaves() {
    const t = this.trader;
    if (!t) return;
    t.here = false;
    t.visitor.leave = true;
    this.trader = null;
    this.emit('trader', null);
    this.log('info', 'The trader moved on.');
  }

  #grave(s) {
    if (!this.graveyard) {
      const a = Math.atan2(this.center.x - START.x, this.center.z - START.z) + Math.PI * 0.75;
      const p = this.nav.randomNear(this.center.x + Math.sin(a) * 26, this.center.z + Math.cos(a) * 26, 8, this.rng) || { x: this.center.x + 20, z: this.center.z };
      this.graveyard = { x: p.x, z: p.z, n: 0 };
    }
    const g = this.graveyard;
    const x = g.x + (g.n % 4) * 1.6, z = g.z + Math.floor(g.n / 4) * 2.8;
    g.n++;
    this.graves.push(this.structures.addGrave(x, z, 0.1));
  }

  #gameOver() {
    this.ended = 'defeat';
    this.log('ai', `The colony has fallen on day ${this.day}.`);
    localStorage.removeItem(SAVE_KEY);
    this.emit('end', 'defeat');
  }
  #victory() {
    this.ended = 'victory';
    this.alert('The convoy is here', 'good', null, 'Trucks and an armed escort arrived at the crossroads.');
    this.log('ai', `Day ${this.day}: the evacuation convoy answered the broadcast.`);
    this.emit('end', 'victory');
  }
  continueAfterVictory() { this.ended = false; this.broadcast = 49; this.objective = OBJECTIVES.length; }

  // ================================================================== save / load
  serialize() {
    return {
      v: 1, mode: this.mode, difficulty: this.difficulty, seed: this.seed, day: this.day, hour: this.hour, clock: this.clock,
      res: this.res, stats: this.stats, morale: this.morale, moraleMods: this.moraleMods, objective: this.objective, broadcast: this.broadcast,
      nextId: this.nextId, center: this.center, weather: this.world.sky.weather, weatherT: this.weatherT, graveyard: this.graveyard || null,
      structures: this.structures.list.map((s) => ({ id: s.id, type: s.type, x: +s.x.toFixed(2), z: +s.z.toFixed(2), rot: +s.rot.toFixed(3), progress: s.progress, hp: Math.round(s.hp), seed: s.seed, growth: s.extra.growth || 0, built: s.built })),
      survivors: this.survivors.filter((s) => s.alive).map((s) => ({
        id: s.id, first: s.first, name: s.name, occupation: s.occupation, traits: s.traits, skills: s.skills, seed: s.seed, armed: s.armed, pack: s.pack,
        job: s.job, locked: s.locked, hp: Math.round(s.hp), maxHp: s.maxHp, food: Math.round(s.food), water: Math.round(s.water), rest: Math.round(s.rest),
        infection: Math.round(s.infection), kills: s.kills, joined: s.joined, x: +s.pos.x.toFixed(1), z: +s.pos.z.toFixed(1),
      })),
      infected: this.infected.filter((z) => z.alive).map((z) => ({ x: +z.pos.x.toFixed(1), z: +z.pos.z.toFixed(1), hp: Math.round(z.hp), horde: z.horde })),
      felled: this.felled.map((f) => f.i),
      loot: this.lootSites.map((L) => [L.id, L.remaining, L.max]),
      graves: this.graves.map((g) => [g.x, g.z, g.rot]),
      log: this.logList.slice(-40),
    };
  }
  save() {
    if (!this.started || this.ended) return false;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize())); return true; } catch (e) { console.warn('save failed', e); return false; }
  }
  static hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  static saveInfo() { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d ? { day: d.day, mode: d.mode, pop: d.survivors.length, difficulty: d.difficulty } : null; } catch { return null; } }

  load() {
    let d;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { d = null; }
    if (!d || d.v !== 1) return false;
    this.#clear();
    this.mode = d.mode; this.difficulty = d.difficulty; this.diff = DIFFICULTY[d.difficulty] || DIFFICULTY.normal;
    this.seed = d.seed; this.rng = new RNG(d.seed + d.day * 7 + 1);
    this.day = d.day; this.hour = d.hour; this.clock = d.clock;
    this.res = d.res; this.stats = d.stats; this.morale = d.morale; this.moraleMods = d.moraleMods || [];
    this.objective = d.objective; this.broadcast = d.broadcast; this.nextId = d.nextId; this.center = d.center;
    this.weatherT = d.weatherT ?? 6; this.graveyard = d.graveyard; this.ended = false;
    this.world.sky.setWeather(d.weather || 'clear', true);
    for (const [id, rem, max] of d.loot) { const L = this.lootSites.find((q) => q.id === id); if (L) { L.remaining = rem; L.max = max; } }
    const T = this.world.trees;
    for (const i of d.felled) {
      const it = T.instances[i];
      if (!it || it.removed) continue;
      it.removed = true;
      const stump = this.dyn.add('tree_stump_01', trs(it.x, it.y - 0.05, it.z, it.rot, 0.8));
      this.felled.push({ i, stump });
    }
    T.lastCam.set(1e9, 0, 0);
    for (const s of d.structures) this.structures.create(s.type, s.x, s.z, s.rot, { built: s.built, progress: s.progress, hp: s.hp, id: s.id, seed: s.seed, extra: { growth: s.growth } });
    for (const sd of d.survivors) this.spawnSurvivor(sd, sd.x, sd.z);
    for (const z of d.infected) this.spawnInfected(z.x, z.z, z.horde, z.hp);
    for (const [x, z, rot] of d.graves || []) this.graves.push(this.structures.addGrave(x, z, rot));
    this.logList = d.log || [];
    this.started = true;
    this.emit('start');
    this.log('info', `Loaded day ${this.day}, ${this.timeString}.`);
    return true;
  }
}

export { SAVE_KEY, RES };

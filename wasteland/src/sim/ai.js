// AI Overseer: a utility-based planner that runs the colony on its own. Every
// quarter game-hour it reads the colony's state, scores building projects,
// places them with layout rules (homes near the fire, fields on open ground,
// towers facing the threat, a planned wall ring with a gate toward the village),
// reallocates jobs by skill with some stickiness, answers strangers and trades.
// Every decision goes to the log with the reason behind it.
import { HOUR, STRUCTURES, JOBS, RES_NAME } from './defs.js';
import { compass } from './sim.js';

const JOB_ORDER = ['guard', 'medic', 'builder', 'water', 'farmer', 'crafter', 'woodcutter', 'scavenger'];

export class Overseer {
  constructor(sim) {
    this.sim = sim;
    this.enabled = false;
    this.t = 0;
    this.said = new Map();
    this.wallPlan = null;
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.t = 0;
    if (on) this.sim.log('ai', 'Overseer online. Taking over building and job assignments (locked survivors keep their jobs).');
    else this.sim.log('ai', 'Overseer offline. You have command.');
  }

  say(key, text, hours = 6) {
    const s = this.sim;
    const last = this.said.get(key);
    if (last !== undefined && s.clock - last < hours * HOUR) return;
    this.said.set(key, s.clock);
    s.log('ai', text);
  }

  update(dt) {
    if (!this.enabled || !this.sim.started || this.sim.ended) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25 * HOUR;
    const st = this.status();
    this.#respond(st);
    const sites = st.sites.length;
    this.#build(st);
    // jobs are revisited hourly, or at once when something changes the picture
    this.jobT = (this.jobT ?? 0) - 1;
    const key = `${st.dusk}|${!!st.horde}|${!!st.threat}|${this.sim.structures.list.filter((s) => !s.built).length !== sites}|${st.alive.length}`;
    if (this.jobT <= 0 || key !== this.jobKey) { this.jobT = 4; this.jobKey = key; this.#jobs(this.status()); }
  }

  status() {
    const sim = this.sim, S = sim.structures, alive = sim.alive();
    const pop = alive.length || 1;
    const count = (t) => S.count(t, true);
    let bedsPlanned = 0;
    for (const s of S.list) if (s.def.housing) bedsPlanned += s.def.housing;
    return {
      pop, alive, armed: alive.filter((s) => s.armed).length,
      beds: sim.housing, bedsPlanned,
      foodDays: sim.res.food / (pop * 1.1), waterDays: sim.res.water / (pop * 1.5),
      res: sim.res, count, built: (t) => S.count(t), sites: S.list.filter((s) => !s.built),
      night: sim.night, hour: sim.hour, day: sim.day,
      dusk: sim.hour >= 20.25 || sim.hour < 6,
      hordeNight: sim.day >= sim.diff.hordeStart,
      horde: sim.horde && sim.horde.announced,
      injured: alive.filter((s) => s.hp < 60).length, bitten: alive.filter((s) => s.infection > 0).length,
      threat: sim.nearestInfected(sim.center, sim.colonyRadius + 30),
    };
  }

  // ---------------------------------------------------------------- building
  #build(st) {
    const sim = this.sim;
    const builders = st.alive.filter((s) => s.job === 'builder').length;
    const maxSites = Math.min(3, 1 + Math.floor(Math.max(1, builders) / 2));
    const cands = [];
    const add = (type, score, why) => cands.push({ type, score, why });
    if (!st.count('campfire')) add('campfire', 100, 'no fire: no cooked food, no light at night');
    const homeless = st.pop - st.bedsPlanned;
    if (homeless > 0) {
      const shack = st.res.wood >= 22 && st.res.scrap >= 6 && homeless >= 2;
      add(shack ? 'shack' : 'tent', 92, `${homeless} survivor${homeless > 1 ? 's' : ''} without a bed`);
    }
    if (!st.count('rain_collector') && st.waterDays < 5) add('rain_collector', 82, `water covers ${st.waterDays.toFixed(1)} days`);
    if (!st.count('well') && (st.waterDays < 3 || st.pop >= 5) && st.res.scrap >= 12) add('well', 76, `a well gives steady water for ${st.pop} survivors`);
    const farmsWanted = Math.ceil(st.pop / 3);
    if (st.count('farm') < farmsWanted && st.foodDays < 7) add('farm', 74 - st.count('farm') * 6, `food covers ${st.foodDays.toFixed(1)} days; ${st.count('farm')}/${farmsWanted} plots`);
    if (!st.count('watchtower') && st.day >= sim.diff.hordeStart - 1) add('watchtower', st.hordeNight ? 86 : 70, 'we need eyes on the approaches before the hordes grow');
    const full = Object.keys(st.res).filter((r) => st.res[r] >= sim.cap(r) * 0.85);
    if (full.length && !st.sites.some((s) => s.type === 'storage')) add('storage', 62, `${full.map((r) => RES_NAME[r].toLowerCase()).join(' and ')} near capacity`);
    if (!st.count('workshop') && st.res.ammo < 40 && (st.day >= 2 || st.res.ammo < 25)) add('workshop', st.res.ammo < 20 ? 90 : st.res.ammo < 30 ? 80 : 70, `only ${Math.floor(st.res.ammo)} rounds left; scrap can be turned into ammo`);
    if (st.built('watchtower') === 1 && !st.sites.some((q) => q.type === 'watchtower') && st.day >= 4 && st.pop >= 5) add('watchtower', 50, 'a second tower covers the far side of the camp');
    if (!st.count('infirmary') && (st.injured + st.bitten > 0 || st.pop >= 6 || st.day >= 3)) add('infirmary', st.bitten ? 84 : 64, st.bitten ? 'a bitten survivor needs care' : 'wounds heal three times faster with a medic');
    if (!st.count('generator') && st.day >= 4 && st.res.scrap >= 24 && st.res.fuel >= 4) add('generator', 46, 'power for floodlights and the radio');
    if (st.built('generator') && st.count('lamp') < 2) add('lamp', 38, 'floodlights let guards shoot straight at night');
    if (st.built('generator') && !st.count('radio')) add('radio', st.res.ammo >= 20 ? 78 : 56, 'the radio is our way out: 48 hours of broadcast brings the convoy');
    // walls once a tower stands, or when hordes are growing
    const today = this.wallsDay === st.day ? this.wallsToday : 0;
    const wallBudget = 3 + (st.hordeNight && st.hour > 12 ? 2 : 0) + (st.day >= 4 ? 1 : 0);
    if ((st.built('watchtower') || st.day >= 3) && st.res.wood >= 14 && today < wallBudget) {
      const next = this.#nextWall();
      if (next) add(next.type, 54 + (st.hordeNight && st.hour > 12 ? 20 : 0), next.type === 'gate' ? 'the wall needs a way in and out' : `extend the barricade ring (${this.wallPlan.items.filter((i) => i.done).length}/${this.wallPlan.items.length})`);
    }
    if (st.beds >= st.pop && st.res.wood > 45 && st.res.scrap > 15 && st.count('shack') < Math.ceil(st.pop / 4)) add('shack', 30, 'better beds lift morale');

    cands.sort((a, b) => b.score - a.score);
    if (st.sites.length >= maxSites && !(cands[0]?.score >= 90)) {
      if (cands.length) this.say('sites', `Holding new projects: ${st.sites.length} sites still under construction.`, 8);
      return;
    }
    this.#short = [];
    for (const c of cands.slice(0, 3)) { const d = STRUCTURES[c.type]; for (const k of Object.keys(d.cost)) if (sim.res[k] < d.cost[k] && !this.#short.includes(k)) this.#short.push(k); }
    for (const c of cands) {
      const def = STRUCTURES[c.type];
      if (!sim.canAfford(def.cost)) {
        if (c.score >= 70) {
          const miss = Object.entries(def.cost).filter(([k, v]) => sim.res[k] < v).map(([k, v]) => `${v - Math.floor(sim.res[k])} ${RES_NAME[k].toLowerCase()}`).join(', ');
          this.say('save:' + c.type, `Want a ${def.name.toLowerCase()} (${c.why}) but short ${miss}.`, 6);
          return;
        }
        continue;
      }
      const spot = c.plan || (c.type === 'barricade' || c.type === 'gate' ? this.#nextWall() : this.#findSpot(c.type));
      if (!spot) { this.say('nospot:' + c.type, `No good ground for a ${def.name.toLowerCase()} near the camp.`, 12); if (spot === null && (c.type === 'barricade' || c.type === 'gate')) this.#skipWall(); continue; }
      const r = sim.place(c.type, spot.x, spot.z, spot.rot, 'ai');
      if (!r.ok) { if (c.type === 'barricade' || c.type === 'gate') this.#skipWall(); continue; }
      if (c.type === 'barricade' || c.type === 'gate') { this.#markWall(r.s); if (this.wallsDay !== st.day) { this.wallsDay = st.day; this.wallsToday = 0; } this.wallsToday++; }
      const dir = compass(spot.x - sim.center.x, spot.z - sim.center.z);
      sim.log('ai', `Building a ${def.name.toLowerCase()} ${Math.round(Math.hypot(spot.x - sim.center.x, spot.z - sim.center.z))} m ${dir} of the fire: ${c.why}.`);
      return;
    }
  }
  #short = [];

  /** Search rings around the fire for a valid, uncluttered spot suited to the type. */
  #findSpot(type) {
    const sim = this.sim, S = sim.structures, def = STRUCTURES[type], c = sim.center;
    const pref = { tent: [6, 16], shack: [7, 18], campfire: [0, 6], rain_collector: [5, 14], well: [5, 13], farm: [14, 30], workshop: [8, 20], storage: [6, 16], infirmary: [8, 20], generator: [8, 18], radio: [12, 24], watchtower: [0, 0], lamp: [0, 0] }[type] || [8, 20];
    let r0 = pref[0], r1 = pref[1];
    const ring = sim.colonyRadius;
    if (type === 'watchtower' || type === 'lamp') { r0 = Math.max(10, ring - 3); r1 = ring + 4; }
    const wall = this.wallPlan?.radius;
    if (wall && type !== 'watchtower' && type !== 'lamp') r1 = Math.min(r1, wall - Math.max(def.w, def.d) / 2 - 2.5);
    const threat = sim.hordeDir ?? Math.atan2(-(c.x), -(c.z) + 200);
    let best = null, bs = -Infinity;
    for (let r = Math.max(r0, 3); r <= Math.max(r1, r0 + 0.1); r += 2.2) {
      const n = Math.max(8, Math.round((Math.PI * 2 * r) / 3));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r * 0.37;
        const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
        const rot = Math.atan2(c.x - x, c.z - z);
        if (!S.check(type, x, z, rot).ok) continue;
        // clearance from other structures
        let clear = true;
        for (const o of S.list) {
          const need = Math.max(def.w, def.d) / 2 + Math.max(o.def.w, o.def.d) / 2 + (o.def.nav === 'wall' || o.def.nav === 'gate' ? 1.5 : 1.4);
          if (Math.hypot(o.x - x, o.z - z) < need) { clear = false; break; }
        }
        if (!clear) continue;
        let score = -Math.abs(r - (r0 + r1) / 2) * 0.6;
        if (type === 'watchtower' || type === 'lamp') { let d = a - threat; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; score -= Math.abs(d) * 6; }
        if (type === 'farm') score -= Math.abs(sim.world.terrain.height(x, z) - sim.world.terrain.height(c.x, c.z)) * 2;
        if (score > bs) { bs = score; best = { x, z, rot: type === 'farm' ? rot + Math.PI / 2 : rot }; }
      }
      if (best && r > r0 + 6) break;
    }
    return best;
  }

  // ---------------------------------------------------------------- wall ring
  #planWalls() {
    const sim = this.sim, c = sim.center;
    // ring around the core (shelter, fire, stores, utilities); fields and towers stay outside
    let core = 8;
    for (const s of sim.structures.list) {
      if (['farm', 'watchtower', 'lamp', 'barricade', 'gate', 'radio'].includes(s.type)) continue;
      core = Math.max(core, Math.hypot(s.x - c.x, s.z - c.z) + Math.max(s.def.w, s.def.d) / 2);
    }
    const R = Math.max(14, Math.min(26, core + 4.5));
    const segs = Math.max(10, Math.round((2 * Math.PI * R) / 4));
    const Rw = (segs * 4) / (2 * Math.PI);
    // gate faces the village (average direction of scavenging sites)
    let gx = 0, gz = 0;
    for (const L of sim.lootSites) { const d = Math.hypot(L.x - c.x, L.z - c.z) || 1; gx += (L.x - c.x) / d; gz += (L.z - c.z) / d; }
    const gateA = Math.atan2(gx, gz);
    const items = [];
    for (let i = 0; i < segs; i++) {
      const a = (i + 0.5) / segs * Math.PI * 2;
      const x = c.x + Math.sin(a) * Rw, z = c.z + Math.cos(a) * Rw;
      // local +X runs along the ring (tangent), +Z faces outward
      const rot = Math.atan2(Math.sin(a), Math.cos(a));
      let d = a - gateA; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      items.push({ x, z, rot, a, type: 'barricade', gateDist: Math.abs(d), done: false, skip: false });
    }
    items.sort((p, q) => p.gateDist - q.gateDist);
    items[0].type = 'gate';
    // build order: gate first, then outward from the gate toward the threat side
    this.wallPlan = { radius: Rw, items, gate: items[0] };
    sim.log('ai', `Planned a barricade ring: ${segs} segments, ${Math.round(Rw)} m out, gate toward the village (${compass(gx, gz)}).`);
  }
  #nextWall() {
    if (!this.wallPlan) this.#planWalls();
    const p = this.wallPlan;
    const threat = this.sim.hordeDir;
    let best = null, bs = Infinity;
    for (const it of p.items) {
      if (it.done || it.skip) continue;
      if (!this.sim.structures.check(it.type, it.x, it.z, it.rot).ok) { it.skip = true; continue; }
      let score = it.type === 'gate' ? -100 : 0;
      if (threat !== undefined && threat !== null) { let d = it.a - threat; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; score += Math.abs(d) * 10; }
      else score += it.gateDist;
      if (score < bs) { bs = score; best = it; }
    }
    return best;
  }
  #skipWall() { const n = this.#nextWall(); if (n) n.skip = true; }
  #markWall(s) {
    for (const it of this.wallPlan?.items || []) if (!it.done && Math.hypot(it.x - s.x, it.z - s.z) < 0.5) { it.done = true; it.id = s.id; }
  }

  // ---------------------------------------------------------------- jobs
  #jobs(st) {
    const sim = this.sim;
    const free = st.alive.filter((s) => !s.locked && !s.possessed);
    const lockedJobs = {};
    for (const s of st.alive) if (s.locked) lockedJobs[s.job] = (lockedJobs[s.job] || 0) + 1;
    const want = {};
    const armed = st.alive.filter((s) => s.armed && !s.locked);
    const towerSlots = st.built('watchtower') * 2;
    if (st.horde) want.guard = Math.max(1, armed.length);
    else if (st.dusk && st.hordeNight) want.guard = Math.min(Math.max(armed.length, 1), Math.max(1, Math.ceil(st.pop / 3), towerSlots));
    else if (st.dusk) want.guard = Math.min(Math.max(1, armed.length), 1 + (st.pop >= 7 ? 1 : 0));
    else want.guard = st.threat ? 1 : 0;
    const repairs = sim.structures.list.some((s) => s.built && s.hp < s.maxHp * 0.7);
    want.builder = st.sites.length ? Math.min(3, st.sites.length + 1) : repairs ? 1 : 0;
    want.medic = (st.injured + st.bitten) && st.built('infirmary') ? 1 : 0;
    want.water = st.built('well') && st.waterDays < 4 ? (st.waterDays < 1.5 ? 2 : 1) : 0;
    const farms = st.built('farm');
    want.farmer = farms ? Math.min(farms, Math.ceil(farms / 2) + (st.foodDays < 2 ? 1 : 0)) : 0;
    // ammo competes with the radio for scrap: craft freely only once the mast stands
    const savingForRadio = st.built('generator') && !st.count('radio') && sim.res.ammo >= 20;
    want.crafter = st.built('workshop') && sim.res.scrap >= 6 && (sim.res.ammo < (savingForRadio ? 20 : 45)) ? 1 : 0;
    const woodNeed = 30 + st.sites.reduce((a, s) => a + (s.def.cost.wood || 0) * 0.2, 0) + (this.#short.includes('wood') ? 20 : 0);
    want.woodcutter = sim.res.wood < woodNeed ? (sim.res.wood < 12 ? 2 : 1) : 0;
    const day = sim.hour > 6.5 && sim.hour < 16;
    const scrapNeed = sim.res.scrap < 25 || sim.res.meds < 3 || sim.res.ammo < 25 || st.foodDays < 2.5 || this.#short.includes('scrap') || this.#short.includes('fuel') || (st.built('generator') && sim.res.fuel < 5);
    want.scavenger = day && !st.horde ? (scrapNeed ? (st.pop >= 6 ? 2 : 1) + (sim.res.scrap < 8 && st.pop >= 5 ? 1 : 0) : st.pop >= 5 ? 1 : 0) : 0;
    for (const j of Object.keys(want)) want[j] = Math.max(0, want[j] - (lockedJobs[j] || 0));

    // spare hands go where the shortage is
    let total = Object.values(want).reduce((a, b) => a + b, 0);
    const spare = ['builder', 'woodcutter', 'scavenger', 'farmer'];
    for (let k = 0; total < free.length && k < 12; k++) {
      const j = spare[k % spare.length];
      if (j === 'builder' && !st.sites.length) continue;
      if (j === 'scavenger' && !day) continue;
      if (j === 'farmer' && want.farmer >= farms) continue;
      want[j] = (want[j] || 0) + 1; total++;
    }

    const score = (s, j) => {
      const sk = s.skills;
      let v = { guard: (s.armed ? 3 : -5) + sk.shoot + (s.has('marksman') ? 0.6 : 0), medic: sk.med + (s.has('medic') ? 1 : 0), builder: sk.build + (s.has('handy') ? 0.5 : 0),
        water: 1 + (s.has('tough') ? 0.2 : 0), farmer: sk.farm + (s.has('greenthumb') ? 0.8 : 0), crafter: sk.craft + (s.has('handy') ? 0.4 : 0),
        woodcutter: 0.6 + sk.build * 0.4 + (s.has('tough') ? 0.3 : 0), scavenger: sk.scav + (s.armed ? 0.5 : 0) + (s.has('quick') ? 0.3 : 0) + (s.has('scrounger') ? 0.6 : 0) - (s.has('nervous') ? 0.8 : 0) - (s.hp < 60 ? 1 : 0) }[j] || 0;
      if (s.job === j) v += 0.45;
      return v;
    };
    const assign = new Map();
    const pool = new Set(free);
    const order = [...JOB_ORDER];
    if (want.crafter && sim.res.ammo < 30) { order.splice(order.indexOf('crafter'), 1); order.splice(1, 0, 'crafter'); }
    if (scrapNeed && day && !st.horde) { order.splice(order.indexOf('scavenger'), 1); order.splice(order.indexOf('builder'), 0, 'scavenger'); want.scavenger = Math.max(1, want.scavenger); }
    if (st.sites.length && want.builder > 2 && free.length < 7) want.builder = 2;
    for (const j of order) {
      for (let n = 0; n < (want[j] || 0) && pool.size; n++) {
        let best = null, bv = -Infinity;
        for (const s of pool) { const v = score(s, j); if (v > bv) { bv = v; best = s; } }
        if (!best || (j === 'guard' && !best.armed && armed.length)) break;
        assign.set(best, j); pool.delete(best);
      }
    }
    for (const s of pool) assign.set(s, s.job === 'guard' && !st.dusk ? 'idle' : (['idle'].includes(s.job) ? 'idle' : s.job));
    const changes = [];
    for (const [s, j] of assign) {
      if (s.job === j) continue;
      // do not yank someone mid-haul or mid-fight
      if (['fight', 'flee', 'treat'].includes(s.task?.kind) || s.carry) continue;
      const from = s.job;
      sim.setJob(s, j);
      changes.push(`${s.first}: ${JOBS[from].name.toLowerCase()} → ${JOBS[j].name.toLowerCase()}`);
    }
    if (changes.length) {
      const why = [];
      if (want.guard && st.dusk) why.push(st.horde ? 'horde incoming' : 'nightfall');
      if (st.sites.length) why.push(`${st.sites.length} site${st.sites.length > 1 ? 's' : ''} to build`);
      if (want.woodcutter) why.push(`wood ${Math.floor(sim.res.wood)}`);
      if (want.scavenger && scrapNeed) why.push('supplies running low');
      if (want.water) why.push(`water for ${st.waterDays.toFixed(1)} days`);
      sim.log('ai', `Reassigned ${changes.join('; ')}${why.length ? ` (${why.join(', ')})` : ''}.`);
    }
    if (st.horde) this.say('horde', `Horde inbound: every armed survivor to the perimeter, everyone else stays inside the ring.`, 10);
  }

  // ---------------------------------------------------------------- events
  #respond(st) {
    const sim = this.sim;
    const p = sim.pendingStranger;
    if (p && p.visitor.arrived) {
      const d = p.data;
      const room = st.bedsPlanned > st.pop || sim.res.wood >= 6;
      const ok = (st.foodDays > 2.2 && st.waterDays > 1.8 && room) || st.pop < 4 || (d.armed && st.foodDays > 1.2);
      const why = ok
        ? `${d.first} is a ${d.occupation.toLowerCase()}${d.armed ? ' and armed' : ''}; food lasts ${st.foodDays.toFixed(1)} days${room ? ' and there is room' : ''}`
        : `food lasts ${st.foodDays.toFixed(1)} days and water ${st.waterDays.toFixed(1)}: another mouth would sink us`;
      sim.log('ai', `${ok ? 'Accepting' : 'Turning away'} the stranger: ${why}.`);
      sim.answerStranger(ok, 'ai');
    }
    const t = sim.trader;
    if (t && t.here) {
      const need = sim.needs();
      t.offers.forEach((o, i) => {
        for (let k = 0; k < 3; k++) {
          const reserve = o.give === 'food' ? st.pop * 3 : o.give === 'wood' ? 12 : 8;
          if ((need[o.get] || 1) >= 1.4 && sim.res[o.give] - o.giveN >= reserve && o.stock > 0) sim.trade(i, 'ai');
          else break;
        }
      });
    }
    // treat bites when there is no infirmary
    for (const s of st.alive) if (s.infection > 30 && sim.res.meds > 0 && !st.built('infirmary') && s.task?.kind !== 'treat') { sim.treatNow(s); this.say('treat:' + s.id, `${s.first} was bitten: using meds now before it spreads.`, 12); }
  }
}

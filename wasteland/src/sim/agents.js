// Survivors and the infected. Both follow smoothed A* paths with collider
// push-out and separation; survivors run a needs -> threat -> job decision loop
// with small task state machines, the infected wander, investigate noise, hunt
// what they see, and break through barricades that stand in their way.
import * as THREE from 'three';
import { HOUR, STRUCTURES, LOOT_TABLE } from './defs.js';
import { F_WALL } from './nav.js';

export const isNight = (h) => h >= 21.5 || h < 5.5;
const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ------------------------------------------------------------------ movement
export class Agent {
  constructor(sim, c, navKind) {
    this.sim = sim;
    this.c = c;
    this.pos = c.root.position;
    this.navKind = navKind;
    this.path = null; this.pi = 0; this.goal = null;
    this.stuckT = 0; this.stuckP = new THREE.Vector3().copy(this.pos); this.repaths = 0;
    this.radius = 0.32;
  }

  moveTo(x, z, run = false) {
    this.goal = { x, z, run };
    this.path = this.sim.findPath(this.pos.x, this.pos.z, x, z, this.navKind);
    this.pi = 0;
    this.repaths = 0;
    this.stuckT = 0; this.stuckP.copy(this.pos);
    return !!this.path;
  }
  stop() { this.path = null; this.goal = null; this.c.speed = 0; }
  distTo(x, z) { return Math.hypot(x - this.pos.x, z - this.pos.z); }
  face(x, z) { this.c.targetYaw = Math.atan2(x - this.pos.x, z - this.pos.z); }

  /** Advance along the path. Returns 'moving' | 'arrived' | 'failed' | 'wall'. */
  follow(dt, speed) {
    if (!this.path) { this.c.speed = 0; return this.goal ? 'failed' : 'arrived'; }
    const wp = this.path[this.pi];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
    if (wp.wall !== undefined && this.navKind === 'z' && d < 1.5) {
      const s = this.sim.structures.byId.get(wp.wall);
      if (s && !(s.def.nav === 'gate' && s.extra.open)) { this.c.speed = 0; this.wallTarget = s; return 'wall'; }
    }
    const last = this.pi === this.path.length - 1;
    if (d < (last ? 0.25 : 0.45)) {
      this.pi++;
      if (this.pi >= this.path.length) { this.path = null; this.goal = null; this.c.speed = 0; return 'arrived'; }
      return 'moving';
    }
    // survivors climbing a barricade move slowly
    const cell = this.sim.nav.cellOf(this.pos.x, this.pos.z);
    const climbing = this.navKind === 's' && cell >= 0 && (this.sim.nav.flags[cell] & F_WALL);
    const v = Math.min(d, speed * (climbing ? 0.3 : 1) * dt);
    this.pos.x += (dx / d) * v; this.pos.z += (dz / d) * v;
    if (!climbing) this.sim.colliders.resolve(this.pos, this.radius);
    this.c.targetYaw = Math.atan2(dx, dz);
    this.c.speed = dt > 0 ? speed * (climbing ? 0.3 : 1) : 0;
    // stuck detection -> re-path, give up after a few tries
    this.stuckT += dt;
    if (this.stuckT > 2.5) {
      if (this.stuckP.distanceToSquared(this.pos) < 0.09) {
        if (++this.repaths > 3) { this.path = null; this.c.speed = 0; return 'failed'; }
        const g = this.goal;
        if (g) { this.path = this.sim.findPath(this.pos.x, this.pos.z, g.x, g.z, this.navKind); this.pi = 0; }
      }
      this.stuckT = 0; this.stuckP.copy(this.pos);
    }
    return 'moving';
  }
}

// ------------------------------------------------------------------ survivors
export class Survivor extends Agent {
  constructor(sim, c, d) {
    super(sim, c, 's');
    Object.assign(this, {
      id: d.id, name: d.name, first: d.first, occupation: d.occupation, traits: d.traits, skills: d.skills, seed: d.seed,
      armed: d.armed, pack: d.pack, job: d.job || 'idle', locked: !!d.locked,
      hp: d.hp ?? 100, maxHp: d.maxHp ?? 100, food: d.food ?? 80, water: d.water ?? 80, rest: d.rest ?? 85, infection: d.infection ?? 0,
      home: null, alive: true, kills: d.kills || 0, joined: d.joined ?? 1,
    });
    this.task = null;
    this.order = null;
    this.activity = 'Idle';
    this.threatT = Math.random() * 0.3;
    this.cool = 0;
    this.deadT = 0;
    this.possessed = false;
    this.carry = null;
  }

  has(t) { return this.traits.includes(t); }
  get speedWalk() { return 1.45 * (this.has('quick') ? 1.12 : 1) * (this.hp < 35 ? 0.72 : 1) * (this.carry ? 0.88 : 1); }
  get speedRun() { return 3.5 * (this.has('quick') ? 1.12 : 1) * (this.hp < 35 ? 0.7 : 1); }
  get workRate() { return this.sim.workFactor * (this.has('lazy') ? 0.8 : 1) * (this.rest < 15 ? 0.7 : 1) * (this.hp < 40 ? 0.75 : 1); }
  get onTower() { return this.task?.kind === 'guard' && this.task.tower && this.c.lift > 3; }

  // ---------------------------------------------------------------- needs
  #needs(dt) {
    const h = dt / HOUR, need = this.sim.diff.need;
    const sleeping = this.task?.kind === 'sleep' && this.task.phase === 'sleep';
    this.food -= h * 2.0 * need * (this.has('glutton') ? 1.4 : 1);
    this.water -= h * 3.0 * need;
    if (!sleeping) this.rest -= h * (this.task && ['build', 'chop', 'scavenge', 'farm', 'water', 'craft'].includes(this.task.kind) && this.task.phase === 'work' ? 4.2 : 3.0);
    // canteen and ration: nobody dies of thirst next to a full store
    if (this.water < 8 && this.sim.take('water', 1)) this.water += 40;
    if (this.food < 6 && this.sim.take('food', 1)) this.food += 35;
    if (this.food < 0) { this.food = 0; this.hurt(h * 2.2, 'starvation'); }
    if (this.water < 0) { this.water = 0; this.hurt(h * 4, 'thirst'); }
    this.rest = Math.max(0, Math.min(100, this.rest));
    if (this.infection > 0) {
      this.infection += h * 3.2;
      if (this.infection > 50) this.hurt(h * 1.5, 'infection');
      if (this.infection >= 100) this.die('infection');
    } else if (this.food > 20 && this.water > 20 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + h * 0.8);
  }

  hurt(n, cause = 'wounds', bite = 0) {
    if (!this.alive) return;
    this.hp -= n;
    if (bite > 0 && Math.random() < bite * (this.has('tough') ? 0.6 : 1)) {
      const was = this.infection;
      // a bite starts the clock (~20 game hours untreated); more bites shorten it a little
      this.infection = Math.min(80, was > 0 ? was + 8 : 28 + Math.random() * 10);
      if (!was) this.sim.alert(`${this.name} was bitten`, 'danger', this.pos, 'Treat the bite with meds before the infection takes hold.');
    }
    this.lastHurt = this.sim.clock;
    if (this.hp <= 0) this.die(cause);
  }

  die(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.task = null; this.order = null; this.carry = null; this.c.carry = null;
    this.stop();
    this.c.hidden = false; this.c.lift = 0;
    this.c.anim.set('dead');
    this.turns = cause === 'infection' || this.infection > 60;
    this.sim.onSurvivorDeath(this, cause);
  }

  get busy() { return this.task?.kind || 'idle'; }

  // ---------------------------------------------------------------- main loop
  update(dt) {
    if (!this.alive) { this.deadT += dt; return; }
    this.#needs(dt);
    if (!this.alive || this.possessed) return;
    this.cool -= dt;
    this.threatT -= dt;
    if (this.threatT <= 0) { this.threatT = 0.35; this.#threat(); }
    if (!this.task) this.task = this.#decide();
    if (this.task) {
      const done = this.#run(this.task, dt);
      if (done) {
        if (this.task.onDone) this.task.onDone();
        if (this.task.fromOrder) this.order = null;
        this.task = null;
      }
    }
  }

  // ---------------------------------------------------------------- decisions
  #threat() {
    const sim = this.sim;
    const t = this.task;
    if (t && (t.kind === 'sleep' || t.kind === 'patient' || t.kind === 'scavenge') && this.c.hidden) {
      if (!sim.alarm || t.kind === 'scavenge') return;
    }
    const tower = this.onTower;
    const guard = t?.kind === 'guard';
    let range = (guard ? 30 : 18) * (tower ? 1.4 : 1) * (sim.night && !sim.litNear(this.pos) ? 0.75 : 1) * (sim.fog > 0.5 ? 0.7 : 1);
    if (t?.kind === 'fight') range = Math.max(range, 34);
    const z = sim.nearestInfected(this.pos, range);
    if (!z) return;
    if (t && (t.kind === 'fight' || t.kind === 'flee')) return;
    const d = this.distTo(z.pos.x, z.pos.z);
    const canShoot = this.armed && sim.res.ammo > 0;
    // fire discipline: only engage the dead that are coming for us (or close), gunfire draws more
    const coming = z.target === this || z.state === 'march' || z.state === 'break' || (z.state === 'chase' && z.target && z.target.distTo?.(this.pos.x, this.pos.z) < 20);
    if (tower) { if (coming || d < 22) this.task.target = z; return; }
    if (canShoot && this.hp > 25 && (coming || d < (guard ? 22 : 12))) { this.#interrupt({ kind: 'fight', target: z, t: 0 }); return; }
    if (guard && d < 12) { this.#interrupt({ kind: 'fight', target: z, t: 0 }); return; }
    if (d < 9) {
      const brave = !this.has('nervous') && this.hp > 55 && sim.infectedNear(this.pos, 8) <= 1;
      if (brave) this.#interrupt({ kind: 'fight', target: z, t: 0 });
      else this.#interrupt({ kind: 'flee', from: z, t: 0 });
    }
  }

  #interrupt(task) {
    const cur = this.task;
    if (cur) {
      this.#release(cur);
      if (cur.fromOrder && cur.kind !== 'goto') this.order = null;
    }
    this.c.hidden = false;
    if (this.c.lift > 0 && !(cur?.kind === 'guard')) this.c.lift = 0;
    this.stop();
    this.task = task;
  }

  #release(t) {
    if (t.site) t.site.workers?.delete(this);
    if (t.tree) this.sim.treeReserved.delete(t.tree);
    if (t.slot) t.slot.taken = null;
    if (t.bed) t.bed.taken = null;
  }

  /** Cancel the current task (e.g. job change). */
  reset() {
    if (this.task) this.#release(this.task);
    this.task = null;
    this.c.hidden = false;
    this.c.lift = 0;
    this.stop();
  }

  #decide() {
    const sim = this.sim;
    this.c.hidden = false;
    if (this.order) return { ...this.order, fromOrder: true, phase: null };
    if (this.infection > 15 && sim.res.meds > 0) return { kind: 'treat', phase: null };
    if (this.water < 30 && sim.res.water > 0) return { kind: 'drink', phase: null };
    if (this.food < 30 && sim.res.food > 0) return { kind: 'eat', phase: null };
    if (this.rest < 12) return { kind: 'sleep', phase: null };
    if ((this.hp < 55 || this.infection > 0) && sim.infirmary()) return { kind: 'patient', phase: null };
    const night = sim.night;
    if (night && this.job !== 'guard' && this.rest < 90) return { kind: 'sleep', phase: null };
    if (this.job === 'guard' && !night && this.rest < 35) return { kind: 'sleep', phase: null };
    if (this.water < 55 && sim.res.water > 0 && this.distTo(sim.center.x, sim.center.z) < 30) return { kind: 'drink', phase: null };
    if (this.food < 50 && sim.res.food > 0 && this.distTo(sim.center.x, sim.center.z) < 30 && (sim.hour > 18 || sim.hour < 9)) return { kind: 'eat', phase: null };
    const j = this.#jobTask();
    return j || { kind: 'idle', phase: null, t: 0 };
  }

  #jobTask() {
    const sim = this.sim;
    switch (this.job) {
      case 'builder': {
        const site = sim.pickSite(this);
        if (site) return { kind: 'build', site, phase: null };
        const rep = sim.pickRepair(this);
        if (rep) return { kind: 'build', site: rep, repair: true, phase: null };
        return null;
      }
      case 'woodcutter': return sim.res.wood < sim.cap('wood') ? { kind: 'chop', phase: null } : null;
      case 'scavenger': {
        if (sim.hour > 17.5 || sim.hour < 6.5) return null;
        const site = sim.pickLoot(this);
        return site ? { kind: 'scavenge', loot: site, phase: null } : null;
      }
      case 'farmer': { const plot = sim.pickFarm(this); return plot ? { kind: 'farm', site: plot, phase: null } : null; }
      case 'water': { const well = sim.pickStructure('well', this); return well && sim.res.water < sim.cap('water') ? { kind: 'water', site: well, phase: null } : null; }
      case 'guard': return { kind: 'guard', phase: null };
      case 'medic': { const inf = sim.infirmary(); return inf ? { kind: 'medic', site: inf, phase: null } : null; }
      case 'crafter': { const ws = sim.pickStructure('workshop', this); return ws && sim.res.scrap >= 2 ? { kind: 'craft', site: ws, phase: null } : null; }
      default: return null;
    }
  }

  // ---------------------------------------------------------------- tasks
  /** Walk to (x, z); returns 'arrived' | 'moving' | 'failed'. */
  #go(t, x, z, run = false) {
    if (!t.moving || t.gx !== x || t.gz !== z) {
      t.moving = true; t.gx = x; t.gz = z;
      if (!this.moveTo(x, z, run)) { t.moving = false; return this.distTo(x, z) < 1.5 ? 'arrived' : 'failed'; }
    }
    const r = this.follow(t.dt, run ? this.speedRun : this.speedWalk);
    this.c.anim.set(run ? 'run' : this.c.speed > 0 ? 'walk' : 'idle');
    if (r === 'arrived' || r === 'failed') t.moving = false;
    return r === 'wall' ? 'moving' : r;
  }

  #work(kind) { this.c.anim.set('work'); this.c.anim.work = kind; this.c.speed = 0; }
  #idleAnim() { this.c.anim.set('idle'); this.c.speed = 0; }

  #run(t, dt) {
    t.dt = dt;
    const sim = this.sim, H = dt / HOUR;
    switch (t.kind) {
      case 'goto': {
        this.activity = 'Moving';
        const r = this.#go(t, t.x, t.z, !!t.run);
        if (r !== 'moving') { this.#idleAnim(); return true; }
        return false;
      }
      case 'idle': {
        this.activity = sim.night ? 'Awake at night' : 'Resting at camp';
        if (!t.phase) {
          const fire = sim.pickStructure('campfire', this);
          const seat = fire?.spots.seats?.length ? fire.spots.seats[(this.id + (sim.day | 0)) % fire.spots.seats.length] : null;
          if (seat && Math.random() < 0.7) { t.seat = seat; t.sx = seat.x + (Math.random() - 0.5) * 0.3; t.sz = seat.z + (Math.random() - 0.5) * 0.3; }
          else { const p = sim.nav.randomNear(sim.center.x, sim.center.z, 14, sim.rng) || sim.center; t.sx = p.x; t.sz = p.z; }
          t.phase = 'pick';
        }
        if (t.phase === 'pick') {
          const r = this.#go(t, t.sx, t.sz);
          if (r === 'failed') return true;
          if (r === 'arrived') { t.phase = 'stay'; t.t = t.t0 = (0.6 + Math.random() * 1.2) * HOUR; }
          return false;
        }
        if (t.seat) { this.c.anim.set('sit'); this.c.targetYaw = t.seat.yaw; } else this.#idleAnim();
        t.t -= dt;
        return t.t <= 0 || (this.job !== 'idle' && t.t < t.t0 - HOUR * 0.25);
      }
      case 'eat': case 'drink': {
        this.activity = t.kind === 'eat' ? 'Eating' : 'Drinking';
        if (!t.phase) { const d = sim.depot(this); t.dx = d.x; t.dz = d.z; t.phase = 'start'; }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') return true; if (r === 'arrived') { t.phase = 'use'; t.t = 0.25 * HOUR; } return false; }
        this.#work('carry'); t.t -= dt;
        if (t.t <= 0) {
          if (t.kind === 'eat') { if (sim.take('food', 1)) this.food = Math.min(100, this.food + 45 * (sim.cooking ? 1.2 : 1)); }
          else if (sim.take('water', 1)) this.water = Math.min(100, this.water + 50);
          return true;
        }
        return false;
      }
      case 'treat': {
        this.activity = 'Treating a bite';
        if (!t.phase) { const d = sim.depot(this); t.dx = d.x; t.dz = d.z; t.phase = 'start'; }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') return true; if (r === 'arrived') { t.phase = 'use'; t.t = 0.3 * HOUR; } return false; }
        this.#work('scavenge'); t.t -= dt;
        if (t.t <= 0) { if (sim.take('meds', 1)) { this.infection = Math.max(0, this.infection - 60); this.hp = Math.min(this.maxHp, this.hp + 10); } return true; }
        return false;
      }
      case 'sleep': {
        this.activity = 'Sleeping';
        if (!t.phase) {
          const bed = sim.bedFor(this);
          t.home = bed; t.phase = 'start';
          const p = bed ? bed.spots.door : sim.roughSpot(this);
          t.dx = p.x; t.dz = p.z;
        }
        if (t.phase === 'start') {
          const r = this.#go(t, t.dx, t.dz);
          if (r === 'failed') { t.home = null; t.phase = 'sleep'; }
          else if (r === 'arrived') t.phase = 'sleep';
          else return false;
        }
        // asleep: inside a shelter (hidden) or rough on the ground
        const rate = t.home ? (t.home.type === 'shack' ? 16 : 13) : 8;
        this.rest = Math.min(100, this.rest + H * rate);
        if (t.home) { this.c.hidden = true; this.c.speed = 0; } else { this.c.anim.set('sleep'); this.c.speed = 0; }
        const wake = this.rest >= 99 || (!sim.night && this.rest > 70 && this.job !== 'guard') || (this.job === 'guard' && sim.night && this.rest > 40);
        if (wake || this.water < 15 || this.food < 12) { this.c.hidden = false; return true; }
        return false;
      }
      case 'patient': {
        this.activity = 'In the infirmary';
        const inf = sim.infirmary();
        if (!inf) return true;
        if (!t.phase) { t.phase = 'start'; t.dx = inf.spots.door.x; t.dz = inf.spots.door.z; }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') return true; if (r === 'arrived') t.phase = 'rest'; return false; }
        this.c.hidden = true; this.c.speed = 0;
        const medic = sim.medicOnDuty(inf);
        this.hp = Math.min(this.maxHp, this.hp + H * (medic ? 9 * (medic.has('medic') ? 1.5 : 1) * medic.skills.med : 3));
        this.rest = Math.min(100, this.rest + H * 6);
        if (this.infection > 0 && medic && sim.res.meds > 0 && (t.treated || 0) < sim.clock - 0.5 * HOUR) {
          if (sim.take('meds', 1)) { this.infection = Math.max(0, this.infection - 65); t.treated = sim.clock; }
        }
        if ((this.hp >= this.maxHp * 0.92 && this.infection <= 0) || this.water < 20 || this.food < 15) { this.c.hidden = false; return true; }
        return false;
      }
      case 'build': {
        const s = t.site;
        if (!s || s.dead || (!t.repair && s.built) || (t.repair && s.hp >= s.maxHp)) return true;
        this.activity = t.repair ? `Repairing ${s.def.name.toLowerCase()}` : `Building ${s.def.name.toLowerCase()}`;
        if (!t.phase) { const p = sim.structures.approach(s, this.pos.x, this.pos.z, sim.rng); t.dx = p.x + (Math.random() - 0.5) * 0.8; t.dz = p.z + (Math.random() - 0.5) * 0.8; t.phase = 'start'; s.workers.add(this); }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') { s.workers.delete(this); return true; } if (r === 'arrived') t.phase = 'work'; return false; }
        this.face(s.x, s.z);
        this.#work('build');
        const skill = this.skills.build * (this.has('handy') ? 1.35 : 1) * this.workRate;
        if (t.repair) {
          if (sim.res.wood <= 0) return true;
          const amt = H * 60 * skill;
          sim.structures.repair(s, amt);
          t.woodAcc = (t.woodAcc || 0) + amt / 30;
          if (t.woodAcc >= 1) { t.woodAcc -= 1; sim.take('wood', 1); }
        } else sim.addWork(s, H * skill);
        if (Math.random() < dt * 0.6) sim.fx?.dust(s.x + (Math.random() - 0.5) * s.def.w * 0.6, s.y, s.z + (Math.random() - 0.5) * s.def.d * 0.6, 1, [0.5, 0.45, 0.38], 0.25);
        sim.noise('build', this.pos, dt);
        if (sim.night && this.rest < 60) { s.workers.delete(this); return true; }
        return false;
      }
      case 'chop': {
        this.activity = t.phase === 'haul' || t.phase === 'deposit' ? 'Hauling wood' : 'Felling trees';
        if (!t.phase) {
          const tree = t.tree || sim.pickTree(this);
          if (!tree) return true;
          t.tree = tree; sim.treeReserved.add(tree);
          const a = Math.atan2(this.pos.x - tree.x, this.pos.z - tree.z);
          const r = 0.55 + (tree.trunk || 0.3);
          t.dx = tree.x + Math.sin(a) * r; t.dz = tree.z + Math.cos(a) * r;
          t.phase = 'start';
        }
        if (t.phase === 'start') {
          const r = this.#go(t, t.dx, t.dz);
          if (r === 'failed') { sim.treeReserved.delete(t.tree); return true; }
          if (r === 'arrived') { t.phase = 'work'; t.t = (0.45 + 0.3 * t.tree.s) * HOUR; }
          return false;
        }
        if (t.phase === 'work') {
          this.face(t.tree.x, t.tree.z);
          this.#work('chop');
          t.t -= dt * this.workRate;
          if (Math.random() < dt * 1.8) sim.fx?.chips(t.tree.x, t.tree.y + 0.6, t.tree.z, 2);
          if (Math.random() < dt * 0.9) sim.emit('sound', 'chop', this.pos);
          sim.noise('chop', this.pos, dt);
          if (t.t <= 0) { t.wood = sim.fellTree(t.tree, this); t.phase = 'gather'; t.t = 0.3 * HOUR; }
          return false;
        }
        if (t.phase === 'gather') { this.#work('build'); t.t -= dt; if (t.t <= 0) { t.phase = 'haul'; this.carry = { res: 'wood', n: t.wood }; this.c.carry = 'wood'; } return false; }
        if (t.phase === 'haul' || t.phase === 'deposit') {
          if (t.phase === 'haul') { const d = sim.depot(this); t.hx = d.x; t.hz = d.z; t.phase = 'deposit'; }
          const r = this.#go(t, t.hx, t.hz);
          if (r === 'moving') { this.c.anim.set(this.c.speed > 0 ? 'walk' : 'idle'); return false; }
          sim.deposit(this);
          return true;
        }
        return true;
      }
      case 'scavenge': {
        const L = t.loot;
        if (!L || L.remaining <= 0) return true;
        this.activity = t.phase === 'haul' || t.phase === 'deposit' ? 'Returning with loot' : `Scavenging ${L.name}`;
        if (!t.phase) { t.phase = 'start'; t.dx = L.door.x; t.dz = L.door.z; }
        if (t.phase === 'start') {
          const r = this.#go(t, t.dx, t.dz);
          if (r === 'failed') return true;
          if (r === 'arrived') { t.phase = 'search'; t.t = (this.has('scrounger') ? 0.75 : 1.0) * HOUR; this.c.hidden = L.enter; if (!L.enter) this.#work('scavenge'); }
          return false;
        }
        if (t.phase === 'search') {
          t.t -= dt * this.workRate;
          if (!L.enter) this.#work('scavenge');
          if (t.t <= 0) {
            this.c.hidden = false;
            const got = sim.loot(L, this);
            this.carry = got; this.c.carry = 'sack';
            t.phase = 'haul';
          }
          return false;
        }
        if (t.phase === 'haul' || t.phase === 'deposit') {
          if (t.phase === 'haul') { const d = sim.depot(this); t.hx = d.x; t.hz = d.z; t.phase = 'deposit'; }
          const r = this.#go(t, t.hx, t.hz);
          if (r === 'moving') return false;
          sim.deposit(this);
          return true;
        }
        return true;
      }
      case 'farm': {
        const s = t.site;
        if (!s || s.dead) return true;
        this.activity = t.phase === 'deposit' ? 'Hauling the harvest' : s.extra.growth >= 1 ? 'Harvesting' : 'Tending crops';
        if (!t.phase) {
          const spots = s.spots.work || [s.spots.door];
          const p = spots[(this.id + Math.floor(sim.clock / HOUR)) % spots.length];
          t.dx = p.x; t.dz = p.z; t.phase = 'start';
          s.workers.add(this);
        }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') { s.workers.delete(this); return true; } if (r === 'arrived') { t.phase = 'work'; t.t = HOUR; } return false; }
        if (t.phase === 'work') {
          const harvest = s.extra.growth >= 1;
          this.#work(harvest ? 'dig' : 'farm');
          const skill = this.skills.farm * (this.has('greenthumb') ? 1.4 : 1) * this.workRate;
          if (!harvest) sim.structures.setGrowth(s, Math.min(1, s.extra.growth + H * 0.06 * skill));
          t.t -= dt * (harvest ? 2 : 1);
          if (t.t <= 0 || (!harvest && s.extra.growth >= 1)) {
            s.workers.delete(this);
            if (harvest) {
              const n = Math.round(14 * (this.has('greenthumb') ? 1.3 : 1) * (0.9 + Math.random() * 0.2));
              sim.structures.setGrowth(s, 0);
              this.carry = { res: 'food', n }; this.c.carry = 'sack';
              t.phase = 'haul';
              return false;
            }
            return true;
          }
          return false;
        }
        if (t.phase === 'haul' || t.phase === 'deposit') {
          if (t.phase === 'haul') { const d = sim.depot(this); t.hx = d.x; t.hz = d.z; t.phase = 'deposit'; }
          const r = this.#go(t, t.hx, t.hz);
          if (r === 'moving') return false;
          sim.deposit(this);
          return true;
        }
        return true;
      }
      case 'water': {
        const s = t.site;
        if (!s || s.dead) return true;
        this.activity = t.phase === 'deposit' ? 'Carrying water' : 'Drawing water';
        if (!t.phase) { const p = s.spots.work || sim.structures.approach(s, this.pos.x, this.pos.z); t.dx = p.x; t.dz = p.z; t.phase = 'start'; }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') return true; if (r === 'arrived') { t.phase = 'work'; t.t = 0.8 * HOUR; } return false; }
        if (t.phase === 'work') {
          this.face(s.x, s.z); this.#work('dig');
          t.t -= dt * this.workRate;
          if (t.t <= 0) { this.carry = { res: 'water', n: 6 }; this.c.carry = 'water'; t.phase = 'haul'; }
          return false;
        }
        if (t.phase === 'haul' || t.phase === 'deposit') {
          if (t.phase === 'haul') { const d = sim.depot(this); t.hx = d.x; t.hz = d.z; t.phase = 'deposit'; }
          const r = this.#go(t, t.hx, t.hz);
          if (r === 'moving') return false;
          sim.deposit(this);
          return true;
        }
        return true;
      }
      case 'craft': {
        const s = t.site;
        if (!s || s.dead) return true;
        this.activity = 'Making ammunition';
        if (!t.phase) { const p = s.spots.work; t.dx = p.x; t.dz = p.z; t.phase = 'start'; }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') return true; if (r === 'arrived') { t.phase = 'work'; t.acc = 0; } return false; }
        this.#work('build');
        this.face(s.x - Math.sin(s.rot) * 3, s.z - Math.cos(s.rot) * 3);
        t.acc += H * this.skills.craft * (this.has('handy') ? 1.25 : 1) * this.workRate;
        if (t.acc >= 1) {
          t.acc -= 1;
          if (sim.res.scrap >= 2 && sim.res.ammo < sim.cap('ammo')) { sim.take('scrap', 2); sim.give('ammo', 5); }
          else return true;
        }
        if (sim.night && this.rest < 70) return true;
        return false;
      }
      case 'medic': {
        const s = t.site;
        if (!s || s.dead) return true;
        this.activity = sim.patients(s) ? 'Treating the wounded' : 'On duty at the infirmary';
        if (!t.phase) { const p = s.spots.work; t.dx = p.x; t.dz = p.z; t.phase = 'start'; }
        if (t.phase === 'start') { const r = this.#go(t, t.dx, t.dz); if (r === 'failed') return true; if (r === 'arrived') t.phase = 'duty'; return false; }
        if (sim.patients(s)) this.#work('build'); else this.#idleAnim();
        this.onDuty = s;
        t.t = (t.t || 0) + dt;
        if (t.t > 3 * HOUR && !sim.patients(s)) { this.onDuty = null; return true; }
        if (sim.night && this.rest < 50 && !sim.patients(s)) { this.onDuty = null; return true; }
        return false;
      }
      case 'guard': {
        this.activity = t.tower ? 'On watch in the tower' : 'Guarding the perimeter';
        if (!t.phase) {
          const post = sim.guardPost(this);
          if (!post) return true;
          Object.assign(t, post);
          t.phase = 'start';
        }
        if (t.phase === 'start') {
          const r = this.#go(t, t.dx, t.dz, sim.night);
          if (r === 'failed') { if (t.slot) t.slot.taken = null; return true; }
          if (r === 'arrived') { t.phase = t.tower ? 'climb' : 'watch'; t.t = 0; }
          return false;
        }
        if (t.phase === 'climb') {
          t.t += dt;
          const k = Math.min(1, t.t / 3.0);
          this.c.lift = k * t.liftTo;
          this.pos.x += (t.px - this.pos.x) * Math.min(1, dt * 1.2);
          this.pos.z += (t.pz - this.pos.z) * Math.min(1, dt * 1.2);
          this.#work('build');
          if (k >= 1) t.phase = 'watch';
          return false;
        }
        // watching: scan, shoot targets in range
        const z = t.target && t.target.alive ? t.target : null;
        if (z && this.armed && sim.res.ammo > 0) {
          const d = this.distTo(z.pos.x, z.pos.z);
          const range = this.shootRange * (t.tower ? 1.5 : 1);
          if (d < range) { this.face(z.pos.x, z.pos.z); this.c.anim.set('aim'); if (this.cool <= 0) this.#shoot(z, d, range); return false; }
        }
        t.target = null;
        this.c.anim.set('work'); this.c.anim.work = 'guard'; this.c.speed = 0;
        if (t.faceX !== undefined) this.face(t.faceX, t.faceZ);
        t.t += dt;
        if (!sim.night && this.rest < 35) { this.#leaveTower(t); return true; }
        if (this.water < 25 || this.food < 22) { this.#leaveTower(t); return true; }
        if (this.job !== 'guard') { this.#leaveTower(t); return true; }
        return false;
      }
      case 'fight': {
        const z = t.target;
        this.activity = 'Fighting';
        if (!z || !z.alive) { this.#idleAnim(); return true; }
        const d = this.distTo(z.pos.x, z.pos.z);
        const canShoot = this.armed && sim.res.ammo > 0;
        t.t += dt;
        if (t.t > 40 && d > 30) return true;
        if (canShoot) {
          const range = this.shootRange;
          if (d > range * 0.85 && d < 60) {
            if (!this.path || t.retarget-- <= 0) { this.moveTo(z.pos.x, z.pos.z, true); t.retarget = 10; }
            this.follow(dt, this.speedRun); this.c.anim.set('run');
            return false;
          }
          if (d > 60) return true;
          this.stop();
          this.face(z.pos.x, z.pos.z);
          if (d < 1.7 && this.cool <= 0) { this.#melee(z); return false; }
          this.c.anim.set('aim');
          if (this.cool <= 0) this.#shoot(z, d, range);
          return false;
        }
        // melee
        if (d > 1.4) {
          if (d > 25) return true;
          if (!this.path || t.retarget-- <= 0) { this.moveTo(z.pos.x, z.pos.z, true); t.retarget = 6; }
          this.follow(dt, this.speedRun); this.c.anim.set('run');
          return false;
        }
        this.stop(); this.face(z.pos.x, z.pos.z);
        if (this.cool <= 0) this.#melee(z);
        else this.c.anim.set('attack');
        if (this.hp < 30) { this.task = { kind: 'flee', from: z, t: 0 }; }
        return false;
      }
      case 'flee': {
        this.activity = 'Running for safety';
        const z = t.from;
        if (!t.phase) {
          // toward the colony centre if the threat is not between, else directly away
          const cx = sim.center.x, cz = sim.center.z;
          const toC = Math.atan2(cx - this.pos.x, cz - this.pos.z), fromZ = z ? Math.atan2(this.pos.x - z.pos.x, this.pos.z - z.pos.z) : toC;
          let dd = toC - fromZ; while (dd > Math.PI) dd -= TAU; while (dd < -Math.PI) dd += TAU;
          const a = Math.abs(dd) < 1.2 && this.distTo(cx, cz) > 8 ? toC : fromZ;
          const tx = this.pos.x + Math.sin(a) * 14, tz = this.pos.z + Math.cos(a) * 14;
          const p = sim.nav.walkable(tx, tz) ? { x: tx, z: tz } : sim.nav.randomNear(this.pos.x, this.pos.z, 14, sim.rng) || sim.center;
          t.dx = p.x; t.dz = p.z; t.phase = 'start';
        }
        const r = this.#go(t, t.dx, t.dz, true);
        t.t += dt;
        if (r !== 'moving' || t.t > 12) {
          const still = sim.nearestInfected(this.pos, 10);
          t.n = (t.n || 0) + 1;
          if (still && t.n <= 3) { t.phase = null; t.t = 0; t.from = still; return false; }
          return true;
        }
        return false;
      }
      default: return true;
    }
  }

  #leaveTower(t) { if (t.slot) t.slot.taken = null; this.c.lift = 0; if (t.tower) { this.pos.x = t.dx; this.pos.z = t.dz; } }

  get shootRange() { return 26 * (this.has('marksman') ? 1.25 : 1) * this.skills.shoot; }

  #shoot(z, d, range) {
    const sim = this.sim;
    if (!sim.take('ammo', 1)) return;
    this.cool = 1.3 + Math.random() * 0.6;
    const lit = !sim.night || this.onTower || sim.litNear(z.pos) || sim.litNear(this.pos);
    let p = (0.95 - (d / range) * 0.55) * this.skills.shoot * (this.has('marksman') ? 1.2 : 1) * (lit ? 1 : 0.65) * (this.onTower ? 1.1 : 1);
    p = Math.max(0.12, Math.min(0.95, p));
    const hit = Math.random() < p;
    sim.gunshot(this, z, hit);
    if (hit) {
      const head = Math.random() < 0.16 * this.skills.shoot * (this.has('marksman') ? 1.5 : 1);
      z.damage(head ? 999 : 30 + Math.random() * 28, this);
    }
  }

  #melee(z) {
    this.cool = 1.1 + Math.random() * 0.4;
    this.c.anim.set('attack');
    if (Math.random() < 0.7) z.damage(14 + Math.random() * 12, this);
    this.sim.noise('melee', this.pos, 0.2);
  }
}

// ------------------------------------------------------------------ the infected
export class Infected extends Agent {
  constructor(sim, c, d) {
    super(sim, c, 'z');
    this.id = d.id;
    this.hp = d.hp ?? 60 * sim.diff.infectedHp;
    this.maxHp = 60 * sim.diff.infectedHp;
    this.alive = true;
    this.horde = !!d.horde;
    this.state = d.horde ? 'march' : 'wander';
    this.target = null;
    this.senseT = Math.random() * 0.5;
    this.cool = 0;
    this.wanderT = 0;
    this.deadT = 0;
    this.radius = 0.3;
    this.speedMul = (0.9 + Math.random() * 0.2) * sim.diff.infectedSpeed;
    this.groanT = Math.random() * 10;
  }

  damage(n, by) {
    if (!this.alive) return;
    this.hp -= n;
    this.sim.fx?.blood(this.pos.x, this.pos.y + 1.3, this.pos.z);
    if (by && this.state !== 'attack') { this.target = by; this.state = 'chase'; }
    if (this.hp <= 0) this.die(by);
  }

  die(by) {
    this.alive = false;
    this.stop();
    this.c.anim.set('dead');
    if (by && by.kills !== undefined) by.kills++;
    this.sim.onInfectedDeath(this, by);
  }

  update(dt) {
    const sim = this.sim;
    if (!this.alive) {
      this.deadT += dt;
      if (this.deadT > 25) this.c.sink = Math.min(1.6, (this.deadT - 25) * 0.12);
      return;
    }
    this.cool -= dt;
    this.senseT -= dt;
    this.groanT -= dt;
    if (this.groanT <= 0) { this.groanT = 6 + Math.random() * 14; sim.onGroan?.(this); }
    const night = sim.night;
    if (this.senseT <= 0) {
      this.senseT = 0.5;
      const sense = (night ? 24 : 17) * (sim.fog > 0.5 ? 0.65 : 1) * (this.horde ? 1.3 : 1);
      const s = sim.nearestSurvivor(this.pos, sense, true);
      if (s && (this.state !== 'chase' || this.target !== s)) { this.target = s; this.state = 'chase'; this.repathT = 0; }
      if (!s && this.state === 'chase' && (!this.target || !this.target.alive || this.distTo(this.target.pos.x, this.target.pos.z) > sense * 1.6)) {
        this.target = null; this.state = this.horde ? 'march' : 'wander'; this.stop();
      }
    }
    const walk = 0.62 * this.speedMul, chase = (night ? 2.3 : 1.85) * this.speedMul, march = 1.05 * this.speedMul;
    switch (this.state) {
      case 'leave': {
        if (!this.path) { const a = sim.hordeDir ?? Math.random() * 6.28; const p = sim.nav.randomNear(sim.center.x + Math.sin(a) * 175, sim.center.z + Math.cos(a) * 175, 20, sim.rng, 'z'); if (!p || !this.moveTo(p.x, p.z)) { this.state = 'wander'; break; } }
        const r = this.follow(dt, walk * 1.3);
        this.c.anim.set('walk');
        if (r !== 'moving') { this.state = 'wander'; this.despawn = true; }
        break;
      }
      case 'wander': {
        this.wanderT -= dt;
        // the smell of sleepers draws them to occupied shelters
        if (sim.night && Math.random() < dt * 0.1) {
          const sh = sim.occupiedShelterNear(this.pos, 26);
          if (sh) { this.wallTarget = sh; this.state = 'break'; this.stop(); break; }
        }
        if (this.wanderT <= 0 || !this.path) {
          if (this.wanderT <= 0) {
            this.wanderT = 8 + Math.random() * 14;
            if (Math.random() < 0.35) { this.stop(); this.c.anim.set('idle'); break; }
            const p = sim.nav.randomNear(this.pos.x, this.pos.z, 22, sim.rng, 'z');
            if (p && Math.hypot(p.x - sim.center.x, p.z - sim.center.z) > 40) this.moveTo(p.x, p.z);
          }
        }
        if (this.path) { const r = this.follow(dt, walk); this.c.anim.set(this.c.speed > 0 ? 'walk' : 'idle'); if (r === 'wall') this.state = 'break'; }
        else this.c.anim.set('idle');
        break;
      }
      case 'investigate': {
        if (!this.path) { const g = this.noiseAt; if (!g || !this.moveTo(g.x, g.z)) { this.state = 'wander'; break; } this.noiseAt = null; }
        const r = this.follow(dt, march * 1.2);
        this.c.anim.set('walk');
        if (r === 'arrived' || r === 'failed') this.state = this.horde ? 'march' : 'wander';
        if (r === 'wall') this.state = 'break';
        break;
      }
      case 'march': {
        if (!this.path) { if (!this.moveTo(sim.center.x + (Math.random() - 0.5) * 10, sim.center.z + (Math.random() - 0.5) * 10)) { this.state = 'wander'; break; } }
        const r = this.follow(dt, march);
        this.c.anim.set('walk');
        if (r === 'wall') this.state = 'break';
        else if (r === 'arrived' || r === 'failed') { this.stop(); this.state = 'wander'; this.wanderT = 0; }
        break;
      }
      case 'chase': {
        const t = this.target;
        if (!t || !t.alive) { this.state = this.horde ? 'march' : 'wander'; this.stop(); break; }
        const d = this.distTo(t.pos.x, t.pos.z);
        const reachable = !t.onTower && !t.c.hidden;
        if (reachable && d < 1.25) { this.stop(); this.face(t.pos.x, t.pos.z); this.state = 'attack'; break; }
        this.repathT = (this.repathT || 0) - dt;
        if (!this.path || this.repathT <= 0) {
          this.repathT = d < 12 ? 0.8 : 2;
          if (t.onTower && t.task?.site) {
            // cannot climb: go for the tower itself
            this.wallTarget = t.task.site; this.state = 'break'; this.stop(); break;
          }
          this.moveTo(t.pos.x, t.pos.z, true);
        }
        const r = this.follow(dt, chase);
        this.c.anim.set(this.c.speed > 1.2 ? 'walk' : 'idle');
        this.c.speed = Math.min(this.c.speed, 1.6);
        if (r === 'wall') this.state = 'break';
        break;
      }
      case 'attack': {
        const t = this.target;
        if (!t || !t.alive || t.c.hidden || t.onTower) { this.state = 'chase'; break; }
        const d = this.distTo(t.pos.x, t.pos.z);
        if (d > 1.6) { this.state = 'chase'; break; }
        this.face(t.pos.x, t.pos.z);
        this.c.anim.set('attack');
        if (this.cool <= 0) {
          this.cool = 1.35 + Math.random() * 0.4;
          if (Math.random() < 0.72) t.hurt((7 + Math.random() * 6) * sim.diff.damage, 'the infected', 0.2);
        }
        break;
      }
      case 'break': {
        const s = this.wallTarget;
        if (!s || s.dead || s.hp <= 0 || (s.def.nav === 'gate' && s.extra.open)) { this.wallTarget = null; this.state = this.target ? 'chase' : this.horde ? 'march' : 'wander'; this.stop(); break; }
        // move up to the structure edge, then batter it
        const dx = s.x - this.pos.x, dz = s.z - this.pos.z;
        const near = sim.structures.at(this.pos.x, this.pos.z, 1.2) === s || Math.hypot(dx, dz) < Math.max(s.def.w, s.def.d) * 0.5 + 1.2;
        if (!near) {
          if (!this.path) this.moveTo(s.x, s.z);
          const r = this.follow(dt, walk * 1.5);
          this.c.anim.set('walk');
          if (r === 'failed') { this.wallTarget = null; this.state = 'wander'; }
          break;
        }
        this.stop();
        this.face(s.x, s.z);
        this.c.anim.set('attack');
        if (this.cool <= 0) {
          this.cool = 1.3 + Math.random() * 0.5;
          sim.structures.damage(s, 9 * sim.diff.damage);
          sim.onStructureHit?.(s, this);
          // stakes and splintered planks cut the ones battering a wall
          if (s.def.nav === 'wall' || s.def.nav === 'gate') this.damage(s.def.nav === 'wall' ? 3 : 2, null);
          if (Math.random() < 0.4) sim.fx?.chips(this.pos.x + dx * 0.2, this.pos.y + 1, this.pos.z + dz * 0.2, 2);
        }
        break;
      }
    }
    // separation from other infected (cheap, local)
    sim.separate(this);
  }

  hear(x, z, strength) {
    if (!this.alive || this.state === 'chase' || this.state === 'attack' || this.state === 'break') return;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > strength) return;
    this.noiseAt = { x: x + (Math.random() - 0.5) * 8, z: z + (Math.random() - 0.5) * 8 };
    this.state = 'investigate';
    this.stop();
  }
}

export { _v, _w, STRUCTURES, LOOT_TABLE };

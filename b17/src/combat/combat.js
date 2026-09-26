// Bombs, machine-gun projectiles, turrets, flak and fighter AI.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeFlakGunTop } from '../world/industrial.js';
import { buildFw190 } from '../aircraft/fw190.js';
import { Aircraft } from '../aircraft/flight.js';

const G = 9.81;
const BOMB_K = G / (290 * 290);   // AN-M64 500 lb terminal velocity ~290 m/s
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const rnd = Math.random;
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ------------------------------------------------------------------ bombs
export class Bombs {
  constructor(scene, geom, mat, hf, buildings, fx, audio) {
    this.list = [];
    this.hf = hf; this.B = buildings; this.fx = fx; this.audio = audio;
    this.mesh = new THREE.InstancedMesh(geom, mat, 64);
    this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.onImpact = null;
  }

  drop(pos, vel, owner) {
    // release disturbance + ballistic dispersion (rack ejection, fin misalignment)
    const v = vel.clone().add(new THREE.Vector3(gauss() * 1.6, gauss() * 0.6, gauss() * 1.6));
    this.list.push({ pos: pos.clone(), vel: v, owner, t: 0, k: 1 + gauss() * 0.04 });
    this.audio?.bombRelease?.();
  }

  static integrate(pos, vel, dt, k = 1) {
    const s = vel.length();
    vel.y -= G * dt;
    vel.addScaledVector(vel, -BOMB_K * k * s * dt);
    pos.addScaledVector(vel, dt);
  }

  // predict impact point from a release state
  predict(pos, vel, hf, out) {
    const p = _a.copy(pos), v = _b.copy(vel);
    let t = 0;
    for (let i = 0; i < 1200; i++) {
      Bombs.integrate(p, v, 0.05); t += 0.05;
      if (p.y <= hf.height(p.x, p.z)) break;
    }
    out.copy(p); out.y = hf.height(p.x, p.z);
    return t;
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      b.t += dt;
      const steps = 3;
      for (let k = 0; k < steps; k++) Bombs.integrate(b.pos, b.vel, dt / steps, b.k);
      const gy = this.hf.height(b.pos.x, b.pos.z);
      const by = this.B.heightAt(b.pos.x, b.pos.z);
      if (b.pos.y <= Math.max(gy, by)) {
        b.pos.y = Math.max(gy, by);
        this.detonate(b);
        L.splice(i, 1);
      }
    }
    let n = 0;
    for (const b of L) {
      if (n >= 64) break;
      _q.setFromUnitVectors(_v.set(0, 0, 1), _a.copy(b.vel).normalize());
      this.mesh.setMatrixAt(n++, _m.compose(b.pos, _q, _b.set(1, 1, 1)));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  detonate(b) {
    const inWater = b.pos.y < 200.6 && this.hf.height(b.pos.x, b.pos.z) < 199;
    this.fx.explosion(b.pos, 1, !inWater);
    if (inWater) this.fx.emitter({ kind: 'steam', pos: b.pos.clone().setY(201), life: 3, rate: 8, scale: 3 });
    const destroyed = this.B.blast(b.pos, 34, 2.2);
    this.onImpact?.(b, destroyed);
  }
}

// ------------------------------------------------------------------ projectiles
export class Guns {
  constructor(fx, audio) {
    this.fx = fx; this.audio = audio;
    this.list = [];
  }

  fire(origin, dir, speed, spread, owner, dmg, tracer, color) {
    const d = _v.copy(dir);
    d.x += gauss() * spread; d.y += gauss() * spread; d.z += gauss() * spread;
    d.normalize();
    const vel = d.clone().multiplyScalar(speed);
    if (owner.vel) vel.add(owner.vel);
    this.list.push({ p: origin.clone(), v: vel, t: 0, owner, dmg, tracer, color });
  }

  update(dt, targets) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      b.t += dt;
      const p0x = b.p.x, p0y = b.p.y, p0z = b.p.z;
      b.v.y -= G * dt;
      b.p.addScaledVector(b.v, dt);
      if (b.tracer && b.t > 0.03) {
        const k = 0.018;
        this.fx.tracer(b.p.x - b.v.x * k, b.p.y - b.v.y * k, b.p.z - b.v.z * k, b.p.x, b.p.y, b.p.z, b.color);
      }
      let hit = false;
      for (const t of targets) {
        if (!t.alive || t === b.owner || t.side === b.owner.side) continue;
        // segment-sphere
        const cx = t.pos.x - p0x, cy = t.pos.y - p0y, cz = t.pos.z - p0z;
        const sx = b.p.x - p0x, sy = b.p.y - p0y, sz = b.p.z - p0z;
        const L2 = sx * sx + sy * sy + sz * sz;
        const u = Math.max(0, Math.min(1, (cx * sx + cy * sy + cz * sz) / L2));
        const dx = cx - sx * u, dy = cy - sy * u, dz = cz - sz * u;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < t.radius * t.radius) {
          // sample the part of the segment inside the bounding sphere against the real shape
          const half = Math.sqrt(t.radius * t.radius - d2) / Math.sqrt(L2);
          for (let k = 0; k <= 10; k++) {
            const uu = Math.max(0, Math.min(1, u - half + (2 * half) * k / 10));
            if (t.hitTest(_a.set(p0x + sx * uu, p0y + sy * uu, p0z + sz * uu))) {
              t.damage(b.dmg, _a, b.owner);
              hit = true; break;
            }
          }
          if (hit) break;
        }
      }
      if (hit || b.t > 2.4) { L[i] = L[L.length - 1]; L.pop(); }
    }
  }
}

// ------------------------------------------------------------------ bomber wrapper (player + wingmen)
export class Bomber {
  constructor(model, flight, opts = {}) {
    this.model = model; this.fl = flight;
    this.side = 'allied';
    this.radius = 17;
    this.alive = true;
    this.player = !!opts.player;
    this.name = opts.name || 'B-17';
    this.bombs = 12;
    this.parts = { wingL: 1, wingR: 1, tail: 1, fus: 1 };
    this.extinguishers = 2;
    this.fires = [];
    this.gunCooldown = {};
    this.doorOpen = 0;
    this.doorTarget = 0;
    this.kills = 0;
    this.hitsTaken = 0;
  }
  get pos() { return this.fl.pos; }
  get vel() { return this.fl.vel; }

  hitTest(p) {
    // approximate cruciform shape in body space
    _q.copy(this.fl.quat).invert();
    const l = _b.copy(p).sub(this.fl.pos).applyQuaternion(_q);
    const fus = Math.abs(l.x) < 1.6 && Math.abs(l.y) < 1.8 && l.z > -14 && l.z < 9.5;
    const wing = Math.abs(l.x) < 16 && Math.abs(l.y + 0.3 - Math.abs(l.x) * 0.08) < 0.9 && l.z > -5 && l.z < 2.5;
    const tail = l.z < -9.5 && l.z > -14 && (Math.abs(l.x) < 7 && Math.abs(l.y - 0.4) < 0.6 || Math.abs(l.x) < 0.5 && l.y < 5 && l.y > 0);
    this._hitLocal = l.clone();
    return fus || wing || tail;
  }

  damage(dmg, p, from) {
    if (!this.alive) return;
    this.hitsTaken++;
    const l = this._hitLocal || new THREE.Vector3();
    this.applyLocal(l, dmg);
  }

  applyLocal(l, dmg) {
    const eng = this.fl.engines;
    const ex = [4.7, 9.25, -4.7, -9.25];
    if (Math.abs(l.x) > 2 && l.z > -5) {
      // wing hit: engines take most damage when close
      let best = -1, bd = 3.2;
      ex.forEach((x, i) => { const d = Math.abs(l.x - x); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) {
        const e = eng[best];
        e.hp -= dmg * 1.6;
        if (e.hp <= 0.35 && !e.fire && rnd() < 0.25 + dmg) this.startFire(best);
        if (e.hp <= 0) { e.hp = 0; e.running = false; }
      }
      this.parts[l.x > 0 ? 'wingL' : 'wingR'] -= dmg * 0.5;
    } else if (l.z < -9.5) this.parts.tail -= dmg * 0.6;
    else this.parts.fus -= dmg * 0.45;
    this.onDamaged?.();
  }

  startFire(i) {
    const e = this.fl.engines[i];
    e.fire = 1;
    this.onFire?.(i);
  }

  extinguish() {
    if (this.extinguishers <= 0) return false;
    let any = false;
    this.fl.engines.forEach(e => { if (e.fire) { e.fire = 0; e.running = false; e.feathered = true; any = true; } });
    if (any) this.extinguishers--;
    return any;
  }

  // integrity summary 0..1
  integrity() {
    const p = this.parts;
    return Math.max(0, Math.min(p.wingL, p.wingR, p.tail, p.fus));
  }

  update(dt) {
    const eng = this.fl.engines;
    let burning = 0, dead = 0;
    eng.forEach((e, i) => {
      if (e.fire) { burning++; e.hp -= dt * 0.02; this.parts[i < 2 ? 'wingL' : 'wingR'] -= dt * 0.012; if (e.hp <= 0) { e.hp = 0; e.running = false; } }
      if (!e.running || e.hp <= 0) dead++;
    });
    const wing = Math.min(this.parts.wingL, this.parts.wingR);
    this.fl.dragExtra = (1 - this.integrity()) * 0.02 + dead * 0.004;
    this.fl.liftLoss = Math.max(0, 0.4 - wing) * 1.2;
    if (this.integrity() <= 0 || dead >= 4) this.alive = false;
    this.burning = burning;
    this.deadEngines = dead;
  }
}

// ------------------------------------------------------------------ turret gunnery
export class Gunnery {
  constructor(guns, fx, audio) { this.guns = guns; this.fx = fx; this.audio = audio; this._t = 0; }

  // aimPoint: for the player when firing, else null -> AI picks fighters
  update(dt, bomber, fighters, aimPoint, playerFiring, isPlayer) {
    if (!bomber.alive) return;
    const T = bomber.model.turrets;
    const q = bomber.fl.quat;
    const iq = _q.copy(q).invert();
    for (const [name, t] of Object.entries(T)) {
      // choose target
      let tgt = null, lead = null;
      const base = _a.copy(t.base).applyQuaternion(q).add(bomber.pos);
      if (isPlayer && playerFiring && aimPoint) {
        lead = aimPoint;
      } else {
        let best = 1100;
        for (const f of fighters) {
          if (!f.alive || f.dying) continue;
          const d = f.pos.distanceTo(base);
          if (d < best) {
            const tof = d / 880;
            const lp = f.pos.clone().addScaledVector(f.vel, tof).addScaledVector(bomber.vel, -tof);
            const lcl = lp.clone().sub(base).applyQuaternion(iq);
            const yaw = Math.atan2(lcl.x, lcl.z), pit = Math.atan2(lcl.y, Math.hypot(lcl.x, lcl.z));
            if (inArc(t, yaw, pit)) { best = d; tgt = f; lead = lp; }
          }
        }
      }
      if (!lead) { t.firing = false; slew(t, t.restYaw ?? 0, 0, dt); continue; }
      const lcl = _b.copy(lead).sub(base).applyQuaternion(iq);
      let yaw = Math.atan2(lcl.x, lcl.z), pit = Math.atan2(lcl.y, Math.hypot(lcl.x, lcl.z));
      const ok = inArc(t, yaw, pit);
      if (!ok) { t.firing = false; if (!isPlayer || !playerFiring) slew(t, t.restYaw ?? 0, 0, dt); continue; }
      const err = slew(t, yaw, pit, dt);
      const shouldFire = err < 0.06 && (isPlayer && playerFiring ? true : (tgt && tgt.pos.distanceTo(base) < 900 && rnd() < 0.85));
      t.firing = shouldFire;
      if (shouldFire) {
        t.cool = (t.cool || 0) - dt;
        while (t.cool <= 0) {
          t.cool += 1 / 12;
          for (const mz of t.muzzles) {
            const o = mz.getWorldPosition(new THREE.Vector3());
            const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(mz.getWorldQuaternion(new THREE.Quaternion()));
            t.shot = (t.shot || 0) + 1;
            this.guns.fire(o, dir, 870, isPlayer && playerFiring ? 0.006 : 0.017, bomber, 0.06, t.shot % 3 === 0, [1.0, 0.75, 0.35]);
          }
          if (isPlayer) this.audio?.gun?.(name);
        }
      }
    }
  }
}

function inArc(t, yaw, pit) {
  if (pit < t.pitchMin || pit > t.pitchMax) return false;
  let y = yaw;
  if (t.yawMin <= -Math.PI && t.yawMax >= Math.PI) return true;
  // normalise into [yawMin, yawMin+2pi)
  while (y < t.yawMin) y += Math.PI * 2;
  while (y > t.yawMin + Math.PI * 2) y -= Math.PI * 2;
  return y <= t.yawMax;
}

function slew(t, yaw, pit, dt) {
  const rate = 1.4 * dt;
  let dy = yaw - t.aimYaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  t.aimYaw += Math.max(-rate, Math.min(rate, dy));
  t.aimPitch += Math.max(-rate, Math.min(rate, pit - t.aimPitch));
  t.yaw.rotation.y = t.aimYaw;
  t.pitch.rotation.x = -t.aimPitch;
  return Math.abs(dy) + Math.abs(pit - t.aimPitch);
}

// ------------------------------------------------------------------ flak
export class Flak {
  constructor(scene, env, materials, guns88, fx, audio) {
    this.fx = fx; this.audio = audio;
    this.guns = guns88;
    this.pending = [];
    const top = makeFlakGunTop().build();
    this.tops = [];
    for (const g of guns88) {
      const grp = new THREE.Group();
      grp.position.set(g.x, g.y, g.z);
      const pitch = new THREE.Group(); pitch.position.y = 0.4; grp.add(pitch);
      for (const [k, geo] of top) { const m = new THREE.Mesh(geo, materials[k]); m.castShadow = true; pitch.add(m); }
      scene.add(grp);
      g.grp = grp; g.pitch = pitch; g.cool = 2 + rnd() * 6;
    }
    this.intensity = 1;
  }

  update(dt, bombers, time) {
    for (const g of this.guns) {
      if (!g.rec.alive) { g.grp.visible = false; continue; }
      let tgt = null, best = 8500;
      for (const b of bombers) { if (!b.alive) continue; const d = b.pos.distanceTo(_v.set(g.x, g.y, g.z)); if (d < best && b.pos.y - g.y > 400) { best = d; tgt = b; } }
      if (!tgt) continue;
      const tof = best / 650 + 1.0;
      const aim = _a.copy(tgt.pos).addScaledVector(tgt.vel, tof);
      const dx = aim.x - g.x, dz = aim.z - g.z;
      g.grp.rotation.y = Math.atan2(dx, dz);
      g.pitch.rotation.x = -Math.atan2(aim.y - g.y, Math.hypot(dx, dz));
      g.cool -= dt;
      if (g.cool <= 0) {
        g.cool = 3.5 + rnd() * 2.5;
        // predicted fuze point with range-dependent error
        const sigma = 35 + best * 0.012;
        const p = aim.clone().add(new THREE.Vector3(gauss() * sigma, gauss() * sigma * 0.7, gauss() * sigma));
        this.pending.push({ t: time + tof, p });
        this.fx.fire.spawn({ x: g.x + Math.sin(g.grp.rotation.y) * 6, y: g.y + 3, z: g.z + Math.cos(g.grp.rotation.y) * 6, vx: 0, vy: 0, vz: 0, drag: 0, lift: 0, age: 0, life: 0.12, s0: 5, s1: 8, a: 3, hold: 0.2, rot: 0, spin: 0, v: 0, c0: [3, 2, 1] });
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      if (time < e.t) continue;
      this.pending.splice(i, 1);
      this.fx.flak(e.p);
      for (const b of bombers) {
        if (!b.alive) continue;
        const d = b.pos.distanceTo(e.p);
        if (d < 42) {
          const dmg = 0.5 * (1 - d / 42) ** 2;
          _q.copy(b.fl.quat).invert();
          const l = e.p.clone().sub(b.pos).applyQuaternion(_q).clampLength(0, 12);
          b.applyLocal(l, dmg);
          b.flakHit = Math.max(b.flakHit || 0, 1 - d / 42);
        }
        if (b.player) this.audio?.flak?.(d);
      }
    }
  }
}

// ------------------------------------------------------------------ fighters
export class Fighter {
  constructor(scene, env, pos, vel) {
    const m = buildFw190(env);
    this.model = m;
    this.root = m.root;
    scene.add(this.root);
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.quat = new THREE.Quaternion();
    this.side = 'axis';
    this.radius = 7;
    this.alive = true;
    this.hp = 1;
    this.state = 'approach';
    this.stateT = 0;
    this.speed = 150;
    this.bank = 0;
    this.cool = 0;
    this.attackKind = rnd() < 0.55 ? 'head' : 'tail';
  }

  hitTest(p) {
    _q.copy(this.quat).invert();
    const l = _b.copy(p).sub(this.pos).applyQuaternion(_q);
    return (Math.abs(l.x) < 5.3 && Math.abs(l.y + 0.3) < 0.7 && Math.abs(l.z) < 1.5) || (Math.abs(l.x) < 0.8 && Math.abs(l.y) < 0.9 && Math.abs(l.z) < 4.6);
  }

  damage(dmg, p, from) {
    if (this.dying) return;
    this.hp -= dmg;
    this.hitFlash = 0.1;
    if (this.hp <= 0) { this.dying = true; this.killer = from; this.onKilled?.(this, from); }
    else if (this.hp < 0.45 && !this.smoking) { this.smoking = true; this.onSmoke?.(this); }
  }

  update(dt, target, guns, hf, audio) {
    this.stateT += dt;
    const desired = _v.set(0, 0, 0);
    let spd = this.speed;
    if (this.dying) {
      // spiral down
      this.vel.y -= 9.81 * dt * 0.8;
      this.bank += dt * 2.5;
      const f = this.vel.clone().normalize();
      this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f);
      this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank));
      this.pos.addScaledVector(this.vel, dt);
      this.root.position.copy(this.pos); this.root.quaternion.copy(this.quat);
      this.model.prop.rotation.z += dt * 20;
      if (this.pos.y <= hf.height(this.pos.x, this.pos.z) + 1) { this.alive = false; this.crashed = true; }
      return;
    }
    this.firing = false;
    if (!target || !target.alive) { desired.copy(this.vel).setY(0).normalize(); }
    else {
      const tp = target.pos, tv = target.vel;
      const tf = _a.copy(tv).normalize();
      if (this.state === 'approach') {
        // get into a firing position: ahead & above for head-on, behind & above for tail attacks
        const off = this.attackKind === 'head' ? 2400 : -900;
        const side = (this.id % 2 ? 1 : -1) * 350;
        const set = _b.copy(tp).addScaledVector(tf, off).add(new THREE.Vector3(-tf.z * side, 350, tf.x * side));
        desired.copy(set).sub(this.pos);
        const d = desired.length();
        desired.normalize();
        if (d < 800 || this.stateT > 25) { this.state = 'attack'; this.stateT = 0; }
        spd = this.attackKind === 'tail' ? 175 : 150;
      } else if (this.state === 'attack') {
        const d = this.pos.distanceTo(tp);
        const tof = d / 800;
        const lead = _b.copy(tp).addScaledVector(tv, tof * 0.9);
        desired.copy(lead).sub(this.pos).normalize();
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
        if (d < 750 && fwd.dot(desired) > 0.9985) {
          this.cool -= dt;
          if (this.cool <= 0) {
            this.cool = 0.09;
            const o = this.pos.clone().addScaledVector(fwd, 4);
            guns.fire(o, fwd, 800, 0.012, this, 0.035, rnd() < 0.5, [1.0, 0.5, 0.25]);
            this.firing = true;
            if (target.player && rnd() < 0.3) audio?.enemyGun?.(d);
          }
        } else this.firing = false;
        if (d < 170 || this.stateT > 40) { this.state = 'break'; this.stateT = 0; this.breakDir = new THREE.Vector3((rnd() - 0.5) * 2, -0.8, (rnd() - 0.5) * 2).normalize(); }
      } else {
        desired.copy(this.breakDir).add(_b.copy(this.vel).normalize().multiplyScalar(0.8)).normalize();
        spd = 190;
        if (this.stateT > 5) { this.state = 'approach'; this.stateT = 0; this.attackKind = rnd() < 0.55 ? 'head' : 'tail'; }
      }
    }
    // keep above ground
    const gy = hf.height(this.pos.x, this.pos.z);
    if (this.pos.y < gy + 250) desired.y = Math.max(desired.y, 0.5);
    // turn towards desired with limited rate
    const cur = _a.copy(this.vel).normalize();
    const turn = Math.min(1, dt * 0.9 / Math.max(0.05, cur.angleTo(desired)));
    const nd = cur.clone().lerp(desired, turn).normalize();
    // bank into turns
    const cross = cur.clone().cross(nd);
    const targetBank = THREE.MathUtils.clamp(-cross.y * 40, -1.3, 1.3);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 3);
    const s = this.vel.length() + (spd - this.vel.length()) * Math.min(1, dt * 0.5);
    this.vel.copy(nd).multiplyScalar(s);
    this.pos.addScaledVector(this.vel, dt);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nd);
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.bank));
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.model.prop.rotation.z += dt * 38;
  }

  dispose(scene) { scene.remove(this.root); }
}

export { Aircraft, mergeGeometries };

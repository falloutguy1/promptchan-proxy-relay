import * as THREE from 'three';
import { Particles } from './Effects.js';
import { V, Batch, rbox, cyl } from '../engine/geom.js';
import { LAYER_NO_AO } from '../engine/Renderer.js';

const G = 9.81;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Sea-trial gunnery: turrets train and elevate toward an aim point using a drag-free ballistic
 * solution (gameplay muzzle velocity), fire salvos with recoil, and score hits on target rafts.
 */
export class Gunnery {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'gunnery';
    this.smoke = new Particles(1600, { name: 'smoke' });
    this.spray = new Particles(2600, { name: 'spray' });
    this.flash = new Particles(300, { additive: true, name: 'flash' });
    this.group.add(this.smoke.mesh, this.spray.mesh, this.flash.mesh);
    this.shells = [];
    this.tracer = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.25, 3, 2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.2), toneMapped: false }), 128);
    this.tracer.count = 0; this.tracer.frustumCulled = false; this.tracer.layers.set(LAYER_NO_AO);
    this.group.add(this.tracer);
    this.aim = new THREE.Vector3(0, 0, 2000);
    this.aimValid = false;
    this.targets = this.buildTargets();
    this.score = { shots: 0, hits: 0, salvos: 0 };
    this.raycaster = new THREE.Raycaster();
    this.trialTime = 0;
    this.log = [];
  }

  buildTargets() {
    const m = this.game.lib;
    const pont = m.plain('target-pontoon', 0x3b3f42, 0.6, 0.4);
    const frame = m.plain('target-frame', 0x9b8c6f, 0.8, 0);
    const canvasM = new THREE.MeshStandardMaterial({ name: 'target-screen', color: 0xe9e2cf, roughness: 0.9, side: THREE.DoubleSide });
    const redM = new THREE.MeshStandardMaterial({ name: 'target-red', color: 0xb02a20, roughness: 0.85, side: THREE.DoubleSide });
    const list = [];
    const spots = [[-350, 1500, 0.3], [650, 2500, -0.2], [-900, 3600, 0.6], [200, 5200, 0.1]];
    for (const [x, z, yaw] of spots) {
      const b = new Batch();
      const W = 30, H = 14;
      for (const s of [-1, 1]) b.add(pont, rbox(W + 6, 1.8, 2.4, 0.4), V(0, 0.2, s * 5));
      for (let k = -3; k <= 3; k++) b.add(frame, rbox(0.4, 0.4, 12, 0.05), V(k * (W / 6), 1.3, 0));
      for (const xx of [-W / 2, -W / 6, W / 6, W / 2]) {
        b.add(frame, cyl(0.25, 0.3, H, 8), V(xx, 1.3 + H / 2, 0));
        b.add(frame, cyl(0.12, 0.12, Math.hypot(H, 5), 6), V(xx, 1.3 + H / 2, -2.5), [0.35, 0, 0]);
      }
      b.add(frame, cyl(0.2, 0.2, W, 8), V(0, 1.3 + H, 0), [0, 0, Math.PI / 2]);
      for (let i = 0; i < 6; i++) b.add(i % 2 ? redM : canvasM, new THREE.PlaneGeometry(W / 6 - 0.3, H - 0.6), V(-W / 2 + W / 12 + (i * W) / 6, 1.3 + H / 2, 0.05), [0, 0, 0], undefined, 'keep');
      const g = b.build('target');
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.group.add(g);
      list.push({ obj: g, pos: V(x, 0, z), yaw, W, H, hits: 0, burning: 0 });
    }
    return list;
  }

  start() { this.score = { shots: 0, hits: 0, salvos: 0 }; this.trialTime = 0; this.log = []; for (const t of this.targets) { t.hits = 0; t.burning = 0; } }
  reset() { this.shells.length = 0; }

  /** Gameplay muzzle velocity: scaled so engagements happen within ~2–9 km. */
  mv(cal) { return 430 + cal * 160; }

  solution(turret, muzzle, target) {
    const dx = target.x - muzzle.x, dz = target.z - muzzle.z, d = Math.hypot(dx, dz);
    const v = this.mv(turret.cal);
    const k = (G * d) / (v * v);
    if (k > 1) return null;
    const elev = 0.5 * Math.asin(k) + Math.atan2(target.y - muzzle.y, d) * 0.5;
    return { bearing: Math.atan2(dx, dz), elev, range: d, tof: (2 * v * Math.sin(elev)) / G };
  }

  setAimFromScreen(nx, ny) {
    const cam = this.game.camera;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), cam);
    const r = this.raycaster.ray;
    if (r.direction.y > -0.0005) { // above the horizon: aim at max range along that bearing
      const dir = V(r.direction.x, 0, r.direction.z).normalize();
      this.aim.copy(cam.position).addScaledVector(dir, 20000).setY(0);
    } else {
      const t = -r.origin.y / r.direction.y;
      this.aim.copy(r.origin).addScaledVector(r.direction, t);
    }
    this.aimValid = true;
  }

  fireAtScreen(e) {
    const rect = this.game.R.renderer.domElement.getBoundingClientRect();
    this.setAimFromScreen(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.fire();
  }

  allTurrets() { const s = this.game.ship; return [...s.turrets, ...s.secondaries]; }

  fire(secondary = false) {
    const ship = this.game.ship;
    let fired = 0;
    for (const t of secondary ? ship.secondaries : ship.turrets) {
      if (!t.ready || t.reload > 0) continue;
      t.reload = secondary ? 4 : ship.analysis.reload;
      t.recoil = 1;
      for (const mz of t.muzzles) {
        const wp = t.pivot.localToWorld(mz.clone());
        const dir = t.pivot.localToWorld(mz.clone().add(V(1, 0, 0))).sub(wp).normalize();
        const v = this.mv(t.cal);
        this.shells.push({ p: wp.clone(), v: dir.clone().multiplyScalar(v), cal: t.cal, age: 0, sec: secondary });
        this.muzzleFX(wp, dir, t.cal);
        this.score.shots++;
        fired++;
      }
      // heel away from the bearing of fire
      const local = wrap(t.group.rotation.y);
      ship.recoil(Math.sin(local) > 0 ? 1 : -1, 0.0025 * Math.pow(t.cal / 0.4, 3) * t.muzzles.length);
    }
    if (fired && !secondary) this.score.salvos++;
    if (fired) this.game.emit('fired', fired);
    return fired;
  }

  muzzleFX(p, dir, cal) {
    const s = cal / 0.406;
    if (Math.random() < 0.5) this.game.audio?.gun(p.distanceTo(this.game.camera.position), cal);
    for (let i = 0; i < 6; i++) this.flash.emit(p.clone().addScaledVector(dir, i * 2.5 * s), dir.clone().multiplyScalar(30 * s), { life: 0.18, size0: 7 * s, size1: 14 * s, color: [3.0, 1.6, 0.6], alpha: 1, drag: 4 });
    for (let i = 0; i < 26; i++) {
      const v = dir.clone().multiplyScalar((15 + Math.random() * 45) * s).add(V((Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8));
      const g = 0.5 + Math.random() * 0.15;
      this.smoke.emit(p.clone().addScaledVector(dir, 3 * s), v, { life: 5 + Math.random() * 6, size0: 5 * s, size1: 28 * s, color: [g, g * 0.97, g * 0.92], alpha: 0.55, drag: 1.1 });
    }
  }

  splashFX(p, cal, hit) {
    const s = Math.pow(cal / 0.406, 1.3);
    const H = (hit ? 25 : 55) * s;
    const vy = Math.sqrt(2 * G * H);
    // tall narrow column: fast core, ragged slower sheath that spreads as it falls back
    for (let i = 0; i < 170 * Math.max(0.3, s); i++) {
      const a = Math.random() * 6.28, core = Math.random() < 0.55, r = Math.random() * (core ? 2.2 : 4.5) * s;
      const up = vy * (core ? 0.75 + Math.random() * 0.3 : 0.3 + Math.random() * 0.45);
      const out = core ? 0.25 : 1.2;
      this.spray.emit(p.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r)), V(Math.cos(a) * r * out, up, Math.sin(a) * r * out),
        { life: (2 * up) / G * 0.95, size0: 1.6 * s, size1: (core ? 5 : 8) * s, color: [0.93, 0.95, 0.96], alpha: core ? 0.8 : 0.55, drag: 0.12, grav: G });
    }
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * 6.28;
      this.spray.emit(p.clone(), V(Math.cos(a) * 12 * s, 2, Math.sin(a) * 12 * s), { life: 6, size0: 6 * s, size1: 26 * s, color: [0.88, 0.9, 0.9], alpha: 0.45, drag: 0.6 });
    }
    this.game.water.addSplash(p.x, p.z, 18 * s + 6);
    this.game.audio?.splash(p.distanceTo(this.game.camera.position), cal);
    if (hit) {
      for (let i = 0; i < 14; i++) this.flash.emit(p.clone().add(V(0, 4, 0)), V((Math.random() - 0.5) * 30, Math.random() * 30, (Math.random() - 0.5) * 30), { life: 0.5, size0: 8, size1: 20, color: [3, 1.4, 0.4], drag: 3 });
      for (let i = 0; i < 30; i++) this.smoke.emit(p.clone().add(V(0, 5, 0)), V((Math.random() - 0.5) * 10, 6 + Math.random() * 10, (Math.random() - 0.5) * 10), { life: 10, size0: 6, size1: 30, color: [0.18, 0.17, 0.16], alpha: 0.7, drag: 0.5 });
    }
  }

  update(dt, t) {
    const game = this.game, ship = game.ship;
    const trials = game.mode === 'trials';
    if (trials) this.trialTime += dt;
    if (trials && !this.manualAim) this.setAimFromScreen(0, game.rig.mode === 'sight' ? 0 : 0.0);
    // ---- turret laying ----
    ship.root.updateMatrixWorld(true);
    for (const tr of this.allTurrets()) {
      tr.reload = Math.max(0, tr.reload - dt);
      tr.recoil = Math.max(0, (tr.recoil || 0) - dt * 1.4);
      let wantYaw = tr.restYaw, wantElev = 0;
      tr.ready = false;
      if (trials && this.aimValid) {
        const base = tr.group.getWorldPosition(new THREE.Vector3());
        const sol = this.solution(tr, base.clone().add(V(0, 2, 0)), this.aim);
        if (sol) {
          // bearing in ship-local turret space: local +x is the bow, ship heading convention forward=(sin h, cos h)
          const rel = wrap(sol.bearing - ship.heading);
          // turret rotation.y = theta points the guns along local (cos theta, 0, -sin theta): theta = rel
          const cand = rel;
          const lo = tr.arc[0], hi = tr.arc[1];
          const mid = (lo + hi) / 2;
          const off = wrap(cand - mid);
          if (Math.abs(off) <= (hi - lo) / 2) { wantYaw = mid + off; wantElev = sol.elev; tr.inArc = true; } else tr.inArc = false;
          tr.solution = sol;
        }
      }
      const rate = (tr.secondary ? 14 : 6) * (Math.PI / 180) * dt;
      const cur = tr.group.rotation.y;
      const d = wrap(wantYaw - cur);
      tr.group.rotation.y = cur + Math.max(-rate, Math.min(rate, d));
      const er = (tr.secondary ? 12 : 6) * (Math.PI / 180) * dt;
      const ce = tr.pivot.rotation.z;
      const de = wantElev - ce;
      tr.pivot.rotation.z = ce + Math.max(-er, Math.min(er, de));
      tr.ready = trials && tr.inArc && Math.abs(d) < 0.01 && Math.abs(de) < 0.01 && tr.reload <= 0;
      tr.pivot.children[0].position.x = -tr.recoil * tr.recoil * 1.3 * (tr.cal / 0.4);
    }
    // ---- shells ----
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let n = 0;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.age += dt;
      const prev = s.p.clone();
      s.v.y -= G * dt;
      s.p.addScaledVector(s.v, dt);
      // target hits: segment vs target screen box
      let hitT = null;
      for (const tg of this.targets) {
        const loc = s.p.clone().sub(tg.obj.position).applyAxisAngle(V(0, 1, 0), -tg.yaw);
        if (Math.abs(loc.x) < tg.W / 2 + 1 && loc.y > -1 && loc.y < tg.H + 2 && Math.abs(loc.z) < Math.max(8, s.v.length() * dt)) { hitT = tg; break; }
      }
      const water = game.waves.heightAt(s.p.x, s.p.z, t);
      if (hitT || s.p.y < water || s.age > 60) {
        if (hitT) { hitT.hits++; hitT.burning = 25; this.score.hits++; this.log.unshift({ t: this.trialTime, text: `Hit on target ${this.targets.indexOf(hitT) + 1}` }); }
        if (s.age <= 60) this.splashFX(V(s.p.x, hitT ? s.p.y : water, s.p.z), s.cal, !!hitT);
        this.shells.splice(i, 1);
        continue;
      }
      if (n < this.tracer.instanceMatrix.count && !s.sec) {
        q.setFromUnitVectors(V(0, 1, 0), s.v.clone().normalize());
        const k = s.cal / 0.406;
        m.compose(s.p, q, V(k, 1.5 + k, k));
        this.tracer.setMatrixAt(n++, m);
      }
      void prev;
    }
    this.tracer.count = n;
    this.tracer.instanceMatrix.needsUpdate = true;
    // burning targets smoke
    for (const tg of this.targets) {
      const h = game.waves.heightAt(tg.pos.x, tg.pos.z, t);
      tg.obj.position.y = h - 0.4;
      tg.obj.rotation.x = Math.sin(t * 0.8 + tg.pos.x) * 0.03;
      if (tg.burning > 0) {
        tg.burning -= dt;
        if (Math.random() < dt * 12) this.smoke.emit(tg.obj.position.clone().add(V((Math.random() - 0.5) * 20, 6, 0)), V(2, 5 + Math.random() * 4, 1), { life: 12, size0: 5, size1: 26, color: [0.15, 0.14, 0.13], alpha: 0.55, drag: 0.3 });
      }
    }
    // funnel smoke scales with throttle
    if (trials && ship.model?.userData.funnelTops) {
      const rate = (0.2 + Math.abs(ship.throttle) * 1.2) * dt * 6;
      for (const ft of ship.model.userData.funnelTops) if (Math.random() < rate) {
        const p = ship.model.localToWorld(ft.clone());
        this.smoke.emit(p, V(-ship.forward().x * ship.speed * 0.6 + 1.5, 3, -ship.forward().z * ship.speed * 0.6 + 1), { life: 9, size0: 3, size1: 18, color: [0.32, 0.31, 0.3], alpha: 0.3, drag: 0.25 });
      }
    }
    const sc = game.scene;
    const sunDir = game.sky.sunDir, sunCol = game.sky.sun.color;
    for (const p of [this.smoke, this.spray, this.flash]) { p.mat.uniforms.uSun.value.copy(sunDir); p.mat.uniforms.uSunCol.value.copy(sunCol); p.update(dt, sc); }
  }
}

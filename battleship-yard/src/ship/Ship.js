import * as THREE from 'three';
import { ShipBuilder } from './ShipBuilder.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Runtime ship: owns the built model and a simple seakeeping model.
 * Heading convention: forward = (sin h, 0, cos h). The model's local +x is the bow.
 * Motions: surge/yaw (throttle + rudder), heave/pitch from wave sampling along the hull,
 * roll as a damped oscillator whose natural period comes from the design's GM.
 */
export class Ship {
  constructor(mats, waves, terrain) {
    this.builder = new ShipBuilder(mats);
    this.waves = waves;
    this.terrain = terrain;
    this.root = new THREE.Group();
    this.root.name = 'ship-root';
    this.position = new THREE.Vector3();
    this.heading = Math.PI / 2;
    this.speed = 0; this.yawRate = 0;
    this.throttle = 0; this.rudder = 0;
    this.roll = 0; this.rollVel = 0; this.pitch = 0; this.heave = 0;
    this.grounded = false;
    this.time = 0;
    this.wakeTimer = 0;
  }

  build(design) {
    if (this.model) {
      this.root.remove(this.model);
      this.model.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.model = this.builder.build(design);
    this.root.add(this.model);
    const ud = this.model.userData;
    this.design = design;
    this.analysis = ud.analysis;
    this.turrets = ud.turrets;
    this.secondaries = ud.secondaries;
    this.hull = ud.hull;
    this.length = design.length;
    this.beam = design.beam;
    this.draft = ud.analysis.draft;
    // GM < 0: permanent list toward one side (angle of loll)
    const gm = this.analysis.GM;
    this.loll = gm < 0.05 ? clamp(Math.sqrt(Math.max(0, -gm + 0.05) * 2 / this.analysis.BM) , 0.05, 0.6) : 0;
    this.rollOmega = gm > 0.05 ? (2 * Math.PI) / this.analysis.rollPeriod : 0.25;
    return this.model;
  }

  berthPose() {
    return { x: 0, z: this.beam / 2 + 2.4, heading: Math.PI / 2 };
  }

  placeAtBerth() {
    const b = this.berthPose();
    this.position.set(b.x, 0, b.z);
    this.heading = b.heading;
    this.speed = 0; this.yawRate = 0; this.throttle = 0; this.rudder = 0;
    this.roll = 0; this.rollVel = 0; this.pitch = 0; this.heave = 0;
    this.grounded = false;
    this.syncTransform();
  }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  right(out = new THREE.Vector3()) { return out.set(-Math.cos(this.heading), 0, Math.sin(this.heading)); } // starboard = forward x up

  localToWorld(v) { return this.root.localToWorld(v.clone()); }
  directorWorld() { this.root.updateMatrixWorld(); return this.model.localToWorld(this.model.userData.director.clone()); }

  update(dt, t, mode) {
    this.time = t;
    const a = this.analysis, L = this.length, B = this.beam;
    const W = this.waves;
    if (mode === 'trials') {
      const vmax = a.speedMs;
      const target = this.throttle * vmax * (1 - 0.25 * Math.abs(this.rudder) * Math.min(1, this.speed / vmax));
      const tau = this.throttle * this.speed < 0 || Math.abs(target) < Math.abs(this.speed) ? 26 : 40 + a.displacement / 2500;
      this.speed += (target - this.speed) * (1 - Math.exp(-dt / tau));
      // yaw: steady turning circle from the design's tactical diameter, first-order response
      const rss = (this.speed / (a.turningDiameter / 2)) * this.rudder * 0.95;
      this.yawRate += (rss - this.yawRate) * (1 - Math.exp(-dt / 7));
      this.heading += this.yawRate * dt;
      const f = this.forward(new THREE.Vector3());
      const next = this.position.clone().addScaledVector(f, this.speed * dt);
      // grounding: probe bow, stern and both shoulders against the seabed/quay
      const probes = [[0.5, 0], [-0.48, 0], [0.25, 0.5], [0.25, -0.5], [-0.25, 0.5], [-0.25, -0.5], [0, 0.5], [0, -0.5]];
      const r = this.right(new THREE.Vector3());
      let hit = false;
      for (const [px, pz] of probes) {
        const p = next.clone().addScaledVector(f, px * L).addScaledVector(r, pz * B);
        if (this.terrain.heightAt(p.x, p.z) > -this.draft + 0.6) { hit = true; break; }
      }
      if (hit) {
        if (!this.grounded) this.onGround?.(Math.abs(this.speed));
        this.speed *= -0.15; this.yawRate *= 0.3; this.grounded = true;
      } else { this.position.copy(next); this.grounded = false; }
      if (Math.abs(this.speed) > 0.5) {
        this.wakeTimer -= dt;
        if (this.wakeTimer <= 0) {
          this.wakeTimer = 0.7;
          const stern = this.position.clone().addScaledVector(f, -L * 0.48);
          this.onWake?.(stern, B * 0.55 + Math.abs(this.speed) * 0.4);
        }
      }
    } else {
      this.speed = 0; this.yawRate = 0;
    }

    // ---- seakeeping ----
    const f = this.forward(new THREE.Vector3()), r = this.right(new THREE.Vector3());
    const hAt = (u, v) => { const p = this.position.clone().addScaledVector(f, u).addScaledVector(r, v); return W.heightAt(p.x, p.z, t); };
    const bow = hAt(L * 0.38, 0), stern = hAt(-L * 0.38, 0), port = hAt(0, -B * 0.5), stbd = hAt(0, B * 0.5), mid = hAt(0, 0);
    const heaveT = (bow + stern + port + stbd + mid * 2) / 6;
    this.heave += (heaveT - this.heave) * (1 - Math.exp(-dt * 1.2));
    const pitchT = Math.atan2(bow - stern, L * 0.76) * 0.55;
    this.pitch += (pitchT - this.pitch) * (1 - Math.exp(-dt * 0.9));
    const waveSlope = Math.atan2(stbd - port, B);
    const w = this.rollOmega;
    const heel = -this.yawRate * this.speed * 0.012 * (a.KG / Math.max(0.3, a.GM)); // outward heel in turns
    const rollEq = -waveSlope * 0.8 + heel + this.loll; // +roll = starboard down
    this.rollVel += (w * w * (rollEq - this.roll) - 2 * 0.07 * w * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.roll = clamp(this.roll, -0.9, 0.9);

    this.syncTransform();
  }

  syncTransform() {
    this.root.position.set(this.position.x, this.heave, this.position.z);
    this.root.quaternion.setFromEuler(new THREE.Euler(this.roll, this.heading - Math.PI / 2, this.pitch, 'YXZ'));
    this.root.updateMatrixWorld(true);
  }

  /** Recoil impulse: heels the ship away from the line of fire. */
  recoil(side, strength) { this.rollVel += side * strength; }
}

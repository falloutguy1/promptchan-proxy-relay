// Simplified but physically grounded flight model (lift, induced drag, thrust from power,
// gravity, sideslip) with a mouse-aim "instructor" like War Thunder's.
// Body axes: +Z forward, +Y up, +X left.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3();
const _q = new THREE.Quaternion(), _iq = new THREE.Quaternion(), _w = new THREE.Vector3();
const G = 9.81;

export const B17_SPEC = {
  mass: 24500, bombMass: 227, wingArea: 131.9, cd0: 0.029, k: 0.048, cl0: 0.32, cla: 5.0, stall: 0.27,
  enginePower: 895e3, propEff: 0.8, maxPitch: 0.26, maxRoll: 0.55, maxYaw: 0.12, maxBank: 0.62,
};

export class Aircraft {
  constructor(spec, engineCount = 4) {
    this.spec = spec;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.rate = new THREE.Vector3();          // body rates: x=pitch up, y=yaw left, z=roll left (rad/s)
    this.throttle = 0.72;
    this.mass = spec.mass;
    this.engines = Array.from({ length: engineCount }, () => ({ hp: 1, fire: 0, running: true, rpm: 0, feathered: false }));
    this.cmd = { pitch: 0, roll: 0, yaw: 0 };
    this.dragExtra = 0;
    this.liftLoss = 0;
    this.alive = true;
    this.aoa = 0;
    this.ias = 0;
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  left(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  bank() { this.left(_l); return -Math.asin(THREE.MathUtils.clamp(_l.y, -1, 1)); } // + = left wing down
  pitchAngle() { this.forward(_f); return Math.asin(THREE.MathUtils.clamp(_f.y, -1, 1)); }
  heading() { this.forward(_f); return (THREE.MathUtils.radToDeg(Math.atan2(_f.x, -_f.z)) + 360) % 360; }

  // steer towards a world-space direction (mouse aim)
  instruct(dir, levelBias = 0) {
    const S = this.spec;
    _iq.copy(this.quat).invert();
    const L = _v.copy(dir).applyQuaternion(_iq).normalize();
    const angX = Math.atan2(L.x, L.z);   // + left
    const angY = Math.atan2(L.y, Math.hypot(L.x, L.z)) + this.aoa * 0.9;   // steer the flight path, not the nose
    const off = Math.acos(THREE.MathUtils.clamp(L.z, -1, 1));
    const targetBank = THREE.MathUtils.clamp(angX * 2.6, -S.maxBank, S.maxBank) * THREE.MathUtils.smoothstep(off, 0.01, 0.06);
    const bank = this.bank();
    this.cmd.roll = THREE.MathUtils.clamp((targetBank - bank) * 2.4 - this.rate.z * 0.8, -1, 1);
    // need extra pull in a banked turn
    const turnPull = (1 / Math.max(0.5, Math.cos(bank)) - 1) * 0.6;
    this.cmd.pitch = THREE.MathUtils.clamp(angY * 5 + turnPull - this.rate.x * 0.6 + levelBias, -1, 1);
    this.cmd.yaw = THREE.MathUtils.clamp(angX * 2.5, -1, 1) * 0.6;
  }

  step(dt, hf) {
    const S = this.spec;
    const f = this.forward(_f), u = this.up(_u), l = this.left(_l);
    const V = this.vel.length();
    const alt = this.pos.y;
    const rho = 1.225 * Math.exp(-alt / 9000);
    const qd = 0.5 * rho * V * V;
    this.ias = V * Math.sqrt(rho / 1.225);
    const vf = this.vel.dot(f), vu = this.vel.dot(u), vl = this.vel.dot(l);
    const aoa = Math.atan2(-vu, Math.max(1, vf));
    const beta = Math.atan2(vl, Math.max(1, vf));
    this.aoa = aoa;
    let cl = S.cl0 + S.cla * aoa;
    if (aoa > S.stall) cl = (S.cl0 + S.cla * S.stall) * Math.max(0.35, 1 - (aoa - S.stall) * 4);
    cl *= 1 - this.liftLoss;
    const force = new THREE.Vector3(0, -G * this.mass, 0);
    if (V > 1) {
      const vh = _w.copy(this.vel).multiplyScalar(1 / V);
      const liftDir = u.clone().addScaledVector(vh, -u.dot(vh)).normalize();
      force.addScaledVector(liftDir, qd * S.wingArea * cl);
      const cd = S.cd0 + S.k * cl * cl + this.dragExtra;
      force.addScaledVector(vh, -qd * S.wingArea * cd);
      force.addScaledVector(l, -qd * S.wingArea * 0.9 * beta);
    }
    // thrust from power (turbo-supercharged: full power to ~7.5 km)
    let power = 0, asym = 0;
    this.engines.forEach((e, i) => {
      const on = e.running && e.hp > 0;
      e.rpm += ((on ? 0.45 + 0.55 * this.throttle : 0) - e.rpm) * Math.min(1, dt * 1.5);
      if (on) { const p = S.enginePower * this.throttle * (0.5 + 0.5 * e.hp); power += p; asym += (i < 2 ? 1 : -1) * p; }
    });
    const thrust = power * S.propEff / Math.max(V, 35);
    force.addScaledVector(f, thrust);
    this.vel.addScaledVector(force, dt / this.mass);

    // rotational dynamics: commanded body rates with lag, plus weathervane + asymmetric thrust yaw
    const eff = THREE.MathUtils.clamp(qd / 3000, 0.15, 1.3);
    const target = _w.set(this.cmd.pitch * S.maxPitch * eff, this.cmd.yaw * S.maxYaw * eff + beta * 0.9 - asym / (S.enginePower * 4) * 0.05, this.cmd.roll * S.maxRoll * eff);
    // stall: nose drops
    if (aoa > S.stall) target.x -= (aoa - S.stall) * 2;
    this.rate.lerp(target, Math.min(1, dt * 1.8));
    const w = new THREE.Vector3(-this.rate.x, this.rate.y, -this.rate.z);
    const ang = w.length() * dt;
    if (ang > 0) { _q.setFromAxisAngle(w.normalize(), ang); this.quat.multiply(_q).normalize(); }
    this.pos.addScaledVector(this.vel, dt);
    // ground
    if (hf) {
      const gy = hf.height(this.pos.x, this.pos.z);
      if (this.pos.y < gy + 2) { this.pos.y = gy + 2; this.crashed = true; }
    }
  }
}

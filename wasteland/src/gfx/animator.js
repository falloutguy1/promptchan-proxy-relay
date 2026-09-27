// Procedural animation for the humanoid rig: walk/run gait with stride matched
// to ground speed (feet do not skate), idle breathing and weight shift, work
// cycles (chop, dig, build, farm), carry, aim/shoot, infected shamble and
// lunge, and a fall-down death. States cross-fade over ~0.3 s by blending the
// per-bone target rotations, so transitions are smooth.
import * as THREE from 'three';
import { BONES } from './humanoid.js';

const TAU = Math.PI * 2;
const E = () => ({ x: 0, y: 0, z: 0 });

function pose() { const p = {}; for (const b of BONES) p[b] = E(); p.rootY = 0; p.rootZ = 0; p.rootX = 0; p.lean = 0; return p; }
function addScaled(out, p, w) {
  for (const b of BONES) { out[b].x += p[b].x * w; out[b].y += p[b].y * w; out[b].z += p[b].z * w; }
  out.rootY += p.rootY * w; out.rootZ += p.rootZ * w; out.rootX += p.rootX * w; out.lean += p.lean * w;
}

export class Animator {
  constructor(rig, { infected = false, seed = 1 } = {}) {
    this.rig = rig;
    this.infected = infected;
    this.state = 'idle';
    this.weights = { idle: 1 };
    this.phase = Math.random();
    this.t = seed * 13.1;
    this.speed = 0;
    this.work = 'build';
    this.dead = 0;
    this.carrying = false;
    this.limp = infected ? 0.25 + (seed % 7) * 0.05 : 0;
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  set(state) { if (this.state !== state) { this.state = state; if (!(state in this.weights)) this.weights[state] = 0; } }

  update(dt, speed) {
    this.t += dt;
    this.speed = speed;
    // cross-fade weights
    let sum = 0;
    for (const k of Object.keys(this.weights)) {
      const target = k === this.state ? 1 : 0;
      this.weights[k] += (target - this.weights[k]) * Math.min(1, dt * 7);
      if (this.weights[k] < 0.002 && k !== this.state) delete this.weights[k];
      else sum += this.weights[k];
    }
    const H = this.rig.height;
    // gait phase advances with distance travelled / stride
    const stride = this.infected ? 0.55 * H / 1.75 : (0.72 + 0.28 * Math.min(1, speed / 3.5)) * H / 1.75;
    this.phase = (this.phase + (speed * dt) / (2 * stride)) % 1;
    const out = pose();
    for (const [k, w] of Object.entries(this.weights)) addScaled(out, this.#pose(k), w / sum);
    this.#apply(out);
  }

  #pose(state) {
    const p = pose(), ph = this.phase * TAU, t = this.t;
    if (state === 'idle') {
      const br = Math.sin(t * 1.6) * 0.02, sway = Math.sin(t * 0.37) * 0.04;
      p.chest.x = br - 0.02; p.spine.z = sway * 0.5; p.hips.z = -sway * 0.3; p.rootX = sway * 0.03;
      p.upperArmL.z = 0.08 + br; p.upperArmR.z = -0.08 - br; p.foreArmL.x = -0.18; p.foreArmR.x = -0.2;
      p.head.y = Math.sin(t * 0.23) * 0.35 * (Math.sin(t * 0.11) > 0.6 ? 1 : 0.2); p.head.x = 0.05;
      p.thighL.z = 0.03; p.thighR.z = -0.03;
      if (this.infected) { p.head.z = 0.35; p.chest.x = 0.25; p.upperArmL.x = -0.3; p.upperArmR.x = -0.1; p.foreArmL.x = -0.6; }
    } else if (state === 'walk' || state === 'run') {
      const run = state === 'run' ? 1 : 0;
      const A = run ? 0.72 : 0.42, K = run ? 1.25 : 0.62;
      const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
      p.thighL.x = -A * sL; p.thighR.x = -A * sR;
      // knee flexes most in swing (leg moving forward)
      p.shinL.x = K * Math.max(0, Math.sin(ph - 0.6)) + 0.08; p.shinR.x = K * Math.max(0, Math.sin(ph + Math.PI - 0.6)) + 0.08;
      p.footL.x = -0.25 * Math.sin(ph - 1.2) - 0.05; p.footR.x = -0.25 * Math.sin(ph + Math.PI - 1.2) - 0.05;
      const armA = run ? 0.7 : 0.38;
      p.upperArmL.x = armA * sL; p.upperArmR.x = armA * sR;
      p.upperArmL.z = 0.1; p.upperArmR.z = -0.1;
      p.foreArmL.x = -(run ? 1.35 : 0.3) - 0.15 * Math.max(0, sL); p.foreArmR.x = -(run ? 1.35 : 0.3) - 0.15 * Math.max(0, sR);
      p.hips.y = 0.09 * Math.sin(ph); p.chest.y = -0.12 * Math.sin(ph);
      p.rootY = (run ? 0.045 : 0.025) * Math.abs(Math.cos(ph)) - (run ? 0.06 : 0.015);
      p.hips.z = 0.04 * Math.cos(ph); p.lean = run ? 0.18 : 0.05;
      if (this.infected) {
        // shamble: dragging leg, arms reaching, heavy forward lean
        p.thighR.x *= 1 - this.limp; p.shinR.x = 0.15;
        p.upperArmL.x = -1.2 + 0.1 * sL; p.upperArmR.x = -0.9 + 0.1 * sR; p.foreArmL.x = -0.35; p.foreArmR.x = -0.5;
        p.lean = 0.3; p.head.z = 0.3 * Math.sin(ph * 0.5); p.head.x = 0.25; p.chest.z = 0.12 * Math.sin(ph);
      } else if (this.carrying) {
        // load held against the chest: arms locked, shorter lean-back stride
        p.upperArmL.x = -0.75; p.upperArmR.x = -0.75; p.upperArmL.z = 0.12; p.upperArmR.z = -0.12;
        p.foreArmL.x = -1.1; p.foreArmR.x = -1.1; p.lean = -0.04; p.chest.y *= 0.4;
      }
    } else if (state === 'work') {
      const k = this.work;
      const c = Math.sin(t * (k === 'farm' ? 2.2 : 3.0));
      const strike = Math.pow(Math.max(0, c), 3);
      p.lean = 0.35 + (k === 'dig' || k === 'farm' ? 0.25 : 0);
      p.thighL.x = -0.25; p.thighR.x = 0.1; p.shinL.x = 0.35; p.shinR.x = 0.2; p.rootY = -0.06;
      if (k === 'chop' || k === 'build') {
        p.upperArmL.x = -1.9 + 1.5 * strike; p.upperArmR.x = -1.9 + 1.5 * strike;
        p.upperArmL.z = -0.25; p.upperArmR.z = 0.25; p.foreArmL.x = -0.5; p.foreArmR.x = -0.5;
        p.chest.x = -0.25 + 0.6 * strike; p.spine.x = 0.1 * strike;
      } else if (k === 'dig' || k === 'farm') {
        p.upperArmL.x = -0.9 + 0.5 * c; p.upperArmR.x = -0.6 + 0.4 * c; p.foreArmL.x = -0.7; p.foreArmR.x = -0.9;
        p.chest.x = 0.3 + 0.15 * c; p.head.x = 0.3;
      } else if (k === 'carry') {
        p.upperArmL.x = -0.75; p.upperArmR.x = -0.75; p.foreArmL.x = -1.1; p.foreArmR.x = -1.1; p.lean = 0.02;
      } else if (k === 'scavenge') {
        p.upperArmL.x = -1.0 + 0.3 * Math.sin(t * 4.1); p.upperArmR.x = -1.2 + 0.3 * Math.sin(t * 3.7 + 1); p.foreArmL.x = -0.6; p.foreArmR.x = -0.4;
        p.chest.x = 0.55; p.thighL.x = -0.8; p.thighR.x = -0.8; p.shinL.x = 1.4; p.shinR.x = 1.4; p.rootY = -0.35; p.footL.x = -0.5; p.footR.x = -0.5;
      } else if (k === 'guard') {
        p.lean = 0; p.thighL.x = 0; p.thighR.x = 0; p.shinL.x = 0.05; p.shinR.x = 0.05; p.rootY = 0;
        p.head.y = Math.sin(t * 0.4) * 0.6; p.upperArmR.x = -0.45; p.foreArmR.x = -1.2; p.upperArmL.x = -0.3; p.foreArmL.x = -1.0;
      }
    } else if (state === 'aim') {
      p.upperArmR.x = -1.45; p.upperArmR.z = 0.1; p.foreArmR.x = -0.35;
      p.upperArmL.x = -1.35; p.upperArmL.z = -0.35; p.foreArmL.x = -0.45;
      p.chest.y = 0.35; p.head.y = -0.3; p.thighL.x = -0.2; p.thighR.x = 0.2; p.shinL.x = 0.15;
      const kick = Math.max(0, Math.sin(t * 9)) ** 8 * 0.12;
      p.upperArmR.x += kick; p.upperArmL.x += kick; p.chest.x = -kick * 0.5;
    } else if (state === 'attack') {
      // infected lunge / survivor melee swing
      const c = Math.sin(t * 5.5), s = Math.pow(Math.max(0, c), 2);
      p.upperArmL.x = -1.6 + 1.2 * s; p.upperArmR.x = -1.4 + 1.0 * (1 - s); p.foreArmL.x = -0.3; p.foreArmR.x = -0.3;
      p.lean = 0.35 + 0.2 * s; p.chest.y = 0.4 * c; p.thighL.x = -0.4; p.shinL.x = 0.4; p.thighR.x = 0.3;
    } else if (state === 'sit') {
      p.thighL.x = -1.5; p.thighR.x = -1.5; p.shinL.x = 1.5; p.shinR.x = 1.5; p.rootY = -0.48; p.lean = 0.1;
      p.upperArmL.x = -0.6; p.upperArmR.x = -0.6; p.foreArmL.x = -0.9; p.foreArmR.x = -0.9; p.head.x = 0.15;
    } else if (state === 'sleep') {
      p.rootZ = 1;
      p.upperArmL.z = 0.2; p.upperArmR.z = -0.25; p.foreArmL.x = -0.5; p.foreArmR.x = -0.2;
      p.thighL.x = -0.35; p.shinL.x = 0.6; p.thighR.x = -0.1; p.shinR.x = 0.2; p.head.y = 0.45 + Math.sin(t * 0.4) * 0.02; p.chest.x = Math.sin(t * 1.1) * 0.015;
    } else if (state === 'dead') {
      p.rootZ = 1; // handled in apply: lie down
      p.upperArmL.z = 0.9; p.upperArmR.z = -0.6; p.thighL.z = 0.15; p.thighR.z = -0.25; p.shinL.x = 0.4; p.head.y = 0.6;
    }
    return p;
  }

  #apply(p) {
    const b = this.rig.bones, rest = this.rig.rest;
    for (const name of BONES) {
      const r = p[name];
      if (name === 'hips') continue;
      b[name].rotation.set(r.x, r.y, r.z, 'XYZ');
    }
    // mirror conventions: positive arm z abducts outward for L, inward for R handled by pose values
    b.hips.rotation.set(p.hips.x, p.hips.y, p.hips.z, 'XYZ');
    b.spine.rotation.x += p.lean * 0.55; b.chest.rotation.x += p.lean * 0.35;
    b.hips.position.copy(rest.hips);
    b.hips.position.y += p.rootY * this.rig.scale;
    b.hips.position.x += p.rootX;
    // death: rotate the whole character onto its back over time (weight in rootZ)
    const lie = THREE.MathUtils.smoothstep(p.rootZ, 0, 1);
    this.rig.mesh.rotation.x = -lie * Math.PI / 2 * 0.98;
    if (lie > 0) b.hips.position.y = rest.hips.y * (1 - lie) + 0.12 * lie;
  }
}

// Camera rigs: strategy (orbit over a ground target), survivor walk view and a
// slow cinematic drift for the main menu. All motion is critically damped; no
// shake, no wide-angle distortion (vertical FOV 38-60 deg).
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './rng.js';

const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export class CameraRig {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.mode = 'rts'; // rts | walk | cinematic
    this.bounds = 230;
    // strategy state (current + goal)
    this.target = new THREE.Vector3(0, 0, -40);
    this.goal = { x: 0, z: -40, yaw: 0.6, pitch: 0, dist: 70 };
    this.cur = { x: 0, z: -40, yaw: 0.6, pitch: 0, dist: 70 };
    this.pitchOffset = 0; // user tilt added to the automatic zoom-dependent pitch
    this.minDist = 9; this.maxDist = 260;
    // walk state
    this.walk = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vel: new THREE.Vector3(), bob: 0, speed: 0 };
    this.colliders = []; // {x, z, r} or {x, z, hw, hd, rot}
    this.cine = { t: 0 };
    this.follow = null; // object with .position to track
  }

  // ---------------- strategy camera
  autoPitch(dist) {
    return THREE.MathUtils.degToRad(lerp(24, 56, smoothstep(10, 170, dist)));
  }
  pan(dx, dz) { // world-space metres, relative to view yaw
    const c = Math.cos(this.goal.yaw), s = Math.sin(this.goal.yaw);
    this.goal.x += dx * c + dz * s;
    this.goal.z += -dx * s + dz * c;
    this.follow = null;
    this.#clampGoal();
  }
  panWorld(dx, dz) { this.goal.x += dx; this.goal.z += dz; this.follow = null; this.#clampGoal(); }
  rotate(dyaw) { this.goal.yaw += dyaw; }
  tilt(d) { this.pitchOffset = clamp(this.pitchOffset + d, -0.35, 0.45); }
  zoom(factor, anchor = null) {
    const before = this.goal.dist;
    this.goal.dist = clamp(this.goal.dist * factor, this.minDist, this.maxDist);
    if (anchor) { // zoom toward the point under the cursor
      const k = 1 - this.goal.dist / before;
      this.goal.x += (anchor.x - this.goal.x) * k * 0.9;
      this.goal.z += (anchor.z - this.goal.z) * k * 0.9;
      this.#clampGoal();
    }
  }
  focusOn(x, z, dist = null) {
    this.goal.x = x; this.goal.z = z;
    if (dist) this.goal.dist = clamp(dist, this.minDist, this.maxDist);
    this.#clampGoal();
  }
  #clampGoal() {
    this.goal.x = clamp(this.goal.x, -this.bounds, this.bounds);
    this.goal.z = clamp(this.goal.z, -this.bounds, this.bounds);
  }
  snap() { Object.assign(this.cur, this.goal); }

  // ---------------- walk mode
  enterWalk(x, z, yaw) {
    this.mode = 'walk';
    this.walk.pos.set(x, this.terrain.height(x, z) + 1.65, z);
    this.walk.yaw = yaw ?? this.cur.yaw + Math.PI;
    this.walk.pitch = -0.05;
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
  }
  exitWalk() {
    this.mode = 'rts';
    this.goal.x = this.walk.pos.x; this.goal.z = this.walk.pos.z;
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
  }
  look(dx, dy) {
    this.walk.yaw -= dx;
    this.walk.pitch = clamp(this.walk.pitch - dy, -1.35, 1.35);
  }
  #blocked(x, z) {
    if (this.hash) return this.hash.blocked(x, z, 0.3);
    for (const c of this.colliders) {
      if (c.r !== undefined) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.3) ** 2) return true; }
      else {
        const dx = x - c.x, dz = z - c.z, cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        if (Math.abs(lx) < c.hw + 0.3 && Math.abs(lz) < c.hd + 0.3) return true;
      }
    }
    return false;
  }

  update(dt, input) {
    const cam = this.camera;
    if (this.mode === 'free') return; // externally placed (review / photo mode)
    if (this.mode === 'walk') {
      const w = this.walk;
      const mv = input.moveVector(); // x right, y forward in [-1,1]
      const run = input.running ? 3.6 : 1.45;
      const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
      // forward is -Z in camera space: yaw 0 looks toward -Z
      const dirX = -fx * mv.y + fz * mv.x, dirZ = -fz * mv.y - fx * mv.x;
      const len = Math.hypot(dirX, dirZ);
      const tx = len > 0 ? (dirX / Math.max(1, len)) * run : 0, tz = len > 0 ? (dirZ / Math.max(1, len)) * run : 0;
      w.vel.x = damp(w.vel.x, tx, 8, dt); w.vel.z = damp(w.vel.z, tz, 8, dt);
      const nx = w.pos.x + w.vel.x * dt, nz = w.pos.z + w.vel.z * dt;
      if (!this.#blocked(nx, w.pos.z) && Math.abs(nx) < this.bounds + 30) w.pos.x = nx; else w.vel.x = 0;
      if (!this.#blocked(w.pos.x, nz) && Math.abs(nz) < this.bounds + 30) w.pos.z = nz; else w.vel.z = 0;
      w.speed = Math.hypot(w.vel.x, w.vel.z);
      w.bob += w.speed * dt * 1.9;
      const ground = this.terrain.height(w.pos.x, w.pos.z);
      const eye = ground + 1.65 + Math.sin(w.bob * 2) * 0.018 * Math.min(1, w.speed);
      w.pos.y = damp(w.pos.y, eye, 14, dt);
      cam.position.copy(w.pos);
      cam.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
      return;
    }
    if (this.mode === 'cinematic') {
      this.cine.t += dt;
      const t = this.cine.t * 0.018;
      const r = 118 + 22 * Math.sin(t * 0.7);
      const x = Math.cos(t) * r - 20, z = Math.sin(t) * r - 20;
      const y = this.terrain.height(x, z) + 34 + 8 * Math.sin(t * 1.3);
      cam.position.set(x, y, z);
      const tx = -12 + 14 * Math.sin(t * 0.5), tz = -12 + 10 * Math.cos(t * 0.4);
      cam.lookAt(tx, this.terrain.height(tx, tz) + 4, tz);
      return;
    }
    if (this.follow) { this.goal.x = this.follow.position.x; this.goal.z = this.follow.position.z; }
    const c = this.cur, g = this.goal;
    c.x = damp(c.x, g.x, 7, dt); c.z = damp(c.z, g.z, 7, dt);
    c.yaw = damp(c.yaw, g.yaw, 8, dt);
    c.dist = damp(c.dist, g.dist, 7, dt);
    const pitch = clamp(this.autoPitch(c.dist) + this.pitchOffset, 0.22, 1.35);
    c.pitch = damp(c.pitch || pitch, pitch, 8, dt);
    const ty = this.terrain.height(c.x, c.z);
    this.target.set(c.x, ty, c.z);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const px = c.x + Math.sin(c.yaw) * cp * c.dist, pz = c.z + Math.cos(c.yaw) * cp * c.dist;
    let py = ty + sp * c.dist;
    const gh = this.terrain.height(px, pz) + 2.5;
    if (py < gh) py = gh;
    cam.position.set(px, py, pz);
    cam.lookAt(c.x, ty + 1.2 * (1 - smoothstep(20, 80, c.dist)), c.z);
  }

  /** Distance used for shadow fitting / LOD. */
  get viewDistance() { return this.mode === 'walk' ? 45 : this.cur.dist; }
  get focus() { return this.mode === 'walk' ? this.walk.pos : this.target; }
}

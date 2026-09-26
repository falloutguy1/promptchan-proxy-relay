import * as THREE from 'three';

// First-person survivor: eye height 1.62 m standing / 1.05 m crouched,
// DayZ-like pace (walk 1.6, jog 3.4, sprint 5.6 m/s), smoothed acceleration,
// gentle stride-synchronised head motion (no shake), grounded footstep audio.

const EYE = 1.62, EYE_CROUCH = 1.05, RADIUS = 0.3;

export class Player {
  constructor(camera, dom, collision, audio) {
    this.camera = camera;
    this.dom = dom;
    this.col = collision;
    this.audio = audio;
    this.pos = new THREE.Vector3();   // feet
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.eye = EYE;
    this.crouch = false;
    this.onGround = true;
    this.keys = new Set();
    this.stride = 0;
    this.bob = 0;
    this.sensitivity = 1;
    this.enabled = false;
    this.surfaceAt = null; // (x,z) -> surface name for footsteps

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.crouch = !this.crouch;
      if (e.code === 'Space' && this.onGround) { this.vel.y = 3.6; this.onGround = false; }
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      const k = 0.0022 * this.sensitivity * (this.camera.fov / 55);
      this.yaw -= e.movementX * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * k, -1.45, 1.45);
    });
  }

  place(x, z, yaw = 0) {
    this.pos.set(x, this.col.groundHeight(x, z, 1e9), z);
    this.yaw = yaw;
    this.updateCamera(0);
  }

  update(dt) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && fwd > 0 && !this.crouch;
    const walk = k.has('AltLeft') || k.has('ControlLeft');
    let speed = this.crouch ? 1.35 : sprint ? 5.6 : walk ? 1.6 : 3.4;
    if (fwd < 0) speed *= 0.7;
    const dir = new THREE.Vector3(str, 0, -fwd);
    if (dir.lengthSq() > 0) dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const target = dir.multiplyScalar(speed);
    const accel = this.onGround ? (target.lengthSq() > 0 ? 9 : 12) : 1.5;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (target.x - this.vel.x) * a;
    this.vel.z += (target.z - this.vel.z) * a;

    // horizontal move + collision
    const prev = this.pos.clone();
    const p = { x: this.pos.x + this.vel.x * dt, z: this.pos.z + this.vel.z * dt };
    const height = this.crouch ? 1.2 : 1.8;
    this.col.resolve(p, RADIUS, this.pos.y + 0.36, this.pos.y + height);
    // step / slope check: refuse moves onto ground > 0.45 m above the feet (walls of the plinth etc.)
    let g = this.col.groundHeight(p.x, p.z, this.pos.y);
    if (g - this.pos.y > 0.45) { p.x = prev.x; p.z = prev.z; g = this.col.groundHeight(p.x, p.z, this.pos.y); }
    this.pos.x = p.x; this.pos.z = p.z;

    // vertical
    this.vel.y -= 9.81 * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= g) {
      if (!this.onGround && this.vel.y < -3) this.audio?.step(this.surfaceAt?.(this.pos.x, this.pos.z), 1.3);
      this.pos.y = g; this.vel.y = 0; this.onGround = true;
    } else if (this.pos.y - g < 0.3 && this.vel.y <= 0 && this.onGround) {
      this.pos.y = g; this.vel.y = 0; // stick to ground when walking downhill / down steps
    } else {
      this.onGround = false;
    }
    // world bounds
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -480, 480);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -480, 480);

    // stride + footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.3) {
      const strideLen = sprint ? 1.9 : this.crouch ? 0.9 : 1.45;
      const before = Math.floor(this.stride);
      this.stride += (hs * dt) / (strideLen / 2);
      if (Math.floor(this.stride) !== before) this.audio?.step(this.surfaceAt?.(this.pos.x, this.pos.z), Math.min(1, hs / 4));
    }
    this.updateCamera(dt, hs);
  }

  updateCamera(dt, hs = 0) {
    const targetEye = this.crouch ? EYE_CROUCH : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-10 * dt));
    // head motion: 1.2 cm vertical at jog, synced to steps, faded when slow
    const amp = THREE.MathUtils.clamp(hs / 3.4, 0, 1.4) * 0.012;
    this.bob += ((this.onGround ? amp : 0) - this.bob) * (1 - Math.exp(-6 * dt));
    const bobY = Math.abs(Math.sin(this.stride * Math.PI)) * this.bob - this.bob * 0.5;
    this.camera.position.set(this.pos.x, this.pos.y + this.eye + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

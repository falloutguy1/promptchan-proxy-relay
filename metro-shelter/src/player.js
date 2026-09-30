// First-person player: pointer-lock look, grounded movement with stepping/falling, smooth transitions.
import * as THREE from 'three';
import { collision } from './collision.js';
import { EYE } from './layout.js';
import { settings } from './settings.js';

const R = 0.28, STEP = 0.42, GRAV = 9.81;

export class Player {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(1.2, 0, 6);  // feet
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.yaw = Math.PI * 0.02; this.pitch = -0.02;
    this.eye = EYE; this.eyeTarget = EYE;
    this.camY = EYE;
    this.keys = {};
    this.hp = 100;
    this.stride = 0; this.bob = 0;
    this.onStep = null;   // callback(surface, speed)
    this.locked = false;
    this.kick = 0;        // recoil pitch offset (recovers)
    addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * settings.sens;
      this.yaw -= e.movementX * s;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * s, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.dom; this.onLockChange?.(this.locked); });
  }

  lock() { this.dom.requestPointerLock?.(); }

  surface() {
    const y = this.pos.y;
    if (y < -0.5) return 'ballast';
    return 'stone';
  }

  update(dt) {
    const k = this.keys;
    const crouch = !!k.KeyC;
    const run = !!(k.ShiftLeft || k.ShiftRight) && !crouch;
    this.eyeTarget = crouch ? 1.1 : EYE;
    const speed = crouch ? 0.9 : run ? 3.4 : 1.55;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const want = new THREE.Vector3();
    if (this.locked && (f || s)) {
      const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      want.addScaledVector(fw, f).addScaledVector(rt, s).normalize().multiplyScalar(speed);
    }
    // Human-like acceleration: quick to start, a little slower to stop.
    const grounded = this.vy === 0;
    const acc = grounded ? (want.lengthSq() > 0 ? 9 : 11) : 1.5;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, want.x, acc, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, want.z, acc, dt);

    const hgt = crouch ? 1.2 : 1.75;
    const tryMove = (nx, nz) => {
      const h = collision.floorAt(nx, nz, this.pos.y + STEP);
      if (h === null) return false;
      if (!collision.free(nx, nz, R, Math.max(h, this.pos.y), hgt)) return false;
      this.pos.x = nx; this.pos.z = nz;
      return true;
    };
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (!tryMove(this.pos.x + dx, this.pos.z)) this.vel.x *= 0.2;
    if (!tryMove(this.pos.x, this.pos.z + dz)) this.vel.z *= 0.2;

    // Ground: step up instantly (camera smooths it), fall under gravity.
    const floor = collision.floorAt(this.pos.x, this.pos.z, this.pos.y + STEP) ?? this.pos.y;
    if (floor >= this.pos.y - 0.01) {
      if (this.vy < -4) this.onLand?.(-this.vy);
      this.camY += floor - this.pos.y; // keeps eye continuous when stepping up
      this.pos.y = floor; this.vy = 0;
    } else {
      this.vy -= GRAV * dt;
      this.pos.y = Math.max(floor, this.pos.y + this.vy * dt);
      if (this.pos.y === floor) { if (this.vy < -4) this.onLand?.(-this.vy); this.vy = 0; }
    }

    // Stride + very light head bob (no shake).
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.vy === 0 && hs > 0.2) {
      const prev = this.stride;
      this.stride += dt * hs / (run ? 1.35 : 0.75) * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stride / Math.PI)) this.onStep?.(this.surface(), hs);
    }
    const bobAmp = Math.min(hs / 3.4, 1) * 0.022;
    this.bob = THREE.MathUtils.damp(this.bob, Math.abs(Math.sin(this.stride)) * bobAmp, 12, dt);

    this.eye = THREE.MathUtils.damp(this.eye, this.eyeTarget, 8, dt);
    this.camY = THREE.MathUtils.damp(this.camY, 0, 14, dt);
    this.kick = THREE.MathUtils.damp(this.kick, 0, 9, dt);
    this.cam.position.set(this.pos.x, this.pos.y + this.eye - this.camY + this.bob - 0.011, this.pos.z);
    this.cam.rotation.set(this.pitch + this.kick, this.yaw, 0, 'YXZ');
    this.speed = hs;
  }
}

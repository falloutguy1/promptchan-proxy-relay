import * as THREE from 'three';
import { QUAY, BUILDINGS } from '../world/layout.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

/**
 * Camera controller with four behaviours sharing one pointer/keyboard input layer:
 *  orbit   – inspect the ship at the fitting-out berth
 *  chase   – follow the ship during trials (drag to look around)
 *  sight   – gunnery binoculars from the main director (narrow FOV)
 *  walk    – eye-height walk around the yard (WASD / on-screen stick)
 */
export class CameraRig {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world; // { groundAt(x,z), waterAt(x,z) }
    this.mode = 'orbit';
    this.target = new THREE.Vector3(0, 8, 20);
    this.goalTarget = this.target.clone();
    this.yaw = 0.6; this.pitch = 0.32; this.dist = 220;
    this.goal = { yaw: 0.6, pitch: 0.32, dist: 220 };
    this.walk = { pos: new THREE.Vector3(-30, QUAY.topY + 1.7, -12), yaw: Math.PI * 0.85, pitch: 0.02, vel: new THREE.Vector3() };
    this.sight = { yaw: 0, pitch: 0.0 };
    this.keys = new Set();
    this.pointers = new Map();
    this.stick = { x: 0, y: 0 };
    this.lookSensitivity = 1;
    this.baseFov = 40;
    this.onTap = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      d.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button });
    });
    d.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 0) this.zoom(before / after);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      const right = p.button === 2 || e.shiftKey;
      this.look(dx, dy, right);
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6 && performance.now() - p.t < 300) this.onTap?.(e);
      this.pointers.delete(e.pointerId);
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    window.addEventListener('keydown', (e) => { if (!(e.target instanceof HTMLInputElement)) this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  look(dx, dy, pan) {
    const k = 0.005 * this.lookSensitivity;
    if (this.mode === 'walk') { this.walk.yaw -= dx * k * 0.8; this.walk.pitch = clamp(this.walk.pitch - dy * k * 0.8, -1.2, 1.2); return; }
    if (this.mode === 'sight') {
      const f = this.camera.fov / 40;
      this.sight.yaw -= dx * k * f * 0.7; this.sight.pitch = clamp(this.sight.pitch - dy * k * f * 0.7, -0.3, 0.6); return;
    }
    if (pan && this.mode === 'orbit') {
      const s = this.goal.dist * 0.0016;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      this.goalTarget.addScaledVector(right, dx * s).addScaledVector(fwd, dy * s);
      return;
    }
    this.goal.yaw -= dx * k;
    this.goal.pitch = clamp(this.goal.pitch + dy * k, -0.05, 1.45);
    this.userLook = performance.now();
  }

  zoom(f) {
    if (this.mode === 'sight') { this.camera.fov = clamp(this.camera.fov * f, 4, 30); this.camera.updateProjectionMatrix(); return; }
    if (this.mode === 'walk') return;
    this.goal.dist = clamp(this.goal.dist * f, this.minDist || 12, this.maxDist || 1400);
  }

  setMode(mode) {
    this.mode = mode;
    this.camera.fov = mode === 'sight' ? 12 : mode === 'walk' ? 55 : this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /** Frame an object: centre and comfortable distance for a given radius. */
  frame(center, radius, yaw = this.goal.yaw, pitch = 0.3) {
    this.goalTarget.copy(center);
    this.goal.dist = radius / Math.tan((this.camera.fov * Math.PI) / 360) * 1.1;
    this.goal.yaw = yaw; this.goal.pitch = pitch;
  }

  update(dt, ship) {
    const cam = this.camera;
    if (this.mode === 'walk') return this._walk(dt);
    if (this.mode === 'sight' && ship) {
      const p = ship.directorWorld();
      cam.position.copy(p);
      const yaw = ship.heading + this.sight.yaw;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.sight.pitch), Math.sin(this.sight.pitch), Math.cos(yaw) * Math.cos(this.sight.pitch));
      cam.lookAt(p.clone().add(dir));
      return;
    }
    if (this.mode === 'chase' && ship) {
      this.goalTarget.copy(ship.position).add(new THREE.Vector3(0, ship.design.freeboard + 6, 0));
      // ease back behind the ship when the player stops looking around
      if (performance.now() - (this.userLook || 0) > 4000) this.goal.yaw = damp(this.goal.yaw, ship.heading + Math.PI + 0.35, 0.4, dt);
    }
    this.yaw = damp(this.yaw, this.goal.yaw, 8, dt);
    this.pitch = damp(this.pitch, this.goal.pitch, 8, dt);
    this.dist = damp(this.dist, this.goal.dist, 6, dt);
    this.target.lerp(this.goalTarget, 1 - Math.exp(-6 * dt));
    const cp = Math.cos(this.pitch);
    const pos = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist).add(this.target);
    // keep the lens above water and terrain
    const g = Math.max(this.world.groundAt(pos.x, pos.z), this.world.waterAt(pos.x, pos.z)) + 2.0;
    if (pos.y < g) pos.y = g;
    cam.position.copy(pos);
    cam.lookAt(this.target);
  }

  _walk(dt) {
    const w = this.walk, k = this.keys;
    let fx = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + this.stick.y;
    let sx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.stick.x;
    const run = k.has('ShiftLeft') ? 2.2 : 1;
    const speed = 1.45 * run; // walking pace m/s
    const fwd = new THREE.Vector3(Math.sin(w.yaw), 0, Math.cos(w.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = fwd.multiplyScalar(fx).add(right.multiplyScalar(sx));
    if (want.lengthSq() > 1) want.normalize();
    w.vel.lerp(want.multiplyScalar(speed), 1 - Math.exp(-8 * dt));
    const next = w.pos.clone().addScaledVector(w.vel, dt);
    // stay on land: not past the quay edge, not inside buildings
    if (next.z > QUAY.edgeZ - 0.6 && Math.abs(next.x) < QUAY.x1 + 1) next.z = QUAY.edgeZ - 0.6;
    for (const b of Object.values(BUILDINGS)) {
      const hx = b.w / 2 + 0.4, hz = b.d / 2 + 0.4;
      if (Math.abs(next.x - b.x) < hx && Math.abs(next.z - b.z) < hz && !(this.world.insideOpen?.(next.x, next.z))) { next.x = w.pos.x; next.z = w.pos.z; }
    }
    const ground = this.world.groundAt(next.x, next.z);
    if (ground < 0.3) { next.x = w.pos.x; next.z = w.pos.z; }
    const g = Math.max(this.world.groundAt(next.x, next.z), 0.3);
    // footstep bob, kept subtle
    const sp = w.vel.length();
    w.phase = (w.phase || 0) + sp * dt * 1.9;
    const bob = Math.sin(w.phase * Math.PI) * 0.025 * Math.min(1, sp);
    next.y = w.pos.y < g + 1.2 ? g + 1.68 : damp(w.pos.y, g + 1.68 + bob, 14, dt); // never below eye height (e.g. after a teleport)
    w.pos.copy(next);
    this.camera.position.copy(w.pos);
    const dir = new THREE.Vector3(Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch));
    this.camera.lookAt(w.pos.clone().add(dir));
  }
}

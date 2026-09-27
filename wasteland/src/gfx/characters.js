// Character manager: spawns rigged humanoids, keeps them grounded on the terrain
// with smoothed turning, drives the animator from simulation state, and handles
// footstep dust and selection rings.
import * as THREE from 'three';
import { buildHumanoid } from './humanoid.js';
import { Animator } from './animator.js';

export class Characters {
  constructor(world) {
    this.world = world;
    this.terrain = world.terrain;
    this.group = new THREE.Group();
    this.group.name = 'characters';
    this.list = new Set();
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo = ringGeo;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xe8b04a, transparent: true, opacity: 0.85, depthWrite: false });
    this.ringMatAI = new THREE.MeshBasicMaterial({ color: 0x7cc4e0, transparent: true, opacity: 0.85, depthWrite: false });
  }

  async init(assets) {
    this.fabric = await assets.textureSet('wool');
  }

  spawn(kind, seed, x, z) {
    const rig = buildHumanoid(seed, kind, this.fabric);
    const anim = new Animator(rig, { infected: kind === 'infected', seed });
    const root = new THREE.Group();
    root.add(rig.mesh);
    root.position.set(x, this.terrain.height(x, z), z);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.visible = false;
    ring.position.y = 0.06;
    ring.renderOrder = 4;
    root.add(ring);
    this.group.add(root);
    const c = { kind, rig, anim, root, ring, yaw: 0, targetYaw: 0, speed: 0, pos: root.position, alive: true };
    this.list.add(c);
    return c;
  }

  remove(c) { this.group.remove(c.root); c.rig.mesh.geometry.dispose(); this.list.delete(c); }

  select(c, on, ai = false) { c.ring.visible = on; c.ring.material = ai ? this.ringMatAI : this.ringMat; }

  update(dt, camera) {
    const cp = camera.position;
    for (const c of this.list) {
      // turn smoothly toward the heading
      let d = c.targetYaw - c.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      c.yaw += d * Math.min(1, dt * 8);
      c.root.rotation.y = c.yaw;
      c.root.position.y = this.terrain.height(c.root.position.x, c.root.position.z) + (c.lift || 0);
      // animation LOD: far characters update at a lower rate
      const dist = c.root.position.distanceTo(cp);
      c.animAcc = (c.animAcc || 0) + dt;
      const interval = dist < 40 ? 0 : dist < 90 ? 1 / 20 : 1 / 10;
      if (c.animAcc >= interval) { c.anim.update(c.animAcc, c.speed); c.animAcc = 0; }
      c.rig.mesh.visible = dist < 320;
    }
  }
}

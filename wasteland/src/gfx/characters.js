// Character manager: spawns rigged humanoids, keeps them grounded on the terrain
// with smoothed turning, drives the animator from simulation state (speed, work
// kind, aim), swaps the rifle between back and shoulder, shows carried loads and
// hand tools, selection rings, and sinks corpses into the ground before removal.
import * as THREE from 'three';
import { buildHumanoid, setRifleAim, setCarry, setTool } from './humanoid.js';
import { Animator } from './animator.js';

const TOOL = { chop: 'axe', dig: 'shovel', farm: 'shovel', build: 'hammer' };
const _v = new THREE.Vector3();

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
    this.ringMatBad = new THREE.MeshBasicMaterial({ color: 0xd0513e, transparent: true, opacity: 0.85, depthWrite: false });
  }

  async init(assets) {
    this.fabric = await assets.textureSet('wool');
  }

  spawn(kind, seed, x, z, opts = {}) {
    const rig = buildHumanoid(seed, kind, this.fabric, opts);
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
    const c = { kind, seed, rig, anim, root, ring, yaw: opts.yaw ?? 0, targetYaw: opts.yaw ?? 0, speed: 0, pos: root.position, alive: true, lift: 0, hidden: false, carry: null, sink: 0 };
    root.rotation.y = c.yaw;
    this.list.add(c);
    return c;
  }

  remove(c) {
    this.group.remove(c.root);
    c.rig.mesh.geometry.dispose();
    c.rig.rifle?.geometry.dispose();
    c.rig.mesh.skeleton.dispose();
    this.list.delete(c);
  }

  select(c, on, style = 'human') { c.ring.visible = on; c.ring.material = style === 'ai' ? this.ringMatAI : style === 'bad' ? this.ringMatBad : this.ringMat; }

  /** World position of the rifle muzzle (or chest) for effects. */
  muzzle(c, out = new THREE.Vector3()) {
    const r = c.rig.rifle;
    if (r) { r.updateWorldMatrix(true, false); return out.copy(r.userData.muzzle).applyMatrix4(r.matrixWorld); }
    return out.set(c.root.position.x, c.root.position.y + 1.4, c.root.position.z);
  }

  update(dt, camera) {
    const cp = camera.position;
    for (const c of this.list) {
      // turn smoothly toward the heading
      let d = c.targetYaw - c.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      c.yaw += d * Math.min(1, dt * 8);
      c.root.rotation.y = c.yaw;
      const ground = this.terrain.height(c.root.position.x, c.root.position.z);
      if (c.sink > 0) c.root.position.y = ground - c.sink;
      else c.root.position.y = ground + (c.lift || 0);
      c.root.visible = !c.hidden && !c.fp;
      if (c.hidden) continue;
      // animation LOD: far characters update at a lower rate
      const dist = _v.copy(c.root.position).distanceTo(cp);
      c.animAcc = (c.animAcc || 0) + dt;
      const interval = dist < 40 ? 0 : dist < 90 ? 1 / 20 : 1 / 10;
      if (c.animAcc >= interval) {
        c.anim.carrying = !!c.carry;
        c.anim.update(c.animAcc, c.speed);
        c.animAcc = 0;
        const st = c.anim.state;
        setRifleAim(c.rig, st === 'aim' ? 1 : 0);
        setTool(c.rig, st === 'work' ? TOOL[c.anim.work] || null : null);
        setCarry(c.rig, c.carry || null);
      }
      c.rig.mesh.visible = dist < 340;
      if (c.rig.rifle) c.rig.rifle.visible = dist < 120;
    }
  }
}

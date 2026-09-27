// Tunnel rats: they slip under the barricades, run up the trackbed, climb the platform and head for the food.
import * as THREE from 'three';
import { instance } from './assets.js';
import { TRACK_X, TRACK_Y, EDGE, OPENINGS, PYLON_OUT, BAYS } from './layout.js';

const SCALE = 1.7;          // Poly Haven rat is ~15 cm body; brown rats are ~22-25 cm
const SPEED = 2.3;

export class Rats {
  constructor(scene, shelter) {
    this.scene = scene;
    this.shelter = shelter;
    this.list = [];
    this.nextWave = 75;
    this.tmp = new THREE.Vector3();
  }

  spawnWave(n, side, zs) {
    for (let i = 0; i < n; i++) {
      const o = new THREE.Group();
      const body = instance('street_rat', 10);
      body.scale.setScalar(SCALE);
      o.add(body);
      o.position.set(side * (TRACK_X + (Math.random() - 0.5) * 1.6), TRACK_Y, zs * (50 + Math.random() * 5));
      this.scene.add(o);
      const r = { o, body, hp: 2, side, zs, state: 'run', wp: [], wait: Math.random() * 1.5 + i * 0.4, phase: Math.random() * 10,
        eatT: 0, dead: false, deadT: 0, squeak: 2 + Math.random() * 4 };
      this.plan(r);
      this.list.push(r);
    }
  }

  // Waypoints: along the track into the station, up the platform wall, along the platform walkway,
  // through a pylon passage if the farm is on the other side, and into the farm bay.
  plan(r) {
    const s = r.side, farmZ = BAYS[0] + (Math.random() - 0.5) * 6 + 3;
    const climbZ = r.zs * (18 + Math.random() * 6);
    const lane = s * (TRACK_X - 1.1 + Math.random() * 0.3);
    r.wp = [
      new THREE.Vector3(lane, TRACK_Y, climbZ),
      new THREE.Vector3(s * (EDGE + 0.15), TRACK_Y, climbZ),
      new THREE.Vector3(s * (EDGE - 0.3), 0, climbZ),
      new THREE.Vector3(s * 9.3, 0, climbZ),
    ];
    if (s > 0) {
      // cross to the west platform through the passage nearest the farm
      const o1 = OPENINGS[1] + (Math.random() - 0.5);
      r.wp.push(new THREE.Vector3(9.3, 0, o1), new THREE.Vector3(PYLON_OUT - 1, 0, o1), new THREE.Vector3(-PYLON_OUT + 1, 0, o1 + 0.5), new THREE.Vector3(-8.9, 0, o1 + 0.3));
    } else {
      r.wp.push(new THREE.Vector3(-9.3, 0, farmZ));
    }
    r.wp.push(new THREE.Vector3(-7.4 - Math.random() * 0.8, 0, farmZ + (Math.random() - 0.5)));
  }

  update(dt, t, player, audio) {
    const sh = this.shelter;
    this.nextWave -= dt;
    if (this.nextWave <= 0) {
      const day = sh.day();
      const n = Math.min(2 + Math.floor(day * 0.8) + Math.floor(Math.random() * 2), 9);
      const side = Math.random() < 0.5 ? 1 : -1, zs = Math.random() < 0.5 ? 1 : -1;
      this.spawnWave(n, side, zs);
      this.onWave?.(n, side, zs);
      this.nextWave = Math.max(45, 110 - day * 7) + Math.random() * 30;
    }
    let eating = 0;
    for (const r of this.list) {
      const o = r.o;
      if (r.dead) {
        r.deadT += dt;
        if (r.deadT > 20) { this.scene.remove(o); r.gone = true; }
        continue;
      }
      r.squeak -= dt;
      if (r.squeak < 0) { audio?.squeak(o.position); r.squeak = 3 + Math.random() * 6; }
      // chase the player if close on the same level
      const dp = this.tmp.copy(player.pos).sub(o.position);
      const near = Math.abs(dp.y) < 0.6 && Math.hypot(dp.x, dp.z) < 3.5;
      if (r.wait > 0) { r.wait -= dt; this.idle(r, t); continue; }
      let target;
      if (near) {
        target = player.pos;
        if (Math.hypot(dp.x, dp.z) < 0.55) {
          r.biteT = (r.biteT || 0) - dt;
          if (r.biteT <= 0) { this.onBite?.(4); r.biteT = 1.3; audio?.squeak(o.position, true); }
          this.idle(r, t);
          continue;
        }
      } else if (r.wp.length) target = r.wp[0];
      else { r.state = 'eat'; eating++; this.idle(r, t, true); continue; }

      const to = new THREE.Vector3(target.x - o.position.x, 0, target.z - o.position.z);
      const d = to.length();
      if (!near && d < 0.2) {
        const reached = r.wp.shift();
        o.position.y = reached.y;
        if (Math.random() < 0.35) r.wait = 0.3 + Math.random() * 1.2;   // freeze-and-sniff pauses
        continue;
      }
      // climbing the platform wall: interpolate height across the 0.45 m before the edge
      const next = r.wp[0];
      if (!near && next && Math.abs(next.y - o.position.y) > 0.3 && d < 0.5) o.position.y = THREE.MathUtils.lerp(next.y, o.position.y, d / 0.5);
      to.normalize();
      const sp = SPEED * (0.8 + 0.3 * Math.sin(t * 5 + r.phase));
      o.position.addScaledVector(to, Math.min(sp * dt, d));
      const yaw = Math.atan2(to.x, to.z);
      o.rotation.y = lerpAngle(o.rotation.y, yaw, 1 - Math.exp(-dt * 14));
      // scurry: quick body undulation, never floats
      r.body.position.y = Math.abs(Math.sin(t * 22 + r.phase)) * 0.012;
      r.body.rotation.x = Math.sin(t * 22 + r.phase) * 0.06;
      r.body.rotation.z = Math.sin(t * 11 + r.phase) * 0.05;
      if (!near) {
        // stay on the level the rat is traversing
        if (o.position.y < -0.5 && Math.abs(o.position.x) < EDGE + 0.1 && !(next && next.y === 0)) o.position.x = Math.sign(o.position.x) * (EDGE + 0.15);
      }
    }
    this.list = this.list.filter((r) => !r.gone);
    return eating;
  }

  idle(r, t, eating = false) {
    r.body.position.y = 0;
    r.body.rotation.x = eating ? -0.12 + Math.sin(t * 9 + r.phase) * 0.05 : Math.sin(t * 3 + r.phase) * 0.03;
    r.body.rotation.z = 0;
    if (eating) r.o.rotation.y += Math.sin(t * 1.3 + r.phase) * 0.01;
  }

  // Ray test against rat bounding spheres; returns {rat, dist} or null.
  hit(ray, maxDist) {
    let best = null;
    const sphere = new THREE.Sphere();
    for (const r of this.list) {
      if (r.dead) continue;
      sphere.center.copy(r.o.position).add(new THREE.Vector3(0, 0.05, 0));
      sphere.radius = 0.16;
      const p = ray.intersectSphere(sphere, new THREE.Vector3());
      if (!p) continue;
      const d = p.distanceTo(ray.origin);
      if (d < maxDist && (!best || d < best.dist)) best = { rat: r, dist: d, point: p };
    }
    return best;
  }

  damage(r, n) {
    r.hp -= n;
    if (r.hp <= 0 && !r.dead) {
      r.dead = true;
      r.body.rotation.set(0, 0, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
      r.body.position.y = 0.035;
      this.onKill?.(r);
    } else {
      r.wait = 0; r.wp.length && (r.wait = 0);
    }
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

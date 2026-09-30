// Character manager: spawns survivors and infected, keeps them grounded with
// smoothed turning, drives their animation from simulation state (speed, work,
// aim), shows gear (rucksack, tools in hand, loads carried in both arms, the
// rifle slung or shouldered), selection rings, and sinks corpses before removal.
// Uses the character kit (Quaternius CC0 bodies, outfits and animation library);
// falls back to the procedural humanoid if the kit failed to load.
import * as THREE from 'three';
import { buildHumanoid, setRifleAim, setCarry, setTool } from './humanoid.js';
import { Animator } from './animator.js';
import { CharacterKit } from './charkit.js';
import { CharAnim, rigInfo } from './charanim.js';
import { Gear } from './gear.js';

const TOOL = { chop: 'axe', dig: 'shovel', farm: 'shovel', build: 'hammer' };
const MUZZLE = new THREE.Vector3(0, 0.016, 0.79);
const _v = new THREE.Vector3(), _s = new THREE.Sphere(), _f = new THREE.Frustum(), _pm = new THREE.Matrix4();

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
    this.kit = await CharacterKit.load(assets).catch((e) => { assets.fail('characters', e); return null; });
    if (this.kit) this.gear = new Gear(this.world.town.mats);
    else this.fabric = await assets.textureSet('wool');
  }

  spawn(kind, seed, x, z, opts = {}) {
    const root = new THREE.Group();
    root.position.set(x, this.terrain.height(x, z), z);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.visible = false;
    ring.position.y = 0.06;
    ring.renderOrder = 4;
    root.add(ring);
    this.group.add(root);
    const c = { kind, seed, root, ring, yaw: opts.yaw ?? 0, targetYaw: opts.yaw ?? 0, speed: 0, pos: root.position, alive: true, lift: 0, hidden: false, carry: null, sink: 0, props: {} };
    root.rotation.y = c.yaw;
    if (this.kit) {
      const infected = kind === 'infected';
      const look = this.kit.appearance(seed, infected ? 'infected' : 'survivor', { gender: opts.gender });
      if (opts.pack === false || infected) look.pack = false;
      const ch = this.kit.build(look);
      root.add(ch.root);
      c.ch = ch;
      c.anim = new CharAnim(this.kit, ch, { infected, seed });
      c.anim.armed = !!opts.rifle;
      c.rigInfo = rigInfo(this.kit, ch.gender);
      if (!infected && (opts.pack ?? (seed % 4 !== 0))) this.#attach(c, 'pack', 'spine_03', c.rigInfo.attach.back);
      if (opts.rifle) { c.props.rifle = this.gear.create('rifle'); root.add(c.props.rifle); }
    } else {
      const rig = buildHumanoid(seed, kind, this.fabric, opts);
      root.add(rig.mesh);
      c.rig = rig;
      c.anim = new Animator(rig, { infected: kind === 'infected', seed });
    }
    this.list.add(c);
    return c;
  }

  #attach(c, kind, bone, frame) {
    const p = this.gear.create(kind);
    p.matrixAutoUpdate = false;
    p.matrix.copy(frame);
    c.ch.bones.get(bone).add(p);
    c.props[kind] = p;
    return p;
  }

  remove(c) {
    this.group.remove(c.root);
    if (c.ch) c.ch.dispose();
    else { c.rig.mesh.geometry.dispose(); c.rig.rifle?.geometry.dispose(); c.rig.mesh.skeleton.dispose(); }
    this.list.delete(c);
  }

  select(c, on, style = 'human') { c.ring.visible = on; c.ring.material = style === 'ai' ? this.ringMatAI : style === 'bad' ? this.ringMatBad : this.ringMat; }

  /** World position of the rifle muzzle (or chest) for effects. */
  muzzle(c, out = new THREE.Vector3()) {
    const r = c.props?.rifle || c.rig?.rifle;
    if (r) {
      r.updateWorldMatrix(true, false);
      return out.copy(c.props?.rifle ? MUZZLE : r.userData.muzzle).applyMatrix4(r.matrixWorld);
    }
    return out.set(c.root.position.x, c.root.position.y + 1.4, c.root.position.z);
  }

  update(dt, camera) {
    const cp = camera.position;
    _f.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const night = this.world.sky?.isNight;
    for (const c of this.list) {
      // turn smoothly toward the heading
      let d = c.targetYaw - c.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      c.yaw += d * Math.min(1, dt * 8);
      c.root.rotation.y = c.yaw;
      const ground = this.terrain.height(c.root.position.x, c.root.position.z);
      // the sitting clips are authored for a chair; the camp's log seats are lower
      const seat = c.ch && c.anim.state === 'sit' ? -0.12 : 0;
      if (c.sink > 0) c.root.position.y = ground - c.sink;
      else c.root.position.y = ground + (c.lift || 0) + seat;
      const shown = !c.hidden && !c.fp;
      c.root.visible = shown;
      if (!shown) continue;
      const dist = _v.copy(c.root.position).distanceTo(cp);
      // animation LOD: nearby every frame, then 20 / 10 Hz, off-screen rarely
      _s.center.copy(c.root.position); _s.center.y += 0.9; _s.radius = 1.2;
      const onScreen = _f.intersectsSphere(_s);
      c.animAcc = (c.animAcc || 0) + dt;
      const interval = !onScreen ? 0.5 : dist < 40 ? 0 : dist < 90 ? 1 / 20 : 1 / 10;
      if (c.animAcc >= interval) {
        c.anim.carrying = !!c.carry;
        if (c.ch) {
          c.anim.night = night; c.anim.onTower = (c.lift || 0) > 1.5;
          c.anim.update(Math.min(c.animAcc, 0.5), c.speed);
          this.#props(c, dist, onScreen);
        } else {
          c.anim.update(c.animAcc, c.speed);
          const st = c.anim.state;
          setRifleAim(c.rig, st === 'aim' ? 1 : 0);
          setTool(c.rig, st === 'work' ? TOOL[c.anim.work] || null : null);
          setCarry(c.rig, c.carry || null);
        }
        c.animAcc = 0;
      }
      if (c.ch) {
        c.ch.mesh.visible = dist < 340;
        // small gear disappears first (a few pixels at most beyond ~70 m)
        for (const [k, p] of Object.entries(c.props)) if (p) p.visible = dist < (k === 'pack' || k === 'load' ? 110 : 70);
      } else {
        c.rig.mesh.visible = dist < 340;
        if (c.rig.rifle) c.rig.rifle.visible = dist < 120;
      }
    }
  }

  #props(c, dist, onScreen) {
    const a = c.anim;
    // hand tool while working
    const tool = a.state === 'work' ? a.tool : null;
    if (c.toolKind !== tool) {
      if (c.props.tool) { c.props.tool.parent?.remove(c.props.tool); delete c.props[c.toolKind]; c.props.tool = null; }
      c.toolKind = tool;
      if (tool) { c.props.tool = this.#attach(c, tool, 'hand_r', c.rigInfo.grip.r); delete c.props[tool]; }
    }
    // load carried in both arms
    const load = c.carry || null;
    if (c.loadKind !== load) {
      if (c.props.load) { c.props.load.parent?.remove(c.props.load); c.props.load = null; }
      c.loadKind = load;
      if (load) { c.props.load = this.#attach(c, load, 'spine_03', c.rigInfo.attach.chest); delete c.props[load]; }
    }
    // rifle: slung, or shouldered with the arms solved onto it (near and on screen)
    if (c.props.rifle && onScreen && dist < 140) a.applyAim(c.props.rifle, c.root);
  }
}

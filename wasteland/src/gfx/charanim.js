// Animation for kit characters (Universal Animation Library clips).
//  * locomotion is a blend space: walk and jog play phase-locked (both clips
//    advance through the same gait cycle), weighted so stride x cadence equals
//    the character's real ground speed; feet stay planted at any speed. The
//    infected shamble, loads are carried in both arms.
//  * work (chop, build, farm, scavenge, guard, eat), sitting, sleeping,
//    melee, hits and death map to their clips, cross-faded
//  * rifles: slung on the back, or shouldered by an aim solver (stock in the
//    shoulder pocket, muzzle on the target) with two-bone IK bringing both
//    hands onto the grip and fore-end
import * as THREE from 'three';

const FADE = 0.25;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- rig data per body
const rigCache = new Map();
/** Rest-pose frames for props and IK, computed once per kit body type. */
export function rigInfo(kit, g) {
  const key = kit.skel[g];
  if (rigCache.has(key)) return rigCache.get(key);
  const root = kit.skel[g].root;
  root.updateMatrixWorld(true);
  const B = (n) => root.getObjectByName(n);
  const P = (n) => new THREE.Vector3().setFromMatrixPosition(B(n).matrixWorld);
  const info = { grip: {}, handAxes: {}, attach: {} };
  for (const s of ['r', 'l']) {
    const hand = P(`hand_${s}`), idx = P(`index_01_${s}`), pin = P(`pinky_01_${s}`), mid = P(`middle_01_${s}`), th = P(`thumb_01_${s}`);
    const fingers = mid.clone().sub(hand).normalize();
    const knuckle = idx.clone().sub(pin).normalize();
    let palm = new THREE.Vector3().crossVectors(knuckle, fingers).normalize();
    if (palm.dot(th.clone().sub(hand)) < 0) palm.negate();
    // fist centre: across the knuckles, pulled into the palm
    const grip = idx.clone().add(pin).multiplyScalar(0.5).addScaledVector(palm, 0.03).addScaledVector(fingers, -0.01);
    const Y = knuckle.clone(), Z = fingers.clone().addScaledVector(knuckle, -fingers.dot(knuckle)).normalize(), X = new THREE.Vector3().crossVectors(Y, Z);
    const frame = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(grip);
    const inv = B(`hand_${s}`).matrixWorld.clone().invert();
    info.grip[s] = inv.clone().multiply(frame);
    // hand-local knuckle and finger directions (to orient hands in IK)
    const rot = new THREE.Matrix3().setFromMatrix4(inv);
    info.handAxes[s] = { knuckle: knuckle.clone().applyMatrix3(rot).normalize(), fingers: fingers.clone().applyMatrix3(rot).normalize(), palm: palm.clone().applyMatrix3(rot).normalize() };
  }
  const spine = B('spine_03').matrixWorld, sp = P('spine_03'), head = P('Head');
  const at = (p, rot = new THREE.Matrix4()) => spine.clone().invert().multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(rot));
  info.attach.back = at(sp.clone().add(new THREE.Vector3(0, 0.03, 0)));
  info.attach.chest = at(sp.clone().add(new THREE.Vector3(0, -0.1, -0.02)));
  // slung rifle: diagonal across the back, muzzle up behind the right shoulder
  const sling = new THREE.Matrix4().makeRotationZ(0.62).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  info.attach.slung = at(sp.clone().add(new THREE.Vector3(0.02, -0.02, -0.19)), sling);
  info.shoulderH = P('upperarm_r').y;
  info.eyeH = head.y + 0.1;
  info.arm = P('lowerarm_r').distanceTo(P('upperarm_r')) + P('hand_r').distanceTo(P('lowerarm_r'));
  rigCache.set(key, info);
  return info;
}

// ---------------------------------------------------------------- IK
function worldQuat(o, out) { return o.getWorldQuaternion(out); }
/** Rotate bone (in world space) by delta quaternion. */
function rotateWorld(bone, delta) {
  worldQuat(bone, _q2);
  const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
  bone.quaternion.copy(parentQ.invert().multiply(delta.multiply(_q2)));
  bone.updateMatrixWorld(true);
}
/** Two-bone IK: place the wrist of upper->lower->hand at target, elbow towards pole. */
function solveArm(upper, lower, hand, target, pole) {
  const S = upper.getWorldPosition(_a), E = lower.getWorldPosition(_b), W = hand.getWorldPosition(_c);
  const la = S.distanceTo(E), lb = E.distanceTo(W);
  const d = _v.copy(target).sub(S);
  const dist = Math.min(la + lb - 1e-3, Math.max(Math.abs(la - lb) + 1e-3, d.length()));
  d.normalize();
  const pl = _w.copy(pole).sub(S); pl.addScaledVector(d, -pl.dot(d)).normalize();
  const cosA = (la * la + dist * dist - lb * lb) / (2 * la * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const E2 = new THREE.Vector3().copy(S).addScaledVector(d, la * cosA).addScaledVector(pl, la * sinA);
  // upper arm: current elbow direction -> desired
  rotateWorld(upper, _q.setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize()));
  const E3 = lower.getWorldPosition(new THREE.Vector3()), W3 = hand.getWorldPosition(new THREE.Vector3());
  const tgt = S.clone().addScaledVector(d, dist);
  rotateWorld(lower, _q.setFromUnitVectors(W3.sub(E3).normalize(), tgt.sub(E3).normalize()));
}
/** Orient a hand so its knuckle line and fingers follow the given world directions. */
function orientHand(hand, axes, knuckle, fingers) {
  const k = knuckle.clone().normalize(), f = fingers.clone().addScaledVector(k, -fingers.dot(k)).normalize();
  const des = new THREE.Matrix4().makeBasis(k, f, new THREE.Vector3().crossVectors(k, f));
  const kl = axes.knuckle, fl = axes.fingers.clone().addScaledVector(kl, -axes.fingers.dot(kl)).normalize();
  const rest = new THREE.Matrix4().makeBasis(kl, fl, new THREE.Vector3().crossVectors(kl, fl));
  const qWorld = new THREE.Quaternion().setFromRotationMatrix(des.multiply(rest.transpose()));
  const parentQ = hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  hand.quaternion.copy(parentQ.multiply(qWorld));
  hand.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- controller
const WORK = {
  chop: ['TreeChopping_Loop'], build: ['Fixing_Kneeling', 'Interact'], repair: ['Fixing_Kneeling'], craft: ['Fixing_Kneeling', 'Interact'],
  medic: ['Fixing_Kneeling'], dig: ['Farm_Harvest', 'Farm_PlantSeed'], farm: ['Farm_PlantSeed', 'Farm_Harvest', 'Farm_Watering'],
  scavenge: ['Chest_Open', 'PickUp_Table', 'Interact'], eat: ['Consume'], carry: ['PickUp_Table'],
};
const TOOL = { chop: 'axe', build: 'hammer', repair: 'hammer', craft: 'hammer' };

export class CharAnim {
  constructor(kit, ch, { infected = false, seed = 1 } = {}) {
    this.kit = kit; this.ch = ch; this.g = ch.gender; this.mixer = ch.mixer;
    this.infected = infected;
    this.rig = rigInfo(kit, ch.gender);
    this.state = 'idle'; this.prev = 'idle'; this.stateT = 0; this.t = 0;
    this.work = 'build'; this.carrying = false; this.armed = false; this.night = false; this.onTower = false;
    this.speed = 0; this.phase = (seed * 0.618) % 1;
    this.layers = new Map();
    this.seed = seed;
    this.aimW = 0; this.aimPitch = 0; this.recoil = 0;
    this.hitT = -1; this.hitClip = 'Hit_Chest';
    this.workIdx = 0; this.workT = 0; this.idleClip = 'Idle_Loop'; this.idleT = 0;
    this.tool = null;
    this.gait = this.#gaitData();
  }

  get weights() { const o = {}; for (const [k, l] of this.layers) o[k] = l.w; return o; }
  set weights(v) { for (const l of this.layers.values()) l.w = l.target = 0; for (const [k, w] of Object.entries(v)) { const l = this.#layer(this.#stateClip(k) || k); if (l) l.w = l.target = w; } }

  set(state) { if (state !== this.state) { this.prev = this.state; this.state = state; this.stateT = 0; if (state === 'dead') this.#restart('Death01'); if (state === 'sit') this.#restart('Sitting_Enter'); } }
  hit() { if (this.state === 'dead') return; this.hitT = 0; this.hitClip = this.infected && Math.random() < 0.4 ? 'Hit_Knockback' : Math.random() < 0.5 ? 'Hit_Head' : 'Hit_Chest'; this.#restart(this.hitClip); }
  shoot() { this.recoil = 1; }

  #gaitData() {
    const S = this.kit.speeds, clip = (n) => this.kit.clip(this.g, n);
    const walk = clip('Walk_Loop'), jog = clip('Jog_Fwd_Loop'), zw = clip('Zombie_Walk_Fwd_Loop'), carry = clip('Walk_Carry_Loop');
    const d = (c, n) => ({ dur: c.duration, stride: (S[n] || 1) * c.duration });
    return { walk: d(walk, 'Walk_Loop'), jog: d(jog, 'Jog_Fwd_Loop'), zombie: d(zw, 'Zombie_Walk_Fwd_Loop'), carry: d(carry, 'Walk_Carry_Loop') };
  }

  #layer(name) {
    let l = this.layers.get(name);
    if (l) return l;
    const clip = this.kit.clip(this.g, name);
    if (!clip) return null;
    const action = this.mixer.clipAction(clip);
    const once = /Death|Enter|Exit|Hit_|Pistol_Shoot/.test(name);
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.enabled = true;
    action.setEffectiveWeight(0);
    action.play();
    l = { name, action, w: 0, target: 0, time: null, gain: 1 };
    this.layers.set(name, l);
    return l;
  }
  #restart(name) { const l = this.#layer(name); if (l) { l.action.reset(); l.action.play(); } }

  #stateClip(state) {
    if (state === 'idle') return this.infected ? 'Zombie_Idle_Loop' : this.idleClip;
    if (state === 'attack') return this.infected ? 'Zombie_Scratch' : 'Punch_Cross';
    if (state === 'dead') return 'Death01';
    if (state === 'sleep') return 'LayToIdle';
    return null;
  }

  /** Target weights (and fixed times for phase-locked clips) for this frame. */
  #targets(dt) {
    const T = new Map();
    const set = (n, w, time = null, gain = 1) => { const l = this.#layer(n); if (l) { T.set(n, w); l.time = time; l.gain = gain; } };
    const moving = (this.state === 'walk' || this.state === 'run') && this.speed > 0.05;
    const st = moving ? 'move' : this.state === 'walk' || this.state === 'run' ? 'idle' : this.state;
    this.tool = null;
    if (st === 'move') this.#locomotion(set, dt);
    else if (st === 'idle') {
      if (this.infected) set('Zombie_Idle_Loop', 1);
      else {
        // an occasional fidget between plain idles
        this.idleT += dt;
        if (this.idleT > 7 + (this.seed % 5)) { this.idleT = 0; this.idleClip = this.idleClip === 'Idle_Loop' ? ['Idle_FoldArms_Loop', 'Idle_Talking_Loop', 'Idle_Loop'][Math.floor(Math.random() * 3)] : 'Idle_Loop'; }
        set(this.idleClip, 1);
      }
      // arms around the load over the idle legs (upper-body clip, dominant weight)
      if (this.carrying) set('Carry_Arms', 1, 0.35, 40);
    } else if (st === 'work') {
      if (this.work === 'guard') {
        if (this.onTower) set('Idle_Rail_Loop', 1);
        else if (this.armed) { set('Pistol_Idle_Loop', 1); }
        else set(this.night ? 'Idle_Torch_Loop' : 'Idle_FoldArms_Loop', 1);
      } else {
        const list = WORK[this.work] || ['Interact'];
        this.workT += dt;
        const cur = list[this.workIdx % list.length];
        const clip = this.kit.clip(this.g, cur);
        if (clip && this.workT > clip.duration * (list.length > 1 ? 2 : 1e9)) { this.workT = 0; this.workIdx++; }
        set(list[this.workIdx % list.length], 1);
        this.tool = TOOL[this.work] || null;
      }
    } else if (st === 'sit') {
      const enter = this.kit.clip(this.g, 'Sitting_Enter');
      if (this.stateT < enter.duration * 0.9) set('Sitting_Enter', 1);
      else set((this.seed % 3 === 0) ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop', 1);
    } else if (st === 'sleep') set('LayToIdle', 1, 0);
    else if (st === 'aim') set(this.speed > 0.3 ? 'Walk_Loop' : 'Pistol_Idle_Loop', 1);
    else if (st === 'attack') set(this.infected ? 'Zombie_Scratch' : (Math.floor(this.stateT / 1.0) % 2 ? 'Punch_Jab' : 'Punch_Cross'), 1);
    else if (st === 'dead') set('Death01', 1);
    else set(this.infected ? 'Zombie_Idle_Loop' : 'Idle_Loop', 1);
    // hit reaction over whatever is playing
    if (this.hitT >= 0) {
      const c = this.kit.clip(this.g, this.hitClip);
      this.hitT += dt;
      if (!c || this.hitT > c.duration) this.hitT = -1;
      else { const k = this.hitT / c.duration; T.set(this.hitClip, Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.85); }
    }
    return T;
  }

  #locomotion(set, dt) {
    const s = this.speed, G = this.gait;
    if (this.infected || this.carrying) {
      const g = this.infected ? G.zombie : G.carry;
      const cycle = g.stride / Math.max(0.25, s);
      this.phase = (this.phase + dt / cycle) % 1;
      set(this.infected ? 'Zombie_Walk_Fwd_Loop' : 'Walk_Carry_Loop', 1, this.phase * g.dur);
      return;
    }
    // walk (sped up to 1.55x before blending) <-> jog, phase locked
    const cw = G.walk.stride, dwf = G.walk.dur / 1.55, cj = G.jog.stride, dj = G.jog.dur;
    let w = 0, cycle;
    if (s <= cw / dwf) cycle = cw / Math.max(0.3, s);
    else {
      w = Math.min(1, Math.max(0, (s * dwf - cw) / ((cj - cw) - s * (dj - dwf))));
      cycle = (cw + (cj - cw) * w) / s;
    }
    this.phase = (this.phase + dt / cycle) % 1;
    set('Walk_Loop', 1 - w, this.phase * G.walk.dur);
    set('Jog_Fwd_Loop', w, this.phase * G.jog.dur);
  }

  update(dt, speed) {
    this.t += dt; this.stateT += dt; this.speed = speed;
    const T = this.#targets(dt);
    // nothing playing yet (just spawned): start at full weight, never flash the bind pose
    let total = 0;
    for (const l of this.layers.values()) total += l.w;
    const snap = total < 0.05;
    for (const [name, l] of this.layers) {
      const target = T.get(name) ?? 0;
      const rate = dt / (this.state === 'dead' ? 0.15 : FADE);
      l.w = snap ? target : target > l.w ? Math.min(target, l.w + rate) : Math.max(target, l.w - rate);
      if (/^Hit_/.test(name)) l.w = target;
      if (l.time !== null && l.time !== undefined) { l.action.time = l.time; l.action.timeScale = 0; } else l.action.timeScale = 1;
      l.action.setEffectiveWeight(l.w * l.gain);
      if (l.w <= 0 && target <= 0) { l.action.stop(); this.layers.delete(name); }
    }
    this.mixer.update(dt);
    // rifle shouldered in aim (and at low ready when guarding)
    const wantAim = this.armed && !this.infected && (this.state === 'aim' || (this.state === 'work' && this.work === 'guard' && !this.onTower)) ? 1 : 0;
    this.aimW = snap ? wantAim : this.aimW + (wantAim - this.aimW) * Math.min(1, dt * 6);
    this.aimPitch = this.state === 'aim' ? -0.04 : -0.55;
    this.recoil = Math.max(0, this.recoil - dt * 7);
  }

  /** Place the rifle (a child of root) and bend the arms onto it. Call after update(). */
  applyAim(rifle, root) {
    if (!rifle) return;
    const bones = this.ch.bones, rig = this.rig;
    root.updateMatrixWorld(true);
    const spine = bones.get('spine_03');
    const place = (p, q) => {
      rifle.position.copy(root.worldToLocal(p.clone()));
      rifle.quaternion.copy(root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    };
    // slung frame from the back
    const slung = _m.multiplyMatrices(spine.matrixWorld, rig.attach.slung);
    const pS = new THREE.Vector3(), qS = new THREE.Quaternion(), s = new THREE.Vector3();
    slung.decompose(pS, qS, s);
    if (this.aimW < 0.02) { place(pS, qS); return; }
    // aim frame: stock in the right shoulder pocket, pointing forward with pitch
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(fwd, UP).normalize(); // character's right
    const pitch = this.aimPitch + this.recoil * 0.06;
    const dir = fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch)).normalize();
    const sh = bones.get('upperarm_r').getWorldPosition(new THREE.Vector3());
    const aiming = this.state === 'aim' ? 1 : 0;
    const butt = sh.addScaledVector(side, -0.1 * aiming - 0.05).addScaledVector(UP, 0.035 * aiming - 0.03).addScaledVector(fwd, 0.07 - this.recoil * 0.03);
    const origin = butt.clone().addScaledVector(dir, 0.4);
    const rUp = new THREE.Vector3().crossVectors(side, dir).normalize();
    const aim = new THREE.Matrix4().makeBasis(side.clone().negate(), rUp, dir).setPosition(origin);
    // blend slung -> aimed
    const pA = new THREE.Vector3(), qA = new THREE.Quaternion();
    aim.decompose(pA, qA, s);
    const k = this.aimW * this.aimW * (3 - 2 * this.aimW);
    place(pS.lerp(pA, k), qS.slerp(qA, k));
    if (k < 0.6) return;
    // hands onto grip and fore-end
    const gripR = origin.clone().addScaledVector(rUp, -0.05).addScaledVector(dir, -0.02);
    const gripL = origin.clone().addScaledVector(dir, 0.3).addScaledVector(rUp, -0.035);
    const shR = bones.get('upperarm_r').getWorldPosition(new THREE.Vector3()), shL = bones.get('upperarm_l').getWorldPosition(new THREE.Vector3());
    solveArm(bones.get('upperarm_r'), bones.get('lowerarm_r'), bones.get('hand_r'), gripR, shR.clone().addScaledVector(UP, -0.6).addScaledVector(side, 0.35).addScaledVector(fwd, -0.1));
    solveArm(bones.get('upperarm_l'), bones.get('lowerarm_l'), bones.get('hand_l'), gripL, shL.clone().addScaledVector(UP, -0.6).addScaledVector(side, -0.1));
    orientHand(bones.get('hand_r'), rig.handAxes.r, dir, rUp.clone().negate().addScaledVector(dir, 0.3));
    orientHand(bones.get('hand_l'), rig.handAxes.l, dir, side.clone().multiplyScalar(0.8).addScaledVector(rUp, -0.6));
    // cheek down onto the stock when aiming
    if (aiming) {
      const head = bones.get('Head');
      rotateWorld(head, _q.setFromAxisAngle(side, 0.16 * k));
      rotateWorld(head, _q.setFromAxisAngle(fwd, 0.14 * k));
    }
  }
}

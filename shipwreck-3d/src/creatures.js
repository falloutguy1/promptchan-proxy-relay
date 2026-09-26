import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rand, rr, srand, clamp, lerp, smooth, fbm3, noise3, sweep, circle } from './util.js';
import { sandH } from './environment.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// tapered limb segment from origin along +y of given length
function limbGeo(len, r0, r1, bend = 0) {
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(V(Math.sin(t * Math.PI) * bend, t * len, 0)); }
  return sweep(pts, circle(1, 12), { scale: (s) => lerp(r0, r1, s) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, s * 1.1 + 0.1))), uvScale: 1 });
}

let shared = null;
function sharedAssets(bump) {
  if (shared) return shared;
  // carapace
  const g = new THREE.SphereGeometry(1, 72, 36);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = V(p.getX(i), p.getY(i), p.getZ(i));
    const phi = Math.atan2(v.z, v.x);
    let y = v.y;
    const rim = Math.exp(-Math.pow((y + 0.05) / 0.16, 2));
    let r = 1 + fbm3(v.x * 2.2, v.y * 2.2, v.z * 2.2, 4) * 0.22 + rim * 0.22 * Math.pow(Math.max(0, Math.cos(phi * 11)), 4);
    r += 0.05 * Math.sin(phi * 14) * smooth(0.2, 0.7, y) * smooth(1.0, 0.8, y);
    v.multiplyScalar(r);
    if (v.y < 0) v.y *= 0.3; else v.y *= 0.72;
    v.x *= 1.25; v.z *= 1.05;
    p.setXYZ(i, v.x, v.y, v.z);
    const top = smooth(-0.1, 0.8, y), mott = fbm3(v.x * 3, v.y * 3, v.z * 3, 3);
    const c0 = [0.5, 0.26, 0.2], c1 = [0.13, 0.05, 0.05], c2 = [0.3, 0.1, 0.1];
    let c = [lerp(c0[0], c1[0], top), lerp(c0[1], c1[1], top), lerp(c0[2], c1[2], top)];
    const m = smooth(-0.2, 0.4, mott); c = [lerp(c[0], c2[0], m * 0.6), lerp(c[1], c2[1], m * 0.6), lerp(c[2], c2[2], m * 0.6)];
    if (y < -0.05) c = [0.42, 0.26, 0.2];
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const shellMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.12, clearcoatRoughness: 0.5, normalMap: bump, normalScale: new THREE.Vector2(1.0, 1.0), envMapIntensity: 0.6 });
  const fleshMat = new THREE.MeshPhysicalMaterial({ color: '#9a6252', roughness: 0.45, clearcoat: 0.4, normalMap: bump, normalScale: new THREE.Vector2(0.4, 0.4), sheen: 0.4, sheenColor: new THREE.Color('#ffb59a') });
  const limbMat = new THREE.MeshPhysicalMaterial({ color: '#4a1c1a', roughness: 0.4, clearcoat: 0.4, normalMap: bump, normalScale: new THREE.Vector2(0.5, 0.5) });
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#0a0806', roughness: 0.08, metalness: 0.2 });
  shared = { shell: g, shellMat, fleshMat, limbMat, eyeMat,
    upper: limbGeo(0.75, 0.11, 0.08, 0.08), lower: limbGeo(0.9, 0.08, 0.02, -0.06), joint: new THREE.SphereGeometry(0.1, 12, 8) };
  // pincer halves
  const pincer = (len, curve) => { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(V(Math.sin(t * 1.3) * curve, t * len, 0)); } return sweep(pts, circle(1, 12), { scale: (s) => [lerp(0.16, 0.02, s * s), lerp(0.1, 0.015, s)], uvScale: 1 }); };
  shared.pinA = pincer(0.75, 0.18); shared.pinB = pincer(0.6, -0.14);
  const palm = new THREE.SphereGeometry(0.2, 16, 12); palm.scale(1, 1.5, 0.8); shared.palm = palm;
  return shared;
}

export function buildMirelurk(bump, scale = 1) {
  const S = sharedAssets(bump);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const shell = new THREE.Mesh(S.shell, S.shellMat); shell.position.y = 1.0; body.add(shell);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), S.fleshMat); belly.scale.set(1.25, 0.55, 0.95); belly.position.y = 0.82; body.add(belly);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), S.fleshMat); face.scale.set(0.9, 0.75, 1.05); face.position.set(1.08, 0.82, 0); body.add(face);
  for (const s of [1, -1]) {
    const stalk = new THREE.Mesh(limbGeo(0.28, 0.045, 0.03), S.limbMat); stalk.position.set(1.12, 0.95, s * 0.14); stalk.rotation.z = -0.45; body.add(stalk);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), S.eyeMat); eye.position.set(1.25, 1.2, s * 0.15); body.add(eye);
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(limbGeo(0.24, 0.035, 0.01, 0.03), S.fleshMat); m.position.set(1.3, 0.72, s * (0.05 + k * 0.05)); m.rotation.set(0, 0, -2.3 + k * 0.2); body.add(m); }
  }
  const unitA = limbGeo(1, 0.13, 0.085, 0.06), unitB = limbGeo(1, 0.085, 0.02, -0.05), unitC = limbGeo(1, 0.16, 0.13);
  const bone = (geo, mat) => { const m = new THREE.Mesh(geo, mat); body.add(m); return m; };
  const place = (m, a, b) => { const d = b.clone().sub(a); const l = d.length(); m.position.copy(a); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.divideScalar(l)); m.scale.set(1, l, 1); };
  const legs = [];
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
    const hx = 0.5 - k * 0.55;
    const up = bone(unitA, S.limbMat), lo = bone(unitB, S.limbMat), kn = bone(S.joint, S.limbMat);
    legs.push({ up, lo, kn, s, hx, ph: k * 2.1 + (s > 0 ? 0 : Math.PI), spread: 1 + k * 0.1 });
  }
  const claws = [];
  for (const s of [1, -1]) {
    const a1 = bone(unitC, S.limbMat), a2 = bone(unitC, S.limbMat), el = bone(S.joint, S.limbMat);
    el.scale.setScalar(1.4);
    const hand = new THREE.Group(); body.add(hand);
    const palm = new THREE.Mesh(S.palm, S.limbMat); palm.position.y = 0.1; hand.add(palm);
    const fa = new THREE.Mesh(S.pinA, S.limbMat); fa.position.set(0.06, 0.3, 0); hand.add(fa);
    const fb = new THREE.Group(); fb.position.set(-0.06, 0.28, 0); hand.add(fb); fb.add(new THREE.Mesh(S.pinB, S.limbMat));
    claws.push({ a1, a2, el, hand, fb, s });
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.scale.setScalar(scale);
  const A = V(0, 0, 0), K = V(0, 0, 0), F = V(0, 0, 0);
  root.userData.update = (t, speed) => {
    const w = t * 4.5 * speed;
    const bob = Math.abs(Math.sin(w)) * 0.05 * speed;
    for (const l of legs) {
      const c = Math.sin(w + l.ph), lift = Math.max(0, Math.cos(w + l.ph)) * 0.22;
      A.set(l.hx, 0.8 - bob, l.s * 0.62);
      F.set(l.hx * 1.3 + c * 0.28, lift - bob, l.s * 1.85 * l.spread);
      K.set((A.x + F.x) * 0.5, 1.35 + lift * 0.5 - bob, l.s * 1.45 * l.spread);
      place(l.up, A, K); place(l.lo, K, F); l.kn.position.copy(K);
    }
    for (const c of claws) {
      const sw = Math.sin(t * 1.2 + c.s) * 0.12;
      A.set(0.95, 0.85 - bob, c.s * 0.5); K.set(1.35, 0.55 - bob, c.s * 1.05); F.set(2.05 + sw, 0.8 - bob + sw, c.s * 0.62);
      place(c.a1, A, K); place(c.a2, K, F); c.el.position.copy(K);
      c.hand.position.copy(F); c.hand.quaternion.setFromUnitVectors(V(0, 1, 0), V(1, 0.15, -c.s * 0.25).normalize());
      c.fb.rotation.z = -0.1 - Math.max(0, Math.sin(t * 2.2 + c.s * 2)) * 0.45;
    }
    body.position.y = bob;
    body.rotation.z = Math.sin(w * 0.5) * 0.03;
  };
  root.userData.update(0, 1);
  return root;
}

// ------------------------------------------------------------------ kneeling wanderer
export function buildWanderer(bump) {
  const coat = new THREE.MeshStandardMaterial({ color: '#3b3a2e', roughness: 0.92, normalMap: bump, normalScale: new THREE.Vector2(0.5, 0.5) });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2a24', roughness: 0.85, normalMap: bump, normalScale: new THREE.Vector2(0.4, 0.4) });
  const leather = new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.7 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: '#232427', roughness: 0.4, metalness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: '#5b3522', roughness: 0.55 });
  const g = new THREE.Group();
  const seg = (a, b, r0, r1, mat, joint = true) => {
    const d = b.clone().sub(a), len = d.length();
    const m = new THREE.Mesh(limbGeo(len, r0, r1), mat);
    m.position.copy(a); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    g.add(m);
    if (joint) { const j = new THREE.Mesh(new THREE.SphereGeometry(r1 * 1.02, 12, 10), mat); j.position.copy(b); g.add(j); }
    return m;
  };
  const boot = (x, y, z, rotY, pitch) => { const b = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.13, 0.12, 2, 0.05), leather); b.position.set(x, y, z); b.rotation.set(0, rotY, pitch); g.add(b); };
  // legs (kneeling on right knee, right = +z)
  seg(V(0, 0.66, 0.13), V(0.08, 0.14, 0.17), 0.12, 0.085, dark);
  seg(V(0.08, 0.14, 0.17), V(-0.4, 0.12, 0.19), 0.085, 0.06, dark, false);
  boot(-0.5, 0.1, 0.19, 0, -0.9);
  seg(V(0, 0.66, -0.13), V(0.46, 0.56, -0.2), 0.12, 0.085, dark);
  seg(V(0.46, 0.56, -0.2), V(0.43, 0.1, -0.21), 0.085, 0.06, dark, false);
  boot(0.5, 0.07, -0.21, 0, 0);
  // torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.36, 8, 16), coat);
  torso.scale.set(1, 1, 1.25); torso.position.set(0.15, 0.98, 0); torso.rotation.z = -0.55; g.add(torso);
  // coat skirt
  {
    const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(lerp(0.21, 0.36, Math.pow(t, 1.2)), -t * 0.66)); }
    const sk = new THREE.LatheGeometry(pts, 48);
    const p = sk.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); let y = p.getY(i); const back = Math.max(0, -Math.cos(a)); const f = 1 + Math.sin(a * 11 + y * 4) * 0.08 * (-y) + noise3(p.getX(i) * 5, y * 5, p.getZ(i) * 5) * 0.07; p.setX(i, p.getX(i) * f * (1 + back * 0.25 * -y)); p.setZ(i, p.getZ(i) * f * 1.12); p.setY(i, y * (1 + back * 0.2) + (y < -0.6 ? Math.sin(a * 5) * 0.03 : 0)); }
    sk.computeVertexNormals();
    const m = new THREE.Mesh(sk, coat); m.position.set(0, 0.8, 0); m.rotation.z = -0.25; m.material = coat.clone(); m.material.side = THREE.DoubleSide; g.add(m);
  }
  // backpack
  const pack = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.42, 0.34, 3, 0.06), leather); pack.position.set(-0.07, 1.06, 0); pack.rotation.z = -0.55; g.add(pack);
  const flap = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.16, 0.36, 2, 0.04), dark); flap.position.set(0.0, 1.2, 0); flap.rotation.z = -0.55; g.add(flap);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.44, 14), coat); roll.rotation.x = Math.PI / 2; roll.position.set(-0.2, 0.86, 0); g.add(roll);
  for (const z of [-0.12, 0.12]) { const st = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 6, 20, Math.PI), leather); st.position.set(0.12, 1.1, z); st.rotation.set(0, 0, 1.0); g.add(st); }
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 28), leather); belt.rotation.set(Math.PI / 2, 0.45, 0); belt.scale.set(1, 1.2, 1); belt.position.set(0.05, 0.8, 0); g.add(belt);
  // head + hood
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), coat); head.scale.set(1.05, 1.1, 1); head.position.set(0.42, 1.38, 0.05); g.add(head);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.155, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.66), dark); hood.position.set(0.39, 1.4, 0.05); hood.rotation.z = 0.8; hood.material = dark.clone(); hood.material.side = THREE.DoubleSide; g.add(hood);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 14), dark); tip.position.set(0.28, 1.43, 0.05); tip.rotation.z = 1.9; g.add(tip);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 8, 16), coat); scarf.rotation.set(Math.PI / 2, 0.4, 0); scarf.position.set(0.36, 1.26, 0.03); g.add(scarf);
  // arms
  seg(V(0.26, 1.24, 0.21), V(0.28, 1.0, 0.36), 0.075, 0.06, coat);
  seg(V(0.28, 1.0, 0.36), V(0.46, 1.2, 0.14), 0.06, 0.045, coat);
  seg(V(0.26, 1.24, -0.21), V(0.58, 1.05, -0.17), 0.075, 0.06, coat);
  seg(V(0.58, 1.05, -0.17), V(0.84, 1.26, 0.04), 0.06, 0.045, coat);
  // rifle
  const rifle = new THREE.Group(); rifle.position.set(0.3, 1.27, 0.12); g.add(rifle);
  const aim = V(1, 0.05, -0.1).normalize();
  rifle.quaternion.setFromUnitVectors(V(1, 0, 0), aim);
  const box = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); rifle.add(b); return b; };
  box(0.34, 0.1, 0.05, 0.0, -0.03, 0, wood); box(0.36, 0.07, 0.06, 0.34, 0, 0, gunMetal); box(0.4, 0.05, 0.055, 0.6, -0.02, 0, wood);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.62, 10), gunMetal); barrel.rotation.z = Math.PI / 2; barrel.position.set(0.95, 0.02, 0); rifle.add(barrel);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.28, 12), gunMetal); scope.rotation.z = Math.PI / 2; scope.position.set(0.36, 0.07, 0); rifle.add(scope);
  box(0.03, 0.09, 0.03, 0.3, -0.09, 0, gunMetal);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.update = (t) => {
    const br = Math.sin(t * 1.6) * 0.008;
    torso.position.y = 0.98 + br; rifle.position.y = 1.27 + br; head.position.y = 1.38 + br; hood.position.y = 1.4 + br;
    rifle.rotation.z = Math.sin(t * 0.7) * 0.006;
  };
  return g;
}

export function placeOnSand(obj, x, z, lift = 0) { obj.position.set(x, sandH(x, z) + lift, z); }

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rand, rr, srand, clamp, lerp, smooth, fbm3, noise3, sweep, roundRect, circle, prep } from './util.js';
import { rustMaterial, applyMat, kelpMaterial, boxUV, U } from './materials.js';
import { sandH } from './environment.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function catmull(pts, n) { const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal'); return c.getSpacedPoints(n); }
function colorize(g, fn) {
  g = prep(g);
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) { const r = fn(p.getX(i), p.getY(i), p.getZ(i)); c.setXYZ(i, r[0], r[1], r[2]); }
  return g;
}
const rustTint = (x, y, z) => {
  const st = 1 + fbm3(x * 1.4, y * 0.3, z * 1.4, 3) * 0.6;
  const algae = smooth(1.2, -0.2, y), low = 0.6 + 0.4 * smooth(-0.4, 1.5, y);
  return [lerp(st, 0.62, algae) * low, lerp(st, 0.8, algae) * low, lerp(st, 0.36, algae) * low];
};

// ------------------------------------------------------------------ anchor + chain in the foreground
export function buildAnchor(tex, base) {
  srand(5);
  const grp = new THREE.Group(); grp.position.copy(base);
  const mat = rustMaterial(tex, { threshold: 0.6, key: 'anchor', normal: 1.3 });
  const geos = [];
  // shank: rises from the water and hooks over at the top
  const shankPts = catmull([V(0.9, -0.9, 0.2), V(0.3, 1.5, 0.1), V(-0.35, 4.2, 0), V(-0.25, 6.6, 0), V(0.45, 8.3, 0), V(1.35, 8.95, 0)], 80);
  const shank = sweep(shankPts, roundRect(0.62, 0.46, 0.16, 3), { up: V(0, 0, 1), uvScale: 0.25, scale: (s) => lerp(1.1, 0.72, s) });
  geos.push(shank);
  // flattened palm at the tip (the gull's perch)
  const palm = sweep(catmull([V(1.2, 8.88, 0), V(1.7, 9.1, 0), V(2.25, 9.15, 0)], 16), roundRect(0.95, 0.18, 0.06, 2), { up: V(0, 0, 1), scale: (s) => [lerp(0.9, 0.55, s), 1], uvScale: 0.25 });
  geos.push(palm);
  // crown arm lying in the shallows
  const arm = sweep(catmull([V(0.9, -0.5, 0.2), V(2.4, -0.25, 0.5), V(4.2, -0.05, 1.3), V(5.3, 0.2, 2.4), V(5.6, 0.55, 3.2)], 50), roundRect(0.55, 0.42, 0.14, 2), { up: V(0, 1, 0), uvScale: 0.25, scale: (s) => lerp(1.05, 0.7, s) });
  geos.push(arm);
  const fluke = sweep(catmull([V(5.4, 0.35, 2.8), V(5.9, 0.75, 3.5), V(6.1, 1.05, 4.0)], 12), roundRect(1.1, 0.16, 0.06, 2), { up: V(0, 1, 0), scale: (s) => [lerp(1, 0.35, s), 1], uvScale: 0.25 });
  geos.push(fluke);
  // shackle ring
  const ring = new THREE.TorusGeometry(0.42, 0.11, 10, 28); ring.rotateY(Math.PI / 2); ring.translate(0.2, 0.9, 0.2);
  geos.push(boxUV(ring, 2));
  const g = mergeGeometries(geos.map(x => colorize(x, (a, b, c) => rustTint(a, b + base.y, c))));
  // damage: pitted but intact
  const dm = g.attributes.aDamage; for (let i = 0; i < dm.count; i++) dm.setX(i, 0.12 + fbm3(g.attributes.position.getX(i) * 2, g.attributes.position.getY(i) * 2, 3, 3) * 0.5);
  grp.add(applyMat(new THREE.Mesh(g), mat));

  // hanging weed on the anchor
  const kelp = [], kp = [[-0.035, 0.004], [0.035, 0.004], [0.035, -0.004], [-0.035, -0.004]];
  const hang = (x, y, z, n, maxLen) => {
    for (let k = 0; k < n; k++) {
      const len = rr(0.3, maxLen), pts = [];
      const p = V(x + rr(-0.25, 0.25), y, z + rr(-0.25, 0.25));
      for (let s = 0; s <= 10; s++) { pts.push(p.clone()); p.y -= len / 10; p.x += rr(-0.02, 0.03); p.z += rr(-0.02, 0.02); }
      const w = rr(1.2, 3.5);
      const kg = sweep(pts, kp, { scale: (t) => [w * (1 - t * 0.5), 1], uvScale: 1 / len, caps: false, up: V(0, 0, 1) });
      const tone = rand();
      kelp.push(colorize(kg, () => [lerp(0.2, 0.32, tone), lerp(0.18, 0.26, tone), lerp(0.05, 0.08, tone)]));
    }
  };
  hang(1.2, 8.9, 0, 22, 1.8);
  hang(0.1, 6.0, 0.0, 10, 1.4);
  hang(-0.3, 4.0, 0, 8, 1.0);
  const km = new THREE.Mesh(mergeGeometries(kelp), kelpMaterial()); km.castShadow = true; grp.add(km);
  return { group: grp, perch: V(1.75, 9.18, 0).add(base), mat };
}

export function buildChain(tex, pathPts, linkLen = 0.46) {
  const curve = new THREE.CatmullRomCurve3(pathPts);
  const total = curve.getLength(), n = Math.floor(total / (linkLen * 0.78));
  const link = new THREE.TorusGeometry(0.15, 0.055, 8, 18); link.scale(1.55, 1, 1);
  const lg = colorize(boxUV(link, 1), () => [1, 1, 1]);
  const mat = rustMaterial(tex, { threshold: 5, key: 'chain', normal: 1.4 });
  const mesh = new THREE.InstancedMesh(lg, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tq = new THREE.Quaternion(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    p.y = Math.max(p.y, sandH(p.x, p.z) + 0.1);
    q.setFromUnitVectors(V(1, 0, 0), tan);
    tq.setFromAxisAngle(V(1, 0, 0), (i % 2) * Math.PI / 2 + rr(-0.25, 0.25) + Math.PI / 2 * 0.5);
    q.multiply(tq);
    m.compose(p, q, V(1, 1, 1));
    mesh.setMatrixAt(i, m);
    const w = smooth(0.6, -0.3, p.y);
    c.setRGB(lerp(1, 0.6, w) * rr(0.8, 1.15), lerp(0.95, 0.75, w) * rr(0.85, 1.1), lerp(0.95, 0.38, w));
    mesh.setColorAt(i, c);
  }
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = mat.userData.depth;
  return mesh;
}

export function buildRope(a, b, sag = 3) {
  const pts = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60, p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    p.y = Math.max(p.y, sandH(p.x, p.z) + 0.06);
    pts.push(p);
  }
  const g = sweep(pts, circle(0.07, 7), { uvScale: 1 });
  const mat = new THREE.MeshStandardMaterial({ color: '#6a4034', roughness: 0.9 });
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ debris, rocks, shells, weed piles
export function buildDebris(tex, around) {
  srand(9);
  const grp = new THREE.Group();
  const mat = rustMaterial(tex, { threshold: 0.6, key: 'debris' });
  const geos = [];
  // torn hull plates half-buried
  for (const d of around.plates) {
    const nx = 24, ny = 16, ps = [], ix = [], us = [], ds = [];
    const w = d.w, h = d.h, bend = rr(0.05, 0.25);
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx - 0.5, v = j / ny;
      const x = u * w, y = v * h, z = -bend * (u * w) * (u * w) + noise3(u * 3, v * 3, d.x) * 0.2;
      ps.push(x, y, z); us.push(x / 4, y / 4);
      ds.push(0.1 + fbm3(x * 0.35 + d.x, y * 0.35, 1.1, 4) * 1.4 + smooth(0.6, 1, v) * 0.35 + smooth(0.35, 0.5, Math.abs(u)) * 0.6);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1; ix.push(a, b, c, b, e, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(us, 2));
    g.setAttribute('aDamage', new THREE.Float32BufferAttribute(ds, 1)); g.setIndex(ix);
    const M = new THREE.Matrix4().compose(V(d.x, sandH(d.x, d.z) - 0.6, d.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(d.tilt, d.yaw, rr(-0.3, 0.3))), V(1, 1, 1));
    g.applyMatrix4(M); g.computeVertexNormals();
    geos.push(g);
  }
  // broken frame stubs sticking out of the sand
  for (const s of around.stubs) {
    const pts = []; for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(V(s.x + Math.sin(t * 1.4) * s.r * Math.cos(s.yaw), sandH(s.x, s.z) - 1 + t * s.len, s.z + Math.sin(t * 1.4) * s.r * Math.sin(s.yaw))); }
    geos.push(sweep(pts, roundRect(0.3, 0.7, 0.1, 2), { uvScale: 0.25, scale: (t) => [1, lerp(1, 0.6, t)] }));
  }
  // drums
  for (const d of around.drums) {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 1.25, 24, 6, false);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const r = 1 + (Math.abs(Math.abs(y) - 0.3) < 0.04 ? 0.04 : 0) + noise3(p.getX(i) * 3, y * 3, p.getZ(i) * 3) * 0.05; p.setX(i, p.getX(i) * r); p.setZ(i, p.getZ(i) * r); }
    g.rotateZ(d.tilt); g.rotateY(d.yaw); g.translate(d.x, sandH(d.x, d.z) + 0.15, d.z);
    geos.push(boxUV(g, 2));
  }
  const g = mergeGeometries(geos.map(x => colorize(x, rustTint)).map((x, i) => x));
  grp.add(applyMat(new THREE.Mesh(g), mat));

  // rocks
  let rockGeo = new THREE.IcosahedronGeometry(1, 4); rockGeo.deleteAttribute('normal'); rockGeo.deleteAttribute('uv'); rockGeo = mergeVertices(rockGeo);
  { const p = rockGeo.attributes.position; for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); const n = 1 + fbm3(v.x * 1.3, v.y * 1.3, v.z * 1.3, 4) * 0.55; v.multiplyScalar(n); v.y *= 0.6; p.setXYZ(i, v.x, v.y, v.z); } rockGeo.computeVertexNormals(); }
  const rockMat = new THREE.MeshStandardMaterial({ color: '#8d7b72', roughness: 0.85 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, around.rocks.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  around.rocks.forEach((r, i) => {
    m4.compose(V(r.x, sandH(r.x, r.z) - r.s * 0.2, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(0, 3), rr(0, 6), rr(0, 3))), V(r.s * rr(0.8, 1.4), r.s, r.s * rr(0.8, 1.3)));
    rocks.setMatrixAt(i, m4);
    const wet = smooth(0.4, -0.2, sandH(r.x, r.z));
    c.setRGB(rr(0.75, 1.05) * (1 - wet * 0.35), rr(0.75, 0.95) * (1 - wet * 0.3), rr(0.7, 0.9) * (1 - wet * 0.3)); rocks.setColorAt(i, c);
  });
  rocks.castShadow = true; rocks.receiveShadow = true; grp.add(rocks);

  // shells + pebbles scattered along wet sand
  const shellGeo = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); shellGeo.scale(1, 0.45, 0.8);
  const shellMat = new THREE.MeshStandardMaterial({ color: '#efe6da', roughness: 0.5 });
  const NS = 1400, shells = new THREE.InstancedMesh(shellGeo, shellMat, NS);
  let k = 0;
  while (k < NS) {
    const x = rr(-60, 80), z = rr(-70, 55), h = sandH(x, z);
    if (h < -0.25 || h > 1.0) continue;
    const s = rr(0.03, 0.09);
    m4.compose(V(x, h - 0.01, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.3, 0.3), rr(0, 6), rr(-0.3, 0.3))), V(s, s, s));
    shells.setMatrixAt(k, m4);
    const t = rand(); c.setRGB(lerp(0.95, 0.55, t * t), lerp(0.9, 0.5, t * t), lerp(0.85, 0.48, t * t)); shells.setColorAt(k, c);
    k++;
  }
  shells.receiveShadow = true; grp.add(shells);

  // washed-up weed piles
  let weedGeo = new THREE.IcosahedronGeometry(1, 3); weedGeo.deleteAttribute('normal'); weedGeo.deleteAttribute('uv'); weedGeo = mergeVertices(weedGeo);
  { const p = weedGeo.attributes.position; for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); v.multiplyScalar(1 + fbm3(v.x * 2.5, v.y * 2.5, v.z * 2.5, 3) * 0.9); v.y *= 0.25; p.setXYZ(i, v.x, v.y, v.z); } weedGeo.computeVertexNormals(); }
  const weedMat = new THREE.MeshStandardMaterial({ color: '#4a4a1c', roughness: 0.4 });
  const weeds = new THREE.InstancedMesh(weedGeo, weedMat, around.weeds.length);
  around.weeds.forEach((w, i) => { m4.compose(V(w.x, sandH(w.x, w.z) + 0.02, w.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr(0, 6), 0)), V(w.s * rr(1, 2), w.s, w.s)); weeds.setMatrixAt(i, m4); c.setRGB(rr(0.7, 1.2), rr(0.8, 1.1), rr(0.6, 1)); weeds.setColorAt(i, c); });
  weeds.receiveShadow = true; weeds.castShadow = true; grp.add(weeds);
  return grp;
}

// ------------------------------------------------------------------ gulls
function gullBody() {
  const white = new THREE.MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.75 });
  const grey = new THREE.MeshStandardMaterial({ color: '#9ea4aa', roughness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.5 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e0b33a', roughness: 0.45 });
  const legM = new THREE.MeshStandardMaterial({ color: '#d99a7a', roughness: 0.6 });
  return { white, grey, black, yellow, legM };
}
export function buildPerchedGull() {
  const M = gullBody();
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry([[0, -0.2], [0.06, -0.17], [0.1, -0.08], [0.115, 0.03], [0.1, 0.12], [0.06, 0.18], [0.02, 0.22], [0, 0.23]].map(p => new THREE.Vector2(p[0], p[1])), 20), M.white);
  body.rotation.x = Math.PI / 2 - 0.35; body.position.y = 0.2; body.scale.set(1, 1, 0.95); g.add(body);
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.14); g.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.062, 18, 14), M.white); hm.scale.set(1, 1, 1.15); head.add(hm);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 10), M.yellow); beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.008, 0.1); head.add(beak);
  const spot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: '#c0392b' })); spot.position.set(0, -0.02, 0.1); head.add(spot);
  for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), M.black); e.position.set(s * 0.045, 0.012, 0.035); head.add(e); }
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), M.grey); w.scale.set(0.035, 0.07, 0.2); w.position.set(s * 0.085, 0.24, -0.06); w.rotation.x = -0.35; g.add(w);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), M.black); tip.scale.set(0.022, 0.035, 0.12); tip.position.set(s * 0.06, 0.18, -0.24); tip.rotation.x = -0.3; g.add(tip);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.007, 0.12, 6), M.legM); leg.position.set(s * 0.035, 0.06, 0.0); g.add(leg);
    const foot = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 3), M.legM); foot.rotation.x = Math.PI / 2; foot.scale.y = 1; foot.position.set(s * 0.035, 0.005, 0.02); foot.scale.set(1, 1, 0.2); g.add(foot);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), M.white); tail.rotation.x = -Math.PI / 2 - 0.2; tail.position.set(0, 0.17, -0.22); tail.scale.set(1, 1, 0.3); g.add(tail);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(2.2);
  g.userData.head = head;
  return g;
}
export function buildFlock(n = 12) {
  srand(21);
  const M = gullBody();
  const flock = [];
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.quadraticCurveTo(0.35, 0.12, 0.8, -0.05); wingShape.lineTo(0.55, -0.12); wingShape.quadraticCurveTo(0.25, -0.1, 0, -0.14);
  const wg = new THREE.ShapeGeometry(wingShape, 6); wg.rotateX(-Math.PI / 2);
  const bodyG = new THREE.SphereGeometry(0.09, 10, 8); bodyG.scale(1, 0.8, 2.4);
  const grp = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(bodyG, M.white));
    const l = new THREE.Mesh(wg, M.grey), r = new THREE.Mesh(wg, M.grey); r.scale.x = -1;
    l.material.side = THREE.DoubleSide;
    b.add(l, r);
    b.userData = { l, r, rad: rr(30, 90), h: rr(35, 75), sp: rr(0.04, 0.09) * (rand() < 0.5 ? 1 : -1), ph: rr(0, 6.28), cx: rr(-40, 60), cz: rr(-120, -20), fl: rr(5, 8) };
    b.scale.setScalar(rr(2.0, 2.8));
    grp.add(b); flock.push(b);
  }
  grp.userData.update = (t) => {
    for (const b of flock) {
      const u = b.userData, a = u.ph + t * u.sp;
      b.position.set(u.cx + Math.cos(a) * u.rad, u.h + Math.sin(t * 0.3 + u.ph) * 3, u.cz + Math.sin(a) * u.rad * 0.6);
      b.rotation.y = -a + (u.sp > 0 ? 0 : Math.PI);
      b.rotation.z = Math.sin(t * 0.5 + u.ph) * 0.2;
      const f = Math.sin(t * u.fl + u.ph) * 0.5 * (0.5 + 0.5 * Math.sin(t * 0.4 + u.ph * 3));
      u.l.rotation.z = f; u.r.rotation.z = -f;
    }
  };
  return grp;
}

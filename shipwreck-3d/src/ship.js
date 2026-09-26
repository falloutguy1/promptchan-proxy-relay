import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rand, rr, srand, clamp, lerp, smooth, fbm3, noise3, sweep, roundRect, circle, prep } from './util.js';
import { rustMaterial, applyMat, kelpMaterial, boxUV } from './materials.js';

export const L = 92, XB = -46, XS = 46, HB = 9.5, D = 15;
export function halfBeam(x) {
  const x0 = 29;
  if (x <= x0) return HB * (1 - 0.06 * smooth(-10, -46, x));
  const k = clamp((x - x0) / (XS - x0), 0, 1);
  return HB * Math.sqrt(Math.max(0, 1 - k * k));
}
export function keelY(x) { const x0 = 20; return x > x0 ? 7.2 * Math.pow((x - x0) / (XS - x0), 1.5) : 0; }
export function deckY(x) { return D + 1.6 * Math.pow((x - XB) / L, 2); }
export function hullPoint(x, t, out = new THREE.Vector3()) {
  const a = (t - 0.5) * Math.PI, s = Math.sin(a), c = Math.cos(a);
  const hb = halfBeam(x), dk = deckY(x), kl = keelY(x);
  // bulwark flare: slight outward lean near deck
  const z = hb * Math.sign(s) * Math.pow(Math.abs(s), 0.3);
  const y = dk - (dk - kl) * Math.pow(Math.abs(c), 0.32);
  return out.set(x, y, z);
}

export function buildShip(tex, placement) {
  srand(77);
  const root = new THREE.Group(), pitch = new THREE.Group(), roll = new THREE.Group();
  root.add(pitch); pitch.add(roll);
  root.position.copy(placement.position); root.rotation.y = placement.yaw;
  pitch.rotation.z = placement.pitch; roll.rotation.x = placement.roll;
  root.updateMatrixWorld(true);
  const M = roll.matrixWorld;
  const tmp = new THREE.Vector3();
  const worldY = (x, y, z) => tmp.set(x, y, z).applyMatrix4(M).y;

  const hullMat = rustMaterial(tex, { threshold: 0.6, key: 'hull' });
  const partMat = rustMaterial(tex, { threshold: 0.6, key: 'part', normal: 0.9 });
  const kelpGeos = [];
  const parts = [];            // geometries using partMat
  const mats = [hullMat, partMat];

  // ----------------------------------------------------------- HULL SHELL
  const NU = 320, NV = 170;
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3), uv = new Float32Array((NU + 1) * (NV + 1) * 2);
  const col = new Float32Array((NU + 1) * (NV + 1) * 3), dmg = new Float32Array((NU + 1) * (NV + 1));
  const P = new THREE.Vector3(), Pu = new THREE.Vector3(), Pt = new THREE.Vector3(), nrm = new THREE.Vector3();
  const edgeCandidates = [];
  for (let i = 0; i <= NU; i++) {
    const x = lerp(XB, XS, i / NU);
    let arc = 0; const prev = new THREE.Vector3();
    for (let j = 0; j <= NV; j++) {
      const t = j / NV, k = i * (NV + 1) + j;
      hullPoint(x, t, P);
      if (j > 0) arc += P.distanceTo(prev); prev.copy(P);
      hullPoint(x + 0.05, t, Pu); hullPoint(x, Math.min(1, t + 0.002), Pt);
      if (t >= 1) { hullPoint(x, t - 0.002, Pt); Pt.sub(P).negate().add(P); }
      nrm.crossVectors(Pu.sub(P), Pt.sub(P)).normalize();
      if (P.z < 0) nrm.negate();
      if (nrm.lengthSq() < 0.5 || !isFinite(nrm.x)) nrm.set(0, -1, 0);
      const dk = deckY(x), kl = keelY(x);
      const hf = clamp((P.y - kl) / (dk - kl), 0, 1);
      const xn = (x - XB) / L;
      const wy = worldY(P.x, P.y, P.z);
      // damage field
      const wx = x + fbm3(x * 0.08, P.y * 0.12, P.z * 0.08 + 40, 3) * 7;
      const strips = fbm3(wx * 0.3, P.y * 0.05 + fbm3(x * 0.2, P.y * 0.2, 9, 2) * 0.6, P.z * 0.3 + 11, 4);
      const blob = fbm3(x * 0.065 + 3, P.y * 0.085, P.z * 0.065, 4);
      const broken = 1 - smooth(0.0, 0.5, xn);
      let d = 0.3 + blob * 1.1 + strips * 1.35 + broken * 0.12 + smooth(0.55, 1.0, hf) * 0.28 + smooth(0.86, 1.0, hf) * 0.35 * (1 - smooth(0.7, 0.85, xn));
      d += smooth(XB + 3.5, XB, x) * 1.2;
      d -= smooth(1.2, -1.0, wy) * 1.2;
      d -= smooth(0.72, 0.92, xn) * 0.45;
      d -= smooth(1, -3, P.z) * 0.55 * (1 - smooth(0.9, 1, hf));   // far side mostly plated: dark interior reads through
      // superstructure base stays plated
      dmg[k] = d;
      // dents + torn edge curl
      const e = smooth(0.3, 0.6, d);
      const dent = fbm3(x * 0.13, P.y * 0.13, P.z * 0.13 + 5, 3) * 0.35;
      const curl = e * e * (0.35 + 0.6 * noise3(x * 0.7, P.y * 0.4, 3.3));
      P.addScaledVector(nrm, dent + curl);
      P.y -= e * e * (0.25 + 0.5 * Math.abs(noise3(x * 0.5, P.y * 0.2, P.z * 0.3))) ;
      pos.set([P.x, P.y, P.z], k * 3);
      uv[k * 2] = x / 4; uv[k * 2 + 1] = arc / 4;
      // vertex colour
      const streak = fbm3(x * 1.4, P.y * 0.035, P.z * 1.4, 3) * 1.3;
      let r = 1, g = 1, b = 1;
      const s2 = 1 + streak * 0.55; r *= s2; g *= s2 * 0.97; b *= s2;
      const algae = smooth(2.8, 0.2, wy) * (0.6 + 0.4 * fbm3(x * 0.4, wy * 0.8, P.z * 0.4));
      r = lerp(r, 0.62, algae); g = lerp(g, 0.82, algae); b = lerp(b, 0.36, algae);
      const low = 0.55 + 0.45 * smooth(-0.5, 3.0, wy); r *= low; g *= low; b *= low;
      const top = smooth(0.8, 1.0, hf) * 0.25; r += top; g += top * 0.75; b += top * 0.8;
      r = lerp(r, 1.25, e * 0.35); g = lerp(g, 1.0, e * 0.2);
      col.set([r, g, b], k * 3);
      if (e > 0.25 && d < 0.55 && wy > 1.0 && rand() < 0.05) edgeCandidates.push([P.x, P.y, P.z, nrm.x, nrm.y, nrm.z]);
    }
  }
  const idx = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  hullGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  hullGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  hullGeo.setAttribute('aDamage', new THREE.BufferAttribute(dmg, 1));
  hullGeo.setIndex(idx);
  hullGeo.computeVertexNormals();
  roll.add(applyMat(new THREE.Mesh(hullGeo), hullMat));

  // helper: colour + damage attributes for part geometries, by world height
  function finishPart(g, opts = {}) {
    g = prep(g);
    const p = g.attributes.position, c = g.attributes.color, dm = g.attributes.aDamage;
    const base = opts.tint || [1, 1, 1];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const wy = worldY(x, y, z);
      const st = 1 + fbm3(x * 1.3, y * 0.08, z * 1.3, 3) * 0.5;
      const algae = smooth(2.5, 0.2, wy);
      const low = 0.55 + 0.45 * smooth(-0.5, 3.0, wy);
      c.setXYZ(i, lerp(base[0] * st, 0.62, algae) * low, lerp(base[1] * st, 0.8, algae) * low, lerp(base[2] * st, 0.36, algae) * low);
      if (opts.damage) dm.setX(i, opts.damage(x, y, z, wy));
    }
    return g;
  }

  // ----------------------------------------------------------- DECKS & BULKHEADS
  function deckGrid(y0fn, x0, x1, nx, nz, dfn, inset = 0.25) {
    const ps = [], us = [], ds = [], ix = [];
    for (let i = 0; i <= nx; i++) {
      const x = lerp(x0, x1, i / nx), hb = Math.max(0.01, halfBeam(x) - inset);
      for (let j = 0; j <= nz; j++) {
        const z = lerp(-hb, hb, j / nz), y = y0fn(x, z);
        ps.push(x, y, z); us.push(x / 4, z / 4); ds.push(dfn(x, y, z));
      }
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j, b = a + 1, c = a + nz + 1, d = c + 1; ix.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(us, 2));
    g.setAttribute('aDamage', new THREE.Float32BufferAttribute(ds, 1));
    g.setIndex(ix); g.computeVertexNormals();
    return g;
  }
  const deckDamage = (x, y, z) => 0.45 + fbm3(x * 0.09, 1.7, z * 0.12, 4) * 1.1 + fbm3(x * 0.4, 3.1, z * 0.4, 3) * 0.4 + (1 - smooth(-40, 12, x)) * 1.0 - smooth(18, 26, x) * 0.8;
  parts.push(finishPart(deckGrid((x, z) => deckY(x) - 0.05 - z * z * 0.004, XB + 1, XS - 1.2, 200, 44, deckDamage)));
  // tween deck
  parts.push(finishPart(deckGrid((x) => 8.2 + 0.4 * Math.pow((x - XB) / L, 2), XB + 2, 30, 150, 36, (x, y, z) => 0.1 + fbm3(x * 0.1, 7.7, z * 0.1, 4) * 1.2 + (1 - smooth(-44, 0, x)) * 0.6), { tint: [0.7, 0.62, 0.66] }));
  // bulkheads
  for (const bx of [-37, -24, -9, 6]) {
    const ps = [], ds = [], ix = [], us = [];
    const nz = 40, ny = 40, hb = halfBeam(bx) - 0.3;
    for (let i = 0; i <= ny; i++) for (let j = 0; j <= nz; j++) {
      const z = lerp(-hb, hb, j / nz), y = lerp(0.5, deckY(bx) - 0.2, i / ny);
      ps.push(bx + noise3(z * 0.3, y * 0.3, bx) * 0.3, y, z); us.push(z / 4, y / 4);
      ds.push(0.25 + fbm3(bx, y * 0.13, z * 0.13, 4) * 1.3 + (1 - smooth(-44, 10, bx)) * 0.35);
    }
    for (let i = 0; i < ny; i++) for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j, b = a + 1, c = a + nz + 1, d = c + 1; ix.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(us, 2));
    g.setAttribute('aDamage', new THREE.Float32BufferAttribute(ds, 1));
    g.setIndex(ix); g.computeVertexNormals();
    parts.push(finishPart(g, { tint: [0.62, 0.55, 0.6] }));
  }

  // ----------------------------------------------------------- FRAMES (RIBS)
  const ribProfile = roundRect(0.32, 0.85, 0.1, 2);
  const inset = (x, t, d, out) => {
    hullPoint(x, t, out);
    const c = new THREE.Vector3(x, (deckY(x) + keelY(x)) * 0.5 + 1.5, 0);
    return out.add(c.sub(out).setComponent(0, 0).normalize().multiplyScalar(d));
  };
  let fi = 0;
  for (let x = XB + 1.2; x < 22; x += 2.35, fi++) {
    const inBroken = x < 0;
    // inner ring, split into segments with gaps
    let seg = [];
    const flush = () => { if (seg.length > 3) parts.push(finishPart(sweep(seg, ribProfile, { up: new THREE.Vector3(1, 0, 0), uvScale: 0.25 }))); seg = []; };
    for (let j = 0; j <= 60; j++) {
      const t = j / 60;
      const gap = fbm3(x * 0.37, t * 6.0, 2.2, 2) > (inBroken ? 0.18 : 0.3);
      if (gap) { flush(); continue; }
      seg.push(inset(x, t, 0.45, new THREE.Vector3()));
    }
    flush();
    // rising horns beyond the deck edge (the "ribcage")
    for (const side of [1, -1]) {
      const prob = inBroken ? 0.95 : 0.35;
      if (rand() > prob) continue;
      const start = inset(x, side > 0 ? 1 : 0, 0.45, new THREE.Vector3());
      const hero = inBroken && side > 0;
      const len = hero ? rr(8, 14) : rr(2, 7);
      const curl = (hero ? rr(0.14, 0.22) : rr(0.05, 0.25)) * (hero ? -1 : 1);
      const lean = rr(-0.07, 0.0) - (hero ? 0.03 : 0);
      const pts = [];
      const back = inset(x, side > 0 ? 0.93 : 0.07, 0.45, new THREE.Vector3());
      pts.push(back);
      const p = start.clone(); pts.push(p.clone());
      const n = Math.ceil(len / 0.4);
      for (let s = 1; s <= n; s++) {
        const ang = s * 0.4 * curl + 0.12;
        p.add(new THREE.Vector3(lean * s * 0.4 * 0.5, Math.cos(ang) * 0.4, -side * Math.sin(ang) * 0.4));
        pts.push(p.clone());
      }
      parts.push(finishPart(sweep(pts, ribProfile, { up: new THREE.Vector3(1, 0, 0), uvScale: 0.25, scale: (s) => { const k = 1 - smooth(0.6, 1.0, s) * 0.55; return [1, k]; } })));
    }
    // deck beams
    if (rand() < 0.75) {
      const y = deckY(x) - 0.55, hb = halfBeam(x) - 0.4;
      const z0 = -hb + (rand() < 0.4 ? rr(2, 8) : 0), z1 = hb - (rand() < 0.4 ? rr(2, 8) : 0);
      if (z1 - z0 > 2) {
        const pts = []; for (let k = 0; k <= 10; k++) { const z = lerp(z0, z1, k / 10); pts.push(new THREE.Vector3(x, y - z * z * 0.004 - (x < -30 ? Math.sin(k / 10 * Math.PI) * rr(0, 1.2) : 0), z)); }
        parts.push(finishPart(sweep(pts, roundRect(0.3, 0.7, 0.08, 1), { up: new THREE.Vector3(1, 0, 0), uvScale: 0.25 })));
      }
    }
  }
  // stringers
  for (const t of [0.06, 0.14, 0.24, 0.36, 0.64, 0.76, 0.86, 0.94]) {
    let seg = [];
    const flush = () => { if (seg.length > 3) parts.push(finishPart(sweep(seg, roundRect(0.26, 0.55, 0.08, 1), { up: new THREE.Vector3(0, 0, 1), uvScale: 0.25 }))); seg = []; };
    for (let x = XB + 0.6; x < 18; x += 0.5) {
      if (fbm3(x * 0.12, t * 9, 4.4, 2) > 0.22) { flush(); continue; }
      seg.push(inset(x, t, 0.3, new THREE.Vector3()));
    }
    flush();
  }
  // hold stanchions (pillars) & inner lattice
  for (let x = XB + 3; x < 10; x += rr(3, 6)) for (const z of [-4.5, 0, 4.5]) {
    if (rand() < 0.35) continue;
    const top = deckY(x) - 0.8 - (x < -25 ? rr(0, 6) : 0);
    const pts = []; for (let k = 0; k <= 8; k++) pts.push(new THREE.Vector3(x + noise3(x, k * 0.2, z) * 0.3, lerp(1.2, top, k / 8), z));
    parts.push(finishPart(sweep(pts, roundRect(0.45, 0.45, 0.08, 1), { uvScale: 0.25 }), { tint: [0.6, 0.52, 0.58] }));
  }

  // ----------------------------------------------------------- SUPERSTRUCTURE
  const superParts = [];
  const dkS = deckY(30);
  const addBox = (w, h, d, x, y, z, r = 0.35, rot = 0) => {
    const g = new RoundedBoxGeometry(w, h, d, 3, r);
    g.rotateY(rot); g.translate(x, y, z);
    superParts.push(g); return g;
  };
  addBox(19, 3.4, 15, 31.5, dkS + 1.5, 0);
  addBox(15, 3.2, 13.5, 32, dkS + 4.7, 0);
  addBox(8, 3.0, 17.5, 28.5, dkS + 7.8, 0, 0.3);
  addBox(5.5, 1.4, 8, 29, dkS + 9.9, 0, 0.25);
  addBox(3, 1.0, 17.8, 25.2, dkS + 6.2, 0, 0.2); // bridge wing overhang
  // funnel
  {
    const g = new THREE.CylinderGeometry(2.0, 2.35, 7.5, 32, 8, true);
    g.scale(1, 1, 0.72); g.rotateZ(-0.12); g.translate(38, dkS + 9.5, 0);
    superParts.push(g);
    const rim = new THREE.TorusGeometry(2.0, 0.18, 8, 32); rim.rotateX(Math.PI / 2); rim.scale(1, 1, 0.72); rim.rotateZ(-0.12); rim.translate(38.45, dkS + 13.2, 0);
    superParts.push(rim);
  }
  // mast & derrick
  const tube = (pts, r) => superParts.push(sweep(pts.map(p => new THREE.Vector3(...p)), circle(r, 10), { uvScale: 0.25 }));
  tube([[29, dkS + 10.5, 0], [29, dkS + 17.5, 0]], 0.22);
  tube([[29, dkS + 15.5, -2.8], [29, dkS + 15.5, 2.8]], 0.12);
  tube([[29, dkS + 17.2, 0], [30.5, dkS + 13, 3.6]], 0.05);
  tube([[29, dkS + 17.2, 0], [30.5, dkS + 13, -3.6]], 0.05);
  tube([[22, dkS + 0.5, 3], [22, dkS + 9, 3], [20.5, dkS + 10.5, 2.5]], 0.28);
  tube([[22, dkS + 7.5, 3], [13, dkS + 4, 1.5]], 0.18);
  // davits
  for (const s of [1, -1]) for (const dx of [27, 35]) {
    const pts = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 0.55; pts.push([dx, dkS + 3.2 + Math.sin(a) * 2.2, s * (6.2 + (1 - Math.cos(a)) * 2.4)]); }
    tube(pts, 0.14);
  }
  // railings
  const rail = (x0, x1, z0, z1, y, n) => {
    for (let k = 0; k <= n; k++) {
      const x = lerp(x0, x1, k / n), z = lerp(z0, z1, k / n);
      if (rand() < 0.12) continue;
      const lean = rand() < 0.1 ? rr(-0.5, 0.5) : 0;
      tube([[x, y, z], [x + lean, y + 1.1, z + lean * 0.3]], 0.045);
    }
    const bend = (h) => { const pts = []; for (let k = 0; k <= 16; k++) { const f = k / 16; pts.push([lerp(x0, x1, f), y + h - (rand() < 0.05 ? 0.3 : 0) - Math.sin(f * Math.PI * 3) * 0.05, lerp(z0, z1, f)]); } return pts; };
    tube(bend(1.1), 0.05); tube(bend(0.6), 0.04);
  };
  rail(22, 41, 7.5, 7.5, dkS + 3.2, 24); rail(22, 41, -7.5, -7.5, dkS + 3.2, 24);
  rail(24.5, 39.5, 6.8, 6.8, dkS + 6.3, 18); rail(24.5, 39.5, -6.8, -6.8, dkS + 6.3, 18);
  rail(24.5, 32.5, 8.8, 8.8, dkS + 9.3, 10); rail(24.5, 32.5, -8.8, -8.8, dkS + 9.3, 10);
  // aft deck rail following stern
  {
    const pts = []; for (let k = 0; k <= 30; k++) { const a = (k / 30 - 0.5) * Math.PI; const x = 41 + Math.cos(a) * 4.6, z = Math.sin(a) * 7.8; pts.push([x, deckY(x) + 1.0, z]); }
    tube(pts, 0.05);
    for (let k = 0; k <= 30; k += 2) { const p = pts[k]; tube([[p[0], p[1] - 1, p[2]], p], 0.045); }
  }
  const superGeo = mergeGeometries(superParts.map(g => prep(boxUV(g, 4))));
  roll.add(applyMat(new THREE.Mesh(finishPart(superGeo, { tint: [1.08, 0.98, 0.98], damage: (x, y, z) => 0.05 + fbm3(x * 0.2, y * 0.2, z * 0.2, 3) * 0.9 })), partMat));

  // windows & portholes (dark wet glass)
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b0a0d, roughness: 0.12, metalness: 0.6, envMapIntensity: 1.2 });
  const glass = [];
  for (let k = 0; k < 8; k++) { const g = new THREE.BoxGeometry(0.3, 1.1, 1.5); g.translate(24.4, dkS + 8.0, -6.3 + k * 1.8); glass.push(g); }
  for (const s of [1, -1]) {
    for (let k = 0; k < 7; k++) { const g = new THREE.CylinderGeometry(0.33, 0.33, 0.3, 16); g.rotateX(Math.PI / 2); g.translate(24 + k * 2.4, dkS + 1.8, s * 7.55); glass.push(g); }
    for (let k = 0; k < 5; k++) { const g = new THREE.BoxGeometry(1.2, 1.0, 0.3); g.translate(26 + k * 2.6, dkS + 5.0, s * 6.8); glass.push(g); }
    const door = new THREE.BoxGeometry(1.1, 2.1, 0.3); door.translate(38, dkS + 1.2, s * 7.55); glass.push(door);
  }
  const glassGeo = mergeGeometries(glass);
  const gm = new THREE.Mesh(glassGeo, glassMat); gm.castShadow = true; gm.receiveShadow = true; roll.add(gm);
  // porthole rims
  const rims = [];
  for (const s of [1, -1]) for (let k = 0; k < 7; k++) { const g = new THREE.TorusGeometry(0.4, 0.08, 6, 16); g.translate(24 + k * 2.4, dkS + 1.8, s * 7.6); rims.push(g); }
  // hull portholes near stern
  for (const s of [1, -1]) for (let k = 0; k < 9; k++) {
    const x = 6 + k * 2.6; const y = deckY(x) - 2.2;
    const z = s * (halfBeam(x) + 0.05);
    const g = new THREE.TorusGeometry(0.38, 0.09, 6, 16); g.translate(x, y, z); rims.push(g);
    const gl = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14); gl.rotateX(Math.PI / 2); gl.translate(x, y, z - s * 0.05); glass.push(gl);
  }
  roll.add(applyMat(new THREE.Mesh(finishPart(mergeGeometries(rims.map(g => prep(boxUV(g, 2)))), { tint: [1.2, 1.0, 0.95] })), partMat));
  const gm2 = new THREE.Mesh(mergeGeometries(glass.slice(-18)), glassMat); roll.add(gm2);

  // ----------------------------------------------------------- PROPELLER, RUDDER, SHAFT
  const propGroup = new THREE.Group();
  propGroup.position.set(40.2, 2.5, 0);
  const blades = [];
  const R = 3.2, r0 = 0.55;
  for (let b = 0; b < 4; b++) {
    const ps = [], ix = [], nr = 22, na = 16;
    for (const face of [1, -1]) {
      for (let i = 0; i <= nr; i++) {
        const fr = i / nr, r = lerp(r0, R, fr);
        const half = 0.5 * Math.pow(Math.sin(Math.PI * lerp(0.08, 1, fr)), 0.55) * (1.05 - fr * 0.25) + 0.02;
        const skew = fr * fr * 0.45;
        for (let j = 0; j <= na; j++) {
          const f = j / na * 2 - 1;
          const ang = b * Math.PI / 2 + 0.35 + skew + f * half;
          const th = (1 - f * f) * 0.18 * (1 - fr * 0.7);
          const pitchX = f * half * 1.5 * (1 - fr * 0.3) + fr * 0.2;
          ps.push(pitchX + face * th, Math.cos(ang) * r, Math.sin(ang) * r);
        }
      }
    }
    const off = (nr + 1) * (na + 1);
    for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j, bb = a + 1, c = a + na + 1, d = c + 1;
      ix.push(a, c, bb, bb, c, d); ix.push(off + a, off + bb, off + c, off + bb, off + d, off + c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3)); g.setIndex(ix); g.computeVertexNormals();
    blades.push(g);
  }
  const hub = new THREE.LatheGeometry([[0, -1.6], [0.5, -1.5], [0.8, -0.9], [0.85, 0], [0.8, 0.8], [0.6, 1.3], [0.0, 1.6]].map(p => new THREE.Vector2(p[0], p[1])), 24);
  hub.rotateZ(-Math.PI / 2);
  const propGeo = mergeGeometries([...blades, hub].map(g => prep(boxUV(g, 3))));
  const propMat = rustMaterial(tex, { threshold: 5, key: 'prop', color: '#ffe6d6', metalness: 0.3, normal: 0.7 });
  const pm = applyMat(new THREE.Mesh(finishPart(propGeo, { tint: [1.9, 1.35, 1.15] })), propMat);
  propGroup.add(pm);
  const shaft = []; { const pts = []; for (let k = 0; k <= 10; k++) pts.push(new THREE.Vector3(lerp(28, 39, k / 10), 2.5 + lerp(0.6, 0, k / 10), 0)); shaft.push(sweep(pts, circle(1, 16), { scale: s => lerp(1.4, 0.7, s), uvScale: 0.25 })); }
  { const g = new RoundedBoxGeometry(3.4, 7.5, 0.55, 2, 0.25); g.translate(44.3, 4.8, 0); shaft.push(g); }
  { const g = new RoundedBoxGeometry(0.5, 3, 0.4, 2, 0.15); g.translate(43.2, 1.0, 0); shaft.push(g); }
  roll.add(applyMat(new THREE.Mesh(finishPart(mergeGeometries(shaft.map(g => prep(boxUV(g, 4)))))), partMat));

  // ----------------------------------------------------------- MERGE PARTS
  const partGeo = mergeGeometries(parts.map(g => { if (!g.attributes.normal) g.computeVertexNormals(); return g; }));
  roll.add(applyMat(new THREE.Mesh(partGeo), partMat));

  // ----------------------------------------------------------- ALGAE STRANDS
  const kelpParts = [];
  const kp = [[-0.03, 0.005], [0.03, 0.005], [0.03, -0.005], [-0.03, -0.005]];
  for (const c of edgeCandidates) {
    const n = 2 + Math.floor(rand() * 4);
    for (let s = 0; s < n; s++) {
      const len = rr(0.6, 3.2), pts = [];
      const p = new THREE.Vector3(c[0] + rr(-0.4, 0.4), c[1], c[2] + rr(-0.3, 0.3)).addScaledVector(new THREE.Vector3(c[3], c[4], c[5]), 0.05);
      const drift = new THREE.Vector3(c[3], 0, c[5]).multiplyScalar(rr(0.05, 0.25));
      const steps = 10;
      for (let k = 0; k <= steps; k++) { pts.push(p.clone()); p.y -= len / steps; p.addScaledVector(drift, 1 / steps * (k / steps)); p.x += rr(-0.03, 0.03); }
      const w = rr(1.5, 4.5);
      const g = sweep(pts, kp, { scale: (t) => [w * (1 - t * 0.6), 1], uvScale: 1 / len, caps: false, up: new THREE.Vector3(c[3], c[4], c[5]) });
      const cc = new Float32Array(g.attributes.position.count * 3);
      const tone = rand();
      for (let i = 0; i < g.attributes.position.count; i++) {
        const t = g.attributes.uv.getY(i);
        const a = [lerp(0.15, 0.26, tone), lerp(0.14, 0.22, tone), lerp(0.04, 0.07, tone)];
        cc.set([a[0] * (1 - t * 0.3), a[1] * (1 + t * 0.15), a[2]], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      kelpGeos.push(g);
    }
  }
  if (kelpGeos.length) {
    const km = new THREE.Mesh(mergeGeometries(kelpGeos), kelpMaterial());
    km.castShadow = true; km.receiveShadow = true; roll.add(km);
  }

  return { root, roll, mats, hullMat, partMat, propGroup };
}

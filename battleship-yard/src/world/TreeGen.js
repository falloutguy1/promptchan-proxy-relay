import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, makeNoise2D } from '../engine/noise.js';

/**
 * Procedural tree generator.
 *  pine      – Scots-pine-like: tall clean trunk, irregular crown in the upper third
 *  spruce    – conical, drooping whorls down to the ground
 *  broadleaf – forking trunk and limbs, clustered leafy twigs at the branch ends
 * Returns per-LOD geometry for bark (tubes, real-scale UVs) and foliage (alpha cards).
 * Foliage vertices carry: normal (blend of card + crown-sphere normal), color (inner-crown
 * occlusion + per-cluster tint), aWind (sway weight).
 */

const UP = new THREE.Vector3(0, 1, 0);

function tube(points, radii, radialSegs, rnd, barkScale, irregular = 0.12) {
  const n = points.length;
  const pos = [], nor = [], uv = [], idx = [];
  const noise = makeNoise2D(Math.floor(rnd() * 1e6));
  let len = 0;
  const frames = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = (i < n - 1 ? points[i + 1].clone().sub(points[i]) : points[i].clone().sub(points[i - 1])).normalize();
    let nn;
    if (!prevN) { nn = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP.clone(); nn.sub(t.clone().multiplyScalar(nn.dot(t))).normalize(); }
    else { nn = prevN.clone().sub(t.clone().multiplyScalar(prevN.dot(t))).normalize(); }
    prevN = nn;
    frames.push([t, nn, t.clone().cross(nn)]);
  }
  for (let i = 0; i < n; i++) {
    if (i) len += points[i].distanceTo(points[i - 1]);
    const [, nn, bn] = frames[i];
    const r = radii[i];
    const circ = 2 * Math.PI * r;
    for (let k = 0; k <= radialSegs; k++) {
      const a = (k / radialSegs) * Math.PI * 2;
      // irregular cross-section: bark ridges and buttress lobes
      const lobes = 1 + irregular * (noise(Math.cos(a) * 1.3 + len * 0.15, Math.sin(a) * 1.3) + 0.4 * Math.sin(a * 3 + len));
      const dir = nn.clone().multiplyScalar(Math.cos(a)).add(bn.clone().multiplyScalar(Math.sin(a)));
      const p = points[i].clone().addScaledVector(dir, r * lobes);
      pos.push(p.x, p.y, p.z);
      nor.push(dir.x, dir.y, dir.z);
      uv.push((k / radialSegs) * Math.max(1, Math.round(circ / barkScale)), len / barkScale);
    }
  }
  const row = radialSegs + 1;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < radialSegs; k++) {
    const a = i * row + k, b = a + row;
    idx.push(a, a + 1, b, a + 1, b + 1, b); // outward-facing
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function curvePoints(start, dir, length, segs, rnd, opts) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  const step = length / segs;
  for (let i = 1; i <= segs; i++) {
    // gravitropism / phototropism + random wander
    d.y += opts.gravity * step;
    d.x += (rnd() - 0.5) * opts.wander; d.z += (rnd() - 0.5) * opts.wander;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
  }
  return pts;
}

class CardWriter {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.wind = []; this.idx = []; }
  /** quad centred at base along 'along' (length) and 'side' (width); uv rect [u0,v0,u1,v1] with v0 at the base */
  quad(base, along, side, length, width, rect, crownC, crownR, tint, wind) {
    const o = this.pos.length / 3;
    const cardN = along.clone().cross(side).normalize();
    const corners = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
    for (const [sx, sy] of corners) {
      const p = base.clone().addScaledVector(side, sx * width).addScaledVector(along, sy * length);
      this.pos.push(p.x, p.y, p.z);
      const sph = p.clone().sub(crownC).normalize();
      const n = sph.multiplyScalar(0.75).addScaledVector(cardN, 0.25 * Math.sign(cardN.dot(sph) || 1)).normalize();
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(rect[0] + (sx + 0.5) * (rect[2] - rect[0]), rect[1] + sy * (rect[3] - rect[1]));
      const depth = Math.min(1, p.distanceTo(crownC) / crownR);
      const occ = 0.45 + 0.55 * Math.pow(depth, 1.5);
      this.col.push(occ * tint[0], occ * tint[1], occ * tint[2]);
      this.wind.push(wind * (0.6 + 0.4 * sy));
    }
    this.idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.idx);
    return g;
  }
}

function barkWind(g, height) {
  const p = g.attributes.position;
  const w = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) w[i] = Math.pow(Math.max(0, p.getY(i)) / height, 2) * 0.6;
  g.setAttribute('aWind', new THREE.BufferAttribute(w, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
  return g;
}

export function generateTree(species, seed, lod = 0) {
  const rnd = mulberry32(seed * 7919 + 13);
  const radial = [9, 6, 3][lod];
  const cardKeep = [1, 0.5, 0.22][lod];
  const cardScale = [1, 1.35, 1.9][lod];
  const bark = [];
  const cards = new CardWriter();
  const age = 0.65 + rnd() * 0.5;

  if (species === 'pine' || species === 'spruce') {
    const pine = species === 'pine';
    const H = (pine ? 15 + rnd() * 9 : 11 + rnd() * 9) * age;
    const r0 = H * (pine ? 0.018 : 0.02);
    const lean = new THREE.Vector3((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
    const segs = lod ? 8 : 16;
    const trunk = curvePoints(new THREE.Vector3(0, -0.5, 0), lean, H + 0.5, segs, rnd, { gravity: 0.004, wander: pine ? 0.07 : 0.03 });
    const radii = trunk.map((_, i) => { const t = i / segs; return r0 * Math.pow(1 - t * 0.96, 0.9) * (1 + 0.55 * Math.exp(-t * 28)); });
    bark.push(tube(trunk, radii, radial, rnd, 1.0, 0.1));
    const crownStart = pine ? 0.45 + rnd() * 0.15 : 0.08 + rnd() * 0.06;
    const crownC = trunk[Math.round(segs * (pine ? 0.8 : 0.5))].clone();
    const crownR = pine ? H * 0.3 : H * 0.42;
    const whorls = Math.round((pine ? 9 : 16) * (lod === 2 ? 0.5 : 1));
    const tint = pine ? [1.0, 1.0, 0.95] : [0.78, 0.86, 0.82];
    for (let w = 0; w < whorls; w++) {
      const t = crownStart + (1 - crownStart) * (w / whorls) * 0.96;
      const idx = Math.min(segs, Math.round(t * segs));
      const base = trunk[idx];
      const nBr = pine ? 3 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 3);
      const conical = pine ? 0.55 + 0.45 * Math.sin(Math.min(1, (1 - t) / (1 - crownStart)) * Math.PI * 0.85) : Math.pow(1 - t, 0.85);
      const brLen = (pine ? H * 0.22 : H * 0.36) * conical + 0.4;
      const phase = rnd() * Math.PI * 2;
      for (let b = 0; b < nBr; b++) {
        if (pine && rnd() < 0.15) continue; // gaps make the crown irregular
        const a = phase + (b / nBr) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
        const up = pine ? 0.25 + rnd() * 0.35 : -0.15 - rnd() * 0.2 + t * 0.35;
        const dir = new THREE.Vector3(Math.cos(a), up, Math.sin(a));
        const L = brLen * (0.75 + rnd() * 0.5);
        const pts = curvePoints(base, dir, L, lod ? 3 : 5, rnd, { gravity: pine ? 0.02 : -0.015, wander: 0.25 });
        const br = r0 * 0.32 * Math.sqrt(conical) + 0.02;
        if (lod < 2) bark.push(tube(pts, pts.map((_, i) => br * (1 - (i / pts.length) * 0.8)), lod ? 3 : 4, rnd, 0.6, 0.05));
        // foliage cards along the outer part of the branch, roughly horizontal, rolled a little
        const nCards = Math.max(2, Math.round((pine ? 4 : 5) * (L / 3 + 0.6)));
        for (let c = 0; c < nCards; c++) {
          if (rnd() > cardKeep) continue;
          const f = 0.2 + 0.8 * (c / nCards) * (0.9 + rnd() * 0.1);
          const i0 = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
          const p = pts[i0].clone().lerp(pts[i0 + 1], f * (pts.length - 1) - i0);
          const along = pts[i0 + 1].clone().sub(pts[i0]).normalize();
          along.y -= pine ? 0 : 0.25; along.applyAxisAngle(UP, (rnd() - 0.5) * 1.2).normalize();
          const roll = (rnd() - 0.5) * 1.1;
          const side = along.clone().cross(UP).normalize().applyAxisAngle(along, roll);
          const len = (pine ? 2.1 : 2.3) * (0.8 + rnd() * 0.4) * cardScale;
          cards.quad(p.clone().addScaledVector(along, -0.2), along, side, len, len * 0.95, [0, 1, 1, 0], crownC, crownR, tint, f);
        }
      }
    }
    // leader shoot cards
    const top = trunk[trunk.length - 1];
    for (let k = 0; k < 3; k++) {
      const side = new THREE.Vector3(Math.cos(k * 2.1), 0, Math.sin(k * 2.1));
      cards.quad(top.clone().add(new THREE.Vector3(0, -1.2, 0)), UP, side, 2.0 * cardScale, 1.6 * cardScale, [0, 1, 1, 0], crownC, crownR, tint, 1);
    }
    return finish(bark, cards, H, species);
  }

  // broadleaf
  const H = (9 + rnd() * 8) * age;
  const r0 = 0.16 + H * 0.016;
  const lean = new THREE.Vector3((rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3).normalize();
  const segs = lod ? 6 : 10;
  const trunkH = H * (0.32 + rnd() * 0.15);
  const trunk = curvePoints(new THREE.Vector3(0, -0.5, 0), lean, trunkH + 0.5, segs, rnd, { gravity: 0.01, wander: 0.12 });
  bark.push(tube(trunk, trunk.map((_, i) => r0 * (1 - (i / segs) * 0.3) * (1 + 0.7 * Math.exp(-(i / segs) * 14))), radial + 2, rnd, 1.0, 0.16));
  const crownC = trunk[segs].clone().add(new THREE.Vector3(0, (H - trunkH) * 0.45, 0));
  const crownR = (H - trunkH) * 0.65 + 1.5;
  const tipsOut = [];
  const grow = (start, dir, len, rad, depth) => {
    const pts = curvePoints(start, dir, len, lod ? 3 : 5, rnd, { gravity: 0.05, wander: 0.35 });
    bark.push(tube(pts, pts.map((_, i) => rad * (1 - (i / pts.length) * 0.55)), Math.max(3, radial - depth * 2), rnd, 0.8, 0.08));
    if (depth >= (lod === 2 ? 1 : 2)) { tipsOut.push(pts); return; }
    const n = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const f = 0.45 + rnd() * 0.5;
      const i0 = Math.floor(f * (pts.length - 1));
      const base = pts[i0];
      const d = pts[Math.min(pts.length - 1, i0 + 1)].clone().sub(base).normalize();
      const a = rnd() * Math.PI * 2;
      const nd = d.clone().add(new THREE.Vector3(Math.cos(a), 0.2 + rnd() * 0.4, Math.sin(a)).multiplyScalar(0.9)).normalize();
      grow(base, nd, len * (0.55 + rnd() * 0.2), rad * 0.55, depth + 1);
    }
    tipsOut.push(pts);
  };
  const limbs = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + rnd();
    const dir = new THREE.Vector3(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6).normalize();
    grow(trunk[segs].clone(), dir, (H - trunkH) * (0.55 + rnd() * 0.25), r0 * 0.62, 0);
  }
  // leafy twig clusters around branch ends and along outer limbs
  const tint = [0.95 + rnd() * 0.1, 0.95 + rnd() * 0.1, 0.9];
  for (const pts of tipsOut) {
    const nC = Math.round((16 + rnd() * 10) * cardKeep) + 3;
    for (let c = 0; c < nC; c++) {
      const f = 0.4 + rnd() * 0.6;
      const p = pts[Math.min(pts.length - 1, Math.floor(f * pts.length))].clone();
      p.add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(1.4 * cardScale));
      const out = p.clone().sub(crownC).normalize();
      const along = out.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.2, 0.3 + rnd() * 0.4, (rnd() - 0.5) * 1.2)).normalize();
      const side = along.clone().cross(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize()).normalize();
      const len = (0.95 + rnd() * 0.45) * cardScale;
      cards.quad(p, along, side, len, len, [0, 1, 1, 0], crownC, crownR, tint, 1);
    }
  }
  return finish(bark, cards, H, species);
}

function finish(bark, cards, H, species) {
  const barkGeo = barkWind(mergeGeometries(bark.map((g) => g.index ? g : g), false), H);
  barkGeo.computeBoundingSphere();
  const leafGeo = cards.geometry();
  leafGeo.computeBoundingSphere();
  return { bark: barkGeo, leaves: leafGeo, height: H, species };
}

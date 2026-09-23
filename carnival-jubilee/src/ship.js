import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { rng, clamp, lerp, smooth, lathe, trs, instanced, baked, mergeLoose, mergeGeometries } from './util.js';
import * as TX from './textures.js';

// Units are metres. +X is forward (bow), +Y up, Z across the beam. Waterline at y = 0.
const BEAM = 21;
const DECK = 3;
const Y_PROM = 14; // promenade / lifeboat deck
const Y_BAL = 20; // first balcony deck
const N_BAL = 10; // balcony decks
const Y_TOP = Y_BAL + N_BAL * DECK; // 50: lido deck
const AFT_STEPS = [-169, -169, -168, -166, -163, -160, -157, -154, -151, -148, -148];
const frontX = (d) => 131 - d * 2.1;

export function tipX(y) {
  const t = smooth(-9, 17, y);
  return 158.5 + 13.5 * Math.pow(t, 0.8) + 7.5 * Math.exp(-(((y + 5) / 2.4) ** 2));
}
export function sternX(y) { return -171 + 10 * (1 - smooth(-9, -0.5, y)); }
export function hullTop(x) { const t = clamp((x - 40) / 132, 0, 1); return Y_PROM + 3.2 * t * t; }
export function halfW(x, y) {
  const xt = tipX(y), xs = sternX(y);
  if (x >= xt || x <= xs) return 0;
  let sec = 1;
  const r = 2.6;
  if (y < -9 + r) { const u = clamp((y + 9) / r, 0, 1); sec = (BEAM - r + r * Math.sqrt(1 - (1 - u) * (1 - u))) / BEAM; }
  const run = lerp(92, 128, smooth(-9, 17, y));
  const fs = xt - run;
  let plan = 1;
  if (x > fs) { const t = (x - fs) / (xt - fs); plan = Math.pow(Math.max(0, 1 - Math.pow(t, 1.7)), 0.82); }
  const as = xs + 48;
  if (x < as) {
    const t = (as - x) / (as - xs);
    const low = 1 - smooth(-9, 1.5, y);
    plan *= (1 - 0.08 * t * t) * (1 - 0.6 * low * Math.pow(t, 1.4));
  }
  return BEAM * sec * plan;
}

// ---------------------------------------------------------------- geometry helpers
function outline(xa, xf, { inset = () => 0, frontR = 16, aftR = 3, yRef = Y_PROM, maxW = 99, n = 200 } = {}) {
  const side = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = xa + (xf - xa) * (1 - Math.pow(1 - t, 1.7));
    let w = Math.min(halfW(x, yRef), maxW) - inset(x);
    if (x > xf - frontR) { const k = (x - (xf - frontR)) / frontR; w *= Math.sqrt(Math.max(0, 1 - k * k)); }
    if (x < xa + aftR) { const k = (xa + aftR - x) / aftR; w -= aftR * (1 - Math.sqrt(Math.max(0, 1 - k * k))); }
    side.push([x, Math.max(w, 0.001)]);
  }
  const pts = side.map(([x, w]) => [x, w]);
  for (let i = side.length - 2; i >= 0; i--) pts.push([side[i][0], -side[i][1]]);
  return pts;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function offsetOutline(pts, d) {
  const s = signedArea(pts) > 0 ? 1 : -1;
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] + s * (dz / l) * d, p[1] - s * (dx / l) * d];
  });
}

// Vertical wall around a closed (or open) polyline.
function wall(pts, y0, y1, { uScale = 10, vScale = 3, vBase = 0, closed = true, smoothDeg = 38, uOffset = 0 } = {}) {
  const s = signedArea(pts) > 0 ? 1 : -1;
  const n = pts.length, edges = closed ? n : n - 1;
  const en = [];
  for (let i = 0; i < edges; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
    en.push([s * dz / l, -s * dx / l, l]);
  }
  const cosT = Math.cos(smoothDeg * Math.PI / 180);
  const pos = [], nor = [], uv = [], idx = [];
  let u = uOffset;
  for (let i = 0; i < edges; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const cur = en[i];
    const prev = en[(i - 1 + edges) % edges], next = en[(i + 1) % edges];
    const blend = (a, b) => {
      if ((!closed && (a === b)) || a[0] * b[0] + a[1] * b[1] < cosT) return [a[0], a[1]];
      const x = a[0] + b[0], z = a[1] + b[1], l = Math.hypot(x, z) || 1; return [x / l, z / l];
    };
    const n0 = (!closed && i === 0) ? cur : blend(cur, prev);
    const n1 = (!closed && i === edges - 1) ? cur : blend(cur, next);
    const u1 = u + cur[2] / uScale;
    const base = pos.length / 3;
    pos.push(p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y1, p[1]);
    nor.push(n0[0], 0, n0[1], n1[0], 0, n1[1], n1[0], 0, n1[1], n0[0], 0, n0[1]);
    uv.push(u, (y0 - vBase) / vScale, u1, (y0 - vBase) / vScale, u1, (y1 - vBase) / vScale, u, (y1 - vBase) / vScale);
    if (s < 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    u = u1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function cap(pts, y, { up = true, uvScale = 0.125 } = {}) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, up ? -z : z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, y, 0);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
  return g;
}

function ringStrip(inner, outer, y, up = true) {
  const pos = [], idx = [], nor = [], uv = [];
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    pos.push(inner[i][0], y, inner[i][1], outer[i][0], y, outer[i][1]);
    nor.push(0, up ? 1 : -1, 0, 0, up ? 1 : -1, 0);
    uv.push(0, 0, 1, 0);
  }
  const s = signedArea(inner) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2;
    if ((s > 0) === up) idx.push(a, a + 1, b + 1, a, b + 1, b); else idx.push(a, b + 1, a + 1, a, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Closed band made of a lip: outer wall + top + bottom.
function lipRing(pts, y, out = 0.25, h = 0.3) {
  const outer = offsetOutline(pts, out);
  return mergeLoose([
    wall(outer, y - h, y, { uScale: 50 }),
    ringStrip(pts, outer, y, true),
    ringStrip(pts, outer, y - h, false),
  ]);
}

function hullGeometry() {
  const NS = 280, K = 6, M = 46, R = K + M;
  const pos = [], uv = [], idx = [];
  const topAt = (x) => hullTop(x) + 1.15 * smooth(100, 118, x);
  for (let side = 0; side < 2; side++) {
    const sg = side ? -1 : 1;
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      const x = -172 + 344 * (s - 0.62 * Math.sin(2 * Math.PI * s) / (2 * Math.PI));
      const yt = topAt(x);
      for (let r = 0; r < R; r++) {
        let y, w;
        if (r < K) { y = -9; w = halfW(x, -9) * (r / K); } else {
          const t = (r - K) / (M - 1);
          const f = t < 0.12 ? t * 0.55 / 0.12 * 0.12 : 0.066 + (t - 0.12) / 0.88 * 0.934;
          y = -9 + (yt + 9) * f;
          w = halfW(x, Math.min(y, Y_PROM + 3.2));
        }
        pos.push(x, y, sg * w);
        uv.push((x - TX.HULL.xMin) / (TX.HULL.xMax - TX.HULL.xMin), (y - TX.HULL.zMin) / (TX.HULL.zMax - TX.HULL.zMin));
      }
    }
    for (let i = 0; i < NS; i++) for (let r = 0; r < R - 1; r++) {
      const a = base + i * R + r, b = base + (i + 1) * R + r, c = b + 1, d = a + 1;
      if (side === 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function hullDeckGeometry() {
  // deck strip following the sheer line
  const pos = [], uv = [], idx = [], nor = [];
  const N = 220;
  for (let i = 0; i <= N; i++) {
    const x = lerp(sternX(Y_PROM) + 0.05, tipX(Y_PROM + 3) - 0.1, i / N);
    const y = hullTop(x) + 0.02, w = Math.max(0, halfW(x, Math.min(y, Y_PROM + 3.2)) - 0.05);
    pos.push(x, y, w, x, y, -w);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(x * 0.125, w * 0.125, x * 0.125, -w * 0.125);
  }
  for (let i = 0; i < N; i++) { const a = i * 2, b = a + 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function transomGeometry() {
  // flat stern plate closing the hull behind the rudder area
  const x = sternX(0) + 0.02;
  const pts = [];
  for (let y = -0.4; y <= Y_PROM + 0.001; y += 0.5) pts.push([halfW(x + 0.35, y), y]);
  const shape = new THREE.Shape();
  shape.moveTo(-pts[0][0], pts[0][1]);
  pts.forEach(([w, y]) => shape.lineTo(w, y));
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(-pts[i][0], pts[i][1]);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateY(-Math.PI / 2);
  g.translate(x + 0.3, 0, 0);
  const uv = g.getAttribute('uv'), p = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (-100 + (p.getZ(i) + 20) * 0.9 - TX.HULL.xMin) / (TX.HULL.xMax - TX.HULL.xMin), (p.getY(i) - TX.HULL.zMin) / (TX.HULL.zMax - TX.HULL.zMin));
  return g;
}

// ---------------------------------------------------------------- the ship
export function buildShip(renderer) {
  const group = new THREE.Group();
  group.name = 'ship';
  const night = []; // {mat, day, night}
  const updaters = [];
  const R = rng(99);

  // ----- materials
  const hullT = TX.hullTextures();
  const hullMat = new THREE.MeshPhysicalMaterial({
    map: hullT.map, roughnessMap: hullT.rough, roughness: 0.9, metalness: 0.15,
    clearcoat: 0.45, clearcoatRoughness: 0.3, envMapIntensity: 0.7, emissiveMap: hullT.emissive, emissive: 0xffffff, emissiveIntensity: 0,
  });
  night.push({ mat: hullMat, day: 0, night: 1.2 });
  const balT = TX.balconyTextures(3);
  const balMat = new THREE.MeshStandardMaterial({
    map: balT.map, roughnessMap: balT.rough, metalnessMap: balT.metal, roughness: 0.85, metalness: 1,
    emissiveMap: balT.emissive, emissive: 0xffffff, emissiveIntensity: 0,
  });
  night.push({ mat: balMat, day: 0, night: 0.85 });
  const cabT = TX.windowWallTextures(9, 'cabin');
  const cabMat = new THREE.MeshStandardMaterial({ map: cabT.map, roughness: 0.42, metalness: 0.05, emissiveMap: cabT.emissive, emissive: 0xffffff, emissiveIntensity: 0 });
  night.push({ mat: cabMat, day: 0, night: 1.0 });
  const bandT = TX.windowWallTextures(13, 'band');
  const bandMat = new THREE.MeshStandardMaterial({ map: bandT.map, roughness: 0.3, metalness: 0.1, emissiveMap: bandT.emissive, emissive: 0xffffff, emissiveIntensity: 0 });
  night.push({ mat: bandMat, day: 0, night: 1.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.42, metalness: 0.02 });
  const offWhite = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.5 });
  const teak = new THREE.MeshStandardMaterial({ map: TX.teakTexture(), roughness: 0.62, color: 0xf0e2d0 });
  const deckComp = new THREE.MeshStandardMaterial({ map: TX.compositeDeck(), roughness: 0.78 });
  const deckGreen = new THREE.MeshStandardMaterial({ map: TX.compositeDeck([82, 108, 98]), roughness: 0.85 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa9d4e0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.28, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false });
  const darkGlass = new THREE.MeshStandardMaterial({ color: 0x0b1522, roughness: 0.06, metalness: 0.85, emissive: 0x6fa8ff, emissiveIntensity: 0 });
  night.push({ mat: darkGlass, day: 0, night: 0.08 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9199, roughness: 0.32, metalness: 0.85 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.6 });
  const navy = new THREE.MeshStandardMaterial({ color: 0x0f2352, roughness: 0.35, metalness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd11c34, roughness: 0.3, metalness: 0.25 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1e62c8, roughness: 0.35, metalness: 0.2 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6410, roughness: 0.4, metalness: 0.05 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  night.push({ mat: ledMat, color: true, day: new THREE.Color(0x000000), night: new THREE.Color(0x3aa8ff).multiplyScalar(2.2) });
  const warmLed = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
  night.push({ mat: warmLed, color: true, day: new THREE.Color(0x000000), night: new THREE.Color(0xffc27a).multiplyScalar(2.6) });

  const add = (geo, mat, { cast = true, receive = true, name } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = receive;
    if (name) m.name = name;
    group.add(m);
    return m;
  };

  // ----- hull
  add(hullGeometry(), hullMat, { name: 'hull' });
  add(transomGeometry(), hullMat);
  add(hullDeckGeometry(), teak, { cast: false });
  // bow bulwark inner face + cap rail
  {
    const pts = [];
    for (let x = 100; x <= tipX(17) - 0.2; x += 0.8) pts.push([x, Math.max(0.05, halfW(x, 17) - 0.12)]);
    const side = pts.concat(pts.slice().reverse().map(([x, w]) => [x, -w]));
    const inner = wall(side, 0, 1.15, { uScale: 40, closed: false });
    const p = inner.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + hullTop(p.getX(i)));
    const nm = inner.getAttribute('normal');
    for (let i = 0; i < nm.count; i++) nm.setXYZ(i, -nm.getX(i), 0, -nm.getZ(i));
    add(inner, new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, side: THREE.DoubleSide }), { cast: false });
  }

  // ----- lower cabin block with the lifeboat recess
  const recessInset = (x) => 4.3 * smooth(-120, -110, x) * (1 - smooth(106, 116, x));
  const lowPts = outline(sternX(Y_PROM) + 0.4, 141, { inset: recessInset, frontR: 22, aftR: 2 });
  add(wall(lowPts, Y_PROM, Y_BAL, { uScale: TX.WIN.w, vScale: TX.WIN.h, vBase: Y_PROM }), cabMat);

  // ----- balcony decks, stepping aft terraces and raked front
  const deckOutlines = [];
  const balGeos = [], capGeos = [], lipGeos = [], ledGeos = [];
  for (let d = 0; d < N_BAL; d++) {
    const y0 = Y_BAL + d * DECK;
    const pts = outline(AFT_STEPS[d], frontX(d), { frontR: 17 + d * 0.3, aftR: 2.5 });
    deckOutlines.push(pts);
    balGeos.push(wall(pts, y0, y0 + DECK, { uScale: TX.BALC.w, vScale: TX.BALC.h, vBase: Y_BAL }));
    capGeos.push(cap(pts, y0 + DECK, { uvScale: 0.125 }));
    lipGeos.push(lipRing(pts, y0 + 0.02, 0.28, 0.32));
  }
  const topPts = outline(AFT_STEPS[N_BAL], frontX(N_BAL), { frontR: 20, aftR: 2.5 });
  deckOutlines.push(topPts);
  lipGeos.push(lipRing(topPts, Y_TOP + 0.02, 0.3, 0.34));
  lipGeos.push(lipRing(lowPts, Y_PROM + 0.02, 0.2, 0.25));
  // underside of the first balcony deck (ceiling of the lifeboat recess)
  add(cap(deckOutlines[0], Y_BAL, { up: false }), offWhite, { cast: false });
  add(mergeGeometries(balGeos), balMat, { name: 'balconies' });
  add(mergeGeometries(capGeos.slice(0, N_BAL - 1).map((g) => g.toNonIndexed())), deckComp, { cast: false });
  add(mergeLoose(lipGeos), white);
  // LED accent under each lip (lit at night)
  for (let d = 0; d <= N_BAL; d += 1) ledGeos.push(wall(offsetOutline(deckOutlines[d], 0.29), Y_BAL + d * DECK - 0.36, Y_BAL + d * DECK - 0.3, { uScale: 50 }));
  add(mergeGeometries(ledGeos), ledMat, { cast: false, receive: false });

  // ----- stepped forward tiers: curved white parapets on every terrace
  {
    const tierMat = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.4, side: THREE.DoubleSide });
    const geos = [];
    for (let d = 0; d < N_BAL; d++) {
      const xf = frontX(d), cx = xf - 26;
      const arc = offsetOutline(deckOutlines[d], 0.12).filter(([x]) => x > cx);
      arc.sort((a, b) => Math.atan2(a[1], a[0] - cx) - Math.atan2(b[1], b[0] - cx));
      const y = Y_BAL + (d + 1) * DECK;
      geos.push(wall(arc, y - 0.05, y + 1.15, { closed: false, uScale: 50 }));
    }
    add(mergeGeometries(geos), tierMat);
  }

  // ----- bridge + wings (deck index 8)
  {
    const d = 8, y0 = Y_BAL + d * DECK, xf = frontX(d);
    const ring = outline(AFT_STEPS[d], xf, { frontR: 17 + d * 0.3, aftR: 2.5 });
    const front = offsetOutline(ring, 0.06).filter(([x]) => x > xf - 24);
    // sort by angle around the front arc to keep it a clean open polyline
    const cx = xf - 24;
    front.sort((a, b) => Math.atan2(a[1], a[0] - cx) - Math.atan2(b[1], b[0] - cx));
    add(wall(front, y0 + 0.4, y0 + 2.6, { closed: false, uScale: 50 }), darkGlass);
    const wx = xf - 20;
    const hw = halfW(wx, Y_PROM);
    for (const s of [1, -1]) {
      const wing = new RoundedBoxGeometry(6, DECK - 0.2, 24.2 - hw, 2, 0.25);
      add(baked(wing, [wx, y0 + DECK / 2, s * (hw + (24.2 - hw) / 2 - 0.1)]), white);
      const wg = new THREE.PlaneGeometry(24.2 - hw - 0.4, 1.7);
      add(baked(wg, [wx + 3.02, y0 + 1.55, s * (hw + (24.2 - hw) / 2)], [0, Math.PI / 2, 0]), darkGlass, { cast: false });
      add(baked(new THREE.PlaneGeometry(5.4, 1.7), [wx, y0 + 1.55, s * 24.21], [0, s > 0 ? 0 : Math.PI, 0]), darkGlass, { cast: false });
    }
  }

  // ----- top deck (lido level)
  add(cap(topPts, Y_TOP, { uvScale: 0.125 }), teak, { cast: false, name: 'lidoDeck' });
  const railPts = offsetOutline(topPts, -0.35);
  add(wall(railPts, Y_TOP, Y_TOP + 1.25, { uScale: 50 }), glass, { cast: false, receive: false });
  add(lipRing(offsetOutline(railPts, 0.04), Y_TOP + 1.3, 0.08, 0.08), steel, { cast: false });
  // aft terrace glass rails on each stepped deck
  for (let d = 2; d < N_BAL; d++) {
    if (AFT_STEPS[d + 1] - AFT_STEPS[d] < 1) continue;
    const y = Y_BAL + (d + 1) * DECK;
    const hw = halfW(AFT_STEPS[d], Y_PROM) - 3.3;
    const x = AFT_STEPS[d] + 0.3;
    add(baked(new RoundedBoxGeometry(0.25, 1.1, hw * 2, 2, 0.08), [x, y + 0.55, 0]), red);
  }

  // ----- deckhouses on top
  const houseFwd = outline(46, 104, { inset: (x) => 1.6, frontR: 24, aftR: 3, maxW: 17.5, n: 120 });
  add(wall(houseFwd, Y_TOP, Y_TOP + 8, { uScale: TX.WIN.w, vScale: 4, vBase: Y_TOP }), bandMat);
  add(cap(houseFwd, Y_TOP + 8), teak, { cast: false });
  add(lipRing(houseFwd, Y_TOP + 8.02, 0.35, 0.4), white);
  add(wall(offsetOutline(houseFwd, -0.4), Y_TOP + 8, Y_TOP + 9.1, { uScale: 50 }), glass, { cast: false, receive: false });
  const loft = outline(60, 92, { inset: () => 6, frontR: 14, aftR: 4, maxW: 15, n: 90 });
  add(wall(loft, Y_TOP + 8, Y_TOP + 11.5, { uScale: TX.WIN.w, vScale: 3.5, vBase: Y_TOP + 8 }), bandMat);
  add(cap(loft, Y_TOP + 11.5), deckComp, { cast: false });
  add(lipRing(loft, Y_TOP + 11.52, 0.3, 0.35), white);
  const houseAft = outline(-124, -24, { inset: () => 4, frontR: 6, aftR: 5, maxW: 20, n: 100 });
  add(wall(houseAft, Y_TOP, Y_TOP + 4, { uScale: TX.WIN.w, vScale: 4, vBase: Y_TOP }), bandMat);
  add(cap(houseAft, Y_TOP + 4), deckComp, { cast: false });
  add(lipRing(houseAft, Y_TOP + 4.02, 0.3, 0.35), white);
  add(wall(offsetOutline(houseAft, -0.4), Y_TOP + 4, Y_TOP + 5.1, { uScale: 50 }), glass, { cast: false, receive: false });

  // ----- lifeboats, davits, liferafts
  {
    const hullPts = [];
    const n = 28;
    for (let i = 0; i < n; i++) {
      const r = i / (n - 1);
      const z = Math.sin(r * Math.PI);
      hullPts.push([0.02 + 1.9 * Math.pow(z, 0.55), (r - 0.5) * 10.4]);
    }
    const boat = lathe(hullPts, 20);
    boat.rotateZ(Math.PI / 2);
    boat.scale(1, 0.82, 1);
    // colour: orange lower hull, white canopy above y > 0.15
    const col = [];
    const bp = boat.getAttribute('position');
    const c1 = new THREE.Color(0xff5a0a), c2 = new THREE.Color(0xf4f4f0), c3 = new THREE.Color(0x2a2f38);
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      if (y < -0.2) bp.setY(i, -0.2 + (y + 0.2) * 0.8);
      const c = y > 0.35 ? c2 : (y > 0.05 && y < 0.35 && Math.abs(bp.getX(i)) < 3.8 ? c3 : c1);
      col.push(c.r, c.g, c.b);
    }
    boat.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    boat.computeVertexNormals();
    const boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38 });
    const armGeo = mergeLoose([
      baked(new THREE.BoxGeometry(0.35, 0.5, 3.3), [0, 0, 1.4]),
      baked(new THREE.BoxGeometry(0.35, 3.8, 0.45), [0, -1.8, -0.1]),
      baked(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 4), [0, -1.2, 2.9]),
    ]);
    const boats = [], arms = [];
    for (let x = -104; x <= 101; x += 11.4) {
      if (x > -36 && x < -2) continue; // midship glass atrium bay
      const hw = halfW(x, Y_PROM);
      for (const s of [1, -1]) {
        boats.push(trs([x, Y_PROM + 2.2, s * (hw - 2.05)], [0, 0, 0], [1, 1, 1]));
        for (const dx of [-3.4, 3.4]) arms.push(trs([x + dx, Y_BAL - 0.55, s * (hw - 4.35)], [0, s > 0 ? 0 : Math.PI, 0]));
      }
    }
    group.add(instanced(boat, boatMat, boats));
    group.add(instanced(armGeo, darkSteel, arms));
    // liferaft canisters in racks at the recess ends
    const can = mergeLoose([
      baked(new THREE.CylinderGeometry(0.36, 0.36, 1.45, 14), [0, 0, 0], [0, 0, Math.PI / 2]),
      baked(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14), [-0.45, 0, 0], [0, 0, Math.PI / 2]),
      baked(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14), [0.45, 0, 0], [0, 0, Math.PI / 2]),
    ]);
    const cans = [];
    for (const xs of [[-117, -110], [103, 110]]) for (let x = xs[0]; x <= xs[1]; x += 1.6) {
      const hw = halfW(x, Y_PROM);
      for (const s of [1, -1]) for (let k = 0; k < 3; k++) cans.push(trs([x, Y_PROM + 0.45 + k * 0.78, s * (hw - 1.1)]));
    }
    group.add(instanced(can, white, cans));
    // promenade rail along the recess
    const rail = [];
    for (let x = -112; x <= 108; x += 2) rail.push([x, halfW(x, Y_PROM) - 0.2]);
    for (const s of [1, -1]) {
      const pts = rail.map(([x, z]) => [x, s * z]);
      add(wall(pts, Y_PROM, Y_PROM + 1.1, { closed: false, uScale: 50 }), glass, { cast: false, receive: false });
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, Y_PROM + 1.12, z))), 120, 0.05, 6);
      add(tube, steel, { cast: false });
    }
  }

  // ----- bow mooring deck furniture
  {
    const bollard = mergeLoose([
      lathe([[0, 0], [0.34, 0], [0.34, 0.08], [0.24, 0.12], [0.24, 0.62], [0.32, 0.7], [0.32, 0.78], [0, 0.8]], 16),
    ]);
    const bol = [];
    for (const [x, z] of [[132, 9.5], [132, 8.4], [144, 7.5], [144, 6.3], [155, 4.6], [155, 3.5], [-150, 16], [-150, 14.8], [-160, 13], [-160, 11.8]]) {
      for (const s of [1, -1]) {
        const y = x > 0 ? hullTop(x) : Y_PROM;
        bol.push(trs([x, y, s * z]));
      }
    }
    group.add(instanced(bollard, darkSteel, bol));
    const drum = mergeLoose([
      baked(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 24), [0, 0.95, 0], [Math.PI / 2, 0, 0]),
      baked(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 24), [0, 0.95, 0.75], [Math.PI / 2, 0, 0]),
      baked(new THREE.CylinderGeometry(1.15, 1.15, 0.12, 24), [0, 0.95, -0.75], [Math.PI / 2, 0, 0]),
      baked(new RoundedBoxGeometry(2.2, 0.5, 2.2, 2, 0.1), [0, 0.25, 0]),
    ]);
    const drums = [];
    for (const s of [1, -1]) { drums.push(trs([148, hullTop(148), s * 3.2])); drums.push(trs([128, hullTop(128), s * 7])); }
    group.add(instanced(drum, new THREE.MeshStandardMaterial({ color: 0x3b4d63, roughness: 0.45, metalness: 0.5 }), drums));
    // anchor chains from windlass to hawse
    for (const s of [1, -1]) {
      const a = new THREE.Vector3(148, hullTop(148) + 1.2, s * 3.2);
      const b = new THREE.Vector3(156.5, hullTop(156.5) + 0.1, s * (halfW(156.5, 14) - 0.6));
      const pts = [a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.3, 0)), b];
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.12, 6), darkSteel, { cast: false });
    }
    // breakwater
    const bw = [];
    for (let t = -1; t <= 1.0001; t += 0.05) bw.push([160 - Math.abs(t) * 9, t * 7]);
    const bwg = wall(bw, 0, 1.3, { closed: false, uScale: 50 });
    const p = bwg.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + hullTop(p.getX(i)));
    add(bwg, new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, side: THREE.DoubleSide }));
  }

  // ----- funnel: Carnival whale tail — streamlined red stem crowned by swept horizontal wings
  const FX = -96, FY = Y_TOP + 4;
  {
    const fgrp = new THREE.Group();
    fgrp.position.set(FX, FY, 0);
    group.add(fgrp);
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; fgrp.add(m); return m; };
    const paint = (w, h, fn) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      fn(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return t;
    };
    // stem: side profile (x aft-negative, y up), shape space x in [-14, 10], y in [0, 18]
    const stemTex = paint(1024, 1024, (g, W, H) => {
      const X = (x) => (x + 14) / 24 * W, Y = (y) => (1 - y / 18) * H;
      g.fillStyle = '#d3182f'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f4f6fa';
      g.beginPath(); g.moveTo(X(10), Y(2.6)); g.lineTo(X(10), Y(5.4)); g.lineTo(X(-14), Y(12.2)); g.lineTo(X(-14), Y(9.4)); g.fill();
      g.fillStyle = '#1d4fb3';
      g.beginPath(); g.moveTo(X(10), Y(0)); g.lineTo(X(10), Y(3.4)); g.lineTo(X(-14), Y(10.2)); g.lineTo(X(-14), Y(0)); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.06)';
      for (let i = 0; i < 30; i++) g.fillRect(0, Y(i * 0.6), W, 1);
    });
    const stemMat = new THREE.MeshPhysicalMaterial({ map: stemTex, roughness: 0.28, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.12 });
    const stem = new THREE.Shape();
    stem.moveTo(7.5, 0);
    stem.bezierCurveTo(5.5, 6, 2.5, 11.5, -2.5, 15.6);
    stem.lineTo(-10.5, 16.4);
    stem.bezierCurveTo(-9.6, 11, -8.6, 5, -8.8, 0);
    stem.closePath();
    const sg = new THREE.ExtrudeGeometry(stem, { depth: 3.2, bevelEnabled: true, bevelThickness: 1.1, bevelSize: 1.0, bevelSegments: 6, curveSegments: 32 });
    const uv = sg.getAttribute('uv'), sp = sg.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (sp.getX(i) + 14) / 24, sp.getY(i) / 18);
    sg.translate(0, 0, -1.6);
    add(sg, stemMat);
    // wings: top view shape (x aft-negative, z outboard), one per side with dihedral
    const wingTex = paint(512, 512, (g, W, H) => {
      // shape space x in [-18, 2], z in [0, 13]
      const Z = (z) => (1 - z / 13) * H;
      g.fillStyle = '#d3182f'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#f4f6fa'; g.fillRect(0, Z(9.4), W, Z(8.4) - Z(9.4));
      g.fillStyle = '#1d4fb3'; g.fillRect(0, 0, W, Z(9.4));
    });
    const wingMat = new THREE.MeshPhysicalMaterial({ map: wingTex, roughness: 0.28, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.12 });
    const wing = new THREE.Shape();
    wing.moveTo(0.5, 0);
    wing.bezierCurveTo(-2.5, 3.5, -7, 8.5, -11.5, 12.2);
    wing.quadraticCurveTo(-13.2, 12.8, -14.2, 11.6);
    wing.bezierCurveTo(-13.6, 8, -13.2, 4, -12.6, 0);
    wing.closePath();
    for (const s of [1, -1]) {
      const wg = new THREE.ExtrudeGeometry(wing, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.3, bevelSegments: 4, curveSegments: 24 });
      const wuv = wg.getAttribute('uv'), wp = wg.getAttribute('position');
      for (let i = 0; i < wuv.count; i++) wuv.setXY(i, (wp.getX(i) + 18) / 20, wp.getY(i) / 13);
      // shape y -> outboard z, extrusion -> thickness in y
      wg.rotateX(s > 0 ? Math.PI / 2 : -Math.PI / 2);
      wg.computeVertexNormals();
      const m = add(wg, wingMat);
      m.position.set(-1.8, 15.6, 0);
      m.rotation.x = -s * 0.2; // dihedral: tips rise outboard
    }
    // exhaust grilles in the stem crown
    const stacks = [];
    for (let i = 0; i < 4; i++) stacks.push(trs([-4.5 - i * 1.6, 16.2, 0]));
    fgrp.add(instanced(lathe([[0, 0], [0.42, 0], [0.42, 0.9], [0.36, 1.0], [0, 1.0]], 14), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7, metalness: 0.4 }), stacks));
    add(baked(new RoundedBoxGeometry(22, 1.2, 9, 2, 0.4), [-1, 0.6, 0]), white);
  }
  // twin white exhaust stacks with red crowns (forward of midships)
  {
    const stackGeo = lathe([[0, 0], [1.9, 0], [1.9, 10.5], [1.75, 11], [0, 11]], 32);
    const band = lathe([[1.93, 8.4], [1.93, 10.2]], 32);
    for (const x of [36, 29]) {
      add(baked(stackGeo, [x, Y_TOP, 0]), white);
      add(baked(band, [x, Y_TOP, 0]), red, { cast: false });
    }
  }

  // ----- radar mast & domes
  const radars = [];
  {
    const MX = 95, MY = Y_TOP + 8;
    add(baked(lathe([[0.7, 0], [0.45, 9], [0.3, 13], [0, 13.05]], 16), [MX, MY, 0]), white);
    add(baked(new RoundedBoxGeometry(1.2, 0.4, 11, 2, 0.12), [MX, MY + 9.5, 0]), white);
    add(baked(new THREE.CylinderGeometry(0.06, 0.06, 5, 6), [MX, MY + 15, 0]), steel);
    add(baked(new RoundedBoxGeometry(5, 0.35, 5, 2, 0.1), [MX - 1, MY + 6, 0]), white);
    for (const [z, y] of [[-3.8, 10], [3.8, 10], [0, 13.2]]) {
      const pivot = new THREE.Group();
      pivot.position.set(MX, MY + y, z);
      const bar = new THREE.Mesh(new RoundedBoxGeometry(5.5, 0.3, 0.35, 2, 0.1), white);
      bar.position.y = 0.45; bar.castShadow = true;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.4, 12), darkSteel);
      ped.position.y = 0.2;
      pivot.add(bar, ped);
      group.add(pivot);
      radars.push(pivot);
    }
    const dome = mergeLoose([
      new THREE.SphereGeometry(1.4, 24, 16).translate(0, 2.1, 0),
      new THREE.CylinderGeometry(0.4, 0.55, 1.2, 12).translate(0, 0.6, 0),
    ]);
    group.add(instanced(dome, white, [trs([84, Y_TOP + 11.5, 5]), trs([84, Y_TOP + 11.5, -5]), trs([76, Y_TOP + 11.5, 0]), trs([68, Y_TOP + 11.5, 4]), trs([MX - 1, MY + 6.2, 1.5], 0, 0.7), trs([MX - 1, MY + 6.2, -1.5], 0, 0.7)]));
    // mast lights
    add(baked(new THREE.SphereGeometry(0.22, 12, 8), [MX, MY + 17.6, 0]), warmLed, { cast: false });
  }

  // ----- pools and hot tubs
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x2fc3d6, roughness: 0.04, metalness: 0.0, normalMap: TX.waterNormals(), normalScale: new THREE.Vector2(0.35, 0.35),
    clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0x0a4f66, emissiveIntensity: 0.25, envMapIntensity: 1.2,
  });
  waterMat.normalMap.repeat.set(3, 3);
  night.push({ mat: waterMat, day: 0.25, night: 1.8 });
  const tileMat = new THREE.MeshStandardMaterial({ color: 0xe8f3f6, roughness: 0.35 });
  const roundRect = (w, h, r) => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return s;
  };
  const pool = (x, y, z, w, h, r) => {
    const outer = roundRect(w + 1.2, h + 1.2, r + 0.6);
    outer.holes.push(roundRect(w, h, r));
    const rim = new THREE.ExtrudeGeometry(outer, { depth: 0.45, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 12 });
    rim.rotateX(-Math.PI / 2);
    add(baked(rim, [x, y, z]), tileMat);
    const water = new THREE.ShapeGeometry(roundRect(w + 0.02, h + 0.02, r), 12);
    water.rotateX(-Math.PI / 2);
    add(baked(water, [x, y + 0.36, z]), waterMat, { cast: false });
  };
  pool(-8, Y_TOP, 0, 18, 9, 1.4);
  pool(15, Y_TOP, 0, 10, 7, 3.2);
  pool(-138, Y_TOP, 3, 11, 9, 2.5);
  pool(-148.5, Y_BAL + 7 * DECK, 0, 6, 12, 2);
  const tubs = [[29, 9.5], [29, -9.5], [-24, 11], [-24, -11], [4, 11.5], [4, -11.5]];
  for (const [x, z] of tubs) {
    const outer = new THREE.Shape(); outer.absarc(0, 0, 2.3, 0, Math.PI * 2);
    const hole = new THREE.Path(); hole.absarc(0, 0, 1.75, 0, Math.PI * 2, true); outer.holes.push(hole);
    const rim = new THREE.ExtrudeGeometry(outer, { depth: 0.55, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 32 });
    rim.rotateX(-Math.PI / 2);
    add(baked(rim, [x, Y_TOP, z]), tileMat);
    add(baked(new THREE.CircleGeometry(1.76, 32), [x, Y_TOP + 0.45, z], [-Math.PI / 2, 0, 0]), waterMat, { cast: false });
  }

  // ----- loungers & umbrellas
  {
    const frame = mergeLoose([
      baked(new THREE.BoxGeometry(1.95, 0.05, 0.05), [0, 0.32, 0.3]),
      baked(new THREE.BoxGeometry(1.95, 0.05, 0.05), [0, 0.32, -0.3]),
      ...[[-0.9, 0.3], [-0.9, -0.3], [0.5, 0.3], [0.5, -0.3]].map(([x, z]) => baked(new THREE.BoxGeometry(0.05, 0.32, 0.05), [x, 0.16, z])),
      baked(new THREE.BoxGeometry(0.05, 0.05, 0.62), [0.95, 0.12, 0]),
    ]);
    const cushion = mergeLoose([
      baked(new RoundedBoxGeometry(1.3, 0.1, 0.62, 2, 0.04), [-0.3, 0.39, 0]),
      baked(new RoundedBoxGeometry(0.72, 0.1, 0.62, 2, 0.04), [0.62, 0.62, 0], [0, 0, 0.72]),
    ]);
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.4, metalness: 0.3 });
    const mats = [], cols = [];
    const palette = [0x1c3f94, 0x1c3f94, 0x2aa4c9, 0xf1f1ee, 0xd11c34];
    const place = (x, y, z, rot, pal = null) => {
      mats.push(trs([x, y, z], [0, rot, 0]));
      cols.push(new THREE.Color(pal ?? palette[(R() * palette.length) | 0]));
    };
    // lido: rows along both sides of the pools, facing inboard
    for (let x = -24; x <= 38; x += 1.05) {
      if (Math.abs(x - 29) < 3 || Math.abs(x + 24) < 3 || Math.abs(x - 4) < 3) continue;
      for (const s of [1, -1]) {
        place(x, Y_TOP, s * 14.2, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0x1c3f94);
        if (Math.abs(x - 5) > 14) place(x, Y_TOP, s * 7.6, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0xf1f1ee);
      }
    }
    // serenity deck on top of the forward house
    for (let x = 56; x <= 88; x += 1.1) for (const z of [-12, -9, 9, 12]) if (halfW(x, Y_PROM) - 3 > Math.abs(z)) place(x, Y_TOP + 8, z, z > 0 ? -Math.PI / 2 : Math.PI / 2, 0xf1f1ee);
    // aft terraces
    for (let d = 3; d < N_BAL; d++) {
      const x = (AFT_STEPS[d] + AFT_STEPS[d + 1]) / 2;
      if (AFT_STEPS[d + 1] - AFT_STEPS[d] < 2) continue;
      for (let z = -14; z <= 14; z += 1.3) if (Math.abs(z) > 1.5) place(x, Y_BAL + (d + 1) * DECK, z, Math.PI, 0x2aa4c9);
    }
    // around the aft splash pool
    for (let z = -12; z <= 12; z += 1.1) if (Math.abs(z - 3) > 6) place(-128, Y_TOP, z, 0, 0xd11c34);
    group.add(instanced(frame, frameMat, mats));
    group.add(instanced(cushion, cushionMat, mats, { colors: cols }));

    const canopyPts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; canopyPts.push([t * 1.7, 0.45 * (1 - t) * (1 - t) - 0.02 * Math.sin(t * Math.PI)]); }
    const canopy = lathe(canopyPts.map(([r, y]) => [r, y]).reverse(), 8);
    const umb = mergeLoose([canopy.translate(0, 2.25, 0)]);
    const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6).translate(0, 1.2, 0);
    const umbs = [], ucol = [];
    const up = [0xd11c34, 0xf4f4f2, 0x1c3f94];
    let k = 0;
    for (let x = -22; x <= 38; x += 5.2) for (const z of [11, -11]) { umbs.push(trs([x, Y_TOP, z])); ucol.push(new THREE.Color(up[k++ % 3])); }
    for (let x = 58; x <= 88; x += 6) for (const z of [10.5, -10.5]) { umbs.push(trs([x, Y_TOP + 8, z])); ucol.push(new THREE.Color(up[k++ % 3])); }
    const umbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide });
    group.add(instanced(umb, umbMat, umbs, { colors: ucol }));
    group.add(instanced(pole, steel, umbs));
  }

  // ----- outdoor screen above the lido (abstract animated seascape, no text)
  const screenMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, gain: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float t; uniform float gain;
      void main(){ vec2 p=vUv; float w=sin(p.x*7.0+t*0.9)*0.06+sin(p.x*13.0-t*1.3)*0.03;
        vec3 sky=mix(vec3(1.0,0.55,0.35),vec3(0.18,0.35,0.85),smoothstep(0.35,1.0,p.y));
        vec3 sea=mix(vec3(0.02,0.18,0.4),vec3(0.05,0.55,0.75),p.y*2.0);
        float h=0.42+w; vec3 c=p.y>h?sky:sea;
        float sun=smoothstep(0.12,0.1,distance(p,vec2(0.62,0.55+0.03*sin(t*0.2))));
        c=mix(c,vec3(1.0,0.9,0.6),sun);
        float scan=0.94+0.06*sin(p.y*600.0);
        gl_FragColor=vec4(c*scan*gain,1.0); }`,
    toneMapped: false,
  });
  night.push({ mat: screenMat, uniform: 'gain', day: 1.1, night: 1.6 });
  add(baked(new RoundedBoxGeometry(14.4, 8.4, 0.6, 2, 0.2), [45.2, Y_TOP + 6.2, 0]), darkSteel);
  add(baked(new THREE.PlaneGeometry(13.6, 7.6), [44.88, Y_TOP + 6.2, 0], [0, -Math.PI / 2, 0]), screenMat, { cast: false, receive: false });
  updaters.push((t) => { screenMat.uniforms.t.value = t; });

  // ----- sports deck on the aft house
  {
    const court = document.createElement('canvas'); court.width = 512; court.height = 256;
    const g = court.getContext('2d');
    g.fillStyle = '#1f5fae'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#2f8a5a'; g.fillRect(24, 24, 464, 208);
    g.strokeStyle = '#f2f2f2'; g.lineWidth = 4; g.strokeRect(40, 40, 432, 176); g.beginPath(); g.moveTo(256, 40); g.lineTo(256, 216); g.stroke();
    g.beginPath(); g.arc(256, 128, 34, 0, Math.PI * 2); g.stroke();
    const ct = new THREE.CanvasTexture(court); ct.colorSpace = THREE.SRGBColorSpace; ct.anisotropy = 8;
    add(baked(new THREE.PlaneGeometry(26, 14), [-50, Y_TOP + 4.03, 0], [-Math.PI / 2, 0, 0]), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.7 }), { cast: false });
    // fence posts + net
    const posts = [];
    for (let x = -63; x <= -37; x += 2.6) for (const z of [7.3, -7.3]) posts.push(trs([x, Y_TOP + 4 + 2, z]));
    group.add(instanced(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), steel, posts));
    const netMat = new THREE.MeshStandardMaterial({ color: 0x223040, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    for (const z of [7.3, -7.3]) add(baked(new THREE.PlaneGeometry(26, 4), [-50, Y_TOP + 6, z]), netMat, { cast: false });
    // mini golf greens with putting cups
    const green = new THREE.MeshStandardMaterial({ color: 0x3f8f45, roughness: 0.95 });
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(4, -3, 10, 2, 14, -1); s.bezierCurveTo(17, -3, 18, 3, 14, 5); s.bezierCurveTo(9, 8, 3, 3, -1, 5); s.bezierCurveTo(-4, 6, -4, 1, 0, 0);
    const gg = new THREE.ExtrudeGeometry(s, { depth: 0.15, bevelEnabled: false, curveSegments: 20 });
    gg.rotateX(-Math.PI / 2);
    for (const [x, z, r] of [[-33, 5.5, 0], [-27, -4, Math.PI], [-80, 8, 0.4]]) add(baked(gg, [x, Y_TOP + 4.02, z], [0, r, 0], [0.42, 1, 0.42]), green, { cast: false });
  }

  // ----- BOLT coaster
  const coasterPts = [
    [-66, 60.5, 10], [-80, 62.5, 16.8], [-98, 68.5, 18.2], [-114, 65, 17.2], [-122.5, 61, 10.5], [-123.5, 60, 0],
    [-119, 58.8, -11.5], [-104, 59.2, -17.8], [-86, 63.5, -17.6], [-72, 66.5, -12.5], [-63, 64.5, -4], [-60.5, 62, 4],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(coasterPts, true, 'centripetal');
  const NF = 800;
  const frames = [];
  {
    const up0 = new THREE.Vector3(0, 1, 0);
    const len = curve.getLength();
    for (let i = 0; i < NF; i++) {
      const u = i / NF;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const t2 = curve.getTangentAt((u + 0.01) % 1);
      const turn = (t.x * t2.z - t.z * t2.x); // horizontal curvature sign
      const bank = clamp(turn * 14, -0.55, 0.55);
      const side = new THREE.Vector3().crossVectors(t, up0).normalize();
      let up = new THREE.Vector3().crossVectors(side, t).normalize();
      side.applyAxisAngle(t, bank); up.applyAxisAngle(t, bank);
      frames.push({ p, t, side, up });
    }
    frames.len = len;
  }
  const frameAt = (u) => {
    const f = ((u % 1) + 1) % 1 * NF;
    const i = Math.floor(f), k = f - i;
    const a = frames[i], b = frames[(i + 1) % NF];
    return {
      p: a.p.clone().lerp(b.p, k), t: a.t.clone().lerp(b.t, k).normalize(),
      side: a.side.clone().lerp(b.side, k).normalize(), up: a.up.clone().lerp(b.up, k).normalize(),
    };
  };
  {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2462d6, roughness: 0.28, metalness: 0.45 });
    const spineMat = new THREE.MeshStandardMaterial({ color: 0x173a8c, roughness: 0.35, metalness: 0.4 });
    const railCurve = (off, lift) => new THREE.CatmullRomCurve3(frames.filter((_, i) => i % 2 === 0).map((f) => f.p.clone().addScaledVector(f.side, off).addScaledVector(f.up, lift)), true);
    for (const off of [0.55, -0.55]) add(new THREE.TubeGeometry(railCurve(off, 0), 700, 0.11, 8, true), railMat, { receive: false });
    add(new THREE.TubeGeometry(railCurve(0, -0.55), 700, 0.26, 10, true), spineMat, { receive: false });
    // cross ties
    const tie = mergeLoose([
      baked(new THREE.BoxGeometry(0.14, 0.12, 1.2), [0, 0, 0]),
      baked(new THREE.BoxGeometry(0.12, 0.5, 0.12), [0, -0.3, 0.38], [0.6, 0, 0]),
      baked(new THREE.BoxGeometry(0.12, 0.5, 0.12), [0, -0.3, -0.38], [-0.6, 0, 0]),
    ]);
    const ties = [];
    const m = new THREE.Matrix4();
    const nTies = Math.floor(frames.len / 1.2);
    for (let i = 0; i < nTies; i++) {
      const f = frameAt(i / nTies);
      m.makeBasis(f.t, f.up, f.side.clone().negate()).setPosition(f.p);
      ties.push(m.clone());
    }
    group.add(instanced(tie, steel, ties, { receive: false }));
    // supports down to the deck below
    const sup = [];
    const deckY = (x, z) => (x > -124 && x < -24 && Math.abs(z) < 16 ? Y_TOP + 4 : Y_TOP);
    const nSup = Math.floor(frames.len / 6.5);
    for (let i = 0; i < nSup; i++) {
      const f = frameAt(i / nSup + 0.003);
      const top = f.p.y - 0.75, bot = deckY(f.p.x, f.p.z);
      const h = top - bot;
      sup.push(trs([f.p.x, bot + h / 2, f.p.z], [0, 0, 0], [1, h, 1]));
    }
    const col = new THREE.CylinderGeometry(0.28, 0.34, 1, 10);
    group.add(instanced(col, new THREE.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 0.4, metalness: 0.3 }), sup));
    const foot = new THREE.CylinderGeometry(0.6, 0.7, 0.3, 12).translate(0, 0.15, 0);
    group.add(instanced(foot, darkSteel, sup.map((mm) => { const p = new THREE.Vector3().setFromMatrixPosition(mm); const h = new THREE.Vector3().setFromMatrixScale(mm).y; return trs([p.x, p.y - h / 2, p.z]); })));
  }
  // ride vehicles: two motorbike-style sleds
  const cars = [];
  {
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, roughness: 0.2, metalness: 0.3, clearcoat: 1 });
    const accent = new THREE.MeshPhysicalMaterial({ color: 0x1c3f94, roughness: 0.25, metalness: 0.3, clearcoat: 1 });
    for (let i = 0; i < 2; i++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.55, 0.9, 3, 0.25), bodyMat);
      body.position.y = 0.55;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12).scale(1.4, 0.8, 1), accent);
      nose.position.set(1.3, 0.62, 0);
      const seat = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.3, 0.7, 2, 0.12), accent);
      seat.position.set(-0.2, 0.95, 0);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), warmLed);
      lamp.position.set(1.85, 0.62, 0);
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 6, 16, Math.PI), steel);
      bar.position.set(0.55, 1.05, 0); bar.rotation.y = Math.PI / 2;
      car.add(body, nose, seat, lamp, bar);
      car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      group.add(car);
      cars.push(car);
    }
  }
  let carU = 0;
  const _m4 = new THREE.Matrix4();
  updaters.push((t, dt) => {
    const f = frameAt(carU);
    const speed = 11 + Math.max(0, 68.5 - f.p.y) * 3.2; // faster after drops
    carU = (carU + (speed * dt) / frames.len) % 1;
    cars.forEach((car, i) => {
      const g = frameAt(carU - i * (3.2 / frames.len));
      _m4.makeBasis(g.t, g.up, g.side.clone().negate());
      car.quaternion.setFromRotationMatrix(_m4);
      car.position.copy(g.p).addScaledVector(g.up, 0.05);
    });
  });

  // ----- water slides tower + tubes
  {
    const TXp = -140, TZ = -9.5, base = Y_TOP;
    const posts = [];
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) posts.push(trs([TXp + dx, base + 7.5, TZ + dz], 0, [1, 15, 1]));
    group.add(instanced(new THREE.CylinderGeometry(0.22, 0.22, 1, 8), white, posts));
    for (const y of [5, 10, 15]) add(baked(new RoundedBoxGeometry(5.2, 0.35, 5.2, 2, 0.1), [TXp, base + y, TZ]), white);
    add(baked(new THREE.CylinderGeometry(3.2, 3.2, 0.2, 24, 1, true), [TXp, base + 16.1, TZ]), glass, { cast: false });
    const slideMatA = new THREE.MeshPhysicalMaterial({ color: 0xffc21a, roughness: 0.18, clearcoat: 1, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
    const slideMatB = new THREE.MeshPhysicalMaterial({ color: 0x19b6c9, roughness: 0.18, clearcoat: 1, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const helix = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, a = t * Math.PI * 4.2 + 1.2;
      helix.push(new THREE.Vector3(TXp + Math.cos(a) * 6.5, base + 15 - t * 13.5, TZ + 0.5 + Math.sin(a) * 6.5 + t * 6));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 300, 0.75, 14), slideMatA);
    const snake = [
      [TXp + 2, base + 15, TZ + 2], [TXp + 6, base + 14.2, TZ + 8], [TXp - 2, base + 12.5, TZ + 15], [TXp - 12, base + 11, TZ + 20.5],
      [TXp - 14, base + 9, TZ + 12], [TXp - 9, base + 7, TZ + 4], [TXp - 12, base + 4.5, TZ - 1], [TXp - 6, base + 2, TZ + 6], [TXp + 1, base + 1, TZ + 11.5],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(snake), 300, 0.7, 14), slideMatB);
    // slide supports
    const sp = [];
    for (const c of [helix, snake]) for (let i = 4; i < c.length - 2; i += (c === helix ? 6 : 1)) {
      const p = c[i]; const h = p.y - 0.7 - base;
      if (h > 1) sp.push(trs([p.x, base + h / 2, p.z], 0, [1, h, 1]));
    }
    group.add(instanced(new THREE.CylinderGeometry(0.12, 0.12, 1, 6), white, sp));
  }

  // ----- deck furniture detail: planters, deck lights, lifebuoy boxes
  {
    const planter = mergeLoose([
      baked(new RoundedBoxGeometry(1.2, 0.8, 1.2, 2, 0.1), [0, 0.4, 0]),
    ]);
    const leaves = new THREE.IcosahedronGeometry(0.85, 1);
    const pl = [], lv = [];
    for (let x = -20; x <= 36; x += 7) for (const z of [16.2, -16.2]) { pl.push(trs([x, Y_TOP, z])); lv.push(trs([x, Y_TOP + 1.4, z], [R(), R(), R()], [1, 1.2, 1])); }
    group.add(instanced(planter, new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6 }), pl));
    group.add(instanced(leaves, new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.85, flatShading: true }), lv));
    // lamp posts around the lido (glow at night)
    const lamp = [];
    for (let x = -22; x <= 40; x += 6) for (const z of [17.5, -17.5]) lamp.push(trs([x, Y_TOP, z]));
    group.add(instanced(new THREE.CylinderGeometry(0.05, 0.07, 3, 6).translate(0, 1.5, 0), darkSteel, lamp));
    group.add(instanced(new THREE.SphereGeometry(0.2, 12, 8).translate(0, 3.1, 0), warmLed, lamp, { cast: false }));
  }

  // ----- hull-side deck-line LEDs & navigation lights
  {
    const nav = new THREE.MeshBasicMaterial({ color: 0x00ff66, toneMapped: false });
    const port = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false });
    const xf = frontX(8) - 20, hw = halfW(xf, Y_PROM);
    add(baked(new THREE.SphereGeometry(0.3, 12, 8), [xf, Y_BAL + 8 * DECK + 3.1, 24.15]), nav, { cast: false });
    add(baked(new THREE.SphereGeometry(0.3, 12, 8), [xf, Y_BAL + 8 * DECK + 3.1, -24.15]), port, { cast: false });
    night.push({ mat: nav, color: true, day: new THREE.Color(0x0a6030), night: new THREE.Color(0x30ff80).multiplyScalar(3) });
    night.push({ mat: port, color: true, day: new THREE.Color(0x601015), night: new THREE.Color(0xff3040).multiplyScalar(3) });
    void hw;
  }

  updaters.push((t) => {
    radars[0].rotation.y = t * 2.1;
    radars[1].rotation.y = -t * 1.6 + 1;
    radars[2].rotation.y = t * 2.6;
    waterMat.normalMap.offset.set(t * 0.02, t * 0.013);
  });

  group.traverse((o) => { if (o.isMesh && o.material === glass) { o.renderOrder = 2; } });

  return {
    group, night,
    update: (t, dt) => updaters.forEach((f) => f(t, dt)),
    coaster: { frameAt, length: frames.len, getU: () => carU },
    anchors: {
      lido: new THREE.Vector3(0, Y_TOP + 2, 0),
      coaster: new THREE.Vector3(-94, 64, 0),
      bow: new THREE.Vector3(150, 16, 0),
      stern: new THREE.Vector3(-150, 30, 0),
    },
  };
}

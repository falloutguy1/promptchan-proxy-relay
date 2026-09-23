import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeHullMaterial } from './hullMaterial.js';

// ---------------------------------------------------------------------------
// Procedural Mi-8 style transport helicopter, crashed and broken apart.
// All geometry is authored in the helicopter frame: +X nose, +Y up, +Z starboard.
// ---------------------------------------------------------------------------

const rng = (() => { let s = 1337; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// --- station interpolation (cubic hermite on each parameter) ---------------
function sampleStations(st, x) {
  // st sorted by descending x: [x, w, yb, ym, yt, nt, nb]
  const n = st.length;
  if (x >= st[0][0]) return st[0].slice(1);
  if (x <= st[n - 1][0]) return st[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && x < st[i + 1][0]) i++;
  const a = st[i], b = st[i + 1];
  const t = (a[0] - x) / (a[0] - b[0]);
  const h = a[0] - b[0];
  const out = [];
  for (let k = 1; k < 7; k++) {
    const p0 = a[k], p1 = b[k];
    const prev = st[Math.max(i - 1, 0)], next = st[Math.min(i + 2, n - 1)];
    const m0 = i > 0 ? (b[k] - prev[k]) / (prev[0] - b[0]) * h : (p1 - p0);
    const m1 = i + 2 < n ? (next[k] - a[k]) / (a[0] - next[0]) * h : (p1 - p0);
    const t2 = t * t, t3 = t2 * t;
    out.push((2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1);
  }
  return out;
}

function ringPoint(prm, th, k = 1) {
  const [w, yb, ym, yt, nt, nb] = prm;
  const c = Math.cos(th), s = Math.sin(th);
  const n = s >= 0 ? nt : nb;
  const e = 2 / n;
  const z = w * Math.sign(c) * Math.pow(Math.abs(c), e);
  const dy = Math.pow(Math.abs(s), e);
  const y = s >= 0 ? (yt - ym) * dy : -(ym - yb) * dy;
  return [z * k, ym + y * k];
}

// Loft a closed (or partial) shell through the station list.
function loft(st, { x0, x1, segU = 120, segV = 96, a0 = 0, a1 = Math.PI * 2, k = 1, capStart = false }) {
  const pos = [], idx = [];
  for (let i = 0; i <= segU; i++) {
    const x = x0 + (x1 - x0) * (i / segU);
    const prm = sampleStations(st, x);
    for (let j = 0; j <= segV; j++) {
      const th = a0 + (a1 - a0) * (j / segV);
      const [z, y] = ringPoint(prm, th, k);
      pos.push(x, y, z);
    }
  }
  const row = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    // winding so normals face outward (x decreases along u)
    if (x1 < x0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  if (capStart) {
    const prm = sampleStations(st, x0);
    const ci = pos.length / 3;
    pos.push(x0, prm[2], 0);
    for (let j = 0; j < segV; j++) { if (x1 < x0) idx.push(ci, j + 1, j); else idx.push(ci, j, j + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld the seam normals of full rings
  if (Math.abs(a1 - a0 - Math.PI * 2) < 1e-6) {
    const nrm = g.attributes.normal;
    for (let i = 0; i <= segU; i++) {
      const a = i * row, b = i * row + segV;
      const nx = nrm.getX(a) + nrm.getX(b), ny = nrm.getY(a) + nrm.getY(b), nz = nrm.getZ(a) + nrm.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(a, nx / l, ny / l, nz / l); nrm.setXYZ(b, nx / l, ny / l, nz / l);
    }
  }
  return g;
}

// Find the ring angle whose height equals y on the given side (side: +1 starboard, -1 port).
function angleForY(st, x, y, side, upper) {
  const prm = sampleStations(st, x);
  let best = 0, bd = 1e9;
  for (let i = 0; i <= 2000; i++) {
    const th = side > 0 ? (upper ? i / 2000 * Math.PI / 2 : -i / 2000 * Math.PI / 2) : (upper ? Math.PI - i / 2000 * Math.PI / 2 : Math.PI + i / 2000 * Math.PI / 2);
    const [, yy] = ringPoint(prm, th);
    const d = Math.abs(yy - y);
    if (d < bd) { bd = d; best = th; }
  }
  return best;
}

// --- small geometry helpers --------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], order = 'XYZ' } = {}) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2], order));
  _m.compose(_v.set(...p), _q, new THREE.Vector3(...s));
  g.applyMatrix4(_m);
  return g;
}
function between(a, b, r, seg = 12, r2 = r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r2, r, len, seg, 1);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1)));
  return g;
}
function clean(g) {
  let out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}
function flipWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {
    for (const a of [p, n]) { if (!a) continue; const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1); a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, x, y, z); }
  }
  return g;
}
function merge(list) { return mergeGeometries(list.map(clean), false); }

// Airfoil-section blade swept along a bent path. Span along +X from r0.
function bladeGeo({ r0 = 0.9, len = 6, chord = 0.52, thick = 0.075, droop = 0.02, kinkAt = -1, kink = 0, twist = 0.08, segs = 48, jag = 0 }) {
  const prof = [];
  const N = 14;
  for (let i = 0; i <= N; i++) { const t = 1 - Math.cos(i / N * Math.PI / 2 * 2) ; prof.push(t / 2); }
  const loop = [];
  const yt = (t) => 5 * thick * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1015 * t ** 4);
  for (let i = 0; i < prof.length; i++) loop.push([prof[i], yt(prof[i])]);
  for (let i = prof.length - 2; i > 0; i--) loop.push([prof[i], -yt(prof[i])]);
  const M = loop.length;
  const pos = [], idx = [];
  let x = r0, y = 0, a = 0;
  const pts = [];
  const ds = len / segs;
  for (let i = 0; i <= segs; i++) {
    const s = i * ds;
    pts.push([x, y, a, s]);
    let ang = -droop * s;
    if (kinkAt > 0) ang += kink * THREE.MathUtils.smoothstep(s, kinkAt - 0.25, kinkAt + 0.25);
    a = ang;
    x += Math.cos(a) * ds; y += Math.sin(a) * ds;
  }
  for (let i = 0; i <= segs; i++) {
    const [px, py, pa, s] = pts[i];
    const tw = twist * (1 - s / len);
    const tip = i === segs;
    for (let j = 0; j < M; j++) {
      let [c, t] = loop[j];
      let cz = (c - 0.28) * chord;
      let ty = t * chord / thick * thick;
      // twist around span axis
      const cy = Math.cos(tw), sy = Math.sin(tw);
      let zz = cz * cy - ty * sy, yy = cz * sy + ty * cy;
      let ox = 0;
      if (tip && jag) ox = (rng() - 0.5) * jag;
      // rotate section by path angle (around Z)
      pos.push(px - Math.sin(pa) * yy + ox, py + Math.cos(pa) * yy, zz);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < M; j++) {
    const a0 = i * M + j, b0 = i * M + (j + 1) % M, c0 = a0 + M, d0 = b0 + M;
    idx.push(a0, b0, c0, b0, d0, c0);
  }
  // caps
  const addCap = (ring, flip) => {
    const ci = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < M; j++) { cx += pos[(ring * M + j) * 3]; cy += pos[(ring * M + j) * 3 + 1]; cz += pos[(ring * M + j) * 3 + 2]; }
    pos.push(cx / M, cy / M, cz / M);
    for (let j = 0; j < M; j++) { const a0 = ring * M + j, b0 = ring * M + (j + 1) % M; flip ? idx.push(ci, b0, a0) : idx.push(ci, a0, b0); }
  };
  addCap(0, true); addCap(segs, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tireGeo(R, width) {
  // lathe a tire section with tread blocks, axis along Y
  const pts = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N * Math.PI;
    const r = R - width * 0.42 + Math.sin(t) * width * 0.42;
    pts.push(new THREE.Vector2(r * 0.9 + 0.1 * R * Math.sin(t) * 0.0 + (R * 0.1) * Math.pow(Math.sin(t), 0.35), -Math.cos(t) * width * 0.5));
  }
  const g = new THREE.LatheGeometry(pts, 48);
  // tread: push outer vertices in and out by angle
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r > R * 0.93 && Math.abs(y) < width * 0.4) {
      const ang = Math.atan2(z, x);
      const tread = (Math.sin(ang * 24 + Math.sign(y) * 0.8) > 0.2 ? 1 : 0) * 0.018;
      const k = (r + tread) / r;
      p.setX(i, x * k); p.setZ(i, z * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
export function buildHelicopter() {
  const mats = {
    fuselage: makeHullMaterial('camo', { fuselage: true }),
    tailBoom: makeHullMaterial('camo', { tail: true }),
    camo: makeHullMaterial('camo'),
    door: makeHullMaterial('camo', { door: true }),
    dark: makeHullMaterial('dark'),
    strut: makeHullMaterial('strut', { single: true }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.72, metalness: 0.0 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1b1f19, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }),
    wire: new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.6 }),
    wireRed: new THREE.MeshStandardMaterial({ color: 0x3a0b08, roughness: 0.55 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x220404, roughness: 0.05, metalness: 0, clearcoat: 1 }),
  };

  const heli = new THREE.Group();
  const body = new THREE.Group(); // parts that stay with the main fuselage
  heli.add(body);

  // ---------------- fuselage ----------------
  const FUS = [
    [7.08, 0.03, 1.28, 1.36, 1.44, 2, 2],
    [6.98, 0.44, 0.96, 1.44, 1.92, 2.2, 2.2],
    [6.72, 0.8, 0.72, 1.55, 2.32, 2.3, 2.4],
    [6.2, 1.06, 0.57, 1.66, 2.66, 2.5, 2.9],
    [5.5, 1.2, 0.51, 1.72, 2.92, 2.9, 3.3],
    [4.6, 1.26, 0.49, 1.75, 3.02, 3.3, 3.7],
    [3.0, 1.28, 0.48, 1.75, 3.05, 3.6, 3.9],
    [-3.0, 1.28, 0.48, 1.75, 3.05, 3.6, 3.9],
    [-4.0, 1.24, 0.64, 1.8, 3.05, 3.4, 3.2],
    [-4.9, 1.04, 1.12, 2.0, 3.02, 3.0, 2.8],
    [-5.7, 0.7, 1.76, 2.35, 2.98, 2.6, 2.4],
    [-6.4, 0.5, 2.16, 2.55, 2.93, 2.2, 2.2],
    [-7.2, 0.46, 2.3, 2.62, 2.92, 2.1, 2.1],
    [-9.0, 0.4, 2.47, 2.74, 3.0, 2.05, 2.05],
    [-11.0, 0.33, 2.64, 2.88, 3.1, 2.05, 2.05],
    [-12.6, 0.26, 2.82, 3.02, 3.2, 2.05, 2.05],
    [-13.3, 0.18, 2.96, 3.1, 3.24, 2.0, 2.0],
  ];
  const fusGeo = loft(FUS, { x0: 7.08, x1: -6.75, segU: 260, segV: 150 });
  const fus = new THREE.Mesh(fusGeo, mats.fuselage);
  body.add(fus);

  // engine / gearbox housing on the roof
  const ENG = [
    [4.2, 0.9, 2.92, 3.28, 3.72, 3.0, 4],
    [3.9, 1.0, 2.92, 3.3, 3.86, 3.2, 4],
    [1.4, 1.03, 2.92, 3.3, 3.98, 3.5, 4],
    [-0.8, 1.03, 2.92, 3.3, 3.98, 3.5, 4],
    [-2.1, 0.96, 2.92, 3.3, 3.93, 3.2, 4],
    [-3.1, 0.8, 2.92, 3.25, 3.76, 2.8, 4],
    [-4.1, 0.54, 2.88, 3.12, 3.45, 2.5, 3],
    [-5.3, 0.3, 2.82, 2.96, 3.12, 2.2, 3],
    [-5.8, 0.06, 2.86, 2.92, 2.98, 2, 2],
  ];
  const engGeo = loft(ENG, { x0: 4.2, x1: -5.8, segU: 140, segV: 96, capStart: true });
  // blend bottom of housing into roof: keep as is (buried in fuselage)
  const camoParts = [engGeo];
  const darkParts = [];
  const strutParts = [];
  const rubberParts = [];
  const interiorParts = [];

  // engine intakes (two) with inlet cones
  for (const s of [-1, 1]) {
    const lip = new THREE.TorusGeometry(0.34, 0.07, 16, 48);
    xf(lip, { p: [4.26, 3.34, s * 0.47], r: [0, Math.PI / 2, 0] });
    darkParts.push(lip);
    const cone = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0.38), new THREE.Vector2(0.08, 0.3), new THREE.Vector2(0.17, 0.1), new THREE.Vector2(0.3, -0.12), new THREE.Vector2(0.34, -0.2)], 32);
    xf(cone, { p: [4.1, 3.34, s * 0.47], r: [0, 0, -Math.PI / 2] });
    darkParts.push(cone);
    const duct = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 32, 1, true);
    xf(duct, { p: [4.12, 3.34, s * 0.47], r: [0, 0, Math.PI / 2] });
    darkParts.push(duct);
    // exhaust pipes
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.2, 3.36, s * 0.86), new THREE.Vector3(-0.75, 3.33, s * 1.12), new THREE.Vector3(-1.5, 3.2, s * 1.38), new THREE.Vector3(-1.95, 3.1, s * 1.46),
    ]);
    darkParts.push(new THREE.TubeGeometry(curve, 36, 0.21, 24, false));
    const flare = new THREE.TorusGeometry(0.215, 0.025, 10, 32);
    const tEnd = curve.getTangent(1);
    const fq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tEnd);
    flare.applyMatrix4(new THREE.Matrix4().compose(curve.getPoint(1), fq, new THREE.Vector3(1, 1, 1)));
    darkParts.push(flare);
    // exhaust heat shield plates
    const shield = new THREE.BoxGeometry(1.3, 0.04, 0.5);
    xf(shield, { p: [-1.0, 3.02, s * 1.18], r: [s * 0.35, 0, 0] });
    camoParts.push(shield);
  }
  // oil cooler fan intake on top rear of the housing
  {
    const ring = new THREE.TorusGeometry(0.46, 0.06, 14, 48);
    xf(ring, { p: [-2.35, 3.9, 0], r: [0, Math.PI / 2, 0.35], order: 'YXZ' });
    darkParts.push(ring);
    const grille = new THREE.CircleGeometry(0.44, 32);
    xf(grille, { p: [-2.36, 3.9, 0], r: [0, Math.PI / 2, 0.35], order: 'YXZ' });
    darkParts.push(grille);
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.BoxGeometry(0.02, 0.86 * Math.sqrt(1 - (i / 3.8) ** 2), 0.025);
      xf(bar, { p: [-2.32, 3.9 + i * 0.12 * Math.cos(0.35), 0], r: [0, 0, 0.35] });
      darkParts.push(xf(bar.clone(), { r: [0, 0, 0] }));
    }
  }
  // cowling hinges & latches along the housing
  for (let i = 0; i < 9; i++) {
    for (const s of [-1, 1]) {
      const latch = new THREE.BoxGeometry(0.12, 0.035, 0.02);
      xf(latch, { p: [3.2 - i * 0.6, 3.42, s * 1.03] });
      darkParts.push(latch);
    }
  }
  // beacon on the tail fairing
  const beacon = new THREE.SphereGeometry(0.08, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  xf(beacon, { p: [-4.4, 3.4, 0] });

  // ---------------- main rotor ----------------
  const hubC = [0.25, 4.32, 0];
  darkParts.push(xf(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 24), { p: [hubC[0], 4.08, 0] }));
  darkParts.push(xf(new THREE.CylinderGeometry(0.42, 0.45, 0.08, 32), { p: [hubC[0], 4.05, 0] })); // swashplate
  darkParts.push(xf(new THREE.CylinderGeometry(0.55, 0.62, 0.22, 36), { p: [hubC[0], 3.95, 0] })); // gearbox cap
  const hubProfile = [[0, 0.18], [0.2, 0.18], [0.34, 0.12], [0.4, 0.0], [0.36, -0.1], [0.22, -0.14], [0, -0.14]].map(([a, b]) => new THREE.Vector2(a, b));
  darkParts.push(xf(new THREE.LatheGeometry(hubProfile, 40), { p: hubC }));
  darkParts.push(xf(new THREE.SphereGeometry(0.16, 20, 12), { p: [hubC[0], hubC[1] + 0.18, 0], s: [1, 0.6, 1] }));

  const blades = [
    { az: 0.35, len: 7.6, droop: -0.055, kinkAt: 1.6, kink: 0.12, jag: 0.25 },
    { az: 1.6, len: 2.8, droop: 0.05, jag: 0.35 },
    { az: 2.75, len: 5.6, droop: 0.075, kinkAt: 2.2, kink: -0.28, jag: 0.3 },
    { az: 3.95, len: 2.2, droop: 0.02, jag: 0.4 },
    { az: 5.1, len: 4.3, droop: 0.04, kinkAt: 1.9, kink: -0.4, jag: 0.3 },
  ];
  for (const b of blades) {
    const g = bladeGeo({ len: b.len, droop: b.droop, kinkAt: b.kinkAt ?? -1, kink: b.kink ?? 0, jag: b.jag });
    const R = new THREE.Matrix4().makeRotationY(b.az);
    g.applyMatrix4(R).translate(hubC[0], hubC[1], hubC[2]);
    darkParts.push(g);
    // hinge arm + damper per blade
    const arm = new THREE.BoxGeometry(0.62, 0.13, 0.16);
    arm.translate(0.58, 0, 0).applyMatrix4(R).translate(...hubC);
    darkParts.push(arm);
    const hinge = new THREE.CylinderGeometry(0.075, 0.075, 0.26, 16);
    hinge.translate(0.82, 0, 0).applyMatrix4(R).translate(...hubC);
    darkParts.push(hinge);
    const damper = new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10);
    damper.rotateZ(Math.PI / 2).translate(0.55, 0.1, 0.13).applyMatrix4(R).translate(...hubC);
    darkParts.push(damper);
    const link = new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8);
    link.translate(0.4, -0.1, -0.12).applyMatrix4(R).translate(...hubC);
    strutParts.push(link);
  }

  // ---------------- external fuel tanks ----------------
  for (const s of [-1, 1]) {
    const L = s < 0 ? 3.9 : 3.4, R = 0.44;
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28; const xx = -L / 2 + t * L;
      const e = Math.min(1, (L / 2 - Math.abs(xx)) / 0.55);
      pts.push(new THREE.Vector2(R * Math.sqrt(Math.max(0, 1 - (1 - e) ** 2)) + 0.0001, xx));
    }
    const tank = new THREE.LatheGeometry(pts, 48);
    xf(tank, { p: [0.35 - (s < 0 ? 0.25 : 0), 1.18, s * 1.74], r: [0, 0, -Math.PI / 2] });
    camoParts.push(tank);
    for (const dx of [-1.0, 0.1, 1.1]) {
      const strap = new THREE.TorusGeometry(R + 0.012, 0.018, 8, 48);
      xf(strap, { p: [0.35 + dx, 1.18, s * 1.74], r: [0, Math.PI / 2, 0] });
      strutParts.push(strap);
      strutParts.push(between([0.35 + dx, 1.5, s * 1.55], [0.35 + dx, 1.62, s * 1.2], 0.035));
      strutParts.push(between([0.35 + dx, 0.86, s * 1.55], [0.35 + dx, 0.72, s * 1.12], 0.03));
    }
    const cap = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16);
    xf(cap, { p: [0.9, 1.63, s * 1.74] });
    strutParts.push(cap);
  }

  // ---------------- landing gear ----------------
  for (const s of [-1, 1]) {
    const hub = [-1.35, 0.36, s * 1.98];
    const tire = tireGeo(0.46, 0.3);
    xf(tire, { p: hub, r: [Math.PI / 2, 0, 0] });
    rubberParts.push(tire);
    strutParts.push(xf(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 24), { p: hub, r: [Math.PI / 2, 0, 0] }));
    strutParts.push(xf(new THREE.CylinderGeometry(0.1, 0.13, 0.08, 24), { p: [hub[0], hub[1], hub[2] + s * 0.16], r: [Math.PI / 2, 0, 0] }));
    strutParts.push(between([hub[0], hub[1], hub[2] - s * 0.1], [-1.05, 1.7, s * 1.28], 0.075));
    strutParts.push(between([-1.23, 0.95, s * 1.7], [-1.1, 1.62, s * 1.36], 0.11));
    strutParts.push(between([hub[0], hub[1], hub[2] - s * 0.12], [-0.45, 0.56, s * 0.95], 0.05));
    strutParts.push(between([hub[0], hub[1], hub[2] - s * 0.12], [-2.2, 0.62, s * 0.95], 0.05));
  }
  for (const s of [-1, 1]) {
    const hub = [5.3, 0.27, s * 0.24];
    const tire = tireGeo(0.3, 0.2);
    xf(tire, { p: hub, r: [Math.PI / 2, 0, 0] });
    rubberParts.push(tire);
    strutParts.push(xf(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 20), { p: hub, r: [Math.PI / 2, 0, 0] }));
  }
  strutParts.push(between([5.3, 0.27, -0.3], [5.3, 0.27, 0.3], 0.04));
  strutParts.push(between([5.3, 0.27, 0], [5.05, 0.78, 0], 0.07));
  strutParts.push(between([5.3, 0.27, 0], [4.6, 0.6, 0], 0.04));

  // ---------------- nose details ----------------
  for (const s of [-1, 1]) {
    strutParts.push(between([6.3, 2.5, s * 0.66], [6.95, 2.62, s * 0.7], 0.012));
    strutParts.push(between([6.18, 2.48, s * 0.64], [6.36, 2.51, s * 0.66], 0.03, 10, 0.02));
    // wipers
    darkParts.push(xf(new THREE.BoxGeometry(0.02, 0.55, 0.025), { p: [6.52, 2.02, s * 0.36], r: [0, 0, -0.55] }));
    // landing lights under the nose
    darkParts.push(xf(new THREE.CylinderGeometry(0.11, 0.12, 0.08, 20), { p: [6.0, 0.56, s * 0.35] }));
    // steps
    strutParts.push(xf(new THREE.BoxGeometry(0.34, 0.03, 0.18), { p: [3.6, 0.52 + (s > 0 ? 0 : 0), -1.34] }));
  }
  strutParts.push(xf(new THREE.BoxGeometry(0.34, 0.03, 0.2), { p: [3.6, 0.95, -1.36] }));

  // sliding door (slid back along its rails) + rails
  {
    const thT = angleForY(FUS, 2.45, 2.42, -1, true), thB = angleForY(FUS, 2.45, 0.66, -1, false);
    const door = loft(FUS, { x0: 3.08, x1: 1.86, segU: 30, segV: 40, a0: thT, a1: thB, k: 1.022 });
    const m = new THREE.Mesh(door, mats.door);
    body.add(m);
    strutParts.push(between([1.7, 2.46, -1.305], [4.35, 2.46, -1.305], 0.02));
    strutParts.push(between([1.7, 0.66, -1.28], [4.35, 0.66, -1.28], 0.02));
  }

  // antennas
  darkParts.push(xf(new THREE.BoxGeometry(0.4, 0.3, 0.03), { p: [-3.6, 3.62, 0], r: [0, 0, 0.35] }));
  strutParts.push(between([2.4, 0.49, 0.3], [2.1, 0.05, 0.4], 0.01));
  darkParts.push(beacon);

  // ---------------- interior ----------------
  interiorParts.push(xf(new THREE.BoxGeometry(8.9, 0.06, 2.3), { p: [0.1, 0.7, 0] }));
  for (const s of [-1, 1]) {
    interiorParts.push(xf(new THREE.BoxGeometry(6.2, 0.06, 0.42), { p: [-0.6, 1.12, s * 0.95] }));
    for (let i = 0; i < 9; i++) interiorParts.push(between([-3.5 + i * 0.75, 0.7, s * 0.85], [-3.5 + i * 0.75, 1.1, s * 0.85], 0.02));
    interiorParts.push(xf(new THREE.BoxGeometry(6.2, 0.55, 0.03), { p: [-0.6, 1.5, s * 1.14] }));
    // cockpit seats
    interiorParts.push(xf(new THREE.BoxGeometry(0.5, 0.12, 0.5), { p: [5.3, 1.25, s * 0.48] }));
    interiorParts.push(xf(new THREE.BoxGeometry(0.1, 0.75, 0.5), { p: [5.0, 1.65, s * 0.48], r: [0, 0, -0.15] }));
  }
  interiorParts.push(xf(new THREE.BoxGeometry(0.08, 1.9, 2.3), { p: [4.55, 1.7, 0] })); // bulkhead
  interiorParts.push(xf(new THREE.BoxGeometry(0.35, 0.45, 1.8), { p: [6.0, 1.62, 0], r: [0, 0, 0.35] })); // panel
  interiorParts.push(xf(new THREE.BoxGeometry(0.6, 0.5, 0.35), { p: [5.6, 1.1, 0] }));
  // cargo straps / debris inside
  interiorParts.push(xf(new THREE.BoxGeometry(0.8, 0.5, 0.6), { p: [2.6, 0.98, 0.2], r: [0, 0.4, 0] }));
  interiorParts.push(xf(new THREE.BoxGeometry(0.6, 0.4, 0.5), { p: [3.4, 0.93, -0.3], r: [0, -0.2, 0.1] }));

  // torn wiring at the break
  const wireParts = [], redParts = [];
  for (let i = 0; i < 12; i++) {
    const y0 = 2.35 + rng() * 0.5, z0 = (rng() - 0.5) * 0.7;
    const pts = [new THREE.Vector3(-5.9, y0, z0), new THREE.Vector3(-6.5 - rng() * 0.3, y0 - 0.1 - rng() * 0.3, z0 + (rng() - 0.5) * 0.4), new THREE.Vector3(-6.7 - rng() * 0.6, y0 - 0.4 - rng() * 1.2, z0 + (rng() - 0.5) * 0.9)];
    (i % 3 === 0 ? redParts : wireParts).push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012 + rng() * 0.01, 6));
  }
  // bent stringers sticking out of the break
  for (let i = 0; i < 10; i++) {
    const th = rng() * Math.PI * 2;
    const [z, y] = ringPoint(sampleStations(FUS, -6.2), th, 0.97);
    strutParts.push(between([-5.9, y, z], [-6.6 - rng() * 0.5, y + (rng() - 0.6) * 0.4, z * (1 + rng() * 0.3)], 0.018));
  }

  body.add(new THREE.Mesh(merge(camoParts), mats.camo));
  body.add(new THREE.Mesh(merge(darkParts), mats.dark));
  body.add(new THREE.Mesh(merge(strutParts), mats.strut));
  body.add(new THREE.Mesh(merge(rubberParts), mats.rubber));
  body.add(new THREE.Mesh(merge(interiorParts), mats.interior));
  body.add(new THREE.Mesh(merge(wireParts), mats.wire));
  body.add(new THREE.Mesh(merge(redParts), mats.wireRed));

  // ---------------- detached tail section ----------------
  const tail = new THREE.Group();
  const tailGeo = loft(FUS, { x0: -6.4, x1: -13.3, segU: 150, segV: 64 });
  tail.add(new THREE.Mesh(tailGeo, mats.tailBoom));
  const tCamo = [], tDark = [], tStrut = [];
  {
    // pylon / fin
    const sh = new THREE.Shape();
    sh.moveTo(-12.1, 2.95); sh.lineTo(-13.25, 3.0); sh.lineTo(-14.25, 5.15); sh.quadraticCurveTo(-14.35, 5.6, -13.95, 5.62);
    sh.lineTo(-13.55, 5.6); sh.lineTo(-12.75, 4.05); sh.quadraticCurveTo(-12.45, 3.3, -12.1, 3.2);
    const fin = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 12 });
    fin.translate(0, 0, -0.1);
    tCamo.push(fin);
    // horizontal stabilisers
    for (const s of [-1, 1]) {
      const st = new THREE.Shape();
      st.moveTo(0, 0); st.lineTo(0.75, 0.02); st.quadraticCurveTo(0.85, 0.0, 0.75, -0.02); st.lineTo(0, -0.05); st.quadraticCurveTo(-0.07, 0, 0, 0);
      const g = new THREE.ExtrudeGeometry(st, { depth: 1.35, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2 });
      g.scale(-1, 1, s);
      if (s > 0) flipWinding(g);
      g.translate(-11.35, 3.0, s * 0.18);
      tCamo.push(g);
    }
    // tail rotor gearbox + rotor
    const trC = [-13.95, 5.1, 0.34];
    tDark.push(xf(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 18), { p: [trC[0], trC[1], 0.18], r: [Math.PI / 2, 0, 0] }));
    tDark.push(xf(new THREE.SphereGeometry(0.13, 16, 10), { p: trC }));
    const trAngles = [0.4, 2.5, 4.6];
    trAngles.forEach((a, i) => {
      const g = bladeGeo({ r0: 0.15, len: i === 1 ? 0.9 : 1.75, chord: 0.3, thick: 0.04, droop: 0, twist: 0.1, segs: 16, jag: i === 1 ? 0.2 : 0 });
      g.rotateX(Math.PI / 2);
      g.rotateZ(a);
      g.translate(...trC);
      tDark.push(g);
    });
    // tail skid bumper
    tStrut.push(between([-12.6, 2.9, 0], [-12.9, 2.3, 0], 0.03));
    tStrut.push(between([-12.2, 2.9, 0], [-12.9, 2.3, 0], 0.03));
    // drive shaft stub & wires hanging out of the break
    tStrut.push(between([-6.9, 3.05, 0], [-6.3, 3.02, 0.05], 0.05));
    for (let i = 0; i < 6; i++) {
      const y0 = 2.5 + rng() * 0.5, z0 = (rng() - 0.5) * 0.5;
      tStrut.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-7.1, y0, z0), new THREE.Vector3(-6.6, y0 - 0.1, z0 + 0.1), new THREE.Vector3(-6.2 - rng() * 0.4, y0 - 0.5, z0 + (rng() - 0.5))]), 12, 0.012, 6));
    }
  }
  tail.add(new THREE.Mesh(merge(tCamo), mats.camo));
  tail.add(new THREE.Mesh(merge(tDark), mats.dark));
  tail.add(new THREE.Mesh(merge(tStrut), mats.strut));

  // place the tail: lying on its side in the grass, behind and to the right
  const tailPivot = new THREE.Group();
  tail.position.set(6.6, -2.7, 0);
  tailPivot.add(tail);
  tailPivot.rotation.set(0.62, 0.35, -0.03, 'YXZ');
  tailPivot.position.set(-9.2, 0, 0.6);
  heli.add(tailPivot);

  // ---------------- debris ----------------
  const debris = [];
  for (let i = 0; i < 14; i++) {
    const x = -6.6 + (rng() - 0.5) * 1.2;
    const th = rng() * Math.PI * 2;
    const g = loft(FUS, { x0: x + 0.3 + rng() * 0.5, x1: x - 0.2, segU: 6, segV: 6, a0: th, a1: th + 0.3 + rng() * 0.5 });
    g.translate(-x, -2.6, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) + (rng() - 0.5) * 0.05, p.getY(k) + (rng() - 0.5) * 0.05, p.getZ(k));
    g.computeVertexNormals();
    const a = rng() * Math.PI * 2, r = 1.5 + rng() * 6;
    xf(g, { p: [-7.2 + Math.cos(a) * r, 0.05, Math.sin(a) * r * 0.8], r: [rng() * 6, rng() * 6, rng() * 6] });
    debris.push(g);
  }
  const bladePiece = bladeGeo({ r0: 0, len: 3.2, droop: 0.02, jag: 0.4, segs: 20 });
  xf(bladePiece, { p: [2.5, 0.12, -6.5], r: [0.1, 0.6, 0.03] });
  const debrisDark = [bladePiece];
  const bladePiece2 = bladeGeo({ r0: 0, len: 1.6, droop: 0.1, jag: 0.4, segs: 12 });
  xf(bladePiece2, { p: [-3.5, 0.1, 4.2], r: [0.2, 2.2, 0.1] });
  debrisDark.push(bladePiece2);
  const debrisGroup = new THREE.Group();
  debrisGroup.add(new THREE.Mesh(merge(debris), mats.camo));
  debrisGroup.add(new THREE.Mesh(merge(debrisDark), mats.dark));
  heli.add(debrisGroup);

  // crash attitude
  body.rotation.set(-0.045, 0.0, -0.025);
  body.position.y = -0.1;

  heli.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  heli.updateMatrixWorld(true);

  // drop the tail piece onto the ground
  const box = new THREE.Box3().setFromObject(tailPivot);
  tailPivot.position.y -= box.min.y + 0.12;
  heli.updateMatrixWorld(true);

  const smokeLocal = new THREE.Vector3(-1.0, 3.9, 0.35);
  const smokeWorld = smokeLocal.clone().applyMatrix4(body.matrixWorld);
  return { heli, body, tailPivot, mats, smokeWorld };
}

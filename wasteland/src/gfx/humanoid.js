// Procedural rigged humanoids (survivors and the infected). A skinned mesh is
// lofted from anatomical landmarks (1.75 m reference body, scaled per person):
// elliptical torso rings, tapered limbs with joint-blended skin weights, head,
// hands, boots and gear (backpack, rifle, hood/cap/beanie, gas mask). Clothing is
// per-vertex colour + roughness over a tileable fabric normal map, so one draw
// call renders a whole character. Animation is procedural (see Animator).
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { enhance } from '../core/shaderlib.js';

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'foreArmL', 'handL',
  'shoulderR', 'upperArmR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];
const PARENT = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upperArmL: 'shoulderL', foreArmL: 'upperArmL', handL: 'foreArmL',
  shoulderR: 'chest', upperArmR: 'shoulderR', foreArmR: 'upperArmR', handR: 'foreArmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};
// rest-pose joint positions (world, metres) for the 1.75 m reference body
const JOINT = {
  hips: [0, 0.97, 0], spine: [0, 1.07, 0], chest: [0, 1.27, 0], neck: [0, 1.5, 0], head: [0, 1.58, 0],
  shoulderL: [0.06, 1.43, 0], upperArmL: [0.195, 1.44, 0], foreArmL: [0.205, 1.155, -0.01], handL: [0.21, 0.9, 0.0],
  shoulderR: [-0.06, 1.43, 0], upperArmR: [-0.195, 1.44, 0], foreArmR: [-0.205, 1.155, -0.01], handR: [-0.21, 0.9, 0.0],
  thighL: [0.095, 0.93, 0], shinL: [0.1, 0.51, 0.01], footL: [0.1, 0.085, 0], thighR: [-0.095, 0.93, 0], shinR: [-0.1, 0.51, 0.01], footR: [-0.1, 0.085, 0],
};

export const PALETTES = {
  survivor: {
    jackets: ['#4a5236', '#5c4a36', '#2f3a44', '#6b6b5e', '#7a3b2a', '#3c4a3a', '#8a7a55', '#23262a', '#c46a1c'],
    pants: ['#2c3440', '#3a3b32', '#4a4234', '#232628', '#556048', '#3d3a36'],
    boots: ['#2a2119', '#1c1a18', '#3a2e22', '#4a3d2c'],
    hats: ['#2f3326', '#4a4a44', '#6a2a20', '#2b2f36', '#56503c'],
    skin: ['#c99b7d', '#b8866a', '#8d5f45', '#e0b89b', '#a87254', '#6b4431'],
    hair: ['#2a1f18', '#4a3322', '#6b5237', '#1a1614', '#8c7c68'],
  },
  infected: {
    jackets: ['#3a3a33', '#4a3f35', '#2d3237', '#50493d', '#3f2b25', '#595a52'],
    pants: ['#26292b', '#35332d', '#3b342b', '#2e2a26'],
    boots: ['#1e1b18', '#2b241e'],
    hats: ['#2a2a26'],
    skin: ['#8f9a86', '#9aa18e', '#7f8a78', '#a3a894', '#86806e'],
    hair: ['#2b2723', '#3b342d', '#1d1b19'],
  },
};

const hex = (h) => new THREE.Color(h);

class Mesher {
  constructor(scale) { this.s = scale; this.pos = []; this.nor = []; this.uv = []; this.col = []; this.rough = []; this.si = []; this.sw = []; this.idx = []; }
  vert(p, n, u, v, c, r, bones) {
    this.pos.push(p.x * this.s, p.y * this.s, p.z * this.s); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b); this.rough.push(r);
    const b = bones.slice(0, 4); while (b.length < 4) b.push([0, 0]);
    const tot = b.reduce((a, x) => a + x[1], 0) || 1;
    this.si.push(...b.map((x) => x[0])); this.sw.push(...b.map((x) => x[1] / tot));
    return this.pos.length / 3 - 1;
  }
}

// ring loft between elliptical sections; sections: [{ y, x(offset), z(offset), rx, rz, bones, col, rough }]
function loft(M, secs, seg = 12, cap0 = false, cap1 = false, uvScale = 2.2) {
  const rows = [];
  let vacc = 0;
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    if (i > 0) vacc += Math.abs(s.y - secs[i - 1].y);
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      let c = Math.cos(a), sn = Math.sin(a);
      let nc = c, ns = sn;
      if (s.sq) {
        // superellipse (rounded rectangle) section; normal from the implicit gradient
        const e = 2 / s.sq;
        c = Math.sign(c) * Math.abs(c) ** e; sn = Math.sign(sn) * Math.abs(sn) ** e;
        nc = Math.sign(c) * Math.abs(c) ** (s.sq - 1); ns = Math.sign(sn) * Math.abs(sn) ** (s.sq - 1);
      }
      const p = new THREE.Vector3((s.x || 0) + c * s.rx, s.y, (s.z || 0) + sn * s.rz);
      const n = new THREE.Vector3(nc / s.rx, 0, ns / s.rz).normalize();
      if (s.ny) { n.y = s.ny; n.normalize(); }
      row.push(M.vert(p, n, (j / seg) * uvScale, vacc * 2, s.col, s.rough, s.bones));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
    const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j], d = rows[i + 1][j + 1];
    // rings ordered bottom->top; outward winding
    M.idx.push(a, c, b, b, c, d);
  }
  const cap = (row, s, up) => {
    const cIdx = M.vert(new THREE.Vector3(s.x || 0, s.y, s.z || 0), new THREE.Vector3(0, up ? 1 : -1, 0), 0.5, 0.5, s.col, s.rough, s.bones);
    for (let j = 0; j < seg; j++) { if (up) M.idx.push(row[j], row[j + 1], cIdx); else M.idx.push(row[j + 1], row[j], cIdx); }
  };
  if (cap0) cap(rows[0], secs[0], false);
  if (cap1) cap(rows[rows.length - 1], secs[secs.length - 1], true);
}

// tapered limb segment along an arbitrary axis (a -> b), elliptical, joint blended
function limb(M, a, b, r0, r1, bA, bB, col, rough, { seg = 10, rings = 6, flat = 0.85, blendStart = 0.0, blendEnd = 0.22, parentBone = null } = {}) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length(); dir.normalize();
  const side = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, side).normalize();
  const w = new THREE.Vector3().crossVectors(dir, u).normalize();
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = THREE.MathUtils.lerp(r0, r1, t) * (1 + 0.12 * Math.sin(t * Math.PI)); // muscle belly
    const c = a.clone().addScaledVector(dir, len * t);
    // skin weights: near the top blend with parent, near the end blend with child
    let bones;
    if (t < blendEnd && parentBone !== null) { const k = t / blendEnd; bones = [[bA, 0.5 + 0.5 * k], [parentBone, 0.5 - 0.5 * k]]; }
    else if (t > 1 - blendEnd && bB !== null) { const k = (t - (1 - blendEnd)) / blendEnd; bones = [[bA, 1 - 0.5 * k], [bB, 0.5 * k]]; }
    else bones = [[bA, 1]];
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const off = u.clone().multiplyScalar(cs * r).addScaledVector(w, sn * r * flat);
      const n = u.clone().multiplyScalar(cs / 1).addScaledVector(w, sn / flat).normalize();
      row.push(M.vert(c.clone().add(off), n, (j / seg) * 1.4, t * len * 2, col, rough, bones));
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) {
    const p = rows[i][j], q = rows[i][j + 1], r = rows[i + 1][j], s = rows[i + 1][j + 1];
    M.idx.push(p, q, r, q, s, r);
  }
  // fix winding by testing one triangle against the radial direction
  return rows;
}

function ellipsoid(M, c, rx, ry, rz, bone, col, rough, { seg = 14, rings = 10, y0 = -1, y1 = 1, col2 = null, split = 99 } = {}) {
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const phi = Math.acos(THREE.MathUtils.lerp(y0, y1, t)); // from bottom (y0=-1) up
    const y = -Math.cos(phi), rr = Math.sin(phi);
    const row = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const p = new THREE.Vector3(c.x + Math.cos(a) * rr * rx, c.y + y * ry, c.z + Math.sin(a) * rr * rz);
      const n = new THREE.Vector3(Math.cos(a) * rr / rx, y / ry, Math.sin(a) * rr / rz).normalize();
      const cc = col2 && y * ry > split ? col2 : col;
      row.push(M.vert(p, n, j / seg, t, cc, rough, [[bone, 1]]));
    }
    rows.push(row);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = rows[i][j], b = rows[i][j + 1], cc = rows[i + 1][j], d = rows[i + 1][j + 1];
    M.idx.push(a, cc, b, b, cc, d);
  }
}

function boxPart(M, c, sx, sy, sz, bone, col, rough, rot = null) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const q = rot || new THREE.Quaternion();
  for (const f of faces) {
    const n = new THREE.Vector3(...f);
    const a = Math.abs(f[0]) ? 0 : Math.abs(f[1]) ? 1 : 2;
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const corner = (su, sv) => {
      const p = new THREE.Vector3(); p.setComponent(a, f[a] * [hx, hy, hz][a]); p.setComponent(u, su * [hx, hy, hz][u]); p.setComponent(v, sv * [hx, hy, hz][v]);
      return p.applyQuaternion(q).add(c);
    };
    const nn = n.clone().applyQuaternion(q);
    const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => M.vert(corner(su, sv), nn, (su + 1) / 2, (sv + 1) / 2, col, rough, [[bone, 1]]));
    const p0 = corner(-1, -1), p1 = corner(1, -1), p2 = corner(1, 1);
    const cr = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    if (cr.dot(nn) >= 0) M.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); else M.idx.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
  }
}

const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

/** Build one character. kind: 'survivor' | 'infected'. opts: { rifle, pack } force gear. */
export function buildHumanoid(seed, kind = 'survivor', fabric, opts = {}) {
  const rng = new RNG(seed);
  const P = PALETTES[kind];
  const infected = kind === 'infected';
  const height = rng.float(1.62, 1.9);
  const scale = height / 1.75;
  const bulk = rng.float(0.88, 1.18);
  const dirt = (c, amt) => c.clone().multiplyScalar(1 - amt * rng.float(0.1, 0.3));
  const skin = hex(rng.pick(P.skin)), hair = hex(rng.pick(P.hair));
  const jacket = hex(rng.pick(P.jackets)), pants = hex(rng.pick(P.pants)), boots = hex(rng.pick(P.boots));
  const hat = hex(rng.pick(P.hats));
  const glove = rng.chance(0.5) ? hex('#2a2622') : skin;
  const M = new Mesher(scale);
  const J = (n) => new THREE.Vector3(...JOINT[n]);
  const R = { cloth: 0.88, skin: 0.62, leather: 0.55, metal: 0.4, hair: 0.8 };
  const blood = hex('#3a1612');

  // torso: pants below the belt, jacket above; slight chest/hip shaping
  const tor = [
    { y: 0.84, rx: 0.13 * bulk, rz: 0.1 * bulk, bones: [[BI.hips, 1]], col: pants, rough: R.cloth },
    { y: 0.93, rx: 0.165 * bulk, rz: 0.115 * bulk, bones: [[BI.hips, 1]], col: pants, rough: R.cloth },
    { y: 0.99, rx: 0.166 * bulk, rz: 0.114 * bulk, bones: [[BI.hips, 0.8], [BI.spine, 0.2]], col: hex('#1e1b18'), rough: R.leather },
    { y: 1.0, rx: 0.168 * bulk, rz: 0.118 * bulk, bones: [[BI.hips, 0.7], [BI.spine, 0.3]], col: jacket, rough: R.cloth },
    { y: 1.08, rx: 0.16 * bulk, rz: 0.112 * bulk, bones: [[BI.spine, 1]], col: dirt(jacket, 0.3), rough: R.cloth },
    { y: 1.2, rx: 0.172 * bulk, rz: 0.12 * bulk, bones: [[BI.spine, 0.5], [BI.chest, 0.5]], col: jacket, rough: R.cloth },
    { y: 1.32, rx: 0.186 * bulk, rz: 0.128 * bulk, bones: [[BI.chest, 1]], col: jacket, rough: R.cloth },
    { y: 1.41, rx: 0.19 * bulk, rz: 0.12 * bulk, bones: [[BI.chest, 1]], col: jacket, rough: R.cloth },
    { y: 1.46, rx: 0.15 * bulk, rz: 0.1 * bulk, bones: [[BI.chest, 0.8], [BI.neck, 0.2]], col: jacket, rough: R.cloth, ny: 0.5 },
    { y: 1.5, rx: 0.075, rz: 0.07, bones: [[BI.neck, 1]], col: jacket, rough: R.cloth, ny: 0.8 },
  ];
  if (infected) for (const s of tor) if (rng.chance(0.3)) s.col = s.col.clone().lerp(blood, rng.float(0.2, 0.6));
  loft(M, tor, 14, true, false);
  // neck + head (skin), hair/hat cap on top
  limb(M, new THREE.Vector3(0, 1.47, 0), new THREE.Vector3(0, 1.6, 0.005), 0.052, 0.048, BI.neck, BI.head, skin, R.skin, { seg: 10, rings: 3, flat: 1 });
  const headC = new THREE.Vector3(0, 1.655, 0.012);
  const hatKind = infected ? rng.pick(['none', 'none', 'hood']) : rng.pick(['beanie', 'cap', 'hood', 'none', 'beanie']);
  ellipsoid(M, headC, 0.082, 0.112, 0.097, BI.head, skin, R.skin, { col2: hatKind === 'none' ? hair : hat, split: hatKind === 'none' ? 0.035 : 0.02 });
  // face: brow ridge shadow, nose, ears; hair volume at the back when bare-headed
  const faceDark = skin.clone().multiplyScalar(0.55);
  ellipsoid(M, headC.clone().add(new THREE.Vector3(0.03, 0.022, 0.082)), 0.017, 0.009, 0.01, BI.head, faceDark, 0.5, { seg: 8, rings: 4 });
  ellipsoid(M, headC.clone().add(new THREE.Vector3(-0.03, 0.022, 0.082)), 0.017, 0.009, 0.01, BI.head, faceDark, 0.5, { seg: 8, rings: 4 });
  ellipsoid(M, headC.clone().add(new THREE.Vector3(0, -0.005, 0.098)), 0.012, 0.028, 0.018, BI.head, skin.clone().multiplyScalar(0.95), R.skin, { seg: 8, rings: 5 });
  ellipsoid(M, headC.clone().add(new THREE.Vector3(0, -0.058, 0.08)), 0.026, 0.006, 0.008, BI.head, skin.clone().multiplyScalar(0.62), 0.5, { seg: 8, rings: 3 });
  for (const sx of [1, -1]) ellipsoid(M, headC.clone().add(new THREE.Vector3(sx * 0.082, -0.005, -0.005)), 0.012, 0.03, 0.02, BI.head, skin, R.skin, { seg: 8, rings: 4 });
  if (hatKind === 'none') ellipsoid(M, headC.clone().add(new THREE.Vector3(0, 0.022, -0.012)), 0.088, 0.1, 0.1, BI.head, hair, R.hair, { y0: -0.2, y1: 1, seg: 14, rings: 6 });
  if (hatKind === 'beanie') ellipsoid(M, headC.clone().add(new THREE.Vector3(0, 0.03, -0.004)), 0.09, 0.098, 0.103, BI.head, hat, R.cloth, { y0: 0.05, y1: 1, seg: 14, rings: 6 });
  if (hatKind === 'cap') {
    ellipsoid(M, headC.clone().add(new THREE.Vector3(0, 0.03, -0.004)), 0.088, 0.095, 0.1, BI.head, hat, R.cloth, { y0: 0.2, y1: 1, seg: 14, rings: 5 });
    boxPart(M, headC.clone().add(new THREE.Vector3(0, 0.05, 0.11)), 0.15, 0.012, 0.08, BI.head, hat, R.cloth);
  }
  // collar and jacket hem hide the seams at neck and belt
  loft(M, [
    { y: 1.455, rx: 0.098, rz: 0.086, bones: [[BI.chest, 0.6], [BI.neck, 0.4]], col: jacket, rough: R.cloth },
    { y: 1.535, rx: 0.074, rz: 0.074, bones: [[BI.neck, 1]], col: dirt(jacket, 0.1), rough: R.cloth, ny: 0.3 },
  ], 12, false, false);
  loft(M, [
    { y: 0.9, rx: 0.183 * bulk, rz: 0.132 * bulk, bones: [[BI.hips, 1]], col: dirt(jacket, 0.25), rough: R.cloth, ny: -0.4 },
    { y: 1.03, rx: 0.172 * bulk, rz: 0.124 * bulk, bones: [[BI.hips, 0.5], [BI.spine, 0.5]], col: jacket, rough: R.cloth },
  ], 14, false, false);
  // chest pockets
  for (const sx of [0.085, -0.085]) {
    boxPart(M, new THREE.Vector3(sx * bulk, 1.295, 0.121 * bulk), 0.085, 0.095, 0.014, BI.chest, dirt(jacket, 0.25), R.cloth);
    boxPart(M, new THREE.Vector3(sx * bulk, 1.34, 0.127 * bulk), 0.09, 0.028, 0.012, BI.chest, dirt(jacket, 0.45), R.cloth);
  }
  if (hatKind === 'hood') {
    ellipsoid(M, headC.clone().add(new THREE.Vector3(0, 0.01, -0.012)), 0.1, 0.13, 0.112, BI.head, dirt(jacket, 0.2), R.cloth, { y0: -0.1, y1: 1, seg: 14, rings: 7 });
  }
  if (!infected && rng.chance(0.18)) {
    // gas mask: rubber face piece, two round lenses, filter canister
    const rubber = hex('#23241f');
    ellipsoid(M, headC.clone().add(new THREE.Vector3(0, -0.018, 0.022)), 0.086, 0.095, 0.088, BI.head, rubber, 0.45, { y0: -0.95, y1: 0.55, seg: 14, rings: 7 });
    for (const sx of [0.032, -0.032]) {
      limb(M, headC.clone().add(new THREE.Vector3(sx, 0.02, 0.088)), headC.clone().add(new THREE.Vector3(sx * 1.05, 0.02, 0.112)), 0.024, 0.022, BI.head, null, rubber, 0.45, { seg: 10, rings: 1, flat: 1 });
      ellipsoid(M, headC.clone().add(new THREE.Vector3(sx * 1.05, 0.02, 0.111)), 0.02, 0.02, 0.004, BI.head, hex('#0d1113'), 0.08, { seg: 10, rings: 3 });
    }
    limb(M, headC.clone().add(new THREE.Vector3(0, -0.06, 0.1)), headC.clone().add(new THREE.Vector3(0, -0.08, 0.165)), 0.036, 0.036, BI.head, null, hex('#3a3b33'), R.metal, { seg: 10, rings: 1, flat: 1 });
  }
  // arms (sleeves = jacket, hands = skin or gloves)
  for (const s of ['L', 'R']) {
    const sh = J(`upperArm${s}`), el = J(`foreArm${s}`), wr = J(`hand${s}`);
    limb(M, J(`shoulder${s}`).add(new THREE.Vector3(0, 0.0, 0)), sh, 0.06, 0.058, BI[`shoulder${s}`], BI[`upperArm${s}`], jacket, R.cloth, { seg: 8, rings: 2, parentBone: BI.chest });
    limb(M, sh, el, 0.058 * bulk, 0.046, BI[`upperArm${s}`], BI[`foreArm${s}`], jacket, R.cloth, { parentBone: BI.chest });
    limb(M, el, wr, 0.047, 0.036, BI[`foreArm${s}`], BI[`hand${s}`], infected && rng.chance(0.5) ? skin : dirt(jacket, 0.2), R.cloth, { parentBone: BI[`upperArm${s}`] });
    const sign = s === 'L' ? 1 : -1;
    // hand: palm + finger mass as a flattened ellipsoid, thumb angled forward
    ellipsoid(M, wr.clone().add(new THREE.Vector3(0.0, -0.075, 0.008)), 0.022, 0.08, 0.042, BI[`hand${s}`], glove, R.skin, { seg: 10, rings: 7 });
    limb(M, wr.clone().add(new THREE.Vector3(-0.005 * sign, -0.03, 0.03)), wr.clone().add(new THREE.Vector3(-0.012 * sign, -0.085, 0.055)), 0.013, 0.01, BI[`hand${s}`], null, glove, R.skin, { seg: 6, rings: 2, flat: 1 });
    // legs
    const hp = J(`thigh${s}`), kn = J(`shin${s}`), an = J(`foot${s}`);
    limb(M, hp.clone().add(new THREE.Vector3(0, 0.03, 0)), kn, 0.088 * bulk, 0.06, BI[`thigh${s}`], BI[`shin${s}`], pants, R.cloth, { parentBone: BI.hips, rings: 7 });
    limb(M, kn, an.clone().add(new THREE.Vector3(0, 0.1, 0)), 0.058, 0.046, BI[`shin${s}`], BI[`foot${s}`], dirt(pants, 0.5), R.cloth, { parentBone: BI[`thigh${s}`] });
    // boot: shaft + foot box with toe
    limb(M, an.clone().add(new THREE.Vector3(0, 0.12, 0)), an.clone().add(new THREE.Vector3(0, -0.03, 0)), 0.05, 0.052, BI[`foot${s}`], null, boots, R.leather, { seg: 8, rings: 2, flat: 1 });
    ellipsoid(M, an.clone().add(new THREE.Vector3(0, -0.045, 0.065)), 0.052, 0.045, 0.14, BI[`foot${s}`], boots, R.leather, { seg: 12, rings: 7, y0: -1, y1: 0.9 });
    boxPart(M, an.clone().add(new THREE.Vector3(0, -0.078, 0.065)), 0.108, 0.02, 0.285, BI[`foot${s}`], hex('#161412'), 0.7);
  }
  // gear
  const hasPack = !infected && (opts.pack ?? rng.chance(0.75));
  if (hasPack) {
    const packCol = hex(rng.pick(['#3b4030', '#4a3e2e', '#2d3033', '#5a4a30'])), z0 = -0.2 * bulk;
    const pb = [[BI.chest, 1]];
    loft(M, [
      { y: 1.04, z: z0, rx: 0.13, rz: 0.06, sq: 5, bones: pb, col: dirt(packCol, 0.6), rough: R.cloth },
      { y: 1.07, z: z0, rx: 0.15, rz: 0.08, sq: 5, bones: pb, col: packCol, rough: R.cloth },
      { y: 1.3, z: z0 - 0.005, rx: 0.15, rz: 0.085, sq: 5, bones: pb, col: packCol, rough: R.cloth },
      { y: 1.41, z: z0 - 0.01, rx: 0.13, rz: 0.07, sq: 5, bones: pb, col: packCol, rough: R.cloth },
    ], 16, true, true);
    // lid flap and side pouch
    loft(M, [
      { y: 1.34, z: z0 - 0.018, rx: 0.14, rz: 0.08, sq: 5, bones: pb, col: dirt(packCol, 0.3), rough: R.cloth },
      { y: 1.43, z: z0 - 0.015, rx: 0.135, rz: 0.075, sq: 5, bones: pb, col: dirt(packCol, 0.3), rough: R.cloth },
    ], 16, false, true);
    boxPart(M, new THREE.Vector3(0, 1.16, z0 - 0.09), 0.2, 0.12, 0.04, BI.chest, dirt(packCol, 0.4), R.cloth);
    if (rng.chance(0.6)) {
      const roll = hex(rng.pick(['#2f4a3a', '#5a2f28', '#39414a', '#6a6250']));
      limb(M, new THREE.Vector3(-0.19, 1.49, z0 - 0.01), new THREE.Vector3(0.19, 1.49, z0 - 0.01), 0.05, 0.05, BI.chest, null, roll, R.cloth, { seg: 10, rings: 3, flat: 1 });
    }
    // shoulder straps over the front
    for (const sx of [0.1, -0.1]) {
      limb(M, new THREE.Vector3(sx * bulk, 1.45, -0.02), new THREE.Vector3(sx * bulk * 1.05, 1.44, 0.07 * bulk), 0.02, 0.02, BI.chest, null, hex('#1f1c19'), R.leather, { seg: 6, rings: 1, flat: 0.4 });
      limb(M, new THREE.Vector3(sx * bulk * 1.05, 1.44, 0.075 * bulk), new THREE.Vector3(sx * bulk * 1.15, 1.2, 0.128 * bulk), 0.02, 0.018, BI.chest, null, hex('#1f1c19'), R.leather, { seg: 6, rings: 2, flat: 0.4 });
    }
  }
  const hasRifle = !infected && (opts.rifle ?? rng.chance(0.4));
  const woodTone = hex(rng.pick(['#5a3a22', '#6b4a2c', '#4a3020']));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(M.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(M.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(M.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(M.col, 3));
  g.setAttribute('rough', new THREE.Float32BufferAttribute(M.rough, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(M.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(M.sw, 4));
  g.setIndex(M.idx);
  fixWinding(g);
  g.computeBoundingSphere();
  g.boundingSphere.radius = Math.max(g.boundingSphere.radius, 1.2 * scale);

  // skeleton
  const bones = {};
  const list = BONES.map((name) => { const b = new THREE.Bone(); b.name = name; bones[name] = b; return b; });
  for (const name of BONES) {
    const b = bones[name];
    const p = new THREE.Vector3(...JOINT[name]).multiplyScalar(scale);
    if (PARENT[name]) {
      bones[PARENT[name]].add(b);
      b.position.copy(p.sub(new THREE.Vector3(...JOINT[PARENT[name]]).multiplyScalar(scale)));
    } else b.position.copy(p);
  }
  const skeleton = new THREE.Skeleton(list);
  const mesh = new THREE.SkinnedMesh(g, humanMaterial(fabric));
  mesh.add(bones.hips);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  const rig = { mesh, bones, height, scale, infected, bulk, rest: Object.fromEntries(BONES.map((n) => [n, bones[n].position.clone()])), rifle: null, carry: null, tool: null };
  if (hasRifle) {
    const rifle = new THREE.Mesh(rifleGeometry(scale, woodTone), humanMaterial(fabric));
    rifle.castShadow = true;
    rifle.userData.slung = { p: new THREE.Vector3(0.02, -0.07, -0.31 * bulk).multiplyScalar(scale), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.9)) };
    rifle.userData.aim = { p: new THREE.Vector3(-0.13, 0.14, 0.4).multiplyScalar(scale), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.35, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))) };
    rifle.userData.muzzle = new THREE.Vector3(0, 0.5 * scale, 0.012 * scale);
    bones.chest.add(rifle);
    rig.rifle = rifle;
    setRifleAim(rig, 0);
  }
  return rig;
}

/** Blend the rifle between slung on the back (0) and shouldered (1). */
export function setRifleAim(rig, w) {
  const r = rig.rifle;
  if (!r) return;
  const a = r.userData.slung, b = r.userData.aim;
  const k = w > 0.5 ? 1 : 0;
  if (r.userData.k === k) return;
  r.userData.k = k;
  r.position.copy(k ? b.p : a.p);
  r.quaternion.copy(k ? b.q : a.q);
}

function rifleGeometry(scale, wood) {
  const M = new Mesher(scale);
  const steel = hex('#23252a');
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0));
  boxPart(M, new THREE.Vector3(0, -0.36, 0), 0.04, 0.26, 0.07, 0, wood, 0.5);
  boxPart(M, new THREE.Vector3(0, -0.08, 0), 0.045, 0.3, 0.06, 0, steel, 0.4);
  boxPart(M, new THREE.Vector3(0, 0.15, 0), 0.042, 0.16, 0.05, 0, wood, 0.5);
  limb(M, new THREE.Vector3(0, 0.05, 0.012), new THREE.Vector3(0, 0.5, 0.012), 0.011, 0.01, 0, null, steel, 0.4, { seg: 6, rings: 1, flat: 1 });
  boxPart(M, new THREE.Vector3(0, -0.02, 0.06), 0.03, 0.06, 0.1, 0, steel, 0.4, tilt);
  return staticGeometry(M);
}

function staticGeometry(M) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(M.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(M.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(M.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(M.col, 3));
  g.setAttribute('rough', new THREE.Float32BufferAttribute(M.rough, 1));
  g.setIndex(M.idx);
  fixWinding(g);
  g.computeBoundingSphere();
  return g;
}

// ---- carried loads (chest bone) and hand tools (right hand bone), shared geometry
const _props = new Map();
function propGeometry(kind) {
  if (_props.has(kind)) return _props.get(kind);
  const M = new Mesher(1);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (kind === 'wood') {
    for (const [y, z] of [[-0.04, 0.3], [-0.04, 0.44], [0.08, 0.37]]) limb(M, V(-0.36, y, z), V(0.36, y + 0.01, z), 0.065, 0.06, 0, null, hex('#6e5a44'), 0.9, { seg: 8, rings: 1, flat: 1 });
  } else if (kind === 'sack') {
    ellipsoid(M, V(0, -0.04, 0.3), 0.2, 0.2, 0.14, 0, hex('#8a7a5a'), 0.95, { seg: 10, rings: 7 });
    limb(M, V(0, 0.14, 0.3), V(0, 0.22, 0.3), 0.04, 0.02, 0, null, hex('#7a6a4a'), 0.95, { seg: 6, rings: 1, flat: 1 });
  } else if (kind === 'water') {
    boxPart(M, V(0, -0.04, 0.3), 0.3, 0.34, 0.14, 0, hex('#3a4a32'), 0.5);
    boxPart(M, V(0, 0.16, 0.3), 0.14, 0.04, 0.04, 0, hex('#2a3424'), 0.5);
  } else if (kind === 'axe') {
    limb(M, V(0, -0.02, 0), V(0, -0.68, 0), 0.016, 0.018, 0, null, hex('#7a5a3a'), 0.6, { seg: 6, rings: 1, flat: 1 });
    boxPart(M, V(0, -0.66, 0.05), 0.02, 0.07, 0.14, 0, hex('#3a3c40'), 0.35);
  } else if (kind === 'shovel') {
    limb(M, V(0, 0.2, 0), V(0, -0.85, 0), 0.016, 0.016, 0, null, hex('#7a5a3a'), 0.6, { seg: 6, rings: 1, flat: 1 });
    boxPart(M, V(0, -0.98, 0.0), 0.2, 0.26, 0.015, 0, hex('#4a4038'), 0.5);
  } else if (kind === 'hammer') {
    limb(M, V(0, -0.02, 0), V(0, -0.34, 0), 0.013, 0.014, 0, null, hex('#7a5a3a'), 0.6, { seg: 6, rings: 1, flat: 1 });
    boxPart(M, V(0, -0.33, 0.02), 0.03, 0.03, 0.12, 0, hex('#2e3034'), 0.35);
  }
  const g = staticGeometry(M);
  _props.set(kind, g);
  return g;
}

/** Show a carried load (wood | sack | water | null) in front of the chest. */
export function setCarry(rig, kind) {
  if (rig.carryKind === kind) return;
  rig.carryKind = kind;
  if (rig.carry) { rig.bones.chest.remove(rig.carry); rig.carry = null; }
  if (!kind) return;
  const m = new THREE.Mesh(propGeometry(kind), _mat);
  m.castShadow = true;
  m.scale.setScalar(rig.scale);
  rig.bones.chest.add(m);
  rig.carry = m;
}

/** Tool in the right hand (axe | shovel | hammer | null). */
export function setTool(rig, kind) {
  if (rig.toolKind === kind) return;
  rig.toolKind = kind;
  if (rig.tool) { rig.bones.handR.remove(rig.tool); rig.tool = null; }
  if (!kind) return;
  const m = new THREE.Mesh(propGeometry(kind), _mat);
  m.castShadow = true;
  m.scale.setScalar(rig.scale);
  m.position.set(0, -0.07 * rig.scale, 0.01);
  m.rotation.x = kind === 'shovel' ? 0.2 : -1.2;
  rig.bones.handR.add(m);
  rig.tool = m;
}

function fixWinding(g) {
  // make every triangle face along its vertex normals (robust against loft orientation)
  const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), cr = new THREE.Vector3();
  for (let i = 0; i < ix.length; i += 3) {
    const i0 = ix[i], i1 = ix[i + 1], i2 = ix[i + 2];
    a.fromArray(p, i0 * 3); b.fromArray(p, i1 * 3); c.fromArray(p, i2 * 3);
    cr.subVectors(b, a).cross(c.sub(a));
    nn.fromArray(n, i0 * 3).add(new THREE.Vector3().fromArray(n, i1 * 3)).add(new THREE.Vector3().fromArray(n, i2 * 3));
    if (cr.dot(nn) < 0) { ix[i + 1] = i2; ix[i + 2] = i1; }
  }
}

let _mat = null;
function humanMaterial(fabric) {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, normalMap: fabric?.normalMap || null, normalScale: new THREE.Vector2(0.6, 0.6) });
  enhance(_mat, {
    porosity: 0.8, key: 'human',
    extra: (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float rough;\nvarying float vRough;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = rough;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRough;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
    },
  });
  return _mat;
}

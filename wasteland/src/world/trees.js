// Procedural trees: species rules grow a branching skeleton (trunk with root
// flare, lean and wobble; whorled or spiralled branches with gravitropism and
// droop; twigs), then skin it as parallel-transport tubes with bark UVs in metres
// and dress it with alpha-tested foliage cards. Leaf normals are bent outward from
// the crown so the canopy shades as a volume. Per-vertex 'wind' attributes drive
// the shared wind shader (bend weight, flutter weight, phase).
import * as THREE from 'three';
import { RNG } from '../core/rng.js';

export const SPECIES = {
  conifer: {
    bark: 'bark_pine', foliage: 'fir_twig', height: [12, 25], baseR: 0.0135, crown: [0.22, 0.42],
    tint: [0.78, 0.86, 0.74], deadLower: 0.28,
  },
  birch: {
    bark: 'bark_birch', foliage: 'leaf_clusters', height: [10, 20], baseR: 0.0105, crown: [0.34, 0.5],
    tint: [0.92, 1.0, 0.86], stems: [1, 1, 1, 2, 3],
  },
  oak: {
    bark: 'bark_oak', foliage: 'leaf_clusters', height: [9, 17], baseR: 0.021, crown: [0.22, 0.34],
    tint: [0.7, 0.82, 0.62],
  },
  dead: {
    bark: 'bark_dead', foliage: null, height: [8, 16], baseR: 0.016, crown: [0.3, 0.45], tint: [1, 1, 1],
  },
};

const FIR_SPRITES = [1, 2, 3, 4, 6, 7, 8];   // usable sprigs in the Poly Haven fir twig atlas
const BIRCH_CLUSTERS = [0, 1], BROAD_CLUSTERS = [2, 3];

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.wind = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wind, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------- skeleton
// A branch is a polyline of nodes { p: Vector3, r: radius }, plus metadata.
function growCurve(rng, start, dir, length, r0, r1, opts) {
  const n = Math.max(3, Math.ceil(length / (opts.step || 0.5)));
  const nodes = [];
  const p = start.clone(), d = dir.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = THREE.MathUtils.lerp(r0, r1, Math.pow(t, opts.taperPow || 1));
    nodes.push({ p: p.clone(), r, t });
    if (i === n) break;
    // tropism: bend toward up (phototropism) or down (gravity), plus wobble
    const grav = (opts.gravity || 0) * (0.3 + t);
    d.addScaledVector(up, (opts.photo || 0) - grav);
    d.x += (rng.next() - 0.5) * (opts.wobble || 0.1);
    d.z += (rng.next() - 0.5) * (opts.wobble || 0.1);
    d.y += (rng.next() - 0.5) * (opts.wobble || 0.1) * 0.5;
    d.normalize();
    p.addScaledVector(d, length / n);
  }
  return nodes;
}

function pointAt(nodes, t) {
  const f = t * (nodes.length - 1), i = Math.min(nodes.length - 2, Math.floor(f)), k = f - i;
  const a = nodes[i], b = nodes[i + 1];
  return { p: a.p.clone().lerp(b.p, k), r: THREE.MathUtils.lerp(a.r, b.r, k), dir: b.p.clone().sub(a.p).normalize() };
}

// ---------------------------------------------------------------- tube skinning
function tube(B, nodes, radial, tile, windBase, phase, height, flex, colorAO) {
  const N = nodes.length;
  if (N < 2) return;
  const tangents = [], normals = [];
  for (let i = 0; i < N; i++) {
    const a = nodes[Math.max(0, i - 1)].p, b = nodes[Math.min(N - 1, i + 1)].p;
    tangents.push(b.clone().sub(a).normalize());
  }
  // parallel transport frame
  let nrm = new THREE.Vector3(0, 1, 0);
  if (Math.abs(tangents[0].y) > 0.9) nrm.set(1, 0, 0);
  nrm.sub(tangents[0].clone().multiplyScalar(nrm.dot(tangents[0]))).normalize();
  normals.push(nrm.clone());
  for (let i = 1; i < N; i++) {
    const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
    const s = axis.length();
    if (s > 1e-6) {
      axis.divideScalar(s);
      const ang = Math.acos(THREE.MathUtils.clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
      nrm.applyAxisAngle(axis, ang);
    }
    normals.push(nrm.clone());
  }
  const base = B.count;
  const wraps = Math.max(1, Math.round((2 * Math.PI * nodes[0].r) / tile));
  let vlen = 0;
  for (let i = 0; i < N; i++) {
    if (i > 0) vlen += nodes[i].p.distanceTo(nodes[i - 1].p);
    const T = tangents[i], Nn = normals[i], Bn = new THREE.Vector3().crossVectors(T, Nn);
    const { p, r } = nodes[i];
    const bend = Math.min(1, windBase + Math.pow(Math.max(0, p.y) / height, 2) * 0.35 + (i / (N - 1)) * flex);
    const ao = colorAO ? colorAO(p, i / (N - 1)) : 1;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a), sx = Math.sin(a);
      const nx = Nn.x * cx + Bn.x * sx, ny = Nn.y * cx + Bn.y * sx, nz = Nn.z * cx + Bn.z * sx;
      B.pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      B.nor.push(nx, ny, nz);
      B.uv.push((j / radial) * wraps, vlen / tile);
      B.wind.push(bend, 0, phase);
      B.col.push(ao, ao, ao);
    }
  }
  const w = radial + 1;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * w + j, b = a + 1, c = a + w, d = c + 1;
    B.idx.push(a, b, c, b, d, c); // outward facing
  }
}

// ---------------------------------------------------------------- foliage cards
function card(B, origin, up, right, w, h, rect, normalBend, crownC, crownR, tint, phase, bend, flutter) {
  // origin = stem attach point (bottom centre of the sprite)
  const base = B.count;
  const n = new THREE.Vector3().crossVectors(right, up).normalize();
  const corners = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
  const uvs = [[rect.u0, rect.v1], [rect.u1, rect.v1], [rect.u0, rect.v0], [rect.u1, rect.v0]];
  for (let k = 0; k < 4; k++) {
    const [cu, cv] = corners[k];
    const p = origin.clone().addScaledVector(right, cu * w).addScaledVector(up, cv * h);
    const out = p.clone().sub(crownC);
    const dist = out.length();
    out.divideScalar(Math.max(dist, 1e-4));
    const nn = n.clone().multiplyScalar(Math.sign(n.dot(out)) || 1).lerp(out, normalBend).normalize();
    B.pos.push(p.x, p.y, p.z);
    B.nor.push(nn.x, nn.y, nn.z);
    B.uv.push(uvs[k][0], uvs[k][1]);
    B.wind.push(bend, flutter * (cv > 0 ? 1 : 0.35), phase);
    // interior leaves are darker (self shadowing inside the crown)
    const ao = THREE.MathUtils.clamp(0.42 + 0.62 * (dist / crownR), 0.4, 1.05);
    B.col.push(tint[0] * ao, tint[1] * ao, tint[2] * ao);
  }
  B.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}

function randomPerp(rng, dir) {
  const a = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const r = new THREE.Vector3().crossVectors(dir, a).normalize();
  return r.applyAxisAngle(dir, rng.float(0, Math.PI * 2));
}

// ---------------------------------------------------------------- species growth
/**
 * @param {string} kind species key
 * @param {number} seed variant seed
 * @param {object} sprites { fir: rects[], clusters: rects[] }
 * @param {number} detail 1 = LOD0, ~0.35 = LOD1
 */
export function growTree(kind, seed, sprites, detail = 1) {
  const S = SPECIES[kind];
  const rng = new RNG(seed * 7919 + kind.length * 131);
  const H = rng.float(S.height[0], S.height[1]);
  const bark = new Builder(), leaf = new Builder();
  const radialT = detail > 0.6 ? 12 : 6, radialB = detail > 0.6 ? 6 : 3, radialTw = detail > 0.6 ? 4 : 3;
  const tile = 1.0;
  const up = new THREE.Vector3(0, 1, 0);
  const lean = new THREE.Vector3(rng.float(-1, 1), 0, rng.float(-1, 1)).normalize().multiplyScalar(rng.float(0, kind === 'birch' ? 0.1 : 0.05));
  const trunkDir = up.clone().add(lean).normalize();
  const R0 = H * S.baseR * rng.float(0.85, 1.15);
  const crownStart = rng.float(S.crown[0], S.crown[1]);
  const crownC = new THREE.Vector3(lean.x * H * 0.5, H * (crownStart + (1 - crownStart) * (kind === 'conifer' ? 0.4 : 0.55)), lean.z * H * 0.5);
  const crownR = H * (kind === 'conifer' ? 0.2 : kind === 'oak' ? 0.36 : 0.22);
  const tint = S.tint.map((c) => c * rng.float(0.92, 1.08));
  const aoBark = (p) => THREE.MathUtils.clamp(0.55 + 0.45 * Math.min(1, p.y / 1.2) - (p.y > H * crownStart ? 0.15 : 0), 0.4, 1);
  const stems = S.stems ? rng.pick(S.stems) : 1;
  const trunks = [];

  for (let st = 0; st < stems; st++) {
    const off = stems > 1 ? new THREE.Vector3(rng.float(-0.35, 0.35), 0, rng.float(-0.35, 0.35)) : new THREE.Vector3();
    const dir = stems > 1 ? trunkDir.clone().add(new THREE.Vector3(off.x * 0.25, 0, off.z * 0.25)).normalize() : trunkDir;
    const h = H * (st === 0 ? 1 : rng.float(0.7, 0.92));
    const r0 = R0 * (st === 0 ? 1 : 0.75);
    const nodes = growCurve(rng, off, dir, h, r0, kind === 'dead' ? r0 * 0.35 : 0.012, { step: detail > 0.6 ? 0.45 : 0.9, wobble: kind === 'oak' ? 0.08 : 0.035, photo: 0.004, taperPow: kind === 'conifer' ? 1.0 : 0.8 });
    if (kind === 'dead') nodes.length = Math.max(3, Math.floor(nodes.length * rng.float(0.6, 0.85))); // snapped top
    // root flare
    for (const nd of nodes) { const y = nd.p.y; if (y < 0.9) nd.r *= 1 + 0.55 * Math.pow(1 - y / 0.9, 2.2); }
    nodes[0].p.y -= 0.25; // sink into the ground
    tube(bark, nodes, radialT, tile * (kind === 'birch' ? 1 : 1), 0, rng.float(0, 6.28), H, 0.08, aoBark);
    trunks.push({ nodes, h });
  }

  const main = trunks[0];
  const phaseOf = () => rng.float(0, 6.28);

  if (kind === 'conifer') {
    // whorls of near-horizontal branches; lower third self-pruned (bare, grey)
    const spacing = rng.float(0.42, 0.62) / Math.sqrt(detail);
    for (let y = H * crownStart * 0.55; y < H * 0.97; y += spacing * rng.float(0.8, 1.2)) {
      const t = y / H;
      const inCrown = (y - H * crownStart) / (H * (1 - crownStart));
      const dead = inCrown < 0;
      const count = rng.int(4, 6);
      const phi0 = rng.float(0, Math.PI * 2);
      const q = pointAt(main.nodes, Math.min(0.99, t));
      for (let k = 0; k < count; k++) {
        if (detail < 0.6 && k % 2) continue;
        if (dead && rng.chance(0.55)) continue; // self-pruned: most lower branches already gone
        const phi = phi0 + (k / count) * Math.PI * 2 + rng.float(-0.3, 0.3);
        const horiz = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
        const tilt = dead ? rng.float(-0.35, -0.1) : THREE.MathUtils.lerp(-0.25, 0.35, Math.max(0, inCrown));
        const d = horiz.clone().add(new THREE.Vector3(0, tilt, 0)).normalize();
        const len = dead ? rng.float(0.25, 0.9) : H * 0.23 * Math.pow(1 - Math.max(0, inCrown), 0.95) * rng.float(0.8, 1.15) + 0.25;
        const br = Math.max(0.01, q.r * (dead ? 0.14 : 0.3));
        const nodes = growCurve(rng, q.p.clone().addScaledVector(horiz, q.r * 0.8), d, len, br, 0.006, { step: detail > 0.6 ? 0.4 : 0.9, gravity: dead ? 0.01 : 0.04, photo: dead ? 0 : 0.035, wobble: 0.12 });
        const ph = phaseOf();
        if (detail > 0.6 || (!dead && len > 1.5)) tube(bark, nodes, detail > 0.6 ? radialTw : 3, tile, 0.05, ph, H, 0.6, () => (dead ? 0.5 : 0.7));
        if (dead || !sprites.fir) continue;
        // needle sprays along the branch: a flat-ish layer plus drooping side sprays,
        // rotated around the branch axis so the whorl reads as a dense skirt
        const nCards = Math.max(3, Math.round(len * 7.5 * detail + 2));
        for (let c = 0; c < nCards; c++) {
          const tt = 0.08 + (c / nCards) * 0.92;
          const pt = pointAt(nodes, tt);
          const roll = rng.float(-1.1, 1.1) + (c % 3 === 0 ? Math.PI : 0) * 0.35;
          const side = randomPerp(rng, pt.dir);
          side.y = side.y * 0.25 - 0.1; side.normalize();
          const spriteI = FIR_SPRITES[rng.int(0, FIR_SPRITES.length - 1)];
          const rect = sprites.fir[spriteI];
          const aspect = (rect.u1 - rect.u0) / (rect.v1 - rect.v0);
          const hgt = rng.float(0.7, 1.25) * (0.75 + 0.45 * (1 - tt)) / Math.sqrt(detail);
          const along = pt.dir.clone().lerp(side, rng.float(0.15, 0.6)).add(new THREE.Vector3(0, -rng.float(0.1, 0.55), 0)).normalize();
          const right = new THREE.Vector3().crossVectors(along, up).normalize().applyAxisAngle(along, roll);
          card(leaf, pt.p, along, right, hgt * aspect * 1.1, hgt, rect, 0.55, crownC, crownR, tint, ph, 0.35 + tt * 0.6, 0.4);
        }
      }
    }
    // leader tip sprays
    if (sprites.fir) {
      const top = main.nodes[main.nodes.length - 1].p;
      for (let c = 0; c < 4; c++) {
        const rect = sprites.fir[FIR_SPRITES[c % FIR_SPRITES.length]];
        const right = new THREE.Vector3(Math.cos(c * 1.57), 0, Math.sin(c * 1.57));
        card(leaf, top.clone().add(new THREE.Vector3(0, -0.9, 0)), new THREE.Vector3(0, 1, 0), right, 0.5, 1.1, rect, 0.4, crownC, crownR, tint, 0, 0.9, 0.3);
      }
    }
  } else {
    // deciduous: spiral primary branches, forks, twig clusters carry leaf cards
    const primaries = kind === 'oak' ? rng.int(7, 11) : kind === 'dead' ? rng.int(4, 7) : rng.int(14, 22);
    for (const tr of trunks) {
      const nP = tr === main ? primaries : Math.round(primaries * 0.6);
      for (let k = 0; k < nP; k++) {
        if (detail < 0.6 && kind !== 'oak' && k % 2) continue;
        const t = THREE.MathUtils.lerp(crownStart, 0.95, Math.pow((k + rng.float(0, 0.8)) / nP, kind === 'oak' ? 0.8 : 1));
        const q = pointAt(tr.nodes, Math.min(0.98, t));
        const phi = k * 2.39996 + rng.float(-0.4, 0.4);
        const out = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
        const elev = kind === 'birch' ? rng.float(0.55, 1.0) : kind === 'oak' ? rng.float(0.25, 0.8) : rng.float(0.2, 0.9);
        const d = out.clone().multiplyScalar(Math.cos(elev)).add(new THREE.Vector3(0, Math.sin(elev), 0)).normalize();
        const rel = 1 - t;
        const len = (kind === 'oak' ? H * 0.42 : H * 0.3) * (0.45 + rel * 0.9) * rng.float(0.75, 1.15);
        const br = Math.max(0.02, q.r * (kind === 'oak' ? 0.6 : 0.42));
        const nodes = growCurve(rng, q.p, d, len, br, 0.012, { step: detail > 0.6 ? 0.5 : 1.0, gravity: kind === 'birch' ? 0.055 : 0.025, photo: kind === 'birch' ? 0.02 : 0.012, wobble: kind === 'oak' ? 0.22 : 0.12 });
        if (kind === 'dead' && rng.chance(0.5)) nodes.length = Math.max(3, Math.floor(nodes.length * rng.float(0.4, 0.8)));
        const ph = phaseOf();
        tube(bark, nodes, radialB, tile, 0.04, ph, H, 0.5, aoBark);
        // secondary branches
        const nS = kind === 'oak' ? rng.int(5, 8) : kind === 'dead' ? rng.int(1, 3) : rng.int(5, 8);
        for (let s = 0; s < nS; s++) {
          const tt = rng.float(0.3, 0.92);
          const p2 = pointAt(nodes, tt);
          const side = randomPerp(rng, p2.dir);
          const d2 = p2.dir.clone().lerp(side, rng.float(0.45, 0.8)).normalize();
          if (kind === 'birch') d2.y -= rng.float(0.2, 0.6);
          const len2 = len * rng.float(0.3, 0.55) * (1.1 - tt * 0.5);
          const n2 = growCurve(rng, p2.p, d2.normalize(), len2, Math.max(0.008, p2.r * 0.55), 0.005, { step: detail > 0.6 ? 0.35 : 0.8, gravity: kind === 'birch' ? 0.1 : 0.03, wobble: 0.2 });
          if (detail > 0.6 || len2 > 1.2) tube(bark, n2, detail > 0.6 ? radialTw : 3, tile, 0.1, ph, H, 0.7, () => 0.75);
          if (!S.foliage) continue;
          // leaf clusters along the outer part of the secondary branch
          const nC = Math.max(2, Math.round((kind === 'oak' ? 11 : 9) * detail * rng.float(0.75, 1.25) + (detail < 0.6 ? 1 : 0)));
          for (let c = 0; c < nC; c++) {
            const tc = rng.float(0.2, 1.0);
            const pc = pointAt(n2, tc);
            const idx = kind === 'birch' ? rng.pick(BIRCH_CLUSTERS) : rng.pick(BROAD_CLUSTERS);
            const rect = sprites.clusters[idx];
            const size = (kind === 'birch' ? rng.float(0.7, 1.05) : rng.float(0.9, 1.35)) / Math.sqrt(detail);
            let dir = pc.dir.clone();
            if (kind === 'birch') dir.lerp(new THREE.Vector3(0, -1, 0), rng.float(0.45, 0.8)).normalize(); // pendulous
            else dir.lerp(new THREE.Vector3(rng.float(-1, 1), rng.float(-0.2, 0.8), rng.float(-1, 1)).normalize(), 0.5).normalize();
            const right = randomPerp(rng, dir);
            card(leaf, pc.p, dir, right, size * 0.95, size, rect, 0.6, crownC, crownR, tint, ph, 0.45 + tc * 0.4, 1.0);
          }
        }
        // tip cluster
        if (S.foliage) {
          const pe = nodes[nodes.length - 1];
          const rect = sprites.clusters[kind === 'birch' ? rng.pick(BIRCH_CLUSTERS) : rng.pick(BROAD_CLUSTERS)];
          const dir = pointAt(nodes, 0.99).dir;
          const size = (kind === 'birch' ? 0.8 : 1.1) / Math.sqrt(detail);
          card(leaf, pe.p, dir, randomPerp(rng, dir), size, size, rect, 0.6, crownC, crownR, tint, ph, 0.9, 1.0);
        }
      }
    }
  }
  return {
    bark: bark.geometry(),
    leaves: leaf.count ? leaf.geometry() : null,
    height: H, crownRadius: crownR, trunkRadius: R0, crownBase: H * crownStart,
  };
}

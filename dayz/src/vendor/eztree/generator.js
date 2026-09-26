// Geometry-only port of ez-tree's procedural tree generator.
// Original: https://github.com/dgreenheck/ez-tree  (MIT, (c) 2024 Daniel Greenheck, see LICENSE)
// Changes for this project: no materials/textures; bark V coordinate is the
// accumulated branch length (so bark texel density can be set in metres);
// per-vertex branch level and wind weights are emitted for LOD and wind shading.
import * as THREE from 'three';

class RNG {
  constructor(seed) { this.m_w = (123456789 + seed) & 0xffffffff; this.m_z = (987654321 - seed) & 0xffffffff; }
  random(max = 1, min = 0) {
    this.m_z = (36969 * (this.m_z & 65535) + (this.m_z >> 16)) & 0xffffffff;
    this.m_w = (18000 * (this.m_w & 65535) + (this.m_w >> 16)) & 0xffffffff;
    const r = (((this.m_z << 16) + (this.m_w & 65535)) >>> 0) / 4294967296;
    return (max - min) * r + min;
  }
}

class Branch {
  constructor(origin, orientation, length, radius, level, sectionCount, segmentCount, v0 = 0) {
    Object.assign(this, { origin: origin.clone(), orientation: orientation.clone(), length, radius, level, sectionCount, segmentCount, v0 });
  }
}

const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);

export function generateTree(opt) {
  const rng = new RNG(opt.seed);
  const B = { verts: [], normals: [], uvs: [], indices: [], level: [], wind: [] };
  const Lf = { verts: [], normals: [], uvs: [], indices: [], rand: [] };
  const queue = [new Branch(new THREE.Vector3(), new THREE.Euler(), opt.branch.length[0], opt.branch.radius[0], 0, opt.branch.sections[0], opt.branch.segments[0])];
  const levels = opt.branch.levels;
  const deciduous = opt.type === 'deciduous';
  const force = new THREE.Vector3().copy(opt.branch.force.direction);
  const qForce = new THREE.Quaternion().setFromUnitVectors(UP, force.clone().normalize());

  function leaf(origin, orientation) {
    let i = Lf.verts.length / 3;
    const size = opt.leaves.size * (1 + rng.random(opt.leaves.sizeVariance, -opt.leaves.sizeVariance));
    const r = rng.random();
    const quad = (rot) => {
      const e = new THREE.Euler(0, rot, 0);
      const v = [[-size / 2, size, 0], [-size / 2, 0, 0], [size / 2, 0, 0], [size / 2, size, 0]]
        .map((p) => new THREE.Vector3(...p).applyEuler(e).applyEuler(orientation).add(origin));
      const n = new THREE.Vector3(0, 0, 1).applyEuler(e).applyEuler(orientation);
      for (const p of v) { Lf.verts.push(p.x, p.y, p.z); Lf.normals.push(n.x, n.y, n.z); Lf.rand.push(r); }
      Lf.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
      Lf.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      i += 4;
    };
    quad(0);
    if (opt.leaves.billboard === 'double') quad(Math.PI / 2);
  }

  function leaves(sections) {
    const radialOffset = rng.random();
    for (let i = 0; i < opt.leaves.count; i++) {
      const start = rng.random(1.0, opt.leaves.start);
      const k = Math.floor(start * (sections.length - 1));
      const A = sections[k], Bs = sections[Math.min(k + 1, sections.length - 1)];
      const alpha = (start - k / (sections.length - 1)) / (1 / (sections.length - 1));
      const o = new THREE.Vector3().lerpVectors(A.origin, Bs.origin, alpha);
      const qA = new THREE.Quaternion().setFromEuler(A.orientation), qB = new THREE.Quaternion().setFromEuler(Bs.orientation);
      const parent = new THREE.Euler().setFromQuaternion(qB.slerp(qA, alpha));
      const q1 = new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(opt.leaves.angle));
      const q2 = new THREE.Quaternion().setFromAxisAngle(UP, 2 * Math.PI * (radialOffset + i / opt.leaves.count));
      const q3 = new THREE.Quaternion().setFromEuler(parent);
      leaf(o, new THREE.Euler().setFromQuaternion(q3.multiply(q2.multiply(q1))));
    }
  }

  function children(count, level, sections, parentV0) {
    const radialOffset = rng.random();
    for (let i = 0; i < count; i++) {
      const start = rng.random(1.0, opt.branch.start[level]);
      const k = Math.floor(start * (sections.length - 1));
      const A = sections[k], Bs = sections[Math.min(k + 1, sections.length - 1)];
      const alpha = (start - k / (sections.length - 1)) / (1 / (sections.length - 1));
      const o = new THREE.Vector3().lerpVectors(A.origin, Bs.origin, alpha);
      const radius = opt.branch.radius[level] * ((1 - alpha) * A.radius + alpha * Bs.radius);
      const qA = new THREE.Quaternion().setFromEuler(A.orientation), qB = new THREE.Quaternion().setFromEuler(Bs.orientation);
      const parent = new THREE.Euler().setFromQuaternion(qB.slerp(qA, alpha));
      const q1 = new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(opt.branch.angle[level]));
      const q2 = new THREE.Quaternion().setFromAxisAngle(UP, 2 * Math.PI * (radialOffset + i / count));
      const q3 = new THREE.Quaternion().setFromEuler(parent);
      const len = opt.branch.length[level] * (deciduous ? 1 : 1 - start);
      queue.push(new Branch(o, new THREE.Euler().setFromQuaternion(q3.multiply(q2.multiply(q1))), len, radius, level,
        opt.branch.sections[level], opt.branch.segments[level], (1 - alpha) * A.v + alpha * Bs.v));
    }
  }

  function branch(br) {
    const offset = B.verts.length / 3;
    const orient = br.orientation.clone(), origin = br.origin.clone();
    const secLen = br.length / br.sectionCount; // (upstream divides by 1: its type check never matched)
    const sections = [];
    let v = br.v0;
    for (let i = 0; i <= br.sectionCount; i++) {
      let r = br.radius;
      if (i === br.sectionCount && br.level === levels) r = 0.001;
      else if (deciduous) r *= 1 - opt.branch.taper[br.level] * (i / br.sectionCount);
      else r *= 1 - i / br.sectionCount;
      let first;
      for (let j = 0; j < br.segmentCount; j++) {
        const a = (2 * Math.PI * j) / br.segmentCount;
        const n = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).applyEuler(orient).normalize();
        const p = n.clone().multiplyScalar(r).add(origin);
        B.verts.push(p.x, p.y, p.z); B.normals.push(n.x, n.y, n.z); B.uvs.push(j / br.segmentCount, v);
        B.level.push(br.level); B.wind.push(br.level === 0 ? 0 : br.level * 0.34 + (i / br.sectionCount) * 0.25);
        if (j === 0) first = { p, n };
      }
      B.verts.push(first.p.x, first.p.y, first.p.z); B.normals.push(first.n.x, first.n.y, first.n.z); B.uvs.push(1, v);
      B.level.push(br.level); B.wind.push(br.level === 0 ? 0 : br.level * 0.34 + (i / br.sectionCount) * 0.25);
      sections.push({ origin: origin.clone(), orientation: orient.clone(), radius: r, v });
      origin.add(new THREE.Vector3(0, secLen, 0).applyEuler(orient));
      v += secLen;
      const g = Math.max(1, 1 / Math.sqrt(r)) * opt.branch.gnarliness[br.level];
      orient.x += rng.random(g, -g);
      orient.z += rng.random(g, -g);
      const q = new THREE.Quaternion().setFromEuler(orient);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, opt.branch.twist[br.level]));
      q.rotateTowards(qForce, opt.branch.force.strength / r);
      orient.setFromQuaternion(q);
    }
    const N = br.segmentCount + 1;
    for (let i = 0; i < br.sectionCount; i++) for (let j = 0; j < br.segmentCount; j++) {
      const v1 = offset + i * N + j, v2 = v1 + 1, v3 = v1 + N, v4 = v2 + N;
      B.indices.push(v1, v3, v2, v2, v3, v4);
    }
    if (deciduous) {
      const last = sections[sections.length - 1];
      if (br.level < levels) {
        queue.push(new Branch(last.origin, last.orientation, opt.branch.length[br.level + 1], last.radius, br.level + 1, br.sectionCount, br.segmentCount, last.v));
      } else leaf(last.origin, last.orientation);
    }
    if (br.level === levels) leaves(sections);
    else if (br.level < levels) children(opt.branch.children[br.level], br.level + 1, sections, br.v0);
  }

  while (queue.length) branch(queue.shift());
  return { branches: B, leaves: Lf };
}

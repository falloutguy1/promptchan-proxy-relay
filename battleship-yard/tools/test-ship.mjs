// Headless sanity test: builds every preset ship, reports timing, triangle counts, NaNs and bounds.
import * as THREE from 'three';
import { ShipBuilder } from '../src/ship/ShipBuilder.js';
import { PRESETS } from '../src/ship/ShipDesign.js';
const m = (n) => { const x = new THREE.MeshStandardMaterial(); x.name = n; x.userData.u = { uPaint: { value: new THREE.Color() }, uDazzle: { value: 0 }, uDeckY: { value: 0 } }; return x; };
const mats = { hull: m('hull'), paint: m('paint'), turret: m('turret'), deck: m('deck'), steelDeck: m('sd'), dark: m('dark'), soot: m('soot'), canvas: m('canvas'), glass: m('glass'), brass: m('brass'), chain: m('chain'), railing: m('railing'), flag: m('flag'), wood: m('wood'), setPaint() {} };
const b = new ShipBuilder(mats);
for (const [k, d] of Object.entries(PRESETS)) {
  const t = performance.now();
  const root = b.build(d);
  let tris = 0, verts = 0, nan = 0, meshes = 0;
  root.traverse((o) => { if (o.isMesh) { meshes++; const p = o.geometry.attributes.position; verts += p.count; tris += (o.geometry.index ? o.geometry.index.count : p.count) / 3; for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) nan++; } });
  const box = new THREE.Box3().setFromObject(root);
  console.log(k.padEnd(26), (performance.now() - t).toFixed(0) + 'ms', 'meshes', meshes, 'tris', Math.round(tris), 'NaN', nan, 'box', box.min.toArray().map((v) => v.toFixed(1)).join(','), box.max.toArray().map((v) => v.toFixed(1)).join(','));
}

// Winding checks: procedural surfaces must face outward (a past bug rendered hull/deck/bark inside-out).
import { generateTree } from '../src/world/TreeGen.js';
const faceAgree = (g) => {
  const p = g.attributes.position, n = g.attributes.normal, idx = g.index;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
  let ok = 0, bad = 0;
  for (let i = 0; i < idx.count; i += 3) {
    A.fromBufferAttribute(p, idx.getX(i)); B.fromBufferAttribute(p, idx.getX(i + 1)); C.fromBufferAttribute(p, idx.getX(i + 2)); N.fromBufferAttribute(n, idx.getX(i));
    const f = B.clone().sub(A).cross(C.clone().sub(A));
    if (f.lengthSq() < 1e-10) continue;
    f.dot(N) > 0 ? ok++ : bad++;
  }
  return bad / Math.max(1, ok + bad);
};
let failed = false;
const root = b.build(PRESETS['Fast battleship (1940)']);
root.traverse((o) => {
  if (!o.isMesh || !['hull', 'deck'].includes(o.material.name)) return;
  const g = o.geometry; let up = 0, outward = 0, n = 0;
  const nn = g.attributes.normal, pp = g.attributes.position;
  for (let i = 0; i < nn.count; i++) { n++; if (o.material.name === 'deck' ? nn.getY(i) > 0 : nn.getZ(i) * pp.getZ(i) >= 0) up++; }
  const frac = up / n;
  console.log(`winding ${o.material.name}: ${(frac * 100).toFixed(1)}% outward normals`);
  if (frac < 0.9) failed = true;
});
for (const sp of ['pine', 'spruce', 'broadleaf']) {
  const bad = faceAgree(generateTree(sp, 3, 0).bark);
  console.log(`winding bark ${sp}: ${(bad * 100).toFixed(1)}% faces disagree with normals`);
  if (bad > 0.01) failed = true;
}
if (failed) { console.error('FAIL: geometry winding'); process.exit(1); }

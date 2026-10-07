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

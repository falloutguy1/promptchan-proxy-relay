import * as THREE from 'three';
import { Buckets } from './geom.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMaterials } from './materials.js';
import { buildHull } from './hull.js';
import { buildLifeboats, addDavits } from './lifeboats.js';
import { buildTopside } from './topside.js';

export function buildShip() {
  const M = makeMaterials();
  const B = new Buckets();
  const inst = { dividers: [], furniture: [] };
  const anim = {};
  const ship = new THREE.Group();

  const { boats } = buildHull(B, inst);
  addDavits(B, boats);
  const { root, detail } = buildTopside(B, M, anim);
  ship.add(root);

  for (const [key] of B.map) {
    const mat = M[key];
    if (!mat) { console.warn('missing material', key); continue; }
    const geo = B.merged(key);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = key !== 'railGlass';
    mesh.receiveShadow = key !== 'railGlass';
    if (key === 'railGlass') mesh.renderOrder = 2;
    ship.add(mesh);
  }

  // balcony dividers
  const dg = new THREE.BoxGeometry(1, 1, 1);
  const dmat = new THREE.MeshStandardMaterial({ color: 0xc9cbc8, roughness: 0.55, metalness: 0 });
  const dm = new THREE.InstancedMesh(dg, dmat, inst.dividers.length);
  inst.dividers.forEach((m, i) => dm.setMatrixAt(i, m));
  dm.castShadow = true; dm.receiveShadow = true;
  ship.add(dm);

  // balcony furniture: two chairs and a side table per occupied balcony (detail layer)
  {
    const parts = [];
    const chair = (cx, rot) => {
      const g = [];
      const seat = new THREE.BoxGeometry(0.48, 0.05, 0.46); seat.translate(0, 0.42, 0); g.push(seat);
      const back = new THREE.BoxGeometry(0.48, 0.5, 0.05); back.rotateX(-0.2); back.translate(0, 0.68, -0.23); g.push(back);
      for (const [lx, lz] of [[0.2, 0.18], [-0.2, 0.18], [0.2, -0.2], [-0.2, -0.2]]) { const l = new THREE.BoxGeometry(0.035, 0.42, 0.035); l.translate(lx, 0.21, lz); g.push(l); }
      for (const q of g) { q.rotateY(rot); q.translate(cx, 0, 0); parts.push(q); }
    };
    chair(-0.62, 0.35); chair(0.62, -0.35);
    const top = new THREE.CylinderGeometry(0.27, 0.27, 0.035, 12); top.translate(0, 0.5, 0.05); parts.push(top);
    const stem = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6); stem.translate(0, 0.25, 0.05); parts.push(stem);
    const g = mergeGeometries(parts.map((q) => q.index ? q.toNonIndexed() : q).map((q) => { for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; }));
    const fm = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 }), inst.furniture.length);
    const cols = [new THREE.Color(0x2b2e33), new THREE.Color(0xe6e4df), new THREE.Color(0x6b5440), new THREE.Color(0x4a5a66)];
    inst.furniture.forEach((f, i) => { fm.setMatrixAt(i, f.m); fm.setColorAt(i, cols[Math.floor(f.h * 97) % cols.length]); });
    fm.castShadow = true; fm.receiveShadow = true;
    fm.layers.set(1);
    ship.add(fm);
  }

  const lb = buildLifeboats(boats);
  ship.add(lb);

  // detail objects render only for the main camera (layer 1), not in water reflections
  detail.traverse((o) => o.layers.set(1));

  ship.traverse((o) => { if (o.isMesh) o.matrixAutoUpdate = false; o.updateMatrix(); });
  for (const r of anim.radars || []) r.matrixAutoUpdate = true;
  for (const c of anim.coaster ? anim.coaster.cars : []) c.traverse((o) => { o.castShadow = false; });
  return { ship, anim, materials: M };
}

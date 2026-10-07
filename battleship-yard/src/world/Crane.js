import * as THREE from 'three';
import { V, Batch, rbox, cyl } from '../engine/geom.js';
import { QUAY } from './layout.js';

/** Member between two points (tube), added to a batch. */
function member(b, mat, a, c, r) {
  const d = c.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  b.add(mat, g, a.clone().add(c).multiplyScalar(0.5), [e.x, e.y, e.z]);
}

/** Lattice box truss from p0 to p1 with given half-width/half-height (tapering). */
function truss(b, mat, p0, p1, w0, h0, w1, h1, bays, chordR, braceR) {
  const dir = p1.clone().sub(p0);
  const fwd = dir.clone().normalize();
  const side = new THREE.Vector3(0, 0, 1);
  const up = side.clone().cross(fwd).normalize().negate();
  const node = (t, sx, sy) => {
    const w = w0 + (w1 - w0) * t, h = h0 + (h1 - h0) * t;
    return p0.clone().addScaledVector(dir, t).addScaledVector(side, sx * w).addScaledVector(up, sy * h);
  };
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const [sx, sy] of corners) member(b, mat, node(0, sx, sy), node(1, sx, sy), chordR);
  for (let i = 0; i < bays; i++) {
    const t0 = i / bays, t1 = (i + 1) / bays;
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4];
      member(b, mat, node(t0, ax, ay), node(t0, bx, by), braceR);
      // alternating diagonals (Warren pattern)
      if ((i + k) % 2) member(b, mat, node(t0, ax, ay), node(t1, bx, by), braceR);
      else member(b, mat, node(t0, bx, by), node(t1, ax, ay), braceR);
    }
  }
}

export function buildCrane(lib) {
  const paint = lib.make('crane-paint', 'painted_concrete', { weather: { paint: 0xc08a17, macro: 0.3, macroScale: 0.12, grimeHeight: 1.0, grimeRange: 8, grimeAmount: 0.25 } });
  const dark = lib.plain('crane-dark', 0x2a2b2c, 0.6, 0.5);
  const cab = lib.make('crane-cab', 'corrugated_iron_02', { metalness: 0.1, useMetalMap: false, weather: { paint: 0xc9c3b2, macro: 0.25, macroScale: 0.1 } });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1e2a30, roughness: 0.05, metalness: 0, envMapIntensity: 1.3 });
  const steel = lib.plain('crane-wire', 0x3a3a3a, 0.4, 0.9);
  const group = new THREE.Group();
  group.name = 'portal-crane';
  const gauge = QUAY.railZ[0] - QUAY.railZ[1]; // 12 m between rails
  const zc = (QUAY.railZ[0] + QUAY.railZ[1]) / 2;
  const portalH = 13;

  // ---- portal (travels along rails) ----
  const base = new Batch();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const foot = V(sx * 5.5, 1.3, zc + sz * gauge / 2);
    const top = V(sx * 3.4, portalH, zc + sz * 3.4);
    // tapered box legs
    const d = top.clone().sub(foot), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const g = rbox(1.1, len, 1.1, 0.06);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 - 0.25 * ((p.getY(i) + len / 2) / len); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    g.computeVertexNormals();
    base.add(paint, g, foot.clone().add(top).multiplyScalar(0.5), [e.x, e.y, e.z]);
  }
  for (const sz of [-1, 1]) {
    // bogie beams with wheels on each rail
    base.add(paint, rbox(14, 1.2, 1.4, 0.08), V(0, 0.95, zc + sz * gauge / 2));
    for (const x of [-6, -4.4, 4.4, 6]) {
      base.add(dark, cyl(0.42, 0.42, 0.3, 18), V(x, 0.42, zc + sz * gauge / 2), [Math.PI / 2, 0, 0]);
      base.add(paint, rbox(1.4, 0.6, 1.0, 0.05), V(x, 0.7, zc + sz * gauge / 2));
    }
    base.add(paint, rbox(1.0, 1.0, 0.8, 0.05), V(-7.4, 0.9, zc + sz * gauge / 2)); // buffers
    base.add(paint, rbox(1.0, 1.0, 0.8, 0.05), V(7.4, 0.9, zc + sz * gauge / 2));
    base.add(paint, rbox(8.0, 0.9, 0.9, 0.06), V(0, portalH * 0.55, zc + sz * 4.4));
  }
  for (const sx of [-1, 1]) base.add(paint, rbox(0.9, 0.9, gauge * 0.8, 0.06), V(sx * 4.4, portalH * 0.55, zc));
  base.add(paint, cyl(4.6, 4.6, 1.4, 32), V(0, portalH + 0.4, zc));
  base.add(dark, cyl(4.0, 4.0, 0.5, 32), V(0, portalH + 1.3, zc));
  // access ladder up one leg + cable reel
  for (let y = 1.5; y < portalH; y += 0.3) base.add(steel, cyl(0.015, 0.015, 0.5, 4), V(5.2 - (y / portalH) * 1.9, y, zc + gauge / 2 - 0.9), [0, 0, Math.PI / 2]);
  base.add(dark, cyl(1.3, 1.3, 0.8, 24), V(-7.8, 1.8, zc - gauge / 2), [Math.PI / 2, 0, 0]);
  group.add(base.build('crane-portal'));

  // ---- slewing superstructure + luffing jib ----
  const slew = new THREE.Group();
  slew.position.set(0, portalH + 1.55, zc);
  const s = new Batch();
  s.add(paint, rbox(12, 1.0, 7, 0.1), V(-2, 0.5, 0));
  s.add(cab, rbox(9, 4.5, 6.2, 0.12), V(-3.5, 3.25, 0));
  s.add(dark, rbox(4.2, 3.4, 6.6, 0.1), V(-8.4, 2.2, 0)); // counterweight
  s.add(cab, rbox(3.0, 2.8, 2.6, 0.1), V(3.0, 2.2, 2.6)); // operator cab
  s.add(glass, new THREE.BoxGeometry(0.06, 1.6, 2.2), V(4.52, 2.5, 2.6));
  s.add(glass, new THREE.BoxGeometry(2.4, 1.6, 0.06), V(3.0, 2.5, 3.92));
  for (const z of [-2.3, 2.3]) {
    // A-frame
    member(s, paint, V(-6.5, 5.5, z), V(-2.5, 14, z * 0.45), 0.32);
    member(s, paint, V(1.5, 1.0, z), V(-2.5, 14, z * 0.45), 0.32);
  }
  s.add(paint, rbox(1.2, 0.8, 2.6, 0.08), V(-2.5, 14.2, 0));
  slew.add(s.build('crane-house'));
  // jib pivots at (2, 2) in slew space
  const jib = new THREE.Group();
  jib.position.set(2.2, 2.0, 0);
  const j = new Batch();
  const jibLen = 44;
  truss(j, paint, V(0, 0, 0), V(jibLen, 0, 0), 1.5, 1.2, 0.5, 0.45, 18, 0.13, 0.05);
  j.add(paint, rbox(2.0, 1.4, 1.4, 0.08), V(jibLen + 0.6, 0, 0));
  j.add(dark, cyl(0.6, 0.6, 0.6, 16), V(jibLen + 1.2, 0, 0), [Math.PI / 2, 0, 0]);
  jib.add(j.build('crane-jib'));
  jib.rotation.z = 0.62;
  slew.add(jib);
  // hoist wire + hook block (kept vertical)
  const hook = new Batch();
  hook.add(steel, cyl(0.03, 0.03, 1, 4), V(0, -0.5, 0));
  hook.add(paint, rbox(1.0, 1.4, 0.6, 0.1), V(0, -1.6, 0));
  hook.add(dark, new THREE.TorusGeometry(0.35, 0.09, 8, 16, Math.PI * 1.5), V(0, -2.7, 0));
  const hookG = hook.build('crane-hook');
  group.add(slew);
  const wire = hookG.children.find((c) => c.material === steel);
  group.add(hookG);
  // luffing tie / pendant from A-frame top to jib head
  const pend = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), steel);
  group.add(pend);
  pend.castShadow = true;

  const tmp = new THREE.Vector3();
  const state = { slew: -Math.PI / 2, luff: 0.62, t: 0 };
  return {
    group, state,
    update(dt, t) {
      // slow working cycle: slew between quay and ship, luff in/out
      state.slew = -Math.PI / 2 + Math.sin(t * 0.03) * 0.55; // working arc between quay apron and the ship (+z)
      state.luff = 0.55 + Math.sin(t * 0.045 + 1) * 0.12;
      slew.rotation.y = state.slew;
      jib.rotation.z = state.luff;
      group.updateMatrixWorld(true);
      const head = jib.localToWorld(tmp.set(jibLen + 1.2, -0.6, 0)).clone();
      const local = group.worldToLocal(head.clone());
      const hookY = 8 + Math.sin(t * 0.06) * 3;
      hookG.position.set(local.x, hookY, local.z);
      if (wire) { const lw = Math.max(0.1, local.y - hookY); wire.scale.y = lw; wire.position.y = lw; } // unit wire spans y in [-1, 0]
      const aTop = slew.localToWorld(new THREE.Vector3(-2.5, 14.6, 0));
      const aL = group.worldToLocal(aTop);
      pend.position.copy(aL).add(local).multiplyScalar(0.5);
      pend.scale.y = aL.distanceTo(local);
      pend.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local.clone().sub(aL).normalize());
    },
  };
}

// Procedural architecture of Station Zarya: every surface has metric UVs, real thickness and bevelled edges.
import * as THREE from 'three';
import { M } from './materials.js';
import { extrudeProfile, arc, sweepXY, extrudeShape, bevelBox, mound, merged } from './geom.js';
import * as Lay from './layout.js';
import { collision } from './collision.js';

const { L, OPENINGS, OPEN_W, OPEN_SPRING, HALL, HALL_SPRING, HALL_APEX, PYLON_OUT, EDGE, WALL,
  SIDE_SPRING, SIDE_APEX, SIDE_CX, SIDE_RX, TRACK_Y, TRACK_X, GAUGE, TUN_HW, TUN_SPRING, TUN_END } = Lay;

const mirrorPts = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
const mesh = (g, m, { cast = true, receive = true } = {}) => {
  const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = receive; return o;
};

export function buildStation(scene) {
  const root = new THREE.Group();
  root.name = 'station';
  const add = (o) => { root.add(o); return o; };
  const R = OPEN_W / 2;

  // ---------- floors ----------
  add(mesh(extrudeProfile([[-9.55, 0], [9.55, 0]], -L, L, { uOffset: -9.55 }), M.granite, { cast: false }));

  // Platform edge: bevelled granite coping with an overhang, recessed concrete face below.
  for (const s of [1, -1]) {
    const cop = bevelBox(0.52, 0.14, L * 2, 0.02);
    const c = add(mesh(cop, M.coping));
    c.position.set(s * 9.8, -0.07, 0);
    const face = [[9.7, -0.14], [9.7, TRACK_Y]];
    add(mesh(extrudeProfile(s > 0 ? face : mirrorPts(face), -L, L), M.roughConcrete, { cast: false }));
  }

  // ---------- central hall vault, cornices and transverse ribs ----------
  const hallArc = arc(0, HALL_SPRING, HALL, HALL_APEX - HALL_SPRING, 0, Math.PI, 48);
  add(mesh(extrudeProfile(hallArc, -L, L), M.plaster, { cast: false }));
  const cornice = [[4.2, 3.42], [4.13, 3.47], [4.11, 3.53], [4.02, 3.58], [4.0, 3.64], [4.06, 3.7], [4.2, 3.74]];
  for (const s of [1, -1]) add(mesh(extrudeProfile(s > 0 ? cornice : mirrorPts(cornice), -L, L, { sharpDeg: 50 }), M.plaster));
  const ribProfile = [[0, -0.2], [0.09, -0.17], [0.11, 0], [0.09, 0.17], [0, 0.2]];
  const ribs = [];
  for (const z of Lay.BAYS) ribs.push(sweepXY(hallArc, ribProfile, z, { closedProfile: false }));
  add(mesh(merged(ribs), M.plaster));

  // ---------- pylons (marble-clad masonry with arched passages) ----------
  const pyl = new THREE.Shape();
  const P = (z, y) => [-z, y];          // shape u = -z so the Y-rotation below maps it back to +z
  pyl.moveTo(...P(-L, 0));
  const archPaths = [];
  for (const z0 of OPENINGS) {
    pyl.lineTo(...P(z0 - R, 0));
    pyl.lineTo(...P(z0 - R, OPEN_SPRING));
    const a = arc(z0, OPEN_SPRING, R, R, Math.PI, 0, 20);
    a.forEach(([z, y]) => pyl.lineTo(...P(z, y)));
    pyl.lineTo(...P(z0 + R, 0));
    archPaths.push([[z0 - R, 0], [z0 - R, OPEN_SPRING], ...a.slice(1, -1), [z0 + R, OPEN_SPRING], [z0 + R, 0]]);
  }
  pyl.lineTo(...P(L, 0));
  pyl.lineTo(...P(L, HALL_SPRING));
  pyl.lineTo(...P(-L, HALL_SPRING));
  const thick = PYLON_OUT - HALL;
  const pylGeo = extrudeShape(pyl, thick, 0.025, 20);
  pylGeo.rotateY(Math.PI / 2);
  // Arch trims (archivolts) on both faces of every passage, and a dark marble plinth.
  const trimGeos = [];
  const trimOut = [[-0.13, 0], [-0.13, -0.025], [-0.1, -0.045], [0.0, -0.045], [0.0, 0]];
  for (const path of archPaths) {
    const p2 = path.map(([z, y]) => [-z, y]);
    const outer = sweepXY(p2, trimOut, 0, { closedProfile: false });
    const inner = sweepXY(p2, trimOut.map(([a, b]) => [a, -b]).reverse(), thick, { closedProfile: false });
    for (const g of [outer, inner]) { g.rotateY(Math.PI / 2); trimGeos.push(g); }
  }
  const trimGeo = merged(trimGeos);
  const plinths = [];
  const segs = [];
  let zPrev = -L;
  for (const z0 of OPENINGS) { segs.push([zPrev, z0 - R]); zPrev = z0 + R; }
  segs.push([zPrev, L]);
  for (const [a, b] of segs) {
    for (const xf of [-0.02, thick + 0.02]) {
      const g = bevelBox(0.05, 0.28, b - a, 0.012);
      g.translate(xf, 0.14, (a + b) / 2);
      plinths.push(g);
    }
  }
  const plinthGeo = merged(plinths);
  for (const s of [1, -1]) {
    const x0 = s > 0 ? HALL : -PYLON_OUT;
    const p = add(mesh(pylGeo, M.marble)); p.position.x = x0;
    const t = add(mesh(trimGeo, M.marble)); t.position.x = x0;
    const pl = add(mesh(plinthGeo, M.marbleDark)); pl.position.x = x0;
    for (const [a, b] of segs) collision.addBox(Math.min(x0, x0 + thick), Math.max(x0, x0 + thick), a, b, 0, HALL_SPRING);
  }

  // ---------- side halls: vault, track wall, trackbed ----------
  const sideArc = arc(SIDE_CX, SIDE_SPRING, SIDE_RX, SIDE_APEX - SIDE_SPRING, 0, Math.PI, 40);
  const trackWall = [[WALL, TRACK_Y], [WALL, 0.35]];
  const trackWallTiles = [[WALL, 0.35], [WALL, SIDE_SPRING]];
  const bedProfile = (x0, x1) => [[x0, TRACK_Y], [TRACK_X - 0.2, TRACK_Y], [TRACK_X - 0.2, TRACK_Y - 0.15], [TRACK_X + 0.2, TRACK_Y - 0.15], [TRACK_X + 0.2, TRACK_Y], [x1, TRACK_Y]];
  for (const s of [1, -1]) {
    const f = (pts) => (s > 0 ? pts : mirrorPts(pts));
    add(mesh(extrudeProfile(f(sideArc), -L, L), M.plaster, { cast: false }));
    add(mesh(extrudeProfile(f(trackWall), -L, L), M.concreteWall, { cast: false }));
    add(mesh(extrudeProfile(f(trackWallTiles), -L, L, { uOffset: 0.35 - TRACK_Y }), M.tiles, { cast: false }));
    // bevelled dado rail between the concrete base and the tiling
    const dado = bevelBox(0.06, 0.08, L * 2, 0.012); dado.translate(s * (WALL - 0.03), 0.37, 0);
    add(mesh(dado, M.marbleDark));
    add(mesh(extrudeProfile(f(bedProfile(9.7, WALL)), -L, L, { sharpDeg: 60 }), M.trackbed, { cast: false }));
    // Spring-line cornice on the pylon side of the side hall.
    const sc = [[6.2, 3.3], [6.26, 3.34], [6.3, 3.42], [6.2, 3.46]];
    add(mesh(extrudeProfile(f(sc.map(([x, y]) => [x, y]).reverse().map(([x, y]) => [x, y])), -L, L, { sharpDeg: 50 }), M.plaster));
  }

  // ---------- end walls ----------
  const hallOutline = (notch) => {
    const s = new THREE.Shape();
    s.moveTo(-HALL, 0);
    notch(s);
    s.lineTo(HALL, 0); s.lineTo(HALL, HALL_SPRING);
    hallArc.slice(1, -1).forEach(([x, y]) => s.lineTo(x, y));
    s.lineTo(-HALL, HALL_SPRING);
    return s;
  };
  // North: escalator portal (collapsed).  South: hermetic gate opening.
  const north = hallOutline((s) => {
    s.lineTo(-1.8, 0); s.lineTo(-1.8, 2.6);
    arc(0, 2.6, 1.8, 1.8, Math.PI, 0, 20).forEach(([x, y]) => s.lineTo(x, y));
    s.lineTo(1.8, 0);
  });
  const south = hallOutline((s) => { s.lineTo(-1.6, 0); s.lineTo(-1.6, 2.8); s.lineTo(1.6, 2.8); s.lineTo(1.6, 0); });
  const nw = add(mesh(extrudeShape(north, 0.4, 0.02), M.marble)); nw.position.z = -L - 0.4;
  const sw = add(mesh(extrudeShape(south, 0.4, 0.02), M.marble)); sw.position.z = L;

  // Side-hall end walls with the horseshoe tunnel portal notched out of them.
  const sideEnd = new THREE.Shape();
  sideEnd.moveTo(PYLON_OUT, 0);
  sideEnd.lineTo(EDGE, 0); sideEnd.lineTo(EDGE, TRACK_Y);
  sideEnd.lineTo(TRACK_X - TUN_HW, TRACK_Y);
  sideEnd.lineTo(TRACK_X - TUN_HW, TUN_SPRING);
  arc(TRACK_X, TUN_SPRING, TUN_HW, TUN_HW, Math.PI, 0, 24).forEach(([x, y]) => sideEnd.lineTo(x, y));
  sideEnd.lineTo(TRACK_X + TUN_HW, TRACK_Y);
  sideEnd.lineTo(WALL, TRACK_Y); sideEnd.lineTo(WALL, SIDE_SPRING);
  sideArc.slice(1, -1).forEach(([x, y]) => sideEnd.lineTo(x, y));
  sideEnd.lineTo(PYLON_OUT, SIDE_SPRING);
  const sideEndGeo = extrudeShape(sideEnd, 0.4, 0.02);
  for (const s of [1, -1]) {
    for (const zs of [-1, 1]) {
      const w = add(mesh(sideEndGeo, M.concreteWall));
      w.scale.x = s;
      w.position.z = zs < 0 ? -L - 0.4 : L;
      if (s < 0) w.material = M.concreteWall; // mirrored geometry: fix winding below
    }
  }
  root.traverse((o) => { if (o.isMesh && o.scale.x < 0) { o.geometry = o.geometry.clone(); flipX(o.geometry); o.scale.x = 1; } });

  // ---------- tunnels ----------
  const horseshoe = [[TRACK_X + TUN_HW, TRACK_Y], [TRACK_X + TUN_HW, TUN_SPRING], ...arc(TRACK_X, TUN_SPRING, TUN_HW, TUN_HW, 0, Math.PI, 36).slice(1, -1), [TRACK_X - TUN_HW, TUN_SPRING], [TRACK_X - TUN_HW, TRACK_Y]];
  const ringPath = horseshoe.map(([x, y]) => [x, y]);
  const ringGeo = sweepXY(ringPath, [[0, -0.06], [0.07, -0.05], [0.07, 0.05], [0, 0.06]], 0, { closedProfile: false });
  const ringZ = [];
  for (let z = L + 0.9; z < TUN_END; z += 1.0) ringZ.push(z, -z);
  for (const s of [1, -1]) {
    const f = (pts) => (s > 0 ? pts : mirrorPts(pts));
    for (const [z0, z1] of [[L, TUN_END], [-TUN_END, -L]]) {
      add(mesh(extrudeProfile(f(horseshoe), z0, z1), M.tunnel, { cast: false }));
      add(mesh(extrudeProfile(f(bedProfile(TRACK_X - TUN_HW, TRACK_X + TUN_HW)), z0, z1, { sharpDeg: 60 }), M.trackbed, { cast: false }));
    }
    const g = ringGeo.clone();
    if (s < 0) flipX(g);
    const inst = new THREE.InstancedMesh(g, M.tunnel, ringZ.length);
    const m4 = new THREE.Matrix4();
    ringZ.forEach((z, i) => inst.setMatrixAt(i, m4.makeTranslation(0, 0, z)));
    inst.receiveShadow = true; inst.castShadow = false;
    inst.computeBoundingSphere();
    add(inst);
    // Dead-end caps far down the tunnels (hidden in darkness).
    for (const zs of [-1, 1]) {
      const cap = add(mesh(new THREE.PlaneGeometry(TUN_HW * 2, 5), M.darkVoid, { cast: false }));
      cap.position.set(s * TRACK_X, 1.2, zs * TUN_END);
      cap.rotation.y = zs > 0 ? Math.PI : 0;
    }
  }

  // ---------- track: sleepers, rails, contact rail, cables ----------
  buildTrack(add);

  // ---------- collapsed escalator portal (north) ----------
  const esc = [[1.8, 0], [1.8, 2.6], ...arc(0, 2.6, 1.8, 1.8, 0, Math.PI, 20).slice(1, -1), [-1.8, 2.6], [-1.8, 0]];
  add(mesh(extrudeProfile(esc, -L - 5.5, -L - 0.4), M.concreteWall));
  const back = add(mesh(new THREE.PlaneGeometry(3.6, 4.4), M.darkVoid, { cast: false }));
  back.position.set(0, 2.2, -L - 5.5);
  const rub = add(mesh(mound(3.4, 3.1, 7), M.debris));
  rub.position.set(0, 0, -L - 1.6);
  rub.scale.set(1, 1, 1.25);
  const rub2 = add(mesh(mound(1.6, 0.7, 11), M.debris));
  rub2.position.set(1.4, 0, -L + 0.9);
  const rub3 = add(mesh(mound(1.2, 0.45, 23), M.debris));
  rub3.position.set(-2.2, 0, -L + 0.5);
  collision.addBox(-HALL, HALL, -L - 1, -L + 1.2, 0, 3);

  // ---------- hermetic gate (south) ----------
  const gate = new THREE.Group();
  const leaf = mesh(bevelBox(3.3, 2.9, 0.22, 0.03), M.rust);
  leaf.position.set(0, 1.45, 0);
  gate.add(leaf);
  for (const y of [0.35, 1.0, 1.65, 2.3]) {
    const r = mesh(bevelBox(3.1, 0.12, 0.1, 0.015), M.rust); r.position.set(0, y, -0.15); gate.add(r);
  }
  for (const x of [-1.2, 0, 1.2]) {
    const r = mesh(bevelBox(0.1, 2.7, 0.08, 0.015), M.rust); r.position.set(x, 1.45, -0.14); gate.add(r);
  }
  gate.position.set(0, 0, L + 0.25);
  add(gate);

  scene.add(root);
  root.updateMatrixWorld(true);
  return root;
}

function buildTrack(add) {
  const z0 = -TUN_END, z1 = TUN_END;
  // Wooden sleepers embedded in the concrete trackbed (instanced).
  const sleeper = bevelBox(2.6, 0.16, 0.24, 0.02);
  const zs = [];
  for (let z = z0 + 0.3; z < z1; z += 0.62) zs.push(z);
  const inst = new THREE.InstancedMesh(sleeper, M.planks, zs.length * 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
  let i = 0;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const s of [1, -1]) for (const z of zs) {
    e.set(0, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.01);
    q.setFromEuler(e);
    p.set(s * TRACK_X + (rnd() - 0.5) * 0.04, TRACK_Y - 0.05 + rnd() * 0.015, z + (rnd() - 0.5) * 0.05);
    inst.setMatrixAt(i++, m4.compose(p, q, sc));
  }
  inst.receiveShadow = true; inst.castShadow = true;
  inst.computeBoundingSphere();
  add(inst);

  // Rails: simplified R65 section, rusty body with a polished running surface.
  const railCCW = [[-0.075, 0], [0.075, 0], [0.075, 0.012], [0.02, 0.03], [0.009, 0.045], [0.009, 0.13], [0.035, 0.14],
    [0.037, 0.175], [0.03, 0.18], [-0.03, 0.18], [-0.037, 0.175], [-0.035, 0.14], [-0.009, 0.13], [-0.009, 0.045], [-0.02, 0.03], [-0.075, 0.012]];
  const rail = [...railCCW].reverse();
  rail.push(rail[0]);
  const railY = TRACK_Y + 0.03;
  const bodies = [], tops = [];
  for (const s of [1, -1]) for (const off of [-GAUGE / 2, GAUGE / 2]) {
    const x = s * TRACK_X + off;
    bodies.push(extrudeProfile(rail.map(([a, b]) => [x + a, railY + b]), z0, z1, { sharpDeg: 40 }));
    tops.push(extrudeProfile([[x - 0.028, railY + 0.1805], [x + 0.028, railY + 0.1805]], z0, z1));
  }
  add(mesh(merged(bodies), M.rustFine));
  add(mesh(merged(tops), M.steelPolished, { cast: false }));

  // Contact (third) rail with its protective board, on brackets every 5 m.
  const cr = [];
  const brackets = [];
  for (const s of [1, -1]) {
    const x = s * (TRACK_X + 1.35);
    const bar = bevelBox(0.08, 0.1, z1 - z0, 0.01); bar.translate(x, TRACK_Y + 0.3, 0); cr.push(bar);
    for (let z = z0 + 1; z < z1; z += 5) {
      const b = bevelBox(0.06, 0.4, 0.08, 0.01); b.translate(x + s * 0.06, TRACK_Y + 0.2, z); brackets.push(b);
      const arm = bevelBox(0.2, 0.05, 0.08, 0.01); arm.translate(x + s * 0.02, TRACK_Y + 0.44, z); brackets.push(arm);
    }
    const board = bevelBox(0.26, 0.03, z1 - z0, 0.008); board.translate(x + s * 0.02, TRACK_Y + 0.47, 0); cr.push(board);
  }
  add(mesh(merged(cr), M.rustFine));
  add(mesh(merged(brackets), M.rust));

  // Cable runs on the track walls (station) and tunnel walls, on brackets every metre.
  const cables = [];
  const cbr = [];
  for (const s of [1, -1]) {
    for (const [za, zb, x] of [[-L, L, WALL - 0.12], [L, z1, TRACK_X + TUN_HW - 0.1], [z0, -L, TRACK_X + TUN_HW - 0.1]]) {
      for (let k = 0; k < 4; k++) {
        const c = new THREE.CylinderGeometry(0.022 + (k % 2) * 0.008, 0.022 + (k % 2) * 0.008, zb - za, 8, 1, true);
        c.rotateX(Math.PI / 2);
        c.translate(s * x, 0.25 + k * 0.14, (za + zb) / 2);
        cables.push(c);
      }
      for (let z = za + 0.5; z < zb; z += 1.0) {
        const b = bevelBox(0.18, 0.03, 0.04, 0.006); b.translate(s * (x + 0.03), 0.2, z); cbr.push(b);
        const b2 = bevelBox(0.02, 0.55, 0.04, 0.006); b2.translate(s * (x + 0.1), 0.45, z); cbr.push(b2);
      }
    }
  }
  add(mesh(merged(cables), M.cable));
  add(mesh(merged(cbr), M.rust));
}

// Mirror a geometry across X in place, fixing winding and normals.
export function flipX(g) {
  g.scale(-1, 1, 1);
  const idx = g.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
    idx.needsUpdate = true;
  } else {
    const attrs = Object.values(g.attributes);
    for (const at of attrs) {
      for (let i = 0; i < at.count; i += 3) {
        for (let c = 0; c < at.itemSize; c++) {
          const t = at.getComponent(i + 1, c); at.setComponent(i + 1, c, at.getComponent(i + 2, c)); at.setComponent(i + 2, c, t);
        }
      }
      at.needsUpdate = true;
    }
  }
  return g;
}

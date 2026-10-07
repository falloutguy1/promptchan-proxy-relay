import * as THREE from 'three';
import { HullShape } from './HullGeometry.js';
import { LAYOUTS, analyse } from './ShipDesign.js';
import { V, S1, Batch, rbox, cyl, lathe, extrudePlan, roundedRectPlan, mulberry } from '../engine/geom.js';

export class ShipBuilder {
  constructor(mats) { this.mats = mats; }

  build(design) {
    const a = analyse(design);
    const mats = this.mats;
    const hs = new HullShape(design, a);
    const L = design.length, B = design.beam;
    mats.setPaint(design.paint, hs.deckY(0.5));
    const root = new THREE.Group();
    root.name = 'ship';
    const st = new Batch();
    const { hull, deck, transom } = hs.build(150, 30);
    st.add(mats.hull, hull, undefined, undefined, undefined, 'keep');
    st.add(mats.deck, deck, undefined, undefined, undefined, 'keep');
    if (transom) st.add(mats.hull, transom, undefined, undefined, undefined, 'keep');

    const deckAt = (x) => hs.deckY(hs.sAtX(x));
    const halfAt = (x) => hs.edge(hs.sAtX(x)).b;

    this.deckEdge(st, hs);
    this.forecastle(st, hs, design, a);

    // ---- turrets ----
    const layout = LAYOUTS[design.layout];
    const c = design.caliber / 406;
    const tdim = this.turretDims(design);
    const turrets = [];
    for (const [id, frac, level] of layout.turrets) {
      const x = frac * L;
      const dY = deckAt(x);
      const baseY = dY + level * (tdim.H + 0.9) + 0.6;
      // barbette from below deck to turret ring
      st.add(mats.paint, cyl(tdim.Rb, tdim.Rb, baseY - dY + 0.6, 40), V(x, (baseY + dY) / 2 - 0.3, 0));
      st.add(mats.paint, cyl(tdim.Rb + 0.25, tdim.Rb + 0.25, 0.25, 40), V(x, baseY - 0.12, 0));
      const aft = x < 0;
      const t = this.turret(design, tdim, id);
      t.group.position.set(x, baseY, 0);
      t.restYaw = aft ? Math.PI : 0;
      t.group.rotation.y = t.restYaw;
      t.arc = aft ? [Math.PI - 2.5, Math.PI + 2.5] : [-2.5, 2.5];
      if (layout.turrets.some(([, f]) => (aft ? f < frac : f > frac) && Math.abs(f - frac) < 0.15)) t.blockedFire = 0.35; // superfiring blast arc
      t.id = id; t.x = x;
      root.add(t.group);
      turrets.push(t);
    }

    // ---- superstructure zone ----
    const fwd = layout.turrets.filter(([, f]) => f > 0).map(([, f]) => f * L);
    const aftT = layout.turrets.filter(([, f]) => f < 0).map(([, f]) => f * L);
    const fwdEnd = (fwd.length ? Math.min(...fwd) : 0.25 * L) - tdim.L * 0.65 - 2;
    const aftEnd = aftT.length ? Math.max(...aftT) + tdim.L * 0.6 + 2 : -0.36 * L;
    const sup = this.superstructure(st, hs, design, a, fwdEnd, aftEnd, deckAt, halfAt);

    // secondaries
    const secs = [];
    const lvl1 = deckAt(0) + 2.7;
    for (let i = 0; i < design.secondary; i++) {
      const tx = sup.x0 + 8 + ((sup.x1 - sup.x0 - 20) * (i + 0.5)) / Math.max(1, design.secondary);
      for (const side of [1, -1]) {
        const g = this.secondaryTurret();
        const zEdge = Math.min(halfAt(tx) - 3.2, B * 0.33);
        g.group.position.set(tx, lvl1 + 0.1, side * zEdge);
        g.restYaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        g.group.rotation.y = g.restYaw;
        g.secondary = true;
        g.arc = [g.restYaw - 1.6, g.restYaw + 1.6];
        st.add(mats.paint, cyl(1.7, 1.7, 0.5, 24), V(tx, lvl1 - 0.15, side * zEdge));
        root.add(g.group);
        secs.push(g);
      }
    }
    this.antiAir(st, design, sup, deckAt, halfAt, turrets, tdim);

    const statics = st.build('ship-static');
    root.add(statics);
    root.userData = { design, analysis: a, hull: hs, turrets, secondaries: secs, director: sup.director, funnelTops: sup.funnelTops, bridge: sup.bridge };
    return root;
  }

  turretDims(d) {
    const c = d.caliber / 406, g = d.guns;
    const gs = 2.8 * Math.pow(c, 0.9) + 0.5;
    const W = gs * g + 3.0 * c + 1.2;
    const Lt = W * 0.92 + 3.2 * c + 1.5;
    return { c, g, gs, W, L: Lt, H: 3.0 + 0.7 * c, Rb: W * 0.43, cal: d.caliber / 1000, barrel: (d.caliber / 1000) * (d.caliber >= 400 ? 45 : 48) };
  }

  turret(d, td, id) {
    const mats = this.mats;
    const b = new Batch();
    const { W, L: Lt, H, cal } = td;
    const xf = 0.42 * Lt, xa = -0.58 * Lt;
    const plan = roundedRectPlan(xa, xf, W / 2, W * 0.43, 1.3);
    const house = extrudePlan(plan, H, 0.16);
    // sloped front roof and slightly inclined face plate
    const p = house.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const front = Math.max(0, (x - (xf - Lt * 0.32)) / (Lt * 0.32));
      if (y > H * 0.5) p.setY(i, y - front * 0.85 * ((y - H * 0.5) / (H * 0.5)));
      if (x > xf - 0.5) p.setX(i, x - (y / H) * 0.45);
    }
    house.computeVertexNormals();
    b.add(mats.turret, house);
    // rangefinder "ears" and roof fittings
    const rfL = W * 0.95 + 2;
    b.add(mats.turret, cyl(0.42, 0.42, rfL, 16), V(xa + Lt * 0.32, H * 0.72, 0), [Math.PI / 2, 0, 0]);
    for (const s of [1, -1]) {
      b.add(mats.turret, rbox(1.4, 1.2, 1.0, 0.25), V(xa + Lt * 0.32, H * 0.72, s * rfL / 2), [0, 0, 0]);
      b.add(mats.glass, cyl(0.28, 0.28, 0.08, 14), V(xa + Lt * 0.32 + 0.71, H * 0.76, s * rfL / 2), [0, 0, Math.PI / 2]);
    }
    for (const z of [-W * 0.32, 0, W * 0.32]) b.add(mats.turret, rbox(0.7, 0.55, 0.8, 0.12), V(xf - Lt * 0.4, H - 0.4, z));
    b.add(mats.turret, cyl(0.45, 0.5, 0.25, 16), V(xa + 1.4, H + 0.05, W * 0.25));
    b.add(mats.turret, rbox(1.6, 0.5, 1.0, 0.1), V(xa + 1.3, H + 0.15, -W * 0.22));
    // gun ports: dark recess where the barrels pass the face plate
    const portY = H * 0.42;
    const guns = new Batch();
    const pivotX = xf - 1.4;
    const muzzles = [];
    for (let k = 0; k < td.g; k++) {
      const z = (k - (td.g - 1) / 2) * td.gs;
      b.add(mats.dark, rbox(0.6, 1.6, cal * 3.2, 0.1), V(xf + 0.18 - portY / H * 0.45, portY, z));
      const len = td.barrel;
      const prof = [[0, 0], [cal * 1.45, 0], [cal * 1.45, 2.2 * cal * 3], [cal * 1.15, len * 0.28], [cal * 0.92, len * 0.55], [cal * 0.78, len * 0.94], [cal * 0.86, len * 0.975], [cal * 0.84, len], [cal * 0.5, len], [cal * 0.5, len - 0.3]];
      const barrel = lathe(prof, 24);
      barrel.rotateZ(-Math.PI / 2);
      guns.add(mats.turret, barrel, V(-1.0, 0, z), [0, 0, 0], S1, 'box');
      guns.add(mats.dark, cyl(cal * 0.5, cal * 0.5, 0.05, 16), V(len - 0.98, 0, z), [0, 0, Math.PI / 2]);
      // canvas blast bag with folds
      const bag = [];
      for (let i = 0; i <= 10; i++) bag.push([cal * (2.2 - i * 0.07) + Math.sin(i * Math.PI) * 0 + (i % 2) * cal * 0.18, i * 0.16]);
      const bagG = lathe(bag, 20);
      bagG.rotateZ(-Math.PI / 2);
      guns.add(mats.canvas, bagG, V(1.35, 0, z));
      muzzles.push(V(len - 1.0, 0, z));
    }
    const group = b.build('turret-' + id);
    const pivot = guns.build('guns-' + id);
    const pivotNode = new THREE.Group();
    pivotNode.position.set(pivotX, portY, 0);
    pivotNode.add(pivot);
    group.add(pivotNode);
    return { group, pivot: pivotNode, muzzles, yaw: 0, pitch: 0, cal: td.cal, reload: 0 };
  }

  secondaryTurret() {
    const mats = this.mats, b = new Batch();
    const plan = roundedRectPlan(-2.2, 2.0, 1.8, 1.4, 0.6);
    const h = extrudePlan(plan, 2.4, 0.1);
    const p = h.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); if (y > 1.3) p.setY(i, y - Math.max(0, x - 0.5) * 0.35 * ((y - 1.3) / 1.1)); }
    h.computeVertexNormals();
    b.add(mats.turret, h);
    b.add(mats.turret, rbox(0.5, 0.35, 0.6, 0.08), V(-0.6, 2.5, 0.8));
    const guns = new Batch(), muzzles = [];
    for (const z of [-0.65, 0.65]) {
      const g = lathe([[0, 0], [0.13, 0], [0.11, 1.2], [0.075, 5.6], [0.08, 5.8], [0.04, 5.8]], 12);
      g.rotateZ(-Math.PI / 2);
      guns.add(mats.turret, g, V(0, 0, z));
      muzzles.push(V(5.8, 0, z));
    }
    const group = b.build('sec');
    const pivot = new THREE.Group();
    pivot.position.set(1.6, 1.15, 0);
    pivot.add(guns.build('sec-guns'));
    group.add(pivot);
    return { group, pivot, muzzles, yaw: 0, pitch: 0, cal: 0.127, reload: 0 };
  }

  deckEdge(st, hs) {
    const mats = this.mats;
    // rounded gunwale bar + railing along both deck edges
    for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 120; i++) { const s = 0.01 + (i / 120) * 0.975; const e = hs.edge(s); pts.push(V(e.x, e.y + 0.08, side * (e.b - 0.06))); }
      const curve = new THREE.CatmullRomCurve3(pts);
      st.add(mats.paint, new THREE.TubeGeometry(curve, 240, 0.11, 6), undefined, undefined, undefined, 'box');
      // railing ribbon (alpha-tested stanchions + wires), uv.x in metres / 1.2 m tile... tile = 4.8 m
      const rp = [], ruv = [], ri = [];
      let acc = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i) acc += pts[i].distanceTo(pts[i - 1]);
        const pz = pts[i].z - side * 0.1;
        rp.push(pts[i].x, pts[i].y + 0.05, pz, pts[i].x, pts[i].y + 1.15, pz);
        ruv.push(acc / 4.8, 0, acc / 4.8, 1);
        if (i) { const a = (i - 1) * 2; ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      rg.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
      rg.setIndex(ri);
      rg.computeVertexNormals();
      // flip v so the top rail sits at the top of the texture
      const uv = rg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      st.add(mats.railing, rg, undefined, undefined, undefined, 'keep');
    }
  }

  forecastle(st, hs, d, a) {
    const mats = this.mats, L = d.length;
    // hawse pipes + anchors on both bows
    for (const side of [1, -1]) {
      const s = 0.93, e = hs.edge(s);
      const y = e.y - 2.2;
      const b = hs.halfBreadth(s, y) * side;
      const x = hs.xAt(s, y);
      const ang = Math.atan2(hs.halfBreadth(s + 0.01, y) - hs.halfBreadth(s - 0.01, y), hs.xAt(s + 0.01, y) - hs.xAt(s - 0.01, y));
      st.add(mats.dark, cyl(0.75, 0.75, 0.4, 18), V(x, y, b), [Math.PI / 2, side * -ang, 0]);
      st.add(mats.chain, rbox(1.3, 2.2, 0.5, 0.2), V(x - 0.4, y - 1.4, b + side * 0.25), [0, side * -ang, 0]);
      // chain run on deck to the capstan
      const capX = 0.4 * L, deckY = hs.deckY(hs.sAtX(capX));
      const start = V(x - 1.5, e.y + 0.1, side * (e.b - 1.5));
      const end = V(capX, deckY + 0.1, side * 2.2);
      const n = Math.ceil(start.distanceTo(end) / 0.5);
      for (let i = 0; i < n; i++) {
        const t = i / n, p = start.clone().lerp(end, t);
        p.y = hs.deckY(hs.sAtX(p.x)) + 0.12;
        st.add(mats.chain, new THREE.TorusGeometry(0.2, 0.06, 5, 8), p, [i % 2 ? Math.PI / 2 : 0, Math.atan2(end.z - start.z, end.x - start.x), 0]);
      }
      st.add(mats.paint, cyl(0.9, 1.1, 0.9, 20), V(capX, deckY + 0.45, side * 2.2));
      st.add(mats.paint, cyl(0.5, 0.5, 0.3, 16), V(capX, deckY + 1.0, side * 2.2));
      st.add(mats.dark, cyl(0.45, 0.45, 0.1, 16), V(capX - 3.0, deckY + 0.05, side * 2.2));
    }
    // breakwater ahead of A turret
    const bwX = 0.36 * L, bwY = hs.deckY(hs.sAtX(bwX)), bwB = hs.edge(hs.sAtX(bwX)).b * 0.8;
    // V-shaped breakwater: two plates meeting on the centreline, swept aft to the deck edges
    for (const side of [1, -1]) {
      const dx = -5, dz = side * bwB / 2, len = Math.hypot(dx, dz);
      st.add(mats.paint, rbox(len, 1.4, 0.16, 0.04), V(bwX + dx / 2, bwY + 0.7, dz / 2), [0, Math.atan2(-dz, dx), 0]);
      for (let k = 1; k < 4; k++) st.add(mats.paint, rbox(0.12, 1.2, 0.5, 0.02), V(bwX + (dx * k) / 4 - 0.25, bwY + 0.6, (dz * k) / 4), [0, Math.atan2(-dz, dx), 0]);
    }
    // bollards (pairs) and fairleads along the deck edge
    for (const s of [0.08, 0.18, 0.5, 0.62, 0.8, 0.9]) for (const side of [1, -1]) {
      const e = hs.edge(s);
      for (const dx of [-0.45, 0.45]) {
        st.add(mats.paint, cyl(0.2, 0.22, 0.6, 12), V(e.x + dx, e.y + 0.3, side * (e.b - 1.2)));
        st.add(mats.paint, cyl(0.26, 0.26, 0.06, 12), V(e.x + dx, e.y + 0.62, side * (e.b - 1.2)));
      }
      st.add(mats.paint, rbox(0.25, 0.08, 0.8, 0.03), V(e.x, e.y + 0.04, side * (e.b - 1.2)));
    }
    // jackstaff and ensign staff
    const bow = hs.edge(0.995), stern = hs.edge(0.005);
    st.add(mats.paint, cyl(0.05, 0.08, 6, 8), V(bow.x - 0.8, bow.y + 3, 0));
    st.add(mats.paint, cyl(0.05, 0.08, 7, 8), V(stern.x + 0.8, stern.y + 3.5, 0));
    st.add(mats.flag, new THREE.PlaneGeometry(2.6, 1.6, 4, 2), V(stern.x - 0.5, stern.y + 6.0, 0), [0, 0, 0]);
    // mushroom ventilators and hatches scattered over the weather deck
    const rnd = mulberry(d.length * 13 + d.beam);
    for (let i = 0; i < 14; i++) {
      const s = 0.06 + rnd() * 0.88;
      if (s > 0.25 && s < 0.75 && rnd() < 0.6) continue;
      const e = hs.edge(s), z = (rnd() * 2 - 1) * (e.b - 2.5);
      if (Math.abs(z) < 1.0) continue;
      if (rnd() < 0.5) { st.add(mats.paint, cyl(0.25, 0.25, 0.9, 12), V(e.x, e.y + 0.45, z)); st.add(mats.paint, cyl(0.55, 0.3, 0.35, 14), V(e.x, e.y + 1.0, z)); }
      else st.add(mats.paint, rbox(1.4, 0.35, 1.0, 0.08), V(e.x, e.y + 0.17, z));
    }
  }

  superstructure(st, hs, d, a, fwdEnd, aftEnd, deckAt, halfAt) {
    const mats = this.mats, B = d.beam;
    const x0 = aftEnd, x1 = fwdEnd, S = x1 - x0;
    const y0 = deckAt((x0 + x1) / 2);
    const H1 = 2.7, H2 = 2.6;
    const w1 = Math.min(B * 0.62, halfAt((x0 + x1) / 2) * 2 - 6);
    // level 1 deckhouse
    st.add(mats.paint, extrudePlan(roundedRectPlan(x0 + 1, x1, w1 / 2, w1 / 2 - 1.5, 2.0), H1, 0.12), V(0, y0, 0));
    this.portholes(st, x0 + 3, x1 - 3, y0 + 1.5, w1 / 2 + 0.01);
    const l2x0 = x0 + 0.22 * S, l2x1 = x1 - 3;
    const w2 = w1 * 0.72;
    st.add(mats.paint, extrudePlan(roundedRectPlan(l2x0, l2x1, w2 / 2, w2 / 2 - 1.0, 1.6), H2, 0.1), V(0, y0 + H1, 0));
    this.portholes(st, l2x0 + 2, l2x1 - 2, y0 + H1 + 1.4, w2 / 2 + 0.01);
    const top2 = y0 + H1 + H2;

    // forward tower / bridge
    const tx = x1 - 0.1 * S - 6;
    let director, bridge;
    if (d.tower === 'tower') {
      // conning tower (armoured, faceted) in front of the tower block
      st.add(mats.paint, cyl(3.4, 3.6, 7.5, 10), V(tx + 7.2, top2 + 3.75 - 2.6, 0));
      st.add(mats.dark, cyl(3.42, 3.42, 0.25, 10, true), V(tx + 7.2, top2 + 3.2, 0));
      st.add(mats.paint, cyl(2.4, 2.6, 1.6, 10), V(tx + 7.2, top2 + 4.6, 0));
      let y = top2, w = w2 * 0.85, l = 13;
      for (let k = 0; k < 4; k++) {
        const h = 2.6;
        st.add(mats.paint, extrudePlan(roundedRectPlan(tx - l / 2, tx + l / 2, w / 2, w / 2 - 0.6, 1.2), h, 0.1), V(0, y, 0));
        if (k >= 2) this.windowBand(st, tx + l / 2, w, y + 1.15, k === 3);
        y += h; w *= 0.84; l *= 0.82;
      }
      // open bridge wings
      st.add(mats.paint, rbox(4, 0.2, w2 * 1.15, 0.05), V(tx + 3, y - 2.6 * 1.0, 0));
      bridge = V(tx + 4, y - 1, 0);
      // main director with rangefinder arms
      director = V(tx + 1, y + 1.4, 0);
      st.add(mats.paint, cyl(1.6, 1.8, 1.2, 16), V(tx + 1, y + 0.6, 0));
      st.add(mats.paint, rbox(4.5, 2.0, 4.0, 0.35), V(tx + 1.4, y + 2.1, 0));
      st.add(mats.paint, cyl(0.38, 0.38, 9.0, 12), V(tx + 0.6, y + 2.4, 0), [Math.PI / 2, 0, 0]);
      this.radarMattress(st, V(tx - 0.5, y + 4.0, 0), 4.2, 2.0);
      y += 3.2;
      this.mast(st, d.mast, tx - 5, top2 + 2.6 * 2, y + 14);
    } else if (d.tower === 'tripod') {
      st.add(mats.paint, cyl(2.6, 2.8, 4.5, 10), V(tx + 5, top2 + 2.25 - 1, 0));
      st.add(mats.paint, extrudePlan(roundedRectPlan(tx - 3, tx + 4, w2 * 0.38, w2 * 0.33, 1.0), 2.6, 0.1), V(0, top2, 0));
      this.windowBand(st, tx + 4, w2 * 0.66, top2 + 1.2, true);
      const topY = top2 + 26;
      this.tripod(st, V(tx - 2, top2 + 2.6, 0), topY, 5.5);
      st.add(mats.paint, extrudePlan(roundedRectPlan(tx - 5.5, tx + 1.5, 2.8, 2.5, 0.9), 3.2, 0.1), V(0, topY, 0));
      this.windowBand(st, tx + 1.5, 5.0, topY + 1.6, false);
      st.add(mats.paint, cyl(0.3, 0.3, 7, 12), V(tx - 2, topY + 3.6, 0), [Math.PI / 2, 0, 0]);
      director = V(tx - 2, topY + 3.6, 0);
      bridge = V(tx + 4, top2 + 2, 0);
      st.add(mats.paint, cyl(0.12, 0.18, 8, 8), V(tx - 2, topY + 7, 0));
    } else {
      // pagoda: stacked irregular platforms around a central trunk
      let y = top2, w = w2 * 0.8;
      st.add(mats.paint, cyl(1.8, 2.2, 34, 10), V(tx, top2 + 17, 0));
      for (let k = 0; k < 9; k++) {
        const h = k % 3 === 2 ? 2.6 : 1.4;
        const l = 9 - k * 0.55 + (k % 2) * 1.5;
        st.add(mats.paint, extrudePlan(roundedRectPlan(tx - l / 2, tx + l / 2 + (k % 3) * 0.6, w / 2, w / 2 - 0.4, 0.8), h, 0.08), V(0, y, 0));
        if (k % 3 === 2) this.windowBand(st, tx + l / 2 + (k % 3) * 0.6, w, y + 1.2, false);
        st.add(mats.paint, rbox(l + 1.6, 0.18, w + 2.5, 0.04), V(tx, y + h, 0));
        y += h + 1.6; w *= 0.9;
      }
      director = V(tx, y + 1.5, 0);
      bridge = V(tx + 4, top2 + 8, 0);
      st.add(mats.paint, rbox(5, 2.2, 4.5, 0.3), V(tx, y + 1.1, 0));
      st.add(mats.paint, cyl(0.4, 0.4, 12, 12), V(tx, y + 1.6, 0), [Math.PI / 2, 0, 0]);
      this.radarMattress(st, V(tx - 2, y + 3.8, 0), 3.5, 1.8);
    }

    // funnels
    const funnelTops = [];
    const nf = d.funnels;
    const fSpace = Math.min(15, (S * 0.45) / nf);
    const fx0 = tx - 15;
    const fH = 13 + d.power / 40000;
    for (let i = 0; i < nf; i++) {
      const fx = fx0 - i * fSpace;
      const base = top2;
      const a2 = 2.7 + d.power / 120000, b2 = 2.0 + d.power / 200000;
      const g = new THREE.CylinderGeometry(1, 1, fH, 28, 6, true);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) + fH / 2;
        p.setX(k, p.getX(k) * a2 - y * 0.1); p.setZ(k, p.getZ(k) * b2);
      }
      g.computeVertexNormals();
      const fmat = mats.funnelBuff ? this.buffMaterial() : mats.paint;
      st.add(fmat, g, V(fx, base + fH / 2, 0));
      // black soot cap + grille
      const cap = new THREE.CylinderGeometry(1, 1, 1.6, 28, 1, true);
      const cp = cap.attributes.position;
      for (let k = 0; k < cp.count; k++) { const y = cp.getY(k) + 0.8 + fH - 1.6; cp.setX(k, cp.getX(k) * a2 * 1.01 - y * 0.1); cp.setZ(k, cp.getZ(k) * b2 * 1.01); }
      cap.computeVertexNormals();
      st.add(mats.soot, cap, V(fx, base, 0));
      const lid = new THREE.CircleGeometry(1, 28);
      lid.rotateX(-Math.PI / 2);
      lid.scale(a2 * 0.98, 1, b2 * 0.98);
      st.add(mats.soot, lid, V(fx - (fH - 0.4) * 0.1, base + fH - 0.4, 0));
      for (let k = -2; k <= 2; k++) st.add(mats.soot, rbox(a2 * 1.8, 0.12, 0.12, 0.02), V(fx - fH * 0.1, base + fH - 0.15, k * b2 * 0.33));
      // steam pipes aft and a searchlight platform
      for (const z of [-0.5, 0.5]) st.add(mats.paint, cyl(0.18, 0.18, fH * 0.95, 8), V(fx - a2 - 0.3 - fH * 0.05, base + fH * 0.48, z * b2), [0, 0, 0.1]);
      st.add(mats.paint, rbox(a2 * 2 + 2, 0.18, b2 * 2 + 3, 0.05), V(fx - fH * 0.05, base + fH * 0.55, 0));
      for (const z of [-1, 1]) {
        st.add(mats.paint, cyl(0.6, 0.6, 0.9, 14), V(fx - fH * 0.05, base + fH * 0.55 + 0.6, z * (b2 + 1.0)), [0, 0, Math.PI / 2]);
        st.add(mats.glass, cyl(0.5, 0.5, 0.05, 14), V(fx - fH * 0.05 + 0.47, base + fH * 0.55 + 0.6, z * (b2 + 1.0)), [0, 0, Math.PI / 2]);
      }
      funnelTops.push(V(fx - fH * 0.1, base + fH, 0));
    }

    // aft superstructure with secondary director and mainmast
    const ax = x0 + 0.16 * S;
    st.add(mats.paint, extrudePlan(roundedRectPlan(ax - 5, ax + 5, w2 * 0.4, w2 * 0.38, 1.0), 2.6, 0.1), V(0, y0 + H1, 0));
    st.add(mats.paint, cyl(1.4, 1.6, 1.2, 14), V(ax, y0 + H1 + 3.2, 0));
    st.add(mats.paint, rbox(3.6, 1.6, 3.2, 0.3), V(ax + 0.3, y0 + H1 + 4.5, 0));
    this.mast(st, 'pole', ax - 4, y0 + H1 + 2.6, y0 + 32);

    // boats in chocks on the level 1 roof, with a boat crane
    const bx0 = fx0 - (nf - 1) * fSpace - 8, bx1 = l2x0 + 2;
    if (bx0 - bx1 > 8) {
      for (const z of [-1, 1]) {
        const len = Math.min(11, bx0 - bx1 - 2);
        this.boat(st, V((bx0 + bx1) / 2, y0 + H1 + 0.5, z * (w1 / 2 - 2.0)), len);
      }
      st.add(mats.paint, cyl(0.35, 0.45, 9, 12), V(bx0 + 2, y0 + H1 + 4.5, 0));
      st.add(mats.paint, cyl(0.2, 0.25, 12, 8), V(bx0 - 2.5, y0 + H1 + 8.2, 0), [0, 0, 1.1]);
    }
    return { x0, x1, y0, top2, w1, w2, director, bridge, funnelTops };
  }

  buffMaterial() {
    if (!this._buff) { this._buff = this.mats.paint.clone(); this._buff.name = 'ship-buff'; this._buff.userData = { u: { ...this.mats.paint.userData.u, uPaint: { value: new THREE.Color().setRGB(0.62, 0.48, 0.28, THREE.SRGBColorSpace) } } }; this._buff.onBeforeCompile = this.mats.paint.onBeforeCompile; }
    return this._buff;
  }

  portholes(st, xa, xb, y, z) {
    const mats = this.mats;
    for (let x = xa; x < xb; x += 2.4) for (const s of [1, -1]) {
      st.add(mats.brass, new THREE.TorusGeometry(0.2, 0.035, 6, 14), V(x, y, s * z), [0, Math.PI / 2, 0]);
      st.add(mats.glass, new THREE.CircleGeometry(0.19, 12), V(x, y, s * (z - 0.01)), [0, s > 0 ? 0 : Math.PI, 0]);
    }
  }

  windowBand(st, xFront, w, y, wrap) {
    const mats = this.mats;
    // recessed glazing with frames/mullions on the front face (and sides if wrap)
    st.add(mats.glass, new THREE.BoxGeometry(0.06, 0.9, w * 0.86), V(xFront + 0.02, y, 0));
    st.add(mats.paint, new THREE.BoxGeometry(0.18, 0.1, w * 0.88), V(xFront + 0.05, y + 0.5, 0));
    st.add(mats.paint, new THREE.BoxGeometry(0.22, 0.12, w * 0.9), V(xFront + 0.08, y - 0.5, 0));
    for (let z = -w * 0.42; z <= w * 0.42 + 0.01; z += 0.95) st.add(mats.paint, new THREE.BoxGeometry(0.12, 0.9, 0.08), V(xFront + 0.06, y, z));
    if (wrap) for (const s of [1, -1]) {
      st.add(mats.glass, new THREE.BoxGeometry(3.2, 0.9, 0.06), V(xFront - 2.0, y, s * (w / 2 - 0.58)));
      for (let k = 0; k < 4; k++) st.add(mats.paint, new THREE.BoxGeometry(0.08, 0.9, 0.12), V(xFront - 0.5 - k * 1.0, y, s * (w / 2 - 0.55)));
    }
  }

  radarMattress(st, pos, w, h) {
    const mats = this.mats;
    for (let k = 0; k <= 6; k++) st.add(mats.paint, new THREE.BoxGeometry(0.06, h, 0.06), V(pos.x, pos.y, pos.z - w / 2 + (k * w) / 6));
    for (let k = 0; k <= 4; k++) st.add(mats.paint, new THREE.BoxGeometry(0.06, 0.06, w), V(pos.x, pos.y - h / 2 + (k * h) / 4, pos.z));
    st.add(mats.paint, cyl(0.12, 0.12, 1.6, 8), V(pos.x - 0.3, pos.y - h / 2 - 0.8, pos.z));
  }

  tripod(st, base, topY, spread) {
    const mats = this.mats;
    const top = V(base.x, topY, 0);
    const legs = [V(base.x, base.y, 0), V(base.x - spread, base.y - 2.6, spread * 0.55), V(base.x - spread, base.y - 2.6, -spread * 0.55)];
    for (const l of legs) {
      const len = l.distanceTo(top);
      const g = cyl(0.42, 0.55, len, 12);
      const dir = top.clone().sub(l).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      st.add(mats.paint, g, l.clone().add(top).multiplyScalar(0.5), [e.x, e.y, e.z]);
    }
  }

  mast(st, type, x, y0, yTop) {
    const mats = this.mats;
    if (type === 'tripod') this.tripod(st, V(x, y0, 0), yTop - 6, 3.2);
    else st.add(mats.paint, cyl(0.35, 0.55, yTop - 6 - y0, 12), V(x, (y0 + yTop - 6) / 2, 0));
    st.add(mats.paint, cyl(0.12, 0.25, 7, 8), V(x, yTop - 3, 0));
    st.add(mats.paint, cyl(0.07, 0.07, 9, 6), V(x, yTop - 6, 0), [Math.PI / 2, 0, 0]);
    st.add(mats.paint, rbox(1.6, 0.15, 1.6, 0.04), V(x, yTop - 7.5, 0));
    st.add(mats.paint, cyl(0.6, 0.6, 0.12, 12), V(x, yTop - 1.2, 0));
  }

  boat(st, pos, len) {
    const mats = this.mats;
    const prof = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push([Math.sin(t * Math.PI) ** 0.6 * 1.2 + 0.01, (t - 0.5) * len]); }
    const g = lathe(prof, 14);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 0.7, 1);
    // cut the top: flatten upper half for the gunwale
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.15) p.setY(i, 0.15);
    g.computeVertexNormals();
    st.add(mats.paint, g, pos.clone().add(V(0, 0.75, 0)));
    st.add(mats.wood, rbox(len * 0.8, 0.08, 1.6, 0.03), pos.clone().add(V(0, 0.92, 0)));
    st.add(mats.paint, rbox(0.4, 0.8, 2.6, 0.05), pos.clone().add(V(len * 0.3, 0.1, 0)));
    st.add(mats.paint, rbox(0.4, 0.8, 2.6, 0.05), pos.clone().add(V(-len * 0.3, 0.1, 0)));
  }

  antiAir(st, d, sup, deckAt, halfAt, turrets, td) {
    const mats = this.mats;
    if (!d.aa) return;
    const quad = (pos, yaw) => {
      st.add(mats.paint, cyl(1.7, 1.7, 1.0, 18, true), pos.clone().add(V(0, 0.5, 0)));
      st.add(mats.dark, cyl(1.69, 1.69, 0.05, 18), pos.clone().add(V(0, 0.03, 0)));
      st.add(mats.paint, rbox(1.4, 0.7, 1.6, 0.1), pos.clone().add(V(0, 1.0, 0)), [0, yaw, 0]);
      for (const z of [-0.5, -0.2, 0.2, 0.5]) {
        const dir = V(Math.cos(yaw), 0, -Math.sin(yaw));
        const off = V(-Math.sin(yaw) * z, 0, -Math.cos(yaw) * z);
        st.add(mats.dark, cyl(0.05, 0.06, 2.6, 6), pos.clone().add(V(0, 1.6, 0)).add(off).add(dir.clone().multiplyScalar(1.1)), [0, yaw, Math.PI / 2 - 0.5]);
      }
    };
    const n = d.aa * 2;
    for (let i = 0; i < n; i++) {
      const x = sup.x0 + 6 + ((sup.x1 - sup.x0 - 12) * (i + 0.5)) / n;
      for (const s of [1, -1]) quad(V(x, sup.top2, s * (sup.w2 / 2 + 0.5 > sup.w1 / 2 - 1.8 ? sup.w1 / 2 - 1.8 : sup.w2 / 2 + 1.0)), s > 0 ? -1.2 : 1.2);
    }
    if (d.aa >= 2) for (const t of turrets) {
      const p = t.group.position;
      quad(V(p.x - (t.restYaw ? -1 : 1) * td.L * 0.25, p.y + td.H, 0), t.restYaw);
    }
    // 20 mm singles along the deck edges
    for (let i = 0; i < d.aa * 6; i++) {
      const x = sup.x0 + ((sup.x1 - sup.x0) * i) / (d.aa * 6);
      for (const s of [1, -1]) {
        const z = s * (halfAt(x) - 1.5), y = deckAt(x);
        st.add(mats.paint, cyl(0.12, 0.2, 1.1, 8), V(x, y + 0.55, z));
        st.add(mats.paint, rbox(0.06, 0.7, 0.9, 0.02), V(x + 0.3, y + 1.3, z));
        st.add(mats.dark, cyl(0.04, 0.04, 2.0, 6), V(x + 0.8, y + 1.4, z), [0, 0, Math.PI / 2 - 0.4]);
      }
    }
  }
}


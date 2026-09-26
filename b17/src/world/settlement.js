// Places buildings, streets and target structures across the location.
import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/noise.js';
import { TOWN, VILLAGES, TARGETS, FLAK_SITES, riverDist, RIVER_W, WATER_Y, smoothLine, nextFrame } from './layout.js';
import { makeHouse, makeBarn, makeChurch } from './archetypes.js';
import {
  makeSawtoothHall, makeBlock, makeChimney, makeWaterTower, makeShed, makeTank, makeBoxcar, makeOpenWagon,
  makeTankWagon, makeLocomotive, makeFlakEmplacement, makeTrussBridge, makeArchBridge,
} from './industrial.js';

const PLASTER = [[0.92, 0.86, 0.74], [0.95, 0.82, 0.6], [0.88, 0.76, 0.64], [0.96, 0.94, 0.9], [0.8, 0.79, 0.76], [0.93, 0.78, 0.68], [0.78, 0.75, 0.66], [0.9, 0.85, 0.7], [0.85, 0.8, 0.8]];
const ROOFS = [[1, 1, 1], [0.9, 0.85, 0.82], [0.8, 0.75, 0.74], [1.05, 0.95, 0.85], [0.7, 0.66, 0.66], [0.95, 0.8, 0.72]];
const SHUTTERS = [[0.55, 0.9, 0.62], [0.9, 0.62, 0.42], [0.6, 0.72, 0.9], [0.9, 0.9, 0.9]];

function col(a, v = 0) { return new THREE.Color(a[0] * (1 + v), a[1] * (1 + v), a[2] * (1 + v)); }

// oriented rectangle overlap (separating axis) for placement
function rectsOverlap(a, b) {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang), az = Math.sin(ang);
    const proj = (r) => {
      const c = r.x * ax + r.z * az;
      const ca = Math.abs(Math.cos(r.rot - ang)), sa = Math.abs(Math.sin(r.rot - ang));
      const e = (r.w / 2) * ca + (r.d / 2) * sa;
      return [c - e, c + e];
    };
    const [a0, a1] = proj(a), [b0, b1] = proj(b);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best) best = d;
  }
  return best;
}

export class Settlement {
  constructor(buildings, roads, hf) {
    this.B = buildings;
    this.roads = roads;
    this.hf = hf;
    this.occ = [];
    this.occGrid = new Map();
    this.rnd = mulberry32(1014);
    this.targets = {};
    for (const t of TARGETS) this.targets[t.id] = { ...t, records: [], total: 0 };
    this.flakGuns = [];
    this.fireSpots = [];
    this.gardens = [];
    this.propSpots = [];
    this.segGrid = new Map();
    for (const l of hf.lines) this._addLine(l);
  }

  _addLine(l) {
    const C = 40;
    for (let i = 0; i < l.pts.length - 1; i++) {
      const a = l.pts[i], b = l.pts[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - 60) / C), x1 = Math.floor((Math.max(a.x, b.x) + 60) / C);
      const z0 = Math.floor((Math.min(a.z, b.z) - 60) / C), z1 = Math.floor((Math.max(a.z, b.z) + 60) / C);
      for (let j = z0; j <= z1; j++) for (let k = x0; k <= x1; k++) {
        const key = k + ',' + j;
        let arr = this.segGrid.get(key);
        if (!arr) this.segGrid.set(key, arr = []);
        arr.push({ l, a, b });
      }
    }
  }

  // ------------------------------------------------------------- archetypes
  defineTypes() {
    const B = this.B;
    const houseDefs = [
      ['h_town_a', { w: 10, d: 12, floors: 3, pitch: 52, dormers: true, stringCourse: true, shutterChance: 0.2 }],
      ['h_town_b', { w: 12.5, d: 12, floors: 4, pitch: 50, dormers: true, stringCourse: true, shutterChance: 0.1 }],
      ['h_town_c', { w: 8.5, d: 11, floors: 3, pitch: 55, dormers: false, shutterChance: 0.4 }],
      ['h_town_d', { w: 15, d: 13, floors: 3, pitch: 48, dormers: true, stringCourse: true, shutterChance: 0.15, slate: true }],
      ['h_brick', { w: 11, d: 11, floors: 3, pitch: 45, brick: true, shutterChance: 0 }],
      ['h_small', { w: 8, d: 9, floors: 2, pitch: 50, shutterChance: 0.6, blindGables: true }],
      ['h_small_b', { w: 9.5, d: 8.5, floors: 2, pitch: 47, shutterChance: 0.5, dormers: true }],
      ['h_farm', { w: 11, d: 9.5, floors: 2, pitch: 50, shutterChance: 0.7, blindGables: true }],
    ];
    houseDefs.forEach(([n, p], i) => B.defineType(n, makeHouse(100 + i * 7, p), { hp: 1 }));
    B.defineType('barn_a', makeBarn(11, { w: 16, d: 9 }), { hp: 1 });
    B.defineType('barn_b', makeBarn(12, { w: 20, d: 10.5 }), { hp: 1 });
    B.defineType('barn_c', makeBarn(13, { w: 11, d: 8 }), { hp: 1 });
    B.defineType('church_town', makeChurch(21, { w: 36, d: 15, nave: 13, tower: 44 }), { hp: 3 });
    B.defineType('church_village', makeChurch(22, { w: 20, d: 10, nave: 8, tower: 24 }), { hp: 2 });
    // industrial
    B.defineType('hall_150x60', makeSawtoothHall(31, { l: 150, w: 60 }), { hp: 4 });
    B.defineType('hall_120x50', makeSawtoothHall(32, { l: 120, w: 50 }), { hp: 3.5 });
    B.defineType('hall_100x70', makeSawtoothHall(33, { l: 100, w: 70 }), { hp: 3.5 });
    B.defineType('hall_90x40', makeSawtoothHall(34, { l: 90, w: 40, eave: 7.5 }), { hp: 3 });
    B.defineType('block_80', makeBlock(35, { l: 80, d: 16, floors: 4 }), { hp: 3 });
    B.defineType('block_60', makeBlock(36, { l: 60, d: 18, floors: 3 }), { hp: 2.5 });
    B.defineType('chimney_55', makeChimney(37, { h: 55 }), { hp: 1.5 });
    B.defineType('chimney_42', makeChimney(38, { h: 42 }), { hp: 1.5 });
    B.defineType('watertower', makeWaterTower(39), { hp: 1.5 });
    B.defineType('shed_40', makeShed(40, { l: 40, d: 15, eave: 6 }), { hp: 1.5 });
    B.defineType('shed_brick', makeShed(41, { l: 36, d: 20, eave: 7, brick: true }), { hp: 2 });
    B.defineType('shed_small', makeShed(42, { l: 14, d: 8, eave: 3.5 }), { hp: 1 });
    B.defineType('goods_shed', makeShed(43, { l: 130, d: 18, eave: 6.5, brick: true }), { hp: 3 });
    B.defineType('engine_shed', makeShed(44, { l: 80, d: 24, eave: 8, brick: true }), { hp: 3 });
    B.defineType('tank_10', makeTank(45, { r: 10, h: 11 }), { hp: 1.2 });
    B.defineType('tank_8', makeTank(46, { r: 8, h: 9 }), { hp: 1.1 });
    B.defineType('boxcar', makeBoxcar(47), { hp: 0.6 });
    B.defineType('openwagon', makeOpenWagon(48), { hp: 0.6 });
    B.defineType('tankwagon', makeTankWagon(49), { hp: 0.5 });
    B.defineType('loco', makeLocomotive(50), { hp: 1 });
    B.defineType('flak_pit', makeFlakEmplacement(51), { hp: 1, cast: true });
  }

  // ------------------------------------------------------------- placement helpers
  _free(rect, ignoreLine, skipStreets = false) {
    if (riverDist(rect.x, rect.z) < RIVER_W / 2 + 12 + Math.max(rect.w, rect.d) / 2) return false;
    const rad = Math.hypot(rect.w, rect.d) / 2;
    for (const t of TARGETS) if (Math.hypot(rect.x - t.x, rect.z - t.z) < t.r + 25 + rad) return false;
    for (const f of FLAK_SITES) if (Math.hypot(rect.x - f.x, rect.z - f.z) < 50 + rad) return false;
    const segs = this.segGrid.get(Math.floor(rect.x / 40) + ',' + Math.floor(rect.z / 40));
    if (segs) for (const { l, a, b } of segs) {
      if (l === ignoreLine || (skipStreets && l.kind === 'street')) continue;
      const clear = (l.kind === 'rail' ? (l.main ? 40 : 9) : l.kind === 'street' ? l.w / 2 + 0.8 : l.w / 2 + 3.5) + rad * (l.kind === 'street' ? 0.62 : 0.8);
      const dx = b.x - a.x, dz = b.z - a.z;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((rect.x - a.x) * dx + (rect.z - a.z) * dz) / L2));
      if (Math.hypot(rect.x - a.x - dx * t, rect.z - a.z - dz * t) < clear) return false;
    }
    const k0 = Math.floor(rect.x / 50), k1 = Math.floor(rect.z / 50);
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const list = this.occGrid.get(`${k0 + i}_${k1 + j}`);
      if (list) for (const o of list) if (rectsOverlap(rect, o)) return false;
    }
    return true;
  }

  _occupy(rect) {
    this.occ.push(rect);
    const k = `${Math.floor(rect.x / 50)}_${Math.floor(rect.z / 50)}`;
    if (!this.occGrid.has(k)) this.occGrid.set(k, []);
    this.occGrid.get(k).push(rect);
  }

  _groundY(x, z, w, d, rot) {
    // lowest corner so the plinth never floats
    const c = Math.cos(rot), s = Math.sin(rot);
    let lo = Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const lx = a * w / 2, lz = b * d / 2;
      lo = Math.min(lo, this.hf.height(x + lx * c + lz * s, z - lx * s + lz * c));
    }
    return lo;
  }

  put(type, x, z, rot, rec = {}) {
    const t = this.B.types.get(type);
    const rect = { x, z, w: t.w + (rec.pad ?? 0), d: t.d + (rec.pad ?? 0), rot: -rot };
    if (!rec.force && !this._free(rect, rec.ignoreLine, rec.skipStreets)) return null;
    this._occupy(rect);
    const y = rec.y ?? this._groundY(x, z, t.w, t.d, rot);
    const r = this.B.place(type, x, y, z, rot, rec);
    if (rec.target) {
      const tg = this.targets[rec.target];
      tg.records.push(r);
      tg.total += r.weight;
    }
    return r;
  }

  // ------------------------------------------------------------- town
  buildTown() {
    const rnd = this.rnd;
    const C = TOWN;
    // irregular convex boundary (old town + 19th-century extension), subdivided into blocks
    const boundary = [];
    const rot = 0.35;
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      const rx = C.r * 1.02, rz = C.r * 0.78;
      const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
      boundary.push({ x: C.x + x * Math.cos(rot) - z * Math.sin(rot), z: C.z + x * Math.sin(rot) + z * Math.cos(rot) });
    }
    const queue = [{ poly: boundary, depth: 0 }];
    const blocks = [], streets = [];
    while (queue.length) {
      const it = queue.shift();
      const area = polyArea(it.poly);
      const cen = centroid(it.poly);
      const dc = Math.hypot(cen.x - C.x, cen.z - C.z) / C.r;
      const minA = 2600 + 9000 * smoothstep(0.25, 0.95, dc);
      if (area < minA * 2 || it.depth > 11) { blocks.push({ poly: it.poly, dc, cen }); continue; }
      // split across the longest extent
      let best = 0, dir = { x: 1, z: 0 };
      for (let i = 0; i < it.poly.length; i++) for (let j = i + 1; j < it.poly.length; j++) {
        const dx = it.poly[j].x - it.poly[i].x, dz = it.poly[j].z - it.poly[i].z, L = dx * dx + dz * dz;
        if (L > best) { best = L; dir = { x: dx, z: dz }; }
      }
      const L = Math.sqrt(best);
      const ang = Math.atan2(dir.z, dir.x) + Math.PI / 2 + (rnd() - 0.5) * 0.5;
      const t = (rnd() - 0.5) * 0.3;
      const pt = { x: cen.x + dir.x / L * t * L * 0.5, z: cen.z + dir.z / L * t * L * 0.5 };
      const res = splitConvex(it.poly, pt, { x: Math.cos(ang), z: Math.sin(ang) });
      if (!res) { blocks.push({ poly: it.poly, dc, cen }); continue; }
      streets.push({ a: res.seg[0], b: res.seg[1], w: it.depth < 2 ? 9 : it.depth < 4 ? 7.5 : 6 });
      queue.push({ poly: res.a, depth: it.depth + 1 }, { poly: res.b, depth: it.depth + 1 });
    }
    // ring street along the old boundary
    for (let i = 0; i < boundary.length; i++) streets.push({ a: boundary[i], b: boundary[(i + 1) % boundary.length], w: 8 });
    // market square = block nearest the centre
    let market = blocks[0];
    for (const b of blocks) if (Math.hypot(b.cen.x - C.x, b.cen.z - C.z) < Math.hypot(market.cen.x - C.x, market.cen.z - C.z)) market = b;
    market.market = true;
    // streets -> ribbons (skip parts near the river)
    const streetLines = [];
    for (const st of streets) {
      const pts = [];
      const n = Math.max(2, Math.ceil(Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z) / 8));
      let cur = [];
      for (let k = 0; k <= n; k++) {
        const p = { x: st.a.x + (st.b.x - st.a.x) * k / n, z: st.a.z + (st.b.z - st.a.z) * k / n };
        if (riverDist(p.x, p.z) < RIVER_W / 2 + 22) { if (cur.length > 1) pts.push(cur); cur = []; } else cur.push(p);
      }
      if (cur.length > 1) pts.push(cur);
      for (const q of pts) {
        const line = { kind: 'street', w: st.w, pts: q };
        this._addLine(line);
        this.roads.addStreet(q, st.w);
        streetLines.push(line);
      }
    }
    // plaza + churches
    this.roads.addPolygon(insetConvex(market.poly, 3) || market.poly);
    this._occupyPoly(market.poly);
    const mc = market.cen;
    this.put('church_town', mc.x, mc.z, rot, { force: true, tint: new THREE.Color(1, 1, 1), roofTint: col([0.8, 0.8, 0.85]) });
    // fill blocks: perimeter development
    for (const b of blocks) {
      if (b.market) continue;
      const garden = rnd() < 0.07 && b.dc > 0.3;
      const inset = insetConvex(b.poly, 4.4);
      if (!inset) continue;
      if (garden) { this.gardens.push({ poly: inset, cen: b.cen }); continue; }
      this._fillBlock(inset, b.dc, b.cen);
    }
    // looser development along the real roads leaving town
    for (const l of this.hf.lines) {
      if (l.kind === 'rail') continue;
      const band = l.pts.filter(p => { const d = Math.hypot(p.x - C.x, p.z - C.z) / C.r; return d > 0.7 && d < 1.7; });
      if (band.length > 3) this._lineHouses(band, l.w + 2, (x, z) => Math.hypot(x - C.x, z - C.z) / C.r * 0.8, l);
    }
    // stone arch road bridge (Maxbrücke)
    this._roadBridge();
  }

  _occupyPoly(poly) {
    const c = centroid(poly);
    let r = 0; for (const p of poly) r = Math.max(r, Math.hypot(p.x - c.x, p.z - c.z));
    this._occupy({ x: c.x, z: c.z, w: r * 1.5, d: r * 1.5, rot: 0 });
  }

  _fillBlock(poly, dc, cen) {
    const rnd = this.rnd;
    const core = dc < 0.5;
    const edges = poly.length;
    for (let e = 0; e < edges; e++) {
      const a = poly[e], b = poly[(e + 1) % edges];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 7) continue;
      const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
      // outward normal (away from block centre)
      let nx = dz, nz = -dx;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if ((mx - cen.x) * nx + (mz - cen.z) * nz < 0) { nx = -nx; nz = -nz; }
      let s = core ? 0.5 : 2 + rnd() * 5;
      while (s < L - 6) {
        const type = core
          ? pick(rnd, ['h_town_a', 'h_town_b', 'h_town_c', 'h_town_a', 'h_brick', 'h_town_c', 'h_town_d'])
          : pick(rnd, ['h_small', 'h_small_b', 'h_town_c', 'h_farm', 'h_town_a', 'h_brick']);
        const t = this.B.types.get(type);
        const gable = core ? rnd() < 0.35 : rnd() < 0.55;
        const fw = gable ? t.d : t.w, fd = gable ? t.w : t.d;
        if (s + fw > L + 1) break;
        const setback = core ? 0 : 1.5 + rnd() * 4;
        const px = a.x + dx * (s + fw / 2) - nx * (fd / 2 + setback), pz = a.z + dz * (s + fw / 2) - nz * (fd / 2 + setback);
        let rot = Math.atan2(nx, nz);
        if (gable) rot += Math.PI / 2 * (rnd() < 0.5 ? 1 : -1);
        const r = this.put(type, px, pz, rot, {
          skipStreets: true, tint: col(pick(rnd, PLASTER), (rnd() - 0.5) * 0.12), roofTint: col(pick(rnd, ROOFS), (rnd() - 0.5) * 0.12), tint2: col(pick(rnd, SHUTTERS)),
          pad: core ? 0.05 : 2.5,
        });
        if (r) {
          if (rnd() < 0.08) this.propSpots.push({ x: px - nx * fd, z: pz - nz * fd, r: 6, kind: 'yard', n: 5 });
          s += fw + (core ? rnd() * 0.3 : 3 + rnd() * 9);
        } else s += 2.5;
      }
    }
    // rear courtyard buildings / workshops
    const n = core ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const j = { x: cen.x + (rnd() - 0.5) * 20, z: cen.z + (rnd() - 0.5) * 20 };
      this.put(rnd() < 0.5 ? 'shed_small' : 'barn_c', j.x, j.z, rnd() * Math.PI, { skipStreets: true, tint: col(pick(rnd, PLASTER)), roofTint: col(pick(rnd, ROOFS)), pad: 1 });
    }
  }

  _lineHouses(pts, streetW, densityFn, ignoreLine = null) {
    const rnd = this.rnd;
    const sm = smoothLine(pts, 2);
    for (const side of [-1, 1]) {
      let s = rnd() * 4;
      let acc = 0;
      for (let i = 1; i < sm.length; i++) {
        const a = sm[i - 1], b = sm[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        acc += seg;
        if (acc < s) continue;
        const dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
        const dn = densityFn(b.x, b.z);
        if (dn > 1.0) { s = acc + 10; continue; }
        const core = dn < 0.45;
        const type = core ? pick(rnd, ['h_town_a', 'h_town_b', 'h_town_c', 'h_town_a', 'h_brick', 'h_town_c']) : pick(rnd, ['h_small', 'h_small_b', 'h_town_c', 'h_farm', 'h_small']);
        const t = this.B.types.get(type);
        const gableToStreet = !core && rnd() < 0.55 || core && rnd() < 0.3;
        const fw = gableToStreet ? t.d : t.w, fd = gableToStreet ? t.w : t.d;
        const off = streetW / 2 + 1.6 + (core ? 0 : 2 + rnd() * 5) + fd / 2;
        const cx = b.x + dx * fw / 2 + dz * off * side;
        const cz = b.z + dz * fw / 2 - dx * off * side;
        // face the street: local +z towards street
        // local +z (front facade) points from the building to the street
        let rot = Math.atan2(b.x - cx, b.z - cz);
        if (gableToStreet) rot += Math.PI / 2;
        const r = this.put(type, cx, cz, rot, {
          ignoreLine, tint: col(pick(rnd, PLASTER), (rnd() - 0.5) * 0.12), roofTint: col(pick(rnd, ROOFS), (rnd() - 0.5) * 0.1), tint2: col(pick(rnd, SHUTTERS)),
          pad: core ? 0.2 : 3,
        });
        if (r) {
          s = acc + fw + (core ? rnd() * 0.6 : 4 + rnd() * 10);
          // back-yard shed or small barn
          if (!core && rnd() < 0.35) {
            const bo = off + fd / 2 + 7;
            this.put(rnd() < 0.5 ? 'shed_small' : 'barn_c', b.x + dz * bo * side, b.z - dx * bo * side, rot + (rnd() < 0.5 ? Math.PI / 2 : 0), { roofTint: col(pick(rnd, ROOFS)), tint: col(pick(rnd, PLASTER)), pad: 1 });
          }
          if (rnd() < 0.2) this.propSpots.push({ x: cx, z: cz, r: 8, kind: 'yard' });
        } else s = acc + 3;
      }
    }
  }

  _roadBridge() {
    const line = this.hf.lines.find(l => l.kind === 'asphalt' && l.pts.some(p => p.bridge) && Math.abs(l.pts.find(p => p.bridge).x - TOWN.x) < 500);
    if (!line) return;
    const bp = line.pts.filter(p => p.bridge);
    const a = bp[0], b = bp[bp.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 30;
    const rot = Math.atan2(-(b.z - a.z), b.x - a.x);
    this.B.defineType('arch_bridge', makeArchBridge(len, (a.y - WATER_Y) + 4, 10), { hp: 99 });
    this.put('arch_bridge', (a.x + b.x) / 2, (a.z + b.z) / 2, rot, { force: true, y: a.y - 0.05 });
  }

  // ------------------------------------------------------------- villages
  buildVillages() {
    const rnd = this.rnd;
    for (const v of VILLAGES) {
      const a = rnd() * Math.PI;
      const main = [];
      for (let t = -1; t <= 1.001; t += 0.1) main.push({ x: v.x + Math.cos(a) * v.r * t + Math.sin(t * 3) * 15, z: v.z + Math.sin(a) * v.r * t + Math.cos(t * 2) * 12 });
      const cross = [];
      const b = a + Math.PI / 2 + (rnd() - 0.5) * 0.6;
      for (let t = -0.7; t <= 0.7; t += 0.1) cross.push({ x: v.x + Math.cos(b) * v.r * t, z: v.z + Math.sin(b) * v.r * t });
      this.put('church_village', v.x + Math.cos(b) * 28, v.z + Math.sin(b) * 28, -a, { tint: col(PLASTER[3]) });
      const sts = [main, cross].map(pts => ({ kind: 'street', w: 5.5, pts: smoothLine(pts, 8) }));
      for (const st of sts) { this._addLine(st); this.roads.addStreet(st.pts, 5.5, true); }
      for (const st of sts) this._villageRow(st.pts, v, st);
    }
  }

  _villageRow(pts, v, line) {
    const rnd = this.rnd;
    const sm = smoothLine(pts, 2);
    for (const side of [-1, 1]) {
      let s = rnd() * 6, acc = 0;
      for (let i = 1; i < sm.length; i++) {
        const a = sm[i - 1], b = sm[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        acc += seg;
        if (acc < s) continue;
        const dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
        const barn = rnd() < 0.4;
        const type = barn ? pick(rnd, ['barn_a', 'barn_b', 'barn_c']) : pick(rnd, ['h_farm', 'h_small', 'h_small_b', 'h_farm']);
        const t = this.B.types.get(type);
        const gable = rnd() < 0.6;
        const fw = gable ? t.d : t.w, fd = gable ? t.w : t.d;
        const off = 2.75 + 2.5 + rnd() * 4 + fd / 2;
        const cx = b.x + dx * fw / 2 + dz * off * side, cz = b.z + dz * fw / 2 - dx * off * side;
        let rot = Math.atan2(b.x - cx, b.z - cz);
        if (gable) rot += Math.PI / 2;
        const r = this.put(type, cx, cz, rot, { ignoreLine: line, tint: col(pick(rnd, PLASTER), (rnd() - 0.5) * 0.15), roofTint: col(pick(rnd, ROOFS), (rnd() - 0.5) * 0.12), tint2: col(pick(rnd, SHUTTERS)), pad: 2 });
        if (r) { s = acc + fw + 5 + rnd() * 12; if (rnd() < 0.3) this.propSpots.push({ x: cx, z: cz, r: 10, kind: 'farm' }); }
        else s = acc + 4;
      }
    }
  }

  // ------------------------------------------------------------- targets
  buildTargets() {
    this._works();
    this._yard();
    this._railBridge();
    this._depot();
    this._flak();
  }

  _site(cx, cz, rot, list, target) {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [type, lx, lz, lr, weight] of list) {
      const x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
      const r = this.put(type, x, z, rot + (lr || 0), { force: true, target, weight: weight ?? 1, tint: col([0.9, 0.9, 0.88]) });
      if (r) this.fireSpots.push(r);
    }
  }

  _works() {
    const T = TARGETS.find(t => t.id === 'works');
    const rot = -0.32;
    this._site(T.x, T.z, rot, [
      ['hall_150x60', -70, -60, 0, 4], ['hall_120x50', 95, -75, 0, 3.5], ['hall_100x70', -85, 50, 0, 3.5], ['hall_90x40', 80, 45, 0, 3],
      ['hall_90x40', 80, 105, 0, 3], ['block_80', -20, 165, 0, 2.5], ['block_60', -190, -10, Math.PI / 2, 2],
      ['shed_brick', 205, 40, 0, 1.5], ['chimney_55', 205, 80, 0, 1], ['chimney_42', -170, -140, 0, 1], ['watertower', 190, -150, 0, 1],
      ['shed_40', -10, -150, 0, 1], ['shed_40', 70, -150, 0, 1], ['shed_small', 150, 150, 0, 0.5], ['shed_small', -120, 130, 0, 0.5],
    ], 'works');
    this.propSpots.push({ x: T.x, z: T.z, r: 200, kind: 'factory', n: 60 });
  }

  _yard() {
    const T = TARGETS.find(t => t.id === 'yard');
    const tracks = this.roads.yardTracks;
    const rnd = this.rnd;
    // buildings north/south of the fan
    const main = this.hf.lines.find(l => l.kind === 'rail' && l.main);
    const near = main.pts.reduce((b, p) => Math.abs(p.x - T.x) < Math.abs(b.x - T.x) ? p : b);
    const ang = Math.atan2(-(main.pts[main.pts.indexOf(near) + 1].z - near.z), main.pts[main.pts.indexOf(near) + 1].x - near.x);
    const nx = Math.sin(ang), nz = Math.cos(ang);
    const at = (dx, off) => ({ x: near.x + Math.cos(ang) * dx + nx * off, z: near.z - Math.sin(ang) * dx + nz * off });
    let p = at(-150, 50); this.put('goods_shed', p.x, p.z, ang, { force: true, target: 'yard', weight: 3 });
    p = at(520, -52); this.put('engine_shed', p.x, p.z, ang, { force: true, target: 'yard', weight: 2 });
    p = at(-620, 42); this.put('h_brick', p.x, p.z, ang, { force: true, target: 'yard', weight: 0.5, tint: col([1, 1, 1]) });
    p = at(760, 44); this.put('h_small', p.x, p.z, ang + Math.PI, { force: true, target: 'yard', weight: 0.5, tint: col(PLASTER[4]) });
    p = at(300, -50); this.put('watertower', p.x, p.z, 0, { force: true, target: 'yard', weight: 0.5 });
    // wagons on the yard tracks
    for (let k = 0; k < tracks.length; k++) {
      const tr = tracks[k];
      const sm = tr;
      let acc = 0, next = 60 + rnd() * 200, inRake = 0, rakeLen = 0;
      for (let i = 1; i < sm.length; i++) {
        const a = sm[i - 1], b = sm[i];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        acc += seg;
        if (Math.abs(b.x - T.x) > 1000) continue;
        if (acc < next) continue;
        if (inRake <= 0) { inRake = 5 + Math.floor(rnd() * 22); rakeLen = 0; if (rnd() < 0.3) { next = acc + 60 + rnd() * 150; continue; } }
        const r = rnd();
        const type = rakeLen === 0 && rnd() < 0.25 ? 'loco' : (r < 0.55 ? 'boxcar' : r < 0.82 ? 'openwagon' : 'tankwagon');
        const t = this.B.types.get(type);
        const dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
        const rot = Math.atan2(-dz, dx);
        const cx = b.x + dx * t.w / 2, cz = b.z + dz * t.w / 2;
        const y = (b.y ?? this.hf.height(cx, cz)) + 0.47;
        this.put(type, cx, cz, rot, { force: true, y, target: 'yard', weight: type === 'loco' ? 0.6 : 0.25, tint: col([1, 1, 1], (rnd() - 0.5) * 0.25) });
        next = acc + t.w + 0.2;
        inRake--; rakeLen++;
        if (inRake <= 0) next += 30 + rnd() * 160;
      }
    }
    this.propSpots.push({ x: T.x, z: T.z + 60, r: 300, kind: 'yard', n: 40 });
  }

  _railBridge() {
    const line = this.hf.lines.find(l => l.kind === 'rail' && l.pts.some(p => p.bridge));
    const bp = line.pts.filter(p => p.bridge);
    const a = bp[0], b = bp[bp.length - 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 24;
    const rot = Math.atan2(-(b.z - a.z), b.x - a.x);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    this.B.defineType('truss_bridge', makeTrussBridge(len, a.y - WATER_Y, 6.5), { hp: 2 });
    const r = this.put('truss_bridge', cx, cz, rot, { force: true, y: a.y - 0.1, target: 'bridge', weight: 1, kind: 'bridge' });
    r.axis = { ax: a.x, az: a.z, bx: b.x, bz: b.z };
    const T = this.targets.bridge;
    T.x = cx; T.z = cz;
    TARGETS.find(t => t.id === 'bridge').x = cx;
    TARGETS.find(t => t.id === 'bridge').z = cz;
  }

  _depot() {
    const T = TARGETS.find(t => t.id === 'depot');
    const list = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) list.push([i % 2 ? 'tank_8' : 'tank_10', -75 + i * 50, -28 + j * 58, 0, 1]);
    list.push(['shed_brick', 0, 105, 0, 0.5], ['shed_small', 120, 60, 0, 0.3], ['shed_small', -120, 70, 0, 0.3]);
    this._site(T.x, T.z, 0.2, list, 'depot');
    this.propSpots.push({ x: T.x, z: T.z + 90, r: 80, kind: 'depot', n: 30 });
  }

  _flak() {
    const rnd = this.rnd;
    for (const f of FLAK_SITES) {
      const rot = rnd() * Math.PI;
      for (let k = 0; k < 4; k++) {
        const a = rot + k * Math.PI / 2;
        const x = f.x + Math.cos(a) * 26, z = f.z + Math.sin(a) * 26;
        const r = this.put('flak_pit', x, z, a, { force: true, kind: 'flak' });
        if (r) this.flakGuns.push({ rec: r, x, z, y: r.y + 1.6, site: f });
      }
      this.put('shed_small', f.x, f.z, rot, { force: true, tint: col([0.7, 0.72, 0.62]) });
      this.propSpots.push({ x: f.x, z: f.z, r: 22, kind: 'flak', n: 26 });
    }
  }
}

function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
function bbox(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) { a = Math.min(a, p.x); b = Math.min(b, p.z); c = Math.max(c, p.x); d = Math.max(d, p.z); }
  return [a, b, c, d];
}

function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.z - q.x * p[i].z; } return Math.abs(a) / 2; }
function centroid(p) { let x = 0, z = 0; for (const v of p) { x += v.x; z += v.z; } return { x: x / p.length, z: z / p.length }; }
// split a convex polygon by the line through pt with direction dir
function splitConvex(poly, pt, dir) {
  const nx = -dir.z, nz = dir.x;
  const side = (v) => (v.x - pt.x) * nx + (v.z - pt.z) * nz;
  const A = [], B = [], cut = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) A.push(p); else B.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      const x = { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
      A.push(x); B.push(x); cut.push(x);
    }
  }
  if (A.length < 3 || B.length < 3 || cut.length !== 2) return null;
  return { a: A, b: B, seg: cut };
}
// inset a convex polygon by d (returns null if it collapses)
function insetConvex(poly, d) {
  const n = poly.length;
  const c = centroid(poly);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    dx /= L; dz /= L;
    let nx = -dz, nz = dx;
    if (((a.x + b.x) / 2 - c.x) * nx + ((a.z + b.z) / 2 - c.z) * nz > 0) { nx = -nx; nz = -nz; }
    lines.push({ x: a.x + nx * d, z: a.z + nz * d, dx, dz });
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i], l2 = lines[(i + 1) % lines.length];
    const den = l1.dx * l2.dz - l1.dz * l2.dx;
    if (Math.abs(den) < 1e-6) continue;
    const t = ((l2.x - l1.x) * l2.dz - (l2.z - l1.z) * l2.dx) / den;
    out.push({ x: l1.x + l1.dx * t, z: l1.z + l1.dz * t });
  }
  if (out.length < 3 || polyArea(out) < 150) return null;
  // reject if inset flipped (vertices outside original)
  const c2 = centroid(out);
  if (Math.hypot(c2.x - c.x, c2.z - c.z) > 30) return null;
  return out;
}

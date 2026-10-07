import * as THREE from 'three';
import { V, Batch, rbox, cyl, mulberry } from '../engine/geom.js';
import { BUILDINGS, QUAY } from './layout.js';
import { boxUV } from './materials.js';

const Y0 = QUAY.topY + 0.02; // finished floor level

/**
 * A wall along the X axis (axis 'x') or Z axis (axis 'z') at a fixed coordinate, spanning
 * [a, b] horizontally and [y0, y1] vertically, with rectangular openings {c, w, y0, y1}.
 * Real thickness: the opening reveals (jambs, heads, sills) are the faces of the wall pieces.
 */
function wall(b, mat, axis, fixed, a, bEnd, y0, y1, t, openings = [], inward = 1) {
  // 'fixed' is the outer face; the wall extends from it toward the interior (sign 'inward')
  const ops = [...openings].sort((p, q) => p.c - q.c);
  const piece = (h0, h1, v0, v1) => {
    if (h1 - h0 < 0.01 || v1 - v0 < 0.01) return;
    const w = h1 - h0, h = v1 - v0, c = (h0 + h1) / 2;
    if (axis === 'x') b.add(mat, new THREE.BoxGeometry(w, h, t), V(c, (v0 + v1) / 2, fixed + inward * t / 2));
    else b.add(mat, new THREE.BoxGeometry(t, h, w), V(fixed + inward * t / 2, (v0 + v1) / 2, c));
  };
  let cur = a;
  for (const o of ops) {
    const l = o.c - o.w / 2, r = o.c + o.w / 2;
    piece(cur, l, y0, y1);
    piece(l, r, y0, o.y0); // below (sill wall)
    piece(l, r, o.y1, y1); // above (header)
    cur = r;
  }
  piece(cur, bEnd, y0, y1);
}

/** Window assembly inside an opening: frame, mullions, transom, glazing, protruding sill. */
function windowUnit(b, mats, axis, fixed, o, t, inward = 1, opts = {}) {
  const { frame = mats.frame, glass = mats.glass, sill = mats.sill, cols = 2, rows = 1 } = opts;
  const inset = opts.inset ?? 0.12; // frame set back from the outer face
  const fd = 0.1, fw = 0.07;
  const w = o.w, h = o.y1 - o.y0, cy = (o.y0 + o.y1) / 2;
  const at = (u, y, d) => (axis === 'x' ? V(o.c + u, y, fixed + inward * d) : V(fixed + inward * d, y, o.c + u));
  const box = (m, sw, sh, sd, u, y, d) => b.add(m, axis === 'x' ? new THREE.BoxGeometry(sw, sh, sd) : new THREE.BoxGeometry(sd, sh, sw), at(u, y, d));
  const d = inset + fd / 2;
  // outer frame
  box(frame, w, fw, fd, 0, o.y1 - fw / 2, d);
  box(frame, w, fw, fd, 0, o.y0 + fw / 2, d);
  box(frame, fw, h, fd, -w / 2 + fw / 2, cy, d);
  box(frame, fw, h, fd, w / 2 - fw / 2, cy, d);
  // mullions / transoms (sash bars, slightly proud of the glass)
  for (let k = 1; k < cols; k++) box(frame, fw * 0.8, h - fw, fd * 0.8, -w / 2 + (w * k) / cols, cy, d + 0.01);
  for (let k = 1; k < rows; k++) box(frame, w - fw, fw * 0.8, fd * 0.8, 0, o.y0 + (h * k) / rows, d + 0.01);
  // glazing
  box(glass, w - fw, h - fw, 0.012, 0, cy, d + 0.02);
  // sill: projects beyond the outer face with a drip edge
  if (sill) box(sill, w + 0.12, 0.07, inset + 0.09, 0, o.y0 - 0.035, (inset - 0.09) / 2);
}

function gutter(b, mats, x0, x1, y, z, along = 'x') {
  const g = new THREE.CylinderGeometry(0.11, 0.11, Math.abs(x1 - x0), 10, 1, true, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  if (along === 'x') b.add(mats.gutter, g, V((x0 + x1) / 2, y, z), [Math.PI, 0, 0]);
  else b.add(mats.gutter, g, V(z, y, (x0 + x1) / 2), [Math.PI, Math.PI / 2, 0]);
}

function downpipe(b, mats, x, z, yTop, outX = 0, outZ = 0) {
  const h = yTop - Y0;
  b.add(mats.gutter, cyl(0.05, 0.05, h - 0.3, 8), V(x, Y0 + 0.15 + (h - 0.3) / 2, z));
  b.add(mats.gutter, cyl(0.05, 0.05, 0.35, 8), V(x + outX * 0.12, Y0 + 0.12, z + outZ * 0.12), [outZ ? Math.PI / 2 : 0, 0, outX ? Math.PI / 2 : 0]);
  for (let y = Y0 + 1; y < yTop - 0.5; y += 2) b.add(mats.gutter, cyl(0.065, 0.065, 0.05, 8), V(x, y, z));
}

function iBeam(b, m, len, depth, flange, pos, rot) {
  const g1 = new THREE.BoxGeometry(len, depth - 0.04, 0.012);
  const gf = new THREE.BoxGeometry(len, 0.02, flange);
  const e = new THREE.Euler(...rot, 'YXZ');
  b.add(m, g1, pos, rot);
  for (const s of [-1, 1]) b.add(m, gf, pos.clone().add(V(0, s * (depth / 2 - 0.01), 0).applyEuler(e)), rot);
}

function signTexture(text, sub) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#1d3346'; g.fillRect(0, 0, 1024, 192);
  g.strokeStyle = '#e8e4da'; g.lineWidth = 8; g.strokeRect(12, 12, 1000, 168);
  g.fillStyle = '#ece8de'; g.textAlign = 'center';
  const fit = (str, size, weight, y) => {
    let px = size;
    do { g.font = `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`; px -= 2; } while (g.measureText(str).width > 960 && px > 10);
    g.fillText(str, 512, y);
  };
  fit(text, 76, 'bold', 104);
  fit(sub, 36, 'normal', 158);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export async function buildBuildings(assets, lib, quality) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const L = lib;
  const mats = {
    brick: L.make('brick', 'factory_brick', { weather: { macro: 0.18, macroScale: 0.08, grimeHeight: Y0, grimeRange: 1.2, grimeAmount: 0.35 } }),
    clad: L.make('cladding', 'corrugated_iron_02', { metalness: 0.1, useMetalMap: false, weather: { paint: 0x8f9a9c, macro: 0.22, macroScale: 0.06, grimeHeight: Y0 + 3, grimeRange: 2.5, grimeAmount: 0.25 } }),
    roof: L.make('roof', 'rusty_corrugated_iron', { color: 0x9a948c, metalness: 0.2, useMetalMap: false, weather: { macro: 0.3, macroScale: 0.05 } }),
    block: L.make('blockwork', 'painted_concrete', { color: 0xc9c4b8, weather: { macro: 0.25, macroScale: 0.12, grimeHeight: Y0, grimeRange: 1.0, grimeAmount: 0.35 } }),
    floor: L.make('shed-floor', 'concrete_floor_worn_001', { color: 0x9a968f, envMapIntensity: 0.35, weather: { macro: 0.3, macroScale: 0.05 } }),
    lining: L.plain('lining', 0x6d6a64, 0.85, 0, { envMapIntensity: 0.3 }),
    steel: L.plain('struct-steel', 0x55606a, 0.55, 0.5, { envMapIntensity: 0.4 }),
    craneYellow: L.plain('crane-yellow', 0xc39a22, 0.5, 0.3, { envMapIntensity: 0.5 }),
    frame: L.plain('window-frame', 0xd9dbd6, 0.45, 0.1),
    darkFrame: L.plain('window-frame-dark', 0x3a4046, 0.4, 0.6),
    sill: L.make('sill', 'concrete_wall_008', { color: 0xc9c6bf }),
    gutter: L.plain('gutter', 0x8c9294, 0.4, 0.8),
    door: L.make('door-steel', 'corrugated_iron_02', { metalness: 0.1, useMetalMap: false, weather: { paint: 0x3f6a82, macro: 0.25, macroScale: 0.2, grimeHeight: Y0 + 0.3, grimeRange: 1.5, grimeAmount: 0.3 } }),
    lintel: L.make('lintel', 'concrete_wall_008', { color: 0xbab6ae }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x2c3a40, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 1.3, specularIntensity: 1 }),
    roofLight: new THREE.MeshPhysicalMaterial({ name: 'rooflight', color: 0xd8dcd6, roughness: 0.35, transparent: true, opacity: 0.6, depthWrite: false }),
    emissive: new THREE.MeshStandardMaterial({ name: 'lamp-glow', color: 0xffffff, emissive: 0xffe6b8, emissiveIntensity: 4 }),
  };
  const lights = [];
  const openings = [];
  const b = new Batch();

  // ================= Fabrication shed =================
  {
    const s = BUILDINGS.shed;
    const xA = s.x - s.w / 2, xB = s.x + s.w / 2, zF = s.z + s.d / 2, zB = s.z - s.d / 2;
    const eave = Y0 + s.h, pitch = (10 * Math.PI) / 180, ridge = eave + Math.tan(pitch) * (s.d / 2);
    const plinth = Y0 + 3, t = 0.35, tc = 0.14;
    const door = { c: s.x, w: 16, y0: Y0, y1: Y0 + 11.5 };
    const winRow = (a, bb, n, w) => Array.from({ length: n }, (_, i) => ({ c: a + ((bb - a) * (i + 0.5)) / n, w, y0: eave - 3.4, y1: eave - 1.2 }));
    b.add(mats.floor, new THREE.BoxGeometry(s.w - 0.2, 0.2, s.d - 0.2), V(s.x, Y0 - 0.09, s.z));
    // front (quay side, +z) : brick plinth + cladding, big door opening, clerestory windows
    wall(b, mats.brick, 'x', zF, xA, xB, Y0, plinth, t, [door, { c: xA + 6, w: 1.1, y0: Y0, y1: Y0 + 2.2 }], -1);
    const frontWins = winRow(xA + 2, xB - 2, 8, 4.2).filter((o) => Math.abs(o.c - door.c) > door.w / 2 + 2.5);
    wall(b, mats.clad, 'x', zF, xA, xB, plinth, eave, tc, [{ ...door, y0: plinth }, ...frontWins], -1);
    // back
    const backWins = winRow(xA + 2, xB - 2, 8, 4.2);
    wall(b, mats.brick, 'x', zB, xA, xB, Y0, plinth, t, [], 1);
    wall(b, mats.clad, 'x', zB, xA, xB, plinth, eave, tc, backWins, 1);
    // gable ends with personnel doors
    for (const [xg, out] of [[xA, 1], [xB, -1]]) {
      const pd = { c: s.z + 6, w: 3.1, y0: Y0, y1: Y0 + 2.4 };
      wall(b, mats.brick, 'z', xg, zB, zF, Y0, plinth, t, [pd], out);
      const gw = winRow(zB + 3, zF - 3, 4, 3.4);
      wall(b, mats.clad, 'z', xg, zB, zF, plinth, eave, tc, gw, out);
      for (const o of gw) windowUnit(b, mats, 'z', xg, o, tc, out, { frame: mats.darkFrame, sill: null, cols: 3, inset: 0.04 });
      // gable triangle
      const ext = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(zB, eave), new THREE.Vector2(zF, eave), new THREE.Vector2(s.z, ridge)]), { depth: tc, bevelEnabled: false });
      ext.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> -x
      b.add(mats.clad, ext, V(xg + (out > 0 ? tc : 0), 0, 0));
      openings.push({ x: xg - out * 0.5, z: pd.c, w: 1.4, d: pd.w * 0.8 });
    }
    for (const o of frontWins) windowUnit(b, mats, 'x', zF, o, tc, -1, { frame: mats.darkFrame, sill: null, cols: 4, inset: 0.04 });
    for (const o of backWins) windowUnit(b, mats, 'x', zB, o, tc, 1, { frame: mats.darkFrame, sill: null, cols: 4, inset: 0.04 });
    // roof planes with overhang, ridge cap, roof lights
    const half = s.d / 2 + 0.6, slope = half / Math.cos(pitch);
    for (const sd of [1, -1]) {
      const cz = s.z + (sd * half) / 2, cy = eave + Math.tan(pitch) * (s.d / 2 - half / 2) + 0.12;
      b.add(mats.roof, new THREE.BoxGeometry(s.w + 1.2, 0.08, slope), V(s.x, cy, cz), [sd * pitch, 0, 0]);
      for (let x = xA + 6; x < xB - 4; x += 12) b.add(mats.roofLight, new THREE.BoxGeometry(2.0, 0.02, slope * 0.6), V(x, cy + 0.06, cz), [sd * pitch, 0, 0]);
      // gutter + downpipes
      gutter(b, mats, xA - 0.6, xB + 0.6, eave - 0.08, s.z + sd * (half + 0.05));
      for (let x = xA + 4; x <= xB - 3; x += 15) if (Math.abs(x - door.c) > door.w / 2 + 2) downpipe(b, mats, x, s.z + sd * (s.d / 2 + 0.12), eave - 0.08, 0, sd);
    }
    b.add(mats.gutter, rbox(s.w + 1.2, 0.18, 0.6, 0.05), V(s.x, ridge + 0.14, s.z));
    // barge boards on gables
    for (const xg of [xA - 0.6, xB + 0.6]) for (const sd of [1, -1]) b.add(mats.gutter, new THREE.BoxGeometry(0.06, 0.3, slope), V(xg, eave + Math.tan(pitch) * (s.d / 4 - 0.3) + 0.05, s.z + sd * half / 2), [sd * pitch, 0, 0]);
    // sliding door leaves parked beside the opening + track beam
    b.add(mats.steel, new THREE.BoxGeometry(door.w * 2 + 2, 0.4, 0.3), V(door.c + door.w / 2, door.y1 + 0.3, zF + 0.25));
    for (let k = 0; k < 2; k++) {
      const lx = door.c + door.w / 2 + 4.2 + k * 0.2 + k * 3.6;
      b.add(mats.door, rbox(8.2, 11.4, 0.12, 0.03), V(lx, Y0 + 5.75, zF + 0.32 + k * 0.16));
      for (const yy of [Y0 + 0.15, Y0 + 5.7, Y0 + 11.3]) b.add(mats.steel, new THREE.BoxGeometry(8.2, 0.16, 0.08), V(lx, yy, zF + 0.4 + k * 0.16));
    }
    openings.push({ x: door.c, z: zF - 0.5, w: door.w - 1, d: 3 });
    // personnel door (recessed steel leaf, frame, canopy) and guard posts at the big door
    const pdx = xA + 6;
    b.add(mats.darkFrame, new THREE.BoxGeometry(1.2, 2.3, 0.08), V(pdx, Y0 + 1.15, zF - 0.06));
    b.add(mats.door, rbox(1.0, 2.15, 0.05, 0.01), V(pdx, Y0 + 1.08, zF - 0.14));
    b.add(mats.gutter, cyl(0.02, 0.02, 0.14, 6), V(pdx + 0.38, Y0 + 1.05, zF - 0.08), [Math.PI / 2, 0, 0]);
    b.add(mats.steel, rbox(1.8, 0.08, 0.9, 0.02), V(pdx, Y0 + 2.55, zF + 0.45));
    for (const sx of [-1, 1]) b.add(mats.steel, cyl(0.015, 0.015, 1.0, 4), V(pdx + sx * 0.85, Y0 + 2.95, zF + 0.45), [0.85, 0, 0]);
    const postMat = L.plain('guard-yellow', 0xd8a419, 0.55, 0.3);
    for (const dx of [-door.w / 2 - 0.6, door.w / 2 + 0.6]) for (const dz of [0.6, 1.6]) {
      b.add(postMat, cyl(0.11, 0.11, 1.2, 12), V(door.c + dx, Y0 + 0.6, zF + dz));
      b.add(mats.darkFrame, cyl(0.115, 0.115, 0.1, 12), V(door.c + dx, Y0 + 0.9, zF + dz));
    }
    const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshStandardMaterial({ map: signTexture('FABRICATION SHOP 2', 'HULL BLOCKS · WELDING · NO UNAUTHORISED ENTRY'), roughness: 0.6 }));
    shopSign.position.set(door.c, door.y1 + 1.6, zF + 0.03);
    group.add(shopSign);
    openings.push({ x: s.x, z: s.z, w: s.w - 1.2, d: s.d - 1.2 }); // interior is walkable once inside
    // portal frames, crane runway and an overhead travelling crane
    for (let x = xA + 4; x <= xB - 4 + 0.01; x += 8) {
      for (const sd of [1, -1]) iBeam(b, mats.steel, s.h - 0.2, 0.5, 0.3, V(x, Y0 + (s.h - 0.2) / 2, s.z + sd * (s.d / 2 - 0.8)), [0, Math.PI / 2, Math.PI / 2]);
      for (const sd of [1, -1]) iBeam(b, mats.steel, half, 0.55, 0.25, V(x, eave + Math.tan(pitch) * (s.d / 4) - 0.6, s.z + sd * s.d / 4), [0, Math.PI / 2, -sd * pitch]);
      for (const sd of [1, -1]) b.add(mats.steel, rbox(0.6, 0.4, 0.6, 0.03), V(x, Y0 + 10.8, s.z + sd * (s.d / 2 - 1.2)));
    }
    for (const sd of [1, -1]) iBeam(b, mats.steel, s.w - 4, 0.6, 0.3, V(s.x, Y0 + 11.3, s.z + sd * (s.d / 2 - 1.2)), [0, 0, 0]);
    b.add(mats.craneYellow, rbox(1.0, 1.1, s.d - 2.6, 0.06), V(s.x - 12, Y0 + 12.1, s.z));
    b.add(mats.craneYellow, rbox(1.0, 1.1, s.d - 2.6, 0.06), V(s.x - 10.4, Y0 + 12.1, s.z));
    b.add(mats.craneYellow, rbox(2.6, 1.0, 2.2, 0.06), V(s.x - 11.2, Y0 + 13.1, s.z + 3));
    b.add(mats.steel, cyl(0.02, 0.02, 7.5, 4), V(s.x - 11.2, Y0 + 8.6, s.z + 3));
    b.add(mats.craneYellow, rbox(0.7, 0.9, 0.5, 0.05), V(s.x - 11.2, Y0 + 4.6, s.z + 3));
    // inner lining keeps the interior dim (it does not see the open sky)
    b.add(mats.lining, new THREE.BoxGeometry(s.w - 1, 0.05, s.d - 1), V(s.x, eave - 0.5, s.z));
    b.add(mats.lining, new THREE.BoxGeometry(s.w - 1, s.h - 3.4, 0.04), V(s.x, plinth + (s.h - 3.4) / 2 - 0.3, s.z - (s.d / 2 - 0.42))); // back wall only: the front has the door opening
    // lights hanging from the frames
    for (let k = 0; k < 6; k++) {
      const lx = xA + 8 + k * 9.6;
      for (const lz of [s.z - 7, s.z + 7]) {
        b.add(mats.steel, cyl(0.01, 0.01, 3, 4), V(lx, eave - 2.1, lz));
        b.add(mats.gutter, cyl(0.18, 0.55, 0.4, 16, true), V(lx, eave - 3.7, lz));
        b.add(mats.emissive, new THREE.CircleGeometry(0.3, 12), V(lx, eave - 3.89, lz), [Math.PI / 2, 0, 0]);
      }
    }
    for (const lx of [s.x - 16, s.x + 16]) {
      const l = new THREE.PointLight(0xffd9a8, 70, 45, 2);
      l.position.set(lx, eave - 4.5, s.z);
      lights.push(l); group.add(l);
    }
    // a curved hull block under construction on stands
    const blk = new THREE.CylinderGeometry(9, 9, 12, 32, 6, true, Math.PI * 0.62, Math.PI * 0.42);
    b.add(mats.door, blk, V(s.x + 8, Y0 + 9.2, s.z - 2), [0, 0, Math.PI / 2]);
    for (let k = -2; k <= 2; k++) b.add(mats.steel, rbox(0.25, 1.4, 4.0, 0.03), V(s.x + 8 + k * 2.8, Y0 + 0.7, s.z - 2));
    for (let k = -2; k <= 2; k++) b.add(mats.steel, new THREE.BoxGeometry(0.02, 2.2, 7.6), V(s.x + 8 + k * 2.8, Y0 + 2.3, s.z - 2));
    // welding fume extractor duct along the back wall
    b.add(mats.gutter, cyl(0.35, 0.35, s.w - 6, 16), V(s.x, Y0 + 8.5, zB + 1.2), [0, 0, Math.PI / 2]);
  }

  // ================= Office (two storeys, brick) =================
  {
    const o = BUILDINGS.office;
    const xA = o.x - o.w / 2, xB = o.x + o.w / 2, zF = o.z + o.d / 2, zB = o.z - o.d / 2;
    const t = 0.4, top = Y0 + o.h, floor2 = Y0 + 3.6;
    const winsF = (y0) => [-8, -4.6, 4.6, 8].map((c) => ({ c: o.x + c, w: 1.6, y0, y1: y0 + 1.7 }));
    const doorF = { c: o.x, w: 1.9, y0: Y0, y1: Y0 + 2.5 };
    const upF = [-8, -4.6, -1.2, 1.2, 4.6, 8].map((c) => ({ c: o.x + c, w: 1.6, y0: floor2 + 0.9, y1: floor2 + 2.6 }));
    const front = [...winsF(Y0 + 0.9), doorF];
    // walls as one wall per storey band so both window rows cut through
    const band = (axis, fixed, a, bb, out, lower, upper) => {
      wall(b, mats.brick, axis, fixed, a, bb, Y0, floor2, t, lower, out);
      wall(b, mats.brick, axis, fixed, a, bb, floor2, top, t, upper, out);
    };
    band('x', zF, xA, xB, -1, front, upF);
    const backW = [-6, 0, 6].map((c) => ({ c: o.x + c, w: 1.6, y0: Y0 + 0.9, y1: Y0 + 2.6 }));
    band('x', zB, xA, xB, 1, backW, backW.map((w) => ({ ...w, y0: floor2 + 0.9, y1: floor2 + 2.6 })));
    const sideW = (y0) => [{ c: o.z, w: 1.6, y0, y1: y0 + 1.7 }];
    band('z', xA, zB + t, zF - t, 1, sideW(Y0 + 0.9), sideW(floor2 + 0.9));
    band('z', xB, zB + t, zF - t, -1, sideW(Y0 + 0.9), sideW(floor2 + 0.9));
    const all = [[front.filter((w) => w !== doorF), 'x', zF, -1], [upF, 'x', zF, -1], [backW, 'x', zB, 1], [backW.map((w) => ({ ...w, y0: floor2 + 0.9, y1: floor2 + 2.6 })), 'x', zB, 1],
      [sideW(Y0 + 0.9), 'z', xA, 1], [sideW(floor2 + 0.9), 'z', xA, 1], [sideW(Y0 + 0.9), 'z', xB, -1], [sideW(floor2 + 0.9), 'z', xB, -1]];
    for (const [list, axis, fixed, out] of all) for (const w of list) {
      windowUnit(b, mats, axis, fixed, w, t, out, { cols: 2, rows: 2, inset: 0.14 });
      // concrete lintel over each opening
      if (axis === 'x') b.add(mats.lintel, new THREE.BoxGeometry(w.w + 0.4, 0.22, t), V(w.c, w.y1 + 0.11, fixed + out * t / 2));
      else b.add(mats.lintel, new THREE.BoxGeometry(t, 0.22, w.w + 0.4), V(fixed + out * t / 2, w.y1 + 0.11, w.c));
    }
    // door: recessed panel door with glazed top, canopy and step
    b.add(mats.darkFrame, rbox(1.75, 2.4, 0.06, 0.02), V(o.x, Y0 + 1.2, zF - 0.28));
    b.add(mats.glass, new THREE.BoxGeometry(1.0, 0.7, 0.02), V(o.x, Y0 + 1.85, zF - 0.24));
    b.add(mats.gutter, cyl(0.02, 0.02, 0.3, 6), V(o.x + 0.65, Y0 + 1.05, zF - 0.22));
    b.add(mats.lintel, rbox(3.2, 0.16, 1.5, 0.03), V(o.x, Y0 + 2.85, zF + 0.7));
    b.add(mats.lintel, rbox(2.6, 0.16, 1.0, 0.03), V(o.x, Y0 + 0.08 - 0.02, zF + 0.45));
    // floor slab edge + parapet coping + flat roof
    b.add(mats.lining, new THREE.BoxGeometry(o.w - 2 * t, 0.3, o.d - 2 * t), V(o.x, floor2, o.z));
    b.add(mats.lining, new THREE.BoxGeometry(o.w - 2 * t, 0.25, o.d - 2 * t), V(o.x, top - 0.6, o.z));
    b.add(mats.block, new THREE.BoxGeometry(o.w - 2 * t, 0.1, o.d - 2 * t), V(o.x, top - 0.42, o.z));
    b.add(mats.lintel, rbox(o.w + 0.1, 0.12, 0.5, 0.02), V(o.x, top + 0.06, zF - 0.2));
    b.add(mats.lintel, rbox(o.w + 0.1, 0.12, 0.5, 0.02), V(o.x, top + 0.06, zB + 0.2));
    for (const xg of [xA + 0.2, xB - 0.2]) b.add(mats.lintel, rbox(0.5, 0.12, o.d + 0.1, 0.02), V(xg, top + 0.06, o.z));
    // interior: partitions and ceiling lights seen through the glass
    for (const xx of [o.x - 3.2, o.x + 3.2]) b.add(mats.lining, new THREE.BoxGeometry(0.12, o.h - 1, o.d - 1), V(xx, Y0 + (o.h - 1) / 2, o.z));
    b.add(mats.lining, new THREE.BoxGeometry(o.w - 1, o.h - 1, 0.12), V(o.x, Y0 + (o.h - 1) / 2, o.z - 1.5));
    for (const xx of [-7, -2, 2, 7]) for (const yy of [floor2 - 0.2, top - 0.75]) b.add(mats.emissive, new THREE.BoxGeometry(1.2, 0.04, 0.3), V(o.x + xx, yy, o.z + 2.5));
    // downpipes at the corners, roof scuppers
    for (const xx of [xA + 0.3, xB - 0.3]) downpipe(b, mats, xx, zF + 0.12, top - 0.3, 0, 1);
    // sign board
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.2), new THREE.MeshStandardMaterial({ map: signTexture('KESTREL POINT', 'NAVAL FITTING-OUT YARD · OFFICE'), roughness: 0.5 }));
    sign.position.set(o.x, floor2 + 0.1, zF + 0.04);
    sign.castShadow = true;
    group.add(sign);
  }

  // ================= Store (blockwork, mono-pitch roof) =================
  {
    const st = BUILDINGS.store;
    const xA = st.x - st.w / 2, xB = st.x + st.w / 2, zF = st.z + st.d / 2, zB = st.z - st.d / 2;
    const hF = Y0 + st.h + 0.9, hB = Y0 + st.h, t = 0.25;
    const doors = [{ c: st.x - 4, w: 3.1, y0: Y0, y1: Y0 + 2.42 }, { c: st.x + 4, w: 3.1, y0: Y0, y1: Y0 + 2.42 }];
    wall(b, mats.block, 'x', zF, xA, xB, Y0, hF, t, doors, -1);
    wall(b, mats.block, 'x', zB, xA, xB, Y0, hB, t, [], 1);
    for (const [xg, out] of [[xA, 1], [xB, -1]]) {
      const w = [{ c: st.z, w: 1.4, y0: Y0 + 1.4, y1: Y0 + 2.4 }];
      wall(b, mats.block, 'z', xg, zB + t, zF - t, Y0, hB, t, w, out);
      windowUnit(b, mats, 'z', xg, w[0], t, out, { cols: 2, inset: 0.1, frame: mats.darkFrame });
      const tri = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(zB, hB), new THREE.Vector2(zF, hB), new THREE.Vector2(zF, hF)]), { depth: t, bevelEnabled: false });
      tri.rotateY(-Math.PI / 2);
      b.add(mats.block, tri, V(xg + (out > 0 ? t : 0), 0, 0));
    }
    const pitch = Math.atan2(hF - hB, st.d), run = (st.d + 0.8) / Math.cos(pitch);
    b.add(mats.roof, new THREE.BoxGeometry(st.w + 0.8, 0.08, run), V(st.x, (hF + hB) / 2 + 0.08, st.z), [-pitch, 0, 0]);
    gutter(b, mats, xA - 0.4, xB + 0.4, hB - 0.05, zB - 0.45);
    downpipe(b, mats, xB - 0.6, zB - 0.15, hB - 0.05, 0, -1);
    b.add(mats.lining, new THREE.BoxGeometry(st.w - 0.6, 0.05, st.d - 0.6), V(st.x, hB - 0.3, st.z));
  }

  const meshes = b.build('buildings');
  meshes.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.transparent) { o.castShadow = false; o.renderOrder = 2; }
    if (o.material === mats.emissive) o.castShadow = false;
  });
  group.add(meshes);

  // Poly Haven doors, lamps and fittings
  const [shutter, wallLamp, hangLamp, secLight, aircon, shelves] = await Promise.all(
    ['rollershutter_door', 'industrial_wall_lamp', 'hanging_industrial_lamp', 'security_light', 'exterior_aircon_unit', 'steel_frame_shelves_01'].map((m) => assets.model(m)));
  const put = (model, pos, rotY = 0, scale = 1) => {
    if (!model) return null;
    const o = model.clone();
    o.position.copy(pos); o.rotation.y = rotY; o.scale.setScalar(scale);
    group.add(o);
    return o;
  };
  const sh = BUILDINGS.shed, of = BUILDINGS.office, st = BUILDINGS.store;
  for (const xg of [[sh.x - sh.w / 2, -Math.PI / 2], [sh.x + sh.w / 2, Math.PI / 2]]) put(shutter, V(xg[0] + (xg[1] > 0 ? 0.12 : -0.12), Y0, sh.z + 6), xg[1], 1);
  for (const dx of [-4, 4]) put(shutter, V(st.x + dx, Y0, st.z + st.d / 2 + 0.05), 0, 1);
  for (const x of [sh.x - 20, sh.x + 20]) put(secLight, V(x, Y0 + 9, sh.z + sh.d / 2 + 0.05), 0, 1.4);
  put(secLight, V(st.x, Y0 + 3.4, st.z + st.d / 2 + 0.05), 0, 1.2);
  for (const dx of [-2.2, 2.2]) put(wallLamp, V(of.x + dx, Y0 + 2.9, of.z + of.d / 2 + 0.05), 0, 1);
  put(aircon, V(of.x + 6, Y0 + 0.02, of.z - of.d / 2 - 0.55), Math.PI, 1);
  for (let k = 0; k < 4; k++) put(shelves, V(sh.x - 24 + k * 3.6, Y0, sh.z - sh.d / 2 + 1.0), 0, 1);
  for (let k = 0; k < 3; k++) put(hangLamp, V(sh.x + 18 + k * 0.01, Y0 + 2.2 + k * 0.0, sh.z + 12 - k * 6), 0, 1);
  return { group, openings, lights };
}

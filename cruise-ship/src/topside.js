import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as D from './dims.js';
import { procMaterial } from './procmat.js';
import { gridGeo, wallGeo, bandGeo, capGeo, fullOutline, box, offsetLine, samplePolyline, arcLen } from './geom.js';

const Y = D.Y_LIDO;
const C = {
  white: new THREE.Color(0xe9e9e6), off: new THREE.Color(0xd4d6d6), red: new THREE.Color(0xc41a24),
  dark: new THREE.Color(0x24272b), gray: new THREE.Color(0x9ea4a8), blue: new THREE.Color(0x1f4fb0),
  green: new THREE.Color(0x3d5f55), teak: new THREE.Color(0x8a5a36), tile: new THREE.Color(0x5fb4d6),
};
const SIDES = [false, true];

// ------------------------------------------------------------------ funnel livery
const FUNNEL = /* glsl */`
float lineCov(float d, float hw, float px){ float w = max(hw, px); return (1.0 - smoothstep(w - px, w + px, abs(d))) * clamp(hw / px, 0.0, 1.0); }
void surface(vec3 p, vec3 n, float s, inout vec3 alb, inout float rgh, inout float mtl, inout vec3 emi, inout float bump, inout float ao){
  float px = max(length(fwidth(p)) * 0.7, 1e-4);
  vec3 RED = vec3(0.62, 0.012, 0.03);
  vec3 BLUE = vec3(0.004, 0.03, 0.2);
  vec3 WHITE = vec3(0.85);
  vec3 col;
  if (s < -0.5) {
    float yb = 13.0 - 0.95 * p.x + 1.1 * sin(p.x * 0.22 + 0.8);
    float d = p.y - yb;
    float red = smoothstep(-px, px, d - 0.8);
    float blue = 1.0 - smoothstep(-px, px, d + 0.8);
    col = mix(WHITE, RED, red);
    col = mix(col, BLUE, blue);
  } else {
    float red = 1.0 - smoothstep(0.66 - px * 0.2, 0.66 + px * 0.2, s);
    float blue = smoothstep(0.76 - px * 0.2, 0.76 + px * 0.2, s);
    col = mix(WHITE, RED, red);
    col = mix(col, BLUE, blue);
  }
  alb = col * (0.97 + 0.05 * vnoise(p.xy * 0.5));
  rgh = 0.22;
  mtl = 0.0;
  emi += col * 0.55 * uNight;
}`;

// ------------------------------------------------------------------ pool water
const POOL = /* glsl */`
void surface(vec3 p, vec3 n, float s, inout vec3 alb, inout float rgh, inout float mtl, inout vec3 emi, inout float bump, inout float ao){
  vec2 q = p.xz * 0.9;
  float t = uTime * 0.6;
  float c1 = vnoise(q * 1.3 + vec2(t, -t * 0.7));
  float c2 = vnoise(q * 1.7 - vec2(t * 0.8, t * 0.5) + 3.1);
  float ca = pow(1.0 - abs(c1 - c2), 8.0);
  alb = mix(vec3(0.02, 0.28, 0.42), vec3(0.25, 0.75, 0.85), ca * 0.6);
  rgh = 0.03;
  mtl = 0.0;
  bump = (c1 + c2) * 0.02;
  emi += vec3(0.05, 0.45, 0.65) * (0.25 + 0.6 * ca) * (0.35 + 1.4 * uNight);
}`;

// ------------------------------------------------------------------ LED screen
const SCREEN = /* glsl */`
void surface(vec3 p, vec3 n, float s, inout vec3 alb, inout float rgh, inout float mtl, inout vec3 emi, inout float bump, inout float ao){
  vec2 uv = vec2(p.x / 14.0 + 0.5, p.y / 7.0 + 0.5);
  float t = uTime * 0.15;
  float f = fbm3(uv * vec2(3.0, 1.6) + vec2(t, -t * 0.6));
  float w = sin(uv.x * 7.0 + f * 5.0 + uTime * 0.6) * 0.5 + 0.5;
  vec3 a = vec3(0.02, 0.12, 0.55), b = vec3(0.0, 0.65, 0.85), c = vec3(0.55, 0.1, 0.6);
  vec3 col = mix(a, b, smoothstep(0.2, 0.8, w));
  col = mix(col, c, smoothstep(0.55, 0.9, f));
  alb = vec3(0.02);
  rgh = 0.25;
  mtl = 0.0;
  emi += col * (1.3 + 1.0 * uNight);
}`;

function lathe(profile, seg = 20) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

// ------------------------------------------------------------------ funnel
function funnel(M) {
  const g = new THREE.Group();
  const FX = -97;
  g.position.set(FX, Y, 0);
  // body loft
  const ns = 22, nt = 40, rows = [];
  const HB = 17;
  for (let k = 0; k <= ns; k++) {
    const h = (k / ns) * HB;
    const cx = 2.0 - 0.6 * h, a = 10.2 - 0.21 * h, b = 4.7 - 0.09 * h;
    const row = [];
    for (let i = 0; i <= nt; i++) {
      const th = (i / nt) * Math.PI * 2;
      const c = Math.cos(th);
      row.push([cx + a * c, 2.5 + h, b * Math.sin(th) * (1 + 0.3 * c) * (1 - 0.25 * Math.max(0, -c) ** 3)]);
    }
    rows.push(row);
  }
  const bodyG = gridGeo(rows, false, rows.map((r) => r.map(() => -1)));
  // make sure normals point out
  const nz = bodyG.attributes.normal.array[(5 * (nt + 1) + Math.round(nt / 4)) * 3 + 2];
  const body = nz < 0 ? gridGeo(rows, true, rows.map((r) => r.map(() => -1))) : bodyG;
  const top = rows[rows.length - 1];
  const capShape = top.map((p) => [p[0], p[2]]);
  const cap = capGeo(capShape, 2.5 + HB);
  const cs = new Float32Array(cap.attributes.position.count).fill(-1);
  cap.setAttribute('aS', new THREE.BufferAttribute(cs, 1));

  // whale-tail wings (airfoil lofts)
  const wings = [];
  for (const sm of [1, -1]) {
    const nsp = 14, nch = 16, wr = [], ws = [];
    for (let j = 0; j <= nsp; j++) {
      const sg = j / nsp;
      const z = sm * (0.6 + 11.6 * sg);
      const xle = -1.2 - 6.0 * Math.pow(sg, 1.3);
      const c = 13.0 - 6.2 * Math.pow(sg, 1.1);
      const yy = 18.9 + 1.2 * sg + 4.2 * Math.pow(sg, 3.0);
      const row = [], srow = [];
      for (let i = 0; i <= nch * 2; i++) {
        // go around: TE upper -> LE -> TE lower
        const u = i <= nch ? 1 - i / nch : (i - nch) / nch;
        const xi = u * u;
        const yt = 5 * 0.12 * (0.2969 * Math.sqrt(xi) - 0.126 * xi - 0.3516 * xi * xi + 0.2843 * xi ** 3 - 0.1036 * xi ** 4) * c;
        const up = i <= nch ? 1 : -1;
        row.push([xle - xi * c, yy + up * yt + xi * c * 0.08, z]);
        srow.push(xi);
      }
      wr.push(row); ws.push(srow);
    }
    let wg = gridGeo(wr, sm < 0, ws);
    // orientation check: top surface normal should point up
    const ny = wg.attributes.normal.array[((7) * (nch * 2 + 1) + Math.round(nch / 2)) * 3 + 1];
    if (ny < 0) wg = gridGeo(wr, sm > 0, ws);
    wings.push(wg);
    const tip = wr[nsp];
    const shp = new THREE.Shape(tip.slice(0, nch * 2).map((p) => new THREE.Vector2(p[0], p[1])));
    const tc = new THREE.ShapeGeometry(shp);
    tc.translate(0, 0, tip[0][2]);
    tc.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(tc.attributes.position.count).fill(0.3), 1));
    wings.push(tc);
  }
  const geos = [body, cap, ...wings];
  const fm = procMaterial({ key: 'funnel', surface: FUNNEL, params: { roughness: 0.25, metalness: 0, side: THREE.DoubleSide } });
  for (const geo of geos) {
    const m = new THREE.Mesh(geo, fm); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  // exhaust outlets
  const exG = [];
  for (const [ex, ez] of [[-8.6, 1.4], [-8.6, -1.4], [-11.4, 0]]) {
    const cyl = new THREE.CylinderGeometry(0.8, 0.85, 1.4, 14); cyl.translate(ex, 2.5 + HB + 0.5, ez); exG.push(cyl);
  }
  for (const e of exG) { const m = new THREE.Mesh(e, M.metalDark); m.castShadow = true; g.add(m); }
  return g;
}

// ------------------------------------------------------------------ coaster
function coaster(M, anim) {
  const P = [
    [-66, 72, 0], [-70, 70.5, 11], [-82, 66.5, 16], [-100, 63.6, 16.6], [-119, 66.5, 16], [-135, 72.5, 14.6],
    [-145.5, 76, 6], [-145.5, 76, -6], [-136, 71, -14.6], [-118, 64.2, -16.4], [-100, 68.4, -17], [-84, 65, -16.2], [-70, 69.5, -11.5],
  ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(P, true, 'centripetal');
  const N = 520;
  const pts = curve.getSpacedPoints(N);
  const frames = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t = pts[(i + 1) % N].clone().sub(pts[(i + N - 1) % N]).normalize();
    const s = new THREE.Vector3().crossVectors(t, up).normalize();
    const u = new THREE.Vector3().crossVectors(s, t).normalize();
    frames.push({ p: pts[i], t, s, u });
  }
  const offCurve = (ds, du) => new THREE.CatmullRomCurve3(frames.map((f) => f.p.clone().addScaledVector(f.s, ds).addScaledVector(f.u, du)), true);
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1d58d8, roughness: 0.3, metalness: 0.35, emissive: 0x2a6bff, emissiveIntensity: 0 });
  anim.coasterTrack = trackMat;
  const g = new THREE.Group();
  for (const [ds, du, r] of [[0.62, 0, 0.13], [-0.62, 0, 0.13], [0, -0.62, 0.3]]) {
    const tg = new THREE.TubeGeometry(offCurve(ds, du), N, r, 7, true);
    const m = new THREE.Mesh(tg, trackMat); m.castShadow = true; m.receiveShadow = true; g.add(m);
  }
  // ties
  const tieG = new THREE.BoxGeometry(0.16, 0.14, 1.5);
  const ties = new THREE.InstancedMesh(tieG, new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.4, metalness: 0.5 }), Math.floor(N / 2));
  const mtx = new THREE.Matrix4(), basis = new THREE.Matrix4();
  for (let i = 0, k = 0; i < N; i += 2, k++) {
    const f = frames[i];
    basis.makeBasis(f.t, f.u, f.s);
    mtx.copy(basis).setPosition(f.p.clone().addScaledVector(f.u, -0.22));
    ties.setMatrixAt(k, mtx);
  }
  ties.castShadow = true;
  g.add(ties);
  // supports
  const sup = [];
  for (let i = 0; i < N; i += 13) {
    const f = frames[i];
    const top = f.p.y - 0.9;
    const h = top - Y;
    if (h < 1) continue;
    sup.push({ x: f.p.x, z: f.p.z, h, s: f.s });
  }
  const colG = new THREE.CylinderGeometry(0.26, 0.34, 1, 10); colG.translate(0, 0.5, 0);
  const cols = new THREE.InstancedMesh(colG, new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.4, metalness: 0.1 }), sup.length * 2);
  let ci = 0;
  for (const s of sup) {
    mtx.compose(new THREE.Vector3(s.x, Y, s.z), new THREE.Quaternion(), new THREE.Vector3(1, s.h, 1));
    cols.setMatrixAt(ci++, mtx);
    // footing
    mtx.compose(new THREE.Vector3(s.x, Y, s.z), new THREE.Quaternion(), new THREE.Vector3(2.4, 0.35, 2.4));
    cols.setMatrixAt(ci++, mtx);
  }
  cols.count = ci;
  cols.castShadow = true; cols.receiveShadow = true;
  g.add(cols);
  // cars
  const carG = new RoundedBoxGeometry(2.3, 1.0, 1.55, 3, 0.3);
  carG.translate(0, 0.35, 0);
  const seatG = new RoundedBoxGeometry(0.5, 0.7, 1.3, 2, 0.12); seatG.translate(-0.7, 0.9, 0);
  const carMats = [new THREE.MeshStandardMaterial({ color: 0xe8262d, roughness: 0.25, metalness: 0.2 }), new THREE.MeshStandardMaterial({ color: 0xf5c21b, roughness: 0.25, metalness: 0.2 })];
  const cars = [];
  for (let i = 0; i < 3; i++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(carG, carMats[i % 2]); body.castShadow = true; car.add(body);
    const seat = new THREE.Mesh(seatG, M.metalDark); car.add(seat);
    g.add(car); cars.push(car);
  }
  const L = curve.getLength();
  let yMax = -1e9; for (const f of frames) yMax = Math.max(yMax, f.p.y);
  anim.coaster = { curve, cars, L, yMax, s: 0, frames };
  return g;
}

// ------------------------------------------------------------------ water slides
function slides(M) {
  const g = new THREE.Group();
  const cx = -128, cz = 0;
  const cols = [0xf2b705, 0x1766d6, 0xd8342c];
  const specs = [
    { r: 5.4, y0: 72.3, y1: 60.2, turns: 2.25, a0: 0, dir: 1 },
    { r: 7.6, y0: 70.0, y1: 60.3, turns: 1.6, a0: Math.PI * 1.5, dir: -1 },
    { r: 9.7, y0: 72.6, y1: 60.4, turns: 1.3, a0: Math.PI * 0.75, dir: 1 },
  ];
  specs.forEach((sp, i) => {
    const pts = [];
    const a0 = sp.a0;
    pts.push(new THREE.Vector3(cx + 2.2 * Math.cos(a0), sp.y0 + 0.2, cz + 2.2 * Math.sin(a0)));
    const n = Math.ceil(sp.turns * 28);
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const a = a0 + sp.dir * f * sp.turns * Math.PI * 2;
      const r = sp.r * (k === 0 ? 0.85 : 1);
      pts.push(new THREE.Vector3(cx + r * Math.cos(a), sp.y0 + (sp.y1 - sp.y0) * Math.pow(f, 0.92), cz + r * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, n * 3, 0.68, 12, false);
    const mat = new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.18, metalness: 0.05 });
    const m = new THREE.Mesh(tube, mat); m.castShadow = true; m.receiveShadow = true; g.add(m);
    // support stanchions
    const last = pts[pts.length - 1];
    for (let k = 4; k < pts.length - 2; k += 5) {
      const p = pts[k];
      const h = p.y - 0.6 - Y;
      if (h < 0.8) continue;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 6), M.metal);
      c.position.set(p.x, Y + h / 2, p.z); c.castShadow = true; g.add(c);
    }
    // splash landing
    const lg = new THREE.Mesh(new RoundedBoxGeometry(4.2, 0.6, 2.6, 2, 0.25), new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.25 }));
    lg.position.set(last.x, Y + 0.3, last.z);
    lg.rotation.y = -Math.atan2(last.z - cz, last.x - cx) + Math.PI / 2;
    g.add(lg);
  });
  // tower
  const tw = new THREE.Group();
  const colG = new THREE.BoxGeometry(0.45, 15.5, 0.45);
  for (const [dx, dz] of [[1.8, 1.8], [1.8, -1.8], [-1.8, 1.8], [-1.8, -1.8]]) {
    const c = new THREE.Mesh(colG, M.metal); c.position.set(cx + dx, Y + 7.75, cz + dz); c.castShadow = true; tw.add(c);
  }
  for (const y of [64.4, 68.2, 72.1]) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.25, 4.6), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5 }));
    pl.position.set(cx, y, cz); pl.castShadow = true; tw.add(pl);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.8, 4, 1), new THREE.MeshStandardMaterial({ color: 0xd8342c, roughness: 0.4 }));
  roof.rotation.y = Math.PI / 4; roof.position.set(cx, Y + 16.4, cz); roof.castShadow = true; tw.add(roof);
  // stair flights between platforms (zig-zag)
  const stairMat = new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.5, metalness: 0.4 });
  const levels = [Y, 64.4, 68.2, 72.1];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.18, 1.0), stairMat);
    const y0 = levels[i], y1 = levels[i + 1];
    s.position.set(cx + (i % 2 ? -0.3 : 0.3), (y0 + y1) / 2, cz + (i % 2 ? -2.9 : 2.9));
    s.rotation.z = (i % 2 ? -1 : 1) * Math.atan2(y1 - y0, 5.2);
    s.castShadow = true; tw.add(s);
  }
  g.add(tw);
  return g;
}

// ------------------------------------------------------------------ loungers
function loungerGeometry() {
  const parts = [];
  const seat = new THREE.BoxGeometry(1.25, 0.08, 0.66); seat.translate(0.25, 0.36, 0); parts.push(seat);
  const back = new THREE.BoxGeometry(0.75, 0.07, 0.66); back.rotateZ(-0.62); back.translate(-0.62, 0.58, 0); parts.push(back);
  const frame = new THREE.BoxGeometry(1.9, 0.05, 0.05);
  for (const z of [0.3, -0.3]) { const f = frame.clone(); f.translate(0, 0.3, z); parts.push(f); }
  const leg = new THREE.BoxGeometry(0.05, 0.3, 0.05);
  for (const [x, z] of [[0.85, 0.3], [0.85, -0.3], [-0.8, 0.3], [-0.8, -0.3]]) { const l = leg.clone(); l.translate(x, 0.15, z); parts.push(l); }
  return mergeSimple(parts);
}

function mergeSimple(list) {
  const nonIdx = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of nonIdx) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of nonIdx) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

export function buildTopside(B, M, anim) {
  const root = new THREE.Group();
  const detail = new THREE.Group(); // small things (excluded from reflections)
  root.add(detail);

  // ---- lido windbreak glass + rail + posts
  const half = [...D.aftOutline(D.N_DECKS, 0), ...D.frontOutline(D.N_DECKS, 0)];
  const wb = offsetLine(half, -0.35);
  for (const mirror of SIDES) {
    B.add('railGlass', wallGeo(wb, Y, Y + 1.55, { mirror }));
    const top = offsetLine(half, -0.3), topIn = offsetLine(half, -0.45);
    B.add('paint', wallGeo(top, Y + 1.55, Y + 1.62, { mirror }), C.white);
    B.add('paint', bandGeo(top, topIn, Y + 1.62, { mirror }), C.white);
  }
  const posts = samplePolyline(wb, 2.4, 0.5);
  posts.forEach((q, i) => {
    for (const sm of [1, -1]) {
      B.add('paint', box(q.x - 0.05, q.x + 0.05, Y, Y + 1.6, sm * q.z - 0.05, sm * q.z + 0.05), C.gray);
      if (i % 2 === 0) B.add('lamp', box(q.x - 0.09, q.x + 0.09, Y + 1.62, Y + 1.78, sm * q.z - 0.09, sm * q.z + 0.09));
    }
  });

  // ---- funnel + base
  root.add(funnel(M));
  {
    const shape = new THREE.Shape();
    const x0 = -114, x1 = -85, zr = 7.8, r = 5;
    shape.moveTo(x0 + r, -zr); shape.lineTo(x1 - r * 1.6, -zr); shape.quadraticCurveTo(x1, -zr, x1, 0); shape.quadraticCurveTo(x1, zr, x1 - r * 1.6, zr);
    shape.lineTo(x0 + r, zr); shape.quadraticCurveTo(x0, zr, x0, zr - r); shape.lineTo(x0, -zr + r); shape.quadraticCurveTo(x0, -zr, x0 + r, -zr);
    const eg = new THREE.ExtrudeGeometry(shape, { depth: 3.2, bevelEnabled: true, bevelSize: 0.25, bevelThickness: 0.25, bevelSegments: 2, curveSegments: 10 });
    eg.rotateX(Math.PI / 2); eg.translate(0, Y + 3.45, 0);
    B.add('wallFunnelBase', eg, undefined, (x, y, z) => x + z * 0.7);
  }

  // ---- stacks
  for (const sx of [20, 34]) {
    const body = lathe([[0, 62.4], [2.35, 62.4], [2.2, 74.3]], 28);
    const band = lathe([[2.2, 74.3], [2.18, 75.6]], 28);
    const rim = lathe([[2.18, 75.6], [2.16, 76.4], [1.7, 76.4], [1.7, 75.9], [0, 75.9]], 28);
    for (const g of [body, band, rim]) g.translate(sx, 0, 0);
    B.add('paint', body, C.white); B.add('paint', band, C.red); B.add('paint', rim, C.dark);
  }
  B.add('wallHouse', box(12, 42, Y, Y + 3.4, -7.5, 7.5), undefined, (x, y, z) => x + z);
  B.add('paint', box(11.7, 42.3, Y + 3.4, Y + 3.7, -7.8, 7.8), C.white);

  // ---- radome house + domes
  B.add('wallHouse', box(52, 71, Y, Y + 3.8, -11, 11), undefined, (x, y, z) => x + z);
  B.add('paint', box(51.7, 71.3, Y + 3.8, Y + 4.1, -11.3, 11.3), C.white);
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.28, metalness: 0 });
  for (const [dx, dz, r] of [[56, 7.5, 2.2], [56, -7.5, 2.2], [65, 3.8, 1.9], [65, -3.8, 1.9], [68.5, 9, 1.3]]) {
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.8, 14), domeMat); ped.position.set(dx, Y + 4.1 + 0.9, dz); ped.castShadow = true; root.add(ped);
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), domeMat); s.position.set(dx, Y + 4.1 + 1.8 + r * 0.92, dz); s.castShadow = true; root.add(s);
  }

  // ---- forward observation house + mast
  {
    const ho = D.frontOutline(D.N_DECKS, 5.5, 20).filter((p) => p[0] >= 90);
    ho.unshift([90, ho[0][1]]);
    for (const mirror of SIDES) B.add('glassHouse', wallGeo(ho, Y, Y + 3.5, { mirror }));
    const back = [[90, ho[0][1]], [90, 0]];
    B.add('paint', wallGeo(back, Y, Y + 3.5, { mirror: false, flipFace: true }), C.white);
    B.add('paint', wallGeo(back, Y, Y + 3.5, { mirror: true, flipFace: true }), C.white);
    const roofO = offsetLine(ho, 0.5);
    B.add('paint', capGeo(fullOutline(roofO), Y + 3.9), C.white);
    B.add('paint', capGeo(fullOutline(roofO), Y + 3.5, true), C.off);
    for (const mirror of SIDES) B.add('paint', wallGeo(roofO, Y + 3.5, Y + 3.9, { mirror }), C.white);
    // mast
    const mx = 97, my = Y + 3.9;
    B.add('paint', box(mx - 0.7, mx + 0.7, my, my + 13, -0.7, 0.7), C.white);
    B.add('paint', box(mx - 1.6, mx + 1.6, my + 8.5, my + 8.8, -4.6, 4.6), C.white);
    B.add('paint', box(mx - 0.25, mx + 0.25, my + 12, my + 12.3, -3.6, 3.6), C.white);
    const whip = new THREE.CylinderGeometry(0.06, 0.1, 5, 6); whip.translate(mx, my + 15.5, 0); B.add('paint', whip, C.gray);
    anim.radars = [];
    for (const sz of [-3.0, 3.0]) {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.7, 10), M.metalDark); ped.position.set(mx, my + 9.15, sz); root.add(ped);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 5.2), new THREE.MeshStandardMaterial({ color: 0xe6e6e3, roughness: 0.4 }));
      bar.position.set(mx, my + 9.75, sz); root.add(bar); anim.radars.push(bar);
    }
    // nav lights
    const lm = (col) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0, roughness: 0.3 });
    anim.navLights = [];
    for (const [px, py, pz, col] of [[mx, my + 12.45, 0, 0xffffff], [111, D.Y_PUB + 8 * D.DECK_H + 2.9, D.W + 3.2, 0x22ff55], [111, D.Y_PUB + 8 * D.DECK_H + 2.9, -D.W - 3.2, 0xff2222]]) {
      const m = lm(col); const s = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), m); s.position.set(px, py, pz); root.add(s); anim.navLights.push(m);
    }
  }

  // ---- midship sports house
  {
    B.add('wallHouse', box(-38, 6, Y, Y + 3.8, -10.5, 10.5), undefined, (x, y, z) => x + z);
    B.add('paint', box(-38.3, 6.3, Y + 3.8, Y + 4.05, -10.8, 10.8), C.white);
    // court + running track on the roof
    B.add('deckBlue', box(-31, -3, Y + 4.05, Y + 4.1, -6.5, 6.5));
    const tr = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      tr.push([-17 + Math.cos(a) * 19.5, Math.sin(a) * 9.4]);
    }
    const trIn = tr.map((p) => [-17 + (p[0] + 17) * 0.9, p[1] * 0.8]);
    B.add('paint', bandGeo(tr, trIn, Y + 4.09, { mirror: false, down: true }), new THREE.Color(0xa0462f));
    // court lines
    const lineC = new THREE.Color(0xf0f0f0);
    for (const [x0, x1, z0, z1] of [[-31, -3, -6.5, -6.3], [-31, -3, 6.3, 6.5], [-31, -30.8, -6.5, 6.5], [-3.2, -3, -6.5, 6.5], [-17.1, -16.9, -6.5, 6.5]]) {
      B.add('paint', box(x0, x1, Y + 4.1, Y + 4.12, z0, z1), lineC);
    }
    const net = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 13), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
    net.position.set(-17, Y + 4.6, 0); detail.add(net);
    // roof rail
    const rr = [[-38, 10.6], [6, 10.6]];
    for (const mirror of SIDES) B.add('railGlass', wallGeo(rr, Y + 4.05, Y + 5.2, { mirror, sIsX: true }));
  }

  // ---- lido pool, hot tubs, screen
  {
    const px0 = -66, px1 = -47, pz = 5.2;
    B.add('paint', box(px0 - 0.6, px1 + 0.6, Y, Y + 0.55, -pz - 0.6, pz + 0.6), C.white);
    const pool = procMaterial({ key: 'pool', surface: POOL, params: { roughness: 0.05, metalness: 0 } });
    const pg = new THREE.Mesh(new THREE.PlaneGeometry(px1 - px0, pz * 2), pool);
    pg.rotation.x = -Math.PI / 2; pg.position.set((px0 + px1) / 2, Y + 0.57, 0); pg.receiveShadow = true; root.add(pg);
    B.add('deckTeak', box(px0 - 6, px1 + 5, Y + 0.005, Y + 0.02, -pz - 5.5, pz + 5.5));
    for (const [tx, tz] of [[-43, 5.5], [-43, -5.5], [-70, 7.5], [-70, -7.5]]) {
      const rim = lathe([[0, Y], [2.3, Y], [2.3, Y + 0.75], [2.0, Y + 0.75], [2.0, Y + 0.6]], 32); rim.translate(tx, 0, tz); B.add('paint', rim, C.white);
      const w = new THREE.Mesh(new THREE.CircleGeometry(2.0, 32), pool); w.rotation.x = -Math.PI / 2; w.position.set(tx, Y + 0.62, tz); root.add(w);
    }
    // screen
    const scr = procMaterial({ key: 'screen', surface: SCREEN, params: { roughness: 0.3, metalness: 0 } });
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), scr);
    sg.rotation.y = Math.PI / 2; sg.position.set(-75.9, Y + 1.3 + 3.5, 0); root.add(sg);
    B.add('paint', box(-77, -76.05, Y + 0.9, Y + 8.7, -7.4, 7.4), C.dark);
    B.add('paint', box(-77.2, -76.8, Y, Y + 1.0, -3, 3), C.dark);
  }

  // ---- teak zones on the lido
  B.add('deckTeak', box(-44, 8, Y + 0.004, Y + 0.018, 11.2, 20.2));
  B.add('deckTeak', box(-44, 8, Y + 0.004, Y + 0.018, -20.2, -11.2));
  B.add('deckTeak', box(43, 89, Y + 0.004, Y + 0.018, 11.8, 20.2));
  B.add('deckTeak', box(43, 89, Y + 0.004, Y + 0.018, -20.2, -11.8));

  root.add(slides(M));
  root.add(coaster(M, anim));

  // ---- loungers + umbrellas (instanced detail)
  const lg = loungerGeometry();
  const lmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  const L = [];
  const addL = (x, z, rot) => L.push([x, z, rot]);
  for (const sm of [1, -1]) {
    for (let x = -43.5; x < 7; x += 0.95) {
      if (x > -10.5 && x < 0.5) continue;
      for (const zr of [13.4, 15.9]) addL(x, sm * zr, sm > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    for (let x = 44; x < 88.5; x += 0.95) {
      if (x > 47.5 && x < 49.2) continue;
      for (const zr of [13.8, 16.3]) addL(x, sm * zr, sm > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    for (let x = -69; x < -45; x += 1.0) addL(x, sm * 8.7, sm > 0 ? -Math.PI / 2 : Math.PI / 2);
    for (let x = 74; x < 88; x += 0.95) for (const zr of [2.2, 4.6, 7.0]) addL(x, sm * zr, sm > 0 ? -Math.PI / 2 : Math.PI / 2);
  }
  const lm = new THREE.InstancedMesh(lg, lmat, L.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const colBlue = new THREE.Color(0x1f4f9c), colWhite = new THREE.Color(0xf2f2f0), colTeal = new THREE.Color(0x2c8fa8);
  L.forEach(([x, z, r], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
    m4.compose(new THREE.Vector3(x, Y + 0.02, z), q, one);
    lm.setMatrixAt(i, m4);
    const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    lm.setColorAt(i, h < 0.55 ? colBlue : h < 0.85 ? colWhite : colTeal);
  });
  lm.castShadow = true; lm.receiveShadow = true;
  detail.add(lm);

  const umbG = mergeSimple([(() => { const c = new THREE.ConeGeometry(1.7, 0.55, 12, 1, true); c.translate(0, 2.45, 0); return c; })(), (() => { const c = new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6); c.translate(0, 1.25, 0); return c; })()]);
  const U = [];
  for (const sm of [1, -1]) for (let x = -64; x <= -48; x += 5.3) U.push([x, sm * 10.4]);
  for (const sm of [1, -1]) for (let x = 76; x <= 86; x += 5) U.push([x, sm * 9.4]);
  const um = new THREE.InstancedMesh(umbG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide }), U.length);
  const ucol = [new THREE.Color(0xd62b2b), new THREE.Color(0xf4f4f2), new THREE.Color(0x1d4fa6)];
  U.forEach(([x, z], i) => { m4.makeTranslation(x, Y, z); um.setMatrixAt(i, m4); um.setColorAt(i, ucol[i % 3]); });
  um.castShadow = true;
  detail.add(um);

  // ---- forecastle machinery
  {
    const yb = D.Y_PUB;
    for (const sz of [4.2, -4.2]) {
      B.add('paint', box(146, 149.5, yb, yb + 1.1, sz - 1.2, sz + 1.2), C.green);
      const drum = new THREE.CylinderGeometry(0.85, 0.85, 1.6, 18); drum.rotateX(Math.PI / 2); drum.translate(147.8, yb + 1.6, sz); B.add('paint', drum, C.gray);
      B.add('paint', box(149.5, 157.5, yb, yb + 0.25, sz - 0.25, sz + 0.25), C.dark);
      for (const [wx, wz] of [[128, sz * 1.8]]) {
        const d2 = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 16); d2.rotateX(Math.PI / 2); d2.translate(wx, yb + 1.1, wz); B.add('paint', d2, C.gray);
        B.add('paint', box(wx - 1.2, wx + 1.2, yb, yb + 0.5, wz - 1, wz + 1), C.green);
      }
    }
    for (const bx of [118, 136, 162]) {
      const w = D.hullHalfW(bx, yb) - 1.1;
      for (const sm of [1, -1]) for (const dx of [-0.5, 0.5]) {
        const b = new THREE.CylinderGeometry(0.28, 0.32, 0.7, 12); b.translate(bx + dx, yb + 0.35, sm * w); B.add('paint', b, C.dark);
      }
    }
  }
  // anchors in the hawse pipes
  {
    for (const sm of [1, -1]) {
      const w = D.hullHalfW(158.5, 19.2) + 0.25;
      const parts = [];
      parts.push(box(-0.22, 0.22, -1.6, 0.9, -0.16, 0.16));
      parts.push(box(-1.1, 1.1, -1.9, -1.55, -0.2, 0.2));
      const f1 = new THREE.BoxGeometry(0.35, 1.1, 0.3); f1.rotateZ(0.5); f1.translate(-1.1, -1.35, 0); parts.push(f1);
      const f2 = new THREE.BoxGeometry(0.35, 1.1, 0.3); f2.rotateZ(-0.5); f2.translate(1.1, -1.35, 0); parts.push(f2);
      const ag = mergeSimple(parts);
      const am = new THREE.Mesh(ag, M.metalDark);
      am.position.set(158.5, 19.0, sm * w);
      am.rotation.y = sm * 0.32;
      root.add(am);
    }
  }
  return { root, detail };
}

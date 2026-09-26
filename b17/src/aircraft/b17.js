// Boeing B-17G Flying Fortress, built procedurally from published dimensions:
// length 22.66 m, span 31.62 m, NACA 0018->0010 wing, 4x Wright R-1820 with 3.53 m Hamilton Standard props.
// Axes: +Z forward (nose), +Y up, +X = left wing. Origin near the centre of gravity.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loftBody, loftWing, latheZ, nacaT } from './loft.js';
import { Livery, panelTexture, OD, NG } from './paint.js';
import { q } from '../core/settings.js';

export const NOSE_Z = 8.8;
const zOf = (s) => NOSE_Z - s;

const FUS = [
  { s: 0.0, w: 0.04, yT: 0.08, yB: -0.12 },
  { s: 0.25, w: 0.42, yT: 0.40, yB: -0.48 },
  { s: 0.7, w: 0.70, yT: 0.66, yB: -0.78 },
  { s: 1.5, w: 0.90, yT: 0.86, yB: -0.99 },
  { s: 2.5, w: 1.01, yT: 0.98, yB: -1.08 },
  { s: 3.6, w: 1.08, yT: 1.08, yB: -1.12 },
  { s: 4.4, w: 1.12, yT: 1.50, yB: -1.14 },
  { s: 5.4, w: 1.15, yT: 1.74, yB: -1.15 },
  { s: 6.6, w: 1.16, yT: 1.66, yB: -1.15 },
  { s: 7.8, w: 1.16, yT: 1.38, yB: -1.15 },
  { s: 10.0, w: 1.15, yT: 1.26, yB: -1.15 },
  { s: 12.0, w: 1.10, yT: 1.19, yB: -1.06 },
  { s: 14.0, w: 1.00, yT: 1.12, yB: -0.88 },
  { s: 16.0, w: 0.86, yT: 1.06, yB: -0.62 },
  { s: 18.0, w: 0.68, yT: 0.99, yB: -0.35 },
  { s: 20.0, w: 0.48, yT: 0.91, yB: -0.06 },
  { s: 21.5, w: 0.33, yT: 0.83, yB: 0.2 },
  { s: 22.3, w: 0.2, yT: 0.73, yB: 0.36 },
  { s: 22.66, w: 0.06, yT: 0.62, yB: 0.48 },
];

// wing planform
const WING = {
  rootX: 1.05, tipX: 15.81, rootLE: 7.2, rootChord: 6.0, tipLE: 10.0, tipChord: 2.0, rootY: -0.42, dihedral: THREE.MathUtils.degToRad(4.5),
};
export function wingAt(x) {
  const ax = Math.abs(x);
  const t = Math.min(1, Math.max(0, (ax - WING.rootX) / (WING.tipX - WING.rootX)));
  const le = WING.rootLE + (WING.tipLE - WING.rootLE) * t;
  const chord = WING.rootChord + (WING.tipChord - WING.rootChord) * t;
  const y = WING.rootY + Math.tan(WING.dihedral) * (ax - WING.rootX);
  const th = 0.18 + (0.10 - 0.18) * t;
  return { le, chord, y, t: th };
}
export const ENGINES = [4.7, 9.25, -4.7, -9.25]; // x of engine centrelines: L-in, L-out, R-in, R-out (engine #2,#1,#3,#4)

function circumference(interp, ring, s) {
  const { w, yT, yB } = interp(s);
  let arc = 0, prev = null;
  for (let i = 0; i <= 96; i++) {
    const [x, y] = ring(w, yT, yB, (i / 96) * Math.PI * 2);
    if (prev) arc += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
  }
  return arc;
}

function paintFuselage(geom, res) {
  const W = res, H = res / 2, k = W / 22.66;
  const L = new Livery(W, H, k);
  const { c } = L;
  const interp = geom.userData.interp, ring = geom.userData.ring;
  const Cs = [];
  for (let x = 0; x < W; x++) Cs.push(circumference(interp, ring, x / k));
  // base colours with wavy OD/NG demarcation
  for (let x = 0; x < W; x++) {
    const C = Cs[x] * k;
    const wav = Math.sin(x / k * 1.7) * 0.012 + Math.sin(x / k * 5.3) * 0.006;
    const a = (0.34 + wav) * C, b = (0.66 - wav) * C;
    c.fillStyle = OD; c.fillRect(x, 0, 1, a);
    c.fillStyle = NG; c.fillRect(x, a, 1, b - a);
    c.fillStyle = OD; c.fillRect(x, b, 1, H - b);
    // soft edge
    c.fillStyle = 'rgba(100,102,85,0.5)'; c.fillRect(x, a - 2, 1, 4); c.fillRect(x, b - 2, 1, 4);
  }
  L.mottle(0.09);
  const at = (s, frac) => [s * k, Cs[Math.min(W - 1, Math.max(0, Math.round(s * k)))] * k * frac];
  // panel lines: frames + longitudinal laps
  const xs = []; for (let s = 1.9; s < 22.4; s += 0.52) xs.push(Math.round(s * k) + 0.5);
  const ys = []; for (let a = 0.6; a < 8.4; a += 0.62) ys.push(Math.round(a * k) + 0.5);
  L.panelLines(xs, ys);
  const dark = '#0c0e10';
  const glaze = (s0, s1, f0, f1, bars = []) => {
    const [x0] = at(s0, 0), [x1] = at(s1, 0);
    for (let x = Math.floor(x0); x < x1; x++) {
      const C = Cs[x] * k;
      c.fillStyle = dark; c.fillRect(x, C * f0, 1, C * (f1 - f0));
      L.ac.fillStyle = 'rgb(255,40,0)'; L.ac.fillRect(x, C * f0, 1, C * (f1 - f0));
    }
    c.strokeStyle = OD; c.lineWidth = Math.max(2, k * 0.05);
    for (const s of bars) { const [x] = at(s, 0); const C = Cs[Math.round(x)] * k; c.beginPath(); c.moveTo(x, C * f0); c.lineTo(x, C * f1); c.stroke(); }
    for (const f of [f0, f1]) { c.beginPath(); for (let x = Math.floor(x0); x < x1; x += 4) { const C = Cs[x] * k; x === Math.floor(x0) ? c.moveTo(x, C * f) : c.lineTo(x, C * f); } c.stroke(); }
  };
  // nose glazing (whole cone) with frame bars
  glaze(0, 1.95, 0, 1, [0.6, 1.2]);
  for (const f of [0.15, 0.35, 0.65, 0.85]) { c.strokeStyle = OD; c.lineWidth = k * 0.04; c.beginPath(); for (let x = 0; x < 1.95 * k; x += 3) { const C = Cs[x] * k; x === 0 ? c.moveTo(x, C * f) : c.lineTo(x, C * f); } c.stroke(); }
  // cockpit windows (both sides) + overhead
  for (const [f0, f1] of [[0.1, 0.23], [0.77, 0.9]]) glaze(4.15, 5.55, f0, f1, [4.6, 5.05]);
  glaze(4.5, 5.4, 0.96, 1.0); glaze(4.5, 5.4, 0.0, 0.04);
  // cheek gun windows, radio room hatch, waist windows, tail glazing
  for (const [f0, f1] of [[0.27, 0.33], [0.67, 0.73]]) glaze(2.3, 2.95, f0, f1);
  glaze(10.9, 11.8, 0.0, 0.035); glaze(10.9, 11.8, 0.965, 1.0);
  glaze(13.6, 14.6, 0.18, 0.28, [14.1]);
  glaze(14.1, 15.1, 0.72, 0.82, [14.6]);
  for (const [f0, f1] of [[0.08, 0.22], [0.78, 0.92]]) glaze(21.65, 22.45, f0, f1, [22.05]);
  // bomb bay door outline + entrance door (right, aft)
  c.strokeStyle = 'rgba(10,10,10,0.6)'; c.lineWidth = Math.max(1, k * 0.02);
  { const [x0] = at(8.4, 0), [x1] = at(10.9, 0); const C = Cs[Math.round((x0 + x1) / 2)] * k; c.strokeRect(x0, C * 0.44, x1 - x0, C * 0.12); c.beginPath(); c.moveTo(x0, C * 0.5); c.lineTo(x1, C * 0.5); c.stroke(); }
  { const [x0] = at(16.4, 0), C = Cs[Math.round(16.4 * k)] * k; c.strokeRect(x0, C * 0.66, 0.75 * k, C * 0.13); }
  // wear: walkway/entry chips, cockpit, waist windows
  L.chips(...at(5.0, 0.18), k * 1.8, k * 0.8, 120);
  L.chips(...at(5.0, 0.82), k * 1.8, k * 0.8, 120);
  L.chips(...at(14.1, 0.25), k * 1.6, k * 0.8, 90);
  L.chips(...at(14.6, 0.75), k * 1.6, k * 0.8, 90);
  L.chips(...at(16.8, 0.72), k * 1.4, k * 1.0, 110);
  L.chips(...at(1.0, 0.5), k * 2.0, k * 1.5, 60);
  // national insignia both sides + codes
  const R = 0.58 * k;
  L.star(...at(15.95, 0.25), R, 0);
  L.star(...at(15.95, 0.75), R, Math.PI);
  const code = '#a7a9a2';
  L.text('LG', ...at(12.55, 0.25), 0.92 * k, code, 0);
  L.text('W', ...at(18.35, 0.25), 0.92 * k, code, 0);
  L.text('LG', ...at(12.55, 0.75), 0.92 * k, code, Math.PI);
  L.text('W', ...at(18.35, 0.75), 0.92 * k, code, Math.PI);
  // nose art + mission tally (left side)
  L.text('Franconia Belle', ...at(3.3, 0.2), 0.26 * k, '#e8d9a0', 0, 'italic bold');
  for (let i = 0; i < 14; i++) { const [x, y] = at(3.9 + (i % 7) * 0.13, 0.285 + Math.floor(i / 7) * 0.02); c.fillStyle = '#e9e2c8'; c.fillRect(x, y, 0.09 * k, 0.035 * k); }
  // exhaust / oil grime along the lower fuselage + near wing root
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0.3, 'rgba(20,18,12,0)'); g.addColorStop(0.45, 'rgba(20,18,12,0.12)'); g.addColorStop(0.7, 'rgba(20,18,12,0)');
  c.fillStyle = g;
  for (let x = 0; x < W; x++) { const C = Cs[x] * k; c.fillRect(x, C * 0.42, 1, C * 0.16); }
  return L.textures(2.2, q().anisotropy);
}

function paintWing(res, top) {
  const W = res, H = res / 4, k = W / 32;
  const L = new Livery(W, H, k);
  const { c } = L;
  c.fillStyle = top ? OD : NG; c.fillRect(0, 0, W, H);
  L.mottle(0.1);
  const X = (x) => (x / 32 + 0.5) * W, S = (s) => (s - 6.5) / 8 * H;
  // ribs (chordwise) and spars/stringers (spanwise)
  const xs = []; for (let x = -15.6; x <= 15.6; x += 0.62) xs.push(Math.round(X(x)) + 0.5);
  const ys = []; for (let s = 6.6; s < 14.4; s += 0.55) ys.push(Math.round(S(s)) + 0.5);
  L.panelLines(xs, ys);
  // de-icer boots (black rubber) along leading edge, outboard of the nacelles
  c.fillStyle = '#141414';
  for (let px = 0; px < W; px++) {
    const x = (px / W - 0.5) * 32; if (Math.abs(x) < 2.5 || Math.abs(x) > 15.6) continue;
    const w = wingAt(x); c.fillRect(px, S(w.le), 1, (0.09 * w.chord) / 8 * H);
    L.ac.fillStyle = 'rgb(255,230,0)'; L.ac.fillRect(px, S(w.le), 1, (0.09 * w.chord) / 8 * H);
  }
  // ailerons (fabric ribs) and flaps outline
  c.strokeStyle = 'rgba(10,10,10,0.5)'; c.lineWidth = Math.max(1, k * 0.02);
  for (const sgn of [1, -1]) {
    c.beginPath();
    for (let x = 2; x <= 15.4; x += 0.2) { const w = wingAt(x * sgn); const sx = X(x * sgn), sy = S(w.le + w.chord * 0.74); x === 2 ? c.moveTo(sx, sy) : c.lineTo(sx, sy); }
    c.stroke();
    for (let x = 10.4; x < 15.4; x += 0.3) { const w = wingAt(x * sgn); c.beginPath(); c.moveTo(X(x * sgn), S(w.le + w.chord * 0.74)); c.lineTo(X(x * sgn), S(w.le + w.chord)); c.strokeStyle = 'rgba(0,0,0,0.18)'; c.stroke(); }
  }
  if (top) {
    // oil streaks behind nacelles, walkway at root, fuel caps
    for (const ex of ENGINES) {
      const w = wingAt(ex);
      const gx = X(ex), gy = S(w.le + 0.3);
      const gr = c.createLinearGradient(0, gy, 0, gy + w.chord / 8 * H * 1.1);
      gr.addColorStop(0, 'rgba(12,11,8,0.55)'); gr.addColorStop(1, 'rgba(12,11,8,0)');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(gx - 0.6 * k, gy); c.lineTo(gx + 0.6 * k, gy); c.lineTo(gx + 1.0 * k, gy + w.chord / 8 * H); c.lineTo(gx - 1.0 * k, gy + w.chord / 8 * H); c.fill();
      L.chips(gx, gy + 0.6 * k, k * 1.4, k * 0.8, 50);
      c.fillStyle = '#2a2a22'; c.beginPath(); c.arc(X(ex + Math.sign(ex) * 1.3), S(w.le + w.chord * 0.3), 0.08 * k, 0, 7); c.fill();
    }
    for (const sgn of [1, -1]) { c.strokeStyle = 'rgba(0,0,0,0.6)'; c.strokeRect(X(sgn * 1.2) - (sgn > 0 ? 0 : 1.1 * k), S(8.0), 1.1 * k, 3.2 * k); L.chips(X(sgn * 1.8), S(9.5), k * 1.1, k * 3, 80); }
    const w = wingAt(10.6);
    L.star(X(10.6), S(w.le + w.chord * 0.45), 0.72 * k, 0);
  } else {
    // turbo exhaust soot behind the nacelles, wheel wells on inboard nacelles
    for (const ex of ENGINES) {
      const w = wingAt(ex);
      const gx = X(ex), gy = S(w.le + w.chord * 0.6);
      const gr = c.createLinearGradient(0, gy, 0, gy + 2.6 * k);
      gr.addColorStop(0, 'rgba(8,8,6,0.8)'); gr.addColorStop(1, 'rgba(8,8,6,0)');
      c.fillStyle = gr; c.fillRect(gx - 0.45 * k, gy, 0.9 * k, 2.6 * k);
    }
    const w = wingAt(-10.6);
    L.star(X(-10.6), S(w.le + w.chord * 0.45), 0.72 * k, Math.PI);
  }
  return L.textures(2.0, q().anisotropy);
}

function paintFin(res, mirror) {
  // canvas x = s (14..22.8), y = height down from top (5.0 -> 0.9)
  const W = res, H = res / 2, sRef = 14.0, sLen = 9.0, yTop = 5.0, yLen = 4.5;
  const k = W / sLen;
  const L = new Livery(W, H, k);
  const { c } = L;
  c.fillStyle = OD; c.fillRect(0, 0, W, H);
  L.mottle(0.1, 0.6);
  c.save();
  if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
  const X = (s) => (s - sRef) * k, Y = (y) => (yTop - y) * k;
  const xs = []; for (let s = 14.4; s < 23; s += 0.5) xs.push(Math.round(X(s)) + 0.5);
  const ys = []; for (let y = 1.2; y < 5; y += 0.55) ys.push(Math.round(Y(y)) + 0.5);
  L.panelLines(xs, ys);
  // rudder hinge line + fabric ribs
  c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(X(21.25), Y(4.8)); c.lineTo(X(21.45), Y(0.9)); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let y = 1.1; y < 4.8; y += 0.28) { c.beginPath(); c.moveTo(X(21.35), Y(y)); c.lineTo(X(22.6), Y(y)); c.stroke(); }
  c.restore();
  // markings drawn unmirrored text but mirrored position
  const px = (s) => mirror ? W - X(s) : X(s);
  // 91st BG "Triangle A"
  const cx = px(19.6), cy = Y(3.7), r = 0.75 * k;
  c.fillStyle = '#d8d5cb';
  c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.95, cy + r * 0.7); c.lineTo(cx - r * 0.95, cy + r * 0.7); c.closePath(); c.fill();
  L.text('A', cx, cy + r * 0.15, r * 1.05, OD);
  L.text('230604', px(19.7), Y(2.35), 0.36 * k, '#d9c457');
  L.chips(px(18.8), Y(1.6), k * 1.4, k * 0.6, 50);
  return L.textures(2.0, q().anisotropy);
}

function propDiscTexture() {
  const s = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.06, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(20,20,20,0.0)');
  g.addColorStop(0.15, 'rgba(20,20,20,0.35)');
  g.addColorStop(0.85, 'rgba(25,25,25,0.22)');
  g.addColorStop(0.9, 'rgba(200,170,40,0.35)');
  g.addColorStop(0.97, 'rgba(200,170,40,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, s, s);
  // subtle blade sweeps
  for (let i = 0; i < 3; i++) {
    c.save(); c.translate(s / 2, s / 2); c.rotate(i * Math.PI * 2 / 3);
    const gg = c.createLinearGradient(0, 0, s / 2, 0);
    gg.addColorStop(0, 'rgba(0,0,0,0.12)'); gg.addColorStop(1, 'rgba(0,0,0,0.0)');
    c.fillStyle = gg; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, s / 2, -0.25, 0.25); c.fill();
    c.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bladeGeometry() {
  const R = 1.765, n = 14;
  const pos = [], col = [], idx = [];
  const secN = 10;
  for (let i = 0; i <= n; i++) {
    const r = 0.2 + (R - 0.2) * (i / n);
    const f = r / R;
    const chord = f < 0.25 ? 0.16 + f * 0.4 : 0.27 * (1 - (f - 0.45) ** 2 * 1.6);
    const twist = THREE.MathUtils.degToRad(48 - 34 * f);
    const tip = f > 0.94;
    for (let j = 0; j <= secN; j++) {
      const xc = j / secN;
      for (const sgn of [1, -1]) void sgn;
    }
    for (let j = 0; j < secN * 2; j++) {
      const u = j < secN ? j / secN : 2 - j / secN;
      const up = j < secN ? 1 : -1;
      const c0 = (u - 0.35) * chord;
      const th = nacaT(Math.max(0.001, u), 0.1) * chord * up;
      // section in (x = chordwise, z = thickness) rotated by twist; blade radial along y
      const x = c0 * Math.cos(twist) - th * Math.sin(twist);
      const z = c0 * Math.sin(twist) + th * Math.cos(twist);
      pos.push(x, r, z);
      const c = tip ? [0.8, 0.62, 0.08] : [0.035, 0.035, 0.035];
      col.push(...c);
    }
  }
  const R2 = secN * 2;
  for (let i = 0; i < n; i++) for (let j = 0; j < R2; j++) {
    const a = i * R2 + j, b = i * R2 + (j + 1) % R2, c = a + R2, d = b + R2;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function gun(len = 1.45) {
  const g1 = new THREE.CylinderGeometry(0.035, 0.035, len, 8); g1.rotateX(Math.PI / 2); g1.translate(0, 0, len / 2);
  const g2 = new THREE.CylinderGeometry(0.055, 0.055, len * 0.55, 10); g2.rotateX(Math.PI / 2); g2.translate(0, 0, len * 0.3);
  const g3 = new THREE.BoxGeometry(0.14, 0.18, 0.9); g3.translate(0, 0, -0.35);
  return mergeGeometries([g1, g2, g3]);
}

export function makeBombGeometry() {
  const body = latheZ([[0, 0.0], [0.08, 0.1], [0.25, 0.17], [0.45, 0.18], [0.95, 0.18], [1.15, 0.13], [1.25, 0.07]], 16, 0.62);
  const fins = [];
  for (let i = 0; i < 4; i++) { const f = new THREE.BoxGeometry(0.01, 0.38, 0.34); f.rotateZ(i * Math.PI / 2 + Math.PI / 4); f.translate(0, 0, -0.75); fins.push(f); }
  const box = new THREE.CylinderGeometry(0.19, 0.19, 0.3, 12, 1, true); box.rotateX(Math.PI / 2); box.translate(0, 0, -0.78);
  const all = [body, ...fins, box].map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal'].includes(k)) n.deleteAttribute(k); return n; });
  return mergeGeometries(all);
}

export function buildB17(env) {
  const Q = q();
  const hi = Q.texRes === '2k';
  const root = new THREE.Group();
  root.name = 'B-17G';
  const mesh = (g, m, cast = true) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; return o; };
  const reg = (m) => { env.material(m); return m; };

  // ---------- fuselage
  const fg = loftBody(FUS, { z0: NOSE_Z, around: hi ? 64 : 40, along: hi ? 120 : 70, uLen: 22.66, vLen: 22.66 / 2 });
  const fT = paintFuselage(fg, hi ? 4096 : 2048);
  const fusMat = reg(new THREE.MeshStandardMaterial({ ...fT, metalnessMap: fT.roughnessMap, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }));
  root.add(mesh(fg, fusMat));

  // glazing overlay (nose cone + cockpit + waist + tail)
  const glassMat = reg(new THREE.MeshPhysicalMaterial({ color: 0xaab4b8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, envMapIntensity: 1.6 }));
  const glassShell = (s0, s1, f0, f1, off = 0.012) => {
    const interp = fg.userData.interp, ring = fg.userData.ring;
    const pos = [], idx = [];
    const ns = 12, na = 16;
    for (let j = 0; j <= ns; j++) {
      const s = s0 + (s1 - s0) * j / ns;
      const { w, yT, yB } = interp(s);
      for (let i = 0; i <= na; i++) {
        const th = (f0 + (f1 - f0) * i / na) * Math.PI * 2;
        const [x, y] = ring(w + off, yT + off * Math.sign(yT), yB - off, th);
        pos.push(x, y, zOf(s));
      }
    }
    for (let j = 0; j < ns; j++) for (let i = 0; i < na; i++) { const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const glassParts = [glassShell(0.0, 1.95, 0, 1, 0.01), glassShell(4.15, 5.55, 0.1, 0.23), glassShell(4.15, 5.55, 0.77, 0.9), glassShell(4.5, 5.4, 0.96, 1.04),
    glassShell(21.65, 22.45, 0.08, 0.22), glassShell(21.65, 22.45, 0.78, 0.92)];
  root.add(mesh(mergeGeometries(glassParts), glassMat, false));

  // ---------- wings
  const wStations = [];
  const spanPts = [];
  for (let i = 0; i <= 26; i++) { const f = i / 26; spanPts.push(WING.rootX + (WING.tipX - WING.rootX) * (1 - Math.cos(f * Math.PI / 2))); }
  const tipRound = (x) => { const d = WING.tipX - x; return d < 0.6 ? Math.sqrt(Math.max(0, d / 0.6)) : 1; };
  const side = (sgn) => {
    const st = [];
    const xs = sgn > 0 ? spanPts : [...spanPts].reverse();
    for (const ax of xs) {
      const w = wingAt(ax);
      const r = tipRound(ax);
      const chord = w.chord * (0.35 + 0.65 * r);
      st.push({ x: ax * sgn, le: w.le + (w.chord - chord) * 0.35, chord, y: w.y, t: w.t * Math.max(0.25, r), camber: 0.01 });
    }
    // extend root into the fuselage
    if (sgn > 0) st.unshift({ ...st[0], x: 0.3 }); else st.push({ ...st[st.length - 1], x: -0.3 });
    return st;
  };
  const wTop = paintWing(hi ? 4096 : 2048, true), wBot = paintWing(hi ? 4096 : 2048, false);
  const wingTopMat = reg(new THREE.MeshStandardMaterial({ ...wTop, metalnessMap: wTop.roughnessMap, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }));
  const wingBotMat = reg(new THREE.MeshStandardMaterial({ ...wBot, metalnessMap: wBot.roughnessMap, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.6, 0.6) }));
  for (const sgn of [1, -1]) {
    const g = loftWing(side(sgn), { z0: NOSE_Z, n: hi ? 26 : 16, uSpan: 32, sRef: 6.5, vLen: 8 });
    root.add(mesh(g, [wingTopMat, wingBotMat]));
  }

  // ---------- horizontal stabiliser
  const stabTop = panelTexture(OD, 96, 512), stabBot = panelTexture(NG, 96, 512);
  const stabTopMat = reg(new THREE.MeshStandardMaterial({ ...stabTop, roughness: 0.8, metalness: 0.05 }));
  const stabBotMat = reg(new THREE.MeshStandardMaterial({ ...stabBot, roughness: 0.8, metalness: 0.05 }));
  for (const sgn of [1, -1]) {
    const st = [];
    const xs = [0.2, 0.8, 2, 3.5, 5, 6.1, 6.55, 6.7];
    for (const x of (sgn > 0 ? xs : [...xs].reverse())) {
      const f = x / 6.7;
      const chord = 3.6 - 2.0 * f - (x > 6.1 ? (x - 6.1) * 1.6 : 0);
      const le = 19.1 + f * 1.9 + (3.6 - 2.0 * f - chord) * 0.4;
      st.push({ x: x * sgn, le, chord: Math.max(0.3, chord), y: 0.42, t: 0.12 });
    }
    const g = loftWing(st, { z0: NOSE_Z, n: 12, uSpan: 5, sRef: 18, vLen: 5 });
    root.add(mesh(g, [stabTopMat, stabBotMat]));
  }

  // ---------- vertical fin with dorsal fillet
  const finL = paintFin(hi ? 1024 : 512, false), finR = paintFin(hi ? 1024 : 512, true);
  const finMatL = reg(new THREE.MeshStandardMaterial({ ...finL, roughness: 0.85, metalness: 0.05 }));
  const finMatR = reg(new THREE.MeshStandardMaterial({ ...finR, roughness: 0.85, metalness: 0.05 }));
  const finSt = [];
  for (let y = 0.95; y <= 4.95; y += 0.25) {
    const f = (y - 0.95) / 4.0;
    const leFillet = 14.2 + Math.pow(f, 0.45) * 5.7;     // dorsal fillet sweeps forward at the root
    const le = Math.min(leFillet + (f > 0.85 ? (f - 0.85) * 8 : 0), 21.9);
    const te = 22.75 - f * 0.25 - (f > 0.9 ? (f - 0.9) * 6 : 0);
    finSt.push({ y, le, chord: Math.max(0.3, te - le), t: 0.12 * Math.min(1, 1.4 - f * 0.4) * (f < 0.15 ? 0.6 + f * 2.6 : 1) });
  }
  const fin = loftWing(finSt, { z0: NOSE_Z, n: 12, vertical: true, sRef: 14, vLen: 9, uSpan: 4.5, yTop: 5.0 });
  root.add(mesh(fin, [finMatL, finMatR]));

  // ---------- nacelles, engines, props
  const nacT = panelTexture(OD, 110, 512, { chips: 40 });
  for (const k of Object.keys(nacT)) nacT[k].repeat.set(2, 1);
  const nacMat = reg(new THREE.MeshStandardMaterial({ ...nacT, roughness: 0.8, metalness: 0.1 }));
  const darkMetal = reg(new THREE.MeshStandardMaterial({ color: 0x1e1e1c, roughness: 0.45, metalness: 0.7 }));
  const engineMat = reg(new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 0.55, metalness: 0.6 }));
  const rubber = reg(new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
  const propMat = reg(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide }));
  const discMat = new THREE.MeshBasicMaterial({ map: propDiscTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: true });
  const blade = bladeGeometry();
  const props = [], engines = [];
  const nacGeoms = [], engGeoms = [];
  for (const ex of ENGINES) {
    const w = wingAt(ex);
    const inboard = Math.abs(ex) < 6;
    const front = w.le - (inboard ? 2.35 : 1.75);
    const y = w.y - 0.02;
    const len = (w.le + w.chord) - front + (inboard ? 1.2 : 0.3);
    const prof = [[0, 0.62], [0.05, 0.7], [0.25, 0.73], [1.35, 0.73], [1.45, 0.76], [2.0, 0.72], [len * 0.55, 0.62], [len * 0.8, 0.42], [len, 0.08]];
    const g = latheZ(prof, 28, 0);
    g.scale(1, inboard ? 1.1 : 0.98, 1);
    g.translate(ex, y - (inboard ? 0.12 : 0.05), zOf(front));
    nacGeoms.push(g);
    // engine face: crankcase + 9 cylinders + cowl lip
    const face = [];
    const cc = new THREE.CylinderGeometry(0.28, 0.32, 0.3, 16); cc.rotateX(Math.PI / 2); face.push(cc);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      const cyl = new THREE.CylinderGeometry(0.1, 0.12, 0.34, 10); cyl.translate(0, 0.43, 0); cyl.rotateZ(a); face.push(cyl);
    }
    const fg2 = mergeGeometries(face.map(q2 => q2.index ? q2.toNonIndexed() : q2).map(q2 => { for (const k of Object.keys(q2.attributes)) if (!['position', 'normal'].includes(k)) q2.deleteAttribute(k); return q2; }));
    fg2.translate(ex, y - (inboard ? 0.12 : 0.05), zOf(front) - 0.25);
    engGeoms.push(fg2);
    // turbo-supercharger under nacelle
    const tb = new THREE.CylinderGeometry(0.2, 0.2, 0.18, 14); tb.translate(ex, y - 0.62, zOf(w.le + w.chord * 0.55));
    engGeoms.push(tb.toNonIndexed());
    // prop
    const hub = new THREE.Group();
    hub.position.set(ex, y - (inboard ? 0.12 : 0.05), zOf(front) + 0.38);
    const blades = new THREE.Group();
    for (let b = 0; b < 3; b++) { const m = mesh(blade, propMat); m.rotation.z = b * Math.PI * 2 / 3; blades.add(m); }
    const dome = latheZ([[0, 0.02], [0.08, 0.16], [0.25, 0.24], [0.45, 0.24]], 16, 0.25);
    blades.add(mesh(dome, darkMetal));
    hub.add(blades);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.78, 48), discMat);
    disc.renderOrder = 5;
    hub.add(disc);
    root.add(hub);
    props.push({ hub, blades, disc, angle: Math.random() * 6 });
    engines.push(new THREE.Vector3(ex, y + 0.35, zOf(w.le + 0.8)));
    // main wheels partially exposed under inboard nacelles
    if (inboard) {
      const tire = new THREE.TorusGeometry(0.46, 0.2, 10, 24); tire.rotateY(Math.PI / 2);
      tire.translate(ex, y - 0.78, zOf(w.le + 0.6));
      root.add(mesh(tire, rubber));
    }
  }
  root.add(mesh(mergeGeometries(nacGeoms.map(g => { const n = g.toNonIndexed(); return n; })), nacMat));
  root.add(mesh(mergeGeometries(engGeoms.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal'].includes(k)) n.deleteAttribute(k); return n; })), engineMat));
  // cowl flaps ring
  // ---------- turrets & guns
  const gunG = gun();
  const turrets = {};
  const plexi = glassMat;
  const mkTurret = (name, pos, opts) => {
    const yaw = new THREE.Group(); yaw.position.copy(pos);
    const pitch = new THREE.Group(); yaw.add(pitch);
    const muzzles = [];
    for (const gx of opts.guns) {
      const gm = mesh(gunG, darkMetal); gm.position.set(gx, 0, opts.gunZ ?? 0.2); pitch.add(gm);
      const mz = new THREE.Object3D(); mz.position.set(gx, 0, (opts.gunZ ?? 0.2) + 1.45); pitch.add(mz); muzzles.push(mz);
    }
    root.add(yaw);
    turrets[name] = { yaw, pitch, muzzles, ...opts, base: pos.clone(), aimYaw: opts.restYaw ?? 0, aimPitch: 0 };
    return turrets[name];
  };
  // top turret (Sperry) with dome
  const tt = mkTurret('top', new THREE.Vector3(0, 1.92, zOf(6.55)), { guns: [0.14, -0.14], yawMin: -Math.PI, yawMax: Math.PI, pitchMin: -0.05, pitchMax: 1.45, restYaw: 0 });
  const dome = new THREE.SphereGeometry(0.52, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  tt.yaw.add(mesh(dome, plexi, false));
  const ring = new THREE.CylinderGeometry(0.56, 0.6, 0.18, 20); ring.translate(0, -0.08, 0);
  tt.yaw.add(mesh(ring, nacMat));
  // ball turret
  const bt = mkTurret('ball', new THREE.Vector3(0, -1.25, zOf(12.1)), { guns: [0.09, -0.09], gunZ: 0.15, yawMin: -Math.PI, yawMax: Math.PI, pitchMin: -1.57, pitchMax: 0.05, restYaw: Math.PI });
  const ball = new THREE.SphereGeometry(0.56, 20, 14);
  bt.pitch.add(mesh(ball, nacMat));
  const bwin = new THREE.CircleGeometry(0.22, 16); bwin.translate(0, 0, 0.565);
  bt.pitch.add(mesh(bwin, plexi, false));
  // chin turret (Bendix)
  const ct = mkTurret('chin', new THREE.Vector3(0, -1.05, zOf(1.35)), { guns: [0.16, -0.16], gunZ: 0.2, yawMin: -1.4, yawMax: 1.4, pitchMin: -0.9, pitchMax: 0.4 });
  ct.yaw.add(mesh(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), nacMat));
  // tail guns (Cheyenne)
  mkTurret('tail', new THREE.Vector3(0, 0.55, zOf(22.35)), { guns: [0.12, -0.12], gunZ: 0.1, yawMin: Math.PI - 0.5, yawMax: Math.PI + 0.5, pitchMin: -0.5, pitchMax: 0.5, restYaw: Math.PI });
  // waist guns (flexible, staggered)
  mkTurret('waistL', new THREE.Vector3(0.98, 0.45, zOf(14.1)), { guns: [0], gunZ: 0.05, yawMin: 0.35, yawMax: 2.8, pitchMin: -0.9, pitchMax: 0.9, restYaw: Math.PI / 2 });
  mkTurret('waistR', new THREE.Vector3(-0.98, 0.45, zOf(14.6)), { guns: [0], gunZ: 0.05, yawMin: -2.8, yawMax: -0.35, pitchMin: -0.9, pitchMax: 0.9, restYaw: -Math.PI / 2 });
  // cheek guns
  mkTurret('cheekL', new THREE.Vector3(0.95, -0.25, zOf(2.6)), { guns: [0], gunZ: 0.0, yawMin: 0.1, yawMax: 1.2, pitchMin: -0.5, pitchMax: 0.5, restYaw: 0.5 });
  mkTurret('cheekR', new THREE.Vector3(-0.95, -0.25, zOf(2.6)), { guns: [0], gunZ: 0.0, yawMin: -1.2, yawMax: -0.1, pitchMin: -0.5, pitchMax: 0.5, restYaw: -0.5 });
  for (const t of Object.values(turrets)) { t.yaw.rotation.y = t.aimYaw; }

  // ---------- crew silhouettes in the cockpit and turrets (unrigged, static)
  const crewMat = reg(new THREE.MeshStandardMaterial({ color: 0x3b2c1e, roughness: 0.9 }));
  const jacket = reg(new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 }));
  for (const cx of [0.45, -0.45]) {
    const head = mesh(new THREE.SphereGeometry(0.13, 12, 8), crewMat); head.position.set(cx, 1.28, zOf(5.0)); root.add(head);
    const body = mesh(new THREE.BoxGeometry(0.45, 0.5, 0.3), jacket); body.position.set(cx, 0.95, zOf(5.1)); root.add(body);
  }
  { const head = mesh(new THREE.SphereGeometry(0.13, 12, 8), crewMat); head.position.set(0, 0.25, 0); tt.yaw.add(head); }

  // ---------- bomb bay: doors + 12 x 500 lb bombs
  const doorMat = fusMat;
  const doors = [];
  for (const sgn of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.55 * sgn, -1.12, zOf(9.65));
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.03, 2.5), reg(new THREE.MeshStandardMaterial({ color: NG, roughness: 0.8 })));
    d.position.set(-0.28 * sgn, 0, 0);
    d.castShadow = true;
    pivot.add(d);
    root.add(pivot);
    doors.push({ pivot, sgn });
  }
  void doorMat;
  const bombGeom = makeBombGeometry();
  const bombMat = reg(new THREE.MeshStandardMaterial({ color: 0x3d3f2c, roughness: 0.6, metalness: 0.3 }));
  const bay = new THREE.Group();
  const bombSlots = [];
  for (let lvl = 0; lvl < 6; lvl++) for (const sx of [0.42, -0.42]) {
    const b = mesh(bombGeom, bombMat, false);
    b.position.set(sx, -0.75 + lvl * 0.36, zOf(9.6) + (lvl % 2 ? 0.3 : -0.3));
    bay.add(b); bombSlots.push(b);
  }
  root.add(bay);

  // antenna wire (mast above cockpit to fin tip)
  const wire = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.95, zOf(6.0)), new THREE.Vector3(0, 4.6, zOf(21.2))]);
  root.add(new THREE.Line(wire, new THREE.LineBasicMaterial({ color: 0x111111 })));
  const mast = mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.4, 6), darkMetal); mast.position.set(0, 1.8, zOf(6.0)); root.add(mast);

  root.traverse(o => { if (o.isMesh) o.frustumCulled = true; });
  return { root, props, turrets, doors, bombSlots, engines, bombGeom, bombMat, mats: { fusMat, wingTopMat } };
}

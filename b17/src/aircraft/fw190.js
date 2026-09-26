// Focke-Wulf Fw 190 A-8 (length 9.0 m, span 10.5 m), RLM 74/75/76 scheme with JG 1-style yellow cowl band.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loftBody, loftWing, latheZ } from './loft.js';
import { Livery } from './paint.js';

const NOSE = 3.1;   // origin near CG
const FUS = [
  { s: 0.0, w: 0.46, yT: 0.46, yB: -0.5 },
  { s: 0.3, w: 0.64, yT: 0.64, yB: -0.66 },
  { s: 1.2, w: 0.66, yT: 0.66, yB: -0.72 },
  { s: 2.2, w: 0.6, yT: 0.62, yB: -0.74 },
  { s: 3.0, w: 0.52, yT: 0.66, yB: -0.72 },
  { s: 4.2, w: 0.44, yT: 0.6, yB: -0.6 },
  { s: 5.6, w: 0.32, yT: 0.46, yB: -0.44 },
  { s: 7.2, w: 0.18, yT: 0.34, yB: -0.28 },
  { s: 8.4, w: 0.09, yT: 0.28, yB: -0.12 },
  { s: 9.0, w: 0.03, yT: 0.2, yB: -0.02 },
];

function balken(c, x, y, s, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = '#e9e7e0'; c.fillRect(-s / 2, -s / 2, s, s);
  c.fillStyle = '#111'; const a = s * 0.28;
  c.fillRect(-s / 2, -a / 2, s, a); c.fillRect(-a / 2, -s / 2, a, s);
  c.restore();
}

function paint(g) {
  const W = 1024, H = 512, k = W / 9;
  const L = new Livery(W, H, k);
  const { c } = L;
  const interp = g.userData.interp, ring = g.userData.ring;
  const C = (s) => { const { w, yT, yB } = interp(s); let a = 0, p = null; for (let i = 0; i <= 48; i++) { const q = ring(w, yT, yB, i / 48 * Math.PI * 2); if (p) a += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return a; };
  for (let x = 0; x < W; x++) {
    const cc = C(x / k) * k;
    const t = 0.3 + Math.sin(x * 0.05) * 0.015;
    c.fillStyle = '#5f6362'; c.fillRect(x, 0, 1, cc * t);                // RLM 74/75 greys
    c.fillStyle = '#9da6a8'; c.fillRect(x, cc * t, 1, cc * (1 - 2 * t)); // RLM 76 light blue
    c.fillStyle = '#5f6362'; c.fillRect(x, cc * (1 - t), 1, H - cc * (1 - t));
  }
  // side mottle
  for (let i = 0; i < 400; i++) { const x = Math.random() * W, y = Math.random() * H; c.fillStyle = `rgba(70,74,70,${Math.random() * 0.35})`; c.beginPath(); c.arc(x, y, 4 + Math.random() * 10, 0, 7); c.fill(); }
  L.mottle(0.1, 0.4);
  const xs = []; for (let s = 0.5; s < 9; s += 0.45) xs.push(Math.round(s * k) + 0.5);
  L.panelLines(xs, []);
  // yellow lower cowl + fuselage band, Balkenkreuz, canopy dark
  for (let x = 0; x < 1.3 * k; x++) { const cc = C(x / k) * k; c.fillStyle = '#c9a431'; c.fillRect(x, cc * 0.42, 1, cc * 0.16); }
  for (let x = 6.3 * k; x < 6.75 * k; x++) { const cc = C(x / k) * k; c.fillStyle = '#b72c1e'; c.fillRect(x, 0, 1, cc); }
  for (let x = 2.35 * k; x < 3.55 * k; x++) { const cc = C(x / k) * k; c.fillStyle = '#101214'; c.fillRect(x, 0, 1, cc * 0.12); c.fillRect(x, cc * 0.88, 1, cc * 0.12); }
  const mid = (s, f) => [s * k, C(s) * k * f];
  balken(c, ...mid(5.3, 0.25), 0.62 * k);
  balken(c, ...mid(5.3, 0.75), 0.62 * k, Math.PI);
  L.text('< 7', ...mid(4.4, 0.25), 0.5 * k, '#1a1a1a');
  L.chips(1.5 * k, C(2.8) * k * 0.2, k * 1.2, k * 0.6, 40);
  L.chips(1.5 * k, C(2.8) * k * 0.8, k * 1.2, k * 0.6, 40);
  return L.textures(2.0, 4);
}

function paintWing(top) {
  const W = 1024, H = 256, k = W / 11;
  const L = new Livery(W, H, k);
  const { c } = L;
  c.fillStyle = top ? '#5c605f' : '#9da6a8'; c.fillRect(0, 0, W, H);
  if (top) for (let i = 0; i < 12; i++) { c.fillStyle = '#4b504d'; c.beginPath(); const x = Math.random() * W; c.moveTo(x, 0); c.lineTo(x + 120, 0); c.lineTo(x + 40, H); c.lineTo(x - 80, H); c.fill(); }
  L.mottle(0.1, 0.5);
  const xs = []; for (let x = -5.5; x < 5.5; x += 0.5) xs.push(Math.round((x / 11 + 0.5) * W) + 0.5);
  L.panelLines(xs, []);
  for (const sgn of [1, -1]) balken(c, (sgn * 3.6 / 11 + 0.5) * W, H * 0.45, 0.7 * k);
  return L.textures(2.0, 4);
}

let SHARED = null;
function shared(env) {
  if (SHARED) return SHARED;
  const fg = loftBody(FUS, { z0: NOSE, around: 28, along: 40, uLen: 9, vLen: 4.5 });
  const T = paint(fg);
  const reg = (m) => { env.material(m); return m; };
  const fus = reg(new THREE.MeshStandardMaterial({ ...T, metalnessMap: T.roughnessMap, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.5, 0.5) }));
  const wt = paintWing(true), wb = paintWing(false);
  const wTop = reg(new THREE.MeshStandardMaterial({ ...wt, metalnessMap: wt.roughnessMap, roughness: 1, metalness: 1 }));
  const wBot = reg(new THREE.MeshStandardMaterial({ ...wb, metalnessMap: wb.roughnessMap, roughness: 1, metalness: 1 }));
  const wings = [];
  for (const sgn of [1, -1]) {
    const xs = [0.3, 0.6, 1.5, 2.6, 3.8, 4.8, 5.1, 5.25];
    const st = (sgn > 0 ? xs : [...xs].reverse()).map(x => {
      const f = (x - 0.6) / 4.65;
      let chord = 2.3 - 1.1 * Math.max(0, f); if (x > 4.8) chord *= Math.sqrt(Math.max(0.05, (5.25 - x) / 0.45));
      return { x: x * sgn, le: 2.45 + Math.max(0, f) * 0.35 + (2.3 - 1.1 * Math.max(0, f) - chord) * 0.4, chord, y: -0.42 + Math.tan(0.1) * x, t: 0.15 - 0.06 * Math.max(0, f) };
    });
    wings.push(loftWing(st, { z0: NOSE, n: 10, uSpan: 11, sRef: 2.3, vLen: 3 }));
  }
  const tails = [];
  for (const sgn of [1, -1]) {
    const xs = [0.1, 0.8, 1.6, 1.82];
    const st = (sgn > 0 ? xs : [...xs].reverse()).map(x => ({ x: x * sgn, le: 7.7 + x * 0.2, chord: 1.1 - x * 0.35, y: 0.18, t: 0.1 }));
    tails.push(loftWing(st, { z0: NOSE, n: 6, uSpan: 11, sRef: 2.3, vLen: 3 }));
  }
  const fin = loftWing([0.25, 0.7, 1.1, 1.45].map(y => ({ y, le: 7.6 + (y - 0.25) * 0.55, chord: 1.4 - (y - 0.25) * 0.75, t: 0.1 })), { z0: NOSE, n: 6, vertical: true, sRef: 0, vLen: 9, uSpan: 4.5, yTop: 2 });
  const canopy = new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.9, 0.9, 2.1); canopy.translate(0, 0.58, NOSE - 3.1);
  const glass = reg(new THREE.MeshPhysicalMaterial({ color: 0x9aa4a8, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }));
  const dark = reg(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4 }));
  const engine = latheZ([[0, 0.3], [0.08, 0.5], [0.15, 0.52]], 20, NOSE + 0.02);
  const spinner = latheZ([[0, 0.02], [0.2, 0.18], [0.45, 0.26]], 16, NOSE + 0.5);
  const blade = new THREE.BoxGeometry(0.22, 1.6, 0.05); blade.translate(0, 0.85, 0);
  const blades = mergeGeometries([0, 1, 2].map(i => blade.clone().rotateZ(i * Math.PI * 2 / 3)));
  const disc = new THREE.CircleGeometry(1.65, 32);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const pilot = new THREE.SphereGeometry(0.14, 10, 8); pilot.translate(0, 0.62, NOSE - 3.25);
  SHARED = { fg, fus, wings, tails, fin, wTop, wBot, canopy, glass, dark, engine, spinner, blades, disc, discMat, pilot };
  return SHARED;
}

export function buildFw190(env) {
  const S = shared(env);
  const root = new THREE.Group();
  const m = (g, mat) => { const o = new THREE.Mesh(g, mat); o.castShadow = true; return o; };
  root.add(m(S.fg, S.fus));
  for (const w of S.wings) root.add(m(w, [S.wTop, S.wBot]));
  for (const t of S.tails) root.add(m(t, [S.wTop, S.wBot]));
  root.add(m(S.fin, [S.fus, S.fus]));
  root.add(m(S.canopy, S.glass));
  root.add(m(S.engine, S.dark));
  root.add(m(S.pilot, S.dark));
  const prop = new THREE.Group(); prop.position.z = NOSE + 0.45;
  prop.add(m(S.blades, S.dark));
  const spin = m(S.spinner, S.dark); spin.position.z = -(NOSE + 0.45); prop.add(spin);
  const disc = new THREE.Mesh(S.disc, S.discMat); prop.add(disc);
  root.add(prop);
  return { root, prop };
}

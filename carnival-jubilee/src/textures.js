import * as THREE from 'three';
import { rng, clamp } from './util.js';

let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

const memo = new Map();
function cached(key, make) {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
}

function tex(c, { srgb = true, repeat = false, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso ? maxAniso : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------- tileable value noise ----------
const GRID = 256;
function makeNoise(seed) {
  const r = rng(seed);
  const g = new Float32Array(GRID * GRID);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const p = period;
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * GRID + x0], b = g[y0 * GRID + x1], c = g[y1 * GRID + x0], d = g[y1 * GRID + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(noise, x, y, period, oct = 5, gain = 0.5) {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    const p = Math.min(GRID, period * f);
    sum += amp * noise(x * f, y * f, p);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}

function pixels(w, h, fn) {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, out);
      const i = (y * w + x) * 4;
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return [c, ctx];
}

// ---------- ocean ----------
export function waterNormals() {
  return tex(cached('water', waterCanvas), { srgb: false, repeat: true });
}
function waterCanvas() {
  const S = 512;
  const noise = makeNoise(11);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    let h = fbm(noise, u * 8, v * 8, 8, 5, 0.55);
    // directional swell components with integer frequencies keep it tileable
    h += 0.18 * Math.sin((u * 3 + v * 2) * Math.PI * 2);
    h += 0.10 * Math.sin((u * 5 - v * 4) * Math.PI * 2 + 1.3);
    hgt[y * S + x] = h;
  }
  const [c] = pixels(S, S, (x, y, o) => {
    const l = hgt[y * S + ((x - 1 + S) % S)], r = hgt[y * S + ((x + 1) % S)];
    const t = hgt[((y - 1 + S) % S) * S + x], b = hgt[((y + 1) % S) * S + x];
    let nx = (l - r) * 6, ny = (t - b) * 6, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    o[0] = (nx / len * 0.5 + 0.5) * 255; o[1] = (ny / len * 0.5 + 0.5) * 255; o[2] = (nz / len * 0.5 + 0.5) * 255; o[3] = 255;
  });
  return c;
}

export function foamTexture() {
  const S = 256;
  const noise = makeNoise(21);
  const [c] = pixels(S, S, (x, y, o) => {
    const n = fbm(noise, x / S * 16, y / S * 16, 16, 5, 0.6);
    const cells = fbm(noise, x / S * 32 + 5, y / S * 32, 32, 3, 0.5);
    const f = clamp((n * 0.7 + cells * 0.5 - 0.45) * 3.2, 0, 1);
    o[0] = o[1] = o[2] = 255; o[3] = f * 255;
  });
  return tex(c, { srgb: true, repeat: true });
}

// ---------- hull livery ----------
// u: 0 at stern (x=-172) .. 1 at bow (x=+172); v: z from -9 (0) to 18 (1)
export const HULL = { xMin: -172, xMax: 172, zMin: -9, zMax: 18 };
export function hullTextures() {
  const W = 4096, H = 512;
  const px = (x) => (x - HULL.xMin) / (HULL.xMax - HULL.xMin) * W;
  const py = (z) => (1 - (z - HULL.zMin) / (HULL.zMax - HULL.zMin)) * H;
  const r = rng(7);
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  const [cr, gr] = canvas(W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  // Livery: white hull, navy bow sweeping aft into a waterline band, red pinstripe on the edge.
  const sheer = (x) => { const t = clamp((x - 40) / 132, 0, 1); return 14 + 3.2 * t * t + 1.15 * clamp((x - 100) / 18, 0, 1); };
  const edge = (x) => {
    const t = clamp((x + 70) / 125, 0, 1);
    const k = t * t * (3 - 2 * t);
    return Math.min(sheer(x) + 0.5, 1.9 + (sheer(x) + 0.5 - 1.9) * Math.pow(k, 1.25));
  };
  g.fillStyle = '#f2f3f5'; g.fillRect(0, 0, W, H);
  const navyPath = (ctx, off) => {
    ctx.beginPath(); ctx.moveTo(0, py(-0.2));
    for (let x = HULL.xMin; x <= HULL.xMax; x += 1) ctx.lineTo(px(x), py(edge(x) + off));
    ctx.lineTo(W, py(-0.2)); ctx.closePath();
  };
  // red pinstripe first, then navy slightly below it so the stripe shows as a clean edge
  g.fillStyle = '#d3182f'; navyPath(g, 0.62); g.fill();
  g.fillStyle = '#f2f3f5'; navyPath(g, 0.24); g.fill();
  const ng = g.createLinearGradient(0, 0, 0, H);
  ng.addColorStop(0, '#11297c'); ng.addColorStop(1, '#0c1f62');
  g.fillStyle = ng; navyPath(g, 0); g.fill();
  gr.fillStyle = '#5a5a5a'; gr.fillRect(0, 0, W, H);
  // antifouling below waterline
  g.fillStyle = '#8a1c22'; g.fillRect(0, py(-0.2), W, H);
  gr.fillStyle = '#b0b0b0'; gr.fillRect(0, py(-0.2), W, H);
  // plate seams
  g.globalAlpha = 0.06; g.strokeStyle = '#050c20'; g.lineWidth = 1.2;
  for (let x = HULL.xMin; x < HULL.xMax; x += 11.5) { g.beginPath(); g.moveTo(px(x), py(18)); g.lineTo(px(x), py(-9)); g.stroke(); }
  for (let z = -8; z < 18; z += 2.4) { g.beginPath(); g.moveTo(0, py(z)); g.lineTo(W, py(z)); g.stroke(); }
  g.globalAlpha = 1;
  // weathering streaks
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y0 = py(14 - r() * 12), len = 10 + r() * 60;
    const gg = g.createLinearGradient(0, y0, 0, y0 + len);
    gg.addColorStop(0, 'rgba(40,40,50,0.05)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg; g.fillRect(x, y0, 1 + r() * 2, len);
  }
  // window rows
  const windowRow = (z, h, w, spacing, x0, x1, round, pair) => {
    for (let x = x0; x < x1; x += spacing) {
      const xs = pair ? [x, x + w * 1.6] : [x];
      for (const xx of xs) {
        const X = px(xx), Y = py(z + h / 2), Wp = px(xx + w) - X, Hp = py(z - h / 2) - Y;
        g.fillStyle = '#c8d0dc'; // frame
        g.beginPath();
        if (round) g.ellipse(X + Wp / 2, Y + Hp / 2, Wp / 2 + 1.2, Hp / 2 + 1.2, 0, 0, Math.PI * 2); else g.roundRect(X - 1, Y - 1, Wp + 2, Hp + 2, 2);
        g.fill();
        const wg = g.createLinearGradient(0, Y, 0, Y + Hp);
        wg.addColorStop(0, '#5f7896'); wg.addColorStop(0.45, '#1b2638'); wg.addColorStop(1, '#0e1522');
        g.fillStyle = wg;
        g.beginPath();
        if (round) g.ellipse(X + Wp / 2, Y + Hp / 2, Wp / 2, Hp / 2, 0, 0, Math.PI * 2); else g.roundRect(X, Y, Wp, Hp, 1.5);
        g.fill();
        gr.fillStyle = '#101010'; gr.fillRect(X, Y, Wp, Hp);
        if (r() < 0.45) {
          const warm = r();
          ge.fillStyle = warm < 0.7 ? `rgb(255,${190 + (r() * 30) | 0},${110 + (r() * 40) | 0})` : 'rgb(200,220,255)';
          ge.globalAlpha = 0.5 + r() * 0.5;
          ge.fillRect(X, Y, Wp, Hp);
          ge.globalAlpha = 1;
        }
      }
    }
  };
  windowRow(3.0, 0.55, 0.55, 3.2, -128, 138, true, true);
  windowRow(5.6, 0.55, 0.55, 3.2, -132, 142, true, true);
  windowRow(8.6, 1.0, 1.7, 4.2, -140, 146, false, false);
  windowRow(11.2, 1.0, 1.7, 4.2, -144, 150, false, false);
  // anchor pockets
  for (const [x, z] of [[156, 9.5]]) {
    const X = px(x), Y = py(z);
    g.fillStyle = '#0a1330'; g.beginPath(); g.ellipse(X, Y, 16, 22, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c9d0dc'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#2a2f38'; g.beginPath(); g.moveTo(X - 7, Y - 14); g.lineTo(X + 7, Y - 14); g.lineTo(X + 4, Y + 16); g.lineTo(X - 4, Y + 16); g.fill();
  }
  // mooring openings near stern and bow
  for (const x of [-160, -150, 140, 150]) {
    g.fillStyle = '#040810'; g.beginPath(); g.roundRect(px(x), py(14.8), 26, 14, 6); g.fill();
  }
  // bow thruster tunnel markings (below waterline)
  g.strokeStyle = '#4a1214'; g.lineWidth = 3;
  for (const x of [148, 152, 156]) { g.beginPath(); g.arc(px(x), py(-5), 12, 0, Math.PI * 2); g.stroke(); }
  return { map: tex(c), emissive: tex(ce), rough: tex(cr, { srgb: false }) };
}

// ---------- balcony facade ----------
// Tile covers 8 cabins (8 * 4.2 m = 33.6 m) and 4 decks (4 * 3 m = 12 m).
export const BALC = { w: 33.6, h: 12 };
export function balconyTextures(seed = 3) {
  const W = 2048, H = 768;
  const cw = W / 8, ch = H / 4;
  const r = rng(seed);
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  const [cr, gr] = canvas(W, H);
  const [cm, gm] = canvas(W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  gr.fillStyle = '#8c8c8c'; gr.fillRect(0, 0, W, H);
  gm.fillStyle = '#000'; gm.fillRect(0, 0, W, H);
  const curtains = ['#d9c9a8', '#c7b79a', '#b8c4cc', '#e2d6bf', '#a9b4bf'];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 8; i++) {
    const x = i * cw, y = j * ch;
    // recess back wall
    const rg = g.createLinearGradient(0, y, 0, y + ch);
    rg.addColorStop(0, '#8d949e'); rg.addColorStop(0.3, '#c9ced4'); rg.addColorStop(1, '#dfe2e6');
    g.fillStyle = rg; g.fillRect(x, y, cw, ch);
    // sliding door (glass) and fixed pane
    const dx = x + cw * 0.12, dw = cw * 0.76, dy = y + ch * 0.16, dh = ch * 0.72;
    const glass = g.createLinearGradient(0, dy, 0, dy + dh);
    glass.addColorStop(0, '#6f8aa6'); glass.addColorStop(0.35, '#2b3b52'); glass.addColorStop(1, '#141c28');
    g.fillStyle = glass; g.fillRect(dx, dy, dw, dh);
    gr.fillStyle = '#0c0c0c'; gr.fillRect(dx, dy, dw, dh);
    gm.fillStyle = '#6a6a6a'; gm.fillRect(dx, dy, dw, dh);
    // curtains visible through glass
    const cc = curtains[(r() * curtains.length) | 0];
    g.globalAlpha = 0.55; g.fillStyle = cc;
    const open = 0.15 + r() * 0.3;
    g.fillRect(dx, dy, dw * open * 0.5, dh); g.fillRect(dx + dw * (1 - open * 0.5), dy, dw * open * 0.5, dh);
    g.globalAlpha = 1;
    // interior glow at night
    if (r() < 0.55) {
      const eg = ge.createLinearGradient(0, dy, 0, dy + dh);
      const warm = r() < 0.8;
      eg.addColorStop(0, warm ? 'rgba(255,196,120,0.95)' : 'rgba(190,210,255,0.8)');
      eg.addColorStop(1, warm ? 'rgba(255,150,70,0.5)' : 'rgba(120,150,220,0.4)');
      ge.fillStyle = eg; ge.fillRect(dx, dy, dw, dh);
      ge.fillStyle = 'rgba(0,0,0,0.5)';
      ge.fillRect(dx, dy, dw * open * 0.5, dh); ge.fillRect(dx + dw * (1 - open * 0.5), dy, dw * open * 0.5, dh);
    }
    // door frames / mullion
    g.fillStyle = '#e8ebef';
    g.fillRect(dx - 3, dy - 3, dw + 6, 4); g.fillRect(dx - 3, dy + dh - 1, dw + 6, 4);
    g.fillRect(dx - 3, dy, 4, dh); g.fillRect(dx + dw - 1, dy, 4, dh); g.fillRect(dx + dw * 0.5 - 2, dy, 4, dh);
    // ceiling shadow of the deck above
    const sh = g.createLinearGradient(0, y, 0, y + ch * 0.35);
    sh.addColorStop(0, 'rgba(20,24,32,0.55)'); sh.addColorStop(1, 'rgba(20,24,32,0)');
    g.fillStyle = sh; g.fillRect(x, y, cw, ch * 0.35);
    // patio chairs + table silhouettes
    g.fillStyle = 'rgba(40,44,52,0.85)';
    const fy = y + ch * 0.9;
    for (const k of [0.22, 0.7]) {
      const cx = x + cw * k;
      g.fillRect(cx, fy - 30, 4, 30); g.fillRect(cx + 18, fy - 20, 3, 20); g.fillRect(cx, fy - 18, 22, 4);
    }
    g.beginPath(); g.ellipse(x + cw * 0.5, fy - 16, 12, 3, 0, 0, Math.PI * 2); g.fill(); g.fillRect(x + cw * 0.5 - 1.5, fy - 16, 3, 16);
    // glass railing (lower 1.05 m of 3 m)
    const ry = y + ch * 0.62;
    const rgg = g.createLinearGradient(0, ry, 0, y + ch);
    rgg.addColorStop(0, 'rgba(170,205,215,0.55)'); rgg.addColorStop(1, 'rgba(120,160,175,0.45)');
    g.fillStyle = rgg; g.fillRect(x, ry, cw, y + ch - ry);
    gr.fillStyle = '#1a1a1a'; gr.fillRect(x, ry, cw, y + ch - ry);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.moveTo(x + cw * 0.1, ry); g.lineTo(x + cw * 0.22, ry); g.lineTo(x + cw * 0.12, y + ch * 0.93); g.lineTo(x, y + ch * 0.93); g.fill();
    // handrail
    g.fillStyle = '#f2f4f6'; g.fillRect(x, ry - 4, cw, 6);
    g.fillStyle = '#9aa2ad'; g.fillRect(x, ry + 2, cw, 2);
    gm.fillStyle = '#c0c0c0'; gm.fillRect(x, ry - 4, cw, 6);
    // divider panels between cabins
    const dg = g.createLinearGradient(x, 0, x + 14, 0);
    dg.addColorStop(0, '#fbfcfd'); dg.addColorStop(1, '#d0d5db');
    g.fillStyle = dg; g.fillRect(x, y, 14, ch);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 14, y, 6, ch);
    // deck slab lip
    const lg = g.createLinearGradient(0, y + ch - 16, 0, y + ch);
    lg.addColorStop(0, '#ffffff'); lg.addColorStop(1, '#c8cdd4');
    g.fillStyle = lg; g.fillRect(x, y + ch - 16, cw, 16);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + ch - 17, cw, 1);
    gr.fillStyle = '#6a6a6a'; gr.fillRect(x, y + ch - 16, cw, 16);
  }
  return { map: tex(c, { repeat: true }), emissive: tex(ce, { repeat: true }), rough: tex(cr, { srgb: false, repeat: true }), metal: tex(cm, { srgb: false, repeat: true }) };
}

// ---------- white facade with window bands (front, stern, upper decks) ----------
export const WIN = { w: 24, h: 6 };
export function windowWallTextures(seed = 9, style = 'band') {
  const W = 1024, H = 256;
  const r = rng(seed);
  const [c, g] = canvas(W, H);
  const [ce, ge] = canvas(W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  g.fillStyle = '#eef0f3'; g.fillRect(0, 0, W, H);
  const rows = 2, rh = H / rows;
  for (let j = 0; j < rows; j++) {
    const y = j * rh;
    // panel seams
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let x = 0; x < W; x += 64) g.fillRect(x, y, 2, rh);
    if (style === 'band') {
      const wy = y + rh * 0.22, wh = rh * 0.52;
      const gg = g.createLinearGradient(0, wy, 0, wy + wh);
      gg.addColorStop(0, '#7890a8'); gg.addColorStop(0.4, '#26344a'); gg.addColorStop(1, '#101824');
      g.fillStyle = gg; g.fillRect(0, wy, W, wh);
      g.fillStyle = '#dfe3e8';
      for (let x = 0; x < W; x += 42.67) g.fillRect(x, wy, 3, wh);
      for (let x = 0; x < W; x += 42.67) if (r() < 0.6) {
        ge.fillStyle = `rgba(255,${180 + (r() * 50) | 0},${100 + (r() * 60) | 0},${0.5 + r() * 0.5})`;
        ge.fillRect(x + 3, wy, 39.6, wh);
      }
    } else {
      // individual cabin windows
      for (let x = 10; x < W; x += 64) {
        const wy = y + rh * 0.28, wh = rh * 0.42;
        const gg = g.createLinearGradient(0, wy, 0, wy + wh);
        gg.addColorStop(0, '#7890a8'); gg.addColorStop(0.5, '#233046'); gg.addColorStop(1, '#101824');
        g.fillStyle = '#c9ced5'; g.fillRect(x - 2, wy - 2, 48, wh + 4);
        g.fillStyle = gg; g.fillRect(x, wy, 44, wh);
        if (r() < 0.5) { ge.fillStyle = `rgba(255,200,130,${0.5 + r() * 0.5})`; ge.fillRect(x, wy, 44, wh); }
      }
    }
    const lg = g.createLinearGradient(0, y + rh - 10, 0, y + rh);
    lg.addColorStop(0, '#ffffff'); lg.addColorStop(1, '#bfc5cc');
    g.fillStyle = lg; g.fillRect(0, y + rh - 10, W, 10);
  }
  return { map: tex(c, { repeat: true }), emissive: tex(ce, { repeat: true }) };
}

// ---------- decks ----------
export function teakTexture() {
  return tex(cached('teak', teakCanvas), { repeat: true });
}
function teakCanvas() {
  const W = 1024, H = 1024;
  const r = rng(17);
  const noise = makeNoise(5);
  const planks = 48, pw = W / planks;
  const offsets = []; const tones = [];
  for (let i = 0; i < planks; i++) { offsets.push(r()); tones.push([]); for (let k = 0; k < 4; k++) tones[i].push(0.85 + r() * 0.3); }
  const [c] = pixels(W, H, (x, y, o) => {
    const i = Math.floor(x / pw);
    const fx = x - i * pw;
    const seg = Math.floor((y / H + offsets[i]) * 4) % 4;
    const segPos = ((y / H + offsets[i]) * 4) % 1;
    const tone = tones[i][seg];
    const grain = fbm(noise, x / W * 64, y / H * 4, 64, 4, 0.5);
    const streak = 0.5 + 0.5 * Math.sin((y / H) * 90 + grain * 12 + i * 3);
    let R = (150 + grain * 50 + streak * 14) * tone, G = (104 + grain * 34 + streak * 10) * tone, B = (66 + grain * 20 + streak * 6) * tone;
    if (fx < 1.6 || segPos < 0.004) { R = 38; G = 30; B = 24; }
    o[0] = R; o[1] = G; o[2] = B; o[3] = 255;
  });
  return c;
}

export function compositeDeck(base = [196, 204, 210]) {
  const S = 512;
  const noise = makeNoise(29);
  const [c] = pixels(S, S, (x, y, o) => {
    const n = fbm(noise, x / S * 32, y / S * 32, 32, 4);
    const k = 0.9 + n * 0.2;
    let [R, G, B] = base.map((v) => v * k);
    if (x % 128 < 1.5 || y % 128 < 1.5) { R *= 0.82; G *= 0.82; B *= 0.82; }
    o[0] = R; o[1] = G; o[2] = B; o[3] = 255;
  });
  return tex(c, { repeat: true });
}

// ---------- interior materials ----------
export function marbleTexture(seed = 31, base = [236, 232, 226], vein = [120, 110, 100], scale = 3) {
  const S = 1024;
  const noise = makeNoise(seed);
  const [c] = pixels(S, S, (x, y, o) => {
    const u = x / S, v = y / S;
    const n = fbm(noise, u * 4 * scale, v * 4 * scale, 4 * scale, 6, 0.55);
    const m = Math.abs(Math.sin((u * 2 + v * 3) * Math.PI * 2 + n * 9));
    const vv = Math.pow(1 - m, 14) + 0.35 * Math.pow(1 - Math.abs(Math.sin((u * 5 - v * 2) * Math.PI * 2 + n * 14)), 30);
    const cloud = fbm(noise, u * 8 + 3, v * 8, 8, 3) * 0.12;
    const t = clamp(vv, 0, 1);
    for (let k = 0; k < 3; k++) o[k] = (base[k] * (1 - cloud)) * (1 - t) + vein[k] * t;
    o[3] = 255;
  });
  return tex(c, { repeat: true });
}

export function carpetTexture(bg = '#5c1426', fg = '#c89b4a', accent = '#2a0a14', motif = 'medallion') {
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  const noise = makeNoise(41);
  const cell = motif === 'wave' ? 128 : 256;
  g.lineWidth = 5;
  for (let y = 0; y < S; y += cell) for (let x = 0; x < S; x += cell) {
    const cx = x + cell / 2, cy = y + cell / 2;
    if (motif === 'medallion') {
      g.strokeStyle = fg; g.globalAlpha = 0.8;
      g.beginPath(); g.arc(cx, cy, cell * 0.32, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 0.45;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        g.beginPath(); g.ellipse(cx + Math.cos(a) * cell * 0.2, cy + Math.sin(a) * cell * 0.2, cell * 0.11, cell * 0.04, a, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = accent; g.globalAlpha = 0.9; g.beginPath(); g.arc(cx, cy, cell * 0.08, 0, Math.PI * 2); g.fill();
      g.strokeStyle = fg; g.globalAlpha = 0.25; g.strokeRect(x + 6, y + 6, cell - 12, cell - 12);
    } else {
      g.strokeStyle = fg; g.globalAlpha = 0.5;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        for (let t = 0; t <= cell; t += 4) {
          const yy = y + cell * (0.25 + k * 0.25) + Math.sin(t / cell * Math.PI * 2) * cell * 0.08;
          if (t === 0) g.moveTo(x + t, yy); else g.lineTo(x + t, yy);
        }
        g.stroke();
      }
    }
  }
  g.globalAlpha = 1;
  // fibre noise
  const img = g.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = 0.86 + noise(x * 0.9, y * 0.9, 256) * 0.2 + (Math.random() - 0.5) * 0.08;
    const i = (y * S + x) * 4;
    img.data[i] *= n; img.data[i + 1] *= n; img.data[i + 2] *= n;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: true });
}

export function woodTexture(base = [92, 58, 36], seed = 51) {
  const S = 512;
  const noise = makeNoise(seed);
  const [c] = pixels(S, S, (x, y, o) => {
    const u = x / S, v = y / S;
    const n = fbm(noise, u * 4, v * 32, 4, 5);
    const fine = fbm(noise, u * 64 + 7, v * 4, 64, 3);
    const ring = 0.5 + 0.5 * Math.sin((u * 56 + n * 1.6) * Math.PI);
    const k = 0.78 + ring * 0.1 + n * 0.16 + fine * 0.12;
    o[0] = base[0] * k; o[1] = base[1] * k; o[2] = base[2] * k; o[3] = 255;
  });
  return tex(c, { repeat: true });
}

export function fabricTexture(base = [220, 214, 204], seed = 61) {
  const S = 256;
  const noise = makeNoise(seed);
  const [c] = pixels(S, S, (x, y, o) => {
    const weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 1.0 : 0.93;
    const n = 0.92 + noise(x / 8, y / 8, 32) * 0.12;
    o[0] = base[0] * weave * n; o[1] = base[1] * weave * n; o[2] = base[2] * weave * n; o[3] = 255;
  });
  return tex(c, { repeat: true });
}

export function roughNoise(seed = 71, lo = 0.25, hi = 0.55) {
  const S = 256;
  const noise = makeNoise(seed);
  const [c] = pixels(S, S, (x, y, o) => {
    const n = fbm(noise, x / S * 8, y / S * 8, 8, 4);
    const v = (lo + (hi - lo) * n) * 255;
    o[0] = o[1] = o[2] = v; o[3] = 255;
  });
  return tex(c, { srgb: false, repeat: true });
}

// Glow sprite for lamps / beams.
export function glowTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const gg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gg; g.fillRect(0, 0, S, S);
  return tex(c, { srgb: true, aniso: false });
}

// Composites leaf-cluster card textures from scanned single leaves (ambientCG
// LeafSet009, CC0): twig structure + rotated leaves, with correctly rotated
// normals and an overlap-based AO/roughness map. Output: assets/atlas/leaf_clusters
// (2x2 atlas: two pendulous birch twigs, two dense broadleaf clusters).
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const src = join(cache, 'atlas', 'birch_leaves');
const out = join(here, '..', 'assets', 'atlas', 'leaf_clusters');
const basisu = join(here, 'node_modules/basis_universal/bin/basisu');
mkdirSync(out, { recursive: true });

const SIZE = 2048, CELL = 1024;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function raw(file, ch) {
  const img = sharp(file).resize(1024, 1024);
  const { data } = await (ch === 1 ? img.greyscale() : img.removeAlpha()).raw().toBuffer({ resolveWithObject: true });
  return data;
}

const colorSrc = await raw(join(src, 'LeafSet009_1K-JPG_Color.jpg'), 3);
const alphaSrc = await raw(join(src, 'LeafSet009_1K-JPG_Opacity.jpg'), 1);
const normSrc = await raw(join(src, 'LeafSet009_1K-JPG_NormalGL.jpg'), 3);
const roughSrc = await raw(join(src, 'LeafSet009_1K-JPG_Roughness.jpg'), 1);
const manifest = JSON.parse(readFileSync(join(here, '..', 'assets', 'manifest-textures.json'), 'utf8'));
const leafRects = manifest.atlases.birch_leaves.sprites.map((s) => ({ x0: Math.max(0, s.u0 * 1024 - 14), y0: Math.max(0, s.v0 * 1024 - 14), x1: Math.min(1024, s.u1 * 1024 + 14), y1: Math.min(1024, s.v1 * 1024 + 14) }));

const col = new Float32Array(SIZE * SIZE * 4);  // premultiplied rgba
const nrm = new Float32Array(SIZE * SIZE * 2).fill(0);
const rough = new Float32Array(SIZE * SIZE).fill(0.6);
const depth = new Float32Array(SIZE * SIZE);   // layers stacked (for AO)

function sampleSrc(buf, ch, x, y, c) {
  const ix = Math.min(1023, Math.max(0, x | 0)), iy = Math.min(1023, Math.max(0, y | 0));
  return buf[(iy * 1024 + ix) * ch + c];
}

// draw one leaf: rect r from source, stem at bottom centre, placed at (px,py) pointing along angle a (0 = up)
function drawLeaf(r, px, py, a, len, tint, layer) {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const s = len / h;
  const ca = Math.cos(a), sa = Math.sin(a);
  const ext = len * 1.08;
  for (let y = Math.floor(py - ext - 2); y <= py + ext + 2; y++) {
    if (y < 0 || y >= SIZE) continue;
    for (let x = Math.floor(px - ext - 2); x <= px + ext + 2; x++) {
      if (x < 0 || x >= SIZE) continue;
      // destination -> leaf local (u across, v from stem upward)
      const dx = x - px, dy = y - py;
      const lu = (dx * ca + dy * sa) / s;       // across
      const lv = (dx * sa - dy * ca) / s;       // along (up)
      const sx = r.x0 + w / 2 + lu, sy = r.y1 - lv;
      if (sx < r.x0 || sx > r.x1 || sy < r.y0 || sy > r.y1) continue;
      const al = sampleSrc(alphaSrc, 1, sx, sy, 0) / 255;
      if (al < 0.02) continue;
      const i = y * SIZE + x;
      const c0 = sampleSrc(colorSrc, 3, sx, sy, 0) / 255 * tint[0], c1 = sampleSrc(colorSrc, 3, sx, sy, 1) / 255 * tint[1], c2 = sampleSrc(colorSrc, 3, sx, sy, 2) / 255 * tint[2];
      // over operator (premultiplied)
      const k = 1 - al;
      col[i * 4] = c0 * al + col[i * 4] * k; col[i * 4 + 1] = c1 * al + col[i * 4 + 1] * k; col[i * 4 + 2] = c2 * al + col[i * 4 + 2] * k;
      col[i * 4 + 3] = al + col[i * 4 + 3] * k;
      // rotate tangent-space normal XY by the leaf rotation (image y is down)
      const nx = sampleSrc(normSrc, 3, sx, sy, 0) / 127.5 - 1, ny = sampleSrc(normSrc, 3, sx, sy, 1) / 127.5 - 1;
      const rx = nx * ca + ny * sa, ry = -nx * sa + ny * ca; // clockwise image rotation == -a in y-up space
      nrm[i * 2] = rx * al + nrm[i * 2] * k; nrm[i * 2 + 1] = ry * al + nrm[i * 2 + 1] * k;
      rough[i] = (sampleSrc(roughSrc, 1, sx, sy, 0) / 255) * al + rough[i] * k;
      if (al > 0.5) depth[i] = Math.max(depth[i], layer);
    }
  }
}

function drawStem(pts, width, colr) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay, aw] = pts[s], [bx, by, bw] = pts[s + 1];
    const x0 = Math.floor(Math.min(ax, bx) - width * 2), x1 = Math.ceil(Math.max(ax, bx) + width * 2);
    const y0 = Math.floor(Math.min(ay, by) - width * 2), y1 = Math.ceil(Math.max(ay, by) + width * 2);
    const ex = bx - ax, ey = by - ay, el = ex * ex + ey * ey || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      let t = ((x - ax) * ex + (y - ay) * ey) / el; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + ex * t), y - (ay + ey * t));
      const wv = (aw + (bw - aw) * t) * width;
      const al = Math.max(0, Math.min(1, wv - d + 0.5));
      if (al <= 0) continue;
      const i = y * SIZE + x, k = 1 - al;
      const shade = 0.75 + 0.25 * Math.sqrt(Math.max(0, 1 - (d / wv) ** 2));
      col[i * 4] = colr[0] * shade * al + col[i * 4] * k; col[i * 4 + 1] = colr[1] * shade * al + col[i * 4 + 1] * k; col[i * 4 + 2] = colr[2] * shade * al + col[i * 4 + 2] * k;
      col[i * 4 + 3] = al + col[i * 4 + 3] * k;
      // cylinder normal across the stem
      const side = ((x - (ax + ex * t)) * -ey + (y - (ay + ey * t)) * ex) / Math.sqrt(el) / Math.max(wv, 1e-3);
      const nx = -ey / Math.sqrt(el) * side * 0.8, ny = ex / Math.sqrt(el) * side * 0.8;
      nrm[i * 2] = nx * al + nrm[i * 2] * k; nrm[i * 2 + 1] = -ny * al + nrm[i * 2 + 1] * k;
      rough[i] = 0.75 * al + rough[i] * k;
    }
  }
}

function curve(x0, y0, ang, len, bend, steps, w0, w1) {
  const pts = [];
  let x = x0, y = y0, a = ang;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x, y, w0 + (w1 - w0) * t]);
    a += bend / steps;
    x += Math.sin(a) * len / steps; y -= Math.cos(a) * len / steps;
  }
  return pts;
}

function cluster(cx, cy, seed, kind) {
  const R = rng(seed);
  const birch = kind === 'birch';
  const stemCol = birch ? [0.2, 0.14, 0.1] : [0.24, 0.18, 0.12];
  // main stem from bottom centre of the cell
  const baseX = cx + CELL * 0.5, baseY = cy + CELL * 0.97;
  const mainLen = CELL * (birch ? 0.86 : 0.8);
  const main = curve(baseX, baseY, (R() - 0.5) * 0.25, mainLen, (R() - 0.5) * (birch ? 0.9 : 0.5), 24, 1, 0.35);
  let layer = 1;
  const leafLen = CELL * (birch ? 0.15 : 0.19);
  const tints = birch ? [[0.86, 0.97, 0.72], [0.8, 0.94, 0.66], [0.92, 0.98, 0.7]] : [[0.72, 0.84, 0.66], [0.66, 0.8, 0.6], [0.78, 0.86, 0.64]];
  const twigs = [];
  const nTw = birch ? 9 : 11;
  for (let k = 0; k < nTw; k++) {
    const t = 0.12 + (k / nTw) * 0.85;
    const p = main[Math.floor(t * (main.length - 1))];
    const side = k % 2 ? 1 : -1;
    const a = side * (0.6 + R() * 0.7) + (birch ? 0.25 * side : 0);
    const len = CELL * (0.12 + R() * 0.16) * (1 - t * 0.35);
    const tw = curve(p[0], p[1], a, len, side * (birch ? 0.6 : 0.3), 8, 0.55, 0.25);
    twigs.push(tw);
  }
  for (const tw of twigs) drawStem(tw, birch ? 3.2 : 4.0, stemCol);
  drawStem(main, birch ? 5.5 : 7.0, stemCol);
  // leaves: at twig ends and along them, alternating
  const leaves = [];
  for (const tw of twigs) {
    const n = birch ? 2 + (R() * 2 | 0) : 3 + (R() * 2 | 0);
    for (let j = 0; j < n; j++) {
      const t = 0.35 + (j / n) * 0.65;
      const p = tw[Math.floor(t * (tw.length - 1))];
      const q = tw[Math.min(tw.length - 1, Math.floor(t * (tw.length - 1)) + 1)];
      const dirA = Math.atan2(q[0] - p[0], -(q[1] - p[1]));
      const off = (j % 2 ? 1 : -1) * (0.5 + R() * 0.5);
      leaves.push([p[0], p[1], dirA + off + (birch ? 0.9 * Math.sign(dirA || 1) * 0.4 : 0), leafLen * (0.75 + R() * 0.45)]);
    }
  }
  // terminal leaves on the main stem
  const tip = main[main.length - 1];
  leaves.push([tip[0], tip[1], (R() - 0.5) * 0.6, leafLen * 1.05]);
  for (let i = leaves.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [leaves[i], leaves[j]] = [leaves[j], leaves[i]]; }
  for (const [x, y, a, l] of leaves) {
    drawLeaf(leafRects[(R() * leafRects.length) | 0], x, y, a, l, tints[(R() * tints.length) | 0], layer++);
  }
}

cluster(0, 0, 11, 'birch');
cluster(CELL, 0, 23, 'birch');
cluster(0, CELL, 37, 'broad');
cluster(CELL, CELL, 51, 'broad');

// ---- write maps
const n = SIZE * SIZE;
const rgba = Buffer.alloc(n * 4), nb = Buffer.alloc(n * 3), ob = Buffer.alloc(n * 3);
// edge-pad colour under transparent pixels so mips do not bleed dark halos
const padded = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { const a = col[i * 4 + 3]; if (a > 0.01) for (let c = 0; c < 3; c++) padded[i * 3 + c] = col[i * 4 + c] / a; }
const filled = new Uint8Array(n); for (let i = 0; i < n; i++) filled[i] = col[i * 4 + 3] > 0.01 ? 1 : 0;
for (let pass = 0; pass < 24; pass++) {
  const nf = filled.slice();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x; if (filled[i]) continue;
    let s0 = 0, s1 = 0, s2 = 0, c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
      const j = yy * SIZE + xx; if (!filled[j]) continue;
      s0 += padded[j * 3]; s1 += padded[j * 3 + 1]; s2 += padded[j * 3 + 2]; c++;
    }
    if (c) { padded[i * 3] = s0 / c; padded[i * 3 + 1] = s1 / c; padded[i * 3 + 2] = s2 / c; nf[i] = 1; }
  }
  filled.set(nf);
}
let maxLayer = 1; for (let i = 0; i < n; i++) maxLayer = Math.max(maxLayer, depth[i]);
for (let i = 0; i < n; i++) {
  const a = col[i * 4 + 3];
  for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(Math.min(1, padded[i * 3 + c] || 0.2) * 255);
  rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  const nx = nrm[i * 2], ny = nrm[i * 2 + 1];
  nb[i * 3] = Math.round((nx * 0.5 + 0.5) * 255); nb[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255); nb[i * 3 + 2] = 255;
  // leaves lower in the stack (drawn earlier) sit deeper in the cluster -> darker
  const ao = a > 0.01 ? 0.55 + 0.45 * (depth[i] / maxLayer) : 1;
  ob[i * 3] = Math.round(ao * 255); ob[i * 3 + 1] = Math.round(Math.min(1, rough[i] * 0.9 + 0.1) * 255); ob[i * 3 + 2] = 0;
}
const tmp = join(cache, 'tmp');
mkdirSync(tmp, { recursive: true });
await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toFile(join(tmp, 'leafc_rgba.png'));
await sharp(nb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(join(tmp, 'leafc_n.png'));
await sharp(ob, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toFile(join(tmp, 'leafc_orm.png'));
for (const [tier, size] of [['hi', 2048], ['lo', 1024]]) {
  const c = join(tmp, `leafc_${tier}_c.png`), nn = join(tmp, `leafc_${tier}_n.png`), o = join(tmp, `leafc_${tier}_o.png`);
  await sharp(join(tmp, 'leafc_rgba.png')).resize(size, size).png().toFile(c);
  await sharp(join(tmp, 'leafc_n.png')).resize(size, size).png().toFile(nn);
  await sharp(join(tmp, 'leafc_orm.png')).resize(size / 2, size / 2).png().toFile(o);
  await run(basisu, ['-ktx2', '-mipmap', '-q', '200', '-force_alpha', '-file', c, '-output_file', join(out, `${tier}_c.ktx2`)]);
  await run(basisu, ['-ktx2', '-mipmap', '-normal_map', '-separate_rg_to_color_alpha', '-q', '255', '-file', nn, '-output_file', join(out, `${tier}_n.ktx2`)]);
  await run(basisu, ['-ktx2', '-mipmap', '-linear', '-q', '190', '-file', o, '-output_file', join(out, `${tier}_orm.ktx2`)]);
}
manifest.atlases.leaf_clusters = {
  hi: 2048, lo: 1024,
  sprites: [
    { u0: 0, v0: 0, u1: 0.5, v1: 0.5, kind: 'birch' }, { u0: 0.5, v0: 0, u1: 1, v1: 0.5, kind: 'birch' },
    { u0: 0, v0: 0.5, u1: 0.5, v1: 1, kind: 'broad' }, { u0: 0.5, v0: 0.5, u1: 1, v1: 1, kind: 'broad' },
  ],
  source: { source: 'derived from ambientCG LeafSet009', license: 'CC0 1.0', url: 'https://ambientcg.com/view?id=LeafSet009' },
};
writeFileSync(join(here, '..', 'assets', 'manifest-textures.json'), JSON.stringify(manifest, null, 1));
console.log('leaf clusters written');

// Builds GPU-compressed KTX2 texture sets from the downloaded CC0 sources.
//   colour  -> ETC1S sRGB (+ alpha slice for atlases/decals)
//   normal  -> ETC1S linear, XY in RGB/A ("-separate_rg_to_color_alpha"), Z rebuilt in shader
//   ORM     -> ETC1S linear (R = AO, G = roughness, B = metalness; glTF convention)
// Two tiers per set ('hi' / 'lo'). Also derives the birch bark set, detects sprite
// rectangles on foliage atlases and writes assets/manifest-textures.json.
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import * as cfg from './assets.config.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const tmp = join(cache, 'tmp');
const outRoot = join(here, '..', 'assets');
const basisu = join(here, 'node_modules/basis_universal/bin/basisu');
mkdirSync(tmp, { recursive: true });
const only = process.argv.slice(2); // optional filter by set name
const want = (n) => only.length === 0 || only.includes(n);

// ---------------------------------------------------------------- helpers
async function loadRaw(file, size, channels = 3) {
  let img = sharp(file);
  if (size) img = img.resize(size, size, { kernel: 'lanczos3', fit: 'fill' });
  img = channels === 1 ? img.greyscale() : img.removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

async function savePng(buf, w, h, c, file) {
  await sharp(buf, { raw: { width: w, height: h, channels: c } }).png({ compressionLevel: 1 }).toFile(file);
  return file;
}

async function encode(png, out, kind) {
  mkdirSync(dirname(out), { recursive: true });
  const args = ['-ktx2', '-mipmap', '-file', png, '-output_file', out, '-max_threads', '2'];
  if (kind === 'color') args.push('-q', '200');
  if (kind === 'colorA') args.push('-q', '200', '-force_alpha', '-mip_clamp');
  if (kind === 'normal') args.push('-normal_map', '-separate_rg_to_color_alpha', '-q', '255');
  if (kind === 'linear') args.push('-linear', '-q', '200');
  await run(basisu, args, { maxBuffer: 64 << 20 });
  return statSync(out).size;
}

async function pool(items, n, fn) {
  const q = items.slice();
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

function findFile(dir, patterns) {
  const files = readdirSync(dir);
  for (const p of patterns) {
    const f = files.find((x) => x.toLowerCase().endsWith(p.toLowerCase()));
    if (f) return join(dir, f);
  }
  return null;
}

// Periodic value noise (tiles with period `p` lattice cells).
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, base, oct, seed) {
  let s = 0, amp = 0.5, f = base, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f, f, seed + i * 17); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- source resolution
function sourcesFor(set, dir) {
  if (set.src === 'ph') {
    return { color: join(dir, 'Diffuse.jpg'), normal: join(dir, 'nor_gl.jpg'), arm: join(dir, 'arm.jpg') };
  }
  return {
    color: findFile(dir, ['_Color.jpg']),
    normal: findFile(dir, ['_NormalGL.jpg']),
    rough: findFile(dir, ['_Roughness.jpg']),
    ao: findFile(dir, ['_AmbientOcclusion.jpg']),
    metal: findFile(dir, ['_Metalness.jpg']),
    opacity: findFile(dir, ['_Opacity.jpg']),
  };
}

async function buildOrm(src, size, name) {
  if (src.arm) {
    const a = await loadRaw(src.arm, size, 3);
    return savePng(a.data, a.w, a.h, 3, join(tmp, `${name}_${size}_orm.png`));
  }
  const n = size * size;
  const out = Buffer.alloc(n * 3);
  const r = src.rough ? (await loadRaw(src.rough, size, 1)).data : null;
  const ao = src.ao ? (await loadRaw(src.ao, size, 1)).data : null;
  const me = src.metal ? (await loadRaw(src.metal, size, 1)).data : null;
  for (let i = 0; i < n; i++) {
    out[i * 3] = ao ? ao[i] : 255;
    out[i * 3 + 1] = r ? r[i] : 200;
    out[i * 3 + 2] = me ? me[i] : 0;
  }
  return savePng(out, size, size, 3, join(tmp, `${name}_${size}_orm.png`));
}

// Birch bark: white bark with dark lenticels and fissure marks, derived from a smooth
// scanned bark (ambientCG Bark005) so relief and roughness stay photographic.
async function deriveBirch(src, size, name) {
  const col = await loadRaw(src.color, size, 3);
  const nrm = await loadRaw(src.normal, size, 3);
  const n = size * size;
  let mean = 0;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) { lum[i] = (0.3 * col.data[i * 3] + 0.59 * col.data[i * 3 + 1] + 0.11 * col.data[i * 3 + 2]) / 255; mean += lum[i]; }
  mean /= n;
  let vr = 0; for (let i = 0; i < n; i++) vr += (lum[i] - mean) ** 2; const sd = Math.sqrt(vr / n);
  // lenticel mask (horizontal dashes), drawn with wrap-around so the tile stays seamless
  const len = new Float32Array(n);
  const rnd = mulberry(7);
  const count = Math.round(520 * (size / 1024) ** 2);
  for (let k = 0; k < count; k++) {
    const cx = rnd() * size, cy = rnd() * size;
    const hl = size * (0.006 + rnd() ** 2 * 0.05), ht = Math.max(0.7, (size / 1024) * (0.8 + rnd() * 2.2));
    const inten = 0.55 + rnd() * 0.45;
    for (let y = Math.floor(cy - ht * 2); y <= cy + ht * 2; y++) {
      for (let x = Math.floor(cx - hl - 2); x <= cx + hl + 2; x++) {
        const dx = (x - cx) / hl, dy = (y - cy) / ht;
        const d = dx * dx + dy * dy;
        if (d > 1.6) continue;
        const px = ((x % size) + size) % size, py = ((y % size) + size) % size;
        const a = Math.max(0, 1 - d) ** 0.7 * inten;
        len[py * size + px] = Math.max(len[py * size + px], a);
      }
    }
  }
  const c = Buffer.alloc(n * 3), nr = Buffer.alloc(n * 3), orm = Buffer.alloc(n * 3);
  const height = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size, v = y / size;
      const f1 = fbm(u, v, 4, 5, 3), f2 = fbm(u, v, 3, 4, 11), f3 = fbm(u * 1, v * 1, 8, 3, 29);
      // dark "eyes"/fissures where the source bark is darker than average
      const mark = Math.min(1, Math.max(0, (mean - sd * 0.9 - lum[i]) / (sd * 1.2)));
      const dark = Math.min(1, Math.max(mark, len[i] * 0.95));
      let r = 0.84, g = 0.82, b = 0.76;
      const w = 0.88 + 0.12 * f1;
      r *= w; g *= w; b *= w;
      const grey = Math.min(1, Math.max(0, (f2 - 0.55) * 3.0));
      r += (0.62 - r) * grey * 0.6; g += (0.61 - g) * grey * 0.6; b += (0.57 - b) * grey * 0.6;
      const peach = Math.min(1, Math.max(0, (f3 - 0.68) * 5.0)) * 0.5;
      r += (0.86 - r) * peach; g += (0.72 - g) * peach; b += (0.62 - b) * peach;
      const dr = 0.10 + 0.05 * f1, dg = 0.095 + 0.04 * f1, db = 0.09 + 0.03 * f1;
      r += (dr - r) * dark; g += (dg - g) * dark; b += (db - b) * dark;
      c[i * 3] = Math.round(Math.min(1, r) * 255); c[i * 3 + 1] = Math.round(Math.min(1, g) * 255); c[i * 3 + 2] = Math.round(Math.min(1, b) * 255);
      height[i] = -len[i] * 0.6 - mark * 0.3;
      orm[i * 3] = Math.round((1 - 0.35 * dark) * 255);
      orm[i * 3 + 1] = Math.round((0.55 + 0.35 * dark + 0.06 * f1) * 255);
      orm[i * 3 + 2] = 0;
    }
  }
  // combine source relief with the lenticel grooves
  const k = 2.5 * (size / 1024);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hx = height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)];
      const hy = height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x];
      let nx = nrm.data[i * 3] / 127.5 - 1 - hx * k;
      let ny = nrm.data[i * 3 + 1] / 127.5 - 1 + hy * k;
      let nz = nrm.data[i * 3 + 2] / 127.5 - 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      nr[i * 3] = Math.round((nx * 0.5 + 0.5) * 255); nr[i * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255); nr[i * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  return {
    color: await savePng(c, size, size, 3, join(tmp, `${name}_${size}_c.png`)),
    normal: await savePng(nr, size, size, 3, join(tmp, `${name}_${size}_n.png`)),
    orm: await savePng(orm, size, size, 3, join(tmp, `${name}_${size}_orm.png`)),
  };
}

// Connected components on an alpha mask -> sprite rectangles (UV, origin top-left).
async function detectSprites(alphaFile, minFrac = 0.0015) {
  const S = 512;
  const a = await loadRaw(alphaFile, S, 1);
  const lab = new Int32Array(S * S).fill(-1);
  const rects = [];
  const stack = [];
  for (let i = 0; i < S * S; i++) {
    if (lab[i] !== -1 || a.data[i] < 110) continue;
    let minx = S, miny = S, maxx = 0, maxy = 0, area = 0;
    stack.push(i); lab[i] = rects.length;
    while (stack.length) {
      const j = stack.pop();
      const x = j % S, y = (j / S) | 0;
      area++; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const k = yy * S + xx;
        if (lab[k] === -1 && a.data[k] >= 110) { lab[k] = rects.length; stack.push(k); }
      }
    }
    rects.push({ area, minx, miny, maxx, maxy });
  }
  return rects
    .filter((r) => r.area / (S * S) >= minFrac)
    .sort((p, q) => q.area - p.area)
    .map((r) => ({
      u0: +(r.minx / S).toFixed(4), v0: +(r.miny / S).toFixed(4), u1: +((r.maxx + 1) / S).toFixed(4), v1: +((r.maxy + 1) / S).toFixed(4),
      fill: +(r.area / ((r.maxx - r.minx + 1) * (r.maxy - r.miny + 1))).toFixed(3),
    }));
}

async function rgbaPng(colorFile, alphaFile, size, name, invertAlpha = false) {
  const c = await loadRaw(colorFile, size, 3);
  const a = await loadRaw(alphaFile, size, 1);
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = c.data[i * 3]; out[i * 4 + 1] = c.data[i * 3 + 1]; out[i * 4 + 2] = c.data[i * 3 + 2];
    out[i * 4 + 3] = invertAlpha ? 255 - a.data[i] : a.data[i];
  }
  return savePng(out, size, size, 4, join(tmp, `${name}_${size}_rgba.png`));
}

// ---------------------------------------------------------------- jobs
const manifestPath = join(outRoot, 'manifest-textures.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { textures: {}, atlases: {}, decals: {} };
const meta = JSON.parse(readFileSync(join(cache, 'meta.json'), 'utf8'));
const encodeJobs = [];

for (const set of cfg.textures) {
  if (!want(set.name)) continue;
  const dir = join(cache, 'tex', set.name);
  const src = sourcesFor(set, dir);
  const name = set.derive === 'birch' ? 'bark_birch' : set.name;
  const out = join(outRoot, 'tex', name);
  const tiers = { hi: set.hi, lo: set.lo };
  for (const [tier, size] of Object.entries(tiers)) {
    encodeJobs.push(async () => {
      let files;
      if (set.derive === 'birch') files = await deriveBirch(src, size, name);
      else {
        const col = await loadRaw(src.color, size, 3);
        const nor = await loadRaw(src.normal, size, 3);
        files = {
          color: await savePng(col.data, size, size, 3, join(tmp, `${name}_${size}_c.png`)),
          normal: await savePng(nor.data, size, size, 3, join(tmp, `${name}_${size}_n.png`)),
          orm: await buildOrm(src, tier === 'hi' && size > 1024 ? 1024 : size, name),
        };
      }
      const s1 = await encode(files.color, join(out, `${tier}_c.ktx2`), 'color');
      const s2 = await encode(files.normal, join(out, `${tier}_n.ktx2`), 'normal');
      const s3 = await encode(files.orm, join(out, `${tier}_orm.ktx2`), 'linear');
      console.log(`tex ${name} ${tier} ${size}: ${((s1 + s2 + s3) / 1024).toFixed(0)} KB`);
    });
  }
  manifest.textures[name] = { size: set.size, hi: set.hi, lo: set.lo, group: set.group || 'surface', source: meta[set.id] || { source: 'ambientCG', name: set.id, license: 'CC0 1.0' } };
}

for (const at of cfg.atlases) {
  if (!want(at.name)) continue;
  const dir = join(cache, 'atlas', at.name);
  const out = join(outRoot, 'atlas', at.name);
  let color, alpha, normal, arm, extra = null;
  if (at.src === 'ph') {
    const p = at.prefix;
    color = join(dir, `${p || ''}${p ? 'diff' : 'Diffuse'}.jpg`);
    alpha = join(dir, `${p || ''}${p ? 'alpha' : 'Alpha'}.jpg`);
    normal = join(dir, `${p}nor_gl.jpg`);
    arm = join(dir, `${p}arm.jpg`);
    if (at.extraDiffuse) extra = join(dir, `${at.extraDiffuse}.jpg`);
  } else {
    color = findFile(dir, ['_Color.jpg']); alpha = findFile(dir, ['_Opacity.jpg']); normal = findFile(dir, ['_NormalGL.jpg']);
    arm = null;
  }
  for (const [tier, size] of Object.entries({ hi: at.hi, lo: at.lo })) {
    encodeJobs.push(async () => {
      const c = await encode(await rgbaPng(color, alpha, size, `${at.name}_${tier}`), join(out, `${tier}_c.ktx2`), 'colorA');
      const nn = await loadRaw(normal, size, 3);
      const n = await encode(await savePng(nn.data, size, size, 3, join(tmp, `${at.name}_${size}_n.png`)), join(out, `${tier}_n.ktx2`), 'normal');
      const ormSrc = arm ? { arm } : { rough: findFile(dir, ['_Roughness.jpg']) };
      const o = await encode(await buildOrm(ormSrc, size, `${at.name}_${tier}`), join(out, `${tier}_orm.ktx2`), 'linear');
      let e = 0;
      if (extra) e = await encode(await rgbaPng(extra, alpha, size, `${at.name}_${tier}_dry`), join(out, `${tier}_c2.ktx2`), 'colorA');
      console.log(`atlas ${at.name} ${tier} ${size}: ${((c + n + o + e) / 1024).toFixed(0)} KB`);
    });
  }
  encodeJobs.push(async () => {
    const sprites = await detectSprites(alpha);
    manifest.atlases[at.name].sprites = sprites;
    console.log(`atlas ${at.name}: ${sprites.length} sprites`);
  });
  manifest.atlases[at.name] = { hi: at.hi, lo: at.lo, dry: !!extra, source: meta[at.id] || { source: 'ambientCG', name: at.id, license: 'CC0 1.0' } };
}

for (const d of cfg.decals) {
  if (!want(d.name)) continue;
  const dir = join(cache, 'decal', d.name);
  const out = join(outRoot, 'decal', d.name);
  for (const [tier, size] of Object.entries({ hi: d.hi, lo: d.lo })) {
    encodeJobs.push(async () => {
      const s = await encode(await rgbaPng(findFile(dir, ['_Color.jpg']), findFile(dir, ['_Opacity.jpg']), size, `${d.name}_${tier}`), join(out, `${tier}_c.ktx2`), 'colorA');
      console.log(`decal ${d.name} ${tier}: ${(s / 1024).toFixed(0)} KB`);
    });
  }
  manifest.decals[d.name] = { hi: d.hi, lo: d.lo, source: meta[d.id] || { source: 'ambientCG', name: d.id, license: 'CC0 1.0' } };
}

const par = Math.max(1, Math.floor(cpus().length / 2));
console.log(`encoding ${encodeJobs.length} jobs with ${par} workers`);
await pool(encodeJobs, par, (j) => j());
mkdirSync(outRoot, { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log('manifest written');

// Builds foliage card atlases (RGBA, colour-dilated) from scanned CC0 Poly Haven atlases.
//  conifer_branch.png  – a pine branch spray assembled from pine_tree_01 twig scans
//  broadleaf_cluster.png – a leafy twig assembled from island_tree_02 leaf scans (2 colour variants)
//  grass_atlas.png     – four grass clumps from grass_medium_01 (2x2 cells)
const sharp = require('sharp');
const path = require('path');
const components = require('./cc.cjs');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

async function rgba(diff, alpha) {
  // Source scans are 16-bit; assemble an 8-bit RGBA buffer explicitly.
  const c = await sharp(diff).removeAlpha().toColourspace('srgb').raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const a = await sharp(alpha).removeAlpha().toColourspace('b-w').resize(c.info.width, c.info.height).raw({ depth: 'uchar' }).toBuffer();
  const W = c.info.width, H = c.info.height, out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = c.data[i * 3]; out[i * 4 + 1] = c.data[i * 3 + 1]; out[i * 4 + 2] = c.data[i * 3 + 2]; out[i * 4 + 3] = a[i];
  }
  return sharp(await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());
}

async function crop(img, b) {
  return img.clone().extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toBuffer();
}

// Fill transparent texels with nearby colour so mipmaps don't produce dark fringes.
async function dilate(buf, w, h) {
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  let src = Buffer.from(data);
  for (let pass = 0; pass < 24; pass++) {
    const next = Buffer.from(src);
    let changed = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 8) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (src[j + 3] > 8) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
      }
      if (n) { next[i] = r / n; next[i + 1] = g / n; next[i + 2] = b / n; next[i + 3] = 9; changed++; }
    }
    src = next;
    if (!changed) break;
  }
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] <= 8) { out[i * 4] = src[i * 4]; out[i * 4 + 1] = src[i * 4 + 1]; out[i * 4 + 2] = src[i * 4 + 2]; out[i * 4 + 3] = 0; }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}


// Alpha-over paste of a PNG buffer onto a raw RGBA canvas with clipping.
async function paste(canvas, W, H, png, left, top) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    const dy = top + y; if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < info.width; x++) {
      const dx = left + x; if (dx < 0 || dx >= W) continue;
      const si = (y * info.width + x) * 4, di = (dy * W + dx) * 4;
      const a = data[si + 3] / 255; if (a <= 0) continue;
      const da = canvas[di + 3] / 255, oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) canvas[di + c] = (data[si + c] * a + canvas[di + c] * da * (1 - a)) / oa;
      canvas[di + 3] = oa * 255;
    }
  }
}
async function compose(W, H, comps) {
  const canvas = Buffer.alloc(W * H * 4);
  for (const c of comps) await paste(canvas, W, H, c.input, c.left, c.top);
  return sharp(canvas, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

async function rotated(buf, deg, scale) {
  const m = await sharp(buf).metadata();
  const r = await sharp(buf).resize(Math.max(4, Math.round(m.width * scale)), Math.max(4, Math.round(m.height * scale)))
    .rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return { buf: r, meta: await sharp(r).metadata() };
}

async function stemLine(w, h, pts, width, color) {
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="${color}" stroke-width="${width}" fill="none" stroke-linecap="round"/></svg>`);
}

async function conifer(src, out) {
  const img = await rgba(path.join(src, 'pine_tree_01/twig_diff.png'), path.join(src, 'pine_tree_01/twig_alpha.png'));
  const twigA = await crop(img, { x: 40, y: 0, w: 390, h: 737 });     // vertical twig, base at bottom
  const W = 1024, H = 1024, R = rng(7);
  const comps = [];
  // main stem from bottom-centre to top
  const stem = [[W / 2, H - 10], [W / 2 + 6, H * 0.5], [W / 2 - 4, 30]];
  comps.push({ input: await stemLine(W, H, stem, 9, '#4a3a2a'), left: 0, top: 0 });
  const n = 30;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = H - 40 - t * (H - 120);
    const side = i % 2 ? 1 : -1;
    const scale = 0.62 - t * 0.35 + R() * 0.06;
    const ang = side * (48 + R() * 18 - t * 10);
    const { buf, meta } = await rotated(twigA, ang, scale);
    // anchor: twig base is the bottom-centre of the unrotated crop
    const th = 737 * scale, rad = (ang * Math.PI) / 180;
    const bx = meta.width / 2 - Math.sin(rad) * th / 2, by = meta.height / 2 + Math.cos(rad) * th / 2;
    comps.push({ input: buf, left: Math.round(W / 2 - bx), top: Math.round(y - by) });
  }
  // tip twig
  const tip = await rotated(twigA, 0, 0.42);
  comps.push({ input: tip.buf, left: Math.round(W / 2 - tip.meta.width / 2), top: 0 });
  const raw = await compose(W, H, comps);
  await sharp(await dilate(raw, W, H)).toFile(out);
}

async function broadleaf(src, out, seed, tint) {
  const img = await rgba(path.join(src, 'island_tree_02/leaves_diff.png'), path.join(src, 'island_tree_02/leaves_alpha.png'));
  const boxes = (await components(path.join(src, 'island_tree_02/leaves_alpha.png'), 60000)).slice(0, 8);
  const leaves = [];
  for (const b of boxes) leaves.push({ buf: await crop(img, b), h: b.h });
  const W = 1024, H = 1024, R = rng(seed);
  const comps = [];
  // forked twig
  const main = [[W / 2, H - 6], [W / 2 - 20, H * 0.55], [W / 2 + 10, H * 0.12]];
  const fork1 = [[W / 2 - 14, H * 0.62], [W * 0.22, H * 0.3]];
  const fork2 = [[W / 2 - 4, H * 0.42], [W * 0.8, H * 0.2]];
  for (const s of [main, fork1, fork2]) comps.push({ input: await stemLine(W, H, s, s === main ? 10 : 6, '#5b4632'), left: 0, top: 0 });
  const paths = [main, fork1, fork2];
  for (let i = 0; i < 26; i++) {
    const p = paths[i % 3];
    const t = 0.2 + R() * 0.8;
    const a = p[0], b = p[p.length - 1];
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const L = leaves[Math.floor(R() * leaves.length)];
    const scale = (0.2 + R() * 0.1) * (900 / L.h);
    const ang = (R() * 2 - 1) * 110;
    const { buf, meta } = await rotated(L.buf, ang, scale);
    const mod = await sharp(buf).modulate({ brightness: 0.85 + R() * 0.3, saturation: 0.85 + R() * 0.3, hue: Math.round((R() * 2 - 1) * 8 + tint) }).png().toBuffer();
    const th = L.h * scale, rad = (ang * Math.PI) / 180;
    const bx = meta.width / 2 - Math.sin(rad) * th / 2, by = meta.height / 2 + Math.cos(rad) * th / 2;
    comps.push({ input: mod, left: Math.round(x - bx), top: Math.round(y - by) });
  }
  const raw = await compose(W, H, comps);
  await sharp(await dilate(raw, W, H)).toFile(out);
}

async function grass(src, out) {
  const img = await rgba(path.join(src, 'grass_medium_01/Diffuse.png'), path.join(src, 'grass_medium_01/Alpha.png'));
  const meta = await img.metadata();
  const s = meta.width / 1024; // components were measured on the 1k map
  const boxes = [
    { x: 224, y: 768, w: 256, h: 148 }, { x: 624, y: 776, w: 212, h: 100 },
    { x: 260, y: 912, w: 224, h: 112 }, { x: 620, y: 896, w: 184, h: 128 },
  ].map((b) => ({ x: Math.round(b.x * s), y: Math.round(b.y * s), w: Math.round(b.w * s), h: Math.round(b.h * s) }));
  const W = 1024, H = 512, comps = [];
  for (let i = 0; i < 4; i++) {
    const cw = W / 2, ch = H / 2;
    const buf = await sharp(await crop(img, boxes[i])).resize(cw - 8, ch - 4, { fit: 'fill' }).png().toBuffer();
    comps.push({ input: buf, left: (i % 2) * cw + 4, top: Math.floor(i / 2) * ch + 2 });
  }
  const raw = await compose(W, H, comps);
  await sharp(await dilate(raw, W, H)).toFile(out);
}

module.exports = { conifer, broadleaf, grass };

// Builds the runtime character kit from the Quaternius CC0 sources
// (run fetch-characters.mjs first):
//  * parts: outfit pieces (Peasant, Ranger; male + female bodies), heads cut from
//    the base bodies by skin weights, eyes, eyebrows and hairstyles, all rebound
//    to one skeleton per body type, UVs remapped into one shared atlas
//  * atlas: colour with a dye mask in alpha (which texels are dyeable fabric),
//    XY-packed normals and ORM; KTX2 in two tiers
//  * animation library: selected clips from UAL 1 + 2 reduced to joint rotations
//    plus hip translation (so every body keeps its own proportions), with the
//    ground speed of each locomotion clip measured from the root-motion files
// Writes ../assets/models/characters/ and ../assets/models/char_anims/ and their
// manifest entries.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { resample, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SRC, CHARS, read, skeletonOf, partsOf, cutHeadAndCollar } from './charparts.mjs';

const run = promisify(execFile);
const here = import.meta.dirname;
const tmp = join(here, '.cache', 'tmp_chars');
const outRoot = join(here, '..', 'assets', 'models');
const basisu = join(here, 'node_modules/basis_universal/bin/basisu');
mkdirSync(tmp, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// ------------------------------------------------------------------ parts
const can = { M: skeletonOf(await read(SRC.outfit('M', 'Peasant'))), F: skeletonOf(await read(SRC.outfit('F', 'Peasant'))) };
const parts = [];
const slug = (s) => s.toLowerCase().replace(/^(male|female)_/, '').replace(/[^a-z0-9]+/g, '_').replace(/_$/, '');

// outfit pieces: slot from the mesh name, skin-coloured primitives become their own part
for (const g of ['M', 'F']) for (const outfit of ['Peasant', 'Ranger']) {
  for (const p of partsOf(await read(SRC.outfit(g, outfit)), can[g])) {
    const skin = /Regular/.test(p.texName);
    const name = slug(p.node).replace(/^(peasant|ranger)_/, '');
    const slot = /hood/.test(name) ? 'hood' : /pauldron/.test(name) ? 'pauldron' : /bracer/.test(name) ? 'bracers' : /belt/.test(name) ? 'belt'
      : /arms/.test(name) ? 'arms' : /body/.test(name) ? 'torso' : /legs/.test(name) ? 'legs' : /feet|boots/.test(name) ? 'feet' : 'other';
    parts.push({ ...p, id: `${g}_${outfit.toLowerCase()}_${name}${skin ? '_skin' : ''}`, gender: g, outfit: outfit.toLowerCase(), slot, kind: skin ? 'skin' : 'cloth', tex: skin ? `REG_${g}` : outfit.toUpperCase() });
  }
}
// heads, eyes and eyebrows from the base bodies
for (const g of ['M', 'F']) {
  for (const p of partsOf(await read(SRC.body(g)), can[g])) {
    if (/Eye_/.test(p.texName)) parts.push({ ...p, id: `${g}_eyes`, gender: g, slot: 'eyes', kind: 'eyes', tex: 'EYE' });
    else if (/Hair_/.test(p.texName)) parts.push({ ...p, id: `${g}_brows`, gender: g, slot: 'brows', kind: 'hair', tex: /Hair_1/.test(p.texName) ? 'HAIR1' : 'HAIR2' });
    else parts.push({ ...cutHeadAndCollar(p, can[g], g === 'M' ? { top: 1.52, low: 1.27, shrink: 0.045 } : { top: 1.47, low: 1.22 }), id: `${g}_head`, gender: g, slot: 'head', kind: 'skin', tex: `SH_${g}` });
  }
}
// hairstyles (rigged to the head bone of the male or female skeleton)
const HAIR = { M: { Hair_Beard: 'beard', Hair_Buzzed: 'buzzed', Hair_SimpleParted: 'parted' }, F: { Hair_Buns: 'buns', Hair_BuzzedFemale: 'buzzed', Hair_Long: 'long' } };
for (const g of ['M', 'F']) for (const [file, name] of Object.entries(HAIR[g])) {
  for (const p of partsOf(await read(SRC.hair(file)), can[g])) {
    parts.push({ ...p, id: `${g}_hair_${name}`, gender: g, slot: name === 'beard' ? 'beard' : 'hair', kind: 'hair', tex: /Hair_1/.test(p.texName) ? 'HAIR1' : 'HAIR2' });
  }
}

// the heaviest pieces (ranger boots ~10k vertices, bracers 4k) are simplified:
// every character is skinned on the GPU twice a frame (colour + shadow pass)
import { compact } from './charparts.mjs';
for (const p of parts) {
  const n = p.pos.length / 3;
  if (n < 3500) continue;
  const target = Math.floor(p.idx.length * (2600 / n) / 3) * 3;
  const [idx] = MeshoptSimplifier.simplify(p.idx, p.pos, 3, target, 0.012, ['LockBorder']);
  Object.assign(p, compact({ ...p, idx: Uint32Array.from(idx) }));
  console.log('simplified', p.id, n, '->', p.pos.length / 3);
}

// ------------------------------------------------------------------ atlas
// hi tier layout in pixels (4096 square); every region is padded by edge copies
const A = 4096, PAD = 16;
const TEX = {
  PEASANT: { region: [0, 0, 2048, 2048], c: 'Peasant/T_Peasant_BaseColor.png', n: 'Peasant/T_Peasant_Normal.png', orm: 'Peasant/T_Peasant_ORM.png', dye: 'peasant' },
  RANGER: { region: [2048, 0, 2048, 2048], c: 'Ranger/T_Ranger_BaseColor.png', n: 'Ranger/T_Ranger_Normal.png', orm: 'Ranger/T_Ranger_ORM.png', dye: 'ranger' },
  SH_M: { region: [0, 2048, 1024, 1024], c: 'T_Superhero_Male_Dark.png', n: 'Normals Unity - Godot/T_Superhero_Male_Normal.png', rough: 'T_Superhero_Male_Roughness.png' },
  SH_F: { region: [1024, 2048, 1024, 1024], c: 'T_Superhero_Female_Dark_BaseColor.png', n: 'Normals Unity - Godot/T_Superhero_Female_Normal.png', rough: 'T_Superhero_Female_Roughness.png' },
  REG_M: { region: [0, 3072, 1024, 1024], c: 'Base/T_Regular_Male_Dark_BaseColor.png', n: 'Base/T_Regular_Male_Normal.png', rough: 'Base/T_Regular_Male_Roughness.png' },
  REG_F: { region: [1024, 3072, 1024, 1024], c: 'Base/T_Regular_Female_Dark_BaseColor.png', n: 'Base/T_Regular_Female_Normal.png', rough: 'Base/T_Regular_Female_Roughness.png' },
  HAIR1: { region: [2048, 2048, 1024, 1024], c: 'Hairstyles/Textures/T_Hair_1_BaseColor.png', n: 'Hairstyles/Textures/Normals Unity - Godot/T_Hair_1_Normal.png', rough: 0.62 },
  HAIR2: { region: [3072, 2048, 1024, 1024], c: 'Hairstyles/Textures/T_Hair_2_BaseColor.png', n: 'Hairstyles/Textures/Normals Unity - Godot/T_Hair_2_Normal.png', rough: 0.62 },
  // the eyeball UVs wrap past 1 in u: the texture is stored twice side by side
  EYE: { region: [2048, 3072, 512, 256], c: 'T_Eye_Brown.png', n: null, rough: 0.18, tileU: 2 },
};
const texPath = (rel) => {
  for (const pack of ['outfits', 'ubc']) {
    for (const base of ['Textures', 'Base Characters/Textures']) {
      const dirs = readdirSync(join(CHARS, pack)).map((d) => join(CHARS, pack, d, base, rel));
      const hit = dirs.find((p) => existsSync(p));
      if (hit) return hit;
    }
    const hairs = readdirSync(join(CHARS, pack)).map((d) => join(CHARS, pack, d, rel));
    const h = hairs.find((p) => existsSync(p));
    if (h) return h;
  }
  throw new Error('texture not found: ' + rel);
};

// fabric vs leather/metal/skin, per texel (alpha of the colour atlas)
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const DYE_REF = {};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DYE = {
  // green cloth of the ranger's hood, tunic and trousers
  ranger: (r, g, b) => { const [h, s] = hsv(r, g, b); return smooth(55, 75, h) * (1 - smooth(165, 185, h)) * smooth(0.12, 0.25, s); },
  // linen and dark wool are fabric; bright ochre leather and brass are not
  peasant: (r, g, b) => { const [h, s, v] = hsv(r, g, b); const leather = smooth(0.42, 0.6, s) * smooth(12, 22, h) * (1 - smooth(48, 60, h)) * smooth(0.27, 0.36, v); return Math.max(0, 1 - leather) * smooth(0.03, 0.07, v); },
};
// whole parts forced dyeable (1) or not (0), rasterised into the mask in UV space
const MASK_PARTS = { PEASANT: [[/_peasant_feet$/, 0], [/_peasant_legs$/, 1], [/^F_peasant_body$/, 1]] };

// two box passes per axis: soft dye edges instead of speckled leather patches
function blur(a, w, h, r) {
  const tmp = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { tmp[y * w + x] = s / (2 * r + 1); s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { a[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  }
}

function rasterise(mask, iw, ih, x0, y0, p, value) {
  const U = (i) => p.uv[i * 2] * A - (x0 + PAD), V = (i) => p.uv[i * 2 + 1] * A - (y0 + PAD);
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2];
    const ax = U(a), ay = V(a), bx = U(b), by = V(b), cx = U(c), cy = V(c);
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-9) continue;
    const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), maxx = Math.min(iw - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
    const miny = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), maxy = Math.min(ih - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / d, w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / d, w2 = 1 - w0 - w1;
      if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) mask[y * iw + x] = value;
    }
  }
}

async function regionImage(key, map, w, h) {
  const t = TEX[key];
  const iw = w - 2 * PAD, ih = h - 2 * PAD;
  let src = map === 'c' ? t.c : map === 'n' ? t.n : null;
  let img;
  if (map === 'orm') {
    if (t.orm) img = sharp(texPath(t.orm)).removeAlpha();
    else if (typeof t.rough === 'string') {
      // skin: roughness only -> ORM (occlusion 1, metal 0)
      const r = await sharp(texPath(t.rough)).resize(iw, ih).greyscale().raw().toBuffer();
      const out = Buffer.alloc(iw * ih * 3);
      for (let i = 0; i < iw * ih; i++) { out[i * 3] = 255; out[i * 3 + 1] = r[i]; out[i * 3 + 2] = 0; }
      img = sharp(out, { raw: { width: iw, height: ih, channels: 3 } });
    } else img = sharp({ create: { width: iw, height: ih, channels: 3, background: { r: 255, g: Math.round(t.rough * 255), b: 0 } } });
  } else if (!src) img = sharp({ create: { width: iw, height: ih, channels: 3, background: { r: 128, g: 128, b: 255 } } });
  else img = sharp(texPath(src)).removeAlpha();
  if (t.tileU) {
    const one = await img.resize(Math.round(iw / t.tileU), ih).png().toBuffer();
    img = sharp({ create: { width: iw, height: ih, channels: 3, background: '#000' } }).composite(Array.from({ length: t.tileU }, (_, i) => ({ input: one, left: Math.round((i * iw) / t.tileU), top: 0 })));
    img = sharp(await img.png().toBuffer());
  }
  let raw = await img.resize(iw, ih, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
  if (map === 'c') {
    // RGBA: dye mask in alpha (cloth textures), fully dyeable elsewhere (tints multiply)
    const rgba = Buffer.alloc(iw * ih * 4);
    const f = t.dye ? DYE[t.dye] : null;
    const mask = new Float32Array(iw * ih);
    for (let i = 0; i < iw * ih; i++) mask[i] = f ? f(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]) : 1;
    for (const [re, value] of MASK_PARTS[key] || []) for (const p of parts) if (p.tex === key && re.test(p.id)) rasterise(mask, iw, ih, t.region[0], t.region[1], p, value);
    if (f) blur(mask, iw, ih, Math.max(1, Math.round(iw / 700)));
    let sw = 0, sl = 0;
    for (let i = 0; i < iw * ih; i++) {
      const r = raw[i * 3], g = raw[i * 3 + 1], b = raw[i * 3 + 2];
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b;
      const m = mask[i];
      rgba[i * 4 + 3] = Math.round(m * 255);
      if (f && m > 0.5) { sw += m; sl += m * (0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]); }
    }
    // mean linear luminance of the dyeable fabric: the runtime divides dye targets by it
    if (f) DYE_REF[key] = +(sl / Math.max(1, sw)).toFixed(4);
    raw = rgba;
  }
  const ch = map === 'c' ? 4 : 3;
  return sharp(raw, { raw: { width: iw, height: ih, channels: ch } })
    .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, extendWith: 'copy' })
    .raw().toBuffer();
}

async function buildAtlas(map) {
  const ch = map === 'c' ? 4 : 3;
  const bg = map === 'n' ? { r: 128, g: 128, b: 255, alpha: 1 } : map === 'orm' ? { r: 255, g: 230, b: 0, alpha: 1 } : { r: 90, g: 80, b: 70, alpha: 0 };
  const layers = [];
  for (const [key, t] of Object.entries(TEX)) {
    const [x, y, w, h] = t.region;
    layers.push({ input: await regionImage(key, map, w, h), raw: { width: w, height: h, channels: ch }, left: x, top: y });
  }
  return sharp({ create: { width: A, height: A, channels: ch, background: bg } }).composite(layers).png({ compressionLevel: 1 }).toBuffer();
}

async function encodeKtx(pngBuf, kind, size) {
  const h = createHash('md5').update(pngBuf).update(kind + size).digest('hex').slice(0, 16);
  const png = join(tmp, `${h}.png`), out = join(tmp, `${h}.ktx2`);
  if (existsSync(out)) return readFileSync(out);
  writeFileSync(png, await sharp(pngBuf).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 1 }).toBuffer());
  const args = ['-ktx2', '-mipmap', '-file', png, '-output_file', out, '-max_threads', '4'];
  if (kind === 'colorA') args.push('-q', '220', '-force_alpha');
  if (kind === 'normal') args.push('-normal_map', '-separate_rg_to_color_alpha', '-q', '255');
  if (kind === 'linear') args.push('-linear', '-q', '200');
  await run(basisu, args, { maxBuffer: 64 << 20 });
  return readFileSync(out);
}

// per cloth part: mean linear luminance of its dyeable texels, sampled at the
// part's (atlas) UVs; the runtime divides dye targets by it so a dye gives the
// same average colour on a bright linen shirt as on dark wool trousers
function partDyeRefs(rgba) {
  for (const p of parts) {
    if (p.kind !== 'cloth') continue;
    let sw = 0, sl = 0;
    for (let i = 0; i < p.uv.length; i += 2) {
      const x = Math.min(A - 1, Math.floor(p.uv[i] * A)), y = Math.min(A - 1, Math.floor(p.uv[i + 1] * A)), o = (y * A + x) * 4;
      const m = rgba[o + 3] / 255;
      if (m < 0.5) continue;
      sw += m; sl += m * (0.2126 * LIN[rgba[o]] + 0.7152 * LIN[rgba[o + 1]] + 0.0722 * LIN[rgba[o + 2]]);
    }
    p.dyeRef = sw > 20 ? +(sl / sw).toFixed(4) : DYE_REF[p.tex] || 0.06;
    p.dyeCover = +(sw / (p.uv.length / 2)).toFixed(3);
  }
}

// remap every part's UVs into its atlas region (inside the padding)
for (const p of parts) {
  const [x, y, w, h] = TEX[p.tex].region, tu = TEX[p.tex].tileU || 1;
  for (let i = 0; i < p.uv.length; i += 2) {
    const u = Math.min(tu, Math.max(0, p.uv[i])) / tu, v = Math.min(1, Math.max(0, p.uv[i + 1]));
    p.uv[i] = (x + PAD + u * (w - 2 * PAD)) / A;
    p.uv[i + 1] = (y + PAD + v * (h - 2 * PAD)) / A;
  }
}

// ------------------------------------------------------------------ character document
async function writeCharacters() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('characters').setExtras({ joints: can.M.names });
  const acc = (arr, type) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const skins = {}, armatures = {};
  for (const g of ['M', 'F']) {
    const s = can[g];
    const arm = doc.createNode(`Armature_${g}`);
    const nodes = s.names.map((n, i) => doc.createNode(n).setTranslation(s.rest[i].t).setRotation(s.rest[i].r).setScale(s.rest[i].s));
    nodes.forEach((nd, i) => (s.parent[i] >= 0 ? nodes[s.parent[i]] : arm).addChild(nd));
    const ibm = new Float32Array(s.names.length * 16);
    s.ibm.forEach((m, i) => ibm.set(m, i * 16));
    const skin = doc.createSkin(`skin_${g}`).setInverseBindMatrices(acc(ibm, 'MAT4')).setSkeleton(nodes[0]);
    for (const nd of nodes) skin.addJoint(nd);
    scene.addChild(arm);
    skins[g] = skin; armatures[g] = arm;
  }
  // atlas textures (hi tier embedded as external KTX2; lo tier written next to it)
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const tiers = { c: ['colorA', 4096, 2048], n: ['normal', 2048, 1024], orm: ['linear', 2048, 1024] };
  const tex = {}, low = [];
  for (const [map, [kind, hi, lo]] of Object.entries(tiers)) {
    console.log('atlas', map);
    const png = await buildAtlas(map);
    if (map === 'c') partDyeRefs(await sharp(png).raw().toBuffer());
    if (map === 'c') writeFileSync(join(tmp, 'atlas_preview.jpg'), await sharp(png).resize(1024, 1024).flatten({ background: '#000' }).jpeg().toBuffer());
    const uri = `char_${map}`;
    tex[map] = doc.createTexture(uri).setImage(new Uint8Array(await encodeKtx(png, kind, hi))).setMimeType('image/ktx2').setURI(`${uri}.ktx2`);
    low.push({ uri, data: await encodeKtx(png, kind, lo) });
  }
  const mat = doc.createMaterial('character').setBaseColorTexture(tex.c).setNormalTexture(tex.n)
    .setMetallicRoughnessTexture(tex.orm).setOcclusionTexture(tex.orm).setRoughnessFactor(1).setMetallicFactor(1)
    .setExtras({ xyNormal: true, dyeAlpha: true, dyeRef: DYE_REF });
  console.log('dye reference luminance', DYE_REF);
  for (const p of parts) {
    const prim = doc.createPrimitive().setMaterial(mat)
      .setIndices(acc(p.idx, 'SCALAR'))
      .setAttribute('POSITION', acc(p.pos, 'VEC3')).setAttribute('NORMAL', acc(p.nor, 'VEC3'))
      .setAttribute('TEXCOORD_0', acc(p.uv, 'VEC2')).setAttribute('JOINTS_0', acc(p.joints, 'VEC4')).setAttribute('WEIGHTS_0', acc(p.weights, 'VEC4'));
    const node = doc.createNode(p.id).setMesh(doc.createMesh(p.id).addPrimitive(prim)).setSkin(skins[p.gender])
      .setExtras({ gender: p.gender, slot: p.slot, kind: p.kind, outfit: p.outfit || null, tex: p.tex, dyeRef: p.dyeRef ?? null, dyeCover: p.dyeCover ?? null });
    armatures[p.gender].addChild(node);
  }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return { doc, low };
}

// ------------------------------------------------------------------ animation library
// clip -> source library; the names stay those of the Universal Animation Library
const CLIPS = {
  ual1: ['Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop',
    'Death01', 'Fixing_Kneeling', 'Hit_Chest', 'Hit_Head', 'Interact', 'PickUp_Table', 'Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down',
    'Pistol_Shoot', 'Pistol_Reload', 'Punch_Cross', 'Punch_Jab', 'Push_Loop', 'Sitting_Enter', 'Sitting_Exit', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Sword_Attack', 'Roll'],
  ual2: ['Chest_Open', 'Consume', 'Farm_Harvest', 'Farm_PlantSeed', 'Farm_Watering', 'Hit_Knockback', 'Idle_FoldArms_Loop', 'Idle_Lantern_Loop', 'Idle_No_Loop',
    'Idle_Rail_Loop', 'Idle_Rail_Call', 'LayToIdle', 'Melee_Hook', 'OverhandThrow', 'TreeChopping_Loop', 'Walk_Carry_Loop', 'Yes', 'Zombie_Idle_Loop',
    'Zombie_Scratch', 'Zombie_Walk_Fwd_Loop', 'ClimbUp_1m'],
};

async function writeAnims() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('anims');
  const src1 = await io.read(SRC.anims('ual1', false));
  const skel = skeletonOf(src1);
  const arm = doc.createNode('Armature');
  const nodes = skel.names.map((n, i) => doc.createNode(n).setTranslation(skel.rest[i].t).setRotation(skel.rest[i].r).setScale(skel.rest[i].s));
  nodes.forEach((nd, i) => (skel.parent[i] >= 0 ? nodes[skel.parent[i]] : arm).addChild(nd));
  scene.addChild(arm);
  const byName = new Map(nodes.map((n) => [n.getName(), n]));
  const speeds = {};
  let frames = 0;
  for (const [lib, names] of Object.entries(CLIPS)) {
    const src = lib === 'ual1' ? src1 : await io.read(SRC.anims(lib, false));
    const rm = await io.read(SRC.anims(lib, true));
    for (const name of names) {
      const a = src.getRoot().listAnimations().find((x) => x.getName() === name);
      if (!a) throw new Error(`clip ${name} missing in ${lib}`);
      const out = doc.createAnimation(name);
      for (const ch of a.listChannels()) {
        const target = ch.getTargetNode()?.getName(), path = ch.getTargetPath();
        if (!byName.has(target)) continue;
        if (!(path === 'rotation' || (path === 'translation' && target === 'pelvis'))) continue;
        const s = ch.getSampler();
        const input = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from(s.getInput().getArray())).setBuffer(buffer);
        const output = doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(Float32Array.from(s.getOutput().getArray())).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
        out.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(byName.get(target)).setTargetPath(path).setSampler(sampler));
        frames += s.getInput().getCount();
      }
      // ground speed from the root-motion version: root joint displacement over the clip
      const r = rm.getRoot().listAnimations().find((x) => x.getName() === name);
      const rootCh = r?.listChannels().find((c) => c.getTargetNode()?.getName() === 'root' && c.getTargetPath() === 'translation');
      if (rootCh) {
        const o = rootCh.getSampler().getOutput().getArray(), t = rootCh.getSampler().getInput().getArray();
        const n = o.length / 3, dur = t[t.length - 1] - t[0];
        const d = Math.hypot(o[(n - 1) * 3] - o[0], o[(n - 1) * 3 + 2] - o[2], o[(n - 1) * 3 + 1] - o[1]);
        if (dur > 0 && d > 0.05) speeds[name] = +(d / dur).toFixed(3);
      }
    }
  }
  const pelvis = skel.rest[skel.names.indexOf('pelvis')].t;
  scene.setExtras({ speeds, hipHeight: +pelvis[2].toFixed(4), hips: { M: +can.M.rest[1].t[2].toFixed(4), F: +can.F.rest[1].t[2].toFixed(4) } });
  console.log('anim keyframes before resample', frames, 'speeds', speeds);
  await doc.transform(resample({ tolerance: 2e-4 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return doc;
}

// ------------------------------------------------------------------ write
async function writeModel(id, doc, low = []) {
  const dir = join(outRoot, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await io.write(join(dir, `${id}.gltf`), doc);
  let hi = 0, lo = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.ktx2')) { const n = f.replace(/\.ktx2$/, '_hi.ktx2'); renameSync(join(dir, f), join(dir, n)); hi += statSync(join(dir, n)).size; }
    else { const s = statSync(join(dir, f)).size; hi += s; lo += s; }
  }
  for (const v of low) { writeFileSync(join(dir, `${v.uri}_lo.ktx2`), v.data); lo += v.data.length; }
  console.log(id, 'bytes hi', hi, 'lo', lo);
  return { bytesHi: hi, bytesLo: lo };
}

const only = process.argv.slice(2);
const manifestPath = join(outRoot, '..', 'manifest-models.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sources = JSON.parse(readFileSync(join(CHARS, 'sources.json'), 'utf8'));
const src = (k) => { const s = sources.find((x) => x.key === k); return { source: s.source, url: s.url, license: s.license, name: s.name, authors: s.authors }; };
if (!only.length || only.includes('characters')) {
  const { doc, low } = await writeCharacters();
  const size = await writeModel('characters', doc, low);
  manifest.characters = { id: 'characters', kind: 'characters', parts: parts.length, ...size, source: src('ubc'), sources: [src('ubc'), src('outfits')] };
  console.log('parts', parts.map((p) => `${p.id}(${p.pos.length / 3}${p.dyeRef ? ` ref ${p.dyeRef} cover ${p.dyeCover}` : ''})`).join('\n  '));
}
if (!only.length || only.includes('anims')) {
  const size = await writeModel('char_anims', await writeAnims());
  manifest.char_anims = { id: 'char_anims', kind: 'animations', ...size, source: src('ual1'), sources: [src('ual1'), src('ual2')] };
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

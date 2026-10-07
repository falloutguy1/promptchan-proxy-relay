// Converts assets-src/ (Poly Haven CC0 downloads) into runtime assets in public/assets/.
//  - PBR texture sets -> KTX2 (ETC1S colour, UASTC normal / ARM), mipmapped
//  - terrain layers   -> KTX2 2D array textures (colour+height in alpha, normal, ARM)
//  - foliage atlases  -> KTX2 UASTC RGBA
//  - props            -> GLB, simplified where needed, KTX2 textures, meshopt geometry
//  - CREDITS.json     -> author + licence for every shipped asset
// Requires toktx (KTX-Software 4.3). Set TOKTX_DIR to its install dir (bin/ + lib/).
// Usage: node tools/build-assets.mjs [--only=textures,terrain,foliage,models,hdri]
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import sharp from 'sharp';
import { MANIFEST } from './fetch-assets.mjs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';

const require = createRequire(import.meta.url);
const foliage = require('./foliage.cjs');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bsy-'));
const TOKTX_DIR = process.env.TOKTX_DIR || path.join(ROOT, 'tools', 'bin');
const ENV = { ...process.env, PATH: `${TOKTX_DIR}:${TOKTX_DIR}/bin:${process.env.PATH}`, LD_LIBRARY_PATH: `${TOKTX_DIR}/lib:${process.env.LD_LIBRARY_PATH || ''}` };
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);

const run = (cmd, args) => execFileSync(cmd, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
const toktx = (args) => run('toktx', ['--t2', '--genmipmap', ...args]);
const gt = (args) => run(path.join(ROOT, 'node_modules/.bin/gltf-transform'), args);
const mk = (p) => fs.mkdirSync(p, { recursive: true });
const fresh = (out, ...inputs) => fs.existsSync(out) && inputs.every((i) => fs.statSync(i).mtimeMs < fs.statSync(out).mtimeMs);

const COLOR = (q = 230) => ['--encode', 'etc1s', '--clevel', '2', '--qlevel', String(q), '--assign_oetf', 'srgb'];
const DATA = (rdo = 1.5) => ['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', String(rdo), '--zcmp', '18', '--assign_oetf', 'linear'];

const TERRAIN = ['leafy_grass', 'sparse_grass', 'gravel_floor', 'brown_mud_02', 'coast_land_rocks_01', 'coast_sand_rocks_02'];

async function textures() {
  for (const [id, res] of MANIFEST.textures) {
    if (TERRAIN.includes(id)) continue;
    const s = path.join(SRC, 'textures', id), o = path.join(OUT, 'tex', id);
    mk(o);
    const full = res === '2k' ? '2048x2048' : '1024x1024';
    const jobs = [
      ['diff.ktx2', 'Diffuse.jpg', [...COLOR(), '--resize', full]],
      ['nor.ktx2', 'nor_gl.jpg', [...DATA(2.5), '--resize', '1024x1024']],
      ['arm.ktx2', 'arm.jpg', [...DATA(3), '--resize', '1024x1024']],
    ];
    for (const [dst, src, args] of jobs) {
      const i = path.join(s, src), d = path.join(o, dst);
      if (!fs.existsSync(i)) { console.warn('missing', i); continue; }
      if (fresh(d, i)) continue;
      toktx([...args, d, i]);
    }
    console.log('texture', id);
  }
}

async function terrain() {
  const o = path.join(OUT, 'terrain');
  mk(o);
  const S = 1024; // terrain tiles are 1.3-9 m wide: 1K gives 1-9 mm per texel
  // colour + height (alpha) -> one RGBA png per layer
  const colorPngs = [], norPngs = [], armPngs = [];
  for (const id of TERRAIN) {
    const s = path.join(SRC, 'textures', id);
    const rgb = await sharp(path.join(s, 'Diffuse.jpg')).resize(S, S).removeAlpha().raw().toBuffer();
    const h = await sharp(path.join(s, 'Displacement.jpg')).resize(S, S).toColourspace('b-w').normalise().raw().toBuffer();
    const rgba = Buffer.alloc(S * S * 4);
    for (let i = 0; i < S * S; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = h[i]; }
    const cp = path.join(TMP, `${id}_ch.png`);
    await sharp(rgba, { raw: { width: S, height: S, channels: 4 } }).png().toFile(cp);
    colorPngs.push(cp);
    const np = path.join(TMP, `${id}_n.png`); await sharp(path.join(s, 'nor_gl.jpg')).resize(S, S).png().toFile(np); norPngs.push(np);
    const ap = path.join(TMP, `${id}_a.png`); await sharp(path.join(s, 'arm.jpg')).resize(512, 512).png().toFile(ap); armPngs.push(ap);
  }
  const L = String(TERRAIN.length);
  toktx([...COLOR(255), '--layers', L, path.join(o, 'color_height.ktx2'), ...colorPngs]);
  toktx([...DATA(2.5), '--layers', L, path.join(o, 'normal.ktx2'), ...norPngs]);
  toktx([...DATA(3), '--layers', L, path.join(o, 'arm.ktx2'), ...armPngs]);
  fs.writeFileSync(path.join(o, 'layers.json'), JSON.stringify(TERRAIN));
  console.log('terrain arrays');
}

async function foliageAtlases() {
  const o = path.join(OUT, 'veg');
  mk(o);
  const v = path.join(SRC, 'veg');
  const jobs = [
    ['conifer', (p) => foliage.conifer(v, p)],
    ['broadleaf_a', (p) => foliage.broadleaf(v, p, 3, 0)],
    ['broadleaf_b', (p) => foliage.broadleaf(v, p, 11, -14)],
    ['grass', (p) => foliage.grass(v, p)],
  ];
  for (const [name, fn] of jobs) {
    const png = path.join(TMP, `${name}.png`);
    await fn(png);
    toktx(['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1', '--zcmp', '18', '--assign_oetf', 'srgb', path.join(o, `${name}.ktx2`), png]);
    console.log('foliage', name);
  }
  // Bark: scanned pine bark from the pine_tree_01 model, tiled on procedural trunks.
  for (const [id, srcDir] of [['pine_bark', 'pine_tree_01'], ['island_bark', 'island_tree_02']]) {
    const s = path.join(v, srcDir);
    const files = id === 'pine_bark' ? ['bark_diff', 'bark_nor_gl', 'bark_arm'] : ['Diffuse', 'nor_gl', 'arm'];
    const outs = ['diff', 'nor', 'arm'];
    mk(path.join(OUT, 'tex', id));
    for (let k = 0; k < 3; k++) {
      const png = path.join(TMP, `${id}_${outs[k]}.png`);
      await sharp(path.join(s, `${files[k]}.png`)).removeAlpha().toColourspace('srgb').resize(1024, 1024).png({ compressionLevel: 1 }).toFile(png);
      toktx([...(k === 0 ? COLOR() : DATA()), path.join(OUT, 'tex', id, `${outs[k]}.ktx2`), png]);
    }
    console.log('bark', id);
  }
}

// Triangle budgets for props (LOD0). Rocks also get a coarse LOD1.
const BUDGET = {
  coast_rocks_01: 20000, boulder_01: 6000, rock_moss_set_01: 8000, rock_moss_set_02: 8000, fire_hydrant: 3000, concrete_road_barrier: 3000,
  modular_chainlink_fence: 3000, dead_tree_trunk: 5000, tree_stump_01: 4000, portable_welding_cart: 6000, portable_generator: 6000,
  metal_jerrycan: 2000, street_lamp_01: 5000, shrub_02: 3000, shrub_03: 3000, shrub_04: 3000, fern_02: 2500, dry_branches_medium_01: 4000,
  wooden_military_crate: 3000, plastic_crate_01: 3000, exterior_aircon_unit: 5000, power_box_01: 4000, small_lpg_tank: 4000,
  metal_trash_can: 5000, old_military_crate: 4000, lifebuoy: 4000, ocean_buoy: 6000, lateral_sea_marker: 6000, hand_truck: 4000,
  metal_tool_chest: 5000, wooden_crate_01: 3000, wooden_crate_02: 3000, propane_tank: 3000,
};
// simplification error bound (fraction of mesh size); thin wire meshes need more freedom
const SIMPLIFY_ERROR = { modular_chainlink_fence: 0.06, boulder_01: 0.08, coast_rocks_01: 0.02 };
const LOD1 = { coast_rocks_01: 3000, boulder_01: 1000, rock_moss_set_01: 1500, rock_moss_set_02: 1500 };

function triCount(file) {
  const out = run(path.join(ROOT, 'node_modules/.bin/gltf-transform'), ['inspect', file, '--format', 'csv']).toString();
  // meshes table: sum the "glPrimitives"? use renderVertexCount fallback
  const lines = out.split('\n');
  let tris = 0, inMesh = false, idx = -1;
  for (const l of lines) {
    if (/^\s*MESHES/i.test(l)) { inMesh = true; continue; }
    if (inMesh && /name,/.test(l)) { idx = l.split(',').indexOf('glPrimitives'); continue; }
    if (inMesh && /^\s*$/.test(l) && idx >= 0) break;
    if (inMesh && idx >= 0) tris += Number(l.split(',')[idx]) || 0;
  }
  return tris; // vertices, used as a proxy for complexity
}

/** Fallback when seams stop regular simplification: meshopt sloppy simplifier per primitive. */
async function sloppy(input, output, targetTris) {
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(input);
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) total += p.getIndices()?.getCount() / 3 || 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION');
    if (!idx) continue;
    const want = Math.max(36, Math.floor(((idx.getCount() / 3) * targetTris) / total) * 3);
    const src = new Uint32Array(idx.getArray());
    const [out] = MeshoptSimplifier.simplifySloppy(src, new Float32Array(pos.getArray()), 3, null, want, 0.05);
    idx.setArray(new Uint32Array(out));
  }
  await io.write(output, doc);
}

async function models() {
  const o = path.join(OUT, 'models');
  mk(o);
  for (const [id] of MANIFEST.models) {
    const src = path.join(SRC, 'models', id, `${id}.gltf`);
    const dst = path.join(o, `${id}.glb`);
    if (fresh(dst, src)) continue;
    const a = path.join(TMP, `${id}_a.glb`), b = path.join(TMP, `${id}_b.glb`);
    gt(['copy', src, a]);
    gt(['weld', a, b]);
    let cur = b;
    const verts = triCount(cur);
    const budget = BUDGET[id] || 6000;
    const lodSrc = cur;
    if (verts > budget * 1.2) {
      const ratio = Math.max(0.005, budget / verts);
      const c = path.join(TMP, `${id}_c.glb`);
      gt(['simplify', cur, c, '--ratio', ratio.toFixed(4), '--error', String(SIMPLIFY_ERROR[id] || 0.012)]);
      cur = c;
      if (triCount(cur) > budget * 1.5) { const d2 = path.join(TMP, `${id}_s.glb`); await sloppy(cur, d2, budget); cur = d2; }
    }
    const finish = (input, out, maxTex) => {
      const r = path.join(TMP, `${path.basename(out)}_r.glb`), e = path.join(TMP, `${path.basename(out)}_e.glb`), u = path.join(TMP, `${path.basename(out)}_u.glb`);
      gt(['resize', input, r, '--width', String(maxTex), '--height', String(maxTex)]);
      gt(['etc1s', r, e, '--slots', '{baseColorTexture,emissiveTexture}', '--quality', '230']);
      gt(['uastc', e, u, '--slots', '{normalTexture,metallicRoughnessTexture,occlusionTexture}', '--level', '2', '--rdo', '--rdo-lambda', '2.5', '--zstd', '18']);
      gt(['meshopt', u, out, '--level', 'medium']);
    };
    finish(cur, dst, 1024);
    if (LOD1[id]) {
      const c = path.join(TMP, `${id}_l1.glb`);
      gt(['simplify', lodSrc, c, '--ratio', Math.max(0.002, LOD1[id] / verts).toFixed(4), '--error', '0.03']);
      let l1 = c;
      if (triCount(c) > LOD1[id] * 1.5) { l1 = path.join(TMP, `${id}_l1s.glb`); await sloppy(c, l1, LOD1[id]); }
      finish(l1, path.join(o, `${id}_lod1.glb`), 512);
    }
    console.log('model', id, verts, '->', fs.statSync(dst).size);
  }
}

async function hdri() {
  mk(path.join(OUT, 'hdri'));
  for (const h of MANIFEST.hdris) fs.copyFileSync(path.join(SRC, 'hdri', `${h.id}_${h.res}.hdr`), path.join(OUT, 'hdri', `${h.id}.hdr`));
}

function credits() {
  const info = JSON.parse(fs.readFileSync(path.join(SRC, 'info.json'), 'utf8'));
  const list = Object.entries(info).map(([id, i]) => ({
    id, name: i.name, type: ['hdri', 'texture', 'model'][i.type] || i.type,
    authors: Object.keys(i.authors || {}), license: 'CC0 1.0', source: `https://polyhaven.com/a/${id}`,
  }));
  fs.writeFileSync(path.join(OUT, 'CREDITS.json'), JSON.stringify(list, null, 1));
}

(async () => {
  mk(OUT);
  if (want('hdri')) await hdri();
  if (want('textures')) await textures();
  if (want('terrain')) await terrain();
  if (want('foliage')) await foliageAtlases();
  if (want('models')) await models();
  credits();
  fs.rmSync(TMP, { recursive: true, force: true });
})().catch((e) => { console.error(e.stderr?.toString() || e); process.exit(1); });

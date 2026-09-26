// Offline model pipeline: downloads CC0 glTF scans from Poly Haven and produces
// browser-ready GLBs (meshopt geometry, KTX2/Basis textures, optional LOD1).
//
//   TOKTX_DIR=/path/to/KTX-Software/bin node tools/build_models.mjs
//
// Each entry: [polyhaven id, texture res, simplify ratio for LOD0 (1 = keep), make LOD1?]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache', 'models');
const OUT = path.join(ROOT, 'assets', 'models');
const CLI = path.join(ROOT, 'tools', 'node_modules', '.bin', 'gltf-transform');

const MODELS = [
  // outdoor props
  ['old_tyre', '1k', 1, false],
  ['rusted_wheel_rim_01', '1k', 0.35, false],
  ['barrel_03', '1k', 1, false],
  ['metal_jerrycan_green', '1k', 0.5, false],
  ['trashbag', '1k', 1, false],
  ['wooden_crate_01', '1k', 1, false],
  ['plastic_crate_01', '1k', 0.4, false],
  ['covered_car', '2k', 1, true],
  ['rusted_spade_01', '1k', 0.5, false],
  ['wooden_ladder', '1k', 1, false],
  ['watering_can_metal_01', '1k', 0.5, false],
  ['wooden_bucket_01', '1k', 1, false],
  ['hatchet', '1k', 1, false],
  // nature
  ['rock_moss_set_01', '2k', 0.25, true],
  ['rock_moss_set_02', '2k', 0.25, true],
  ['boulder_01', '1k', 0.12, true],
  ['tree_stump_01', '1k', 0.2, true],
  ['dead_tree_trunk', '1k', 0.15, true],
  ['dry_branches_medium_01', '1k', 0.5, false],
  ['fern_02', '1k', 1, false],
  ['nettle_plant', '1k', 0.35, false],
  ['shrub_02', '1k', 0.4, true],
  // interior
  ['old_bed_frame', '1k', 0.3, false],
  ['painted_wooden_cabinet', '1k', 1, false],
  ['painted_wooden_table', '1k', 1, false],
  ['painted_wooden_chair_01', '1k', 1, false],
  ['painted_wooden_shelves', '1k', 1, false],
  ['scandinavian_masonry_heater', '2k', 1, false],
  ['wooden_bookshelf_worn', '1k', 1, false],
  ['cardboard_box_01', '1k', 0.4, false],
  ['rubber_boots', '1k', 0.3, false],
  ['pot_enamel_01', '1k', 0.5, false],
  // loot
  ['russian_food_cans_01', '1k', 1, false],
  ['can_rusted', '1k', 1, false],
  ['medical_box', '1k', 1, false],
  ['old_gas_mask', '1k', 0.5, false],
  ['plastic_bottle_gallon', '1k', 0.5, false],
  ['wooden_military_crate', '1k', 0.4, false],
  ['ammo_box', '1k', 1, false],
  ['bolt_action_rifle_7_62', '1k', 0.6, false],
];

const env = { ...process.env };
if (process.env.TOKTX_DIR) {
  env.PATH = `${process.env.TOKTX_DIR}:${env.PATH}`;
  env.LD_LIBRARY_PATH = `${path.join(process.env.TOKTX_DIR, '..', 'lib')}:${env.LD_LIBRARY_PATH || ''}`;
}
const run = (...args) => execFileSync(CLI, args, { env, stdio: ['ignore', 'ignore', 'inherit'] });

async function fetchTo(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'dayz-asset-pipeline/1.0' } });
      if (!r.ok) throw new Error(r.status);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      console.warn('retry', url, e.message);
      await new Promise((res) => setTimeout(res, 2000 * 2 ** i));
    }
  }
  throw new Error('download failed ' + url);
}

async function download(id, res) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': 'dayz-asset-pipeline/1.0' } })).json();
  const g = files.gltf[res].gltf;
  const dir = path.join(CACHE, id, res);
  await fetchTo(g.url, path.join(dir, `${id}.gltf`));
  await Promise.all(Object.entries(g.include).map(([rel, f]) => fetchTo(f.url, path.join(dir, rel))));
  return path.join(dir, `${id}.gltf`);
}

function encode(src, dst, ratio) {
  const tmp = dst.replace(/\.glb$/, '.tmp.glb');
  run('copy', src, tmp);
  run('dedup', tmp, tmp);
  run('weld', tmp, tmp);
  if (ratio < 1) run('simplify', tmp, tmp, '--ratio', String(ratio), '--error', '0.002');
  run('etc1s', tmp, tmp, '--slots', '{baseColorTexture,occlusionTexture,metallicRoughnessTexture,specularColorTexture}', '--quality', '200');
  run('uastc', tmp, tmp, '--slots', 'normalTexture', '--level', '2', '--rdo', '--rdo-lambda', '4', '--zstd', '19');
  run('meshopt', tmp, dst, '--level', 'medium');
  fs.rmSync(tmp);
}

const manifest = {};
const mpath = path.join(ROOT, 'assets', 'models.json');
for (const [id, res, ratio, lod1] of MODELS) {
  const dst = path.join(OUT, `${id}.glb`);
  const src = await download(id, res);
  if (!fs.existsSync(dst)) encode(src, dst, ratio);
  const entry = { url: `assets/models/${id}.glb`, source: `https://polyhaven.com/a/${id}`, license: 'CC0-1.0' };
  if (lod1) {
    const dstL = path.join(OUT, `${id}_lod1.glb`);
    if (!fs.existsSync(dstL)) {
      const tmp = dstL.replace(/\.glb$/, '.tmp.glb');
      run('copy', src, tmp);
      run('dedup', tmp, tmp);
      run('weld', tmp, tmp);
      run('simplify', tmp, tmp, '--ratio', String(ratio * 0.15), '--error', '0.01');
      run('resize', tmp, tmp, '--width', '256', '--height', '256');
      run('etc1s', tmp, tmp, '--quality', '160');
      run('meshopt', tmp, dstL, '--level', 'medium');
      fs.rmSync(tmp);
    }
    entry.lod1 = `assets/models/${id}_lod1.glb`;
  }
  manifest[id] = entry;
  console.log('model', id, (fs.statSync(dst).size / 1e6).toFixed(2) + 'MB');
}
fs.writeFileSync(mpath, JSON.stringify(manifest, null, 1));

// Downloads source assets (CC0, Poly Haven) into assets-src/.
// Usage: node tools/fetch-assets.mjs
// Every asset used is recorded in public/assets/CREDITS.json by build-assets.mjs.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets-src');
const API = 'https://api.polyhaven.com';

export const MANIFEST = {
  hdris: [{ id: 'kloofendal_48d_partly_cloudy_puresky', res: '2k' }],
  // [id, resolution, maps]  maps: Poly Haven map keys
  textures: [
    ['aerial_grass_rock', '2k'], ['forrest_ground_01', '2k'], ['gravel_floor', '2k'], ['brown_mud_02', '2k'],
    ['coast_land_rocks_01', '2k'], ['coast_sand_rocks_02', '2k'],
    ['concrete_floor_worn_001', '2k'], ['concrete_wall_008', '2k'], ['asphalt_02', '2k'],
    ['blue_metal_plate', '2k'], ['wood_floor_deck', '2k'], ['metal_plate', '1k'],
    ['corrugated_iron_02', '2k'], ['factory_brick', '2k'], ['rusty_corrugated_iron', '1k'],
    ['rust_coarse_01', '1k'], ['pine_bark', '1k'], ['bark_brown_02', '1k'], ['painted_concrete', '1k'],
  ],
  // Models: [id, res]
  models: [
    ['Barrel_01', '1k'], ['barrel_03', '1k'], ['old_military_crate', '1k'], ['wooden_crate_01', '1k'],
    ['wooden_crate_02', '1k'], ['propane_tank', '1k'], ['metal_jerrycan', '1k'], ['old_tyre', '1k'],
    ['portable_generator', '1k'], ['portable_welding_cart', '1k'], ['metal_tool_chest', '1k'],
    ['concrete_road_barrier', '1k'], ['street_lamp_01', '1k'], ['security_light', '1k'],
    ['utility_box_01', '1k'], ['water_manhole_cover', '1k'], ['fire_hydrant', '1k'], ['lifebuoy', '1k'],
    ['ocean_buoy', '1k'], ['lateral_sea_marker', '1k'], ['modular_chainlink_fence', '1k'],
    ['rollershutter_door', '1k'], ['hand_truck', '1k'], ['cement_bag', '1k'],
    ['steel_frame_shelves_01', '1k'], ['industrial_wall_lamp', '1k'], ['hanging_industrial_lamp', '1k'],
    ['rock_moss_set_01', '2k'], ['rock_moss_set_02', '2k'], ['boulder_01', '2k'], ['coast_rocks_01', '2k'],
    ['tree_stump_01', '1k'], ['dry_branches_medium_01', '1k'], ['wooden_military_crate', '1k'],
    ['plastic_crate_01', '1k'], ['exterior_aircon_unit', '1k'], ['power_box_01', '1k'],
    ['small_lpg_tank', '1k'], ['metal_trash_can', '1k'], ['worn_metal_rack', '1k'],
    ['shrub_02', '1k'], ['shrub_03', '1k'], ['shrub_04', '1k'],
    ['fern_02', '1k'], ['dead_tree_trunk', '1k'],
  ],
  // Texture sets extracted from vegetation models (used on procedural trees/grass cards)
  modelMaps: [
    ['pine_tree_01', '2k', ['twig_diff', 'twig_alpha', 'twig_nor_gl', 'twig_arm', 'bark_diff', 'bark_nor_gl', 'bark_arm']],
    ['island_tree_02', '2k', ['leaves_diff', 'leaves_alpha', 'leaves_nor_gl', 'leaves_arm', 'nor_gl', 'arm', 'Diffuse']],
    ['grass_medium_01', '1k', ['Diffuse', 'Alpha', 'nor_gl', 'arm', 'dry_diff']],
  ],
};

async function get(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
}
async function json(u) {
  for (let attempt = 0; ; attempt++) {
    try { return await (await fetch(u)).json(); } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt));
    }
  }
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

const info = {};
async function main() {
  fs.mkdirSync(SRC, { recursive: true });
  for (const h of MANIFEST.hdris) {
    const f = await json(`${API}/files/${h.id}`);
    await get(f.hdri[h.res].hdr.url, path.join(SRC, 'hdri', `${h.id}_${h.res}.hdr`));
    info[h.id] = await json(`${API}/info/${h.id}`);
  }
  await pool(MANIFEST.textures, 6, async ([id, res]) => {
    const f = await json(`${API}/files/${id}`);
    for (const map of ['Diffuse', 'nor_gl', 'arm', 'Displacement']) {
      const m = f[map]?.[res];
      if (!m) continue;
      const fmt = m.jpg ? 'jpg' : 'png';
      await get(m[fmt].url, path.join(SRC, 'textures', id, `${map}.${fmt}`));
    }
    info[id] = await json(`${API}/info/${id}`);
    console.log('tex', id);
  });
  await pool(MANIFEST.models, 6, async ([id, res]) => {
    const f = await json(`${API}/files/${id}`);
    const g = f.gltf[res].gltf;
    const dir = path.join(SRC, 'models', id);
    await get(g.url, path.join(dir, `${id}.gltf`));
    for (const [rel, v] of Object.entries(g.include)) await get(v.url, path.join(dir, rel));
    info[id] = await json(`${API}/info/${id}`);
    console.log('model', id);
  });
  await pool(MANIFEST.modelMaps, 3, async ([id, res, maps]) => {
    const f = await json(`${API}/files/${id}`);
    for (const map of maps) {
      const m = f[map]?.[res];
      if (!m) { console.warn('missing', id, map); continue; }
      const fmt = m.png ? 'png' : 'jpg';
      await get(m[fmt].url, path.join(SRC, 'veg', id, `${map}.${fmt}`));
    }
    info[id] = await json(`${API}/info/${id}`);
    console.log('veg', id);
  });
  fs.writeFileSync(path.join(SRC, 'info.json'), JSON.stringify(info, null, 1));
}
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((e) => { console.error(e); process.exit(1); });

// Declarative list of every third-party asset the game ships.
// All sources are CC0 (public domain): Poly Haven (https://polyhaven.com/license)
// and ambientCG (https://docs.ambientcg.com/license/). fetch-assets.mjs downloads
// the sources into .cache/, the build-*.mjs scripts turn them into KTX2 / GLB.
//
// size: real-world width of one texture tile in metres (from Poly Haven metadata
// where available) - the runtime uses it so UVs in metres map to correct scale.
// tiers: output resolutions. 'hi' is used on desktop High/Ultra, 'lo' on Low/Medium
// and on mobile.

export const textures = [
  // --- terrain layers ---------------------------------------------------
  { name: 'grass', src: 'ph', id: 'leafy_grass', res: '2k', hi: 2048, lo: 1024, size: 2.0, group: 'terrain' },
  { name: 'soil', src: 'ph', id: 'forest_ground_04', res: '2k', hi: 2048, lo: 1024, size: 2.0, group: 'terrain' },
  { name: 'forest', src: 'ph', id: 'forest_leaves_04', res: '2k', hi: 2048, lo: 1024, size: 2.0, group: 'terrain' },
  { name: 'gravel', src: 'ph', id: 'rocks_ground_01', res: '2k', hi: 2048, lo: 1024, size: 2.0, group: 'terrain' },
  { name: 'mud', src: 'ph', id: 'brown_mud_02', res: '2k', hi: 2048, lo: 1024, size: 2.0, group: 'terrain' },
  { name: 'rock', src: 'ph', id: 'mossy_rock', res: '2k', hi: 2048, lo: 1024, size: 3.0, group: 'terrain' },
  { name: 'asphalt', src: 'ph', id: 'asphalt_02', res: '2k', hi: 2048, lo: 1024, size: 3.0, group: 'road' },
  // --- architecture -------------------------------------------------------
  { name: 'plaster_mossy', src: 'ph', id: 'worn_mossy_plasterwall', res: '2k', hi: 2048, lo: 1024, size: 1.8 },
  { name: 'plaster_damaged', src: 'ph', id: 'damaged_plaster', res: '2k', hi: 2048, lo: 1024, size: 2.0 },
  { name: 'plaster_ochre', src: 'ph', id: 'rough_plaster_broken', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'brick_white', src: 'ph', id: 'worn_brick_wall', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'brick_red', src: 'ph', id: 'brick_4', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'concrete', src: 'ph', id: 'concrete_wall_006', res: '1k', hi: 1024, lo: 512, size: 2.5 },
  { name: 'roof_asbestos', src: 'ph', id: 'asbestos_sheet', res: '2k', hi: 2048, lo: 1024, size: 2.0 },
  { name: 'roof_tiles', src: 'ph', id: 'roof_tiles_14', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'corr_rust', src: 'ph', id: 'rusty_corrugated_iron', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'corr_worn', src: 'ph', id: 'worn_corrugated_iron', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'metal_red', src: 'ph', id: 'rusty_painted_metal', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'metal_green', src: 'ph', id: 'green_metal_rust', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'metal_white', src: 'ph', id: 'rusty_metal_02', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'wood_weathered', src: 'ph', id: 'weathered_planks', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'wood_painted', src: 'ph', id: 'wood_peeling_paint_weathered', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'floor_wood', src: 'ph', id: 'old_wood_floor', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'wall_interior', src: 'ph', id: 'peeling_painted_wall', res: '1k', hi: 1024, lo: 512, size: 2.0 },
  { name: 'canvas', src: 'ph', id: 'rough_linen', res: '1k', hi: 1024, lo: 512, size: 1.0 },
  { name: 'burlap', src: 'ph', id: 'hessian_230', res: '1k', hi: 1024, lo: 512, size: 0.5 },
  // --- bark ----------------------------------------------------------------
  { name: 'bark_pine', src: 'ph', id: 'pine_bark', res: '1k', hi: 1024, lo: 512, size: 1.0 },
  { name: 'bark_oak', src: 'ph', id: 'bark_brown_02', res: '1k', hi: 1024, lo: 512, size: 1.0 },
  { name: 'bark_dead', src: 'ph', id: 'bark_willow', res: '1k', hi: 1024, lo: 512, size: 1.0 },
  { name: 'bark_birch_src', src: 'acg', id: 'Bark005', res: '1K', hi: 1024, lo: 512, size: 1.0, derive: 'birch' },
  // --- clothing ------------------------------------------------------------
  { name: 'denim', src: 'ph', id: 'denim_fabric', res: '1k', hi: 512, lo: 256, size: 0.5 },
  { name: 'wool', src: 'ph', id: 'caban', res: '1k', hi: 512, lo: 256, size: 0.5 },
  { name: 'leather', src: 'ph', id: 'brown_leather', res: '1k', hi: 512, lo: 256, size: 0.5 },
];

// Alpha-tested card atlases (foliage). maps taken from Poly Haven model texture sets.
export const atlases = [
  { name: 'fir_twig', src: 'ph', id: 'fir_tree_01', prefix: 'twig_', res: '2k', hi: 2048, lo: 1024 },
  { name: 'broadleaf', src: 'ph', id: 'tree_small_02', prefix: 'leaves_', res: '2k', hi: 2048, lo: 1024 },
  { name: 'grass_cards', src: 'ph', id: 'grass_medium_01', prefix: '', res: '2k', hi: 2048, lo: 1024, extraDiffuse: 'dry_diff' },
  { name: 'birch_leaves', src: 'acg', id: 'LeafSet009', res: '1K', hi: 1024, lo: 512 },
];

// Decals (alpha-blended overlays): leaks under sills / roof edges, road markings.
export const decals = [
  { name: 'leak', src: 'acg', id: 'Leaking004', res: '1K', hi: 1024, lo: 512 },
  { name: 'roadlines', src: 'acg', id: 'RoadLines007', res: '1K', hi: 1024, lo: 512 },
];

// Sky HDRIs. Processed into sun parameters + sun-removed sky LDR-with-scale JPEGs.
export const skies = [
  { name: 'dawn', id: 'kloppenheim_06_puresky' },
  { name: 'day', id: 'sunflowers_puresky' },
  { name: 'dusk', id: 'wasteland_clouds_puresky' },
  { name: 'night', id: 'kloppenheim_02_puresky' },
  { name: 'overcast', id: 'overcast_soil_puresky' },
];

// Poly Haven models -> GLB. tex: texture edge length shipped (hi); tris: simplify target
// (0 = keep). All get meshopt compression + KTX2 (ETC1S) textures.
export const models = [
  // containers / junk
  { id: 'Barrel_01', tex: 1024 },
  { id: 'Barrel_02', tex: 1024 },
  { id: 'barrel_stove', tex: 1024 },
  { id: 'wooden_crate_01', tex: 1024 },
  { id: 'old_military_crate', tex: 1024 },
  { id: 'plastic_crate_01', tex: 512, tris: 6000, error: 0.01 },
  { id: 'cardboard_box_01', tex: 512, tris: 4000 },
  { id: 'metal_jerrycan_green', tex: 512 },
  { id: 'plastic_jerrycan', tex: 512 },
  { id: 'metal_trash_can', tex: 512 },
  { id: 'trashbag', tex: 512 },
  { id: 'propane_tank', tex: 512 },
  { id: 'ammo_box', tex: 512 },
  { id: 'medical_box', tex: 512 },
  { id: 'russian_food_cans_01', tex: 512 },
  { id: 'cement_bag', tex: 512 },
  { id: 'old_tyre', tex: 512 },
  { id: 'rusted_wheel_rim_01', tex: 512, tris: 5000 },
  // structures
  { id: 'concrete_road_barrier', tex: 1024, tris: 8000 },
  { id: 'covered_car', tex: 2048 },
  { id: 'modular_electricity_poles', tex: 1024, tris: 12000, keep: 'preset_01_' },
  { id: 'modular_chainlink_fence', tex: 1024, tris: 20000 },
  { id: 'street_lamp_01', tex: 1024, tris: 10000 },
  { id: 'utility_box_01', tex: 512 },
  { id: 'portable_generator', tex: 1024, tris: 9000, error: 0.01 },
  { id: 'portable_searchlight', tex: 512, tris: 8000 },
  // camp life
  { id: 'stone_fire_pit', tex: 1024 },
  { id: 'wooden_picnic_table', tex: 1024 },
  { id: 'plastic_monobloc_chair_01', tex: 512 },
  { id: 'wooden_bucket_01', tex: 512 },
  { id: 'watering_can_metal_01', tex: 512, tris: 6000 },
  { id: 'hatchet', tex: 512 },
  { id: 'rusted_spade_01', tex: 512, tris: 5000 },
  { id: 'wooden_ladder', tex: 512 },
  { id: 'old_gas_mask', tex: 512, tris: 6000 },
  { id: 'vintage_radio_transceiver', tex: 1024, tris: 8000, error: 0.01 },
  // interiors
  { id: 'old_bed_frame', tex: 1024, tris: 12000 },
  { id: 'WoodenTable_01', tex: 1024 },
  { id: 'WoodenChair_01', tex: 512, tris: 6000 },
  { id: 'painted_wooden_cabinet', tex: 1024 },
  { id: 'wooden_bookshelf_worn', tex: 1024 },
  { id: 'steel_frame_shelves_01', tex: 1024 },
  { id: 'scandinavian_masonry_heater', tex: 1024 },
  // nature
  { id: 'shrub_03', tex: 1024, tris: 4000, error: 0.03 },
  { id: 'shrub_04', tex: 1024, tris: 5000, error: 0.03 },
  { id: 'fern_02', tex: 1024, tris: 2800, error: 0.03 },
  { id: 'weed_plant_02', tex: 1024, tris: 3600, error: 0.03 },
  { id: 'nettle_plant', tex: 1024, tris: 3600, error: 0.03 },
  { id: 'tree_stump_01', tex: 1024, tris: 3000, error: 0.03 },
  { id: 'tree_stump_02', tex: 1024, tris: 3000, error: 0.03 },
  { id: 'rock_moss_set_01', tex: 1024, tris: 9000, error: 0.03 },
  { id: 'rock_moss_set_02', tex: 1024, tris: 9000, error: 0.03 },
  { id: 'dead_tree_trunk', tex: 1024, tris: 6000, error: 0.03 },
  { id: 'dry_branches_medium_01', tex: 512, tris: 6000 },
];

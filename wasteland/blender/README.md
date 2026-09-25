# Blender asset pipeline

These scripts build the game's textures and models in Blender 4.5 LTS. Each one runs headless
(`blender -b --factory-startup --python SCRIPT -- ARGS`). The WebP and GLB files they produce live in
`../assets/`, and the game loads them from there.

| Script | Makes | Output |
| --- | --- | --- |
| `bake_materials.py` | 13 tiling PBR material sets. Each is a procedural Cycles node graph sampled on a 4D torus so it tiles without seams, then baked channel by channel. Sets: dirt, cracked mud, grass, rock, concrete, brick, painted metal (red, teal, cream, yellow), corrugated steel, rust, wood planks, bark, cloth and road. | `NAME_c_SIZE.png` (colour), `NAME_n_SIZE.png` (OpenGL normal map), `NAME_orm_SIZE.png` (R = ambient occlusion, G = roughness, B = metalness). The terrain sets pack roughness into the colour map's alpha and height into the normal map's alpha. |
| `make_rocks.py` | 3 boulders. Each is a dense sphere cut by random planes and roughened with fractal noise. Colour, normal, AO and roughness are baked from the dense mesh onto a 700-triangle mesh and a 130-triangle LOD. | `rocks.glb` (`rock{0,1,2}_{0,1}`), `rocks_{c,n,orm}_SIZE.png`, `rocks1_{c,n}_256.png` |
| `make_branch.py` | A fir branch built from about 13,000 modelled needles, rendered top-down as the alpha card the pine trees use. | `branch_c_{1024,512}.png` |
| `make_cars.py` | 1950s sedan, delivery van and a burnt-out wreck. Bodies are lofted from cross-sections, with wheel wells, tail fins, chrome trim, glass, lamps and wheels. Parts are grouped by material, and each car has a lower-detail copy for distance. | `cars.glb` with meshes named `KIND__MATERIAL` and `KIND__MATERIAL__lo` |
| `fetch_ph.py`, `pack_photoscans.py` | Download CC0 photo-scanned texture sets from Poly Haven and pack them into the game's layouts (see `../assets/CREDITS.md`). These replace the procedural sets from `bake_materials.py`. | `NAME_c/n/orm_SIZE.png` |
| `make_humans.py` | Survivor, raider, trader and ghoul from MakeHuman (MPFB 2 extension plus CC0 asset packs): arms posed down, MPFB's 53-bone rig merged into the game's 17 joints, one baked atlas each, vault-suit and ghoul-skin painting. | `char_KIND.glb`, `char_KIND_{c,n}_SIZE.png` |
| `make_creatures.py` | Hound, brahmin, mole rat, radroach and stalker built on the game's creature skeletons: skinned limb chains merged by voxel remesh, swept horns/claws/teeth, procedural skin baked to an atlas. | `cr_KIND.glb`, `cr_KIND_{c,n}_SIZE.png` |
| `fetch_phm.py`, `make_props.py` | Download Poly Haven glTF props and turn them into light game props (decimated, grounded, lids kept separate, tools hung from the grip). | `prop_NAME.glb`, `prop_NAME_{c,n,orm}_SIZE.png` |
| `make_bus.py` | The 1950s school bus. | `bus.glb` |
| `preview.py`, `preview_glb.py`, `preview_char.py`, `preview_cr.py`, `preview_props.py` | Contact sheets and Cycles previews for checking the output. | PNG |
| `to_webp.sh` | Converts the PNGs to the WebP files the game loads. Requires `cwebp`. | `*.webp` |
| `glb_to_json.py` | Wraps each `.glb` as base64 inside JSON, because some hosts (claude.ai artifacts among them) don't serve `.glb`. The page loads these wrappers. | `*.glb.json` |

Rebuild everything:

`make_humans.py` needs the MPFB extension installed in Blender with the CC0 "makehuman_system_assets", "suits02" and "pants01" asset packs unpacked into its user data folder (links in `../assets/CREDITS.md`); run it once per kind: `blender -b --python make_humans.py -- survivor models tex`.

```sh
python3 fetch_ph.py 2k dry_ground_rocks mud_cracked_dry_03 forrest_ground_01 rock_face_03 dirty_concrete brick_4 green_metal_rust worn_corrugated_iron rust_coarse_01 old_planks_02 pine_bark hessian_230 asphalt_02
blender -b --factory-startup --python pack_photoscans.py -- ph tex
python3 fetch_phm.py 1k barrel_stove Barrel_01 wooden_crate_01 ammo_box old_tyre concrete_road_barrier metal_trash_can metal_jerrycan propane_tank dead_tree_trunk dead_tree_trunk_02 tree_stump_01 covered_car portable_generator wooden_axe_03 cross_pein_hammer
blender -b --factory-startup --python make_props.py -- phm models tex
for k in hound cattle burrower roach stalker; do blender -b --factory-startup --python make_creatures.py -- $k models tex; done
blender -b --factory-startup --python make_bus.py -- models
blender -b --factory-startup --python make_rocks.py -- models
blender -b --factory-startup --python make_branch.py -- models
blender -b --factory-startup --python make_cars.py -- models
sh to_webp.sh tex ../assets/tex && sh to_webp.sh models ../assets/tex && cp models/*.glb ../assets/models/
python3 glb_to_json.py ../assets/models/*.glb
```

The game's code maps the model files onto its own materials, so the GLBs carry geometry, normals and
UVs but no materials. They import into Unreal Engine 5 and other engines as ordinary glTF 2.0 meshes.
Apply the matching texture sets from `../assets/tex/` there.

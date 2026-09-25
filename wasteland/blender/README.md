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
| `fetch_phm.py`, `make_props.py` | Download Poly Haven glTF props and turn them into light game props (decimated, grounded, lids kept separate, tools hung from the grip). Also the weapons: the Poly Haven pistol, rifle and machete, plus a shotgun and a pipe rifle kitbashed from the rifle (its stock cut down, with new barrels, rusty pipes and tape), each turned barrel-forward with its origin at the grip. | `prop_NAME.glb`, `prop_NAME_{c,n,orm}_SIZE.png` (weapons are `prop_g_KIND`) |
| `make_kit.py` | The building and street kits from Poly Haven models. `kitw`: two fire-escape levels assembled from the modular fire escape (the second with stairs down to the first, the first with a drop ladder), an air-con unit, plain and graffiti roller shutters for doors and windows, downpipe parts and a wall lamp. `kits`: a street lamp, a fire hydrant, a utility box, a manhole cover, two wooden power poles and a stone fire pit. The pieces of a kit share one baked atlas, so they batch into one draw call. | `kitw.glb`, `kits.glb`, `KIT_{c,n,orm}_{1024,512}.png` |
| `make_bus.py` | The 1950s school bus. | `bus.glb` |
| `make_anims.py` | Retargets CC0 animation libraries onto the game's rigs: Quaternius' Universal Animation Library 1 and 2 onto the 17-joint people rig, and his Ultimate Animated Animal Pack (wolf, cow, fox) onto the hound, brahmin and burrower rigs, with the animals' legs placed by two-bone IK. Clips are 30 fps int16 quaternions per joint plus the root offset, and locomotion clips record their natural speed so the game can match playback to movement. | `anims.json` |
| `preview.py`, `preview_glb.py`, `preview_char.py`, `preview_cr.py`, `preview_props.py`, `preview_guns.py`, `preview_kit.py` | Contact sheets and Cycles previews for checking the output. | PNG |
| `to_webp.sh` | Converts the PNGs to the WebP files the game loads. Requires `cwebp`. | `*.webp` |
| `glb_to_json.py` | Wraps each `.glb` as base64 inside JSON, because some hosts (claude.ai artifacts among them) don't serve `.glb`. The page loads these wrappers. | `*.glb.json` |
| `pack_textures.py` | Bundles `../assets/tex/*.webp` into a few base64 JSON packs per resolution tier (`hi` for 1024-px desktops, `lo` for phones and Low quality) for hosts that cap the number of files; the claude.ai artifact build of the page reads `pack/manifest.json`, while `index.html` loads the WebP files directly. | `pack/manifest.json`, `pack/{hi,lo}_N.json` |

Rebuild everything:

`make_humans.py` needs the MPFB extension installed in Blender with the CC0 "makehuman_system_assets", "suits02" and "pants01" asset packs unpacked into its user data folder (links in `../assets/CREDITS.md`); run it once per kind: `blender -b --python make_humans.py -- survivor models tex`.

```sh
python3 fetch_ph.py 2k dry_ground_rocks mud_cracked_dry_03 forrest_ground_01 rock_face_03 dirty_concrete brick_4 green_metal_rust worn_corrugated_iron rust_coarse_01 old_planks_02 pine_bark hessian_230 asphalt_02
blender -b --factory-startup --python pack_photoscans.py -- ph tex
python3 fetch_phm.py 1k barrel_stove Barrel_01 wooden_crate_01 ammo_box old_tyre concrete_road_barrier metal_trash_can metal_jerrycan propane_tank dead_tree_trunk dead_tree_trunk_02 tree_stump_01 covered_car portable_generator wooden_axe_03 cross_pein_hammer handsaw_wood sledgehammer_01 crowbar_01 picke_dirty_01 hatchet
python3 fetch_phm.py 1k service_pistol bolt_action_rifle_7_62 machete modular_fire_escape rollershutter_door rollershutter_window_02 exterior_aircon_unit modular_metal_gutter security_light street_lamp_01 fire_hydrant utility_box_02 water_manhole_cover modular_electricity_poles stone_fire_pit
blender -b --factory-startup --python make_props.py -- phm models tex   # the kitbashed guns also read ph/rust_coarse_01 and ph/hessian_230
blender -b --factory-startup --python make_kit.py -- phm models tex
# motion clips (CC0): download into anim/ first
#   anim/universal_animation_librarystandard.zip   https://opengameart.org/content/universal-animation-library   (unzip in place)
#   anim/x_ual2_standard/...                       https://opengameart.org/content/universal-animation-library-2 (unzip into x_ual2_standard/)
#   anim/uaa/{Wolf,Cow,Fox}.gltf                   https://quaternius.com/packs/ultimateanimatedanimals.html (glTF folder)
blender -b --factory-startup --python make_anims.py -- anim ../assets/models/anims.json
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

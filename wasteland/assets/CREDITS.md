# Asset credits

Everything in `assets/` is either made in Blender by the scripts in `../blender/` or built from free CC0 (public domain) sources. CC0 needs no attribution; the authors are listed here as thanks.

## Photo-scanned textures: [Poly Haven](https://polyhaven.com) (CC0)

| Game material | Poly Haven asset | Authors |
| --- | --- | --- |
| dirt | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) | Rob Tuytel |
| cracked | [Mud Cracked Dry 03](https://polyhaven.com/a/mud_cracked_dry_03) | Dario Barresi, Dimitrios Savva |
| grass | [Forest Ground 01](https://polyhaven.com/a/forrest_ground_01) | Rob Tuytel |
| rock | [Rock Face 03](https://polyhaven.com/a/rock_face_03) | Dario Barresi, Rico Cilliers |
| concrete | [Dirty Concrete](https://polyhaven.com/a/dirty_concrete) | Rob Tuytel |
| brick | [Brick 4](https://polyhaven.com/a/brick_4) | Rob Tuytel |
| paint (recoloured red / teal / cream / yellow) | [Green Metal Rust](https://polyhaven.com/a/green_metal_rust) | Rob Tuytel |
| corrugated | [Worn Corrugated Iron](https://polyhaven.com/a/worn_corrugated_iron) | Jenelle van Heerden, Dimitrios Savva |
| rust | [Rust Coarse 01](https://polyhaven.com/a/rust_coarse_01) | Dimitrios Savva, Rico Cilliers |
| wood | [Old Planks 02](https://polyhaven.com/a/old_planks_02) | Rob Tuytel |
| bark | [Pine Bark](https://polyhaven.com/a/pine_bark) | Dimitrios Savva |
| cloth | [Hessian 230](https://polyhaven.com/a/hessian_230) | colormass, Rico Cilliers |
| road (plus painted lines and verge sand) | [Asphalt 02](https://polyhaven.com/a/asphalt_02) | Rob Tuytel |

Downloaded at 2k with `fetch_ph.py`, then packed into the game layouts, tiled to real-world scale and saved at 1024 and 512 px by `pack_photoscans.py`.

## Photo-scanned props: [Poly Haven](https://polyhaven.com) (CC0)

| Game prop | Poly Haven asset | Authors |
| --- | --- | --- |
| barrel | [Barrel Stove](https://polyhaven.com/a/barrel_stove) | MP |
| waste barrel | [Barrel_01](https://polyhaven.com/a/Barrel_01) | Jorge Camacho |
| loot chest | [Wooden Crate 01](https://polyhaven.com/a/wooden_crate_01) | James Ray Cock |
| ammo can | [Ammo Box](https://polyhaven.com/a/ammo_box) | DanKit |
| tyre | [Old Tyre](https://polyhaven.com/a/old_tyre) | MP |
| jersey barrier | [Concrete Road Barrier](https://polyhaven.com/a/concrete_road_barrier) | Amal Kumar |
| trash can | [Metal Trash Can](https://polyhaven.com/a/metal_trash_can) | GurJas Studios |
| jerrycan | [Metal Jerrycan](https://polyhaven.com/a/metal_jerrycan) | Sean Buckley |
| gas bottle | [Propane Tank](https://polyhaven.com/a/propane_tank) | Slinc |
| fallen log | [Dead Tree Trunk](https://polyhaven.com/a/dead_tree_trunk) | Rob Tuytel |
| fallen log with branches | [Dead Tree Trunk 02](https://polyhaven.com/a/dead_tree_trunk_02) | Jenelle van Heerden, Rico Cilliers |
| tree stump | [Tree Stump 01](https://polyhaven.com/a/tree_stump_01) | Rob Tuytel |
| covered car | [Covered Car](https://polyhaven.com/a/covered_car) | MP |
| generator | [Portable Generator](https://polyhaven.com/a/portable_generator) | James Ray Cock |
| axe | [Wooden Axe 03](https://polyhaven.com/a/wooden_axe_03) | Ulan Cabanilla |
| hammer | [Cross Pein Hammer](https://polyhaven.com/a/cross_pein_hammer) | Tics |

Downloaded as 1k glTF with `fetch_phm.py`; decimated, re-oriented and repacked by `make_props.py`.

## Weapons: [Poly Haven](https://polyhaven.com) (CC0)

| Game weapon | Poly Haven asset | Authors |
| --- | --- | --- |
| 10mm pistol | [Service Pistol](https://polyhaven.com/a/service_pistol) | Mateusz Sadek |
| hunting rifle; the stock of the shotgun and the pipe rifle | [Bolt Action Rifle 7.62](https://polyhaven.com/a/bolt_action_rifle_7_62) | Mateusz Sadek |
| machete | [Machete](https://polyhaven.com/a/machete) | Ulan Cabanilla |

The shotgun and the pipe rifle are kitbashed from the rifle in `make_props.py`: new barrels, pipes, bands and tape, textured with the Rust Coarse 01 and Hessian 230 scans listed above.

## Building and street kit: [Poly Haven](https://polyhaven.com) (CC0)

| Game piece | Poly Haven asset | Authors |
| --- | --- | --- |
| fire escapes on the ruins | [Modular Fire Escape](https://polyhaven.com/a/modular_fire_escape) | Juniix |
| roller shutters (garage, shop doors) | [Rollershutter Door](https://polyhaven.com/a/rollershutter_door) | MP |
| roller shutters (shop windows) | [Rollershutter Window 02](https://polyhaven.com/a/rollershutter_window_02) | MP |
| air-con units | [Exterior Aircon Unit](https://polyhaven.com/a/exterior_aircon_unit) | Monsta3D |
| downpipes | [Modular Metal Gutter](https://polyhaven.com/a/modular_metal_gutter) | Maxim Domnin |
| wall lamps at the gas station | [Security Light](https://polyhaven.com/a/security_light) | Maximilian Schuster |
| street lamps | [Street Lamp 01](https://polyhaven.com/a/street_lamp_01) | Josh Dean |
| fire hydrants | [Fire Hydrant](https://polyhaven.com/a/fire_hydrant) | Gonçalo Felício |
| utility boxes | [Utility Box 02](https://polyhaven.com/a/utility_box_02) | James Ray Cock |
| manhole covers | [Water Manhole Cover](https://polyhaven.com/a/water_manhole_cover) | Raunox |
| power poles along the roads | [Modular Electricity Poles](https://polyhaven.com/a/modular_electricity_poles) | James Ray Cock |
| homestead fire pit | [Stone Fire Pit](https://polyhaven.com/a/stone_fire_pit) | Sebastian Platen |

Downloaded as 1k glTF with `fetch_phm.py`; assembled, decimated and baked into two shared atlases by `make_kit.py`.

## People: [MakeHuman](http://www.makehumancommunity.org) via [MPFB 2](https://static.makehumancommunity.org/mpfb.html) (CC0 output)

The survivor, raiders, traders and ghouls are generated with MPFB 2.0.17 in Blender (`make_humans.py`) from the CC0 "MakeHuman system assets" pack (base mesh, skins, eyes, hair `short01`/`short02`, casual suits 01 and 05, `shoes03`, `fedora01`), "suits02" (`matcreator_mc-skinsuit_2022`, recoloured into the vault suit) and "pants01" (`cortu_cargo_pants`). MPFB itself is GPL-3.0 software; models made with it and the listed asset packs are CC0.

## Made in Blender for this game

- Cars (sedan, van, burnt-out wreck) and the school bus: `make_cars.py`, `make_bus.py`.
- Boulders and the fir branch card: `make_rocks.py`, `make_branch.py`.
- Creatures (mutant hound, two-headed brahmin, mole rat, radroach, horned stalker): `make_creatures.py`.
- `bake_materials.py` makes an all-procedural alternative to the photo-scanned material sets (same file names; rerun it and `to_webp.sh` to swap them in).

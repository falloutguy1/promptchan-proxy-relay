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
| `preview.py`, `preview_glb.py` | Contact sheets and Cycles previews for checking the output. | PNG |
| `to_webp.sh` | Converts the PNGs to the WebP files the game loads. Requires `cwebp`. | `*.webp` |
| `glb_to_json.py` | Wraps each `.glb` as base64 inside JSON, because some hosts (claude.ai artifacts among them) don't serve `.glb`. The page loads these wrappers. | `*.glb.json` |

Rebuild everything:

```sh
blender -b --factory-startup --python bake_materials.py -- tex    # about 90 s on a 4-core CPU
blender -b --factory-startup --python make_rocks.py -- models
blender -b --factory-startup --python make_branch.py -- models
blender -b --factory-startup --python make_cars.py -- models
sh to_webp.sh tex ../assets/tex && sh to_webp.sh models ../assets/tex && cp models/*.glb ../assets/models/
python3 glb_to_json.py ../assets/models/cars.glb ../assets/models/rocks.glb
```

The game's code maps the model files onto its own materials, so the GLBs carry geometry, normals and
UVs but no materials. They import into Unreal Engine 5 and other engines as ordinary glTF 2.0 meshes.
Apply the matching texture sets from `../assets/tex/` there.

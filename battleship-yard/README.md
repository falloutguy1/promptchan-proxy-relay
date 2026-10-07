# Kestrel Point Shipyard

A browser and mobile game built with three.js and WebGL2. You design a battleship at a fitting-out quay, check its naval-architecture numbers, then take it out on sea trials and fire at target rafts.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5173  (add ?perf to show the frame-rate overlay, ?quality=low|medium|high|ultra)
npm run build        # static site in dist/ (relative paths, so it can be hosted from any folder)
```

The runtime assets in `public/assets/` are already built and committed. To rebuild them from source:

```bash
npm run assets:fetch                     # downloads CC0 sources from Poly Haven into assets-src/
TOKTX_DIR=/path/to/KTX-Software npm run assets:build   # needs toktx (KTX-Software 4.3) for KTX2 encoding
```

## What's in it

- **Design mode.** Set the hull (length, beam, freeboard, sheer, bow and stern form), main battery (layout, calibre, guns per turret), secondaries, AA, armour, machinery, bridge style and paint. The ship is rebuilt live at the berth. Stats are first-order estimates calibrated against real ships (Iowa, KGV, Yamato, Nelson): weight breakdown, draught, Admiralty-coefficient speed, metacentric height, roll period, broadside and turning circle, with warnings for unstable, slow or under-armoured designs. Designs are saved in `localStorage`.
- **Sea trials.** Engine telegraph and rudder, wave-driven heave and pitch, roll from the design's GM, heel in turns, grounding, wake foam, funnel smoke. Turrets train and elevate with a ballistic solution, fire salvos with recoil, and raise calibre-scaled water columns. Hits on four target rafts are scored.
- **Walk the yard.** Explore at eye height: quay, fabrication shed (furnished interior), office, store, containers, crane.

## Rendering

- HDRI image-based lighting (Poly Haven `kloofendal_48d_partly_cloudy_puresky`). The sun direction and colour are taken from the HDRI's brightest region. ACES filmic tone mapping, light grading, distance haze.
- One directional shadow map that is refitted to the area you're looking at each frame and snapped to texels. GTAO (High/Ultra) and restrained bloom.
- Terrain: a 3 × 2.3 km heightfield generated in a Web Worker, with a coastline distance field, a dredged berth, a yard platform and a road. Six scanned ground layers in KTX2 texture arrays are height-blended, with tri-planar rock, anti-tiling, macro variation, shoreline wetness and baked horizon AO. Chunks are streamed in four LODs with skirts.
- Water: six Gerstner waves shared by the GPU shader and CPU buoyancy, per-pixel analytic normals plus detail normals, depth-based absorption from the terrain heightfield, and foam from the shore, wave crests, the hull, the wake and splashes.
- Vegetation: procedural pines, spruces and broadleaf trees with irregular trunks, branching and bark at real-world scale. Foliage cards are cut from Poly Haven tree scans. Trees are clustered by terrain and moisture, use three LODs on instanced meshes, and have wind sway and leaf translucency. Grass cards stream around the camera. Poly Haven shrubs, ferns, rocks and dead wood are also placed.
- All textures are KTX2 (ETC1S for colour, UASTC for normal/ARM data) with correct colour spaces. Meshes are meshopt-compressed GLB, simplified where needed.

## Quality presets

| Preset | Render scale | Shadows | AO | MSAA | Grass radius | Trees |
|---|---|---|---|---|---|---|
| Low | 75% | 1024 | – | FXAA | 28 m | 1,100 |
| Medium | 90% | 2048 | – | 2× | 42 m | 1,700 |
| High | 100% | 4096 | GTAO | 4× | 60 m | 2,400 |
| Ultra | 100% (DPR ≤ 2.5) | 4096 | GTAO | 4× | 80 m | 3,000 |

The preset is picked automatically from the device: touch devices with a small screen or ≤ 4 GB RAM start on Low. You can change it in ⚙, which also has a render-resolution slider.

## Credits

All scanned textures, the HDRI and the prop models are from [Poly Haven](https://polyhaven.com) under CC0. The per-asset list with authors is in `public/assets/CREDITS.json`. The ship, terrain, trees, crane, buildings and containers are procedural.

# Day Z — Forest Edge Farmstead (Three.js / WebGL2)

One fully built survival location: an abandoned post-Soviet rural house at the
edge of a mixed spruce/birch forest, a dirt road with a sagging power line, a
farm pond, and a 1 km² surrounding landscape. First-person, scavenge-and-survive.

Open `dayz/index.html` from any static web server (the repo's Netlify config
already publishes it at `/dayz/`). No build step.

```
npx http-server .           # or: python3 -m http.server
# then http://localhost:8080/dayz/
```

## Controls
W A S D move · Shift sprint · C crouch · Space jump · E pick up / open door ·
Tab inventory · Esc pause & settings · F2 screenshot · F3 performance overlay

URL options: `?quality=low|medium|high|ultra`, `?scale=0.75` (render resolution),
`?perf` (overlay), `?bench` (20 s scripted walk-through that prints avg / p50 /
p95 / p99 frame times, draw calls and triangles for *your* GPU).

## What's in it
| Area | Implementation |
|---|---|
| Lighting | Poly Haven HDRI → PMREM for IBL; the sun disc is clamped out of the env map and re-added as a shadow-casting directional light whose direction and irradiance were measured from the 4k source (`tools/build_textures.py`). AgX filmic tone mapping, mild desaturation/vignette grade, exponential haze tinted with the HDRI horizon colour. GTAO for contact occlusion. No bloom/DOF/motion blur. |
| Terrain | 1 m heightfield (generated in a Web Worker), 64 m chunks with 4 LODs + skirts. Six scanned layers in KTX2 texture arrays, height-blended, anti-tiling second sample, macro colour variation, baked canopy/house occlusion. Road with crown, ditches and wheel ruts; driveway, footpath, pond bowl and a foundation splash zone. |
| House | Built from real construction dimensions: 40 cm walls with plaster reveals, casement windows set 12 cm in on concrete sills with plaster surrounds, bevelled frames, glazing bars and some broken panes (MeshPhysicalMaterial glass), panelled door that opens, corrugated asbestos-cement roof as real geometry phase-matched to the scan's normal map, boxed eaves, board-clad gables with battens and louvred vent, half-round gutters on brackets, downpipes, chimney, porch and steps. Plaster fails physically: brick shows through in the splash zone and a few water-damaged patches; grime and run-off streaks near the ground. Three furnished rooms. |
| Vegetation | 12 procedural tree variants (silver birch, Norway spruce, Scots pine, oak, shrubs) from a port of ez-tree, 13 k instances with scale/lean/rotation/leaf-colour variation, clustered by a forest mask. LOD0 → LOD1 (twigs dropped, fewer larger cards) → impostors baked at load from 8 azimuths under the real sun. Wind sway + leaf flutter shared with shadow depth materials; alpha-mip correction; back-lit translucency. Geometric grass (curved tapered blades, 2 LODs, edge fade, wind, pushed by the player) whose density follows the splat map. |
| Props | 40 CC0 Poly Haven scans (KTX2 + meshopt, LOD1 for heavy ones): covered car, tyres, rain barrel, crates, ladder, chopping stump with hatchet, ferns, stumps, fallen trunks, mossy rocks, nettles along the walls; instanced with distance/frustum culling. Procedural picket fence with collapsed and stripped bays and an open gate. |
| Gameplay | Capsule-vs-shape collision, step-up floors, doors, 10 loot items (food, water, medkit, rifle…), health/food/water meters, surface-dependent procedural footsteps and wind. |

## Performance & quality settings
Presets change render scale, shadow map size/radius, GTAO, AA (SMAA/FXAA), grass
radius/density, tree LOD distances, prop distances and anisotropy. Load: ~110 MB
of compressed assets (textures are KTX2/Basis, so GPU memory stays compressed).

Measured in this environment (the only one available — headless Chromium on
**SwiftShader, a CPU software renderer; no GPU**):

| Preset | Canvas | Draw calls | Triangles / frame (all passes) | Frame time |
|---|---|---|---|---|
| low | 857×482 | 390 | 2.3 M | several seconds (software) |
| high | 1280×720 | 823 | 6.6 M | several seconds (software) |

Software-GL frame times say nothing about a real GPU, so **no real-device FPS
has been measured yet**. Run `?bench` on the target machine to get the numbers;
the triangle/draw-call load above is what the GPU has to handle.

## Tooling (`tools/`, not deployed)
- `build_textures.py` — downloads Poly Haven scans + HDRI, packs ARM/height, encodes KTX2 (sRGB colour, linear data, UASTC normals), terrain texture arrays, sky backdrop, sun measurement.
- `build_models.mjs` — glTF → dedup/weld/simplify → KTX2 → meshopt GLB, plus LOD1.
- `build_trees.py` — bark/leaf textures to KTX2 with alpha dilation.
- `capture.mjs` — runs the actual game headless and writes screenshots from given views.
- `smoke.mjs` — functional test: wall collision, door, entering the house, loot pickup.

## Unfinished / not available
- **No characters or zombies** — no rigged, licence-clear human asset was available offline; the location is built for them but none are placed.
- The house and fence are procedural geometry in code (with bevels and metric UVs), not DCC-authored GLBs.
- Indirect light inside the house is approximated (lower IBL on interior materials + GTAO), not baked lightmaps.
- Impostors are pre-lit for the fixed sun; there is no day/night cycle or weather change.
- The pond reflects only the sky (no screen-space/planar reflections) and reads slightly milky.
- Trees come from a procedural generator with card leaves — convincing at gameplay distance, less so in extreme close-up.
- Only one location is finished; the rest of the 1 km² is forest/meadow filler.

Asset credits and licences: [CREDITS.md](CREDITS.md).

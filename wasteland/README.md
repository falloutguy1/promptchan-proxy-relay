# Rustwater Colony

A post-apocalyptic colony builder that runs in the browser (Three.js on WebGL2).
Nine years after the collapse, a handful of survivors make camp at a crossroads in
an abandoned Eastern-European village. Keep them fed, watered, housed and alive
through the nights when the dead come out of the woods, then power a radio mast
and hold out until the evacuation convoy answers.

Two ways to run the settlement:

- **You command** — place every structure, set each survivor's job, send people
  where you want them (move, chop, scavenge, build, attack), take direct
  first-person control of anyone.
- **AI Overseer** — a utility-based planner builds, lays out the camp, assigns
  jobs by skill, answers strangers and trades, and writes the reason for every
  decision in the Overseer log. Toggle it at any time (Tab / AI button); a
  survivor you give an order to is locked to you and the Overseer leaves them
  alone.

Desktop (mouse + keyboard) and mobile (touch, landscape) layouts are built in and
chosen automatically; either can be forced in Settings.

Play: open `/wasteland/` from the site root (any static server works; no build
step). `?quality=low|medium|high|ultra` overrides the auto-detected preset.

## How to play

1. Shelter everyone (tents, then shacks), secure water (rain collector, well),
   plant crops (farm plot + a farmer).
2. From night 2 the dead come in hordes that grow every night. Build a
   watchtower, then a barricade ring with a gate. Gunfire, chopping and building
   draw them in; walls hurt what batters them; bites need meds within a day.
3. Build a generator (fuel), then the radio mast. 48 hours on air brings the
   convoy: that is the win. You can keep playing afterwards.

Scavenging sites (houses, the shop, the petrol station, the barn, car wrecks,
the army checkpoint) hold finite loot and some of them are guarded.

**Desktop:** drag / WASD to pan, right-drag or Q/E to rotate, wheel to zoom,
click to select, right-click with a survivor selected to give an order,
B build categories, 1–3 speed, Space pause, Tab AI, C colony, H camp,
V first person (click shoots, hold E uses), F follow, Esc menu, F3 stats.

**Touch:** one finger pans, pinch zooms, twist rotates; tap selects; with a
survivor selected, tap a target to order; Build opens a sheet (tap to position,
✓ to place, ↻ or long-press to rotate); first person has a stick, fire and use
buttons.

## What is in the world

- One hand-authored location, 1 km² of heightfield (1 m) with a playable 420 m
  square: the highway through the village, a gravel farm track, a dirt track to
  the pond, ten houses, shop, petrol station, water tower, farmstead and barn,
  a military checkpoint, overgrown fields and four forests.
- Terrain: six scanned PBR layers in compressed texture arrays, splat blending
  with height-aware transitions, two-scale anti-tiling, macro variation,
  puddles when it rains; 4 LODs with skirts.
- Buildings: procedural with real wall thickness, recessed layered windows,
  sills, doors, overhanging roofs with fascia, gutters and downpipes, chimneys,
  interiors, weathering from exposure (splash-back grime, streaks), ruins.
- Colony structures (15 types) built in visible stages: stakes and string,
  frames, boards row by row, roofs last; lumber piles shrink as work progresses.
- Vegetation: procedural conifer/birch/oak/dead trees with bark and foliage
  atlases, LOD meshes and lit impostors; GPU grass with wind; scanned shrubs,
  ferns, stumps, rocks, weeds in clusters.
- Sky: photographed HDR skies blended through the day with the sun removed and
  re-added analytically; physically derived sun colour; image-based lighting
  rebuilt as the sun moves; moonlit nights, fog, rain.
- Characters: procedurally built skinned survivors and infected (19 bones) with
  procedural gait matched to ground speed, work cycles, aiming, carrying,
  sleeping, dying; rifles move from back to shoulder; tools in hand.

## Code layout

```
index.html, css/game.css      page, HUD markup, styles (desktop + touch)
src/main.js                   capability checks, error screens, boot
src/game.js                   renderer, loop, flows (menu/new/load/quit), first person, dynamic resolution
src/core/                     assets (KTX2/meshopt), settings/presets, camera rig, input, shader library
src/world/                    terrain, roads, water, sky, trees, grass, props, town + arch/ builders, dynamic models
src/sim/                      defs, nav (A*), structures, agents (survivors, infected), sim (colony), ai (Overseer)
src/gfx/                      post-processing, humanoid + animator + characters, FX
src/ui/                       HUD, minimap, interaction (selection/orders/placement), menus, overlays
src/audio.js                  synthesised ambience and sound effects (WebAudio)
tools/                        asset pipeline and test/review harnesses (Node)
```

## Asset pipeline (tools/)

All scanned assets are CC0 from Poly Haven and ambientCG. `npm run fetch-assets`
downloads sources; `build-textures`, `build-skies`, `build-models`,
`build-foliage` convert them (KTX2 ETC1S/UASTC via basisu with separate
colour/data encodings, XY-packed normals, ORM packing, two resolution tiers,
meshopt-compressed glTF with external KTX2 textures). The in-game Credits page
lists every asset with author, source link and licence, generated from the
manifests.

## Testing and review tools

- `node tools/shots.mjs <shots.json>` — screenshots of fixed views from the running game.
- `node tools/play_shots.mjs` — plays an AI colony and captures milestones (start, sites, day 2, close-ups, night, first person).
- `node tools/smoke.mjs --mode ai --hours 168` — fast-forwards the simulation headless and prints colony state (balance testing).
- `node tools/ui_flow.mjs <out> [--mobile]` — clicks through menu → new colony → panels → pause → settings in the live loop.
- `node tools/bench.mjs` / `node tools/drawstats.mjs` — frame timing and draw-call budgets per preset.

## Performance

Quality presets are picked from the device (phones: Low or Medium by memory;
desktops: High) and can be changed in Settings. Each sets render scale and pixel
ratio cap, shadow map size and distance, ambient occlusion (off / half / full),
bloom, anti-aliasing (FXAA / SMAA / MSAA), grass density and distance, tree
detail, draw distance, texture tier, point-light budget and environment-map
resolution. Dynamic resolution drops the render scale (to 55% at most) when the
frame rate falls below ~40 fps and restores it above ~56 fps. Budgets in place:
per-material batching of buildings and colony structures, instancing for every
repeated model with CPU frustum/distance culling, tree LODs + lit impostors with
shadow-only proxies, spatial cells for tree culling, terrain chunk LODs, KTX2
(Basis) compressed textures in two resolution tiers, frozen transforms for
static scenery, a fixed point-light pool (no shader recompiles), throttled
image-based-lighting updates and animation LOD for distant characters.

Download per session: about 33 MB on the standard texture tier (Low/Medium),
about 88 MB on the high tier (High/Ultra); assets are cacheable for a week.

**What was actually measured, and where.** The only environment available while
building this was a headless Chromium in a container **without a GPU**: WebGL2
ran on SwiftShader, a CPU software rasteriser. Wall-clock frame times there are
seconds per frame and say nothing about real devices, so they are not reported
as frame rates. What does carry over is the scene cost (draw calls, triangles)
and, approximately, the JavaScript time per frame (simulation, culling, command
submission; inflated here because the software rasteriser competes for the same
CPU). Measured with `tools/bench.mjs` on day 2 of an AI-run colony, 5 timed
frames per view:

| preset | view | JS ms / frame | draw calls | triangles | internal resolution |
|---|---|---|---|---|---|
| Low | strategy, close | 10.4 | 177 | 0.82M | 832×468 |
| Low | strategy, wide | 14.5 | 258 | 1.17M | 832×468 |
| Low | first person | 12.4 | 276 | 1.83M | 832×468 |
| Medium | strategy, close | 15.4 | 223 | 1.02M | 1088×612 |
| Medium | strategy, wide | 16.0 | 303 | 1.38M | 1088×612 |
| Medium | first person | 21.9 | 327 | 1.73M | 1088×612 |
| High | strategy, close | 25.1 | 305 | 1.43M | 1280×720 |
| High | strategy, wide | 18.1 | 360 | 1.81M | 1280×720 |
| High | first person | 18.5 | 290 | 1.46M | 1280×720 |

Draw calls include the shadow pass and post-processing. The optimisation pass
(batching tints as vertex colours, culling runtime-placed models, lighter prop
shadows and distances on Low/Medium, larger terrain chunks, leaf-card crops,
tree cells, frozen matrices) cut draw calls by 30–45% against the first
measurement (Low was 312 / 369 / 472, Medium 362 / 416 / 457) and JavaScript
time by roughly a third.

Not measured: real frame rates on any GPU, phone or tablet, thermal behaviour,
and memory pressure on low-memory phones. To measure on your own hardware, open
the game and press **F3** (or enable *Frame rate / stats* in Settings): the
overlay shows fps, average and worst frame time, JavaScript time, draw calls,
triangles and the current resolution scale. `node tools/bench.mjs --gpu` runs the
same views automatically in a headed Chromium on your GPU (serve the repo root
with `node tools/serve.mjs` first).

## Known limitations and unfinished elements

- **Characters are procedural**, lofted from anatomical landmarks with
  per-vertex clothing colours over a fabric normal map. No CC0 realistic,
  rigged and animated human models were available, so there is no facial
  detail, no cloth simulation and no motion capture; they read well at strategy
  and mid distances and look stylised in close-ups.
- **Vehicles**: the only CC0 car available was a tarp-covered one; wrecks are
  static.
- **Audio is synthesised** (no recorded sound files): wind, rain, crickets, birds,
  fire, gunshots, groans.
- Structures sit on the terrain (posts sink into slopes); the heightfield is not
  re-flattened under them. Survivors do not walk through house interiors
  (scavenging happens "inside" while they are hidden).
- One location only; no seasons or snow.
- Saves live in the browser's localStorage (autosave each dawn and when the tab
  is hidden).
- Performance has only been measured in this project's container, where WebGL
  runs on SwiftShader (a CPU rasteriser); no physical GPU or phone was available
  here. See the Performance section for what was measured and how to reproduce
  it on real hardware.

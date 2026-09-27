# Metro Shelter — Station Zarya

A first-person, Fallout Shelter-style survival/management game set in a pylon-type deep metro
station (in the spirit of *Metro 2033*). Built with **Three.js r180 + WebGL2**, no build step.

You are the Overseer. Dwellers staff the **generator**, **water filters**, **mushroom farm**, **workshop**,
**infirmary**, **trading post** and **radio room**. Rooms produce in batches that you must walk to and collect
(**E**), exactly like tapping rooms in Fallout Shelter — except here you have to cross the platform to do it.
Everyone consumes power, water and food. Brown-outs dim and flicker the lights and halt production.
Rats slip under the tunnel barricades and head for the farm. Survive 10 days.

| Key | Action |
| --- | --- |
| WASD / Shift / C | move / run / crouch |
| Mouse, LMB, R | look, fire, reload |
| E | collect a room's batch / search containers |
| Tab | shelter overview: assign dwellers, upgrade rooms |
| F / H | flashlight / use medkit |
| Esc | pause + settings (quality preset, render resolution, FOV, sensitivity, volume, perf overlay) |
| F3 | performance overlay (fps, draw calls, triangles, resolution) |

## Running

Any static file server works; ES modules need http(s), not `file://`.

```sh
node tools/serve.mjs 8080     # then open http://localhost:8080/
```

On Netlify (this repo's `publish = "."`) the game is served at `/metro-shelter/`.

## Project layout

- `src/station.js` — procedural architecture at real scale: 54 m station, 8.4 m central hall with an elliptical
  plaster vault, ribs and cornices, 2 m marble-clad pylons with bevelled arched passages and archivolts, side
  halls, 1.1 m platform with an overhanging granite coping, trackbed with drainage channel, R65-profile rails,
  wooden sleepers, contact rail, cable runs, 40 m horseshoe tunnels with tubbing rings, collapsed escalator
  portal, hermetic gate. All UVs are in metres.
- `src/weathering.js` — world-space weathering injected into `MeshStandardMaterial`: large-scale tonal variation,
  rising damp at wall bases (darker and wetter/lower roughness), water streaks under the vaults, detiling.
- `src/props.js` — shacks (corrugated sheet + plank construction), rooms, lamps, catenary cables, barricades, clutter.
- `src/lights.js` — physically-scaled spot/point lights, shadow budget per quality preset, power coupling.
- `src/renderer.js` — ACES filmic tone mapping, MSAA, GTAO, restrained bloom, grade/vignette/grain, presets.
- `src/shelter.js`, `src/rats.js`, `src/weapon.js`, `src/player.js`, `src/audio.js`, `src/game.js` — gameplay.
- `tools/fetch_assets.py`, `tools/build_assets.mjs` — download CC0 assets and pack them (KTX2 + meshopt + LODs).
- `tools/screenshots.mjs` — captures views from the running game (used for visual review).

Asset credits: see [ASSETS.md](ASSETS.md).

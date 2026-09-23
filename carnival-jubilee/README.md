# Carnival Jubilee 3D

A real-time 3D model of the Carnival Jubilee cruise ship that you can explore. It is one standalone file, `carnival-jubilee.html`: open it in any modern browser, on desktop or mobile. The page has no text; every control is an icon.

- **Exterior views:** bow three-quarter, broadside, aerial, stern, Lido pool deck, BOLT coaster deck, and a ride-along on the coaster.
- **Interiors:** Grand Central atrium, balcony stateroom, main dining room, and main theatre.
- **Time of day:** day, sunset, and night, where cabins and deck LEDs light up.
- **Auto tour and fullscreen.** Drag to orbit and pinch or scroll to zoom. Arrow keys or the number keys 1–9 also switch views.

Everything is procedural: hull loft, livery, balcony facades, furniture, and textures are all generated in code. The only dependency is three.js, which is bundled into the file.

## Rebuild

```sh
npm i three@0.186.0 esbuild
node build.mjs   # writes carnival-jubilee.html
```

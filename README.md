# promptchan-proxy-relay

## Wasteland Survivor Feed

`wasteland/index.html` is a self-contained 3D spectator game (Three.js, loaded from jsDelivr). You watch an AI vault dweller scavenge a post-apocalyptic world, fight raiders and mutated creatures, collect a hammer, saw and axe, pick a homestead site and build it piece by piece.

- On the Netlify site it is served at `/wasteland/`.
- Camera: drag to orbit, scroll or pinch to zoom, keys `1`-`4` switch follow / cinematic / free-fly / overhead. `Space` pauses, `H` hides the HUD.
- Add `#s12345` to the URL to replay a specific world seed.
- Phones start in Low quality, which renders without post-processing. If a device loses its graphics context or post effects fail, the page drops to that mode by itself and says so on screen.

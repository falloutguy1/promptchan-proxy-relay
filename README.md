# promptchan-proxy-relay

## Ashland Drifter (`/wasteland/`)

`wasteland/index.html` is a self-contained 3D survival sim in the style of a post-apocalyptic RPG. You don't play it. You spectate an AI survivor who:

- scavenges crates, lockers, fridges, car trunks and corpses across a procedurally built wasteland (ruined town, gas station, farm, vault entrance, a glowing crater, a raider camp, pine woods and a pond)
- fights or flees raiders, feral ghouls, rad hounds, rad roaches, giant rad stingers and the rare Ash Behemoth
- manages health, hunger, thirst and radiation, sleeps at night, and levels up
- hunts down a Claw Hammer, Hand Saw and Fire Axe, scouts candidate sites, then builds a shelter in 10 stages (foundation to auto-turret), chopping trees for lumber
- defends the camp against night raids; if the survivor dies, a new drifter arrives and can claim the abandoned shelter

Rendering uses three.js r147 (loaded from jsDelivr) with PCF soft shadows, ACES tone mapping, bloom and a film-grade pass, a day/night cycle with dust and rad storms, and procedural textures. Everything else is generated in the page.

Controls: drag to orbit, wheel or pinch to zoom, `1`–`4` for follow / cinematic / free-fly (WASD, Q/E) / tactical cameras, `Space` to pause, `+`/`-` for speed, `H` to hide the HUD, `M` for sound.

Open the file directly in a browser, or visit `/wasteland/` on the Netlify deploy.

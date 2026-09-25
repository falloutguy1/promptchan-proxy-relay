# promptchan-proxy-relay

## Wasteland Survivor Feed

`wasteland/index.html` is a self-contained 3D spectator game (Three.js, loaded from jsDelivr). You watch an AI vault dweller scavenge a post-apocalyptic world, fight raiders and mutated creatures, collect a hammer, saw and axe, pick a homestead site and build it piece by piece.

No two runs play out the same:

- Each dweller rolls two or three personality traits (Cautious, Reckless, Scavenger, Marksman, Brawler, Handy, Green Thumb, Night Owl, Tough, Medic, Nomad, Hunter). Traits change when they fight or retreat, where they explore, which site they settle, and what they build first.
- The tools, the good weapons, raider outposts, ghoul nests, hound territories and the Horned Stalker's lair move around in every world. The dweller guesses where tools are likely to be and can guess wrong.
- The dweller remembers where it ran into trouble and routes around those areas. It sneaks past or ambushes enemies that haven't noticed it, takes cover from gunfire, fights what it can't outrun, and shelters from rad storms.
- Random events interrupt the plan: supply drops, trader caravans (sometimes selling a missing tool), road ambushes and distress calls that may be real, too late, or a trap.
- Homesteads come in three styles: log cabin with a palisade in the woods, plank farmhouse with a rail fence on farmland, and a scrap-metal shack near town or on high ground.
- The STAT tab shows the dweller's personality; DATA shows what it remembers.

Saving:

- The SAVE button opens three save slots plus an autosave. The autosave runs every in-game morning and when you switch away from the tab; you can turn it off in the same panel.
- Loading rebuilds the world from its seed, then restores the survivor, homestead, loot, enemies, events and the survivor's memory as they were when saved.
- When a saved game exists, reopening the page offers to continue it. If the survivor dies, the end screen offers to load the last save.
- Export file / Import file moves a game between browsers or devices as a small `.json` file.
- Inside claude.ai, saves also sync to your Claude account. The standalone page keeps saves in the browser's local storage.

Controls and settings:

- On the Netlify site it is served at `/wasteland/`.
- Camera: drag to orbit, scroll or pinch to zoom, keys `1`-`4` switch follow / cinematic / free-fly / overhead. `Space` pauses, `H` hides the HUD.
- Add `#s12345` to the URL to replay a specific world seed (map, loot placement and the first dweller's personality). Events still differ between runs.
- Phones start in Low quality, which renders without post-processing. If a device loses its graphics context or post effects fail, the page drops to that mode by itself and says so on screen.

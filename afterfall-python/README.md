# Afterfall (Python)

A 3D survival game you watch rather than play. A survivor wakes up in a procedurally generated,
post-Soviet wasteland. They scavenge the dead towns, avoid or fight the infected, and build a homestead one
project at a time. If they die, someone new finds their journal and carries on.

Written in Python with [Ursina](https://www.ursinaengine.org/) (Panda3D) and numpy. An optional free asset
pack swaps the built-in look for photo-scanned textures and motion-captured characters (see below).

## Run it

Needs Python 3.10+ and a computer with an OpenGL 3.2+ graphics card (Windows, macOS or Linux).

```bash
pip install -r requirements.txt
python afterfall.py
```

Options:

| Option | What it does |
| --- | --- |
| `--seed 42` | Same world every time for a given number |
| `--quality low / medium / high` | Shadow resolution and antialiasing (default `high`) |
| `--speed 4` | Starting time speed (0.5 to 16) |
| `--skip 24` | Fast-forward this many game hours before showing |
| `--size 1920x1080`, `--fullscreen` | Window size |
| `--zombies 40` | How many infected roam the map |
| `--no-assets` | Ignore the downloaded asset pack and use the built-in look |

Controls: `1` cinematic director, `2` chase, `3` orbit (drag with the mouse, scroll to zoom), `4` overhead,
`Space` pause, `[` / `]` slower and faster, `H` hide the interface, `Esc` quit.

## Realistic textures, characters and animations (optional)

```bash
python fetch_assets.py            # about 520 MB to download, 75 MB once installed, about a minute to convert
python fetch_assets.py --clean    # the same, then deletes the downloaded zips
```

This downloads free, public-domain (CC0) assets into `assets/` and converts them. The game uses them
automatically from then on:

- **Scanned materials** from [Poly Haven](https://polyhaven.com): plaster, brick, weathered planks, bark,
  rusted paint, corrugated iron, roof tiles, concrete, canvas, leaves, rock, mud, asphalt, grass and forest
  floor. Each comes with colour, normal and roughness maps and is tiled at its real-world size. Buildings and
  props are mapped in their own frame, so bricks stay level on a rotated wall. The terrain blends four ground
  scans by slope, height, roads and forest cover, and everything darkens and turns glossy when it rains.
- **Characters** from Quaternius' [Universal Base Characters](https://quaternius.itch.io/universal-base-characters)
  and [Modular Character Outfits](https://quaternius.itch.io/modular-character-outfits-fantasy): hooded
  survivors (the body is male or female, depending on the name), plus six kinds of infected with torn clothes,
  grey skin and blood stains. Each is about 20 to 30 thousand triangles, skinned on the GPU.
- **Motion-captured animation** from the [Universal Animation Library 1 and 2](https://quaternius.itch.io/universal-animation-library):
  walk, jog, sprint, crouch-walk, tree chopping, kneeling repairs, harvesting, eating, sitting, lying down,
  dying, and zombie shamble, idle and clawing. Clips crossfade, follow the simulation clock (so they pause
  and speed up with the game), and are sped up to match walking speed so the feet don't slide. The axe,
  hammer, rifle and backpack attach to the hand and spine.

`--quality` sets the texture resolution (256, 512 or 1024 pixels). If itch.io refuses the automatic download,
the script prints the four pack pages. Download the free Standard zip from each one, put the zips in
`assets/downloads/`, and run the script again. Credits are written to `assets/CREDITS.txt`.

## The survivor's AI

The survivor's mind lives in `afterfall/ai/` and runs without any graphics (see `tests/test_sim.py`).

- **Utility-based decisions.** Every second, about 20 candidate actions (drink, eat, sleep, scavenge a
  particular building, chop a particular tree, build, repair walls, fight, flee, slip away, and more) get a
  0 to 1 score. Each score combines needs, personality, memory, time of day, weather and danger. The best one
  wins, with a little momentum so the survivor doesn't dither. The **Mind** panel on screen shows the top
  options, their scores and the reason behind each ("fuel station in Staroye · 31 m · never searched").
- **Personality.** Bravery, caution, diligence, curiosity and resilience are rolled for each survivor. They
  change how willing someone is to fight, how far they detour around danger, how hard they work and how fast
  they recover from despair.
- **Memory.** Survivors remember every place they have searched and what they found. They know that towns
  restock slowly, and they avoid places where they nearly died. They keep a heat map of where the infected
  have been seen, which fades over a day. Places are discovered by seeing them. A new survivor inherits the
  previous one's journal.
- **Perception.** Sight has range, a field of view, night and fog penalties, and is blocked by buildings.
  Hearing picks up groans, gunshots, chopping and falling trees.
- **Route planning.** A* over the map, where roads are cheap, slopes are expensive and remembered danger
  costs more for cautious survivors. The palisade has a gate that the survivor uses and the infected can't.
- **Combat tactics.** They weigh the threat against their own strength (weapon, health, stress). They fight
  when they can win, flee towards the walls or away from the pack when they can't, and turn to fight when
  running is pointless (a runner on their heels, or out of breath). They sneak around infected that haven't
  noticed them, and at night they crouch and let them pass.
- **Needs, morale and stress.** Hunger, thirst, energy, warmth, bleeding, morale and stress all matter. Low
  morale leads to despair ("Sit and stare"); high stress ruins aim and sleep.
- **The infected** wander in loose herds and investigate noise (a gunshot draws them from 120 m). They chase
  what they see, search where they lost you, and claw at the palisade until it breaks.

## Project layout

```
afterfall/
  world.py        terrain, roads, towns, vegetation, path grid, collision, line of sight
  homestead.py    the 17 building projects and their upkeep
  sim.py          time, weather, noise, combat, succession of survivors
  ai/survivor.py  the survivor's mind
  ai/memory.py    places, danger map, threats, episodes
  ai/zombie.py    the infected
  render/         Panda3D geometry, shaders, bodies, camera director, HUD, synthesised audio
  render/actors.py      skinned characters from the asset pack
  render/materials.py   texture arrays for the scanned materials
  assets/         asset catalogue, downloader and the character/animation converter
fetch_assets.py   downloads and converts the optional asset pack
tests/test_sim.py headless multi-day run
```

## Test without a screen

```bash
python tests/test_sim.py 1 5      # seed 1, five game days, prints a summary
python tests/test_sim.py 1 2 -v   # also prints the event log
```

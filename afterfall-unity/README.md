# Afterfall (Unity 6 + HDRP)

The Afterfall survival simulation rebuilt for Unity 6 and the High Definition Render Pipeline. You watch an
AI survivor scavenge a post-Soviet wasteland, avoid or fight the infected, and build a homestead. If they
die, the next survivor finds their journal and carries on.

This version uses HDRP's physically based sky, volumetric clouds and fog, screen-space reflections and
ambient occlusion, cascaded shadows, and ACES tonemapping. It also uses free CC0 assets: photo-scanned
materials and motion-captured, humanoid-retargeted characters.

## Set up (about 10 minutes)

1. In Unity Hub, create a new project with **Unity 6 (6000.0 LTS or newer)** and the **High Definition 3D**
   template.
2. Copy the `Assets/Afterfall` folder from this repository into the new project's `Assets` folder.
3. In Unity, choose **Afterfall > Download Free Assets (CC0)**. This downloads about 520 MB and imports it:
   - 15 scanned PBR materials from [Poly Haven](https://polyhaven.com): colour, normal and an HDRP mask map
     for each.
   - Characters, outfits and animations from [Quaternius](https://quaternius.com): Universal Base
     Characters, Modular Character Outfits (Fantasy), and Universal Animation Library 1 and 2 (the free
     Standard editions).

   If itch.io refuses the automatic download, a dialog lists the pages. Download each free **Standard** zip
   by hand into `<project>/AfterfallDownloads/` and run the menu again.
4. Choose **Afterfall > Create Game Scene**. This also turns on the HDRP features the game uses in your
   HDRP asset. Then press **Play**.

The game also runs without step 3, with plain colours and stand-in bodies.

Controls: `1` cinematic director, `2` chase, `3` orbit (drag with the mouse, scroll to zoom), `4` overhead,
`Space` pause, `[` / `]` slower and faster, `H` hide the interface. The `AfterfallGame` component on the
`Afterfall` object has the seed, number of infected, starting speed, fast-forward hours, grass and sound.

## What's in it

- **Simulation** (`Sim/`, plain C# with no UnityEngine references): the same procedural world (terrain,
  roads, a town, a village, a farm, a military checkpoint, forests, a pond) and the same AI as the Python
  version.
  - Utility-scored decisions with personality, memory of places and danger, and sight and hearing.
  - Danger-weighted A* path-finding.
  - The infected wander in herds, investigate noise, chase, search, and claw at the palisade.
  - A 17-project homestead.
- **World** (`Runtime/WorldView.cs`, `TerrainBuilder.cs`, `MeshBuilder.cs`):
  - A Unity Terrain with seven scanned ground layers, splatted by slope, forest cover, water and height.
    Asphalt and dirt roads are painted in.
  - Instanced grass.
  - Buildings, cars, props and trees built as merged meshes with UVs in metres, so every scan tiles at its
    real size and bricks stay level on rotated walls.
  - Rain darkens surfaces and makes them glossy, and HDRP's screen-space reflections pick that up.
- **Characters** (`Runtime/Characters.cs`):
  - Each character is assembled from a Quaternius head, hair and an outfit on one humanoid skeleton.
    Survivors wear a hooded ranger outfit, male or female depending on the name. Six kinds of infected
    wear grimed, bloodied clothes and have grey skin.
  - Mocap clips play through the Playables API (no Animator Controller asset needed). They crossfade,
    follow the simulation clock, and are speed-matched to walking pace.
  - The axe, hammer, rifle and backpack are attached to the hand and chest bones.
- **Atmosphere** (`Runtime/EnvironmentController.cs`):
  - The sun and moon follow the game clock.
  - Volumetric cloud presets and fog density follow the weather.
  - A rain particle system, and a campfire and floodlight with shadows.
- **Interface and sound**: an IMGUI HUD shows the AI's reasoning, a minimap and the event log. Sound is
  synthesised at start-up, so no audio files are needed.

## Checked without the Unity Editor

The code was written outside Unity, so it has never been opened in the Editor. It was checked like this:

```bash
dotnet run -c Release --project SimTests -- 3 4    # runs the simulation for 4 game days, headless
sh Tools/CompileCheck/check.sh                      # compiles everything against Unity 6000.0's assemblies
```

The compile check uses the real `UnityEngine`/`UnityEditor` assemblies from the Unity 6000.0 editor. For
HDRP it uses stubs (`Tools/CompileCheck/HdrpStubs.cs`) whose signatures were copied from the HDRP 17.0.4
source that ships with that editor. It proves the code compiles. It can't prove how things look (exposure,
light intensities, colours), so expect to tune those values in `EnvironmentController.cs` the first time
you press Play.

## Layout

```
Assets/Afterfall/
  Sim/       simulation and AI (no Unity dependency)
  Runtime/   world, terrain, characters, atmosphere, camera director, HUD, sound, AfterfallGame
  Editor/    asset downloader, import settings, catalogue builder, scene setup
SimTests/    headless .NET test of the simulation
Tools/       compile check against the Unity assemblies
```

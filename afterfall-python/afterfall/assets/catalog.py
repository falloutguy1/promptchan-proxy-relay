"""What the optional asset pack contains and where it comes from.

Everything listed here is CC0 (public domain): photo-scanned PBR textures from Poly Haven, and rigged
characters, outfits and motion-captured animation clips from Quaternius. `fetch_assets.py` downloads and
converts them; the game falls back to its procedural look when they are missing.
"""
import os
from pathlib import Path

ASSET_DIR = Path(os.environ.get("AFTERFALL_ASSETS", Path(__file__).resolve().parents[2] / "assets"))
FORMAT_VERSION = 1

# --- textures ----------------------------------------------------------------------------------
# Texture array layers, in order. Layer 0 is reserved for "untextured".
TEXTURES = [
    ("plaster", "white_plaster_02"),
    ("brick", "red_brick_03"),
    ("planks", "weathered_brown_planks"),
    ("bark", "bark_brown_02"),
    ("metal", "green_metal_rust"),
    ("corrugated", "corrugated_iron_02"),
    ("roof", "roof_tiles_14"),
    ("concrete", "concrete_wall_008"),
    ("fabric", "denmin_fabric_02"),
    ("leaves", "forest_leaves_02"),
    ("rock", "rock_face_03"),
    ("mud", "brown_mud_02"),
    ("asphalt", "asphalt_02"),
    ("grass", "leafy_grass"),
    ("forest", "forest_ground_04"),
]
LAYER = {key: i + 1 for i, (key, _) in enumerate(TEXTURES)}
# How far each surface moves from the game's palette colour towards the scan's own average colour.
# Painted and living things keep their palette colour; bricks, stone and asphalt look like themselves.
REAL_COLOR = {"plaster": .3, "brick": .55, "planks": .4, "bark": .45, "metal": .15, "corrugated": .3, "roof": .3,
              "concrete": .4, "fabric": 0.0, "leaves": 0.0, "rock": .55, "mud": .5, "asphalt": .5, "grass": .12, "forest": .45}

# Palette colours (see world.Pal) -> material. Colours not listed stay untextured (glass, chrome, water...).
_PALETTE = {
    "plaster": [0xc9bb97, 0xa9b6b0, 0xd2cbbb, 0xc7a988, 0xb9b08f, 0x9fa89a, 0xa49f93, 0xd8d2c0],
    "brick": [0x8a4b35],
    "planks": [0x7b6a55, 0x6a5c4d, 0x8a3b2c, 0x4d6b56, 0x262320],
    "bark": [0x4a3a2c, 0x6e6558, 0xd9d6cc],
    "metal": [0x5b5c5a, 0x7a4a2c, 0x6b7c63, 0x8b9095, 0x7b2e23, 0xc8bf9f, 0x3e4d63, 0xa58d3c, 0x7a2e24, 0x5f8b78,
              0x4d5238, 0x2c5a8a],
    "corrugated": [0x7f8386, 0x6d4f3a, 0x5f6d5b],
    "roof": [0x6d3024, 0x4b4f55, 0x5b4032],
    "concrete": [0x8f8b83],
    "fabric": [0x5d6444, 0x8a7d5c, 0xb49a52],
    "leaves": [0x2b3f22, 0x31472a, 0x263a20, 0x5a7a2a, 0x6b8a34, 0x3a5226, 0x44602c, 0x55632d],
    "rock": [0x7c7a73],
    "mud": [0x3b2c1e, 0x5c4b37],
    "asphalt": [0x3c3d3e],
}
PALETTE_MATERIAL = {c: LAYER[k] for k, cols in _PALETTE.items() for c in cols}


def material_of(color: int) -> int:
    return PALETTE_MATERIAL.get(color, 0)


# --- characters --------------------------------------------------------------------------------
ITCH_PACKS = {
    "characters": ("https://quaternius.itch.io/universal-base-characters", "Standard", "Universal Base Characters[Standard].zip"),
    "outfits": ("https://quaternius.itch.io/modular-character-outfits-fantasy", "Standard", "Modular Character Outfits - Fantasy[Standard].zip"),
    "anims1": ("https://quaternius.itch.io/universal-animation-library", "Standard", "Universal Animation Library[Standard].zip"),
    "anims2": ("https://quaternius.itch.io/universal-animation-library-2", "Standard", "Universal Animation Library 2[Standard].zip"),
}

# name: (base body, outfit, extra hair meshes, drop outfit meshes whose name contains any of these)
CHARACTERS = {
    "survivor_m": ("Male", "Male_Ranger", ["Hair_Beard"], ["Pauldron"]),
    "survivor_f": ("Female", "Female_Ranger", [], ["Pauldron"]),
    "walker_m1": ("Male", "Male_Peasant", ["Hair_SimpleParted"], []),
    "walker_m2": ("Male", "Male_Peasant", ["Hair_Buzzed", "Hair_Beard"], []),
    "walker_m3": ("Male", "Male_Ranger", ["Hair_Buzzed"], ["Pauldron", "Hood", "Bracer"]),
    "walker_f1": ("Female", "Female_Peasant", ["Hair_Long"], []),
    "walker_f2": ("Female", "Female_Peasant", ["Hair_Buns"], []),
    "walker_f3": ("Female", "Female_Ranger", ["Hair_BuzzedFemale"], ["Pauldron", "Hood", "Bracer"]),
}
SURVIVOR_BODIES = {"m": "survivor_m", "f": "survivor_f"}
WALKER_BODIES = [k for k in CHARACTERS if k.startswith("walker")]

# game animation -> (clip, loops, speed in m/s at which the clip's feet don't slide, or None)
CLIPS = {
    "idle": ("Idle_Loop", True, None),
    "walk": ("Walk_Loop", True, .95),
    "jog": ("Jog_Fwd_Loop", True, 4.0),
    "run": ("Sprint_Loop", True, 6.5),
    "sneak": ("Crouch_Fwd_Loop", True, .66),
    "crouch": ("Crouch_Idle_Loop", True, None),
    "loot": ("Chest_Open", True, None),
    "gather": ("Farm_Harvest", True, None),
    "chop": ("TreeChopping_Loop", True, None),
    "build": ("Fixing_Kneeling", True, None),
    "aim": ("Pistol_Aim_Neutral", True, None),
    "melee": ("Sword_Attack", True, None),
    "eat": ("Consume", True, None),
    "drink": ("Consume", True, None),
    "heal": ("Interact", True, None),
    "sit": ("Sitting_Idle_Loop", True, None),
    "sleep": ("LayToIdle", False, None),        # held on its first frame: lying down
    "dead": ("Death01", False, None),
    "hit": ("Hit_Chest", False, None),
    "zidle": ("Zombie_Idle_Loop", True, None),
    "zwalk": ("Zombie_Walk_Fwd_Loop", True, .98),
    "zrun": ("Jog_Fwd_Loop", True, 4.0),
    "zattack": ("Zombie_Scratch", True, None),
}

CREDITS = """Afterfall optional asset pack - all CC0 1.0 (public domain)

Textures: Poly Haven (https://polyhaven.com), CC0.
  {textures}
Characters, outfits and animations: Quaternius (https://quaternius.com), CC0.
  Universal Base Characters, Modular Character Outfits - Fantasy,
  Universal Animation Library, Universal Animation Library 2 (Standard/free editions).
  Support the author: https://www.patreon.com/quaternius
""".format(textures=", ".join(t for _, t in TEXTURES))


def texture_ready():
    return (ASSET_DIR / "textures" / "materials.json").exists()


def characters_ready():
    return (ASSET_DIR / "characters" / "manifest.json").exists()

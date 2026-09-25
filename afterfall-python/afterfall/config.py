"""World-wide constants. Simulation units are metres; one simulated second is one game minute."""

WORLD = 600.0
HALF = WORLD / 2
HN = 300                  # height-field resolution (2 m cells)
HCELL = WORLD / HN
PN = 150                  # path grid resolution (4 m cells)
PCELL = WORLD / PN
DN = 60                   # danger memory resolution (10 m cells)
DCELL = WORLD / DN
CHUNK = 60.0              # render chunk size

PACE = {"sneak": 1.0, "walk": 1.55, "jog": 3.3, "run": 5.2}

SITES = [
    # name, x, y, radius, kind
    ("Staroye", 0, 0, 66, "town"),
    ("Gorka", -160, 125, 44, "village"),
    ("Kolkhoz Rassvet", 160, -110, 40, "farm"),
    ("Checkpoint 7", -165, -150, 36, "military"),
    ("Homestead", 140, 135, 24, "base"),
]
POND = (78.0, 190.0, 26.0)

ROADS = [
    # asphalt?, width, control points
    (True, 7.5, [(-296, -34), (-120, -20), (-52, -6), (0, 0), (62, 8), (130, 20), (296, 44)]),
    (True, 6.5, [(4, 2), (44, -32), (100, -74), (152, -102)]),
    (False, 5.2, [(-2, 4), (-42, 42), (-98, 88), (-156, 120)]),
    (False, 5.0, [(-52, -6), (-92, -62), (-132, -112), (-160, -142)]),
    (False, 4.4, [(130, 20), (146, 60), (136, 100), (140, 122)]),
]

# Loot tables: item -> (chance, min, max)
LOOT_TABLES = {
    "house":     {"food": (.55, 1, 2), "water": (.45, 1, 2), "nails": (.35, 2, 5), "bandage": (.22, 1, 1), "ammo": (.08, 3, 8), "axe": (.12, 1, 1), "scrap": (.25, 1, 2)},
    "cottage":   {"food": (.55, 1, 2), "water": (.4, 1, 2), "nails": (.3, 1, 4), "bandage": (.2, 1, 1), "axe": (.22, 1, 1), "scrap": (.2, 1, 2)},
    "ruin":      {"scrap": (.6, 1, 3), "nails": (.5, 2, 6), "food": (.15, 1, 1)},
    "apartment": {"food": (.65, 1, 3), "water": (.5, 1, 2), "bandage": (.35, 1, 2), "medkit": (.12, 1, 1), "ammo": (.12, 3, 6), "nails": (.2, 2, 4)},
    "church":    {"food": (.35, 1, 2), "water": (.45, 1, 2), "bandage": (.45, 1, 2), "medkit": (.1, 1, 1)},
    "gas":       {"scrap": (.75, 2, 4), "food": (.55, 1, 3), "water": (.65, 1, 3)},
    "barn":      {"nails": (.7, 3, 8), "scrap": (.55, 1, 3), "axe": (.4, 1, 1), "food": (.2, 1, 1)},
    "car":       {"scrap": (.85, 1, 3), "water": (.12, 1, 1), "food": (.1, 1, 1), "ammo": (.05, 2, 5)},
    "military":  {"ammo": (.8, 5, 14), "rifle": (.35, 1, 1), "medkit": (.4, 1, 1), "food": (.45, 1, 2), "water": (.35, 1, 2), "scrap": (.3, 1, 2)},
}

ITEM_NAMES = {
    "food": ["tin of stewed pork", "can of beans", "pack of crackers", "jar of pickled cabbage", "tin of sardines", "bag of rice"],
    "water": ["bottle of water", "canteen", "jug of rainwater"],
    "nails": ["box of nails"], "scrap": ["scrap metal", "sheet of tin", "car panel"],
    "bandage": ["bandage roll"], "medkit": ["first-aid kit"], "ammo": ["7.62 rounds"],
    "axe": ["woodcutter's axe"], "rifle": ["bolt-action rifle"],
}

FEMALE_NAMES = {"Mira", "Sasha", "Nadia", "Lena", "Katya", "Dasha", "Vera"}   # picks the body model
NAMES = ["Mira Volkova", "Alexei Dragan", "Sasha Koval", "Petr Ilyin", "Nadia Orlova", "Lena Marek",
         "Ivan Rusak", "Katya Belova", "Yuri Sokol", "Dasha Levin", "Oleg Brandt", "Vera Novak"]

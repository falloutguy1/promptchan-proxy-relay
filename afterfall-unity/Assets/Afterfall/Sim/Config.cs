// World-wide constants. Simulation units are metres; one simulated second is one game minute.
// Simulation space: x east, y north, z up (the Unity layer maps it to x, z, y).
using System.Collections.Generic;

namespace Afterfall.Sim
{
    public enum Pace { Sneak, Walk, Jog, Run }

    public static class Config
    {
        public const double WORLD = 600, HALF = WORLD / 2;
        public const int HN = 300;                 // height-field resolution (2 m cells)
        public const double HCELL = WORLD / HN;
        public const int PN = 150;                 // path grid resolution (4 m cells)
        public const double PCELL = WORLD / PN;
        public const int DN = 60;                  // danger memory resolution (10 m cells)
        public const double DCELL = WORLD / DN;
        public const double CHUNK = 60;            // render chunk size

        public static double PaceSpeed(Pace p) => p switch { Pace.Sneak => 1.0, Pace.Walk => 1.55, Pace.Jog => 3.3, _ => 5.2 };
        public static string PaceAnim(Pace p) => p switch { Pace.Sneak => "sneak", Pace.Walk => "walk", Pace.Jog => "jog", _ => "run" };

        public static readonly (string name, double x, double y, double r, string kind)[] SITES =
        {
            ("Staroye", 0, 0, 66, "town"),
            ("Gorka", -160, 125, 44, "village"),
            ("Kolkhoz Rassvet", 160, -110, 40, "farm"),
            ("Checkpoint 7", -165, -150, 36, "military"),
            ("Homestead", 140, 135, 24, "base"),
        };
        public static readonly (double x, double y, double r) POND = (78, 190, 26);

        public static readonly (bool asphalt, double width, (double x, double y)[] pts)[] ROADS =
        {
            (true, 7.5, new[] { (-296.0, -34.0), (-120, -20), (-52, -6), (0, 0), (62, 8), (130, 20), (296, 44) }),
            (true, 6.5, new[] { (4.0, 2.0), (44, -32), (100, -74), (152, -102) }),
            (false, 5.2, new[] { (-2.0, 4.0), (-42, 42), (-98, 88), (-156, 120) }),
            (false, 5.0, new[] { (-52.0, -6.0), (-92, -62), (-132, -112), (-160, -142) }),
            (false, 4.4, new[] { (130.0, 20.0), (146, 60), (136, 100), (140, 122) }),
        };

        // Loot tables: item -> (chance, min, max)
        public static readonly Dictionary<string, (string item, double chance, int lo, int hi)[]> LOOT = new()
        {
            ["house"] = new[] { ("food", .55, 1, 2), ("water", .45, 1, 2), ("nails", .35, 2, 5), ("bandage", .22, 1, 1), ("ammo", .08, 3, 8), ("axe", .12, 1, 1), ("scrap", .25, 1, 2) },
            ["cottage"] = new[] { ("food", .55, 1, 2), ("water", .4, 1, 2), ("nails", .3, 1, 4), ("bandage", .2, 1, 1), ("axe", .22, 1, 1), ("scrap", .2, 1, 2) },
            ["ruin"] = new[] { ("scrap", .6, 1, 3), ("nails", .5, 2, 6), ("food", .15, 1, 1) },
            ["apartment"] = new[] { ("food", .65, 1, 3), ("water", .5, 1, 2), ("bandage", .35, 1, 2), ("medkit", .12, 1, 1), ("ammo", .12, 3, 6), ("nails", .2, 2, 4) },
            ["church"] = new[] { ("food", .35, 1, 2), ("water", .45, 1, 2), ("bandage", .45, 1, 2), ("medkit", .1, 1, 1) },
            ["gas"] = new[] { ("scrap", .75, 2, 4), ("food", .55, 1, 3), ("water", .65, 1, 3) },
            ["barn"] = new[] { ("nails", .7, 3, 8), ("scrap", .55, 1, 3), ("axe", .4, 1, 1), ("food", .2, 1, 1) },
            ["car"] = new[] { ("scrap", .85, 1, 3), ("water", .12, 1, 1), ("food", .1, 1, 1), ("ammo", .05, 2, 5) },
            ["military"] = new[] { ("ammo", .8, 5, 14), ("rifle", .35, 1, 1), ("medkit", .4, 1, 1), ("food", .45, 1, 2), ("water", .35, 1, 2), ("scrap", .3, 1, 2) },
        };

        public static readonly Dictionary<string, string[]> ITEM_NAMES = new()
        {
            ["food"] = new[] { "tin of stewed pork", "can of beans", "pack of crackers", "jar of pickled cabbage", "tin of sardines", "bag of rice" },
            ["water"] = new[] { "bottle of water", "canteen", "jug of rainwater" },
            ["nails"] = new[] { "box of nails" }, ["scrap"] = new[] { "scrap metal", "sheet of tin", "car panel" },
            ["bandage"] = new[] { "bandage roll" }, ["medkit"] = new[] { "first-aid kit" }, ["ammo"] = new[] { "7.62 rounds" },
            ["axe"] = new[] { "woodcutter's axe" }, ["rifle"] = new[] { "bolt-action rifle" },
        };

        public static readonly HashSet<string> FEMALE_NAMES = new() { "Mira", "Sasha", "Nadia", "Lena", "Katya", "Dasha", "Vera" };
        public static readonly string[] NAMES =
        {
            "Mira Volkova", "Alexei Dragan", "Sasha Koval", "Petr Ilyin", "Nadia Orlova", "Lena Marek",
            "Ivan Rusak", "Katya Belova", "Yuri Sokol", "Dasha Levin", "Oleg Brandt", "Vera Novak",
        };

        public static readonly string[] ITEMS = { "food", "water", "wood", "scrap", "nails", "ammo", "bandage", "medkit", "axe", "rifle" };
    }

    /// <summary>The scanned materials (Poly Haven, CC0) and which palette colours use them.</summary>
    public static class Catalog
    {
        public static readonly (string key, string polyhaven)[] TEXTURES =
        {
            ("plaster", "white_plaster_02"), ("brick", "red_brick_03"), ("planks", "weathered_brown_planks"),
            ("bark", "bark_brown_02"), ("metal", "green_metal_rust"), ("corrugated", "corrugated_iron_02"),
            ("roof", "roof_tiles_14"), ("concrete", "concrete_wall_008"), ("fabric", "denmin_fabric_02"),
            ("leaves", "forest_leaves_02"), ("rock", "rock_face_03"), ("mud", "brown_mud_02"),
            ("asphalt", "asphalt_02"), ("grass", "leafy_grass"), ("forest", "forest_ground_04"),
        };

        /// <summary>How far a surface moves from its palette colour towards the scan's own colour.</summary>
        public static readonly Dictionary<string, double> REAL_COLOR = new()
        {
            ["plaster"] = .3, ["brick"] = .55, ["planks"] = .4, ["bark"] = .45, ["metal"] = .15, ["corrugated"] = .3, ["roof"] = .3,
            ["concrete"] = .4, ["fabric"] = 0, ["leaves"] = 0, ["rock"] = .55, ["mud"] = .5, ["asphalt"] = .5, ["grass"] = .12, ["forest"] = .45,
        };

        static readonly Dictionary<string, int[]> PALETTE = new()
        {
            ["plaster"] = new[] { 0xc9bb97, 0xa9b6b0, 0xd2cbbb, 0xc7a988, 0xb9b08f, 0x9fa89a, 0xa49f93, 0xd8d2c0 },
            ["brick"] = new[] { 0x8a4b35 },
            ["planks"] = new[] { 0x7b6a55, 0x6a5c4d, 0x8a3b2c, 0x4d6b56, 0x262320 },
            ["bark"] = new[] { 0x4a3a2c, 0x6e6558, 0xd9d6cc },
            ["metal"] = new[] { 0x5b5c5a, 0x7a4a2c, 0x6b7c63, 0x8b9095, 0x7b2e23, 0xc8bf9f, 0x3e4d63, 0xa58d3c, 0x7a2e24, 0x5f8b78, 0x4d5238, 0x2c5a8a },
            ["corrugated"] = new[] { 0x7f8386, 0x6d4f3a, 0x5f6d5b },
            ["roof"] = new[] { 0x6d3024, 0x4b4f55, 0x5b4032 },
            ["concrete"] = new[] { 0x8f8b83 },
            ["fabric"] = new[] { 0x5d6444, 0x8a7d5c, 0xb49a52, 0x2f4f6a },
            ["leaves"] = new[] { 0x2b3f22, 0x31472a, 0x263a20, 0x5a7a2a, 0x6b8a34, 0x3a5226, 0x44602c, 0x55632d },
            ["rock"] = new[] { 0x7c7a73 },
            ["mud"] = new[] { 0x3b2c1e, 0x5c4b37 },
            ["asphalt"] = new[] { 0x3c3d3e },
        };

        static Dictionary<int, string> byColor;

        /// <summary>Material key for a palette colour, or null for plain colour (glass, chrome, water...).</summary>
        public static string MaterialOf(int color)
        {
            if (byColor == null)
            {
                byColor = new Dictionary<int, string>();
                foreach (var kv in PALETTE)
                    foreach (int c in kv.Value) byColor[c] = kv.Key;
            }
            return byColor.TryGetValue(color, out var k) ? k : null;
        }
    }
}

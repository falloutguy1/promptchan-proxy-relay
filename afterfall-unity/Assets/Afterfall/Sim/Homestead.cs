// The homestead the survivors build, one project at a time.
using System;
using System.Collections.Generic;

namespace Afterfall.Sim
{
    public sealed class Project
    {
        public string key, name, needs = "", line = "";
        public Dictionary<string, int> cost;
        public V2 at;          // base-local position
        public double minutes; // build time
        public V2 stand;       // where the builder stands
        public double yaw;
    }

    public sealed class Homestead
    {
        public const double PAL_R = 17.5;
        public readonly World world;
        public readonly Site baseSite;
        public readonly List<Project> projects;
        public readonly Dictionary<string, Project> byKey = new Dictionary<string, Project>();
        public readonly HashSet<string> built = new HashSet<string>(), paid = new HashSet<string>();
        public readonly Dictionary<string, double> progress = new Dictionary<string, double>();
        public int barrelWater = 1, gardenFood;
        public double fireFuel = 4, wallHp = 100;
        public int? breached;          // palisade segment knocked down by the infected
        public bool changed = true;    // renderer rebuilds when set

        static V2 SegStand(int seg, double gate)
        {
            double a = gate + seg * Math.PI / 2;
            return new V2(Math.Cos(a) * (PAL_R - 2.5), Math.Sin(a) * (PAL_R - 2.5));
        }

        static Project P(string key, string name, Dictionary<string, int> cost, double ax, double ay, double minutes, V2 stand,
                         double yaw = 0, string needs = "", string line = "") =>
            new Project { key = key, name = name, cost = cost, at = new V2(ax, ay), minutes = minutes, stand = stand, yaw = yaw, needs = needs, line = line };

        static Dictionary<string, int> C(params (string k, int v)[] kv)
        {
            var d = new Dictionary<string, int>();
            foreach (var (k, v) in kv) d[k] = v;
            return d;
        }

        static List<Project> MakeProjects(double g) => new List<Project>
        {
            P("fire", "Campfire", C(("wood", 2)), 0, 0, 20, new V2(1.6, 1.2), line: "Fire's going. The dark feels smaller."),
            P("leanto", "Lean-to", C(("wood", 5)), -4.5, 4, 40, new V2(-3, 2.5), -.7, line: "A roof of sorts. Better than the open sky."),
            P("barrel", "Rain collector", C(("scrap", 2)), 5, 3.5, 25, new V2(4, 2), line: "Rain barrel's up. One less trip to the pond."),
            P("garden1", "Vegetable patch", C(("wood", 3)), 7.5, -4.5, 45, new V2(5, -3), line: "Seeds from a farmhouse cellar. Let's see if they take."),
            P("crate", "Storage crate", C(("wood", 3)), -1.5, -5, 25, new V2(-.5, -3.6), line: "Somewhere to keep things that isn't my back."),
            P("found", "Cabin foundation", C(("wood", 8)), -8, -7.5, 60, new V2(-4.4, -5.5), line: "Foundation's level. Almost."),
            P("walls", "Log walls", C(("wood", 12), ("nails", 4)), -8, -7.5, 95, new V2(-4.4, -5.5), needs: "found", line: "Four walls. First time in months."),
            P("roof", "Tin roof", C(("wood", 4), ("scrap", 4)), -8, -7.5, 60, new V2(-4.4, -5.5), needs: "walls", line: "A real roof. I could cry."),
            P("pal1", "Palisade · east", C(("wood", 8)), 0, 0, 70, SegStand(1, g), line: "The east wall is up."),
            P("pal2", "Palisade · south", C(("wood", 8)), 0, 0, 70, SegStand(2, g), line: "South side closed off."),
            P("pal3", "Palisade · west", C(("wood", 8)), 0, 0, 70, SegStand(3, g), line: "West wall done. Just the gate left."),
            P("pal0", "Palisade · gate", C(("wood", 8), ("nails", 2)), 0, 0, 80, SegStand(0, g), line: "The gate closes. They can't just walk in anymore."),
            P("tower", "Watchtower", C(("wood", 10), ("nails", 4)), 11, 9, 80, new V2(9, 7), line: "From up there I can see Staroye."),
            P("garden2", "Second patch", C(("wood", 3)), 7.5, -10, 45, new V2(5, -9), line: "Two patches now. Maybe enough for two people."),
            P("gen", "Generator & floodlight", C(("scrap", 6)), 3, 9, 60, new V2(2, 7.5), line: "Light. Actual electric light."),
            P("flag", "Flag", C(("scrap", 2)), -3, 13, 30, new V2(-2, 11.5), line: "If anyone's out there, they'll see it."),
            P("radio", "Radio mast", C(("scrap", 8), ("nails", 4)), -11, 5, 120, new V2(-9, 3.5), line: "Broadcasting on 101.5. Someone has to be listening."),
        };

        public Homestead(World world)
        {
            this.world = world;
            baseSite = world.baseSite;
            projects = MakeProjects(world.gateAngle);
            foreach (var p in projects) byKey[p.key] = p;
        }

        public V2 Pos(V2 local) => new V2(baseSite.x + local.x, baseSite.y + local.y);
        public V2 Pos(double x, double y) => new V2(baseSite.x + x, baseSite.y + y);
        public V2 FirePos => Pos(0, 0);

        public Dictionary<string, int> Missing(Project p, Dictionary<string, int> inv)
        {
            var m = new Dictionary<string, int>();
            if (paid.Contains(p.key)) return m;
            foreach (var kv in p.cost)
            {
                inv.TryGetValue(kv.Key, out int have);
                if (have < kv.Value) m[kv.Key] = kv.Value - have;
            }
            return m;
        }

        public bool CanAfford(Project p, Dictionary<string, int> inv) => Missing(p, inv).Count == 0;

        public void Pay(Project p, Dictionary<string, int> inv)
        {
            if (!paid.Add(p.key)) return;
            foreach (var kv in p.cost) inv[kv.Key] -= kv.Value;
        }

        public bool[] PalisadeBuilt() => new[] { built.Contains("pal0"), built.Contains("pal1"), built.Contains("pal2"), built.Contains("pal3") };

        public void Finish(Project p)
        {
            built.Add(p.key);
            progress.Remove(p.key);
            changed = true;
            if (p.key.StartsWith("pal")) world.SetPalisade(PalisadeBuilt());
            var sizes = new Dictionary<string, (double, double)> { ["tower"] = (3, 3), ["crate"] = (1.4, .9), ["gen"] = (1.3, .9), ["radio"] = (1.2, 1.2), ["barrel"] = (1, 1) };
            if (sizes.TryGetValue(p.key, out var sz))
            {
                var at = Pos(p.at);
                world.AddDynamicObstacle(at.x, at.y, sz.Item1, sz.Item2, 0);
            }
        }

        public bool WallsBuilt => built.Contains("pal0") && built.Contains("pal1") && built.Contains("pal2") && built.Contains("pal3");
        public bool WallsClosed => WallsBuilt && breached == null;
        public V2 Bed() => built.Contains("roof") ? Pos(-8, -7.5) : Pos(-4.2, 3.8);
        public bool Inside(double x, double y, double margin = 1) => M.Hypot(x - baseSite.x, y - baseSite.y) < PAL_R - margin;

        public void Hourly(int hourIndex, bool raining)
        {
            if (built.Contains("barrel") && (raining || hourIndex % 24 == 6)) barrelWater = Math.Min(4, barrelWater + 1);
            int gardens = (built.Contains("garden1") ? 1 : 0) + (built.Contains("garden2") ? 1 : 0);
            if (gardens > 0 && hourIndex % 10 == 0) gardenFood = Math.Min(6, gardenFood + gardens);
        }

        // --- geometry for the renderer ---

        /// <summary>Parts for one project, positioned in the world.</summary>
        public List<Part> BuildParts(string key)
        {
            var p = byKey[key];
            var sink = new List<Part>();
            var w = world;
            if (key.StartsWith("pal"))
            {
                PalisadeParts(sink, key[3] - '0');
                return sink;
            }
            var at = Pos(p.at);
            var k = new Kit(w, at.x, at.y, p.yaw, w.GroundZ(at.x, at.y), sink: sink);
            switch (key)
            {
                case "fire": PartsFire(k); break;
                case "leanto": PartsLeanto(k); break;
                case "barrel": PartsBarrel(k); break;
                case "garden1": case "garden2": PartsGarden(k); break;
                case "crate": PartsCrate(k); break;
                case "found": PartsFound(k); break;
                case "walls": PartsWalls(k); break;
                case "roof": PartsRoof(k); break;
                case "tower": Builders.Watchtower(k, Pal.BARK, Pal.PLANKS[0]); break;
                case "gen": PartsGen(k); break;
                case "flag": k.Cyl(.12, 7, 0, 0, 3.5, Pal.METAL); break;
                case "radio": PartsRadio(k); break;
            }
            return sink;
        }

        void PalisadeParts(List<Part> sink, int seg)
        {
            var w = world;
            var b = baseSite;
            double a0 = w.gateAngle + seg * Math.PI / 2 - Math.PI / 4;
            int n = (int)(PAL_R * Math.PI / 2 / .36);
            for (int i = 0; i <= n; i++)
            {
                double a = a0 + (Math.PI / 2) * i / n;
                double rel = M.WrapPi(a - w.gateAngle);
                if (seg == 0 && Math.Abs(rel) < .2) continue;
                double x = b.x + Math.Cos(a) * PAL_R, y = b.y + Math.Sin(a) * PAL_R;
                var k = new Kit(w, x, y, a, w.GroundZ(x, y) - .3, sink: sink);
                k.Cyl(.34, 3.2, 0, 0, 1.6, i % 3 != 0 ? Pal.BARK : Pal.DEADWOOD);
                k.Cone(.34, .5, 0, 0, 3.45, Pal.DEADWOOD);
            }
            foreach (double z in new[] { .9, 2.3 })
                for (int i = 0; i < n; i += 6)
                {
                    double aa = a0 + (Math.PI / 2) * i / n, ab = a0 + (Math.PI / 2) * Math.Min(n, i + 6) / n;
                    double xa = b.x + Math.Cos(aa) * (PAL_R - .25), ya = b.y + Math.Sin(aa) * (PAL_R - .25);
                    double xb = b.x + Math.Cos(ab) * (PAL_R - .25), yb = b.y + Math.Sin(ab) * (PAL_R - .25);
                    double mx = (xa + xb) / 2, my = (ya + yb) / 2;
                    var k = new Kit(w, mx, my, Math.Atan2(yb - ya, xb - xa), w.GroundZ(mx, my), sink: sink);
                    k.Box(M.Hypot(xb - xa, yb - ya), .12, .12, 0, 0, z, Pal.BARK);
                }
            if (seg == 0)
            {
                foreach (int s in new[] { -1, 1 })
                {
                    double a = w.gateAngle + s * .22;
                    double x = b.x + Math.Cos(a) * PAL_R, y = b.y + Math.Sin(a) * PAL_R;
                    new Kit(w, x, y, 0, w.GroundZ(x, y), sink: sink).Cyl(.44, 4.2, 0, 0, 1.8, Pal.BARK);
                }
                double gx = b.x + Math.Cos(w.gateAngle) * PAL_R, gy = b.y + Math.Sin(w.gateAngle) * PAL_R;
                var g = new Kit(w, gx, gy, w.gateAngle + Math.PI / 2, w.GroundZ(gx, gy), sink: sink);
                g.Box(PAL_R * .44 + .4, .3, .3, 0, 0, 3.7, Pal.BARK);
                g.Box(2.6, .12, 2.6, 1.0, -1.1, 1.4, Pal.PLANKS[1], -60);
            }
        }

        static void PartsFire(Kit k)
        {
            for (int i = 0; i < 9; i++)
            {
                double a = i / 9.0 * M.TAU;
                k.Sph(.32, .32, .24, Math.Cos(a) * .6, Math.Sin(a) * .6, .08, Pal.ROCK);
            }
            for (int i = 0; i < 4; i++)
            {
                double a = i * 90;
                k.Cyl(.13, .9, Math.Cos(M.Rad(a)) * .12, Math.Sin(M.Rad(a)) * .12, .18, Pal.BARK, a, 0, 65);
            }
            k.Box(1.1, 1.1, .02, 0, 0, .02, Pal.BURNT);
            foreach (var (x, y, r) in new[] { (2.2, 0.0, 90.0), (-1.2, 1.9, 150), (-1.1, -2.0, 30) }) k.Cyl(.42, 1.8, x, y, .2, Pal.BARK, r, 90, 0);
        }

        static void PartsLeanto(Kit k)
        {
            foreach (double y in new[] { -1.3, 1.3 })
            {
                k.Cyl(.13, 2.4, .55, y, 1.05, Pal.BARK, 0, -28, 0);
                k.Cyl(.13, 2.4, -.55, y, 1.05, Pal.BARK, 0, 28, 0);
            }
            k.Cyl(.14, 3.0, 0, 0, 2.05, Pal.BARK, 0, 0, 90);
            k.Box(2.5, 3.1, .05, -.62, 0, 1.1, Pal.TARP, 0, 50, 0);
            k.Cyl(.56, 1.8, -.3, 0, .12, Pal.TARP, 0, 0, 90);
        }

        static void PartsBarrel(Kit k)
        {
            k.Cyl(.84, 1.1, 0, 0, .55, Pal.BLUE);
            k.Cone(1.8, .5, 0, 0, 1.35, Pal.TARP, 0, 180, 0);
            foreach (var (x, y) in new[] { (-.64, -.64), (.64, -.64), (-.64, .64), (.64, .64) }) k.Cyl(.06, 1.7, x, y, .85, Pal.BARK);
        }

        static void PartsGarden(Kit k)
        {
            k.Box(4.2, 3.2, .25, 0, 0, .1, Pal.SOIL);
            foreach (int s in new[] { -1, 1 })
            {
                k.Box(4.4, .12, .3, 0, s * 1.65, .12, Pal.PLANKS[0]);
                k.Box(.12, 3.4, .3, s * 2.15, 0, .12, Pal.PLANKS[0]);
            }
        }

        static void PartsCrate(Kit k)
        {
            k.Box(1.3, .8, .8, 0, 0, .4, Pal.PLANKS[1]);
            k.Box(1.35, .85, .08, 0, -.05, .84, Pal.PLANKS[0], 0, 0, -7);
            k.Box(.9, .6, .5, 1.2, .2, .25, Pal.PLANKS[0]);
            k.Cyl(.5, .7, -1.1, .1, .35, Pal.OLIVE);
        }

        static void PartsFound(Kit k)
        {
            foreach (var (x, y) in new[] { (-2.8, -2.3), (2.8, -2.3), (-2.8, 2.3), (2.8, 2.3), (0, -2.3), (0, 2.3) }) k.Box(.45, .45, .7, x, y, .1, Pal.CONCRETE);
            k.Box(6.2, 5.2, .22, 0, 0, .52, Pal.PLANKS[0]);
        }

        static void PartsWalls(Kit k)
        {
            double lw = 6, ld = 5;
            for (int i = 0; i < 9; i++)
            {
                double z = .78 + i * .26;
                foreach (int s in new[] { -1, 1 }) k.Cyl(.28, lw + .5, 0, s * ld / 2, z, Pal.BARK, 0, 90, 0);
                foreach (int s in new[] { -1, 1 })
                {
                    if (s == 1 && i < 8)
                    {
                        foreach (double yy in new[] { -1.55, 1.55 }) k.Cyl(.28, 1.6, s * lw / 2, yy, z, Pal.BARK, 0, 0, 90);
                        continue;
                    }
                    if (s == -1 && i >= 3 && i <= 5)
                    {
                        foreach (double yy in new[] { -1.6, 1.6 }) k.Cyl(.28, 1.5, s * lw / 2, yy, z, Pal.BARK, 0, 0, 90);
                        continue;
                    }
                    k.Cyl(.28, ld + .5, s * lw / 2, 0, z, Pal.BARK, 0, 0, 90);
                }
            }
            k.Box(.08, 1.2, 2.1, 3.02, 0, 1.7, Pal.PLANKS[1], 12);
        }

        static void PartsRoof(Kit k)
        {
            double top = .78 + 9 * .26;
            Builders.Roof(k, 5.6, 6.8, top, true, Pal.CORR[0], Pal.PLANKS[0]);
            k.Cyl(.26, 1.4, 1.5, -1, top + 1.8, Pal.METAL);
        }

        static void PartsGen(Kit k)
        {
            k.Box(1.1, .7, .7, 0, 0, .45, 0xb8952e);
            k.Box(.9, .5, .3, 0, 0, .95, Pal.METAL);
            k.Box(1.3, .9, .1, 0, 0, .08, Pal.PLANKS[0]);
            k.Cyl(.36, .45, -.9, .2, .22, Pal.RED);
            k.Cyl(.16, 6, 1.6, 0, 3, Pal.BARK);
            k.Box(.35, .5, .3, 1.6, .2, 6, Pal.METAL);
            k.Box(.02, .4, .26, 1.78, .2, 6, 0xfff2cf);
        }

        static void PartsRadio(Kit k)
        {
            double h = 15;
            for (int i = 0; i < 3; i++)
            {
                double a = i / 3.0 * M.TAU;
                k.Cyl(.09, h, Math.Cos(a) * .5, Math.Sin(a) * .5, h / 2, Pal.METAL);
            }
            for (int z = 1; z < (int)h; z += 2)
                for (int i = 0; i < 3; i++)
                {
                    double a = i / 3.0 * M.TAU, b = (i + 1) / 3.0 * M.TAU;
                    double x0 = Math.Cos(a) * .5, y0 = Math.Sin(a) * .5, x1 = Math.Cos(b) * .5, y1 = Math.Sin(b) * .5;
                    k.Box(M.Hypot(x1 - x0, y1 - y0), .04, .04, (x0 + x1) / 2, (y0 + y1) / 2, z, Pal.METAL, M.Deg(Math.Atan2(y1 - y0, x1 - x0)));
                }
            k.Sph(1.2, 1.2, .4, .4, .4, h * .7, Pal.CHROME, 45, -60, 0);
            k.Box(1.4, 1, 1.2, 1.4, 1.2, .6, Pal.OLIVE);
        }
    }
}

// The simulation: time, weather, noise, combat, and the succession of survivors.
// It has no rendering dependencies, so it runs headless (see SimTests/).
using System;
using System.Collections.Generic;
using System.Linq;
using static Afterfall.Sim.Config;

namespace Afterfall.Sim
{
    public sealed class NoiseEvent
    {
        public double x, y, radius, ttl;
        public string source;
        public int zid = -1;
    }

    public struct LogEntry { public string stamp, text, kind; }
    public struct Floater { public double x, y, delay; public string text, kind; }
    public struct Sound { public string kind; public double x, y; }
    /// <summary>Visual effects for the renderer: "shot" (x,y -> x2,y2, hit), "blood" (x,y), "fell" (tree index, angle).</summary>
    public struct Fx { public string kind; public double x, y, x2, y2, angle; public bool hit; public int tree; }

    public sealed class Simulation
    {
        static readonly Dictionary<string, (double rain, double cloud, double fog, string label)> WEATHER = new Dictionary<string, (double, double, double, string)>
        {
            ["clear"] = (0, .15, 0, "Clear"),
            ["overcast"] = (0, .75, .15, "Overcast"),
            ["rain"] = (1, .95, .35, "Rain"),
            ["storm"] = (1, 1, .5, "Heavy rain"),
            ["fog"] = (0, .5, 1, "Fog"),
        };

        public readonly long seed;
        public readonly Rng rng;
        public readonly World world;
        public readonly Homestead home;
        public double minutes = 7 * 60 + 5;
        public readonly List<LogEntry> events = new List<LogEntry>();
        public readonly List<Floater> floaters = new List<Floater>();
        public readonly List<Fx> fx = new List<Fx>();
        public readonly List<Sound> sounds = new List<Sound>();
        public List<NoiseEvent> noises = new List<NoiseEvent>();
        public readonly List<(double x, double y, string name)> graves = new List<(double, double, string)>();
        public int generation = 1;
        public string weather = "fog";
        double weatherNext = 180;
        public double rain, cloud = .5, fogAmount = 1, temp = 10;
        public int pathBudget = 2;
        int hourIndex;
        double deadT;
        public Survivor survivor;
        public readonly List<Zombie> zombies = new List<Zombie>();
        public readonly Dictionary<int, Zombie> zombieById = new Dictionary<int, Zombie>();

        public Simulation(long? seed = null, int zombieCount = 28)
        {
            this.seed = seed ?? new Random().Next(1 << 30);
            rng = new Rng(this.seed);
            world = new World(this.seed);
            home = new Homestead(world);
            hourIndex = (int)(minutes / 60);
            foreach (var key in new[] { "fire", "leanto" }) home.Finish(home.byKey[key]);
            string name = rng.Choice(NAMES);
            var start = home.Pos(-2, -2);
            survivor = new Survivor(this, name, start.x, start.y);
            survivor.Say("Another morning. The fire held through the night.");
            Log($"{name} wakes at the homestead site east of Staroye.", "good");
            for (int i = 0; i < zombieCount; i++) zombies.Add(new Zombie(this, i));
            foreach (var z in zombies)
            {
                z.Spawn(new V2(survivor.x, survivor.y));
                zombieById[z.id] = z;
            }
        }

        // ------------------------------------------------------------------ time

        public int Day => (int)(minutes / 1440) + 1;
        public double Hour => minutes / 60 % 24;
        public string Clock() => $"{(int)Hour:00}:{(int)(minutes % 60):00}";
        public string Stamp() => $"D{Day} {Clock()}";
        public string WeatherLabel => WEATHER[weather].label;

        public void Step(double dt)
        {
            minutes += dt;
            pathBudget = 2;
            Weather(dt);
            int hi = (int)(minutes / 60);
            if (hi != hourIndex)
            {
                hourIndex = hi;
                Hourly(hi);
            }
            if (home.fireFuel > 0) home.fireFuel = Math.Max(0, home.fireFuel - dt / 60 * .6);
            foreach (var n in noises) n.ttl -= dt;
            noises = noises.Where(n => n.ttl > 0).ToList();
            foreach (var z in zombies) z.Update(dt);
            Separate();
            var s = survivor;
            if (s.alive) s.Update(dt);
            else
            {
                deadT += dt;
                if (deadT > 14) Succession();
            }
        }

        void Weather(double dt)
        {
            weatherNext -= dt;
            if (weatherNext <= 0)
            {
                weatherNext = rng.Uniform(160, 420);
                double r = rng.Random();
                weather = r < .4 ? "clear" : r < .62 ? "overcast" : r < .85 ? "rain" : r < .93 ? "storm" : "fog";
                if (weather == "rain" || weather == "storm") Log(weather == "storm" ? "A storm rolls in from the west." : "It starts to rain.");
            }
            var w = WEATHER[weather];
            double k = Math.Min(1, dt * .02);
            rain += (w.rain - rain) * k;
            cloud += (w.cloud - cloud) * k;
            fogAmount += (w.fog - fogAmount) * k;
            temp = 11 + 7 * Math.Sin((Hour - 9) / 24 * M.TAU) - rain * 4 - cloud * 1.5;
        }

        void Hourly(int hi)
        {
            home.Hourly(hi, rain > .5);
            foreach (var site in world.loot)
                if (site.looted && minutes > site.restockAt) site.looted = false;
            if (hi % 24 == 0 && survivor.alive)
                Log($"Day {Day} begins. {survivor.firstName} has been out here {Math.Round((minutes - survivor.born) / 1440)} days.");
            if (home.WallsClosed && home.wallHp <= 0)
            {
                int seg = rng.RandInt(1, 3);
                home.breached = seg;
                var segs = home.PalisadeBuilt();
                segs[seg] = false;
                world.SetPalisade(segs);
                home.wallHp = 30;
                home.changed = true;
                Log(new[] { "", "The east wall", "The south wall", "The west wall" }[seg] + " gave way under the weight of them!", "bad");
            }
        }

        void Separate()
        {
            var live = zombies.Where(z => z.alive).ToList();
            for (int i = 0; i < live.Count; i++)
                for (int j = i + 1; j < live.Count; j++)
                {
                    Zombie a = live[i], b = live[j];
                    double dx = b.x - a.x, dy = b.y - a.y, d = M.Hypot(dx, dy);
                    if (d > 1e-4 && d < .7)
                    {
                        double k = (.7 - d) / 2;
                        a.x -= dx / d * k; a.y -= dy / d * k;
                        b.x += dx / d * k; b.y += dy / d * k;
                    }
                }
        }

        // ------------------------------------------------------------------ succession

        void Succession()
        {
            var old = survivor;
            graves.Add((old.x, old.y, old.name));
            generation++;
            string name = rng.Choice(NAMES.Where(n => n != old.name).ToList());
            double x = rng.Uniform(-60, 70), y = -HALF + 95;
            var s = new Survivor(this, name, x, y, old);
            var p = world.Resolve(x, y);
            s.x = p.x; s.y = p.y;
            s.Say("Found a journal on a body by the road. Someone was building a home to the north-east.");
            survivor = s;
            deadT = 0;
            Log($"Generation {generation}: {name} finds {old.firstName}'s journal and heads for the homestead.", "good");
        }

        // ------------------------------------------------------------------ interactions

        public void Noise(double x, double y, double radius, string source, int zid = -1)
        {
            noises.Add(new NoiseEvent { x = x, y = y, radius = radius, source = source, zid = zid, ttl = 1 });
            if (source == "zombie") Sfx("groan", x, y);
        }

        public void Shoot(Survivor s, Zombie z)
        {
            s.inv["ammo"]--;
            double d = M.Hypot(z.x - s.x, z.y - s.y);
            bool hit = rng.Random() < Math.Max(.3, Math.Min(.95, 1.08 - d / 55 - s.stress / 250));
            fx.Add(new Fx { kind = "shot", x = s.x, y = s.y, x2 = z.x, y2 = z.y, hit = hit });
            Sfx("shot", s.x, s.y);
            Noise(s.x, s.y, 120, "gunshot");
            if (hit)
            {
                z.Hit(100);
                Killed(s, z, "rifle");
            }
            else FloatText(z.x, z.y, "Miss", "bad");
        }

        public void Melee(Survivor s, Zombie z)
        {
            double dmg = s.inv["axe"] > 0 ? rng.Uniform(32, 55) : rng.Uniform(10, 18);
            z.Hit(dmg);
            Sfx("hit", z.x, z.y);
            double d = M.Hypot(z.x - s.x, z.y - s.y);
            if (d == 0) d = 1;
            z.x += (z.x - s.x) / d * .5;
            z.y += (z.y - s.y) / d * .5;
            if (!z.alive) Killed(s, z, s.inv["axe"] > 0 ? "axe" : "fists");
        }

        void Killed(Survivor s, Zombie z, string how)
        {
            if (z.alive) return;
            s.kills++;
            s.memory.dayLog.kills++;
            s.memory.threats.Remove(z.id);
            s.stress = Math.Max(0, s.stress - 6);
            fx.Add(new Fx { kind = "blood", x = z.x, y = z.y });
            Sfx("thud", z.x, z.y);
            if (s.kills == 1 || rng.Random() < .35)
            {
                var place = world.SiteAt(z.x, z.y);
                string where = place != null ? place.name : "the treeline";
                Log(how == "rifle" ? $"Dropped an infected with one shot near {where}." :
                    how == "axe" ? $"Put down an infected with the axe near {where}." :
                    "Beat an infected to death barehanded. Knuckles split.", "bad");
            }
        }

        public void OnTreeFelled(Tree tree, Survivor s)
        {
            fx.Add(new Fx { kind = "fell", tree = tree.idx, angle = Math.Atan2(tree.y - s.y, tree.x - s.x) });
            if (rng.Random() < .35)
                Log($"Felled {M.An(tree.kind == "pine" ? "pine" : tree.kind == "birch" ? "birch" : "dead tree")} near the homestead.");
        }

        public int ZombiesNear(double x, double y, double r) => zombies.Count(z => z.alive && M.Hypot(z.x - x, z.y - y) < r);

        // ------------------------------------------------------------------ output for the renderer

        public void Log(string text, string kind = "")
        {
            events.Add(new LogEntry { stamp = Stamp(), text = text, kind = kind });
            if (events.Count > 200) events.RemoveRange(0, events.Count - 200);
        }

        public void FloatText(Survivor s, string text, string kind = "", double delay = 0) => FloatText(s.x, s.y, text, kind, delay);
        public void FloatText(double x, double y, string text, string kind = "", double delay = 0) =>
            floaters.Add(new Floater { x = x, y = y, text = text, kind = kind, delay = delay });

        public void Sfx(string kind, double x, double y)
        {
            sounds.Add(new Sound { kind = kind, x = x, y = y });
            if (sounds.Count > 50) sounds.RemoveRange(0, sounds.Count - 50);
        }
    }
}

// The survivor's mind.
//
// Decision making is utility based: every candidate action gets a 0..1 score built from considerations
// (needs, personality, memory, time of day, remembered danger). The best action wins, with a little
// momentum so the survivor doesn't dither. Each action is a coroutine that yields simple instructions
// (walk somewhere, perform an animation for N minutes, close in on a target); the result of the last
// instruction is readable through LastOk, which keeps multi-step behaviour readable and lets any action
// be interrupted cleanly.
using System;
using System.Collections.Generic;
using System.Linq;
using static Afterfall.Sim.Config;

namespace Afterfall.Sim
{
    public enum InstrKind { Move, Do, Until, Approach }

    public sealed class Instr
    {
        public InstrKind kind;
        public double tx, ty, arrive, dur, reach;
        public Pace pace;
        public string anim;
        public Func<V2> face;
        public Func<bool> pred;
        public Zombie target;

        public static Instr Move(double x, double y, Pace pace, double arrive) => new Instr { kind = InstrKind.Move, tx = x, ty = y, pace = pace, arrive = arrive };
        public static Instr Do(string anim, double dur, V2? face = null) =>
            new Instr { kind = InstrKind.Do, anim = anim, dur = dur, face = face.HasValue ? (Func<V2>)(() => face.Value) : null };
        public static Instr Do(string anim, double dur, Func<V2> face) => new Instr { kind = InstrKind.Do, anim = anim, dur = dur, face = face };
        public static Instr Until(string anim, Func<bool> pred) => new Instr { kind = InstrKind.Until, anim = anim, pred = pred };
        public static Instr Approach(Zombie z, double reach) => new Instr { kind = InstrKind.Approach, target = z, reach = reach };
    }

    public sealed class Candidate
    {
        public string key, name, detail;
        public double score;
        public Func<IEnumerable<Instr>> make;
    }

    public sealed class Active
    {
        public string key, name, detail;
        public IEnumerator<Instr> gen;
        public Instr instr;
        public bool started, done;
        public double t;
        public double? progress;
    }

    public sealed class Survivor
    {
        public const double RADIUS = .4;
        readonly Simulation sim;
        readonly World world;
        readonly Homestead home;
        public readonly string name, firstName;
        public readonly Dictionary<string, double> traits;
        public double x, y, heading;
        public double health = 100, food = 70, water = 64, energy = 86, warmth = 70, morale = 62, stress = 10;
        public bool bleeding;
        public readonly Dictionary<string, int> inv = new Dictionary<string, int>();
        public readonly Memory memory;
        public string anim = "idle";
        public Pace pace = Pace.Walk;
        public double speed;
        public Active action;
        public List<(string name, double score, string detail)> scores = new List<(string, double, string)>();
        public string thought = "";
        public bool alive = true;
        public string cause = "";
        public readonly double born;
        public int kills, loots, lootsSinceAxe;
        List<V2> path = new List<V2>();
        V2? pathGoal;
        double stuckT, thinkT, senseT, workNoiseT;
        V2 stuckRef;
        int fails;
        public double hurtT, lastHitT = -1e9, fightLockT;
        bool lastOk = true;
        (double t, Tree tree)? treeCache;

        public Survivor(Simulation sim, string name, double x, double y, Survivor predecessor = null)
        {
            var rng = sim.rng;
            this.sim = sim;
            world = sim.world;
            home = sim.home;
            this.name = name;
            firstName = name.Split(' ')[0];
            traits = new Dictionary<string, double>
            {
                ["bravery"] = rng.Uniform(.2, .9), ["caution"] = rng.Uniform(.2, .9), ["diligence"] = rng.Uniform(.3, 1.0),
                ["curiosity"] = rng.Uniform(.2, .9), ["resilience"] = rng.Uniform(.2, .9),
            };
            this.x = x; this.y = y;
            foreach (var k in ITEMS) inv[k] = 0;
            inv["food"] = 1; inv["water"] = 1; inv["bandage"] = 1;
            memory = new Memory(world.loot.Count);
            for (int i = 0; i < world.loot.Count; i++)
                if (M.Hypot(world.loot[i].x - home.baseSite.x, world.loot[i].y - home.baseSite.y) < 150) memory.places[i].known = true;
            if (predecessor != null)
            {
                memory.InheritFrom(predecessor.memory);
                food = 50; water = 45; energy = 70; warmth = 45; morale = 45;
            }
            born = sim.minutes;
            stuckRef = new V2(x, y);
        }

        // ------------------------------------------------------------------ helpers

        double T(string k) => traits[k];
        public double Dist(double px, double py) => M.Hypot(px - x, py - y);
        public void Say(string text) => thought = text;
        void Log(string text, string kind = "") => sim.Log(text, kind);
        public bool Armed => inv["axe"] > 0 || (inv["rifle"] > 0 && inv["ammo"] > 0);
        double WeaponPower() => inv["rifle"] > 0 && inv["ammo"] > 0 ? 1.2 : inv["axe"] > 0 ? .85 : .35;
        public double Daylight() { double h = sim.Hour; return M.Clamp01(Math.Min((h - 5.2) / 1.5, (20.8 - h) / 1.5)); }
        bool AtBase() => home.Inside(x, y, 1.0);
        string Pick(params string[] options) => sim.rng.Choice(options);

        // ------------------------------------------------------------------ tick

        public void Update(double dt)
        {
            if (!alive) return;
            Needs(dt);
            if (!alive) return;
            senseT -= dt;
            if (senseT <= 0)
            {
                senseT = .25;
                if (Perceive()) thinkT = 0;
            }
            memory.Decay(dt);
            memory.ForgetOld(sim.minutes);
            thinkT -= dt;
            if (action == null || action.done || thinkT <= 0)
            {
                thinkT = 1;
                Decide();
            }
            if (action != null) Run(dt);
            hurtT = Math.Max(0, hurtT - dt);
            fightLockT = Math.Max(0, fightLockT - dt);
        }

        // ------------------------------------------------------------------ body

        void Needs(double dt)
        {
            bool sleeping = anim == "sleep";
            double exert = anim switch { "run" => 1.6, "chop" => 1.4, "build" => 1.3, "melee" => 1.5, "jog" => 1.2, _ => 1.0 };
            food = Math.Max(0, food - dt * 100 / (30 * 60) * (exert > 1 ? 1.3 : 1));
            water = Math.Max(0, water - dt * 100 / (20 * 60) * (exert > 1 ? 1.4 : 1) * (sim.temp > 18 ? 1.2 : 1));
            if (sleeping) energy = Math.Min(100, energy + dt * 100 / (6.5 * 60) * (stress > 60 ? .6 : 1));
            else energy = Math.Max(0, energy - dt * 100 / (19 * 60) * exert);
            var fp = home.FirePos;
            bool nearFire = home.built.Contains("fire") && home.fireFuel > 0 && Dist(fp.x, fp.y) < 6;
            var cabin = home.Pos(-8, -7.5);
            bool inCabin = home.built.Contains("roof") && Dist(cabin.x, cabin.y) < 3.5;
            double envT = sim.temp + (nearFire ? 16 : 0) + (inCabin ? 12 : 0) + (sleeping && home.built.Contains("leanto") ? 5 : 0);
            double target = M.Clamp(40 + envT * 3.2 - sim.rain * (inCabin ? 0 : 25), 0, 100);
            warmth += (target - warmth) * (1 - Math.Exp(-dt / 90));

            double dmg = 0;
            if (food <= 0) dmg += .05;
            if (water <= 0) dmg += .1;
            if (warmth < 18) dmg += .035;
            if (bleeding) dmg += .12;
            health -= dmg * dt;
            if (food > 45 && water > 45 && !bleeding && warmth > 30) health = Math.Min(100, health + dt * (sleeping ? .06 : .02));

            // stress rises with known threats and falls when safe; morale drifts with comfort
            bool threatened = memory.threats.Values.Any(t => t.aware);
            double calm = AtBase() && home.WallsClosed ? .9 : .45;
            stress = M.Clamp(stress + dt * (threatened ? 1.5 : -calm), 0, 100);
            int comfort = (food > 40 ? 1 : 0) + (water > 40 ? 1 : 0) + (warmth > 40 ? 1 : 0) + (energy > 30 ? 1 : 0) - (sim.rain > .5 ? 1 : 0) - (health < 40 ? 1 : 0);
            double drift = (comfort - 2.2) * .004 + (T("resilience") - .5) * .004;
            morale = M.Clamp(morale + drift * dt, 0, 100);

            if (health <= 0) Die(bleeding ? "bled out" : water <= 0 ? "dehydration" : food <= 0 ? "starvation" : "exposure");
        }

        public void TakeHit(double dmg, Zombie z)
        {
            if (!alive) return;
            health -= dmg;
            hurtT = .6;
            stress = Math.Min(100, stress + 18);
            lastHitT = sim.minutes;
            memory.See(z.id, z.x, z.y, sim.minutes, true);
            memory.AddDanger(x, y, 1.2, 20);
            thinkT = 0;
            if (!bleeding && sim.rng.Random() < .18)
            {
                bleeding = true;
                Log("Clawed across the arm. Bleeding.", "bad");
            }
            if (health < 30)
            {
                var place = world.SiteAt(x, y);
                memory.dayLog.closeCalls++;
                memory.Remember(sim.minutes, "nearly died", place != null ? place.name : "the woods", 2);
                for (int i = 0; i < world.loot.Count; i++)
                    if (M.Hypot(world.loot[i].x - x, world.loot[i].y - y) < 60) memory.places[i].scare = 1;
            }
            if (health <= 0) Die("the infected");
        }

        public void Die(string why)
        {
            if (!alive) return;
            alive = false;
            cause = why;
            health = 0;
            anim = "dead";
            action = null;
            double days = (sim.minutes - born) / 1440;
            Log($"{name} is dead: {why}. Survived {days:0.0} days, {kills} infected put down.", "bad");
            Say("...");
        }

        // ------------------------------------------------------------------ senses

        /// <summary>Sight (range, field of view, walls) and hearing. Returns true if something important changed.</summary>
        bool Perceive()
        {
            double t = sim.minutes;
            bool sleeping = anim == "sleep";
            double night = 1 - Daylight();
            double sight = (40 - 22 * night) * (1 - .35 * sim.fogAmount) * (sleeping ? .3 : 1);
            double fx = Math.Cos(heading), fy = Math.Sin(heading);
            bool changed = false;
            bool safeInside = home.WallsClosed && AtBase();
            foreach (var z in sim.zombies)
            {
                if (!z.alive) continue;
                double d = Dist(z.x, z.y);
                if (d > sight + 5) continue;
                if (safeInside && !home.Inside(z.x, z.y, -1))
                {
                    // watching them through the palisade gaps is enough; they can't get in
                    if (d < 25) memory.See(z.id, z.x, z.y, t, false);
                    continue;
                }
                double dx = (z.x - x) / Math.Max(d, 1e-3), dy = (z.y - y) / Math.Max(d, 1e-3);
                bool inView = d < 6 || dx * fx + dy * fy > -.2;
                if (d < sight && inView && world.SightClear(x, y, z.x, z.y))
                {
                    bool aware = z.TargetIsSurvivor;
                    memory.threats.TryGetValue(z.id, out var old);
                    if (old == null || old.aware != aware || old.heardOnly)
                    {
                        changed = true;
                        if (old == null && d < 25) stress = Math.Min(100, stress + (aware ? 8 : 3));
                    }
                    memory.See(z.id, z.x, z.y, t, aware);
                    memory.AddDanger(z.x, z.y, .04, 12);
                }
            }
            foreach (var n in sim.noises)
                if (n.source == "zombie" && Dist(n.x, n.y) < n.radius * .8 && n.zid >= 0 && !memory.threats.ContainsKey(n.zid))
                    memory.Hear(n.zid, n.x + sim.rng.Uniform(-6, 6), n.y + sim.rng.Uniform(-6, 6), t);
            // discover places in view
            for (int i = 0; i < world.loot.Count; i++)
            {
                var s = world.loot[i];
                var p = memory.places[i];
                if (!p.known && Dist(s.x, s.y) < 38 && !sleeping)
                {
                    p.known = true;
                    if (sim.rng.Random() < .3) Say($"There's {M.An(s.label)} {s.where}. I haven't been through it.");
                }
            }
            return changed;
        }

        // ------------------------------------------------------------------ deciding

        public (List<(double d, Zombie z, Threat th)> aware, List<(double d, Zombie z, Threat th)> unaware) ThreatSummary()
        {
            var aware = new List<(double, Zombie, Threat)>();
            var unaware = new List<(double, Zombie, Threat)>();
            foreach (var th in memory.threats.Values)
            {
                if (!sim.zombieById.TryGetValue(th.zid, out var z) || !z.alive) continue;
                if (home.WallsClosed && AtBase() && !home.Inside(z.x, z.y, -1)) continue;
                double d = Dist(th.x, th.y);
                if (th.aware && d < 35) aware.Add((d, z, th));
                else if (!th.heardOnly && d < 22) unaware.Add((d, z, th));
            }
            aware.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            unaware.Sort((a, b) => a.Item1.CompareTo(b.Item1));
            return (aware, unaware);
        }

        void Decide()
        {
            var cands = Candidates().Where(c => c.score > 0).OrderByDescending(c => c.score).ToList();
            scores = cands.Take(7).Select(c => (c.name, c.score, c.detail)).ToList();
            if (cands.Count == 0) return;
            var best = cands[0];
            var cur = action;
            if (cur != null && !cur.done)
            {
                double curScore = cands.FirstOrDefault(c => c.key == cur.key)?.score ?? 0;
                if (best.key == cur.key || best.score < curScore * 1.15 + .04) return;
            }
            action = new Active { key = best.key, name = best.name, detail = best.detail, gen = best.make().GetEnumerator() };
        }

        static Candidate Cand(string key, string name, double score, string detail, Func<IEnumerable<Instr>> make) =>
            new Candidate { key = key, name = name, score = score, detail = detail, make = make };

        List<Candidate> Candidates()
        {
            double hour = sim.Hour, day = Daylight();
            bool night = hour >= 21 || hour < 5.3;
            double thirst = M.Rising(100 - water, 30, 90, 1.5);
            double hunger = M.Rising(100 - food, 35, 92, 1.5);
            double tired = M.Rising(100 - energy, 35, 95, 1.3);
            double cold = M.Rising(100 - warmth, 45, 90);
            double hurt = M.Rising(100 - health, 30, 80);
            double urgent = Math.Max(thirst, Math.Max(hunger, tired));
            double drive = (.6 + .4 * T("diligence")) * (.7 + .3 * morale / 100) * (1 - urgent * .8);
            var output = new List<Candidate>();

            // --- threats first: everything else is scored against them ---
            var (aware, unaware) = ThreatSummary();
            if (aware.Count > 0)
            {
                double threat = aware.Sum(a => (1.2 - a.d / 35) * (a.z.runner ? 1.3 : 1));
                double cap = WeaponPower() * Math.Sqrt(Math.Max(health, 1) / 100) * (1 - stress / 250) + T("bravery") * .35;
                int n = aware.Count;
                double nearest = aware[0].d;
                var nz = aware[0].z;
                // running is pointless if they keep landing blows or my legs are gone: then stand and fight
                bool futile = sim.minutes - lastHitT < 8 || energy < 8 || (nz.runner && nearest < 6 && energy < 40);
                bool cornered = nearest < 2.5 || futile;
                bool stand = cornered && (Armed || n == 1);
                string detail = $"{n} hunting me · threat {threat:0.0} vs me {cap:0.0}" + (futile ? " · can't outrun them" : "");
                output.Add(Cand("fight", "Fight", M.Clamp01(.55 + (cap - threat) * .5 + (stand ? 1 : 0)), detail, () => ActFight(null)));
                output.Add(Cand("flee", "Flee", M.Clamp01(.35 + (threat - cap) * .6 + hurt * .3 + (Armed ? 0 : .3) - (stand ? 1 : 0)), detail, ActFlee));
            }
            else if (unaware.Count > 0)
            {
                var (d0, z0, _) = unaware[0];
                double cap = WeaponPower() * Math.Sqrt(Math.Max(health, 1) / 100);
                output.Add(Cand("evade", "Slip away", M.Clamp01(.5 * (.4 + T("caution")) * (night ? 1.2 : .8) * (unaware.Count > 2 ? 1.3 : 1)),
                                $"{unaware.Count} nearby, not seen me · {d0:0} m", ActEvade));
                if (unaware.Count == 1 && cap > .8 && T("bravery") > .45 && health > 55)
                    output.Add(Cand("ambush", "Take it quietly", .42 + T("bravery") * .15, $"lone infected {d0:0} m, unaware", () => ActFight(z0)));
            }

            // --- body ---
            if (bleeding && inv["bandage"] > 0) output.Add(Cand("bandage", "Bandage wound", .98, "bleeding", ActBandage));
            if (health < 50 && inv["medkit"] > 0) output.Add(Cand("medkit", "Use first-aid kit", .6 + hurt * .3, $"health {health:0}", ActMedkit));
            if (inv["water"] > 0) output.Add(Cand("drink", "Drink", .95 * thirst, $"water {water:0} · {inv["water"]} bottle(s)", ActDrink));
            var src = WaterSource();
            {
                double d = Dist(src.x, src.y);
                double score = thirst * .9 / (1 + d / 500) * (inv["water"] > 0 ? .5 : 1);
                if (inv["water"] < 2 && d < 45 && day > .5) score = Math.Max(score, .22);
                output.Add(Cand("water", "Fetch water", score, $"{src.name} · {d:0} m", () => ActFetchWater(src)));
            }
            if (inv["food"] > 0) output.Add(Cand("eat", "Eat", .95 * hunger, $"food {food:0} · {inv["food"]} ration(s)", ActEat));
            if (home.gardenFood > 0)
                output.Add(Cand("harvest", "Harvest garden", hunger * .8 + (inv["food"] < 2 && home.gardenFood >= 3 ? .2 : 0), $"{home.gardenFood} heads ready", ActHarvest));
            double sleepPull = hour >= 21.5 || hour < 4.8 ? .6 : 0;
            if (aware.Count == 0)
            {
                double score = Math.Max(tired * .95, sleepPull * (.6 + tired * .4));
                if (energy > 97 && !(hour >= 22.5 || hour < 4.5)) score = 0;
                output.Add(Cand("sleep", "Sleep", score, $"energy {energy:0} · {(night ? "night" : "day")}", ActSleep));
            }

            // --- the homestead ---
            if (home.built.Contains("fire") && home.fireFuel < 1.5 && inv["wood"] > 0 && (night || cold > .3))
                output.Add(Cand("tend", "Tend the fire", .6, $"fuel {home.fireFuel:0.0} h", ActTendFire));
            if (night && home.built.Contains("fire") && home.fireFuel > 0)
                output.Add(Cand("rest", "Rest by the fire", .32 + cold * .3 + (morale < 50 ? .1 : 0), $"warmth {warmth:0}", ActRest));
            if (home.WallsBuilt && (home.wallHp < 70 || home.breached != null) && inv["wood"] >= 2)
            {
                double score = home.breached != null ? .85 : (1 - home.wallHp / 100) * .9;
                output.Add(Cand("repair", "Repair palisade", score, home.breached != null ? "wall breached" : $"walls {home.wallHp:0}%", ActRepair));
            }
            double lit = home.built.Contains("gen") ? Math.Max(day, .6) : day;
            var proj = Buildable();
            if (proj != null)
            {
                string started = home.progress.TryGetValue(proj.key, out double pr) && pr > 0 ? " · half done" : "";
                output.Add(Cand("build:" + proj.key, "Build", .55 * drive * Math.Max(lit, .15), proj.name + started, () => ActBuild(proj)));
            }
            var needs = MaterialNeeds();
            if (needs.TryGetValue("wood", out double woodNeed) && woodNeed > 0 && inv["wood"] < 16)
            {
                var tree = PickTree();
                if (tree != null)
                {
                    double d = Dist(tree.x, tree.y);
                    output.Add(Cand("wood:" + tree.idx, "Gather wood", .46 * drive * Math.Max(day, .1) * (inv["axe"] > 0 ? 1 : .8),
                                    $"need {woodNeed:0.#} · tree {d:0} m · {(inv["axe"] > 0 ? "axe" : "by hand")}", () => ActWood(tree)));
                }
            }

            // --- going out ---
            var (site, sscore, sdetail) = BestScavenge(needs, hunger, thirst);
            if (site != null) output.Add(Cand("scav:" + site.idx, "Scavenge", sscore, sdetail, () => ActScavenge(site)));
            double unknown = (double)memory.places.Count(p => !p.known) / Math.Max(1, memory.places.Length);
            if (unknown > 0)
            {
                var target = ExploreTarget();
                if (target.HasValue)
                {
                    var tg = target.Value;
                    output.Add(Cand("explore:" + tg.name, "Explore", (.12 + T("curiosity") * .3) * Math.Min(1, unknown * 1.5) * day * (1 - urgent),
                                    $"towards {tg.name} · {unknown * 100:0}% of places unknown", () => ActExplore(tg)));
                }
            }
            if (sim.rain > .5 && !AtBase() && warmth < 55) output.Add(Cand("shelter", "Get out of the rain", .45, $"warmth {warmth:0}", ActGoHome));
            if (morale < 25) output.Add(Cand("despair", "Sit and stare", (25 - morale) / 25 * .55, $"morale {morale:0}", ActDespair));
            output.Add(Cand("patrol", "Walk the perimeter", .06, "nothing pressing", ActPatrol));
            return output;
        }

        // ------------------------------------------------------------------ targets

        /// <summary>The earliest project whose prerequisite is done and whose materials are in the pack.</summary>
        Project Buildable()
        {
            foreach (var p in home.projects)
            {
                if (home.built.Contains(p.key) || (p.needs != "" && !home.built.Contains(p.needs))) continue;
                if (home.CanAfford(p, inv)) return p;
            }
            return null;
        }

        /// <summary>Materials still missing across the build list; the next few projects count fully, later ones half.</summary>
        Dictionary<string, double> MaterialNeeds()
        {
            var need = new Dictionary<string, double>();
            var spare = new Dictionary<string, int>(inv);
            int n = 0;
            foreach (var p in home.projects)
            {
                if (home.built.Contains(p.key)) continue;
                double weight = n < 3 ? 1 : .5;
                n++;
                if (home.paid.Contains(p.key)) continue;
                foreach (var kv in p.cost)
                {
                    spare.TryGetValue(kv.Key, out int have);
                    int use = Math.Min(have, kv.Value);
                    spare[kv.Key] = have - use;
                    if (kv.Value - use > 0) need[kv.Key] = (need.TryGetValue(kv.Key, out double v) ? v : 0) + (kv.Value - use) * weight;
                }
            }
            if (home.built.Contains("fire") && inv["wood"] < 2) need["wood"] = (need.TryGetValue("wood", out double w) ? w : 0) + 2;
            return need;
        }

        (double x, double y, string name, bool barrel) WaterSource()
        {
            var shore = world.ShorePoint(x, y);
            var opts = new List<(double x, double y, string name, bool barrel)> { (shore.x, shore.y, "the pond", false) };
            foreach (var w in world.wells) opts.Add((w.x, w.y, w.name, false));
            if (home.built.Contains("barrel") && home.barrelWater > 0)
            {
                var b = home.Pos(4.2, 2.4);
                opts.Add((b.x, b.y, "the rain barrel", true));
            }
            return opts.OrderBy(o => Dist(o.x, o.y) * (1 + memory.DangerAt(o.x, o.y) * .5) - (o.barrel ? 80 : 0)).First();
        }

        Tree PickTree()
        {
            if (treeCache.HasValue && treeCache.Value.tree.alive && sim.minutes - treeCache.Value.t < 15) return treeCache.Value.tree;
            var tree = SearchTree();
            treeCache = tree != null ? (sim.minutes, tree) : ((double, Tree)?)null;
            return tree;
        }

        Tree SearchTree()
        {
            var b = home.baseSite;
            Tree best = null;
            double bs = 1e18;
            foreach (var t in world.TreesNear(b.x, b.y, 140))
            {
                double db = M.Hypot(t.x - b.x, t.y - b.y);
                if (db < 21) continue;
                double s = db + Dist(t.x, t.y) * .4 + memory.DangerAt(t.x, t.y) * 60;
                if (s < bs) { best = t; bs = s; }
            }
            return best;
        }

        (LootSite site, double score, string detail) BestScavenge(Dictionary<string, double> needs, double hunger, double thirst)
        {
            double Need(string k) => needs.TryGetValue(k, out double v) ? v : 0;
            var weights = new Dictionary<string, double>
            {
                ["food"] = inv["food"] < 3 ? .5 + 2 * hunger : .2,
                ["water"] = inv["water"] < 3 ? .5 + 2 * thirst : .2,
                ["axe"] = inv["axe"] == 0 ? 2.5 : 0,
                ["rifle"] = inv["rifle"] == 0 ? 1.8 : 0,
                ["ammo"] = inv["rifle"] > 0 && inv["ammo"] < 10 ? .8 : .05,
                ["bandage"] = inv["bandage"] < 2 ? .6 : .05,
                ["medkit"] = .5,
                ["nails"] = Math.Min(Need("nails"), 10) * .14,
                ["scrap"] = Math.Min(Need("scrap"), 10) * .14,
            };
            bool night = Daylight() < .3;
            double t = sim.minutes;
            LootSite best = null;
            double bestS = 0;
            string bestD = "";
            foreach (var site in world.loot)
            {
                var p = memory.places[site.idx];
                if (!p.known) continue;
                double ev = 0;
                foreach (var (item, ch, lo, hi) in LOOT[site.kind])
                    ev += ch * (weights.TryGetValue(item, out double wv) ? wv : 0) * Math.Sqrt((lo + hi) / 2.0);
                if (p.visits > 0)
                {
                    double since = t - p.lastVisit;
                    double fresh = M.Clamp01(since / (4 * 1440)) * .8;
                    if (p.lastYield == 0 && since < 2 * 1440) fresh *= .3;
                    ev *= fresh;
                }
                double d = Dist(site.x, site.y);
                double danger = memory.DangerAt(site.x, site.y);
                double score = M.Clamp01(ev / 1.6) * (1 / (1 + d / 350)) * (1 - Math.Min(1, danger * .35 * (.5 + T("caution")))) * (1 - p.scare * .8);
                if (night) score *= .25;
                score *= .7 * (.75 + .25 * T("diligence"));
                if (score > bestS)
                {
                    string why = p.visits == 0 ? "never searched" : $"searched {(t - p.lastVisit) / 1440:0.0} days ago";
                    if (danger > .8) why += " · risky";
                    best = site; bestS = score; bestD = $"{site.label} {site.where} · {d:0} m · {why}";
                }
            }
            return (best, bestS, bestD);
        }

        (double x, double y, string name)? ExploreTarget()
        {
            (double, double, string)? best = null;
            double bd = 1e18;
            foreach (var s in world.sites)
            {
                if (s.kind == "base") continue;
                bool anyUnknown = false;
                for (int i = 0; i < world.loot.Count; i++)
                    if (world.loot[i].site == s.name && !memory.places[i].known) { anyUnknown = true; break; }
                if (!anyUnknown) continue;
                double d = Dist(s.x, s.y) * (1 + memory.DangerAt(s.x, s.y) * .4);
                if (d < bd) { best = (s.x, s.y, s.name); bd = d; }
            }
            return best;
        }

        // ------------------------------------------------------------------ running actions

        public double? Progress => action?.progress;

        void Run(double dt)
        {
            var a = action;
            if (a.done) return;
            if (a.instr == null)
            {
                Advance(true);
                if (a.done || action != a) return;
            }
            var ins = a.instr;
            switch (ins.kind)
            {
                case InstrKind.Move:
                {
                    var result = MoveTo(ins.tx, ins.ty, ins.pace, ins.arrive, dt);
                    if (result.HasValue) Advance(result.Value);
                    break;
                }
                case InstrKind.Do:
                {
                    anim = ins.anim; speed = 0;
                    if (ins.face != null)
                    {
                        var f = ins.face();
                        Face(f.x, f.y, dt);
                    }
                    bool work = ins.anim == "build" || ins.anim == "chop" || ins.anim == "gather" || ins.anim == "loot";
                    a.t += dt * (work ? WorkRate() : 1);
                    a.progress = ins.dur > 3 ? Math.Min(1, a.t / ins.dur) : (double?)null;
                    if (ins.anim == "chop" || ins.anim == "build")
                    {
                        workNoiseT -= dt;
                        if (workNoiseT <= 0)
                        {
                            workNoiseT = 6;
                            sim.Noise(x, y, ins.anim == "chop" ? 38 : 28, "work");
                        }
                    }
                    if (a.t >= ins.dur)
                    {
                        a.t = 0; a.progress = null;
                        Advance(true);
                    }
                    break;
                }
                case InstrKind.Until:
                    anim = ins.anim; speed = 0;
                    if (ins.pred()) Advance(true);
                    break;
                case InstrKind.Approach:
                {
                    var z = ins.target;
                    if (!z.alive) { Advance(false); return; }
                    if (Dist(z.x, z.y) <= ins.reach) { Advance(true); return; }
                    StepTowards(z.x, z.y, Pace.Jog, dt);
                    break;
                }
            }
        }

        void Advance(bool value)
        {
            var a = action;
            lastOk = value;
            bool more;
            try { more = a.gen.MoveNext(); }
            catch (InvalidOperationException) { more = false; }
            if (action != a) return;   // the action ended the survivor (e.g. died) or was replaced
            if (more)
            {
                a.instr = a.gen.Current;
                a.started = true;
            }
            else
            {
                a.done = true;
                a.instr = null;
                anim = "idle";
            }
        }

        double WorkRate() => (.75 + .5 * T("diligence")) * (.75 + .35 * morale / 100) * (energy < 15 ? .7 : 1);

        void Face(double fx, double fy, double dt)
        {
            double want = Math.Atan2(fy - y, fx - x);
            heading += M.WrapPi(want - heading) * (1 - Math.Exp(-dt * 8));
        }

        double SpeedFor(Pace p)
        {
            double s = PaceSpeed(p) * (1 - Math.Min(.45, world.Slope(x, y) * .5));
            if (health < 30) s *= .8;
            if (energy < 12 && (p == Pace.Jog || p == Pace.Run)) s *= .75;
            return s;
        }

        double StepTowards(double tx, double ty, Pace p, double dt, bool avoid = true)
        {
            double dx = tx - x, dy = ty - y, d = M.Hypot(dx, dy);
            if (d < 1e-4) return d;
            dx /= d; dy /= d;
            if (avoid && p != Pace.Run)
            {
                // give wide berth to remembered infected that haven't noticed us
                foreach (var th in memory.threats.Values)
                {
                    if (th.aware || th.heardOnly) continue;
                    double ox = x - th.x, oy = y - th.y, od = M.Hypot(ox, oy);
                    if (od > 0 && od < 14)
                    {
                        double k = (14 - od) / 14 * 1.6;
                        dx += ox / od * k; dy += oy / od * k;
                    }
                }
                double nn = M.Hypot(dx, dy);
                if (nn == 0) nn = 1;
                dx /= nn; dy /= nn;
            }
            double want = Math.Atan2(dy, dx);
            heading += M.WrapPi(want - heading) * (1 - Math.Exp(-dt * 7));
            double sp = SpeedFor(p);
            speed = sp; pace = p; anim = PaceAnim(p);
            var r = world.Resolve(x + Math.Cos(heading) * sp * dt, y + Math.Sin(heading) * sp * dt, RADIUS);
            x = r.x; y = r.y;
            memory.dayLog.km += sp * dt / 1000;
            return d;
        }

        bool? MoveTo(double tx, double ty, Pace p, double arrive, double dt)
        {
            if (!pathGoal.HasValue || pathGoal.Value.x != tx || pathGoal.Value.y != ty) Plan(tx, ty);
            if (Dist(tx, ty) <= arrive)
            {
                pathGoal = null;
                speed = 0;
                return true;
            }
            // quietly slow down near infected that haven't seen us
            if ((p == Pace.Walk || p == Pace.Jog) && memory.threats.Values.Any(t => !t.aware && !t.heardOnly && Dist(t.x, t.y) < 18)) p = Pace.Sneak;
            var wp = path.Count > 0 ? path[0] : new V2(tx, ty);
            bool last = path.Count <= 1;
            if (StepTowards(wp.x, wp.y, p, dt) < (last ? arrive : 1.6) && path.Count > 0) path.RemoveAt(0);
            stuckT += dt;
            if (stuckT > 2.5)
            {
                double moved = M.Hypot(x - stuckRef.x, y - stuckRef.y);
                stuckT = 0; stuckRef = new V2(x, y);
                if (moved < .6)
                {
                    fails++;
                    heading += sim.rng.Uniform(1, 2) * (sim.rng.Random() < .5 ? 1 : -1);
                    Plan(tx, ty);
                    if (fails > 4)
                    {
                        fails = 0;
                        pathGoal = null;
                        return false;
                    }
                }
                else fails = 0;
            }
            return null;
        }

        void Plan(double tx, double ty)
        {
            double weight = 1.5 + 4 * T("caution");
            path = world.FindPath(x, y, tx, ty, danger: memory.danger, dangerWeight: weight).path;
            pathGoal = new V2(tx, ty);
            stuckT = 0; stuckRef = new V2(x, y);
        }

        /// <summary>Walk to a point, entering or leaving the homestead through the gate when walls are up.</summary>
        IEnumerable<Instr> Go(double gx, double gy, Pace p = Pace.Jog, double arrive = 1)
        {
            if (world.AnyPalisade())
            {
                bool insideNow = home.Inside(x, y, 0), insideGoal = home.Inside(gx, gy, 0);
                if (insideNow != insideGoal)
                {
                    V2 outP = world.GatePoint(world.palR + 3), inP = world.GatePoint(world.palR - 3);
                    V2 first = insideNow ? inP : outP, second = insideNow ? outP : inP;
                    yield return Instr.Move(first.x, first.y, p, 1.5);
                    yield return Instr.Move(second.x, second.y, p, 1.5);
                }
            }
            yield return Instr.Move(gx, gy, p, arrive);
        }

        IEnumerable<Instr> Go(V2 at, Pace p = Pace.Jog, double arrive = 1) => Go(at.x, at.y, p, arrive);

        // ------------------------------------------------------------------ actions

        IEnumerable<Instr> ActDrink()
        {
            Say("Throat's dry. Half the bottle, save the rest.");
            yield return Instr.Do("eat", 4);
            inv["water"]--;
            water = Math.Min(100, water + 45);
            sim.FloatText(this, "Drank", "good");
        }

        IEnumerable<Instr> ActEat()
        {
            Say(Pick("Cold beans again. Still tastes like a feast.", "Eating slowly. Make it last."));
            yield return Instr.Do("eat", 6);
            inv["food"]--;
            food = Math.Min(100, food + 42);
            morale = Math.Min(100, morale + 3);
            sim.FloatText(this, "Ate", "good");
        }

        IEnumerable<Instr> ActFetchWater((double x, double y, string name, bool barrel) src)
        {
            Say(inv["water"] == 0 ? $"Out of water. Heading to {src.name}." : $"Topping up at {src.name} while I'm close.");
            foreach (var i in Go(src.x, src.y, water < 15 ? Pace.Run : Pace.Jog, 1.3)) yield return i;
            if (!lastOk) yield break;
            var face = src.barrel ? home.Pos(5, 3.5) : new V2(world.pond.x, world.pond.y);
            yield return Instr.Do("drink", 10, face);
            if (src.barrel)
            {
                if (home.barrelWater <= 0) { Say("Barrel's dry."); yield break; }
                home.barrelWater--;
            }
            water = 100;
            if (!src.barrel) inv["water"] = Math.Max(inv["water"], Math.Min(inv["water"] + 2, 3));
            Log($"Drank from {src.name} and filled bottles.");
        }

        IEnumerable<Instr> ActHarvest()
        {
            Say("The garden should have something ready.");
            foreach (var i in Go(home.Pos(5, -3))) yield return i;
            yield return Instr.Do("loot", 10, home.Pos(7.5, -4.5));
            int n = home.gardenFood;
            home.gardenFood = 0;
            inv["food"] += n;
            morale = Math.Min(100, morale + 4);
            sim.FloatText(this, $"+{n} Vegetables", "good");
            Log($"Harvested {n} heads of cabbage from the garden.", "good");
        }

        IEnumerable<Instr> ActBandage()
        {
            Say("I'm bleeding. Need to wrap this now.");
            yield return Instr.Do("heal", 8);
            inv["bandage"]--;
            bleeding = false;
            health = Math.Min(100, health + 8);
            Log("Stopped the bleeding with a bandage.", "good");
        }

        IEnumerable<Instr> ActMedkit()
        {
            Say("Patching myself up with the first-aid kit.");
            yield return Instr.Do("heal", 12);
            inv["medkit"]--;
            health = Math.Min(100, health + 45);
            Log("Used a first-aid kit. Feeling steadier.", "good");
        }

        IEnumerable<Instr> ActSleep()
        {
            var bed = home.Bed();
            if (Daylight() > .5) Say("Running on empty. A few hours' rest, then back to it.");
            else Say(home.built.Contains("roof") ? "Long day. Sleeping in the cabin tonight." : "Too dark to work. Getting some sleep.");
            if (home.built.Contains("fire") && home.fireFuel < 1.5 && inv["wood"] > 0)
            {
                foreach (var i in Go(home.Pos(1.4, -1), Pace.Jog, .8)) yield return i;
                yield return Instr.Do("loot", 5, home.FirePos);
                inv["wood"]--;
                home.fireFuel += 5;
            }
            foreach (var i in Go(bed, Pace.Jog, .8)) yield return i;
            Journal();
            yield return Instr.Until("sleep", () =>
            {
                double h = sim.Hour;
                return (energy >= 99 && h >= 5.3 && h < 21) || (energy > 80 && h >= 6.5 && h < 19);
            });
            Say(Pick("Still alive. That counts for something.", "Birds are singing. Strange how that never stopped.", "Back to work."));
        }

        void Journal()
        {
            var dl = memory.dayLog;
            var bits = new List<string>();
            if (dl.loots > 0) bits.Add($"searched {dl.loots} places, found {dl.found} things");
            if (dl.kills > 0) bits.Add($"put down {dl.kills} infected");
            if (dl.built.Count > 0) bits.Add("built the " + string.Join(" and the ", dl.built.Select(b => b.ToLowerInvariant())));
            if (dl.closeCalls > 0) bits.Add("nearly didn't make it back");
            if (bits.Count > 0) Log($"{firstName}'s journal: " + string.Join("; ", bits) + $". Walked {dl.km:0.0} km.", "journal");
            memory.dayLog = new DayLog();
        }

        IEnumerable<Instr> ActTendFire()
        {
            Say("Fire's low. Another log.");
            foreach (var i in Go(home.Pos(1.4, -1), Pace.Walk, .8)) yield return i;
            yield return Instr.Do("loot", 5, home.FirePos);
            inv["wood"]--;
            home.fireFuel += 5;
        }

        IEnumerable<Instr> ActRest()
        {
            Say(Pick("Sitting by the fire. Listening to the dark.", "The fire keeps them away. Mostly.", "Thinking about the people who lived in Staroye."));
            foreach (var i in Go(home.Pos(1.9, -1.2), Pace.Walk, .6)) yield return i;
            yield return Instr.Do("sit", sim.rng.Uniform(40, 70), home.FirePos);
            morale = Math.Min(100, morale + 4);
        }

        IEnumerable<Instr> ActRepair()
        {
            Say("They've been at the walls. Patching the worst of it.");
            int seg = home.breached ?? sim.rng.RandInt(1, 3);
            double a = world.gateAngle + Math.PI / 2 * seg;
            var b = home.baseSite;
            foreach (var i in Go(b.x + Math.Cos(a) * 15, b.y + Math.Sin(a) * 15, Pace.Jog, .8)) yield return i;
            yield return Instr.Do("build", 30, new V2(b.x + Math.Cos(a) * 17.5, b.y + Math.Sin(a) * 17.5));
            inv["wood"] -= 2;
            home.wallHp = Math.Min(100, home.wallHp + 35);
            if (home.breached != null)
            {
                home.breached = null;
                world.SetPalisade(home.PalisadeBuilt());
                home.changed = true;
                Log("Rebuilt the broken stretch of palisade. The walls hold again.", "build");
            }
            else Log("Repaired a weak stretch of the palisade.");
        }

        IEnumerable<Instr> ActBuild(Project p)
        {
            var s = home.Pos(p.stand);
            var t = home.Pos(p.at);
            Say($"Building the {p.name.ToLowerInvariant()}.");
            foreach (var i in Go(s, Pace.Jog, .8)) yield return i;
            if (!lastOk || !home.CanAfford(p, inv)) yield break;
            if (!home.paid.Contains(p.key))
            {
                home.Pay(p, inv);
                Log($"Started the {p.name.ToLowerInvariant()}.", "build");
            }
            if (!home.progress.ContainsKey(p.key)) home.progress[p.key] = 0;
            home.changed = true;
            double start = home.progress[p.key];
            double remaining = p.minutes * (1 - start);
            int steps = Math.Max(1, (int)(remaining / 10));
            for (int n = 0; n < steps; n++)
            {
                yield return Instr.Do("build", remaining / steps, t);
                home.progress[p.key] = start + (1 - start) * (n + 1) / steps;
            }
            home.Finish(p);
            memory.dayLog.built.Add(p.name);
            morale = Math.Min(100, morale + 8);
            Log($"Finished the {p.name.ToLowerInvariant()}. Homestead {home.built.Count}/{home.projects.Count}.", "build");
            sim.FloatText(this, $"{p.name} built", "gold");
            Say(p.line);
        }

        IEnumerable<Instr> ActWood(Tree tree)
        {
            double d = Dist(tree.x, tree.y);
            if (d == 0) d = 1;
            double sx = tree.x + (x - tree.x) / d * 1.3, sy = tree.y + (y - tree.y) / d * 1.3;
            Say(inv["axe"] > 0 ? Pick("Need timber. That one will do.", "Chopping wood. Honest work.", "A few more logs and the wall goes up.")
                               : "No axe. Breaking dead branches by hand.");
            foreach (var i in Go(sx, sy, Pace.Jog, .7)) yield return i;
            if (!lastOk || !tree.alive) yield break;
            if (inv["axe"] > 0)
            {
                yield return Instr.Do("chop", 22, new V2(tree.x, tree.y));
                if (!tree.alive) yield break;
                world.FellTree(tree);
                sim.OnTreeFelled(tree, this);
                sim.Noise(tree.x, tree.y, 55, "work");
                inv["wood"] = Math.Min(16, inv["wood"] + 4);
                sim.FloatText(this, "+4 Wood", "good");
            }
            else
            {
                yield return Instr.Do("gather", 26, new V2(tree.x, tree.y));
                inv["wood"] = Math.Min(16, inv["wood"] + 2);
                sim.FloatText(this, "+2 Wood", "good");
            }
        }

        IEnumerable<Instr> ActScavenge(LootSite site)
        {
            var p = memory.places[site.idx];
            if (p.visits > 0) Say($"Back to the {site.label} {site.where}. Might have missed something.");
            else if (inv["axe"] == 0 && (site.kind == "barn" || site.kind == "cottage")) Say($"Farm buildings keep tools. Checking the {site.label} {site.where}.");
            else if (inv["rifle"] == 0 && site.kind == "military") Say("The army left in a hurry. Maybe they left a gun.");
            else Say($"Going through the {site.label} {site.where}.");
            foreach (var i in Go(site.x, site.y, Pace.Jog, 1.0)) yield return i;
            if (!lastOk)
            {
                memory.places[site.idx].lastVisit = sim.minutes;
                yield break;
            }
            yield return Instr.Do("loot", sim.rng.Uniform(10, 16), new V2(site.cx, site.cy));
            Loot(site);
        }

        void Loot(LootSite site)
        {
            var rng = sim.rng;
            var p = memory.places[site.idx];
            p.visits++;
            p.lastVisit = sim.minutes;
            loots++;
            memory.dayLog.loots++;
            var got = new List<(string item, int n)>();
            if (!site.looted)
            {
                bool pity = inv["axe"] == 0 && lootsSinceAxe >= 3;
                foreach (var (item, chance0, lo, hi) in LOOT[site.kind])
                {
                    if ((item == "axe" || item == "rifle") && inv[item] > 0) continue;
                    double chance = item == "axe" && pity ? 1 : chance0;
                    if (rng.Random() < chance)
                    {
                        int n = rng.RandInt(lo, hi);
                        if (item == "rifle") { inv["rifle"] = 1; inv["ammo"] += rng.RandInt(4, 10); }
                        else if (item == "axe") inv["axe"] = 1;
                        else inv[item] += n;
                        got.Add((item, n));
                    }
                }
                site.looted = true;
                site.restockAt = sim.minutes + 1440 * rng.Uniform(3, 5);
            }
            lootsSinceAxe = inv["axe"] > 0 ? 0 : lootsSinceAxe + 1;
            p.lastYield = got.Sum(g => g.n);
            memory.dayLog.found += p.lastYield;
            inv["wood"] = Math.Min(inv["wood"], 16);
            if (got.Count == 0)
            {
                sim.FloatText(this, "Nothing", "bad");
                morale = Math.Max(0, morale - 2);
                if (rng.Random() < .5) Log($"Searched {M.An(site.label)} {site.where}. Picked clean.");
                Say(Pick("Someone got here first.", "Empty. Just dust and broken glass.", "Nothing. Keep moving."));
                return;
            }
            for (int i = 0; i < got.Count; i++)
            {
                var (item, n) = got[i];
                string label = char.ToUpperInvariant(item[0]) + item.Substring(1);
                sim.FloatText(this, n > 1 ? $"+{n} {label}" : $"+{label}", item == "axe" || item == "rifle" ? "gold" : "good", i * .35);
            }
            var main = got.FirstOrDefault(g => g.item == "axe" || g.item == "rifle");
            if (main.item == null) main = got[0];
            string noun = rng.Choice(ITEM_NAMES[main.item]);
            string what = main.n == 1 ? M.An(noun) : $"{main.n}x {noun}";
            string more = got.Count > 1 ? " and more" : "";
            bool special = main.item == "axe" || main.item == "rifle";
            Log($"Found {what}{more} in {M.An(site.label)} {site.where}.", special ? "build" : "good");
            morale = Math.Min(100, morale + 2 + (special ? 4 : 0));
            if (main.item == "axe") Say("An axe. Now I can actually build something.");
            else if (main.item == "rifle") Say("A rifle. I feel a little less like prey.");
            else Say(Pick("That will keep me going.", "Good haul.", "Better than nothing.", "Into the pack."));
        }

        IEnumerable<Instr> ActExplore((double x, double y, string name) target)
        {
            Say($"Never been properly through {target.name}. Time to look.");
            double a = sim.rng.Uniform(0, M.TAU);
            foreach (var i in Go(target.x + Math.Cos(a) * 10, target.y + Math.Sin(a) * 10, Pace.Walk, 3)) yield return i;
            yield return Instr.Do("idle", 8);
        }

        IEnumerable<Instr> ActGoHome()
        {
            Say("Soaked through. Heading home.");
            foreach (var i in Go(home.Bed(), Pace.Jog, 1.0)) yield return i;
        }

        IEnumerable<Instr> ActDespair()
        {
            Say(Pick("What's the point of any of this.", "I keep seeing their faces.", "Just need a minute."));
            yield return Instr.Do("sit", 25);
            morale = Math.Min(100, morale + 6 + 10 * T("resilience"));
        }

        IEnumerable<Instr> ActPatrol()
        {
            Say("Walking the perimeter. Checking the walls.");
            double a = sim.rng.Uniform(0, M.TAU), r = sim.rng.Uniform(4, 13);
            var b = home.baseSite;
            foreach (var i in Go(b.x + Math.Cos(a) * r, b.y + Math.Sin(a) * r, Pace.Walk)) yield return i;
            yield return Instr.Do("idle", sim.rng.Uniform(8, 16));
        }

        // --- threats ---

        IEnumerable<Instr> ActFight(Zombie first)
        {
            var target = first;
            while (alive)
            {
                if (target == null || !target.alive)
                {
                    var (aware, unaware) = ThreatSummary();
                    var pool = aware.Count > 0 ? aware : (first == null ? aware : unaware);
                    if (pool.Count == 0) yield break;
                    target = pool[0].z;
                }
                double d = Dist(target.x, target.y);
                if (inv["rifle"] > 0 && inv["ammo"] > 0 && d > 4.5)
                {
                    if (anim != "aim") Say("Infected. Taking the shot.");
                    var z = target;
                    yield return Instr.Do("aim", .8 + stress / 200, () => new V2(z.x, z.y));
                    if (target.alive) sim.Shoot(this, target);
                    continue;
                }
                if (d > 1.6)
                {
                    if (first != null && !target.TargetIsSurvivor) Say("Stay quiet. Come up behind it.");
                    yield return Instr.Approach(target, 1.5);
                    if (!lastOk) target = null;
                    continue;
                }
                if (anim != "melee") Say(inv["axe"] > 0 ? "One of them. I'll handle it." : "No weapon. Fists it is.");
                var zt = target;
                yield return Instr.Do("melee", .62, () => new V2(zt.x, zt.y));
                if (target.alive && Dist(target.x, target.y) < 2.2) sim.Melee(this, target);
            }
        }

        IEnumerable<Instr> ActFlee()
        {
            var (aware, _) = ThreatSummary();
            if (aware.Count == 0) yield break;
            double cx = aware.Average(a => a.th.x), cy = aware.Average(a => a.th.y);
            var b = home.baseSite;
            if (home.WallsClosed && Dist(b.x, b.y) < 220)
            {
                Say("Too many. Back to the walls. Run!");
                foreach (var i in Go(b.x, b.y, Pace.Run, 3)) yield return i;
                yield break;
            }
            Say(aware.Count > 1 ? "Too many of them. Run!" : "Can't fight this one. Run!");
            double away = Math.Atan2(y - cy, x - cx), homeDir = Math.Atan2(b.y - y, b.x - x);
            V2? best = null;
            double bs = -1e9;
            for (int k = -4; k <= 4; k++)
            {
                double a = away + k * .35;
                double px = x + Math.Cos(a) * 40, py = y + Math.Sin(a) * 40;
                if (Math.Abs(px) > HALF - 15 || Math.Abs(py) > HALF - 15 || !world.Walkable(world.CellOf(px, py))) continue;
                double edge = Math.Max(0, (Math.Max(Math.Abs(px), Math.Abs(py)) - 210) / 30);
                double climb = Math.Max(0, world.GroundZ(px, py) - world.GroundZ(x, y)) / 10;
                double s = -Math.Abs(k) * .15 - memory.DangerAt(px, py) + M.Hypot(px - cx, py - cy) / 40 - edge - climb + Math.Cos(a - homeDir) * .3;
                if (s > bs) { best = new V2(px, py); bs = s; }
            }
            if (best.HasValue) yield return Instr.Move(best.Value.x, best.Value.y, Pace.Run, 2);
        }

        IEnumerable<Instr> ActEvade()
        {
            var (_, unaware) = ThreatSummary();
            if (unaware.Count == 0) yield break;
            bool night = Daylight() < .3;
            double cx = unaware.Average(a => a.th.x), cy = unaware.Average(a => a.th.y);
            foreach (var u in unaware) memory.AddDanger(u.th.x, u.th.y, .5, 20);
            if (night && Dist(cx, cy) > 10)
            {
                Say("Get down. Don't move. Let it pass.");
                yield return Instr.Do("crouch", 20);
                yield break;
            }
            Say("Infected ahead. It hasn't seen me. Going around.");
            double away = Math.Atan2(y - cy, x - cx);
            double px = M.Clamp(x + Math.Cos(away) * 25, -HALF + 15, HALF - 15), py = M.Clamp(y + Math.Sin(away) * 25, -HALF + 15, HALF - 15);
            yield return Instr.Move(px, py, Pace.Sneak, 2);
            pathGoal = null;   // the next route is replanned around the new danger
        }
    }
}

// The infected: wander in loose herds, investigate noise, chase what they see, search where they lost it.
using System;
using System.Collections.Generic;

namespace Afterfall.Sim
{
    public sealed class Zombie
    {
        public const double RADIUS = .4;
        readonly Simulation sim;
        readonly World world;
        public readonly int id, look;
        public readonly bool runner;
        public bool alive;
        public double x, y, heading, hp = 60, speed, roll;
        public string state = "wander", anim = "zidle";
        double tx, ty, idleT, atkT, senseT, groanT, searchT, pathT;
        public double deadT;
        Site home;
        V2? lastSeen;
        List<V2> path = new List<V2>();

        public Zombie(Simulation sim, int zid)
        {
            this.sim = sim;
            world = sim.world;
            id = zid;
            runner = sim.rng.Random() < .22;
            look = sim.rng.RandInt(0, 9999);
            heading = sim.rng.Uniform(0, M.TAU);
            senseT = sim.rng.Uniform(0, .3);
            groanT = sim.rng.Uniform(5, 30);
        }

        public bool TargetIsSurvivor => alive && (state == "chase" || state == "attack");

        public void Spawn(V2? awayFrom = null)
        {
            var sites = world.sites.FindAll(s => s.kind != "base");
            Site s = sites[0];
            double px = 0, py = 0;
            for (int n = 0; n < 40; n++)
            {
                s = sim.rng.Choice(sites);
                double a = sim.rng.Uniform(0, M.TAU), r = Math.Sqrt(sim.rng.Random()) * s.r;
                px = s.x + Math.Cos(a) * r; py = s.y + Math.Sin(a) * r;
                if (!world.Walkable(world.CellOf(px, py), true)) continue;
                if (awayFrom.HasValue && M.Hypot(px - awayFrom.Value.x, py - awayFrom.Value.y) < 90) continue;
                break;
            }
            x = px; y = py; home = s;
            tx = x; ty = y;
            hp = 60; alive = true; state = "wander"; deadT = 0;
            idleT = sim.rng.Uniform(0, 5);
        }

        public void Hit(double dmg)
        {
            if (!alive) return;
            hp -= dmg;
            if (state != "chase" && state != "attack") state = "chase";
            if (hp <= 0)
            {
                alive = false;
                state = "dead";
                anim = "dead";
                roll = sim.rng.Uniform(-.5, .5);
            }
        }

        public void Update(double dt)
        {
            var s = sim.survivor;
            if (!alive)
            {
                deadT += dt;
                if (deadT > 70 && (s == null || M.Hypot(x - s.x, y - s.y) > 70))
                    Spawn(s != null ? new V2(s.x, s.y) : (V2?)null);
                return;
            }
            groanT -= dt;
            if (groanT < 0)
            {
                groanT = state != "chase" ? sim.rng.Uniform(10, 40) : sim.rng.Uniform(4, 9);
                sim.Noise(x, y, state != "chase" ? 18 : 26, "zombie", id);
            }
            senseT -= dt;
            if (senseT <= 0)
            {
                senseT = .3;
                Sense(s);
            }
            switch (state)
            {
                case "wander": StateWander(dt); break;
                case "investigate": StateInvestigate(dt); break;
                case "search": StateSearch(dt); break;
                case "chase": StateChase(dt, s); break;
                case "attack": StateAttack(dt, s); break;
                case "pound": StatePound(dt, s); break;
            }
        }

        void Sense(Survivor s)
        {
            if (s == null || !s.alive)
            {
                if (state == "chase" || state == "attack") state = "wander";
                return;
            }
            double d = M.Hypot(s.x - x, s.y - y);
            bool walledOut = world.PalisadeClosed() && sim.home.Inside(s.x, s.y, 0) && !sim.home.Inside(x, y, 0);
            bool night = sim.Hour >= 21 || sim.Hour < 5.3;
            double rng = (night ? 11 : 22) * (1 - .3 * sim.fogAmount);
            double loud = s.anim switch { "run" => 1.5, "chop" => 1.6, "build" => 1.4, "melee" => 1.3, _ => 1.0 };
            double quiet = s.anim switch { "sneak" => .5, "crouch" => .35, "sleep" => .45, "sit" => .7, _ => 1.0 };
            rng *= loud * quiet;
            double fx = Math.Cos(heading), fy = Math.Sin(heading);
            double dx = (s.x - x) / Math.Max(d, 1e-3), dy = (s.y - y) / Math.Max(d, 1e-3);
            bool inFov = d < 4 || dx * fx + dy * fy > -.1;
            if (d < rng && inFov && world.SightClear(x, y, s.x, s.y))
            {
                lastSeen = new V2(s.x, s.y);
                if (walledOut)
                {
                    if (state != "pound" && d < 30) state = "pound";
                    return;
                }
                if (state != "chase" && state != "attack")
                {
                    state = "chase";
                    sim.Noise(x, y, 26, "zombie", id);
                }
                return;
            }
            if ((state == "chase" || state == "attack") && d > (runner ? 45 : 36))
            {
                state = "search";
                searchT = 25;
                return;
            }
            if (state == "wander" || state == "idle" || state == "search")
                foreach (var n in sim.noises)
                {
                    if (n.source == "zombie" && n.zid == id) continue;
                    double nd = M.Hypot(n.x - x, n.y - y);
                    if (nd < n.radius && (n.source != "zombie" || sim.rng.Random() < .25))
                    {
                        state = "investigate";
                        tx = n.x + sim.rng.Uniform(-6, 6);
                        ty = n.y + sim.rng.Uniform(-6, 6);
                        searchT = 40;
                        break;
                    }
                }
        }

        double Move(double gx0, double gy0, double spd, double dt, bool usePath = false)
        {
            double gx = gx0, gy = gy0;
            if (usePath)
            {
                pathT -= dt;
                if (pathT <= 0 || path.Count == 0)
                {
                    pathT = 3;
                    if (!world.LineWalkable(x, y, gx0, gy0, true) && sim.pathBudget > 0)
                    {
                        sim.pathBudget--;
                        path = world.FindPath(x, y, gx0, gy0, true, maxExpand: 3000).path;
                    }
                    else path = new List<V2> { new V2(gx0, gy0) };
                }
                if (path.Count > 0)
                {
                    if (M.Hypot(path[0].x - x, path[0].y - y) < 1.5 && path.Count > 1) path.RemoveAt(0);
                    gx = path[0].x; gy = path[0].y;
                }
            }
            double want = Math.Atan2(gy - y, gx - x);
            heading += M.WrapPi(want - heading) * (1 - Math.Exp(-dt * 5));
            double sp = spd * (1 - Math.Min(.4, world.Slope(x, y) * .5));
            var p = world.Resolve(x + Math.Cos(heading) * sp * dt, y + Math.Sin(heading) * sp * dt, RADIUS, true);
            x = p.x; y = p.y;
            speed = sp;
            return M.Hypot(gx0 - x, gy0 - y);
        }

        void StateWander(double dt)
        {
            idleT -= dt;
            if (idleT > 0) { anim = "zidle"; speed = 0; return; }
            double d = Move(tx, ty, .65, dt);
            anim = "zwalk";
            if (d < 1.2)
            {
                idleT = sim.rng.Uniform(3, 12);
                // drift towards others: herds form without anyone planning them
                double cx = 0, cy = 0;
                int n = 0;
                foreach (var z in sim.zombies)
                    if (z != this && z.alive && M.Hypot(z.x - x, z.y - y) < 30) { cx += z.x; cy += z.y; n++; }
                double a = sim.rng.Uniform(0, M.TAU), r = Math.Sqrt(sim.rng.Random()) * home.r * 1.1;
                double nx = home.x + Math.Cos(a) * r, ny = home.y + Math.Sin(a) * r;
                if (n > 0) { nx = nx * .6 + cx / n * .4; ny = ny * .6 + cy / n * .4; }
                tx = nx; ty = ny;
            }
        }

        void StateInvestigate(double dt)
        {
            searchT -= dt;
            double d = Move(tx, ty, runner ? 2.4 : 1.6, dt, true);
            anim = "zwalk";
            if (d < 2 || searchT < 0)
            {
                state = "wander";
                idleT = sim.rng.Uniform(4, 10);
            }
        }

        void StateSearch(double dt)
        {
            searchT -= dt;
            if (lastSeen.HasValue)
            {
                var l = lastSeen.Value;
                if (M.Hypot(tx - l.x, ty - l.y) > 12 || M.Hypot(x - tx, y - ty) < 1.5)
                {
                    double a = sim.rng.Uniform(0, M.TAU);
                    tx = l.x + Math.Cos(a) * 8; ty = l.y + Math.Sin(a) * 8;
                }
            }
            Move(tx, ty, 1.4, dt, true);
            anim = "zwalk";
            if (searchT < 0) state = "wander";
        }

        void StateChase(double dt, Survivor s)
        {
            if (s == null || !s.alive) { state = "wander"; return; }
            double d = M.Hypot(s.x - x, s.y - y);
            if (d < 1.25) { state = "attack"; atkT = .4; return; }
            var t = lastSeen ?? new V2(s.x, s.y);
            Move(t.x, t.y, runner ? 3.7 : 2.5, dt, d > 6);
            anim = runner ? "zrun" : "zwalk";
        }

        void StateAttack(double dt, Survivor s)
        {
            if (s == null || !s.alive) { state = "wander"; return; }
            double d = M.Hypot(s.x - x, s.y - y);
            double want = Math.Atan2(s.y - y, s.x - x);
            heading += M.WrapPi(want - heading) * (1 - Math.Exp(-dt * 8));
            anim = "zattack"; speed = 0;
            if (d > 1.8) { state = "chase"; return; }
            atkT -= dt;
            if (atkT <= 0)
            {
                atkT = 1.25;
                s.TakeHit(sim.rng.Uniform(4, 9), this);
                sim.Sfx("hurt", s.x, s.y);
            }
        }

        /// <summary>Outside the finished palisade: claw at the wall, which slowly wears it down.</summary>
        void StatePound(double dt, Survivor s)
        {
            var home = sim.home;
            if (!world.PalisadeClosed() || s == null || !s.alive || !home.Inside(s.x, s.y, 0))
            {
                state = "search";
                searchT = 15;
                return;
            }
            var b = home.baseSite;
            double a = Math.Atan2(y - b.y, x - b.x);
            double gx = b.x + Math.Cos(a) * (world.palR + 1), gy = b.y + Math.Sin(a) * (world.palR + 1);
            if (Move(gx, gy, 1.6, dt) > 1.5) { anim = "zwalk"; return; }
            heading = a + Math.PI;
            anim = "zattack"; speed = 0;
            home.wallHp = Math.Max(0, home.wallHp - dt * .08);
            if (sim.rng.Random() < dt * .02)
            {
                state = "wander";
                idleT = 10;
            }
        }
    }
}

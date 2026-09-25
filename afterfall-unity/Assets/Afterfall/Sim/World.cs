// Procedural world: terrain, roads, settlements, vegetation, and the spatial queries the AI relies on.
// Coordinates are metres: x east, y north, z up.
using System;
using System.Collections.Generic;
using static Afterfall.Sim.Config;

namespace Afterfall.Sim
{
    public static class Pal
    {
        public static readonly int[] PLASTER = { 0xc9bb97, 0xa9b6b0, 0xd2cbbb, 0xc7a988, 0xb9b08f, 0x9fa89a };
        public static readonly int[] ROOF = { 0x6d3024, 0x4b4f55, 0x5b4032 };
        public static readonly int[] CORR = { 0x7f8386, 0x6d4f3a, 0x5f6d5b };
        public static readonly int[] PLANKS = { 0x7b6a55, 0x6a5c4d, 0x8a3b2c };
        public static readonly int[] CAR = { 0x6b7c63, 0x8b9095, 0x7b2e23, 0xc8bf9f, 0x3e4d63, 0xa58d3c };
        public static readonly int[] PINE = { 0x2b3f22, 0x31472a, 0x263a20 };
        public static readonly int[] BIRCH_LEAF = { 0x5a7a2a, 0x6b8a34 };
        public static readonly int[] BUSH = { 0x3a5226, 0x44602c };
        public const int CONCRETE = 0x8f8b83, DARK = 0x141514, GLASS = 0x1f272b, FRAME = 0xd8d2c0, FRAME_GREEN = 0x4d6b56;
        public const int BRICK = 0x8a4b35, PANEL = 0xa49f93, METAL = 0x5b5c5a, RUST = 0x7a4a2c, BURNT = 0x262320;
        public const int TIRE = 0x1b1b1a, CHROME = 0x9a9a96, CANVAS = 0x5d6444, OLIVE = 0x4d5238, SANDBAG = 0x8a7d5c;
        public const int COPPER = 0x5f8b78, BIRCH = 0xd9d6cc, BARK = 0x4a3a2c, ROCK = 0x7c7a73, WATER = 0x2a3d44;
        public const int ASPHALT = 0x3c3d3e, DIRT_ROAD = 0x5c4b37, LINE = 0xcdbe78, HAY = 0xb49a52, RED = 0x7a2e24;
        public const int DEADWOOD = 0x6e6558, GRASS_TUFT = 0x55632d, SOIL = 0x3b2c1e, TARP = 0x2f4f6a, BLUE = 0x2c5a8a;

        public static (double r, double g, double b) Rgb(int hex) => (((hex >> 16) & 255) / 255.0, ((hex >> 8) & 255) / 255.0, (hex & 255) / 255.0);
    }

    public enum Shape { Cube, Sphere, Cylinder, Cone }

    public sealed class Part
    {
        public Shape shape;
        public Mat3 m;          // rotation * scale
        public V3 pos;          // world position
        public int color;
        public double sway;     // wind sway weight for vegetation
        public double anchor;   // ground height the sway is measured from
        public string mat;      // scanned material key, or null for plain colour
    }

    public sealed class Obstacle
    {
        public double cx, cy, ex, ey, cs, sn, r;
        public V2 ToLocal(double x, double y) { double dx = x - cx, dy = y - cy; return new V2(dx * cs + dy * sn, -dx * sn + dy * cs); }
        public V2 FromLocal(double lx, double ly) => new V2(cx + lx * cs - ly * sn, cy + lx * sn + ly * cs);
    }

    public sealed class LootSite
    {
        public double x, y, cx, cy;
        public string kind, label, site, where;
        public int idx;
        public bool looted;
        public double restockAt;
    }

    public sealed class Tree
    {
        public double x, y, scale;
        public string kind;
        public int idx;
        public (int, int) chunk;
        public bool alive = true;
        public readonly List<Part> parts = new();
    }

    public sealed class Site
    {
        public string name, kind;
        public double x, y, r, h0;
    }

    /// <summary>Builds primitives in a structure's local frame (+x is the front) and emits world-space parts.</summary>
    public sealed class Kit
    {
        readonly World w;
        readonly Mat3 rb;
        readonly V3 t;
        readonly double baseZ;
        readonly bool conform;
        readonly List<Part> sink;
        public double sway;

        public Kit(World world, double x, double y, double yaw, double z, double pitch = 0, double roll = 0, bool conform = false,
                   List<Part> sink = null, double sway = 0)
        {
            w = world;
            rb = Mat3.RotZ(yaw) * Mat3.RotPitch(pitch) * Mat3.RotRoll(roll);
            t = new V3(x, y, z);
            baseZ = z;
            this.conform = conform;
            this.sink = sink ?? world.staticParts;
            this.sway = sway;
        }

        public void Emit(Shape shape, int color, V3 size, V3 loc, V3 rot)
        {
            var m = rb * Mat3.YPR(rot.x, rot.y, rot.z) * Mat3.Diag(size.x, size.y, size.z);
            var pos = t + rb * loc;
            if (conform) pos.z += w.GroundZ(pos.x, pos.y) - baseZ;
            sink.Add(new Part { shape = shape, m = m, pos = pos, color = color, sway = sway, anchor = sway > 0 ? baseZ : pos.z, mat = Catalog.MaterialOf(color) });
        }

        static V3 V(double x, double y, double z) => new V3(x, y, z);
        public void Box(double sx, double sy, double sz, double x, double y, double z, int c, double yaw = 0, double pitch = 0, double roll = 0) =>
            Emit(Shape.Cube, c, V(sx, sy, sz), V(x, y, z), V(yaw, pitch, roll));
        public void Cyl(double d, double h, double x, double y, double z, int c, double yaw = 0, double pitch = 0, double roll = 0) =>
            Emit(Shape.Cylinder, c, V(d, d, h), V(x, y, z), V(yaw, pitch, roll));
        public void Sph(double sx, double sy, double sz, double x, double y, double z, int c, double yaw = 0, double pitch = 0, double roll = 0) =>
            Emit(Shape.Sphere, c, V(sx, sy, sz), V(x, y, z), V(yaw, pitch, roll));
        public void Cone(double d, double h, double x, double y, double z, int c, double yaw = 0, double pitch = 0, double roll = 0) =>
            Emit(Shape.Cone, c, V(d, d, h), V(x, y, z), V(yaw, pitch, roll));
    }

    /// <summary>Structure builders (local frame, metres).</summary>
    public static class Builders
    {
        static readonly double SQ2 = Math.Sqrt(2);

        /// <summary>45 degree gabled roof: two slabs plus a rotated cube whose upper half forms the gables.</summary>
        public static void Roof(Kit k, double span, double length, double top, bool ridgeAlongY, int roofC, int gableC)
        {
            double slab = span * .5 * SQ2 + .5, a = span / SQ2, zc = top + span * .25 + .08;
            if (ridgeAlongY)
            {
                k.Box(slab, length + .6, .16, span * .25, 0, zc, roofC, 0, -45, 0);
                k.Box(slab, length + .6, .16, -span * .25, 0, zc, roofC, 0, 45, 0);
                k.Box(a, length - .1, a, 0, 0, top, gableC, 0, 45, 0);
            }
            else
            {
                k.Box(length + .6, slab, .16, 0, span * .25, zc, roofC, 0, 0, -45);
                k.Box(length + .6, slab, .16, 0, -span * .25, zc, roofC, 0, 0, 45);
                k.Box(length - .1, a, a, 0, 0, top, gableC, 0, 0, 45);
            }
        }

        /// <summary>face 0:+x 1:-x 2:+y 3:-y; off = wall distance from centre; u = position along the wall.</summary>
        public static void Window(Kit k, Rng rng, int face, double off, double u, double z, int frameC, bool shutters, int shutterC)
        {
            bool alongX = face < 2;
            (double, double, double) At(double o, double along, double zz) => face switch
            {
                0 => (off + o, along, zz), 1 => (-off - o, along, zz), 2 => (along, off + o, zz), _ => (along, -off - o, zz),
            };
            void Box(double thick, double wd, double ht, (double x, double y, double z) p, int c, double tilt = 0)
            {
                if (alongX) k.Box(thick, wd, ht, p.x, p.y, p.z, c, 0, 0, tilt);
                else k.Box(wd, thick, ht, p.x, p.y, p.z, c, 0, tilt, 0);
            }
            Box(.12, 1.2, 1.4, At(.02, u, z), frameC);
            double roll = rng.Random();
            if (roll < .28)
            {
                Box(.04, 1.0, 1.2, At(.07, u, z), Pal.DARK);
                Box(.05, 1.35, .18, At(.11, u, z + .2), rng.Choice(Pal.PLANKS), -25);
                Box(.05, 1.35, .18, At(.12, u, z - .2), rng.Choice(Pal.PLANKS), 25);
            }
            else if (roll < .6) Box(.04, 1.0, 1.2, At(.07, u, z), Pal.DARK);
            else
            {
                Box(.04, 1.0, 1.2, At(.07, u, z), Pal.GLASS);
                Box(.05, .05, 1.2, At(.09, u, z), frameC);
            }
            if (shutters && rng.Random() < .6)
            {
                Box(.05, .55, 1.3, At(.08, u - .85, z), shutterC);
                Box(.05, .55, 1.3, At(.08, u + .85, z), shutterC, rng.Random() < .3 ? 14 : 0);
            }
        }

        public static void Door(Kit k, Rng rng, double front, int frameC)
        {
            k.Box(.08, 1.3, 2.3, front + .03, 0, 1.35, Pal.DARK);
            k.Box(.2, 1.5, .12, front + .05, 0, 2.54, frameC);
            double ang = rng.Uniform(20, 70), r = M.Rad(ang);
            k.Box(.06, 1.05, 2.15, front + .05 + Math.Sin(r) * .52, -.55 + Math.Cos(r) * .52, 1.28, Pal.PLANKS[1], -ang);
            for (int i = 0; i < 3; i++) k.Box(.45, 1.8 - .25 * i, 2.4, front + .3 + .4 * i, 0, .2 - .2 * i - 1.2, Pal.CONCRETE);
        }

        public static void House(Kit k, Rng rng, double d, double w, int floors, bool ruined, bool brick, bool corr)
        {
            int wall = brick ? Pal.BRICK : rng.Choice(Pal.PLASTER);
            int frameC = rng.Random() < .5 ? Pal.FRAME : Pal.FRAME_GREEN;
            bool shutters = rng.Random() < .5;
            int shutterC = rng.Choice(Pal.PLANKS);
            k.Box(d + .5, w + .5, 1.4, 0, 0, -.5, Pal.CONCRETE);
            for (int f = 0; f < floors; f++) k.Box(d, w, 3.0, 0, 0, .2 + 3 * f + 1.5, wall);
            int ny = Math.Max(1, (int)((w - 1.2) / 2.6)), nx = Math.Max(1, (int)((d - 1.2) / 2.6));
            for (int f = 0; f < floors; f++)
            {
                double z = .2 + 3 * f + 1.65;
                for (int i = 0; i < ny; i++)
                {
                    double u = -w / 2 + (i + .5) * w / ny;
                    if (!(f == 0 && Math.Abs(u) < 1.2)) Window(k, rng, 0, d / 2, u, z, frameC, shutters, shutterC);
                    if (rng.Random() < .8) Window(k, rng, 1, d / 2, u, z, frameC, shutters, shutterC);
                }
                for (int i = 0; i < nx; i++)
                {
                    double u = -d / 2 + (i + .5) * d / nx;
                    Window(k, rng, 2, w / 2, u, z, frameC, shutters, shutterC);
                    Window(k, rng, 3, w / 2, u, z, frameC, shutters, shutterC);
                }
            }
            Door(k, rng, d / 2, frameC);
            double top = .2 + 3 * floors;
            if (!ruined)
            {
                Roof(k, d, w, top, true, corr ? rng.Choice(Pal.CORR) : rng.Choice(Pal.ROOF), wall);
                double cx = rng.Uniform(-d / 5, d / 5);
                k.Box(.7, .7, 1.8, cx, rng.Uniform(-w / 3, w / 3), top + (d / 2 - Math.Abs(cx)) + .3, Pal.BRICK);
                k.Cyl(.12, top, d / 2 + .05, w / 2 + .05, top / 2, Pal.METAL);
                if (rng.Random() < .5)
                {
                    double ay = rng.Uniform(-w / 3, w / 3);
                    k.Cyl(.05, 2.4, 0, ay, top + d / 2 + 1.1, Pal.METAL);
                    for (int i = 0; i < 4; i++) k.Box(.9 - i * .15, .03, .03, 0, ay, top + d / 2 + 1.6 + i * .18, Pal.METAL, 20);
                }
            }
            else
            {
                for (int i = 0; i < 5; i++)
                    k.Box(d + .6, .18, .2, 0, -w / 2 + (i + .5) * w / 5, top + rng.Uniform(0, .9), Pal.BURNT, 0, rng.Uniform(-8, 8), rng.Uniform(-14, 14));
                k.Box(d - .1, w - .1, .05, 0, 0, top - .02, Pal.BURNT);
                for (int i = 0; i < 14; i++)
                {
                    double s = rng.Uniform(.2, .8);
                    k.Box(s, s, s * .6, rng.Uniform(-d / 2 - 2, d / 2 + 2), rng.Uniform(-w / 2 - 2, w / 2 + 2), s * .2,
                          rng.Random() < .5 ? Pal.CONCRETE : wall, rng.Uniform(0, 180), rng.Uniform(0, 60), rng.Uniform(0, 60));
                }
            }
        }

        public static void Apartment(Kit k, Rng rng)
        {
            double d = 11, w = 26, fh = 2.9;
            int floors = 4;
            k.Box(d + .4, w + .4, 1.4, 0, 0, -.5, Pal.CONCRETE);
            for (int f = 0; f < floors; f++) k.Box(d, w, fh, 0, 0, .2 + fh * f + fh / 2, Pal.PANEL);
            for (int f = 0; f < floors; f++)
            {
                double z = .2 + fh * f + 1.55;
                for (int i = 0; i < 9; i++)
                {
                    double u = -w / 2 + (i + .5) * w / 9;
                    if (!(f == 0 && (i == 2 || i == 6))) Window(k, rng, 0, d / 2, u, z, Pal.FRAME, false, 0);
                    Window(k, rng, 1, d / 2, u, z, Pal.FRAME, false, 0);
                    if (f > 0 && (i == 1 || i == 4 || i == 7))
                    {
                        k.Box(1.2, 2.6, .14, -d / 2 - .6, u, .2 + fh * f + .07, Pal.CONCRETE);
                        k.Box(.08, 2.6, 1.0, -d / 2 - 1.18, u, .2 + fh * f + .6, rng.Random() < .5 ? Pal.CORR[0] : Pal.CONCRETE);
                    }
                }
            }
            foreach (double u in new[] { -w / 2 + 2.5 * w / 9, -w / 2 + 6.5 * w / 9 })
            {
                k.Box(.08, 1.5, 2.3, d / 2 + .02, u, 1.35, Pal.DARK);
                k.Box(1.4, 2.2, .14, d / 2 + .7, u, 2.7, Pal.CONCRETE);
                k.Box(1.4, 2.2, 1.6, d / 2 + .7, u, -.6, Pal.CONCRETE);
            }
            double top = .2 + fh * floors;
            k.Box(.3, w + .3, .6, d / 2, 0, top + .3, Pal.CONCRETE);
            k.Box(.3, w + .3, .6, -d / 2, 0, top + .3, Pal.CONCRETE);
            k.Box(d, .3, .6, 0, w / 2, top + .3, Pal.CONCRETE);
            k.Box(d, .3, .6, 0, -w / 2, top + .3, Pal.CONCRETE);
            k.Box(d, w, .1, 0, 0, top + .05, Pal.BURNT);
            k.Box(3, 3, 2.4, 0, w / 4, top + 1.2, Pal.CONCRETE);
        }

        public static double Church(Kit k)
        {
            double d = 15, w = 8;
            k.Box(d + .4, w + .4, 1.4, 0, 0, -.5, Pal.CONCRETE);
            k.Box(d, w, 6, 0, 0, 3.2, Pal.PLASTER[2]);
            Roof(k, w, d, 6.2, false, Pal.ROOF[1], Pal.PLASTER[2]);
            double tx = d / 2 + 2.3;
            k.Box(4.6, 4.6, 13, tx, 0, 6.5, Pal.PLASTER[2]);
            k.Box(5, 5, .4, tx, 0, 13.1, Pal.FRAME);
            k.Cyl(3.2, 1.6, tx, 0, 14.1, Pal.PLASTER[2]);
            k.Sph(3.8, 3.8, 5.1, tx, 0, 16, Pal.COPPER);
            k.Cone(.7, 1.6, tx, 0, 18.6, Pal.COPPER);
            k.Box(.1, .1, 1.6, tx, 0, 20, Pal.METAL);
            k.Box(.1, .9, .1, tx, 0, 20.3, Pal.METAL);
            k.Box(.1, .6, .1, tx, 0, 19.7, Pal.METAL, 0, 0, 20);
            for (int i = 0; i < 4; i++)
                foreach (int s in new[] { -1, 1 })
                    k.Box(.9, .12, 2.4, -d / 2 + 2 + i * 3.6, s * (w / 2 + .01), 3.4, Pal.DARK);
            k.Box(.1, 1.6, 2.8, tx + 2.31, 0, 1.6, Pal.DARK);
            return 2.3;
        }

        public static void GasStation(Kit k)
        {
            k.Box(14, 20, .3, 0, 0, 0, Pal.CONCRETE);
            foreach (double x in new[] { -2.0, 4 })
                foreach (double y in new[] { -5.0, 5 })
                    k.Cyl(.36, 5, x, y, 2.6, Pal.FRAME);
            k.Box(8.5, 13, .7, 1, 0, 5.3, Pal.CORR[0]);
            k.Box(8.7, 13.2, .3, 1, 0, 5.75, Pal.RED);
            foreach (double y in new[] { -2.2, 2.2 })
            {
                k.Box(.5, .8, 1.7, 1, y, 1, Pal.RED);
                k.Box(.52, .6, .4, 1, y, 1.4, Pal.DARK);
            }
            k.Box(4.5, 9, 3.2, -4.5, 0, 1.75, Pal.PLASTER[1]);
            k.Box(4.9, 9.4, .3, -4.5, 0, 3.45, Pal.CONCRETE);
            k.Box(.05, 3.5, 1.8, -2.24, -2, 1.8, Pal.GLASS);
            k.Box(.06, 1.2, 2.2, -2.24, 2.5, 1.25, Pal.DARK);
            k.Cyl(.3, 8, 6.5, 8.5, 4, Pal.METAL);
            k.Box(.2, 3.6, 1, 6.5, 8.5, 7.6, Pal.RED);
        }

        public static void Barn(Kit k, Rng rng)
        {
            double d = 20, w = 13, h = 6;
            k.Box(d + .4, w + .4, 1, 0, 0, -.3, Pal.CONCRETE);
            k.Box(d, w, h, 0, 0, h / 2 + .2, Pal.PLANKS[2]);
            Roof(k, w, d, h + .2, false, Pal.CORR[1], Pal.PLANKS[2]);
            k.Box(.1, 4.4, 4.6, d / 2 + .03, 0, 2.5, Pal.DARK);
            k.Box(.12, 2.2, 4.4, d / 2 + .9, -3, 2.5, Pal.PLANKS[0], -50);
            for (int i = 0; i < 6; i++)
                k.Cyl(1.4, 1.2, d / 2 + rng.Uniform(3, 8), rng.Uniform(-w / 2 - 3, w / 2 + 3), .7, Pal.HAY, rng.Uniform(0, 180), 0, 90);
        }

        public static void Tent(Kit k)
        {
            double a = 4.4 / SQ2;
            k.Box(6.2, a, a, 0, 0, 0, Pal.CANVAS, 0, 0, 45);
            k.Box(.02, 1.2, 1.8, 3.11, 0, .9, Pal.DARK);
            foreach (double x in new[] { -3.1, 3.1 }) k.Cyl(.1, 2.6, x, 0, 1.3, Pal.METAL);
        }

        public static void Watchtower(Kit k, int c, int deck)
        {
            double h = 6;
            foreach (double x in new[] { -1.3, 1.3 })
                foreach (double y in new[] { -1.3, 1.3 })
                    k.Cyl(.26, h, x, y, h / 2, c);
            for (int i = 0; i < 2; i++)
            {
                k.Box(.08, .08, 3.6, 0, -1.3, h * .3 + i * 2.2, c, 0, i == 1 ? 45 : -45, 0);
                k.Box(.08, .08, 3.6, -1.3, 0, h * .3 + i * 2.2, c, 0, 0, i == 1 ? 45 : -45);
            }
            k.Box(3.4, 3.4, .2, 0, 0, h, deck);
            foreach (double s in new[] { -1.66, 1.66 })
            {
                k.Box(3.4, .08, 1, 0, s, h + .6, deck);
                k.Box(.08, 3.4, 1, s, 0, h + .6, deck);
            }
            foreach (double x in new[] { -1.6, 1.6 })
                foreach (double y in new[] { -1.6, 1.6 })
                    k.Cyl(.12, 2.2, x, y, h + 1.1, c);
            k.Cone(5.6, 1.2, 0, 0, h + 2.8, Pal.CORR[1]);
            for (int i = 0; i < 9; i++) k.Box(.08, .6, .08, 1.75, 0, .5 + i * .62, c);
        }

        public static void Car(Kit k, Rng rng, bool burned, bool truck)
        {
            int paint = burned ? Pal.BURNT : rng.Choice(Pal.CAR);
            double length = truck ? 6.4 : 4.2, w = truck ? 2.3 : 1.75;
            k.Box(length, w, .72, 0, 0, .72, paint);
            double cabX = truck ? length / 2 - 1.2 : -.2, cabL = truck ? 1.9 : 2.1;
            k.Box(cabL, w - .14, .66, cabX, 0, 1.41, paint);
            k.Box(cabL * .8, w - .1, .5, cabX, 0, 1.43, burned ? Pal.DARK : Pal.GLASS);
            k.Box(.1, w - .2, .55, cabX + cabL / 2 + .08, 0, 1.38, burned ? Pal.DARK : Pal.GLASS, 0, -30, 0);
            double wx = length / 2 - (truck ? 1.1 : .85), wr = truck ? 1.0 : .72;
            var wheels = new List<(double, double)> { (wx, w / 2 - .1), (wx, -w / 2 + .1), (-wx, w / 2 - .1), (-wx, -w / 2 + .1) };
            if (truck) { wheels.Add((-wx + 1.4, w / 2 - .1)); wheels.Add((-wx + 1.4, -w / 2 + .1)); }
            foreach (var (x, y) in wheels)
            {
                if (!burned && rng.Random() < .12) continue;
                k.Cyl(wr, .26, x, y, wr / 2, burned ? Pal.BURNT : Pal.TIRE, 0, 0, 90);
                if (!burned) k.Cyl(wr * .5, .28, x, y, wr / 2, Pal.CHROME, 0, 0, 90);
            }
            k.Box(.12, w + .05, .22, length / 2 + .04, 0, .5, burned ? Pal.BURNT : Pal.CHROME);
            k.Box(.12, w + .05, .22, -length / 2 - .04, 0, .5, burned ? Pal.BURNT : Pal.CHROME);
            if (truck) k.Cyl(2.4, 3.8, -.9, 0, 1.1, Pal.CANVAS, 0, 90, 0);
        }

        public static void Well(Kit k)
        {
            k.Cyl(2, 1, 0, 0, .5, Pal.CONCRETE);
            k.Cyl(1.5, 1.02, 0, 0, .52, Pal.DARK);
            foreach (double y in new[] { -.8, .8 }) k.Box(.12, .12, 2, 0, y, 1.5, Pal.PLANKS[0]);
            Roof(k, 1.4, 2.2, 2.5, false, Pal.PLANKS[0], Pal.PLANKS[0]);
        }

        public static void Fence(Kit k, Rng rng, double length, int c)
        {
            int posts = Math.Max(2, (int)(length / 2.2));
            for (int i = 0; i <= posts; i++)
            {
                if (rng.Random() < .12) continue;
                k.Box(.12, .12, 1.3, 0, -length / 2 + i * length / posts, .6, c, 0, rng.Uniform(-6, 6), 0);
            }
            foreach (double z in new[] { .45, 1.0 })
                for (int i = 0; i < posts; i++)
                    if (rng.Random() < .8) k.Box(.04, length / posts, .1, .07, -length / 2 + (i + .5) * length / posts, z, c);
        }
    }

    public sealed class Road
    {
        public bool asphalt;
        public double w;
        public V2[] samples;
    }

    public sealed partial class World
    {
        public readonly long seed;
        public readonly Rng rng;
        public readonly Noise noise;
        public readonly List<Site> sites = new();
        public readonly Site baseSite;
        public readonly (double x, double y, double r) pond = POND;
        public readonly List<Part> staticParts = new();
        public readonly List<Part> vegParts = new();
        public readonly List<Obstacle> obstacles = new();
        public readonly List<LootSite> loot = new();
        public readonly List<Tree> trees = new();
        public readonly List<(double x, double y, string name)> wells = new();
        public readonly List<Road> roads = new();
        public bool[] palSegments = new bool[4];
        public readonly double palR = 17.5;
        public readonly double gateAngle = -Math.PI / 2;
        public readonly HashSet<(int, int)> dirtyChunks = new();

        // height field [j (y), i (x)], (HN+1)^2 samples
        public double[,] h, rd;
        public float[,,] colors, splat, normals;
        public double waterZ;

        public World(long seed)
        {
            this.seed = seed;
            rng = new Rng(seed);
            noise = new Noise(seed);
            foreach (var s in SITES) sites.Add(new Site { name = s.name, x = s.x, y = s.y, r = s.r, kind = s.kind });
            baseSite = sites[4];
            BuildRoads();
            BuildRoadField();
            BuildHeights();
            BuildColors();
            BuildSettlements();
            BuildVegetation();
            BuildObstacleHash();
            RebuildBlocking();
        }

        static double GX(int i) => i * HCELL - HALF;

        // --- terrain -------------------------------------------------------------------------------

        double BigH(double x, double y) => noise.Fbm(x * .003, y * .003, 4) * 30 + noise.Fbm(x * .011 + 100, y * .011 - 40, 3) * 6.5;
        double DetH(double x, double y) => noise.Fbm(x * .03 + 7, y * .03 + 3, 3) * 1.8 + noise.Value(x * .13, y * .13) * .28;

        void BuildRoads()
        {
            foreach (var (asphalt, width, raw) in ROADS)
            {
                var pts = Array.ConvertAll(raw, p => new V2(p.x, p.y));
                var dense = new List<V2>();
                for (int i = 0; i < pts.Length - 1; i++)
                {
                    V2 p0 = pts[Math.Max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.Min(pts.Length - 1, i + 2)];
                    for (int k = 0; k < 24; k++)
                    {
                        double t = k / 24.0, t2 = t * t, t3 = t2 * t;
                        dense.Add((p1 * 2 + (p2 - p0) * t + (p0 * 2 - p1 * 5 + p2 * 4 - p3) * t2 + (p1 * 3 - p0 - p2 * 3 + p3) * t3) * .5);
                    }
                }
                dense.Add(pts[pts.Length - 1]);
                var samples = new List<V2> { dense[0] };
                double carry = 0;
                for (int i = 0; i + 1 < dense.Count; i++)
                {
                    V2 a = dense[i], b = dense[i + 1];
                    double seg = (b - a).Length, t = 1.0 - carry;
                    while (t <= seg) { samples.Add(a + (b - a) * (t / seg)); t += 1.0; }
                    carry = seg - (t - 1.0);
                }
                roads.Add(new Road { asphalt = asphalt, w = width, samples = samples.ToArray() });
            }
        }

        void BuildRoadField()
        {
            int s = HN + 1;
            rd = new double[s, s];
            for (int j = 0; j < s; j++) for (int i = 0; i < s; i++) rd[j, i] = 999;
            const double rad = 18;
            foreach (var road in roads)
                foreach (var p in road.samples)
                {
                    int i0 = Math.Max(0, (int)((p.x - rad + HALF) / HCELL)), i1 = Math.Min(HN, (int)((p.x + rad + HALF) / HCELL) + 1);
                    int j0 = Math.Max(0, (int)((p.y - rad + HALF) / HCELL)), j1 = Math.Min(HN, (int)((p.y + rad + HALF) / HCELL) + 1);
                    for (int j = j0; j <= j1; j++)
                        for (int i = i0; i <= i1; i++)
                        {
                            double d = M.Hypot(GX(i) - p.x, GX(j) - p.y) - road.w / 2;
                            if (d < rd[j, i]) rd[j, i] = d;
                        }
                }
        }

        void BuildHeights()
        {
            int s = HN + 1;
            foreach (var st in sites) st.h0 = BigH(st.x, st.y);
            double pondH0 = BigH(pond.x, pond.y);
            waterZ = pondH0 - 1.4;
            h = new double[s, s];
            for (int j = 0; j < s; j++)
                for (int i = 0; i < s; i++)
                {
                    double x = GX(i), y = GX(j);
                    double det = DetH(x, y);
                    double v = BigH(x, y) + det * M.Smooth(-1, 7, rd[j, i]);
                    double e = Math.Max(Math.Abs(x), Math.Abs(y)) / HALF;
                    v += Math.Pow(M.Smooth(.68, 1, e), 1.5) * 70 * (.75 + .5 * (noise.Fbm(x * .02, y * .02, 3) * .5 + .5));
                    foreach (var st in sites)
                    {
                        double wt = 1 - M.Smooth(st.r * .55, st.r + 38, M.Hypot(x - st.x, y - st.y));
                        v += (st.h0 + det * .18 - v) * wt;
                    }
                    double pw = 1 - M.Smooth(pond.r * .25, pond.r + 20, M.Hypot(x - pond.x, y - pond.y));
                    v += (pondH0 - 4.2 - v) * pw;
                    h[j, i] = v;
                }
        }

        void BuildColors()
        {
            int s = HN + 1;
            colors = new float[s, s, 3];
            splat = new float[s, s, 4];
            normals = new float[s, s, 3];
            (double, double, double) C(int hex) => Pal.Rgb(hex);
            for (int j = 0; j < s; j++)
                for (int i = 0; i < s; i++)
                {
                    double x = GX(i), y = GX(j), hh = h[j, i];
                    double dhdx = (h[j, Math.Min(HN, i + 1)] - h[j, Math.Max(0, i - 1)]) / (HCELL * (i == 0 || i == HN ? 1 : 2));
                    double dhdy = (h[Math.Min(HN, j + 1), i] - h[Math.Max(0, j - 1), i]) / (HCELL * (j == 0 || j == HN ? 1 : 2));
                    double nz = 1 / Math.Sqrt(dhdx * dhdx + dhdy * dhdy + 1);
                    normals[j, i, 0] = (float)(-dhdx * nz); normals[j, i, 1] = (float)(-dhdy * nz); normals[j, i, 2] = (float)nz;

                    double n1 = noise.Fbm(x * .02, y * .02, 3) * .5 + .5;
                    double n2 = noise.Fbm(x * .06 + 50, y * .06, 2);
                    double nf = noise.Fbm(x * .008 + 300, y * .008 - 200, 3);
                    var (ar, ag, ab) = C(0x46542a); var (br, bg, bb) = C(0x5d6230);
                    double r = ar * (1 - n1) + br * n1, g = ag * (1 - n1) + bg * n1, b = ab * (1 - n1) + bb * n1;
                    void Mix(int hex, double wt)
                    {
                        var (tr, tg, tb) = C(hex);
                        r += (tr - r) * wt; g += (tg - g) * wt; b += (tb - b) * wt;
                    }
                    Mix(0x857a47, n2 > .25 ? M.Smooth(.25, .6, n2) * .7 : 0);
                    Mix(0x39401f, nf > -.02 ? M.Smooth(-.02, .2, nf) * .6 : 0);
                    double dirt = 1 - M.Smooth(-.5, 3.5, rd[j, i]);
                    double bare = dirt;
                    foreach (var st in sites)
                    {
                        double d = M.Hypot(x - st.x, y - st.y);
                        if (st.kind == "base")
                        {
                            dirt = Math.Max(dirt, (1 - M.Smooth(4, st.r, d)) * .3);
                            bare = Math.Max(bare, (1 - M.Smooth(3, 12, d)) * .7);
                        }
                        else
                        {
                            dirt = Math.Max(dirt, (1 - M.Smooth(st.r * .3, st.r + 10, d)) * .45 * (noise.Fbm(x * .08, y * .08, 2) * .5 + .6));
                            bare = Math.Max(bare, dirt);
                        }
                    }
                    Mix(0x5a4a33, Math.Min(dirt, .85));
                    Mix(0x6e6a61, M.Smooth(.14, .34, 1 - nz));
                    Mix(0x3d3326, hh < waterZ + 1.2 ? M.Smooth(waterZ + 1.2, waterZ + .1, hh) : 0);
                    Mix(0x8b8a80, hh > 52 ? M.Smooth(52, 66, hh) * .8 : 0);
                    colors[j, i, 0] = (float)M.Clamp01(r); colors[j, i, 1] = (float)M.Clamp01(g); colors[j, i, 2] = (float)M.Clamp01(b);

                    // the same masks as ground-material weights: grass, forest floor, mud, rock
                    var sp = new double[] { 1, 0, 0, 0 };
                    void Lay(int k, double wt)
                    {
                        wt = M.Clamp01(wt);
                        for (int c = 0; c < 4; c++) sp[c] = sp[c] * (1 - wt) + (c == k ? wt : 0);
                    }
                    Lay(1, n2 > .3 ? M.Smooth(.3, .7, n2) * .35 : 0);
                    Lay(1, nf > .05 ? M.Smooth(.05, .3, nf) * .55 : 0);
                    Lay(1, Math.Min(bare * 1.2, .9));
                    Lay(3, M.Smooth(.12, .3, 1 - nz));
                    Lay(2, hh < waterZ + 1.6 ? M.Smooth(waterZ + 1.6, waterZ + .2, hh) : 0);
                    Lay(3, hh > 52 ? M.Smooth(52, 64, hh) : 0);
                    for (int c = 0; c < 4; c++) splat[j, i, c] = (float)sp[c];
                }
        }

        public double GroundZ(double x, double y)
        {
            double fx = M.Clamp((x + HALF) / HCELL, 0, HN - 1e-3), fy = M.Clamp((y + HALF) / HCELL, 0, HN - 1e-3);
            int i = (int)fx, j = (int)fy;
            double tx = fx - i, ty = fy - j;
            double a = h[j, i], b = h[j, i + 1], c = h[j + 1, i + 1], d = h[j + 1, i];
            // same diagonal split as the rendered mesh, so feet land exactly on the surface
            return tx >= ty ? a + (b - a) * tx + (c - b) * ty : a + (d - a) * ty + (c - d) * tx;
        }

        public double Slope(double x, double y)
        {
            const double e = 1.5;
            double dx = GroundZ(x + e, y) - GroundZ(x - e, y), dy = GroundZ(x, y + e) - GroundZ(x, y - e);
            return M.Hypot(dx, dy) / (2 * e);
        }

        public double RoadDist(double x, double y)
        {
            int i = (int)M.Clamp(Math.Round((x + HALF) / HCELL), 0, HN), j = (int)M.Clamp(Math.Round((y + HALF) / HCELL), 0, HN);
            return rd[j, i];
        }

        public Site SiteAt(double x, double y)
        {
            Site best = null;
            double bd = 1e9;
            foreach (var s in sites)
            {
                double d = M.Hypot(s.x - x, s.y - y);
                if (d < s.r + 40 && d < bd) { best = s; bd = d; }
            }
            return best;
        }

        // --- settlements -----------------------------------------------------------------------------

        bool Overlaps(double x, double y, double r)
        {
            foreach (var o in obstacles) if (M.Hypot(o.cx - x, o.cy - y) < o.r + r) return true;
            return false;
        }

        public Obstacle AddObstacle(double x, double y, double d, double w, double yaw)
        {
            var o = new Obstacle { cx = x, cy = y, ex = d / 2, ey = w / 2, cs = Math.Cos(yaw), sn = Math.Sin(yaw), r = M.Hypot(d, w) / 2 };
            obstacles.Add(o);
            return o;
        }

        void AddLoot(Obstacle o, string kind, string label, double front)
        {
            var p = o.FromLocal(o.ex + front, 0);
            var s = SiteAt(o.cx, o.cy);
            if (s != null && s.kind == "base") s = null;
            loot.Add(new LootSite
            {
                x = p.x, y = p.y, cx = o.cx, cy = o.cy, kind = kind, label = label, site = s != null ? s.name : "the roadside",
                where = s != null ? $"in {s.name}" : "by the roadside", idx = loot.Count,
            });
        }

        (double x, double y, double yaw)? TryPlace(Site s, double d, double w, double minR, double maxR, bool faceRoad)
        {
            for (int n = 0; n < 120; n++)
            {
                double a = rng.Uniform(0, M.TAU), r = rng.Uniform(minR, maxR);
                double x = s.x + Math.Cos(a) * r, y = s.y + Math.Sin(a) * r;
                double rdv = RoadDist(x, y), need = Math.Max(d, w) / 2 + 2.5;
                if (rdv < need || (faceRoad && rdv > need + 16)) continue;
                if (Overlaps(x, y, M.Hypot(d, w) / 2 + 2.2)) continue;
                if (M.Hypot(x - pond.x, y - pond.y) < pond.r + 20) continue;
                const double e = 2;
                double gx = RoadDist(x + e, y) - RoadDist(x - e, y), gy = RoadDist(x, y + e) - RoadDist(x, y - e);
                double yaw = faceRoad ? Math.Atan2(-gy, -gx) : rng.Uniform(0, M.TAU);
                return (x, y, yaw);
            }
            return null;
        }

        /// <summary>Seat a footprint on the terrain so nothing hangs in the air on slopes.</summary>
        Kit Seat(double x, double y, double yaw, string fit, double d, double w, double sink = 0)
        {
            double cs = Math.Cos(yaw), sn = Math.Sin(yaw);
            double At(double lx, double ly) => GroundZ(x + lx * cs - ly * sn, y + lx * sn + ly * cs);
            if (fit == "tilt")
            {
                double hf = At(d / 2, 0), hb = At(-d / 2, 0), hl = At(0, w / 2), hr = At(0, -w / 2);
                double z = Math.Min((hf + hb) / 2, (hl + hr) / 2) + Math.Abs(hf - hb) * .1 - sink;
                return new Kit(this, x, y, yaw, z, Math.Atan2(hf - hb, d), Math.Atan2(hl - hr, w));
            }
            if (fit == "skirt" || fit == "min")
            {
                double lo = 1e9, hi = -1e9;
                for (int i = 0; i < 5; i++)
                    for (int j = 0; j < 5; j++)
                    {
                        double v = At((i / 4.0 - .5) * d, (j / 4.0 - .5) * w);
                        lo = Math.Min(lo, v); hi = Math.Max(hi, v);
                    }
                if (fit == "min") return new Kit(this, x, y, yaw, lo - sink);
                var k = new Kit(this, x, y, yaw, hi - sink);
                double drop = hi - lo;
                if (drop > .15) k.Box(d + .5, w + .5, drop + 1.4, 0, 0, .15 - (drop + 1.4) / 2, Pal.CONCRETE);
                return k;
            }
            return new Kit(this, x, y, yaw, GroundZ(x, y) - sink, conform: fit == "conform");
        }

        void BuildSettlements()
        {
            Site town = sites[0], vil = sites[1], farm = sites[2], mil = sites[3];

            void PlaceHouse(Site s, string kind)
            {
                double d = rng.Uniform(6.5, 9), w = rng.Uniform(7, 10.5);
                var spot = TryPlace(s, d, w, 6, s.r, true);
                if (spot == null) return;
                var (x, y, yaw) = spot.Value;
                int floors = s.kind == "town" && rng.Random() < .45 ? 2 : 1;
                bool ruined = rng.Random() < .16;
                bool brick = rng.Random() < .18;
                bool corr = s.kind != "town" && rng.Random() < .5;
                Builders.House(Seat(x, y, yaw, "skirt", d, w, .05), rng, d, w, floors, ruined, brick, corr);
                var o = AddObstacle(x, y, d, w, yaw);
                string label = ruined ? "burnt-out house" : s.kind == "town" ? (floors > 1 ? "townhouse" : "house") : "cottage";
                AddLoot(o, ruined ? "ruin" : kind, label, 1.4);
            }

            {
                double x = town.x - 22, y = town.y + 22, yaw = -Math.PI / 4;
                double off = Builders.Church(Seat(x, y, yaw, "skirt", 20, 8.4, .05));
                var o = AddObstacle(x + Math.Cos(yaw) * off, y + Math.Sin(yaw) * off, 20, 8.4, yaw);
                AddLoot(o, "church", "church", 1.5);
                var g = Seat(x - 18, y + 12, .7, "conform", 1, 1);
                for (int i = 0; i < 14; i++)
                {
                    double gx = (i / 7) * 2.4, gy = (i % 7) * 1.8;
                    g.Box(.1, .1, 1.1, gx, gy, .55, Pal.PLANKS[1]);
                    g.Box(.1, .6, .1, gx, gy, .85, Pal.PLANKS[1]);
                    g.Sph(1.6, 1.0, .35, gx + .9, gy, -.05, Pal.SOIL);
                }
            }
            for (int n = 0; n < 2; n++)
            {
                var spot = TryPlace(town, 11, 26, 18, town.r, true);
                if (spot == null) continue;
                var (x, y, yaw) = spot.Value;
                Builders.Apartment(Seat(x, y, yaw, "skirt", 11.4, 26.4, .05), rng);
                AddLoot(AddObstacle(x, y, 11, 26, yaw), "apartment", "apartment block", 1.5);
            }
            for (int n = 0; n < 17; n++) PlaceHouse(town, "house");
            {
                double x = 64, y = 26, yaw = -Math.PI / 2;
                Builders.GasStation(Seat(x, y, yaw, "skirt", 14, 20, .1));
                var o = AddObstacle(x - Math.Cos(yaw) * 4.5, y - Math.Sin(yaw) * 4.5, 4.9, 9.4, yaw);
                AddLoot(o, "gas", "fuel station", 1.2);
            }

            for (int n = 0; n < 10; n++) PlaceHouse(vil, "cottage");
            var ws = TryPlace(vil, 3, 3, 2, 14, false);
            if (ws != null)
            {
                var (x, y, _) = ws.Value;
                Builders.Well(Seat(x, y, 0, "min", 2, 2));
                AddObstacle(x, y, 2, 2, 0);
                wells.Add((x + 1.6, y, "the well in Gorka"));
            }
            var bs = TryPlace(vil, 20, 13, 10, vil.r, true);
            if (bs != null)
            {
                var (x, y, yaw) = bs.Value;
                Builders.Barn(Seat(x, y, yaw, "skirt", 20.4, 13.4), rng);
                AddLoot(AddObstacle(x, y, 20, 13, yaw), "barn", "barn", 1.5);
            }

            for (int n = 0; n < 2; n++)
            {
                var spot = TryPlace(farm, 20, 13, 6, farm.r, false);
                if (spot == null) continue;
                var (x, y, yaw) = spot.Value;
                Builders.Barn(Seat(x, y, yaw, "skirt", 20.4, 13.4), rng);
                AddLoot(AddObstacle(x, y, 20, 13, yaw), "barn", "barn", 1.5);
            }
            for (int n = 0; n < 2; n++)
            {
                var spot = TryPlace(farm, 6.5, 6.5, 4, farm.r, false);
                if (spot == null) continue;
                var (x, y, _) = spot.Value;
                var k = Seat(x, y, 0, "min", 6, 6);
                k.Cyl(6, 13, 0, 0, 6.5, Pal.CORR[0]);
                k.Cone(6.4, 2.2, 0, 0, 14.1, Pal.CORR[0]);
                k.Box(.08, .5, 13, 3.02, 0, 6.5, Pal.METAL);
                AddObstacle(x, y, 6, 6, 0);
            }
            for (int n = 0; n < 4; n++) PlaceHouse(farm, "cottage");
            var fw = TryPlace(farm, 6, 4, 6, farm.r, false);
            if (fw != null)
            {
                var (x, y, _) = fw.Value;
                Builders.Well(Seat(x, y, 0, "min", 2, 2));
                AddObstacle(x, y, 2, 2, 0);
                wells.Add((x + 1.6, y, "the farm well"));
            }

            for (int n = 0; n < 5; n++)
            {
                var spot = TryPlace(mil, 6.4, 4.6, 4, mil.r - 4, false);
                if (spot == null) continue;
                var (x, y, yaw) = spot.Value;
                Builders.Tent(Seat(x, y, yaw, "min", 6.2, 4.4));
                AddLoot(AddObstacle(x, y, 6.4, 4.6, yaw), "military", "army tent", 1.0);
            }
            for (int n = 0; n < 2; n++)
            {
                var spot = TryPlace(mil, 4, 4, mil.r - 6, mil.r, false);
                if (spot == null) continue;
                var (x, y, yaw) = spot.Value;
                Builders.Watchtower(Seat(x, y, yaw, "min", 2.8, 2.8), Pal.OLIVE, Pal.PLANKS[1]);
                AddObstacle(x, y, 3, 3, yaw);
            }
            var ts = TryPlace(mil, 7, 3, 3, mil.r, false);
            if (ts != null)
            {
                var (x, y, yaw) = ts.Value;
                bool burned = rng.Random() < .3;
                Builders.Car(Seat(x, y, yaw, "tilt", 6.4, 2.3), rng, burned, true);
                AddLoot(AddObstacle(x, y, 6.6, 2.5, yaw), "military", "army truck", .6);
            }
            {
                var k = Seat(mil.x, mil.y, 0, "conform", 1, 1);
                for (int i = 0; i < 60; i++)
                {
                    double a = i / 60.0 * M.TAU;
                    if (Math.Abs(Math.Sin(a * .5 - .3)) < .07) continue;
                    double rr = mil.r - 1;
                    k.Sph(.45, .8, .3, Math.Cos(a) * rr, Math.Sin(a) * rr, .18 + (i % 2) * .28, Pal.SANDBAG, M.Deg(a));
                }
                for (int i = 0; i < 12; i++)
                {
                    double s = rng.Uniform(.7, 1.1);
                    k.Box(s, s * .8, s * .8, rng.Uniform(-mil.r * .6, mil.r * .6), rng.Uniform(-mil.r * .6, mil.r * .6), s * .4, Pal.PLANKS[1], rng.Uniform(0, 90));
                }
            }

            // abandoned cars along the roads
            foreach (var road in roads)
            {
                var sm = road.samples;
                for (int n = 0; n < sm.Length / 55; n++)
                {
                    if (rng.Random() < .35) continue;
                    int i = rng.RandInt(10, sm.Length - 11);
                    var t = (sm[i + 2] - sm[i - 2]).Normalized;
                    var nrm = new V2(-t.y, t.x);
                    double side = (rng.Random() < .5 ? -1 : 1) * rng.Uniform(0, road.w * .45 + 2);
                    var c = sm[i] + nrm * side;
                    if (Overlaps(c.x, c.y, 3)) continue;
                    double yaw = Math.Atan2(t.y, t.x) + rng.Uniform(-.4, .4) + (rng.Random() < .5 ? Math.PI : 0);
                    bool burned = rng.Random() < .25;
                    Builders.Car(Seat(c.x, c.y, yaw, "tilt", 4.2, 1.8), rng, burned, false);
                    AddLoot(AddObstacle(c.x, c.y, 4.3, 1.9, yaw), "car", burned ? "burnt car" : "abandoned car", .5);
                }
            }

            // telegraph poles with sagging wires along the main road
            {
                var road = roads[0];
                var sm = road.samples;
                V3[] prev = null;
                for (int i = 6; i < sm.Length - 6; i += 32)
                {
                    var t = (sm[i + 2] - sm[i - 2]).Normalized;
                    var nrm = new V2(-t.y, t.x);
                    var p = sm[i] + nrm * (road.w / 2 + 3.2);
                    if (Overlaps(p.x, p.y, 1)) { prev = null; continue; }
                    double yaw = Math.Atan2(t.y, t.x) + Math.PI / 2, z = GroundZ(p.x, p.y) - .1;
                    var k = new Kit(this, p.x, p.y, yaw, z);
                    k.Cyl(.26, 8, 0, 0, 4, Pal.PLANKS[1]);
                    k.Box(.12, 1.8, .12, 0, 0, 7.6, Pal.PLANKS[1]);
                    var tops = new V3[3];
                    double[] offs = { -.8, 0, .8 };
                    for (int q = 0; q < 3; q++) tops[q] = new V3(p.x - Math.Sin(yaw) * offs[q], p.y + Math.Cos(yaw) * offs[q], z + 7.72);
                    if (prev != null)
                        for (int q = 0; q < 3; q++)
                            for (int seg = 0; seg < 6; seg++)
                            {
                                var a = prev[q] + (tops[q] - prev[q]) * (seg / 6.0);
                                var b = prev[q] + (tops[q] - prev[q]) * ((seg + 1) / 6.0);
                                a.z -= Math.Sin(seg / 6.0 * Math.PI) * .9;
                                b.z -= Math.Sin((seg + 1) / 6.0 * Math.PI) * .9;
                                SegmentPart(a, b, .03, 0x1a1a18);
                            }
                    prev = tops;
                }
            }

            foreach (var s in new[] { vil, farm })
                for (int n = 0; n < 7; n++)
                {
                    double length = rng.Uniform(12, 30);
                    var spot = TryPlace(s, 1, length, s.r * .5, s.r + 10, false);
                    if (spot == null) continue;
                    var (x, y, yaw) = spot.Value;
                    Builders.Fence(Seat(x, y, yaw, "conform", 1, length), rng, length, rng.Choice(Pal.PLANKS));
                }

            for (int n = 0; n < 40; n++)
            {
                var s = sites[rng.RandInt(0, 3)];
                double a = rng.Uniform(0, M.TAU), r = rng.Uniform(0, s.r);
                double x = s.x + Math.Cos(a) * r, y = s.y + Math.Sin(a) * r;
                if (Overlaps(x, y, 1) || RoadDist(x, y) < .5) continue;
                var k = Seat(x, y, rng.Uniform(0, M.TAU), "min", .9, .9);
                if (rng.Random() < .6)
                {
                    int c = rng.Choice(new[] { Pal.RUST, Pal.RED, Pal.OLIVE, Pal.BLUE });
                    if (rng.Random() < .3) k.Cyl(.6, .9, 0, 0, .3, c, 0, 90, 0);
                    else k.Cyl(.6, .9, 0, 0, .45, c);
                }
                else
                {
                    double s2 = rng.Uniform(.6, 1);
                    k.Box(s2, s2 * .8, s2 * .8, 0, 0, s2 * .4, Pal.PLANKS[1]);
                }
            }
        }

        /// <summary>A thin cylinder from a to b (used for wires).</summary>
        void SegmentPart(V3 a, V3 b, double d, int color)
        {
            var v = b - a;
            double length = v.Length;
            var zaxis = v * (1 / length);
            var helper = Math.Abs(zaxis.x) < .9 ? new V3(1, 0, 0) : new V3(0, 1, 0);
            var xaxis = V3.Cross(helper, zaxis).Normalized;
            var yaxis = V3.Cross(zaxis, xaxis);
            var rot = Mat3.FromColumns(xaxis, yaxis, zaxis);
            var mid = (a + b) * .5;
            staticParts.Add(new Part { shape = Shape.Cylinder, m = rot * Mat3.Diag(d, d, length), pos = mid, color = color, anchor = mid.z, mat = Catalog.MaterialOf(color) });
        }

        // --- vegetation --------------------------------------------------------------------------------

        public readonly Dictionary<(int, int), List<Tree>> treeGrid = new();

        void BuildVegetation()
        {
            for (int n = 0; n < 16000; n++)
            {
                double x = rng.Uniform(-HALF + 6, HALF - 6), y = rng.Uniform(-HALF + 6, HALF - 6);
                double nf = noise.Fbm(x * .008 + 300, y * .008 - 200, 3);
                bool forest = nf > -.02;
                if (!forest && rng.Random() > .05) continue;
                if (forest && rng.Random() > M.Smooth(-.02, .25, nf) * .9 + .1) continue;
                if (RoadDist(x, y) < 4) continue;
                bool inSite = false;
                foreach (var s in sites) if (M.Hypot(x - s.x, y - s.y) < s.r * (s.kind == "village" ? .7 : .95)) inSite = true;
                if (inSite) continue;
                if (M.Hypot(x - pond.x, y - pond.y) < pond.r + 8 || Slope(x, y) > .9 || GroundZ(x, y) > 60 || Overlaps(x, y, 1.5)) continue;
                string kind = rng.Random() < .08 ? "dead" : (noise.Fbm(x * .02, y * .02, 2) > .15 || !forest) ? "birch" : "pine";
                double s0 = rng.Uniform(.75, 1.45);
                var tree = new Tree { x = x, y = y, kind = kind, scale = s0, idx = trees.Count, chunk = ((int)Math.Floor((x + HALF) / CHUNK), (int)Math.Floor((y + HALF) / CHUNK)) };
                var k = new Kit(this, x, y, rng.Uniform(0, M.TAU), GroundZ(x, y) - .2 - Slope(x, y) * .45 * s0,
                                M.Rad(rng.Uniform(-2, 2)), M.Rad(rng.Uniform(-2, 2)), sink: tree.parts);
                if (kind == "pine")
                {
                    int c = rng.Choice(Pal.PINE);
                    k.Cyl(.5 * s0, 4 * s0, 0, 0, 2 * s0, Pal.BARK);
                    k.sway = .03;
                    for (int layer = 0; layer < 5; layer++)
                    {
                        double t = layer / 4.0, r = (2.9 + (.7 - 2.9) * t) * s0, hh = (3.4 + (2.2 - 3.4) * t) * s0;
                        k.Cone(r * 2, hh, 0, 0, 2.2 * s0 + layer * 1.8 * s0 + hh / 2, c, rng.Uniform(0, 360));
                    }
                }
                else if (kind == "birch")
                {
                    k.Cyl(.3 * s0, 8.5 * s0, 0, 0, 4.25 * s0, Pal.BIRCH);
                    k.sway = .05;
                    for (int q = 0; q < 6; q++)
                    {
                        double dd = rng.Uniform(1.8, 3.2) * s0;
                        k.Sph(dd, dd, dd * .8, rng.Uniform(-1.2, 1.2) * s0, rng.Uniform(-1.2, 1.2) * s0, rng.Uniform(5.5, 8.8) * s0, rng.Choice(Pal.BIRCH_LEAF));
                    }
                }
                else
                {
                    k.Cyl(.35 * s0, 7 * s0, 0, 0, 3.5 * s0, Pal.DEADWOOD);
                    for (int q = 0; q < 4; q++)
                    {
                        double a = rng.Uniform(0, 360), z = rng.Uniform(3, 6) * s0;
                        k.Cyl(.1 * s0, 2.2 * s0, Math.Cos(M.Rad(a)) * .6 * s0, Math.Sin(M.Rad(a)) * .6 * s0, z + .6 * s0, Pal.DEADWOOD, a, -50);
                    }
                }
                trees.Add(tree);
            }
            foreach (var t in trees)
            {
                var key = ((int)Math.Floor(t.x / 10), (int)Math.Floor(t.y / 10));
                if (!treeGrid.TryGetValue(key, out var list)) treeGrid[key] = list = new List<Tree>();
                list.Add(t);
            }

            int placed = 0;
            for (int n = 0; n < 6000 && placed < 900; n++)
            {
                double x = rng.Uniform(-HALF + 6, HALF - 6), y = rng.Uniform(-HALF + 6, HALF - 6);
                if (RoadDist(x, y) < 3 || Overlaps(x, y, 2) || M.Hypot(x - baseSite.x, y - baseSite.y) < baseSite.r) continue;
                double sl = Slope(x, y);
                if (rng.Random() > .12 + sl * 1.2) continue;
                double sc = rng.Uniform(.6, 3) * (1 + sl * 1.5);
                var k = new Kit(this, x, y, rng.Uniform(0, M.TAU), GroundZ(x, y) - sc * (.12 + sl * .25), sink: vegParts);
                k.Sph(sc * rng.Uniform(.9, 1.6), sc * rng.Uniform(.9, 1.4), sc * rng.Uniform(.5, .9), 0, 0, 0, Pal.ROCK, 0, rng.Uniform(-20, 20), rng.Uniform(-20, 20));
                placed++;
            }

            placed = 0;
            for (int n = 0; n < 16000 && placed < 2600; n++)
            {
                double x = rng.Uniform(-HALF + 6, HALF - 6), y = rng.Uniform(-HALF + 6, HALF - 6);
                if (RoadDist(x, y) < 2.5 || Overlaps(x, y, 1.2) || M.Hypot(x - baseSite.x, y - baseSite.y) < baseSite.r - 4 || M.Hypot(x - pond.x, y - pond.y) < pond.r + 2) continue;
                double nf = noise.Fbm(x * .008 + 300, y * .008 - 200, 3);
                if (rng.Random() > (nf > -.1 ? .5 : .12)) continue;
                double sc = rng.Uniform(.7, 1.6);
                var k = new Kit(this, x, y, rng.Uniform(0, M.TAU), GroundZ(x, y) - .15 - Slope(x, y) * .6 * sc, sink: vegParts, sway: .12);
                k.Sph(1.8 * sc, 1.5 * sc, 1.1 * sc, 0, 0, .35 * sc, rng.Choice(Pal.BUSH));
                placed++;
            }
            // (the Python version's grass tufts are replaced by terrain detail grass in Unity)
        }

        public List<Tree> TreesNear(double x, double y, double r)
        {
            var output = new List<Tree>();
            int cx = (int)Math.Floor(x / 10), cy = (int)Math.Floor(y / 10), cr = (int)Math.Floor(r / 10) + 1;
            for (int i = cx - cr; i <= cx + cr; i++)
                for (int j = cy - cr; j <= cy + cr; j++)
                    if (treeGrid.TryGetValue((i, j), out var list))
                        foreach (var t in list)
                            if (t.alive && Math.Abs(t.x - x) < r && Math.Abs(t.y - y) < r) output.Add(t);
            return output;
        }

        public void FellTree(Tree tree)
        {
            tree.alive = false;
            var k = new Kit(this, tree.x, tree.y, 0, GroundZ(tree.x, tree.y), sink: vegParts);
            k.Cyl(.55 * tree.scale, .6, 0, 0, .2, tree.kind == "birch" ? Pal.BIRCH : Pal.BARK);
            dirtyChunks.Add(tree.chunk);
        }
    }
}

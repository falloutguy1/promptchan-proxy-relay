// Grids, danger-weighted A*, collision and line of sight.
using System;
using System.Collections.Generic;
using static Afterfall.Sim.Config;

namespace Afterfall.Sim
{
    public sealed partial class World
    {
        Dictionary<(int, int), List<Obstacle>> obsGrid;
        /// <summary>Path grid flags: 1 building, 2 water, 4 cliff, 8 wall, 16 gate (blocks the dead only).</summary>
        public byte[,] block;
        public float[,] cost;

        static IEnumerable<(int, int)> CellsOf(Obstacle o)
        {
            for (int i = (int)Math.Floor((o.cx - o.r) / 20); i <= (int)Math.Floor((o.cx + o.r) / 20); i++)
                for (int j = (int)Math.Floor((o.cy - o.r) / 20); j <= (int)Math.Floor((o.cy + o.r) / 20); j++)
                    yield return (i, j);
        }

        void Hash(Obstacle o)
        {
            foreach (var key in CellsOf(o))
            {
                if (!obsGrid.TryGetValue(key, out var list)) obsGrid[key] = list = new List<Obstacle>();
                list.Add(o);
            }
        }

        void BuildObstacleHash()
        {
            obsGrid = new Dictionary<(int, int), List<Obstacle>>();
            foreach (var o in obstacles) Hash(o);
        }

        /// <summary>Obstacles created during play (homestead structures).</summary>
        public Obstacle AddDynamicObstacle(double x, double y, double d, double w, double yaw)
        {
            var o = AddObstacle(x, y, d, w, yaw);
            Hash(o);
            var (i0, j0) = CellOf(x - o.r, y - o.r);
            var (i1, j1) = CellOf(x + o.r, y + o.r);
            for (int j = j0; j <= j1; j++)
                for (int i = i0; i <= i1; i++)
                {
                    var c = CellCenter(i, j);
                    var l = o.ToLocal(c.x, c.y);
                    if (Math.Abs(l.x) < o.ex + .5 && Math.Abs(l.y) < o.ey + .5) block[j, i] |= 1;
                }
            return o;
        }

        static readonly List<Obstacle> None = new();
        public List<Obstacle> ObstaclesNear(double x, double y) =>
            obsGrid.TryGetValue(((int)Math.Floor(x / 20), (int)Math.Floor(y / 20)), out var l) ? l : None;

        public (int i, int j) CellOf(double x, double y) =>
            ((int)M.Clamp(Math.Floor((x + HALF) / PCELL), 0, PN - 1), (int)M.Clamp(Math.Floor((y + HALF) / PCELL), 0, PN - 1));

        public V2 CellCenter(int i, int j) => new V2((i + .5) * PCELL - HALF, (j + .5) * PCELL - HALF);

        public void RebuildBlocking()
        {
            block = new byte[PN, PN];
            cost = new float[PN, PN];
            for (int j = 0; j < PN; j++)
                for (int i = 0; i < PN; i++)
                {
                    var c = CellCenter(i, j);
                    double z = GroundZ(c.x, c.y), sl = Slope(c.x, c.y);
                    if (M.Hypot(c.x - pond.x, c.y - pond.y) < pond.r + 18 && z < waterZ + .05) block[j, i] |= 2;
                    if (sl > 1.1) block[j, i] |= 4;
                    cost[j, i] = (float)((RoadDist(c.x, c.y) < 0 ? .55 : 1.0) * (1 + sl * 3));
                }
            foreach (var o in obstacles)
            {
                var (i0, j0) = CellOf(o.cx - o.r - 1, o.cy - o.r - 1);
                var (i1, j1) = CellOf(o.cx + o.r + 1, o.cy + o.r + 1);
                for (int j = j0; j <= j1; j++)
                    for (int i = i0; i <= i1; i++)
                    {
                        var c = CellCenter(i, j);
                        var l = o.ToLocal(c.x, c.y);
                        if (Math.Abs(l.x) < o.ex + .9 && Math.Abs(l.y) < o.ey + .9) block[j, i] |= 1;
                    }
            }
            foreach (var t in trees)
                if (t.alive)
                {
                    var (i, j) = CellOf(t.x, t.y);
                    cost[j, i] += .6f;
                }
            ApplyPalisade();
        }

        public void SetPalisade(bool[] segments)
        {
            palSegments = (bool[])segments.Clone();
            ApplyPalisade();
        }

        public bool PalisadeClosed() => palSegments[0] && palSegments[1] && palSegments[2] && palSegments[3];
        public bool AnyPalisade() => palSegments[0] || palSegments[1] || palSegments[2] || palSegments[3];

        public (int seg, double rel) SegmentOfAngle(double ang)
        {
            double rel = M.WrapPi(ang - gateAngle);
            int seg = (int)Math.Floor(M.Mod(rel + Math.PI / 4, M.TAU) / (Math.PI / 2)) % 4;
            return (seg, rel);
        }

        void ApplyPalisade()
        {
            var b = baseSite;
            for (int j = 0; j < PN; j++) for (int i = 0; i < PN; i++) block[j, i] &= unchecked((byte)~(8 | 16));
            var (i0, j0) = CellOf(b.x - palR - 4, b.y - palR - 4);
            var (i1, j1) = CellOf(b.x + palR + 4, b.y + palR + 4);
            for (int j = j0; j <= j1; j++)
                for (int i = i0; i <= i1; i++)
                {
                    var c = CellCenter(i, j);
                    if (Math.Abs(M.Hypot(c.x - b.x, c.y - b.y) - palR) > PCELL * .6) continue;
                    var (seg, rel) = SegmentOfAngle(Math.Atan2(c.y - b.y, c.x - b.x));
                    if (!palSegments[seg]) continue;
                    block[j, i] |= (byte)(seg == 0 && Math.Abs(rel) < .25 ? 16 : 8);
                }
        }

        public V2 GatePoint(double r) => new V2(baseSite.x + Math.Cos(gateAngle) * r, baseSite.y + Math.Sin(gateAngle) * r);

        public bool Walkable(int i, int j, bool zombie = false)
        {
            if (i < 0 || i >= PN || j < 0 || j >= PN) return false;
            int f = block[j, i];
            if ((f & (1 | 2 | 4 | 8)) != 0) return false;
            return !(zombie && (f & 16) != 0);
        }

        public bool Walkable((int i, int j) c, bool zombie = false) => Walkable(c.i, c.j, zombie);

        public bool LineWalkable(double ax, double ay, double bx, double by, bool zombie = false)
        {
            int steps = Math.Max(1, (int)(M.Hypot(bx - ax, by - ay) / (PCELL * .5)) + 1);
            for (int s = 1; s <= steps; s++)
            {
                double t = (double)s / steps;
                if (!Walkable(CellOf(ax + (bx - ax) * t, ay + (by - ay) * t), zombie)) return false;
            }
            return true;
        }

        /// <summary>Buildings block line of sight (exact rectangle test); trees and terrain do not.</summary>
        public bool SightClear(double ax, double ay, double bx, double by)
        {
            double dx = bx - ax, dy = by - ay;
            var seen = new HashSet<Obstacle>();
            int steps = Math.Max(1, (int)(M.Hypot(dx, dy) / 20) + 1);
            for (int s = 0; s <= steps; s++)
            {
                double t = (double)s / steps;
                foreach (var o in ObstaclesNear(ax + dx * t, ay + dy * t))
                {
                    if (!seen.Add(o)) continue;
                    if (o.ex < 1.2 && o.ey < 1.2) continue;
                    if (SegmentHitsBox(o, ax, ay, bx, by)) return false;
                }
            }
            return true;
        }

        static bool SegmentHitsBox(Obstacle o, double ax, double ay, double bx, double by)
        {
            var la = o.ToLocal(ax, ay);
            var lb = o.ToLocal(bx, by);
            double t0 = 0, t1 = 1;
            foreach (var (p0, p1, ext) in new[] { (la.x, lb.x, o.ex), (la.y, lb.y, o.ey) })
            {
                double d = p1 - p0;
                if (Math.Abs(d) < 1e-9)
                {
                    if (Math.Abs(p0) > ext) return false;
                    continue;
                }
                double ta = (-ext - p0) / d, tb = (ext - p0) / d;
                if (ta > tb) (ta, tb) = (tb, ta);
                t0 = Math.Max(t0, ta);
                t1 = Math.Min(t1, tb);
                if (t0 > t1) return false;
            }
            // ignore touching the very ends (standing next to a wall is not "behind" it)
            return t1 - t0 > .02;
        }

        static readonly (int di, int dj, double dl)[] Dirs =
            { (1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414) };

        /// <summary>Weighted A*: roads are cheap, slopes cost more, and remembered danger can be avoided.</summary>
        public (List<V2> path, bool found) FindPath(double ax, double ay, double bx, double by, bool zombie = false,
                                                    float[,] danger = null, double dangerWeight = 0, int maxExpand = 12000)
        {
            var start = NearestWalkable(CellOf(ax, ay), zombie);
            var goal = NearestWalkable(CellOf(bx, by), zombie);
            if (start == goal || (danger == null && LineWalkable(ax, ay, bx, by, zombie)))
                return (new List<V2> { new V2(bx, by) }, true);
            int Key((int i, int j) c) => c.j * PN + c.i;
            var g = new Dictionary<int, double> { [Key(start)] = 0 };
            var parent = new Dictionary<int, int> { [Key(start)] = -1 };
            var open = new MinHeap<(int i, int j)>();
            open.Push(start, 0);
            var closed = new HashSet<int>();
            bool found = false;
            int mask = 1 | 2 | 4 | 8 | (zombie ? 16 : 0), expanded = 0;
            while (open.Count > 0 && expanded < maxExpand)
            {
                var cur = open.Pop();
                int ck = Key(cur);
                if (!closed.Add(ck)) continue;
                expanded++;
                if (cur == goal) { found = true; break; }
                var (ci, cj) = cur;
                double gc = g[ck];
                foreach (var (di, dj, dl) in Dirs)
                {
                    int ni = ci + di, nj = cj + dj;
                    if (ni < 0 || ni >= PN || nj < 0 || nj >= PN || (block[nj, ni] & mask) != 0) continue;
                    if (di != 0 && dj != 0 && ((block[cj, ni] & mask) != 0 || (block[nj, ci] & mask) != 0)) continue;
                    int nk = nj * PN + ni;
                    if (closed.Contains(nk)) continue;
                    double step = dl * cost[nj, ni];
                    if (danger != null && dangerWeight != 0) step += danger[nj * DN / PN, ni * DN / PN] * dangerWeight;
                    double ng = gc + step;
                    if (!g.TryGetValue(nk, out double old) || ng < old)
                    {
                        g[nk] = ng;
                        parent[nk] = ck;
                        open.Push((ni, nj), ng + M.Hypot(ni - goal.i, nj - goal.j) * .65);
                    }
                }
            }
            if (!found) return (new List<V2> { new V2(bx, by) }, false);
            var cells = new List<V2>();
            for (int c = Key(goal); c != -1; c = parent[c]) cells.Add(CellCenter(c % PN, c / PN));
            cells.Reverse();
            cells[cells.Count - 1] = new V2(bx, by);
            // string-pull, keeping segments short so the route still follows roads and avoids danger
            var output = new List<V2>();
            var anchor = new V2(ax, ay);
            int idx = 0;
            while (idx < cells.Count)
            {
                int best = idx;
                for (int j = idx + 1; j < cells.Count; j++)
                {
                    if (M.Hypot(cells[j].x - anchor.x, cells[j].y - anchor.y) > 28) break;
                    if (LineWalkable(anchor.x, anchor.y, cells[j].x, cells[j].y, zombie)) best = j;
                }
                output.Add(cells[best]);
                anchor = cells[best];
                idx = best + 1;
            }
            return (output, true);
        }

        (int i, int j) NearestWalkable((int i, int j) cell, bool zombie)
        {
            if (Walkable(cell, zombie)) return cell;
            for (int r = 1; r < 6; r++)
                for (int dj = -r; dj <= r; dj++)
                    for (int di = -r; di <= r; di++)
                        if (Math.Max(Math.Abs(di), Math.Abs(dj)) == r && Walkable(cell.i + di, cell.j + dj, zombie))
                            return (cell.i + di, cell.j + dj);
            return cell;
        }

        /// <summary>Push a moving body out of buildings, trunks, water and walls.</summary>
        public V2 Resolve(double x, double y, double radius = .4, bool zombie = false)
        {
            foreach (var o in ObstaclesNear(x, y))
            {
                var l = o.ToLocal(x, y);
                double px = o.ex + radius - Math.Abs(l.x), py = o.ey + radius - Math.Abs(l.y);
                if (px > 0 && py > 0)
                {
                    if (px < py) l.x = (o.ex + radius) * (l.x < 0 ? -1 : 1);
                    else l.y = (o.ey + radius) * (l.y < 0 ? -1 : 1);
                    var w = o.FromLocal(l.x, l.y);
                    x = w.x; y = w.y;
                }
            }
            foreach (var t in TreesNear(x, y, 2))
            {
                double dx = x - t.x, dy = y - t.y, d = M.Hypot(dx, dy), r = .3 * t.scale + radius;
                if (d > 1e-3 && d < r) { x = t.x + dx / d * r; y = t.y + dy / d * r; }
            }
            double pd = M.Hypot(x - pond.x, y - pond.y);
            if (pd < pond.r + 18 && GroundZ(x, y) < waterZ - .15)
            {
                x += (x - pond.x) / Math.Max(pd, 1e-3) * .4;
                y += (y - pond.y) / Math.Max(pd, 1e-3) * .4;
            }
            var b = baseSite;
            double bd = M.Hypot(x - b.x, y - b.y);
            if (Math.Abs(bd - palR) < radius + .35 && bd > 1e-3)
            {
                var (seg, rel) = SegmentOfAngle(Math.Atan2(y - b.y, x - b.x));
                if (palSegments[seg] && !(seg == 0 && Math.Abs(rel) < .22 && !zombie))
                {
                    double target = palR + (radius + .35) * (bd > palR ? 1 : -1);
                    x = b.x + (x - b.x) / bd * target;
                    y = b.y + (y - b.y) / bd * target;
                }
            }
            return new V2(M.Clamp(x, -HALF + 8, HALF - 8), M.Clamp(y, -HALF + 8, HALF - 8));
        }

        public V2 ShorePoint(double x, double y)
        {
            double d = M.Hypot(x - pond.x, y - pond.y);
            if (d == 0) d = 1;
            double dx = (x - pond.x) / d, dy = (y - pond.y) / d;
            for (double r = pond.r * .5; r < pond.r + 18; r += .4)
            {
                double sx = pond.x + dx * r, sy = pond.y + dy * r;
                if (GroundZ(sx, sy) > waterZ - .1) return new V2(sx, sy);
            }
            return new V2(pond.x + dx * (pond.r + 18), pond.y + dy * (pond.r + 18));
        }
    }
}

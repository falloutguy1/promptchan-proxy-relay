// What a survivor knows: places, remembered danger, recent threats, and notable moments.
using System;
using System.Collections.Generic;
using static Afterfall.Sim.Config;

namespace Afterfall.Sim
{
    public sealed class PlaceMemory
    {
        public bool known;
        public int visits, lastYield;
        public double lastVisit = -1e9;
        public double scare;          // 0..1, fades: "almost died there"
    }

    public sealed class Threat
    {
        public int zid;
        public double x, y, seenAt;
        public bool aware;            // it is hunting me
        public bool heardOnly;
    }

    public sealed class DayLog
    {
        public int loots, found, kills, closeCalls;
        public readonly List<string> built = new List<string>();
        public double km;
    }

    public sealed class Memory
    {
        public readonly PlaceMemory[] places;
        public readonly float[,] danger = new float[DN, DN];
        public readonly Dictionary<int, Threat> threats = new Dictionary<int, Threat>();
        public readonly List<(double t, string text, string place, double weight)> episodes = new List<(double, string, string, double)>();
        public DayLog dayLog = new DayLog();

        public Memory(int nPlaces)
        {
            places = new PlaceMemory[nPlaces];
            for (int i = 0; i < nPlaces; i++) places[i] = new PlaceMemory();
        }

        public void AddDanger(double x, double y, double amount, double radius = 15)
        {
            int ci = (int)Math.Floor((x + HALF) / DCELL), cj = (int)Math.Floor((y + HALF) / DCELL);
            int r = (int)Math.Floor(radius / DCELL) + 1;
            for (int j = Math.Max(0, cj - r); j < Math.Min(DN, cj + r + 1); j++)
                for (int i = Math.Max(0, ci - r); i < Math.Min(DN, ci + r + 1); i++)
                {
                    double cx = (i + .5) * DCELL - HALF, cy = (j + .5) * DCELL - HALF;
                    double d = M.Hypot(cx - x, cy - y);
                    if (d < radius + DCELL) danger[j, i] = (float)Math.Min(4.0, danger[j, i] + amount * (1 - d / (radius + DCELL)));
                }
        }

        public double DangerAt(double x, double y)
        {
            int i = (int)M.Clamp(Math.Floor((x + HALF) / DCELL), 0, DN - 1), j = (int)M.Clamp(Math.Floor((y + HALF) / DCELL), 0, DN - 1);
            return danger[j, i];
        }

        public void Decay(double dt)
        {
            // danger halves every 12 game hours; scares fade over two days
            float k = (float)Math.Pow(.5, dt / 720.0);
            for (int j = 0; j < DN; j++) for (int i = 0; i < DN; i++) danger[j, i] *= k;
            foreach (var p in places) if (p.scare > 0) p.scare = Math.Max(0, p.scare - dt / 2880.0);
        }

        public void See(int zid, double x, double y, double t, bool aware) =>
            threats[zid] = new Threat { zid = zid, x = x, y = y, seenAt = t, aware = aware };

        public void Hear(int zid, double x, double y, double t)
        {
            if (!threats.TryGetValue(zid, out var old) || old.heardOnly)
                threats[zid] = new Threat { zid = zid, x = x, y = y, seenAt = t, heardOnly = true };
        }

        readonly List<int> stale = new List<int>();

        public void ForgetOld(double t)
        {
            stale.Clear();
            foreach (var kv in threats) if (t - kv.Value.seenAt > (kv.Value.aware ? 60 : 25)) stale.Add(kv.Key);
            foreach (int k in stale) threats.Remove(k);
        }

        public void Remember(double t, string text, string place = "", double weight = 1)
        {
            episodes.Add((t, text, place, weight));
            if (episodes.Count > 40) episodes.RemoveAt(0);
        }

        /// <summary>A new survivor finds the previous one's journal.</summary>
        public void InheritFrom(Memory other)
        {
            for (int i = 0; i < places.Length && i < other.places.Length; i++)
            {
                places[i].known = other.places[i].known;
                places[i].visits = other.places[i].visits;
                places[i].lastVisit = other.places[i].lastVisit;
                places[i].lastYield = other.places[i].lastYield;
            }
            for (int j = 0; j < DN; j++) for (int i = 0; i < DN; i++) danger[j, i] = other.danger[j, i] * .5f;
        }
    }
}

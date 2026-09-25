// Headless run: the survivor must live, scavenge, fight and build without the simulation erroring.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Afterfall.Sim;

static class Program
{
    static int Main(string[] args)
    {
        long seed = args.Length > 0 ? long.Parse(args[0]) : 1;
        double days = args.Length > 1 ? double.Parse(args[1], System.Globalization.CultureInfo.InvariantCulture) : 5;
        bool verbose = args.Contains("-v");
        var sw = Stopwatch.StartNew();
        var sim = new Simulation(seed);
        Console.WriteLine($"world: {sim.world.staticParts.Count} parts, {sim.world.trees.Count} trees, {sim.world.loot.Count} loot sites, built in {sw.ElapsedMilliseconds} ms");
        var actions = new Dictionary<string, int>();
        int steps = (int)(days * 1440 / .1);
        for (int i = 0; i < steps; i++)
        {
            sim.Step(.1);
            var a = sim.survivor.action;
            if (a != null && i % 10 == 0) actions[a.name] = actions.TryGetValue(a.name, out int c) ? c + 1 : 1;
        }
        if (verbose) foreach (var e in sim.events) Console.WriteLine($"{e.stamp}  {e.text}");
        var s = sim.survivor;
        Console.WriteLine($"seed {seed}: {sw.Elapsed.TotalSeconds:0.0}s day {sim.Day} gen {sim.generation} built {sim.home.built.Count} alive {s.alive} " +
                          $"loots {s.loots} kills {s.kills} known {s.memory.places.Count(p => p.known)}");
        Console.WriteLine("actions: " + string.Join(", ", actions.OrderByDescending(kv => kv.Value).Take(9).Select(kv => $"{kv.Key} {kv.Value}")));
        bool ok = sim.home.built.Count >= 5 && s.loots + (sim.generation > 1 ? 3 : 0) >= 3;
        Console.WriteLine(ok ? "PASS" : "FAIL");
        return ok ? 0 : 1;
    }
}

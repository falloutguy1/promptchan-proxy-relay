// On-screen interface (IMGUI, so it needs no UI assets): survivor card, the AI's reasoning, event log,
// pack, homestead progress, minimap, floating text and the name tag.
using System.Collections.Generic;
using System.Linq;
using Afterfall.Sim;
using UnityEngine;
using static Afterfall.Sim.Config;

namespace Afterfall.Game
{
    public sealed class Hud
    {
        static readonly Color Ink = new Color(.914f, .894f, .839f), Dim = new Color(.66f, .64f, .57f), Faint = new Color(.5f, .48f, .44f);
        static readonly Color Accent = new Color(.79f, .64f, .29f), Panel = new Color(.055f, .063f, .05f, .72f), BarBg = new Color(1, 1, 1, .09f);
        static readonly (string label, System.Func<Survivor, double> get, Color col)[] Bars =
        {
            ("HEALTH", s => s.health, new Color(.75f, .22f, .17f)), ("FOOD", s => s.food, new Color(.79f, .55f, .24f)),
            ("WATER", s => s.water, new Color(.44f, .64f, .72f)), ("ENERGY", s => s.energy, new Color(.83f, .8f, .68f)),
            ("WARMTH", s => s.warmth, new Color(.85f, .44f, .23f)), ("MORALE", s => s.morale, new Color(.5f, .55f, .34f)),
            ("STRESS", s => s.stress, new Color(.62f, .36f, .55f)),
        };

        static Color Kind(string kind) => kind switch
        {
            "bad" => new Color(.95f, .62f, .57f), "good" => new Color(.85f, .88f, .71f), "build" => new Color(.92f, .82f, .56f),
            "journal" => new Color(.75f, .8f, .9f), "gold" => Accent, _ => Ink,
        };

        readonly Simulation sim;
        readonly Texture2D white, map;
        GUIStyle label;
        public bool visible = true;
        readonly List<(Vector3 pos, string text, string kind, float age, float delay)> floaters = new List<(Vector3, string, string, float, float)>();
        float t;

        public Hud(Simulation sim)
        {
            this.sim = sim;
            white = Texture2D.whiteTexture;
            map = MapTexture(sim.world);
        }

        static Texture2D MapTexture(World w)
        {
            const int R = 256;
            var tex = new Texture2D(R, R, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var px = new Color[R * R];
            for (int j = 0; j < R; j++)
                for (int i = 0; i < R; i++)
                {
                    int gi = i * HN / (R - 1), gj = j * HN / (R - 1);
                    double x = -HALF + WORLD * i / (R - 1), y = -HALF + WORLD * j / (R - 1);
                    var c = new Color(w.colors[gj, gi, 0], w.colors[gj, gi, 1], w.colors[gj, gi, 2]);
                    double shade = M.Clamp(1 + (w.h[gj, gi] - w.h[gj, System.Math.Max(0, gi - 1)]) * .08, .6, 1.4);
                    c *= (float)shade;
                    if (w.rd[gj, gi] < 0) c *= .5f;
                    if (w.h[gj, gi] < w.waterZ && M.Hypot(x - w.pond.x, y - w.pond.y) < w.pond.r + 16) c = new Color(.18f, .27f, .32f);
                    c.a = 1;
                    px[j * R + i] = c;   // row 0 = south: Unity textures start at the bottom
                }
            foreach (var o in w.obstacles)
            {
                if (o.ex <= 1.3) continue;
                int ci = (int)((o.cx + HALF) / WORLD * (R - 1)), cj = (int)((o.cy + HALF) / WORLD * (R - 1));
                for (int dj = -1; dj <= 1; dj++)
                    for (int di = -1; di <= 1; di++)
                    {
                        int ii = ci + di, jj = cj + dj;
                        if (ii >= 0 && ii < R && jj >= 0 && jj < R) px[jj * R + ii] = new Color(.86f, .83f, .74f);
                    }
            }
            tex.SetPixels(px);
            tex.Apply();
            return tex;
        }

        public void Float(Vector3 pos, string text, string kind, float delay) => floaters.Add((pos, text, kind, 0, delay));

        public void Tick(float dt)
        {
            t += dt;
            for (int i = floaters.Count - 1; i >= 0; i--)
            {
                var f = floaters[i];
                if (f.delay > 0) { floaters[i] = (f.pos, f.text, f.kind, f.age, f.delay - dt); continue; }
                if (f.age + dt > 2.6f) floaters.RemoveAt(i);
                else floaters[i] = (f.pos, f.text, f.kind, f.age + dt, 0);
            }
        }

        void Rect(Rect r, Color c)
        {
            var old = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, white);
            GUI.color = old;
        }

        void Text(float x, float y, string s, Color c, int size = 13, FontStyle style = FontStyle.Normal, float w = 600, TextAnchor anchor = TextAnchor.UpperLeft)
        {
            label.fontSize = size;
            label.fontStyle = style;
            label.alignment = anchor;
            label.normal.textColor = c;
            GUI.Label(new Rect(x, y, w, size * 1.6f + 2), s, label);
        }

        public void Draw(Camera cam, CameraDirector director, float speed, bool paused, Vector3 survivorHead)
        {
            if (label == null) label = new GUIStyle(GUI.skin.label) { wordWrap = false, richText = false };
            var s = sim.survivor;
            float W = Screen.width, H = Screen.height, k = Mathf.Clamp(H / 900f, .75f, 2f);
            var old = GUI.matrix;
            GUI.matrix = Matrix4x4.Scale(new Vector3(k, k, 1));
            W /= k; H /= k;

            float hurt = (s.hurtT > 0 ? .45f : 0) + (s.health < 30 && s.alive ? .12f + .08f * Mathf.Sin(t * 4) : 0);
            if (hurt > 0) Rect(new Rect(0, 0, W, H), new Color(.6f, .03f, .02f, hurt * .6f));

            // floating text and name tag (world space)
            foreach (var f in floaters)
            {
                if (f.delay > 0) continue;
                var sp = cam.WorldToScreenPoint(f.pos + Vector3.up * f.age * .5f);
                if (sp.z <= 0) continue;
                var c = Kind(f.kind);
                c.a = 1 - Mathf.Max(0, (f.age - 1.6f) / 1f);
                Text(sp.x / k - 100, (Screen.height - sp.y) / k - 10, f.text, c, 15, FontStyle.Bold, 200, TextAnchor.MiddleCenter);
            }
            if (!visible) { GUI.matrix = old; return; }
            var tag = cam.WorldToScreenPoint(survivorHead + Vector3.up * .5f);
            if (tag.z > 9 && director.mode != CameraDirector.Mode.Chase)
                Text(tag.x / k - 100, (Screen.height - tag.y) / k - 10, s.firstName.ToUpperInvariant(), Accent, 12, FontStyle.Bold, 200, TextAnchor.MiddleCenter);

            // survivor card
            float L = 16, T = 14;
            Rect(new Rect(L, T, 420, 356), Panel);
            Text(L + 16, T + 8, s.name.ToUpperInvariant(), Ink, 26);
            Text(L + 300, T + 16, $"GEN {sim.generation}", Accent, 14);
            Text(L + 16, T + 46, $"DAY {sim.Day}   {sim.Clock()}   {sim.WeatherLabel}   {sim.temp:0}°C", Dim, 15);
            Text(L + 16, T + 68, string.Join("  ", s.traits.OrderByDescending(kv => kv.Value).Take(4).Select(kv => $"{char.ToUpperInvariant(kv.Key[0])}{kv.Key.Substring(1)} {kv.Value * 10:0}")), Faint, 13);
            for (int i = 0; i < Bars.Length; i++)
            {
                float y = T + 98 + i * 24;
                double v = M.Clamp(Bars[i].get(s), 0, 100);
                Text(L + 16, y - 4, Bars[i].label, Dim, 13);
                Rect(new Rect(L + 90, y + 4, 250, 6), BarBg);
                Rect(new Rect(L + 90, y + 4, 250 * (float)v / 100, 6), Bars[i].col);
                Text(L + 350, y - 4, $"{v:0}", Ink, 13);
            }
            var chips = new List<string>();
            if (!s.alive) chips.Add("DEAD");
            else
            {
                if (s.bleeding) chips.Add("BLEEDING");
                if (s.food < 25) chips.Add("HUNGRY");
                if (s.water < 25) chips.Add("THIRSTY");
                if (s.energy < 20) chips.Add("EXHAUSTED");
                if (s.warmth < 30) chips.Add("COLD");
                if (s.memory.threats.Values.Any(th => th.aware)) chips.Add("HUNTED");
                if (sim.home.WallsClosed && sim.home.Inside(s.x, s.y)) chips.Add("BEHIND WALLS");
            }
            Text(L + 16, T + 272, string.Join("  ·  ", chips), Accent, 13);
            label.wordWrap = true;
            Text(L + 16, T + 294, string.IsNullOrEmpty(s.thought) ? "" : $"“{s.thought}”", Ink, 15, FontStyle.Normal, 390);
            label.wordWrap = false;

            // the mind
            float R = W - 16, mx = R - 440, my = T + 300;
            Rect(new Rect(mx, my, 440, 330), Panel);
            var a = s.action;
            Text(mx + 14, my + 8, "MIND", Dim, 14);
            Text(mx + 70, my + 8, (a != null && !a.done ? a.name.ToUpperInvariant() : "—") + (a?.progress != null ? $"  {a.progress * 100:0}%" : ""), Accent, 14);
            for (int i = 0; i < 7 && i < s.scores.Count; i++)
            {
                var (n, sc, d) = s.scores[i];
                float y = my + 40 + i * 38;
                bool current = a != null && a.name == n && i == 0;
                Text(mx + 14, y, n, current ? Accent : Ink, 14);
                Rect(new Rect(mx + 230, y + 8, 100, 5), BarBg);
                Rect(new Rect(mx + 230, y + 8, 100 * (float)sc, 5), Accent);
                Text(mx + 340, y, $"{sc:0.00}", Dim, 13);
                Text(mx + 14, y + 17, d.Length > 64 ? d.Substring(0, 64) : d, Faint, 11);
            }
            var mem = s.memory;
            int hot = 0;
            foreach (var v in mem.danger) if (v > 1) hot++;
            Text(mx + 14, my + 308, $"Knows {mem.places.Count(p => p.known)}/{mem.places.Length} places · {hot} danger zones · {mem.threats.Count} infected tracked", Faint, 11, FontStyle.Normal, 420);

            // minimap
            float ms = 260, mapX = R - ms, mapY = T + 4;
            Rect(new Rect(mapX - 8, mapY - 6, ms + 16, ms + 12), Panel);
            GUI.DrawTexture(new Rect(mapX, mapY, ms, ms), map);
            Vector2 MP(double x, double y) => new Vector2(mapX + (float)((x + HALF) / WORLD) * ms, mapY + (1 - (float)((y + HALF) / WORLD)) * ms);
            var hp = MP(sim.home.baseSite.x, sim.home.baseSite.y);
            float ring = ms * 17.5f * 2 / (float)WORLD;
            Rect(new Rect(hp.x - ring / 2, hp.y - ring / 2, ring, ring), new Color(Accent.r, Accent.g, Accent.b, .25f));
            foreach (var z in sim.zombies)
            {
                if (!z.alive) continue;
                var p = MP(z.x, z.y);
                Rect(new Rect(p.x - 2, p.y - 2, 4, 4), z.state == "chase" || z.state == "attack" ? new Color(1, .35f, .27f) : new Color(.7f, .22f, .18f));
            }
            foreach (var g in sim.graves)
            {
                var p = MP(g.x, g.y);
                Rect(new Rect(p.x - 1, p.y - 4, 2, 8), Ink);
            }
            var me = MP(s.x, s.y);
            Rect(new Rect(me.x - 4, me.y - 4, 8, 8), Accent);

            // log
            float B = H - 14;
            Rect(new Rect(L, B - 176, 600, 176), Panel);
            int n0 = System.Math.Max(0, sim.events.Count - 6);
            for (int i = n0; i < sim.events.Count; i++)
            {
                var e = sim.events[i];
                float y = B - 168 + (i - n0) * 27;
                Text(L + 14, y, e.stamp, Faint, 12);
                Text(L + 92, y, e.text.Length > 80 ? e.text.Substring(0, 80) : e.text, Kind(e.kind), 13, FontStyle.Normal, 500);
            }

            // pack and homestead
            Rect(new Rect(mx, B - 176, 440, 176), Panel);
            var inv = s.inv;
            Text(mx + 14, B - 168, "PACK", Dim, 14);
            Text(mx + 150, B - 168, inv["rifle"] > 0 && inv["axe"] > 0 ? "RIFLE + AXE" : inv["rifle"] > 0 ? "RIFLE" : inv["axe"] > 0 ? "AXE" : "BARE HANDS", Accent, 14);
            Text(mx + 14, B - 142, $"Food {inv["food"]}   Water {inv["water"]}   Wood {inv["wood"]}   Scrap {inv["scrap"]}", Ink, 13);
            Text(mx + 14, B - 122, $"Nails {inv["nails"]}   Ammo {inv["ammo"]}   Bandages {inv["bandage"]}   Med kits {inv["medkit"]}", Ink, 13);
            Text(mx + 14, B - 90, "HOMESTEAD", Dim, 14);
            var home = sim.home;
            var next = home.projects.FirstOrDefault(p => !home.built.Contains(p.key));
            string cost = next != null ? string.Join(", ", next.cost.Select(kv => $"{kv.Value} {kv.Key}")) : "";
            Text(mx + 14, B - 64, $"{home.built.Count}/{home.projects.Count} built" + (next != null ? $"   Next: {next.name} ({cost})" : "   Complete"), Ink, 13, FontStyle.Normal, 420);
            Rect(new Rect(mx + 14, B - 30, 410, 6), BarBg);
            Rect(new Rect(mx + 14, B - 30, 410f * home.built.Count / home.projects.Count, 6), Accent);

            Text(W / 2 - 300, T, $"{director.Label}   ·   {(paused ? "PAUSED" : $"{speed:0.#}×")}", Ink, 15, FontStyle.Normal, 600, TextAnchor.UpperCenter);
            Text(W / 2 - 400, H - 26, "1-4 cameras · right-drag to orbit · scroll zoom · space pause · [ ] speed · H hide HUD", Dim, 12, FontStyle.Normal, 800, TextAnchor.UpperCenter);
            GUI.matrix = old;
        }
    }
}

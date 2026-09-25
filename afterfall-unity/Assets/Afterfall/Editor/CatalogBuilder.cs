// Turns the downloaded files into project assets and writes the catalogue the game reads at runtime
// (Assets/Afterfall/Resources/AfterfallAssets.asset). Also builds HDRP mask maps (metallic, AO, detail,
// smoothness) from the scans' AO/roughness/metal maps, and grimed, bloodied albedos for the infected.
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Afterfall.Game;
using Afterfall.Sim;
using UnityEditor;
using UnityEngine;

namespace Afterfall.EditorTools
{
    public static class CatalogBuilder
    {
        const string Surfaces = AssetFetcher.ThirdParty + "/Surfaces";
        const string Chars = AssetFetcher.ThirdParty + "/Characters";
        const string Generated = "Assets/Afterfall/Generated";
        const string CatalogPath = "Assets/Afterfall/Resources/AfterfallAssets.asset";

        static string Full(string assetPath) => Path.Combine(Path.GetDirectoryName(Application.dataPath), assetPath);

        [MenuItem("Afterfall/Rebuild Asset Catalogue", priority = 2)]
        public static void Build()
        {
            try
            {
                EditorUtility.DisplayProgressBar("Afterfall", "Preparing scanned materials", .1f);
                var surfaceMeta = PrepareSurfaces();
                EditorUtility.DisplayProgressBar("Afterfall", "Preparing character textures", .4f);
                PrepareCharacterTextures();
                AssetDatabase.Refresh();
                EditorUtility.DisplayProgressBar("Afterfall", "Writing the catalogue", .8f);
                WriteCatalogue(surfaceMeta);
            }
            finally { EditorUtility.ClearProgressBar(); }
        }

        // --- surfaces ----------------------------------------------------------------------------------

        static Dictionary<string, (float size, Color mean)> PrepareSurfaces()
        {
            var meta = new Dictionary<string, (float, Color)>();
            string src = Path.Combine(AssetFetcher.Downloads, "polyhaven");
            if (!Directory.Exists(src)) return meta;
            Directory.CreateDirectory(Full(Surfaces));
            foreach (var (key, id) in Catalog.TEXTURES)
            {
                string diff = Path.Combine(src, id + "_diff.jpg"), nor = Path.Combine(src, id + "_nor.jpg"), arm = Path.Combine(src, id + "_arm.jpg");
                if (!File.Exists(diff)) continue;
                float size = 2;
                var info = Path.Combine(src, id + ".json");
                if (File.Exists(info))
                {
                    var m = Regex.Match(File.ReadAllText(info), "\"dimensions\"\\s*:\\s*\\[\\s*([0-9.]+)");
                    if (m.Success) size = float.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) / 1000f;
                }
                var albedoTex = Load(diff);
                meta[key] = (Mathf.Max(.5f, size), Mean(albedoTex));
                Object.DestroyImmediate(albedoTex);
                string albedoOut = Full($"{Surfaces}/{key}_albedo.jpg"), normalOut = Full($"{Surfaces}/{key}_normal.jpg"), maskOut = Full($"{Surfaces}/{key}_mask.png");
                if (!File.Exists(albedoOut)) File.Copy(diff, albedoOut);
                if (!File.Exists(normalOut) && File.Exists(nor)) File.Copy(nor, normalOut);
                if (!File.Exists(maskOut) && File.Exists(arm))
                {
                    var t = Load(arm);
                    File.WriteAllBytes(maskOut, MaskFrom(t, ao: 0, rough: 1, metal: 2).EncodeToPNG());
                }
            }
            return meta;
        }

        static Texture2D Load(string path)
        {
            var t = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            t.LoadImage(File.ReadAllBytes(path));
            while (t.width > 2048) t = Half(t);
            return t;
        }

        static Texture2D Half(Texture2D t)
        {
            int w = t.width / 2, h = t.height / 2;
            var src = t.GetPixels32();
            var dst = new Color32[w * h];
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    int a = (y * 2) * t.width + x * 2, b = a + t.width;
                    Color32 p = src[a], q = src[a + 1], r = src[b], s = src[b + 1];
                    dst[y * w + x] = new Color32((byte)((p.r + q.r + r.r + s.r) / 4), (byte)((p.g + q.g + r.g + s.g) / 4),
                                                 (byte)((p.b + q.b + r.b + s.b) / 4), (byte)((p.a + q.a + r.a + s.a) / 4));
                }
            var o = new Texture2D(w, h, TextureFormat.RGBA32, false);
            o.SetPixels32(dst);
            o.Apply();
            Object.DestroyImmediate(t);
            return o;
        }

        static Color Mean(Texture2D t)
        {
            var px = t.GetPixels32();
            double r = 0, g = 0, b = 0;
            int n = 0;
            for (int i = 0; i < px.Length; i += 7) { r += px[i].r; g += px[i].g; b += px[i].b; n++; }
            return new Color((float)(r / n / 255), (float)(g / n / 255), (float)(b / n / 255));
        }

        /// <summary>HDRP mask map: R metallic, G ambient occlusion, B detail mask, A smoothness. Channel indices
        /// say where AO, roughness and metal are in the source (-1: absent).</summary>
        static Texture2D MaskFrom(Texture2D src, int ao, int rough, int metal)
        {
            var px = src.GetPixels32();
            var o = new Color32[px.Length];
            byte C(Color32 c, int i) => i == 0 ? c.r : i == 1 ? c.g : c.b;
            for (int i = 0; i < px.Length; i++)
            {
                var c = px[i];
                o[i] = new Color32(metal >= 0 ? C(c, metal) : (byte)0, ao >= 0 ? C(c, ao) : (byte)255, 0, (byte)(255 - C(c, rough)));
            }
            var t = new Texture2D(src.width, src.height, TextureFormat.RGBA32, false);
            t.SetPixels32(o);
            t.Apply();
            return t;
        }

        // --- characters --------------------------------------------------------------------------------

        static void PrepareCharacterTextures()
        {
            string dir = Full(Chars + "/Textures");
            if (!Directory.Exists(dir)) return;
            void Mask(string src, string dst, int ao, int rough, int metal)
            {
                string s = Path.Combine(dir, src), d = Path.Combine(dir, dst);
                if (!File.Exists(s) || File.Exists(d)) return;
                File.WriteAllBytes(d, MaskFrom(Load(s), ao, rough, metal).EncodeToPNG());
            }
            Mask("T_Ranger_ORM.png", "T_Ranger_Mask.png", 0, 1, 2);
            Mask("T_Peasant_ORM.png", "T_Peasant_Mask.png", 0, 1, 2);
            foreach (var who in new[] { "Regular_Male", "Regular_Female", "Superhero_Male", "Superhero_Female" })
                Mask($"T_{who}_Roughness.png", $"T_{who}_Mask.png", -1, 0, -1);
            void Zombie(string src, string dst, bool skin)
            {
                string s = Path.Combine(dir, src), d = Path.Combine(dir, dst);
                if (!File.Exists(s) || File.Exists(d)) return;
                File.WriteAllBytes(d, Infect(Load(s), skin, dst.GetHashCode()).EncodeToPNG());
            }
            Zombie("T_Ranger_BaseColor.png", "T_Ranger_Zombie.png", false);
            Zombie("T_Peasant_BaseColor.png", "T_Peasant_Zombie.png", false);
            Zombie("T_Regular_Male_Dark_BaseColor.png", "T_Regular_Male_Zombie.png", true);
            Zombie("T_Regular_Female_Dark_BaseColor.png", "T_Regular_Female_Zombie.png", true);
            Zombie("T_Superhero_Male_Dark.png", "T_Superhero_Male_Zombie.png", true);
            Zombie("T_Superhero_Female_Dark_BaseColor.png", "T_Superhero_Female_Zombie.png", true);
        }

        static float Fbm(float x, float y)
        {
            return Mathf.PerlinNoise(x, y) * .55f + Mathf.PerlinNoise(x * 2.1f + 3.1f, y * 2.1f) * .3f + Mathf.PerlinNoise(x * 4.3f, y * 4.3f + 7.7f) * .15f;
        }

        /// <summary>Grime, desaturation and blood stains (and bruising on skin), painted in texture space.</summary>
        static Texture2D Infect(Texture2D src, bool skin, int seed)
        {
            float ox = (seed & 255) * .37f, oy = ((seed >> 8) & 255) * .41f;
            var px = src.GetPixels();
            int w = src.width, h = src.height;
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    float u = (float)x / w, v = (float)y / h;
                    var c = px[y * w + x];
                    float lum = c.r * .3f + c.g * .55f + c.b * .15f;
                    if (skin)
                    {
                        c = Color.Lerp(c, new Color(lum * .82f, lum * .9f, lum * .74f), .7f);
                        float bruise = Mathf.SmoothStep(.55f, .75f, Fbm(u * 14 + ox, v * 14 + oy));
                        c = Color.Lerp(c, new Color(.28f, .22f, .26f), bruise * .45f);
                    }
                    else
                    {
                        c = Color.Lerp(c, new Color(lum, lum, lum), .35f) * .85f;
                        float grime = Fbm(u * 6 + oy, v * 6 + ox);
                        c = Color.Lerp(c, new Color(.2f, .16f, .11f), grime * .35f);
                    }
                    float blood = Mathf.SmoothStep(.66f, .76f, Fbm(u * 9 + ox * 1.7f, v * 9 + oy * 1.3f));
                    c = Color.Lerp(c, new Color(.26f, .035f, .025f), blood * (skin ? .55f : .8f));
                    c.a = px[y * w + x].a;
                    px[y * w + x] = c;
                }
            var o = new Texture2D(w, h, TextureFormat.RGBA32, false);
            o.SetPixels(px);
            o.Apply();
            return o;
        }

        // --- catalogue ---------------------------------------------------------------------------------

        static Material Template(string file, string shader)
        {
            string path = $"{Generated}/{file}.mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m != null) return m;
            var sh = Shader.Find(shader);
            if (sh == null) { Debug.LogWarning($"Afterfall: shader {shader} not found (is this an HDRP project?)"); return null; }
            Directory.CreateDirectory(Full(Generated));
            m = new Material(sh);
            AssetDatabase.CreateAsset(m, path);
            return m;
        }

        static T Asset<T>(string path) where T : Object => AssetDatabase.LoadAssetAtPath<T>(path);

        static void WriteCatalogue(Dictionary<string, (float size, Color mean)> surfaceMeta)
        {
            Directory.CreateDirectory(Full("Assets/Afterfall/Resources"));
            var cat = Asset<AfterfallAssets>(CatalogPath);
            if (cat == null)
            {
                cat = ScriptableObject.CreateInstance<AfterfallAssets>();
                AssetDatabase.CreateAsset(cat, CatalogPath);
            }
            cat.litTemplate = Template("Lit", "HDRP/Lit");
            cat.terrainTemplate = Template("TerrainLit", "HDRP/TerrainLit");
            cat.unlitTemplate = Template("Unlit", "HDRP/Unlit");

            cat.surfaces.Clear();
            foreach (var (key, _) in Catalog.TEXTURES)
            {
                var albedo = Asset<Texture2D>($"{Surfaces}/{key}_albedo.jpg");
                if (albedo == null) continue;
                var old = surfaceMeta.TryGetValue(key, out var mm) ? mm : (2f, Color.gray);
                cat.surfaces.Add(new SurfaceEntry
                {
                    key = key, albedo = albedo, normal = Asset<Texture2D>($"{Surfaces}/{key}_normal.jpg"),
                    mask = Asset<Texture2D>($"{Surfaces}/{key}_mask.png"), sizeM = old.Item1, mean = old.Item2,
                });
            }

            cat.models.Clear();
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { Chars + "/Models" }))
            {
                string p = AssetDatabase.GUIDToAssetPath(guid);
                cat.models.Add(new NamedModel { name = Path.GetFileNameWithoutExtension(p), model = Asset<GameObject>(p) });
            }

            string T(string f) => $"{Chars}/Textures/{f}";
            TextureSet Set(string material, string albedo, string normal, string mask, string zombie, params string[] variants) => new TextureSet
            {
                material = material, albedo = Asset<Texture2D>(T(albedo)), normal = Asset<Texture2D>(T(normal)), mask = Asset<Texture2D>(T(mask)),
                zombieAlbedo = zombie != null ? Asset<Texture2D>(T(zombie)) : null,
                variants = variants.Select(v => Asset<Texture2D>(T(v))).Where(v => v != null).ToArray(),
            };
            cat.characterTextures = new List<TextureSet>
            {
                Set("MI_Ranger", "T_Ranger_BaseColor.png", "T_Ranger_Normal.png", "T_Ranger_Mask.png", "T_Ranger_Zombie.png", "T_Ranger_3_BaseColor.png"),
                Set("MI_Peasant", "T_Peasant_BaseColor.png", "T_Peasant_Normal.png", "T_Peasant_Mask.png", "T_Peasant_Zombie.png", "T_Peasant_2_BaseColor.png"),
                Set("MI_Regular_Male", "T_Regular_Male_Dark_BaseColor.png", "T_Regular_Male_Normal.png", "T_Regular_Male_Mask.png", "T_Regular_Male_Zombie.png"),
                Set("MI_Regular_Female", "T_Regular_Female_Dark_BaseColor.png", "T_Regular_Female_Normal.png", "T_Regular_Female_Mask.png", "T_Regular_Female_Zombie.png"),
                Set("MI_Superhero_Male", "T_Superhero_Male_Dark.png", "T_Superhero_Male_Normal.png", "T_Superhero_Male_Mask.png", "T_Superhero_Male_Zombie.png"),
                Set("MI_Superhero_Female", "T_Superhero_Female_Dark_BaseColor.png", "T_Superhero_Female_Normal.png", "T_Superhero_Female_Mask.png", "T_Superhero_Female_Zombie.png"),
                Set("MI_Hair_1", "T_Hair_1_BaseColor.png", "T_Hair_1_Normal.png", null, null),
                Set("MI_Hair_2", "T_Hair_2_BaseColor.png", "T_Hair_2_Normal.png", null, null),
                Set("MI_Eyes", "T_Eye_Brown.png", "T_Eye_Normal.png", null, null),
            };

            cat.clips.Clear();
            foreach (var guid in AssetDatabase.FindAssets("t:Model", new[] { Chars + "/Animations" }))
                foreach (var clip in AssetDatabase.LoadAllAssetsAtPath(AssetDatabase.GUIDToAssetPath(guid)).OfType<AnimationClip>())
                    if (!clip.name.StartsWith("__preview__") && cat.clips.All(c => c.name != clip.name)) cat.clips.Add(clip);

            EditorUtility.SetDirty(cat);
            AssetDatabase.SaveAssets();
            Debug.Log($"Afterfall: catalogue has {cat.surfaces.Count} scanned materials, {cat.models.Count} character models, {cat.clips.Count} animation clips.");
        }
    }
}

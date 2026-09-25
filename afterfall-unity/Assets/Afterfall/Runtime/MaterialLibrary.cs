// HDRP/Lit materials for the world's palette: a scanned surface (albedo, normal, mask) tinted towards the
// palette colour, or a plain colour when the asset pack is missing. Rain makes everything wet: darker and
// glossier, which HDRP's screen-space reflections pick up on roads and roofs.
using System.Collections.Generic;
using Afterfall.Sim;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Afterfall.Game
{
    public sealed class MaterialLibrary
    {
        readonly AfterfallAssets assets;
        readonly Dictionary<(string, int), Material> cache = new Dictionary<(string, int), Material>();
        readonly List<(Material m, Color baseColor, float smooth)> wettable = new List<(Material, Color, float)>();
        float wet = -1;

        public MaterialLibrary(AfterfallAssets assets) { this.assets = assets; }

        public static Color Hex(int hex, float a = 1) => new Color(((hex >> 16) & 255) / 255f, ((hex >> 8) & 255) / 255f, (hex & 255) / 255f, a);

        public Material NewLit()
        {
            Material m = assets != null && assets.litTemplate != null ? new Material(assets.litTemplate) : new Material(Shader.Find("HDRP/Lit"));
            m.SetTexture("_BaseColorMap", null);
            m.SetTexture("_NormalMap", null);
            m.SetTexture("_MaskMap", null);
            return m;
        }

        public static void Validate(Material m) => HDMaterial.ValidateMaterial(m);

        /// <summary>Surface key (null for plain) plus palette colour.</summary>
        public Material Get(string key, int color)
        {
            if (cache.TryGetValue((key, color), out var mat)) return mat;
            var palette = Hex(color);
            var s = key != null ? assets?.Surface(key) : null;
            mat = NewLit();
            mat.name = (key ?? "plain") + "_" + color.ToString("x6");
            float smooth = .25f;
            if (s != null && s.albedo != null)
            {
                // tint so that the scan's average colour lands on the palette colour, by the catalogue's amount
                double real = Catalog.REAL_COLOR.TryGetValue(key, out double r) ? r : .3;
                var mean = s.mean;
                Color tint = new Color(
                    Mathf.Lerp(palette.r / Mathf.Max(mean.r, .02f), 1, (float)real),
                    Mathf.Lerp(palette.g / Mathf.Max(mean.g, .02f), 1, (float)real),
                    Mathf.Lerp(palette.b / Mathf.Max(mean.b, .02f), 1, (float)real), 1);
                mat.SetColor("_BaseColor", tint);
                mat.SetTexture("_BaseColorMap", s.albedo);
                if (s.normal != null) { mat.SetTexture("_NormalMap", s.normal); mat.SetFloat("_NormalScale", 1.2f); }
                if (s.mask != null)
                {
                    mat.SetTexture("_MaskMap", s.mask);
                    mat.SetFloat("_SmoothnessRemapMin", 0);
                    mat.SetFloat("_SmoothnessRemapMax", 1);
                    mat.SetFloat("_AORemapMin", .2f);
                    mat.SetFloat("_AORemapMax", 1);
                    smooth = 1;
                }
                // UVs are in metres; the texture repeats every sizeM metres
                float k = 1 / Mathf.Max(.3f, s.sizeM);
                mat.SetTextureScale("_BaseColorMap", new Vector2(k, k));
                if (key == "metal") mat.SetFloat("_Metallic", .35f);
            }
            else
            {
                mat.SetColor("_BaseColor", palette);
                smooth = color switch
                {
                    Pal.GLASS => .92f,
                    Pal.CHROME => .8f,
                    Pal.WATER => .95f,
                    Pal.TIRE => .35f,
                    _ => .22f,
                };
                if (color == Pal.CHROME) mat.SetFloat("_Metallic", .9f);
                mat.SetFloat("_Smoothness", smooth);
            }
            Validate(mat);
            cache[(key, color)] = mat;
            wettable.Add((mat, mat.GetColor("_BaseColor"), smooth));
            return mat;
        }

        public Material Emissive(Color color, float nits)
        {
            var m = NewLit();
            m.SetColor("_BaseColor", Color.black);
            HDMaterial.SetUseEmissiveIntensity(m, true);
            HDMaterial.SetEmissiveColor(m, color);
            HDMaterial.SetEmissiveIntensity(m, nits, EmissiveIntensityUnit.Nits);
            Validate(m);
            return m;
        }

        /// <summary>0 = dry, 1 = soaked.</summary>
        public void SetWetness(float w)
        {
            if (Mathf.Abs(w - wet) < .02f) return;
            wet = w;
            foreach (var (m, baseColor, smooth) in wettable)
            {
                m.SetColor("_BaseColor", baseColor * (1 - .28f * w));
                if (m.GetTexture("_MaskMap") != null) m.SetFloat("_SmoothnessRemapMin", Mathf.Lerp(0, .55f, w));
                else m.SetFloat("_Smoothness", Mathf.Lerp(smooth, Mathf.Max(smooth, .8f), w * .8f));
            }
        }
    }
}

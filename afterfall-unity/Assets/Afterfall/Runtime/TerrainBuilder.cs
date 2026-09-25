// Unity Terrain from the simulated height field: scanned ground layers splatted by slope, forest, water
// and roads (asphalt and dirt painted into the splat map), plus instanced grass.
using Afterfall.Sim;
using UnityEngine;
using static Afterfall.Sim.Config;

namespace Afterfall.Game
{
    public static class TerrainBuilder
    {
        const int HEIGHT_RES = 513, SPLAT_RES = 1024, DETAIL_RES = 1024;

        // layer order in the splat map
        const int GRASS = 0, DRY = 1, FOREST = 2, MUD = 3, ROCK = 4, ASPHALT = 5, TRACK = 6;

        public static Terrain Build(World w, AfterfallAssets assets, MaterialLibrary lib, Transform parent, bool grass)
        {
            double lo = double.MaxValue, hi = double.MinValue;
            foreach (var v in w.h) { lo = System.Math.Min(lo, v); hi = System.Math.Max(hi, v); }
            float range = (float)(hi - lo) + 1;
            var data = new TerrainData { heightmapResolution = HEIGHT_RES };
            data.size = new Vector3((float)WORLD, range, (float)WORLD);
            var heights = new float[HEIGHT_RES, HEIGHT_RES];
            for (int j = 0; j < HEIGHT_RES; j++)
                for (int i = 0; i < HEIGHT_RES; i++)
                {
                    double x = -HALF + WORLD * i / (HEIGHT_RES - 1), y = -HALF + WORLD * j / (HEIGHT_RES - 1);
                    heights[j, i] = (float)((w.GroundZ(x, y) - lo) / range);
                }
            data.SetHeights(0, 0, heights);

            data.terrainLayers = Layers(assets);
            data.alphamapResolution = SPLAT_RES;
            var alpha = new float[SPLAT_RES, SPLAT_RES, 7];
            for (int j = 0; j < SPLAT_RES; j++)
                for (int i = 0; i < SPLAT_RES; i++)
                {
                    double x = -HALF + WORLD * (i + .5) / SPLAT_RES, y = -HALF + WORLD * (j + .5) / SPLAT_RES;
                    var sp = SampleSplat(w, x, y);
                    double dry = M.Smooth(.2, .6, w.noise.Fbm(x * .06 + 50, y * .06, 2)) * .8;
                    double wv = sp[0];
                    alpha[j, i, GRASS] = (float)(wv * (1 - dry));
                    alpha[j, i, DRY] = (float)(wv * dry);
                    alpha[j, i, FOREST] = (float)sp[1];
                    alpha[j, i, MUD] = (float)sp[2];
                    alpha[j, i, ROCK] = (float)sp[3];
                    // roads: sharp edge on asphalt, soft ruts on dirt tracks
                    double rd = RoadDist(w, x, y);
                    double onRoad = 1 - M.Smooth(-.4, .6, rd);
                    if (onRoad > 0)
                    {
                        bool asphalt = NearestRoadIsAsphalt(w, x, y);
                        for (int k = 0; k < 7; k++) alpha[j, i, k] *= (float)(1 - onRoad);
                        alpha[j, i, asphalt ? ASPHALT : TRACK] += (float)onRoad;
                    }
                }
            data.SetAlphamaps(0, 0, alpha);

            var go = Terrain.CreateTerrainGameObject(data);
            go.name = "Terrain";
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3((float)-HALF, (float)lo, (float)-HALF);
            var terrain = go.GetComponent<Terrain>();
            if (assets != null && assets.terrainTemplate != null) terrain.materialTemplate = assets.terrainTemplate;
            else terrain.materialTemplate = new Material(Shader.Find("HDRP/TerrainLit"));
            terrain.heightmapPixelError = 3;
            terrain.basemapDistance = 180;
            terrain.drawInstanced = true;
            if (grass) Grass(w, data, terrain, lib);
            return terrain;
        }

        static double[] SampleSplat(World w, double x, double y)
        {
            double fx = M.Clamp((x + HALF) / HCELL, 0, HN - 1e-3), fy = M.Clamp((y + HALF) / HCELL, 0, HN - 1e-3);
            int i = (int)fx, j = (int)fy;
            double tx = fx - i, ty = fy - j;
            var r = new double[4];
            for (int k = 0; k < 4; k++)
                r[k] = (w.splat[j, i, k] * (1 - tx) + w.splat[j, i + 1, k] * tx) * (1 - ty) + (w.splat[j + 1, i, k] * (1 - tx) + w.splat[j + 1, i + 1, k] * tx) * ty;
            return r;
        }

        static double RoadDist(World w, double x, double y)
        {
            double fx = M.Clamp((x + HALF) / HCELL, 0, HN - 1e-3), fy = M.Clamp((y + HALF) / HCELL, 0, HN - 1e-3);
            int i = (int)fx, j = (int)fy;
            double tx = fx - i, ty = fy - j;
            return (w.rd[j, i] * (1 - tx) + w.rd[j, i + 1] * tx) * (1 - ty) + (w.rd[j + 1, i] * (1 - tx) + w.rd[j + 1, i + 1] * tx) * ty;
        }

        static bool NearestRoadIsAsphalt(World w, double x, double y)
        {
            double best = double.MaxValue;
            bool asphalt = false;
            foreach (var road in w.roads)
                for (int k = 0; k < road.samples.Length; k += 2)
                {
                    double d = M.Hypot(road.samples[k].x - x, road.samples[k].y - y) - road.w / 2;
                    if (d < best) { best = d; asphalt = road.asphalt; }
                }
            return asphalt;
        }

        static TerrainLayer[] Layers(AfterfallAssets assets)
        {
            TerrainLayer L(string key, int fallback, Color remap)
            {
                var s = assets?.Surface(key);
                var layer = new TerrainLayer();
                if (s != null && s.albedo != null)
                {
                    layer.diffuseTexture = s.albedo;
                    layer.normalMapTexture = s.normal;
                    layer.maskMapTexture = s.mask;
                    layer.normalScale = 1;
                    layer.tileSize = new Vector2(s.sizeM, s.sizeM);
                    layer.diffuseRemapMax = new Vector4(remap.r, remap.g, remap.b, 1);
                    if (s.mask != null)
                    {
                        layer.maskMapRemapMin = Vector4.zero;
                        layer.maskMapRemapMax = Vector4.one;
                    }
                }
                else
                {
                    var tex = new Texture2D(4, 4);
                    var c = MaterialLibrary.Hex(fallback);
                    var px = new Color[16];
                    for (int i = 0; i < 16; i++) px[i] = c * (0.92f + 0.08f * (i % 3));
                    tex.SetPixels(px);
                    tex.Apply();
                    layer.diffuseTexture = tex;
                    layer.tileSize = new Vector2(2, 2);
                    layer.smoothness = .1f;
                }
                return layer;
            }
            return new[]
            {
                L("grass", 0x4f5a2c, new Color(.82f, .95f, .72f)),
                L("grass", 0x857a47, new Color(1.08f, 1.0f, .78f)),
                L("forest", 0x39401f, Color.white),
                L("mud", 0x3d3326, Color.white),
                L("rock", 0x6e6a61, Color.white),
                L("asphalt", Pal.ASPHALT, Color.white),
                L("forest", Pal.DIRT_ROAD, new Color(.95f, .85f, .75f)),
            };
        }

        // --- grass ---------------------------------------------------------------------------------

        static void Grass(World w, TerrainData data, Terrain terrain, MaterialLibrary lib)
        {
            var proto = new GameObject("GrassTuft");
            proto.SetActive(false);
            proto.transform.SetParent(terrain.transform, false);
            proto.AddComponent<MeshFilter>().sharedMesh = TuftMesh();
            var mat = lib.NewLit();
            mat.name = "Grass";
            mat.SetTexture("_BaseColorMap", BladeTexture());
            mat.SetColor("_BaseColor", new Color(.55f, .62f, .38f));
            mat.SetFloat("_Smoothness", .15f);
            mat.SetFloat("_DoubleSidedEnable", 1);
            mat.SetFloat("_DoubleSidedNormalMode", 1);
            mat.enableInstancing = true;
            UnityEngine.Rendering.HighDefinition.HDMaterial.SetAlphaClipping(mat, true);
            UnityEngine.Rendering.HighDefinition.HDMaterial.SetAlphaCutoff(mat, .45f);
            MaterialLibrary.Validate(mat);
            proto.AddComponent<MeshRenderer>().sharedMaterial = mat;

            data.detailPrototypes = new[]
            {
                new DetailPrototype
                {
                    prototype = proto, usePrototypeMesh = true, useInstancing = true, renderMode = DetailRenderMode.VertexLit,
                    minWidth = .7f, maxWidth = 1.3f, minHeight = .6f, maxHeight = 1.25f,
                    healthyColor = Color.white, dryColor = new Color(.85f, .8f, .6f), noiseSpread = .3f,
                },
            };
            data.SetDetailScatterMode(DetailScatterMode.InstanceCountMode);
            data.SetDetailResolution(DETAIL_RES, 32);
            var counts = new int[DETAIL_RES, DETAIL_RES];
            var rng = new Rng(w.seed + 5);
            for (int j = 0; j < DETAIL_RES; j++)
                for (int i = 0; i < DETAIL_RES; i++)
                {
                    double x = -HALF + WORLD * (i + .5) / DETAIL_RES, y = -HALF + WORLD * (j + .5) / DETAIL_RES;
                    if (RoadDist(w, x, y) < .8) continue;
                    var sp = SampleSplat(w, x, y);
                    double grassy = sp[0] + sp[1] * .35;
                    if (w.GroundZ(x, y) < w.waterZ + .3) continue;
                    double n = rng.Random();
                    counts[j, i] = grassy > .45 && n < grassy * .9 ? (n < grassy * .45 ? 2 : 1) : 0;
                }
            data.SetDetailLayer(0, 0, 0, counts);
            terrain.detailObjectDistance = 110;
            terrain.detailObjectDensity = 1;
        }

        static Mesh TuftMesh()
        {
            var v = new System.Collections.Generic.List<Vector3>();
            var n = new System.Collections.Generic.List<Vector3>();
            var uv = new System.Collections.Generic.List<Vector2>();
            var t = new System.Collections.Generic.List<int>();
            for (int k = 0; k < 3; k++)
            {
                float a = k * Mathf.PI / 3;
                var d = new Vector3(Mathf.Cos(a), 0, Mathf.Sin(a)) * .45f;
                int b = v.Count;
                v.Add(-d); v.Add(d); v.Add(d + Vector3.up * .55f); v.Add(-d + Vector3.up * .55f);
                for (int q = 0; q < 4; q++) n.Add(Vector3.up);
                uv.Add(new Vector2(0, 0)); uv.Add(new Vector2(1, 0)); uv.Add(new Vector2(1, 1)); uv.Add(new Vector2(0, 1));
                t.AddRange(new[] { b, b + 2, b + 1, b, b + 3, b + 2 });
            }
            var mesh = new Mesh { name = "tuft" };
            mesh.SetVertices(v); mesh.SetNormals(n); mesh.SetUVs(0, uv); mesh.SetTriangles(t, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>Procedural blades of grass with alpha, so no texture file is needed.</summary>
        static Texture2D BladeTexture()
        {
            const int S = 128;
            var tex = new Texture2D(S, S, TextureFormat.RGBA32, true) { wrapMode = TextureWrapMode.Clamp };
            var px = new Color[S * S];
            var rng = new Rng(77);
            for (int b = 0; b < 42; b++)
            {
                float x0 = (float)rng.Uniform(4, S - 4), h = (float)rng.Uniform(.45, 1) * S, lean = (float)rng.Uniform(-.35, .35);
                float wBase = (float)rng.Uniform(1.6, 3.2);
                var col = Color.Lerp(new Color(.36f, .45f, .2f), new Color(.62f, .6f, .32f), (float)rng.Random());
                for (int y = 0; y < (int)h; y++)
                {
                    float t = y / h, cx = x0 + lean * y * (1 + t), half = wBase * (1 - t);
                    for (int x = (int)(cx - half - 1); x <= (int)(cx + half + 1); x++)
                    {
                        if (x < 0 || x >= S) continue;
                        float cover = Mathf.Clamp01(half + .5f - Mathf.Abs(x - cx));
                        if (cover <= 0) continue;
                        var c = col * (.55f + .45f * t);
                        c.a = 1;
                        int idx = y * S + x;
                        px[idx] = px[idx].a > 0 ? Color.Lerp(px[idx], c, .5f) : c;
                        px[idx].a = Mathf.Max(px[idx].a, cover);
                    }
                }
            }
            tex.SetPixels(px);
            tex.Apply(true);
            return tex;
        }
    }
}

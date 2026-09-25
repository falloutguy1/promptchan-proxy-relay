// Builds the Unity scene for the simulated world and keeps its dynamic parts in sync: felled trees,
// homestead projects rising as they're built, the campfire and floodlight, blood, tracers.
using System.Collections.Generic;
using System.Linq;
using Afterfall.Sim;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;
using static Afterfall.Game.MeshBuilder;

namespace Afterfall.Game
{
    public sealed class WorldView
    {
        readonly Simulation sim;
        readonly World world;
        readonly Homestead home;
        readonly MaterialLibrary lib;
        readonly AfterfallAssets assets;
        public readonly Transform root;
        public Terrain terrain;
        Transform vegRoot, treeRoot, homeRoot;
        readonly Dictionary<(int, int), GameObject> treeChunks = new Dictionary<(int, int), GameObject>();
        readonly Dictionary<string, Transform> projects = new Dictionary<string, Transform>();
        int vegCount;
        Transform flames;
        readonly List<(Transform t, float s)> flameParts = new List<(Transform, float)>();
        readonly List<(Transform t, string garden)> plants = new List<(Transform, string)>();
        Light fireLight, floodLight;
        HDAdditionalLightData fireHd;
        Transform flag, radioLamp;
        Material radioLampMat;
        readonly List<(Transform t, float age)> decals = new List<(Transform, float)>();
        readonly List<(GameObject g, float age)> tracers = new List<(GameObject, float)>();
        readonly List<(Transform pivot, Vector3 dir, float t)> falling = new List<(Transform, Vector3, float)>();
        int fxSeen;
        Material bloodMat, tracerMat;

        public Vector3 FirePos { get; private set; }

        public WorldView(Simulation sim, MaterialLibrary lib, AfterfallAssets assets, bool grass)
        {
            this.sim = sim;
            world = sim.world;
            home = sim.home;
            this.lib = lib;
            this.assets = assets;
            root = new GameObject("World").transform;
            terrain = TerrainBuilder.Build(world, assets, lib, root, grass);
            Water();
            var stat = new GameObject("Static").transform;
            stat.SetParent(root, false);
            Chunked(world.staticParts, stat, false);
            vegRoot = new GameObject("Vegetation").transform;
            vegRoot.SetParent(root, false);
            RebuildVeg();
            treeRoot = new GameObject("Trees").transform;
            treeRoot.SetParent(root, false);
            foreach (var key in world.trees.Select(t => t.chunk).Distinct()) BuildTreeChunk(key);
            homeRoot = new GameObject("Homestead").transform;
            homeRoot.SetParent(root, false);
            FireProps();
            bloodMat = lib.NewLit();
            bloodMat.SetColor("_BaseColor", new Color(.2f, .015f, .01f));
            bloodMat.SetFloat("_Smoothness", .7f);
            MaterialLibrary.Validate(bloodMat);
            tracerMat = lib.Emissive(new Color(1, .85f, .55f), 4000);
        }

        public float Ground(double x, double y) => terrain != null ? terrain.SampleHeight(U(x, y, 0)) + terrain.transform.position.y : (float)world.GroundZ(x, y);

        void Water()
        {
            var (px, py, pr) = world.pond;
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            Object.Destroy(go.GetComponent<Collider>());
            go.name = "Pond";
            go.transform.SetParent(root, false);
            go.transform.position = U(px, py, world.waterZ);
            go.transform.localScale = new Vector3((float)(pr + 16) * 2, .01f, (float)(pr + 16) * 2);
            var m = lib.Get(null, Pal.WATER);
            go.GetComponent<MeshRenderer>().sharedMaterial = m;
        }

        void Chunked(List<Part> parts, Transform parent, bool low)
        {
            foreach (var g in parts.GroupBy(p => ((int)((p.pos.x + Config.HALF) / Config.CHUNK), (int)((p.pos.y + Config.HALF) / Config.CHUNK))))
                MeshBuilder.Create($"chunk{g.Key}", g.ToList(), lib, parent, low);
        }

        void RebuildVeg()
        {
            foreach (Transform c in vegRoot) Object.Destroy(c.gameObject);
            Chunked(world.vegParts, vegRoot, true);
            vegCount = world.vegParts.Count;
        }

        void BuildTreeChunk((int, int) key)
        {
            if (treeChunks.TryGetValue(key, out var old)) Object.Destroy(old);
            var parts = world.trees.Where(t => t.chunk == key && t.alive).SelectMany(t => t.parts).ToList();
            var go = MeshBuilder.Create($"trees{key}", parts, lib, treeRoot, true);
            if (go != null) treeChunks[key] = go;
            else treeChunks.Remove(key);
        }

        // --- homestead -------------------------------------------------------------------------------

        Transform ProjectNode(string key)
        {
            var p = home.byKey[key];
            var at = key.StartsWith("pal") ? new V2(home.baseSite.x, home.baseSite.y) : home.Pos(p.at);
            var pivotPos = U(at.x, at.y, world.GroundZ(at.x, at.y));
            var pivot = new GameObject("proj_" + key).transform;
            pivot.SetParent(homeRoot, false);
            pivot.position = pivotPos;
            // parts are in world space: build them relative to the pivot, which sits at the project's foot
            var go = MeshBuilder.Create(key, home.BuildParts(key), lib, pivot, false, true, pivotPos);
            if (go != null) go.transform.localPosition = Vector3.zero;
            return pivot;
        }

        Light AddLight(string name, LightType type, float range, Color color, bool shadows)
        {
            var go = new GameObject(name);
            go.transform.SetParent(homeRoot, false);
            var l = go.AddComponent<Light>();
            l.type = type;
            var hd = go.AddComponent<HDAdditionalLightData>();
            l.range = range;
            l.color = color;
            l.lightUnit = LightUnit.Lumen;
            l.shadows = shadows ? LightShadows.Soft : LightShadows.None;
            if (shadows) hd.SetShadowResolution(512);
            return l;
        }

        void FireProps()
        {
            var fp = home.FirePos;
            FirePos = U(fp.x, fp.y, world.GroundZ(fp.x, fp.y));
            flames = new GameObject("Flames").transform;
            flames.SetParent(homeRoot, false);
            flames.position = FirePos;
            var cols = new[] { (new Color(1, .7f, .28f), 1f), (new Color(1, .48f, .12f), .8f), (new Color(1, .88f, .54f), .55f) };
            for (int i = 0; i < cols.Length; i++)
            {
                var (c, s) = cols[i];
                var part = new Part { shape = Shape.Cone, m = Mat3.Identity, pos = new V3(0, 0, 0), color = 0 };
                var (mesh, _) = MeshBuilder.Build(new[] { part }, lib);
                var go = new GameObject("flame");
                go.transform.SetParent(flames, false);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                var r = go.AddComponent<MeshRenderer>();
                r.sharedMaterial = lib.Emissive(c, 9000 * s);
                r.shadowCastingMode = ShadowCastingMode.Off;
                go.transform.localPosition = new Vector3(Mathf.Cos(i * 2.1f) * .1f, .45f, Mathf.Sin(i * 2.1f) * .1f);
                flameParts.Add((go.transform, s));
            }
            fireLight = AddLight("FireLight", LightType.Point, 22, new Color(1, .55f, .25f), true);
            fireLight.transform.position = FirePos + Vector3.up * 1.1f;
            fireHd = fireLight.GetComponent<HDAdditionalLightData>();
            var leaf = MaterialLibrary.Hex(0x4f7a2e);
            foreach (var g in new[] { "garden1", "garden2" })
            {
                var at = home.Pos(home.byKey[g].at);
                float gz = (float)world.GroundZ(at.x, at.y);
                for (int r = 0; r < 4; r++)
                    for (int c = 0; c < 7; c++)
                    {
                        var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                        Object.Destroy(s.GetComponent<Collider>());
                        s.transform.SetParent(homeRoot, false);
                        s.transform.position = U(at.x - 1.8 + c * .6, at.y - 1.1 + r * .73, gz + .3);
                        s.GetComponent<MeshRenderer>().sharedMaterial = lib.Get("leaves", r % 2 == 1 ? 0x6b8a34 : 0x44602c);
                        s.transform.localScale = Vector3.one * .001f;
                        plants.Add((s.transform, g));
                    }
            }
            _ = leaf;
        }

        void UpdateHome()
        {
            var wanted = new HashSet<string>(home.built.Concat(home.progress.Keys));
            foreach (var key in wanted)
                if (!projects.ContainsKey(key)) projects[key] = ProjectNode(key);
            foreach (var key in projects.Keys.ToList())
            {
                if (!wanted.Contains(key))
                {
                    Object.Destroy(projects[key].gameObject);
                    projects.Remove(key);
                    continue;
                }
                float prog = home.built.Contains(key) ? 1 : (float)(home.progress.TryGetValue(key, out double v) ? v : 0);
                projects[key].localScale = new Vector3(1, Mathf.Max(.02f, prog * prog * (3 - 2 * prog)), 1);
            }
            if (home.breached.HasValue && projects.TryGetValue("pal" + home.breached.Value, out var broken)) broken.localScale = new Vector3(1, .25f, 1);
            float grow = .35f + .65f * Mathf.Min(1, home.gardenFood / 4f);
            foreach (var (t, g) in plants)
                t.localScale = home.built.Contains(g) ? new Vector3(.36f, .26f, .36f) * grow : Vector3.one * .001f;
            if (home.built.Contains("flag") && flag == null)
            {
                var at = home.Pos(home.byKey["flag"].at);
                flag = new GameObject("Flag").transform;
                flag.SetParent(homeRoot, false);
                flag.position = U(at.x, at.y, world.GroundZ(at.x, at.y) + 6.3);
                var cloth = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Object.Destroy(cloth.GetComponent<Collider>());
                cloth.transform.SetParent(flag, false);
                cloth.transform.localPosition = new Vector3(.9f, 0, 0);
                cloth.transform.localScale = new Vector3(1.8f, 1.1f, .03f);
                cloth.GetComponent<MeshRenderer>().sharedMaterial = lib.Get("fabric", 0xd8d1bd);
            }
            if (home.built.Contains("gen") && floodLight == null)
            {
                var at = home.Pos(home.byKey["gen"].at);
                floodLight = AddLight("Floodlight", LightType.Spot, 45, new Color(1, .95f, .85f), true);
                floodLight.spotAngle = 95;
                floodLight.transform.position = U(at.x + 1.6, at.y, world.GroundZ(at.x, at.y) + 5.9);
                floodLight.transform.rotation = Quaternion.LookRotation(U(home.baseSite.x, home.baseSite.y, 0) - U(at.x + 1.6, at.y, 0) + Vector3.down * 5);
            }
            if (home.built.Contains("radio") && radioLamp == null)
            {
                var at = home.Pos(home.byKey["radio"].at);
                var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                Object.Destroy(s.GetComponent<Collider>());
                radioLamp = s.transform;
                radioLamp.SetParent(homeRoot, false);
                radioLamp.position = U(at.x, at.y, world.GroundZ(at.x, at.y) + 15.2);
                radioLamp.localScale = Vector3.one * .25f;
                radioLampMat = lib.Emissive(new Color(1, .15f, .1f), 20000);
                s.GetComponent<MeshRenderer>().sharedMaterial = radioLampMat;
            }
            home.changed = false;
        }

        // --- per frame -----------------------------------------------------------------------------------

        public void Update(float t, float dt, float night)
        {
            if (home.changed || home.progress.Count > 0) UpdateHome();
            bool fireOn = home.built.Contains("fire") && home.fireFuel > 0;
            flames.gameObject.SetActive(fireOn);
            for (int i = 0; i < flameParts.Count; i++)
            {
                var (n, s) = flameParts[i];
                float f = .8f + .25f * Mathf.Sin(t * 11 + i * 2) * Mathf.Sin(t * 7.3f + i);
                n.localScale = new Vector3(.5f * s * (1 + .1f * Mathf.Sin(t * 9 + i)), .9f * s * f, .5f * s);
            }
            fireLight.enabled = fireOn;
            if (fireOn) fireLight.intensity = 5200 * (.8f + .2f * Mathf.Sin(t * 23) * Mathf.Sin(t * 7.3f));
            if (floodLight != null)
            {
                floodLight.enabled = night > .4f;
                floodLight.intensity = 9000;
            }
            if (flag != null) flag.localRotation = Quaternion.Euler(Mathf.Sin(t * 5) * 4, Mathf.Sin(t * 1.3f) * 25 + 40, 0);
            if (radioLamp != null) radioLamp.gameObject.SetActive(Mathf.Sin(t * 3) > .6f);
            foreach (var key in world.dirtyChunks) BuildTreeChunk(key);
            world.dirtyChunks.Clear();
            if (world.vegParts.Count != vegCount) RebuildVeg();
            Effects(dt);
        }

        void Effects(float dt)
        {
            for (int i = fxSeen; i < sim.fx.Count; i++)
            {
                var f = sim.fx[i];
                if (f.kind == "fell") StartFall(world.trees[f.tree], f.angle);
                else if (f.kind == "blood")
                {
                    var d = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                    Object.Destroy(d.GetComponent<Collider>());
                    d.transform.SetParent(root, false);
                    d.transform.position = new Vector3((float)f.x, Ground(f.x, f.y) + .02f, (float)f.y);
                    d.transform.localScale = new Vector3(1.3f, .01f, 1.3f) * Random.Range(.7f, 1.2f);
                    d.GetComponent<MeshRenderer>().sharedMaterial = bloodMat;
                    d.GetComponent<MeshRenderer>().shadowCastingMode = ShadowCastingMode.Off;
                    decals.Add((d.transform, 0));
                }
                else if (f.kind == "shot")
                {
                    var g = new GameObject("tracer");
                    g.transform.SetParent(root, false);
                    var lr = g.AddComponent<LineRenderer>();
                    lr.sharedMaterial = tracerMat;
                    lr.widthMultiplier = .03f;
                    lr.positionCount = 2;
                    lr.SetPosition(0, new Vector3((float)f.x, Ground(f.x, f.y) + 1.45f, (float)f.y));
                    lr.SetPosition(1, new Vector3((float)f.x2, Ground(f.x2, f.y2) + (f.hit ? 1.5f : 2.5f), (float)f.y2));
                    tracers.Add((g, 0));
                }
            }
            fxSeen = sim.fx.Count;
            if (sim.fx.Count > 400)
            {
                sim.fx.RemoveRange(0, sim.fx.Count - 100);
                fxSeen = sim.fx.Count;
            }
            for (int i = falling.Count - 1; i >= 0; i--)
            {
                var (pivot, axis, t0) = falling[i];
                float t = t0 + dt;
                float k = Mathf.Min(1, (t / 2.2f) * (t / 2.2f));
                pivot.localRotation = Quaternion.Slerp(Quaternion.identity, Quaternion.FromToRotation(Vector3.up, axis), k);
                if (t > 14) pivot.position += Vector3.down * dt * .3f;
                if (t > 22) { Object.Destroy(pivot.gameObject); falling.RemoveAt(i); }
                else falling[i] = (pivot, axis, t);
            }
            for (int i = decals.Count - 1; i >= 0; i--)
            {
                var (t, age) = decals[i];
                if (age + dt > 90) { Object.Destroy(t.gameObject); decals.RemoveAt(i); }
                else decals[i] = (t, age + dt);
            }
            for (int i = tracers.Count - 1; i >= 0; i--)
            {
                var (g, age) = tracers[i];
                if (age + dt > .15f) { Object.Destroy(g); tracers.RemoveAt(i); }
                else tracers[i] = (g, age + dt);
            }
        }

        void StartFall(Afterfall.Sim.Tree tree, double direction)
        {
            var basePos = U(tree.x, tree.y, world.GroundZ(tree.x, tree.y));
            var pivot = new GameObject("falling").transform;
            pivot.SetParent(root, false);
            pivot.position = basePos;
            var go = MeshBuilder.Create("tree", tree.parts, lib, pivot, true, true, basePos);
            if (go == null) { Object.Destroy(pivot.gameObject); return; }
            go.transform.localPosition = Vector3.zero;
            // falls away from the survivor (simulation angle -> Unity x/z)
            var d = new Vector3(Mathf.Cos((float)direction), .035f, Mathf.Sin((float)direction)).normalized;
            falling.Add((pivot, d, 0));
        }
    }
}

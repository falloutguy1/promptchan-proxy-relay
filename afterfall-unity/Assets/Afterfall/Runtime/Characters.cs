// Characters: Quaternius base heads, hair and outfits (CC0) assembled onto one humanoid skeleton, animated
// with the Universal Animation Library's motion-captured clips through the Playables API (no Animator
// Controller asset needed). Without the asset pack a simple stand-in body is used.
using System.Collections.Generic;
using System.Linq;
using Afterfall.Sim;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.Rendering;

namespace Afterfall.Game
{
    public interface IBody
    {
        Transform Root { get; }
        void Place(Vector3 pos, float heading);
        /// <summary>anim: the simulation's animation name; dt: simulation time step (0 when paused).</summary>
        void Animate(string anim, float speed, float dt, System.Action onHit);
        void ShowItems(string anim, bool axe, bool rifle);
        void Destroy();
    }

    public static class Looks
    {
        static readonly int[] SkinTones = { 0xc9a184, 0xb0806a, 0x8d5e44, 0xe0bca1 };
        static readonly int[] Hair = { 0x2a1d14, 0x4a3524, 0x7a5a32, 0x121110 };
        static readonly int[] Tops = { 0x5a4e3e, 0x3c4450, 0x6a6a60, 0x5b3c30, 0x3a4636, 0x7a6e56 };

        public static int Hash(string s)
        {
            unchecked
            {
                int h = (int)2166136261;
                foreach (char c in s) h = (h ^ c) * 16777619;
                return h & 0x7fffffff;
            }
        }

        public static Color Skin(int h) => MaterialLibrary.Hex(SkinTones[h % 4]);
        public static Color HairColor(int h) => MaterialLibrary.Hex(Hair[h / 4 % 4]);
        public static Color Top(int h) => MaterialLibrary.Hex(Tops[h % 6]);
    }

    public sealed class CharacterFactory
    {
        // name: (body, outfit, hair pieces, outfit meshes to drop)
        static readonly Dictionary<string, (string body, string outfit, string[] hair, string[] drop)> Variants = new Dictionary<string, (string, string, string[], string[])>
        {
            ["survivor_m"] = ("Male", "Male_Ranger", new[] { "Hair_Beard" }, new[] { "Pauldron" }),
            ["survivor_f"] = ("Female", "Female_Ranger", new string[0], new[] { "Pauldron" }),
            ["walker_m1"] = ("Male", "Male_Peasant", new[] { "Hair_SimpleParted" }, new string[0]),
            ["walker_m2"] = ("Male", "Male_Peasant", new[] { "Hair_Buzzed", "Hair_Beard" }, new string[0]),
            ["walker_m3"] = ("Male", "Male_Ranger", new[] { "Hair_Buzzed" }, new[] { "Pauldron", "Hood", "Bracer" }),
            ["walker_f1"] = ("Female", "Female_Peasant", new[] { "Hair_Long" }, new string[0]),
            ["walker_f2"] = ("Female", "Female_Peasant", new[] { "Hair_Buns" }, new string[0]),
            ["walker_f3"] = ("Female", "Female_Ranger", new[] { "Hair_BuzzedFemale" }, new[] { "Pauldron", "Hood", "Bracer" }),
        };
        static readonly string[] Walkers = Variants.Keys.Where(k => k.StartsWith("walker")).ToArray();

        readonly AfterfallAssets assets;
        readonly MaterialLibrary lib;
        readonly Transform parent;
        readonly Dictionary<Mesh, Mesh> headMeshes = new Dictionary<Mesh, Mesh>();
        readonly Dictionary<string, Material> mats = new Dictionary<string, Material>();
        public bool Realistic { get; }

        public CharacterFactory(AfterfallAssets assets, MaterialLibrary lib, Transform parent)
        {
            this.assets = assets;
            this.lib = lib;
            this.parent = parent;
            Realistic = assets != null && assets.HasCharacters;
        }

        public IBody Survivor(string name)
        {
            int h = Looks.Hash(name);
            bool female = Config.FEMALE_NAMES.Contains(name.Split(' ')[0]);
            if (!Realistic) return new StandInBody(parent, lib, Looks.Top(h), Looks.Skin(h), false);
            return new SkinnedBody(this, Assemble(female ? "survivor_f" : "survivor_m", h, false), h, false, true);
        }

        public IBody Walker(int seed)
        {
            if (!Realistic) return new StandInBody(parent, lib, Looks.Top(seed), new Color(.6f, .66f, .56f), true);
            return new SkinnedBody(this, Assemble(Walkers[seed % Walkers.Length], seed, true), seed, true, false);
        }

        internal AfterfallAssets Assets => assets;
        internal MaterialLibrary Lib => lib;

        GameObject Assemble(string variant, int look, bool zombie)
        {
            var (body, outfitName, hair, drop) = Variants[variant];
            var go = Object.Instantiate(assets.Model(outfitName), parent);
            go.name = variant;
            foreach (var r in go.GetComponentsInChildren<Renderer>(true))
                if (drop.Any(d => r.name.Contains(d))) Object.Destroy(r.gameObject);
            var bones = go.GetComponentsInChildren<Transform>(true).GroupBy(t => t.name).ToDictionary(g => g.Key, g => g.First());
            Graft(go, bones, assets.Model($"Superhero_{body}_FullBody"), headOnly: true);
            foreach (var hp in hair) Graft(go, bones, assets.Model(hp), headOnly: false);
            foreach (var smr in go.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                smr.updateWhenOffscreen = false;
                smr.shadowCastingMode = ShadowCastingMode.On;
                var slots = smr.sharedMaterials;
                for (int i = 0; i < slots.Length; i++) slots[i] = Material(slots[i] != null ? slots[i].name : "", look, zombie);
                smr.sharedMaterials = slots;
            }
            return go;
        }

        /// <summary>Moves another model's skinned meshes onto this skeleton, matching bones by name.</summary>
        void Graft(GameObject target, Dictionary<string, Transform> bones, GameObject source, bool headOnly)
        {
            if (source == null) return;
            var tmp = Object.Instantiate(source);
            foreach (var smr in tmp.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mapped = smr.bones.Select(b => b != null && bones.TryGetValue(b.name, out var t) ? t : null).ToArray();
                if (mapped.Any(b => b == null)) continue;
                if (headOnly) smr.sharedMesh = HeadOnly(smr);
                smr.transform.SetParent(target.transform, false);
                smr.bones = mapped;
                if (smr.rootBone != null && bones.TryGetValue(smr.rootBone.name, out var rb)) smr.rootBone = rb;
            }
            Object.Destroy(tmp);
        }

        /// <summary>Keeps only the triangles of the skin that are mostly weighted to the head and neck.</summary>
        Mesh HeadOnly(SkinnedMeshRenderer smr)
        {
            var src = smr.sharedMesh;
            if (headMeshes.TryGetValue(src, out var cached)) return cached;
            var names = smr.bones.Select(b => b.name).ToArray();
            var weights = src.boneWeights;
            float HeadWeight(int v)
            {
                var w = weights[v];
                float s = 0;
                if (IsHead(names[w.boneIndex0])) s += w.weight0;
                if (IsHead(names[w.boneIndex1])) s += w.weight1;
                if (IsHead(names[w.boneIndex2])) s += w.weight2;
                if (IsHead(names[w.boneIndex3])) s += w.weight3;
                return s;
            }
            var mesh = Object.Instantiate(src);
            var matNames = smr.sharedMaterials.Select(m => m != null ? m.name : "").ToArray();
            for (int sub = 0; sub < src.subMeshCount; sub++)
            {
                if (sub < matNames.Length && !matNames[sub].Contains("Superhero")) continue;
                var tris = src.GetTriangles(sub);
                var keep = new List<int>();
                for (int i = 0; i < tris.Length; i += 3)
                    if (HeadWeight(tris[i]) > .5f && HeadWeight(tris[i + 1]) > .5f && HeadWeight(tris[i + 2]) > .5f)
                        keep.AddRange(new[] { tris[i], tris[i + 1], tris[i + 2] });
                mesh.SetTriangles(keep, sub);
            }
            headMeshes[src] = mesh;
            return mesh;
        }

        static bool IsHead(string bone) => bone == "Head" || bone == "neck_01";

        Material Material(string fbxName, int look, bool zombie)
        {
            string name = fbxName.Replace(" (Instance)", "");
            string kind = name.Contains("Hair") ? "hair" : name.Contains("Eye") ? "eyes" :
                          name.Contains("Superhero") || name.Contains("Regular") ? "skin" : "cloth";
            int variant = kind == "cloth" ? look % 3 : kind == "hair" || kind == "skin" ? look % 16 : 0;
            string key = $"{name}|{kind}|{variant}|{zombie}";
            if (mats.TryGetValue(key, out var m)) return m;
            var set = assets.CharacterTextures(name);
            m = lib.NewLit();
            m.name = key;
            if (set != null)
            {
                var albedo = set.albedo;
                if (kind == "cloth" && variant > 0 && set.variants.Length >= variant) albedo = set.variants[variant - 1];
                if (zombie && set.zombieAlbedo != null && (kind == "cloth" || kind == "skin")) albedo = set.zombieAlbedo;
                m.SetTexture("_BaseColorMap", albedo);
                if (set.normal != null) m.SetTexture("_NormalMap", set.normal);
                if (set.mask != null) m.SetTexture("_MaskMap", set.mask);
                else m.SetFloat("_Smoothness", .35f);
            }
            Color tint = Color.white;
            if (kind == "skin") tint = zombie ? new Color(.78f, .86f, .74f) : Looks.Skin(look) * 1.25f;
            else if (kind == "hair") tint = zombie ? new Color(.3f, .28f, .25f) : Looks.HairColor(look) * 2.2f;
            else if (kind == "cloth" && zombie) tint = new Color(.82f, .8f, .76f);
            tint.a = 1;
            m.SetColor("_BaseColor", new Color(Mathf.Min(tint.r, 1.2f), Mathf.Min(tint.g, 1.2f), Mathf.Min(tint.b, 1.2f), 1));
            if (kind == "hair" || kind == "cloth") m.SetFloat("_DoubleSidedEnable", 1);
            MaterialLibrary.Validate(m);
            mats[key] = m;
            return m;
        }
    }

    /// <summary>A Quaternius character driven by mocap clips.</summary>
    public sealed class SkinnedBody : IBody
    {
        // simulation animation -> (clip, loops, speed in m/s at which the clip's feet don't slide)
        static readonly Dictionary<string, (string clip, bool loop, float natural)> Clips = new Dictionary<string, (string, bool, float)>
        {
            ["idle"] = ("Idle_Loop", true, 0), ["walk"] = ("Walk_Loop", true, .95f), ["jog"] = ("Jog_Fwd_Loop", true, 4f),
            ["run"] = ("Sprint_Loop", true, 6.5f), ["sneak"] = ("Crouch_Fwd_Loop", true, .66f), ["crouch"] = ("Crouch_Idle_Loop", true, 0),
            ["loot"] = ("Chest_Open", true, 0), ["gather"] = ("Farm_Harvest", true, 0), ["chop"] = ("TreeChopping_Loop", true, 0),
            ["build"] = ("Fixing_Kneeling", true, 0), ["aim"] = ("Pistol_Aim_Neutral", true, 0), ["melee"] = ("Sword_Attack", true, 0),
            ["eat"] = ("Consume", true, 0), ["drink"] = ("Consume", true, 0), ["heal"] = ("Interact", true, 0), ["sit"] = ("Sitting_Idle_Loop", true, 0),
            ["sleep"] = ("LayToIdle", false, 0), ["dead"] = ("Death01", false, 0),
            ["zidle"] = ("Zombie_Idle_Loop", true, 0), ["zwalk"] = ("Zombie_Walk_Fwd_Loop", true, .98f), ["zrun"] = ("Jog_Fwd_Loop", true, 4f),
            ["zattack"] = ("Zombie_Scratch", true, 0),
        };
        static readonly Dictionary<string, float[]> Hits = new Dictionary<string, float[]>
        {
            ["chop"] = new[] { .46f }, ["melee"] = new[] { .42f }, ["build"] = new[] { .12f, .37f, .62f, .87f },
        };
        static readonly HashSet<string> Locomotion = new HashSet<string> { "walk", "jog", "run", "sneak", "zwalk", "zrun" };
        const float Fade = .22f;

        readonly CharacterFactory factory;
        readonly GameObject go;
        readonly Animator animator;
        PlayableGraph graph;
        AnimationMixerPlayable mixer;
        AnimationClipPlayable cur, prev;
        string curClip, curAnim;
        float tCur, tPrev, fade = 1;
        bool curLoop, prevLoop;
        Transform hand, chest;
        GameObject axe, hammer, rifle;
        Quaternion handGrip, backRot;

        public Transform Root => go.transform;

        public SkinnedBody(CharacterFactory factory, GameObject go, int look, bool zombie, bool gear)
        {
            this.factory = factory;
            this.go = go;
            animator = go.GetComponent<Animator>() ?? go.AddComponent<Animator>();
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
            graph = PlayableGraph.Create("afterfall_" + go.name);
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            mixer = AnimationMixerPlayable.Create(graph, 2);
            var output = AnimationPlayableOutput.Create(graph, "anim", animator);
            output.SetSourcePlayable(mixer);
            hand = animator.GetBoneTransform(HumanBodyBones.RightHand);
            chest = animator.GetBoneTransform(HumanBodyBones.UpperChest) ?? animator.GetBoneTransform(HumanBodyBones.Chest);
            if (gear) Gear();
        }

        // --- gear, built from the same primitives as the world -------------------------------------------

        GameObject Prim(Transform parent, Shape shape, Vector3 size, Vector3 pos, Quaternion rot, string mat, int color)
        {
            var part = new Part { shape = shape, m = Mat3.Diag(size.x, size.z, size.y), pos = new V3(0, 0, 0), color = color, mat = mat };
            var (mesh, mats) = MeshBuilder.Build(new[] { part }, factory.Lib);
            var g = new GameObject(shape.ToString());
            g.transform.SetParent(parent, false);
            g.transform.localPosition = pos;
            g.transform.localRotation = rot;
            g.AddComponent<MeshFilter>().sharedMesh = mesh;
            g.AddComponent<MeshRenderer>().sharedMaterials = mats;
            return g;
        }

        void Gear()
        {
            var root = go.transform;
            if (hand != null)
            {
                // grip frame from the bind pose: fingers point along the hand, the handle runs through the fist
                // towards the thumb
                var middle = animator.GetBoneTransform(HumanBodyBones.RightMiddleProximal);
                var thumb = animator.GetBoneTransform(HumanBodyBones.RightThumbProximal);
                var fingers = middle != null ? (middle.position - hand.position).normalized : -root.up;
                var thumbSide = thumb != null ? Vector3.ProjectOnPlane(thumb.position - middle.position, fingers).normalized : root.forward;
                var grip = Quaternion.LookRotation(fingers, thumbSide);
                handGrip = Quaternion.Inverse(hand.rotation) * grip;
                var holder = new GameObject("grip").transform;
                holder.SetParent(hand, false);
                holder.localPosition = hand.InverseTransformVector(fingers * .08f);
                holder.localRotation = handGrip;
                // local frame: +y along the handle (head end), +z along the fingers
                axe = new GameObject("axe");
                axe.transform.SetParent(holder, false);
                Prim(axe.transform, Shape.Cylinder, new Vector3(.04f, .74f, .04f), new Vector3(0, .2f, 0), Quaternion.identity, "planks", 0x7b6a55);
                Prim(axe.transform, Shape.Cube, new Vector3(.03f, .12f, .2f), new Vector3(0, .52f, .07f), Quaternion.identity, "metal", 0x8b9095);
                hammer = new GameObject("hammer");
                hammer.transform.SetParent(holder, false);
                Prim(hammer.transform, Shape.Cylinder, new Vector3(.035f, .34f, .035f), new Vector3(0, .06f, 0), Quaternion.identity, "planks", 0x7b6a55);
                Prim(hammer.transform, Shape.Cube, new Vector3(.05f, .05f, .14f), new Vector3(0, .22f, 0), Quaternion.identity, "metal", 0x5b5c5a);
            }
            if (chest != null)
            {
                backRot = Quaternion.Inverse(chest.rotation) * root.rotation;
                var back = new GameObject("pack").transform;
                back.SetParent(chest, false);
                back.localRotation = backRot;
                back.localPosition = chest.InverseTransformVector(-root.forward * .2f - root.up * .05f);
                Prim(back, Shape.Cube, new Vector3(.34f, .44f, .19f), Vector3.zero, Quaternion.identity, "fabric", 0x4d5238);
                Prim(back, Shape.Cube, new Vector3(.26f, .16f, .06f), new Vector3(0, -.1f, -.11f), Quaternion.identity, "fabric", 0x5d6444);
                Prim(back, Shape.Cylinder, new Vector3(.15f, .4f, .15f), new Vector3(0, .3f, 0), Quaternion.Euler(0, 0, 90), "fabric", 0x2f4f6a);
                rifle = new GameObject("rifle");
                rifle.transform.SetParent(back, false);
                rifle.transform.localPosition = new Vector3(-.02f, 0, -.14f);
                rifle.transform.localRotation = Quaternion.Euler(0, 0, 35);
                Prim(rifle.transform, Shape.Cube, new Vector3(.04f, .9f, .05f), new Vector3(0, .35f, 0), Quaternion.identity, "metal", 0x3e4d63);
                Prim(rifle.transform, Shape.Cube, new Vector3(.05f, .32f, .08f), new Vector3(0, -.12f, 0), Quaternion.identity, "planks", 0x6a5c4d);
                Prim(rifle.transform, Shape.Cylinder, new Vector3(.045f, .26f, .045f), new Vector3(0, .2f, -.06f), Quaternion.identity, "metal", 0x5b5c5a);
            }
            foreach (var g in new[] { axe, hammer, rifle }) if (g != null) g.SetActive(false);
        }

        public void ShowItems(string anim, bool hasAxe, bool hasRifle)
        {
            if (axe == null) return;
            hammer.SetActive(anim == "build");
            bool busy = anim is "build" or "aim" or "sleep" or "dead" or "drink" or "eat" or "heal" or "loot" or "gather" or "sit";
            axe.SetActive(hasAxe && (anim == "chop" || anim == "melee" || (!busy && anim != "idle" && anim != "crouch")));
            if (rifle == null) return;
            rifle.SetActive(hasRifle);
            if (!hasRifle) return;
            if (anim == "aim")
            {
                rifle.transform.SetParent(hand.Find("grip"), false);
                rifle.transform.localPosition = new Vector3(0, 0, .05f);
                rifle.transform.localRotation = Quaternion.Euler(90, 0, 0);   // barrel along the fingers
            }
            else if (rifle.transform.parent != chest.Find("pack"))
            {
                rifle.transform.SetParent(chest.Find("pack"), false);
                rifle.transform.localPosition = new Vector3(-.02f, 0, -.14f);
                rifle.transform.localRotation = Quaternion.Euler(0, 0, 35);
            }
        }

        // --- animation ---------------------------------------------------------------------------------------

        public void Place(Vector3 pos, float heading)
        {
            go.transform.position = pos;
            // simulation heading (0 = east, counter-clockwise) -> Unity yaw (0 = +z, clockwise)
            go.transform.rotation = Quaternion.Euler(0, Mathf.Atan2(Mathf.Cos(heading), Mathf.Sin(heading)) * Mathf.Rad2Deg, 0);
        }

        public void Animate(string anim, float speed, float dt, System.Action onHit)
        {
            if (!Clips.TryGetValue(anim, out var spec)) spec = Clips["idle"];
            var clip = factory.Assets.Clip(spec.clip);
            if (clip == null) return;
            float play = spec.natural > 0 ? Mathf.Clamp(speed / spec.natural, .55f, 1.45f) : 1;
            if (spec.clip != curClip)
            {
                float t0 = 0;
                if (curClip != null && Locomotion.Contains(anim) && Locomotion.Contains(curAnim))
                {
                    var old = cur.GetAnimationClip();
                    t0 = (tCur % old.length) / old.length * clip.length;   // keep the stride phase
                }
                if (prev.IsValid()) { graph.Disconnect(mixer, 0); prev.Destroy(); }
                if (cur.IsValid())
                {
                    graph.Disconnect(mixer, 1);
                    prev = cur; tPrev = tCur; prevLoop = curLoop;
                    graph.Connect(prev, 0, mixer, 0);
                    fade = 0;
                }
                cur = AnimationClipPlayable.Create(graph, clip);
                cur.SetApplyFootIK(true);
                cur.Pause();
                graph.Connect(cur, 0, mixer, 1);
                curClip = spec.clip; curLoop = spec.loop; tCur = t0;
            }
            curAnim = anim;
            float len = clip.length;
            float before = (tCur / len) % 1;
            if (anim != "sleep") tCur += dt * play;
            float after = (tCur / len) % 1;
            if (onHit != null && dt > 0 && Hits.TryGetValue(anim, out var hits))
                foreach (var h in hits)
                    if ((before < h && h <= after) || (after < before && (h > before || h <= after))) onHit();
            tPrev += dt;
            if (dt > 0) fade = Mathf.Min(1, fade + dt / Fade);
            cur.SetTime(curLoop ? tCur % len : Mathf.Min(tCur, len - .01f));
            if (prev.IsValid())
            {
                float pl = prev.GetAnimationClip().length;
                prev.SetTime(prevLoop ? tPrev % pl : Mathf.Min(tPrev, pl - .01f));
            }
            mixer.SetInputWeight(0, prev.IsValid() ? 1 - fade : 0);
            mixer.SetInputWeight(1, prev.IsValid() ? fade : 1);
            graph.Evaluate(0);
        }

        public void Destroy()
        {
            if (graph.IsValid()) graph.Destroy();
            Object.Destroy(go);
        }
    }

    /// <summary>Stand-in when the asset pack isn't installed: a capsule body that bobs and leans.</summary>
    public sealed class StandInBody : IBody
    {
        readonly GameObject go;
        readonly Transform body;
        float t;
        public Transform Root => go.transform;

        public StandInBody(Transform parent, MaterialLibrary lib, Color cloth, Color skin, bool zombie)
        {
            go = new GameObject(zombie ? "infected" : "survivor");
            go.transform.SetParent(parent, false);
            body = new GameObject("body").transform;
            body.SetParent(go.transform, false);
            var torso = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Object.Destroy(torso.GetComponent<Collider>());
            torso.transform.SetParent(body, false);
            torso.transform.localPosition = new Vector3(0, .9f, 0);
            torso.transform.localScale = new Vector3(.45f, .9f, .3f);
            var mt = lib.NewLit();
            mt.SetColor("_BaseColor", cloth);
            MaterialLibrary.Validate(mt);
            torso.GetComponent<MeshRenderer>().sharedMaterial = mt;
            var head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Object.Destroy(head.GetComponent<Collider>());
            head.transform.SetParent(body, false);
            head.transform.localPosition = new Vector3(0, 1.72f, zombie ? .08f : 0);
            head.transform.localScale = Vector3.one * .24f;
            var ms = lib.NewLit();
            ms.SetColor("_BaseColor", skin);
            MaterialLibrary.Validate(ms);
            head.GetComponent<MeshRenderer>().sharedMaterial = ms;
        }

        public void Place(Vector3 pos, float heading)
        {
            go.transform.position = pos;
            go.transform.rotation = Quaternion.Euler(0, Mathf.Atan2(Mathf.Cos(heading), Mathf.Sin(heading)) * Mathf.Rad2Deg, 0);
        }

        public void Animate(string anim, float speed, float dt, System.Action onHit)
        {
            t += dt;
            bool down = anim == "dead" || anim == "sleep";
            float bob = speed > 0 ? Mathf.Abs(Mathf.Sin(t * 6 * Mathf.Max(.5f, speed / 2))) * .06f : 0;
            float lean = anim is "zwalk" or "zrun" or "zattack" ? 12 : anim is "crouch" or "sneak" or "loot" or "build" ? 25 : 0;
            body.localRotation = down ? Quaternion.Euler(-88, 0, 0) : Quaternion.Euler(lean, 0, 0);
            body.localPosition = new Vector3(0, down ? .2f : bob, 0);
        }

        public void ShowItems(string anim, bool axe, bool rifle) { }
        public void Destroy() => Object.Destroy(go);
    }
}

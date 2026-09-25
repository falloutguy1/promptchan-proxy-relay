// Afterfall for Unity 6 + HDRP. Put this component on an empty GameObject in an empty scene (or use
// Afterfall > Create Game Scene) and press Play: the world, the survivor and the infected are all
// generated from code, and the optional CC0 asset pack is picked up when it has been imported.
using System.Collections.Generic;
using Afterfall.Sim;
using UnityEngine;

namespace Afterfall.Game
{
    public sealed class AfterfallGame : MonoBehaviour
    {
        [Tooltip("World seed; 0 picks a random one.")] public int seed;
        [Range(0, 80)] public int zombies = 28;
        [Tooltip("Game minutes per real second.")] public float timeSpeed = 2;
        [Tooltip("Fast-forward this many game hours before showing.")] public float skipHours;
        public bool grass = true;
        public bool sound = true;

        Simulation sim;
        MaterialLibrary lib;
        WorldView view;
        EnvironmentController env;
        CameraDirector director;
        CharacterFactory characters;
        Hud hud;
        SoundBoard sfx;
        Camera cam;
        IBody survivorBody;
        Survivor survivorShown;
        readonly Dictionary<int, IBody> walkerBodies = new Dictionary<int, IBody>();
        bool paused;
        int floatersSeen, soundsSeen;
        float wet, clock;
        static readonly float[] Speeds = { .5f, 1, 2, 4, 8, 16 };

        public Simulation Sim => sim;

        void Start()
        {
            var assets = AfterfallAssets.Load();
            if (assets == null) Debug.Log("Afterfall: no asset pack imported, using plain colours. Run Afterfall > Download Free Assets for scanned textures and mocap characters.");
            sim = new Simulation(seed != 0 ? seed : (long?)null, zombies);
            for (int i = 0; i < (int)(skipHours * 60 / .1f); i++) sim.Step(.1);
            Debug.Log($"Afterfall seed {sim.seed}");
            lib = new MaterialLibrary(assets);
            view = new WorldView(sim, lib, assets, grass);
            env = new EnvironmentController(sim, transform, lib);
            cam = Camera.main;
            if (cam == null)
            {
                var go = new GameObject("Main Camera") { tag = "MainCamera" };
                cam = go.AddComponent<Camera>();
                go.AddComponent<AudioListener>();
            }
            cam.nearClipPlane = .15f;
            cam.farClipPlane = 2500;
            director = new CameraDirector(cam, (x, z) => view.Ground(x, z));
            characters = new CharacterFactory(assets, lib, new GameObject("Agents").transform);
            foreach (var z in sim.zombies) walkerBodies[z.id] = characters.Walker(z.look);
            hud = new Hud(sim);
            if (sound) sfx = new SoundBoard(transform, view.FirePos);
            floatersSeen = sim.floaters.Count;
            soundsSeen = sim.sounds.Count;
        }

        void Update()
        {
            float dt = Mathf.Min(.1f, Time.deltaTime);
            HandleInput();
            float simDt = paused ? 0 : dt * timeSpeed;
            int steps = Mathf.Max(1, Mathf.CeilToInt(simDt / .1f));
            if (simDt > 0) for (int i = 0; i < steps; i++) sim.Step(simDt / steps);
            clock += dt;
            float poseDt = Mathf.Min(simDt, .1f);
            var s = sim.survivor;

            // survivor
            if (survivorShown != s)
            {
                survivorBody?.Destroy();
                survivorBody = characters.Survivor(s.name);
                survivorShown = s;
            }
            var sPos = new Vector3((float)s.x, view.Ground(s.x, s.y), (float)s.y);
            float heading = (float)s.heading;
            if (s.anim == "sleep") heading = sim.home.built.Contains("roof") ? 0 : .7f;
            survivorBody.Place(sPos, heading);
            survivorBody.ShowItems(s.anim, s.inv["axe"] > 0, s.inv["rifle"] > 0);
            System.Action hit = s.anim is "chop" or "build" ? () => sfx?.Play(s.anim == "chop" ? "chop" : "hammer", sPos) : (System.Action)null;
            survivorBody.Animate(s.anim, (float)s.speed, poseDt, hit);

            // the infected
            var camPos = cam.transform.position;
            foreach (var z in sim.zombies)
            {
                var body = walkerBodies[z.id];
                float dx = (float)z.x - camPos.x, dz = (float)z.y - camPos.z, d2 = dx * dx + dz * dz;
                bool show = d2 < 230 * 230 && (z.alive || z.deadT < 60);
                if (body.Root.gameObject.activeSelf != show) body.Root.gameObject.SetActive(show);
                if (!show) continue;
                float sink = z.alive ? 0 : Mathf.Max(0, (float)z.deadT - 50) * .06f;
                body.Place(new Vector3((float)z.x, view.Ground(z.x, z.y) - sink, (float)z.y), (float)z.heading);
                if (d2 < 130 * 130 || poseDt == 0) body.Animate(z.alive ? z.anim : "dead", (float)z.speed, poseDt, null);
            }

            env.Update(cam.transform);
            view.Update(clock, simDt, env.Night);
            // surfaces soak up rain within half an hour and take a few hours to dry
            wet = sim.rain > .1 ? Mathf.Min(1, wet + simDt * (float)sim.rain / 30) : Mathf.Max(0, wet - simDt / 180);
            lib.SetWetness(wet);
            director.Update(dt, s, sim.home, sPos);

            for (int i = floatersSeen; i < sim.floaters.Count; i++)
            {
                var f = sim.floaters[i];
                hud.Float(new Vector3((float)f.x, view.Ground(f.x, f.y) + 2.1f, (float)f.y), f.text, f.kind, (float)f.delay);
            }
            floatersSeen = sim.floaters.Count;
            if (sim.floaters.Count > 300) { sim.floaters.RemoveRange(0, sim.floaters.Count - 50); floatersSeen = sim.floaters.Count; }
            if (sfx != null)
            {
                for (int i = soundsSeen; i < sim.sounds.Count; i++)
                {
                    var snd = sim.sounds[i];
                    if (timeSpeed <= 4 || snd.kind == "shot") sfx.Play(snd.kind, new Vector3((float)snd.x, view.Ground(snd.x, snd.y) + 1, (float)snd.y));
                }
                float fd = (camPos - view.FirePos).magnitude;
                bool fire = sim.home.built.Contains("fire") && sim.home.fireFuel > 0;
                sfx.Ambient(.12f + .1f * (float)sim.cloud + .15f * (float)sim.rain, (float)sim.rain * .3f, fire ? Mathf.Max(0, 1 - fd / 40) * .35f : 0);
            }
            soundsSeen = sim.sounds.Count;
            hud.Tick(dt);
        }

        void HandleInput()
        {
            if (Keys.Down("1")) director.SetMode(CameraDirector.Mode.Cine);
            if (Keys.Down("2")) director.SetMode(CameraDirector.Mode.Chase);
            if (Keys.Down("3")) director.SetMode(CameraDirector.Mode.Orbit);
            if (Keys.Down("4")) director.SetMode(CameraDirector.Mode.Map);
            if (Keys.Down("space")) paused = !paused;
            if (Keys.Down("]")) timeSpeed = System.Array.Find(Speeds, v => v > timeSpeed + 1e-3f) is float up && up > 0 ? up : 16;
            if (Keys.Down("["))
            {
                float down = .5f;
                foreach (var v in Speeds) if (v < timeSpeed - 1e-3f) down = v;
                timeSpeed = down;
            }
            if (Keys.Down("h")) hud.visible = !hud.visible;
            var drag = Keys.Drag();
            if (drag.sqrMagnitude > 1e-8f) director.Drag(drag.x, drag.y);
            float scroll = Keys.Scroll();
            if (Mathf.Abs(scroll) > 1e-4f) director.Zoom(-scroll * .12f);
        }

        void OnGUI()
        {
            if (hud == null) return;
            var s = sim.survivor;
            hud.Draw(cam, director, timeSpeed, paused, new Vector3((float)s.x, view.Ground(s.x, s.y) + 1.8f, (float)s.y));
        }

        void OnDestroy()
        {
            survivorBody?.Destroy();
            foreach (var b in walkerBodies.Values) b.Destroy();
        }
    }

    /// <summary>Works with either input backend (the old Input Manager or the Input System package).</summary>
    static class Keys
    {
        public static bool Down(string key)
        {
#if ENABLE_INPUT_SYSTEM && AFTERFALL_INPUT_SYSTEM
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb == null) return false;
            return key switch
            {
                "1" => kb.digit1Key.wasPressedThisFrame, "2" => kb.digit2Key.wasPressedThisFrame, "3" => kb.digit3Key.wasPressedThisFrame,
                "4" => kb.digit4Key.wasPressedThisFrame, "space" => kb.spaceKey.wasPressedThisFrame, "]" => kb.rightBracketKey.wasPressedThisFrame,
                "[" => kb.leftBracketKey.wasPressedThisFrame, "h" => kb.hKey.wasPressedThisFrame, _ => false,
            };
#elif ENABLE_LEGACY_INPUT_MANAGER
            return Input.GetKeyDown(key);
#else
            return false;
#endif
        }

        public static Vector2 Drag()
        {
#if ENABLE_INPUT_SYSTEM && AFTERFALL_INPUT_SYSTEM
            var m = UnityEngine.InputSystem.Mouse.current;
            if (m == null || !(m.rightButton.isPressed || m.leftButton.isPressed)) return Vector2.zero;
            return m.delta.ReadValue() / Mathf.Max(1, Screen.height);
#elif ENABLE_LEGACY_INPUT_MANAGER
            if (!Input.GetMouseButton(0) && !Input.GetMouseButton(1)) return Vector2.zero;
            return new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y")) * .02f;
#else
            return Vector2.zero;
#endif
        }

        public static float Scroll()
        {
#if ENABLE_INPUT_SYSTEM && AFTERFALL_INPUT_SYSTEM
            var m = UnityEngine.InputSystem.Mouse.current;
            return m == null ? 0 : m.scroll.ReadValue().y / 120f;
#elif ENABLE_LEGACY_INPUT_MANAGER
            return Input.mouseScrollDelta.y;
#else
            return 0;
#endif
        }
    }
}

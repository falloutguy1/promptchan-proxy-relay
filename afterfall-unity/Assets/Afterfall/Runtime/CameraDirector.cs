// The spectator camera: an automatic director (drone, tripod, ground, wide, over-the-shoulder and
// homestead shots) plus chase, orbit and overhead modes.
using Afterfall.Sim;
using UnityEngine;

namespace Afterfall.Game
{
    public sealed class CameraDirector
    {
        public enum Mode { Cine, Chase, Orbit, Map }

        sealed class Shot
        {
            public string kind;
            public float a, s, r, h, fov = 50;
            public Vector3 pos;
        }

        readonly Camera cam;
        readonly System.Func<double, double, float> ground;
        public Mode mode = Mode.Cine;
        Shot shot;
        float shotT, shotLen;
        int shots;
        public Vector3 target;
        Vector3? pos;
        Vector3 look;
        float fov = 50, yaw = .8f, pitch = .35f, dist = 14;
        bool auto = true;
        public string Label { get; private set; } = "CAM 1 · DRONE";

        public CameraDirector(Camera cam, System.Func<double, double, float> ground)
        {
            this.cam = cam;
            this.ground = ground;
        }

        float G(float x, float z) => ground(x, z);

        public void SetMode(Mode m)
        {
            mode = m;
            shot = null;
            if (m == Mode.Orbit)
            {
                var d = cam.transform.position - target;
                dist = Mathf.Clamp(d.magnitude, 4, 80);
                yaw = Mathf.Atan2(d.x, d.z);
                pitch = Mathf.Clamp(Mathf.Asin(Mathf.Clamp(d.y / Mathf.Max(d.magnitude, 1e-3f), -1, 1)), -.05f, 1.45f);
                auto = true;
            }
            Label = m switch { Mode.Chase => "CHASE", Mode.Orbit => "ORBIT · DRAG TO LOOK", Mode.Map => "OVERHEAD", _ => Label };
        }

        public void Drag(float dx, float dy)
        {
            if (mode != Mode.Orbit) SetMode(Mode.Orbit);
            auto = false;
            yaw += dx * 3;
            pitch = Mathf.Clamp(pitch - dy * 2.5f, -.05f, 1.45f);
        }

        public void Zoom(float amount)
        {
            if (mode != Mode.Orbit) SetMode(Mode.Orbit);
            auto = false;
            dist = Mathf.Clamp(dist * Mathf.Exp(amount), 3, 90);
        }

        void NewShot(Survivor s, Vector3 fwd, Homestead home)
        {
            string[] kinds = { "drone", "tripod", "low", "wide", "shoulder" };
            if (s.anim == "aim" || s.anim == "melee" || (s.action != null && (s.action.name == "Fight" || s.action.name == "Flee")))
                kinds = new[] { "low", "shoulder", "tripod" };
            else if (s.anim == "build" || s.anim == "sit" || s.anim == "sleep")
                kinds = new[] { "drone", "tripod", "tower", "low" };
            string k = kinds[Random.Range(0, kinds.Length)];
            if (shot != null && k == shot.kind) k = kinds[Random.Range(0, kinds.Length)];
            var sh = new Shot { kind = k, a = Random.Range(0, 2 * Mathf.PI), s = Random.value < .5f ? -1 : 1 };
            var t = target;
            if (k == "tripod")
            {
                float ahead = Random.Range(12f, 22f), side = Random.Range(5f, 11f) * sh.s;
                float px = t.x + fwd.x * ahead + fwd.z * side, pz = t.z + fwd.z * ahead - fwd.x * side;
                sh.pos = new Vector3(px, G(px, pz) + Random.Range(1.2f, 2.4f), pz);
                sh.fov = Random.Range(26f, 34f);
            }
            else if (k == "wide") { sh.r = Random.Range(45f, 70f); sh.h = Random.Range(18f, 32f); sh.fov = 40; }
            else if (k == "tower")
            {
                float px = (float)home.baseSite.x + Random.Range(-24f, 24f), pz = (float)home.baseSite.y + Random.Range(-24f, 24f);
                sh.pos = new Vector3(px, G(px, pz) + Random.Range(9f, 16f), pz);
                sh.fov = 42;
            }
            shot = sh;
            shotT = 0;
            shotLen = Random.Range(8f, 13f);
            shots++;
            string name = k switch { "drone" => "DRONE", "tripod" => "TRIPOD", "low" => "GROUND", "wide" => "WIDE", "shoulder" => "OVER SHOULDER", _ => "HOMESTEAD" };
            Label = $"CAM {1 + shots % 6} · {name}";
        }

        public void Update(float dt, Survivor s, Homestead home, Vector3 survivorPos)
        {
            float headH = s.anim == "sleep" || s.anim == "dead" ? .4f : 1.35f;
            var wantT = survivorPos + Vector3.up * headH;
            target = (wantT - target).magnitude > 30 ? wantT : target + (wantT - target) * (1 - Mathf.Exp(-dt * 5));
            var t = target;
            var fwd = new Vector3(Mathf.Cos((float)s.heading), 0, Mathf.Sin((float)s.heading));
            var lookAt = t;
            float wantFov = 50;
            bool snap = false;
            Vector3 p;
            if (mode == Mode.Cine)
            {
                shotT += dt;
                bool farTripod = shot != null && shot.kind == "tripod" && (shot.pos - t).magnitude > 40;
                if (shot == null || shotT > shotLen || farTripod) { NewShot(s, fwd, home); snap = true; }
                var sh = shot;
                wantFov = sh.fov;
                switch (sh.kind)
                {
                    case "drone":
                        sh.a += dt * .09f * sh.s;
                        p = new Vector3(t.x + Mathf.Sin(sh.a) * 22, t.y + 13, t.z + Mathf.Cos(sh.a) * 22);
                        wantFov = 45;
                        break;
                    case "tripod":
                    case "tower":
                        p = sh.pos;
                        break;
                    case "low":
                        p = new Vector3(t.x - fwd.x * 2.5f + fwd.z * 3.6f * sh.s, 0, t.z - fwd.z * 2.5f - fwd.x * 3.6f * sh.s);
                        p.y = G(p.x, p.z) + .5f;
                        lookAt.y -= .2f;
                        wantFov = 55;
                        break;
                    case "wide":
                        sh.a += dt * .03f;
                        p = new Vector3(t.x + Mathf.Sin(sh.a) * sh.r, t.y + sh.h, t.z + Mathf.Cos(sh.a) * sh.r);
                        break;
                    default:
                        p = new Vector3(t.x - fwd.x * 3.4f - fwd.z * .9f * sh.s, t.y + .55f, t.z - fwd.z * 3.4f + fwd.x * .9f * sh.s);
                        lookAt = new Vector3(t.x + fwd.x * 8, t.y, t.z + fwd.z * 8);
                        wantFov = 52;
                        break;
                }
            }
            else if (mode == Mode.Chase)
            {
                p = new Vector3(t.x - fwd.x * 6.5f + fwd.z * .9f, t.y + 2.3f, t.z - fwd.z * 6.5f - fwd.x * .9f);
                lookAt = new Vector3(t.x + fwd.x * 4, t.y + .3f, t.z + fwd.z * 4);
                wantFov = 55;
            }
            else if (mode == Mode.Orbit)
            {
                if (auto) yaw += dt * .05f;
                float cp = Mathf.Cos(pitch);
                p = new Vector3(t.x + Mathf.Sin(yaw) * cp * dist, t.y + Mathf.Sin(pitch) * dist, t.z + Mathf.Cos(yaw) * cp * dist);
            }
            else
            {
                p = new Vector3(t.x + .01f, t.y + 150, t.z - 55);
                wantFov = 40;
            }
            float g = G(p.x, p.z) + .45f;
            if (p.y < g) p.y = g;
            if (pos == null || (snap && mode == Mode.Cine))
            {
                pos = p;
                look = lookAt;
            }
            else
            {
                float rate = mode == Mode.Orbit ? 12 : mode == Mode.Cine && shot.kind != "tripod" && shot.kind != "tower" ? 2.5f : 3.5f;
                pos += (p - pos.Value) * (1 - Mathf.Exp(-dt * rate));
                look += (lookAt - look) * (1 - Mathf.Exp(-dt * 6));
            }
            fov += (wantFov - fov) * (1 - Mathf.Exp(-dt * 3));
            cam.transform.position = pos.Value;
            cam.transform.rotation = Quaternion.LookRotation(look - pos.Value, Vector3.up);
            cam.fieldOfView = fov * .8f;   // the Python version's fov was horizontal-ish; keep a similar framing
        }
    }
}

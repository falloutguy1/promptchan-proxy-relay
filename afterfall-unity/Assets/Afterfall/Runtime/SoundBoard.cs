// Sound effects synthesised at start-up (no audio files ship with the game), played in 3D where they happen.
using System.Collections.Generic;
using UnityEngine;

namespace Afterfall.Game
{
    public sealed class SoundBoard
    {
        const int RATE = 22050;
        readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        readonly AudioSource wind, rain, fire;
        readonly Transform parent;

        public SoundBoard(Transform parent, Vector3 firePos)
        {
            this.parent = parent;
            foreach (var kv in Synth()) clips[kv.Key] = Make(kv.Key, kv.Value);
            wind = Loop("wind", false);
            rain = Loop("rain", false);
            fire = Loop("fire", true);
            fire.transform.position = firePos;
        }

        AudioSource Loop(string name, bool spatial)
        {
            var go = new GameObject("loop_" + name);
            go.transform.SetParent(parent, false);
            var src = go.AddComponent<AudioSource>();
            src.clip = clips[name];
            src.loop = true;
            src.volume = 0;
            src.spatialBlend = spatial ? 1 : 0;
            src.maxDistance = 40;
            src.rolloffMode = AudioRolloffMode.Linear;
            src.Play();
            return src;
        }

        static AudioClip Make(string name, float[] data)
        {
            var c = AudioClip.Create(name, data.Length, 1, RATE, false);
            for (int i = 0; i < data.Length; i++) data[i] = Mathf.Clamp(data[i], -1, 1);
            c.SetData(data, 0);
            return c;
        }

        public void Play(string kind, Vector3 at)
        {
            if (!clips.TryGetValue(kind, out var c)) return;
            float reach = kind == "shot" ? 400 : 80;
            var go = new GameObject("sfx_" + kind);
            go.transform.SetParent(parent, false);
            go.transform.position = at;
            var src = go.AddComponent<AudioSource>();
            src.clip = c;
            src.spatialBlend = 1;
            src.rolloffMode = AudioRolloffMode.Linear;
            src.maxDistance = reach;
            src.volume = kind == "groan" || kind == "hammer" ? .5f : .8f;
            src.pitch = Random.Range(.92f, 1.08f);
            src.Play();
            Object.Destroy(go, c.length + .1f);
        }

        public void Ambient(float windV, float rainV, float fireV)
        {
            wind.volume = windV;
            rain.volume = rainV;
            fire.volume = fireV;
        }

        // --- synthesis -----------------------------------------------------------------------------------

        static float[] Noise(int n, int seed)
        {
            var r = new System.Random(seed);
            var a = new float[n];
            for (int i = 0; i < n; i++) a[i] = (float)(r.NextDouble() * 2 - 1);
            return a;
        }

        static float[] Low(float[] x, float a)
        {
            var y = new float[x.Length];
            float acc = 0;
            for (int i = 0; i < x.Length; i++) { acc += a * (x[i] - acc); y[i] = acc; }
            return y;
        }

        static float Env(int i, float attack, float decay)
        {
            float t = (float)i / RATE;
            return Mathf.Min(1, t / Mathf.Max(attack, 1e-4f)) * Mathf.Exp(-t / decay);
        }

        static Dictionary<string, float[]> Synth()
        {
            var s = new Dictionary<string, float[]>();
            int n = (int)(RATE * 1.2f);
            var ln = Low(Noise(n, 1), .5f);
            var shot = new float[n];
            for (int i = 0; i < n; i++) shot[i] = ln[i] * Env(i, .001f, .12f) * 1.6f + Mathf.Sin(2 * Mathf.PI * 55 * i / RATE) * Env(i, .001f, .15f);
            s["shot"] = shot;

            n = (int)(RATE * 1.4f);
            var saw = new float[n];
            float ph = 0;
            for (int i = 0; i < n; i++)
            {
                float t = (float)i / RATE, f = 95 * (1 - .3f * t) * (1 + .03f * Mathf.Sin(2 * Mathf.PI * 6 * t));
                ph = (ph + f / RATE) % 1;
                saw[i] = 2 * ph - 1;
            }
            var groan = Low(saw, .08f);
            for (int i = 0; i < n; i++) groan[i] *= Env(i, .25f, .6f) * 1.4f;
            s["groan"] = groan;

            n = (int)(RATE * .25f);
            var a2 = Low(Noise(n, 2), .4f);
            var b2 = Low(Noise(n, 2), .05f);
            var chop = new float[n];
            var hammer = new float[n];
            var hit = Low(Noise(n, 4), .15f);
            var n3 = Noise(n, 3);
            for (int i = 0; i < n; i++)
            {
                chop[i] = (a2[i] - b2[i]) * Env(i, .001f, .05f) * 2;
                hammer[i] = Mathf.Sin(2 * Mathf.PI * 900 * i / RATE) * Env(i, .001f, .03f) + n3[i] * Env(i, .001f, .01f);
                hit[i] *= Env(i, .001f, .08f) * 2;
            }
            s["chop"] = chop; s["hammer"] = hammer; s["hit"] = hit;

            n = (int)(RATE * .6f);
            var thud = Low(Noise(n, 5), .05f);
            var hurt = new float[n];
            ph = 0;
            for (int i = 0; i < n; i++)
            {
                thud[i] *= Env(i, .005f, .15f) * 3;
                ph += Mathf.Lerp(260, 140, (float)i / n) / RATE;
                hurt[i] = Mathf.Sin(2 * Mathf.PI * ph) * Env(i, .01f, .12f);
            }
            s["thud"] = thud; s["hurt"] = hurt;

            n = RATE * 4;
            var wind = Low(Noise(n, 7), .02f);
            float peak = 1e-6f;
            foreach (var v in wind) peak = Mathf.Max(peak, Mathf.Abs(v));
            var rn = Noise(n, 8);
            var rl = Low(Noise(n, 8), .3f);
            var fire = new float[n];
            var fl = Low(Noise(n, 10), .03f);
            var rng = new System.Random(9);
            for (int k = 0; k < 90; k++)
            {
                int at = rng.Next(0, n - 200);
                var burst = Noise(200, at);
                float amp = (float)(.3 + rng.NextDouble() * .7);
                for (int i = 0; i < 200; i++) fire[at + i] += burst[i] * Env(i, .0005f, .004f) * amp;
            }
            var rainS = new float[n];
            for (int i = 0; i < n; i++)
            {
                wind[i] = wind[i] / peak * .5f * (1 + .3f * Mathf.Sin(2 * Mathf.PI * .25f * i / RATE));
                rainS[i] = (rn[i] - rl[i]) * .35f;
                fire[i] = fire[i] * .8f + fl[i] * .4f;
            }
            s["wind"] = wind; s["rain"] = rainS; s["fire"] = fire;
            return s;
        }
    }
}

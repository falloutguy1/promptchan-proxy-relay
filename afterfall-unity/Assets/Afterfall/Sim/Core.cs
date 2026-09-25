// Small math and randomness helpers shared by the simulation. No UnityEngine dependency: the simulation
// compiles and runs headless under plain .NET (see SimTests/).
using System;
using System.Collections.Generic;

namespace Afterfall.Sim
{
    /// <summary>Deterministic xoshiro128** generator with the helpers the simulation uses.</summary>
    public sealed class Rng
    {
        uint a, b, c, d;

        public Rng(long seed)
        {
            ulong s = (ulong)seed ^ 0x9E3779B97F4A7C15UL;
            a = (uint)SplitMix(ref s); b = (uint)SplitMix(ref s); c = (uint)SplitMix(ref s); d = (uint)SplitMix(ref s);
            if ((a | b | c | d) == 0) a = 1;
        }

        static ulong SplitMix(ref ulong s)
        {
            ulong z = (s += 0x9E3779B97F4A7C15UL);
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }

        uint Next()
        {
            uint result = RotL(b * 5, 7) * 9;
            uint t = b << 9;
            c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = RotL(d, 11);
            return result;
        }

        static uint RotL(uint x, int k) => (x << k) | (x >> (32 - k));

        /// <summary>[0, 1)</summary>
        public double Random() => (Next() >> 8) * (1.0 / 16777216.0) + (Next() >> 11) * (1.0 / 16777216.0 / 2097152.0);
        public double Uniform(double lo, double hi) => lo + (hi - lo) * Random();
        /// <summary>Inclusive on both ends, like Python's randint.</summary>
        public int RandInt(int lo, int hi) => lo + (int)(Random() * (hi - lo + 1));
        public T Choice<T>(IReadOnlyList<T> list) => list[(int)(Random() * list.Count)];
        public void Shuffle<T>(IList<T> list)
        {
            for (int i = list.Count - 1; i > 0; i--)
            {
                int j = (int)(Random() * (i + 1));
                (list[i], list[j]) = (list[j], list[i]);
            }
        }
    }

    /// <summary>Binary min-heap (Unity's .NET profile has no PriorityQueue).</summary>
    public sealed class MinHeap<T>
    {
        readonly List<(double p, T v)> items = new List<(double, T)>();
        public int Count => items.Count;

        public void Push(T v, double p)
        {
            items.Add((p, v));
            int i = items.Count - 1;
            while (i > 0)
            {
                int parent = (i - 1) / 2;
                if (items[parent].p <= items[i].p) break;
                (items[parent], items[i]) = (items[i], items[parent]);
                i = parent;
            }
        }

        public T Pop()
        {
            var top = items[0].v;
            int last = items.Count - 1;
            items[0] = items[last];
            items.RemoveAt(last);
            int i = 0;
            while (true)
            {
                int l = i * 2 + 1, r = l + 1, m = i;
                if (l < items.Count && items[l].p < items[m].p) m = l;
                if (r < items.Count && items[r].p < items[m].p) m = r;
                if (m == i) break;
                (items[m], items[i]) = (items[i], items[m]);
                i = m;
            }
            return top;
        }
    }

    public static class M
    {
        public const double PI = Math.PI;
        public const double TAU = Math.PI * 2;
        public static double Clamp(double x, double lo, double hi) => x < lo ? lo : x > hi ? hi : x;
        public static double Clamp01(double x) => x < 0 ? 0 : x > 1 ? 1 : x;
        /// <summary>Smoothstep that also works with e0 &gt; e1 (falls instead of rises).</summary>
        public static double Smooth(double e0, double e1, double x)
        {
            double t = Clamp01((x - e0) / (e1 - e0));
            return t * t * (3 - 2 * t);
        }
        /// <summary>0 below lo, 1 above hi, curved in between.</summary>
        public static double Rising(double x, double lo, double hi, double power = 1) => Math.Pow(Clamp01((x - lo) / (hi - lo)), power);
        public static double Falling(double x, double hi, double lo, double power = 1) => Math.Pow(Clamp01((hi - x) / (hi - lo)), power);
        public static double Hypot(double x, double y) => Math.Sqrt(x * x + y * y);
        /// <summary>Wraps an angle difference into [-pi, pi).</summary>
        public static double WrapPi(double a) => a - TAU * Math.Floor((a + PI) / TAU);
        public static double Deg(double r) => r * 180 / PI;
        public static double Rad(double d) => d * PI / 180;
        public static double FloorDiv(double a, double b) => Math.Floor(a / b);
        public static int IFloorDiv(double a, double b) => (int)Math.Floor(a / b);
        public static double Mod(double a, double b) => a - b * Math.Floor(a / b);
        public static string An(string noun) => ("aeiou".IndexOf(char.ToLowerInvariant(noun[0])) >= 0 ? "an " : "a ") + noun;
    }

    public struct V2
    {
        public double x, y;
        public V2(double x, double y) { this.x = x; this.y = y; }
        public static V2 operator +(V2 a, V2 b) => new V2(a.x + b.x, a.y + b.y);
        public static V2 operator -(V2 a, V2 b) => new V2(a.x - b.x, a.y - b.y);
        public static V2 operator *(V2 a, double k) => new V2(a.x * k, a.y * k);
        public double Length => Math.Sqrt(x * x + y * y);
        public V2 Normalized { get { double l = Length; return l > 1e-12 ? new V2(x / l, y / l) : new V2(0, 0); } }
    }

    public struct V3
    {
        public double x, y, z;
        public V3(double x, double y, double z) { this.x = x; this.y = y; this.z = z; }
        public static V3 operator +(V3 a, V3 b) => new V3(a.x + b.x, a.y + b.y, a.z + b.z);
        public static V3 operator -(V3 a, V3 b) => new V3(a.x - b.x, a.y - b.y, a.z - b.z);
        public static V3 operator *(V3 a, double k) => new V3(a.x * k, a.y * k, a.z * k);
        public double Length => Math.Sqrt(x * x + y * y + z * z);
        public static V3 Cross(V3 a, V3 b) => new V3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
        public V3 Normalized { get { double l = Length; return l > 1e-12 ? this * (1 / l) : this; } }
    }

    /// <summary>Row-major 3x3 matrix (columns are the transformed basis vectors).</summary>
    public struct Mat3
    {
        public double m00, m01, m02, m10, m11, m12, m20, m21, m22;

        public static Mat3 Identity => new Mat3 { m00 = 1, m11 = 1, m22 = 1 };

        public static Mat3 FromColumns(V3 cx, V3 cy, V3 cz) => new Mat3
        {
            m00 = cx.x, m10 = cx.y, m20 = cx.z,
            m01 = cy.x, m11 = cy.y, m21 = cy.z,
            m02 = cz.x, m12 = cz.y, m22 = cz.z,
        };

        public static Mat3 operator *(Mat3 a, Mat3 b) => new Mat3
        {
            m00 = a.m00 * b.m00 + a.m01 * b.m10 + a.m02 * b.m20,
            m01 = a.m00 * b.m01 + a.m01 * b.m11 + a.m02 * b.m21,
            m02 = a.m00 * b.m02 + a.m01 * b.m12 + a.m02 * b.m22,
            m10 = a.m10 * b.m00 + a.m11 * b.m10 + a.m12 * b.m20,
            m11 = a.m10 * b.m01 + a.m11 * b.m11 + a.m12 * b.m21,
            m12 = a.m10 * b.m02 + a.m11 * b.m12 + a.m12 * b.m22,
            m20 = a.m20 * b.m00 + a.m21 * b.m10 + a.m22 * b.m20,
            m21 = a.m20 * b.m01 + a.m21 * b.m11 + a.m22 * b.m21,
            m22 = a.m20 * b.m02 + a.m21 * b.m12 + a.m22 * b.m22,
        };

        public static V3 operator *(Mat3 a, V3 v) => new V3(
            a.m00 * v.x + a.m01 * v.y + a.m02 * v.z,
            a.m10 * v.x + a.m11 * v.y + a.m12 * v.z,
            a.m20 * v.x + a.m21 * v.y + a.m22 * v.z);

        public V3 Column(int i) => i == 0 ? new V3(m00, m10, m20) : i == 1 ? new V3(m01, m11, m21) : new V3(m02, m12, m22);

        public static Mat3 Diag(double x, double y, double z) => new Mat3 { m00 = x, m11 = y, m22 = z };

        public static Mat3 RotZ(double a)
        {
            double c = Math.Cos(a), s = Math.Sin(a);
            return new Mat3 { m00 = c, m01 = -s, m10 = s, m11 = c, m22 = 1 };
        }

        /// <summary>Raise +x towards +z.</summary>
        public static Mat3 RotPitch(double a)
        {
            double c = Math.Cos(a), s = Math.Sin(a);
            return new Mat3 { m00 = c, m02 = -s, m11 = 1, m20 = s, m22 = c };
        }

        /// <summary>Raise +y towards +z.</summary>
        public static Mat3 RotRoll(double a)
        {
            double c = Math.Cos(a), s = Math.Sin(a);
            return new Mat3 { m00 = 1, m11 = c, m12 = -s, m21 = s, m22 = c };
        }

        /// <summary>Degrees: yaw about z, then pitch, then roll, all in the local frame.</summary>
        public static Mat3 YPR(double yaw, double pitch, double roll) => RotZ(M.Rad(yaw)) * RotPitch(M.Rad(pitch)) * RotRoll(M.Rad(roll));
    }
}

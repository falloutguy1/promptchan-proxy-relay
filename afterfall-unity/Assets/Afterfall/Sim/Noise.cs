using System;

namespace Afterfall.Sim
{
    /// <summary>Seeded 2D gradient noise and fractal sums.</summary>
    public sealed class Noise
    {
        readonly int[] p = new int[512];
        readonly double[] gx = new double[256], gy = new double[256];

        public Noise(long seed)
        {
            var rng = new Rng(seed * 7919 + 17);
            var perm = new int[256];
            for (int i = 0; i < 256; i++) perm[i] = i;
            rng.Shuffle(perm);
            for (int i = 0; i < 512; i++) p[i] = perm[i & 255];
            for (int i = 0; i < 256; i++)
            {
                double a = rng.Random() * M.TAU;
                gx[i] = Math.Cos(a);
                gy[i] = Math.Sin(a);
            }
        }

        public double Value(double x, double y)
        {
            double fx = Math.Floor(x), fy = Math.Floor(y);
            int xi = (int)((long)fx & 255), yi = (int)((long)fy & 255);
            double xf = x - fx, yf = y - fy;
            double u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
            double v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
            double n00 = Grad(xi, yi, xf, yf), n10 = Grad(xi + 1, yi, xf - 1, yf);
            double n01 = Grad(xi, yi + 1, xf, yf - 1), n11 = Grad(xi + 1, yi + 1, xf - 1, yf - 1);
            double a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
            return (a + v * (b - a)) * 1.41;
        }

        double Grad(int ix, int iy, double dx, double dy)
        {
            int h = p[p[ix] + iy];
            return gx[h] * dx + gy[h] * dy;
        }

        public double Fbm(double x, double y, int octaves = 4)
        {
            double total = 0, amp = 1, freq = 1, norm = 0;
            for (int i = 0; i < octaves; i++)
            {
                total += amp * Value(x * freq + 17.31 * i, y * freq - 9.17 * i);
                norm += amp;
                amp *= .5;
                freq *= 2.03;
            }
            return total / norm;
        }
    }
}

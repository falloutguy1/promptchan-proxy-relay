"""Seeded, vectorised gradient noise."""
import numpy as np


class Noise:
    def __init__(self, seed: int):
        rng = np.random.default_rng(seed)
        perm = rng.permutation(256)
        self.p = np.concatenate([perm, perm]).astype(np.int64)
        angles = rng.random(256) * 2 * np.pi
        self.gx, self.gy = np.cos(angles), np.sin(angles)

    def noise(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        xf, yf = x - xi, y - yi
        xi &= 255
        yi &= 255
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        p = self.p

        def grad(ix, iy, dx, dy):
            h = p[p[ix] + iy]
            return self.gx[h] * dx + self.gy[h] * dy

        n00 = grad(xi, yi, xf, yf)
        n10 = grad(xi + 1, yi, xf - 1, yf)
        n01 = grad(xi, yi + 1, xf, yf - 1)
        n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
        a = n00 + u * (n10 - n00)
        b = n01 + u * (n11 - n01)
        return (a + v * (b - a)) * 1.41

    def fbm(self, x, y, octaves=4):
        total, amp, freq, norm = 0.0, 1.0, 1.0, 0.0
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        for i in range(octaves):
            total = total + amp * self.noise(x * freq + 17.31 * i, y * freq - 9.17 * i)
            norm += amp
            amp *= 0.5
            freq *= 2.03
        return total / norm


def smooth(e0, e1, x):
    """Smoothstep that also works with e0 > e1 (falls instead of rises)."""
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

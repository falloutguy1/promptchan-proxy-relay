"""Sound effects synthesised with numpy at start-up (no audio files ship with the game)."""
import math
import wave
from pathlib import Path

import numpy as np

RATE = 22050
CACHE = Path.home() / ".cache" / "afterfall" / "sfx"


def _noise(n, seed):
    return np.random.default_rng(seed).uniform(-1, 1, n)


def _lowpass(x, a):
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


def _env(n, attack, decay):
    t = np.arange(n) / RATE
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def _sounds():
    s = {}
    n = int(RATE * 1.2)
    s["shot"] = _lowpass(_noise(n, 1), .5) * _env(n, .001, .12) * 1.6 + np.sin(2 * math.pi * 55 * np.arange(n) / RATE) * _env(n, .001, .15)
    n = int(RATE * 1.4)
    t = np.arange(n) / RATE
    f = 95 * (1 - .3 * t) * (1 + .03 * np.sin(2 * math.pi * 6 * t))
    saw = 2 * ((np.cumsum(f) / RATE) % 1) - 1
    s["groan"] = _lowpass(saw, .08) * _env(n, .25, .6) * 1.4
    n = int(RATE * .25)
    s["chop"] = (_lowpass(_noise(n, 2), .4) - _lowpass(_noise(n, 2), .05)) * _env(n, .001, .05) * 2
    s["hammer"] = np.sin(2 * math.pi * 900 * np.arange(n) / RATE) * _env(n, .001, .03) + _noise(n, 3) * _env(n, .001, .01)
    s["hit"] = _lowpass(_noise(n, 4), .15) * _env(n, .001, .08) * 2
    n = int(RATE * .6)
    s["thud"] = _lowpass(_noise(n, 5), .05) * _env(n, .005, .15) * 3
    s["hurt"] = np.sin(2 * math.pi * np.cumsum(np.linspace(260, 140, n)) / RATE) * _env(n, .01, .12)
    n = int(RATE * 2.2)
    s["fall"] = _lowpass(_noise(n, 6), .04) * _env(n, .3, .7) * 3
    n = int(RATE * 1.0)
    t = np.arange(n) / RATE
    s["done"] = sum(np.sin(2 * math.pi * fq * t) * _env(n, .01, .4) * (t > i * .12) for i, fq in enumerate((392, 494, 587))) * .4
    n = int(RATE * 4)
    wind = _lowpass(_noise(n, 7), .02)
    s["wind"] = wind / (np.abs(wind).max() + 1e-6) * .5 * (1 + .3 * np.sin(2 * math.pi * .25 * np.arange(n) / RATE))
    rain = _noise(n, 8) - _lowpass(_noise(n, 8), .3)
    s["rain"] = rain * .35
    crackle = np.zeros(n)
    rng = np.random.default_rng(9)
    for i in rng.integers(0, n - 200, 90):
        crackle[i:i + 200] += _noise(200, int(i)) * _env(200, .0005, .004) * rng.uniform(.3, 1)
    s["fire"] = crackle * .8 + _lowpass(_noise(n, 10), .03) * .4
    return s


def build():
    """Write the sound files once; returns name -> path."""
    CACHE.mkdir(parents=True, exist_ok=True)
    paths = {}
    missing = [n for n in ("shot", "groan", "chop", "hammer", "hit", "thud", "hurt", "fall", "done", "wind", "rain", "fire")
               if not (CACHE / f"{n}.wav").exists()]
    sounds = _sounds() if missing else {}
    for name in ("shot", "groan", "chop", "hammer", "hit", "thud", "hurt", "fall", "done", "wind", "rain", "fire"):
        path = CACHE / f"{name}.wav"
        if name in sounds:
            data = np.clip(sounds[name], -1, 1)
            with wave.open(str(path), "wb") as f:
                f.setnchannels(1)
                f.setsampwidth(2)
                f.setframerate(RATE)
                f.writeframes((data * 32000).astype(np.int16).tobytes())
        paths[name] = path
    return paths


class SoundBoard:
    """Plays one-shots with distance falloff and keeps ambient loops at the right level."""

    def __init__(self, base):
        self.base = base
        self.enabled = True
        try:
            paths = build()
            self.clips = {k: base.loader.loadSfx(str(v)) for k, v in paths.items()}
        except Exception:  # no audio device, read-only home, ...
            self.clips = {}
            self.enabled = False
        for loop in ("wind", "rain", "fire"):
            c = self.clips.get(loop)
            if c:
                c.set_loop(True)
                c.set_volume(0)
                c.play()

    def play(self, kind, dist):
        c = self.clips.get(kind)
        if not self.enabled or c is None:
            return
        reach = 400 if kind == "shot" else 80
        vol = max(0.0, 1 - dist / reach)
        if vol > .02:
            c.set_volume(vol * (.5 if kind in ("groan", "hammer") else .8))
            c.play()

    def ambient(self, wind, rain, fire):
        if not self.enabled:
            return
        for name, v in (("wind", wind), ("rain", rain), ("fire", fire)):
            c = self.clips.get(name)
            if c:
                c.set_volume(v)

"""What a survivor knows: places, remembered danger, recent threats, and notable moments."""
import math
from dataclasses import dataclass, field

import numpy as np

from ..config import DN, DCELL, HALF


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def rising(x, lo, hi, power=1.0):
    """0 below lo, 1 above hi, curved in between."""
    return clamp01((x - lo) / (hi - lo)) ** power


def falling(x, hi, lo, power=1.0):
    """1 below lo, 0 above hi."""
    return clamp01((hi - x) / (hi - lo)) ** power


@dataclass
class PlaceMemory:
    known: bool = False
    visits: int = 0
    last_visit: float = -1e9
    last_yield: int = 0
    scare: float = 0.0          # 0..1, fades: "almost died there"


@dataclass
class Threat:
    zid: int
    x: float
    y: float
    seen_at: float
    aware: bool                 # it is hunting me
    heard_only: bool = False


@dataclass
class Episode:
    t: float
    text: str
    place: str
    weight: float


class Memory:
    def __init__(self, n_places):
        self.places = [PlaceMemory() for _ in range(n_places)]
        self.danger = np.zeros((DN, DN), dtype=np.float32)
        self.threats: dict[int, Threat] = {}
        self.episodes: list[Episode] = []
        self.day_log = {"loots": 0, "found": 0, "kills": 0, "built": [], "close_calls": 0, "km": 0.0}

    # --- danger map ---

    def add_danger(self, x, y, amount, radius=15.0):
        ci, cj = int((x + HALF) / DCELL), int((y + HALF) / DCELL)
        r = int(radius // DCELL) + 1
        for j in range(max(0, cj - r), min(DN, cj + r + 1)):
            for i in range(max(0, ci - r), min(DN, ci + r + 1)):
                cx, cy = (i + .5) * DCELL - HALF, (j + .5) * DCELL - HALF
                d = math.hypot(cx - x, cy - y)
                if d < radius + DCELL:
                    self.danger[j, i] = min(4.0, self.danger[j, i] + amount * (1 - d / (radius + DCELL)))

    def danger_at(self, x, y):
        i = min(max(int((x + HALF) / DCELL), 0), DN - 1)
        j = min(max(int((y + HALF) / DCELL), 0), DN - 1)
        return float(self.danger[j, i])

    def decay(self, dt):
        # danger halves every 12 game hours; scares fade over two days
        self.danger *= 0.5 ** (dt / 720.0)
        for p in self.places:
            if p.scare:
                p.scare = max(0.0, p.scare - dt / 2880.0)

    # --- threats ---

    def see(self, zid, x, y, t, aware):
        self.threats[zid] = Threat(zid, x, y, t, aware)

    def hear(self, zid, x, y, t):
        old = self.threats.get(zid)
        if old is None or old.heard_only:
            self.threats[zid] = Threat(zid, x, y, t, False, heard_only=True)

    def forget_old(self, t):
        for zid in [k for k, v in self.threats.items() if t - v.seen_at > (60 if v.aware else 25)]:
            del self.threats[zid]

    def remember(self, t, text, place="", weight=1.0):
        self.episodes.append(Episode(t, text, place, weight))
        if len(self.episodes) > 40:
            self.episodes.pop(0)

    def inherit_from(self, other: "Memory"):
        """A new survivor finds the previous one's journal."""
        for mine, theirs in zip(self.places, other.places):
            mine.known = theirs.known
            mine.visits = theirs.visits
            mine.last_visit = theirs.last_visit
            mine.last_yield = theirs.last_yield
        self.danger[:] = other.danger * .5

"""Procedural world: terrain, roads, settlements, vegetation, and the spatial queries the AI relies on.

Coordinates are metres. x runs east, y runs north, z is height. The renderer maps (x, y, z) to
Ursina's (x, z, y).
"""
import heapq
import math
import random
from dataclasses import dataclass, field

import numpy as np

from .assets.catalog import material_of
from .config import HALF, HCELL, HN, PCELL, PN, DN, DCELL, CHUNK, POND, ROADS, SITES
from .noise import Noise, smooth


def hexcol(h):
    return ((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0


class Pal:
    PLASTER = [0xc9bb97, 0xa9b6b0, 0xd2cbbb, 0xc7a988, 0xb9b08f, 0x9fa89a]
    ROOF = [0x6d3024, 0x4b4f55, 0x5b4032]
    CORR = [0x7f8386, 0x6d4f3a, 0x5f6d5b]
    PLANKS = [0x7b6a55, 0x6a5c4d, 0x8a3b2c]
    CAR = [0x6b7c63, 0x8b9095, 0x7b2e23, 0xc8bf9f, 0x3e4d63, 0xa58d3c]
    PINE = [0x2b3f22, 0x31472a, 0x263a20]
    BIRCH_LEAF = [0x5a7a2a, 0x6b8a34]
    BUSH = [0x3a5226, 0x44602c]
    CONCRETE, DARK, GLASS, FRAME, FRAME_GREEN = 0x8f8b83, 0x141514, 0x1f272b, 0xd8d2c0, 0x4d6b56
    BRICK, PANEL, METAL, RUST, BURNT = 0x8a4b35, 0xa49f93, 0x5b5c5a, 0x7a4a2c, 0x262320
    TIRE, CHROME, CANVAS, OLIVE, SANDBAG = 0x1b1b1a, 0x9a9a96, 0x5d6444, 0x4d5238, 0x8a7d5c
    COPPER, BIRCH, BARK, ROCK, WATER = 0x5f8b78, 0xd9d6cc, 0x4a3a2c, 0x7c7a73, 0x2a3d44
    ASPHALT, DIRT_ROAD, LINE, HAY, RED = 0x3c3d3e, 0x5c4b37, 0xcdbe78, 0xb49a52, 0x7a2e24
    DEADWOOD, GRASS_TUFT, SOIL = 0x6e6558, 0x55632d, 0x3b2c1e


# --- rotation helpers (right-handed, z up) --------------------------------------------------

def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def rot_pitch(a):
    """Raise +x towards +z."""
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]], dtype=np.float64)


def rot_roll(a):
    """Raise +y towards +z."""
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def rot_ypr(yaw=0.0, pitch=0.0, roll=0.0):
    """Degrees: yaw about z, then pitch, then roll, all in the local frame."""
    return rot_z(math.radians(yaw)) @ rot_pitch(math.radians(pitch)) @ rot_roll(math.radians(roll))


@dataclass
class Part:
    shape: str            # cube | sphere | cylinder | cone
    m: np.ndarray         # 3x3 rotation * scale
    pos: np.ndarray       # world position
    color: tuple
    sway: float = 0.0     # wind sway weight for vegetation
    anchor: float | None = None  # ground height the sway is measured from
    mat: int = 0          # texture layer (assets.catalog), 0 = plain colour


@dataclass
class Obstacle:
    cx: float
    cy: float
    ex: float             # half depth along local x (front)
    ey: float             # half width along local y
    cs: float
    sn: float
    r: float

    def to_local(self, x, y):
        dx, dy = x - self.cx, y - self.cy
        return dx * self.cs + dy * self.sn, -dx * self.sn + dy * self.cs

    def from_local(self, lx, ly):
        return self.cx + lx * self.cs - ly * self.sn, self.cy + lx * self.sn + ly * self.cs


@dataclass
class LootSite:
    x: float
    y: float
    cx: float
    cy: float
    kind: str
    label: str
    site: str
    where: str
    idx: int = 0
    looted: bool = False
    restock_at: float = 0.0


@dataclass
class Tree:
    x: float
    y: float
    kind: str
    scale: float
    idx: int
    chunk: tuple
    alive: bool = True
    parts: list = field(default_factory=list)


@dataclass
class Site:
    name: str
    x: float
    y: float
    r: float
    kind: str
    h0: float = 0.0


class Kit:
    """Builds primitives in a structure's local frame (+x is the front) and emits world-space parts."""

    def __init__(self, world, x, y, yaw, z, pitch=0.0, roll=0.0, conform=False, sink=None, sway=0.0):
        self.w = world
        self.rb = rot_z(yaw) @ rot_pitch(pitch) @ rot_roll(roll)
        self.t = np.array([x, y, z], dtype=np.float64)
        self.base_z = z
        self.conform = conform
        self.sink = sink if sink is not None else world.static_parts
        self.sway = sway

    def emit(self, shape, color, size, loc=(0, 0, 0), rot=(0, 0, 0)):
        m = self.rb @ rot_ypr(*rot) @ np.diag(size)
        pos = self.t + self.rb @ np.asarray(loc, dtype=np.float64)
        if self.conform:
            pos[2] += self.w.ground_z(pos[0], pos[1]) - self.base_z
        self.sink.append(Part(shape, m, pos, hexcol(color), self.sway, self.base_z if self.sway else None, material_of(color)))

    def box(self, size, loc, color, rot=(0, 0, 0)):
        self.emit("cube", color, size, loc, rot)

    def cyl(self, d, h, loc, color, rot=(0, 0, 0)):
        self.emit("cylinder", color, (d, d, h), loc, rot)

    def sph(self, size, loc, color, rot=(0, 0, 0)):
        self.emit("sphere", color, size, loc, rot)

    def cone(self, d, h, loc, color, rot=(0, 0, 0)):
        self.emit("cone", color, (d, d, h), loc, rot)


# --- structure builders (local frame, metres) ---------------------------------------------------

SQ2 = math.sqrt(2)


def roof(k, span, length, top, ridge_along_y, roof_c, gable_c):
    """45 degree gabled roof: two slabs plus a rotated cube whose upper half forms the gables."""
    slab = span * 0.5 * SQ2 + 0.5
    a = span / SQ2
    zc = top + span * 0.25 + 0.08
    if ridge_along_y:
        k.box((slab, length + .6, .16), (span * .25, 0, zc), roof_c, (0, -45, 0))
        k.box((slab, length + .6, .16), (-span * .25, 0, zc), roof_c, (0, 45, 0))
        k.box((a, length - .1, a), (0, 0, top), gable_c, (0, 45, 0))
    else:
        k.box((length + .6, slab, .16), (0, span * .25, zc), roof_c, (0, 0, -45))
        k.box((length + .6, slab, .16), (0, -span * .25, zc), roof_c, (0, 0, 45))
        k.box((length - .1, a, a), (0, 0, top), gable_c, (0, 0, 45))


def window(k, rng, face, off, u, z, frame_c, shutters, shutter_c):
    """face 0:+x 1:-x 2:+y 3:-y; off = wall distance from centre; u = position along the wall."""
    along_x = face < 2

    def at(out, along, zz):
        return [(off + out, along, zz), (-off - out, along, zz), (along, off + out, zz), (along, -off - out, zz)][face]

    def sz(thick, wd, ht):
        return (thick, wd, ht) if along_x else (wd, thick, ht)

    def tilt(deg):
        return (0, 0, deg) if along_x else (0, deg, 0)

    k.box(sz(.12, 1.2, 1.4), at(.02, u, z), frame_c)
    roll = rng.random()
    if roll < .28:
        k.box(sz(.04, 1.0, 1.2), at(.07, u, z), Pal.DARK)
        k.box(sz(.05, 1.35, .18), at(.11, u, z + .2), rng.choice(Pal.PLANKS), tilt(-25))
        k.box(sz(.05, 1.35, .18), at(.12, u, z - .2), rng.choice(Pal.PLANKS), tilt(25))
    elif roll < .6:
        k.box(sz(.04, 1.0, 1.2), at(.07, u, z), Pal.DARK)
    else:
        k.box(sz(.04, 1.0, 1.2), at(.07, u, z), Pal.GLASS)
        k.box(sz(.05, .05, 1.2), at(.09, u, z), frame_c)
    if shutters and rng.random() < .6:
        k.box(sz(.05, .55, 1.3), at(.08, u - .85, z), shutter_c)
        k.box(sz(.05, .55, 1.3), at(.08, u + .85, z), shutter_c, tilt(14 if rng.random() < .3 else 0))


def door(k, rng, front, frame_c):
    k.box((.08, 1.3, 2.3), (front + .03, 0, 1.35), Pal.DARK)
    k.box((.2, 1.5, .12), (front + .05, 0, 2.54), frame_c)
    ang = rng.uniform(20, 70)
    r = math.radians(ang)
    k.box((.06, 1.05, 2.15), (front + .05 + math.sin(r) * .52, -.55 + math.cos(r) * .52, 1.28), Pal.PLANKS[1], (-ang, 0, 0))
    for i in range(3):
        k.box((.45, 1.8 - .25 * i, 2.4), (front + .3 + .4 * i, 0, .2 - .2 * i - 1.2), Pal.CONCRETE)


def house(k, rng, d, w, floors, ruined, brick, corr):
    wall = Pal.BRICK if brick else rng.choice(Pal.PLASTER)
    frame_c = Pal.FRAME if rng.random() < .5 else Pal.FRAME_GREEN
    shutters = rng.random() < .5
    shutter_c = rng.choice(Pal.PLANKS)
    k.box((d + .5, w + .5, 1.4), (0, 0, -.5), Pal.CONCRETE)
    for f in range(floors):
        k.box((d, w, 3.0), (0, 0, .2 + 3 * f + 1.5), wall)
    ny, nx = max(1, int((w - 1.2) / 2.6)), max(1, int((d - 1.2) / 2.6))
    for f in range(floors):
        z = .2 + 3 * f + 1.65
        for i in range(ny):
            u = -w / 2 + (i + .5) * w / ny
            if not (f == 0 and abs(u) < 1.2):
                window(k, rng, 0, d / 2, u, z, frame_c, shutters, shutter_c)
            if rng.random() < .8:
                window(k, rng, 1, d / 2, u, z, frame_c, shutters, shutter_c)
        for i in range(nx):
            u = -d / 2 + (i + .5) * d / nx
            window(k, rng, 2, w / 2, u, z, frame_c, shutters, shutter_c)
            window(k, rng, 3, w / 2, u, z, frame_c, shutters, shutter_c)
    door(k, rng, d / 2, frame_c)
    top = .2 + 3 * floors
    if not ruined:
        roof(k, d, w, top, True, rng.choice(Pal.CORR) if corr else rng.choice(Pal.ROOF), wall)
        cx = rng.uniform(-d / 5, d / 5)
        k.box((.7, .7, 1.8), (cx, rng.uniform(-w / 3, w / 3), top + (d / 2 - abs(cx)) + .3), Pal.BRICK)
        k.cyl(.12, top, (d / 2 + .05, w / 2 + .05, top / 2), Pal.METAL)
        if rng.random() < .5:
            ay = rng.uniform(-w / 3, w / 3)
            k.cyl(.05, 2.4, (0, ay, top + d / 2 + 1.1), Pal.METAL)
            for i in range(4):
                k.box((.9 - i * .15, .03, .03), (0, ay, top + d / 2 + 1.6 + i * .18), Pal.METAL, (20, 0, 0))
    else:
        for i in range(5):
            k.box((d + .6, .18, .2), (0, -w / 2 + (i + .5) * w / 5, top + rng.uniform(0, .9)), Pal.BURNT,
                  (0, rng.uniform(-8, 8), rng.uniform(-14, 14)))
        k.box((d - .1, w - .1, .05), (0, 0, top - .02), Pal.BURNT)
        for _ in range(14):
            s = rng.uniform(.2, .8)
            k.box((s, s, s * .6), (rng.uniform(-d / 2 - 2, d / 2 + 2), rng.uniform(-w / 2 - 2, w / 2 + 2), s * .2),
                  Pal.CONCRETE if rng.random() < .5 else wall, (rng.uniform(0, 180), rng.uniform(0, 60), rng.uniform(0, 60)))


def apartment(k, rng):
    d, w, fh, floors = 11.0, 26.0, 2.9, 4
    k.box((d + .4, w + .4, 1.4), (0, 0, -.5), Pal.CONCRETE)
    for f in range(floors):
        k.box((d, w, fh), (0, 0, .2 + fh * f + fh / 2), Pal.PANEL)
    for f in range(floors):
        z = .2 + fh * f + 1.55
        for i in range(9):
            u = -w / 2 + (i + .5) * w / 9
            if not (f == 0 and i in (2, 6)):
                window(k, rng, 0, d / 2, u, z, Pal.FRAME, False, 0)
            window(k, rng, 1, d / 2, u, z, Pal.FRAME, False, 0)
            if f > 0 and i in (1, 4, 7):
                k.box((1.2, 2.6, .14), (-d / 2 - .6, u, .2 + fh * f + .07), Pal.CONCRETE)
                k.box((.08, 2.6, 1.0), (-d / 2 - 1.18, u, .2 + fh * f + .6), Pal.CORR[0] if rng.random() < .5 else Pal.CONCRETE)
    for u in (-w / 2 + 2.5 * w / 9, -w / 2 + 6.5 * w / 9):
        k.box((.08, 1.5, 2.3), (d / 2 + .02, u, 1.35), Pal.DARK)
        k.box((1.4, 2.2, .14), (d / 2 + .7, u, 2.7), Pal.CONCRETE)
        k.box((1.4, 2.2, 1.6), (d / 2 + .7, u, -.6), Pal.CONCRETE)
    top = .2 + fh * floors
    for sx, sy, lx, ly in ((.3, w + .3, d / 2, 0), (.3, w + .3, -d / 2, 0), (d, .3, 0, w / 2), (d, .3, 0, -w / 2)):
        k.box((sx, sy, .6), (lx, ly, top + .3), Pal.CONCRETE)
    k.box((d, w, .1), (0, 0, top + .05), Pal.BURNT)
    k.box((3, 3, 2.4), (0, w / 4, top + 1.2), Pal.CONCRETE)


def church(k):
    d, w = 15.0, 8.0
    k.box((d + .4, w + .4, 1.4), (0, 0, -.5), Pal.CONCRETE)
    k.box((d, w, 6), (0, 0, 3.2), Pal.PLASTER[2])
    roof(k, w, d, 6.2, False, Pal.ROOF[1], Pal.PLASTER[2])
    tx = d / 2 + 2.3
    k.box((4.6, 4.6, 13), (tx, 0, 6.5), Pal.PLASTER[2])
    k.box((5, 5, .4), (tx, 0, 13.1), Pal.FRAME)
    k.cyl(3.2, 1.6, (tx, 0, 14.1), Pal.PLASTER[2])
    k.sph((3.8, 3.8, 5.1), (tx, 0, 16), Pal.COPPER)
    k.cone(.7, 1.6, (tx, 0, 18.6), Pal.COPPER)
    k.box((.1, .1, 1.6), (tx, 0, 20), Pal.METAL)
    k.box((.1, .9, .1), (tx, 0, 20.3), Pal.METAL)
    k.box((.1, .6, .1), (tx, 0, 19.7), Pal.METAL, (0, 0, 20))
    for i in range(4):
        for s in (-1, 1):
            k.box((.9, .12, 2.4), (-d / 2 + 2 + i * 3.6, s * (w / 2 + .01), 3.4), Pal.DARK)
    k.box((.1, 1.6, 2.8), (tx + 2.31, 0, 1.6), Pal.DARK)
    return 2.3


def gas_station(k):
    k.box((14, 20, .3), (0, 0, 0), Pal.CONCRETE)
    for x in (-2, 4):
        for y in (-5, 5):
            k.cyl(.36, 5, (x, y, 2.6), Pal.FRAME)
    k.box((8.5, 13, .7), (1, 0, 5.3), Pal.CORR[0])
    k.box((8.7, 13.2, .3), (1, 0, 5.75), Pal.RED)
    for y in (-2.2, 2.2):
        k.box((.5, .8, 1.7), (1, y, 1), Pal.RED)
        k.box((.52, .6, .4), (1, y, 1.4), Pal.DARK)
    k.box((4.5, 9, 3.2), (-4.5, 0, 1.75), Pal.PLASTER[1])
    k.box((4.9, 9.4, .3), (-4.5, 0, 3.45), Pal.CONCRETE)
    k.box((.05, 3.5, 1.8), (-2.24, -2, 1.8), Pal.GLASS)
    k.box((.06, 1.2, 2.2), (-2.24, 2.5, 1.25), Pal.DARK)
    k.cyl(.3, 8, (6.5, 8.5, 4), Pal.METAL)
    k.box((.2, 3.6, 1), (6.5, 8.5, 7.6), Pal.RED)


def barn(k, rng):
    d, w, h = 20.0, 13.0, 6.0
    k.box((d + .4, w + .4, 1), (0, 0, -.3), Pal.CONCRETE)
    k.box((d, w, h), (0, 0, h / 2 + .2), Pal.PLANKS[2])
    roof(k, w, d, h + .2, False, Pal.CORR[1], Pal.PLANKS[2])
    k.box((.1, 4.4, 4.6), (d / 2 + .03, 0, 2.5), Pal.DARK)
    k.box((.12, 2.2, 4.4), (d / 2 + .9, -3, 2.5), Pal.PLANKS[0], (-50, 0, 0))
    for _ in range(6):
        k.cyl(1.4, 1.2, (d / 2 + rng.uniform(3, 8), rng.uniform(-w / 2 - 3, w / 2 + 3), .7), Pal.HAY, (rng.uniform(0, 180), 0, 90))


def tent(k):
    a = 4.4 / SQ2
    k.box((6.2, a, a), (0, 0, 0), Pal.CANVAS, (0, 0, 45))
    k.box((.02, 1.2, 1.8), (3.11, 0, .9), Pal.DARK)
    for x in (-3.1, 3.1):
        k.cyl(.1, 2.6, (x, 0, 1.3), Pal.METAL)


def watchtower(k, c, deck):
    h = 6.0
    for x in (-1.3, 1.3):
        for y in (-1.3, 1.3):
            k.cyl(.26, h, (x, y, h / 2), c)
    for i in range(2):
        k.box((.08, .08, 3.6), (0, -1.3, h * .3 + i * 2.2), c, (0, 45 if i else -45, 0))
        k.box((.08, .08, 3.6), (-1.3, 0, h * .3 + i * 2.2), c, (0, 0, 45 if i else -45))
    k.box((3.4, 3.4, .2), (0, 0, h), deck)
    for s in (-1.66, 1.66):
        k.box((3.4, .08, 1), (0, s, h + .6), deck)
        k.box((.08, 3.4, 1), (s, 0, h + .6), deck)
    for x in (-1.6, 1.6):
        for y in (-1.6, 1.6):
            k.cyl(.12, 2.2, (x, y, h + 1.1), c)
    k.cone(5.6, 1.2, (0, 0, h + 2.8), Pal.CORR[1])
    for i in range(9):
        k.box((.08, .6, .08), (1.75, 0, .5 + i * .62), c)


def car(k, rng, burned, truck):
    paint = Pal.BURNT if burned else rng.choice(Pal.CAR)
    length, w = (6.4, 2.3) if truck else (4.2, 1.75)
    k.box((length, w, .72), (0, 0, .72), paint)
    cab_x, cab_l = (length / 2 - 1.2, 1.9) if truck else (-.2, 2.1)
    k.box((cab_l, w - .14, .66), (cab_x, 0, 1.41), paint)
    k.box((cab_l * .8, w - .1, .5), (cab_x, 0, 1.43), Pal.DARK if burned else Pal.GLASS)
    k.box((.1, w - .2, .55), (cab_x + cab_l / 2 + .08, 0, 1.38), Pal.DARK if burned else Pal.GLASS, (0, -30, 0))
    wx, wr = length / 2 - (1.1 if truck else .85), (1.0 if truck else .72)
    wheels = [(wx, w / 2 - .1), (wx, -w / 2 + .1), (-wx, w / 2 - .1), (-wx, -w / 2 + .1)]
    if truck:
        wheels += [(-wx + 1.4, w / 2 - .1), (-wx + 1.4, -w / 2 + .1)]
    for x, y in wheels:
        if not burned and rng.random() < .12:
            continue
        k.cyl(wr, .26, (x, y, wr / 2), Pal.BURNT if burned else Pal.TIRE, (0, 0, 90))
        if not burned:
            k.cyl(wr * .5, .28, (x, y, wr / 2), Pal.CHROME, (0, 0, 90))
    k.box((.12, w + .05, .22), (length / 2 + .04, 0, .5), Pal.BURNT if burned else Pal.CHROME)
    k.box((.12, w + .05, .22), (-length / 2 - .04, 0, .5), Pal.BURNT if burned else Pal.CHROME)
    if truck:
        k.cyl(2.4, 3.8, (-.9, 0, 1.1), Pal.CANVAS, (0, 90, 0))


def well(k):
    k.cyl(2, 1, (0, 0, .5), Pal.CONCRETE)
    k.cyl(1.5, 1.02, (0, 0, .52), Pal.DARK)
    for y in (-.8, .8):
        k.box((.12, .12, 2), (0, y, 1.5), Pal.PLANKS[0])
    roof(k, 1.4, 2.2, 2.5, False, Pal.PLANKS[0], Pal.PLANKS[0])


def fence(k, rng, length, c):
    posts = max(2, int(length / 2.2))
    for i in range(posts + 1):
        if rng.random() < .12:
            continue
        k.box((.12, .12, 1.3), (0, -length / 2 + i * length / posts, .6), c, (0, rng.uniform(-6, 6), 0))
    for z in (.45, 1.0):
        for i in range(posts):
            if rng.random() < .8:
                k.box((.04, length / posts, .1), (.07, -length / 2 + (i + .5) * length / posts, z), c)


# --- the world ----------------------------------------------------------------------------------

class World:
    def __init__(self, seed: int):
        self.seed = seed
        self.rng = random.Random(seed)
        self.noise = Noise(seed)
        self.sites = [Site(*s) for s in SITES]
        self.base = self.sites[4]
        self.pond = POND
        self.static_parts: list[Part] = []
        self.obstacles: list[Obstacle] = []
        self.loot: list[LootSite] = []
        self.trees: list[Tree] = []
        self.wells: list[tuple] = []
        self.roads = []
        self.pal_segments = [False] * 4
        self.pal_r = 17.5
        self.gate_angle = -math.pi / 2   # towards the access track (south of the map is +y... track comes from lower y)
        self._build_roads()
        self._build_road_field()
        self._build_heights()
        self._build_colors()
        self._build_settlements()
        self._build_vegetation()
        self._build_obstacle_hash()
        self.rebuild_blocking()

    # --- terrain ----------------------------------------------------------------------------

    def _big_h(self, x, y):
        n = self.noise
        return n.fbm(x * .003, y * .003, 4) * 30 + n.fbm(x * .011 + 100, y * .011 - 40, 3) * 6.5

    def _det_h(self, x, y):
        n = self.noise
        return n.fbm(x * .03 + 7, y * .03 + 3, 3) * 1.8 + n.noise(x * .13, y * .13) * .28

    def _build_roads(self):
        for asphalt, width, pts in ROADS:
            pts = [np.array(p, dtype=np.float64) for p in pts]
            dense = []
            for i in range(len(pts) - 1):
                p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(len(pts) - 1, i + 2)]
                for k in range(24):
                    t = k / 24
                    t2, t3 = t * t, t * t * t
                    dense.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            dense.append(pts[-1])
            samples = [dense[0]]
            carry = 0.0
            for a, b in zip(dense, dense[1:]):
                seg = float(np.linalg.norm(b - a))
                t = 1.0 - carry
                while t <= seg:
                    samples.append(a + (b - a) * (t / seg))
                    t += 1.0
                carry = seg - (t - 1.0)
            self.roads.append({"asphalt": asphalt, "w": width, "samples": np.array(samples)})

    def _build_road_field(self):
        s = HN + 1
        xs = np.arange(s) * HCELL - HALF
        self.gx, self.gy = np.meshgrid(xs, xs)  # [row=y, col=x]
        rd = np.full((s, s), 999.0)
        rad = 18
        for road in self.roads:
            for px, py in road["samples"]:
                i0, i1 = max(0, int((px - rad + HALF) / HCELL)), min(HN, int((px + rad + HALF) / HCELL) + 1)
                j0, j1 = max(0, int((py - rad + HALF) / HCELL)), min(HN, int((py + rad + HALF) / HCELL) + 1)
                sub = np.hypot(self.gx[j0:j1 + 1, i0:i1 + 1] - px, self.gy[j0:j1 + 1, i0:i1 + 1] - py) - road["w"] / 2
                np.minimum(rd[j0:j1 + 1, i0:i1 + 1], sub, out=rd[j0:j1 + 1, i0:i1 + 1])
        self.rd = rd

    def _build_heights(self):
        x, y = self.gx, self.gy
        for s in self.sites:
            s.h0 = float(self._big_h(s.x, s.y))
        px, py, pr = self.pond
        pond_h0 = float(self._big_h(px, py))
        self.water_z = pond_h0 - 1.4
        h = self._big_h(x, y) + self._det_h(x, y) * smooth(-1, 7, self.rd)
        e = np.maximum(np.abs(x), np.abs(y)) / HALF
        h += np.power(smooth(.68, 1, e), 1.5) * 70 * (.75 + .5 * (self.noise.fbm(x * .02, y * .02, 3) * .5 + .5))
        det = self._det_h(x, y)
        for s in self.sites:
            d = np.hypot(x - s.x, y - s.y)
            wt = 1 - smooth(s.r * .55, s.r + 38, d)
            h = h + (s.h0 + det * .18 - h) * wt
        pd = np.hypot(x - px, y - py)
        pw = 1 - smooth(pr * .25, pr + 20, pd)
        h = h + (pond_h0 - 4.2 - h) * pw
        self.h = h

    def _build_colors(self):
        x, y, h, n = self.gx, self.gy, self.h, self.noise
        dhdx = np.gradient(h, HCELL, axis=1)
        dhdy = np.gradient(h, HCELL, axis=0)
        nz = 1 / np.sqrt(dhdx ** 2 + dhdy ** 2 + 1)
        self.normals = np.stack([-dhdx * nz, -dhdy * nz, nz], axis=-1)

        def c(hx):
            return np.array(hexcol(hx))

        n1 = n.fbm(x * .02, y * .02, 3) * .5 + .5
        n2 = n.fbm(x * .06 + 50, y * .06, 2)
        nf = n.fbm(x * .008 + 300, y * .008 - 200, 3)
        col = c(0x46542a) * (1 - n1[..., None]) + c(0x5d6230) * n1[..., None]

        def mix(col, target, wt):
            return col + (c(target) - col) * wt[..., None]

        col = mix(col, 0x857a47, np.where(n2 > .25, smooth(.25, .6, n2) * .7, 0))
        col = mix(col, 0x39401f, np.where(nf > -.02, smooth(-.02, .2, nf) * .6, 0))
        dirt = 1 - smooth(-.5, 3.5, self.rd)
        bare = dirt.copy()   # trampled ground for the textures: roads, towns, and only the camp's centre
        for s in self.sites:
            d = np.hypot(x - s.x, y - s.y)
            if s.kind == "base":
                dirt = np.maximum(dirt, (1 - smooth(4, s.r, d)) * .3)
                bare = np.maximum(bare, (1 - smooth(3, 12, d)) * .7)
            else:
                dirt = np.maximum(dirt, (1 - smooth(s.r * .3, s.r + 10, d)) * .45 * (n.fbm(x * .08, y * .08, 2) * .5 + .6))
                bare = np.maximum(bare, dirt)
        col = mix(col, 0x5a4a33, np.minimum(dirt, .85))
        col = mix(col, 0x6e6a61, smooth(.14, .34, 1 - nz))
        col = mix(col, 0x3d3326, np.where(h < self.water_z + 1.2, smooth(self.water_z + 1.2, self.water_z + .1, h), 0))
        col = mix(col, 0x8b8a80, np.where(h > 52, smooth(52, 66, h) * .8, 0))
        self.colors = np.clip(col, 0, 1)
        # the same masks as ground-material weights for the optional scanned textures: grass, forest floor, mud, rock
        sp = np.zeros(h.shape + (4,))
        sp[..., 0] = 1

        def lay(k, wt):
            wt = np.clip(wt, 0, 1)[..., None]
            one = np.zeros(4)
            one[k] = 1
            return sp * (1 - wt) + one * wt

        sp = lay(1, np.where(n2 > .3, smooth(.3, .7, n2) * .35, 0))
        sp = lay(1, np.where(nf > .05, smooth(.05, .3, nf) * .55, 0))
        sp = lay(1, np.minimum(bare * 1.2, .9))
        sp = lay(3, smooth(.12, .3, 1 - nz))
        sp = lay(2, np.where(h < self.water_z + 1.6, smooth(self.water_z + 1.6, self.water_z + .2, h), 0))
        sp = lay(3, np.where(h > 52, smooth(52, 64, h), 0))
        self.splat = sp

    def ground_z(self, x, y):
        fx = min(max((x + HALF) / HCELL, 0.0), HN - 1e-3)
        fy = min(max((y + HALF) / HCELL, 0.0), HN - 1e-3)
        i, j = int(fx), int(fy)
        tx, ty = fx - i, fy - j
        h = self.h
        a, b, c, d = h[j, i], h[j, i + 1], h[j + 1, i + 1], h[j + 1, i]
        # same diagonal split as the rendered mesh, so feet land exactly on the surface
        if tx >= ty:
            return float(a + (b - a) * tx + (c - b) * ty)
        return float(a + (d - a) * ty + (c - d) * tx)

    def slope(self, x, y):
        e = 1.5
        dx = self.ground_z(x + e, y) - self.ground_z(x - e, y)
        dy = self.ground_z(x, y + e) - self.ground_z(x, y - e)
        return math.hypot(dx, dy) / (2 * e)

    def road_dist(self, x, y):
        i = min(max(int(round((x + HALF) / HCELL)), 0), HN)
        j = min(max(int(round((y + HALF) / HCELL)), 0), HN)
        return float(self.rd[j, i])

    def site_at(self, x, y):
        best, bd = None, 1e9
        for s in self.sites:
            d = math.hypot(s.x - x, s.y - y)
            if d < s.r + 40 and d < bd:
                best, bd = s, d
        return best

    # --- settlements ----------------------------------------------------------------------------

    def _overlaps(self, x, y, r):
        return any(math.hypot(o.cx - x, o.cy - y) < o.r + r for o in self.obstacles)

    def add_obstacle(self, x, y, d, w, yaw):
        o = Obstacle(x, y, d / 2, w / 2, math.cos(yaw), math.sin(yaw), math.hypot(d, w) / 2)
        self.obstacles.append(o)
        return o

    def add_loot(self, o, kind, label, front):
        px, py = o.from_local(o.ex + front, 0)
        s = self.site_at(o.cx, o.cy)
        if s is not None and s.kind == "base":
            s = None
        self.loot.append(LootSite(px, py, o.cx, o.cy, kind, label, s.name if s else "the roadside",
                                  f"in {s.name}" if s else "by the roadside", idx=len(self.loot)))

    def _try_place(self, s, d, w, min_r, max_r, face_road):
        for _ in range(120):
            a = self.rng.uniform(0, 2 * math.pi)
            r = self.rng.uniform(min_r, max_r)
            x, y = s.x + math.cos(a) * r, s.y + math.sin(a) * r
            rd = self.road_dist(x, y)
            need = max(d, w) / 2 + 2.5
            if rd < need or (face_road and rd > need + 16):
                continue
            if self._overlaps(x, y, math.hypot(d, w) / 2 + 2.2):
                continue
            if math.hypot(x - self.pond[0], y - self.pond[1]) < self.pond[2] + 20:
                continue
            e = 2
            gx = self.road_dist(x + e, y) - self.road_dist(x - e, y)
            gy = self.road_dist(x, y + e) - self.road_dist(x, y - e)
            yaw = math.atan2(-gy, -gx) if face_road else self.rng.uniform(0, 2 * math.pi)
            return x, y, yaw
        return None

    def _seat(self, x, y, yaw, fit, d, w, sink=0.0):
        """Seat a footprint on the terrain so nothing hangs in the air on slopes."""
        cs, sn = math.cos(yaw), math.sin(yaw)

        def at(lx, ly):
            return self.ground_z(x + lx * cs - ly * sn, y + lx * sn + ly * cs)

        if fit == "tilt":
            hf, hb, hl, hr = at(d / 2, 0), at(-d / 2, 0), at(0, w / 2), at(0, -w / 2)
            z = min((hf + hb) / 2, (hl + hr) / 2) + abs(hf - hb) * .1 - sink
            return Kit(self, x, y, yaw, z, pitch=math.atan2(hf - hb, d), roll=math.atan2(hl - hr, w))
        if fit in ("skirt", "min"):
            hs = [at((i / 4 - .5) * d, (j / 4 - .5) * w) for i in range(5) for j in range(5)]
            lo, hi = min(hs), max(hs)
            if fit == "min":
                return Kit(self, x, y, yaw, lo - sink)
            k = Kit(self, x, y, yaw, hi - sink)
            drop = hi - lo
            if drop > .15:
                k.box((d + .5, w + .5, drop + 1.4), (0, 0, .15 - (drop + 1.4) / 2), Pal.CONCRETE)
            return k
        return Kit(self, x, y, yaw, self.ground_z(x, y) - sink, conform=(fit == "conform"))

    def _build_settlements(self):
        rng = self.rng
        town, vil, farm, mil = self.sites[:4]

        def place_house(s, kind):
            d, w = rng.uniform(6.5, 9), rng.uniform(7, 10.5)
            spot = self._try_place(s, d, w, 6, s.r, True)
            if not spot:
                return
            x, y, yaw = spot
            floors = 2 if s.kind == "town" and rng.random() < .45 else 1
            ruined = rng.random() < .16
            house(self._seat(x, y, yaw, "skirt", d, w, .05), rng, d, w, floors, ruined, rng.random() < .18, s.kind != "town" and rng.random() < .5)
            o = self.add_obstacle(x, y, d, w, yaw)
            label = "burnt-out house" if ruined else ("townhouse" if floors > 1 else "house") if s.kind == "town" else "cottage"
            self.add_loot(o, "ruin" if ruined else kind, label, 1.4)

        # town centre: church, apartment blocks, houses, fuel station
        x, y, yaw = town.x - 22, town.y + 22, -math.pi / 4
        off = church(self._seat(x, y, yaw, "skirt", 20, 8.4, .05))
        o = self.add_obstacle(x + math.cos(yaw) * off, y + math.sin(yaw) * off, 20, 8.4, yaw)
        self.add_loot(o, "church", "church", 1.5)
        g = self._seat(x - 18, y + 12, .7, "conform", 1, 1)
        for i in range(14):
            gx, gy = (i // 7) * 2.4, (i % 7) * 1.8
            g.box((.1, .1, 1.1), (gx, gy, .55), Pal.PLANKS[1])
            g.box((.1, .6, .1), (gx, gy, .85), Pal.PLANKS[1])
            g.sph((1.6, 1.0, .35), (gx + .9, gy, -.05), Pal.SOIL)
        for _ in range(2):
            spot = self._try_place(town, 11, 26, 18, town.r, True)
            if spot:
                x, y, yaw = spot
                apartment(self._seat(x, y, yaw, "skirt", 11.4, 26.4, .05), rng)
                self.add_loot(self.add_obstacle(x, y, 11, 26, yaw), "apartment", "apartment block", 1.5)
        for _ in range(17):
            place_house(town, "house")
        x, y, yaw = 64.0, 26.0, -math.pi / 2
        gas_station(self._seat(x, y, yaw, "skirt", 14, 20, .1))
        o = self.add_obstacle(x - math.cos(yaw) * 4.5, y - math.sin(yaw) * 4.5, 4.9, 9.4, yaw)
        self.add_loot(o, "gas", "fuel station", 1.2)

        for _ in range(10):
            place_house(vil, "cottage")
        spot = self._try_place(vil, 3, 3, 2, 14, False)
        if spot:
            x, y, _ = spot
            well(self._seat(x, y, 0, "min", 2, 2))
            self.add_obstacle(x, y, 2, 2, 0)
            self.wells.append((x + 1.6, y, "the well in Gorka"))
        spot = self._try_place(vil, 20, 13, 10, vil.r, True)
        if spot:
            x, y, yaw = spot
            barn(self._seat(x, y, yaw, "skirt", 20.4, 13.4), rng)
            self.add_loot(self.add_obstacle(x, y, 20, 13, yaw), "barn", "barn", 1.5)

        for _ in range(2):
            spot = self._try_place(farm, 20, 13, 6, farm.r, False)
            if spot:
                x, y, yaw = spot
                barn(self._seat(x, y, yaw, "skirt", 20.4, 13.4), rng)
                self.add_loot(self.add_obstacle(x, y, 20, 13, yaw), "barn", "barn", 1.5)
        for _ in range(2):
            spot = self._try_place(farm, 6.5, 6.5, 4, farm.r, False)
            if spot:
                x, y, _ = spot
                k = self._seat(x, y, 0, "min", 6, 6)
                k.cyl(6, 13, (0, 0, 6.5), Pal.CORR[0])
                k.cone(6.4, 2.2, (0, 0, 14.1), Pal.CORR[0])
                k.box((.08, .5, 13), (3.02, 0, 6.5), Pal.METAL)
                self.add_obstacle(x, y, 6, 6, 0)
        for _ in range(4):
            place_house(farm, "cottage")
        spot = self._try_place(farm, 6, 4, 6, farm.r, False)
        if spot:
            x, y, _ = spot
            well(self._seat(x, y, 0, "min", 2, 2))
            self.add_obstacle(x, y, 2, 2, 0)
            self.wells.append((x + 1.6, y, "the farm well"))

        for _ in range(5):
            spot = self._try_place(mil, 6.4, 4.6, 4, mil.r - 4, False)
            if spot:
                x, y, yaw = spot
                tent(self._seat(x, y, yaw, "min", 6.2, 4.4))
                self.add_loot(self.add_obstacle(x, y, 6.4, 4.6, yaw), "military", "army tent", 1.0)
        for _ in range(2):
            spot = self._try_place(mil, 4, 4, mil.r - 6, mil.r, False)
            if spot:
                x, y, yaw = spot
                watchtower(self._seat(x, y, yaw, "min", 2.8, 2.8), Pal.OLIVE, Pal.PLANKS[1])
                self.add_obstacle(x, y, 3, 3, yaw)
        spot = self._try_place(mil, 7, 3, 3, mil.r, False)
        if spot:
            x, y, yaw = spot
            car(self._seat(x, y, yaw, "tilt", 6.4, 2.3), rng, rng.random() < .3, True)
            self.add_loot(self.add_obstacle(x, y, 6.6, 2.5, yaw), "military", "army truck", .6)
        k = self._seat(mil.x, mil.y, 0, "conform", 1, 1)
        for i in range(60):
            a = i / 60 * 2 * math.pi
            if abs(math.sin(a * .5 - .3)) < .07:
                continue
            rr = mil.r - 1
            k.sph((.45, .8, .3), (math.cos(a) * rr, math.sin(a) * rr, .18 + (i % 2) * .28), Pal.SANDBAG, (math.degrees(a), 0, 0))
        for _ in range(12):
            s = rng.uniform(.7, 1.1)
            k.box((s, s * .8, s * .8), (rng.uniform(-mil.r * .6, mil.r * .6), rng.uniform(-mil.r * .6, mil.r * .6), s * .4), Pal.PLANKS[1], (rng.uniform(0, 90), 0, 0))

        # abandoned cars along the roads
        for road in self.roads:
            sm = road["samples"]
            for _ in range(len(sm) // 55):
                if rng.random() < .35:
                    continue
                i = rng.randint(10, len(sm) - 11)
                t = sm[i + 2] - sm[i - 2]
                t = t / np.linalg.norm(t)
                nrm = np.array([-t[1], t[0]])
                side = (-1 if rng.random() < .5 else 1) * rng.uniform(0, road["w"] * .45 + 2)
                cx, cy = sm[i] + nrm * side
                if self._overlaps(cx, cy, 3):
                    continue
                yaw = math.atan2(t[1], t[0]) + rng.uniform(-.4, .4) + (math.pi if rng.random() < .5 else 0)
                burned = rng.random() < .25
                car(self._seat(cx, cy, yaw, "tilt", 4.2, 1.8), rng, burned, False)
                self.add_loot(self.add_obstacle(cx, cy, 4.3, 1.9, yaw), "car", "burnt car" if burned else "abandoned car", .5)

        # telegraph poles with sagging wires along the main road
        road = self.roads[0]
        sm = road["samples"]
        prev = None
        for i in range(6, len(sm) - 6, 32):
            t = sm[i + 2] - sm[i - 2]
            t = t / np.linalg.norm(t)
            nrm = np.array([-t[1], t[0]])
            px, py = sm[i] + nrm * (road["w"] / 2 + 3.2)
            if self._overlaps(px, py, 1):
                prev = None
                continue
            yaw = math.atan2(t[1], t[0]) + math.pi / 2
            z = self.ground_z(px, py) - .1
            k = Kit(self, px, py, yaw, z)
            k.cyl(.26, 8, (0, 0, 4), Pal.PLANKS[1])
            k.box((.12, 1.8, .12), (0, 0, 7.6), Pal.PLANKS[1])
            tops = [np.array([px - math.sin(yaw) * o, py + math.cos(yaw) * o, z + 7.72]) for o in (-.8, 0, .8)]
            if prev:
                for a0, b0 in zip(prev, tops):
                    for seg in range(6):
                        a = a0 + (b0 - a0) * (seg / 6)
                        b = a0 + (b0 - a0) * ((seg + 1) / 6)
                        a[2] -= math.sin(seg / 6 * math.pi) * .9
                        b[2] -= math.sin((seg + 1) / 6 * math.pi) * .9
                        self._segment_part(a, b, .03, 0x1a1a18)
            prev = tops

        for s in (vil, farm):
            for _ in range(7):
                length = rng.uniform(12, 30)
                spot = self._try_place(s, 1, length, s.r * .5, s.r + 10, False)
                if spot:
                    x, y, yaw = spot
                    fence(self._seat(x, y, yaw, "conform", 1, length), rng, length, rng.choice(Pal.PLANKS))

        for _ in range(40):
            s = self.sites[rng.randint(0, 3)]
            a, r = rng.uniform(0, 2 * math.pi), rng.uniform(0, s.r)
            x, y = s.x + math.cos(a) * r, s.y + math.sin(a) * r
            if self._overlaps(x, y, 1) or self.road_dist(x, y) < .5:
                continue
            k = self._seat(x, y, rng.uniform(0, 2 * math.pi), "min", .9, .9)
            if rng.random() < .6:
                c = rng.choice([Pal.RUST, Pal.RED, Pal.OLIVE, 0x2c5a8a])
                if rng.random() < .3:
                    k.cyl(.6, .9, (0, 0, .3), c, (0, 90, 0))
                else:
                    k.cyl(.6, .9, (0, 0, .45), c)
            else:
                s2 = rng.uniform(.6, 1)
                k.box((s2, s2 * .8, s2 * .8), (0, 0, s2 * .4), Pal.PLANKS[1])

    def _segment_part(self, a, b, d, color):
        """A thin cylinder from a to b (used for wires)."""
        v = b - a
        length = float(np.linalg.norm(v))
        zaxis = v / length
        helper = np.array([1.0, 0, 0]) if abs(zaxis[0]) < .9 else np.array([0, 1.0, 0])
        xaxis = np.cross(helper, zaxis)
        xaxis /= np.linalg.norm(xaxis)
        yaxis = np.cross(zaxis, xaxis)
        rot = np.stack([xaxis, yaxis, zaxis], axis=1)
        self.static_parts.append(Part("cylinder", rot @ np.diag((d, d, length)), (a + b) / 2, hexcol(color), mat=material_of(color)))

    # --- vegetation ------------------------------------------------------------------------------

    def _build_vegetation(self):
        rng, n = self.rng, self.noise
        self.veg_parts: list[Part] = []  # bushes, rocks, grass; never removed
        px, py, pr = self.pond
        for _ in range(16000):
            x, y = rng.uniform(-HALF + 6, HALF - 6), rng.uniform(-HALF + 6, HALF - 6)
            nf = float(n.fbm(x * .008 + 300, y * .008 - 200, 3))
            forest = nf > -.02
            if not forest and rng.random() > .05:
                continue
            if forest and rng.random() > float(smooth(-.02, .25, nf)) * .9 + .1:
                continue
            if self.road_dist(x, y) < 4:
                continue
            if any(math.hypot(x - s.x, y - s.y) < s.r * (.7 if s.kind == "village" else .95) for s in self.sites):
                continue
            if math.hypot(x - px, y - py) < pr + 8 or self.slope(x, y) > .9 or self.ground_z(x, y) > 60 or self._overlaps(x, y, 1.5):
                continue
            kind = "dead" if rng.random() < .08 else ("birch" if (float(n.fbm(x * .02, y * .02, 2)) > .15 or not forest) else "pine")
            s = rng.uniform(.75, 1.45)
            chunk = (int((x + HALF) // CHUNK), int((y + HALF) // CHUNK))
            tree = Tree(x, y, kind, s, len(self.trees), chunk)
            k = Kit(self, x, y, rng.uniform(0, 2 * math.pi), self.ground_z(x, y) - .2 - self.slope(x, y) * .45 * s,
                    pitch=math.radians(rng.uniform(-2, 2)), roll=math.radians(rng.uniform(-2, 2)), sink=tree.parts)
            if kind == "pine":
                c = rng.choice(Pal.PINE)
                k.cyl(.5 * s, 4 * s, (0, 0, 2 * s), Pal.BARK)
                k.sway = .03
                for layer in range(5):
                    t = layer / 4
                    r, h = (2.9 + (.7 - 2.9) * t) * s, (3.4 + (2.2 - 3.4) * t) * s
                    k.cone(r * 2, h, (0, 0, 2.2 * s + layer * 1.8 * s + h / 2), c, (rng.uniform(0, 360), 0, 0))
            elif kind == "birch":
                k.cyl(.3 * s, 8.5 * s, (0, 0, 4.25 * s), Pal.BIRCH)
                k.sway = .05
                for _ in range(6):
                    dd = rng.uniform(1.8, 3.2) * s
                    k.sph((dd, dd, dd * .8), (rng.uniform(-1.2, 1.2) * s, rng.uniform(-1.2, 1.2) * s, rng.uniform(5.5, 8.8) * s), rng.choice(Pal.BIRCH_LEAF))
            else:
                k.cyl(.35 * s, 7 * s, (0, 0, 3.5 * s), Pal.DEADWOOD)
                for _ in range(4):
                    a, z = rng.uniform(0, 360), rng.uniform(3, 6) * s
                    k.cyl(.1 * s, 2.2 * s, (math.cos(math.radians(a)) * .6 * s, math.sin(math.radians(a)) * .6 * s, z + .6 * s), Pal.DEADWOOD, (a, -50, 0))
            self.trees.append(tree)
        self.tree_grid = {}
        for t in self.trees:
            self.tree_grid.setdefault((int(t.x // 10), int(t.y // 10)), []).append(t)

        placed = 0
        for _ in range(6000):
            if placed >= 900:
                break
            x, y = rng.uniform(-HALF + 6, HALF - 6), rng.uniform(-HALF + 6, HALF - 6)
            if self.road_dist(x, y) < 3 or self._overlaps(x, y, 2) or math.hypot(x - self.base.x, y - self.base.y) < self.base.r:
                continue
            sl = self.slope(x, y)
            if rng.random() > .12 + sl * 1.2:
                continue
            sc = rng.uniform(.6, 3) * (1 + sl * 1.5)
            k = Kit(self, x, y, rng.uniform(0, 2 * math.pi), self.ground_z(x, y) - sc * (.12 + sl * .25), sink=self.veg_parts)
            k.sph((sc * rng.uniform(.9, 1.6), sc * rng.uniform(.9, 1.4), sc * rng.uniform(.5, .9)), (0, 0, 0), Pal.ROCK, (0, rng.uniform(-20, 20), rng.uniform(-20, 20)))
            placed += 1

        placed = 0
        for _ in range(16000):
            if placed >= 2600:
                break
            x, y = rng.uniform(-HALF + 6, HALF - 6), rng.uniform(-HALF + 6, HALF - 6)
            if (self.road_dist(x, y) < 2.5 or self._overlaps(x, y, 1.2) or math.hypot(x - self.base.x, y - self.base.y) < self.base.r - 4
                    or math.hypot(x - px, y - py) < pr + 2):
                continue
            nf = float(n.fbm(x * .008 + 300, y * .008 - 200, 3))
            if rng.random() > (.5 if nf > -.1 else .12):
                continue
            sc = rng.uniform(.7, 1.6)
            k = Kit(self, x, y, rng.uniform(0, 2 * math.pi), self.ground_z(x, y) - .15 - self.slope(x, y) * .6 * sc, sink=self.veg_parts, sway=.12)
            k.sph((1.8 * sc, 1.5 * sc, 1.1 * sc), (0, 0, .35 * sc), rng.choice(Pal.BUSH))
            placed += 1

        placed = 0
        for _ in range(20000):
            if placed >= 6000:
                break
            s = rng.choice(self.sites)
            a, r = rng.uniform(0, 2 * math.pi), math.sqrt(rng.random()) * (s.r + 60)
            x, y = s.x + math.cos(a) * r, s.y + math.sin(a) * r
            if abs(x) > HALF - 5 or abs(y) > HALF - 5 or self.road_dist(x, y) < .5 or self._overlaps(x, y, .8):
                continue
            z = self.ground_z(x, y)
            if z < self.water_z + .3 or self.slope(x, y) > .55:
                continue
            k = Kit(self, x, y, rng.uniform(0, 2 * math.pi), z - .05, sink=self.veg_parts, sway=.35)
            k.cone(.45, rng.uniform(.35, .7), (0, 0, .2), Pal.GRASS_TUFT)
            placed += 1

    def trees_near(self, x, y, r):
        out = []
        cx, cy, cr = int(x // 10), int(y // 10), int(r // 10) + 1
        for i in range(cx - cr, cx + cr + 1):
            for j in range(cy - cr, cy + cr + 1):
                for t in self.tree_grid.get((i, j), ()):
                    if t.alive and abs(t.x - x) < r and abs(t.y - y) < r:
                        out.append(t)
        return out

    def fell_tree(self, tree):
        tree.alive = False
        k = Kit(self, tree.x, tree.y, 0, self.ground_z(tree.x, tree.y), sink=self.veg_parts)
        k.cyl(.55 * tree.scale, .6, (0, 0, .2), Pal.BIRCH if tree.kind == "birch" else Pal.BARK)
        self.dirty_chunks.add(tree.chunk)

    # --- grids, paths, collision --------------------------------------------------------------

    def _build_obstacle_hash(self):
        self.obs_grid = {}
        for o in self.obstacles:
            for i in range(int((o.cx - o.r) // 20), int((o.cx + o.r) // 20) + 1):
                for j in range(int((o.cy - o.r) // 20), int((o.cy + o.r) // 20) + 1):
                    self.obs_grid.setdefault((i, j), []).append(o)
        self.dirty_chunks = set()

    def add_dynamic_obstacle(self, x, y, d, w, yaw):
        """Obstacles created during play (homestead structures)."""
        o = self.add_obstacle(x, y, d, w, yaw)
        for i in range(int((o.cx - o.r) // 20), int((o.cx + o.r) // 20) + 1):
            for j in range(int((o.cy - o.r) // 20), int((o.cy + o.r) // 20) + 1):
                self.obs_grid.setdefault((i, j), []).append(o)
        i0, j0 = self.cell_of(x - o.r, y - o.r)
        i1, j1 = self.cell_of(x + o.r, y + o.r)
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                lx, ly = o.to_local(*self.cell_center(i, j))
                if abs(lx) < o.ex + .5 and abs(ly) < o.ey + .5:
                    self.block[j, i] |= 1
        return o

    def obstacles_near(self, x, y):
        return self.obs_grid.get((int(x // 20), int(y // 20)), ())

    def cell_of(self, x, y):
        return (min(max(int((x + HALF) / PCELL), 0), PN - 1), min(max(int((y + HALF) / PCELL), 0), PN - 1))

    def cell_center(self, i, j):
        return (i + .5) * PCELL - HALF, (j + .5) * PCELL - HALF

    def rebuild_blocking(self):
        """Path grid flags: 1 building, 2 water, 4 cliff, 8 wall, 16 gate (blocks the dead only)."""
        block = np.zeros((PN, PN), dtype=np.uint8)
        cost = np.ones((PN, PN), dtype=np.float32)
        px, py, pr = self.pond
        for j in range(PN):
            for i in range(PN):
                x, y = self.cell_center(i, j)
                z = self.ground_z(x, y)
                sl = self.slope(x, y)
                if math.hypot(x - px, y - py) < pr + 18 and z < self.water_z + .05:
                    block[j, i] |= 2
                if sl > 1.1:
                    block[j, i] |= 4
                cost[j, i] = (.55 if self.road_dist(x, y) < 0 else 1.0) * (1 + sl * 3)
        for o in self.obstacles:
            i0, j0 = self.cell_of(o.cx - o.r - 1, o.cy - o.r - 1)
            i1, j1 = self.cell_of(o.cx + o.r + 1, o.cy + o.r + 1)
            for j in range(j0, j1 + 1):
                for i in range(i0, i1 + 1):
                    lx, ly = o.to_local(*self.cell_center(i, j))
                    if abs(lx) < o.ex + .9 and abs(ly) < o.ey + .9:
                        block[j, i] |= 1
        for t in self.trees:
            if t.alive:
                i, j = self.cell_of(t.x, t.y)
                cost[j, i] += .6
        self.block = block
        self.cost = cost
        self._apply_palisade()

    def set_palisade(self, segments):
        self.pal_segments = list(segments)
        self._apply_palisade()

    def palisade_closed(self):
        return all(self.pal_segments)

    def segment_of_angle(self, ang):
        rel = (ang - self.gate_angle + math.pi) % (2 * math.pi) - math.pi
        return int(((rel + math.pi / 4) % (2 * math.pi)) // (math.pi / 2)) % 4, rel

    def _apply_palisade(self):
        b = self.base
        self.block &= ~np.uint8(8 | 16)
        i0, j0 = self.cell_of(b.x - self.pal_r - 4, b.y - self.pal_r - 4)
        i1, j1 = self.cell_of(b.x + self.pal_r + 4, b.y + self.pal_r + 4)
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                x, y = self.cell_center(i, j)
                if abs(math.hypot(x - b.x, y - b.y) - self.pal_r) > PCELL * .6:
                    continue
                seg, rel = self.segment_of_angle(math.atan2(y - b.y, x - b.x))
                if not self.pal_segments[seg]:
                    continue
                self.block[j, i] |= 16 if (seg == 0 and abs(rel) < .25) else 8

    def gate_point(self, r):
        return self.base.x + math.cos(self.gate_angle) * r, self.base.y + math.sin(self.gate_angle) * r

    def walkable(self, i, j, zombie=False):
        if not (0 <= i < PN and 0 <= j < PN):
            return False
        f = self.block[j, i]
        if f & (1 | 2 | 4 | 8):
            return False
        return not (zombie and f & 16)

    def line_walkable(self, ax, ay, bx, by, zombie=False):
        steps = max(1, int(math.hypot(bx - ax, by - ay) / (PCELL * .5)) + 1)
        for s in range(1, steps + 1):
            t = s / steps
            if not self.walkable(*self.cell_of(ax + (bx - ax) * t, ay + (by - ay) * t), zombie):
                return False
        return True

    def sight_clear(self, ax, ay, bx, by):
        """Buildings block line of sight (exact rectangle test); trees and terrain do not."""
        dx, dy = bx - ax, by - ay
        seen = set()
        steps = max(1, int(math.hypot(dx, dy) / 20) + 1)
        for s in range(steps + 1):
            t = s / steps
            for o in self.obstacles_near(ax + dx * t, ay + dy * t):
                if id(o) in seen:
                    continue
                seen.add(id(o))
                if o.ex < 1.2 and o.ey < 1.2:
                    continue
                if _segment_hits_box(o, ax, ay, bx, by):
                    return False
        return True

    def find_path(self, ax, ay, bx, by, zombie=False, danger=None, danger_weight=0.0, max_expand=12000):
        """Weighted A*: roads are cheap, slopes cost more, and remembered danger can be avoided."""
        start, goal = self._nearest_walkable(self.cell_of(ax, ay), zombie), self._nearest_walkable(self.cell_of(bx, by), zombie)
        if start == goal or (danger is None and self.line_walkable(ax, ay, bx, by, zombie)):
            return [(bx, by)], True
        block, cost = self.block, self.cost
        gi, gj = goal
        g = {start: 0.0}
        parent = {start: None}
        open_heap = [(0.0, start)]
        closed = set()
        found = False
        dirs = ((1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414))
        blocked_mask = 1 | 2 | 4 | 8 | (16 if zombie else 0)
        expanded = 0
        while open_heap and expanded < max_expand:
            _, cur = heapq.heappop(open_heap)
            if cur in closed:
                continue
            closed.add(cur)
            expanded += 1
            if cur == goal:
                found = True
                break
            ci, cj = cur
            gc = g[cur]
            for di, dj, dl in dirs:
                ni, nj = ci + di, cj + dj
                if not (0 <= ni < PN and 0 <= nj < PN) or block[nj, ni] & blocked_mask:
                    continue
                if di and dj and (block[cj, ni] & blocked_mask or block[nj, ci] & blocked_mask):
                    continue
                nxt = (ni, nj)
                if nxt in closed:
                    continue
                step = dl * cost[nj, ni]
                if danger is not None and danger_weight:
                    step += danger[nj * DN // PN, ni * DN // PN] * danger_weight
                ng = gc + step
                if ng < g.get(nxt, 1e18):
                    g[nxt] = ng
                    parent[nxt] = cur
                    h = math.hypot(ni - gi, nj - gj) * .65
                    heapq.heappush(open_heap, (ng + h, nxt))
        if not found:
            return [(bx, by)], False
        cells = []
        c = goal
        while c is not None:
            cells.append(self.cell_center(*c))
            c = parent[c]
        cells.reverse()
        cells[-1] = (bx, by)
        # string-pull, keeping segments short so the route still follows roads and avoids danger
        out, anchor, i = [], (ax, ay), 0
        while i < len(cells):
            best = i
            for j in range(i + 1, len(cells)):
                if math.hypot(cells[j][0] - anchor[0], cells[j][1] - anchor[1]) > 28:
                    break
                if self.line_walkable(anchor[0], anchor[1], cells[j][0], cells[j][1], zombie):
                    best = j
            out.append(cells[best])
            anchor = cells[best]
            i = best + 1
        return out, True

    def _nearest_walkable(self, cell, zombie):
        if self.walkable(*cell, zombie):
            return cell
        ci, cj = cell
        for r in range(1, 6):
            for dj in range(-r, r + 1):
                for di in range(-r, r + 1):
                    if max(abs(di), abs(dj)) == r and self.walkable(ci + di, cj + dj, zombie):
                        return ci + di, cj + dj
        return cell

    def resolve(self, x, y, radius=.4, zombie=False):
        """Push a moving body out of buildings, trunks, water and walls."""
        for o in self.obstacles_near(x, y):
            lx, ly = o.to_local(x, y)
            px, py = o.ex + radius - abs(lx), o.ey + radius - abs(ly)
            if px > 0 and py > 0:
                if px < py:
                    lx = math.copysign(o.ex + radius, lx or 1)
                else:
                    ly = math.copysign(o.ey + radius, ly or 1)
                x, y = o.from_local(lx, ly)
        for t in self.trees_near(x, y, 2):
            dx, dy = x - t.x, y - t.y
            d = math.hypot(dx, dy)
            r = .3 * t.scale + radius
            if 1e-3 < d < r:
                x, y = t.x + dx / d * r, t.y + dy / d * r
        px, py, pr = self.pond
        pd = math.hypot(x - px, y - py)
        if pd < pr + 18 and self.ground_z(x, y) < self.water_z - .15:
            x += (x - px) / max(pd, 1e-3) * .4
            y += (y - py) / max(pd, 1e-3) * .4
        b = self.base
        bd = math.hypot(x - b.x, y - b.y)
        if abs(bd - self.pal_r) < radius + .35 and bd > 1e-3:
            seg, rel = self.segment_of_angle(math.atan2(y - b.y, x - b.x))
            if self.pal_segments[seg] and not (seg == 0 and abs(rel) < .22 and not zombie):
                target = self.pal_r + (radius + .35) * (1 if bd > self.pal_r else -1)
                x, y = b.x + (x - b.x) / bd * target, b.y + (y - b.y) / bd * target
        return min(max(x, -HALF + 8), HALF - 8), min(max(y, -HALF + 8), HALF - 8)

    def shore_point(self, x, y):
        px, py, pr = self.pond
        d = math.hypot(x - px, y - py) or 1
        dx, dy = (x - px) / d, (y - py) / d
        r = pr * .5
        while r < pr + 18:
            sx, sy = px + dx * r, py + dy * r
            if self.ground_z(sx, sy) > self.water_z - .1:
                return sx, sy
            r += .4
        return px + dx * (pr + 18), py + dy * (pr + 18)


def _segment_hits_box(o, ax, ay, bx, by):
    """Slab test of segment a-b against an oriented rectangle."""
    lax, lay = o.to_local(ax, ay)
    lbx, lby = o.to_local(bx, by)
    t0, t1 = 0.0, 1.0
    for p0, p1, ext in ((lax, lbx, o.ex), (lay, lby, o.ey)):
        d = p1 - p0
        if abs(d) < 1e-9:
            if abs(p0) > ext:
                return False
            continue
        ta, tb = (-ext - p0) / d, (ext - p0) / d
        if ta > tb:
            ta, tb = tb, ta
        t0, t1 = max(t0, ta), min(t1, tb)
        if t0 > t1:
            return False
    # ignore touching the very ends (standing next to a wall is not "behind" it)
    return t1 - t0 > .02

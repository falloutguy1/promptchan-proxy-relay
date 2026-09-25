"""On-screen interface: survivor card, the AI's reasoning, event log, pack, homestead progress, minimap."""
import math
import textwrap

import numpy as np
from PIL import Image
from ursina import Entity, Text, Texture, camera, scene, window
from ursina.color import Color
from panda3d.core import Vec4

from ..config import HALF, WORLD

INK = Color(.914, .894, .839, 1)
DIM = Color(.66, .64, .57, 1)
FAINT = Color(.44, .42, .38, 1)
ACCENT = Color(.79, .64, .29, 1)
PANEL = Color(.055, .063, .05, .72)
BAR_BG = Color(1, 1, 1, .09)
BARS = [("Health", "health", Color(.75, .22, .17, 1)), ("Food", "food", Color(.79, .55, .24, 1)), ("Water", "water", Color(.44, .64, .72, 1)),
        ("Energy", "energy", Color(.83, .8, .68, 1)), ("Warmth", "warmth", Color(.85, .44, .23, 1)), ("Morale", "morale", Color(.5, .55, .34, 1)),
        ("Stress", "stress", Color(.62, .36, .55, 1))]
KIND_COLORS = {"bad": Color(.95, .62, .57, 1), "good": Color(.85, .88, .71, 1), "build": Color(.92, .82, .56, 1), "journal": Color(.75, .8, .9, 1)}


def _panel(x, y, w, h):
    return Entity(parent=camera.ui, model="quad", color=PANEL, origin=(-.5, .5), position=(x, y), scale=(w, h), z=1)


def _text(txt, x, y, scale=1.0, col=INK, parent=None, **kw):
    return Text(txt, parent=parent or camera.ui, position=(x, y), origin=(-.5, .5), scale=scale, color=col, **kw)


class Bar:
    def __init__(self, label, x, y, w, col):
        self.label = _text(label.upper(), x, y + .004, .72, DIM)
        self.bg = Entity(parent=camera.ui, model="quad", color=BAR_BG, origin=(-.5, 0), position=(x + .075, y - .007), scale=(w, .007))
        self.fill = Entity(parent=camera.ui, model="quad", color=col, origin=(-.5, 0), position=(x + .075, y - .007), scale=(w, .007), z=-.01)
        self.value = _text("", x + .085 + w, y + .004, .72, INK)
        self.w = w

    def set(self, v):
        v = max(0.0, min(100.0, v))
        self.fill.scale_x = max(.0001, self.w * v / 100)
        self.value.text = f"{v:.0f}"

    def all(self):
        return [self.label, self.bg, self.fill, self.value]


class Hud:
    def __init__(self, sim):
        self.sim = sim
        a = window.aspect_ratio
        L, R, T, B = -a / 2 + .02, a / 2 - .02, .48, -.48
        self.elements = []

        # survivor card
        self.card = _panel(L, T, .44, .42)
        self.name = _text("", L + .018, T - .016, 1.55)
        self.gen = _text("", L + .33, T - .022, .8, ACCENT)
        self.clock = _text("", L + .018, T - .06, .8, DIM)
        self.traits = _text("", L + .018, T - .085, .7, FAINT)
        self.bars = [Bar(lbl, L + .018, T - .122 - i * .026, .26, col) for i, (lbl, _, col) in enumerate(BARS)]
        self.keys = [k for _, k, _ in BARS]
        self.status = _text("", L + .018, T - .31, .72, ACCENT)
        self.thought = _text("", L + .018, T - .338, .8, INK)

        # the mind: why the survivor is doing what it's doing
        self.mind = _panel(R - .46, T - .33, .46, .36)
        _text("MIND", R - .445, T - .345, .78, DIM)
        self.doing = _text("", R - .38, T - .345, .78, ACCENT)
        self.rows = []
        for i in range(7):
            y = T - .38 - i * .041
            name = _text("", R - .445, y, .74, INK)
            bg = Entity(parent=camera.ui, model="quad", color=BAR_BG, origin=(-.5, 0), position=(R - .25, y - .009), scale=(.1, .006))
            fill = Entity(parent=camera.ui, model="quad", color=ACCENT, origin=(-.5, 0), position=(R - .25, y - .009), scale=(.1, .006), z=-.01)
            score = _text("", R - .14, y, .68, DIM)
            detail = _text("", R - .445, y - .018, .6, FAINT)
            self.rows.append((name, bg, fill, score, detail))
        self.memory = _text("", R - .445, T - .675, .62, FAINT)

        # minimap
        self.map_size = .3
        mx, my = R - self.map_size, T
        self.map_panel = _panel(mx - .01, my + .005, self.map_size + .02, self.map_size + .02)
        self.map = Entity(parent=camera.ui, model=self._map_mesh(), position=(mx, my - .005), scale=(self.map_size, self.map_size), z=.5)
        self.map.set_two_sided(True)
        self.map_origin = (mx, my - .005)
        dot = dict(parent=camera.ui, model="circle", z=-.1)
        self.me = Entity(color=ACCENT, scale=.012, **dot)
        self.zdots = [Entity(color=Color(.85, .25, .2, 1), scale=.006, **dot) for _ in sim.zombies]
        self.home_ring = Entity(parent=camera.ui, model=_ring(), color=ACCENT, scale=self.map_size * 17.5 * 2 / WORLD, z=-.05)
        self.grave_dots = []

        # log, pack and homestead
        self.log_panel = _panel(L, B + .2, .64, .19)
        self.log_lines = [(_text("", L + .015, B + .188 - i * .029, .66, FAINT), _text("", L + .1, B + .188 - i * .029, .72, INK)) for i in range(6)]
        self.pack_panel = _panel(R - .46, B + .2, .46, .19)
        _text("PACK", R - .445, B + .19, .74, DIM)
        self.weapon = _text("", R - .3, B + .19, .74, ACCENT)
        self.pack = _text("", R - .445, B + .16, .72, INK)
        _text("HOMESTEAD", R - .445, B + .1, .74, DIM)
        self.home_text = _text("", R - .445, B + .072, .7, INK)
        self.home_bar_bg = Entity(parent=camera.ui, model="quad", color=BAR_BG, origin=(-.5, 0), position=(R - .445, B + .018), scale=(.43, .008))
        self.home_bar = Entity(parent=camera.ui, model="quad", color=ACCENT, origin=(-.5, 0), position=(R - .445, B + .018), scale=(.43, .008), z=-.01)

        self.cam_label = Text("", parent=camera.ui, position=(0, T - .005), origin=(0, .5), scale=.8, color=INK)
        self.help = Text("1-4 cameras · drag to orbit · scroll zoom · space pause · [ ] speed · H hide HUD",
                         parent=camera.ui, position=(0, B + .005), origin=(0, -.5), scale=.65, color=DIM)
        self.hurt = Entity(parent=camera.ui, model="quad", color=Color(.6, .03, .02, 0), scale=(a * 1.1, 1.1), z=2)
        self.floaters = []
        self.tag = Text("", parent=camera.ui, origin=(0, 0), scale=.7, color=ACCENT)
        self.visible = True
        self.t = 0.0
        self.refresh_t = 0.0

    def _map_mesh(self, res=110):
        """Minimap as a grid of vertex-coloured quads (renders the same with or without shaders)."""
        from ursina import Mesh
        w = self.sim.world
        idx = (np.arange(res + 1) * (w.colors.shape[0] - 1) / res).astype(int)
        col = w.colors[idx][:, idx].copy()                    # [row = y (south to north), col = x]
        h = w.h[idx][:, idx]
        col *= np.clip(1 + (h - np.roll(h, 1, axis=1)) * .08, .6, 1.4)[..., None]
        col[w.rd[idx][:, idx] < 0] *= .5
        px, py, pr = w.pond
        near_pond = np.hypot(w.gx[idx][:, idx] - px, w.gy[idx][:, idx] - py) < pr + 16
        col[(h < w.water_z) & near_pond] = (.18, .27, .32)
        verts, cols, tris = [], [], []
        for j in range(res + 1):
            for i in range(res + 1):
                verts.append((i / res, j / res - 1, 0))       # top-left origin; north at the top
                r, g, b = np.clip(col[j, i], 0, 1)
                cols.append(Color(r, g, b, 1))
        for j in range(res):
            for i in range(res):
                a = j * (res + 1) + i
                tris += [a, a + res + 2, a + 1, a, a + res + 1, a + res + 2]
        for o in w.obstacles:
            if o.ex > 1.3:
                u, v = (o.cx + HALF) / WORLD, (o.cy + HALF) / WORLD
                b = len(verts)
                d = .006
                verts += [(u - d, v - 1 - d, -.01), (u + d, v - 1 - d, -.01), (u + d, v - 1 + d, -.01), (u - d, v - 1 + d, -.01)]
                cols += [Color(.86, .83, .74, 1)] * 4
                tris += [b, b + 2, b + 1, b, b + 3, b + 2]
        return Mesh(vertices=verts, triangles=tris, colors=cols)

    def _map_pos(self, x, y):
        mx, my = self.map_origin
        return mx + (x + HALF) / WORLD * self.map_size, my - (1 - (y + HALF) / WORLD) * self.map_size

    def toggle(self):
        self.visible = not self.visible
        for e in camera.ui.children:
            if e is not self.hurt:
                e.enabled = self.visible

    def float_text(self, pos3, text, kind):
        t = Text(text, parent=camera.ui, origin=(0, 0), scale=.85, color=KIND_COLORS.get(kind, INK) if kind != "gold" else ACCENT)
        self.floaters.append([t, pos3, 0.0])

    def _project(self, p):
        p3 = camera.getRelativePoint(scene, p)
        full = camera.lens.getProjectionMat().xform(Vec4(p3[0], p3[1], p3[2], 1))
        if full[3] <= 0:
            return None
        return full[0] / full[3] * camera.aspect_ratio / 2, full[1] / full[3] / 2

    def update(self, dt, director, speed, paused, survivor_pos):
        sim, s = self.sim, self.sim.survivor
        self.t += dt
        for item in self.floaters[:]:
            t, p, age = item
            item[2] += dt
            sp = self._project(p + (0, item[2] * .5, 0))
            if sp is None or item[2] > 2.6:
                if item[2] > 2.6:
                    t.enabled = False
                    self.floaters.remove(item)
                continue
            t.position = sp
            t.alpha = 1 - max(0.0, (item[2] - 1.6) / 1.0)
        sp = self._project(survivor_pos)
        far = (camera.world_position - survivor_pos).length() > 9
        self.tag.enabled = self.visible and sp is not None and far and director.mode != "chase"
        if sp:
            self.tag.position = (sp[0], sp[1] + .03)
            self.tag.text = s.first_name.upper()
        self.hurt.color = Color(.6, .03, .02, (.45 if s.hurt_t > 0 else 0) + (.12 + .08 * math.sin(self.t * 4) if s.health < 30 and s.alive else 0))
        self.refresh_t -= dt
        if self.refresh_t <= 0:
            self.refresh_t = .2
            self._refresh(director, speed, paused)

    def _refresh(self, director, speed, paused):
        sim, s = self.sim, self.sim.survivor
        T = s.traits
        self.name.text = s.name.upper()
        self.gen.text = f"GEN {sim.generation}"
        weather = {"clear": "Clear", "overcast": "Overcast", "rain": "Rain", "storm": "Heavy rain", "fog": "Fog"}[sim.weather]
        self.clock.text = f"DAY {sim.day}   {sim.clock()}   {weather}   {sim.temp:.0f}°C"
        top = sorted(T.items(), key=lambda kv: -kv[1])
        self.traits.text = "  ".join(f"{k.capitalize()} {v * 10:.0f}" for k, v in top[:4])
        for bar, key in zip(self.bars, self.keys):
            bar.set(getattr(s, key))
        chips = []
        if not s.alive:
            chips.append("DEAD")
        else:
            if s.bleeding:
                chips.append("BLEEDING")
            if s.food < 25:
                chips.append("HUNGRY")
            if s.water < 25:
                chips.append("THIRSTY")
            if s.energy < 20:
                chips.append("EXHAUSTED")
            if s.warmth < 30:
                chips.append("COLD")
            if any(t.aware for t in s.memory.threats.values()):
                chips.append("HUNTED")
            if sim.home.walls_closed and s.at_base():
                chips.append("BEHIND WALLS")
        self.status.text = "  ·  ".join(chips)
        self.thought.text = textwrap.fill(f"“{s.thought}”", 50) if s.thought else ""
        a = s.action
        self.doing.text = (a.name.upper() if a and not a.done else "—") + (f"  {a.progress * 100:.0f}%" if a and a.progress else "")
        for i, row in enumerate(self.rows):
            name, bg, fill, score, detail = row
            if i < len(s.scores):
                n, sc, d = s.scores[i]
                current = a is not None and a.name == n and i == 0
                name.text, score.text, detail.text = n, f"{sc:.2f}", d[:62]
                name.color = ACCENT if current else INK
                fill.scale_x = max(.0001, .1 * sc)
                for e in row:
                    e.enabled = self.visible
            else:
                for e in row:
                    e.enabled = False
        mem = s.memory
        known = sum(p.known for p in mem.places)
        hot = int((mem.danger > 1).sum())
        self.memory.text = f"Knows {known}/{len(mem.places)} places · {hot} danger zones remembered · {len(mem.threats)} infected tracked"
        for i, (st, tx) in enumerate(self.log_lines):
            ev = sim.events[-6 + i] if len(sim.events) >= 6 - i else None
            if ev:
                st.text, tx.text = ev[0], ev[1][:78]
                tx.color = KIND_COLORS.get(ev[2], INK)
            else:
                st.text = tx.text = ""
        inv = s.inv
        self.weapon.text = "RIFLE + AXE" if inv["rifle"] and inv["axe"] else "RIFLE" if inv["rifle"] else "AXE" if inv["axe"] else "BARE HANDS"
        self.pack.text = (f"Food {inv['food']}   Water {inv['water']}   Wood {inv['wood']}   Scrap {inv['scrap']}\n"
                          f"Nails {inv['nails']}   Ammo {inv['ammo']}   Bandages {inv['bandage']}   Med kits {inv['medkit']}")
        home = sim.home
        nxt = home.next_project()
        built = len(home.built)
        cost = ", ".join(f"{v} {k}" for k, v in nxt.cost.items()) if nxt else ""
        self.home_text.text = f"{built}/{len(home.projects)} built" + (f"   Next: {nxt.name} ({cost})" if nxt else "   Complete")
        self.home_bar.scale_x = max(.0001, .43 * built / len(home.projects))
        # minimap
        self.me.position = (*self._map_pos(s.x, s.y), -.1)
        for z, d in zip(sim.zombies, self.zdots):
            d.enabled = self.visible and z.alive
            if z.alive:
                d.position = (*self._map_pos(z.x, z.y), -.1)
                d.color = Color(1, .35, .27, 1) if z.state in ("chase", "attack") else Color(.7, .22, .18, 1)
        self.home_ring.position = (*self._map_pos(home.base.x, home.base.y), -.05)
        while len(self.grave_dots) < len(sim.graves):
            gx, gy, _ = sim.graves[len(self.grave_dots)]
            self.grave_dots.append(Entity(parent=camera.ui, model="quad", color=INK, scale=(.004, .012), position=(*self._map_pos(gx, gy), -.1)))
        state = "PAUSED" if paused else f"{speed:g}×"
        self.cam_label.text = f"{director.label}   ·   {state}"


def _ring():
    from ursina import Mesh
    pts = [(math.cos(a) * .5, math.sin(a) * .5, 0) for a in np.linspace(0, 2 * math.pi, 48)]
    return Mesh(vertices=pts, mode="line", thickness=2)

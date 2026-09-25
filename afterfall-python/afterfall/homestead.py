"""The homestead the survivors build, one project at a time."""
import math
from dataclasses import dataclass

from .world import Kit, Pal

PAL_R = 17.5


@dataclass
class Project:
    key: str
    name: str
    cost: dict
    at: tuple            # base-local position
    minutes: float       # build time
    stand: tuple         # where the builder stands
    yaw: float = 0.0
    needs: str = ""
    line: str = ""       # what the survivor thinks when it's done


def _seg_stand(seg, gate_angle):
    a = gate_angle + seg * math.pi / 2
    return (math.cos(a) * (PAL_R - 2.5), math.sin(a) * (PAL_R - 2.5))


def make_projects(gate_angle):
    return [
        Project("fire", "Campfire", {"wood": 2}, (0, 0), 20, (1.6, 1.2), line="Fire's going. The dark feels smaller."),
        Project("leanto", "Lean-to", {"wood": 5}, (-4.5, 4), 40, (-3, 2.5), yaw=-.7, line="A roof of sorts. Better than the open sky."),
        Project("barrel", "Rain collector", {"scrap": 2}, (5, 3.5), 25, (4, 2), line="Rain barrel's up. One less trip to the pond."),
        Project("garden1", "Vegetable patch", {"wood": 3}, (7.5, -4.5), 45, (5, -3), line="Seeds from a farmhouse cellar. Let's see if they take."),
        Project("crate", "Storage crate", {"wood": 3}, (-1.5, -5), 25, (-.5, -3.6), line="Somewhere to keep things that isn't my back."),
        Project("found", "Cabin foundation", {"wood": 8}, (-8, -7.5), 60, (-4.4, -5.5), line="Foundation's level. Almost."),
        Project("walls", "Log walls", {"wood": 12, "nails": 4}, (-8, -7.5), 95, (-4.4, -5.5), needs="found", line="Four walls. First time in months."),
        Project("roof", "Tin roof", {"wood": 4, "scrap": 4}, (-8, -7.5), 60, (-4.4, -5.5), needs="walls", line="A real roof. I could cry."),
        Project("pal1", "Palisade · east", {"wood": 8}, (0, 0), 70, _seg_stand(1, gate_angle), line="The east wall is up."),
        Project("pal2", "Palisade · south", {"wood": 8}, (0, 0), 70, _seg_stand(2, gate_angle), line="South side closed off."),
        Project("pal3", "Palisade · west", {"wood": 8}, (0, 0), 70, _seg_stand(3, gate_angle), line="West wall done. Just the gate left."),
        Project("pal0", "Palisade · gate", {"wood": 8, "nails": 2}, (0, 0), 80, _seg_stand(0, gate_angle), line="The gate closes. They can't just walk in anymore."),
        Project("tower", "Watchtower", {"wood": 10, "nails": 4}, (11, 9), 80, (9, 7), line="From up there I can see Staroye."),
        Project("garden2", "Second patch", {"wood": 3}, (7.5, -10), 45, (5, -9), line="Two patches now. Maybe enough for two people."),
        Project("gen", "Generator & floodlight", {"scrap": 6}, (3, 9), 60, (2, 7.5), line="Light. Actual electric light."),
        Project("flag", "Flag", {"scrap": 2}, (-3, 13), 30, (-2, 11.5), line="If anyone's out there, they'll see it."),
        Project("radio", "Radio mast", {"scrap": 8, "nails": 4}, (-11, 5), 120, (-9, 3.5), line="Broadcasting on 101.5. Someone has to be listening."),
    ]


class Homestead:
    def __init__(self, world):
        self.world = world
        self.base = world.base
        self.projects = make_projects(world.gate_angle)
        self.by_key = {p.key: p for p in self.projects}
        self.built: set[str] = set()
        self.paid: set[str] = set()
        self.progress: dict[str, float] = {}
        self.barrel_water = 1
        self.garden_food = 0
        self.fire_fuel = 4.0
        self.wall_hp = 100.0
        self.breached = None     # palisade segment knocked down by the infected
        self.changed = True      # renderer rebuilds when set

    def pos(self, local):
        return self.base.x + local[0], self.base.y + local[1]

    @property
    def fire_pos(self):
        return self.pos((0, 0))

    def next_project(self):
        for p in self.projects:
            if p.key not in self.built:
                return p
        return None

    def missing(self, p, inv):
        if p.key in self.paid:
            return {}
        return {k: v - inv.get(k, 0) for k, v in p.cost.items() if inv.get(k, 0) < v}

    def can_afford(self, p, inv):
        return not self.missing(p, inv)

    def pay(self, p, inv):
        if p.key not in self.paid:
            for k, v in p.cost.items():
                inv[k] -= v
            self.paid.add(p.key)

    def finish(self, p):
        self.built.add(p.key)
        self.progress.pop(p.key, None)
        self.changed = True
        if p.key.startswith("pal"):
            self.world.set_palisade([f"pal{i}" in self.built for i in range(4)])
        sizes = {"tower": (3, 3), "crate": (1.4, .9), "gen": (1.3, .9), "radio": (1.2, 1.2), "barrel": (1, 1)}
        if p.key in sizes:
            x, y = self.pos(p.at)
            self.world.add_dynamic_obstacle(x, y, *sizes[p.key], 0.0)

    @property
    def walls_built(self):
        return all(f"pal{i}" in self.built for i in range(4))

    @property
    def walls_closed(self):
        return self.walls_built and self.breached is None

    def bed(self):
        return self.pos((-8, -7.5)) if "roof" in self.built else self.pos((-4.2, 3.8))

    def inside(self, x, y, margin=1.0):
        return math.hypot(x - self.base.x, y - self.base.y) < PAL_R - margin

    # --- hourly upkeep ---

    def hourly(self, hour_index, raining):
        if "barrel" in self.built and (raining or hour_index % 24 == 6):
            self.barrel_water = min(4, self.barrel_water + 1)
        gardens = ("garden1" in self.built) + ("garden2" in self.built)
        if gardens and hour_index % 10 == 0:
            self.garden_food = min(6, self.garden_food + gardens)

    # --- geometry for the renderer (base-local kits) ---

    def build_parts(self, key):
        """Parts for one project, positioned in the world."""
        p = self.by_key[key]
        sink = []
        w = self.world
        if key.startswith("pal"):
            seg = int(key[3])
            self._palisade_parts(sink, seg)
            return sink
        x, y = self.pos(p.at)
        k = Kit(w, x, y, p.yaw, w.ground_z(x, y), sink=sink)
        getattr(self, f"_parts_{key.rstrip('12') if key.startswith('garden') else key}")(k)
        return sink

    def _palisade_parts(self, sink, seg):
        w, b = self.world, self.base
        a0 = w.gate_angle + seg * math.pi / 2 - math.pi / 4
        n = int(PAL_R * math.pi / 2 / .36)
        for i in range(n + 1):
            a = a0 + (math.pi / 2) * i / n
            rel = (a - w.gate_angle + math.pi) % (2 * math.pi) - math.pi
            if seg == 0 and abs(rel) < .2:
                continue
            x, y = b.x + math.cos(a) * PAL_R, b.y + math.sin(a) * PAL_R
            k = Kit(w, x, y, a, w.ground_z(x, y) - .3, sink=sink)
            k.cyl(.34, 3.2, (0, 0, 1.6), Pal.BARK if i % 3 else Pal.DEADWOOD)
            k.cone(.34, .5, (0, 0, 3.45), Pal.DEADWOOD)
        for z in (.9, 2.3):
            for i in range(0, n, 6):
                aa, ab = a0 + (math.pi / 2) * i / n, a0 + (math.pi / 2) * min(n, i + 6) / n
                xa, ya = b.x + math.cos(aa) * (PAL_R - .25), b.y + math.sin(aa) * (PAL_R - .25)
                xb, yb = b.x + math.cos(ab) * (PAL_R - .25), b.y + math.sin(ab) * (PAL_R - .25)
                mx, my = (xa + xb) / 2, (ya + yb) / 2
                k = Kit(w, mx, my, math.atan2(yb - ya, xb - xa), w.ground_z(mx, my), sink=sink)
                k.box((math.hypot(xb - xa, yb - ya), .12, .12), (0, 0, z), Pal.BARK)
        if seg == 0:
            for s in (-1, 1):
                a = w.gate_angle + s * .22
                x, y = b.x + math.cos(a) * PAL_R, b.y + math.sin(a) * PAL_R
                Kit(w, x, y, 0, w.ground_z(x, y), sink=sink).cyl(.44, 4.2, (0, 0, 1.8), Pal.BARK)
            gx, gy = b.x + math.cos(w.gate_angle) * PAL_R, b.y + math.sin(w.gate_angle) * PAL_R
            k = Kit(w, gx, gy, w.gate_angle + math.pi / 2, w.ground_z(gx, gy), sink=sink)
            k.box((PAL_R * .44 + .4, .3, .3), (0, 0, 3.7), Pal.BARK)
            k.box((2.6, .12, 2.6), (1.0, -1.1, 1.4), Pal.PLANKS[1], (-60, 0, 0))

    def _parts_fire(self, k):
        for i in range(9):
            a = i / 9 * 2 * math.pi
            k.sph((.32, .32, .24), (math.cos(a) * .6, math.sin(a) * .6, .08), Pal.ROCK)
        for i in range(4):
            a = i * 90
            k.cyl(.13, .9, (math.cos(math.radians(a)) * .12, math.sin(math.radians(a)) * .12, .18), Pal.BARK, (a, 0, 65))
        k.box((1.1, 1.1, .02), (0, 0, .02), Pal.BURNT)
        for x, y, r in ((2.2, 0, 90), (-1.2, 1.9, 150), (-1.1, -2.0, 30)):
            k.cyl(.42, 1.8, (x, y, .2), Pal.BARK, (r, 90, 0))

    def _parts_leanto(self, k):
        for y in (-1.3, 1.3):
            k.cyl(.13, 2.4, (.55, y, 1.05), Pal.BARK, (0, -28, 0))
            k.cyl(.13, 2.4, (-.55, y, 1.05), Pal.BARK, (0, 28, 0))
        k.cyl(.14, 3.0, (0, 0, 2.05), Pal.BARK, (0, 0, 90))
        k.box((2.5, 3.1, .05), (-.62, 0, 1.1), 0x2f4f6a, (0, 50, 0))
        k.cyl(.56, 1.8, (-.3, 0, .12), 0x2f4f6a, (0, 0, 90))

    def _parts_barrel(self, k):
        k.cyl(.84, 1.1, (0, 0, .55), 0x2c5a8a)
        k.cone(1.8, .5, (0, 0, 1.35), 0x2f4f6a, (0, 180, 0))
        for x, y in ((-.64, -.64), (.64, -.64), (-.64, .64), (.64, .64)):
            k.cyl(.06, 1.7, (x, y, .85), Pal.BARK)

    def _parts_garden(self, k):
        k.box((4.2, 3.2, .25), (0, 0, .1), Pal.SOIL)
        for s in (-1, 1):
            k.box((4.4, .12, .3), (0, s * 1.65, .12), Pal.PLANKS[0])
            k.box((.12, 3.4, .3), (s * 2.15, 0, .12), Pal.PLANKS[0])

    def _parts_crate(self, k):
        k.box((1.3, .8, .8), (0, 0, .4), Pal.PLANKS[1])
        k.box((1.35, .85, .08), (0, -.05, .84), Pal.PLANKS[0], (0, 0, -7))
        k.box((.9, .6, .5), (1.2, .2, .25), Pal.PLANKS[0])
        k.cyl(.5, .7, (-1.1, .1, .35), Pal.OLIVE)

    def _parts_found(self, k):
        for x, y in ((-2.8, -2.3), (2.8, -2.3), (-2.8, 2.3), (2.8, 2.3), (0, -2.3), (0, 2.3)):
            k.box((.45, .45, .7), (x, y, .1), Pal.CONCRETE)
        k.box((6.2, 5.2, .22), (0, 0, .52), Pal.PLANKS[0])

    def _parts_walls(self, k):
        lw, ld = 6.0, 5.0
        for i in range(9):
            z = .78 + i * .26
            for s in (-1, 1):
                k.cyl(.28, lw + .5, (0, s * ld / 2, z), Pal.BARK, (0, 90, 0))
            for s in (-1, 1):
                if s == 1 and i < 8:        # door gap
                    for yy in (-1.55, 1.55):
                        k.cyl(.28, 1.6, (s * lw / 2, yy, z), Pal.BARK, (0, 0, 90))
                    continue
                if s == -1 and 3 <= i <= 5:  # window gap
                    for yy in (-1.6, 1.6):
                        k.cyl(.28, 1.5, (s * lw / 2, yy, z), Pal.BARK, (0, 0, 90))
                    continue
                k.cyl(.28, ld + .5, (s * lw / 2, 0, z), Pal.BARK, (0, 0, 90))
        k.box((.08, 1.2, 2.1), (3.02, 0, 1.7), Pal.PLANKS[1], (12, 0, 0))

    def _parts_roof(self, k):
        top = .78 + 9 * .26
        from .world import roof
        roof(k, 5.6, 6.8, top, True, Pal.CORR[0], Pal.PLANKS[0])
        k.cyl(.26, 1.4, (1.5, -1, top + 1.8), Pal.METAL)

    def _parts_tower(self, k):
        from .world import watchtower
        watchtower(k, Pal.BARK, Pal.PLANKS[0])

    def _parts_gen(self, k):
        k.box((1.1, .7, .7), (0, 0, .45), 0xb8952e)
        k.box((.9, .5, .3), (0, 0, .95), Pal.METAL)
        k.box((1.3, .9, .1), (0, 0, .08), Pal.PLANKS[0])
        k.cyl(.36, .45, (-.9, .2, .22), Pal.RED)
        k.cyl(.16, 6, (1.6, 0, 3), Pal.BARK)
        k.box((.35, .5, .3), (1.6, .2, 6), Pal.METAL)
        k.box((.02, .4, .26), (1.78, .2, 6), 0xfff2cf)

    def _parts_flag(self, k):
        k.cyl(.12, 7, (0, 0, 3.5), Pal.METAL)

    def _parts_radio(self, k):
        h = 15.0
        for i in range(3):
            a = i / 3 * 2 * math.pi
            k.cyl(.09, h, (math.cos(a) * .5, math.sin(a) * .5, h / 2), Pal.METAL)
        for z in range(1, int(h), 2):
            for i in range(3):
                a, b = i / 3 * 2 * math.pi, (i + 1) / 3 * 2 * math.pi
                x0, y0, x1, y1 = math.cos(a) * .5, math.sin(a) * .5, math.cos(b) * .5, math.sin(b) * .5
                k.box((math.hypot(x1 - x0, y1 - y0), .04, .04), ((x0 + x1) / 2, (y0 + y1) / 2, z), Pal.METAL, (math.degrees(math.atan2(y1 - y0, x1 - x0)), 0, 0))
        k.sph((1.2, 1.2, .4), (.4, .4, h * .7), Pal.CHROME, (45, -60, 0))
        k.box((1.4, 1, 1.2), (1.4, 1.2, .6), Pal.OLIVE)

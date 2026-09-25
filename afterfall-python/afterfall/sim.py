"""The simulation: time, weather, noise, combat, and the succession of survivors.

It has no rendering dependencies, so it can run headless (see tests/test_sim.py).
"""
import math
import random
from dataclasses import dataclass

from .ai.survivor import Survivor, _a
from .ai.zombie import Zombie
from .config import NAMES, HALF
from .homestead import Homestead
from .world import World

WEATHER = {  # rain, cloud, fog
    "clear": (0.0, .15, 0.0, "Clear"),
    "overcast": (0.0, .75, .15, "Overcast"),
    "rain": (1.0, .95, .35, "Rain"),
    "storm": (1.0, 1.0, .5, "Heavy rain"),
    "fog": (0.0, .5, 1.0, "Fog"),
}


@dataclass
class NoiseEvent:
    x: float
    y: float
    radius: float
    source: str
    zid: int | None
    ttl: float


class Simulation:
    def __init__(self, seed=None, zombies=28):
        self.seed = seed if seed is not None else random.randrange(1 << 30)
        self.rng = random.Random(self.seed)
        self.world = World(self.seed)
        self.home = Homestead(self.world)
        self.minutes = 7 * 60 + 5.0
        self.events: list[tuple] = []
        self.floaters: list[tuple] = []
        self.fx: list[tuple] = []
        self.sounds: list[tuple] = []
        self.noises: list[NoiseEvent] = []
        self.graves: list[tuple] = []
        self.generation = 1
        self.weather, self.weather_next = "fog", 180.0
        self.rain = 0.0
        self.cloud = .5
        self.fog_amount = 1.0
        self.temp = 10.0
        self.path_budget = 2
        self._hour_index = int(self.minutes // 60)
        self.dead_t = 0.0
        for key in ("fire", "leanto"):
            self.home.finish(self.home.by_key[key])
        name = self.rng.choice(NAMES)
        self.survivor = Survivor(self, name, *self.home.pos((-2, -2)))
        self.survivor.say("Another morning. The fire held through the night.")
        self.log(f"{name} wakes at the homestead site east of Staroye.", "good")
        self.zombies = [Zombie(self, i) for i in range(zombies)]
        for z in self.zombies:
            z.spawn(away_from=(self.survivor.x, self.survivor.y))
        self.zombie_by_id = {z.id: z for z in self.zombies}

    # ------------------------------------------------------------------ time

    @property
    def day(self):
        return int(self.minutes // 1440) + 1

    @property
    def hour(self):
        return (self.minutes / 60) % 24

    def clock(self):
        return f"{int(self.hour):02d}:{int(self.minutes % 60):02d}"

    def stamp(self):
        return f"D{self.day} {self.clock()}"

    def step(self, dt):
        self.minutes += dt
        self.path_budget = 2
        self._weather(dt)
        hi = int(self.minutes // 60)
        if hi != self._hour_index:
            self._hour_index = hi
            self._hourly(hi)
        home = self.home
        if home.fire_fuel > 0:
            home.fire_fuel = max(0.0, home.fire_fuel - dt / 60 * .6)
        for n in self.noises:
            n.ttl -= dt
        self.noises = [n for n in self.noises if n.ttl > 0]
        for z in self.zombies:
            z.update(dt)
        self._separate()
        s = self.survivor
        if s.alive:
            s.update(dt)
        else:
            self.dead_t += dt
            if self.dead_t > 14:
                self._succession()

    def _weather(self, dt):
        self.weather_next -= dt
        if self.weather_next <= 0:
            self.weather_next = self.rng.uniform(160, 420)
            r = self.rng.random()
            self.weather = "clear" if r < .4 else "overcast" if r < .62 else "rain" if r < .85 else "storm" if r < .93 else "fog"
            if self.weather in ("rain", "storm"):
                self.log("A storm rolls in from the west." if self.weather == "storm" else "It starts to rain.")
        rain, cloud, fog, _ = WEATHER[self.weather]
        k = min(1.0, dt * .02)
        self.rain += (rain - self.rain) * k
        self.cloud += (cloud - self.cloud) * k
        self.fog_amount += (fog - self.fog_amount) * k
        self.temp = 11 + 7 * math.sin((self.hour - 9) / 24 * 2 * math.pi) - self.rain * 4 - self.cloud * 1.5

    def _hourly(self, hi):
        self.home.hourly(hi, self.rain > .5)
        for site in self.world.loot:
            if site.looted and self.minutes > site.restock_at:
                site.looted = False
        if hi % 24 == 0 and self.survivor.alive:
            self.log(f"Day {self.day} begins. {self.survivor.first_name} has been out here {round((self.minutes - self.survivor.born) / 1440)} days.")
        home = self.home
        if home.walls_closed and home.wall_hp <= 0:
            seg = self.rng.randint(1, 3)
            home.breached = seg
            segs = [f"pal{i}" in home.built for i in range(4)]
            segs[seg] = False
            self.world.set_palisade(segs)
            home.wall_hp = 30
            self.log(["", "The east wall", "The south wall", "The west wall"][seg] + " gave way under the weight of them!", "bad")

    def _separate(self):
        live = [z for z in self.zombies if z.alive]
        for i, a in enumerate(live):
            for b in live[i + 1:]:
                dx, dy = b.x - a.x, b.y - a.y
                d = math.hypot(dx, dy)
                if 1e-4 < d < .7:
                    k = (.7 - d) / 2
                    a.x -= dx / d * k
                    a.y -= dy / d * k
                    b.x += dx / d * k
                    b.y += dy / d * k

    # ------------------------------------------------------------------ succession

    def _succession(self):
        old = self.survivor
        self.graves.append((old.x, old.y, old.name))
        self.generation += 1
        name = self.rng.choice([n for n in NAMES if n != old.name])
        x = self.rng.uniform(-60, 70)
        y = -HALF + 95
        new = Survivor(self, name, x, y, predecessor=old)
        new.x, new.y = self.world.resolve(x, y)
        new.say("Found a journal on a body by the road. Someone was building a home to the north-east.")
        self.survivor = new
        self.dead_t = 0.0
        self.log(f"Generation {self.generation}: {name} finds {old.first_name}'s journal and heads for the homestead.", "good")

    # ------------------------------------------------------------------ interactions

    def noise(self, x, y, radius, source, zid=None):
        self.noises.append(NoiseEvent(x, y, radius, source, zid, 1.0))
        if source == "zombie":
            self.sfx("groan", x, y)

    def shoot(self, s, z):
        s.inv["ammo"] -= 1
        d = math.hypot(z.x - s.x, z.y - s.y)
        hit = self.rng.random() < max(.3, min(.95, 1.08 - d / 55 - s.stress / 250))
        self.fx.append(("shot", s.x, s.y, z.x, z.y, hit))
        self.sfx("shot", s.x, s.y)
        self.noise(s.x, s.y, 120, "gunshot")
        if hit:
            z.hit(100, s)
            self._killed(s, z, "rifle")
        else:
            self.float_text(z, "Miss", "bad")

    def melee(self, s, z):
        dmg = self.rng.uniform(32, 55) if s.inv["axe"] else self.rng.uniform(10, 18)
        z.hit(dmg, s)
        self.sfx("hit", z.x, z.y)
        d = math.hypot(z.x - s.x, z.y - s.y) or 1
        z.x += (z.x - s.x) / d * .5
        z.y += (z.y - s.y) / d * .5
        if not z.alive:
            self._killed(s, z, "axe" if s.inv["axe"] else "fists")

    def _killed(self, s, z, how):
        if z.alive:
            return
        s.kills += 1
        s.memory.day_log["kills"] += 1
        s.memory.threats.pop(z.id, None)
        s.stress = max(0.0, s.stress - 6)
        self.fx.append(("blood", z.x, z.y))
        self.sfx("thud", z.x, z.y)
        if s.kills == 1 or self.rng.random() < .35:
            place = self.world.site_at(z.x, z.y)
            where = place.name if place else "the treeline"
            self.log({"rifle": f"Dropped an infected with one shot near {where}.",
                      "axe": f"Put down an infected with the axe near {where}.",
                      "fists": "Beat an infected to death barehanded. Knuckles split."}[how], "bad")

    def on_tree_felled(self, tree, s):
        self.fx.append(("fell", tree.idx, math.atan2(tree.y - s.y, tree.x - s.x)))
        if self.rng.random() < .35:
            self.log(f"Felled {_a('pine' if tree.kind == 'pine' else 'birch' if tree.kind == 'birch' else 'dead tree')} near the homestead.")

    def zombies_near(self, x, y, r):
        return sum(1 for z in self.zombies if z.alive and math.hypot(z.x - x, z.y - y) < r)

    # ------------------------------------------------------------------ output for the renderer

    def log(self, text, kind=""):
        self.events.append((self.stamp(), text, kind))
        if len(self.events) > 200:
            self.events = self.events[-200:]

    def float_text(self, agent, text, kind="", delay=0.0):
        self.floaters.append((agent.x, agent.y, text, kind, delay))

    def sfx(self, kind, x, y):
        self.sounds.append((kind, x, y))
        if len(self.sounds) > 50:
            self.sounds = self.sounds[-50:]

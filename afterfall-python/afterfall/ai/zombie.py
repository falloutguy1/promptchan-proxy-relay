"""The infected: wander in loose herds, investigate noise, chase what they see, search where they lost it."""
import math

from ..config import PACE


class Zombie:
    RADIUS = .4

    def __init__(self, sim, zid):
        self.sim, self.world = sim, sim.world
        self.id = zid
        self.runner = sim.rng.random() < .22
        self.look = sim.rng.randint(0, 9999)
        self.alive = False
        self.x = self.y = 0.0
        self.heading = sim.rng.uniform(0, 2 * math.pi)
        self.hp = 60.0
        self.state = "wander"
        self.anim, self.speed = "zidle", 0.0
        self.tx = self.ty = 0.0
        self.home = None
        self.idle_t = 0.0
        self.atk_t = 0.0
        self.dead_t = 0.0
        self.sense_t = sim.rng.uniform(0, .3)
        self.groan_t = sim.rng.uniform(5, 30)
        self.last_seen = None
        self.search_t = 0.0
        self.path, self.path_t = [], 0.0
        self.roll = 0.0

    @property
    def target_is_survivor(self):
        return self.alive and self.state in ("chase", "attack")

    def spawn(self, away_from=None):
        sim, w = self.sim, self.world
        sites = [s for s in w.sites if s.kind != "base"]
        for _ in range(40):
            s = sim.rng.choice(sites)
            a, r = sim.rng.uniform(0, 2 * math.pi), math.sqrt(sim.rng.random()) * s.r
            x, y = s.x + math.cos(a) * r, s.y + math.sin(a) * r
            if not w.walkable(*w.cell_of(x, y), True):
                continue
            if away_from and math.hypot(x - away_from[0], y - away_from[1]) < 90:
                continue
            break
        self.x, self.y, self.home = x, y, s
        self.tx, self.ty = x, y
        self.hp, self.alive, self.state, self.dead_t = 60.0, True, "wander", 0.0
        self.idle_t = sim.rng.uniform(0, 5)

    def hit(self, dmg, attacker):
        if not self.alive:
            return
        self.hp -= dmg
        if self.state not in ("chase", "attack"):
            self.state = "chase"
        if self.hp <= 0:
            self.alive = False
            self.state = "dead"
            self.anim = "dead"
            self.roll = self.sim.rng.uniform(-.5, .5)

    # ------------------------------------------------------------------

    def update(self, dt):
        sim = self.sim
        if not self.alive:
            self.dead_t += dt
            if self.dead_t > 70 and (sim.survivor is None or math.hypot(self.x - sim.survivor.x, self.y - sim.survivor.y) > 70):
                self.spawn(away_from=(sim.survivor.x, sim.survivor.y) if sim.survivor else None)
            return
        s = sim.survivor
        self.groan_t -= dt
        if self.groan_t < 0:
            self.groan_t = sim.rng.uniform(10, 40) if self.state != "chase" else sim.rng.uniform(4, 9)
            sim.noise(self.x, self.y, 18 if self.state != "chase" else 26, "zombie", zid=self.id)
        self.sense_t -= dt
        if self.sense_t <= 0:
            self.sense_t = .3
            self._sense(s)
        getattr(self, f"_state_{self.state}")(dt, s)

    def _sense(self, s):
        sim, w = self.sim, self.world
        if s is None or not s.alive:
            if self.state in ("chase", "attack"):
                self.state = "wander"
            return
        d = math.hypot(s.x - self.x, s.y - self.y)
        walled_out = w.palisade_closed() and sim.home.inside(s.x, s.y, 0) and not sim.home.inside(self.x, self.y, 0)
        night = sim.hour >= 21 or sim.hour < 5.3
        rng = (22 if not night else 11) * (1 - .3 * sim.fog_amount)
        loud = {"run": 1.5, "chop": 1.6, "build": 1.4, "melee": 1.3}.get(s.anim, 1.0)
        quiet = {"sneak": .5, "crouch": .35, "sleep": .45, "sit": .7}.get(s.anim, 1.0)
        rng *= loud * quiet
        fwd = (math.cos(self.heading), math.sin(self.heading))
        dx, dy = (s.x - self.x) / max(d, 1e-3), (s.y - self.y) / max(d, 1e-3)
        in_fov = d < 4 or (dx * fwd[0] + dy * fwd[1]) > -.1
        if d < rng and in_fov and w.sight_clear(self.x, self.y, s.x, s.y):
            self.last_seen = (s.x, s.y)
            if walled_out:
                if self.state not in ("pound",) and d < 30:
                    self.state = "pound"
                return
            if self.state not in ("chase", "attack"):
                self.state = "chase"
                sim.noise(self.x, self.y, 26, "zombie", zid=self.id)
            return
        if self.state in ("chase", "attack") and d > (45 if self.runner else 36):
            self.state = "search"
            self.search_t = 25
            return
        if self.state in ("wander", "idle", "search"):
            for n in sim.noises:
                if n.source != "zombie" or n.zid != self.id:
                    nd = math.hypot(n.x - self.x, n.y - self.y)
                    if nd < n.radius and (n.source != "zombie" or sim.rng.random() < .25):
                        self.state = "investigate"
                        self.tx, self.ty = n.x + sim.rng.uniform(-6, 6), n.y + sim.rng.uniform(-6, 6)
                        self.search_t = 40
                        break

    # --- movement ---

    def _move(self, tx, ty, speed, dt, use_path=False):
        w = self.world
        if use_path:
            self.path_t -= dt
            if self.path_t <= 0 or not self.path:
                self.path_t = 3.0
                if not w.line_walkable(self.x, self.y, tx, ty, True) and self.sim.path_budget > 0:
                    self.sim.path_budget -= 1
                    self.path, _ = w.find_path(self.x, self.y, tx, ty, zombie=True, max_expand=3000)
                else:
                    self.path = [(tx, ty)]
            gx, gy = self.path[0] if self.path else (tx, ty)
            if math.hypot(gx - self.x, gy - self.y) < 1.5 and len(self.path) > 1:
                self.path.pop(0)
                gx, gy = self.path[0]
        else:
            gx, gy = tx, ty
        want = math.atan2(gy - self.y, gx - self.x)
        diff = (want - self.heading + math.pi) % (2 * math.pi) - math.pi
        self.heading += diff * (1 - math.exp(-dt * 5))
        sp = speed * (1 - min(.4, w.slope(self.x, self.y) * .5))
        self.x, self.y = w.resolve(self.x + math.cos(self.heading) * sp * dt, self.y + math.sin(self.heading) * sp * dt, self.RADIUS, True)
        self.speed = sp
        return math.hypot(tx - self.x, ty - self.y)

    # --- states ---

    def _state_wander(self, dt, s):
        sim = self.sim
        self.idle_t -= dt
        if self.idle_t > 0:
            self.anim, self.speed = "zidle", 0.0
            return
        d = self._move(self.tx, self.ty, .65, dt)
        self.anim = "zwalk"
        if d < 1.2:
            self.idle_t = sim.rng.uniform(3, 12)
            # drift towards others: herds form without anyone planning them
            near = [z for z in sim.zombies if z is not self and z.alive and math.hypot(z.x - self.x, z.y - self.y) < 30]
            h = self.home
            a, r = sim.rng.uniform(0, 2 * math.pi), math.sqrt(sim.rng.random()) * h.r * 1.1
            tx, ty = h.x + math.cos(a) * r, h.y + math.sin(a) * r
            if near:
                cx = sum(z.x for z in near) / len(near)
                cy = sum(z.y for z in near) / len(near)
                tx, ty = tx * .6 + cx * .4, ty * .6 + cy * .4
            self.tx, self.ty = tx, ty

    def _state_investigate(self, dt, s):
        self.search_t -= dt
        d = self._move(self.tx, self.ty, 1.6 if not self.runner else 2.4, dt, use_path=True)
        self.anim = "zwalk"
        if d < 2 or self.search_t < 0:
            self.state = "wander"
            self.idle_t = self.sim.rng.uniform(4, 10)

    def _state_search(self, dt, s):
        self.search_t -= dt
        if self.last_seen:
            lx, ly = self.last_seen
            if math.hypot(self.tx - lx, self.ty - ly) > 12 or math.hypot(self.x - self.tx, self.y - self.ty) < 1.5:
                a = self.sim.rng.uniform(0, 2 * math.pi)
                self.tx, self.ty = lx + math.cos(a) * 8, ly + math.sin(a) * 8
        self._move(self.tx, self.ty, 1.4, dt, use_path=True)
        self.anim = "zwalk"
        if self.search_t < 0:
            self.state = "wander"

    def _state_chase(self, dt, s):
        if s is None or not s.alive:
            self.state = "wander"
            return
        d = math.hypot(s.x - self.x, s.y - self.y)
        if d < 1.25:
            self.state, self.atk_t = "attack", .4
            return
        tx, ty = (s.x, s.y) if self.last_seen is None else self.last_seen
        speed = 3.7 if self.runner else 2.5
        self._move(tx, ty, speed, dt, use_path=d > 6)
        self.anim = "zrun" if self.runner else "zwalk"

    def _state_attack(self, dt, s):
        if s is None or not s.alive:
            self.state = "wander"
            return
        d = math.hypot(s.x - self.x, s.y - self.y)
        want = math.atan2(s.y - self.y, s.x - self.x)
        self.heading += ((want - self.heading + math.pi) % (2 * math.pi) - math.pi) * (1 - math.exp(-dt * 8))
        self.anim, self.speed = "zattack", 0.0
        if d > 1.8:
            self.state = "chase"
            return
        self.atk_t -= dt
        if self.atk_t <= 0:
            self.atk_t = 1.25
            s.take_hit(self.sim.rng.uniform(4, 9), self)
            self.sim.sfx("hurt", s.x, s.y)

    def _state_pound(self, dt, s):
        """Outside the finished palisade: claw at the wall, which slowly wears it down."""
        home, w = self.sim.home, self.world
        if not w.palisade_closed() or s is None or not s.alive or not home.inside(s.x, s.y, 0):
            self.state = "search"
            self.search_t = 15
            return
        b = home.base
        a = math.atan2(self.y - b.y, self.x - b.x)
        tx, ty = b.x + math.cos(a) * (w.pal_r + 1), b.y + math.sin(a) * (w.pal_r + 1)
        if self._move(tx, ty, 1.6, dt) > 1.5:
            self.anim = "zwalk"
            return
        self.heading = a + math.pi
        self.anim, self.speed = "zattack", 0.0
        home.wall_hp = max(0.0, home.wall_hp - dt * .08)
        if self.sim.rng.random() < dt * .02:
            self.state = "wander"
            self.idle_t = 10

"""The survivor's mind.

Decision making is utility based: every candidate action gets a 0..1 score built from considerations
(needs, personality, memory, time of day, remembered danger). The best action wins, with a little
momentum so the survivor doesn't dither. Each action is a generator that yields simple instructions
(walk somewhere, perform an animation for N minutes, close in on a target), which keeps multi-step
behaviour readable and lets any action be interrupted cleanly.
"""
import math
from dataclasses import dataclass

from ..config import HALF, PACE, LOOT_TABLES, ITEM_NAMES
from .memory import Memory, clamp01, rising

ITEMS = ["food", "water", "wood", "scrap", "nails", "ammo", "bandage", "medkit", "axe", "rifle"]


@dataclass
class Candidate:
    key: str          # identity, including target ("scavenge:12")
    name: str         # what the HUD shows
    score: float
    detail: str
    make: object      # () -> generator


class Active:
    def __init__(self, c: Candidate):
        self.key, self.name, self.detail = c.key, c.name, c.detail
        self.gen = c.make()
        self.instr = None
        self.started = False
        self.done = False
        self.t = 0.0
        self.progress = None


class Survivor:
    RADIUS = .4

    def __init__(self, sim, name, x, y, predecessor=None):
        rng = sim.rng
        self.sim, self.world, self.home = sim, sim.world, sim.home
        self.name = name
        self.first_name = name.split()[0]
        self.traits = {
            "bravery": rng.uniform(.2, .9),
            "caution": rng.uniform(.2, .9),
            "diligence": rng.uniform(.3, 1.0),
            "curiosity": rng.uniform(.2, .9),
            "resilience": rng.uniform(.2, .9),
        }
        self.x, self.y, self.heading = x, y, 0.0
        self.health, self.food, self.water, self.energy, self.warmth = 100.0, 70.0, 64.0, 86.0, 70.0
        self.morale, self.stress = 62.0, 10.0
        self.bleeding = False
        self.inv = {k: 0 for k in ITEMS}
        self.inv.update(food=1, water=1, bandage=1)
        self.memory = Memory(len(self.world.loot))
        for i, site in enumerate(self.world.loot):
            if math.hypot(site.x - self.home.base.x, site.y - self.home.base.y) < 150:
                self.memory.places[i].known = True
        if predecessor is not None:
            self.memory.inherit_from(predecessor.memory)
            self.food, self.water, self.energy, self.warmth, self.morale = 50, 45, 70, 45, 45
        self.anim, self.pace, self.speed = "idle", "walk", 0.0
        self.action: Active | None = None
        self.scores: list[tuple] = []
        self.thought = ""
        self.alive = True
        self.cause = ""
        self.born = sim.minutes
        self.kills = 0
        self.loots = 0
        self.loots_since_axe = 0
        self.path, self.path_goal = [], None
        self.stuck_t, self.stuck_ref, self.fails = 0.0, (x, y), 0
        self.think_t = self.sense_t = 0.0
        self.hurt_t = 0.0
        self.last_attacker = None
        self.last_hit_t = -1e9
        self.work_noise_t = 0.0
        self.fight_lock_t = 0.0

    # ------------------------------------------------------------------ helpers

    def trait(self, k):
        return self.traits[k]

    def dist(self, x, y):
        return math.hypot(x - self.x, y - self.y)

    def say(self, text):
        self.thought = text

    def log(self, text, kind=""):
        self.sim.log(text, kind)

    @property
    def armed(self):
        return self.inv["axe"] > 0 or (self.inv["rifle"] > 0 and self.inv["ammo"] > 0)

    def weapon_power(self):
        if self.inv["rifle"] and self.inv["ammo"] > 0:
            return 1.2
        return .85 if self.inv["axe"] else .35

    def daylight(self):
        h = self.sim.hour
        return clamp01(min((h - 5.2) / 1.5, (20.8 - h) / 1.5))

    def at_base(self):
        return self.home.inside(self.x, self.y, 1.0)

    # ------------------------------------------------------------------ tick

    def update(self, dt):
        if not self.alive:
            return
        self._needs(dt)
        if not self.alive:
            return
        self.sense_t -= dt
        if self.sense_t <= 0:
            self.sense_t = .25
            changed = self._perceive()
            if changed:
                self.think_t = 0
        self.memory.decay(dt)
        self.memory.forget_old(self.sim.minutes)
        self.think_t -= dt
        if self.action is None or self.action.done or self.think_t <= 0:
            self.think_t = 1.0
            self._decide()
        if self.action:
            self._run(dt)
        self.hurt_t = max(0.0, self.hurt_t - dt)
        self.fight_lock_t = max(0.0, self.fight_lock_t - dt)

    # ------------------------------------------------------------------ body

    def _needs(self, dt):
        sim, home = self.sim, self.home
        sleeping = self.anim == "sleep"
        exert = {"run": 1.6, "chop": 1.4, "build": 1.3, "melee": 1.5, "jog": 1.2}.get(self.anim, 1.0)
        self.food = max(0.0, self.food - dt * 100 / (30 * 60) * (1.3 if exert > 1 else 1))
        self.water = max(0.0, self.water - dt * 100 / (20 * 60) * (1.4 if exert > 1 else 1) * (1.2 if sim.temp > 18 else 1))
        if sleeping:
            self.energy = min(100.0, self.energy + dt * 100 / (6.5 * 60) * (.6 if self.stress > 60 else 1))
        else:
            self.energy = max(0.0, self.energy - dt * 100 / (19 * 60) * exert)
        near_fire = "fire" in home.built and home.fire_fuel > 0 and self.dist(*home.fire_pos) < 6
        in_cabin = "roof" in home.built and self.dist(*home.pos((-8, -7.5))) < 3.5
        env_t = sim.temp + (16 if near_fire else 0) + (12 if in_cabin else 0) + (5 if sleeping and "leanto" in home.built else 0)
        target = max(0.0, min(100.0, 40 + env_t * 3.2 - sim.rain * (0 if in_cabin else 25)))
        self.warmth += (target - self.warmth) * (1 - math.exp(-dt / 90))

        dmg = 0.0
        if self.food <= 0:
            dmg += .05
        if self.water <= 0:
            dmg += .1
        if self.warmth < 18:
            dmg += .035
        if self.bleeding:
            dmg += .12
        self.health -= dmg * dt
        if self.food > 45 and self.water > 45 and not self.bleeding and self.warmth > 30:
            self.health = min(100.0, self.health + dt * (.06 if sleeping else .02))

        # stress rises with known threats and falls when safe; morale drifts with comfort
        threatened = any(t.aware for t in self.memory.threats.values())
        calm = .9 if (self.at_base() and home.walls_closed) else .45
        self.stress = max(0.0, min(100.0, self.stress + dt * (1.5 if threatened else -calm)))
        comfort = (self.food > 40) + (self.water > 40) + (self.warmth > 40) + (self.energy > 30) - (sim.rain > .5) - (self.health < 40)
        drift = (comfort - 2.2) * .004 + (self.trait("resilience") - .5) * .004
        self.morale = max(0.0, min(100.0, self.morale + drift * dt))

        if self.health <= 0:
            cause = ("bled out" if self.bleeding else "dehydration" if self.water <= 0 else
                     "starvation" if self.food <= 0 else "exposure")
            self.die(cause)

    def take_hit(self, dmg, zombie):
        if not self.alive:
            return
        self.health -= dmg
        self.hurt_t = .6
        self.stress = min(100.0, self.stress + 18)
        self.last_attacker = zombie
        self.last_hit_t = self.sim.minutes
        self.memory.see(zombie.id, zombie.x, zombie.y, self.sim.minutes, True)
        self.memory.add_danger(self.x, self.y, 1.2, 20)
        self.think_t = 0
        if not self.bleeding and self.sim.rng.random() < .18:
            self.bleeding = True
            self.log("Clawed across the arm. Bleeding.", "bad")
        if self.health < 30:
            place = self.world.site_at(self.x, self.y)
            self.memory.day_log["close_calls"] += 1
            self.memory.remember(self.sim.minutes, "nearly died", place.name if place else "the woods", 2.0)
            for i, s in enumerate(self.world.loot):
                if math.hypot(s.x - self.x, s.y - self.y) < 60:
                    self.memory.places[i].scare = 1.0
        if self.health <= 0:
            self.die("the infected")

    def die(self, cause):
        if not self.alive:
            return
        self.alive = False
        self.cause = cause
        self.health = 0.0
        self.anim = "dead"
        self.action = None
        days = (self.sim.minutes - self.born) / 1440
        self.log(f"{self.name} is dead: {cause}. Survived {days:.1f} days, {self.kills} infected put down.", "bad")
        self.say("...")

    # ------------------------------------------------------------------ senses

    def _perceive(self):
        """Sight (range, field of view, walls) and hearing. Returns True if something important changed."""
        sim, w, mem = self.sim, self.world, self.memory
        t = sim.minutes
        sleeping = self.anim == "sleep"
        night = 1 - self.daylight()
        rng_sight = (40 - 22 * night) * (1 - .35 * sim.fog_amount) * (.3 if sleeping else 1)
        fwd = (math.cos(self.heading), math.sin(self.heading))
        changed = False
        safe_inside = self.home.walls_closed and self.at_base()
        for z in sim.zombies:
            if not z.alive:
                continue
            d = self.dist(z.x, z.y)
            if d > rng_sight + 5:
                continue
            if safe_inside and not self.home.inside(z.x, z.y, -1):
                # watching them through the palisade gaps is enough; they can't get in
                if d < 25:
                    mem.see(z.id, z.x, z.y, t, False)
                continue
            dx, dy = (z.x - self.x) / max(d, 1e-3), (z.y - self.y) / max(d, 1e-3)
            in_view = d < 6 or (dx * fwd[0] + dy * fwd[1]) > -.2
            if d < rng_sight and in_view and w.sight_clear(self.x, self.y, z.x, z.y):
                aware = z.target_is_survivor
                old = mem.threats.get(z.id)
                if old is None or old.aware != aware or old.heard_only:
                    changed = True
                    if old is None and d < 25:
                        self.stress = min(100.0, self.stress + (8 if aware else 3))
                mem.see(z.id, z.x, z.y, t, aware)
                mem.add_danger(z.x, z.y, .04, 12)
        for n in sim.noises:
            if n.source == "zombie" and self.dist(n.x, n.y) < n.radius * .8 and n.zid is not None:
                if n.zid not in mem.threats:
                    mem.hear(n.zid, n.x + sim.rng.uniform(-6, 6), n.y + sim.rng.uniform(-6, 6), t)
        # discover places in view
        for i, s in enumerate(w.loot):
            p = mem.places[i]
            if not p.known and self.dist(s.x, s.y) < 38 and not sleeping:
                p.known = True
                if sim.rng.random() < .3:
                    self.say(f"There's {_a(s.label)} {s.where}. I haven't been through it.")
        return changed

    # ------------------------------------------------------------------ deciding

    def threat_summary(self):
        aware, unaware = [], []
        for th in self.memory.threats.values():
            z = self.sim.zombie_by_id.get(th.zid)
            if z is None or not z.alive:
                continue
            if self.home.walls_closed and self.at_base() and not self.home.inside(z.x, z.y, -1):
                continue
            d = self.dist(th.x, th.y)
            if th.aware and d < 35:
                aware.append((d, z, th))
            elif not th.heard_only and d < 22:
                unaware.append((d, z, th))
        aware.sort(key=lambda a: a[0])
        unaware.sort(key=lambda a: a[0])
        return aware, unaware

    def _decide(self):
        cands = [c for c in self._candidates() if c.score > 0]
        cands.sort(key=lambda c: -c.score)
        self.scores = [(c.name, c.score, c.detail) for c in cands[:7]]
        if not cands:
            return
        best = cands[0]
        cur = self.action
        if cur and not cur.done:
            cur_score = next((c.score for c in cands if c.key == cur.key), 0.0)
            if best.key == cur.key or best.score < cur_score * 1.15 + .04:
                return
        self.action = Active(best)
        self.action_score = best.score

    def _candidates(self):
        sim, home, inv, T = self.sim, self.home, self.inv, self.traits
        hour, day = sim.hour, self.daylight()
        night = hour >= 21 or hour < 5.3
        thirst = rising(100 - self.water, 30, 90, 1.5)
        hunger = rising(100 - self.food, 35, 92, 1.5)
        tired = rising(100 - self.energy, 35, 95, 1.3)
        cold = rising(100 - self.warmth, 45, 90)
        hurt = rising(100 - self.health, 30, 80)
        urgent = max(thirst, hunger, tired)
        drive = (.6 + .4 * T["diligence"]) * (.7 + .3 * self.morale / 100) * (1 - urgent * .8)
        out = []
        add = out.append

        # --- threats first: everything else is scored against them ---
        aware, unaware = self.threat_summary()
        if aware:
            threat = sum((1.2 - d / 35) * (1.3 if z.runner else 1) for d, z, _ in aware)
            cap = self.weapon_power() * math.sqrt(max(self.health, 1) / 100) * (1 - self.stress / 250) + T["bravery"] * .35
            n = len(aware)
            nearest, nz = aware[0][0], aware[0][1]
            # running is pointless if they keep landing blows or my legs are gone: then stand and fight
            futile = sim.minutes - self.last_hit_t < 8 or self.energy < 8 or (nz.runner and nearest < 6 and self.energy < 40)
            cornered = nearest < 2.5 or futile
            stand = cornered and (self.armed or n == 1)
            detail = f"{n} hunting me · threat {threat:.1f} vs me {cap:.1f}" + (" · can't outrun them" if futile else "")
            add(Candidate("fight", "Fight", clamp01(.55 + (cap - threat) * .5 + (1.0 if stand else 0)), detail, self._act_fight))
            add(Candidate("flee", "Flee", clamp01(.35 + (threat - cap) * .6 + hurt * .3 + (.3 if not self.armed else 0) - (1.0 if stand else 0)), detail, self._act_flee))
        elif unaware:
            d0, z0, _ = unaware[0]
            lone = len(unaware) == 1
            cap = self.weapon_power() * math.sqrt(max(self.health, 1) / 100)
            add(Candidate("evade", "Slip away", clamp01(.5 * (.4 + T["caution"]) * (1.2 if night else .8) * (1.3 if len(unaware) > 2 else 1)),
                          f"{len(unaware)} nearby, not seen me · {d0:.0f} m", self._act_evade))
            if lone and cap > .8 and T["bravery"] > .45 and self.health > 55:
                add(Candidate("ambush", "Take it quietly", .42 + T["bravery"] * .15, f"lone infected {d0:.0f} m, unaware", lambda: self._act_fight(first=z0)))

        # --- body ---
        if self.bleeding and inv["bandage"]:
            add(Candidate("bandage", "Bandage wound", .98, "bleeding", self._act_bandage))
        if self.health < 50 and inv["medkit"]:
            add(Candidate("medkit", "Use first-aid kit", .6 + hurt * .3, f"health {self.health:.0f}", self._act_medkit))
        if inv["water"]:
            add(Candidate("drink", "Drink", .95 * thirst, f"water {self.water:.0f} · {inv['water']} bottle(s)", self._act_drink))
        src = self._water_source()
        if src:
            sx, sy, sname, barrel = src
            d = self.dist(sx, sy)
            score = thirst * .9 / (1 + d / 500) * (1 if not inv["water"] else .5)
            if inv["water"] < 2 and d < 45 and day > .5:
                score = max(score, .22)
            add(Candidate("water", "Fetch water", score, f"{sname} · {d:.0f} m", lambda: self._act_fetch_water(src)))
        if inv["food"]:
            add(Candidate("eat", "Eat", .95 * hunger, f"food {self.food:.0f} · {inv['food']} ration(s)", self._act_eat))
        if home.garden_food > 0:
            add(Candidate("harvest", "Harvest garden", hunger * .8 + (.2 if inv["food"] < 2 and home.garden_food >= 3 else 0),
                          f"{home.garden_food} heads ready", self._act_harvest))
        sleep_pull = .6 if (hour >= 21.5 or hour < 4.8) else 0
        if not aware:
            score = max(tired * .95, sleep_pull * (.6 + tired * .4))
            if self.energy > 97 and not (hour >= 22.5 or hour < 4.5):
                score = 0
            add(Candidate("sleep", "Sleep", score, f"energy {self.energy:.0f} · {'night' if night else 'day'}", self._act_sleep))

        # --- the homestead ---
        if "fire" in home.built and home.fire_fuel < 1.5 and inv["wood"] and (night or cold > .3):
            add(Candidate("tend", "Tend the fire", .6, f"fuel {home.fire_fuel:.1f} h", self._act_tend_fire))
        if night and "fire" in home.built and home.fire_fuel > 0:
            add(Candidate("rest", "Rest by the fire", .32 + cold * .3 + (.1 if self.morale < 50 else 0), f"warmth {self.warmth:.0f}", self._act_rest))
        if home.walls_built and (home.wall_hp < 70 or home.breached is not None) and inv["wood"] >= 2:
            score = .85 if home.breached is not None else (1 - home.wall_hp / 100) * .9
            add(Candidate("repair", "Repair palisade", score, "wall breached" if home.breached is not None else f"walls {home.wall_hp:.0f}%", self._act_repair))
        lit = day if "gen" not in home.built else max(day, .6)
        proj = self._buildable()
        if proj:
            started = " · half done" if home.progress.get(proj.key) else ""
            add(Candidate(f"build:{proj.key}", "Build", .55 * drive * max(lit, .15), proj.name + started, lambda p=proj: self._act_build(p)))
        needs = self._material_needs()
        if needs.get("wood", 0) > 0 and inv["wood"] < 16:
            tree = self._pick_tree()
            if tree:
                d = self.dist(tree.x, tree.y)
                add(Candidate(f"wood:{tree.idx}", "Gather wood", .46 * drive * max(day, .1) * (1 if inv["axe"] else .8),
                              f"need {needs['wood']} · tree {d:.0f} m · {'axe' if inv['axe'] else 'by hand'}", lambda t=tree: self._act_wood(t)))

        # --- going out ---
        site, sscore, sdetail = self._best_scavenge(needs, hunger, thirst)
        if site is not None:
            add(Candidate(f"scav:{site.idx}", "Scavenge", sscore, sdetail, lambda s=site: self._act_scavenge(s)))
        unknown = sum(1 for p in self.memory.places if not p.known) / max(1, len(self.memory.places))
        if unknown > 0:
            target = self._explore_target()
            if target:
                add(Candidate(f"explore:{target[2]}", "Explore", (.12 + T["curiosity"] * .3) * min(1.0, unknown * 1.5) * day * (1 - urgent), f"towards {target[2]} · {unknown * 100:.0f}% of places unknown",
                              lambda tg=target: self._act_explore(tg)))
        if sim.rain > .5 and not self.at_base() and self.warmth < 55:
            add(Candidate("shelter", "Get out of the rain", .45, f"warmth {self.warmth:.0f}", self._act_go_home))
        if self.morale < 25:
            add(Candidate("despair", "Sit and stare", (25 - self.morale) / 25 * .55, f"morale {self.morale:.0f}", self._act_despair))
        add(Candidate("patrol", "Walk the perimeter", .06, "nothing pressing", self._act_patrol))
        return out

    # ------------------------------------------------------------------ targets

    def _buildable(self):
        """The earliest project whose prerequisite is done and whose materials are in the pack."""
        home = self.home
        for p in home.projects:
            if p.key in home.built or (p.needs and p.needs not in home.built):
                continue
            if home.can_afford(p, self.inv):
                return p
        return None

    def _material_needs(self):
        """Materials still missing across the build list; the next few projects count fully, later ones half."""
        need, spare = {}, dict(self.inv)
        remaining = [p for p in self.home.projects if p.key not in self.home.built]
        for n, p in enumerate(remaining):
            weight = 1.0 if n < 3 else .5
            for k, v in p.cost.items():
                if p.key in self.home.paid:
                    continue
                use = min(spare.get(k, 0), v)
                spare[k] = spare.get(k, 0) - use
                if v - use > 0:
                    need[k] = need.get(k, 0) + (v - use) * weight
        if "fire" in self.home.built and self.inv["wood"] < 2:
            need["wood"] = need.get("wood", 0) + 2
        return need

    def _water_source(self):
        w, home = self.world, self.home
        opts = [(*w.shore_point(self.x, self.y), "the pond", False)]
        opts += [(x, y, name, False) for x, y, name in w.wells]
        if "barrel" in home.built and home.barrel_water > 0:
            bx, by = home.pos((4.2, 2.4))
            opts.append((bx, by, "the rain barrel", True))

        def cost(o):
            return self.dist(o[0], o[1]) * (1 + self.memory.danger_at(o[0], o[1]) * .5) - (80 if o[3] else 0)

        return min(opts, key=cost) if opts else None

    def _pick_tree(self):
        cached = getattr(self, "_tree_cache", None)
        if cached and cached[1].alive and self.sim.minutes - cached[0] < 15:
            return cached[1]
        tree = self._search_tree()
        self._tree_cache = (self.sim.minutes, tree) if tree else None
        return tree

    def _search_tree(self):
        b = self.home.base
        best, bs = None, 1e18
        for t in self.world.trees_near(b.x, b.y, 140):
            db = math.hypot(t.x - b.x, t.y - b.y)
            if db < 21:
                continue
            s = db + self.dist(t.x, t.y) * .4 + self.memory.danger_at(t.x, t.y) * 60
            if s < bs:
                best, bs = t, s
        return best

    def _best_scavenge(self, needs, hunger, thirst):
        inv, mem, T = self.inv, self.memory, self.traits
        weights = {
            "food": (.5 + 2 * hunger) if inv["food"] < 3 else .2,
            "water": (.5 + 2 * thirst) if inv["water"] < 3 else .2,
            "axe": 2.5 if not inv["axe"] else 0,
            "rifle": 1.8 if not inv["rifle"] else 0,
            "ammo": .8 if inv["rifle"] and inv["ammo"] < 10 else .05,
            "bandage": .6 if inv["bandage"] < 2 else .05,
            "medkit": .5,
            "nails": min(needs.get("nails", 0), 10) * .14,
            "scrap": min(needs.get("scrap", 0), 10) * .14,
        }
        night = self.daylight() < .3
        t = self.sim.minutes
        best, best_s, best_d = None, 0.0, ""
        for i, site in enumerate(self.world.loot):
            p = mem.places[i]
            if not p.known:
                continue
            ev = sum(ch * weights.get(item, 0) * math.sqrt((lo + hi) / 2) for item, (ch, lo, hi) in LOOT_TABLES[site.kind].items())
            if p.visits:
                since = t - p.last_visit
                fresh = clamp01(since / (4 * 1440)) * .8
                if p.last_yield == 0 and since < 2 * 1440:
                    fresh *= .3
                ev *= fresh
            d = self.dist(site.x, site.y)
            danger = mem.danger_at(site.x, site.y)
            score = clamp01(ev / 1.6) * (1 / (1 + d / 350)) * (1 - min(1.0, danger * .35 * (.5 + T["caution"]))) * (1 - p.scare * .8)
            if night:
                score *= .25
            score *= .7 * (.75 + .25 * T["diligence"])
            if score > best_s:
                why = "never searched" if not p.visits else f"searched {(t - p.last_visit) / 1440:.1f} days ago"
                if danger > .8:
                    why += " · risky"
                best, best_s, best_d = site, score, f"{site.label} {site.where} · {d:.0f} m · {why}"
        return best, best_s, best_d

    def _explore_target(self):
        best, bd = None, 1e18
        for s in self.world.sites:
            if s.kind == "base":
                continue
            unknown = [i for i, l in enumerate(self.world.loot) if l.site == s.name and not self.memory.places[i].known]
            if not unknown:
                continue
            d = self.dist(s.x, s.y) * (1 + self.memory.danger_at(s.x, s.y) * .4)
            if d < bd:
                best, bd = (s.x, s.y, s.name), d
        return best

    # ------------------------------------------------------------------ running actions

    def _run(self, dt):
        a = self.action
        if a.done:
            return
        if a.instr is None:
            self._advance(None)
            if a.done:
                return
        kind = a.instr[0]
        if kind == "move":
            _, tx, ty, pace, arrive = a.instr
            result = self._move_to(tx, ty, pace, arrive, dt)
            if result is not None:
                self._advance(result)
        elif kind == "do":
            _, anim, dur, face = a.instr
            self.anim, self.speed = anim, 0.0
            if face:
                fx, fy = face() if callable(face) else face
                self._face(fx, fy, dt)
            a.t += dt * (self._work_rate() if anim in ("build", "chop", "gather", "loot") else 1)
            a.progress = min(1.0, a.t / dur) if dur > 3 else None
            if anim in ("chop", "build"):
                self.work_noise_t -= dt
                if self.work_noise_t <= 0:
                    self.work_noise_t = 6
                    self.sim.noise(self.x, self.y, 38 if anim == "chop" else 28, "work")
            if a.t >= dur:
                a.t, a.progress = 0.0, None
                self._advance(True)
        elif kind == "until":
            _, anim, pred = a.instr
            self.anim, self.speed = anim, 0.0
            if pred():
                self._advance(True)
        elif kind == "approach":
            _, z, reach = a.instr
            if not z.alive:
                self._advance(False)
                return
            d = self.dist(z.x, z.y)
            if d <= reach:
                self._advance(True)
                return
            self._step_towards(z.x, z.y, "jog", dt)

    def _advance(self, value):
        a = self.action
        try:
            a.instr = a.gen.send(value if a.started else None)
            a.started = True
        except StopIteration:
            a.done = True
            a.instr = None
            self.anim = "idle"

    def _work_rate(self):
        return (.75 + .5 * self.traits["diligence"]) * (.75 + .35 * self.morale / 100) * (.7 if self.energy < 15 else 1)

    def _face(self, fx, fy, dt):
        want = math.atan2(fy - self.y, fx - self.x)
        diff = (want - self.heading + math.pi) % (2 * math.pi) - math.pi
        self.heading += diff * (1 - math.exp(-dt * 8))

    def _speed_for(self, pace):
        s = PACE[pace] * (1 - min(.45, self.world.slope(self.x, self.y) * .5))
        if self.health < 30:
            s *= .8
        if self.energy < 12 and pace in ("jog", "run"):
            s *= .75
        return s

    def _step_towards(self, tx, ty, pace, dt, avoid=True):
        dx, dy = tx - self.x, ty - self.y
        d = math.hypot(dx, dy)
        if d < 1e-4:
            return d
        dx, dy = dx / d, dy / d
        if avoid and pace != "run":
            # give wide berth to remembered infected that haven't noticed us
            for th in self.memory.threats.values():
                if th.aware or th.heard_only:
                    continue
                ox, oy = self.x - th.x, self.y - th.y
                od = math.hypot(ox, oy)
                if 0 < od < 14:
                    k = (14 - od) / 14 * 1.6
                    dx, dy = dx + ox / od * k, dy + oy / od * k
            n = math.hypot(dx, dy) or 1
            dx, dy = dx / n, dy / n
        want = math.atan2(dy, dx)
        diff = (want - self.heading + math.pi) % (2 * math.pi) - math.pi
        self.heading += diff * (1 - math.exp(-dt * 7))
        sp = self._speed_for(pace)
        self.speed, self.pace, self.anim = sp, pace, pace
        nx, ny = self.x + math.cos(self.heading) * sp * dt, self.y + math.sin(self.heading) * sp * dt
        self.x, self.y = self.world.resolve(nx, ny, self.RADIUS)
        self.memory.day_log["km"] += sp * dt / 1000
        return d

    def _move_to(self, tx, ty, pace, arrive, dt):
        if self.path_goal != (tx, ty):
            self._plan(tx, ty)
        if self.dist(tx, ty) <= arrive:
            self.path_goal = None
            self.speed = 0.0
            return True
        # quietly slow down near infected that haven't seen us
        if pace in ("walk", "jog") and any(not t.aware and not t.heard_only and self.dist(t.x, t.y) < 18 for t in self.memory.threats.values()):
            pace = "sneak"
        wx, wy = self.path[0] if self.path else (tx, ty)
        last = len(self.path) <= 1
        if self._step_towards(wx, wy, pace, dt) < (arrive if last else 1.6) and self.path:
            self.path.pop(0)
        self.stuck_t += dt
        if self.stuck_t > 2.5:
            moved = math.hypot(self.x - self.stuck_ref[0], self.y - self.stuck_ref[1])
            self.stuck_t, self.stuck_ref = 0.0, (self.x, self.y)
            if moved < .6:
                self.fails += 1
                self.heading += self.sim.rng.uniform(1, 2) * (1 if self.sim.rng.random() < .5 else -1)
                self._plan(tx, ty)
                if self.fails > 4:
                    self.fails = 0
                    self.path_goal = None
                    return False
            else:
                self.fails = 0
        return None

    def _plan(self, tx, ty):
        weight = 1.5 + 4 * self.traits["caution"]
        path, _ = self.world.find_path(self.x, self.y, tx, ty, danger=self.memory.danger, danger_weight=weight)
        self.path, self.path_goal = path, (tx, ty)
        self.stuck_t, self.stuck_ref = 0.0, (self.x, self.y)

    def _go(self, x, y, pace="jog", arrive=1.0):
        """Walk to a point, entering or leaving the homestead through the gate when walls are up."""
        w, home = self.world, self.home
        if any(w.pal_segments):
            inside_now, inside_goal = home.inside(self.x, self.y, 0), home.inside(x, y, 0)
            if inside_now != inside_goal:
                out_p, in_p = w.gate_point(w.pal_r + 3), w.gate_point(w.pal_r - 3)
                first, second = (in_p, out_p) if inside_now else (out_p, in_p)
                yield ("move", first[0], first[1], pace, 1.5)
                yield ("move", second[0], second[1], pace, 1.5)
        ok = yield ("move", x, y, pace, arrive)
        return ok

    # ------------------------------------------------------------------ actions

    def _act_drink(self):
        self.say("Throat's dry. Half the bottle, save the rest.")
        yield ("do", "eat", 4, None)
        self.inv["water"] -= 1
        self.water = min(100.0, self.water + 45)
        self.sim.float_text(self, "Drank", "good")

    def _act_eat(self):
        self.say(self.sim.rng.choice(["Cold beans again. Still tastes like a feast.", "Eating slowly. Make it last."]))
        yield ("do", "eat", 6, None)
        self.inv["food"] -= 1
        self.food = min(100.0, self.food + 42)
        self.morale = min(100.0, self.morale + 3)
        self.sim.float_text(self, "Ate", "good")

    def _act_fetch_water(self, src):
        sx, sy, name, barrel = src
        self.say(f"Out of water. Heading to {name}." if not self.inv["water"] else f"Topping up at {name} while I'm close.")
        ok = yield from self._go(sx, sy, "run" if self.water < 15 else "jog", 1.3)
        if not ok:
            return
        face = self.home.pos((5, 3.5)) if barrel else (self.world.pond[0], self.world.pond[1])
        yield ("do", "drink", 10, face)
        if barrel:
            if self.home.barrel_water <= 0:
                self.say("Barrel's dry.")
                return
            self.home.barrel_water -= 1
        self.water = 100.0
        if not barrel:
            self.inv["water"] = max(self.inv["water"], min(self.inv["water"] + 2, 3))
        self.log(f"Drank from {name} and filled bottles.")

    def _act_harvest(self):
        home = self.home
        self.say("The garden should have something ready.")
        yield from self._go(*home.pos((5, -3)), "jog")
        yield ("do", "loot", 10, home.pos((7.5, -4.5)))
        n = home.garden_food
        home.garden_food = 0
        self.inv["food"] += n
        self.morale = min(100.0, self.morale + 4)
        self.sim.float_text(self, f"+{n} Vegetables", "good")
        self.log(f"Harvested {n} heads of cabbage from the garden.", "good")

    def _act_bandage(self):
        self.say("I'm bleeding. Need to wrap this now.")
        yield ("do", "heal", 8, None)
        self.inv["bandage"] -= 1
        self.bleeding = False
        self.health = min(100.0, self.health + 8)
        self.log("Stopped the bleeding with a bandage.", "good")

    def _act_medkit(self):
        self.say("Patching myself up with the first-aid kit.")
        yield ("do", "heal", 12, None)
        self.inv["medkit"] -= 1
        self.health = min(100.0, self.health + 45)
        self.log("Used a first-aid kit. Feeling steadier.", "good")

    def _act_sleep(self):
        home = self.home
        bx, by = home.bed()
        if self.daylight() > .5:
            self.say("Running on empty. A few hours' rest, then back to it.")
        else:
            self.say("Long day. Sleeping in the cabin tonight." if "roof" in home.built else "Too dark to work. Getting some sleep.")
        if "fire" in home.built and home.fire_fuel < 1.5 and self.inv["wood"]:
            yield from self._go(*home.pos((1.4, -1)), "jog", .8)
            yield ("do", "loot", 5, home.fire_pos)
            self.inv["wood"] -= 1
            home.fire_fuel += 5
        yield from self._go(bx, by, "jog", .8)
        self._journal()

        def rested():
            h = self.sim.hour
            return self.energy >= 99 and 5.3 <= h < 21 or (self.energy > 80 and 6.5 <= h < 19)

        yield ("until", "sleep", rested)
        self.say(self.sim.rng.choice(["Still alive. That counts for something.", "Birds are singing. Strange how that never stopped.", "Back to work."]))

    def _journal(self):
        dl = self.memory.day_log
        bits = []
        if dl["loots"]:
            bits.append(f"searched {dl['loots']} places, found {dl['found']} things")
        if dl["kills"]:
            bits.append(f"put down {dl['kills']} infected")
        if dl["built"]:
            bits.append("built the " + " and the ".join(b.lower() for b in dl["built"]))
        if dl["close_calls"]:
            bits.append("nearly didn't make it back")
        if bits:
            self.log(f"{self.first_name}'s journal: " + "; ".join(bits) + f". Walked {dl['km']:.1f} km.", "journal")
        self.memory.day_log = {"loots": 0, "found": 0, "kills": 0, "built": [], "close_calls": 0, "km": 0.0}

    def _act_tend_fire(self):
        self.say("Fire's low. Another log.")
        yield from self._go(*self.home.pos((1.4, -1)), "walk", .8)
        yield ("do", "loot", 5, self.home.fire_pos)
        self.inv["wood"] -= 1
        self.home.fire_fuel += 5

    def _act_rest(self):
        self.say(self.sim.rng.choice(["Sitting by the fire. Listening to the dark.", "The fire keeps them away. Mostly.",
                                      "Thinking about the people who lived in Staroye."]))
        yield from self._go(*self.home.pos((1.9, -1.2)), "walk", .6)
        yield ("do", "sit", self.sim.rng.uniform(40, 70), self.home.fire_pos)
        self.morale = min(100.0, self.morale + 4)

    def _act_repair(self):
        home = self.home
        self.say("They've been at the walls. Patching the worst of it.")
        seg = home.breached if home.breached is not None else self.sim.rng.randint(1, 3)
        a = self.world.gate_angle + math.pi / 2 * seg
        px, py = home.base.x + math.cos(a) * 15, home.base.y + math.sin(a) * 15
        yield from self._go(px, py, "jog", .8)
        yield ("do", "build", 30, (home.base.x + math.cos(a) * 17.5, home.base.y + math.sin(a) * 17.5))
        self.inv["wood"] -= 2
        home.wall_hp = min(100.0, home.wall_hp + 35)
        if home.breached is not None:
            home.breached = None
            self.world.set_palisade([f"pal{i}" in home.built for i in range(4)])
            home.changed = True
            self.log("Rebuilt the broken stretch of palisade. The walls hold again.", "build")
        else:
            self.log("Repaired a weak stretch of the palisade.")

    def _act_build(self, p):
        home = self.home
        sx, sy = home.pos(p.stand)
        tx, ty = home.pos(p.at)
        self.say(f"Building the {p.name.lower()}.")
        ok = yield from self._go(sx, sy, "jog", .8)
        if not ok or not home.can_afford(p, self.inv):
            return
        if p.key not in home.paid:
            home.pay(p, self.inv)
            self.log(f"Started the {p.name.lower()}.", "build")
        home.progress.setdefault(p.key, 0.0)
        home.changed = True
        start = home.progress[p.key]
        remaining = p.minutes * (1 - start)
        steps = max(1, int(remaining // 10))
        for i in range(steps):
            yield ("do", "build", remaining / steps, (tx, ty))
            home.progress[p.key] = start + (1 - start) * (i + 1) / steps
        home.finish(p)
        n = len(home.built)
        self.memory.day_log["built"].append(p.name)
        self.morale = min(100.0, self.morale + 8)
        self.log(f"Finished the {p.name.lower()}. Homestead {n}/{len(home.projects)}.", "build")
        self.sim.float_text(self, f"{p.name} built", "gold")
        self.say(p.line)

    def _act_wood(self, tree):
        d = self.dist(tree.x, tree.y) or 1
        sx, sy = tree.x + (self.x - tree.x) / d * 1.3, tree.y + (self.y - tree.y) / d * 1.3
        if self.inv["axe"]:
            self.say(self.sim.rng.choice(["Need timber. That one will do.", "Chopping wood. Honest work.", "A few more logs and the wall goes up."]))
        else:
            self.say("No axe. Breaking dead branches by hand.")
        ok = yield from self._go(sx, sy, "jog", .7)
        if not ok or not tree.alive:
            return
        if self.inv["axe"]:
            yield ("do", "chop", 22, (tree.x, tree.y))
            if not tree.alive:
                return
            self.world.fell_tree(tree)
            self.sim.on_tree_felled(tree, self)
            self.sim.noise(tree.x, tree.y, 55, "work")
            self.inv["wood"] = min(16, self.inv["wood"] + 4)
            self.sim.float_text(self, "+4 Wood", "good")
        else:
            yield ("do", "gather", 26, (tree.x, tree.y))
            self.inv["wood"] = min(16, self.inv["wood"] + 2)
            self.sim.float_text(self, "+2 Wood", "good")

    def _act_scavenge(self, site):
        p = self.memory.places[site.idx]
        if p.visits:
            self.say(f"Back to the {site.label} {site.where}. Might have missed something.")
        elif self.inv["axe"] == 0 and site.kind in ("barn", "cottage"):
            self.say(f"Farm buildings keep tools. Checking the {site.label} {site.where}.")
        elif not self.inv["rifle"] and site.kind == "military":
            self.say("The army left in a hurry. Maybe they left a gun.")
        else:
            self.say(f"Going through the {site.label} {site.where}.")
        ok = yield from self._go(site.x, site.y, "jog", 1.0)
        if not ok:
            self.memory.places[site.idx].last_visit = self.sim.minutes
            return
        yield ("do", "loot", self.sim.rng.uniform(10, 16), (site.cx, site.cy))
        self._loot(site)

    def _loot(self, site):
        sim, inv, rng = self.sim, self.inv, self.sim.rng
        p = self.memory.places[site.idx]
        p.visits += 1
        p.last_visit = sim.minutes
        self.loots += 1
        self.memory.day_log["loots"] += 1
        got = []
        if not site.looted:
            pity = not inv["axe"] and self.loots_since_axe >= 3
            for item, (chance, lo, hi) in LOOT_TABLES[site.kind].items():
                if item in ("axe", "rifle") and inv[item]:
                    continue
                if item == "axe" and pity:
                    chance = 1.0
                if rng.random() < chance:
                    n = rng.randint(lo, hi)
                    if item == "rifle":
                        inv["rifle"] = 1
                        inv["ammo"] += rng.randint(4, 10)
                    elif item == "axe":
                        inv["axe"] = 1
                    else:
                        inv[item] += n
                    got.append((item, n))
            site.looted = True
            site.restock_at = sim.minutes + 1440 * rng.uniform(3, 5)
        self.loots_since_axe = 0 if inv["axe"] else self.loots_since_axe + 1
        p.last_yield = sum(n for _, n in got)
        self.memory.day_log["found"] += p.last_yield
        inv["wood"] = min(inv["wood"], 16)
        if not got:
            sim.float_text(self, "Nothing", "bad")
            self.morale = max(0.0, self.morale - 2)
            if rng.random() < .5:
                self.log(f"Searched {_a(site.label)} {site.where}. Picked clean.")
            self.say(rng.choice(["Someone got here first.", "Empty. Just dust and broken glass.", "Nothing. Keep moving."]))
            return
        for i, (item, n) in enumerate(got):
            label = item.capitalize() if item not in ("axe", "rifle") else item.capitalize()
            sim.float_text(self, f"+{n} {label}" if n > 1 else f"+{label}", "gold" if item in ("axe", "rifle") else "good", delay=i * .35)
        main = next((g for g in got if g[0] in ("axe", "rifle")), got[0])
        noun = rng.choice(ITEM_NAMES[main[0]])
        what = _a(noun) if main[1] == 1 else f"{main[1]}x {noun}"
        more = " and more" if len(got) > 1 else ""
        self.log(f"Found {what}{more} in {_a(site.label)} {site.where}.", "build" if main[0] in ("axe", "rifle") else "good")
        self.morale = min(100.0, self.morale + 2 + 4 * (main[0] in ("axe", "rifle")))
        if main[0] == "axe":
            self.say("An axe. Now I can actually build something.")
        elif main[0] == "rifle":
            self.say("A rifle. I feel a little less like prey.")
        else:
            self.say(rng.choice(["That will keep me going.", "Good haul.", "Better than nothing.", "Into the pack."]))

    def _act_explore(self, target):
        x, y, name = target
        self.say(f"Never been properly through {name}. Time to look.")
        a = self.sim.rng.uniform(0, 2 * math.pi)
        yield from self._go(x + math.cos(a) * 10, y + math.sin(a) * 10, "walk", 3)
        yield ("do", "idle", 8, None)

    def _act_go_home(self):
        self.say("Soaked through. Heading home.")
        yield from self._go(*self.home.bed(), "jog", 1.0)

    def _act_despair(self):
        self.say(self.sim.rng.choice(["What's the point of any of this.", "I keep seeing their faces.", "Just need a minute."]))
        yield ("do", "sit", 25, None)
        self.morale = min(100.0, self.morale + 6 + 10 * self.traits["resilience"])

    def _act_patrol(self):
        home = self.home
        self.say("Walking the perimeter. Checking the walls.")
        a = self.sim.rng.uniform(0, 2 * math.pi)
        r = self.sim.rng.uniform(4, 13)
        yield from self._go(home.base.x + math.cos(a) * r, home.base.y + math.sin(a) * r, "walk")
        yield ("do", "idle", self.sim.rng.uniform(8, 16), None)

    # --- threats ---

    def _act_fight(self, first=None):
        sim = self.sim
        target = first
        while self.alive:
            if target is None or not target.alive:
                aware, unaware = self.threat_summary()
                pool = aware or ([] if first is None else unaware)
                if not pool:
                    return
                target = pool[0][1]
            d = self.dist(target.x, target.y)
            if self.inv["rifle"] and self.inv["ammo"] > 0 and d > 4.5:
                if self.anim != "aim":
                    self.say("Infected. Taking the shot.")
                yield ("do", "aim", .8 + self.stress / 200, lambda z=target: (z.x, z.y))
                if target.alive:
                    sim.shoot(self, target)
                continue
            if d > 1.6:
                if first is not None and not target.target_is_survivor:
                    self.say("Stay quiet. Come up behind it.")
                ok = yield ("approach", target, 1.5)
                if not ok:
                    target = None
                continue
            if self.anim != "melee":
                self.say("One of them. I'll handle it." if self.inv["axe"] else "No weapon. Fists it is.")
            yield ("do", "melee", .62, lambda z=target: (z.x, z.y))
            if target.alive and self.dist(target.x, target.y) < 2.2:
                sim.melee(self, target)

    def _act_flee(self):
        aware, _ = self.threat_summary()
        if not aware:
            return
        home, w = self.home, self.world
        cx = sum(th.x for _, _, th in aware) / len(aware)
        cy = sum(th.y for _, _, th in aware) / len(aware)
        if home.walls_closed and self.dist(home.base.x, home.base.y) < 220:
            self.say("Too many. Back to the walls. Run!")
            yield from self._go(home.base.x, home.base.y, "run", 3)
            return
        self.say("Too many of them. Run!" if len(aware) > 1 else "Can't fight this one. Run!")
        away = math.atan2(self.y - cy, self.x - cx)
        home_dir = math.atan2(home.base.y - self.y, home.base.x - self.x)
        best, bs = None, -1e9
        for k in range(-4, 5):
            a = away + k * .35
            px, py = self.x + math.cos(a) * 40, self.y + math.sin(a) * 40
            if abs(px) > HALF - 15 or abs(py) > HALF - 15 or not w.walkable(*w.cell_of(px, py)):
                continue
            edge = max(0.0, (max(abs(px), abs(py)) - 210) / 30)
            climb = max(0.0, w.ground_z(px, py) - w.ground_z(self.x, self.y)) / 10
            s = (-abs(k) * .15 - self.memory.danger_at(px, py) + math.hypot(px - cx, py - cy) / 40
                 - edge - climb + math.cos(a - home_dir) * .3)
            if s > bs:
                best, bs = (px, py), s
        if best:
            yield ("move", best[0], best[1], "run", 2)

    def _act_evade(self):
        _, unaware = self.threat_summary()
        if not unaware:
            return
        night = self.daylight() < .3
        cx = sum(th.x for _, _, th in unaware) / len(unaware)
        cy = sum(th.y for _, _, th in unaware) / len(unaware)
        for _, _, th in unaware:
            self.memory.add_danger(th.x, th.y, .5, 20)
        if night and self.dist(cx, cy) > 10:
            self.say("Get down. Don't move. Let it pass.")
            yield ("do", "crouch", 20, None)
            return
        self.say("Infected ahead. It hasn't seen me. Going around.")
        away = math.atan2(self.y - cy, self.x - cx)
        px = min(max(self.x + math.cos(away) * 25, -HALF + 15), HALF - 15)
        py = min(max(self.y + math.sin(away) * 25, -HALF + 15), HALF - 15)
        yield ("move", px, py, "sneak", 2)
        self.path_goal = None   # the next route is replanned around the new danger


def _a(noun):
    return ("an " if noun[:1].lower() in "aeiou" else "a ") + noun

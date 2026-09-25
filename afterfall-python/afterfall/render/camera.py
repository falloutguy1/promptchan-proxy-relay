"""The spectator camera: an automatic director plus chase, orbit and overhead modes."""
import math
import random

from panda3d.core import NodePath, Vec3

SHOT_NAMES = {"drone": "DRONE", "tripod": "TRIPOD", "low": "GROUND", "wide": "WIDE", "shoulder": "OVER SHOULDER", "tower": "HOMESTEAD"}
MODE_NAMES = {"chase": "CHASE", "orbit": "ORBIT · DRAG TO LOOK", "map": "OVERHEAD"}


class Director:
    def __init__(self, camera, world):
        self.cam = camera
        self.world = world
        self.mode = "cine"
        self.shot = None
        self.shot_t = self.shot_len = 0.0
        self.shots = 0
        self.target = Vec3(0, 0, 0)
        self.pos = None
        self.look = Vec3(0, 0, 0)
        self.fov = 50.0
        self.yaw, self.pitch, self.dist, self.auto = .8, .35, 14.0, True
        self.label = "CAM 1 · DRONE"

    def set_mode(self, mode):
        self.mode = mode
        self.shot = None
        if mode == "orbit":
            d = self.cam.world_position - self.target
            self.dist = max(4.0, min(80.0, d.length()))
            self.yaw = math.atan2(d.x, d.z)
            self.pitch = max(-.05, min(1.45, math.asin(max(-1, min(1, d.y / max(d.length(), 1e-3))))))
            self.auto = True
        if mode != "cine":
            self.label = MODE_NAMES[mode]

    def drag(self, dx, dy):
        if self.mode != "orbit":
            self.set_mode("orbit")
        self.auto = False
        self.yaw -= dx * 3
        self.pitch = max(-.05, min(1.45, self.pitch + dy * 2.5))

    def zoom(self, amount):
        if self.mode != "orbit":
            self.set_mode("orbit")
        self.auto = False
        self.dist = max(3.0, min(90.0, self.dist * math.exp(amount)))

    def ground(self, x, z):
        return self.world.ground_z(x, z)

    def _new_shot(self, s, fwd, home):
        kinds = ["drone", "tripod", "low", "wide", "shoulder"]
        if s.anim in ("aim", "melee") or (s.action and s.action.name in ("Fight", "Flee")):
            kinds = ["low", "shoulder", "tripod"]
        elif s.anim in ("build", "sit", "sleep"):
            kinds = ["drone", "tripod", "tower", "low"]
        k = random.choice(kinds)
        if self.shot and k == self.shot["kind"]:
            k = random.choice(kinds)
        sh = {"kind": k, "a": random.uniform(0, 2 * math.pi), "s": random.choice((-1, 1))}
        t = self.target
        if k == "tripod":
            ahead, side = random.uniform(12, 22), random.uniform(5, 11) * sh["s"]
            px, pz = t.x + fwd.x * ahead + fwd.z * side, t.z + fwd.z * ahead - fwd.x * side
            sh["pos"] = Vec3(px, self.ground(px, pz) + random.uniform(1.2, 2.4), pz)
            sh["fov"] = random.uniform(26, 34)
        elif k == "wide":
            sh["r"], sh["h"], sh["fov"] = random.uniform(45, 70), random.uniform(18, 32), 40
        elif k == "tower":
            px, pz = home.base.x + random.uniform(-24, 24), home.base.y + random.uniform(-24, 24)
            sh["pos"] = Vec3(px, self.ground(px, pz) + random.uniform(9, 16), pz)
            sh["fov"] = 42
        self.shot = sh
        self.shot_t, self.shot_len = 0.0, random.uniform(8, 13)
        self.shots += 1
        self.label = f"CAM {1 + self.shots % 6} · {SHOT_NAMES[k]}"

    def update(self, dt, s, home):
        head_h = .4 if s.anim in ("sleep", "dead") else 1.35
        want_t = Vec3(s.x, self.ground(s.x, s.y) + head_h, s.y)
        if (want_t - self.target).length() > 30:
            self.target = want_t
        else:
            self.target += (want_t - self.target) * (1 - math.exp(-dt * 5))
        t = self.target
        fwd = Vec3(math.cos(s.heading), 0, math.sin(s.heading))
        look = Vec3(t)
        fov = 50.0
        snap = False
        if self.mode == "cine":
            self.shot_t += dt
            far_tripod = self.shot and self.shot["kind"] == "tripod" and (self.shot["pos"] - t).length() > 40
            if self.shot is None or self.shot_t > self.shot_len or far_tripod:
                self._new_shot(s, fwd, home)
                snap = True
            sh = self.shot
            fov = sh.get("fov", 50)
            k = sh["kind"]
            if k == "drone":
                sh["a"] += dt * .09 * sh["s"]
                pos = Vec3(t.x + math.sin(sh["a"]) * 22, t.y + 13, t.z + math.cos(sh["a"]) * 22)
                fov = 45
            elif k in ("tripod", "tower"):
                pos = Vec3(sh["pos"])
            elif k == "low":
                pos = Vec3(t.x - fwd.x * 2.5 + fwd.z * 3.6 * sh["s"], self.ground(t.x, t.z) + .5, t.z - fwd.z * 2.5 - fwd.x * 3.6 * sh["s"])
                look.y -= .2
                fov = 55
            elif k == "wide":
                sh["a"] += dt * .03
                pos = Vec3(t.x + math.sin(sh["a"]) * sh["r"], t.y + sh["h"], t.z + math.cos(sh["a"]) * sh["r"])
            else:  # shoulder
                pos = Vec3(t.x - fwd.x * 3.4 - fwd.z * .9 * sh["s"], t.y + .55, t.z - fwd.z * 3.4 + fwd.x * .9 * sh["s"])
                look = Vec3(t.x + fwd.x * 8, t.y, t.z + fwd.z * 8)
                fov = 52
        elif self.mode == "chase":
            pos = Vec3(t.x - fwd.x * 6.5 + fwd.z * .9, t.y + 2.3, t.z - fwd.z * 6.5 - fwd.x * .9)
            look = Vec3(t.x + fwd.x * 4, t.y + .3, t.z + fwd.z * 4)
            fov = 55
        elif self.mode == "orbit":
            if self.auto:
                self.yaw += dt * .05
            cp = math.cos(self.pitch)
            pos = Vec3(t.x + math.sin(self.yaw) * cp * self.dist, t.y + math.sin(self.pitch) * self.dist, t.z + math.cos(self.yaw) * cp * self.dist)
            fov = 50
        else:  # map
            pos = Vec3(t.x + .01, t.y + 150, t.z - 55)
            fov = 40
        g = self.ground(pos.x, pos.z) + .45
        if pos.y < g:
            pos.y = g
        if self.pos is None or (snap and self.mode == "cine"):
            self.pos = Vec3(pos)
            self.look = Vec3(look)
        else:
            rate = 12 if self.mode == "orbit" else (2.5 if self.mode == "cine" and self.shot["kind"] not in ("tripod", "tower") else 3.5)
            self.pos += (pos - self.pos) * (1 - math.exp(-dt * rate))
            self.look += (look - self.look) * (1 - math.exp(-dt * 6))
        self.fov += (fov - self.fov) * (1 - math.exp(-dt * 3))
        self.cam.world_position = self.pos
        NodePath.look_at(self.cam, self.cam.parent, self.look, Vec3(0, 1, 0))
        self.cam.fov = self.fov

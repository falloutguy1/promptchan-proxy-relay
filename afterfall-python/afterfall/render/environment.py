"""Sun, moon, sky dome, fog and the shared shader inputs, driven by the simulation clock and weather."""
import math

import numpy as np
from panda3d.core import DirectionalLight, NodePath, Vec3

from .geometry import PRIMS, make_geom_node, to_panda
from .shaders import sky_shader


def _c(h):
    return np.array([((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255])


def _smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


SKY = {"night_z": _c(0x05070d), "night_h": _c(0x121a28), "dusk_z": _c(0x2a3452), "dusk_h": _c(0xd0804a),
       "day_z": _c(0x3d6ea8), "day_h": _c(0xb9c8cf), "grey_z": _c(0x5a626b), "grey_h": _c(0x8d9499)}


class Environment:
    def __init__(self, sim, scene: NodePath, camera_np: NodePath, shadow_size=2048):
        self.sim = sim
        self.scene = scene
        self.camera_np = camera_np
        self.sun = DirectionalLight("sun")
        self.sun.set_shadow_caster(True, shadow_size, shadow_size)
        lens = self.sun.get_lens()
        lens.set_film_size(150, 150)
        lens.set_near_far(1, 700)
        self.sun_np = scene.attach_new_node(self.sun)
        scene.set_light(self.sun_np)
        self.shadow_size = shadow_size
        v, n, t = PRIMS["sphere"]
        dome = make_geom_node("sky", to_panda(v * 1800), to_panda(n), np.ones((len(v), 4)), t[:, ::-1])
        self.sky = scene.attach_new_node(dome)
        self.sky.set_shader(sky_shader(), 10)
        self.sky.set_bin("background", 0)
        self.sky.set_depth_write(False)
        self.sky.set_light_off()
        self.t = 0.0
        self.values = {}

    def set_shadow_size(self, size):
        if size == self.shadow_size:
            return
        self.shadow_size = size
        self.sun.set_shadow_caster(size > 0, max(size, 256), max(size, 256))

    def update(self, dt, focus: Vec3):
        sim = self.sim
        self.t += dt
        hour = sim.hour
        ang = hour / 24 * 2 * math.pi - math.pi / 2
        # simulation space: x east, y north, z up -> panda (x, z, y)
        sun_sim = np.array([math.cos(ang) * .85, .42, math.sin(ang)])
        sun_sim /= np.linalg.norm(sun_sim)
        sun = Vec3(*sun_sim[[0, 2, 1]])
        moon = Vec3(-sun.x, abs(sun.y) * .8 + .15, -sun.z)
        moon.normalize()
        e = sun.y
        day = _smooth(-.08, .3, e)
        dusk = math.exp(-(e / .14) ** 2)
        night = 1 - _smooth(-.22, .02, e)
        cl = sim.cloud
        mix = _smooth(-.25, 0, e)
        zen = SKY["night_z"] * (1 - mix) + SKY["dusk_z"] * mix
        hor = SKY["night_h"] * (1 - mix) + SKY["dusk_h"] * mix
        zen = zen * (1 - day) + SKY["day_z"] * day
        hor = hor * (1 - day) + SKY["day_h"] * day
        hor = hor * (1 - dusk * .5 * (1 - cl * .6)) + SKY["dusk_h"] * dusk * .5 * (1 - cl * .6)
        light = .06 + .94 * _smooth(-.2, .25, e)
        zen = zen * (1 - cl * .75) + SKY["grey_z"] * light * cl * .75
        hor = hor * (1 - cl * .65) + SKY["grey_h"] * light * cl * .65
        sun_col = np.array([1.0, .95, .86]) * (1 - dusk * .5) + np.array([1.0, .6, .32]) * dusk * .5
        sun_up = e > -.04
        sun_k = 1.55 * _smooth(-.04, .22, e) * (1 - cl * .7) if sun_up else .34 * (1 - cl * .5)
        sun_rgb = sun_col * sun_k if sun_up else np.array([.55, .65, .9]) * sun_k
        light_dir = sun if sun_up else moon
        sky_amb = (zen * .55 + hor * .45) * (.35 + .75 * light) + np.array([.05, .06, .09]) * night
        ground_amb = np.array([.22, .2, .15]) * (.15 + .6 * light)
        fog_col = hor * .92
        fog_density = (.0035 + sim.fog_amount * .0085 + sim.rain * .003) * (1 + night * .25)
        s = self.scene
        s.set_shader_input("u_sun_dir", light_dir)
        s.set_shader_input("u_sun_col", Vec3(*sun_rgb))
        s.set_shader_input("u_sky_col", Vec3(*sky_amb))
        s.set_shader_input("u_ground_col", Vec3(*ground_amb))
        s.set_shader_input("u_fog_col", Vec3(*fog_col))
        s.set_shader_input("u_fog_density", fog_density)
        s.set_shader_input("u_time", self.t)
        s.set_shader_input("u_wind", .25 + sim.rain * .45)
        s.set_shader_input("u_cam_pos", self.camera_np.get_pos(s))
        sk = self.sky
        sk.set_pos(self.camera_np.get_pos(s))
        sk.set_shader_input("u_sun_dir", sun)
        sk.set_shader_input("u_moon_dir", moon)
        sk.set_shader_input("u_zenith", Vec3(*zen))
        sk.set_shader_input("u_horizon", Vec3(*hor))
        sk.set_shader_input("u_sun_glow", Vec3(*(np.array([1.0, .88, .69]) * (1 - dusk) + np.array([1.0, .54, .24]) * dusk)))
        sk.set_shader_input("u_night", night)
        sk.set_shader_input("u_cloud", cl)
        sk.set_shader_input("u_light", light)
        sk.set_shader_input("u_time", self.t)
        # the shadow camera follows whatever the camera is looking at
        self.sun_np.set_pos(focus + light_dir * 300)
        self.sun_np.look_at(focus)
        self.values = {"night": night, "day": day, "light": light, "fog": fog_col}
        return self.values

"""Turns the simulation's world into Panda3D geometry and keeps the dynamic bits (homestead, felled trees,
fire, blood) in sync."""
import math

import numpy as np
from panda3d.core import LineSegs, NodePath, Quat, Vec3

from ..config import CHUNK, HALF, HN
from ..world import Pal, hexcol
from .geometry import make_geom_node, node_from_parts, to_panda, unit_node


def P(x, y, z):
    """Simulation point -> Panda3D point."""
    return Vec3(x, z, y)


class WorldView:
    def __init__(self, sim, root: NodePath):
        self.sim, self.world, self.home = sim, sim.world, sim.home
        self.root = root.attach_new_node("world")
        self._terrain()
        self._roads()
        self._water()
        self.static_root = self.root.attach_new_node("static")
        self._chunked(self.world.static_parts, self.static_root, low=False)
        self.veg_root = self.root.attach_new_node("vegetation")
        self.veg_count = 0
        self._rebuild_veg()
        self.tree_root = self.root.attach_new_node("trees")
        self.tree_nodes = {}
        by_chunk = {}
        for t in self.world.trees:
            by_chunk.setdefault(t.chunk, []).append(t)
        for key in by_chunk:
            self._build_tree_chunk(key)
        self.home_root = self.root.attach_new_node("homestead")
        self.project_nodes = {}
        self.unit = {s: NodePath(unit_node(s, low=True)) for s in ("cube", "sphere", "cylinder", "cone")}
        self._fire_props()
        self.falling, self.decals, self.tracers = [], [], []
        self.fx_seen = 0

    # --- static geometry -------------------------------------------------------------------------

    def _terrain(self):
        w = self.world
        s = HN + 1
        pos = np.stack([w.gx, w.gy, w.h], axis=-1).reshape(-1, 3)
        nrm = w.normals.reshape(-1, 3)
        col = np.concatenate([w.colors.reshape(-1, 3), np.zeros((s * s, 1))], axis=1)
        i, j = np.meshgrid(np.arange(HN), np.arange(HN))
        a = (j * s + i).ravel()
        tris = np.concatenate([np.stack([a, a + 1, a + s + 1], 1), np.stack([a, a + s + 1, a + s], 1)])
        self.root.attach_new_node(make_geom_node("terrain", to_panda(pos), to_panda(nrm), col, tris))

    def _roads(self):
        w = self.world
        self.road_nodes = []
        for road in w.roads:
            sm = road["samples"]
            width = road["w"]
            base = np.array(hexcol(Pal.ASPHALT if road["asphalt"] else Pal.DIRT_ROAD))
            pos, cols = [], []
            for i in range(len(sm)):
                t = sm[min(len(sm) - 1, i + 1)] - sm[max(0, i - 1)]
                t = t / (np.linalg.norm(t) + 1e-9)
                n = np.array([-t[1], t[0]])
                for k in range(5):
                    off = (k / 4 - .5) * width
                    x, y = sm[i] + n * off
                    edge = abs(k - 2) / 2
                    pos.append((x, y, w.ground_z(x, y) + .07 + (.02 if k == 2 else 0)))
                    shade = 1 - .12 * edge + ((i * 7 + k * 3) % 5) * .012
                    cols.append((*(base * shade), 0))
            pos = np.array(pos)
            nrm = np.tile([0, 0, 1.0], (len(pos), 1))
            tris = []
            for i in range(len(sm) - 1):
                for k in range(4):
                    a = i * 5 + k
                    tris += [(a, a + 5, a + 6), (a, a + 6, a + 1)]
            node = self.root.attach_new_node(make_geom_node("road", to_panda(pos), to_panda(nrm), np.array(cols), np.array(tris)))
            self.road_nodes.append(node)
            node.set_shader_input("u_gloss", 0.0)

    def _water(self):
        w = self.world
        px, py, pr = w.pond
        seg, r = 64, pr + 16
        pos = [(px, py, w.water_z)] + [(px + math.cos(a) * r, py + math.sin(a) * r, w.water_z) for a in np.linspace(0, 2 * math.pi, seg, endpoint=False)]
        pos = np.array(pos)
        tris = np.array([(0, 1 + k, 1 + (k + 1) % seg) for k in range(seg)])
        nrm = np.tile([0, 0, 1.0], (len(pos), 1))
        col = np.tile([*hexcol(Pal.WATER), 0], (len(pos), 1))
        self.water = self.root.attach_new_node(make_geom_node("water", to_panda(pos), to_panda(nrm), col, tris))
        self.water.set_shader_input("u_gloss", .9)

    def _chunked(self, parts, parent, low):
        groups = {}
        for p in parts:
            groups.setdefault((int((p.pos[0] + HALF) // CHUNK), int((p.pos[1] + HALF) // CHUNK)), []).append(p)
        for key, group in groups.items():
            node = node_from_parts(f"chunk{key}", group, low)
            if node:
                parent.attach_new_node(node)

    def _rebuild_veg(self):
        self.veg_root.node().remove_all_children()
        self._chunked(self.world.veg_parts, self.veg_root, low=True)
        self.veg_count = len(self.world.veg_parts)

    def _build_tree_chunk(self, key):
        old = self.tree_nodes.pop(key, None)
        if old is not None:
            old.remove_node()
        parts = [p for t in self.world.trees if t.chunk == key and t.alive for p in t.parts]
        node = node_from_parts(f"trees{key}", parts, low=True)
        if node:
            self.tree_nodes[key] = self.tree_root.attach_new_node(node)

    # --- homestead ---------------------------------------------------------------------------------

    def _project_node(self, key):
        p = self.home.by_key[key]
        parts = self.home.build_parts(key)
        if key.startswith("pal"):
            ax, ay = self.home.base.x, self.home.base.y
        else:
            ax, ay = self.home.pos(p.at)
        az = self.world.ground_z(ax, ay)
        pivot = self.home_root.attach_new_node(f"proj_{key}")
        pivot.set_pos(P(ax, ay, az))
        geom = node_from_parts(key, parts, low=False)
        if geom:
            child = pivot.attach_new_node(geom)
            child.set_pos(-P(ax, ay, az))
        return pivot

    def _fire_props(self):
        fx, fy = self.home.fire_pos
        fz = self.world.ground_z(fx, fy)
        self.fire_pos = P(fx, fy, fz)
        self.flames = self.home_root.attach_new_node("flames")
        self.flames.set_pos(self.fire_pos)
        self.flame_parts = []
        for i, (c, s) in enumerate(((0xffb347, 1.0), (0xff7a1f, .8), (0xffe08a, .55))):
            n = self.flames.attach_new_node("flame")
            self.unit["cone"].instance_to(n)
            n.set_color_scale(*hexcol(c), 1)
            n.set_shader_input("u_emissive", 1.6)
            n.set_pos(math.cos(i * 2.1) * .1, .45, math.sin(i * 2.1) * .1)
            n.set_scale(.5 * s, .9 * s, .5 * s)
            self.flame_parts.append((n, s))
        self.plants = self.home_root.attach_new_node("plants")
        for g in ("garden1", "garden2"):
            p = self.home.by_key[g]
            gx, gy = self.home.pos(p.at)
            gz = self.world.ground_z(gx, gy)
            for r in range(4):
                for c in range(7):
                    n = self.plants.attach_new_node(f"plant_{g}")
                    self.unit["sphere"].instance_to(n)
                    n.set_pos(P(gx - 1.8 + c * .6, gy - 1.1 + r * .73, gz + .3))
                    n.set_scale(.36, .26, .36)
                    n.set_color_scale(*(hexcol(0x86a55a) if r % 2 else hexcol(0x4f7a2e)), 1)
                    n.set_tag("garden", g)
        self.flag = None
        self.lamp = None
        self.radio_lamp = None

    def update_home(self):
        home = self.home
        wanted = set(home.built) | set(home.progress)
        for key in wanted:
            if key not in self.project_nodes:
                self.project_nodes[key] = self._project_node(key)
        for key, node in list(self.project_nodes.items()):
            if key not in wanted:
                node.remove_node()
                del self.project_nodes[key]
                continue
            prog = 1.0 if key in home.built else home.progress.get(key, 0.0)
            node.set_scale(1, max(.02, prog * prog * (3 - 2 * prog)), 1)
        if home.breached is not None and f"pal{home.breached}" in self.project_nodes:
            self.project_nodes[f"pal{home.breached}"].set_scale(1, .25, 1)
        grow = .35 + .65 * min(1.0, home.garden_food / 4)
        for n in self.plants.get_children():
            if n.get_tag("garden") in home.built:
                n.set_scale(.36 * grow, .26 * grow, .36 * grow)
            else:
                n.set_scale(.001)
        if "flag" in home.built and self.flag is None:
            fx, fy = home.pos(home.by_key["flag"].at)
            fz = self.world.ground_z(fx, fy)
            self.flag = self.home_root.attach_new_node("flag")
            self.flag.set_pos(P(fx, fy, fz + 6.3))
            cloth = self.flag.attach_new_node("cloth")
            self.unit["cube"].instance_to(cloth)
            cloth.set_pos(.9, 0, 0)
            cloth.set_scale(1.8, 1.1, .03)
            cloth.set_color_scale(*hexcol(0xd8d1bd), 1)
            emblem = self.flag.attach_new_node("emblem")
            self.unit["cylinder"].instance_to(emblem)
            emblem.set_pos(.9, 0, 0)
            emblem.set_hpr(0, 90, 0)
            emblem.set_scale(.7, .05, .7)
            emblem.set_color_scale(*hexcol(0x2f4a2c), 1)
        if "gen" in home.built and self.lamp is None:
            gx, gy = home.pos(home.by_key["gen"].at)
            self.lamp_pos = P(gx + 1.6, gy, self.world.ground_z(gx, gy) + 5.9)
            self.lamp = True
        if "radio" in home.built and self.radio_lamp is None:
            rx, ry = home.pos(home.by_key["radio"].at)
            self.radio_lamp = self.home_root.attach_new_node("radio_lamp")
            self.unit["sphere"].instance_to(self.radio_lamp)
            self.radio_lamp.set_pos(P(rx, ry, self.world.ground_z(rx, ry) + 15.2))
            self.radio_lamp.set_scale(.25)
            self.radio_lamp.set_color_scale(1, .15, .1, 1)
        home.changed = False

    # --- per-frame ---------------------------------------------------------------------------------

    def update(self, t, dt, night):
        home = self.home
        if home.changed or home.progress:
            self.update_home()
        fire_on = "fire" in home.built and home.fire_fuel > 0
        self.flames.set_scale(1 if fire_on else .001)
        for i, (n, s) in enumerate(self.flame_parts):
            f = .8 + .25 * math.sin(t * 11 + i * 2) * math.sin(t * 7.3 + i)
            n.set_scale(.5 * s * (1 + .1 * math.sin(t * 9 + i)), .9 * s * f, .5 * s)
        if self.flag is not None:
            self.flag.set_hpr(math.sin(t * 1.3) * 25 + 40, 0, math.sin(t * 5) * 4)
        if self.radio_lamp is not None:
            self.radio_lamp.set_shader_input("u_emissive", 4.0 if math.sin(t * 3) > .6 else 0.0)
        # felled trees and new stumps
        for key in list(self.world.dirty_chunks):
            self._build_tree_chunk(key)
        self.world.dirty_chunks.clear()
        if len(self.world.veg_parts) != self.veg_count:
            self._rebuild_veg()
        self._effects(dt)
        return fire_on

    def fire_light(self, t, night):
        home = self.home
        if "fire" not in home.built or home.fire_fuel <= 0:
            return (0, 0, 0, 0), (0, 0, 0)
        f = .8 + .2 * math.sin(t * 23) * math.sin(t * 7.3)
        p = self.fire_pos + Vec3(0, 1.1, 0)
        k = (.35 + night * 1.4) * f
        return (p.x, p.y, p.z, 20.0), (1.0 * k, .5 * k, .18 * k)

    def flood_light(self, night):
        if self.lamp is None or night < .4:
            return (0, 0, 0, 0), (0, 0, 0)
        p = self.lamp_pos
        return (p.x, p.y, p.z, 32.0), (1.1, 1.0, .85)

    def _effects(self, dt):
        sim = self.sim
        new = sim.fx[self.fx_seen:]
        self.fx_seen = len(sim.fx)
        for fx in new:
            if fx[0] == "fell":
                self._start_fall(self.world.trees[fx[1]], fx[2])
            elif fx[0] == "blood":
                x, y = fx[1], fx[2]
                n = self.root.attach_new_node("blood")
                self.unit["cylinder"].instance_to(n)
                n.set_pos(P(x, y, self.world.ground_z(x, y) + .03))
                n.set_scale(1.3, .02, 1.3)
                n.set_color_scale(.22, .02, .01, 1)
                self.decals.append([n, 0.0])
            elif fx[0] == "shot":
                _, sx, sy, zx, zy, hit = fx
                ls = LineSegs()
                ls.set_color(1, .88, .6, 1)
                ls.set_thickness(2)
                ls.move_to(P(sx, sy, self.world.ground_z(sx, sy) + 1.45))
                ls.draw_to(P(zx, zy, self.world.ground_z(zx, zy) + (1.5 if hit else 2.5)))
                n = self.root.attach_new_node(ls.create())
                n.set_shader_off()
                self.tracers.append([n, 0.0])
        if len(sim.fx) > 400:
            sim.fx = sim.fx[-100:]
            self.fx_seen = len(sim.fx)
        for item in self.falling[:]:
            node, axis, t = item
            item[2] += dt
            k = min(1.0, (item[2] / 2.2) ** 2)
            q = Quat()
            q.set_from_axis_angle(k * 88, axis)
            node.set_quat(q)
            if item[2] > 14:
                node.set_z(node.get_z() - dt * .3)
            if item[2] > 22:
                node.remove_node()
                self.falling.remove(item)
        for item in self.decals[:]:
            item[1] += dt
            if item[1] > 90:
                item[0].remove_node()
                self.decals.remove(item)
        for item in self.tracers[:]:
            item[1] += dt
            if item[1] > .15:
                item[0].remove_node()
                self.tracers.remove(item)

    def _start_fall(self, tree, direction):
        geom = node_from_parts("falling", tree.parts, low=True)
        if not geom:
            return
        base = P(tree.x, tree.y, self.world.ground_z(tree.x, tree.y))
        pivot = self.root.attach_new_node("fall")
        pivot.set_pos(base)
        child = pivot.attach_new_node(geom)
        child.set_pos(-base)
        d = Vec3(math.cos(direction), 0, math.sin(direction))
        axis = Vec3(0, 1, 0).cross(d)
        axis.normalize()
        self.falling.append([pivot, -axis, 0.0])

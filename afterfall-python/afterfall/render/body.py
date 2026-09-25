"""Jointed humanoid bodies built from primitives, with procedural animation.

Rig axes (Panda3D, y up): +z forward, +x right, left side is -x. Poses are written as small angle
tables in radians: x swings a joint forward/back, y twists, z spreads sideways. `_apply` converts
them to Panda's heading/pitch/roll.
"""
import math
import zlib

from panda3d.core import NodePath

from ..world import hexcol
from .geometry import unit_node

POSE0 = dict(hy=.95, hz=0, hrx=0, hrz=0, sx=0, sy=0, sz=0, nx=0, ny=0, nz=0, lax=0, lay=0, laz=.08, rax=0, ray=0, raz=-.08,
             le=-.15, re=-.15, llx=0, llz=0, rlx=0, rlz=0, lk=.05, rk=.05, lf=0, rf=0)

_UNITS = {}


def _unit(shape):
    if shape not in _UNITS:
        _UNITS[shape] = NodePath(unit_node(shape, low=shape != "sphere"))
    return _UNITS[shape]


def _smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


class Body:
    def __init__(self, parent: NodePath, look: dict):
        self.root = parent.attach_new_node("body")
        self.c = dict(POSE0)
        self.phase = 0.0
        self.t = 0.0
        self._hit = False
        col = look
        self.hips = self.root.attach_new_node("hips")
        self.hips.set_y(.95)
        self._part(self.hips, "sphere", (0, .02, 0), (.34, .24, .26), col["bottom"])
        self.spine = self.hips.attach_new_node("spine")
        self.spine.set_y(.08)
        self._part(self.spine, "sphere", (0, .26, 0), (.42, .56, .3), col["top"])
        self._part(self.spine, "cylinder", (0, .02, 0), (.44, .12, .34), col["top"])
        self.neck = self.spine.attach_new_node("neck")
        self.neck.set_y(.52)
        self._part(self.neck, "cylinder", (0, .04, 0), (.11, .12, .11), col["skin"])
        self.head = self.neck.attach_new_node("head")
        self.head.set_y(.1)
        self._part(self.head, "sphere", (0, .1, 0), (.21, .25, .23), col["skin"])
        self._part(self.head, "sphere", (0, .04, .03), (.16, .11, .16), col["skin"])
        self._part(self.head, "cube", (0, .09, .11), (.026, .05, .04), col["skin"])
        for s in (-1, 1):
            self._part(self.head, "sphere", (s * .04, .125, .095), (.03, .03, .03), col["eye"])
        hat = col.get("hat")
        if hat is not None:
            self._part(self.head, "sphere", (0, .16, -.005), (.25, .17, .25), hat)
            self._part(self.head, "cylinder", (0, .12, -.005), (.26, .05, .26), hat)
        else:
            self._part(self.head, "sphere", (0, .15, -.01), (.245, .17, .25), col["hair"])
        if col.get("pack"):
            pack = self.spine.attach_new_node("pack")
            pack.set_pos(0, .3, -.2)
            self._part(pack, "cube", (0, 0, 0), (.34, .44, .19), col["pack"])
            self._part(pack, "cube", (0, -.08, -.12), (.26, .16, .06), col["pack"])
            self._part(pack, "cylinder", (0, .28, 0), (.15, .4, .15), col["roll"], hpr=(0, 0, 90))
        self.sh, self.el, self.hand, self.hip, self.knee, self.foot = {}, {}, {}, {}, {}, {}
        for side, s in (("l", -1), ("r", 1)):
            sh = self.spine.attach_new_node("sh" + side)
            sh.set_pos(s * .225, .44, 0)
            self._part(sh, "sphere", (0, 0, 0), (.14, .14, .14), col["top"])
            self._part(sh, "sphere", (0, -.14, 0), (.11, .34, .11), col["top"])
            el = sh.attach_new_node("el" + side)
            el.set_y(-.29)
            self._part(el, "sphere", (0, -.12, 0), (.096, .3, .096), col.get("sleeve", col["top"]))
            self._part(el, "sphere", (0, -.27, .005), (.085, .11, .07), col["skin"])
            hand = el.attach_new_node("hand" + side)
            hand.set_y(-.28)
            hip = self.hips.attach_new_node("hip" + side)
            hip.set_pos(s * .1, -.02, 0)
            self._part(hip, "sphere", (0, -.21, 0), (.15, .5, .15), col["bottom"])
            kn = hip.attach_new_node("kn" + side)
            kn.set_y(-.44)
            self._part(kn, "sphere", (0, -.2, 0), (.124, .46, .124), col["bottom"])
            ft = kn.attach_new_node("ft" + side)
            ft.set_y(-.42)
            self._part(ft, "cube", (0, -.02, .05), (.11, .11, .26), col["boots"])
            self.sh[side], self.el[side], self.hand[side], self.hip[side], self.knee[side], self.foot[side] = sh, el, hand, hip, kn, ft
        self.items = {}

    def _part(self, parent, shape, pos, scale, color, hpr=(0, 0, 0)):
        n = parent.attach_new_node(shape)
        _unit(shape).instance_to(n)
        n.set_pos(*pos)
        n.set_scale(*scale)
        n.set_hpr(*hpr)
        n.set_color_scale(*color, 1)
        return n

    # --- items -------------------------------------------------------------------------------------

    def add_items(self):
        axe = self.hand["r"].attach_new_node("axe")
        self._part(axe, "cylinder", (0, -.25, 0), (.04, .72, .04), hexcol(0x7b6a55))
        self._part(axe, "cube", (0, -.58, .08), (.03, .12, .2), hexcol(0x9a9a96))
        rifle = self.spine.attach_new_node("rifle")
        self._part(rifle, "cube", (0, -.35, 0), (.04, .9, .05), hexcol(0x3c3d3e))
        self._part(rifle, "cube", (0, .12, 0), (.05, .32, .08), hexcol(0x6a4a30))
        self._part(rifle, "cylinder", (0, -.2, .06), (.045, .26, .045), hexcol(0x2b2b2b))
        hammer = self.hand["r"].attach_new_node("hammer")
        self._part(hammer, "cylinder", (0, -.1, 0), (.035, .34, .035), hexcol(0x7b6a55))
        self._part(hammer, "cube", (0, -.28, 0), (.05, .05, .14), hexcol(0x5b5c5a))
        self.items = {"axe": axe, "rifle": rifle, "hammer": hammer}
        for n in self.items.values():
            n.hide()

    def show_items(self, anim, has_axe, has_rifle):
        if not self.items:
            return
        aim = anim == "aim"
        self.items["hammer"].show() if anim == "build" else self.items["hammer"].hide()
        busy = anim in ("build", "aim", "sleep", "dead", "drink", "eat")
        self.items["axe"].show() if has_axe and not busy else self.items["axe"].hide()
        r = self.items["rifle"]
        if has_rifle:
            r.show()
            if aim:
                r.reparent_to(self.hand["r"])
                r.set_pos_hpr(0, 0, 0, 0, 0, 0)
            else:
                r.reparent_to(self.spine)
                r.set_pos_hpr(.12, .5, -.3, 0, 0, 150)
        else:
            r.hide()

    # --- animation ---------------------------------------------------------------------------------

    def pose(self, anim, dt, speed, roll=0.0, on_hit=None):
        self.t += dt
        t = self.t
        p = {}

        def gait(a, lean=0.0):
            stride = 1.25 + speed * .22
            self.phase += dt * speed / stride * 2 * math.pi
            ph = self.phase
            sn, cs = math.sin(ph), math.cos(ph)
            p.update(llx=-sn * a * .62, rlx=sn * a * .62, lk=.08 + max(0, cs) * a * 1.15, rk=.08 + max(0, -cs) * a * 1.15,
                     lf=max(0, -cs) * a * .3, rf=max(0, cs) * a * .3, lax=sn * a * .72, rax=-sn * a * .72,
                     le=-.25 - a * .45, re=-.25 - a * .45, hy=.95 - a * .05 + abs(cs) * a * .045,
                     sx=lean + a * .06, sy=sn * a * .14, hrz=cs * a * .03, nx=-lean * .5)

        if anim == "walk":
            gait(.5)
        elif anim == "jog":
            gait(.78, .08)
        elif anim == "run":
            gait(1.05, .18)
        elif anim == "sneak":
            gait(.4, .35)
            p.update(hy=.78, lk=p["lk"] + .6, rk=p["rk"] + .6, llx=p["llx"] - .35, rlx=p["rlx"] - .35, lax=-.4, rax=-.5, le=-.9, re=-.9)
        elif anim == "crouch":
            p.update(hy=.55, llx=-1.2, lk=2.0, rlx=.2, rk=1.8, rf=.5, sx=.45, nx=-.1, lax=-.5, rax=-.6, le=-.9, re=-.8)
        elif anim == "idle":
            p.update(sx=math.sin(t * 1.4) * .015, nx=math.sin(t * .4) * .06, ny=math.sin(t * .27) * .35, lax=math.sin(t * 1.4) * .03,
                     rax=-math.sin(t * 1.4) * .03, hrz=math.sin(t * .5) * .02, llz=.04, rlz=-.04)
        elif anim == "loot":
            w = t * 3.2
            p.update(hy=.56, llx=-1.25, lk=2.0, rlx=.25, rk=1.9, rf=.6, sx=.55, nx=.35, lax=-1.05 + math.sin(w) * .3,
                     rax=-1.2 + math.cos(w * 1.3) * .35, le=-.5, re=-.6 + math.sin(w) * .2, lay=.2, ray=-.2, sy=math.sin(w * .5) * .15)
        elif anim == "gather":
            dn = .5 + .5 * math.sin(t * 2.4)
            p.update(hy=.95 - dn * .25, sx=.3 + dn * .8, llx=-dn * .4, rlx=-dn * .2, lk=dn * .7, rk=dn * .5, lax=-.4 - dn * .9,
                     rax=-.5 - dn, le=-.3, re=-.3, nx=.2)
        elif anim == "chop":
            w = (t * 1.25) % 1
            sw = _smooth(0, .55, w) if w < .55 else 1 - _smooth(.55, .72, w)
            a = -.35 + (-2.7 + .35) * sw
            p.update(rax=a, lax=a + .1, ray=-.35, lay=.45, re=-.35, le=-.55, sx=.45 + (-.57) * sw, sy=-.25 + .4 * sw,
                     llz=.14, rlz=-.14, llx=-.2, lk=.3, rk=.2, hy=.92, nx=.15)
            if .62 < w < .66 and not self._hit:
                self._hit = True
                on_hit and on_hit()
            if w < .5:
                self._hit = False
        elif anim == "build":
            w = t * 8.5
            p.update(hy=.6, llx=-1.4, lk=1.6, rlx=.1, rk=1.95, rf=.5, sx=.5, nx=.3, rax=-1.3 + math.sin(w) * .55,
                     re=-.9 + math.sin(w) * .2, lax=-1.0, le=-.7, lay=.4)
            if math.sin(w) > .95 and not self._hit:
                self._hit = True
                on_hit and on_hit()
            if math.sin(w) < 0:
                self._hit = False
        elif anim == "aim":
            p.update(rax=-1.5, ray=-.3, re=-.25, lax=-1.35, lay=.6, le=-.75, sy=-.25, ny=.2, sx=.05, llz=.1, rlz=-.1, llx=-.15, lk=.2, hy=.92)
        elif anim == "melee":
            w = (t * 1.6) % 1
            sw = _smooth(0, .4, w) if w < .4 else 1 - _smooth(.4, .6, w)
            p.update(rax=-.4 - 2.2 * sw, lax=-.3 - 2.1 * sw, ray=-.3, lay=.4, sx=.3 - .4 * sw, sy=-.3 + .6 * sw, re=-.4, le=-.5,
                     llx=-.35, lk=.35, rlx=.25, hy=.9)
            if .45 < w < .5 and not self._hit:
                self._hit = True
                on_hit and on_hit()
            if w < .3:
                self._hit = False
        elif anim == "eat":
            w = math.sin(t * 3)
            p.update(rax=-.95, ray=.35, re=-2.1 + w * .25, nx=.05 + w * .05, lax=-.4, le=-.8, lay=.3)
        elif anim == "heal":
            p.update(hy=.62, llx=-1.3, lk=1.9, rlx=.15, rk=1.9, sx=.45, nx=.5, rax=-.9 + math.sin(t * 5) * .15, lax=-.7, le=-1.3,
                     re=-.9, ray=-.5, lay=.4)
        elif anim == "drink":
            p.update(hy=.5, llx=-1.5, lk=2.2, rlx=-1.3, rk=2.2, sx=.85, nx=.4, lax=-1.3 + math.sin(t * 3) * .2,
                     rax=-1.3 + math.sin(t * 3) * .2, le=-.4, re=-.4)
        elif anim == "sit":
            p.update(hy=.52, llx=-1.45, rlx=-1.4, lk=1.5, rk=1.45, sx=.28, lax=-.85, rax=-.9, le=-.7, re=-.6,
                     nx=.1 + math.sin(t * .3) * .08, ny=math.sin(t * .2) * .3)
        elif anim == "sleep":
            p.update(hy=.2, hrx=-1.52, lax=.1, rax=.1, laz=.2, raz=-.2, nx=-.1, ny=.5, lk=.3, rk=.1, llx=-.3, sx=math.sin(t * 1.1) * .01)
        elif anim == "dead":
            p.update(hy=.18, hrx=-1.57, hrz=roll, laz=1.3, raz=-.9, lax=-.4, ny=.8, llz=.2, rlz=-.1, lk=.4)
        elif anim == "zwalk":
            gait(.42, .2)
            p.update(lax=-1.25 + math.sin(t * 1.3) * .12, rax=-1.05 + math.cos(t * 1.1) * .12, lay=.15, ray=-.1, le=-.2, re=-.35,
                     nz=.35, nx=.1, rk=p["rk"] * 1.4, hrz=math.sin(self.phase) * .07, sz=math.sin(self.phase * .5) * .06)
        elif anim == "zrun":
            gait(1.0, .45)
            p.update(lax=-1.5 + math.sin(self.phase) * .3, rax=-1.4 - math.sin(self.phase) * .3, le=-.2, re=-.2, nz=.2)
        elif anim == "zattack":
            w = math.sin(t * 9)
            p.update(lax=-1.8 + w * .6, rax=-1.8 - w * .6, le=-.4, re=-.4, sx=.45, nx=-.2, llx=-.3, lk=.3, hy=.9, sy=w * .2)
        else:  # zidle
            p.update(sx=.25 + math.sin(t * .8) * .05, nz=.4 + math.sin(t * .5) * .1, lax=-.2, rax=-.1, laz=.15, raz=-.2,
                     hrz=math.sin(t * .7) * .04, le=-.3)
        return p

    def apply(self, p, dt, rate=12.0):
        k = 1 - math.exp(-dt * rate)
        c = self.c
        for key, base in POSE0.items():
            c[key] += (p.get(key, base) - c[key]) * k
        d = math.degrees
        self.hips.set_pos(0, c["hy"], c["hz"])
        self.hips.set_hpr(0, -d(c["hrx"]), d(c["hrz"]))
        self.spine.set_hpr(d(c["sy"]), -d(c["sx"]), d(c["sz"]))
        self.neck.set_hpr(d(c["ny"]), -d(c["nx"]), d(c["nz"]))
        self.sh["l"].set_hpr(d(c["lay"]), -d(c["lax"]), d(c["laz"]))
        self.sh["r"].set_hpr(d(c["ray"]), -d(c["rax"]), d(c["raz"]))
        self.el["l"].set_p(-d(c["le"]))
        self.el["r"].set_p(-d(c["re"]))
        self.hip["l"].set_hpr(0, -d(c["llx"]), d(c["llz"]))
        self.hip["r"].set_hpr(0, -d(c["rlx"]), d(c["rlz"]))
        self.knee["l"].set_p(-d(c["lk"]))
        self.knee["r"].set_p(-d(c["rk"]))
        self.foot["l"].set_p(-d(c["lf"]))
        self.foot["r"].set_p(-d(c["rf"]))


def heading_deg(sim_heading):
    """Simulation heading (radians, 0 = east) -> Panda3D H in degrees."""
    return math.degrees(math.atan2(-math.cos(sim_heading), math.sin(sim_heading)))


def survivor_look(name):
    h = zlib.crc32(name.encode())
    tops = [0x4f5a3a, 0x5b4a3a, 0x3f4a57, 0x6b3e2e, 0x565650]
    bottoms = [0x2e3b52, 0x3d3a33, 0x4a4d3a]
    skins = [0xc9a184, 0xb0806a, 0x8d5e44, 0xe0bca1]
    hairs = [0x2a1d14, 0x4a3524, 0x7a5a32, 0x121110]
    hats = [None, 0x2f2f2c, 0x5a2a24, 0x3c4a36]
    return {"top": hexcol(tops[h % 5]), "bottom": hexcol(bottoms[h // 5 % 3]), "skin": hexcol(skins[h // 15 % 4]),
            "hair": hexcol(hairs[h // 60 % 4]), "hat": (hexcol(hats[h // 240 % 4]) if hats[h // 240 % 4] else None),
            "eye": hexcol(0x16110e), "boots": hexcol(0x2a241e), "pack": hexcol(0x4a4c38), "roll": hexcol(0x2f4f6a)}


def zombie_look(seed):
    tops = [0x5a4e3e, 0x3c4450, 0x6a6a60, 0x5b3c30, 0x3a4636, 0x7a6e56]
    bottoms = [0x2c3240, 0x3d3a33, 0x4a4436]
    skins = [0x8f9a82, 0x9a9a86, 0x7d8b78, 0xa39d8c]
    return {"top": hexcol(tops[seed % 6]), "bottom": hexcol(bottoms[seed // 6 % 3]), "skin": hexcol(skins[seed // 18 % 4]),
            "hair": hexcol(0x2a1d14), "hat": None, "eye": hexcol(0xd8d0a0), "boots": hexcol(0x221e1a)}

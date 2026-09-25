"""Skinned, motion-captured characters from the optional asset pack (see assets/catalog.py).

`SkinnedBody` has the same interface as the procedural `Body` (root, add_items, show_items, pose, apply), so
the app can use either. Animation is driven by simulation time, not the wall clock, so pausing and time
acceleration work, and clip changes crossfade.
"""
import json
import zlib

from direct.actor.Actor import Actor
from panda3d.core import (BoundingSphere, CullFaceAttrib, Filename, NodePath, Point3, ShaderAttrib,
                          Texture, Vec3, Vec4)

from ..assets.catalog import ASSET_DIR, CHARACTERS, CLIPS, SURVIVOR_BODIES, WALKER_BODIES
from ..config import FEMALE_NAMES
from ..world import hexcol
from .geometry import unit_node
from .shaders import character_shader

KINDS = {"skin": 0.0, "eyes": 1.0, "hair": 2.0, "cloth": 3.0}
FADE = .22                       # seconds of crossfade between clips
HITS = {"chop": (.46,), "melee": (.42,), "build": (.12, .37, .62, .87)}   # impact moments (fraction of the clip)
AXE_HPR = (0, 90, 0)                           # tool handles along the fist, head beyond the thumb
RIFLE_AIM = (0, 0, 0, 0, 180, 0)
RIFLE_BACK = (-.02, -.12, .33, 0, 0, 145)
LOCOMOTION = {"walk", "jog", "run", "sneak", "zwalk", "zrun"}
_SRGB = {Texture.F_srgb: Texture.F_rgb8, Texture.F_srgb_alpha: Texture.F_rgba8}


_UNITS = {}


def _f(p):
    return Filename.from_os_specific(str(p))


def _unit(shape):
    if shape not in _UNITS:
        _UNITS[shape] = NodePath(unit_node(shape, low=True))
    return _UNITS[shape]


class CharacterKit:
    """Loads the converted characters once and hands out bodies."""

    def __init__(self, loader, world_shader):
        self.loader = loader
        self.manifest = json.loads((ASSET_DIR / "characters" / "manifest.json").read_text())
        self.clip_info = self.manifest["clips"]
        self.anims = {c: _f(ASSET_DIR / "anims" / f"{c}.bam") for c, _, _ in CLIPS.values()}
        self.attr = ShaderAttrib.make(character_shader()).set_flag(ShaderAttrib.F_hardware_skinning, True)
        self.world_shader = world_shader
        self.models = {}
        for name in CHARACTERS:
            path = _f(ASSET_DIR / "characters" / f"{name}.bam")
            model = loader.load_model(path)
            # the scans are authored in sRGB; the game lights in display space like the rest of the world
            for tex in model.find_all_textures():
                if tex.get_format() in _SRGB:
                    tex.set_format(_SRGB[tex.get_format()])
                tex.set_anisotropic_degree(4)
            self.models[name] = path

    def survivor(self, parent, name, look):
        female = name.split()[0] in FEMALE_NAMES
        return SkinnedBody(self, parent, SURVIVOR_BODIES["f" if female else "m"], look, zombie=False,
                           seed=zlib.crc32(name.encode()) % 997)

    def walker(self, parent, seed, look):
        return SkinnedBody(self, parent, WALKER_BODIES[seed % len(WALKER_BODIES)], look, zombie=True, seed=seed % 997)


class SkinnedBody:
    def __init__(self, kit: CharacterKit, parent: NodePath, variant, look, zombie, seed):
        self.kit = kit
        self.root = parent.attach_new_node("body")
        # the converted models share the game's axes (y up, left-handed) and face -z; the game faces +z
        fix = self.root.attach_new_node("axes")
        fix.set_h(180)
        self.actor = Actor(kit.models[variant], kit.anims)
        self.actor.reparent_to(fix)
        self.actor.set_attrib(kit.attr)
        self.actor.enable_blend()
        char = self.actor.find("**/+Character")
        char.node().set_bounds(BoundingSphere(Point3(0, 1, 0), 2.2))
        char.node().set_final(True)
        for kind, k in KINDS.items():
            for np_ in self.actor.find_all_matches(f"**/{kind}"):
                np_.set_shader_input("u_kind", k)
        skin = look.get("skin", (.8, .65, .55))
        a = self.actor
        a.set_shader_input("u_zombie", 1.0 if zombie else 0.0)
        a.set_shader_input("u_seed", float(seed) * .37)
        a.set_shader_input("u_mirror", 1.0)
        a.set_shader_input("u_skin_tint", Vec3(*(min(1.4, c / .75) for c in skin)) if not zombie else Vec3(1, 1, 1))
        a.set_shader_input("u_hair_col", Vec3(*look.get("hair", (.2, .15, .1))))
        top = look.get("top", (.4, .4, .35))
        a.set_shader_input("u_cloth", Vec4(*top, .35 if zombie else .25))
        self.zombie = zombie
        self.hand = self.actor.expose_joint(None, "modelRoot", "hand_r")
        self.spine = self.actor.expose_joint(None, "modelRoot", "spine_03")
        self.items = {}
        self.cur = self.prev = None
        self.cur_anim = None
        self.cur_loop = self.prev_loop = True
        self.t_cur = self.t_prev = 0.0
        self.fade = 1.0
        self.used = set()
        if look.get("pack"):
            self._pack(look)

    # --- gear built from the same primitives as the world -----------------------------------------------

    def _part(self, parent, shape, pos, scale, color, hpr=(0, 0, 0)):
        n = parent.attach_new_node(shape)
        _unit(shape).instance_to(n)
        n.set_pos(*pos)
        n.set_scale(*scale)
        n.set_hpr(*hpr)
        n.set_color_scale(*color, 1)
        return n

    def _gear_root(self, joint):
        g = joint.attach_new_node("gear")
        g.set_shader(self.kit.world_shader, 20)
        g.set_attrib(CullFaceAttrib.make(CullFaceAttrib.M_cull_none), 20)
        return g

    def _pack(self, look):
        # spine_03 frame: +y up the spine, +z out of the back, +x to the character's left
        g = self._gear_root(self.spine)
        g.set_pos(0, -.04, .2)
        self._part(g, "cube", (0, 0, 0), (.34, .44, .19), look["pack"])
        self._part(g, "cube", (0, -.1, .11), (.26, .16, .06), look["pack"])
        self._part(g, "cylinder", (0, .3, 0), (.15, .4, .15), look.get("roll", (.2, .3, .4)), (0, 0, 90))

    def add_items(self):
        # hand_r frame: +y along the fingers, -x out of the palm, -z towards the thumb; a fist grips along z
        hand = self._gear_root(self.hand)
        hand.set_pos(-.03, .08, 0)
        axe = hand.attach_new_node("axe")
        axe.set_hpr(*AXE_HPR)
        self._part(axe, "cylinder", (0, -.22, 0), (.04, .74, .04), hexcol(0x7b6a55))
        self._part(axe, "cube", (0, -.54, -.07), (.03, .12, .2), hexcol(0x9a9a96))
        hammer = hand.attach_new_node("hammer")
        hammer.set_hpr(*AXE_HPR)
        self._part(hammer, "cylinder", (0, -.08, 0), (.035, .34, .035), hexcol(0x7b6a55))
        self._part(hammer, "cube", (0, -.24, 0), (.05, .05, .14), hexcol(0x5b5c5a))
        back = self._gear_root(self.spine)
        rifle = back.attach_new_node("rifle")
        self._part(rifle, "cube", (0, -.35, 0), (.04, .9, .05), hexcol(0x3c3d3e))
        self._part(rifle, "cube", (0, .12, 0), (.05, .32, .08), hexcol(0x6a4a30))
        self._part(rifle, "cylinder", (0, -.2, .06), (.045, .26, .045), hexcol(0x2b2b2b))
        self.items = {"axe": axe, "rifle": rifle, "hammer": hammer, "back": back, "hand": hand}
        for k in ("axe", "rifle", "hammer"):
            self.items[k].hide()

    def show_items(self, anim, has_axe, has_rifle):
        if not self.items:
            return
        it = self.items
        it["hammer"].show() if anim == "build" else it["hammer"].hide()
        busy = anim in ("build", "aim", "sleep", "dead", "drink", "eat", "heal", "loot", "gather", "sit")
        it["axe"].show() if has_axe and (anim in ("chop", "melee") or not busy and anim not in ("idle", "crouch")) else it["axe"].hide()
        r = it["rifle"]
        if not has_rifle:
            r.hide()
            return
        r.show()
        if anim == "aim":
            r.reparent_to(it["hand"])
            r.set_pos_hpr(*RIFLE_AIM)
        else:
            r.reparent_to(it["back"])
            r.set_pos_hpr(*RIFLE_BACK)

    # --- animation ---------------------------------------------------------------------------------------

    def pose(self, anim, dt, speed, roll=0.0, on_hit=None):
        return anim, speed, on_hit

    def _clip_frame(self, clip, t, loop):
        info = self.kit.clip_info[clip]
        n = info["frames"]
        f = t * info["fps"]
        return f % n if loop else min(f, n - 1)

    def apply(self, p, dt, rate=12.0):
        anim, speed, on_hit = p
        clip, loop, natural = CLIPS.get(anim, CLIPS["idle"])
        play = 1.0
        if natural:
            play = min(1.45, max(.55, speed / natural))
        if clip != self.cur:
            info = self.kit.clip_info[clip]
            length = info["frames"] / info["fps"]
            if self.cur is not None and anim in LOCOMOTION and self.cur_anim in LOCOMOTION:
                # keep the stride phase when changing gait so the feet don't jump
                old = self.kit.clip_info[self.cur]
                t0 = (self.t_cur % (old["frames"] / old["fps"])) / (old["frames"] / old["fps"]) * length
            else:
                t0 = 0.0
            self.prev, self.t_prev, self.prev_loop = self.cur, self.t_cur, self.cur_loop
            self.cur, self.t_cur, self.cur_loop, self.cur_anim = clip, t0, loop, anim
            self.fade = 0.0 if self.prev else 1.0
            self.used.add(clip)
        elif anim != self.cur_anim:
            self.cur_anim = anim
        info = self.kit.clip_info[clip]
        length = info["frames"] / info["fps"]
        before = (self.t_cur / length) % 1.0
        if anim != "sleep":
            self.t_cur += dt * play
        after = (self.t_cur / length) % 1.0
        if on_hit and anim in HITS and dt > 0:
            for h in HITS[anim]:
                if (before < h <= after) or (after < before and (h > before or h <= after)):
                    on_hit()
        self.t_prev += dt
        self.fade = min(1.0, self.fade + dt / FADE) if dt > 0 else self.fade
        a = self.actor
        for c in self.used:
            if c not in (self.cur, self.prev):
                a.set_control_effect(c, 0.0)
        a.pose(self.cur, self._clip_frame(self.cur, self.t_cur, self.cur_loop))
        if self.prev and self.fade < 1.0:
            a.pose(self.prev, self._clip_frame(self.prev, self.t_prev, self.prev_loop))
            a.set_control_effect(self.prev, 1.0 - self.fade)
            a.set_control_effect(self.cur, self.fade)
        else:
            if self.prev:
                a.set_control_effect(self.prev, 0.0)
                self.prev = None
            a.set_control_effect(self.cur, 1.0)

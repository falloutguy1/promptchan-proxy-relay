# Blender 4.5 (headless): bake seamless PBR material sets for the wasteland game.
# Each material is a procedural Cycles node graph sampled on a 4D torus (so it tiles),
# baked channel by channel (albedo / height / roughness / metal / ao) with EMIT bakes,
# then packed with numpy into the texture layouts the game uses and saved as PNG.
#   blender -b --factory-startup --python bake_materials.py -- OUTDIR [only,these] [res]
import bpy, math, os, sys, time
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'tex')
ONLY = set(a for a in (ARGS[1].split(',') if len(ARGS) > 1 else []) if a)
RES = int(ARGS[2]) if len(ARGS) > 2 else 1024
TAU = math.tau
os.makedirs(OUT, exist_ok=True)


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


def hexs(h):  # sRGB 0..1
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC.render.engine = 'CYCLES'
SC.cycles.device = 'CPU'
SC.cycles.samples = 1
SC.cycles.use_denoising = False
SC.render.bake.margin = 0
SC.render.bake.use_clear = True
bpy.ops.mesh.primitive_plane_add(size=1)
PLANE = bpy.context.active_object


class Graph:
    """Tiny node-graph DSL. Floats are sockets or python numbers; colors are 3-tuples of those."""

    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        PLANE.data.materials.clear()
        PLANE.data.materials.append(self.mat)
        self.nt = self.mat.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        N = self.nt.nodes
        self.out = N.new('ShaderNodeOutputMaterial')
        self.emit = N.new('ShaderNodeEmission')
        self.nt.links.new(self.emit.outputs[0], self.out.inputs[0])
        tc = N.new('ShaderNodeTexCoord')
        sep = N.new('ShaderNodeSeparateXYZ')
        self.nt.links.new(tc.outputs['UV'], sep.inputs[0])
        self.u, self.v = sep.outputs[0], sep.outputs[1]
        self.img = N.new('ShaderNodeTexImage')
        self._seed = 0

    # --- plumbing
    def _set(self, sock, val):
        if isinstance(val, (int, float)):
            sock.default_value = float(val)
        else:
            self.nt.links.new(val, sock)

    def m(self, op, a, b=0.0, c=None, clamp=False):
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and c is None and op in ('ADD', 'SUBTRACT', 'MULTIPLY'):
            return {'ADD': a + b, 'SUBTRACT': a - b, 'MULTIPLY': a * b}[op]
        n = self.nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        self._set(n.inputs[0], a)
        self._set(n.inputs[1], b)
        if c is not None:
            self._set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, *xs):
        r = xs[0]
        for x in xs[1:]:
            r = self.m('ADD', r, x)
        return r

    def sub(self, a, b): return self.m('SUBTRACT', a, b)
    def mul(self, a, b): return self.m('MULTIPLY', a, b)
    def mad(self, a, b, c): return self.m('MULTIPLY_ADD', a, b, c)
    def mx(self, a, b): return self.m('MAXIMUM', a, b)
    def mn(self, a, b): return self.m('MINIMUM', a, b)
    def fract(self, a): return self.m('FRACT', a)
    def floor(self, a): return self.m('FLOOR', a)
    def absv(self, a): return self.m('ABSOLUTE', a)
    def sin(self, a): return self.m('SINE', a)
    def pw(self, a, b): return self.m('POWER', a, b)
    def sqrt(self, a): return self.m('SQRT', a)
    def clamp01(self, a): return self.m('ADD', a, 0.0, clamp=True) if not isinstance(a, (int, float)) else min(1, max(0, a))
    def step(self, edge, x): return self.m('GREATER_THAN', x, edge)  # 1 where x > edge
    def lerp(self, a, b, t): return self.mad(self.sub(b, a), t, a)

    def smooth(self, e0, e1, x):
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.data_type = 'FLOAT'
        n.interpolation_type = 'SMOOTHSTEP'
        n.clamp = True
        self._set(n.inputs[0], x)
        self._set(n.inputs[1], e0)
        self._set(n.inputs[2], e1)
        n.inputs[3].default_value = 0.0
        n.inputs[4].default_value = 1.0
        return n.outputs[0]

    def lin(self, c):  # colors composed in sRGB terms -> scene linear
        return tuple(self.pw(self.mx(x, 0.0), 2.2) for x in c)

    # colors (3-tuples)
    def clerp(self, a, b, t): return tuple(self.lerp(a[i], b[i], t) for i in range(3))
    def cmul(self, a, k): return tuple(self.mul(a[i], k if not isinstance(k, tuple) else k[i]) for i in range(3))

    # --- seamless coordinates: (u,v) on a flat 4D torus; fu/fv = features per tile
    def torus(self, fu, fv, u=None, v=None):
        u = self.u if u is None else u
        v = self.v if v is None else v
        self._seed += 1
        s = self._seed * 7.31
        ru, rv = fu / TAU, fv / TAU
        au, av = self.mul(u, TAU), self.mul(v, TAU)
        cmb = self.nt.nodes.new('ShaderNodeCombineXYZ')
        self._set(cmb.inputs[0], self.mad(self.m('COSINE', au), ru, s))
        self._set(cmb.inputs[1], self.mad(self.sin(au), ru, s * 0.61))
        self._set(cmb.inputs[2], self.mad(self.m('COSINE', av), rv, s * 1.37))
        w = self.mad(self.sin(av), rv, s * 0.29)
        return cmb.outputs[0], w

    def noise(self, fu, fv=None, detail=4.0, rough=0.5, lac=2.0, distort=0.0, kind='FBM', u=None, v=None, color=False):
        vec, w = self.torus(fu, fu if fv is None else fv, u, v)
        n = self.nt.nodes.new('ShaderNodeTexNoise')
        n.noise_dimensions = '4D'
        n.noise_type = kind
        n.normalize = True
        self.nt.links.new(vec, n.inputs['Vector'])
        self._set(n.inputs['W'], w)
        n.inputs['Scale'].default_value = 1.0
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Lacunarity'].default_value = lac
        n.inputs['Distortion'].default_value = distort
        if color:
            sp = self.nt.nodes.new('ShaderNodeSeparateColor')
            self.nt.links.new(n.outputs['Color'], sp.inputs[0])
            return sp.outputs[0], sp.outputs[1], sp.outputs[2]
        return n.outputs['Fac']

    def ridged(self, fu, fv=None, detail=5.0, rough=0.5, u=None, v=None):
        return self.sub(1.0, self.absv(self.mad(self.noise(fu, fv, detail, rough, u=u, v=v), 2.0, -1.0)))

    def voronoi(self, fu, fv=None, feature='F1', rand=1.0, u=None, v=None, smoothness=0.2):
        """returns (distance, cell_random_0_1)"""
        vec, w = self.torus(fu, fu if fv is None else fv, u, v)
        n = self.nt.nodes.new('ShaderNodeTexVoronoi')
        n.voronoi_dimensions = '4D'
        n.feature = feature
        self.nt.links.new(vec, n.inputs['Vector'])
        self._set(n.inputs['W'], w)
        n.inputs['Scale'].default_value = 1.0
        n.inputs['Randomness'].default_value = rand
        if feature == 'SMOOTH_F1':
            n.inputs['Smoothness'].default_value = smoothness
        sp = self.nt.nodes.new('ShaderNodeSeparateColor')
        if 'Color' in n.outputs and n.outputs['Color'].enabled:
            self.nt.links.new(n.outputs['Color'], sp.inputs[0])
            return n.outputs['Distance'], sp.outputs[0]
        return n.outputs['Distance'], 0.5

    def cells(self, fu, fv=None, u=None, v=None, rand=1.0):
        """one Voronoi layout, two readings: (distance_to_edge, f1_distance, cell_random)"""
        vec, w = self.torus(fu, fu if fv is None else fv, u, v)
        outs = []
        for feat in ('DISTANCE_TO_EDGE', 'F1'):
            n = self.nt.nodes.new('ShaderNodeTexVoronoi')
            n.voronoi_dimensions = '4D'
            n.feature = feat
            self.nt.links.new(vec, n.inputs['Vector'])
            self._set(n.inputs['W'], w)
            n.inputs['Scale'].default_value = 1.0
            n.inputs['Randomness'].default_value = rand
            outs.append(n)
        sp = self.nt.nodes.new('ShaderNodeSeparateColor')
        self.nt.links.new(outs[1].outputs['Color'], sp.inputs[0])
        return outs[0].outputs['Distance'], outs[1].outputs['Distance'], sp.outputs[0]

    def white(self, a, b, c=0.0):
        n = self.nt.nodes.new('ShaderNodeTexWhiteNoise')
        n.noise_dimensions = '3D'
        cmb = self.nt.nodes.new('ShaderNodeCombineXYZ')
        self._set(cmb.inputs[0], a)
        self._set(cmb.inputs[1], b)
        self._set(cmb.inputs[2], c)
        self.nt.links.new(cmb.outputs[0], n.inputs['Vector'])
        return n.outputs['Value']

    def warp(self, amount, freq=8.0):
        """periodic domain warp of (u,v)"""
        du = self.mul(self.sub(self.noise(freq, detail=3), 0.5), amount)
        dv = self.mul(self.sub(self.noise(freq, detail=3), 0.5), amount)
        return self.add(self.u, du), self.add(self.v, dv)

    # --- baking
    def bake(self, value, name, float_buf=True, srgb=False):
        cmb = self.nt.nodes.new('ShaderNodeCombineColor')
        vals = value if isinstance(value, tuple) else (value, value, value)
        for i in range(3):
            self._set(cmb.inputs[i], vals[i])
        self.nt.links.new(cmb.outputs[0], self.emit.inputs['Color'])
        img = bpy.data.images.new(name, RES, RES, alpha=False, float_buffer=float_buf)
        img.colorspace_settings.name = 'sRGB' if srgb else ('Linear Rec.709' if float_buf else 'Non-Color')
        self.img.image = img
        self.nt.nodes.active = self.img
        self.img.select = True
        bpy.ops.object.bake(type='EMIT')
        a = np.empty(RES * RES * 4, np.float32)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        return a.reshape(RES, RES, 4)


# ---------------------------------------------------------------- numpy post-processing
def blur_wrap(h, r, passes=3):
    for _ in range(passes):
        c = np.cumsum(np.concatenate([h[:, -r - 1:], h, h[:, :r]], axis=1), axis=1)
        h = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
        c = np.cumsum(np.concatenate([h[-r - 1:, :], h, h[:r, :]], axis=0), axis=0)
        h = (c[2 * r + 1:, :] - c[:-2 * r - 1, :]) / (2 * r + 1)
    return h


def normal_from_height(h, strength):
    n = h.shape[0]
    k = strength * n / 512.0
    dx = (np.roll(h, 1, axis=1) - np.roll(h, -1, axis=1)) * k
    dy = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) * k
    l = np.sqrt(dx * dx + dy * dy + 1.0)
    return np.stack([dx / l * 0.5 + 0.5, dy / l * 0.5 + 0.5, 1.0 / l * 0.5 + 0.5], axis=-1)


def cavity(h, radius, amount):
    b = blur_wrap(h, radius)
    return np.clip(1.0 - np.maximum(0.0, b - h) * amount, 0.25, 1.0)


def half(a):
    s = a.shape
    return a.reshape(s[0] // 2, 2, s[1] // 2, 2, s[2]).mean(axis=(1, 3))


def save_png(rgba, path, srgb=False):
    hgt, wid = rgba.shape[:2]
    im = bpy.data.images.new('save_tmp', wid, hgt, alpha=True)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    im.pixels.foreach_set(np.clip(rgba, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def renorm(nrm):
    v = nrm[..., :3] * 2 - 1
    v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)
    out = nrm.copy()
    out[..., :3] = v * 0.5 + 0.5
    return out


def write_set(name, albedo, height, rough, metal, ao, nstrength, terrain=False, extra_albedo=None, sizes=(1024, 512)):
    """albedo HxWx3 sRGB-encoded; others HxW linear. Writes <name>_c/_n(/_orm)_<size>.png"""
    hn = height - height.min()
    rng = max(1e-6, float(hn.max()))
    nrm = normal_from_height(height, nstrength)
    one = np.ones_like(height)
    if terrain:  # albedo.a = roughness, normal.a = height (for height-blended splatting)
        col = np.dstack([albedo, rough])
        nor = np.dstack([nrm, 0.3 + 0.7 * hn / rng])
        maps = {'c': col, 'n': nor}
    else:
        maps = {'c': np.dstack([albedo, one]), 'n': np.dstack([nrm, one]), 'orm': np.dstack([ao, rough, metal, one])}
    for k, alb in (extra_albedo or {}).items():
        maps['c_' + k] = np.dstack([alb, one])
    for size in sizes:
        for key, arr in maps.items():
            a = arr
            while a.shape[0] > size:
                a = half(a)
                if key == 'n':
                    a = renorm(a)
            save_png(a, os.path.join(OUT, f'{name}_{key}_{size}.png'), srgb=key.startswith('c'))
    print(f'WROTE {name} sizes={sizes} keys={list(maps)}', flush=True)


def ch(a, i=0):
    return a[..., i]


# ---------------------------------------------------------------- materials
RECIPES = {}


def recipe(fn):
    RECIPES[fn.__name__] = fn
    return fn


@recipe
def dirt():
    g = Graph('dirt')
    wu, wv = g.warp(0.025, 6)
    n = g.noise(4, detail=7, rough=0.55, u=wu, v=wv)
    m = g.noise(12, detail=5, rough=0.55)
    clod = g.noise(28, detail=4, rough=0.6, u=wu, v=wv)
    fine = g.noise(90, detail=3, rough=0.7)
    grain = g.noise(300, detail=2, rough=0.5)
    # clods separated by thin dry fissures
    ce, _, cr = g.cells(22, u=wu, v=wv)
    fiss = g.mul(g.mul(g.smooth(0.03, 0.006, ce), g.smooth(0.62, 0.75, m)), 0.7)
    # stones: big (rare), medium, grit
    def stones(freq, keep, mmin, mmax):
        e, _, r = g.cells(freq, u=g.add(g.u, g.mul(g.sub(g.noise(freq * 2, detail=3), 0.5), 0.35 / freq)))
        k = g.step(1.0 - keep, r)
        margin = g.mad(g.fract(g.mul(r, 7.13)), mmax - mmin, mmin)   # how far the stone sits in from its cell edge
        body = g.mul(k, g.smooth(margin, g.add(margin, 0.07), e))
        rim = g.mul(k, g.mul(g.smooth(g.mul(margin, 0.55), margin, e), g.sub(1.0, body)))
        return body, rim, r
    big, big_rim, bigr = stones(9, 0.22, 0.1, 0.2)
    med, med_rim, medr = stones(26, 0.3, 0.08, 0.16)
    grit, _, _ = stones(90, 0.35, 0.06, 0.12)
    dA, dB, dC, dK = hexc(0x4f4236), hexc(0x77644f), hexc(0x8e7b62), hexc(0x33291f)
    base = g.clerp(dA, dB, g.smooth(0.25, 0.75, n))
    base = g.clerp(base, dC, g.mul(g.smooth(0.5, 0.8, clod), 0.55))
    k = g.add(0.8, g.mul(m, 0.26), g.mul(g.sub(fine, 0.5), 0.24), g.mul(g.sub(grain, 0.5), 0.16))
    col = g.cmul(base, k)
    col = g.clerp(col, dK, g.mul(fiss, 0.75))
    col = g.cmul(col, g.sub(1.0, g.mul(g.mx(big_rim, med_rim), 0.35)))
    def stone_col(r, amount):
        t = g.fract(g.mul(r, 3.7))
        c = g.clerp(hexc(0x7d725f), hexc(0xb9ad95), g.smooth(0.2, 0.9, t))
        c = g.clerp(c, hexc(0x6a6a66), g.step(0.8, g.fract(g.mul(r, 5.3))))
        return g.cmul(c, g.add(0.7, g.mul(fine, 0.5))), amount
    sc, _ = stone_col(bigr, 1)
    col = g.clerp(col, sc, g.mul(big, 0.97))
    mc, _ = stone_col(medr, 1)
    col = g.clerp(col, mc, g.mul(med, 0.95))
    col = g.clerp(col, hexc(0xa89a82), g.mul(grit, 0.7))
    h = g.add(g.mul(n, 0.45), g.mul(clod, 0.25), g.mul(g.sqrt(big), 0.9), g.mul(g.sqrt(med), 0.55), g.mul(grit, 0.12),
              g.mul(fine, 0.12), g.mul(grain, 0.05), g.mul(fiss, -0.35))
    r = g.sub(0.96, g.add(g.mul(big, 0.25), g.mul(med, 0.2)))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    R = ch(g.bake(r, 'r'))
    ao = cavity(H, 6, 3.0) * cavity(H, 2, 2.0)
    alb = A[..., :3] * (0.62 + 0.38 * ao[..., None])
    write_set('dirt', alb, H, R, None, None, 4.0, terrain=True)


@recipe
def cracked():
    g = Graph('cracked')
    wu, wv = g.warp(0.045, 7)
    e, _, pid1 = g.cells(13, u=wu, v=wv)
    e2, _ = g.voronoi(36, feature='DISTANCE_TO_EDGE', u=g.add(wu, 0.013), v=g.sub(wv, 0.021))
    n = g.noise(8, detail=6, rough=0.55)
    dd = g.noise(34, detail=4, rough=0.55)
    grain = g.noise(220, detail=2)
    w1 = g.mad(dd, 0.03, 0.03)
    crack = g.mul(g.smooth(w1, g.mul(w1, 0.2), e), g.mad(dd, 0.4, 0.75))
    fine = g.mul(g.mul(g.smooth(0.035, 0.006, e2), g.smooth(0.35, 0.65, n)), 0.55)
    cA, cB, cK, cS = hexc(0xa08b6b), hexc(0x85715a), hexc(0x3f342a), hexc(0xb7a283)
    col = g.clerp(cB, cA, g.clamp01(g.add(g.mul(pid1, 0.35), g.mul(n, 0.7))))
    col = g.cmul(col, g.add(0.9, g.mul(g.sub(dd, 0.5), 0.26), g.mul(g.sub(grain, 0.5), 0.1)))
    curl = g.smooth(0.0, 0.22, e)
    col = g.clerp(col, cS, g.mul(g.sub(1.0, curl), 0.25))  # sun-bleached plate edges
    c = g.mx(crack, fine)
    col = g.clerp(col, cK, c)
    h = g.add(g.mul(curl, 0.25), g.mul(n, 0.28), g.mul(dd, 0.1), g.mul(crack, -0.75), g.mul(fine, -0.3), g.mul(grain, 0.03))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    ao = cavity(H, 5, 4.0)
    alb = A[..., :3] * (0.72 + 0.28 * ao[..., None])
    write_set('cracked', alb, H, np.full_like(H, 0.96), None, None, 4.5, terrain=True)


@recipe
def grass():
    g = Graph('grass')
    n = g.noise(8, detail=5, rough=0.55)
    soil = g.noise(40, detail=4)
    clump = g.noise(12, detail=4)
    tone = g.noise(60, detail=2)
    blades = None
    # crisp blade strokes in several directions (integer shears keep it seamless)
    for shear, fu, fv, thr, w in [(0, 210, 16, 0.57, 1.0), (1, 190, 14, 0.59, 0.9), (-1, 190, 14, 0.59, 0.9),
                                  (2, 160, 11, 0.61, 0.8), (-2, 160, 11, 0.61, 0.8), (3, 150, 9, 0.63, 0.65), (-3, 150, 9, 0.63, 0.65)]:
        u2 = g.add(g.u, g.mul(g.v, float(shear))) if shear else g.u
        sk = g.mul(g.smooth(thr, thr + 0.04, g.noise(fu, fv, detail=2, rough=0.5, u=u2)), w)
        blades = sk if blades is None else g.mx(blades, sk)
    blades = g.mul(blades, g.smooth(0.18, 0.45, clump))
    soilD, soilM, straw, tip, olive = hexc(0x4a3d2b), hexc(0x6e5b40), hexc(0xb09a5e), hexc(0xd2bd80), hexc(0x857d48)
    base = g.clerp(soilD, soilM, g.smooth(0.3, 0.7, soil))
    bc = g.clerp(olive, straw, g.smooth(0.3, 0.6, tone))
    bc = g.clerp(bc, tip, g.mul(g.smooth(0.65, 0.85, tone), 0.6))
    col = g.clerp(base, bc, g.mul(blades, 0.92))
    col = g.cmul(col, g.add(0.86, g.mul(n, 0.22)))
    h = g.add(g.mul(n, 0.3), g.mul(blades, 0.7), g.mul(soil, 0.08))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    ao = cavity(H, 3, 3.0)
    alb = A[..., :3] * (0.6 + 0.4 * ao[..., None])
    write_set('grass', alb, H, np.full_like(H, 0.9), None, None, 4.0, terrain=True)


@recipe
def rock():
    g = Graph('rock')
    wu, wv = g.warp(0.08, 3)
    n = g.noise(3, detail=8, rough=0.6, u=wu, v=wv)
    r = g.ridged(6, detail=7, rough=0.55, u=wu, v=wv)
    dd = g.noise(30, detail=4)
    grain = g.noise(220, detail=3)
    strata = g.mad(g.sin(g.mul(g.add(g.v, g.mul(n, 0.25)), TAU * 6)), 0.5, 0.5)
    e, _, cid = g.cells(5, u=wu, v=wv)
    crack = g.mul(g.smooth(0.022, 0.004, e), g.smooth(0.5, 0.65, g.noise(4, detail=4)))
    pits = g.smooth(0.72, 0.78, g.noise(70, detail=2))
    rA, rB, rC, rK, rL = hexc(0x625c55), hexc(0x9a9084), hexc(0x7d6b5a), hexc(0x2f2b27), hexc(0x7b8354)
    col = g.clerp(rA, rB, g.clamp01(g.add(g.mul(n, 0.9), g.mul(r, 0.25))))
    col = g.clerp(col, rC, g.mul(g.smooth(0.55, 0.8, strata), 0.35))
    col = g.cmul(col, g.add(0.9, g.mul(g.sub(cid, 0.5), 0.14)))
    lich = g.mul(g.smooth(0.63, 0.7, g.noise(9, detail=5)), g.smooth(0.35, 0.7, n))
    col = g.clerp(col, rL, g.mul(lich, 0.6))
    col = g.clerp(col, rK, g.mx(crack, g.mul(pits, 0.5)))
    col = g.cmul(col, g.add(0.86, g.mul(dd, 0.2), g.mul(g.sub(grain, 0.5), 0.14)))
    h = g.add(g.mul(n, 0.6), g.mul(g.mul(r, r), 0.6), g.mul(strata, 0.18), g.mul(crack, -0.6), g.mul(pits, -0.12), g.mul(dd, 0.1), g.mul(grain, 0.05))
    rgh = g.add(0.78, g.mul(n, 0.1), g.mul(lich, 0.1))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    R = ch(g.bake(rgh, 'r'))
    ao = cavity(H, 6, 2.5)
    alb = A[..., :3] * (0.66 + 0.34 * ao[..., None])
    write_set('rock', alb, H, R, None, None, 9.0, terrain=True)


@recipe
def concrete():
    g = Graph('concrete')
    n = g.noise(4, detail=7, rough=0.55)
    gr = g.noise(32, detail=4)
    agg = g.noise(320, detail=2)
    drip = g.noise(40, 3, detail=4, rough=0.6)      # vertical run-off streaks
    stain = g.noise(6, detail=5)
    fv = g.fract(g.mul(g.v, 3.0))
    form = g.mul(g.smooth(0.012, 0.0, g.mn(fv, g.sub(1.0, fv))), 0.5)   # formwork joints
    pore = g.mul(g.smooth(0.74, 0.8, g.noise(70, detail=2, rough=0.4)), g.smooth(0.45, 0.6, g.noise(9, detail=3)))
    wu, _ = g.warp(0.06, 5)
    ce, _, _ = g.cells(4, u=wu)
    crack = g.mul(g.smooth(0.01, 0.0015, ce), g.smooth(0.55, 0.68, g.noise(5, detail=4)))
    base = g.sub(g.add(0.47, g.mul(n, 0.12), g.mul(g.sub(gr, 0.5), 0.07)),
                 g.add(g.mul(g.smooth(0.52, 0.85, drip), 0.13), g.mul(g.smooth(0.6, 0.85, stain), 0.09)))
    col = (base, g.mul(base, 0.97), g.mul(base, 0.92))
    col = g.cmul(col, g.add(0.9, g.mul(agg, 0.2)))
    moss = g.mul(g.smooth(0.68, 0.8, g.noise(5, detail=5)), g.smooth(0.5, 1.0, g.sub(1.0, g.v)))
    col = g.clerp(col, hexs(0x5d6343), g.mul(moss, 0.45))
    col = g.cmul(col, g.sub(1.0, g.add(g.mul(g.mx(pore, crack), 0.6), g.mul(form, 0.25))))
    col = g.lin(col)
    h = g.add(g.mul(n, 0.3), g.mul(gr, 0.2), g.mul(agg, 0.06), g.mul(pore, -0.9), g.mul(crack, -0.6), g.mul(form, -0.4))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    ao = cavity(H, 5, 2.5)
    write_set('concrete', A[..., :3], H, np.full_like(H, 0.9), np.zeros_like(H), ao, 3.0)


@recipe
def brick():
    g = Graph('brick')
    rows, cols = 16.0, 8.0
    rv = g.mul(g.v, rows)
    row = g.floor(rv)
    off = g.mul(g.m('MODULO', row, 2.0), 0.5)
    bu = g.add(g.mul(g.u, cols), off)
    col_i = g.floor(bu)
    fu, fv = g.sub(bu, col_i), g.sub(rv, row)
    wob = g.mul(g.sub(g.noise(60, detail=3), 0.5), 0.06)
    mort = g.mn(g.mn(g.smooth(0.0, 0.07, g.add(fu, wob)), g.smooth(1.0, 0.93, g.add(fu, wob))), g.mn(g.smooth(0.0, 0.12, g.add(fv, wob)), g.smooth(1.0, 0.88, g.add(fv, wob))))
    bid = g.white(g.m('MODULO', col_i, cols), g.m('MODULO', row, rows), 3.0)
    bid2 = g.white(g.m('MODULO', col_i, cols), g.m('MODULO', row, rows), 7.0)
    missing = g.step(0.965, bid)
    n = g.noise(10, detail=5)
    fine = g.noise(120, detail=3)
    soot = g.mul(g.smooth(0.5, 0.9, g.noise(4, detail=4)), 0.45)
    chip = g.mul(g.smooth(0.6, 0.75, g.noise(30, detail=4)), g.sub(1.0, g.smooth(0.0, 0.25, g.mn(g.mn(fu, g.sub(1.0, fu)), g.mul(g.mn(fv, g.sub(1.0, fv)), 2.0)))))
    br = (g.mad(bid, 0.16, 0.44), g.mad(bid, 0.07, 0.2), g.mad(bid2, 0.05, 0.15))
    mo = hexs(0x8a8478)
    t = g.mul(g.sub(1.0, missing), g.mul(mort, g.sub(1.0, g.mul(chip, 0.7))))
    col = g.clerp(mo, br, t)
    col = g.cmul(col, g.add(0.84, g.mul(n, 0.22), g.mul(g.sub(fine, 0.5), 0.16)))
    col = g.cmul(col, g.sub(1.0, g.add(soot, g.mul(missing, 0.45))))
    col = g.lin(col)
    h = g.add(g.mul(g.sub(1.0, missing), g.mul(t, 0.6)), g.mul(missing, -0.5), g.mul(n, 0.12), g.mul(fine, 0.06))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    ao = np.clip(cavity(H, 4, 3.0), 0.35, 1)
    write_set('brick', A[..., :3], H, np.full_like(H, 0.9), np.zeros_like(H), ao, 5.0)


def paint_masks(g, amount):
    n = g.noise(4, detail=7, rough=0.55)
    s = g.noise(16, detail=5)
    st = g.noise(60, 5, detail=4, rough=0.6)  # vertical rust runs
    fn = g.noise(90, detail=3)
    wu, wv = g.warp(0.03, 10)
    rust = g.mul(g.smooth(amount, amount + 0.16, g.add(g.mul(n, 0.7), g.mul(s, 0.3), g.mul(st, 0.3), -0.12, g.mul(g.sub(fn, 0.5), 0.16))), 0.95)
    chips = g.mul(g.smooth(0.64, 0.68, g.noise(24, detail=6, rough=0.65, u=wu, v=wv)), g.smooth(0.45, 0.6, s))
    rust = g.mx(rust, g.mul(chips, 0.9))
    return n, s, st, fn, rust


def bake_paint(g, paints, amount, name):
    n, s, st, fn, rust = paint_masks(g, amount)
    pit = g.smooth(0.7, 0.76, g.noise(120, detail=2))
    rDark, rMid, rOrange, rOchre = hexc(0x3f2415), hexc(0x6b3a1f), hexc(0x94502a), hexc(0xa97236)
    rc = g.clerp(rMid, rOrange, g.smooth(0.4, 0.65, s))
    rc = g.clerp(rc, rDark, g.smooth(0.55, 0.75, n))
    rc = g.clerp(rc, rOchre, g.mul(g.smooth(0.62, 0.8, fn), 0.55))
    rc = g.cmul(rc, g.sub(1.0, g.mul(pit, 0.5)))
    fade = g.smooth(0.55, 0.8, g.noise(3, detail=4))                     # sun-bleached patches
    grime = g.mul(g.smooth(0.55, 0.85, st), 0.3)
    pv = g.sub(g.add(0.82, g.mul(s, 0.12), g.mul(g.sub(fn, 0.5), 0.08)), grime)
    albs = {}
    for key, paint in paints.items():
        pc = g.clerp(paint, (0.8, 0.78, 0.74), g.mul(fade, 0.25))
        col = g.clerp(g.cmul(pc, pv), rc, rust)
        albs[key] = g.bake(col, 'a_' + key, float_buf=False, srgb=True)[..., :3]
    h = g.add(g.mul(rust, -0.25), g.mul(g.mul(rust, s), 0.45), g.mul(g.sub(1.0, rust), 0.1), g.mul(fn, 0.03), g.mul(pit, g.mul(rust, -0.2)))
    H = ch(g.bake(h, 'h'))
    R = ch(g.bake(g.add(g.lerp(0.38, 0.93, rust), g.mul(fade, 0.12)), 'r'))
    M = ch(g.bake(g.lerp(0.35, 0.05, rust), 'm'))
    ao = cavity(H, 4, 2.0)
    first = list(albs)[0]
    extra = {k: v for k, v in albs.items() if k != first}
    write_set(name, albs[first], H, R, M, ao, 3.0, extra_albedo=extra)


@recipe
def paint():
    g = Graph('paint')
    bake_paint(g, {'red': hexc(0x8f2e24), 'teal': hexc(0x3f8a80), 'cream': hexc(0xc9bd9a), 'yellow': hexc(0xc8962a)}, 0.44, 'paint')


@recipe
def rust():
    g = Graph('rust')
    bake_paint(g, {'base': hexc(0x5e4434)}, 0.12, 'rust')


@recipe
def corrugated():
    g = Graph('corrugated')
    wave = g.sin(g.mul(g.u, TAU * 12))
    n = g.noise(4, detail=6)
    st = g.noise(30, 4, detail=4, rough=0.6)
    _, _, spr = g.cells(40)
    dent = g.noise(3, detail=3)
    rust = g.mul(g.smooth(0.5, 0.68, g.add(g.mul(n, 0.7), g.mul(st, 0.4))), 0.9)
    gz = g.pw(g.add(0.5, g.mul(wave, 0.05), g.mul(g.sub(spr, 0.5), 0.07)), 2.2)
    rc = g.clerp(hexc(0x4e2c18), hexc(0x7a4424), g.smooth(0.4, 0.7, n))
    col = g.clerp((gz, g.mul(gz, 0.98), g.mul(gz, 0.95)), rc, rust)
    col = g.cmul(col, g.sub(1.0, g.mul(g.smooth(0.55, 0.85, st), 0.25)))
    h = g.add(g.mul(wave, 0.5), g.mul(rust, 0.08), g.mul(dent, 0.3))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    R = ch(g.bake(g.lerp(0.45, 0.9, rust), 'r'))
    M = ch(g.bake(g.lerp(0.65, 0.1, rust), 'm'))
    ao = np.clip(0.8 + 0.2 * (H - H.min()) / max(1e-6, np.ptp(H)), 0, 1) * cavity(H, 3, 1.0)
    write_set('corrugated', A[..., :3], H, R, M, ao, 5.0)


@recipe
def wood():
    g = Graph('wood')
    planks = 6.0
    pv = g.mul(g.v, planks)
    pid = g.floor(pv)
    fv = g.sub(pv, pid)
    seam = g.mn(g.smooth(0.0, 0.05, fv), g.smooth(1.0, 0.95, fv))
    hue = g.white(g.m('MODULO', pid, planks), 1.0, 2.0)
    grain = g.smooth(0.3, 0.75, g.noise(1.5, 80, detail=5, rough=0.6, distort=0.4))
    rings = g.mad(g.sin(g.mul(g.add(g.mul(g.v, 60.0), g.mul(g.noise(2, 10, detail=4), 3.0)), TAU)), 0.5, 0.5)
    fine = g.noise(8, 160, detail=3)
    knot = g.smooth(0.8, 0.86, g.noise(3, 18, detail=2, rough=0.4))
    n = g.noise(16, detail=4)
    base = (g.mad(hue, 0.1, 0.46), g.mad(hue, 0.06, 0.37), g.mad(hue, 0.04, 0.27))
    gray = g.add(0.42, g.mul(n, 0.18))
    col = g.clerp(base, (gray, g.mul(gray, 0.96), g.mul(gray, 0.9)), 0.5)
    col = g.cmul(col, g.add(0.76, g.mul(grain, 0.18), g.mul(rings, 0.08), g.mul(g.sub(fine, 0.5), 0.12)))
    col = g.cmul(col, g.sub(1.0, g.mul(knot, 0.45)))
    nail = g.mul(g.step(g.absv(g.sub(g.fract(g.mul(g.u, 4.0)), 0.5)), 0.012), g.step(g.absv(g.sub(fv, 0.5)), 0.05))
    col = g.clerp(col, (0.14, 0.12, 0.11), nail)
    col = g.cmul(col, g.mad(seam, 0.62, 0.38))
    col = g.lin(col)
    h = g.add(g.mul(seam, 0.5), g.mul(grain, 0.1), g.mul(rings, 0.04), g.mul(fine, 0.06), g.mul(knot, -0.1))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    ao = np.clip(cavity(H, 4, 3.0), 0.4, 1)
    write_set('wood', A[..., :3], H, np.full_like(H, 0.86), np.zeros_like(H), ao, 4.0)


@recipe
def bark():
    g = Graph('bark')
    wu, wv = g.warp(0.04, 4)
    e, _, pid = g.cells(9, 2.6, u=wu, v=wv)
    n = g.noise(12, 4, detail=6)
    fine = g.noise(80, 30, detail=3)
    fis = g.smooth(0.1, 0.0, e)
    c = g.sub(g.add(0.33, g.mul(n, 0.12), g.mul(g.sub(pid, 0.5), 0.06)), g.mul(fis, 0.2))
    col = g.lin((g.mul(c, 1.04), g.mul(c, 0.86), g.mul(c, 0.7)))
    col = g.cmul(col, g.add(0.88, g.mul(fine, 0.24)))
    moss = g.mul(g.smooth(0.6, 0.72, g.noise(6, detail=4)), 0.5)
    col = g.clerp(col, hexc(0x4a5a2a), g.mul(moss, g.sub(1.0, fis)))
    h = g.add(g.mul(n, 0.3), g.mul(fis, -1.0), g.mul(fine, 0.08), g.mul(g.smooth(0.0, 0.2, e), 0.2))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    ao = np.clip(cavity(H, 4, 3.5), 0.35, 1)
    write_set('bark', A[..., :3], H, np.full_like(H, 0.95), np.zeros_like(H), ao, 6.0, sizes=(512, 256))


@recipe
def cloth():
    g = Graph('cloth')
    w = g.mad(g.mul(g.sin(g.mul(g.u, TAU * 64)), g.sin(g.mul(g.v, TAU * 64))), 0.5, 0.5)
    n = g.noise(8, detail=4)
    stain = g.smooth(0.6, 0.75, g.noise(4, detail=5))
    fz = g.noise(128, detail=2)
    c = g.sub(g.add(0.6, g.mul(n, 0.16), g.mul(fz, 0.05)), g.add(g.mul(w, 0.06), g.mul(stain, 0.12)))
    col = g.lin((c, g.mul(c, 0.93), g.mul(c, 0.8)))
    h = g.add(g.mul(w, 0.3), g.mul(n, 0.2), g.mul(fz, 0.05))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    write_set('cloth', A[..., :3], H, np.full_like(H, 0.97), np.zeros_like(H), cavity(H, 2, 2.0), 2.0, sizes=(512, 256))


@recipe
def road():
    g = Graph('road')
    n = g.noise(8, detail=6)
    agg = g.noise(420, detail=2)
    wu, _ = g.warp(0.05, 6)
    ce, _, _ = g.cells(4, u=wu)
    crack = g.mul(g.smooth(0.022, 0.004, ce), g.smooth(0.45, 0.6, g.noise(2, detail=4)))
    worn = g.noise(12, 2, detail=4)
    patch = g.smooth(0.68, 0.71, g.noise(3, detail=3))
    track = g.mul(g.add(g.smooth(0.08, 0.0, g.absv(g.sub(g.u, 0.3))), g.smooth(0.08, 0.0, g.absv(g.sub(g.u, 0.7)))), 0.5)
    c = g.add(0.22, g.mul(n, 0.07), g.mul(g.sub(agg, 0.5), 0.12), g.mul(track, -0.03))
    col = (c, c, g.mul(c, 1.03))
    col = g.clerp(col, (0.12, 0.12, 0.125), g.mul(patch, 0.7))
    centre = g.mul(g.mul(g.step(g.absv(g.sub(g.u, 0.5)), 0.013), g.step(g.fract(g.mul(g.v, 6.0)), 0.55)), g.smooth(0.34, 0.45, worn))
    edge = g.mul(g.mx(g.step(g.absv(g.sub(g.u, 0.06)), 0.009), g.step(g.absv(g.sub(g.u, 0.94)), 0.009)), g.smooth(0.42, 0.5, worn))
    col = g.clerp(col, (0.66, 0.52, 0.16), g.mul(centre, g.add(0.75, g.mul(agg, 0.3))))
    col = g.clerp(col, (0.62, 0.62, 0.6), g.mul(edge, g.add(0.75, g.mul(agg, 0.3))))
    sand = g.clamp01(g.add(g.mul(g.smooth(0.3, 0.02, g.mn(g.u, g.sub(1.0, g.u))), 0.75), g.mul(g.smooth(0.62, 0.8, n), 0.35)))
    col = g.clerp(col, (0.5, 0.43, 0.33), sand)
    col = g.cmul(col, g.sub(1.0, g.mul(crack, 0.7)))
    col = g.lin(col)
    h = g.add(g.mul(agg, 0.2), g.mul(crack, -0.8), g.mul(n, 0.2), g.mul(g.add(centre, edge), 0.05))
    A = g.bake(col, 'a', float_buf=False, srgb=True)
    H = ch(g.bake(h, 'h'))
    write_set('road', A[..., :3], H, np.full_like(H, 0.9), np.zeros_like(H), cavity(H, 3, 2.5), 4.0)


if __name__ == '__main__':
    t0 = time.time()
    for name, fn in RECIPES.items():
        if ONLY and name not in ONLY:
            continue
        t = time.time()
        fn()
        print(f'DONE {name} {time.time() - t:.1f}s', flush=True)
    print(f'ALL DONE {time.time() - t0:.1f}s', flush=True)

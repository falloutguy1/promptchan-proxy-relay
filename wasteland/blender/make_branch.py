# Blender 4.5 (headless): model a fir branch (stem, twigs, needles) and render it top-down
# as an alpha card texture for the game's pine trees. Stem runs left -> right like the old card.
#   blender -b --factory-startup --python make_branch.py -- OUTDIR
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'models')
os.makedirs(OUT, exist_ok=True)
L = 2.0  # branch length; frame is L x L/2
rnd = random.Random(113)

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC.render.engine = 'CYCLES'
SC.cycles.device = 'CPU'
SC.cycles.samples = 32
SC.cycles.use_denoising = False
SC.render.film_transparent = True
SC.render.resolution_x, SC.render.resolution_y = 1024, 512
SC.view_settings.view_transform = 'Standard'
SC.view_settings.look = 'None'


def lin(c):
    # byte colour layers store sRGB; the Color Attribute node linearises them for the shader
    return min(255.0, c) / 255.0


bm = bmesh.new()
col_layer = bm.loops.layers.color.new('col')


def add_box(p0, p1, w0, w1, col, up=Vector((0, 0, 1))):
    """a tapered 4-sided stick from p0 to p1"""
    d = (p1 - p0)
    if d.length < 1e-5:
        return
    fwd = d.normalized()
    side = fwd.cross(up)
    if side.length < 1e-4:
        side = fwd.cross(Vector((0, 1, 0)))
    side.normalize()
    upv = side.cross(fwd).normalized()
    ring = []
    for p, w in ((p0, w0), (p1, w1)):
        ring.append([bm.verts.new(p + (side * sx + upv * sy) * w) for sx, sy in ((1, 0.35), (-1, 0.35), (-1, -0.35), (1, -0.35))])
    faces = []
    for i in range(4):
        a, b = ring[0][i], ring[0][(i + 1) % 4]
        c, e = ring[1][(i + 1) % 4], ring[1][i]
        faces.append(bm.faces.new((a, b, c, e)))
    faces.append(bm.faces.new(list(reversed(ring[1]))))
    for f in faces:
        for lp in f.loops:
            lp[col_layer] = col


GREENS = [(0x1d, 0x34, 0x1a), (0x24, 0x3d, 0x1f), (0x2c, 0x48, 0x25), (0x33, 0x52, 0x2b), (0x3b, 0x5c, 0x30), (0x2a, 0x44, 0x22), (0x40, 0x60, 0x34)]
BARK = (lin(0x3b), lin(0x2a), lin(0x1c), 1.0)


def needle_col(t):
    g = rnd.choice(GREENS)
    k = 1.0 + rnd.random() * 0.35 + t * 0.18  # younger growth toward the tip is lighter
    return (lin(min(255, g[0] * k)), lin(min(255, g[1] * k)), lin(min(255, g[2] * k)), 1.0)


def stem_point(a, b, t, droop):
    p = a.lerp(b, t)
    p.z -= math.sin(t * math.pi) * droop
    return p


def twig(a, ang, length, width, depth, t_branch):
    b = a + Vector((math.cos(ang), math.sin(ang), 0)) * length
    steps = max(8, int(length * 90))
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        add_box(stem_point(a, b, t0, length * 0.03), stem_point(a, b, t1, length * 0.03), width * (1 - t0 * 0.7), width * (1 - t1 * 0.7), BARK)
    # needles: two flattened rows either side plus a few on top, pointing forward
    n = int(length * 170)
    for i in range(n):
        t = (i + rnd.random()) / n
        p = stem_point(a, b, t, length * 0.03)
        nl = (0.07 + rnd.random() * 0.035) * (1 - t * 0.45) * (0.85 if depth else 1.0)
        for sgn in (-1, 1):
            spread = ang + sgn * (0.95 + rnd.random() * 0.45)
            fwd = Vector((math.cos(spread), math.sin(spread), (rnd.random() - 0.4) * 0.5)).normalized()
            fwd = (fwd + Vector((math.cos(ang), math.sin(ang), 0)) * 0.35).normalized()
            add_box(p, p + fwd * nl, 0.0045, 0.0012, needle_col(t_branch * 0.5 + t * 0.5))
        if rnd.random() < 0.45:
            up = Vector((math.cos(ang) * 0.6, math.sin(ang) * 0.6, 0.8)).normalized()
            add_box(p, p + (up + Vector((rnd.random() - 0.5, rnd.random() - 0.5, 0)) * 0.6).normalized() * nl * 0.8, 0.0042, 0.0012, needle_col(t))
    if depth > 0:
        for i in range(1, 8):
            t = i / 8.5
            p = stem_point(a, b, t, length * 0.03)
            sub = length * (0.3 if depth == 2 else 0.4) * (1 - t * 0.72)
            for sgn in (-1, 1):
                twig(p, ang + sgn * (0.75 + rnd.random() * 0.25), sub, width * 0.5, depth - 1, t)


twig(Vector((0.02, 0, 0)), 0.0, L - 0.08, 0.035, 2, 0.0)
me = bpy.data.meshes.new('branch')
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new('branch', me)
SC.collection.objects.link(ob)

# flat, unlit colour with a touch of ambient occlusion so needle layers read as depth
mat = bpy.data.materials.new('needles')
mat.use_nodes = True
nt = mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
outn = nt.nodes.new('ShaderNodeOutputMaterial')
em = nt.nodes.new('ShaderNodeEmission')
attr = nt.nodes.new('ShaderNodeVertexColor')
attr.layer_name = 'col'
ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
ao.inputs['Distance'].default_value = 0.06
mul = nt.nodes.new('ShaderNodeMix')
mul.data_type = 'RGBA'
mul.blend_type = 'MULTIPLY'
mul.inputs[0].default_value = 0.55
nt.links.new(attr.outputs['Color'], mul.inputs[6])
nt.links.new(ao.outputs['Color'], mul.inputs[7])
ao.inputs['Color'].default_value = (1, 1, 1, 1)  # output = pure occlusion
nt.links.new(mul.outputs[2], em.inputs['Color'])
nt.links.new(em.outputs[0], outn.inputs[0])
me.materials.append(mat)

cam_d = bpy.data.cameras.new('cam')
cam_d.type = 'ORTHO'
cam_d.ortho_scale = L
cam = bpy.data.objects.new('cam', cam_d)
SC.collection.objects.link(cam)
cam.location = (L / 2, 0, 5)
SC.camera = cam

path = os.path.join(OUT, 'branch_render.png')
SC.render.filepath = path
SC.render.image_settings.file_format = 'PNG'
SC.render.image_settings.color_mode = 'RGBA'
bpy.ops.render.render(write_still=True)

# bleed needle colours into transparent pixels so mipmaps don't pull in black fringes, then save sizes
im = bpy.data.images.load(path)
a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
im.pixels.foreach_get(a)
a = a.reshape(im.size[1], im.size[0], 4)
rgb, al = a[..., :3].copy(), a[..., 3].copy()
known = al > 0.05
fill = rgb * known[..., None]
cnt = known.astype(np.float32)
for _ in range(24):
    s = sum(np.roll(np.roll(fill, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    c = sum(np.roll(np.roll(cnt, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    upd = (~known) & (c > 0)
    fill[upd] = s[upd] / c[upd][:, None]
    cnt[upd] = 1.0
    known = known | upd
mean = rgb[al > 0.5].mean(axis=0) if (al > 0.5).any() else np.array([0.1, 0.18, 0.08])
fill[~known] = mean
out = np.dstack([np.where(al[..., None] > 0.05, rgb, fill), al])


def save(arr, p):
    o = bpy.data.images.new('o', arr.shape[1], arr.shape[0], alpha=True)
    o.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).ravel())
    o.filepath_raw = p
    o.file_format = 'PNG'
    o.save()
    bpy.data.images.remove(o)


save(out, os.path.join(OUT, 'branch_c_1024.png'))
h = out.reshape(256, 2, 512, 2, 4).mean(axis=(1, 3))
save(h, os.path.join(OUT, 'branch_c_512.png'))
print('BRANCH verts', len(me.vertices), 'coverage', float((al > 0.42).mean()))

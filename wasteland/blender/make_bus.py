# Blender 4.5 (headless): a 1950s conventional school bus for the town crossroads, exported as one GLB.
#   blender -b --factory-startup --python make_bus.py -- OUTDIR
# Body and hood are lofted rounded-rectangle sections; windows are picked out on the sides / front / rear
# by position (pillars between them stay painted); bumpers, grille, lamps, stop arm, mirrors, stripes and
# dual rear wheels are added. Parts sharing a material are joined into "bus__<material>".
# Axes: Blender X = length (front +X), Y = width, Z = up. Matches the game's old box bus: 11 m long.
import bpy, bmesh, math, os, sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
MATS = {n: bpy.data.materials.new(n) for n in ('paint', 'glass', 'chrome', 'tire', 'dark', 'taillight', 'lens', 'stripe')}
W = 2.5                      # width
X0, XF, X1 = -5.5, 3.45, 5.55  # rear, windshield line, hood front
ZB, ZBELT, ZROOF = 0.55, 1.78, 3.0
WHEELS = [(-3.5, True), (3.75, False)]  # (x, dual)


def rounded_rect(hw, zb, zt, r_bot, r_top, n=4):
    """half outline (y, z) from bottom centre, round the side to the top centre"""
    pts = [(0.0, zb), (hw - r_bot, zb)]
    for i in range(1, n + 1):
        a = -math.pi / 2 + i / n * math.pi / 2
        pts.append((hw - r_bot + math.cos(a) * r_bot, zb + r_bot + math.sin(a) * r_bot))
    for i in range(0, n + 1):
        a = i / n * math.pi / 2
        pts.append((hw - r_top + math.cos(a) * r_top, zt - r_top + math.sin(a) * r_top))
    pts.append((0.0, zt))
    return pts


def loft(sections):
    """sections: [(x, half_outline)] with equal point counts -> closed shell"""
    bm = bmesh.new()
    rings = []
    for x, half in sections:
        full = half + [(-y, z) for y, z in reversed(half[1:-1])]
        rings.append([bm.verts.new((x, y, z)) for y, z in full])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return bm


def mesh_obj(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    SC.collection.objects.link(ob)
    me.materials.append(MATS[mat])
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(35))
    return ob


def activate(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def add_prim(kind, name, mat, loc, rot=(0, 0, 0), scale=(1, 1, 1), bevel=0.0, **kw):
    getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, rotation=rot, **kw)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob.data.materials.append(MATS[mat])
    if bevel > 0:
        b = ob.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = 2
        b.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=b.name)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    return ob


def cut_wheel_wells(body):
    for wx, dual in WHEELS:
        for s in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=36, radius=0.62, depth=0.9, location=(wx, s * (W / 2 - 0.3), 0.52), rotation=(math.pi / 2, 0, 0))
            cyl = bpy.context.active_object
            m = body.modifiers.new('well', 'BOOLEAN')
            m.operation = 'DIFFERENCE'
            m.solver = 'EXACT'
            m.object = cyl
            activate(body)
            bpy.ops.object.modifier_apply(modifier=m.name)
            bpy.data.objects.remove(cyl, do_unlink=True)


def uv_box(ob, scale):
    activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=1.0 / scale)
    bpy.ops.object.mode_set(mode='OBJECT')


def slice_body(bm):
    """cut the shell along window edges: belt, roof rail and the pillars between side windows"""
    geom = lambda: bm.verts[:] + bm.edges[:] + bm.faces[:]
    for z in (ZBELT, ZROOF - 0.42, 0.95, 1.12):
        bmesh.ops.bisect_plane(bm, geom=geom(), dist=1e-5, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    for x in SIDE_X:
        bmesh.ops.bisect_plane(bm, geom=geom(), dist=1e-5, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    for y in (W / 2 - 0.33, -(W / 2 - 0.33), 0.05, -0.05):
        bmesh.ops.bisect_plane(bm, geom=geom(), dist=1e-5, plane_co=(0, y, 0), plane_no=(0, 1, 0))


# side windows: 9 per side between the door and the rear, pitch 0.9 m, pillars 0.14 m
PITCH, PILLAR = 0.9, 0.14
SIDE_X = []
x = X0 + 0.55
while x + PITCH < XF - 0.2:
    SIDE_X += [x, x + PITCH - PILLAR]
    x += PITCH
SIDE_X += [XF - 0.95, XF - 0.12]  # driver / door window
sections = []
N = 24
for i in range(N + 1):
    t = i / N
    xx = X0 + (XF - X0) * t
    d = min(xx - X0, XF - xx)
    sh = 1.0 if d > 0.15 else 0.9 + 0.1 * math.sqrt(max(0.0, 1 - (1 - d / 0.15) ** 2))
    sections.append((xx, rounded_rect(W / 2 * sh, ZB + (1 - sh) * 0.5, ZROOF - (1 - sh) * 0.6, 0.12, 0.42)))
bm = loft(sections)
slice_body(bm)
body = mesh_obj(bm, 'bus_body', 'paint')
# hood (engine compartment) in front of the windshield
hs = []
for i in range(9):
    t = i / 8
    xx = XF - 0.05 + (X1 - XF + 0.05) * t
    d = X1 - xx
    sh = 1.0 if d > 0.18 else 0.86 + 0.14 * math.sqrt(max(0.0, 1 - (1 - d / 0.18) ** 2))
    top = 1.62 - 0.12 * t
    hs.append((xx, rounded_rect(0.82 * sh, 0.62, top - (1 - sh) * 0.3, 0.1, 0.3)))
hood = mesh_obj(loft(hs), 'bus_hood', 'paint')
# front fenders over the front wheels
for s in (-1, 1):
    f = add_prim('uv_sphere', f'bus_fender{s}', 'paint', (WHEELS[1][0], s * (W / 2 - 0.36), 0.95), (0, 0, 0), (0.78, 0.36, 0.42), segments=24, ring_count=12, radius=1)
cut_wheel_wells(body)

# windows: side faces between belt and roof rail inside the pillar cuts; windshield; rear door windows
me = body.data
me.materials.append(MATS['glass'])
me.materials.append(MATS['stripe'])
gi, si = 1, 2
wins = [(SIDE_X[i], SIDE_X[i + 1]) for i in range(0, len(SIDE_X), 2)]
for p in me.polygons:
    c, n = p.center, p.normal
    if abs(n.y) > 0.6 and ZBELT < c.z < ZROOF - 0.42 and any(a < c.x < b for a, b in wins):
        p.material_index = gi
    elif n.x > 0.6 and ZBELT < c.z < ZROOF - 0.42 and abs(c.y) < W / 2 - 0.33 and abs(c.y) > 0.05:
        p.material_index = gi  # split windshield
    elif n.x < -0.6 and 1.9 < c.z < ZROOF - 0.42 and abs(c.y) < W / 2 - 0.33 and abs(c.y) > 0.05:
        p.material_index = gi  # emergency door windows
    elif abs(n.y) > 0.6 and 0.95 < c.z < 1.12:
        p.material_index = si  # the black rub rail along the side
uv_box(body, 0.5)
uv_box(hood, 0.5)

parts = [body, hood] + [o for o in SC.objects if o.name.startswith('bus_fender')]
# bumpers, grille, lamps, flashers, stop arm, mirrors
parts.append(add_prim('cube', 'bus_bumperF', 'dark', (X1 + 0.08, 0, 0.62), scale=(0.1, W / 2 + 0.02, 0.13), bevel=0.04))
parts.append(add_prim('cube', 'bus_bumperR', 'dark', (X0 - 0.08, 0, 0.62), scale=(0.1, W / 2 + 0.02, 0.13), bevel=0.04))
parts.append(add_prim('cube', 'bus_grille', 'chrome', (X1 + 0.01, 0, 1.08), scale=(0.03, 0.5, 0.38), bevel=0.02))
for i in range(9):
    parts.append(add_prim('cube', f'bus_gbar{i}', 'dark', (X1 + 0.035, 0, 0.74 + i * 0.085), scale=(0.01, 0.48, 0.012)))
for s in (-1, 1):
    parts.append(add_prim('cylinder', f'bus_lamp{s}', 'lens', (X1 - 0.35, s * 0.72, 1.06), (0, math.pi / 2, 0), vertices=16, radius=0.14, depth=0.2, bevel=0.02))
    parts.append(add_prim('cylinder', f'bus_flashF{s}', 'taillight', (XF + 0.02, s * (W / 2 - 0.25), ZROOF - 0.2), (0, math.pi / 2, 0), vertices=14, radius=0.1, depth=0.08))
    parts.append(add_prim('cylinder', f'bus_flashR{s}', 'taillight', (X0 - 0.02, s * (W / 2 - 0.25), ZROOF - 0.2), (0, math.pi / 2, 0), vertices=14, radius=0.1, depth=0.08))
    parts.append(add_prim('cylinder', f'bus_tail{s}', 'taillight', (X0 - 0.02, s * (W / 2 - 0.2), 0.95), (0, math.pi / 2, 0), vertices=14, radius=0.09, depth=0.06))
    parts.append(add_prim('cube', f'bus_mirror{s}', 'dark', (XF + 0.35, s * (W / 2 + 0.25), 2.05), scale=(0.03, 0.1, 0.18), bevel=0.01))
    parts.append(add_prim('cube', f'bus_marm{s}', 'dark', (XF + 0.2, s * (W / 2 + 0.12), 2.05), scale=(0.02, 0.14, 0.015)))
parts.append(add_prim('cylinder', 'bus_stop', 'taillight', (XF - 0.6, -(W / 2 + 0.05), 1.5), (math.pi / 2, 0, 0), vertices=8, radius=0.22, depth=0.02))
parts.append(add_prim('cube', 'bus_under', 'dark', ((X0 + X1) / 2, 0, 0.42), scale=((X1 - X0) / 2 - 0.3, W / 2 - 0.2, 0.08)))
# wheels (dual at the rear)
for wx, dual in WHEELS:
    for s in (-1, 1):
        offs = [W / 2 - 0.22, W / 2 - 0.5] if dual else [W / 2 - 0.3]
        for k, off in enumerate(offs):
            y = s * off
            parts.append(add_prim('cylinder', f'bus_tire{wx}{s}{k}', 'tire', (wx, y, 0.5), (math.pi / 2, 0, 0), vertices=28, radius=0.5, depth=0.26, bevel=0.06))
            if k == 0:
                parts.append(add_prim('cylinder', f'bus_rim{wx}{s}', 'chrome', (wx, y + s * 0.11, 0.5), (math.pi / 2, 0, 0), vertices=20, radius=0.28, depth=0.06, bevel=0.015))
for p in parts[2:]:
    uv_box(p, 0.8)

# join by material
by = {}
for o in list(SC.objects):
    if o.type != 'MESH':
        continue
    activate(o)
    if len(o.data.materials) > 1:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='MATERIAL')
        bpy.ops.object.mode_set(mode='OBJECT')
for o in list(SC.objects):
    if o.type == 'MESH' and len(o.data.polygons):
        m = o.data.materials[o.data.polygons[0].material_index].name
        by.setdefault(m, []).append(o)
out = []
for m, obs in by.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = 'bus__' + m
    o.data.materials.clear()
    for p in o.data.polygons:
        p.material_index = 0
    out.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in out:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'bus.glb'), export_format='GLB', use_selection=True, export_materials='NONE', export_normals=True, export_texcoords=True, export_yup=True)
print('BUS', {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in out}, flush=True)

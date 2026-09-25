# Blender 4.5 (headless): model the game's cars (sedan, van, burnt wreck) and export one GLB.
#   blender -b --factory-startup --python make_cars.py -- OUTDIR
# Bodies are lofted from rounded cross-sections (hood / cabin / trunk profiles with tail fins), wheel
# arches are boolean-cut, glass is picked out by face direction, then chrome trim, lights, grille,
# mirrors and wheels are added. Parts sharing a material are joined into one object named
# <kind>__<material> (plus <kind>__<material>__lo for the distant LOD) so the game can map them onto
# its own materials. Axes: Blender X = car length (front +X), Y = width, Z = up.
import bpy, bmesh, math, os, sys
from mathutils import Vector, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'models')
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
W = 1.9  # overall width

MATS = {}
for name in ('paint', 'glass', 'chrome', 'tire', 'dark', 'taillight', 'lens', 'rust'):
    MATS[name] = bpy.data.materials.new(name)


def smooth01(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def interp(keys, x):
    """piecewise lookup in [(x, value), ...] sorted by x, eased between keys"""
    if x <= keys[0][0]:
        return keys[0][1]
    for (x0, v0), (x1, v1) in zip(keys, keys[1:]):
        if x <= x1:
            return v0 + (v1 - v0) * smooth01((x - x0) / (x1 - x0))
    return keys[-1][1]


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def catmull(pts, per):
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(pts[-1])
    return out


def profile(spec, x):
    zb = interp(spec['zb'], x)
    zl = interp(spec['zl'], x)
    zt = max(zl, interp(spec['zt'], x))
    w = interp(spec['w'], x)
    wr = min(w - 0.1, interp(spec['wr'], x))
    fin = interp(spec['fin'], x) if 'fin' in spec else 0.0
    return zb, zl, zt, w, wr, fin


def section(x, spec):
    """half profile (y, z) from the bottom centre round the side to the roof / deck centre.
    Always the same number of points so neighbouring sections loft cleanly; the deck (hood/trunk)
    shape morphs into the cabin shape as the greenhouse grows."""
    zb, zl, zt, w, wr, fin = profile(spec, x)
    k = smooth01((zt - zl) / 0.25)
    fin *= 1 - k
    shoulder = zb + (zl - zb) * 0.62
    lower = [(0.0, zb), (w - 0.14, zb), (w - 0.04, zb + 0.06), (w, zb + 0.22), (w + 0.012, shoulder), (w - 0.015, zl - 0.06 + fin * 0.6)]
    deck = [(w - 0.06, zl + fin), (w - 0.13, zl + 0.012 + fin * 0.5), (w - 0.24, zl + 0.016), (w * 0.55, zl + 0.024), (0.0, zl + 0.03)]
    cab = [(w - 0.07, zl), (w - 0.13, zl + 0.012), (wr + 0.03, zt - 0.06), (wr - 0.1, zt), (0.0, zt + 0.02)]
    upper = [lerp2(d, c, k) for d, c in zip(deck, cab)]
    return catmull(lower + upper, 3)


def loft(spec, xs, round_len=0.12, end_scale=0.8):
    """closed body shell from sections at xs; the ends are rounded over round_len"""
    bm = bmesh.new()
    rings = []
    L0, L1 = xs[0], xs[-1]
    for x in xs:
        half = section(x, spec)
        d = min(x - L0, L1 - x)
        s = 1.0 if d >= round_len else end_scale + (1 - end_scale) * math.sqrt(max(0.0, 1 - (1 - d / round_len) ** 2))
        zc = (half[0][1] + max(p[1] for p in half)) * 0.5
        full = [(y * s, zc + (z - zc) * s) for y, z in half] + [(-y * s, zc + (z - zc) * s) for y, z in reversed(half[1:-1])]
        rings.append([bm.verts.new((x, y, z)) for y, z in full])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return bm


def finish_shading(ob, angle=38):
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(angle))


def mesh_object(bm, name, mat):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    SC.collection.objects.link(ob)
    me.materials.append(MATS[mat])
    finish_shading(ob)
    return ob


def activate(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mods(ob):
    activate(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def add_prim(kind, name, mat, loc, rot=(0, 0, 0), scale=(1, 1, 1), bevel=0.0, segs=2, **kw):
    getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, rotation=rot, **kw)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob.data.materials.append(MATS[mat])
    if bevel > 0:
        b = ob.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = segs
        b.limit_method = 'ANGLE'
        apply_mods(ob)
    finish_shading(ob)
    return ob


def strip(name, mat, pts, half_w, half_t, normal_fn):
    """thin 4-sided strip (chrome trim) through pts; normal_fn(p) gives the outward direction"""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        p = Vector(p)
        fwd = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        out = Vector(normal_fn(p)).normalized()
        up = fwd.cross(out).normalized()
        rings.append([bm.verts.new(p + out * (half_t * a) + up * (half_w * b)) for a, b in ((-1, -1), (1, -0.7), (1, 0.7), (-1, 1))])
    for a, b in zip(rings, rings[1:]):
        for j in range(4):
            bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(bm, name, mat)


def cut_arches(body, wheel_x, r=0.47, zc=0.42, inner=0.6):
    """wheel wells: a pocket per wheel (closed on the inboard side so you can't see through the car)
    with its ceiling and inner wall in the dark underbody material"""
    for i, wx in enumerate(wheel_x):
        for s in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=r, depth=0.8, location=(wx, s * (inner + 0.4), zc), rotation=(math.pi / 2, 0, 0))
            cyl = bpy.context.active_object
            mod = body.modifiers.new(f'arch{i}{s}', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.solver = 'EXACT'
            mod.object = cyl
            apply_mods(body)
            bpy.data.objects.remove(cyl, do_unlink=True)
    me = body.data
    me.materials.append(MATS['dark'])
    di = len(me.materials) - 1
    for p in me.polygons:
        c = p.center
        if abs(c.y) < W / 2 - 0.02 and any(math.hypot(c.x - wx, c.z - zc) < r + 0.012 for wx in wheel_x):
            p.material_index = di
    finish_shading(body)


def solve_x(spec, z, a, b):
    """x in [a, b] where the roof line zt(x) crosses z (zt is monotonic there)"""
    fa = profile(spec, a)[2] - z
    for _ in range(60):
        m = (a + b) * 0.5
        fm = profile(spec, m)[2] - z
        if (fm > 0) == (fa > 0):
            a, fa = m, fm
        else:
            b = m
    return (a + b) * 0.5


def glass_layout(spec):
    """straight window edges: belt line, roof rail, A/C pillar lines, screen tops, B pillar"""
    g = spec['glass']
    lay = dict(belt=g['belt'], rail=g['rail'], lat=g['lat'], skip=g['skip'])
    lay['a'] = [(solve_x(spec, z + 0.055, *g['front']), z) for z in (g['belt'], g['rail'])]
    lay['sf'] = solve_x(spec, g['top'], *g['front'])
    if 'rear' in g:
        lay['c'] = [(solve_x(spec, z + 0.055, *g['rear']), z) for z in (g['belt'], g['rail'])]
        lay['sr'] = solve_x(spec, g['top'], *g['rear'])
    return lay


def line_x(line, z):
    (x0, z0), (x1, z1) = line
    return x0 + (x1 - x0) * (z - z0) / (z1 - z0)


def glass_cuts(bm, lay):
    """slice the shell along every window edge so face-by-face material picks give clean outlines"""
    def upper():
        fs = [f for f in bm.faces if all(v.co.z >= lay['belt'] - 1e-4 for v in f.verts)]
        es = list({e for f in fs for e in f.edges})
        vs = list({v for f in fs for v in f.verts})
        return vs + es + fs
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=(0, 0, lay['belt']), plane_no=(0, 0, 1))
    planes = [((0, 0, lay['rail']), (0, 0, 1)), ((0, lay['lat'], 0), (0, 1, 0)), ((0, -lay['lat'], 0), (0, 1, 0)), ((lay['sf'], 0, 0), (1, 0, 0))]
    for key in ('a', 'c'):
        if key in lay:
            (x0, z0), (x1, z1) = lay[key]
            planes.append(((x0, 0, z0), Vector((z1 - z0, 0, -(x1 - x0))).normalized()))
    if 'sr' in lay:
        planes.append(((lay['sr'], 0, 0), (1, 0, 0)))
    for a, b in lay['skip']:
        for x in (a, b):
            if -5 < x < 5:
                planes.append(((x, 0, 0), (1, 0, 0)))
    for co, no in planes:
        bmesh.ops.bisect_plane(bm, geom=upper(), dist=1e-5, plane_co=co, plane_no=no)


def assign_glass(body, lay, glass_mat='glass'):
    """windshield / rear window inside the pillars above the belt; side glass between belt, rail and the pillar lines"""
    me = body.data
    if glass_mat not in [m.name for m in me.materials]:
        me.materials.append(MATS[glass_mat])
    gi = [m.name for m in me.materials].index(glass_mat)
    for p in me.polygons:
        c, n = p.center, p.normal
        if c.z < lay['belt']:
            continue
        inside = abs(c.y) < lay['lat']
        front = inside and c.x > lay['sf'] and n.x > 0.1
        rear = inside and 'sr' in lay and c.x < lay['sr'] and n.x < -0.1
        side = (abs(n.y) > 0.5 and c.z < lay['rail'] and c.x < line_x(lay['a'], c.z)
                and ('c' not in lay or c.x > line_x(lay['c'], c.z))
                and not any(a <= c.x <= b for a, b in lay['skip']))
        if front or rear or side:
            p.material_index = gi


def rust_panels(body, spec, lay):
    """wreck: the hood, roof, trunk lid and sills have rusted through; the rest keeps faded paint"""
    me = body.data
    me.materials.append(MATS['rust'])
    ri = len(me.materials) - 1
    pi = [m.name for m in me.materials].index('paint')
    for p in me.polygons:
        if p.material_index != pi:
            continue
        c, n = p.center, p.normal
        zl = profile(spec, c.x)[1]
        deck = n.z > 0.55 and c.z > zl - 0.06 and (c.x > 1.0 or c.x < -1.75)
        roof = n.z > 0.5 and c.z > lay['rail'] - 0.01
        sill = c.z < 0.62 and abs(n.y) > 0.3
        if deck or roof or sill:
            p.material_index = ri


def uv_box(ob, scale=0.45):
    activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=1.0 / scale)
    bpy.ops.object.mode_set(mode='OBJECT')


def wheel(prefix, x, side, tire_mat='tire', rim=True):
    y = side * (W / 2 - 0.13)
    parts = [add_prim('cylinder', f'{prefix}_tire', tire_mat, (x, y, 0.42), (math.pi / 2, 0, 0), vertices=28, radius=0.43, depth=0.26, bevel=0.07, segs=3)]
    if rim:
        parts.append(add_prim('cylinder', f'{prefix}_rim', 'chrome', (x, y + side * 0.1, 0.42), (math.pi / 2, 0, 0), vertices=20, radius=0.25, depth=0.07, bevel=0.02))
        parts.append(add_prim('uv_sphere', f'{prefix}_hub', 'chrome', (x, y + side * 0.14, 0.42), (0, 0, 0), (1, 0.45, 1), segments=10, ring_count=5, radius=0.09))
        for k in range(5):
            a = k / 5 * math.tau
            parts.append(add_prim('cylinder', f'{prefix}_nut{k}', 'dark', (x + math.cos(a) * 0.14, y + side * 0.135, 0.42 + math.sin(a) * 0.14), (math.pi / 2, 0, 0), vertices=6, radius=0.018, depth=0.03))
    return parts


def front_and_rear(kind, spec, L0, L1, van, wreck, zb_front=0.5):
    """bumpers, grille, lamps, tail lights, plates"""
    trim = 'rust' if wreck else 'chrome'
    lens = 'dark' if wreck else 'lens'
    parts = []
    zbump = zb_front
    parts.append(add_prim('cube', f'{kind}_bumperF', trim, (L1 + 0.03, 0, zbump), scale=(0.09, W / 2 + 0.03, 0.1), bevel=0.04))
    parts.append(add_prim('cube', f'{kind}_bumperR', trim, (L0 - 0.03, 0, zbump), scale=(0.09, W / 2 + 0.03, 0.1), bevel=0.04))
    zlf = interp(spec['zl'], L1 - 0.05)
    if not van:
        # vertical-bar grille between round headlamps, bullet bumper guards, hood ornament
        parts.append(add_prim('cube', f'{kind}_grille', 'dark', (L1 - 0.02, 0, zbump + 0.22), scale=(0.04, 0.46, 0.1), bevel=0.02))
        for i in range(9):
            parts.append(add_prim('cube', f'{kind}_gbar{i}', trim, (L1 + 0.012, -0.4 + i * 0.1, zbump + 0.22), scale=(0.012, 0.01, 0.09)))
        parts.append(add_prim('cube', f'{kind}_gtop', trim, (L1 + 0.015, 0, zbump + 0.33), scale=(0.015, 0.48, 0.012)))
        for s in (-1, 1):
            parts.append(add_prim('uv_sphere', f'{kind}_guard{s}', trim, (L1 + 0.13, s * 0.42, zbump + 0.03), (0, 0, 0), (0.13, 0.06, 0.06), segments=12, ring_count=6, radius=1))
        if not wreck:
            zh = interp(spec['zl'], L1 - 0.45) + 0.035
            parts.append(add_prim('uv_sphere', f'{kind}_ornament', 'chrome', (L1 - 0.45, 0, zh), (0, 0.25, 0), (0.14, 0.018, 0.04), segments=10, ring_count=5, radius=1))
    else:
        parts.append(add_prim('cube', f'{kind}_grille', 'dark', (L1 - 0.02, 0, zbump + 0.2), scale=(0.04, 0.42, 0.1), bevel=0.02))
        for i in range(4):
            parts.append(add_prim('cube', f'{kind}_gbar{i}', trim, (L1 + 0.012, 0, zbump + 0.13 + i * 0.05), scale=(0.012, 0.42, 0.01)))
    for s in (-1, 1):
        if not van:
            parts.append(add_prim('cylinder', f'{kind}_ring{s}', trim, (L1 - 0.04, s * (W / 2 - 0.26), zlf - 0.12), (0, math.pi / 2, 0), vertices=20, radius=0.12, depth=0.08, bevel=0.015))
            parts.append(add_prim('uv_sphere', f'{kind}_lamp{s}', lens, (L1 - 0.005, s * (W / 2 - 0.26), zlf - 0.12), (0, 0, 0), (0.35, 1, 1), segments=14, ring_count=7, radius=0.1))
        else:
            parts.append(add_prim('cube', f'{kind}_lampring{s}', trim, (L1 - 0.02, s * (W / 2 - 0.27), zlf - 0.16), scale=(0.035, 0.16, 0.1), bevel=0.02))
            parts.append(add_prim('cube', f'{kind}_lamp{s}', lens, (L1 + 0.005, s * (W / 2 - 0.27), zlf - 0.16), scale=(0.02, 0.13, 0.075), bevel=0.015))
        # tail lamps: tall lenses at the fin ends (sedan) or corner lamps (van)
        zb, zl, zt, w, wr, fin = profile(spec, L0)
        tz = zl - 0.08 + fin * 0.4 if not van else zl - 0.12
        tail = 'dark' if wreck and s > 0 else 'taillight'
        parts.append(add_prim('cube', f'{kind}_tail{s}', tail, (L0 + 0.005, s * (w * 0.8 - 0.1), tz), scale=(0.035, 0.07 if not van else 0.1, 0.12 if not van else 0.09), bevel=0.02))
    parts.append(add_prim('cube', f'{kind}_plate', 'dark', (L0 - 0.01, 0, zbump + 0.2), scale=(0.02, 0.2, 0.07)))
    return parts


def side_details(kind, spec, L0, L1, van, wreck):
    trim = 'rust' if wreck else 'chrome'
    parts = []
    if not van:
        # a chrome spear along the flank below the belt line, clear of the wheel arches
        for s in (-1, 1):
            xs = [L0 + 0.35 + (L1 - L0 - 0.75) * i / 30 for i in range(31)]
            pts = []
            for x in xs:
                zb, zl, zt, w, wr, fin = profile(spec, x)
                pts.append((x, s * (w + 0.004), zl - 0.1))
            parts.append(strip(f'{kind}_spear{s}', trim, pts, 0.016, 0.008, lambda p, s=s: (0, s, 0)))
        handles = [-0.28, -1.28]
    else:
        handles = [0.45]
    for s in (-1, 1):
        for hx in handles:
            zb, zl, zt, w, wr, fin = profile(spec, hx)
            parts.append(add_prim('cube', f'{kind}_handle{s}{hx}', trim, (hx, s * (w + 0.006), zl - 0.05), scale=(0.07, 0.012, 0.014), bevel=0.006))
    if not wreck:
        mx = spec['a_pillar'] - 0.12 if not van else 1.12
        zb, zl, zt, w, wr, fin = profile(spec, mx)
        for s in (-1, 1):
            parts.append(add_prim('cube', f'{kind}_mirror{s}', 'chrome', (mx, s * (w + 0.1), zl + 0.12), scale=(0.045, 0.075, 0.05), bevel=0.02))
            parts.append(add_prim('cube', f'{kind}_mstalk{s}', 'chrome', (mx, s * (w + 0.03), zl + 0.06), scale=(0.015, 0.05, 0.012)))
    if van:
        # two small rear windows in the back doors and the door split
        zb, zl, zt, w, wr, fin = profile(spec, L0)
        for s in (-1, 1):
            parts.append(add_prim('cube', f'{kind}_rearwin{s}', 'dark' if wreck else 'glass', (L0 - 0.004, s * 0.33, zl + 0.36), scale=(0.012, 0.24, 0.2), bevel=0.02))
        parts.append(add_prim('cube', f'{kind}_split', 'dark', (L0 - 0.006, 0, (zb + zt) * 0.5), scale=(0.01, 0.008, (zt - zb) * 0.36)))
    parts.append(add_prim('cube', f'{kind}_under', 'dark', ((L0 + L1) / 2, 0, 0.34), scale=((L1 - L0) / 2 - 0.25, W / 2 - 0.14, 0.05)))
    return parts


def dent(ob, amount, seed):
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    me = ob.data
    me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
    for v in me.vertices:
        p = v.co
        n = noise.noise(p * 1.7 + off) * amount + noise.noise(p * 5.0 + off) * amount * 0.35 + noise.noise(p * 11.0 + off) * amount * 0.12
        v.co = p + v.normal * n


def join_by_material(kind, objs):
    """split every part by material, then merge everything sharing a material into <kind>__<material>"""
    for o in objs:
        if len(o.data.materials) > 1:
            activate(o)
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.separate(type='MATERIAL')
            bpy.ops.object.mode_set(mode='OBJECT')
    by = {}
    for o in list(SC.collection.objects):
        if o.type != 'MESH' or not o.name.startswith(kind + '_') or o.name.startswith(kind + '__') or not len(o.data.polygons):
            continue
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
        o.name = f'{kind}__{m}'
        o.data.name = o.name
        o.data.materials.clear()
        o.data.materials.append(MATS[m])
        for p in o.data.polygons:
            p.material_index = 0
        out.append(o)
    return out


SEDAN = {
    'zb': [(-2.72, 0.42), (-2.3, 0.37), (2.3, 0.37), (2.72, 0.42)],
    'zl': [(-2.72, 0.95), (-2.2, 1.0), (-1.6, 1.03), (0.98, 1.03), (2.2, 0.98), (2.72, 0.84)],
    'zt': [(-2.72, 0.0), (-1.62, 1.03), (-1.0, 1.44), (0.12, 1.46), (0.98, 1.03), (2.72, 0.0)],
    'w': [(-2.72, 0.86), (-2.2, 0.93), (-1.0, 0.95), (1.2, 0.95), (2.3, 0.92), (2.72, 0.84)],
    'wr': [(-2.72, 0.7), (-1.0, 0.74), (0.2, 0.74), (2.72, 0.7)],
    'fin': [(-2.72, 0.13), (-2.1, 0.08), (-1.35, 0.0)],
    'a_pillar': 0.12, 'c_pillar': -0.98,
    'glass': dict(belt=1.085, rail=1.4, lat=0.655, top=1.425, front=(0.12, 0.98), rear=(-1.62, -1.0), skip=[(-0.44, -0.3)]),
}
VAN = {
    'zb': [(-2.36, 0.44), (-2.1, 0.38), (2.1, 0.38), (2.44, 0.44)],
    'zl': [(-2.36, 1.12), (1.3, 1.14), (1.6, 1.16), (2.1, 1.1), (2.44, 0.95)],
    'zt': [(-2.36, 1.95), (-2.2, 2.08), (1.02, 2.1), (1.58, 1.2), (2.44, 0.0)],
    'w': [(-2.36, 0.9), (-2.1, 0.95), (1.8, 0.95), (2.44, 0.88)],
    'wr': [(-2.36, 0.86), (-2.0, 0.9), (1.2, 0.9), (2.44, 0.8)],
    'a_pillar': 1.06, 'c_pillar': -9,
    'glass': dict(belt=1.21, rail=1.86, lat=0.76, top=2.06, front=(1.02, 1.58), skip=[(-9.0, 0.32)]),
}


def build(kind, spec, L0, L1, wheel_x, wreck=False, van=False, seed=1):
    xs = [L0 + (L1 - L0) * (0.5 - 0.5 * math.cos(math.pi * i / 46)) for i in range(47)]
    lay = glass_layout(spec)
    bm = loft(spec, xs)
    glass_cuts(bm, lay)
    body = mesh_object(bm, f'{kind}_body', 'paint')
    cut_arches(body, wheel_x)
    assign_glass(body, lay, glass_mat='dark' if wreck else 'glass')
    if wreck:
        rust_panels(body, spec, lay)
        dent(body, 0.05, seed)
        for v in body.data.vertices:  # the roof has caved in
            if v.co.z > 1.2:
                v.co.z -= 0.15 * max(0.0, 1 - abs(v.co.x + 0.4) / 1.4)
        finish_shading(body)
    uv_box(body)
    parts = [body]
    parts += front_and_rear(kind, spec, L0, L1, van, wreck)
    parts += side_details(kind, spec, L0, L1, van, wreck)
    n = 0
    for wx in wheel_x:
        for s in (-1, 1):
            n += 1
            if wreck and n != 1:  # the wreck keeps only its rear-left wheel, like the old model
                continue
            parts += wheel(f'{kind}_w{n}', wx, s, rim=not wreck)
    for p in parts:
        if p != body:
            uv_box(p, 0.8)
    return join_by_material(kind, parts)


def main():
    made = []
    made += build('sedan', SEDAN, -2.72, 2.72, [-1.55, 1.52])
    made += build('van', VAN, -2.36, 2.44, [-1.45, 1.46], van=True)
    made += build('wreck', SEDAN, -2.72, 2.72, [-1.55, 1.52], wreck=True, seed=5)
    lods = []
    for o in list(made):
        activate(o)
        bpy.ops.object.duplicate()
        c = bpy.context.active_object
        c.name = o.name + '__lo'
        c.data = c.data.copy()
        c.data.name = c.name
        d = c.modifiers.new('dec', 'DECIMATE')
        d.ratio = 0.5 if o.name.endswith(('__glass', '__taillight', '__lens')) else 0.25
        d.use_collapse_triangulate = True
        apply_mods(c)
        lods.append(c)
    bpy.ops.object.select_all(action='DESELECT')
    for o in made + lods:
        o.data.validate(clean_customdata=False)
        o.data.materials.clear()
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'cars.glb'), export_format='GLB', use_selection=True, export_materials='NONE',
                              export_normals=True, export_texcoords=True, export_apply=True, export_yup=True)
    tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
    for o in made:
        lo = bpy.data.objects[o.name + '__lo']
        print('PART', o.name, tri(o), 'tris; lod', tri(lo), flush=True)
    for k in ('sedan', 'van', 'wreck'):
        print('CAR', k, sum(tri(o) for o in made if o.name.startswith(k + '__')), 'tris; lod', sum(tri(o) for o in lods if o.name.startswith(k + '__')), flush=True)


main()

# Blender 4.5 (headless): sculpt 3 boulders, bake them onto low-poly game meshes, export GLB + atlas.
#   blender -b --factory-startup --python make_rocks.py -- OUTDIR
# Each rock: a dense sphere cut by random planes (faceted boulder), roughened with fractal noise,
# textured by an object-space procedural material. Low-poly LOD0/LOD1 are decimated copies whose
# normal / color / AO / roughness are baked from the dense mesh into one shared 2x2 atlas.
import bpy, bmesh, math, os, sys, random, time
import numpy as np
from mathutils import Vector, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else 'models')
ATLAS = 1024
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
SC.render.engine = 'CYCLES'
SC.cycles.device = 'CPU'
SC.cycles.samples = 24
SC.cycles.use_denoising = False
SC.render.bake.margin = 6


def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h, a=1.0):
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255), a)


def select_only(*obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def sculpt(seed):
    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=1.0)
    ob = bpy.context.active_object
    ob.name = f'rock{seed}_hi'
    planes = []
    for _ in range(rnd.randint(9, 13)):
        n = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 0.6))).normalized()
        planes.append((n, rnd.uniform(0.62, 0.86)))
    planes.append((Vector((0, 0, -1)), rnd.uniform(0.36, 0.46)))  # flat-ish base
    sx, sy, sz = rnd.uniform(0.95, 1.25), rnd.uniform(0.8, 1.05), rnd.uniform(0.62, 0.85)
    off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    me = ob.data
    for v in me.vertices:
        d = v.co.normalized()
        r = 1.0
        for n, h in planes:
            c = d.dot(n)
            if c > 1e-3:
                r = min(r, h / c)
        p = d * r
        lump = noise.fractal(p * 1.1 + off, 0.5, 2.0, 5, noise_basis='PERLIN_ORIGINAL') * 0.09
        ridg = noise.ridged_multi_fractal(p * 3.4 + off, 0.8, 2.1, 4, 1.0, 2.0, noise_basis='PERLIN_ORIGINAL') * 0.018
        grit = noise.noise(p * 14.0 + off) * 0.006
        p = p * (r + lump + ridg + grit) / max(r, 1e-4)
        v.co = Vector((p.x * sx, p.y * sy, p.z * sz))
    for f in me.polygons:
        f.use_smooth = True
    me.update()
    return ob


def rock_material():
    m = bpy.data.materials.new('rockmat')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    for n in list(N):
        N.remove(n)
    out = N.new('ShaderNodeOutputMaterial')
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    L.new(bsdf.outputs[0], out.inputs[0])
    tc = N.new('ShaderNodeTexCoord')
    geo = N.new('ShaderNodeNewGeometry')

    def tex_noise(scale, detail, rough=0.55, dist=0.0, vec=None):
        t = N.new('ShaderNodeTexNoise')
        t.noise_dimensions = '3D'
        t.inputs['Scale'].default_value = scale
        t.inputs['Detail'].default_value = detail
        t.inputs['Roughness'].default_value = rough
        t.inputs['Distortion'].default_value = dist
        L.new(vec or tc.outputs['Object'], t.inputs['Vector'])
        return t.outputs['Fac']

    def ramp(fac, stops):
        r = N.new('ShaderNodeValToRGB')
        cr = r.color_ramp
        cr.elements[0].position, cr.elements[0].color = stops[0]
        cr.elements[1].position, cr.elements[1].color = stops[-1]
        for pos, col in stops[1:-1]:
            e = cr.elements.new(pos)
            e.color = col
        L.new(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def mix(a, b, fac, blend='MIX'):
        mx = N.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.blend_type = blend
        L.new(fac, mx.inputs[0]) if not isinstance(fac, float) else None
        if isinstance(fac, float):
            mx.inputs[0].default_value = fac
        L.new(a, mx.inputs[6]) if not isinstance(a, tuple) else None
        if isinstance(a, tuple):
            mx.inputs[6].default_value = a
        L.new(b, mx.inputs[7]) if not isinstance(b, tuple) else None
        if isinstance(b, tuple):
            mx.inputs[7].default_value = b
        return mx.outputs[2]

    def math(op, a, b=0.0, clamp=True):
        n = N.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        (L.new(a, n.inputs[0]) if not isinstance(a, float) else setattr(n.inputs[0], 'default_value', a))
        (L.new(b, n.inputs[1]) if not isinstance(b, float) else setattr(n.inputs[1], 'default_value', b))
        return n.outputs[0]

    def smooth(e0, e1, x):
        n = N.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        L.new(x, n.inputs[0])
        n.inputs[1].default_value, n.inputs[2].default_value = e0, e1
        return n.outputs[0]

    base_n = tex_noise(1.6, 8, 0.58, 0.15)
    fine_n = tex_noise(9.0, 6, 0.6)
    grain = tex_noise(40.0, 3, 0.6)
    # strata: noise-warped bands along height
    sep = N.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Object'], sep.inputs[0])
    warp = math('MULTIPLY', tex_noise(2.2, 4), 0.35, clamp=False)
    zz = math('ADD', sep.outputs[2], warp, clamp=False)
    band = math('SINE', math('MULTIPLY', zz, 26.0, clamp=False), clamp=False)
    band01 = math('MULTIPLY_ADD', band, 0.5) if False else math('ADD', math('MULTIPLY', band, 0.5, clamp=False), 0.5)
    vor = N.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 3.2
    L.new(tc.outputs['Object'], vor.inputs['Vector'])
    crack = math('MULTIPLY', smooth(0.045, 0.006, vor.outputs['Distance']), smooth(0.45, 0.62, tex_noise(3.0, 3)))
    col = ramp(base_n, [(0.25, hexc(0x5b554e)), (0.5, hexc(0x7e756b)), (0.72, hexc(0x9c9285))])
    col = mix(col, ramp(band01, [(0.0, hexc(0x857465)), (1.0, hexc(0x9a8e80))]), smooth(0.6, 0.9, band01))
    col = mix(col, ramp(fine_n, [(0.3, (0.8, 0.8, 0.8, 1)), (0.7, (1.1, 1.1, 1.1, 1))]), 1.0, 'MULTIPLY')
    col = mix(col, ramp(grain, [(0.3, (0.88, 0.88, 0.88, 1)), (0.7, (1.08, 1.08, 1.08, 1))]), 1.0, 'MULTIPLY')
    # worn light edges / dark cavities from pointiness
    edge = smooth(0.52, 0.62, geo.outputs['Pointiness'])
    cav = smooth(0.48, 0.42, geo.outputs['Pointiness'])
    col = mix(col, hexc(0xb3a999), math('MULTIPLY', edge, 0.55))
    col = mix(col, hexc(0x2e2a26), math('MULTIPLY', cav, 0.5))
    col = mix(col, hexc(0x2a2622), math('MULTIPLY', crack, 0.85))
    # lichen on top-facing surfaces, dust near the ground
    nz = N.new('ShaderNodeSeparateXYZ')
    L.new(geo.outputs['Normal'], nz.inputs[0])
    up = smooth(0.35, 0.8, nz.outputs[2])
    lich = math('MULTIPLY', math('MULTIPLY', up, smooth(0.55, 0.62, tex_noise(4.5, 5))), 0.8)
    col = mix(col, ramp(fine_n, [(0.3, hexc(0x6f7a3e)), (0.7, hexc(0x9aa05a))]), lich)
    dust = math('MULTIPLY', smooth(-0.05, -0.32, sep.outputs[2]), 0.6)
    col = mix(col, hexc(0x7a6a55), dust)
    L.new(col, bsdf.inputs['Base Color'])
    rough = math('ADD', math('MULTIPLY', fine_n, 0.14), 0.76)
    L.new(rough, bsdf.inputs['Roughness'])
    bump = N.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.6
    bump.inputs['Distance'].default_value = 0.03
    hgt = math('SUBTRACT', math('ADD', math('MULTIPLY', fine_n, 0.6), math('MULTIPLY', grain, 0.25)), math('MULTIPLY', crack, 0.9), clamp=False)
    L.new(hgt, bump.inputs['Height'])
    L.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def lowpoly(hi, faces, name):
    select_only(hi)
    bpy.ops.object.duplicate()
    lo = bpy.context.active_object
    lo.name = name
    mod = lo.modifiers.new('dec', 'DECIMATE')
    mod.ratio = faces / len(hi.data.polygons)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    lo.data.materials.clear()
    for attr in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(lo, attr, False)  # bake targets must not occlude the detailed rock they sample
    return lo


def unwrap(lo, quad):
    select_only(lo)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    ox, oy = (quad % 2) * 0.5, (quad // 2) * 0.5
    uv = lo.data.uv_layers.active.data
    for d in uv:
        d.uv = (ox + d.uv.x * 0.5, oy + d.uv.y * 0.5)


def main():
    t0 = time.time()
    mat = rock_material()
    imgs = {k: bpy.data.images.new('atlas_' + k, ATLAS, ATLAS, alpha=False, float_buffer=(k != 'albedo')) for k in ('albedo', 'normal', 'ao', 'rough')}
    imgs['albedo'].colorspace_settings.name = 'sRGB'
    for k in ('normal', 'ao', 'rough'):
        imgs[k].colorspace_settings.name = 'Non-Color'
    bake_mat = bpy.data.materials.new('bake_target')
    bake_mat.use_nodes = True
    tnode = bake_mat.node_tree.nodes.new('ShaderNodeTexImage')
    bake_mat.node_tree.nodes.active = tnode
    los = []
    for i, seed in enumerate((7, 23, 51)):
        hi = sculpt(seed)
        hi.data.materials.append(mat)
        lo0 = lowpoly(hi, 700, f'rock{i}_0')
        lo1 = lowpoly(hi, 130, f'rock{i}_1')
        unwrap(lo0, i)
        unwrap(lo1, i)
        lo0.data.materials.append(bake_mat)
        first = i == 0
        for key, btype, kw in (('normal', 'NORMAL', {}), ('albedo', 'DIFFUSE', {'pass_filter': {'COLOR'}}), ('ao', 'AO', {}), ('rough', 'ROUGHNESS', {})):
            tnode.image = imgs[key]
            select_only(hi, lo0, active=lo0)
            bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.22, max_ray_distance=0.5, use_clear=first, **kw)
        # LOD1 shares the atlas region: bake it too, but only where LOD0 left nothing would be wrong,
        # so LOD1 simply reuses LOD0's texels through its own (similar) unwrap -> bake it separately below
        los.append((lo0, lo1, hi))
        print(f'ROCK {i} baked {time.time() - t0:.1f}s', flush=True)
        for o in (hi, lo0, lo1):  # park finished rocks far away so they don't shadow the next bake
            o.location.x += 40.0 * (i + 1)
    # LOD1 gets its own small atlas so its unwrap stays consistent
    imgs1 = {k: bpy.data.images.new('atlas1_' + k, ATLAS // 4, ATLAS // 4, alpha=False, float_buffer=(k != 'albedo')) for k in ('albedo', 'normal')}
    imgs1['albedo'].colorspace_settings.name = 'sRGB'
    imgs1['normal'].colorspace_settings.name = 'Non-Color'
    for i, (lo0, lo1, hi) in enumerate(los):
        lo1.data.materials.append(bake_mat)
        for key, btype, kw in (('normal', 'NORMAL', {}), ('albedo', 'DIFFUSE', {'pass_filter': {'COLOR'}})):
            tnode.image = imgs1[key]
            select_only(hi, lo1, active=lo1)
            bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.32, max_ray_distance=0.7, use_clear=(i == 0), **kw)
    # pack + save
    def arr(im):
        a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
        im.pixels.foreach_get(a)
        return a.reshape(im.size[1], im.size[0], 4)

    def save(a, path, srgb):
        im = bpy.data.images.new('s', a.shape[1], a.shape[0], alpha=True)
        im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
        im.filepath_raw = path
        im.file_format = 'PNG'
        im.save()
        bpy.data.images.remove(im)

    A, Nn, AO, R = arr(imgs['albedo']), arr(imgs['normal']), arr(imgs['ao']), arr(imgs['rough'])
    ao = AO[..., 0]
    alb = A.copy()
    alb[..., :3] *= (0.45 + 0.55 * ao[..., None])
    one = np.ones_like(ao)
    orm = np.dstack([ao, R[..., 0], np.zeros_like(ao), one])

    def half(a):
        s = a.shape
        return a.reshape(s[0] // 2, 2, s[1] // 2, 2, s[2]).mean(axis=(1, 3))

    for size in (1024, 512):
        a, n, o = alb, Nn, orm
        while a.shape[0] > size:
            a, n, o = half(a), half(n), half(o)
        save(a, os.path.join(OUT, f'rocks_c_{size}.png'), True)
        save(n, os.path.join(OUT, f'rocks_n_{size}.png'), False)
        save(o, os.path.join(OUT, f'rocks_orm_{size}.png'), False)
    save(arr(imgs1['albedo']), os.path.join(OUT, 'rocks1_c_256.png'), True)
    save(arr(imgs1['normal']), os.path.join(OUT, 'rocks1_n_256.png'), False)
    # export low-poly meshes only
    for o in bpy.data.objects:
        o.select_set(False)
    for lo0, lo1, hi in los:
        lo0.data.materials.clear()
        lo1.data.materials.clear()
        lo0.location.x = lo1.location.x = 0.0
        lo0.select_set(True)
        lo1.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'rocks.glb'), export_format='GLB', use_selection=True,
                              export_materials='NONE', export_tangents=True, export_normals=True, export_texcoords=True, export_apply=True)
    tris = [(lo0.name, sum(len(p.vertices) - 2 for p in lo0.data.polygons), sum(len(p.vertices) - 2 for p in lo1.data.polygons)) for lo0, lo1, hi in los]
    print('EXPORTED', tris, f'{time.time() - t0:.1f}s', flush=True)


main()

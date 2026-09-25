# Blender 4.5 (headless): turn downloaded Poly Haven (CC0) glTF models into light game props.
#   blender -b --factory-startup --python make_props.py -- SRC_DIR OUT_MODELS OUT_TEX [only,these]
# Each prop: meshes picked and joined (lid kept separate where the game animates one), re-oriented into
# the game's frame, grounded, scaled, decimated to a triangle budget; its colour / normal / ORM maps are
# resized to 512 and 256 (multi-material props are baked into one atlas first). One GLB per prop with
# nodes named "body" (and "lid").
import bpy, bmesh, os, sys, math, glob, json
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, TEXOUT = (os.path.abspath(a) for a in ARGS[:3])
ONLY = set(ARGS[3].split(',')) if len(ARGS) > 3 and ARGS[3] else None
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEXOUT, exist_ok=True)

# game name: (poly haven id, triangle budget, extra options)
# rot: Euler (deg) applied in Blender space before grounding; pick: substrings of object names to keep;
# lid: substring of the object that becomes the separate lid; tool: hang from the grip (see below)
PROPS = {
    'barrel': ('barrel_stove', 900, {}),
    'wbarrel': ('Barrel_01', 900, {}),
    'crate': ('wooden_crate_01', 1400, dict(lid='lid', scale=1.15)),
    'ammo': ('ammo_box', 900, dict(scale=1.8)),
    'tyre': ('old_tyre', 700, dict(rot=(0, 0, 0))),
    'barrier': ('concrete_road_barrier', 500, {}),
    'trashcan': ('metal_trash_can', 1000, dict(keep_names=['metal_trash_can', 'metal_trash_can_handle_left', 'metal_trash_can_handle_right'])),
    'jerrycan': ('metal_jerrycan', 700, {}),
    'propane': ('propane_tank', 800, {}),
    'log': ('dead_tree_trunk', 900, {}),
    'log2': ('dead_tree_trunk_02', 1400, {}),
    'stump': ('tree_stump_01', 1000, {}),
    'tarpcar': ('covered_car', 2400, dict(rot=(0, 0, 90))),
    'generator': ('portable_generator', 2200, {}),
    'axe': ('wooden_axe_03', 600, dict(tool=True)),
    'hammer': ('cross_pein_hammer', 500, dict(tool=True)),
    'saw': ('handsaw_wood', 500, dict(tool=True)),
    'sledge': ('sledgehammer_01', 500, dict(tool=True)),
    'crowbar': ('crowbar_01', 400, dict(tool=True)),
    'pickaxe': ('picke_dirty_01', 700, dict(tool=True)),
    'hatchet': ('hatchet', 600, dict(tool=True)),
    # weapons (gun: barrel turned to the game's +z, origin 4 cm behind the trigger)
    'g_pistol': ('service_pistol', 1300, dict(gun=True, keep_names=['service_pistol_pistol_a', 'service_pistol_slide_a', 'service_pistol_hammer_a', 'service_pistol_trigger_a'])),
    'g_rifle': ('bolt_action_rifle_7_62', 1900, dict(gun=True, keep_names=['bolt_action_rifle_7_62', 'bolt_action_rifle_7_62_bolt_a', 'bolt_action_rifle_7_62_scope', 'bolt_action_rifle_7_62_trigger', 'bolt_action_rifle_7_62_wrap'])),
    'g_shotgun': ('bolt_action_rifle_7_62', 1700, dict(gun=True, build='shotgun', keep_names=['bolt_action_rifle_7_62', 'bolt_action_rifle_7_62_bolt_a', 'bolt_action_rifle_7_62_trigger'])),
    'g_pipe': ('bolt_action_rifle_7_62', 1700, dict(gun=True, build='pipe', keep_names=['bolt_action_rifle_7_62', 'bolt_action_rifle_7_62_trigger', 'bolt_action_rifle_7_62_wrap'])),
    'g_machete': ('machete', 500, dict(tool=True, flip=True)),
}
PH = os.path.join(os.path.dirname(SRC), 'ph')  # photo-scanned texture sets from fetch_ph.py
report = {}


def activate(obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def img_array(img, size):
    im = img.copy()
    im.scale(size, size)
    a = np.empty(size * size * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(size, size, 4)


def save_png(a, path):
    im = bpy.data.images.new('o', a.shape[1], a.shape[0], alpha=True)
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def material_maps(mat):
    """base colour, normal and metallic-roughness (ARM) images of a glTF-imported Principled material"""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')

    def upstream_image(sock):
        seen = [sock]
        while seen:
            s = seen.pop()
            for l in s.links:
                n = l.from_node
                if n.type == 'TEX_IMAGE':
                    return n.image
                seen += [i for i in n.inputs if i.is_linked]
        return None
    return upstream_image(bsdf.inputs['Base Color']), upstream_image(bsdf.inputs['Normal']), upstream_image(bsdf.inputs['Roughness'])


def bake_atlas(ob, size=1024):
    """several materials -> one atlas: colour, normal and ORM (roughness/metal from the source maps)"""
    me = ob.data
    src = me.uv_layers[0].name  # keep its name: the imported normal-map nodes look their UV map up by name
    atlas = me.uv_layers.new(name='atlas')
    me.uv_layers.active = atlas
    activate([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers[src].active_render = True
    me.uv_layers.active = me.uv_layers['atlas']
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.render.bake.margin = 6
    out = {}
    for key, kind, kw in (('n', 'NORMAL', dict(normal_space='TANGENT')), ('r', 'ROUGHNESS', {}), ('ao', 'AO', {})):
        img = bpy.data.images.new('bake_' + key, size, size, alpha=False, float_buffer=(key != 'c'))
        if key != 'c':
            img.colorspace_settings.name = 'Non-Color'
        for ms in ob.material_slots:
            n = ms.material.node_tree.nodes.new('ShaderNodeTexImage')
            n.image = img
            ms.material.node_tree.nodes.active = n
        activate([ob])
        bpy.ops.object.bake(type=kind, use_clear=True, target='IMAGE_TEXTURES', **kw)
        a = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(a)
        out[key] = a.reshape(size, size, 4)
    out['m'] = bake_metal(ob, size)
    out['c'] = bake_metal(ob, size, 'Base Color')  # DIFFUSE is black on metallic surfaces
    me.uv_layers.remove(me.uv_layers[src])
    orm = np.dstack([out['ao'][..., 0], out['r'][..., 0], out['m'][..., 0], np.ones((size, size))])
    return out['c'], out['n'], orm


# ---------- kitbashing: new parts added to a scanned model before it is baked ----------
def steel_mat():
    m = bpy.data.materials.new('steel')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.16, 0.16, 0.17, 1)  # blued steel
    b.inputs['Metallic'].default_value = 0.9
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 80
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value = 0.25, 0.55
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], b.inputs['Roughness'])
    return m


def flat_mat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def ph_mat(name, setname, scale=4.0, tint=None):
    """a photo-scanned set on box projection in object space (objects carry identity transforms here)"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])

    def img(fn, color=True):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(os.path.join(PH, setname, fn))
        n.projection = 'BOX'
        n.projection_blend = 0.3
        if not color:
            n.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n
    d = img('diff.jpg')
    if tint:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        nt.links.new(d.outputs['Color'], mix.inputs['A'])
        mix.inputs['B'].default_value = (*tint, 1)
        nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    else:
        nt.links.new(d.outputs['Color'], b.inputs['Base Color'])
    arm = img('arm.jpg', False)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(arm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    return m


def new_part(name, mesh_fn, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.object.select_all(action='DESELECT')
    mesh_fn()
    o = bpy.context.active_object
    o.name = name
    o.location, o.rotation_euler, o.scale = loc, rot, scale
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.materials.clear()
    o.data.materials.append(mat)
    for poly in o.data.polygons:
        poly.use_smooth = True
    return o


def cyl_x(name, r, x0, x1, z, mat, y=0.0, seg=20, rz=None):
    """cylinder along x (rz: separate z radius for oval sections)"""
    return new_part(name, lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=1, depth=1),
                    mat, loc=((x0 + x1) / 2, y, z), rot=(0, math.pi / 2, 0), scale=(rz or r, r, x1 - x0))


def box(name, size, c, mat, bevel=0.0):
    o = new_part(name, lambda: bpy.ops.mesh.primitive_cube_add(size=1), mat, loc=c, scale=size)
    if bevel:
        mod = o.modifiers.new('bev', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        activate([o])
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in o.data.polygons:
        poly.use_smooth = False
    return o


def cut(o, x0=None, x1=None, cap=None):
    """keep x0 <= x <= x1 of a mesh; cap (a material) closes the cut faces"""
    me = o.data
    if cap is not None:
        me.materials.append(cap)
        ci = len(me.materials) - 1
    bm = bmesh.new()
    bm.from_mesh(me)
    for px, outer in ((x0, False), (x1, True)):
        if px is None:
            continue
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(px, 0, 0), plane_no=(1, 0, 0),
                                     clear_inner=not outer, clear_outer=outer)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
        if cap is not None and edges:
            for f in bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']:
                f.material_index = ci
                f.normal_update()
                if (f.normal.x > 0) != outer:
                    f.normal_flip()
                f.smooth = False
    bm.to_mesh(me)
    bm.free()


def build_shotgun(obs):
    """the rifle cut down behind a short 12-gauge barrel, with a steel band over the cut forestock"""
    main = next(o for o in obs if o.name == 'bolt_action_rifle_7_62')
    steel = steel_mat()
    cut(main, x1=0.218, cap=flat_mat('endgrain', (0.23, 0.12, 0.06)))
    cyl_x('barrel', 0.0125, 0.06, 0.44, 0.060, steel)
    cyl_x('muzzle', 0.0137, 0.424, 0.444, 0.060, steel)
    box('band', (0.018, 0.029, 0.051), (0.214, 0, 0.0495), steel, bevel=0.003)
    box('band2', (0.012, 0.028, 0.05), (0.07, 0, 0.0495), steel, bevel=0.003)
    new_part('bead', lambda: bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.003), steel, loc=(0.436, 0, 0.074))


def build_pipe(obs):
    """a home-made pipe rifle: the rifle's butt stock and a piece of its forestock, rusty pipes, tape"""
    main = next(o for o in obs if o.name == 'bolt_action_rifle_7_62')
    hg = main.copy()
    hg.data = main.data.copy()
    hg.name = 'handguard'
    bpy.context.scene.collection.objects.link(hg)
    steel, rust = steel_mat(), ph_mat('rustpipe', 'rust_coarse_01', scale=5)
    tape = ph_mat('tape', 'hessian_230', scale=7, tint=(0.36, 0.34, 0.31))
    cut(main, x1=-0.245, cap=flat_mat('cutsteel', (0.12, 0.115, 0.11), 0.5, 1.0))
    cut(hg, x0=0.07, x1=0.30, cap=flat_mat('endgrain', (0.23, 0.12, 0.06)))
    cyl_x('receiver', 0.019, -0.33, -0.02, 0.043, rust)
    cyl_x('reducer', 0.015, -0.035, 0.012, 0.050, rust)
    cyl_x('barrel', 0.0105, 0.0, 0.47, 0.056, rust)
    cyl_x('muzzle', 0.0125, 0.45, 0.472, 0.056, rust)
    for x in (0.105, 0.265):
        cyl_x('tape', 0.0145, x - 0.014, x + 0.014, 0.0455, tape, rz=0.0245)
    box('mag', (0.036, 0.019, 0.095), (-0.15, 0, -0.008), rust, bevel=0.003)
    box('rsight', (0.012, 0.014, 0.014), (-0.25, 0, 0.066), steel)
    box('fsight', (0.008, 0.004, 0.016), (0.462, 0, 0.071), steel)
    new_part('bolt', lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.005, depth=0.04), steel, loc=(-0.2, -0.035, 0.048), rot=(math.pi / 2, 0, 0))
    new_part('knob', lambda: bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.009), steel, loc=(-0.2, -0.057, 0.048))


BUILDS = {'shotgun': build_shotgun, 'pipe': build_pipe}


def bake_metal(ob, size, input_name='Metallic'):
    """bake one Principled input through an emission shader (EMIT pass): metalness has no bake pass of its
    own, and base colour is baked this way too because the DIFFUSE pass is black on metallic surfaces"""
    img = bpy.data.images.new('bake_' + input_name, size, size, alpha=False, float_buffer=(input_name != 'Base Color'))
    if input_name != 'Base Color':
        img.colorspace_settings.name = 'Non-Color'
    undo = []
    for ms in ob.material_slots:
        nt = ms.material.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        outn = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        em = nt.nodes.new('ShaderNodeEmission')
        mi = bsdf.inputs[input_name]
        if mi.is_linked:
            nt.links.new(mi.links[0].from_socket, em.inputs['Color'])
        else:
            v = mi.default_value
            em.inputs['Color'].default_value = tuple(v) if input_name == 'Base Color' else (v, v, v, 1)
        old = outn.inputs['Surface'].links[0].from_socket if outn.inputs['Surface'].is_linked else None
        nt.links.new(em.outputs['Emission'], outn.inputs['Surface'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.nodes.active = tn
        undo.append((nt, outn, old, em))
    activate([ob])
    bpy.ops.object.bake(type='EMIT', use_clear=True, target='IMAGE_TEXTURES')
    for nt, outn, old, em in undo:
        if old is not None:
            nt.links.new(old, outn.inputs['Surface'])
        nt.nodes.remove(em)
    a = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(size, size, 4)


def process(name, pid, budget, opt):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    g = glob.glob(os.path.join(SRC, pid, '*.gltf'))[0]
    bpy.ops.import_scene.gltf(filepath=g)
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    # bake object transforms into the meshes
    activate(obs)
    for o in obs:
        o.parent = None
    bpy.context.view_layer.update()
    for o in obs:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    if opt.get('drop'):
        for o in obs:
            if any(opt['drop'] in (m.name if m else '') for m in o.data.materials):
                bpy.data.objects.remove(o, do_unlink=True)
        obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if opt.get('keep_suffix') or opt.get('keep_names'):  # the scan holds several copies: keep one
        keep = [o for o in obs if (opt.get('keep_suffix') and o.name.endswith(opt['keep_suffix'])) or o.name in opt.get('keep_names', [])]
        for o in obs:
            if o not in keep:
                bpy.data.objects.remove(o, do_unlink=True)
        obs = keep
    if opt.get('build'):
        BUILDS[opt['build']](obs)
        obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    trig = None
    if opt.get('gun'):
        tv = [v.co for o in obs if 'trigger' in o.name for v in o.data.vertices]
        trig = Vector(tuple((min(v[i] for v in tv) + max(v[i] for v in tv)) / 2 for i in range(3)))
    lid = None
    if opt.get('lid'):
        lids = [o for o in obs if opt['lid'] in o.name.lower()]
        if lids:
            activate(lids)
            if len(lids) > 1:
                bpy.ops.object.join()
            lid = bpy.context.view_layer.objects.active
            obs = [o for o in obs if o not in lids]
    activate(obs)
    if len(obs) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    parts = [p for p in (body, lid) if p]
    # orientation, grounding, scale
    R = Matrix.Identity(4)
    if opt.get('rot'):
        r = [math.radians(a) for a in opt['rot']]
        R = (Matrix.Rotation(r[2], 4, 'Z') @ Matrix.Rotation(r[1], 4, 'Y') @ Matrix.Rotation(r[0], 4, 'X'))
    for p in parts:
        p.data.transform(R)
    allv = [v.co for p in parts for v in p.data.vertices]
    lo = Vector((min(v.x for v in allv), min(v.y for v in allv), min(v.z for v in allv)))
    hi = Vector((max(v.x for v in allv), max(v.y for v in allv), max(v.z for v in allv)))
    s = opt.get('scale', 1.0)
    if opt.get('tool'):
        # hang the tool from its grip: longest axis -> down (-z, the game's -y), head at the bottom,
        # blade / striking face toward -y (the game's +z). The grip sits 12% along from the handle end.
        ext = hi - lo
        axis = max(range(3), key=lambda i: ext[i])
        vs = np.array([[v.x, v.y, v.z] for v in allv])
        c = (vs.min(0) + vs.max(0)) / 2
        along = vs[:, axis] - c[axis]
        # the head is the heavier end: more spread across the other two axes
        others = [i for i in range(3) if i != axis]
        spread = lambda m: np.ptp(vs[m][:, others], axis=0).sum() if m.sum() > 3 else 0
        top_is_head = spread(along > 0.3 * ext[axis]) > spread(along < -0.3 * ext[axis])
        if opt.get('flip'):  # a thin blade spreads less than its handle
            top_is_head = not top_is_head
        M = Matrix.Identity(4)
        if axis == 0:
            M = Matrix.Rotation(math.radians(90 if top_is_head else -90), 4, 'Y')
        elif axis == 1:
            M = Matrix.Rotation(math.radians(-90 if top_is_head else 90), 4, 'X')
        elif top_is_head:
            M = Matrix.Rotation(math.pi, 4, 'X')
        T = Matrix.Translation(-Vector(c))
        for p in parts:
            p.data.transform(M @ T)
        allv = [v.co for p in parts for v in p.data.vertices]
        zmax = max(v.z for v in allv)
        zmin = min(v.z for v in allv)
        grip = zmax - (zmax - zmin) * 0.12
        # the blade / head sticks out most toward one side: turn it to face -y
        vs = np.array([[v.x, v.y, v.z] for v in allv])
        head = vs[vs[:, 2] < zmin + (zmax - zmin) * 0.25]
        if len(head):
            hx, hy = head[:, 0].mean(), head[:, 1].mean()
            ang = math.atan2(hx, -hy)  # rotate so the head's offset points along -y
            Rz = Matrix.Rotation(-ang, 4, 'Z') if abs(hx) + abs(hy) > 0.005 else Matrix.Identity(4)
        else:
            Rz = Matrix.Identity(4)
        for p in parts:
            p.data.transform(Rz @ Matrix.Translation(Vector((0, 0, -grip))))
    elif opt.get('gun'):
        # barrel +x -> -y (the game's +z), top stays +z; origin 4 cm behind the trigger at its height (the grip)
        T = Matrix.Rotation(math.radians(-90), 4, 'Z') @ Matrix.Translation(-Vector((trig.x - 0.04, trig.y, trig.z)))
        for p in parts:
            p.data.transform(T)
    else:
        cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
        for p in parts:
            p.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-cx, -cy, -lo.z))))
    # decimate (budget shared by body and lid in proportion)
    total = sum(tris(p) for p in parts)
    for p in parts:
        if total > budget:
            activate([p])
            d = p.modifiers.new('dec', 'DECIMATE')
            d.ratio = max(0.004, budget / total)
            d.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=d.name)
        for poly in p.data.polygons:
            poly.use_smooth = True
    # textures
    mats = {m.name: m for p in parts for m in p.data.materials if m}
    if len(mats) == 1:
        c_img, n_img, r_img = material_maps(next(iter(mats.values())))
        maps = {}
        for size in (512, 256):
            maps[size] = (img_array(c_img, size), img_array(n_img, size) if n_img else None, img_array(r_img, size) if r_img else None)
    else:  # join temporarily to bake one atlas, then split the lid back out by vertex group
        for p in parts:
            p.vertex_groups.new(name='part_' + ('lid' if p is lid else 'body')).add(list(range(len(p.data.vertices))), 1.0, 'REPLACE')
        activate(parts, body)
        if len(parts) > 1:
            bpy.ops.object.join()
        c, n, orm = bake_atlas(body, 512)
        maps = {512: (c, n, orm), 256: None}
        if lid:
            activate([body])
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='DESELECT')
            body.vertex_groups.active_index = body.vertex_groups['part_lid'].index
            bpy.ops.object.vertex_group_select()
            bpy.ops.mesh.separate(type='SELECTED')
            bpy.ops.object.mode_set(mode='OBJECT')
            lid = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o is not body][0]
            parts = [body, lid]
    for size in (512, 256):
        if maps.get(size) is None:
            src = maps[512]
            maps[size] = tuple(None if a is None else a.reshape(256, 2, 256, 2, 4).mean(axis=(1, 3)) for a in src)
        c, n, r = maps[size]
        c = c.copy()
        c[..., 3] = 1
        save_png(c, os.path.join(TEXOUT, f'prop_{name}_c_{size}.png'))
        if n is not None:
            save_png(n, os.path.join(TEXOUT, f'prop_{name}_n_{size}.png'))
        if r is not None:
            r = r.copy()
            r[..., 3] = 1
            save_png(r, os.path.join(TEXOUT, f'prop_{name}_orm_{size}.png'))
    # export
    for p in parts:
        p.name = 'lid' if p is lid else 'body'
        p.data.materials.clear()
        for vg in list(p.vertex_groups):
            p.vertex_groups.remove(vg)
    activate(parts, body)
    path = os.path.join(OUT, f'prop_{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_materials='NONE', export_normals=True, export_texcoords=True, export_yup=True)
    allv = [p.matrix_world @ v.co for p in parts for v in p.data.vertices]
    size3 = [round(max(v[i] for v in allv) - min(v[i] for v in allv), 3) for i in range(3)]
    report[name] = dict(src=pid, tris=sum(tris(p) for p in parts), lid=bool(lid), size_blender_xyz=size3, orm=maps[512][2] is not None, normal=maps[512][1] is not None)
    print('PROP', name, report[name], flush=True)


for name, (pid, budget, opt) in PROPS.items():
    if ONLY and name not in ONLY:
        continue
    if not glob.glob(os.path.join(SRC, pid, '*.gltf')):
        print('MISSING', name, pid)
        continue
    process(name, pid, budget, opt)
json.dump(report, open(os.path.join(OUT, 'props_report.json'), 'w'), indent=1)

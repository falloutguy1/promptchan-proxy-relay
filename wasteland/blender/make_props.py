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
}
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
    src_uv = me.uv_layers[0]
    src_uv.name = 'src'
    atlas = me.uv_layers.new(name='atlas')
    me.uv_layers.active = atlas
    activate([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    src_uv.active_render = True
    me.uv_layers.active = atlas
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.render.bake.margin = 6
    out = {}
    for key, kind, kw in (('c', 'DIFFUSE', dict(pass_filter={'COLOR'})), ('n', 'NORMAL', dict(normal_space='TANGENT')), ('r', 'ROUGHNESS', {}), ('ao', 'AO', {})):
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
    me.uv_layers.remove(src_uv)
    orm = np.dstack([out['ao'][..., 0], out['r'][..., 0], np.zeros((size, size)), np.ones((size, size))])
    return out['c'], out['n'], orm


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

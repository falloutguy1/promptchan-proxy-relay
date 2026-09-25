# Blender 4.5 (headless): the building and street kits, built from Poly Haven (CC0) glTF models.
#   blender -b --factory-startup --python make_kit.py -- SRC_DIR OUT_MODELS OUT_TEX
# Each kit is several pieces sharing one baked texture atlas, so everything of a kit placed in a
# chunk of the world merges into one draw call:
#   kitw  wall pieces: fire-escape levels, air-con unit, roller shutters, downpipe parts, wall lamp
#   kits  street pieces: lamp post, fire hydrant, utility box, manhole cover, power poles, stone fire pit
# Pieces are exported as nodes of kitw.glb / kits.glb with their origin at the anchor the game uses:
# wall pieces touch the wall at z=0 and stick out toward +z (Blender -y), standing pieces sit on the
# ground at the origin. The atlas is saved as KIT_{c,n,orm}_{1024,512}.png.
import bpy, bmesh, os, sys, math, glob, json
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, TEXOUT = (os.path.abspath(a) for a in ARGS[:3])
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEXOUT, exist_ok=True)
report = {}


def activate(obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def load(pid):
    """import a Poly Haven glTF; returns {object name: object} with transforms baked into the meshes"""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glob.glob(os.path.join(SRC, pid, '*.gltf'))[0])
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        o.parent = None
    bpy.context.view_layer.update()
    out = {}
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        o.data = o.data.copy()  # instanced meshes must not share data once transformed
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        out[o.name.strip()] = o  # some Poly Haven node names carry a trailing space
    return out


def pick(objs, names):
    """keep the named objects (joined into one), delete the rest"""
    keep = [objs[n] for n in names]
    for n, o in objs.items():
        if n not in names:
            bpy.data.objects.remove(o, do_unlink=True)
    activate(keep)
    if len(keep) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def join(parts, name):
    activate(parts)
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


def bbox(o):
    v = np.array([list(x.co) for x in o.data.vertices])
    return v.min(0), v.max(0)


def move(o, d):
    o.data.transform(Matrix.Translation(Vector(d)))


def keep_z(o, z0=None, z1=None):
    """cut a mesh to z0 <= z <= z1"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for pz, outer in ((z0, False), (z1, True)):
        if pz is not None:
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, pz), plane_no=(0, 0, 1), clear_inner=not outer, clear_outer=outer)
    bm.to_mesh(o.data)
    bm.free()


def decimate(o, budget):
    t = tris(o)
    if t > budget:
        activate([o])
        d = o.modifiers.new('dec', 'DECIMATE')
        d.ratio = max(0.004, budget / t)
        d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=d.name)
    else:  # triangulate anyway so the report counts what the game draws
        activate([o])
        m = o.modifiers.new('tri', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=m.name)


def anchor_wall(o, zmode='bottom'):
    """wall piece: centred on x, back face at y=0 (sticks out to -y = the game's +z), bottom (or centre/top) at z=0"""
    lo, hi = bbox(o)
    z = lo[2] if zmode == 'bottom' else hi[2] if zmode == 'top' else (lo[2] + hi[2]) / 2
    move(o, (-(lo[0] + hi[0]) / 2, -hi[1], -z))


def anchor_ground(o, ztop=False):
    lo, hi = bbox(o)
    move(o, (-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -(hi[2] if ztop else lo[2])))


# ---------------- atlas baking (several objects -> one texture set) ----------------
def emit_setup(mat, input_name):
    """route one Principled input to an emission shader (baked with EMIT): base colour, because the DIFFUSE pass
    is black on metallic surfaces, and metalness, which has no bake pass of its own"""
    nt = mat.node_tree
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
    return (nt, outn, old, em)


def bake_kit(objs, size, margin=0.004):
    """shared atlas UVs over all objects, then colour / normal / roughness / AO / metal bakes"""
    src = {}
    for o in objs:  # the source UV map keeps its name: the imported normal-map nodes look it up by name
        me = o.data
        src[o.name] = me.uv_layers[0].name
        me.uv_layers.new(name='atlas')
        me.uv_layers.active = me.uv_layers['atlas']
        me.uv_layers[src[o.name]].active_render = True
    activate(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.uv.pack_islands(margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    # spread the pieces apart so baked AO only sees each piece's own geometry
    for i, o in enumerate(objs):
        o.location.x += i * 40.0
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 8
    sc.render.bake.margin = 4
    mats = {m for o in objs for m in o.data.materials if m}
    out = {}
    for key, kind, kw in (('c', 'EMIT', {}), ('n', 'NORMAL', dict(normal_space='TANGENT')),
                          ('r', 'ROUGHNESS', {}), ('ao', 'AO', {}), ('m', 'EMIT', {})):
        img = bpy.data.images.new('bake_' + key, size, size, alpha=False, float_buffer=(key != 'c'))
        if key != 'c':
            img.colorspace_settings.name = 'Non-Color'
        undo = [emit_setup(m, 'Base Color' if key == 'c' else 'Metallic') for m in mats] if kind == 'EMIT' else []
        for m in mats:
            n = m.node_tree.nodes.new('ShaderNodeTexImage')
            n.image = img
            m.node_tree.nodes.active = n
        activate(objs)
        bpy.ops.object.bake(type=kind, use_clear=True, target='IMAGE_TEXTURES', **kw)
        for nt, outn, old, em in undo:
            if old is not None:
                nt.links.new(old, outn.inputs['Surface'])
            nt.nodes.remove(em)
        a = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(a)
        out[key] = a.reshape(size, size, 4)
    for i, o in enumerate(objs):
        o.location.x -= i * 40.0
        o.data.uv_layers.remove(o.data.uv_layers[src[o.name]])
    orm = np.dstack([out['ao'][..., 0], out['r'][..., 0], out['m'][..., 0], np.ones((size, size))])
    return out['c'], out['n'], orm


def save_png(a, path):
    im = bpy.data.images.new('o', a.shape[1], a.shape[0], alpha=True)
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def finish(kit, pieces, size=1024):
    objs = list(pieces.values())
    for name, o in pieces.items():
        o.name = name
        for p in o.data.polygons:
            p.use_smooth = True
    c, n, orm = bake_kit(objs, size)
    for sz in (size, size // 2):
        f = size // sz
        cc, nn, oo = (a.reshape(sz, f, sz, f, 4).mean(axis=(1, 3)) if f > 1 else a for a in (c, n, orm))
        cc = cc.copy()
        cc[..., 3] = 1
        save_png(cc, os.path.join(TEXOUT, f'{kit}_c_{sz}.png'))
        save_png(nn, os.path.join(TEXOUT, f'{kit}_n_{sz}.png'))
        save_png(oo, os.path.join(TEXOUT, f'{kit}_orm_{sz}.png'))
    for o in objs:
        o.data.materials.clear()
    activate(objs)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'{kit}.glb'), export_format='GLB', use_selection=True, export_materials='NONE',
                              export_normals=True, export_texcoords=True, export_yup=True)
    report[kit] = {}
    for name, o in pieces.items():
        lo, hi = bbox(o)
        report[kit][name] = dict(tris=tris(o), min=[round(float(v), 3) for v in lo], max=[round(float(v), 3) for v in hi])
        print('PIECE', kit, name, report[kit][name], flush=True)


# ---------------- wall kit ----------------
def wall_kit():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    P = {}
    # fire escape: the Poly Haven kit lies exploded along z; assemble two levels, each with its deck top at z=0,
    # the wall (the railings' back ends) at y=0. Level 1 carries the drop ladder, level 2 the stairs up from level 1.
    fe = load('modular_fire_escape')
    FH = 3.2
    WALL_Y = 0.785
    plat1, rail1, lad = fe['modular_fire_escape_platform_bottom'], fe['modular_fire_escape_railing_bottom'], fe['modular_fire_escape_ladder_bottom']
    plat2, rail2, prail, stairs = fe['modular_fire_escape_platform_middle'], fe['modular_fire_escape_railing_middle'], fe['modular_fire_escape_platform_railing'], fe['modular_fire_escape_stairs']
    move(plat1, (0, 0, -bbox(plat1)[1][2]))
    move(rail1, (0, 0, -bbox(rail1)[0][2]))
    lz = bbox(lad)[1][2]
    keep_z(lad, z0=lz - 2.2)  # a drop ladder hooked over the railing, its foot out of reach 2 m up
    lo, hi = bbox(lad)
    move(lad, (1.8 - (lo[0] + hi[0]) / 2, -0.06, 1.0 - hi[2]))
    top2 = bbox(plat2)[1][2]
    r2 = bbox(rail2)[0][2]
    move(plat2, (0, 0, -top2))
    move(rail2, (0, 0, -r2))
    move(prail, (0, 0, -r2))
    st = bbox(stairs)[1][2]
    stairs.data.transform(Matrix.Scale(FH / (bbox(stairs)[1][2] - bbox(stairs)[0][2]), 4, Vector((0, 0, 1))) @ Matrix.Translation(Vector((0, 0, -st))))
    for o in fe.values():
        move(o, (0, -WALL_Y, 0))
    P['fe1'] = join([plat1, rail1, lad], 'fe1')
    P['fe2'] = join([plat2, rail2, prail, stairs], 'fe2')
    decimate(P['fe1'], 1500)
    decimate(P['fe2'], 2600)
    ac = load('exterior_aircon_unit')
    P['ac'] = pick(ac, ['exterior_aircon_unit_rusted'])
    anchor_wall(P['ac'])
    decimate(P['ac'], 700)
    for pid, key in (('rollershutter_door', 'shutd'), ('rollershutter_window_02', 'shutw')):
        objs = load(pid)
        plain, graf = objs[pid], objs[pid + '_graffiti']
        anchor_wall(plain)
        anchor_wall(graf)
        P[key], P[key + '_g'] = plain, graf
    gut = load('modular_metal_gutter')
    sec, fun, outl = gut['modular_metal_gutter_section'], gut['modular_metal_gutter_funnel'], gut['modular_metal_gutter_outlet']
    for n, o in gut.items():
        if o not in (sec, fun, outl):
            bpy.data.objects.remove(o, do_unlink=True)
    # downpipe parts on a common axis 0.12 m off the wall: a 1 m section (the game stretches it), the hopper on top, the shoe below
    for o, zm in ((sec, 'bottom'), (fun, 'bottom'), (outl, 'top')):
        lo, hi = bbox(o)
        move(o, (-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2 - 0.12, -(lo[2] if zm == 'bottom' else hi[2])))
    P['pipe'], P['pipe_top'], P['pipe_bot'] = sec, fun, outl
    decimate(sec, 120)
    decimate(fun, 300)
    decimate(outl, 260)
    sl = load('security_light')
    P['seclight'] = join(list(sl.values()), 'seclight')
    anchor_wall(P['seclight'], 'centre')
    decimate(P['seclight'], 500)
    finish('kitw', P)


# ---------------- street kit ----------------
def street_kit():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    P = {}
    P['lamp'] = pick(load('street_lamp_01'), ['street_lamp_01'])
    anchor_ground(P['lamp'])
    decimate(P['lamp'], 1000)
    P['hydrant'] = pick(load('fire_hydrant'), ['fire_hydrant_aged', 'fire_hydrant_cap_01_aged', 'fire_hydrant_cap_02_aged', 'fire_hydrant_cap_03_aged'])
    anchor_ground(P['hydrant'])
    decimate(P['hydrant'], 900)
    P['ubox'] = pick(load('utility_box_02'), ['utility_box_02'])
    anchor_ground(P['ubox'])
    decimate(P['ubox'], 500)
    P['manhole'] = pick(load('water_manhole_cover'), ['water_manhole_cover', 'water_manhole_cover_frame'])
    anchor_ground(P['manhole'], ztop=True)
    decimate(P['manhole'], 300)
    poles = load('modular_electricity_poles')
    for key, pre in (('pole', 'preset_02_'), ('pole2', 'preset_01_')):
        parts = [o for n, o in poles.items() if n.startswith(pre)]
        P[key] = join(parts, key)
        anchor_ground(P[key])
        decimate(P[key], 1500)
    for n, o in poles.items():
        if not n.startswith('preset_0') and o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)
    P['firepit'] = pick(load('stone_fire_pit'), ['stone_fire_pit'])
    anchor_ground(P['firepit'])
    decimate(P['firepit'], 900)
    finish('kits', P)


wall_kit()
street_kit()
json.dump(report, open(os.path.join(OUT, 'kit_report.json'), 'w'), indent=1)

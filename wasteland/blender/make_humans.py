# Blender 4.5 + MPFB 2 (headless): build the game's human characters from MakeHuman (CC0) assets and
# re-rig them onto the game's 17-joint procedural skeleton.
#   blender -b --python make_humans.py -- KIND OUT_MODELS OUT_TEX
# KIND: survivor | raider | trader | ghoul
# Steps: MakeHuman body + clothes + hair + eyes with MPFB's game-engine rig -> arms posed straight down
# (the game's rest pose) -> modifiers applied -> scaled so the hip joints sit at the game's height ->
# decimated -> one atlas (colour + normal) baked from the MakeHuman materials -> per-character paint
# (vault suit, grime, ghoul skin) -> 53 MPFB bones merged into the game's joints -> GLB with skin.
import bpy, bmesh, os, sys, math, json
import numpy as np
from mathutils import Vector, Matrix
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

ARGS = sys.argv[sys.argv.index('--') + 1:]
KIND, OUT, TEXOUT = ARGS[0], os.path.abspath(ARGS[1]), os.path.abspath(ARGS[2])
ATLAS = int(ARGS[3]) if len(ARGS) > 3 else 1024
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEXOUT, exist_ok=True)
U = LocationService.get_user_data()
HIP_Y = 0.93  # game: hip joints at hips(0.98) - 0.05

CHARS = {
    'survivor': dict(macro=dict(gender=1.0, age=0.42, muscle=0.62, weight=0.48, proportions=0.7, height=0.62, race=(0.1, 0.8, 0.1)),
                     skin='young_caucasian_male', clothes=['matcreator_mc-skinsuit_2022', 'shoes03'], hair='short02',
                     budget={'suit': 3600, 'shoes': 900, 'hair': 1300, 'body': 2600}),
    'raider': dict(macro=dict(gender=1.0, age=0.5, muscle=0.85, weight=0.62, proportions=0.6, height=0.68, race=(0.15, 0.7, 0.15)),
                   skin='middleage_caucasian_male', clothes=['male_casualsuit05', 'shoes03'], hair='short01',
                   budget={'suit': 3000, 'shoes': 900, 'hair': 1100, 'body': 2600}),
    'trader': dict(macro=dict(gender=1.0, age=0.72, muscle=0.5, weight=0.62, proportions=0.55, height=0.6, race=(0.2, 0.5, 0.3)),
                   skin='old_african_male', clothes=['male_casualsuit01', 'shoes03', 'fedora01'], hair=None,
                   budget={'suit': 3600, 'shoes': 900, 'hat': 500, 'body': 2600}),
    'ghoul': dict(macro=dict(gender=1.0, age=0.85, muscle=0.25, weight=0.05, proportions=0.4, height=0.6, race=(0.2, 0.6, 0.2)),
                  skin='old_caucasian_male', clothes=['cortu_cargo_pants'], hair=None,
                  budget={'suit': 400, 'body': 6000}),
}
SPEC = CHARS[KIND]

# game joint <- MPFB game_engine bones (weights are summed)
FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']
JOINT_MAP = {
    'hips': ['pelvis', 'Root'], 'spine': ['spine_01', 'spine_02'], 'chest': ['spine_03', 'clavicle_l', 'clavicle_r'],
    'neck': ['neck_01'], 'head': ['head'],
}
for side, s in (('r', 'r'), ('l', 'l')):
    JOINT_MAP['sh_' + side] = ['upperarm_' + s]
    JOINT_MAP['el_' + side] = ['lowerarm_' + s]
    JOINT_MAP['hand_' + side] = ['hand_' + s] + [f'{f}_0{i}_{s}' for f in FINGERS for i in (1, 2, 3)]
    JOINT_MAP['hip_' + side] = ['thigh_' + s]
    JOINT_MAP['kn_' + side] = ['calf_' + s]
    JOINT_MAP['an_' + side] = ['foot_' + s, 'ball_' + s]
JOINT_HEAD = {'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_03', 'neck': 'neck_01', 'head': 'head'}
for side in ('r', 'l'):
    JOINT_HEAD.update({'sh_' + side: 'upperarm_' + side, 'el_' + side: 'lowerarm_' + side, 'hand_' + side: 'hand_' + side,
                       'hip_' + side: 'thigh_' + side, 'kn_' + side: 'calf_' + side, 'an_' + side: 'foot_' + side})
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
for side in ('r', 'l'):
    PARENT.update({'sh_' + side: 'chest', 'el_' + side: 'sh_' + side, 'hand_' + side: 'el_' + side,
                   'hip_' + side: 'hips', 'kn_' + side: 'hip_' + side, 'an_' + side: 'kn_' + side})
JOINTS = list(PARENT.keys())


def mhclo_in(d):
    return os.path.join(d, next(f for f in os.listdir(d) if f.endswith('.mhclo')))


def mhmat_in(d):
    return os.path.join(d, next(f for f in os.listdir(d) if f.endswith('.mhmat')))


def activate(ob):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------- 1. MakeHuman character
bpy.ops.wm.read_factory_settings(use_empty=True)
m = SPEC['macro']
macro = {k: m[k] for k in ('gender', 'age', 'muscle', 'weight', 'proportions', 'height')}
macro.update(cupsize=0.5, firmness=0.5, race={'asian': m['race'][0], 'caucasian': m['race'][1], 'african': m['race'][2]})
body = HumanService.create_human(mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True, feet_on_ground=False, scale=0.1, macro_detail_dict=macro)  # MPFB fits the rig to the un-grounded mesh
rig = HumanService.add_builtin_rig(body, 'game_engine')
parts = {'body': body}
for c in SPEC['clothes']:
    o = HumanService.add_mhclo_asset(mhclo_in(os.path.join(U, 'clothes', c)), body, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
    key = 'shoes' if c.startswith('shoes') else 'hat' if c.startswith('fedora') else 'suit'
    parts[key] = o
if SPEC['hair']:
    parts['hair'] = HumanService.add_mhclo_asset(mhclo_in(os.path.join(U, 'hair', SPEC['hair'])), body, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN')
parts['eyes'] = HumanService.add_mhclo_asset(mhclo_in(os.path.join(U, 'eyes', 'low-poly')), body, asset_type='Eyes', subdiv_levels=0, material_type='MAKESKIN')
HumanService.set_character_skin(mhmat_in(os.path.join(U, 'skins', SPEC['skin'])), body, skin_type='MAKESKIN')
bpy.context.view_layer.update()
print('BUILT', {k: tris(o) for k, o in parts.items()}, flush=True)

# ---------------------------------------------------------------- 2. arms straight down (the game's rest pose)
activate(rig)
bpy.ops.object.mode_set(mode='POSE')


def aim(name, direction):
    bpy.context.view_layer.update()
    pb = rig.pose.bones[name]
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(Vector(direction).normalized())
    mat = pb.matrix.copy()
    loc = pb.head.copy()
    pb.matrix = Matrix.Translation(loc) @ q.to_matrix().to_4x4() @ Matrix.Translation(-loc) @ mat
    bpy.context.view_layer.update()


for s, sx in (('l', 1), ('r', -1)):
    aim('upperarm_' + s, (0.075 * sx, 0.0, -1.0))
    aim('lowerarm_' + s, (0.03 * sx, -0.02, -1.0))
    aim('hand_' + s, (0.0, -0.03, -1.0))
bpy.ops.object.mode_set(mode='OBJECT')

# bake the pose (and MPFB's helper / hidden-body masks) into the meshes, then make it the rest pose
for key, o in parts.items():
    activate(o)
    if o.data.shape_keys:  # MPFB keeps the body shape as shape keys: freeze the mix first
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
activate(rig)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()

# world-space joint positions, then free the meshes from the MPFB armature
heads = {j: (rig.matrix_world @ rig.data.bones[b].head_local).copy() for j, b in JOINT_HEAD.items()}
eye_obj = parts['eyes']
for o in parts.values():
    activate(o)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.context.view_layer.update()

# ground and scale: soles on z = 0, hip joints at the game's height
zmin = min(min(v.co.z for v in o.data.vertices) for o in parts.values())
hip_z = (heads['hip_l'].z + heads['hip_r'].z) * 0.5 - zmin
S = HIP_Y / hip_z
for o in parts.values():
    for v in o.data.vertices:
        v.co = Vector((v.co.x * S, v.co.y * S, (v.co.z - zmin) * S))
    o.data.update()
for j in heads:
    h = heads[j]
    heads[j] = Vector((h.x * S, h.y * S, (h.z - zmin) * S))
ev = [v.co for v in eye_obj.data.vertices]
eye_l = sum((c for c in ev if c.x > 0), Vector()) / max(1, sum(1 for c in ev if c.x > 0))
eye_r = sum((c for c in ev if c.x <= 0), Vector()) / max(1, sum(1 for c in ev if c.x <= 0))
print('SCALE', round(S, 3), 'height', round(max(max(v.co.z for v in o.data.vertices) for o in parts.values()), 3), flush=True)

# body skin that pokes through the clothes: drop body faces lying just under a garment
from mathutils.bvhtree import BVHTree
cover = [parts[k] for k in ('suit', 'shoes') if k in parts]
if cover:
    trees = []
    for o in cover:
        bm_ = bmesh.new()
        bm_.from_mesh(o.data)
        trees.append(BVHTree.FromBMesh(bm_))
        bm_.free()
    bm_ = bmesh.new()
    bm_.from_mesh(body.data)
    bm_.normal_update()
    hidden = set()
    for v in bm_.verts:  # covered = a garment lies just outside the skin along its normal
        for t in trees:
            if t.ray_cast(v.co + v.normal * 0.001, v.normal, 0.035)[0] is not None:
                hidden.add(v.index)
                break
    bm_.verts.ensure_lookup_table()
    doomed = [f for f in bm_.faces if all(v.index in hidden for v in f.verts)]
    bmesh.ops.delete(bm_, geom=doomed, context='FACES')
    bm_.to_mesh(body.data)
    bm_.free()
    print('HIDDEN body faces removed', len(doomed), flush=True)
# the bodysuit has feet that poke through the boots: cut it off inside the boot shaft
if 'shoes' in parts and 'suit' in parts:
    o = parts['suit']
    activate(o)
    bm_ = bmesh.new()
    bm_.from_mesh(o.data)
    cut = [f for f in bm_.faces if f.calc_center_median().z < 0.1]
    bmesh.ops.delete(bm_, geom=cut, context='FACES')
    bm_.to_mesh(o.data)
    bm_.free()
# ---------------------------------------------------------------- 3. decimate to the triangle budget
for key, o in parts.items():
    b = SPEC['budget'].get(key)
    if not b or tris(o) <= b:
        continue
    activate(o)
    d = o.modifiers.new('dec', 'DECIMATE')
    d.ratio = b / tris(o)
    d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=d.name)
print('DECIMATED', {k: tris(o) for k, o in parts.items()}, flush=True)

# ---------------------------------------------------------------- 4. one mesh, one atlas
SKIN_MATS = set()
for key, o in parts.items():
    uv = o.data.uv_layers[0]
    uv.name = 'orig'
    o.data.uv_layers.new(name='atlas')
    for ms in o.material_slots:
        ms.material['part'] = key
        if key in ('body', 'eyes'):
            SKIN_MATS.add(ms.material.name)
bpy.ops.object.select_all(action='DESELECT')
for o in parts.values():
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
char = body
char.name = 'char_' + KIND
me = char.data
me.uv_layers.active = me.uv_layers['atlas']
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
bm = bmesh.from_edit_mesh(me)
uvl = bm.loops.layers.uv['atlas']
skin_idx = {i for i, ms in enumerate(char.material_slots) if ms.material and ms.material.get('part') in ('body', 'eyes')}
for f in bm.faces:  # faces and hands get more texels than clothes
    for lp in f.loops:
        lp[uvl].select = True
        lp[uvl].select_edge = True
        if f.material_index in skin_idx:
            lp[uvl].uv *= 1.7
bmesh.update_edit_mesh(me)
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- 5. bake colour, normal, alpha, part id and position
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 4
sc.render.bake.margin = 6
me.uv_layers['orig'].active_render = True
me.uv_layers.active = me.uv_layers['atlas']


def new_img(name, float_buf=False, alpha=True):
    im = bpy.data.images.new(name, ATLAS, ATLAS, alpha=alpha, float_buffer=float_buf)
    im.colorspace_settings.name = 'Non-Color' if float_buf else 'sRGB'
    return im


def set_target(img):
    for ms in char.material_slots:
        nt = ms.material.node_tree
        n = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'BAKE_TARGET'
        n.image = img
        nt.nodes.active = n


def bake(kind, img, **kw):
    set_target(img)
    activate(char)
    bpy.ops.object.bake(type=kind, use_clear=True, target='IMAGE_TEXTURES', **kw)


def arr(img):
    a = np.empty(ATLAS * ATLAS * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(ATLAS, ATLAS, 4)


img_col = new_img('col')
bake('DIFFUSE', img_col, pass_filter={'COLOR'})
img_nrm = new_img('nrm', alpha=False)
img_nrm.colorspace_settings.name = 'Non-Color'
bake('NORMAL', img_nrm, normal_space='TANGENT')

# temporary emission graphs for data passes
saved = {}


def emit_graph(builder):
    for ms in char.material_slots:
        mat = ms.material
        nt = mat.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        if mat.name not in saved:
            saved[mat.name] = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
        em = nt.nodes.get('EMIT_TMP') or nt.nodes.new('ShaderNodeEmission')
        em.name = 'EMIT_TMP'
        for l in list(em.inputs['Color'].links):
            nt.links.remove(l)
        builder(mat, nt, em)
        nt.links.new(em.outputs[0], out.inputs['Surface'])


def alpha_builder(mat, nt, em):
    tex = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.name == 'diffuseTexture'), None)
    if tex is not None and tex.image and tex.image.alpha_mode != 'NONE' and mat.get('part') in ('hair', 'shoes', 'hat', 'suit'):
        nt.links.new(tex.outputs['Alpha'], em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (1, 1, 1, 1)


PART_IDS = {'body': 0.1, 'eyes': 0.2, 'suit': 0.3, 'shoes': 0.4, 'hair': 0.5, 'hat': 0.6}


def id_builder(mat, nt, em):
    v = PART_IDS.get(mat.get('part'), 0.9)
    em.inputs['Color'].default_value = (v, v, v, 1)


def pos_builder(mat, nt, em):
    g = nt.nodes.get('GEO_TMP') or nt.nodes.new('ShaderNodeNewGeometry')
    g.name = 'GEO_TMP'
    nt.links.new(g.outputs['Position'], em.inputs['Color'])


ARM_BONES = {'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'} | {f'{f}_0{i}_{s}' for f in FINGERS for i in (1, 2, 3) for s in 'lr'}
arm_groups = {vg.index for vg in char.vertex_groups if vg.name in ARM_BONES}
attr = me.color_attributes.new('armw', 'FLOAT_COLOR', 'POINT')
for v in me.vertices:
    w = min(1.0, sum(g.weight for g in v.groups if g.group in arm_groups))
    attr.data[v.index].color = (w, w, w, 1)


def arm_builder(mat, nt, em):
    at = nt.nodes.get('ATTR_TMP') or nt.nodes.new('ShaderNodeAttribute')
    at.name = 'ATTR_TMP'
    at.attribute_name = 'armw'
    nt.links.new(at.outputs['Color'], em.inputs['Color'])


img_arm = new_img('armw', float_buf=True)
emit_graph(arm_builder)
bake('EMIT', img_arm)
armw = arr(img_arm)[..., 0]
img_a = new_img('alpha', float_buf=True)
emit_graph(alpha_builder)
bake('EMIT', img_a)
img_id = new_img('pid', float_buf=True)
emit_graph(id_builder)
bake('EMIT', img_id)
img_p = new_img('pos', float_buf=True)
emit_graph(pos_builder)
bake('EMIT', img_p)
col, nrm, alpha, pid, pos = arr(img_col), arr(img_nrm), arr(img_a)[..., 0], arr(img_id)[..., 0], arr(img_p)[..., :3]
covered = np.abs(pos).sum(-1) > 1e-6  # texels that belong to some face


def part_mask(name, tol=0.04):
    return (np.abs(pid - PART_IDS[name]) < tol) & covered


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def value_noise3(p, freq, seed):
    """cheap smooth noise over 3D positions (hash lattice, trilinear)"""
    rng = np.random.default_rng(seed)
    N = 64
    lat = rng.random((N, N, N)).astype(np.float32)
    q = p * freq
    i0 = np.floor(q).astype(int)
    f = q - i0
    f = f * f * (3 - 2 * f)
    acc = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                acc = acc + w * lat[(i0[..., 0] + dx) % N, (i0[..., 1] + dy) % N, (i0[..., 2] + dz) % N]
    return acc


def lum(c):
    return c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11


rgb = col[..., :3].copy()
grime = value_noise3(pos, 6.0, 3) * 0.6 + value_noise3(pos, 17.0, 4) * 0.4
if KIND == 'survivor':
    suit = part_mask('suit')
    L = lum(rgb) / max(1e-3, float(np.median(lum(rgb)[suit])))
    blue = np.array([0.16, 0.3, 0.6])
    yel = np.array([0.86, 0.66, 0.18])
    base = np.clip(L[..., None] * blue * (0.85 + 0.3 * grime[..., None]), 0, 1)
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    neck_z = heads['neck'].z
    zip_ = (np.abs(x) < 0.022) & (y < 0) & (z > heads['hips'].z - 0.05) & (z < neck_z)
    nk = heads['neck']
    collar = (np.hypot(x - nk.x, y - nk.y) < 0.085) & (z > neck_z - 0.02)
    cuff = np.zeros_like(zip_)
    for s in ('l', 'r'):  # a band just above each wrist, measured along the forearm
        e, h = np.array(heads['el_' + s]), np.array(heads['hand_' + s])
        ax = h - e
        t = ((pos - e) @ ax) / (ax @ ax)
        dist = np.linalg.norm(pos - (e + np.clip(t, 0, 1)[..., None] * ax), axis=-1)
        cuff |= (t > 0.8) & (t < 1.02) & (dist < 0.07) & (armw > 0.6)
    trim = (zip_ | collar | cuff) & suit
    base = np.where(trim[..., None], np.clip(L[..., None] * yel, 0, 1), base)
    rgb = np.where(suit[..., None], base, rgb)
elif KIND == 'raider':
    suit = part_mask('suit')
    g = lum(rgb)[..., None]
    dirty = rgb * 0.55 + g * 0.45 * np.array([0.9, 0.75, 0.6])
    rgb = np.where(suit[..., None], np.clip(dirty * (0.62 + 0.3 * grime[..., None]), 0, 1), rgb)
elif KIND == 'trader':
    suit = part_mask('suit') | part_mask('hat')
    rgb = np.where(suit[..., None], np.clip((rgb * 0.8 + 0.2 * np.array([0.55, 0.45, 0.33])) * (0.72 + 0.3 * grime[..., None]), 0, 1), rgb)
elif KIND == 'ghoul':
    skin = part_mask('body')
    rot = value_noise3(pos, 9.0, 7)
    veins = smoothstep(0.55, 0.75, value_noise3(pos, 31.0, 9))
    g = lum(rgb)
    dead = np.stack([g * 0.62 + 0.1, g * 0.62 + 0.1, g * 0.48 + 0.07], -1)
    dead = dead * (0.62 + 0.4 * rot[..., None]) * (1 - 0.3 * veins[..., None])
    sore = smoothstep(0.7, 0.84, value_noise3(pos, 11.0, 11))[..., None]
    dead = dead * (1 - sore) + sore * np.array([0.3, 0.12, 0.08]) * (0.7 + 0.3 * rot[..., None])
    rgb = np.where(skin[..., None], np.clip(dead, 0, 1), rgb)
    suit = part_mask('suit')
    rgb = np.where(suit[..., None], np.clip(rgb * (0.5 + 0.3 * grime[..., None]), 0, 1), rgb)
out_a = np.where(covered, alpha, 1.0)


def save_png(a, path):
    im = bpy.data.images.new('o', a.shape[1], a.shape[0], alpha=True)
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def half(a):
    return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, a.shape[2]).mean(axis=(1, 3))


C = np.dstack([rgb, out_a])
N = np.dstack([nrm[..., :3], np.ones(nrm.shape[:2])])
save_png(C, os.path.join(TEXOUT, f'char_{KIND}_c_{ATLAS}.png'))
save_png(N, os.path.join(TEXOUT, f'char_{KIND}_n_{ATLAS}.png'))
save_png(half(C), os.path.join(TEXOUT, f'char_{KIND}_c_{ATLAS // 2}.png'))
save_png(half(N), os.path.join(TEXOUT, f'char_{KIND}_n_{ATLAS // 2}.png'))

# ---------------------------------------------------------------- 6. MPFB bones -> game joints
vg_names = {vg.index: vg.name for vg in char.vertex_groups}
to_joint = {}
for j, bones in JOINT_MAP.items():
    for b in bones:
        to_joint[b] = j
nv = len(me.vertices)
W = np.zeros((nv, len(JOINTS)), np.float32)
jidx = {j: i for i, j in enumerate(JOINTS)}
for v in me.vertices:
    for g in v.groups:
        j = to_joint.get(vg_names.get(g.group))
        if j:
            W[v.index, jidx[j]] += g.weight
empty = W.sum(1) < 1e-6
if empty.any():  # e.g. eyes: follow the head
    W[empty, jidx['head']] = 1
# keep the four strongest influences, normalised
order = np.argsort(-W, axis=1)
keep = np.zeros_like(W, dtype=bool)
np.put_along_axis(keep, order[:, :4], True, axis=1)
W = np.where(keep, W, 0)
W /= W.sum(1, keepdims=True)
for vg in list(char.vertex_groups):
    char.vertex_groups.remove(vg)
groups = {j: char.vertex_groups.new(name=j) for j in JOINTS}
for j, gi in jidx.items():
    col_w = W[:, gi]
    idx = np.nonzero(col_w > 1e-4)[0]
    for i in idx:
        groups[j].add([int(i)], float(col_w[i]), 'REPLACE')

# new armature with the game's joints at the measured positions
bpy.data.objects.remove(rig, do_unlink=True)
arm_d = bpy.data.armatures.new('skel_' + KIND)
arm = bpy.data.objects.new('skel_' + KIND, arm_d)
sc.collection.objects.link(arm)
activate(arm)
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for j in JOINTS:
    b = arm_d.edit_bones.new(j)
    b.head = heads[j]
    b.tail = heads[j] + Vector((0, 0, 0.06))
    eb[j] = b
for j in JOINTS:
    if PARENT[j]:
        eb[j].parent = eb[PARENT[j]]
bpy.ops.object.mode_set(mode='OBJECT')

# plain material + only the atlas UVs
me.uv_layers.remove(me.uv_layers['orig'])
me.materials.clear()
mat = bpy.data.materials.new('char')
mat.use_nodes = True
me.materials.append(mat)
char.parent = arm
mod = char.modifiers.new('skin', 'ARMATURE')
mod.object = arm
char['eyes'] = [list(eye_r), list(eye_l)]
char['joints'] = {j: list(heads[j]) for j in JOINTS}
bpy.ops.object.select_all(action='DESELECT')
char.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
path = os.path.join(OUT, f'char_{KIND}.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
                          export_materials='NONE', export_normals=True, export_texcoords=True, export_extras=True, export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'char_{KIND}.blend'))
print('EXPORTED', path, 'tris', tris(char), 'verts', len(me.vertices), 'joints', {j: tuple(round(c, 3) for c in heads[j]) for j in ('hips', 'chest', 'head', 'sh_l', 'el_l', 'hand_l', 'hip_l', 'kn_l', 'an_l')}, flush=True)

# Blender 4.5 (headless): model the game's creatures on their procedural skeletons and export skinned GLBs.
#   blender -b --factory-startup --python make_creatures.py -- KIND OUT_MODELS OUT_TEX
# KIND: hound | cattle | burrower | roach | stalker
# Joint positions replicate the game's constructors (09b_creatures.js), in game coordinates (y up, +z forward).
# Organic bodies: an edge skeleton with per-node radii -> Skin modifier -> subdivision -> noise displacement.
# Horns, claws, teeth, antennae and insect legs are swept tubes. Weights come from distance to each bone
# segment (rigid for hard parts). A procedural skin material is baked to an atlas (colour + normal).
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
KIND, OUT, TEXOUT = ARGS[0], os.path.abspath(ARGS[1]), os.path.abspath(ARGS[2])
ATLAS = 1024
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEXOUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
rnd = random.Random(7)
VOXEL = {'cattle': 0.018, 'stalker': 0.02}.get(KIND, 0.009)


def G(x, y, z):
    """game coordinates (y up, +z forward) -> Blender (z up, -y forward)"""
    return Vector((x, -z, y))


def V(*a):
    return Vector(a)


# ------------------------------------------------------------------ joints (name, parent, game position)
def quad_joints(kind):
    D = {'hound': dict(L=0.95, H=0.62, W=0.15, up=0.3, lo=0.3, br=0.19),
         'cattle': dict(L=1.7, H=1.18, W=0.3, up=0.5, lo=0.55, br=0.42),
         'burrower': dict(L=0.8, H=0.34, W=0.16, up=0.14, lo=0.16, br=0.22)}[kind]
    J = [('body', None, V(0, D['H'], 0))]
    heads = 2 if kind == 'cattle' else 1
    hs = 1.6 if kind == 'cattle' else 1 if kind == 'hound' else 1.1
    for h in range(heads):
        ox = (0.2 if h else -0.2) if heads > 1 else 0
        neck = J[0][2] + V(ox, 0.08, D['L'] * 0.5)
        head = neck + V(0, 0.14, 0.2 * (D['L'] / 0.95))
        jaw = head + V(0, -0.05 * hs, 0.05 * hs)
        J += [(f'neck{h}', 'body', neck), (f'head{h}', f'neck{h}', head), (f'jaw{h}', f'head{h}', jaw)]
    for i, (sx, sz) in enumerate([(-1, 1), (1, 1), (-1, -1), (1, -1)]):
        hip = J[0][2] + V(sx * D['W'], -0.02, sz * D['L'] * 0.36)
        J += [(f'hip{i}', 'body', hip), (f'knee{i}', f'hip{i}', hip + V(0, -D['up'], 0))]
    t = J[0][2] + V(0, 0.05, -D['L'] * 0.5)
    J.append(('tail0', 'body', t))
    for i in (1, 2):
        t = t + V(0, 0, -0.12 * (D['L'] / 0.95))
        J.append((f'tail{i}', f'tail{i - 1}', t))
    return J, D, hs


def roach_joints():
    body = V(0, 0.2, 0)
    head = body + V(0, 0, 0.36)
    J = [('body', None, body), ('head', 'body', head)]
    for k, s in enumerate((-1, 1)):
        J.append((f'ant{k}', 'head', head + V(s * 0.03, 0.03, 0.05)))
    n = 0
    for i in range(3):
        for s in (-1, 1):
            hip = body + V(s * 0.14, -0.02, 0.18 - i * 0.18)
            J += [(f'hip{n}', 'body', hip), (f'kn{n}', f'hip{n}', hip + V(s * 0.2, 0.08, 0))]
            n += 1
    return J


def stalker_joints():
    hips = V(0, 1.55, 0)
    spine = hips + V(0, 0.2, 0.1)
    neck = spine + V(0, 0.78, 0.42)
    head = neck + V(0, 0.12, 0.32)
    J = [('hips', None, hips), ('spine', 'hips', spine), ('neck', 'spine', neck), ('head', 'neck', head), ('jaw', 'head', head + V(0, -0.08, 0.1))]
    for k, s in enumerate((-1, 1)):
        sh = spine + V(s * 0.42, 0.62, 0.3)
        J += [(f'sh{k}', 'spine', sh), (f'el{k}', f'sh{k}', sh + V(0, -0.62, 0)), (f'hd{k}', f'el{k}', sh + V(0, -1.24, 0))]
    for k, s in enumerate((-1, 1)):
        hp = hips + V(s * 0.3, -0.05, 0)
        kn = hp + V(0, -0.62, 0.05)
        an = kn + V(0, -0.55, 0)
        J += [(f'hp{k}', 'hips', hp), (f'kn{k}', f'hp{k}', kn), (f'an{k}', f'kn{k}', an), (f'ft{k}', f'an{k}', an + V(0, -0.38, 0))]
    t = hips
    for i in range(5):
        t = t + V(0, 0, -0.35 if i == 0 else -0.38)
        J.append((f'tail{i}', 'hips' if i == 0 else f'tail{i - 1}', t))
    return J


# ------------------------------------------------------------------ geometry helpers (all in game coords)
PARTS = []  # (object, rigid_joint or None, material key)


def link(me, name):
    ob = bpy.data.objects.new(name, me)
    SC.collection.objects.link(ob)
    return ob


def chains_of(n_nodes, edges):
    """split a tree (rooted at node 0) into simple paths; each branch path starts at its branch node"""
    kids = {}
    for a, b in edges:
        kids.setdefault(a, []).append(b)
    out, stack = [], [[0]]
    while stack:
        ch = stack.pop()
        while True:
            k = kids.get(ch[-1], [])
            if not k:
                break
            for extra in k[1:]:
                stack.append([ch[-1], extra])
            ch.append(k[0])
        out.append(ch)
    return out


def skin_chain(pts, radii, name, levels):
    me = bpy.data.meshes.new(name)
    me.from_pydata([G(*p) for p in pts], [(i, i + 1) for i in range(len(pts) - 1)], [])
    ob = link(me, name)
    ob.modifiers.new('skin', 'SKIN')
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = r if isinstance(r, tuple) else (r, r)
    sv[0].use_root = True
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = levels
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return ob


def skin_body(nodes, edges, name, levels=2, disp=0.012, dscale=9.0, seed=1):
    """nodes: [(game_pos, radius or (rx, ry))], edges: [(i, j)] forming a tree rooted at node 0.
    Every simple path is skinned on its own; the overlapping pieces are then voxel-remeshed into one
    watertight surface (robust at multi-limb junctions) and smoothed."""
    obs = []
    for k, ch in enumerate(chains_of(len(nodes), edges)):
        obs.append(skin_chain([nodes[i][0] for i in ch], [nodes[i][1] for i in ch], f'{name}_{k}', levels))
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = obs[0]
    ob.name = name
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = VOXEL
    sm = ob.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.8
    sm.iterations = 6
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    me = ob.data
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    me.update()
    for v in me.vertices:  # organic lumps and wrinkles along the normals
        c = v.co
        n = noise.noise(c * dscale + off) * disp + noise.noise(c * dscale * 3.1 + off) * disp * 0.35
        v.co = c + v.normal * n
    for p in me.polygons:
        p.use_smooth = True
    return ob


def tube(path, radii, name, sides=10, cap_tip=True):
    """swept tube through game-space points with per-point radius (tapering to a tip if the last radius ~0)"""
    bm = bmesh.new()
    pts = [G(*p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        fwd = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(fwd.z) < 0.9 else Vector((1, 0, 0))
        side = fwd.cross(up).normalized()
        up = side.cross(fwd).normalized()
        r = radii[i]
        if r < 1e-4:
            rings.append([bm.verts.new(p)])
            continue
        rings.append([bm.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * r) for a in (k / sides * math.tau for k in range(sides))])
    for a, b in zip(rings, rings[1:]):
        if len(b) == 1:
            for k in range(sides):
                bm.faces.new((a[k], a[(k + 1) % sides], b[0]))
        elif len(a) == 1:
            for k in range(sides):
                bm.faces.new((a[0], b[(k + 1) % sides], b[k]))
        else:
            for k in range(sides):
                bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    if len(rings[0]) > 1:
        bm.faces.new(list(reversed(rings[0])))
    if len(rings[-1]) > 1 and cap_tip:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return link(me, name)


def ellipsoid(center, radii, name, seg=24, rings=14, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))  # game-space axes (x, y, z)
    rm = Matrix.Rotation(rot[0], 4, 'X') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[2], 4, 'Z')
    for v in bm.verts:
        g = rm @ v.co + Vector(center)
        v.co = G(g.x, g.y, g.z)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return link(me, name)


def arc(a, b, bend, n=8):
    """points from a to b bowed by the vector `bend` at the middle"""
    a, b, bend = Vector(a), Vector(b), Vector(bend)
    return [tuple(a.lerp(b, t) + bend * math.sin(t * math.pi)) for t in (i / (n - 1) for i in range(n))]


def taper(n, r0, r1=0.0, power=1.0):
    return [r0 + (r1 - r0) * (i / (n - 1)) ** power for i in range(n)]


# ------------------------------------------------------------------ creature recipes
def build_hound():
    J, D, hs = quad_joints('hound')
    P = {n: p for n, _, p in J}
    nodes = [((0, 0.58, -0.82), 0.015), ((0, 0.65, -0.715), 0.028), ((0, 0.67, -0.595), 0.042), ((0, 0.67, -0.475), 0.062),
             ((0, 0.66, -0.36), (0.13, 0.14)), ((0, 0.63, -0.18), (0.105, 0.11)), ((0, 0.6, 0.06), (0.125, 0.17)), ((0, 0.62, 0.26), (0.14, 0.18)),
             ((0, 0.7, 0.4), (0.12, 0.13)), ((0, 0.76, 0.5), 0.092), ((0, 0.82, 0.6), 0.082), ((0, 0.85, 0.68), 0.097),
             ((0, 0.82, 0.8), 0.06), ((0, 0.8, 0.87), 0.037)]
    edges = [(i, i + 1) for i in range(len(nodes) - 1)]
    for i in range(4):
        hp = P[f'hip{i}']
        x = hp.x
        top = len(nodes)
        if i < 2:  # front: shoulder, forearm, wrist, paw
            nodes += [((x * 0.87, 0.58, 0.33), 0.085), ((x, 0.42, 0.34), 0.056), ((x, 0.3, 0.342), 0.04), ((x, 0.12, 0.35), 0.033), ((x, 0.035, 0.38), 0.038), ((x, 0.028, 0.425), 0.03)]
            edges += [(7, top)]
        else:  # hind: haunch, stifle forward, hock back, paw
            nodes += [((x * 0.87, 0.58, -0.33), 0.11), ((x, 0.4, -0.28), 0.072), ((x, 0.24, -0.38), 0.045), ((x, 0.12, -0.37), 0.034), ((x, 0.035, -0.35), 0.038), ((x, 0.028, -0.305), 0.03)]
            edges += [(4, top)]
        edges += [(top + k, top + k + 1) for k in range(5)]
    body = skin_body(nodes, edges, 'hound_body', disp=0.01, dscale=11, seed=3)
    PARTS.append((body, None, 'skin'))
    # lower jaw, ears, teeth, ribs showing through
    hd, jw = P['head0'], P['jaw0']
    jaw = tube([tuple(jw + V(0, 0, -0.05)), tuple(jw + V(0, -0.01, 0.03)), tuple(jw + V(0, -0.015, 0.1)), tuple(jw + V(0, -0.01, 0.15))], [0.045, 0.04, 0.032, 0.02], 'jaw', 10)
    PARTS.append((jaw, 'jaw0', 'skin'))
    for s in (-1, 1):
        ear = tube(arc(hd + V(s * 0.05, 0.07, -0.03), hd + V(s * 0.08, 0.17, -0.07), V(s * 0.01, 0, -0.02), 5), taper(5, 0.03, 0.0), 'ear', 8)
        PARTS.append((ear, 'head0', 'skin'))
    for t in range(6):
        x = -0.03 + t * 0.012
        PARTS.append((tube([tuple(jw + V(x, 0.0, 0.08 + (t % 3) * 0.02)), tuple(jw + V(x, 0.03, 0.08 + (t % 3) * 0.02))], [0.005, 0.0], 'tooth', 5), 'jaw0', 'bone'))
        PARTS.append((tube([tuple(hd + V(x, -0.05, 0.13 + (t % 3) * 0.02)), tuple(hd + V(x, -0.08, 0.13 + (t % 3) * 0.02))], [0.005, 0.0], 'tooth', 5), 'head0', 'bone'))
    return J, dict(skin=('hound',), bone=None), 3200


def build_cattle():
    J, D, hs = quad_joints('cattle')
    P = {n: p for n, _, p in J}
    b = P['body']
    nodes = [((0, 1.0, -1.25), 0.03), (tuple(P['tail2']), 0.045), (tuple(P['tail1']), 0.06), (tuple(P['tail0']), 0.09),
             (tuple(b + V(0, 0.02, -0.66)), (0.33, 0.34)), (tuple(b + V(0, -0.06, -0.2)), (0.4, 0.42)), (tuple(b + V(0, -0.02, 0.25)), (0.42, 0.44)),
             (tuple(b + V(0, 0.05, 0.62)), (0.36, 0.4))]
    edges = [(i, i + 1) for i in range(len(nodes) - 1)]
    for h in range(2):
        nk, hd = P[f'neck{h}'], P[f'head{h}']
        top = len(nodes)
        nodes += [(tuple(nk.lerp(hd, 0.3) + V(0, -0.02, 0)), 0.15), (tuple(hd + V(0, 0.0, -0.06)), 0.15), (tuple(hd + V(0, -0.02, 0.1)), 0.14),
                  (tuple(hd + V(0, -0.08, 0.26)), 0.1), (tuple(hd + V(0, -0.1, 0.34)), 0.085)]
        edges += [(7, top), (top, top + 1), (top + 1, top + 2), (top + 2, top + 3), (top + 3, top + 4)]
    for i in range(4):
        hp, kn = P[f'hip{i}'], P[f'knee{i}']
        front = i < 2
        top = len(nodes)
        nodes += [(tuple(hp + V(0, 0.05, 0)), 0.17 if front else 0.2), (tuple(hp.lerp(kn, 0.55)), 0.11 if front else 0.13), (tuple(kn), 0.075),
                  (tuple(kn + V(0, -0.45, 0.02)), 0.06), (tuple(kn + V(0, -0.55, 0.04)), 0.07)]
        edges += [((6 if front else 4), top), (top, top + 1), (top + 1, top + 2), (top + 2, top + 3), (top + 3, top + 4)]
    body = skin_body(nodes, edges, 'cattle_body', disp=0.02, dscale=5, seed=5)
    PARTS.append((body, None, 'skin'))
    for h in range(2):
        hd, jw = P[f'head{h}'], P[f'jaw{h}']
        PARTS.append((tube([tuple(jw + V(0, 0, -0.06)), tuple(jw + V(0, -0.02, 0.1)), tuple(jw + V(0, -0.02, 0.2))], [0.07, 0.06, 0.045], 'jaw', 10), f'jaw{h}', 'skin'))
        for s in (-1, 1):
            horn = tube(arc(hd + V(s * 0.1, 0.1, -0.03), hd + V(s * 0.36, 0.26, 0.02), V(s * 0.02, 0.1, -0.06), 9), taper(9, 0.05, 0.004, 1.2), 'horn', 10)
            PARTS.append((horn, f'head{h}', 'horn'))
            ear = tube(arc(hd + V(s * 0.13, 0.03, -0.06), hd + V(s * 0.26, 0.0, -0.1), V(0, 0.03, 0), 5), [0.05, 0.05, 0.04, 0.02, 0.0], 'ear', 8)
            PARTS.append((ear, f'head{h}', 'skin'))
    # udder
    PARTS.append((ellipsoid(tuple(b + V(0, -0.42, -0.35)), (0.13, 0.08, 0.16), 'udder', 16, 10), 'body', 'nose'))
    return J, None, 5200


def build_burrower():
    J, D, hs = quad_joints('burrower')
    P = {n: p for n, _, p in J}
    b = P['body']
    nodes = [((0, 0.36, -0.62), 0.012), (tuple(P['tail2']), 0.018), (tuple(P['tail1']), 0.025), (tuple(P['tail0']), 0.04),
             (tuple(b + V(0, 0.0, -0.3)), (0.19, 0.18)), (tuple(b + V(0, -0.02, 0.0)), (0.22, 0.21)), (tuple(b + V(0, 0.0, 0.25)), (0.19, 0.19)),
             (tuple(P['neck0'] + V(0, 0.02, 0.05)), 0.14), (tuple(P['head0'] + V(0, -0.02, 0.0)), 0.12), (tuple(P['head0'] + V(0, -0.04, 0.13)), 0.08),
             (tuple(P['head0'] + V(0, -0.05, 0.2)), 0.05)]
    edges = [(i, i + 1) for i in range(len(nodes) - 1)]
    for i in range(4):
        hp, kn = P[f'hip{i}'], P[f'knee{i}']
        front = i < 2
        top = len(nodes)
        nodes += [(tuple(hp + V(0, 0.03, 0)), 0.07), (tuple(kn), 0.045), (tuple(kn + V(0, -0.13, 0.03)), 0.04), (tuple(kn + V(0, -0.15, 0.08)), 0.035)]
        edges += [((6 if front else 4), top), (top, top + 1), (top + 1, top + 2), (top + 2, top + 3)]
    body = skin_body(nodes, edges, 'burrower_body', disp=0.012, dscale=16, seed=9)
    PARTS.append((body, None, 'skin'))
    hd, jw = P['head0'], P['jaw0']
    PARTS.append((tube([tuple(jw + V(0, 0, -0.03)), tuple(jw + V(0, -0.01, 0.08)), tuple(jw + V(0, 0.0, 0.13))], [0.05, 0.04, 0.025], 'jaw', 10), 'jaw0', 'skin'))
    for s in (-1, 1):  # big buck teeth
        PARTS.append((tube([tuple(hd + V(s * 0.018, -0.03, 0.24)), tuple(hd + V(s * 0.018, -0.09, 0.27)), tuple(hd + V(s * 0.018, -0.12, 0.26))], [0.016, 0.014, 0.004], 'incisor', 6), 'head0', 'bone'))
    for i in range(4):
        kn = P[f'knee{i}']
        for c in range(3):
            base = kn + V((c - 1) * 0.022, -0.14, 0.09)
            PARTS.append((tube([tuple(base), tuple(base + V(0, -0.015, 0.05))], [0.009, 0.0], 'claw', 5), f'knee{i}', 'claw'))
    return J, None, 2600


def build_roach():
    J = roach_joints()
    P = {n: p for n, _, p in J}
    b, hd = P['body'], P['head']
    abd = ellipsoid(tuple(b + V(0, 0.0, -0.05)), (0.19, 0.08, 0.34), 'abdomen', 28, 16)
    PARTS.append((abd, 'body', 'shell'))
    thorax = ellipsoid(tuple(b + V(0, 0.01, 0.22)), (0.15, 0.07, 0.12), 'thorax', 22, 12)
    PARTS.append((thorax, 'body', 'shell'))
    for s in (-1, 1):  # wing covers
        w = ellipsoid(tuple(b + V(s * 0.075, 0.055, -0.08)), (0.1, 0.035, 0.32), 'wing', 20, 10, rot=(0, s * 0.08, s * 0.08))
        PARTS.append((w, 'body', 'wing'))
    PARTS.append((ellipsoid(tuple(hd), (0.085, 0.055, 0.07), 'head', 18, 10), 'head', 'shell'))
    for k, s in enumerate((-1, 1)):
        a = P[f'ant{k}']
        pts = [tuple(a + V(s * i * 0.04, i * 0.02 - i * i * 0.004, i * 0.07)) for i in range(9)]
        PARTS.append((tube(pts, taper(9, 0.007, 0.002), 'antenna', 5), f'ant{k}', 'leg'))
    for n in range(6):
        hp, kn = P[f'hip{n}'], P[f'kn{n}']
        s = 1 if kn.x > hp.x else -1
        PARTS.append((tube([tuple(hp), tuple(hp.lerp(kn, 0.5) + V(0, 0.02, 0)), tuple(kn)], [0.018, 0.016, 0.013], 'femur', 7), f'hip{n}', 'leg'))
        foot = kn + V(s * 0.09, -0.26, 0)
        PARTS.append((tube([tuple(kn), tuple(kn.lerp(foot, 0.5) + V(s * 0.02, 0, 0)), tuple(foot), tuple(foot + V(s * 0.03, -0.01, 0))], [0.012, 0.01, 0.007, 0.0], 'tibia', 7), f'kn{n}', 'leg'))
        for sp in range(3):  # leg spines
            t = 0.25 + sp * 0.25
            p0 = kn.lerp(foot, t)
            PARTS.append((tube([tuple(p0), tuple(p0 + V(s * 0.025, 0.012, 0.01))], [0.004, 0.0], 'spine', 4), f'kn{n}', 'leg'))
    return J, None, 3000


def build_stalker():
    J = stalker_joints()
    P = {n: p for n, _, p in J}
    hp, sp, nk, hd = P['hips'], P['spine'], P['neck'], P['head']
    nodes = [(tuple(P['tail4'] + V(0, 0, -0.3)), 0.03), (tuple(P['tail4']), 0.05), (tuple(P['tail3']), 0.08), (tuple(P['tail2']), 0.1),
             (tuple(P['tail1']), 0.13), (tuple(P['tail0']), 0.17), (tuple(hp + V(0, 0.0, -0.05)), (0.3, 0.26)),
             (tuple(sp + V(0, 0.2, 0.08)), (0.34, 0.3)), (tuple(sp + V(0, 0.5, 0.22)), (0.4, 0.34)), (tuple(sp + V(0, 0.72, 0.36)), (0.3, 0.26)),
             (tuple(nk + V(0, 0.06, 0.12)), 0.17), (tuple(hd + V(0, 0.0, -0.05)), 0.19), (tuple(hd + V(0, -0.02, 0.14)), 0.15),
             (tuple(hd + V(0, -0.04, 0.3)), 0.1), (tuple(hd + V(0, -0.05, 0.42)), 0.06)]
    edges = [(i, i + 1) for i in range(len(nodes) - 1)]
    for k in range(2):  # arms hang straight down in the rest pose
        sh, el, ha = P[f'sh{k}'], P[f'el{k}'], P[f'hd{k}']
        top = len(nodes)
        nodes += [(tuple(sh.lerp(sp + V(0, 0.62, 0.3), 0.5)), 0.17), (tuple(sh), 0.15), (tuple(sh.lerp(el, 0.5)), 0.12), (tuple(el), 0.1),
                  (tuple(el.lerp(ha, 0.5)), 0.095), (tuple(ha), 0.085), (tuple(ha + V(0, -0.1, 0.02)), 0.09)]
        edges += [(9, top), (top, top + 1), (top + 1, top + 2), (top + 2, top + 3), (top + 3, top + 4), (top + 4, top + 5), (top + 5, top + 6)]
    for k in range(2):  # legs straight down in the rest pose (the game bends them)
        h, kn, an, ft = P[f'hp{k}'], P[f'kn{k}'], P[f'an{k}'], P[f'ft{k}']
        top = len(nodes)
        nodes += [(tuple(h + V(0, 0.02, 0.02)), 0.22), (tuple(h.lerp(kn, 0.5) + V(0, 0, 0.04)), 0.19), (tuple(kn), 0.13), (tuple(kn.lerp(an, 0.5)), 0.1),
                  (tuple(an), 0.08), (tuple(an.lerp(ft, 0.6)), 0.075), (tuple(ft + V(0, -0.02, 0.06)), 0.07)]
        edges += [(6, top), (top, top + 1), (top + 1, top + 2), (top + 2, top + 3), (top + 3, top + 4), (top + 4, top + 5), (top + 5, top + 6)]
    body = skin_body(nodes, edges, 'stalker_body', disp=0.02, dscale=7, seed=11)
    PARTS.append((body, None, 'skin'))
    jw = P['jaw']
    PARTS.append((tube([tuple(jw + V(0, 0, -0.08)), tuple(jw + V(0, -0.02, 0.1)), tuple(jw + V(0, -0.03, 0.26)), tuple(jw + V(0, -0.02, 0.34))], [0.09, 0.08, 0.06, 0.035], 'jaw', 12), 'jaw', 'skin'))
    for s in (-1, 1):
        horn = tube([tuple(hd + V(s * 0.1, 0.1, -0.02)), tuple(hd + V(s * 0.22, 0.22, -0.07)), tuple(hd + V(s * 0.3, 0.4, -0.22)), tuple(hd + V(s * 0.28, 0.55, -0.44)), tuple(hd + V(s * 0.24, 0.6, -0.56))],
                    [0.055, 0.047, 0.036, 0.018, 0.0], 'horn', 12)
        PARTS.append((horn, 'head', 'horn'))
    for t in range(10):
        x = -0.08 + (t % 5) * 0.04
        z = 0.08 + (t // 5) * 0.16
        PARTS.append((tube([tuple(jw + V(x, 0.02, z)), tuple(jw + V(x, 0.07, z))], [0.012, 0.0], 'tooth', 5), 'jaw', 'bone'))
        PARTS.append((tube([tuple(hd + V(x, -0.08, z + 0.1)), tuple(hd + V(x, -0.13, z + 0.1))], [0.012, 0.0], 'tooth', 5), 'head', 'bone'))
    for k in range(2):  # hand claws, long and curved forward
        ha = P[f'hd{k}']
        for c in range(3):
            base = ha + V((c - 1) * 0.06, -0.14, 0.05)
            PARTS.append((tube(arc(base, base + V((c - 1) * 0.04, -0.36, 0.2), V(0, 0.02, 0.08), 7), taper(7, 0.035, 0.0), 'claw', 8), f'hd{k}', 'claw'))
        ft = P[f'ft{k}']
        for c in range(3):
            base = ft + V((c - 1) * 0.07, -0.02, 0.1)
            PARTS.append((tube(arc(base, base + V((c - 1) * 0.03, -0.04, 0.22), V(0, 0.03, 0), 5), taper(5, 0.04, 0.0), 'claw', 7), f'ft{k}', 'claw'))
    for i in range(7):  # dorsal spikes
        base = sp + V(0, 0.15 + i * 0.13, -0.28 + i * 0.045)
        PARTS.append((tube([tuple(base), tuple(base + V(0, 0.09, -0.16))], [0.05, 0.0], 'spike', 6), 'spine', 'claw'))
    return J, None, 7000


BUILD = {'hound': build_hound, 'cattle': build_cattle, 'burrower': build_burrower, 'roach': build_roach, 'stalker': build_stalker}
JOINTS, _, BUDGET = BUILD[KIND]()
POS = {n: p for n, _, p in JOINTS}
PAR = {n: pa for n, pa, _ in JOINTS}
CHILDREN = {}
for n, pa, _ in JOINTS:
    if pa:
        CHILDREN.setdefault(pa, []).append(n)

# ------------------------------------------------------------------ materials per part
MATKEYS = sorted({mk for _, _, mk in PARTS})
mats = {}
for mk in MATKEYS:
    m = bpy.data.materials.new(mk)
    m.use_nodes = True
    mats[mk] = m
    m['key'] = mk
for ob, rigid, mk in PARTS:
    ob.data.materials.append(mats[mk])
    ob['rigid'] = rigid or ''

# ------------------------------------------------------------------ weights: distance to bone segments
def segment(n):
    a = POS[n]
    kids = CHILDREN.get(n, [])
    if kids:
        b = sum((POS[k] for k in kids), Vector()) / len(kids)
    else:  # leaves: extend along the parent direction
        pa = PAR[n]
        d = (a - POS[pa]) if pa else Vector((0, 0, 0.1))
        b = a + d.normalized() * min(0.25, max(0.08, d.length * 0.8))
    if KIND in ('hound', 'cattle', 'burrower') and n == 'body':  # the torso bone covers the whole barrel
        a, b = POS['body'] + Vector((0, 0, -POS['tail0'].z * 0.8)), POS['body'] + Vector((0, 0, POS['neck0'].z * 0.85))
    if KIND == 'stalker' and n == 'hips':
        b = POS['hips'] + Vector((0, 0.1, 0.02))
    if n.startswith('head'):  # the head bone runs out along the snout, not down to the jaw
        a, b = POS[n], POS[n] + (Vector((0, -0.04, 0.42)) if KIND == 'stalker' else Vector((0, -0.03, 0.2 if KIND != 'cattle' else 0.32)))
    return G(*a), G(*b)


SEGS = {n: segment(n) for n in POS}
NAMES = [n for n, _, _ in JOINTS]


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    return (p - (a + ab * t)).length


SOFT = [n for n in NAMES if not n.startswith(('jaw', 'ant'))]  # jaws and antennae only drive their own rigid parts
for ob, rigid, mk in PARTS:
    for n in NAMES:
        ob.vertex_groups.new(name=n)
    if rigid:
        ob.vertex_groups[rigid].add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
        continue
    for v in ob.data.vertices:
        d = np.array([seg_dist(v.co, *SEGS[n]) for n in SOFT])
        w = 1.0 / (d + 0.015) ** 5
        top = np.argsort(-w)[:3]
        ws = w[top] / w[top].sum()
        for k, idx in enumerate(top):
            if ws[k] > 0.02:
                ob.vertex_groups[SOFT[idx]].add([v.index], float(ws[k]), 'REPLACE')

# ------------------------------------------------------------------ join, decimate, unwrap
bpy.ops.object.select_all(action='DESELECT')
for ob, _, _ in PARTS:
    ob.select_set(True)
main = PARTS[0][0]
bpy.context.view_layer.objects.active = main
bpy.ops.object.join()
me = main.data
tris = sum(len(p.vertices) - 2 for p in me.polygons)
if tris > BUDGET:
    d = main.modifiers.new('dec', 'DECIMATE')
    d.ratio = BUDGET / tris
    d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=d.name)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
print('MESH', KIND, 'tris', sum(len(p.vertices) - 2 for p in me.polygons), flush=True)

# ------------------------------------------------------------------ procedural materials (object space) and bake
# style, dark colour, light colour, roughness, pattern scale
PAL = {
    'hound': dict(skin=('wrinkle', (0.2, 0.1, 0.07), (0.5, 0.24, 0.2), 0.5, 14.0), bone=('solid', (0.8, 0.76, 0.62))),
    'cattle': dict(skin=('hide', (0.3, 0.2, 0.13), (0.55, 0.45, 0.33), 0.75, 4.0), horn=('solid', (0.72, 0.66, 0.52)), nose=('solid', (0.58, 0.42, 0.38))),
    'burrower': dict(skin=('wrinkle', (0.5, 0.3, 0.27), (0.78, 0.56, 0.5), 0.55, 20.0), bone=('solid', (0.86, 0.78, 0.55)), claw=('solid', (0.2, 0.17, 0.14))),
    'roach': dict(shell=('chitin', (0.14, 0.06, 0.02), (0.36, 0.18, 0.07), 0.28, 8.0), wing=('chitin', (0.22, 0.11, 0.04), (0.45, 0.25, 0.1), 0.22, 16.0), leg=('solid', (0.1, 0.06, 0.03))),
    'stalker': dict(skin=('reptile', (0.1, 0.085, 0.06), (0.3, 0.25, 0.17), 0.55, 11.0), horn=('solid', (0.68, 0.62, 0.5)), bone=('solid', (0.82, 0.76, 0.6)), claw=('solid', (0.07, 0.06, 0.05))),
}[KIND]


def build_material(mat, spec):
    nt = mat.node_tree
    N, L = nt.nodes, nt.links
    for n in list(N):
        N.remove(n)
    out = N.new('ShaderNodeOutputMaterial')
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    L.new(bsdf.outputs[0], out.inputs[0])
    tc = N.new('ShaderNodeTexCoord')
    style = spec[0]

    def noise(scale, detail=4, rough=0.55, distort=0.0):
        n = N.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distort
        L.new(tc.outputs['Object'], n.inputs['Vector'])
        return n.outputs['Fac']

    def ramp(fac, c0, c1, p0=0.35, p1=0.7):
        r = N.new('ShaderNodeValToRGB')
        r.color_ramp.elements[0].position = p0
        r.color_ramp.elements[0].color = (*c0, 1)
        r.color_ramp.elements[1].position = p1
        r.color_ramp.elements[1].color = (*c1, 1)
        L.new(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def math(op, a, b, c=None):
        m = N.new('ShaderNodeMath')
        m.operation = op
        for i, x in enumerate((a, b, c)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                m.inputs[i].default_value = x
            else:
                L.new(x, m.inputs[i])
        return m.outputs[0]

    def bump(height, strength, dist=0.02):
        b = N.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = dist
        L.new(height, b.inputs['Height'])
        L.new(b.outputs['Normal'], bsdf.inputs['Normal'])

    if style == 'solid':
        bsdf.inputs['Base Color'].default_value = (*spec[1], 1)
        bsdf.inputs['Roughness'].default_value = 0.45
        bump(noise(60, 3), 0.2)
        return
    _, c0, c1, rough, sc = spec
    bsdf.inputs['Roughness'].default_value = rough
    mott = noise(sc * 0.22, 5)
    colr = ramp(mott, c0, c1)
    if style == 'wrinkle':  # hairless, scarred skin: stretched wrinkles, pores, raw patches
        wr = noise(sc, 6, 0.6, 1.5)
        wl = math('ABSOLUTE', math('SUBTRACT', wr, 0.5), 0)
        pores = noise(sc * 9, 2)
        raw = ramp(noise(sc * 0.12, 3), (0, 0, 0), (1, 1, 1), 0.6, 0.72)
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        L.new(raw, mix.inputs['Factor'])
        L.new(colr, mix.inputs['A'])
        mix.inputs['B'].default_value = (0.55, 0.16, 0.13, 1)
        dark = N.new('ShaderNodeMix')
        dark.data_type = 'RGBA'
        dark.blend_type = 'MULTIPLY'
        L.new(math('SUBTRACT', 1.0, math('MULTIPLY', wl, 3.0)), dark.inputs['Factor'])
        L.new(mix.outputs['Result'], dark.inputs['A'])
        dark.inputs['B'].default_value = (0.6, 0.55, 0.52, 1)
        L.new(dark.outputs['Result'], bsdf.inputs['Base Color'])
        bump(math('ADD', math('MULTIPLY', wl, -1.0), math('MULTIPLY', pores, 0.25)), 0.5, 0.015)
    elif style == 'reptile':  # scales: cell edges as crevices
        vor = N.new('ShaderNodeTexVoronoi')
        vor.feature = 'DISTANCE_TO_EDGE'
        vor.inputs['Scale'].default_value = sc * 2.5
        L.new(tc.outputs['Object'], vor.inputs['Vector'])
        edge = math('MINIMUM', math('DIVIDE', vor.outputs['Distance'], 0.12), 1.0)
        mul = N.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 0.6
        L.new(colr, mul.inputs['A'])
        cr = N.new('ShaderNodeCombineColor')
        for k in ('Red', 'Green', 'Blue'):
            L.new(edge, cr.inputs[k])
        L.new(cr.outputs['Color'], mul.inputs['B'])
        L.new(mul.outputs['Result'], bsdf.inputs['Base Color'])
        bump(math('ADD', edge, math('MULTIPLY', noise(sc * 4, 6), 0.4)), 0.6, 0.02)
    elif style == 'hide':  # leathery hide with patches
        patches = ramp(noise(sc * 0.5, 3), (1, 1, 1), (0.55, 0.45, 0.4), 0.48, 0.56)
        mix = N.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        L.new(colr, mix.inputs['A'])
        L.new(patches, mix.inputs['B'])
        L.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
        bump(noise(sc * 8, 8, 0.65, 0.5), 0.35, 0.02)
    else:  # chitin: glossy with growth bands
        sep = N.new('ShaderNodeSeparateXYZ')
        L.new(tc.outputs['Object'], sep.inputs['Vector'])
        band = math('SINE', math('MULTIPLY', sep.outputs['Y'], sc * 6.0), 0)
        sh = N.new('ShaderNodeMix')
        sh.data_type = 'RGBA'
        sh.blend_type = 'MULTIPLY'
        L.new(math('MULTIPLY', math('ADD', band, 1.0), 0.18), sh.inputs['Factor'])
        L.new(colr, sh.inputs['A'])
        sh.inputs['B'].default_value = (0.4, 0.35, 0.3, 1)
        L.new(sh.outputs['Result'], bsdf.inputs['Base Color'])
        bump(math('ADD', math('MULTIPLY', band, 0.3), math('MULTIPLY', noise(sc * 5, 5), 0.3)), 0.3, 0.01)


for mk, m in mats.items():
    build_material(m, PAL.get(mk, ('solid', (0.5, 0.5, 0.5))))
SC.render.engine = 'CYCLES'
SC.cycles.device = 'CPU'
SC.cycles.samples = 4
SC.render.bake.margin = 6


def bake(kind, name, **kw):
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False)
    if kind == 'NORMAL':
        img.colorspace_settings.name = 'Non-Color'
    for m in mats.values():
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        m.node_tree.nodes.active = n
    bpy.ops.object.select_all(action='DESELECT')
    main.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.bake(type=kind, use_clear=True, target='IMAGE_TEXTURES', **kw)
    a = np.empty(ATLAS * ATLAS * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(ATLAS, ATLAS, 4)


col = bake('DIFFUSE', 'col', pass_filter={'COLOR'})
ao = bake('AO', 'ao')
nrm = bake('NORMAL', 'nrm', normal_space='TANGENT')
col[..., :3] *= (0.62 + 0.38 * ao[..., :3])
col[..., 3] = 1
nrm[..., 3] = 1


def save_png(a, path):
    im = bpy.data.images.new('o', a.shape[1], a.shape[0], alpha=True)
    im.pixels.foreach_set(np.clip(a, 0, 1).astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


def half(a):
    return a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, a.shape[2]).mean(axis=(1, 3))


save_png(col, os.path.join(TEXOUT, f'cr_{KIND}_c_1024.png'))
save_png(nrm, os.path.join(TEXOUT, f'cr_{KIND}_n_1024.png'))
save_png(half(col), os.path.join(TEXOUT, f'cr_{KIND}_c_512.png'))
save_png(half(nrm), os.path.join(TEXOUT, f'cr_{KIND}_n_512.png'))

# ------------------------------------------------------------------ armature + export
me.materials.clear()
me.materials.append(bpy.data.materials.new('cr'))
for p_ in me.polygons:
    p_.material_index = 0
arm_d = bpy.data.armatures.new('skel_' + KIND)
arm = bpy.data.objects.new('skel_' + KIND, arm_d)
SC.collection.objects.link(arm)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for n in NAMES:
    b = arm_d.edit_bones.new(n)
    b.head = G(*POS[n])
    b.tail = b.head + Vector((0, 0, 0.05))
    eb[n] = b
for n in NAMES:
    if PAR[n]:
        eb[n].parent = eb[PAR[n]]
bpy.ops.object.mode_set(mode='OBJECT')
main.parent = arm
mod = main.modifiers.new('skin', 'ARMATURE')
mod.object = arm
bpy.ops.object.select_all(action='DESELECT')
main.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
path = os.path.join(OUT, f'cr_{KIND}.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_skins=True, export_animations=False,
                          export_materials='NONE', export_normals=True, export_texcoords=True, export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'cr_{KIND}.blend'))
print('EXPORTED', path, flush=True)

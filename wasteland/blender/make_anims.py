# Blender 4.5 (headless): retarget CC0 animation libraries onto the game's own rigs.
#   blender -b --factory-startup --python make_anims.py -- ANIM_DIR OUT_JSON
# Humans: Quaternius' Universal Animation Library 1 and 2 (Standard, CC0) -> the game's 17-joint rig.
# Animals: Quaternius' Ultimate Animated Animal Pack (CC0) wolf / cow / fox -> the Quadruped rig
#   (hound / cattle / burrower).
# Every game joint rests with an identity rotation in character space (x = left, y = up, z = forward), so
# a joint's pose is the world-space rotation its source bone has turned through since the source rest pose.
# Where the two rest poses differ (the library's T-pose arms against the game's arms-down rig, splayed
# legs), that rotation is measured from the source bone turned onto the game bone's rest direction.
# Output: one JSON file with, per rig, its joint list and clips of 30 fps int16 quaternions (local, per
# joint) plus the root offset, base64-encoded.
import bpy, sys, os, json, math, base64
import numpy as np
from mathutils import Quaternion, Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
ADIR, OUT = os.path.abspath(ARGS[0]), os.path.abspath(ARGS[1])
FPS = 30
UAL1 = os.path.join(ADIR, 'Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb')
UAL2 = os.path.join(ADIR, 'x_ual2_standard/Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb')


def gq(q):  # Blender world (z up, facing -y) -> game (y up, facing +z)
    return Quaternion((q.w, q.x, q.z, -q.y))


def gv(v):
    return Vector((v.x, v.z, -v.y))


def swing(a, b):
    """shortest rotation turning direction a onto direction b"""
    a, b = a.normalized(), b.normalized()
    return a.rotation_difference(b)


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS  # the importer maps glTF seconds to frames at this rate: one frame per key
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    if arm.animation_data is None:
        arm.animation_data_create()
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    return arm


def use_action(arm, act):
    ad = arm.animation_data
    ad.action = act
    if hasattr(ad, 'action_slot') and act.slots and ad.action_slot is None:
        ad.action_slot = act.slots[0]


def frames_of(act):
    a, b = act.frame_range
    return list(range(int(round(a)), int(round(b)) + 1))


def enc_q(qs):
    a = np.clip(np.round(np.array(qs, np.float64) * 32767), -32767, 32767).astype('<i2')
    return base64.b64encode(a.tobytes()).decode('ascii')


def enc_v(vs, scale):
    a = np.clip(np.round(np.array(vs, np.float64) * scale), -32767, 32767).astype('<i2')
    return base64.b64encode(a.tobytes()).decode('ascii')


# ---------------------------------------------------------------- humans
HJ = ['hips', 'spine', 'chest', 'neck', 'head', 'sh_r', 'el_r', 'hand_r', 'sh_l', 'el_l', 'hand_l', 'hip_r', 'kn_r', 'an_r', 'hip_l', 'kn_l', 'an_l']
HPARENT = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'sh_r': 'chest', 'el_r': 'sh_r', 'hand_r': 'el_r',
           'sh_l': 'chest', 'el_l': 'sh_l', 'hand_l': 'el_l', 'hip_r': 'hips', 'kn_r': 'hip_r', 'an_r': 'kn_r', 'hip_l': 'hips', 'kn_l': 'hip_l', 'an_l': 'kn_l'}
# the game rig at rest (MakeHuman survivor, game coordinates)
HREST = {'hips': (0, 0.938, 0.014), 'spine': (0, 1.022, -0.027), 'chest': (0, 1.169, -0.009), 'neck': (0, 1.501, 0.005), 'head': (0, 1.606, 0.046),
         'sh_r': (-0.177, 1.403, 0.02), 'el_r': (-0.196, 1.152, 0.02), 'hand_r': (-0.204, 0.903, 0.025),
         'sh_l': (0.177, 1.403, 0.02), 'el_l': (0.196, 1.152, 0.02), 'hand_l': (0.204, 0.903, 0.025),
         'hip_r': (-0.106, 0.93, 0.005), 'kn_r': (-0.148, 0.523, 0.039), 'an_r': (-0.188, 0.1, 0.024),
         'hip_l': (0.106, 0.93, 0.005), 'kn_l': (0.148, 0.523, 0.039), 'an_l': (0.188, 0.1, 0.024)}
# limb joints whose rest pose differs from the library's: (from joint, to joint) of the game bone
HDIR = {'sh_r': ('sh_r', 'el_r'), 'el_r': ('el_r', 'hand_r'), 'hand_r': ('el_r', 'hand_r'), 'sh_l': ('sh_l', 'el_l'), 'el_l': ('el_l', 'hand_l'), 'hand_l': ('el_l', 'hand_l'),
        'hip_r': ('hip_r', 'kn_r'), 'kn_r': ('kn_r', 'an_r'), 'hip_l': ('hip_l', 'kn_l'), 'kn_l': ('kn_l', 'an_l')}
MAP1 = {'hips': 'DEF-hips', 'spine': 'DEF-spine.001', 'chest': 'DEF-spine.003', 'neck': 'DEF-neck', 'head': 'DEF-head',
        'sh_r': 'DEF-upper_arm.R', 'el_r': 'DEF-forearm.R', 'hand_r': 'DEF-hand.R', 'sh_l': 'DEF-upper_arm.L', 'el_l': 'DEF-forearm.L', 'hand_l': 'DEF-hand.L',
        'hip_r': 'DEF-thigh.R', 'kn_r': 'DEF-shin.R', 'an_r': 'DEF-foot.R', 'hip_l': 'DEF-thigh.L', 'kn_l': 'DEF-shin.L', 'an_l': 'DEF-foot.L'}
MAP2 = {'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_03', 'neck': 'neck_01', 'head': 'Head',
        'sh_r': 'upperarm_r', 'el_r': 'lowerarm_r', 'hand_r': 'hand_r', 'sh_l': 'upperarm_l', 'el_l': 'lowerarm_l', 'hand_l': 'hand_l',
        'hip_r': 'thigh_r', 'kn_r': 'calf_r', 'an_r': 'foot_r', 'hip_l': 'thigh_l', 'kn_l': 'calf_l', 'an_l': 'foot_l'}
# game clip name: (library, action, loop, locomotion)
HCLIPS = {
    'idle': (1, 'Idle_Loop', True, False), 'walk': (1, 'Walk_Loop', True, True), 'jog': (1, 'Jog_Fwd_Loop', True, True), 'sprint': (1, 'Sprint_Loop', True, True),
    'crouchIdle': (1, 'Crouch_Idle_Loop', True, False), 'crouchWalk': (1, 'Crouch_Fwd_Loop', True, True),
    'pistolIdle': (1, 'Pistol_Idle_Loop', True, False), 'aim': (1, 'Pistol_Aim_Neutral', False, False), 'shoot': (1, 'Pistol_Shoot', False, False),
    'swordIdle': (1, 'Sword_Idle', True, False), 'sword': (1, 'Sword_Attack', False, False), 'swordA': (2, 'Sword_Regular_A', False, False), 'swordB': (2, 'Sword_Regular_B', False, False),
    'jab': (1, 'Punch_Jab', False, False), 'cross': (1, 'Punch_Cross', False, False), 'hook': (2, 'Melee_Hook', False, False),
    'kneel': (1, 'Fixing_Kneeling', True, False), 'chop': (2, 'TreeChopping_Loop', True, False), 'harvest': (2, 'Farm_Harvest', True, False), 'eat': (2, 'Consume', True, False),
    'hitChest': (1, 'Hit_Chest', False, False), 'hitHead': (1, 'Hit_Head', False, False), 'death': (1, 'Death01', False, False), 'wake': (2, 'LayToIdle', False, False),
    'talk': (1, 'Idle_Talking_Loop', True, False), 'foldArms': (2, 'Idle_FoldArms_Loop', True, False),
    'zIdle': (2, 'Zombie_Idle_Loop', True, False), 'zWalk': (2, 'Zombie_Walk_Fwd_Loop', True, True), 'zScratch': (2, 'Zombie_Scratch', False, False),
}
SRC_HIP_H = 0.917  # the library's pelvis height at rest


def human_rig(arm, MAP):
    """per game joint: source pose bone, its rest world rotation, and the rest-pose correction C"""
    Mw = arm.matrix_world
    rig = {}
    for j in HJ:
        b = arm.data.bones[MAP[j]]
        rest_w = (Mw @ b.matrix_local).to_quaternion()
        C = Quaternion()
        if j in HDIR:
            src_dir = gv((Mw @ b.tail_local) - (Mw @ b.head_local))
            f, t = HDIR[j]
            C = swing(src_dir, Vector(HREST[t]) - Vector(HREST[f]))
        rig[j] = (arm.pose.bones[MAP[j]], rest_w, C)
    return rig


TOES = ['DEF-toe.R', 'DEF-toe.L']


def sample_human(arm, rig, act, loop, loco):
    use_action(arm, act)
    Mw = arm.matrix_world
    pel = rig['hips'][0]
    rest_pel = gv(Mw @ arm.data.bones[pel.name].head_local)
    fr = frames_of(act)
    frames = []
    for f in fr:
        bpy.context.scene.frame_set(f)
        W = {}
        for j in HJ:
            pb, rest_w, C = rig[j]
            D = (Mw @ pb.matrix).to_quaternion() @ rest_w.inverted()  # source world rotation since rest
            W[j] = gq(D) @ C.inverted()  # game joint world rotation (C is already in game axes)
        L = []
        for j in HJ:
            q = W[j] if j == 'hips' else W[HPARENT[j]].inverted() @ W[j]
            q.normalize()
            L.append(q)
        pos = gv(Mw @ pel.matrix @ Vector((0, 0, 0))) - rest_pel
        feet = [gv(Mw @ arm.pose.bones[t].matrix @ Vector((0, 0, 0))) for t in TOES]  # toes: runners land on the forefoot
        frames.append((L, pos, feet))
    if loop and len(frames) > 2:  # a loop's last key repeats its first
        a, b = frames[0][0], frames[-1][0]
        if sum(abs(x.dot(y)) for x, y in zip(a, b)) / len(a) > 0.999:
            frames = frames[:-1]
    speed = None
    if loco:
        # natural ground speed: how fast the planted foot slides backward, in pelvis heights per second
        n = len(frames)
        vs = []
        for k in range(2):
            ys = [fr_[2][k].y for fr_ in frames]
            low = min(ys) + 0.02
            for i in range(n):
                a, b = frames[i][2][k], frames[(i + 1) % n][2][k]
                if a.y < low and b.y < low:
                    vs.append(-(b.z - a.z) * FPS)
        speed = float(np.median(vs)) / SRC_HIP_H if vs else None
        # start every locomotion loop with the left foot furthest forward, so blended cycles stay in step
        zs = [fr_[2][1].z - fr_[1].z for fr_ in frames]
        s = int(np.argmax(zs))
        frames = frames[s:] + frames[:s]
    # quaternion signs continuous in time for interpolation
    for j in range(len(HJ)):
        for i in range(1, len(frames)):
            if frames[i][0][j].dot(frames[i - 1][0][j]) < 0:
                frames[i][0][j].negate()
    qs = [[c for q in fr_[0] for c in (q.x, q.y, q.z, q.w)] for fr_ in frames]
    ps = [[fr_[1].x / SRC_HIP_H, fr_[1].y / SRC_HIP_H, fr_[1].z / SRC_HIP_H] for fr_ in frames]
    clip = {'n': len(frames), 'loop': 1 if loop else 0, 'q': enc_q(qs), 'p': enc_v(ps, 16384)}
    if speed:
        clip['v'] = round(speed, 4)
    return clip


def humans():
    out = {'joints': HJ, 'fps': FPS, 'clips': {}}
    global TOES
    for lib, path, MAP in ((1, UAL1, MAP1), (2, UAL2, MAP2)):
        arm = load(path)
        TOES = ['DEF-toe.R', 'DEF-toe.L'] if lib == 1 else ['ball_r', 'ball_l']
        rig = human_rig(arm, MAP)
        for name, (l, act_name, loop, loco) in HCLIPS.items():
            if l != lib:
                continue
            act = bpy.data.actions.get(act_name)
            if not act:
                print('MISSING', act_name)
                continue
            c = sample_human(arm, rig, act, loop, loco)
            out['clips'][name] = c
            print('HCLIP', name, act_name, c['n'], 'frames', 'speed', c.get('v'), flush=True)
    return out


# ---------------------------------------------------------------- animals
QJ = ['body', 'neck', 'head', 'hip0', 'knee0', 'hip1', 'knee1', 'hip2', 'knee2', 'hip3', 'knee3', 'tail0', 'tail1', 'tail2']
# the Quadruped rig's proportions (09b_creatures.js): length, body height, hip half-width, upper and lower leg
QDIM = {'hound': dict(L=0.95, H=0.62, W=0.15, up=0.3, lo=0.3), 'cattle': dict(L=1.7, H=1.18, W=0.3, up=0.5, lo=0.55),
        'burrower': dict(L=0.8, H=0.34, W=0.16, up=0.14, lo=0.16)}
QLEGS = [(-1, 1), (1, 1), (-1, -1), (1, -1)]  # right front, left front, right back, left back (x < 0 is right)
QSRC_LEG = [('FrontUpperLeg.R', 'FF.R'), ('FrontUpperLeg.L', 'FF.L'), ('BackLeg.R', 'FFB.R'), ('BackLeg.L', 'FFB.L')]
QSRC = {'body': 'Torso2', 'neck': 'Neck1', 'head': 'Head', 'tail0': 'Tail1', 'tail1': 'Tail3', 'tail2': 'Tail5'}
QPARENT = {'neck': 'body', 'head': 'neck', 'tail0': 'body', 'tail1': 'tail0', 'tail2': 'tail1'}
# kind: (file, {game clip: (action, loop, locomotion)})
QCLIPS = {
    'hound': ('Wolf.gltf', {'idle': ('Idle', True, False), 'sniff': ('Idle_2_HeadLow', True, False), 'walk': ('Walk', True, True), 'run': ('Gallop', True, True),
                            'attack': ('Attack', False, False), 'eat': ('Eating', True, False), 'hit': ('Idle_HitReact1', False, False), 'death': ('Death', False, False)}),
    'cattle': ('Cow.gltf', {'idle': ('Idle', True, False), 'idle2': ('Idle_2', True, False), 'walk': ('Walk', True, True), 'run': ('Gallop', True, True),
                            'attack': ('Attack_Headbutt', False, False), 'eat': ('Eating', True, False), 'hit': ('Idle_HitReact1', False, False), 'death': ('Death', False, False)}),
    'burrower': ('Fox.gltf', {'idle': ('Idle', True, False), 'sniff': ('Idle_2_HeadLow', True, False), 'walk': ('Walk', True, True), 'run': ('Gallop', True, True),
                              'attack': ('Attack', False, False), 'eat': ('Eating', True, False), 'hit': ('Idle_HitReact1', False, False), 'death': ('Death', False, False)}),
}


def quad_rest(kind):
    """game rig rest positions (character space, feet on the ground at y=0)"""
    D = QDIM[kind]
    P = {'body': Vector((0, D['H'], 0))}
    P['neck'] = P['body'] + Vector((0, 0.08, D['L'] * 0.5))
    P['head'] = P['neck'] + Vector((0, 0.14, 0.2 * D['L'] / 0.95))
    P['snout'] = P['head'] + Vector((0, 0, 0.2))
    for i, (sx, sz) in enumerate(QLEGS):
        P['hip%d' % i] = P['body'] + Vector((sx * D['W'], -0.02, sz * D['L'] * 0.36))
    P['tail0'] = P['body'] + Vector((0, 0.05, -D['L'] / 2))
    P['tail1'] = P['tail0'] + Vector((0, 0, -0.12 * D['L'] / 0.95))
    P['tail2'] = P['tail1'] + Vector((0, 0, -0.12 * D['L'] / 0.95))
    P['tail3'] = P['tail2'] + Vector((0, 0, -0.12 * D['L'] / 0.95))
    return P


def ik2(v, a, b, knee_fwd):
    """hip and knee x-rotations putting a two-segment leg (lengths a, b, hanging along -y) on the foot offset v (y, z)"""
    d = max(abs(a - b) + 1e-4, min(a + b - 1e-4, math.hypot(v[0], v[1])))
    cos_in = (a * a + b * b - d * d) / (2 * a * b)
    bend = math.pi - math.acos(max(-1.0, min(1.0, cos_in)))  # 0 = straight
    # R_x(t) turns the downward leg (0,-1,0) to (0, -cos t, -sin t): positive t swings the foot backward (-z)
    reach = math.atan2(-v[1], -v[0])  # angle of the hip->foot line from straight down, positive = backward
    off = math.asin(max(-1.0, min(1.0, b * math.sin(bend) / d)))
    if knee_fwd:  # the knee sits ahead of the hip->foot line: thigh swings forward of it, shin folds back
        return reach - off, bend
    return reach + off, -bend


def quad(kind, path, clips):
    arm = load(path)
    Mw = arm.matrix_world
    D = QDIM[kind]
    T = quad_rest(kind)
    B = arm.data.bones
    PB = arm.pose.bones
    wpos = lambda name: gv(Mw @ PB[name].matrix @ Vector((0, 0, 0)))
    rpos = lambda name: gv(Mw @ B[name].head_local)
    rest_q = {j: (Mw @ B[n].matrix_local).to_quaternion() for j, n in QSRC.items()}
    # rest-pose corrections for the neck, head and tail segments (source bone direction -> game bone direction)
    tgt_next = {'neck': ('neck', 'head'), 'head': ('head', 'snout'), 'tail0': ('tail0', 'tail1'), 'tail1': ('tail1', 'tail2'), 'tail2': ('tail2', 'tail3')}
    C = {'body': Quaternion()}
    for j, (f, t) in tgt_next.items():
        b = B[QSRC[j]]
        C[j] = swing(gv((Mw @ b.tail_local) - (Mw @ b.head_local)), T[t] - T[f])
    src_body0 = rpos(QSRC['body'])
    s_body = T['body'].y / src_body0.y
    legs = []
    for i, (hip_n, paw_n) in enumerate(QSRC_LEG):
        h0, p0 = rpos(hip_n), rpos(paw_n)
        legs.append((hip_n, paw_n, h0, (D['up'] + D['lo']) / (h0 - p0).length))
    out = {'joints': QJ, 'fps': FPS, 'clips': {}}
    for name, (act_name, loop, loco) in clips.items():
        act = bpy.data.actions.get(act_name)
        if not act:
            print('MISSING', kind, act_name)
            continue
        use_action(arm, act)
        frames = []
        for f in frames_of(act):
            bpy.context.scene.frame_set(f)
            W = {j: gq((Mw @ PB[n].matrix).to_quaternion() @ rest_q[j].inverted()) @ C[j].inverted() for j, n in QSRC.items()}
            body_pos = T['body'] + (wpos(QSRC['body']) - src_body0) * s_body
            Qb = W['body']
            L = {'body': Qb}
            for j in ('neck', 'head', 'tail0', 'tail1', 'tail2'):
                L[j] = W[QPARENT[j]].inverted() @ W[j]
            paws = []
            for i, (hip_n, paw_n, h0, s) in enumerate(legs):
                paw = wpos(paw_n)
                foot = Vector((T['hip%d' % i].x + (paw.x - h0.x) * s, paw.y * s, T['hip%d' % i].z + (paw.z - h0.z) * s))
                hip_w = body_pos + Qb @ (T['hip%d' % i] - T['body'])
                v = Qb.inverted() @ (foot - hip_w)
                th, tk = ik2((v.y, v.z), D['up'], D['lo'], knee_fwd=(i < 2))
                L['hip%d' % i] = Quaternion(Vector((1, 0, 0)), th)
                L['knee%d' % i] = Quaternion(Vector((1, 0, 0)), tk)
                paws.append(paw * s)
            frames.append(([L[j].normalized() for j in QJ], body_pos - T['body'], paws))
        if loop and len(frames) > 2:
            a, b = frames[0][0], frames[-1][0]
            if sum(abs(x.dot(y)) for x, y in zip(a, b)) / len(a) > 0.999:
                frames = frames[:-1]
        speed = None
        if loco:  # how fast a planted paw slides back, in game leg lengths per second
            n = len(frames)
            vs = []
            for k in range(4):
                ys = [fr_[2][k].y for fr_ in frames]
                low = min(ys) + 0.02 * (D['up'] + D['lo'])
                for i in range(n):
                    a, b = frames[i][2][k], frames[(i + 1) % n][2][k]
                    if a.y < low and b.y < low:
                        vs.append(-(b.z - a.z) * FPS)
            speed = float(np.median(vs)) / (D['up'] + D['lo']) if vs else None
            zs = [fr_[2][1].z for fr_ in frames]  # start with the left front paw furthest forward
            st = int(np.argmax(zs))
            frames = frames[st:] + frames[:st]
        for j in range(len(QJ)):
            for i in range(1, len(frames)):
                if frames[i][0][j].dot(frames[i - 1][0][j]) < 0:
                    frames[i][0][j].negate()
        qs = [[c for q in fr_[0] for c in (q.x, q.y, q.z, q.w)] for fr_ in frames]
        hs = D['H']
        ps = [[fr_[1].x / hs, fr_[1].y / hs, fr_[1].z / hs] for fr_ in frames]
        clip = {'n': len(frames), 'loop': 1 if loop else 0, 'q': enc_q(qs), 'p': enc_v(ps, 16384)}
        if speed:
            clip['v'] = round(speed, 4)
        out['clips'][name] = clip
        print('QCLIP', kind, name, act_name, clip['n'], 'frames', 'speed', clip.get('v'), flush=True)
    return out


if __name__ == '__main__':
    data = {'human': humans()}
    for kind, (fn, clips) in QCLIPS.items():
        data[kind] = quad(kind, os.path.join(ADIR, 'uaa', fn), clips)
    json.dump(data, open(OUT, 'w'), separators=(',', ':'))
    print('WROTE', OUT, os.path.getsize(OUT))

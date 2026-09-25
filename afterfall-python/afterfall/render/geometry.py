"""Unit primitives and fast mesh building from numpy straight into Panda3D geometry.

Primitives are defined in simulation space (right-handed, z up, counter-clockwise outward faces).
`to_panda` swaps y and z for Panda3D's left-handed y-up coordinate system; the mirror and the
change of handedness cancel out, so triangle order is kept as is.
"""
import math

import numpy as np
from panda3d.core import (Geom, GeomEnums, GeomNode, GeomTriangles, GeomVertexArrayFormat, GeomVertexData,
                          GeomVertexFormat, InternalName)


def _cube():
    v, n, t = [], [], []
    faces = [((1, 0, 0), (0, 1, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
             ((0, 1, 0), (0, 0, 1), (1, 0, 0)), ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
             ((0, 0, 1), (1, 0, 0), (0, 1, 0)), ((0, 0, -1), (0, 1, 0), (1, 0, 0))]
    for nrm, u, w in faces:
        nrm, u, w = np.array(nrm, float), np.array(u, float), np.array(w, float)
        base = len(v)
        for su, sw in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v.append(nrm * .5 + u * .5 * su + w * .5 * sw)
            n.append(nrm)
        t += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    return np.array(v), np.array(n), np.array(t)


def _cylinder(seg=14):
    v, n, t = [], [], []
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
        b = len(v)
        v += [(c0 * .5, s0 * .5, -.5), (c1 * .5, s1 * .5, -.5), (c1 * .5, s1 * .5, .5), (c0 * .5, s0 * .5, .5)]
        n += [(c0, s0, 0), (c1, s1, 0), (c1, s1, 0), (c0, s0, 0)]
        t += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
        for z, sgn in ((.5, 1), (-.5, -1)):
            b = len(v)
            v += [(0, 0, z), (c0 * .5, s0 * .5, z), (c1 * .5, s1 * .5, z)]
            n += [(0, 0, sgn)] * 3
            t.append((b, b + 1, b + 2) if sgn > 0 else (b, b + 2, b + 1))
    return np.array(v, float), np.array(n, float), np.array(t)


def _cone(seg=12):
    v, n, t = [], [], []
    slope = .5  # radius / height
    for i in range(seg):
        a0, a1, am = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg, 2 * math.pi * (i + .5) / seg
        b = len(v)
        v += [(math.cos(a0) * .5, math.sin(a0) * .5, -.5), (math.cos(a1) * .5, math.sin(a1) * .5, -.5), (0, 0, .5)]
        for a in (a0, a1, am):
            nn = np.array([math.cos(a), math.sin(a), slope])
            n.append(nn / np.linalg.norm(nn))
        t.append((b, b + 1, b + 2))
        b = len(v)
        v += [(0, 0, -.5), (math.cos(a1) * .5, math.sin(a1) * .5, -.5), (math.cos(a0) * .5, math.sin(a0) * .5, -.5)]
        n += [(0, 0, -1)] * 3
        t.append((b, b + 1, b + 2))
    return np.array(v, float), np.array(n, float), np.array(t)


def _sphere(subdiv=2):
    p = (1 + math.sqrt(5)) / 2
    verts = [(-1, p, 0), (1, p, 0), (-1, -p, 0), (1, -p, 0), (0, -1, p), (0, 1, p), (0, -1, -p), (0, 1, -p),
             (p, 0, -1), (p, 0, 1), (-p, 0, -1), (-p, 0, 1)]
    verts = [np.array(x, float) / np.linalg.norm(x) for x in verts]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(subdiv):
        cache, nf = {}, []

        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                m = verts[a] + verts[b]
                verts.append(m / np.linalg.norm(m))
                cache[key] = len(verts) - 1
            return cache[key]

        for a, b, c in faces:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = nf
    v = np.array(verts)
    return v * .5, v.copy(), np.array(faces)


PRIMS = {"cube": _cube(), "cylinder": _cylinder(), "cone": _cone(), "sphere": _sphere(2)}
PRIMS_LOW = {"cube": PRIMS["cube"], "cylinder": _cylinder(8), "cone": _cone(8), "sphere": _sphere(1)}


def to_panda(v):
    """Simulation (x, y, z-up) -> Panda3D (x, y-up, z)."""
    return v[..., [0, 2, 1]]


_FORMATS = {}


def _format(extra):
    """v3 n3 c4 plus optional float columns, e.g. (("tex3", 3), ("material", 1))."""
    key = tuple(extra)
    if key not in _FORMATS:
        arr = GeomVertexArrayFormat()
        arr.add_column(InternalName.get_vertex(), 3, GeomEnums.NT_float32, GeomEnums.C_point)
        arr.add_column(InternalName.get_normal(), 3, GeomEnums.NT_float32, GeomEnums.C_normal)
        arr.add_column(InternalName.get_color(), 4, GeomEnums.NT_float32, GeomEnums.C_color)
        for name, n in key:
            arr.add_column(InternalName.make(name), n, GeomEnums.NT_float32, GeomEnums.C_other)
        _FORMATS[key] = GeomVertexFormat.register_format(arr)
    return _FORMATS[key]


def make_geom_node(name, pos, nrm, col, tris, tex=None, mat=None, splat=None):
    """pos/nrm (N,3) and col (N,4) already in Panda space; tris (M,3) counter-clockwise in simulation space.

    World geometry also carries `tex` (N,3: position in the part's own frame, metres) and `mat` (N,: texture
    layer, 0 = none); the terrain carries `splat` (N,4: ground material weights)."""
    n = len(pos)
    cols = [pos, nrm, col]
    extra = []
    if splat is not None:
        cols.append(splat)
        extra.append(("splat", 4))
    else:
        cols.append(tex if tex is not None else np.zeros((n, 3)))
        cols.append((mat if mat is not None else np.zeros(n)).reshape(n, 1))
        extra += [("tex3", 3), ("material", 1)]
    data = np.ascontiguousarray(np.concatenate(cols, axis=1), dtype=np.float32)
    vdata = GeomVertexData(name, _format(extra), Geom.UH_static)
    vdata.unclean_set_num_rows(n)
    memoryview(vdata.modify_array(0)).cast("B")[:] = data.tobytes()
    prim = GeomTriangles(Geom.UH_static)
    prim.set_index_type(GeomEnums.NT_uint32)
    idx = np.ascontiguousarray(tris, dtype=np.uint32).ravel()
    arr = prim.modify_vertices()
    arr.unclean_set_num_rows(len(idx))
    memoryview(arr).cast("B")[:] = idx.tobytes()
    geom = Geom(vdata)
    geom.add_primitive(prim)
    node = GeomNode(name)
    node.add_geom(geom)
    return node


def build_parts(parts, low=False):
    """Merge a list of world.Part into arrays (panda space). Returns pos, nrm, col, tris, tex, mat or None."""
    if not parts:
        return None
    prims = PRIMS_LOW if low else PRIMS
    out_p, out_n, out_c, out_t, out_x, out_m = [], [], [], [], [], []
    offset = 0
    by_shape = {}
    for p in parts:
        by_shape.setdefault(p.shape, []).append(p)
    for shape, group in by_shape.items():
        pv, pn, pt = prims[shape]
        m = np.stack([p.m for p in group])                    # (P,3,3)
        t = np.stack([p.pos for p in group])                  # (P,3)
        verts = np.einsum("pij,vj->pvi", m, pv) + t[:, None, :]
        inv_t = np.linalg.inv(m + np.eye(3) * 1e-9).transpose(0, 2, 1)
        nrms = np.einsum("pij,vj->pvi", inv_t, pn)
        nrms /= np.linalg.norm(nrms, axis=2, keepdims=True) + 1e-9
        cols = np.array([p.color for p in group])             # (P,3)
        sway = np.array([p.sway for p in group])
        anchor = np.array([p.anchor if p.anchor is not None else p.pos[2] for p in group])
        # sway weight grows with height above the plant's base, stored in the colour's alpha
        height = np.clip((verts[:, :, 2] - anchor[:, None]) / 9.0, 0, 1.2)
        alpha = sway[:, None] * height
        P, V = verts.shape[:2]
        col = np.concatenate([np.repeat(cols[:, None, :], V, axis=1), alpha[:, :, None]], axis=2)
        # texture space: the unit primitive scaled to metres in the part's own (unrotated) frame, shifted by a
        # per-part offset so neighbouring walls don't repeat the same bricks
        size = np.linalg.norm(m, axis=1)                      # column norms = the part's size along each axis
        shift = np.stack([np.sin(t[:, 0] * 12.9898 + t[:, 1] * 78.233), np.sin(t[:, 1] * 39.346 + t[:, 2] * 11.135),
                          np.sin(t[:, 0] * 73.156 + t[:, 2] * 52.235)], axis=1) * 43758.5453 % 1.0 * 20.0
        tex = pv[None, :, :] * size[:, None, :] + shift[:, None, :]
        mats = np.array([p.mat for p in group], dtype=np.float32)
        out_p.append(verts.reshape(-1, 3))
        out_n.append(nrms.reshape(-1, 3))
        out_c.append(col.reshape(-1, 4))
        out_x.append(tex.reshape(-1, 3))
        out_m.append(np.repeat(mats, V))
        tris = (pt[None, :, :] + (np.arange(P) * V)[:, None, None]).reshape(-1, 3) + offset
        out_t.append(tris)
        offset += P * V
    pos = to_panda(np.concatenate(out_p))
    nrm = to_panda(np.concatenate(out_n))
    return pos, nrm, np.concatenate(out_c), np.concatenate(out_t), np.concatenate(out_x), np.concatenate(out_m)


def node_from_parts(name, parts, low=False):
    built = build_parts(parts, low)
    if built is None:
        return None
    pos, nrm, col, tris, tex, mat = built
    return make_geom_node(name, pos, nrm, col, tris, tex, mat)


def unit_node(shape, low=False):
    """A white unit primitive for characters and props (tinted with set_color_scale)."""
    v, n, t = (PRIMS_LOW if low else PRIMS)[shape]
    col = np.ones((len(v), 4), dtype=np.float32)
    col[:, 3] = 0
    return make_geom_node(shape, to_panda(v), to_panda(n), col, t)

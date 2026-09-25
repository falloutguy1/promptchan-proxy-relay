"""Build-time only: turn the Quaternius glTF parts into one skinned model per character, and the animation
library into one small .bam per clip. Needs panda3d-gltf (installed with Ursina)."""
import numpy as np
from panda3d.core import (Filename, Geom, GeomEnums, GeomNode, GeomTriangles, GeomVertexReader, GeomVertexRewriter, JointVertexTransform,
                          MaterialAttrib, NodePath, TransformBlend, TransformBlendTable)

HEAD_JOINTS = {"Head", "neck_01"}


def _load(loader, path):
    return loader.load_model(Filename.from_os_specific(str(path)), noCache=True)


def export_clips(loader, sources, wanted, out_dir):
    """Write each wanted clip as its own .bam (an AnimBundleNode). Returns {clip: {frames, fps}}."""
    info = {}
    for src in sources:
        model = _load(loader, src)
        for abn in model.find_all_matches("**/+AnimBundleNode"):
            bundle = abn.node().get_bundle()
            name = bundle.get_name()
            if name in wanted and name not in info:
                NodePath(abn.node()).write_bam_file(Filename.from_os_specific(str(out_dir / f"{name}.bam")))
                info[name] = {"frames": bundle.get_num_frames(), "fps": bundle.get_base_frame_rate()}
    missing = set(wanted) - set(info)
    if missing:
        raise RuntimeError(f"animation clips not found: {sorted(missing)}")
    return info


def _material_name(state):
    ma = state.get_attrib(MaterialAttrib)
    return ma.get_material().get_name() if ma and ma.get_material() else ""


def _kind(material):
    if "Hair" in material:
        return "hair"
    if "Eye" in material:
        return "eyes"
    if "Superhero" in material or "Regular" in material:
        return "skin"
    return "cloth"


def _rebind(vdata, bundle, cache):
    """Point a geometry's skin weights at the joints of `bundle` (matched by name)."""
    old = vdata.get_transform_blend_table()
    new = TransformBlendTable()
    remap = np.zeros(old.get_num_blends(), dtype=np.int64)
    for b in range(old.get_num_blends()):
        blend = old.get_blend(b)
        nb = TransformBlend()
        for k in range(blend.get_num_transforms()):
            name = blend.get_transform(k).get_joint().get_name()
            if name not in cache:
                joint = bundle.find_child(name)
                if joint is None:
                    raise RuntimeError(f"joint {name} missing from the outfit skeleton")
                cache[name] = JointVertexTransform(joint)
            nb.add_transform(cache[name], blend.get_weight(k))
        remap[b] = new.add_blend(nb)   # merges near-identical blends, so indices can shift
    new.set_rows(old.get_rows())
    vdata.set_transform_blend_table(new)
    if (remap != np.arange(len(remap))).any():
        rw = GeomVertexRewriter(vdata, "transform_blend")
        while not rw.is_at_end():
            rw.set_data1i(int(remap[rw.get_data1i()]))


def _keep_head(geom, vdata, table):
    """Drop every triangle that isn't mostly skinned to the head or neck (the outfit covers the rest)."""
    w = np.zeros(table.get_num_blends())
    for b in range(table.get_num_blends()):
        blend = table.get_blend(b)
        w[b] = sum(blend.get_weight(k) for k in range(blend.get_num_transforms())
                   if blend.get_transform(k).get_joint().get_name() in HEAD_JOINTS)
    r = GeomVertexReader(vdata, "transform_blend")
    vb = np.fromiter((r.get_data1i() for _ in range(vdata.get_num_rows())), dtype=np.int64, count=vdata.get_num_rows())
    prim = geom.get_primitive(0).decompose()
    dtype = np.uint32 if prim.get_index_type() == GeomEnums.NT_uint32 else np.uint16
    idx = np.frombuffer(memoryview(prim.get_vertices()).tobytes(), dtype=dtype).reshape(-1, 3)
    keep = idx[(w[vb][idx] > .5).all(axis=1)].astype(np.uint32).ravel()
    tris = GeomTriangles(Geom.UH_static)
    tris.set_index_type(GeomEnums.NT_uint32)
    arr = tris.modify_vertices()
    arr.unclean_set_num_rows(len(keep))
    memoryview(arr).cast("B")[:] = keep.tobytes()
    geom.set_primitive(0, tris)


def build_character(loader, build, spec, out_path):
    body, outfit_name, extras, drop = spec
    root = _load(loader, build / "outfits" / f"{outfit_name}_af.gltf")
    char_np = root.find("**/+Character")
    bundle = char_np.node().get_bundle(0)
    cache = {}
    pieces = []   # (geom, state, kind)

    def take(model, head_only=False, dropping=()):
        for gnp in model.find_all_matches("**/+GeomNode"):
            if any(d in gnp.get_name() or d in gnp.get_parent().get_name() for d in dropping):
                continue
            gn = gnp.node()
            for i in range(gn.get_num_geoms()):
                state = gn.get_geom_state(i)
                geom = gn.get_geom(i).make_copy()
                vdata = geom.modify_vertex_data()
                kind = _kind(_material_name(state))
                _rebind(vdata, bundle, cache)
                if head_only and kind == "skin":
                    _keep_head(geom, vdata, vdata.get_transform_blend_table())
                pieces.append((geom, state, kind))

    take(root, dropping=drop)
    take(_load(loader, build / "base" / f"Superhero_{body}_FullBody_af.gltf"), head_only=True)
    for extra in extras:
        take(_load(loader, build / "hair" / f"{extra}_af.gltf"))
    # replace the outfit's own nodes with one GeomNode per surface kind, which the game's shader tells apart
    for child in char_np.get_children():
        child.remove_node()
    tris = 0
    for kind in ("skin", "eyes", "hair", "cloth"):
        gn = GeomNode(kind)
        for geom, state, k in pieces:
            if k == kind:
                gn.add_geom(geom, state)
                tris += sum(geom.get_primitive(j).get_num_faces() for j in range(geom.get_num_primitives()))
        if gn.get_num_geoms():
            char_np.attach_new_node(gn)
    root.write_bam_file(Filename.from_os_specific(str(out_path)))
    return {"tris": tris}

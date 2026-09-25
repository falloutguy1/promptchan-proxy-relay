# Cycles sheet of a kit GLB with its atlas: pieces in a row, seen from the front (-y) and above
import bpy, sys, math, os
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
glb, tdir, kit, out = a[0], a[1], a[2], a[3]
only = a[4].split(',') if len(a) > 4 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=glb)
mat = bpy.data.materials.new(kit); mat.use_nodes = True; nt = mat.node_tree; bs = nt.nodes['Principled BSDF']
def img(fn, col):
    n = nt.nodes.new('ShaderNodeTexImage'); n.image = bpy.data.images.load(os.path.join(tdir, fn))
    if not col: n.image.colorspace_settings.name = 'Non-Color'
    return n
c = img(f'{kit}_c_1024.png', True); nt.links.new(c.outputs['Color'], bs.inputs['Base Color'])
n = img(f'{kit}_n_1024.png', False); nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
o_ = img(f'{kit}_orm_1024.png', False); sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(o_.outputs['Color'], sp.inputs['Color'])
nt.links.new(sp.outputs['Green'], bs.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], bs.inputs['Metallic'])
obs = [o for o in sc.objects if o.type == 'MESH']
if only:
    for o in obs:
        if o.name not in only: bpy.data.objects.remove(o, do_unlink=True)
    obs = [o for o in sc.objects if o.type == 'MESH']
    obs.sort(key=lambda o: only.index(o.name))
x = 0.0; top = 0
for o in obs:
    o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    o.data.materials.clear(); o.data.materials.append(mat)
    xs = [v.co.x for v in o.data.vertices]; zs = [v.co.z for v in o.data.vertices]
    o.location.x = x - min(xs); o.location.z = -min(zs) if min(zs) < 0 else 0
    x += max(xs) - min(xs) + 0.4; top = max(top, max(zs) - min(zs))
wd = bpy.data.worlds.new('w'); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.64, 0.68, 1)
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 3.2; so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(-30))
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.001))
g = bpy.data.materials.new('g'); g.use_nodes = True; g.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.3, 0.29, 0.27, 1); bpy.context.active_object.data.materials.append(g)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 1800, 800
sc.view_settings.view_transform = 'Standard'
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = max(x, top * 2.4) * 1.02
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
tgt = Vector((x / 2, 0, top * 0.45)); cam.location = tgt + Vector((0, -30, 12)); cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out; bpy.ops.render.render(write_still=True)
print('SHEET', round(x, 2), round(top, 2))

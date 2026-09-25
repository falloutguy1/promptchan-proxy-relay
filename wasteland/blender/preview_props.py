# Cycles contact sheet of exported props with their maps, laid out on a grid
import bpy, sys, math, os, glob
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
mdir, tdir, out, names = a[0], a[1], a[2], a[3].split(',')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
x = 0.0
for n in names:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(mdir, f'prop_{n}.glb'))
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    mat = bpy.data.materials.new(n); mat.use_nodes = True; nt = mat.node_tree; bs = nt.nodes['Principled BSDF']
    ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(os.path.join(tdir, f'prop_{n}_c_512.png')); nt.links.new(ti.outputs['Color'], bs.inputs['Base Color'])
    npth = os.path.join(tdir, f'prop_{n}_n_512.png')
    if os.path.exists(npth):
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(npth); tn.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    opth = os.path.join(tdir, f'prop_{n}_orm_512.png')
    if os.path.exists(opth):
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = bpy.data.images.load(opth); to.image.colorspace_settings.name = 'Non-Color'
        sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sp.inputs['Color']); nt.links.new(sp.outputs['Green'], bs.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], bs.inputs['Metallic'])
    w = max(max((o.matrix_world @ Vector(c)).x for c in o.bound_box) - min((o.matrix_world @ Vector(c)).x for c in o.bound_box) for o in new)
    for o in new:
        o.data.materials.clear(); o.data.materials.append(mat)
        o.location.x += x + w / 2
    x += w + 0.35
wd = bpy.data.worlds.new('w'); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.6, 0.62, 1)
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 3; so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(-25))
bpy.ops.mesh.primitive_plane_add(size=200)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 1600, 520
sc.view_settings.view_transform = 'Standard'
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = x + 0.2
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (x / 2, -12, 4.0); cam.rotation_euler = (Vector((x / 2, 0, 0.45)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.filepath = out; bpy.ops.render.render(write_still=True)
print('SHEET', x)

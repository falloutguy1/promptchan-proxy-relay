# Cycles preview of an exported character GLB with its atlas: front, 3/4 and back views side by side
import bpy, sys, math, os
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
glb, tex_c, tex_n, out = a[0], a[1], a[2], a[3]
DIST, TZ = float(a[4]), float(a[5])
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=glb)
mat = bpy.data.materials.new('c'); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(tex_c)
nt.links.new(ti.outputs['Color'], bsdf.inputs['Base Color']); nt.links.new(ti.outputs['Alpha'], bsdf.inputs['Alpha'])
tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(tex_n); tn.image.colorspace_settings.name = 'Non-Color'
nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
bsdf.inputs['Roughness'].default_value = 0.7
for o in sc.objects:
    if o.type == 'MESH':
        o.data.materials.clear(); o.data.materials.append(mat)
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.55, 0.58, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 3; so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(45), 0, math.radians(-30))
bpy.ops.mesh.primitive_plane_add(size=10)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.use_denoising = False; sc.cycles.device = 'CPU'
sc.render.resolution_x, sc.render.resolution_y = 640, 480
sc.view_settings.view_transform = 'Standard'
cam_d = bpy.data.cameras.new('c'); cam_d.lens = 70; cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
base = os.path.splitext(out)[0]
for name, ang in (('front', 0), ('q', 50), ('side', 90)):
    r = math.radians(ang); d = DIST
    cam.location = Vector((math.sin(r) * d, -math.cos(r) * d, TZ + d * 0.18))
    cam.rotation_euler = (Vector((0, 0, TZ)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{base}_{name}.png'; bpy.ops.render.render(write_still=True)
print('PREVIEWED')

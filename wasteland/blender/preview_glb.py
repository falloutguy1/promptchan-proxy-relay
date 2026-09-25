# Render a quick Cycles preview of a GLB whose objects are named <kind>__<material>[__lo]
#   blender -b --factory-startup --python preview_glb.py -- in.glb out.png [lo]
import bpy, math, sys, os
from mathutils import Vector
ARGS = sys.argv[sys.argv.index('--') + 1:]
GLB, OUTP = ARGS[0], ARGS[1]
WANT_LO = len(ARGS) > 2 and ARGS[2] == 'lo'
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)
COL = {'paint': (0.55, 0.12, 0.08, 1), 'glass': (0.05, 0.08, 0.1, 1), 'chrome': (0.8, 0.8, 0.82, 1), 'tire': (0.03, 0.03, 0.03, 1),
       'dark': (0.06, 0.06, 0.06, 1), 'taillight': (0.6, 0.02, 0.02, 1), 'lens': (0.9, 0.9, 0.8, 1), 'rust': (0.3, 0.12, 0.05, 1)}
mats = {}
for k, c in COL.items():
    m = bpy.data.materials.new(k); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = c
    b.inputs['Roughness'].default_value = 0.15 if k in ('chrome', 'glass', 'lens') else 0.55
    b.inputs['Metallic'].default_value = 1.0 if k == 'chrome' else 0.0
    mats[k] = m
kinds = []
for o in list(SC.objects):
    if o.type != 'MESH':
        continue
    parts = o.name.split('__')
    is_lo = len(parts) > 2 and parts[2].startswith('lo')
    if is_lo != WANT_LO:
        bpy.data.objects.remove(o, do_unlink=True); continue
    kind, mat = parts[0], parts[1].split('.')[0]
    if kind not in kinds:
        kinds.append(kind)
    o.data.materials.clear(); o.data.materials.append(mats.get(mat, mats['dark']))
    o.location.y += kinds.index(kind) * 3.2  # glTF import: Blender Y is width again
kinds_n = len(kinds)
# ground + light
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, kinds_n * 1.6 - 1.6, 0))
g = bpy.data.materials.new('g'); g.use_nodes = True; g.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.33, 0.3, 1)
bpy.context.active_object.data.materials.append(g)
w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.55, 0.62, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.5; so = bpy.data.objects.new('sun', sun); SC.collection.objects.link(so)
so.rotation_euler = (math.radians(50), 0, math.radians(35))
SC.render.engine = 'CYCLES'; SC.cycles.device = 'CPU'; SC.cycles.samples = 24; SC.cycles.use_denoising = False
SC.render.resolution_x, SC.render.resolution_y = 1400, 700
SC.view_settings.view_transform = 'Standard'
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 38; cam = bpy.data.objects.new('cam', cam_d); SC.collection.objects.link(cam); SC.camera = cam
centre = Vector((0, (kinds_n - 1) * 1.6, 0.8))
views = [('front', Vector((8.5, -6.5, 3.6))), ('rear', Vector((-8.5, -6.0, 3.2))), ('side', Vector((0.0, -11.0, 1.6)))]
base, ext = os.path.splitext(OUTP)
for name, off in views:
    cam.location = centre + off
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    SC.render.filepath = f'{base}_{name}{ext}'
    bpy.ops.render.render(write_still=True)
print('PREVIEW', kinds)

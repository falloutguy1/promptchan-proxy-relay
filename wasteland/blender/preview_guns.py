# side-view Cycles sheet of weapon props (barrel turned to +x), stacked vertically, with their maps
import bpy, sys, math, os
from mathutils import Vector, Matrix
a = sys.argv[sys.argv.index('--') + 1:]
mdir, tdir, out, names = a[0], a[1], a[2], a[3].split(',')
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
z = 0.0
for n in names:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(mdir, f'prop_{n}.glb'))
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    mat = bpy.data.materials.new(n); mat.use_nodes = True; nt = mat.node_tree; bs = nt.nodes['Principled BSDF']
    ti = nt.nodes.new('ShaderNodeTexImage'); ti.image = bpy.data.images.load(os.path.join(tdir, f'prop_{n}_c_512.png')); nt.links.new(ti.outputs['Color'], bs.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = bpy.data.images.load(os.path.join(tdir, f'prop_{n}_n_512.png')); tn.image.colorspace_settings.name = 'Non-Color'
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bs.inputs['Normal'])
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = bpy.data.images.load(os.path.join(tdir, f'prop_{n}_orm_512.png')); to.image.colorspace_settings.name = 'Non-Color'
    sp = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(to.outputs['Color'], sp.inputs['Color']); nt.links.new(sp.outputs['Green'], bs.inputs['Roughness']); nt.links.new(sp.outputs['Blue'], bs.inputs['Metallic'])
    for o in new:
        o.data.materials.clear(); o.data.materials.append(mat)
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
        if not n.endswith('machete'):
            o.data.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))  # barrel -y -> +x
        else:
            o.data.transform(Matrix.Rotation(math.radians(90), 4, 'Y'))  # blade down -> +x
        zs = [v.co.z for v in o.data.vertices]
        o.data.transform(Matrix.Translation((0, 0, z - min(zs))))
        h = max(zs) - min(zs)
    # origin marker
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.008, location=(0, -0.05, z + (0 - min(zs))))
    z += h + 0.06
wd = bpy.data.worlds.new('w'); sc.world = wd; wd.use_nodes = True; wd.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.75, 0.77, 1)
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 3; so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(60), 0, math.radians(-15))
sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.use_denoising = False
sc.render.resolution_x, sc.render.resolution_y = 1800, 1000
sc.view_settings.view_transform = 'Standard'
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = max(1.3, z * 1.8 * 1.05)
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0.12, -3, z / 2); cam.rotation_euler = (math.radians(90), 0, 0)
sc.render.filepath = out; bpy.ops.render.render(write_still=True)
print('SHEET', z)

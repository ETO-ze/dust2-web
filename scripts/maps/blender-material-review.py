"""Create an editable Blender scene from a sealed high-FPS map and its shared texture array.

blender -b --python scripts/maps/blender-material-review.py -- MAP_FOLDER OUTPUT.blend
"""
import argparse
import base64
import gzip
import json
from pathlib import Path
import re
import sys

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
def build_material(name, pixels, scale, contrast, directional):
    side = pixels.shape[0]
    image = bpy.data.images.new('Finish / ' + name, width=side, height=side, alpha=False)
    # Blender's first scanline and the unpacked array uploaded by WebGL both correspond to v=0.
    image.colorspace_settings.name = 'Non-Color'
    linear = pixels.astype(np.float32) / 255
    rgba = np.ones((side, side, 4), np.float32)
    rgba[:, :, :3] = linear[:, :, None]
    image.pixels.foreach_set(rgba.ravel())
    image.pack()

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    def add(kind, x, y, label=''):
        node = nodes.new(kind)
        node.location = (x,y)
        node.label = label
        return node
    pos = add('ShaderNodeNewGeometry', -760, 40)
    mapping = add('ShaderNodeVectorMath', -560, 40, 'Repeats per metre')
    mapping.operation = 'SCALE'
    mapping.inputs['Scale'].default_value = scale
    links.new(pos.outputs['Position'], mapping.inputs[0])
    # Blender is Z-up. Game axes: X=-world.y, Y=world.z, Z=-world.x.
    # Use the same two anchor projections as the runtime for walls, steps and ramps.
    def affine_uv(axes, shift, y):
        uv = add('ShaderNodeCombineXYZ', -300,y)
        for i,axis in enumerate(axes):
            dot = add('ShaderNodeVectorMath', -740,y-i*130, 'World projection')
            dot.operation = 'DOT_PRODUCT'
            links.new(mapping.outputs[0],dot.inputs[0])
            dot.inputs[1].default_value = axis
            add_shift = add('ShaderNodeMath',-520,y-i*130)
            add_shift.operation = 'ADD'
            links.new(dot.outputs['Value'],add_shift.inputs[0])
            add_shift.inputs[1].default_value = shift[i]
            links.new(add_shift.outputs[0],uv.inputs[i])
        return uv.outputs[0]
    tile = add('ShaderNodeTexImage', -120, 40)
    tile.image = image
    tile.extension = 'REPEAT'
    if directional:
        tile.projection = 'BOX'
        tile.projection_blend = .27
        links.new(mapping.outputs[0],tile.inputs['Vector'])
        detail = tile.outputs['Color']
    else:
        first = affine_uv(((0,-1,.41),(-1,0,.73)),(0,0),-200)
        second = affine_uv(((-.79*1.29,.61*1.29,.66*1.29),(-.61*1.29,-.79*1.29,-.53*1.29)),(.27,.63),-600)
        other = add('ShaderNodeTexImage',-120,-320)
        other.image = image
        other.extension = 'REPEAT'
        links.new(first,tile.inputs['Vector'])
        links.new(second,other.inputs['Vector'])
        mix = add('ShaderNodeMixRGB',130,-100,'Cross grain')
        mix.inputs[0].default_value = .28
        links.new(tile.outputs['Color'],mix.inputs[1])
        links.new(other.outputs['Color'],mix.inputs[2])
        detail = mix.outputs['Color']
    tone = add('ShaderNodeMath', 340, 40, 'Surface grain contrast')
    tone.operation = 'MULTIPLY_ADD'
    tone.inputs[1].default_value = 2 * contrast
    tone.inputs[2].default_value = 1 - contrast
    links.new(detail, tone.inputs[0])
    color = add('ShaderNodeVertexColor', 340, 240, 'Baked scene colour')
    color.layer_name = 'Color'
    product = add('ShaderNodeVectorMath', 550, 200)
    product.operation = 'SCALE'
    links.new(color.outputs['Color'], product.inputs[0])
    links.new(tone.outputs[0], product.inputs['Scale'])
    emission = add('ShaderNodeEmission', 780, 200)
    links.new(product.outputs[0], emission.inputs['Color'])
    out = add('ShaderNodeOutputMaterial', 1000, 200)
    links.new(emission.outputs[0], out.inputs['Surface'])
    return material


def add_camera(scene, metadata):
    site = metadata['sites']['A']
    # Game (x,y,z) to Blender axes for the imported, unrotated glTF.
    coords = lambda x,y,z: Vector((-z, -x, y))
    if metadata['id'] == 'de_nuke':
        location = coords(16.53, -8.84, -2.59)
        target = coords(7.4, -8.84, -2.59)
    else:
        location = coords(site['x'], site['y'] + 2.1, site['z'])
        target = location + Vector((4, 10, 0))
    camera = bpy.data.cameras.new('Material review')
    camera.angle_y = np.radians(65)
    camera.clip_start = .05
    camera.clip_end = 800
    ob = bpy.data.objects.new('Material review', camera)
    scene.collection.objects.link(ob)
    ob.location = location
    ob.rotation_euler = (target-location).to_track_quat('-Z','Y').to_euler()
    scene.camera = ob
    # Open the example in the camera view, with the editable finish nodes displayed.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                area.spaces.active.region_3d.view_perspective = 'CAMERA'
                area.spaces.active.shading.type = 'MATERIAL'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('map_directory', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--render', type=Path)
    p.add_argument('--library', type=Path, help='Append editable Finish node groups from the authored Blender library')
    args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
    directory = args.map_directory.resolve()
    metadata = json.loads((directory/'compiled/map.json').read_bytes())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(directory/'render/map.gltf'))
    assets = (ROOT/'client/flat-surface-swatches.js').read_text('utf8')
    def field(name):
        return json.loads(re.search(r'^export const '+name+r'=(.*);$',assets,re.MULTILINE)[1])
    side, finishes = field('side'), field('finishes')
    profile = field('profiles').get(metadata['id'],[0,4,1,1,[1,1,1]])
    packed = gzip.decompress(base64.b64decode(field('packed')))
    deltas = np.frombuffer(packed, dtype=np.uint8).reshape(len(finishes), side, side)
    levels = np.cumsum(deltas, axis=2, dtype=np.uint8)
    layers = np.rint(levels.astype(np.float32) * (255/63)).astype(np.uint8)
    if args.library:
        with bpy.data.libraries.load(str(args.library.resolve())) as (source, target):
            target.node_groups = [name for name in source.node_groups if name.startswith('Finish / ')]
        for tree in target.node_groups:
            tree.use_fake_user = True
    material_indices = [profile[0],1,2,3,profile[1],5]
    materials = []
    for layer in material_indices:
        name,metres,contrast = finishes[layer]
        materials.append(build_material(name,layers[layer],profile[2]/metres,
                                        profile[3]*contrast, layer in (1,2,5)))
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        if not mesh.materials[0].get('surfaceMaterialVersion'):
            continue
        attr = mesh.color_attributes.get('Color')
        rgba = np.empty(len(attr.data)*4, np.float32)
        attr.data.foreach_get('color', rgba)
        # glTF importer preserves tagged vertex colours either per vertex or per corner.
        tags = np.rint(255 * rgba.reshape(-1,4)[:,3]).astype(np.int32)
        if attr.domain != 'CORNER':
            loops = np.empty(len(mesh.loops), np.int32)
            mesh.loops.foreach_get('vertex_index', loops)
            tags = tags[loops]
        triangle_tags = tags.reshape(-1,3)
        if not np.all(triangle_tags == triangle_tags[:, :1]):
            raise ValueError('Mixed finish on a single face in ' + obj.name)
        tags = triangle_tags[:,0]
        slots = np.zeros(len(tags), np.int32)
        for tag, material in enumerate(materials, 1):
            group = tags == tag
            if np.any(group):
                slots[group] = len(mesh.materials)
                mesh.materials.append(material)
        mesh.polygons.foreach_set('material_index', slots)
    scene = bpy.context.scene
    add_camera(scene, metadata)
    scene.render.resolution_x, scene.render.resolution_y = 1120, 630
    scene.render.resolution_percentage = 100
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.world = bpy.data.worlds.new('Preview daylight')
    scene.world.color = (.50, .61, .72)
    scene.view_settings.view_transform = 'Standard'
    bpy.context.preferences.filepaths.save_version = 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()), compress=True)
    if args.render:
        scene.render.filepath = str(args.render.resolve())
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()

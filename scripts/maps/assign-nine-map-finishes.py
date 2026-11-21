"""Attach packed map tiles and their editable Blender sources to a full-map study."""
import base64
import gzip
import json
from pathlib import Path
import re

import bpy
import numpy as np

TILES = Path(__file__).resolve().parents[2] / 'client' / 'map-finishes'


def read_pack(name):
    text = (TILES / (name + '.js')).read_text('utf8')
    def field(key):
        return json.loads(re.search(r'^export const ' + key + r'=(.*);$', text, re.MULTILINE)[1])
    side = field('side')
    finishes = field('finishes')
    raw = gzip.decompress(base64.b64decode(field('packed')))
    delta = np.frombuffer(raw, dtype=np.uint8).reshape((len(finishes), side, side))
    # Mirror the browser's expansion to nearest 8-bit linear value.
    palette = np.rint(np.arange(64) * (255 / 63)).astype(np.uint8)
    return list(zip(finishes, palette[np.cumsum(delta, axis=2, dtype=np.uint8)]))


def finish_material(recipe, pixels, source, tag):
    title, metres, strength = recipe
    height, width = pixels.shape
    tile = bpy.data.images.new(title + ' / R8', width=width, height=height, alpha=False)
    tile.colorspace_settings.name = 'Non-Color'
    colors = np.ones((height, width, 4), np.float32)
    colors[:,:,:3] = (pixels.astype(np.float32) / 255)[:,:,None]
    tile.pixels.foreach_set(colors.ravel())
    tile.pack()
    material = bpy.data.materials.new(title)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    def node(kind, x, y, label=''):
        n = tree.nodes.new(kind)
        n.location = (x,y)
        n.label = label
        return n
    def wire(socket, value):
        if isinstance(value, bpy.types.NodeSocket):
            tree.links.new(value, socket)
        else:
            socket.default_value = value
    def math_node(op, a, b, x, y):
        n = node('ShaderNodeMath', x, y)
        n.operation = op
        wire(n.inputs[0], a)
        wire(n.inputs[1], b)
        return n.outputs[0]
    geometry = node('ShaderNodeNewGeometry', -1500, 30)
    pos = node('ShaderNodeVectorMath', -1270, 10, 'World units to tile')
    pos.operation = 'SCALE'
    wire(pos.inputs[0], geometry.outputs['Position'])
    pos.inputs['Scale'].default_value = 1 / metres
    def projected(axes, shift, y):
        uv = node('ShaderNodeCombineXYZ', -640,y)
        for i, direction in enumerate(axes):
            dot = node('ShaderNodeVectorMath',-1080,y-i*100)
            dot.operation = 'DOT_PRODUCT'
            wire(dot.inputs[0], pos.outputs[0])
            wire(dot.inputs[1], direction)
            component = dot.outputs['Value']
            if shift[i]:
                component = math_node('ADD', component, shift[i], -850,y-i*100)
            wire(uv.inputs[i], component)
        tex = node('ShaderNodeTexImage',-420,y)
        tex.image = tile
        tex.extension = 'REPEAT'
        wire(tex.inputs['Vector'], uv.outputs[0])
        return tex.outputs['Color']
    if tag == 4:
        # The plaster tag uses two continuous affine projections across steps.
        first = projected(((1,0,.41),(0,-1,.73)), (0,0), 100)
        second = projected(((-.61*1.29,-.79*1.29,.66*1.29),(.79*1.29,-.61*1.29,-.53*1.29)), (.27,.63), -300)
        mix = node('ShaderNodeMixRGB', 40, 80, 'Cross grain')
        wire(mix.inputs[0], .28)
        wire(mix.inputs[1], first)
        wire(mix.inputs[2], second)
        sample = mix.outputs[0]
    else:
        # Game world (x,y,z) is stored as Blender (x,-z,y). The WebGL normal
        # blend selects the wall, tread and cross-wall projection respectively.
        absolute = node('ShaderNodeVectorMath', -1090, 900)
        absolute.operation = 'ABSOLUTE'
        wire(absolute.inputs[0],geometry.outputs['True Normal'])
        sep = node('ShaderNodeSeparateXYZ', -830,900)
        wire(sep.inputs[0],absolute.outputs[0])
        nx, ny, nz = (sep.outputs[i] for i in (0,2,1))
        high = math_node('MAXIMUM', nx, math_node('MAXIMUM',ny,nz,-600,880),-420,900)
        # Assigning a zero weight to perpendicular faces prevents ghost grout on
        # front-facing walls. Adjacent diagonals receive the same smooth blend.
        samples = []
        weights = []
        axes = [((0,-1,0),(0,0,1)), ((1,0,0),(0,-1,0)), ((1,0,0),(0,0,1))]
        for i, axis in enumerate((nx,ny,nz)):
            y = 300 - i*350
            slope = math_node('DIVIDE', axis, high,-165,900-i*150)
            ramp = node('ShaderNodeMapRange',50,900-i*150)
            ramp.interpolation_type = 'SMOOTHSTEP'
            wire(ramp.inputs['Value'], slope)
            wire(ramp.inputs['From Min'], .73)
            wire(ramp.inputs['From Max'], 1.)
            weight = ramp.outputs[0]
            weights.append(weight)
            samples.append(math_node('MULTIPLY', projected(axes[i],(0,0),y), weight,270,y))
        total = math_node('ADD',weights[0],math_node('ADD',weights[1],weights[2],270,740),490,760)
        sample = math_node('DIVIDE',math_node('ADD',samples[0],math_node('ADD',samples[1],samples[2],490,-60),680,120),total,870,150)
    tone = node('ShaderNodeMath',1060,150,'Local contrast')
    tone.operation = 'MULTIPLY_ADD'
    wire(tone.inputs[0], sample)
    wire(tone.inputs[1], 2*strength)
    wire(tone.inputs[2], 1-strength)
    pigment = node('ShaderNodeVertexColor',1070,360,'Map pigment')
    pigment.layer_name = 'COLOR_0'
    color = node('ShaderNodeVectorMath',1270,280)
    color.operation = 'SCALE'
    wire(color.inputs[0],pigment.outputs['Color'])
    wire(color.inputs['Scale'],tone.outputs[0])
    emit = node('ShaderNodeEmission',1460,280)
    wire(emit.inputs[0],color.outputs[0])
    out = node('ShaderNodeOutputMaterial',1660,280)
    wire(out.inputs['Surface'],emit.outputs[0])
    # Keep editable source beside its baked production texture.
    author = node('ShaderNodeGroup',1080,-180,'Editable tile source / bake-map-finishes.py')
    author.node_tree = source
    return material


def bind_map_finishes(scene, map_id, library_path):
    rules = json.loads((TILES/'assignments.json').read_bytes())[map_id]
    local = read_pack(map_id)
    steel,timber,plaster,brick = read_pack('shared')
    entries = [local[0],steel,timber,plaster,local[1],brick]
    groups = ['Finish / '+recipe[0] for recipe,_ in entries]
    with bpy.data.libraries.load(str(Path(library_path).resolve()), link=False) as (source,target):
        if not set(groups).issubset(source.node_groups):
            raise ValueError('Material library lacks ' + map_id + ' node groups')
        target.node_groups = groups
    finishes = [finish_material(recipe,pixels,group,tag)
                for tag,((recipe,pixels),group) in enumerate(zip(entries,target.node_groups),1)]
    changed = 0
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        attr = mesh.attributes.get('surface_id')
        if not attr or not mesh.color_attributes.get('COLOR_0') or not len(mesh.polygons):
            continue
        vertex_tags = np.empty(len(attr.data),np.int32)
        attr.data.foreach_get('value',vertex_tags)
        vertices = np.empty(len(mesh.loops),np.int32)
        mesh.loops.foreach_get('vertex_index',vertices)
        starts = np.empty(len(mesh.polygons),np.int32)
        mesh.polygons.foreach_get('loop_start',starts)
        tags = vertex_tags[vertices[starts]]
        # Use source face roles plus geometric orientation just as the client
        # does. Vertigo's floors, for instance, are tagged as concrete (1).
        roles = tags.copy()
        if rules.get('plainConcrete'):
            roles[tags == 1] = 4
        if rules.get('plasterWall'):
            roles[tags == 4] = 1
        if rules.get('brickWall'):
            roles[tags == 6] = 1
        if rules.get('floorSlabs') and np.any(tags == 1):
            normals = np.empty(len(mesh.polygons)*3,np.float32)
            mesh.polygons.foreach_get('normal',normals)
            roles[(tags == 1) & (normals[2::3] > .74)] = 5
        slots = np.empty(len(mesh.polygons),np.int32)
        mesh.polygons.foreach_get('material_index',slots)
        for tag,material in enumerate(finishes,1):
            matches = roles == tag
            if np.any(matches):
                slots[matches] = len(mesh.materials)
                mesh.materials.append(material)
                changed += int(matches.sum())
        mesh.polygons.foreach_set('material_index',slots)
    if not changed:
        raise ValueError('No tagged architecture to texture for '+map_id)
    scene['architectural_finishes'] = ', '.join(recipe[0] for recipe,_ in entries)
    print('TEXTURED', map_id, changed, 'faces', flush=True)

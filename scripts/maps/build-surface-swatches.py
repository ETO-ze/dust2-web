"""Bake the original architectural material library for the high-FPS renderer.

blender -b --python scripts/maps/build-surface-swatches.py -- --studio Architectural-Finishes.blend
Use --source-blend to rebake edited "Finish / ..." node groups from a saved library.
"""
import argparse
import base64
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np

SIDE = 512
# Index, tile width in metres, modulation of baked linear colour.
FINISHES = [
    ('Cast concrete', 1.36, .31), ('Powder-coated steel', .91, .20),
    ('Sawn timber', 1.36, .37), ('Lime plaster', 1.18, .28),
    ('Compacted earth', 1.32, .32), ('Fired brick', 1.06, .49),
    ('Bedded limestone', 1.56, .39), ('Rolled asphalt', 1.08, .32),
]
# Stone and ground recipe indices, spatial scale, contrast, then grain colour.
# At mid-tone the mesh's authored pigment remains exact for every map.
PROFILES = {
    'de_dust2': [6,4,0.96,1,[1.04,1,0.96]],
    'de_mirage': [6,4,1.04,0.98,[1.03,1,0.97]],
    'de_inferno': [0,4,1.03,1.05,[1.04,0.99,0.97]],
    'de_nuke': [0,7,1,0.95,[0.97,1,1.03]],
    'de_ancient': [6,4,0.92,1.1,[0.99,1.03,0.98]],
    'de_anubis': [6,4,0.92,1.04,[1.05,1,0.94]],
    'de_cache': [0,7,1.03,1.03,[0.99,1.02,1]],
    'de_train': [0,7,1.02,1.05,[1.02,0.99,0.99]],
    'de_vertigo': [0,7,1.06,0.95,[0.99,1,1.02]],
}
TAU = math.tau


class FinishGraph:
    """A single editable UV-to-tone Blender node group. Noise inputs wrap on a 4D torus."""
    def __init__(self, title):
        self.tree = bpy.data.node_groups.new('Finish / ' + title, 'ShaderNodeTree')
        self.tree.use_fake_user = True
        self.tree.interface.new_socket(name='UV', in_out='INPUT', socket_type='NodeSocketVector')
        self.tree.interface.new_socket(name='Tone', in_out='OUTPUT', socket_type='NodeSocketFloat')
        uv = self.node('NodeGroupInput', 'One tile').outputs['UV']
        xy = self.node('ShaderNodeSeparateXYZ', 'Texture coordinates')
        self.connect(xy.inputs[0], uv)
        self.u, self.v = xy.outputs['X'], xy.outputs['Y']
        a = self.calc('MULTIPLY', self.u, TAU)
        b = self.calc('MULTIPLY', self.v, TAU)
        circle = self.node('ShaderNodeCombineXYZ', 'Periodic noise domain')
        for socket, value in zip(circle.inputs, (self.calc('COSINE', a), self.calc('SINE', a), self.calc('COSINE', b))):
            self.connect(socket, value)
        self.torus = circle.outputs[0]
        self.w = self.calc('SINE', b)

    def node(self, kind, label):
        node = self.tree.nodes.new(kind)
        if label:
            node.label = label
        return node

    def connect(self, target, source):
        if isinstance(source, bpy.types.NodeSocket):
            self.tree.links.new(source, target)
        else:
            target.default_value = source

    def calc(self, op, *places, label=''):
        n = self.node('ShaderNodeMath', label)
        n.operation = op
        for index, source in enumerate(places):
            self.connect(n.inputs[index], source)
        return n.outputs[0]

    def noise(self, scale, detail, label):
        node = self.node('ShaderNodeTexNoise', label)
        node.noise_dimensions = '4D'
        self.connect(node.inputs['Vector'], self.torus)
        self.connect(node.inputs['W'], self.w)
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .52
        return node.outputs['Fac']

    def centred(self, signal):
        return self.calc('SUBTRACT', signal, .5)

    def wave(self, cycles_u, cycles_v, distortion=0, label=''):
        phase = self.calc('MULTIPLY_ADD', self.u, cycles_u, self.calc('MULTIPLY', self.v, cycles_v))
        phase = self.calc('MULTIPLY_ADD', phase, TAU, distortion)
        return self.calc('SINE', phase, label=label)

    def tone(self, base, *signals):
        for weight, signal in signals:
            base = self.calc('MULTIPLY_ADD', signal, weight, base)
        return base

    def ramp(self, signal, left, right, label):
        scale = self.node('ShaderNodeMapRange', label)
        scale.interpolation_type = 'SMOOTHSTEP'
        self.connect(scale.inputs['Value'], signal)
        scale.inputs['From Min'].default_value = left
        scale.inputs['From Max'].default_value = right
        return scale.outputs[0]

    def finish(self, output):
        dest = self.node('NodeGroupOutput', 'Baked single-channel finish')
        self.connect(dest.inputs['Tone'], output)
        # Place nodes by their dependency depth so the editable library opens in order.
        levels, counts = {}, {}
        def depth(n):
            if n.name not in levels:
                parents = [link.from_node for i in n.inputs for link in i.links]
                levels[n.name] = max((depth(p) for p in parents), default=-1) + 1
            return levels[n.name]
        for node in self.tree.nodes:
            column = depth(node)
            row = counts.get(column, 0)
            node.location = (column * 245, -row * 320)
            counts[column] = row + 1
            node.width = 200
        return self.tree


def design(index):
    title = FINISHES[index][0]
    g = FinishGraph(title)
    macro = g.noise(1.35, 1.2, 'Broad hand-applied variation')
    mid = g.noise(8.4, 1.6, 'Mid-scale variations')
    grit = g.noise(33.0, .8, 'Fine surface grain')
    broad = g.centred(macro)
    grain = g.centred(grit)
    if index == 0:
        pores = g.ramp(grit, .57, .72, 'Exposed aggregate pits')
        screed = g.wave(1, 3, g.calc('MULTIPLY', macro, 5), 'Trowel pass')
        tone = g.tone(.55, (.26,broad), (.54,g.centred(mid)), (.55,grain), (-.38,pores), (.045,screed))
    elif index == 1:
        # No panel borders. The map geometry supplies the actual frames and profiles.
        hairline = g.wave(1, 58, g.calc('MULTIPLY', mid, 3), 'Rolled grain')
        coat = g.ramp(grit, .48, .68, 'Powder-coat microstructure')
        tone = g.tone(.47, (.12,broad), (.22,g.centred(mid)), (.22,coat), (.075,hairline))
    elif index == 2:
        drift = g.tone(0, (16,macro), (1.3,mid))
        grain_line = g.wave(1, 19, drift, 'Growth rings')
        latewood = g.ramp(grain_line, .36, .96, 'Dark latewood')
        joint = g.ramp(g.calc('ABSOLUTE', g.wave(0,3)), .010,.075, 'Six plank edges')
        tone = g.tone(.43, (.25,broad), (.22,g.centred(mid)), (.24,grain), (-.31,latewood), (.17,joint))
    elif index == 3:
        sweep = g.wave(2, 2, g.calc('MULTIPLY', macro, 10), 'Float marks')
        lime = g.ramp(mid, .48, .70, 'Lime bloom')
        tone = g.tone(.43, (.28,broad), (.20,lime), (.52,grain), (.055,sweep))
    elif index == 4:
        sweep = g.wave(2, 5, g.calc('MULTIPLY', macro, 8), 'Wind-scoured grains')
        pebble = g.ramp(grit, .55, .7, 'Packed surface pebbles')
        tone = g.tone(.44, (.36,broad), (.26,g.centred(mid)), (.19,pebble), (.39,grain), (.065,sweep))
    elif index == 5:
        row_pos = g.calc('MULTIPLY', g.v, 12, label='Twelve brick courses')
        row = g.calc('FLOOR', row_pos)
        offset = g.calc('MULTIPLY', g.calc('MODULO',row,2), .5)
        # Periodic warping roughens joint edges; it never changes the bonded layout.
        roughness = g.calc('MULTIPLY', g.centred(mid), .032)
        col_pos = g.calc('MULTIPLY_ADD', g.u, 4, offset, label='Half-brick running bond')
        def joint_distance(pos):
            f = g.calc('FRACT', g.calc('ADD',pos,roughness))
            return g.calc('MINIMUM', f, g.calc('SUBTRACT',1,f))
        horizontal = g.ramp(joint_distance(row_pos), .035, .085, 'Horizontal mortar bevel')
        vertical = g.ramp(joint_distance(col_pos), .016, .038, 'Vertical mortar bevel')
        fired = g.calc('MINIMUM', horizontal, vertical)
        # Modulo wraps the half bricks at the two lateral edges onto the same batch.
        cell = g.calc('MODULO',g.calc('FLOOR',col_pos),4)
        kiln = g.calc('SINE',g.calc('MULTIPLY_ADD',row,19.19,g.calc('MULTIPLY',cell,7.44)))
        tone = g.tone(.24, (.38,fired), (.075,kiln), (.18,broad), (.31,grain), (.16,g.centred(mid)))
    elif index == 6:
        bedding = g.wave(1, 7, g.tone(0,(7.2,macro),(1.4,mid)), 'Limestone bedding')
        seams = g.ramp(bedding,.68,.97,'Fine mineral veins')
        pinholes = g.ramp(grit,.56,.73,'Stone pores')
        tone = g.tone(.56, (.33,broad), (.43,g.centred(mid)), (.30,grain), (-.15,seams), (-.18,pinholes))
    else:
        chips = g.ramp(grit, .56, .68, 'Light mineral chips')
        tar = g.ramp(mid,.34,.60,'Bitumen binder')
        tone = g.tone(.44, (.16,broad), (.20,g.centred(mid)), (.63,grain), (.26,chips), (-.08,tar))
    return g.finish(tone)


def sample_plane(group, index):
    bpy.ops.mesh.primitive_plane_add(size=2, location=((index%4)*2.3,(index//4)*2.3,0))
    plane = bpy.context.object
    plane.name = group.name
    material = bpy.data.materials.new(group.name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    uv = nodes.new('ShaderNodeTexCoord')
    proc = nodes.new('ShaderNodeGroup')
    proc.node_tree = group
    emit = nodes.new('ShaderNodeEmission')
    out = nodes.new('ShaderNodeOutputMaterial')
    for column,node in enumerate((uv,proc,emit,out)):
        node.location = (column*220, 0)
    links.new(uv.outputs['UV'],proc.inputs['UV'])
    links.new(proc.outputs['Tone'],emit.inputs['Color'])
    links.new(emit.outputs[0],out.inputs['Surface'])
    plane.data.materials.append(material)
    image = bpy.data.images.new(group.name+' / bake', width=SIDE, height=SIDE, alpha=False, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    target = nodes.new('ShaderNodeTexImage')
    target.image = image
    target.label = 'Cycles emission bake target'
    target.location = (200,-220)
    nodes.active = target
    return plane,image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=Path('client/flat-surface-swatches.js'))
    parser.add_argument('--studio',type=Path)
    parser.add_argument('--source-blend',type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if args.source_blend:
        with bpy.data.libraries.load(str(args.source_blend.resolve())) as (source,target):
            names = ['Finish / '+f[0] for f in FINISHES]
            if not set(names).issubset(source.node_groups):
                raise ValueError('The .blend is missing finish groups.')
            target.node_groups = names
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    levels = []
    for index,(name,_,_) in enumerate(FINISHES):
        group = bpy.data.node_groups['Finish / '+name] if args.source_blend else design(index)
        plane,image = sample_plane(group,index)
        bpy.ops.object.bake(type='EMIT')
        rgba = np.empty(SIDE*SIDE*4,np.float32)
        image.pixels.foreach_get(rgba)
        detail = rgba.reshape(SIDE,SIDE,4)[:,:,0]
        if not np.isfinite(detail).all() or np.ptp(detail)<.12:
            raise ValueError('Cycles bake produced no surface variation: '+name)
        # The base mesh already carries the local pigment and exposure.
        detail = np.clip(detail-np.mean(detail)+.5,0,1)
        levels.append(np.rint(detail * 63).astype(np.uint8))
        print('BAKED',name,round(float(np.std(detail)),4),flush=True)
        # The source node trees and preview planes are the editable artwork.
        # The raw float bake target is transient and is recreated on the next bake.
        material = plane.data.materials[0]
        material.node_tree.nodes.remove(material.node_tree.nodes.active)
        bpy.data.images.remove(image)
    if args.studio:
        args.studio.parent.mkdir(parents=True,exist_ok=True)
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(args.studio.resolve()),compress=True)
    stack = np.stack(levels)
    deltas = np.diff(stack,axis=2,prepend=np.zeros_like(stack[:,:,:1]))
    packed = gzip.compress(deltas.tobytes(),compresslevel=9,mtime=0)
    fields = {'side':SIDE,'finishes':FINISHES,'profiles':PROFILES,'sha256':hashlib.sha256(stack.tobytes()).hexdigest(),
              'packed':base64.b64encode(packed).decode()}
    args.out.write_text('// Original Blender procedural finishes, generated by scripts/maps/build-surface-swatches.py.\n'
                        +''.join('export const '+k+'='+json.dumps(v,separators=(',',':'))+';\n' for k,v in fields.items()),'utf8')
    print('Original finishes:',len(FINISHES),'wire gzip',len(packed),'R8 level zero',stack.size)


if __name__ == '__main__':
    main()

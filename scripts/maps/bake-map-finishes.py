"""Bake the six world-space finish layers used by each performance map in Blender.

blender -b -t 4 -P scripts/maps/bake-map-finishes.py -- --studio artifacts/blender-nine-crisp/Map-Finishes.blend
Pass --source-blend to rebuild the web tiles from artist-edited node groups.
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import runpy
import sys

import bpy
import numpy as np

SOURCE = Path(__file__).resolve().parent
base = runpy.run_path(str(SOURCE / 'build-surface-swatches.py'))
SIDE = base['SIDE']
SHARED = [1, 2, 3, 5]  # steel, timber, plaster, brick (face tags 2, 3, 4, 6)
# Name, pattern, tile metres, modulation, courses, stones per course, bevel width.
# Large landmarks and original pigments stay in the mesh. These are small surface
# details only. Each brick course count is even for seamless running bond.
MAPS = {
    'de_dust2': [('Limewashed sandstone', 'lime', 1.44, .31, 2, 3, .035),
                 ('Wind-scoured compact sand', 'earth', 1.30, .38, 2, 6, .03)],
    'de_mirage': [('Burnished courtyard plaster', 'lime', 1.28, .32, 1, 5, .04),
                  ('Courtyard pavers', 'bond', 1.64, .43, 6, 3, .025)],
    'de_inferno': [('Hand-floated stucco', 'lime', 1.20, .37, 3, 2, .045),
                   ('Worn fired paving', 'bond', 1.50, .45, 8, 4, .045)],
    'de_nuke': [('Painted precast panel', 'cast', 1.46, .25, 4, 1, .024),
                ('Sealed industrial screed', 'screed', 1.64, .30, 2, 11, .02)],
    'de_ancient': [('Weathered temple masonry', 'bond', 2.16, .49, 4, 2, .055),
                   ('Split temple flagstone', 'stone', 1.90, .44, 3, 7, .045)],
    'de_anubis': [('Banded river sandstone', 'stone', 1.90, .42, 1, 8, .035),
                  ('Dressed limestone slabs', 'bond', 2.04, .39, 4, 3, .026)],
    'de_cache': [('Factory shutter concrete', 'cast', 1.74, .36, 6, 2, .045),
                 ('Patched yard aggregate', 'aggregate', 1.24, .41, 2, 4, .04)],
    'de_train': [('Rail depot brick', 'bond', 1.56, .46, 12, 5, .055),
                 ('Ballasted yard paving', 'aggregate', 1.44, .41, 1, 6, .058)],
    'de_vertigo': [('Formwork impressions', 'cast', 1.76, .34, 8, 2, .035),
                   ('Power-floated floor slab', 'screed', 1.42, .32, 3, 7, .045)],
}


def design(recipe):
    title, pattern, _, _, rows, cols, bevel = recipe
    g = base['FinishGraph'](title)
    macro = g.noise(1.05 + rows * .09, 1.35, 'Large surface variation')
    mid = g.noise(5 + cols * .65, 1.5, 'Tool finish')
    grit = g.noise(24 + rows, 1.25, 'Fine grain')
    rough = g.centred(mid)
    broad = g.centred(macro)
    grain = g.centred(grit)
    if pattern in ('bond', 'cast'):
        row_pos = g.calc('MULTIPLY', g.v, rows)
        row = g.calc('FLOOR', row_pos)
        stagger = g.calc('MULTIPLY', g.calc('MODULO', row, 2), .5 if pattern == 'bond' else 0)
        col_pos = g.calc('MULTIPLY_ADD', g.u, cols, stagger)
        def edge(pos, size):
            f = g.calc('FRACT', g.calc('MULTIPLY_ADD', rough, bevel * .45, pos))
            distance = g.calc('MINIMUM', f, g.calc('SUBTRACT', 1, f))
            return g.ramp(distance, size * .28, size, 'Joint bevel')
        field = g.calc('MINIMUM', edge(row_pos, bevel), edge(col_pos, bevel * cols / rows))
        cell = g.calc('MODULO', g.calc('FLOOR', col_pos), cols)
        batch = g.calc('SINE', g.calc('MULTIPLY_ADD', row, 7.11, g.calc('MULTIPLY', cell, 5.61)))
        if pattern == 'cast':
            strips = g.wave(0, rows * 6, g.calc('MULTIPLY', mid, 5), 'Form board grain')
            tone = g.tone(.32, (.17, field), (.034, batch), (.24, broad), (.37, rough), (.41, grain), (.035, strips))
        else:
            tone = g.tone(.18, (.37, field), (.062, batch), (.24, broad), (.35, rough), (.35, grain))
    elif pattern == 'lime':
        pass_marks = g.wave(rows, cols, g.tone(0, (8.2, macro), (2.3, mid)), 'Curved plaster strokes')
        bloom = g.ramp(mid, .45, .67, 'Lime bloom')
        tone = g.tone(.40, (.28, broad), (.16, bloom), (.46, grain), (.065, pass_marks))
    elif pattern == 'stone':
        beds = g.wave(rows, cols, g.tone(0, (6.1, macro), (2, mid)), 'Mineral bedding')
        cuts = g.ramp(beds, .66, .96, 'Split grain')
        tone = g.tone(.52, (.32, broad), (.41, rough), (.38, grain), (-.21, cuts))
    elif pattern == 'screed':
        arcs = g.wave(rows, cols, g.tone(0, (14, macro), (1.7, mid)), 'Float blade strokes')
        pores = g.ramp(grit, .57, .70, 'Screed pores')
        tone = g.tone(.54, (.25, broad), (.40, rough), (.46, grain), (-.21, pores), (.054, arcs))
    else:
        ripple = g.wave(rows, cols, g.calc('MULTIPLY', macro, 9), 'Surface wear')
        aggregate = g.ramp(grit, .52, .73, 'Pale aggregates')
        chip = .15 if pattern == 'earth' else .32
        tone = g.tone(.41, (.33, broad), (.35, rough), (.37, grain), (chip, aggregate), (.049, ripple))
    return g.finish(tone)


def write_pack(path, layers, finishes):
    stack = np.stack(layers)
    delta = np.diff(stack, axis=2, prepend=np.zeros_like(stack[:, :, :1]))
    packed = gzip.compress(delta.tobytes(), compresslevel=9, mtime=0)
    fields = dict(side=SIDE, finishes=finishes, sha256=hashlib.sha256(stack.tobytes()).hexdigest(),
                  packed=base64.b64encode(packed).decode())
    path.write_text('// Generated by scripts/maps/bake-map-finishes.py\n' +
                    ''.join('export const ' + k + '=' + json.dumps(v,separators=(',',':')) + ';\n' for k,v in fields.items()), 'utf8')


def arrange_studio(scene):
    """Lay out map pairs at the same scale in the editable material library."""
    ink = bpy.data.materials.new('Swatch labels')
    ink.use_nodes = True
    ink.node_tree.nodes.clear()
    emit = ink.node_tree.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (.86,.9,.96,1)
    out = ink.node_tree.nodes.new('ShaderNodeOutputMaterial')
    ink.node_tree.links.new(emit.outputs[0],out.inputs['Surface'])

    def place_row(name, x, y, names):
        collection = bpy.data.collections.new(name)
        scene.collection.children.link(collection)
        def label(text, location, size):
            font = bpy.data.curves.new(text, 'FONT')
            font.body, font.size = text, size
            font.materials.append(ink)
            obj = bpy.data.objects.new(text, font)
            collection.objects.link(obj)
            obj.location = location
        label(name.replace('de_', '').upper(), (x-1,y+1.13,0), .26)
        for i,title in enumerate(names):
            plane = scene.objects['Finish / '+title]
            for c in list(plane.users_collection):
                c.objects.unlink(plane)
            collection.objects.link(plane)
            plane.location = (x+i*2.1,y,0)
            label(title,(plane.location.x-1,y-1.16,0),.127)
    for i,(map_id, pair) in enumerate(MAPS.items()):
        place_row(map_id,(i%3)*5.25,-(i//3)*3.13,[r[0] for r in pair])
    place_row('Common finishes',0,-9.39,[base['FINISHES'][i][0] for i in SHARED])
    camera = bpy.data.cameras.new('Material sheet')
    camera.type, camera.ortho_scale = 'ORTHO', 16.5
    obj = bpy.data.objects.new(camera.name,camera)
    scene.collection.objects.link(obj)
    obj.location = (6.24,-4.63,20)
    scene.camera = obj
    scene.render.resolution_x, scene.render.resolution_y = 2240,1700
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.world = bpy.data.worlds.new('Studio background')
    scene.world.color = (.014,.021,.030)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.region_3d.view_perspective = 'CAMERA'
                space.shading.type = 'MATERIAL'
                space.overlay.show_overlays = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=SOURCE.parents[1] / 'client' / 'map-finishes')
    parser.add_argument('--studio', type=Path, required=True)
    parser.add_argument('--preview', type=Path)
    parser.add_argument('--source-blend', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    args.out.mkdir(exist_ok=True, parents=True)
    if args.source_blend:
        with bpy.data.libraries.load(str(args.source_blend.resolve())) as (source, target):
            target.node_groups = [n for n in source.node_groups if n.startswith('Finish / ')]
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    count = 0
    def bake(name, maker):
        nonlocal count
        group = bpy.data.node_groups['Finish / ' + name] if args.source_blend else maker()
        plane, image = base['sample_plane'](group, count)
        count += 1
        bpy.ops.object.bake(type='EMIT')
        rgba = np.empty(SIDE * SIDE * 4, np.float32)
        image.pixels.foreach_get(rgba)
        detail = rgba.reshape(SIDE, SIDE, 4)[:, :, 0]
        if not np.isfinite(detail).all() or np.ptp(detail) < .12:
            raise ValueError(name)
        levels = np.rint(np.clip(detail - np.mean(detail) + .5, 0, 1) * 63).astype(np.uint8)
        material = plane.data.materials[0]
        material.node_tree.nodes.remove(material.node_tree.nodes.active)
        bpy.data.images.remove(image)
        print('FINISH', count, name, flush=True)
        return levels
    shared = [base['FINISHES'][i] for i in SHARED]
    write_pack(args.out / 'shared.js', [bake(f[0], lambda: base['design'](i)) for i,f in zip(SHARED,shared)], shared)
    for name, pair in MAPS.items():
        write_pack(args.out / (name+'.js'), [bake(r[0], lambda: design(r)) for r in pair], [[r[0],r[2],r[3]] for r in pair])
    arrange_studio(scene)
    args.studio.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.studio.resolve()), compress=True)
    if args.preview:
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(args.preview.resolve())
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()

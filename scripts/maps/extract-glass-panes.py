"""Extract a single visible face and bind each verified pane to its source collision.
Run with numpy, passing the directory containing the source map exports and the JS output.
"""
import argparse
import json
import pathlib
import runpy

import numpy as np

compiler = runpy.run_path(str(pathlib.Path(__file__).with_name('compile-source.py')))
digest = compiler['digest']
rotate = compiler['ROTATE']
MAP_COUNTS = {'de_nuke': 14, 'de_inferno': 32, 'de_mirage': 1}


def read(path):
    return json.loads(path.read_text(encoding='utf8'))


def extract(root, map_id):
    metadata = read(root / 'compiled/map.json')
    groups = read(root / 'compiled/physics-groups.json')
    physics = np.memmap(root / 'compiled/physics.f32', dtype='<f4', mode='r').reshape(-1, 3, 3)
    entities = [e for e in compiler['entities'](root / 'source/entities.txt') if 'origin' in e]
    render = read(root / 'raw/map.gltf')
    buffers = [np.memmap(root / 'raw' / b['uri'], mode='r', dtype='u1') for b in render['buffers']]
    nodes = render['nodes']
    matrices = {}

    def visit(index, parent):
        matrix = parent @ compiler['local_matrix'](nodes[index])
        matrices[index] = matrix
        for child in nodes[index].get('children', []):
            visit(child, matrix)

    for index in render['scenes'][render.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))

    def values(index):
        acc = render['accessors'][index]
        view = render['bufferViews'][acc['bufferView']]
        dtype = np.dtype(compiler['DTYPES'][acc['componentType']])
        size = compiler['COUNTS'][acc['type']]
        offset = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        return np.ndarray((acc['count'], size), buffer=buffers[view['buffer']], dtype=dtype,
                          offset=offset, strides=(view.get('byteStride', size * dtype.itemsize), dtype.itemsize))

    group_fingerprints = {}
    for group in groups:
        if group['extras'].get('SurfaceProperty') == 'glass' and group['source'] == 'map_physics.gltf':
            start, count = group['firstTriangle'], group['triangles']
            group_fingerprints[physics[start:start + count].tobytes()] = group

    objects = []
    claimed = set()
    for node, triangles in compiler['physics_meshes'](root / 'raw/map_physics.gltf'):
        kind = node['name'].split(' ')[0]
        if kind not in ('prop_dynamic', 'func_breakable') or node.get('extras', {}).get('SurfaceProperty') != 'glass':
            continue
        world = np.array(node['_gameOrigin'])
        matches = [e for e in entities if e['classname'] == kind and np.linalg.norm(world - compiler['point'](e['origin'])) < .001]
        assert len(matches) == 1
        e = matches[0]
        if kind == 'func_breakable':
            assert e['health'] > 0
        elif '@OnBreak' not in e:
            continue
        assert not e.get('startdisabled') and str(e.get('solid', '6')) != '0'
        kept = np.linalg.norm(np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]), axis=1) > 1e-8
        group = group_fingerprints[triangles[kept].astype('<f4').tobytes()]
        assert group['mask'] == 7 and group['firstTriangle'] not in claimed
        claimed.add(group['firstTriangle'])
        model = e['model'].split('/')[-1].split('.vmdl')[0]
        bound = [i for i, mat in matrices.items() if nodes[i].get('name', '').split('.')[0] == model and
                 np.linalg.norm((rotate @ mat)[:3, 3] - world) < .002]
        assert len(bound) == 1, (e['hammeruniqueid'], bound)
        mesh_idx = bound[0]
        primitives = render['meshes'][nodes[mesh_idx]['mesh']]['primitives']
        assert len(primitives) == 1
        p = primitives[0]
        material = render['materials'][p['material']]
        assert material['alphaMode'] == 'BLEND'
        xyz = values(p['attributes']['POSITION'])
        idx = values(p['indices']).reshape(-1, 3)
        xyz = (np.c_[xyz, np.ones(len(xyz))] @ matrices[mesh_idx].T)[:, :3]
        tri = xyz[idx]
        if len(tri) > 2:
            # Take a real broad face of the original solid, preserving inclined and irregular panes.
            normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
            main = np.argmax(np.linalg.norm(normals, axis=1))
            normal = normals[main] / np.linalg.norm(normals[main])
            planes = np.abs((tri - tri[main, 0]) @ normal).max(axis=1) < .0002
            tri = tri[planes & (normals @ normal > 0)]
        assert 1 <= len(tri) <= 12
        if 'Window_additive' in e.get('@OnBreak', ''):
            target = e['@OnBreak'].split()[-1]
            overlay, = [v for v in entities if v.get('targetname') == target and v['classname'] == 'func_brush']
            assert int(overlay['solidity']) == 1
            prefix = overlay['model'].split('/')[-1].split('.vmdl')[0].lower()
            extra, = [i for i, node in enumerate(nodes) if node.get('name', '').lower().split('.')[0] == prefix]
            bound.append(extra)
        objects.append(dict(id='glass-' + e['hammeruniqueid'].replace(':', '-'), firstTriangle=group['firstTriangle'],
                            triangles=group['triangles'], material='glass', health=e.get('health', 1),
                            nodeIndices=bound, nodeNames=[nodes[i]['name'] for i in bound],
                            pane=tri.round(5).reshape(-1).tolist()))
    assert len(objects) == MAP_COUNTS[map_id], (map_id, len(objects))
    result = dict(schemaVersion=1, mapId=map_id, sourceSha256=metadata['sourceSha256'],
                physicsSha256=digest(root / 'compiled/physics.f32'), maskSha256=digest(root / 'compiled/physics-mask.u8'),
                groupsSha256=digest(root / 'compiled/physics-groups.json'), renderSha256=digest(root / 'raw/map.gltf'),
                initialHiddenNodeIndices=[], objects=objects)
    compact = root / 'derived/raw/map.gltf'
    if compact.exists():
        alternate = read(compact)
        for obj in objects:
            for index in obj['nodeIndices']:
                old, new = nodes[index], alternate['nodes'][index]
                assert new['name'] == old['name'] and new['matrix'] == old['matrix'] and 'mesh' in new
                old_primitive, = render['meshes'][old['mesh']]['primitives']
                new_primitive, = alternate['meshes'][new['mesh']]['primitives']
                for key in ('min', 'max', 'count'):
                    assert (alternate['accessors'][new_primitive['attributes']['POSITION']][key] ==
                            render['accessors'][old_primitive['attributes']['POSITION']][key])
        result['alternateRenderSha256'] = digest(compact)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('library', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    args = parser.parse_args()
    maps = {}
    for key in MAP_COUNTS:
        source, = [p.parent.parent for p in (args.library / key).glob('*/compiled/map.json')]
        maps[key] = extract(source, key)
    lines = ['// Generated by scripts/maps/extract-glass-panes.py from matched source geometry.', 'export const GLASS_MAPS = {']
    for key, policy in maps.items():
        fields = {k: v for k, v in policy.items() if k != 'objects'}
        lines.append('  ' + json.dumps(key) + ': ' + json.dumps(fields, separators=(',', ':'))[:-1] + ',"objects":[')
        lines.extend('    ' + json.dumps(d, separators=(',', ':')) + ',' for d in policy['objects'])
        lines.append('  ]},')
    lines.append('};')
    args.output.write_text('\n'.join(lines) + '\n', encoding='utf8')


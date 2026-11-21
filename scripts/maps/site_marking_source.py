"""Find original placed decal surfaces in an identified map export (coordinates and UV only)."""
import json
from pathlib import Path
import re

import numpy as np


FLOOR_PAINT = {'bombsite_a', 'bombsite_b', 'bombsite_x_spray'}
WALL_NODES = {
    'de_nuke': {'A': 'c66_s_mesh_overlay66.', 'B': 'c60_s_mesh_overlay60.'},
    'de_vertigo': {'A': 'c61_s_mesh_overlay61.', 'B': 'c23_s_mesh_overlay23.'},
}
SITE_MATERIAL = re.compile(
    r'bomb.?site|bomb.?target|target.?zone|site.?letter|bomb.?mark|site.?mark|'
    r'zone.?paint|target_decal|plant.?zone|spray.?[ab](?:$|_)', re.I)


def source_file(library, extra, map_id, digest):
    for folder in sorted((library / map_id).glob(digest[:12] + '-*')):
        manifest = json.loads((folder / 'source-manifest.json').read_bytes())
        if manifest['sourceSha256'] == digest:
            return folder / 'raw/map.gltf'
    folder = extra / map_id
    manifest = json.loads((folder / 'compiled/map.json').read_bytes())
    if manifest['sourceSha256'] != digest:
        raise ValueError(f'{map_id}: source revision differs from compiled pool')
    return folder / 'key-colors/map.gltf'


def attribute(doc, buffer, number):
    accessor = doc['accessors'][number]
    view = doc['bufferViews'][accessor['bufferView']]
    dtype = np.dtype({5121: 'u1', 5123: '<u2', 5125: '<u4', 5126: '<f4'}[accessor['componentType']])
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    values = np.ndarray((accessor['count'], width), dtype, buffer,
                        offset=view.get('byteOffset', 0) + accessor.get('byteOffset', 0),
                        strides=(view.get('byteStride', dtype.itemsize * width), dtype.itemsize))
    return values.astype('f8') / np.iinfo(dtype).max if accessor.get('normalized') else values


def world_coords(xyz):
    return np.stack([xyz[:, 2], xyz[:, 1], -xyz[:, 0]], axis=1)


def placed_markings(source, map_id, sites):
    doc = json.loads(source.read_bytes())
    buf = (source.parent / doc['buffers'][0]['uri']).read_bytes()
    records = []
    source_nodes = WALL_NODES.get(map_id, {}).values()

    def visit(index, parent):
        node = doc['nodes'][index]
        matrix = parent @ np.array(node.get('matrix', np.eye(4).flat)).reshape(4, 4).T
        for p in doc['meshes'][node['mesh']]['primitives'] if 'mesh' in node else []:
            name = doc['materials'][p.get('material', 0)].get('name', '')
            if not SITE_MATERIAL.search(name):
                continue
            xyz = attribute(doc, buf, p['attributes']['POSITION'])
            world = world_coords(xyz @ matrix[:3, :3].T + matrix[:3, 3])
            low, high = world.min(0), world.max(0)
            pos = (low + high) / 2
            distances = {k: np.linalg.norm(pos - [s['x'], s['y'], s['z']]) for k, s in sites.items()}
            site = min(distances, key=distances.get)
            if distances[site] > 15:
                continue
            rec = dict(site=site, mat=name, node=node.get('name', ''), pos=pos.round(3).tolist(),
                       span=(high - low).round(3).tolist(), dist=round(distances[site], 3))
            if name in FLOOR_PAINT or any(n in rec['node'] for n in source_nodes):
                uv = attribute(doc, buf, p['attributes']['TEXCOORD_0'])
                uv_min, uv_max = uv.min(0), uv.max(0)
                rec['uvRange'] = [uv_min.round(3).tolist(), uv_max.round(3).tolist()]
                unit = (uv - uv_min) / (uv_max - uv_min)
                unit[:, 1] = 1 - unit[:, 1]
                order = attribute(doc, buf, p['indices']).ravel()
                rec['sourceSurface'] = np.concatenate((world, unit), axis=1)[order].round(5).tolist()
            records.append(rec)
        for child in node.get('children', []):
            visit(child, matrix)

    for index in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(index, np.eye(4))
    return records


def paint_ranges(folder, refs):
    """Remove only red geometry lying directly on a verified original red floor decal."""
    doc = json.loads((folder / 'render/map.gltf').read_bytes())
    buf = (folder / 'render/map.bin').read_bytes()
    old = {}
    for ref in refs:
        if ref['mat'] not in FLOOR_PAINT:
            continue
        patch = np.array(ref['sourceSurface'])[:, :3].reshape(-1, 3, 3)
        low, high = patch.min((0, 1)) - .025, patch.max((0, 1)) + .025
        for node in doc['nodes']:
            if not node.get('name', '').startswith('tile_'):
                continue
            p = doc['meshes'][node['mesh']]['primitives'][0]
            pos = attribute(doc, buf, p['attributes']['POSITION'])
            world = world_coords(pos * node.get('scale', [1, 1, 1]) + node.get('translation', [0, 0, 0]))
            indices = attribute(doc, buf, p['indices']).reshape(-1, 3)
            faces = world[indices]
            colors = attribute(doc, buf, p['attributes']['COLOR_0'])[indices].mean(1)
            red = (colors[:, 0] > colors[:, 1]*1.36) & (colors[:, 0] > colors[:, 2]*1.60) & (colors[:, 3] > .98)
            ids = np.flatnonzero(np.all(faces.min(1) >= low, axis=1) & np.all(faces.max(1) <= high, axis=1) & red)
            if not len(ids):
                continue
            vertices = faces[ids].reshape(-1, 3)
            matches = np.zeros(len(vertices), dtype=bool)
            for a, b, c in patch:
                du, dv = b - a, c - a
                det = du[0]*dv[2] - du[2]*dv[0]
                if abs(det) < 1e-9:
                    continue
                e = vertices - a
                u = (e[:, 0]*dv[2] - e[:, 2]*dv[0]) / det
                v = (du[0]*e[:, 2] - du[2]*e[:, 0]) / det
                gap = abs(e[:, 1] - u*du[1] - v*dv[1])
                matches |= (u >= -.015) & (v >= -.015) & (u + v <= 1.015) & (gap <= .010)
            old.setdefault(node['name'], set()).update(ids[matches.reshape(-1, 3).all(1)].tolist())

    ranges = {}
    for name, ids in old.items():
        if not ids:
            continue
        groups = np.split(np.array(sorted(ids)), np.where(np.diff(sorted(ids)) != 1)[0] + 1)
        ranges[name] = [value for group in groups for value in (int(group[0]), len(group))]
    return ranges

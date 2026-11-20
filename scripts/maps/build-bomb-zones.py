"""Bake separating-axis intervals from the placed Source 2 func_bomb_target hulls."""
import argparse
from collections import Counter
import json
from pathlib import Path
import runpy

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
source = runpy.run_path(str(ROOT/'scripts/maps/compile-source.py'))


def brush_intervals(triangles):
    # VRF exports one consecutive closed triangle shell per convex collision hull.
    edges, shell, hulls = Counter(), [], []
    for tri in triangles:
        vertices = [tuple(v.round(5)) for v in tri]
        for a, b in zip(vertices, vertices[1:]+vertices[:1]):
            edges[tuple(sorted((a, b)))] += 1
        shell.append(tri)
        if not all(count == 2 for count in edges.values()):
            continue
        faces = np.array(shell)
        points = faces.reshape(-1, 3)
        normals = np.cross(faces[:, 1]-faces[:, 0], faces[:, 2]-faces[:, 0])
        normals /= np.linalg.norm(normals, axis=1)[:, None]
        # A concave or incorrectly partitioned source must never become a filled box.
        assert np.max(points @ normals.T - (faces[:, 0]*normals).sum(axis=1)) < .0001
        axes = set()

        def add_axis(axis):
            length = np.linalg.norm(axis)
            if length < 1.e-6:
                return
            axis = (axis / length).round(6)
            if axis[np.flatnonzero(axis)[0]] < 0:
                axis = -axis
            axes.add(tuple(float(v) if v else 0 for v in axis))

        for axis in np.eye(3):
            add_axis(axis)
        for normal in normals:
            add_axis(normal)
        for a, b in edges:
            for axis in np.eye(3):
                add_axis(np.cross(np.subtract(b, a), axis))
        intervals = []
        for axis in sorted(axes):
            projections = points @ axis
            intervals.append([*axis, round(float(projections.min()), 5), round(float(projections.max()), 5)])
        hulls.append(intervals)
        edges.clear()
        shell.clear()
    assert hulls and not shell, 'Incomplete bomb-target hull'
    return hulls


def build(directory):
    info = json.loads((directory/'compiled/map.json').read_bytes())
    entities = [e for e in source['entities'](directory/'source/entities.txt') if e['classname'] == 'func_bomb_target']
    meshes = [(node, tri) for node, tri in source['physics_meshes'](directory/'raw/map_physics.gltf')
              if node.get('name', '').split(' ')[0] == 'func_bomb_target']
    assert len(meshes) == len(entities) == 2
    sites = {}
    for entity, (node, tri) in zip(entities, meshes):
        name = {'0':'A', '1':'B'}[str(entity['bomb_site_designation'])]
        assert np.linalg.norm(np.subtract(node['_gameOrigin'], source['point'](entity['origin']))) < .001
        assert name not in sites
        sites[name] = {'entity':entity['hammeruniqueid'], 'hulls':brush_intervals(tri)}
    return info['id'], {'source':info['sourceSha256'], 'sites':sites}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--extra', type=Path, default=ROOT/'artifacts/performance-maps/source-extra')
    parser.add_argument('--out', type=Path, default=ROOT/'shared/bomb-zones-data.js')
    args = parser.parse_args()
    roots = [Path(row['directory']) for row in json.loads((args.library/'exports.json').read_bytes())]
    roots.extend(p for p in args.extra.glob('de_*') if (p/'compiled/map.json').is_file())
    maps = dict(build(r) for r in roots)
    # The separately shipped original Dust II client uses an older VPK. Verify both
    # trigger meshes coincide before reusing the same intervals on this named build.
    baseline = [brush_intervals(t) for n, t in source['physics_meshes'](ROOT/'artifacts/cs2-dust2-render/dust2_physics.gltf')
                if n.get('name') == 'func_bomb_target']
    assert baseline == [maps['de_dust2']['sites'][s]['hulls'] for s in ('A','B')]
    maps['de_dust2']['compatibleSourceBuild'] = '25175329'
    args.out.write_text('// Generated from Valve bomb-target brush triangles by scripts/maps/build-bomb-zones.py.\n'
                        'export const BOMB_ZONES = '+json.dumps(maps, separators=(',', ':'))+';\n','utf8')
    print({k:[len(v['sites'][s]['hulls']) for s in ('A','B')] for k,v in maps.items()})

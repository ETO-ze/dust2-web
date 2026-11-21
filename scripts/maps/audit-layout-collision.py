"""Compare disabled alternate-layout VPK hulls to the exact packed gameplay triangles."""
import argparse
import importlib.util
import json
import pathlib
import re

import numpy as np

spec = importlib.util.spec_from_file_location('policy', pathlib.Path(__file__).with_name('build-entity-collision-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
source = policy.source
brush_target = re.compile(r'\[pr#\](?:brush\.blocker(?:\.[ab])?|retake\.[ab]site)', re.I)

def audit(record, directory):
    origin = pathlib.Path(record['directory'])
    entities_file = origin/'source/entities.txt'
    entities = source.entities(entities_file)
    targets = policy.enable_targets(entities_file.read_text(encoding='utf8'))
    compiled = directory/'compiled'
    archive = np.memmap(compiled/'physics.f32', dtype='<f4', mode='r').reshape(-1,3,3)
    mask = np.fromfile(compiled/'physics-mask.u8', dtype='u1')
    groups = json.loads((compiled/'physics-groups.json').read_bytes())
    rules = json.loads((directory/'entity-collision-policy.json').read_bytes())
    assert rules['sourceSha256']==record['sourceSha256'] and rules['entitiesSha256']==source.digest(entities_file)
    for filename, key in [('physics.f32','physicsSha256'),('physics-mask.u8','maskSha256'),('physics-groups.json','groupsSha256')]:
        assert source.digest(compiled/filename)==rules[key]

    def apply(group,bits):
        first, count = group['firstTriangle'], group['triangles']
        assert any(g['firstTriangle']==first and g['triangles']==count for g in groups)
        mask[first:first+count] &= bits
    for exclusion in rules['excludedGroups']:
        apply(exclusion,0)
    for exclusion in rules.get('nativePlayerExclusions',{}).get('groups',[]):
        apply(exclusion,6)
    rows, other_nonsolid = [], []
    for node, tri in source.physics_meshes(origin/'raw/map_physics.gltf'):
        state = policy.inactive_layout_prop(node,entities,targets)
        layout = bool(state)
        if not state:
            state = source.nonsolid_prop(node,entities) or source.brush_state(node,entities)
            if not state or state['solid'] or not state['sourceEntities']:
                continue
            layout = all(brush_target.fullmatch(entity.get('targetname','')) for entity in state['sourceEntities'])
        tri = tri[np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)>1e-8].astype('<f4')
        if not len(tri):
            continue
        matches = [g for g in groups if g['source']=='map_physics.gltf' and g['name']==node['name'] and g['triangles']==len(tri)
                   and np.array_equal(archive[g['firstTriangle']:g['firstTriangle']+len(tri)],tri)]
        present = [g['firstTriangle'] for g in matches]
        active = [first for first in present if np.any(mask[first:first+len(tri)])]
        vertices = tri.reshape(-1,3).astype(float)
        (rows if layout else other_nonsolid).append({'class':node['name'], 'sourceEntities':state['sourceEntities'], 'bounds':[vertices.min(0).tolist(), vertices.max(0).tolist()],
                     'triangles':len(tri), 'packedStarts':present, 'activeStarts':active})
    nonphysical = [g for g in groups if g['source']=='world_physics.gltf' and source.nonphysical_interaction(g)]
    active_world = [g['firstTriangle'] for g in nonphysical if np.any(mask[g['firstTriangle']:g['firstTriangle']+g['triangles']])]
    return {'map':record['id'], 'sourceSha256':rules['sourceSha256'], 'policySha256':source.digest(directory/'entity-collision-policy.json'),
            'excludedGroups':len(rules['excludedGroups']), 'nativePlayerExclusionGroups':len(rules.get('nativePlayerExclusions',{}).get('groups',[])),
            'layoutHulls':rows, 'retainedLayoutHulls':sum(bool(row['activeStarts']) for row in rows),
            'otherNonsolidSourceHulls':other_nonsolid, 'retainedNonsolidHulls':sum(bool(row['activeStarts']) for row in other_nonsolid),
            'nonphysicalWorldGroups':len(nonphysical), 'activeNonphysicalWorldGroups':active_world}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pool', required=True, type=pathlib.Path)
    parser.add_argument('--exports', required=True, nargs='+', type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args=parser.parse_args()
    records={r['id']:r for file in args.exports for r in json.loads(file.read_bytes())}
    result=[]
    for entry in json.loads((args.pool/'exports.json').read_bytes()):
        key=entry['id']
        record=audit(records[key],args.pool/key)
        print(key,'disabled hulls:',len(record['layoutHulls']),'remaining:',record['retainedLayoutHulls'],flush=True)
        result.append(record)
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf8')
    if any(row['retainedLayoutHulls'] or row['retainedNonsolidHulls'] or row['activeNonphysicalWorldGroups'] for row in result):
        raise SystemExit(1)

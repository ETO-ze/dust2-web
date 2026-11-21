"""Attach verified initial entity state to immutable private map archives.

Source-disabled brushes, nonsolid props and nonphysical interaction layers are excluded.
Coordinates and triangles are checked against the original exported geometry.
"""
import argparse
import importlib.util
import json
import pathlib
import re
import numpy as np

spec=importlib.util.spec_from_file_location('compile_source',pathlib.Path(__file__).with_name('compile-source.py'))
source=importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

LAYOUT_PROP = re.compile(r'\[pr#\](?:props\.2v2(?:\.[ab])?|brush\.blocker(?:\.[ab])?)', re.I)

def enable_targets(text):
    return [t.strip('"').lower() for t in re.findall(
        r'^@On\S+\s+(?:Delay=\S+\s+)?(?:Enable|Toggle)\s+(\S+)', text, re.M | re.I)]

def inactive_layout_prop(node, entities, targets):
    if node.get('name','').split(' ')[0] != 'prop_dynamic':
        return None
    origin = np.array(node['_gameOrigin'])
    matches = [e for e in entities if e.get('classname')=='prop_dynamic' and 'origin' in e
               and np.linalg.norm(origin-source.point(e['origin'])) < .001]
    evidence = []
    for entity in matches:
        target = entity.get('targetname','').lower()
        model = re.fullmatch(r'resource_name:"(models/[^"]+\.vmdl)"', entity.get('model',''))
        if (not entity.get('hammeruniqueid') or not model or not LAYOUT_PROP.fullmatch(target)
                or str(entity.get('startdisabled',False)).lower() not in {'1','true'}
                or any(target.startswith(t[:-1]) if t.endswith('*') else target==t for t in targets)):
            return None
        evidence.append({'id':entity['hammeruniqueid'], 'targetname':target, 'model':model[1], 'startdisabled':True})
    if evidence:
        return {'resolved':True, 'solid':False, 'reason':'inactive-layout-prop', 'origin':origin.tolist(), 'sourceEntities':evidence}
    return None

def build(report, archive=None, output=None, native_proof=None):
    root=pathlib.Path(report['directory']); compiled=(archive or root)/'compiled'
    entities=source.entities(root/'source/entities.txt')
    targets=enable_targets((root/'source/entities.txt').read_text(encoding='utf8'))
    groups=json.loads((compiled/'physics-groups.json').read_text())
    positions=np.fromfile(compiled/'physics.f32',dtype='<f4').reshape(-1,3,3)
    candidates=[g for g in groups if g['source']=='map_physics.gltf']
    unused=list(candidates)
    mapped=[];excluded=[]
    for node,tri in source.physics_meshes(root/'raw/map_physics.gltf'):
        state=source.brush_state(node,entities) or source.nonsolid_prop(node,entities) or inactive_layout_prop(node,entities,targets)
        if state is None: continue
        keep=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)>1e-8
        tri=tri[keep].astype('<f4')
        matches=[g for g in unused if g['name']==node['name'] and g['triangles']==len(tri)
                 and np.array_equal(positions[g['firstTriangle']:g['firstTriangle']+len(tri)],tri)]
        # A freshly recompiled map may already omit an initially nonsolid group.
        if not matches and not state['solid']: continue
        assert matches, f'Cannot match original collision geometry for {state}'
        group=matches[0];unused.remove(group)
        item={**state,'firstTriangle':group['firstTriangle'],'triangles':group['triangles']}
        if node['name']=='func_brush':mapped.append(item)
        if not state['solid'] and group['mask']: excluded.append(item)
    assert not any(g['name']=='func_brush' for g in unused), 'Unmapped brush groups'
    for group in groups:
        if group['mask'] and group['source']=='world_physics.gltf' and source.nonphysical_interaction(group):
            excluded.append({'firstTriangle':group['firstTriangle'],'triangles':group['triangles'],
                             'reason':'nonphysical-interaction','solid':False,'resolved':True})
    result={'schemaVersion':1,'map':report['id'],'sourceSha256':report['sourceSha256'],
            'physicsSha256':source.digest(compiled/'physics.f32'),'maskSha256':source.digest(compiled/'physics-mask.u8'),
            'groupsSha256':source.digest(compiled/'physics-groups.json'),'entitiesSha256':source.digest(root/'source/entities.txt'),
            'ruleSource':'https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/server/modelentities.h',
            'scope':'Initial competitive map entity state; dynamic I/O, doors, and breakable state transitions remain separate',
            'matchedBrushGroups':mapped,'excludedGroups':excluded,'excludedTriangles':sum(g['triangles'] for g in excluded)}
    if native_proof:
        proof=json.loads(native_proof.read_bytes()) if isinstance(native_proof,pathlib.Path) else native_proof
        for key in ('map','sourceSha256','physicsSha256','groupsSha256'):
            if result[key]!=proof[key]:raise ValueError('Native PHYS proof differs: '+key)
        result['nativePlayerExclusions']=proof
    source.write_json(output or root/'entity-collision-policy.json',result)
    print(json.dumps({'map':report['id'],'matchedGroups':len(mapped),'excludedGroups':len(excluded),'excludedTriangles':result['excludedTriangles']}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',required=True)
    parser.add_argument('--archive-root',type=pathlib.Path,help='Use collision group ranges from an existing map package')
    parser.add_argument('--output-root',type=pathlib.Path,help='Write the new policy into a separate staging directory')
    parser.add_argument('--native-proof-root',type=pathlib.Path,help='Merge verified native-player-exclusions.json from each map, if present')
    parser.add_argument('maps',nargs='*')
    args=parser.parse_args()
    for report in json.loads((pathlib.Path(args.root)/'exports.json').read_text()):
        if not args.maps or report['id'] in args.maps:
            archive=args.archive_root/report['id'] if args.archive_root else None
            output=args.output_root/report['id']/'entity-collision-policy.json' if args.output_root else None
            if output:output.parent.mkdir(parents=True,exist_ok=True)
            proof=args.native_proof_root/report['id']/'native-player-exclusions.json' if args.native_proof_root else None
            build(report,archive,output,proof if proof and proof.is_file() else None)

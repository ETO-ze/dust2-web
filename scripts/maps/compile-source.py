"""Build private, map-specific navigation and collision data from read-only exports.

Original render files are never resampled or rewritten. Physics is explicitly
split by player/bullet/grenade interaction; trigger volumes are not walls.
Source 2 NAV 36 layout: ValveResourceFormat/NavMesh (MIT).
"""
import argparse
import hashlib
import io
import json
import math
import pathlib
import re
import struct
from collections import Counter
from urllib.parse import unquote
import numpy as np

SCALE = .0254
ROTATE = np.array([[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [0, 0, 0, 1]], dtype=float)
DTYPES = {5120:'i1', 5121:'u1', 5122:'<i2', 5123:'<u2', 5125:'<u4', 5126:'<f4'}
COUNTS = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4, 'MAT4':16}

def point(p):
    return [float(p[0])*SCALE, float(p[2])*SCALE, -float(p[1])*SCALE]

def named(p):
    return dict(zip(('x', 'y', 'z'), map(float, p)))

def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')

def entities(path):
    result = []
    for block in re.split(r'^====\d+====\s*$', path.read_text(encoding='utf-8'), flags=re.M):
        item = {}
        for line in block.splitlines():
            fields = line.strip().split(None, 1)
            if len(fields) != 2:
                continue
            key, value = fields
            try:
                item[key] = json.loads(value)
            except json.JSONDecodeError:
                item[key] = value
        if 'classname' in item:
            result.append(item)
    return result

def nav_areas(path, *, ladders=None):
    f = io.BytesIO(path.read_bytes())
    def read(fmt):
        return struct.unpack('<'+fmt, f.read(struct.calcsize('<'+fmt)))
    def u():
        return read('I')[0]
    def kv3():
        f.seek((f.tell()+7)&~7)
        start = f.tell()
        header = f.read(120)
        assert header[:4] == b'\x053VK', 'Unsupported NAV KV3 version'
        compression = struct.unpack_from('<I', header, 20)[0]
        uncomp, comp, blocks, blobs = struct.unpack_from('<4I', header, 48)
        assert compression == 0 and blocks == 0, 'Compressed NAV requires a newer reader'
        f.seek(start+120+uncomp+blobs)
    magic, version, sub, flags = read('4I')
    assert magic == 0xFEEDFACE and version == 36, 'Only verified NAV 36 is supported'
    kv3()
    corners = [read('3f') for _ in range(u())]
    polygons = []
    for _ in range(u()):
        polygons.append([corners[u()] for _ in range(read('B')[0])])
        u()
    u()
    assert u() == 0, 'Movable NAV polygons need explicit runtime support'
    kv3()
    areas = []
    for _ in range(u()):
        area_id, attributes, hull, polygon = u(), read('q')[0], read('B')[0], polygons[u()]
        read('f')
        neighbors, portals = [], []
        for edge, _corner in enumerate(polygon):
            for _ in range(u()):
                neighbor, neighbor_edge = u(), u()
                neighbors.append(neighbor)
                portals.append({'to':neighbor,'edge':edge,'neighborEdge':neighbor_edge,
                                'a':point(polygon[edge]),'b':point(polygon[(edge+1)%len(polygon)])})
        f.read(5)
        f.read(u()*4)
        f.read(u()*4)
        # Keep original hull membership. Different hulls must not be merged.
        areas.append({'id':area_id, **named(point(np.mean(polygon, axis=0))),
                      'neighbors':sorted(set(neighbors)), 'hull':hull,
                      'attributes':str(attributes), 'corners':[point(p) for p in polygon], 'portals':portals})
    ids = {a['id'] for a in areas}
    assert len(ids) == len(areas), 'Duplicate navigation area ids'
    assert all(n in ids for a in areas for n in a['neighbors']), 'Unknown NAV neighbor'
    if ladders is not None:
        # Source 2 NAV v36 ladder records follow the complete area table.
        for _ in range(u()):
            key,width,*values=read('If3f3ffI7I')
            top,bottom=point(values[:3]),point(values[3:6])
            up=sorted(set(values[8:12])-{0})
            down=sorted(set(values[12:15])-{0})
            assert all(i in ids for i in up+down) and width>0 and top[1]>bottom[1]
            ladders.append({'id':key,'width':width*SCALE,'top':top,'bottom':bottom,'up':up,'down':down})
    return areas

def local_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=float).reshape(4,4).T
    x, y, z, w = node.get('rotation', [0,0,0,1])
    rot = np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                    [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                    [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    matrix = np.eye(4)
    matrix[:3,:3] = rot @ np.diag(node.get('scale', [1,1,1]))
    matrix[:3,3] = node.get('translation', [0,0,0])
    return matrix

def physics_meshes(path):
    doc = json.loads(path.read_text(encoding='utf-8'))
    buffers = [(path.parent/unquote(b['uri'])).read_bytes() for b in doc.get('buffers', [])]
    def accessor(index):
        a = doc['accessors'][index]
        assert 'sparse' not in a, 'Sparse collision accessor needs explicit conversion'
        view = doc['bufferViews'][a['bufferView']]
        dtype, count = np.dtype(DTYPES[a['componentType']]), COUNTS[a['type']]
        offset = view.get('byteOffset',0)+a.get('byteOffset',0)
        return np.ndarray((a['count'],count), dtype=dtype, buffer=buffers[view['buffer']],
                          offset=offset, strides=(view.get('byteStride',dtype.itemsize*count),dtype.itemsize))
    def walk(index, parent):
        node = doc['nodes'][index]
        matrix = parent @ local_matrix(node)
        if 'mesh' in node:
            triangles = []
            for p in doc['meshes'][node['mesh']]['primitives']:
                assert p.get('mode',4) == 4, 'Non-triangle collision primitive'
                v = accessor(p['attributes']['POSITION'])
                v = np.c_[v, np.ones(len(v))] @ matrix.T
                idx = accessor(p['indices']).reshape(-1) if 'indices' in p else np.arange(len(v))
                triangles.append(v[idx,:3].reshape(-1,3,3))
            if triangles:
                # Preserve the exact world transform for entity-state matching.
                # The export names contain only a class, not a unique entity id.
                yield {**node, '_gameOrigin':matrix[:3,3].tolist()}, np.concatenate(triangles)
        for child in node.get('children',[]):
            yield from walk(child, matrix)
    for index in doc['scenes'][doc.get('scene',0)]['nodes']:
        yield from walk(index, ROTATE)

def nonphysical_interaction(node):
    extras = node.get('extras', {})
    tags = extras.get('InteractAs', [])
    if isinstance(tags, str):
        tags = re.split(r'[,\s]+', tags)
    tags = {tag.lower() for tag in tags if tag}
    # Pure audio blockers and navigation/NPC clips are outside the three
    # player, bullet and grenade channels. Mixed solid tags take precedence.
    return (str(extras.get('CollisionGroup', '')).lower() == 'conditionallysolid'
            and bool(tags) and tags <= {'blocksound', 'npcclip', 'navclip'})

def collision_mask(node):
    if nonphysical_interaction(node):
        return 0
    tags = str(node.get('extras',{}).get('InteractAs', '')).lower()
    if 'csgo_grenadeclip' in tags:
        return 4
    if 'playerclip' in tags or 'npcclip' in tags:
        return 1
    if 'passbullets' in tags:
        return 1 | 4
    if 'ladder' in tags:
        return 1
    return 1 | 2 | 4

def brush_state(node, ents):
    """Resolve static brush collision from source entity settings, never NAV.

    Valve BrushSolidities_e: TOGGLE=0, NEVER=1, ALWAYS=2. Disabled TOGGLE
    brushes are absent initially; ALWAYS remains solid even when invisible.
    An ambiguous match is retained as solid (fail closed), not discarded.
    """
    if node.get('name','').split(' ')[0] != 'func_brush':
        return None
    origin = np.array(node.get('_gameOrigin', (ROTATE @ local_matrix(node))[:3,3]))
    matches = [e for e in ents if e.get('classname')=='func_brush' and 'origin' in e
               and np.linalg.norm(origin-point(e['origin'])) < .001]
    decisions = []
    for e in matches:
        solidity = int(e.get('solidity', 0))
        disabled = str(e.get('startdisabled', False)).lower() in {'true','1'}
        decisions.append('never-solid' if solidity==1 else 'initially-disabled' if solidity==0 and disabled else 'solid')
    resolved = bool(matches) and len(set(decisions))==1
    return {'resolved':resolved,'reason':decisions[0] if resolved else 'unresolved-retained-solid',
            'solid':not resolved or decisions[0]=='solid','origin':origin.tolist(),
            'sourceEntities':[{'id':e.get('hammeruniqueid'),'targetname':e.get('targetname',''),
                               'solidity':int(e.get('solidity',0)),'startdisabled':e.get('startdisabled',False)} for e in matches]}

def nonsolid_prop(node, ents):
    if node.get('name','').split(' ')[0] != 'prop_dynamic':
        return None
    origin = np.array(node['_gameOrigin'])
    matches = [e for e in ents if e['classname']=='prop_dynamic' and 'origin' in e
               and np.linalg.norm(origin-point(e['origin'])) < .001]
    if not matches or not all(str(e.get('solid')) == '0' and e.get('hammeruniqueid') for e in matches):
        return None
    return {'resolved':True, 'solid':False, 'reason':'non-solid-prop', 'origin':origin.tolist(),
            'sourceEntities':[{'id':e['hammeruniqueid'], 'solid':0, 'model':e.get('model','')} for e in matches]}

def compile_map(report):
    root = pathlib.Path(report['directory'])
    output = root/'compiled'
    output.mkdir(exist_ok=True)
    assert report['exportValidated'], 'Refuse an incomplete export'
    areas = nav_areas(root/'source/map.nav')
    ents = entities(root/'source/entities.txt')
    groups, volumes, chunks, mask_chunks, entity_states = [], [], [], [], []
    cursor = 0
    for source in [root/'source/world_physics.gltf', root/'raw/map_physics.gltf']:
        world = source.name == 'world_physics.gltf'
        for node, tri in physics_meshes(source):
            name = node.get('name','')
            classname = name.split(' ')[0]
            is_volume = classname in {'func_bomb_target','func_buyzone','env_cs_place'}
            if is_volume:
                vertices = tri.reshape(-1,3)
                volumes.append({'class':classname,'name':name,'min':vertices.min(0).tolist(),'max':vertices.max(0).tolist()})
            # Runtime dynamic props/doors need a separate entity simulation.
            # Do not silently bake an animated door or a trigger into a wall.
            if not world and classname not in {'func_brush','func_breakable','prop_dynamic','prop_static'}:
                continue
            state = brush_state(node, ents) if not world else None
            if state:
                entity_states.append(state)
                if not state['solid']:
                    continue
            keep = np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)>1e-8
            tri = tri[keep].astype('<f4')
            if not len(tri):
                continue
            assert np.isfinite(tri).all()
            mask = 0 if not world and nonsolid_prop(node, ents) else collision_mask(node)
            groups.append({'name':name,'firstTriangle':cursor,'triangles':len(tri),'mask':mask,'source':source.name,'extras':node.get('extras',{})})
            cursor += len(tri)
            chunks.append(tri)
            mask_chunks.append(np.full(len(tri),mask,dtype=np.uint8))
    assert chunks, 'No collision triangles'
    with open(output/'physics.f32','wb') as f:
        for chunk in chunks:
            f.write(chunk.tobytes())
    with open(output/'physics-mask.u8','wb') as f:
        for chunk in mask_chunks:
            f.write(chunk.tobytes())
    write_json(output/'physics-groups.json', groups)
    write_json(output/'entity-collision-state.json', entity_states)
    write_json(output/'nav.json',areas)
    write_json(output/'volumes.json',volumes)
    spawns = {'CT':[], 'T':[]}
    for e in ents:
        team = {'info_player_counterterrorist':'CT','info_player_terrorist':'T'}.get(e['classname'])
        if team and e.get('enabled',True) not in (False,0,'0'):
            spawns[team].append({**named(point(e['origin'])), 'yaw':-math.radians(e.get('angles',[0,0,0])[1])-math.pi/2,
                                 'priority':e.get('priority',0), 'sourceEntity':e.get('hammeruniqueid')})
    bombs = [e for e in ents if e['classname']=='func_bomb_target']
    targets = [v for v in volumes if v['class']=='func_bomb_target']
    assert len(bombs)==len(targets)==2, f'Need exactly two matched bomb volumes: {len(bombs)}/{len(targets)}'
    sites = {}
    for entity, volume in zip(bombs,targets):
        site = {'0':'A','1':'B'}[str(entity['bomb_site_designation'])]
        low, high = np.array(volume['min']), np.array(volume['max'])
        center = (low+high)/2
        candidates = [a for a in areas if a['hull']==0 and all(low[i]-.5 <= a[k] <= high[i]+.5 for i,k in enumerate(('x','y','z')))]
        assert candidates, f'Bomb volume {site} has no walkable NAV area'
        target = min(candidates,key=lambda a:sum((a[k]-center[i])**2 for i,k in enumerate(('x','y','z'))))
        sites[site] = {**{k:target[k] for k in ('x','y','z')}, 'navId':target['id'], 'bounds':{'min':volume['min'],'max':volume['max']}, 'radius':float(min(high[0]-low[0], high[2]-low[2])/2)}
    assert set(sites)=={'A','B'} and all(len(s)>=5 for s in spawns.values()), 'Missing original gameplay entities'
    positions = np.array([[a['x'],a['y'],a['z']] for a in areas if a['hull']==0])
    flags = {'navigationParsed':True,'physicsChannelsSeparated':True,'sourceTexturesPreserved':True,
             'visualParityValidated':False,'walkingValidated':False,'utilityValidated':False,'playable':False}
    metadata = {'schemaVersion':1,'id':report['id'],'name':report['name'],'nameZh':report['nameZh'],
                'sourceBuild':report['sourceBuild'],'sourceSha256':report['sourceSha256'], 'public':False,
                'units':'metres','sourceToGame':'(x, z, -y) * 0.0254', 'renderRotationY':math.pi/2,
                'bounds':{'min':named(positions.min(0)), 'max':named(positions.max(0))},
                'spawns':spawns,'sites':sites,'navHulls':dict(Counter(a['hull'] for a in areas)),
                'physics':{'triangles':cursor,'maskBits':{'player':1,'bullet':2,'grenade':4},'groups':len(groups)},
                'validation':flags,'unsupported':['Source 2 baked lighting and shader parity','Movable doors and props','Ladders and breakables need gameplay validation']}
    write_json(output/'map.json',metadata)
    files = [{'path':p.name,'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(output.iterdir()) if p.is_file() and p.name!='manifest.json']
    write_json(output/'manifest.json',{'map':report['id'],'sourceSha256':report['sourceSha256'],'files':files,'validation':flags})
    print(json.dumps({'map':report['id'],'nav':len(areas),'hulls':metadata['navHulls'],'spawns':{k:len(v) for k,v in spawns.items()},'triangles':cursor,'sites':sites}),flush=True)
    return metadata

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',required=True)
    parser.add_argument('maps',nargs='*')
    args=parser.parse_args()
    reports=json.loads((pathlib.Path(args.root)/'exports.json').read_text(encoding='utf-8'))
    for report in reports:
        if not args.maps or report['id'] in args.maps:
            compile_map(report)

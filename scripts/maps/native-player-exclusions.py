"""Match CS2 PHYS collision shapes that explicitly exclude players to exported groups.

The glTF exporter retains CollisionGroup and InteractAs, but omits InteractExclude.
Only whole exported groups matching a native triangle multiset are eligible.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
from collections import defaultdict

import numpy as np
from scipy.spatial import cKDTree


def digest(file):
    with file.open('rb') as src:
        return hashlib.file_digest(src, 'sha256').hexdigest()


def dump(cli, model):
    with subprocess.Popen([str(cli), '-i', str(model), '-b', 'PHYS'], stdout=subprocess.PIPE) as proc:
        yield from (line.strip() for line in proc.stdout)
        if proc.wait():
            raise RuntimeError('Cannot decode native PHYS resource')


def attributes(cli, model):
    text = []
    active = False
    for line in dump(cli, model):
        active |= line == b'm_collisionAttributes ='
        if active:
            text.append(line.decode('utf8'))
    result = []
    for block in re.findall(r'\{([^{}]*?m_InteractExcludeStrings[^{}]*?)\}', '\n'.join(text), re.S):
        def strings(key):
            return re.findall(r'"([^"]+)"', re.search(key+r'\s*=\s*\[([^\]]*)\]', block, re.S)[1])
        result.append({'group':re.search(r'm_CollisionGroupString = "([^"]+)"', block)[1],
                       'as':strings('m_InteractAsStrings'), 'exclude':strings('m_InteractExcludeStrings')})
    return result


def shape_triangles(shape):
    blob = shape['blobs']
    if shape['type'] == 'Mesh':
        vertices = np.frombuffer(blob['m_Vertices'], dtype='<f4').reshape(-1, 3)
        indices = np.frombuffer(blob['m_Triangles'], dtype='<u4').reshape(-1, 3)
    else:
        vertices = np.frombuffer(blob['m_VertexPositions'], dtype='<f4').reshape(-1, 3)
        edges = np.frombuffer(blob['m_Edges'], dtype='u1').reshape(-1, 4)
        faces = np.frombuffer(blob['m_Faces'], dtype='u1')
        indices = []
        for face, first in enumerate(faces):
            ring = []
            edge = int(first)
            while True:
                nxt, _, origin, owner = map(int, edges[edge])
                if owner != face or len(ring) > len(edges):
                    raise ValueError('Invalid PHYS hull topology')
                ring.append(origin)
                edge = nxt
                if edge == first:
                    break
            indices.extend((ring[0],ring[i],ring[i+1]) for i in range(1,len(ring)-1))
        indices = np.array(indices, dtype=np.int32).reshape(-1,3)
    xyz = vertices[:, [0,2,1]].astype(np.float64)*[.0254,.0254,-.0254]
    triangles = xyz[indices]
    good = np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]),axis=1)>1e-8
    return triangles[good]


def excluded_shapes(cli, model, attrs):
    shape = None
    field = None
    selected = defaultdict(list)
    wanted = {'m_Faces','m_Edges','m_VertexPositions','m_Triangles','m_Vertices'}
    def flush():
        if shape and shape.get('type'):
            selected[(shape['attr'],shape['surface'])].append(shape_triangles(shape))
    for line in dump(cli, model):
        if line.startswith(b'm_nCollisionAttributeIndex ='):
            flush()
            attr = int(line.split()[-1])
            shape = {'attr':attr,'surface':None,'blobs':{}} if 'player' in attrs[attr]['exclude'] else None
            field = None
        elif line == b'm_collisionAttributes =':
            flush()
            shape = None
        elif shape:
            if line.startswith(b'm_nSurfacePropertyIndex ='):
                shape['surface'] = int(line.split()[-1])
            elif line in (b'm_Hull =',b'm_Mesh ='):
                shape['type'] = line.decode()[2:-2]
            elif line.startswith(b'm_'):
                field, _, value = line.partition(b'=')
                field = field.strip().decode()
                if field not in wanted or (field=='m_Vertices' and shape.get('type')=='Hull'):
                    field = None
                    continue
                shape['blobs'][field] = bytearray()
                line = value.strip()
            if field:
                payload = line.strip(b'#[] \r\n\t')
                if payload:
                    shape['blobs'][field].extend(bytes.fromhex(payload.decode()))
                if line.endswith(b']'):
                    field = None
    return selected


def rows(indices):
    a = np.ascontiguousarray(np.sort(indices, axis=1),dtype='<i4')
    return np.sort(a.view('V12').reshape(-1))


def matches(original, compiled):
    if len(original) != len(compiled) or not len(compiled):
        return False
    pts, ids = np.unique(original.reshape(-1,3),axis=0,return_inverse=True)
    distance, nearest = cKDTree(pts).query(compiled.reshape(-1,3))
    # 0.1 mm permits float32 coordinate conversion at Vertigo's elevation.
    return distance.max() < .0001 and np.array_equal(rows(ids.reshape(-1,3)),rows(nearest.reshape(-1,3)))


def build(cli, vpk, archive, output):
    meta = json.loads((archive/'compiled/map.json').read_bytes())
    if digest(vpk) != meta['sourceSha256']:
        raise ValueError('Source VPK differs from the sealed map')
    modelpath='maps/'+meta['id']+'/world_physics.vmdl_c'
    with tempfile.TemporaryDirectory() as tmp:
        model=pathlib.Path(tmp)/'world_physics.vmdl_c'
        subprocess.run([str(cli),'-i',str(vpk),'-f',modelpath,'-o',str(model)],check=True,stdout=subprocess.DEVNULL)
        attrs=attributes(cli,model)
        shapes=excluded_shapes(cli,model,attrs)
        modelhash=digest(model)
    physics=archive/'compiled/physics.f32'
    groupsfile=archive/'compiled/physics-groups.json'
    triangles=np.memmap(physics,dtype='<f4',mode='r').reshape(-1,3,3)
    groups=json.loads(groupsfile.read_bytes())
    changes=[]
    for (attr, surface), parts in shapes.items():
        native=np.concatenate(parts)
        for g in groups:
            if g['source']!='world_physics.gltf' or not g['mask']&1 or g['triangles']!=len(native):continue
            tags=g['extras']
            if attrs[attr]['group']!=tags['CollisionGroup'] or set(attrs[attr]['as'])!=set(tags['InteractAs']):continue
            start=g['firstTriangle'];end=start+g['triangles']
            if not matches(native,triangles[start:end]):continue
            changes.append({'firstTriangle':start,'triangles':g['triangles'],'oldMask':g['mask'],
                            'nativeAttribute':attr,'nativeSurface':surface,'nativeShapes':len(parts),
                            'group':tags['CollisionGroup'],'interactAs':tags['InteractAs'],
                            'surfaceProperty':tags['SurfaceProperty'],'interactExclude':attrs[attr]['exclude']})
    if len({r['firstTriangle'] for r in changes})!=len(changes):raise ValueError('Ambiguous native group')
    proof={'schemaVersion':1,'map':meta['id'],'sourceSha256':meta['sourceSha256'],'worldModel':modelpath,
           'worldPhysicsSha256':modelhash,'physicsSha256':digest(physics),'groupsSha256':digest(groupsfile),
           'match':'identical native and exported triangle vertex-index multisets, complete group, position tolerance < 0.1 mm',
           'groups':sorted(changes,key=lambda g:g['firstTriangle'])}
    output.write_text(json.dumps(proof,separators=(',',':')),encoding='utf8')
    print(meta['id'],[(r['nativeAttribute'],r['nativeShapes'],r['surfaceProperty'],r['triangles']) for r in changes])


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ('cli','vpk','archive','output'):parser.add_argument(key,type=pathlib.Path)
    a=parser.parse_args();build(a.cli,a.vpk,a.archive,a.output)

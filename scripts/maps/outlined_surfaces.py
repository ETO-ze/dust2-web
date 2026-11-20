"""Bake architectural outlines from the flat render mesh (collision stays unchanged).

Edges reuse existing GPU positions. The extra GL_LINES index buffer is the only
outline payload. Coplanar triangles, UV splits, tiny bevels and internal mesh
diagonals are discarded. Geometry and lines live in the same breakable node.
"""
import hashlib
import json
import math
from pathlib import Path
import numpy as np

PALETTES = {
    'de_dust2': ([233,211,177],[177,182,175]),
    'de_mirage': ([236,208,179],[183,181,173]),
    'de_inferno': ([231,197,181],[169,174,170]),
    'de_nuke': ([213,226,229],[159,178,188]),
    'de_ancient': ([207,218,191],[162,177,154]),
    'de_anubis': ([235,216,172],[173,189,177]),
    'de_cache': ([208,219,211],[164,177,169]),
    'de_train': ([223,212,191],[170,178,183]),
    'de_vertigo': ([223,224,225],[171,188,196]),
}

def feature_indices(points, indices, min_length=.34, min_angle=38):
    tris = indices.reshape(-1,3)
    # Exported flat colours can split vertex IDs across a physical edge.
    _, welded = np.unique(np.rint(points*500).astype('i4'), axis=0, return_inverse=True)
    welded = welded.ravel()
    p = points[tris]
    normals = np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
    lengths = np.linalg.norm(normals,axis=1)
    keep=lengths>1e-8
    tris=tris[keep]
    normals=normals[keep]/lengths[keep,None]
    edges=tris[:,[0,1,1,2,2,0]].reshape(-1,2)
    pairs=np.sort(welded[edges],axis=1).astype('uint64')
    keys=(pairs[:,0]<<32)|pairs[:,1]
    order=np.argsort(keys,kind='stable')
    sorted_keys=keys[order]
    first=np.flatnonzero(np.r_[True,sorted_keys[1:]!=sorted_keys[:-1]])
    if not len(keys): return np.empty(0,dtype=indices.dtype)
    count=np.diff(np.r_[first,len(keys)])
    a=order[first]
    b=order[first+count-1]
    sharp=np.abs(np.einsum('ij,ij->i',normals[a//3],normals[b//3]))<math.cos(math.radians(min_angle))
    chosen=edges[a[(count==1)|sharp]]
    delta=points[chosen[:,0]]-points[chosen[:,1]]
    return chosen[np.einsum('ij,ij->i',delta,delta)>=min_length**2].reshape(-1).astype(indices.dtype)

def bake(directory):
    rd=directory/'render'; target=rd/'map.gltf';doc=json.loads(target.read_bytes())
    if doc.get('extras',{}).get('outlineVersion')==1: return
    raw=bytearray((rd/'map.bin').read_bytes())
    def view(index,dtype,cols=1):
        acc=doc['accessors'][index];bv=doc['bufferViews'][acc['bufferView']]
        assert not bv.get('byteStride')
        offset=bv.get('byteOffset',0)+acc.get('byteOffset',0)
        return np.frombuffer(raw,dtype,count=acc['count']*cols,offset=offset).reshape(acc['count'],cols)
    ink=len(doc['materials'])
    doc['materials'].append({'name':'graphite','extensions':{'KHR_materials_unlit':{}},
       'pbrMetallicRoughness':{'baseColorFactor':[.073,.103,.118,1],'metallicFactor':0,'roughnessFactor':1}})
    wall,ground=PALETTES[directory.name]
    total=0
    for mesh in doc['meshes']:
        face=mesh['primitives'][0];pos=face['attributes']['POSITION'];idx=face['indices']
        dtype={5123:'<u2',5125:'<u4'}[doc['accessors'][idx]['componentType']]
        points=view(pos,'<f4',3)
        lines=feature_indices(points,view(idx,dtype).ravel())
        rgba=view(face['attributes']['COLOR_0'],'u1',4)
        # glTF vertex colours are linear; convert the design's display RGB first.
        floor=rgba[:,2].astype('i4')>rgba[:,0].astype('i4')
        palette=np.where(floor[:,None],ground,wall)
        light=np.clip(rgba[:,:3].max(axis=1)/210,.64,1.08)
        srgb=np.clip(palette*(.35+.65*light[:,None])/255,0,1)
        rgba[:,:3]=np.rint(255*((srgb+.055)/1.055)**2.4).astype('u1')
        del rgba,points
        if not lines.size: continue
        data=lines.tobytes();offset=len(raw)
        raw.extend(data);raw.extend(bytes((-len(raw))%4))
        vi=len(doc['bufferViews']);ai=len(doc['accessors'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data),'target':34963})
        doc['accessors'].append({'bufferView':vi,'componentType':doc['accessors'][idx]['componentType'],'count':int(lines.size),'type':'SCALAR'})
        mesh['primitives'].append({'mode':1,'attributes':{'POSITION':pos},'indices':ai,'material':ink})
        total+=lines.size//2
    doc['buffers'][0]['byteLength']=len(raw)
    doc.setdefault('extras',{}).update(outlineVersion=1,outlineSegments=int(total))
    (rd/'map.bin').write_bytes(raw)
    target.write_text(json.dumps(doc,separators=(',',':')),encoding='utf-8')

def refresh(directory):
    bake(directory)
    rd=directory/'render'
    mf=directory/'render-manifest.json'
    manifest=json.loads(mf.read_bytes())
    for f in manifest['files']:
        data=(rd/f['path']).read_bytes()
        f.update(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
    mf.write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    mapping=directory/'flat-breakables.json'
    if mapping.exists():
        obj=json.loads(mapping.read_bytes())
        obj['renderSha256']=hashlib.sha256((rd/'map.gltf').read_bytes()).hexdigest()
        mapping.write_text(json.dumps(obj,separators=(',',':')),encoding='utf-8')
    print(directory.name,json.loads((rd/'map.gltf').read_bytes())['extras'],flush=True)

if __name__=='__main__':
    import sys
    for name in sys.argv[1:]:
        refresh(Path(name))

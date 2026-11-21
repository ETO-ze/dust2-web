"""Retriangulate shallow, consistently wound architectural surface fans in sealed performance maps."""
import argparse
import pathlib
import shutil
import sys
import runpy
import numpy as np
from mathutils.bvhtree import BVHTree

base = runpy.run_path(str(pathlib.Path(__file__).with_name('blender-crisp-geometry.py')))
read, write = base['read'], base['write']
get = np.einsum
norm = np.linalg.norm

def relief_pass(pos, colors, faces, fixed_bounds):
    # Positions can be split solely for baked illumination on either side of an edge.
    # Build topological neighbours in the exported world coordinate space, while preserving
    # the original colour index at every unchanged corner.
    xyz, rep, geo = np.unique(pos, axis=0, return_index=True, return_inverse=True)
    geo = geo.ravel()
    n = len(xyz)
    gf = geo[faces]
    cen = gf.ravel()
    nxt, prv = np.roll(gf,-1,axis=1).ravel(), np.roll(gf,1,axis=1).ravel()
    nk = np.minimum(cen,nxt).astype('i8') * n + np.maximum(cen,nxt)
    edges, inv, freq = np.unique(nk, return_inverse=True, return_counts=True)
    bad = edges[(freq != 2) | (np.bincount(inv,weights=np.where(cen<nxt,1.,-1.))!=0)]
    allowed = np.ones(n,dtype=bool)
    allowed[bad//n] = False
    allowed[bad%n] = False
    # Geometry on a tile boundary, also bounds of detached top/bottom levels, stays exact.
    for axis in range(3):
        allowed &= (xyz[:,axis] > fixed_bounds[0,axis]+.001) & (xyz[:,axis] < fixed_bounds[1,axis]-.001)
    deg = np.bincount(cen,minlength=n)
    allowed &= (deg>=3)&(deg<=32)
    offsets=np.r_[0,np.cumsum(deg)]
    order=np.argsort(cen,kind='stable')
    first=order[np.minimum(offsets[:-1],len(order)-1)]//3
    tags=colors[faces.ravel(),3].astype(int)
    allowed[cen[tags!=colors[faces[first[cen],0],3]]] = False
    allowed[cen[~np.isin(tags,[1,2,3,4,5,6,255])]]=False
    # Protect independently drawn signage, coloured lettering and strong source-light seams.
    cmin=np.full((n,3),255,dtype='i2')
    cmax=np.zeros((n,3),dtype='i2')
    np.minimum.at(cmin,cen,colors[np.roll(faces,-1,axis=1).ravel(),:3])
    np.maximum.at(cmax,cen,colors[np.roll(faces,-1,axis=1).ravel(),:3])
    c0=colors[rep,:3]
    allowance=np.where(colors[rep,3]==255,30,65)
    allowed &= (np.maximum(cmax,c0)-np.minimum(cmin,c0)).max(axis=1)<=allowance
    allowed &= (colors[rep,3]!=255) | (c0.max(axis=1).astype(int)-c0.min(axis=1)<=36)
    if not allowed.any(): return faces,[],0
    delta=xyz[nxt]-xyz[cen]
    vectors=np.cross(pos[faces[:,1]]-pos[faces[:,0]], pos[faces[:,2]]-pos[faces[:,0]])
    area=norm(vectors,axis=1)
    normals=vectors/np.maximum(area[:,None],1e-22)
    ringnorm=np.zeros((n,3),dtype='f8')
    np.add.at(ringnorm,cen,np.repeat(vectors,3,axis=0))
    ringnorm/=np.maximum(norm(ringnorm,axis=1)[:,None],1e-22)
    allowed[cen[(np.repeat(area,3)<1e-9)|(get('ij,ij->i',ringnorm[cen],np.repeat(normals,3,axis=0))<.85)]]=False
    # Restrict to wall and ground planes. Keep intermediate inclines and stair profiles.
    ny=np.abs(ringnorm[:,1])
    allowed &= (ny<.25)|(ny>.86)
    h=get('ij,ij->i',delta,ringnorm[cen])
    allowed[cen[np.abs(h)>.026]]=False
    # Use only interior shallow relief. The projected boundary of each fan must be unchanged.
    ds=get('ij,ij->i',delta,delta)
    byedge=np.lexsort((nxt,ds,cen))
    choice=byedge[np.minimum(offsets[:-1],len(order)-1)]
    target=nxt[choice]
    target_idx=np.roll(faces,-1,axis=1).ravel()[choice]
    new=xyz[target[cen]]
    retained=(nxt!=target[cen])&(prv!=target[cen])
    cross=np.cross(xyz[nxt]-new,xyz[prv]-new)
    oriented=get('ij,ij->i',cross,ringnorm[cen])
    allowed[cen[retained & ((oriented < 1e-9)|(oriented < norm(cross,axis=1)*.88))]]=False
    # Avoid removing large coverage triangles around ledges. Flat one-rings have no restriction.
    mean_height=np.abs(np.bincount(cen,weights=h,minlength=n)/np.maximum(deg,1))
    allowed[cen[(ds>1.65**2)&(mean_height[cen]>.001)]]=False
    # Verify the target position also has a matching original colour class.
    allowed &= colors[target_idx,3]==colors[rep,3]
    neighbors=nxt[order]
    occupied=np.zeros(n,dtype=bool)
    replace=np.zeros(n,dtype=bool)
    examples=[]
    for v in np.flatnonzero(allowed)[np.argsort(-mean_height[allowed],kind='stable')]:
        if occupied[v]: continue
        ring=neighbors[offsets[v]:offsets[v+1]]
        t=target[v]
        if len(set(ring).intersection(neighbors[offsets[t]:offsets[t+1]]))!=2: continue
        corners=order[offsets[v]:offsets[v+1]]
        successor=dict(zip(nxt[corners],prv[corners]))
        cursor=ring[0]
        for i in range(len(ring)):
            cursor=successor[cursor]
            if cursor==ring[0]:break
        if i+1!=len(ring): continue
        replace[v]=True
        occupied[ring]=True
        occupied[v]=True
        if mean_height[v]>.0004:
            examples.append((float(mean_height[v]),xyz[v].tolist(),ringnorm[v].tolist(),len(ring)))
    count=int(replace.sum())
    if not count:return faces,[],0
    ind=replace[gf]
    out=faces.copy()
    out[ind]=target_idx[gf[ind]]
    mapped=geo[out]
    keep=(mapped[:,0]!=mapped[:,1])&(mapped[:,1]!=mapped[:,2])&(mapped[:,0]!=mapped[:,2])
    # Do not touch pre-existing degenerate triangles anywhere else.
    keep|=~ind.any(axis=1)
    assert len(faces)-keep.sum()==2*count
    return out[keep],examples,count

def measure(pos, start, candidate):
    if len(start)==len(candidate):return 0,0
    # Sample edits directly, with corner, edge and interior points on each changed face.
    trees=[BVHTree.FromPolygons(pos.tolist(),f.tolist(),all_triangles=True) for f in [start,candidate]]
    def keys(f):
        return (f[:,0].astype('i8')*len(pos)+f[:,1])*len(pos)+f[:,2]
    keys0,keys1=map(keys,[start,candidate])
    rng=np.random.default_rng(3784)
    count=0
    error=0
    for f, own, other, tree in [(start,keys0,keys1,trees[1]),(candidate,keys1,keys0,trees[0])]:
        fs=f[~np.isin(own,other)]
        if not len(fs):continue
        selected=fs[rng.choice(len(fs),min(len(fs),600),replace=False)]
        tri=pos[selected]
        samples=np.vstack((tri.mean(axis=1),tri[:,0],(tri[:,1]+tri[:,2])*.5))
        for q in samples:
            d=tree.find_nearest(q)[3]
            error=max(error,d)
        count+=len(samples)
    return count,error

def process(src,out,map_id):
    original=src/map_id
    dest=out/'maps-v1'/map_id
    if not dest.exists():shutil.copytree(original,dest)
    doc=read(original/'render/map.gltf')
    blob=(original/'render/map.bin').read_bytes()
    assert doc['extras']['crispPlanarPass']==1
    report=dict(id=map_id,before=0,after=0,samples=0,maxDeviationMm=0.,batches=[],examples=[])
    replacements={}
    surface_totals={}
    for node in doc['nodes']:
        name=node['name']
        prim,pos,col,faces=base['unpack'](doc,blob,node)
        current=faces
        results=[]
        examples=[]
        rejected=False
        if name.startswith('tile_'):
            box=np.array([pos.min(axis=0),pos.max(axis=0)])
            for _ in range(4):
                candidate,new_ex,n=relief_pass(pos,col,current,box)
                if not n:break
                current=candidate
                results.append(n)
                examples.extend(new_ex)
            points,displacement=measure(pos,faces,current)
            report['samples']+=points
            rejected=displacement>.029
            if rejected:
                current=faces;examples=[]
            else:
                report['maxDeviationMm']=max(report['maxDeviationMm'],displacement*1000)
        for h,location,normal,degree in sorted(examples,reverse=True)[:2]:
            report['examples'].append(dict(node=name,oneRingReliefMm=h*1000,sourcePosition=location,sourceNormal=normal,before=degree,after=degree-2))
        report['before']+=len(faces)
        report['after']+=len(current)
        report['batches'].append(dict(node=name,before=len(faces),after=len(current),collapses=results,rejected=rejected))
        tags, counts=np.unique(col[current[:,0],3],return_counts=True)
        for tag,n in zip(tags,counts):surface_totals[str(tag)]=surface_totals.get(str(tag),0)+int(n)
        if len(current)!=len(faces):
            current,_,_=base['compact_attributes'](doc,blob,prim,current,replacements)
            acc=doc['accessors'][prim['indices']]
            acc['count']=3*len(current)
            if 'min' in acc:acc['min']=[int(current.min())]
            if 'max' in acc:acc['max']=[int(current.max())]
            replacements[acc['bufferView']]=current.astype(base['DTYPE'][acc['componentType']]).tobytes()
    report['examples'].sort(key=lambda e:-e['oneRingReliefMm'])
    report['examples']=report['examples'][:24]
    assert report['after']<report['before'],map_id
    doc['extras'].update(arenaShallowRelief=1,outputTriangles=report['after'],surfaceTriangles=surface_totals)
    packed=base['pack_views'](doc,blob,replacements)
    temp=dest/'render/map.bin.part'
    temp.write_bytes(packed)
    temp.replace(dest/'render/map.bin')
    write(dest/'render/map.gltf',doc)
    write(out/'relief-audit'/(map_id+'.json'),report)
    print(map_id,report['before'],report['after'],report['maxDeviationMm'],len(report['examples']),flush=True)

parser=argparse.ArgumentParser()
parser.add_argument('--source',type=pathlib.Path,default='artifacts/blender-nine-crisp/maps-v1')
parser.add_argument('--output',type=pathlib.Path,default='artifacts/blender-arena')
parser.add_argument('--maps',nargs='+',default=['de_'+m for m in base['MAPS']])
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
for mid in args.maps:process(args.source,args.output,mid)
shutil.copytree(args.source/'radars',args.output/'maps-v1'/'radars',dirs_exist_ok=True)
shutil.copy2(args.source/'exports.json',args.output/'maps-v1'/'exports.json')

"""Place wall paint on static render triangles and verify a standing NAV sightline to each mark.

Run in Blender: blender -b -P scripts/maps/build-wall-site-signs.py -- SEALED_MAPS SOURCE_LIBRARY SUPPLEMENTAL_SOURCES CLIENT_JSON CAMERA_JSON
Existing Nuke and Vertigo plaques intentionally stay on the placed source decal.
"""
import argparse
import json
from pathlib import Path
import sys
import math
import heapq
import numpy as np
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from site_marking_source import attribute, source_file, placed_markings,world_coords

def unit(v):
    return v/max(np.linalg.norm(v),1e-10)

def ray(tree,p,v,dist):
    hit,n,face,d=tree.ray_cast(p,v,dist)
    return None if hit is None else (np.array(hit), np.array(n), d)

def graph_reach(nav,spawn):
    nodes={a['id']:a for a in nav}
    xyz={k:np.array([a[t] for t in 'xyz']) for k,a in nodes.items()}
    initial=min(xyz,key=lambda k:np.linalg.norm(xyz[k]-spawn))
    dist={initial:0};pq=[(0,initial)]
    while pq:
        cost,k=heapq.heappop(pq)
        if dist[k]<cost:continue
        for j in nodes[k]['neighbors']:
            if j not in nodes:continue
            ncost=cost+np.linalg.norm(xyz[k]-xyz[j])
            if ncost>=dist.get(j,1e30):continue
            heapq.heappush(pq,(ncost,j));dist[j]=ncost
    return [(xyz[k],cost) for k,cost in dist.items()]

def render_tree(folder):
    doc=json.loads((folder/'render/map.gltf').read_bytes())
    buf=(folder/'render/map.bin').read_bytes()
    chunks=[];faces=[];flags=[];length=0
    for node in doc['nodes']:
        for p in doc['meshes'][node['mesh']]['primitives']:
            a=attribute(doc,buf,p['attributes']['POSITION'])*node.get('scale',[1]*3)+node.get('translation',[0]*3)
            ix=attribute(doc,buf,p['indices']).reshape(-1,3).astype('i4')
            chunks.append(world_coords(a));faces.append(ix+length);length+=len(a)
            material=doc['materials'][p['material']]
            flags.extend([node.get('name','').startswith('tile_') and material.get('alphaMode','OPAQUE')=='OPAQUE']*len(ix))
    return BVHTree.FromPolygons(np.vstack(chunks).tolist(),np.vstack(faces).tolist(),all_triangles=True),np.array(flags)

def surface_hit(tree,flags,p,direction,dist):
    hit,n,index,_=tree.ray_cast(p,direction,dist)
    if hit is None or not flags[index]:return None
    return np.array(hit), np.array(n)

def verify_patch(tree,flags,c,n,width):
    # All samples must land on a continuous opaque wall. Fragment-time plane clipping
    # additionally leaves holes intact between samples or on different geometry levels.
    right=unit(np.cross([0,1,0],n));up=unit(np.cross(n,right))
    for u in np.linspace(-.49,.49,7):
        for v in np.linspace(-.49,.49,7):
            p=c+right*u*width+up*v*width
            hit=surface_hit(tree,flags,p+n*.09,-n,.12)
            if hit is None or np.linalg.norm(hit[0]-p)>.026 or abs(np.dot(hit[1],n))<.96:return False
    return True

def reachable_eyes(tree,graph,site):
    near=[(p,cost) for p,cost in graph if np.linalg.norm((p-site)[[0,2]])<32 and abs(p[1]-site[1])<3.4]
    eyes=[]
    for p,cost in near:
        foot=ray(tree,p+[0,.55,0],[0,-1,0],1.4)
        if foot is None or abs(foot[1][1])<.65 or abs(foot[0][1]-p[1])>.38:continue
        if ray(tree,foot[0]+[0,.08,0],[0,1,0],1.60):continue
        eyes.append((foot[0]+[0,1.63,0],cost))
    return eyes

def best_view(tree,c,n,eyes,size,s,near=False,paint_depth=.032,height=None):
    right=unit(np.cross([0,1,0],n));up=unit(np.cross(n,right))
    choices=[]
    for eye,travel in eyes:
        diff=eye-c; dist=np.linalg.norm(diff)
        if not (2.6 if near else 6.2)<dist<23:continue
        face=np.dot(diff/dist,n)
        if face<.54 or abs(diff[1])/dist>(.68 if near else .35):continue
        if not near and np.linalg.norm((eye-s)[[0,2]]) < 4:continue
        score=2.9*face-.09*abs(dist-12)-.006*travel+.013*min(np.linalg.norm((eye-s)[[0,2]]),18)
        choices.append((score,eye,dist))
    for score,eye,dist in sorted(choices,key=lambda v:-v[0])[:35]:
        for u,v in ((u,v) for u in np.linspace(-.46,.46,7) for v in np.linspace(-.46,.46,7)):
            p=c+right*u*size+up*v*(height or size)+n*(paint_depth+.013)
            d=p-eye
            if ray(tree,eye,unit(d),np.linalg.norm(d)-.02):break
        else:return score,eye,dist
    return None

def original_places(refs,site):
    # Some old source draw batches cover several placements. Never use their aggregate box.
    accepted={'bombsite_letter_'+site.lower(),'bombsite_spray_'+site.lower(),'inferno_bombsite_signs_'+site.lower()+'_01'}
    return [r for r in refs if r['mat'] in accepted and r['site']==site and .8<r['span'][1]<3.5 and max(r['span'])<4.6]

def make(tree,flags,eyes,site,refs,label,map_id):
    course=[(p,cost) for p,cost in eyes if 1<np.linalg.norm((p-site)[[0,2]])<11 and abs(p[1]-site[1]-1.63)<1.9]
    # Decal centers and source normals are not sufficient on a decimated mesh. Probe the
    # rendered wall from a NAV eye; reject wrong-facing or unsupported footprints.
    trials=[]
    for record in original_places(refs,label):
        center=np.array(record['pos'])
        for eye,_ in eyes[::max(1,len(eyes)//100)]:
            d=unit(center-eye)
            hit=surface_hit(tree,flags,center-d*.45,d,.85)
            if hit is not None and np.linalg.norm(hit[0]-center)<.42:
                trials.append((hit[0],hit[1],eye,record['node']))
    seen=set()
    for eye,_ in course[::max(1,len(course)//30)]:
        origin=eye+[0,.64,0]
        for ang in np.arange(0,2*np.pi,2*np.pi/22):
            d=np.array([np.sin(ang),0,np.cos(ang)])
            hit=surface_hit(tree,flags,origin,d,13)
            if hit is not None:trials.append((hit[0],hit[1],eye,None))
    candidates=[]
    for c,n,near,src in trials:
        # Inferno's crate facade has a thin raised bar through its lower third.
        # The site marker belongs on uninterrupted masonry, away from that facade.
        if map_id=='de_inferno' and label=='A' and abs(c[0]-45.720)<.65 and abs(c[2]+10.25)<3.6:continue
        # The placed Mirage B spray spans the edge of the open doorway. Shift
        # its square backing into the solid wall so that the complete old ink is
        # covered without painting across the opening.
        if src and 'c245_s_mesh_overlay245.' in src:
            c=c+np.array([0.,0.,-.34])
        if abs(n[1])>.065 or not 1.4<c[1]-site[1]<4.2 or np.linalg.norm((c-site)[[0,2]])>16:continue
        if np.dot(near-c,n)<0:n=-n
        k=tuple(np.rint(np.r_[c*1.2,n*4]).astype(int))
        if k in seen:continue
        seen.add(k)
        # Projecting a centered square onto a seam or around a corner is rejected.
        for width in (1.92,1.56,1.24):
            if not verify_patch(tree,flags,c,n,width):continue
            view=best_view(tree,c,n,eyes,width,site)
            if view:
                score,eye,dist=view
                score+=width*1.15-.035*np.linalg.norm(c-site)+(12 if src else 0)
                candidates.append((score,c,n,width,eye,dist,src))
            break
    if not candidates:raise ValueError('No wall with visible NAV approach '+label)
    _,c,n,size,eye,dist,origin=max(candidates,key=lambda a:a[0])
    rnd=lambda x:np.round(np.asarray(x,dtype='f8'),5).tolist()
    return dict(center=rnd(c),normal=rnd(n),size=size,**({'sourceNode':origin} if origin else {})),dict(eye=rnd(eye),target=rnd(c),distance=round(dist,2))

def fit_placed_spray(tree,flags,letter,record,refs,eyes,site):
    # Anubis sprays cover several planes on the curved stone wall. Fit a mean
    # plane over the opaque backing and retain its measured sagitta for clipping.
    ref=next(r for r in refs if r['node']==record['sourceNode'])
    c=np.array(ref['pos'],dtype='f8')
    n=np.array(record['normal'],dtype='f8')
    right=unit(np.cross([0.,1.,0.],n))
    size={'A':2.78,'B':1.76}[letter]
    height={'A':2.60,'B':2.64}[letter]
    if letter=='B':c+=right*.10  # the adjacent jamb bounds the printable face
    for _ in range(2):
        right=unit(np.cross([0.,1.,0.],n));up=np.cross(n,right)
        points=[];normals=[]
        for u in np.linspace(-.485,.485,13):
            for v in np.linspace(-.485,.485,13):
                p=c+right*u*size+up*v*height
                sample=surface_hit(tree,flags,p+n*.22,-n,.40)
                if sample is None:raise ValueError('Hole in Anubis sign support')
                points.append(sample[0]); normals.append(sample[1])
        points=np.array(points)
        mid=points.mean(0)
        new=np.linalg.svd(points-mid,full_matrices=False)[2][-1]
        if np.dot(n,new)<0:new=-new
        c+=new*np.dot(mid-c,new); n=new
    depth=float(np.max(np.abs((points-c)@n)))+.012
    if depth>.112 or np.min(np.abs(np.array(normals)@n))<.958:raise ValueError('Excessive sign curvature')
    score=best_view(tree,c,n,eyes,size,site,paint_depth=depth,height=height)
    if score is None:raise ValueError('No full source spray view')
    _,eye,dist=score
    rnd=lambda x:np.round(np.asarray(x,dtype='f8'),5).tolist()
    return dict(center=rnd(c),normal=rnd(n),size=size,height=height,depth=round(depth,5),sourceNode=ref['node']),dict(eye=rnd(eye),target=rnd(c),distance=round(dist,2))

def old_wall(entry):
    import base64,struct
    t=np.array([[x,y,z] for x,y,z,*_ in struct.iter_unpack('<hhhBB',base64.b64decode(entry['vertices']))])/5000+entry['anchor']
    ix=np.frombuffer(base64.b64decode(entry['indices']),dtype='<u2').reshape(-1,3)
    a,b,c=t[ix[0]]
    return (t.max(0)+t.min(0))/2,unit(np.cross(b-a,c-a)),max(np.ptp(t,axis=0))

def main():
    parser=argparse.ArgumentParser()
    for name in ('pool','library','extra','output','cameras'):parser.add_argument(name,type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    data={};views={}
    old=json.loads((Path(__file__).resolve().parents[2]/'client/flat-site-markings-data.json').read_bytes())
    for m in sorted(args.pool.glob('de_*')):
        map_id=m.name; mp=json.loads((m/'compiled/map.json').read_bytes())
        graph=graph_reach(json.loads((m/'compiled/nav.json').read_bytes()),np.array([mp['spawns']['T'][0][k] for k in 'xyz']))
        tree,opaque=render_tree(m)
        refs=placed_markings(source_file(args.library,args.extra,map_id,mp['sourceSha256']),map_id,mp['sites']) if map_id in ('de_mirage','de_anubis','de_inferno') else []
        data[map_id]={'source':mp['sourceSha256']};views[map_id]={}
        for letter in 'AB':
            s=np.array([mp['sites'][letter][k] for k in 'xyz'])
            eyes=reachable_eyes(tree,graph,s)
            if old[map_id][letter]['wall']:
                c,n,width=old_wall(old[map_id][letter]); view=best_view(tree,c,n,eyes,width,s)
                if not view:view=best_view(tree,c,n,eyes,width*.78,s,near=True)
                if not view and map_id=='de_vertigo':
                    # Existing Vertigo plaques sit above a narrow platform and angled cargo.
                    # Use the nearest standing NAV centre to the known front approach and
                    # test the printed surface itself; a hypothetical full square here
                    # extends past the corners of the physical placed plaque.
                    approach={'A':[-14.22718,300.73046,16.23854],'B':[-64.14770,299.91766,-4.23545]}[letter]
                    eye=min(eyes,key=lambda row:np.linalg.norm(row[0]-approach))[0]
                    distance=np.linalg.norm(eye-c)
                    if np.linalg.norm(eye-approach)<.26 and np.dot(eye-c,n)>0 and not ray(tree,eye,unit(c-eye),distance-.12):
                        view=(1.,eye,distance)
                if not view:raise ValueError('No source sign approach: '+map_id+letter)
                _,eye,dist=view
                views[map_id][letter]=dict(eye=eye.round(5).tolist(),target=c.round(5).tolist(),distance=round(dist,2))
            else:
                sign,camera=make(tree,opaque,eyes,s,refs,letter,map_id)
                if map_id=='de_anubis':sign,camera=fit_placed_spray(tree,opaque,letter,sign,refs,eyes,s)
                data[map_id][letter]=sign;views[map_id][letter]=camera
            print(map_id,letter,views[map_id][letter],flush=True)
    for path,output in ((args.output,data),(args.cameras,views)):
        temporary=path.with_suffix('.part')
        temporary.write_text(json.dumps(output,indent=2)+'\n','utf8')
        temporary.replace(path)
if __name__=='__main__':main()

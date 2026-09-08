"""Convert Awpy 2000905 Dust II geometry + Valve NAV 36 into web data.
NAV layout reference: ValveResourceFormat/NavMesh (MIT), upstream repository.
The exported map data are Valve game assets, not covered by this script's code.
"""
import io, json, pathlib, struct, math
import numpy as np

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/map'
SCALE=.0254
def point(v): return [round(float(v[0])*SCALE,4),round(float(v[2])*SCALE,4),round(-float(v[1])*SCALE,4)]
def obj(v): return dict(zip(('x','y','z'),point(v)))

data=(OUT/'de_dust2.mesh').read_bytes()
magic,version,nv,nt=struct.unpack_from('<4sIII',data)
assert magic==b'AWMH' and version==1
vertices=np.frombuffer(data,dtype='<f4',offset=16,count=nv*3).reshape(-1,3)
indices=np.frombuffer(data,dtype='<u4',offset=16+nv*12,count=nt*3).reshape(-1,3)
world=vertices[:,[0,2,1]].astype(np.float64)*SCALE
world[:,2]*=-1
triangles=world[indices]
norm=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
valid=np.linalg.norm(norm,axis=1)>.00001
triangles=triangles[valid]
positions=np.round(triangles,4).reshape(-1).tolist()
(OUT/'collision.json').write_text(json.dumps({'positions':positions},separators=(',',':')))
np.array(positions,dtype='<f4').tofile(OUT/'positions.f32')
centers=triangles.mean(axis=1)
norm=norm[valid]; normals=norm/np.linalg.norm(norm,axis=1)[:,None]
materials=np.ones(len(triangles),dtype=np.uint8)
materials[(centers[:,0]<-22)&(centers[:,2]<-9)]=2
materials[normals[:,1]>.68]=0
materials[normals[:,1]<-.65]=5
# Connected collision islands give cars and detached crates/doors their own
# procedural finish without moving, adding, or hiding collidable surfaces.
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
edgea=np.concatenate([indices[:,0],indices[:,1],indices[:,2]])
edgeb=np.concatenate([indices[:,1],indices[:,2],indices[:,0]])
count,labels=connected_components(coo_matrix((np.ones(len(edgea)),(edgea,edgeb)),shape=(nv,nv)),directed=False)
islands=labels[indices[:,0]][valid]
for c in range(count):
    verts=world[labels==c]
    extent=np.ptp(verts,axis=0)
    if len(verts)>8 and .55<extent[1]<3.9 and max(extent[0],extent[2])<6 and min(extent[0],extent[2])>.15:
        materials[islands==c]=3
        if len(verts)>85 and 1<extent[1]<2 and min(extent[0],extent[2])>2.2 and max(extent[0],extent[2])>4:
            materials[islands==c]=4
materials.tofile(OUT/'materials.u8')

raw=(OUT/'de_dust2.nav').read_bytes()
f=io.BytesIO(raw)
def read(fmt): return struct.unpack('<'+fmt,f.read(struct.calcsize('<'+fmt)))
def u(): return read('I')[0]
def skip_kv3():
    f.seek((f.tell()+7)&~7)
    start=f.tell(); header=f.read(120)
    assert header[:4]==b'\x053VK',header[:4]
    compression=struct.unpack_from('<I',header,20)[0]
    uncomp,comp,blocks,blobbytes=struct.unpack_from('<4I',header,48)
    assert compression==0 and blocks==0,(compression,blocks)
    f.seek(start+120+uncomp+blobbytes)
magic,nav_version,sub,flags=read('4I')
assert magic==0xFEEDFACE and nav_version==36
skip_kv3()
corners=[read('3f') for _ in range(u())]
polygons=[]
for _ in range(u()):
    count=read('B')[0]; polygons.append([corners[u()] for _ in range(count)]); u()
u() # v32 unknown
movable=u(); assert movable==0
skip_kv3()
areas=[]
for _ in range(u()):
    area_id=u(); attributes=read('q')[0]; hull=read('B')[0]; poly=polygons[u()]
    read('f'); neighbors=[]
    for _edge in poly:
        for _ in range(u()):
            neighbor=u(); u(); neighbors.append(neighbor)
    f.read(5)
    f.read(u()*4); f.read(u()*4)
    center=np.array(poly).mean(axis=0)
    areas.append({'id':area_id,**obj(center),'neighbors':sorted(set(neighbors)),'hull':hull,'corners':[point(v) for v in poly]})
print('nav hulls', {h:sum(a['hull']==h for a in areas) for h in set(a['hull'] for a in areas)},flush=True)
(OUT/'nav-areas.json').write_text(json.dumps(areas,separators=(',',':')))
def polyarea(a):
    q=a['corners']; return abs(sum(q[i][0]*q[(i+1)%len(q)][2]-q[(i+1)%len(q)][0]*q[i][2] for i in range(len(q))))/2
def spawnpoints(target, predicate, yaw):
    candidates=sorted([a for a in areas if predicate(a) and polyarea(a)>2.5],key=lambda a:(a['x']-target[0])**2+(a['z']-target[1])**2)
    selected=[]
    for a in candidates:
        if all((a['x']-p['x'])**2+(a['z']-p['z'])**2>1.8**2 for p in selected):
            selected.append({'x':a['x'],'y':round(a['y']+.3,4),'z':a['z'],'yaw':yaw,'navId':a['id']})
        if len(selected)==8: break
    return selected
points=np.array([[a['x'],a['y'],a['z']] for a in areas]); lo=points.min(axis=0); hi=points.max(axis=0)
mapdata={
    'name':'Dust II','id':'de_dust2','version':'CS2 2000905','sourceBuild':'25175329','metersPerSourceUnit':SCALE,
    'bounds':{'min':dict(zip(('x','y','z'),lo.tolist())),'max':dict(zip(('x','y','z'),hi.tolist())),'minX':float(lo[0]),'maxX':float(hi[0]),'minY':float(lo[1]),'maxY':float(hi[1]),'minZ':float(lo[2]),'maxZ':float(hi[2])},
    'spawns':{'T':spawnpoints((-18,22),lambda a:a['z']>17 and a['y']>2,-math.pi/2),'CT':spawnpoints((8,-58),lambda a:-66<a['z']<-51 and a['y']<-2,math.pi)},
    'sites':{'A':{'x':30.0736,'y':2.54,'z':-66.694,'radius':6.1},'B':{'x':-39.7383,'y':.2032,'z':-67.3735,'radius':6.3}},
    'overview':{'pos_x':-2476,'pos_y':3239,'scale':4.4,'size':1024,'image':'/assets/valve-dust2/de_dust2_radar_psd.png'},
    'nav':[{k:a[k] for k in ('id','x','y','z','neighbors')} for a in areas],
    'labels':[{'text':'T SPAWN','x':-18,'z':22},{'text':'CT SPAWN','x':8,'z':-58},{'text':'A','x':30,'z':-67},{'text':'B','x':-40,'z':-67},{'text':'MID','x':-11,'z':-31},{'text':'LONG A','x':40,'z':-31},{'text':'TUNNELS','x':-43,'z':-27},{'text':'CATWALK','x':4,'z':-37}],
    'geometryUrl':'/assets/map/positions.f32','collisionUrl':'/assets/map/collision.json',
    'geometryInfo':{'sourceVertices':nv,'triangles':len(triangles),'origin':'Awpy collision/visibility geometry with custom PBR materials','note':'Approximate decimated geometry. Original rendering textures and game player/grenade clips are not included.'}
}
(ROOT/'shared/map-data.js').write_text('// Generated by scripts/map-build.py from version-pinned Valve map data.\nexport const MAP = '+json.dumps(mapdata,separators=(',',':'))+';\n',encoding='utf8')
print('spawns',mapdata['spawns'],flush=True)
print(json.dumps({'vertices':nv,'sourceTriangles':nt,'triangles':len(triangles),'navAreas':len(areas),'bounds':{'min':world.min(axis=0).tolist(),'max':world.max(axis=0).tolist()},'navBounds':{'min':np.array([[a['x'],a['y'],a['z']] for a in areas]).min(axis=0).tolist(),'max':np.array([[a['x'],a['y'],a['z']] for a in areas]).max(axis=0).tolist()}}),flush=True)

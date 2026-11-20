"""Build textureless match packages from archived CS2 collision/NAV or Awpy meshes."""
import argparse
import hashlib
import importlib.util
import json
import math
import pathlib
import shutil
import struct
import subprocess
import zipfile
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
repo = HERE.parents[1]
spec = importlib.util.spec_from_file_location('source', HERE / 'compile-source.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
sha = source.digest
write = source.write_json
read = lambda p: json.loads(p.read_text(encoding='utf8'))
EXTRA = {'de_train': ('Train', '列车停放站'), 'de_vertigo': ('Vertigo', '殒命大厦')}
# Approximate anchors on the 1024px Awpy radar, snapped to source NAV polygons.
ANCHORS = {'de_train': {'A': (625,459), 'B': (536,822), 'T': (125,178), 'CT': (919,556)},
           'de_vertigo': {'A': (757,602), 'B': (281,244), 'T': (330,730), 'CT': (561,209)}}


def select_anchors(key, nav, radar):
    groups = {}
    for label,(u,v) in ANCHORS[key].items():
        tx = (radar['pos_x'] + radar['scale']*u)*.0254
        tz = (radar['scale']*v - radar['pos_y'])*.0254
        near = sorted((p for p in nav if p['hull']==0 and p['neighbors']),
                      key=lambda p: math.hypot(p['x']-tx,p['z']-tz))
        if key=='de_train' and label=='B':
            # Choose the platform beside the B train, below the train roof.
            near=[p for p in near if -7.7<p['y']<-6.1]
        if key=='de_vertigo':
            threshold = float(radar['verticalsections']['default']['AltitudeMin'])*.0254
            level = [p for p in near if (p['y'] >= threshold) == (label != 'T')]
            if level: near = level
        if label in ('T','CT'):
            group=[]
            for n in near:
                if all(math.hypot(p['x']-n['x'],p['z']-n['z'])>1.25 for p in group):
                    group.append({k:n[k] for k in ('x','y','z')} | {'yaw':0,'priority':0})
                if len(group)==8: break
            groups[label]=group
        else:
            p=near[0]
            groups[label]={k:p[k] for k in ('x','y','z')} | {'navId':p['id'],'radius':3.8,
                    'bounds':{'min':[p['x']-3.8,p['y']-1,p['z']-3.8],
                              'max':[p['x']+3.8,p['y']+2.5,p['z']+3.8]}}
    return groups


def compile_extra(key, directory, cloud, geo_zip):
    manifest=read(cloud/'manifest.json')
    nav_path=cloud/'navs'/(key+'.nav')
    with zipfile.ZipFile(cloud/'navs.zip') as archive:
        member=next(x for x in archive.namelist() if pathlib.PurePosixPath(x).name==key+'.nav')
        assert archive.read(member)==nav_path.read_bytes()
    with zipfile.ZipFile(geo_zip) as archive:
        member=next(x for x in archive.namelist() if pathlib.PurePosixPath(x).name==key+'.mesh')
        data=archive.read(member)
    magic,ver,nv,nt=struct.unpack_from('<4sIII',data)
    assert magic==b'AWMH' and ver==1 and len(data)==16+nv*12+nt*12
    vertices=np.frombuffer(data,'<f4',nv*3,16).reshape(-1,3)[:,[0,2,1]] * .0254
    vertices[:,2]*=-1
    faces=np.frombuffer(data,'<u4',nt*3,16+nv*12).reshape(-1,3)
    triangles=vertices[faces]
    normal=np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0])
    triangles=triangles[np.linalg.norm(normal,axis=1)>1e-8]
    compiled=directory/'compiled'
    triangles.astype('<f4').tofile(compiled/'physics.f32')
    np.full(len(triangles),7,dtype='u1').tofile(compiled/'physics-mask.u8')
    write(compiled/'physics-groups.json',[{'name':'awpy-world','firstTriangle':0,'triangles':len(triangles),'mask':7}])
    nav=source.nav_areas(nav_path)
    anchors=select_anchors(key,nav,read(cloud/'map_data.json')[key])
    identity=hashlib.sha256(data+nav_path.read_bytes()).hexdigest()
    coords=np.asarray([[p[k] for k in ('x','y','z')] for p in nav if p['hull']==0])
    name,zh=EXTRA[key]
    meta={'schemaVersion':1,'id':key,'name':name,'nameZh':zh,'sourceBuild':manifest['buildid'],
          'sourceSha256':identity,'public':False,'bounds':{'min':source.named(coords.min(0)),'max':source.named(coords.max(0))},
          'spawns':{team:anchors[team] for team in ['CT','T']},'sites':{site:anchors[site] for site in 'AB'},
          'geometrySource':'Awpy release 2000922 visibility mesh with all channels shared. Spawn and site volumes are NAV approximations.',
          'physics':{'triangles':len(triangles),'maskBits':{'player':1,'bullet':2,'grenade':4}}}
    write(compiled/'map.json',meta);write(compiled/'nav.json',nav)
    write(directory/'entity-collision-policy.json',{'schemaVersion':1,'map':key,'sourceSha256':identity,
          'physicsSha256':sha(compiled/'physics.f32'),'maskSha256':sha(compiled/'physics-mask.u8'),
          'groupsSha256':sha(compiled/'physics-groups.json'),'excludedGroups':[],'excludedTriangles':0})


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--library',type=pathlib.Path,required=True);p.add_argument('--cloud',type=pathlib.Path,required=True)
    p.add_argument('--geometry',type=pathlib.Path);p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('ids',nargs='*')
    p.add_argument('--visual-source', action='append', default=[], metavar='MAP=PATH',
                   help='Use a separately exported visible CS2 world GLTF; collision and navigation remain bound to the compiled package.')
    p.add_argument('--extra-library',type=pathlib.Path,
                   help='Directory of additional official CS2 map exports with compiled/map.json and navigation-audit.json.')
    args=p.parse_args(); overrides={}
    for value in args.visual_source:
        key,separator,source_path=value.partition('=')
        if not separator or not pathlib.Path(source_path).is_file():p.error('Invalid --visual-source '+value)
        overrides[key]=pathlib.Path(source_path)
    args.out.mkdir(parents=True,exist_ok=True)
    extra_library=args.extra_library or args.out.parent/'source-extra'
    reports={r['id']:r for r in read(args.library/'exports.json')}; radar=read(args.cloud/'map_data.json')
    maps=list(dict.fromkeys([*reports,*EXTRA]));rd=args.out/'radars';rd.mkdir(exist_ok=True)
    write(rd/'transforms.json',{key:radar[key] for key in maps})
    exports=[]
    for key in maps:
        directory=args.out/key; cp=directory/'compiled';cp.mkdir(parents=True,exist_ok=True)
        if not args.ids or key in args.ids:
            extra=extra_library/key
            official_extra=key in EXTRA and (extra/'compiled/map.json').is_file() and (extra/'navigation-audit.json').is_file()
            if key in reports or official_extra:
                orig=pathlib.Path(reports[key]['directory']) if key in reports else extra
                assert read(orig/'compiled/map.json')['id']==key
                for name in ['map.json','nav.json','physics.f32','physics-mask.u8','physics-groups.json']:
                    shutil.copyfile(orig/'compiled'/name,cp/name)
                shutil.copyfile(orig/'entity-collision-policy.json',directory/'entity-collision-policy.json')
                if read(orig/'navigation-audit.json').get('schemaVersion')==2:shutil.copyfile(orig/'navigation-audit.json',directory/'navigation-audit.json')
            else:
                assert args.geometry and sha(args.geometry)==read(args.cloud/'manifest.json')['artifacts']['geometry.zip']['sha256']
                assert sha(args.cloud/'navs.zip')==read(args.cloud/'manifest.json')['artifacts']['navs.zip']['sha256']
                compile_extra(key,directory,args.cloud,args.geometry)
            visible=overrides.get(key)
            if visible is None and (key in reports or official_extra):
                visible=next((orig/rel for rel in ('key-colors/map.gltf','named/map.gltf','raw/map.gltf','standalone/map.gltf') if (orig/rel).is_file()),None)
                if visible is None: raise FileNotFoundError(f'No visible glTF in {orig}')
            if visible is not None:
                # Bake the visible art from the original world model, independently of physical collision.
                subprocess.run([sys.executable,str(HERE/'build-visible-lowpoly.py'),
                              '--source',str(visible),'--map',key,'--output',str(directory)],check=True)
            else:
                subprocess.run([sys.executable,str(HERE/'industrial-lowpoly.py'),str(directory),str(directory/'render')],check=True)
            subprocess.run(['node',str(HERE/'bake-performance-lighting.mjs'),str(directory)],check=True)
            size=sum(f.stat().st_size for f in (directory/'render').glob('map.*') if f.suffix in ('.gltf','.bin'))
            shutil.copyfile(args.cloud/'images/radars'/(key+'.png'),rd/(key+'.png'))
            print(f'{key} {size:,} render bytes, zero textures',flush=True)
        if (cp/'map.json').exists():exports.append({'id':key,'directory':str(directory.resolve()),'sourceSha256':read(cp/'map.json')['sourceSha256']})
    write(args.out/'exports.json',exports)
if __name__=='__main__':main()

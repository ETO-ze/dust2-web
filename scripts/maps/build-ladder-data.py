"""Export Valve NAV ladder endpoints and the climbable side of their physics faces."""
import argparse
import json
from pathlib import Path
import runpy

import numpy as np

ROOT=Path(__file__).resolve().parents[2]
source=runpy.run_path(str(ROOT/'scripts/maps/compile-source.py'))

def build(directory):
    dataPath=directory/'compiled'
    info=json.loads((dataPath/'map.json').read_bytes())
    ladders=[]
    areas={a['id']:a for a in source['nav_areas'](directory/'source/map.nav',ladders=ladders)}
    groups=json.loads((dataPath/'physics-groups.json').read_bytes())
    geometry=np.memmap(dataPath/'physics.f32','<f4',mode='r').reshape(-1,3,3)
    surfaces=[]
    for group in groups:
        if 'ladder' not in group.get('extras',{}).get('InteractAs',[]): continue
        offset=group['firstTriangle']
        for t in geometry[offset:offset+group['triangles']]:
            normal=np.cross(t[1]-t[0],t[2]-t[0]).astype(float)
            normal/=np.linalg.norm(normal)
            if abs(normal[1])<.3: surfaces.append((t.mean(axis=0),normal))
    for rail in ladders:
        top=np.array(rail['top']);bottom=np.array(rail['bottom'])
        center=(top+bottom)/2
        face,normal=min(surfaces,key=lambda s:np.linalg.norm(s[0]-center))
        # NAV endpoints can use the deck height rather than the protruding rail tip.
        # Positions stay on the tagged face at each height, including leaning ladders.
        horizontal=normal[[0,2]]
        horizontal/=np.linalg.norm(horizontal)
        for p in (bottom,top):
            p[[0,2]]-=horizontal*np.dot(p-face,normal)/np.linalg.norm(normal[[0,2]])
        rail['bottom']=[round(float(v),5) for v in bottom];rail['top']=[round(float(v),5) for v in top]
        rail['normal']=[round(float(v),6) for v in horizontal]
        rail['width']=round(rail['width'],5)
        rail['exits']=[]
        for key in rail.pop('up'):
            area=areas[key]
            rail['exits'].append([round(area[k],4) for k in ('x','y','z')])
        rail.pop('down')
    return info['id'],{'source':info['sourceSha256'],'ladders':ladders}

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--library',type=Path,required=True)
    p.add_argument('--extra',type=Path,default=ROOT/'artifacts/performance-maps/source-extra')
    p.add_argument('--out',type=Path,default=ROOT/'shared/private-map-ladders-data.js')
    a=p.parse_args()
    roots=[Path(row['directory']) for row in json.loads((a.library/'exports.json').read_bytes())]
    roots.extend(p for p in a.extra.glob('de_*') if (p/'compiled/map.json').is_file())
    maps=dict(build(root) for root in roots)
    a.out.write_text('// Generated from the original Source 2 NAVs and tagged collision planes.\nexport const SOURCE_LADDERS = '+
                     json.dumps(maps,indent=1,ensure_ascii=False)+';\n',encoding='utf8')
    print({key:len(value['ladders']) for key,value in maps.items()})

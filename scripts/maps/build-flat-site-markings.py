"""Clip original site stencils to supported opaque floor geometry in a sealed map pool."""
from argparse import ArgumentParser
import json
import struct
import base64
from pathlib import Path

import numpy as np


from site_marking_source import attribute, paint_ranges, placed_markings, source_file


def visible_triangles(folder):
    doc = json.loads((folder/'render/map.gltf').read_bytes())
    data = (folder/'render/map.bin').read_bytes()
    for node in doc['nodes']:
        if not node.get('name','').startswith('tile_'):
            continue  # interactive props and fences cannot act as permanent stencil supports
        for p in doc['meshes'][node['mesh']]['primitives']:
            if p.get('mode',4) != 4: continue
            if doc['materials'][p['material']].get('alphaMode','OPAQUE') != 'OPAQUE': continue
            xyz = attribute(doc, data, p['attributes']['POSITION'])
            xyz = xyz * node.get('scale',[1,1,1]) + node.get('translation',[0,0,0])
            xyz = np.stack([xyz[:,2],xyz[:,1],-xyz[:,0]],axis=1)
            yield xyz[attribute(doc,data,p['indices']).reshape(-1,3)]


def crop(tris, pos, reach, down, up):
    low = pos - [reach,down,reach]
    high = pos + [reach,up,reach]
    return tris[np.all(tris.min(1) <= high, axis=1) & np.all(tris.max(1) >= low, axis=1)]


class VerticalRays:
    def __init__(self,tris):
        self.tris = tris
        a, b, c = tris.transpose(1,0,2)
        self.a = a
        self.u = b-a
        self.v = c-a
        self.det = self.u[:,0]*self.v[:,2] - self.v[:,0]*self.u[:,2]

    def hits(self,x,z,ceil,base):
        dx=x-self.a[:,0]; dz=z-self.a[:,2]
        with np.errstate(divide='ignore',invalid='ignore'):
            u=(dx*self.v[:,2] - dz*self.v[:,0])/self.det
            v=(dz*self.u[:,0] - dx*self.u[:,2])/self.det
            y=self.a[:,1]+u*self.u[:,1]+v*self.v[:,1]
            sel=(abs(self.det)>1e-8)&(u>=-1e-6)&(v>=-1e-6)&(u+v<=1.000001)&(y<=ceil)&(y>=base)
        ix=np.flatnonzero(sel)
        return (int(ix[y[ix].argmax()]),float(y[ix].max())) if len(ix) else (None,None)


def in_zone(p,hulls):
    # Foot position lies strictly inside the horizontal trigger footprint. The
    # player's body can overlap short triggers above the support under their feet.
    for by,ax in hulls:
        center = ax @ (p+[0,.55,0])
        r = abs(ax[:,1])*.55
        if np.all(center+r >= by[:,0]+.001) and np.all(center-r <= by[:,1]-.001):
            return True
    return False


def clipped(tri,cx,cz,side,angles):
    # UVs follow the heading toward the bombsite from attackers' spawn.
    c,s=angles
    def vertex(p):
        x,y,z=p;dx=x-cx;dz=z-cz
        return np.array([x,y,z, .5+(dx*c-dz*s)/side, .5+(-dx*s-dz*c)/side])
    poly=[vertex(p) for p in tri]
    for at,sign,limit in [(3,1,0),(3,-1,1),(4,1,0),(4,-1,1)]:
        out=[]
        for a,b in zip(poly,poly[1:]+poly[:1]):
            av=(a[at]-limit)*sign; bv=(b[at]-limit)*sign
            if av>=0: out.append(a)
            if (av>=0)!=(bv>=0): out.append(a + (b-a)*(av/(av-bv)))
        poly=out
        if not poly: break
    return [np.array([poly[0],poly[i],poly[i+1]]) for i in range(1,len(poly)-1)]


def make_site(site,mp,world,tris,physical,refs):
    anchor=mp['sites'][site]
    pos=np.array([anchor[k] for k in ('x','y','z')])
    box=anchor['bounds']; center=(np.array(box['max'])+box['min'])/2
    hulls=[(np.array(h)[:,3:],np.array(h)[:,:3]) for h in world['sites'][site]['hulls']]
    nearby=crop(tris,center,14,max(4,center[1]-pos[1]+4),4)
    draw=VerticalRays(nearby)
    clip=VerticalRays(crop(physical,center,14,max(4,center[1]-pos[1]+4),4))
    # Prioritize the first-party site floor markings; an existing readable glyph
    # is a better placement guide than the centre of an irregular trigger.
    if mp['id']=='de_vertigo':
        node='c61_s_mesh_overlay61.' if site=='A' else 'c23_s_mesh_overlay23.'
        ref=next(r for r in refs if node in r['node'])
        assert 'bombsite_letter_'+site.lower() in ref['mat']
        assert abs(ref['pos'][1]-pos[1])<4
        return ref['sourceSurface'],dict(anchor=ref['pos'],sourceFloor=None,wall=ref['node'],triangles=len(ref['sourceSurface'])//3)
    if mp['id']=='de_nuke':
        # The confirmed reactor chamber plaques use a split B/A atlas, on distinct floors.
        node='c60_s_mesh_overlay60.' if site=='B' else 'c66_s_mesh_overlay66.'
        ref=next(r for r in refs if node in r['node'])
        assert ref['mat']=='hr_bombsite_sign_decal_001' and ref['uvRange'][0][0]==(0 if site=='B' else .5)
        assert abs(ref['pos'][1]-pos[1])<2.2
        return ref['sourceSurface'],dict(anchor=ref['pos'],sourceFloor=None,wall=ref['node'],triangles=len(ref['sourceSurface'])//3)
    marks=[r for r in refs if r['site']==site and r['span'][1]<.40 and max(r['span'][0],r['span'][2])>1.]
    marks.sort(key=lambda r: (0 if r['mat'] in ('bombsite_a','bombsite_b') else 1 if 'x_spray' in r['mat'] else 2,r['dist']))
    target=np.array(marks[0]['pos']) if marks else pos
    # Axis-aligned projection keeps each stencil square on the original world grid.
    yaw=np.array([mp['spawns']['T'][0][k] for k in ('x','z')])-target[[0,2]]
    angle=np.pi/2 * round(np.arctan2(yaw[0],yaw[1]) / (np.pi/2))
    # The spawn bearing can point through a tower or box. These five bearings
    # follow the standing NAV approach from the aisle around that obstruction.
    approach_degrees = {
        ('de_mirage', 'A'): 90, ('de_anubis', 'B'): 90, ('de_cache', 'A'): 180,
        ('de_train', 'A'): 135, ('de_train', 'B'): 45,
    }
    if (mp['id'], site) in approach_degrees:
        angle = np.deg2rad(approach_degrees[mp['id'], site])
    angles=np.cos(angle),np.sin(angle)
    candidates=sorted(((dx,dz) for dx in np.arange(-5,5.01,.45) for dz in np.arange(-5,5.01,.45)),key=lambda off:np.hypot(*off))
    for side in (2.1,1.75,1.4,1.15):
        for dx,dz in [(0,0)]+candidates:
            x,z=target[[0,2]]+[dx,dz]
            if abs(x-pos[0])+abs(z-pos[2])>18:continue
            _,support=clip.hits(x,z,target[1]+.48,target[1]-1.35)
            if support is None:continue
            # Check corners and interior against both the rendered floor and the
            # player's standing surface. Any foreground object rejects the patch.
            sat=True; ys=[]
            for u in np.linspace(-.5,.5,5):
                for v in np.linspace(-.5,.5,5):
                    cosine,sine=angles
                    px=x+side*(u*cosine-v*sine); pz=z+side*(-u*sine-v*cosine)
                    if not in_zone(np.array([px,support,pz]),hulls):sat=False;break
                    _,y=draw.hits(px,pz,support+1.68,support-.15)
                    if y is None or abs(y-support)>.090:sat=False;break
                    _,fy=clip.hits(px,pz,support+1.68,support-.15)
                    if fy is None or abs(y-fy)>.065:sat=False;break
                    if not in_zone(np.array([px,fy,pz]),hulls):sat=False;break
                    ys.append(y)
                if not sat:break
            if not sat or max(ys)-min(ys)>.060:continue
            sample=crop(nearby,np.array([x,support,z]),side*.51*sum(abs(t) for t in angles),.13,.13)
            pieces=[]
            for tri in sample:
                normal=np.cross(tri[1]-tri[0],tri[2]-tri[0])
                if abs(normal[1])<np.linalg.norm(normal)*.98 or abs(normal[1])<1e-8:continue
                for t in clipped(tri,x,z,side,angles):
                    n=np.cross(t[1,:3]-t[0,:3],t[2,:3]-t[0,:3])
                    if abs(n[1])<.00001 or t[:,1].max()>max(ys)+.015 or t[:,1].min()<min(ys)-.015:continue
                    # Prefer the highest actual opaque render surface at each face,
                    # preventing duplication on layered coplanar marking geometry.
                    mid=t[:,:3].mean(0)
                    _,y=draw.hits(mid[0],mid[2],support+1.68,support-.25)
                    if y is None or abs(y-mid[1])>.007:continue
                    pieces.append(t if n[1]>0 else t[[0,2,1]])
            area=sum(abs(np.cross(t[1,:3]-t[0,:3],t[2,:3]-t[0,:3])[1])/2 for t in pieces)
            if not side*side*.96<=area<=side*side*1.045:continue
            if not all(in_zone(v[:3],hulls) for t in pieces for v in t):continue
            # Compact interleaved XYZ / UV. Triangles already conform to the actual render mesh.
            data=np.concatenate(pieces).round(5).tolist()
            evidence=dict(anchor=[round(float(a),3) for a in (x,support,z)],side=side,heading=round(float(np.rad2deg(angle))),coverage=round(area/(side*side),4),triangles=len(pieces),sourceFloor=marks[0]['mat'] if marks else None)
            return data,evidence
    raise ValueError('No verified opaque walkable floor for '+mp['id']+' '+site)


def pack(vertices,meta):
    # Quantized world offsets have a step of 0.2 mm. The figures lie in one small
    # patch, so a unique position/UV table is enough even for a triangulated floor.
    coord=np.array(meta['anchor'])
    unique={}; index=[];binary=bytearray()
    for v in np.array(vertices):
        key=tuple(np.rint((v[:3]-coord)*5000).astype(int))+tuple(np.clip(np.rint(v[3:]*255),0,255).astype(int))
        if key not in unique:
            unique[key]=len(unique);binary.extend(struct.pack('<hhhBB',*key))
        index.append(unique[key])
    encoded=lambda b:base64.b64encode(b).decode('ascii')
    return dict(anchor=coord.tolist(),wall=bool(meta.get('wall')),vertices=encoded(binary),indices=encoded(np.array(index,dtype='<u2').tobytes()))


def fit_sign_to_wall(vertices, anchor, triangles):
    """Project the placed plaque to the corresponding simplified opaque wall."""
    values = np.array(vertices)
    mesh = values.reshape(-1, 3, 5)[:, :, :3]
    a, b, c = mesh[0]
    normal = np.cross(b - a, c - a)
    normal /= np.linalg.norm(normal)
    horizontal = np.cross(normal, [0, 1, 0])
    horizontal /= np.linalg.norm(horizontal)
    axes = np.array([horizontal, normal, np.cross(horizontal, normal)])
    center = np.array(anchor)
    support = crop(triangles, center, 2.5, 2.5, 2.5)
    rays = VerticalRays((support - center) @ axes.T)
    points, offsets = [], []
    for tri in mesh:
        for weights in ([.33, .34, .33], [.2, .2, .6], [.4, .5, .1]):
            point = (weights @ tri - center) @ axes.T
            _, hit = rays.hits(point[0], point[2], point[1] + .06, point[1] - .50)
            if hit is not None:
                points.append([1, point[0], point[2]])
                offsets.append(hit - point[1])
    if len(points) < 3 or np.linalg.matrix_rank(points) < 3:
        raise ValueError(f'No render backing surface for wall sign at {anchor}')
    plane = np.linalg.lstsq(points, offsets, rcond=None)[0]
    plane[0] += max(np.array(offsets) - np.array(points) @ plane) + .002
    for row in values:
        point = (row[:3] - center) @ axes.T
        row[:3] += (normal * (np.array([1, point[0], point[2]]) @ plane)).round(6)
    return values


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('maps', type=Path, help='Sealed pool with catalog and render manifests')
    parser.add_argument('library', type=Path, help='Source archives grouped by map/source SHA')
    parser.add_argument('extra', type=Path, help='Supplemental sources for Train and Vertigo')
    parser.add_argument('out', type=Path, help='Client geometry JSON')
    parser.add_argument('proof', type=Path, help='Review report with all eighteen anchors')
    args = parser.parse_args()
    zones_js = Path(__file__).resolve().parents[2] / 'shared/bomb-zones-data.js'
    world = json.loads(zones_js.read_text('utf8').split('export const BOMB_ZONES = ', 1)[1].strip().rstrip(';'))
    entries, evidence = {}, {}
    for item in json.loads((args.maps / 'catalog.json').read_bytes())['maps']:
        mid = item['id']
        folder = args.maps / mid
        mp = json.loads((folder / 'compiled/map.json').read_bytes())
        digest = mp['sourceSha256']
        if digest != world[mid]['source']:
            raise ValueError(f'{mid}: trigger data and compiled geometry revisions differ')
        source = source_file(args.library, args.extra, mid, digest)
        refs = placed_markings(source, mid, mp['sites'])
        physical = np.fromfile(folder / 'compiled/physics.f32', dtype='<f4').reshape(-1, 3, 3)
        physical = physical[(np.fromfile(folder / 'compiled/physics-mask.u8', dtype='u1') & 1) > 0]
        triangles = np.concatenate(list(visible_triangles(folder)))
        entries[mid] = {'source': digest}
        evidence[mid] = {}
        for site in ('A', 'B'):
            vertices, details = make_site(site, mp, world[mid], triangles, physical, refs)
            evidence[mid][site] = details
            if details.get('wall'):
                vertices = fit_sign_to_wall(vertices, details['anchor'], triangles)
            entries[mid][site] = pack(vertices, details)
        if mid in ('de_dust2', 'de_mirage', 'de_cache'):
            ranges = paint_ranges(folder, refs)
            files = json.loads((folder / 'render-manifest.json').read_bytes())['files']
            hashes = {f['path']: f['sha256'] for f in files}
            entries[mid]['replace'] = dict(render=hashes['map.gltf'], geometry=hashes['map.bin'], ranges=ranges)
        print(mid, evidence[mid], flush=True)
    args.out.write_text(json.dumps(entries, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    args.proof.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()

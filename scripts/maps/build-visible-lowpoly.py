"""Sample source glTF albedo offline and feed actual visible meshes to meshoptimizer."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess
from urllib.parse import unquote

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
SIDE = 32

def thumbnail(source, image):
    uri = unquote(image.get('uri', ''))
    if not uri or pathlib.PurePath(uri).name != uri: raise ValueError(f'Unsupported embedded or nonlocal image {uri}')
    with Image.open(source.parent / uri) as tex:
        return tex.convert('RGBA').resize((SIDE,SIDE), Image.Resampling.BOX).tobytes()

def palette(source, target):
    doc=json.loads(source.read_bytes())
    used=set()
    for material in doc.get('materials',[]):
        tex=material.get('pbrMetallicRoughness',{}).get('baseColorTexture')
        if tex: used.add(doc['textures'][tex['index']]['source'])
    image_ids=sorted(used)
    buf=bytearray(len(doc.get('images',[]))*SIDE*SIDE*4)
    # Two images at once limits resident memory on large originals.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for i,b in zip(image_ids,pool.map(lambda i:thumbnail(source,doc['images'][i]),image_ids)):
            offset=i*SIDE*SIDE*4; buf[offset:offset+len(b)]=b
    target.write_bytes(buf)
    print(source.parent.parent.parent.name,f'{len(used)} albedo thumbnails', flush=True)

def floor_paint(source):
    """Trace the narrow horizontal wayfinding marks before reducing the source texture."""
    doc=json.loads(source.read_bytes())
    masks={}
    for i,material in enumerate(doc.get('materials',[])):
        name=material.get('name','').lower()
        valve=material.get('extras',{}).get('vmat',{})
        texture=material.get('pbrMetallicRoughness',{}).get('baseColorTexture')
        if not name.startswith(('nuke_floor_arrow_','nuke_floor_markings_')) or not texture or valve.get('ShaderName')!='csgo_static_overlay.vfx':
            continue
        src=doc['images'][doc['textures'][texture['index']]['source']]['uri']
        with Image.open(source.parent / unquote(src)) as image:
            art=image.convert('RGBA')
            art.thumbnail((256,256),Image.Resampling.BOX)
        w,h=art.size
        pixels=art.load()
        rectangles=[]; previous={}
        for y in range(h):
            row={}; x=0
            while x<w:
                r,g,b,a=pixels[x,y]
                if a<90:
                    x+=1
                    continue
                start=x
                color=(r//32,g//32,b//32)
                x+=1
                while x<w:
                    r,g,b,a=pixels[x,y]
                    if a<90 or (r//32,g//32,b//32)!=color:break
                    x+=1
                key=(start,x,color)
                rectangle=previous.get(key)
                if rectangle is None:
                    rectangle=[start/w,y/h,x/w,(y+1)/h,*[min(255,v*32+16) for v in color]]
                    rectangles.append(rectangle)
                else:rectangle[3]=(y+1)/h
                row[key]=rectangle
            previous=row
        masks[i]=rectangles
    return masks

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--source',type=pathlib.Path,required=True)
    p.add_argument('--output',type=pathlib.Path,required=True)
    p.add_argument('--map',required=True)
    p.add_argument('--palette-only',action='store_true')
    p.add_argument('--cache',type=pathlib.Path,default=HERE.parents[1]/'artifacts/performance-maps/palette-cache')
    p.add_argument('--entities',type=pathlib.Path,help='Source 2 entity dump when stored outside ../source')
    p.add_argument('--budget',type=int,default=180000)
    a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=True);a.cache.mkdir(parents=True,exist_ok=True)
    key=hashlib.sha256(a.source.read_bytes()).hexdigest()[:16]
    table=a.cache/(a.map+'-'+key+'.rgba')
    if not table.is_file():palette(a.source,table)
    if not a.palette_only:
        masks=a.cache/(a.map+'-'+key+'-floor-paint-v1.json')
        if not masks.exists():
            masks.write_text(json.dumps(floor_paint(a.source),separators=(',',':')),encoding='utf8')
        subprocess.run(['node',str(HERE/'visible-lowpoly.mjs'),str(a.source),str(a.output),a.map,str(table),str(SIDE),str(a.budget),str(a.entities or ''),str(masks)],check=True)
if __name__=='__main__':main()

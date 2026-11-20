"""Tint existing flat vertices by verified collision surface tags. No texture or extra draw call."""
import hashlib
import json
from pathlib import Path
import numpy as np

# Display-space swatches. DEFAULT, CONCRETE and PLASTER retain the map palette.
SWATCHES = {
    'wood': (184,151,107), 'metal': (144,166,179), 'glass': (167,196,195),
    'soil': (190,166,132), 'rock': (183,181,162), 'brick': (196,157,139),
    'ceramic': (196,180,159), 'rubber': (130,140,142), 'brass': (186,168,115),
}
CODE = {name: i for i, name in enumerate(SWATCHES, 1)}

def category(surface):
    if surface.startswith(('wood','cardboard')): return 'wood'
    if surface.startswith(('metal','solidmetal','chainlink','canister')): return 'metal'
    if surface.startswith(('glass','water')): return 'glass'
    if surface in ('dirt','sand','clay'): return 'soil'
    if surface in ('rock','boulder'): return 'rock'
    if surface=='brick': return 'brick'
    if surface.startswith(('porcelain','pottery','tile')): return 'ceramic'
    if surface.startswith('rubber'): return 'rubber'
    if surface.startswith('brass'): return 'brass'
    return None

def position_keys(xyz):
    q=np.rint(xyz*1000).astype('i8') + (1 << 20)
    if np.any((q < 0) | (q >= (1 << 21))):
        raise ValueError('Position exceeds compact millimetre key range')
    return ((q[:,0] << 42) | (q[:,1] << 21) | q[:,2]).astype('u8')

def lookup(directory):
    compiled=directory/'compiled'
    triangles=np.memmap(compiled/'physics.f32',dtype='<f4',mode='r').reshape(-1,3,3)
    groups=json.loads((compiled/'physics-groups.json').read_bytes())
    tags=[];keys=[]
    for group in groups:
        tag=category(group.get('extras',{}).get('SurfaceProperty',''))
        if not tag or not (group['mask']&2): continue
        start=group['firstTriangle']
        k=np.unique(position_keys(triangles[start:start+group['triangles']].reshape(-1,3)))
        keys.append(k);tags.append(np.full(len(k),CODE[tag],dtype='u1'))
    if not keys:return None,None
    keys=np.concatenate(keys);tags=np.concatenate(tags)
    order=np.argsort(keys,kind='stable');keys=keys[order];tags=tags[order]
    heads=np.flatnonzero(np.r_[True,keys[1:]!=keys[:-1]])
    low=np.minimum.reduceat(tags,heads);high=np.maximum.reduceat(tags,heads)
    return keys[heads],np.where(low==high,low,0).astype('u1')

def encode(srgb):
    return np.where(srgb<=.04045,srgb/12.92,((srgb+.055)/1.055)**2.4)

def decode(linear):
    return np.where(linear<=.0031308,12.92*linear,1.055*linear**(1/2.4)-.055)

def tint(directory):
    rd=directory/'render';target=rd/'map.gltf';doc=json.loads(target.read_bytes())
    extras=doc.setdefault('extras',{})
    if extras.get('surfacePaletteVersion')==1:return
    if extras.get('outlineVersion')!=1:raise ValueError('Bake outlined linear vertex colours before tinting')
    raw=bytearray((rd/'map.bin').read_bytes())
    keys,codes=lookup(directory)
    counts={}
    def view(index,dtype,width):
        a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
        return np.frombuffer(raw,dtype,count=a['count']*width,offset=v['byteOffset']).reshape(-1,width)
    if keys is not None:
        for mesh in doc['meshes']:
            attrs=mesh['primitives'][0]['attributes'];points=view(attrs['POSITION'],'<f4',3)
            # Unrotate the exported scene, restoring metre-based simulation coordinates.
            game=points[:,[2,1,0]].copy();game[:,2]*=-1
            packed=position_keys(game)
            idx=np.minimum(np.searchsorted(keys,packed),len(keys)-1)
            tag=np.where(packed==keys[idx],codes[idx],0)
            rgba=view(attrs['COLOR_0'],'u1',4)
            for name,swatch in SWATCHES.items():
                selected=tag==CODE[name]
                if not np.any(selected): continue
                # Start in linear light (glTF COLOR_0). Only apply one display->linear conversion.
                src=rgba[selected,:3]/255.
                display=decode(src)
                luminance=display@np.asarray([.2126,.7152,.0722])
                tone=np.clip(luminance/.79,.75,1.14)
                finish=encode(np.clip(np.asarray(swatch)/255.*tone[:,None],0,1))
                rgba[selected,:3]=np.rint(255*(.15*src+.85*finish)).astype('u1')
                counts[name]=counts.get(name,0)+int(selected.sum())
    extras.update(surfacePaletteVersion=1,originalSurfaceVertices=counts)
    if counts:
        tmp=rd/'map.bin.part';tmp.write_bytes(raw);tmp.replace(rd/'map.bin')
    target.write_text(json.dumps(doc,separators=(',',':')),encoding='utf8')
    print(directory.name,json.dumps(counts),flush=True)

if __name__=='__main__':
    import sys
    for arg in sys.argv[1:]:tint(Path(arg))

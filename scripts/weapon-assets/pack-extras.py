"""Embed original knife meshes, textures, and separate optional viewmodel clips."""
import json,struct,pathlib,hashlib,io,subprocess
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2]
SRC=ROOT/'artifacts/optional-extras';DEST=ROOT/'public/assets/weapons/optional'
DEST.mkdir(parents=True,exist_ok=True)
def read(p):
 b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),bytearray(b[28+n:28+n+struct.unpack_from('<I',b,20+n)[0]])
def write(p,j,data):
 j['buffers']=[{'byteLength':len(data)}];raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);data+=b'\0'*((-len(data))%4)
 b=struct.pack('<4sII',b'glTF',2,28+len(raw)+len(data))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(data),b'BIN\0')+data;p.write_bytes(b)
 return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
skins=[]
for id,name in [('m9','M9 刺刀'),('butterfly','蝴蝶刀')]:
 raw=SRC/id/(id+'.glb');doc,blob=read(raw)
 for image in doc.get('images',[]):
  if 'uri' not in image:continue
  im=Image.open(raw.parent/image.pop('uri'));im.thumbnail((1024,1024),Image.Resampling.LANCZOS);out=io.BytesIO();im.save(out,format='PNG',optimize=True);data=out.getvalue();blob+=b'\0'*((-len(blob))%4)
  image.update(bufferView=len(doc['bufferViews']),mimeType='image/png');doc['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':len(data)});blob.extend(data)
 # Same authored world normalization as the other exported knives. The client
 # removes only this wrapper when mounting the model onto the wpn arm joint.
 lo=[min(doc['accessors'][p['attributes']['POSITION']]['min'][i] for m in doc['meshes'] for p in m['primitives']) for i in range(3)]
 hi=[max(doc['accessors'][p['attributes']['POSITION']]['max'][i] for m in doc['meshes'] for p in m['primitives']) for i in range(3)];center=[(a+b)/2 for a,b in zip(lo,hi)]
 scene=doc['scenes'][doc.get('scene',0)];children=scene['nodes'];scene['nodes']=[len(doc['nodes'])];doc['nodes'].append({'name':'normalization','matrix':[-1,0,0,0,0,1,0,0,0,0,-1,0,center[0],-center[1],center[2],1],'children':children})
 spec=write(DEST/(id+'.glb'),doc,blob)
 out={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'animations':[],'accessors':[],'bufferViews':[]};blob=bytearray();nodes={}
 for path in sorted((SRC/'animations').glob(id+'-*.glb')):
  j,data=read(path);anim=j['animations'][0];accessors={};samplers=[];channels=[]
  def accessor(index):
   if index in accessors:return accessors[index]
   a=j['accessors'][index].copy();v=j['bufferViews'][a.pop('bufferView')];off=v.get('byteOffset',0);length=v['byteLength'];blob.extend(b'\0'*((-len(blob))%4));a['bufferView']=len(out['bufferViews']);out['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':length});blob.extend(data[off:off+length]);accessors[index]=len(out['accessors']);out['accessors'].append(a);return accessors[index]
  for s in anim['samplers']:samplers.append({**s,'input':accessor(s['input']),'output':accessor(s['output'])})
  for c in anim['channels']:
   n=j['nodes'][c['target']['node']]['name']
   if n not in nodes:nodes[n]=len(out['nodes']);out['nodes'].append({'name':n});out['scenes'][0]['nodes'].append(nodes[n])
   channels.append({**c,'target':{**c['target'],'node':nodes[n]}})
  out['animations'].append({'name':id+'/'+path.stem.split('-',1)[1],'samplers':samplers,'channels':channels})
 animation=write(DEST/(id+'-animations.glb'),out,blob);animation['model']='assets/weapons/optional/'+id+'-animations.glb'
 skins.append({'id':id+'-vanilla','weapon':'knife','name':name+' · 原厂涂装','englishName':name,'model':'assets/weapons/optional/'+id+'.glb','preview':'assets/weapons/optional/'+id+'.webp',**spec,'isDefault':False,'animation':animation,'animationFamily':id,'downloadRequired':True,'condition':'Vanilla','wear':0})
(SRC/'knife-catalog.json').write_text(json.dumps(skins,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'id':s['id'],'modelBytes':s['bytes'],'animationBytes':s['animation']['bytes']} for s in skins]))

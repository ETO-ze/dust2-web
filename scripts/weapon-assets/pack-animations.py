"""Package read-only Source 2 Viewer exports; preserve authored joint tracks."""
import json,struct,pathlib,shutil,hashlib,io
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2]
SRC=ROOT/'artifacts/viewmodel';DEST=ROOT/'public/assets/viewmodel'
DEST.mkdir(parents=True,exist_ok=True)
def read(path):
 b=path.read_bytes();size=struct.unpack_from('<I',b,12)[0]
 return json.loads(b[20:20+size]),b[28+size:]
out={'asset':{'version':'2.0','generator':'CS2 Source2Viewer 20 / viewmodel-pack.py'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'animations':[],'accessors':[],'bufferViews':[],'buffers':[{}]}
blob=bytearray();nodes={};report=[]
paths=sorted(SRC.glob('*-*.glb'))+sorted((ROOT/'artifacts/weapon-expansion/animations').glob('*-*.glb'))
for path in paths:
 id,stem=path.stem.split('-',1);j,data=read(path)
 if not j.get('animations'):continue
 action='draw' if stem.startswith('draw') else 'idle' if stem.startswith('idle') else 'reload' if stem.startswith('reload') else 'inspect' if stem.startswith('lookat') else 'heavy' if stem.startswith('heavy') else 'shoot2' if stem.startswith('light_miss2') else 'shoot'
 if path.parent.name=='animations':
  if id=='ssg08' and not stem.endswith('Legacy'):continue
  action=stem.removesuffix('Legacy')
 anim=j['animations'][0];channels=[];samplers=[];accessors={}
 def accessor(index):
  if index in accessors:return accessors[index]
  a=j['accessors'][index].copy();v=j['bufferViews'][a.pop('bufferView')];off=v.get('byteOffset',0);length=v['byteLength']
  while len(blob)%4:blob.append(0)
  a['bufferView']=len(out['bufferViews']);out['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':length});blob.extend(data[off:off+length])
  accessors[index]=len(out['accessors']);out['accessors'].append(a);return accessors[index]
 for s in anim['samplers']:
  samplers.append({**s,'input':accessor(s['input']),'output':accessor(s['output'])})
 for c in anim['channels']:
  name=j['nodes'][c['target']['node']]['name']
  if name not in nodes:
   nodes[name]=len(out['nodes']);out['nodes'].append({'name':name});out['scenes'][0]['nodes'].append(nodes[name])
  channels.append({**c,'target':{**c['target'],'node':nodes[name]}})
 out['animations'].append({'name':f'{id}/{action}','samplers':samplers,'channels':channels})
 report.append({'id':id,'action':action,'source':str(path.relative_to(ROOT)),'channels':len(channels)})
out['buffers'][0]['byteLength']=len(blob)
raw=json.dumps(out,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);blob+=b'\0'*((-len(blob))%4)
result=struct.pack('<4sII',b'glTF',2,28+len(raw)+len(blob))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(blob),b'BIN\0')+blob
(DEST/'animations.glb').write_bytes(result)

(DEST/'animations-manifest.json').write_text(json.dumps({'source':'Installed Counter-Strike 2, read-only original vnmclip export','clips':report,'bytes':len(result),'sha256':hashlib.sha256(result).hexdigest()},indent=2),encoding='utf-8')
print(json.dumps({'animations':len(report),'bones':len(nodes),'bytes':len(result)}))

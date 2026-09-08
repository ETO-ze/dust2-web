"""Package read-only Source 2 Viewer exports; preserve authored joint tracks."""
import json,struct,pathlib,shutil,hashlib,io
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parent.parent
SRC=ROOT/'artifacts/viewmodel';DEST=ROOT/'public/assets/viewmodel'
DEST.mkdir(parents=True,exist_ok=True)
def read(path):
 b=path.read_bytes();size=struct.unpack_from('<I',b,12)[0]
 return json.loads(b[20:20+size]),b[28+size:]
out={'asset':{'version':'2.0','generator':'CS2 Source2Viewer 20 / viewmodel-pack.py'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'animations':[],'accessors':[],'bufferViews':[],'buffers':[{}]}
blob=bytearray();nodes={};report=[]
for path in sorted(SRC.glob('*-*.glb')):
 id,stem=path.stem.split('-',1);j,data=read(path)
 if not j.get('animations'):continue
 action='draw' if stem.startswith('draw') else 'idle' if stem.startswith('idle') else 'reload' if stem.startswith('reload') else 'inspect' if stem.startswith('lookat') else 'heavy' if stem.startswith('heavy') else 'shoot2' if stem.startswith('light_miss2') else 'shoot'
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
# S2V's GLB uses external PNG image URIs: embed those exact original images so a
# successful geometry fetch cannot silently leave the hands without textures.
arms,arm_blob=read(SRC/'arms.glb');arm_blob=bytearray(arm_blob)
for img in arms.get('images',[]):
 if 'uri' not in img:continue
 source=SRC/img.pop('uri');im=Image.open(source).convert('RGB');limit=512 if '_orm_' in source.name else 1024
 im.thumbnail((limit,limit),Image.Resampling.LANCZOS);encoded=io.BytesIO()
 is_color='_color_' in source.name
 im.save(encoded,format='JPEG' if is_color else 'PNG',**({'quality':94,'subsampling':0} if is_color else {'optimize':True}))
 pixels=encoded.getvalue()
 while len(arm_blob)%4:arm_blob.append(0)
 img['bufferView']=len(arms['bufferViews']);img['mimeType']='image/jpeg' if is_color else 'image/png'
 arms['bufferViews'].append({'buffer':0,'byteOffset':len(arm_blob),'byteLength':len(pixels)});arm_blob.extend(pixels)
arms['buffers'][0]['byteLength']=len(arm_blob)
arm_json=json.dumps(arms,separators=(',',':')).encode();arm_json+=b' '*((-len(arm_json))%4);arm_blob+=b'\0'*((-len(arm_blob))%4)
(DEST/'arms.glb').write_bytes(struct.pack('<4sII',b'glTF',2,28+len(arm_json)+len(arm_blob))+struct.pack('<I4s',len(arm_json),b'JSON')+arm_json+struct.pack('<I4s',len(arm_blob),b'BIN\0')+arm_blob)
(DEST/'manifest.json').write_text(json.dumps({'source':'User local CS2 installation, read-only S2V 20 export','arms':'weapons/models/shared/arms/weapon_arms.vmdl_c','animationTracks':'Original Source 2 .vnmclip tracks; camera-space placement and matching skin skeletons retained.','clips':report,'bytes':len(result)},indent=2),encoding='utf-8')
print(json.dumps({'animations':len(report),'bones':len(nodes),'bytes':len(result)}))

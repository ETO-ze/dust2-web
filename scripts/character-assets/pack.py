"""Keep only original player meshes and selected locomotion clips from S2V GLBs.

The source model export includes >2,000 animations. Stream their accessor tables
instead of loading gigabyte source GLBs into memory. Requires Pillow and ijson.
"""
import copy, hashlib, io, json, mmap, pathlib, struct, sys
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'artifacts/python-tools'))
import ijson
STAGE=ROOT/'artifacts/characters-cs2'; DEST=ROOT/'public/assets/characters-cs2'
DEST.mkdir(parents=True,exist_ok=True)

class Source:
 def __init__(self,path):
  self.path=path;self.file=path.open('rb');self.mm=mmap.mmap(self.file.fileno(),0,access=mmap.ACCESS_READ)
  self.json_end=20+struct.unpack_from('<I',self.mm,12)[0];self.bin_start=self.json_end+8
 def start(self,key):
  needle=('"'+key+'":').encode();p=self.mm.find(b','+needle,20,self.json_end)
  if p<0:
   if self.mm[21:21+len(needle)]==needle:return 21+len(needle)
   return None
  return p+1+len(needle)
 def field(self,key,default=None):
  start=self.start(key)
  if start is None:return default
  return json.JSONDecoder().raw_decode(self.mm[start:min(self.json_end,start+2000000)].decode())[0]
 def selected(self,key,indices):
  result={};self.file.seek(self.start(key));max_index=max(indices)
  for i,item in enumerate(ijson.items(self.file,'item',use_float=True)):
   if i in indices:result[i]=item
   if i>=max_index:break
  if len(result)!=len(indices):raise ValueError('Missing '+key)
  return result
 def close(self):self.mm.close();self.file.close()

def write_glb(path,j,blob):
 j['buffers']=[{'byteLength':len(blob)}];raw=json.dumps(j,separators=(',',':')).encode();raw+=b' '*(-len(raw)%4);blob+=b'\0'*(-len(blob)%4)
 path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(raw)+len(blob))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(blob),b'BIN\0')+blob)

def packed_model(team,variant=None,filename=None):
 key=variant or team
 src=Source(STAGE/'raw'/key/(key+'.glb'))
 nodes=src.field('nodes');meshes=src.field('meshes');skins=src.field('skins')
 selected_nodes=[i for i,n in enumerate(nodes) if '.thirdperson_body' in n.get('name','') or '.thirdperson_default_gloves' in n.get('name','')]
 if not selected_nodes:raise ValueError('No third-person source mesh in '+key)
 parents={child:i for i,n in enumerate(nodes) for child in n.get('children',[])}
 keep=set(selected_nodes)
 for i in selected_nodes:keep.update(skins[nodes[i]['skin']]['joints'])
 for i in list(keep):
  while i in parents:i=parents[i];keep.add(i)
 node_map={i:n for n,i in enumerate(sorted(keep))};mesh_ids=[nodes[i]['mesh'] for i in selected_nodes];skin_ids=[nodes[i]['skin'] for i in selected_nodes]
 mesh_map={i:n for n,i in enumerate(mesh_ids)};skin_map={i:n for n,i in enumerate(skin_ids)}
 out={'asset':{'version':'2.0','generator':'Source 2 Viewer 20; original CS2 agent mesh + trimmed animations'},'scene':0,'scenes':[{'nodes':[node_map[i] for i in src.field('scenes')[0]['nodes'] if i in keep]}],'nodes':[],'meshes':[copy.deepcopy(meshes[i]) for i in mesh_ids],'skins':[copy.deepcopy(skins[i]) for i in skin_ids],'accessors':[],'bufferViews':[],'materials':[],'textures':[],'images':[]}
 for i in sorted(keep):
  n=copy.deepcopy(nodes[i]);n['name']=n.get('name','').split('\\')[-1]
  if 'children'in n:n['children']=[node_map[c] for c in n['children'] if c in keep]
  if 'mesh'in n:n['mesh']=mesh_map[n['mesh']];n['skin']=skin_map[n['skin']]
  out['nodes'].append(n)
 for s in out['skins']:s['joints']=[node_map[i] for i in s['joints']]
 accessor_ids={s['inverseBindMatrices'] for s in out['skins']};material_ids=set()
 for m in out['meshes']:
  m.pop('extras',None)
  for p in m['primitives']:
   p.pop('targets',None);p['attributes'].pop('TEXCOORD_1',None)
   accessor_ids.update(p['attributes'].values());accessor_ids.add(p['indices']);material_ids.add(p['material'])
 accessors=src.selected('accessors',accessor_ids);views=src.selected('bufferViews',{a['bufferView'] for a in accessors.values()});blob=bytearray();accessor_map={};view_map={}
 for i,a in sorted(accessors.items()):
  a=copy.deepcopy(a);vi=a['bufferView']
  if vi not in view_map:
   v=views[vi];blob.extend(b'\0'*(-len(blob)%4));view_map[vi]=len(out['bufferViews']);out['bufferViews'].append({**v,'buffer':0,'byteOffset':len(blob)});start=src.bin_start+v.get('byteOffset',0);blob.extend(src.mm[start:start+v['byteLength']])
  a['bufferView']=view_map[vi];accessor_map[i]=len(out['accessors']);out['accessors'].append(a)
 for s in out['skins']:s['inverseBindMatrices']=accessor_map[s['inverseBindMatrices']]
 materials=src.field('materials');textures=src.field('textures');images=src.field('images');material_map={};texture_map={};image_map={}
 def texture(old_index,color=False):
  if old_index in texture_map:return texture_map[old_index]
  tex=copy.deepcopy(textures[old_index]);im_index=tex['source']
  if im_index not in image_map:
   im=images[im_index];source=src.path.parent/im['uri'];pixels=Image.open(source).convert('RGB');pixels.thumbnail((1024,1024) if color else (512,512),Image.Resampling.LANCZOS);encoded=io.BytesIO();pixels.save(encoded,format='JPEG' if color else 'PNG',**({'quality':92,'subsampling':0} if color else {'optimize':True}));data=encoded.getvalue();blob.extend(b'\0'*(-len(blob)%4));image_map[im_index]=len(out['images']);out['images'].append({'name':im['name'],'bufferView':len(out['bufferViews']),'mimeType':'image/jpeg' if color else 'image/png'});out['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':len(data)});blob.extend(data)
  tex['source']=image_map[im_index];tex.pop('sampler',None);texture_map[old_index]=len(out['textures']);out['textures'].append(tex);return texture_map[old_index]
 for mi in sorted(material_ids):
  m=copy.deepcopy(materials[mi]);m.pop('extras',None);pbr=m.get('pbrMetallicRoughness',{})
  for key in ['baseColorTexture','metallicRoughnessTexture']:
   if key in pbr:pbr[key]['index']=texture(pbr[key]['index'],key=='baseColorTexture')
  for key in ['normalTexture','occlusionTexture','emissiveTexture']:
   if key in m:m[key]['index']=texture(m[key]['index'],key=='emissiveTexture')
  material_map[mi]=len(out['materials']);out['materials'].append(m)
 for m in out['meshes']:
  for p in m['primitives']:p['attributes']={k:accessor_map[v] for k,v in p['attributes'].items()};p['indices']=accessor_map[p['indices']];p['material']=material_map[p['material']]
 out['extras']={'team':team,'agentId':variant or ('ct-sas' if team=='CT' else 't-phoenix'),'isDefault':variant is None,'sourceModel':nodes[0]['name'].replace('\\','/'),'scale':'authored meters','animations':'animations.glb'}
 filename=filename or ('ct-sas.glb' if team=='CT' else 't-phoenix.glb');(DEST/filename).parent.mkdir(parents=True,exist_ok=True);write_glb(DEST/filename,out,blob);src.close();print(filename,(DEST/filename).stat().st_size,flush=True)
 return {'team':team,'path':filename,'bytes':(DEST/filename).stat().st_size,'bones':[n['name'] for n in out['nodes'] if 'mesh' not in n]}

def animations():
 out={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'animations':[],'accessors':[],'bufferViews':[]};blob=bytearray();node_map={};report=[]
 for path in sorted((STAGE/'animations').glob('*.glb')):
  src=Source(path);j={k:src.field(k) for k in ['animations','accessors','bufferViews','nodes']};a=j['animations'][0];accessor_map={}
  def accessor(i):
   if i in accessor_map:return accessor_map[i]
   obj=copy.deepcopy(j['accessors'][i]);v=j['bufferViews'][obj['bufferView']];blob.extend(b'\0'*(-len(blob)%4));obj['bufferView']=len(out['bufferViews']);out['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':v['byteLength']});start=src.bin_start+v.get('byteOffset',0);blob.extend(src.mm[start:start+v['byteLength']]);accessor_map[i]=len(out['accessors']);out['accessors'].append(obj);return accessor_map[i]
  name=path.stem.replace('-','/',1);samplers=[{**s,'input':accessor(s['input']),'output':accessor(s['output'])} for s in a['samplers']];channels=[]
  for c in a['channels']:
   bone=j['nodes'][c['target']['node']]['name']
   # Movement is server-driven. Keep pelvis pose and rotations, but never let
   # extracted root-motion tracks translate the model out of its hitbox.
   if bone=='root_motion' and c['target']['path']=='translation':continue
   if bone not in node_map:node_map[bone]=len(out['nodes']);out['nodes'].append({'name':bone});out['scenes'][0]['nodes'].append(node_map[bone])
   channels.append({**c,'target':{**c['target'],'node':node_map[bone]}})
  out['animations'].append({'name':name,'samplers':samplers,'channels':channels});report.append(name);src.close()
 write_glb(DEST/'animations.glb',out,blob);print('animations',len(report),(DEST/'animations.glb').stat().st_size,flush=True);return report

if __name__=='__main__':
 rows=[packed_model(t) for t in ['CT','T']];clips=animations();manifest={'source':'User local CS2 installation; original Valve assets','agents':rows,'clips':clips}
 (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')

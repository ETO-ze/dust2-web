"""Combine original agent sleeves/bare arms with the requested Sport Gloves.

The agent first-person meshes use the same authored inverse bind matrices as
weapon_arms. Joint names are remapped, not re-posed or approximated with colors.
Full weapon_arms channels (including wpn) remain available to every gun clip.
"""
import copy,hashlib,io,json,struct
import numpy as np
from PIL import Image
from pack import ROOT,Source,write_glb

DEST=ROOT/'public/assets/characters-cs2/arms'
SPECS=[('ct-sas','CT'),('t-phoenix','T'),('ct-ava','ct-ava'),('t-miami','t-miami')]

def compact(out,blob):
 """Drop the replaced generic skin's images/geometry from each download."""
 mids=sorted({p['material'] for m in out['meshes'] for p in m['primitives']});mmap={v:i for i,v in enumerate(mids)};out['materials']=[out['materials'][i] for i in mids]
 refs=[]
 for m in out['materials']:
  for parent,key in [(m.get('pbrMetallicRoughness',{}),'baseColorTexture'),(m.get('pbrMetallicRoughness',{}),'metallicRoughnessTexture'),(m,'normalTexture'),(m,'occlusionTexture')]:
   if key in parent:refs.append(parent[key])
 tids=sorted({r['index'] for r in refs});tmap={v:i for i,v in enumerate(tids)};out['textures']=[out['textures'][i] for i in tids]
 for r in refs:r['index']=tmap[r['index']]
 iids=sorted({t['source'] for t in out['textures']});imap={v:i for i,v in enumerate(iids)};out['images']=[out['images'][i] for i in iids]
 for t in out['textures']:t['source']=imap[t['source']]
 aids={s['inverseBindMatrices'] for s in out['skins']}
 for m in out['meshes']:
  for p in m['primitives']:aids.update(p['attributes'].values());aids.add(p['indices']);p['material']=mmap[p['material']]
 aids=sorted(aids);amap={v:i for i,v in enumerate(aids)};out['accessors']=[out['accessors'][i] for i in aids]
 for s in out['skins']:s['inverseBindMatrices']=amap[s['inverseBindMatrices']]
 for m in out['meshes']:
  for p in m['primitives']:p['attributes']={k:amap[v] for k,v in p['attributes'].items()};p['indices']=amap[p['indices']]
 vids=sorted({a['bufferView'] for a in out['accessors']}|{i['bufferView'] for i in out['images']});vmap={v:i for i,v in enumerate(vids)};views=[];new=bytearray()
 for v in vids:
  view=copy.deepcopy(out['bufferViews'][v]);offset=view.get('byteOffset',0);new.extend(b'\0'*(-len(new)%4));view['byteOffset']=len(new);new.extend(blob[offset:offset+view['byteLength']]);views.append(view)
 out['bufferViews']=views
 for value in out['accessors']+out['images']:value['bufferView']=vmap[value['bufferView']]
 return new

def read(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),bytearray(b[28+n:])

def pack(agent,key):
 out,blob=read(ROOT/'public/assets/viewmodel/arms.glb')
 # The two original Sport Glove primitives keep the authored Hedge Maze PBR.
 # Replace the generic bare-arm primitive with this agent's own skin/tattoos.
 out['meshes'][0]['primitives']=[p for p in out['meshes'][0]['primitives'] if 'Hedge Maze' in out['materials'][p['material']]['name']]
 src=Source(ROOT/'artifacts/characters-cs2/raw'/key/(key+'.glb'))
 nodes=src.field('nodes');meshes=src.field('meshes');skins=src.field('skins');materials=src.field('materials');textures=src.field('textures');images=src.field('images')
 select=[n for n in nodes if '.firstperson_' in n.get('name','')]
 names={n['name']:i for i,n in enumerate(out['nodes'])};parents={c:i for i,n in enumerate(nodes) for c in n.get('children',[])}
 def joint(old):
  name=nodes[old]['name']
  if name in names:return names[name]
  parent=parents.get(old)
  if parent is None:raise ValueError('No compatible parent for '+name)
  parent=joint(parent);new=copy.deepcopy(nodes[old]);new.pop('children',None);new.pop('mesh',None);new.pop('skin',None);index=len(out['nodes']);out['nodes'].append(new);names[name]=index;out['nodes'][parent].setdefault('children',[]).append(index);return index
 primitives=[];skin=skins[select[0]['skin']]
 for n in select:
  if skins[n['skin']]['joints']!=skin['joints']:raise ValueError('Mismatched arm/sleeve joints')
  for p in meshes[n['mesh']]['primitives']:
   if 'glove' in materials[p['material']].get('name','').lower():continue
   p=copy.deepcopy(p);p.pop('targets',None);p['attributes'].pop('TEXCOORD_1',None);primitives.append(p)
 ids={skin['inverseBindMatrices']}
 for p in primitives:ids.update(p['attributes'].values());ids.add(p['indices'])
 accessors=src.selected('accessors',ids);views=src.selected('bufferViews',{a['bufferView'] for a in accessors.values()})
 def data(a):
  v=views[a['bufferView']];start=src.bin_start+v.get('byteOffset',0)+a.get('byteOffset',0);dtype={5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
  return np.ndarray((a['count'],width),dtype=dtype,buffer=src.mm,offset=start,strides=(v.get('byteStride',np.dtype(dtype).itemsize*width),np.dtype(dtype).itemsize)).copy()
 used=set()
 for p in primitives:
  js=data(accessors[p['attributes']['JOINTS_0']]);ws=data(accessors[p['attributes']['WEIGHTS_0']]);used.update(int(x) for x in js[ws>0])
 used=sorted(used);joint_map={old:i for i,old in enumerate(used)}
 def add(data):
  blob.extend(b'\0'*(-len(blob)%4));i=len(out['bufferViews']);out['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':len(data)});blob.extend(data);return i
 amap={}
 for old,a in sorted(accessors.items()):
  a=copy.deepcopy(a);values=data(a)
  if old==skin['inverseBindMatrices']:
   values=values[used];a['count']=len(used)
  elif any(p['attributes'].get('JOINTS_0')==old for p in primitives):
   values=np.vectorize(lambda n:joint_map.get(int(n),0))(values).astype(values.dtype)
  a['bufferView']=add(values.tobytes());a.pop('byteOffset',None);amap[old]=len(out['accessors']);out['accessors'].append(a)
 new_skin={'name':agent+' firstperson sleeves','joints':[joint(skin['joints'][i]) for i in used],'inverseBindMatrices':amap[skin['inverseBindMatrices']]}
 image_cache={};material_map={}
 def texture(i,color):
  if i in image_cache:return image_cache[i]
  tex=textures[i];im=images[tex['source']];pixels=Image.open(src.path.parent/im['uri']).convert('RGB');pixels.thumbnail((1024,1024) if color else (512,512),Image.Resampling.LANCZOS);buffer=io.BytesIO();pixels.save(buffer,format='JPEG' if color else 'PNG',**({'quality':94,'subsampling':0} if color else {'optimize':True}));index=len(out['textures']);out['textures'].append({'source':len(out['images'])});out['images'].append({'name':im.get('name',im['uri']),'bufferView':add(buffer.getvalue()),'mimeType':'image/jpeg' if color else 'image/png'});image_cache[i]=index;return index
 for p in primitives:
  mi=p['material']
  if mi not in material_map:
   m=copy.deepcopy(materials[mi]);m.pop('extras',None)
   for parent,key,color in [(m.get('pbrMetallicRoughness',{}),'baseColorTexture',True),(m.get('pbrMetallicRoughness',{}),'metallicRoughnessTexture',False),(m,'normalTexture',False),(m,'occlusionTexture',False)]:
    if key in parent:parent[key]['index']=texture(parent[key]['index'],color)
   material_map[mi]=len(out['materials']);out['materials'].append(m)
  p['attributes']={k:amap[v] for k,v in p['attributes'].items()};p['indices']=amap[p['indices']];p['material']=material_map[mi]
 sk=len(out['skins']);out['skins'].append(new_skin);mi=len(out['meshes']);out['meshes'].append({'name':agent+' original firstperson arms and sleeves','primitives':primitives});ni=len(out['nodes']);out['nodes'].append({'name':agent+' original firstperson arms and sleeves','mesh':mi,'skin':sk});out['scenes'][0]['nodes'].append(ni)
 out['extras'].update({'agentId':agent,'sourceAgent':nodes[0]['name'].replace('\\','/'),'agentMaterials':[materials[i]['name'] for i in material_map],'sourceSleeves':'Original firstperson_sleeves and bare-arm primitives, remapped by native joint names'})
 file=DEST/(agent+'.glb');write_glb(file,out,compact(out,blob));src.close();sha=hashlib.sha256(file.read_bytes()).hexdigest();row={'id':agent,'model':file.relative_to(ROOT/'public').as_posix(),'bytes':file.stat().st_size,'sha256':sha,'materials':out['extras']['agentMaterials'],'gloves':{'paintkit':10038,'wear':.06,'exterior':'Factory New'}};print(json.dumps(row),flush=True);return row

if __name__=='__main__':
 DEST.mkdir(parents=True,exist_ok=True);rows=[pack(*s) for s in SPECS];(DEST/'manifest.json').write_text(json.dumps({'agents':rows},indent=2)+'\n',encoding='utf8')

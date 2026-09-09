"""Original Sport Gloves mesh, Hedge Maze palette/masks, Factory New exterior.

This bakes the source material into glTF PBR; it does not run Source 2's shader.
The minimum allowed glove float 0.06 maps to zero additional wear in this bake.
The complete existing weapon_arms animation skeleton is retained, including wpn.
"""
import copy, io, json, pathlib, re, struct
import numpy as np
from PIL import Image
from pack import ROOT, write_glb
SRC=ROOT/'artifacts/characters-cs2/gloves';DEST=ROOT/'public/assets/viewmodel'

def read(path):
 b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]

def bake():
 n=1024;vmat=(SRC/'sporty_green.vmat').read_text();params=dict(re.findall(r'"([^"\n]+)"\s+"([^"\n]*)"',vmat))
 palette=np.array([[float(v) for v in params[f'g_vColorTint{i}'].strip('[]').split()][:3] for i in range(1,9)],dtype=np.float32)
 mask=np.asarray(Image.open(SRC/'sporty_glove_mask.png').convert('RGBA').resize((n,n)),dtype=np.float32)/255
 surface=np.asarray(Image.open(SRC/'sporty_glove_ao.png').convert('RGBA').resize((n,n),Image.Resampling.LANCZOS),dtype=np.float32)/255
 # Alpha stores an eight-entry material palette index. RGB identifies the four
 # original textiles (base cloth plus red, green and blue blend layers).
 indices=np.minimum(7,(mask[:,:,3]*8).astype(int));color=palette[indices]
 y,x=np.mgrid[0:n,0:n].astype(np.float32);u=(x+.5)/n-.5;v=(y+.5)/n-.5
 angle=np.deg2rad(30);pu=(u*np.cos(angle)-v*np.sin(angle))*9;pv=(u*np.sin(angle)+v*np.cos(angle))*9
 pattern=np.asarray(Image.open(SRC/'pattern_icarus_logo.png').convert('RGB'),dtype=np.float32)/255
 sample=pattern[(np.mod(pv,1)*pattern.shape[0]).astype(int),(np.mod(pu,1)*pattern.shape[1]).astype(int)]
 weights=np.concatenate([np.clip(1-sample.sum(axis=2,keepdims=True),0,1),sample],axis=2)
 pattern_colors=palette[np.array([8,3,3,3])-1];pattern_color=weights@pattern_colors
 color=np.where((indices==7)[:,:,None],pattern_color,color)
 layer=np.concatenate([np.clip(1-mask[:,:,:3].sum(axis=2,keepdims=True),0,1),mask[:,:,:3]],axis=2)
 scales=[2.5,2.5,2,6];names=['fabric01','chemicalfiber03','rubber01','fabric02'];detail=np.zeros((n,n),dtype=np.float32)
 rough=np.zeros((n,n),dtype=np.float32)
 for i,name in enumerate(names):
  tex=np.asarray(Image.open(SRC/(name+'_detail.png')).convert('RGBA'),dtype=np.float32)/255
  d=tex[(np.mod((v+.5)*scales[i],1)*tex.shape[0]).astype(int),(np.mod((u+.5)*scales[i],1)*tex.shape[1]).astype(int)]
  detail+=layer[:,:,i]*(.91+.12*d[:,:,0]);rough+=layer[:,:,i]*np.clip(float(params.get(f'g_fDetailRoughnessBrightness{i+1}',.8))*(.6+d[:,:,1]*.35),.25,.95)
 color*=detail[:,:,None];ao=np.clip(surface[:,:,1],.35,1)
 Image.fromarray(np.uint8(np.clip(color,0,1)*255)).save(SRC/'hedge-maze-color.jpg',quality=95,subsampling=0)
 orm=np.stack([ao,rough,np.zeros_like(ao)],axis=2);Image.fromarray(np.uint8(np.clip(orm,0,1)*255)).save(SRC/'hedge-maze-orm.png',optimize=True)

def pack():
 arms,ab=read(ROOT/'artifacts/viewmodel/arms.glb');gloves,gb=read(SRC/'sport.glb');out={k:copy.deepcopy(arms[k]) for k in ['asset','scenes','nodes']};out.update({'meshes':[],'skins':[],'accessors':[],'bufferViews':[],'materials':[],'textures':[],'images':[]})
 source_mesh=copy.deepcopy(gloves['meshes'][1]);source_skin=copy.deepcopy(gloves['skins'][1]);name_map={n['name']:i for i,n in enumerate(arms['nodes'])};aliases={}
 for i,old_node in enumerate(source_skin['joints']):
  name=gloves['nodes'][old_node]['name'];target=name
  if target not in name_map and '_TWIST' in target:
   parent_name=target.split('_TWIST')[0]
   if parent_name not in name_map:raise ValueError('Missing twist parent '+parent_name)
   # Preserve each authored twist bind transform as its own bone. Reusing the
   # parent joint with a second inverse bind matrix distorts the bare forearm.
   name_map[target]=len(out['nodes']);node=copy.deepcopy(gloves['nodes'][old_node]);node.pop('children',None);out['nodes'].append(node)
   out['nodes'][name_map[parent_name]].setdefault('children',[]).append(name_map[target]);aliases[name]=parent_name
  if target not in name_map:raise ValueError('Missing compatible arm joint '+name)
  source_skin['joints'][i]=name_map[target]
 ids={source_skin['inverseBindMatrices']}
 for p in source_mesh['primitives']:ids.update(p['attributes'].values());ids.add(p['indices'])
 blob=bytearray();accessor_map={};view_map={}
 for i in sorted(ids):
  a=copy.deepcopy(gloves['accessors'][i]);vi=a['bufferView'];v=gloves['bufferViews'][vi]
  if vi not in view_map:
   blob.extend(b'\0'*(-len(blob)%4));view_map[vi]=len(out['bufferViews']);out['bufferViews'].append({**v,'buffer':0,'byteOffset':len(blob)});offset=v.get('byteOffset',0);blob.extend(gb[offset:offset+v['byteLength']])
  a['bufferView']=view_map[vi];accessor_map[i]=len(out['accessors']);out['accessors'].append(a)
 for p in source_mesh['primitives']:p['attributes']={k:accessor_map[v] for k,v in p['attributes'].items()};p['indices']=accessor_map[p['indices']]
 source_skin['inverseBindMatrices']=accessor_map[source_skin['inverseBindMatrices']];out['skins']=[source_skin];out['meshes']=[source_mesh]
 mesh_node=next(node for node in out['nodes'] if 'mesh'in node);mesh_node.update({'name':'Sport Gloves - Hedge Maze - Factory New','mesh':0,'skin':0})
 image_cache={}
 def texture(filename,color=False,limit=1024):
  if filename in image_cache:return image_cache[filename]
  pixels=Image.open(SRC/filename).convert('RGB');pixels.thumbnail((limit,limit),Image.Resampling.LANCZOS);buf=io.BytesIO();pixels.save(buf,format='JPEG' if color else 'PNG',**({'quality':95,'subsampling':0} if color else {'optimize':True}));data=buf.getvalue();blob.extend(b'\0'*(-len(blob)%4));image_index=len(out['images']);out['images'].append({'name':filename,'bufferView':len(out['bufferViews']),'mimeType':'image/jpeg' if color else 'image/png'});out['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':len(data)});blob.extend(data);index=len(out['textures']);out['textures'].append({'source':image_index});image_cache[filename]=index;return index
 paint_color=texture('hedge-maze-color.jpg',True);paint_normal=texture('sporty_glove_normal_tga_f0c4a4c0.png');paint_orm=texture('hedge-maze-orm.png')
 for side in ['left','right']:
  out['materials'].append({'name':f'Hedge Maze Factory New ({side})','pbrMetallicRoughness':{'baseColorTexture':{'index':paint_color},'metallicRoughnessTexture':{'index':paint_orm},'metallicFactor':0,'roughnessFactor':1},'normalTexture':{'index':paint_normal},'occlusionTexture':{'index':paint_orm},'extras':{'paintkit':10038,'wear':.06,'normalizedWear':0,'exterior':'Factory New','sourceMaterial':'gloves/paints/sporty_green.vmat'}})
 m=copy.deepcopy(gloves['materials'][2]);m.pop('extras',None)
 for parent,key,color in [(m['pbrMetallicRoughness'],'baseColorTexture',True),(m['pbrMetallicRoughness'],'metallicRoughnessTexture',False),(m,'normalTexture',False),(m,'occlusionTexture',False)]:
  if key in parent:
   image=gloves['images'][gloves['textures'][parent[key]['index']]['source']];parent[key]['index']=texture(image['uri'],color)
 out['materials'].append(m);out['extras']={'gloves':'Sport Gloves | Hedge Maze','paintkit':10038,'exterior':'Factory New','wear':.06,'normalizedWear':0,'sourceMesh':'agents/models/shared/arms/glove_sporty/glove_sporty.vmdl_c:viewmodel','sourceMaterial':'gloves/paints/sporty_green.vmat','skeleton':'Original weapon_arms skeleton with authored wpn/hand/finger animation joints','additionalTwistBones':aliases,'rendering':'PBR bake using original mesh, 8-color palette, textile masks, logo pattern, normal and AO. No additional damage or grunge.'};write_glb(DEST/'arms.glb',out,blob)
 (DEST/'gloves-manifest.json').write_text(json.dumps(out['extras'],indent=2)+'\n',encoding='utf8');print('Hedge Maze FN',len(blob),'additional twist bones',aliases)

if __name__=='__main__':bake();pack()

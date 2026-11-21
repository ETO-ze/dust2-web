"""Replace the six existing architectural materials in the nine editable map scenes.

blender -b -t 4 --python-exit-code 1 -P scripts/maps/assign-arena-finishes.py -- artifacts/blender-nine-crisp/scenes artifacts/blender-arena
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory
import runpy
import sys

import bpy
import numpy as np

SCRIPTS = Path(__file__).resolve().parent
CLIENT = SCRIPTS.parents[1] / 'client'
previous=runpy.run_path(str(SCRIPTS/'assign-nine-map-finishes.py'))

def unpack(pack):
    text=pack.read_text('utf8')
    def field(k):
        return json.loads(re.search('^export const '+k+'=(.*);$',text,re.M)[1])
    size=field('side')
    info=field('finishes')
    raw=gzip.decompress(base64.b64decode(field('packed')))
    levels=np.cumsum(np.frombuffer(raw,dtype=np.uint8).reshape(len(info),size,size),axis=2,dtype=np.uint8)
    if hashlib.sha256(levels.tobytes()).hexdigest()!=field('sha256'):
        raise ValueError('Invalid arena atlas')
    lut=np.rint(np.arange(64)*255/63).astype(np.uint8)
    return list(zip(info,lut[levels]))

def coating_group(palette):
    tree=bpy.data.node_groups.new('Arena / matte architectural coating','ShaderNodeTree')
    for name in ['Source pigment','Coating pigment','Face normal']:
        tree.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketVector')
    tree.interface.new_socket(name='Color',in_out='OUTPUT',socket_type='NodeSocketColor')
    def n(kind,label):
        node=tree.nodes.new(kind)
        node.label=label
        return node
    def wire(socket,value):
        if isinstance(value,bpy.types.NodeSocket):
            tree.links.new(value,socket)
        else:
            socket.default_value=value
    def math(op,a,b=None,c=None,label=''):
        node=n('ShaderNodeMath',label)
        node.operation=op
        for i,val in enumerate([a,b,c]):
            if val is not None: wire(node.inputs[i],val)
        return node.outputs[0]
    def vector(op,x,y,label):
        node=n('ShaderNodeVectorMath',label)
        node.operation=op
        wire(node.inputs[0],x)
        wire(node.inputs['Scale' if op=='SCALE' else 1],y)
        return node.outputs['Value' if op=='DOT_PRODUCT' else 'Vector']
    def split(value):
        node=n('ShaderNodeSeparateXYZ','Components')
        wire(node.inputs[0],value)
        return node.outputs
    inp=n('NodeGroupInput','World-space coating')
    src,paint,normal=inp.outputs['Source pigment'],inp.outputs['Coating pigment'],inp.outputs['Face normal']
    luma=vector('DOT_PRODUCT',src,palette['sourceLuma'],'Retain baked occlusion')
    limited=math('MINIMUM',math('MAXIMUM',luma,0),1)
    light=math('MULTIPLY_ADD',math('SQRT',limited),1.04,.36,label='Pigment value')
    k=np.asarray(palette['keyDirection'])
    k=k/np.linalg.norm(k)
    key=vector('DOT_PRODUCT',normal,(k[0],-k[2],k[1]),'Soft directional key')
    side=math('MULTIPLY_ADD',math('MAXIMUM',key,0),.30,.76,label='Soft orientation')
    lift=math('MULTIPLY_ADD',split(normal)['Z'],.11,side)
    matte=vector('SCALE',paint,math('MULTIPLY',light,lift),'Matte painted base')
    r,g,b=split(src)
    high=math('MAXIMUM',r,math('MAXIMUM',g,b))
    low=math('MINIMUM',r,math('MINIMUM',g,b))
    ramp=n('ShaderNodeMapRange','Saturated landmark pigment')
    ramp.interpolation_type='SMOOTHSTEP'
    wire(ramp.inputs['Value'],math('SUBTRACT',high,low))
    ramp.inputs['From Min'].default_value=.07
    ramp.inputs['From Max'].default_value=.30
    accent=math('MULTIPLY_ADD',ramp.outputs[0],.45,.10)
    mix=n('ShaderNodeMixRGB','Map landmark retention')
    wire(mix.inputs[0],accent)
    wire(mix.inputs[1],matte)
    wire(mix.inputs[2],src)
    dest=n('NodeGroupOutput','Finished coating')
    wire(dest.inputs['Color'],mix.outputs[0])
    levels,counts={},{}
    def depth(node):
        if node.name not in levels:
            parents=[edge.from_node for i in node.inputs for edge in i.links]
            levels[node.name]=max((depth(p) for p in parents),default=-1)+1
        return levels[node.name]
    for node in tree.nodes:
        column=depth(node)
        row=counts.get(column,0)
        counts[column]=row+1
        node.location=(column*240,-row*300)
    return tree

def signature(scene):
    h=hashlib.sha256()
    vertices=triangles=0
    for obj in sorted(scene.objects,key=lambda o:o.name):
        if obj.type!='MESH': continue
        m=obj.data
        h.update(obj.name.encode()+bytes([obj.hide_render]))
        h.update(np.asarray(obj.matrix_world,dtype='<f4').tobytes())
        pos=np.empty((len(m.vertices),3),np.float32)
        m.vertices.foreach_get('co',pos.ravel())
        ids=np.empty(len(m.loops),np.int32)
        m.loops.foreach_get('vertex_index',ids)
        lengths=np.empty(len(m.polygons),np.int32)
        m.polygons.foreach_get('loop_total',lengths)
        slots=np.empty(len(m.polygons),np.int32)
        m.polygons.foreach_get('material_index',slots)
        for arr in (pos,ids,lengths,slots): h.update(arr.tobytes())
        vertices+=len(pos)
        triangles+=int((lengths-2).sum())
    return dict(meshSha256=h.hexdigest(),vertices=vertices,trianglesIncludingStencils=triangles,
                renderTriangles=scene['render_triangles'],batches=scene['render_batches'])

def assign_neutral(rules,palette,map_id):
    # Tag 255 also covers foliage and painted signs. Use saturation and value
    # to coat neutral architectural pieces while retaining distinct pigments.
    mat=bpy.data.materials['Map pigment / retained source lighting']
    tree=mat.node_tree
    pigment=next(n for n in tree.nodes if n.type=='VERTEX_COLOR')
    emit=next(n for n in tree.nodes if n.type=='EMISSION')
    source=pigment.outputs['Color']
    def node(kind,label=''):
        n=tree.nodes.new(kind)
        n.label=label
        return n
    def put(socket,value):
        if isinstance(value,bpy.types.NodeSocket):
            tree.links.new(value,socket)
        else:
            socket.default_value=value
    def math(op,a,b):
        n=node('ShaderNodeMath')
        n.operation=op
        put(n.inputs[0],a)
        put(n.inputs[1],b)
        return n.outputs[0]
    def ramp(value,lo,hi,label):
        n=node('ShaderNodeMapRange',label)
        n.interpolation_type='SMOOTHSTEP'
        put(n.inputs['Value'],value)
        put(n.inputs['From Min'],lo)
        put(n.inputs['From Max'],hi)
        return n.outputs[0]
    def mix(factor,a,b,label):
        n=node('ShaderNodeMixRGB',label)
        for i,v in enumerate([factor,a,b]): put(n.inputs[i],v)
        return n.outputs[0]
    lum=node('ShaderNodeVectorMath','Baked value')
    lum.operation='DOT_PRODUCT'
    put(lum.inputs[0],source)
    put(lum.inputs[1],palette['sourceLuma'])
    y=lum.outputs['Value']
    rgb=node('ShaderNodeSeparateXYZ')
    put(rgb.inputs[0],source)
    r,g,b=rgb.outputs
    hi=math('MAXIMUM',r,math('MAXIMUM',g,b))
    lo=math('MINIMUM',r,math('MINIMUM',g,b))
    sat=math('DIVIDE',math('SUBTRACT',hi,lo),math('MAXIMUM',.08,hi))
    weight=math('SUBTRACT',1,ramp(sat,.18,.40,'Preserve coloured markings'))
    weight=math('MULTIPLY',weight,ramp(y,.015,.065,'Preserve dark ink'))
    weight=math('MULTIPLY',weight,math('SUBTRACT',1,ramp(y,.72,.93,'Preserve white details')))
    weight=math('MULTIPLY',weight,math('GREATER_THAN',pigment.outputs['Alpha'],.997))
    geo=node('ShaderNodeNewGeometry')
    n=geo.outputs['True Normal']
    axes=node('ShaderNodeSeparateXYZ')
    put(axes.inputs[0],n)
    tint=np.asarray(palette['mapTints'][map_id])
    wall=(*np.asarray(palette['layers'][0])*tint,1)
    floor=(*np.asarray(palette['layers'][4])*tint,1)
    base=mix(ramp(axes.outputs['Z'],.65,.92,'Slope to floor'),wall,floor,'Wall and floor coat')
    coat=node('ShaderNodeGroup','Neutral masonry')
    coat.node_tree=rules
    put(coat.inputs['Source pigment'],source)
    put(coat.inputs['Face normal'],n)
    put(coat.inputs['Coating pigment'],base)
    put(emit.inputs['Color'],mix(math('MULTIPLY',weight,.84),source,coat.outputs[0],'Preserve original accent pigments'))
    levels,rows={},{}
    def column(n):
        if n.name not in levels:
            levels[n.name]=1+max((column(e.from_node) for s in n.inputs for e in s.links),default=-1)
        return levels[n.name]
    for n in tree.nodes:
        x=column(n)
        row=rows.get(x,0)
        rows[x]=row+1
        n.location=(x*230,-row*270)

def bind_panorama(scene,map_id):
    # Existing game panorama in the world shader. For a Blender ray (X,Y,Z),
    # the game uses (X,Z,-Y), with its texture origin at the top, not bottom.
    world=scene.world
    world.use_nodes=True
    tree=world.node_tree
    tree.nodes.clear()
    def node(kind,x,y,label):
        n=tree.nodes.new(kind)
        n.label=label
        n.location=(x,y)
        return n
    def math(op,x,y,a,b=None,c=None):
        n=node('ShaderNodeMath',x,y,'')
        n.operation=op
        for i,value in enumerate([a,b,c]):
            if value is None: continue
            if isinstance(value,bpy.types.NodeSocket): tree.links.new(value,n.inputs[i])
            else: n.inputs[i].default_value=value
        return n.outputs[0]
    direction=node('ShaderNodeTexCoord',0,0,'World ray')
    norm=node('ShaderNodeVectorMath',180,0,'Unit ray')
    norm.operation='NORMALIZE'
    tree.links.new(direction.outputs['Generated'],norm.inputs[0])
    sep=node('ShaderNodeSeparateXYZ',380,0,'Z-up world')
    tree.links.new(norm.outputs[0],sep.inputs[0])
    x,y,z=sep.outputs
    yaw=json.loads((CLIENT.parent/'shared/performance-skies.json').read_bytes())[map_id]['yaw']
    angle=math('ARCTAN2',750,150,math('MULTIPLY',550,150,y,-1),x)
    u=math('MULTIPLY_ADD',930,140,angle,1/(2*np.pi),yaw/360)
    v=math('MULTIPLY_ADD',930,-100,math('ARCSINE',730,-100,z),1/np.pi,.5)
    uv=node('ShaderNodeCombineXYZ',1130,60,'Panorama coordinates')
    tree.links.new(u,uv.inputs[0])
    tree.links.new(v,uv.inputs[1])
    tex=node('ShaderNodeTexImage',1320,60,map_id+' panorama')
    tex.image=bpy.data.images.load(str(CLIENT/'flat-skies'/(map_id+'.webp')))
    tex.image.pack()
    tree.links.new(uv.outputs[0],tex.inputs['Vector'])
    bg=node('ShaderNodeBackground',1570,60,'Game sky')
    tree.links.new(tex.outputs['Color'],bg.inputs['Color'])
    out=node('ShaderNodeOutputWorld',1800,60,'World')
    tree.links.new(bg.outputs[0],out.inputs['Surface'])

def create(src,output,library,entries,palette):
    bpy.ops.wm.open_mainfile(filepath=str(src.resolve()),load_ui=False)
    bpy.context.preferences.filepaths.save_version=0
    scene=bpy.context.scene
    identity=signature(scene)
    map_id=src.stem
    names=[r[0] for r,_ in entries]
    with bpy.data.libraries.load(str(library.resolve()),link=False) as (source,target):
        target.node_groups=['Finish / '+name for name in names]
        if not set(target.node_groups).issubset(source.node_groups):
            raise ValueError('Incomplete material library')
    rules=coating_group(palette)
    local=previous['read_pack'](map_id)
    steel,wood,plaster,brick=previous['read_pack']('shared')
    old_names=[e[0][0] for e in [local[0],steel,wood,plaster,local[1],brick]]
    for i, ((recipe,pixels),group,old_name) in enumerate(zip(entries,target.node_groups,old_names)):
        mat=previous['finish_material'](recipe,pixels,group,1)  # all six finishes use axis-aligned projection
        tree=mat.node_tree
        emission=next(n for n in tree.nodes if n.type=='EMISSION')
        output_color=emission.inputs['Color'].links[0].from_node
        pigment=next(n for n in tree.nodes if n.type=='VERTEX_COLOR')
        geo=next(n for n in tree.nodes if n.type=='NEW_GEOMETRY')
        coat=tree.nodes.new('ShaderNodeGroup')
        coat.node_tree=rules
        coat.location=(1000,590)
        coat.label='Arena coating / palette and lighting'
        tree.links.new(pigment.outputs['Color'],coat.inputs['Source pigment'])
        tree.links.new(geo.outputs['True Normal'],coat.inputs['Face normal'])
        base=np.asarray(palette['layers'][i])*palette['mapTints'][map_id]
        coat.inputs['Coating pigment'].default_value=base
        tree.links.new(coat.outputs[0],output_color.inputs[0])
        author=next(n for n in tree.nodes if n.type=='GROUP' and n!=coat)
        author.label='Editable surface / bake-arena-finishes.py'
        mat.diffuse_color=(*base,1)
        mat.use_fake_user=True
        old=bpy.data.materials.get(old_name)
        if old:
            old.user_remap(mat)
            bpy.data.materials.remove(old)
        old_group=bpy.data.node_groups.get("Finish / "+old_name)
        if old_group: old_group.use_fake_user=False
    assign_neutral(rules,palette,map_id)
    bind_panorama(scene,map_id)
    scene['architectural_finishes']=', '.join(names)
    scene['material_design']='Arena / baked matte panels'
    if signature(scene)!=identity:
        raise ValueError('Geometry changed before saving '+map_id)
    bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
    out=output/'scenes'/src.name
    bpy.ops.wm.save_as_mainfile(filepath=str(out.resolve()),compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(out.resolve()),load_ui=False)
    if signature(bpy.context.scene)!=identity:
        raise ValueError('Saved mesh differs '+map_id)
    for (name,_,_),pixels in entries:
        im=bpy.data.images[name+' / R8']
        if not im.packed_file or tuple(im.size)!=pixels.shape[::-1]: raise ValueError(name)
        rgba=np.empty((pixels.size,4),np.float32)
        im.pixels.foreach_get(rgba.ravel())
        if not np.array_equal(np.rint(rgba[:,0]*255).astype('u1'),pixels.ravel()):
            raise ValueError('Packed tile differs '+name)
        mat=bpy.data.materials[name]
        if not any(n.type=='GROUP' and n.node_tree.name=='Finish / '+name for n in mat.node_tree.nodes):
            raise ValueError('Missing editable source '+name)
    missing=[im.name for im in bpy.data.images if im.source in ('FILE','TILED') and not im.packed_file]
    if missing or not bpy.context.scene.objects.get('World bombsite stencils'):
        raise ValueError(('Incomplete assets',missing,map_id))
    print('REOPENED',map_id,identity['renderTriangles'],identity['meshSha256'],flush=True)
    return {**identity,'packedAtlasLayers':len(entries)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path)
    p.add_argument('out',type=Path)
    p.add_argument('--maps-v1',type=Path,help='Build each source .blend from these final web meshes first')
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
    if args.source.resolve()==(args.out/'scenes').resolve(): raise ValueError('source must stay independent')
    (args.out/'scenes').mkdir(exist_ok=True,parents=True)
    palette=json.loads((CLIENT/'arena-finishes/palette.json').read_bytes())
    entries=unpack(CLIENT/'arena-finishes/shared.js')
    report={}
    with TemporaryDirectory(prefix='scene-work-',dir=args.out) as temporary:
        staging=Path(temporary)
        if args.maps_v1:
            build=runpy.run_path(str(SCRIPTS/'blender-crisp-geometry.py'))['create_scene']
            shutil.copy2(args.source.parent/'Map-Finishes.blend',staging/'Map-Finishes.blend')
        for map_id in palette['mapTints']:
            if args.maps_v1:
                build(args.maps_v1/map_id,staging)
                scene_file=staging/'scenes'/(map_id+'.blend')
            else:
                scene_file=args.source/(map_id+'.blend')
            report[map_id]=create(scene_file,args.out,args.out/'Surface-Library.blend',entries,palette)
            if args.maps_v1:
                scene_file.unlink()
    (args.out/'scene-audit.json').write_text(json.dumps(report,indent=2),'utf8')
    print('VERIFIED',len(report),'complete Blender maps',sum(e['renderTriangles'] for e in report.values()),flush=True)

if __name__=='__main__':
    main()

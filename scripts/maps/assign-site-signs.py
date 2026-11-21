"""Project A/B paint on existing static architecture in the editable Blender scenes."""
from pathlib import Path
import json
import numpy as np
import bpy

CLIENT=Path(__file__).resolve().parents[2]/'client'

def blender_vector(v):
    x,y,z=v
    return [float(x),-float(z),float(y)]

def sign_group(map_id,record,img):
    tree=bpy.data.node_groups.new('Site lettering / '+map_id,'ShaderNodeTree')
    tree.interface.new_socket(name='Surface pigment',in_out='INPUT',socket_type='NodeSocketColor')
    tree.interface.new_socket(name='Printed pigment',in_out='OUTPUT',socket_type='NodeSocketColor')
    def node(kind,x,y,label=''):
        a=tree.nodes.new(kind);a.location=(x,y);a.label=label;return a
    def put(target,value):
        if isinstance(value,bpy.types.NodeSocket):tree.links.new(value,target)
        else:target.default_value=value
    src=node('NodeGroupInput',-1150,480)
    dest=node('NodeGroupOutput',1160,440)
    geo=node('ShaderNodeNewGeometry',-1150,100)
    def vec(op,a,b,x,y):
        q=node('ShaderNodeVectorMath',x,y)
        q.operation=op;put(q.inputs[0],a);put(q.inputs[1],b)
        return q.outputs['Value' if op=='DOT_PRODUCT' else 'Vector']
    def scalar(op,a,b,x,y):
        q=node('ShaderNodeMath',x,y);q.operation=op
        put(q.inputs[0],a);put(q.inputs[1],b);return q.outputs[0]
    color=src.outputs[0]
    for idx,letter in enumerate('AB'):
        s=record[letter];n=np.array(s['normal'])
        right=np.cross([0.,1.,0.],n);right/=np.linalg.norm(right);up=np.cross(n,right)
        oy=-idx*1150
        p=vec('SUBTRACT',geo.outputs['Position'],blender_vector(s['center']),-940,oy)
        normal=blender_vector(n)
        gap=vec('DOT_PRODUCT',p,normal,-730,oy+120)
        gate=scalar('LESS_THAN',scalar('ABSOLUTE',gap,0,-540,oy+120),s.get('depth',.032),-350,oy+120)
        slope=vec('DOT_PRODUCT',geo.outputs['True Normal'],normal,-730,oy-45)
        face=scalar('GREATER_THAN',scalar('ABSOLUTE',slope,0,-540,oy-45),.96,-350,oy-45)
        gate=scalar('MULTIPLY',gate,face,-160,oy+80)
        gaze=vec('DOT_PRODUCT',geo.outputs['Incoming'],normal,-730,oy-210)
        facing=scalar('GREATER_THAN',gaze,0,-340,oy-205)
        gate=scalar('MULTIPLY',gate,facing,10,oy+110)
        uv=node('ShaderNodeCombineXYZ',200,oy-435)
        inside=[]
        for axis,v in enumerate([right,up]):
            y=oy-430-axis*305
            extent=s['size'] if axis==0 else s.get('height',s['size'])
            coord=vec('DOT_PRODUCT',p,blender_vector(v),-730,y)
            inside.append(scalar('LESS_THAN',scalar('ABSOLUTE',coord,0,-530,y+100),extent/2,-340,y+100))
            # Single 1024 atlas, lower row in Blender UV holds the opaque wall chips.
            tex=scalar('MULTIPLY',coord,.5/extent*511/512,-530,y-60)
            tex=scalar('ADD',tex,.25+(idx*.5 if axis==0 else 0),-320,y-45)
            tree.links.new(tex,uv.inputs[axis])
        mask=scalar('MULTIPLY',inside[0],inside[1],-5,oy-115)
        gate=scalar('MULTIPLY',gate,mask,185,oy+110)
        tex=node('ShaderNodeTexImage',395,oy-280,letter+' sign · packed artwork')
        tex.image=img;tex.extension='CLIP';tex.interpolation='Linear'
        tree.links.new(uv.outputs[0],tex.inputs['Vector'])
        alpha=scalar('MULTIPLY',gate,tex.outputs['Alpha'],610,oy+100)
        mix=node('ShaderNodeMixRGB',840,oy+160)
        put(mix.inputs[0],alpha);put(mix.inputs[1],color);put(mix.inputs[2],tex.outputs['Color'])
        color=mix.outputs[0]
    tree.links.new(color,dest.inputs[0])
    return tree

def bind_site_signs(scene,map_id):
    record=json.loads((CLIENT/'wall-site-signs.json').read_bytes())[map_id]
    if 'A' not in record:
        return
    existing=scene.objects.get('World bombsite stencils')
    image=None
    if existing:
        image=next((n.image for n in existing.active_material.node_tree.nodes if n.type=='TEX_IMAGE'),None)
    if image is None:
        image=bpy.data.images.load(str(CLIENT/'flat-site-stencils.png'),check_existing=True)
    image.pack()
    group=sign_group(map_id,record,image)
    # Only the material slots used on static tiles receive prints. Separate users
    # of a shared material (e.g. an interactive door) keep their original material.
    variants={}
    for obj in scene.objects:
        if obj.type!='MESH' or not obj.name.startswith('tile_'):continue
        for slot in obj.material_slots:
            mat=slot.material
            if mat is None or not mat.use_nodes:continue
            if mat not in variants:
                clone=mat.copy()
                clone.name=mat.name+' / site lettering'
                tree=clone.node_tree
                for emit in [n for n in tree.nodes if n.type=='EMISSION']:
                    inp=emit.inputs['Color']
                    ink=tree.nodes.new('ShaderNodeGroup')
                    ink.node_tree=group;ink.location=(emit.location.x-220,emit.location.y-240)
                    if inp.is_linked:tree.links.new(inp.links[0].from_socket,ink.inputs[0])
                    else:ink.inputs[0].default_value=inp.default_value
                    tree.links.new(ink.outputs[0],inp)
                variants[mat]=clone
            slot.material=variants[mat]
    scene['projected_site_signs']=2

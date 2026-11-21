"""Flatten the light baked into exported CS2 pigments, then apply architectural paint.

Blender -b -P scripts/maps/author-plane-finishes.py -- profile SOURCE_SCENES OUTPUT_DIR
Blender -b -P scripts/maps/bake-arena-finishes.py -- OUTPUT_DIR/Surface-Library.blend
Blender -b -P scripts/maps/author-plane-finishes.py -- scenes SOURCE_SCENES OUTPUT_DIR

SOURCE_SCENES contains the nine complete editable performance maps with their COLOR_0
samples and named finish slots. The profile stage reads the sampled source-map colour,
weighted by architectural face area (not vertex density). It writes the small calibration
table used by both this authoring graph and the live shader. No Valve map is bundled.
"""
from pathlib import Path
import argparse
import base64
import gzip
import hashlib
import json
import runpy
import sys

import bpy
import numpy as np

SCRIPTS = Path(__file__).resolve().parent
CLIENT = SCRIPTS.parents[1] / 'client'
PALETTE = json.loads((CLIENT / 'arena-finishes/palette.json').read_bytes())
PROFILE = CLIENT / 'plane-finishes.json'
NAMES = ('Enamel composite panel', 'Satin powder coat', 'Sealed ash cleat',
         'Ceramic skim coat', 'Cast rubber paver', 'Mineral facing unit')
LUMA = np.asarray(PALETTE['sourceLuma'])


def profile(scene):
    # Inputs are sampled albedo/lighting from the visible map, stored in linear RGB.
    histogram = np.zeros((7, 256), dtype=np.float64)
    neutral = 'Map pigment / retained source lighting'
    for obj in scene.objects:
        if obj.type != 'MESH' or not obj.name.startswith('tile_'):
            continue
        mesh = obj.data
        colors = mesh.color_attributes.get('COLOR_0')
        if not colors:
            continue
        mesh.calc_loop_triangles()
        count = len(mesh.loop_triangles)
        vertices = np.empty((count, 3), np.int32)
        slots = np.empty(count, np.int32)
        area = np.empty(count, np.float32)
        rgba = np.empty((len(colors.data), 4), np.float32)
        mesh.loop_triangles.foreach_get('vertices', vertices.ravel())
        mesh.loop_triangles.foreach_get('material_index', slots)
        mesh.loop_triangles.foreach_get('area', area)
        colors.data.foreach_get('color', rgba.ravel())
        y = rgba[:, :3] @ LUMA
        for i, mat in enumerate(mesh.materials):
            if mat and mat.name in (*NAMES, neutral):
                ix = slots == i
                if not ix.any():
                    continue
                role = NAMES.index(mat.name) if mat.name in NAMES else 6
                value = np.rint(np.clip(y[vertices[ix]],0,1)*255).astype(np.int32)
                weight = np.repeat(area[ix].astype('f8')/3,3)
                histogram[role] += np.bincount(value.ravel(), weights=weight, minlength=256)
    if not histogram.sum():
        raise ValueError('Missing tagged source pigments')
    cuts = []
    for h in histogram:
        if h.sum() < 1.0:
            h = histogram.sum(axis=0)
        mass = np.cumsum(h)/h.sum()
        deep, lit = np.searchsorted(mass,[.08,.32])/255.
        deep = np.clip(deep,.026,.15)
        lit = np.clip(lit,max(.125,deep+.060),.37)
        cuts.append([round(float(deep),5),round(float(lit),5)])
    return cuts, histogram


class Graph:
    def __init__(self, tree):
        self.tree=tree

    def node(self, kind, label):
        n=self.tree.nodes.new(kind)
        n.label=label
        return n

    def put(self, socket, value):
        if isinstance(value,bpy.types.NodeSocket):
            self.tree.links.new(value,socket)
        else:
            socket.default_value=value

    def op(self, operation, *args, label=''):
        n=self.node('ShaderNodeMath',label)
        n.operation=operation
        for socket,arg in zip(n.inputs,args): self.put(socket,arg)
        return n.outputs[0]

    def vec(self, operation, a, b, label=''):
        n=self.node('ShaderNodeVectorMath',label)
        n.operation=operation
        self.put(n.inputs[0],a)
        self.put(n.inputs['Scale' if operation=='SCALE' else 1],b)
        return n.outputs['Value' if operation=='DOT_PRODUCT' else 'Vector']

    def smooth(self, value, low, high, label):
        n=self.node('ShaderNodeMapRange',label)
        n.interpolation_type='SMOOTHSTEP'
        for name,arg in [('Value',value),('From Min',low),('From Max',high)]:
            self.put(n.inputs[name],arg)
        return n.outputs[0]

    def mix(self, weight, a, b, label):
        n=self.node('ShaderNodeMixRGB',label)
        for i,x in enumerate([weight,a,b]): self.put(n.inputs[i],x)
        return n.outputs[0]


def arrange(tree):
    levels={}
    def depth(n):
        if n.name not in levels:
            levels[n.name]=1+max((depth(l.from_node) for s in n.inputs for l in s.links),default=-1)
        return levels[n.name]
    height={}
    for n in tree.nodes:
        k=depth(n)
        row=height.get(k,0)
        n.location=(k*240,-row*260)
        height[k]=row+1


def plane_group():
    tree=bpy.data.node_groups.new('Architectural paint / source plate and pigments','ShaderNodeTree')
    for name in ['Source pigment','Coating pigment','Face normal']:
        tree.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketVector')
    for name in ['Deep pigment','Lit pigment']:
        tree.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')
    for name,kind in [('Color','NodeSocketColor'),('Flattened source','NodeSocketFloat')]:
        tree.interface.new_socket(name=name,in_out='OUTPUT',socket_type=kind)
    g=Graph(tree)
    inp=g.node('NodeGroupInput','Baked source, paint and two material thresholds')
    s=inp.outputs
    y=g.vec('DOT_PRODUCT',s['Source pigment'],PALETTE['sourceLuma'],'Source-map luminance')
    deep=s['Deep pigment']; lit=s['Lit pigment']
    shade=g.smooth(y,g.op('MULTIPLY',deep,.73),g.op('MULTIPLY',deep,1.13),'Dark source edge')
    mid=g.smooth(y,g.op('MULTIPLY',lit,.81),g.op('MULTIPLY',lit,1.10),'Middle source edge')
    # The lit plateau is exactly constant: the slope of a rounded highlight cannot
    # survive this stage. Only the two transitions contain a soft shoulder.
    flat=g.op('MULTIPLY_ADD',mid,.15,g.op('MULTIPLY_ADD',shade,.24,.61),label='Source plate / shadow, half-tone, lit')
    sep=g.node('ShaderNodeSeparateXYZ','Pigment channels')
    g.put(sep.inputs[0],s['Source pigment'])
    r,green,b=sep.outputs
    hi=g.op('MAXIMUM',r,g.op('MAXIMUM',green,b)); lo=g.op('MINIMUM',r,g.op('MINIMUM',green,b))
    sat=g.op('DIVIDE',g.op('SUBTRACT',hi,lo),g.op('MAXIMUM',hi,.08))
    accent=g.op('MULTIPLY',.72,g.op('MULTIPLY',g.smooth(sat,.35,.74,'Landmark saturation'),
                                     g.smooth(y,.035,.13,'Keep dark lettering')))
    hue=g.vec('SCALE',s['Source pigment'],g.op('DIVIDE',.68,g.op('MAXIMUM',hi,.08)),'Level accent colour')
    paint=g.mix(accent,s['Coating pigment'],hue,'Second stage / flat architectural paint')
    k=np.asarray(PALETTE['keyDirection'])
    k/=np.linalg.norm(k)
    dot=g.vec('DOT_PRODUCT',s['Face normal'],(k[0],-k[2],k[1]),'Plane orientation')
    side=g.op('MULTIPLY_ADD',g.smooth(dot,-.50,-.10,'Shaded plane'),.17,.75)
    side=g.op('MULTIPLY_ADD',g.smooth(dot,.33,.71,'Lit plane'),.12,side)
    axes=g.node('ShaderNodeSeparateXYZ','Face direction')
    g.put(axes.inputs[0],s['Face normal'])
    side=g.op('MULTIPLY_ADD',axes.outputs['Z'],.075,side)
    out=g.node('NodeGroupOutput','Painted surface and source proof')
    g.put(out.inputs['Color'],g.vec('SCALE',paint,g.op('MULTIPLY',flat,side),'Painted plane'))
    g.put(out.inputs['Flattened source'],flat)
    arrange(tree)
    return tree


def levels_atlas():
    # Compact ES-module format produced by the Blender bake stage.
    lines=(CLIENT/'arena-finishes/shared.js').read_text().splitlines()
    values={n:json.loads(v[:-1]) for line in lines if line.startswith('export const ')
            for n,v in [line[len('export const '):].split('=',1)]}
    levels=np.cumsum(np.frombuffer(gzip.decompress(base64.b64decode(values['packed'])),np.uint8)
                     .reshape(len(NAMES),values['side'],values['side']),axis=2,dtype=np.uint8)
    assert hashlib.sha256(levels.tobytes()).hexdigest()==values['sha256']
    return np.rint(levels.astype('f4')*(255/63)).astype('u1')


def topology(scene):
    h=hashlib.sha256()
    for obj in sorted(scene.objects,key=lambda o:o.name):
        if obj.type!='MESH': continue
        mesh=obj.data
        pos=np.empty((len(mesh.vertices),3),'<f4')
        ids=np.empty(len(mesh.loops),'<i4')
        mesh.vertices.foreach_get('co',pos.ravel())
        mesh.loops.foreach_get('vertex_index',ids)
        h.update(obj.name.encode()); h.update(np.asarray(obj.matrix_world,'<f4').tobytes())
        h.update(pos.tobytes()); h.update(ids.tobytes())
    return h.hexdigest()


def bind(scene, map_id, out, cuts, atlas, site_binder):
    # Preserve the previous full-map file, materials, UV mapping, world and operators.
    new=plane_group()
    with bpy.data.libraries.load(str((out/'Surface-Library.blend').resolve()),link=False) as (src,dst):
        dst.node_groups=['Finish / '+name for name in NAMES]
    for i,name in enumerate([*NAMES,'Map pigment / retained source lighting']):
        m=bpy.data.materials[name]
        tree=m.node_tree
        coat=next(n for n in tree.nodes if n.type=='GROUP' and n.node_tree.name.startswith('Arena / matte'))
        links={key:coat.inputs[key].links[0].from_socket for key in ['Source pigment','Face normal']}
        base=coat.inputs['Coating pigment']
        if base.is_linked: links['Coating pigment']=base.links[0].from_socket
        default=tuple(base.default_value)
        target=coat.outputs['Color'].links[0].to_socket
        coat.node_tree=new
        coat.label='Flatten source illumination, then apply paint'
        for k,v in links.items(): tree.links.new(v,coat.inputs[k])
        if 'Coating pigment' not in links: coat.inputs['Coating pigment'].default_value=default
        coat.inputs['Deep pigment'].default_value=cuts[i][0]
        coat.inputs['Lit pigment'].default_value=cuts[i][1]
        tree.links.new(coat.outputs['Color'],target)
        if i==len(NAMES): continue
        tex=next(n.image for n in tree.nodes if n.type=='TEX_IMAGE')
        # Replace the previous grain in place; Blender stores values in linear space.
        rgba=np.ones((*atlas[i].shape,4),np.float32)
        rgba[:,:,:3]=(atlas[i].astype('f4')/255)[:,:,None]
        tex.pixels.foreach_set(rgba.ravel())
        tex.pack()
        author=next(n for n in tree.nodes if n.type=='GROUP' and n!=coat)
        prev_group=author.node_tree
        author.node_tree=dst.node_groups[i]
        prev_group.use_fake_user=False
        author.label='Editable flat sheet joints'
    stencil=scene.objects['World bombsite stencils']
    image=next(n.image for n in stencil.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
    new_image=bpy.data.images.load(str((CLIENT/'flat-site-stencils.png').resolve()),check_existing=False)
    new_image.pack()
    image.user_remap(new_image); bpy.data.images.remove(image); new_image.name='flat-site-stencils.png'
    # Migrate the former 192-pixel quadrant inset while retaining all clipped sign UVs.
    uv=stencil.data.uv_layers.active.data
    coords=np.empty((len(uv),2),np.float32); uv.foreach_get('uv',coords.ravel())
    cells=np.floor(coords*2)
    x=((coords*2-cells)*192-.5)/191
    edge=new_image.size[0]/2
    coords=(cells+(.5+(edge-1)*x)/edge)*.5
    uv.foreach_set('uv',np.ascontiguousarray(coords,dtype=np.float32).ravel())
    site_binder(scene,map_id)
    scene['material_design']='Planar source-light plates / architectural paint'
    return new_image


def make_portable(scene):
    for lib in list(bpy.data.libraries):
        if not bpy.data.user_map(subset={lib})[lib]:
            bpy.data.libraries.remove(lib)
    if bpy.data.libraries or bpy.data.texts:
        raise ValueError('Unexpected linked data: '+str([(x.name,x.users) for x in [*bpy.data.libraries,*bpy.data.texts]]))
    scene.render.filepath='//render/'
    for image in bpy.data.images:
        if not image.packed_file:
            raise ValueError('Unpacked map image '+image.name)
        if image.filepath:
            image.filepath='//'+Path(image.filepath).name
        for packed in image.packed_files:
            if packed.filepath:
                packed.filepath='//'+Path(packed.filepath).name
    for group in bpy.data.node_groups:
        ref=group.library_weak_reference
        if ref:
            ref.filepath='//../Surface-Library.blend'
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type=='FILE_BROWSER' and space.params:
                    space.params.directory=b'//'
    if any(':' in p or p.startswith('\\') for p in bpy.utils.blend_paths(packed=True)):
        raise ValueError('Absolute dependency path in map')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['profile','scenes'])
    parser.add_argument('source',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--maps',nargs='+',choices=PALETTE['mapTints'])
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    args.output.mkdir(parents=True,exist_ok=True)
    maps=args.maps or list(PALETTE['mapTints'])
    if args.stage=='profile':
        if args.maps: raise ValueError('The shared profile needs all nine maps')
        records={}; evidence={}
        for map_id in maps:
            bpy.ops.wm.open_mainfile(filepath=str((args.source/(map_id+'.blend')).resolve()),load_ui=False)
            records[map_id],hist=profile(bpy.context.scene)
            evidence[map_id]=hist.tolist()
        PROFILE.write_text(json.dumps(records,indent=2)+'\n','utf8')
        (args.output/'source-area-histograms.json').write_text(json.dumps(evidence),'utf8')
        print('PROFILE',len(records),sum(sum(map(sum, vv)) for vv in evidence.values()),flush=True)
        return
    records=json.loads(PROFILE.read_bytes())
    atlas=levels_atlas()
    site_binder=runpy.run_path(str(SCRIPTS/'assign-site-signs.py'))['bind_site_signs']
    (args.output/'scenes').mkdir(exist_ok=True)
    proof={}
    for map_id in maps:
        bpy.ops.wm.open_mainfile(filepath=str((args.source/(map_id+'.blend')).resolve()),load_ui=False)
        bpy.context.preferences.filepaths.save_version=0
        scene=bpy.context.scene; identity=topology(scene)
        stencil=bind(scene,map_id,args.output,records[map_id],atlas,site_binder)
        sign_sha=hashlib.sha256(bytes(stencil.packed_file.data)).hexdigest()
        bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
        make_portable(scene)
        out=args.output/'scenes'/(map_id+'.blend')
        bpy.ops.wm.save_as_mainfile(filepath=str(out.resolve()),compress=True,relative_remap=False)
        bpy.ops.wm.open_mainfile(filepath=str(out.resolve()),load_ui=False)
        if topology(bpy.context.scene)!=identity: raise ValueError('Geometry changed')
        for i,name in enumerate(NAMES):
            image=bpy.data.images[name+' / R8']
            pix=np.empty((atlas[i].size,4),np.float32)
            image.pixels.foreach_get(pix.ravel())
            if not image.packed_file or not np.array_equal(np.rint(pix[:,0]*255).astype('u1'),atlas[i].ravel()):
                raise ValueError(name+' tile changed on reopen')
        if sign_sha!=hashlib.sha256((CLIENT/'flat-site-stencils.png').read_bytes()).hexdigest():
            raise ValueError('Packed site artwork differs')
        proof[map_id]=dict(topology=identity,renderTriangles=bpy.context.scene['render_triangles'],
                           packedSiteArt=sign_sha,packedLayers=len(atlas))
        print('CHECKED',map_id,proof[map_id],flush=True)
    (args.output/'scene-audit.json').write_text(json.dumps(proof,indent=2),'utf8')


if __name__=='__main__': main()

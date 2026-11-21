import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {disabledBrushModels,sourceBrushHidden} from '../scripts/maps/source-brush-visibility.mjs';

// A single wall-sized sign is enough to catch an alpha sheet replacing the actual glyph.
test('low-poly conversion preserves transparent sign openings and uses named paint for incomplete Valve exports', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'visible-world-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const positions=new Float32Array([0,0,0, 4,0,0, 0,4,0, 4,4,0]);
  const uv=new Float32Array([0,0,1,0,0,1,1,1]);
  const indices=new Uint16Array([0,1,2,2,1,3]);
  const chunks=[positions,uv,indices].map(a=>Buffer.from(a.buffer));
  fs.writeFileSync(path.join(root,'source.bin'),Buffer.concat(chunks));
  let byteOffset=0;
  const views=chunks.map(data=>{
    const view={buffer:0,byteOffset,byteLength:data.length};
    byteOffset+=data.length;return view;
  });
  const materials=[
    {name:'bombsite_letter_a',alphaMode:'BLEND',pbrMetallicRoughness:{baseColorTexture:{index:0}}},
    {name:'materials/train/rough_timber.vmat'},
    {name:'materials/train/powdercoat_blue.vmat'},
    {name:'materials/decals/rain_stain.vmat'},
    {name:'chainlink_fence_wire_001',alphaMode:'MASK',pbrMetallicRoughness:{baseColorTexture:{index:1}}},
    {name:'chainlink_fence_001'},
    {name:'concrete_wall'},
    {name:'scuffs_overlay_001',extras:{vmat:{ShaderName:'csgo_static_overlay.vfx',IntParams:{F_BLEND_MODE:3}}},
      pbrMetallicRoughness:{baseColorTexture:{index:0}}},
    {name:'bombsite_letter_b',extras:{vmat:{ShaderName:'csgo_static_overlay.vfx',IntParams:{F_BLEND_MODE:1}}},
      pbrMetallicRoughness:{baseColorTexture:{index:0}}},
    {name:'metal_window_bars',alphaMode:'MASK',pbrMetallicRoughness:{baseColorTexture:{index:0}}},
    {name:'grass_01',alphaMode:'MASK',extras:{vmat:{ShaderName:'csgo_foliage.vfx'}},
      pbrMetallicRoughness:{baseColorTexture:{index:0}}},
    {name:'nuke_floor_arrow_straight',extras:{vmat:{ShaderName:'csgo_static_overlay.vfx',IntParams:{F_BLEND_MODE:3}}},
      pbrMetallicRoughness:{baseColorTexture:{index:0}}},
  ];
  const source={scene:0,scenes:[{nodes:materials.map((_,index)=>index)}],
    nodes:materials.map((_,index)=>({name:index===6?'brush_blocker_2_15.hammer_mesh_0':'wall',mesh:index,translation:[index*24,0,0]})),
    meshes:materials.map((_,material)=>({primitives:[{material,attributes:{POSITION:0,TEXCOORD_0:1},indices:2}]})),
    materials,images:[{uri:'sign.png'},{uri:'wire.png'}],textures:[{source:0},{source:1}],
    buffers:[{uri:'source.bin',byteLength:byteOffset}],bufferViews:views,
    accessors:[
      {bufferView:0,count:4,type:'VEC3',componentType:5126,min:[0,0,0],max:[4,4,0]},
      {bufferView:1,count:4,type:'VEC2',componentType:5126},
      {bufferView:2,count:6,type:'SCALAR',componentType:5123},
    ]};
  // Thin chain links vanish from the downsampled second alpha image. Their actual
  // source sheet still has to reach the separately tagged procedural material.
  const mask=Buffer.alloc(2*8*8*4);
  for(let y=0;y<8;y++)for(let x=2;x<6;x++){const p=4*(y*8+x);mask[p]=200;mask[p+3]=255;}
  const docPath=path.join(root,'source.gltf'),maskPath=path.join(root,'mask.rgba');
  fs.writeFileSync(docPath,JSON.stringify(source));fs.writeFileSync(maskPath,mask);
  const tool=fileURLToPath(new URL('../scripts/maps/visible-lowpoly.mjs',import.meta.url));
  const entityPath=path.join(root,'entities.txt');
  fs.writeFileSync(entityPath,'====1====\nclassname "func_brush"\ntargetname "[PR#]brush.blocker"\nstartdisabled true\nmodel resource_name:"maps/de_test/entities/brush_blocker_2_15.vmdl"');
  const paintMask=path.join(root,'floor-paint.json');
  fs.writeFileSync(paintMask,JSON.stringify({11:[[.45,0,.47,1,255,255,255]]}));
  execFileSync(process.execPath,[tool,docPath,root,'de_test',maskPath,'8','1000',entityPath,paintMask]);
  const output=JSON.parse(fs.readFileSync(path.join(root,'render/map.gltf')));
  const data=fs.readFileSync(path.join(root,'render/map.bin'));
  assert.equal(output.extras.filteredPrimitives,3);
  assert.ok(output.extras.apertureTriangles>0);
  assert.equal(output.extras.hiddenBrushNodes,1);
  assert.equal(output.images,undefined);
  const cells=output.meshes.map(mesh=>{
    const {attributes}=mesh.primitives[0],a=output.accessors[attributes.POSITION],c=output.accessors[attributes.COLOR_0];
    return {min:a.min[0],max:a.max[0],color:[...data.subarray(output.bufferViews[c.bufferView].byteOffset,output.bufferViews[c.bufferView].byteOffset+3)]};
  }).sort((a,b)=>a.min-b.min);
  assert.equal(cells.length,8);
  assert.ok(cells[0].min>.75 && cells[0].min<1 && cells[0].max>3 && cells[0].max<3.25,
    'bilinear alpha intersections leave the transparent borders open');
  assert.ok(cells[1].color[0]>cells[1].color[2],'wood keeps a warm tint');
  assert.ok(cells[2].color[0]<cells[2].color[2],'blue-painted component keeps a distinct industrial tint');
  const nets=output.nodes.filter(n=>n.name.startsWith('fence_tile_'));
  assert.equal(nets.length,1);
  const wire=output.meshes[nets[0].mesh].primitives[0];
  assert.equal(output.materials[wire.material].extras.performanceFence,true);
  assert.equal(output.accessors[wire.indices].count,6);
  const frame=output.nodes.find(n=>n.name==='tile_5_0');
  assert.equal(output.meshes[frame.mesh].primitives[0].material,0);
  assert.ok(cells[5].min>192.75 && cells[5].max<195.25,'the Valve overlay keeps the cutout even without glTF BLEND');
  assert.ok(cells[6].min>216.75 && cells[6].max<219.25,'structural cutouts keep their solid bars and the clear space beside them');
  assert.ok(Math.abs(cells[7].min-265.8)<.001 && Math.abs(cells[7].max-265.88)<.001,
    'a line thinner than one thumbnail pixel is clipped to its original strip across both source triangles');
});

test('the low-poly map respects disabled Source brush identity without hiding a visible non-solid prop or a live sibling',()=>{
  function record(model,classname,state,other='',target='[PR#]brush.blocker.a') {
    return 'targetname "'+target+'"\nclassname "'+classname+'"\nmodel resource_name:"maps/de_vertigo/entities/'+model+'.vmdl"\nstartdisabled '+state+'\n'+other;
  }
  const dump=[
   record('brush_blocker_b_2_31158','func_brush','true'),
   record('brush_blocker_b_2_311580','func_brush','false'),
   record('visible_panel','func_brush','false','solidity "1"'),
   record('shared_panel','func_brush','true'),record('shared_panel','func_brush','false'),
   record('prop','prop_dynamic','true'),record('interactive_door','func_brush','true','','door'),
   record('runtime','func_brush','true','','[PR#]brush.blocker.b'),
   '@OnPressed Delay=1 Enable [PR#]brush.blocker.b',
  ].map((record,i)=>'===='+i+'====\n'+record).join('\n');
  const disabled=disabledBrushModels(dump,'de_vertigo');
  assert.deepEqual([...disabled],['brush_blocker_b_2_31158']);
  assert.ok(sourceBrushHidden('brush_blocker_b_2_31158.hammer_mesh_01', disabled));
  assert.equal(sourceBrushHidden('brush_blocker_b_2_311580.hammer_mesh_0',disabled),false);
  assert.equal(sourceBrushHidden('visible_panel.hammer_mesh_0',disabled),false);
  assert.equal(disabledBrushModels(dump,'de_mirage').size,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Group,Mesh,MeshBasicMaterial,Texture} from 'three';
import sites from '../client/flat-site-markings-data.json' with {type:'json'};
import signs from '../client/wall-site-signs.json' with {type:'json'};
import {paintSiteWalls} from '../client/wall-site-signs.js';

test('all eighteen objectives have an upright print, originals retained at their source positions',()=>{
  for(const [id,record] of Object.entries(sites)){
    const print=signs[id];assert.equal(print.source,record.source,id);
    for(const letter of ['A','B']){
      if(record[letter].wall){assert.equal(print[letter],undefined);continue;}
      const sign=print[letter];assert.ok(sign.size>=1.2 && sign.size<=3);
      assert.ok(Math.abs(Math.hypot(...sign.normal)-1)<.0001 && Math.abs(sign.normal[1])<.07);
      assert.ok(Math.hypot(...sign.center.map((x,i)=>x-record[letter].anchor[i]))<21);
      assert.ok((sign.depth??.032)<=.112);
    }
  }
});

test('a wall print changes only affected static materials and preserves geometry and game shader',()=>{
  const root=new Group();
  const source=new MeshBasicMaterial();let previous=0;
  source.onBeforeCompile=()=>previous++;
  source.customProgramCacheKey=()=>'baked';
  const g=new BoxGeometry(4,4,4),triangleCount=g.index.count;
  const config={id:'de_dust2',sourceSha256:signs.de_dust2.source};
  const [x,y,z]=signs.de_dust2.A.center;
  const tile=new Mesh(g,source);tile.name='tile_0_1';tile.position.set(-z,y,x);
  const door=tile.clone();door.name='active-door';
  const far=tile.clone();far.name='tile_8_8';far.position.set(300,7,500);
  root.add(tile,door,far);
  const unpaint=paintSiteWalls(root,config,new Texture());
  assert.equal(tile.geometry,g);assert.equal(g.index.count,triangleCount);
  assert.equal(far.material,source);assert.equal(door.material,source);
  assert.notEqual(tile.material,source);assert.match(tile.material.customProgramCacheKey(),/^baked-site-wall/);
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'#include <common>\n#include <opaque_fragment>'};
  tile.material.onBeforeCompile(shader,null);assert.equal(previous,1);
  assert.match(shader.fragmentShader,/applySitePaint\(outgoingLight\)/);
  assert.equal(shader.uniforms.sitePaintCenter.value.length,2);
  unpaint();assert.equal(tile.material,source);
  paintSiteWalls(root,{...config,sourceSha256:'another revision'},new Texture());
  assert.equal(tile.material,source);
});

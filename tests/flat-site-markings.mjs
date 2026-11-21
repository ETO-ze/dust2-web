import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BufferGeometry, Group, Mesh} from 'three';
import {bombSiteAt} from '../shared/bomb-zones.js';
import {BOMB_ZONES} from '../shared/bomb-zones-data.js';
import entries from '../client/flat-site-markings-data.json' with {type:'json'};
import {flatSiteGeometry,replaceOriginalFloorPaint} from '../client/flat-site-markings.js';

function map(id) {
  return {id, sourceSha256:BOMB_ZONES[id].source, private:true};
}

test('the nine map sources each have two bounded stencils that sample their own atlas cell', () => {
  assert.deepEqual(Object.keys(entries).sort(),Object.keys(BOMB_ZONES).sort());
  for(const [id,record] of Object.entries(entries)) {
    const geometry=flatSiteGeometry(map(id));
    const positions=geometry.getAttribute('position');
    const uv=geometry.getAttribute('uv');
    let start=0;
    for(const name of ['A','B']) {
      const entry=record[name], count=Buffer.from(entry.vertices,'base64').length/8;
      const [cx,cy,cz]=entry.anchor;
      assert.equal(entry.wall,['de_nuke','de_vertigo'].includes(id));
      if(!entry.wall)assert.equal(bombSiteAt(map(id),{x:cx,y:cy,z:cz,crouch:true}),name);
      for(let i=start;i<start+count;i++){
        const x=positions.getZ(i), y=positions.getY(i), z=-positions.getX(i);
        assert.ok(Math.hypot(x-cx,y-cy,z-cz)<4);
        if(!entry.wall)assert.equal(bombSiteAt(map(id),{x,y,z,crouch:true}),name,JSON.stringify({id,name,x,y,z}));
        assert.equal(uv.getX(i)>.5,name==='B');
        assert.equal(uv.getY(i)<.5,entry.wall);
      }
      start+=count;
    }
    assert.equal(start,positions.count);
    assert.equal(geometry.index.count%3,0);
    for(const i of geometry.index.array)assert.ok(i>=0 && i<start);
    geometry.dispose();
  }
  assert.ok(entries.de_nuke.A.anchor[1]-entries.de_nuke.B.anchor[1]>8);
  assert.equal(flatSiteGeometry({id:'de_nuke',sourceSha256:'old'}),null);
  assert.equal(flatSiteGeometry({id:'custom-map'}),null);
});

test('floor paint replacement verifies all three digests and touches only recorded triangles', () => {
  const id='de_dust2', config=map(id), {replace}=entries[id], root=new Group();
  const [name,ranges]=Object.entries(replace.ranges)[0];
  const [first,len]=ranges;
  const mesh=new Mesh(new BufferGeometry());
  const indices=Array.from({length:3*(first+len+2)},(_,i)=>i);
  mesh.name=name;
  mesh.geometry.setIndex(indices);
  root.add(mesh);
  for(const [m,a,b] of [[{...config,sourceSha256:'old'},replace.render,replace.geometry],
      [config,'unexpected',replace.geometry],[config,replace.render,'different']]) {
    assert.equal(replaceOriginalFloorPaint(root,m,a,b),0);
    assert.deepEqual(Array.from(mesh.geometry.index.array),indices);
  }
  assert.equal(replaceOriginalFloorPaint(root,config,replace.render,replace.geometry),len);
  assert.deepEqual(Array.from(mesh.geometry.index.array),[...indices.slice(0,3*first),...indices.slice(3*(first+len))]);
});

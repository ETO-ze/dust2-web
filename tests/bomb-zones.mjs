import test from 'node:test';
import assert from 'node:assert/strict';
import {BOMB_ZONES} from '../shared/bomb-zones-data.js';
import {bombSiteAt,legacyBombSiteAt,plantedBombPosition} from '../shared/bomb-zones.js';
import {MAP} from '../shared/map-data.js';
import {snapshotForSide} from '../server/snapshot-view.js';

const map=id=>({id,sourceSha256:BOMB_ZONES[id].source,private:true});
test('nine original maps preserve all 18 named triggers and each convex component',()=>{
  const maps=Object.values(BOMB_ZONES);assert.equal(maps.length,9);
  const sites=maps.flatMap(m=>Object.values(m.sites));assert.equal(sites.length,18);
  assert.equal(sites.reduce((n,s)=>n+s.hulls.length,0),30);
  assert.equal(BOMB_ZONES.de_nuke.sites.B.hulls.length,6);
  assert.equal(BOMB_ZONES.de_dust2.sites.A.hulls.length,2);
});

test('actual Dust II A and Anubis A corners outside the brushes cannot plant',()=>{
  assert.equal(bombSiteAt(map('de_dust2'),{x:25,y:3.66,z:-66.44,crouch:true}),null);
  assert.equal(bombSiteAt(map('de_anubis'),{x:24.3,y:-4.61,z:-55.5}),null);
  assert.equal(bombSiteAt(MAP,MAP.sites.A),'A');
  assert.equal(bombSiteAt(MAP,{x:25,y:3.66,z:-66.44}),null);
  assert.equal(legacyBombSiteAt(MAP,{x:25,y:3.66,z:-66.44}),'A');
});

test('Nuke checks the level and contour within overlapping XZ ranges',()=>{
  const m=map('de_nuke');
  assert.equal(bombSiteAt(m,{x:18,y:-10.5,z:21}),'A');
  assert.equal(bombSiteAt(m,{x:18,y:-19.5,z:21}),'B');
  assert.equal(bombSiteAt(m,{x:18,y:-15,z:21}),null);
  assert.equal(bombSiteAt(m,{x:8.33,y:-19,z:28.08}),null);
});

test('a different source revision uses its own supplied metadata',()=>{
  const p={x:88,y:0,z:22},m={...map('de_dust2'),sourceSha256:'another',sites:{B:{...p,radius:1}}};
  assert.equal(bombSiteAt(m,p),'B');
});

test('planted C4 follows its supporting surface and cannot fall through to a lower storey',()=>{
  const p={x:1,y:20,z:2};
  assert.deepEqual(plantedBombPosition(p,()=>19.974),{x:1,y:19.974,z:2});
  const atEdge=plantedBombPosition(p,(x,z,fromY,maxDepth)=>{
    assert.ok(fromY>20&&fromY-maxDepth>19.7);
    return x<.9?20:null;
  });
  assert.ok(atEdge.x<1&&Math.abs(atEdge.x-1)<.30);
  assert.equal(atEdge.y,20);
  assert.deepEqual(plantedBombPosition(p,()=>null),p);
});

test('only the carrying team receives the authoritative plant hint',()=>{
  const snap={players:[{id:'carrier',team:'T',plantSite:'A'}],events:[]};
  assert.equal(snapshotForSide(snap,'T').players[0].plantSite,'A');
  assert.equal('plantSite' in snapshotForSide(snap,'CT').players[0],false);
});

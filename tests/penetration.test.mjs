import test from 'node:test';
import assert from 'node:assert/strict';
import {traceBullet} from '../server/bullet-penetration.js';
import {getWeapon} from '../shared/weapons.js';
import {initPhysics,raycastWorldSurfaces} from '../shared/physics.js';
const origin={x:0,y:1,z:0},direction={x:0,y:0,z:1},shooter={id:'a',team:'T'};
const player={id:'b',alive:true,team:'CT'},rayHitPlayer=()=>({distance:5,headshot:false});
const trace=(surfaces,weapon='ak47',players=[player])=>traceBullet({origin,direction,weapon:getWeapon(weapon),shooter,players,now:100,rayHitPlayer,surfaces});
const slab=(thickness,material=1)=>[{distance:2,normal:{x:0,y:0,z:-1},material},{distance:2+thickness,normal:{x:0,y:0,z:1},material}];
test('paired thin wood and metal allow damage with wallbang metadata; thick concrete stops',()=>{
 for(const surfaces of [slab(.2),slab(.1,2)]){const r=trace(surfaces);assert.equal(r.hits.length,1);assert.equal(r.hits[0].wallbang,true);assert.ok(r.hits[0].damageScale>0&&r.hits[0].damageScale<1);}
 assert.equal(trace(slab(1,0)).hits.length,0);assert.equal(trace(slab(.4,2)).hits.length,0);
 assert.equal(trace(slab(.3,2),'awp').hits.length,1);
});
test('an unpaired surface, incompatible exit or grazing slab cannot silently become a transparent wall',()=>{
 assert.equal(trace(slab(.2).slice(0,1)).hits.length,0);
 const wrong=slab(.1);wrong[1].normal.z=-1;assert.equal(trace(wrong).hits.length,0);
 const material=slab(.1);material[1].material=2;assert.equal(trace(material).hits.length,0);
 assert.equal(trace(slab(3)).hits.length,0);
});
test('open hits are full damage, protected enemies and friendlies are excluded, extra surfaces reduce damage',()=>{
 assert.equal(trace([]).hits[0].damageScale,1);assert.equal(trace([]).hits[0].wallbang,false);
 assert.equal(trace([], 'ak47',[{...player,team:'T'},{...player,id:'c',protectionUntil:200}]).hits.length,0);
 const two=[...slab(.1),...slab(.1).map(s=>({...s,distance:s.distance+1}))];assert.ok(trace(two).hits[0].damageScale<trace(slab(.1)).hits[0].damageScale);
});
test('physics crossings retain per-triangle materials through BVH indexing and collapse shared edges',()=>{
 const positions=[-2,-2,2, 2,2,2, 2,-2,2, -2,-2,2,-2,2,2,2,2,2, -2,-2,2.2,2,-2,2.2,2,2,2.2,-2,-2,2.2,2,2,2.2,-2,2,2.2];
 initPhysics(positions,new Uint8Array([1,1,1,1]));const hits=raycastWorldSurfaces(origin,direction,10);
 assert.equal(hits.length,2);assert.deepEqual(hits.map(h=>h.material),[1,1]);assert.ok(hits[0].normal.z<0);assert.ok(hits[1].normal.z>0);
});

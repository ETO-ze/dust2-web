import test from 'node:test';
import assert from 'node:assert/strict';
import {MatchView} from '../client/match-view.js';
test('death camera eases downward, freezes kill direction and clears on respawn',()=>{
 const view=new MatchView(),player={id:'me',team:'CT',alive:true,x:0,y:1,z:0,yaw:0,pitch:0};
 const enemy={id:'enemy',team:'T',alive:true,x:5,y:1,z:0};const snapshot={mode:'deathmatch',players:[player,enemy],events:[]};
 view.update(player,snapshot,0);player.alive=false;snapshot.events=[{type:'kill',victimId:'me',killerId:'enemy'}];view.update(player,snapshot,100);
 const initial=view.deathCamera(100),fallen=view.deathCamera(1000);assert.ok(initial.y>fallen.y);assert.ok(Math.abs(fallen.yaw+Math.PI/2)<.001);assert.ok(Object.values(fallen).every(Number.isFinite));
 enemy.x=-10;view.update(player,snapshot,1500);assert.equal(view.deathCamera(1500).yaw,fallen.yaw);
 player.alive=true;view.update(player,snapshot,3200);assert.equal(view.deathCamera(3200),null);
});

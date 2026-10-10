import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {VITALITY_ROSTER,botDifficultyFor,challengeEvidence,challengeOpeningPost} from '../server/bot-challenge.js';
import {effectiveBotSkill} from '../server/bot-adaptation.js';
import {BOT_AIM,angleDifference} from '../server/bot-aim.js';
function flat(){const g=new BoxGeometry(500,1,500).toNonIndexed();g.translate(0,-.5,0);initPhysics(g.attributes.position.array);g.dispose();}
const roster=room=>[...room.players.values()].filter(p=>p.challengeProfile);
test('challenge reserves a complete five-player opponent squad, preserves identities across halftime and releases names on exit',()=>{
 flat();const room=new GameRoom('SQUAD',{bots:0,botDifficulty:'vitality'}),host=room.addHuman({},{name:'Human',team:'T'});
 assert.equal(room.desiredBots,5);assert.deepEqual(roster(room).map(p=>p.name),VITALITY_ROSTER.map(p=>p.id));
 assert(roster(room).every(p=>p.team!==host.team));assert.equal(room.setBots(host.id,4).ok,false);
 assert.throws(()=>room.addHuman({},{name:'Enemy human',team:'CT'}),/挑战/);
 room.setBots(host.id,9);const friend=room.addHuman({},{name:'Friend',team:'auto'});assert.equal(friend.team,host.team);assert.equal(roster(room).length,5);
 assert.equal(room.takeSeat(host.id,'CT',0).ok,false);assert.equal(room.setSeatBot(host.id,'CT',0,false).ok,false);
 const names=roster(room).map(p=>p.name);room.pendingTransition={swapSides:true,resetMoney:800};room.startRound();
 assert.deepEqual(roster(room).map(p=>p.name),names);assert(roster(room).every(p=>p.team==='T'));assert.equal(host.team,'CT');
 const newcomer=room.addHuman({},{name:'After swap',team:'auto'});assert.equal(newcomer.team,'CT');assert.equal(roster(room).length,5);
 room.setBotDifficulty(host.id,'normal');assert.equal(roster(room).length,0);assert([...room.players.values()].filter(p=>p.bot).every(p=>/BOT/.test(p.name)));
});
test('enabling challenge rebalances six existing bots and rejects a room with an opposing human',()=>{
 flat();const room=new GameRoom('REBALANCE',{bots:6}),host=room.addHuman({},{name:'Host',team:'CT'});
 assert.equal(room.setBotDifficulty(host.id,'vitality').ok,true);assert.equal(room.botCount,6);assert.equal(roster(room).length,5);assert.equal(room.humanCount,1);
 room.setBotDifficulty(host.id,'normal');room.addHuman({},{name:'Opponent',team:'T'});assert.equal(room.setBotDifficulty(host.id,'vitality').ok,false);assert.equal(room.botDifficulty,'normal');
});
test('challenge keeps visual aiming and common turn limits; friendly bots remain normal',()=>{
 flat();let now=100000;const room=new GameRoom('AIM',{bots:9,mode:'deathmatch',botDifficulty:'vitality',clock:()=>now}),human=room.addHuman({},{name:'Host',team:'CT'}),enemy=roster(room)[0],friend=[...room.players.values()].find(p=>p.bot&&!p.challengeProfile);
 assert.equal(botDifficultyFor(room,friend),'normal');assert.equal(botDifficultyFor(room,enemy),'vitality');assert(effectiveBotSkill(room,enemy).reactionMinMs<effectiveBotSkill(room,friend).reactionMinMs);
 room.visibleToBot=()=>false;room.botInput(enemy,1/30);assert.equal(enemy.botAI.targetId,null);
 Object.assign(enemy,{x:0,y:0,z:0,yaw:1,pitch:0,grounded:true});Object.assign(human,{x:0,y:0,z:-10,protectionUntil:0});room.visibleToBot=()=>true;
 for(let i=0;i<60;i++){now+=1000/30;const previous=enemy.yaw,out=room.botInput(enemy,1/30);assert(Math.abs(angleDifference(out.yaw,previous))<=BOT_AIM.maxYawSpeed/30+1e-9);enemy.yaw=out.yaw;enemy.pitch=out.pitch;}
 room.visibleToBot=()=>false;now+=1000;assert.equal(room.botInput(enemy,1/30).fire,false);
 assert.equal(JSON.stringify(room.snapshot()).includes('openingPositions'),false);
});
test('demo-derived opening posts require nearby audited NAV and a valid route; no fallback through walls',()=>{
 const room={botDifficulty:'vitality',challengeTeamId:'A',privateMap:{mapId:'de_mirage'},round:{number:1}},p={bot:true,teamId:'A',team:'CT',challengeProfile:{id:'ZywOo'}};
 const sample=challengeEvidence(room,p).openingPositions.find(x=>x.place==='SnipersNest').sourcePoint;
 const node={id:42,x:sample.x*.0254,y:sample.z*.0254,z:-sample.y*.0254};
 assert.equal(challengeOpeningPost(room,p,{nearest:()=>node,route:()=>null}),null);
 const post=challengeOpeningPost(room,p,{nearest:()=>node,route:()=>[node]});assert.equal(post.place,'SnipersNest');
 assert.equal(challengeOpeningPost(room,p,{nearest:()=>({...node,x:node.x+100}),route:()=>[node]}),null);
});

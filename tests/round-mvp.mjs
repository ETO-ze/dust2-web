import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(mode='defuse'){
  let now=100000;
  const room=new GameRoom('AWARD',{mode,bots:0,clock:()=>now});
  const ct=room.addHuman({}, {name:'队长',team:'CT',musicKit:'noisestorm_01'});
  const t=room.addHuman({}, {name:'先锋',team:'T'});
  const wing=room.addHuman({}, {name:'支援',team:'CT'});
  room.startRound();room.round.phase='live';room.events.length=0;
  return {room,ct,t,wing,advance:ms=>{now+=ms;}};
}

test('award is identical in the event and late snapshots, including the winner’s kit',()=>{
  const {room,ct,t,wing}=fixture();
  ct.roundKills=2;wing.roundKills=1;t.roundKills=4;
  room.endRound('CT','歼灭对手');
  const first=room.snapshot();
  const event=first.events.find(e=>e.type==='round_end');
  assert.equal(event.mvpId,ct.id);
  assert.deepEqual(event.mvp,first.round.mvp);
  assert.equal(event.mvp.musicKit,'noisestorm_01');
  wing.roundKills=5;room.endRound('CT','重复');
  assert.deepEqual(room.snapshot().round.mvp,event.mvp);
  assert.equal(ct.mvpStars,1);
  room.startRound();
  assert.equal(room.snapshot().round.mvp,undefined);
});

test('quiet timeouts show the result without assigning an arbitrary player',()=>{
  const {room}=fixture();
  room.endRound('CT','回合时间耗尽');
  assert.equal(room.round.mvp,null);
  assert.equal(room.events.find(e=>e.type==='round_end').mvpId,null);
});

test('planting and detonation credit the original planter even if control is released',()=>{
  const {room,t,ct,advance}=fixture();
  const body=room.makePlayer('carrier','带包人机','T',true);
  room.players.set(body.id,body);
  t.alive=false;
  assert.equal(room.takeBot(t.id,body.id).ok,true);
  room.bomb={...room.emptyBomb(),state:'carried',carrierId:body.id};
  room.siteAt=()=>'B';
  body.grounded=true;body.effectiveInput={interact:true};
  room.stepBomb(room.rules.plantSeconds);
  assert.equal(room.bomb.state,'planted');
  body.controllerId=null;ct.roundKills=3;
  advance(room.rules.bombSeconds*1000+1);room.stepBomb(1/30);
  assert.equal(room.round.mvp.reason,'plant');assert.equal(room.round.mvp.id,t.id);
});

test('actual defuse completion takes priority over the winning team’s frag count',()=>{
  const {room,ct,wing}=fixture();
  wing.roundKills=4;ct.grounded=true;ct.effectiveInput={interact:true};
  room.bomb={...room.emptyBomb(),state:'planted',site:'A',x:ct.x,y:ct.y,z:ct.z,explodesAt:200000};
  room.stepBomb(room.rules.defuseSeconds);
  assert.equal(room.bomb.state,'defused');
  assert.equal(room.round.mvp.id,ct.id);assert.equal(room.round.mvp.reason,'defuse');
});

test('a final round publishes both its winner and a separate match award',()=>{
  const {room,ct,wing}=fixture();
  ct.mvpStars=3;ct.kills=15;wing.roundKills=3;
  room.scores.CT=12;room.match.roundsPlayed=12;
  room.endRound('CT','歼灭对手');
  const snapshot=room.snapshot();
  assert.equal(snapshot.round.phase,'matchEnded');
  assert.equal(snapshot.round.mvp.id,wing.id);
  assert.equal(snapshot.match.mvp.id,ct.id);
  assert.equal(snapshot.match.mvp.stars,3);
  assert.deepEqual(snapshot.events.find(e=>e.type==='match_end').match.mvp,snapshot.match.mvp);
});

test('the deciding deathmatch frag selects an MVP with total kills',()=>{
  const {room,ct,t,wing}=fixture('deathmatch');
  ct.kills=24;wing.kills=30;room.scores.CT=99;
  room.kill(t,ct,'ak47');
  assert.equal(room.match.mvp.id,wing.id);assert.equal(room.match.mvp.reason,'matchKills');
});

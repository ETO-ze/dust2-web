import assert from 'node:assert/strict';
import test from 'node:test';
import {GameRoom} from '../server/game.js';
import {c4Damage} from '../server/c4-blast.js';
import {MAP} from '../shared/map-data.js';

function match(bots=0){
  let now=100000;
  const room=new GameRoom('C4TEST',{mode:'defuse',bots,clock:()=>now});
  const t=room.addHuman({},{team:'T',name:'Planter'});
  const ct=room.addHuman({},{team:'CT',name:'Defender'});
  return {room,t,ct,advance:ms=>now+=ms};
}

function plant({room,t}){
  room.round.phase='live';
  const existing=[...room.players.values()].find(p=>p.hasBomb);
  if(existing!==t){if(existing)room.dropBomb(existing);t.hasBomb=true;room.giveWeapon(t,'c4');Object.assign(room.bomb,{state:'carried',carrierId:t.id});}
  Object.assign(t,MAP.sites.A,{grounded:true,effectiveInput:{interact:true}});
  room.stepBomb(room.rules.plantSeconds);
  assert.equal(room.bomb.state,'planted');
  t.effectiveInput={};
}

function place(room,p,x,y=0,armor=0){
  Object.assign(p,{x:room.bomb.x+x,y:room.bomb.y+y-.9,z:room.bomb.z,health:100,armor,helmet:false,crouch:false,grounded:true,alive:true});
}
const events=(room,type)=>room.events.filter(e=>e.type===type);

test('C4 uses the nine source-map profiles, fades in three dimensions, and has a finite game radius',()=>{
  for(const [map,power] of Object.entries({de_dust2:700,de_mirage:650,de_inferno:600,de_nuke:650,de_ancient:650,de_anubis:450,de_cache:600,de_train:500,de_vertigo:500})){
    assert.equal(c4Damage(map,0),power);
    const radius=power*3.5*.0254;
    assert.ok(c4Damage(map,radius*.25)>c4Damage(map,radius*.5));
    assert.ok(c4Damage(map,radius*.5)>c4Damage(map,radius*.9));
    assert.equal(c4Damage(map,radius),0);
  }
});

test('one planted C4 damages both teams and controlled bodies, respects armor and distance, and settles MVP once',()=>{
  const f=match(2),{room,t,ct}=f;
  const spectator=room.addHuman({},{team:'CT',name:'Spectator'});
  const kevlar=room.addHuman({},{team:'T',name:'Kevlar'});
  const above=room.addHuman({},{team:'CT',name:'One floor above'});
  const save=room.addHuman({},{team:'T',name:'Escaped'});
  const damagedArmor=room.addHuman({},{team:'T',name:'Low armor'});
  plant(f);
  const bot=[...room.players.values()].find(p=>p.bot&&p.team==='CT');
  assert.ok(bot);
  room.kill(spectator,null);
  assert.ok(room.takeBot(spectator.id,bot.id).ok);
  for(const p of room.players.values())if(p.alive)place(room,p,100);
  place(room,t,0,0,100);place(room,bot,1,0,100);
  place(room,ct,47);place(room,above,0,47);place(room,kevlar,47,0,100);place(room,damagedArmor,47,0,3);
  const spectatorDeaths=spectator.deaths;
  f.advance(room.rules.bombSeconds*1000-1);room.stepBomb(.001);assert.equal(ct.health,100);
  f.advance(1);room.stepBomb(.001);
  assert.equal(room.bomb.state,'exploded');assert.equal(room.round.winner,'T');assert.equal(room.round.mvp.id,t.id);
  assert.equal(t.alive,false);assert.equal(bot.alive,false);
  assert.equal(spectator.deaths,spectatorDeaths);assert.equal(spectator.health,0);
  assert.ok(ct.health>0 && ct.health<100);assert.equal(ct.health,above.health);
  assert.ok(kevlar.health>damagedArmor.health&&damagedArmor.health>ct.health);
  assert.ok(kevlar.armor>0&&kevlar.armor<100);assert.equal(damagedArmor.armor,0);
  assert.equal(save.health,100);assert.equal(t.kills,0);assert.equal(t.roundKills,0);
  const deaths=events(room,'kill').filter(e=>e.weapon==='c4');
  assert.deepEqual(deaths.map(e=>e.victimId).sort(),[t.id,bot.id].sort());
  assert.ok(deaths.every(e=>!e.credited&&e.killerId===null&&!e.headshot));
  const before=room.snapshot({drainEvents:false}),hits=events(room,'hit').length;
  for(let i=0;i<4;i++)room.stepBomb(.04);
  const after=room.snapshot({drainEvents:false});
  assert.deepEqual(after.scores,before.scores);assert.equal(room.match.roundsPlayed,1);
  assert.equal(events(room,'hit').length,hits);assert.equal(events(room,'bomb_exploded').length,1);
  assert.equal(events(room,'round_end').length,1);
  assert.equal(after.players.find(p=>p.id===ct.id).health,ct.health);
});

test('an expired post-round plant damages survivors without awarding the round again',()=>{
  const f=match(),{room,t,ct}=f;plant(f);place(room,t,0);place(room,ct,100);
  f.advance(room.rules.bombSeconds*1000-1000);
  room.kill(ct,null);room.endRound('T','CT 全部被击败');
  const awards=room.round.mvp;
  f.advance(1000);room.tick(0);
  assert.ok(!t.alive);assert.equal(room.bomb.state,'exploded');assert.equal(room.scores.T,1);
  assert.equal(room.match.roundsPlayed,1);assert.deepEqual(room.round.mvp,awards);
  assert.equal(events(room,'round_end').length,1);assert.equal(events(room,'bomb_exploded').length,1);
});

test('a defused charge and a charge timing out after the next-round boundary never damage the new round',()=>{
  const f=match(),{room,t,ct}=f;plant(f);place(room,t,0);place(room,ct,0);
  ct.effectiveInput={interact:true};room.stepBomb(room.rules.defuseSeconds);
  assert.equal(room.bomb.state,'defused');
  f.advance(room.rules.bombSeconds*1000);room.tick(0);assert.equal(events(room,'bomb_exploded').length,0);
  plant(f);room.endRound('T','CT 全部被击败');f.advance((room.rules.bombSeconds+1)*1000);room.tick(0);
  assert.equal(events(room,'bomb_exploded').length,0);assert.equal(t.health,100);assert.equal(ct.health,100);
});

test('match-winning detonation applies damage before match settlement even when all bodies die',()=>{
  const f=match(),{room,t,ct}=f;plant(f);place(room,t,0);place(room,ct,1);
  room.scores.T=12;room.scores.CT=7;room.match.roundsPlayed=19;
  f.advance(room.rules.bombSeconds*1000);room.tick(0);
  assert.equal(t.health,0);assert.equal(ct.health,0);
  assert.equal(room.match.status,'ended');assert.equal(room.scores.T,13);
  const e=room.snapshot({drainEvents:false}).events.map(v=>v.type);
  assert.ok(e.indexOf('bomb_exploded')<e.lastIndexOf('kill'));
  assert.ok(e.lastIndexOf('kill')<e.indexOf('round_end')&&e.indexOf('round_end')<e.indexOf('match_end'));
  room.tick(0);assert.equal(events(room,'bomb_exploded').length,1);
});

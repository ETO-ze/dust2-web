import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, applyArmorDamage, sanitizeInput } from '../server/game.js';
import { GrenadeSimulation } from '../server/grenades.js';
import { WEAPONS, TEAM_LOADOUTS, canTeamUseWeapon, getWeapon, weaponSpeedScale } from '../shared/weapons.js';
import { EQUIPMENT, equipmentPrice, MAX_GRENADES } from '../shared/equipment.js';
import { startGameServer } from '../server/index.js';
import { MAP } from '../shared/map-data.js';
import { raycastWorld } from '../shared/physics.js';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';

const input=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,...extra});
function fixture(mode='deathmatch'){
  let now=1000000;
  const room=new GameRoom('EQUIPQA',{mode,bots:0,clock:()=>now});
  const t=room.addHuman({}, {name:'T',team:'T'}),ct=room.addHuman({}, {name:'CT',team:'CT'});
  return {room,t,ct,now:()=>now,advance:ms=>{now+=ms;}};
}
function clearLane(){
  const nodes=MAP.nav.filter(node=>node.neighbors.length>=3);
  for(const a of nodes)for(const b of nodes){
    const d=Math.hypot(b.x-a.x,b.z-a.z);if(d<4||d>6||Math.abs(a.y-b.y)>.08)continue;
    const origin={x:a.x,y:a.y+1.6,z:a.z},dy=b.y+1-origin.y,length=Math.hypot(d,dy);
    if(raycastWorld(origin,{x:(b.x-a.x)/length,y:dy/length,z:(b.z-a.z)/length},length)===null)
      return {a:{x:a.x,y:a.y,z:a.z},b:{x:b.x,y:b.y,z:b.z},yaw:Math.atan2(a.x-b.x,a.z-b.z),pitch:Math.atan2(dy,d)};
  }
  throw Error('No unobstructed real-map lane');
}

test('team armory, armor, scopes and three server-owned utilities',{timeout:20000},async t=>{
  const app=await startGameServer({port:0,host:'127.0.0.1'});t.after(()=>app.close());
  const lane=clearLane();

  await t.test('real WebSocket purchase and slot-4 throw broadcast one consumed grenade to another player',async sub=>{
    const peers=[];
    sub.after(()=>{for(const peer of peers)peer.ws.terminate();});
    async function connect(team){
      const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`),messages=[];
      ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');
      const waitFor=async predicate=>{for(let i=0;i<200;i++){const n=messages.findIndex(predicate);if(n>=0)return messages.splice(n,1)[0];await delay(10);}throw Error('Equipment WebSocket timeout');};
      const peer={ws,messages,waitFor};peers.push(peer);
      ws.send(JSON.stringify({type:'join',name:'Utility QA',team,room:'NADEWIRE',mode:'deathmatch',bots:0}));
      peer.id=(await waitFor(m=>m.type==='welcome')).id;return peer;
    }
    const owner=await connect('T'),observer=await connect('CT');
    owner.ws.send(JSON.stringify({type:'buy',weapon:'hegrenade'}));
    const purchase=await owner.waitFor(m=>m.type==='purchase');assert.equal(purchase.slot,4);
    owner.ws.send(JSON.stringify({type:'input',...input(1,{slot:4,utilityId:'hegrenade'})}));
    await owner.waitFor(m=>m.type==='snapshot'&&m.players.find(p=>p.id===owner.id)?.weapon==='hegrenade');
    await delay(220);
    owner.ws.send(JSON.stringify({type:'input',...input(2,{slot:4,utilityId:'hegrenade',fire:true})}));
    await delay(210);
    owner.ws.send(JSON.stringify({type:'input',...input(3,{slot:4,utilityId:'hegrenade',fire:false})}));
    const snapshot=await observer.waitFor(m=>m.type==='snapshot'&&m.events.some(e=>e.type==='grenade_thrown'&&e.shooterId===owner.id));
    assert.equal(snapshot.grenades.length,1);const player=snapshot.players.find(p=>p.id===owner.id);
    assert.equal(player.utilityCounts.hegrenade,0);assert.equal(player.slot,1);assert.equal(player.weapon,'ak47');
  });

  await t.test('both 15-gun team panels enforce legal purchases and isolate pistol and primary slots',()=>{
    const {room,t:terrorist,ct}=fixture();
    assert.equal(Object.keys(WEAPONS).length,24);
    for(const player of [terrorist,ct]){
      const groups=TEAM_LOADOUTS[player.team];assert.deepEqual(Object.values(groups).map(ids=>ids.length),[5,5,5]);
      for(const id of Object.values(groups).flat()){
        const previousOther=Object.keys(player.inventory).find(key=>getWeapon(key).slot===(getWeapon(id).slot===1?2:1));
        const result=room.buy(player.id,id);assert.equal(result.ok,true,id);assert.equal(result.slot,getWeapon(id).slot);
        assert.ok(player.inventory[previousOther]);assert.equal(player.weapon,id);
        assert.equal(Object.keys(player.inventory).filter(key=>getWeapon(key).slot===result.slot).length,1);
      }
      const state=JSON.stringify(player.inventory),balance=player.money;
      for(const id of Object.keys(WEAPONS).filter(id=>id!=='knife'&&!canTeamUseWeapon(player.team,id)))assert.equal(room.buy(player.id,id).ok,false,id);
      assert.equal(JSON.stringify(player.inventory),state);assert.equal(player.money,balance);
    }
    const forged=room.makePlayer('forged','forged','CT',false,'ak47');assert.equal(forged.weapon,'m4a1');
    assert.equal(room.buy(terrorist.id,{toString:null}).ok,false);
  });

  await t.test('purchases debit real prices and upgrade full armor with a $350 helmet',()=>{
    const {room,t:terrorist,ct}=fixture('defuse');
    ct.money=16000;
    for(const [id,cost] of [['m4a4',2900],['usp',200],['armor',650],['helmet',350],['defusekit',400],['hegrenade',300],['flashbang',200],['smokegrenade',300]]){
      const before=ct.money;assert.equal(room.buy(ct.id,id).ok,true,id);assert.equal(before-ct.money,cost,id);
    }
    assert.equal(ct.armor,100);assert.equal(ct.helmet,true);assert.equal(ct.defuseKit,true);
    assert.equal(room.buy(ct.id,'helmet').ok,false);assert.equal(room.buy(ct.id,'defusekit').ok,false);
    assert.equal(room.buy(terrorist.id,'defusekit').ok,false);
    ct.armor=60;assert.equal(equipmentPrice('helmet',ct),650);assert.equal(room.buy(ct.id,'helmet').ok,true);assert.equal(ct.armor,100);
    ct.money=0;assert.equal(room.buy(ct.id,'awp').ok,false);
  });

  await t.test('a vest protects the body while only a helmet protects the head; depleted armor is bounded',()=>{
    const bareHead={armor:100,helmet:false};assert.deepEqual(applyArmorDamage(100,bareHead,{headshot:true,armorRatio:1}),{damage:100,armor:false});assert.equal(bareHead.armor,100);
    const helmet={armor:100,helmet:true};assert.deepEqual(applyArmorDamage(100,helmet,{headshot:true,armorRatio:1}),{damage:50,armor:true});assert.equal(helmet.armor,75);
    const vest={armor:100,helmet:false};assert.equal(applyArmorDamage(100,vest,{armorRatio:1}).damage,50);
    const low={armor:5,helmet:true};assert.equal(applyArmorDamage(100,low,{armorRatio:1}).damage,90);assert.equal(low.armor,0);
    assert.equal(applyArmorDamage(55,vest,{bypassArmor:true}).damage,55);
  });

  await t.test('CT kit halves defuse duration, interruption resets progress, death removes gear next round',()=>{
    for(const kit of [false,true]){
      const {room,t:terrorist,ct}=fixture('defuse');room.round.phase='live';ct.defuseKit=kit;
      const site=MAP.sites.B;
      Object.assign(room.bomb,site,{state:'planted',explodesAt:2000000});
      Object.assign(ct,{x:site.x+.6,y:site.y,z:site.z,vx:0,vz:0,effectiveInput:{interact:true}});
      room.stepBomb(2);assert.ok(Math.abs(room.bomb.progress-(kit?.4:.2))<1e-8);
      ct.effectiveInput.interact=false;room.stepBomb(.1);assert.equal(room.bomb.progress,0);
      ct.effectiveInput.interact=true;room.stepBomb(kit?4.9:9.9);assert.equal(room.bomb.state,'planted');
      room.stepBomb(.1);assert.equal(room.bomb.state,'defused');
      room.kill(ct,terrorist);room.startRound();assert.equal(ct.defuseKit,false);assert.equal(ct.helmet,false);assert.equal(ct.armor,0);
    }
  });

  await t.test('scope levels are weapon-specific, sanitized and shared with movement prediction',()=>{
    assert.equal(sanitizeInput(null),null);
    assert.equal(sanitizeInput(input(1,{slot:4,utilityId:{toString:null},zoomLevel:99})).utilityId,null);
    assert.equal(sanitizeInput(input(2,{slot:4,utilityId:'flashbang',zoomLevel:2})).zoomLevel,2);
    const {room,t:terrorist,advance}=fixture();
    assert.deepEqual(WEAPONS.awp.zoomFovs,[90,40,10]);assert.deepEqual(WEAPONS.ssg08.zoomFovs,[90,40,15]);assert.deepEqual(WEAPONS.scar20.zoomFovs,[90,40,15]);
    assert.equal(room.buy(terrorist.id,'sg553').ok,true);advance(200);room.receiveInput(terrorist.id,input(1,{slot:1,zoomLevel:2}));room.tick();
    assert.equal(terrorist.zoomLevel,1);assert.equal(terrorist.effectiveInput.speedScale,weaponSpeedScale('sg553',1));
    room.receiveInput(terrorist.id,input(2,{slot:2,zoomLevel:2}));room.tick();assert.equal(terrorist.zoomLevel,0);
    room.buy(terrorist.id,'awp');advance(200);room.receiveInput(terrorist.id,input(3,{slot:1,zoomLevel:2}));room.tick();assert.equal(terrorist.zoomLevel,2);
    terrorist.nextShotAt=0;room.fire(terrorist,input(4,{fire:true}));assert.equal(terrorist.zoomLevel,0);
  });

  await t.test('a shotgun trigger consumes one shell, traces every pellet and emits a single shot and kill',sub=>{
    sub.mock.method(Math,'random',()=>.5);
    for(const [id,team] of [['nova','T'],['xm1014','T'],['sawedoff','T'],['mag7','CT']]){
      const {room,t:terrorist,ct}=fixture(),shooter=team==='T'?terrorist:ct,victim=team==='T'?ct:terrorist;
      assert.equal(room.buy(shooter.id,id).ok,true);
      Object.assign(shooter,lane.a,{vx:0,vz:0,grounded:true,nextShotAt:0,protectionUntil:0});
      Object.assign(victim,lane.b,{health:100,armor:0,protectionUntil:0});room.events.length=0;
      room.fire(shooter,{fire:true,yaw:lane.yaw,pitch:lane.pitch});
      assert.equal(shooter.inventory[id].ammo,WEAPONS[id].magazine-1);
      const shots=room.events.filter(event=>event.type==='shot');assert.equal(shots.length,1);assert.equal(shots[0].pellets.length,WEAPONS[id].pellets);
      assert.equal(room.events.filter(event=>event.type==='kill').length,1);assert.equal(victim.alive,false);
    }
  });

  await t.test('shell reload inserts one at a time and can be interrupted; magazine reload discards leftover rounds',()=>{
    const {room,t:terrorist,advance}=fixture();room.buy(terrorist.id,'nova');terrorist.inventory.nova={ammo:2,reserve:3};
    room.reload(terrorist);advance(WEAPONS.nova.reloadTime*1000+.1);room.tick();assert.deepEqual(terrorist.inventory.nova,{ammo:3,reserve:2});assert.ok(terrorist.reloadEndsAt>0);
    terrorist.nextShotAt=0;room.fire(terrorist,{fire:true,yaw:0,pitch:0});assert.equal(terrorist.reloadEndsAt,0);assert.equal(terrorist.inventory.nova.ammo,2);
    advance(5000);room.tick();assert.deepEqual(terrorist.inventory.nova,{ammo:2,reserve:2});
    room.buy(terrorist.id,'ak47');terrorist.inventory.ak47={ammo:12,reserve:60};room.reload(terrorist);advance(WEAPONS.ak47.reloadTime*1000+.1);room.tick();
    assert.deepEqual(terrorist.inventory.ak47,{ammo:30,reserve:30});
    const snap=room.snapshot().players.find(p=>p.id===terrorist.id);assert.equal(snap.reserveAmmoAsClips,true);assert.equal(snap.reserveClips,1);
  });

  await t.test('four-grenade cap, two-flash cap, throwing consumption and snapshot contracts are authoritative',()=>{
    const {room,t:terrorist,advance}=fixture();
    for(const id of ['hegrenade','flashbang','flashbang','smokegrenade'])assert.equal(room.buy(terrorist.id,id).ok,true);
    assert.equal(MAX_GRENADES,4);assert.equal(room.buy(terrorist.id,'flashbang').ok,false);assert.equal(room.buy(terrorist.id,'hegrenade').ok,false);
    room.receiveInput(terrorist.id,input(1,{slot:4,utilityId:'hegrenade'}));room.tick();assert.equal(terrorist.weapon,'hegrenade');
    advance(201);room.receiveInput(terrorist.id,input(2,{slot:4,utilityId:'hegrenade',fire:true}));room.tick();
    advance(210);room.receiveInput(terrorist.id,input(3,{slot:4,utilityId:'hegrenade',fire:false}));room.tick();
    assert.equal(terrorist.inventory.hegrenade,undefined);assert.equal(terrorist.weapon,'ak47');
    let snapshot=room.snapshot();assert.equal(snapshot.grenades.length,1);assert.equal(snapshot.grenades[0].weapon,'hegrenade');
    assert.deepEqual(snapshot.players.find(p=>p.id===terrorist.id).utilityCounts,{hegrenade:0,flashbang:2,smokegrenade:1});
    room.selectSlot(terrorist,4,'hegrenade');assert.equal(terrorist.weapon,'ak47');
    const grenade=room.grenades.projectiles[0];room.grenades.detonate({...grenade,weapon:'smokegrenade'});
    snapshot=room.snapshot();assert.equal(snapshot.smokes.length,1);assert.equal(snapshot.smokes[0].remaining,18);
    room.startRound();assert.equal(room.grenades.projectiles.length,0);assert.equal(room.grenades.smokes.length,0);
  });

  await t.test('HE damage obeys distance, team rules and wall occlusion',()=>{
    const {room,t:terrorist,ct}=fixture();
    Object.assign(ct,lane.b,{armor:0,health:100,protectionUntil:0});Object.assign(terrorist,lane.a,{protectionUntil:0});
    const grenade={ownerId:terrorist.id,team:'T',weapon:'hegrenade',x:ct.x,y:ct.y+1,z:ct.z};
    room.explodeGrenade(grenade,EQUIPMENT.hegrenade);assert.ok(ct.health<20);assert.ok(room.events.some(event=>event.type==='hit'&&event.weapon==='hegrenade'));
    ct.health=100;room.grenades.raycastWorld=()=>0;room.explodeGrenade(grenade,EQUIPMENT.hegrenade);assert.equal(ct.health,100);
  });

  await t.test('flash facing changes duration, walls block it and bots lose targets when blinded or behind smoke',()=>{
    const {room,t:terrorist,ct,now}=fixture();
    Object.assign(terrorist,lane.a,{yaw:lane.yaw,pitch:0,protectionUntil:0});Object.assign(ct,lane.b,{protectionUntil:0});
    const grenade={id:'flash',ownerId:ct.id,team:'CT',weapon:'flashbang',x:ct.x,y:ct.y+1.6,z:ct.z};
    room.flashGrenade(grenade,EQUIPMENT.flashbang);let flash=room.events.at(-1);const facing=flash.affected.find(p=>p.playerId===terrorist.id).duration;
    terrorist.yaw+=Math.PI;room.flashGrenade(grenade,EQUIPMENT.flashbang);flash=room.events.at(-1);assert.ok(flash.affected.find(p=>p.playerId===terrorist.id).duration<facing);
    terrorist.bot=true;terrorist.botAI.nextThinkAt=0;room.botInput(terrorist,1/30);assert.equal(terrorist.botAI.targetId,null);
    room.grenades.raycastWorld=()=>0;room.flashGrenade(grenade,EQUIPMENT.flashbang);assert.equal(room.events.at(-1).affected.some(p=>p.playerId===terrorist.id),false);
    terrorist.flashBlindUntil=0;terrorist.botAI.nextThinkAt=0;
    room.grenades.smokes.push({id:'smoke',x:(terrorist.x+ct.x)/2,y:terrorist.y+1.6,z:(terrorist.z+ct.z)/2,radius:4.5,expiresAt:now()+18000});
    room.botInput(terrorist,1/30);assert.equal(terrorist.botAI.targetId,null);
  });
});

test('grenade sweeps bounce, fuses expire and smoke blocks only during its bounded lifetime',()=>{
  let now=0;const events=[],sim=new GrenadeSimulation({clock:()=>now,emit:(type,fields)=>events.push({type,...fields}),raycastWorld:(origin,dir,max)=>{
    let nearest=Infinity;
    if(dir.y<0&&origin.y>=0)nearest=Math.min(nearest,-origin.y/dir.y);
    if(dir.z<0&&origin.z>=-2)nearest=Math.min(nearest,(-2-origin.z)/dir.z);
    return nearest<=max?nearest:null;
  }});
  sim.throwGrenade({id:'p',team:'T',x:0,y:0,z:0},'hegrenade',{yaw:0,pitch:0});
  for(let i=0;i<46;i++){now+=1000/30;sim.tick(1/30);}
  assert.equal(sim.projectiles.length,0);assert.equal(events.filter(e=>e.type==='explosion').length,1);
  assert.ok(events.find(e=>e.type==='explosion').origin.z>=-2);assert.ok(events.find(e=>e.type==='explosion').origin.y>=0);
  sim.detonate({id:'smoke',ownerId:'p',team:'T',weapon:'smokegrenade',x:0,y:0,z:0});
  assert.equal(sim.blocksSight({x:-10,y:1.3,z:0},{x:10,y:1.3,z:0}),true);
  assert.equal(sim.blocksSight({x:-10,y:1.3,z:10},{x:10,y:1.3,z:10}),false);
  now+=18001;sim.tick(1/30);assert.equal(sim.smokes.length,0);assert.equal(sim.blocksSight({x:-10,y:1.3,z:0},{x:10,y:1.3,z:0}),false);
});

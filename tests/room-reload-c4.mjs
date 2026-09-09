import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {GameRoom} from '../server/game.js';
import {startGameServer} from '../server/index.js';
import {getWeapon} from '../shared/weapons.js';
import {MAP} from '../shared/map-data.js';

const input=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,slot:1,...extra});
function fixture(mode='deathmatch',bots=0){let now=100000;const room=new GameRoom('NEWQA',{mode,bots,clock:()=>now});const p=room.addHuman({}, {name:'owner',team:'T'});return {room,p,advance:ms=>now+=ms,now:()=>now};}
test('room seats, reload milestones and C4 on the loaded map',async t=>{
  const app=await startGameServer({port:0,host:'127.0.0.1'});t.after(()=>app.close());
  await t.test('all ten seats have unique occupants when a human replaces a bot on a full side',()=>{
    const {room,p}=fixture('deathmatch',9);
    for(let i=0;i<9;i++)room.addHuman({}, {name:'friend',team:i%2?'T':'CT'});
    assert.equal(room.players.size,10);assert.equal(room.count('T'),5);assert.equal(room.count('CT'),5);
    for(const team of ['T','CT'])assert.equal(new Set(room.roomSeats()[team].map(s=>s.playerId)).size,5);
    assert.equal(room.setSeatBot(p.id,'T',p.seat,true).ok,false);
  });
  await t.test('host controls exact bot seats; occupied seats and non-host mutations are rejected',()=>{
    const {room,p}=fixture();const friend=room.addHuman({}, {name:'friend',team:'CT'});
    assert.equal(room.setSeatBot(friend.id,'CT',4,true).ok,false);
    assert.equal(room.setSeatBot(p.id,'CT',4,true).ok,true);
    assert.equal(room.roomSeats().CT[4].bot,true);assert.equal(room.takeSeat(p.id,'CT',4).ok,false);
    assert.equal(room.setSeatBot(p.id,'CT',4,false).ok,true);room.ensureBots();assert.equal(room.roomSeats().CT[4].playerId,null);
    assert.equal(room.takeSeat(p.id,'CT',4).ok,true);assert.equal(p.team,'CT');assert.equal(p.seat,4);
    assert.equal(room.takeSeat(p.id,'CT',5).ok,false);assert.equal(room.takeSeat(p.id,'CT',-1).ok,false);
    room.removePlayer(p.id);assert.equal(room.hostId,friend.id);
  });
  await t.test('changing side during defuse cannot revive a player or retain the bomb',()=>{
    const {room,p}=fixture('defuse');room.addHuman({}, {name:'CT',team:'CT'});room.round.phase='live';
    assert.ok(p.hasBomb);assert.ok(p.inventory.c4);const before=p.lifeId;
    assert.equal(room.takeSeat(p.id,'CT',4).ok,true);assert.equal(p.alive,false);assert.equal(p.hasBomb,false);assert.equal(p.inventory.c4,undefined);assert.ok(p.lifeId>before);
    room.pendingTransition={swapSides:true,resetMoney:800};room.startRound();assert.equal(room.roomSeats().T[4].playerId,p.id);
  });
  await t.test('held fire on empty gun does not reload; fresh release starts automatic reload',()=>{
    const {room,p,advance}=fixture();p.inventory.ak47.ammo=0;p.protectionUntil=0;p.nextShotAt=0;
    room.receiveInput(p.id,input(1,{fire:true}));advance(34);room.tick(1/30);assert.equal(p.reloadEndsAt,0);
    room.receiveInput(p.id,input(2,{fire:true}));advance(100);room.tick(1/30);assert.equal(p.reloadEndsAt,0);
    room.receiveInput(p.id,input(3,{fire:false}));advance(34);room.tick(1/30);assert.ok(p.reloadEndsAt>0);assert.equal(p.reloadEmpty,true);
  });
  await t.test('early cancel keeps ammo; late knife switch commits once and cannot bypass attack readiness',()=>{
    const {room,p,advance,now}=fixture();const a=p.inventory.ak47;a.ammo=3;a.reserve=90;room.reload(p);
    advance(p.reloadAmmoAt-now()-1);room.selectSlot(p,3);assert.equal(a.ammo,3);assert.equal(a.reserve,90);
    room.selectSlot(p,1);room.reload(p);const end=p.reloadEndsAt;advance(p.reloadAmmoAt-now()+1);
    room.selectSlot(p,3);assert.equal(a.ammo,30);assert.equal(a.reserve,60);
    room.selectSlot(p,1);room.cancelReload(p);assert.equal(a.reserve,60);p.nextShotAt=0;p.triggerWasDown=false;
    room.fire(p,input(4,{fire:true}));assert.equal(a.ammo,30);
    advance(end-now()+1);room.fire(p,input(5,{fire:true}));assert.equal(a.ammo,29);
  });
  await t.test('dropping at the magazine milestone preserves the inserted rounds in the pickup',()=>{
    const {room,p,advance,now}=fixture();p.inventory.ak47.ammo=0;room.reload(p);advance(p.reloadAmmoAt-now()+1);
    const result=room.dropWeapon(p.id);assert.equal(result.ok,true);const item=room.droppedWeapons.snapshot().find(d=>d.id===result.id);assert.equal(item.ammo,30);assert.equal(item.reserve,60);
    room.droppedWeapons.candidate=()=>room.droppedWeapons.items[0];assert.equal(room.pickupWeapon(p),true);p.nextShotAt=0;p.triggerWasDown=false;
    room.fire(p,input(1,{fire:true}));assert.equal(p.inventory.ak47.ammo,30,'drop and pickup cannot bypass reload attack lock');
  });
  await t.test('C4 supports slot 5, grounded left-hold planting, cancellation and removal after planting',()=>{
    const {room,p}=fixture('defuse');room.addHuman({}, {name:'CT',team:'CT'});room.round.phase='live';
    assert.equal(room.buy(p.id,'c4').ok,false);delete p.inventory.pistol;room.selectSlot(p,5);assert.equal(p.weapon,'c4');
    Object.assign(p,MAP.sites.A,{vx:0,vz:0,grounded:false,effectiveInput:{fire:true}});room.stepBomb(.5);assert.equal(room.bomb.progress,0);
    p.grounded=true;room.stepBomb(.5);assert.ok(room.bomb.progress>0);p.effectiveInput.fire=false;room.stepBomb(.1);assert.equal(room.bomb.progress,0);
    p.effectiveInput.fire=true;room.stepBomb(3);assert.equal(room.bomb.state,'planted');assert.equal(p.inventory.c4,undefined);assert.equal(p.hasBomb,false);assert.equal(p.weapon,'knife','planting without a gun must return to knife');
    assert.ok(room.events.some(e=>e.type==='bomb_action'));assert.ok(room.events.some(e=>e.type==='bomb_planted'));
  });
  await t.test('real WebSocket seat changes broadcast to a second peer and reject non-host bot management',async sub=>{
    const peers=[];sub.after(()=>peers.forEach(p=>p.ws.terminate()));
    async function connect(team){const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');
      const wait=async fn=>{for(let i=0;i<250;i++){const n=messages.findIndex(fn);if(n>=0)return messages.splice(n,1)[0];await delay(10);}throw Error('seat WS timeout');};
      ws.send(JSON.stringify({type:'join',room:'SEATWIRE',name:team,team,mode:'deathmatch',bots:0}));const id=(await wait(m=>m.type==='welcome')).id;const p={ws,messages,wait,id};peers.push(p);return p;}
    const host=await connect('T'),friend=await connect('CT');
    host.ws.send(JSON.stringify({type:'setSeatBot',team:'CT',seat:4,enabled:true}));
    const snapshot=await friend.wait(m=>m.type==='snapshot'&&m.seats?.CT[4].bot);assert.equal(snapshot.seats.CT.length+snapshot.seats.T.length,10);
    friend.ws.send(JSON.stringify({type:'setSeatBot',team:'CT',seat:4,enabled:false}));assert.equal((await friend.wait(m=>m.type==='error')).code,'SEAT_REJECTED');
    await delay(320);host.ws.send(JSON.stringify({type:'takeSeat',team:'CT',seat:3}));await friend.wait(m=>m.type==='snapshot'&&m.seats?.CT[3].playerId===host.id);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {buyForTeam,planTeamBuy,settleEconomy,lossIncome,saveGoal} from '../server/bot-economy.js';
import {MAP} from '../shared/map-data.js';
import {getWeapon} from '../shared/weapons.js';
initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(money=2000){
 const room=new GameRoom('ECO',{bots:0,clock:()=>100000});
 for(let i=0;i<10;i++){const team=i<5?'CT':'T',p=room.makePlayer('b_'+i,'Bot '+i,team,true);p.seat=i%5;p.teamId=room.teamForSide(team);room.players.set(p.id,p);room.respawn(p);p.money=money;}
 room.round={number:3,phase:'freeze',buyEndsAt:120000};room.match.roundsPlayed=2;
 return {room,ct:[...room.players.values()].filter(p=>p.team==='CT'),ts:[...room.players.values()].filter(p=>p.team==='T')};
}
test('team ECO preserves cash, then synchronizes a full buy after income rather than perpetual SMGs',()=>{
 const {room,ts}=fixture(2000);assert.equal(planTeamBuy(room,'T').kind,'eco');buyForTeam(room);
 assert.ok(ts.every(p=>p.money===2000&&!Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)));
 settleEconomy(room,'CT','T 全部被击败');ts.forEach(p=>p.alive=false);room.startRound();assert.equal(room.teamBuys.T.kind,'half');
 assert.ok(ts.every(p=>p.money+lossIncome(room,'T')>=4500));
 settleEconomy(room,'CT','T 全部被击败');ts.forEach(p=>p.alive=false);room.startRound();assert.equal(room.teamBuys.T.kind,'full');
 assert.ok(ts.every(p=>Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)&&p.armor===100));
});
test('half buys protect the next rifle budget and last half/match point rounds force available money',()=>{
 const {room,ct}=fixture(3400);room.lossLevels.A=3;assert.equal(planTeamBuy(room,'CT').kind,'half');buyForTeam(room);assert.ok(ct.every(p=>p.money+2900>=4800));
 room.match.roundsPlayed=11;assert.equal(planTeamBuy(room,'CT').kind,'force');room.match.roundsPlayed=7;room.scores.T=12;assert.equal(planTeamBuy(room,'CT').kind,'force');
 room.match.period='overtime';room.match.roundsPlayed=26;room.scores.T=12;room.match.winTarget=16;assert.equal(planTeamBuy(room,'CT').kind,'force');
});
test('full buys respect cash, carried weapons, armor, limited kits and utility caps',()=>{
 const {room,ct,ts}=fixture(5500);room.giveWeapon(ts[0],'awp');buyForTeam(room);
 assert.equal(room.teamBuys.T.kind,'full');assert.ok(ts[0].inventory.awp);assert.ok([...ct,...ts].every(p=>p.money>=0&&p.armor===100&&p.helmet));
 assert.equal(ct.filter(p=>p.defuseKit).length,2);assert.ok(ts.every(p=>!p.defuseKit));
 for(const p of [...ct,...ts])assert.ok(Object.keys(p.inventory).filter(id=>getWeapon(id).slot===1).length===1);
});
test('pistol rounds spread armor and utility without buying a main gun',()=>{
 const {room,ct,ts}=fixture(800);room.round.number=1;buyForTeam(room);
 assert.equal(room.teamBuys.T.kind,'pistol');assert.equal(ct.filter(p=>p.defuseKit).length,1);assert.ok(ts.some(p=>p.inventory.smokegrenade));assert.equal(ts.filter(p=>p.armor===100).length,4);
});
test('loss tiers climb to a cap, wins reduce one tier, objective rewards and timeout survival are distinct',()=>{
 const {room,ct,ts}=fixture(0);const received=[];for(let i=0;i<5;i++){const before=ts[0].money;settleEconomy(room,'CT','T 全部被击败');received.push(ts[0].money-before);}
 assert.deepEqual(received,[1900,2400,2900,3400,3400]);settleEconomy(room,'T','CT 全部被击败');assert.equal(room.lossLevels.B,3);assert.equal(lossIncome(room,'T'),2900);
 room.bomb={state:'defused',plantedAt:1};ct.forEach(p=>p.money=0);ts.forEach(p=>p.money=0);settleEconomy(room,'CT','炸弹已拆除');assert.equal(ct[0].money,3500);assert.equal(ts[0].money,3700);
 room.bomb=room.emptyBomb();ts[0].money=0;settleEconomy(room,'CT','回合时间耗尽');assert.equal(ts[0].money,0);
});
test('a distant CT saves an impossible retake, but a viable or active defuse is supported',()=>{
 const {room,ct}=fixture(5000),p=ct[0];room.round.phase='live';room.giveWeapon(p,'m4a1');Object.assign(p,MAP.spawns.CT[0]);room.bomb={state:'planted',...MAP.sites.B,explodesAt:103000};
 assert.ok(saveGoal(room,p));room.bomb.explodesAt=145000;p.botAI.saveGoal=null;assert.equal(saveGoal(room,p),null);
 room.bomb.explodesAt=103000;room.bomb.action='defuse';room.bomb.actorId=ct[1].id;assert.equal(saveGoal(room,p),null);
});

test('four CT bots and a human still select a funded AWPer and upgrade a carried rifle',()=>{
 const {room,ct}=fixture(10000);ct[4].bot=false;room.giveWeapon(ct[3],'m4a1');buyForTeam(room);assert.equal(ct.filter(p=>p.bot&&p.inventory.awp).length,1);assert.ok(ct[3].inventory.awp);assert.ok(room.droppedWeapons.items.some(i=>i.weaponId==='m4a1'));assert.ok(ct.every(p=>p.money>=0));
});

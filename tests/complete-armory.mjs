import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WEAPONS,WEAPON_ORDER} from '../shared/weapons.js';
import {normalizeWeaponLoadout,replaceLoadoutSlot,startingPistolForTeam,canReplaceLoadoutSlot,loadoutCandidates} from '../shared/weapon-loadout.js';
import {WEAPON_ACCURACY} from '../shared/weapon-accuracy-data.js';
import {WEAPON_BALLISTICS} from '../shared/weapon-ballistics.js';
import {DEFAULT_SKINS,getSkin} from '../shared/skins.js';
import {reloadProfile} from '../shared/reload-profiles.js';
import {GameRoom} from '../server/game.js';
const added=['hkp2000','cz75a','revolver','aug','famas','g3sg1','mp5sd','p90','ump45','m249','negev'];
test('full standard firearm roster is selectable in legal carry slots',()=>{
 assert.equal(WEAPON_ORDER.filter(id=>WEAPONS[id].slot<3).length,34);
 for(const id of WEAPON_ORDER.filter(id=>id!=='knife'))for(const team of WEAPONS[id].teams){
  const group=WEAPONS[id].category,index=['usp','hkp2000','pistol'].includes(id)?0:group==='pistols'?1:0;
  assert(canReplaceLoadoutSlot(team,group,index,id));
  const config=replaceLoadoutSlot(null,team,group,index,id);assert.equal(config[team][group][index],id);
  assert.equal(new Set(config[team][group]).size,5);assert.equal(config[team][group].length,5);
 }
 assert(!canReplaceLoadoutSlot('CT','pistols',1,'hkp2000'));assert(!canReplaceLoadoutSlot('T','rifles',0,'aug'));
 const untrusted=normalizeWeaponLoadout({CT:{pistols:['hkp2000','usp','hkp2000','cz75a','revolver']}});
 assert.equal(untrusted.CT.pistols[0],'hkp2000');assert(!untrusted.CT.pistols.includes('usp'));assert.equal(untrusted.CT.pistols.length,5);
 assert.equal(startingPistolForTeam(null,'CT'),'usp');
});
test('CT P2000 configuration survives join, round respawn and team changes',()=>{
 let now=100000;const room=new GameRoom('P2K',{mode:'defuse',bots:0,clock:()=>now});
 const config=replaceLoadoutSlot(null,'CT','pistols',0,'hkp2000');
 const p=room.addHuman({}, {name:'P2000',team:'CT',weaponLoadout:config});
 assert(p.inventory.hkp2000);assert(!p.inventory.usp);assert.equal(p.weapon,'hkp2000');
 p.alive=false;room.respawn(p,true);assert(p.inventory.hkp2000);assert.equal(p.weapon,'hkp2000');
 assert(room.takeSeat(p.id,'T',0).ok);assert(p.inventory.pistol);assert(!p.inventory.hkp2000);
 assert(room.takeSeat(p.id,'CT',0).ok);assert(p.inventory.hkp2000);assert(!p.inventory.usp);
});
test('every added gun has real accuracy, ballistics, reload timing and pristine finish',()=>{
 const audio=JSON.parse(fs.readFileSync(new URL('../public/assets/audio/cs2/manifest.json',import.meta.url)));
 for(const id of added){
  const w=WEAPONS[id];assert(w.price>0&&w.magazine>0&&w.reserve>0&&w.fireInterval>0,id);
  assert(WEAPON_ACCURACY[id]);assert(Number.isFinite(WEAPON_BALLISTICS[id]?.penetration));
  assert(reloadProfile(id)?.commitFraction>0,id);assert(audio.banks[id]?.length,id);assert(audio.banks[id+'Draw']?.length,id);
  const skin=getSkin(DEFAULT_SKINS[id]);assert.equal(skin.weapon,id);assert.equal(skin.condition,'Factory New');assert.equal(skin.wear,0);
  assert(skin.animation,`${id} animations load with its model`);
  const b=fs.readFileSync(new URL('../public/'+skin.animation.model,import.meta.url)),doc=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  for(const action of ['draw','idle','shoot','reload','inspect'])assert(doc.animations.some(a=>a.name===`${id}/${action}`),id+'/'+action);
 }
 assert.deepEqual(WEAPONS.aug.zoomFovs,[90,45]);assert.deepEqual(WEAPONS.g3sg1.zoomFovs,[90,40,15]);
 assert.equal(WEAPON_BALLISTICS.mp5sd.tracerFrequency,0);
});
test('all firearms purchase and shoot on the authoritative server after configuration',()=>{
 for(const id of WEAPON_ORDER.filter(id=>id!=='knife')){
  let now=100000;const w=WEAPONS[id],team=w.teams[0],room=new GameRoom('ALLGUN',{mode:'deathmatch',bots:0,clock:()=>now});
  const p=room.makePlayer('human','Armory QA',team,false);room.players.set(p.id,p);
  const index=['usp','hkp2000','pistol'].includes(id)?0:w.category==='pistols'?1:0;
  assert(room.setWeaponLoadout(p.id,replaceLoadoutSlot(null,team,w.category,index,id)).ok,id);
  room.mode='defuse';room.round.phase='freeze';room.round.buyEndsAt=now+30000;p.money=16000;assert(room.buy(p.id,id).ok,id);assert.equal(p.money,16000-w.price,id);
  now+=5000;p.protectionUntil=0;p.triggerWasDown=false;room.events=[];
  room.fire(p,{fire:true,yaw:0,pitch:0});assert.equal(p.inventory[id].ammo,w.magazine-1,id);assert(room.events.some(e=>e.type==='shot'&&e.weapon===id),id);
  assert(loadoutCandidates(team,w.category).includes(id));
 }
});

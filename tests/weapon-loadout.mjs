import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWeaponLoadout,replaceLoadoutSlot,loadoutCandidates} from '../shared/weapon-loadout.js';
import {GameRoom} from '../server/game.js';
import {snapshotForSide} from '../server/snapshot-view.js';
import {filterSkins} from '../client/skin-library.js';
import {DEFAULT_SKINS,SKINS} from '../shared/skins.js';
test('carry slots normalize untrusted values, keep five unique legal items and lock the starting pistol',()=>{
 const value=normalizeWeaponLoadout({CT:{pistols:['ak47','deagle','deagle','usp'],mid:['sawedoff','xm1014']},T:{rifles:['m4a1','awp']}});
 for(const team of ['CT','T'])for(const group of ['pistols','mid','rifles']){assert.equal(value[team][group].length,5);assert.equal(new Set(value[team][group]).size,5);assert(value[team][group].every(id=>loadoutCandidates(team,group).includes(id)));}
 assert.equal(value.CT.pistols[0],'usp');assert.equal(value.T.pistols[0],'pistol');assert.deepEqual(replaceLoadoutSlot(value,'CT','pistols',0,'deagle'),value);
 const swapped=replaceLoadoutSlot(null,'CT','rifles',0,'awp');assert.equal(swapped.CT.rifles[0],'awp');assert.equal(swapped.CT.rifles[4],'scar20');
 const replaced=replaceLoadoutSlot(null,'CT','mid',4,'xm1014');assert.equal(replaced.CT.mid[4],'xm1014');assert(!replaced.CT.mid.includes('bizon'));
});
test('server enforces configured purchases without removing carried guns, and protects opposing loadout data',()=>{
 const room=new GameRoom('CARRY',{mode:'deathmatch',bots:0,clock:()=>100000});
 const p=room.makePlayer('human','Human','CT',false);room.players.set(p.id,p);room.respawn(p);
 const next=replaceLoadoutSlot(null,'CT','mid',4,'xm1014');assert(room.setWeaponLoadout(p.id,next).ok);
 assert(room.buy(p.id,'xm1014').ok);assert.equal(room.buy(p.id,'bizon').ok,false);assert(p.inventory.xm1014);
 const snapshot=room.snapshot();assert.deepEqual(p.weaponLoadout,next);assert(snapshot.players.every(p=>!('weaponLoadout' in p)));assert(!('weaponLoadout' in snapshotForSide(snapshot,'T').players[0]));
 room.mode='defuse';room.round.phase='live';assert.equal(room.setWeaponLoadout(p.id,null).ok,false);room.round.phase='freeze';assert(room.setWeaponLoadout(p.id,null).ok);assert(p.inventory.xm1014);
 p.controlledBotId='bot';assert.equal(room.setWeaponLoadout(p.id,next).ok,false);
});
test('skin library filters existing finishes without needing model downloads',()=>{
 assert.equal(filterSkins().length,SKINS.length);assert(filterSkins({query:'野荷'}).every(s=>s.weapon==='ak47'));assert.equal(filterSkins({query:'DOES NOT EXIST'}).length,0);
 const knives=filterSkins({category:'melee'});assert(knives.some(s=>s.id.includes('butterfly')));assert(knives.some(s=>s.id.includes('m9')));
 assert.equal(filterSkins({availability:'equipped',loadout:DEFAULT_SKINS}).length,Object.keys(DEFAULT_SKINS).length);
 assert.deepEqual(filterSkins({availability:'saved',downloaded:new Set(['ak47-vulcan'])}).map(s=>s.id),['ak47-vulcan']);
});

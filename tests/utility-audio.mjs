import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {UTILITY_AUDIO,utilitySound} from '../client/utility-audio.js';
const listener={x:0,y:0,z:0,yaw:0},origin={x:2,y:0,z:0};
test('utility sound mappings reference real exported CS2 samples with distinct throw/bounce and ignition cues',()=>{
 const manifest=JSON.parse(fs.readFileSync('public/assets/audio/cs2/manifest.json','utf8'));
 for(const config of Object.values(UTILITY_AUDIO))for(const bank of Object.values(config))for(const file of manifest.banks[bank]||[]){assert.ok(fs.statSync('public/assets/audio/cs2/'+file).size>100);}
 for(const config of Object.values(UTILITY_AUDIO))for(const bank of Object.values(config))assert.ok(manifest.banks[bank]?.length,bank);
 const file=bank=>manifest.banks[bank][0];assert.notEqual(file('incgrenadeThrow'),file('decoyThrow'));assert.notEqual(file('molotovIgnite'),file('incgrenadeIgnite'));assert.match(file('smokegrenadeDetonate'),/smoke_emit/);
 assert.equal(new Set(['grenadeBounce','flashbangBounce','smokegrenadeBounce','molotovBounce','incgrenadeBounce'].map(file)).size,5);
});
test('smoke, flash, HE, decoy and fire events choose their own sound and attenuate with distance',()=>{
 const events=[{type:'smoke'},{type:'flash'},{type:'explosion',weapon:'hegrenade'},{type:'explosion',weapon:'decoy'},{type:'fire_started',weapon:'molotov'},{type:'fire_started',weapon:'incgrenade'}];
 for(const e of events){const near=utilitySound({...e,origin},listener,'me'),far=utilitySound({...e,origin:{x:50,y:0,z:0}},listener,'me');assert.ok(near.bank);assert.ok(near.level>far.level);assert.ok(near.pan>0);}
 assert.equal(utilitySound({type:'flash',origin:{x:200,y:0,z:0}},listener,'me'),null);
 assert.equal(utilitySound({type:'grenade_primed',weapon:'flashbang',playerId:'other'},listener,'me'),null);
 assert.equal(utilitySound({type:'grenade_primed',weapon:'flashbang',playerId:'me'},listener,'me').bank,'flashbangPin');
 assert.equal(utilitySound({type:'fire_failed',weapon:'incgrenade',origin},listener,'me').bank,'incgrenadeFailed');
});

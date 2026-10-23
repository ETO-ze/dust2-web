import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GameAudio} from '../client/audio.js';
import {ViewWeapon} from '../client/viewmodel.js';
import {DEFAULT_SKINS,getSkin} from '../shared/skins.js';
import {reloadProfile} from '../shared/reload-profiles.js';

test('R8 authored primary, secondary and preparation clips are available in the locked asset',()=>{
  const skin=getSkin(DEFAULT_SKINS.revolver);
  const bytes=fs.readFileSync(new URL('../public/'+skin.animation.model,import.meta.url));
  const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  for(const name of ['draw','idle','prepare','shoot','shoot2','reload','inspect']){
    assert(doc.animations.some(clip=>clip.name==='revolver/'+name),name);
  }
});

test('equipping R8 warms every reload event bank and its preparation sample',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/audio/cs2/manifest.json',import.meta.url)));
  const audio=new GameAudio(),loaded=new Set(),played=[];
  audio.sampleManifest=manifest;audio.loadBank=async bank=>{loaded.add(bank);return true;};
  audio.prepareWeapon('revolver');
  for(const {bank} of reloadProfile('revolver').sounds){assert(manifest.banks[bank]);assert(loaded.has(bank),bank);}
  audio.play=(bank,options)=>played.push({bank,...options});
  audio.prepareRevolver();
  assert.equal(played[0].bank,'anim_weapon_revolver_barrelroll');
  assert.equal(played[0].channel,'revolver-prepare');
  assert(loaded.has(played[0].bank));
});

test('R8 viewmodel selects shoot2 for secondary and cancels its preparation pose on release',()=>{
  const view=Object.create(ViewWeapon.prototype),calls=[];
  Object.assign(view,{id:'revolver',active:{actionName:'idle',actions:{inspect:{}}},waiting:false});
  view.playOn=(item,name,_fade,duration)=>{calls.push({name,duration});item.actionName=name;};
  view.prepareRevolver(true,.25);view.prepareRevolver(true,.25);
  assert.deepEqual(calls.map(x=>x.name),['prepare']);assert.equal(calls[0].duration,.25);
  assert.equal(view.inspect(),false);
  view.prepareRevolver(false);assert.equal(view.active.actionName,'idle');
  view.shoot({fireMode:'secondary'});assert.equal(view.active.actionName,'shoot2');
  view.shoot({fireMode:'primary'});assert.equal(view.active.actionName,'shoot');
  assert.equal(view.revolverPreparing,false);
});

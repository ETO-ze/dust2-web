import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {getWeapon} from '../shared/weapons.js';
import {ShotPrediction} from '../client/shot-prediction.js';
import {RevolverTrigger,REVOLVER_PRIMARY_FIRE_DELAY_MS,weaponFireInterval} from '../shared/revolver.js';

// Execute the production prediction function with a clock and transport, without
// booting WebGL or claiming to have exercised browser rendering/audio devices.
const main=fs.readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
const source=main.slice(main.indexOf('function localShoot('),main.indexOf('\nasync function lockPointer'));
function fixture(){
  let now=0,seq=0,lastSent=-1;const packets=[],poses=[],sounds=[];
  const env={getWeapon,REVOLVER_PRIMARY_FIRE_DELAY_MS,weaponFireInterval,
    revolverTrigger:new RevolverTrigger(),shotPrediction:new ShotPrediction(),
    performance:{now:()=>now},WebSocket:{OPEN:1},socket:{readyState:1},
    self:{alive:true,weapon:'revolver',slot:2,ammo:8,reloadRemaining:0,fireReadyRemaining:0},
    slot:2,fireTimer:0,shotId:0,ping:0,lastSnapshotAt:0,lastShotWarning:0,lastShot:0,recoil:0,lookPitch:0,
    pendingFirePress:false,pendingAltFirePress:false,
    hud:{toast:()=>{}},
    viewWeapon:{prepareRevolver:(value)=>poses.push({at:now,prepare:value}),shoot:options=>poses.push({at:now,shot:options.fireMode})},
    audio:{cancelChannel:()=>{},cancelDraw:()=>{},prepareRevolver:()=>sounds.push('prepare'),shot:()=>sounds.push('shot')},
    sendInput:input=>{if(input.seq<=lastSent)return false;lastSent=input.seq;packets.push({...input});return true;},
  };
  env.cancelRevolverPrepare=()=>{env.revolverTrigger.reset();env.viewWeapon.prepareRevolver(false);};
  const shoot=vm.runInNewContext('('+source+')',env);
  const frame=(time,dt,extra={})=>{now=time;env.lastSnapshotAt=now;shoot({seq:++seq,fire:true,fire2:false,...extra},dt/1000);};
  return {env,packets,poses,sounds,frame,shots:()=>packets.filter(p=>p.shotId)};
}

test('client prepares without reserving ammo or emitting a shot, then sends one numbered discharge',()=>{
  const f=fixture();f.frame(0,0);assert.equal(f.packets.length,1);assert.equal(f.packets[0].shotId,undefined);
  f.frame(249,249);assert.equal(f.shots().length,0);assert.equal(f.env.shotPrediction.pending.length,0);
  assert.deepEqual(f.sounds,['prepare']);
  f.frame(250,1);assert.equal(f.shots().length,1);assert.equal(f.shots()[0].shotId,1);
  assert.equal(f.env.shotPrediction.pending.length,1);assert.deepEqual(f.sounds,['prepare','shot']);
  f.frame(266,16);assert.equal(f.poses.filter(p=>p.prepare).length,1,'discharge pose survives the next tick');
  f.frame(500,234);assert.equal(f.poses.filter(p=>p.prepare).length,2);
  f.frame(749,249);assert.equal(f.shots().length,1);
  f.frame(750,1);assert.equal(f.shots().length,2);assert.equal(f.shots()[1].shotId,2);
});

test('client release and reload cancel preparation without a numbered command or shot sound',()=>{
  for(const extra of [{fire:false},{reload:true}]){
    const f=fixture();f.frame(0,0);f.frame(100,100,extra);
    assert.equal(f.env.revolverTrigger.startedAt,null);assert.equal(f.shots().length,0);
    assert.equal(f.sounds.includes('shot'),false);
    f.frame(250,150);assert.equal(f.shots().length,0);
    f.frame(500,250);assert.equal(f.shots().length,1);
  }
});

test('client secondary input immediately selects shoot2 mode and shares the 400 ms authority cadence',()=>{
  const f=fixture(),input={fire:false,fire2:true};f.frame(0,0,input);
  assert.equal(f.shots().length,1);assert.equal(f.shots()[0].fire2,true);
  assert.equal(f.poses.find(p=>p.shot).shot,'secondary');assert.equal(f.sounds.includes('prepare'),false);
  f.frame(399,399,input);assert.equal(f.shots().length,1);
  f.frame(400,1,input);assert.equal(f.shots().length,2);
});

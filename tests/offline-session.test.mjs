import test from 'node:test';
import assert from 'node:assert/strict';
import {MatchClock} from '../client/offline/clock.js';
import {OfflineSession} from '../client/offline/session.js';
import {normalizeLayout,parseLayout,layoutRect} from '../shared/touch-layout.js';
import {FramePacer} from '../shared/frame-pacer.js';

test('frame cap follows real refresh rate, with no resolution degradation',()=>{
  for(const refresh of [60,90,120,144])for(const target of [30,60,90,120]){
    const p=new FramePacer();let rendered=0;
    for(let i=0;i<refresh*10;i++)if(p.due(i*1000/refresh,target))rendered++;
    assert.ok(Math.abs(rendered-Math.min(refresh,target)*10)<=1,`${refresh}/${target}: ${rendered}`);
  }
});

test('30 Hz simulation and 15 Hz snapshots stay independent of 30/60/90/120/144 Hz wakeups',()=>{
  for(const fps of [30,60,90,120,144]){let ticks=0,snapshots=0;const clock=new MatchClock({tick:()=>ticks++,snapshot:()=>snapshots++,startTime:0});
    for(let i=0;i<fps*10;i++)clock.advance(1000/fps);
    assert.equal(ticks,300);assert.equal(snapshots,150);assert.ok(Math.abs(clock.time-10000)<1e-5);}
});
test('pausing freezes match time, stall catchup is bounded',()=>{
  let ticks=0;const c=new MatchClock({tick:()=>ticks++,snapshot(){},startTime:0});c.advance(100);c.pause(true);c.advance(60000);assert.equal(ticks,3);assert.equal(c.time,100);
  c.pause(false);c.advance(1000/30);assert.equal(ticks,4);c.advance(60000);assert.equal(ticks,7);assert.ok(c.droppedMs>59000);
});
test('offline uses original room, economic commands, paused state, and side-private snapshot',()=>{
  const messages=[],session=new OfflineSession(m=>messages.push(m));
  session.join({name:'Tester',mode:'defuse',bots:4,team:'CT',botDifficulty:'hard'});
  const welcome=messages.find(m=>m.type==='welcome');assert.equal(welcome.botDifficulty,'hard');assert.equal(welcome.botCount,4);
  session.send({type:'buy',weapon:'vest'});assert.ok(messages.some(m=>m.type==='purchase'));
  session.pause(true);const time=session.clock.time;session.clock.advance(10000);assert.equal(session.clock.time,time);
  session.send({type:'setBotDifficulty',botDifficulty:'normal'});assert.equal(session.room.botDifficulty,'normal');
  session.send({type:'setBots',bots:9});assert.equal(session.room.players.size,10);
  session.send({type:'ping',time:12});assert.equal(messages.at(-1).time,12);
  session.pause(false);session.clock.advance(100);assert.ok(messages.filter(m=>m.type==='snapshot').length>=2);
});
test('layout sharing rejects invalid values and controls remain within resized viewport',()=>{
  assert.throws(()=>parseLayout('invalid'));assert.throws(()=>parseLayout('{"version":2}'));
  const layout=normalizeLayout({version:1,buttons:{fire:{x:1,y:1,size:9,opacity:-1},unknown:{}}});
  assert.equal(layout.buttons.fire.size,1.5);assert.equal(layout.buttons.fire.opacity,.25);assert.equal(layout.buttons.unknown,undefined);
  for(const [w,h] of [[320,640],[873,393],[1440,900]]){const r=layoutRect(layout.buttons.fire,{width:76,height:76},w,h);assert.ok(r.left+r.width<=w&&r.top+r.height<=h);}
});

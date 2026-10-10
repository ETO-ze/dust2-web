import test from 'node:test';
import assert from 'node:assert/strict';
import {PurchaseQueue} from '../client/purchase-queue.js';
function fixture(){let now=0,serial=0;const timers=new Map(),sent=[],expired=[];const queue=new PurchaseQueue({send:item=>sent.push({...item,time:now}),clock:()=>now,schedule:(fn,delay)=>{timers.set(++serial,{fn,at:now+delay});return serial;},cancel:id=>timers.delete(id),onTimeout:()=>expired.push(now)});function advance(ms){const until=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>until)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=until;}return{queue,sent,expired,advance};}
test('rapid purchases and refund preserve order, send one at a time and share the rate window',()=>{
 const f=fixture();for(const weapon of ['ak47','armor','smokegrenade','flashbang'])assert(f.queue.enqueue({type:'buy',weapon}));
 assert.equal(f.sent.length,1);assert.equal(f.queue.pending.length,4);f.advance(90);f.queue.settle();f.advance(179);assert.equal(f.sent.length,1);f.advance(1);assert.equal(f.sent[1].weapon,'armor');
 f.advance(400);f.queue.settle();assert.equal(f.sent[2].time,670);f.queue.settle();f.advance(270);assert.equal(f.sent[3].weapon,'flashbang');
 f.queue.enqueue({type:'refund',weapon:'ak47'});f.queue.settle();f.advance(270);assert.equal(f.sent[4].type,'refund');
 for(let i=1;i<f.sent.length;i++)assert(f.sent[i].time-f.sent[i-1].time>=270);
});
test('timeout and disconnection discard queued purchases instead of replaying them in another round',()=>{
 const f=fixture();f.queue.enqueue({weapon:'ak47'});f.queue.enqueue({weapon:'awp'});f.advance(5000);assert.equal(f.expired.length,1);assert.equal(f.queue.pending.length,0);f.advance(6000);assert.equal(f.sent.length,1);
 f.queue.enqueue({weapon:'m4a1'});f.queue.enqueue({weapon:'armor'});f.queue.clear();f.advance(6000);assert.equal(f.sent.length,2);
});
test('purchase queue is bounded even during a stalled acknowledgement',()=>{const f=fixture();for(let i=0;i<16;i++)assert(f.queue.enqueue({weapon:'flashbang'}));assert.equal(f.queue.enqueue({weapon:'flashbang'}),false);});

import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio} from '../client/audio.js';

function nativeContext(){
 const nodes=[],connections=[],calls=[];
 const node=kind=>{const value={kind,connect:other=>connections.push([kind,other.kind||'destination']),gain:{value:0,setTargetAtTime:value=>calls.push(['volume',value])},threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0}};nodes.push(value);return value;};
 return{destination:{},currentTime:2,state:'running',nodes,connections,calls,
  createDynamicsCompressor:()=>node('compressor'),createGain:()=>node('master'),createWaveShaper:()=>node('limiter'),resume(){calls.push(['resume']);return Promise.resolve();}};
}

test('an already unlocked context is adopted, and resume builds its graph without starting sample downloads',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'window');t.after(()=>{if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;});
 let created=0;globalThis.window={AudioContext:class{constructor(){created++;throw Error('Must reuse the gesture context');}}};
 const context=nativeContext(),audio=new GameAudio({context});let samples=0;audio.loadSamples=async()=>{samples++;};audio.setVolume(.35);
 assert.equal(audio.ctx,context);assert.equal(context.nodes.length,0);
 const unlock=audio.resume();assert.deepEqual(context.calls,[['resume']]);assert.equal(context.nodes.length,3);assert.equal(samples,0);assert.equal(audio.loading,null);
 await unlock;assert.equal(created,0);assert.equal(audio.master.gain.value,.35);assert.equal(audio.mix.threshold.value,-12);
 assert.deepEqual(context.connections,[['compressor','master'],['master','limiter'],['limiter','destination']]);
 const limiter=context.nodes.find(node=>node.kind==='limiter');assert.equal(limiter.curve.length,4097);assert.equal(limiter.oversample,'2x');assert.equal(audio.ready,false);
 await audio.resume();assert.equal(context.nodes.length,3);assert.equal(context.connections.length,3);assert.equal(samples,0);
 await audio.start();await audio.start();assert.equal(samples,1);assert.equal(audio.ready,true);assert.equal(audio.ctx,context);
});

test('default construction still creates one interactive context and repeated resume does not duplicate the graph',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'window');t.after(()=>{if(old)Object.defineProperty(globalThis,'window',old);else delete globalThis.window;});
 const context=nativeContext(),options=[];globalThis.window={AudioContext:class{constructor(value){options.push(value);return context;}}};
 const audio=new GameAudio();assert.equal(audio.ctx,null);
 await Promise.all([audio.resume(),audio.resume()]);assert.equal(audio.ctx,context);assert.deepEqual(options,[{latencyHint:'interactive'}]);assert.equal(context.nodes.length,3);assert.equal(context.calls.length,2);assert.equal(audio.ready,false);
});

test('adopted resume rejection leaves sample loading untouched and can recover on a later gesture',async()=>{
 const context=nativeContext(),audio=new GameAudio({context});let samples=0,fail=true;audio.loadSamples=async()=>{samples++;};context.resume=()=>fail?Promise.reject(new Error('Gesture required')):Promise.resolve();
 await assert.rejects(audio.start(),/Gesture required/);assert.equal(samples,0);assert.equal(audio.loading,null);assert.equal(audio.ready,false);
 fail=false;await audio.start();assert.equal(samples,1);assert.equal(audio.ready,true);assert.equal(context.nodes.length,3);
});

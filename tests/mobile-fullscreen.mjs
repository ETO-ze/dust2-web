import test from 'node:test';import assert from 'node:assert/strict';
import {requestGameFullscreen} from '../shared/mobile-fullscreen.js';
test('fullscreen request is synchronous within gesture, hides navigation and then locks landscape',async()=>{
 let requested=false,orientation=false;const doc={documentElement:{requestFullscreen(options){requested=true;assert.equal(options.navigationUI,'hide');doc.fullscreenElement=this;return Promise.resolve();}}};
 const promise=requestGameFullscreen({doc,nav:{userActivation:{isActive:true}},screenObject:{orientation:{lock(mode){orientation=true;assert.equal(mode,'landscape');}}},native:false});
 assert.equal(requested,true);assert.equal(orientation,false);assert.equal((await promise).fullscreen,true);assert.equal(orientation,true);
});
test('rejected orientation lock preserves fullscreen success',async()=>{const doc={fullscreenElement:{}};assert.equal((await requestGameFullscreen({doc,nav:{},screenObject:{orientation:{lock(){throw Error('unsupported');}}},native:false})).fullscreen,true);});
test('unsupported, denied and missing-gesture paths fail without crashing the game',async()=>{
 assert.equal((await requestGameFullscreen({doc:{documentElement:{}},nav:{},screenObject:{},native:false})).reason,'unsupported');
 const doc={documentElement:{requestFullscreen(){throw Error('denied');}}};assert.equal((await requestGameFullscreen({doc,nav:{userActivation:{isActive:false}},screenObject:{},native:false})).reason,'gesture');assert.equal((await requestGameFullscreen({doc,nav:{},screenObject:{},native:false})).reason,'denied');
});
test('native app does not require a browser fullscreen request',async()=>{assert.deepEqual(await requestGameFullscreen({doc:{},nav:{},screenObject:{},native:true}),{fullscreen:true,native:true});});

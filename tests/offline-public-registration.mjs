import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {publicPoolAssetCacheBase} from '../shared/public-map-paths.js';

const source=(await readFile(new URL('../client/offline.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replace(/export /g,'');
function fixture({page='https://game.test/',bundled=false,privateMap=false}={}){
 const registrations=[],listeners=new Map(),messages=[];
 const context=vm.createContext({URL,Promise,bundled,publicPoolAssetCacheBase,isSecureContext:true,
  document:{baseURI:page},matchMedia:()=>({matches:false}),
  navigator:{onLine:true,userAgent:bundled?'DustIIAndroid/1.2.0':'Chrome',serviceWorker:{ready:Promise.resolve(),register:async(url,options)=>{registrations.push({url:String(url),options});return{active:{postMessage:message=>messages.push(message)}};}}},
  window:{addEventListener:(name,handler)=>listeners.set(name,handler)},
 });
 if(privateMap)context.__DUST2_PRIVATE_MAP__={id:'de_mirage'};
 vm.runInContext(source+'\nglobalThis.offlineAPI={initOffline,refreshOfflineShell};',context);
 return{api:context.offlineAPI,registrations,listeners,messages};
}

test('the public home and both public map pages update the same root worker exactly once',async()=>{
 for(const path of ['/','/play/de_dust2/','/play/de_mirage/?room=FRIEND']){
  const f=fixture({page:'https://game.test'+path}),state=await f.api.initOffline();await f.api.initOffline();
  assert.equal(state.ready,true,path);assert.equal(f.registrations.length,1,path);
  assert.equal(f.registrations[0].url,'https://game.test/sw.js',path);assert.equal(f.registrations[0].options.scope,'/',path);assert.equal(f.registrations[0].options.updateViaCache,'none',path);
 }
});

test('a private map guard skips registration and shell messages even when a root worker exists',async()=>{
 const f=fixture({page:'https://game.test/review/play/de_mirage/',privateMap:true}),state=await f.api.initOffline();
 assert.equal(state.supported,false);assert.equal(state.ready,false);assert.equal(await f.api.refreshOfflineShell(),false);assert.equal(f.registrations.length,0);assert.equal(f.listeners.size,0);assert.equal(f.messages.length,0);
});

test('bundled Android and portable clients keep their existing no-registration behavior',async()=>{
 for(const page of ['https://game.test/__installed__/','http://127.0.0.1:9223/','http://127.0.0.1:9223/portable/']){
  const f=fixture({page,bundled:true}),state=await f.api.initOffline();
  assert.equal(state.installed,true);assert.equal(state.ready,false);assert.equal(f.registrations.length,0,page);
 }
});

test('other unbundled installations retain their directory scope instead of merging with the public root',async()=>{
 for(const path of ['/dust2/','/__installed__/','/other/play/de_mirage/']){
  const f=fixture({page:'https://game.test'+path});await f.api.initOffline();
  assert.equal(f.registrations[0].url,'https://game.test'+path+'sw.js');assert.equal(f.registrations[0].options.scope,path);
 }
});

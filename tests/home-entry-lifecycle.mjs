import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PUBLIC_MAPS,publicMapForPage,publicMapPage} from '../shared/public-map-pool.js';
import {connectionTarget} from '../client/connection-target.js';

const source=(await readFile(new URL('../client/home-entry.js',import.meta.url),'utf8'))
 .replace(/^import[^\n]+\n/gm,'')
 .replace(/import\(['"]\.\/main\.js['"]\)/g,"runtimeImport('main')")
 .replace(/import\(['"]\.\/private-main\.js['"]\)/g,"runtimeImport('private')");
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Element {
 constructor(dataset={}){this.dataset=dataset;this.listeners=new Map();this.attributes=new Map();this.classes=new Set();this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.classList={toggle:(key,on)=>{if(on)this.classes.add(key);else this.classes.delete(key);},add:key=>this.classes.add(key),remove:key=>this.classes.delete(key)};}
 addEventListener(type,handler,capture=false){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push({handler,capture});}
 setAttribute(key,value){this.attributes.set(key,value);}
 focus(){this.focused=true;}
 click(){if(this.disabled)return;let stopped=false;const event={preventDefault(){},stopImmediatePropagation(){stopped=true;}};
  const handlers=[...(this.listeners.get('click')||[])].sort((a,b)=>Number(b.capture)-Number(a.capture));
  for(const {handler}of handlers){handler(event);if(stopped)return;}this.onclick?.(event);
 }
}
function fixture({href='https://game.test/',pending=false,privateError=null,existingAudio=null,coarse=false,automaticFullscreen=true}={}){
 const ids=['nickname','mode','bots','team','room-code','room-capacity-note','menu-status','start-button','join-button','menu-settings','menu-skins','menu-offline','menu-play-tab','credits-button','credits','close-credits','room-mode-note','loadout-mode','lobby-mode-label','auto-team'];
 const elements=new Map(ids.map(id=>[id,new Element()]));
 for(const [id,value]of [['nickname','Player'],['mode','defuse'],['bots','6'],['team','T']])elements.get(id).value=value;
 const maps=PUBLIC_MAPS.map(map=>new Element({mapId:map.id})),teams=['T','CT'].map(team=>new Element({team})),primaries=['ak47','m4a1','awp'].map(primary=>new Element({primary})),labels=[new Element()];primaries[0].classes.add('selected');
 const imports=[],lobbies=[],starts=[],panels=[],loadouts=[],historyChanges=[],navigation=[],audioCalls=[],normalHandlerStarts=[],settings=new Map(),gate=deferred(),actions=[],mapImages=[];
 let reloadCount=0;
 const location={href,pathname:new URL(href).pathname,assign:url=>navigation.push(String(url)),reload:()=>reloadCount++};
 const document={title:'',getElementById:id=>elements.get(id),querySelectorAll:selector=>({'[data-map-id]':maps,'[data-team]':teams,'[data-primary]':primaries,'.selected-map-name':labels}[selector]||[]),querySelector:selector=>selector==='[data-primary].selected'?primaries.find(item=>item.classes.has('selected')):null};
 class Context {constructor(options){audioCalls.push(['create',options]);actions.push('audio-create');}resume(){audioCalls.push(['resume']);actions.push('audio-resume');return Promise.resolve();}}
 const api={prepareHomeLoadout:value=>loadouts.push(value),startFromHome:join=>{starts.push(join);return Promise.resolve();},openHomePanel:value=>panels.push(value),unlockAudioFromHome:()=>audioCalls.push(['runtime-resume'])};
 let runtimeInstalled=false;
 const complete=()=>{if(!runtimeInstalled){runtimeInstalled=true;elements.get('start-button').addEventListener('click',()=>normalHandlerStarts.push(false));elements.get('join-button').addEventListener('click',()=>normalHandlerStarts.push(true));}return api;};
 const context=vm.createContext({URL,Promise,console,document,location,window:{AudioContext:Context},PUBLIC_MAPS,publicMapForPage,publicMapPage,connectionTarget,
  history:{replaceState(_state,_title,url){location.href=String(url);location.pathname=new URL(url).pathname;historyChanges.push(String(url));}},
  preferences:{getItem:key=>settings.get(key)||null,setItem:(key,value)=>settings.set(key,value),readJSON:()=>({automatic:automaticFullscreen})},
  matchMedia:()=>({matches:coarse}),requestGameFullscreen:()=>{actions.push('fullscreen');return Promise.resolve();},initOffline:()=>Promise.resolve(),
  initHomeImages:()=>Promise.resolve(),hydrateHomeImages:()=>{},prepareHomeMapImages:id=>mapImages.push(id),
  mountLobby(options){const lobby={options,disposed:false,dispose(){this.disposed=true;}};lobbies.push(lobby);return lobby;},
  runtimeImport(name){imports.push(name);actions.push('import-'+name);const ready=(pending?gate.promise:privateError?Promise.reject(privateError):Promise.resolve()).then(complete);return name==='private'?Promise.resolve({ready}):ready;},
 });
 if(existingAudio)context.__DUSTII_BOOT_AUDIO_CONTEXT__=existingAudio;
 vm.runInContext(source,context);
 return{context,document,location,elements,maps,teams,primaries,imports,lobbies,starts,panels,loadouts,historyChanges,navigation,audioCalls,normalHandlerStarts,gate,actions,mapImages,get reloadCount(){return reloadCount;}};
}

test('idle home and changing a card do not import game code or start map preparation',async()=>{
 const f=fixture();await flush();assert.deepEqual(f.imports,[]);assert.deepEqual(f.starts,[]);assert.equal(f.context.window.__dust2Home.runtimeLoaded,false);
 f.maps[1].click();await flush();assert.deepEqual(f.imports,[]);assert.deepEqual(f.audioCalls,[]);assert.equal(f.context.window.__dust2Home.selectedMap,'de_mirage');
 assert.deepEqual(f.mapImages,[]);
 assert.equal(f.lobbies[0].disposed,true);assert.equal(f.lobbies[1].options.mapId,'de_mirage');assert.equal(f.lobbies[1].options.connection.socketURL,'wss://game.test/play/de_mirage/ws');
});

test('the first start gesture unlocks audio before one lazy runtime import and starts exactly once',async()=>{
 const f=fixture({pending:true});f.elements.get('start-button').click();
 assert.equal(f.audioCalls[0][0],'create');assert.equal(f.audioCalls[1][0],'resume');assert.equal(f.elements.get('start-button').disabled,true);assert.equal(f.starts.length,0);await flush();assert.deepEqual(f.imports,['main']);
 f.elements.get('start-button').click();f.maps[1].click();await flush();assert.deepEqual(f.imports,['main']);assert.equal(f.context.window.__dust2Home.selectedMap,'de_dust2');
 f.gate.resolve();await flush();assert.deepEqual(f.starts,[false]);assert.deepEqual(f.normalHandlerStarts,[]);assert.equal(f.context.window.__dust2Home.runtimeLoaded,true);assert.equal(f.elements.get('start-button').disabled,false);
 f.elements.get('start-button').click();await flush();assert.deepEqual(f.starts,[false,false]);assert.deepEqual(f.normalHandlerStarts,[]);assert.deepEqual(f.imports,['main']);
});

test('Mirage ready rejection is reported without invoking the game or showing a successful runtime',async()=>{
 const f=fixture({href:'https://game.test/play/de_mirage/',privateError:new Error('Map signature mismatch')});
 f.elements.get('start-button').click();await flush();assert.deepEqual(f.imports,['private']);assert.equal(f.context.window.__dust2Home.runtimeLoaded,false);assert.deepEqual(f.starts,[]);
 assert.match(f.elements.get('menu-status').textContent,/Map signature mismatch/);assert.equal(f.elements.get('start-button').disabled,false);
 f.elements.get('start-button').click();assert.equal(f.reloadCount,1);assert.deepEqual(f.imports,['private']);
 f.maps[0].click();assert.deepEqual(f.navigation,['https://game.test/play/de_dust2/']);
});

test('changing maps after loading uses navigation instead of mutating a running map',async()=>{
 const f=fixture();f.elements.get('menu-settings').click();await flush();assert.deepEqual(f.imports,['main']);assert.deepEqual(f.panels,['settings']);assert.equal(f.starts.length,0);
 f.maps[1].click();assert.deepEqual(f.navigation,['https://game.test/play/de_mirage/']);assert.deepEqual(f.imports,['main']);assert.equal(f.context.window.__dust2Home.selectedMap,'de_dust2');
});

test('settings, equipment and resource panels can be reopened before a later start or join',async()=>{
 const f=fixture();for(const id of ['menu-settings','menu-skins','menu-offline','menu-settings']){f.elements.get(id).click();await flush();}
 assert.deepEqual(f.imports,['main']);assert.deepEqual(f.panels,['settings','skins','offline','settings']);assert.deepEqual(f.starts,[]);
 assert.deepEqual(f.mapImages,[],'opening optional panels does not preload map loading art');
 f.elements.get('start-button').click();await flush();f.elements.get('room-code').value='FRIEND';f.elements.get('join-button').click();await flush();
 assert.deepEqual(f.starts,[false,true]);assert.deepEqual(f.normalHandlerStarts,[]);assert.equal(f.audioCalls.filter(call=>call[0]==='runtime-resume').length,2);
});

test('empty join does not import or unlock, and a room selection preserves the map in its URL',async()=>{
 const f=fixture();f.elements.get('join-button').click();await flush();assert.deepEqual(f.imports,[]);assert.deepEqual(f.audioCalls,[]);
 f.maps[1].click();f.elements.get('room-code').value='MIRAGE9';f.lobbies.at(-1).options.onJoin();await flush();
 assert.deepEqual(f.imports,['private']);assert.deepEqual(f.starts,[true]);assert.equal(f.historyChanges.at(-1),'https://game.test/play/de_mirage/?room=MIRAGE9');assert.equal(f.elements.get('team').value,'auto');
});

test('an existing suspended boot context resumes synchronously inside the next start gesture',async()=>{
 let resumes=0;const f=fixture({pending:true,existingAudio:{resume(){resumes++;return Promise.resolve();}}});
 f.elements.get('start-button').click();assert.equal(resumes,1);assert.equal(f.audioCalls.length,0);await flush();assert.deepEqual(f.imports,['main']);
 f.gate.resolve();await flush();assert.deepEqual(f.starts,[false]);
});

test('mobile fullscreen is requested in the first gesture before lazy import and respects its saved opt-out',async()=>{
 for(const automaticFullscreen of [true,false]){
  const f=fixture({pending:true,coarse:true,automaticFullscreen});f.elements.get('start-button').click();
  await flush();
  assert.deepEqual(f.actions,automaticFullscreen?['audio-create','audio-resume','fullscreen','import-main']:['audio-create','audio-resume','import-main']);
  f.gate.resolve();await flush();assert.deepEqual(f.starts,[false]);
 }
});

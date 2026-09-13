// Development-only Android WebView QA. Requires the loopback QA game server.
// Runs against our isolated emulator/debug package; never joins production.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const serial=process.argv[2]||'emulator-5582',adbPath=(process.env.ANDROID_HOME||'H:/playfround/.android-build-tools/sdk')+'/platform-tools/adb.exe';
const adb=(...args)=>execFileSync(adbPath,['-s',serial,...args],{maxBuffer:8*1024**2});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],errors=[];
const pass=(name,data={})=>{checks.push({name,...data});console.log('PASS',name);};
fs.mkdirSync('output/playwright',{recursive:true});
adb('reverse','tcp:3003','tcp:3003');
adb('install','-r','android/app/build/outputs/apk/debug/app-debug.apk');
adb('shell','am','force-stop','cn.duskrain.dustii.debug');
adb('shell','am','start','-n','cn.duskrain.dustii.debug/cn.duskrain.dustii.MainActivity','--es','qaUrl','http://127.0.0.1:3003/');
await wait(1500);
const pid=adb('shell','pidof','cn.duskrain.dustii.debug').toString().trim();
adb('forward','tcp:9228',`localabstract:webview_devtools_remote_${pid}`);
let target;
for(let i=0;i<60&&!target;i++){try{target=(await (await fetch('http://127.0.0.1:9228/json/list')).json()).find(t=>t.type==='page');}catch{}if(!target)await wait(500);}
assert.ok(target,'Debug WebView is available');
const cdp=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
await new Promise((resolve,reject)=>{cdp.once('open',resolve);cdp.once('error',reject);});
cdp.on('message',raw=>{const m=JSON.parse(raw);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},25000);pending.set(n,{resolve,reject,timer});cdp.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const until=async(expression,timeout=30000)=>{const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await evaluate(expression))return;await wait(250);}throw Error('Not ready: '+expression);};
const tap=async selector=>{const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing QA selector');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
try{
 await send('Runtime.enable');await until('!!window.__dust2');
 const initial=await evaluate('({ua:navigator.userAgent,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,native:window.__dust2.getStatus().mobileShell.native,bridge:typeof window.DustIIHost?.postMessage,hidden:document.querySelector(".mobile-install").hidden})');
 assert.ok(initial.native&&initial.width>initial.height&&initial.hidden);assert.equal(initial.bridge,'function');pass('Native landscape host and scoped settings bridge',initial);
 await evaluate(`(()=>{const mode=document.querySelector('#mode');mode.value='deathmatch';mode.dispatchEvent(new Event('change'));document.querySelector('#bots').value='0';document.querySelector('#nickname').value='Android emulator QA';})()`);
 await tap('#start-button');await until('window.__dust2.getStatus().connected',180000);await tap('.room-play');await until('window.__dust2.getStatus().touch.active');
 const game=await evaluate('({pointerLock:!!document.pointerLockElement,loaded:window.__dust2.getStatus().loaded,quality:window.__dust2.getStatus().settings.quality,contextLost:window.__dust2.getStatus().contextLost})');
 assert.ok(game.loaded&&!game.pointerLock&&!game.contextLost);assert.equal(game.quality,'low');pass('Real Android WebGL game, default low quality and touch controls',game);
 fs.writeFileSync('output/playwright/android-app-gameplay.png',adb('exec-out','screencap','-p'));
 await evaluate(`localStorage.setItem('dust2.brightness','112')`);
 // Home and return must release input and preserve data/the existing room.
 const room=await evaluate('window.__dust2.getStatus().room');
 adb('shell','input','keyevent','KEYCODE_HOME');await wait(600);adb('shell','am','start','-n','cn.duskrain.dustii.debug/cn.duskrain.dustii.MainActivity');await wait(800);
 assert.equal(await evaluate('window.__dust2.getStatus().room'),room);assert.equal(await evaluate('window.__dust2.getStatus().inputState.fire'),false);pass('Background and resume preserve room and release fire');
 const cached=await evaluate(`caches.keys().then(keys=>({keys,brightness:localStorage.getItem('dust2.brightness')}))`);assert.equal(cached.brightness,'112');assert.ok(cached.keys.some(k=>k.startsWith('dust2-assets')));pass('Settings and asset cache exist in app data',{cacheNames:cached.keys});
 // Exercise the exact message used by the export button, then cancel safely.
 await evaluate(`window.DustIIHost.postMessage(JSON.stringify({type:'exportPreferences',data:{version:1,preferences:{'dust2.brightness':'112'}}}))`);await wait(500);
 adb('shell','uiautomator','dump','/sdcard/dustii-picker.xml');const picker=adb('shell','cat','/sdcard/dustii-picker.xml').toString();assert.ok(/documentsui/.test(picker));pass('Native settings export opens Android document picker');adb('shell','input','keyevent','KEYCODE_BACK');await wait(500);
 adb('shell','input','keyevent','KEYCODE_BACK');await wait(300);adb('shell','uiautomator','dump','/sdcard/dustii-back.xml');const back=adb('shell','cat','/sdcard/dustii-back.xml').toString();assert.ok(back.includes('离开游戏'));pass('Back key opens exit confirmation');adb('shell','input','keyevent','KEYCODE_BACK');
 assert.equal(errors.length,0);pass('No uncaught WebView runtime errors');
 const windowState=adb('shell','dumpsys','window','windows').toString();fs.writeFileSync('artifacts/android/window-state.txt',windowState);
 fs.writeFileSync('artifacts/android/android-qa.json',JSON.stringify({serial,checks,errors,webview:adb('shell','dumpsys','webviewupdate').toString()},null,2));
}finally{cdp.close();adb('shell','am','force-stop','cn.duskrain.dustii.debug');}

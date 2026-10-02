// Isolated emulator/debug WebView audit. It does not modify production rooms.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const root=process.env.DUSTII_BUILD_ROOT||'D:/CodexBuilds/dust2-online-1.2.0';
const app=process.env.DUSTII_QA_PACKAGE||'cn.duskrain.dustii.qa12';
const adbPath='H:/playfround/.android-build-tools/sdk/platform-tools/adb.exe';
const adb=(...args)=>execFileSync(adbPath,['-s','emulator-5584',...args],{maxBuffer:16*1024**2}).toString();
const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
adb('reverse','tcp:33004','tcp:33004');adb('shell','am','force-stop',app);
adb('shell','am','start','-n',app+'/cn.duskrain.dustii.MainActivity','--es','qaUrl','http://127.0.0.1:33004/');
await wait(2500);const pid=adb('shell','pidof',app).trim();
adb('forward','tcp:9229',`localabstract:webview_devtools_remote_${pid}`);
let target;for(let i=0;i<50&&!target;i++){try{target=(await(await fetch('http://127.0.0.1:9229/json/list')).json()).find(t=>t.type==='page');}catch{}if(!target)await wait(500);}
assert.ok(target);const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let serial=0;
await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
socket.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
const network=[];socket.on('message',raw=>{const m=JSON.parse(raw);if(['Network.webSocketClosed','Network.webSocketFrameError','Runtime.exceptionThrown'].includes(m.method)){network.push(m);console.log('RUNTIME',JSON.stringify(m));}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const until=async(expression,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await wait(300);}throw Error('Timeout: '+expression);};
const tap=async selector=>{const p=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
try{
 await send('Network.enable');await send('Runtime.enable');
 await until('!!window.__dust2&&!!window.__dust2.getStatus().mobileAim.engine');
 const info=await evaluate('({ua:navigator.userAgent,motion:window.__dust2.getStatus().mobileAim,brightness:localStorage.getItem("dust2.brightness"),version:window.__dust2.getStatus().resources.clientBuild})');
 assert.equal(info.version,'1.2.0');assert.equal(info.motion.engine.name,'WebView');assert.ok(info.ua.includes('DustIIAndroid/1.2.0'));checks.push({name:'native version/capabilities and existing preferences',...info});
 console.log('PASS native capabilities',JSON.stringify(info.motion.engine));
 await evaluate(`window.__qaSamples=[];{const old=window.DustIIHost.onmessage;window.DustIIHost.onmessage=e=>{old?.(e);try{const m=JSON.parse(e.data);if(m.type==='motion'&&window.__qaSamples.length<1000)window.__qaSamples.push({time:m.time,at:performance.now(),rotation:m.rotation});}catch{}};}`);
 await evaluate(`document.querySelector('#mode').value='deathmatch';document.querySelector('#mode').dispatchEvent(new Event('change'));document.querySelector('#bots').value='0';document.querySelector('#nickname').value='Native Motion QA';`);
 await tap('#start-button');await until('window.__dust2.getStatus().connected&&!!window.__dust2.getStatus().player',420000);await tap('.room-play');await wait(1000);
 console.log('After play',await evaluate('JSON.stringify({aim:window.__dust2.getStatus().mobileAim,touch:window.__dust2.getStatus().touch,round:window.__dust2.getStatus().round,alive:window.__dust2.getStatus().player?.alive,menus:[...document.querySelectorAll(".overlay:not([hidden])")].map(e=>e.id)})'));
 if(await evaluate('!document.querySelector("#pause-menu").hidden'))await tap('#resume-button');
 if(await evaluate('!document.querySelector("#room-menu").hidden'))await evaluate('document.querySelector(".room-play").click()');
 await until('window.__dust2.getStatus().mobileAim.active');await wait(1800);
 const active=await evaluate('({motion:window.__dust2.getStatus().mobileAim,samples:window.__qaSamples,characters:window.__dust2.getStatus().players.length,graphics:window.__dust2.getStatus().resources.graphics})');
 assert.equal(active.characters,1);assert.ok(active.samples.length>=15);const elapsed=active.samples.at(-1).at-active.samples[0].at;const hz=(active.samples.length-1)*1000/elapsed;assert.ok(hz<=61);assert.ok(active.samples.every((s,i)=>!i||s.time>active.samples[i-1].time));checks.push({name:'native timestamped stream in isolated room',hz,motion:active.motion,graphics:active.graphics,samples:active.samples.length});
 fs.writeFileSync(root+'/native-gameplay.png',execFileSync(adbPath,['-s','emulator-5584','exec-out','screencap','-p'],{maxBuffer:16*1024**2}));
 await evaluate(`window.dispatchEvent(new Event('blur'))`);await wait(500);const count=await evaluate('window.__qaSamples.length');await wait(500);assert.equal(await evaluate('window.__qaSamples.length'),count);assert.equal(await evaluate('window.__dust2.getStatus().mobileAim.active'),false);checks.push({name:'blur stops native stream'});
 await tap('#resume-button');await until('window.__dust2.getStatus().mobileAim.active');
 adb('shell','input','keyevent','KEYCODE_HOME');await wait(500);adb('shell','am','start','-n',app+'/cn.duskrain.dustii.MainActivity');await wait(700);
 const back=await evaluate('({active:window.__dust2.getStatus().mobileAim.active,input:window.__dust2.getStatus().inputState,connected:window.__dust2.getStatus().connected})');assert.equal(back.active,false);assert.equal(back.input.fire,false);assert.ok(back.connected);checks.push({name:'Android background/resume clears control and preserves room',...back});
 fs.writeFileSync(root+'/native-qa.json',JSON.stringify({checks,physicalDevice:false},null,2));console.log(JSON.stringify({checks:checks.map(x=>x.name),hz}));
}finally{socket.close();adb('shell','am','force-stop',app);}

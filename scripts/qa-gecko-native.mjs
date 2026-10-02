// Firefox Remote Debugging Protocol on an isolated emulator/debug app.
import net from 'node:net';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.env.DUSTII_BUILD_ROOT||'D:/CodexBuilds/dust2-online-1.2.0';
const adbPath='H:/playfround/.android-build-tools/sdk/platform-tools/adb.exe';
const adb=(...args)=>execFileSync(adbPath,['-s','emulator-5584',...args],{maxBuffer:16*1024**2});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),messages=[],listeners=new Set(),checks=[];
const socket=net.connect(9230,'127.0.0.1');let buffer=Buffer.alloc(0);
socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(true){const c=buffer.indexOf(':');if(c<0)return;const length=Number(buffer.subarray(0,c).toString());if(buffer.length<c+1+length)return;const m=JSON.parse(buffer.subarray(c+1,c+1+length));buffer=buffer.subarray(c+1+length);messages.push(m);if(messages.length>400)messages.shift();for(const listen of listeners)listen();}});
const receive=predicate=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{listeners.delete(check);reject(Error('RDP response timeout'));},30000);function check(){const i=messages.findIndex(predicate);if(i>=0){clearTimeout(timer);listeners.delete(check);resolve(messages.splice(i,1)[0]);}}listeners.add(check);check();});
const send=m=>{const b=Buffer.from(JSON.stringify(m));socket.write(Buffer.concat([Buffer.from(b.length+':'),b]));};
await receive(m=>m.applicationType==='browser');send({to:'root',type:'listTabs'});const tabs=await receive(m=>m.tabs);send({to:tabs.tabs[0].actor,type:'getTarget'});const target=await receive(m=>m.frame),actor=target.frame.consoleActor;
const evaluate=async code=>{send({to:actor,type:'evaluateJSAsync',text:`JSON.stringify(${code})`});const ack=await receive(m=>m.from===actor&&m.resultID&&!m.type);const value=await receive(m=>m.type==='evaluationResult'&&m.resultID===ack.resultID);if(value.hasException)throw Error(value.exceptionMessage);assert.equal(typeof value.result,'string');return JSON.parse(value.result);};
const until=async(code,timeout=120000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(code))return;await wait(300);}throw Error('Gecko not ready: '+code);};
const tap=async selector=>{const p=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio)};})()`);adb('shell','input','tap',String(p.x),String(p.y));};
try{
 await until('!!window.__dust2?.getStatus().mobileAim.native');
 const info=await evaluate('({motion:window.__dust2.getStatus().mobileAim,client:window.__dust2.getStatus().resources.clientBuild,ua:navigator.userAgent})');
 assert.equal(info.client,'1.2.0');assert.equal(info.motion.engine.name,'GeckoView');checks.push({name:'Gecko native extension capabilities',...info});console.log('PASS Gecko bridge');
 await evaluate(`(()=>{window.__qaSamples=[];window.addEventListener('message',e=>{const m=e.data?.payload;if(m?.type==='motion'&&window.__qaSamples.length<500)window.__qaSamples.push({time:m.time,at:performance.now()});});document.querySelector('#mode').value='deathmatch';document.querySelector('#mode').dispatchEvent(new Event('change'));document.querySelector('#bots').value='9';document.querySelector('#nickname').value='Gecko Motion QA';return true;})()`);
 await tap('#start-button');await until('window.__dust2.getStatus().connected&&!!window.__dust2.getStatus().player',240000);await tap('.room-play');await wait(700);
 console.log('After play',JSON.stringify(await evaluate('({aim:window.__dust2.getStatus().mobileAim,touch:window.__dust2.getStatus().touch,alive:window.__dust2.getStatus().player?.alive,connected:window.__dust2.getStatus().connected,roomMenu:document.querySelector("#room-menu").hidden,pause:document.querySelector("#pause-menu").hidden,width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')));
 if(await evaluate('!document.querySelector("#room-menu").hidden'))await evaluate('(()=>{document.querySelector(".room-play").click();return true;})()');
 if(await evaluate('!document.querySelector("#pause-menu").hidden'))await tap('#resume-button');
 await until('window.__dust2.getStatus().mobileAim.active');await wait(1200);
 const game=await evaluate('({connected:window.__dust2.getStatus().connected,characters:window.__dust2.getStatus().players.length,motion:window.__dust2.getStatus().mobileAim,graphics:window.__dust2.getStatus().resources.graphics,samples:window.__qaSamples})');
 assert.equal(game.characters,10);assert.ok(game.samples.length>10);const hz=(game.samples.length-1)*1000/(game.samples.at(-1).at-game.samples[0].at);assert.ok(hz<=61);assert.ok(game.samples.every((m,i)=>!i||m.time>game.samples[i-1].time));checks.push({name:'production WSS 1+9 and native stream',hz,graphics:game.graphics,samples:game.samples.length});console.log('PASS Gecko WSS and motion',hz);
 fs.writeFileSync(root+'/gecko-gameplay.png',adb('exec-out','screencap','-p'));
 await evaluate('(()=>{window.dispatchEvent(new Event("blur"));return true;})()');await wait(600);const count=await evaluate('window.__qaSamples.length');await wait(400);assert.equal(await evaluate('window.__qaSamples.length'),count);assert.equal(await evaluate('window.__dust2.getStatus().mobileAim.active'),false);checks.push({name:'Gecko blur stops native stream'});
 await tap('#resume-button');await until('window.__dust2.getStatus().mobileAim.active');
 adb('shell','input','keyevent','KEYCODE_HOME');await wait(500);adb('shell','am','start','-n','cn.duskrain.dustii.gecko.debug/cn.duskrain.dustii.gecko.GeckoActivity');await wait(800);
 const state=await evaluate('({motion:window.__dust2.getStatus().mobileAim.active,connected:window.__dust2.getStatus().connected,fire:window.__dust2.getStatus().inputState.fire})');assert.equal(state.motion,false);assert.equal(state.fire,false);assert.ok(state.connected);checks.push({name:'Gecko Android background input reset',...state});
 fs.writeFileSync(root+'/gecko-qa.json',JSON.stringify({checks,physicalDevice:false},null,2));console.log(JSON.stringify({checks:checks.map(x=>x.name)}));
}finally{socket.end();adb('shell','am','force-stop','cn.duskrain.dustii.gecko.debug');}

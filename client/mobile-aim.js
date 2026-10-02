import {MotionInput,MOTION_KEY,normalizeMotion,browserQuaternion} from '../shared/motion-input.js';
import {AimAssist,smokeOccludes} from '../shared/aim-assist.js';
import {nativeHost} from './native-host.js';
const ZERO=()=>({yaw:0,pitch:0}),RAD=Math.PI/180;
export class MobileAim{
 constructor({storage,raycast,onStatus=()=>{}}){
  Object.assign(this,{storage,raycast,onStatus});this.settings=normalizeMotion(storage.readJSON(MOTION_KEY));this.motion=new MotionInput();this.assist=new AimAssist();this.manual=ZERO();this.active=false;this.source='none';this.lastInput='none';this.lastManualAt=-Infinity;this.lastSensorAt=-Infinity;this.authorized=false;this.status='进入对局后启用';this.native=false;this.generation=0;
  this.handleMotion=e=>{const r=e.rotationRate;if(!r||![r.beta,r.gamma,r.alpha].every(Number.isFinite)||this.source==='orientation')return;this.source='motion';this.sample({rate:{x:r.beta*RAD,y:r.gamma*RAD,z:r.alpha*RAD},time:e.timeStamp,rotation:this.screenAngle()});};
  this.handleOrientation=e=>{if(this.source==='motion'||![e.alpha,e.beta,e.gamma].every(Number.isFinite))return;this.source='orientation';this.sample({quaternion:browserQuaternion(e.alpha,e.beta,e.gamma),time:e.timeStamp,rotation:this.screenAngle()});};
  nativeHost.listeners.add(m=>{if(m.type==='motion'&&this.native&&this.active)this.sample(m);});
  document.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){this.lastInput='mouse';this.assist.reset();}else if(e.pointerType==='touch')this.lastInput='touch';},true);
  window.addEventListener('blur',()=>this.setActive(false));document.addEventListener('visibilitychange',()=>{if(document.hidden)this.setActive(false);});
  screen.orientation?.addEventListener('change',()=>this.calibrate());
  if(nativeHost.installed)nativeHost.request('motionCapabilities').then(m=>{this.native=!!m.available;this.engine=m.engine;this.status=m.available?'原生陀螺仪就绪':'设备没有可用陀螺仪';this.onStatus(this.status);}).catch(()=>{this.status='使用浏览器传感器';});
 }
 screenAngle(){return screen.orientation?.angle??window.orientation??0;}
 configure(v){this.settings=normalizeMotion({...this.settings,...v});this.storage.setItem(MOTION_KEY,JSON.stringify(this.settings));this.calibrate();if(this.active){this.setActive(false);}}
 async authorize(){
  if(this.settings.mode==='off')return;
  if(nativeHost.installed){try{const m=await nativeHost.request('motionCapabilities');this.native=!!m.available;this.engine=m.engine;this.authorized=this.native;this.status=this.native?'原生陀螺仪就绪':'设备没有可用陀螺仪';return;}catch{this.native=false;}}
  try{
   // Permission calls must originate in this click's transient activation.
   const requests=[globalThis.DeviceMotionEvent,globalThis.DeviceOrientationEvent].filter(Boolean).filter(c=>typeof c.requestPermission==='function').map(c=>c.requestPermission());
   const answers=await Promise.all(requests);this.authorized=answers.every(v=>v==='granted')&&!!(globalThis.DeviceMotionEvent||globalThis.DeviceOrientationEvent);
   this.status=this.authorized?'等待传感器数据':'传感器不可用或未获授权 · 可继续触屏操作';
  }catch{this.authorized=false;this.status='传感器权限未开启 · 可继续触屏操作';}
  this.onStatus(this.status);
 }
 setActive(value){const active=!!value&&this.authorized&&this.settings.mode!=='off';if(active===this.active)return;this.active=active;this.generation++;this.motion.reset();this.source='none';this.lastSensorAt=-Infinity;
  window.removeEventListener('devicemotion',this.handleMotion);window.removeEventListener('deviceorientation',this.handleOrientation);
  if(this.native)nativeHost.request(active?'startMotion':'stopMotion').catch(error=>{if(active&&this.active){this.active=false;this.authorized=false;this.motion.reset();this.status=error.message+' · 可继续触屏操作';}});
  else if(active){window.addEventListener('devicemotion',this.handleMotion);window.addEventListener('deviceorientation',this.handleOrientation);}
  if(!active){this.manual=ZERO();this.assist.reset();}
 }
 sample(sample){if(!this.active)return;if(this.motion.push(sample)){this.lastSensorAt=performance.now();this.status='陀螺仪运行中';}}
 calibrate(){this.motion.reset();this.manual=ZERO();this.assist.reset();if(this.native&&this.active)nativeHost.request('calibrateMotion').catch(()=>{});}
 manualLook(d){this.manual.yaw+=d.yaw;this.manual.pitch+=d.pitch;this.lastManualAt=performance.now();}
 clear(){this.setActive(false);this.manual=ZERO();this.assist.reset();}
 update({now,dt,enabled,touch,self,players,weapon,zoom,fov,yaw,pitch,origin,smokes,blind,snapshotAge,firing,recoil}){
  this.setActive(enabled&&touch&&this.lastInput!=='mouse'&&(this.settings.mode!=='scope'||zoom>0));
  const gyro=this.motion.consume(this.settings,fov,zoom),manual={yaw:this.manual.yaw+gyro.yaw,pitch:this.manual.pitch+gyro.pitch};this.manual=ZERO();
  if(Math.hypot(gyro.yaw,gyro.pitch)>1e-6){this.lastManualAt=now;this.lastInput='gyro';}
  const correctedYaw=yaw+gyro.yaw,correctedPitch=Math.max(-1.48,Math.min(1.48,pitch+gyro.pitch));
  const correction=this.assist.step({now,dt,yaw:correctedYaw,pitch:correctedPitch+recoil,origin,self,players,weapon,zoom,fov,level:this.settings.assist,active:enabled&&touch&&['touch','gyro'].includes(this.lastInput),intent:firing||now-this.lastManualAt<150,blind,snapshotAge,manual,firing,recoil,visible:(from,to)=>{
   if(smokeOccludes(from,to,smokes))return false;const d={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},length=Math.hypot(d.x,d.y,d.z),hit=this.raycast(from,{x:d.x/length,y:d.y/length,z:d.z/length},length);return hit===null||hit>=length-.03;
  }});
  return {yaw:correctedYaw+correction.yaw,pitch:Math.max(-1.48,Math.min(1.48,correctedPitch+correction.pitch))};
 }
 diagnostics(){return {settings:this.settings,active:this.active,native:this.native,source:this.native?'native':this.source,engine:this.engine||null,status:this.active&&performance.now()-this.lastSensorAt>2500?'等待有效传感器数据':this.status,lastInput:this.lastInput,assistTarget:this.assist.targetId};}
}

export function mountMobileAimSettings(settingsUI,aim){
 const panel=settingsUI.element.querySelector('[data-panel=touch]'),section=document.createElement('section');section.className='motion-settings';
 section.innerHTML='<h3>陀螺仪与辅助瞄准</h3><label class="config-row">陀螺仪<select data-motion="mode"><option value="always">对局中始终启用</option><option value="scope">仅开镜</option><option value="off">关闭</option></select></label>'+[['horizontal','水平灵敏度',4],['vertical','垂直灵敏度',4],['scope','开镜倍率',2]].map(([id,label,max])=>`<label class="config-row">${label}<output data-value="${id}"></output><input data-motion="${id}" type="range" min="0.1" max="${max}" step="0.1"></label>`).join('')+'<label class="config-row">反转水平<input data-motion="invertX" type="checkbox"></label><label class="config-row">反转垂直<input data-motion="invertY" type="checkbox"></label><button type="button" data-motion-calibrate>校准陀螺仪</button><p data-motion-status role="status"></p><label class="config-row">辅助瞄准<select data-motion="assist"><option value="standard">标准 · 轻度跟随</option><option value="low">低</option><option value="off">关闭</option></select></label><p>所有房间均可使用触屏辅助。先把准星移近可见敌人，辅助轻微跟随躯干；开火与压枪仍需手动。狙击枪开镜后辅助减半。</p><small data-engine-info></small>';
 panel.append(section);const sync=()=>{for(const e of section.querySelectorAll('[data-motion]')){const v=aim.settings[e.dataset.motion];if(e.type==='checkbox')e.checked=v;else e.value=v;const out=section.querySelector(`[data-value="${e.dataset.motion}"]`);if(out)out.textContent=Number(v).toFixed(1);}section.querySelector('[data-motion-status]').textContent=aim.diagnostics().status;section.querySelector('[data-engine-info]').textContent=aim.engine?`内核：${aim.engine.name} ${aim.engine.version||''}`:'网页版 · 使用当前浏览器内核';};
 for(const e of section.querySelectorAll('[data-motion]'))e.addEventListener('input',()=>{aim.configure({[e.dataset.motion]:e.type==='checkbox'?e.checked:e.type==='range'?Number(e.value):e.value});sync();});
 section.querySelector('[data-motion-calibrate]').onclick=async()=>{await aim.authorize();aim.calibrate();sync();};sync();setInterval(()=>{if(!settingsUI.element.hidden&&!panel.hidden)sync();},500);
}

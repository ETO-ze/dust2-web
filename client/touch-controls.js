import {TouchInput,normalizeTouch,touchLookDelta} from '../shared/touch-input.js';
import './touch-controls.css';
export class TouchControls {
 constructor({controls,storage,onLook,onCancel,onMode,onRoom,onFullscreen,getFov}){
  Object.assign(this,{controls,storage,onCancel,onMode});this.settings=normalizeTouch(storage.readJSON('dust2.touch.v1'));this.active=false;this.throwMode='full';
  this.media=matchMedia('(pointer: coarse)');this.enabled=false;
  this.element=document.createElement('div');this.element.id='touch-controls';this.element.hidden=true;this.element.setAttribute('aria-label','触屏游戏控制');
  this.element.innerHTML=`<div class="touch-look" data-touch-kind="look" aria-label="滑动瞄准区域"></div>
   <div class="touch-joystick" data-touch-kind="move" role="group" aria-label="移动摇杆"><i></i><span>移动</span></div>
   <div class="touch-toolbar"><button data-action="buy">商店</button><button data-touch-command="room">房间</button><button data-action="scoreboard">战况</button><button data-touch-command="fullscreen">全屏</button><button data-action="menu">菜单</button></div>
   <div class="touch-combat"><button class="touch-fire" data-action="fire">开火</button><button class="touch-alt" data-action="altFire">开镜</button><button class="touch-jump" data-action="jump">跳跃</button><button class="touch-reload" data-action="reload">换弹</button><button class="touch-crouch" data-action="crouch" data-toggle>蹲下</button><button class="touch-use" data-action="interact">拾取 / 用</button></div>
   <div class="touch-weapons"><button data-action="primary" data-slot="1">主武器</button><button data-action="secondary" data-slot="2">手枪</button><button data-action="knife" data-slot="3">刀</button><button data-action="utility" data-slot="4">道具</button><button data-action="bomb" data-slot="5">C4</button><button data-action="drop">丢枪</button></div>
   <button class="touch-walk" data-action="walk" data-toggle>静步</button>
   <div class="touch-throw" hidden><span>按住准备 · 松手投出</span><button data-throw="full">远投</button><button data-throw="lob">中投</button><button data-throw="drop">近投</button><button data-touch-command="cancel">取消</button></div>
   <div class="touch-portrait-note">横屏游玩更舒适 · 右侧滑动瞄准</div>`;
  document.body.append(this.element);this.buttons=[...this.element.querySelectorAll('[data-action]')];this.stick=this.element.querySelector('.touch-joystick');this.knob=this.stick.querySelector('i');
  this.input=new TouchInput({onAction:(a,held,id)=>controls.setVirtual(a,held,'touch-'+id),onLook:(dx,dy)=>{const d=touchLookDelta(dx,dy,Math.min(innerWidth,innerHeight),this.settings.sensitivity,getFov());onLook(d);},onCancel:()=>this.onCancel()});
  this.element.addEventListener('pointerdown',e=>{
   if(!this.active||!this.enabled||e.pointerType==='mouse'&&this.settings.mode!=='on')return;
   const target=e.target.closest('button,[data-touch-kind]');if(!target||target.disabled)return;
   e.preventDefault();e.stopPropagation();
   if(target.dataset.touchCommand){const command=target.dataset.touchCommand;if(command==='cancel'){this.clear();this.onCancel();}if(command==='room')onRoom();return;}
   if(target.dataset.throw){this.clear();this.onCancel();this.throwMode=target.dataset.throw;this.drawThrow();return;}
   const action=target.dataset.action;
   if(target.hasAttribute('data-toggle')){controls.setVirtual(action,!controls.down(action),'toggle-'+action);target.classList.toggle('pressed',controls.down(action));return;}
   let actions=action?[action]:[],kind=target.dataset.touchKind||(action==='fire'?'fire':'button');
   if(action==='fire'&&this.state?.slot===4)actions=this.throwMode==='full'?['fire']:this.throwMode==='drop'?['altFire']:['fire','altFire'];
   const box=this.stick.getBoundingClientRect();
   if(!this.input.begin(e.pointerId,kind,e.clientX,e.clientY,{actions,radius:box.width*.36,center:kind==='move'?{x:box.x+box.width/2,y:box.y+box.height/2}:null}))return;
   this.element.setPointerCapture?.(e.pointerId);target.classList.add('pressed');this.drawStick();
  });
  this.element.addEventListener('pointermove',e=>{if(!this.input.pointers.has(e.pointerId))return;e.preventDefault();this.input.move(e.pointerId,e.clientX,e.clientY);this.drawStick();});
  this.element.addEventListener('pointerup',e=>{this.input.end(e.pointerId);this.drawHeld();this.drawStick();});
  for(const name of ['pointercancel','lostpointercapture'])this.element.addEventListener(name,e=>{this.input.end(e.pointerId,true);this.drawHeld();this.drawStick();});
  // Click follows touch release, when transient user activation is available.
  this.element.querySelector('[data-touch-command=fullscreen]').addEventListener('click',()=>{if(this.active&&this.enabled)onFullscreen();});
  this.element.addEventListener('contextmenu',e=>e.preventDefault());
  this.media.addEventListener('change',()=>this.refreshMode());
  this.refreshMode();this.drawThrow();
 }
 refreshMode(){const enabled=this.settings.mode==='on'||this.settings.mode==='auto'&&this.media.matches;if(enabled!==this.enabled){this.clear();this.enabled=enabled;this.controls.mouse=!enabled;this.onMode?.(enabled);}document.body.classList.toggle('touch-device',enabled);this.element.style.setProperty('--touch-size',this.settings.size);this.element.hidden=!enabled||!this.active;}
 configure(values){this.settings=normalizeTouch({...this.settings,...values});this.storage.setItem('dust2.touch.v1',JSON.stringify(this.settings));this.refreshMode();}
 setActive(active){active=!!active;if(this.active&&!active)this.clear();this.active=active;this.element.hidden=!this.enabled||!active;}
 clear(){this.input?.clear();this.drawStick();this.element?.querySelectorAll('.pressed').forEach(b=>b.classList.remove('pressed'));}
 drawStick(){if(!this.input)return;const {right,forward}=this.input.axes;this.knob.style.transform=`translate(${right*38}px,${-forward*38}px)`;}
 drawHeld(){this.buttons.forEach(b=>b.classList.toggle('pressed',this.controls.down(b.dataset.action)));}
 drawThrow(){this.element.querySelectorAll('[data-throw]').forEach(b=>b.classList.toggle('selected',b.dataset.throw===this.throwMode));}
 update(state){
  this.state=state;document.body.classList.toggle('touch-utility',state.slot===4);if(!this.enabled||!this.active)return;
  for(const b of this.buttons){const a=b.dataset.action;const combat=['fire','altFire','reload'].includes(a),movement=['jump','crouch','walk'].includes(a),equipment=['primary','secondary','knife','utility','bomb','drop','interact'].includes(a);
   b.disabled=(combat&&!state.combat&&!(state.spectator&&['fire','altFire'].includes(a)))||(movement&&!state.moving)||(equipment&&!state.equipment)||(a==='buy'&&!state.alive);
   if(b.dataset.slot){const slot=Number(b.dataset.slot);b.disabled||=!state.slots.includes(slot);b.classList.toggle('selected',state.slot===slot);}
  }
  this.element.querySelector('.touch-fire').textContent=state.spectator?'下一位':state.slot===4?'投掷':state.slot===5?'下包':'开火';
  this.element.querySelector('.touch-alt').textContent=state.spectator?'上一位':state.slot===3?'重刀':'开镜';
  this.element.querySelector('.touch-alt').disabled||=state.slot===4;
  this.element.querySelector('.touch-use').textContent=state.hasBomb?'下包':state.planted?'拆包 / 用':'拾取 / 用';
  this.element.querySelector('.touch-throw').hidden=state.slot!==4||!state.alive;
 }
 get axes(){return this.input.axes;}
}
export function mountTouchSettings(settingsUI,touch){
 const modal=settingsUI.element,tab=document.createElement('button'),panel=document.createElement('section');tab.dataset.tab='touch';tab.textContent='触屏';panel.dataset.panel='touch';panel.hidden=true;
 panel.innerHTML='<h3>手机与平板控制</h3><p>左侧摇杆移动；右侧空白处滑动瞄准，开火按钮也可拖动瞄准。蹲下、静步点按切换；拾取、下包、拆包按住「用」。选择道具后，选远 / 中 / 近投，按住投掷准备，松手释放。支持同时移动、瞄准与跳投。</p><label class="config-row">触屏控制<select id="touch-mode"><option value="auto">自动检测</option><option value="on">开启</option><option value="off">关闭</option></select></label><label class="config-row">触屏灵敏度 <output id="touch-sens-value"></output><input id="touch-sensitivity" type="range" min="0.4" max="2.5" step="0.05"></label><label class="config-row">按钮大小<input id="touch-size" type="range" min="0.85" max="1.15" step="0.05"></label><p>建议横屏、最低画质。全屏和横屏锁定取决于浏览器支持；不支持时仍可直接操作。切到后台或打开菜单会停止移动、开火，并取消准备中的投掷。</p>';
 modal.querySelector('.config-tabs').append(tab);modal.querySelector('.config-scroll').append(panel);
 tab.onclick=()=>{modal.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tab));modal.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p!==panel);};
 const sync=()=>{panel.querySelector('#touch-mode').value=touch.settings.mode;panel.querySelector('#touch-sensitivity').value=touch.settings.sensitivity;panel.querySelector('#touch-size').value=touch.settings.size;panel.querySelector('#touch-sens-value').textContent=touch.settings.sensitivity.toFixed(2);};sync();
 for(const [id,key] of [['touch-mode','mode'],['touch-sensitivity','sensitivity'],['touch-size','size']])panel.querySelector('#'+id).addEventListener('input',e=>{touch.configure({[key]:key==='mode'?e.target.value:Number(e.target.value)});sync();});
}

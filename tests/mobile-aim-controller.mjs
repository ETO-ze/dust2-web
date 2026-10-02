import test from 'node:test';
import assert from 'node:assert/strict';
import {TouchInput} from '../shared/touch-input.js';
import {getWeapon} from '../shared/weapons.js';

test('browser permission, touch/gyro coexistence, focus and mouse arbitration',async t=>{
 const keys=['window','document','screen','navigator','location','DeviceMotionEvent','DeviceOrientationEvent'];
 const before=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
 const win=new EventTarget(),doc=new EventTarget(),orientation=new EventTarget();orientation.angle=90;doc.hidden=false;
 let permission='granted';class SensorEvent extends Event{static requestPermission(){return Promise.resolve(permission);}}
 for(const [key,value]of Object.entries({window:win,document:doc,screen:{orientation},navigator:{userAgent:'Browser QA'},location:{origin:'http://127.0.0.1'},DeviceMotionEvent:SensorEvent,DeviceOrientationEvent:SensorEvent}))Object.defineProperty(globalThis,key,{configurable:true,value,writable:true});
 t.after(()=>{for(const[key,descriptor]of before)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 const {MobileAim}=await import('../client/mobile-aim.js');
 const saved=new Map(),aim=new MobileAim({storage:{readJSON:()=>({}),setItem:(k,v)=>saved.set(k,v)},raycast:()=>null});
 const pointer=type=>{const e=new Event('pointerdown');Object.defineProperty(e,'pointerType',{value:type});doc.dispatchEvent(e);};
 const args=()=>({now:performance.now(),dt:1/60,enabled:true,touch:true,self:{id:'me',team:'CT',alive:true},players:[],weapon:getWeapon('ak47'),zoom:0,fov:90,yaw:0,pitch:0,origin:{x:0,y:1.62,z:0},smokes:[],blind:false,snapshotAge:0,firing:false,recoil:0});
 await t.test('denial preserves touch operation and reports the cause',async()=>{permission='denied';await aim.authorize();assert.equal(aim.authorized,false);pointer('touch');aim.manualLook({yaw:.1,pitch:0});const result=aim.update({...args(),yaw:.1});assert.equal(result.yaw,.1);assert.match(aim.status,/授权/);});
 await t.test('gyro adds to a look gesture without releasing other fingers',async()=>{
  permission='granted';await aim.authorize();pointer('touch');aim.update(args());
  const actions=[],touch=new TouchInput({onAction:(a,p)=>actions.push([a,p]),onLook:()=>aim.manualLook({yaw:.01,pitch:0})});
  touch.begin(1,'move',0,0);touch.move(1,0,-52);touch.begin(2,'look',100,100);touch.begin(3,'fire',200,100,{actions:['fire']});touch.move(2,110,100);
  aim.sample({rate:{x:1,y:0,z:0},time:0,rotation:90});aim.sample({rate:{x:1,y:0,z:0},time:10,rotation:90});
  const result=aim.update({...args(),yaw:.1});assert.ok(Math.abs(result.yaw-.09)<1e-8);assert.equal(touch.axes.forward,1);assert.equal(touch.pointers.size,3);assert.deepEqual(actions,[['fire',true]]);
 });
 await t.test('mouse wins immediately and a fresh touch can resume sensors',()=>{pointer('mouse');aim.update(args());assert.equal(aim.active,false);pointer('touch');aim.update(args());assert.equal(aim.active,true);});
 await t.test('focus loss, death, menu and hidden documents stop sensors',()=>{
  win.dispatchEvent(new Event('blur'));assert.equal(aim.active,false);
  aim.update(args());aim.update({...args(),enabled:false});assert.equal(aim.active,false);
  aim.update(args());doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(aim.active,false);doc.hidden=false;
 });
 await t.test('calibration and orientation changes discard queued rotation',()=>{
  aim.update(args());aim.sample({rate:{x:1,y:0,z:0},time:100,rotation:90});aim.sample({rate:{x:1,y:0,z:0},time:110,rotation:90});aim.calibrate();assert.equal(aim.update(args()).yaw,0);
  orientation.angle=270;orientation.dispatchEvent(new Event('change'));assert.equal(aim.update(args()).yaw,0);
 });
 await t.test('scope-only mode gates sampling and settings survive export storage',()=>{aim.configure({mode:'scope',assist:'low',horizontal:2});aim.update(args());assert.equal(aim.active,false);aim.update({...args(),zoom:1,fov:40});assert.equal(aim.active,true);assert.equal(JSON.parse(saved.get('dust2.motion.v1')).horizontal,2);aim.clear();});
});

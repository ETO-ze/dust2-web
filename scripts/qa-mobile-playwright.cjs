// Playwright CLI QA fixture; requires the loopback qa-stability-server.
async page=>{
 await page.goto("http://127.0.0.1:3003/");
 await (async page=>{
 await page.bringToFront();page.setDefaultTimeout(20000);
 await page.evaluate(()=>{
  window.__touchErrors=[];window.addEventListener('error',e=>window.__touchErrors.push(e.message));window.__touchEvents=[];window.__touchSent=[];
  const NativeSocket=window.WebSocket;window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.events){window.__touchEvents.push(...m.events);window.__touchEvents=window.__touchEvents.slice(-1200);}});}send(data){const m=JSON.parse(data);window.__touchSent.push(m);window.__touchSent=window.__touchSent.slice(-200);super.send(data);}};
 });
 await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');await page.locator('#nickname').fill('Mobile QA');await page.locator('#start-button').tap();
 await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});await page.locator('.room-play').tap();
 await page.waitForFunction(()=>window.__dust2.getStatus().touch.active);await page.request.post('http://127.0.0.1:3004/qa/movement/flat');await page.waitForTimeout(1000);
 const s=await page.evaluate(()=>({state:window.__dust2.getStatus(),lock:!!document.pointerLockElement,errors:window.__touchErrors}));if(s.lock||s.errors.length||!s.state.touch.active)throw Error('Touch game did not activate');
 await page.screenshot({path:'output/playwright/mobile-landscape-initial.png'});await page.evaluate(v=>window.__mobileStart=v,{width:await page.evaluate(()=>innerWidth),height:await page.evaluate(()=>innerHeight),touch:s.state.touch,errors:s.errors});
})(page);
 await (async page=>{
 await page.bringToFront();const cdp=await page.context().newCDPSession(page);const fingers=new Map(),checks=[];await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.locator('#resume-button').tap();
 const state=()=>page.evaluate(()=>{const s=window.__dust2.getStatus();return {touch:s.touch,input:s.inputState,p:s.player,jumpId:s.jumpId,reloadId:s.reloadId,audio:s.audio,lock:!!document.pointerLockElement}});
 const point=async selector=>{const r=await page.locator(selector).boundingBox();if(!r)throw Error('Missing '+selector);return {x:r.x+r.width/2,y:r.y+r.height/2};};
 const dispatch=async type=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[...fingers].map(([id,p])=>({id:id+100,...p,radiusX:3,radiusY:3,force:1}))});
 const down=async(id,p)=>{fingers.set(id,p);await dispatch('touchStart');};const move=async(id,p)=>{fingers.set(id,p);await dispatch('touchMove');};const up=async id=>{const p=fingers.get(id);fingers.delete(id);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id:id+100,...p}]});};
 const assert=(ok,msg,details)=>{if(!ok)throw Error(msg+' '+JSON.stringify(details));checks.push({check:msg,...details});};
 await page.request.post('http://127.0.0.1:3004/qa/movement/flat');await page.waitForTimeout(500);
 const a=await state(),stick=await point('.touch-joystick'),fire=await point('.touch-fire'),jump=await point('.touch-jump');
 await down(1,stick);await move(1,{x:stick.x,y:stick.y-42});await down(2,{x:370,y:150});await move(2,{x:398,y:148});await down(3,fire);await move(3,{x:fire.x+9,y:fire.y});await down(4,jump);await page.waitForTimeout(180);
 const b=await state();assert(b.touch.pointers===4&&b.input.fire&&b.jumpId>a.jumpId&&b.p.y>a.p.y+.2,'Four trusted fingers move, aim, fire and jump',{pointers:b.touch.pointers,jumpId:b.jumpId,y:b.p.y-a.p.y,yaw:b.p.yaw-a.p.yaw});
 await up(4);await up(2);await page.waitForTimeout(350);const c=await state();assert(c.touch.pointers===2&&c.input.fire&&c.touch.axes.forward>.7,'Releasing aim and jump preserves movement and fire',{pointers:c.touch.pointers,ammo:c.p.ammo});
 assert(c.p.ammo<a.p.ammo&&Math.hypot(c.p.x-a.p.x,c.p.z-a.p.z)>.5&&Math.abs(c.p.yaw-a.p.yaw)>.1,'Server accepts analog movement, aim and shots',{distance:Math.hypot(c.p.x-a.p.x,c.p.z-a.p.z),ammo:c.p.ammo,yaw:c.p.yaw-a.p.yaw});
 await up(3);await up(1);await page.waitForTimeout(300);const d=await state();assert(d.touch.pointers===0&&!d.input.fire&&d.touch.axes.forward===0&&!d.lock,'Release resets inputs without pointer lock',{});
 await page.request.post('http://127.0.0.1:3004/qa/movement/flat');await page.waitForTimeout(700);await page.locator('.touch-crouch').tap();await page.waitForTimeout(120);assert((await state()).input.crouch,'Crouch toggle holds',{});await page.locator('.touch-crouch').tap();
 await page.locator('[data-action="secondary"][data-slot]').tap();await page.waitForTimeout(400);assert((await state()).p.slot===2,'Touch sidearm switch',{});
 await page.locator('[data-action="knife"][data-slot]').tap();await page.waitForTimeout(500);const e=await state();await page.locator('.touch-alt').tap();await page.waitForTimeout(150);assert((await state()).audio.heavySwingCount>e.audio.heavySwingCount,'Knife secondary attack',{});
 await page.request.post('http://127.0.0.1:3004/qa/utility/hegrenade');await page.waitForTimeout(700);
 await down(1,await point('.touch-fire'));await page.waitForTimeout(250);assert((await state()).p.grenadeState.state==='primed','Touch grenade holds pin',{});
 const beforeCancel=await page.evaluate(()=>window.__touchEvents.filter(e=>e.type==='grenade_thrown').length);fingers.clear();await dispatch('touchCancel');await page.waitForTimeout(700);const f=await state();assert(f.p.grenadeState.state==='idle'&&f.p.utilityCounts.hegrenade===1&&!f.input.fire&&f.touch.pointers===0,'OS touch cancel preserves grenade',{grenade:f.p.grenadeState});assert(await page.evaluate(()=>window.__touchEvents.filter(e=>e.type==='grenade_thrown').length)===beforeCancel,'Cancel emits no throw',{});
 await down(1,await point('.touch-fire'));await page.waitForTimeout(250);await down(2,await point('[data-action="menu"]'));await up(2);await up(1);await page.waitForTimeout(500);const g=await state();assert(!g.touch.active&&!g.input.fire&&g.p.utilityCounts.hegrenade===1,'Menu cancels held grenade and touch surface',{});await page.locator('#resume-button').tap();await page.waitForTimeout(200);
 await down(1,await point('.touch-joystick'));await move(1,{x:stick.x,y:stick.y-40});await down(2,await point('.touch-fire'));await page.waitForTimeout(200);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));fingers.clear();await dispatch('touchCancel');await page.waitForTimeout(500);const h=await state();assert(!h.touch.active&&h.touch.axes.forward===0&&!h.input.fire&&h.p.utilityCounts.hegrenade===1,'Focus loss stops movement and cancels grenade',{});await page.locator('#resume-button').tap();
 await page.evaluate(v=>window.__mobileInputQa=v,{checks});await page.screenshot({path:'output/playwright/mobile-utility-landscape.png'});await cdp.detach();
})(page);
 await (async page=>{
 await page.bringToFront();const cdp=await page.context().newCDPSession(page),fingers=new Map(),checks=[];
 const state=()=>page.evaluate(()=>window.__dust2.getStatus());
 const point=async sel=>{const b=await page.locator(sel).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
 const down=async(id,p)=>{fingers.set(id,p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[...fingers].map(([id,p])=>({id,...p}))});};
 const up=async id=>{const p=fingers.get(id);fingers.delete(id);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id,...p}]});};
 const throws=()=>page.evaluate(()=>window.__touchEvents.filter(e=>e.type==='grenade_thrown'&&e.shooterId===window.__dust2.getStatus().myId));
 for(const mode of ['full','lob','drop']){
  await page.request.post('http://127.0.0.1:3004/qa/utility/hegrenade');await page.waitForTimeout(750);await page.locator(`[data-throw="${mode}"]`).tap();const n=(await throws()).length;
  await down(21,await point('.touch-fire'));await page.waitForTimeout(350);const primed=await state();if(primed.player.grenadeState.mode!==mode||primed.player.grenadeState.state!=='primed'||(await throws()).length!==n)throw Error('Bad hold '+mode);
  await up(21);await page.waitForTimeout(300);const events=await throws(),event=events.at(-1);if(events.length!==n+1||event.mode!==mode||(await state()).player.utilityCounts.hegrenade!==0)throw Error('Bad release '+mode);checks.push({check:'Hold and release '+mode,mode:event.mode,strength:event.strength});
 }
 await page.request.post('http://127.0.0.1:3004/qa/utility/smokegrenade');await page.waitForTimeout(750);await page.locator('[data-throw="full"]').tap();
 const before=await state(),n=(await throws()).length;await down(31,await point('.touch-fire'));await page.waitForTimeout(250);await down(32,await point('.touch-jump'));await up(31);await page.waitForTimeout(180);const after=await state(),events=await throws();await up(32);
 if(after.jumpId<=before.jumpId||after.player.y<=before.player.y+.1||events.length!==n+1)throw Error('Jump throw failed');checks.push({check:'Jump and release in same input interval',jumpId:after.jumpId,originY:events.at(-1).origin.y,playerRise:after.player.y-before.player.y});
 await page.request.post('http://127.0.0.1:3004/qa/reload');await page.waitForTimeout(750);const reloadBefore=(await state()).reloadId;await page.locator('.touch-reload').tap();await page.waitForTimeout(150);if((await state()).reloadId<=reloadBefore)throw Error('No reload edge');await page.waitForFunction(()=>window.__dust2.getStatus().player.ammo===30,null,{timeout:6000});checks.push({check:'Touch reload refills magazine'});
 await page.request.post('http://127.0.0.1:3004/qa/aim-lane/awp');await page.waitForTimeout(750);await page.locator('.touch-alt').tap();await page.waitForTimeout(100);const zoom1=(await state()).zoomLevel;await page.locator('.touch-alt').tap();await page.waitForTimeout(100);const zoom2=(await state()).zoomLevel;if(zoom1!==1||zoom2!==2)throw Error('Touch scope cycle');checks.push({check:'Touch AWP two zoom levels',zoom1,zoom2});
 await page.request.post('http://127.0.0.1:3004/qa/utility/defuse');await page.waitForTimeout(750);const start=await state();await down(41,await point('.touch-use'));await page.waitForTimeout(350);await down(42,{x:370,y:130});fingers.set(42,{x:400,y:130});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[...fingers].map(([id,p])=>({id,...p}))});await page.waitForTimeout(300);const use=await state();await up(42);await up(41);if(!(use.player.bombProgress>0&&use.player.objectiveLocked&&use.player.crouch))throw Error('Touch defuse failed');checks.push({check:'Hold use defuses while turning',progress:use.player.bombProgress,locked:use.player.objectiveLocked});
 await page.evaluate(v=>window.__mobileUtilityQa=v,{checks});await cdp.detach();
})(page);
 await (async page=>{
 await page.bringToFront();const checks=[];if(await page.locator('#buy-menu').isVisible())await page.locator('#close-buy').tap();await page.request.post('http://127.0.0.1:3004/qa/utility/kit');await page.waitForTimeout(600);
 await page.locator('[data-action="buy"]').tap();await page.waitForSelector('#buy-menu:not([hidden])');if(await page.locator('#touch-controls').isVisible())throw Error('Touch leaks into shop');
 await page.locator('[data-buy="defusekit"]').tap();await page.waitForFunction(()=>window.__dust2.getStatus().player.defuseKit);await page.locator('[data-buy="smokegrenade"]').tap();await page.waitForFunction(()=>window.__dust2.getStatus().player.utilityCounts.smokegrenade===1);checks.push({check:'Scrollable mobile shop buys kit and smoke'});await page.screenshot({path:'output/playwright/mobile-shop.png'});await page.locator('#close-buy').tap();await page.waitForFunction(()=>window.__dust2.getStatus().touch.active);
 await page.locator('[data-touch-command="room"]').tap();const seats=await page.locator('.room-seat').count();if(seats!==10)throw Error('Wrong seats');await page.screenshot({path:'output/playwright/mobile-room.png'});await page.locator('.room-play').tap();checks.push({check:'Room opens ten seats and resumes',seats});
 await page.locator('[data-action="menu"]').tap();await page.locator('#game-settings').tap();await page.locator('[data-tab="touch"]').tap();await page.locator('#touch-sensitivity').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');const value=await page.locator('#touch-sensitivity').inputValue();if(value!=='0.5')throw Error('Sensitivity editor');await page.locator('#touch-mode').selectOption('on');await page.locator('#close-settings').tap();await page.locator('#resume-button').tap();checks.push({check:'Touch settings adjustable',sensitivity:Number(value)});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('#touch-controls button:not(:disabled)')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent,x:r.x,y:r.y,w:r.width,h:r.height}})}));if(layout.scroll>layout.width+1||layout.buttons.some(b=>b.x<0||b.y<0||b.x+b.w>391||b.y+b.h>845))throw Error('Portrait clipped controls '+JSON.stringify(layout));await page.screenshot({path:'output/playwright/mobile-portrait.png'});checks.push({check:'390 x 844 portrait controls remain inside screen',buttons:layout.buttons.length});
 await page.setViewportSize({width:750,height:342});await page.waitForTimeout(400);await page.request.post('http://127.0.0.1:3004/qa/aim-lane/awp');await page.waitForTimeout(700);await page.screenshot({path:'output/playwright/mobile-landscape-final.png'});
 await page.evaluate(v=>window.__mobileMenuQa={...v,settings:JSON.parse(localStorage.getItem('dust2.touch.v1')),errors:window.__touchErrors},{checks});
})(page);
 const report=await page.evaluate(()=>({input:window.__mobileInputQa,utility:window.__mobileUtilityQa,menu:window.__mobileMenuQa,errors:window.__touchErrors}));
 await page.reload();await page.waitForFunction(()=>window.__dust2);
 const saved=await page.evaluate(()=>window.__dust2.getStatus().touch.settings);
 if(saved.mode!=='on'||saved.sensitivity!==.5)throw Error('Touch preferences did not survive reload');
 await page.evaluate(v=>window.__mobileAcceptance=v,{...report,persistence:saved});
}

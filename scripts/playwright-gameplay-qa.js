async(page)=>{
 const status=()=>page.evaluate(()=>window.__dust2.getStatus());
 await page.waitForFunction(()=>window.__dust2?.getStatus().connected,null,{timeout:60000});
 await page.request.post('http://127.0.0.1:3004/hold');
 async function lock(){for(let i=0;i<3;i++){if(await page.evaluate(()=>!!document.pointerLockElement))return;await page.waitForTimeout(500);if(await page.locator('#resume-button').isVisible())await page.locator('#resume-button').click();}if(!await page.evaluate(()=>!!document.pointerLockElement))throw Error('Pointer lock failed');}
 async function buy(id){if(await page.locator('#buy-menu').isHidden())await page.keyboard.press('b');await page.locator(`[data-buy="${id}"]`).click();await page.waitForFunction(id=>window.__dust2.getStatus().player.inventory.includes(id),id);await page.locator('#close-buy').click();await lock();await page.waitForFunction(id=>{const s=window.__dust2.getStatus();return s.viewModel.id===id&&!s.viewModel.waiting;},id,{timeout:25000});await page.waitForTimeout(800);}
 await lock();
 await page.keyboard.down('Tab');for(let i=0;i<15;i++)await page.keyboard.down('Tab');
 const held=await page.evaluate(()=>({score:!document.getElementById('scoreboard').hidden,focus:document.activeElement.id,lock:document.pointerLockElement?.id}));
 if(!held.score||held.focus!=='game-canvas'||!held.lock)throw Error('Held Tab moved browser focus '+JSON.stringify(held));
 await page.screenshot({path:'output/playwright/gameplay-scoreboard.png'});await page.keyboard.up('Tab');if(await page.locator('#scoreboard').isVisible())throw Error('Tab release left scoreboard visible');
 await page.keyboard.press('Escape');await page.locator('#host-bots').selectOption('2');await page.locator('#host-bots-apply').click();await page.waitForFunction(()=>window.__dust2.getStatus().players.filter(p=>p.bot).length===2);await lock();
 const throws=[];
 for(const kind of ['full','drop','lob']){
  await buy('hegrenade');const before=(await status()).player.utilityCounts.hegrenade;
  if(kind!=='drop')await page.mouse.down();if(kind!=='full')await page.mouse.down({button:'right'});
  await page.waitForTimeout(1400);const primed=(await status()).player.grenadeState;
  if(primed.state!=='primed'||primed.mode!==kind)throw Error('Grenade hold state '+JSON.stringify(primed));
  if((await status()).player.utilityCounts.hegrenade!==before)throw Error('Holding consumed grenade');
  if(kind==='lob')await page.screenshot({path:'output/playwright/gameplay-grenade-hold.png'});
  if(kind!=='drop')await page.mouse.up();if(kind!=='full')await page.mouse.up({button:'right'});
  await page.waitForFunction(n=>window.__dust2.getStatus().player.utilityCounts.hegrenade===n-1,before,{timeout:2500});throws.push({kind,primed});await page.waitForTimeout(400);
 }
 await buy('smokegrenade');await page.mouse.down();await page.waitForTimeout(400);const beforeCancel=(await status()).player.utilityCounts.smokegrenade;await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(350);if((await status()).player.utilityCounts.smokegrenade!==beforeCancel)throw Error('Esc threw grenade');await lock();
 await buy('m4a4');await page.mouse.down();await page.mouse.up();await page.waitForTimeout(250);const carried=(await status()).player;
 await page.keyboard.press('g');await page.waitForFunction(()=>window.__dust2.getStatus().droppedWeapons.some(d=>d.weaponId==='m4a4'));const drop=(await status()).droppedWeapons.find(d=>d.weaponId==='m4a4');
 if(drop.ammo!==carried.ammo||drop.skinId!==carried.skinId)throw Error('Drop lost skin/ammo');
 let mx=800,my=475;await page.mouse.move(mx,my);await page.waitForTimeout(120);
 for(let i=0;i<3;i++){
  const p=(await status()).player,dx=drop.x-p.x,dz=drop.z-p.z,dy=drop.y+.12-(p.y+1.62),yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(dy,Math.hypot(dx,dz)),scale=.022*Math.PI/180;
  mx-=Math.atan2(Math.sin(yaw-p.yaw),Math.cos(yaw-p.yaw))/scale;my-=(pitch-p.pitch)/scale;await page.mouse.move(mx,my);await page.waitForTimeout(120);
 }
 await page.screenshot({path:'output/playwright/gameplay-pickup.png'});await page.keyboard.press('e');await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='m4a4',null,{timeout:2500});const picked=(await status()).player;
 if(picked.ammo!==drop.ammo||picked.skinId!==drop.skinId)throw Error('Pickup lost skin/ammo');
 const result={tab:held,throws,cancelKept:true,drop:{ammo:drop.ammo,skin:drop.skinId},pickup:{ammo:picked.ammo,skin:picked.skinId},resources:(await status()).resources};await page.evaluate(r=>window.gameplayQA=r,result);return result;
}

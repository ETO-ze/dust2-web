async(page)=>{
 async function ensurePointer(){
  for(let attempt=0;attempt<3;attempt++){
   if(await page.evaluate(()=>!!document.pointerLockElement))return;
   await page.waitForTimeout(800);
   if(await page.locator('#pause-menu').isVisible())await page.locator('#resume-button').click();
   try{await page.waitForFunction(()=>!!document.pointerLockElement,null,{timeout:1500});return;}catch{}
  }
  throw Error('Pointer lock unavailable for '+await page.evaluate(()=>window.__dust2.getStatus().player?.weapon));
 }
 await page.waitForFunction(()=>window.__dust2?.getStatus().connected,{},{timeout:60000});
 await page.request.post('http://127.0.0.1:3004/stop-soak');await page.request.post('http://127.0.0.1:3004/hold');
 await ensurePointer();
 const result=[];
 const sets={CT:['usp','elite','p250','fiveseven','deagle','nova','mag7','mp9','mp7','bizon','scar20','m4a4','m4a1','ssg08','awp'],T:['pistol','tec9','xm1014','sawedoff','mac10','galilar','ak47','sg553']};
 const captured=new Set(['elite','m4a4','m4a1','pistol','ak47','sg553']);
 for(const [team,weapons]of Object.entries(sets)){
  await page.request.post('http://127.0.0.1:3004/team/'+team);await page.waitForFunction(team=>window.__dust2.getStatus().player.team===team,team);
  for(const weapon of weapons){
   if(await page.locator('#buy-menu').isHidden())await page.keyboard.press('b');
   await page.locator(`[data-buy="${weapon}"]`).click();await page.waitForFunction(w=>window.__dust2.getStatus().player?.weapon===w,weapon);
   await page.locator('#close-buy').click();await page.waitForTimeout(300);await ensurePointer();
   await page.waitForFunction(w=>{const s=window.__dust2.getStatus();return s.viewModel?.id===w&&!s.viewModel.waiting&&s.viewModel.visible;},weapon,{timeout:20000});
   await page.waitForTimeout(700);
   if(captured.has(weapon))await page.screenshot({path:`output/playwright/equipment-${weapon}-final.png`});
   const before=await page.evaluate(()=>window.__dust2.getStatus().player.ammo);
   await page.mouse.down();await page.mouse.up();
   await page.waitForFunction(before=>window.__dust2.getStatus().player.ammo===before-1,before,{timeout:2000});
   const s=await page.evaluate(()=>window.__dust2.getStatus());result.push({weapon,ammo:s.player.ammo,model:s.viewModel.id,skin:s.viewModel.skinId,action:s.viewModel.action});await page.evaluate(r=>window.equipmentQA=r,result);
   if(weapon==='sg553'){await page.waitForTimeout(300);await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.waitForTimeout(120);const scope=await page.evaluate(()=>({f:window.__dust2.getStatus().zoomFov,crosshair:document.getElementById('crosshair').className}));if(scope.f!==45||scope.crosshair.includes('hidden'))throw Error('SG553 optic aim missing');await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});}
  }
  await page.keyboard.press('b');await page.screenshot({path:`output/playwright/equipment-${team.toLowerCase()}-shop.png`});await page.locator('#close-buy').click();await page.waitForTimeout(300);await ensurePointer();
 }
 return {tested:result.length,result,resources:await page.evaluate(()=>window.__dust2.getStatus().resources)};
}

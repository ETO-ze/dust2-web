async(page)=>{
 await page.waitForFunction(()=>window.__dust2?.getStatus().connected,{},{timeout:90000});
 if(await page.locator('#resume-button').isVisible())await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!!document.pointerLockElement);
 // Pointer Lock can receive physical desktop mouse motion even in a Windows
 // automation session. Hold fixture aim steady while testing click/zoom/switch.
 await page.evaluate(()=>{window.scopeQAHoldAim=e=>e.stopImmediatePropagation();window.addEventListener('mousemove',window.scopeQAHoldAim,true);});
 try{
 const results=[];
 for(const [weapon,levels]of [['awp',[1,2]],['ssg08',[1,2]],['scar20',[1,2]],['sg553',[1]]])for(const level of levels){
  const setup=await page.request.post(`http://127.0.0.1:3004/qa/aim-lane/${weapon}`);if(!setup.ok())throw Error(await setup.text());const [lane]=await setup.json();
  await page.waitForFunction(w=>{const s=window.__dust2.getStatus();return s.player.weapon===w&&s.viewModel.id===w&&!s.viewModel.waiting&&s.zoomLevel===0;},weapon);
  await page.waitForTimeout(1700);
  for(let i=0;i<level;i++){await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.waitForTimeout(110);}
  await page.waitForTimeout(450);
  const aim=await page.evaluate(()=>{const s=window.__dust2.getStatus();return {zoom:s.zoomLevel,fov:s.zoomFov,cameraFov:s.cameraFov,cameraAim:s.cameraAim,model:s.viewModel,scopeMode:document.querySelector('#scope').dataset.mode,scopeRadius:parseFloat(document.querySelector('#scope').style.getPropertyValue('--scope-radius')),scopeHidden:document.querySelector('#scope').hidden};});
  if(aim.zoom!==level||aim.scopeHidden||aim.scopeMode!==(weapon==='sg553'?'optic':'scope'))throw Error('Wrong scope '+weapon+' '+JSON.stringify(aim));
  await page.screenshot({path:`output/playwright/scope-${weapon}-${level}.png`});
  const before=await page.evaluate(()=>window.__dust2.getStatus().lastShot?.shotId||0);
  await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(id=>(window.__dust2.getStatus().lastShot?.shotId||0)>id,before,{timeout:2000});
  const shot=await page.evaluate(()=>window.__dust2.getStatus().lastShot);
  if(shot.weapon!==weapon||shot.zoomLevel!==level||shot.hitId!==lane.target.id)throw Error('Aimed shot missed: '+JSON.stringify({weapon,level,lane,shot}));
  if(Math.abs(shot.aim.pitch-aim.cameraAim.pitch)>.00001||Math.abs(shot.aim.yaw-aim.cameraAim.yaw)>.00001)throw Error('Reticle/ray mismatch');
  results.push({weapon,level,range:lane.distance,aim,shot});
  await page.evaluate(r=>window.scopeQAProgress=r,results);
 }
 await page.request.post('http://127.0.0.1:3004/qa/aim-lane/awp');await page.waitForTimeout(1700);await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.waitForTimeout(200);
 const before=await page.evaluate(()=>window.__dust2.getStatus().lastShot?.shotId||0);await page.mouse.down();await page.mouse.up();await page.keyboard.press('3');
 await page.waitForFunction(id=>{const s=window.__dust2.getStatus();return s.lastShot?.shotId>id&&s.player.weapon==='knife';},before,{timeout:2500});
 const switchShot=await page.evaluate(()=>window.__dust2.getStatus().lastShot);if(switchShot.weapon!=='awp'||switchShot.zoomLevel!==1||!switchShot.hitId)throw Error('Quick switch lost shot');
 const report={results,quickSwitch:switchShot,errors:await page.evaluate(()=>window.__dust2.getDiagnostics().events.filter(e=>/error|reject|lost/.test(e.type)))};
 await page.evaluate(r=>window.scopeQA=r,report);return report;
 }finally{await page.evaluate(()=>{window.removeEventListener('mousemove',window.scopeQAHoldAim,true);delete window.scopeQAHoldAim;});}
}

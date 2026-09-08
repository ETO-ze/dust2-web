async (page) => {
  await page.bringToFront();
  const results={};
  await page.getByRole('button',{name:'继续游戏 ↗',exact:true}).click();
  await page.waitForFunction(()=>document.pointerLockElement?.id==='game-canvas');
  results.jump=[];
  for(let i=0;i<5;i++){
    await page.evaluate(()=>{window.__jumpQA={base:window.__dust2.getStatus().player.y,max:0,samples:[],active:true};function sample(){const q=window.__jumpQA,s=window.__dust2.getStatus();q.max=Math.max(q.max,s.player.y-q.base);q.samples.push({y:s.player.y,serverY:s.players.find(p=>p.id===s.myId).y,grounded:s.player.grounded});if(q.active)requestAnimationFrame(sample);}sample();});
    await page.keyboard.down('Space');await page.keyboard.up('Space');
    await page.waitForTimeout(1050);
    const jump=await page.evaluate(()=>{window.__jumpQA.active=false;const s=window.__dust2.getStatus();return {height:window.__jumpQA.max,id:s.jumpId,grounded:s.player.grounded,serverHeight:Math.max(...window.__jumpQA.samples.map(p=>p.serverY))-window.__jumpQA.base};});
    if(jump.height<1||jump.serverHeight<1||!jump.grounded)throw Error('Short Space jump failed: '+JSON.stringify(jump));results.jump.push(jump);
  }
  await page.keyboard.press('b');
  await page.waitForFunction(()=>!document.querySelector('#buy-menu').hidden);
  await page.getByRole('button',{name:/AWP.*永恒之枪/}).click();
  await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='awp');
  results.shop=await page.locator('#shop-result').textContent();
  await page.screenshot({path:'output/playwright/shop-integrated.png'});
  await page.keyboard.press('b');await page.waitForFunction(()=>document.pointerLockElement?.id==='game-canvas');
  results.zoom=[];
  for(const level of [1,2,0]){
    await page.mouse.click(720,450,{button:'right'});await page.waitForTimeout(230);
    const z=await page.evaluate(()=>{const s=window.__dust2.getStatus();return {level:s.zoomLevel,fov:s.zoomFov,vertical:s.cameraFov};});
    if(z.level!==level)throw Error('AWP zoom did not cycle: '+JSON.stringify(z));results.zoom.push(z);
    if(level===2)await page.screenshot({path:'output/playwright/awp-second-zoom.png'});
  }
  await page.keyboard.press('3');await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='knife');
  await page.keyboard.press('q');await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='awp');
  await page.mouse.wheel(0,100);await page.waitForFunction(()=>window.__dust2.getStatus().player.slot===2);
  await page.mouse.wheel(0,-100);await page.waitForFunction(()=>window.__dust2.getStatus().player.slot===1);
  results.switching=true;
  await page.waitForTimeout(300);
  await page.mouse.click(720,450);await page.waitForFunction(()=>window.__dust2.getStatus().player.ammo===4);
  await page.keyboard.down('r');await page.keyboard.up('r');await page.waitForFunction(()=>window.__dust2.getStatus().player.reloadRemaining>0);
  results.reload=true;
  await page.waitForFunction(()=>window.__dust2.getStatus().player.ammo===5);
  await page.keyboard.down('Tab');await page.waitForFunction(()=>!document.querySelector('#scoreboard').hidden);await page.keyboard.up('Tab');
  await page.waitForFunction(()=>document.querySelector('#scoreboard').hidden);results.scoreboard=true;
  await page.evaluate(()=>document.exitPointerLock());
  await page.evaluate(r=>window.__controlsQA=r,results);
  return results;
}

async (page) => {
  await page.bringToFront();
  await page.waitForFunction(()=>window.__dust2?.getStatus().connected,{},{timeout:90000});
  await page.getByRole('button',{name:'继续游戏 ↗'}).click();
  await page.waitForFunction(()=>!!document.pointerLockElement);
  const check=async()=>page.evaluate(()=>({s:window.__dust2.getStatus(),lock:!!document.pointerLockElement,pause:!document.getElementById('pause-menu').hidden,death:!document.getElementById('death-screen').hidden,text:document.getElementById('death-screen').innerText}));
  const before=await check();
  await page.request.post('http://127.0.0.1:3004/kill');
  await page.waitForFunction(()=>window.__dust2.getStatus().player?.alive===false);
  await page.waitForTimeout(400);
  const dead=await check();
  if(!dead.lock||dead.pause||!dead.death)throw Error('Death incorrectly opened menu or unlocked mouse');
  await page.screenshot({path:'output/playwright/death-screen-qa.png'});
  await page.waitForFunction(()=>window.__dust2.getStatus().player?.alive===true,{},{timeout:6000});
  await page.waitForTimeout(150);
  const alive=await check();
  if(!alive.lock||alive.pause||alive.death)throw Error('Respawn did not return directly to gameplay');
  await page.keyboard.down('w');await page.waitForTimeout(200);await page.keyboard.up('w');
  const moved=await check();
  const distance=Math.hypot(moved.s.player.x-alive.s.player.x,moved.s.player.z-alive.s.player.z);
  if(distance<.05)throw Error('Cannot move immediately after respawn');
  await page.keyboard.press('Escape');await page.waitForTimeout(200);
  const menu=await check();
  if(menu.lock||!menu.pause)throw Error('Esc failed to return cursor and menu');
  await page.getByRole('button',{name:'继续游戏 ↗'}).click();
  await page.waitForFunction(()=>!!document.pointerLockElement);
  await page.request.post('http://127.0.0.1:3004/defuse');
  await page.request.post('http://127.0.0.1:3004/kill');
  await page.waitForFunction(()=>!!window.__dust2.getStatus().spectatingId,{},{timeout:6000});
  const watching=await check();
  await page.mouse.click(700,450);
  await page.waitForTimeout(180);
  const switched=await check();
  if(watching.s.spectatingId===switched.s.spectatingId)throw Error('Spectator click did not change teammates');
  await page.screenshot({path:'output/playwright/spectator-screen-qa.png'});
  // Explicit Esc while dead remains a menu; Continue returns to death observation.
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'继续游戏 ↗'}).click();
  await page.waitForFunction(()=>!!document.pointerLockElement);
  await page.request.post('http://127.0.0.1:3004/respawn');
  await page.waitForFunction(()=>window.__dust2.getStatus().player?.alive);
  await page.evaluate(()=>{
    clearInterval(window.stabilitySampleTimer);window.stabilitySamples=[];window.stabilityStartedAt=Date.now();
    window.stabilitySampleTimer=setInterval(()=>{
      const s=window.__dust2.getStatus();
      window.stabilitySamples.push({at:Date.now(),...s.resources,deaths:s.player?.deaths,lock:!!document.pointerLockElement,pause:!document.getElementById('pause-menu').hidden});
      if(window.stabilitySamples.length>360)window.stabilitySamples.shift();
    },2000);
  });
  await page.request.post('http://127.0.0.1:3004/soak');
  return {death:{lock:dead.lock,pause:dead.pause,text:dead.text},respawn:{lock:alive.lock,pause:alive.pause,distance},esc:{lock:menu.lock,pause:menu.pause},spectator:{first:watching.s.spectatingId,second:switched.s.spectatingId},resources:before.s.resources,soakStarted:true};
}

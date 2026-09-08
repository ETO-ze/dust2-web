async(page)=>{
  await page.waitForFunction(()=>window.__dust2.getStatus().connected,{},{timeout:30000});
  const result=await page.evaluate(()=>({url:location.href,connected:window.__dust2.getStatus().connected,initialCursorVisible:!document.pointerLockElement,files:document.querySelector('#load-files').textContent,optionalRequests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/optional/')&&e.name.includes('.glb')).length,worker:navigator.serviceWorker.controller?.scriptURL,crosshair:window.__dust2.getStatus().settings.crosshair}));
  if(!result.initialCursorVisible||result.optionalRequests!==0)throw Error('Initial public cursor/lazy skin regression');
  await page.bringToFront();await page.getByRole('button',{name:'继续游戏 ↗',exact:true}).click();
  await page.waitForFunction(()=>document.pointerLockElement?.id==='game-canvas');
  result.capturedInGameplay=true;
  await page.keyboard.press('b');await page.waitForFunction(()=>!document.pointerLockElement&&!document.querySelector('#buy-menu').hidden);
  result.shopCursorVisible=true;
  await page.getByRole('button',{name:/AWP.*永恒之枪/}).click();await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='awp');
  await page.screenshot({path:'output/playwright/public-cs-shop.png'});
  await page.keyboard.press('b');await page.waitForFunction(()=>document.pointerLockElement?.id==='game-canvas');await page.waitForTimeout(250);
  await page.mouse.click(720,450,{button:'right'});await page.waitForTimeout(100);await page.mouse.click(720,450,{button:'right'});await page.waitForTimeout(200);
  result.zoom=await page.evaluate(()=>window.__dust2.getStatus().zoomLevel);if(result.zoom!==2)throw Error('Public second zoom failed');
  await page.screenshot({path:'output/playwright/public-cs-second-zoom.png'});
  await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>!document.pointerLockElement);
  result.pauseCursorVisible=true;
  await page.getByRole('button',{name:'退出房间',exact:true}).click();result.leftRoom=true;
  await page.evaluate(r=>window.__publicControlsQA=r,result);return result;
}

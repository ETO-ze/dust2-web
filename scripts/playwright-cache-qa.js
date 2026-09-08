async (page) => {
  if(await page.locator('#skin-menu').isVisible())await page.getByRole('button',{name:'完成 ×',exact:true}).click();
  await page.getByRole('button',{name:'本地资源',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#cache-count').textContent.includes('590 / 590'));
  await page.getByRole('button',{name:'保存基础游戏资源',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#cache-status').textContent.includes('基础游戏资源已保存'));
  const results={size:await page.locator('#cache-size').textContent(),count:await page.locator('#cache-count').textContent(),persistence:await page.locator('#cache-persistence').textContent()};
  await page.screenshot({path:'output/playwright/local-cache-complete.png'});
  await page.getByRole('button',{name:'完成 ×',exact:true}).click();
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.context().setOffline(true);
  try{
    await page.reload();await page.getByRole('button',{name:'开始对战 ↗',exact:true}).waitFor({state:'visible'});
    const probe=await page.evaluate(()=>fetch('health?offlineProbe='+Date.now(),{cache:'no-store'}).then(()=>true).catch(()=>false));
    if(probe)throw Error('Offline simulation did not block uncached network');
    results.uncachedNetworkBlocked=true;
    results.offlineLobby=true;
    results.persistedSkin=await page.evaluate(()=>JSON.parse(localStorage.getItem('dust2.skins.v1')).ak47);
    results.sensitivity=await page.evaluate(()=>window.__dust2.getStatus().settings.sensitivity);
    await page.screenshot({path:'output/playwright/offline-lobby.png'});
  }finally{await page.context().setOffline(false);}
  await page.evaluate(()=>performance.clearResourceTimings());
  await page.getByRole('combobox',{name:'机器人',exact:true}).selectOption('0');
  const start=Date.now();await page.getByRole('button',{name:'开始对战 ↗',exact:true}).click();
  await page.waitForFunction(()=>window.__dust2.getStatus().connected);
  results.warmLoadMs=Date.now()-start;
  results.afterLoad=await page.evaluate(()=>({locked:!!document.pointerLockElement,skin:window.__dust2.getStatus().player.skinId,optionalRequests:performance.getEntriesByType('resource').filter(e=>e.name.includes('/optional/')&&e.name.includes('.glb')).map(e=>e.name),assetWireBytes:performance.getEntriesByType('resource').filter(e=>e.name.includes('/assets/')&&!e.name.includes('asset-manifest')).reduce((s,e)=>s+e.transferSize,0)}));
  if(results.afterLoad.locked)throw Error('Cursor was captured before explicit Continue');
  if(results.afterLoad.skin!=='ak47-fire-serpent')throw Error('Selected skin did not persist into match');
  await page.evaluate(r=>window.__cacheQA=r,results);return results;
}

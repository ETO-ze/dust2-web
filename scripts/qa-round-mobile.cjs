async page=>{
  await page.bringToFront();await page.setViewportSize({width:915,height:412});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.locator('#nickname').fill('Mobile economy QA');await page.locator('#mode').selectOption('defuse');await page.locator('#bots').selectOption('3');await page.locator('#start-button').tap();
  await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
  await page.request.post('http://127.0.0.1:3004/hold');await page.locator('.room-play').tap();
  await page.waitForFunction(()=>window.__dust2.getStatus().player.botBuy==='手枪局');
  await page.locator('.touch-toolbar [data-action="buy"]').tap();
  await page.waitForFunction(()=>document.querySelector('#buy-note').textContent.includes('手枪局'));
  const economy=await page.locator('#buy-note').textContent();await page.screenshot({path:'output/playwright/mobile-economy.png'});
  await page.locator('#close-buy').tap();
  await page.request.post('http://127.0.0.1:3004/qa/round-update/ended');
  await page.waitForFunction(()=>{const p=window.__dust2.getStatus().player;return p.weapon==='awp'&&p.fireReadyRemaining===0;});
  await page.locator('.touch-alt').tap();await page.locator('.touch-fire').tap();
  await page.waitForFunction(()=>window.__dust2.getStatus().player.ammo===4&&window.__dust2.getStatus().player.headshots===1);
  await page.waitForTimeout(200);await page.screenshot({path:'output/playwright/mobile-round-headshot.png'});
  await page.request.post('http://127.0.0.1:3004/qa/round-update/flash-assist');
  await page.waitForFunction(()=>window.__dust2.getStatus().player.assists===1);
  await page.waitForTimeout(250);await page.screenshot({path:'output/playwright/mobile-flash-assist.png'});
  const bounds=await page.locator('#kill-confirm').boundingBox();
  if(bounds.x<0||bounds.y<0||bounds.x+bounds.width>915||bounds.y+bounds.height>412)throw Error('Feedback extends outside mobile viewport');
  await page.request.post('http://127.0.0.1:3004/qa/utility/smokegrenade');
  await page.waitForFunction(()=>{const p=window.__dust2.getStatus().player;return p.weapon==='smokegrenade'&&p.fireReadyRemaining===0;});
  await page.locator('.touch-fire').tap();
  await page.waitForFunction(()=>window.__dust2.getStatus().audio.lastUtility?.bank==='smokegrenadeDetonate',null,{timeout:15000});
  const result=await page.evaluate(()=>{const s=window.__dust2.getStatus();return {audio:s.audio.lastUtility,assists:s.player.assists,headshots:s.player.headshots,resources:s.resources,touch:s.touch.enabled,contextLost:s.contextLost};});
  await page.evaluate(r=>window.__mobileRoundQA=r,{...result,economy,bounds,failures});if(failures.length)throw Error(failures.join('\n'));
}

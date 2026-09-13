async page=>{
  await page.bringToFront();await page.setViewportSize({width:915,height:412});
  await page.locator('#nickname').fill('Mobile shooting QA');await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');await page.locator('#start-button').tap();
  await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
  await page.request.post('http://127.0.0.1:3004/hold');await page.locator('.room-play').tap();
  await page.request.post('http://127.0.0.1:3004/qa/aim-lane/awp');
  await page.waitForFunction(()=>{const p=window.__dust2.getStatus().player;return p.weapon==='awp'&&p.fireReadyRemaining===0;});
  await page.locator('.touch-alt').tap();await page.locator('.touch-fire').tap();
  await page.waitForFunction(()=>{const s=window.__dust2.getStatus();return s.player.ammo===4&&s.lastShot?.hitId&&s.shooting.pending===0;});
  await page.evaluate(()=>{const s=window.__dust2.getStatus();window.__mobileShotResult={touch:s.touch,ammo:s.player.ammo,hitId:s.lastShot.hitId,shooting:s.shooting};});
  await page.screenshot({path:'output/playwright/shot-mobile.png'});
}

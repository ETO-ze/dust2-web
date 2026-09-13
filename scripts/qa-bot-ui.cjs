async page=>{
 await page.setViewportSize({width:1366,height:768});
 await page.locator('#menu-settings').click();await page.locator('[data-tab="bots"]').click();
 await page.locator('#bot-difficulty').selectOption('hard');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dust2.cs-settings.v1')).botDifficulty==='hard');
 await page.screenshot({path:'output/playwright/bot-difficulty.png'});await page.locator('#close-settings').click();
 await page.locator('#nickname').fill('BOT UI QA');await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
 if(await page.evaluate(()=>window.__dust2.getStatus().botDifficulty)!=='hard')throw Error('Room difficulty did not persist');
 await page.request.post('http://127.0.0.1:3004/hold');await page.locator('.room-play').click();
 await page.request.post('http://127.0.0.1:3004/qa/movement/window');
 await page.waitForTimeout(1200);await page.screenshot({path:'output/playwright/b-window-current.png'});
 await page.request.post('http://127.0.0.1:3004/qa/movement/scaffold');await page.waitForTimeout(800);await page.screenshot({path:'output/playwright/b-scaffold-current.png'});
 await page.request.post('http://127.0.0.1:3004/defuse');await page.request.post('http://127.0.0.1:3004/kill');
 await page.waitForFunction(()=>{const s=window.__dust2.getStatus();return s.spectatingId&&!document.querySelector('#crosshair').hidden&&getComputedStyle(document.querySelector('#crosshair')).display!=='none';},null,{timeout:10000});
 await page.screenshot({path:'output/playwright/bot-spectator-crosshair.png'});
 console.log(JSON.stringify(await page.evaluate(()=>{const s=window.__dust2.getStatus();return {room:s.room,difficulty:s.botDifficulty,spectatingId:s.spectatingId,crosshair:{hidden:document.querySelector('#crosshair').hidden,display:getComputedStyle(document.querySelector('#crosshair')).display}};})));
}

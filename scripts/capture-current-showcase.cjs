async page=>{
 await page.bringToFront();await page.setViewportSize({width:1600,height:900});
 await page.locator('#nickname').fill('尘雨 · 本地演示');await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');
 await page.screenshot({path:'output/playwright/current-lobby.png'});
 await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
 await page.request.post('http://127.0.0.1:3004/hold');
 await page.screenshot({path:'output/playwright/current-room.png'});
 await page.locator('.room-play').click();await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.request.post('http://127.0.0.1:3004/qa/movement/flat');
 await page.waitForFunction(()=>{const s=window.__dust2.getStatus();return s.player.alive&&!s.viewModel.waiting&&s.viewModel.visible;});
 await page.waitForTimeout(1400);await page.screenshot({path:'output/playwright/current-desktop.png'});
 await page.keyboard.press('KeyB');await page.waitForFunction(()=>!document.querySelector('#buy-menu').hidden);
 await page.screenshot({path:'output/playwright/current-shop.png'});
 await page.locator('#close-buy').click();
 await page.request.post('http://127.0.0.1:3004/defuse');await page.request.post('http://127.0.0.1:3004/kill');
 await page.waitForFunction(()=>document.querySelector('.death-screen-keys').textContent.includes('E 控制人机'));
 await page.screenshot({path:'output/playwright/current-bot-control.png'});
}

async page=>{
 await page.bringToFront();
 await page.keyboard.press('Escape');await page.locator('#game-settings').click();await page.locator('[data-tab="bots"]').click();
 await page.locator('#bot-difficulty').selectOption('normal');
 await page.waitForFunction(()=>window.__dust2.getStatus().botDifficulty==='normal'&&JSON.parse(localStorage.getItem('dust2.cs-settings.v1')).botDifficulty==='normal');
 await page.waitForFunction(()=>!document.querySelector('#bot-difficulty').disabled);
 await page.waitForTimeout(280);
 await page.locator('#bot-difficulty').selectOption('hard');
 await page.waitForFunction(()=>window.__dust2.getStatus().botDifficulty==='hard'&&JSON.parse(localStorage.getItem('dust2.cs-settings.v1')).botDifficulty==='hard');
}

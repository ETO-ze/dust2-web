async page=>{
 await page.setViewportSize({width:915,height:412});
 await page.locator('#menu-settings').click();await page.locator('[data-tab="bots"]').click();
 if(await page.locator('#bot-difficulty').inputValue()!=='normal')throw Error('New profile must default to normal');
 await page.screenshot({path:'output/playwright/bot-mobile-settings.png'});await page.locator('#close-settings').click();
 await page.locator('.public-room b').first().waitFor();const roomCode=(await page.locator('.public-room b').first().textContent()).split(' · ')[0];
 await page.locator('#nickname').fill('Mobile difficulty QA');await page.locator('#room-code').fill(roomCode);await page.locator('#join-button').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
 if(await page.evaluate(()=>window.__dust2.getStatus().botDifficulty)!=='hard')throw Error('Joining player changed the room difficulty');
 await page.locator('.room-close').click();await page.locator('#game-settings').click();await page.locator('[data-tab="bots"]').click();
 if(!await page.locator('#bot-difficulty').isDisabled())throw Error('Nonhost difficulty was editable');
 const bounds=await page.locator('#bot-difficulty').boundingBox();if(bounds.x<0||bounds.x+bounds.width>915||bounds.y<0||bounds.y+bounds.height>412)throw Error('Mobile difficulty selector overflow');
 await page.screenshot({path:'output/playwright/bot-mobile-joined.png'});
}

async(page)=>{
 await page.goto('https://cs2.duskrain.cn/',{waitUntil:'domcontentloaded'});
 await page.setViewportSize({width:1600,height:950});
 if(await page.evaluate(()=>!!document.pointerLockElement))throw Error('Lobby captured mouse');
 await page.locator('[data-team="CT"]').click();await page.locator('#nickname').fill('上线验收');await page.locator('#bots').selectOption('4');
 await page.locator('#start-button').click();
 return {url:page.url(),loading:true};
}

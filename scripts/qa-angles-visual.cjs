async page=>{
await page.goto('http://127.0.0.1:3003');await page.setViewportSize({width:1440,height:900});await page.locator('#nickname').fill('地图 QA');await page.locator('#bots').selectOption('0');await page.locator('#start-button').click();await page.waitForFunction(()=>window.__dust2?.getStatus().connected,{timeout:180000});await page.locator('.room-play').click();
for(const zone of ['short','ramp','window']){await page.request.post('http://127.0.0.1:3004/qa/movement/'+zone);await page.waitForTimeout(1300);await page.screenshot({path:'output/playwright/'+zone+'-after.png'});}
await page.request.post('http://127.0.0.1:3004/qa/utility/plant');await page.waitForFunction(()=>window.__dust2.getStatus().player?.weapon==='c4');await page.waitForTimeout(900);await page.mouse.down();await page.waitForTimeout(1550);await page.screenshot({path:'output/playwright/c4-plant-after.png'});console.log(await page.evaluate(()=>window.__dust2.getStatus().player));await page.mouse.up();
}

async(page)=>{
 await page.request.post('http://127.0.0.1:3004/stop-soak');await page.request.post('http://127.0.0.1:3004/hold');
 await page.waitForFunction(()=>window.__dust2.getStatus().player.alive);
 if(await page.locator('#pause-menu').isVisible())await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.keyboard.press('b');await page.locator('[data-buy="smokegrenade"]').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().player.utilityCounts.smokegrenade===1);
 await page.locator('#close-buy').click();await page.waitForTimeout(900);
 if(await page.locator('#pause-menu').isVisible())await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.waitForFunction(()=>window.__dust2.getStatus().viewModel.id==='smokegrenade'&&!window.__dust2.getStatus().viewModel.waiting);
 await page.mouse.down();await page.mouse.up();
 await page.waitForFunction(()=>window.__dust2.getStatus().smokes.length>0,null,{timeout:6000});await page.waitForTimeout(1000);
 await page.screenshot({path:'output/playwright/equipment-smoke-cloud.png'});
 const smoke=await page.evaluate(()=>({clouds:window.__dust2.getStatus().smokes,opacity:document.getElementById('smoke-effect').style.opacity}));
 await page.keyboard.press('b');await page.locator('[data-buy="flashbang"]').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().player.utilityCounts.flashbang===1);
 await page.locator('#close-buy').click();await page.waitForTimeout(900);
 if(await page.locator('#pause-menu').isVisible())await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.waitForFunction(()=>window.__dust2.getStatus().viewModel.id==='flashbang'&&!window.__dust2.getStatus().viewModel.waiting);
 await page.mouse.down();await page.mouse.up();
 await page.waitForFunction(()=>Number(document.getElementById('flash-effect').style.opacity)>.02,null,{timeout:6000});
 const flash=await page.evaluate(()=>Number(document.getElementById('flash-effect').style.opacity));
 await page.screenshot({path:'output/playwright/equipment-flash-effect.png'});
 return {smoke,flash,resources:await page.evaluate(()=>window.__dust2.getStatus().resources)};
}

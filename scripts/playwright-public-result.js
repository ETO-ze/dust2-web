async(page)=>{
 await page.waitForFunction(()=>window.__dust2?.getStatus().connected,null,{timeout:120000});
 await page.waitForFunction(()=>window.__dust2.getStatus().viewModel.visible);
 const initial=await page.evaluate(()=>({s:window.__dust2.getStatus(),locked:!!document.pointerLockElement}));
 if(initial.locked||initial.s.settings.quality!=='low'||initial.s.player.agentId!=='ct-sas')throw Error('Public default settings or cursor incorrect');
 await page.locator('#resume-button').click();await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.waitForTimeout(1000);await page.screenshot({path:'output/playwright/public-final-game.png'});
 await page.keyboard.press('b');const shop=await page.locator('[data-buy]').count();if(shop!==21)throw Error('Public CT shop mismatch');
 await page.keyboard.press('Escape');
 return {url:page.url(),release:(await(await page.request.get('https://cs2.duskrain.cn/health')).json()).release,shop,agent:initial.s.player.agentId,quality:initial.s.settings.quality,resources:await page.evaluate(()=>window.__dust2.getStatus().resources)};
}

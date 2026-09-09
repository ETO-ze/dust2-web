async(page)=>{
 await page.waitForFunction(()=>window.__dust2?.getStatus().connected,null,{timeout:60000});
 await page.request.post('http://127.0.0.1:3004/hold');
 if(await page.locator('#pause-menu').isHidden())await page.keyboard.press('Escape');
 await page.locator('#pause-menu .agents-button').click();
 if(await page.evaluate(()=>!!document.pointerLockElement))throw Error('Agent menu captured cursor');
 await page.locator('[data-agent="ct-ava"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-agent="ct-ava"]').getAttribute('aria-pressed')==='true',null,{timeout:30000});
 await page.waitForFunction(()=>window.__dust2.getStatus().player.agentId==='ct-ava');
 await page.locator('[data-agent="t-miami"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-agent="t-miami"]').getAttribute('aria-pressed')==='true',null,{timeout:30000});
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dust2.agents.v1')));
 if(saved.CT!=='ct-ava'||saved.T!=='t-miami')throw Error('Agent choices not saved');
 if(await page.evaluate(()=>window.__dust2.getStatus().player.agentId)!=='ct-ava')throw Error('Other team changed current appearance');
 await page.screenshot({path:'output/playwright/equipment-agents.png'});
 await page.locator('.agent-close').click();
 return {saved,agent:await page.evaluate(()=>window.__dust2.getStatus().player.agentId),pointerUnlocked:await page.evaluate(()=>!document.pointerLockElement)};
}

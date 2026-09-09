async(page)=>{
 await page.request.post('http://127.0.0.1:3004/hold');
 if(await page.locator('#pause-menu').isVisible())await page.locator('#resume-button').click();
 await page.keyboard.press('b');await page.locator('[data-buy="smokegrenade"]').click();await page.waitForFunction(()=>window.__dust2.getStatus().player.utilityCounts.smokegrenade===1);
 await page.locator('#close-buy').click();await page.waitForTimeout(1000);
 if(await page.locator('#pause-menu').isVisible())await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.mouse.down();await page.mouse.up();
 await page.waitForFunction(()=>window.__dust2.getStatus().smokes.length>0,null,{timeout:6000});
 await page.mouse.move(800,475);await page.waitForTimeout(150);
 const s=await page.evaluate(()=>window.__dust2.getStatus()),p=s.player,smoke=s.smokes.at(-1);
 const dx=smoke.x-p.x,dz=smoke.z-p.z,dy=smoke.y-(p.y+1.62),yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(dy,Math.hypot(dx,dz)),change=Math.atan2(Math.sin(yaw-p.yaw),Math.cos(yaw-p.yaw)),unit=.022*Math.PI/180*s.settings.sensitivity;
 await page.mouse.move(800-change/unit,475-(pitch-p.pitch)/unit);await page.waitForTimeout(700);
 await page.screenshot({path:'output/playwright/equipment-smoke-cloud.png'});
 return {cloud:smoke,player:await page.evaluate(()=>({yaw:window.__dust2.getStatus().player.yaw,pitch:window.__dust2.getStatus().player.pitch}))};
}

async page=>{
 await page.bringToFront();await page.setViewportSize({width:1280,height:720});
 await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');await page.locator('#nickname').fill('Takeover Desktop QA');
 await page.locator('#start-button').click();await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
 await page.locator('.room-play').click();await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.request.post('http://127.0.0.1:3004/defuse');await page.request.post('http://127.0.0.1:3004/hold');await page.request.post('http://127.0.0.1:3004/kill');
 await page.waitForFunction(()=>document.querySelector('.death-screen-keys').textContent.includes('E 控制人机'));
 await page.keyboard.press('KeyE');await page.waitForFunction(()=>{const s=window.__dust2.getStatus();return s.player.alive&&s.myId!==s.connectionId;});
 const before=await page.evaluate(()=>window.__dust2.getStatus());
 await page.keyboard.down('KeyW');await page.waitForTimeout(400);await page.keyboard.up('KeyW');await page.waitForTimeout(150);
 const moved=await page.evaluate(()=>window.__dust2.getStatus());
 if(Math.hypot(moved.player.x-before.player.x,moved.player.z-before.player.z)<.1)throw Error('Controlled movement did not advance');
 await page.keyboard.press('Digit1');await page.waitForTimeout(650);
 const ammo=await page.evaluate(()=>window.__dust2.getStatus().player.ammo);
 await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();await page.waitForTimeout(150);
 const shot=await page.evaluate(()=>window.__dust2.getStatus());if(!(shot.player.ammo<ammo))throw Error('Controlled bot did not fire');
 await page.screenshot({path:'output/playwright/desktop-bot-control.png'});
 console.log(JSON.stringify({controlled:shot.myId,connectionId:shot.connectionId,movement:Math.hypot(moved.player.x-before.player.x,moved.player.z-before.player.z),ammoBefore:ammo,ammoAfter:shot.player.ammo,ping:shot.ping,errors:[] }));
}

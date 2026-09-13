async page=>{
 await page.bringToFront();await page.setViewportSize({width:844,height:390});
 await page.evaluate(()=>{window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));});
 await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');
 await page.locator('#nickname').fill('Takeover Mobile QA');await page.locator('#start-button').tap();
 await page.waitForTimeout(1500);await page.screenshot({path:'output/playwright/mobile-loading-budget.png'});
 await page.waitForFunction(()=>window.__dust2.getStatus().connected||!document.querySelector('#loading-error').hidden,null,{timeout:180000});
 const s=await page.evaluate(()=>({s:window.__dust2.getStatus(),errors:window.__qaErrors,loading:document.querySelector('#load-label').textContent,error:document.querySelector('#loading-error').textContent}));
 if(!s.s.connected)throw Error(JSON.stringify(s));
 await page.locator('.room-play').tap();await page.request.post('http://127.0.0.1:3004/defuse');await page.request.post('http://127.0.0.1:3004/hold');await page.request.post('http://127.0.0.1:3004/kill');
 await page.waitForFunction(()=>!window.__dust2.getStatus().player.alive);
 await page.waitForFunction(()=>document.querySelector('.touch-use').textContent==='控制人机',null,{timeout:10000});
 await page.screenshot({path:'output/playwright/mobile-bot-control-hint.png'});
 const before=await page.evaluate(()=>window.__dust2.getStatus());
 await page.locator('.touch-use').tap();
 await page.waitForFunction(()=>{const s=window.__dust2.getStatus();return s.player.alive&&s.myId!==s.connectionId;});
 const after=await page.evaluate(()=>window.__dust2.getStatus());
 if(after.hostId!==after.connectionId||after.player.controllerId!==after.connectionId)throw Error('Control identity/host mismatch');
 await page.screenshot({path:'output/playwright/mobile-bot-controlled.png'});
 const sizes=[];
 for(const size of [{width:844,height:390},{width:667,height:320},{width:390,height:844}]){
   await page.setViewportSize(size);await page.waitForTimeout(300);
   sizes.push(await page.evaluate(()=>({inner:[innerWidth,innerHeight],canvas:(()=>{const r=document.querySelector('#game-canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})(),buttons:[...document.querySelectorAll('#touch-controls button:not([disabled])')].filter(b=>b.offsetParent).map(b=>{const r=b.getBoundingClientRect();return {label:b.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})})));
   await page.screenshot({path:`output/playwright/mobile-${size.width}x${size.height}.png`});
 }
 for(const size of sizes)if(size.buttons.some(b=>b.x<0||b.y<0||b.right>size.inner[0]+1||b.bottom>size.inner[1]+1))throw Error('Touch button outside viewport');
 await page.evaluate(result=>window.__takeoverQA=result,{before:{myId:before.myId,spectating:before.spectatingId},after:{myId:after.myId,connectionId:after.connectionId,health:after.player.health,weapon:after.player.weapon},sizes,errors:s.errors});
 console.log(JSON.stringify(await page.evaluate(()=>window.__takeoverQA)));
}

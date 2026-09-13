async page=>{
 await page.reload();await page.setViewportSize({width:844,height:390});
 await page.evaluate(()=>{window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));});
 await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('0');
 await page.locator('#nickname').fill('Mobile Clarity QA');await page.locator('#start-button').tap();
 await page.waitForFunction(()=>window.__dust2.getStatus().connected||!document.querySelector('#loading-error').hidden,null,{timeout:180000});
 if(!await page.evaluate(()=>window.__dust2.getStatus().connected))throw Error(await page.locator('#loading-error').textContent());
 await page.locator('.room-play').tap();await page.request.post('http://127.0.0.1:3004/qa/movement/flat');
 await page.waitForTimeout(1500);
 const rows=[];
 for(const clarity of ['performance','clear','sharp']){
   await page.locator('.touch-toolbar [data-action=menu]').tap();await page.locator('#game-settings').tap();
   await page.locator('#settings-menu [data-tab=video]').tap();
   await page.locator('#cs-mobile-clarity').selectOption(clarity);
   if(clarity==='clear'){await page.locator('#cs-mobile-clarity').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/mobile-clarity-settings.png'});}
   await page.locator('#close-settings').tap();await page.locator('#resume-button').tap();await page.waitForTimeout(500);
   const row=await page.evaluate(()=>{const s=window.__dust2.getStatus(),r=document.querySelector('#game-canvas').getBoundingClientRect();return {settings:s.settings,resources:s.resources,css:{width:r.width,height:r.height},dpr:devicePixelRatio,contextLost:s.contextLost,errors:window.__qaErrors};});
   if(row.settings.mobileClarity!==clarity||row.css.width!==844||row.css.height!==390||row.contextLost||row.errors.length)throw Error(JSON.stringify(row));
   if(row.resources.antialias!==true)throw Error('Phone MSAA unavailable in this emulated browser');
   if(clarity==='clear'&&(row.resources.renderWidth!==1688||row.resources.renderHeight!==780))throw Error('Default clear buffer not doubled');
   rows.push(row);await page.screenshot({path:`output/playwright/mobile-clarity-${clarity}.png`});
 }
 const sizes=[];
 for(const [width,height] of [[390,844],[667,320],[960,432]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(200);
   const s=await page.evaluate(()=>{const r=document.querySelector('#game-canvas').getBoundingClientRect(),s=window.__dust2.getStatus();return {inner:[innerWidth,innerHeight],css:[r.width,r.height],resources:s.resources};});
   if(s.css[0]!==width||s.css[1]!==height||s.resources.renderWidth*s.resources.renderHeight>2400000)throw Error('Resize budget/layout regression');sizes.push(s);
 }
 await page.reload();await page.waitForFunction(()=>window.__dust2?.getStatus().settings.mobileClarity==='sharp');
 const persisted=await page.evaluate(()=>({setting:window.__dust2.getStatus().settings.mobileClarity,stored:JSON.parse(localStorage.getItem('dust2.cs-settings.v1')).mobileClarity}));
 if(persisted.stored!=='sharp')throw Error('Clarity was not saved');
 await page.evaluate(result=>window.__clarityQA=result,{rows,sizes,persisted});
 console.log(JSON.stringify(await page.evaluate(()=>window.__clarityQA)));
}

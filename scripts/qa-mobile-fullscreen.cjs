// Run through Playwright CLI in a Chromium session with hasTouch=true.
async page=>{
 const checks=[];const ok=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
 await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});
 await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('1');
 await page.locator('#nickname').fill('Android fullscreen QA');await page.locator('#start-button').tap();
 await page.waitForFunction(()=>!!document.fullscreenElement);
 ok('starting with touch requests fullscreen before downloads',await page.evaluate(()=>!!document.fullscreenElement));
 await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
 await page.locator('.room-play').tap();await page.waitForFunction(()=>window.__dust2.getStatus().touch.active);
 ok('touch controls activate without pointer lock',await page.evaluate(()=>!document.pointerLockElement&&window.__dust2.getStatus().touch.active));
 await page.evaluate(async()=>{await document.exitFullscreen();});
 const button=page.locator('[data-touch-command="fullscreen"]');await button.tap();
 await page.waitForFunction(()=>!!document.fullscreenElement);
 ok('in-game fullscreen button works on a trusted touch release',await page.evaluate(()=>!!document.fullscreenElement));
 const request=await page.request.get('http://127.0.0.1:3003/downloads/DustII-Android-1.0.0.apk');
 const bytes=await request.body();ok('download returns a real APK ZIP',request.ok()&&bytes[0]===80&&bytes[1]===75&&bytes.length>100000);
 await page.screenshot({path:'output/playwright/android-browser-fullscreen.png'});
 await page.evaluate(checks=>window.__fullscreenQA={passed:true,checks,status:window.__dust2.getStatus().mobileShell},checks);
}

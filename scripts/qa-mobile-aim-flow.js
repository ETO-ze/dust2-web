async(page)=>{
 const check=(condition,message)=>{if(!condition)throw Error(message);};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.reload();await page.waitForFunction(()=>!!window.__dust2);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'触屏',exact:true}).click();
 // Selectors below are from the inspected settings snapshot and game source.
 await page.locator('[data-motion="assist"]').selectOption('low');
 await page.locator('[data-motion="invertX"]').check();
 await page.locator('[data-motion="mode"]').selectOption('scope');
 let saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('dust2.motion.v1')));
 check(saved.assist==='low'&&saved.invertX&&saved.mode==='scope','Settings were not persisted');
 await page.locator('[data-motion="mode"]').selectOption('always');
 await page.locator('[data-motion="assist"]').selectOption('standard');
 await page.locator('[data-motion="invertX"]').uncheck();
 await page.locator('.motion-settings').scrollIntoViewIfNeeded();
 await page.screenshot({path:'output/playwright/mobile-aim-settings.png'});
 await page.getByRole('button',{name:'完成 ×',exact:true}).click();
 await page.getByRole('button',{name:'本地资源',exact:true}).click();
 const downloadEvent=page.waitForEvent('download');await page.locator('#export-preferences').click();const download=await downloadEvent;
 await download.saveAs('D:/CodexBuilds/dust2-online-1.2.0/mobile-settings-backup.json');
 await page.evaluate(()=>localStorage.removeItem('dust2.motion.v1'));
 await page.locator('#preferences-file').setInputFiles('D:/CodexBuilds/dust2-online-1.2.0/mobile-settings-backup.json');
 await page.waitForFunction(()=>document.querySelector('#cache-status').textContent.includes('设置已恢复'));
 check(await page.evaluate(()=>JSON.parse(localStorage.getItem('dust2.motion.v1')).assist==='standard'),'Motion backup import failed');
 await page.locator('#close-offline').click();
 await page.getByRole('combobox',{name:'游戏模式',exact:true}).selectOption('deathmatch');
 await page.getByRole('combobox',{name:'创建房间的机器人数量'}).selectOption('9');
 await page.getByRole('textbox',{name:'玩家名称'}).fill('Motion Browser QA');
 await page.locator('#start-button').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
 await page.locator('.room-play').click();
 await page.waitForFunction(()=>window.__dust2.getStatus().touch.active&&window.__dust2.getStatus().player.alive);
 await page.waitForTimeout(500);
 // Browser QA has no physical sensor: inject measured orientation events only,
 // never change player state, view state or the server's shot result.
 await page.evaluate(()=>document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',pointerId:71,bubbles:true})));
 await page.waitForFunction(()=>window.__dust2.getStatus().mobileAim.active);
 const before=await page.evaluate(()=>window.__dust2.getStatus());
 const angle=await page.evaluate(()=>screen.orientation.angle);
 await page.evaluate(async()=>{for(let i=0;i<=20;i++){window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:i*.2,gamma:0}));await new Promise(r=>setTimeout(r,10));}});
 const after=await page.evaluate(()=>window.__dust2.getStatus());
 check(after.mobileAim.status==='陀螺仪运行中','Orientation did not reach the controller');
 check(Math.hypot(after.player.yaw-before.player.yaw,after.player.pitch-before.player.pitch)>.02,'Orientation did not reach authoritative input');
 await page.screenshot({path:'output/playwright/mobile-aim-gameplay.png'});
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await page.waitForFunction(()=>!window.__dust2.getStatus().mobileAim.active);
 const paused=await page.evaluate(()=>window.__dust2.getStatus());
 check(!paused.inputState.fire&&!paused.inputState.altFire&&paused.touch.pointers===0,'Blur left held input');
 check(paused.connected,'Opening menu disconnected the room');
 await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!document.querySelector('#pause-menu').hidden===false);
 const mouse=await page.evaluate(()=>window.__dust2.getStatus().mobileAim);
 check(mouse.lastInput==='mouse','Mouse did not become the active input source');
 check(!mouse.active,'Gyro fought mouse input');
 check(errors.length===0,errors.join('\n'));
 return {checks:['motion preferences','backup export and import','1 human + 9 bots','synthetic browser orientation -> server input','blur stops sensors and held inputs','menu keeps connection','mouse disables gyro'],orientation:angle,before:{yaw:before.player.yaw,pitch:before.player.pitch},after:{yaw:after.player.yaw,pitch:after.player.pitch},characters:after.players.length,errors};
}

async (page)=>{
  const results={};
  await page.getByRole('button',{name:'皮肤仓库',exact:true}).click();
  results.skinMenuCursor=await page.evaluate(()=>!document.pointerLockElement&&getComputedStyle(document.querySelector('#skin-menu')).cursor!=='none');
  await page.getByRole('button',{name:'AWP',exact:true}).click();
  await page.getByRole('button',{name:/巨龙传说 巨龙传说/}).click();
  await page.waitForFunction(()=>document.querySelector('.skin-status').textContent.startsWith('已装备 巨龙传说'));
  await page.waitForFunction(()=>window.__dust2.getStatus().player.skinId==='awp-dragon-lore');
  results.liveSkin=await page.evaluate(()=>window.__dust2.getStatus().players.find(p=>p.id===window.__dust2.getStatus().myId).skinId);
  await page.getByRole('button',{name:'完成 ×',exact:true}).click();
  await page.getByRole('button',{name:'继续游戏 ↗',exact:true}).click();
  await page.waitForFunction(()=>document.pointerLockElement?.id==='game-canvas');
  results.gameCursor=await page.evaluate(()=>document.body.classList.contains('mouse-captured'));
  await page.waitForTimeout(700);await page.screenshot({path:'output/playwright/awp-dragon-live.png'});
  await page.keyboard.press('b');await page.waitForFunction(()=>!document.pointerLockElement);
  results.shopCursor=await page.evaluate(()=>getComputedStyle(document.querySelector('#buy-menu')).cursor==='default');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'鼠标 / 按键 / 准星设置',exact:true}).click();
  results.settingsCursor=await page.evaluate(()=>!document.pointerLockElement&&getComputedStyle(document.querySelector('#settings-menu')).cursor==='default');
  await page.getByRole('button',{name:'完成 ×',exact:true}).click();
  if(!results.gameCursor||!results.skinMenuCursor||!results.shopCursor||!results.settingsCursor)throw Error('Cursor isolation failed: '+JSON.stringify(results));
  await page.evaluate(r=>window.__skinCursorQA=r,results);return results;
}

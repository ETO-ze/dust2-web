async page => {
  await page.reload();
  await page.getByRole('button',{name:'开始对战 ↗'}).click();
  await page.waitForFunction(()=>window.__dust2?.getStatus().connected,{},{timeout:90000});
  await page.getByRole('button',{name:'继续游戏 ↗'}).click();
  await page.waitForFunction(()=>!!document.pointerLockElement);
  await page.waitForTimeout(400);
  const before=await page.evaluate(()=>window.__dust2.getStatus().resources);
  await page.evaluate(()=>{window.qaContextExtension=document.getElementById('game-canvas').getContext('webgl2').getExtension('WEBGL_lose_context');if(!window.qaContextExtension)throw Error('Context-loss test unavailable');window.qaContextExtension.loseContext();});
  await page.waitForFunction(()=>window.__dust2.getStatus().contextLost&&!document.getElementById('graphics-recovery').hidden&&!document.pointerLockElement);
  await page.waitForTimeout(400);
  await page.evaluate(()=>window.qaContextExtension.restoreContext());
  await page.waitForFunction(()=>!window.__dust2.getStatus().contextLost&&document.getElementById('graphics-recovery').hidden,{},{timeout:20000});
  await page.getByRole('button',{name:'继续游戏 ↗'}).click();
  await page.waitForFunction(()=>!!document.pointerLockElement);
  await page.waitForTimeout(800);
  await page.screenshot({path:'output/playwright/graphics-restored.png'});
  const after=await page.evaluate(()=>({resources:window.__dust2.getStatus().resources,events:window.__dust2.getDiagnostics().events}));
  if(after.events.some(e=>/javascript-error|unhandled-rejection|graphics-recovery-failed/.test(e.type)))throw Error('Recovery produced script errors');
  if(after.resources.textures<400||after.resources.programs<10)throw Error('World did not render after recovery');
  return {before,after,lock:await page.evaluate(()=>!!document.pointerLockElement)};
}

async(page)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:960,height:540});
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 await page.addInitScript(()=>{
  globalThis.__DUST2_PORTABLE__={mode:'online',socketURL:'ws://127.0.0.1:33004/ws'};
  localStorage.setItem('dust2.touch.v1',JSON.stringify({mode:'on',size:.8,sensitivity:1}));
  localStorage.setItem('dust2.frame-limit.v1','60');
 });
 await page.reload();await page.waitForFunction(()=>!!window.__dust2);
 await page.getByRole('button',{name:'设置',exact:true}).click();
 return {errors,status:await page.evaluate(()=>window.__dust2.getStatus().mobileAim)};
}

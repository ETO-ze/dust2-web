async(page)=>{
 return await page.evaluate(async()=>{
  document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown',{pointerType:'touch',pointerId:71,bubbles:true}));
  const first=window.__dust2.getStatus().mobileAim;await new Promise(r=>setTimeout(r,100));
  const next=window.__dust2.getStatus().mobileAim;
  for(let i=0;i<=20;i++){window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:i*.2,gamma:0}));await new Promise(r=>setTimeout(r,10));}
  const last=window.__dust2.getStatus();return {first,next,last:last.mobileAim,player:last.player,hidden:document.hidden,menu:document.querySelector('#pause-menu').hidden};
 });
}

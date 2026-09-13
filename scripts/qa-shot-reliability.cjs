async page=>{
  await page.bringToFront();await page.setViewportSize({width:1366,height:768});
  await page.evaluate(()=>{
    window.__shotWire={sent:[],shots:[],hits:[]};const send=WebSocket.prototype.send;
    WebSocket.prototype.send=function(raw){
      if(!this.__shotObserved){this.__shotObserved=true;this.addEventListener('message',e=>{const m=JSON.parse(e.data);for(const event of m.events||[]){const id=window.__dust2.getStatus().myId;if(event.type==='shot'&&event.shooterId===id)window.__shotWire.shots.push(event);if(event.type==='hit'&&event.shooterId===id)window.__shotWire.hits.push(event);}});}
      const m=JSON.parse(raw);if(m.shotId)window.__shotWire.sent.push(m);return send.call(this,raw);
    };
  });
  await page.locator('#nickname').fill('Shot reliability QA');await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');await page.locator('#start-button').click();
  await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
  await page.request.post('http://127.0.0.1:3004/hold');await page.locator('.room-play').click();
  const ready=weapon=>page.waitForFunction(w=>{const p=window.__dust2.getStatus().player;return p?.weapon===w&&p.fireReadyRemaining===0&&p.reloadRemaining===0;},weapon);
  await page.request.post('http://127.0.0.1:3004/qa/aim-lane/awp');await ready('awp');
  await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(()=>window.__dust2.getStatus().player.ammo===4&&window.__dust2.getStatus().lastShot?.hitId);
  await page.keyboard.press('3');await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='knife');
  await page.keyboard.press('1');await page.mouse.down();
  await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon==='awp'&&window.__dust2.getStatus().player.ammo===3);
  await page.waitForTimeout(1700);await page.mouse.up();
  if(await page.evaluate(()=>window.__dust2.getStatus().player.ammo)!==3)throw Error('Held semi-auto fired more than once');
  await page.request.post('http://127.0.0.1:3004/qa/aim-lane/scar20');await ready('scar20');
  const before=await page.evaluate(()=>window.__shotWire.sent.length);
  await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.down();await page.waitForTimeout(1300);await page.mouse.up();
  await page.waitForFunction(()=>window.__dust2.getStatus().shooting.pending===0);
  const result=await page.evaluate(before=>{const s=window.__dust2.getStatus();return {ammo:s.player.ammo,commands:window.__shotWire.sent.length-before,ack:s.player.shotAck,shooting:s.shooting,hitId:s.lastShot?.hitId,ping:s.ping};},before);
  if(result.commands<4||result.ammo!==20-result.commands||result.shooting.lastRejected)throw Error(JSON.stringify(result));
  await page.evaluate(result=>window.__shotQAResult=result,result);
  await page.screenshot({path:'output/playwright/shot-reliability.png'});
}

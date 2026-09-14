async page=>{
  await page.bringToFront();await page.setViewportSize({width:1366,height:768});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.locator('#nickname').fill('Round update QA');await page.locator('#mode').selectOption('deathmatch');await page.locator('#bots').selectOption('3');await page.locator('#start-button').click();
  await page.waitForFunction(()=>window.__dust2.getStatus().connected,null,{timeout:180000});
  await page.request.post('http://127.0.0.1:3004/hold');await page.locator('.room-play').click();
  const ready=w=>page.waitForFunction(w=>{const p=window.__dust2.getStatus().player;return p?.weapon===w&&p.fireReadyRemaining===0&&p.reloadRemaining===0;},w);
  const before=await(await page.request.post('http://127.0.0.1:3004/qa/round-update/ended')).json();await ready('awp');
  await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.down();await page.mouse.up();
  await page.waitForFunction(()=>window.__dust2.getStatus().player.ammo===4&&window.__dust2.getStatus().player.headshots===1);
  const ended=await page.evaluate(()=>{const s=window.__dust2.getStatus();return {phase:s.round.phase,ammo:s.player.ammo,headshots:s.player.headshots,title:document.querySelector('#kill-title').textContent,comboExists:!!document.querySelector('#kill-combo')};});
  if(ended.phase!=='ended'||!ended.title.includes('爆头')||!ended.comboExists)throw Error(JSON.stringify(ended));
  await page.screenshot({path:'output/playwright/round-headshot.png'});
  await page.keyboard.press('g');await page.waitForFunction(()=>window.__dust2.getStatus().player.weapon!=='awp');
  await page.waitForTimeout(900);await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');await page.keyboard.press('e');
  await page.waitForFunction(()=>window.__dust2.getStatus().player.inventory.includes('awp'));
  const pickup=await page.evaluate(()=>({phase:window.__dust2.getStatus().round.phase,inventory:window.__dust2.getStatus().player.inventory}));
  const assists=[];
  for(const kind of ['damage-assist','flash-assist']){
    await page.request.post('http://127.0.0.1:3004/qa/round-update/'+kind);
    await page.waitForFunction(kind=>document.querySelector('#kill-title').textContent===(kind==='damage-assist'?'伤害助攻':'闪光助攻'),kind);
    assists.push(await page.evaluate(()=>({assists:window.__dust2.getStatus().player.assists,title:document.querySelector('#kill-title').textContent,text:document.querySelector('#kill-weapon').textContent})));
    await page.screenshot({path:'output/playwright/round-'+kind+'.png'});
  }
  await page.keyboard.down('Tab');await page.screenshot({path:'output/playwright/round-scoreboard.png'});await page.keyboard.up('Tab');
  const utility=[];
  for(const weapon of ['hegrenade','flashbang','smokegrenade','molotov','incgrenade','decoy']){
    await page.request.post('http://127.0.0.1:3004/qa/utility/'+weapon);await ready(weapon);await page.waitForTimeout(800);
    await page.mouse.down();await page.waitForTimeout(350);await page.mouse.up();
    await page.waitForFunction(w=>window.__dust2.getStatus().audio.lastUtility?.weapon===w&&window.__dust2.getStatus().audio.lastUtility?.event!=='grenade_primed',weapon);
    await page.waitForTimeout(2300);
    utility.push(await page.evaluate(()=>window.__dust2.getStatus().audio.lastUtility));
  }
  await page.evaluate(result=>window.__roundUpdateQA=result,{ended,pickup,assists,utility,failures,before});
  if(failures.length)throw Error(failures.join('\n'));
}

async(page)=>{
 const status=()=>page.evaluate(()=>window.__dust2.getStatus());
 async function lock(){if(await page.evaluate(()=>!!document.pointerLockElement))return;await page.waitForTimeout(700);if(await page.locator('#resume-button').isVisible())await page.locator('#resume-button').click();await page.waitForFunction(()=>!!document.pointerLockElement);}
 await page.keyboard.press('Escape');await page.locator('#host-bots').selectOption('6');await page.locator('#host-bots-apply').click();await page.waitForFunction(()=>window.__dust2.getStatus().desiredBots===6);await lock();
 await page.request.post('http://127.0.0.1:3004/defuse');await page.request.post('http://127.0.0.1:3004/kill');await page.waitForTimeout(1750);
 const death=await status();if(death.player.alive||!death.spectatingId||!death.viewModel.visible)throw Error('Spectator weapon missing');if(await page.locator('#pause-menu').isVisible())throw Error('Death opened menu');await page.screenshot({path:'output/playwright/gameplay-death-spectator.png'});
 const before=(await status()).player;
 await page.request.post('http://127.0.0.1:3004/qa/halftime');await page.waitForFunction(team=>window.__dust2.getStatus().player.team!==team,before.team);await page.waitForTimeout(650);
 const half=await status();if(half.player.teamId!==before.teamId||half.player.agentId===before.agentId)throw Error('Halftime did not preserve team identity and change agent');if(!await page.locator('.side-swap-panel').isVisible())throw Error('No halftime animation');await page.screenshot({path:'output/playwright/gameplay-halftime.png'});
 await page.waitForTimeout(4400);await page.request.post('http://127.0.0.1:3004/qa/overtime');await page.waitForTimeout(650);const overtime=await status();if(overtime.match.period!=='overtime'||overtime.player.team===half.player.team)throw Error('MR3 switch failed');await page.screenshot({path:'output/playwright/gameplay-overtime.png'});
 await page.request.post('http://127.0.0.1:3004/qa/victory');await page.waitForFunction(()=>window.__dust2.getStatus().match.status==='ended');await page.waitForTimeout(800);
 const victory={heading:await page.locator('.match-result-heading h1').textContent(),lock:await page.evaluate(()=>!!document.pointerLockElement),pause:await page.locator('#pause-menu').isVisible()};
 if(victory.heading!=='胜利'||victory.lock||victory.pause)throw Error('Victory interaction '+JSON.stringify(victory));await page.screenshot({path:'output/playwright/gameplay-victory.png'});
 await page.keyboard.press('b');await page.keyboard.press('Escape');if(await page.locator('#pause-menu').isVisible()||await page.locator('#buy-menu').isVisible())throw Error('Terminal keys opened an in-game panel');
 await page.request.post('http://127.0.0.1:3004/qa/defeat');await page.waitForFunction(()=>document.querySelector('.match-result-heading h1').textContent==='失败');await page.waitForTimeout(400);await page.screenshot({path:'output/playwright/gameplay-defeat.png'});
 await page.locator('#match-return-button').click();if(!await page.locator('#menu').isVisible())throw Error('Return to lobby failed');
 const result={death:{spectatingId:death.spectatingId,viewModel:death.viewModel},halftime:{team:half.player.team,teamId:half.player.teamId,agent:half.player.agentId,match:half.match},overtime:{team:overtime.player.team,match:overtime.match},victory,defeat:true,returnToLobby:true};await page.evaluate(r=>window.matchQA=r,result);return result;
}

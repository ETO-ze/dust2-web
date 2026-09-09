async(page)=>{
 await page.waitForFunction(()=>window.__dust2?.getStatus().connected);
 if(await page.locator('#resume-button').isVisible())await page.locator('#resume-button').click();
 await page.waitForFunction(()=>!!document.pointerLockElement);
 await page.evaluate(()=>{window.movementQAHoldAim||=(e=>e.stopImmediatePropagation());window.addEventListener('mousemove',window.movementQAHoldAim,true);});
 const setup=async kind=>{const response=await page.request.post('http://127.0.0.1:3004/qa/movement/'+kind);if(!response.ok())throw Error(await response.text());const [fixture]=await response.json();await page.waitForFunction(id=>window.__dust2.getStatus().player.lifeId===id,fixture.lifeId);await page.waitForTimeout(1100);return fixture;};
 const sample=ms=>page.evaluate(duration=>new Promise(resolve=>{const rows=[],start=performance.now();function frame(now){const s=window.__dust2.getStatus();rows.push({t:now-start,x:s.player.x,y:s.player.y,z:s.player.z,grounded:s.player.grounded,crouch:s.player.crouch,vy:s.player.vy,camera:s.cameraPosition,movement:s.movement,ping:s.ping});if(now-start<duration)requestAnimationFrame(frame);else resolve(rows);}requestAnimationFrame(frame);}),ms);
 const summary=rows=>({samples:rows.length,yRange:Math.max(...rows.map(r=>r.y))-Math.min(...rows.map(r=>r.y)),cameraYRange:Math.max(...rows.map(r=>r.camera.y))-Math.min(...rows.map(r=>r.camera.y)),pendingMax:Math.max(...rows.map(r=>r.movement.pending)),maxCorrection:Math.max(...rows.map(r=>r.movement.maxCorrection)),ping:rows.at(-1).ping,first:rows[0],last:rows.at(-1)});
 const result={};
 await setup('flat');await page.keyboard.down('w');const walking=await sample(1200);await page.keyboard.up('w');
 const backwards=walking.slice(1).filter((r,i)=>r.camera.z-walking[i].camera.z>.002).length;
 if(backwards)throw Error('Camera pulled backwards '+backwards+' times');if(walking[0].z-walking.at(-1).z<3)throw Error('Walk did not move');
 result.walk={...summary(walking),backwards};
 const ledge=await setup('ledge'),standing=await sample(2000);
 if(standing.some(r=>!r.grounded)||summary(standing).cameraYRange>.005)throw Error('Unstable ledge '+JSON.stringify(summary(standing)));
 await page.keyboard.down('Space');await page.waitForTimeout(35);await page.keyboard.up('Space');const jump=await sample(1200);
 if(Math.max(...jump.map(r=>r.y))-ledge.ledgeHeight<1.35||!jump.at(-1).grounded)throw Error('Ledge jump did not take off and land');
 result.ledge=summary(standing);result.ledgeJump=summary(jump);
 const lower=await setup('jump');await page.keyboard.down('Shift');await page.keyboard.down('w');await page.keyboard.down('Space');await page.waitForTimeout(35);await page.keyboard.up('Space');await page.waitForTimeout(265);await page.keyboard.up('w');const landing=await sample(1800);await page.keyboard.up('Shift');
 if(!landing.at(-1).grounded||Math.abs(landing.at(-1).y-lower.ledgeHeight)>.02)throw Error('Box landing failed '+JSON.stringify(summary(landing)));
 result.boxLanding=summary(landing);await page.screenshot({path:'output/playwright/movement-box-landing.png'});
 await setup('sky');await page.waitForTimeout(500);await page.screenshot({path:'output/playwright/movement-daylight-sky.png'});
 result.final=await page.evaluate(()=>{const s=window.__dust2.getStatus();return {sky:s.sky,resources:s.resources,errors:window.__dust2.getDiagnostics().events.filter(e=>/error|reject|lost/.test(e.type))};});
 if(result.final.errors.length)throw Error(JSON.stringify(result.final.errors));await page.evaluate(r=>window.movementQA=r,result);return result;
}

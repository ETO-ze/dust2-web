async(page)=>{
 const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 await page.evaluate(()=>{window.renderProfileFrames=[];let previous=performance.now();window.renderProfileActive=true;const frame=now=>{if(!window.renderProfileActive)return;window.renderProfileFrames.push(now-previous);previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);});
 await cdp.send('Profiler.start');await page.waitForTimeout(12000);const {profile}=await cdp.send('Profiler.stop');await cdp.detach();
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),weight=new Map();for(let i=0;i<(profile.samples||[]).length;i++){const id=profile.samples[i];weight.set(id,(weight.get(id)||0)+(profile.timeDeltas?.[i]||1000));}
 const total=[...weight.values()].reduce((a,b)=>a+b,0),hot=[...weight].map(([id,micros])=>({name:nodes.get(id).callFrame.functionName,url:nodes.get(id).callFrame.url,line:nodes.get(id).callFrame.lineNumber+1,percent:Math.round(micros/total*1000)/10})).sort((a,b)=>b.percent-a.percent).slice(0,16);
 return await page.evaluate(hot=>{window.renderProfileActive=false;const f=window.renderProfileFrames.sort((a,b)=>a-b),s=window.__dust2.getStatus();const result={samples:f.length,frameMs:{p50:f[Math.floor(f.length*.5)],p95:f[Math.floor(f.length*.95)],max:f.at(-1)},resources:s.resources,drawCalls:s.drawCalls,triangles:s.triangles,hot};window.lastRenderProfile=result;return result;},hot);
}

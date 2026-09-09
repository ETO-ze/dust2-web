async (page)=>{
 const samples=await page.evaluate(()=>window.stabilitySamples||[]);
 const status=await page.evaluate(()=>window.__dust2.getStatus());
 await page.request.post('http://127.0.0.1:3004/stop-soak');await page.request.post('http://127.0.0.1:3004/hold');
 return {sampleCount:samples.length,seconds:samples.length?(samples.at(-1).at-samples[0].at)/1000:0,first:samples[0],last:samples.at(-1),maxTextures:Math.max(...samples.map(s=>s.textures)),status:status.resources};
}

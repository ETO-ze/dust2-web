async(page)=>{
 await page.waitForFunction(()=>window.__dust2?.getStatus().viewModel.id==='awp'&&window.__dust2.getStatus().viewModel.visible);
 await page.waitForTimeout(800);
 await page.screenshot({path:'output/playwright/equipment-awp-final.png'});
 return {weapon:await page.evaluate(()=>window.__dust2.getStatus().viewModel)};
}

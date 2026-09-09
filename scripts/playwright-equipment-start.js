async (page) => {
  await page.goto('http://127.0.0.1:3003/');
  await page.setViewportSize({width:1600,height:950});
  await page.locator('#menu-settings').click();
  await page.locator('[data-tab="video"]').click();
  const defaults=await page.locator('#cs-quality').inputValue();if(defaults!=='low')throw Error('Default quality not low');
  await page.locator('#cs-brightness').fill('125');await page.locator('#cs-brightness').dispatchEvent('input');
  if((await page.evaluate(()=>window.__dust2.getStatus().settings.brightness))!==125)throw Error('Brightness not applied');
  await page.screenshot({path:'output/playwright/equipment-settings.png'});
  await page.locator('#reset-video').click();await page.locator('#close-settings').click();
  await page.locator('[data-team="CT"]').click();
  await page.locator('#nickname').fill('Equipment QA');
  await page.locator('#start-button').click();
  return {defaults,loading:true};
}

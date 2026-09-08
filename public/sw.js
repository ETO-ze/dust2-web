/* Only this /dust2/ installation is controlled. No API response is cached. */
const SCOPE=new URL(self.registration.scope);
const SHELL=`dust2-shell-v1:${SCOPE.pathname}`;
const ASSETS=`dust2-assets-v1:${SCOPE.pathname}`,META=`dust2-meta-v1:${SCOPE.pathname}`;
const HOME=new URL('./',SCOPE).href,MANIFEST=new URL('assets/asset-manifest.json',SCOPE).href;
const local=url=>url.origin===SCOPE.origin&&url.pathname.startsWith(SCOPE.pathname);
const hashKey=hash=>new URL(`__asset_cache__/sha256/${hash}`,SCOPE).href;
const indexKey=url=>new URL(`__asset_cache__/url/${encodeURIComponent(url.href)}`,SCOPE).href;

function dependencies(text,url,type){
  const found=new Set();let match;
  const patterns=type==='html'?[/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi]:type==='css'?[/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi,/\@import\s+["']([^"']+)["']/gi]:[/\b(?:import|export)\s*(?:[^;\n]*?\bfrom\s*)?["']([^"']+)["']/gi,/\bimport\(\s*["']([^"']+)["']\s*\)/gi];
  for(const re of patterns)while((match=re.exec(text))){
    try{const child=new URL(match[1],url);if(local(child)&&/\.(?:js|mjs|css|png|webp|jpg|jpeg|svg|ico|woff2?|webmanifest)(?:$|\?)/i.test(child.pathname+child.search))found.add(child.href);}catch{}
  }
  return found;
}

async function cacheShellResponse(homeResponse){
  if(!homeResponse.ok)throw new Error('大厅加载失败');
  const cache=await caches.open(SHELL),html=await homeResponse.clone().text();
  const queue=[...dependencies(html,HOME,'html'),new URL('manifest.webmanifest',SCOPE).href],seen=new Set();
  // Cache the referenced CSS/JS graph before replacing the working HTML. An
  // interrupted update therefore leaves the previous offline lobby usable.
  while(queue.length){
    const url=queue.shift();if(seen.has(url))continue;seen.add(url);
    const response=await fetch(url,{cache:'reload'});if(!response.ok)throw new Error(`大厅资源不可用: ${url}`);
    const ext=new URL(url).pathname;
    if(/\.(?:m?js|css)$/.test(ext))for(const dep of dependencies(await response.clone().text(),url,ext.endsWith('.css')?'css':'js'))if(!seen.has(dep))queue.push(dep);
    if(ext.endsWith('.webmanifest')){const manifest=await response.clone().json();for(const icon of manifest.icons||[]){const u=new URL(icon.src,url);if(local(u))queue.push(u.href);}}
    await cache.put(url,response);
  }
  await cache.put(HOME,homeResponse);
}
async function cacheShell(){await cacheShellResponse(await fetch(HOME,{cache:'reload'}));}

self.addEventListener('install',event=>{event.waitUntil(cacheShell().then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('message',event=>{
  if(event.data?.type==='CACHE_SHELL')event.waitUntil(cacheShell().then(()=>event.ports[0]?.postMessage({ok:true}),error=>event.ports[0]?.postMessage({ok:false,error:error.message})));
});

async function cachedAsset(url){
  const meta=await caches.open(META),assets=await caches.open(ASSETS);
  // The manifest identifies the desired immutable content, independent of
  // cache age. Old SHA versions remain available for interrupted updates.
  const manifestResponse=await meta.match(MANIFEST);
  if(manifestResponse){
    const manifest=await manifestResponse.json();
    const file=(manifest.files||[]).find(f=>new URL(f.path,SCOPE).pathname===url.pathname);
    const version=url.searchParams.get('v');
    if(file&&(!version||file.sha256.startsWith(version))){const response=await assets.match(hashKey(file.sha256.toLowerCase()));if(response)return response;}
  }
  const indexed=await meta.match(indexKey(url));
  if(indexed){const entry=await indexed.json();return assets.match(hashKey(entry.sha256));}
  return undefined;
}

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||!local(url))return;
  const relative=url.pathname.slice(SCOPE.pathname.length);
  if(/^(?:api(?:\/|$)|ws(?:\/|$)|health(?:\/|$)|__asset_cache__\/)/.test(relative))return;
  // The page refreshes this small manifest and falls back to its metadata
  // copy itself. Serving an old asset index here would hide new releases.
  if(url.pathname===new URL(MANIFEST).pathname)return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{const response=await fetch(request);if(!response.ok)throw new Error('大厅暂时不可用');event.waitUntil(cacheShellResponse(response.clone()).catch(()=>{}));return response;}
      catch{const cache=await caches.open(SHELL);return await cache.match(HOME)||new Response('<!doctype html><meta charset="utf-8"><title>Dust II</title><h1>尚未保存离线大厅</h1><p>请联网打开一次；多人对战需要网络。</p>',{status:503,headers:{'content-type':'text/html; charset=utf-8'}});}
    })());return;
  }
  // The page owns integrity verification and writes large assets once. The
  // worker serves those bytes offline without creating a second map cache.
  if(relative.startsWith('assets/')&&!/\.(?:m?js|css)$/.test(url.pathname)){
    event.respondWith((async()=>await cachedAsset(url)||await (await caches.open(SHELL)).match(request)||fetch(request))());return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(SHELL),hit=await cache.match(request);
    if(hit)return hit;
    const response=await fetch(request);
    if(response.ok&&/\.(?:m?js|css|png|svg|ico|woff2?|webmanifest)$/.test(url.pathname))event.waitUntil(cache.put(request,response.clone()));
    return response;
  })());
});

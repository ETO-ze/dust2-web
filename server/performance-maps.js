/** Loopback nine-map gateway. Start and retire game workers on demand. */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PERFORMANCE_MAPS, isPerformanceMap} from '../shared/performance-map-pool.js';
import {findQualityPacks} from './performance-quality.js';
import {SKINS} from '../shared/skins.js';
import {packagedSkinAssets} from '../shared/packaged-skin-assets.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root=path.resolve(process.env.PERF_MAP_ROOT || path.join(repo,'artifacts/performance-maps/maps-v1'));
const dist=path.resolve(process.env.PERF_GAME_DIST || path.join(repo,'artifacts/performance-maps/client-dist'));
const publicDir=path.resolve(process.env.PERF_PUBLIC_DIR || path.join(repo,'public'));
const port=Number(process.env.PORT || (process.platform === 'win32' ? 33440 : 3240));
const catalogPath=path.join(root,'catalog.json');
const maps=new Set(JSON.parse(fs.readFileSync(catalogPath)).maps.filter(m=>isPerformanceMap(m.id)).map(m=>m.id));
const reviewAssets=path.join(repo,'scripts/maps');
const qualityPacks=findQualityPacks(root,maps,
  path.resolve(process.env.PERF_QUALITY_MAP_LIBRARY || path.join(root,'..','quality-library')),
  path.resolve(process.env.PERF_QUALITY_TRANSPORT || path.join(root,'..','quality-transport')));
const workers=new Map();
const idleMs=120000, maxWorkers=2;
const heavy=new Set(['de_inferno','de_cache','de_ancient','de_train']);
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.json':'application/json','.gltf':'model/gltf+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.avif':'image/avif','.webp':'image/webp','.svg':'image/svg+xml','.hdr':'application/octet-stream','.ogg':'audio/ogg','.mp3':'audio/mpeg','.woff2':'font/woff2','.ttf':'font/ttf'};
const json=(res,code,data)=>res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));
function file(req,res,location,immutable=false){
  if(!fs.existsSync(location)||!fs.statSync(location).isFile()){res.writeHead(404).end();return;}
  const useGzip=/\bgzip\b/.test(req.headers['accept-encoding']||'')&&fs.existsSync(location+'.gz');
  const physical=useGzip?location+'.gz':location;
  const headers={'Content-Type':types[path.extname(location)]||'application/octet-stream','Content-Length':fs.statSync(physical).size,
    'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache','Vary':'Accept-Encoding'};
  if(useGzip)headers['Content-Encoding']='gzip';
  res.writeHead(200,headers);
  if(req.method==='HEAD'){res.end();return;}
  const stream=fs.createReadStream(physical);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
function retire(worker){
  if(worker.connections || worker.retiring)return;
  worker.retiring=true;worker.child.kill();
}
async function ensureWorker(id){
  const existing=workers.get(id);
  if(existing&&!existing.retiring){existing.touched=Date.now();return existing.ready;}
  if(existing)throw Error('地图服务正在释放，请稍后重试');
  // High-memory maps get an exclusive slot on the small server. Active players always keep their worker.
  const occupied=[...workers.values()];
  const fits=()=>workers.size<maxWorkers && !(workers.size&&(heavy.has(id)||[...workers.keys()].some(k=>heavy.has(k))));
  if(!fits()){
    for(const w of occupied.sort((a,b)=>a.touched-b.touched)){
      if(w.connections||!w.port||Date.now()-w.touched<15000)continue;
      retire(w);await w.exited;
      if(fits())break;
    }
    if(!fits())throw Error('当前地图服务已满，请稍后再进入');
  }
  // A simultaneous request may have started the same worker while awaiting an eviction.
  if(workers.has(id))return workers.get(id).ready;
  const child=spawn(process.execPath,['server/private-map-server.js'],{cwd:repo,windowsHide:true,
    env:{...process.env,PORT:'0',HOST:'127.0.0.1',DUSTII_GRID_VISION:'1',DUSTII_PRIVATE_MAP_ID:id,
      DUSTII_PRIVATE_MAP_DIRECTORY:path.join(root,id),DUSTII_PRIVATE_LIBRARY_URL:'/perf'},
    stdio:['ignore','pipe','inherit']});
  const w={child,port:0,connections:0,touched:Date.now(),retiring:false};
  w.exited=new Promise(resolve=>child.once('close',()=>{if(workers.get(id)===w)workers.delete(id);resolve();}));
  w.ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{reject(Error('地图启动超时'));child.kill();},75000);
    let log='';
    const failed=()=>{clearTimeout(timer);reject(Error('地图服务启动失败'));};
    child.once('error',failed);child.once('exit',failed);
    child.stdout.on('data',part=>{log=(log+part).slice(-8192);
      for(const line of log.split('\n')){try{const r=JSON.parse(line);if(r.service==='dust2-private-game'&&r.mapId===id&&r.port>0&&r.port<65536){
        clearTimeout(timer);child.removeListener('exit',failed);w.port=r.port;resolve(w);return;
      }}catch{}}
    });
  });
  workers.set(id,w);return w.ready;
}
const reap=setInterval(()=>{for(const w of workers.values())if(w.port&&!w.connections&&Date.now()-w.touched>idleMs)retire(w);},15000);
reap.unref();
// Locally packaged skin revisions can precede publication to the shared CDN.
const localSkinPaths=packagedSkinAssets(SKINS).filter(asset=>{
  const file=[dist,publicDir].map(base=>path.join(base,asset.path)).find(name=>fs.existsSync(name));
  if(!file)return false;
  const stat=fs.statSync(file);
  return stat.isFile() && stat.size===asset.bytes;
}).map(asset=>asset.path);
function mapConfig(id,w,quality){
  return fetch('http://127.0.0.1:'+w.port+'/private-map.json').then(r=>r.json()).then(config=>{
    const remap=path.join(root,id,'flat-breakables.json');
    const hashes=JSON.parse(fs.readFileSync(path.join(root,id,'READY.json'))).gameplayHashes || {};
    const urls={};
    for(const key of ['metadataUrl','navUrl','physicsUrl','maskUrl','groupsUrl','policyUrl']){
      const name=path.posix.basename(config[key]), digest=hashes[name];
      if(digest)urls[key]=(quality?'/perf/quality/maps/':'/perf/maps/')+id+'/'+name+'?v='+digest;
    }
    if(quality)return {...config,...urls,flatOnly:false,graphicsMode:'quality',renderUrl:'/perf/quality/maps/'+id+'/render/map.gltf',localSkinPaths};
    return {...config,...urls,flatOnly:true,localSkinPaths,...(fs.existsSync(remap)?{flatBreakableVisuals:JSON.parse(fs.readFileSync(remap))}:{})};
  });
}
function safePath(base,tail){
  if(tail.split('/').some(s=>!s||s==='.'||s==='..')||/[\\%:\x00-\x1f]/.test(tail))return null;
  const result=path.resolve(base,tail);
  return result.startsWith(base+path.sep)?result:null;
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const requestPath=req.url.split('?')[0];
  if(/^\/perf\/(?:ui|mode-previews)\//.test(requestPath) && /(?:^|\/)\.{1,2}(?:\/|$)|[%\\]/.test(requestPath)){
    res.writeHead(404).end();return;
  }
  const url=new URL(req.url,'http://localhost');
  let p=url.pathname;
  if(p==='/perf'||p==='/'){res.writeHead(302,{Location:'/perf/'}).end();return;}
  if(p==='/perf/'){file(req,res,path.join(reviewAssets,'mode-ui/index.html'));return;}
  if(p==='/perf/graphics.json'){
    json(res,200,{maps:PERFORMANCE_MAPS.filter(({id})=>maps.has(id)).map(({id})=>({
      id,performanceURL:'/perf/play/'+id+'/',qualityURL:qualityPacks.has(id)?'/perf/quality/play/'+id+'/':null,
      qualitySource:qualityPacks.has(id)?'local':null
    }))});return;
  }
  const review=/^\/perf\/(ui|mode-previews)\/(.+)$/.exec(p);
  if(review){
    const [,kind,name]=review;
    const allowed=kind==='ui'?/\.(?:css|js|mjs|woff2|ttf|svg|png|webp|jpe?g|avif)$/i:/\.(?:webp|png|jpe?g|avif)$/i;
    const directory=path.join(reviewAssets,kind==='ui'?'mode-ui':'mode-previews');
    const isPreviewManifest=kind==='mode-previews'&&name==='previews.json';
    const location=allowed.test(name)||isPreviewManifest?safePath(directory,name):null;
    if(!location||!fs.existsSync(location)||!fs.realpathSync(location).startsWith(fs.realpathSync(directory)+path.sep)){res.writeHead(404).end();return;}
    res.setHeader('X-Content-Type-Options','nosniff');
    file(req,res,location);return;
  }
  const quality=p.startsWith('/perf/quality/');
  if(quality){
    p='/perf/'+p.slice('/perf/quality/'.length);
    const asset=/^\/perf\/maps\/(de_[a-z0-9]+)\/(.+)$/.exec(p);
    if(asset){
      const [,id,tail]=asset,pack=qualityPacks.get(id);
      if(!pack){res.writeHead(404).end();return;}
      if(tail==='render-manifest.json'){json(res,200,pack.manifest);return;}
      if(tail==='transport-manifest.json' && pack.transport){json(res,200,pack.transport.manifest);return;}
      if(tail.startsWith('render/')){
        let name;try{name=decodeURIComponent(tail.slice(7));}catch{res.writeHead(404).end();return;}
        const entry=pack.files.get(name),version=url.searchParams.get('v');
        if(!entry || (version!==null && version!==entry.sha256)){res.writeHead(404).end();return;}
        file(req,res,path.join(pack.raw,name),version!==null);return;
      }
      if(tail.startsWith('transport/')){
        const location=pack.transport?.objects.get(tail.slice(10));
        if(!location || url.search){res.writeHead(404).end();return;}
        file(req,res,location,true);return;
      }
    } else if(!/^\/perf\/(?:play\/de_[a-z0-9]+\/|(?:radars|previews)\/|download-config\.json$)/.test(p)){
      res.writeHead(404).end();return;
    }
  }
  if(p==='/perf/catalog.json'){file(req,res,catalogPath);return;}
  if(p==='/perf/health'){json(res,200,{ok:true,maps:maps.size,workers:[...workers].map(([id,w])=>({id,active:w.connections>0}))});return;}
  if(/^\/perf\/download-config(?:-1\.3\.0)?\.json$/.test(p)){
    json(res,200,{schemaVersion:1,assetBaseURL:process.env.PERF_ASSET_BASE_URL||null,mapBaseURL:null,fallbackToGameServer:false});return;
  }
  const asset=/^\/perf\/(assets|icons)\/(.+)$/.exec(p);
  if(asset){
    const tail=asset[1]+'/'+decodeURIComponent(asset[2]);
    for(const base of [dist,publicDir]){const location=safePath(base,tail);if(location&&fs.existsSync(location)){file(req,res,location);return;}}
  }
  const radar=/^\/perf\/(radars|previews)\/(transforms\.json|de_[a-z0-9]+\.png)$/.exec(p);
  if(radar&&(radar[2]==='transforms.json'||maps.has(radar[2].slice(0,-4)))){
    file(req,res,path.join(root,'radars',radar[2]));return;
  }
  const play=/^\/perf\/play\/(de_[a-z0-9]+)\/(|private-map\.json|health)$/.exec(p);
  if(play&&maps.has(play[1])&&(!quality||qualityPacks.has(play[1]))){
    if(!play[2]){let html=fs.readFileSync(path.join(dist,'private.html'),'utf8').replace('<!-- MAP_LIBRARY_BASE -->','<base href="/perf/">');
      if(!html.includes('<base href="/perf/">'))html=html.replace('<head>','<head><base href="/perf/">');
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}).end(req.method==='HEAD'?undefined:html);return;}
    const w=await ensureWorker(play[1]);
    json(res,200,play[2]==='private-map.json'?await mapConfig(play[1],w,quality):await fetch('http://127.0.0.1:'+w.port+'/health').then(r=>r.json()));return;
  }
  const resource=/^\/perf\/(?:play\/(de_[a-z0-9]+)\/)?maps\/(de_[a-z0-9]+)\/(map\.json|nav\.json|physics\.f32|physics-mask\.u8|physics-groups\.json|entity-collision-policy\.json|render-manifest\.json|render\/map\.(?:bin|gltf))$/.exec(p);
  if(resource&&maps.has(resource[2])&&(!resource[1]||resource[1]===resource[2])){
    const [,,id,name]=resource,dir=path.join(root,id);
    const inCompiled=['map.json','nav.json','physics.f32','physics-mask.u8','physics-groups.json'].includes(name);
    let immutable=false;
    if(url.searchParams.has('v')){
      const digest=name.startsWith('render/')
        ? JSON.parse(fs.readFileSync(path.join(dir,'render-manifest.json'))).files.find(x=>x.path===name.slice(7))?.sha256
        : JSON.parse(fs.readFileSync(path.join(dir,'READY.json'))).gameplayHashes?.[name];
      if(!digest || digest!==url.searchParams.get('v')){res.writeHead(404).end();return;}
      immutable=true;
    }
    file(req,res,path.join(dir,inCompiled?'compiled':'',name),immutable);return;
  }
  res.writeHead(404).end();
 }catch(error){if(!res.headersSent)json(res,503,{error:error.message});else res.destroy();}
});
server.on('upgrade',async(req,socket,head)=>{
  const match=/^\/perf\/(?:quality\/)?play\/(de_[a-z0-9]+)\/ws$/.exec(req.url);
  if(!match||!maps.has(match[1])||(req.url.startsWith('/perf/quality/')&&!qualityPacks.has(match[1]))){socket.destroy();return;}
  try{
    const w=await ensureWorker(match[1]);if(socket.destroyed)return;
    w.connections++;w.touched=Date.now();const upstream=net.connect(w.port,'127.0.0.1');
    socket.once('close',()=>{w.connections--;w.touched=Date.now();upstream.destroy();});
    upstream.on('error',()=>socket.destroy());upstream.on('close',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
    upstream.once('connect',()=>{
      const headers=['GET /ws HTTP/1.1'];
      for(let i=0;i<req.rawHeaders.length;i+=2)headers.push(req.rawHeaders[i]+': '+req.rawHeaders[i+1]);
      upstream.write(headers.join('\r\n')+'\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
    });
  }catch{socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');}
});
server.listen(port,'127.0.0.1',()=>console.log('Performance map pool: http://127.0.0.1:'+server.address().port+'/perf/'));
function shutdown(){clearInterval(reap);for(const w of workers.values())w.child.kill();server.close();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,shutdown);
if(process.send)process.once('disconnect',shutdown);

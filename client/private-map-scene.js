import * as THREE from 'three';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {privateRenderManifest,privateRenderDependencies,deduplicatePrivateImages,readPrivateResource,PrivateMapProgress,privateGLTFLoader} from './private-map-loader.js';
import {PrivateMapTransport} from './private-map-transport.js';
import {useDownloadedAssets} from './loading.js';
import {MAP} from '../shared/map-data.js';
import {decodePrivateMapCollision} from '../shared/private-map-collision.js';
import {privateMapMemoryReason} from './private-game-config.js';
import {PrivateMapBreakables} from './private-map-breakables.js';
import {PrivateMapBreakables as BreakableCollisionState} from '../shared/private-map-breakables.js';
import {PRIVATE_BREAKABLES} from '../shared/private-map-breakables-data.js';
import {privateMapFetcher} from './private-map-download.js';

function disposeScene(group){
 const textures=new Set(),materials=new Set(),geometries=new Set();
 group?.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[])){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});
 textures.forEach(t=>{t.dispose();t.image?.close?.();});materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
}

/** The private route keeps original scene geometry/UVs/textures and uses the
 * exact same hash-bound player, bullet and grenade channels as its server. */
export async function createPrivateMapScene(scene,{onProgress=()=>{},signal}={}){
 const config=globalThis.__DUST2_PRIVATE_MAP__;if(!config||!MAP.private)throw Error('私有地图尚未初始化');
 const fetcher=privateMapFetcher(config);
 const manager=new THREE.LoadingManager();useDownloadedAssets(manager);
 const parentSignal=signal,controller=new AbortController();signal=controller.signal;
 const abort=()=>{controller.abort(parentSignal.reason);manager.abort();};parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)abort();
 const check=()=>signal?.throwIfAborted();
 let transport=null;
 const progress=new PrivateMapProgress((label,state)=>onProgress(label,{...state,cacheBytes:transport?.stats.cacheBytes||0}));
 let loadedRoot=null,sky=null,breakables=null,loader=null,committed=false,firstFailure=null;
 const stopFailedJob=error=>{firstFailure||=error;controller.abort(firstFailure);manager.abort();return firstFailure;};
 const failTogether=promise=>promise.catch(error=>{throw stopFailedJob(error);});
 try{
  check();
  if(config.mapDownloadBaseURL&&typeof DecompressionStream!=='function')throw Error('当前浏览器不支持地图分块解压，请升级 Chrome 或 Edge；安卓请更新 Android System WebView 后重试');
  onProgress('读取 '+MAP.name+' 原图资源清单…',{phase:'map-manifest'});
  const manifestBytes=await readPrivateResource(new URL('../render-manifest.json',config.renderUrl),{signal,maxBytes:4*1024*1024,cache:'no-store',fetcher});
  const files=privateRenderManifest(JSON.parse(new TextDecoder().decode(manifestBytes)),config),root=new URL('.',config.renderUrl);
  if(typeof DecompressionStream==='function'){
   const transportURL=new URL('../transport-manifest.json',config.renderUrl);
   const bytes=await readPrivateResource(transportURL,{signal,maxBytes:4*1024*1024,cache:'no-store',fetcher}).catch(error=>{if(!config.mapDownloadBaseURL&&error.message==='原图下载失败 (404)')return null;throw error;});
   if(bytes){transport=new PrivateMapTransport(JSON.parse(new TextDecoder().decode(bytes)),{identity:{...config,originalRenderGltfSha256:files.get('map.gltf').sha256},baseURL:new URL('../transport/',config.renderUrl),signal,fetcher});for(const [path,entry]of transport.files){if(path.startsWith('raw/')){const original=files.get(path.slice(4));if(!original)throw Error('加速资源未列入原图清单');transport.file(path,original);}const expected={'compiled/physics.f32':config.physicsSha256,'compiled/physics-mask.u8':config.maskSha256,'entity-collision-policy.json':config.policySha256}[path];if(expected&&entry.sha256!==expected)throw Error('地图加速碰撞版本不一致');}}
  }
  const gltfFile=files.get('map.gltf');progress.plan('map.gltf',transport?.bytes('raw/map.gltf',gltfFile.bytes)||gltfFile.bytes);progress.begin('map.gltf');
  const gltfURL=new URL(config.renderUrl);gltfURL.searchParams.set('v',gltfFile.sha256);
  const gltfProgress=(loaded,total)=>progress.bytes('map.gltf',loaded,total);
  const gltfBytes=transport?.file('raw/map.gltf')?await transport.read('raw/map.gltf',{onBytes:gltfProgress}):await readPrivateResource(gltfURL,{signal,bytes:gltfFile.bytes,onBytes:gltfProgress,fetcher});
  progress.done('map.gltf');const text=new TextDecoder().decode(gltfBytes),json=JSON.parse(text);
  // Alias only identical source files. The original JSON text above remains
  // unchanged for Mirage's hash-bound breakable node validation below.
  privateRenderDependencies(json,files);const duplicateImages=deduplicatePrivateImages(json,files);
  for(const name of privateRenderDependencies(json,files))progress.plan(name,transport?.bytes('raw/'+name,files.get(name).bytes)||files.get(name).bytes,(json.images||[]).some(image=>image.uri===name)?'texture':'file');
  const fetchFile=async(url,binary=false)=>{const key=new URL(url).pathname.split('/').pop(),path=key==='entity-collision-policy.json'?key:'compiled/'+key,expected=url===config.physicsUrl?MAP.physics.triangles*36:url===config.maskUrl?MAP.physics.triangles:0,entry=transport?.file(path);if(entry&&expected&&entry.bytes!==expected)throw Error('加速碰撞长度与原图不一致');progress.plan(key,transport?.bytes(path,expected)||expected);progress.begin(key);const onBytes=(loaded,total)=>progress.bytes(key,loaded,total);const bytes=entry?await transport.read(path,{onBytes}):await readPrivateResource(url,{signal,bytes:expected,onBytes,maxBytes:expected||(url===config.groupsUrl?16:4)*1024*1024,cache:'no-store',fetcher});progress.done(key);return binary?bytes:new TextDecoder().decode(bytes);};
  if(config.id===PRIVATE_BREAKABLES.mapId){
   const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
   if(await hash(JSON.stringify(PRIVATE_BREAKABLES))!==config.breakablesSha256||await hash(text)!==PRIVATE_BREAKABLES.renderSha256||JSON.stringify(config.breakables)!==JSON.stringify(PRIVATE_BREAKABLES.objects)||JSON.stringify(config.initialHiddenNodeIndices)!==JSON.stringify(PRIVATE_BREAKABLES.initialHiddenNodeIndices))throw Error('可破坏物配置与当前原始地图不一致');
  }
  const renderBytes=(json.buffers||[]).reduce((n,b)=>n+b.byteLength,0),physicsBytes=MAP.physics.triangles*36;
  const memory=performance.memory,reason=privateMapMemoryReason({renderBytes,physicsBytes,deviceMemory:navigator.deviceMemory||0,remainingHeap:memory?memory.jsHeapSizeLimit-memory.usedJSHeapSize:Infinity});
  if(reason)throw Error(reason);
  loader=privateGLTFLoader(manager,{signal,files,baseURL:root.href,progress,transport,fetcher,onFailure:stopFailedJob});
  const collisionPromise=failTogether(Promise.all([fetchFile(config.physicsUrl,true),fetchFile(config.maskUrl,true),fetchFile(config.groupsUrl),fetchFile(config.policyUrl)]).then(([bytes,maskBytes,groupsText,policyText])=>decodePrivateMapCollision({bytes,maskBytes,groupsText,policyText,map:MAP,expected:config},{channels:[1,2,4]})));
  const jobs=await Promise.allSettled([
   failTogether(loader.parseAsync(json,root.href).then(gltf=>{loadedRoot=gltf.scene;return gltf;})),
   collisionPromise,
   failTogether(new HDRLoader(manager).loadAsync(new URL('assets/sky/daylight.hdr?v=5244534e9cf5',document.baseURI).href).then(value=>{sky=value;return value;})),
  ]);
  const failed=jobs.find(job=>job.status==='rejected');if(failed)throw firstFailure||failed.reason;check();progress.finish();
  const collision=jobs[1].value;
  const breakableCollision=new BreakableCollisionState(config.breakables||[],collision.sourceTrianglesByChannel);
  const group=new THREE.Group();group.name=MAP.name+' · private original CS2 render';group.rotation.y=Math.PI/2;group.add(loadedRoot);group.updateMatrixWorld(true);
  const materials=new Set(),textures=new Set();let meshCount=0,triangles=0;
  group.traverse(o=>{
   if(o.isLight){o.visible=false;return;}if(!o.isMesh)return;
   meshCount++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;o.frustumCulled=true;o.castShadow=false;o.receiveShadow=true;
   for(const material of [].concat(o.material||[])){
    if(materials.has(material))continue;materials.add(material);
    const v=material.userData?.vmat||{},flags=v.IntParams||{};
    if(v.Name?.startsWith('materials/tools/')||flags.F_DEPTH_FEATHER)material.visible=false;
    if(flags.F_VERTEX_ANIMATION||['csgo_effects.vfx','csgo_foliage.vfx'].includes(v.ShaderName))material.vertexColors=false;
    if(/overlay|decal|graffiti|poster/i.test(v.Name||material.name)){material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;}
    for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
   }
  });
  for(const texture of textures)texture.anisotropy=4;
  group.traverse(o=>{o.matrixAutoUpdate=false;o.matrixWorldAutoUpdate=false;});
  const hemisphere=new THREE.HemisphereLight(0xe4edff,0x8f846b,2),sun=new THREE.DirectionalLight(0xffefd6,3);
  sun.position.set(-30,100,30);sun.castShadow=false;
  check();if(config.breakables?.length)breakables=new PrivateMapBreakables({gltf:jobs[0].value,scene,definitions:config.breakables,initialHiddenNodeIndices:config.initialHiddenNodeIndices||[]});
  scene.add(group,hemisphere,sun);
  sky.mapping=THREE.EquirectangularReflectionMapping;scene.background=sky;scene.backgroundIntensity=.8;scene.backgroundRotation.y=1.2;
  scene.userData.sky={source:'Poly Haven / Kloofendal 48d Partly Cloudy',privateMap:true};
  group.userData.renderStats={meshCount,triangles,materials:materials.size,textures:textures.size,originalCS2Materials:true,lightingParityValidated:false};
  committed=true;onProgress(MAP.name+' 原始场景已就绪');
  return {mapData:MAP,positions:collision.positionsByChannel[1],bulletPositions:collision.positionsByChannel[2],grenadePositions:collision.positionsByChannel[4],mapPatches:false,group,breakables,breakableCollision,lights:[hemisphere,sun],spawn:MAP.spawns.T[0],physicsSha256:collision.physicsSha256,loadStats:{...progress.snapshot(),duplicateImages,transport:transport?.stats||null}};
 }finally{
  parentSignal?.removeEventListener('abort',abort);
  if(!committed){controller.abort();manager.abort();loader?.disposePrivateTextures();breakables?.dispose();disposeScene(loadedRoot);sky?.dispose();}
 }
}

import {validateDownloadConfig} from '../shared/download-config.js';

const DEFAULT_CONFIG=Object.freeze({schemaVersion:1,assetBaseURL:null,mapBaseURL:null,fallbackToGameServer:false});
const AVAILABILITY_STATUS=new Set([404,408,429,500,502,503,504]);
let downloadOrigin=null;
const defaultPageURL=()=>globalThis.document?.baseURI||globalThis.location?.href;
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');};
const networkError=error=>error?.name!=='AbortError'&&(error instanceof TypeError||error?.name==='NetworkError');

export function getDownloadOrigin(){return downloadOrigin;}

/** Only the game's own endpoint may authorize another static download origin.
 * A missing endpoint preserves compatibility with older same-origin servers. */
export async function initDownloadOrigin({configURL,pageURL=defaultPageURL(),signal,fetcher=globalThis.fetch}={}){
 check(signal);
 const page=new URL(pageURL),url=new URL(configURL||'download-config.json',page);
 if(!['http:','https:'].includes(page.protocol)||url.origin!==page.origin||url.username||url.password||url.href.includes('?')||url.href.includes('#'))
  throw Error('Download configuration must come from the game origin');
 const response=await fetcher(url,{signal,cache:'no-store',mode:'same-origin',credentials:'same-origin',redirect:'error'});
 check(signal);
 if(response.url&&new URL(response.url).origin!==page.origin)throw Error('Download configuration redirected outside the game origin');
 if(response.type==='opaque'||response.type==='opaqueredirect')throw Error('Download configuration response is unreadable');
 const config=response.status===404?DEFAULT_CONFIG:
  response.ok?validateDownloadConfig(await response.json(),page):null;
 check(signal);
 if(!config)throw Error('Download configuration unavailable ('+response.status+')');
 downloadOrigin=config;
 return config;
}

/** Recognize assets relative to the source document, preserving their logical
 * URLs for hash checks and cache keys. No API, map or websocket route is moved. */
export function assetDownloadURL(value,{pageURL=defaultPageURL(),config=downloadOrigin||DEFAULT_CONFIG}={}){
 const page=new URL(pageURL),url=new URL(value,page),prefix=new URL('assets/',new URL('.',page));
 if(!config.assetBaseURL||url.origin!==page.origin||!url.pathname.startsWith(prefix.pathname)||url.username||url.password||url.hash)
  return url;
 const relative=url.pathname.slice(prefix.pathname.length);
 if(!relative||relative.split('/').some(part=>!part||part==='.'||part==='..')||/%(?:2e|2f|5c)/i.test(relative)||relative.includes('\\'))
  throw Error('Asset download path is outside the source assets directory');
 const remote=new URL('./'+relative,config.assetBaseURL);
 remote.search=url.search;
 return remote;
}

export async function fetchAssetDownload(value,options={}){
 const {pageURL=defaultPageURL(),config=downloadOrigin||DEFAULT_CONFIG,fetcher=globalThis.fetch,...request}=options;
 check(request.signal);
 const original=new URL(value,pageURL),remote=assetDownloadURL(original,{pageURL,config});
 const fetchOriginal=async()=>{check(request.signal);const response=await fetcher(original,request);check(request.signal);return response;};
 if(remote.href===original.href)return fetchOriginal();
 let response;
 try{response=await fetcher(remote,{...request,mode:'cors',credentials:'omit'});}
 catch(error){
  check(request.signal);
  if(!config.fallbackToGameServer||!networkError(error))throw error;
  return fetchOriginal();
 }
 check(request.signal);
 if(config.fallbackToGameServer&&AVAILABILITY_STATUS.has(response.status)){
  await response.body?.cancel().catch(()=>{});
  check(request.signal);
  return fetchOriginal();
 }
 return response;
}

/** Keep game URLs and cache identities stable while moving map transfers.
 * The delivery configuration comes only from the game's same-origin endpoint.
 * Metadata and transport hashes remain checked by the existing loaders.
 */
export function privateMapDownloads(config, delivery) {
 return Object.freeze({...config,mapDownloadBaseURL:delivery.mapBaseURL||null,
  downloadFallbackToGameServer:delivery.fallbackToGameServer===true});
}

export function privateMapDownloadURL(value, config) {
 const url=new URL(value),page=new URL(config.socketURL);
 page.protocol=page.protocol==='wss:'?'https:':'http:';
 if(!config.mapDownloadBaseURL||url.origin!==page.origin)return url;
 const render=new URL(config.renderUrl),prefixes=[new URL('../',render).pathname,
  new URL('.',page).pathname+'maps/'+config.id+'/'];
 const prefix=prefixes.find(path=>url.pathname.startsWith(path));
 if(!prefix||url.username||url.password||url.hash)return url;
 const relative=url.pathname.slice(prefix.length);
 if(!relative||relative.split('/').some(part=>!part||part==='.'||part==='..')||/%(?:2e|2f|5c)/i.test(relative)||relative.includes('\\'))
  throw Error('地图下载地址越过当前地图');
 const remote=new URL(config.id+'/'+relative,config.mapDownloadBaseURL);
 remote.search=url.search;
 return remote;
}

export function privateMapFetcher(config,{fetcher=fetch}={}) {
 return async(value,options={})=>{
  const original=new URL(value),remote=privateMapDownloadURL(original,config);
  if(remote.href===original.href)return fetcher(original,options);
  options.signal?.throwIfAborted();
  let response;
  try{response=await fetcher(remote,{...options,mode:'cors',credentials:'omit'});}
  catch(error){
   options.signal?.throwIfAborted();
   if(!config.downloadFallbackToGameServer||error?.name==='AbortError'||!['TypeError','NetworkError'].includes(error?.name))throw error;
   return fetcher(original,options);
  }
  if(config.downloadFallbackToGameServer&&[404,408,429,500,502,503,504].includes(response.status)){
   await response.body?.cancel().catch(()=>{});
   options.signal?.throwIfAborted();
   return fetcher(original,options);
  }
  return response;
 };
}

const LOOPBACK_HOSTS=new Set(['localhost','127.0.0.1','[::1]']);
const FIELDS=new Set(['schemaVersion','assetBaseURL','mapBaseURL','fallbackToGameServer']);

function baseURL(value,key,page){
 if(value===null||value===undefined)return null;
 if(typeof value!=='string'||!/^https?:\/\//i.test(value)||value.trim()!==value||/[\u0000-\u0020\u007f\\]/.test(value))
  throw Error('Invalid download configuration: '+key);
 let url;
 try{url=new URL(value);}catch{throw Error('Invalid download configuration: '+key+' must be an absolute URL');}
 const local=url.protocol==='http:'&&LOOPBACK_HOSTS.has(url.hostname)&&page.protocol==='http:'&&LOOPBACK_HOSTS.has(page.hostname);
 if(url.protocol!=='https:'&&!local)throw Error('Invalid download configuration: '+key+' requires HTTPS');
 if(url.username||url.password||/^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(value)||value.includes('?')||value.includes('#')||/%(?:2e|2f|5c)/i.test(url.pathname))
  throw Error('Invalid download configuration: '+key+' cannot contain credentials, query, fragment or escaped path separators');
 if(!url.pathname.endsWith('/'))url.pathname+='/';
 return url.href;
}

/** Validate only operator-supplied static delivery settings. Game and websocket
 * origins are deliberately outside this schema. */
export function validateDownloadConfig(value,pageURL){
 const page=new URL(pageURL);
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==1||Object.keys(value).some(key=>!FIELDS.has(key)))
  throw Error('Invalid download configuration schema');
 if(value.fallbackToGameServer!==undefined&&typeof value.fallbackToGameServer!=='boolean')
  throw Error('Invalid download configuration: fallbackToGameServer must be boolean');
 return Object.freeze({schemaVersion:1,
  assetBaseURL:baseURL(value.assetBaseURL,'assetBaseURL',page),
  mapBaseURL:baseURL(value.mapBaseURL,'mapBaseURL',page),
  fallbackToGameServer:value.fallbackToGameServer===true});
}

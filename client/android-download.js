export const ANDROID_DOWNLOAD_METADATA='https://cs2.duskrain.cn/downloads/android-latest.json';
export const LEGACY_ANDROID_APK='https://github.com/ETO-ze/dust2-web/releases/download/online-v1.2.0/DustII-Android-1.2.0.apk';
const MAX_METADATA_BYTES=16384;
const VERSION=/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const GAME_ORIGINS=new Set(['https://cs2.duskrain.cn','https://cs2.duskrain.cn:8443']);

export function androidMetadataURL(pageURL=globalThis.document?.baseURI){
 if(pageURL){try{const page=new URL(pageURL);if(GAME_ORIGINS.has(page.origin)&&!page.username&&!page.password)return new URL('downloads/android-latest.json',new URL('.',page)).href;}catch{}}
 return ANDROID_DOWNLOAD_METADATA;
}

export class AndroidDownloadError extends Error {
 constructor(code){super(code==='unavailable'?'安卓安装信息暂时无法获取':'安卓安装信息校验失败');this.name='AndroidDownloadError';this.code=code;}
}

export function validateAndroidDownload(metadata){
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||metadata.package!=='cn.duskrain.dustii'||metadata.testKernel===true||
  !Number.isSafeInteger(metadata.versionCode)||metadata.versionCode<1||metadata.versionCode>2147483647||
  typeof metadata.version!=='string'||!VERSION.test(metadata.version)||!Number.isSafeInteger(metadata.bytes)||metadata.bytes<1||
  typeof metadata.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(metadata.sha256)||typeof metadata.url!=='string')throw new AndroidDownloadError('invalid');
 const expected=`https://github.com/ETO-ze/dust2-web/releases/download/online-v${metadata.version}/DustII-Android-${metadata.version}.apk`;
 if(metadata.url!==expected)throw new AndroidDownloadError('invalid');
 return metadata.url;
}

/** Only the fixed official game endpoint may supply an Android release link. */
export async function resolveAndroidDownloadURL({fetcher=globalThis.fetch,timeoutMs=8000,pageURL=globalThis.document?.baseURI}={}){
 const metadataURL=androidMetadataURL(pageURL);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 let response;
 try{
  try{response=await fetcher(metadataURL,{method:'GET',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});}
  catch{throw new AndroidDownloadError('unavailable');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new AndroidDownloadError('unavailable');}
  if(response.url&&response.url!==metadataURL||['opaque','opaqueredirect'].includes(response.type)||
   Number(response.headers.get('content-length'))>MAX_METADATA_BYTES)throw new AndroidDownloadError('invalid');
  const chunks=[];let size=0;
  try{
   if(response.body){
    const reader=response.body.getReader();
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_METADATA_BYTES)throw new AndroidDownloadError('invalid');chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
   }else{const bytes=new TextEncoder().encode(await response.text());if(bytes.byteLength>MAX_METADATA_BYTES)throw new AndroidDownloadError('invalid');chunks.push(bytes);size=bytes.byteLength;}
  }catch(error){if(error instanceof AndroidDownloadError)throw error;throw new AndroidDownloadError('unavailable');}
  let metadata;
  try{const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new AndroidDownloadError('invalid');}
  return validateAndroidDownload(metadata);
 }finally{clearTimeout(timer);await response?.body?.cancel().catch(()=>{});}
}

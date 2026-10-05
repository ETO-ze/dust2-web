import test from 'node:test';
import assert from 'node:assert/strict';
import {ANDROID_DOWNLOAD_METADATA,LEGACY_ANDROID_APK,androidMetadataURL,validateAndroidDownload,resolveAndroidDownloadURL} from '../client/android-download.js';
const metadata=()=>({package:'cn.duskrain.dustii',version:'1.2.0-cdn.1',versionCode:4,bytes:343663836,sha256:'a'.repeat(64),testKernel:false,url:'https://github.com/ETO-ze/dust2-web/releases/download/online-v1.2.0-cdn.1/DustII-Android-1.2.0-cdn.1.apk'});
test('current official Android release replaces the old fallback only after trusted metadata validates',async()=>{
 let calls=0;const data=metadata();const url=await resolveAndroidDownloadURL({fetcher:async(target,options)=>{calls++;assert.equal(target,ANDROID_DOWNLOAD_METADATA);assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return Response.json(data);}});
 assert.equal(calls,1);assert.equal(url,data.url);assert.notEqual(url,LEGACY_ANDROID_APK);
});
test('Android metadata accepts the current historical official fallback identity',()=>{const data=metadata();data.version='1.2.0';data.versionCode=3;data.url=LEGACY_ANDROID_APK;assert.equal(validateAndroidDownload(data),LEGACY_ANDROID_APK);});
test('official public and private entries read metadata from their own document base; untrusted origins cannot choose metadata',async()=>{
 assert.equal(androidMetadataURL('https://cs2.duskrain.cn/index.html'),ANDROID_DOWNLOAD_METADATA);
 assert.equal(androidMetadataURL('https://cs2.duskrain.cn:8443/private-entry/index.html?room=ABC'),'https://cs2.duskrain.cn:8443/private-entry/downloads/android-latest.json');
 for(const url of ['https://untrusted.test/custom/index.html','http://cs2.duskrain.cn/index.html','https://cs2.duskrain.cn:9443/index.html','https://user:secret@cs2.duskrain.cn/index.html'])assert.equal(androidMetadataURL(url),ANDROID_DOWNLOAD_METADATA);
 let requested;await resolveAndroidDownloadURL({pageURL:'https://cs2.duskrain.cn:8443/private-entry/index.html',fetcher:async url=>{requested=url;return Response.json(metadata());}});assert.equal(requested,'https://cs2.duskrain.cn:8443/private-entry/downloads/android-latest.json');
});
test('metadata cannot authorize another repository, a redirect, credentials, another APK name or a mismatched release',()=>{
 const invalid=[null,[],{...metadata(),package:'cn.duskrain.dustii.gecko'},{...metadata(),testKernel:true},{...metadata(),versionCode:0},{...metadata(),versionCode:1.5},{...metadata(),sha256:'broken'},{...metadata(),bytes:0},{...metadata(),version:'../x'}];
 for(const url of ['https://github.com/other/dust2-web/releases/download/online-v1.2.0-cdn.1/DustII-Android-1.2.0-cdn.1.apk','https://github.com/ETO-ze/dust2-web/releases/download/online-v1.2.0-cdn.1/evil.apk',metadata().url+'?redirect=evil',metadata().url+'#extra',metadata().url.replace('https://','http://'),metadata().url.replace('github.com','user:password@github.com'),metadata().url.replace('github.com','github.com.evil.test'),metadata().url.replace('/online-v1.2.0-cdn.1/','/online-v1.2.0/')])invalid.push({...metadata(),url});
 for(const data of invalid)assert.throws(()=>validateAndroidDownload(data),error=>error.code==='invalid');
});
test('network and failed HTTP fetches allow a historical safe fallback, without exposing error contents',async()=>{
 for(const fetcher of [async()=>{throw Error('private upstream detail');},async()=>new Response('',{status:503}),async()=>new Response('',{status:404})])await assert.rejects(resolveAndroidDownloadURL({fetcher}),error=>error.code==='unavailable'&&!error.message.includes('private'));
});
test('untrusted redirects, malformed and oversized metadata fail closed instead of permitting fallback',async()=>{
 for(const fetcher of [async()=>{const response=Response.json(metadata());Object.defineProperty(response,'url',{value:'https://untrusted.test/latest.json'});return response;},async()=>new Response('not json'),async()=>new Response(' '.repeat(16385)),async()=>new Response('{}',{headers:{'content-length':'16385'}}),async()=>Response.json({...metadata(),url:'https://evil.test/file.apk'})])await assert.rejects(resolveAndroidDownloadURL({fetcher}),error=>error.code==='invalid');
});
test('metadata timeout is a fetch failure and never keeps the link check pending forever',async()=>{
 await assert.rejects(resolveAndroidDownloadURL({timeoutMs:5,fetcher:async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})}),error=>error.code==='unavailable');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {get} from 'node:http';
import {startPortable} from '../portable/launch.mjs';

const CONFIG='https://cs2.duskrain.cn/download-config.json';
const ORIGINAL='https://cs2.duskrain.cn/assets/optional/model.glb?v=abc';
const MIRROR='https://downloads.test/releases/test/assets/optional/model.glb?v=abc';
const PROXY='__remote_assets__/assets/optional/model.glb?v=abc';
const delivery=(fallback=false)=>({schemaVersion:1,assetBaseURL:'https://downloads.test/releases/test/assets/',mapBaseURL:null,fallbackToGameServer:fallback});
async function appFixture(t,downloadFetcher,{offline=false}={}){
 const root=await mkdtemp(path.join(tmpdir(),'dust2-proxy-'));
 await mkdir(path.join(root,'dist/assets'),{recursive:true});
 await writeFile(path.join(root,'dist/index.html'),'<head></head>');
 await writeFile(path.join(root,'dist/assets/local.bin'),'local bytes');
 await writeFile(path.join(root,'dist/bundle-manifest.json'),JSON.stringify({files:[]}));
 if(offline){await mkdir(path.join(root,'server'));await writeFile(path.join(root,'server/index.js'),'export async function startGameServer(){return {port:12345,close:async()=>{}}}');await writeFile(path.join(root,'package.json'),' {"type":"module"}');}
 const app=await startPortable({root,port:0,mode:offline?'offline':'online',downloadFetcher});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 return app;
}

test('portable downloads use only the trusted configuration and preserve proxy Range, ETag, size and HEAD responses',async t=>{
 const calls=[];
 const app=await appFixture(t,async(url,options)=>{
  calls.push({url:String(url),options});
  if(String(url)===CONFIG)return Response.json(delivery());
  assert.equal(String(url),MIRROR);
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
  assert.equal(options.headers['Accept-Encoding'],'identity');
  assert.equal(options.headers.authorization,undefined);
  if(options.headers['if-none-match']==='"model-sha"')return new Response(null,{status:304,headers:{ETag:'"model-sha"'}});
  if(options.headers.range){assert.equal(options.headers.range,'bytes=2-5');assert.equal(options.headers['if-range'],'"model-sha"');return new Response('2345',{status:206,headers:{'Content-Type':'model/gltf-binary','Content-Length':'4','Content-Range':'bytes 2-5/10','Accept-Ranges':'bytes',ETag:'"model-sha"'}});}
  return new Response(options.method==='HEAD'?null:'0123456789',{headers:{'Content-Type':'model/gltf-binary','Content-Length':'10','Accept-Ranges':'bytes',ETag:'"model-sha"'}});
 });
 const range=await fetch(app.url+PROXY,{headers:{Range:'bytes=2-5','If-Range':'"model-sha"',Authorization:'local-secret'}});
 assert.equal(range.status,206);assert.equal(await range.text(),'2345');
 for(const [name,value]of Object.entries({'content-length':'4','content-range':'bytes 2-5/10','accept-ranges':'bytes',etag:'"model-sha"','cache-control':'no-store'}))assert.equal(range.headers.get(name),value);
 const head=await fetch(app.url+PROXY,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
 const cached=await fetch(app.url+PROXY,{headers:{'If-None-Match':'"model-sha"'}});assert.equal(cached.status,304);assert.equal(cached.headers.get('etag'),'"model-sha"');
 assert.deepEqual(calls.map(c=>c.url),[CONFIG,MIRROR,CONFIG,MIRROR,CONFIG,MIRROR]);
 assert(calls.filter(c=>c.url===CONFIG).every(c=>c.options.cache==='no-store'&&c.options.redirect==='error'));
});

test('portable installed local resources and offline simulation do not initialize download configuration',async t=>{
 for(const offline of [false,true]){
  const app=await appFixture(t,()=>{throw Error('Local resources must not use a remote transport');},{offline});
  assert.equal(await (await fetch(app.url+'assets/local.bin')).text(),'local bytes');
  assert.equal((await fetch(app.url+'download-config.json')).status,404);
  const health=await (await fetch(app.url+'portable-health')).json();
  assert.equal(health.mode,offline?'offline':'online');assert.equal(health.socketURL,offline?'ws://127.0.0.1:12345/ws':'wss://cs2.duskrain.cn/ws');
 }
});

test('portable legacy 404 configurations retain the original download origin',async t=>{
 const calls=[];
 const app=await appFixture(t,async url=>{calls.push(String(url));return String(url)===CONFIG?new Response(null,{status:404}):new Response('legacy');});
 assert.equal(await (await fetch(app.url+PROXY)).text(),'legacy');
 assert.deepEqual(calls,[CONFIG,ORIGINAL]);
});

test('portable configuration errors fail closed without any asset request or leaked upstream URL',async t=>{
 const failures=[
  ()=>new Response(null,{status:503}),
  ()=>Response.json({...delivery(),assetBaseURL:'http://untrusted.test/'}),
  ()=>Response.json({...delivery(),assetBaseURL:'https://secret:password@downloads.test/'}),
  ()=>Response.json({...delivery(),schemaVersion:2}),
  ()=>new Response('invalid json'),
  ()=>new Response(' '.repeat(16385)),
  ()=>{throw new TypeError('https://secret:password@upstream.test/config?secret=value');},
  ()=>{const r=Response.json(delivery());Object.defineProperty(r,'url',{value:'https://untrusted.test/config'});return r;},
 ];
 for(const fail of failures){
  const calls=[],app=await appFixture(t,async url=>{calls.push(String(url));return fail();});
  const response=await fetch(app.url+PROXY);assert.equal(response.status,502);assert.equal(await response.text(),'Remote asset unavailable.');assert.deepEqual(calls,[CONFIG]);
 }
});

test('portable mirror failures fall back only when availability fallback was explicitly enabled',async t=>{
 for(const fallback of [false,true])for(const failure of [503,404,'network',403,'program','encoding']){
  const calls=[],app=await appFixture(t,async url=>{
   const value=String(url);calls.push(value);if(value===CONFIG)return Response.json(delivery(fallback));
   if(value===ORIGINAL)return new Response('original');
   if(failure==='network')throw new TypeError('unavailable');
   if(failure==='program')throw Error('program error');
   if(failure==='encoding')return new Response('decoded body',{headers:{'Content-Encoding':'gzip','Content-Length':'123'}});
   return new Response('mirror unavailable',{status:failure});
  });
  const response=await fetch(app.url+PROXY),allowed=fallback&&[503,404,'network'].includes(failure);
  assert.equal(response.status,allowed?200:['network','program','encoding'].includes(failure)?502:failure);
  if(allowed)assert.equal(await response.text(),'original');else await response.body?.cancel();
  assert.deepEqual(calls,allowed?[CONFIG,MIRROR,ORIGINAL]:[CONFIG,MIRROR]);
 }
});

test('portable mirror fallback never retries the original a second time',async t=>{
 const calls=[],app=await appFixture(t,async url=>{
  calls.push(String(url));if(String(url)===CONFIG)return Response.json(delivery(true));
  if(String(url)===MIRROR)throw new TypeError('unavailable');
  return new Response('original unavailable',{status:503});
 });
 const response=await fetch(app.url+PROXY);assert.equal(response.status,503);await response.body.cancel();
 assert.deepEqual(calls,[CONFIG,MIRROR,ORIGINAL]);
});

test('portable proxy rejects escaped separators and traversal before reading trusted configuration',async t=>{
 const calls=[],app=await appFixture(t,async url=>{calls.push(String(url));throw Error('Unsafe paths must not reach the remote transport');});
 for(const suffix of ['','nested/%2e%2e/model.glb','nested/%2fmodel.glb','nested/%5cmodel.glb','nested//model.glb','nested/%252fmodel.glb']){
  // Browser URL construction normalizes escaped dot segments. Send the raw
  // path so this exercises the server guard, including nonbrowser requests.
  const status=await new Promise((resolve,reject)=>get({hostname:'127.0.0.1',port:new URL(app.url).port,path:'/__remote_assets__/assets/'+suffix},response=>{response.resume();resolve(response.statusCode);}).on('error',reject));
  assert([400,403,404].includes(status));
 }
 assert.deepEqual(calls,[]);
});

test('portable browser cancellation aborts the remote transfer without fallback',async t=>{
 let started,aborted;
 const begin=new Promise(resolve=>{started=resolve;}),cancelled=new Promise(resolve=>{aborted=resolve;});
 const calls=[],app=await appFixture(t,async(url,options)=>{
  calls.push(String(url));if(String(url)===CONFIG)return Response.json(delivery(true));
  started();return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted();reject(options.signal.reason);},{once:true});});
 });
 const controller=new AbortController(),request=fetch(app.url+PROXY,{signal:controller.signal});
 await begin;controller.abort();await assert.rejects(request,{name:'AbortError'});
 await Promise.race([cancelled,new Promise((_,reject)=>setTimeout(()=>reject(Error('Remote transfer was not cancelled')),1000))]);
 assert.deepEqual(calls,[CONFIG,MIRROR]);
});

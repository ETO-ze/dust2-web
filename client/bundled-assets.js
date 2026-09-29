// Installed bytes and remote simulation are independent capabilities.
const config=globalThis.__DUST2_PORTABLE__;
const page=typeof location==='object'?new URL(location.href):null;
export const bundled=!!config?.bundledAssets&&!!page&&(['127.0.0.1','localhost','[::1]'].includes(page.hostname)||(page.origin==='https://cs2.duskrain.cn'&&page.pathname.startsWith('/__installed__/')));
let manifestPromise;
export function bundledManifest(){
 return manifestPromise??=fetch(new URL('bundle-manifest.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('本地资源清单缺失，请重新安装完整客户端。');return r.json();});
}
export async function bundledEntry(value){
 if(!bundled)return null;
 const base=new URL('.',document.baseURI),url=new URL(value,base);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return null;
 const relative=decodeURI(url.pathname.slice(base.pathname.length));
 return (await bundledManifest()).files.find(f=>f.path===relative)||null;
}
export function remoteAsset(value){
 const base=new URL('.',document.baseURI),url=new URL(value,base);
 if(!bundled||url.origin!==base.origin||!url.pathname.startsWith(base.pathname+'assets/'))return url;
 const relative=url.pathname.slice(base.pathname.length)+url.search;
 return ['127.0.0.1','localhost','[::1]'].includes(base.hostname)?new URL('__remote_assets__/'+relative,base):new URL(relative,'https://cs2.duskrain.cn/');
}

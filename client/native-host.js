/** One message contract for scoped WebView messages and the built-in Gecko extension. */
export class NativeHost{
 constructor(){this.pending=new Map();this.serial=0;this.listeners=new Set();this.info=null;this.bound=null;
  if(typeof window==='undefined')return;
  window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data?.dustiiNativeReply)this.receive(e.data.payload);});
  this.bind();
 }
 get installed(){return /\bDustIIAndroid\//.test(globalThis.navigator?.userAgent||'');}
 bind(){const host=globalThis.window?.DustIIHost;if(host&&host!==this.bound){this.bound=host;host.onmessage=e=>this.receive(e.data);}}
 receive(raw){let m;try{m=typeof raw==='string'?JSON.parse(raw):raw;}catch{return;}if(!m||typeof m!=='object')return;const pending=this.pending.get(m.requestId);if(pending){this.pending.delete(m.requestId);clearTimeout(pending.timer);m.error?pending.reject(Error(m.error)):pending.resolve(m);}for(const listener of this.listeners)listener(m);}
 request(type,data={}){this.bind();return new Promise((resolve,reject)=>{const requestId=++this.serial,request={type,requestId,...data};const timer=setTimeout(()=>{this.pending.delete(requestId);reject(Error('原生接口未响应'));},2000);this.pending.set(requestId,{resolve,reject,timer});try{if(this.bound)this.bound.postMessage(JSON.stringify(request));else if(this.installed)window.postMessage({dustiiNativeRequest:true,payload:request},location.origin);else throw Error('当前为网页版');}catch(error){clearTimeout(timer);this.pending.delete(requestId);reject(error);}});}
}
export const nativeHost=new NativeHost();

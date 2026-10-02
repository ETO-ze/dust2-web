/* Isolated extension world; the native side also checks frame, session and URL. */
if(window===window.top&&location.origin==='http://127.0.0.1:27186'&&location.pathname==='/index.html'){
 const port=browser.runtime.connectNative('dustii');
 const allowed=new Set(['motionCapabilities','startMotion','stopMotion','calibrateMotion','exportPreferences','exportDiagnostics']);
 port.onMessage.addListener(payload=>{
  if(payload.type==='hostBlur'){window.dispatchEvent(new Event('blur'));return;}
  window.postMessage({dustiiNativeReply:true,payload},location.origin);
 });
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||!event.data?.dustiiNativeRequest)return;
  const data=event.data.payload;if(!allowed.has(data?.type)||JSON.stringify(data).length>262144)return;
  port.postMessage(data);
 });
 window.addEventListener('pagehide',()=>port.disconnect(),{once:true});
}

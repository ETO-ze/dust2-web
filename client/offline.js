let installPrompt=null,registration=null,started=false;
const listeners=new Set(),state={supported:false,online:true,ready:false,canInstall:false,installed:false};
const publish=()=>{for(const fn of listeners)fn({...state});};
export async function initOffline({onStatus}={}){
  if(onStatus){listeners.add(onStatus);onStatus({...state});}if(started)return{...state};started=true;
  state.supported=Boolean('serviceWorker' in navigator&&globalThis.isSecureContext);state.online=navigator.onLine;
  state.installed=globalThis.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  window.addEventListener('online',()=>{state.online=true;publish();});window.addEventListener('offline',()=>{state.online=false;publish();});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;state.canInstall=true;publish();});
  window.addEventListener('appinstalled',()=>{installPrompt=null;state.canInstall=false;state.installed=true;publish();});
  if(state.supported){try{const b=new URL('.',document.baseURI);registration=await navigator.serviceWorker.register(new URL('sw.js',b),{scope:b.pathname,updateViaCache:'none'});await navigator.serviceWorker.ready;state.ready=true;}catch(error){state.error=error.message;}}
  publish();return{...state};
}
// Explicit button gesture only: browsers may decline persistent storage.
export async function requestPersistentStorage(){return Boolean(await navigator.storage?.persist?.());}
export async function installApp(){if(!installPrompt)return{outcome:state.installed?'installed':'unavailable'};const p=installPrompt;installPrompt=null;state.canInstall=false;publish();await p.prompt();return p.userChoice;}
export async function refreshOfflineShell(){const worker=registration?.active||navigator.serviceWorker?.controller;if(!worker)return false;return new Promise(resolve=>{const c=new MessageChannel(),finish=value=>{clearTimeout(timer);c.port1.close();c.port2.close();resolve(value);},timer=setTimeout(()=>finish(false),15000);c.port1.onmessage=e=>finish(e.data?.ok===true);worker.postMessage({type:'CACHE_SHELL'},[c.port2]);});}

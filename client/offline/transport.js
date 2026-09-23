// WebSocket-compatible boundary. The page never imports the simulation engine.
export class OfflineTransport extends EventTarget {
  constructor(positions,materials) {
    super();this.readyState=0;this.paused=false;
    this.worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      if(this.readyState===3)return;
      if(data.type==='ready'){this.readyState=1;this.dispatchEvent(new Event('open'));}
      else if(data.type==='message')this.dispatchEvent(new MessageEvent('message',{data:data.data}));
      else if(data.type==='fatal')this.fail(data.message);
    };
    this.worker.onerror=e=>{e.preventDefault();this.fail(e.message||'离线模拟启动失败');};
    // Copy only once. Transferring the renderer's collision buffer would detach it.
    const geometry=new Float32Array(positions),surfaces=new Uint8Array(materials);
    this.worker.postMessage({type:'init',positions:geometry,materials:surfaces},[geometry.buffer,surfaces.buffer]);
  }
  send(data) {if(this.readyState===1)this.worker.postMessage({type:'command',data:typeof data==='string'?JSON.parse(data):data});}
  setPaused(value) {value=!!value;if(this.paused===value||this.readyState!==1)return;this.paused=value;this.worker.postMessage({type:'pause',value});}
  fail(message) {this.dispatchEvent(new MessageEvent('message',{data:{type:'error',code:'OFFLINE_FAILURE',message}}));this.close(1011,message);}
  close(code=1000,reason='') {if(this.readyState===3)return;this.readyState=3;this.worker.terminate();this.dispatchEvent(new CloseEvent('close',{code,reason,wasClean:code===1000}));}
}

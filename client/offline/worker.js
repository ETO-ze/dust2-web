import {initPhysics} from '../../shared/physics.js';
import {OfflineSession} from './session.js';
let session=null,last=performance.now(),timer=null;
const send = data=>postMessage({type:'message',data});
function fatal(error) { clearInterval(timer);postMessage({type:'fatal',message:error?.message||String(error)}); }
self.onmessage = event=>{
  try {
    const msg=event.data;
    if(msg.type==='init') {
      initPhysics(msg.positions,msg.materials);
      session=new OfflineSession(send);last=performance.now();
      timer=setInterval(()=>{try{const now=performance.now();session.clock.advance(now-last);last=now;}catch(e){fatal(e);}},1000/60);
      postMessage({type:'ready'});
    } else if(msg.type==='pause') {session?.pause(msg.value);last=performance.now();}
    else if(msg.type==='command')session?.send(msg.data);
  } catch(error) {fatal(error);}
};

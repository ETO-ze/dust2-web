import metalURL from './private-audio/metal-break.mp3?url';
import woodURL from './private-audio/wood-break.mp3?url';

const pending=new WeakMap();
/** Two bounded original samples, emitted by Vite with the private client. */
export async function preparePrivateBreakableAudio(audio,signal){
  if(!pending.has(audio))pending.set(audio,(async()=>{
    for(const [bank,url]of [['privateBreakMetal',metalURL],['privateBreakWood',woodURL]]){
      const response=await fetch(url,{signal});if(!response.ok)throw Error('破碎音效加载失败');
      const buffer=await audio.ctx.decodeAudioData(await response.arrayBuffer());signal?.throwIfAborted();
      audio.banks.set(bank,[buffer]);
    }
  })().catch(error=>{pending.delete(audio);throw error;}));
  await pending.get(audio);
}
export function playPrivateBreakableAudio(audio,event,listener){
  const origin=event.origin,dx=origin.x-listener.x,dz=origin.z-listener.z,distance=Math.hypot(dx,origin.y-listener.y,dz);
  const pan=(dx*Math.cos(listener.yaw||0)-dz*Math.sin(listener.yaw||0))/Math.max(1,Math.hypot(dx,dz));
  audio.play(event.material==='wood'?'privateBreakWood':'privateBreakMetal',{level:.65/(1+distance*.075),distance,pan,channel:'effect'});
}

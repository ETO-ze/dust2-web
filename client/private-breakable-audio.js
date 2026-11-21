import metalURL from './private-audio/metal-break.mp3?url';
import woodURL from './private-audio/wood-break.mp3?url';
import glassURL from './private-audio/glass-break.mp3?url';

const samples = {
  metal: {bank:'privateBreakMetal', url:metalURL},
  wood: {bank:'privateBreakWood', url:woodURL},
  glass: {bank:'privateBreakGlass', url:glassURL},
};
const sampleFor = material => Object.hasOwn(samples, material) ? samples[material] : samples.metal;

export async function preparePrivateBreakableAudio(audio, signal, entries) {
  const required = new Set(Array.from(entries, entry => sampleFor(entry.definition.material)));
  for (const {bank, url} of required) {
    signal?.throwIfAborted();
    if (audio.banks.has(bank)) continue;
    const response = await fetch(url, {signal});
    if (!response.ok) throw Error('破碎音效加载失败');
    const buffer = await audio.ctx.decodeAudioData(await response.arrayBuffer());
    signal?.throwIfAborted();
    audio.banks.set(bank, [buffer]);
  }
}

export function playPrivateBreakableAudio(audio, event, listener) {
  const origin=event.origin,dx=origin.x-listener.x,dz=origin.z-listener.z,distance=Math.hypot(dx,origin.y-listener.y,dz);
  const pan=(dx*Math.cos(listener.yaw||0)-dz*Math.sin(listener.yaw||0))/Math.max(1,Math.hypot(dx,dz));
  audio.play(sampleFor(event.material).bank,{level:.65/(1+distance*.075),distance,pan,channel:'effect'});
}

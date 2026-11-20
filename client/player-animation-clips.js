import * as THREE from 'three';

const cachedClips=new WeakMap();

// AnimationMixers bind the shared tracks to each character's own skeleton.
export function playerAnimationClips(source) {
  if(cachedClips.has(source))return cachedClips.get(source);
  const body=new Map(),upper=new Map(),upperBones=new Set();
  const native=source.scene.userData.cs2DefaultAgent;
  if(native)for(const joint of ['spine_3','wpnPivot']){
    source.scene.getObjectByName(joint)?.traverse(bone=>upperBones.add(bone.name));
  }
  const isUpper=track=>upperBones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
  for(const clip of source.animations){
    if(native&&clip.name.startsWith('grenade/')){
      const additive=/\/(idle|crouchIdle)$/.test(clip.name);
      const tracks=clip.tracks.filter(isUpper).map(track=>{
        if(!additive||!track.name.endsWith('.scale'))return track;
        // Only the additive overlay needs scale offsets. The source also feeds regular poses.
        const offset=track.clone();
        for(let i=0;i<offset.values.length;i++)offset.values[i]-=1;
        return offset;
      });
      upper.set(clip.name.slice('grenade/'.length),new THREE.AnimationClip(clip.name,clip.duration,tracks,additive?THREE.AdditiveAnimationBlendMode:clip.blendMode));
      continue;
    }
    body.set(clip.name,clip);
    if(native&&clip.name.startsWith('knife/')){
      const name='lower/'+clip.name;
      body.set(name,new THREE.AnimationClip(name,clip.duration,clip.tracks.filter(track=>!isUpper(track)),clip.blendMode));
    }
  }
  const result={body,upper};cachedClips.set(source,result);return result;
}

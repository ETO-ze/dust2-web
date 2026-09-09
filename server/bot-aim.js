export const BOT_AIM=Object.freeze({maxYawSpeed:3.6,maxPitchSpeed:2.6,damping:9,alignedRadians:.035,settleSeconds:.12});
export const angleDifference=(target,current)=>Math.atan2(Math.sin(target-current),Math.cos(target-current));
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));

/** Damped shortest-arc aiming with explicit angular-velocity bounds. */
export function smoothBotAim(current,target,dt){
  const step=clamp(Number.isFinite(dt)?dt:0,0,.1),blend=1-Math.exp(-BOT_AIM.damping*step);
  const yawDelta=angleDifference(target.yaw,current.yaw),pitchDelta=target.pitch-current.pitch;
  const yaw=current.yaw+clamp(yawDelta*blend,-BOT_AIM.maxYawSpeed*step,BOT_AIM.maxYawSpeed*step);
  const pitch=clamp(current.pitch+clamp(pitchDelta*blend,-BOT_AIM.maxPitchSpeed*step,BOT_AIM.maxPitchSpeed*step),-1.48,1.48);
  return {yaw:Math.atan2(Math.sin(yaw),Math.cos(yaw)),pitch,
    aligned:Math.hypot(angleDifference(target.yaw,yaw),target.pitch-pitch)<=BOT_AIM.alignedRadians};
}

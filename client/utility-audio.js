export const UTILITY_AUDIO=Object.freeze({
  hegrenade:{pin:'hegrenadePin',throw:'heThrow',bounce:'grenadeBounce',detonate:'heExplosion',far:'heExplosionFar'},
  flashbang:{pin:'flashbangPin',throw:'flashbangThrow',bounce:'flashbangBounce',detonate:'flashExplosion',far:'flashbangFar'},
  smokegrenade:{pin:'smokegrenadePin',throw:'smokeThrow',bounce:'smokegrenadeBounce',detonate:'smokegrenadeDetonate',far:'smokegrenadeFar'},
  molotov:{throw:'molotovThrow',bounce:'molotovBounce',detonate:'molotovIgnite',failed:'molotovFailed',break:'fireStart'},
  incgrenade:{pin:'incgrenadePin',throw:'incgrenadeThrow',bounce:'incgrenadeBounce',detonate:'incgrenadeIgnite',failed:'incgrenadeFailed',break:'incgrenadePop'},
  decoy:{pin:'decoyPin',throw:'decoyThrow',bounce:'decoyBounce',detonate:'heExplosion'},
});
export function utilitySound(event,listener,myId){
  const weapon=event.weapon||(event.type==='flash'?'flashbang':event.type==='smoke'?'smokegrenade':null),config=UTILITY_AUDIO[weapon];
  if(event.type==='grenade_primed')return event.playerId===myId&&config?.pin?{bank:config.pin,level:.43,channel:'utility-pin'}:null;
  if(!event.origin)return null;
  const dx=event.origin.x-listener.x,dz=event.origin.z-listener.z,distance=Math.hypot(dx,event.origin.y-listener.y,dz);
  const yaw=listener.yaw||0,pan=Math.max(-1,Math.min(1,(dx*Math.cos(yaw)-dz*Math.sin(yaw))/Math.max(1,distance)));
  const action={grenade_thrown:'throw',grenade_bounce:'bounce',explosion:'detonate',flash:'detonate',smoke:'detonate',fire_started:'detonate',fire_failed:'failed'}[event.type];
  const bank=event.type==='fire_extinguished'?'fireExtinguish':config?.[action];if(!bank)return null;
  const loud=action==='detonate',limit=loud?110:45;if(distance>limit)return null;
  const level=(weapon==='decoy'&&loud?.2:loud?.72:.42)/(1+distance*(loud?.045:.085));
  return {bank:loud&&distance>30&&config?.far?config.far:bank,level,distance,pan,channel:'utility',...(event.type==='fire_started'&&distance<30?{layer:config.break}: {})};
}

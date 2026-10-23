// Adjustable browser-game approximation, NOT a measured CS2 cocking delay.
export const REVOLVER_PRIMARY_FIRE_DELAY_MS=250;
// Alternate cycle time is present in the extracted revolver weapon data.
export const REVOLVER_SECONDARY_FIRE_INTERVAL=.4;

export function revolverFireMode(input){return input.fire2?'secondary':input.fire?'primary':null;}
export function weaponFireInterval(weapon,mode='primary'){
 return weapon.id==='revolver'&&mode==='secondary'?REVOLVER_SECONDARY_FIRE_INTERVAL:weapon.fireInterval;
}

/** A cancellable held trigger; callers consume a successful shot with reset(). */
export class RevolverTrigger {
 constructor(){this.reset();}
 reset(){this.startedAt=null;}
 get fireAt(){return this.startedAt===null?null:this.startedAt+REVOLVER_PRIMARY_FIRE_DELAY_MS;}
 update(input,now,enabled=true){
  if(!enabled){this.reset();return null;}
  const mode=revolverFireMode(input);
  if(mode!=='primary'){this.reset();return mode;}
  if(this.startedAt===null)this.startedAt=now;
  return now>=this.fireAt?'primary':null;
 }
}

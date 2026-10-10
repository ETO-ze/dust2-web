/** Internal squad timing from REAL grenade releases/effects. No enemy data.
 * Demo cooperation windows inform sequencing, not hard-coded aim/coordinates. */
export class BotUtilityTimeline {
 constructor(clock){this.clock=clock;this.items=new Map();}
 clear(){this.items.clear();}
 prune(){const now=this.clock();for(const[id,item]of this.items)if(now>=item.expiresAt)this.items.delete(id);}
 observe(type,event,players){
  this.prune();const now=this.clock();
  if(type==='grenade_thrown'){
   const p=players.get(event.shooterId);
   if(!p?.bot||p.controllerId||p.controlledBy||!p.botAI?.site)return;
   this.items.set(event.grenadeId,{ownerId:p.id,team:p.team,site:p.botAI.site,lane:p.botAI.lane,weapon:event.weapon,at:now,effectAt:null,expiresAt:now+6500,origin:event.origin});
   while(this.items.size>40)this.items.delete(this.items.keys().next().value);
   return;
  }
  const item=this.items.get(event.grenadeId);if(!item)return;
  if(['fire_failed','fire_extinguished'].includes(type)){this.items.delete(event.grenadeId);return;}
  if(['smoke','flash','fire_started','explosion'].includes(type)){
   item.effectAt=now;item.origin=event.origin;item.expiresAt=now+(type==='smoke'?Math.min(20000,(event.duration||18)*1000):type==='flash'?250:1500);
  }
 }
 related(p,item){return item.team===p.team&&item.site===p.botAI?.site&&(item.lane==null||p.botAI?.lane==null||item.lane===p.botAI.lane);}
 coverPending(p){this.prune();return [...this.items.values()].some(item=>this.related(p,item)&&item.weapon==='smokegrenade'&&item.effectAt===null);}
 entryHold(p){this.prune();return [...this.items.values()].some(item=>this.related(p,item)&&(['smokegrenade','flashbang'].includes(item.weapon))&&(item.effectAt===null||item.weapon==='flashbang'&&this.clock()-item.effectAt<200));}
 canPrime(p,weapon){return weapon!=='flashbang'||!this.coverPending(p);}
}

export function canWatchBomb(player, snapshot) {
  const bomb=snapshot?.bomb;
  return !!player && player.alive===false && snapshot?.mode==='defuse'
    && ['live','ended','matchEnded'].includes(snapshot.round?.phase)
    && ['planted','exploded','defused'].includes(bomb?.state)
    && [bomb.x,bomb.y,bomb.z].every(Number.isFinite)
    && !snapshot.players?.some(p=>p.team===player.team && p.alive);
}

/** Death stays inside the match. Only a player's explicit menu action unlocks the mouse. */
export class MatchView {
  constructor() { this.reset(); }
  reset() { this.wasAlive = null; this.diedAt = 0; this.targetId = null; this.deathPose=null; this.bombPose=null; }
  update(player, snapshot, now) {
    const died = !!player && !player.alive && this.wasAlive === true;
    const respawned = !!player?.alive && this.wasAlive === false;
    if (died || (player && !player.alive && this.wasAlive === null)) {
      this.diedAt = now;
      const event=[...(snapshot?.events||[])].reverse().find(e=>e.type==='kill'&&e.victimId===player.id);
      const killer=snapshot?.players?.find(p=>p.id===event?.killerId&&p.id!==player.id);
      const dx=killer?killer.x-player.x:0,dz=killer?killer.z-player.z:0;
      const yaw=killer?Math.atan2(-dx,-dz):player.yaw;
      this.deathPose={x:player.x,y:player.y,z:player.z,startYaw:player.yaw,startPitch:player.pitch,yaw,pitch:killer?Math.atan2(killer.y+1.35-(player.y+.65),Math.max(.1,Math.hypot(dx,dz))):.12};
    }
    if (player?.alive) { this.targetId = null; this.deathPose=null; this.bombPose=null; }
    this.wasAlive = player?.alive ?? null;
    const candidates = this.candidates(player, snapshot);
    if (!candidates.some(p => p.id === this.targetId)) this.targetId = candidates[0]?.id ?? null;
    return { died, respawned, spectating: this.spectating(player, snapshot, now) };
  }
  deathCamera(now){
    const pose=this.deathPose;if(!pose)return null;
    const t=Math.max(0,Math.min(1,(now-this.diedAt)/850)),ease=1-(1-t)**3;
    const delta=Math.atan2(Math.sin(pose.yaw-pose.startYaw),Math.cos(pose.yaw-pose.startYaw));
    return {x:pose.x,y:pose.y+1.62-ease*.97,z:pose.z,yaw:pose.startYaw+delta*ease,pitch:pose.startPitch+(pose.pitch-pose.startPitch)*ease,roll:.09*ease};
  }
  bombCamera(player,snapshot,now,raycast=()=>Infinity){
    if(!canWatchBomb(player,snapshot)){this.bombPose=null;return null;}
    if(now-this.diedAt<1500)return null;
    const bomb=snapshot.bomb,key=JSON.stringify([snapshot.round.number,bomb.plantedAt,bomb.x,bomb.y,bomb.z]);
    if(this.bombPose?.key===key)return this.bombPose;
    const target={x:bomb.x,y:bomb.y+.32,z:bomb.z};
    let best=null;
    // Cast out from the bomb so the camera cannot cross a wall to reach its viewpoint.
    for(const offset of [{x:3,y:2.6,z:3},{x:-3,y:2.6,z:3},{x:-3,y:2.6,z:-3},{x:3,y:2.6,z:-3},{x:0,y:4,z:0}]){
      const length=Math.hypot(offset.x,offset.y,offset.z),direction={x:offset.x/length,y:offset.y/length,z:offset.z/length};
      const hit=raycast(target,direction,length),distance=Math.max(0,Math.min(length,Number.isFinite(hit)?hit-.25:length));
      if(best&&distance<=best.distance)continue;
      const x=target.x+direction.x*distance,y=target.y+direction.y*distance,z=target.z+direction.z*distance;
      best={key,x,y,z,yaw:Math.atan2(x-target.x,z-target.z),pitch:Math.atan2(target.y-y,Math.max(.001,Math.hypot(x-target.x,z-target.z))),roll:0,distance};
    }
    this.bombPose=best;return best;
  }
  candidates(player, snapshot) {
    if (!player || player.alive || snapshot?.mode !== 'defuse') return [];
    return snapshot.players.filter(p => p.id !== player.id && p.team === player.team && p.alive);
  }
  spectating(player, snapshot, now) {
    if (now - this.diedAt < 1500) return null;
    return this.candidates(player, snapshot).find(p => p.id === this.targetId) ?? null;
  }
  takeoverTarget(player,snapshot,now){
    if(snapshot?.round?.phase!=='live'||snapshot.match?.status==='ended')return null;
    const target=this.spectating(player,snapshot,now);
    return target?.bot&&!target.controllerId?target:null;
  }
  cycle(player, snapshot, direction = 1) {
    const candidates = this.candidates(player, snapshot);
    if (!candidates.length) return;
    const index = Math.max(0, candidates.findIndex(p => p.id === this.targetId));
    this.targetId = candidates[(index + direction + candidates.length) % candidates.length].id;
  }
}

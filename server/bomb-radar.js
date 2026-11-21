import {eyePosition} from '../shared/aim.js';
import {getWeapon} from '../shared/weapons.js';
import {cs2FovToVertical} from '../shared/cs2-settings.js';
import {angleDifference} from './bot-aim.js';
import {lookAt} from './bot-perception.js';

// Record a stationary C4 position only when a living defender can actually see it.
// Picking it up, a new drop, or changing round invalidates this location.
export function updateBombSpotting(room,now) {
  const b=room.bomb;
  if(!b || (b.state!=='dropped'&&b.state!=='planted')){
    room.bombRadar=null;
    return;
  }
  const previous=room.bombRadar;
  if(previous && previous.bomb===b && previous.state===b.state &&
     previous.x===b.x && previous.y===b.y && previous.z===b.z && previous.spotted)return;
  const intel={bomb:b,state:b.state,x:b.x,y:b.y,z:b.z,spotted:false};
  room.bombRadar=intel;
  const target={x:b.x,y:b.y+.14,z:b.z};
  for(const p of room.players.values()){
    if(p.team!=='CT'||!p.alive||now<(p.flashBlindUntil||0))continue;
    const from=eyePosition(p);
    const angle=lookAt(from,target),fov=getWeapon(p.weapon).zoomFovs[p.zoomLevel||0]||90;
    if(Math.abs(angleDifference(angle.yaw,p.yaw||0))>fov*Math.PI/360 ||
       Math.abs(angle.pitch-(p.pitch||0))>cs2FovToVertical(fov)*Math.PI/360)continue;
    if(room.visibleToBot(from,target)){intel.spotted=true;break;}
  }
}

export function isBombSpotted(room) {
  const b=room.bomb,r=room.bombRadar;
  return !!(r?.spotted&&b&&r.bomb===b&&r.state===b.state&&r.x===b.x&&r.y===b.y&&r.z===b.z);
}

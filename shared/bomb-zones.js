import {BOMB_ZONES} from './bomb-zones-data.js';
import {PLAYER_RADIUS, STAND_HEIGHT, CROUCH_HEIGHT} from './physics.js';

function overlapsBrush(intervals,p,radius,height){
  // Separating axes cover both sets of face normals and each brush-edge/hull-edge cross product.
  const cy=p.y+height/2;
  for(const [nx,ny,nz,min,max] of intervals){
    const center=nx*p.x+ny*cy+nz*p.z;
    const reach=(Math.abs(nx)+Math.abs(nz))*radius+Math.abs(ny)*height/2;
    if(center+reach<min-.0001||center-reach>max+.0001)return false;
  }
  return true;
}

export function bombSiteAt(map,player){
  const source=BOMB_ZONES[map.id];
  if(source&&(map.sourceSha256===source.source||(!map.private&&source.compatibleSourceBuild&&map.sourceBuild===source.compatibleSourceBuild))){
    const height=player.crouch?CROUCH_HEIGHT:STAND_HEIGHT;
    for(const [site,definition] of Object.entries(source.sites)){
      if(definition.hulls.some(hull=>overlapsBrush(hull,player,PLAYER_RADIUS,height)))return site;
    }
    return null;
  }
  return legacyBombSiteAt(map,player);
}

export function legacyBombSiteAt(map,player){
  // Older/custom map metadata can still provide a trigger box or a prototype radius.
  for(const [site,point] of Object.entries(map.sites||{})){
    const b=point.bounds;
    if(b?player.x>=b.min[0]&&player.x<=b.max[0]&&player.z>=b.min[2]&&player.z<=b.max[2]&&
          player.y>=b.min[1]-.2&&player.y<=b.max[1]+.2:
          Math.hypot(player.x-point.x,player.z-point.z)<=point.radius&&Math.abs(player.y-point.y)<3)return site;
  }
  return null;
}

// Project onto the support under the planter. Near a ledge the centre ray may miss
// even though the player's hull is grounded; probe within that same footprint.
export function plantedBombPosition(player,floorAt){
  const reach=PLAYER_RADIUS*.8;
  const offsets=[[0,0],[-reach,0],[reach,0],[0,-reach],[0,reach],[-reach,-reach],[-reach,reach],[reach,-reach],[reach,reach]];
  for(const [dx,dz] of offsets){
    const x=player.x+dx,z=player.z+dz;
    const floor=floorAt(x,z,player.y+.16,.40);
    if(Number.isFinite(floor))return {x,y:floor,z};
  }
  return {x:player.x,y:player.y,z:player.z};
}

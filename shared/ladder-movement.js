import {SOURCE_LADDERS} from './private-map-ladders-data.js';

export const PRIVATE_MOVEMENT_MODEL='source-air-ladders-v2';
export function laddersForMap(map){
  const source=SOURCE_LADDERS[map?.id];
  return source?.source===map?.sourceSha256 ? source.ladders : [];
}
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const climbSpeed=3.25;
// Radius of an axis-aligned horizontal hull projected onto the ladder normal.
function standOffset(rail,radius){
  return radius*(Math.abs(rail.normal[0])+Math.abs(rail.normal[1]))+.035;
}
function railAt(rail,y){
  const t=clamp((y-rail.bottom[1])/(rail.top[1]-rail.bottom[1]),0,1);
  return [rail.bottom[0]+t*(rail.top[0]-rail.bottom[0]),rail.bottom[2]+t*(rail.top[2]-rail.bottom[2])];
}
function offsetOf(p,rail){
  const [x,z]=railAt(rail,p.y),[nx,nz]=rail.normal;
  return {face:(p.x-x)*nx+(p.z-z)*nz,along:-(p.x-x)*nz+(p.z-z)*nx};
}
function detach(p){
  p.ladderId=0;p.ladderExit=0;p.ladderCooldown=.22;
}
function selectLanding(rail,io,height){
  const [x,y,z]=rail.top,[nx,nz]=rail.normal,stand=standOffset(rail,io.radius);
  const startX=x+nx*stand,startZ=z+nz*stand;
  // Probe towards the original top NAV portals. Ray height and hull clearance
  // decide whether an actual walkable deck is present, including sideways exits.
  const dirs=rail.exits.map(e=>[e[0]-startX,e[2]-startZ]);
  dirs.push([-nx,-nz],[-nz,nx],[nz,-nx],[nx,nz]);
  let best=null,score=Infinity;
  for(const [dx,dz] of dirs){
    const len=Math.hypot(dx,dz);if(len<.01)continue;
    for(const distance of [.44,.68,.90,1.20,1.50]){
      const px=startX+dx/len*distance,pz=startZ+dz/len*distance;
      const floor=io.floor(px,pz,y+.54,1.08);
      if(floor===null||!io.clear({x:px,y:floor+.025,z:pz},height))continue;
      const crossY=Math.max(y,floor)+.08;
      let clear=true;
      for(let step=.10;step<distance;step+=.10){
        if(!io.clear({x:startX+dx/len*step,y:crossY,z:startZ+dz/len*step},height)){clear=false;break;}
      }
      if(!clear)continue;
      const navDist=Math.min(2,...rail.exits.map(e=>Math.hypot(px-e[0],pz-e[2])));
      const cost=Math.abs(floor-y)*5+distance*.7+navDist;
      if(cost<score){score=cost;best={x:px,y:floor,z:pz,crossY};}
    }
  }
  return best;
}
function nearestRail(p,input,rails,mx,mz,radius){
  let best=null,score=Infinity;
  for(const rail of rails){
    const {face,along}=offsetOf(p,rail),stand=standOffset(rail,radius);
    const top=p.y>=rail.top[1]-.18;
    const down=(input.forward||0)*(p.pitch<-.35?-1:1)<-.15;
    if(p.y+p.height*.75<rail.bottom[1]||p.y>rail.top[1]+.45||Math.abs(along)>rail.width/2+radius*.65)continue;
    if(top&&down){
      if(face<-.25||face>stand+.55)continue;
    }else{
      if(top||face<.02||face>stand+.22||-mx*rail.normal[0]-mz*rail.normal[1]<.28)continue;
    }
    const rank=Math.abs(face-stand)+Math.abs(along)*.25;
    if(rank<score){score=rank;best=rail;}
  }
  return best;
}

/** Runs on the same input clock for authority, prediction and replay. */
export function stepLadder(p,input,dt,rails,io,mx,mz){
  p.ladderCooldown=Math.max(0,(p.ladderCooldown||0)-dt);
  if(!rails.length||p.ladderCooldown)return false;
  let rail=p.ladderId?rails.find(r=>r.id===p.ladderId):null;
  if(!rail){
    if(p.jumpBufferRemaining>0)return false;
    rail=nearestRail(p,input,rails,mx,mz,io.radius);
    if(!rail)return false;
    p.ladderId=rail.id;p.ladderExit=p.y>=rail.top[1]-.18?-1:0;
  }
  const [nx,nz]=rail.normal,stand=standOffset(rail,io.radius);
  if(p.jumpBufferRemaining>0){
    detach(p);p.jumpBufferRemaining=0;p.grounded=false;
    p.vx=nx*3;p.vz=nz*3;p.vy=3.2;return false;
  }
  const move=(dx,dy,dz)=>{
    p.vx=dx/dt;p.vy=dy/dt;p.vz=dz/dt;
    io.move(p,dx,dy,dz);p.grounded=false;
  };
  const amount=clamp(input.forward||0,-1,1)*(p.pitch<-.35?-1:1);
  if(!amount&&!input.right){p.vx=p.vy=p.vz=0;p.grounded=false;return true;}
  if(p.ladderExit===-1&&amount<0){
    // Step off the upper lip before dropping. Starting down immediately pins the hull
    // to the deck, especially on Mirage's ladder whose landing is on the left.
    const dx=rail.top[0]+nx*stand-p.x,dz=rail.top[2]+nz*stand-p.z;
    const d=Math.hypot(dx,dz),f=d?Math.min(1,climbSpeed*dt/d):0;
    move(dx*f,clamp(rail.top[1]+.055-p.y,-climbSpeed*dt,climbSpeed*dt),dz*f);
    if(d<.075)p.ladderExit=0;
    return true;
  }
  const {along}=offsetOf(p,rail);
  const side=clamp((input.right||0)*(Math.cos(p.yaw)*-nz-Math.sin(p.yaw)*nx),-1,1);
  const targetY=p.y+amount*climbSpeed*dt;
  if(amount>0&&(p.ladderExit===1||targetY>=rail.top[1]-.02)){
    // A stacked ladder at an intermediate deck can continue on the same face.
    const next=rails.find(r=>r!==rail&&r.bottom[1]>rail.bottom[1]+.5&&
      Math.abs(r.bottom[1]-rail.top[1])<.45&&Math.hypot(r.bottom[0]-rail.top[0],r.bottom[2]-rail.top[2])<.18&&
      r.normal[0]*nx+r.normal[1]*nz>.95);
    if(next&&p.pitch>.3){p.ladderId=next.id;return stepLadder(p,input,dt,rails,io,mx,mz);}
    const key=rail.id+'@'+p.height+'@'+(io.collisionKey?.()||'');
    if(!io.landings.has(key))io.landings.set(key,selectLanding(rail,io,p.height));
    const exit=io.landings.get(key);
    if(exit){
      const dy=clamp(exit.crossY-p.y,-climbSpeed*dt,climbSpeed*dt);
      const dx=exit.x-p.x,dz=exit.z-p.z,d=Math.hypot(dx,dz);
      const f=p.y>exit.y+.015&&d>0?Math.min(1,climbSpeed*dt/d):0;
      p.ladderExit=1;move(dx*f,dy,dz*f);
      if(Math.hypot(exit.x-p.x,exit.z-p.z)<.08&&p.y>=exit.y-.02){
        detach(p);p.vx=p.vz=p.vy=0;
      }
      return true;
    }
  }
  p.ladderExit=0;
  const y=Math.min(targetY,rail.top[1]+.06);
  const [x,z]=railAt(rail,y),lateral=along+side*2.5*dt;
  const dx=x+nx*stand-nz*lateral-p.x,dz=z+nz*stand+nx*lateral-p.z;
  const length=Math.hypot(dx,dz),f=length?Math.min(1,climbSpeed*dt/length):0;
  move(dx*f,y-p.y,dz*f);
  if(Math.abs(lateral)>rail.width/2+io.radius*.65||
    amount<0&&p.y<=rail.bottom[1]+.12){detach(p);p.vy=Math.min(0,p.vy);}
  return true;
}

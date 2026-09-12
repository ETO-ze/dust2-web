const point=p=>({x:p.x,y:p.y,z:p.z});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export class DroppedWeapons {
  constructor({clock=()=>Date.now(),raycastWorld=()=>null,maxItems=64,lifetimeSeconds=120}={}){this.clock=clock;this.raycastWorld=raycastWorld;this.maxItems=maxItems;this.lifetimeSeconds=lifetimeSeconds;this.items=[];this.serial=0;}
  clear(){this.items.length=0;}
  drop(player,item){
    const dir={x:-Math.sin(player.yaw||0),y:0,z:-Math.cos(player.yaw||0)},origin={x:player.x,y:player.y+1,z:player.z};
    const hit=this.raycastWorld(origin,dir,.7),offset=hit===null?.6:Math.max(0,hit-.1);
    const dropped={id:`drop_${++this.serial}`,...item,ownerId:player.id,droppedAt:this.clock(),x:origin.x+dir.x*offset,y:origin.y,z:origin.z+dir.z*offset,yaw:player.yaw||0,vx:dir.x*1.8,vy:1.1,vz:dir.z*1.8,expiresAt:this.clock()+this.lifetimeSeconds*1000};
    this.items.push(dropped);while(this.items.length>this.maxItems)this.items.shift();return dropped;
  }
  take(id){const index=this.items.findIndex(item=>item.id===id);return index<0?null:this.items.splice(index,1)[0];}
  candidate(player){
    const origin={x:player.x,y:player.y+(player.crouch?.95:1.6),z:player.z},c=Math.cos(player.pitch||0),facing={x:-Math.sin(player.yaw||0)*c,y:Math.sin(player.pitch||0),z:-Math.cos(player.yaw||0)*c};
    const candidates=this.items.filter(item=>{
      const d=distance(origin,item);if(item.expiresAt<=this.clock()||d>2.8)return false;
      const dir={x:(item.x-origin.x)/Math.max(.001,d),y:(item.y-origin.y)/Math.max(.001,d),z:(item.z-origin.z)/Math.max(.001,d)};
      if(Math.hypot(item.x-player.x,item.z-player.z)>.9&&dir.x*facing.x+dir.y*facing.y+dir.z*facing.z<.55)return false;
      const hit=this.raycastWorld(origin,dir,d);return hit===null||hit>=d-.12;
    });
    candidates.sort((a,b)=>distance(origin,a)-distance(origin,b));return candidates[0]||null;
  }
  autoCandidate(player,hasSlot,slotOf){
    const now=this.clock(),origin={x:player.x,y:player.y+.75,z:player.z};
    return this.items.filter(item=>{
      if(item.expiresAt<=now||now-item.droppedAt<350||item.ownerId===player.id&&now-item.droppedAt<1500||hasSlot(slotOf(item.weaponId)))return false;
      const d=distance(origin,item);if(d>1.25||Math.abs(item.y-player.y)>1.5)return false;
      const dir={x:(item.x-origin.x)/Math.max(d,.001),y:(item.y-origin.y)/Math.max(d,.001),z:(item.z-origin.z)/Math.max(d,.001)};
      const hit=this.raycastWorld(origin,dir,d);return hit===null||hit>=d-.12;
    }).sort((a,b)=>distance(origin,a)-distance(origin,b))[0]||null;
  }
  tick(dt){
    this.items=this.items.filter(item=>item.expiresAt>this.clock()&&Number.isFinite(item.x+item.y+item.z)&&item.y> -250);
    for(const item of this.items){
      let remain=Math.max(0,Math.min(.25,dt));
      while(remain>1e-8){const step=Math.min(remain,1/120);remain-=step;item.vy-=9.8*step;
        for(const axis of ['x','y','z']){const velocity='v'+axis,travel=item[velocity]*step;if(Math.abs(travel)<1e-8)continue;const direction={x:0,y:0,z:0};direction[axis]=Math.sign(travel);const hit=this.raycastWorld(item,direction,Math.abs(travel)+.08);
          if(hit!==null&&hit<=Math.abs(travel)+.08){item[axis]+=Math.sign(travel)*Math.max(0,hit-.08);item[velocity]=0;if(axis==='y'){item.vx*=.8;item.vz*=.8;}}else item[axis]+=travel;
        }
      }
    }
  }
  snapshot(){return this.items.map(({id,weaponId,skinId,ammo,reserve,yaw,expiresAt,...position})=>({id,weaponId,skinId,ammo,reserve,yaw,...point(position),remaining:Math.max(0,(expiresAt-this.clock())/1000)}));}
}

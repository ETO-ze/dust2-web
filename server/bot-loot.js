import {getWeapon} from '../shared/weapons.js';
import {eyePosition} from '../shared/aim.js';
import {floorHeight} from '../shared/physics.js';
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const ranks={awp:100,scar20:85,g3sg1:85,ak47:85,m4a1:85,m4a4:85,sg553:80,aug:80,galilar:65,famas:65,ssg08:60,mp9:45,mac10:45,mp7:40,bizon:35,nova:30,mag7:35,xm1014:40,sawedoff:25,deagle:28,tec9:22,fiveseven:22,p250:20,elite:16,usp:15,pistol:12};
const current=(p,slot)=>Object.keys(p.inventory).find(id=>getWeapon(id).slot===slot);
export function shouldLoot(p,item){
 const gun=getWeapon(item.weaponId),old=current(p,gun.slot);if(![1,2].includes(gun.slot)||item.ammo+item.reserve<=0)return false;if(!old)return true;
 if(old===item.weaponId)return (p.inventory[old].ammo+p.inventory[old].reserve)<3&&item.ammo+item.reserve>=10;
 return (ranks[item.weaponId]||10)>=(ranks[old]||10)+10;
}
export function lootGoal(room,p){
 const ai=p.botAI,now=room.clock();if(!p.alive||p.controllerId||ai.engaging||ai.utility||p.objectiveLocked||ai.role==='defuser'||p.hasBomb&&room.siteAt(p))return null;
 const failures=ai.lootFailures||=new Map();
 let item=room.droppedWeapons.items.find(i=>i.id===ai.lootId);
 if(!item){ai.lootId=null;ai.lootPath=[];}
 if(item&&(!shouldLoot(p,item)||now>(ai.lootUntil||0)||range(p,item)>20)){failures.set(item.id,now+12000);ai.lootId=null;item=null;}
 if(!item&&now>=(ai.nextLootAt||0)){
  ai.nextLootAt=now+750;for(const [id,until]of failures)if(until<=now)failures.delete(id);const from=eyePosition(p),max=room.round.phase==='ended'?18:10;
  const candidates=room.droppedWeapons.items.filter(d=>!failures.has(d.id)&&range(p,d)<max&&Math.abs(d.y-p.y)<2&&now-d.droppedAt>350&&!(d.ownerId===p.id&&now-d.droppedAt<2500)&&!(d.intendedFor&&d.intendedFor!==p.id&&now<d.reservedUntil)&&shouldLoot(p,d)&&room.visibleToBot(from,{x:d.x,y:d.y+.12,z:d.z}));
  candidates.sort((a,b)=>(b.id===ai.donationDrop?100:0)+(ranks[b.weaponId]||0)-range(p,b)*3-((a.id===ai.donationDrop?100:0)+(ranks[a.weaponId]||0)-range(p,a)*3));
  for(const d of candidates.slice(0,3)){const y=floorHeight(d.x,d.z,d.y+.25,2);if(y===null)continue;const target={x:d.x,y,z:d.z},path=room.planPath(p,target);if(range(p,d)>1.25&&!path.length)continue;const length=path.reduce((n,v,j)=>n+range(j?path[j-1]:p,v),0);if(length>max*1.8)continue;item=d;ai.lootId=d.id;ai.lootPath=path;ai.lootUntil=now+6500;break;}
 }
 if(!item)return null;
 if(room.pickupWeapon(p,false,item.id)){ai.lootId=null;ai.donationDrop=null;ai.nextLootAt=now+1500;ai.lootCount=(ai.lootCount||0)+1;ai.goal=null;ai.path=[];return null;}
 ai.phase='collect-weapon';while(ai.lootPath?.length&&range(p,ai.lootPath[0])<.7)ai.lootPath.shift();if(ai.lootPath?.length)return ai.lootPath[0];return {x:item.x,y:floorHeight(item.x,item.z,item.y+.25,2)??p.y,z:item.z};
}

import {getWeapon,WEAPONS,normalizeWeapon,canTeamUseWeapon} from '../shared/weapons.js';
const primary=p=>Object.keys(p.inventory).find(id=>getWeapon(id).slot===1);
const fail=message=>({ok:false,message});
export function say(room,id,raw,channel='all',{system=false}={}){
  const p=room.players.get(id);if(!p||!['all','team'].includes(channel)||typeof raw!=='string')return fail('无效的聊天消息。');
  const text=[...raw.normalize('NFC').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,160).join('');
  if(!text)return fail('消息不能为空。');
  const now=room.clock();
  if(!system){
    const state=p.chatRate||={at:now,tokens:3};state.tokens=Math.min(3,state.tokens+(now-state.at)/1800);state.at=now;
    if(state.tokens<1)return fail('消息过于频繁，请稍后再发。');state.tokens--;
  }
  room.emit('chat',{playerId:p.id,name:p.name,team:p.team,bot:p.bot,dead:!p.alive,channel,text,...(channel==='team'?{audienceTeam:p.team}:{})});return {ok:true};
}
export function requestWeapon(room,id,raw){
  const p=room.players.get(id),weapon=normalizeWeapon(raw),gun=WEAPONS[weapon];
  if(!p||!gun||![1,2].includes(gun.slot)||!canTeamUseWeapon(p.team,weapon))return fail('请选择本阵营的枪械。');
  if(room.mode!=='defuse'||!room.buyStatus(p).buyAllowed)return fail('请在购买时间内、己方出生区请求武器。');
  if(room.clock()-(p.requestAt||-Infinity)<4000)return fail('已经请求过，请等待队友回应。');
  const requests=room.weaponRequests||=new Map();const before=requests.get(id);
  if(before?.status==='dropped'&&room.droppedWeapons.items.some(d=>d.id===before.dropId))return fail('队友已经发枪，请先拾取。');
  p.requestAt=room.clock();requests.set(id,{playerId:id,name:p.name,team:p.team,weapon,round:room.round.number,at:room.clock(),status:'waiting'});
  say(room,id,`需要一把 ${gun.name}，谁能发枪？`,'team',{system:true});return {ok:true,weapon};
}
export function donateWeapon(room,donorId,recipientId,raw){
  const donor=room.players.get(donorId),receiver=room.players.get(recipientId),request=room.weaponRequests?.get(recipientId),weapon=normalizeWeapon(raw),gun=WEAPONS[weapon];
  if(!donor||recipientId&&(!receiver||donor===receiver||donor.team!==receiver.team)||!gun||![1,2].includes(gun.slot)||!canTeamUseWeapon(donor.team,weapon))return fail('只能给本队队友发放本阵营枪械。');
  if(room.mode!=='defuse'||!room.buyStatus(donor).buyAllowed||receiver&&!room.buyStatus(receiver).buyAllowed)return fail('双方需要存活并在购买区内。');
  if(receiver&&(!request||request.round!==room.round.number||request.team!==receiver.team||request.status!=='waiting'||request.weapon!==weapon))return fail('这个请求已失效。');
  if(donor.money<gun.price)return fail('余额不足。');
  if(receiver&&Math.hypot(donor.x-receiver.x,donor.z-receiver.z)>12)return fail('请靠近请求发枪的队友。');
  if(room.clock()-(donor.donateAt||-Infinity)<250)return fail('发枪过于频繁。');donor.donateAt=room.clock();donor.money-=gun.price;
  const yaw=receiver?Math.atan2(-(receiver.x-donor.x),-(receiver.z-donor.z)):donor.yaw,drop=room.droppedWeapons.drop({...donor,yaw},{weaponId:weapon,skinId:room.heldSkin(donor,weapon),ammo:gun.magazine,reserve:gun.reserve});
  if(receiver){const distance=Math.hypot(receiver.x-drop.x,receiver.z-drop.z),speed=Math.min(7,distance/0.55);
  drop.vx=-Math.sin(yaw)*speed;drop.vz=-Math.cos(yaw)*speed;drop.intendedFor=receiver.id;drop.reservedUntil=room.clock()+7000;
  request.status='dropped';request.dropId=drop.id;receiver.botAI.donationDrop=drop.id;}
  room.emit('weapon_dropped',{playerId:donor.id,droppedId:drop.id,weaponId:weapon,skinId:drop.skinId,death:false});
  say(room,donorId,receiver?`${receiver.name}，给你 ${gun.name}，在地上。`:`给队友发了一把 ${gun.name}，在地上。`,'team',{system:true});
  return {ok:true,weapon,money:donor.money,droppedId:drop.id};
}
export function botSharing(room){
  if(room.mode!=='defuse'||!['freeze','live'].includes(room.round.phase)||room.clock()>room.round.buyEndsAt)return;
  for(const p of room.players.values()){
    if(!p.bot||p.controllerId||!p.alive||!room.buyStatus(p).buyAllowed)continue;
    const plan=room.teamBuys?.[p.team]?.kind;
    if(!primary(p)&&['full','force'].includes(plan)&&p.botAI.requestedRound!==room.round.number){p.botAI.requestedRound=room.round.number;requestWeapon(room,p.id,p.team==='T'?'ak47':'m4a1');}
  }
  for(const request of room.weaponRequests?.values()||[]){
    if(request.status!=='waiting'||request.round!==room.round.number)continue;
    const receiver=room.players.get(request.playerId);if(!receiver?.alive||receiver.team!==request.team||receiver.bot&&primary(receiver)){request.status='cancelled';continue;}
    const donor=[...room.players.values()].filter(p=>p.bot&&!p.controllerId&&p.id!==request.playerId&&p.team===request.team&&p.alive&&primary(p)&&p.armor>=80&&p.money>=getWeapon(request.weapon).price+500).sort((a,b)=>b.money-a.money)[0];
    if(donor)donateWeapon(room,donor.id,request.playerId,request.weapon);
  }
}

export function privateRequests(room){
  return [...(room.weaponRequests?.values()||[])].filter(r=>r.round===room.round.number&&r.status==='waiting'&&room.players.get(r.playerId)?.alive&&room.players.get(r.playerId)?.team===r.team).map(({playerId,name,team,weapon,status})=>({playerId,name,team,weapon,status}));
}

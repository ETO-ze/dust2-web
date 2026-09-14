import {getWeapon} from '../shared/weapons.js';
import {EQUIPMENT,equipmentPrice} from '../shared/equipment.js';
import {MAP} from '../shared/map-data.js';

export const BUY_LABELS=Object.freeze({pistol:'手枪局',full:'全起',force:'强起',half:'半起',eco:'ECO'});
const primary=p=>Object.keys(p.inventory||{}).find(id=>getWeapon(id).slot===1);
const fullTarget=team=>team==='T'?4500:4800;
const retainedValue=p=>(primary(p)?Math.min(2900,getWeapon(primary(p)).price):0)+(p.armor>=80?650:0)+(p.helmet?350:0);
export const lossIncome=(room,team)=>1400+500*Math.min(4,Math.max(0,room.lossLevels?.[room.teamForSide(team)]??1));
export function lastInvestmentRound(room,team){
  const played=room.match.roundsPlayed||0,opponent=team==='T'?'CT':'T';
  return room.scores[opponent]>=(room.match.winTarget||13)-1||(played<24?(played+1)%12===0:(played-24+1)%3===0);
}
export function planTeamBuy(room,team){
  const players=[...room.players.values()].filter(p=>p.team===team),target=fullTarget(team),income=lossIncome(room,team);
  const affordable=players.filter(p=>p.money+retainedValue(p)>=target).length;
  const armed=players.filter(p=>primary(p)).length;
  const reserves=players.map(p=>Math.max(0,target-retainedValue(p)-income));
  const nextBudgets=players.map((p,i)=>Math.max(0,Math.min(p.money*.55,p.money-reserves[i],1400)));
  let kind=affordable>=Math.ceil(players.length*.8)?'full':lastInvestmentRound(room,team)?'force':armed>=Math.ceil(players.length*.6)?'force':nextBudgets.reduce((a,b)=>a+b,0)/Math.max(1,players.length)>=350?'half':'eco';
  if(room.match.period!=='overtime'&&[1,13].includes(room.round.number))kind='pistol';
  const budgets=Object.fromEntries(players.map((p,i)=>[p.id,Math.floor(['full','force','pistol'].includes(kind)?p.money:kind==='half'?nextBudgets[i]:Math.min(200,nextBudgets[i]))]));
  return {kind,label:BUY_LABELS[kind],round:room.round.number,income,budgets};
}
export function buyForTeam(room){
  room.teamBuys={};
  if(room.mode!=='defuse')return;
  for(const team of ['CT','T']){
    const plan=planTeamBuy(room,team);room.teamBuys[team]=plan;
    const bots=[...room.players.values()].filter(p=>p.bot&&p.team===team).sort((a,b)=>a.seat-b.seat);
    for(const [rank,p]of bots.entries()){
      const floor=p.money-plan.budgets[p.id];p.botAI.buyPlan=plan.kind;
      const buy=id=>{
        const price=EQUIPMENT[id]?equipmentPrice(id,p):getWeapon(id).price;
        return p.money-price>=floor&&room.buy(p.id,id).ok;
      };
      if(plan.kind==='pistol'){
        if(rank===1){if(team==='CT')buy('defusekit');else buy('smokegrenade');buy('flashbang');}else buy('armor');
      }else if(plan.kind==='eco'){
        if(rank===1)buy('flashbang');
      }else{
        if(!primary(p)){
          const allowance=p.money-floor-(p.armor>=80?0:650)-(plan.kind==='full'?500:0);
          const choices=plan.kind==='half'?(team==='T'?['tec9','p250']:['fiveseven','p250']):team==='T'?['ak47','galilar','mac10','tec9','p250']:['m4a1','mp9','fiveseven','p250'];
          if(plan.kind==='full'&&rank===4&&p.money-floor>=6750)buy('awp');
          if(!primary(p))for(const id of choices)if(getWeapon(id).price<=allowance&&buy(id))break;
        }
        if(p.armor<80)buy('armor');
        if(plan.kind==='full'||plan.kind==='force')buy('helmet');
        if(team==='CT'&&plan.kind!=='half'&&[...room.players.values()].filter(q=>q.team==='CT'&&q.defuseKit).length<2)buy('defusekit');
        for(const id of ['smokegrenade','flashbang',team==='T'?'molotov':'incgrenade','hegrenade'])buy(id);
      }
      room.selectSlot(p,primary(p)?1:2);p.input.slot=p.slot;
    }
  }
}
export function settleEconomy(room,winner,reason){
  room.lossLevels||={A:1,B:1};
  const objective=['exploded','defused'].includes(room.bomb.state),win=objective?3500:3250;
  for(const p of room.players.values()){
    const lost=p.team!==winner,timeout=lost&&p.team==='T'&&p.alive&&reason==='回合时间耗尽';
    const income=!lost?win:timeout?0:lossIncome(room,p.team)+(p.team==='T'&&room.bomb.plantedAt?800:0);
    p.money=Math.min(16000,p.money+income);p.roundIncome=income;
  }
  for(const [id,side]of Object.entries(room.teamSides))room.lossLevels[id]=Math.max(0,Math.min(4,room.lossLevels[id]+(side===winner?-1:1)));
}
export function saveGoal(room,p){
  if(p.team!=='CT'||room.bomb.state!=='planted'||!primary(p)||getWeapon(primary(p)).price<1700)return null;
  const bomb=room.bomb,now=room.clock(),distance=Math.hypot(p.x-bomb.x,p.z-bomb.z),remaining=(bomb.explodesAt-now)/1000;
  if(bomb.action==='defuse'&&bomb.actorId)return null;
  const living=[...room.players.values()].filter(q=>q.alive),allies=living.filter(q=>q.team===p.team).length,enemies=living.length-allies;
  const impossible=remaining<distance/6.35+(p.defuseKit?room.rules.defuseKitSeconds:room.rules.defuseSeconds)+1;
  const hopeless=allies<=2&&enemies>=allies+2&&remaining<25&&distance>14&&!lastInvestmentRound(room,p.team);
  if(!impossible&&!hopeless)return null;
  if(p.botAI.saveGoal)return p.botAI.saveGoal;
  // Alive counts and the planted bomb are public; cover avoids only fresh seen contacts.
  const sightings=[...(room.teamSightings?.CT?.values()||[])].filter(s=>now-s.at<6000);
  const candidates=[...(MAP.spawns.CT||[]),...(MAP.spawns.T||[])].map(s=>room.nearestNav(s)||s).filter(s=>Math.hypot(s.x-bomb.x,s.z-bomb.z)>35&&!sightings.some(e=>Math.hypot(s.x-e.x,s.z-e.z)<12));
  candidates.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));
  const chosen=candidates[0];return chosen?(p.botAI.saveGoal={x:chosen.x,y:chosen.y,z:chosen.z}):null;
}

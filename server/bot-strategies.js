import {getWeapon} from '../shared/weapons.js';

// Tactical families adapted from the Dignitas Dust2 default/utility guides.
// Stand points and throws are validated against this game's navigation/physics.
export const ATTACK_STRATEGIES=Object.freeze([
  {id:'a-short',name:'A 小集结爆弹',site:'A',lanes:['short','short','short','short','long'],tempo:'execute'},
  {id:'a-split',name:'A 大小同步夹击',site:'A',lanes:['long','long','long','short','short'],tempo:'execute'},
  {id:'a-long',name:'A 大抢控提速',site:'A',lanes:['long','long','long','long','short'],tempo:'fast'},
  {id:'b-execute',name:'B 洞烟闪进点',site:'B',lanes:['tunnels','tunnels','tunnels','tunnels','mid'],tempo:'execute'},
  {id:'b-split',name:'中路转 B 夹击',site:'B',lanes:['mid','mid','mid','tunnels','tunnels'],tempo:'execute'},
  {id:'b-contact',name:'B 洞静步接触',site:'B',lanes:['tunnels','tunnels','tunnels','tunnels','mid'],tempo:'contact'},
  {id:'map-default',name:'分散控图后转点',site:null,lanes:['long','long','mid','tunnels','tunnels'],tempo:'default'},
  {id:'fake-a-b',name:'佯攻 A 转 B',site:'B',lanes:['tunnels','tunnels','tunnels','long','short'],tempo:'fake'},
]);
export const DEFENSE_STRATEGIES=Object.freeze([
  {id:'balanced',roles:['anchor-b','anchor-a','short','mid','rotator']},
  {id:'long-control',roles:['anchor-b','anchor-a','long','long','mid']},
  {id:'b-lean',roles:['anchor-b','anchor-a','anchor-b','short','mid']},
  {id:'mid-pressure',roles:['anchor-b','anchor-a','mid','short','rotator']},
]);
const random=room=>Math.max(0,Math.min(.999999,(room.strategyRandom||Math.random)()));
const start=room=>room.round.liveStartedAt||(room.round.phase==='freeze'?room.round.phaseEndsAt:room.clock());
function choose(room,choices,history,weight=()=>1){
  const recent=new Set(history.slice(-2).map(p=>p.id)),pool=choices.filter(p=>!recent.has(p.id));
  const candidates=pool.length?pool:choices;let draw=random(room)*candidates.reduce((n,p)=>n+weight(p),0);
  return candidates.find(p=>(draw-=weight(p))<0)||candidates.at(-1);
}
export function attackPlan(room){
  if(room.attackPlan?.round===room.round.number)return room.attackPlan;
  const roster=[...room.players.values()].filter(p=>p.team==='T'),rich=roster.filter(p=>Object.keys(p.inventory||{}).some(id=>getWeapon(id).slot===1)).length;
  const history=room.strategyHistory||=[],lowBuy=rich<Math.ceil(roster.length/2);
  const selected=choose(room,ATTACK_STRATEGIES,history,p=>lowBuy&&['a-short','b-contact','a-long'].includes(p.id)?1.7:1);
  const began=start(room),plan={...selected,round:room.round.number,coordinated:room.botDifficulty==='hard',startAt:began,
    offset:Math.floor(random(room)*5),holdOffset:Math.floor(random(room)*4),decisionAt:began+10000+random(room)*6000,
    fakeUntil:began+21000+random(room)*6000,committedSite:selected.site};
  room.strategyHistory=[...history,{round:plan.round,id:plan.id}].slice(-6);return room.attackPlan=plan;
}
export function defensePlan(room){
  if(room.defensePlan?.round===room.round.number)return room.defensePlan;
  const history=room.defenseHistory||[],selected=choose(room,DEFENSE_STRATEGIES,history),plan={...selected,round:room.round.number,
    offset:Math.floor(random(room)*5),holdOffset:Math.floor(random(room)*4),pressureUntil:start(room)+10000+random(room)*6000};
  room.defenseHistory=[...history,{round:plan.round,id:plan.id}].slice(-4);return room.defensePlan=plan;
}
export function attackLane(plan,rank,carrier=false){
  // The carrier never takes a solo diversion or a mid-to-B flank.
  const lane=plan.lanes[(rank+plan.offset)%plan.lanes.length];
  return carrier?(plan.committedSite==='B'?'tunnels':plan.committedSite==='A'?(plan.id==='a-short'?'short':'long'):'mid'):lane;
}

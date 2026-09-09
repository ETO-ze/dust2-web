// Stable, allowlisted appearance IDs. Rendering metadata never changes gameplay.
export const AGENT_CATALOG = Object.freeze([
  {id:'ct-sas',team:'CT',name:'默认反恐精英 · SAS',englishName:'SAS',isDefault:true,model:'assets/characters-cs2/ct-sas.glb'},
  {id:'t-phoenix',team:'T',name:'默认恐怖分子 · 凤凰战士',englishName:'Phoenix',isDefault:true,model:'assets/characters-cs2/t-phoenix.glb'},
  {id:'ct-ava',team:'CT',name:'特别探员艾娃 · 联邦调查局',englishName:'Special Agent Ava | FBI',isDefault:false,model:'assets/characters-cs2/optional/ct-ava.glb'},
  {id:'t-miami',team:'T',name:'迈阿密达里尔爵士 · 专业人士',englishName:'Sir Bloody Miami Darryl | The Professionals',isDefault:false,model:'assets/characters-cs2/optional/t-miami.glb'},
].map(agent=>Object.freeze(agent)));
export const DEFAULT_AGENT_IDS = Object.freeze(Object.fromEntries(AGENT_CATALOG.filter(agent=>agent.isDefault).map(agent=>[agent.team,agent.id])));
const byId=new Map(AGENT_CATALOG.map(agent=>[agent.id,agent]));
export function getAgent(id){return typeof id==='string'?byId.get(id):undefined;}
export function normalizeAgentLoadout(input={}){
  const value=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  return Object.fromEntries(Object.entries(DEFAULT_AGENT_IDS).map(([team,fallback])=>{
    const agent=getAgent(value[team]);return [team,agent?.team===team?agent.id:fallback];
  }));
}

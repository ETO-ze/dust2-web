// MR12 derives from Valve's competitive cfg; repeat MR3 is this room's tie policy.
export const MATCH_RULES = Object.freeze({ regulationHalfRounds:12, regulationWinTarget:13,
  overtimeHalfRounds:3, overtimeStartMoney:10000, deathmatchWinTarget:100 });
export const TEAM_IDS=Object.freeze(['A','B']);
export const oppositeSide=side=>side==='CT'?'T':'CT';

/** Room modes: id is stored on the room; ruleset drives bomb rounds vs deathmatch / debug / utility. */
export const GAME_MODES = Object.freeze({
  defuse: Object.freeze({ id:'defuse', ruleset:'defuse', maxPlayers:10, teamSize:5, maxBots:9, label:'竞技爆破', shortLabel:'经典爆破' }),
  deathmatch: Object.freeze({ id:'deathmatch', ruleset:'deathmatch', maxPlayers:10, teamSize:5, maxBots:9, label:'团队死斗', shortLabel:'团队死斗' }),
  debug: Object.freeze({ id:'debug', ruleset:'debug', maxPlayers:1, teamSize:1, maxBots:0, label:'调试模式', shortLabel:'调试' }),
  utility: Object.freeze({ id:'utility', ruleset:'utility', maxPlayers:1, teamSize:5, maxBots:2, label:'道具练习', shortLabel:'道具' }),
});

export function normalizeMode(mode){return Object.hasOwn(GAME_MODES,mode)?mode:'defuse';}
export function modeConfig(mode){return GAME_MODES[normalizeMode(mode)];}
export function isBombMode(mode){return modeConfig(mode).ruleset==='defuse';}
export function isDeathmatchMode(mode){return modeConfig(mode).ruleset==='deathmatch';}
export function isDebugMode(mode){return modeConfig(mode).ruleset==='debug';}
export function isUtilityMode(mode){return modeConfig(mode).ruleset==='utility';}
/** Free-buy sandbox (deathmatch + solo debug + utility practice). */
export function isSandboxMode(mode){const r=modeConfig(mode).ruleset;return r==='deathmatch'||r==='debug'||r==='utility';}
export function botCount(value,fallback=6,maxBots=9){return Number.isInteger(value)&&value>=0&&value<=maxBots?value:fallback;}

/** Decisions apply between rounds. Scores belong to teams, never their current side. */
export function defuseDecision(scores,roundsPlayed){
  const base={period:'regulation',overtimeNumber:0,winTarget:13,winnerTeamId:null,swapSides:false,resetMoney:null};
  if(roundsPlayed<=24){
    const winner=TEAM_IDS.find(id=>scores[id]>=13);
    if(winner)return {...base,winnerTeamId:winner};
    if(roundsPlayed===12)return {...base,swapSides:true,resetMoney:800};
    if(roundsPlayed===24)return {...base,period:'overtime',overtimeNumber:1,winTarget:16,resetMoney:10000};
    return base;
  }
  const block=Math.floor((roundsPlayed-25)/6),target=16+block*3;
  const decision={...base,period:'overtime',overtimeNumber:block+1,winTarget:target};
  const winner=TEAM_IDS.find(id=>scores[id]>=target);
  if(winner)return {...decision,winnerTeamId:winner};
  const inBlock=(roundsPlayed-24)%6;
  if(inBlock===3)return {...decision,swapSides:true,resetMoney:10000};
  if(inBlock===0)return {...decision,overtimeNumber:block+2,winTarget:target+3,swapSides:true,resetMoney:10000};
  return decision;
}

export const grenadeMode=(primary,secondary)=>primary&&secondary?'lob':secondary?'drop':'full';
export const grenadeStrength=mode=>mode==='drop'?0:mode==='lob'?.5:1;

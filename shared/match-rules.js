// MR12 derives from Valve's competitive cfg; repeat MR3 is this room's tie policy.
export const MATCH_RULES = Object.freeze({ regulationHalfRounds:12, regulationWinTarget:13,
  overtimeHalfRounds:3, overtimeStartMoney:10000, deathmatchWinTarget:100 });
export const TEAM_IDS=Object.freeze(['A','B']);
export const oppositeSide=side=>side==='CT'?'T':'CT';
export function botCount(value,fallback=6){return Number.isInteger(value)&&value>=0&&value<=9?value:fallback;}

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

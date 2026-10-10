export const BOT_DIFFICULTIES=Object.freeze(['easy','normal','hard','vitality']);
export const normalizeBotDifficulty=value=>BOT_DIFFICULTIES.includes(value)?value:'normal';
export const botDifficultyName=value=>({easy:'轻松',normal:'普通',hard:'困难',vitality:'挑战 Vitality 全队'})[normalizeBotDifficulty(value)];
// Hard has 1.30x reaction/precision parameters, not 30% extra damage or a
// promised win rate. Angular speed, visual acquisition and settling stay equal.
const normal=Object.freeze({reactionMinMs:390,reactionRangeMs:220,aimErrorScale:.92});
const hard=Object.freeze({reactionMinMs:390/1.3,reactionRangeMs:220/1.3,aimErrorScale:.92/1.3});
const easy=Object.freeze({reactionMinMs:900,reactionRangeMs:420,aimErrorScale:1.8});
const vitality=Object.freeze({reactionMinMs:hard.reactionMinMs/1.1,reactionRangeMs:hard.reactionRangeMs/1.1,aimErrorScale:hard.aimErrorScale/1.1});
export const botSkill=value=>({easy,normal,hard,vitality})[normalizeBotDifficulty(value)];
// Aim-point preference, never a guaranteed headshot percentage.
export const headIntent=value=>({easy:.15,normal:.38,hard:.56,vitality:.56})[normalizeBotDifficulty(value)];
export const comebackScale=value=>normalizeBotDifficulty(value)==='easy'?1:1.5;

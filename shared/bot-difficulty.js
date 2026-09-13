export const BOT_DIFFICULTIES=Object.freeze(['normal','hard']);
export const normalizeBotDifficulty=value=>BOT_DIFFICULTIES.includes(value)?value:'normal';
export const botDifficultyName=value=>normalizeBotDifficulty(value)==='hard'?'困难':'普通';
// Hard has 1.30x reaction/precision parameters, not 30% extra damage or a
// promised win rate. Angular speed, visual acquisition and settling stay equal.
const normal=Object.freeze({reactionMinMs:390,reactionRangeMs:220,aimErrorScale:.92});
const hard=Object.freeze({reactionMinMs:390/1.3,reactionRangeMs:220/1.3,aimErrorScale:.92/1.3});
export const botSkill=value=>normalizeBotDifficulty(value)==='hard'?hard:normal;

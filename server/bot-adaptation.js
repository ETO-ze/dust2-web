import {botSkill} from '../shared/bot-difficulty.js';
import {say} from './team-social.js';
export function adaptAfterRound(room,winner){
 const states=room.botMomentum||={A:{losses:0,wins:0,boosted:false},B:{losses:0,wins:0,boosted:false}};
 for(const [id,side]of Object.entries(room.teamSides)){
  const s=states[id],before=s.boosted;if(side===winner){s.losses=0;s.wins++;if(s.wins>=2)s.boosted=false;}else{s.wins=0;s.losses++;if(s.losses>=2)s.boosted=true;}
  if(s.boosted!==before){const bot=[...room.players.values()].find(p=>p.bot&&p.teamId===id);if(bot)say(room,bot.id,s.boosted?'连续失利：本队人机反应与瞄准精度增强 50%，连续赢 2 回合后恢复。':'连续获胜：本队人机已恢复基础难度。','team',{system:true});}
 }
}
export function effectiveBotSkill(room,p){const skill=botSkill(room.botDifficulty),scale=room.botMomentum?.[p.teamId]?.boosted?1.5:1;return {...skill,reactionMinMs:skill.reactionMinMs/scale,reactionRangeMs:skill.reactionRangeMs/scale,aimErrorScale:skill.aimErrorScale/scale};}

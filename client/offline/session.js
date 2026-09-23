import {GameRoom, TICK_RATE, SNAPSHOT_RATE} from '../../server/game.js';
import {snapshotForSide} from '../../server/snapshot-view.js';
import {PRIMARY_WEAPONS} from '../../shared/weapons.js';
import {normalizeSkinLoadout} from '../../shared/skins.js';
import {normalizeAgentLoadout} from '../../shared/agents.js';
import {normalizeBotDifficulty} from '../../shared/bot-difficulty.js';
import {MatchClock} from './clock.js';

// Same authoritative room and commands as online. No alternate bot/weapon balance.
export class OfflineSession {
  constructor(emit) {
    this.emit = emit;
    this.clock = new MatchClock({tick:dt=>this.room?.tick(dt), snapshot:()=>this.snapshot()});
  }
  join(msg) {
    if(this.room) throw Error('对局已建立');
    const options = {
      name:typeof msg.name==='string'?msg.name.replace(/[\u0000-\u001f\u007f<>]/g,'').trim().slice(0,20)||'Player':'Player',
      mode:msg.mode==='deathmatch'?'deathmatch':'defuse',team:['T','CT'].includes(msg.team)?msg.team:'auto',
      bots:Number.isInteger(msg.bots)?Math.min(9,Math.max(0,msg.bots)):6,
      botDifficulty:normalizeBotDifficulty(msg.botDifficulty),primary:PRIMARY_WEAPONS.includes(msg.primary)?msg.primary:'auto',
      skins:normalizeSkinLoadout(msg.skins),agents:normalizeAgentLoadout(msg.agents),movementProtocol:1,shotProtocol:1,
    };
    this.room = new GameRoom('LOCAL',{...options,clock:()=>this.clock.time});
    const player = this.room.addHuman({readyState:1,bufferedAmount:0,send(){}},options);
    this.playerId=player.id;
    this.emit({type:'welcome',id:player.id,room:'LOCAL',mode:this.room.mode,team:player.team,teamId:player.teamId,
      hostId:this.room.hostId,desiredBots:this.room.desiredBots,botCount:this.room.botCount,botDifficulty:this.room.botDifficulty,
      match:this.room.matchSnapshot(),tickRate:TICK_RATE,snapshotRate:SNAPSHOT_RATE,serverTime:this.clock.time,
      protocol:1,movementProtocol:1,shotProtocol:1});
    this.snapshot(false);
  }
  snapshot(drainEvents=true) {
    if(this.room)this.emit(snapshotForSide(this.room.snapshot({drainEvents}),this.room.players.get(this.playerId)?.team));
  }
  send(msg) {
    if(msg.type==='join') { this.join(msg); return; }
    if(msg.type==='ping') { this.emit({type:'pong',time:msg.time,serverTime:this.clock.time}); return; }
    if(!this.room)return;
    if(msg.type==='input') { if(!this.clock.paused)this.room.receiveInput(this.playerId,msg); return; }
    const commands = {
      chat:['chat',[msg.text,msg.channel],null,'CHAT_REJECTED'],
      buy:['buy',[msg.weapon],'purchase','BUY_REJECTED'],refund:['refund',[msg.weapon],'refund','BUY_REJECTED'],
      dropWeapon:['dropWeapon',[],'weaponDropped','DROP_REJECTED'],
      equipSkin:['equipSkin',[msg.weapon,msg.skin],'skinEquipped','SKIN_REJECTED'],
      equipAgent:['equipAgent',[msg.agent],'agentEquipped','AGENT_REJECTED'],
      takeBot:['takeBot',[typeof msg.botId==='string'?msg.botId:null],'botControl','BOT_CONTROL_REJECTED'],
      takeSeat:['takeSeat',[msg.team,msg.seat],'seatUpdated','SEAT_REJECTED'],
      setSeatBot:['setSeatBot',[msg.team,msg.seat,msg.enabled],'seatUpdated','SEAT_REJECTED'],
      setBots:['setBots',[msg.bots],'botsUpdated','BOTS_REJECTED'],
      setBotDifficulty:['setBotDifficulty',[msg.botDifficulty],'botDifficultyUpdated','BOT_DIFFICULTY_REJECTED'],
      requestWeapon:['requestWeapon',[msg.weapon],'teamGear','TEAM_GEAR_REJECTED'],
      donateWeapon:['donateWeapon',[msg.playerId,msg.weapon],'teamGear','TEAM_GEAR_REJECTED'],
    };
    const command=commands[msg.type]; if(!command)return;
    const [method,args,type,code]=command,result=this.room[method](this.playerId,...args);
    if(!result.ok)this.emit({type:'error',code,message:result.message});
    else if(type)this.emit({type,...result});
    if(this.clock.paused)this.snapshot();
  }
  pause(value) {
    this.clock.pause(value);
    if(value&&this.room)for(const p of this.room.players.values())if(!p.bot||p.controllerId){
      p.input={...p.input,forward:0,right:0,jump:false,fire:false,fire2:false,interact:false,reload:false,cancelGrenade:true};
      p.pendingFire=false;p.pendingInteract=false;p.fireQueue=[];p.inputAt=0;this.room.cancelGrenade(p,'pause');
    }
  }
}

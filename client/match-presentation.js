import { AGENT_ASSETS } from '../shared/agent-assets.js';
import { uiIcon } from './ui-icons.js';
import './match-presentation.css';
import './mvp-panel.css';
import {musicKitLabel} from '../shared/music-kits.js';
import {imageAssetURL} from './image-asset-url.js';

// Original team/weapon icons; transitions are a browser implementation informed
// by Valve's endofmatch-win / hudwinpanel Panorama styles. No game logic here.
function awardContent(panel, mvp, final) {
  panel.hidden=!mvp;
  if(!mvp)return;
  const description={
    plant:'成功引爆 C4',defuse:'成功拆除 C4',eliminations:`本回合消灭 ${mvp.kills} 名对手`,
    roundAwards:`获得 ${mvp.stars} 次回合 MVP · ${mvp.kills} 击杀`,matchKills:`全场 ${mvp.kills} 击杀`,
  };
  panel.querySelector('small').textContent=final?'全场 MVP':'本回合 MVP';
  panel.querySelector('strong').textContent=mvp.name;
  panel.querySelector('.award-reason').textContent=description[mvp.reason]||'';
  const kit=panel.querySelector('.award-music');
  kit.textContent=!final&&mvp.musicKit!=='none'?musicKitLabel(mvp.musicKit):'';
  kit.hidden=!kit.textContent;
}
function awardPanel() {
  const panel=document.createElement('div');
  panel.className='mvp-award';panel.hidden=true;
  panel.innerHTML='<i class="award-star" aria-hidden="true"></i><div><small></small><strong></strong><span class="award-reason"></span><span class="award-music"></span></div>';
  return panel;
}
export class MatchPresentation {
  constructor(container=document.body,{onReturn=()=>{},onEnd=()=>{}}={}){
    this.container=container;this.onEnd=onEnd;this.seen=new Set();this.room=null;
    this.element=document.createElement('div');this.element.id='match-presentation';this.element.hidden=true;
    this.element.innerHTML='<section class="side-swap-panel" hidden aria-live="polite"><div class="swap-label"></div><div class="swap-sides"><div class="swap-old"></div><span class="swap-arrows">⇄</span><div class="swap-new"></div></div><h2>双方换边</h2><p></p><small></small></section><section class="match-result-panel" hidden aria-label="比赛结果"><div class="match-result-backdrop"></div><header><span>DUST II</span><small>比赛结束</small></header><div class="match-result-heading"><div class="match-winner-icon"></div><div class="match-result-score"></div><h1></h1><p></p></div><div class="match-winners"></div><footer><div class="match-personal"></div><button id="match-return-button" type="button">返回大厅 →</button></footer></section>';
    this.swap=this.element.querySelector('.side-swap-panel');this.result=this.element.querySelector('.match-result-panel');
    this.roundPanel=document.createElement('section');
    this.roundPanel.className='round-result-panel';this.roundPanel.hidden=true;
    this.roundPanel.setAttribute('aria-live','polite');
    this.roundPanel.innerHTML='<header><h2></h2><span></span></header>';
    this.roundAward=awardPanel();this.matchAward=awardPanel();
    this.roundPanel.append(this.roundAward);this.element.prepend(this.roundPanel);
    this.result.querySelector('.match-winners').before(this.matchAward);
    this.element.querySelector('#match-return-button').addEventListener('click',onReturn);container.append(this.element);
  }
  update(snapshot,myId){
    if(!snapshot)return;
    if(this.room&&this.room!==snapshot.room)this.reset();this.room=snapshot.room;
    const self=snapshot.players?.find(p=>p.id===myId);
    for(const event of snapshot.events||[])this.handleEvent(event,snapshot,myId);
    if(snapshot.match?.status==='ended'||snapshot.round?.phase==='matchEnded'){this.showResult(snapshot,self);return;}
    const round=snapshot.round;
    if(round?.phase==='ended') {
      const key=[snapshot.room,round.number,round.winner,round.mvp?.id].join('|');
      if(this.roundKey===key)return;
      clearTimeout(this.swapTimer);this.swap.hidden=true;this.roundKey=key;
      this.roundPanel.dataset.team=round.winner||'CT';
      this.roundPanel.querySelector('h2').textContent=round.winner==='T'?'恐怖分子获胜':round.winner==='CT'?'反恐精英获胜':'回合结束';
      this.roundPanel.querySelector('header span').textContent=round.reason||'';
      awardContent(this.roundAward,round.mvp,false);
      this.roundPanel.hidden=false;this.element.hidden=false;
    } else if(!this.roundPanel.hidden) {
      this.roundPanel.hidden=true;this.roundKey=null;this.element.hidden=this.swap.hidden&&this.result.hidden;
    }
  }
  handleEvent(event,snapshot,myId){
    if(!event||!['sides_swapped','match_end'].includes(event.type))return;
    const id=event.id||`${event.type}:${event.time}:${event.round}`;if(this.seen.has(id))return;this.seen.add(id);if(this.seen.size>80)this.seen.delete(this.seen.values().next().value);
    const self=snapshot?.players?.find(p=>p.id===myId);
    if(event.type==='match_end'){this.showResult({...snapshot,match:event.match||snapshot?.match},self);return;}
    if(this.ended)return;
    clearTimeout(this.swapTimer);const teams=event.teams||snapshot?.match?.teams;
    const newSide=teams?.[self?.teamId]?.side||self?.team||'CT',oldSide=newSide==='CT'?'T':'CT';
    this.swap.querySelector('.swap-old').replaceChildren(uiIcon(oldSide));this.swap.querySelector('.swap-new').replaceChildren(uiIcon(newSide));
    this.swap.dataset.team=newSide;this.swap.querySelector('.swap-label').textContent=event.kind==='overtime'?`加时赛 ${event.overtimeNumber||1}`:'中场休息';
    this.swap.querySelector('h2').textContent='双方换边';this.swap.querySelector('p').textContent=`你现在是${newSide==='CT'?'反恐精英 · 防守方':'恐怖分子 · 进攻方'}`;
    this.swap.querySelector('small').textContent=event.kind==='overtime'?'每 3 个加时回合交换阵营':'下半场开始 · 队伍比分保留';
    this.element.hidden=false;this.swap.hidden=false;this.swap.classList.remove('animate');void this.swap.offsetWidth;this.swap.classList.add('animate');
    this.swapTimer=setTimeout(()=>{this.swap.hidden=true;if(!this.ended&&this.roundPanel.hidden)this.element.hidden=true;},4300);
  }
  showResult(snapshot,self){
    const match=snapshot?.match;if(!match)return;
    const ownId=self?.teamId||Object.entries(match.teams||{}).find(([,t])=>t.side===self?.team)?.[0];
    const winner=match.teams?.[match.winnerTeamId];const won=!!ownId&&ownId===match.winnerTeamId;
    const key=JSON.stringify([snapshot.room,match,self?.id]);if(key===this.resultKey)return;this.resultKey=key;
    const first=!this.ended;this.ended=true;clearTimeout(this.swapTimer);this.swap.hidden=true;this.roundPanel.hidden=true;this.element.hidden=false;this.result.hidden=false;
    awardContent(this.matchAward,match.mvp,true);this.result.classList.toggle('has-mvp',!!match.mvp);this.element.classList.add('ended');
    this.result.dataset.result=won?'victory':'defeat';this.result.dataset.team=winner?.side||'CT';
    this.result.querySelector('.match-winner-icon').replaceChildren(uiIcon(winner?.side||'CT'));
    const own=match.teams?.[ownId],other=Object.entries(match.teams||{}).find(([id])=>id!==ownId)?.[1];
    this.result.querySelector('.match-result-score').textContent=`${own?.score??match.teams?.A?.score??0} : ${other?.score??match.teams?.B?.score??0}`;
    this.result.querySelector('h1').textContent=ownId?(won?'胜利':'失败'):'比赛结束';
    this.result.querySelector('.match-result-heading>p').textContent=`${winner?.side==='CT'?'反恐精英':'恐怖分子'}获胜 · ${snapshot.mode==='deathmatch'?'团队死斗':'竞技爆破'}${match.period==='overtime'?` · 加时 ${match.overtimeNumber||1}`:''}`;
    const players=(snapshot.players||[]).filter(p=>p.teamId? p.teamId===match.winnerTeamId:p.team===winner?.side).sort((a,b)=>(b.kills||0)-(a.kills||0));
    this.result.querySelector('.match-winners').replaceChildren(...players.slice(0,5).map((p,i)=>{
      const card=document.createElement('div');card.className='result-player';const assetPreview=AGENT_ASSETS[p.agentId]?.preview,preview=typeof assetPreview==='string'?assetPreview:assetPreview?.file;
      if(preview){const img=document.createElement('img');img.src=imageAssetURL(preview);img.alt='';card.append(img);}else card.append(uiIcon(p.team));
      const badge=document.createElement('small');badge.textContent=i===0?'最多击杀':p.bot?'机器人':'获胜队伍';
      const name=document.createElement('b');name.textContent=p.name||'玩家';
      const stats=document.createElement('span');stats.textContent=`${p.kills||0} 击杀 · ${p.deaths||0} 死亡 · ${p.assists||0} 助攻`;
      card.append(badge,name,stats);return card;
    }));
    this.result.querySelector('.match-personal').textContent=self?`你的战绩　${self.kills||0} 击杀　${self.deaths||0} 死亡　${self.assists||0} 助攻`:'';
    if(first){this.onEnd({won,match,snapshot});this.result.querySelector('#match-return-button').focus({preventScroll:true});}
  }
  reset(){clearTimeout(this.swapTimer);this.seen.clear();this.room=null;this.ended=false;this.resultKey=null;this.roundKey=null;this.roundPanel.hidden=true;this.matchAward.hidden=true;this.element.hidden=true;this.swap.hidden=true;this.result.hidden=true;this.element.classList.remove('ended');}
  dispose(){this.reset();this.element.remove();}
}

import {uiIcon} from './ui-icons.js';
export function killCardState(snapshot,self){
 const defuse=snapshot.mode==='defuse',count=Math.max(0,Math.floor(Number(defuse?self.roundKills:self.lifeKills)||0));
 return {key:`${snapshot.room}:${self.id}:${defuse?snapshot.round?.number:self.lifeId}`,count,label:defuse?'本回合击杀':'本条命击杀',cards:(self.killCards||[]).slice(0,Math.min(5,count)),team:self.team};
}
export class KillCards {
 constructor(parent){
  this.element=document.createElement('section');this.element.id='kill-cards';this.element.setAttribute('aria-label','本回合击杀 0');
  this.element.innerHTML='<div class="kill-card-fan"></div><div class="kill-card-total"><span>本回合击杀</span><b>0</b></div>';
  this.fan=this.element.querySelector('.kill-card-fan');this.label=this.element.querySelector('.kill-card-total span');this.total=this.element.querySelector('.kill-card-total b');parent.append(this.element);this.reset();
 }
 update(snapshot,self){
  if(!snapshot||!self)return;
  const state=killCardState(snapshot,self),signature=JSON.stringify(state);if(this.signature===signature)return;
  const previous=this.state,newRound=previous?.key!==state.key;
  this.signature=signature;this.state=state;this.element.dataset.count=state.count;this.element.dataset.team=state.team;
  this.element.setAttribute('aria-label',`${state.label} ${state.count}`);this.label.textContent=state.label;this.total.textContent=String(state.count);
  if(newRound)this.fan.replaceChildren();
  const count=Math.min(5,state.count);
  for(let i=0;i<count;i++){
   let card=this.fan.children[i];if(card)continue;
   card=document.createElement('div');card.className='kill-card';
   const detail=state.cards[i]||{},icon=detail.weapon==='knife'?'knife':detail.headshot?'headshot':['hegrenade','molotov','incgrenade'].includes(detail.weapon)?detail.weapon:'kill';
   card.dataset.kind=icon;card.setAttribute('aria-label',`第 ${i+1} 次击杀${detail.headshot?' · 爆头':detail.weapon==='knife'?' · 近战':''}`);
   const rank=document.createElement('b');rank.textContent=i===0?'A':String(i+1);const suit=document.createElement('small');suit.textContent='♠';
   card.append(rank,uiIcon(icon),suit);this.fan.append(card);
   if(!newRound&&i>=(previous?.count||0)){card.classList.add('earned');card.style.animationDelay=`${Math.max(0,i-previous.count)*90}ms`;}
  }
  [...this.fan.children].forEach((card,i)=>{card.style.setProperty('--angle',`${(i-(count-1)/2)*7}deg`);card.style.setProperty('--lift',`${Math.abs(i-(count-1)/2)*3}px`);});
 }
 reset(){this.signature=null;this.state=null;this.fan.replaceChildren();this.total.textContent='0';this.element.dataset.count='0';}
}

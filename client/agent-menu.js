import { AGENT_CATALOG, DEFAULT_AGENT_IDS, getAgent, normalizeAgentLoadout } from '../shared/agents.js';
import { AGENT_ASSETS } from '../shared/agent-assets.js';
import { loadAgent as loadAgentAsset } from './player-assets.js';
import './agents.css';

const STORAGE_KEY='dust2.agents.v1';
const TEAMS=[['CT','反恐精英'],['T','恐怖分子']];

export function readAgentLoadout(){
  try{return normalizeAgentLoadout(JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'));}
  catch{return {...DEFAULT_AGENT_IDS};}
}

/** Loading happens only after selecting a card, before the server equip callback. */
export class AgentMenu {
  constructor({onEquip=async()=>{},loadAgent=loadAgentAsset}={}){
    this.loadout=readAgentLoadout();this.onEquip=onEquip;this.loadAgent=loadAgent;
    this.busy=false;this.destroyed=false;this.activeTeam='CT';
    const modal=document.createElement('div');modal.id='agent-menu';modal.className='overlay';modal.hidden=true;
    modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-labelledby','agent-menu-title');modal.setAttribute('aria-describedby','agent-menu-description');
    modal.innerHTML=`<section class="agent-card"><header><div><span class="eyebrow">AGENT LOADOUT</span><h2 id="agent-menu-title">探员仓库</h2></div><button class="agent-close" type="button" aria-label="关闭探员仓库">完成 ×</button></header><p id="agent-menu-description">两个阵营分别选择探员。点击装备时下载，已下载的探员保存在本机，下次可继续使用。</p><div class="agent-teams"></div><footer><p>探员只改变外观，战斗属性保持一致。</p><progress class="agent-progress" max="100" hidden aria-label="探员下载进度"></progress><div class="agent-status" role="status" aria-live="polite"></div></footer></section>`;
    document.body.append(modal);this.element=modal;
    modal.querySelector('.agent-close').onclick=()=>this.close();
    modal.addEventListener('keydown',event=>{
      if(event.code==='Escape'){event.preventDefault();event.stopPropagation();this.close();return;}
      if(event.code!=='Tab')return;
      const buttons=[...modal.querySelectorAll('button:not(:disabled)')];
      const first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
  }

  open(team){
    if(this.destroyed)return;
    if(TEAMS.some(([id])=>id===team))this.activeTeam=team;
    this.previousFocus=document.activeElement;this.element.hidden=false;this.render();
    this.element.querySelector('.agent-close').focus();
  }

  close(){
    this.element.hidden=true;
    if(this.previousFocus?.isConnected&&!this.previousFocus.closest('[hidden]'))this.previousFocus.focus?.({preventScroll:true});
  }

  status(text){this.element.querySelector('.agent-status').textContent=text;}

  setLoadout(loadout){this.loadout=normalizeAgentLoadout(loadout);this.render();}

  render(){
    if(this.destroyed)return;
    const focusedAgent=this.element.contains(document.activeElement)?document.activeElement?.dataset?.agent:null;
    const teams=this.element.querySelector('.agent-teams');teams.replaceChildren();teams.setAttribute('aria-busy',String(this.busy));
    for(const [team,label]of TEAMS){
      const section=document.createElement('section');section.className='agent-team';section.dataset.team=team;
      section.classList.toggle('current-team',team===this.activeTeam);
      const heading=document.createElement('h3');heading.id=`agent-team-${team}`;heading.textContent=`${team} · ${label}`;
      section.setAttribute('aria-labelledby',heading.id);
      const grid=document.createElement('div');grid.className='agent-grid';
      for(const source of AGENT_CATALOG.filter(agent=>agent.team===team)){
        const agent={...source,...AGENT_ASSETS[source.id]},selected=this.loadout[team]===agent.id;
        const button=document.createElement('button');button.type='button';button.className='agent-item';button.dataset.agent=agent.id;
        button.classList.toggle('selected',selected);button.disabled=this.busy;button.setAttribute('aria-pressed',String(selected));
        button.setAttribute('aria-label',`${label}：${agent.name}${selected?'，已装备':''}${agent.isDefault?'，默认探员':''}`);
        const visual=document.createElement('div');visual.className='agent-visual';
        const fallback=document.createElement('div');fallback.className='agent-placeholder';fallback.setAttribute('aria-hidden','true');
        const letters=document.createElement('strong');letters.textContent=team;
        const unit=document.createElement('span');unit.textContent=agent.englishName||agent.name;
        fallback.append(letters,unit);visual.append(fallback);
        // Use only a real catalog asset; a missing preview remains a text card.
        const preview=typeof agent.preview==='string'?agent.preview:agent.preview?.file;
        if(preview){
          const image=document.createElement('img');image.alt='';image.loading='lazy';image.decoding='async';
          image.onload=()=>{fallback.hidden=true;};image.onerror=()=>{image.remove();fallback.hidden=false;};
          image.src=preview;visual.append(image);
        }
        if(agent.isDefault){const badge=document.createElement('span');badge.className='agent-default';badge.textContent='默认';visual.append(badge);}
        const name=document.createElement('b');name.className='agent-name';name.textContent=agent.name;
        const english=document.createElement('span');english.className='agent-english';english.textContent=agent.englishName||'';
        const note=document.createElement('small');note.className='agent-item-state';
        note.textContent=selected?'✓ 已装备':agent.isDefault?'CS2 默认探员':Number(agent.bytes)>0?`装备 · ${(agent.bytes/1048576).toFixed(1)} MB`:'装备 · 按需下载';
        button.append(visual,name,english,note);button.onclick=()=>this.equip(agent);grid.append(button);
      }
      section.append(heading,grid);teams.append(section);
    }
    if(focusedAgent){
      const replacement=[...teams.querySelectorAll('[data-agent]')].find(button=>button.dataset.agent===focusedAgent&&!button.disabled);
      (replacement||this.element.querySelector('.agent-close')).focus({preventScroll:true});
    }
  }

  async equip(value){
    const source=getAgent(typeof value==='string'?value:value?.id);
    if(this.busy||this.destroyed||!source)return;
    const agent={...source,...AGENT_ASSETS[source.id]};this.busy=true;this.activeTeam=agent.team;this.render();
    const progress=this.element.querySelector('.agent-progress');progress.hidden=false;progress.removeAttribute('value');
    this.status(`准备 ${agent.name}…`);
    try{
      await this.loadAgent(agent.id,{onProgress:update=>{
        if(this.destroyed)return;
        const bytes=typeof update==='number'?update:Number(update?.bytes??update?.loaded)||0;
        const total=Number(update?.total)||Number(agent.bytes)||0;
        const percent=total>0?Math.min(100,Math.max(0,Math.round(bytes/total*100))):null;
        if(percent!==null)progress.value=percent;
        this.status(`${update?.cached?'读取本机缓存':'下载'} ${agent.name}${percent!==null?` · ${percent}%`:bytes>0?` · ${(bytes/1048576).toFixed(1)} MB`:''}`);
      }});
      if(this.destroyed)return;
      progress.value=100;this.status(`正在装备 ${agent.name}…`);
      const next=normalizeAgentLoadout({...this.loadout,[agent.team]:agent.id});
      await this.onEquip(agent,next);
      if(this.destroyed)return;
      this.loadout=next;
      let saved=true;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));}catch{saved=false;}
      this.status(saved?`已装备 ${agent.name}。下次进入继续使用。`:`已装备 ${agent.name}。浏览器未能保存选择，下次进入需重新选择。`);
    }catch(error){
      if(!this.destroyed)this.status(`未能装备：${error?.message||'下载或连接失败'}。点击探员可重试。`);
    }finally{
      this.busy=false;progress.hidden=true;if(!this.destroyed)this.render();
    }
  }

  destroy(){this.destroyed=true;this.element.remove();}
}

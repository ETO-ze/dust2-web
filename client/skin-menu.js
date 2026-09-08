import { SKINS, DEFAULT_SKINS, getSkin, normalizeSkinLoadout } from '../shared/skins.js';
import { getWeapon } from '../shared/weapons.js';
import { loadSkin } from './skin-assets.js';
import './skins.css';

export function readSkinLoadout(){try{return normalizeSkinLoadout(JSON.parse(localStorage.getItem('dust2.skins.v1')||'{}'));}catch{return {...DEFAULT_SKINS};}}
export class SkinMenu{
  constructor({onEquip}){
    this.loadout=readSkinLoadout();this.weapon='ak47';this.onEquip=onEquip;this.busy=false;
    const modal=document.createElement('div');modal.className='overlay';modal.id='skin-menu';modal.hidden=true;
    modal.innerHTML=`<section class="skin-card"><header><div><span class="eyebrow">PERSONAL LOADOUT</span><h2>皮肤仓库</h2></div><button id="close-skins">完成 ×</button></header><p>选择你喜欢的涂装。仅在点击装备时下载模型，并保存在本机；外观会同步给房间里的玩家。</p><nav>${Object.keys(DEFAULT_SKINS).map(id=>`<button data-skin-weapon="${id}">${getWeapon(id).name}</button>`).join('')}</nav><div id="skin-grid" class="skin-grid"></div><div class="skin-status" role="status"></div></section>`;
    document.body.append(modal);this.element=modal;
    modal.querySelector('#close-skins').onclick=()=>this.close();
    modal.addEventListener('keydown',e=>{if(e.code==='Escape'){this.close();e.preventDefault();}});
    modal.querySelectorAll('[data-skin-weapon]').forEach(b=>b.onclick=()=>{this.weapon=b.dataset.skinWeapon;this.render();});
  }
  open(){this.element.hidden=false;this.render();this.element.querySelector('#close-skins').focus();}
  close(){this.element.hidden=true;}
  status(text){this.element.querySelector('.skin-status').textContent=text;}
  render(){
    this.element.querySelectorAll('[data-skin-weapon]').forEach(b=>b.classList.toggle('selected',b.dataset.skinWeapon===this.weapon));
    const grid=this.element.querySelector('#skin-grid');grid.replaceChildren();
    for(const skin of SKINS.filter(s=>s.weapon===this.weapon)){
      const button=document.createElement('button');button.className='skin-item';button.classList.toggle('selected',this.loadout[skin.weapon]===skin.id);button.disabled=this.busy;
      const image=document.createElement('img');image.src=skin.preview;image.loading='lazy';image.alt=skin.name;
      const name=document.createElement('b');name.textContent=skin.name;
      const label=document.createElement('small');label.textContent=this.loadout[skin.weapon]===skin.id?'已装备':skin.isDefault?'默认涂装':`按需下载 · ${(skin.bytes/1048576).toFixed(1)} MB`;
      button.append(image,name,label);button.onclick=()=>this.equip(skin);grid.append(button);
    }
  }
  async equip(skin){
    if(this.busy)return;this.busy=true;this.render();this.status(`准备 ${skin.name}…`);
    try{
      await loadSkin(skin.id,{onProgress:p=>{const bytes=typeof p==='number'?p:p?.bytes||p?.loaded||0;this.status(`下载 ${skin.name} · ${Math.min(100,Math.round(bytes/skin.bytes*100))}%`);}});
      const next={...this.loadout,[skin.weapon]:skin.id};
      await this.onEquip(skin,next);
      this.loadout=next;localStorage.setItem('dust2.skins.v1',JSON.stringify(this.loadout));
      this.status(`已装备 ${skin.name}。下次进入继续使用。`);
    }catch(error){this.status(`未能装备：${error.message}。点击皮肤可重试。`);}
    finally{this.busy=false;this.render();}
  }
}

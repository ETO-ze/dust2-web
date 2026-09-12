import {preferences} from './persistence.js';
import { SKINS, DEFAULT_SKINS, getSkin, normalizeSkinLoadout } from '../shared/skins.js';
import { getWeapon } from '../shared/weapons.js';
import { loadSkin,skinSaved,downloadSkin } from './skin-assets.js';
import './skins.css';

export function readSkinLoadout(){try{const saved=JSON.parse(preferences.getItem('dust2.skins.v1')||'{}');if(!preferences.getItem('dust2.skins.v2')){for(const id of ['ak47','m4a1','awp','pistol','usp','knife']){if(['ak47-wild-lotus','m4a1-blue-phosphor','awp-gungnir','glock-emerald','usp-printstream','karambit-sapphire'].includes(saved[id]))delete saved[id];}preferences.setItem('dust2.skins.v1',JSON.stringify(saved));preferences.setItem('dust2.skins.v2','1');}return normalizeSkinLoadout(saved);}catch{return {...DEFAULT_SKINS};}}
export class SkinMenu{
  constructor({onEquip}){
    this.loadout=readSkinLoadout();this.weapon='ak47';this.onEquip=onEquip;this.busy=false;this.downloaded=new Set();
    const modal=document.createElement('div');modal.className='overlay';modal.id='skin-menu';modal.hidden=true;
    modal.innerHTML=`<section class="skin-card"><header><div><span class="eyebrow">PERSONAL LOADOUT</span><h2>皮肤仓库</h2></div><button id="close-skins">完成 ×</button></header><p>选择你喜欢的涂装。新增刀型需先下载，再点击装备；资源保存在本机；外观会同步给房间里的玩家。</p><div class="glove-label">默认手套：运动手套 · 树篱迷宫 · 崭新出厂</div><nav>${Object.keys(DEFAULT_SKINS).map(id=>`<button data-skin-weapon="${id}">${getWeapon(id).name}</button>`).join('')}</nav><div id="skin-grid" class="skin-grid"></div><div class="skin-status" role="status"></div></section>`;
    document.body.append(modal);this.element=modal;
    modal.querySelector('#close-skins').onclick=()=>this.close();
    modal.addEventListener('keydown',e=>{if(e.code==='Escape'){this.close();e.preventDefault();}});
    modal.querySelectorAll('[data-skin-weapon]').forEach(b=>b.onclick=()=>{this.weapon=b.dataset.skinWeapon;this.render();});
  }
  open(){this.element.hidden=false;this.refreshDownloads();this.render();this.element.querySelector('#close-skins').focus();}
  async refreshDownloads(){for(const skin of SKINS.filter(s=>s.downloadRequired)){if(await skinSaved(skin))this.downloaded.add(skin.id);else this.downloaded.delete(skin.id);}if(!this.busy)this.render();}
  close(){this.element.hidden=true;}
  status(text){this.element.querySelector('.skin-status').textContent=text;}
  render(){
    this.element.querySelectorAll('[data-skin-weapon]').forEach(b=>b.classList.toggle('selected',b.dataset.skinWeapon===this.weapon));
    const grid=this.element.querySelector('#skin-grid');grid.replaceChildren();
    for(const skin of SKINS.filter(s=>s.weapon===this.weapon)){
      const button=document.createElement('button');button.className='skin-item';button.classList.toggle('selected',this.loadout[skin.weapon]===skin.id);button.disabled=this.busy;
      const image=document.createElement('img');image.src=skin.preview;image.loading='lazy';image.alt=skin.name;
      const name=document.createElement('b');name.textContent=skin.name;
      const label=document.createElement('small');label.textContent=this.loadout[skin.weapon]===skin.id?'已装备':skin.isDefault?'默认 · 崭新出厂':skin.downloadRequired?(this.downloaded.has(skin.id)?'已下载 · 点击装备':`下载刀型与动作 · ${((skin.bytes+skin.animation.bytes)/1048576).toFixed(1)} MB`):`按需下载 · ${(skin.bytes/1048576).toFixed(1)} MB`;
      button.append(image,name,label);button.onclick=()=>this.equip(skin);grid.append(button);
    }
  }
  async equip(skin){
    if(this.busy)return;this.busy=true;this.render();this.status(`准备 ${skin.name}…`);
    try{
      if(skin.downloadRequired&&!await skinSaved(skin)){const saved=await downloadSkin(skin,{onProgress:p=>this.status(`正在下载 ${skin.name} · ${(p.loaded/1048576).toFixed(1)} MB`)});if(!saved)throw Error('浏览器未能保存资源，请释放本地存储空间后重试');this.downloaded.add(skin.id);this.status('下载完成。再次点击即可装备。');return;}
      await loadSkin(skin.id,{onProgress:p=>{const bytes=typeof p==='number'?p:p?.bytes||p?.loaded||0;this.status(`下载 ${skin.name} · ${Math.min(100,Math.round(bytes/skin.bytes*100))}%`);}});
      const next={...this.loadout,[skin.weapon]:skin.id};
      await this.onEquip(skin,next);
      this.loadout=next;preferences.setItem('dust2.skins.v1',JSON.stringify(this.loadout));
      this.status(`已装备 ${skin.name}。下次进入继续使用。`);
    }catch(error){this.status(`未能装备：${error.message}。点击皮肤可重试。`);}
    finally{this.busy=false;this.render();}
  }
}

import {preferences} from './persistence.js';
import { SKINS, DEFAULT_SKINS, getSkin, normalizeSkinLoadout } from '../shared/skins.js';
import { getWeapon } from '../shared/weapons.js';
import { loadSkin,skinSaved,downloadSkin } from './skin-assets.js';
import './skins.css';
import {skinPreviewURL} from './skin-preview.js';
import {filterSkins} from './skin-library.js';

export function readSkinLoadout(){
  const key='dust2.skins.v1',saved=preferences.readJSON(key);
  const loadout=normalizeSkinLoadout(saved);
  if(Object.keys(saved).some(weapon=>saved[weapon]!==loadout[weapon]))
    preferences.setItem(key,JSON.stringify(loadout));
  return loadout;
}
export class SkinMenu{
  constructor({onEquip,onLoadout=()=>{}}){
    this.loadout=readSkinLoadout();this.weapon='all';this.category='all';this.query='';this.availability='all';this.onEquip=onEquip;this.busy=false;this.downloaded=new Set();this.generation=0;
    const modal=document.createElement('div');modal.className='overlay';modal.id='skin-menu';modal.hidden=true;
    modal.innerHTML=`<section class="skin-card"><header><div><span class="eyebrow">INVENTORY</span><h2>皮肤库</h2></div><div class="skin-tabs"><button data-open-loadout>装备携带</button><button class="selected" aria-current="page">皮肤库</button></div><button id="close-skins">返回 ×</button></header><div class="skin-toolbar"><input type="search" placeholder="搜索武器或皮肤" aria-label="搜索皮肤"><select aria-label="武器分类" data-skin-category><option value="all">全部分类</option><option value="pistols">手枪</option><option value="mid">中级</option><option value="rifles">步枪</option><option value="melee">近战武器</option></select><select aria-label="皮肤筛选" data-skin-availability><option value="all">全部皮肤</option><option value="vanilla">原厂外观</option><option value="popular">热门涂装</option><option value="equipped">已装备</option><option value="saved">已下载</option></select><span class="skin-count"></span></div><div class="skin-body"><nav aria-label="武器筛选"><button data-skin-weapon="all">全部武器</button>${Object.keys(DEFAULT_SKINS).map(id=>`<button data-skin-weapon="${id}">${getWeapon(id).name}</button>`).join('')}</nav><div class="skin-results"><div class="glove-label">默认手套：运动手套 · 树篱迷宫 · 崭新出厂</div><div id="skin-grid" class="skin-grid"></div></div></div><footer><span>选择后按需下载并装备 · <a class="full-skin-list" href="assets/weapons/cs2-skins/library/index.html" target="_blank" rel="noopener">完整清单 ↗</a></span><div class="skin-status" role="status"></div></footer></section>`;
    document.body.append(modal);this.element=modal;
    modal.querySelector('#close-skins').onclick=()=>this.close();
    modal.querySelector('[data-open-loadout]').onclick=()=>{this.close();onLoadout();};
    modal.querySelector('input[type=search]').oninput=e=>{this.query=e.target.value;this.render();};
    modal.querySelector('[data-skin-category]').onchange=e=>{this.category=e.target.value;this.weapon='all';this.render();};
    modal.querySelector('[data-skin-availability]').onchange=e=>{this.availability=e.target.value;this.render();};
    modal.addEventListener('keydown',e=>{if(e.code==='Escape'){this.close();e.preventDefault();}});
    modal.querySelectorAll('[data-skin-weapon]').forEach(b=>b.onclick=()=>{this.weapon=b.dataset.skinWeapon;this.category='all';modal.querySelector('[data-skin-category]').value='all';this.render();});
  }
  open(){this.element.hidden=false;this.refreshDownloads();this.render();this.element.querySelector('#close-skins').focus();}
  async refreshDownloads(){
    const generation=++this.generation,saved=new Set(),remaining=SKINS.values();
    const checkNext=async()=>{
      for(const skin of remaining){
        if(this.generation!==generation)return;
        try{if(await skinSaved(skin))saved.add(skin.id);}catch{/* Cache access may be disabled. */}
      }
    };
    await Promise.all(Array.from({length:4},checkNext));
    if(generation!==this.generation)return;
    this.downloaded=saved;
    if(!this.busy&&!this.element.hidden)this.render();
  }
  close(){this.element.hidden=true;this.generation++;}
  status(text){this.element.querySelector('.skin-status').textContent=text;}
  render(){
    this.element.querySelectorAll('[data-skin-weapon]').forEach(b=>b.classList.toggle('selected',b.dataset.skinWeapon===this.weapon));
    const grid=this.element.querySelector('#skin-grid');grid.replaceChildren();
    const visible=filterSkins(this);this.element.querySelector('.skin-count').textContent=`${visible.length} / ${SKINS.length}`;
    if(!visible.length){const empty=document.createElement('p');empty.className='skin-empty';empty.textContent='没有符合筛选条件的皮肤';grid.append(empty);}
    for(const skin of visible){
      const button=document.createElement('button');button.className='skin-item';button.classList.toggle('selected',this.loadout[skin.weapon]===skin.id);button.disabled=this.busy;
      const image=document.createElement('img');image.src=skinPreviewURL(skin);image.loading='lazy';image.alt=skin.name;
      const weapon=document.createElement('span');weapon.className='skin-weapon-name';weapon.textContent=getWeapon(skin.weapon).name;
      const name=document.createElement('b');name.textContent=skin.name;
      const condition=document.createElement('span');condition.className='skin-condition';condition.textContent=({'Factory New':'崭新出厂','Field-Tested':'久经沙场','Minimal Wear':'略有磨损','Vanilla':'原厂涂装'})[skin.condition]||'';
      const label=document.createElement('small');label.textContent=this.loadout[skin.weapon]===skin.id?'已装备':this.downloaded.has(skin.id)?'已下载 · 装备':`下载并装备 · ${((skin.bytes+(skin.animation?.bytes||0))/1048576).toFixed(1)} MB`;
      button.dataset.skinId=skin.id;button.setAttribute('aria-pressed',String(this.loadout[skin.weapon]===skin.id));button.append(image,weapon,name,condition,label);button.onclick=()=>this.equip(skin);grid.append(button);
    }
  }
  async equip(skin){
    if(this.busy)return;this.busy=true;this.render();this.status(`准备 ${skin.name}…`);
    try{
      if(skin.downloadRequired&&!await skinSaved(skin)){const saved=await downloadSkin(skin,{onProgress:p=>this.status(`正在下载 ${skin.name} · ${((p?.loaded||p?.bytes||0)/1048576).toFixed(1)} MB`)});if(!saved)throw Error('浏览器未能保存资源，请释放本地存储空间后重试');this.downloaded.add(skin.id);}
      await loadSkin(skin.id,{onProgress:p=>{const bytes=typeof p==='number'?p:p?.bytes||p?.loaded||0;this.status(`下载 ${skin.name} · ${Math.min(100,Math.round(bytes/skin.bytes*100))}%`);}});
      const next={...this.loadout,[skin.weapon]:skin.id};
      await this.onEquip(skin,next);
      this.loadout=next;preferences.setItem('dust2.skins.v1',JSON.stringify(this.loadout));
      if(await skinSaved(skin))this.downloaded.add(skin.id);
      this.status(`已装备 ${skin.name}。下次进入继续使用。`);
    }catch(error){this.status(`未能装备：${error.message}。点击皮肤可重试。`);}
    finally{this.busy=false;this.render();}
  }
}

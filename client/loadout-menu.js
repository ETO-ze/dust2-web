import {preferences} from './persistence.js';
import {LOADOUT_GROUPS,LOADOUT_LABELS,normalizeWeaponLoadout,loadoutCandidates,replaceLoadoutSlot,canReplaceLoadoutSlot} from '../shared/weapon-loadout.js';
import {getWeapon} from '../shared/weapons.js';
import {getSkin,DEFAULT_SKINS} from '../shared/skins.js';
import {imageAssetURL} from './image-asset-url.js';
import {uiIconUrl} from './ui-icons.js';
import './loadout-menu.css';
export class LoadoutMenu{
 constructor({getSkins=()=>({}),onApply=async()=>{},onSaved=()=>{},openSkins=()=>{},canEdit=()=>true}={}){
  Object.assign(this,{getSkins,onApply,onSaved,openSkins,canEdit});this.loadout=normalizeWeaponLoadout(preferences.readJSON('dust2.weapon-loadout.v1'));this.team='CT';this.selection={group:'rifles',index:0};this.busy=false;
  const modal=document.createElement('div');modal.id='loadout-menu';modal.className='overlay';modal.hidden=true;
  modal.innerHTML='<section class="loadout-card"><header><div><small>LOADOUT</small><h2>装备配置</h2></div><nav aria-label="装备分类"><button data-armory-view="loadout" class="selected">装备携带</button><button data-armory-view="skins">皮肤库</button></nav><button data-armory-close>返回 ×</button></header><div class="loadout-top"><div role="group" aria-label="配置阵营"><button data-loadout-team="CT">反恐精英</button><button data-loadout-team="T">恐怖分子</button></div><p>全部 34 款枪械 · 每方携带 15 件 · 按阵营筛选</p></div><div class="loadout-body"><div class="loadout-slots"></div><aside><h3>可用装备</h3><p class="loadout-selection"></p><div class="loadout-candidates"></div></aside></div><footer><span class="loadout-result" role="status"></span><button data-loadout-reset>恢复默认</button><button data-loadout-save>保存装备配置</button></footer></section>';
  document.body.append(modal);this.element=modal;
  modal.querySelector('[data-armory-close]').onclick=()=>this.close();modal.querySelector('[data-armory-view=skins]').onclick=()=>{this.close();openSkins();};
  modal.querySelector('[data-loadout-save]').onclick=()=>this.save();modal.querySelector('[data-loadout-reset]').onclick=()=>{if(!this.canEdit()||this.busy)return;this.draft=normalizeWeaponLoadout(null);this.render();};
  modal.addEventListener('click',e=>{const t=e.target.closest('[data-loadout-team]');if(t){this.team=t.dataset.loadoutTeam;this.render();return;}const s=e.target.closest('[data-loadout-slot]');if(s){this.selection={group:s.dataset.group,index:Number(s.dataset.loadoutSlot)};this.render();return;}const w=e.target.closest('[data-loadout-weapon]');if(w&&!w.disabled){this.draft=replaceLoadoutSlot(this.draft,this.team,this.selection.group,this.selection.index,w.dataset.loadoutWeapon);this.render();}});
  modal.addEventListener('keydown',e=>{if(e.code==='Escape'){e.preventDefault();this.close();}});
 }
 open(){this.draft=normalizeWeaponLoadout(this.loadout);this.element.hidden=false;this.render();this.element.querySelector('[data-armory-close]').focus();}
 close(){this.element.hidden=true;}
 art(id){const skin=getSkin(this.getSkins()[id]||DEFAULT_SKINS[id]);return skin?.preview?imageAssetURL(skin.preview):uiIconUrl(id);}
 render(){
  const editable=this.canEdit()&&!this.busy;this.element.dataset.team=this.team;
  for(const b of this.element.querySelectorAll('[data-loadout-team]')){const selected=b.dataset.loadoutTeam===this.team;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));}
  const slots=this.element.querySelector('.loadout-slots');slots.replaceChildren();
  for(const group of LOADOUT_GROUPS){const column=document.createElement('section'),heading=document.createElement('h3');heading.textContent=LOADOUT_LABELS[group];column.append(heading);
   this.draft[this.team][group].forEach((id,index)=>{const b=document.createElement('button');b.dataset.loadoutSlot=index;b.dataset.group=group;b.className='loadout-slot';b.classList.toggle('selected',this.selection.group===group&&this.selection.index===index);b.setAttribute('aria-label',`${LOADOUT_LABELS[group]} ${index+1} · ${getWeapon(id).name}`);const img=document.createElement('img');img.src=this.art(id);img.alt='';const name=document.createElement('b');name.textContent=getWeapon(id).name;const price=document.createElement('small');price.textContent=`$${getWeapon(id).price}${group==='pistols'&&index===0?' · 起始手枪':''}`;b.append(img,name,price);column.append(b);});slots.append(column);
  }
  this.element.querySelector('.loadout-selection').textContent=`${LOADOUT_LABELS[this.selection.group]} · 槽位 ${this.selection.index+1} · 选择替换，已携带枪械将交换位置`;
  const candidates=this.element.querySelector('.loadout-candidates');candidates.replaceChildren();
  const choices=loadoutCandidates(this.team,this.selection.group).filter(id=>this.selection.group!=='pistols'||(this.selection.index===0?canReplaceLoadoutSlot(this.team,'pistols',0,id):canReplaceLoadoutSlot(this.team,'pistols',1,id)));
  for(const id of choices){const b=document.createElement('button');b.dataset.loadoutWeapon=id;b.disabled=!editable||!canReplaceLoadoutSlot(this.team,this.selection.group,this.selection.index,id);const img=document.createElement('img');img.src=this.art(id);img.alt='';const text=document.createElement('span');text.textContent=getWeapon(id).name;const label=document.createElement('small');const skin=getSkin(this.getSkins()[id]||DEFAULT_SKINS[id]);label.textContent=`${skin?.name||getWeapon(id).skin} · ${skin?.condition==='Factory New'?'崭新出厂':''}`;b.classList.toggle('equipped',this.draft[this.team][this.selection.group].includes(id));b.append(img,text,label);candidates.append(b);}
  this.element.querySelector('[data-loadout-save]').disabled=!editable;this.element.querySelector('[data-loadout-reset]').disabled=!editable;
  this.element.querySelector('.loadout-result').textContent=this.busy?'正在同步装备…':this.canEdit()?'选择槽位后更换装备。起始手枪在下次重生或新回合生效。':'本回合进行中，购买阶段可更改装备配置。';
 }
 async save(){if(!this.canEdit()||this.busy)return;this.busy=true;this.render();let message;try{const next=normalizeWeaponLoadout(this.draft),confirmed=await this.onApply(next);this.loadout=normalizeWeaponLoadout(confirmed||next);this.draft=normalizeWeaponLoadout(this.loadout);preferences.setItem('dust2.weapon-loadout.v1',JSON.stringify(this.loadout));this.onSaved(this.loadout);message='装备配置已保存，下次进入仍然使用。';}catch(e){message='未能保存：'+e.message;}finally{this.busy=false;this.render();this.element.querySelector('.loadout-result').textContent=message;}}
}

import { getWeapon, TEAM_LOADOUTS } from '../shared/weapons.js';
import { EQUIPMENT, equipmentPrice, UTILITY_IDS, MAX_GRENADES,teamUtilities } from '../shared/equipment.js';
import { getSkin, DEFAULT_SKINS } from '../shared/skins.js';
import { uiIconUrl } from './ui-icons.js';
import './equipment.css';
import {imageAssetURL} from './image-asset-url.js';
import {PurchaseQueue} from './purchase-queue.js';
import {teamWeaponLoadout} from '../shared/weapon-loadout.js';
const categories=[['equipment','装备'],['pistols','手枪'],['mid','中级'],['rifles','步枪'],['grenades','投掷物']];
const descriptions={armor:'防弹背心 · 身体防护',helmet:'背心与头盔 · 保护头部',defusekit:'拆弹缩短至 5 秒 · 走近拾取',hegrenade:'范围爆炸伤害',flashbang:'致盲视线内的玩家',smokegrenade:'遮挡视线 · 可熄灭火焰',molotov:'落地燃烧 · 匪方专用',incgrenade:'落地燃烧 · 警方专用',decoy:'模拟主武器枪声 · 误导敌人'};
export class WeaponShop {
  constructor(container,{buy,refund,request,donate,close}) {
    this.container=container;this.buy=buy;this.request=request;this.donate=donate;this.pending=null;this.category=null;
    this.queue=new PurchaseQueue({send:item=>(item.type==='refund'?refund:buy)(item.weapon),onChange:()=>this.update(this.last),onTimeout:()=>this.message('购买确认超时，未发送的购买已取消。')});
    container.innerHTML=`<section class="armory-card equipment-card"><header><div class="shop-title"><span class="eyebrow" id="shop-team">LOADOUT</span><h2>购买菜单</h2></div><div class="buy-wallet"><small>可用资金</small><b id="shop-money">$ 0</b></div><button id="close-buy" type="button"><kbd>B</kbd> 返回游戏 ×</button></header><div class="shop-status"><span id="buy-note"></span><b id="shop-time"></b></div><div class="shop-team-help"><span>队伍补给</span><select aria-label="请求的武器" id="request-weapon"></select><button type="button" id="request-weapon-button">请求发枪</button><small>Ctrl + 点击枪械：购买并丢给队友</small></div><div class="shop-requests"></div><div class="equipment-columns"></div><div class="shop-refunds" aria-label="退还未使用的枪械"></div><div class="shop-bottom"><p id="shop-result" role="status">选择武器或装备</p><footer><kbd>1–5</kbd> 选择分类与装备　<kbd>Q</kbd> 上一件装备　<kbd>4</kbd> 切换投掷物</footer></div></section>`;
    container.querySelector('#close-buy').onclick=close;container.querySelector('#request-weapon-button').onclick=()=>request(container.querySelector('#request-weapon').value);
    container.addEventListener('click',e=>{const gift=e.target.closest('[data-donate-to]');if(gift&&!gift.disabled){donate(gift.dataset.donateTo,gift.dataset.weapon);return;}const sell=e.target.closest('[data-refund]');if(sell&&!sell.disabled){this.queue.enqueue({type:'refund',weapon:sell.dataset.refund});this.message('退还已加入队列');return;}const category=e.target.closest('[data-category]');if(category){this.category=category.dataset.category;this.highlight();return;}const button=e.target.closest('[data-buy]');if(button&&!button.disabled){if(e.ctrlKey&&[1,2].includes(getWeapon(button.dataset.buy).slot)){donate(null,button.dataset.buy);return;}const weapon=button.dataset.buy,price=Number(button.dataset.price)||0;if(this.queue.enqueue({type:'buy',weapon,price}))this.message('购买已加入队列 · 可继续选择其他装备');}});
    container.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea')||e.repeat)return;if(e.code==='Backspace'){e.preventDefault();this.category=null;this.highlight();}if(!/^Digit[1-5]$/.test(e.code))return;e.preventDefault();const i=Number(e.code.at(-1))-1;if(!this.category){this.category=categories[i][0];this.highlight();}else{container.querySelectorAll(`[data-group="${this.category}"] [data-buy]`)[i]?.click();this.category=null;this.highlight();}});
  }
  highlight(){for(const column of this.container.querySelectorAll('[data-group]'))column.classList.toggle('active',column.dataset.group===this.category);}
  render(p){
    this.team=p.team;this.container.dataset.team=p.team;const equipped=teamWeaponLoadout(p.weaponLoadout,p.team);const choose=this.container.querySelector('#request-weapon');choose.replaceChildren();for(const id of [...equipped.pistols,...equipped.mid,...equipped.rifles]){const option=document.createElement('option');option.value=id;option.textContent=getWeapon(id).name;choose.append(option);}choose.value=p.team==='T'?'ak47':'m4a1';
    this.container.querySelector('#shop-team').textContent=p.team==='CT'?'CT / 防守方装备':'T / 进攻方装备';
    const groups={equipment:p.team==='CT'?['armor','helmet','defusekit']:['armor','helmet'],...equipped,grenades:teamUtilities(p.team)};
    this.container.querySelector('.equipment-columns').innerHTML=categories.map(([category,label],index)=>`<section data-group="${category}"><button class="equipment-heading" data-category="${category}"><kbd>${index+1}</kbd> ${label}</button>${(groups[category]||[]).map((id,i)=>{const w=EQUIPMENT[id]||getWeapon(id),skin=getSkin(p.skins?.[id]||DEFAULT_SKINS[id]);return `<button class="equipment-item${skin?' weapon-item':' gear-item'}" data-buy="${id}"><kbd>${i+1}</kbd><img loading="lazy" src="${skin?.preview?imageAssetURL(skin.preview):uiIconUrl(id)}" alt="${w.name}"><b>${w.name}</b><span>${descriptions[id]||`${skin?.name||w.skin}${skin?.condition==='Factory New'?' · 崭新出厂':''}`}</span><div class="equipment-price"><strong></strong><small></small></div></button>`;}).join('')}</section>`).join('');
    this.highlight();
  }
  message(text){this.container.querySelector('#shop-result').textContent=text;}
  result(result){if(!result.ok)this.queue.clear();else this.queue.settle();this.message(result.ok?`已${result.refunded?'退还':'购买'} ${(EQUIPMENT[result.weapon]||getWeapon(result.weapon)).name} · 剩余 $${result.money}`:result.message||'购买未完成');this.update(this.last);}
  cancel(){this.queue.clear();}
  update(state){
    if(!state?.player)return;this.last=state;const {player:p,mode,round,time}=state;
    const skinKey=JSON.stringify([p.skins,p.weaponLoadout]);if(this.team!==p.team||this.skinKey!==skinKey){this.skinKey=skinKey;this.render(p);}
    const free=mode==='deathmatch',remaining=Math.max(0,Math.ceil(((round?.buyEndsAt||0)-time)/1000));
    this.container.querySelector('#shop-money').textContent=`$ ${p.money}`;
    this.container.querySelector('#shop-time').textContent=free?'死斗 · 免费补给':`购买时间 ${remaining}s`;
    this.container.querySelector('#buy-note').textContent=p.buyReason||(free?'存活时可更换装备':`人机计划：${p.botBuy||'等待整备'} · 下次战败基础收入 $${p.lossIncome||0}`);
    const pending=this.queue.pending,refundKey=JSON.stringify([p.refundable,pending.map(i=>[i.type,i.weapon])]);
    if(refundKey!==this.refundKey){this.refundKey=refundKey;const refunds=this.container.querySelector('.shop-refunds');refunds.replaceChildren();for(const item of p.refundable||[]){const b=document.createElement('button');b.dataset.refund=item.weapon;b.disabled=pending.some(i=>i.type==='refund'&&i.weapon===item.weapon);b.textContent=`↶ 退还 ${getWeapon(item.weapon).name} +$${item.price}`;refunds.append(b);}}
    const help=this.container.querySelector('.shop-team-help');help.hidden=free;this.container.querySelector('#request-weapon-button').disabled=!p.alive||p.buyAllowed===false;const requests=this.container.querySelector('.shop-requests'),visible=(free?[]:state.requests||[]).filter(r=>r.team===p.team&&r.playerId!==p.id),requestKey=JSON.stringify([visible,p.alive,p.buyAllowed,p.money]);if(requestKey!==this.requestKey){this.requestKey=requestKey;requests.replaceChildren();for(const r of visible){const b=document.createElement('button');b.dataset.donateTo=r.playerId;b.dataset.weapon=r.weapon;b.textContent=`给 ${r.name} 发 ${getWeapon(r.weapon).name} · $${getWeapon(r.weapon).price}`;b.disabled=!p.alive||p.buyAllowed===false||p.money<getWeapon(r.weapon).price;requests.append(b);}}
    const counts=p.utilityCounts||{},total=UTILITY_IDS.reduce((n,id)=>n+(counts[id]||0),0);
    for(const button of this.container.querySelectorAll('[data-buy]')){
      const id=button.dataset.buy,item=EQUIPMENT[id],price=free?0:item?equipmentPrice(id,p):getWeapon(id).price;
      const queued=pending.filter(i=>i.type==='buy'),same=queued.filter(i=>i.weapon===id).length,reserved=queued.reduce((n,i)=>n+i.price,0),queuedUtility=queued.filter(i=>EQUIPMENT[i.weapon]?.slot===4).length;
      const full=id==='armor'?p.armor>=100:id==='helmet'?p.armor>=100&&p.helmet:id==='defusekit'?p.defuseKit:item?.slot===4?(counts[id]||0)+same>=item.maxCount||total+queuedUtility>=MAX_GRENADES:false;
      const reason=!p.alive?'等待重生':p.buyAllowed===false?p.buyReason:p.money-reserved<price?'余额不足':full?'已配齐':same&&item?.slot!==4?'已加入队列':'';
      button.dataset.price=price;
      button.disabled=!!reason;button.classList.toggle('owned',!!p.inventory?.includes(id)||!!full);button.querySelector('strong').textContent=free?`$${(item||getWeapon(id)).price} · 免费`:`$${price}`;
      button.querySelector('small').textContent=reason||(item?.slot===4?`${counts[id]||0} / ${item.maxCount}`:p.inventory?.includes(id)?'已持有':'购买');
    }
  }
}

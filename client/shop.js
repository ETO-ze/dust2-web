import { getWeapon } from '../shared/weapons.js';

const items = ['ak47','m4a1','awp','armor'];
export class WeaponShop {
  constructor(container, { buy, close }) {
    this.container=container; this.pending=null;
    container.innerHTML=`<section class="armory-card"><header><div><span class="eyebrow">EQUIPMENT / BUY MENU</span><h2>购买装备</h2></div><div class="buy-wallet"><small>可用资金</small><b id="shop-money">$ 0</b></div><button id="close-buy" type="button">返回战场 ×</button></header><div class="shop-status"><span id="buy-note"></span><b id="shop-time"></b></div><div class="shop-grid">${items.map((id,i)=>id==='armor'?`<button data-buy="armor"><kbd>${i+1}</kbd><div class="armor-symbol">▰</div><b>防弹护甲</b><span>补充至 100 护甲</span><strong></strong><small></small></button>`:`<button data-buy="${id}"><kbd>${i+1}</kbd><img src="assets/weapons/cs2-skins/previews/${id}.webp" alt="${getWeapon(id).name}"><b>${getWeapon(id).name}</b><span>${getWeapon(id).skin}</span><strong></strong><small></small></button>`).join('')}</div><p id="shop-result" role="status">选择装备即可购买，皮肤在「皮肤仓库」中更换。</p><footer>鼠标点击或按 1–4 购买 · B 返回 · Esc 菜单</footer></section>`;
    container.querySelector('#close-buy').onclick=close;
    for(const button of container.querySelectorAll('[data-buy]')) button.onclick=()=>{
      if(this.pending||button.disabled)return;
      this.pending=button.dataset.buy; this.pendingAt=performance.now();
      this.message('正在确认购买…'); buy(this.pending); this.update(this.last);
    };
    container.addEventListener('keydown',event=>{if(event.target.matches('input,select,textarea'))return;const i=Number(event.code.slice(-1))-1;if(/^Digit[1-4]$/.test(event.code)&&!event.repeat){event.preventDefault();container.querySelector(`[data-buy="${items[i]}"]`)?.click();}});
  }
  message(text){this.container.querySelector('#shop-result').textContent=text;}
  result(result){this.pending=null;this.message(result.ok?`已装备 ${result.weapon==='armor'?'防弹护甲':getWeapon(result.weapon).name} · 剩余 $${result.money}`:result.message||'购买未完成');this.update(this.last);}
  update(state){
    if(!state)return;this.last=state;const {player:p,mode,round,time}=state;if(!p)return;
    if(this.pending&&performance.now()-this.pendingAt>3500){this.pending=null;this.message('购买确认超时，请重试。');}
    const free=mode==='deathmatch',remaining=Math.max(0,Math.ceil(((round?.buyEndsAt||0)-time)/1000));
    this.container.querySelector('#shop-money').textContent=`$ ${p.money}`;
    this.container.querySelector('#shop-time').textContent=free?'免费补给':`购买时间 ${remaining}s`;
    this.container.querySelector('#buy-note').textContent=p.buyReason||(free?'团队死斗 · 存活时可免费更换':'出生区补给 · 武器费用由服务器结算');
    for(const button of this.container.querySelectorAll('[data-buy]')){
      const id=button.dataset.buy,price=free?0:id==='armor'?650:getWeapon(id).price;
      const reason=!p.alive?'等待重生':p.buyAllowed===false?p.buyReason:p.money<price?'余额不足':id==='armor'&&p.armor>=100?'护甲已满':this.pending?'等待购买确认':'';
      button.disabled=!!reason;button.querySelector('strong').textContent=free?'免费':`$ ${price}`;
      button.querySelector('small').textContent=reason||(p.inventory?.includes(id)?'已持有 · 补充弹药':'点击购买');
    }
  }
}

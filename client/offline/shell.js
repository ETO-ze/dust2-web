import {OFFLINE_VERSION} from './build.js';
import {preferences} from '../persistence.js';
export let frameLimit=[30,60,90,120].includes(Number(preferences.getItem('dust2.offline-fps')))?Number(preferences.getItem('dust2.offline-fps')):60;
export function mountOfflineShell() {
  document.body.classList.add('offline-edition');
  document.title='DUST II — 离线测试版 '+OFFLINE_VERSION;
  const text=(selector,value)=>{const e=document.querySelector(selector);if(e)e.textContent=value;};
  for(const s of ['.join-row','#invite-button','#pause-invite','.room-invite'])document.querySelector(s)?.setAttribute('hidden','');
  text('.room-card .eyebrow','OFFLINE / 5 VS 5');
  text('.menu-profile span:last-of-type','离线测试版 '+OFFLINE_VERSION);
  text('.play-bar-active','本机对局');text('.match-card h2','随时开始一场离线对局');
  text('.bot-setup span','全部在本机运行 · 无需连接服务器');
  text('#menu-status','地图、武器、探员和音乐已随安装包保存。选择阵营后开始。');
  text('#start-button','开始离线对局 →');text('#host-bots-status','最多 9 名机器人，可在房间面板选择双方席位。');
  text('#pause-menu small','打开暂停菜单或切到后台时，对局暂停；继续后恢复。');
  text('.board-footer span','本机对局战绩 · BOT 为机器人');
  text('[data-load-step=download]','01　读取本机资源');text('[data-load-step=connect]','03　启动离线对局');
  text('#room-capacity-note','1 名玩家 + 最多 9 名机器人');
  const row=document.createElement('label');row.className='config-row';row.innerHTML='帧率上限<select aria-label="帧率上限"><option value="30">30 FPS · 省电</option><option value="60">60 FPS · 默认</option><option value="90">90 FPS</option><option value="120">120 FPS</option></select>';
  const select=row.querySelector('select');select.value=frameLimit;select.onchange=()=>{frameLimit=Number(select.value);preferences.setItem('dust2.offline-fps',frameLimit);};document.querySelector('[data-panel=video]').append(row);
  return {refresh(){},dispose(){}};
}

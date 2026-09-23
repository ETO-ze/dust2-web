import {botDifficultyName,normalizeBotDifficulty} from '../shared/bot-difficulty.js';

export function mountBotSettings(settingsUI,{getState,onChange}){
 const modal=settingsUI.element,tab=document.createElement('button'),panel=document.createElement('section');
 tab.dataset.tab='bots';tab.textContent='人机';panel.dataset.panel='bots';panel.hidden=true;
 panel.innerHTML='<h3>人机难度</h3><label class="config-row">难度<select id="bot-difficulty"><option value="easy">轻松 · 手机入门</option><option value="normal">普通 · 默认</option><option value="hard">困难 · 加强配合与枪法</option></select></label><p id="bot-difficulty-status" role="status"></p><p>轻松：反应较慢、瞄准更宽容，连败不会增强。普通保持原有枪法；困难的反应与瞄准精度参数增强约 30%。三档均需要看见目标，平滑转向后开火。</p><p>普通／困难同队连输 2 回合增强一次 50%，连续赢 2 回合恢复。守点位置随回合变化；听到枪声或收到队友报告后分人回防，另一点留人防守。</p><p>进攻包含 A 小集结、A 大夹击、B 区爆弹等路线。携包者只有在时间充足、附近有持枪队友且尚未进入包点时才会辅助投掷。</p><small>创建房间前的选择自动保存在本机。房间内由房主统一设置双方人机；新进攻方案从下一回合采用。</small>';
 modal.querySelector('.config-tabs').append(tab);modal.querySelector('.config-scroll').append(panel);
 const select=panel.querySelector('select'),status=panel.querySelector('[role="status"]');let pending=false,timer;
 function refresh(){
  const state=getState();if(!pending)select.value=normalizeBotDifficulty(state.value);
  select.disabled=pending||(state.connected&&!state.host);
  status.textContent=pending?'正在等待服务器确认…':state.connected?(state.host?'你是房主，修改将同步到整个房间。':`当前房间：${botDifficultyName(state.value)}。只有房主可以修改。`):'创建新房间时使用此难度。';
 }
 function settle(){pending=false;clearTimeout(timer);refresh();}
 select.onchange=()=>{const state=getState();if(state.connected&&!state.host){refresh();return;}
  if(state.connected){pending=true;timer=setTimeout(settle,5000);}
  onChange(normalizeBotDifficulty(select.value));refresh();
 };
 tab.onclick=()=>{modal.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tab));modal.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p!==panel);refresh();};
 const open=settingsUI.open;settingsUI.open=()=>{refresh();open();};
 return {refresh,settle};
}

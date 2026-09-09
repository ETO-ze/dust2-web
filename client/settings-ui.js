import { DEFAULT_CROSSHAIR, normalizeCrosshair, decodeCrosshairCode } from '../shared/cs2-settings.js';
import { Crosshair } from './crosshair.js';

export function mountSettings({controls,crosshair,getSettings,onSettings}) {
  const modal=document.createElement('div');modal.className='overlay settings-overlay';modal.id='settings-menu';modal.hidden=true;
  modal.innerHTML=`<section class="config-card"><header><div><span class="eyebrow">PERSONAL SETTINGS</span><h2>游戏设置</h2></div><button id="close-settings">完成 ×</button></header><nav class="config-tabs"><button data-tab="video">画面</button><button data-tab="mouse" class="selected">鼠标</button><button data-tab="keys">键盘与按键</button><button data-tab="crosshair">准星</button></nav><div class="config-scroll"><section data-panel="video" hidden><h3>画面与亮度</h3><label class="config-row">画质<select id="cs-quality"><option value="low">最低 · 优先流畅</option><option value="high">高 · 阴影与更高清晰度</option></select></label><label class="config-row">亮度 <output id="brightness-value"></output><input id="cs-brightness" aria-label="亮度" type="range" min="60" max="160" step="1"></label><div class="video-calibration"></div><p>进入游戏默认使用最低画质。亮度会同步影响地图、人物和第一人称武器，设置自动保存在本机。</p><button id="reset-video">恢复默认画面</button></section><section data-panel="mouse"><h3>鼠标灵敏度</h3><p>使用 CS 的 sensitivity 数值：未开镜时每个鼠标计数转动 0.022° × 灵敏度。DPI 沿用你的鼠标设置。</p><label class="config-row">游戏内灵敏度<input id="cs-sensitivity" type="number" min="0.05" max="20" step="0.01"></label><label class="config-row">开镜灵敏度倍率<input id="cs-zoom-sensitivity" type="number" min="0.05" max="5" step="0.01"></label><small>优先请求浏览器原始鼠标输入。系统加速是否被绕过，取决于浏览器支持。AWP 右键依次切换 40°、10°、不开镜（4:3 水平视野）。</small></section><section data-panel="keys" hidden><div id="keybindings"></div></section><section data-panel="crosshair" hidden><div class="crosshair-preview"><div id="crosshair-preview-reticle"></div><span>实时预览</span></div><h3>donk · 2026-09-06</h3><p>Spirit vs MOUZ，Nuke 比赛记录。静态准星，薄荷绿，无中心点、无描边。</p><div class="crosshair-import"><input id="crosshair-code" aria-label="CS 准星分享代码" placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"><button id="import-crosshair">导入代码</button></div><p id="crosshair-import-status" role="status"></p><div id="crosshair-fields" class="crosshair-fields"></div><button id="reset-crosshair">恢复 donk 准星</button><a class="settings-source" href="https://totalcsgo.com/crosshairs/donk" target="_blank" rel="noreferrer">查看比赛准星来源 ↗</a></section></div></section>`;
  document.body.append(modal);
  const select=s=>modal.querySelector(s);
  controls.mountSettings(select('#keybindings'));
  const preview=new Crosshair(select('#crosshair-preview-reticle'),{settings:getSettings().crosshair});
  let returnFocus;
  function close(){modal.hidden=true;controls.clear();returnFocus?.focus();}
  select('#close-settings').onclick=close;
  modal.addEventListener('keydown',e=>{if(e.code==='Escape'&&!e.defaultPrevented){close();e.preventDefault();}});
  modal.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
    modal.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===button));
    modal.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==button.dataset.tab);
  });
  for(const [id,key,max] of [['cs-sensitivity','sensitivity',20],['cs-zoom-sensitivity','zoomSensitivity',5]]){
    select('#'+id).value=getSettings()[key];
    select('#'+id).onchange=e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<.05||n>max){e.target.value=getSettings()[key];return;}onSettings({[key]:n});};
  }
  function videoRefresh(){select('#cs-quality').value=getSettings().quality;select('#cs-brightness').value=getSettings().brightness;select('#brightness-value').textContent=`${getSettings().brightness}%`;}
  select('#cs-quality').onchange=e=>onSettings({quality:e.target.value});
  select('#cs-brightness').oninput=e=>{onSettings({brightness:Number(e.target.value)});videoRefresh();};
  select('#reset-video').onclick=()=>{onSettings({quality:'low',brightness:100});videoRefresh();};
  videoRefresh();
  const fields=[['size','长度',0,10,.1],['thickness','粗细',0,5,.1],['gap','间距',-10,10,.1],['alpha','透明度',0,255,1],['red','红',0,255,1],['green','绿',0,255,1],['blue','蓝',0,255,1],['outlineThickness','描边粗细',0,3,.5]];
  select('#crosshair-fields').innerHTML=fields.map(([key,label,min,max,step])=>`<label>${label}<input data-crosshair="${key}" type="number" min="${min}" max="${max}" step="${step}"></label>`).join('')+[['dot','中心点'],['outline','描边'],['tStyle','T 字形']].map(([key,label])=>`<label>${label}<input data-crosshair="${key}" type="checkbox"></label>`).join('');
  function refresh(value){const settings=normalizeCrosshair(value);onSettings({crosshair:settings});crosshair.configure(settings);preview.configure(settings);preview.update({alive:true});for(const el of modal.querySelectorAll('[data-crosshair]')){const v=settings[el.dataset.crosshair];if(el.type==='checkbox')el.checked=!!v;else el.value=v;} }
  const recoilLabel=document.createElement('label');recoilLabel.innerHTML='跟随后坐力<input data-crosshair="followRecoil" type="checkbox">';select('#crosshair-fields').append(recoilLabel);
  for(const el of modal.querySelectorAll('[data-crosshair]'))el.onchange=()=>refresh({...getSettings().crosshair,...(['red','green','blue'].includes(el.dataset.crosshair)?{color:5}:{}),[el.dataset.crosshair]:el.type==='checkbox'?el.checked:Number(el.value)});
  select('#reset-crosshair').onclick=()=>{refresh({...DEFAULT_CROSSHAIR});select('#crosshair-import-status').textContent='已恢复 donk 比赛准星。';};
  select('#import-crosshair').onclick=()=>{try{refresh(decodeCrosshairCode(select('#crosshair-code').value.trim()));select('#crosshair-import-status').textContent='准星已导入并保存。';}catch(error){select('#crosshair-import-status').textContent=error.message;}};
  refresh(getSettings().crosshair);
  return {element:modal,open(){videoRefresh();returnFocus=document.activeElement;controls.clear();modal.hidden=false;select('#close-settings').focus();},close};
}

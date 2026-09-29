import {preferences} from './persistence.js';
import {mobileDevice} from './device-profile.js';
export const FPS_KEY='dust2.frame-limit.v1';
const allowed=[0,30,60,90,120];
const stored=preferences.getItem(FPS_KEY)??preferences.getItem('dust2.offline-fps');
export let frameLimit=stored!==null&&allowed.includes(Number(stored))?Number(stored):(mobileDevice()?60:0);
export function mountFrameSettings(settingsUI){
 const row=document.createElement('label');row.className='config-row';
 row.innerHTML='帧率上限<select id="frame-limit" aria-label="帧率上限"><option value="0">不限制</option><option value="30">30 FPS · 省电</option><option value="60">60 FPS</option><option value="90">90 FPS</option><option value="120">120 FPS</option></select>';
 const select=row.querySelector('select');select.value=frameLimit;select.onchange=()=>{frameLimit=Number(select.value);preferences.setItem(FPS_KEY,frameLimit);};
 settingsUI.element.querySelector('[data-panel=video]').append(row);
}

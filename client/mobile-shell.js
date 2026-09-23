import {initOffline,installApp} from './offline.js';
import {OFFLINE} from './offline/build.js';
import './mobile-shell.css';

import {isAndroidApp,requestGameFullscreen} from '../shared/mobile-fullscreen.js';

export function mountMobileShell({settingsUI,storage,onStatus=()=>{}}){
  const native=isAndroidApp(),prefs=storage.readJSON('dust2.fullscreen.v1');
  let automatic=prefs.automatic!==false,offline={},pending=null;
  const install=document.createElement('section');install.className='mobile-install';install.hidden=true;
  install.innerHTML='<div><b>全屏游玩</b><span>安装客户端，打开即横屏，没有浏览器地址栏。</span></div><div class="mobile-install-actions"><button data-mobile-fullscreen>网页全屏</button><a href="downloads/DustII-Android-1.0.0.apk" download>下载安卓 APK</a><button data-mobile-install>添加到主屏幕</button></div><small role="status"></small>';
  document.querySelector('.match-card').append(install);
  const status=text=>{install.querySelector('small').textContent=text;onStatus(text);};
  const panel=settingsUI.element.querySelector('[data-panel="touch"]');
  const row=document.createElement('label');row.className='config-row';row.hidden=native;row.innerHTML='进入游戏自动请求全屏<input type="checkbox" id="touch-auto-fullscreen">';panel.append(row);
  const check=row.querySelector('input');check.checked=automatic;check.onchange=()=>{automatic=check.checked;storage.setItem('dust2.fullscreen.v1',JSON.stringify({automatic}));};
  const update=()=>{install.hidden=OFFLINE||native||!matchMedia('(pointer: coarse)').matches;install.querySelector('[data-mobile-install]').hidden=offline.installed;};
  initOffline({onStatus:s=>{offline=s;update();}}).catch(()=>{});matchMedia('(pointer: coarse)').addEventListener('change',update);update();
  const enter=(explicit=false)=>{
    if(pending)return pending;
    if(!explicit&&(!automatic||!matchMedia('(pointer: coarse)').matches))return Promise.resolve({fullscreen:false,reason:'disabled'});
    pending=requestGameFullscreen().then(result=>{if(explicit&&!result.fullscreen)status('浏览器未允许全屏。可下载安卓客户端，或在浏览器菜单中安装到主屏幕。');return result;}).finally(()=>{pending=null;});return pending;
  };
  install.querySelector('[data-mobile-fullscreen]').onclick=()=>enter(true);
  install.querySelector('[data-mobile-install]').onclick=async()=>{try{const result=await installApp();status(result.outcome==='accepted'?'安装后请从桌面图标打开。':'打开浏览器菜单，选择「安装应用」或「添加到主屏幕」，再从桌面图标启动。');}catch{status('请从浏览器菜单选择安装应用，或下载安卓 APK。');}};
  return {enter,status:()=>({native,automatic,installed:!!offline.installed,fullscreen:native||!!document.fullscreenElement})};
}

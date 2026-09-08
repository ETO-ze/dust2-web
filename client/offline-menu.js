import { getAssetCacheStats, saveBaseAssets, clearAssetCache } from './loading.js';
import { initOffline, requestPersistentStorage, installApp } from './offline.js';

export function mountOfflineMenu(){
  const modal=document.createElement('div');modal.id='offline-menu';modal.className='overlay settings-overlay';modal.hidden=true;
  modal.innerHTML=`<section class="config-card"><header><div><span class="eyebrow">LOCAL GAME FILES</span><h2>本地资源</h2></div><button id="close-offline">完成 ×</button></header><p>将地图、枪械、动作与声音保存在此浏览器。再次进入时复用本地文件，版本更新只补充变化的资源。</p><div class="local-storage-stats"><b id="cache-size">正在检查…</b><span id="cache-count"></span></div><p id="cache-persistence"></p><div class="load-track"><i id="cache-progress"></i></div><p id="cache-status" role="status"></p><div class="utility-row"><button id="save-base-assets">保存基础游戏资源</button><button id="install-game">安装桌面应用</button><button id="cancel-cache" hidden>取消保存</button></div><small>游戏对局与好友联机仍需连接服务器。额外皮肤只在装备时下载。请在同一浏览器、同一网址使用；清除网站数据会移除本地文件。</small><p><button id="clear-cache">清理本地资源</button></p></section>`;
  document.body.append(modal);const $=id=>modal.querySelector('#'+id);let aborter=null,offline={};
  async function refresh(){try{const state=await getAssetCacheStats();$('cache-size').textContent=`${(state.bytes/1048576).toFixed(1)} MB 已保存`;$('cache-count').textContent=`基础资源 ${state.baseCount} / ${state.totalCount} 个${state.complete?' · 已完整保存':''}`;$('cache-persistence').textContent=state.persisted?'浏览器已授予持久存储。':'点击保存时将申请持久存储；若浏览器未授予，缓存仍可复用，但可能被浏览器回收。';if(!state.supported)$('cache-persistence').textContent='此浏览器暂不支持持久资源缓存。';}catch(e){$('cache-status').textContent=e.message;}}
  initOffline({onStatus:state=>{offline=state;$('install-game').textContent=state.installed?'已安装桌面应用':'安装桌面应用';$('install-game').disabled=!!state.installed;}}).catch(e=>{$('cache-status').textContent=e.message;});
  $('close-offline').onclick=()=>modal.hidden=true;
  modal.addEventListener('keydown',e=>{if(e.code==='Escape'){modal.hidden=true;e.preventDefault();}});
  $('save-base-assets').onclick=async()=>{
    if(aborter)return;aborter=new AbortController();$('save-base-assets').disabled=true;$('cancel-cache').hidden=false;
    await requestPersistentStorage().catch(()=>false);
    try{await saveBaseAssets({signal:aborter.signal,onProgress:p=>{$('cache-progress').style.width=`${p.total?100*p.bytes/p.total:0}%`;$('cache-status').textContent=`正在保存 ${p.complete} / ${p.count} 个文件 · ${(p.bytes/1048576).toFixed(1)} MB`;}});$('cache-status').textContent='基础游戏资源已保存，下次直接从本机读取。';}
    catch(e){$('cache-status').textContent=e.name==='AbortError'?'已暂停，成功保存的文件会保留。':`保存未完成：${e.message}。可再次点击继续。`;}
    finally{aborter=null;$('save-base-assets').disabled=false;$('cancel-cache').hidden=true;await refresh();}
  };
  $('cancel-cache').onclick=()=>aborter?.abort();
  $('install-game').onclick=async()=>{const result=await installApp();$('cache-status').textContent=result.outcome==='accepted'?'桌面应用安装请求已接受。':offline.canInstall?'可稍后再次点击安装。':'请使用浏览器地址栏的「安装应用」，或浏览器菜单中的「添加到主屏幕」。';};
  $('clear-cache').onclick=async()=>{if(aborter)return;await clearAssetCache();$('cache-status').textContent='本地地图与皮肤文件已清理；按键和准星设置已保留。';await refresh();};
  return {element:modal,async open(){modal.hidden=false;$('close-offline').focus();await refresh();}};
}

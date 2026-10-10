import {assetDownloadURL,getDownloadOrigin,initDownloadOrigin} from './download-origin.js';
import {bundled} from './bundled-assets.js';

/** Shared UI art follows the verified delivery config; installed art stays local.
 * Radar/preview URLs outside this document's assets directory stay unchanged. */
export function imageAssetURL(value,pageURL=document.baseURI){
 if(bundled)return value;
 const original=new URL(value,pageURL),mapped=assetDownloadURL(original,{pageURL});
 return mapped.href===original.href?value:mapped.href;
}
export function hydrateHomeImages(root=document){
 for(const image of root.querySelectorAll('img[data-game-src]'))image.src=imageAssetURL(image.dataset.gameSrc);
}
export async function initHomeImages(){
 if(!bundled&&!getDownloadOrigin())await initDownloadOrigin({configURL:'download-config-1.3.0.json',pageURL:document.baseURI});
 hydrateHomeImages();
}
// Hidden <img> still download. Assign map art only after Start/Join, never on
// card selection. Mirage's verified bootstrap supplies its own radar/cover.
export function prepareHomeMapImages(mapId,root=document){
 root.documentElement.style.setProperty('--loading-map-cover','none');
 for(const image of root.querySelectorAll('img[data-map-image]')){
  if(image.dataset.mapImage===mapId)image.src=imageAssetURL(image.dataset.mapSrc);
  else image.removeAttribute('src');
 }
 if(mapId==='de_dust2')root.documentElement.style.setProperty('--loading-map-cover',`url(${JSON.stringify(new URL(imageAssetURL('assets/valve-dust2/de_dust2_1_png.png'),document.baseURI).href)})`);
 else if(globalThis.__DUST2_PRIVATE_MAP__?.mapId===mapId){
  const render=globalThis.__DUST2_PRIVATE_MAP__.renderUrl;
  const radar=new URL('../../../radars/'+mapId+'.png',render).href,cover=new URL('../../../previews/'+mapId+'.png',render).href;
  for(const image of root.querySelectorAll('.loading-tactical img,.map-emblem img')){image.src=radar;image.alt=mapId+' 战术地图';}
  root.documentElement.style.setProperty('--loading-map-cover',`url(${JSON.stringify(cover)})`);
 }
}

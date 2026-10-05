// Public routes intentionally exclude the independent private Inferno preview.
export const PUBLIC_MAPS=Object.freeze([
 Object.freeze({id:'de_dust2',name:'DUST II',nameZh:'炙热沙城 II'}),
 Object.freeze({id:'de_mirage',name:'MIRAGE',nameZh:'米拉吉'}),
]);
export function publicMapForPage(pageURL){
 const path=new URL(pageURL).pathname;
 return PUBLIC_MAPS.find(map=>path==='/play/'+map.id+'/')||PUBLIC_MAPS[0];
}
export function publicMapPage(pageURL,mapId,{room=null}={}){
 if(!PUBLIC_MAPS.some(map=>map.id===mapId))throw Error('地图尚未开放');
 const page=new URL(pageURL);page.pathname='/play/'+mapId+'/';page.search='';page.hash='';
 if(room)page.searchParams.set('room',String(room));
 return page;
}

// Shapes are extracted unchanged from Valve's installed Panorama resources.
const icons=new Set(['ak47','m4a4','m4a1','awp','pistol','usp','elite','p250','fiveseven','deagle','nova','mag7','mp9','mp7','bizon','scar20','ssg08','tec9','xm1014','sawedoff','mac10','galilar','sg553','knife','hegrenade','flashbang','smokegrenade','armor','helmet','defusekit','c4','world','headshot','wallbang','smoke','blind','noscope','airborne','assist','death','health','CT','T','kill','killHeadshot','timer']);
export const uiIconUrl=id=>`assets/ui-cs2/${icons.has(id)?id:'world'}.svg`;
export function uiIcon(id,alt='',className=''){
  const image=document.createElement('img');image.className=`cs2-icon ${className}`.trim();image.src=uiIconUrl(id);image.alt=alt;image.draggable=false;
  if(alt)image.title=alt;else image.setAttribute('aria-hidden','true');return image;
}

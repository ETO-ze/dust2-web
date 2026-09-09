import './scope-overlay.css';
/** The scope uses one central world projection; the mask never rescales it. */
export class ScopeOverlay{
 constructor(element){this.element=element;this.mode='';this.diameter=0;this.dot=document.createElement('i');this.dot.className='optic-dot';this.element.append(this.dot);this.readout=document.getElementById('scope-readout');if(this.readout)this.readout.hidden=true;}
 update({weapon,zoomLevel=0,accuracy=0,verticalFov=74,width=innerWidth,height=innerHeight}){
  const mode=zoomLevel>0?weapon.zoomStyle||'':'';
  if(mode!==this.mode){this.mode=mode;this.element.hidden=!mode;this.element.dataset.mode=mode;this.element.setAttribute('aria-label',mode==='optic'?'步枪光学瞄准镜':'狙击瞄准镜');}
  const diameter=Math.min(width,height)*.98;
  if(this.diameter!==diameter){this.diameter=diameter;this.element.style.setProperty('--scope-radius',`${diameter/2}px`);}
  const pixels=accuracy*height/(2*Math.tan(verticalFov*Math.PI/360));
  // Keep a precise center; only soften the fine hair when moving inaccurately.
  const blur=Math.min(2,Math.max(0,(pixels-2)*.08));
  if(this.blur!==blur){this.blur=blur;this.element.style.setProperty('--scope-blur',`${blur.toFixed(2)}px`);}
 }
}

export const LAYOUT_KEY='dust2.touch-layout.v1';
export const LAYOUT_IDS=['move','fire','altFire','jump','reload','crouch','interact','walk','buy','scoreboard','menu','chatTeam','primary','secondary','knife','utility','bomb','drop','room','fullscreen'];
const bound=(v,a,b,f)=>Number.isFinite(v)?Math.min(b,Math.max(a,v)):f;
export function normalizeLayout(input) {
  const out={version:1,buttons:{}};
  if(input?.version!==1||!input.buttons||typeof input.buttons!=='object')return out;
  for(const id of LAYOUT_IDS){const b=input.buttons[id];if(!b||typeof b!=='object')continue;
    out.buttons[id]={x:bound(b.x,0,1,.5),y:bound(b.y,0,1,.5),size:bound(b.size,.65,1.5,1),opacity:bound(b.opacity,.25,1,.75)};}
  return out;
}
export function parseLayout(text) {
  if(typeof text!=='string'||text.length>16000)throw Error('布局代码过长');
  const value=JSON.parse(text);if(value.version!==1||!value.buttons||typeof value.buttons!=='object')throw Error('布局代码无效');
  return normalizeLayout(value);
}
export function layoutRect(button,base,width,height) {
  const w=Math.min(width,Math.max(44,base.width*button.size)),h=Math.min(height,Math.max(44,base.height*button.size));
  return {left:Math.max(0,Math.min(width-w,button.x*width-w/2)),top:Math.max(0,Math.min(height-h,button.y*height-h/2)),width:w,height:h};
}

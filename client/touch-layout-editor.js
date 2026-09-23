import {LAYOUT_KEY,normalizeLayout,parseLayout,layoutRect} from '../shared/touch-layout.js';
import './touch-layout-editor.css';
const fields=['position','left','top','right','bottom','width','height','min-width','min-height','opacity','transform'];
export function mountTouchLayout(panel,modal,touch) {
  let saved=normalizeLayout(touch.storage.readJSON(LAYOUT_KEY)),draft,selected,bases=new Map();
  const controls=[...touch.element.querySelectorAll('[data-action],[data-touch-command=room],[data-touch-command=fullscreen],.touch-joystick')];
  const id=e=>e.dataset.action||e.dataset.touchCommand||'move';
  function measure(){
    const hidden=touch.element.hidden;touch.element.hidden=false;
    for(const e of controls)for(const f of fields)e.style.removeProperty(f);
    bases=new Map(controls.map(e=>{const b=e.getBoundingClientRect();return[id(e),{width:b.width,height:b.height,x:(b.x+b.width/2)/innerWidth,y:(b.y+b.height/2)/innerHeight}];}));
    touch.element.hidden=hidden;
  }
  function apply(){
    measure();for(const e of controls){const b=saved.buttons[id(e)];if(!b)continue;const r=layoutRect(b,bases.get(id(e)),innerWidth,innerHeight);
      for(const [k,v] of Object.entries({position:'fixed',left:r.left+'px',top:r.top+'px',right:'auto',bottom:'auto',width:r.width+'px',height:r.height+'px','min-width':'0','min-height':'0',opacity:b.opacity,transform:'none'}))e.style.setProperty(k,v,'important');}
  }
  const editor=document.createElement('div');editor.id='touch-layout-editor';editor.hidden=true;editor.setAttribute('role','dialog');editor.setAttribute('aria-modal','true');editor.setAttribute('aria-label','自定义触控布局');
  editor.innerHTML='<div class="layout-stage"></div><header><b>拖动按钮 · 留出中央视野</b><button data-reset>恢复默认</button><button data-code>布局代码</button><button data-cancel>取消</button><button data-save>保存布局</button></header><aside><strong data-name>选择一个按钮</strong><label>大小 <input data-size type="range" min="0.65" max="1.5" step="0.05"></label><label>透明度 <input data-opacity type="range" min="0.25" max="1" step="0.05"></label><div data-share hidden><textarea aria-label="布局代码" spellcheck="false"></textarea><button data-import>导入代码</button></div><p role="status">可多指操作；设置备份会包含布局。</p></aside>';
  document.body.append(editor);const $=s=>editor.querySelector(s),stage=$('.layout-stage');
  function draw(){for(const node of stage.children){const b=draft.buttons[node.dataset.id],r=layoutRect(b,bases.get(node.dataset.id),innerWidth,innerHeight);Object.assign(node.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',opacity:b.opacity});node.classList.toggle('selected',selected===node.dataset.id);}}
  function choose(key){selected=key;const b=draft.buttons[key];$('[data-name]').textContent=stage.querySelector(`[data-id="${key}"]`).textContent;$('[data-size]').value=b.size;$('[data-opacity]').value=b.opacity;draw();}
  let drag=null;
  stage.addEventListener('pointerdown',e=>{const node=e.target.closest('[data-id]');if(!node)return;e.preventDefault();choose(node.dataset.id);drag={pointer:e.pointerId,key:selected,x:e.clientX,y:e.clientY,start:{...draft.buttons[selected]}};node.setPointerCapture(e.pointerId);});
  stage.addEventListener('pointermove',e=>{if(drag?.pointer!==e.pointerId)return;const b=draft.buttons[drag.key];b.x=Math.min(1,Math.max(0,drag.start.x+(e.clientX-drag.x)/innerWidth));b.y=Math.min(1,Math.max(0,drag.start.y+(e.clientY-drag.y)/innerHeight));draw();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,()=>drag=null);
  for(const field of ['size','opacity'])$(`[data-${field}]`).oninput=e=>{if(selected){draft.buttons[selected][field]=Number(e.target.value);draw();}};
  function close(){editor.hidden=true;touch.clear();modal.hidden=false;open.focus();}
  $('[data-save]').onclick=()=>{saved=normalizeLayout(draft);const ok=touch.storage.setItem(LAYOUT_KEY,JSON.stringify(saved));apply();if(!ok){$('p').textContent='存储空间不足，本次布局已应用，请导出代码后再退出。';return;}close();};
  $('[data-cancel]').onclick=close;
  $('[data-reset]').onclick=()=>{draft={version:1,buttons:Object.fromEntries([...bases].map(([key,b])=>[key,{x:b.x,y:b.y,size:1,opacity:.75}]))};choose(selected);};
  $('[data-code]').onclick=()=>{$('[data-share]').hidden=!$('[data-share]').hidden;$('textarea').value=JSON.stringify(normalizeLayout(draft));};
  $('[data-import]').onclick=()=>{try{const imported=parseLayout($('textarea').value);draft.buttons={...draft.buttons,...imported.buttons};choose(selected);$('p').textContent='布局已载入，点击保存生效。';}catch(e){$('p').textContent=e.message;}};
  editor.addEventListener('keydown',e=>{if(e.code==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.code==='Tab'){const nodes=[...editor.querySelectorAll('button,input,textarea')].filter(e=>e.getClientRects().length);const index=nodes.indexOf(document.activeElement);e.preventDefault();nodes[(index+(e.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus();}});
  const open=document.createElement('button');open.textContent='自定义按键布局';open.type='button';panel.append(open);
  open.onclick=()=>{touch.clear();touch.onCancel();measure();draft=normalizeLayout(saved);for(const [key,b] of bases)draft.buttons[key]??={x:b.x,y:b.y,size:1,opacity:.75};apply();stage.replaceChildren();for(const e of controls){const node=document.createElement('button');node.dataset.id=id(e);node.textContent=e.textContent;stage.append(node);}modal.hidden=true;editor.hidden=false;$('[data-share]').hidden=true;choose('fire');$('[data-save]').focus();};
  window.addEventListener('resize',()=>{apply();if(!editor.hidden)draw();});
  panel.addEventListener('input',e=>{if(e.target.id==='touch-size')apply();});apply();
}

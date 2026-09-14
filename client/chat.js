import './chat.css';
export class GameChat{
  constructor({send,onOpen,onClose}){
    Object.assign(this,{send,onOpen,onClose});this.opened=false;this.channel='all';this.rows=[];
    this.element=document.createElement('section');this.element.id='game-chat';this.element.hidden=true;this.element.setAttribute('aria-label','游戏聊天');
    this.element.innerHTML='<div class="chat-log" role="log" aria-live="polite"></div><form class="chat-form" hidden><button type="button" class="chat-channel">全体</button><input aria-label="聊天消息" maxlength="160" autocomplete="off" placeholder="输入消息…"/><button type="submit">发送</button><button type="button" class="chat-close" aria-label="关闭聊天">×</button></form><span class="chat-status" role="status"></span>';
    document.body.append(this.element);this.form=this.element.querySelector('form');this.input=this.element.querySelector('input');this.log=this.element.querySelector('.chat-log');
    this.input.addEventListener('compositionstart',()=>this.composing=true);this.input.addEventListener('compositionend',()=>{this.composing=false;this.compositionEndedAt=performance.now();});
    this.form.onsubmit=e=>{e.preventDefault();if(this.composing||performance.now()-(this.compositionEndedAt||-Infinity)<80)return;if(this.input.value.trim())this.send({type:'chat',channel:this.channel,text:this.input.value});this.close();};
    this.form.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;if(e.code==='Escape'){e.preventDefault();e.stopPropagation();this.close();}else if(e.code==='Tab'){e.preventDefault();this.setChannel(this.channel==='all'?'team':'all');}});
    this.form.querySelector('.chat-channel').onclick=()=>{this.setChannel(this.channel==='all'?'team':'all');this.input.focus();};this.form.querySelector('.chat-close').onclick=()=>this.close();
    this.viewportChanged=()=>{const mobile=document.body.classList.contains('touch-device'),vv=window.visualViewport;this.element.style.bottom=this.opened&&mobile?`${Math.max(12,innerHeight-(vv?.height||innerHeight)-(vv?.offsetTop||0)+12)}px`:'';this.log.style.maxHeight=this.opened&&mobile?`${Math.max(40,Math.min(160,(vv?.height||innerHeight)*.3))}px`:'';};window.visualViewport?.addEventListener('resize',this.viewportChanged);window.visualViewport?.addEventListener('scroll',this.viewportChanged);
    this.timer=setInterval(()=>{for(const r of this.rows)r.node.classList.toggle('old',performance.now()-r.at>10000);},1000);
  }
  setChannel(channel){this.channel=channel;this.form.querySelector('.chat-channel').textContent=channel==='team'?'队伍':'全体';}
  open(channel='all'){this.opened=true;this.setChannel(channel);this.element.classList.add('open');this.form.hidden=false;this.element.querySelector('.chat-status').textContent='';this.onOpen();this.viewportChanged();this.input.focus({preventScroll:true});}
  close(resume=true){if(!this.opened)return;this.opened=false;this.form.hidden=true;this.input.value='';this.input.blur();this.element.classList.remove('open');this.viewportChanged();if(resume)this.onClose();}
  receive(e){if(e.type!=='chat')return;const row=document.createElement('div');row.className='chat-line';const who=document.createElement('b');who.style.color=e.team==='CT'?'#93b9ec':'#e9c56d';who.textContent=`${e.dead?'*阵亡* ':''}${e.channel==='team'?'(队伍) ':''}${e.bot?'BOT ':''}${e.name}：`;
    const text=document.createElement('span');text.textContent=e.text;row.append(who,text);this.log.append(row);this.rows.push({node:row,at:performance.now()});while(this.rows.length>50)this.rows.shift().node.remove();this.log.scrollTop=this.log.scrollHeight;}
  error(message){this.element.querySelector('.chat-status').textContent=message;setTimeout(()=>{this.element.querySelector('.chat-status').textContent='';},4000);}
  reset(){this.close(false);this.rows=[];this.log.replaceChildren();}
}

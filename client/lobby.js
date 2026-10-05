import {preferences} from './persistence.js';
import './lobby.css';
export function mountLobby({connection,onJoin,mapId='de_dust2'}){
 const element=document.createElement('section');element.className='public-lobby';element.innerHTML='<header><div><span class="eyebrow">COMMUNITY ROOMS</span><h3>联机大厅</h3></div><button type="button" data-refresh>刷新房间</button></header><p data-status role="status">正在获取在线房间…</p><div class="public-rooms"></div><button type="button" data-recover hidden>重新加入上次房间</button>';
 document.querySelector('.match-card').append(element);
 let socket=null,timer=null,requestTimer=null,busy=false,disposed=false;
 const entry=document.createElement('button');entry.id='menu-lobby';entry.textContent='联机大厅';entry.type='button';entry.onclick=()=>{if(disposed)return;element.scrollIntoView({behavior:'smooth',block:'center'});refresh();};document.querySelector('.main-nav').append(entry);
 const status=element.querySelector('[data-status]'),list=element.querySelector('.public-rooms'),recover=element.querySelector('[data-recover]');
 function join(code){if(disposed)return;document.getElementById('room-code').value=code;onJoin(code);}
 function render(rooms){
  if(disposed)return;
  list.replaceChildren();entry.textContent=rooms.length?`联机大厅 (${rooms.length})`:'联机大厅';status.textContent=rooms.length?'加入已有房间时，玩家将替换人机席位。':'当前地图暂无在线房间。';
  for(const room of rooms){const row=document.createElement('button');row.className='public-room';row.disabled=!room.joinable;
   const title=document.createElement('b');title.textContent=room.code+' · '+(room.mode==='defuse'?'竞技爆破':'团队死斗');
   const info=document.createElement('span');info.textContent=`${room.humans} 名玩家 · ${room.bots} 名人机 · ${room.scores.CT}:${room.scores.T} · ${room.joinable?'加入 →':'已满 / 已结束'}`;
   row.append(title,info);row.onclick=()=>join(room.code);list.append(row);
  }
  const last=preferences.readJSON('dust2.last-session'),sameMap=(last.mapId??'de_dust2')===mapId;
  recover.hidden=!sameMap||!rooms.some(r=>r.code===last.room&&r.joinable);recover.onclick=recover.hidden?null:()=>join(last.room);
 }
 function refresh(){
  if(disposed||busy||document.hidden||document.getElementById('menu').hidden)return;
  busy=true;socket=new WebSocket(connection.socketURL);const current=socket;
  requestTimer=setTimeout(()=>{if(!disposed&&socket===current)current.close();},5000);
  current.onopen=()=>{if(!disposed&&socket===current)current.send(JSON.stringify({type:'listRooms'}));};
  current.onmessage=e=>{if(disposed||socket!==current)return;try{const data=JSON.parse(e.data);if(data.type==='rooms'&&Array.isArray(data.rooms)){render(data.rooms);clearTimeout(requestTimer);requestTimer=null;current.close();}}catch{}};
  current.onerror=()=>{if(!disposed&&socket===current)status.textContent='暂时无法获取房间，点击刷新重试。';};
  current.onclose=()=>{if(disposed||socket!==current)return;clearTimeout(requestTimer);requestTimer=null;busy=false;socket=null;};
 }
 element.querySelector('[data-refresh]').onclick=refresh;
 const onVisibility=()=>{if(!document.hidden)refresh();};
 timer=setInterval(refresh,10000);document.addEventListener('visibilitychange',onVisibility);refresh();
 return {refresh,dispose(){if(disposed)return;disposed=true;clearInterval(timer);clearTimeout(requestTimer);requestTimer=null;document.removeEventListener('visibilitychange',onVisibility);const current=socket;socket=null;busy=false;if(current){current.onopen=null;current.onmessage=null;current.onerror=null;current.onclose=null;current.close();}element.remove();entry.remove();}};
}

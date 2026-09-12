import {preferences} from './persistence.js';
import './lobby.css';
export function mountLobby({connection,onJoin}){
 const element=document.createElement('section');element.className='public-lobby';element.innerHTML='<header><div><span class="eyebrow">COMMUNITY ROOMS</span><h3>联机大厅</h3></div><button type="button" data-refresh>刷新房间</button></header><p data-status role="status">正在获取在线房间…</p><div class="public-rooms"></div><button type="button" data-recover hidden>重新加入上次房间</button>';
 document.querySelector('.match-card').append(element);
 const entry=document.createElement('button');entry.id='menu-lobby';entry.textContent='联机大厅';entry.type='button';entry.onclick=()=>{element.scrollIntoView({behavior:'smooth',block:'center'});refresh();};document.querySelector('.main-nav').append(entry);
 let socket=null,timer=null,busy=false;
 const status=element.querySelector('[data-status]'),list=element.querySelector('.public-rooms'),recover=element.querySelector('[data-recover]');
 function join(code){document.getElementById('room-code').value=code;onJoin(code);}
 function render(rooms){
  list.replaceChildren();entry.textContent=rooms.length?`联机大厅 (${rooms.length})`:'联机大厅';status.textContent=rooms.length?'优先加入已有玩家的房间；加入时会自动腾出人机席位。':'暂无玩家在线，可以创建一个房间。';
  for(const room of rooms){const row=document.createElement('button');row.className='public-room';row.disabled=!room.joinable;
   const title=document.createElement('b');title.textContent=room.code+' · '+(room.mode==='defuse'?'竞技爆破':'团队死斗');
   const info=document.createElement('span');info.textContent=`${room.humans} 名玩家 · ${room.bots} 名人机 · ${room.scores.CT}:${room.scores.T} · ${room.joinable?'加入 →':'已满 / 已结束'}`;
   row.append(title,info);row.onclick=()=>join(room.code);list.append(row);
  }
  const last=preferences.readJSON('dust2.last-session');recover.hidden=!rooms.some(r=>r.code===last.room&&r.joinable);recover.onclick=()=>join(last.room);
 }
 function refresh(){
  if(busy||document.hidden||document.getElementById('menu').hidden)return;
  busy=true;socket=new WebSocket(connection.socketURL);const current=socket;
  const timeout=setTimeout(()=>current.close(),5000);
  current.onopen=()=>current.send(JSON.stringify({type:'listRooms'}));
  current.onmessage=e=>{try{const data=JSON.parse(e.data);if(data.type==='rooms'){render(data.rooms);current.close();}}catch{}};
  current.onerror=()=>{status.textContent='暂时无法获取房间，点击刷新重试。';};
  current.onclose=()=>{clearTimeout(timeout);busy=false;if(socket===current)socket=null;};
 }
 element.querySelector('[data-refresh]').onclick=refresh;
 timer=setInterval(refresh,10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();
 return {refresh,dispose(){clearInterval(timer);socket?.close();}};
}

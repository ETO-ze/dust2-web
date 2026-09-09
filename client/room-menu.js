import './room-menu.css';

export class RoomMenu {
  constructor({send,invite,onClose}){
    this.send=send;this.onClose=onClose;
    this.element=document.createElement('div');this.element.id='room-menu';this.element.className='overlay';this.element.hidden=true;
    this.element.innerHTML='<section class="room-card"><header><div><div class="eyebrow">PLAY WITH FRIENDS / 5 VS 5</div><h2>对战房间 <span class="room-code"></span></h2></div><button class="room-close" aria-label="关闭房间面板">×</button></header><p class="room-description">选择空位加入阵营。房主可以在空位添加人机；爆破回合中换队需等待下一回合。</p><div class="room-teams"></div><footer><span class="room-status" role="status"></span><button class="room-invite">复制邀请链接</button><button class="primary-button room-play">返回游戏</button></footer></section>';
    document.body.append(this.element);
    this.element.querySelector('.room-invite').onclick=invite;
    this.element.querySelector('.room-close').onclick=()=>this.close();
    this.element.querySelector('.room-play').onclick=()=>this.close(true);
    this.element.addEventListener('keydown',e=>{if(e.code==='Escape'){e.preventDefault();e.stopPropagation();this.close();}});
    this.element.querySelector('.room-teams').addEventListener('click',e=>{
      const b=e.target.closest('button[data-action]');if(!b)return;
      if(this.busy)return;this.busy=true;this.element.querySelectorAll('[data-action]').forEach(b=>b.disabled=true);setTimeout(()=>{this.busy=false;this.element.querySelectorAll('[data-action]').forEach(b=>b.disabled=false);},340);
      send({type:b.dataset.action,team:b.dataset.team,seat:Number(b.dataset.seat),...(b.dataset.action==='setSeatBot'?{enabled:b.dataset.enabled==='true'}:{})});
    });
  }
  open(){this.element.hidden=false;document.exitPointerLock?.();this.element.querySelector('.room-close').focus();}
  close(resume=false){this.element.hidden=true;this.onClose?.(resume);}
  update(snapshot,myId){
    this.snapshot=snapshot;this.myId=myId;if(!snapshot?.seats)return;
    const key=JSON.stringify([snapshot.room,snapshot.hostId,snapshot.seats]);if(key===this.key)return;this.key=key;
    this.element.querySelector('.room-code').textContent=snapshot.room;
    const host=snapshot.hostId===myId,container=this.element.querySelector('.room-teams');container.replaceChildren();
    for(const team of ['CT','T']){
      const column=document.createElement('section');column.className='room-team '+team.toLowerCase();
      const heading=document.createElement('h3');heading.textContent=`${team==='CT'?'反恐精英':'恐怖分子'} · ${snapshot.seats[team].filter(s=>s.playerId).length} / 5`;column.append(heading);
      for(const seat of snapshot.seats[team]){
        const row=document.createElement('div');row.className='room-seat'+(seat.playerId===myId?' is-self':'');row.dataset.team=team;row.dataset.seat=seat.seat;
        const number=document.createElement('span');number.className='seat-number';number.textContent=String(seat.seat+1).padStart(2,'0');row.append(number);
        const label=document.createElement('div');label.className='seat-label';const name=document.createElement('strong'),detail=document.createElement('small');
        name.textContent=seat.name||'空位';detail.textContent=seat.playerId?`${seat.bot?'人机':seat.playerId===myId?'你':'玩家'}${seat.host?' · 房主':''}`:'等待玩家加入';label.append(name,detail);row.append(label);
        const button=(text,action,enabled)=>{const b=document.createElement('button');b.textContent=text;b.disabled=!!this.busy;Object.assign(b.dataset,{action,team,seat:seat.seat,enabled:String(enabled)});row.append(b);};
        if(!seat.playerId){button('加入','takeSeat');if(host)button('+ 人机','setSeatBot',true);}
        else if(seat.bot&&host)button('移除','setSeatBot',false);
        column.append(row);
      }
      container.append(column);
    }
    this.element.querySelector('.room-status').textContent=host?'你是房主 · 点击 + 人机设置对阵':'点击空位换队 · 人机由房主管理';
  }
}

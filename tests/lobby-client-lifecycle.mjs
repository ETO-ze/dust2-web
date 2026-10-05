import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../client/lobby.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'').replace('export function mountLobby','function mountLobby');
class Element {
 constructor(){this.children=[];this.selectors=new Map();this.writes=0;this.hidden=false;this.value='';this._text='';}
 set textContent(value){this._text=value;this.writes++;}
 get textContent(){return this._text;}
 append(...children){for(const child of children){child.parent=this;this.children.push(child);}this.writes++;}
 replaceChildren(...children){this.children=[];this.append(...children);}
 querySelector(selector){if(!this.selectors.has(selector))this.selectors.set(selector,new Element());return this.selectors.get(selector);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.removed=true;}
 scrollIntoView(){this.scrolled=true;}
}
function fixture(last={}){
 const card=new Element(),nav=new Element(),menu=new Element(),roomCode=new Element(),events=new Map(),intervals=new Map(),timeouts=new Map(),sockets=[],joined=[];
 let timerId=0,lastSession=last;
 const document={hidden:false,createElement:()=>new Element(),querySelector:selector=>selector==='.match-card'?card:nav,
  getElementById:id=>id==='menu'?menu:roomCode,
  addEventListener(type,handler){if(!events.has(type))events.set(type,new Set());events.get(type).add(handler);},
  removeEventListener(type,handler){events.get(type)?.delete(handler);}};
 class Socket {
  constructor(url){this.url=url;this.sent=[];this.closeCount=0;sockets.push(this);}
  send(message){this.sent.push(JSON.parse(message));}
  close(){this.closeCount++;}
 }
 const context=vm.createContext({document,WebSocket:Socket,preferences:{readJSON:()=>lastSession},
  setTimeout:fn=>{const id=++timerId;timeouts.set(id,fn);return id;},clearTimeout:id=>timeouts.delete(id),
  setInterval:fn=>{const id=++timerId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)});
 vm.runInContext(source+'\nglobalThis.mountLobby=mountLobby;',context);
 const mount=options=>context.mountLobby({connection:{socketURL:'wss://game.test/ws'},onJoin:code=>joined.push(code),...options});
 const rooms=[{code:'SHARED',mode:'defuse',humans:1,bots:9,scores:{CT:0,T:0},joinable:true}];
 function reply(socket=sockets.at(-1)){socket.onmessage({data:JSON.stringify({type:'rooms',rooms})});socket.onclose?.();}
 return{mount,reply,setLast:value=>lastSession=value,card,nav,roomCode,events,intervals,timeouts,sockets,joined};
}

test('legacy last-session codes recover only on Dust II, while explicit map identity recovers on its own map',()=>{
 for(const [options,last,visible]of [
  [{},{room:'SHARED'},true],
  [{mapId:'de_mirage'},{room:'SHARED'},false],
  [{mapId:'de_mirage'},{room:'SHARED',mapId:'de_dust2'},false],
  [{mapId:'de_mirage'},{room:'SHARED',mapId:'de_mirage'},true],
  [{},{room:'SHARED',mapId:'de_mirage'},false],
 ]){
  const f=fixture(last),lobby=f.mount(options);f.reply();
  const recover=f.card.children[0].querySelector('[data-recover]');assert.equal(recover.hidden,!visible);
  if(visible){recover.onclick();assert.deepEqual(f.joined,['SHARED']);assert.equal(f.roomCode.value,'SHARED');}
  else assert.equal(recover.onclick,null);
  lobby.dispose();
 }
});

test('dispose closes the pending listing, removes owned DOM/listener/timers, and ignores saved late callbacks',()=>{
 const f=fixture({room:'SHARED'}),lobby=f.mount(),socket=f.sockets[0],section=f.card.children[0],entry=f.nav.children[0];
 const saved={open:socket.onopen,message:socket.onmessage,error:socket.onerror,close:socket.onclose,visibility:[...f.events.get('visibilitychange')][0]};
 const status=section.querySelector('[data-status]'),statusWrites=status.writes,list=section.querySelector('.public-rooms'),listWrites=list.writes;
 assert.equal(f.intervals.size,1);assert.equal(f.timeouts.size,1);
 lobby.dispose();lobby.dispose();
 assert.equal(socket.closeCount,1);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);assert.equal(f.events.get('visibilitychange').size,0);
 assert.equal(f.card.children.length,0);assert.equal(f.nav.children.length,0);
 assert.equal(section.removed,true);assert.equal(entry.removed,true);
 saved.open();saved.message({data:JSON.stringify({type:'rooms',rooms:[]})});saved.error();saved.close();saved.visibility();entry.onclick();lobby.refresh();
 assert.equal(socket.sent.length,0);assert.equal(f.sockets.length,1);assert.equal(status.writes,statusWrites);assert.equal(list.writes,listWrites);assert.deepEqual(f.joined,[]);
 assert.equal(socket.onopen,null);assert.equal(socket.onmessage,null);assert.equal(socket.onerror,null);assert.equal(socket.onclose,null);
});

test('remount owns exactly one directory and a stale close cannot clear the new pending request',()=>{
 const f=fixture(),old=f.mount(),staleClose=f.sockets[0].onclose;old.dispose();const current=f.mount({mapId:'de_mirage'}),socket=f.sockets[1];
 assert.equal(f.card.children.length,1);assert.equal(f.nav.children.length,1);assert.equal(f.events.get('visibilitychange').size,1);
 staleClose();current.refresh();assert.equal(f.sockets.length,2);assert.equal(f.timeouts.size,1);
 socket.onopen();assert.deepEqual(socket.sent,[{type:'listRooms'}]);
 f.reply(socket);assert.equal(f.timeouts.size,0);current.refresh();assert.equal(f.sockets.length,3);assert.equal(f.timeouts.size,1);
 current.dispose();assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);
});

import {mountRoomDirectory} from '../scripts/maps/mode-ui/room-directory.js';
import '../scripts/maps/mode-ui/room-directory.css';
import {preferences} from './persistence.js';

export function mountGameRoomDirectory(map, join) {
  const menu = document.getElementById('menu'), loading = document.getElementById('loading-screen');
  const section = document.createElement('section');
  section.className = 'room-directory game-room-directory';
  section.setAttribute('aria-label', '全部地图在线房间');
  menu.querySelector('.menu-content').append(section);
  const entry = document.createElement('button');
  entry.id = 'menu-lobby';
  entry.type = 'button';
  entry.textContent = '联机大厅';
  document.querySelector('.main-nav').append(entry);
  const directory = mountRoomDirectory(section, {
    graphics:() => map.graphicsMode === 'quality' ? 'quality' : 'performance',
    visible:() => !menu.hidden && loading.hidden,
    lastSession:() => preferences.readJSON('dust2.last-session'),
    onCount:count => { entry.textContent = count ? '联机大厅 (' + count + ')' : '联机大厅'; },
    onJoin(event, room) {
      const nickname = document.getElementById('nickname').value.trim();
      preferences.setItem('dust2.name', nickname || 'Player');
      if (room.mapId === map.id && join(room)) event.preventDefault();
    },
  });
  entry.onclick = () => {
    section.scrollIntoView({behavior:'smooth', block:'center'});
    directory.refresh();
  };
  const observer = new MutationObserver(directory.syncVisibility);
  for (const element of [menu, loading]) observer.observe(element, {attributes:true, attributeFilter:['hidden']});
  return {dispose() {
    observer.disconnect();
    directory.dispose();
    section.remove();
    entry.remove();
  }};
}

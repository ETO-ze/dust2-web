import {PERFORMANCE_MAPS} from '../shared/performance-map-pool.js';
import '../scripts/maps/mode-ui/portal-theme.css';
import './portal-room.css';

export function mountPortalRoom(id, graphicsMode) {
  const map = PERFORMANCE_MAPS.find(item => item.id === id);
  if (!map) return;
  const library = '/perf/?' + new URLSearchParams({map:id, mode:graphicsMode});
  const modeName = graphicsMode === 'quality' ? '高画质' : '高帧率';
  const menu = document.querySelector('#menu');
  document.body.classList.add('portal-room');
  const header = menu.querySelector('.menu-header');
  const brand = header.querySelector('.wordmark');
  brand.className = 'portal-brand';
  brand.href = library;
  brand.setAttribute('aria-label','DUSKRAIN 对战平台，返回地图与画面');
  brand.innerHTML = '<span class="portal-mark" aria-hidden="true"><i></i><i></i><i></i></span><strong>DUSKRAIN</strong><span class="portal-product">对战平台</span>';
  const loadingBrand = document.querySelector('#loading-screen .loading-header .wordmark');
  loadingBrand.replaceWith(brand.cloneNode(true));
  document.querySelector('#loading-screen .loading-map-title .eyebrow').textContent = '加载对局';
  header.querySelector('#menu-play-tab').textContent = '对战准备';
  const main = menu.querySelector('.menu-content');
  const title = document.createElement('div');
  title.className = 'portal-page-heading';
  title.innerHTML = '<h1>对战准备</h1><a>返回地图与画面 <span aria-hidden="true">↗</span></a>';
  title.querySelector('a').href = library;
  main.before(title);

  const hero = main.querySelector('.map-showcase');
  const rules = hero.querySelector('.map-rules');
  hero.replaceChildren();
  hero.removeAttribute('aria-labelledby');
  hero.setAttribute('aria-label', map.nameZh + ' · ' + modeName);
  hero.innerHTML = '<div class="portal-map-art"><img alt=""><span class="portal-mode"></span><div class="portal-map-caption"><div class="portal-map-zh"></div><h2 lang="en"></h2></div></div>';
  hero.querySelector('.portal-mode').textContent = modeName;
  hero.querySelector('.portal-map-zh').textContent = map.nameZh;
  hero.querySelector('h2').textContent = map.name;
  hero.append(rules);
  const cover = '/perf/mode-previews/' + map.id + '-' + graphicsMode + '.webp';
  const picture = hero.querySelector('img');
  picture.addEventListener('error', () => {
    picture.classList.add('portal-radar');
    picture.src = '/perf/radars/' + map.id + '.png';
  }, {once:true});
  picture.src = cover;
  document.documentElement.style.setProperty('--loading-map-cover', 'url("' + cover + '")');
  const card = main.querySelector('.match-card');
  card.querySelector('.match-heading').hidden = true;
  card.querySelector('label[for="map-style"]').hidden = true;
  card.querySelector('#home-match-title').textContent = '创建或加入房间';
  for (const link of document.querySelectorAll('[data-map-library]')) {
    link.href = library;
    link.textContent = '地图与画面';
  }
  document.title = map.nameZh + ' · ' + modeName + ' · DUSKRAIN';
}

const $ = (id) => document.getElementById(id);
const storageKey = 'duskrain.map-graphics.v1';
const modeLabels = { quality: '高画质', performance: '高帧率' };
const validMode = value => Object.hasOwn(modeLabels, value);
const query = new URLSearchParams(location.search);
const radios = [...document.querySelectorAll('input[name="mode"]')];
const rail = $('rail');
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}
let preferred = [query.get('mode'), saved.mode].find(validMode) || 'performance';
let maps = [];
let selected;
let currentMode;
let images = {};
let comparing = false;
let cards = [];
const failedFiles = new Set();

if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) $('environment').hidden = false;

async function json(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function remember() {
  try { localStorage.setItem(storageKey, JSON.stringify({ map: selected.id, mode: preferred })); } catch {}
  const url = new URL(location.href);
  if (url.searchParams.has('map') || url.searchParams.has('mode')) {
    url.searchParams.set('map', selected.id);
    url.searchParams.set('mode', preferred);
    history.replaceState(null, '', url);
  }
}

function imageURL(file) {
  if (typeof file !== 'string' || !/^[a-z0-9][a-z0-9_.-]*\.(webp|avif|jpe?g|png)$/i.test(file) || failedFiles.has(file)) return null;
  return '/perf/mode-previews/' + file;
}

function showImage(element, file) {
  const url = imageURL(file);
  element.hidden = !url;
  if (!url) {
    element.removeAttribute('src');
    return;
  }
  if (element.getAttribute('src') === url) return;
  element.onerror = () => {
    failedFiles.add(file);
    renderScene();
  };
  element.src = url;
}

function setSplit(value) {
  $('split').value = String(value);
  $('split').setAttribute('aria-valuetext', '高画质 ' + value + '%');
  $('scene').style.setProperty('--split', value + '%');
}

function renderScene() {
  const assets = images[selected.id] || {};
  const hasPair = selected.qualityURL && assets.aligned === true && imageURL(assets.quality) && imageURL(assets.performance);
  if (!hasPair) comparing = false;
  const sceneFile = comparing ? assets.quality : assets[currentMode];
  const sceneURL = imageURL(sceneFile);
  showImage($('world'), sceneFile);
  showImage($('after'), comparing ? assets.performance : null);
  if (!sceneURL) $('largeRadar').src = '/perf/radars/' + selected.id + '.png';
  $('radarArt').hidden = !!sceneURL;
  $('compare').hidden = !hasPair;
  $('compare').setAttribute('aria-pressed', String(comparing));
  $('compare').querySelector('span').textContent = comparing ? '退出对比' : '画面对比';
  $('sceneType').textContent = comparing ? '同视角对比' : (sceneURL ? modeLabels[currentMode] + '预览' : '地图雷达');
  $('scene').classList.toggle('comparing', comparing);
  $('wipe').hidden = !comparing;
  $('mapZh').textContent = selected.nameZh;
  $('mapName').textContent = selected.name;
  $('scene').setAttribute('aria-label', selected.nameZh + ' · ' + $('sceneType').textContent);
}

function update() {
  currentMode = preferred === 'quality' && selected.qualityURL ? 'quality' : 'performance';
  for (const button of radios) {
    button.disabled = button.value === 'quality' && !selected.qualityURL;
    button.checked = button.value === currentMode;
  }
  $('qualityNote').textContent = selected.qualityURL ? '原版地图材质与场景细节' : '此地图暂供高帧率模式';
  const launch = $('enter');
  launch.href = currentMode === 'quality' ? selected.qualityURL : selected.performanceURL;
  launch.setAttribute('aria-label', '进入对战，' + selected.nameZh + '，' + modeLabels[currentMode]);
  for (const card of cards) card.setAttribute('aria-pressed', String(card.dataset.map === selected.id));
  comparing = false;
  renderScene();
  $('announce').textContent = selected.nameZh + '，' + modeLabels[currentMode];
}

function visibleMaps() { return $('filter').checked ? maps.filter(map => map.qualityURL) : maps; }

function buildCards() {
  const visible = visibleMaps();
  cards = visible.map(map => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.dataset.map = map.id;
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'lazy';
    const thumbnail = imageURL(images[map.id]?.thumbnail);
    const useRadar = () => {
      image.onerror = null;
      image.className = 'card-radar';
      image.src = '/perf/radars/' + map.id + '.png';
    };
    if (thumbnail) { image.onerror = useRadar; image.src = thumbnail; } else useRadar();
    const caption = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = map.nameZh;
    const english = document.createElement('small');
    english.lang = 'en';
    english.textContent = map.name;
    caption.append(name, english);
    card.append(image, caption);
    card.setAttribute('aria-pressed', String(map === selected));
    card.addEventListener('click', () => {
      selected = map;
      update();
      remember();
    });
    return card;
  });
  rail.replaceChildren(...cards);
  $('mapCount').textContent = visible.length + ' 张';
  requestAnimationFrame(scrollButtons);
}

function scrollButtons() {
  const limit = rail.scrollWidth - rail.clientWidth;
  document.querySelector('.pages').hidden = limit < 3;
  $('back').disabled = rail.scrollLeft < 2;
  $('next').disabled = rail.scrollLeft >= limit - 2;
}

function scrollMaps(direction) {
  const step = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : rail.clientWidth;
  rail.scrollBy({ left: direction * step * Math.max(1, Math.floor(rail.clientWidth / step)), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

function revealSelected() {
  const card = cards.find(item => item.dataset.map === selected.id);
  if (card) rail.scrollLeft += card.getBoundingClientRect().left - rail.getBoundingClientRect().left;
}

async function load() {
  $('loading').hidden = false;
  $('problem').hidden = true;
  try {
    const [catalog, entries, previews] = await Promise.all([
      json('/perf/catalog.json'),
      json('/perf/graphics.json'),
      json('/perf/mode-previews/previews.json').catch(() => ({ maps: {} })),
    ]);
    const routes = new Map(entries.maps.map(route => [route.id, route]));
    images = previews.maps || {};
    maps = catalog.maps.filter(map => /^de_[a-z0-9_]+$/.test(map.id) && routes.get(map.id)?.performanceURL)
      .map(map => ({ ...map, ...routes.get(map.id) }));
    if (!maps.length) throw new Error('empty');
    selected = [query.get('map'), saved.map, 'de_dust2'].map(id => maps.find(map => map.id === id)).find(Boolean) || maps[0];
    $('setup').hidden = false;
    $('reset').hidden = false;
    $('filter').disabled = !maps.some(map => map.qualityURL);
    buildCards();
    update();
    revealSelected();
  } catch {
    $('setup').hidden = true;
    $('reset').hidden = true;
    $('problem').hidden = false;
  } finally {
    $('loading').hidden = true;
  }
}

for (const radio of radios) radio.addEventListener('change', () => {
  preferred = radio.value;
  update();
  remember();
});
$('compare').addEventListener('click', () => {
  comparing = !comparing;
  if (comparing) setSplit(50);
  renderScene();
});
$('split').addEventListener('input', e => setSplit(e.currentTarget.value));
$('filter').addEventListener('change', () => {
  const visible = visibleMaps();
  if (!visible.includes(selected)) {
    selected = visible[0];
    update();
    remember();
  }
  buildCards();
  revealSelected();
});
$('reset').addEventListener('click', () => {
  preferred = 'performance';
  selected = maps.find(map => map.id === 'de_dust2') || maps[0];
  $('filter').checked = false;
  if (query.has('map') || query.has('mode')) {
    const url = new URL(location.href);
    url.searchParams.delete('map');
    url.searchParams.delete('mode');
    history.replaceState(null, '', url);
  }
  buildCards();
  update();
  remember();
  revealSelected();
});
$('retry').addEventListener('click', load);
$('back').addEventListener('click', () => scrollMaps(-1));
$('next').addEventListener('click', () => scrollMaps(1));
rail.addEventListener('scroll', scrollButtons, { passive: true });
window.addEventListener('resize', scrollButtons);
load();

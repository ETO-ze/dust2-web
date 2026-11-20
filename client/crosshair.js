import { DEFAULT_CROSSHAIR, normalizeCrosshair } from '../shared/cs2-settings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = [[255,0,0], [0,255,0], [255,255,0], [0,0,255], [0,255,255]];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Classic share codes predate CS2's September 2026 pixel-based settings.
// The old engine's line dimensions round ties to even; its gap is an integer
// pixel offset from the edge of the perpendicular bar, independent of height.
function roundEven(value) {
  const lower = Math.floor(value);
  return value - lower === .5 ? lower + (lower % 2) : Math.round(value);
}

export function crosshairGeometry(settings, state = {}) {
  const s = normalizeCrosshair(settings);
  const scale = clamp(Number(state.viewportHeight) || 1080, 1, 16384) / 480;
  const sx = state.stretchX || 1, sy = state.stretchY || 1;
  const thickness = Math.max(1, roundEven(s.thickness * scale));
  const length = Math.max(0, roundEven(s.size * scale));
  const base = s.gapUseWeaponValue ? (state.weaponGap ?? 4) : 4;
  const spread = [2,3,5].includes(s.style) ? Math.max(0, state.spread || 0) : 0;
  const gap = Math.trunc(base + s.gap) + Math.round(spread);
  const w = Math.max(1, Math.round(thickness * sx)), h = Math.max(1, Math.round(thickness * sy));
  const lx = length ? Math.max(1, Math.round(length * sx)) : 0;
  const ly = length ? Math.max(1, Math.round(length * sy)) : 0;
  const gx = Math.round(gap * sx), gy = Math.round(gap * sy);
  const x = -Math.floor(w / 2), y = -Math.floor(h / 2), rects = [];
  if (length) {
    if (!s.tStyle) rects.push({x, y:y - gy - ly, width:w, height:ly});
    rects.push({x, y:y + h + gy, width:w, height:ly});
    rects.push({x:x - gx - lx, y, width:lx, height:h});
    rects.push({x:x + w + gx, y, width:lx, height:h});
  }
  if (s.dot) rects.push({x, y, width:w, height:h});
  const outline = s.outline && s.outlineThickness > 0 ? Math.max(1, Math.round(s.outlineThickness)) : 0;
  return {rects, outline, outlineX:outline && Math.max(1, Math.round(outline * sx)),
    outlineY:outline && Math.max(1, Math.round(outline * sy)),
    color:s.color === 5 ? [s.red,s.green,s.blue] : COLORS[s.color], opacity:s.useAlpha ? s.alpha / 255 : 1};
}

export function showsWeaponCrosshair({alive = true, scoped = false, zoomStyle = '', bombCamera = false} = {}) {
  return alive && !bombCamera && !scoped && zoomStyle !== 'scope';
}

function svgFor(document) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('preserveAspectRatio', 'none');
  Object.assign(svg.style, {position:'absolute', overflow:'visible', pointerEvents:'none', filter:'none'});
  svg.append(document.createElementNS(SVG_NS, 'g'));
  return svg;
}

function draw(svg, geometry, dpr, offsetX, offsetY) {
  const {rects, outlineX, outlineY, color, opacity} = geometry;
  const group = svg.firstElementChild, outlines = outlineX > 0;
  const packed = rgb => 'rgb(' + rgb.join(',') + ')';
  group.setAttribute('opacity', opacity);
  // The SVG coordinate system is physical display pixels. Its small bounding
  // box is aligned to whole pixels, outside the HUD's stretched transform.
  let radiusX = 1, radiusY = 1;
  for (const r of rects) {
    radiusX = Math.max(radiusX, -r.x + outlineX, r.x + r.width + outlineX);
    radiusY = Math.max(radiusY, -r.y + outlineY, r.y + r.height + outlineY);
  }
  svg.setAttribute('viewBox', [-radiusX,-radiusY,radiusX * 2,radiusY * 2].join(' '));
  Object.assign(svg.style, {left:(offsetX - radiusX / dpr) + 'px', top:(offsetY - radiusY / dpr) + 'px',
    width:(radiusX * 2 / dpr) + 'px', height:(radiusY * 2 / dpr) + 'px'});
  const count = rects.length * (outlines ? 2 : 1);
  while (group.childElementCount < count) group.append(svg.ownerDocument.createElementNS(SVG_NS, 'rect'));
  while (group.childElementCount > count) group.lastElementChild.remove();
  for (let i = 0; i < count; i++) {
    const stroke = outlines && i < rects.length, r = rects[i % rects.length];
    const px = stroke ? outlineX : 0, py = stroke ? outlineY : 0, node = group.children[i];
    node.setAttribute('x', r.x - px);
    node.setAttribute('y', r.y - py);
    node.setAttribute('width', r.width + 2 * px);
    node.setAttribute('height', r.height + 2 * py);
    node.setAttribute('fill', stroke ? '#000' : packed(color));
  }
}

export class Crosshair {
  constructor(container, {settings = DEFAULT_CROSSHAIR, getViewport} = {}) {
    if (!container?.ownerDocument) throw new TypeError('Crosshair needs a DOM container');
    this.container = container;
    this.window = container.ownerDocument.defaultView;
    this.getViewport = getViewport || (() => ({height:this.window.innerHeight, width:this.window.innerWidth}));
    this.settings = normalizeCrosshair(settings);
    this.state = {alive:true, scoped:false, spread:0};
    this.svg = svgFor(container.ownerDocument);
    container.replaceChildren(this.svg);
    this.onResize = () => this.refreshLayout();
    this.window?.addEventListener('resize', this.onResize);
    this.refreshLayout();
  }

  refreshLayout() {
    const v = this.getViewport(), dpr = this.window?.devicePixelRatio || 1;
    const {left,top} = this.container.getBoundingClientRect();
    this.layout = {dpr, viewportHeight:Math.round(v.height * dpr), stretchX:(v.displayWidth || v.width) / v.width,
      stretchY:(v.displayHeight || v.height) / v.height,
      offsetX:Math.floor(left * dpr + 1e-6) / dpr - left, offsetY:Math.floor(top * dpr + 1e-6) / dpr - top};
    this.render(true);
  }

  configure(settings = {}) {
    this.settings = normalizeCrosshair({...this.settings, ...settings});
    this.render(true);
    return this.settings;
  }

  update(state = {}) {
    Object.assign(this.state, state);
    this.render();
  }

  render(force = false) {
    const visible = showsWeaponCrosshair(this.state);
    const {dpr, offsetX, offsetY} = this.layout;
    const spread = [2,3,5].includes(this.settings.style) ? Math.round((this.state.spread || 0) * dpr) : 0;
    const rx = this.settings.followRecoil ? Math.round((this.state.recoilX || 0) * dpr) : 0;
    const ry = this.settings.followRecoil ? Math.round((this.state.recoilY || 0) * dpr) : 0;
    const weaponGap = this.settings.gapUseWeaponValue ? this.state.weaponGap : 4;
    if (!force && visible === this.visible && spread === this.spread && rx === this.rx && ry === this.ry && weaponGap === this.weaponGap) return;
    this.visible = visible; this.spread = spread; this.rx = rx; this.ry = ry; this.weaponGap = weaponGap;
    this.svg.style.display = visible ? 'block' : 'none';
    if (visible) draw(this.svg, crosshairGeometry(this.settings, {...this.layout, spread, weaponGap}),
      dpr, offsetX + rx / dpr, offsetY + ry / dpr);
  }

  renderPreview(container, settings = this.settings) {
    if (!container?.ownerDocument) throw new TypeError('Crosshair preview needs a DOM container');
    const previous = container.querySelector('svg[data-crosshair-preview]');
    previous?.remove();
    if (!container.style.position || container.style.position === 'static') container.style.position = 'relative';
    const svg = svgFor(container.ownerDocument), rect = container.getBoundingClientRect(), {dpr} = this.layout;
    svg.dataset.crosshairPreview = 'true';
    const x = Math.floor((rect.left + rect.width / 2) * dpr) / dpr - rect.left;
    const y = Math.floor((rect.top + rect.height / 2) * dpr) / dpr - rect.top;
    draw(svg, crosshairGeometry(settings, this.layout), dpr, x, y);
    container.append(svg);
    return svg;
  }

  dispose() {
    this.window?.removeEventListener('resize', this.onResize);
    this.svg.remove();
  }
}

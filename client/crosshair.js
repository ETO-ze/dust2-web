import { DEFAULT_CROSSHAIR, normalizeCrosshair } from '../shared/cs2-settings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [0, 255, 255]];
const bounded = (n, fallback, min, max) => Number.isFinite(Number(n))
  ? Math.max(min, Math.min(max, Number(n))) : fallback;

/**
 * Classic crosshair geometry in CSS pixels, scaled from a 480-line reference.
 * This browser rasterisation is a reproduction, not Valve's closed-source HUD.
 * spread is extra CSS pixels supplied by gameplay, never applied to style 4.
 */
export function crosshairGeometry(settings, { viewportHeight = 1080, spread = 0, weaponGap = 4 } = {}) {
  const s = normalizeCrosshair(settings);
  const scale = bounded(viewportHeight, 1080, 120, 8640) / 480;
  const thickness = Math.max(1, Math.round(s.thickness * scale));
  const length = Math.max(0, Math.round(s.size * scale));
  const dynamic = [2, 3, 5].includes(s.style) ? bounded(spread, 0, 0, 100) : 0;
  const baseGap = s.gapUseWeaponValue ? bounded(weaponGap, 4, 0, 20) : 4;
  const gap = Math.round((s.gap + baseGap) * scale + dynamic);
  const half = thickness / 2;
  const inner = half + gap;
  const rects = [];
  if (length) {
    if (!s.tStyle) rects.push({ x: -half, y: -inner - length, width: thickness, height: length });
    rects.push({ x: -half, y: inner, width: thickness, height: length });
    rects.push({ x: -inner - length, y: -half, width: length, height: thickness });
    rects.push({ x: inner, y: -half, width: length, height: thickness });
  }
  if (s.dot) rects.push({ x: -half, y: -half, width: thickness, height: thickness });
  return { rects, outline: s.outline ? s.outlineThickness * scale : 0,
    color: s.color === 5 ? [s.red, s.green, s.blue] : COLORS[s.color],
    opacity: s.useAlpha ? s.alpha / 255 : 1 };
}

function svgFor(document) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '-128 -128 256 256');
  svg.setAttribute('width', '256');
  svg.setAttribute('height', '256');
  svg.setAttribute('shape-rendering', 'crispEdges');
  Object.assign(svg.style, { position: 'absolute', left: '50%', top: '50%',
    width: '256px', height: '256px', overflow: 'visible', pointerEvents: 'none',
    transform: 'translate(-50%, -50%)', filter: 'none', boxShadow: 'none' });
  return svg;
}

function draw(svg, settings, state) {
  const geometry = crosshairGeometry(settings, state);
  const group = svg.ownerDocument.createElementNS(SVG_NS, 'g');
  group.setAttribute('opacity', String(geometry.opacity));
  const add = (rect, color, padding = 0) => {
    const node = svg.ownerDocument.createElementNS(SVG_NS, 'rect');
    node.setAttribute('x', String(rect.x - padding));
    node.setAttribute('y', String(rect.y - padding));
    node.setAttribute('width', String(rect.width + padding * 2));
    node.setAttribute('height', String(rect.height + padding * 2));
    node.setAttribute('fill', color);
    group.append(node);
  };
  if (geometry.outline > 0) geometry.rects.forEach(rect => add(rect, '#000', geometry.outline));
  geometry.rects.forEach(rect => add(rect, `rgb(${geometry.color.join(',')})`));
  svg.replaceChildren(group);
}

export class Crosshair {
  constructor(container, { settings = DEFAULT_CROSSHAIR } = {}) {
    if (!container?.ownerDocument) throw new TypeError('Crosshair needs a DOM container');
    this.container = container;
    this.settings = normalizeCrosshair(settings);
    this.state = { scoped: false, alive: true, spread: 0 };
    this.svg = svgFor(container.ownerDocument);
    container.replaceChildren(this.svg);
    this.onResize = () => this.render();
    this.window = container.ownerDocument.defaultView;
    this.window?.addEventListener('resize', this.onResize);
    this.render();
  }

  configure(settings = {}) {
    this.settings = normalizeCrosshair({ ...this.settings, ...settings });
    this.render();
    return this.settings;
  }

  update(state = {}) {
    const next = { ...this.state, ...state };
    const changed = next.scoped !== this.state.scoped || next.alive !== this.state.alive
      || next.viewportHeight !== this.state.viewportHeight || next.weaponGap !== this.state.weaponGap
      || (this.settings.style !== 4 && next.spread !== this.state.spread)
      || (this.settings.followRecoil && (next.recoilX !== this.state.recoilX || next.recoilY !== this.state.recoilY));
    this.state = next;
    if (changed) this.render();
  }

  render() {
    const visible = !this.state.scoped && this.state.alive !== false;
    this.svg.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const recoilX = this.settings.followRecoil ? bounded(this.state.recoilX, 0, -400, 400) : 0;
    const recoilY = this.settings.followRecoil ? bounded(this.state.recoilY, 0, -400, 400) : 0;
    this.svg.style.marginLeft = `${recoilX}px`;
    this.svg.style.marginTop = `${recoilY}px`;
    draw(this.svg, this.settings, { ...this.state,
      viewportHeight: this.state.viewportHeight ?? this.window?.innerHeight ?? 1080 });
  }

  /** Render a stationary preview at the same scale as the current game viewport. */
  renderPreview(container, settings = this.settings) {
    if (!container?.ownerDocument) throw new TypeError('Crosshair preview needs a DOM container');
    const svg = svgFor(container.ownerDocument);
    if (!container.style.position || container.style.position === 'static') container.style.position = 'relative';
    const previous = container.querySelector('svg[data-crosshair-preview]');
    if (previous) previous.remove();
    svg.dataset.crosshairPreview = 'true';
    draw(svg, normalizeCrosshair(settings), { viewportHeight: this.window?.innerHeight ?? 1080 });
    container.append(svg);
    return svg;
  }

  dispose() {
    this.window?.removeEventListener('resize', this.onResize);
    this.svg.remove();
  }
}

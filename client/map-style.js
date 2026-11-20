import {preferences} from './persistence.js';

const key = 'dust2.map-style.v1';
const selector = () => document.getElementById('map-style');
function requiredStyle(config = globalThis.__DUST2_PRIVATE_MAP__) {
  if (config?.flatOnly) return 'flat';
  if (config?.graphicsMode === 'quality') return 'original';
  return null;
}

export const flatMapSelected = () => (requiredStyle() ?? preferences.getItem(key)) === 'flat';

export function entryRenderQuality(preferred, config = globalThis.__DUST2_PRIVATE_MAP__) {
  const style = requiredStyle(config);
  if (style) return style === 'original' ? 'high' : 'low';
  return preferred === 'high' ? 'high' : 'low';
}

export function mountMapStyle(onChange) {
  const select = selector();
  if (!select) return;
  select.value = flatMapSelected() ? 'flat' : 'original';
  select.disabled = requiredStyle() !== null;
  select.onchange = () => {
    preferences.setItem(key, select.value === 'flat' ? 'flat' : 'original');
    onChange?.();
  };
}

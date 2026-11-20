import { imageAssetURL } from './image-asset-url.js';

export function skinPreviewURL(skin) {
  return imageAssetURL(skin.preview);
}

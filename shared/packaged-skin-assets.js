// These optional files can accompany the game gateway before the next CDN release.
export function isPackagedSkinPath(path) {
  return /^assets\/weapons\/cs2-skins\/(?:official-wear\/[a-z0-9_-]+\.glb|(?:expansion|stock-guns|popular|knives)\/(?:[a-z0-9_-]+\.glb|previews\/[a-z0-9_-]+\.webp|animations\/[a-z0-9_-]+\.glb))$/.test(path);
}

export function packagedSkinAssets(skins) {
  const files = new Map();
  for (const skin of skins) {
    const resources = [
      { path: skin.model, bytes: skin.bytes, sha256: skin.sha256 },
      { path: skin.preview, bytes: skin.previewBytes, sha256: skin.previewSha256 },
    ];
    if (skin.animation) resources.push({ path: skin.animation.model, bytes: skin.animation.bytes, sha256: skin.animation.sha256 });
    for (const file of resources) {
      if (isPackagedSkinPath(file.path)) files.set(file.path, file);
    }
  }
  return [...files.values()];
}

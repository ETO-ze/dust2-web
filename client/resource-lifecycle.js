/** SkeletonUtils.clone shares geometry/materials but creates instance skeletons.
 * Three.js uploads each skeleton's boneTexture separately; removing its mesh
 * from a scene does not dispose that GPU texture. Shared asset textures must
 * stay alive for the library and the other players that use them.
 */
export function disposeInstanceSkeletons(root, seen = new Set()) {
  root?.traverse(object => {
    const skeleton = object.isSkinnedMesh && object.skeleton;
    if (!skeleton || seen.has(skeleton)) return;
    seen.add(skeleton);
    skeleton.dispose();
  });
  return seen;
}

export function disposeInstanceAnimation(mixer, root) {
  if (!mixer) return;
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
}

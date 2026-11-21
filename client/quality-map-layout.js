// Intervals of original glTF node IDs, selected from the matching VPK entity
// export. tests/quality-map-layout.mjs reproduces each interval from source.
const layouts = {
  de_inferno: {
    hashes: [
      '50443c7652275ece36a13bcf4c8086819531500a1eeaa1802c1a5d9f5a572182', // raw
      '1c66ba44bd14963f0bff76eff454ef60897e6f43c6ecbd32347a6ac5b4a1f480', // compact
    ],
    first:6563, last:6593,
  },
  de_mirage: {
    hashes:['3a9961c304591790a591d56bd09482c32dc52a1d7d1dedb1e04fac84b7dc72fe'],
    first:3499, last:3513,
  },
};

export function omitInactiveQualityMeshes(document, mapId, verifiedSha256) {
  const layout = layouts[mapId];
  if (!layout?.hashes.includes(verifiedSha256)) return 0;
  // Detach this instance's mesh. Its transform, children, shared mesh asset
  // and indices used by live breakable state all keep their source identities.
  for (let index = layout.first; index <= layout.last; index++) delete document.nodes[index].mesh;
  return layout.last - layout.first + 1;
}

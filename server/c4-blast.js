// The bomb's map-specific game balance parameter comes from the shipped
// info_map_parameters.bombradius on each of the nine supported CS2 maps.
const mapPower = {
  de_dust2: 700, de_mirage: 650, de_inferno: 600,
  de_nuke: 650, de_ancient: 650, de_anubis: 450,
  de_cache: 600, de_train: 500, de_vertigo: 500,
};

export function c4Damage(mapId, distanceMetres) {
  const power = mapPower[mapId] ?? 500;
  const radius = power * 3.5 * .0254;
  if (!Number.isFinite(distanceMetres) || distanceMetres < 0 || distanceMetres >= radius) return 0;
  const normalized = 3 * distanceMetres / radius;
  return power * Math.exp(-.5 * normalized * normalized);
}

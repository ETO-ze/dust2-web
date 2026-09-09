// Prices: user-requested CS buy panel and the local CS2 scripts/weapons.vdata_c.
// Projectile/flash/smoke simulation is a bounded browser approximation, not Source 2.
const both = Object.freeze(['T', 'CT']);
const item = data => Object.freeze({ category: 'equipment', teams: both, slot: 0, ...data });
const grenade = data => item({ category: 'grenades', slot: 4, magazine: 1, reserve: 0,
  reloadTime: 0, fireInterval: 1, automatic: false, damage: 0, headMultiplier: 1,
  range: 0, spread: 0, movingSpread: 0, recoil: 0, skin: '原厂', zoomFovs: Object.freeze([90]),
  throwSpeed: 750 * 0.0254, gravity: 8.128, bounce: 0.45, fuse: 1.5, maxCount: 1, ...data });

export const EQUIPMENT = Object.freeze({
  armor: item({ id: 'armor', name: '防弹背心', price: 650 }),
  helmet: item({ id: 'helmet', name: '防弹背心 + 头盔', price: 1000 }),
  defusekit: item({ id: 'defusekit', name: '拆弹工具', price: 400, teams: Object.freeze(['CT']) }),
  hegrenade: grenade({ id: 'hegrenade', name: '高爆手雷', price: 300, damage: 99, radius: 8.9, color: '#929c49' }),
  flashbang: grenade({ id: 'flashbang', name: '闪光弹', price: 200, maxCount: 2, radius: 30, duration: 4.5, color: '#ece3c4' }),
  smokegrenade: grenade({ id: 'smokegrenade', name: '烟雾弹', price: 300, fuse: 2, radius: 4.5, duration: 18, color: '#a7b4a6' }),
});
export const UTILITY_IDS = Object.freeze(['hegrenade', 'flashbang', 'smokegrenade']);
export const MAX_GRENADES = 4;
const aliases = Object.freeze({ kevlar: 'armor', vest: 'armor', vesthelm: 'helmet', armorhelmet: 'helmet', kit: 'defusekit', defuser: 'defusekit', he: 'hegrenade', flash: 'flashbang', smoke: 'smokegrenade' });
export function normalizeEquipment(id) { return typeof id === 'string' ? aliases[id.toLowerCase()] || id.toLowerCase() : ''; }
export function getEquipment(id) { const key=normalizeEquipment(id);return Object.hasOwn(EQUIPMENT,key)?EQUIPMENT[key]:null; }
export function canTeamBuyEquipment(team, id) { return getEquipment(id)?.teams.includes(team) === true; }
export function equipmentPrice(id, player = {}) {
  const equipment = getEquipment(id); if (!equipment) return Infinity;
  if (equipment.id === 'helmet' && player.armor >= 100) return player.helmet ? 0 : 350;
  if (equipment.id === 'helmet' && player.helmet) return 650;
  return equipment.price;
}
export function grenadeCount(inventory = {}) { return UTILITY_IDS.reduce((sum, id) => sum + Math.max(0, Number(inventory[id]?.ammo) || 0), 0); }

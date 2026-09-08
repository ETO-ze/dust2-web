// Original gameplay tuning for this browser prototype; not extracted CS2 data.
export const WEAPONS = Object.freeze({
  ak47: Object.freeze({ id: 'ak47', name: 'AK-47', skin: '野荷', slot: 1, price: 2700, damage: 34, headMultiplier: 3.5, fireInterval: 0.10, magazine: 30, reserve: 90, reloadTime: 2.4, range: 210, spread: 0.003, movingSpread: 0.036, recoil: 0.018, automatic: true, color: '#be7a48' }),
  m4a1: Object.freeze({ id: 'm4a1', name: 'M4A1-S', skin: '澜磷', slot: 1, price: 2900, damage: 30, headMultiplier: 3.3, fireInterval: 0.09, magazine: 30, reserve: 90, reloadTime: 2.3, range: 200, spread: 0.0025, movingSpread: 0.030, recoil: 0.014, automatic: true, color: '#889aa0' }),
  awp: Object.freeze({ id: 'awp', name: 'AWP', skin: '永恒之枪', slot: 1, price: 4750, damage: 115, armorAbsorption: 0.03, falloffDistance: 6000, headMultiplier: 3, fireInterval: 1.35, magazine: 5, reserve: 25, reloadTime: 3.2, range: 300, spread: 0.0006, movingSpread: 0.070, recoil: 0.07, automatic: false, color: '#8e995b' }),
  pistol: Object.freeze({ id: 'pistol', name: 'Glock-18', skin: '伽马多普勒 · 绿宝石', slot: 2, price: 0, damage: 25, headMultiplier: 3.5, fireInterval: 0.20, magazine: 20, reserve: 120, reloadTime: 1.65, range: 110, spread: 0.006, movingSpread: 0.025, recoil: 0.013, automatic: false, color: '#9eacb8' }),
  usp: Object.freeze({ id: 'usp', name: 'USP-S', skin: '印花集', slot: 2, price: 0, damage: 30, headMultiplier: 3.5, fireInterval: 0.19, magazine: 12, reserve: 24, reloadTime: 1.9, range: 130, spread: 0.004, movingSpread: 0.024, recoil: 0.012, automatic: false, color: '#eeeef0' }),
  knife: Object.freeze({ id: 'knife', name: '爪子刀', skin: '多普勒 · 蓝宝石', slot: 3, price: 0, damage: 55, headMultiplier: 1, fireInterval: 0.50, magazine: 0, reserve: 0, reloadTime: 0, range: 2.25, spread: 0, movingSpread: 0, recoil: 0, automatic: false, color: '#c6d6dc' }),
});

export const WEAPON_ORDER = Object.freeze(['ak47', 'm4a1', 'awp', 'pistol', 'usp', 'knife']);
export const PRIMARY_WEAPONS = Object.freeze(['ak47', 'm4a1', 'awp']);
export const WEAPON_ALIASES = Object.freeze({ ak: 'ak47', 'ak-47': 'ak47', m4: 'm4a1', 'm4a1-s': 'm4a1', 'usp-s': 'usp', glock: 'pistol', 'glock-18': 'pistol' });
export function normalizeWeapon(id) { return WEAPON_ALIASES[String(id).toLowerCase()] || String(id).toLowerCase(); }
export function getWeapon(id) { return WEAPONS[normalizeWeapon(id)] || WEAPONS.pistol; }
export const weaponById = getWeapon;

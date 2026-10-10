import {WEAPONS, getWeapon} from '../shared/weapons.js';
import {EQUIPMENT, UTILITY_IDS} from '../shared/equipment.js';
import {uiIcon} from './ui-icons.js';

/** Render only the local player's authoritative equipment, never opponents'. */
export function loadoutRows(self) {
  const inventory = Array.isArray(self.inventory) ? self.inventory : [];
  const rows = [];
  for (const slot of [1, 2, 3]) {
    const id = inventory.find(id => WEAPONS[id]?.slot === slot);
    if (id) rows.push({slot, id, name: getWeapon(id).name, count: 1, active: self.weapon === id});
  }
  for (const id of UTILITY_IDS) {
    const count = Math.max(0, Math.floor(Number(self.utilityCounts?.[id]) || 0));
    if (count) rows.push({slot: 4, id, name: EQUIPMENT[id].name, count, active: self.weapon === id});
  }
  if (self.hasBomb) rows.push({slot: 5, id: 'c4', name: 'C4 炸弹', count: 1, active: self.weapon === 'c4'});
  if (self.defuseKit) rows.push({slot: null, id: 'defusekit', name: '拆弹工具', count: 1, active: false});
  return rows;
}

export class HudLoadout {
  constructor(parent) {
    this.element = document.createElement('section');
    this.element.className = 'hud-loadout';
    this.element.setAttribute('aria-label', '携带装备');
    parent?.append(this.element);
  }
  update(self) {
    const rows = loadoutRows(self), signature = JSON.stringify(rows);
    if (signature === this.signature) return;
    this.signature = signature;
    this.element.replaceChildren(...rows.map(row => {
      const item = document.createElement('div');
      item.className = `hud-loadout-row${row.active ? ' selected' : ''}${row.slot === 4 ? ' grenade' : ''}`;
      item.dataset.slot = row.slot ?? 'kit';
      item.setAttribute('aria-label', `${row.name}${row.count > 1 ? ` × ${row.count}` : ''}${row.active ? ' · 当前装备' : ''}`);
      if (row.active) item.setAttribute('aria-current', 'true');
      const name = document.createElement('span');name.className = 'hud-loadout-name';name.textContent = row.name;
      const key = document.createElement('small');key.textContent = row.slot ?? '';
      const count = document.createElement('b');count.textContent = row.count > 1 ? `×${row.count}` : '';
      item.append(name, uiIcon(row.id), count, key);
      return item;
    }));
  }
}

import {getAgent} from './agents.js';
import { DEFAULT_SKINS, getSkin } from './skins.js';

// A room advertises approved cosmetic IDs only. No owners, teams, positions
// or arbitrary download addresses are part of the preparation protocol.
export function selectedSkinIds(skins, weapons) {
  const ids = new Set();
  for (const weapon of weapons) {
    const skin = getSkin(skins?.[weapon] || DEFAULT_SKINS[weapon]);
    if (skin?.weapon === weapon) ids.add(skin.id);
  }
  return ids;
}

export function roomAgentIds(room) {
  const ids=new Set();
  for (const player of room.players.values()) {
    const id=player.agentId;
    if(getAgent(id))ids.add(id);
  }
  return [...ids].sort();
}

export function roomSkinPlan(room) {
  const active = new Set(), carried = new Set();
  for (const player of room.players.values()) {
    for (const weapon of Object.keys(player.inventory)) {
      const skin = getSkin(room.heldSkin(player,weapon));
      if (skin?.weapon !== weapon) continue;
      if (player.alive && weapon === player.weapon) active.add(skin.id);
      carried.add(skin.id);
    }
  }
  const carriedSkinIds=[...carried];
  for (const item of room.droppedWeapons.items) {
    const skin = getSkin(item.skinId);
    if (skin?.weapon === item.weaponId) carried.add(skin.id);
  }
  return {activeSkinIds:[...active],carriedSkinIds,skinIds:[...new Set([...active,...carried])]};
}

export function roomSkinIds(room) { return roomSkinPlan(room).skinIds; }

export function skinResources(ids) {
  const resources = new Map();
  for (const id of ids) {
    const skin = getSkin(id);
    if (!skin) continue;
    for (const item of [skin,skin.animation].filter(Boolean)) resources.set(item.sha256,item);
  }
  return [...resources.values()];
}

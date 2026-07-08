// Equipment: procedural weapon/offhand/trinket generation, inventory ops, stat aggregation.
import { G } from './state.js';
import {
  RARITIES, WEAPON_TYPES, OFFHAND_TYPES, NAME_PREFIX, NAME_SUFFIX,
  TRINKET_NAMES, TRINKET_STATS, CLASSES,
} from './config.js';

let uidCounter = 1;

function pickRarity(floor, luck = 0) {
  // deeper floors + luck shift weight toward higher tiers
  const boost = 1 + floor * 0.16 + luck;
  let total = 0;
  const weights = RARITIES.map((r, i) => { const w = r.w * (i === 0 ? 1 / boost : Math.pow(boost, i * 0.5)); total += w; return w; });
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return RARITIES[i]; }
  return RARITIES[0];
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function itemName(rarity, noun) {
  const pre = pick(NAME_PREFIX[rarity.id]);
  const suf = rarity.mult >= 1.4 ? pick(NAME_SUFFIX.filter(Boolean)) : pick(NAME_SUFFIX);
  return `${pre} ${noun}${suf ? ' ' + suf : ''}`;
}

export function rollWeapon(classId, floor, luck = 0) {
  const rarity = pickRarity(floor, luck);
  const wt = pick(WEAPON_TYPES[classId]);
  const cls = CLASSES[classId];
  const dmg = Math.round(cls.dmg * rarity.mult * (wt.dmgBonus || 1) * (1 + 0.09 * (floor - 1)));
  const item = {
    uid: uidCounter++, slot: 'weapon', classId, wtype: wt.id, mesh: wt.mesh, model: wt.model,
    name: itemName(rarity, wt.noun), rarity: rarity.id, icon: '⚔',
    stats: { dmg },
  };
  if (rarity.mult >= 1.4) { // rare+: bonus stat
    const t = pick(TRINKET_STATS);
    item.stats[t.stat] = +(t.min + Math.random() * (t.max - t.min) * 0.6).toFixed(1);
  }
  return item;
}

export function rollOffhand(classId, floor, luck = 0) {
  const rarity = pickRarity(floor, luck);
  const ot = OFFHAND_TYPES[classId];
  const idx = Math.floor(Math.random() * ot.meshes.length);
  const val = ot.stat === 'armor' ? Math.round((8 + floor * 1.2) * rarity.mult)
    : ot.stat === 'crit' ? +(5 * rarity.mult + floor * 0.5).toFixed(1)
    : +(2.5 * rarity.mult + floor * 0.3).toFixed(1);
  return {
    uid: uidCounter++, slot: 'offhand', classId, mesh: [ot.meshes[idx]], model: ot.models[idx] || ot.models[0],
    name: itemName(rarity, ot.noun), rarity: rarity.id, icon: '🛡',
    stats: { [ot.stat]: Math.min(ot.stat === 'armor' ? 30 : 99, val) },
  };
}

export function rollTrinket(floor, luck = 0) {
  const rarity = pickRarity(floor, luck);
  const t = pick(TRINKET_STATS);
  const val = +(t.min + (t.max - t.min) * Math.random() * rarity.mult * 0.75).toFixed(1);
  return {
    uid: uidCounter++, slot: 'trinket', classId: null, mesh: [], model: 'keyring',
    name: itemName(rarity, pick(TRINKET_NAMES)), rarity: rarity.id, icon: t.icon,
    stats: { [t.stat]: t.stat === 'hp' || t.stat === 'armor' ? Math.round(val) : val },
  };
}

// weighted random drop for a given class
export function rollAnyItem(classId, floor, luck = 0) {
  const r = Math.random();
  if (r < 0.45) return rollWeapon(classId, floor, luck);
  if (r < 0.7) return rollOffhand(classId, floor, luck);
  return rollTrinket(floor, luck);
}

export function rarityOf(item) { return RARITIES.find(r => r.id === item.rarity) || RARITIES[0]; }

export function salvageValue(item) {
  const r = RARITIES.findIndex(x => x.id === item.rarity);
  return 6 + r * 12 + Math.floor(Math.random() * 6);
}

// ---- stat aggregation over equipped gear ----
export function gearStat(stat) {
  let v = 0;
  for (const slot of ['weapon', 'offhand', 'trinket1', 'trinket2']) {
    const it = G.inv[slot];
    if (it && it.stats[stat]) v += it.stats[stat];
  }
  return v;
}
export function weaponDamage(cls) {
  return G.inv.weapon ? G.inv.weapon.stats.dmg : cls.dmg;
}

// meshes that should be visible on the rig given current equipment
export function equippedMeshes(classId) {
  const meshes = [];
  const w = G.inv.weapon;
  if (w) {
    for (const m of w.mesh) {
      if (m === 'OFFHAND') { if (G.inv.offhand) meshes.push(...G.inv.offhand.mesh); }
      else meshes.push(m);
    }
  } else meshes.push(...CLASSES[classId].show);
  // 2-handed weapons hide the offhand; 1-handed shows it via the OFFHAND marker above
  return meshes;
}

// ---- inventory ops (bag holds max 12) ----
export const BAG_MAX = 12;

export function addToBag(item) {
  if (G.inv.bag.length >= BAG_MAX) return false;
  G.inv.bag.push(item);
  return true;
}

export function equipItem(item, onChange) {
  let slot = item.slot;
  if (slot === 'trinket') {
    slot = !G.inv.trinket1 ? 'trinket1' : !G.inv.trinket2 ? 'trinket2' : 'trinket1';
  }
  if (item.classId && item.classId !== G.player.classId) return false;
  const idx = G.inv.bag.indexOf(item);
  if (idx >= 0) G.inv.bag.splice(idx, 1);
  const old = G.inv[slot];
  G.inv[slot] = item;
  if (old) G.inv.bag.push(old);
  onChange?.();
  return true;
}

export function salvageItem(item) {
  const idx = G.inv.bag.indexOf(item);
  if (idx < 0) return 0;
  G.inv.bag.splice(idx, 1);
  const v = salvageValue(item);
  G.run.gold += v;
  return v;
}

export function giveStartingGear(classId) {
  const w = rollWeapon(classId, 1, -0.5);
  w.rarity = 'common';
  w.name = itemName(RARITIES[0], WEAPON_TYPES[classId][0].noun);
  w.wtype = WEAPON_TYPES[classId][0].id;
  w.mesh = WEAPON_TYPES[classId][0].mesh;
  w.model = WEAPON_TYPES[classId][0].model;
  w.stats = { dmg: CLASSES[classId].dmg };
  G.inv = { weapon: w, offhand: null, trinket1: null, trinket2: null, bag: [] };
}

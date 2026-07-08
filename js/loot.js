// Loot, now per-floor: chests, coins, potions, keys, equipment drops. Lookup is by
// floor + id so peers on different floors stay consistent; arriving on a floor a
// teammate already looted applies state silently via applyTakenSilently().
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { makePiece, makeWeaponModel } from './assets.js';
import { makeGlowSprite, spawnBurst, spawnDamageNumber } from './fx.js';
import { sfx } from './audio.js';
import { addMsg, refreshHud } from './ui.js';
import { netSend } from './net.js';
import { rollAnyItem, addToBag, rarityOf } from './items.js';

function baseY(kind) {
  return (kind === 'coin' || kind === 'key' || kind === 'potion' || kind === 'item') ? 0.55 : 0;
}

export function spawnLootsForFloor(fs) {
  fs.lootGroup = new THREE.Group();
  fs.lootGroup.visible = false;
  G.scene.add(fs.lootGroup);
  fs.lootSpawns.forEach((s, i) => addLootEntity(fs, s, i));
  fs.nextLootId = fs.lootSpawns.length;
}

function addLootEntity(fs, s, id) {
  const loot = {
    id, kind: s.kind, x: s.x, z: s.z, baseH: s.y || 0, floor: fs.n,
    taken: false, obj: null, opened: false, spin: false, bob: Math.random() * 6,
    item: s.item || null, itemColor: s.item ? rarityOf(s.item).color : null,
  };
  let obj;
  switch (s.kind) {
    case 'chest': obj = makePiece('chest'); obj.rotation.y = s.yaw || 0; break;
    case 'goldchest': obj = makePiece('chest_gold'); obj.rotation.y = s.yaw || 0; break;
    case 'coin': obj = makePiece('coin'); obj.scale.setScalar(1.8); loot.spin = true; break;
    case 'coinstack': obj = makePiece(['coin_stack_small', 'coin_stack_medium', 'coin_stack_large'][id % 3]); obj.scale.setScalar(0.8); break;
    case 'potion': obj = makePiece('bottle_A_green'); obj.scale.setScalar(1.5); loot.spin = true; break;
    case 'key': obj = makePiece('key'); obj.scale.setScalar(2.0); loot.spin = true; break;
    case 'item': obj = makeWeaponModel(s.item.model); obj.scale.setScalar(1.25); loot.spin = true; break;
  }
  obj.position.set(s.x, loot.baseH + baseY(s.kind), s.z);
  if (loot.spin || s.kind === 'coinstack') {
    const color = s.kind === 'item' ? rarityOf(s.item).glow
      : s.kind === 'potion' ? 0x33ff66 : s.kind === 'key' ? 0xffee66 : 0xffcc33;
    const glow = makeGlowSprite(color, s.kind === 'item' ? 1.5 : 1.1);
    glow.position.y = 0.3;
    obj.add(glow);
  }
  fs.lootGroup.add(obj);
  loot.obj = obj;
  fs.loots.push(loot);
  return loot;
}

// authority drops an equipment item into the world and shares it with guests
export function dropItemLoot(fs, item, x, z, y = 0, id = null) {
  const lid = id ?? fs.nextLootId++;
  if (id !== null && fs.nextLootId <= id) fs.nextLootId = id + 1;
  const loot = addLootEntity(fs, { kind: 'item', item, x, z, y }, lid);
  fs.drops.push({ id: lid, item, x, z, y });
  if (G.net.role === 'host' && id === null) netSend({ t: 'ldrop', f: fs.n, id: lid, item, x, z, y });
  return loot;
}

export function lootById(f, id) {
  const fs = G.floors.get(f);
  return fs ? fs.loots.find(l => l.id === id) : null;
}

export function updateLoot(dt) {
  const p = G.player;
  for (const l of G.loots) {
    if (l.taken) continue;
    if (l.spin) {
      l.obj.rotation.y += dt * 2.2;
      l.bob += dt * 2.5;
      l.obj.position.y = l.baseH + 0.55 + Math.sin(l.bob) * 0.12;
    }
    if (p && !p.dead && (l.kind === 'coin' || l.kind === 'coinstack' || l.kind === 'potion' || l.kind === 'key')) {
      const d = Math.hypot(p.obj.position.x - l.x, p.obj.position.z - l.z);
      if (d < 1.3 && Math.abs(p.obj.position.y - l.baseH) < 1.5) takeLoot(l.floor, l.id, 'local');
    }
  }
}

export function nearestChest(pos, maxD = 2.6) {
  let best = null, bd = maxD;
  for (const l of G.loots) {
    if (l.taken || (l.kind !== 'chest' && l.kind !== 'goldchest')) continue;
    if (Math.abs(pos.y - l.baseH) > 1.5) continue;
    const d = Math.hypot(pos.x - l.x, pos.z - l.z);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

export function nearestItemDrop(pos, maxD = 2.4) {
  let best = null, bd = maxD;
  for (const l of G.loots) {
    if (l.taken || l.kind !== 'item') continue;
    if (Math.abs(pos.y - l.baseH) > 1.6) continue;
    const d = Math.hypot(pos.x - l.x, pos.z - l.z);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

// by = 'local' | 'remote' | peerId; in guest role, local pickups become requests to the host.
export function takeLoot(f, id, by, fromNet = false) {
  const l = lootById(f, id);
  if (!l || l.taken) return;
  if (by === 'local' && G.net.role === 'guest' && !fromNet) {
    netSend({ t: 'lootReq', f, id });
    return;
  }
  if (l.kind === 'goldchest' && by === 'local' && G.run.keys < 1 && !fromNet) {
    addMsg('The golden chest is locked. Find the key!', 'bad');
    sfx.key();
    return;
  }
  const isMine = by === 'local';
  if (l.kind === 'item' && isMine && G.inv.bag.length >= 12) {
    addMsg('Your bag is full! (Tab to manage)', 'bad');
    return;
  }
  l.taken = true;
  const visible = f === G.floor;
  if (G.net.role === 'host') netSend({ t: 'lootTaken', f, id, by: isMine ? 'host' : by });
  const pos = new THREE.Vector3(l.x, l.baseH + 1, l.z);
  const fx = (color, n = 10, s = 3.5) => { if (visible) spawnBurst(pos, color, n, s, 0.12); };

  const give = (fn) => { if (isMine) fn(); };
  switch (l.kind) {
    case 'coin': {
      const amt = 3 + Math.floor(Math.random() * 4) + f;
      give(() => { G.run.gold += amt; addMsg(`+${amt} gold`, 'gold'); });
      if (isMine) sfx.coin();
      fx(0xffd35c, 8, 3);
      hideLoot(l);
      break;
    }
    case 'coinstack': {
      const amt = 8 + Math.floor(Math.random() * 8) + f * 2;
      give(() => { G.run.gold += amt; addMsg(`+${amt} gold`, 'gold'); });
      if (isMine) sfx.coin();
      fx(0xffd35c, 14, 4);
      hideLoot(l);
      break;
    }
    case 'potion':
      give(() => { G.run.potions++; addMsg('Picked up a health potion 🧪'); });
      if (isMine) sfx.potion();
      fx(0x44ff77);
      hideLoot(l);
      break;
    case 'key':
      give(() => { G.run.keys++; addMsg('Found a golden key! 🔑', 'gold'); });
      if (isMine) sfx.key();
      fx(0xffee66, 12, 4);
      hideLoot(l);
      break;
    case 'item':
      give(() => {
        addToBag(l.item);
        addMsg(`Picked up <span style="color:${rarityOf(l.item).color}">${l.item.name}</span> — Tab to equip`, 'gold');
      });
      if (isMine) sfx.chest();
      fx(rarityOf(l.item).glow, 14, 4);
      hideLoot(l);
      break;
    case 'chest':
    case 'goldchest': {
      openChestVisual(l);
      if (isMine) {
        sfx.chest();
        G.run.chests++;
        if (l.kind === 'goldchest') {
          G.run.keys--;
          const gold = 40 + Math.floor(Math.random() * 30) + f * 8;
          G.run.gold += gold;
          const item = rollAnyItem(G.player.classId, f, 0.6);
          if (addToBag(item)) addMsg(`Golden chest: +${gold} gold and <span style="color:${rarityOf(item).color}">${item.name}</span>!`, 'gold');
          else addMsg(`Golden chest: +${gold} gold (bag full!)`, 'gold');
          if (visible) spawnDamageNumber(pos, 'TREASURE!', '#ffd35c', true);
        } else {
          const roll = Math.random();
          if (roll < 0.35) { const g = 12 + Math.floor(Math.random() * 15) + f * 4; G.run.gold += g; addMsg(`Chest: +${g} gold`, 'gold'); }
          else if (roll < 0.6) { G.run.potions++; addMsg('Chest: a health potion 🧪'); }
          else if (roll < 0.85) {
            const item = rollAnyItem(G.player.classId, f, 0.1);
            if (addToBag(item)) addMsg(`Chest: <span style="color:${rarityOf(item).color}">${item.name}</span> — Tab to equip`, 'gold');
            else { G.run.gold += 20; addMsg('Chest: +20 gold (bag full)', 'gold'); }
          }
          else { G.run.keys++; addMsg('Chest: a golden key! 🔑', 'gold'); }
        }
      }
      fx(0xffcc55, 16, 4.5);
      break;
    }
  }
  if (isMine) refreshHud();
}

// silently apply "already looted by a teammate" state when arriving on a floor
export function applyTakenSilently(fs, ids) {
  for (const id of ids) {
    const l = fs.loots.find(x => x.id === id);
    if (!l || l.taken) continue;
    l.taken = true;
    if (l.kind === 'chest' || l.kind === 'goldchest') openChestVisual(l);
    else hideLoot(l);
  }
}

function hideLoot(l) {
  l.obj.visible = false;
}

function openChestVisual(l) {
  l.opened = true;
  const lid = l.obj.getObjectByName(l.kind === 'goldchest' ? 'chest_gold_lid' : 'chest_lid');
  if (lid) lid.rotation.x = -Math.PI * 0.55;
}

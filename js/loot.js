// Loot entities: chests (lid animation), coins, potions, keys. Pickup + network-friendly ids.
import * as THREE from 'three';
import { G } from './state.js';
import { makePiece } from './assets.js';
import { makeGlowSprite, spawnBurst, spawnDamageNumber } from './fx.js';
import { sfx } from './audio.js';
import { addMsg, refreshHud } from './ui.js';
import { netSend } from './net.js';

let lootGroup = null;

export function clearLoot() {
  if (lootGroup) { G.scene.remove(lootGroup); lootGroup = null; }
  G.loots = [];
}

export function spawnLoots(lootSpawns) {
  clearLoot();
  lootGroup = new THREE.Group();
  G.scene.add(lootGroup);
  lootSpawns.forEach((s, i) => {
    const loot = { id: i, kind: s.kind, x: s.x, z: s.z, taken: false, obj: null, opened: false, spin: false, bob: Math.random() * 6 };
    let obj;
    switch (s.kind) {
      case 'chest': obj = makePiece('chest'); obj.rotation.y = s.yaw; break;
      case 'goldchest': obj = makePiece('chest_gold'); obj.rotation.y = s.yaw; break;
      case 'coin': obj = makePiece('coin'); obj.scale.setScalar(1.8); loot.spin = true; break;
      case 'coinstack': obj = makePiece(['coin_stack_small', 'coin_stack_medium', 'coin_stack_large'][i % 3]); obj.scale.setScalar(0.8); break;
      case 'potion': obj = makePiece('bottle_A_green'); obj.scale.setScalar(1.5); loot.spin = true; break;
      case 'key': obj = makePiece('key'); obj.scale.setScalar(2.0); loot.spin = true; break;
    }
    obj.position.set(s.x, s.kind === 'coin' || s.kind === 'key' || s.kind === 'potion' ? 0.55 : 0, s.z);
    if (loot.spin || s.kind === 'coinstack') {
      const glow = makeGlowSprite(s.kind === 'potion' ? 0x33ff66 : s.kind === 'key' ? 0xffee66 : 0xffcc33, 1.1);
      glow.position.y = 0.3;
      obj.add(glow);
    }
    lootGroup.add(obj);
    loot.obj = obj;
    G.loots.push(loot);
  });
}

export function updateLoot(dt) {
  const p = G.player;
  for (const l of G.loots) {
    if (l.taken) continue;
    if (l.spin) {
      l.obj.rotation.y += dt * 2.2;
      l.bob += dt * 2.5;
      l.obj.position.y = 0.55 + Math.sin(l.bob) * 0.12;
    }
    // auto-pickup for small items
    if (p && !p.dead && (l.kind === 'coin' || l.kind === 'coinstack' || l.kind === 'potion' || l.kind === 'key')) {
      const d = Math.hypot(p.obj.position.x - l.x, p.obj.position.z - l.z);
      if (d < 1.3) takeLoot(l.id, 'local');
    }
  }
}

// Nearest interactable chest for the E-prompt.
export function nearestChest(pos, maxD = 2.4) {
  let best = null, bd = maxD;
  for (const l of G.loots) {
    if (l.taken || (l.kind !== 'chest' && l.kind !== 'goldchest')) continue;
    const d = Math.hypot(pos.x - l.x, pos.z - l.z);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}

// by = 'local' | 'remote'; in guest role, local pickups become requests to the host.
export function takeLoot(id, by, fromNet = false) {
  const l = G.loots[id];
  if (!l || l.taken) return;
  if (by === 'local' && G.net.role === 'guest' && !fromNet) {
    netSend({ t: 'lootReq', id });
    return;
  }
  if (l.kind === 'goldchest' && by === 'local' && G.run.keys < 1 && !fromNet) {
    addMsg('The golden chest is locked. Find the key!', 'bad');
    sfx.key();
    return;
  }
  l.taken = true;
  const isMine = by === 'local';
  if (G.net.role === 'host') netSend({ t: 'lootTaken', id, by: isMine ? 'host' : by });
  const pos = new THREE.Vector3(l.x, 1, l.z);

  const give = (fn) => { if (isMine) fn(); };
  switch (l.kind) {
    case 'coin': {
      const amt = 3 + Math.floor(Math.random() * 4) + G.floor;
      give(() => { G.run.gold += amt; addMsg(`+${amt} gold`, 'gold'); });
      if (isMine) sfx.coin();
      spawnBurst(pos, 0xffd35c, 8, 3, 0.1);
      hideLoot(l);
      break;
    }
    case 'coinstack': {
      const amt = 8 + Math.floor(Math.random() * 8) + G.floor * 2;
      give(() => { G.run.gold += amt; addMsg(`+${amt} gold`, 'gold'); });
      if (isMine) sfx.coin();
      spawnBurst(pos, 0xffd35c, 14, 4, 0.12);
      hideLoot(l);
      break;
    }
    case 'potion':
      give(() => { G.run.potions++; addMsg('Picked up a health potion 🧪'); });
      if (isMine) sfx.potion();
      spawnBurst(pos, 0x44ff77, 10, 3.5, 0.12);
      hideLoot(l);
      break;
    case 'key':
      give(() => { G.run.keys++; addMsg('Found a golden key! 🔑', 'gold'); });
      if (isMine) sfx.key();
      spawnBurst(pos, 0xffee66, 12, 4, 0.12);
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
          const gold = 40 + Math.floor(Math.random() * 30) + G.floor * 8;
          G.run.gold += gold;
          G.run.atkBonus += 2;
          addMsg(`Golden chest: +${gold} gold, +2 damage!`, 'gold');
          spawnDamageNumber(pos, '+2 DMG', '#ffd35c', true);
        } else {
          const roll = Math.random();
          if (roll < 0.45) { const g = 12 + Math.floor(Math.random() * 15) + G.floor * 4; G.run.gold += g; addMsg(`Chest: +${g} gold`, 'gold'); }
          else if (roll < 0.75) { G.run.potions++; addMsg('Chest: a health potion 🧪'); }
          else if (roll < 0.9) { G.run.atkBonus += 1; addMsg('Chest: a sharpening stone (+1 damage)', 'gold'); }
          else { G.run.keys++; addMsg('Chest: a golden key! 🔑', 'gold'); }
        }
      }
      spawnBurst(pos, 0xffcc55, 16, 4.5, 0.13);
      break;
    }
  }
  if (isMine) refreshHud();
}

function hideLoot(l) {
  l.obj.visible = false;
}

function openChestVisual(l) {
  l.opened = true;
  const lid = l.obj.getObjectByName(l.kind === 'goldchest' ? 'chest_gold_lid' : 'chest_lid');
  if (lid) lid.rotation.x = -Math.PI * 0.55;
}

// Hired mercenaries: friendly AI adventurers who fight beside you. Host-simulated,
// mirrored to guests; enemies treat them as valid targets.
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { makeCharacter, applyLook, tintCharacter } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, groundHeightAt, hasLineOfSight } from './dungeon.js';
import { damageEnemy } from './enemies.js';
import { spawnBolt } from './projectiles.js';
import { netSend, isAuthority, myId } from './net.js';
import { addMsg } from './ui.js';

export const minions = []; // {id, owner, kind, floor, obj, anim, hp, maxHp, dmg, state, atkT, netX/Y/Z/Yaw}
let nextMinionId = 1;

const KINDS = {
  sword: { model: 'Knight', show: ['1H_Sword', 'Round_Shield'], hp: 90, dmg: 12, speed: 7.5, range: 2.6, atkTime: 0.8, name: 'Sellsword' },
  bow: { model: 'Rogue', show: ['2H_Crossbow'], hp: 60, dmg: 10, speed: 7.5, range: 13, atkTime: 1.3, ranged: true, name: 'Marksman' },
  // spectral copies of their caster: fast, fragile, and gone in seconds
  phantom: { model: 'Mage', show: [], hp: 45, dmg: 8, speed: 9.5, range: 2.6, atkTime: 0.55, name: 'Phantom', phantom: true },
};

export function clearMinions() {
  for (const m of minions) m.obj.parent?.remove(m.obj);
  minions.length = 0;
  nextMinionId = 1;
}

export function spawnMinion(kindId, owner, floor, x, z, id = null, broadcast = true, opts = {}) {
  const kind = KINDS[kindId] || KINDS.sword;
  const model = opts.model || kind.model;
  const show = opts.show || kind.show;
  const { obj, anim } = makeCharacter('char', model, show);
  if (kind.phantom) tintCharacter(obj, 0xbfe0ff, { ghost: true });
  else applyLook(obj, { cape: true, helmet: true, capeColor: 5 });
  obj.position.set(x, 0, z);
  obj.add(makeBlobShadow(0.8));
  const c = document.createElement('canvas');
  c.width = 256; c.height = 44;
  const g = c.getContext('2d');
  g.font = 'bold 22px Trebuchet MS'; g.textAlign = 'center';
  g.strokeStyle = '#000'; g.lineWidth = 5;
  const tagText = (kind.phantom ? '👤 ' : '🤺 ') + kind.name;
  g.strokeText(tagText, 128, 28);
  g.fillStyle = kind.phantom ? '#cfe6ff' : '#9fd6ff';
  g.fillText(tagText, 128, 28);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  tag.scale.set(2.2, 0.4, 1);
  tag.position.y = 2.45;
  obj.add(tag);
  anim.play('Idle');
  const fs = floorState(floor);
  (fs.meshGroup || G.scene).add(obj);
  obj.visible = floor === G.floor;
  const m = {
    id: id ?? nextMinionId++, owner, kind: kindId, cfg: kind, floor,
    obj, anim, hp: kind.hp, maxHp: kind.hp, dmg: opts.dmg || kind.dmg,
    life: opts.life ?? null,
    state: 'follow', atkT: 0, netX: x, netY: 0, netZ: z, netYaw: 0, vy: 0, dead: false,
  };
  if (id !== null && id >= nextMinionId) nextMinionId = id + 1;
  minions.push(m);
  if (broadcast && G.net.role !== 'solo') {
    netSend({ t: 'mspawn', id: m.id, kind: kindId, owner, f: floor, x, z, o: { model, show, dmg: m.dmg, life: m.life } });
  }
  return m;
}

function ownerPos(m) {
  if (m.owner === myId()) return G.player && !G.player.dead && G.floor === m.floor ? G.player.obj.position : null;
  const r = G.remotes.get(m.owner);
  return r && !r.dead && r.floor === m.floor ? r.obj.position : null;
}

// entries enemies can target: {pos, id:'m<id>', minion}
export function minionTargetsOnFloor(n) {
  return minions.filter(m => !m.dead && m.floor === n).map(m => ({ pos: m.obj.position, id: 'm' + m.id, minion: m }));
}
export function minionById(id) { return minions.find(m => m.id === id); }

export function damageMinion(m, amount, fromNet = false) {
  if (!m || m.dead) return;
  m.hp -= amount;
  if (m.floor === G.floor) spawnDamageNumber(m.obj.position.clone().setY(m.obj.position.y + 2), `-${amount}`, '#9fd6ff');
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'mhp', id: m.id, hp: m.hp });
  if (m.hp <= 0) {
    m.dead = true;
    if (m.cfg.phantom) {
      if (m.floor === G.floor) spawnBurst(m.obj.position.clone().setY(m.obj.position.y + 1.1), 0xbfe0ff, 18, 4, 0.13, 0.5);
      m.obj.parent?.remove(m.obj);
    } else {
      m.anim.play('Death_A', { once: true, clamp: true });
      if (m.floor === G.floor) { sfx.death(); addMsg('Your mercenary has fallen!', 'bad'); }
      setTimeout(() => { m.obj.parent?.remove(m.obj); }, 4000);
    }
    if (G.net.role === 'host' && !fromNet) netSend({ t: 'mdie', id: m.id });
  }
}

// host moves a player's mercs along when they change floors
export function moveMinionsToFloor(owner, floor) {
  for (const m of minions) {
    if (m.owner !== owner || m.dead) continue;
    const fs = floorState(floor);
    if (!fs.grid) continue;
    m.floor = floor;
    m.obj.position.set(fs.grid.spawn.x + 1.5, 0, fs.grid.spawn.z + 1.5);
    m.obj.parent?.remove(m.obj);
    (fs.meshGroup || G.scene).add(m.obj);
    m.obj.visible = floor === G.floor;
  }
}

export function refreshMinionVisibility() {
  for (const m of minions) m.obj.visible = m.floor === G.floor && !m.dead;
}

export function updateMinions(dt) {
  const authority = isAuthority();
  for (const m of minions) {
    if (m.dead) continue;
    if (m.floor === G.floor) m.anim.update(dt);

    if (!authority) {
      if (m.floor !== G.floor) { m.obj.position.set(m.netX, m.netY, m.netZ); continue; }
      m.obj.position.x += (m.netX - m.obj.position.x) * Math.min(1, dt * 10);
      m.obj.position.y += (m.netY - m.obj.position.y) * Math.min(1, dt * 10);
      m.obj.position.z += (m.netZ - m.obj.position.z) * Math.min(1, dt * 10);
      let dy = m.netYaw - m.obj.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      m.obj.rotation.y += dy * Math.min(1, dt * 10);
      continue;
    }

    const fs = G.floors.get(m.floor);
    if (!fs?.grid) continue;
    // summoned phantoms fade when their time runs out
    if (m.life != null) {
      m.life -= dt;
      if (m.life <= 0) { damageMinion(m, m.hp + 1); continue; }
    }
    const pos = m.obj.position;
    m.atkT -= dt;

    // pick a target: nearest living enemy in aggro range
    let target = null, td = 14;
    for (const e of fs.enemies) {
      if (e.state === 'dead' || e.state === 'inactive') continue;
      const d = Math.hypot(e.obj.position.x - pos.x, e.obj.position.z - pos.z);
      if (d < td) { td = d; target = e; }
    }

    let moveTo = null, moveSpeed = m.cfg.speed;
    if (target) {
      const inRange = td < m.cfg.range && Math.abs(target.obj.position.y - pos.y) < 2 &&
        (!m.cfg.ranged || hasLineOfSight(pos.x, pos.z, target.obj.position.x, target.obj.position.z, fs.grid));
      m.obj.rotation.y = Math.atan2(target.obj.position.x - pos.x, target.obj.position.z - pos.z);
      if (inRange) {
        if (m.atkT <= 0) {
          m.atkT = m.cfg.atkTime;
          const atkClip = m.cfg.ranged ? '2H_Ranged_Shoot'
            : m.anim.has('1H_Melee_Attack_Slice_Horizontal') ? '1H_Melee_Attack_Slice_Horizontal'
            : 'Unarmed_Melee_Attack_Punch_A';
          m.anim.play(atkClip, { once: true });
          if (m.cfg.ranged) {
            const from = pos.clone().setY(pos.y + 1.4);
            const to = target.obj.position.clone().setY(target.obj.position.y + 1.1);
            const dir = to.sub(from).normalize();
            const bolt = { x: from.x + dir.x * 0.6, y: from.y, z: from.z + dir.z * 0.6, dirX: dir.x, dirY: dir.y, dirZ: dir.z, speed: 22, dmg: 0, owner: 'fx', color: 0xbfe3ff };
            if (m.floor === G.floor) spawnBolt(bolt);
            netSend({ t: 'bolt', f: m.floor, b: bolt });
            damageEnemy(target, m.dmg, Math.random() < 0.1, false, 'none');
          } else {
            damageEnemy(target, m.dmg, Math.random() < 0.1, false, 'none');
            if (m.floor === G.floor) sfx.swing();
          }
        }
      } else {
        moveTo = target.obj.position;
      }
    } else {
      const op = ownerPos(m);
      if (op && Math.hypot(op.x - pos.x, op.z - pos.z) > 3.2) moveTo = op;
    }

    if (moveTo) {
      const dx = moveTo.x - pos.x, dz = moveTo.z - pos.z;
      const d = Math.max(0.001, Math.hypot(dx, dz));
      moveWithCollision(pos, (dx / d) * moveSpeed * dt, (dz / d) * moveSpeed * dt, 0.5, { y: pos.y, grid: fs.grid });
      m.obj.rotation.y = Math.atan2(dx, dz);
      if (m.anim.currentName !== 'Running_A' && m.atkT <= 0) m.anim.play('Running_A');
    } else if (m.anim.currentName === 'Running_A') {
      m.anim.play('Idle');
    }

    // gravity
    const ground = groundHeightAt(pos.x, pos.z, pos.y, fs.grid);
    if (pos.y > ground + 0.02) {
      m.vy -= 26 * dt;
      pos.y = Math.max(ground, pos.y + m.vy * dt);
      if (pos.y === ground) m.vy = 0;
    } else if (ground > pos.y && ground - pos.y <= 1.6) {
      pos.y = ground;
    }
  }
}

// periodic snapshots (host), piggybacks on the esnap cadence
export function minionSnapshot() {
  const list = [];
  for (const m of minions) {
    if (m.dead) continue;
    list.push([m.id, m.floor, +m.obj.position.x.toFixed(2), +m.obj.position.y.toFixed(2), +m.obj.position.z.toFixed(2), +m.obj.rotation.y.toFixed(2), m.hp]);
  }
  return list;
}
export function applyMinionSnapshot(list) {
  for (const s of list) {
    const m = minionById(s[0]);
    if (!m) continue;
    if (m.floor !== s[1]) {
      m.floor = s[1];
      const fs = G.floors.get(s[1]);
      if (fs?.meshGroup) { m.obj.parent?.remove(m.obj); fs.meshGroup.add(m.obj); }
      m.obj.position.set(s[2], s[3], s[4]);
      m.obj.visible = m.floor === G.floor;
    }
    m.netX = s[2]; m.netY = s[3]; m.netZ = s[4]; m.netYaw = s[5]; m.hp = s[6];
  }
}

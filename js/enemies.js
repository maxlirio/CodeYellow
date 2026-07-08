// Skeleton horde: spawning (incl. elites/tints/ghosts), AI state machine with elevation,
// status effects (slow/stun/poison/knockback), bombers that explode, item drops.
import * as THREE from 'three';
import { G } from './state.js';
import { ENEMIES, scaleHp, scaleDmg, BOSS_NAMES } from './config.js';
import { makeCharacter, tintCharacter } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, hasLineOfSight, groundHeightAt } from './dungeon.js';
import { spawnBolt } from './projectiles.js';
import { netSend, isAuthority } from './net.js';
import { addMsg, showBossBar, updateBossBar, hideBossBar } from './ui.js';
import { damageLocalPlayer, gainXp, notifyHit } from './player.js';
import { rollAnyItem } from './items.js';
import { dropItemLoot } from './loot.js';

let enemyGroup = null;
let nextId = 0;

export function clearEnemies() {
  if (enemyGroup) { G.scene.remove(enemyGroup); enemyGroup = null; }
  G.enemies = [];
  nextId = 0;
  hideBossBar();
}

export function spawnEnemies(enemySpawns) {
  clearEnemies();
  enemyGroup = new THREE.Group();
  G.scene.add(enemyGroup);
  for (const s of enemySpawns) spawnEnemy(s.type, s.x, s.z, true, s.y || 0, s.elite);
}

export function spawnEnemy(type, x, z, fromNet = false, y = 0, elite = false) {
  const cfg = ENEMIES[type];
  const { obj, anim } = makeCharacter('enemy', cfg.model);
  obj.position.set(x, y, z);
  const scale = cfg.scale * (elite ? 1.28 : 1);
  obj.scale.setScalar(scale);
  if (cfg.tint) tintCharacter(obj, cfg.tint);
  if (cfg.ghost) tintCharacter(obj, 0xcfe8ff, { ghost: true });
  if (elite) tintCharacter(obj, 0xffcc66, { emissive: 0x662200 });
  obj.add(makeBlobShadow(0.9 * scale));
  enemyGroup.add(obj);
  const e = {
    id: nextId++, type, cfg, elite,
    hp: Math.round(scaleHp(cfg.hp, G.floor) * (elite ? 2.4 : 1)),
    maxHp: Math.round(scaleHp(cfg.hp, G.floor) * (elite ? 2.4 : 1)),
    dmg: Math.round(scaleDmg(cfg.dmg, G.floor) * (elite ? 1.5 : 1)),
    obj, anim, state: 'inactive', stateT: 0, attackT: 0, attackFired: false,
    yaw: Math.random() * Math.PI * 2, scale, boss: !!cfg.boss, ghost: !!cfg.ghost,
    summonT: 5, netX: x, netY: y, netZ: z, netYaw: 0, deadT: 0,
    slowT: 0, slowMult: 1, stunT: 0, poisonT: 0, poisonDps: 0, poisonTick: 0, poisonBy: 'local',
    kbX: 0, kbZ: 0, vy: 0,
  };
  obj.rotation.y = e.yaw;
  anim.play(anim.has('Skeleton_Inactive_Standing_Pose') ? 'Skeleton_Inactive_Standing_Pose' : 'Idle');
  G.enemies.push(e);
  return e;
}

function alivePlayers() {
  const list = [];
  if (G.player && !G.player.dead) list.push({ pos: G.player.obj.position, id: 'me' });
  for (const [pid, r] of G.remotes) if (!r.dead) list.push({ pos: r.obj.position, id: pid });
  return list;
}

function nearestPlayer(e) {
  let best = null, bd = Infinity;
  for (const p of alivePlayers()) {
    const d = Math.hypot(p.pos.x - e.obj.position.x, p.pos.z - e.obj.position.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { ...best, dist: bd } : null;
}

const ATTACK_ANIMS = ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'];

function bomberExplode(e) {
  spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0x99ff44, 30, 8, 0.2, 0.6);
  spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0xffaa22, 20, 6, 0.16, 0.5);
  sfx.trap(); sfx.bones();
  netSend({ t: 'fx', x: e.obj.position.x, y: e.obj.position.y + 1, z: e.obj.position.z, color: 0x99ff44, big: 1 });
  // hurt local player if close (each client checks its own player via fx? host authoritative for damage)
  const pl = G.player;
  if (pl && !pl.dead) {
    const d = Math.hypot(pl.obj.position.x - e.obj.position.x, pl.obj.position.z - e.obj.position.z);
    if (d < e.cfg.explode && Math.abs(pl.obj.position.y - e.obj.position.y) < 2.5) damageLocalPlayer(e.dmg);
  }
  for (const [pid, r] of G.remotes) {
    const d = Math.hypot(r.obj.position.x - e.obj.position.x, r.obj.position.z - e.obj.position.z);
    if (d < e.cfg.explode && !r.dead) netSend({ t: 'phit', target: pid, dmg: e.dmg });
  }
  killEnemy(e, 'none');
}

export function updateEnemies(dt) {
  const authority = isAuthority();
  for (const e of G.enemies) {
    e.anim.update(dt);
    if (e.state === 'dead') {
      e.deadT += dt;
      if (e.deadT > 2.2) e.obj.position.y -= dt * 0.5;
      if (e.deadT > 4) e.obj.visible = false;
      continue;
    }
    if (e.boss && e.state !== 'inactive') updateBossBar(e.hp / e.maxHp);

    if (!authority) {
      e.obj.position.x += (e.netX - e.obj.position.x) * Math.min(1, dt * 10);
      e.obj.position.y += (e.netY - e.obj.position.y) * Math.min(1, dt * 10);
      e.obj.position.z += (e.netZ - e.obj.position.z) * Math.min(1, dt * 10);
      let dy = e.netYaw - e.obj.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.obj.rotation.y += dy * Math.min(1, dt * 10);
      continue;
    }

    // ---- status effects ----
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowMult = 1; }
    if (e.poisonT > 0) {
      e.poisonT -= dt;
      e.poisonTick -= dt;
      if (e.poisonTick <= 0) {
        e.poisonTick = 0.5;
        damageEnemy(e, Math.max(1, Math.round(e.poisonDps * 0.5)), false, true, e.poisonBy);
        spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.2), 0x66ff44, 4, 2, 0.08, 0.3);
        if (e.state === 'dead') continue;
      }
    }
    // knockback impulse
    if (Math.abs(e.kbX) > 0.1 || Math.abs(e.kbZ) > 0.1) {
      moveWithCollision(e.obj.position, e.kbX * dt, e.kbZ * dt, 0.5 * e.scale, { y: e.obj.position.y, ghost: e.ghost });
      e.kbX *= Math.pow(0.02, dt);
      e.kbZ *= Math.pow(0.02, dt);
    }
    if (e.stunT > 0) { e.stunT -= dt; continue; }

    e.stateT += dt;
    const t = nearestPlayer(e);
    const dy3 = t ? Math.abs(t.pos.y - e.obj.position.y) : 0;

    switch (e.state) {
      case 'inactive': {
        if (t && t.dist < e.cfg.aggro && (e.ghost || hasLineOfSight(e.obj.position.x, e.obj.position.z, t.pos.x, t.pos.z))) {
          setEnemyState(e, 'awaken');
          if (e.boss) {
            sfx.bossroar();
            showBossBar(BOSS_NAMES[G.floor] || 'ANCIENT HORROR');
            addMsg(`${BOSS_NAMES[G.floor] || 'A boss'} awakens!`, 'bad');
          } else if (Math.random() < 0.4) sfx.bones();
        }
        break;
      }
      case 'awaken': {
        if (e.stateT > 1.6) setEnemyState(e, 'chase');
        break;
      }
      case 'chase': {
        if (!t) { setEnemyState(e, 'idle'); break; }
        // bombers detonate instead of attacking
        if (e.cfg.explode && t.dist < e.cfg.range && dy3 < 2) { bomberExplode(e); break; }
        const canSee = e.ghost || hasLineOfSight(e.obj.position.x, e.obj.position.z, t.pos.x, t.pos.z);
        const inRange = t.dist < e.cfg.range && (e.cfg.ranged ? true : dy3 < 1.8);
        if (inRange && canSee) {
          setEnemyState(e, 'attack');
          e.attackFired = false;
          break;
        }
        const dx = t.pos.x - e.obj.position.x, dz = t.pos.z - e.obj.position.z;
        const d = Math.max(0.001, Math.hypot(dx, dz));
        e.yaw = Math.atan2(dx, dz);
        const speed = e.cfg.speed * e.slowMult;
        let mx = (dx / d) * speed * dt, mz = (dz / d) * speed * dt;
        for (const o of G.enemies) {
          if (o === e || o.state === 'dead') continue;
          const ox = e.obj.position.x - o.obj.position.x, oz = e.obj.position.z - o.obj.position.z;
          const od = Math.hypot(ox, oz);
          if (od < 1.4 && od > 0.01) { mx += (ox / od) * dt * 2.5; mz += (oz / od) * dt * 2.5; }
        }
        moveWithCollision(e.obj.position, mx, mz, 0.5 * e.scale, { y: e.obj.position.y, ghost: e.ghost });
        break;
      }
      case 'attack': {
        if (t) e.yaw = Math.atan2(t.pos.x - e.obj.position.x, t.pos.z - e.obj.position.z);
        const hitMoment = e.cfg.attackTime * 0.55;
        if (!e.attackFired && e.stateT > hitMoment) {
          e.attackFired = true;
          if (e.cfg.ranged && t) {
            // aim in 3D at the target (handles platforms)
            const from = e.obj.position.clone().setY(e.obj.position.y + 1.6 * e.scale);
            const to = new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z);
            const dir = to.sub(from).normalize();
            const bolt = {
              x: from.x + dir.x * 0.8, y: from.y, z: from.z + dir.z * 0.8,
              dirX: dir.x, dirY: dir.y, dirZ: dir.z,
              speed: 13, dmg: e.dmg, owner: 'enemy',
              color: e.cfg.slowBolt ? 0x66ccff : 0x9944ff,
              slow: e.cfg.slowBolt ? { mult: 0.5, dur: 2.5 } : null,
            };
            spawnBolt(bolt);
            sfx.bolt();
            netSend({ t: 'ebolt', b: bolt });
          } else if (t && t.dist < e.cfg.range + 0.6 && dy3 < 2) {
            if (t.id === 'me') damageLocalPlayer(e.dmg);
            else netSend({ t: 'phit', target: t.id, dmg: e.dmg });
          }
        }
        if (e.stateT > e.cfg.attackTime + 0.25) setEnemyState(e, 'chase');
        break;
      }
      case 'hit': {
        if (e.stateT > 0.35) setEnemyState(e, 'chase');
        break;
      }
      case 'idle': {
        if (t && t.dist < e.cfg.aggro * 1.5) setEnemyState(e, 'chase');
        break;
      }
    }

    // gravity / float
    if (e.ghost) {
      const targetY = t ? t.pos.y + 0.35 : 0.35;
      e.obj.position.y += (targetY + Math.sin(G.time * 2 + e.id) * 0.25 - e.obj.position.y) * Math.min(1, dt * 2);
    } else {
      const ground = groundHeightAt(e.obj.position.x, e.obj.position.z, e.obj.position.y);
      if (e.obj.position.y > ground + 0.02) {
        e.vy -= 26 * dt;
        e.obj.position.y = Math.max(ground, e.obj.position.y + e.vy * dt);
        if (e.obj.position.y === ground) e.vy = 0;
      } else if (ground > e.obj.position.y && ground - e.obj.position.y <= 1.6) {
        e.obj.position.y = ground;
        e.vy = 0;
      }
    }

    // boss summons
    if (e.boss && e.cfg.summons && e.state !== 'inactive' && e.state !== 'dead') {
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = 9;
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          const x = e.obj.position.x + Math.sin(a) * 3, z = e.obj.position.z + Math.cos(a) * 3;
          const m = spawnEnemy('minion', x, z, true, e.obj.position.y);
          setEnemyState(m, 'awaken');
          netSend({ t: 'espawn', type: 'minion', x, z, y: e.obj.position.y });
          spawnBurst(new THREE.Vector3(x, e.obj.position.y + 1, z), 0x9944ff, 12, 4, 0.13);
        }
        addMsg('The Bone King summons minions!', 'bad');
      }
    }

    let dyw = e.yaw - e.obj.rotation.y;
    while (dyw > Math.PI) dyw -= Math.PI * 2;
    while (dyw < -Math.PI) dyw += Math.PI * 2;
    e.obj.rotation.y += dyw * Math.min(1, dt * 8);
  }
}

export function setEnemyState(e, s, fromNet = false) {
  if (e.state === 'dead') return;
  if (e.state === s) return;
  e.state = s;
  e.stateT = 0;
  const a = e.anim;
  switch (s) {
    case 'awaken':
      a.play(a.has('Skeletons_Awaken_Standing') ? 'Skeletons_Awaken_Standing' : 'Idle', { once: true, clamp: true });
      break;
    case 'chase':
      a.play(e.cfg.speed > 5 ? 'Running_A' : (a.has('Walking_D_Skeletons') ? 'Walking_D_Skeletons' : 'Walking_A'));
      break;
    case 'attack': {
      const clip = e.cfg.ranged ? 'Spellcast_Shoot' : ATTACK_ANIMS[Math.floor(Math.random() * ATTACK_ANIMS.length)];
      const act = a.play(clip, { once: true, clamp: true });
      if (act) act.timeScale = act.getClip().duration / e.cfg.attackTime;
      break;
    }
    case 'hit':
      a.play('Hit_A', { once: true, clamp: true });
      break;
    case 'idle':
      a.play(a.has('Idle_B') ? 'Idle_B' : 'Idle');
      break;
    case 'dead': {
      a.play(Math.random() < 0.5 ? 'Death_A' : 'Death_B', { once: true, clamp: true });
      break;
    }
  }
  if (isAuthority() && !fromNet) netSend({ t: 'estate', id: e.id, s });
}

// source: 'local' if my hit, else remote player id; effects: {slow, stun, poison, kb}
export function damageEnemy(e, amount, crit = false, fromNet = false, source = 'local', effects = null) {
  if (!e || e.state === 'dead') return;
  if (G.net.role === 'guest' && !fromNet) {
    netSend({ t: 'dmg', id: e.id, amount, crit, fx: effects });
    spawnDamageNumber(e.obj.position.clone().setY(e.obj.position.y + 2 * e.scale), crit ? `${amount}!` : `${amount}`, crit ? '#ff5533' : '#ffd35c', crit);
    notifyHit(crit);
    return;
  }
  e.hp -= amount;
  const mine = source === 'local';
  spawnDamageNumber(e.obj.position.clone().setY(e.obj.position.y + 2 * e.scale), crit ? `${amount}!` : `${amount}`, crit ? '#ff5533' : '#ffd35c', crit);
  spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.2), 0xcccccc, 6, 3, 0.09, 0.35);
  if (mine) { sfx[crit ? 'crit' : 'hit'](); notifyHit(crit); }

  if (effects) {
    if (effects.slow) { e.slowT = effects.slow.dur; e.slowMult = effects.slow.mult; }
    if (effects.stun && !e.boss) e.stunT = Math.max(e.stunT, effects.stun);
    if (effects.poison) { e.poisonT = effects.poison.dur; e.poisonDps = effects.poison.dps; e.poisonBy = source; }
    if (effects.kb && !e.boss) { e.kbX += effects.kb.x; e.kbZ += effects.kb.z; }
  }

  if (G.net.role === 'host') netSend({ t: 'ehp', id: e.id, hp: e.hp });

  if (e.hp <= 0) {
    killEnemy(e, source);
  } else if (e.state !== 'inactive' && e.state !== 'awaken' && !e.boss && Math.random() < 0.45) {
    setEnemyState(e, 'hit');
  } else if (e.state === 'inactive' && isAuthority()) {
    setEnemyState(e, 'awaken');
  }
}

export function killEnemy(e, source = 'local', fromNet = false) {
  if (e.state === 'dead') return;
  setEnemyState(e, 'dead', true);
  e.state = 'dead';
  sfx.bones();
  spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0xe8e0cc, 18, 5, 0.13, 0.7);
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'edie', id: e.id, by: source === 'local' ? 'host' : source });

  const mine = source === 'local';
  if (mine) {
    const gold = Math.round((e.cfg.gold[0] + Math.floor(Math.random() * (e.cfg.gold[1] - e.cfg.gold[0]))) * (e.elite ? 2 : 1));
    G.run.gold += gold;
    G.run.kills++;
    gainXp(Math.round(e.cfg.xp * (e.elite ? 2.5 : 1)));
    addMsg(`${e.boss ? '💀 Boss defeated!' : e.elite ? '⭐ Elite destroyed!' : 'Skeleton destroyed'} +${gold}g`, e.boss || e.elite ? 'gold' : '');
  }
  // item drops (authority rolls & shares the actual item)
  if (isAuthority() && !fromNet && source !== 'none') {
    const chance = e.boss ? 1 : e.elite ? 0.45 : 0.09;
    if (Math.random() < chance) {
      const forClass = pickDropClass(source);
      const item = rollAnyItem(forClass, G.floor, e.boss ? 0.8 : e.elite ? 0.3 : 0);
      dropItemLoot(item, e.obj.position.x, e.obj.position.z, e.obj.position.y);
    }
  }
  if (e.boss) {
    hideBossBar();
    sfx.death();
    if (G.grid) G.grid.stairsLocked = false;
    addMsg('The way down is open!', 'gold');
  }
}

// drop an item usable by the killer (host knows guests' classes from the lobby)
function pickDropClass(source) {
  if (source === 'local' || source === 'host') return G.player.classId;
  const p = G.net.players.get(source);
  if (p?.classId) return p.classId;
  return G.player.classId;
}

export function enemyById(id) { return G.enemies.find(e => e.id === id); }
export function anyBossAlive() { return G.enemies.some(e => e.boss && e.state !== 'dead'); }

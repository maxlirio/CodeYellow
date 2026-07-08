// Skeleton enemies: spawning, AI state machine (host/solo simulates), animation, death & loot.
import * as THREE from 'three';
import { G } from './state.js';
import { ENEMIES, scaleHp, scaleDmg, BOSS_NAMES } from './config.js';
import { makeCharacter } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, hasLineOfSight } from './dungeon.js';
import { spawnBolt } from './projectiles.js';
import { netSend, isAuthority } from './net.js';
import { addMsg, showBossBar, updateBossBar, hideBossBar } from './ui.js';
import { damageLocalPlayer, gainXp } from './player.js';

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
  for (const s of enemySpawns) spawnEnemy(s.type, s.x, s.z);
}

export function spawnEnemy(type, x, z, fromNet = false) {
  const cfg = ENEMIES[type];
  const { obj, anim } = makeCharacter('enemy', cfg.model);
  obj.position.set(x, 0, z);
  obj.scale.setScalar(cfg.scale);
  obj.add(makeBlobShadow(0.9 * cfg.scale));
  enemyGroup.add(obj);
  const e = {
    id: nextId++, type, cfg,
    hp: scaleHp(cfg.hp, G.floor), maxHp: scaleHp(cfg.hp, G.floor),
    dmg: scaleDmg(cfg.dmg, G.floor),
    obj, anim, state: 'inactive', stateT: 0, attackT: 0, attackFired: false,
    yaw: Math.random() * Math.PI * 2, scale: cfg.scale, boss: !!cfg.boss,
    summonT: 5, netX: x, netZ: z, netYaw: 0, deadT: 0,
  };
  obj.rotation.y = e.yaw;
  anim.play(anim.has('Skeleton_Inactive_Standing_Pose') ? 'Skeleton_Inactive_Standing_Pose' : 'Idle');
  G.enemies.push(e);
  if (G.net.role === 'host' && !fromNet) {
    // summoned adds (initial spawns are deterministic from the seed, no message needed)
  }
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

export function updateEnemies(dt) {
  const authority = isAuthority();
  for (const e of G.enemies) {
    e.anim.update(dt);
    if (e.state === 'dead') {
      e.deadT += dt;
      if (e.deadT > 2.2) e.obj.position.y = -dt * 0.5 + e.obj.position.y; // sink
      if (e.deadT > 4) e.obj.visible = false;
      continue;
    }
    if (e.boss && e.state !== 'inactive') updateBossBar(e.hp / e.maxHp);

    if (!authority) {
      // guest: interpolate to host state
      e.obj.position.x += (e.netX - e.obj.position.x) * Math.min(1, dt * 10);
      e.obj.position.z += (e.netZ - e.obj.position.z) * Math.min(1, dt * 10);
      let dy = e.netYaw - e.obj.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.obj.rotation.y += dy * Math.min(1, dt * 10);
      continue;
    }

    e.stateT += dt;
    const t = nearestPlayer(e);

    switch (e.state) {
      case 'inactive': {
        if (t && t.dist < e.cfg.aggro && hasLineOfSight(e.obj.position.x, e.obj.position.z, t.pos.x, t.pos.z)) {
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
        const inRange = t.dist < e.cfg.range;
        const canSee = hasLineOfSight(e.obj.position.x, e.obj.position.z, t.pos.x, t.pos.z);
        if (inRange && (!e.cfg.ranged || canSee)) {
          setEnemyState(e, 'attack');
          e.attackFired = false;
          break;
        }
        const dx = t.pos.x - e.obj.position.x, dz = t.pos.z - e.obj.position.z;
        const d = Math.max(0.001, Math.hypot(dx, dz));
        e.yaw = Math.atan2(dx, dz);
        let mx = (dx / d) * e.cfg.speed * dt, mz = (dz / d) * e.cfg.speed * dt;
        // separation from other enemies
        for (const o of G.enemies) {
          if (o === e || o.state === 'dead') continue;
          const ox = e.obj.position.x - o.obj.position.x, oz = e.obj.position.z - o.obj.position.z;
          const od = Math.hypot(ox, oz);
          if (od < 1.4 && od > 0.01) { mx += (ox / od) * dt * 2.5; mz += (oz / od) * dt * 2.5; }
        }
        moveWithCollision(e.obj.position, mx, mz, 0.5 * e.scale);
        break;
      }
      case 'attack': {
        if (t) e.yaw = Math.atan2(t.pos.x - e.obj.position.x, t.pos.z - e.obj.position.z);
        const hitMoment = e.cfg.attackTime * 0.55;
        if (!e.attackFired && e.stateT > hitMoment) {
          e.attackFired = true;
          if (e.cfg.ranged) {
            const dx = Math.sin(e.yaw), dz = Math.cos(e.yaw);
            const bolt = {
              x: e.obj.position.x + dx * 0.8, z: e.obj.position.z + dz * 0.8,
              dirX: dx, dirZ: dz, speed: 13, dmg: e.dmg, owner: 'enemy', color: 0x9944ff,
              y: 1.6 * e.scale,
            };
            spawnBolt(bolt);
            sfx.bolt();
            netSend({ t: 'ebolt', b: bolt });
          } else if (t && t.dist < e.cfg.range + 0.6) {
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

    // boss summons
    if (e.boss && e.cfg.summons && e.state !== 'inactive' && e.state !== 'dead') {
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = 9;
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          const x = e.obj.position.x + Math.sin(a) * 3, z = e.obj.position.z + Math.cos(a) * 3;
          const m = spawnEnemy('minion', x, z, true);
          setEnemyState(m, 'awaken');
          netSend({ t: 'espawn', type: 'minion', x, z });
          spawnBurst(new THREE.Vector3(x, 1, z), 0x9944ff, 12, 4, 0.13);
        }
        addMsg('The Bone King summons minions!', 'bad');
      }
    }

    // smooth turn + walk anim handled by state
    let dy = e.yaw - e.obj.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    e.obj.rotation.y += dy * Math.min(1, dt * 8);
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

// source: 'local' if my hit, else remote player id
export function damageEnemy(e, amount, crit = false, fromNet = false, source = 'local') {
  if (!e || e.state === 'dead') return;
  if (G.net.role === 'guest' && !fromNet) {
    // predict nothing; ask host (host applies + broadcasts hp)
    netSend({ t: 'dmg', id: e.id, amount, crit });
    // still show feedback immediately
    spawnDamageNumber(e.obj.position.clone().setY(2 * e.scale), crit ? `${amount}!` : `${amount}`, crit ? '#ff5533' : '#ffd35c', crit);
    return;
  }
  e.hp -= amount;
  const mine = source === 'local';
  if (!fromNet || G.net.role !== 'guest') {
    spawnDamageNumber(e.obj.position.clone().setY(2 * e.scale), crit ? `${amount}!` : `${amount}`, crit ? '#ff5533' : '#ffd35c', crit);
  }
  spawnBurst(e.obj.position.clone().setY(1.2), 0xcccccc, 6, 3, 0.09, 0.35);
  if (mine) sfx[crit ? 'crit' : 'hit']();

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
  spawnBurst(e.obj.position.clone().setY(1), 0xe8e0cc, 18, 5, 0.13, 0.7);
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'edie', id: e.id, by: source === 'local' ? 'host' : source });

  const mine = source === 'local';
  if (mine) {
    const gold = e.cfg.gold[0] + Math.floor(Math.random() * (e.cfg.gold[1] - e.cfg.gold[0]));
    G.run.gold += gold;
    G.run.kills++;
    gainXp(e.cfg.xp);
    addMsg(`${e.boss ? '💀 Boss defeated!' : 'Skeleton destroyed'} +${gold}g`, e.boss ? 'gold' : '');
  }
  if (e.boss) {
    hideBossBar();
    sfx.death();
    if (G.grid) G.grid.stairsLocked = false; // unlock on every client
    addMsg('The way down is open!', 'gold');
  }
}

export function enemyById(id) { return G.enemies.find(e => e.id === id); }

export function anyBossAlive() { return G.enemies.some(e => e.boss && e.state !== 'dead'); }

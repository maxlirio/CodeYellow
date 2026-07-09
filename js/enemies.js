// Skeleton horde, now per-floor: the authority simulates every floor that has a
// player on it; each client renders/animates only its own floor. Enemy ids are
// floor-namespaced and deterministic (floor*1000+index; summons get 500+).
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { ENEMIES, scaleHp, scaleDmg, ANIM_GROUND, ANIM_CRITTER, ANIM_FLYER } from './config.js';
import { makeCharacter, tintCharacter, makeWeaponModel } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, hasLineOfSight, groundHeightAt } from './dungeon.js';
import { spawnBolt } from './projectiles.js';
import { netSend, isAuthority } from './net.js';
import { addMsg, showBossBar, updateBossBar, hideBossBar } from './ui.js';
import { damageLocalPlayer, gainXp, notifyHit } from './player.js';
import { rollAnyItem } from './items.js';
import { dropItemLoot } from './loot.js';
import { minionTargetsOnFloor, damageMinion } from './minions.js';
import { wallAt, damageWall } from './walls.js';

export function spawnEnemiesForFloor(fs) {
  if (fs.spawned) return;
  fs.enemyGroup = new THREE.Group();
  fs.enemyGroup.visible = false;
  G.scene.add(fs.enemyGroup);
  fs.enemySpawns.forEach((s, i) => {
    spawnEnemy(fs, s.type, s.x, s.z, { y: s.y || 0, elite: s.elite, id: fs.n * 1000 + i });
  });
}

export function spawnEnemy(fs, type, x, z, { y = 0, elite = false, id = null } = {}) {
  const cfg = ENEMIES[type];
  const { obj, anim } = makeCharacter('enemy', cfg.model);
  obj.position.set(x, y, z);
  const scale = cfg.scale * (elite ? 1.28 : 1);
  obj.scale.setScalar(scale);
  if (cfg.tint) tintCharacter(obj, cfg.tint);
  if (cfg.ghost) tintCharacter(obj, 0xcfe8ff, { ghost: true });
  if (elite) tintCharacter(obj, 0xffcc66, { emissive: 0x662200 });
  if (cfg.dragon) {
    // ember-lit so the boss reads in a dark lair; it carries its own firelight
    tintCharacter(obj, 0, { emissive: 0x581400 });
    const glow = new THREE.PointLight(0xff7733, 1.6, 26);
    glow.position.set(0, 0.8, 0);
    obj.add(glow);
  }
  // snipers visibly carry their crossbow
  if (cfg.heldModel) {
    let hand = null;
    obj.traverse((nd) => { if (!hand && nd.name === 'handslot.r') hand = nd; });
    if (hand) {
      const held = makeWeaponModel(cfg.heldModel);
      held.rotation.set(0, Math.PI / 2, 0);
      hand.add(held);
    }
  }
  obj.add(makeBlobShadow(0.9 * scale));
  fs.enemyGroup.add(obj);
  const floorN = fs.n;
  const mut = fs.mutator || {};
  const hpMult = (elite ? 2.4 : 1) * (mut.hpMult ?? 1);
  const e = {
    id: id ?? floorN * 1000 + fs.enemies.length, type, cfg, elite, floor: floorN,
    hp: Math.round(scaleHp(cfg.hp, floorN) * hpMult),
    maxHp: Math.round(scaleHp(cfg.hp, floorN) * hpMult),
    dmg: Math.round(scaleDmg(cfg.dmg, floorN) * (elite ? 1.5 : 1)),
    speedMult: mut.speedMult ?? 1,
    goldMult: (elite ? 2 : 1) * (mut.goldMult ?? 1),
    xpMult: (elite ? 2.5 : 1) * (mut.xpMult ?? 1),
    obj, anim, state: 'inactive', stateT: 0, attackT: 0, attackFired: false,
    yaw: Math.random() * Math.PI * 2, scale, boss: !!cfg.boss, ghost: !!cfg.ghost,
    stalwart: !!cfg.stalwart,
    summonT: cfg.summonEvery ? cfg.summonEvery * 0.6 : 5,
    netX: x, netY: y, netZ: z, netYaw: 0, deadT: 0,
    slowT: 0, slowMult: 1, stunT: 0, poisonT: 0, poisonDps: 0, poisonTick: 0, poisonBy: 'local',
    vulnT: 0, kbX: 0, kbZ: 0, vy: 0,
  };
  obj.rotation.y = e.yaw;
  const m0 = amap(e);
  if (m0) anim.play(m0.idle);
  else anim.play(anim.has('Skeleton_Inactive_Standing_Pose') ? 'Skeleton_Inactive_Standing_Pose' : 'Idle');
  fs.enemies.push(e);
  return e;
}

// players (me + remotes) standing on a given floor — plus their mercenaries
export function playersOnFloor(n) {
  const list = [];
  if (G.player && !G.player.dead && G.floor === n) list.push({ pos: G.player.obj.position, id: 'me' });
  for (const [pid, r] of G.remotes) if (!r.dead && r.floor === n) list.push({ pos: r.obj.position, id: pid });
  list.push(...minionTargetsOnFloor(n));
  return list;
}

function nearestPlayer(e, players) {
  let best = null, bd = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.pos.x - e.obj.position.x, p.pos.z - e.obj.position.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { ...best, dist: bd } : null;
}

const ATTACK_ANIMS = ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'];
const ANIM_MAPS = { ground: ANIM_GROUND, critter: ANIM_CRITTER, flyer: ANIM_FLYER };
const amap = (e) => e.cfg.animMap ? ANIM_MAPS[e.cfg.animMap] : null;
const onMyFloor = (e) => e.floor === G.floor;

function bomberExplode(e) {
  if (onMyFloor(e)) {
    spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0x99ff44, 30, 8, 0.2, 0.6);
    spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0xffaa22, 20, 6, 0.16, 0.5);
    sfx.trap(); sfx.bones();
  }
  netSend({ t: 'fx', f: e.floor, x: e.obj.position.x, y: e.obj.position.y + 1, z: e.obj.position.z, color: 0x99ff44, big: 1 });
  const pl = G.player;
  if (pl && !pl.dead && G.floor === e.floor) {
    const d = Math.hypot(pl.obj.position.x - e.obj.position.x, pl.obj.position.z - e.obj.position.z);
    if (d < e.cfg.explode && Math.abs(pl.obj.position.y - e.obj.position.y) < 2.5) damageLocalPlayer(e.dmg);
  }
  for (const [pid, r] of G.remotes) {
    if (r.floor !== e.floor || r.dead) continue;
    const d = Math.hypot(r.obj.position.x - e.obj.position.x, r.obj.position.z - e.obj.position.z);
    if (d < e.cfg.explode) netSend({ t: 'phit', target: pid, dmg: e.dmg });
  }
  killEnemy(e, 'none');
}

export function updateEnemies(dt) {
  const authority = isAuthority();
  for (const fs of G.floors.values()) {
    if (!fs.spawned) continue;
    const mine = fs.n === G.floor;
    const players = authority ? playersOnFloor(fs.n) : null;
    if (authority && !mine && !players.length) continue; // pause floors nobody is on
    if (!authority && !mine) continue;

    for (const e of fs.enemies) {
      if (mine) e.anim.update(dt);
      if (e.state === 'dead') {
        e.deadT += dt;
        if (e.deadT > 2.2) e.obj.position.y -= dt * 0.5;
        if (e.deadT > 4) e.obj.visible = false;
        continue;
      }
      if (e.boss && mine && e.state !== 'inactive') updateBossBar(e.hp / e.maxHp);

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

      if (e.cfg.dragon) simulateDragon(e, fs, players, dt, mine);
      else simulateEnemy(e, fs, players, dt, mine);
    }
  }
}

function simulateEnemy(e, fs, players, dt, mine) {
  const grid = fs.grid;
  // ---- status effects ----
  if (e.vulnT > 0) e.vulnT -= dt;
  if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowMult = 1; }
  if (e.poisonT > 0) {
    e.poisonT -= dt;
    e.poisonTick -= dt;
    if (e.poisonTick <= 0) {
      e.poisonTick = 0.5;
      damageEnemy(e, Math.max(1, Math.round(e.poisonDps * 0.5)), false, true, e.poisonBy);
      if (mine) spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.2), 0x66ff44, 4, 2, 0.08, 0.3);
      if (e.state === 'dead') return;
    }
  }
  if (Math.abs(e.kbX) > 0.1 || Math.abs(e.kbZ) > 0.1) {
    moveWithCollision(e.obj.position, e.kbX * dt, e.kbZ * dt, 0.5 * e.scale, { y: e.obj.position.y, ghost: e.ghost, grid });
    e.kbX *= Math.pow(0.02, dt);
    e.kbZ *= Math.pow(0.02, dt);
  }
  if (e.stunT > 0) { e.stunT -= dt; return; }

  e.stateT += dt;
  const t = nearestPlayer(e, players);
  const dy3 = t ? Math.abs(t.pos.y - e.obj.position.y) : 0;

  switch (e.state) {
    case 'inactive': {
      if (t && t.dist < e.cfg.aggro && (e.ghost || hasLineOfSight(e.obj.position.x, e.obj.position.z, t.pos.x, t.pos.z, grid))) {
        setEnemyState(e, 'awaken');
        if (e.boss && mine) {
          sfx.bossroar();
          showBossBar(e.cfg.bossName || 'ANCIENT HORROR');
          addMsg(`${e.cfg.bossName || 'A boss'} awakens!`, 'bad');
        } else if (mine && Math.random() < 0.4) sfx.bones();
      }
      break;
    }
    case 'awaken': {
      if (e.stateT > (e.cfg.animMap ? 0.6 : 1.6)) setEnemyState(e, 'chase');
      break;
    }
    case 'chase': {
      if (!t) { setEnemyState(e, 'idle'); break; }
      if (e.cfg.explode && t.dist < e.cfg.range && dy3 < 2) { bomberExplode(e); break; }
      const canSee = e.ghost || hasLineOfSight(e.obj.position.x, e.obj.position.z, t.pos.x, t.pos.z, grid);
      const inRange = t.dist < e.cfg.range && (e.cfg.ranged ? true : dy3 < 1.8);
      if (inRange && canSee) {
        setEnemyState(e, 'attack');
        e.attackFired = false;
        break;
      }
      const dx = t.pos.x - e.obj.position.x, dz = t.pos.z - e.obj.position.z;
      const d = Math.max(0.001, Math.hypot(dx, dz));
      e.yaw = Math.atan2(dx, dz);
      // berserkers get faster as they take damage
      const enrage = e.cfg.enrage ? 1 + (1 - e.hp / e.maxHp) * 0.9 : 1;
      const speed = e.cfg.speed * e.slowMult * e.speedMult * enrage;
      let mx = (dx / d) * speed * dt, mz = (dz / d) * speed * dt;
      for (const o of fs.enemies) {
        if (o === e || o.state === 'dead') continue;
        const ox = e.obj.position.x - o.obj.position.x, oz = e.obj.position.z - o.obj.position.z;
        const od = Math.hypot(ox, oz);
        if (od < 1.4 && od > 0.01) { mx += (ox / od) * dt * 2.5; mz += (oz / od) * dt * 2.5; }
      }
      const beforeX = e.obj.position.x, beforeZ = e.obj.position.z;
      moveWithCollision(e.obj.position, mx, mz, 0.5 * e.scale, { y: e.obj.position.y, ghost: e.ghost, grid });
      // blocked by a barricade? smash through it
      if (!e.ghost) {
        const moved = Math.hypot(e.obj.position.x - beforeX, e.obj.position.z - beforeZ);
        if (moved < speed * dt * 0.25) {
          e.blockT = (e.blockT || 0) + dt;
          if (e.blockT > 0.7) {
            const cx = Math.round((e.obj.position.x + (dx / d) * 3) / 4);
            const cy = Math.round((e.obj.position.z + (dz / d) * 3) / 4);
            const w = wallAt(e.floor, cx, cy) ||
              wallAt(e.floor, Math.round(e.obj.position.x / 4) + Math.sign(Math.round(dx)), Math.round(e.obj.position.z / 4)) ||
              wallAt(e.floor, Math.round(e.obj.position.x / 4), Math.round(e.obj.position.z / 4) + Math.sign(Math.round(dz)));
            if (w) {
              e.blockT = 0;
              setEnemyState(e, 'attack');
              e.attackFired = true; // the swing hits the wall, not a player
              damageWall(w, Math.round(e.dmg * 0.8));
            }
          }
        } else {
          e.blockT = 0;
        }
      }
      break;
    }
    case 'attack': {
      if (t) e.yaw = Math.atan2(t.pos.x - e.obj.position.x, t.pos.z - e.obj.position.z);
      const hitMoment = e.cfg.attackTime * 0.55;
      if (!e.attackFired && e.stateT > hitMoment) {
        e.attackFired = true;
        if (e.cfg.ranged && t?.minion) {
          damageMinion(t.minion, e.dmg); // arrows find mercenaries directly
        } else if (e.cfg.ranged && t) {
          const from = e.obj.position.clone().setY(e.obj.position.y + 1.6 * e.scale);
          const to = new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z);
          const dir = to.sub(from).normalize();
          const bolt = {
            x: from.x + dir.x * 0.8, y: from.y, z: from.z + dir.z * 0.8,
            dirX: dir.x, dirY: dir.y, dirZ: dir.z,
            speed: e.cfg.boltSpeed || 13, dmg: e.dmg, owner: 'enemy',
            color: e.cfg.slowBolt ? 0x66ccff : e.cfg.boltVis === 'arrow' ? 0xddcc88 : 0x9944ff,
            vis: e.cfg.boltVis || (e.cfg.slowBolt ? 'shard' : 'wisp'),
            slow: e.cfg.slowBolt ? { mult: 0.5, dur: 2.5 } : null,
          };
          if (mine) { spawnBolt(bolt); sfx.bolt(); }
          netSend({ t: 'ebolt', f: e.floor, b: bolt });
        } else if (t && t.dist < e.cfg.range + 0.6 && dy3 < 2) {
          let fx = e.cfg.plague ? { poison: { dps: e.cfg.plague.dps + Math.floor(e.floor / 2), dur: e.cfg.plague.dur } } : null;
          if (e.cfg.kbHit && t.dist > 0.01) {
            const kx = (t.pos.x - e.obj.position.x) / t.dist * e.cfg.kbHit;
            const kz = (t.pos.z - e.obj.position.z) / t.dist * e.cfg.kbHit;
            fx = { ...(fx || {}), kb: { x: kx, z: kz } };
          }
          if (t.minion) damageMinion(t.minion, e.dmg);
          else if (t.id === 'me') damageLocalPlayer(e.dmg, fx);
          else netSend({ t: 'phit', target: t.id, dmg: e.dmg, fx });
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
  if (e.cfg.fly && !e.cfg.dragon) {
    const targetY = (t ? t.pos.y : 0) + 1.3;
    e.obj.position.y += (targetY + Math.sin(G.time * 2.4 + e.id) * 0.3 - e.obj.position.y) * Math.min(1, dt * 2.2);
  } else if (e.ghost) {
    const targetY = t ? t.pos.y + 0.35 : 0.35;
    e.obj.position.y += (targetY + Math.sin(G.time * 2 + e.id) * 0.25 - e.obj.position.y) * Math.min(1, dt * 2);
  } else {
    const ground = groundHeightAt(e.obj.position.x, e.obj.position.z, e.obj.position.y, grid);
    if (e.obj.position.y > ground + 0.02) {
      e.vy -= 26 * dt;
      e.obj.position.y = Math.max(ground, e.obj.position.y + e.vy * dt);
      if (e.obj.position.y === ground) e.vy = 0;
    } else if (ground > e.obj.position.y && ground - e.obj.position.y <= 1.6) {
      e.obj.position.y = ground;
      e.vy = 0;
    }
  }

  // summoners (necromancers and summoning bosses)
  if (e.cfg.summons && e.state !== 'inactive' && e.state !== 'dead') {
    e.summonT -= dt;
    if (e.summonT <= 0) {
      e.summonT = e.cfg.summonEvery || 9;
      for (let i = 0; i < (e.cfg.summonCount || 1); i++) {
        const a = Math.random() * Math.PI * 2;
        const x = e.obj.position.x + Math.sin(a) * 3, z = e.obj.position.z + Math.cos(a) * 3;
        const id = fs.n * 1000 + 500 + fs.nextSummonId++;
        const m = spawnEnemy(fs, e.cfg.summonType || 'minion', x, z, { y: e.obj.position.y, id });
        setEnemyState(m, 'awaken');
        fs.summons.push({ id, type: e.cfg.summonType || 'minion', x, z, y: e.obj.position.y });
        netSend({ t: 'espawn', f: fs.n, id, type: e.cfg.summonType || 'minion', x, z, y: e.obj.position.y });
        if (mine) spawnBurst(new THREE.Vector3(x, e.obj.position.y + 1, z), 0x9944ff, 12, 4, 0.13);
      }
      if (mine) addMsg(e.boss ? `${e.cfg.bossName} ${e.cfg.bossMsg || 'summons minions'}!` : 'A necromancer raises the dead!', 'bad');
    }
  }

  let dyw = e.yaw - e.obj.rotation.y;
  while (dyw > Math.PI) dyw -= Math.PI * 2;
  while (dyw < -Math.PI) dyw += Math.PI * 2;
  e.obj.rotation.y += dyw * Math.min(1, dt * 8);
}

// ================= EMBERWING: the dragon boss =================
// Not a chase-bot: it circles overhead, telegraphs breath runs, volleys fire,
// dives to melee when it smells blood, blasts clustered players away with wing
// gusts, and hunts whoever hurts it most. Three phases by health.
function simulateDragon(e, fs, players, dt, mine) {
  if (!e.ds) {
    e.ds = { state: 'sleep', t: 0, orbitA: Math.random() * 6.28, atkCd: 3, home: { x: e.obj.position.x, z: e.obj.position.z }, summonT: 12, breath: null, landT: 0 };
    e.obj.position.y = 6;
  }
  const d = e.ds;
  d.t += dt;
  // status effects still bite, even a dragon
  if (e.vulnT > 0) e.vulnT -= dt;
  if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowMult = 1; }
  if (e.poisonT > 0) {
    e.poisonT -= dt;
    e.poisonTick -= dt;
    if (e.poisonTick <= 0) {
      e.poisonTick = 0.5;
      damageEnemy(e, Math.max(1, Math.round(e.poisonDps * 0.5)), false, true, e.poisonBy);
      if (mine) spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.2), 0x66ff44, 4, 2, 0.08, 0.3);
      if (e.state === 'dead') return;
    }
  }
  const phase = e.hp > e.maxHp * 0.66 ? 1 : e.hp > e.maxHp * 0.33 ? 2 : 3;

  // pick the target it hates most (threat decays so it re-evaluates)
  if (e.threat) for (const k of Object.keys(e.threat)) e.threat[k] *= Math.pow(0.85, dt);
  let target = null, best = -1;
  for (const p of players) {
    if (p.minion) continue;
    const th = (e.threat?.[p.id] || 0) + 1 / (1 + Math.hypot(p.pos.x - e.obj.position.x, p.pos.z - e.obj.position.z));
    if (th > best) { best = th; target = p; }
  }
  if (!target && players.length) target = players[0];

  const pos = e.obj.position;
  const faceTarget = () => { if (target) e.yaw = Math.atan2(target.pos.x - pos.x, target.pos.z - pos.z); };
  const flyToward = (tx, ty, tz, sp) => {
    const dx = tx - pos.x, dy = ty - pos.y, dz = tz - pos.z;
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    const step = Math.min(dist, sp * dt);
    pos.x += (dx / dist) * step; pos.y += (dy / dist) * step; pos.z += (dz / dist) * step;
  };

  // active breath run: flames rake along the telegraphed line
  if (d.breath) {
    const b = d.breath;
    b.t += dt;
    if (b.t >= 0 && b.t < 1.4) {
      b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = 0.14;
        const prog = b.t / 1.4;
        const fx2 = b.x0 + b.dx * prog * b.len, fz2 = b.z0 + b.dz * prog * b.len;
        if (mine) spawnBurst(new THREE.Vector3(fx2, 0.8, fz2), 0xff5511, 14, 5, 0.16, 0.5);
        netSend({ t: 'fx', f: e.floor, x: fx2, y: 0.8, z: fz2, color: 0xff5511, big: 1 });
        for (const p of players) {
          if (Math.hypot(p.pos.x - fx2, p.pos.z - fz2) < 2.2 && p.pos.y < 2.5) {
            if (p.minion) damageMinion(p.minion, Math.round(e.dmg * 0.7));
            else if (p.id === 'me') damageLocalPlayer(Math.round(e.dmg * 0.7), { poison: { dps: 4, dur: 2 } });
            else netSend({ t: 'phit', target: p.id, dmg: Math.round(e.dmg * 0.7), fx: { poison: { dps: 4, dur: 2 } } });
          }
        }
      }
    } else if (b.t >= 1.4) d.breath = null;
  }

  switch (d.state) {
    case 'sleep': {
      if (target && Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z) < e.cfg.aggro) {
        d.state = 'circle';
        setEnemyState(e, 'chase');
        if (mine) { sfx.bossroar(); addMsg('EMBERWING THE UNDYING takes wing!', 'bad'); }
        showBossBar(e.cfg.bossName);
      }
      break;
    }
    case 'circle': {
      // orbit the lair at altitude, always watching its prey
      d.orbitA += dt * 0.5;
      const ox = d.home.x + Math.cos(d.orbitA) * 11;
      const oz = d.home.z + Math.sin(d.orbitA) * 11;
      flyToward(ox, 6.5 + Math.sin(d.t * 1.3) * 0.8, oz, e.cfg.speed);
      faceTarget();
      d.atkCd -= dt;
      if (d.atkCd <= 0 && target) {
        const roll = Math.random();
        if (phase >= 3 && roll < 0.3) {
          d.state = 'meteor'; d.t = 0;
        } else if (phase >= 2 && roll < 0.55) {
          d.state = 'dive'; d.t = 0;
        } else if (roll < 0.8) {
          d.state = 'volley'; d.t = 0; d.shots = phase >= 3 ? 5 : 3; d.shotT = 0;
        } else {
          // BREATH RUN: telegraph a line of fire through the target
          const dx = target.pos.x - pos.x, dz = target.pos.z - pos.z;
          const dl = Math.hypot(dx, dz) || 1;
          d.breath = { x0: pos.x, z0: pos.z, dx: dx / dl, dz: dz / dl, len: dl + 12, t: -1.0, tick: 0 };
          setEnemyState(e, 'attack');
          if (mine) { sfx.bossroar(); addMsg('🔥 Emberwing draws breath…', 'bad'); }
          netSend({ t: 'fx', f: e.floor, x: target.pos.x, y: 0.5, z: target.pos.z, color: 0xffaa00, big: 1 });
        }
        d.atkCd = phase === 3 ? 3.2 : phase === 2 ? 4.2 : 5.2;
      }
      break;
    }
    case 'volley': {
      faceTarget();
      d.shotT -= dt;
      if (d.shotT <= 0 && d.shots > 0 && target) {
        d.shots--;
        d.shotT = 0.45;
        setEnemyState(e, 'attack');
        const from = pos.clone();
        const to = new THREE.Vector3(target.pos.x + (Math.random() - 0.5) * 2, target.pos.y + 1.2, target.pos.z + (Math.random() - 0.5) * 2);
        const dir = to.sub(from).normalize();
        const bolt = { x: from.x, y: from.y, z: from.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z, speed: 16, dmg: e.dmg, owner: 'enemy', color: 0xff6622, vis: 'fireball', size: 1.3 };
        if (mine) { spawnBolt(bolt); sfx.bolt(); }
        netSend({ t: 'ebolt', f: e.floor, b: bolt });
      }
      if (d.shots <= 0) { d.state = 'circle'; setEnemyState(e, 'chase'); }
      break;
    }
    case 'dive': {
      // crash down beside its prey and maul whoever stands close
      if (target) flyToward(target.pos.x, 0.5, target.pos.z, e.cfg.speed * 1.6);
      faceTarget();
      if (pos.y < 1.2) { d.state = 'maul'; d.t = 0; d.landT = 0; setEnemyState(e, 'idle'); if (mine) sfx.trap(); }
      if (d.t > 4) d.state = 'circle';
      break;
    }
    case 'maul': {
      d.landT += dt;
      faceTarget();
      // wing gust hurls away anyone who crowds it
      let close = 0;
      for (const p of players) if (!p.minion && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 5) close++;
      d.atkCd -= dt;
      if (d.atkCd <= 0) {
        d.atkCd = 1.4;
        if (close >= 1 && d.landT > 2.2 && Math.random() < 0.4) {
          // WING GUST
          setEnemyState(e, 'attack');
          if (mine) { spawnBurst(pos.clone().setY(1.5), 0xffcc88, 40, 10, 0.2, 0.6); sfx.bossroar(); addMsg('💨 Wing gust!', 'bad'); }
          netSend({ t: 'fx', f: e.floor, x: pos.x, y: 1.5, z: pos.z, color: 0xffcc88, big: 1 });
          for (const p of players) {
            const pd = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
            if (pd < 6.5) {
              const kb = { x: (p.pos.x - pos.x) / pd * 16, z: (p.pos.z - pos.z) / pd * 16 };
              if (p.minion) damageMinion(p.minion, Math.round(e.dmg * 0.6));
              else if (p.id === 'me') damageLocalPlayer(Math.round(e.dmg * 0.6), { kb });
              else netSend({ t: 'phit', target: p.id, dmg: Math.round(e.dmg * 0.6), fx: { kb } });
            }
          }
        } else if (target && Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z) < 4.5) {
          setEnemyState(e, 'attack');
          if (target.minion) damageMinion(target.minion, e.dmg);
          else if (target.id === 'me') damageLocalPlayer(e.dmg);
          else netSend({ t: 'phit', target: target.id, dmg: e.dmg });
        } else if (target) {
          // stalk on foot
          const dxm = target.pos.x - pos.x, dzm = target.pos.z - pos.z;
          const dm = Math.hypot(dxm, dzm) || 1;
          moveWithCollision(pos, (dxm / dm) * 5 * dt, (dzm / dm) * 5 * dt, 1.6, { y: pos.y, grid: fs.grid });
        }
      }
      // wounded on the ground → take back to the sky
      if (d.landT > 7 || (e.hp < e.maxHp * 0.15 && d.landT > 3)) {
        d.state = 'ascend';
        setEnemyState(e, 'chase');
      }
      break;
    }
    case 'ascend': {
      flyToward(pos.x, 6.5, pos.z, e.cfg.speed);
      if (pos.y > 5.8) d.state = 'circle';
      break;
    }
    case 'meteor': {
      // rain fire on every hero at once — spread out or burn together
      setEnemyState(e, 'attack');
      if (d.t < 0.1) {
        if (mine) addMsg('☄️ The sky ignites!', 'bad');
        for (const p of players) {
          if (p.minion) continue;
          for (let i = 0; i < 2; i++) {
            const mx = p.pos.x + (Math.random() - 0.5) * 5, mz = p.pos.z + (Math.random() - 0.5) * 5;
            const bolt = { x: mx, y: 13, z: mz, dirX: 0, dirY: -1, dirZ: 0, speed: 10, dmg: Math.round(e.dmg * 0.9), owner: 'enemy', color: 0xff6622, vis: 'fireball', size: 1.6 };
            if (mine) spawnBolt(bolt);
            netSend({ t: 'ebolt', f: e.floor, b: bolt });
          }
        }
      }
      if (d.t > 0.6) { d.state = 'circle'; setEnemyState(e, 'chase'); }
      break;
    }
  }

  // phase 3: calls winged imps to its side
  if (phase >= 3 && d.state !== 'sleep') {
    d.summonT -= dt;
    if (d.summonT <= 0) {
      d.summonT = 14;
      for (let i = 0; i < 2; i++) {
        const a2 = Math.random() * 6.28;
        const sx = pos.x + Math.sin(a2) * 4, sz = pos.z + Math.cos(a2) * 4;
        const id = fs.n * 1000 + 500 + fs.nextSummonId++;
        const imp = spawnEnemy(fs, 'imp', sx, sz, { y: 3, id });
        setEnemyState(imp, 'awaken');
        fs.summons.push({ id, type: 'imp', x: sx, z: sz, y: 3 });
        netSend({ t: 'espawn', f: fs.n, id, type: 'imp', x: sx, z: sz, y: 3 });
      }
      if (mine) addMsg('Emberwing shrieks — imps answer!', 'bad');
    }
  }

  if (mine && d.state !== 'sleep') updateBossBar(e.hp / e.maxHp);
  let dyw = e.yaw - e.obj.rotation.y;
  while (dyw > Math.PI) dyw -= Math.PI * 2;
  while (dyw < -Math.PI) dyw += Math.PI * 2;
  e.obj.rotation.y += dyw * Math.min(1, dt * 5);
}

export function setEnemyState(e, s, fromNet = false) {
  if (e.state === 'dead') return;
  if (e.state === s) return;
  e.state = s;
  e.stateT = 0;
  const a = e.anim;
  const m = amap(e);
  switch (s) {
    case 'awaken':
      if (m) a.play(m.idle);
      else a.play(a.has('Skeletons_Awaken_Standing') ? 'Skeletons_Awaken_Standing' : 'Idle', { once: true, clamp: true });
      break;
    case 'chase':
      if (m) a.play(e.cfg.speed > 5 || e.cfg.fly ? m.run : m.walk);
      else a.play(e.cfg.speed > 5 ? 'Running_A' : (a.has('Walking_D_Skeletons') ? 'Walking_D_Skeletons' : 'Walking_A'));
      break;
    case 'attack': {
      const clip = m ? m.attack[Math.floor(Math.random() * m.attack.length)]
        : e.cfg.ranged ? 'Spellcast_Shoot' : ATTACK_ANIMS[Math.floor(Math.random() * ATTACK_ANIMS.length)];
      const act = a.play(clip, { once: true, clamp: true });
      if (act) act.timeScale = act.getClip().duration / e.cfg.attackTime;
      break;
    }
    case 'hit':
      a.play(m ? m.hit : 'Hit_A', { once: true, clamp: true });
      break;
    case 'idle':
      a.play(m ? m.idle : (a.has('Idle_B') ? 'Idle_B' : 'Idle'));
      break;
    case 'dead': {
      a.play(m ? m.death : (Math.random() < 0.5 ? 'Death_A' : 'Death_B'), { once: true, clamp: true });
      break;
    }
  }
  if (isAuthority() && !fromNet) netSend({ t: 'estate', f: e.floor, id: e.id, s });
}

// source: 'local' if my hit, else remote player id; effects: {slow, stun, poison, kb}
export function damageEnemy(e, amount, crit = false, fromNet = false, source = 'local', effects = null) {
  if (!e || e.state === 'dead') return;
  const mine = source === 'local';
  const visible = onMyFloor(e);
  if (G.net.role === 'guest' && !fromNet) {
    netSend({ t: 'dmg', f: e.floor, id: e.id, amount, crit, fx: effects });
    if (visible) spawnDamageNumber(e.obj.position.clone().setY(e.obj.position.y + 2 * e.scale), crit ? `${amount}!` : `${amount}`, crit ? '#ff5533' : '#ffd35c', crit);
    notifyHit(crit);
    return;
  }
  if (e.vulnT > 0) amount = Math.round(amount * 1.5); // death-marked
  e.hp -= amount;
  if (visible) {
    spawnDamageNumber(e.obj.position.clone().setY(e.obj.position.y + 2 * e.scale), crit ? `${amount}!` : `${amount}`, crit ? '#ff5533' : e.vulnT > 0 ? '#ff88ff' : '#ffd35c', crit);
    spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.2), 0xcccccc, 6, 3, 0.09, 0.35);
  }
  if (mine) { sfx[crit ? 'crit' : 'hit'](); notifyHit(crit); }

  if (e.cfg.dragon) {
    e.threat = e.threat || {};
    const key = source === 'local' ? 'me' : source;
    e.threat[key] = (e.threat[key] || 0) + amount;
  }
  if (effects) {
    if (effects.slow) { e.slowT = effects.slow.dur; e.slowMult = effects.slow.mult; }
    if (effects.stun && !e.boss && !e.stalwart) e.stunT = Math.max(e.stunT, effects.stun);
    if (effects.poison) { e.poisonT = effects.poison.dur; e.poisonDps = effects.poison.dps; e.poisonBy = source; }
    if (effects.kb && !e.boss && !e.stalwart) { e.kbX += effects.kb.x; e.kbZ += effects.kb.z; }
    if (effects.vuln) e.vulnT = Math.max(e.vulnT, effects.vuln);
    if (effects.lifesteal && mine && G.player && !G.player.dead) {
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + Math.max(1, Math.round(amount * effects.lifesteal)));
    }
  }

  if (G.net.role === 'host') netSend({ t: 'ehp', f: e.floor, id: e.id, hp: e.hp });

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
  const visible = onMyFloor(e);
  if (visible) {
    sfx.bones();
    spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0xe8e0cc, 18, 5, 0.13, 0.7);
  }
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'edie', f: e.floor, id: e.id, by: source === 'local' ? 'host' : source });

  // slimes split apart when killed
  if (e.cfg.splitInto && isAuthority() && !fromNet && source !== 'none') {
    const fs2 = floorState(e.floor);
    for (let i = 0; i < 2; i++) {
      const a2 = Math.random() * Math.PI * 2;
      const sx = e.obj.position.x + Math.sin(a2) * 1.2, sz = e.obj.position.z + Math.cos(a2) * 1.2;
      const id = fs2.n * 1000 + 500 + fs2.nextSummonId++;
      const mchild = spawnEnemy(fs2, e.cfg.splitInto, sx, sz, { y: e.obj.position.y, id });
      setEnemyState(mchild, 'awaken');
      fs2.summons.push({ id, type: e.cfg.splitInto, x: sx, z: sz, y: e.obj.position.y });
      netSend({ t: 'espawn', f: fs2.n, id, type: e.cfg.splitInto, x: sx, z: sz, y: e.obj.position.y });
    }
    if (onMyFloor(e)) addMsg('The slime splits apart!', 'bad');
  }
  // plaguebearers burst into a poison cloud
  if (e.cfg.deathCloud && isAuthority()) {
    if (visible) spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1), 0x66cc44, 24, 5, 0.16, 0.8);
    netSend({ t: 'fx', f: e.floor, x: e.obj.position.x, y: e.obj.position.y + 1, z: e.obj.position.z, color: 0x66cc44, big: 1 });
    const pfx = { poison: { dps: 4 + Math.floor(e.floor / 2), dur: 3 } };
    if (G.player && !G.player.dead && G.floor === e.floor) {
      const d = Math.hypot(G.player.obj.position.x - e.obj.position.x, G.player.obj.position.z - e.obj.position.z);
      if (d < e.cfg.deathCloud) damageLocalPlayer(3, pfx);
    }
    for (const [pid, r] of G.remotes) {
      if (r.floor !== e.floor || r.dead) continue;
      const d = Math.hypot(r.obj.position.x - e.obj.position.x, r.obj.position.z - e.obj.position.z);
      if (d < e.cfg.deathCloud) netSend({ t: 'phit', target: pid, dmg: 3, fx: pfx });
    }
  }

  const mine = source === 'local';
  if (mine) {
    const gold = Math.round((e.cfg.gold[0] + Math.floor(Math.random() * (e.cfg.gold[1] - e.cfg.gold[0]))) * e.goldMult);
    G.run.gold += gold;
    G.run.kills++;
    gainXp(Math.round(e.cfg.xp * e.xpMult));
    addMsg(`${e.boss ? '💀 Boss defeated!' : e.elite ? '⭐ Elite destroyed!' : 'Skeleton destroyed'} +${gold}g`, e.boss || e.elite ? 'gold' : '');
  }
  // item drops (authority rolls & shares the actual item)
  if (isAuthority() && !fromNet && source !== 'none') {
    const chance = e.boss ? 1 : e.elite ? 0.45 : 0.09;
    if (Math.random() < chance) {
      const forClass = pickDropClass(source);
      const item = rollAnyItem(forClass, e.floor, e.boss ? 0.8 : e.elite ? 0.3 : 0);
      dropItemLoot(floorState(e.floor), item, e.obj.position.x, e.obj.position.z, e.obj.position.y);
    }
  }
  if (e.boss) {
    const fs = floorState(e.floor);
    if (fs.grid) fs.grid.stairsLocked = false;
    if (visible) {
      hideBossBar();
      sfx.death();
      addMsg('The way down is open!', 'gold');
    }
    if (isAuthority() && e.floor === 9 && !G.endless && !fromNet) G.pendingVictory = true;
  }
}

function pickDropClass(source) {
  if (source === 'local' || source === 'host') return G.player.classId;
  const p = G.net.players.get(source);
  if (p?.classId) return p.classId;
  return G.player.classId;
}

export function enemyById(f, id) {
  const fs = G.floors.get(f);
  return fs ? fs.enemies.find(e => e.id === id) : null;
}

// on arriving at a floor: show boss bar if a boss fight is already underway
export function refreshBossBarForFloor() {
  const boss = G.enemies.find(e => e.boss && e.state !== 'dead' && e.state !== 'inactive');
  if (boss) {
    showBossBar(boss.cfg.bossName || 'ANCIENT HORROR');
    updateBossBar(boss.hp / boss.maxHp);
  } else {
    hideBossBar();
  }
}

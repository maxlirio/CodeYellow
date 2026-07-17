// Skeleton horde, now per-floor: the authority simulates every floor that has a
// player on it; each client renders/animates only its own floor. Enemy ids are
// floor-namespaced and deterministic (floor*1000+index; summons get 500+).
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { ENEMIES, scaleHp, scaleDmg, ANIM_GROUND, ANIM_CRITTER, ANIM_FLYER, ANIM_ROBOT, ANIM_MECH, ANIM_TROOP, ANIM_VOID, ANIM_HUSK, ANIM_CYBER, ANIM_CYBERFLY, ANIM_CYBERHERO } from './config.js';
import { makeCharacter, tintCharacter, makeWeaponModel } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst, makeGlowSprite } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, hasLineOfSight, groundHeightAt, bodyBlocked, resolveStuck, safeSpawn } from './dungeon.js';
import { spawnFireJet, endFireJet, spawnGroundFire, spawnFireImpact } from './firefx.js';
import { spawnBolt } from './projectiles.js';
import { netSend, isAuthority } from './net.js';
import { addMsg, showBossBar, updateBossBar, hideBossBar, showBossCard } from './ui.js';
import { damageLocalPlayer, gainXp, notifyHit } from './player.js';
import { rollAnyItem } from './items.js';
import { dropItemLoot } from './loot.js';
import { minionTargetsOnFloor, damageMinion } from './minions.js';
import { wallAt, damageWall } from './walls.js';
import { buildDragonModel, animateDragon, dragonMuzzle } from './dragon.js';
import { nearestBuildPiece, weakestBuildPieceNear, damageBuild } from './builds.js';
import { horde } from './horde.js';

export function spawnEnemiesForFloor(fs) {
  if (fs.spawned) return;
  fs.enemyGroup = new THREE.Group();
  fs.enemyGroup.visible = false;
  G.scene.add(fs.enemyGroup);
  fs.enemySpawns.forEach((s, i) => {
    spawnEnemy(fs, s.type, s.x, s.z, { y: s.y || 0, elite: s.elite, id: fs.n * 1000 + i });
  });
}

const DUMMY_ANIM = { update() {}, play() { return null; }, has() { return false; }, current: null };

export function spawnEnemy(fs, type, x, z, { y = 0, elite = false, id = null } = {}) {
  const cfg = ENEMIES[type];
  const { obj, anim } = cfg.procDragon
    ? { obj: buildDragonModel(), anim: DUMMY_ANIM }
    : makeCharacter('enemy', cfg.model, cfg.show || []); // rigs with baked arsenals show ONE weapon
  obj.position.set(x, y, z);
  const scale = cfg.scale * (elite ? 1.28 : 1);
  obj.scale.setScalar(scale);
  // models whose pose dips below their origin get lifted clear of the floor
  if (cfg.meshY) for (const c of [...obj.children]) c.position.y += cfg.meshY / scale; // meshY is world units
  if (cfg.tint) tintCharacter(obj, cfg.tint);
  if (cfg.paint) tintCharacter(obj, cfg.paint, { only: /^Main$/ }); // robot body panels only
  if (cfg.ghost) tintCharacter(obj, 0xcfe8ff, { ghost: true });
  if (elite) tintCharacter(obj, 0xffcc66, { emissive: 0x662200 });
  if (cfg.dragon) {
    // ember sheen + carried firelight so she reads in a dark lair; the
    // model's baked flame-burst helper mesh stays hidden
    obj.traverse((n) => {
      if (!n.isMesh && !n.isSkinnedMesh) return;
      if (n.material?.name === 'BURST' || n.material?.name === 'burst_new') { n.visible = false; return; }
      if (n.material.isMeshBasicMaterial) return;
      n.material = n.material.clone();
      if (n.material.emissive) { n.material.emissive.setHex(0x1c0402); n.material.emissiveIntensity = 0.18; }
    });
    const glow = new THREE.PointLight(0xff7733, 2.6, 40);
    glow.position.set(0, 4, 0);
    obj.add(glow);
  }
  // snipers visibly carry their crossbow. NOTE the bone is 'handslotr', not
  // 'handslot.r' — GLTFLoader strips dots from node names, so the dotted
  // spelling never matched and every sniper fired from empty hands.
  if (cfg.heldModel) {
    const hand = obj.getObjectByName('handslotr') || obj.getObjectByName('handslot.r');
    if (hand) {
      const held = makeWeaponModel(cfg.heldModel);
      held.rotation.x = Math.PI / 2; // grip along the forearm, as on the player
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
    vulnT: 0, kbX: 0, kbZ: 0, vy: 0, charmT: 0,
  };
  obj.rotation.y = e.yaw;
  const m0 = amap(e);
  if (cfg.singleClip || cfg.procDragon) anim.play(cfg.singleClip);
  else if (m0) anim.play(m0.idle);
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

// ---------------- strategy ----------------
// Monsters don't just run at you in a straight line. Everywhere: melee lead
// their pursuit (they aim where you're GOING), skirmishers hook around your
// flanks, archers hold their range band. In Last Stand, waves also march in
// squads with roles — vanguard line, archers volleying from the back rank,
// flankers taking the long way round, and siegers tearing at your weakest
// structure. And backpedal-kiting stops working: a chaser you keep stringing
// along gets frustrated, surges, or turns on your buildings instead.
const FAST_FLANKERS = new Set(['rogue', 'goblin', 'shade', 'berserker', 'slimelet']);

function trackTargetMotion(fs, players, dt) {
  if (!fs._tprev) { fs._tprev = new Map(); fs._tvel = new Map(); }
  for (const p of players) {
    const prev = fs._tprev.get(p.id);
    if (prev && dt > 0) {
      const cur = fs._tvel.get(p.id) || { vx: 0, vz: 0 };
      cur.vx += ((p.pos.x - prev.x) / dt - cur.vx) * Math.min(1, dt * 4);
      cur.vz += ((p.pos.z - prev.z) / dt - cur.vz) * Math.min(1, dt * 4);
      fs._tvel.set(p.id, cur);
    }
    fs._tprev.set(p.id, { x: p.pos.x, z: p.pos.z });
  }
  // squad centroids for the horde formations
  if (horde.active && fs.n === 1) {
    fs._squadC = new Map();
    for (const e of fs.enemies) {
      if (!e.tac || e.state === 'dead' || e.state === 'inactive') continue;
      const c = fs._squadC.get(e.tac.gate) || { x: 0, z: 0, n: 0 };
      c.x += e.obj.position.x; c.z += e.obj.position.z; c.n++;
      fs._squadC.set(e.tac.gate, c);
    }
    for (const c of fs._squadC.values()) { c.x /= c.n; c.z /= c.n; }
  }
}

// nearest climbable route (dungeon ramp cells or player-built ramps),
// scored by detour length: enemy->ramp + ramp->target
function nearestWayUp(fs, pos, tpos) {
  const g = fs.grid;
  let best = null, bs = Infinity;
  const consider = (x, z) => {
    const s = Math.hypot(x - pos.x, z - pos.z) + Math.hypot(x - tpos.x, z - tpos.z) * 0.7;
    if (s < bs) { bs = s; best = { x, z }; }
  };
  if (g.ramps) for (const idx of g.ramps.keys()) consider((idx % g.w) * 4, Math.floor(idx / g.w) * 4);
  if (g.builds?.ramps) for (const idx of g.builds.ramps.keys()) consider((idx % g.w) * 4, Math.floor(idx / g.w) * 4);
  return best;
}

function tacticalGoal(e, fs, t, dt) {
  const pos = e.obj.position;
  const d = Math.max(0.001, t.dist);
  const goal = { x: t.pos.x, z: t.pos.z, surge: false, hold: false };
  if (e.boss || e.cfg.dragon) return goal;
  const v = fs._tvel?.get(t.id) || { vx: 0, vz: 0 };
  const tSpeed = Math.hypot(v.vx, v.vz);

  // frustration: a target that keeps pulling away earns a response
  if (!t.minion) {
    const closing = (e.lastTD ?? d) - d;
    e.lastTD = d;
    if (closing < -0.4 * dt && d > 4) e.frust = (e.frust || 0) + dt;
    else e.frust = Math.max(0, (e.frust || 0) - dt * 0.7);
    if (e.frust > 5 && !e.cfg.ranged) {
      // take it out on their fortifications if any are near, else surge
      const weak = weakestBuildPieceNear(e.floor, pos.x, pos.z, 26);
      if (weak) { e.siegeTarget = weak; e.frust = 0; }
      else goal.surge = true;
    }
  }

  // the target is up somewhere (keep, platform, player tower): ground troops
  // can't fly — head for the nearest ramp or staircase that leads up
  if (!e.cfg.fly && !e.ghost && t.pos.y - pos.y > 2.2) {
    e.rampT = (e.rampT || 0) - dt;
    if (e.rampT <= 0 || !e.rampGoal) {
      e.rampT = 1.2;
      e.rampGoal = nearestWayUp(fs, pos, t.pos);
    }
    if (e.rampGoal && Math.hypot(e.rampGoal.x - pos.x, e.rampGoal.z - pos.z) > 1.4) {
      goal.x = e.rampGoal.x; goal.z = e.rampGoal.z;
      return goal;
    }
  } else e.rampGoal = null;

  // lead pursuit: melee aim at where the target will be, not where it is
  if (!e.cfg.ranged && tSpeed > 2 && d > 3) {
    const lead = Math.min(1.1, d / Math.max(4, e.cfg.speed));
    goal.x += v.vx * lead; goal.z += v.vz * lead;
  }

  // archers keep to their band: retreat when crowded, never charge to melee
  if (e.cfg.ranged) {
    if (d < e.cfg.range * 0.45) {
      goal.x = pos.x - (t.pos.x - pos.x) / d * 5;
      goal.z = pos.z - (t.pos.z - pos.z) / d * 5;
      return goal;
    }
  }

  // fast skirmishers hook around the side instead of joining the conga line
  if (!e.cfg.ranged && !e.ghost && FAST_FLANKERS.has(e.type) && d > 6) {
    const side = e.id % 2 === 0 ? 1 : -1;
    const px = -(t.pos.z - pos.z) / d, pz = (t.pos.x - pos.x) / d;
    const hook = Math.min(e.tac ? 9 : 6, d - 4);
    goal.x += px * side * hook; goal.z += pz * side * hook;
  }

  // ---- Last Stand squad roles ----
  if (e.tac && horde.active && fs.n === 1) {
    const c = fs._squadC?.get(e.tac.gate);
    if (e.tac.role === 'sieger' && (!e.siegeTarget || e.siegeTarget.dead)) {
      e.siegeTarget = weakestBuildPieceNear(e.floor, pos.x, pos.z, 60);
    }
    if (e.siegeTarget && !e.siegeTarget.dead) {
      goal.x = e.siegeTarget.x; goal.z = e.siegeTarget.z;
      return goal;
    }
    if (e.tac.role === 'vanguard' && c && c.n >= 3 && d > 12) {
      // march as a line abreast: advance with the squad, hold your rank slot
      const adx = t.pos.x - c.x, adz = t.pos.z - c.z;
      const ad = Math.max(0.001, Math.hypot(adx, adz));
      const px = -adz / ad, pz = adx / ad;
      const slot = ((e.tac.rank % 5) - 2) * 1.8;
      goal.x = c.x + (adx / ad) * 5 + px * slot;
      goal.z = c.z + (adz / ad) * 5 + pz * slot;
    } else if (e.tac.role === 'archer' && c && d > e.cfg.range * 0.55) {
      // volley from behind the vanguard, not from the front row
      const bx = c.x - (t.pos.x - c.x) / Math.max(0.001, Math.hypot(t.pos.x - c.x, t.pos.z - c.z)) * 4;
      const bz = c.z - (t.pos.z - c.z) / Math.max(0.001, Math.hypot(t.pos.x - c.x, t.pos.z - c.z)) * 4;
      goal.x = (goal.x + bx * 2) / 3; goal.z = (goal.z + bz * 2) / 3;
    }
  }
  return goal;
}

const ATTACK_ANIMS = ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'];

// ---- dragonfire that STAYS: burning ground left by her breath ----
// The patch itself is drawn by firefx (a scorch mark licking real flame); this
// only owns the damage. It used to BE the effect — two glow billboards popped in
// wherever the breath happened to hurt you, which is why the fire looked like
// orbs appearing out of nowhere rather than anything she'd breathed.
const dragonFlames = []; // {x, z, f, t, tick}
function igniteGround(f, x, z) {
  const y = groundHeightAt(x, z, 0);
  if (f === G.floor) spawnGroundFire(f, x, z, y, 2.8);
  dragonFlames.push({ x, z, f, t: 2.8, tick: Math.random() * 0.4 });
}
function updateDragonFlames(dt) {
  for (let i = dragonFlames.length - 1; i >= 0; i--) {
    const fl = dragonFlames[i];
    fl.t -= dt;
    fl.tick -= dt;
    if (fl.tick <= 0 && isAuthority()) {
      fl.tick = 0.5;
      const pl = G.player;
      if (pl && !pl.dead && G.floor === fl.f && Math.hypot(pl.obj.position.x - fl.x, pl.obj.position.z - fl.z) < 1.7 && pl.obj.position.y < 2) {
        damageLocalPlayer(6, { poison: { dps: 3, dur: 1.5 } });
      }
      for (const [pid, r] of G.remotes) {
        if (r.dead || r.floor !== fl.f) continue;
        if (Math.hypot(r.obj.position.x - fl.x, r.obj.position.z - fl.z) < 1.7) netSend({ t: 'phit', target: pid, dmg: 6, fx: { poison: { dps: 3, dur: 1.5 } } });
      }
    }
    if (fl.t <= 0) dragonFlames.splice(i, 1);
  }
}
const _muzzle = new THREE.Vector3();
const _muzDir = new THREE.Vector3();

const ANIM_MAPS = { ground: ANIM_GROUND, critter: ANIM_CRITTER, flyer: ANIM_FLYER, robot: ANIM_ROBOT, mech: ANIM_MECH, troop: ANIM_TROOP, void: ANIM_VOID, husk: ANIM_HUSK, cyber: ANIM_CYBER, cyberfly: ANIM_CYBERFLY, cyberhero: ANIM_CYBERHERO };
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
  updateDragonFlames(dt);
  const authority = isAuthority();
  for (const fs of G.floors.values()) {
    if (!fs.spawned) continue;
    const mine = fs.n === G.floor;
    const players = authority ? playersOnFloor(fs.n) : null;
    if (authority && !mine && !players.length) continue; // pause floors nobody is on
    if (!authority && !mine) continue;

    if (authority) trackTargetMotion(fs, players, dt);

    for (const e of fs.enemies) {
      if (mine) e.anim.update(dt);
      if (e.cfg.procDragon && mine && e.state !== 'dead') animateDragon(e, dt);
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
      if (!e.cfg.fly && !e.cfg.dragon) unstickEntity(e, fs, dt);
    }
  }
}

// The player self-heals out of geometry every 0.5s; nothing else did. That was
// survivable when an embedded body simply couldn't move — it just ground against
// the wall — but movement now de-penetrates, so anything that ends up inside the
// level (a summon spawned into a wall, a slime split against one, a bad landing)
// needs a way OUT or it will keep clawing at the rock forever.
function unstickEntity(e, fs, dt) {
  e.stuckT = (e.stuckT || 0) + dt;
  if (e.stuckT < 0.5) return;
  e.stuckT = 0;
  const p = e.obj.position;
  if (!bodyBlocked(p.x, p.z, p.y, fs.grid)) return;
  const free = resolveStuck(p.x, p.z, p.y, fs.grid);
  if (free) { p.x = free.x; p.z = free.z; }
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

  // ---- dominated: it fights for the necromancer against its own kind ----
  if (e.charmT > 0) {
    e.charmT -= dt;
    e.charmAtkT = (e.charmAtkT || 0) - dt;
    let victim = null, vd = 16;
    for (const o of fs.enemies) {
      if (o === e || o.state === 'dead' || o.state === 'inactive') continue;
      if (o.charmT > 0) continue; // thralls don't duel thralls
      const d = Math.hypot(o.obj.position.x - e.obj.position.x, o.obj.position.z - e.obj.position.z);
      if (d < vd) { vd = d; victim = o; }
    }
    if (victim) {
      e.yaw = Math.atan2(victim.obj.position.x - e.obj.position.x, victim.obj.position.z - e.obj.position.z);
      const inReach = vd < 2.8 && Math.abs(victim.obj.position.y - e.obj.position.y) < 2;
      if (inReach) {
        if (e.charmAtkT <= 0) {
          e.charmAtkT = e.cfg.attackTime;
          if (e.state === 'attack') e.state = 'chase'; // force the swing anim to replay
          setEnemyState(e, 'attack');
          e.attackFired = true; // the blow lands on its own kind, not a player
          damageEnemy(victim, e.dmg, false, false, 'none');
          if (mine) spawnBurst(victim.obj.position.clone().setY(victim.obj.position.y + 1.2), 0x55ff77, 6, 3, 0.09, 0.3);
        }
      } else {
        const dx = victim.obj.position.x - e.obj.position.x, dz = victim.obj.position.z - e.obj.position.z;
        const d = Math.max(0.001, Math.hypot(dx, dz));
        const spd = e.cfg.speed * e.slowMult * e.speedMult;
        moveWithCollision(e.obj.position, (dx / d) * spd * dt, (dz / d) * spd * dt, 0.5 * e.scale, { y: e.obj.position.y, ghost: e.ghost, grid });
        if (e.state !== 'chase' && e.stateT > e.cfg.attackTime) setEnemyState(e, 'chase');
      }
    } else if ((e.state === 'chase' || e.state === 'attack') && e.stateT > e.cfg.attackTime) {
      setEnemyState(e, 'idle'); // no one left to turn on — stand guard
    }
  } else switch (e.state) {
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
      // a wall-crawler dangling overhead: melee can't reach — so POUND the
      // surface and try to hammer them off it
      if (!e.cfg.ranged && !e.cfg.fly && dy3 >= 2.5 && t.dist < 4.5 && t.pos.y > e.obj.position.y) {
        e.slamCd = (e.slamCd ?? 0) - dt;
        if (e.slamCd <= 0) {
          e.slamCd = 2.6;
          setEnemyState(e, 'attack');
          e.attackFired = true; // the blow lands on stone, not flesh
          if (onMyFloor(e)) { sfx.trap(); spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.5), 0xccaa88, 10, 5, 0.13, 0.4); }
          const fx = { shake: 0.45, lashbreak: Math.random() < 0.35 };
          if (t.minion) damageMinion(t.minion, 2);
          else if (t.id === 'me') damageLocalPlayer(3, fx);
          else netSend({ t: 'phit', target: t.id, dmg: 3, fx });
        }
        break;
      }
      if (inRange && canSee && !e.siegeTarget) {
        setEnemyState(e, 'attack');
        e.attackFired = false;
        break;
      }
      // siegers (and frustrated chasers) tear down structures instead
      if (e.siegeTarget && !e.siegeTarget.dead) {
        const pd = Math.hypot(e.siegeTarget.x - e.obj.position.x, e.siegeTarget.z - e.obj.position.z);
        if (pd < Math.max(2.3, e.cfg.range + 0.9)) {
          setEnemyState(e, 'attack');
          e.attackFired = true; // the swing lands on timber, not flesh
          damageBuild(e.siegeTarget, Math.max(10, Math.round(e.dmg * 1.5)));
          if (onMyFloor(e)) spawnBurst(new THREE.Vector3(e.siegeTarget.x, e.obj.position.y + 1.2, e.siegeTarget.z), 0xcc9955, 8, 4, 0.12, 0.4);
          break;
        }
      } else e.siegeTarget = null;

      const goal = tacticalGoal(e, fs, t, dt);
      const dx = goal.x - e.obj.position.x, dz = goal.z - e.obj.position.z;
      const d = Math.max(0.001, Math.hypot(dx, dz));
      e.yaw = t.dist < 6 ? Math.atan2(t.pos.x - e.obj.position.x, t.pos.z - e.obj.position.z) : Math.atan2(dx, dz);
      // berserkers get faster as they take damage; frustrated chasers surge
      const enrage = e.cfg.enrage ? 1 + (1 - e.hp / e.maxHp) * 0.9 : 1;
      const surge = goal.surge ? 1.25 : 1;
      const speed = e.cfg.speed * e.slowMult * e.speedMult * enrage * surge;
      let mx = (dx / d) * speed * dt, mz = (dz / d) * speed * dt;
      if (goal.hold) { mx = 0; mz = 0; }
      for (const o of fs.enemies) {
        if (o === e || o.state === 'dead') continue;
        const ox = e.obj.position.x - o.obj.position.x, oz = e.obj.position.z - o.obj.position.z;
        const od = Math.hypot(ox, oz);
        if (od < 1.4 && od > 0.01) { mx += (ox / od) * dt * 2.5; mz += (oz / od) * dt * 2.5; }
      }
      const beforeX = e.obj.position.x, beforeZ = e.obj.position.z;
      moveWithCollision(e.obj.position, mx, mz, 0.5 * e.scale, { y: e.obj.position.y, ghost: e.ghost, grid });
      // blocked? smash whatever stands in the way — barricades, posts, walls, machines
      if (!e.ghost && !goal.hold) {
        const moved = Math.hypot(e.obj.position.x - beforeX, e.obj.position.z - beforeZ);
        if (moved < speed * dt * 0.25) {
          e.blockT = (e.blockT || 0) + dt;
          if (e.blockT > 0.7) {
            const cx = Math.round((e.obj.position.x + (dx / d) * 3) / 4);
            const cy = Math.round((e.obj.position.z + (dz / d) * 3) / 4);
            const w = wallAt(e.floor, cx, cy) ||
              wallAt(e.floor, Math.round(e.obj.position.x / 4) + Math.sign(Math.round(dx)), Math.round(e.obj.position.z / 4)) ||
              wallAt(e.floor, Math.round(e.obj.position.x / 4), Math.round(e.obj.position.z / 4) + Math.sign(Math.round(dz)));
            const bp = w ? null : nearestBuildPiece(e.floor,
              e.obj.position.x + (dx / d) * 1.6, e.obj.position.z + (dz / d) * 1.6, 2.4, e.obj.position.y);
            if (w || bp) {
              e.blockT = 0;
              setEnemyState(e, 'attack');
              e.attackFired = true; // the swing hits the obstacle, not a player
              if (w) damageWall(w, Math.max(8, Math.round(e.dmg * 1.2)));
              else damageBuild(bp, Math.max(10, Math.round(e.dmg * 1.5)));
              if (bp && onMyFloor(e)) spawnBurst(new THREE.Vector3(bp.x, e.obj.position.y + 1.2, bp.z), 0xcc9955, 8, 4, 0.12, 0.4);
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
          // squat rigs (the spider-walker) carry guns LOW — 1.6*scale put the
          // muzzle a body-height above the model
          const from = e.obj.position.clone().setY(e.obj.position.y + (e.cfg.muzzleY ?? 1.6 * e.scale));
          const to = new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z);
          const dir = to.sub(from).normalize();
          const bolt = {
            x: from.x + dir.x * 0.8, y: from.y, z: from.z + dir.z * 0.8,
            dirX: dir.x, dirY: dir.y, dirZ: dir.z,
            // lasers are FAST — a 13 u/s energy bolt reads as a lobbed ball
            speed: e.cfg.boltSpeed || (e.cfg.boltVis === 'laser' ? 30 : 16),
            dmg: e.dmg, owner: 'enemy',
            color: e.cfg.boltColor || (e.cfg.slowBolt ? 0x66ccff : 0x9944ff),
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
    } else if (ground > e.obj.position.y) { // <=1.6 was narrower than the 1.7 groundHeightAt offers — they waded inside ramps
      e.obj.position.y = ground;
      e.vy = 0;
    } else if (e.state === 'chase' && t && !t.minion) {
      // JUMP: high ground is not safety — a chaser under your ledge leaps up.
      // (Same physics as falling: the curY gate in groundHeightAt catches the
      // platform top at the apex and the frame lands.)
      e.jumpT = (e.jumpT || 0) - dt;
      if (e.jumpT <= 0 && t.pos.y - e.obj.position.y > 2 && t.dist < 7 && dy3 > 2) {
        e.vy = 15; // clears PLATFORM_H with a little to spare
        e.obj.position.y += 0.05;
        e.jumpT = 1.4 + Math.random() * 0.8;
      }
    }
  }

  // summoners (necromancers and summoning bosses) — silenced while charmed or shrunken
  if (e.cfg.summons && e.state !== 'inactive' && e.state !== 'dead' && e.charmT <= 0) {
    e.summonT -= dt;
    if (e.summonT <= 0) {
      e.summonT = e.cfg.summonEvery || 9;
      for (let i = 0; i < (e.cfg.summonCount || 1); i++) {
        const a = Math.random() * Math.PI * 2;
        // a summoner backed against a wall would put its minions INSIDE it
        const sp = safeSpawn(e.obj.position.x + Math.sin(a) * 3, e.obj.position.z + Math.cos(a) * 3,
                             e.obj.position.y, fs.grid);
        if (!sp) continue;
        const x = sp.x, z = sp.z;
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
// A D&D dragon, not a hover-bot. She fights ON THE GROUND — prowling with
// real weight (turn-limited, so you can flank her), swiping with claws,
// lunging to bite, sweeping her tail at anyone behind her, buffeting the
// crowd with her wings, and raking the floor with a sweeping breath cone.
// She takes wing only with purpose — at health thresholds or when melee
// punishes her too hard — strafes with fire, then CRASHES back down.
// She reads your position and answers it; nothing runs on a fixed script.
function simulateDragon(e, fs, players, dt, mine) {
  if (!e.ds) {
    e.ds = {
      state: 'sleep', t: 0, atkCd: 2, breathCd: 6, gustCd: 4,
      home: { x: e.obj.position.x, z: e.obj.position.z },
      orbitA: Math.random() * 6.28, flew: { 0.75: false, 0.45: false, 0.2: false },
      pain: 0, summonT: 14, breath: null, sweep: null, lungeV: null,
    };
    // she sleeps where she was placed — coiled on her hoard, not the floor
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
      if (mine) spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 3), 0x66ff44, 4, 2, 0.08, 0.3);
      if (e.state === 'dead') return;
    }
  }
  d.pain = Math.max(0, d.pain - dt * (e.maxHp * 0.02)); // melee pressure decays
  const frac = e.hp / e.maxHp;
  const enraged = frac < 0.25;
  const pos = e.obj.position;

  // hunt whoever it hates most (threat decays so it re-evaluates)
  if (e.threat) for (const k of Object.keys(e.threat)) e.threat[k] *= Math.pow(0.85, dt);
  let target = null, best = -1;
  for (const p of players) {
    if (p.minion) continue;
    const th = (e.threat?.[p.id] || 0) + 1 / (1 + Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z));
    if (th > best) { best = th; target = p; }
  }
  if (!target && players.length) target = players[0];
  const td = target ? Math.hypot(target.pos.x - pos.x, target.pos.z - pos.z) : 999;

  // heavy body: she turns with weight — flanking is real counterplay
  const turnTo = (tx, tz, rate) => {
    const want = Math.atan2(tx - pos.x, tz - pos.z);
    let dy = want - e.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const step = Math.min(Math.abs(dy), rate * dt);
    e.yaw += Math.sign(dy) * step;
    return Math.abs(dy);
  };
  const angleTo = (px, pz) => {
    let a = Math.atan2(px - pos.x, pz - pos.z) - e.yaw;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  // Her BULK has to clear the wall, not just her origin. The old test sampled a
  // single point — her centre — so she could stand 0.1 from a wall face with
  // half of herself (head, wings, tail: the parts you actually aim at) buried in
  // stone. DRAGON_R is her torso; bodyR (4.5) also spans wings and tail, which
  // may overlap scenery without looking wrong.
  const DRAGON_R = 2.2;
  const LAIR_WALL_TOP = 12; // lair walls stack 3 high — above this she's clear
  const solidCell = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= fs.grid.w || cy >= fs.grid.h) return true;
    return fs.grid.cells[cy * fs.grid.w + cx] === 0;
  };
  // Does her torso circle overlap any solid cell? This must test the cell's
  // BOUNDS, not sample points at rounded cell centres: DRAGON_R (2.2) is wider
  // than a cell's half-width (2.0), so a centre-sampling test read "blocked" for
  // every cell merely ADJACENT to a wall — i.e. the whole lair perimeter — and
  // she'd fall through to the already-embedded escape hatch and phase clean
  // through the rock.
  const bulkClear = (x, z) => {
    const c0 = Math.floor((x - DRAGON_R) / 4 + 0.5), c1 = Math.floor((x + DRAGON_R) / 4 + 0.5);
    const r0 = Math.floor((z - DRAGON_R) / 4 + 0.5), r1 = Math.floor((z + DRAGON_R) / 4 + 0.5);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (!solidCell(cx, cy)) continue;
        // closest point on this cell's box to her centre
        const bx = Math.max(cx * 4 - 2, Math.min(x, cx * 4 + 2));
        const bz = Math.max(cy * 4 - 2, Math.min(z, cy * 4 + 2));
        const ddx = x - bx, ddz = z - bz;
        if (ddx * ddx + ddz * ddz < DRAGON_R * DRAGON_R) return false;
      }
    }
    return true;
  };
  // slide along the wall instead of stopping dead; if she is somehow ALREADY
  // embedded, let her move freely so she can never be walled in permanently
  const stepBulk = (nx, nz) => {
    if (!bulkClear(pos.x, pos.z) || bulkClear(nx, nz)) { pos.x = nx; pos.z = nz; return; }
    if (bulkClear(nx, pos.z)) pos.x = nx;
    else if (bulkClear(pos.x, nz)) pos.z = nz;
  };
  const groundMove = (tx, tz, sp) => {
    const dx = tx - pos.x, dz = tz - pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const step = Math.min(dist, sp * e.slowMult * dt);
    stepBulk(pos.x + (dx / dist) * step, pos.z + (dz / dist) * step);
  };
  const flyToward = (tx, ty, tz, sp) => {
    const dx = tx - pos.x, dy2 = ty - pos.y, dz = tz - pos.z;
    const dist = Math.hypot(dx, dy2, dz) || 0.001;
    const step = Math.min(dist, sp * dt);
    pos.y += (dy2 / dist) * step;
    const nx = pos.x + (dx / dist) * step, nz = pos.z + (dz / dist) * step;
    // flight had NO collision at all: she flew straight out through the cavern
    // wall. Over the wall tops she's genuinely clear; below them she goes around.
    if (pos.y > LAIR_WALL_TOP) { pos.x = nx; pos.z = nz; }
    else stepBulk(nx, nz);
  };
  const hitPlayersWithin = (r, dmg2, kbF, fxExtra) => {
    for (const p of players) {
      const pd = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (pd > r || Math.abs(p.pos.y - pos.y) > 3.5) continue;
      const kb = kbF ? { x: (p.pos.x - pos.x) / Math.max(0.1, pd) * kbF, z: (p.pos.z - pos.z) / Math.max(0.1, pd) * kbF } : null;
      const fx = kb ? { kb, ...(fxExtra || {}) } : fxExtra || null;
      if (p.minion) damageMinion(p.minion, dmg2);
      else if (p.id === 'me') damageLocalPlayer(dmg2, fx);
      else netSend({ t: 'phit', target: p.id, dmg: dmg2, fx });
    }
  };
  // she wades through fortifications like they are furniture
  if (d.state !== 'sleep' && Math.random() < dt * 2) {
    const w = wallAt(e.floor, Math.round(pos.x / 4), Math.round(pos.z / 4));
    if (w) damageWall(w, 60);
  }

  // ---- active grounded breath sweep: a cone raking across her front arc ----
  if (d.sweep) {
    const s = d.sweep;
    s.t += dt;
    const prog0 = Math.max(0, Math.min(1, s.t / 1.6));
    const aimA = s.a0 + (s.a1 - s.a0) * prog0;
    d.aim = e.yaw + aimA; // her head turns to follow the fire (see animateDragon)
    // FIRE COMES OUT OF HER MOUTH. The jet is re-anchored to the muzzle every
    // frame and thrown along the current sweep angle, so it rakes the floor as
    // she turns her head — the burning patches below are where it LANDS.
    if (mine && onMyFloor(e)) {
      if (!s.jet && s.t > -0.25) {
        s.jet = spawnFireJet(e.floor, { dur: 1.85, reach: 17, width: 1.15, rate: 110, speed: 27 });
      }
      if (s.jet && dragonMuzzle(e, _muzzle, _muzDir)) {
        s.jet.origin.copy(_muzzle);
        // throw it along the sweep, angled down at the floor she's raking
        _muzDir.set(Math.sin(d.aim), 0, Math.cos(d.aim));
        _muzDir.y = (0.9 - _muzzle.y) / 12; // aim at the ground a dozen units out
        s.jet.dir.copy(_muzDir).normalize();
      }
      if (s.t >= 1.6 && s.jet) { endFireJet(s.jet); s.jet = null; }
    }
    if (s.t >= 0 && s.t < 1.6) {
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick = 0.11;
        const prog = s.t / 1.6;
        const a = s.a0 + (s.a1 - s.a0) * prog; // sweeps across her front
        for (let r = 6; r <= 16; r += 4.5) {
          const fx2 = pos.x + Math.sin(e.yaw + a) * r, fz2 = pos.z + Math.cos(e.yaw + a) * r;
          igniteGround(e.floor, fx2, fz2); // the floor itself catches fire
          for (const p of players) {
            if (Math.hypot(p.pos.x - fx2, p.pos.z - fz2) < 2.4 && p.pos.y < 3) {
              if (p.minion) damageMinion(p.minion, 8);
              else if (p.id === 'me') damageLocalPlayer(8, { poison: { dps: 4, dur: 2 } });
              else netSend({ t: 'phit', target: p.id, dmg: 8, fx: { poison: { dps: 4, dur: 2 } } });
            }
          }
        }
      }
    } else if (s.t >= 1.6) { if (s.jet) endFireJet(s.jet); d.aim = null; d.sweep = null; }
  }
  // ---- flight breath run (line of fire along the strafe) ----
  if (d.breath) {
    const b = d.breath;
    b.t += dt;
    d.aim = Math.atan2(b.dx, b.dz);
    if (mine && onMyFloor(e)) {
      if (!b.jet && b.t > -0.35) b.jet = spawnFireJet(e.floor, { dur: 1.75, reach: 15, width: 1.0, rate: 95, speed: 30 });
      if (b.jet && dragonMuzzle(e, _muzzle, _muzDir)) {
        b.jet.origin.copy(_muzzle);
        // strafing overhead: she pours it down and forward onto the run
        _muzDir.set(b.dx, 0, b.dz);
        _muzDir.y = -Math.max(0.35, (_muzzle.y - 0.9) / 14);
        b.jet.dir.copy(_muzDir).normalize();
      }
      if (b.t >= 1.4 && b.jet) { endFireJet(b.jet); b.jet = null; }
    }
    if (b.t >= 0 && b.t < 1.4) {
      b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = 0.14;
        const prog = b.t / 1.4;
        const fx2 = b.x0 + b.dx * prog * b.len, fz2 = b.z0 + b.dz * prog * b.len;
        igniteGround(e.floor, fx2, fz2);
        if (Math.random() < 0.35) netSend({ t: 'fx', f: e.floor, x: fx2, y: 0.8, z: fz2, color: 0xff5511 });
        for (const p of players) {
          if (Math.hypot(p.pos.x - fx2, p.pos.z - fz2) < 2.4 && p.pos.y < 3) {
            if (p.minion) damageMinion(p.minion, 16);
            else if (p.id === 'me') damageLocalPlayer(16, { poison: { dps: 4, dur: 2 } });
            else netSend({ t: 'phit', target: p.id, dmg: 16, fx: { poison: { dps: 4, dur: 2 } } });
          }
        }
      }
    } else if (b.t >= 1.4) { if (b.jet) endFireJet(b.jet); d.aim = null; d.breath = null; }
  }

  const spd = enraged ? 1.35 : 1;
  // she is a grounded duelist at heart: cap her total time aloft
  if (['takeoff', 'circle', 'roostfly'].includes(d.state)) {
    d.skyT = (d.skyT || 0) + dt;
    if (d.skyT > 14 && d.state === 'circle') {
      d.mustLand = true;
      d.state = 'landing'; d.t = 0; d.strafed = false; d.skyT = 0;
      d.landAt = { x: target?.pos.x ?? d.home.x, z: target?.pos.z ?? d.home.z };
      if (mine) addMsg('She folds her wings and DROPS—', 'bad');
    }
  } else if (d.state === 'prowl') { d.skyT = 0; d.mustLand = false; }
  // wingbeat downdraft: dust storms beneath her when she flies low
  if (mine && pos.y > 2 && pos.y < 14 && Math.random() < dt * 2.2) {
    const gy = groundHeightAt(pos.x, pos.z, 0, fs.grid);
    spawnBurst(new THREE.Vector3(pos.x + (Math.random() - 0.5) * 4, gy + 0.4, pos.z + (Math.random() - 0.5) * 4), 0x8a7a66, 6, 3, 0.12, 0.5);
  }
  // her footfalls shake the earth when she stalks near
  if (mine && d.state === 'prowl' && (d.spd || 0) > 2 && target && td < 26) {
    d.stepT = (d.stepT || 0) + dt * d.spd;
    if (d.stepT > 2.4) {
      d.stepT = 0;
      G.shake = Math.max(G.shake || 0, 0.14);
      sfx.trap();
    }
  }
  switch (d.state) {
    case 'sleep': {
      if (target && td < e.cfg.aggro) {
        d.state = 'wake'; d.t = 0;
        setEnemyState(e, 'idle');
        if (mine) { sfx.bossroar(); addMsg('The mountain of scales STIRS…', 'bad'); }
        showBossBar(e.cfg.bossName);
      }
      break;
    }
    case 'wake': {
      turnTo(target?.pos.x ?? pos.x, target?.pos.z ?? pos.z, 1.2);
      if (d.t > 2.2) {
        d.state = 'prowl';
        setEnemyState(e, 'chase');
        if (mine) {
          sfx.bossroar(); addMsg('EMBERWING THE UNDYING has awoken!', 'bad');
          G.shake = Math.max(G.shake || 0, 0.7);
          showBossCard('EMBERWING', 'THE UNDYING');
          if (G.net.role === 'solo') G.slowmo = 1.6;
        }
        netSend({ t: 'fx', f: e.floor, x: pos.x, y: 2, z: pos.z, color: 0xffcc88, big: 1 });
      }
      break;
    }
    case 'prowl': {
      if (!target) { setEnemyState(e, 'idle'); break; }
      const facing = turnTo(target.pos.x, target.pos.z, enraged ? 2.6 : 1.9);
      // momentum: she builds to speed facing her prey, sheds it in the turn
      d.spd = d.spd ?? 0;
      const wantSpd = facing < 1.0 && td > 7.5 ? e.cfg.speed * spd : 0;
      d.spd += (wantSpd - d.spd) * Math.min(1, dt * (wantSpd > d.spd ? 1.4 : 4));
      if (d.spd > 0.3) groundMove(target.pos.x, target.pos.z, d.spd);
      pos.y += (groundHeightAt(pos.x, pos.z, pos.y, fs.grid) - pos.y) * Math.min(1, dt * 6);

      // someone carving up her flanks from behind? tail answer.
      d.atkCd -= dt * spd;
      d.breathCd -= dt;
      d.gustCd -= dt;
      let rear = null;
      for (const p of players) {
        if (p.minion) continue;
        const pd = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
        if (pd < 9 && Math.abs(angleTo(p.pos.x, p.pos.z)) > 2.1) { rear = p; break; }
      }
      // wrong tier? she doesn't shout at the air — she CLOSES the gap
      const dyT = pos.y - target.pos.y;
      if (Math.abs(dyT) > 2.5) d.unreach = (d.unreach || 0) + dt;
      else d.unreach = 0;
      if (d.unreach > 2.2) {
        d.unreach = 0;
        if (dyT > 0) {
          // her prey is BELOW: she pours off the ledge onto them
          d.state = 'landing'; d.t = 0;
          d.landAt = { x: target.pos.x, z: target.pos.z };
          if (mine) addMsg('She pours off the ledge toward you—', 'bad');
          break;
        }
        d.state = 'takeoff'; d.t = 0;
        setEnemyState(e, 'chase');
        if (mine) { sfx.bossroar(); addMsg('EMBERWING takes to the sky!', 'bad'); }
        break;
      }
      if (d.atkCd <= 0) {
        // a real animal pauses to glare before it strikes
        if (Math.random() < 0.3 && td > 6) {
          d.state = 'menace'; d.t = 0;
          setEnemyState(e, 'idle');
          if (mine && Math.random() < 0.5) sfx.bones(); // a low rattle of scales
        } else if (rear && Math.random() < 0.7) {
          // TAIL SWEEP: a spinning lash at everything close
          d.state = 'tailsweep'; d.t = 0;
          setEnemyState(e, 'attack');
          if (mine) addMsg('Her tail whips around!', 'bad');
        } else if (td < 8 + (e.cfg.bodyR || 0)) {
          // CLAW SWIPE
          d.state = 'claw'; d.t = 0;
          setEnemyState(e, 'attack');
        } else if (td < 18 && facing < 0.5) {
          // LUNGING BITE: rear back, then explode forward
          d.state = 'lungewind'; d.t = 0;
          setEnemyState(e, 'idle');
          if (mine) addMsg('She coils to lunge—', 'bad');
        }
        d.atkCd = enraged ? 1.8 : 2.6;
      }
      // grounded breath: rear up and RAKE the floor across her front
      if (d.breathCd <= 0 && td > 7 && td < 22 && facing < 0.6) {
        d.state = 'rearup'; d.t = 0;
        setEnemyState(e, 'idle');
        if (mine) { sfx.bossroar(); addMsg('She draws a deep breath…', 'bad'); }
        netSend({ t: 'fx', f: e.floor, x: pos.x, y: 4, z: pos.z, color: 0xffaa00, big: 1 });
        d.breathCd = enraged ? 7 : 11;
      }
      // takeoff is RARE — twice a fight, or when melee truly savages her.
      // Below 18% she CAN'T fly anymore: a wounded animal's last stand.
      if (frac > 0.18) {
        for (const th of [0.62, 0.3]) {
          if (frac < th && !d.flew[th]) { d.flew[th] = true; d.state = 'takeoff'; d.t = 0; }
        }
        if (d.pain > e.maxHp * 0.18 && d.t > 12) { d.state = 'takeoff'; d.t = 0; d.pain = 0; }
      } else if (!d.finalStand) {
        d.finalStand = true;
        if (mine) { sfx.bossroar(); addMsg('Wounded and wingless — her FINAL STAND!', 'bad'); G.shake = Math.max(G.shake || 0, 0.8); }
        if (G.net.role === 'solo') G.slowmo = 1.4;
        e.dmg = Math.round(e.dmg * 1.35); // desperate strikes hit harder
      }
      if (d.state === 'takeoff') {
        setEnemyState(e, 'chase');
        if (mine) { sfx.bossroar(); addMsg('EMBERWING takes to the sky!', 'bad'); G.shake = Math.max(G.shake || 0, 0.4); }
        hitPlayersWithin(9, 8, 15); // downdraft on liftoff
      }
      break;
    }
    case 'claw': {
      if (d.t > 0.35 && !d.hitDone) {
        d.hitDone = true;
        // a wide arc in front of her forelimbs
        for (const p of players) {
          const pd = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
          if (pd < 9.5 && Math.abs(angleTo(p.pos.x, p.pos.z)) < 1.2 && Math.abs(p.pos.y - pos.y) < 3.5) {
            const kb = { x: (p.pos.x - pos.x) / pd * 11, z: (p.pos.z - pos.z) / pd * 11 };
            if (p.minion) damageMinion(p.minion, e.dmg);
            else if (p.id === 'me') damageLocalPlayer(e.dmg, { kb });
            else netSend({ t: 'phit', target: p.id, dmg: e.dmg, fx: { kb } });
          }
        }
        if (mine) { sfx.swing(); sfx.hit(); }
      }
      if (d.t > 0.7) { d.state = 'prowl'; d.hitDone = false; setEnemyState(e, 'chase'); }
      break;
    }
    case 'tailsweep': {
      e.yaw += dt * 7; // the whole body whips around
      if (d.t > 0.3 && !d.hitDone) {
        d.hitDone = true;
        hitPlayersWithin(10, 16, 15);
        if (mine) { sfx.swing(); spawnBurst(pos.clone().setY(1.2), 0xccaa88, 24, 9, 0.16, 0.5); }
        netSend({ t: 'fx', f: e.floor, x: pos.x, y: 1.2, z: pos.z, color: 0xccaa88, big: 1 });
      }
      if (d.t > 0.8) { d.state = 'prowl'; d.hitDone = false; setEnemyState(e, 'chase'); }
      break;
    }
    case 'lungewind': {
      // rear back — your cue to sidestep
      if (target) turnTo(target.pos.x, target.pos.z, 3);
      if (d.t > 0.55) {
        d.state = 'lunge'; d.t = 0;
        setEnemyState(e, 'attack');
        d.lungeV = { x: Math.sin(e.yaw), z: Math.cos(e.yaw) };
        if (mine) sfx.bossroar();
      }
      break;
    }
    case 'lunge': {
      groundMove(pos.x + d.lungeV.x * 30, pos.z + d.lungeV.z * 30, 26);
      if (!d.hitDone) {
        for (const p of players) {
          const pd = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
          if (pd < 7 && p.pos.y < 4) {
            d.hitDone = true;
            const kb = { x: d.lungeV.x * 14, z: d.lungeV.z * 14 };
            const bite = Math.round(e.dmg * 1.35);
            if (p.minion) damageMinion(p.minion, bite);
            else if (p.id === 'me') damageLocalPlayer(bite, { kb });
            else netSend({ t: 'phit', target: p.id, dmg: bite, fx: { kb } });
          }
        }
      }
      if (d.t > 0.55) { d.state = 'prowl'; d.hitDone = false; setEnemyState(e, 'chase'); }
      break;
    }
    case 'rearup': {
      if (target) turnTo(target.pos.x, target.pos.z, 1.4);
      if (d.t > 0.9) {
        d.state = 'prowl';
        setEnemyState(e, 'attack');
        // sweep across her front arc, biased toward the target's side
        const bias = target ? Math.sign(angleTo(target.pos.x, target.pos.z) || 1) : 1;
        d.sweep = { a0: -1.0 * bias, a1: 1.0 * bias, t: 0, tick: 0 };
      }
      break;
    }
    case 'takeoff': {
      flyToward(pos.x, 9, pos.z, 7);
      if (pos.y > 8.4) { d.state = 'circle'; d.t = 0; d.volleys = 0; setEnemyState(e, 'chase'); }
      break;
    }
    case 'circle': {
      // she circles her PREY, not her gold — high above the towers, banking,
      // one strafing pass, and then she ALWAYS comes back down
      d.orbitA += dt * 0.5;
      // the hunt's center drifts to wherever the target runs
      d.orbC = d.orbC || { x: pos.x, z: pos.z };
      if (target) {
        d.orbC.x += (target.pos.x - d.orbC.x) * Math.min(1, dt * 0.8);
        d.orbC.z += (target.pos.z - d.orbC.z) * Math.min(1, dt * 0.8);
        // keep the circuit inside the cavern even when prey hugs the walls
        const mW = (fs.grid.w - 6) * 4, mn = 24;
        d.orbC.x = Math.max(mn, Math.min(mW, d.orbC.x));
        d.orbC.z = Math.max(mn, Math.min((fs.grid.h - 6) * 4, d.orbC.z));
      }
      const cr = fs.grid.lair ? 17 : 14;
      const ox = d.orbC.x + Math.cos(d.orbitA) * cr;
      const oz = d.orbC.z + Math.sin(d.orbitA) * cr;
      flyToward(ox, (fs.grid.lair ? 17 : 10) + Math.sin(d.t * 1.2), oz, 12);
      if (target) turnTo(target.pos.x, target.pos.z, 4);
      if (!d.strafed && d.t > 2.5 && target) {
        d.strafed = true;
        const dx = target.pos.x - pos.x, dz = target.pos.z - pos.z;
        const dl = Math.hypot(dx, dz) || 1;
        d.breath = { x0: pos.x, z0: pos.z, dx: dx / dl, dz: dz / dl, len: dl + 14, t: -0.9, tick: 0 };
        setEnemyState(e, 'attack');
        if (mine) { sfx.bossroar(); addMsg('She strafes the hall with fire!', 'bad'); }
      }
      if (d.t > 7) {
        if (fs.grid.dragonPerch && Math.random() < 0.4 && !enraged && !d.mustLand) {
          d.state = 'roostfly'; d.t = 0; d.strafed = false;
          if (mine) addMsg('She wheels toward her tower—', 'bad');
        } else {
          d.state = 'landing'; d.t = 0; d.strafed = false;
          d.landAt = { x: target?.pos.x ?? d.home.x, z: target?.pos.z ?? d.home.z };
          if (mine) addMsg('She folds her wings and DROPS—', 'bad');
          // scorch-ring telegraph where she will crash
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(6.5, 8, 36),
            new THREE.MeshBasicMaterial({ color: 0xff5522, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(d.landAt.x, groundHeightAt(d.landAt.x, d.landAt.z, 0, fs.grid) + 0.1, d.landAt.z);
          G.scene.add(ring);
          d.landRing = ring;
        }
      }
      break;
    }
    case 'roostfly': {
      const pr = fs.grid.dragonPerch;
      flyToward(pr.x, pr.y + 0.5, pr.z, 13);
      if (target) turnTo(target.pos.x, target.pos.z, 3);
      const arrived = Math.hypot(pr.x - pos.x, pr.z - pos.z) < 1.6 && Math.abs(pos.y - pr.y - 0.5) < 1;
      if (arrived || d.t > 6) {
        // she LANDS — no endless wheeling
        pos.x = pr.x; pos.y = pr.y + 0.5; pos.z = pr.z;
        d.state = 'roost'; d.t = 0; d.roostCd = 1.2;
        setEnemyState(e, 'idle');
        if (mine) { sfx.bossroar(); addMsg('She ROOSTS on the tower, wings mantled.', 'bad'); }
      }
      break;
    }
    case 'roost': {
      // mantled on her tower, raking fire down into the court
      if (target) turnTo(target.pos.x, target.pos.z, 2.2);
      d.roostCd -= dt;
      if (d.roostCd <= 0 && target) {
        d.roostCd = 2.4;
        setEnemyState(e, 'attack');
        d.sweep = { a0: angleTo(target.pos.x, target.pos.z) - 0.5, a1: angleTo(target.pos.x, target.pos.z) + 0.5, t: 0, tick: 0 };
        if (mine) sfx.bossroar();
      }
      if (d.t > 7 || d.pain > e.maxHp * 0.05) {
        d.state = 'takeoff'; d.t = 0; d.pain = 0;
        setEnemyState(e, 'chase');
      }
      break;
    }
    case 'menace': {
      // she stops. she looks at you. the hall goes quiet.
      if (target) turnTo(target.pos.x, target.pos.z, 2.5);
      if (d.t > 1.3) { d.state = 'prowl'; setEnemyState(e, 'chase'); }
      break;
    }
    case 'landing': {
      const lg = groundHeightAt(d.landAt.x, d.landAt.z, 0, fs.grid);
      flyToward(d.landAt.x, lg + 0.2, d.landAt.z, 15);
      if (d.landRing) d.landRing.material.opacity = 0.3 + Math.sin(d.t * 12) * 0.25;
      if (pos.y < lg + 0.6) {
        pos.y = lg;
        if (d.landRing) { G.scene.remove(d.landRing); d.landRing.geometry.dispose(); d.landRing.material.dispose(); d.landRing = null; }
        d.state = 'prowl'; d.t = 0; d.pain = 0;
        setEnemyState(e, 'chase');
        // LANDING SLAM — the whole hall shudders
        if (mine) { sfx.trap(); sfx.bossroar(); spawnBurst(pos.clone().setY(1), 0xccaa77, 40, 11, 0.2, 0.6); G.shake = Math.max(G.shake || 0, 0.9); }
        netSend({ t: 'fx', f: e.floor, x: pos.x, y: 1, z: pos.z, color: 0xccaa77, big: 1 });
        hitPlayersWithin(8.5, 20, 16);
      }
      break;
    }
  }

  // wings: lazy beats on the prowl, full power in the air
  if (e.anim.current) e.anim.current.timeScale = pos.y > 2 ? 1.25 : d.state === 'sleep' ? 0.3 : 0.55;
  if (mine && d.state !== 'sleep') updateBossBar(e.hp / e.maxHp);
  let dyw = e.yaw - e.obj.rotation.y;
  while (dyw > Math.PI) dyw -= Math.PI * 2;
  while (dyw < -Math.PI) dyw += Math.PI * 2;
  e.obj.rotation.y += dyw * Math.min(1, dt * 6);
}

function summonImps(e, fs, n) {
  for (let i = 0; i < n; i++) {
    const a2 = Math.random() * 6.28;
    // lair walls are three cells tall — an unchecked 6u ring buries imps in stone
    const sp = safeSpawn(e.obj.position.x + Math.sin(a2) * 6, e.obj.position.z + Math.cos(a2) * 6, 3, fs.grid);
    if (!sp) continue;
    const sx = sp.x, sz = sp.z;
    const id = fs.n * 1000 + 500 + fs.nextSummonId++;
    const imp = spawnEnemy(fs, 'imp', sx, sz, { y: 3, id });
    setEnemyState(imp, 'awaken');
    fs.summons.push({ id, type: 'imp', x: sx, z: sz, y: 3 });
    netSend({ t: 'espawn', f: fs.n, id, type: 'imp', x: sx, z: sz, y: 3 });
  }
  if (onMyFloor(e)) addMsg('Emberwing shrieks — imps answer!', 'bad');
}

// visual status effects other clients must see too (via 'evfx' messages)
export function applyEnemyVfx(e, kind, dur) {
  if (!e || e.state === 'dead') return;
  if (kind === 'charm') {
    // material tint rather than a child mesh; a token guards the revert so a
    // refreshed charm isn't cut short by the old timer
    e._statusTok = e._statusTok || {};
    const tok = (e._statusTok[kind] = (e._statusTok[kind] || 0) + 1);
    if (!e._statusMats) {
      e._statusMats = [];
      e.obj.traverse((n) => {
        if (!n.isMesh && !n.isSkinnedMesh) return;
        if (n.material.isMeshBasicMaterial) return; // blob shadows / glows
        e._statusMats.push([n, n.material]);
        n.material = n.material.clone();
        if (n.material.emissive) {
          n.material.emissive.setHex(0x55ff77);
          n.material.emissiveIntensity = 0.5;
        }
      });
    }
    setTimeout(() => {
      if (e._statusTok[kind] !== tok) return; // refreshed since — newer timer owns the revert
      if (e._statusMats) {
        for (const [n, mat] of e._statusMats) { n.material.dispose?.(); n.material = mat; }
        e._statusMats = null;
      }
    }, dur * 1000);
    return;
  }
  const old = e.obj.children.find(c => c.userData.evfx);
  if (old) e.obj.remove(old);
  let obj = null;
  if (kind === 'ice') {
    obj = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 2.3, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.5, roughness: 0.15 })
    );
    obj.position.y = 1.1;
  } else if (kind === 'freeze') {
    obj = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.25, depthWrite: false })
    );
    obj.position.y = 1.1;
  }
  if (!obj) return;
  obj.userData.evfx = true;
  e.obj.add(obj);
  setTimeout(() => { e.obj.remove(obj); obj.geometry?.dispose(); obj.material?.dispose(); }, dur * 1000);
}

export function setEnemyState(e, s, fromNet = false) {
  if (e.state === 'dead') return;
  if (e.state === s) return;
  e.state = s;
  e.stateT = 0;
  const a = e.anim;
  if (e.cfg.singleClip || e.cfg.procDragon) {
    // one organic loop; the body does the acting — but guests still need the state
    if (isAuthority() && !fromNet) netSend({ t: 'estate', f: e.floor, id: e.id, s });
    return;
  }
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
    if (e.ds && e.obj.position.y < 2) e.ds.pain += amount; // grounded melee pressure
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
    // dominate: minds too big (bosses, the dragon) shrug it off
    if (effects.charm && !e.boss && !e.cfg.dragon) {
      e.charmT = Math.max(e.charmT, effects.charm);
      applyEnemyVfx(e, 'charm', effects.charm);
      netSend({ t: 'evfx', f: e.floor, id: e.id, kind: 'charm', dur: effects.charm });
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

  // the dragon's death is an EVENT
  if (e.cfg.dragon && onMyFloor(e)) {
    G.shake = Math.max(G.shake || 0, 1.2);
    if (G.net.role === 'solo') G.slowmo = 2.2;
  }
  // slimes split apart when killed
  if (e.cfg.splitInto && isAuthority() && !fromNet && source !== 'none') {
    const fs2 = floorState(e.floor);
    for (let i = 0; i < 2; i++) {
      const a2 = Math.random() * Math.PI * 2;
      // you kill slimes AGAINST walls — don't pop the children into one
      const sp2 = safeSpawn(e.obj.position.x + Math.sin(a2) * 1.2, e.obj.position.z + Math.cos(a2) * 1.2,
                            e.obj.position.y, fs2.grid);
      if (!sp2) continue;
      const sx = sp2.x, sz = sp2.z;
      const id = fs2.n * 1000 + 500 + fs2.nextSummonId++;
      const mchild = spawnEnemy(fs2, e.cfg.splitInto, sx, sz, { y: e.obj.position.y, id });
      setEnemyState(mchild, 'awaken');
      fs2.summons.push({ id, type: e.cfg.splitInto, x: sx, z: sz, y: e.obj.position.y });
      netSend({ t: 'espawn', f: fs2.n, id, type: e.cfg.splitInto, x: sx, z: sz, y: e.obj.position.y });
    }
    if (onMyFloor(e)) addMsg(`The ${(e.cfg.name || 'mass').toLowerCase()} splits apart!`, 'bad');
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
    addMsg(`${e.boss ? `${e.cfg.bossName || 'Boss'} destroyed!` : `${e.elite ? 'Elite ' : ''}${e.cfg.name || 'Hostile'} destroyed`} +${gold} credits`, e.boss || e.elite ? 'gold' : '');
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

// Local player: FIRST-PERSON controller — mouse look, aim (shift), gravity & climbing,
// melee/ranged combat, spells, dodge dash, potions, XP/levels, traps, death cam.
// Remote player avatars (full 3D models) are also maintained here.
import * as THREE from 'three';
import { G } from './state.js';
import { CLASSES, XP_FOR_LEVEL, CAPE_COLORS, SIGNATURES, SPELLS, CELL } from './config.js';
import { makeCharacter, setEquipMeshes, applyLook, makeWeaponModel } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, groundHeightAt, posBlocked, bodyBlocked, resolveStuck, hasLineOfSight } from './dungeon.js';
import { spawnBolt } from './projectiles.js';
import { damageEnemy } from './enemies.js';
import { gearStat, weaponDamage, equippedMeshes, affixOf } from './items.js';
import { addMsg, refreshHud, showPrompt, hidePrompt, flashVignette, updatePartyBar, hitmarker, setCrosshairHostile } from './ui.js';
import { netSend } from './net.js';
import { nearestChest, takeLoot, nearestItemDrop } from './loot.js';
import { triggerSwing, setViewmodelWeapon, triggerOffhandStab } from './viewmodel.js';
import { WEAPON_TYPES } from './config.js';
import { nearestRope, grabRope, releaseRope, updateRopePhysics } from './ropes.js';
import { nearestShopkeeper, nearestDoor, useDoor, nearestHomeDoor } from './town.js';

const EYE = 1.62;
const BASE_FOV = 66, AIM_FOV = 44;

export function createPlayer(classId, name) {
  const cls = CLASSES[classId];
  const modelName = cls.model;
  const { obj, anim } = makeCharacter('char', modelName, cls.show);
  applyLook(obj, G.look);
  obj.scale.setScalar(cls.scale || 1); // sci-fi rigs are pack-scale, not KayKit-scale
  obj.visible = false; // first person: own body hidden until death cam
  G.scene.add(obj);
  // warm lantern glow that follows the hero
  const lantern = new THREE.PointLight(0xe6f0fa, 24, 18, 1.5); // shoulder lamp, not a torch
  lantern.position.set(0, 2.4, 0);
  obj.add(lantern);
  const p = {
    classId, cls, name,
    obj, anim,
    hp: cls.hp, maxHp: cls.hp,
    mana: cls.mana, maxMana: cls.mana,
    yaw: 0, camYaw: 0, camPitch: 0,
    vy: 0, aiming: false, bobT: 0,
    attackT: 0, attackIdx: 0, attacking: false, attackFired: false,
    dodgeT: 0, dodgeCd: 0, iframes: 0, dodgeDirX: 0, dodgeDirZ: 0,
    dead: false, deadT: 0, moving: false, buff: null, slowT: 0,
    poisonT: 0, poisonDps: 0, poisonTick: 0, kbX: 0, kbZ: 0,
    rope: null, airVX: 0, airVZ: 0,
    trapCd: 0, lastPosSend: 0,
  };
  anim.play('Idle');
  G.player = p;
  refreshEquipVisuals();
  return p;
}

function attachHeldWeapon(obj, held, held2) {
  // clear previous held models
  const olds = [];
  obj.traverse((n) => { if (n.userData.heldWeapon) olds.push(n); });
  for (const o of olds) o.parent.remove(o);
  if (!held) return;
  const sides = held2 ? [['handslotr', 'handslot.r'], ['handslotl', 'handslot.l']] : [['handslotr', 'handslot.r']];
  for (const names of sides) {
    const bone = obj.getObjectByName(names[0]) || obj.getObjectByName(names[1]);
    if (!bone) continue;
    let m = makeWeaponModel(held);
    const isBow = held === 'bow' || held.startsWith('Bow_');
    if (isBow) {
      // A bow isn't gripped like a blade — the blade pose lays it flat, limbs out
      // to the sides. Pack bows carry their plane in XY and the procedural bow in
      // YZ, so bring both into one frame (limbs +y, plane normal +x), then hold it
      // limbs-vertical with the plane containing the shot.
      const model = m;
      if (held !== 'bow') model.rotation.y = -Math.PI / 2; // +90° holds it backwards (string downrange)
      else model.scale.setScalar(1.5); // the procedural bow is viewmodel-sized
      // models are grounded at their base — drop the bow so the grip, not the
      // lower limb tip, lands in the fist
      const mid = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
      model.position.y -= mid.y;
      m = new THREE.Group();
      m.add(model);
      m.rotation.set(-1.833, -Math.PI, -Math.PI / 2);
    } else {
      m.rotation.x = Math.PI / 2; // grip points along the forearm
    }
    m.userData.heldWeapon = true;
    bone.add(m);
  }
}

export function refreshEquipVisuals() {
  const p = G.player;
  if (!p) return;
  const w = G.inv.weapon;
  // no rig mesh AND no held model (e.g. the ranger's procedural bow):
  // teammates would see empty hands — hold the drop model instead
  let heldName = w ? (w.held || (!w.mesh?.length ? w.model : null)) : null;
  let meshes = heldName ? [] : equippedMeshes(p.classId);
  // guns aren't gripped like blades: astronaut rigs carry their own Pistol mesh
  // for the third-person silhouette, and toon rigs have the rifle baked in —
  // never bone-attach a blaster drop model.
  if (heldName?.startsWith('blaster-')) { heldName = null; meshes = ['Pistol']; }
  setEquipMeshes(p.obj, meshes);
  attachHeldWeapon(p.obj, heldName, w?.held2);
  setViewmodelWeapon(w?.model || WEAPON_TYPES[p.classId][0].model, w?.wtype || WEAPON_TYPES[p.classId][0].id, w?.verb, w?.sig);
  p.sigCharge = 0;
  refreshSigSlot();
  p.maxHp = effectiveMaxHp();
  p.hp = Math.min(p.hp, p.maxHp);
  netSend({ t: 'equip', meshes, held: heldName, held2: !!w?.held2 });
  refreshHud();
}

export function resetPlayerForFloor() {
  const p = G.player;
  clearMotionState(p); // a rope/lash held across a floor change anchors to the OLD grid
  p.obj.position.set(G.grid.spawn.x, 0, G.grid.spawn.z);
  p.obj.position.y = groundHeightAt(G.grid.spawn.x, G.grid.spawn.z, 0);
  // never spawn embedded in geometry
  if (bodyBlocked(p.obj.position.x, p.obj.position.z, p.obj.position.y)) {
    const free = resolveStuck(p.obj.position.x, p.obj.position.z, p.obj.position.y);
    if (free) { p.obj.position.x = free.x; p.obj.position.z = free.z; }
  }
  if (G.grid.spawnYaw !== undefined) p.camYaw = G.grid.spawnYaw;
  p.obj.visible = false;
  if (p.dead) { p.dead = false; p.hp = Math.round(p.maxHp * 0.6); }
  p.attacking = false;
  p.anim.play('Idle');
}

// ---------- stats (class + level + run bonuses + gear + buffs) ----------
function bannerMult() {
  const p = G.player;
  if (!p || !G.banners?.length) return 1;
  for (const b of G.banners) {
    if (Math.hypot(p.obj.position.x - b.x, p.obj.position.z - b.z) <= b.r) return b.mult;
  }
  return 1;
}

export function effectiveDamage() {
  const p = G.player;
  let d = weaponDamage(p.cls) + G.run.atkBonus + (G.run.level - 1) * 2;
  if (p.buff) d *= p.buff.dmgMult;
  d *= bannerMult();
  return Math.round(d);
}
export function effectiveSpeed() {
  const p = G.player;
  let s = p.cls.speed + G.run.speedBonus + gearStat('speed');
  if (p.buff) s *= p.buff.speedMult;
  if (p.slowT > 0) s *= 0.55;
  if (p.aiming) s *= 0.6;
  return s;
}
export function effectiveMaxHp() {
  return G.player.cls.hp + G.run.hpBonus + (G.run.level - 1) * 8 + Math.round(gearStat('hp'));
}
export function effectiveCrit() {
  return G.player.cls.crit + gearStat('crit') / 100;
}
export function effectiveArmor() {
  let a = gearStat('armor') / 100;
  if (G.player.buff?.armorAdd) a += G.player.buff.armorAdd;
  return Math.min(0.75, a);
}
export function effectiveAttackTime() {
  const p = G.player;
  const w = G.inv.weapon;
  let t = w?.atkTime || p.cls.attackTime;
  const af = affixOf(w);
  if (af?.atkSpeed) t /= af.atkSpeed;
  return t;
}
// on-hit effects granted by the equipped weapon (+ active buffs)
export function weaponHitEffects(dmg) {
  const w = G.inv.weapon;
  const af = affixOf(w);
  const fx = {};
  if (af?.burn) fx.poison = { dps: Math.max(2, Math.round(dmg * af.burn.mult)), dur: af.burn.dur };
  if (af?.slow) fx.slow = af.slow;
  let steal = (af?.lifesteal || 0) + (w?.lifestealAdd || 0);
  if (G.player.buff?.lifesteal) steal += G.player.buff.lifesteal;
  if (steal) fx.lifesteal = steal;
  if (w?.stunHit && Math.random() < w.stunHit) fx.stun = 0.7; // hammers ring skulls
  return Object.keys(fx).length ? fx : null;
}

// weapon reach and swing width extend the class baseline
export function effectiveAttackRange() {
  return G.player.cls.attackRange + (G.inv.weapon?.rangeAdd || 0);
}
export function effectiveAttackArc() {
  return G.player.cls.attackArc + (G.inv.weapon?.arcAdd || 0);
}

// ---- signature charge: landed basic hits wind the weapon's power ----
export function addSigCharge(n = 1) {
  const p = G.player, w = G.inv.weapon;
  if (!p || !w?.sig) return;
  const need = SIGNATURES[w.sig].hits;
  const was = p.sigCharge || 0;
  p.sigCharge = Math.min(need, was + n);
  p.sigReadyFlag = p.sigCharge >= need;
  if (p.sigCharge >= need && was < need) {
    addMsg(`${SIGNATURES[w.sig].icon} ${SIGNATURES[w.sig].name} is CHARGED — press 4!`, 'gold');
    sfx.levelup();
  }
  refreshSigSlot();
}
export function sigReady() {
  const w = G.inv.weapon;
  return !!(w?.sig && (G.player?.sigCharge || 0) >= SIGNATURES[w.sig].hits);
}
export function spendSigCharge() { if (G.player) { G.player.sigCharge = 0; G.player.sigReadyFlag = false; refreshSigSlot(); } }
function refreshSigSlot() {
  const w = G.inv.weapon;
  const el = document.getElementById('sigSlot');
  if (!el) return;
  if (!w?.sig) { el.classList.add('hidden'); return; }
  const sig = SIGNATURES[w.sig];
  el.classList.remove('hidden');
  el.classList.toggle('charged', sigReady());
  el.querySelector('.icon').textContent = sig.icon;
  el.querySelector('.fill').style.height = `${Math.min(100, ((G.player?.sigCharge || 0) / sig.hits) * 100)}%`;
}
export { refreshSigSlot };
export function effectiveManaRegen() {
  return (G.player.cls.manaRegen || 0) + gearStat('mregen');
}

export function gainXp(amount) {
  G.run.xp += amount;
  let need = XP_FOR_LEVEL(G.run.level);
  while (G.run.xp >= need) {
    G.run.xp -= need;
    G.run.level++;
    need = XP_FOR_LEVEL(G.run.level);
    const p = G.player;
    p.maxHp = effectiveMaxHp();
    p.hp = p.maxHp;
    sfx.levelup();
    addMsg(`Level ${G.run.level}! Fully healed.`, 'gold');
    spawnBurst(p.obj.position.clone().setY(p.obj.position.y + 1.2), 0xffd35c, 24, 6, 0.16, 0.9);
  }
  refreshHud();
}

export function healLocalPlayer(amount) {
  const p = G.player;
  if (!p || p.dead || amount <= 0 || p.hp >= p.maxHp) return;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  spawnDamageNumber(p.obj.position.clone().setY(p.obj.position.y + 2.2), `+${amount}`, '#66ff88');
  refreshHud();
}

export function damageLocalPlayer(amount, effects = null) {
  const p = G.player;
  if (!p || p.dead || p.iframes > 0) return;
  const reduced = Math.max(1, Math.round(amount * (1 - effectiveArmor())));
  p.hp -= reduced;
  if (effects?.slow) p.slowT = Math.max(p.slowT, effects.slow.dur);
  if (effects?.poison) { p.poisonT = effects.poison.dur; p.poisonDps = effects.poison.dps; addMsg('You are poisoned!', 'bad'); }
  if (effects?.kb) { p.kbX += effects.kb.x; p.kbZ += effects.kb.z; }
  if (effects?.shake) G.shake = Math.max(G.shake || 0, effects.shake);
  if (effects?.lashbreak && p.lash) {
    releaseLash(p);
    addMsg('The blow hammers you off the wall!', 'bad');
  }
  sfx.hurt();
  flashVignette();
  if (p.hp <= 0) {
    p.hp = 0;
    die();
  } else {
    p.iframes = Math.max(p.iframes, 0.35);
  }
  refreshHud();
  sendPos(true);
}

// Drop everything that carries momentum or ties you to a fixed point. A rope or
// lash left attached across a death or a floor change keeps its OLD anchor: the
// rope's length constraint writes the position DIRECTLY, so the next frame after
// you respawn it snaps you back across the map, straight through the geometry in
// between (moveWithCollision only validates the endpoint — it can't sweep).
function clearMotionState(p) {
  p.rope = null; // the rope holds no state of its own — dropping the ref detaches
  p.lash = null;
  p.vy = 0;
  p.airVX = 0; p.airVZ = 0;
  p.kbX = 0; p.kbZ = 0;
  p.levitateT = 0;
}

function die() {
  const p = G.player;
  p.dead = true;
  p.deadT = 0;
  p.attacking = false;
  clearMotionState(p);
  p.obj.visible = true; // death cam shows your body
  p.anim.play('Death_A', { once: true, clamp: true });
  sfx.death();
  netSend({ t: 'pdead' });
}

export function drinkPotion() {
  const p = G.player;
  if (p.dead || G.run.potions <= 0 || p.hp >= p.maxHp) return;
  G.run.potions--;
  p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.45));
  triggerSwing('drink', 0.6);
  sfx.potion();
  spawnBurst(p.obj.position.clone().setY(p.obj.position.y + 1.4), 0x44ff77, 14, 4, 0.13);
  addMsg('You slam a stim');
  refreshHud();
}

// ---------- per-frame update ----------
// ---- wedge extractor: holding move keys but going nowhere = trapped ----
// If sustained input produces almost no movement AND nearly every direction
// is physically blocked, the world has swallowed you: yank the player to the
// nearest patch of open ground, charge a little blood, and say so.
function trackWedge(p, dt, movedNow) {
  p.wedgeT = (p.wedgeT || 0) + dt;
  p.wedgeDist = (p.wedgeDist || 0) + movedNow;
  if (p.wedgeDist > 1.0) { p.wedgeT = 0; p.wedgeDist = 0; return; } // clearly mobile
  if (p.wedgeT < 2.2) return;
  p.wedgeT = 0; p.wedgeDist = 0;
  // pressing into a flat wall is normal: if ANY direction can carry us a real
  // distance we're not wedged, just leaning. A true pocket lets you jiggle
  // but never travel — no probe gets anywhere.
  // Probe with a step the player could ACTUALLY take. A big 1.6 probe leaps
  // clear of a penetration band in one bound while the real ~0.1 steps never
  // can, so it reported "clearly mobile" for exactly the players who were pinned.
  const pos = p.obj.position;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = { x: pos.x, z: pos.z, y: pos.y };
    for (let s = 0; s < 6; s++) moveWithCollision(t, Math.sin(a) * 0.25, Math.cos(a) * 0.25, 0.55, { y: pos.y });
    if (Math.hypot(t.x - pos.x, t.z - pos.z) > 1.2) return;
  }
  const free = findOpenGround(pos.x, pos.z);
  if (!free) return;
  const cost = Math.max(2, Math.round(p.maxHp * 0.04));
  p.hp = Math.max(1, p.hp - cost);
  spawnBurst(pos.clone().setY(pos.y + 1), 0xffaa55, 14, 4, 0.13, 0.5);
  pos.set(free.x, groundHeightAt(free.x, free.z, 0), free.z);
  p.vy = 0; p.kbX = 0; p.kbZ = 0;
  spawnBurst(pos.clone().setY(pos.y + 1), 0xffaa55, 14, 4, 0.13, 0.5);
  sfx.dodge(); sfx.hurt();
  addMsg(`You were wedged in the world — pulled free to open ground (−${cost} HP)`, 'bad');
  refreshHud();
  sendPos(true);
}

// nearest spot of plain, unobstructed floor with breathing room on all sides
function findOpenGround(x, z) {
  for (let r = 2; r <= 16; r += 1) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + r * 0.5;
      const nx = x + Math.sin(a) * r, nz = z + Math.cos(a) * r;
      if (groundHeightAt(nx, nz, 0) > 0.3) continue; // plain ground only
      if (posBlocked(nx, nz, 0)) continue;
      // breathing room: all four neighbours clear too
      let clear = true;
      for (const [ox, oz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) {
        if (posBlocked(nx + ox, nz + oz, 0)) { clear = false; break; }
      }
      if (clear) return { x: nx, z: nz };
    }
  }
  return null;
}

// ---- spectator show: the player body is driven by a duelist AI ----
function spectateBot(p, dt) {
  const d = G.enemies.find(e => e.cfg.dragon && e.state !== 'dead');
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) G.keys[k] = false;
  if (!d) return;
  const dp = d.obj.position, pp = p.obj.position;
  const dist = Math.hypot(dp.x - pp.x, dp.z - pp.z);
  // always face the beast
  p.camYaw = Math.atan2(dp.x - pp.x, dp.z - pp.z) + Math.PI;
  p.camPitch = Math.max(-0.4, Math.min(1.2, Math.atan2((dp.y + 2.5) - (pp.y + 1.6), Math.max(1, dist))));
  // pick a footwork plan every second or so
  p.botT = (p.botT || 0) - dt;
  const danger = d.ds?.sweep || d.ds?.breath || d.ds?.state === 'lunge' || d.ds?.state === 'lungewind';
  if (danger) { p.botMode = 'flee'; p.botT = 0.5; }
  else if (p.botT <= 0) {
    p.botT = 0.7 + Math.random() * 0.9;
    p.botMode = dist > 8 ? 'close' : Math.random() < 0.5 ? 'strafeL' : 'strafeR';
    if (dist < 4) p.botMode = 'back';
    if (Math.random() < 0.2) tryDodge(); // the occasional showy hop
  }
  if (p.botMode === 'close') G.keys['KeyW'] = true;
  else if (p.botMode === 'strafeL') { G.keys['KeyA'] = true; if (dist > 7) G.keys['KeyW'] = true; }
  else if (p.botMode === 'strafeR') { G.keys['KeyD'] = true; if (dist > 7) G.keys['KeyW'] = true; }
  else if (p.botMode === 'back') G.keys['KeyS'] = true;
  else if (p.botMode === 'flee') { G.keys['KeyS'] = true; G.keys[Math.sin(G.time) > 0 ? 'KeyA' : 'KeyD'] = true; }
  // swing when the beast is in reach (and grounded enough to hit)
  if (dist < effectiveAttackRange() + (d.cfg.bodyR || 0) + 1.2 && dp.y < 4) tryAttack();
  // the show must go on
  if (G.run.potions > 0 && p.hp < p.maxHp * 0.5) { G.run.potions--; p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.5)); }
  if (p.hp < p.maxHp * 0.25) {
    p.hp = p.maxHp;
    spawnDamageNumber(pp.clone().setY(pp.y + 2.4), 'SECOND WIND', '#66ff88', true);
  }
}

export function updatePlayer(dt) {
  const p = G.player;
  if (!p) return;
  p.anim.update(dt);
  if (p.iframes > 0) p.iframes -= dt;
  if (p.dodgeCd > 0) p.dodgeCd -= dt;
  if (p.trapCd > 0) p.trapCd -= dt;
  if (p.slowT > 0) p.slowT -= dt;
  // poison ticks (ignores armor and i-frames)
  if (p.poisonT > 0 && !p.dead) {
    p.poisonT -= dt;
    p.poisonTick -= dt;
    if (p.poisonTick <= 0) {
      p.poisonTick = 0.5;
      p.hp -= Math.max(1, Math.round(p.poisonDps * 0.5));
      spawnBurst(p.obj.position.clone().setY(p.obj.position.y + 1.3), 0x66ff44, 4, 2, 0.08, 0.3);
      if (p.hp <= 0) { p.hp = 0; die(); }
      refreshHud();
    }
  }
  // unstick self-heal: if we ever end up inside geometry (bad landing,
  // desync, a wall raised nearby), nudge to the nearest free spot.
  // Tests the BODY, not just the centre: with a centre-only test you could be
  // pinned with a shoulder inside a wall — every direction blocked by the 0.55
  // movement ring — while this reported you perfectly fine and never fired.
  p.stuckT = (p.stuckT || 0) + dt;
  if (p.stuckT > 0.5) {
    p.stuckT = 0;
    const pos0 = p.obj.position;
    if (!p.lash && bodyBlocked(pos0.x, pos0.z, pos0.y)) {
      const free = resolveStuck(pos0.x, pos0.z, pos0.y);
      if (free) {
        pos0.x = free.x; pos0.z = free.z;
        p.kbX = 0; p.kbZ = 0;
      }
    }
  }

  // Monsters are pass-through — you can walk clean into one, and that's the
  // game's feel. But you could also stand INSIDE the dragon, where every attack
  // of hers lands and none of yours can miss. The truly massive carry a solidR:
  // their torso is real and you go round it. (Not while she's overhead — duck
  // under her all you like.)
  for (const e of G.enemies) {
    const r = e.cfg?.solidR;
    if (!r || e.state === 'dead' || e.state === 'inactive') continue;
    const ep = e.obj.position, pp = p.obj.position;
    if (Math.abs(pp.y - ep.y) > 4) continue; // she's in the air
    const dx = pp.x - ep.x, dz = pp.z - ep.z;
    const d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 0.001) { moveWithCollision(pp, r, 0, 0.55, { y: pp.y }); continue; }
    moveWithCollision(pp, (dx / d) * (r - d), (dz / d) * (r - d), 0.55, { y: pp.y });
  }

  // knockback impulse
  if (Math.abs(p.kbX) > 0.1 || Math.abs(p.kbZ) > 0.1) {
    moveWithCollision(p.obj.position, p.kbX * dt, p.kbZ * dt, 0.55, { y: p.obj.position.y });
    p.kbX *= Math.pow(0.02, dt);
    p.kbZ *= Math.pow(0.02, dt);
  }

  if (p.dead) {
    p.deadT += dt;
    updateDeathCam(dt);
    return;
  }

  if (!p.lash) p.mana = Math.min(p.maxMana, p.mana + effectiveManaRegen() * dt);
  p.aiming = !!(G.keys['ShiftLeft'] || G.keys['ShiftRight']);
  if (G.spectate) { spectateBot(p, dt); p.obj.visible = true; p.anim.update(dt); }

  // swinging on a rope replaces normal movement
  if (p.rope) {
    updateRopePhysics(dt);
    if (p.anim.currentName !== 'Jump_Idle') p.anim.play('Jump_Idle');
    p.yaw = p.camYaw + Math.PI;
    p.obj.rotation.y = p.yaw;
    showPrompt('<b>E</b> / <b>SPACE</b> — Let go');
    updateCamera(dt, false);
    updateCrosshairHover();
    p.lastPosSend += dt;
    if (p.lastPosSend > 0.09) sendPos();
    return;
  }

  // GRAVITY LASH: gravity now points at the surface you marked. You FALL
  // onto it, land, and walk its face — the world has turned, for you alone.
  if (p.lash) {
    const g = p.lash.g;
    const pos = p.obj.position;
    // the turned world grants no mana: regen is paused, and if your
    // casting drains the pool to nothing, gravity reclaims you
    if (p.mana <= 0.01) releaseLash(p);
    if (p.lash) {
      if (!p.lash.grounded) {
        p.lash.vel = Math.min(18, (p.lash.vel || 0) + 24 * dt);
        const step = p.lash.vel * dt;
        if (p.lash.up) {
          // falling UPWARD to the vault of the room
          pos.y += step;
          if (pos.y >= LASH_CEIL) {
            pos.y = LASH_CEIL;
            p.lash.grounded = true;
            p.lash.vel = 0;
            sfx.hit();
            addMsg('You stand on the sky — WASD walks the vault, SPACE lets go.');
          }
        } else {
          // falling ALONG the new gravity
          const bx = pos.x, bz = pos.z;
          moveWithCollision(pos, g.x * step, g.z * step, 0.55, { y: pos.y });
          if (Math.hypot(pos.x - bx, pos.z - bz) < step * 0.4) {
            p.lash.grounded = true;
            p.lash.vel = 0;
            sfx.hit();
            addMsg('You land on the surface — WASD walks it, SPACE lets go.');
          }
        }
        // AIR CONTROL: steer while falling, like any other fall. Runs AFTER the
        // gravity step so it can't fool the "did I land?" test above.
        if (!p.lash.grounded) {
          const mv = lashMoveDir(p);
          if (mv) {
            const sp = effectiveSpeed() * 0.55;
            moveWithCollision(pos, mv.x * sp * dt, mv.z * sp * dt, 0.55, { y: pos.y });
            if (!p.lash.up && Math.abs(mv.y) > 0.001) pos.y = lashClampY(pos.y + mv.y * sp * dt, pos.y, 0);
          }
        }
      } else if (p.lash.up) {
        // inverted stroll across the ceiling: free x/z, held to the vault
        const mv = lashMoveDir(p);
        if (mv) {
          const sp = effectiveSpeed() * 0.8;
          moveWithCollision(pos, mv.x * sp * dt, mv.z * sp * dt, 0.55, { y: pos.y });
          p.bobT += dt * sp * 1.35;
        }
        pos.y = LASH_CEIL;
      } else {
        // walking the wall face: camera-look projected onto the surface plane
        const mv = lashMoveDir(p);
        if (mv) {
          const sp = effectiveSpeed() * 0.8;
          moveWithCollision(pos, mv.x * sp * dt, mv.z * sp * dt, 0.55, { y: pos.y });
          const ny = lashClampY(pos.y + mv.y * sp * dt, pos.y);
          // climb only while the wall is still there beside you
          const wx = pos.x, wz = pos.z;
          moveWithCollision(pos, g.x * 0.4, g.z * 0.4, 0.55, { y: ny });
          const wallStillThere = Math.hypot(pos.x - wx, pos.z - wz) < 0.15;
          pos.x = wx; pos.z = wz;
          if (wallStillThere) pos.y = ny;
          p.bobT += dt * sp * 1.35;
        }
        // is the surface still under your feet? probe along gravity: open
        // space means the wall ENDED — you fall anew toward the next one
        const px2 = pos.x, pz2 = pos.z;
        moveWithCollision(pos, g.x * 0.6, g.z * 0.6, 0.55, { y: pos.y });
        const gap = Math.hypot(pos.x - px2, pos.z - pz2);
        if (gap > 0.35) {
          p.lash.grounded = false;
          p.lash.vel = 3;
          addMsg('The surface ends — you fall onward.');
        } else {
          pos.x = px2; pos.z = pz2;
        }
      }
      if (p.attacking) {
        p.attackT += dt;
        const atkTime = effectiveAttackTime();
        if (!p.attackFired && p.attackT >= atkTime * 0.45) { p.attackFired = true; doAttackHit(); }
        if (p.attackT >= atkTime) p.attacking = false;
      }
      showPrompt('<b>SPACE</b> — Release · no mana regen while the world is turned');
      p.yaw = p.camYaw + Math.PI;
      p.obj.rotation.y = p.yaw;
      updateCamera(dt, false);
      updateCrosshairHover();
      p.lastPosSend += dt;
      if (p.lastPosSend > 0.09) sendPos();
      return;
    }
  }
  if (p.swapCritT > 0) p.swapCritT -= dt;
  // Ember Trail: burning footprints
  if (p.trailT > 0) {
    p.trailT -= dt;
    const tpos = p.obj.position;
    if (!p.trailDropAt || Math.hypot(tpos.x - p.trailDropAt.x, tpos.z - p.trailDropAt.z) > 1.1) {
      p.trailDropAt = { x: tpos.x, z: tpos.z };
      G.dropEmber?.(tpos.x, tpos.z, p.trailDmg || 5);
    }
  }

  const k = G.keys;
  let ix = 0, iz = 0;
  if (k['KeyW']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;
  const wantsMove = ix !== 0 || iz !== 0;

  // facing follows the camera in first person
  p.yaw = p.camYaw + Math.PI;

  const pos = p.obj.position;

  if (p.dodgeT > 0) {
    p.dodgeT -= dt;
    const sp = 17 * (p.dodgeT > 0.15 ? 1 : 0.5);
    moveWithCollision(pos, p.dodgeDirX * sp * dt, p.dodgeDirZ * sp * dt, 0.55, { y: pos.y });
  } else {
    if (p.attacking) {
      p.attackT += dt;
      const atkTime = effectiveAttackTime();
      if (!p.attackFired && p.attackT >= atkTime * 0.45) {
        p.attackFired = true;
        doAttackHit();
      }
      if (p.attackT >= atkTime) p.attacking = false;
    }
    if (wantsMove) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      // camera forward is (-sin(yaw), -cos(yaw)); right is (cos(yaw), -sin(yaw))
      const sin = Math.sin(p.camYaw), cos = Math.cos(p.camYaw);
      const wx = ix * cos + iz * sin;
      const wz = -ix * sin + iz * cos;
      const sp = effectiveSpeed() * (p.attacking ? 0.55 : 1);
      const wbx = pos.x, wbz = pos.z;
      moveWithCollision(pos, wx * sp * dt, wz * sp * dt, 0.55, { y: pos.y });
      trackWedge(p, dt, Math.hypot(pos.x - wbx, pos.z - wbz));
      p.bobT += dt * sp * 1.35;
      if (!p.moving) { p.anim.play('Running_A'); p.moving = true; }
    } else if (p.moving) {
      p.anim.play('Idle');
      p.moving = false;
    }
  }

  // gravity & ground snap (platforms, stairs)
  const ground = groundHeightAt(pos.x, pos.z, pos.y);
  if (p.levitateT > 0) {
    // LEVITATE: glide serenely above the stones
    p.levitateT -= dt;
    pos.y += ((ground + 2.6) - pos.y) * Math.min(1, dt * 3);
    p.vy = 0;
    if (Math.random() < dt * 6) spawnBurst(pos.clone().setY(pos.y - 0.4), 0xccaaff, 2, 1, 0.08, 0.4);
  } else if (pos.y > ground + 0.02) {
    // momentum from a rope release carries through the air
    if (p.airVX || p.airVZ) moveWithCollision(pos, p.airVX * dt, p.airVZ * dt, 0.55, { y: pos.y });
    p.vy -= 26 * dt;
    pos.y = Math.max(ground, pos.y + p.vy * dt);
    if (pos.y === ground) { p.vy = 0; p.airVX = 0; p.airVZ = 0; }
  } else if (ground > pos.y) {
    // Stick to ramps while climbing. groundHeightAt only ever offers a surface
    // you can actually reach (its own gates cap it at curY + 1.7), so ALWAYS
    // rise to it. The old `<= 1.6` guard was narrower than the 1.7 a build ramp
    // can offer, and a ramp landing in that 0.1 gap left you embedded in it
    // forever — not lifted, not dropped, vy never even reset.
    pos.y = ground;
    p.vy = 0;
  } else {
    p.vy = 0;
  }

  p.obj.rotation.y = p.yaw;

  updateInteractPrompt();
  updateCamera(dt, wantsMove);
  updateCrosshairHover();

  p.lastPosSend += dt;
  if (p.lastPosSend > 0.09) sendPos();
}

export function sendPos(force = false) {
  const p = G.player;
  if (G.net.role === 'solo' || !p) return;
  p.lastPosSend = 0;
  netSend({
    t: 'pos', f: G.floor,
    x: +p.obj.position.x.toFixed(2), y: +p.obj.position.y.toFixed(2), z: +p.obj.position.z.toFixed(2),
    yaw: +p.yaw.toFixed(2),
    anim: p.anim.currentName,
    hp: p.hp, mhp: p.maxHp, dead: p.dead,
    ln: p.lash ? (p.lash.up ? [0, -1, 0] : [-p.lash.g.x, 0, -p.lash.g.z]) : 0,
  });
}

// ---------- combat ----------
function aimDir() {
  const v = new THREE.Vector3();
  G.camera.getWorldDirection(v);
  return v;
}

// something at her throat: is any foe inside dagger reach of the front arc?
function meleeTargetInReach() {
  const p = G.player;
  if (!p) return false;
  const within = (ox, oz, oy, bodyR) => {
    const dx = ox - p.obj.position.x, dz = oz - p.obj.position.z;
    const d = Math.hypot(dx, dz);
    if (d - bodyR > 2.6 || Math.abs(oy - p.obj.position.y) > 2.2) return false;
    let ang = Math.atan2(dx, dz) - p.yaw;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    return Math.abs(ang) <= 1.3;
  };
  for (const e of G.enemies) {
    if (e.state === 'dead') continue;
    if (within(e.obj.position.x, e.obj.position.z, e.obj.position.y, e.cfg.bodyR || 0)) return true;
  }
  if (G.runMode === 'duel') {
    for (const r of G.remotes.values()) {
      if (r.dead || r.floor !== G.floor) continue;
      if (within(r.obj.position.x, r.obj.position.z, r.obj.position.y, 0)) return true;
    }
  }
  return false;
}

// Is there stone between us? Melee had NO line-of-sight test — only distance and
// a yaw arc — so any enemy with a bodyR could be hit clean through a wall.
// Emberwing (bodyR 4.5, boss ×1.4 range) was meleeable from 9+ units away with a
// wall in between, which is a free boss kill.
// We sight the point on her BODY that faces us, not her origin: a monster that
// wide can have her centre behind a pillar while her flank is in your face.
function canReach(p, e) {
  const px = p.obj.position.x, pz = p.obj.position.z;
  const ex = e.obj.position.x, ez = e.obj.position.z;
  const dx = ex - px, dz = ez - pz;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  const back = Math.min(e.cfg?.bodyR || 0, d - 0.05);
  return hasLineOfSight(px, pz, ex - (dx / d) * back, ez - (dz / d) * back);
}

// too close to draw the string — the off-hand dagger answers instead
function offhandDaggerSwipe(p, dmg, wfx) {
  const swipe = Math.max(1, Math.round(dmg * 0.6));
  sfx.swing();
  if (G.runMode === 'duel') {
    for (const [pid, r] of G.remotes) {
      if (r.dead || r.floor !== G.floor) continue;
      const dx = r.obj.position.x - p.obj.position.x;
      const dz = r.obj.position.z - p.obj.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || Math.abs(r.obj.position.y - p.obj.position.y) > 2.2) continue;
      let ang = Math.atan2(dx, dz) - p.yaw;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > 1.3) continue;
      const crit = Math.random() < effectiveCrit();
      netSend({ t: 'pvp', target: pid, dmg: crit ? Math.round(swipe * 1.8) : swipe, by: p.name });
      notifyHit(crit);
    }
  }
  let landed = false;
  for (const e of G.enemies) {
    if (e.state === 'dead') continue;
    const dx = e.obj.position.x - p.obj.position.x;
    const dz = e.obj.position.z - p.obj.position.z;
    const d = Math.hypot(dx, dz);
    if (d - (e.cfg.bodyR || 0) > 2.6) continue;
    if (Math.abs(e.obj.position.y - p.obj.position.y) > 2.2) continue;
    let ang = Math.atan2(dx, dz) - p.yaw;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > 1.3) continue;
    if (!canReach(p, e)) continue; // no swinging through stone
    const hit = crit4(swipe);
    damageEnemy(e, hit.v, hit.crit, false, 'local', wfx);
    landed = true;
  }
  if (landed) { addSigCharge(1); sfx.hit(); }
}

function doAttackHit() {
  const p = G.player;
  const cls = p.cls;
  const dmg = effectiveDamage();
  const dir = aimDir();
  const wfx = weaponHitEffects(dmg);
  // arrows fly only from a bow/crossbow in hand; the mage's bolt is innate mana
  const rangedAtk = G.inv.weapon?.ranged || !!cls.manaAttack;
  if (rangedAtk) {
    if (G.inv.weapon?.ranged && meleeTargetInReach()) {
      offhandDaggerSwipe(p, dmg, wfx);
      return;
    }
    if (G.inv.weapon?.ranged) {
      if ((G.run.arrows || 0) <= 0) return;
      G.run.arrows--;
      refreshHud();
    }
    // mage bolts burn mana and scale with what was actually spent: a full-cost
    // shot is a cannonball, a dry-tank shot is a feeble cantrip spark
    let boltDmg = dmg, boltSize = 1;
    if (cls.manaAttack && !G.inv.weapon?.ranged) {
      const fullCost = Math.ceil(p.maxMana * cls.manaAttack);
      const spend = Math.min(p.mana, fullCost);
      p.mana -= spend;
      const mult = 0.25 + 0.75 * (spend / fullCost);
      boltDmg = Math.max(1, Math.round(dmg * mult));
      boltSize = 0.6 + mult * 0.9;
    }
    const spread = p.aiming ? 0 : 0.035;
    const sx = (Math.random() - 0.5) * spread, sy = (Math.random() - 0.5) * spread, sz = (Math.random() - 0.5) * spread;
    const b = {
      x: p.obj.position.x + dir.x * 0.7, z: p.obj.position.z + dir.z * 0.7, y: p.obj.position.y + 1.45,
      dirX: dir.x + sx, dirY: dir.y + sy, dirZ: dir.z + sz,
      speed: G.inv.weapon?.ranged ? 28 : 20, dmg: boltDmg, size: boltSize, owner: 'player', basic: true,
      color: G.inv.weapon?.ranged ? 0xddcc99 : (p.cls.boltColor || 0xff8833),
      vis: G.inv.weapon?.ranged ? 'arrow' : (p.cls.boltVis || 'fire'),
      slow: wfx?.slow || null, poison: wfx?.poison || null, lifesteal: wfx?.lifesteal || 0,
    };
    spawnBolt(b);
    sfx.bolt();
    netSend({ t: 'bolt', f: G.floor, b: { ...b, owner: 'fx' } });
    return;
  }
  sfx.swing();
  // Duel: blades find other players
  if (G.runMode === 'duel') {
    for (const [pid, r] of G.remotes) {
      if (r.dead || r.floor !== G.floor) continue;
      const dx = r.obj.position.x - p.obj.position.x;
      const dz = r.obj.position.z - p.obj.position.z;
      const d = Math.hypot(dx, dz);
      if (d > cls.attackRange || Math.abs(r.obj.position.y - p.obj.position.y) > 2.2) continue;
      let ang = Math.atan2(dx, dz) - p.yaw;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > cls.attackArc) continue;
      const crit = Math.random() < effectiveCrit();
      netSend({ t: 'pvp', target: pid, dmg: crit ? Math.round(dmg * 1.8) : dmg, by: p.name });
      notifyHit(crit);
    }
  }
  let landed = false;
  for (const e of G.enemies) {
    if (e.state === 'dead') continue;
    const dx = e.obj.position.x - p.obj.position.x;
    const dz = e.obj.position.z - p.obj.position.z;
    const d = Math.hypot(dx, dz);
    if (d - (e.cfg.bodyR || 0) > effectiveAttackRange() * (e.boss ? 1.4 : 1)) continue;
    if (Math.abs(e.obj.position.y - p.obj.position.y) > 2.2) continue;
    let ang = Math.atan2(dx, dz) - p.yaw;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > effectiveAttackArc()) continue;
    if (!canReach(p, e)) continue; // no swinging through stone
    let hitDmg = crit4(dmg);
    if (p.swapCritT > 0) { hitDmg = { v: Math.round(dmg * 2), crit: true }; p.swapCritT = 0; }
    damageEnemy(e, hitDmg.v, hitDmg.crit, false, 'local', wfx);
    landed = true;
  }
  if (landed) addSigCharge(1);
}

function crit4(dmg) {
  const crit = Math.random() < effectiveCrit();
  return { v: crit ? Math.round(dmg * 1.8) : dmg, crit };
}

export function tryAttack() {
  const p = G.player;
  if (!p || p.dead || p.attacking || p.dodgeT > 0 || G.mode !== 'playing') return;
  // a foe at knife range means the dagger comes out — no arrow needed
  const daggerReach = !!G.inv.weapon?.ranged && meleeTargetInReach();
  if (G.inv.weapon?.ranged && !daggerReach && (G.run.arrows || 0) <= 0) {
    addMsg('Out of cells! Buy more at the Armory or Crew Deck.', 'bad');
    return;
  }
  p.attacking = true;
  p.attackT = 0;
  p.attackFired = false;
  const atkTime = daggerReach ? 0.5 : effectiveAttackTime();
  let animName;
  if (daggerReach) animName = p.anim.has('1H_Melee_Attack_Slice_Horizontal') ? '1H_Melee_Attack_Slice_Horizontal' : p.cls.attackAnims[0];
  else if (G.inv.weapon?.ranged && p.anim.has('2H_Ranged_Shoot')) animName = '2H_Ranged_Shoot';
  else animName = p.cls.attackAnims[p.attackIdx % p.cls.attackAnims.length];
  p.attackIdx++;
  const act = p.anim.play(animName, { once: true });
  if (act) act.timeScale = act.getClip().duration / atkTime;
  if (daggerReach) triggerOffhandStab(0.45);
  else triggerSwing('attack', atkTime * 0.9);
  p.moving = false;
}

// Space: jump (grounded), or let go of a rope
export function tryDodge() {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'playing') return;
  if (p.lash) { releaseLash(p); return; }
  if (p.rope) { releaseRope(1.3); return; }
  const ground = groundHeightAt(p.obj.position.x, p.obj.position.z, p.obj.position.y);
  if (p.obj.position.y <= ground + 0.08) {
    p.vy = 9;
    p.obj.position.y = ground + 0.1;
    sfx.dodge();
  }
}

// ---------- interaction ----------
let interactTarget = null;
function updateInteractPrompt() {
  const p = G.player;
  interactTarget = null;
  const rope = nearestRope(p.obj.position);
  if (rope) {
    showPrompt('<b>E</b> — Grab the rope');
    interactTarget = { kind: 'rope', rope };
    return;
  }
  // town doors (street <-> shop interiors)
  const door = nearestDoor(p.obj.position);
  if (door) {
    showPrompt(`<b>E</b> — ${door.label}`);
    interactTarget = { kind: 'door', door };
    return;
  }
  // claimable houses
  const home = nearestHomeDoor(p.obj.position);
  if (home) {
    const mine = localStorage.getItem('codeyellow_home');
    if (mine === null) showPrompt('<b>E</b> — Claim this house');
    else if (+mine === home.idx) showPrompt('<b>E</b> — Your stash');
    else showPrompt('A neighbour lives here');
    if (mine === null || +mine === home.idx) {
      interactTarget = { kind: 'home', home };
      return;
    }
  }
  // town shopkeepers & the notice board
  const keeper = nearestShopkeeper(p.obj.position);
  if (keeper) {
    showPrompt(`<b>E</b> — ${keeper.label}`);
    interactTarget = { kind: 'shop', shop: keeper.shop };
    return;
  }
  const s = G.grid.stairs;
  if (p.obj.position.y < 1 && Math.hypot(p.obj.position.x - s.x, p.obj.position.z - s.z) < 2.6) {
    if (G.grid.stairsLocked) {
      showPrompt('Defeat the boss to descend');
    } else {
      showPrompt(G.grid.town ? '<b>E</b> — Enter the dungeon' : '<b>E</b> — The way onward');
      interactTarget = { kind: 'stairs' };
    }
    return;
  }
  const chest = nearestChest(p.obj.position);
  if (chest) {
    if (chest.kind === 'goldchest' && G.run.keys < 1) showPrompt('Golden chest — needs a key');
    else showPrompt(`<b>E</b> — Open ${chest.kind === 'goldchest' ? 'golden ' : ''}chest`);
    interactTarget = { kind: 'chest', chest };
    return;
  }
  const drop = nearestItemDrop(p.obj.position);
  if (drop) {
    showPrompt(`<b>E</b> — Take <span style="color:${drop.itemColor}">${drop.item.name}</span>`);
    interactTarget = { kind: 'drop', drop };
    return;
  }
  hidePrompt();
}

export function tryInteract(onStairs, onShop, onHome) {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'playing') return;
  if (p.rope) { releaseRope(); return; }
  if (!interactTarget) return;
  if (interactTarget.kind === 'rope') {
    grabRope(interactTarget.rope);
  } else if (interactTarget.kind === 'door') {
    useDoor(interactTarget.door);
  } else if (interactTarget.kind === 'shop') {
    onShop?.(interactTarget.shop);
  } else if (interactTarget.kind === 'home') {
    onHome?.(interactTarget.home);
  } else if (interactTarget.kind === 'stairs') {
    onStairs();
  } else if (interactTarget.kind === 'chest') {
    const c = interactTarget.chest;
    if (c.kind === 'goldchest' && G.run.keys < 1) return;
    takeLoot(G.floor, c.id, 'local');
  } else if (interactTarget.kind === 'drop') {
    takeLoot(G.floor, interactTarget.drop.id, 'local');
  }
}

// ---------- first-person camera ----------
const _lashFwd = new THREE.Vector3();
const _lashUp = new THREE.Vector3();
const _lashRight = new THREE.Vector3();
const _lashMove = new THREE.Vector3();

const LASH_CEIL = 8; // the height of the unseen vault you can stand on

// WASD mapped into the plane PERPENDICULAR to the lash gravity — the same basis
// whether you're walking the surface or still falling toward it. Returns null
// when there's no input. The result's .y is the climb component.
function lashMoveDir(p) {
  const k = G.keys;
  let ix = 0, iz = 0;
  if (k['KeyW']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;
  if (!ix && !iz) return null;
  G.camera.getWorldDirection(_lashFwd);
  if (p.lash.up) {
    _lashFwd.y = 0;
    if (_lashFwd.lengthSq() < 0.01) return null;
    _lashFwd.normalize();
    _lashRight.set(-_lashFwd.z, 0, _lashFwd.x);
    _lashMove.copy(_lashFwd).multiplyScalar(-iz).addScaledVector(_lashRight, -ix); // flipped handedness, hanging
  } else {
    const g = p.lash.g;
    _lashUp.set(-g.x, 0, -g.z);
    _lashRight.crossVectors(_lashFwd, _lashUp).normalize();
    _lashMove.copy(_lashFwd).multiplyScalar(-iz).addScaledVector(_lashRight, ix);
    // strip the component INTO the wall, keep the surface-plane part
    const into = _lashMove.x * g.x + _lashMove.z * g.z;
    _lashMove.x -= g.x * into; _lashMove.z -= g.z * into;
  }
  if (_lashMove.lengthSq() < 0.001) return null;
  return _lashMove.normalize();
}

// Climbing is capped at LASH_WALK_CEIL, but never YANK someone who lashed above
// it back down — clamp against their own height instead. minY is 0.3 on a wall
// (feet clear of the floor) but 0 in flight, so a ground-level lash doesn't pop
// you up as soon as you steer.
const LASH_WALK_CEIL = 11;
function lashClampY(y, curY, minY = 0.3) {
  return Math.max(minY, Math.min(Math.max(LASH_WALK_CEIL, curY), y));
}

export function releaseLash(p) {
  if (!p.lash) return;
  p.lash = null;
  p.vy = 0;
  hidePrompt();
  addMsg('The world rights itself.');
}

const _specMid = new THREE.Vector3();
const _qFrame = new THREE.Quaternion();
const _qLook = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _vUp = new THREE.Vector3();

function updateCamera(dt, moving) {
  const p = G.player;
  const cam = G.camera;
  // spectator: a slow orbit around the duel
  if (G.spectate) {
    const d = G.enemies.find(e => e.cfg.dragon && e.state !== 'dead');
    const a = d ? d.obj.position : p.obj.position;
    const b = p.obj.position;
    _specMid.set((a.x + b.x) / 2, Math.max(a.y, b.y) * 0.5 + 4, (a.z + b.z) / 2);
    G.specT = (G.specT || 0) + dt * 0.1;
    // during slow-mo beats the camera DIVES IN like a cutscene
    p.specZoom = p.specZoom ?? 0;
    p.specZoom += ((G.slowmo > 0 ? 1 : 0) - p.specZoom) * Math.min(1, dt * 2.5);
    const r = 22 - p.specZoom * 10;
    const h = 8 - p.specZoom * 4;
    cam.position.set(_specMid.x + Math.cos(G.specT) * r, _specMid.y + h, _specMid.z + Math.sin(G.specT) * r);
    if (G.shake > 0.01) {
      G.shake *= Math.pow(0.05, dt);
      cam.position.x += (Math.random() - 0.5) * G.shake * 0.5;
      cam.position.y += (Math.random() - 0.5) * G.shake * 0.4;
    }
    cam.lookAt(_specMid);
    return;
  }
  const bob = moving && p.dodgeT <= 0 ? Math.sin(p.bobT) * 0.055 : 0;
  cam.position.set(p.obj.position.x, p.obj.position.y + EYE + bob, p.obj.position.z);
  // earth-shaking moments (dragon roars, landings)
  if (G.shake > 0.01) {
    G.shake *= Math.pow(0.05, dt);
    cam.position.x += (Math.random() - 0.5) * G.shake * 0.35;
    cam.position.y += (Math.random() - 0.5) * G.shake * 0.3;
    cam.position.z += (Math.random() - 0.5) * G.shake * 0.35;
  }
  // Gravity Lash: the body itself is TURNED — the eye extends along the new
  // "up" (out from the wall / down from the ceiling), and the world rolls.
  p.lashBlend = p.lashBlend ?? 0;
  const lashN = p.lash ? (p.lash.up ? { x: 0, y: -1, z: 0 } : { x: -p.lash.g.x, y: 0, z: -p.lash.g.z }) : null;
  const wantBlend = lashN ? 1 : 0;
  p.lashBlend += (wantBlend - p.lashBlend) * Math.min(1, dt * 3.5);
  // The VIEW rolls the moment you cast — but the EYE must not swing onto the new
  // "up" until you have actually LANDED on the surface. A wall's up is
  // horizontal (n.y = 0), so blending the eye onto it while you're still falling
  // collapses the eye to your feet — and your feet are still on the floor, so
  // the camera sinks into the ground until you land.
  p.lashEye = p.lashEye ?? 0;
  const wantEye = p.lash?.grounded ? 1 : 0;
  p.lashEye += (wantEye - p.lashEye) * Math.min(1, dt * 3.5);
  if (p.lashBlend > 0.01 && (lashN || p.lastLashN)) {
    const n = lashN || p.lastLashN;
    if (lashN) p.lastLashN = n;
    // the eye sits 1.6u along the TURNED up — out from the wall, not skyward
    const be = p.lashEye;
    cam.position.set(
      p.obj.position.x + (n.x || 0) * EYE * be,
      p.obj.position.y + (EYE + bob) * (1 - be) + (n.y || 0) * EYE * be,
      p.obj.position.z + (n.z || 0) * EYE * be
    );
    _vUp.set(n.x, n.y || 0, n.z);
    if (_vUp.lengthSq() < 0.01) _vUp.set(0, 1, 0);
    _vUp.normalize();
    _qFrame.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _vUp);
    _qFrame.slerp(new THREE.Quaternion(), 1 - p.lashBlend); // identity when not lashed
    _eul.set(p.camPitch, p.camYaw, 0, 'YXZ');
    _qLook.setFromEuler(_eul);
    cam.quaternion.copy(_qFrame).multiply(_qLook);
  } else {
    cam.rotation.set(p.camPitch, p.camYaw, 0, 'YXZ');
    p.lastLashN = null;
  }
  // aim zoom
  const targetFov = p.aiming ? AIM_FOV : BASE_FOV;
  if (Math.abs(cam.fov - targetFov) > 0.1) {
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 10);
    cam.updateProjectionMatrix();
  }
}

function updateDeathCam(dt) {
  const p = G.player;
  const cam = G.camera;
  const a = p.deadT * 0.35 + p.camYaw;
  const dist = Math.min(7, 3 + p.deadT * 1.5);
  cam.position.set(
    p.obj.position.x + Math.sin(a) * dist,
    p.obj.position.y + 3.2,
    p.obj.position.z + Math.cos(a) * dist,
  );
  cam.lookAt(p.obj.position.x, p.obj.position.y + 0.6, p.obj.position.z);
}

export function onMouseMove(dx, dy) {
  const p = G.player;
  if (!p || p.dead) return;
  const sens = p.aiming ? 0.0013 : 0.0023;
  p.camYaw -= dx * sens;
  p.camPitch = Math.min(1.45, Math.max(-1.45, p.camPitch - dy * sens));
}

// crosshair turns hostile when an enemy is under it
function updateCrosshairHover() {
  const p = G.player;
  const dir = aimDir();
  const eye = new THREE.Vector3(p.obj.position.x, p.obj.position.y + EYE, p.obj.position.z);
  let hostile = false;
  for (const e of G.enemies) {
    if (e.state === 'dead' || e.state === 'inactive') continue;
    const to = e.obj.position.clone().setY(e.obj.position.y + 1.1 * e.scale).sub(eye);
    const d = to.length();
    if (d > 30) continue;
    if (to.normalize().angleTo(dir) < Math.atan2(1.0 * e.scale, d)) { hostile = true; break; }
  }
  setCrosshairHostile(hostile);
}

export function notifyHit(crit) { hitmarker(crit); }

// ---------- remote players ----------
export function addRemotePlayer(pid, name, classId, look, equip) {
  if (G.remotes.has(pid)) return G.remotes.get(pid);
  const cls = CLASSES[classId] || CLASSES.knight;
  const lk = look || { cape: true, helmet: true, capeColor: 0 };
  const modelName = cls.model;
  const { obj, anim } = makeCharacter('char', modelName, equip || cls.show);
  applyLook(obj, lk);
  obj.scale.setScalar(cls.scale || 1);
  obj.add(makeBlobShadow(0.85 / (cls.scale || 1)));
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px Trebuchet MS';
  g.textAlign = 'center';
  g.strokeStyle = '#000'; g.lineWidth = 5;
  g.strokeText(name, 128, 32);
  g.fillStyle = '#ffd9a8';
  g.fillText(name, 128, 32);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  tag.scale.set(2.6, 0.5, 1);
  tag.position.y = 2.6;
  obj.add(tag);
  G.scene.add(obj);
  const r = { pid, name, classId, cls, obj, anim, netX: 0, netY: 0, netZ: 0, netYaw: 0, hp: cls.hp, maxHp: cls.hp, dead: false, lastAnim: 'Idle', floor: 1 };
  anim.play('Idle');
  G.remotes.set(pid, r);
  updatePartyBar();
  return r;
}

export function removeRemotePlayer(pid) {
  const r = G.remotes.get(pid);
  if (!r) return;
  G.scene.remove(r.obj);
  G.remotes.delete(pid);
  updatePartyBar();
}

export function applyRemoteEquip(pid, meshes, held, held2) {
  const r = G.remotes.get(pid);
  if (!r) return;
  setEquipMeshes(r.obj, meshes);
  attachHeldWeapon(r.obj, held, held2);
}

export function updateRemotes(dt) {
  for (const r of G.remotes.values()) {
    if (r.floor !== G.floor) {
      // hidden on another floor — keep position current (enemy AI there needs it)
      r.obj.position.set(r.netX, r.netY, r.netZ);
      continue;
    }
    r.anim.update(dt);
    r.obj.position.x += (r.netX - r.obj.position.x) * Math.min(1, dt * 12);
    r.obj.position.y += (r.netY - r.obj.position.y) * Math.min(1, dt * 12);
    r.obj.position.z += (r.netZ - r.obj.position.z) * Math.min(1, dt * 12);
    if (r.lashN) {
      // a lashed teammate's whole BODY tips onto the surface they walk
      _rUp.set(r.lashN[0], r.lashN[1], r.lashN[2]).normalize();
      _rq.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _rUp);
      _rEul.set(0, r.netYaw, 0, 'YXZ');
      _rq2.setFromEuler(_rEul);
      _rq.multiply(_rq2);
      r.obj.quaternion.slerp(_rq, Math.min(1, dt * 5));
    } else if (Math.abs(r.obj.rotation.x) > 0.01 || Math.abs(r.obj.rotation.z) > 0.01) {
      // ease back upright after a lash ends
      _rEul.set(0, r.netYaw, 0, 'YXZ');
      _rq.setFromEuler(_rEul);
      r.obj.quaternion.slerp(_rq, Math.min(1, dt * 5));
    } else {
      let dy = r.netYaw - r.obj.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      r.obj.rotation.y += dy * Math.min(1, dt * 12);
    }
  }
}
const _rUp = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rq2 = new THREE.Quaternion();
const _rEul = new THREE.Euler();

// hide teammates who are on a different floor
export function refreshRemoteVisibility() {
  for (const r of G.remotes.values()) r.obj.visible = r.floor === G.floor;
}

export function applyRemotePos(pid, m) {
  const r = G.remotes.get(pid);
  if (!r) return;
  const f = m.f ?? r.floor;
  if (f !== r.floor) {
    r.floor = f;
    // snap so they don't slide across the map after a floor change
    r.obj.position.set(m.x, m.y || 0, m.z);
    r.obj.visible = f === G.floor;
  }
  r.netX = m.x; r.netY = m.y || 0; r.netZ = m.z; r.netYaw = m.yaw;
  r.lashN = m.ln || null;
  r.hp = m.hp; r.maxHp = m.mhp;
  if (m.dead && !r.dead) { r.dead = true; r.anim.play('Death_A', { once: true, clamp: true }); }
  if (!m.dead && r.dead) { r.dead = false; r.anim.play('Idle'); }
  if (!r.dead && m.anim && m.anim !== r.lastAnim) {
    r.lastAnim = m.anim;
    const oneShot = m.anim.includes('Attack') || m.anim.includes('Dodge') || m.anim.includes('Use_Item') || m.anim.includes('Interact') || m.anim.includes('Spellcast') || m.anim.includes('Block');
    r.anim.play(m.anim, oneShot ? { once: true } : {});
  }
  updatePartyBar();
}

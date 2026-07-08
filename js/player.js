// Local player: FIRST-PERSON controller — mouse look, aim (shift), gravity & climbing,
// melee/ranged combat, spells, dodge dash, potions, XP/levels, traps, death cam.
// Remote player avatars (full 3D models) are also maintained here.
import * as THREE from 'three';
import { G } from './state.js';
import { CLASSES, XP_FOR_LEVEL, CAPE_COLORS } from './config.js';
import { makeCharacter, setEquipMeshes, applyLook } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision, groundHeightAt } from './dungeon.js';
import { spawnBolt } from './projectiles.js';
import { damageEnemy } from './enemies.js';
import { gearStat, weaponDamage, equippedMeshes, affixOf } from './items.js';
import { addMsg, refreshHud, showPrompt, hidePrompt, flashVignette, updatePartyBar, hitmarker, setCrosshairHostile } from './ui.js';
import { netSend } from './net.js';
import { nearestChest, takeLoot, nearestItemDrop } from './loot.js';

const EYE = 1.62;
const BASE_FOV = 66, AIM_FOV = 44;

export function createPlayer(classId, name) {
  const cls = CLASSES[classId];
  const modelName = classId === 'rogue' && G.look.helmet ? 'Rogue_Hooded' : cls.model;
  const { obj, anim } = makeCharacter('char', modelName, cls.show);
  applyLook(obj, G.look);
  obj.visible = false; // first person: own body hidden until death cam
  G.scene.add(obj);
  // warm lantern glow that follows the hero
  const lantern = new THREE.PointLight(0xffb066, 14, 13, 1.7);
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
    trapCd: 0, lastPosSend: 0,
  };
  anim.play('Idle');
  G.player = p;
  refreshEquipVisuals();
  return p;
}

export function refreshEquipVisuals() {
  const p = G.player;
  if (!p) return;
  const meshes = equippedMeshes(p.classId);
  setEquipMeshes(p.obj, meshes);
  p.maxHp = effectiveMaxHp();
  p.hp = Math.min(p.hp, p.maxHp);
  netSend({ t: 'equip', meshes });
  refreshHud();
}

export function resetPlayerForFloor() {
  const p = G.player;
  p.obj.position.set(G.grid.spawn.x, 0, G.grid.spawn.z);
  p.vy = 0;
  p.obj.visible = false;
  if (p.dead) { p.dead = false; p.hp = Math.round(p.maxHp * 0.6); }
  p.attacking = false;
  p.anim.play('Idle');
}

// ---------- stats (class + level + run bonuses + gear + buffs) ----------
export function effectiveDamage() {
  const p = G.player;
  let d = weaponDamage(p.cls) + G.run.atkBonus + (G.run.level - 1) * 2;
  if (p.buff) d *= p.buff.dmgMult;
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
  const af = affixOf(G.inv.weapon);
  const fx = {};
  if (af?.burn) fx.poison = { dps: Math.max(2, Math.round(dmg * af.burn.mult)), dur: af.burn.dur };
  if (af?.slow) fx.slow = af.slow;
  let steal = af?.lifesteal || 0;
  if (G.player.buff?.lifesteal) steal += G.player.buff.lifesteal;
  if (steal) fx.lifesteal = steal;
  return Object.keys(fx).length ? fx : null;
}
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
    addMsg(`⭐ Level ${G.run.level}! Fully healed.`, 'gold');
    spawnBurst(p.obj.position.clone().setY(p.obj.position.y + 1.2), 0xffd35c, 24, 6, 0.16, 0.9);
  }
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

function die() {
  const p = G.player;
  p.dead = true;
  p.deadT = 0;
  p.attacking = false;
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
  sfx.potion();
  spawnBurst(p.obj.position.clone().setY(p.obj.position.y + 1.4), 0x44ff77, 14, 4, 0.13);
  addMsg('You drink a potion 🧪');
  refreshHud();
}

// ---------- per-frame update ----------
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

  p.mana = Math.min(p.maxMana, p.mana + effectiveManaRegen() * dt);
  p.aiming = !!(G.keys['ShiftLeft'] || G.keys['ShiftRight']);

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
      moveWithCollision(pos, wx * sp * dt, wz * sp * dt, 0.55, { y: pos.y });
      p.bobT += dt * sp * 1.35;
      if (!p.moving) { p.anim.play('Running_A'); p.moving = true; }
    } else if (p.moving) {
      p.anim.play('Idle');
      p.moving = false;
    }
  }

  // gravity & ground snap (platforms, stairs)
  const ground = groundHeightAt(pos.x, pos.z, pos.y);
  if (pos.y > ground + 0.02) {
    p.vy -= 26 * dt;
    pos.y = Math.max(ground, pos.y + p.vy * dt);
    if (pos.y === ground) p.vy = 0;
  } else if (ground > pos.y) {
    if (ground - pos.y <= 1.6) { pos.y = ground; p.vy = 0; } // stick to ramps while climbing
  } else {
    p.vy = 0;
  }

  p.obj.rotation.y = p.yaw;

  checkTraps();
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
  });
}

// ---------- combat ----------
function aimDir() {
  const v = new THREE.Vector3();
  G.camera.getWorldDirection(v);
  return v;
}

function doAttackHit() {
  const p = G.player;
  const cls = p.cls;
  const dmg = effectiveDamage();
  const dir = aimDir();
  const wfx = weaponHitEffects(dmg);
  const rangedAtk = cls.ranged || G.inv.weapon?.ranged;
  if (rangedAtk) {
    // basic bolt is free; slight spread unless aiming
    const spread = p.aiming ? 0 : 0.035;
    const sx = (Math.random() - 0.5) * spread, sy = (Math.random() - 0.5) * spread, sz = (Math.random() - 0.5) * spread;
    const b = {
      x: p.obj.position.x + dir.x * 0.7, z: p.obj.position.z + dir.z * 0.7, y: p.obj.position.y + 1.45,
      dirX: dir.x + sx, dirY: dir.y + sy, dirZ: dir.z + sz,
      speed: G.inv.weapon?.ranged ? 26 : 20, dmg, owner: 'player',
      color: G.inv.weapon?.ranged ? 0xddcc99 : 0xff8833,
      slow: wfx?.slow || null, poison: wfx?.poison || null, lifesteal: wfx?.lifesteal || 0,
    };
    spawnBolt(b);
    sfx.bolt();
    netSend({ t: 'bolt', f: G.floor, b: { ...b, owner: 'fx' } });
    return;
  }
  sfx.swing();
  for (const e of G.enemies) {
    if (e.state === 'dead') continue;
    const dx = e.obj.position.x - p.obj.position.x;
    const dz = e.obj.position.z - p.obj.position.z;
    const d = Math.hypot(dx, dz);
    if (d > cls.attackRange * (e.boss ? 1.4 : 1)) continue;
    if (Math.abs(e.obj.position.y - p.obj.position.y) > 2.2) continue;
    let ang = Math.atan2(dx, dz) - p.yaw;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > cls.attackArc) continue;
    const crit = Math.random() < effectiveCrit();
    damageEnemy(e, crit ? Math.round(dmg * 1.8) : dmg, crit, false, 'local', wfx);
  }
}

export function tryAttack() {
  const p = G.player;
  if (!p || p.dead || p.attacking || p.dodgeT > 0 || G.mode !== 'playing') return;
  p.attacking = true;
  p.attackT = 0;
  p.attackFired = false;
  const atkTime = effectiveAttackTime();
  let animName;
  if (G.inv.weapon?.ranged && p.anim.has('2H_Ranged_Shoot')) animName = '2H_Ranged_Shoot';
  else animName = p.cls.attackAnims[p.attackIdx % p.cls.attackAnims.length];
  p.attackIdx++;
  const act = p.anim.play(animName, { once: true });
  if (act) act.timeScale = act.getClip().duration / atkTime;
  p.moving = false;
}

export function tryDodge() {
  const p = G.player;
  if (!p || p.dead || p.dodgeCd > 0 || p.dodgeT > 0 || G.mode !== 'playing') return;
  const k = G.keys;
  let ix = 0, iz = 0;
  if (k['KeyW']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;
  if (ix === 0 && iz === 0) iz = -1;
  const len = Math.hypot(ix, iz);
  ix /= len; iz /= len;
  const sin = Math.sin(p.camYaw), cos = Math.cos(p.camYaw);
  p.dodgeDirX = ix * cos + iz * sin;
  p.dodgeDirZ = -ix * sin + iz * cos;
  p.dodgeT = 0.4;
  p.dodgeCd = 1.15;
  p.iframes = 0.45;
  p.attacking = false;
  sfx.dodge();
}

function checkTraps() {
  const p = G.player;
  if (p.trapCd > 0 || p.iframes > 0 || p.obj.position.y > 0.6) return;
  for (const t of G.traps) {
    if (Math.abs(p.obj.position.x - t.x) < 1.6 && Math.abs(p.obj.position.z - t.z) < 1.6) {
      p.trapCd = 1.2;
      sfx.trap();
      damageLocalPlayer(Math.round(6 + G.floor * 1.5));
      addMsg('Spikes! Watch your step.', 'bad');
      return;
    }
  }
}

// ---------- interaction ----------
let interactTarget = null;
function updateInteractPrompt() {
  const p = G.player;
  interactTarget = null;
  const s = G.grid.stairs;
  if (p.obj.position.y < 1 && Math.hypot(p.obj.position.x - s.x, p.obj.position.z - s.z) < 2.6) {
    if (G.grid.stairsLocked) {
      showPrompt('🔒 Defeat the boss to descend');
    } else {
      showPrompt('<b>E</b> — Descend deeper');
      interactTarget = { kind: 'stairs' };
    }
    return;
  }
  const chest = nearestChest(p.obj.position);
  if (chest) {
    if (chest.kind === 'goldchest' && G.run.keys < 1) showPrompt('🔒 Golden chest — needs a key');
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

export function tryInteract(onStairs) {
  const p = G.player;
  if (!p || p.dead || !interactTarget || G.mode !== 'playing') return;
  if (interactTarget.kind === 'stairs') {
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
function updateCamera(dt, moving) {
  const p = G.player;
  const cam = G.camera;
  const bob = moving && p.dodgeT <= 0 ? Math.sin(p.bobT) * 0.055 : 0;
  cam.position.set(p.obj.position.x, p.obj.position.y + EYE + bob, p.obj.position.z);
  cam.rotation.set(p.camPitch, p.camYaw, 0, 'YXZ');
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
  const modelName = classId === 'rogue' && lk.helmet ? 'Rogue_Hooded' : cls.model;
  const { obj, anim } = makeCharacter('char', modelName, equip || cls.show);
  applyLook(obj, lk);
  obj.add(makeBlobShadow(0.85));
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

export function applyRemoteEquip(pid, meshes) {
  const r = G.remotes.get(pid);
  if (r) setEquipMeshes(r.obj, meshes);
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
    let dy = r.netYaw - r.obj.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    r.obj.rotation.y += dy * Math.min(1, dt * 12);
  }
}

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

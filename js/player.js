// Local player: third-person controller, camera, melee/ranged combat, dodge, potions,
// XP/levels, traps, death/respawn. Remote player avatars are also maintained here.
import * as THREE from 'three';
import { G } from './state.js';
import { CLASSES, XP_FOR_LEVEL } from './config.js';
import { makeCharacter } from './assets.js';
import { makeBlobShadow, spawnDamageNumber, spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { moveWithCollision } from './dungeon.js';
import { spawnBolt } from './projectiles.js';
import { damageEnemy } from './enemies.js';
import { addMsg, refreshHud, showPrompt, hidePrompt, flashVignette, updatePartyBar } from './ui.js';
import { netSend } from './net.js';
import { nearestChest, takeLoot } from './loot.js';

const CAM_DIST = 7.5, CAM_HEIGHT = 3.4, CAM_PITCH_MIN = -0.15, CAM_PITCH_MAX = 1.1;

export function createPlayer(classId, name) {
  const cls = CLASSES[classId];
  const { obj, anim } = makeCharacter('char', cls.model, cls.show);
  obj.add(makeBlobShadow(0.85));
  // warm lantern glow that follows the hero
  const lantern = new THREE.PointLight(0xffb066, 14, 13, 1.7);
  lantern.position.set(0, 2.4, 0);
  obj.add(lantern);
  G.scene.add(obj);
  const p = {
    classId, cls, name,
    obj, anim,
    hp: cls.hp, maxHp: cls.hp,
    mana: cls.mana, maxMana: cls.mana,
    yaw: 0, camYaw: 0, camPitch: 0.45,
    attackT: 0, attackIdx: 0, attacking: false, attackFired: false,
    dodgeT: 0, dodgeCd: 0, iframes: 0, dodgeDirX: 0, dodgeDirZ: 0,
    dead: false, deadT: 0, moving: false,
    trapCd: 0, lastPosSend: 0,
  };
  anim.play('Idle');
  G.player = p;
  return p;
}

export function resetPlayerForFloor() {
  const p = G.player;
  p.obj.position.set(G.grid.spawn.x, 0, G.grid.spawn.z);
  p.obj.visible = true;
  if (p.dead) { p.dead = false; p.hp = Math.round(p.maxHp * 0.6); }
  p.attacking = false;
  p.anim.play('Idle');
}

export function effectiveDamage() {
  const p = G.player;
  return p.cls.dmg + G.run.atkBonus + (G.run.level - 1) * 2;
}
export function effectiveSpeed() {
  return G.player.cls.speed + G.run.speedBonus;
}
export function effectiveMaxHp() {
  return G.player.cls.hp + G.run.hpBonus + (G.run.level - 1) * 8;
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
    spawnBurst(p.obj.position.clone().setY(1.2), 0xffd35c, 24, 6, 0.16, 0.9);
    spawnDamageNumber(p.obj.position.clone().setY(2.4), `LEVEL ${G.run.level}`, '#ffd35c', true);
  }
  refreshHud();
}

export function damageLocalPlayer(amount) {
  const p = G.player;
  if (!p || p.dead || p.iframes > 0) return;
  p.hp -= amount;
  sfx.hurt();
  flashVignette();
  spawnDamageNumber(p.obj.position.clone().setY(2.2), `-${amount}`, '#ff6655');
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
  p.anim.play('Death_A', { once: true, clamp: true });
  sfx.death();
  netSend({ t: 'pdead' });
  // main.js decides solo game-over vs co-op respawn via its update hook
}

export function drinkPotion() {
  const p = G.player;
  if (p.dead || G.run.potions <= 0 || p.hp >= p.maxHp) return;
  G.run.potions--;
  p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.45));
  p.anim.play('Use_Item', { once: true });
  sfx.potion();
  spawnBurst(p.obj.position.clone().setY(1.4), 0x44ff77, 14, 4, 0.13);
  addMsg('You drink a potion 🧪');
  refreshHud();
}

// ---------- input-driven update ----------
export function updatePlayer(dt) {
  const p = G.player;
  if (!p) return;
  p.anim.update(dt);
  if (p.iframes > 0) p.iframes -= dt;
  if (p.dodgeCd > 0) p.dodgeCd -= dt;
  if (p.trapCd > 0) p.trapCd -= dt;

  if (p.dead) {
    p.deadT += dt;
    updateCamera(dt);
    return;
  }

  // mana regen
  if (p.maxMana > 0) {
    p.mana = Math.min(p.maxMana, p.mana + (p.cls.manaRegen || 0) * dt);
  }

  const k = G.keys;
  let ix = 0, iz = 0;
  if (k['KeyW']) iz -= 1;
  if (k['KeyS']) iz += 1;
  if (k['KeyA']) ix -= 1;
  if (k['KeyD']) ix += 1;

  // dodge roll
  if (p.dodgeT > 0) {
    p.dodgeT -= dt;
    const sp = 16 * (p.dodgeT > 0.15 ? 1 : 0.5);
    moveWithCollision(p.obj.position, p.dodgeDirX * sp * dt, p.dodgeDirZ * sp * dt);
  } else if (p.attacking) {
    p.attackT += dt;
    const cls = p.cls;
    const hitMoment = cls.attackTime * 0.45;
    if (!p.attackFired && p.attackT >= hitMoment) {
      p.attackFired = true;
      doAttackHit();
    }
    if (p.attackT >= cls.attackTime) p.attacking = false;
  } else if (ix !== 0 || iz !== 0) {
    // camera-relative movement
    const len = Math.hypot(ix, iz);
    ix /= len; iz /= len;
    const sin = Math.sin(p.camYaw), cos = Math.cos(p.camYaw);
    const wx = ix * cos - iz * sin;
    const wz = ix * sin + iz * cos;
    const sp = effectiveSpeed();
    moveWithCollision(p.obj.position, wx * sp * dt, wz * sp * dt);
    p.yaw = Math.atan2(wx, wz);
    if (!p.moving) { p.anim.play('Running_A'); p.moving = true; }
  } else if (p.moving || (p.anim.currentName !== 'Idle' && !p.attacking && p.dodgeT <= 0 && isLoopDone(p))) {
    p.anim.play('Idle');
    p.moving = false;
  }
  if ((ix === 0 && iz === 0) && p.moving && p.dodgeT <= 0 && !p.attacking) {
    p.anim.play('Idle');
    p.moving = false;
  }

  // smooth facing
  let dy = p.yaw - p.obj.rotation.y;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  p.obj.rotation.y += dy * Math.min(1, dt * 12);

  // traps
  checkTraps();

  // interact prompt
  updateInteractPrompt();

  updateCamera(dt);

  // network position updates
  p.lastPosSend += dt;
  if (p.lastPosSend > 0.09) sendPos();
}

function isLoopDone(p) {
  return !p.anim.current || !p.anim.current.isRunning();
}

export function sendPos(force = false) {
  const p = G.player;
  if (G.net.role === 'solo' || !p) return;
  p.lastPosSend = 0;
  netSend({
    t: 'pos',
    x: +p.obj.position.x.toFixed(2), z: +p.obj.position.z.toFixed(2),
    yaw: +p.obj.rotation.y.toFixed(2),
    anim: p.anim.currentName,
    hp: p.hp, mhp: p.maxHp, dead: p.dead,
  });
}

function doAttackHit() {
  const p = G.player;
  const cls = p.cls;
  const dmg = effectiveDamage();
  if (cls.ranged) {
    if (p.mana < cls.manaCost) return;
    p.mana -= cls.manaCost;
    const dx = Math.sin(p.yaw), dz = Math.cos(p.yaw);
    const bolt = { x: p.obj.position.x + dx * 0.7, z: p.obj.position.z + dz * 0.7, dirX: dx, dirZ: dz, speed: 18, dmg, owner: 'player', color: 0xff8833, y: 1.5 };
    spawnBolt(bolt);
    sfx.bolt();
    netSend({ t: 'bolt', b: { ...bolt, owner: 'fx' } });
    refreshHud();
    return;
  }
  sfx.swing();
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.state === 'dead') continue;
    const dx = e.obj.position.x - p.obj.position.x;
    const dz = e.obj.position.z - p.obj.position.z;
    const d = Math.hypot(dx, dz);
    if (d > cls.attackRange * (e.boss ? 1.4 : 1)) continue;
    const angTo = Math.atan2(dx, dz);
    let ang = angTo - p.yaw;
    while (ang > Math.PI) ang -= Math.PI * 2;
    while (ang < -Math.PI) ang += Math.PI * 2;
    if (Math.abs(ang) > cls.attackArc) continue;
    const crit = Math.random() < cls.crit;
    damageEnemy(e, crit ? Math.round(dmg * 1.8) : dmg, crit);
    hitAny = true;
  }
  if (!hitAny) { /* whiff */ }
}

export function tryAttack() {
  const p = G.player;
  if (!p || p.dead || p.attacking || p.dodgeT > 0 || G.mode !== 'playing') return;
  const cls = p.cls;
  if (cls.ranged && p.mana < cls.manaCost) { addMsg('Not enough mana!', 'bad'); return; }
  p.attacking = true;
  p.attackT = 0;
  p.attackFired = false;
  p.moving = false;
  const animName = cls.attackAnims[p.attackIdx % cls.attackAnims.length];
  p.attackIdx++;
  const act = p.anim.play(animName, { once: true });
  if (act) act.timeScale = act.getClip().duration / cls.attackTime;
  // face camera direction for aiming
  p.yaw = p.camYaw + Math.PI;
  netSend({ t: 'atk' });
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
  if (ix === 0 && iz === 0) iz = -1; // default forward
  const len = Math.hypot(ix, iz);
  ix /= len; iz /= len;
  const sin = Math.sin(p.camYaw), cos = Math.cos(p.camYaw);
  p.dodgeDirX = ix * cos - iz * sin;
  p.dodgeDirZ = ix * sin + iz * cos;
  p.yaw = Math.atan2(p.dodgeDirX, p.dodgeDirZ);
  p.dodgeT = 0.42;
  p.dodgeCd = 1.15;
  p.iframes = 0.45;
  p.attacking = false;
  p.moving = false;
  p.anim.play('Dodge_Forward', { once: true, timeScale: 1.4 });
  sfx.dodge();
}

function checkTraps() {
  const p = G.player;
  if (p.trapCd > 0 || p.iframes > 0) return;
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

let interactTarget = null;
function updateInteractPrompt() {
  const p = G.player;
  interactTarget = null;
  // stairs
  const s = G.grid.stairs;
  if (Math.hypot(p.obj.position.x - s.x, p.obj.position.z - s.z) < 2.6) {
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
    p.anim.play('Interact', { once: true });
    takeLoot(c.id, 'local');
  }
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
function cameraBlocked(px, py, pz, x, y, z) {
  // sample along the ray; only walls below their 4u height block the view
  if (!G.grid) return false;
  const steps = Math.ceil(Math.hypot(x - px, z - pz) / 0.5);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const sy = py + (y - py) * t;
    if (sy > 3.7) continue;
    const sx = px + (x - px) * t, sz = pz + (z - pz) * t;
    const cx = Math.round(sx / 4), cy2 = Math.round(sz / 4);
    if (cx < 0 || cy2 < 0 || cx >= G.grid.w || cy2 >= G.grid.h) return true;
    if (G.grid.cells[cy2 * G.grid.w + cx] === 0) return true;
  }
  return false;
}
function updateCamera(dt) {
  const p = G.player;
  const cam = G.camera;
  const pitch = p.camPitch;
  const hx = p.obj.position.x, hy = p.obj.position.y + 1.6, hz = p.obj.position.z;
  // pull the camera in until it no longer intersects walls
  let dist = CAM_DIST;
  for (; dist > 2.2; dist -= 0.4) {
    const cx = hx + Math.sin(p.camYaw) * Math.cos(pitch) * dist;
    const cz = hz + Math.cos(p.camYaw) * Math.cos(pitch) * dist;
    const cy = hy + Math.sin(pitch) * dist;
    if (!cameraBlocked(hx, hy, hz, cx, cy, cz)) break;
  }
  const cx = hx + Math.sin(p.camYaw) * Math.cos(pitch) * dist;
  const cz = hz + Math.cos(p.camYaw) * Math.cos(pitch) * dist;
  const cy = hy + Math.sin(pitch) * dist;
  camTarget.set(cx, cy, cz);
  cam.position.lerp(camTarget, Math.min(1, dt * 12));
  cam.lookAt(hx, p.obj.position.y + 1.7, hz);
}

export function onMouseMove(dx, dy) {
  const p = G.player;
  if (!p) return;
  p.camYaw -= dx * 0.0028;
  p.camPitch = Math.min(CAM_PITCH_MAX, Math.max(CAM_PITCH_MIN, p.camPitch + dy * 0.002));
}

// ---------- remote players ----------
export function addRemotePlayer(pid, name, classId) {
  if (G.remotes.has(pid)) return G.remotes.get(pid);
  const cls = CLASSES[classId] || CLASSES.knight;
  const { obj, anim } = makeCharacter('char', cls.model, cls.show);
  obj.add(makeBlobShadow(0.85));
  // name tag
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
  const r = { pid, name, classId, cls, obj, anim, netX: 0, netZ: 0, netYaw: 0, hp: cls.hp, maxHp: cls.hp, dead: false, lastAnim: 'Idle' };
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

export function updateRemotes(dt) {
  for (const r of G.remotes.values()) {
    r.anim.update(dt);
    r.obj.position.x += (r.netX - r.obj.position.x) * Math.min(1, dt * 12);
    r.obj.position.z += (r.netZ - r.obj.position.z) * Math.min(1, dt * 12);
    let dy = r.netYaw - r.obj.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    r.obj.rotation.y += dy * Math.min(1, dt * 12);
  }
}

export function applyRemotePos(pid, m) {
  const r = G.remotes.get(pid);
  if (!r) return;
  r.netX = m.x; r.netZ = m.z; r.netYaw = m.yaw;
  r.hp = m.hp; r.maxHp = m.mhp;
  if (m.dead && !r.dead) { r.dead = true; r.anim.play('Death_A', { once: true, clamp: true }); }
  if (!m.dead && r.dead) { r.dead = false; r.anim.play('Idle'); }
  if (!r.dead && m.anim && m.anim !== r.lastAnim) {
    r.lastAnim = m.anim;
    const oneShot = m.anim.includes('Attack') || m.anim.includes('Dodge') || m.anim.includes('Use_Item') || m.anim.includes('Interact') || m.anim.includes('Spellcast');
    r.anim.play(m.anim, oneShot ? { once: true } : {});
  }
  updatePartyBar();
}

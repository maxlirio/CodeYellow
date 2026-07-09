// Class spells (keys 1/2/3): projectiles, cones, AoE, buffs, heals, blinks, chains.
import * as THREE from 'three';
import { G } from './state.js';
import { SPELLS } from './config.js';
import { spawnBolt } from './projectiles.js';
import { spawnBurst, spawnDamageNumber, makeGlowSprite } from './fx.js';
import { sfx } from './audio.js';
import { damageEnemy } from './enemies.js';
import { spawnMinion } from './minions.js';
import { healLocalPlayer } from './player.js';
import { moveWithCollision, groundHeightAt, hasLineOfSight } from './dungeon.js';
import { addMsg, refreshHud } from './ui.js';
import { netSend, isAuthority, myId } from './net.js';
import { triggerSwing } from './viewmodel.js';
import { placeWall } from './walls.js';

export const cooldowns = {}; // spellId -> remaining seconds
const pendingAoes = [];      // delayed strikes (Judgement, Meteor)
const vortices = [];         // gravity wells dragging enemies together
const wards = [];            // life wards pulsing heals

export function resetCooldowns() {
  for (const k of Object.keys(cooldowns)) delete cooldowns[k];
  pendingAoes.length = 0;
  for (const v of vortices) disposeVfx(v);
  vortices.length = 0;
  for (const w of wards) disposeVfx(w);
  wards.length = 0;
}

function disposeVfx(v) {
  if (!v.obj) return;
  G.scene.remove(v.obj);
  v.obj.traverse((n) => { if (n.isMesh) { n.geometry?.dispose(); n.material?.dispose?.(); } if (n.isSprite) n.material?.dispose?.(); });
}

// deal a random 3 spells from the class pool — a fresh kit every run
export function dealSpells(classId) {
  const pool = [...(G.player?.cls.spellPool || [])];
  if (!pool.length) return [];
  const picked = [];
  while (picked.length < 3 && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  G.run.spells = picked;
  return picked;
}

// merchant's Spell Tome: swap a random slot for an unused spell from the pool
export function rerollSpell() {
  const pool = G.player.cls.spellPool.filter(s => !G.run.spells.includes(s));
  if (!pool.length) return null;
  const slot = Math.floor(Math.random() * G.run.spells.length);
  const oldId = G.run.spells[slot];
  const newId = pool[Math.floor(Math.random() * pool.length)];
  G.run.spells[slot] = newId;
  delete cooldowns[oldId];
  return { old: SPELLS[oldId].name, now: SPELLS[newId].name, icon: SPELLS[newId].icon };
}

export function updateSpells(dt) {
  for (const k of Object.keys(cooldowns)) {
    cooldowns[k] -= dt;
    if (cooldowns[k] <= 0) delete cooldowns[k];
  }
  const p = G.player;
  if (p?.buff) {
    p.buff.t -= dt;
    if (p.buff.t <= 0) { p.buff = null; addMsg('The surge fades.'); }
  }
  // gravity wells: drag everything toward the eye, then burst
  for (let i = vortices.length - 1; i >= 0; i--) {
    const v = vortices[i];
    v.t -= dt;
    v.tick -= dt;
    if (v.obj) {
      v.obj.rotation.y += dt * 5;
      const s = 1 + Math.sin(v.t * 14) * 0.12;
      v.obj.scale.setScalar(s);
    }
    if (v.f === G.floor && v.tick <= 0) {
      v.tick = 0.3;
      spawnBurst(new THREE.Vector3(v.x + (Math.random() - 0.5) * v.radius * 1.4, v.y + 0.8, v.z + (Math.random() - 0.5) * v.radius * 1.4), 0xbb66ff, 4, -3, 0.1, 0.35);
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const dx = v.x - e.obj.position.x, dz = v.z - e.obj.position.z;
        const d = Math.hypot(dx, dz);
        if (d > v.radius || d < 0.3 || Math.abs(e.obj.position.y - v.y) > 3) continue;
        damageEnemy(e, 1, false, false, 'local', { kb: { x: dx / d * 10, z: dz / d * 10 }, slow: { mult: 0.35, dur: 0.5 } });
      }
    }
    if (v.t <= 0) {
      vortices.splice(i, 1);
      disposeVfx(v);
      if (v.f !== G.floor) continue;
      sfx.trap(); sfx.hit();
      spawnBurst(new THREE.Vector3(v.x, v.y + 0.8, v.z), 0xbb66ff, 30, 8, 0.18, 0.55);
      netSend({ t: 'fx', f: v.f, x: v.x, y: v.y + 0.8, z: v.z, color: 0xbb66ff, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead') continue;
        const d = Math.hypot(e.obj.position.x - v.x, e.obj.position.z - v.z);
        if (d > v.radius || Math.abs(e.obj.position.y - v.y) > 3) continue;
        damageEnemy(e, v.dmg, false, false, 'local', { stun: 0.4 });
      }
    }
  }
  // life wards: pulse healing for everyone standing close
  for (let i = wards.length - 1; i >= 0; i--) {
    const w = wards[i];
    w.t -= dt;
    w.tick -= dt;
    if (w.obj) w.obj.position.y = w.y + 0.7 + Math.sin(w.t * 3) * 0.15;
    if (w.f === G.floor && w.tick <= 0) {
      w.tick = w.rate;
      spawnBurst(new THREE.Vector3(w.x, w.y + 0.6, w.z), 0x66ffbb, 10, 2.5, 0.11, 0.7);
      netSend({ t: 'fx', f: w.f, x: w.x, y: w.y + 0.6, z: w.z, color: 0x66ffbb });
      const p = G.player;
      if (p && !p.dead && Math.hypot(p.obj.position.x - w.x, p.obj.position.z - w.z) <= w.radius) healLocalPlayer(w.amt);
      netSend({ t: 'pheal', f: w.f, x: w.x, z: w.z, r: w.radius, amt: w.amt });
    }
    if (w.t <= 0) {
      wards.splice(i, 1);
      disposeVfx(w);
      if (w.f === G.floor) spawnBurst(new THREE.Vector3(w.x, w.y + 0.8, w.z), 0x66ffbb, 16, 4, 0.13, 0.5);
    }
  }
  // delayed target-point strikes
  for (let i = pendingAoes.length - 1; i >= 0; i--) {
    const a = pendingAoes[i];
    a.t -= dt;
    if (a.t > 0) {
      if (Math.random() < 0.4) spawnBurst(new THREE.Vector3(a.x, a.y + 0.3, a.z), a.color, 3, 1.5, 0.08, 0.25);
      continue;
    }
    pendingAoes.splice(i, 1);
    sfx.trap(); sfx.hit();
    spawnBurst(new THREE.Vector3(a.x, a.y + 0.6, a.z), a.color, 32, 9, 0.19, 0.6);
    netSend({ t: 'fx', f: G.floor, x: a.x, y: a.y + 0.6, z: a.z, color: a.color, big: 1 });
    for (const e of G.enemies) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.obj.position.x - a.x, e.obj.position.z - a.z);
      if (d > a.radius || Math.abs(e.obj.position.y - a.y) > 3) continue;
      damageEnemy(e, a.dmg, false, false, 'local', a.effects);
    }
  }
}

// march the crosshair ray to a ground point (or first wall) within range
function aimGroundPoint(origin, dir, range) {
  const from = origin.clone().setY(origin.y + 1.5);
  let hit = null;
  for (let d = 1; d < range; d += 0.5) {
    const px = from.x + dir.x * d, py = from.y + dir.y * d, pz = from.z + dir.z * d;
    const g = groundHeightAt(px, pz, py);
    if (py <= g + 0.2) { hit = { x: px, y: g, z: pz }; break; }
    if (!hasLineOfSight(from.x, from.z, px, pz)) break;
    hit = { x: px, y: Math.max(0, py - 1.5), z: pz };
  }
  if (hit) hit.y = groundHeightAt(hit.x, hit.z, hit.y + 1);
  return hit;
}

function aimDir() {
  const v = new THREE.Vector3();
  G.camera.getWorldDirection(v);
  return v;
}

export function castSpell(slot, effectiveDamage) {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'playing' || p.dodgeT > 0) return;
  const spellId = (G.run.spells || [])[slot];
  const sp = SPELLS[spellId];
  if (!sp) return;
  if (cooldowns[spellId] > 0) return;
  if (p.mana < sp.mana) { addMsg('Not enough mana!', 'bad'); return; }
  if (sp.arrows && (G.run.arrows || 0) < sp.arrows) { addMsg(`Needs ${sp.arrows} arrows!`, 'bad'); return; }
  if (sp.arrows) { G.run.arrows -= sp.arrows; refreshHud(); }
  p.mana -= sp.mana;
  cooldowns[spellId] = sp.cd;
  const dmg = Math.round(effectiveDamage() * (sp.dmgMult || 1));
  const dir = aimDir();
  const origin = p.obj.position;

  // casting animation & face aim
  p.attacking = false;
  const castAnim = sp.type === 'cone' ? 'Block_Attack' : sp.type === 'aoe' ? '2H_Melee_Attack_Spin' : 'Spellcast_Shoot';
  p.anim.play(p.anim.has(castAnim) ? castAnim : 'Spellcast_Shoot', { once: true, timeScale: 1.6 });
  triggerSwing('cast', 0.5);
  p.yaw = Math.atan2(dir.x, dir.z);

  switch (sp.type) {
    case 'proj': {
      sfx.bolt();
      const count = sp.count || 1;
      for (let i = 0; i < count; i++) {
        const spread = sp.spread ? (i - (count - 1) / 2) * (sp.spread / count) : 0;
        const cos = Math.cos(spread), sin = Math.sin(spread);
        const dx = dir.x * cos - dir.z * sin, dz = dir.x * sin + dir.z * cos;
        const b = {
          x: origin.x + dx * 0.7, z: origin.z + dz * 0.7, y: origin.y + 1.45,
          dirX: dx, dirY: dir.y, dirZ: dz,
          speed: sp.speed, dmg, owner: 'player', color: sp.color, size: sp.size || 1, vis: sp.vis,
          aoe: sp.aoe || 0, slow: sp.slow, pierce: !!sp.pierce, bounce: sp.bounce || 0,
          poison: sp.poison ? { dps: Math.round(dmg * sp.poison.mult), dur: sp.poison.dur } : null,
        };
        spawnBolt(b);
        netSend({ t: 'bolt', f: G.floor, b: { ...b, owner: 'fx' } });
      }
      break;
    }
    case 'cone': {
      sfx.crit();
      spawnBurst(origin.clone().add(new THREE.Vector3(dir.x * 2, 1.2, dir.z * 2)), 0xffdd88, 18, 6, 0.14, 0.4);
      netSend({ t: 'fx', f: G.floor, x: origin.x + dir.x * 2, y: 1.2, z: origin.z + dir.z * 2, color: 0xffdd88 });
      for (const e of G.enemies) {
        if (e.state === 'dead') continue;
        const dx = e.obj.position.x - origin.x, dz = e.obj.position.z - origin.z;
        const d = Math.hypot(dx, dz);
        if (d > sp.range || Math.abs(e.obj.position.y - origin.y) > 2.5) continue;
        let ang = Math.atan2(dx, dz) - p.yaw;
        while (ang > Math.PI) ang -= Math.PI * 2;
        while (ang < -Math.PI) ang += Math.PI * 2;
        if (Math.abs(ang) > sp.arc) continue;
        damageEnemy(e, dmg, false, false, 'local', { kb: { x: dx / d * sp.knockback, z: dz / d * sp.knockback }, stun: sp.stun });
      }
      break;
    }
    case 'aoe': {
      sfx.trap(); sfx.hit();
      const col = sp.color || 0xffaa44;
      spawnBurst(origin.clone().setY(origin.y + 0.5), col, 30, 8, 0.18, 0.6);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 0.5, z: origin.z, color: col, big: 1 });
      if (sp.selfIframes) p.iframes = Math.max(p.iframes, sp.selfIframes);
      for (const e of G.enemies) {
        if (e.state === 'dead') continue;
        const d = Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z);
        if (d > sp.radius || Math.abs(e.obj.position.y - origin.y) > 2.5) continue;
        const fx = { stun: sp.stun };
        if (sp.slowAll) fx.slow = sp.slowAll;
        if (sp.burn) fx.poison = { dps: Math.max(2, Math.round(dmg * sp.burn.mult)), dur: sp.burn.dur };
        if (dmg > 0) damageEnemy(e, dmg, false, false, 'local', fx);
        else if (fx.stun || fx.slow) damageEnemy(e, 1, false, false, 'local', fx);
      }
      break;
    }
    case 'buff': {
      sfx.levelup();
      p.buff = { dmgMult: sp.dmgMult || 1, speedMult: sp.speedMult || 1, armorAdd: sp.armorAdd || 0, lifesteal: sp.lifesteal || 0, t: sp.dur };
      spawnBurst(origin.clone().setY(origin.y + 1.2), 0xff4444, 22, 5, 0.15, 0.8);
      addMsg(`${sp.name}!`, 'gold');
      break;
    }
    case 'targetaoe': {
      // strike where the crosshair points, after a short delay
      sfx.bolt();
      const from = origin.clone().setY(origin.y + 1.5);
      let hit = null;
      for (let d = 1; d < sp.range; d += 0.5) {
        const px = from.x + dir.x * d, py = from.y + dir.y * d, pz = from.z + dir.z * d;
        const g = groundHeightAt(px, pz, py);
        if (py <= g + 0.2) { hit = { x: px, y: g, z: pz }; break; }
        if (!hasLineOfSight(from.x, from.z, px, pz)) break;
        hit = { x: px, y: Math.max(0, py - 1.5), z: pz };
      }
      if (!hit) { p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      hit.y = groundHeightAt(hit.x, hit.z, hit.y + 1);
      const effects = sp.burn ? { poison: { dps: Math.max(2, Math.round(dmg * sp.burn.mult)), dur: sp.burn.dur } } : null;
      pendingAoes.push({ ...hit, t: sp.delay, radius: sp.radius, dmg, color: sp.color, effects });
      spawnBurst(new THREE.Vector3(hit.x, hit.y + 0.4, hit.z), sp.color, 10, 2, 0.12, sp.delay);
      // dramatic incoming visuals: a meteor streaks down / arrows rain from the sky
      if (sp.fall === 'fireball') {
        const fallH = 13;
        spawnBolt({ x: hit.x + 2, z: hit.z + 1, y: hit.y + fallH, dirX: -2 / sp.delay / (fallH / sp.delay), dirY: -1, dirZ: -1 / sp.delay / (fallH / sp.delay), speed: fallH / sp.delay, owner: 'fx', vis: 'fireball', size: 2.2, color: 0xff6622 });
      } else if (sp.fall === 'arrowrain') {
        for (let ai = 0; ai < 7; ai++) {
          const ox = (Math.random() - 0.5) * sp.radius * 1.6, oz = (Math.random() - 0.5) * sp.radius * 1.6;
          spawnBolt({ x: hit.x + ox, z: hit.z + oz, y: hit.y + 11 + Math.random() * 2, dirX: 0, dirY: -1, dirZ: 0, speed: 11 / sp.delay, owner: 'fx', vis: 'arrow', color: 0xd8e6b0 });
        }
      }
      break;
    }
    case 'wall': {
      // raise a wall at the aimed cell — monsters can't get you
      const from = origin.clone().setY(origin.y + 1.5);
      let hit = null;
      for (let d = 2; d < sp.range; d += 0.5) {
        const px = from.x + dir.x * d, pz = from.z + dir.z * d;
        if (!hasLineOfSight(from.x, from.z, px, pz)) break;
        hit = { x: px, z: pz };
      }
      if (!hit) { p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      const cx = Math.round(hit.x / 4), cy = Math.round(hit.z / 4);
      const yaw = Math.abs(dir.x) > Math.abs(dir.z) ? Math.PI / 2 : 0;
      const ok = placeWall(G.floor, cx, cy, { dur: sp.dur, yaw });
      if (!ok) { addMsg('No room for a wall there.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.bones();
      addMsg('A wall of bone erupts from the ground!');
      break;
    }
    case 'mark': {
      // death mark: the enemy under your crosshair takes +50% damage
      let target = null, best = 0.2;
      const from = origin.clone().setY(origin.y + 1.5);
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const to = e.obj.position.clone().setY(e.obj.position.y + 1.1).sub(from);
        const d = to.length();
        if (d > sp.range) continue;
        const ang = to.normalize().angleTo(dir);
        if (ang < best && hasLineOfSight(from.x, from.z, e.obj.position.x, e.obj.position.z)) { best = ang; target = e; }
      }
      if (!target) { addMsg('No target in sight.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.crit();
      damageEnemy(target, 1, false, false, 'local', { vuln: sp.dur });
      spawnDamageNumber(target.obj.position.clone().setY(target.obj.position.y + 2.4), 'MARKED', '#ff88ff', true);
      addMsg(`${sp.name}: your target is exposed!`, 'gold');
      break;
    }
    case 'heal': {
      sfx.potion(); sfx.levelup();
      const amount = Math.round(p.maxHp * sp.frac);
      p.hp = Math.min(p.maxHp, p.hp + amount);
      spawnDamageNumber(origin.clone().setY(origin.y + 2.2), `+${amount}`, '#66ff88');
      spawnBurst(origin.clone().setY(origin.y + 1.2), 0x55ff77, 24, 4.5, 0.15, 0.9);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1.2, z: origin.z, color: 0x55ff77 });
      break;
    }
    case 'blink': {
      sfx.dodge();
      spawnBurst(origin.clone().setY(origin.y + 1), 0x8844ff, 14, 4, 0.13, 0.5);
      const step = 0.5;
      let travelled = 0;
      const pos = { x: origin.x, z: origin.z, y: origin.y };
      while (travelled < sp.dist) {
        const before = { x: pos.x, z: pos.z };
        moveWithCollision(pos, dir.x * step, dir.z * step, 0.5, { y: pos.y });
        if (pos.x === before.x && pos.z === before.z) break;
        travelled += step;
      }
      origin.x = pos.x; origin.z = pos.z;
      origin.y = groundHeightAt(pos.x, pos.z, origin.y);
      p.iframes = Math.max(p.iframes, 0.3);
      const blinkCol = sp.landAoe ? 0xff8844 : 0x8844ff;
      spawnBurst(origin.clone().setY(origin.y + 1), blinkCol, 14, 4, 0.13, 0.5);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1, z: origin.z, color: blinkCol });
      // Savage Leap: damage where you land
      if (sp.landAoe) {
        sfx.trap();
        const ldmg = Math.round(effectiveDamage() * sp.landAoe.dmgMult);
        netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 0.5, z: origin.z, color: 0xffaa44, big: 1 });
        spawnBurst(origin.clone().setY(origin.y + 0.5), 0xffaa44, 24, 7, 0.16, 0.5);
        for (const e of G.enemies) {
          if (e.state === 'dead') continue;
          const d = Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z);
          if (d > sp.landAoe.radius || Math.abs(e.obj.position.y - origin.y) > 2.5) continue;
          damageEnemy(e, ldmg, false, false, 'local', { stun: sp.landAoe.stun });
        }
      }
      break;
    }
    case 'phantoms': {
      // Mirror Legion: spectral copies of yourself join the fight
      sfx.levelup(); sfx.dodge();
      const count = sp.count || 2;
      const o = {
        model: p.cls.model, show: p.cls.show,
        dmg: Math.max(3, Math.round(effectiveDamage() * sp.dmgMult)), life: sp.dur,
      };
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + p.yaw + Math.PI / 2;
        const px = origin.x + Math.sin(a) * 1.7, pz = origin.z + Math.cos(a) * 1.7;
        if (isAuthority()) spawnMinion('phantom', myId(), G.floor, px, pz, null, true, o);
        else netSend({ t: 'hire', kind: 'phantom', f: G.floor, x: px, z: pz, o });
        spawnBurst(new THREE.Vector3(px, 1.2, pz), 0xbfe0ff, 16, 4, 0.13, 0.5);
        netSend({ t: 'fx', f: G.floor, x: px, y: 1.2, z: pz, color: 0xbfe0ff });
      }
      addMsg('Your reflections step out of the glass!', 'gold');
      break;
    }
    case 'lightning': {
      // Storm Lance: a forked bolt rips from your staff into the pack
      let target = null, bestScore = 0.3;
      const from = origin.clone().setY(origin.y + 1.5);
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const to = e.obj.position.clone().setY(e.obj.position.y + 1.2).sub(from);
        const d = to.length();
        if (d > sp.range) continue;
        const ang = to.normalize().angleTo(dir);
        if (ang < bestScore && hasLineOfSight(origin.x, origin.z, e.obj.position.x, e.obj.position.z)) { bestScore = ang; target = e; }
      }
      if (!target) { addMsg('No target in sight.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.bolt(); sfx.crit();
      // the bolt leaves the staff tip, not your chest
      const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      const staffTip = from.clone().add(right.multiplyScalar(0.35)).add(dir.clone().multiplyScalar(0.6)).setY(from.y - 0.15);
      spawnBurst(staffTip, 0x99ddff, 10, 3, 0.1, 0.3);
      const primaryPos = target.obj.position.clone().setY(target.obj.position.y + 1.2);
      drawLightning(staffTip, primaryPos);
      damageEnemy(target, dmg, false, false, 'local', { stun: sp.stun });
      spawnBurst(primaryPos, 0x99ddff, 14, 5, 0.13, 0.4);
      // simultaneous forks into everything near the first victim
      const forks = [];
      for (const e of G.enemies) {
        if (e === target || e.state === 'dead' || e.state === 'inactive') continue;
        const d = e.obj.position.distanceTo(target.obj.position);
        if (d < sp.forkRange) forks.push([d, e]);
      }
      forks.sort((a, b) => a[0] - b[0]);
      const forkDmg = Math.round(dmg * sp.forkMult);
      for (const [, e] of forks.slice(0, sp.forks)) {
        const ep = e.obj.position.clone().setY(e.obj.position.y + 1.2);
        drawLightning(primaryPos, ep);
        damageEnemy(e, forkDmg, false, false, 'local', { stun: sp.stun });
        spawnBurst(ep, 0x99ddff, 8, 4, 0.11, 0.35);
      }
      break;
    }
    case 'vortex': {
      // Gravity Well: tear open a vortex that drags enemies into a heap
      const hit = aimGroundPoint(origin, dir, sp.range);
      if (!hit) { p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.bolt(); sfx.bones();
      const obj = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x220033, emissive: 0xbb66ff, emissiveIntensity: 1.4, transparent: true, opacity: 0.85 })
      );
      obj.add(core);
      obj.add(makeGlowSprite(0xbb66ff, 2.6));
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.3, 0.07, 6, 24),
        new THREE.MeshStandardMaterial({ color: 0x8844cc, emissive: 0x9955ee, emissiveIntensity: 1.1 })
      );
      ring.rotation.x = Math.PI / 2;
      obj.add(ring);
      obj.position.set(hit.x, hit.y + 1.1, hit.z);
      G.scene.add(obj);
      vortices.push({ x: hit.x, y: hit.y, z: hit.z, f: G.floor, t: sp.dur, tick: 0, radius: sp.radius, dmg, obj });
      netSend({ t: 'fx', f: G.floor, x: hit.x, y: hit.y + 1, z: hit.z, color: 0xbb66ff, big: 1 });
      break;
    }
    case 'ward': {
      // Life Ward: plant a crystal that pulses healing for the whole party
      sfx.potion(); sfx.levelup();
      const obj = new THREE.Group();
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshStandardMaterial({ color: 0x116644, emissive: 0x44ffaa, emissiveIntensity: 1.3 })
      );
      crystal.scale.y = 1.9;
      obj.add(crystal);
      obj.add(makeGlowSprite(0x66ffbb, 2.0));
      const gy = groundHeightAt(origin.x, origin.z, origin.y);
      obj.position.set(origin.x, gy + 0.7, origin.z);
      G.scene.add(obj);
      wards.push({
        x: origin.x, y: gy, z: origin.z, f: G.floor, t: sp.dur, tick: 0.2, rate: sp.tick,
        radius: sp.radius, amt: Math.max(2, Math.round(p.maxHp * sp.frac)), obj,
      });
      addMsg('A ward of life takes root.', 'gold');
      break;
    }
    case 'chain': {
      sfx.bolt(); sfx.crit();
      // hit the enemy nearest to the crosshair, then arc to nearest neighbours
      let target = null, bestScore = 0.25;
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const to = e.obj.position.clone().setY(e.obj.position.y + 1.2).sub(origin.clone().setY(origin.y + 1.5));
        const d = to.length();
        if (d > sp.range) continue;
        const ang = to.normalize().angleTo(dir);
        if (ang < bestScore && hasLineOfSight(origin.x, origin.z, e.obj.position.x, e.obj.position.z)) { bestScore = ang; target = e; }
      }
      if (!target) { addMsg('No target in sight.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      const hitSet = new Set();
      let cur = target, curDmg = dmg, from = origin.clone().setY(origin.y + 1.5);
      for (let j = 0; j <= sp.jumps && cur; j++) {
        hitSet.add(cur.id);
        drawLightning(from, cur.obj.position.clone().setY(cur.obj.position.y + 1.2));
        damageEnemy(cur, Math.round(curDmg), false, false, 'local', { stun: 0.3 });
        from = cur.obj.position.clone().setY(cur.obj.position.y + 1.2);
        curDmg *= sp.falloff;
        let next = null, nd = 9;
        for (const e of G.enemies) {
          if (e.state === 'dead' || hitSet.has(e.id)) continue;
          const d = e.obj.position.distanceTo(cur.obj.position);
          if (d < nd) { nd = d; next = e; }
        }
        cur = next;
      }
      break;
    }
  }
  refreshHud();
}

// quick lightning beam visual
const beams = [];
function drawLightning(a, b) {
  const pts = [a];
  const n = 5;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(
      a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 0.7,
      a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 0.7,
      a.z + (b.z - a.z) * t + (Math.random() - 0.5) * 0.7,
    ));
  }
  pts.push(b);
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x99ddff, transparent: true, opacity: 1 }));
  G.scene.add(line);
  beams.push({ line, t: 0 });
  netSend({ t: 'beam', f: G.floor, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z] });
}

export function remoteBeam(a, b) {
  drawLightningLocal(new THREE.Vector3(...a), new THREE.Vector3(...b));
}
function drawLightningLocal(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x99ddff, transparent: true, opacity: 1 }));
  G.scene.add(line);
  beams.push({ line, t: 0 });
}

export function updateBeams(dt) {
  for (let i = beams.length - 1; i >= 0; i--) {
    const bm = beams[i];
    bm.t += dt;
    bm.line.material.opacity = Math.max(0, 1 - bm.t / 0.25);
    if (bm.t > 0.25) {
      G.scene.remove(bm.line);
      bm.line.geometry.dispose(); bm.line.material.dispose();
      beams.splice(i, 1);
    }
  }
}

// introspection for tests
export function spellDebug() {
  return { vortices: vortices.map(v => ({ x: v.x, z: v.z, t: +v.t.toFixed(1) })), wards: wards.length };
}

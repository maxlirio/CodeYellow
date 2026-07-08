// Class spells (keys 1/2/3): projectiles, cones, AoE, buffs, heals, blinks, chains.
import * as THREE from 'three';
import { G } from './state.js';
import { SPELLS } from './config.js';
import { spawnBolt } from './projectiles.js';
import { spawnBurst, spawnDamageNumber } from './fx.js';
import { sfx } from './audio.js';
import { damageEnemy } from './enemies.js';
import { moveWithCollision, groundHeightAt, hasLineOfSight } from './dungeon.js';
import { addMsg, refreshHud } from './ui.js';
import { netSend } from './net.js';

export const cooldowns = {}; // spellId -> remaining seconds

export function resetCooldowns() {
  for (const k of Object.keys(cooldowns)) delete cooldowns[k];
}

export function updateSpells(dt) {
  for (const k of Object.keys(cooldowns)) {
    cooldowns[k] -= dt;
    if (cooldowns[k] <= 0) delete cooldowns[k];
  }
  const p = G.player;
  if (p?.buff) {
    p.buff.t -= dt;
    if (p.buff.t <= 0) { p.buff = null; addMsg('Your rage subsides.'); }
  }
}

function aimDir() {
  const v = new THREE.Vector3();
  G.camera.getWorldDirection(v);
  return v;
}

export function castSpell(slot, effectiveDamage) {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'playing' || p.dodgeT > 0) return;
  const spellId = p.cls.spells[slot];
  const sp = SPELLS[spellId];
  if (!sp) return;
  if (cooldowns[spellId] > 0) return;
  if (p.mana < sp.mana) { addMsg('Not enough mana!', 'bad'); return; }
  p.mana -= sp.mana;
  cooldowns[spellId] = sp.cd;
  const dmg = Math.round(effectiveDamage() * (sp.dmgMult || 1));
  const dir = aimDir();
  const origin = p.obj.position;

  // casting animation & face aim
  p.attacking = false;
  const castAnim = sp.type === 'cone' ? 'Block_Attack' : sp.type === 'aoe' ? '2H_Melee_Attack_Spin' : 'Spellcast_Shoot';
  p.anim.play(p.anim.has(castAnim) ? castAnim : 'Spellcast_Shoot', { once: true, timeScale: 1.6 });
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
          speed: sp.speed, dmg, owner: 'player', color: sp.color, size: sp.size || 1,
          aoe: sp.aoe || 0, slow: sp.slow, poison: sp.poison ? { dps: Math.round(dmg * sp.poison.mult), dur: sp.poison.dur } : null,
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
      spawnBurst(origin.clone().setY(origin.y + 0.5), 0xffaa44, 30, 8, 0.18, 0.6);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 0.5, z: origin.z, color: 0xffaa44, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead') continue;
        const d = Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z);
        if (d > sp.radius || Math.abs(e.obj.position.y - origin.y) > 2.5) continue;
        damageEnemy(e, dmg, false, false, 'local', { stun: sp.stun });
      }
      break;
    }
    case 'buff': {
      sfx.levelup();
      p.buff = { dmgMult: sp.dmgMult, speedMult: sp.speedMult, t: sp.dur };
      spawnBurst(origin.clone().setY(origin.y + 1.2), 0xff4444, 22, 5, 0.15, 0.8);
      addMsg(`${sp.name}! +${Math.round((sp.dmgMult - 1) * 100)}% damage`, 'gold');
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
      spawnBurst(origin.clone().setY(origin.y + 1), 0x8844ff, 14, 4, 0.13, 0.5);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1, z: origin.z, color: 0x8844ff });
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

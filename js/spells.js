// Class spells (keys 1/2/3): projectiles, cones, AoE, buffs, heals, blinks, chains.
import * as THREE from 'three';
import { G } from './state.js';
import { SPELLS, SIGNATURES } from './config.js';
import { spawnBolt } from './projectiles.js';
import { spawnBurst, spawnDamageNumber, makeGlowSprite } from './fx.js';
import { sfx } from './audio.js';
import { damageEnemy } from './enemies.js';
import { spawnMinion, minions, dismissMinion } from './minions.js';
import { applyEnemyVfx } from './enemies.js';
import { sigReady, spendSigCharge, effectiveAttackRange } from './player.js';
import { healLocalPlayer } from './player.js';
import { moveWithCollision, groundHeightAt, hasLineOfSight, posBlocked } from './dungeon.js';
import { addMsg, refreshHud } from './ui.js';
import { netSend, isAuthority, myId } from './net.js';
import { triggerSwing } from './viewmodel.js';
import { placeWall } from './walls.js';

export const cooldowns = {}; // spellId -> remaining seconds
const pendingAoes = [];      // delayed strikes (Judgement, Meteor)
const vortices = [];         // gravity wells dragging enemies together
const wards = [];            // life wards pulsing heals
const sTraps = [];           // steel traps waiting to snap
const embers = [];           // burning ground left by Ember Trail
const domes = [];            // chrono bubbles & sanctuaries (visual + effect zones)
const banners = [];          // war banners buffing nearby fighters
const spikes = [];           // earthsplitter spike visuals fading out

export function resetCooldowns() {
  for (const k of Object.keys(cooldowns)) delete cooldowns[k];
  pendingAoes.length = 0;
  for (const v of vortices) disposeVfx(v);
  vortices.length = 0;
  for (const w of wards) disposeVfx(w);
  wards.length = 0;
  for (const t of sTraps) disposeVfx(t);
  sTraps.length = 0;
  for (const e of embers) disposeVfx(e);
  embers.length = 0;
  for (const d of domes) disposeVfx(d);
  domes.length = 0;
  for (const b of banners) disposeVfx(b);
  banners.length = 0;
  for (const s of spikes) disposeVfx(s);
  spikes.length = 0;
  G.sanctuaries = [];
  G.banners = [];
  for (const z2 of remoteZones) disposeVfx(z2);
  remoteZones.length = 0;
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
export function rerollSpell(slot = null) {
  const pool = G.player.cls.spellPool.filter(s => !G.run.spells.includes(s));
  if (!pool.length) return null;
  if (slot === null) slot = Math.floor(Math.random() * G.run.spells.length);
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
  // teammates' zone visuals: spin, bob, fade, expire
  for (let i = remoteZones.length - 1; i >= 0; i--) {
    const z2 = remoteZones[i];
    z2.t -= dt;
    z2.obj.visible = z2.f === G.floor;
    if (z2.kind === 'vortex') z2.obj.rotation.y += dt * 5;
    if (z2.kind === 'banner') z2.obj.rotation.y += dt * 0.8;
    if (z2.kind === 'ward') z2.obj.position.y = Math.sin(z2.t * 3) * 0.15;
    if (z2.t <= 0) { disposeVfx(z2); remoteZones.splice(i, 1); }
  }
  // steel traps: snap shut on the first leg that steps in
  for (let i = sTraps.length - 1; i >= 0; i--) {
    const tr = sTraps[i];
    if (tr.f !== G.floor) continue;
    let bit = null;
    for (const e of G.enemies) {
      if (e.state === 'dead' || e.state === 'inactive') continue;
      if (Math.hypot(e.obj.position.x - tr.x, e.obj.position.z - tr.z) < 1.1 && e.obj.position.y < 1.5) { bit = e; break; }
    }
    if (bit) {
      sfx.trap(); sfx.hit();
      spawnBurst(new THREE.Vector3(tr.x, 0.5, tr.z), 0xcccccc, 14, 5, 0.13, 0.4);
      netSend({ t: 'fx', f: tr.f, x: tr.x, y: 0.5, z: tr.z, color: 0xcccccc });
      damageEnemy(bit, tr.dmg, false, false, 'local', { slow: { mult: 0.02, dur: tr.root }, stun: 0.4 });
      if (tr.zid) netSend({ t: 'szoneend', id: tr.zid });
      disposeVfx(tr);
      sTraps.splice(i, 1);
    }
  }
  // ember trail: burning ground bites pursuers
  for (let i = embers.length - 1; i >= 0; i--) {
    const em = embers[i];
    em.t -= dt;
    em.tick -= dt;
    if (em.t <= 0) { disposeVfx(em); embers.splice(i, 1); continue; }
    if (em.f !== G.floor || em.tick > 0) continue;
    em.tick = 0.5;
    for (const e of G.enemies) {
      if (e.state === 'dead' || e.state === 'inactive') continue;
      if (Math.hypot(e.obj.position.x - em.x, e.obj.position.z - em.z) < 1.4 && e.obj.position.y < 2)
        damageEnemy(e, em.dmg, false, false, 'local', { poison: { dps: 3, dur: 1.5 } });
    }
  }
  // domes (chrono bubble visual / sanctuary): fade and expire
  for (let i = domes.length - 1; i >= 0; i--) {
    const dm = domes[i];
    dm.t -= dt;
    if (dm.obj) dm.obj.material.opacity = Math.min(0.28, dm.t * 0.4);
    if (dm.t <= 0) {
      disposeVfx(dm);
      if (dm.sanctuary) G.sanctuaries = (G.sanctuaries || []).filter(s => s !== dm.zone);
      domes.splice(i, 1);
    }
  }
  // war banners: courage radiates from the standard
  for (let i = banners.length - 1; i >= 0; i--) {
    const bn = banners[i];
    bn.t -= dt;
    if (bn.obj) bn.obj.rotation.y += dt * 0.8;
    if (bn.t <= 0) {
      disposeVfx(bn);
      G.banners = (G.banners || []).filter(b => b !== bn.zone);
      banners.splice(i, 1);
      addMsg('The banner falls.');
    }
  }
  // earthsplitter spikes sink back down
  for (let i = spikes.length - 1; i >= 0; i--) {
    const s = spikes[i];
    s.t -= dt;
    if (s.obj) s.obj.position.y = s.baseY - Math.max(0, (0.8 - s.t)) * 1.5;
    if (s.t <= 0) { disposeVfx(s); spikes.splice(i, 1); }
  }
  // true sight: paint every enemy through the walls
  if (G.truesightT > 0) {
    G.truesightT -= dt;
    if (!G._sightSprites) G._sightSprites = new Map();
    const seen = new Set();
    for (const e of G.enemies) {
      if (e.state === 'dead') continue;
      seen.add(e.id);
      let sp2 = G._sightSprites.get(e.id);
      if (!sp2) {
        sp2 = makeGlowSprite(0xff5555, 0.9);
        sp2.material.depthTest = false;
        sp2.renderOrder = 999;
        G.scene.add(sp2);
        G._sightSprites.set(e.id, sp2);
      }
      sp2.position.set(e.obj.position.x, e.obj.position.y + 1.4 * (e.scale || 1), e.obj.position.z);
    }
    for (const [id, sp2] of G._sightSprites) {
      if (!seen.has(id) || G.truesightT <= 0) { G.scene.remove(sp2); sp2.material.dispose(); G._sightSprites.delete(id); }
    }
  } else if (G._sightSprites?.size) {
    for (const sp2 of G._sightSprites.values()) { G.scene.remove(sp2); sp2.material.dispose(); }
    G._sightSprites.clear();
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
  if (cooldowns[spellId] > 0 && !(sp.type === 'lash' && p.lash)) return;
  if (p.mana < sp.mana) { addMsg('Not enough mana!', 'bad'); return; }
  if (sp.arrows && (G.run.arrows || 0) < sp.arrows) { addMsg(`Needs ${sp.arrows} arrows!`, 'bad'); return; }
  if (sp.arrows) { G.run.arrows -= sp.arrows; refreshHud(); }
  p.mana -= sp.mana;
  cooldowns[spellId] = sp.cd;
  const dmg = Math.round(effectiveDamage() * (sp.dmgMult || 1));
  const dir = aimDir();
  const origin = p.obj.position;

  // casting animation & face aim — warriors HEAVE, casters weave
  p.attacking = false;
  const castAnim = sp.phys ? (sp.type === 'aoe' ? '2H_Melee_Attack_Spin' : p.cls.attackAnims[0])
    : sp.type === 'cone' ? 'Block_Attack' : sp.type === 'aoe' ? '2H_Melee_Attack_Spin' : 'Spellcast_Shoot';
  p.anim.play(p.anim.has(castAnim) ? castAnim : 'Spellcast_Shoot', { once: true, timeScale: 1.6 });
  triggerSwing(sp.phys ? 'attack' : 'cast', 0.5);
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
          lifesteal: sp.lifesteal || 0,
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
        // executioner: the wounded are cut down outright
        const low = sp.execute && e.hp / e.maxHp < sp.execute;
        const coneDmg = low ? Math.round(dmg * (sp.execMult || 3)) : dmg;
        if (low) spawnDamageNumber(e.obj.position.clone().setY(e.obj.position.y + 2.2), 'EXECUTE', '#ff4444', true);
        damageEnemy(e, coneDmg, low, false, 'local', { kb: { x: dx / d * sp.knockback, z: dz / d * sp.knockback }, stun: sp.stun });
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
        if (sp.vulnAll) fx.vuln = sp.vulnAll;
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
    case 'raise': {
      // Raise Dead: the earth gives up its dead — a capped legion, the
      // oldest servant quietly returning to dust to make room
      sfx.trap(); sfx.levelup();
      const mine = minions.filter(mm => !mm.dead && mm.owner === myId() && mm.kind === 'skeleton');
      if (mine.length >= (sp.cap || 4)) {
        const oldest = mine[0];
        if (isAuthority()) dismissMinion(oldest);
        else netSend({ t: 'mdismiss', id: oldest.id });
      }
      let px = origin.x + Math.sin(p.yaw) * 2, pz = origin.z + Math.cos(p.yaw) * 2;
      if (posBlocked(px, pz, origin.y)) { px = origin.x; pz = origin.z; }
      const o = { dmg: Math.max(4, Math.round(effectiveDamage() * sp.dmgMult)) };
      if (isAuthority()) spawnMinion('skeleton', myId(), G.floor, px, pz, null, true, o);
      else netSend({ t: 'hire', kind: 'skeleton', f: G.floor, x: px, z: pz, o });
      spawnBurst(new THREE.Vector3(px, 1.0, pz), 0x77ff88, 20, 4, 0.14, 0.6);
      netSend({ t: 'fx', f: G.floor, x: px, y: 1.0, z: pz, color: 0x77ff88 });
      addMsg('The earth gives up its dead.', 'gold');
      break;
    }
    case 'charm': {
      // Dominate: the enemy under your crosshair fights for you
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
      sfx.levelup();
      damageEnemy(target, 1, false, false, 'local', { charm: sp.dur });
      spawnBurst(target.obj.position.clone().setY(target.obj.position.y + 1.4), 0x77ff88, 18, 4, 0.14, 0.6);
      netSend({ t: 'fx', f: G.floor, x: target.obj.position.x, y: target.obj.position.y + 1.4, z: target.obj.position.z, color: 0x77ff88 });
      spawnDamageNumber(target.obj.position.clone().setY(target.obj.position.y + 2.4), 'DOMINATED', '#77ff88', true);
      addMsg('Its will is yours.', 'gold');
      break;
    }
    case 'harvest': {
      // Soul Harvest: rip the life out of everything nearby and wear it
      sfx.crit();
      const from = origin.clone().setY(origin.y + 1.4);
      let total = 0;
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const d = Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z);
        if (d > sp.radius || Math.abs(e.obj.position.y - origin.y) > 3) continue;
        const dealt = Math.min(Math.max(0, e.hp), dmg);
        drawLightning(e.obj.position.clone().setY(e.obj.position.y + 1.1), from, 0x77ff88);
        damageEnemy(e, dmg, false, false, 'local');
        total += dealt;
      }
      if (total) {
        healLocalPlayer(Math.max(2, Math.round(total * sp.healFrac)));
        spawnBurst(origin.clone().setY(origin.y + 1.2), 0x77ff88, 22, 4.5, 0.15, 0.8);
        netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1.2, z: origin.z, color: 0x77ff88 });
        addMsg('Souls harvested — flesh mended.', 'gold');
      } else {
        addMsg('No souls to reap.', 'bad');
      }
      break;
    }
    case 'pact': {
      // Blood Pact: trade flesh for power — costs no mana, only pain
      sfx.hit(); sfx.potion();
      const cost = Math.round(p.maxHp * sp.hpCost);
      p.hp = Math.max(1, p.hp - cost);
      p.mana = Math.min(p.maxMana, p.mana + Math.round(p.maxMana * sp.manaGain));
      spawnDamageNumber(origin.clone().setY(origin.y + 2.2), `-${cost}`, '#ff5566');
      spawnBurst(origin.clone().setY(origin.y + 1.2), 0xcc2233, 20, 4, 0.14, 0.7);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1.2, z: origin.z, color: 0xcc2233 });
      addMsg('You pay in blood.', 'gold');
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
      announceZone('vortex', hit.x, hit.y, hit.z, 0, sp.dur);
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
      announceZone('ward', origin.x, gy, origin.z, 0, sp.dur);
      addMsg('A ward of life takes root.', 'gold');
      break;
    }
    case 'charge': {
      // CHARGE: barrel forward, bowling through everything
      sfx.crit(); sfx.dodge();
      const step = 0.5;
      let travelled = 0;
      const pos = { x: origin.x, z: origin.z, y: origin.y };
      const hitIds = new Set();
      while (travelled < sp.dist) {
        const before = { x: pos.x, z: pos.z };
        moveWithCollision(pos, dir.x * step, dir.z * step, 0.5, { y: pos.y });
        if (pos.x === before.x && pos.z === before.z) break;
        travelled += step;
        for (const e of G.enemies) {
          if (e.state === 'dead' || hitIds.has(e.id)) continue;
          const d = Math.hypot(e.obj.position.x - pos.x, e.obj.position.z - pos.z);
          if (d < 1.5 && Math.abs(e.obj.position.y - pos.y) < 2.2) {
            hitIds.add(e.id);
            const kx = (e.obj.position.x - pos.x) / Math.max(0.1, d) * 10;
            const kz = (e.obj.position.z - pos.z) / Math.max(0.1, d) * 10;
            damageEnemy(e, dmg, false, false, 'local', { kb: { x: kx, z: kz }, stun: 0.4 });
          }
        }
        if (Math.random() < 0.5) spawnBurst(new THREE.Vector3(pos.x, 0.4, pos.z), 0xccbb99, 3, 2, 0.1, 0.3);
      }
      origin.x = pos.x; origin.z = pos.z;
      origin.y = groundHeightAt(pos.x, pos.z, origin.y);
      p.iframes = Math.max(p.iframes, 0.3);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: 1, z: origin.z, color: 0xccbb99, big: 1 });
      break;
    }
    case 'banner': {
      // WAR BANNER: plant the standard — nearby allies hit harder
      sfx.levelup();
      const obj = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a }));
      pole.position.y = 1.2;
      obj.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: 0xcc2222, side: THREE.DoubleSide }));
      flag.position.set(0.45, 2.0, 0);
      obj.add(flag);
      obj.add(makeGlowSprite(0xff6644, 1.6));
      const gy = groundHeightAt(origin.x, origin.z, origin.y);
      obj.position.set(origin.x, gy, origin.z);
      G.scene.add(obj);
      const zone = { x: origin.x, z: origin.z, f: G.floor, r: sp.radius, mult: sp.dmgAura };
      G.banners = G.banners || [];
      G.banners.push(zone);
      banners.push({ t: sp.dur, obj, zone });
      announceZone('banner', origin.x, gy, origin.z, 0, sp.dur);
      addMsg('🚩 The banner is planted — fight beside it!', 'gold');
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: 1.5, z: origin.z, color: 0xff6644 });
      break;
    }
    case 'hook': {
      // CHAIN HOOK: get over here — aimed in the flat plane so height never
      // cheats you out of a grab
      let target = null, best = 0.3;
      const from = origin.clone().setY(origin.y + 1.5);
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive' || e.boss || e.cfg.stalwart) continue;
        const d = Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z);
        if (d > sp.range || d < 0.5) continue;
        const to = e.obj.position.clone().sub(origin).setY(0).normalize();
        const ang = to.angleTo(flat);
        if (ang < best && hasLineOfSight(origin.x, origin.z, e.obj.position.x, e.obj.position.z)) { best = ang; target = e; }
      }
      if (!target) { addMsg('No target in sight.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.bolt(); sfx.bones();
      drawLightning(from, target.obj.position.clone().setY(target.obj.position.y + 1.1));
      const dx = origin.x - target.obj.position.x, dz = origin.z - target.obj.position.z;
      const d = Math.max(0.1, Math.hypot(dx, dz));
      damageEnemy(target, dmg, false, false, 'local', { kb: { x: dx / d * 22, z: dz / d * 22 }, stun: sp.stun });
      addMsg('⛓ Get over here!', 'gold');
      break;
    }
    case 'lash': {
      // GRAVITY LASH: turn gravity toward whatever you pointed at.
      // No teleport — you FALL onto the surface and the world rolls with you.
      const from = origin.clone().setY(origin.y + 1.5);
      // aiming at the vault overhead: gravity fully inverts
      if (dir.y > 0.55) {
        sfx.dodge(); sfx.bolt();
        p.lash = { up: true, g: { x: 0, z: 0 }, vel: 0, grounded: false };
        p.vy = 0;
        drawLightning(from, from.clone().add(new THREE.Vector3(0, 6, 0)));
        addMsg('🧲 GRAVITY INVERTS — you fall into the sky. Mana burns until you release (SPACE).', 'gold');
        break;
      }
      // the ray sees BOTH dungeon walls and solid structures (houses, keeps)
      let blocked = false;
      for (let d = 2; d < sp.range; d += 0.5) {
        const px = from.x + dir.x * d, pz = from.z + dir.z * d;
        const py = Math.max(0.3, from.y + dir.y * d);
        if (!hasLineOfSight(from.x, from.z, px, pz) || posBlocked(px, pz, py)) { blocked = true; break; }
      }
      if (!blocked) { addMsg('Nothing to lash to.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.dodge(); sfx.bolt();
      // walls are axis-aligned: snap gravity PERPENDICULAR to the face you hit,
      // or an oblique aim would leave you sliding along the surface forever
      const g2 = Math.abs(dir.x) > Math.abs(dir.z)
        ? { x: Math.sign(dir.x), z: 0 }
        : { x: 0, z: Math.sign(dir.z) };
      p.lash = { g: g2, vel: 0, grounded: false };
      p.vy = 0;
      drawLightning(from, from.clone().add(new THREE.Vector3(g2.x * 6, 0, g2.z * 6)));
      addMsg('🧲 GRAVITY TURNS — you fall toward it. No mana returns until you do (SPACE).', 'gold');
      break;
    }
    case 'trap': {
      // STEEL TRAP at your feet — oldest trap is recycled past the limit
      sfx.bones();
      const mine = sTraps.filter(t2 => t2.f === G.floor);
      if (mine.length >= (sp.max || 3)) {
        const oldT = mine[0];
        if (oldT.zid) netSend({ t: 'szoneend', id: oldT.zid });
        disposeVfx(oldT);
        sTraps.splice(sTraps.indexOf(oldT), 1);
      }
      const obj = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0x555c66, metalness: 0.4, roughness: 0.5 }));
      base.position.y = 0.04;
      obj.add(base);
      for (let i2 = 0; i2 < 8; i2++) {
        const a2 = (i2 / 8) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 4), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.5 }));
        tooth.position.set(Math.cos(a2) * 0.45, 0.2, Math.sin(a2) * 0.45);
        obj.add(tooth);
      }
      const gy = groundHeightAt(origin.x, origin.z, origin.y);
      obj.position.set(origin.x + dir.x * 1.2, gy, origin.z + dir.z * 1.2);
      G.scene.add(obj);
      const zid = announceZone('trap', obj.position.x, 0, obj.position.z, 0, 120);
      sTraps.push({ x: obj.position.x, z: obj.position.z, f: G.floor, dmg, root: sp.root, obj, zid });
      addMsg('🪤 Trap set.');
      break;
    }
    case 'freeze': {
      // CHRONO BUBBLE: time stops inside the dome
      const hit = aimGroundPoint(origin, dir, sp.range);
      if (!hit) { p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.key(); sfx.trap();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(sp.radius, 18, 12),
        new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.25, depthWrite: false })
      );
      dome.position.set(hit.x, hit.y + 0.5, hit.z);
      G.scene.add(dome);
      domes.push({ t: sp.dur, obj: dome });
      announceZone('dome', hit.x, hit.y, hit.z, sp.radius, sp.dur, 0x88ccff);
      netSend({ t: 'fx', f: G.floor, x: hit.x, y: hit.y + 1, z: hit.z, color: 0x88ccff, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive' || e.boss) continue;
        if (Math.hypot(e.obj.position.x - hit.x, e.obj.position.z - hit.z) > sp.radius) continue;
        damageEnemy(e, 1, false, false, 'local', { stun: sp.dur });
        applyEnemyVfx(e, 'freeze', sp.dur);
        netSend({ t: 'evfx', f: G.floor, id: e.id, kind: 'freeze', dur: sp.dur });
      }
      addMsg('⏳ Time crawls to a halt.', 'gold');
      break;
    }
    case 'swap': {
      // SHADOW SWAP: appear behind your mark, next strike is lethal
      let target = null, best = 0.25;
      const from = origin.clone().setY(origin.y + 1.5);
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const to = e.obj.position.clone().setY(e.obj.position.y + 1.1).sub(from);
        const d = to.length();
        if (d > sp.range) continue;
        const ang = to.normalize().angleTo(dir);
        if (ang < best && hasLineOfSight(origin.x, origin.z, e.obj.position.x, e.obj.position.z)) { best = ang; target = e; }
      }
      if (!target) { addMsg('No target in sight.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.dodge();
      spawnBurst(origin.clone().setY(origin.y + 1), 0x442266, 14, 4, 0.13, 0.5);
      const away = target.obj.position.clone().sub(origin).setY(0).normalize();
      const npos = { x: target.obj.position.x + away.x * 1.4, z: target.obj.position.z + away.z * 1.4, y: target.obj.position.y };
      if (posBlocked(npos.x, npos.z, npos.y)) { npos.x = target.obj.position.x - away.x * 1.4; npos.z = target.obj.position.z - away.z * 1.4; }
      origin.x = npos.x; origin.z = npos.z;
      origin.y = groundHeightAt(npos.x, npos.z, target.obj.position.y + 0.5);
      p.camYaw = Math.atan2(target.obj.position.x - origin.x, target.obj.position.z - origin.z) + Math.PI;
      p.swapCritT = sp.critDur;
      p.iframes = Math.max(p.iframes, 0.4);
      spawnBurst(origin.clone().setY(origin.y + 1), 0x442266, 14, 4, 0.13, 0.5);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1, z: origin.z, color: 0x442266 });
      addMsg('🌑 Behind you. Your next strike lands twice as hard.', 'gold');
      break;
    }
    case 'decoy': {
      // STRAW DOUBLE: a scarecrow of yourself soaks the aggro
      sfx.bones(); sfx.dodge();
      const o = { model: p.cls.model, show: p.cls.show, dmg: 0, life: sp.dur, hp: sp.hp };
      const px = origin.x + dir.x * 2, pz = origin.z + dir.z * 2;
      if (isAuthority()) spawnMinion('decoy', myId(), G.floor, px, pz, null, true, o);
      else netSend({ t: 'hire', kind: 'decoy', f: G.floor, x: px, z: pz, o });
      spawnBurst(new THREE.Vector3(px, 1.2, pz), 0xd9b36c, 16, 4, 0.13, 0.5);
      addMsg('🎭 The straw double takes your place.', 'gold');
      break;
    }
    case 'prison': {
      // FROST PRISON: entomb your mark in ice
      let target = null, best = 0.25;
      const from = origin.clone().setY(origin.y + 1.5);
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive' || e.boss) continue;
        const to = e.obj.position.clone().setY(e.obj.position.y + 1.1).sub(from);
        const d = to.length();
        if (d > sp.range) continue;
        const ang = to.normalize().angleTo(dir);
        if (ang < best && hasLineOfSight(origin.x, origin.z, e.obj.position.x, e.obj.position.z)) { best = ang; target = e; }
      }
      if (!target) { addMsg('No target in sight.', 'bad'); p.mana += sp.mana; cooldowns[spellId] = 0.4; break; }
      sfx.key(); sfx.trap();
      damageEnemy(target, 1, false, false, 'local', { stun: sp.dur, vuln: sp.vuln });
      applyEnemyVfx(target, 'ice', sp.dur);
      netSend({ t: 'evfx', f: G.floor, id: target.id, kind: 'ice', dur: sp.dur });
      addMsg('🧊 Frozen solid — and brittle.', 'gold');
      break;
    }
    case 'sight': {
      sfx.key();
      G.truesightT = sp.dur;
      addMsg('👁 You see every heartbeat through the stone.', 'gold');
      break;
    }
    case 'levitate': {
      sfx.dodge(); sfx.levelup();
      p.levitateT = sp.dur;
      spawnBurst(origin.clone().setY(origin.y + 0.5), 0xccaaff, 18, 4, 0.14, 0.7);
      addMsg('🎈 You rise above the ground.', 'gold');
      break;
    }
    case 'trail': {
      sfx.bolt();
      p.trailT = sp.dur;
      p.trailDropAt = null;
      p.trailDmg = dmg;
      addMsg('🔥 The ground ignites in your wake — run!', 'gold');
      break;
    }
    case 'sanctuary': {
      // SANCTUARY: a dome no enemy bolt can pierce
      sfx.levelup();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(sp.radius, 18, 12),
        new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })
      );
      const gy = groundHeightAt(origin.x, origin.z, origin.y);
      dome.position.set(origin.x, gy + 0.4, origin.z);
      G.scene.add(dome);
      const zone = { x: origin.x, z: origin.z, f: G.floor, r: sp.radius };
      G.sanctuaries = G.sanctuaries || [];
      G.sanctuaries.push(zone);
      domes.push({ t: sp.dur, obj: dome, sanctuary: true, zone });
      announceZone('sanctuary', origin.x, gy, origin.z, sp.radius, sp.dur, 0xffe9a0);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: gy + 1, z: origin.z, color: 0xffe9a0, big: 1 });
      addMsg('🛡 No arrow nor bolt may enter.', 'gold');
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

// ---- weapon signature powers: charged by basic hits, unleashed on key 4 ----
export function castSignature(effectiveDamage) {
  const p = G.player;
  if (!p || p.dead || G.mode !== 'playing') return;
  const w = G.inv.weapon;
  if (!w?.sig) return;
  const sig = SIGNATURES[w.sig];
  if (!sigReady()) { addMsg(`${sig.icon} ${sig.name} needs ${sig.hits} hits to charge.`, 'bad'); return; }
  if (p.mana < sig.mana) { addMsg('Not enough mana!', 'bad'); return; }
  p.mana -= sig.mana;
  spendSigCharge();
  const dmg = effectiveDamage();
  const dir = aimDir();
  const origin = p.obj.position;
  const from = origin.clone().setY(origin.y + 1.45);
  p.anim.play(p.anim.has('Spellcast_Raise') ? 'Spellcast_Raise' : 'Spellcast_Shoot', { once: true, timeScale: 1.5 });
  triggerSwing('cast', 0.5);
  sfx.levelup(); sfx.crit();
  addMsg(`${sig.icon} ${sig.name}!`, 'gold');
  switch (w.sig) {
    case 'radiantbeam': {
      const to = from.clone().add(dir.clone().multiplyScalar(22));
      drawLightning(from, to);
      drawLightning(from, to);
      netSend({ t: 'beam', f: G.floor, a: [from.x, from.y, from.z], b: [to.x, to.y, to.z] });
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const ep = e.obj.position.clone().setY(e.obj.position.y + 1.1);
        const t2 = Math.max(0, Math.min(1, ep.clone().sub(from).dot(dir) / 22));
        const closest = from.clone().add(dir.clone().multiplyScalar(t2 * 22));
        if (ep.distanceTo(closest) < 1.4) damageEnemy(e, Math.round(dmg * 2.2), true, false, 'local');
      }
      break;
    }
    case 'firenova': {
      spawnBurst(origin.clone().setY(origin.y + 0.8), 0xff5511, 40, 9, 0.2, 0.6);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 0.8, z: origin.z, color: 0xff5511, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead') continue;
        if (Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z) > 6) continue;
        damageEnemy(e, Math.round(dmg * 1.8), false, false, 'local', { poison: { dps: Math.round(dmg * 0.25), dur: 3 } });
      }
      break;
    }
    case 'thunderclap': {
      spawnBurst(origin.clone().setY(origin.y + 1), 0x99ddff, 34, 8, 0.18, 0.5);
      netSend({ t: 'fx', f: G.floor, x: origin.x, y: origin.y + 1, z: origin.z, color: 0x99ddff, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead') continue;
        if (Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z) > 5.5) continue;
        drawLightning(from, e.obj.position.clone().setY(e.obj.position.y + 1.2));
        damageEnemy(e, Math.round(dmg * 1.4), false, false, 'local', { stun: 1.2 });
      }
      break;
    }
    case 'voidrip': {
      const hit = aimGroundPoint(origin, dir, 20) || { x: origin.x + dir.x * 8, y: origin.y, z: origin.z + dir.z * 8 };
      const obj = new THREE.Group();
      obj.add(makeGlowSprite(0xbb66ff, 3));
      obj.position.set(hit.x, hit.y + 1.1, hit.z);
      G.scene.add(obj);
      vortices.push({ x: hit.x, y: hit.y, z: hit.z, f: G.floor, t: 2.4, tick: 0, radius: 6, dmg: Math.round(dmg * 1.5), obj });
      announceZone('vortex', hit.x, hit.y, hit.z, 0, 2.4);
      break;
    }
    case 'lifedrain': {
      let total = 0;
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        if (Math.hypot(e.obj.position.x - origin.x, e.obj.position.z - origin.z) > 7) continue;
        drawLightning(e.obj.position.clone().setY(e.obj.position.y + 1.1), from);
        damageEnemy(e, Math.round(dmg * 1.2), false, false, 'local');
        total += Math.round(dmg * 1.2);
      }
      if (total) {
        healLocalPlayer(Math.max(2, Math.round(total * 0.5)));
        spawnBurst(origin.clone().setY(origin.y + 1.2), 0x66ff88, 20, 4, 0.14, 0.7);
      }
      break;
    }
    case 'arrowstorm': {
      for (let i = 0; i < 7; i++) {
        const spread = (i - 3) * 0.09;
        const cos = Math.cos(spread), sin = Math.sin(spread);
        const dx = dir.x * cos - dir.z * sin, dz = dir.x * sin + dir.z * cos;
        const b = { x: from.x + dx * 0.7, y: from.y, z: from.z + dz * 0.7, dirX: dx, dirY: dir.y, dirZ: dz, speed: 30, dmg: Math.round(dmg * 0.9), owner: 'player', color: 0xd8e6b0, vis: 'arrow', pierce: true };
        spawnBolt(b);
        netSend({ t: 'bolt', f: G.floor, b: { ...b, owner: 'fx' } });
      }
      break;
    }
    case 'frostwave': {
      spawnBurst(from.clone().add(dir.clone().multiplyScalar(3)), 0xaaddff, 26, 7, 0.16, 0.5);
      netSend({ t: 'fx', f: G.floor, x: from.x + dir.x * 3, y: from.y, z: from.z + dir.z * 3, color: 0xaaddff, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const dx = e.obj.position.x - origin.x, dz = e.obj.position.z - origin.z;
        const d = Math.hypot(dx, dz);
        if (d > 8) continue;
        let ang = Math.atan2(dx, dz) - p.yaw;
        while (ang > Math.PI) ang -= Math.PI * 2;
        while (ang < -Math.PI) ang += Math.PI * 2;
        if (Math.abs(ang) > 0.9) continue;
        damageEnemy(e, Math.round(dmg * 1.3), false, false, 'local', { slow: { mult: 0.35, dur: 3 } });
      }
      break;
    }
    case 'shadowflurry': {
      const near = G.enemies.filter(e => e.state !== 'dead' && e.state !== 'inactive' &&
        e.obj.position.distanceTo(origin) < 10).sort((a2, b2) => a2.obj.position.distanceTo(origin) - b2.obj.position.distanceTo(origin)).slice(0, 3);
      if (!near.length) { addMsg('No one to strike.', 'bad'); p.mana += sig.mana; break; }
      let last = null;
      for (const e of near) {
        spawnBurst(e.obj.position.clone().setY(e.obj.position.y + 1.1), 0x442266, 12, 4, 0.12, 0.4);
        damageEnemy(e, Math.round(dmg * 1.5), true, false, 'local');
        last = e;
      }
      if (last) {
        const away = last.obj.position.clone().sub(origin).setY(0).normalize();
        const nx = last.obj.position.x + away.x * 1.4, nz = last.obj.position.z + away.z * 1.4;
        if (!posBlocked(nx, nz, last.obj.position.y)) { origin.x = nx; origin.z = nz; origin.y = groundHeightAt(nx, nz, origin.y + 0.5); }
        p.iframes = Math.max(p.iframes, 0.4);
      }
      break;
    }
    case 'earthsplitter': {
      sfx.trap();
      for (let i = 1; i <= 6; i++) {
        const px = origin.x + dir.x * i * 1.6, pz = origin.z + dir.z * i * 1.6;
        const gy = groundHeightAt(px, pz, origin.y);
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.5, 5), new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.9 }));
        spike.position.set(px, gy + 0.6, pz);
        G.scene.add(spike);
        spikes.push({ t: 0.8 + i * 0.05, baseY: gy + 0.6, obj: spike });
        spawnBurst(new THREE.Vector3(px, gy + 0.4, pz), 0x9a8a76, 8, 4, 0.12, 0.4);
        netSend({ t: 'fx', f: G.floor, x: px, y: gy + 0.4, z: pz, color: 0x9a8a76 });
        for (const e of G.enemies) {
          if (e.state === 'dead') continue;
          if (Math.hypot(e.obj.position.x - px, e.obj.position.z - pz) < 2) damageEnemy(e, Math.round(dmg * 1.5), false, false, 'local', { stun: 0.5 });
        }
      }
      break;
    }
    case 'dragonsbreath': {
      spawnBurst(from.clone().add(dir.clone().multiplyScalar(2.5)), 0xff7722, 30, 7, 0.18, 0.6);
      netSend({ t: 'fx', f: G.floor, x: from.x + dir.x * 2.5, y: from.y, z: from.z + dir.z * 2.5, color: 0xff7722, big: 1 });
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const dx = e.obj.position.x - origin.x, dz = e.obj.position.z - origin.z;
        const d = Math.hypot(dx, dz);
        if (d > 7) continue;
        let ang = Math.atan2(dx, dz) - p.yaw;
        while (ang > Math.PI) ang -= Math.PI * 2;
        while (ang < -Math.PI) ang += Math.PI * 2;
        if (Math.abs(ang) > 0.8) continue;
        damageEnemy(e, dmg, false, false, 'local', { poison: { dps: Math.max(3, Math.round(dmg * 0.4)), dur: 4 } });
      }
      break;
    }
  }
  refreshHud();
}

// ---- spell zone visuals every client must see ----
// The caster runs the real effect; everyone else builds the same OBJECT from
// an 'szone' message and expires it on schedule.
const remoteZones = [];
let zoneIdCounter = 1;

function buildZoneVisual(kind, m) {
  const g = new THREE.Group();
  if (kind === 'trap') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0x555c66, metalness: 0.4, roughness: 0.5 }));
    base.position.y = 0.04;
    g.add(base);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 4), new THREE.MeshStandardMaterial({ color: 0x8a939e, metalness: 0.5 }));
      tooth.position.set(Math.cos(a) * 0.45, 0.2, Math.sin(a) * 0.45);
      g.add(tooth);
    }
  } else if (kind === 'dome' || kind === 'sanctuary') {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(m.r || 5, 18, 12),
      new THREE.MeshBasicMaterial({ color: m.color || 0x88ccff, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide })
    );
    dome.position.y = 0.5;
    g.add(dome);
  } else if (kind === 'ward') {
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: 0x116644, emissive: 0x44ffaa, emissiveIntensity: 1.3 }));
    crystal.scale.y = 1.9;
    crystal.position.y = 0.7;
    g.add(crystal);
    const gl = makeGlowSprite(0x66ffbb, 2.0);
    gl.position.y = 0.7;
    g.add(gl);
  } else if (kind === 'banner') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.4, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a }));
    pole.position.y = 1.2;
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: 0xcc2222, side: THREE.DoubleSide }));
    flag.position.set(0.45, 2.0, 0);
    g.add(flag);
    g.add(makeGlowSprite(0xff6644, 1.6));
  } else if (kind === 'vortex') {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x220033, emissive: 0xbb66ff, emissiveIntensity: 1.4, transparent: true, opacity: 0.85 })
    );
    g.add(core);
    g.add(makeGlowSprite(0xbb66ff, 2.6));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.07, 6, 24), new THREE.MeshStandardMaterial({ color: 0x8844cc, emissive: 0x9955ee, emissiveIntensity: 1.1 }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.position.y = 1.1;
  }
  return g;
}

// broadcast a zone so teammates see the object too; returns its id
function announceZone(kind, x, y, z, r, dur, color) {
  const id = 'z' + (zoneIdCounter++) + '-' + Math.floor(Math.random() * 1e6);
  netSend({ t: 'szone', id, kind, f: G.floor, x, y, z, r, dur, color });
  return id;
}
export function endRemoteZone(id) {
  const i = remoteZones.findIndex(z2 => z2.id === id);
  if (i >= 0) { disposeVfx(remoteZones[i]); remoteZones.splice(i, 1); }
}
export function applyRemoteZone(m) {
  const obj = buildZoneVisual(m.kind, m);
  obj.position.x = m.x; obj.position.z = m.z;
  obj.position.y += m.y || 0;
  G.scene.add(obj);
  remoteZones.push({ id: m.id, kind: m.kind, f: m.f, t: m.dur, obj });
}

// ember-trail hook used by player.js without an import cycle
G.dropEmber = (x, z, dmg) => {
  const obj = new THREE.Group()
  obj.add(makeGlowSprite(0xff7722, 1.1));
  obj.position.set(x, 0.35, z);
  G.scene.add(obj);
  embers.push({ x, z, f: G.floor, t: 3, tick: 0, dmg, obj });
  netSend({ t: 'fx', f: G.floor, x, y: 0.4, z, color: 0xff7722 });
};

// quick lightning beam visual
const beams = [];
function drawLightning(a, b, color = 0x99ddff) {
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
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  G.scene.add(line);
  beams.push({ line, t: 0 });
  netSend({ t: 'beam', f: G.floor, a: [a.x, a.y, a.z], b: [b.x, b.y, b.z], c: color });
}

export function remoteBeam(a, b, c) {
  drawLightningLocal(new THREE.Vector3(...a), new THREE.Vector3(...b), c || 0x99ddff);
}
function drawLightningLocal(a, b, color = 0x99ddff) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
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

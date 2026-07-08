// Magic bolts & thrown weapons in full 3D. Owner's simulation applies damage;
// cosmetic-only bolts are spawned for remote players' shots.
import * as THREE from 'three';
import { G } from './state.js';
import { makeGlowSprite, spawnBurst } from './fx.js';
import { groundHeightAt } from './dungeon.js';
import { sfx } from './audio.js';

const CELL = 4;

function solidAt(x, z) {
  if (!G.grid) return true;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return true;
  return G.grid.cells[cy * G.grid.w + cx] === 0;
}

export function spawnBolt(b) {
  const { x, z, dirX, dirZ, speed = 16, dmg = 0, owner = 'fx', color = 0xff8833 } = b;
  const y = b.y ?? 1.4;
  const dirY = b.dirY ?? 0;
  const sp = makeGlowSprite(color, 0.9 * (b.size || 1));
  sp.position.set(x, y, z);
  G.scene.add(sp);
  G.projectiles.push({
    sp, x, z, y, dirX, dirY, dirZ, speed, dmg, owner, color, life: 0,
    size: b.size || 1, aoe: b.aoe || 0, slow: b.slow || null, poison: b.poison || null,
  });
}

export function clearProjectiles() {
  for (const p of G.projectiles) { G.scene.remove(p.sp); p.sp.material.dispose(); }
  G.projectiles = [];
}

function explode(p, hooks) {
  spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, p.aoe ? 26 : 8, p.aoe ? 7 : 3, p.aoe ? 0.17 : 0.1, p.aoe ? 0.55 : 0.35);
  if (p.aoe && p.owner === 'player') {
    sfx.trap();
    for (const e of G.enemies) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.obj.position.x - p.x, e.obj.position.z - p.z);
      if (d > p.aoe || Math.abs(e.obj.position.y + 1 - p.y) > 3.5) continue;
      hooks.damageEnemy(e, Math.round(p.dmg * (d < p.aoe * 0.5 ? 1 : 0.6)), false, false, 'local',
        { slow: p.slow, poison: p.poison });
    }
  }
}

export function updateProjectiles(dt, hooks) {
  // hooks: { damageEnemy(enemy, dmg, crit, fromNet, source, effects), damageLocalPlayer(dmg, effects) }
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.life += dt;
    p.x += p.dirX * p.speed * dt;
    p.y += (p.dirY || 0) * p.speed * dt;
    p.z += p.dirZ * p.speed * dt;
    p.sp.position.set(p.x, p.y + Math.sin(p.life * 20) * 0.03, p.z);
    let dead = p.life > 2.2 || solidAt(p.x, p.z) ||
      p.y < groundHeightAt(p.x, p.z, p.y) + 0.12 || p.y > 14;

    if (!dead && p.owner === 'player') {
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const r = 0.95 * (e.scale || 1);
        if (Math.hypot(e.obj.position.x - p.x, e.obj.position.z - p.z) < r &&
            Math.abs(e.obj.position.y + 1.1 * e.scale - p.y) < 1.5 * e.scale) {
          if (p.aoe) { explode(p, hooks); p.exploded = true; }
          else hooks.damageEnemy(e, p.dmg, Math.random() < 0.08, false, 'local', { slow: p.slow, poison: p.poison });
          dead = true;
          break;
        }
      }
    } else if (!dead && p.owner === 'enemy') {
      const pl = G.player;
      if (pl && !pl.dead && pl.iframes <= 0 &&
          Math.hypot(pl.obj.position.x - p.x, pl.obj.position.z - p.z) < 0.8 &&
          Math.abs(pl.obj.position.y + 1.3 - p.y) < 1.6) {
        hooks.damageLocalPlayer(p.dmg, p.slow ? { slow: p.slow } : null);
        dead = true;
      }
    }
    if (dead) {
      if (p.aoe && p.owner === 'player' && !p.exploded) explode(p, hooks);
      else if (!p.aoe) spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, 8, 3, 0.1, 0.35);
      G.scene.remove(p.sp);
      p.sp.material.dispose();
      G.projectiles.splice(i, 1);
    }
  }
}

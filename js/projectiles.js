// Magic bolts (player mage + skeleton mages). Owner's simulation applies damage;
// cosmetic-only bolts are spawned for remote players' shots.
import * as THREE from 'three';
import { G } from './state.js';
import { makeGlowSprite, spawnBurst } from './fx.js';

const CELL = 4;

function solidAt(x, z) {
  if (!G.grid) return true;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return true;
  const c = G.grid.cells[cy * G.grid.w + cx];
  return c === 0 || c === 5;
}

export function spawnBolt({ x, z, dirX, dirZ, speed = 16, dmg = 0, owner = 'fx', color = 0xff8833, y = 1.4 }) {
  const sp = makeGlowSprite(color, 0.9);
  sp.position.set(x, y, z);
  G.scene.add(sp);
  G.projectiles.push({ sp, x, z, y, dirX, dirZ, speed, dmg, owner, color, life: 0 });
}

export function clearProjectiles() {
  for (const p of G.projectiles) { G.scene.remove(p.sp); p.sp.material.dispose(); }
  G.projectiles = [];
}

export function updateProjectiles(dt, hooks) {
  // hooks: { damageEnemy(enemy, dmg, isCrit), damageLocalPlayer(dmg) }
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.life += dt;
    p.x += p.dirX * p.speed * dt;
    p.z += p.dirZ * p.speed * dt;
    p.sp.position.set(p.x, p.y + Math.sin(p.life * 20) * 0.03, p.z);
    let dead = p.life > 2.2 || solidAt(p.x, p.z);

    if (!dead && p.owner === 'player') {
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const r = 0.9 * (e.scale || 1);
        if (Math.hypot(e.obj.position.x - p.x, e.obj.position.z - p.z) < r) {
          hooks.damageEnemy(e, p.dmg, Math.random() < 0.08);
          dead = true;
          break;
        }
      }
    } else if (!dead && p.owner === 'enemy') {
      const pl = G.player;
      if (pl && !pl.dead && pl.iframes <= 0 &&
          Math.hypot(pl.obj.position.x - p.x, pl.obj.position.z - p.z) < 0.8) {
        hooks.damageLocalPlayer(p.dmg);
        dead = true;
      }
    }
    if (dead) {
      spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, 8, 3, 0.1, 0.35);
      G.scene.remove(p.sp);
      p.sp.material.dispose();
      G.projectiles.splice(i, 1);
    }
  }
}

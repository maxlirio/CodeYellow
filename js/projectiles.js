// Projectiles with DISTINCT visuals per spell: real spinning axes and knives,
// tumbling venom vials, crystalline frost shards, roaring fireballs, holy stars,
// pulsing arcane orbs, and true fletched arrows — no generic orbs.
import * as THREE from 'three';
import { G } from './state.js';
import { makeGlowSprite, spawnBurst } from './fx.js';
import { groundHeightAt, boltBlocked } from './dungeon.js';
import { buildFireballVisual, animateFireball, spawnFireImpact } from './firefx.js';
import { makeWeaponModel, makePiece } from './assets.js';
import { sfx } from './audio.js';
import { netSend } from './net.js';

const CELL = 4;

// A bolt stops on anything a body would: SOLID cells, bone walls / barricades
// (OBSTACLE), player builds, pillars and props. It used to test SOLID alone, so
// every arrow flew straight through the Bone Wall you paid 24 mana for.
function solidAt(x, z, y) {
  if (!G.grid) return true;
  return boltBlocked(x, z, y);
}

// The volume a bolt has to enter to hit an enemy. For most monsters that's a
// slim cylinder round the model, but big-bodied ones carry cfg.bodyR (the dragon
// is 4.5) — MELEE already subtracts bodyR, so bolts must honour it too, or you
// put an arrow through Emberwing's head and watch it burst on the wall behind.
function enemyHitbox(e) {
  const s = e.scale || 1;
  const bodyR = e.cfg?.bodyR || 0;
  if (!bodyR) return { r: 0.95 * s, cy: 1.1 * s, hy: 1.5 * s };
  return { r: bodyR, cy: bodyR * 0.8, hy: bodyR };
}

// build the visual for a projectile; returns { obj, spin:'blade'|'tumble'|'pulse'|null, orient:bool, trail }
function buildVisual(b) {
  const size = b.size || 1;
  const color = b.color ?? 0xff8833;
  switch (b.vis) {
    case 'arrow': {
      const obj = makeWeaponModel('arrow');
      obj.scale.setScalar(1.5 * size);
      return { obj, orient: true, trail: { color: 0xd8e6b0, rate: 0.05, n: 1, s: 0.05 } };
    }
    case 'axe': {
      const obj = new THREE.Group();
      const axe = makeWeaponModel('axe_1handed');
      axe.scale.setScalar(1.2);
      axe.rotation.x = Math.PI / 2; // blade into the travel plane (group is velocity-oriented)
      obj.add(axe);
      return { obj, orient: true, spin: 'wheel', trail: { color: 0xffaa66, rate: 0.06, n: 2, s: 0.08 } };
    }
    case 'knife': {
      const obj = new THREE.Group();
      const k = makeWeaponModel('dagger');
      k.scale.setScalar(1.3);
      k.rotation.x = Math.PI / 2;
      obj.add(k);
      return { obj, orient: true, spin: 'wheel', trail: { color: 0xccddee, rate: 0.08, n: 1, s: 0.05 } };
    }
    case 'vial': {
      const obj = new THREE.Group();
      const v = makePiece('bottle_A_green');
      v.scale.setScalar(1.6);
      v.position.y = -0.3;
      obj.add(v);
      return { obj, spin: 'tumble', trail: { color: 0x66ff44, rate: 0.05, n: 2, s: 0.08 } };
    }
    case 'shard': {
      const obj = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x66bbee, emissiveIntensity: 0.9, roughness: 0.2 });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 * size, 0), mat);
      core.scale.z = 2.4;
      obj.add(core);
      return { obj, orient: true, spin: 'roll', trail: { color: 0xaaddff, rate: 0.04, n: 2, s: 0.07 } };
    }
    case 'orb': {
      const obj = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.5 * size, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x9944ff, emissive: 0xbb66ff, emissiveIntensity: 1.1, roughness: 0.3, transparent: true, opacity: 0.9 })
      );
      obj.add(core);
      for (let i = 0; i < 3; i++) {
        const mote = makeGlowSprite(0xdd99ff, 0.5);
        mote.userData.orbit = { a: (i / 3) * Math.PI * 2, r: 0.8 * size };
        obj.add(mote);
      }
      return { obj, spin: 'pulse', trail: { color: 0xbb66ff, rate: 0.05, n: 2, s: 0.1 } };
    }
    case 'fireball': {
      // faceted molten core in a counter-spinning shell, shedding real embers —
      // a smooth sphere behind a soft glow sprite read as a bead, not as fire
      return { obj: buildFireballVisual(size), fire: true };
    }
    case 'fire': {
      const obj = new THREE.Group();
      obj.add(makeGlowSprite(0xff7722, 0.8 * size));
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.15 * size, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x883311, emissive: 0xffaa33, emissiveIntensity: 1.4 })
      );
      obj.add(core);
      return { obj, trail: { color: 0xff8833, rate: 0.05, n: 1, s: 0.06 } };
    }
    case 'holy': {
      const obj = new THREE.Group();
      const star = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.26 * size, 0),
        new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffdd77, emissiveIntensity: 1.5 })
      );
      obj.add(star);
      obj.add(makeGlowSprite(0xffe9a0, 1.3 * size));
      return { obj, spin: 'pulse', trail: { color: 0xffe08a, rate: 0.04, n: 2, s: 0.08 } };
    }
    case 'laser': {
      // a hard bright energy bolt: stretched core + halo, oriented along flight
      const obj = new THREE.Group();
      const coreGeo = new THREE.CylinderGeometry(0.035 * size, 0.035 * size, 0.9 * size, 6);
      coreGeo.rotateX(Math.PI / 2);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      obj.add(core);
      // radial halo: a cylinder looks the same from every angle — a box read as
      // a big flat quad when a bolt flew straight away from the camera
      const haloGeo = new THREE.CylinderGeometry(0.09 * size, 0.09 * size, 1.0 * size, 8, 1, true);
      haloGeo.rotateX(Math.PI / 2);
      const halo = new THREE.Mesh(
        haloGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })
      );
      obj.add(halo);
      const pl = new THREE.PointLight(color, 2.5, 7);
      obj.add(pl);
      return { obj, orient: true, trail: { color, rate: 0.05, n: 1, s: 0.06 } };
    }
    case 'wisp': {
      const obj = new THREE.Group();
      obj.add(makeGlowSprite(color, 0.9 * size));
      obj.add(makeGlowSprite(0xffffff, 0.35 * size));
      return { obj, trail: { color, rate: 0.06, n: 1, s: 0.07 } };
    }
    default: {
      const obj = new THREE.Group();
      obj.add(makeGlowSprite(color, 0.9 * size));
      return { obj, trail: null };
    }
  }
}

export function spawnBolt(b) {
  const { x, z, dirX, dirZ, speed = 16, dmg = 0, owner = 'fx', color = 0xff8833 } = b;
  const y = b.y ?? 1.4;
  const dirY = b.dirY ?? 0;
  const vis = buildVisual(b);
  vis.obj.position.set(x, y, z);
  if (vis.orient) {
    // point along the velocity (arrow/shard models face +z after this)
    const target = new THREE.Vector3(x + dirX, y + dirY, z + dirZ);
    vis.obj.lookAt(target);
    if (b.vis === 'arrow') vis.obj.rotateX(-Math.PI / 2); // arrow model points +y; tip must lead
  }
  G.scene.add(vis.obj);
  G.projectiles.push({
    sp: vis.obj, vis, x, z, y, dirX, dirY, dirZ, speed, dmg, owner, color, life: 0, trailT: 0,
    size: b.size || 1, aoe: b.aoe || 0, slow: b.slow || null, poison: b.poison || null, basic: !!b.basic,
    lifesteal: b.lifesteal || 0, pierce: !!b.pierce, hitIds: null, bounce: b.bounce || 0,
  });
}

export function clearProjectiles() {
  for (const p of G.projectiles) disposeBolt(p);
  G.projectiles = [];
}

function disposeBolt(p) {
  G.scene.remove(p.sp);
  p.sp.traverse((n) => {
    if (n.isMesh) { n.geometry?.dispose(); n.material?.dispose?.(); }
    if (n.isSprite) n.material?.dispose?.();
  });
}

function explode(p, hooks) {
  if (p.vis?.fire) spawnFireImpact(new THREE.Vector3(p.x, p.y, p.z), G.floor, p.aoe ? 1.5 : 0.9);
  else spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, p.aoe ? 26 : 8, p.aoe ? 7 : 3, p.aoe ? 0.17 : 0.1, p.aoe ? 0.55 : 0.35);
  if (p.aoe && p.owner === 'player') {
    sfx.trap();
    for (const e of G.enemies) {
      if (e.state === 'dead') continue;
      const hb = enemyHitbox(e);
      // the blast reaches the enemy's SURFACE, not just its origin — a fireball
      // landing under the dragon's flank has to hurt her
      const d = Math.max(0, Math.hypot(e.obj.position.x - p.x, e.obj.position.z - p.z) - hb.r);
      if (d > p.aoe || Math.abs(e.obj.position.y + hb.cy - p.y) > 3.5 + hb.hy) continue;
      hooks.damageEnemy(e, Math.round(p.dmg * (d < p.aoe * 0.5 ? 1 : 0.6)), false, false, 'local',
        { slow: p.slow, poison: p.poison });
    }
  }
}

// A bolt advances in ONE jump per frame and only its endpoint is tested for
// hits. A 30 u/s arrow covers 1.5 units in a 50ms frame, while a slimelet's
// hitbox is 0.38 across — so the arrow can step clean over it and never sample
// inside. (The same gap tunnels thin walls the moment dt rises above the clamp.)
// Sub-step so no single advance outruns the smallest thing it could hit.
const MAX_STEP = 0.35;
export function updateProjectiles(dt, hooks) {
  let fastest = 0;
  for (const p of G.projectiles) if (p.speed > fastest) fastest = p.speed;
  const n = Math.min(8, Math.max(1, Math.ceil((fastest * dt) / MAX_STEP)));
  for (let s = 0; s < n; s++) stepProjectiles(dt / n, hooks);
}

function stepProjectiles(dt, hooks) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i];
    p.life += dt;
    const prevX = p.x, prevZ = p.z;
    p.x += p.dirX * p.speed * dt;
    p.y += (p.dirY || 0) * p.speed * dt;
    p.z += p.dirZ * p.speed * dt;
    // ricochet: bounce off walls and floor instead of bursting
    if (p.bounce > 0) {
      if (solidAt(p.x, p.z, p.y)) {
        const bx = solidAt(p.x, prevZ, p.y), bz = solidAt(prevX, p.z, p.y);
        if (bx || !bz) p.dirX = -p.dirX;
        if (bz || !bx) p.dirZ = -p.dirZ;
        p.x = prevX; p.z = prevZ;
        p.bounce--;
        spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, 8, 3, 0.1, 0.3);
        sfx.hit();
      }
      const g = groundHeightAt(p.x, p.z, p.y);
      if (p.y < g + 0.15 && (p.dirY || 0) < 0) {
        p.dirY = Math.abs(p.dirY) * 0.85;
        p.y = g + 0.16;
        p.bounce--;
        spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, 8, 3, 0.1, 0.3);
      }
    }
    p.sp.position.set(p.x, p.y, p.z);

    // per-visual motion
    const v = p.vis;
    if (v.fire) animateFireball(p.sp, dt, G.floor);
    if (v.spin === 'blade') p.sp.rotation.z -= dt * 16; // wheel spin (legacy, unoriented)
    else if (v.spin === 'wheel') p.sp.rotateX(dt * 16);  // tomahawk flip in the vertical travel plane
    else if (v.spin === 'tumble') { p.sp.rotation.x += dt * 7; p.sp.rotation.z += dt * 5; }
    else if (v.spin === 'roll') p.sp.rotateZ(dt * 9);
    else if (v.spin === 'pulse') {
      const s = 1 + Math.sin(p.life * 12) * 0.12;
      p.sp.scale.setScalar(s);
      p.sp.children.forEach((c) => {
        if (c.userData.orbit) {
          c.userData.orbit.a += dt * 6;
          c.position.set(Math.cos(c.userData.orbit.a) * c.userData.orbit.r, Math.sin(c.userData.orbit.a * 1.3) * 0.3, Math.sin(c.userData.orbit.a) * c.userData.orbit.r);
        }
      });
    }
    // particle trail
    if (v.trail) {
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = v.trail.rate;
        spawnBurst(new THREE.Vector3(p.x, p.y, p.z), v.trail.color, v.trail.n, 0.4, v.trail.s, 0.35);
      }
    }

    let dead = p.life > (p.bounce > 0 ? 4.5 : 2.2) || solidAt(p.x, p.z, p.y) ||
      p.y < groundHeightAt(p.x, p.z, p.y) + 0.12 || p.y > 16;

    if (!dead && p.owner === 'player' && G.runMode === 'duel') {
      for (const [pid, r] of G.remotes) {
        if (r.dead || r.floor !== G.floor) continue;
        if (Math.hypot(r.obj.position.x - p.x, r.obj.position.z - p.z) < 0.85 &&
            Math.abs(r.obj.position.y + 1.3 - p.y) < 1.6) {
          netSend({ t: 'pvp', target: pid, dmg: p.dmg, by: G.player?.name });
          dead = true;
          break;
        }
      }
    }
    if (!dead && p.owner === 'player') {
      for (const e of G.enemies) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        if (p.hitIds && p.hitIds.has(e.id)) continue;
        const hb = enemyHitbox(e);
        if (Math.hypot(e.obj.position.x - p.x, e.obj.position.z - p.z) < hb.r &&
            Math.abs(e.obj.position.y + hb.cy - p.y) < hb.hy) {
          if (p.aoe) { explode(p, hooks); p.exploded = true; dead = true; }
          else {
            hooks.damageEnemy(e, p.dmg, Math.random() < 0.08, false, 'local', { slow: p.slow, poison: p.poison, lifesteal: p.lifesteal });
            if (p.basic) hooks.onBasicHit?.();
            if (p.pierce) {
              (p.hitIds ??= new Set()).add(e.id);
              spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, 6, 3, 0.1, 0.3);
            } else dead = true;
          }
          if (dead) break;
        }
      }
    } else if (!dead && p.owner === 'enemy') {
      // sanctuaries swallow hostile bolts at their edge
      for (const s of G.sanctuaries || []) {
        if (s.f === G.floor && Math.hypot(p.x - s.x, p.z - s.z) < s.r) {
          spawnBurst(new THREE.Vector3(p.x, p.y, p.z), 0xffe9a0, 8, 3, 0.1, 0.35);
          dead = true;
          break;
        }
      }
      const pl = G.player;
      if (!dead && pl && !pl.dead && pl.iframes <= 0 &&
          Math.hypot(pl.obj.position.x - p.x, pl.obj.position.z - p.z) < 0.8 &&
          Math.abs(pl.obj.position.y + 1.3 - p.y) < 1.6) {
        hooks.damageLocalPlayer(p.dmg, p.slow ? { slow: p.slow } : null);
        dead = true;
      }
    }
    if (dead) {
      if (p.aoe && p.owner === 'player' && !p.exploded) explode(p, hooks);
      else if (p.vis?.fire) spawnFireImpact(new THREE.Vector3(p.x, p.y, p.z), G.floor, 0.8); // burst on the wall too
      else if (!p.aoe) spawnBurst(new THREE.Vector3(p.x, p.y, p.z), p.color, 8, 3, 0.1, 0.35);
      disposeBolt(p);
      G.projectiles.splice(i, 1);
    }
  }
}

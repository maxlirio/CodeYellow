// VOID PATROL — the first taste of the flight game: hop in a fighter, clear
// the drones prowling the hulk. Unlocked by clearing the SPACE PORT.
// Solo arena at y+800, its own tiny sim: chase cam, twin lasers, drone foes.
import * as THREE from 'three';
import { G } from './state.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { spawnBurst } from './fx.js';
import { saveReport } from './bridge.js';

const ORIGIN = new THREE.Vector3(0, 800, 0);
let S = null; // flight state

function starSphere() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#020409';
  ctx.fillRect(0, 0, 2048, 1024);
  let seed = 777;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2600; i++) {
    const b = rnd();
    ctx.fillStyle = b > 0.94 ? '#bfe6ff' : b > 0.7 ? '#ffffff' : '#7d8ba0';
    const r = b > 0.97 ? 2.4 : b > 0.85 ? 1.5 : 0.8;
    ctx.fillRect(rnd() * 2048, rnd() * 1024, r, r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 16),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: false, fog: false }));
}

// a boxy X-wing style fighter; `hostile` swaps the trim red
function buildFighter(hostile = false) {
  const grp = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: hostile ? 0x5a4a4c : 0x9aa6b4, metalness: 0.4, roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: hostile ? 0xff4433 : 0x4fe8e0, emissiveIntensity: 1.6, toneMapped: false,
  });
  const M = (geo, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.x = rx; m.rotation.z = rz;
    grp.add(m); return m;
  };
  M(new THREE.BoxGeometry(1.1, 0.9, 4.4), body, 0, 0, 0);                    // fuselage
  M(new THREE.ConeGeometry(0.55, 1.6, 4), body, 0, 0, 2.9, Math.PI / 2);    // nose
  M(new THREE.BoxGeometry(0.7, 0.5, 1.0), trim, 0, 0.35, 1.7);              // canopy
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {            // X wings
    M(new THREE.BoxGeometry(2.8, 0.14, 1.2), body, sx * 1.85, sy * 0.55, -0.9, 0, sx * sy * 0.35);
    M(new THREE.BoxGeometry(0.3, 0.3, 0.9), trim, sx * 3.1, sy * 1.05, -1.1, 0, 0); // wingtip gun/engine
  }
  M(new THREE.BoxGeometry(0.5, 0.5, 0.3), trim, 0, 0, -2.3);                // engine glow
  return grp;
}

export function inSpace() { return !!S; }

export function startSpaceFlight() {
  if (S) return;
  const group = new THREE.Group();
  group.position.copy(ORIGIN);
  group.add(starSphere());
  // the hulk drifts huge and dark below — orientation anchor
  const hulk = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: 0x2c3138, metalness: 0.5, roughness: 0.7 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(220, 40, 70), hm);
  hulk.add(hull);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(120, 22, 40), hm);
  spine.position.set(-30, 30, 0);
  hulk.add(spine);
  for (let i = 0; i < 7; i++) { // running lights
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffce2e, toneMapped: false }));
    l.position.set(-100 + i * 32, 21, 36);
    hulk.add(l);
  }
  hulk.position.set(0, -90, -140);
  group.add(hulk);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(300, 200, 100);
  group.add(sun, new THREE.AmbientLight(0x445066, 1.4));

  const ship = buildFighter(false);
  group.add(ship);
  const foes = [];
  for (let i = 0; i < 6; i++) {
    const f = buildFighter(true);
    const a = (i / 6) * Math.PI * 2;
    f.position.set(Math.cos(a) * 120, (Math.random() - 0.5) * 60, Math.sin(a) * 120 - 60);
    f.userData = { hp: 3, fireT: 1 + Math.random() * 2, veerT: 0, veer: null };
    group.add(f);
    foes.push(f);
  }
  G.scene.add(group);

  S = {
    group, ship, foes, bolts: [],
    yaw: 0, pitch: 0, speed: 26, hull: 100, t: 0, kills: 0, fireCd: 0,
    gold0: G.run.gold, time0: G.time || 0,
    prevFog: G.scene.fog.density, prevBg: G.scene.background.getHex(),
    prevFar: G.camera.far,
  };
  G.camera.far = 2400; // space is DEEP — the deck camera's 130u would cull the stars
  G.camera.updateProjectionMatrix();
  ship.position.set(0, 0, 60);
  G.scene.fog.density = 0.00012; // space is CLEAR
  G.scene.background.setHex(0x020409);
  G.mode = 'space';
  // the FP viewmodel has no business in a cockpit
  for (const c of G.camera.children) c.visible = false;
  const wh = document.getElementById('waveHud');
  wh?.classList.remove('hidden');
  addMsg('VOID PATROL — W/S throttle, mouse to steer, click to fire. Clear the drones.', 'gold');
  sfx.stairs();
}

function endSpaceFlight(result) {
  if (!S) return;
  const credits = result === 'CLEARED' ? 120 + S.kills * 30 : 0;
  G.run.gold += credits;
  saveReport({
    section: 'VOID PATROL', result, kills: S.kills, credits,
    time: Math.round((G.time || 0) - S.time0),
  });
  G.scene.remove(S.group);
  G.scene.fog.density = S.prevFog;
  G.scene.background.setHex(S.prevBg);
  G.camera.far = S.prevFar;
  G.camera.updateProjectionMatrix();
  G.keys['Escape'] = false; // don't insta-abort the next launch
  for (const c of G.camera.children) c.visible = true;
  document.getElementById('waveHud')?.classList.add('hidden');
  S = null;
  G.mode = 'playing';
  if (result === 'CLEARED') { addMsg(`Patrol clear — all drones down. +${credits} credits.`, 'gold'); sfx.victory(); }
  else addMsg('Fighter recovered by tether. The drones remain.', 'bad');
  refreshHud();
}

export function spaceMouse(dx, dy) {
  if (!S) return;
  S.yaw -= dx * 0.0022;
  S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch - dy * 0.0022));
}

export function spaceFire() {
  if (!S || S.fireCd > 0) return;
  S.fireCd = 0.16;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
  for (const side of [-1, 1]) {
    const off = new THREE.Vector3(side * 3.1, 0, -1).applyQuaternion(S.ship.quaternion);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x4fe8e0, toneMapped: false }));
    b.position.copy(S.ship.position).add(off);
    b.quaternion.copy(S.ship.quaternion);
    b.userData = { dir, vel: 95, life: 1.4, mine: true };
    S.group.add(b);
    S.bolts.push(b);
  }
  sfx.bolt();
}

export function updateSpace(dt) {
  if (!S) return;
  S.t += dt;
  S.fireCd -= dt;
  if (G.keys['Escape']) { endSpaceFlight('RECOVERED'); return; }

  // flight: mouse steers, W/S throttle, always moving
  if (G.keys['KeyW']) S.speed = Math.min(48, S.speed + 26 * dt);
  if (G.keys['KeyS']) S.speed = Math.max(10, S.speed - 30 * dt);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ'));
  S.ship.quaternion.slerp(q, Math.min(1, dt * 6));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
  S.ship.position.addScaledVector(fwd, S.speed * dt);
  // leash: the patrol zone is finite
  if (S.ship.position.length() > 380) S.ship.position.setLength(380);

  // chase camera
  const camPos = S.ship.position.clone().addScaledVector(fwd, -8.5);
  camPos.y += 2.6;
  camPos.add(ORIGIN);
  G.camera.position.lerp(camPos, Math.min(1, dt * 8));
  const look = S.ship.position.clone().addScaledVector(fwd, 14).add(ORIGIN);
  G.camera.lookAt(look);

  // foes: seek, veer, fire
  for (const f of S.foes) {
    if (f.userData.hp <= 0) continue;
    const toP = S.ship.position.clone().sub(f.position);
    const d = toP.length();
    toP.normalize();
    f.userData.veerT -= dt;
    if (d < 14 && f.userData.veerT <= 0) {
      f.userData.veer = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).normalize();
      f.userData.veerT = 1.6;
    }
    const dir = f.userData.veerT > 0 && f.userData.veer ? f.userData.veer : toP;
    f.position.addScaledVector(dir, 21 * dt);
    f.lookAt(S.ship.position.clone().add(ORIGIN)); // face the player (world coords)
    f.userData.fireT -= dt;
    if (f.userData.fireT <= 0 && d < 70 && f.userData.veerT <= 0) {
      f.userData.fireT = 1.3 + Math.random() * 1.4;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.2),
        new THREE.MeshBasicMaterial({ color: 0xff5533, toneMapped: false }));
      b.position.copy(f.position);
      b.userData = { dir: toP.clone(), vel: 60, life: 2.2, mine: false };
      b.lookAt(f.position.clone().add(toP));
      S.group.add(b);
      S.bolts.push(b);
    }
    // ramming hurts both
    if (d < 3.2) {
      f.userData.hp = 0;
      killFoe(f);
      hurtPlayer(16);
    }
  }

  // bolts
  for (let i = S.bolts.length - 1; i >= 0; i--) {
    const b = S.bolts[i];
    b.userData.life -= dt;
    b.position.addScaledVector(b.userData.dir, b.userData.vel * dt);
    let dead = b.userData.life <= 0;
    if (!dead && b.userData.mine) {
      for (const f of S.foes) {
        if (f.userData.hp <= 0) continue;
        if (b.position.distanceTo(f.position) < 2.4) {
          f.userData.hp--;
          spawnBurst(f.position.clone().add(ORIGIN), 0xffaa55, 10, 4, 0.12, 0.5);
          if (f.userData.hp <= 0) killFoe(f);
          dead = true;
          break;
        }
      }
    } else if (!dead && !b.userData.mine) {
      if (b.position.distanceTo(S.ship.position) < 2.2) { hurtPlayer(9); dead = true; }
    }
    if (dead) { S.group.remove(b); S.bolts.splice(i, 1); }
  }

  // HUD line
  const alive = S.foes.filter(f => f.userData.hp > 0).length;
  const wh = document.getElementById('waveHud');
  if (wh) wh.textContent = `VOID PATROL — HULL ${Math.max(0, Math.round(S.hull))} · DRONES ${alive} · SPEED ${Math.round(S.speed)}`;
  if (alive === 0) endSpaceFlight('CLEARED');
}

function killFoe(f) {
  spawnBurst(f.position.clone().add(ORIGIN), 0xff6633, 26, 7, 0.18, 0.9);
  sfx.cannon();
  f.visible = false;
  S.kills++;
}

function hurtPlayer(n) {
  S.hull -= n;
  G.shake = Math.max(G.shake || 0, 0.5);
  sfx.hurt();
  if (S.hull <= 0) endSpaceFlight('RECOVERED');
}

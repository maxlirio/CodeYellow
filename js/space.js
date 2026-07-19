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

// a boxy X-wing style fighter; `hostile` swaps the trim red.
// The player's visual is flipped so the nose points along -z (camera forward);
// foes keep +z noses because Object3D.lookAt points +z at the target.
function buildFighter(hostile = false) {
  const grp = new THREE.Group();
  const vis = new THREE.Group();
  grp.add(vis);
  grp.userData.vis = vis;
  const body = new THREE.MeshStandardMaterial({ color: hostile ? 0x5a4a4c : 0x9aa6b4, metalness: 0.4, roughness: 0.6 });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: hostile ? 0xff4433 : 0x4fe8e0, emissiveIntensity: 1.6, toneMapped: false,
  });
  const M = (geo, mat, x, y, z, rx = 0, rz = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    vis.add(m); return m;
  };
  // DART interceptor: flat wedge hull, two swept delta wings, twin nacelles,
  // a dorsal fin — a fighter, but nobody's X-wing
  M(new THREE.BoxGeometry(1.35, 0.55, 4.4), body, 0, 0, 0);                  // flat wedge hull
  const nose = M(new THREE.ConeGeometry(0.72, 2.0, 4), body, 0, 0, 3.1, Math.PI / 2);
  nose.scale.y = 0.42; // squashed diamond nose
  M(new THREE.BoxGeometry(0.66, 0.42, 1.1), trim, 0, 0.32, 1.5).name = 'canopy';
  for (const sx of [-1, 1]) {                                               // swept delta wings
    M(new THREE.BoxGeometry(2.7, 0.1, 1.7), body, sx * 1.85, 0, -0.7, 0, 0, sx * -0.55);
    M(new THREE.BoxGeometry(0.34, 0.26, 1.1), trim, sx * 2.95, 0, -1.5, 0, 0, sx * -0.55); // wingtip cannon
    // twin engine nacelles hugging the tail
    const nac = M(new THREE.CylinderGeometry(0.34, 0.42, 1.9, 8), body, sx * 0.85, 0, -2.2, Math.PI / 2);
    void nac;
    M(new THREE.BoxGeometry(0.5, 0.5, 0.14), trim, sx * 0.85, 0, -3.2);     // engine glow
  }
  M(new THREE.BoxGeometry(0.12, 0.85, 1.5), hostile ? trim : body, 0, 0.65, -1.9); // dorsal fin
  if (hostile) M(new THREE.BoxGeometry(0.4, 0.4, 1.3), trim, 0, -0.45, 0.9); // underslung gun pod
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
  ship.userData.vis.rotation.y = Math.PI; // nose along -z = where you look
  ship.userData.vis.visible = false; // pure WINDOW cockpit: no hull in your face
  // cockpit dashboard: a sill + struts you see from the pilot seat
  const dashM = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.4, roughness: 0.7 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.5), dashM);
  dash.position.set(0, 0.22, -1.15);
  ship.add(dash);
  const dashGlow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.025, 0.07),
    new THREE.MeshBasicMaterial({ color: 0x2fa89e, toneMapped: false }));
  dashGlow.position.set(0, 0.4, -1.12);
  ship.add(dashGlow);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.4, 0.09), dashM);
    strut.position.set(sx * 0.95, 0.85, -1.0);
    strut.rotation.z = sx * 0.42;
    ship.add(strut);
  }
  // overhead canopy rail — the top edge of the glass
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.09), dashM);
  rail.position.set(0, 1.52, -0.85);
  ship.add(rail);
  group.add(ship);
  const foes = [];
  for (let i = 0; i < 6; i++) {
    const f = buildFighter(true);
    const vis = f.userData.vis;
    vis.rotation.y = Math.PI; // every ship flies nose = -z now
    const a = (i / 6) * Math.PI * 2;
    f.position.set(Math.cos(a) * 120, (Math.random() - 0.5) * 60, Math.sin(a) * 120 - 60);
    f.quaternion.setFromEuler(new THREE.Euler(0, a + Math.PI / 2, 0)); // start on a tangent
    f.userData = { hp: 3, fireT: 1 + Math.random() * 2, state: 'approach', breakT: 0, breakDir: null, speed: 24 + Math.random() * 6, vis };
    group.add(f);
    foes.push(f);
  }
  G.scene.add(group);

  S = {
    group, ship, foes, bolts: [],
    yaw: 0, pitch: 0, vel: new THREE.Vector3(0, 0, -20), speed: 26, roll: 0, prevYaw: 0, hull: 100, t: 0, kills: 0, fireCd: 0,
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
  addMsg('VOID PATROL — mouse flies the ship, W/S throttle, click to fire. ESC recovers to the bridge.', 'gold');
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
    const off = new THREE.Vector3(side * 2.95, 0, -1.5).applyQuaternion(S.ship.quaternion);
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

  // STANDARD SCI-FI flight: you fly where you point. Throttle sets speed,
  // the ship banks into turns, and a touch of drift keeps some weight in it.
  if (G.keys['KeyW']) S.speed = Math.min(70, (S.speed ?? 26) + 30 * dt);
  if (G.keys['KeyS']) S.speed = Math.max(12, (S.speed ?? 26) - 34 * dt);
  S.speed = S.speed ?? 26;
  // auto-bank: roll into the turn, proportional to yaw rate
  const yawRate = (S.yaw - (S.prevYaw ?? S.yaw)) / Math.max(dt, 0.001);
  S.prevYaw = S.yaw;
  const bankTarget = Math.max(-0.85, Math.min(0.85, yawRate * 0.55));
  S.roll = (S.roll ?? 0) + (bankTarget - (S.roll ?? 0)) * Math.min(1, dt * 5);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.pitch, S.yaw, S.roll, 'YXZ'));
  S.ship.quaternion.slerp(q, Math.min(1, dt * 10));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(S.ship.quaternion);
  S.vel.lerp(fwd.clone().multiplyScalar(S.speed), Math.min(1, dt * 4)); // slight drift, no math homework
  S.ship.position.addScaledVector(S.vel, dt);
  // leash: drifting out of the patrol zone kills your outward velocity
  if (S.ship.position.length() > 380) {
    const n = S.ship.position.clone().normalize();
    const out = S.vel.dot(n);
    if (out > 0) S.vel.addScaledVector(n, -out);
    S.ship.position.setLength(380);
  }

  // FIRST-PERSON cockpit: you sit in the canopy, nose ahead, wings out the sides
  const camPos = S.ship.position.clone()
    .addScaledVector(up, 0.78).addScaledVector(fwd, 0.35).add(ORIGIN);
  G.camera.position.copy(camPos);
  G.camera.quaternion.copy(S.ship.quaternion);

  // foes: ATTACK RUNS — fly straight along the nose, turn on a rate limit
  // (wide banked arcs), overshoot, break away, come around again
  const TURN = 1.15; // rad/s — how hard a drone can pull
  for (const f of S.foes) {
    const ud = f.userData;
    if (ud.hp <= 0) continue;
    const toP = S.ship.position.clone().sub(f.position);
    const d = toP.length();
    toP.normalize();
    // pick the desired heading by state
    ud.breakT -= dt;
    if (ud.state === 'approach' && d < 16) {
      // overshoot: break to a side and climb/dive away
      const side = new THREE.Vector3().crossVectors(toP, new THREE.Vector3(0, 1, 0)).normalize();
      ud.breakDir = side.multiplyScalar(Math.random() < 0.5 ? 1 : -1)
        .addScaledVector(toP, 0.35).setY((Math.random() - 0.5) * 1.2).normalize();
      ud.state = 'break';
      ud.breakT = 2.0 + Math.random();
    } else if (ud.state === 'break' && ud.breakT <= 0) {
      ud.state = 'approach';
    }
    const desired = ud.state === 'break' ? ud.breakDir : toP;
    // rate-limited turn toward the desired heading — this MAKES the arcs
    const targetQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), desired);
    f.quaternion.rotateTowards(targetQ, TURN * dt);
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quaternion);
    f.position.addScaledVector(nose, ud.speed * dt);
    // bank the airframe into the turn
    const turnDir = new THREE.Vector3().crossVectors(nose, desired).y;
    ud.vis.rotation.z = (ud.vis.rotation.z ?? 0) + ((-turnDir * 0.9) - (ud.vis.rotation.z ?? 0)) * Math.min(1, dt * 4);
    // guns only speak when the nose agrees
    ud.fireT -= dt;
    if (ud.fireT <= 0 && ud.state === 'approach' && d < 70 && nose.angleTo(toP) < 0.22) {
      ud.fireT = 1.2 + Math.random() * 1.3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.2),
        new THREE.MeshBasicMaterial({ color: 0xff5533, toneMapped: false }));
      b.position.copy(f.position);
      b.userData = { dir: nose.clone(), vel: 60, life: 2.2, mine: false };
      b.lookAt(f.position.clone().add(nose));
      S.group.add(b);
      S.bolts.push(b);
    }
    // ramming hurts both
    if (d < 3.2) {
      ud.hp = 0;
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
  if (wh) wh.textContent = `VOID PATROL — HULL ${Math.max(0, Math.round(S.hull))} · DRONES ${alive} · VEL ${Math.round(S.vel.length())} m/s`;
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

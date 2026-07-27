// OPERATION LANDFALL, ACT I — THE BOMBING RUN.
// The carrier has arrived over a civilization the aliens took. You fly a
// BOMBER down into the flak, LOCK a shield pylon (T), line the run up on the
// BOMBSIGHT monitor until it flashes red, and release (SPACE). Six bombs
// aboard — dry, and you climb all the way back to the carrier's resupply
// ring to rearm. Kill every pylon and AA battery, then land on the beacon.
// Skill checklist: heading, speed and altitude all bend the impact point;
// AA leads you, terrain kills you, and the release window is real.
import * as THREE from 'three';
import { G } from './state.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { saveReport } from './bridge.js';
import {
  buildBomber, buildCarrier, cockpitKit, drawLockAt, hideLockWidgets,
} from './space.js';

const ORIGIN = new THREE.Vector3(0, 3000, 0);   // the sky over the city
const CARRIER_Y = 420;
const GRAV = 28;
const RELEASE_R = 10;      // impact-to-target distance that counts as "on"
const MAX_BOMBS = 6;

let L = null;
export function inLandfall() { return !!L; }
export function _dbgL() {
  return L ? {
    phase: L.phase, bombs: L.bombs, hull: Math.round(L.hull),
    left: L.targets.filter((t) => t.hp > 0).length,
    p: L.ship.position.toArray().map((v) => +v.toFixed(1)),
  } : null;
}

const shipUp = (id) => (G.run?.shipUps?.[id] || 0);
export function _L() { return L; } // probe access
export function landfallDrop() { if (L && L.phase === 'run') dropBomb(); }

// ---------------- the occupied city ----------------
function buildCity(group) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x232833, metalness: 0.3, roughness: 0.85 });
  const dark2 = new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.3, roughness: 0.9 });
  const winM = new THREE.MeshBasicMaterial({ color: 0xffc37a, toneMapped: false });
  const hiveM = new THREE.MeshBasicMaterial({ color: 0x39e8c8, toneMapped: false });
  const geosA = [], geosB = [], geosW = [], geosH = [];
  const push = (arr, sx, sy, sz, x, y, z) => {
    const g2 = new THREE.BoxGeometry(sx, sy, sz);
    g2.translate(x, y, z);
    arr.push(g2);
  };
  let seed = 1337;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const TILE = 44, N = 26, HALF = (N * TILE) / 2;
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const cx = tx * TILE - HALF + TILE / 2, cz = ty * TILE - HALF + TILE / 2;
    if (rnd() < 0.32) continue; // open block / plaza
    const n = 1 + Math.floor(rnd() * 3);
    for (let b = 0; b < n; b++) {
      const w = 8 + rnd() * 16, d = 8 + rnd() * 16, h = 8 + rnd() * rnd() * 52;
      const ox = (rnd() - 0.5) * (TILE - w - 6), oz = (rnd() - 0.5) * (TILE - d - 6);
      push(rnd() < 0.5 ? geosA : geosB, w, h, d, cx + ox, h / 2, cz + oz);
      // lit window bands (sparse — half the city is dark under occupation)
      if (rnd() < 0.4) push(geosW, w * 0.7, 0.6, 0.3, cx + ox, h * (0.3 + rnd() * 0.5), cz + oz + d / 2 + 0.05);
      // hive growth: teal pustule glow at street level
      if (rnd() < 0.14) push(geosH, 4 + rnd() * 6, 1.2, 4 + rnd() * 6, cx + ox, 0.6, cz + oz + d / 2 + 3);
    }
  }
  const { mergeGeometries } = THREE.BufferGeometryUtils || {};
  const mk = (geos, mat) => {
    if (!geos.length) return;
    let merged;
    if (mergeGeometries) merged = mergeGeometries(geos, false);
    else {
      // fall back to addon import (resolved by the caller module scope)
      merged = mergeCompat(geos, false);
    }
    if (!merged) return;
    const m = new THREE.Mesh(merged, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  mk(geosA, dark); mk(geosB, dark2); mk(geosW, winM); mk(geosH, hiveM);
  // the ground: one vast dark plate
  const ground = new THREE.Mesh(new THREE.BoxGeometry(N * TILE + 400, 1, N * TILE + 400),
    new THREE.MeshStandardMaterial({ color: 0x10141b, metalness: 0.2, roughness: 0.95 }));
  ground.position.y = -0.5;
  group.add(ground);
  return { TILE, N, HALF };
}
import { mergeGeometries as mergeCompat } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------- targets ----------------
function buildPylon() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x3a4152, metalness: 0.4, roughness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8a5cff, toneMapped: false });
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.5, 64, 8), body);
  spire.position.y = 32;
  g.add(spire);
  for (const y of [18, 34, 50]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 1.4, 8, 1, true), glow);
    ring.position.y = y;
    g.add(ring);
  }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), glow);
  orb.position.y = 66;
  g.add(orb);
  return g;
}
function buildAA() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x424a3c, metalness: 0.4, roughness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xff5533, toneMapped: false });
  const base = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), body);
  base.position.y = 2;
  g.add(base);
  const turret = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 5), body);
  turret.position.y = 5.5;
  g.add(turret);
  for (const sx of [-1.4, 1.4]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 7, 6), body);
    barrel.position.set(sx, 8.5, 0);
    g.add(barrel);
  }
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), glow);
  lamp.position.y = 7.4;
  g.add(lamp);
  return g;
}

// ---------------- launch ----------------
export function startLandfall(drill = false) {
  if (L) return;
  const group = new THREE.Group();
  group.position.copy(ORIGIN);

  // dusk sky: gradient dome + thin stars up high
  const skyC = document.createElement('canvas');
  skyC.width = 64; skyC.height = 256;
  const sctx = skyC.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#04060f');
  grad.addColorStop(0.5, '#0d1226');
  grad.addColorStop(0.8, '#28203a');
  grad.addColorStop(1, '#4a2c33');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 64, 256);
  const skyT = new THREE.CanvasTexture(skyC);
  skyT.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, toneMapped: false, fog: false }));
  group.add(sky);
  const sun = new THREE.DirectionalLight(0xffc9a8, 1.1);
  sun.position.set(-400, 260, 300);
  group.add(sun, new THREE.AmbientLight(0x46507a, 1.3));

  buildCity(group);

  // THE CARRIER, holding station high above — with the RESUPPLY RING under it
  const cap = buildCarrier();
  cap.position.set(0, CARRIER_Y, 0);
  cap.scale.setScalar(0.9);
  group.add(cap);
  const ringM = new THREE.MeshBasicMaterial({ color: 0x4fe8e0, transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(24, 1.4, 8, 40), ringM);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, CARRIER_Y - 60, 0);
  ring.name = 'rearmRing';
  group.add(ring);

  // targets: 5 shield pylons (2 bombs) + 3 AA batteries (1 bomb)
  const targets = [];
  const spots = [
    [-330, -280], [310, -180], [-160, 240], [260, 320], [40, -400], // pylons
    [-380, 90], [140, 90], [390, -330],                              // AA
  ];
  for (let i = 0; i < spots.length; i++) {
    const pylon = i < 5;
    const m = pylon ? buildPylon() : buildAA();
    m.position.set(spots[i][0], 0, spots[i][1]);
    group.add(m);
    targets.push({ grp: m, pos: m.position.clone(), hp: pylon ? 2 : 1, type: pylon ? 'PYLON' : 'AA', fireT: 2 + Math.random() * 2 });
  }

  // the LZ beacon (lights up when every target is down)
  const lz = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 500, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x66ff9a, transparent: true, opacity: 0.0, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  lz.position.set(30, 250, 30);
  lz.name = 'lzBeacon';
  group.add(lz);

  // THE BOMBER: same cockpit kit, heavier everything
  const ship = buildBomber();
  ship.userData.vis.visible = false;
  const kit = cockpitKit();
  kit.position.set(0, 0.9, -0.4);
  ship.add(kit);
  ship.position.set(60, CARRIER_Y - 70, 40);
  ship.quaternion.setFromEuler(new THREE.Euler(-0.35, Math.PI * 0.8, 0, 'YXZ'));
  group.add(ship);

  G.scene.add(group);
  L = {
    group, ship, targets, drill,
    bombs: MAX_BOMBS, hull: 140 + 30 * shipUp('hull'), maxHull: 140 + 30 * shipUp('hull'),
    maxSpeed: 56 + 6 * shipUp('engine'),
    speed: 26, vel: new THREE.Vector3(), bank: 0, lock: null,
    bombsAway: [], flak: [], fx: [], phase: 'run', t: 0, landT: 0, dropCd: 0, rearmT: 0, sightFlash: 0,
    time0: G.time || 0, prevFog: G.scene.fog.density, prevBg: G.scene.background.getHex(), prevFar: G.camera.far,
  };
  G.camera.far = 3000;
  G.camera.updateProjectionMatrix();
  G.scene.fog.density = 0.00018;
  G.scene.background.setHex(0x0a0d1a);
  G.mode = 'space';
  for (const c of G.camera.children) c.visible = false;
  document.getElementById('waveHud')?.classList.remove('hidden');
  addMsg('OPERATION LANDFALL — the shield grid holds the LZ. ARROWS steer, W/S throttle, T locks, SPACE drops.', 'gold');
  addMsg('Watch the BOMBSIGHT (bottom-right): release when it flashes RED. Six bombs — rearm at the carrier ring.', 'gold');
  sfx.stairs();
  refreshHud();
}

function endLandfall(result) {
  if (!L) return;
  const kills = L.targets.filter((t) => t.hp <= 0).length;
  const credits = result === 'LZ SECURED' ? 350 + kills * 25 : 0;
  G.run.gold += credits;
  if (result === 'LZ SECURED') G.run.landfall = Math.max(G.run.landfall || 0, 1);
  saveReport({ section: 'OPERATION LANDFALL I', result, kills, credits, time: Math.round((G.time || 0) - L.time0) });
  G.scene.remove(L.group);
  G.scene.fog.density = L.prevFog;
  G.scene.background.setHex(L.prevBg);
  G.camera.far = L.prevFar;
  G.camera.updateProjectionMatrix();
  G.keys['Escape'] = false;
  for (const c of G.camera.children) c.visible = true;
  document.getElementById('waveHud')?.classList.add('hidden');
  hideLockWidgets();
  L = null;
  window.__sphL = null;
  G.mode = 'playing';
  if (result === 'LZ SECURED') {
    addMsg(`LZ SECURED — shield grid down, +${credits} credits. Ground assault is NEXT.`, 'gold');
    sfx.victory();
  } else if (result === 'SHOT DOWN') addMsg('Bomber lost — recovery tether caught your pod.', 'bad');
  else addMsg('Recovered to the carrier.', 'bad');
  refreshHud();
}

export function landfallCycleLock() {
  if (!L) return;
  const alive = L.targets.filter((t) => t.hp > 0);
  if (!alive.length) { L.lock = null; hideLockWidgets(); return; }
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  alive.sort((a, b) =>
    a.pos.clone().sub(L.ship.position).normalize().angleTo(nose) -
    b.pos.clone().sub(L.ship.position).normalize().angleTo(nose));
  const i = alive.indexOf(L.lock);
  L.lock = alive[(i + 1) % alive.length];
  addMsg(`LOCK: ${L.lock.type === 'PYLON' ? 'SHIELD PYLON' : 'AA BATTERY'}`, 'gold');
  sfx.key();
}

function hurtBomber(n) {
  L.hull -= n;
  G.shake = Math.max(G.shake || 0, 0.3);
  sfx.hurt?.();
  if (L.hull <= 0) endLandfall('SHOT DOWN');
}

function boom(pos, big = false) {
  const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 9 : 5, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, toneMapped: false }));
  flash.position.copy(pos);
  L.group.add(flash);
  L.fx.push({ mesh: flash, t: 0, dur: big ? 0.7 : 0.45 });
  const ringG = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.8, toneMapped: false, side: THREE.DoubleSide }));
  ringG.position.set(pos.x, 1.2, pos.z);
  L.group.add(ringG);
  L.fx.push({ mesh: ringG, t: 0, dur: 0.9, ring: true, big });
  sfx.rumble();
}

// where a bomb released RIGHT NOW would land
function impactPoint(out) {
  const h = Math.max(0, L.ship.position.y);
  const t = Math.sqrt((2 * h) / GRAV);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  out.set(
    L.ship.position.x + fwd.x * L.speed * t,
    0,
    L.ship.position.z + fwd.z * L.speed * t);
  return out;
}

function dropBomb() {
  if (L.bombs <= 0) { addMsg('BOMBS OUT — climb to the carrier ring to rearm.', 'bad'); return; }
  if (L.dropCd > 0) return;
  L.dropCd = 0.4;
  L.bombs--;
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x39414c, metalness: 0.5, roughness: 0.6 }));
  b.position.copy(L.ship.position).add(new THREE.Vector3(0, -1.6, 0));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  b.userData.v = fwd.clone().multiplyScalar(L.speed);
  b.userData.v.y = Math.min(0, b.userData.v.y);
  L.group.add(b);
  L.bombsAway.push(b);
  sfx.bolt();
}

const _ip = new THREE.Vector3(), _wp = new THREE.Vector3();

// ---------------- the bombsight monitor (the minimap canvas) ----------------
function drawBombsight(dt) {
  const cv = document.getElementById('minimap');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(6, 10, 12, 0.88)';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const lock = L.lock && L.lock.hp > 0 ? L.lock : null;
  // heading frame: up = your nose
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  const yaw = Math.atan2(fwd.x, -fwd.z);
  const toSight = (wx, wz, ref) => {
    const dx = wx - ref.x, dz = wz - ref.z;
    const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
    return [cx + rx * 1.05, cy + rz * 1.05];
  };
  impactPoint(_ip);
  const onWindow = lock ? Math.hypot(_ip.x - lock.pos.x, _ip.z - lock.pos.z) <= RELEASE_R : false;
  L.sightFlash = (L.sightFlash + dt * 9) % 2;
  const hot = onWindow && L.sightFlash < 1;
  // frame
  ctx.strokeStyle = hot ? '#ff3b30' : 'rgba(79, 232, 224, 0.7)';
  ctx.lineWidth = hot ? 4 : 2;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.font = '600 12px Menlo, monospace';
  ctx.textAlign = 'center';
  if (!lock) {
    ctx.fillStyle = '#7fffee';
    ctx.fillText('T — LOCK TARGET', cx, cy - 6);
    ctx.fillStyle = '#9aa6b4';
    ctx.fillText(`BOMBS ${L.bombs}/${MAX_BOMBS}`, cx, cy + 14);
    return;
  }
  // the sight is target-centered: the target sits at the cross, your
  // predicted impact point drifts as you fly — bring them together
  ctx.strokeStyle = 'rgba(138, 92, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
  ctx.strokeRect(cx - 8, cy - 8, 16, 16);
  // release ring (the window)
  ctx.strokeStyle = 'rgba(79, 232, 224, 0.4)';
  ctx.beginPath(); ctx.arc(cx, cy, RELEASE_R * 1.05, 0, Math.PI * 2); ctx.stroke();
  // impact point + run-in line
  const [ix, iy] = toSight(_ip.x, _ip.z, lock.pos);
  const px2 = Math.max(8, Math.min(W - 8, ix)), py2 = Math.max(8, Math.min(H - 8, iy));
  ctx.strokeStyle = hot ? '#ff3b30' : '#ffce2e';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px2, py2); ctx.stroke();
  ctx.fillStyle = hot ? '#ff3b30' : '#ffce2e';
  ctx.beginPath(); ctx.arc(px2, py2, hot ? 6 : 4.5, 0, Math.PI * 2); ctx.fill();
  // readouts
  ctx.fillStyle = '#cfe8ff';
  ctx.textAlign = 'left';
  ctx.fillText(`ALT ${Math.round(L.ship.position.y)}`, 8, 16);
  ctx.fillText(`BOMBS ${L.bombs}`, 8, H - 8);
  ctx.textAlign = 'right';
  ctx.fillText(lock.type, W - 8, 16);
  if (hot) {
    ctx.fillStyle = '#ff3b30';
    ctx.textAlign = 'center';
    ctx.font = '700 14px Menlo, monospace';
    ctx.fillText('RELEASE', cx, H - 10);
  }
}

// ---------------- per-frame ----------------
export function updateLandfall(dt) {
  if (!L) return;
  window.__sphL = L.phase;
  L.t += dt;
  L.dropCd -= dt;
  if (G.keys['Escape']) { endLandfall('RECOVERED'); return; }

  if (L.phase === 'land') {
    L.landT += dt;
    const k = Math.min(1, L.landT / 2.6);
    const ease = k * k * (3 - 2 * k);
    L.ship.position.lerp(L.landAt, Math.min(1, dt * (1.2 + ease)));
    L.ship.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, L.landYaw, 0, 'YXZ')), Math.min(1, dt * 2));
    const fwdL = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(L.ship.quaternion);
    G.camera.position.copy(L.ship.position).addScaledVector(upL, 0.9).addScaledVector(fwdL, 0.6).add(ORIGIN);
    G.camera.quaternion.copy(L.ship.quaternion);
    const wh = document.getElementById('waveHud');
    if (wh) wh.textContent = 'FLARE… FLARE… touchdown';
    if (L.landT > 3.0) { endLandfall('LZ SECURED'); }
    return;
  }

  // flight (heavier than the fighter: slower turns, more inertia)
  if (G.keys['KeyW']) L.speed = Math.min(L.maxSpeed, L.speed + 22 * dt);
  if (G.keys['KeyS']) L.speed = Math.max(14, L.speed - 26 * dt);
  const yawIn = (G.keys['ArrowLeft'] ? 1 : 0) - (G.keys['ArrowRight'] ? 1 : 0);
  const pitchIn = (G.keys['ArrowUp'] ? 1 : 0) - (G.keys['ArrowDown'] ? 1 : 0);
  const rollIn = (G.keys['KeyA'] ? 1 : 0) - (G.keys['KeyD'] ? 1 : 0);
  const qd = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchIn * 0.95 * dt, yawIn * 1.1 * dt, rollIn * 2.2 * dt, 'YXZ'));
  L.ship.quaternion.multiply(qd);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(L.ship.quaternion);
  L.vel.lerp(fwd.clone().multiplyScalar(L.speed), Math.min(1, dt * 2.6));
  L.ship.position.addScaledVector(L.vel, dt);
  L.bank = L.bank + ((yawIn * 0.35) - L.bank) * Math.min(1, dt * 5);

  // terrain and ceiling are real
  if (L.ship.position.y < 6) {
    L.ship.position.y = 6;
    if (L.vel.y < 0) L.vel.y = 0;
    hurtBomber(20);
    if (!L) return;
    addMsg('TERRAIN — pull up!', 'bad');
  }
  if (L.ship.position.y > CARRIER_Y + 40) L.ship.position.y = CARRIER_Y + 40;
  const RANGE = 700;
  if (Math.abs(L.ship.position.x) > RANGE) L.ship.position.x = Math.sign(L.ship.position.x) * RANGE;
  if (Math.abs(L.ship.position.z) > RANGE) L.ship.position.z = Math.sign(L.ship.position.z) * RANGE;

  // (bomb release is EVENT-driven from main's keydown — a tap can be
  // faster than a frame, and a missed release is a missed run)

  // bombs fall, bombs land
  for (let i = L.bombsAway.length - 1; i >= 0; i--) {
    const b = L.bombsAway[i];
    b.userData.v.y -= GRAV * dt;
    b.position.addScaledVector(b.userData.v, dt);
    b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.userData.v.clone().normalize().negate());
    if (b.position.y <= 1) {
      boom(b.position.clone().setY(1), false);
      for (const t of L.targets) {
        if (t.hp <= 0) continue;
        if (Math.hypot(b.position.x - t.pos.x, b.position.z - t.pos.z) < 16) {
          t.hp--;
          if (t.hp <= 0) {
            boom(t.pos.clone().setY(4), true);
            t.grp.visible = false;
            const left = L.targets.filter((x) => x.hp > 0).length;
            addMsg(`${t.type === 'PYLON' ? 'SHIELD PYLON' : 'AA BATTERY'} DESTROYED — ${left} targets left.`, 'gold');
            if (t === L.lock) L.lock = null;
            if (!left) {
              addMsg('SHIELD GRID DOWN. The LZ beacon is lit — land on the green column.', 'gold');
              const lz = L.group.getObjectByName('lzBeacon');
              if (lz) lz.material.opacity = 0.3;
              sfx.victory();
            }
          } else addMsg(`Direct hit — the ${t.type === 'PYLON' ? 'pylon' : 'battery'} is cracked.`, 'gold');
        }
      }
      L.group.remove(b);
      L.bombsAway.splice(i, 1);
    }
  }

  // AA batteries: they LEAD you — weave or eat flak
  for (const t of L.targets) {
    if (t.hp <= 0 || t.type !== 'AA') continue;
    t.fireT -= dt;
    const d = L.ship.position.distanceTo(t.pos);
    if (t.fireT <= 0 && d < 430 && L.ship.position.y < 300) {
      t.fireT = 1.5 + Math.random() * 1.6;
      const tt = d / 130; // shell flight time
      const aim = L.ship.position.clone().addScaledVector(L.vel, tt)
        .add(new THREE.Vector3((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 26));
      L.flak.push({ from: t.pos.clone().setY(8), to: aim, t: 0, dur: tt * 0.55 + 0.4 });
    }
  }
  for (let i = L.flak.length - 1; i >= 0; i--) {
    const f = L.flak[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    if (!f.mesh) {
      f.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.2),
        new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }));
      L.group.add(f.mesh);
    }
    f.mesh.position.lerpVectors(f.from, f.to, k);
    f.mesh.lookAt(f.to.clone().add(ORIGIN).sub(ORIGIN));
    if (k >= 1) {
      // BURST
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff7733, transparent: true, opacity: 0.9, toneMapped: false }));
      puff.position.copy(f.to);
      L.group.add(puff);
      L.fx.push({ mesh: puff, t: 0, dur: 0.5 });
      const dd = f.to.distanceTo(L.ship.position);
      if (dd < 10) { hurtBomber(9 + Math.random() * 6); if (!L) return; }
      else if (dd < 26) G.shake = Math.max(G.shake || 0, 0.12);
      L.group.remove(f.mesh);
      L.flak.splice(i, 1);
    }
  }

  // fx decay
  for (let i = L.fx.length - 1; i >= 0; i--) {
    const e = L.fx[i];
    e.t += dt;
    const k = e.t / e.dur;
    if (e.ring) {
      const r = 1 + k * (e.big ? 46 : 22);
      e.mesh.scale.set(r, 1, r);
      e.mesh.material.opacity = 0.8 * (1 - k);
    } else {
      e.mesh.scale.setScalar(1 + k * 2.2);
      e.mesh.material.opacity = 0.95 * (1 - k);
    }
    if (k >= 1) { L.group.remove(e.mesh); L.fx.splice(i, 1); }
  }

  // REARM: fly up through the carrier ring
  const ring = L.group.getObjectByName('rearmRing');
  if (ring) {
    ring.rotation.z += dt * 0.8;
    const rd = L.ship.position.distanceTo(ring.position);
    if (rd < 26 && L.bombs < MAX_BOMBS) {
      L.rearmT += dt;
      if (L.rearmT > 0.5) {
        L.bombs = MAX_BOMBS;
        L.hull = Math.min(L.maxHull, L.hull + 30);
        L.rearmT = 0;
        addMsg('REARMED — six bombs racked, hull patched. Dive.', 'gold');
        sfx.levelup();
      }
    } else L.rearmT = 0;
  }

  // LANDING: everything dead + on the beacon, low and slow
  const left = L.targets.filter((t) => t.hp > 0).length;
  if (!left) {
    const lz = L.group.getObjectByName('lzBeacon');
    if (lz) {
      const d2 = Math.hypot(L.ship.position.x - lz.position.x, L.ship.position.z - lz.position.z);
      if (d2 < 26 && L.ship.position.y < 40 && L.speed < 36) {
        L.phase = 'land';
        L.landT = 0;
        L.landAt = new THREE.Vector3(lz.position.x, 3, lz.position.z);
        const fwdY = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
        L.landYaw = Math.atan2(-fwdY.x, -fwdY.z) + Math.PI;
        addMsg('LZ acquired — flaring for touchdown.', 'gold');
        return;
      }
    }
  }

  // lock HUD in the world
  if (L.lock && L.lock.hp > 0) {
    _wp.copy(L.lock.pos).setY(L.lock.type === 'PYLON' ? 40 : 8).add(ORIGIN);
    drawLockAt(_wp, `${L.lock.type} ${Math.round(L.ship.position.distanceTo(L.lock.pos))}m`,
      L.lock.type === 'PYLON' ? '#bb99ff' : '#ff8855');
  } else hideLockWidgets();

  // cockpit camera
  G.camera.position.copy(L.ship.position).addScaledVector(up, 0.9).addScaledVector(fwd, 0.6).add(ORIGIN);
  G.camera.quaternion.copy(L.ship.quaternion);
  G.camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, L.bank)));

  // HUD
  const wh = document.getElementById('waveHud');
  if (wh) {
    wh.textContent = L.bombs <= 0
      ? 'BOMBS OUT — REARM AT THE CARRIER RING'
      : left ? `TARGETS ${left} · BOMBS ${L.bombs}` : 'LAND ON THE GREEN BEACON — low and slow';
  }
  const hpfill = document.getElementById('hpfill'), hptext = document.getElementById('hptext');
  if (hpfill) hpfill.style.width = `${Math.max(0, (L.hull / L.maxHull) * 100)}%`;
  if (hptext) hptext.textContent = `BOMBER ${Math.max(0, Math.round(L.hull))} / ${L.maxHull}`;

  drawBombsight(dt);
}

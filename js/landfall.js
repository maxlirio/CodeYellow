// OPERATION LANDFALL — ONE WORLD. The carrier's hangar deck hangs 300 meters
// over an occupied planet: the city renders BELOW the deck in the same scene,
// visible through the hangar mouth. You board the bomber on the deck, fly out
// the mouth, dive, bomb, and when you're dry you fly BACK IN through the
// mouth and set down on the pad — real docking, no rings, no mode swaps.
// The world is Dagobah-bright: yellow-greens, greys, browns, haze horizons.
//
// The arrival: confirm the op at the holo table and the ship JUMPS — the
// bridge windows streak into hyperspace, drop out in front of the planet,
// descend, and the ship's voice clears you down to the bay.
import * as THREE from 'three';
import { G } from './state.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { saveReport } from './bridge.js';
import { landfallPortalReady } from './missions.js';
import {
  buildBomber, cockpitKit, drawLockAt, hideLockWidgets, setLandfallHook,
} from './space.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CITY_Y = -300;       // the city, below the deck (deck floor = y 0)
const GRAV = 28;
const RELEASE_R = 10;
const MAX_BOMBS = 6;

let LW = null;   // the world below (built with the deck): targets, lz, refs
let L = null;    // flight state (only while flying the bomber)
let A = null;    // arrival cinematic state (on the bridge)

export function inLandfall() { return !!L; }
export function _L() { return L; }
export function _LW() { return LW; }
export function _dbgL() {
  return L ? {
    phase: L.phase, bombs: L.bombs, hull: Math.round(L.hull),
    left: LW ? LW.targets.filter((t) => t.hp > 0).length : -1,
    p: L.ship.position.toArray().map((v) => +v.toFixed(1)),
  } : null;
}

const shipUp = (id) => (G.run?.shipUps?.[id] || 0);

function say(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92;
    u.pitch = 1.2;
    const vs = speechSynthesis.getVoices();
    u.voice = vs.find((v) => /female|samantha|victoria|zira|karen|moira|serena/i.test(v.name))
      || vs.find((v) => v.lang && v.lang.startsWith('en')) || null;
    speechSynthesis.speak(u);
  } catch { /* no speech engine — the text message carries it */ }
}

// ==================================================================
// THE WORLD BELOW — built INTO the hangar deck's mesh group, so the
// city is simply there, 300m down, seen through the mouth.
// ==================================================================
export function buildWorldBelow(group) {
  const world = new THREE.Group();
  world.position.y = CITY_Y;
  world.name = 'worldBelow';

  // Dagobah palette: bright hazy daylight over swamp-greens and browns
  const matGround = new THREE.MeshStandardMaterial({ color: 0x5d6b42, metalness: 0.05, roughness: 1 });
  const matSwamp = new THREE.MeshStandardMaterial({ color: 0x4a5a38, metalness: 0.05, roughness: 1 });
  const bldMats = [
    new THREE.MeshStandardMaterial({ color: 0x8a8578, metalness: 0.2, roughness: 0.8 }),  // grey
    new THREE.MeshStandardMaterial({ color: 0x7a6a4d, metalness: 0.2, roughness: 0.85 }), // brown
    new THREE.MeshStandardMaterial({ color: 0x94875c, metalness: 0.2, roughness: 0.8 }),  // yellow-brown
    new THREE.MeshStandardMaterial({ color: 0x6e7a5a, metalness: 0.2, roughness: 0.85 }), // green-grey
  ];
  const winM = new THREE.MeshBasicMaterial({ color: 0xfff2c8, toneMapped: false });
  const hiveM = new THREE.MeshBasicMaterial({ color: 0x35e0c0, toneMapped: false });

  // the ground runs to the HAZE, not to an edge: a huge disc, fog eats the rim
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(2800, 2800, 2, 48), matGround);
  ground.position.y = -1;
  world.add(ground);
  let seed = 4242;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 40; i++) { // swamp flats + far marsh patches
    const a = rnd() * Math.PI * 2, r = 250 + rnd() * 2200;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(40 + rnd() * 160, 40 + rnd() * 160, 1.4, 10), matSwamp);
    p.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r);
    world.add(p);
  }

  // the city: bright futuristic blocks in the planet's own colors
  const buckets = bldMats.map(() => []);
  const winG = [], hiveG = [];
  const push = (arr, sx, sy, sz, x, y, z) => {
    const g2 = new THREE.BoxGeometry(sx, sy, sz);
    g2.translate(x, y, z);
    arr.push(g2);
  };
  const TILE = 44, N = 26, HALF = (N * TILE) / 2;
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const cx = tx * TILE - HALF + TILE / 2, cz = ty * TILE - HALF + TILE / 2;
    if (rnd() < 0.3) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let b = 0; b < n; b++) {
      const w = 8 + rnd() * 16, d = 8 + rnd() * 16, h = 8 + rnd() * rnd() * 54;
      const ox = (rnd() - 0.5) * (TILE - w - 6), oz = (rnd() - 0.5) * (TILE - d - 6);
      push(buckets[Math.floor(rnd() * bldMats.length)], w, h, d, cx + ox, h / 2, cz + oz);
      if (rnd() < 0.5) push(winG, w * 0.7, 0.7, 0.3, cx + ox, h * (0.3 + rnd() * 0.5), cz + oz + d / 2 + 0.05);
      if (rnd() < 0.13) push(hiveG, 4 + rnd() * 6, 1.4, 4 + rnd() * 6, cx + ox, 0.7, cz + oz + d / 2 + 3);
    }
  }
  const mk = (geos, mat) => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    if (!merged) return;
    const m = new THREE.Mesh(merged, mat);
    m.matrixAutoUpdate = false;
    world.add(m);
  };
  buckets.forEach((geos, i) => mk(geos, bldMats[i]));
  mk(winG, winM);
  mk(hiveG, hiveM);

  // TARGETS: 5 shield pylons + 3 AA batteries (positions in WORLD coords)
  const targets = [];
  const spots = [
    [-330, -280], [310, -180], [-160, 240], [260, 320], [40, -400],
    [-380, 90], [140, 90], [390, -330],
  ];
  for (let i = 0; i < spots.length; i++) {
    const pylon = i < 5;
    const m = pylon ? buildPylon() : buildAA();
    m.position.set(spots[i][0], 0, spots[i][1]);
    world.add(m);
    targets.push({
      grp: m, pos: new THREE.Vector3(spots[i][0], CITY_Y, spots[i][1]),
      hp: pylon ? 2 : 1, type: pylon ? 'PYLON' : 'AA', fireT: 2 + Math.random() * 2,
    });
  }

  // LZ beacon (lights when the grid is dead)
  const lz = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 420, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x66ff9a, transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  lz.position.set(30, 210, 30);
  lz.name = 'lzBeacon';
  world.add(lz);

  // daylight: warm sun + bright haze ambience (the deck shares it)
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.9);
  sun.position.set(-500, 700, 300);
  world.add(sun, new THREE.AmbientLight(0xc8ccae, 1.0));

  // sky: pale yellow-green haze dome around EVERYTHING (deck included)
  const skyC = document.createElement('canvas');
  skyC.width = 64; skyC.height = 256;
  const sctx = skyC.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9fb4c9');
  grad.addColorStop(0.45, '#c2cba6');
  grad.addColorStop(0.75, '#cfd0a0');
  grad.addColorStop(1, '#c8c193');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 64, 256);
  const skyT = new THREE.CanvasTexture(skyC);
  skyT.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, toneMapped: false, fog: false }));
  sky.position.y = 260; // centered near the deck so the horizon sits right
  world.add(sky);

  group.add(world);
  LW = { world, targets, lzWorld: new THREE.Vector3(30, CITY_Y, 30) };
  return world;
}

function buildPylon() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x8a8578, metalness: 0.3, roughness: 0.6 });
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
  const body = new THREE.MeshStandardMaterial({ color: 0x7a6a4d, metalness: 0.3, roughness: 0.7 });
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

// the landfall deck was torn down — a fresh sortie regenerates the world
export function clearWorldBelow() { LW = null; }

// ==================================================================
// THE ARRIVAL — hyperspace out the bridge windows, then the planet,
// then the descent, then the ship's voice clears you down.
// ==================================================================
export function startArrival(fast = false) {
  const fs0 = G.floors.get(0);
  if (!fs0?.meshGroup || A) { landfallPortalReady(); return; }
  const g = fs0.meshGroup;
  const cx0 = (fs0.grid.w / 2 - 0.5) * 4, cz0 = (fs0.grid.h / 2 - 0.5) * 4;
  // hyperspace tunnel: streak texture, spun hard
  let tun = g.getObjectByName('hyperTunnel');
  if (!tun) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * 128, len = 30 + Math.random() * 120;
      const gr = ctx.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, 'rgba(140,200,255,0)');
      gr.addColorStop(0.5, 'rgba(190,230,255,0.9)');
      gr.addColorStop(1, 'rgba(140,200,255,0)');
      ctx.fillStyle = gr;
      ctx.save();
      ctx.translate(Math.random() * 512, y);
      ctx.fillRect(0, 0, len, 1.6);
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    tun = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 46, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: t, toneMapped: false, fog: false, side: THREE.BackSide, transparent: true, opacity: 0 }));
    tun.name = 'hyperTunnel';
    tun.position.set(cx0, 4, cz0);
    tun.rotation.z = Math.PI / 2;
    g.add(tun);
  }
  // the planet: Dagobah marble waiting outside the glass
  let pl = g.getObjectByName('arrivalPlanet');
  if (!pl) {
    const pc = document.createElement('canvas');
    pc.width = 256; pc.height = 128;
    const pctx = pc.getContext('2d');
    pctx.fillStyle = '#7c8a56';
    pctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 60; i++) {
      pctx.fillStyle = ['#6a7a4a', '#8f8a5e', '#5d6b42', '#98a06a', '#7a6a4d'][i % 5];
      pctx.beginPath();
      pctx.ellipse(Math.random() * 256, Math.random() * 128, 12 + Math.random() * 44, 5 + Math.random() * 14, 0, 0, Math.PI * 2);
      pctx.fill();
    }
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    pl = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 18),
      new THREE.MeshBasicMaterial({ map: pt, toneMapped: false, fog: false }));
    pl.name = 'arrivalPlanet';
    pl.position.set(cx0, 6, cz0 - 33);
    pl.visible = false;
    g.add(pl);
  }
  A = { phase: 'jump', t: 0, tun, pl, fast: !!fast };
  sfx.rumble();
  G.shake = Math.max(G.shake || 0, 0.4);
  addMsg('All hands: TRANSLATION. The carrier is jumping to the destination.', 'gold');
}

export function updateArrival(dt) {
  if (!A) return;
  A.t += dt;
  const F = A.fast ? 0.12 : 1; // test links compress the ride
  if (A.phase === 'jump') {
    A.tun.visible = true;
    A.tun.material.opacity = Math.min(1, A.tun.material.opacity + dt * 2);
    A.tun.rotation.x += dt * 9;
    if (Math.random() < dt * 3) G.shake = Math.max(G.shake || 0, 0.15);
    if (A.t > 3.4 * F) {
      A.phase = 'drop'; A.t = 0;
      A.pl.visible = true;
      sfx.stairs();
      G.shake = Math.max(G.shake || 0, 0.35);
      addMsg('Translation complete — that green world is the target.', 'gold');
    }
  } else if (A.phase === 'drop') {
    A.tun.material.opacity = Math.max(0, A.tun.material.opacity - dt * 3);
    if (A.tun.material.opacity <= 0) A.tun.visible = false;
    if (A.t > 2.4 * F) {
      A.phase = 'descend'; A.t = 0;
      sfx.rumble();
      addMsg('Beginning descent…');
    }
  } else if (A.phase === 'descend') {
    A.pl.scale.setScalar(1 + A.t * (A.fast ? 2.2 : 0.28)); // the planet grows as we drop
    if (Math.random() < dt * 2) G.shake = Math.max(G.shake || 0, 0.12);
    if (A.t > 2.6 * F) {
      A.phase = 'done';
      say('Altitude is stable. Docking bay portal is open.');
      addMsg('"Altitude is stable. Docking bay portal is open." — take the breach portal down.', 'gold');
      landfallPortalReady();
      A = null;
    }
  }
}

// ==================================================================
// THE FLIGHT — begins when the bomber crosses the hangar mouth (the
// boarding/takeoff machine in space.js hands over mid-air, same scene,
// same coordinates). Ends by flying BACK IN and setting down.
// ==================================================================
function deckInfo() {
  const fs = G.floors.get(G.floor);
  const g = fs?.grid;
  if (!g?.mouth?.length) return null;
  const xs = g.mouth.map((m) => m.cx * 4);
  return {
    fs, g,
    mouthX0: Math.min(...xs) - 2, mouthX1: Math.max(...xs) + 2,
    mouthZ: (g.mouth[0].cy + 0.5) * 4,
    deckW: g.w * 4, deckH: g.h * 4,
  };
}

function startFlight(from) {
  const fs = G.floors.get(G.floor);
  const ship = buildBomber();
  ship.userData.vis.visible = false;
  const kit = cockpitKit();
  kit.position.set(0, 0.9, -0.6);
  ship.add(kit);
  ship.position.copy(from.pos);
  ship.quaternion.copy(from.quat);
  fs.meshGroup.add(ship);
  L = {
    ship, fs, boardAt: from.boardAt,
    bombs: MAX_BOMBS, hull: 140 + 30 * shipUp('hull'), maxHull: 140 + 30 * shipUp('hull'),
    maxSpeed: 56 + 6 * shipUp('engine'),
    speed: Math.max(20, from.speed), vel: new THREE.Vector3(), bank: 0, lock: null,
    bombsAway: [], flak: [], fx: [], phase: 'run', t: 0, landT: 0, dropCd: 0, sightFlash: 0,
    time0: G.time || 0,
  };
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  L.vel.copy(fwd).multiplyScalar(L.speed);
  document.getElementById('waveHud')?.classList.remove('hidden');
  addMsg('Bomber away. T locks a target; the BOMBSIGHT flashes RED in the release window (SPACE drops).', 'gold');
  addMsg('Six bombs. Dry racks? Fly back IN through the hangar mouth and set down to rearm.', 'gold');
  refreshHud();
}

// the boarding machine (space.js) calls this the instant the bomber clears
// the mouth of a LANDFALL deck — same scene, same position, no seam
setLandfallHook((from) => startFlight(from));

function endFlight(result) {
  if (!L) return;
  const fs = L.fs;
  fs.meshGroup.remove(L.ship);
  for (const b of L.bombsAway) fs.meshGroup.remove(b);
  for (const f of L.flak) if (f.mesh) fs.meshGroup.remove(f.mesh);
  for (const e of L.fx) fs.meshGroup.remove(e.mesh);
  const boardAt = L.boardAt;
  const time0 = L.time0;
  hideLockWidgets();
  document.getElementById('waveHud')?.classList.add('hidden');
  G.keys['Escape'] = false;
  for (const c of G.camera.children) c.visible = true;
  const kills = LW ? LW.targets.filter((t) => t.hp <= 0).length : 0;
  L = null;
  window.__sphL = null;
  G.mode = 'playing';
  if (boardAt && G.player) {
    G.player.obj.position.set(boardAt.x, 0, boardAt.z + 2);
    G.player.obj.position.y = 0;
    if (boardAt.yaw !== undefined) G.player.camYaw = boardAt.yaw;
  }
  if (result === 'DOCKED') {
    addMsg('Docked. Racks reloaded — six bombs. Board when ready.', 'gold');
    sfx.levelup();
  } else if (result === 'LZ SECURED') {
    const credits = 350 + kills * 25;
    G.run.gold += credits;
    G.run.landfall = Math.max(G.run.landfall || 0, 1);
    const g = G.floors.get(G.floor)?.grid;
    if (g) g.stairsLocked = false; // extraction opens
    saveReport({ section: 'OPERATION LANDFALL I', result, kills, credits, time: Math.round((G.time || 0) - time0) });
    addMsg(`LZ SECURED — shield grid down, +${credits} credits. Ground assault is NEXT. Extraction is open.`, 'gold');
    say('Shield grid destroyed. Well flown.');
    sfx.victory();
  } else if (result === 'SHOT DOWN') {
    saveReport({ section: 'OPERATION LANDFALL I', result, kills, credits: 0, time: Math.round((G.time || 0) - time0) });
    addMsg('Bomber lost — recovery pod tractored back to the deck.', 'bad');
  } else addMsg('Recovered to the deck.', 'bad');
  refreshHud();
}

export function landfallCycleLock() {
  if (!L || !LW) return;
  const alive = LW.targets.filter((t) => t.hp > 0);
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

export function landfallDrop() {
  if (!L || L.phase !== 'run') return;
  if (L.bombs <= 0) { addMsg('BOMBS OUT — fly back into the hangar and set down to rearm.', 'bad'); return; }
  if (L.dropCd > 0) return;
  L.dropCd = 0.4;
  L.bombs--;
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x39414c, metalness: 0.5, roughness: 0.6 }));
  b.position.copy(L.ship.position).add(new THREE.Vector3(0, -1.6, 0));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  b.userData.v = fwd.clone().multiplyScalar(L.speed);
  b.userData.v.y = Math.min(0, b.userData.v.y);
  L.fs.meshGroup.add(b);
  L.bombsAway.push(b);
  sfx.bolt();
}

function hurtBomber(n) {
  L.hull -= n;
  G.shake = Math.max(G.shake || 0, 0.3);
  if (L.hull <= 0) endFlight('SHOT DOWN');
}

function boom(pos, big = false) {
  const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 9 : 5, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, toneMapped: false }));
  flash.position.copy(pos);
  L.fs.meshGroup.add(flash);
  L.fx.push({ mesh: flash, t: 0, dur: big ? 0.7 : 0.45 });
  const ringG = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.8, toneMapped: false, side: THREE.DoubleSide }));
  ringG.position.set(pos.x, CITY_Y + 1.4, pos.z);
  L.fs.meshGroup.add(ringG);
  L.fx.push({ mesh: ringG, t: 0, dur: 0.9, ring: true, big });
  sfx.rumble();
}

const _ip = new THREE.Vector3(), _wp = new THREE.Vector3();

function impactPoint(out) {
  const h = Math.max(0, L.ship.position.y - CITY_Y);
  const t = Math.sqrt((2 * h) / GRAV);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  out.set(L.ship.position.x + fwd.x * L.speed * t, CITY_Y, L.ship.position.z + fwd.z * L.speed * t);
  return out;
}

// ---------------- the bombsight monitor ----------------
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
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  const yaw = Math.atan2(fwd.x, -fwd.z);
  impactPoint(_ip);
  const onWindow = lock ? Math.hypot(_ip.x - lock.pos.x, _ip.z - lock.pos.z) <= RELEASE_R : false;
  L.sightFlash = (L.sightFlash + dt * 9) % 2;
  const hot = onWindow && L.sightFlash < 1;
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
  ctx.strokeStyle = 'rgba(138, 92, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
  ctx.strokeRect(cx - 8, cy - 8, 16, 16);
  ctx.strokeStyle = 'rgba(79, 232, 224, 0.4)';
  ctx.beginPath(); ctx.arc(cx, cy, RELEASE_R * 1.05, 0, Math.PI * 2); ctx.stroke();
  const dx = _ip.x - lock.pos.x, dz = _ip.z - lock.pos.z;
  const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
  const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
  const px2 = Math.max(8, Math.min(W - 8, cx + rx * 1.05));
  const py2 = Math.max(8, Math.min(H - 8, cy + rz * 1.05));
  ctx.strokeStyle = hot ? '#ff3b30' : '#ffce2e';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px2, py2); ctx.stroke();
  ctx.fillStyle = hot ? '#ff3b30' : '#ffce2e';
  ctx.beginPath(); ctx.arc(px2, py2, hot ? 6 : 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cfe8ff';
  ctx.textAlign = 'left';
  ctx.fillText(`ALT ${Math.round(L.ship.position.y - CITY_Y)}`, 8, 16);
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
  if (G.keys['Escape'] && L.phase === 'run') { endFlight('RECOVERED'); return; }

  const D = deckInfo();

  if (L.phase === 'dock' || L.phase === 'land') {
    // hands off: glide to the set-down point
    L.landT += dt;
    L.ship.position.lerp(L.landAt, Math.min(1, dt * 1.6));
    L.ship.quaternion.slerp(L.landQ, Math.min(1, dt * 2.2));
    const fwdL = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(L.ship.quaternion);
    G.camera.position.copy(L.ship.position).addScaledVector(upL, 0.9).addScaledVector(fwdL, 0.6);
    G.camera.quaternion.copy(L.ship.quaternion);
    const wh = document.getElementById('waveHud');
    if (wh) wh.textContent = L.phase === 'dock' ? 'DECK CREW HAS YOU — setting down' : 'FLARE… FLARE… touchdown';
    if (L.landT > 2.8) endFlight(L.phase === 'dock' ? 'DOCKED' : 'LZ SECURED');
    return;
  }

  // flight
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

  // the planet's surface is real
  if (L.ship.position.y < CITY_Y + 6) {
    L.ship.position.y = CITY_Y + 6;
    if (L.vel.y < 0) L.vel.y = 0;
    hurtBomber(20);
    if (!L) return;
    addMsg('TERRAIN — pull up!', 'bad');
  }
  if (L.ship.position.y > 80) L.ship.position.y = 80; // the carrier's operating ceiling
  // soft range: the haze is the border — ease you back, no walls
  const rr = Math.hypot(L.ship.position.x, L.ship.position.z);
  if (rr > 1250) {
    L.ship.position.x *= 1250 / rr;
    L.ship.position.z *= 1250 / rr;
    addMsg('Leaving the op zone — turning back into the haze.', 'bad');
  }

  // THE CARRIER IS SOLID (except the mouth corridor — that's the door)
  if (D) {
    const p = L.ship.position;
    const inMouthX = p.x > D.mouthX0 + 3 && p.x < D.mouthX1 - 3;
    const corridor = inMouthX && p.y > 0.4 && p.y < 7 && p.z > -6 && p.z < D.mouthZ + 44;
    const insideDeckBox = p.x > -4 && p.x < D.deckW + 4 && p.y > -3 && p.y < 15 && p.z > -4 && p.z < D.mouthZ + 1;
    if (insideDeckBox && !corridor) {
      // bounced off the hull
      L.vel.multiplyScalar(-0.4);
      L.ship.position.addScaledVector(L.vel, dt * 4);
      hurtBomber(10);
      if (!L) return;
      addMsg('HULL STRIKE — the bay mouth is the only way in.', 'bad');
    }
    // DOCKING: fly in through the mouth, lined up — the deck crew takes you
    // the rest of the way to the pad
    if (corridor && p.z < D.mouthZ - 2 && L.vel.z < 0) {
      L.phase = 'dock';
      L.landT = 0;
      L.landAt = new THREE.Vector3(L.boardAt.x, 1.4, L.boardAt.z + 6);
      L.landQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (L.boardAt.yaw || 0) + Math.PI, 0));
      addMsg('Through the mouth — deck crew waving you to the pad.', 'gold');
      sfx.stairs();
      return;
    }
  }

  // bombs fall, bombs land
  for (let i = L.bombsAway.length - 1; i >= 0; i--) {
    const b = L.bombsAway[i];
    b.userData.v.y -= GRAV * dt;
    b.position.addScaledVector(b.userData.v, dt);
    if (b.position.y <= CITY_Y + 1) {
      boom(b.position.clone().setY(CITY_Y + 1), false);
      if (LW) for (const t of LW.targets) {
        if (t.hp <= 0) continue;
        if (Math.hypot(b.position.x - t.pos.x, b.position.z - t.pos.z) < 16) {
          t.hp--;
          if (t.hp <= 0) {
            boom(t.pos.clone().setY(CITY_Y + 4), true);
            t.grp.visible = false;
            const left = LW.targets.filter((x) => x.hp > 0).length;
            addMsg(`${t.type === 'PYLON' ? 'SHIELD PYLON' : 'AA BATTERY'} DESTROYED — ${left} targets left.`, 'gold');
            if (t === L.lock) L.lock = null;
            if (!left) {
              addMsg('SHIELD GRID DOWN. The LZ beacon is lit — land on the green column.', 'gold');
              say('Shield grid down. Landing zone beacon active.');
              const lz = LW.world.getObjectByName('lzBeacon');
              if (lz) lz.material.opacity = 0.3;
              sfx.victory();
            }
          } else addMsg(`Direct hit — the ${t.type === 'PYLON' ? 'pylon' : 'battery'} is cracked.`, 'gold');
        }
      }
      L.fs.meshGroup.remove(b);
      L.bombsAway.splice(i, 1);
    }
  }

  // AA: they LEAD you
  if (LW) for (const t of LW.targets) {
    if (t.hp <= 0 || t.type !== 'AA') continue;
    t.fireT -= dt;
    const d = L.ship.position.distanceTo(t.pos);
    if (t.fireT <= 0 && d < 430 && L.ship.position.y < CITY_Y + 300) {
      t.fireT = 1.5 + Math.random() * 1.6;
      const tt = d / 130;
      const aim = L.ship.position.clone().addScaledVector(L.vel, tt)
        .add(new THREE.Vector3((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 26));
      L.flak.push({ from: t.pos.clone().add(new THREE.Vector3(0, 8, 0)), to: aim, t: 0, dur: tt * 0.55 + 0.4 });
    }
  }
  for (let i = L.flak.length - 1; i >= 0; i--) {
    const f = L.flak[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    if (!f.mesh) {
      f.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.2),
        new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }));
      L.fs.meshGroup.add(f.mesh);
    }
    f.mesh.position.lerpVectors(f.from, f.to, k);
    if (k >= 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff7733, transparent: true, opacity: 0.9, toneMapped: false }));
      puff.position.copy(f.to);
      L.fs.meshGroup.add(puff);
      L.fx.push({ mesh: puff, t: 0, dur: 0.5 });
      const dd = f.to.distanceTo(L.ship.position);
      if (dd < 10) { hurtBomber(9 + Math.random() * 6); if (!L) return; }
      else if (dd < 26) G.shake = Math.max(G.shake || 0, 0.12);
      L.fs.meshGroup.remove(f.mesh);
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
    if (k >= 1) { L.fs.meshGroup.remove(e.mesh); L.fx.splice(i, 1); }
  }

  // LZ landing (only once the grid is dead)
  if (LW && !LW.targets.some((t) => t.hp > 0)) {
    const d2 = Math.hypot(L.ship.position.x - LW.lzWorld.x, L.ship.position.z - LW.lzWorld.z);
    if (d2 < 26 && L.ship.position.y < CITY_Y + 40 && L.speed < 36) {
      L.phase = 'land';
      L.landT = 0;
      L.landAt = new THREE.Vector3(LW.lzWorld.x, CITY_Y + 3, LW.lzWorld.z);
      const fwdY = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
      L.landQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-fwdY.x, -fwdY.z) + Math.PI, 0));
      addMsg('LZ acquired — flaring for touchdown.', 'gold');
      return;
    }
  }

  // lock HUD
  if (L.lock && L.lock.hp > 0) {
    _wp.copy(L.lock.pos).setY(L.lock.type === 'PYLON' ? CITY_Y + 40 : CITY_Y + 8);
    drawLockAt(_wp, `${L.lock.type} ${Math.round(L.ship.position.distanceTo(L.lock.pos))}m`,
      L.lock.type === 'PYLON' ? '#bb99ff' : '#ff8855');
  } else hideLockWidgets();

  // cockpit camera (world coords — no group offset, it's ONE world)
  G.camera.position.copy(L.ship.position).addScaledVector(up, 0.9).addScaledVector(fwd, 0.6);
  G.camera.quaternion.copy(L.ship.quaternion);
  G.camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, L.bank)));

  // HUD
  const left = LW ? LW.targets.filter((t) => t.hp > 0).length : 0;
  const wh = document.getElementById('waveHud');
  if (wh) {
    wh.textContent = L.bombs <= 0
      ? 'BOMBS OUT — FLY BACK IN THROUGH THE MOUTH'
      : left ? `TARGETS ${left} · BOMBS ${L.bombs}` : 'LAND ON THE GREEN BEACON — low and slow';
  }
  const hpfill = document.getElementById('hpfill'), hptext = document.getElementById('hptext');
  if (hpfill) hpfill.style.width = `${Math.max(0, (L.hull / L.maxHull) * 100)}%`;
  if (hptext) hptext.textContent = `BOMBER ${Math.max(0, Math.round(L.hull))} / ${L.maxHull}`;

  drawBombsight(dt);
}

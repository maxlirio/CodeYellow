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
  buildBomber, buildCarrier, cockpitKit, drawLockAt, hideLockWidgets, setLandfallHook, flashScreen,
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
export function buildWorldBelow(group, grid) {
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

  // THE CARRIER ITSELF — the exact ship from space, scaled so colossal that
  // every deck you've fought through plausibly fits inside, and this hangar
  // is just one aperture on its flank. The deck sits INSIDE the hull.
  const S = 6;
  const xs = grid.mouth.map((m) => m.cx * 4);
  const mouthX0 = Math.min(...xs) - 2, mouthX1 = Math.max(...xs) + 2;
  const mouthZ = (grid.mouth[0].cy + 0.5) * 4;
  const W = grid.w * 4;
  const C = new THREE.Vector3(W / 2 + 120, 20, mouthZ + 8 - 27 * S);
  const aperture = {
    x0: (mouthX0 - 14 - C.x) / S, x1: (mouthX1 + 14 - C.x) / S,
    y0: (-10 - C.y) / S, y1: (26 - C.y) / S,
  };
  const carrier = buildCarrier(aperture);
  carrier.position.copy(C);
  carrier.scale.setScalar(S);
  group.add(carrier);
  // hull collision volumes (ship-local AABBs, scaled/offset), corridor-exempt
  const hullBoxes = [
    { x: 20, y: 0, z: 0, hx: 101, hy: 20, hz: 29 },
    { x: 150, y: 0, z: 0, hx: 32, hy: 9, hz: 15 },
    { x: -128, y: 0, z: 0, hx: 55, hy: 20, hz: 31 },
    { x: -18, y: 31, z: 0, hx: 37, hy: 15, hz: 18 },
  ].map((b) => ({
    x: b.x * S + C.x, y: b.y * S + C.y, z: b.z * S + C.z,
    hx: b.hx * S, hy: b.hy * S, hz: b.hz * S,
  }));

  LW = { world, targets, lzWorld: new THREE.Vector3(30, CITY_Y, 30), hullBoxes, carrier };
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
  // HYPERSPACE: two counter-rotating streak cylinders + a scrolling texture —
  // the windows become a tunnel of light
  const mkTunnel = (r, op) => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(2,4,10,0)';
    ctx.clearRect(0, 0, 512, 128);
    for (let i = 0; i < 170; i++) {
      const y = Math.random() * 128, len = 50 + Math.random() * 190;
      const gr = ctx.createLinearGradient(0, 0, len, 0);
      const hue = Math.random() < 0.7 ? '190,230,255' : '150,180,255';
      gr.addColorStop(0, `rgba(${hue},0)`);
      gr.addColorStop(0.5, `rgba(${hue},0.95)`);
      gr.addColorStop(1, `rgba(${hue},0)`);
      ctx.save();
      ctx.translate(Math.random() * 512, y); // gradient is 0..len — draw AT the origin
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, len, 1.8 + Math.random() * 1.8);
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 46, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: t, toneMapped: false, fog: false, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(cx0, 4, cz0);
    m.rotation.z = Math.PI / 2;
    m.userData.maxOp = op;
    g.add(m);
    return m;
  };
  let tun = g.getObjectByName('hyperTunnel');
  let tun2 = g.getObjectByName('hyperTunnel2');
  if (!tun) { tun = mkTunnel(36, 1); tun.name = 'hyperTunnel'; }
  if (!tun2) { tun2 = mkTunnel(33, 0.65); tun2.name = 'hyperTunnel2'; }
  // the planet: a small green marble far out — it GROWS on descent but is
  // capped well outside the glass (it must never enter the room)
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
    // polar haze caps
    pctx.fillStyle = 'rgba(230,238,220,0.5)';
    pctx.fillRect(0, 0, 256, 10);
    pctx.fillRect(0, 118, 256, 10);
    const pt = new THREE.CanvasTexture(pc);
    pt.colorSpace = THREE.SRGBColorSpace;
    pl = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 18),
      new THREE.MeshBasicMaterial({ map: pt, toneMapped: false, fog: false }));
    pl.name = 'arrivalPlanet';
    pl.position.set(cx0, 6, cz0 - 34);
    g.add(pl);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(15.8, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xbfe0a8, transparent: true, opacity: 0.18, toneMapped: false, fog: false, side: THREE.BackSide }));
    pl.add(glow);
  }
  pl.visible = false;
  pl.scale.setScalar(0.32);
  // atmosphere shell: fades in over the stars as we descend into the haze
  let haze = g.getObjectByName('arrivalHaze');
  if (!haze) {
    haze = new THREE.Mesh(new THREE.CylinderGeometry(37, 37, 44, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xc2cba6, toneMapped: false, fog: false, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
    haze.name = 'arrivalHaze';
    haze.position.set(cx0, 4, cz0);
    g.add(haze);
  }
  const stars = g.getObjectByName('bridgeStars');
  // no dogfight in hyperspace — the ambient war stays behind at the hulk
  const war = (G.floors.get(0)?.warShips) || [];
  for (const f of war) f.visible = false;
  A = { phase: 'spool', t: 0, tun, tun2, pl, haze, stars, war, plZ0: cz0 - 34, fast: !!fast };
  sfx.rumble();
  G.shake = Math.max(G.shake || 0, 0.35);
  addMsg('All hands: TRANSLATION in 3… 2… 1…', 'gold');
  say('Translation. Hold on to something.');
}

export function updateArrival(dt) {
  window.__arr = A ? A.phase : null; // probe hook
  if (!A) return;
  A.t += dt;
  const F = A.fast ? 0.16 : 1; // probe links compress the ride
  if (A.phase === 'spool') {
    // the drives spool — the shake builds until the jump SLAMS in
    G.shake = Math.max(G.shake || 0, 0.1 + A.t * 0.12);
    if (A.t > 2.6 * F) {
      A.phase = 'jump'; A.t = 0;
      flashScreen();
      sfx.stairs();
      addMsg('JUMP.', 'gold');
    }
  } else if (A.phase === 'jump') {
    // 12 seconds in the tunnel — spin, counter-spin, scroll, pulse
    for (const tn of [A.tun, A.tun2]) tn.visible = true;
    A.tun.material.opacity = Math.min(A.tun.userData.maxOp, A.tun.material.opacity + dt * 1.6);
    A.tun2.material.opacity = Math.min(A.tun2.userData.maxOp, A.tun2.material.opacity + dt * 1.6);
    A.tun.rotateY(dt * (7 + Math.sin(A.t * 0.7) * 2)); // spin on the tunnel's OWN axis
    A.tun2.rotateY(-dt * 4.5);
    A.tun.material.map.offset.x -= dt * 2.2;
    A.tun2.material.map.offset.x += dt * 1.4;
    if (A.stars) A.stars.material.opacity = Math.max(0.15, 1 - A.t * 0.5);
    if (Math.random() < dt * 2.2) G.shake = Math.max(G.shake || 0, 0.1);
    if (A.t > 12 * F) {
      A.phase = 'drop'; A.t = 0;
      flashScreen();
      A.pl.visible = true;
      if (A.stars) A.stars.material.opacity = 1;
      sfx.rumble();
      G.shake = Math.max(G.shake || 0, 0.45);
      addMsg('Translation complete. There she is — the green world they took.', 'gold');
      say('Translation complete. Destination in view.');
    }
  } else if (A.phase === 'drop') {
    // the tunnel collapses; the planet hangs small and far in the glass
    A.tun.material.opacity = Math.max(0, A.tun.material.opacity - dt * 2.5);
    A.tun2.material.opacity = Math.max(0, A.tun2.material.opacity - dt * 2.5);
    if (A.tun.material.opacity <= 0) { A.tun.visible = false; A.tun2.visible = false; }
    A.pl.scale.setScalar(Math.min(0.45, A.pl.scale.x + dt * 0.02));
    A.pl.position.z = A.plZ0;
    if (A.t > 5 * F) {
      A.phase = 'descend'; A.t = 0;
      sfx.rumble();
      addMsg('Beginning descent — atmospheric interface in ten.', 'gold');
    }
  } else if (A.phase === 'descend') {
    // 10s down: the planet swells (capped OUTSIDE the glass), the starfield
    // gives way to bright haze — you can FEEL the atmosphere take the hull
    const k = Math.min(1, A.t / (10 * F));
    const ease = k * k * (3 - 2 * k);
    // the planet GROWS on screen but RECEDES in space — its surface can
    // never cross the glass into the room (the old version ballooned in)
    A.pl.scale.setScalar(0.45 + ease * 2.1);
    A.pl.position.z = A.plZ0 - ease * 55;
    if (A.stars) A.stars.material.opacity = Math.max(0, 1 - ease * 1.2);
    A.haze.material.opacity = Math.min(0.85, ease * 1.0);
    if (k > 0.55) A.pl.material.opacity = 1; // (kept: the haze covers the final swell)
    if (k > 0.75 && !A.buffet) { A.buffet = true; sfx.rumble(); addMsg('Atmospheric interface — buffeting.', 'gold'); }
    if (Math.random() < dt * (1 + k * 3)) G.shake = Math.max(G.shake || 0, 0.08 + k * 0.14);
    if (A.t > 10 * F + 1.2) {
      A.phase = 'done';
      A.pl.visible = false; // below the cloud deck — outside is bright haze now
      if (A.stars) A.stars.material.opacity = 0;
      A.haze.material.opacity = 0.75;
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
  ship.userData.monitor = kit.userData.monitor;
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
  const tr = document.getElementById('topright');
  if (tr) tr.style.display = 'none'; // the bombsight lives on the dash monitor
  addMsg('Bomber away. T locks a target; the DASH MONITOR flashes RED in the release window (SPACE drops).', 'gold');
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
  const trE = document.getElementById('topright');
  if (trE) trE.style.display = '';
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
  const mon = L.ship.userData.monitor;
  if (!mon) return;
  const cv = mon.canvas;
  const ctx = cv.getContext('2d');
  mon.tex.needsUpdate = true;
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

  // ASSISTED DOCKING: no tractor. The assist eases your nose onto the glide
  // line, but SPEED, HEIGHT and DRIFT are yours — blow any of them at the
  // threshold and you get waved off.
  L.approach = false;
  if (D) {
    const p = L.ship.position;
    const xC = (D.mouthX0 + D.mouthX1) / 2;
    const halfW = (D.mouthX1 - D.mouthX0) / 2;
    const inApproach = p.z > D.mouthZ + 2 && p.z < D.mouthZ + 130
      && Math.abs(p.x - xC) < halfW + 50 && p.y > -16 && p.y < 40 && L.vel.z < -2;
    if (inApproach) {
      L.approach = true;
      const want = new THREE.Vector3((xC - p.x) * 0.9, (3.2 - p.y) * 0.7, -70).normalize();
      const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), want);
      L.ship.quaternion.rotateTowards(tq, 0.5 * dt); // a nudge, not a grab
      L.dockOk = L.speed <= 32 && Math.abs(p.x - xC) < halfW - 7 && p.y > 0.5 && p.y < 7.2;
    }
    // the threshold: cross it clean or get thrown back out
    const inMouthX = p.x > D.mouthX0 + 4 && p.x < D.mouthX1 - 4;
    if (p.z <= D.mouthZ + 2 && p.z > D.mouthZ - 10 && L.vel.z < 0 && inMouthX && p.y > 0.3 && p.y < 8.5) {
      if (L.speed <= 34 && Math.abs(p.x - xC) < halfW - 5) {
        L.phase = 'dock';
        L.landT = 0;
        L.landAt = new THREE.Vector3(L.boardAt.x, 1.4, L.boardAt.z + 6);
        L.landQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (L.boardAt.yaw || 0) + Math.PI, 0));
        addMsg('Threshold clean — deck crew waving you to the pad.', 'gold');
        sfx.stairs();
        return;
      }
      // WAVE OFF
      L.ship.position.z = D.mouthZ + 30;
      L.vel.set(0, 2, 26);
      L.speed = Math.min(L.speed, 24);
      if (L.speed > 30) { hurtBomber(8); if (!L) return; }
      addMsg('WAVE OFF — under 30, centered, deck height. Go around.', 'bad');
      G.shake = Math.max(G.shake || 0, 0.3);
    }
    // the rest of the deck slice is solid
    const insideDeckBox = p.x > -4 && p.x < D.deckW + 4 && p.y > -3 && p.y < 15 && p.z > -4 && p.z < D.mouthZ + 1;
    const corridor = inMouthX && p.y > 0.3 && p.y < 8.5 && p.z > -6;
    if (insideDeckBox && !corridor) {
      L.vel.multiplyScalar(-0.4);
      L.ship.position.addScaledVector(L.vel, dt * 4);
      hurtBomber(10);
      if (!L) return;
      addMsg('HULL STRIKE — the bay mouth is the only way in.', 'bad');
    }
  }
  // the COLOSSAL hull is solid too (fly around her, not through her)
  if (LW?.hullBoxes) {
    const p = L.ship.position;
    const nearMouth = D && p.z > D.mouthZ - 12 && p.z < D.mouthZ + 60
      && p.x > D.mouthX0 - 20 && p.x < D.mouthX1 + 20 && p.y > -12 && p.y < 30;
    if (!nearMouth) for (const hb of LW.hullBoxes) {
      if (Math.abs(p.x - hb.x) >= hb.hx || Math.abs(p.y - hb.y) >= hb.hy || Math.abs(p.z - hb.z) >= hb.hz) continue;
      const dx = hb.hx - Math.abs(p.x - hb.x), dy = hb.hy - Math.abs(p.y - hb.y), dz = hb.hz - Math.abs(p.z - hb.z);
      const sgn = (v) => (v >= 0 ? 1 : -1);
      if (dx <= dy && dx <= dz) { p.x = hb.x + sgn(p.x - hb.x) * hb.hx; L.vel.x *= -0.3; }
      else if (dy <= dz) { p.y = hb.y + sgn(p.y - hb.y) * hb.hy; L.vel.y *= -0.3; }
      else { p.z = hb.z + sgn(p.z - hb.z) * hb.hz; L.vel.z *= -0.3; }
      hurtBomber(8);
      if (!L) return;
      addMsg('HULL STRIKE — she is a lot of ship. Fly around her.', 'bad');
      break;
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
    if (L.approach) {
      wh.textContent = `DOCKING — SPEED ${Math.round(L.speed)}/30 ${L.speed <= 32 ? '✓' : 'SLOW'} · ${L.dockOk ? 'ON THE LINE' : 'LINE UP'}`;
    } else {
      wh.textContent = L.bombs <= 0
        ? 'BOMBS OUT — FLY BACK IN THROUGH THE MOUTH'
        : left ? `TARGETS ${left} · BOMBS ${L.bombs}` : 'LAND ON THE GREEN BEACON — low and slow';
    }
  }
  const hpfill = document.getElementById('hpfill'), hptext = document.getElementById('hptext');
  if (hpfill) hpfill.style.width = `${Math.max(0, (L.hull / L.maxHull) * 100)}%`;
  if (hptext) hptext.textContent = `BOMBER ${Math.max(0, Math.round(L.hull))} / ${L.maxHull}`;

  drawBombsight(dt);
}

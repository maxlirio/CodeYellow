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
import { netSend } from './net.js';
import { makePiece, makeCharacter, buildMergedStatic, ALIEN_MODELS } from './assets.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { saveReport } from './bridge.js';
import { landfallPortalReady } from './missions.js';
import {
  buildBomber, buildFighter, buildCarrier, cockpitKit, drawLockAt, hideLockWidgets, setLandfallHook, flashScreen, SHIP_SLOTS, mySlot, slotOf, HULL_LOCAL_BOXES,
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
// (G.assets is populated by loadAll before any deck builds)

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

  // THE CITY, from a real city kit (KayKit City Builder Bits, CC0): eight
  // building types, streetlights, water towers, real cars floating the grid.
  // Center-city buildings are INDIVIDUAL clones — bombable, scorchable,
  // collapsible; the outer ring merges into a handful of draw calls.
  const TILE = 44, N = 26, HALF = (N * TILE) / 2;
  const hiveM = new THREE.MeshBasicMaterial({ color: 0x35e0c0, toneMapped: false });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(N * TILE + 30, 1.6, N * TILE + 30),
    new THREE.MeshStandardMaterial({ color: 0x6d7178, metalness: 0.1, roughness: 0.9 }));
  plate.position.y = 0.3;
  world.add(plate);
  const streetG = [];
  const pushG = (arr, sx, sy, sz, x, y, z) => {
    const g2 = new THREE.BoxGeometry(sx, sy, sz);
    g2.translate(x, y, z);
    arr.push(g2);
  };
  for (let i = 0; i <= N; i++) {
    pushG(streetG, N * TILE, 0.4, 7, 0, 1.15, i * TILE - HALF);
    pushG(streetG, 7, 0.4, N * TILE, i * TILE - HALF, 1.15, 0);
  }
  {
    const merged = mergeGeometries(streetG, false);
    const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 0.1, roughness: 0.95 }));
    m.matrixAutoUpdate = false;
    world.add(m);
  }
  const BLD = ['city_building_A', 'city_building_B', 'city_building_C', 'city_building_D',
    'city_building_E', 'city_building_F', 'city_building_G', 'city_building_H'];
  // measured height per type -> scale so towers land at 10-26u
  const bldH = {};
  for (const bn of BLD) {
    const g3 = G.assets.piece[bn];
    let hi = 0.5;
    for (const bb of g3.bounds || []) hi = Math.max(hi, bb.max.y);
    bldH[bn] = hi;
  }
  const buildings = [];
  const farPlacements = [];
  const hiveG = [];
  const DMG_R = 280;
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _s4 = new THREE.Vector3();
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
    const cx = tx * TILE - HALF + TILE / 2, cz = ty * TILE - HALF + TILE / 2;
    if (rnd() < 0.24) continue;
    const nB = 1;
    for (let b = 0; b < nB; b++) {
      const bn = BLD[Math.floor(rnd() * BLD.length)];
      const targetH = 22 + rnd() * rnd() * 52; // REAL towers now
      const sc = targetH / bldH[bn];
      const ox = (rnd() - 0.5) * (TILE - 18), oz = (rnd() - 0.5) * (TILE - 18);
      const bx = cx + ox, bz = cz + oz;
      const yaw = Math.floor(rnd() * 4) * (Math.PI / 2);
      if (Math.hypot(bx, bz) < DMG_R) {
        // ONE mesh per damageable building — clones of the raw kit scene were
        // 3-5 draw calls each and drowned the frame budget
        const src = G.assets.piece[bn];
        _q4.setFromEuler(new THREE.Euler(0, yaw, 0));
        _m4.compose(new THREE.Vector3(0, 0, 0), _q4, _s4.setScalar(sc));
        const geos = src.baked.map(({ geo }) => geo.clone().applyMatrix4(_m4));
        const m = new THREE.Mesh(mergeGeometries(geos, false), src.baked[0].mat);
        for (const g4 of geos) g4.dispose();
        m.position.set(bx, 1.1, bz);
        world.add(m);
        buildings.push({ mesh: m, x: bx, z: bz, w: 8 * sc, d: 8 * sc, h: targetH, hp: 1 + Math.round(targetH / 16), falling: 0 });
      } else {
        _q4.setFromEuler(new THREE.Euler(0, yaw, 0));
        _m4.compose(new THREE.Vector3(bx, 1.1, bz), _q4, _s4.setScalar(sc));
        farPlacements.push({ piece: bn, matrix: _m4.clone() });
      }
      if (rnd() < 0.1) { // hive pods crouch against the walls
        const hw = 3 + rnd() * 3, hx2 = bx + (rnd() - 0.5) * 10, hz2 = bz + 6 + rnd() * 4;
        pushG(hiveG, hw, 1.6, hw, hx2, 1.8, hz2);
        pushG(hiveG, hw * 0.62, 1.2, hw * 0.62, hx2, 3.0, hz2);
      }
    }
  }
  // street furniture: lights along the grid, water towers on the skyline
  for (let i = 0; i < N; i += 2) {
    for (let j = 0; j < N; j += 3) {
      _q4.setFromEuler(new THREE.Euler(0, (i + j) % 2 ? Math.PI / 2 : 0, 0));
      _m4.compose(new THREE.Vector3(i * TILE - HALF + 4, 1.1, j * TILE - HALF + 4), _q4, _s4.setScalar(3.4));
      farPlacements.push({ piece: 'city_streetlight', matrix: _m4.clone() });
    }
  }
  for (let i = 0; i < 10; i++) {
    _q4.setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0));
    _m4.compose(new THREE.Vector3((rnd() - 0.5) * N * TILE * 0.9, 1.1, (rnd() - 0.5) * N * TILE * 0.9), _q4, _s4.setScalar(5));
    farPlacements.push({ piece: 'city_watertower', matrix: _m4.clone() });
  }
  world.add(buildMergedStatic(farPlacements));
  {
    const merged = mergeGeometries(hiveG, false);
    if (merged) {
      const m = new THREE.Mesh(merged, hiveM);
      m.matrixAutoUpdate = false;
      world.add(m);
    }
  }

  // STREET LIFE, for real: Quaternius aliens and our own combat frames on
  // foot, KayKit cars floating the grid. All of them are targets.
  const life = new THREE.Group();
  world.add(life);
  const walkers = [], cars = [];
  const ROBOTS = ['Cyber_Enemy_2Legs_Gun', 'RobotExpressive'];
  for (let i = 0; i < 24; i++) {
    const alien = rnd() < 0.65;
    const model = alien ? ALIEN_MODELS[Math.floor(rnd() * ALIEN_MODELS.length)] : ROBOTS[Math.floor(rnd() * ROBOTS.length)];
    let obj = null, anim = null;
    try {
      const c = makeCharacter('enemy', model);
      obj = c.obj; anim = c.anim;
      const played = ['Walk', 'Walking', 'Run', 'Running_A', 'Idle'].find((n) => anim.has(n));
      if (played) anim.play(played, { timeScale: 0.9 + rnd() * 0.3 });
      obj.scale.setScalar(alien ? 2.2 : 1.8);
    } catch { continue; }
    const lane = Math.floor(rnd() * (N + 1)) * TILE - HALF;
    const horiz = rnd() < 0.5;
    const t0 = (rnd() - 0.5) * N * TILE * 0.9;
    obj.position.set(horiz ? t0 : lane, 1.4, horiz ? lane : t0);
    life.add(obj);
    walkers.push({ grp: obj, anim, horiz, lane, t: t0, dir: rnd() < 0.5 ? 1 : -1, sp: 2 + rnd() * 2.5, alien, dead: false });
  }
  const CARS = ['city_car_hatchback', 'city_car_police', 'city_car_sedan', 'city_car_stationwagon', 'city_car_taxi'];
  const glowMats = [0xff4fa0, 0xffce2e, 0x4fe8e0].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  for (let i = 0; i < 22; i++) {
    const cgrp = new THREE.Group();
    const car = makePiece(CARS[Math.floor(rnd() * CARS.length)]);
    car.scale.setScalar(3.2);
    cgrp.add(car);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 2.2), glowMats[i % 3]);
    glow.position.y = -0.35;
    cgrp.add(glow);
    const lane = Math.floor(rnd() * (N + 1)) * TILE - HALF;
    const horiz = rnd() < 0.5;
    const t0 = (rnd() - 0.5) * N * TILE * 0.9;
    cgrp.position.set(horiz ? t0 : lane, 3.6, horiz ? lane : t0);
    cgrp.rotation.y = horiz ? Math.PI / 2 : 0;
    life.add(cgrp);
    cars.push({ grp: cgrp, horiz, lane, t: t0, dir: rnd() < 0.5 ? 1 : -1, sp: 14 + rnd() * 14, dead: false });
  }

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
  // hull collision volumes match the visual pieces exactly (scaled/offset)
  const hullBoxes = HULL_LOCAL_BOXES.map((b) => ({
    x: b.x * S + C.x, y: b.y * S + C.y, z: b.z * S + C.z,
    hx: b.hx * S, hy: b.hy * S, hz: b.hz * S,
  }));

  LW = { world, targets, lzWorld: new THREE.Vector3(30, CITY_Y, 30), hullBoxes, carrier, buildings, walkers, cars, scorchMat: new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0, roughness: 1 }) };
  group.userData.LW = LW; // the world belongs to ITS deck — rebind on entry
  return world;
}

// ONE SHIP, ONE WORLD: called on every floor entry. A deck keeps its own
// world-below across visits; any flight deck standing at the planet grows
// the planet under it, and its deep-space backdrop goes dark until we leave.
export function landfallSyncFloor(fs) {
  const g = fs?.grid;
  if (!g || !fs.meshGroup) return;
  const atPlanet = g.landfall || (g.spaceZone && G.shipLoc === 'planet');
  const sw = fs.meshGroup.getObjectByName('spaceWorld');
  if (sw) sw.visible = !atPlanet;
  if (atPlanet) {
    if (fs.meshGroup.userData.LW) LW = fs.meshGroup.userData.LW;
    else buildWorldBelow(fs.meshGroup, g);
  }
  const wb = fs.meshGroup.getObjectByName('worldBelow');
  if (wb) wb.visible = atPlanet;
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
      const len = 24 + Math.random() * 70;
      const gr = ctx.createLinearGradient(0, 0, 0, len); // streaks run ALONG the bore
      const hue = Math.random() < 0.7 ? '190,230,255' : '150,180,255';
      gr.addColorStop(0, `rgba(${hue},0)`);
      gr.addColorStop(0.5, `rgba(${hue},0.95)`);
      gr.addColorStop(1, `rgba(${hue},0)`);
      ctx.save();
      ctx.translate(Math.random() * 512, Math.random() * 128);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 1.6 + Math.random() * 1.6, len);
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 5, r * 5, 1500, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: t, toneMapped: false, fog: false, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
    m.position.set(cx0, 4, cz0 - 320);
    m.rotation.x = Math.PI / 2; // a LONG bore down the line of flight — the
    // streaks converge to a vanishing point ahead, Star Wars style
    m.userData.maxOp = op;
    t.repeat.set(1, 3);
    g.add(m);
    return m;
  };
  let tun = g.getObjectByName('hyperTunnel');
  let tun2 = g.getObjectByName('hyperTunnel2');
  if (!tun) { tun = mkTunnel(36, 1); tun.name = 'hyperTunnel'; }
  if (!tun2) { tun2 = mkTunnel(33, 0.65); tun2.name = 'hyperTunnel2'; }
  // the light at the end of the tunnel
  let core = g.getObjectByName('hyperCore');
  if (!core) {
    const cc = document.createElement('canvas');
    cc.width = 128; cc.height = 128;
    const cctx = cc.getContext('2d');
    const rg = cctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, 'rgba(235,248,255,1)');
    rg.addColorStop(0.35, 'rgba(170,215,255,0.75)');
    rg.addColorStop(1, 'rgba(140,190,255,0)');
    cctx.fillStyle = rg;
    cctx.fillRect(0, 0, 128, 128);
    const ct = new THREE.CanvasTexture(cc);
    core = new THREE.Mesh(new THREE.PlaneGeometry(340, 340),
      new THREE.MeshBasicMaterial({ map: ct, toneMapped: false, fog: false, transparent: true, opacity: 0, depthWrite: false }));
    core.name = 'hyperCore';
    core.position.set(cx0, 4, cz0 - 1020);
    g.add(core);
  }
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
    pl.position.set(cx0, 10, cz0 - 40);
    g.add(pl);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(15.8, 24, 18),
      new THREE.MeshBasicMaterial({ color: 0xbfe0a8, transparent: true, opacity: 0.18, toneMapped: false, fog: false, side: THREE.BackSide }));
    pl.add(glow);
  }
  pl.visible = false;
  pl.scale.setScalar(0.62);
  // atmosphere shell: fades in over the stars as we descend into the haze
  let haze = g.getObjectByName('arrivalHaze');
  if (!haze) {
    haze = new THREE.Mesh(new THREE.SphereGeometry(860, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xc2cba6, toneMapped: false, fog: false, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
    haze.name = 'arrivalHaze';
    haze.position.set(cx0, 4, cz0);
    g.add(haze);
  }
  const stars = g.getObjectByName('bridgeStars');
  // the city skyline band: rises into the windows at the end of the descent
  let skyline = g.getObjectByName('arrivalSkyline');
  if (!skyline) {
    const kc = document.createElement('canvas');
    kc.width = 1024; kc.height = 128;
    const kctx = kc.getContext('2d');
    kctx.clearRect(0, 0, 1024, 128);
    for (let i = 0; i < 90; i++) { // Dagobah-city silhouettes in the haze
      const bw = 10 + Math.random() * 26, bh = 14 + Math.random() * Math.random() * 90;
      kctx.fillStyle = ['#6f6f60', '#5d6048', '#7c745a', '#565c48'][i % 4];
      kctx.fillRect(Math.random() * 1024, 128 - bh, bw, bh);
      if (Math.random() < 0.4) {
        kctx.fillStyle = 'rgba(255,242,200,0.8)';
        kctx.fillRect(Math.random() * 1024, 128 - bh + 4 + Math.random() * (bh * 0.6), 3, 2);
      }
    }
    const kt = new THREE.CanvasTexture(kc);
    kt.wrapS = THREE.RepeatWrapping;
    kt.colorSpace = THREE.SRGBColorSpace;
    skyline = new THREE.Mesh(new THREE.CylinderGeometry(35.5, 35.5, 15, 24, 1, true),
      new THREE.MeshBasicMaterial({ map: kt, toneMapped: false, fog: false, side: THREE.BackSide, transparent: true, depthWrite: false }));
    skyline.name = 'arrivalSkyline';
    skyline.position.set(cx0, -26, cz0); // waiting below the windows
    g.add(skyline);
  }
  // no dogfight in hyperspace — the ambient war stays behind at the hulk
  const war = (G.floors.get(0)?.warShips) || [];
  for (const f of war) f.visible = false;
  A = { phase: 'spool', t: 0, tun, tun2, core, pl, haze, stars, war, skyline, plZ0: cz0 - 40, fast: !!fast };
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
    A.tun.rotateY(dt * 0.7);  // lazy barrel roll
    A.tun2.rotateY(-dt * 0.45);
    A.tun.material.map.offset.y -= dt * 4.6;  // the lines FLY past, Star Wars style
    A.tun2.material.map.offset.y -= dt * 3.0;
    A.core.visible = true;
    A.core.material.opacity = Math.min(1, A.tun.material.opacity) * (0.85 + Math.sin(A.t * 6) * 0.15);
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
    A.core.material.opacity = A.tun.material.opacity;
    if (A.tun.material.opacity <= 0) { A.tun.visible = false; A.tun2.visible = false; A.core.visible = false; }
    A.pl.scale.setScalar(Math.min(0.8, A.pl.scale.x + dt * 0.08));
    A.pl.position.z = A.plZ0;
    if (A.stars) A.stars.rotation.y += dt * 0.008; // still coasting — the sky drifts
    if (A.t > 2.2 * F) { // straight into the dive — no sitting in the void
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
    A.pl.scale.setScalar(0.8 + ease * 2.6);
    A.pl.position.z = A.plZ0 - ease * 80;
    if (A.stars) A.stars.rotation.y += dt * 0.008;
    if (A.stars) A.stars.material.opacity = Math.max(0, 1 - ease * 1.2);
    A.haze.material.opacity = Math.min(0.85, ease * 1.0);
    if (k > 0.55) A.pl.material.opacity = 1; // (kept: the haze covers the final swell)
    // the last leg: the CITY rises to meet you — you ride all the way down
    if (k > 0.3) {
      const kr = Math.min(1, (k - 0.3) / 0.5);
      A.skyline.position.y = -26 + kr * kr * 24.6; // settles at the horizon line
      A.skyline.rotation.y += dt * 0.05;           // drifting past below
    }
    if (k > 0.75 && !A.buffet) { A.buffet = true; sfx.rumble(); addMsg('Atmospheric interface — buffeting. The city is coming up.', 'gold'); }
    if (Math.random() < dt * (1 + k * 3)) G.shake = Math.max(G.shake || 0, 0.08 + k * 0.14);
    if (A.t > 10 * F + 1.2) {
      A.phase = 'done';
      A.pl.visible = false; // down in the sky of the world now
      if (A.stars) A.stars.material.opacity = 0;
      A.haze.material.opacity = 0.75;
      A.skyline.position.y = -1.4; // the city holds outside the glass — the
      // SAME world the docking bay hangs over, one deck below
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
  const ship = buildFighter(false, false, null, SHIP_SLOTS[mySlot()]);
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
    bombs: MAX_BOMBS, hull: 120 + 25 * shipUp('hull'), maxHull: 120 + 25 * shipUp('hull'),
    maxSpeed: 62 + 6 * shipUp('engine'),
    speed: Math.max(20, from.speed), vel: new THREE.Vector3(), bank: 0, lock: null,
    weapon: 1, homeLock: false, fireCd: 0, foes: [], bolts: [], kills: 0,
    bombsAway: [], flak: [], fx: [], phase: 'run', t: 0, landT: 0, dropCd: 0, sightFlash: 0,
    time0: G.time || 0, netT: 0, remote: new Map(),
  };
  // the city scrambles its defenders the moment you're out
  spawnDefender(); spawnDefender();
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  L.vel.copy(fwd).multiplyScalar(L.speed);
  document.getElementById('waveHud')?.classList.remove('hidden');
  const tr = document.getElementById('topright');
  if (tr) tr.style.display = 'none'; // the bombsight lives on the dash monitor
  addMsg('Fighter away — [1] GUNS · [2] BOMBS · T locks targets · R locks HOME. The monitor flashes RED to release.', 'gold');
  addMsg('Six bombs. Dry racks? R marks the hangar — fly back in and set down to rearm.', 'gold');
  refreshHud();
}

// the boarding machine (space.js) calls this the instant the bomber clears
// the mouth of a LANDFALL deck — same scene, same position, no seam
setLandfallHook((from) => startFlight(from));

function endFlight(result) {
  if (!L) return;
  const fs = L.fs;
  fs.meshGroup.remove(L.ship);
  for (const f of L.foes) fs.meshGroup.remove(f);
  for (const b of L.bolts) fs.meshGroup.remove(b);
  if (L.kills > 0) {
    const strafe = Math.round(L.kills * 4);
    G.run.gold += strafe;
    addMsg(`Strafing tally: +${strafe} credits.`, 'gold');
  }
  for (const r of L.remote.values()) fs.meshGroup.remove(r.grp);
  if (G.net.role !== 'solo') netSend({ t: 'lfleave' });
  // your bomber is back on its pad
  if (L.boardAt?.bsId && fs.boardShips) {
    const bsBack = fs.boardShips.find((b) => b.userData.boardShip.id === L.boardAt.bsId);
    if (bsBack) bsBack.visible = true;
  }
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
  L.homeLock = false;
  const ground = LW.targets.filter((t) => t.hp > 0);
  const air = L.foes.filter((f) => f.userData.hp > 0)
    .map((f) => (f.userData.lockRec ||= { type: 'FIGHTER', foe: f, get pos() { return this.foe.position; }, get hp() { return this.foe.userData.hp; } }));
  const alive = [...ground, ...air];
  if (!alive.length) { L.lock = null; hideLockWidgets(); return; }
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  alive.sort((a, b) =>
    a.pos.clone().sub(L.ship.position).normalize().angleTo(nose) -
    b.pos.clone().sub(L.ship.position).normalize().angleTo(nose));
  const i = alive.indexOf(L.lock);
  L.lock = alive[(i + 1) % alive.length];
  addMsg(`LOCK: ${L.lock.type === 'PYLON' ? 'SHIELD PYLON' : L.lock.type === 'AA' ? 'AA BATTERY' : 'DEFENSE FIGHTER'}`, 'gold');
  sfx.key();
}

export function landfallSetWeapon(i) {
  if (!L || i < 0 || i > 1 || L.weapon === i) return;
  L.weapon = i;
  addMsg(i === 0 ? 'Weapon: GUNS' : 'Weapon: BOMBS');
  sfx.key();
}

export function landfallHomeLock() {
  if (!L) return;
  L.homeLock = !L.homeLock;
  if (L.homeLock) { L.lock = null; addMsg('NAV LOCK: the hangar mouth.', 'gold'); }
  else hideLockWidgets();
  sfx.key();
}

function fireGuns() {
  if (L.fireCd > 0) return;
  L.fireCd = 0.15;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  const aim = L.ship.position.clone().addScaledVector(dir, 90); // wingtips CONVERGE
  for (const side of [-1, 1]) {
    const off = new THREE.Vector3(side * 2.6, 0, -1.2).applyQuaternion(L.ship.quaternion);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.6),
      new THREE.MeshBasicMaterial({ color: 0x4fe8e0, toneMapped: false }));
    b.position.copy(L.ship.position).add(off);
    const bd2 = aim.clone().sub(b.position).normalize();
    b.lookAt(b.position.clone().add(bd2));
    b.userData = { dir: bd2, vel: 240, life: 1.6, mine: true };
    L.fs.meshGroup.add(b);
    L.bolts.push(b);
  }
  sfx.bolt();
}

export function landfallTrigger() {
  if (!L || L.phase !== 'run') return;
  if (L.weapon === 0) { fireGuns(); return; }
  landfallDrop();
}

export function landfallDrop() {
  if (!L || L.phase !== 'run') return;
  if (L.bombs <= 0) { addMsg('BOMBS OUT — R marks the hangar. Fly home and set down to rearm.', 'bad'); return; }
  if (L.dropCd > 0) return;
  L.dropCd = 0.4;
  L.bombs--;
  // released ON the red flash with a ground lock? The bomb takes the lock:
  // it still falls like a bomb, but it CORRECTS onto the tower. Red = hit.
  let homing = null;
  if (L.lock && L.lock.hp > 0 && L.lock.type !== 'FIGHTER') {
    impactPoint(_ip);
    if (Math.hypot(_ip.x - L.lock.pos.x, _ip.z - L.lock.pos.z) <= RELEASE_R) homing = L.lock;
  }
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x39414c, metalness: 0.5, roughness: 0.6 }));
  b.position.copy(L.ship.position).add(new THREE.Vector3(0, -1.6, 0));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
  b.userData.v = L.vel.clone();
  b.userData.v.y = Math.min(0, b.userData.v.y);
  b.userData.home = homing;
  L.fs.meshGroup.add(b);
  L.bombsAway.push(b);
  sfx.bolt();
}

function spawnDefender() {
  if (!L || !LW) return;
  if (L.foes.filter((f) => f.userData.hp > 0).length >= 4) return;
  const f = buildFighter(true);
  f.scale.setScalar(1.8);
  const a = Math.random() * Math.PI * 2, r = 220 + Math.random() * 240;
  f.position.set(Math.cos(a) * r, CITY_Y + 3, Math.sin(a) * r);
  f.userData = {
    ...f.userData, hp: 3, state: 'takeoff', stateT: 0, fireT: 1.5,
    speed: 34 + Math.random() * 8,
  };
  L.fs.meshGroup.add(f);
  L.foes.push(f);
  addMsg('CONTACT — a defense fighter is lifting off the streets.', 'bad');
}

function hurtBomber(n, strike = false) {
  if (strike) { // collision damage has an immunity window — one hit per bump
    if ((L.strikeCd || 0) > 0) return;
    L.strikeCd = 0.9;
  }
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

// a bomb (or burst) chews the city: buildings scorch, rumble, and come down
function damageBuilding(bd, hits, at) {
  if (bd.falling) return;
  bd.hp -= hits;
  // black bite where it hit
  const sc = new THREE.Mesh(new THREE.BoxGeometry(3 + Math.random() * 3, 2.2, 3 + Math.random() * 3), LW.scorchMat);
  sc.position.set(
    bd.x + Math.max(-bd.w / 2, Math.min(bd.w / 2, at.x - bd.x)),
    CITY_Y + Math.min(bd.h - 1, Math.max(2, at.y - CITY_Y + 1)),
    bd.z + Math.max(-bd.d / 2, Math.min(bd.d / 2, at.z - bd.z)));
  sc.rotation.y = Math.random() * Math.PI;
  L.fs.meshGroup.add(sc);
  (bd.scorches ||= []).push(sc);
  if (bd.hp <= 0) {
    bd.falling = 0.001; // the rumble begins
    sfx.collapse();
    sfx.screams();
    addMsg('A tower is coming down — you can hear the streets.', 'bad');
  }
}
function bombCity(at) {
  if (!LW) return;
  for (const bd of LW.buildings) {
    if (bd.falling || bd.hp <= 0) continue;
    const dd = Math.hypot(at.x - bd.x, at.z - bd.z);
    if (dd < Math.max(bd.w, bd.d) / 2 + 9) damageBuilding(bd, dd < Math.max(bd.w, bd.d) / 2 + 3 ? 2 : 1, at);
  }
  for (const wk of LW.walkers) {
    if (wk.dead) continue;
    if (Math.hypot(at.x - wk.grp.position.x, at.z - wk.grp.position.z) < 12) killWalker(wk);
  }
  for (const cr of LW.cars) {
    if (cr.dead) continue;
    if (Math.hypot(at.x - cr.grp.position.x, at.z - cr.grp.position.z) < 12) killCar(cr);
  }
}
function killWalker(wk) {
  wk.dead = true;
  wk.grp.visible = false;
  L.kills++;
}
function killCar(cr) {
  cr.dead = true;
  cr.grp.visible = false;
  boom(cr.grp.position.clone().add(LW.world.position), false);
  L.kills += 2;
}

function impactPoint(out) {
  // the sight predicts with the bomb's REAL release state — actual velocity,
  // vertical included — so a red flash is a promise, not a guess
  const h = Math.max(0.1, L.ship.position.y - CITY_Y);
  const vy = Math.min(0, L.vel.y);
  const tf = (vy + Math.sqrt(vy * vy + 2 * GRAV * h)) / GRAV;
  out.set(L.ship.position.x + L.vel.x * tf, CITY_Y, L.ship.position.z + L.vel.z * tf);
  return out;
}

// ---------------- co-op sync ----------------
export function onLandfallNet(m, pid) {
  if (m.t === 'lfhit' && LW) {
    const t = LW.targets[m.i];
    if (t && t.hp > m.hp) {
      t.hp = m.hp;
      if (t.hp <= 0) {
        t.grp.visible = false;
        const left = LW.targets.filter((x) => x.hp > 0).length;
        addMsg(`Squadmate splash — ${left} targets left.`, 'gold');
        if (!left) {
          const lz = LW.world.getObjectByName('lzBeacon');
          if (lz) lz.material.opacity = 0.3;
        }
      }
    }
  } else if (m.t === 'lfp' && L) {
    let r = L.remote.get(pid);
    if (!r) {
      const grp = buildBomber(false, SHIP_SLOTS[slotOf(pid)]);
      grp.scale.setScalar(1);
      L.fs.meshGroup.add(grp);
      r = { grp, tp: new THREE.Vector3(), tq: new THREE.Quaternion() };
      L.remote.set(pid, r);
    }
    r.tp.fromArray(m.p);
    r.tq.fromArray(m.q);
  } else if (m.t === 'lfleave' && L) {
    const r = L.remote.get(pid);
    if (r) { L.fs.meshGroup.remove(r.grp); L.remote.delete(pid); }
  }
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
  window.__lfF = (window.__lfF || 0) + 1;
  window.__sphL = L.phase;
  L.t += dt;
  L.dropCd -= dt;
  L.fireCd -= dt;
  L.strikeCd = (L.strikeCd || 0) - dt;
  if (G.keys['Space'] && L.weapon === 0 && L.phase === 'run') fireGuns();
  if (G.keys['Escape'] && L.phase === 'run') { endFlight('RECOVERED'); return; }

  const D = deckInfo();

  if (L.phase === 'dock' || L.phase === 'land') {
    // hands off — but SMOOTH: the deck crew flies you down the curve your own
    // momentum started. No snap: position rides a bezier from the exact state
    // you crossed the threshold in, and the pivot to parked heading only
    // happens at the end, slow, over the pad — a taxi turn, not a yank.
    L.landT += dt;
    const T = L.landDur || 3.4;
    const sN = Math.min(1, L.landT / T);
    const e = sN * sN * (3 - 2 * sN);
    if (!L.landMid) {
      L.landMid = L.landFrom.clone().addScaledVector(L.landV0 || new THREE.Vector3(), 0.26 * T)
        .lerp(L.landAt, 0.3);
      L.landMid.y = Math.max(L.landAt.y + 1.8, (L.landFrom.y + L.landAt.y) / 2);
    }
    const _pa = L.landFrom.clone().lerp(L.landMid, e);
    const _pb = L.landMid.clone().lerp(L.landAt, e);
    L.ship.position.copy(_pa.lerp(_pb, e));
    const sT = Math.max(0, (sN - 0.5) / 0.5), eT = sT * sT * (3 - 2 * sT);
    L.ship.quaternion.copy(L.landQ0 || L.landQ).slerp(L.landQ, eT);
    const fwdL = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(L.ship.quaternion);
    G.camera.position.copy(L.ship.position).addScaledVector(upL, 0.9).addScaledVector(fwdL, 0.6);
    G.camera.quaternion.copy(L.ship.quaternion);
    const wh = document.getElementById('waveHud');
    if (wh) wh.textContent = L.phase === 'dock' ? 'DECK CREW HAS YOU — setting down' : 'FLARE… FLARE… touchdown';
    if (L.landT > T + 0.25) endFlight(L.phase === 'dock' ? 'DOCKED' : 'LZ SECURED');
    return;
  }

  // flight
  if (G.keys['KeyW']) L.speed = Math.min(L.maxSpeed, L.speed + 22 * dt);
  if (G.keys['KeyS']) L.speed = Math.max(14, L.speed - 26 * dt);
  const yawIn = (G.keys['ArrowLeft'] ? 1 : 0) - (G.keys['ArrowRight'] ? 1 : 0);
  const pitchIn = (G.keys['ArrowUp'] ? 1 : 0) - (G.keys['ArrowDown'] ? 1 : 0);
  const rollIn = (G.keys['KeyA'] ? 1 : 0) - (G.keys['KeyD'] ? 1 : 0);
  const qd = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchIn * 1.15 * dt, yawIn * 1.35 * dt, rollIn * 2.8 * dt, 'YXZ'));
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
    hurtBomber(20, true);
    if (!L) return;
    addMsg('TERRAIN — pull up!', 'bad');
  }
  // no ceiling — climb as high as you like
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
    // YOUR lane: each squad color flies its approach onto its OWN pad,
    // so four ships can come home to four different corners of the deck
    const laneX = Math.min(D.mouthX1 - 7, Math.max(D.mouthX0 + 7, L.boardAt?.x ?? xC));
    const inApproach = p.z > D.mouthZ + 2 && p.z < D.mouthZ + 130
      && Math.abs(p.x - xC) < halfW + 50 && p.y > -16 && p.y < 40 && L.vel.z < -2;
    if (inApproach) {
      L.approach = true;
      const want = new THREE.Vector3((laneX - p.x) * 0.9, (3.2 - p.y) * 0.7, -70).normalize();
      const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), want);
      L.ship.quaternion.rotateTowards(tq, 0.5 * dt); // a nudge, not a grab
      L.dockOk = L.speed <= 32 && Math.abs(p.x - laneX) < 12 && p.y > 0.5 && p.y < 7.2;
    }
    // the threshold: cross it clean — on YOUR lane — or get thrown back out
    const inMouthX = p.x > D.mouthX0 + 4 && p.x < D.mouthX1 - 4;
    if (p.z <= D.mouthZ + 2 && p.z > D.mouthZ - 10 && L.vel.z < 0 && inMouthX && p.y > 0.3 && p.y < 8.5) {
      if (L.speed <= 34 && Math.abs(p.x - laneX) < 13) {
        L.phase = 'dock';
        L.landT = 0;
        L.landDur = 3.4;
        L.landFrom = L.ship.position.clone();
        L.landV0 = L.vel.clone();
        L.landQ0 = L.ship.quaternion.clone();
        L.landMid = null;
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
      addMsg('WAVE OFF — under 30, on your lane, deck height. Go around.', 'bad');
      G.shake = Math.max(G.shake || 0, 0.3);
    }
    // the rest of the deck slice is solid
    const insideDeckBox = p.x > -4 && p.x < D.deckW + 4 && p.y > -3 && p.y < 15 && p.z > -4 && p.z < D.mouthZ + 1;
    const corridor = inMouthX && p.y > 0.3 && p.y < 8.5 && p.z > -6;
    if (insideDeckBox && !corridor) {
      L.vel.multiplyScalar(-0.4);
      L.ship.position.addScaledVector(L.vel, dt * 4);
      hurtBomber(10, true);
      if (!L) return;
      if (L.strikeCd > 0.85) addMsg('HULL STRIKE — the bay mouth is the only way in.', 'bad');
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
      hurtBomber(8, true);
      if (!L) return;
      if (L.strikeCd > 0.85) addMsg('HULL STRIKE — she is a lot of ship. Fly around her.', 'bad');
      break;
    }
  }

  // bombs fall, bombs land
  for (let i = L.bombsAway.length - 1; i >= 0; i--) {
    const b = L.bombsAway[i];
    b.userData.v.y -= GRAV * dt;
    const home = b.userData.home;
    if (home && home.hp > 0) {
      // guided: steer the horizontal fall so it arrives ON the lock
      const hLeft = Math.max(0.1, b.position.y - CITY_Y);
      const vy = b.userData.v.y;
      const tf = (vy + Math.sqrt(vy * vy + 2 * GRAV * hLeft)) / GRAV || 0.1;
      const wantX = (home.pos.x - b.position.x) / tf, wantZ = (home.pos.z - b.position.z) / tf;
      b.userData.v.x += (wantX - b.userData.v.x) * Math.min(1, dt * 5);
      b.userData.v.z += (wantZ - b.userData.v.z) * Math.min(1, dt * 5);
    }
    b.position.addScaledVector(b.userData.v, dt);
    if (b.position.y <= CITY_Y + 1) {
      boom(b.position.clone().setY(CITY_Y + 1), false);
      bombCity(b.position);
      if (LW) for (const t of LW.targets) {
        if (t.hp <= 0) continue;
        if (Math.hypot(b.position.x - t.pos.x, b.position.z - t.pos.z) < 16) {
          t.hp--;
          if (G.net.role !== 'solo') netSend({ t: 'lfhit', i: LW.targets.indexOf(t), hp: t.hp });
          if (t.hp <= 0) {
            boom(t.pos.clone().setY(CITY_Y + 4), true);
            t.grp.visible = false;
            const left = LW.targets.filter((x) => x.hp > 0).length;
            addMsg(`${t.type === 'PYLON' ? 'SHIELD PYLON' : 'AA BATTERY'} DESTROYED — ${left} targets left.`, 'gold');
            spawnDefender(); // the city answers
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

  // GUN BOLTS + DEFENSE FIGHTER FIRE
  for (let i = L.bolts.length - 1; i >= 0; i--) {
    const b = L.bolts[i];
    b.userData.life -= dt;
    b.position.addScaledVector(b.userData.dir, b.userData.vel * dt);
    let dead = b.userData.life <= 0 || b.position.y < CITY_Y + 0.5;
    if (!dead && b.userData.mine) {
      for (const f of L.foes) {
        if (f.userData.hp <= 0) continue;
        if (b.position.distanceTo(f.position) < 4.5) {
          f.userData.hp -= 1;
          if (f.userData.hp <= 0) {
            boom(f.position, false);
            f.visible = false;
            L.kills += 3;
            addMsg('Defense fighter down.', 'gold');
          }
          dead = true;
          break;
        }
      }
      if (!dead && LW && b.position.y < CITY_Y + 60) {
        const bl = b.position.clone().sub(LW.world.position);
        for (const cr of LW.cars) {
          if (cr.dead) continue;
          if (bl.distanceTo(cr.grp.position) < 5.5) { killCar(cr); dead = true; break; }
        }
        if (!dead) for (const wk of LW.walkers) {
          if (wk.dead) continue;
          if (bl.distanceTo(wk.grp.position) < 2.8) { killWalker(wk); dead = true; break; }
        }
      }
    } else if (!dead && !b.userData.mine) {
      if (b.position.distanceTo(L.ship.position) < 2.6) { hurtBomber(6); if (!L) return; dead = true; }
    }
    if (dead) { L.fs.meshGroup.remove(b); L.bolts.splice(i, 1); }
  }

  // DEFENSE FIGHTERS: scrambled off the streets, then they RUN you
  for (const f of L.foes) {
    const fu = f.userData;
    if (fu.hp <= 0) continue;
    fu.stateT += dt;
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quaternion);
    if (fu.state === 'takeoff') {
      f.position.y += 26 * dt;
      f.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1),
        L.ship.position.clone().sub(f.position).normalize()), dt * 0.8);
      if (f.position.y > CITY_Y + 120) { fu.state = 'lineup'; fu.stateT = 0; }
    } else if (fu.state === 'lineup') {
      const dir = L.ship.position.clone().sub(f.position).normalize();
      const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      f.quaternion.rotateTowards(tq, 0.8 * dt);
      f.position.addScaledVector(nose, fu.speed * 0.6 * dt);
      if (nose.angleTo(dir) < 0.15) { fu.state = 'run'; fu.stateT = 0; }
    } else if (fu.state === 'run') {
      const toP = L.ship.position.clone().sub(f.position);
      const d = toP.length();
      toP.normalize();
      const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), toP);
      f.quaternion.rotateTowards(tq, 0.2 * dt);
      f.position.addScaledVector(nose, fu.speed * dt);
      fu.fireT -= dt;
      if (fu.fireT <= 0 && d < 130 && nose.angleTo(toP) < 0.3) {
        fu.fireT = 0.7;
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.2),
          new THREE.MeshBasicMaterial({ color: 0xff5533, toneMapped: false }));
        b.position.copy(f.position).addScaledVector(nose, 4);
        b.lookAt(f.position.clone().add(nose));
        b.userData = { dir: nose.clone(), vel: 130, life: 2.2, mine: false };
        L.fs.meshGroup.add(b);
        L.bolts.push(b);
      }
      if (toP.dot(nose) < -0.2 || fu.stateT > 7) { fu.state = 'egress'; fu.stateT = 0; }
    } else {
      f.position.addScaledVector(nose, fu.speed * dt);
      if (f.position.y < CITY_Y + 40) f.position.y = CITY_Y + 40;
      if (fu.stateT > 2.5) { fu.state = 'lineup'; fu.stateT = 0; }
    }
  }

  // STREET LIFE drifts the grid — and dies where your runs rake it
  if (LW) {
    for (const wk of LW.walkers) {
      if (wk.dead) continue;
      wk.t += wk.dir * wk.sp * dt;
      if (Math.abs(wk.t) > 550) wk.dir *= -1;
      wk.grp.position.set(wk.horiz ? wk.t : wk.lane, 1.4, wk.horiz ? wk.lane : wk.t);
      wk.grp.rotation.y = wk.horiz ? (wk.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (wk.dir > 0 ? 0 : Math.PI);
      // skinned rigs are the frame budget's worst enemy — animate only the
      // ones close enough to read
      if (L.ship.position.distanceToSquared(wk.grp.position) < 90000) wk.anim?.update(dt);
    }
    for (const cr of LW.cars) {
      if (cr.dead) continue;
      cr.t += cr.dir * cr.sp * dt;
      if (Math.abs(cr.t) > 550) cr.dir *= -1;
      cr.grp.position.set(cr.horiz ? cr.t : cr.lane, 3.6 + Math.sin((G.time || 0) * 2 + cr.lane) * 0.3, cr.horiz ? cr.lane : cr.t);
      cr.grp.rotation.y = cr.horiz ? (cr.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (cr.dir > 0 ? 0 : Math.PI);
    }
    // collapses: the rumble, the lean, the fall, the dust
    for (const bd of LW.buildings) {
      if (!bd.falling) continue;
      bd.falling += dt;
      const k = bd.falling / 2.2;
      if (k < 0.35) {
        bd.mesh.position.x = bd.x + (Math.random() - 0.5) * 0.5; // the rumble
        bd.mesh.position.z = bd.z + (Math.random() - 0.5) * 0.5;
      } else if (k < 1) {
        bd.mesh.position.y = -((k - 0.35) / 0.65) * bd.h * 1.05; // it comes down
        bd.mesh.rotation.z = (k - 0.35) * 0.25;
        if (Math.random() < dt * 8) boom(new THREE.Vector3(bd.x, CITY_Y + 3, bd.z).add(new THREE.Vector3((Math.random() - 0.5) * bd.w, 0, (Math.random() - 0.5) * bd.d)), false);
      } else {
        LW.world.remove(bd.mesh);
        for (const sc of bd.scorches || []) L.fs.meshGroup.remove(sc);
        bd.falling = 0;
        bd.hp = -999;
      }
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
      L.landDur = 3.0;
      L.landFrom = L.ship.position.clone();
      L.landV0 = L.vel.clone();
      L.landQ0 = L.ship.quaternion.clone();
      L.landMid = null;
      L.landAt = new THREE.Vector3(LW.lzWorld.x, CITY_Y + 3, LW.lzWorld.z);
      const fwdY = new THREE.Vector3(0, 0, -1).applyQuaternion(L.ship.quaternion);
      L.landQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-fwdY.x, -fwdY.z) + Math.PI, 0));
      addMsg('LZ acquired — flaring for touchdown.', 'gold');
      return;
    }
  }

  // co-op: squadmates' bombers fly the same sky
  if (G.net.role !== 'solo') {
    L.netT -= dt;
    if (L.netT <= 0) {
      L.netT = 0.12;
      const p2 = L.ship.position, q2 = L.ship.quaternion;
      netSend({ t: 'lfp', p: [+p2.x.toFixed(1), +p2.y.toFixed(1), +p2.z.toFixed(1)], q: [+q2.x.toFixed(3), +q2.y.toFixed(3), +q2.z.toFixed(3), +q2.w.toFixed(3)] });
    }
    for (const r of L.remote.values()) {
      r.grp.position.lerp(r.tp, Math.min(1, dt * 8));
      r.grp.quaternion.slerp(r.tq, Math.min(1, dt * 8));
    }
  }

  // lock HUD (home first — R marks the hangar so it's never lost)
  if (L.homeLock && D) {
    const home = new THREE.Vector3((D.mouthX0 + D.mouthX1) / 2, 3, D.mouthZ + 4);
    drawLockAt(home, `HANGAR ${Math.round(L.ship.position.distanceTo(home))}m`, '#ffd166');
  } else if (L.lock && L.lock.hp > 0) {
    if (L.lock.type === 'FIGHTER') _wp.copy(L.lock.pos);
    else _wp.copy(L.lock.pos).setY(L.lock.type === 'PYLON' ? CITY_Y + 40 : CITY_Y + 8);
    drawLockAt(_wp, `${L.lock.type} ${Math.round(L.ship.position.distanceTo(L.lock.pos))}m`,
      L.lock.type === 'PYLON' ? '#bb99ff' : L.lock.type === 'FIGHTER' ? '#ff5533' : '#ff8855');
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
      const wpn = L.weapon === 0 ? 'GUNS' : `BOMBS ${L.bombs}`;
      wh.textContent = L.bombs <= 0 && L.weapon === 1
        ? 'BOMBS OUT — R MARKS THE HANGAR'
        : left ? `TARGETS ${left} · [${wpn}]` : 'LAND ON THE GREEN BEACON — low and slow';
    }
  }
  const hpfill = document.getElementById('hpfill'), hptext = document.getElementById('hptext');
  if (hpfill) hpfill.style.width = `${Math.max(0, (L.hull / L.maxHull) * 100)}%`;
  if (hptext) hptext.textContent = `FIGHTER ${Math.max(0, Math.round(L.hull))} / ${L.maxHull}`;

  drawBombsight(dt);
}

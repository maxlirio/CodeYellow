// Procedural dungeon. Every floor rolls a THEME (visual identity), a LAYOUT
// (rooms / warrens / cavern / great hall), an optional MUTATOR, plus varied
// platform shapes — all deterministic from the shared seed so co-op peers match.
// generateFloorData() is pure; buildFloorMeshes() renders it for the local player.
import * as THREE from 'three';
import { G } from './state.js';
import { makeRng, hashStr } from './rng.js';
import {
  CELL, BOSS_FLOORS, PLATFORM_H, enemyPool, eliteChance, ARCHERS,
  THEMES, MUTATORS, MUTATOR_CHANCE, MIDBOSS_TYPES,
} from './config.js';
import { buildMergedStatic, pieceColliders } from './assets.js';
import { buildShipStatic } from './shipmeshes.js';
import { generateShipDeck } from './ship.js';
import { ENEMIES } from './config.js';
const ENEMIES_TRIO = new Set(Object.keys(ENEMIES).filter(k => ENEMIES[k].trio));

export const SOLID = 0, FLOOR = 1, STAIRS = 3, TRAP = 4, OBSTACLE = 5, RAMP = 6;

// deterministic theme rotation: consecutive floors always differ
export function themeFor(seed, floor) {
  const base = hashStr(seed + ':themes');
  return THEMES[(base + floor * 3) % THEMES.length];
}

// ---------------- layout carvers ----------------
// each returns { cells, rooms } — rooms are used for spawns/props even in caverns
function carveRooms(rng, w, h, floor, { roomMin = 4, roomMax = 9, count = null, loops = 2 } = {}) {
  const cells = new Uint8Array(w * h);
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const inb = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  const targetRooms = count ?? Math.min(6 + floor, 11);
  const rooms = [];
  for (let tries = 0; tries < 200 && rooms.length < targetRooms; tries++) {
    const rw = rng.int(roomMin, roomMax), rh = rng.int(roomMin, roomMax);
    const rx = rng.int(1, w - rw - 2), ry = rng.int(1, h - rh - 2);
    let ok = true;
    for (const r of rooms) {
      if (rx < r.x + r.w + 1 && rx + rw + 1 > r.x && ry < r.y + r.h + 1 && ry + rh + 1 > r.y) { ok = false; break; }
    }
    if (!ok) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + Math.floor(rw / 2), cy: ry + Math.floor(rh / 2) });
  }
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, FLOOR);
  }
  const corridor = (a, b, wide = false) => {
    let { cx: x, cy: y } = a;
    const dig = (px, py) => {
      if (inb(px, py) && at(px, py) === SOLID) set(px, py, FLOOR);
      if (wide && inb(px + 1, py) && at(px + 1, py) === SOLID) set(px + 1, py, FLOOR);
    };
    const digTo = (tx, ty) => {
      while (x !== tx) { x += Math.sign(tx - x); dig(x, y); }
      while (y !== ty) { y += Math.sign(ty - y); dig(x, y); }
    };
    if (rng.chance(0.5)) { digTo(b.cx, y); digTo(b.cx, b.cy); } else { digTo(x, b.cy); digTo(b.cx, b.cy); }
  };
  for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i], roomMax >= 10);
  for (let i = 0; i < loops && rooms.length > 3; i++) corridor(rng.pick(rooms), rng.pick(rooms));
  return { cells, rooms };
}

function carveWarrens(rng, w, h, floor) {
  return carveRooms(rng, w, h, floor, { roomMin: 3, roomMax: 5, count: Math.min(12 + floor, 17), loops: 4 });
}

function carveHall(rng, w, h, floor) {
  const out = carveRooms(rng, w, h, floor, { roomMin: 9, roomMax: 14, count: 3, loops: 1 });
  out.halls = true;
  return out;
}

function carveCavern(rng, w, h) {
  const cells = new Uint8Array(w * h);
  const idx = (x, y) => y * w + x;
  // random fill then cellular smoothing
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    cells[idx(x, y)] = rng.chance(0.55) ? FLOOR : SOLID;
  }
  for (let it = 0; it < 5; it++) {
    const next = new Uint8Array(cells);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (cells[idx(x + dx, y + dy)] === FLOOR) open++;
      }
      next[idx(x, y)] = open >= 5 ? FLOOR : SOLID;
    }
    cells.set(next);
  }
  // keep only the largest connected region
  const region = new Int32Array(w * h).fill(-1);
  let bestRegion = -1, bestSize = 0, nRegions = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (cells[idx(x, y)] !== FLOOR || region[idx(x, y)] !== -1) continue;
    const stack = [[x, y]];
    let size = 0;
    region[idx(x, y)] = nRegions;
    while (stack.length) {
      const [px, py] = stack.pop();
      size++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx, ny = py + dy;
        if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
        if (cells[idx(nx, ny)] === FLOOR && region[idx(nx, ny)] === -1) {
          region[idx(nx, ny)] = nRegions;
          stack.push([nx, ny]);
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestRegion = nRegions; }
    nRegions++;
  }
  for (let i = 0; i < w * h; i++) if (cells[i] === FLOOR && region[i] !== bestRegion) cells[i] = SOLID;
  // synthesize pseudo-rooms: open 3x3 patches, spaced apart
  const rooms = [];
  for (let tries = 0; tries < 400 && rooms.length < 10; tries++) {
    const x = rng.int(2, w - 5), y = rng.int(2, h - 5);
    let open = true;
    for (let dy = 0; dy < 3 && open; dy++) for (let dx = 0; dx < 3; dx++) {
      if (cells[idx(x + dx, y + dy)] !== FLOOR) { open = false; break; }
    }
    if (!open) continue;
    if (rooms.some(r => Math.abs(r.cx - (x + 1)) + Math.abs(r.cy - (y + 1)) < 7)) continue;
    rooms.push({ x, y, w: 3, h: 3, cx: x + 1, cy: y + 1 });
  }
  if (rooms.length < 2) return null; // degenerate cave — caller falls back to rooms
  return { cells, rooms };
}

// ---------------- platform shapes ----------------
// returns [{cells:[{x,y}], ramps:[{x,y,dx,dy}]}] entries for a room, or null
function planPlatform(rng, room, at, inb) {
  const variant = rng.pick(['side', 'side', 'island', 'balcony']);
  if (variant === 'island' && room.w >= 7 && room.h >= 7) {
    const cx = room.cx, cy = room.cy;
    const cellsP = [{ x: cx, y: cy }, { x: cx + 1, y: cy }, { x: cx, y: cy + 1 }, { x: cx + 1, y: cy + 1 }];
    const ramps = [
      { x: cx - 1, y: cy, dx: 1, dy: 0 },
      { x: cx + 2, y: cy + 1, dx: -1, dy: 0 },
    ].filter(r => inb(r.x, r.y) && at(r.x, r.y) === FLOOR);
    if (!ramps.length) return null;
    if (cellsP.some(c => at(c.x, c.y) !== FLOOR)) return null;
    return { cells: cellsP, ramps };
  }
  // side strip (default) and balcony (two adjacent sides)
  const side = rng.pick(['N', 'S', 'W', 'E']);
  const strip = [];
  const addStrip = (s) => {
    if (s === 'N' || s === 'S') {
      const rows = s === 'N' ? [room.y, room.y + 1] : [room.y + room.h - 1, room.y + room.h - 2];
      for (let x = room.x; x < room.x + room.w; x++) for (const y of rows) strip.push({ x, y });
    } else {
      const cols = s === 'W' ? [room.x, room.x + 1] : [room.x + room.w - 1, room.x + room.w - 2];
      for (let y = room.y; y < room.y + room.h; y++) for (const x of cols) strip.push({ x, y });
    }
  };
  addStrip(side);
  if (variant === 'balcony' && room.w >= 7 && room.h >= 7) {
    addStrip(side === 'N' || side === 'S' ? (rng.chance(0.5) ? 'W' : 'E') : (rng.chance(0.5) ? 'N' : 'S'));
  }
  // dedupe
  const seen = new Set();
  const cellsP = strip.filter(c => { const k = c.x + ':' + c.y; if (seen.has(k)) return false; seen.add(k); return true; });
  let ramp = null;
  if (side === 'N' || side === 'S') {
    const rampX = rng.chance(0.5) ? room.x : room.x + room.w - 1;
    const rampY = side === 'N' ? room.y + 2 : room.y + room.h - 3;
    ramp = { x: rampX, y: rampY, dx: 0, dy: side === 'N' ? -1 : 1 };
  } else {
    const rampY = rng.chance(0.5) ? room.y : room.y + room.h - 1;
    const rampX = side === 'W' ? room.x + 2 : room.x + room.w - 3;
    ramp = { x: rampX, y: rampY, dx: side === 'W' ? -1 : 1, dy: 0 };
  }
  if (!inb(ramp.x, ramp.y) || at(ramp.x, ramp.y) !== FLOOR) return null;
  if (cellsP.some(c => c.x === ramp.x && c.y === ramp.y)) return null;
  return { cells: cellsP, ramps: [ramp] };
}

// ---------------- main generator ----------------
// ================= THE DRAGON'S LAIR (floor 9, 18, ...) =================
// Not a corridor floor: one colossal cavern holding a ruined underground
// castle — two walkable tiers, crenellated walls, corner towers the dragon
// perches on, and her hoard glittering at the heart of it.
export function generateDragonLair(seedStr, floor) {
  const rng = makeRng(`${seedStr}:lair:${floor}`);
  const w = 46, h = 46;
  const cells = new Uint8Array(w * h); // 0 = SOLID
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const colliders = [];
  const idxOf = (x, y) => y * w + x;
  // the cavern: open floor with a rough gnawed border
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) cells[idxOf(x, y)] = FLOOR;
  }
  for (let i = 0; i < 90; i++) {
    // bites out of the walls so the cave reads organic
    const side = rng.int(0, 3);
    const t = rng.int(4, w - 5);
    const d = rng.int(0, 2);
    for (let k = 0; k <= d; k++) {
      if (side === 0) cells[idxOf(t, 2 + k)] = 0;
      else if (side === 1) cells[idxOf(t, h - 3 - k)] = 0;
      else if (side === 2) cells[idxOf(2 + k, t)] = 0;
      else cells[idxOf(w - 3 - k, t)] = 0;
    }
  }

  const placements = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    const sv = Array.isArray(scale) ? S.set(scale[0], scale[1], scale[2]) : S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), sv.clone());
    placements.push({ piece, matrix: M.clone() });
  };
  const torches = [];

  // cavern floor scatter + wall shell
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 }, { dx: -1, dy: 0, yaw: Math.PI / 2 },
    { dx: 0, dy: 1, yaw: 0 }, { dx: 0, dy: -1, yaw: 0 },
  ];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cells[idxOf(x, y)] === 0) continue;
    const wx = x * CELL, wz = y * CELL;
    if (rng.chance(0.16)) place(rng.pick(['floor_tile_grate', 'floor_tile_small_weeds_A', 'floor_dirt_small_A']), wx, 0.01, wz, rng.int(0, 3) * Math.PI / 2);
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && cells[idxOf(nx, ny)] !== 0) continue;
      const ex = wx + d.dx * CELL / 2, ez = wz + d.dy * CELL / 2;
      place('wall', ex, 0, ez, d.yaw);
      place('wall', ex, 4, ez, d.yaw);
      place('wall', ex, 8, ez, d.yaw); // the cavern rises THREE walls tall
      if ((x + y * 5) % 7 === 0) {
        place('torch_mounted', ex - d.dx * 0.1, 2.3, ez - d.dy * 0.1, Math.atan2(-d.dx, -d.dy));
        torches.push({ x: ex - d.dx * 0.5, y: 3.15, z: ez - d.dy * 0.5 });
      }
    }
  }

  // ---- the ruined keep: tier 1 on the elevation grid ----
  const K0 = 17, K1 = 28; // tier-1 span in cells
  for (let y = 16; y <= 27; y++) for (let x = K0; x <= K1; x++) elev[idxOf(x, y)] = 1;
  // grand staircases: south (main), east and west (flanks)
  for (const sx of [21, 22, 23]) { cells[idxOf(sx, 28)] = RAMP; ramps.set(idxOf(sx, 28), { dx: 0, dy: -1 }); }
  for (const sy of [20, 21]) {
    cells[idxOf(K0 - 1, sy)] = RAMP; ramps.set(idxOf(K0 - 1, sy), { dx: 1, dy: 0 });
    cells[idxOf(K1 + 1, sy)] = RAMP; ramps.set(idxOf(K1 + 1, sy), { dx: -1, dy: 0 });
  }
  // tier-1 surface + crenellated parapet (gaps at the stairs)
  for (let y = 16; y <= 27; y++) for (let x = K0; x <= K1; x++) {
    place('floor_tile_large', x * CELL, PLATFORM_H, y * CELL);
    const edgeS = y === 27 && (x < 21 || x > 23);
    const edgeN = y === 16;
    const edgeW = x === K0 && (y < 20 || y > 21);
    const edgeE = x === K1 && (y < 20 || y > 21);
    if (edgeS) place('barrier', x * CELL, PLATFORM_H, y * CELL + CELL / 2, 0);
    if (edgeN) place('barrier', x * CELL, PLATFORM_H, y * CELL - CELL / 2, 0);
    if (edgeW) place('barrier', x * CELL - CELL / 2, PLATFORM_H, y * CELL, Math.PI / 2);
    if (edgeE) place('barrier', x * CELL + CELL / 2, PLATFORM_H, y * CELL, Math.PI / 2);
  }
  place('stairs', 22 * CELL, 0, 28 * CELL - CELL / 2, 0, [2.4, PLATFORM_H / 5.1, 1]);

  // ---- tier 2: the high court, standing on measured colliders ----
  const T2 = PLATFORM_H + 3.6;
  for (let y = 17; y <= 20; y++) for (let x = 20; x <= 25; x++) {
    place('floor_tile_large', x * CELL, T2, y * CELL);
    colliders.push({ x: x * CELL, z: y * CELL, hx: 2, hz: 2, y0: T2 - 0.35, h: T2 });
    place('pillar', x * CELL, PLATFORM_H, y * CELL, 0, [1, (T2 - PLATFORM_H) / 4, 1]); // supports
  }
  // steps up to the high court (south face): four rising slabs
  for (let s = 0; s < 4; s++) {
    const hgt = PLATFORM_H + (s + 1) * 0.9;
    const z = (21.6 - s * 0.35) * CELL;
    place('floor_tile_small', 22.5 * CELL, hgt - 0.15, z, 0, [1.4, 1, 0.9]);
    colliders.push({ x: 22.5 * CELL, z, hx: 2.6, hz: 0.75, y0: hgt - 0.5, h: hgt });
  }
  // ---- four watch towers; the north-east one is HER perch ----
  const towers = [[18, 17], [27, 17], [18, 26], [27, 26]];
  let perch = null;
  for (const [tx, ty] of towers) {
    const px = tx * CELL, pz = ty * CELL;
    place('pillar_decorated', px, PLATFORM_H, pz, 0, [1.8, 2.6, 1.8]);
    const top = PLATFORM_H + 10.4;
    colliders.push({ x: px, z: pz, hx: 1.6, hz: 1.6, y0: PLATFORM_H, h: top });
    if (tx === 27 && ty === 17) perch = { x: px, y: top, z: pz };
  }

  // ---- the hoard: she sleeps on a bed of stolen gold ----
  const lootSpawns = [];
  const hoard = { x: 22.5 * CELL, z: 18 * CELL };
  for (let i = 0; i < 14; i++) {
    const a = rng.next() * Math.PI * 2, r = 1 + rng.next() * 5;
    place(rng.pick(['coin_stack_large', 'coin_stack_medium', 'coin_stack_small']), hoard.x + Math.cos(a) * r, T2 + 0.02, hoard.z + Math.sin(a) * r, rng.next() * Math.PI * 2, 1.4);
  }
  lootSpawns.push({ kind: 'goldchest', x: hoard.x - 3, z: hoard.z, y: T2, yaw: Math.PI / 3 });
  lootSpawns.push({ kind: 'key', x: 8 * CELL, z: 8 * CELL, y: 0 });
  for (let i = 0; i < 6; i++) {
    lootSpawns.push({ kind: 'coinstack', x: rng.int(5, 40) * CELL, z: rng.int(30, 42) * CELL, y: 0 });
  }
  lootSpawns.push({ kind: 'chest', x: 38 * CELL, z: 38 * CELL, y: 0, yaw: rng.next() * Math.PI * 2 });

  // candles strewn among the gold + braziers on the parapets
  for (let i = 0; i < 8; i++) {
    place(rng.pick(['candle_lit', 'candle_triple']), hoard.x + (rng.next() - 0.5) * 8, T2 + 0.02, hoard.z + (rng.next() - 0.5) * 6, rng.next() * Math.PI * 2);
  }
  torches.push({ x: 20 * CELL, y: T2 + 1, z: 17 * CELL }, { x: 25 * CELL, y: T2 + 1, z: 17 * CELL });

  // ---- the cave asserts itself: rock heaps, glowing crystals, lava seams ----
  const lairDecor = [];
  const rockNames = ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_5', 'Rock_6', 'Rock_7'];
  // rubble mounds hugging the cavern walls
  for (let i = 0; i < 60; i++) {
    const side = rng.int(0, 3);
    let x, z;
    if (side === 0) { x = rng.int(3, w - 3) * CELL; z = (3 + rng.next() * 2.2) * CELL; }
    else if (side === 1) { x = rng.int(3, w - 3) * CELL; z = (h - 5.2 + rng.next() * 2.2) * CELL; }
    else if (side === 2) { x = (3 + rng.next() * 2.2) * CELL; z = rng.int(3, h - 3) * CELL; }
    else { x = (w - 5.2 + rng.next() * 2.2) * CELL; z = rng.int(3, h - 3) * CELL; }
    lairDecor.push({ kind: 'rock', name: rng.pick(rockNames), x, z, s: 2.5 + rng.next() * 4.5, yaw: rng.next() * Math.PI * 2 });
  }
  // stalagmites rising from the open floor (stretched rocks), clear of the keep
  for (let i = 0; i < 26; i++) {
    const x = rng.int(4, w - 4), z = rng.int(4, h - 4);
    if (x >= K0 - 3 && x <= K1 + 3 && z >= 13 && z <= 30) continue; // keep the court clear
    lairDecor.push({ kind: 'rock', name: rng.pick(rockNames), x: x * CELL, z: z * CELL, s: 1.2 + rng.next() * 1.6, sy: 3 + rng.next() * 4, yaw: rng.next() * Math.PI * 2 });
    colliders.push({ x: x * CELL, z: z * CELL, r: 1.1, h: 3 });
  }
  // crystal clusters, each a burning lamp in the dark
  for (let i = 0; i < 12; i++) {
    const x = rng.int(5, w - 5), z = rng.int(5, h - 5);
    if (x >= K0 - 2 && x <= K1 + 2 && z >= 14 && z <= 29) continue;
    lairDecor.push({ kind: 'crystal', name: rng.pick(['Crystal1', 'Crystal3', 'Crystal5']), x: x * CELL, z: z * CELL, s: 5 + rng.next() * 6, yaw: rng.next() * Math.PI * 2, color: rng.pick([0xff5522, 0xff8833, 0xffb347]), light: i < 6 });
  }
  // lava seams glowing at the cavern's edges
  for (const [lx, lz, ls] of [[8, 8, 5], [w - 8, 9, 4], [7, h - 9, 4.5], [w - 9, h - 8, 6], [w / 2 - 9, 6, 3.5]]) {
    lairDecor.push({ kind: 'lava', x: lx * CELL, z: lz * CELL, s: ls });
  }

  const enemySpawns = [{ type: 'dragon', x: hoard.x, z: hoard.z, y: T2 }];

  const grid = {
    w, h, cells, elev, ramps, colliders,
    rooms: [{ x: 3, y: 3, w: w - 6, h: h - 6, cx: 22, cy: 22 }],
    spawn: { x: 22 * CELL, z: 42 * CELL }, spawnYaw: 0,
    stairs: { x: -999, z: -999, cx: -99, cy: -99 },
    stairsLocked: false,
    portal: { dx: 0, dy: -1, yaw: 0 },
    dragonPerch: perch,
    lair: true, lairDecor,
  };
  return {
    grid, torches, traps: [], ropes: [], placements, enemySpawns, lootSpawns,
    explored: new Uint8Array(w * h), hadBoss: true,
    theme: { id: 'lair', name: "THE DRAGON'S VAULT", fog: 0x2b1a10, density: 0.0045, hemi: 0xe0bb96, amb: 0x96755c, torch: 0xffa055, tiles: [], props: [], banners: [], bias: [] },
    mutator: null, layoutId: 'lair',
  };
}

export function generateFloorData(seedStr, floor) {
  if (floor > 0 && floor % 9 === 0) return generateDragonLair(seedStr, floor);
  // sci-fi branch: every ordinary floor is a deck of the hulk
  if (floor > 0) return generateShipDeck(seedStr, floor);
  const rng = makeRng(`${seedStr}:floor:${floor}`);
  const size = Math.min(34 + floor * 2, 46);
  const w = size, h = size;

  const theme = themeFor(seedStr, floor);
  const isBossFloor = !!BOSS_FLOORS[floor] || (floor > 9 && floor % 3 === 0);
  const bossType = !isBossFloor ? null : floor >= 9 && floor % 9 === 0 ? 'dragon' : rng.pick(MIDBOSS_TYPES);
  const mutator = rng.chance(MUTATOR_CHANCE) && floor > 1 ? rng.pick(MUTATORS) : null;

  // layout
  let layoutId = floor === 1 ? 'rooms'
    : floor % 9 === 0 ? 'hall' // the dragon needs a lair with wingspan
    : isBossFloor && rng.chance(0.5) ? 'hall'
    : rng.pick(['rooms', 'rooms', 'warrens', 'cavern', 'hall']);
  let carved = null;
  if (layoutId === 'cavern') carved = carveCavern(rng, w, h);
  if (!carved && layoutId === 'warrens') carved = carveWarrens(rng, w, h, floor);
  if (!carved && layoutId === 'hall') carved = carveHall(rng, w, h, floor);
  if (!carved) { layoutId = layoutId === 'cavern' ? 'rooms' : layoutId; carved = carveRooms(rng, w, h, floor); }
  const { cells, rooms } = carved;
  const isCavern = layoutId === 'cavern';

  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const inb = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  const idxOf = (x, y) => y * w + x;

  const spawnRoom = rooms[0];
  let exitRoom = rooms[0], bestD = -1;
  for (const r of rooms) {
    const d = (r.cx - spawnRoom.cx) ** 2 + (r.cy - spawnRoom.cy) ** 2;
    if (d > bestD) { bestD = d; exitRoom = r; }
  }

  // ---- hall colonnades (precise pillar colliders, not whole cells) ----
  const colliders = [];
  const hallPillars = [];
  if (carved.halls) {
    for (const r of rooms) {
      if (r.w < 9 || r.h < 9) continue;
      for (let y = r.y + 2; y < r.y + r.h - 2; y += 3) {
        for (let x = r.x + 2; x < r.x + r.w - 2; x += 3) {
          if (at(x, y) === FLOOR && rng.chance(0.8)) {
            const piece = rng.chance(0.4) ? 'pillar_decorated' : 'pillar';
            hallPillars.push({ x, y, piece });
            colliders.push(...pieceColliders(piece, { x: x * CELL, z: y * CELL }));
          }
        }
      }
    }
  }

  // ---- climbable platforms (rooms/hall layouts; caverns & warrens stay flat) ----
  const platforms = [];
  const eligible = rooms.filter(r => r !== spawnRoom && r !== exitRoom && r.w >= 6 && r.h >= 6);
  for (const r of rooms) {
    if (!eligible.includes(r)) continue;
    const mustPlace = platforms.length === 0 && r === eligible[eligible.length - 1];
    if (!mustPlace && !rng.chance(0.65)) continue;
    const plan = planPlatform(rng, r, at, inb);
    if (!plan) continue;
    if (plan.cells.some(c => at(c.x, c.y) !== FLOOR)) continue;
    for (const c of plan.cells) elev[idxOf(c.x, c.y)] = 1;
    for (const rp of plan.ramps) {
      set(rp.x, rp.y, RAMP);
      ramps.set(idxOf(rp.x, rp.y), { dx: rp.dx, dy: rp.dy });
    }
    platforms.push({ cells: plan.cells, ramps: plan.ramps, room: r });
  }

  // ---- swinging ropes in tall rooms ----
  const ropes = [];
  for (const r of rooms) {
    if (r.w < 7 || r.h < 7 || !rng.chance(0.45)) continue;
    const rx = r.cx + rng.int(-1, 1), ry = r.cy + rng.int(-1, 1);
    if (at(rx, ry) !== FLOOR || elev[idxOf(rx, ry)]) continue;
    ropes.push({ x: rx * CELL + rng.next() * 1.5 - 0.75, z: ry * CELL + rng.next() * 1.5 - 0.75, ay: 7.4, len: 5.0 });
  }

  // ---- traps ----
  const traps = [];
  const isCorridorCell = (x, y) => {
    if (at(x, y) !== FLOOR) return false;
    for (const r of rooms) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return false;
    return true;
  };
  const trapCount = Math.min(2 + floor, 8) * (layoutId === 'warrens' ? 2 : 1);
  for (let tries = 0, placed = 0; tries < 260 && placed < trapCount; tries++) {
    const x = rng.int(2, w - 3), y = rng.int(2, h - 3);
    if (isCorridorCell(x, y)) { set(x, y, TRAP); traps.push({ x: x * CELL, z: y * CELL, cx: x, cy: y, cd: 0 }); placed++; }
  }

  // ---- portal exit ----
  const edgeCandidates = [];
  const scanPortal = (x, y) => {
    if (at(x, y) !== FLOOR && at(x, y) !== TRAP) return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || at(nx, ny) === SOLID) {
        edgeCandidates.push({ x, y, dx, dy, d: (x - exitRoom.cx) ** 2 + (y - exitRoom.cy) ** 2 });
      }
    }
  };
  for (let y = Math.max(1, exitRoom.y - 2); y < Math.min(h - 1, exitRoom.y + exitRoom.h + 2); y++) {
    for (let x = Math.max(1, exitRoom.x - 2); x < Math.min(w - 1, exitRoom.x + exitRoom.w + 2); x++) {
      if (!elev[idxOf(x, y)] && at(x, y) !== RAMP) scanPortal(x, y);
    }
  }
  edgeCandidates.sort((a, b) => a.d - b.d);
  const portal = edgeCandidates.length ? edgeCandidates[Math.min(rng.int(0, 3), edgeCandidates.length - 1)] : { x: exitRoom.cx, y: exitRoom.cy, dx: 0, dy: -1 };
  set(portal.x, portal.y, STAIRS);

  // ================= mesh placements =================
  const placements = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    const sv = Array.isArray(scale) ? S.set(scale[0], scale[1], scale[2]) : S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), sv.clone());
    placements.push({ piece, matrix: M.clone() });
  };

  const smallTiles = theme.tiles.filter(t => t.includes('small'));
  const torches = [];
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 },
    { dx: -1, dy: 0, yaw: Math.PI / 2 },
    { dx: 0, dy: 1, yaw: 0 },
    { dx: 0, dy: -1, yaw: 0 },
  ];
  const torchEvery = Math.max(3, Math.round(5 / (mutator?.torchMult ?? 1)));

  const placeFloorTile = (wx, wz) => {
    const fv = theme.tiles[Math.floor(rng.next() * theme.tiles.length)];
    if (fv.includes('small') && smallTiles.length) {
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        place(smallTiles[Math.floor(rng.next() * smallTiles.length)], wx + ox, 0, wz + oz, rng.int(0, 3) * Math.PI / 2);
      }
    } else {
      place(fv.includes('small') ? 'floor_tile_large' : fv, wx, 0, wz, rng.int(0, 3) * Math.PI / 2);
    }
  };

  let torchStep = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c === SOLID) continue;
    const wx = x * CELL, wz = y * CELL;
    if (c === TRAP) {
      // pressure plate: flat grate; the spikes are a dynamic pop-up (traps.js)
      place('floor_tile_large', wx, 0, wz);
      place('floor_tile_grate', wx, 0.03, wz, 0, 1.6);
    } else if (c === RAMP) {
      place('floor_tile_large', wx, 0, wz);
    } else {
      placeFloorTile(wx, wz);
    }
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      const neighbor = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
      if (neighbor !== SOLID) continue;
      const ex = wx + d.dx * CELL / 2, ez = wz + d.dy * CELL / 2;
      const isPortalHere = (c === STAIRS && d.dx === portal.dx && d.dy === portal.dy);
      if (isPortalHere) {
        place('wall_doorway', ex, 0, ez, d.yaw);
        place('wall', ex, PLATFORM_H, ez, d.yaw);
        continue;
      }
      const crackiness = theme.id === 'forge' || isCavern ? 0.6 : 0.8;
      const roll = rng.next();
      const piece = roll < crackiness ? 'wall' : roll < crackiness + 0.13 ? 'wall_cracked' : 'wall_broken';
      place(piece, ex, 0, ez, d.yaw);
      place(rng.next() < 0.85 ? 'wall' : 'wall_cracked', ex, PLATFORM_H, ez, d.yaw);
      torchStep++;
      if (torchStep % torchEvery === 0 && c !== STAIRS) {
        const inx = -d.dx, inz = -d.dy;
        const tyaw = Math.atan2(inx, inz);
        const ty = elev[idxOf(x, y)] ? PLATFORM_H + 2.3 : 2.3;
        place('torch_mounted', ex + inx * 0.1, ty, ez + inz * 0.1, tyaw);
        torches.push({ x: ex + inx * 0.5, y: ty + 0.85, z: ez + inz * 0.5 });
      }
    }
  }

  // hall colonnade pillar visuals
  for (const hp of hallPillars) {
    place(hp.piece, hp.x * CELL, 0, hp.y * CELL);
  }

  // ---- platform decks, rails, stairs, supports ----
  for (const p of platforms) {
    const isPlat = (x, y) => x >= 0 && y >= 0 && x < w && y < h && elev[idxOf(x, y)] === 1;
    const isRampCell = (x, y) => p.ramps.some(r => r.x === x && r.y === y);
    p.cells.forEach((c, ci) => {
      place('floor_tile_large', c.x * CELL, PLATFORM_H, c.y * CELL, rng.int(0, 3) * Math.PI / 2);
      for (const d of wallDirs) {
        const nx = c.x + d.dx, ny = c.y + d.dy;
        const nc = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
        if (nc === SOLID || isPlat(nx, ny) || isRampCell(nx, ny)) continue;
        place('barrier', c.x * CELL + d.dx * CELL / 2, PLATFORM_H, c.y * CELL + d.dy * CELL / 2, d.yaw);
      }
      if (ci % 2 === 0) {
        const exposed = wallDirs.some(d => { const nx = c.x + d.dx, ny = c.y + d.dy; return !isPlat(nx, ny) && (nx < 0 || ny < 0 || nx >= w || ny >= h ? false : at(nx, ny) !== SOLID); });
        if (exposed && at(c.x, c.y) === FLOOR) {
          place('pillar', c.x * CELL, 0, c.y * CELL);
          colliders.push(...pieceColliders('pillar', { x: c.x * CELL, z: c.y * CELL }));
        }
      }
    });
    for (const r of p.ramps) {
      const topX = r.x * CELL + r.dx * CELL / 2, topZ = r.y * CELL + r.dy * CELL / 2;
      place('stairs', topX, 0, topZ, Math.atan2(-r.dx, -r.dy), [0.8, PLATFORM_H / 5.1, 1]);
    }
  }

  // ---- props (colliders measured from each model — tops are standable) ----
  const props = [];
  const propAt = (x, y) => props.find(p => p.cx === x && p.cy === y);
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    const isExit = r === exitRoom;
    const nProps = rng.int(1, isCavern ? 2 : 3);
    for (let i = 0; i < nProps; i++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      const onEdge = isCavern || x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      if (!onEdge || at(x, y) !== FLOOR || propAt(x, y) || elev[idxOf(x, y)]) continue;
      if (isExit && Math.abs(x - portal.x) + Math.abs(y - portal.y) < 2) continue;
      const kind = rng.pick(theme.props);
      const yaw = rng.int(0, 3) * Math.PI / 2;
      place(kind, x * CELL, 0, y * CELL, yaw);
      if (kind === 'table_medium' && rng.chance(0.8)) place(rng.pick(['candle_lit', 'candle_triple', 'bottle_A_brown', 'bottle_B_brown']), x * CELL, 1.05, y * CELL, rng.next() * Math.PI * 2);
      colliders.push(...pieceColliders(kind, { x: x * CELL, z: y * CELL, yaw }));
      props.push({ cx: x, cy: y });
    }
    if (!isCavern && !carved.halls && r.w >= 6 && r.h >= 6) {
      for (const [px, py] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) {
        if (rng.chance(0.55) && at(px, py) === FLOOR && !propAt(px, py) && !elev[idxOf(px, py)]) {
          const pp = rng.chance(0.3) ? 'pillar_decorated' : 'pillar';
          place(pp, px * CELL, 0, py * CELL);
          colliders.push(...pieceColliders(pp, { x: px * CELL, z: py * CELL }));
          props.push({ cx: px, cy: py });
        }
      }
    }
    if (theme.banners.length && rng.chance(0.5)) {
      const bx = rng.int(r.x, r.x + r.w - 1);
      if (inb(bx, r.y - 1) === false || at(bx, r.y - 1) === SOLID) {
        if (at(bx, r.y) !== OBSTACLE) place(rng.pick(theme.banners), bx * CELL, 3.4, r.y * CELL - CELL / 2 + 0.15, 0);
      }
    }
  }

  // ---- enemy spawns (deterministic order & ids) ----
  const enemySpawns = [];
  let pool = mutator?.poolOverride ? mutator.poolOverride.slice() : enemyPool(floor).concat(theme.bias);
  const eChance = eliteChance(floor);
  const countMult = mutator?.countMult ?? 1;
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    let base;
    if (r === exitRoom && isBossFloor) base = 1;
    else if (carved.halls) base = rng.int(5, 8);              // few rooms, but vast
    else if (layoutId === 'warrens') base = rng.int(1, 2);    // many cramped rooms
    else base = rng.int(2, Math.min(4, 2 + Math.floor(floor / 2)));
    const n = Math.round(base * countMult);
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 6; tries++) {
        const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
        if (at(x, y) !== FLOOR || elev[idxOf(x, y)]) continue;
        enemySpawns.push({ type: rng.pick(pool), x: x * CELL + rng.next() * 2 - 1, z: y * CELL + rng.next() * 2 - 1, y: 0, elite: rng.chance(eChance) });
        break;
      }
    }
  }
  // caverns: packs wandering the open cave beyond the pseudo-rooms
  if (isCavern) {
    const nW = Math.round((8 + floor * 2) * countMult);
    for (let i = 0; i < nW; i++) {
      for (let tries = 0; tries < 10; tries++) {
        const x = rng.int(2, w - 3), y = rng.int(2, h - 3);
        if (at(x, y) !== FLOOR || elev[idxOf(x, y)]) continue;
        if (Math.abs(x - spawnRoom.cx) + Math.abs(y - spawnRoom.cy) < 6) continue;
        enemySpawns.push({ type: rng.pick(pool), x: x * CELL + rng.next() * 2 - 1, z: y * CELL + rng.next() * 2 - 1, y: 0, elite: rng.chance(eChance) });
        break;
      }
    }
  }
  for (const p of platforms) {
    const nA = rng.int(1, 2);
    for (let i = 0; i < nA; i++) {
      const c = rng.pick(p.cells);
      enemySpawns.push({ type: rng.pick(ARCHERS), x: c.x * CELL, z: c.y * CELL, y: PLATFORM_H, elite: rng.chance(eChance + 0.06) });
    }
  }
  if (isBossFloor) {
    enemySpawns.push({ type: bossType, x: exitRoom.cx * CELL, z: exitRoom.cy * CELL, y: 0 });
  }
  // goblins hunt in packs of three
  const packSpawns = [];
  for (const s of enemySpawns) {
    if (ENEMIES_TRIO.has(s.type)) {
      for (let i = 0; i < 2; i++) packSpawns.push({ ...s, x: s.x + rng.next() * 3 - 1.5, z: s.z + rng.next() * 3 - 1.5, elite: false });
    }
  }
  enemySpawns.push(...packSpawns);

  // ---- loot spawns ----
  const lootSpawns = [];
  const freeRoomCell = (r, wantPlat = false) => {
    for (let tries = 0; tries < 24; tries++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      const plat = elev[idxOf(x, y)] === 1;
      if (wantPlat && plat) return { x, y, py: PLATFORM_H };
      if (!wantPlat && at(x, y) === FLOOR && !plat) return { x, y, py: 0 };
    }
    return null;
  };
  const chestRooms = rooms.filter(r => r !== spawnRoom);
  const nChests = Math.min(2 + Math.floor(floor / 2), 5) + (mutator?.extraChests ?? 0);
  for (let i = 0; i < nChests && chestRooms.length; i++) {
    const r = rng.pick(chestRooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: 'chest', x: c.x * CELL, z: c.y * CELL, y: c.py, yaw: rng.next() * Math.PI * 2 });
  }
  for (const p of platforms) {
    const c = freeRoomCell(p.room, true);
    if (c) lootSpawns.push({ kind: 'chest', x: c.x * CELL + 1, z: c.y * CELL, y: PLATFORM_H, yaw: rng.next() * Math.PI * 2 });
    const c2 = rng.pick(p.cells);
    lootSpawns.push({ kind: 'coinstack', x: c2.x * CELL - 1, z: c2.y * CELL + 1, y: PLATFORM_H });
  }
  const gr = rng.pick(chestRooms.length ? chestRooms : rooms);
  const gc = freeRoomCell(gr);
  if (gc) {
    lootSpawns.push({ kind: 'goldchest', x: gc.x * CELL, z: gc.y * CELL, y: gc.py, yaw: rng.next() * Math.PI * 2 });
    const kr = rng.pick(chestRooms.length ? chestRooms : rooms);
    const kc = freeRoomCell(kr);
    if (kc) lootSpawns.push({ kind: 'key', x: kc.x * CELL + 1, z: kc.y * CELL + 1, y: kc.py });
  }
  const nCoins = rng.int(7, 12) + (mutator?.extraCoins ?? 0);
  for (let i = 0; i < nCoins; i++) {
    const r = rng.pick(rooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: rng.chance(0.3) ? 'coinstack' : 'coin', x: c.x * CELL + rng.next() * 2 - 1, z: c.y * CELL + rng.next() * 2 - 1, y: c.py });
  }
  for (let i = 0; i < rng.int(1, 3); i++) {
    const r = rng.pick(rooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: 'potion', x: c.x * CELL + rng.next() * 2 - 1, z: c.y * CELL + rng.next() * 2 - 1, y: c.py });
  }

  const grid = {
    w, h, cells, elev, ramps, rooms, colliders,
    spawn: { x: spawnRoom.cx * CELL, z: spawnRoom.cy * CELL },
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: isBossFloor,
    portal: { dx: portal.dx, dy: portal.dy, yaw: wallDirs.find(d => d.dx === portal.dx && d.dy === portal.dy).yaw },
  };
  return {
    grid, torches, traps, ropes, placements, enemySpawns, lootSpawns,
    explored: new Uint8Array(w * h), hadBoss: isBossFloor,
    theme, mutator, layoutId,
  };
}

// Build (or rebuild) the visual geometry for a floor the local player visits.
export function buildFloorMeshes(fs) {
  if (fs.built) return;
  // ship decks are procedural geometry, not tile placements
  const group = fs.grid.ship ? buildShipStatic(fs) : buildMergedStatic(fs.placements);
  // the dragon's vault dresses itself in cave, not corridor
  if (fs.grid.lairDecor) {
    let lights = 0;
    const stone = fs.grid.lairDecor;
    for (const d of stone) {
      if (d.kind === 'rock') {
        const g2 = G.assets.lair[d.name];
        if (!g2) continue;
        const m = g2.scene.clone(true);
        m.scale.set(d.s, d.sy || d.s, d.s);
        m.position.set(d.x, d.y || 0, d.z);
        m.rotation.y = d.yaw || 0;
        group.add(m);
      } else if (d.kind === 'crystal') {
        const g2 = G.assets.weapon[d.name];
        if (!g2) continue;
        const m = g2.scene.clone(true);
        m.traverse((n) => {
          if (!n.isMesh) return;
          n.material = n.material.clone();
          n.material.emissive = new THREE.Color(d.color || 0xff5522);
          n.material.emissiveIntensity = 1.3;
        });
        m.scale.setScalar(d.s);
        m.position.set(d.x, d.y || 0, d.z);
        m.rotation.set((Math.sin(d.x) * 0.4), d.yaw || 0, (Math.cos(d.z) * 0.4));
        group.add(m);
        if (lights < 6 && d.light) {
          const pl = new THREE.PointLight(d.color || 0xff5522, 1.6, 20);
          pl.position.set(d.x, (d.y || 0) + 2, d.z);
          group.add(pl);
          lights++;
        }
      } else if (d.kind === 'lava') {
        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(d.s, 18),
          new THREE.MeshStandardMaterial({ color: 0x431104, emissive: 0xff4400, emissiveIntensity: 1.5, roughness: 1 })
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(d.x, 0.04, d.z);
        group.add(pool);
        if (lights < 8) {
          const pl = new THREE.PointLight(0xff5511, 1.3, d.s * 5);
          pl.position.set(d.x, 1.2, d.z);
          group.add(pl);
          lights++;
        }
      }
    }
  }
  if (fs.grid.town || fs.grid.lawn) {
    // grass under the whole village / arena field
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(fs.grid.w * CELL + 8, fs.grid.h * CELL + 8),
      new THREE.MeshStandardMaterial({ color: 0x55803e, roughness: 1 })
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set((fs.grid.w * CELL) / 2 - 2, -0.03, (fs.grid.h * CELL) / 2 - 2);
    group.add(lawn);
  }
  const { stairs, portal } = fs.grid;
  const portalCol = fs.theme?.portal ?? 0xff7718;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.4),
    new THREE.MeshBasicMaterial({ color: portalCol, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  glow.position.set(stairs.x + portal.dx * CELL / 2, 1.8, stairs.z + portal.dy * CELL / 2);
  glow.rotation.y = portal.yaw;
  group.add(glow);
  const plight = new THREE.PointLight(portalCol, 18, 14, 1.6);
  plight.position.set(stairs.x + portal.dx * (CELL / 2 - 0.6), 2.2, stairs.z + portal.dy * (CELL / 2 - 0.6));
  group.add(plight);
  group.visible = false;
  G.scene.add(group);
  fs.meshGroup = group;
  fs.built = true;
}

export function disposeAllFloors() {
  for (const fs of G.floors.values()) {
    for (const grp of [fs.meshGroup, fs.enemyGroup, fs.lootGroup]) {
      if (!grp) continue;
      grp.traverse((n) => { if (n.isMesh && !n.isSkinnedMesh && fs.meshGroup === grp) n.geometry.dispose(); });
      G.scene.remove(grp);
    }
  }
  G.floors.clear();
}

// ---- elevation ----
export function groundHeightAt(x, z, curY = 0, grid = null) {
  const g = grid || G.grid;
  if (!g) return 0;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return 0;
  const idx = cy * g.w + cx;
  let ground = 0;
  const ramp = g.ramps.get(idx);
  if (ramp) {
    const s = Math.min(1, Math.max(0, (ramp.dx * (x - cx * CELL) + ramp.dy * (z - cy * CELL)) / CELL + 0.5));
    ground = s * PLATFORM_H;
  } else if (g.elev[idx]) {
    ground = curY > PLATFORM_H * 0.6 ? PLATFORM_H : 0;
  }
  // player-built structures (multi-storey: only surfaces within a step of you count)
  const b = g.builds;
  if (b) {
    const br = b.ramps.get(idx);
    if (br) {
      const s = Math.min(1, Math.max(0, (br.dx * (x - cx * CELL) + br.dy * (z - cy * CELL)) / CELL + 0.5));
      const h = br.base + s * PLATFORM_H;
      if (h <= curY + 1.7) ground = Math.max(ground, h);
    }
    const fls = b.floors.get(idx);
    if (fls) {
      for (const h of fls) if (h <= curY + 1.6) ground = Math.max(ground, h);
    }
  }
  // solid props & buildings: their measured tops are standable — jump onto a
  // barrel, a market roof, even a house if you find a path up. The curY gate
  // means a top only counts once you're already about level with it (landing),
  // so you never get popped up while walking past at ground level.
  if (g.colliders) {
    for (const c of g.colliders) {
      const top = c.h;
      if (top === undefined || top > curY + 0.5 || top <= ground) continue;
      if (c.hx !== undefined) {
        if (Math.abs(x - c.x) < c.hx + 0.3 && Math.abs(z - c.z) < c.hz + 0.3) ground = top;
      } else if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + 0.3) ** 2) ground = top;
    }
  }
  return ground;
}

// ---- movement & collision ----
const cellBlocked = (g, x, z, y, ghost, ref, onPlat) => {
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return true;
  const c = g.cells[cy * g.w + cx];
  if (c === SOLID) return true;
  if (c === OBSTACLE && !ghost && y < 2.4) return true;
  const h = groundHeightAt(x, z, y, g);
  if (h > ref + 1.3) return true;
  // platform rails: while on a railed dungeon platform, the only way down is the staircase
  if (!ghost && onPlat && c !== RAMP && h < y - 2) return true;
  return false;
};

export function moveWithCollision(pos, dx, dz, radius = 0.55, opts = {}) {
  const g = opts.grid || G.grid;
  if (!g) return;
  const y = opts.y ?? pos.y ?? 0;
  const ghost = !!opts.ghost;
  const ref = Math.max(y, groundHeightAt(pos.x, pos.z, y, g));
  // bounds-guard the cell BEFORE indexing: at the west edge cx rounds to -1 and
  // the flat index silently wraps into the previous row's last column
  const ccx = Math.round(pos.x / CELL), ccy = Math.round(pos.z / CELL);
  const inGrid = ccx >= 0 && ccy >= 0 && ccx < g.w && ccy < g.h;
  const onPlatform = y > 2.4 && inGrid && g.elev[ccy * g.w + ccx] === 1;
  // how many of the body's probe points are inside geometry at (nx, nz)?
  const overlap = (nx, nz) => {
    let n = 0;
    const checks = [
      [nx + radius, nz], [nx - radius, nz], [nx, nz + radius], [nx, nz - radius],
      [nx + radius * 0.7, nz + radius * 0.7], [nx - radius * 0.7, nz + radius * 0.7],
      [nx + radius * 0.7, nz - radius * 0.7], [nx - radius * 0.7, nz - radius * 0.7],
    ];
    for (const [cx, cz] of checks) if (cellBlocked(g, cx, cz, y, ghost, ref, onPlatform)) n++;
    // measured colliders for props/trees/buildings, each with a real vertical
    // extent [y0, h]: solid only at heights the model actually occupies, so you
    // can walk on top of anything (y >= h) and under overhangs (body clears y0).
    if (g.colliders && !ghost) {
      const pr = radius * 0.55; // hug props tighter than walls
      for (const c of g.colliders) {
        const top = c.h ?? (c.hx !== undefined ? 99 : 3);
        if (y >= top - 0.05 || y + 2.0 <= (c.y0 ?? 0)) continue;
        if (c.hx !== undefined) {
          if (Math.abs(nx - c.x) < c.hx + pr && Math.abs(nz - c.z) < c.hz + pr) n++;
        } else {
          const ddx = nx - c.x, ddz = nz - c.z;
          const rr = pr + c.r;
          if (ddx * ddx + ddz * ddz < rr * rr) n++;
        }
      }
    }
    return n;
  };
  // Already embedded (a wall raised on you, a bad landing, a desync)? Then a step
  // only has to not make it WORSE. Demanding a fully clear endpoint meant every
  // small step was rejected — your far side was still inside the wall — so you
  // were pinned, unable to walk out in ANY direction.
  //
  // It has to be "no worse" rather than "strictly better": a 0.1 step never
  // clears a probe point, so the count doesn't drop until you've travelled ~0.4,
  // and a strict test rejects every step on the way there — i.e. no escape at
  // all. The cost is that a fully-embedded body can also slide sideways through
  // rock, so EVERY entity that can end up embedded needs an unstick self-heal to
  // bound that window (player.js, enemies.js, minions.js all run one at 0.5s).
  const cur = overlap(pos.x, pos.z);
  const tryAxis = cur > 0
    ? (nx, nz) => overlap(nx, nz) <= cur
    : (nx, nz) => overlap(nx, nz) === 0;
  let x = pos.x, z = pos.z;
  if (dx !== 0 && tryAxis(x + dx, z)) x += dx;
  if (dz !== 0 && tryAxis(x, z + dz)) z += dz;
  pos.x = x; pos.z = z;
}

// is this exact spot inside geometry? (used by the unstick self-heal)
// `height` is how tall the thing standing here is — 2.0 for a body, 0 for a
// point like a projectile, which must NOT be stopped by an overhang it flies
// under. `pad` grows the blocker for fat things (the dragon's bulk).
export function posBlocked(x, z, y, grid = null, height = 2.0, pad = 0) {
  const g = grid || G.grid;
  if (!g) return false;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return true;
  const c = g.cells[cy * g.w + cx];
  if (c === SOLID) return true;
  if (c === OBSTACLE && y < 2.4) return true;
  if (g.colliders) {
    for (const col of g.colliders) {
      const top = col.h ?? (col.hx !== undefined ? 99 : 3);
      if (y >= top - 0.05 || y + height <= (col.y0 ?? 0)) continue;
      if (col.hx !== undefined) {
        if (Math.abs(x - col.x) < col.hx + pad && Math.abs(z - col.z) < col.hz + pad) return true;
      } else {
        const dx = x - col.x, dz = z - col.z;
        const r = col.r + pad;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
  }
  return false;
}

// Does anything stop a bolt at this point? Same blockers a body feels, but as a
// POINT (an arrow slips under a balcony a player would bump into). Bone walls,
// barricades, player builds, pillars and props all count — a bolt used to only
// notice SOLID cells and sailed through every one of them.
export function boltBlocked(x, z, y, grid = null) {
  return posBlocked(x, z, y, grid, 0);
}

// Would a BODY standing here overlap geometry? moveWithCollision probes a ring
// of this radius, so anything that only tests the centre point (the old unstick
// self-heal, resolveStuck, placeWall) disagrees with it: you could stand with
// your centre in a free cell but your shoulder inside a wall, unable to move in
// ANY direction while every "am I stuck?" test cheerfully reported "no".
export const BODY_R = 0.55;
export function bodyBlocked(x, z, y, grid = null, radius = BODY_R) {
  if (posBlocked(x, z, y, grid)) return true;
  return posBlocked(x + radius, z, y, grid) || posBlocked(x - radius, z, y, grid) ||
         posBlocked(x, z + radius, y, grid) || posBlocked(x, z - radius, y, grid);
}

// Is anyone standing on this cell? Raising a wall, a build piece or a machine on
// top of a player engulfs them in geometry. Test the whole BODY against the
// cell's bounds — a player whose centre is in the NEXT cell still has a shoulder
// in this one, and walling that up pins them with no way out.
export function cellOccupied(f, cx, cy, maxY = 2.4) {
  const half = CELL / 2 + BODY_R;
  const on = (o) => Math.abs(o.position.x - cx * CELL) < half &&
                    Math.abs(o.position.z - cy * CELL) < half && o.position.y < maxY;
  return anyPlayerAt(f, on);
}

// Nudge a spawn point out of geometry. Summons, slime splits, phantoms, decoys
// and imps all pick a point on a ring around their caster — and a caster with
// its back to a wall puts half of them INSIDE it. An entity that starts embedded
// never recovers on its own, so validate before you place anything.
export function safeSpawn(x, z, y = 0, grid = null) {
  if (!bodyBlocked(x, z, y, grid)) return { x, z };
  return resolveStuck(x, z, y, grid) || null;
}

// same, for pieces that sit on a cell EDGE or lattice corner rather than a cell
export function pointOccupied(f, x, z, rad, maxY = 2.4) {
  const on = (o) => Math.hypot(o.position.x - x, o.position.z - z) < rad + BODY_R && o.position.y < maxY;
  return anyPlayerAt(f, on);
}

function anyPlayerAt(f, on) {
  if (G.player && G.floor === f && !G.player.dead && on(G.player.obj)) return true;
  for (const r of G.remotes.values()) if (r.floor === f && !r.dead && on(r.obj)) return true;
  return false;
}

// find the nearest free spot when a position ended up inside geometry
export function resolveStuck(x, z, y, grid = null) {
  const g = grid || G.grid;
  if (!g) return null;
  // the spot must fit the whole BODY, not just its centre — a centre-only test
  // could deposit you a shoulder's width inside a wall, which is exactly the
  // pinned-forever state this is supposed to rescue you from
  for (let r = 0.6; r <= 10.01; r += 0.6) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (!bodyBlocked(nx, nz, y, g) && groundHeightAt(nx, nz, y, g) <= y + 1.3) return { x: nx, z: nz };
    }
  }
  return null;
}

export function hasLineOfSight(x0, z0, x1, z1, grid = null) {
  const g = grid || G.grid;
  if (!g) return false;
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = x0 + (x1 - x0) * t, sz = z0 + (z1 - z0) * t;
    const cx = Math.round(sx / CELL), cy = Math.round(sz / CELL);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return false;
    if (g.cells[cy * g.w + cx] === SOLID) return false;
  }
  return true;
}

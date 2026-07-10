// Emberlight Village: a real above-ground town — timber-and-plaster houses with
// roofs and doors (KayKit Medieval pack), trees, a well, market stalls, lamp-lit
// dirt paths, a windmill — plus furnished shop interiors you enter through doors,
// staffed by uniquely-skinned keepers. Also builds the Last Stand arena.
import * as THREE from 'three';
import { G } from './state.js';
import { CELL, PLATFORM_H } from './config.js';
import { makeCharacter, applyLook, pieceColliders } from './assets.js';
import { makeBlobShadow } from './fx.js';
import { sfx } from './audio.js';
import { spawnBurst } from './fx.js';

const SOLID = 0, FLOOR = 1, STAIRS = 3, OBSTACLE = 5, RAMP = 6;

export const TOWN_THEME = {
  id: 'town', name: 'EMBERLIGHT VILLAGE', fog: 0x27324a, density: 0.010,
  hemi: 0xcfe0ff, amb: 0x6b7590, torch: 0xffcf99, sun: true,
  tiles: [], props: [], banners: [], bias: [],
};

// the four shops: exterior building model + a furnished interior room
const SHOPS = [
  { type: 'blacksmith', label: '⚒ Enter the Blacksmith', piece: 'town_blacksmith', scale: 8.5,
    at: [7, 10], door: [7, 12], keeper: { model: 'Barbarian', name: 'Ragna the Smith', show: ['1H_Axe'], look: { helmet: false, cape: false, capeColor: 0 }, tints: [['Body', 0x6b4a2f], ['Leg', 0x3a2d20], ['Arm', 0x8a6a4a]] } },
  { type: 'tavern', label: '🍺 Enter the Cracked Flagon', piece: 'town_tavern', scale: 8.5,
    at: [22, 10], door: [22, 12], keeper: { model: 'Knight', name: 'Innkeep Bors', show: [], look: { helmet: false, cape: false, capeColor: 0 }, tints: [['Body', 0x9c6b3d], ['Leg', 0x5e4327], ['Arm', 0xb98a58]] } },
  { type: 'alchemist', label: '🧪 Enter the Alchemist', piece: 'town_home_green2', scale: 8,
    at: [7, 18], door: [7, 20], keeper: { model: 'Rogue_Hooded', name: 'Vex the Alchemist', show: ['Throwable'], look: { helmet: true, cape: true, capeColor: 2 }, tints: [['Body', 0x39543a], ['Hood', 0x2c4030], ['Cape', 0x2c4030]] } },
  { type: 'arcanum', label: '🔮 Enter the Arcanum', piece: 'town_church', scale: 7,
    at: [22, 18], door: [22, 20], keeper: { model: 'Mage', name: 'Sage Elowen', show: ['Spellbook_open'], look: { helmet: true, cape: true, capeColor: 3 }, tints: [['Body', 0x46307a], ['Hat', 0x37245e]] } },
];

const HOMES = [
  { piece: 'town_home_red', at: [11, 4], scale: 7, yaw: Math.PI, door: [11, 6] },
  { piece: 'town_home_blue', at: [19, 4], scale: 7, yaw: Math.PI, door: [19, 6] },
  { piece: 'town_home_green', at: [4, 14], scale: 7, yaw: Math.PI / 2, door: [6, 14] },
  { piece: 'town_home_yellow', at: [25, 14], scale: 7, yaw: -Math.PI / 2, door: [23, 14] },
  { piece: 'town_home_blue', at: [12, 24], scale: 7, yaw: 0, door: [12, 22] },
  { piece: 'town_home_red', at: [18, 24], scale: 7, yaw: 0, door: [18, 22] },
];

const TREES = [[4, 4], [26, 8], [3, 9], [10, 8], [20, 8], [4, 20], [26, 22], [10, 19], [20, 19], [25, 25], [3, 25]];

export function generateTownData() {
  const w = 30, h = 38; // rows 31+ hold the shop interiors (behind the south wall)
  const cells = new Uint8Array(w * h);
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const colliders = [];
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const idxOf = (x, y) => y * w + x;

  // town interior (walled 2..27 square)
  for (let y = 2; y < 28; y++) for (let x = 2; x < 28; x++) set(x, y, FLOOR);

  // dirt paths: gate → square → shops
  const path = new Set();
  const addPath = (x, y) => { if (at(x, y) === FLOOR) path.add(idxOf(x, y)); };
  for (let y = 3; y <= 24; y++) addPath(15, y);
  for (let x = 6; x <= 24; x++) addPath(x, 13);
  for (const s of SHOPS) { addPath(s.door[0], s.door[1]); addPath(s.door[0], s.door[1] + 1); }
  // village square
  for (let y = 12; y <= 16; y++) for (let x = 13; x <= 17; x++) addPath(x, y);

  // buildings collide exactly as the model is shaped (walls, roof, chimney each
  // get their measured box) — and every top is standable if you find a path up
  for (const s of SHOPS) colliders.push(...pieceColliders(s.piece, { x: s.at[0] * CELL, z: s.at[1] * CELL, scale: s.scale }));
  for (const b of HOMES) colliders.push(...pieceColliders(b.piece, { x: b.at[0] * CELL, z: b.at[1] * CELL, yaw: b.yaw, scale: b.scale }));
  colliders.push(...pieceColliders('town_windmill', { x: 26 * CELL, z: 4 * CELL, yaw: Math.PI, scale: 8 }));

  // dungeon portal in the north wall
  const portal = { x: 15, y: 2, dx: 0, dy: -1 };
  set(portal.x, portal.y, STAIRS);

  // ---- interiors: one room per shop, hidden beyond the south wall ----
  const interiors = [];
  SHOPS.forEach((s, i) => {
    const x0 = 2 + i * 7;
    for (let y = 33; y <= 36; y++) for (let x = x0; x <= x0 + 4; x++) set(x, y, FLOOR);
    interiors.push({ x0, y0: 33, shop: s });
  });

  // ================= placements =================
  const placements = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    const sv = Array.isArray(scale) ? S.set(scale[0], scale[1], scale[2]) : S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), sv.clone());
    placements.push({ piece, matrix: M.clone() });
  };
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 }, { dx: -1, dy: 0, yaw: Math.PI / 2 },
    { dx: 0, dy: 1, yaw: 0 }, { dx: 0, dy: -1, yaw: 0 },
  ];
  const torches = [];
  const rand = (() => { let s = 4242; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  const grass = ['floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_dirt_small_A', 'floor_tile_small_weeds_A'];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c === SOLID) continue;
    const wx = x * CELL, wz = y * CELL;
    const interior = y >= 31;
    if (interior) {
      place(rand() < 0.75 ? 'floor_wood_large' : 'floor_wood_large_dark', wx, 0, wz, Math.floor(rand() * 4) * Math.PI / 2);
      place('floor_wood_large_dark', wx, 3.9, wz); // ceiling
    } else if (path.has(idxOf(x, y))) {
      place(rand() < 0.7 ? 'floor_dirt_large' : 'floor_dirt_large_rocky', wx, 0.02, wz, Math.floor(rand() * 4) * Math.PI / 2);
    } else {
      // grass: a green ground plane (added in buildFloorMeshes) + sparse weed tufts
      if (rand() < 0.4) {
        place(grass[Math.floor(rand() * grass.length)], wx + (rand() * 2 - 1), 0.01, wz + (rand() * 2 - 1), Math.floor(rand() * 4) * Math.PI / 2);
      }
    }
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      const neighbor = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
      if (neighbor !== SOLID) continue;
      const ex = wx + d.dx * CELL / 2, ez = wz + d.dy * CELL / 2;
      if (c === STAIRS && d.dx === portal.dx && d.dy === portal.dy) {
        place('wall_doorway', ex, 0, ez, d.yaw);
        place('wall', ex, PLATFORM_H, ez, d.yaw);
        continue;
      }
      const isExitDoor = interior && d.dy === 1 && interiors.some(r => x === r.x0 + 2 && y === 36);
      place(isExitDoor ? 'wall_doorway' : 'wall', ex, 0, ez, d.yaw);
      if (isExitDoor) place('town_fence_gate', ex, 0, ez - 0.3, d.yaw, 2.6); // the wooden door leaf
      if (!interior) place('wall', ex, PLATFORM_H, ez, d.yaw); // rampart is two storeys
      if (interior && (x + y) % 2 === 0) {
        const inx = -d.dx, inz = -d.dy;
        place('torch_mounted', ex + inx * 0.1, 2.3, ez + inz * 0.1, Math.atan2(inx, inz));
        torches.push({ x: ex + inx * 0.5, y: 3.15, z: ez + inz * 0.5 });
      }
    }
  }

  // ---- the village itself ----
  for (const s of SHOPS) {
    place(s.piece, s.at[0] * CELL, 0, s.at[1] * CELL, 0, s.scale);
  }
  for (const b of HOMES) {
    place(b.piece, b.at[0] * CELL, 0, b.at[1] * CELL, b.yaw, b.scale);
  }
  place('town_windmill', 26 * CELL, 0, 4 * CELL, Math.PI, 8);
  place('town_well', 15 * CELL, 0, 14 * CELL, 0, 6);
  colliders.push(...pieceColliders('town_well', { x: 15 * CELL, z: 14 * CELL, scale: 6 }));
  place('town_market', 12 * CELL, 0, 16 * CELL, Math.PI, 4.5);
  colliders.push(...pieceColliders('town_market', { x: 12 * CELL, z: 16 * CELL, yaw: Math.PI, scale: 4.5 }));
  place('town_market', 18 * CELL, 0, 16 * CELL, Math.PI, 4.5);
  colliders.push(...pieceColliders('town_market', { x: 18 * CELL, z: 16 * CELL, yaw: Math.PI, scale: 4.5 }));
  // grain garden with a wooden fence — the grain is hay-soft, so it never collides
  place('town_grain', 4.5 * CELL, 0.05, 24 * CELL, 0, 6);
  for (let i = 0; i < 4; i++) {
    place('town_fence', (3 + i * 1) * CELL, 0, 22.4 * CELL, Math.PI / 2, 3.5);
    colliders.push(...pieceColliders('town_fence', { x: (3 + i * 1) * CELL, z: 22.4 * CELL, yaw: Math.PI / 2, scale: 3.5 }));
  }
  for (const [tx, ty] of TREES) {
    const big = rand() < 0.35;
    const wx = tx * CELL + rand() * 1.6 - 0.8, wz = ty * CELL + rand() * 1.6 - 0.8;
    const yaw = rand() * Math.PI * 2;
    place(big ? 'town_trees' : 'town_tree', wx, 0, wz, yaw, big ? 4.5 : 5.5);
    colliders.push(...pieceColliders(big ? 'town_trees' : 'town_tree', { x: wx, z: wz, yaw, scale: big ? 4.5 : 5.5 }));
  }

  // ---- furnish the interiors ----
  const doors = [];
  const npcs = [];
  interiors.forEach(({ x0, shop }, i) => {
    const cx = (x0 + 2) * CELL, cz = 34.5 * CELL;
    place('town_cabinet', (x0 + 0.6) * CELL, 0, 33.4 * CELL, Math.PI / 2, 2.6);
    place('table_medium', (x0 + 3.4) * CELL, 0, 33.6 * CELL, 0);
    place('candle_triple', (x0 + 3.4) * CELL, 1.05, 33.6 * CELL, rand() * 6);
    place('town_stool', (x0 + 3.2) * CELL, 0, 34.6 * CELL, 1.2, 2.4);
    place('shelf_small', (x0 + 1.2) * CELL, 0, 36.4 * CELL, Math.PI, 1);
    place('banner_patternA_red', (x0 + 2) * CELL, 3.2, 33 * CELL + 0.2, 0);
    if (shop.type === 'tavern') {
      place('barrel_large', (x0 + 4.2) * CELL, 0, 35.8 * CELL);
      place('bottle_A_brown', (x0 + 3.4) * CELL, 1.05, 33.7 * CELL, 1);
      colliders.push(...pieceColliders('barrel_large', { x: (x0 + 4.2) * CELL, z: 35.8 * CELL }));
      // the public-games notice board hangs by the door
      npcs.push({ model: null, noModel: true, name: 'Notice Board', shop: 'board', label: '📜 Public Games board', x: (x0 + 4) * CELL, z: 36 * CELL });
      place('banner_patternA_blue', (x0 + 4) * CELL, 3.0, 36.4 * CELL, Math.PI);
    }
    colliders.push(...pieceColliders('town_cabinet', { x: (x0 + 0.6) * CELL, z: 33.4 * CELL, yaw: Math.PI / 2, scale: 2.6 }));
    colliders.push(...pieceColliders('table_medium', { x: (x0 + 3.4) * CELL, z: 33.6 * CELL }));
    // interior lighting
    torches.push({ x: cx, y: 3.4, z: 33.5 * CELL });

    // keeper (uniquely skinned)
    npcs.push({
      ...shop.keeper, shop: shop.type, label: `${shop.label.replace('Enter the', 'Talk to')}`,
      x: cx, z: 33.8 * CELL,
    });

    // door pair: street door → interior; interior south wall → back to street
    const outX = shop.door[0] * CELL, outZ = shop.door[1] * CELL;
    doors.push({ x: outX, z: outZ - 1.5, label: shop.label, tx: cx, tz: 35.5 * CELL, tyaw: Math.PI });
    doors.push({ x: cx, z: 36.5 * CELL, label: '🚪 Leave the shop', tx: outX, tz: outZ + 2, tyaw: Math.PI });
  });

  // the training corner by the square: exact numbers, no rumors
  npcs.push({
    model: 'Knight', name: 'Drillmaster Otho', shop: 'codex',
    label: '⚔ Talk to Drillmaster Otho — your EXACT attack numbers',
    show: ['1H_Sword'], look: { helmet: true, cape: true, capeColor: 0 },
    tints: [['Body', 0x7a3030], ['Leg', 0x40282a]],
    x: 13 * CELL, z: 12.2 * CELL,
  });
  npcs.push({
    model: 'Rogue_Hooded', name: 'Maren the Hunter', shop: 'bestiary',
    label: '🏹 Talk to Maren the Hunter — know every monster',
    show: ['2H_Crossbow'], look: { helmet: true, cape: true, capeColor: 2 },
    tints: [['Body', 0x3a4a2f], ['Hood', 0x2c3a28], ['Cape', 0x2c3a28]],
    x: 17 * CELL, z: 12.2 * CELL,
  });

  const homeDoors = HOMES.map((b, i) => ({ idx: i, x: b.door[0] * CELL, z: b.door[1] * CELL }));
  const grid = {
    w, h, cells, elev, ramps, colliders,
    rooms: [{ x: 3, y: 3, w: 24, h: 24, cx: 15, cy: 13 }],
    spawn: { x: 15 * CELL, z: 20 * CELL }, spawnYaw: 0, // face the square & gate
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: false,
    portal: { dx: portal.dx, dy: portal.dy, yaw: 0 },
    town: true,
  };
  return {
    grid, torches, traps: [], ropes: [], placements, enemySpawns: [], lootSpawns: [],
    explored: new Uint8Array(w * h), hadBoss: false,
    theme: TOWN_THEME, mutator: null, layoutId: 'town',
    npcs, doors, homeDoors,
  };
}

// claimable houses: nearest home door
export function nearestHomeDoor(pos) {
  const fs = G.floors.get(G.floor);
  if (!fs?.homeDoors) return null;
  for (const d of fs.homeDoors) {
    if (Math.hypot(pos.x - d.x, pos.z - d.z) < 2.4) return d;
  }
  return null;
}

// ---------------- doors (street <-> interior teleports) ----------------
export function nearestDoor(pos) {
  const fs = G.floors.get(G.floor);
  if (!fs?.doors) return null;
  for (const d of fs.doors) {
    if (Math.hypot(pos.x - d.x, pos.z - d.z) < 2.2) return d;
  }
  return null;
}

export function useDoor(door) {
  const p = G.player;
  if (!p) return;
  sfx.chest(); // creaking door
  spawnBurst(p.obj.position.clone().setY(1.2), 0xccbb99, 8, 2, 0.1, 0.3);
  p.obj.position.set(door.tx, 0, door.tz);
  p.camYaw = door.tyaw ?? p.camYaw;
  spawnBurst(new THREE.Vector3(door.tx, 1.2, door.tz), 0xccbb99, 8, 2, 0.1, 0.3);
}

// ---------------- Last Stand arena ----------------
export function generateArenaData() {
  const w = 26, h = 26;
  const cells = new Uint8Array(w * h);
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const idxOf = (x, y) => y * w + x;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) set(x, y, FLOOR);

  const kc = 12;
  for (let y = kc; y < kc + 3; y++) for (let x = kc; x < kc + 3; x++) elev[idxOf(x, y)] = 1;
  // staircase directly against the keep's south face
  set(kc + 1, kc + 3, RAMP);
  ramps.set(idxOf(kc + 1, kc + 3), { dx: 0, dy: -1 });

  const gates = [
    { x: 13, y: 1 }, { x: 13, y: h - 2 }, { x: 1, y: 13 }, { x: w - 2, y: 13 },
  ];

  const placements = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    const sv = Array.isArray(scale) ? S.set(scale[0], scale[1], scale[2]) : S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), sv.clone());
    placements.push({ piece, matrix: M.clone() });
  };
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 }, { dx: -1, dy: 0, yaw: Math.PI / 2 },
    { dx: 0, dy: 1, yaw: 0 }, { dx: 0, dy: -1, yaw: 0 },
  ];
  const torches = [];
  const rand = (() => { let s = 777; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cells[idxOf(x, y)] === SOLID) continue;
    const wx = x * CELL, wz = y * CELL;
    // open grassy field with dirt patches
    if (rand() < 0.3) place(rand() < 0.5 ? 'floor_dirt_small_A' : 'floor_tile_small_weeds_A', wx + (rand() * 2 - 1), 0.01, wz + (rand() * 2 - 1), Math.floor(rand() * 4) * Math.PI / 2);
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      const neighbor = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : cells[idxOf(nx, ny)];
      if (neighbor !== SOLID) continue;
      const ex = wx + d.dx * CELL / 2, ez = wz + d.dy * CELL / 2;
      const isGate = gates.some(g => g.x === x && g.y === y);
      place(isGate ? 'wall_gated' : 'wall', ex, 0, ez, d.yaw);
      place('wall', ex, PLATFORM_H, ez, d.yaw);
      if ((x + y * 3) % 4 === 0) {
        const inx = -d.dx, inz = -d.dy;
        place('torch_mounted', ex + inx * 0.1, 2.3, ez + inz * 0.1, Math.atan2(inx, inz));
        torches.push({ x: ex + inx * 0.5, y: 3.15, z: ez + inz * 0.5 });
      }
    }
  }
  for (let y = kc; y < kc + 3; y++) for (let x = kc; x < kc + 3; x++) {
    place('floor_tile_large', x * CELL, PLATFORM_H, y * CELL);
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      const plat = nx >= kc && nx < kc + 3 && ny >= kc && ny < kc + 3;
      const isRamp = nx === kc + 1 && ny === kc + 3;
      if (plat || isRamp) continue;
      place('barrier', x * CELL + d.dx * CELL / 2, PLATFORM_H, y * CELL + d.dy * CELL / 2, d.yaw);
    }
    if ((x + y) % 2 === 0) place('pillar', x * CELL, 0, y * CELL);
  }
  // stairs top edge sits flush with the keep's south face
  place('stairs', (kc + 1) * CELL, 0, (kc + 3) * CELL - CELL / 2, Math.atan2(0, 1), [0.8, PLATFORM_H / 5.1, 1]);

  const grid = {
    w, h, cells, elev, ramps, colliders: [],
    rooms: [{ x: 2, y: 2, w: w - 4, h: h - 4, cx: 13, cy: 13 }],
    spawn: { x: 13 * CELL, z: 15 * CELL },
    stairs: { x: -999, z: -999, cx: -99, cy: -99 },
    stairsLocked: false,
    portal: { dx: 0, dy: -1, yaw: 0 },
    arena: true, gates, town: false, lawn: true,
  };
  return {
    grid, torches, traps: [], ropes: [{ x: 13 * CELL + 2, z: 13 * CELL - 6, ay: 7.4, len: 5.0 }],
    placements, enemySpawns: [], lootSpawns: [],
    explored: new Uint8Array(w * h), hadBoss: false,
    theme: { id: 'arena', name: 'THE LAST STAND', fog: 0x8fb3d9, density: 0.006, hemi: 0xf2f7ff, amb: 0x9aa4bb, torch: 0xffcf99, sun: true, tiles: [], props: [], banners: [], bias: [] },
    mutator: null, layoutId: 'arena',
  };
}

// ---------------- town NPCs (uniquely skinned) ----------------
function applySkin(obj, tints) {
  if (!tints) return;
  obj.traverse((n) => {
    if (!n.isMesh && !n.isSkinnedMesh) return;
    for (const [pattern, color] of tints) {
      if (n.name.includes(pattern)) {
        if (n.material.isMeshBasicMaterial) continue;
        n.material = n.material.clone();
        n.material.color = new THREE.Color(color);
        break;
      }
    }
  });
}

export function spawnTownNpcs(fs) {
  if (fs.npcObjs || !fs.npcs) return;
  fs.npcObjs = [];
  for (const n of fs.npcs) {
    if (n.noModel) {
      // a visible floating sign (e.g. the tavern's Public Games board)
      const c2 = document.createElement('canvas');
      c2.width = 512; c2.height = 96;
      const g2 = c2.getContext('2d');
      g2.fillStyle = 'rgba(20,14,8,0.85)';
      g2.fillRect(0, 0, 512, 96);
      g2.strokeStyle = '#c9a13b'; g2.lineWidth = 6;
      g2.strokeRect(4, 4, 504, 88);
      g2.font = 'bold 44px Trebuchet MS';
      g2.textAlign = 'center';
      g2.fillStyle = '#ffe9c0';
      g2.fillText(n.label || n.name, 256, 60);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c2), transparent: true }));
      sign.scale.set(3.4, 0.65, 1);
      sign.position.set(n.x, 2.4, n.z);
      fs.meshGroup.add(sign);
      fs.npcObjs.push({ ...n, obj: sign, anim: null });
      continue;
    }
    const { obj, anim } = makeCharacter('char', n.model, n.show || []);
    applyLook(obj, n.look || { cape: true, helmet: true, capeColor: 4 });
    applySkin(obj, n.tints);
    obj.position.set(n.x, 0, n.z);
    obj.rotation.y = Math.PI;
    obj.add(makeBlobShadow(0.85));
    const c = document.createElement('canvas');
    c.width = 256; c.height = 48;
    const g = c.getContext('2d');
    g.font = 'bold 22px Trebuchet MS';
    g.textAlign = 'center';
    g.strokeStyle = '#000'; g.lineWidth = 5;
    g.strokeText(n.name, 128, 30);
    g.fillStyle = '#ffe9c0';
    g.fillText(n.name, 128, 30);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); // depth-tested: no bleeding through walls
    tag.scale.set(2.4, 0.45, 1);
    tag.position.y = 2.5;
    obj.add(tag);
    anim.play('Idle');
    fs.meshGroup.add(obj);
    fs.npcObjs.push({ ...n, obj, anim });
  }
}

export function updateTownNpcs(dt) {
  const fs = G.floors.get(G.floor);
  if (!fs?.npcObjs) return;
  // keepers greet the NEAREST adventurer (local or remote) — every client
  // computes the same nearest from synced positions, so all players see the
  // keeper facing the same way
  const folks = [];
  if (G.player && !G.player.dead) folks.push(G.player.obj.position);
  for (const r of G.remotes.values()) if (!r.dead && r.floor === G.floor) folks.push(r.obj.position);
  for (const n of fs.npcObjs) {
    if (!n.anim) continue;
    n.anim.update(dt);
    let best = null, bd = 6;
    for (const p of folks) {
      const d = Math.hypot(p.x - n.x, p.z - n.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      const target = Math.atan2(best.x - n.x, best.z - n.z);
      let d = target - n.obj.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      n.obj.rotation.y += d * Math.min(1, dt * 4);
    }
  }
}

export function nearestShopkeeper(pos) {
  const fs = G.floors.get(G.floor);
  if (!fs?.npcObjs) return null;
  for (const n of fs.npcObjs) {
    if (Math.hypot(pos.x - n.x, pos.z - n.z) < (n.noModel ? 3.6 : 2.6)) return n;
  }
  return null;
}

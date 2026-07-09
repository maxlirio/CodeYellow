// Emberlight Village: a real above-ground town — timber-and-plaster houses with
// roofs and doors (KayKit Medieval pack), trees, a well, market stalls, lamp-lit
// dirt paths, a windmill — plus furnished shop interiors you enter through doors,
// staffed by uniquely-skinned keepers. Also builds the Last Stand arena.
import * as THREE from 'three';
import { G } from './state.js';
import { CELL, PLATFORM_H } from './config.js';
import { makeCharacter, applyLook } from './assets.js';
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
  { piece: 'town_home_red', at: [11, 4], scale: 7, yaw: Math.PI },
  { piece: 'town_home_blue', at: [19, 4], scale: 7, yaw: Math.PI },
  { piece: 'town_home_green', at: [4, 14], scale: 7, yaw: Math.PI / 2 },
  { piece: 'town_home_yellow', at: [25, 14], scale: 7, yaw: -Math.PI / 2 },
  { piece: 'town_home_blue', at: [12, 24], scale: 7, yaw: 0 },
  { piece: 'town_home_red', at: [18, 24], scale: 7, yaw: 0 },
];

const TREES = [[4, 4], [26, 8], [3, 9], [10, 8], [20, 8], [4, 20], [26, 22], [10, 19], [20, 19], [25, 25], [3, 25]];
const LANTERNS = [[14, 6], [16, 11], [13, 17], [17, 20], [14, 22], [10, 12], [20, 12]];

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

  // building footprints block movement (coarse cells fit these big models)
  const stamp = (cx, cy, rw, rh) => {
    for (let y = cy - rh; y <= cy + rh; y++) for (let x = cx - rw; x <= cx + rw; x++) {
      if (x > 1 && y > 1 && x < 28 && y < 28) set(x, y, OBSTACLE);
    }
  };
  for (const s of SHOPS) stamp(s.at[0], s.at[1], 1, 1);
  for (const b of HOMES) stamp(b.at[0], b.at[1], 1, 1);
  stamp(26, 4, 1, 1); // windmill

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
    if (c === OBSTACLE) continue; // building footprint: ground only, no walls
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
      place('wall', ex, 0, ez, d.yaw);
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
  colliders.push({ x: 15 * CELL, z: 14 * CELL, r: 2.6 });
  place('town_market', 12 * CELL, 0, 16 * CELL, Math.PI, 4.5);
  colliders.push({ x: 12 * CELL, z: 16 * CELL, r: 2.6 });
  place('town_market', 18 * CELL, 0, 16 * CELL, Math.PI, 4.5);
  colliders.push({ x: 18 * CELL, z: 16 * CELL, r: 2.6 });
  // grain garden with a wooden fence
  place('town_grain', 4.5 * CELL, 0.05, 24 * CELL, 0, 6);
  for (let i = 0; i < 4; i++) {
    place('town_fence', (3 + i * 1) * CELL, 0, 22.4 * CELL, Math.PI / 2, 3.5);
  }
  for (const [tx, ty] of TREES) {
    const big = rand() < 0.35;
    place(big ? 'town_trees' : 'town_tree', tx * CELL + rand() * 1.6 - 0.8, 0, ty * CELL + rand() * 1.6 - 0.8, rand() * Math.PI * 2, big ? 4.5 : 5.5);
    colliders.push({ x: tx * CELL, z: ty * CELL, r: big ? 1.4 : 0.7 });
  }
  for (const [lx, ly] of LANTERNS) {
    place('town_lantern', lx * CELL + 1.4, 0, ly * CELL + 1.4, 0, 2.4);
    colliders.push({ x: lx * CELL + 1.4, z: ly * CELL + 1.4, r: 0.3 });
    torches.push({ x: lx * CELL + 1.4, y: 3.1, z: ly * CELL + 1.4 });
  }

  // ---- furnish the interiors ----
  const doors = [];
  const npcs = [];
  interiors.forEach(({ x0, shop }, i) => {
    const cx = (x0 + 2) * CELL, cz = 34.5 * CELL;
    place('town_rug', cx, 0.06, cz, 0, 5);
    place('town_cabinet', (x0 + 0.6) * CELL, 0, 33.4 * CELL, Math.PI / 2, 2.6);
    place('table_medium', (x0 + 3.4) * CELL, 0, 33.6 * CELL, 0);
    place('candle_triple', (x0 + 3.4) * CELL, 1.05, 33.6 * CELL, rand() * 6);
    place('town_stool', (x0 + 3.2) * CELL, 0, 34.6 * CELL, 1.2, 2.4);
    place('shelf_small', (x0 + 1.2) * CELL, 0, 36.4 * CELL, Math.PI, 1);
    place('banner_patternA_red', (x0 + 2) * CELL, 3.2, 33 * CELL + 0.2, 0);
    if (shop.type === 'tavern') {
      place('barrel_large', (x0 + 4.2) * CELL, 0, 35.8 * CELL);
      place('bottle_A_brown', (x0 + 3.4) * CELL, 1.05, 33.7 * CELL, 1);
      colliders.push({ x: (x0 + 4.2) * CELL, z: 35.8 * CELL, r: 0.9 });
      // the public-games notice board hangs by the door
      npcs.push({ model: null, noModel: true, name: 'Notice Board', shop: 'board', label: '📜 Public Games board', x: (x0 + 4) * CELL, z: 36 * CELL });
      place('banner_patternA_blue', (x0 + 4) * CELL, 3.0, 36.4 * CELL, Math.PI);
    }
    colliders.push({ x: (x0 + 0.6) * CELL, z: 33.4 * CELL, r: 1.1 });
    colliders.push({ x: (x0 + 3.4) * CELL, z: 33.6 * CELL, r: 1.2 });
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
    npcs, doors,
  };
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
  set(kc + 1, kc + 4, RAMP);
  ramps.set(idxOf(kc + 1, kc + 4), { dx: 0, dy: -1 });

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
    place(rand() < 0.8 ? 'floor_tile_large' : 'floor_tile_large_rocks', wx, 0, wz, Math.floor(rand() * 4) * Math.PI / 2);
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
      const isRamp = nx === kc + 1 && ny === kc + 4;
      if (plat || isRamp) continue;
      place('barrier', x * CELL + d.dx * CELL / 2, PLATFORM_H, y * CELL + d.dy * CELL / 2, d.yaw);
    }
    if ((x + y) % 2 === 0) place('pillar', x * CELL, 0, y * CELL);
  }
  place('stairs', (kc + 1) * CELL, 0, (kc + 4) * CELL - CELL / 2 - 2, Math.atan2(0, 1), [0.8, PLATFORM_H / 5.1, 1]);

  const grid = {
    w, h, cells, elev, ramps, colliders: [],
    rooms: [{ x: 2, y: 2, w: w - 4, h: h - 4, cx: 13, cy: 13 }],
    spawn: { x: 13 * CELL, z: 15 * CELL },
    stairs: { x: -999, z: -999, cx: -99, cy: -99 },
    stairsLocked: false,
    portal: { dx: 0, dy: -1, yaw: 0 },
    arena: true, gates,
  };
  return {
    grid, torches, traps: [], ropes: [{ x: 13 * CELL + 2, z: 13 * CELL - 6, ay: 7.4, len: 5.0 }],
    placements, enemySpawns: [], lootSpawns: [],
    explored: new Uint8Array(w * h), hadBoss: false,
    theme: { id: 'arena', name: 'THE LAST STAND', fog: 0x0c0a10, density: 0.024, hemi: 0x9988bb, amb: 0x4a4260, torch: 0xffb066, tiles: [], props: [], banners: [], bias: [] },
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
    if (n.noModel) { fs.npcObjs.push({ ...n, obj: null, anim: null }); continue; }
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
  for (const n of fs.npcObjs) {
    if (!n.anim) continue;
    n.anim.update(dt);
    if (G.player) {
      const dx = G.player.obj.position.x - n.x, dz = G.player.obj.position.z - n.z;
      if (Math.hypot(dx, dz) < 6) {
        const target = Math.atan2(dx, dz);
        let d = target - n.obj.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        n.obj.rotation.y += d * Math.min(1, dt * 4);
      }
    }
  }
}

export function nearestShopkeeper(pos) {
  const fs = G.floors.get(G.floor);
  if (!fs?.npcObjs) return null;
  for (const n of fs.npcObjs) {
    if (Math.hypot(pos.x - n.x, pos.z - n.z) < 2.6) return n;
  }
  return null;
}

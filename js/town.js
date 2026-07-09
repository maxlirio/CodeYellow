// Emberlight Village: the above-ground walled town hub (floor 0) — enterable shop
// buildings with NPC keepers, a dungeon portal, and the tavern with its games board.
// Also builds the Last Stand arena used by horde mode.
import * as THREE from 'three';
import { G } from './state.js';
import { CELL, PLATFORM_H } from './config.js';
import { makeCharacter, applyLook } from './assets.js';
import { makeBlobShadow } from './fx.js';

const SOLID = 0, FLOOR = 1, STAIRS = 3, OBSTACLE = 5, RAMP = 6;

export const TOWN_THEME = {
  id: 'town', name: 'EMBERLIGHT VILLAGE', fog: 0x27324a, density: 0.011,
  hemi: 0xcfe0ff, amb: 0x6b7590, torch: 0xffcf99, sun: true,
  tiles: [], props: [], banners: [], bias: [],
};

const BUILDINGS = [
  { type: 'blacksmith', label: '⚒ Blacksmith', x: 4, y: 4, w: 6, h: 5, door: [7, 8], keeper: { model: 'Barbarian', name: 'Ragna the Smith' } },
  { type: 'alchemist', label: '🧪 Alchemist', x: 20, y: 4, w: 6, h: 5, door: [22, 8], keeper: { model: 'Rogue', name: 'Vex the Alchemist' } },
  { type: 'arcanum', label: '🔮 Arcanum', x: 4, y: 17, w: 6, h: 5, door: [7, 17], keeper: { model: 'Mage', name: 'Sage Elowen' } },
  { type: 'tavern', label: '🍺 The Cracked Flagon', x: 18, y: 16, w: 8, h: 7, door: [18, 19], keeper: { model: 'Knight', name: 'Innkeep Bors' } },
];

export function generateTownData() {
  const w = 30, h = 30;
  const cells = new Uint8Array(w * h); // SOLID
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const idxOf = (x, y) => y * w + x;

  // open ground inside the town wall (2-cell rampart)
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) set(x, y, FLOOR);

  // buildings: solid walls, one door, wooden interior
  const interior = new Set();
  for (const b of BUILDINGS) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
      const edge = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
      if (edge) set(x, y, SOLID);
      else { set(x, y, FLOOR); interior.add(idxOf(x, y)); }
    }
    set(b.door[0], b.door[1], FLOOR);
    interior.add(idxOf(b.door[0], b.door[1]));
  }

  // dungeon portal: an archway in the north wall
  const portal = { x: 15, y: 2, dx: 0, dy: -1 };
  set(portal.x, portal.y, STAIRS);

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
  const grass = ['floor_dirt_large', 'floor_dirt_small_A', 'floor_tile_small_weeds_A', 'floor_dirt_small_B', 'floor_tile_small_weeds_B', 'floor_dirt_small_C'];
  const rand = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c === SOLID) continue;
    const wx = x * CELL, wz = y * CELL;
    if (interior.has(idxOf(x, y))) {
      place(rand() < 0.75 ? 'floor_wood_large' : 'floor_wood_large_dark', wx, 0, wz, Math.floor(rand() * 4) * Math.PI / 2);
    } else {
      const g = grass[Math.floor(rand() * grass.length)];
      if (g.includes('small')) {
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          place(grass[Math.floor(rand() * grass.length)].replace('floor_dirt_large', 'floor_dirt_small_A'), wx + ox, 0, wz + oz, Math.floor(rand() * 4) * Math.PI / 2);
        }
      } else place(g, wx, 0, wz, Math.floor(rand() * 4) * Math.PI / 2);
    }
    let isTownWallEdge = false;
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
      // the town rampart is two storeys; buildings are one
      const townWall = nx < 2 || ny < 2 || nx >= w - 2 || ny >= h - 2;
      place('wall', ex, 0, ez, d.yaw);
      if (townWall) { place('wall', ex, PLATFORM_H, ez, d.yaw); isTownWallEdge = true; }
      if ((x + y * 3) % 4 === 0) {
        const inx = -d.dx, inz = -d.dy;
        place('torch_mounted', ex + inx * 0.1, 2.3, ez + inz * 0.1, Math.atan2(inx, inz));
        torches.push({ x: ex + inx * 0.5, y: 3.15, z: ez + inz * 0.5 });
      }
    }
  }

  // street & interior decoration
  place('barrel_large', 12 * CELL, 0, 12 * CELL);
  place('crates_stacked', 12 * CELL + 1.6, 0, 12 * CELL - 1.2, 0.6);
  place('barrel_small', 17 * CELL, 0, 11 * CELL);
  for (const b of BUILDINGS) {
    const cx = (b.x + Math.floor(b.w / 2)) * CELL, cz = (b.y + Math.floor(b.h / 2)) * CELL;
    place('table_medium', cx, 0, cz - CELL);
    place('candle_triple', cx, 1.05, cz - CELL);
    place('shelf_small', (b.x + 1) * CELL, 0, (b.y + 1) * CELL, Math.PI / 2);
    place('banner_patternA_red', b.door[0] * CELL + 1.2, 3.2, b.door[1] * CELL + (b.door[1] === b.y ? -1.85 : 1.85));
    if (b.type === 'tavern') {
      place('table_medium', cx + CELL, 0, cz);
      place('bottle_A_brown', cx + CELL, 1.05, cz, 0.5);
      place('bottle_B_brown', cx + CELL + 0.4, 1.05, cz + 0.3, 1.2);
      // the notice board (public games) on the tavern's inner wall
      place('banner_patternA_blue', (b.x + b.w - 2) * CELL, 3.0, (b.y + 1) * CELL - 1.85);
    }
  }

  const grid = {
    w, h, cells, elev, ramps, rooms: [{ x: 3, y: 3, w: w - 6, h: h - 6, cx: 15, cy: 13 }],
    spawn: { x: 15 * CELL, z: 12 * CELL },
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: false,
    portal: { dx: portal.dx, dy: portal.dy, yaw: 0 },
    town: true,
  };
  return {
    grid, torches, traps: [], ropes: [], placements, enemySpawns: [], lootSpawns: [],
    explored: new Uint8Array(w * h), hadBoss: false,
    theme: TOWN_THEME, mutator: null, layoutId: 'town',
    npcs: BUILDINGS.map(b => ({
      ...b.keeper, shop: b.type, label: b.label,
      x: (b.x + Math.floor(b.w / 2)) * CELL, z: (b.y + 1.6) * CELL,
    })).concat([{ model: 'Rogue', name: 'Notice Board', shop: 'board', label: '📜 Public Games', x: 24 * CELL, z: 17.6 * CELL, noModel: true }]),
  };
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

  // central keep: 3x3 platform with a staircase
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
  // keep deck, rails, stairs, supports
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
    w, h, cells, elev, ramps, rooms: [{ x: 2, y: 2, w: w - 4, h: h - 4, cx: 13, cy: 13 }],
    spawn: { x: 13 * CELL, z: 15 * CELL },
    stairs: { x: -999, z: -999, cx: -99, cy: -99 }, // no exit — you hold the line
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

// ---------------- town NPCs ----------------
export function spawnTownNpcs(fs) {
  if (fs.npcObjs || !fs.npcs) return;
  fs.npcObjs = [];
  for (const n of fs.npcs) {
    if (n.noModel) { fs.npcObjs.push({ ...n, obj: null, anim: null }); continue; }
    const { obj, anim } = makeCharacter('char', n.model, []);
    applyLook(obj, { cape: true, helmet: true, capeColor: 4 });
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
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
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
    // face the player when nearby
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

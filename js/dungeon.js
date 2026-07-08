// Procedural dungeon: seeded room+corridor generation, merged static geometry,
// torch placement, traps, portal exit, and spawn lists for enemies & loot.
import * as THREE from 'three';
import { G } from './state.js';
import { makeRng } from './rng.js';
import { CELL, BOSS_FLOORS } from './config.js';
import { buildMergedStatic } from './assets.js';

export const SOLID = 0, FLOOR = 1, STAIRS = 3, TRAP = 4, OBSTACLE = 5;

let floorGroup = null;

export function clearFloorMeshes() {
  if (floorGroup) {
    floorGroup.traverse((n) => { if (n.isMesh) { n.geometry.dispose(); } });
    G.scene.remove(floorGroup);
    floorGroup = null;
  }
}

export function generateFloor(seedStr, floor) {
  const rng = makeRng(`${seedStr}:floor:${floor}`);
  const size = Math.min(34 + floor * 2, 46);
  const w = size, h = size;
  const cells = new Uint8Array(w * h); // SOLID
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const inb = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;

  // ---- rooms ----
  const isBossFloor = !!BOSS_FLOORS[floor];
  const targetRooms = Math.min(6 + floor, 11);
  const rooms = [];
  for (let tries = 0; tries < 120 && rooms.length < targetRooms; tries++) {
    const rw = rng.int(4, 8), rh = rng.int(4, 8);
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

  // ---- corridors (L-shaped between consecutive rooms + a couple of loops) ----
  const corridor = (a, b) => {
    let { cx: x, cy: y } = a;
    const digTo = (tx, ty) => {
      while (x !== tx) { x += Math.sign(tx - x); if (inb(x, y) && at(x, y) === SOLID) set(x, y, FLOOR); }
      while (y !== ty) { y += Math.sign(ty - y); if (inb(x, y) && at(x, y) === SOLID) set(x, y, FLOOR); }
    };
    if (rng.chance(0.5)) { digTo(b.cx, y); digTo(b.cx, b.cy); } else { digTo(x, b.cy); digTo(b.cx, b.cy); }
  };
  for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
  for (let i = 0; i < 2 && rooms.length > 3; i++) corridor(rng.pick(rooms), rng.pick(rooms));

  // ---- spawn & exit rooms ----
  const spawnRoom = rooms[0];
  let exitRoom = rooms[0], bestD = -1;
  for (const r of rooms) {
    const d = (r.cx - spawnRoom.cx) ** 2 + (r.cy - spawnRoom.cy) ** 2;
    if (d > bestD) { bestD = d; exitRoom = r; }
  }

  // ---- traps in corridors ----
  const traps = [];
  const isCorridorCell = (x, y) => {
    if (at(x, y) !== FLOOR) return false;
    for (const r of rooms) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return false;
    return true;
  };
  const trapCount = Math.min(2 + floor, 8);
  for (let tries = 0, placed = 0; tries < 200 && placed < trapCount; tries++) {
    const x = rng.int(2, w - 3), y = rng.int(2, h - 3);
    if (isCorridorCell(x, y)) { set(x, y, TRAP); traps.push({ x: x * CELL, z: y * CELL, cx: x, cy: y }); placed++; }
  }

  // ---- portal exit: pick a wall edge of exit room ----
  const edgeCandidates = [];
  for (let x = exitRoom.x; x < exitRoom.x + exitRoom.w; x++) {
    if (at(x, exitRoom.y - 1) === SOLID) edgeCandidates.push({ x, y: exitRoom.y, dx: 0, dy: -1 });
    if (at(x, exitRoom.y + exitRoom.h) === SOLID) edgeCandidates.push({ x, y: exitRoom.y + exitRoom.h - 1, dx: 0, dy: 1 });
  }
  for (let y = exitRoom.y; y < exitRoom.y + exitRoom.h; y++) {
    if (at(exitRoom.x - 1, y) === SOLID) edgeCandidates.push({ x: exitRoom.x, y, dx: -1, dy: 0 });
    if (at(exitRoom.x + exitRoom.w, y) === SOLID) edgeCandidates.push({ x: exitRoom.x + exitRoom.w - 1, y, dx: 1, dy: 0 });
  }
  const portal = edgeCandidates.length ? rng.pick(edgeCandidates) : { x: exitRoom.cx, y: exitRoom.cy, dx: 0, dy: -1 };
  set(portal.x, portal.y, STAIRS);

  // ================= geometry =================
  const placements = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), S.clone());
    placements.push({ piece, matrix: M.clone() });
  };

  const floorVariants = ['floor_tile_large', 'floor_tile_large', 'floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_weeds_A', 'floor_tile_small_decorated', 'floor_tile_small_broken_B'];
  const torches = [];
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 },   // wall on +x edge runs along z
    { dx: -1, dy: 0, yaw: Math.PI / 2 },
    { dx: 0, dy: 1, yaw: 0 },
    { dx: 0, dy: -1, yaw: 0 },
  ];

  let torchStep = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c === SOLID) continue;
    const wx = x * CELL, wz = y * CELL;
    // floor tile
    if (c === TRAP) {
      place('floor_tile_large', wx, 0, wz);
      place('floor_tile_big_spikes', wx, 0.02, wz);
    } else {
      const fv = floorVariants[Math.floor(rng.next() * floorVariants.length)];
      if (fv.includes('small')) {
        // small tiles are 2x2: fill the 4x4 cell with 4 of them
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const v = rng.chance(0.25) ? floorVariants[Math.floor(rng.next() * floorVariants.length)] : 'floor_tile_small';
          place(v.includes('small') ? v : 'floor_tile_small', wx + ox, 0, wz + oz, rng.int(0, 3) * Math.PI / 2);
        }
      } else {
        place(fv, wx, 0, wz, rng.int(0, 3) * Math.PI / 2);
      }
    }
    // walls on edges facing solid cells
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      const neighbor = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
      if (neighbor !== SOLID) continue;
      const ex = wx + d.dx * CELL / 2, ez = wz + d.dy * CELL / 2;
      const isPortalHere = (c === STAIRS && d.dx === portal.dx && d.dy === portal.dy);
      if (isPortalHere) {
        place('wall_doorway', ex, 0, ez, d.yaw);
        continue;
      }
      const roll = rng.next();
      const piece = roll < 0.8 ? 'wall' : roll < 0.93 ? 'wall_cracked' : 'wall_broken';
      place(piece, ex, 0, ez, d.yaw);
      // torches on some walls
      torchStep++;
      if (torchStep % 5 === 0 && c !== STAIRS) {
        const inx = -d.dx, inz = -d.dy; // into the room
        const tyaw = Math.atan2(inx, inz);
        place('torch_mounted', ex + inx * 0.1, 2.3, ez + inz * 0.1, tyaw);
        torches.push({ x: ex + inx * 0.5, y: 3.15, z: ez + inz * 0.5 });
      }
    }
  }

  // ---- room decoration & obstacles ----
  const props = [];
  const propAt = (x, y) => props.find(p => p.cx === x && p.cy === y);
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    const isExit = r === exitRoom;
    const nProps = rng.int(1, 3);
    for (let i = 0; i < nProps; i++) {
      // perimeter cell of the room
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      const onEdge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      if (!onEdge || at(x, y) !== FLOOR || propAt(x, y)) continue;
      if (isExit && Math.abs(x - portal.x) + Math.abs(y - portal.y) < 2) continue;
      const kind = rng.pick(['barrel_large', 'box_large', 'crates_stacked', 'table_medium', 'barrel_small', 'shelf_small']);
      const yaw = rng.int(0, 3) * Math.PI / 2;
      place(kind, x * CELL, 0, y * CELL, yaw);
      if (kind === 'table_medium' && rng.chance(0.8)) place(rng.pick(['candle_lit', 'candle_triple', 'bottle_A_brown', 'bottle_B_brown']), x * CELL, 1.05, y * CELL, rng.next() * Math.PI * 2);
      set(x, y, OBSTACLE);
      props.push({ cx: x, cy: y });
    }
    // pillars in big rooms
    if (r.w >= 6 && r.h >= 6) {
      for (const [px, py] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) {
        if (rng.chance(0.7) && at(px, py) === FLOOR && !propAt(px, py)) {
          place(rng.chance(0.3) ? 'pillar_decorated' : 'pillar', px * CELL, 0, py * CELL);
          set(px, py, OBSTACLE);
          props.push({ cx: px, cy: py });
        }
      }
    }
    // banners near room walls
    if (rng.chance(0.5)) {
      const bx = rng.int(r.x, r.x + r.w - 1);
      if (at(bx, r.y - 1) === SOLID && at(bx, r.y) !== OBSTACLE) place(rng.pick(['banner_patternA_red', 'banner_patternA_blue']), bx * CELL, 3.4, r.y * CELL - CELL / 2 + 0.15, 0);
    }
  }

  // ---- build merged mesh ----
  clearFloorMeshes();
  floorGroup = buildMergedStatic(placements);
  G.scene.add(floorGroup);

  // ---- enemy spawn list (deterministic order => stable network ids) ----
  const enemySpawns = [];
  const pool = floor === 1 ? ['minion', 'minion', 'minion', 'rogue']
    : floor === 2 ? ['minion', 'minion', 'rogue', 'warrior']
    : floor <= 4 ? ['minion', 'minion', 'rogue', 'warrior', 'mage']
    : ['minion', 'rogue', 'rogue', 'warrior', 'warrior', 'mage', 'mage'];
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    const n = (r === exitRoom && isBossFloor) ? 1 : rng.int(1, Math.min(3, 1 + Math.floor(floor / 2)));
    for (let i = 0; i < n; i++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (at(x, y) !== FLOOR) continue;
      enemySpawns.push({ type: rng.pick(pool), x: x * CELL + rng.next() * 2 - 1, z: y * CELL + rng.next() * 2 - 1 });
    }
  }
  if (isBossFloor) {
    enemySpawns.push({ type: BOSS_FLOORS[floor], x: exitRoom.cx * CELL, z: exitRoom.cy * CELL });
  }

  // ---- loot spawn list ----
  const lootSpawns = [];
  const freeRoomCell = (r) => {
    for (let tries = 0; tries < 20; tries++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (at(x, y) === FLOOR) return { x, y };
    }
    return null;
  };
  // chests
  const chestRooms = rooms.filter(r => r !== spawnRoom);
  const nChests = Math.min(2 + Math.floor(floor / 2), 4);
  for (let i = 0; i < nChests && chestRooms.length; i++) {
    const r = rng.pick(chestRooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: 'chest', x: c.x * CELL, z: c.y * CELL, yaw: rng.next() * Math.PI * 2 });
  }
  // one locked gold chest + its key hidden in a normal spot
  const gr = rng.pick(chestRooms.length ? chestRooms : rooms);
  const gc = freeRoomCell(gr);
  if (gc) {
    lootSpawns.push({ kind: 'goldchest', x: gc.x * CELL, z: gc.y * CELL, yaw: rng.next() * Math.PI * 2 });
    const kr = rng.pick(chestRooms.length ? chestRooms : rooms);
    const kc = freeRoomCell(kr);
    if (kc) lootSpawns.push({ kind: 'key', x: kc.x * CELL + 1, z: kc.y * CELL + 1 });
  }
  // coins & potions scattered
  const nCoins = rng.int(6, 10);
  for (let i = 0; i < nCoins; i++) {
    const r = rng.pick(rooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: rng.chance(0.3) ? 'coinstack' : 'coin', x: c.x * CELL + rng.next() * 2 - 1, z: c.y * CELL + rng.next() * 2 - 1 });
  }
  for (let i = 0; i < rng.int(1, 3); i++) {
    const r = rng.pick(rooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: 'potion', x: c.x * CELL + rng.next() * 2 - 1, z: c.y * CELL + rng.next() * 2 - 1 });
  }

  // portal glow (separate small dynamic bits — added to floorGroup for easy cleanup)
  const portalWorld = {
    x: portal.x * CELL + portal.dx * (CELL / 2 - 0.4),
    z: portal.y * CELL + portal.dy * (CELL / 2 - 0.4),
    yaw: wallDirs.find(d => d.dx === portal.dx && d.dy === portal.dy).yaw,
  };
  const glowGeo = new THREE.PlaneGeometry(2.6, 3.4);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7718, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(portal.x * CELL + portal.dx * CELL / 2, 1.8, portal.y * CELL + portal.dy * CELL / 2);
  glow.rotation.y = portalWorld.yaw;
  floorGroup.add(glow);
  const plight = new THREE.PointLight(0xff8822, 18, 14, 1.6);
  plight.position.set(portalWorld.x, 2.2, portalWorld.z);
  floorGroup.add(plight);

  // ---- commit state ----
  G.grid = {
    w, h, cells, rooms,
    spawn: { x: spawnRoom.cx * CELL, z: spawnRoom.cy * CELL },
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: isBossFloor,
  };
  G.explored = new Uint8Array(w * h);
  G.torches = torches;
  G.traps = traps.map(t => ({ ...t, cd: 0 }));

  return { enemySpawns, lootSpawns };
}

// ---- movement & collision ----
const solidAt = (x, z) => {
  if (!G.grid) return true;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return true;
  const c = G.grid.cells[cy * G.grid.w + cx];
  return c === SOLID || c === OBSTACLE;
};

export function moveWithCollision(pos, dx, dz, radius = 0.55) {
  // axis-separated movement with radius probing
  const tryAxis = (nx, nz) => {
    const checks = [
      [nx + radius, nz], [nx - radius, nz], [nx, nz + radius], [nx, nz - radius],
      [nx + radius * 0.7, nz + radius * 0.7], [nx - radius * 0.7, nz + radius * 0.7],
      [nx + radius * 0.7, nz - radius * 0.7], [nx - radius * 0.7, nz - radius * 0.7],
    ];
    return checks.every(([cx, cz]) => !solidAt(cx, cz));
  };
  let x = pos.x, z = pos.z;
  if (dx !== 0 && tryAxis(x + dx, z)) x += dx;
  if (dz !== 0 && tryAxis(x, z + dz)) z += dz;
  pos.x = x; pos.z = z;
}

export function hasLineOfSight(x0, z0, x1, z1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

// Procedural dungeon: seeded room+corridor generation, merged static geometry,
// climbable platforms with stairs & rail barriers, torches, traps, portal exit,
// and spawn lists for enemies & loot.
import * as THREE from 'three';
import { G } from './state.js';
import { makeRng } from './rng.js';
import { CELL, BOSS_FLOORS, PLATFORM_H, enemyPool, eliteChance, ARCHERS } from './config.js';
import { buildMergedStatic } from './assets.js';

export const SOLID = 0, FLOOR = 1, STAIRS = 3, TRAP = 4, OBSTACLE = 5, RAMP = 6;

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
  const elev = new Uint8Array(w * h);  // 1 = platform surface at y=4 above this cell
  const ramps = new Map();             // idx -> {dx,dy} ascending direction
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const inb = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  const idxOf = (x, y) => y * w + x;

  // ---- rooms ----
  const isBossFloor = !!BOSS_FLOORS[floor];
  const targetRooms = Math.min(6 + floor, 11);
  const rooms = [];
  for (let tries = 0; tries < 140 && rooms.length < targetRooms; tries++) {
    const rw = rng.int(4, 9), rh = rng.int(4, 9);
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

  // ---- corridors ----
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

  // ---- climbable platforms in large rooms ----
  // A 2-cell-deep raised strip along one wall, with a staircase up and rail barriers.
  const platforms = []; // {cells:[{x,y}], ramp:{x,y,dx,dy}, room}
  const eligible = rooms.filter(r => r !== spawnRoom && r !== exitRoom && r.w >= 6 && r.h >= 6);
  for (const r of rooms) {
    if (!eligible.includes(r)) continue;
    // always raise at least one structure per floor if any room can hold one
    const mustPlace = platforms.length === 0 && r === eligible[eligible.length - 1];
    if (!mustPlace && !rng.chance(0.65)) continue;
    const side = rng.pick(['N', 'S', 'W', 'E']);
    let strip = [], rampCell = null, rampDir = null;
    if (side === 'N' || side === 'S') {
      const rows = side === 'N' ? [r.y, r.y + 1] : [r.y + r.h - 1, r.y + r.h - 2];
      for (let x = r.x; x < r.x + r.w; x++) for (const y of rows) strip.push({ x, y });
      const rampX = rng.chance(0.5) ? r.x : r.x + r.w - 1;
      const rampY = side === 'N' ? r.y + 2 : r.y + r.h - 3;
      rampCell = { x: rampX, y: rampY };
      rampDir = { dx: 0, dy: side === 'N' ? -1 : 1 };
    } else {
      const cols = side === 'W' ? [r.x, r.x + 1] : [r.x + r.w - 1, r.x + r.w - 2];
      for (let y = r.y; y < r.y + r.h; y++) for (const x of cols) strip.push({ x, y });
      const rampY = rng.chance(0.5) ? r.y : r.y + r.h - 1;
      const rampX = side === 'W' ? r.x + 2 : r.x + r.w - 3;
      rampCell = { x: rampX, y: rampY };
      rampDir = { dx: side === 'W' ? -1 : 1, dy: 0 };
    }
    if (!inb(rampCell.x, rampCell.y) || at(rampCell.x, rampCell.y) !== FLOOR) continue;
    for (const c of strip) elev[idxOf(c.x, c.y)] = 1;
    set(rampCell.x, rampCell.y, RAMP);
    ramps.set(idxOf(rampCell.x, rampCell.y), rampDir);
    platforms.push({ cells: strip, ramp: { ...rampCell, ...rampDir }, room: r });
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

  // ---- portal exit ----
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
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    const sv = Array.isArray(scale) ? S.set(scale[0], scale[1], scale[2]) : S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), sv.clone());
    placements.push({ piece, matrix: M.clone() });
  };

  const floorVariants = ['floor_tile_large', 'floor_tile_large', 'floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_weeds_A', 'floor_tile_small_decorated', 'floor_tile_small_broken_B'];
  const torches = [];
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 },
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
    } else if (c === RAMP) {
      place('floor_tile_large', wx, 0, wz);
    } else {
      const fv = floorVariants[Math.floor(rng.next() * floorVariants.length)];
      if (fv.includes('small')) {
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const v = rng.chance(0.25) ? floorVariants[Math.floor(rng.next() * floorVariants.length)] : 'floor_tile_small';
          place(v.includes('small') ? v : 'floor_tile_small', wx + ox, 0, wz + oz, rng.int(0, 3) * Math.PI / 2);
        }
      } else {
        place(fv, wx, 0, wz, rng.int(0, 3) * Math.PI / 2);
      }
    }
    // walls on edges facing solid cells — two storeys high for first-person enclosure
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
      const roll = rng.next();
      const piece = roll < 0.8 ? 'wall' : roll < 0.93 ? 'wall_cracked' : 'wall_broken';
      place(piece, ex, 0, ez, d.yaw);
      const roll2 = rng.next();
      place(roll2 < 0.85 ? 'wall' : 'wall_cracked', ex, PLATFORM_H, ez, d.yaw);
      // torches on some walls
      torchStep++;
      if (torchStep % 5 === 0 && c !== STAIRS) {
        const inx = -d.dx, inz = -d.dy;
        const tyaw = Math.atan2(inx, inz);
        const ty = elev[idxOf(x, y)] ? PLATFORM_H + 2.3 : 2.3;
        place('torch_mounted', ex + inx * 0.1, ty, ez + inz * 0.1, tyaw);
        torches.push({ x: ex + inx * 0.5, y: ty + 0.85, z: ez + inz * 0.5 });
      }
    }
  }

  // ---- platform geometry: deck tiles, stairs, rails, support pillars ----
  for (const p of platforms) {
    const isPlat = (x, y) => x >= 0 && y >= 0 && x < w && y < h && elev[idxOf(x, y)] === 1;
    p.cells.forEach((c, ci) => {
      place('floor_tile_large', c.x * CELL, PLATFORM_H, c.y * CELL, rng.int(0, 3) * Math.PI / 2);
      // rails on open edges (skip the stairs entrance)
      for (const d of wallDirs) {
        const nx = c.x + d.dx, ny = c.y + d.dy;
        const nc = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
        if (nc === SOLID || isPlat(nx, ny)) continue;
        const isStairEntrance = (nx === p.ramp.x && ny === p.ramp.y);
        if (isStairEntrance) continue;
        place('barrier', c.x * CELL + d.dx * CELL / 2, PLATFORM_H, c.y * CELL + d.dy * CELL / 2, d.yaw);
      }
      // support pillars under the outer edge, every other cell
      if (ci % 2 === 0) {
        const exposed = wallDirs.some(d => { const nx = c.x + d.dx, ny = c.y + d.dy; return !isPlat(nx, ny) && (nx < 0 || ny < 0 || nx >= w || ny >= h ? false : at(nx, ny) !== SOLID); });
        if (exposed && at(c.x, c.y) === FLOOR) {
          place('pillar', c.x * CELL, 0, c.y * CELL);
          set(c.x, c.y, OBSTACLE);
        }
      }
    });
    // staircase: model top (local z=0) sits at the edge facing the platform
    const r = p.ramp;
    const topX = r.x * CELL + r.dx * CELL / 2, topZ = r.y * CELL + r.dy * CELL / 2;
    const yaw = Math.atan2(-r.dx, -r.dy);
    place('stairs', topX, 0, topZ, yaw, [0.8, PLATFORM_H / 5.1, 1]);
  }

  // ---- room decoration & obstacles ----
  const props = [];
  const propAt = (x, y) => props.find(p => p.cx === x && p.cy === y);
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    const isExit = r === exitRoom;
    const nProps = rng.int(1, 3);
    for (let i = 0; i < nProps; i++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      const onEdge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
      if (!onEdge || at(x, y) !== FLOOR || propAt(x, y) || elev[idxOf(x, y)]) continue;
      if (isExit && Math.abs(x - portal.x) + Math.abs(y - portal.y) < 2) continue;
      const kind = rng.pick(['barrel_large', 'box_large', 'crates_stacked', 'table_medium', 'barrel_small', 'shelf_small']);
      const yaw = rng.int(0, 3) * Math.PI / 2;
      place(kind, x * CELL, 0, y * CELL, yaw);
      if (kind === 'table_medium' && rng.chance(0.8)) place(rng.pick(['candle_lit', 'candle_triple', 'bottle_A_brown', 'bottle_B_brown']), x * CELL, 1.05, y * CELL, rng.next() * Math.PI * 2);
      set(x, y, OBSTACLE);
      props.push({ cx: x, cy: y });
    }
    if (r.w >= 6 && r.h >= 6) {
      for (const [px, py] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) {
        if (rng.chance(0.55) && at(px, py) === FLOOR && !propAt(px, py) && !elev[idxOf(px, py)]) {
          place(rng.chance(0.3) ? 'pillar_decorated' : 'pillar', px * CELL, 0, py * CELL);
          set(px, py, OBSTACLE);
          props.push({ cx: px, cy: py });
        }
      }
    }
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
  const pool = enemyPool(floor);
  const eChance = eliteChance(floor);
  for (const r of rooms) {
    if (r === spawnRoom) continue;
    const n = (r === exitRoom && isBossFloor) ? 1 : rng.int(2, Math.min(4, 2 + Math.floor(floor / 2)));
    for (let i = 0; i < n; i++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (at(x, y) !== FLOOR || elev[idxOf(x, y)]) continue;
      enemySpawns.push({ type: rng.pick(pool), x: x * CELL + rng.next() * 2 - 1, z: y * CELL + rng.next() * 2 - 1, y: 0, elite: rng.chance(eChance) });
    }
  }
  // archers guarding platforms
  for (const p of platforms) {
    const nA = rng.int(1, 2);
    for (let i = 0; i < nA; i++) {
      const c = rng.pick(p.cells);
      enemySpawns.push({ type: rng.pick(ARCHERS), x: c.x * CELL, z: c.y * CELL, y: PLATFORM_H, elite: rng.chance(eChance + 0.06) });
    }
  }
  if (isBossFloor) {
    enemySpawns.push({ type: BOSS_FLOORS[floor], x: exitRoom.cx * CELL, z: exitRoom.cy * CELL, y: 0 });
  }

  // ---- loot spawn list ----
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
  const nChests = Math.min(2 + Math.floor(floor / 2), 5);
  for (let i = 0; i < nChests && chestRooms.length; i++) {
    const r = rng.pick(chestRooms);
    const c = freeRoomCell(r);
    if (c) lootSpawns.push({ kind: 'chest', x: c.x * CELL, z: c.y * CELL, y: c.py, yaw: rng.next() * Math.PI * 2 });
  }
  // platform treasure: a chest + coins on each platform
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
  const nCoins = rng.int(7, 12);
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

  // portal glow
  const glowGeo = new THREE.PlaneGeometry(2.6, 3.4);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7718, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(portal.x * CELL + portal.dx * CELL / 2, 1.8, portal.y * CELL + portal.dy * CELL / 2);
  glow.rotation.y = wallDirs.find(d => d.dx === portal.dx && d.dy === portal.dy).yaw;
  floorGroup.add(glow);
  const plight = new THREE.PointLight(0xff8822, 18, 14, 1.6);
  plight.position.set(portal.x * CELL + portal.dx * (CELL / 2 - 0.6), 2.2, portal.y * CELL + portal.dy * (CELL / 2 - 0.6));
  floorGroup.add(plight);

  // ---- commit state ----
  G.grid = {
    w, h, cells, elev, ramps, rooms,
    spawn: { x: spawnRoom.cx * CELL, z: spawnRoom.cy * CELL },
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: isBossFloor,
  };
  G.explored = new Uint8Array(w * h);
  G.torches = torches;
  G.traps = traps.map(t => ({ ...t, cd: 0 }));

  return { enemySpawns, lootSpawns };
}

// ---- elevation ----
// Ground height under a point, given the mover's current y (so you can walk both
// under and on top of platforms).
export function groundHeightAt(x, z, curY = 0) {
  if (!G.grid) return 0;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return 0;
  const idx = cy * G.grid.w + cx;
  const ramp = G.grid.ramps.get(idx);
  if (ramp) {
    const s = Math.min(1, Math.max(0, (ramp.dx * (x - cx * CELL) + ramp.dy * (z - cy * CELL)) / CELL + 0.5));
    return s * PLATFORM_H;
  }
  if (G.grid.elev[idx]) return curY > PLATFORM_H * 0.6 ? PLATFORM_H : 0;
  return 0;
}

// ---- movement & collision ----
const cellBlocked = (x, z, y, ghost, ref) => {
  if (!G.grid) return true;
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return true;
  const c = G.grid.cells[cy * G.grid.w + cx];
  if (c === SOLID) return true;
  if (c === OBSTACLE && !ghost && y < 2.4) return true;
  const h = groundHeightAt(x, z, y);
  // can't walk up a ledge much taller than the local ground (ramps rise smoothly,
  // so measure against where we stand, with slack for the probe lookahead)
  if (h > ref + 1.3) return true;
  // platform rails: while elevated, the only way down is the staircase
  if (!ghost && y > 2.4 && c !== RAMP && h < y - 2) return true;
  return false;
};

export function moveWithCollision(pos, dx, dz, radius = 0.55, opts = {}) {
  const y = opts.y ?? pos.y ?? 0;
  const ghost = !!opts.ghost;
  const ref = Math.max(y, groundHeightAt(pos.x, pos.z, y));
  const tryAxis = (nx, nz) => {
    const checks = [
      [nx + radius, nz], [nx - radius, nz], [nx, nz + radius], [nx, nz - radius],
      [nx + radius * 0.7, nz + radius * 0.7], [nx - radius * 0.7, nz + radius * 0.7],
      [nx + radius * 0.7, nz - radius * 0.7], [nx - radius * 0.7, nz - radius * 0.7],
    ];
    return checks.every(([cx, cz]) => !cellBlocked(cx, cz, y, ghost, ref));
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
    const sx = x0 + (x1 - x0) * t, sz = z0 + (z1 - z0) * t;
    const cx = Math.round(sx / CELL), cy = Math.round(sz / CELL);
    if (cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return false;
    if (G.grid.cells[cy * G.grid.w + cx] === SOLID) return false;
  }
  return true;
}

// SECTORS — each area is its own BUILDING with its own construction grammar,
// not a reshuffle of the same rooms. Each generator here owns its geometry,
// its traversal style, and its mesh builder:
//   cargo    THE CONTAINER YARD  — one vast hall, climb the stacked canyons
//   security THE PANOPTICON      — circular prison, guard tower, cell rings
//   hab      HAB ROW             — a neon street of two-story homes you enter
//   engine   THE REACTOR SHAFT   — vertical: descend ring platforms round the core
//   weapons  THE LINE            — a linear factory gauntlet along the conveyor
// (spaceport keeps its hangar generator in ship.js; reactor 9 is the old god.)
//
// Multi-story is built from the collider engine: box colliders block bodies and
// bolts across their vertical span, and their TOPS are standable — so decks
// above decks, stairs (0.45 steps), parapets, and bridges all just work.
import * as THREE from 'three';
import { makeRng } from './rng.js';
import { CELL, ENEMIES } from './config.js';

const SOLID = 0, FLOOR = 1, STAIRS = 3;

// ---------------- per-sector identity: palette + atmosphere ----------------
export const SECTOR_THEMES = {
  cargo: {
    id: 'cargo', name: 'THE CONTAINER YARD', fog: 0x0d0b07, density: 0.005,
    hemi: 0xffe9c8, amb: 0xcdb48d, torch: 0xffb35c, accent: 0xffa028, boost: 1.85,
    tiles: [], props: [], banners: [], bias: [],
    pal: { floor: 0x54503f, wall: 0x6a6350, frame: 0x4a4436, boxes: [0xa8502e, 0x2e6ea8, 0x3f8a4a, 0xc9a23e, 0x8a4a8a, 0x777777] },
  },
  security: {
    id: 'security', name: 'THE PANOPTICON', fog: 0x0c0a14, density: 0.0055,
    hemi: 0xe8e2ff, amb: 0xb3aad8, torch: 0xb090ff, accent: 0x8a5cff, boost: 1.85,
    tiles: [], props: [], banners: [], bias: [],
    pal: { floor: 0x565064, wall: 0x8a8496, frame: 0x3f3a4c, boxes: [0x777788] },
  },
  hab: {
    id: 'hab', name: 'HAB ROW', fog: 0x07070c, density: 0.0075,
    hemi: 0xb8c2e4, amb: 0x8890b0, torch: 0xffd9a0, accent: 0x2fd6c8, boost: 1.55,
    tiles: [], props: [], banners: [], bias: [],
    pal: { floor: 0x3f4149, wall: 0x5c5f6c, frame: 0x33353d, boxes: [0x6a5c4a] },
    neon: [0xff4fa0, 0x4fe8e0, 0xffce2e, 0x8aff5c, 0xbb66ff],
  },
  engine: {
    id: 'engine', name: 'THE REACTOR SHAFT', fog: 0x120806, density: 0.006,
    hemi: 0xffd0b4, amb: 0xc49682, torch: 0xff8050, accent: 0xff4a1f, boost: 1.8,
    tiles: [], props: [], banners: [], bias: [],
    pal: { floor: 0x4a4442, wall: 0x57504c, frame: 0x3a3432, boxes: [0x6a5348] },
  },
  weapons: {
    id: 'weapons', name: 'THE LINE', fog: 0x0b0a08, density: 0.0055,
    hemi: 0xfff0d0, amb: 0xbcae92, torch: 0xffc35c, accent: 0xffa028, boost: 1.85,
    tiles: [], props: [], banners: [], bias: [],
    pal: { floor: 0x474540, wall: 0x5c5a52, frame: 0x38362f, boxes: [0x6e6458] },
  },
};

// ---------------- shared toolkit ----------------
function baseGrid(w, h, id) {
  return {
    w, h,
    cells: new Uint8Array(w * h),
    elev: new Uint8Array(w * h),
    ramps: new Map(),
    colliders: [],
    gravlifts: [],
    rooms: [],
    stairsLocked: true,
    sector: id,
    ship: { deckType: id }, // ship-tech systems (shock plates etc.) key off this
  };
}

function baseFs(grid, theme, sectorId) {
  return {
    grid, torches: [], traps: [], ropes: [], placements: [],
    enemySpawns: [], lootSpawns: [], npcs: [],
    explored: new Uint8Array(grid.w * grid.h), hadBoss: false,
    theme, mutator: null, layoutId: 'sector:' + sectorId, sectorId,
    doors: [], homes: [], interiors: [],
  };
}

// a stair run: dir (dx,dz unit), climbs `rise` over `run` world units.
// Emits step colliders (walkable tops) — the ground snap climbs 0.45 steps free.
function stairs(grid, x0, z0, dx, dz, rise, width = 2.4) {
  const steps = Math.ceil(rise / 0.45);
  const stepLen = Math.max(0.62, (rise / 0.45) > 14 ? 0.62 : 0.8);
  for (let i = 0; i < steps; i++) {
    const cx = x0 + dx * (i + 0.5) * stepLen;
    const cz = z0 + dz * (i + 0.5) * stepLen;
    grid.colliders.push({
      x: cx, z: cz,
      hx: Math.abs(dx) ? stepLen / 2 + 0.05 : width / 2,
      hz: Math.abs(dz) ? stepLen / 2 + 0.05 : width / 2,
      y0: 0, h: (i + 1) * (rise / steps), noMesh: true, stair: true,
    });
  }
  return steps * stepLen; // horizontal length used
}

// a walkable deck slab with a thin body: stand on top, walk under it
function deck(grid, x, z, hx, hz, top, thick = 0.4) {
  grid.colliders.push({ x, z, hx, hz, y0: top - thick, h: top, noMesh: true, deck: true });
}

// a wall segment across a vertical span
function wall3(grid, x, z, hx, hz, y0, h) {
  grid.colliders.push({ x, z, hx, hz, y0, h, noMesh: true, wall: true });
}

function lift(grid, x, z, top) {
  grid.gravlifts.push({ x, z, top, seed: Math.random() });
}

// ---------------- mesh toolkit (merged buckets per material) ----------------
function meshKit(pal, accent) {
  const mats = {
    floor: new THREE.MeshStandardMaterial({ color: pal.floor, metalness: 0.25, roughness: 0.85 }),
    wall: new THREE.MeshStandardMaterial({ color: pal.wall, metalness: 0.3, roughness: 0.75 }),
    frame: new THREE.MeshStandardMaterial({ color: pal.frame, metalness: 0.4, roughness: 0.7 }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: new THREE.Color(accent), emissiveIntensity: 1.6, toneMapped: false, roughness: 1,
    }),
    panel: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xd9ecf6, emissiveIntensity: 1.2, roughness: 1 }),
  };
  for (const [i, c] of (pal.boxes || []).entries()) {
    mats['box' + i] = new THREE.MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.8 });
  }
  const buckets = new Map();
  const add = (key, geo, x, y, z, ry = 0) => {
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(geo);
  };
  const box = (key, x, y, z, sx, sy, sz, ry = 0) => add(key, new THREE.BoxGeometry(sx, sy, sz), x, y, z, ry);
  const finish = (group) => {
    for (const [key, geos] of buckets) {
      const merged = mergeGeometriesCompat(geos, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mats[key] || mats.wall);
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    return group;
  };
  return { mats, add, box, finish };
}

// three r165 exposes mergeGeometries via addons — inline the import lazily
import { mergeGeometries as mergeGeometriesCompat } from 'three/addons/utils/BufferGeometryUtils.js';

// grav-lift visuals matching the deck ones (disc rides via userData.gravlift)
function liftVisual(group, kit, gl) {
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.85, gl.top + 0.3, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4fe8e0, transparent: true, opacity: 0.09, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.set(gl.x, (gl.top + 0.3) / 2, gl.z);
  group.add(beam);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.7, 0.28, 12), kit.mats.frame);
  disc.position.set(gl.x, 0.04, gl.z);
  disc.userData.gravlift = gl;
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(1.93, 1.93, 0.12, 12, 1, true), kit.mats.accent);
  edge.position.y = 0.05;
  disc.add(edge);
  group.add(disc);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.08, 12, 1, true), kit.mats.accent);
  ring.position.set(gl.x, gl.top + 0.12, gl.z);
  group.add(ring);
}

// extraction pad: physical frame; dungeon.js adds the portal glow/light itself
function extractionPad(kit, x, z, y = 0) {
  kit.box('frame', x - 2.1, y + 3.2, z, 0.8, 6.4, 0.8);
  kit.box('frame', x + 2.1, y + 3.2, z, 0.8, 6.4, 0.8);
  kit.box('frame', x, y + 6.0, z, 5.0, 0.7, 0.8);
  kit.box('accent', x, y + 5.6, z, 4.4, 0.14, 0.5);
  kit.box('accent', x, y + 0.02, z, 3.2, 0.03, 3.2);
}

// stair + deck + wall visual pass: draw meshes for the tagged colliders
function drawStructural(kit, grid) {
  for (const c of grid.colliders) {
    if (c.stair) kit.box('frame', c.x, (c.y0 + c.h) / 2 + (c.h - c.y0) * 0, c.z, c.hx * 2, c.h, c.hz * 2);
    else if (c.deck) {
      kit.box('floor', c.x, c.h - 0.2, c.z, c.hx * 2, 0.4, c.hz * 2);
      kit.box('accent', c.x, c.h - 0.42, c.z, c.hx * 2 * 0.9, 0.06, 0.12);
    } else if (c.wall) kit.box('wall', c.x, (c.y0 + c.h) / 2, c.z, c.hx * 2, c.h - c.y0, c.hz * 2);
  }
}

function railing(kit, x, z, hx, hz, y) {
  kit.box('frame', x, y + 0.55, z, hx * 2, 0.1, hz * 2 || 0.1);
  kit.box('accent', x, y + 1.1, z, hx * 2, 0.08, Math.max(hz * 2, 0.08));
}

// enemy spawn helper (y = which surface they hold)
function foes(fs, list) {
  for (const [type, x, z, y = 0, elite = false] of list) {
    if (!ENEMIES[type]) continue;
    fs.enemySpawns.push({ type, x, z, y, elite });
  }
}

// ==================================================================
// 1. CARGO — THE CONTAINER YARD
// ==================================================================
function genCargo(seed) {
  const rng = makeRng(seed + ':yard');
  const W = 44, H = 34, CEIL = 18;
  const theme = SECTOR_THEMES.cargo;
  const grid = baseGrid(W, H, 'cargo');
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) grid.cells[y * W + x] = FLOOR;
  const fs = baseFs(grid, theme, 'cargo');
  grid.ceil = CEIL;

  // container stacks: 2x1-cell crates, 1-3 high — the canyons you climb
  const stacks = [];
  const CH = 3.2; // container height
  const taken = new Set();
  for (let i = 0; i < 34; i++) {
    const cx = 3 + rng.int(0, W - 8), cy = 3 + rng.int(0, H - 7);
    const horiz = rng.chance(0.5);
    const k = `${Math.floor(cx / 3)},${Math.floor(cy / 3)}`;
    if (taken.has(k)) continue;
    taken.add(k);
    const tall = rng.chance(0.55) ? (rng.chance(0.4) ? 3 : 2) : 1;
    const x = cx * CELL, z = cy * CELL;
    const hx = horiz ? CELL : CELL / 2, hz = horiz ? CELL / 2 : CELL;
    grid.colliders.push({ x, z, hx, hz, y0: 0, h: tall * CH, noMesh: true });
    stacks.push({ x, z, hx, hz, tall, tone: rng.int(0, theme.pal.boxes.length - 1), horiz });
    // crate-stairs up one flank of tall stacks — climbable without a lift
    if (tall >= 2 && rng.chance(0.55)) {
      stairs(grid, x + (horiz ? hx + 0.4 : hx + 0.4), z - (horiz ? 0 : hz + 0.2), horiz ? 1 : 1, 0, Math.min(tall, 2) * CH, 1.8);
    }
  }
  grid.stacks = stacks;
  // grav lifts up to the high stacks (three, spread out)
  const talls = stacks.filter(s => s.tall >= 2);
  for (let i = 0; i < Math.min(3, talls.length); i++) {
    const s = talls[Math.floor(i * talls.length / 3)];
    lift(grid, s.x + s.hx + 2.2, s.z, s.tall * CH);
  }
  // overhead crane rails (visual) + a perimeter catwalk on the north wall
  const catY = 6.4;
  deck(grid, (W / 2) * CELL - CELL, 2 * CELL, (W / 2 - 3) * CELL, CELL * 0.5, catY);
  stairs(grid, 4 * CELL, 2.6 * CELL + 2, 1, 0, catY);
  lift(grid, (W - 5) * CELL, 2 * CELL, catY);

  grid.spawn = { x: 3 * CELL, z: (H - 4) * CELL };
  grid.spawnYaw = Math.PI * 0.75;
  // extraction: on TOP of a far double-stack — you must climb out
  let far = stacks[0];
  for (const s of stacks) {
    if (s.tall === 2 && (s.x + s.z) > (far.x + far.z)) far = s;
  }
  if (far.tall < 2) { far.tall = 2; }
  const ex = Math.round(far.x / CELL), ez = Math.round(far.z / CELL);
  grid.cells[ez * W + ex] = STAIRS;
  grid.stairs = { x: far.x, z: far.z, cx: ex, cy: ez, y: far.tall * CH };
  grid.portal = { dx: 0, dy: 1, yaw: 0 };
  lift(grid, far.x - far.hx - 2.2, far.z, far.tall * CH);

  foes(fs, [
    ['warrior', 8 * CELL, 8 * CELL], ['warrior', 30 * CELL, 20 * CELL],
    ['orcwar', 14 * CELL, 26 * CELL], ['orcwar', 36 * CELL, 8 * CELL],
    ['mage', 22 * CELL, 14 * CELL], ['mage', 12 * CELL, 18 * CELL],
    ['brute', 28 * CELL, 28 * CELL], ['goblin', 18 * CELL, 22 * CELL],
    ['sniper', talls[0] ? talls[0].x : 20 * CELL, talls[0] ? talls[0].z : 20 * CELL, talls[0] ? talls[0].tall * CH : 0],
    ['sniper', (W / 2) * CELL, 2 * CELL, catY],
    ['imp', 24 * CELL, 10 * CELL, 5], ['slime', 10 * CELL, 12 * CELL],
  ]);
  fs.lootSpawns.push({ kind: 'chest', x: 6 * CELL, z: 6 * CELL }, { kind: 'chest', x: (W - 8) * CELL, z: (H - 6) * CELL });
  return fs;
}

function buildCargo(fs) {
  const g = fs.grid, theme = fs.theme;
  const group = new THREE.Group();
  const kit = meshKit(theme.pal, theme.accent);
  const W = g.w * CELL, H = g.h * CELL, CEIL = g.ceil;
  // shell: painted deck floor, ribbed walls, high roof with skylight panels
  kit.box('floor', W / 2 - CELL / 2, -0.11, H / 2 - CELL / 2, W, 0.22, H);
  for (const [wx, wz, sx, sz] of [[W / 2, 0, W, 1], [W / 2, H - CELL, W, 1], [0, H / 2, 1, H], [W - CELL, H / 2, 1, H]]) {
    kit.box('wall', wx - CELL / 2, CEIL / 2, wz - CELL / 2, sx === 1 ? 1.2 : sx, CEIL, sz === 1 ? 1.2 : sz);
    kit.box('accent', wx - CELL / 2, 2.6, wz - CELL / 2, sx === 1 ? 0.3 : sx * 0.95, 0.16, sz === 1 ? 0.3 : sz * 0.95);
  }
  kit.box('frame', W / 2 - CELL / 2, CEIL + 0.2, H / 2 - CELL / 2, W, 0.4, H);
  for (let i = 0; i < 8; i++) kit.box('panel', (4 + i * 5.4) * CELL, CEIL - 0.05, H / 2, 8, 0.1, 10);
  // the stacks: colored containers with rib frames + stripes
  for (const s of g.stacks) {
    for (let lvl = 0; lvl < s.tall; lvl++) {
      const y = lvl * 3.2;
      kit.box('box' + ((s.tone + lvl) % theme.pal.boxes.length), s.x, y + 1.6, s.z, s.hx * 2 - 0.15, 3.05, s.hz * 2 - 0.15);
      kit.box('frame', s.x, y + 0.12, s.z, s.hx * 2, 0.24, s.hz * 2);
      kit.box('frame', s.x, y + 3.1, s.z, s.hx * 2, 0.2, s.hz * 2);
      kit.box('accent', s.x + (s.horiz ? 0 : s.hx - 0.02), y + 2.3, s.z + (s.horiz ? s.hz - 0.02 : 0),
        s.horiz ? s.hx * 1.2 : 0.06, 0.14, s.horiz ? 0.06 : s.hz * 1.2);
    }
  }
  // crane rails overhead + a hanging hook
  for (const rz of [H * 0.33, H * 0.66]) {
    kit.box('frame', W / 2 - CELL / 2, CEIL - 2.2, rz, W - 8, 1.0, 1.4);
    kit.box('frame', W * 0.4, CEIL - 5.2, rz, 0.3, 6, 0.3);
    kit.box('accent', W * 0.4, CEIL - 8.4, rz, 1.2, 0.5, 1.2);
  }
  drawStructural(kit, g);
  extractionPad(kit, g.stairs.x, g.stairs.z, g.stairs.y || 0);
  kit.finish(group);
  for (const gl of g.gravlifts) liftVisual(group, kit, gl);
  // warm high bay lights
  for (let i = 0; i < 6; i++) {
    for (const lz of [H * 0.3, H * 0.7]) {
      const pl = new THREE.PointLight(0xffd9a0, 60, 70, 1.4);
      pl.position.set((5 + i * 7) * CELL, CEIL - 3, lz);
      group.add(pl);
    }
  }
  return group;
}

// ==================================================================
// 2. SECURITY — THE PANOPTICON
// ==================================================================
function genSecurity(seed) {
  const rng = makeRng(seed + ':pan');
  const W = 33, H = 33, C = 16, R = 14.5;
  const theme = SECTOR_THEMES.security;
  const grid = baseGrid(W, H, 'security');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x - C) ** 2 + (y - C) ** 2 <= R * R) grid.cells[y * W + x] = FLOOR;
  }
  const fs = baseFs(grid, theme, 'security');
  grid.ceil = 14;
  const cw = C * CELL;

  // CENTRAL GUARD TOWER: round, solid below, platform on top at 8
  const towerR = 8.5;
  grid.colliders.push({ x: cw, z: cw, r: towerR, y0: 0, h: 7.6, noMesh: true }); // tower body
  deck(grid, cw, cw, towerR + 1.6, towerR + 1.6, 8); // tower top (square deck approximates)
  // parapet
  wall3(grid, cw, cw - towerR - 1.4, towerR + 1.6, 0.3, 8, 9.1);
  wall3(grid, cw, cw + towerR + 1.4, towerR + 1.6, 0.3, 8, 9.1);
  wall3(grid, cw - towerR - 1.4, cw, 0.3, towerR + 1.6, 8, 9.1);
  wall3(grid, cw + towerR + 1.4, cw, 0.3, towerR + 1.6, 8, 9.1);

  // GALLERY RING at 8u around the perimeter, 2 cells wide (walk the wall)
  const galInner = (R - 3.4) * CELL, galOuter = (R - 0.8) * CELL;
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const rMid = (galInner + galOuter) / 2;
    const x = cw + Math.cos(a) * rMid, z = cw + Math.sin(a) * rMid;
    deck(grid, x, z, 5.6, 5.6, 8);
  }
  // BRIDGES tower -> gallery at 8u (N,S,E,W)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = (galInner - towerR) / 2 + 2;
    const x = cw + dx * (towerR + len), z = cw + dz * (towerR + len);
    deck(grid, x, z, Math.abs(dx) ? len + 2 : 1.4, Math.abs(dz) ? len + 2 : 1.4, 8);
  }
  // stairs: two wide runs from floor up to the gallery + one lift to the tower
  stairs(grid, cw + galInner - 2, cw - 2.4, -1, 0, 8);
  stairs(grid, cw - galInner + 2, cw + 2.4, 1, 0, 8);
  lift(grid, cw + towerR + 3.4, cw + towerR + 3.4, 8);

  // ground-story CELL BLOCKS around the rim: bar walls with gaps (visual bars in builder)
  grid.cellsRing = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.12;
    const r = (R - 1.9) * CELL;
    const x = cw + Math.cos(a) * r, z = cw + Math.sin(a) * r;
    grid.cellsRing.push({ x, z, a });
    if (i % 3 !== 0) { // barred: collider blocks the alcove mouth
      wall3(grid, cw + Math.cos(a) * (r - 3), cw + Math.sin(a) * (r - 3), 1.7, 0.25, 0, 3.4);
    }
  }

  grid.spawn = { x: cw, z: cw + (R - 4) * CELL };
  grid.spawnYaw = Math.PI;
  // extraction: inside the tower's ground chamber (fight your way to the middle)
  grid.cells[C * W + C] = STAIRS;
  grid.stairs = { x: cw, z: cw - towerR + 2.2, cx: C, cy: C - 2 };
  grid.portal = { dx: 0, dy: -1, yaw: 0 };
  // tower door gaps: south entrance (carve by shrinking body: overlap-free door via two arc walls is complex —
  // instead the tower body collider is a ring of 4 boxes with a south gap)
  grid.colliders = grid.colliders.filter(c => !(c.r === towerR));
  const tb = towerR;
  wall3(grid, cw - tb + 1.2, cw, 1.4, tb, 0, 7.6);
  wall3(grid, cw + tb - 1.2, cw, 1.4, tb, 0, 7.6);
  wall3(grid, cw, cw - tb + 1.2, tb, 1.4, 0, 7.6);
  wall3(grid, cw - 4.4, cw + tb - 1.2, tb - 5.4, 1.4, 0, 7.6); // south wall, door gap at center
  wall3(grid, cw + 4.4, cw + tb - 1.2, tb - 5.4, 1.4, 0, 7.6);

  foes(fs, [
    ['warrior', cw - 20, cw + 12], ['warrior', cw + 22, cw - 10],
    ['shade', cw - 30, cw - 24], ['shade', cw + 30, cw + 26],
    ['sniper', cw + galInner - 6, cw, 8], ['sniper', cw - galInner + 6, cw, 8],
    ['mage', cw, cw - galInner + 6, 8],
    ['juggernaut', cw, cw + 14], ['necromancer', cw - 12, cw - 16],
    ['rogue', cw + 16, cw + 18], ['rogue', cw - 18, cw + 4],
  ]);
  fs.lootSpawns.push({ kind: 'chest', x: cw + (R - 2.5) * CELL, z: cw }, { kind: 'chest', x: cw, z: cw - (R - 2.5) * CELL });
  return fs;
}

function buildSecurity(fs) {
  const g = fs.grid, theme = fs.theme;
  const group = new THREE.Group();
  const kit = meshKit(theme.pal, theme.accent);
  const C = 16, R = 14.5, cw = C * CELL, CEIL = g.ceil;
  // cylindrical shell: floor disc, wall ring, roof
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2, R * CELL + 2, 0.22, 48), kit.mats.floor);
  fl.position.set(cw, -0.11, cw);
  group.add(fl);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2.4, R * CELL + 2.4, CEIL, 48, 1, true), kit.mats.wall);
  shell.material.side = THREE.BackSide;
  shell.position.set(cw, CEIL / 2, cw);
  group.add(shell);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2.4, R * CELL + 2.4, 0.4, 48), kit.mats.frame);
  roof.position.set(cw, CEIL + 0.2, cw);
  group.add(roof);
  // accent rings on the shell wall
  for (const y of [2.6, 8.9]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2.1, R * CELL + 2.1, 0.16, 48, 1, true), kit.mats.accent);
    ring.position.set(cw, y, cw);
    group.add(ring);
  }
  // THE TOWER: cylinder with a lit observation band + roof spotlight housing
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 9.2, 7.6, 24, 1, true), kit.mats.wall);
  tower.position.set(cw, 3.8, cw);
  group.add(tower);
  const obs = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 0.9, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xbb99ff, toneMapped: false }));
  obs.position.set(cw, 6.6, cw);
  group.add(obs);
  const spot = new THREE.SpotLight(0xd8c8ff, 400, 80, 0.5, 0.4);
  spot.position.set(cw, 12, cw);
  spot.target.position.set(cw + 30, 0, cw + 20);
  group.add(spot, spot.target);
  // ground cell blocks: alcove frames + BARS
  for (const cell of g.cellsRing) {
    const { x, z, a } = cell;
    const ry = -a + Math.PI / 2;
    kit.box('frame', x, 1.9, z, 4.2, 3.8, 3.4, ry);
    // hollow: dark inner face
    kit.box('floor', x, 1.75, z, 3.6, 3.2, 2.8, ry);
    // bars across the mouth (toward center)
    const bx = cw + Math.cos(a) * ((R - 1.9) * CELL - 3.1);
    const bz = cw + Math.sin(a) * ((R - 1.9) * CELL - 3.1);
    for (let b = -1.3; b <= 1.31; b += 0.52) {
      kit.box('frame', bx + Math.cos(a + Math.PI / 2) * b, 1.7, bz + Math.sin(a + Math.PI / 2) * b, 0.09, 3.4, 0.09);
    }
    kit.box('accent', bx, 3.3, bz, 1.2, 0.1, 0.1, ry);
  }
  drawStructural(kit, g);
  // gallery rail (inner edge)
  const rail = new THREE.Mesh(new THREE.CylinderGeometry((R - 3.6) * CELL, (R - 3.6) * CELL, 0.1, 40, 1, true), kit.mats.accent);
  rail.position.set(cw, 9.1, cw);
  group.add(rail);
  extractionPad(kit, g.stairs.x, g.stairs.z, 0);
  kit.finish(group);
  for (const gl of g.gravlifts) liftVisual(group, kit, gl);
  const pl = new THREE.PointLight(0xcabfff, 90, 110, 1.5);
  pl.position.set(cw, CEIL - 2, cw);
  group.add(pl);
  for (let i = 0; i < 6; i++) {
    const a2 = (i / 6) * Math.PI * 2;
    const wl = new THREE.PointLight(0xd8ccff, 26, 40, 1.6);
    wl.position.set(cw + Math.cos(a2) * (R - 2.5) * CELL, 6, cw + Math.sin(a2) * (R - 2.5) * CELL);
    group.add(wl);
  }
  return group;
}

// ==================================================================
// 3. HAB — HAB ROW (the neon street)
// ==================================================================
function neonTex(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, 256, 96);
  ctx.font = 'bold 40px Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.shadowColor = color; ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 62);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function genHab(seed) {
  const rng = makeRng(seed + ':row');
  const W = 46, H = 26;
  const theme = SECTOR_THEMES.hab;
  const grid = baseGrid(W, H, 'hab');
  const fs = baseFs(grid, theme, 'hab');
  grid.ceil = 12;
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) grid.cells[y * W + x] = v; };

  // S-street: seg1 rows 16-19 (x 2..20), plaza (x 20..27, y 8..19), seg2 rows 6-9 (x 27..44)
  for (let x = 2; x <= 20; x++) for (let y = 16; y <= 19; y++) set(x, y, FLOOR);
  for (let x = 20; x <= 27; x++) for (let y = 7; y <= 19; y++) set(x, y, FLOOR);
  for (let x = 27; x <= 44; x++) for (let y = 6; y <= 9; y++) set(x, y, FLOOR);

  // HOMES: units along both sides of each straight segment.
  // A unit = 3x3 interior carved off the street + door gap + furniture collider.
  grid.units = [];
  const unit = (ux, uy, doorSide) => { // doorSide: 0 = door faces +y street, 1 = faces -y
    for (let y = uy; y < uy + 3; y++) for (let x = ux; x < ux + 3; x++) set(x, y, FLOOR);
    const doorX = (ux + 1) * CELL, doorY = doorSide ? uy * CELL - CELL / 2 : (uy + 3) * CELL - CELL / 2;
    // facade walls with the door gap (colliders; visuals in builder)
    const fz = doorSide ? uy * CELL - CELL / 2 : (uy + 2) * CELL + CELL / 2;
    wall3(grid, (ux) * CELL - 0.9, fz, 1.1, 0.35, 0, 4.2);
    wall3(grid, (ux + 2) * CELL + 0.9, fz, 1.1, 0.35, 0, 4.2);
    grid.units.push({ ux, uy, doorSide, tone: rng.int(0, 4), name: rng.pick(['NOODLE-9', 'VOID BAR', 'HAB 7-C', 'PARTS+', 'ORBIT CUTS', 'STIM STOP', 'BUNK 12', 'K-KIOSK']) });
    // furniture: a bunk + a table
    grid.colliders.push({ x: (ux + 0.6) * CELL, z: (uy + 1.4) * CELL, hx: 1.4, hz: 0.8, y0: 0, h: 0.85, noMesh: true });
    if (rng.chance(0.5)) fs.lootSpawns.push({ kind: 'chest', x: (ux + 2) * CELL, z: (uy + 1) * CELL });
  };
  for (let i = 0; i < 5; i++) unit(3 + i * 4, 13, 0);   // seg1 north side (doors face street below)
  for (let i = 0; i < 4; i++) unit(4 + i * 4, 20, 1);   // seg1 south side
  for (let i = 0; i < 4; i++) unit(28 + i * 4, 3, 0);   // seg2 north side
  for (let i = 0; i < 4; i++) unit(28 + i * 4, 10, 1);  // seg2 south side

  // BALCONY level: a continuous 4.4u walkway over the north facades w/ stairs
  deck(grid, 11.5 * CELL, 15.4 * CELL, 9.5 * CELL, CELL * 0.55, 4.4);
  stairs(grid, 3 * CELL, 16.6 * CELL, 1, 0, 4.4);
  deck(grid, 35.5 * CELL, 5.4 * CELL, 8.5 * CELL, CELL * 0.55, 4.4);
  stairs(grid, 28.6 * CELL, 6.6 * CELL, 1, 0, 4.4);

  grid.spawn = { x: 3 * CELL, z: 17.5 * CELL };
  grid.spawnYaw = -Math.PI / 2;
  grid.cells[8 * W + 43] = STAIRS;
  grid.stairs = { x: 43 * CELL, z: 8 * CELL, cx: 43, cy: 8 };
  grid.portal = { dx: 1, dy: 0, yaw: Math.PI / 2 };

  foes(fs, [
    ['shade', 8 * CELL, 17 * CELL], ['shade', 24 * CELL, 12 * CELL],
    ['ghost', 30 * CELL, 8 * CELL], ['ghost', 14 * CELL, 18 * CELL],
    ['orcwar', 22 * CELL, 16 * CELL], ['orcwar', 36 * CELL, 7 * CELL],
    ['rogue', 10 * CELL, 13 * CELL], ['rogue', 32 * CELL, 4 * CELL],
    ['sniper', 12 * CELL, 15 * CELL, 4.4], ['sniper', 38 * CELL, 5 * CELL, 4.4],
    ['berserker', 24 * CELL, 9 * CELL], ['slime', 20 * CELL, 18 * CELL],
  ]);
  return fs;
}

function buildHab(fs) {
  const g = fs.grid, theme = fs.theme;
  const group = new THREE.Group();
  const kit = meshKit(theme.pal, theme.accent);
  const W = g.w * CELL, H = g.h * CELL, CEIL = g.ceil;
  // street floor + dark high ceiling (night sky of a ring station)
  for (let cy = 0; cy < g.h; cy++) for (let cx = 0; cx < g.w; cx++) {
    if (g.cells[cy * g.w + cx] === SOLID) continue;
    kit.box('floor', cx * CELL, -0.11, cy * CELL, CELL, 0.22, CELL);
  }
  kit.box('frame', W / 2, CEIL + 0.2, H / 2, W, 0.4, H);
  // facades: two-story fronts around every unit + neon sign over the door
  for (const u of g.units) {
    const x0 = u.ux * CELL, z0 = u.uy * CELL;
    const fz = u.doorSide ? z0 - CELL / 2 : z0 + 2 * CELL + CELL / 2;
    // two-story face with window band
    kit.box('wall', x0 + CELL, 5.6, fz, 3 * CELL, 3.2, 0.5);
    kit.box('panel', x0 + CELL, 5.4, fz + (u.doorSide ? -0.28 : 0.28), 2.2 * CELL, 0.9, 0.06);
    // door frame
    kit.box('frame', x0 + CELL - 1.6, 1.6, fz, 0.4, 3.2, 0.7);
    kit.box('frame', x0 + CELL + 1.6, 1.6, fz, 0.4, 3.2, 0.7);
    kit.box('frame', x0 + CELL, 3.3, fz, 3.6, 0.4, 0.7);
    // interior: side walls + back wall + ceiling at 4.2
    kit.box('wall', x0 - CELL / 2 - 0.2, 2.1, z0 + CELL, 0.4, 4.2, 3 * CELL);
    kit.box('wall', x0 + 2 * CELL + CELL / 2 + 0.2, 2.1, z0 + CELL, 0.4, 4.2, 3 * CELL);
    const bz = u.doorSide ? z0 + 2 * CELL + CELL / 2 : z0 - CELL / 2;
    kit.box('wall', x0 + CELL, 2.1, bz, 3 * CELL, 4.2, 0.4);
    kit.box('frame', x0 + CELL, 4.3, z0 + CELL, 3 * CELL + 0.6, 0.25, 3 * CELL + 0.6);
    // bunk + shade
    kit.box('box0', x0 + 0.6 * CELL, 0.45, z0 + 1.4 * CELL, 2.8, 0.9, 1.6);
    // NEON: sign plane over the door
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.25),
      new THREE.MeshBasicMaterial({ map: neonTex(u.name, '#' + theme.neon[u.tone].toString(16).padStart(6, '0')), transparent: true, toneMapped: false }));
    neon.position.set(x0 + CELL, 4.4, fz + (u.doorSide ? -0.4 : 0.4));
    if (u.doorSide) neon.rotation.y = Math.PI;
    group.add(neon);
    const nl = new THREE.PointLight(theme.neon[u.tone], 18, 14, 1.6);
    nl.position.set(x0 + CELL, 4.2, fz + (u.doorSide ? -1.6 : 1.6));
    group.add(nl);
    // a warm bulb inside every unit
    const il = new THREE.PointLight(0xffe4b8, 10, 9, 1.7);
    il.position.set(x0 + CELL, 3.4, z0 + CELL);
    group.add(il);
  }
  // plaza: mess tables + a kiosk
  for (const [tx, tz] of [[22, 12], [25, 15], [22, 17]]) {
    kit.box('frame', tx * CELL, 0.55, tz * CELL, 2.6, 0.14, 1.2);
    kit.box('frame', tx * CELL, 0.28, tz * CELL, 0.3, 0.56, 0.3);
  }
  kit.box('wall', 24 * CELL, 1.5, 9 * CELL, 4, 3, 3);
  kit.box('accent', 24 * CELL, 3.15, 9 * CELL, 4.2, 0.14, 3.2);
  drawStructural(kit, g);
  extractionPad(kit, g.stairs.x, g.stairs.z, 0);
  kit.finish(group);
  for (const gl of g.gravlifts) liftVisual(group, kit, gl);
  // dim street lamps
  for (const [lx, lz] of [[5, 17.5], [10, 17.5], [15, 17.5], [20, 17.5], [23.5, 13], [23.5, 9],
    [29, 7.5], [34, 7.5], [39, 7.5], [43, 7.5]]) {
    const pl = new THREE.PointLight(0xffe4b8, 26, 26, 1.5);
    pl.position.set(lx * CELL, 5.2, lz * CELL);
    group.add(pl);
    kit.box('frame', lx * CELL, 2.6, lz * CELL, 0.18, 5.2, 0.18);
    kit.box('panel', lx * CELL, 5.3, lz * CELL, 0.7, 0.3, 0.7);
  }
  return group;
}

// ==================================================================
// 4. ENGINE — THE REACTOR SHAFT (vertical descent)
// ==================================================================
function genEngine(seed) {
  const rng = makeRng(seed + ':shaft');
  const W = 27, H = 27, C = 13, R = 12;
  const theme = SECTOR_THEMES.engine;
  const grid = baseGrid(W, H, 'engine');
  // the BOTTOM floor is the cell footprint
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if ((x - C) ** 2 + (y - C) ** 2 <= R * R) grid.cells[y * W + x] = FLOOR;
  }
  const fs = baseFs(grid, theme, 'engine');
  const cw = C * CELL;
  grid.ceil = 30;
  grid.shaft = { cw, R };

  // THE CORE: central column, full height — hot, solid
  grid.colliders.push({ x: cw, z: cw, r: 7.5, y0: 0, h: 30, noMesh: true });

  // RINGS at 22 (entry), 14.5, 7 — annulus decks around the core
  const rings = [22, 14.5, 7];
  grid.rings = rings;
  const segs = 22;
  for (const ry of rings) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const rMid = (7.5 + (R - 1.6) * CELL) / 2 + 4.5;
      const x = cw + Math.cos(a) * rMid, z = cw + Math.sin(a) * rMid;
      deck(grid, x, z, 6.4, 6.4, ry);
    }
    // inner railing ring is visual; outer edge = the shaft wall
  }
  // grav lifts BETWEEN rings, alternating sides (down is free — just step off)
  lift(grid, cw + (R - 3.4) * CELL, cw, 22);
  lift(grid, cw - (R - 3.4) * CELL, cw, 14.5);
  lift(grid, cw, cw + (R - 3.4) * CELL, 7);

  grid.spawn = { x: cw + (R - 4) * CELL, z: cw - 6 };
  grid.spawnY = 22;
  grid.spawnYaw = Math.PI / 2;
  // extraction: at the BOTTOM beside the core base
  const ex = C, ez = C + 5;
  grid.cells[ez * W + ex] = STAIRS;
  grid.stairs = { x: cw, z: (C + 5) * CELL, cx: ex, cy: ez };
  grid.portal = { dx: 0, dy: 1, yaw: 0 };

  const ringR = (7.5 + (R - 1.6) * CELL) / 2 + 4.5;
  foes(fs, [
    ['warrior', cw + ringR, cw, 22], ['mage', cw - ringR, cw, 22],
    ['warrior', cw, cw + ringR, 14.5], ['sniper', cw, cw - ringR, 14.5], ['imp', cw + ringR * 0.7, cw + ringR * 0.7, 16],
    ['brute', cw - ringR * 0.7, cw - ringR * 0.7, 7], ['mage', cw + ringR, cw, 7], ['imp', cw - 10, cw + 10, 9],
    ['juggernaut', cw + 14, cw + 16, 0], ['necromancer', cw - 16, cw - 10, 0],
    ['slime', cw + 8, cw - 18, 0], ['berserker', cw - 20, cw + 6, 0],
  ]);
  fs.lootSpawns.push({ kind: 'chest', x: cw - (R - 3) * CELL, z: cw });
  return fs;
}

function buildEngine(fs) {
  const g = fs.grid, theme = fs.theme;
  const group = new THREE.Group();
  const kit = meshKit(theme.pal, theme.accent);
  const { cw, R } = g.shaft;
  const HGT = 30;
  // bottom floor disc + shaft wall cylinder + top cap
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2, R * CELL + 2, 0.24, 40), kit.mats.floor);
  fl.position.set(cw, -0.12, cw);
  group.add(fl);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2.4, R * CELL + 2.4, HGT, 40, 1, true), kit.mats.wall);
  shell.material.side = THREE.BackSide;
  shell.position.set(cw, HGT / 2, cw);
  group.add(shell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * CELL + 2.4, R * CELL + 2.4, 0.5, 40), kit.mats.frame);
  cap.position.set(cw, HGT + 0.25, cw);
  group.add(cap);
  // pipe ribs down the shaft wall
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, HGT, 8), kit.mats.frame);
    pipe.position.set(cw + Math.cos(a) * (R * CELL + 0.6), HGT / 2, cw + Math.sin(a) * (R * CELL + 0.6));
    group.add(pipe);
  }
  // THE CORE: glowing column with pulsing bands
  const core = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.6, HGT, 20), kit.mats.frame);
  core.position.set(cw, HGT / 2, cw);
  group.add(core);
  for (let y = 2; y < HGT; y += 4) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(7.45, 7.45, 0.7, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5a2a, toneMapped: false }));
    band.position.set(cw, y, cw);
    group.add(band);
  }
  // ring decks + railings (visual ring at each level's inner edge)
  drawStructural(kit, g);
  for (const ry of g.rings) {
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(12.4, 12.4, 0.12, 30, 1, true), kit.mats.accent);
    inner.position.set(cw, ry + 1.1, cw);
    group.add(inner);
  }
  extractionPad(kit, g.stairs.x, g.stairs.z, 0);
  kit.finish(group);
  for (const gl of g.gravlifts) liftVisual(group, kit, gl);
  // heat from below, core glow
  const heat = new THREE.PointLight(0xff5a2a, 140, 100, 1.4);
  heat.position.set(cw, 2.5, cw);
  group.add(heat);
  for (const ry of [7, 14.5, 22, 28]) {
    for (const a2 of [0, Math.PI]) {
      const rl = new THREE.PointLight(0xffc9a0, 40, 55, 1.5);
      rl.position.set(cw + Math.cos(a2) * 26, ry + 3, cw + Math.sin(a2) * 26);
      group.add(rl);
    }
  }
  return group;
}

// ==================================================================
// 5. WEAPONS — THE LINE (a linear factory gauntlet)
// ==================================================================
function genWeapons(seed) {
  const rng = makeRng(seed + ':line');
  const W = 62, H = 13;
  const theme = SECTOR_THEMES.weapons;
  const grid = baseGrid(W, H, 'weapons');
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) grid.cells[y * W + x] = FLOOR;
  const fs = baseFs(grid, theme, 'weapons');
  grid.ceil = 11;
  const midZ = Math.floor(H / 2) * CELL;

  // THE CONVEYOR: runs the whole hall — a low wall you vault or cross at gaps
  for (let x = 4; x < W - 6; x++) {
    if (x % 9 === 0) continue; // crossing gaps
    grid.colliders.push({ x: x * CELL, z: midZ, hx: CELL / 2 + 0.1, hz: 1.1, y0: 0, h: 1.15, noMesh: true });
  }
  grid.lineZ = midZ;

  // PRESS STATIONS: paired pistons over the line — the crush zone is a trap cell
  grid.presses = [];
  for (const px of [12, 26, 40, 52]) {
    grid.presses.push(px);
    fs.traps.push({ x: px * CELL, z: midZ, cx: px, cy: Math.floor(H / 2), cd: 0 });
  }
  // MOLTEN POUR: glowing floor strip mid-hall — trap cells across
  for (let y = 2; y < H - 2; y++) {
    if (y === Math.floor(H / 2)) continue; // the conveyor bridges it
    fs.traps.push({ x: 33 * CELL, z: y * CELL, cx: 33, cy: y, cd: 0 });
  }
  grid.moltenX = 33;

  // SIDE GALLERIES at 4.4 along both walls with stairs at each end
  for (const gz of [1.6 * CELL, (H - 2.6) * CELL]) {
    deck(grid, (W / 2) * CELL, gz, (W / 2 - 5) * CELL, CELL * 0.55, 4.4);
  }
  stairs(grid, 4 * CELL, 2.6 * CELL, 1, 0, 4.4);
  stairs(grid, (W - 6) * CELL, (H - 3.6) * CELL, -1, 0, 4.4);
  lift(grid, 6 * CELL, (H - 2.6) * CELL, 4.4);
  lift(grid, (W - 8) * CELL, 1.6 * CELL, 4.4);

  grid.spawn = { x: 3 * CELL, z: midZ + CELL };
  grid.spawnYaw = -Math.PI / 2;
  grid.cells[Math.floor(H / 2) * W + (W - 3)] = STAIRS;
  grid.stairs = { x: (W - 3) * CELL, z: midZ, cx: W - 3, cy: Math.floor(H / 2) };
  grid.portal = { dx: 1, dy: 0, yaw: Math.PI / 2 };

  foes(fs, [
    ['warrior', 10 * CELL, midZ - 8], ['warrior', 24 * CELL, midZ + 8],
    ['brute', 30 * CELL, midZ - 6], ['brute', 46 * CELL, midZ + 6],
    ['mage', 18 * CELL, midZ + 10], ['mage', 42 * CELL, midZ - 10],
    ['sniper', 20 * CELL, 1.6 * CELL, 4.4], ['sniper', 44 * CELL, (H - 2.6) * CELL, 4.4],
    ['necromancer', 36 * CELL, midZ + 8], ['goblin', 15 * CELL, midZ - 4],
    ['juggernaut', 50 * CELL, midZ], ['bomber', 28 * CELL, midZ + 4],
  ]);
  fs.lootSpawns.push({ kind: 'chest', x: 8 * CELL, z: 2.5 * CELL }, { kind: 'chest', x: 48 * CELL, z: (H - 3) * CELL });
  return fs;
}

function buildWeapons(fs) {
  const g = fs.grid, theme = fs.theme;
  const group = new THREE.Group();
  const kit = meshKit(theme.pal, theme.accent);
  const W = g.w * CELL, H = g.h * CELL, CEIL = g.ceil, midZ = g.lineZ;
  kit.box('floor', W / 2, -0.11, H / 2, W, 0.22, H);
  for (const [wx, wz, sx, sz] of [[W / 2, 0, W, 1.2], [W / 2, H - CELL, W, 1.2], [0, H / 2, 1.2, H], [W - CELL, H / 2, 1.2, H]]) {
    kit.box('wall', wx - CELL / 2, CEIL / 2, wz - CELL / 2, sx, CEIL, sz);
  }
  kit.box('frame', W / 2, CEIL + 0.2, H / 2, W, 0.4, H);
  for (let i = 0; i < 10; i++) kit.box('panel', (5 + i * 6) * CELL, CEIL - 0.05, H / 2, 6, 0.1, 5);
  // the conveyor body + hot belt + rollers
  kit.box('frame', W / 2 - CELL, 0.5, midZ, W - 10 * 1, 1.0, 2.1);
  kit.box('accent', W / 2 - CELL, 1.08, midZ, W - 12, 0.07, 0.7);
  // press stations: columns + crossbeam + piston + warning stripes
  for (const px of g.presses) {
    const x = px * CELL;
    kit.box('frame', x - 2.4, 3.2, midZ, 1.1, 6.4, 1.1);
    kit.box('frame', x + 2.4, 3.2, midZ, 1.1, 6.4, 1.1);
    kit.box('frame', x, 6.6, midZ, 6.2, 1.2, 1.6);
    kit.box('wall', x, 4.4, midZ, 2.4, 2.6, 2.0);
    kit.box('accent', x, 6.0, midZ - 1.05, 5.4, 0.14, 0.06);
  }
  // molten pour: emissive channel + spout
  const mx = g.moltenX * CELL;
  const glow = new THREE.Mesh(new THREE.BoxGeometry(CELL * 1.6, 0.06, H - 4 * CELL),
    new THREE.MeshBasicMaterial({ color: 0xff7a22, toneMapped: false }));
  glow.position.set(mx, 0.03, H / 2 - CELL / 2);
  group.add(glow);
  kit.box('frame', mx, 7.4, 3 * CELL, 2.4, 2.2, 2.4);
  kit.box('accent', mx, 6.2, 3 * CELL, 0.9, 1.6, 0.9);
  const ml = new THREE.PointLight(0xff7a22, 50, 40, 1.6);
  ml.position.set(mx, 3, H / 2);
  group.add(ml);
  // robot arms along the line
  for (const ax of [18, 31, 45]) {
    kit.box('frame', ax * CELL, 1.6, midZ + 2.6, 0.5, 3.2, 0.5);
    kit.box('frame', ax * CELL, 3.1, midZ + 1.2, 0.4, 0.4, 2.6);
    kit.box('accent', ax * CELL, 2.6, midZ + 0.2, 0.25, 0.7, 0.25);
  }
  drawStructural(kit, g);
  extractionPad(kit, g.stairs.x, g.stairs.z, 0);
  kit.finish(group);
  for (const gl of g.gravlifts) liftVisual(group, kit, gl);
  for (let i = 0; i < 8; i++) {
    const pl = new THREE.PointLight(0xffe0b0, 44, 50, 1.5);
    pl.position.set((5 + i * 8) * CELL, CEIL - 2, H / 2);
    group.add(pl);
  }
  return group;
}

// ==================================================================
// registry
// ==================================================================
const GENS = { cargo: genCargo, security: genSecurity, hab: genHab, engine: genEngine, weapons: genWeapons };
const BUILDERS = { cargo: buildCargo, security: buildSecurity, hab: buildHab, engine: buildEngine, weapons: buildWeapons };

export function hasSector(id) { return !!GENS[id]; }
export function generateSector(id, seed) { return GENS[id](seed); }
export function buildSectorMeshes(fs) { return BUILDERS[fs.sectorId](fs); }

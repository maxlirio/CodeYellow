// SHIP DECKS — the boarding-action generator for the sci-fi branch.
//
// Where generateFloorData carves tunnels-and-corridors, this carves a DECK of a
// derelict void-hulk: 4-7 LARGE rectangular holds separated by thin bulkheads,
// connected by WIDE breaches (3-6 cells) or fully open-plan — big volumes with
// cover, sightlines and verticality, never corridors. Holds have roles:
//   CARGO   — crate-maze cover, low boxes you can mantle, tall ones you round
//   HANGAR  — one vast open volume with a parked shuttle and scattered cover
//   GANTRY  — an elevated catwalk crossing the hold, ramps at both ends
//   MACHINE — rows of humming machinery with a wide fighting aisle
//   BARRACKS— low bunk/table clutter, walk-over cover
// One hold holds the hull-breach SPAWN, the farthest holds the LIFT down.
//
// Output shape is EXACTLY generateFloorData's, so every existing consumer
// (state.js aliases, buildFloorMeshes, traps, ropes, loot, enemy spawner,
// minimap) works unchanged. Two additive fields carry the sci-fi semantics for
// the art pass:
//   grid.ship      = { deckType, accent }          — palette + flavor
//   grid.shipDecor = [{kind,x,z,w,d,h,yaw,...}]    — crates/machines/shuttle/
//                    bunks/pillars/breach in WORLD units, so new renderers
//                    never have to re-derive what the colliders mean.
// The `placements` this file emits use the EXISTING dungeon pieces as a
// deliberately temporary stand-in (playable today, replaced by the art pass).
import * as THREE from 'three';
import { makeRng } from './rng.js';
import {
  CELL, PLATFORM_H, BOSS_FLOORS, enemyPool, eliteChance, ARCHERS,
  MUTATORS, MUTATOR_CHANCE, MIDBOSS_TYPES, ENEMIES,
} from './config.js';

// trio packs (goblin-style) spawn two extra members alongside the rolled one
const TRIO = new Set(Object.keys(ENEMIES).filter(k => ENEMIES[k].trio));

const SOLID = 0, FLOOR = 1, STAIRS = 3, TRAP = 4, RAMP = 6;

// ---------------- deck palettes ----------------
// Shaped like config.THEMES entries (applyThemeAtmosphere reads fog/density/
// hemi/amb/torch) plus `accent`: the emissive strip color for the art pass.
// Sightlines are the point of a boarding action, so fog stays thin.
export const SHIP_THEMES = [
  {
    id: 'cargo', name: 'The Cargo Decks', fog: 0x0a0d12, density: 0.0066,
    hemi: 0xfff0dd, amb: 0xbcae92, torch: 0xffb35c, accent: 0xffa028, boost: 1.45,
    tiles: ['floor_tile_large'], props: [], banners: [], bias: [],
  },
  {
    id: 'hab', name: 'The Habitation Ring', fog: 0x0a1214, density: 0.0060,
    hemi: 0xe6fbfc, amb: 0x9fc4c9, torch: 0x9fe8ec, accent: 0x2fd6c8, boost: 1.45,
    tiles: ['floor_tile_large'], props: [], banners: [], bias: [],
  },
  {
    id: 'engineering', name: 'The Engineering Decks', fog: 0x120a08, density: 0.0077,
    hemi: 0xffd8c4, amb: 0xc09488, torch: 0xff8050, accent: 0xff4a1f, boost: 1.45,
    tiles: ['floor_tile_large'], props: [], banners: [], bias: [],
  },
  {
    id: 'command', name: 'The Command Spire', fog: 0x0e0a16, density: 0.0060,
    hemi: 0xeae2ff, amb: 0xa79cd4, torch: 0xb090ff, accent: 0x8a5cff, boost: 1.45,
    tiles: ['floor_tile_large'], props: [], banners: [], bias: [],
  },
];

// sortie override: missions.js pins a section's identity so the ENGINE ROOM
// really is engineering and the SPACE PORT really is hangars, whatever the floor
let sortieOverride = null; // { floorN, theme, roles }
export function setSortieOverride(o) { sortieOverride = o; }

// deck flavor climbs toward the reactor: cargo bays first, then habitation,
// then engineering, with the command spire just before the core
export function shipThemeFor(seed, floor) {
  if (sortieOverride && floor === sortieOverride.floorN && sortieOverride.theme) {
    const t = SHIP_THEMES.find(t => t.id === sortieOverride.theme);
    if (t) return t;
  }
  const k = ((floor - 1) % 9 + 9) % 9; // 0..8 within each 9-deck run
  const id = k < 3 ? 'cargo' : k < 5 ? 'hab' : k < 7 ? 'engineering' : 'command';
  return SHIP_THEMES.find(t => t.id === id);
}

// ---------------- the generator ----------------
export function generateShipDeck(seedStr, floor) {
  const rng = makeRng(`${seedStr}:deck:${floor}`);
  const w = 42 + rng.int(0, 4);   // ~46x38 cells of 4u
  const h = 34 + rng.int(0, 4);

  const theme = shipThemeFor(seedStr, floor);
  const isBossFloor = !!BOSS_FLOORS[floor] || (floor > 9 && floor % 3 === 0);
  const bossType = isBossFloor ? rng.pick(MIDBOSS_TYPES) : null;
  const mutator = rng.chance(MUTATOR_CHANCE) && floor > 1 ? rng.pick(MUTATORS) : null;

  const cells = new Uint8Array(w * h); // all SOLID
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const at = (x, y) => cells[y * w + x];
  const set = (x, y, v) => { cells[y * w + x] = v; };
  const idxOf = (x, y) => y * w + x;
  const inb = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;

  // THE SPACE PORT sortie skips the BSP: one vast hangar hall aft, a service
  // strip forward, and the whole south wall open to space (the mouth)
  const hangarMode = !!(sortieOverride && floor === sortieOverride.floorN && sortieOverride.special === 'hangar');

  // ---- BSP the deck into holds ----
  const MINROOM = 8, WALL = 3;   // bulkhead thickness between holds
  const MAXW = 18, MAXH = 14;    // a hold larger than this must keep splitting
  let leaves = [{ x: 1, y: 1, w: w - 2, h: h - 2 }];
  if (hangarMode) {
    leaves = [
      { x: 1, y: 1, w: 12, h: 8 },            // service rooms forward
      { x: 16, y: 1, w: 12, h: 8 },
      { x: 31, y: 1, w: w - 32, h: 8 },
      { x: 1, y: 12, w: w - 2, h: h - 13 },   // THE HANGAR
    ];
  } else {
    const canSplit = (l) => l.w >= MINROOM * 2 + WALL || l.h >= MINROOM * 2 + WALL;
    const oversized = (l) => l.w > MAXW || l.h > MAXH;
    const target = rng.int(5, 7);
    for (let guard = 0; guard < 60; guard++) {
      const mustSplit = leaves.some(l => oversized(l) && canSplit(l));
      if (leaves.length >= 8 || (leaves.length >= target && !mustSplit)) break;
      leaves.sort((a, b) => b.w * b.h - a.w * a.h);
      const l = (mustSplit ? leaves.find(x => oversized(x) && canSplit(x)) : leaves.find(canSplit));
      if (!l) break;
      leaves.splice(leaves.indexOf(l), 1);
      const vertical = l.w === l.h ? rng.chance(0.5) : l.w > l.h; // cut the long axis
      if (vertical && l.w >= MINROOM * 2 + WALL) {
        const cut = rng.int(MINROOM, l.w - MINROOM - WALL);
        leaves.push({ x: l.x, y: l.y, w: cut, h: l.h });
        leaves.push({ x: l.x + cut + WALL, y: l.y, w: l.w - cut - WALL, h: l.h });
      } else if (!vertical && l.h >= MINROOM * 2 + WALL) {
        const cut = rng.int(MINROOM, l.h - MINROOM - WALL);
        leaves.push({ x: l.x, y: l.y, w: l.w, h: cut });
        leaves.push({ x: l.x, y: l.y + cut + WALL, w: l.w, h: l.h - cut - WALL });
      } else {
        leaves.push(l); // couldn't split after all
        break;
      }
    }
  }
  for (const l of leaves) { l.cx = l.x + Math.floor(l.w / 2); l.cy = l.y + Math.floor(l.h / 2); }

  // ---- adjacency: leaves whose rectangles face each other across a bulkhead ----
  const adj = new Map(leaves.map(l => [l, []]));
  const shared = (a, b) => {
    // vertical bulkhead between a|b ?
    if (b.x === a.x + a.w + WALL || a.x === b.x + b.w + WALL) {
      const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
      if (y1 - y0 >= 3) return { axis: 'v', from: Math.min(a.x + a.w, b.x + b.w), lo: y0, hi: y1 };
    }
    if (b.y === a.y + a.h + WALL || a.y === b.y + b.h + WALL) {
      const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
      if (x1 - x0 >= 3) return { axis: 'h', from: Math.min(a.y + a.h, b.y + b.h), lo: x0, hi: x1 };
    }
    return null;
  };
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const s = shared(leaves[i], leaves[j]);
    if (s) { adj.get(leaves[i]).push({ to: leaves[j], s }); adj.get(leaves[j]).push({ to: leaves[i], s }); }
  }

  // ---- seal a section or two (dead void space keeps the hulk claustrophobic
  //      at the edges without ever pinching the fights) ----
  const sealable = hangarMode ? 0 : leaves.length >= 6 ? 2 : leaves.length === 5 ? rng.int(1, 2) : 1;
  const sealed = new Set();
  for (let i = 0; i < sealable; i++) {
    let cand = leaves.filter(l => !sealed.has(l) && adj.get(l).length <= 2);
    if (!cand.length) cand = leaves.filter(l => !sealed.has(l) && adj.get(l).length <= 3);
    if (!cand.length) break;
    const pick = rng.pick(cand);
    sealed.add(pick);
    // still connected without it?
    const open = leaves.filter(l => !sealed.has(l));
    const seen = new Set([open[0]]);
    const q = [open[0]];
    while (q.length) {
      const c = q.pop();
      for (const e of adj.get(c)) if (!sealed.has(e.to) && !seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    }
    if (seen.size !== open.length) sealed.delete(pick); // would disconnect — keep it open
  }
  const holds = leaves.filter(l => !sealed.has(l));

  // ---- carve holds (with chamfered hull corners for a ship silhouette) ----
  const chamfer = [];
  for (const [cx0, cy0, sx, sy] of [[1, 1, 1, 1], [w - 2, 1, -1, 1], [1, h - 2, 1, -1], [w - 2, h - 2, -1, -1]]) {
    if (!hangarMode && rng.chance(0.7)) chamfer.push({ cx0, cy0, sx, sy, s: rng.int(4, 9) });
  }
  // diagonal hull bite: cells within taxicab distance s of a chosen deck corner
  const chamfered = (x, y) => chamfer.some(c => (x - c.cx0) * c.sx + (y - c.cy0) * c.sy < c.s);
  for (const l of holds) {
    for (let y = l.y; y < l.y + l.h; y++) for (let x = l.x; x < l.x + l.w; x++) {
      if (!chamfered(x, y)) set(x, y, FLOOR);
    }
  }

  // ---- structural mass: SOLID column-blocks inside the big holds. Real walls
  //      on the grid — they block sight and shot, break up the sightlines of a
  //      big hold, and put hull tonnage back into the deck ----
  const biggestHold = holds.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
  for (const l of holds) {
    if (l.w < 10 || l.h < 10 || l === biggestHold) continue;
    const nBlocks = l.w * l.h > 140 ? 2 : 1;
    for (let b = 0; b < nBlocks; b++) {
      const bw = rng.int(2, 3), bh = rng.int(2, 3);
      const bx = l.x + 2 + rng.int(0, l.w - bw - 4);
      const by = l.y + 2 + rng.int(0, l.h - bh - 4);
      // never beside a bulkhead (breach spans check the cells next to walls)
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, SOLID);
    }
  }

  // ---- breaches: spanning tree first (guaranteed connected), then loops ----
  const breachCells = [];
  const carveBreach = (e, openPlan) => {
    const { s } = e;
    // only breach where BOTH holds actually have floor on their side of the
    // bulkhead — a hull chamfer may have bitten the end of the shared span,
    // and a breach opening into rock connects nothing
    const valid = [];
    for (let t = s.lo; t < s.hi; t++) {
      const aSide = s.axis === 'v' ? at(s.from - 1, t) : at(t, s.from - 1);
      const bSide = s.axis === 'v' ? at(s.from + WALL, t) : at(t, s.from + WALL);
      if (aSide === FLOOR && bSide === FLOOR) valid.push(t);
    }
    // longest contiguous run of valid positions
    let run = [], best = [];
    for (let i = 0; i < valid.length; i++) {
      if (i && valid[i] !== valid[i - 1] + 1) run = [];
      run.push(valid[i]);
      if (run.length > best.length) best = run.slice();
    }
    if (best.length < 2) return false;
    const width = openPlan ? best.length : Math.min(best.length, rng.int(3, 6));
    const start = best[0] + (openPlan ? 0 : rng.int(0, best.length - width));
    for (let t = start; t < start + width; t++) {
      for (let d = 0; d < WALL; d++) {
        const x = s.axis === 'v' ? s.from + d : t;
        const y = s.axis === 'v' ? t : s.from + d;
        if (inb(x, y) && at(x, y) === SOLID) { set(x, y, FLOOR); breachCells.push({ x, y }); }
      }
    }
    return true;
  };
  const connected = new Set([holds[0]]);
  const treeEdges = [];
  const failedEdges = new Set();
  while (connected.size < holds.length) {
    const options = [];
    for (const l of connected) for (const e of adj.get(l)) {
      if (!sealed.has(e.to) && !connected.has(e.to) && !failedEdges.has(e)) options.push(e);
    }
    if (!options.length) break; // isolated hold: the connectivity pass below rescues it
    const e = rng.pick(options);
    if (carveBreach(e, rng.chance(0.25))) {
      connected.add(e.to);
      treeEdges.push(e);
    } else failedEdges.add(e); // chamfer ate the shared span — try another edge
  }
  // last-resort rescue: any hold the tree couldn't reach gets force-connected by
  // a straight cut to the nearest connected hold (never leaves an unreachable
  // hold with a chest in it)
  for (const l of holds) {
    if (connected.has(l)) continue;
    let near = null, nd = Infinity;
    for (const c of connected) {
      const d = (c.cx - l.cx) ** 2 + (c.cy - l.cy) ** 2;
      if (d < nd) { nd = d; near = c; }
    }
    if (!near) continue;
    let x = l.cx, y = l.cy;
    while (x !== near.cx || y !== near.cy) {
      if (x !== near.cx) x += Math.sign(near.cx - x); else y += Math.sign(near.cy - y);
      if (inb(x, y) && at(x, y) === SOLID) { set(x, y, FLOOR); breachCells.push({ x, y }); }
      // cut two wide so the rescue passage still doesn't read as a corridor
      if (inb(x, y + 1) && at(x, y + 1) === SOLID) { set(x, y + 1, FLOOR); breachCells.push({ x, y: y + 1 }); }
    }
    connected.add(l);
  }
  // extra loop connections so the deck fights in circles, not a line
  for (const l of holds) for (const e of adj.get(l)) {
    if (sealed.has(e.to) || treeEdges.includes(e)) continue;
    if (rng.chance(0.3)) { carveBreach(e, false); treeEdges.push(e); }
  }

  // ---- spawn hold (nearest a deck corner) & lift hold (farthest away) ----
  const cornerD = (l) => Math.min(
    l.cx * l.cx + l.cy * l.cy, (w - l.cx) ** 2 + l.cy * l.cy,
    l.cx * l.cx + (h - l.cy) ** 2, (w - l.cx) ** 2 + (h - l.cy) ** 2);
  const spawnHold = holds.slice().sort((a, b) => cornerD(a) - cornerD(b))[0];
  let liftHold = holds[0], bestD = -1;
  for (const l of holds) {
    const d = (l.cx - spawnHold.cx) ** 2 + (l.cy - spawnHold.cy) ** 2;
    if (d > bestD) { bestD = d; liftHold = l; }
  }

  // keep-clear: spawn area, lift area, and a lane through every breach
  const keepClear = new Set();
  const clearAround = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) keepClear.add(idxOf(x + dx, y + dy));
  };
  for (const b of breachCells) clearAround(b.x, b.y, 2);

  // ---- hold roles ----
  const flavorRoles = (sortieOverride && floor === sortieOverride.floorN && sortieOverride.roles?.length)
    ? sortieOverride.roles
    : {
      cargo: ['cargo', 'cargo', 'hangar', 'machine', 'barracks'],
      hab: ['barracks', 'barracks', 'gantry', 'cargo', 'machine'],
      engineering: ['machine', 'machine', 'gantry', 'cargo', 'barracks'],
      command: ['gantry', 'machine', 'barracks', 'cargo'],
    }[theme.id];
  const biggest = biggestHold;
  // sortie sections deal their roles round-robin — SECURITY must actually get
  // its cell blocks, CARGO its container rows; rng.pick left it to luck
  const dealt = sortieOverride && floor === sortieOverride.floorN && sortieOverride.roles?.length;
  let dealIdx = 0;
  for (const l of holds) {
    if (hangarMode && l === biggest) l.role = 'bay'; // THE HANGAR gets its parking row
    else if (l === spawnHold) l.role = 'breach';
    else if (!dealt && l === biggest && l.w >= 12 && l.h >= 9 && theme.id === 'cargo') l.role = 'hangar';
    else if (!dealt && l === biggest && l.w >= 12 && l.h >= 9 && rng.chance(0.6)) l.role = 'gantry';
    else l.role = dealt ? flavorRoles[dealIdx++ % flavorRoles.length] : rng.pick(flavorRoles);
  }

  // ---- interiors ----
  const colliders = [];
  const shipDecor = [];
  const platforms = []; // {cells:[{x,y}], ramps:[{x,y,dx,dy}], room}
  const occupied = new Set(); // cells claimed by cover, so lanes stay honest
  const free = (x, y) => inb(x, y) && at(x, y) === FLOOR && !elev[idxOf(x, y)] &&
    !occupied.has(idxOf(x, y)) && !keepClear.has(idxOf(x, y));

  const crate = (x, y, tall) => {
    if (!free(x, y)) return false;
    const hgt = tall ? 2.0 : rng.chance(0.35) ? 1.5 : 1.2;
    colliders.push({ x: x * CELL, z: y * CELL, hx: 1.55, hz: 1.55, y0: 0, h: hgt });
    shipDecor.push({ kind: 'crate', x: x * CELL, z: y * CELL, w: 3.1, d: 3.1, h: hgt, yaw: rng.int(0, 3) * Math.PI / 2 });
    occupied.add(idxOf(x, y));
    return true;
  };

  for (const l of holds) {
    const inset = { x: l.x + 1, y: l.y + 1, w: l.w - 2, h: l.h - 2 };
    if (l.role === 'cargo' || l.role === 'breach') {
      // CONTAINER CANYONS: shipping containers in aligned rows (big holds),
      // then crate clusters as loose fill; the breach room gets rubble-light cover
      if (l.role === 'cargo' && inset.w >= 5 && inset.h >= 5) {
        const along = inset.w >= inset.h;
        const rows = rng.int(1, 2);
        for (let r0 = 0; r0 < rows; r0++) {
          const lane = (along ? inset.y : inset.x) + 1 + r0 * 3 + rng.int(0, 1);
          const run = rng.int(2, 3);
          const start = (along ? inset.x : inset.y) + 1 + rng.int(0, 2);
          for (let i = 0; i < run; i++) {
            const cx2 = along ? start + i * 2 : lane, cy2 = along ? lane : start + i * 2;
            if (!free(cx2, cy2) || !free(cx2 + (along ? 1 : 0), cy2 + (along ? 0 : 1))) continue;
            const stacked = rng.chance(0.4);
            colliders.push({
              x: cx2 * CELL + (along ? CELL / 2 : 0), z: cy2 * CELL + (along ? 0 : CELL / 2),
              hx: along ? 3.6 : 1.45, hz: along ? 1.45 : 3.6, y0: 0, h: stacked ? 5.1 : 2.6, noMesh: true,
            });
            shipDecor.push({ kind: 'container', x: cx2 * CELL + (along ? CELL / 2 : 0), z: cy2 * CELL + (along ? 0 : CELL / 2), w: along ? 7.2 : 2.9, d: along ? 2.9 : 7.2, h: 2.6, yaw: 0, stacked, tone: rng.int(0, 2) });
            occupied.add(idxOf(cx2, cy2)); occupied.add(idxOf(cx2 + (along ? 1 : 0), cy2 + (along ? 0 : 1)));
          }
        }
      }
      const clusters = l.role === 'breach' ? rng.int(1, 2) : rng.int(2, Math.min(5, 2 + (l.w * l.h > 140 ? 2 : 1)));
      for (let c = 0; c < clusters; c++) {
        const ox = inset.x + 1 + rng.int(0, Math.max(0, inset.w - 4));
        const oy = inset.y + 1 + rng.int(0, Math.max(0, inset.h - 4));
        const cw = rng.int(2, 3), ch = rng.int(1, 2);
        for (let y = oy; y < oy + ch; y++) for (let x = ox; x < ox + cw; x++) {
          if (rng.chance(0.85)) crate(x, y, rng.chance(0.3));
        }
      }
      // singles as scattered hard cover
      for (let i = 0; i < rng.int(2, 4); i++) {
        crate(inset.x + rng.int(0, inset.w - 1), inset.y + rng.int(0, inset.h - 1), false);
      }
    } else if (l.role === 'bay') {
      // THE HANGAR: dropships parked in a row, noses toward the mouth, each on
      // its own landing ring. Fuel drums and crate trains between them.
      const n = Math.max(2, Math.floor((l.w - 6) / 7));
      const rowCy = l.y + Math.floor(l.h * 0.55);
      for (let i = 0; i < n; i++) {
        const cx2 = l.x + 4 + i * 7, cy2 = rowCy + rng.int(-1, 1);
        let open = true;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++)
          if (at(cx2 + dx, cy2 + dy) !== FLOOR || elev[idxOf(cx2 + dx, cy2 + dy)]) open = false;
        if (!open) continue;
        const cxw = cx2 * CELL, cyw = cy2 * CELL;
        colliders.push({ x: cxw, z: cyw, hx: 2.5, hz: 5.0, y0: 0, h: 3.1, noMesh: true }); // hull
        colliders.push({ x: cxw, z: cyw - 6.4, hx: 1.5, hz: 1.5, y0: 0, h: 1.4, noMesh: true }); // aft ramp — mantleable
        shipDecor.push({ kind: 'ship', x: cxw, z: cyw, w: 5, d: 10, h: 3.1, yaw: 0, tone: rng.int(0, 2) });
        for (let dy = -2; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) occupied.add(idxOf(cx2 + dx, cy2 + dy));
        if (rng.chance(0.7)) { // ground crew clutter beside the pad
          const gx = cx2 + (rng.chance(0.5) ? -2 : 2), gy = cy2 + rng.int(-2, 2);
          if (free(gx, gy)) {
            colliders.push({ x: gx * CELL, z: gy * CELL, r: 1.0, y0: 0, h: 1.4 });
            shipDecor.push({ kind: 'drum', x: gx * CELL, z: gy * CELL, w: 2, d: 2, h: 1.4, yaw: 0 });
            occupied.add(idxOf(gx, gy));
          }
        }
      }
      for (let i = 0; i < rng.int(3, 5); i++) crate(inset.x + rng.int(0, inset.w - 1), inset.y + 1 + rng.int(0, 2), false);
    } else if (l.role === 'brig') {
      // SECURITY: cell blocks along the walls — barred alcoves with a bench
      const along = l.w >= l.h;
      const walls = along ? [inset.y, inset.y + inset.h - 1] : [inset.x, inset.x + inset.w - 1];
      for (const lane of walls) {
        for (let t = (along ? inset.x : inset.y) + 1; t < (along ? inset.x + inset.w : inset.y + inset.h) - 1; t += 2) {
          const cx2 = along ? t : lane, cy2 = along ? lane : t;
          if (!free(cx2, cy2) || !rng.chance(0.75)) continue;
          const toward = along ? (lane === inset.y ? 1 : -1) : (lane === inset.x ? 1 : -1); // bars face the aisle
          colliders.push({
            x: cx2 * CELL + (along ? 0 : toward * 1.5), z: cy2 * CELL + (along ? toward * 1.5 : 0),
            hx: along ? 1.75 : 0.2, hz: along ? 0.2 : 1.75, y0: 0, h: 3.4, noMesh: true,
          });
          shipDecor.push({ kind: 'cellbar', x: cx2 * CELL, z: cy2 * CELL, w: 3.5, d: 3.5, h: 3.4, yaw: along ? 0 : Math.PI / 2, toward });
          occupied.add(idxOf(cx2, cy2));
        }
      }
      for (let i = 0; i < rng.int(1, 3); i++) crate(l.cx + rng.int(-2, 2), l.cy + rng.int(-2, 2), false);
    } else if (l.role === 'foundry') {
      // WEAPONS FACILITY: assembly lines — long low conveyors with printer arms
      const along = l.w >= l.h;
      const lines = Math.min(3, Math.max(1, Math.floor((along ? inset.h : inset.w) / 3)));
      for (let li = 0; li < lines; li++) {
        const lane = (along ? inset.y : inset.x) + 1 + li * 3;
        const t0 = (along ? inset.x : inset.y) + 1, t1 = (along ? inset.x + inset.w : inset.y + inset.h) - 2;
        if (t1 - t0 < 3) continue;
        let ok = true;
        for (let t = t0; t <= t1; t++) {
          const cx2 = along ? t : lane, cy2 = along ? lane : t;
          if (!free(cx2, cy2)) { ok = false; break; }
        }
        if (!ok) continue;
        const mx = (along ? (t0 + t1) / 2 : lane) * CELL, mz = (along ? lane : (t0 + t1) / 2) * CELL;
        const len = (t1 - t0 + 1) * CELL - 1;
        colliders.push({
          x: mx, z: mz, hx: along ? len / 2 : 1.1, hz: along ? 1.1 : len / 2, y0: 0, h: 1.15, noMesh: true,
        });
        shipDecor.push({ kind: 'line', x: mx, z: mz, w: along ? len : 2.2, d: along ? 2.2 : len, h: 1.15, yaw: along ? 0 : Math.PI / 2, arms: rng.int(2, 3) });
        for (let t = t0; t <= t1; t++) occupied.add(idxOf(along ? t : lane, along ? lane : t));
      }
      for (let i = 0; i < rng.int(1, 3); i++) crate(inset.x + rng.int(0, inset.w - 1), inset.y + rng.int(0, inset.h - 1), false);
    } else if (l.role === 'hangar') {
      // the shuttle: one long axis-aligned mass in the middle of the volume
      // (colliders are axis-aligned boxes, so the hull sits along the hold's
      // long axis rather than at an arbitrary yaw)
      const along = l.w >= l.h;
      const cxw = l.cx * CELL, cyw = l.cy * CELL;
      const hx = (along ? 9 : 5), hz = (along ? 5 : 9);
      // the hull footprint must be open floor — a structural block or chamfer
      // under the shuttle would put a collider inside SOLID
      let footprintOpen = true;
      for (let dy = -Math.ceil(hz / CELL); dy <= Math.ceil(hz / CELL); dy++)
        for (let dx = -Math.ceil(hx / CELL); dx <= Math.ceil(hx / CELL); dx++)
          if (at(l.cx + dx, l.cy + dy) !== FLOOR) footprintOpen = false;
      if (!footprintOpen) { l.role = 'cargo'; continue; } // fall back to crates next pass? no — just crates below
      // a real dropship on a pad (the renderer draws hull/wings/engines)
      colliders.push({ x: cxw, z: cyw, hx: along ? 5.0 : 2.5, hz: along ? 2.5 : 5.0, y0: 0, h: 3.1, noMesh: true });
      colliders.push({ x: cxw - (along ? 6.4 : 0), z: cyw - (along ? 0 : 6.4), hx: 1.5, hz: 1.5, y0: 0, h: 1.4, noMesh: true }); // aft ramp — mantleable
      shipDecor.push({ kind: 'ship', x: cxw, z: cyw, w: 5, d: 10, h: 3.1, yaw: along ? Math.PI / 2 : 0, tone: rng.int(0, 2) });
      for (let dy = -Math.ceil(hz / CELL) - 1; dy <= Math.ceil(hz / CELL) + 1; dy++)
        for (let dx = -Math.ceil(hx / CELL) - 1; dx <= Math.ceil(hx / CELL) + 1; dx++)
          occupied.add(idxOf(l.cx + dx, l.cy + dy));
      for (let i = 0; i < rng.int(3, 5); i++) { // drums + crates round the bay
        const x = inset.x + rng.int(0, inset.w - 1), y = inset.y + rng.int(0, inset.h - 1);
        if (!free(x, y)) continue;
        if (rng.chance(0.5)) crate(x, y, false);
        else {
          colliders.push({ x: x * CELL, z: y * CELL, r: 1.0, y0: 0, h: 1.4 });
          shipDecor.push({ kind: 'drum', x: x * CELL, z: y * CELL, w: 2, d: 2, h: 1.4, yaw: 0 });
          occupied.add(idxOf(x, y));
        }
      }
    } else if (l.role === 'gantry') {
      // catwalk straight across the long axis, ramps at both ends
      const along = l.w >= l.h;
      const lanes = l.role === 'gantry' && (along ? l.h : l.w) >= 9 && rng.chance(0.4) ? 2 : 1;
      const mid = along ? l.cy + rng.int(-1, 1) : l.cx + rng.int(-1, 1);
      // the catwalk must be one CONTIGUOUS run — a structural block mid-hold
      // would split it into an island with no ramp. Walk the primary lane and
      // keep the longest unbroken stretch.
      const span = along
        ? { a0: l.x + 2, a1: l.x + l.w - 3 }
        : { a0: l.y + 2, a1: l.y + l.h - 3 };
      let run = [], bestRun = [];
      for (let a = span.a0; a <= span.a1; a++) {
        const x = along ? a : mid, y = along ? mid : a;
        if (at(x, y) === FLOOR) { run.push(a); if (run.length > bestRun.length) bestRun = run.slice(); }
        else run = [];
      }
      const cellsP = [];
      for (const a of bestRun) {
        for (let k = 0; k < lanes; k++) {
          const x = along ? a : mid + k, y = along ? mid + k : a;
          if (at(x, y) === FLOOR) cellsP.push({ x, y });
        }
      }
      if (cellsP.length >= 4 && bestRun.length >= 4) {
        const r0 = bestRun[0], r1 = bestRun[bestRun.length - 1];
        const ends = along
          ? [{ x: r0 - 1, y: mid, dx: 1, dy: 0 }, { x: r1 + 1, y: mid, dx: -1, dy: 0 }]
          : [{ x: mid, y: r0 - 1, dx: 0, dy: 1 }, { x: mid, y: r1 + 1, dx: 0, dy: -1 }];
        const okRamps = ends.filter(r => inb(r.x, r.y) && at(r.x, r.y) === FLOOR && !keepClear.has(idxOf(r.x, r.y)));
        if (okRamps.length) {
          for (const c of cellsP) elev[idxOf(c.x, c.y)] = 1;
          for (const r of okRamps) { set(r.x, r.y, RAMP); ramps.set(idxOf(r.x, r.y), { dx: r.dx, dy: r.dy }); }
          platforms.push({ cells: cellsP, ramps: okRamps, room: l });
          // support pillars beneath, every third cell
          cellsP.forEach((c, ci) => {
            if (ci % 3 !== 0) return;
            colliders.push({ x: c.x * CELL, z: c.y * CELL, r: 0.5, y0: 0, h: PLATFORM_H - 0.4 });
            shipDecor.push({ kind: 'pillar', x: c.x * CELL, z: c.y * CELL, w: 1, d: 1, h: PLATFORM_H, yaw: 0 });
          });
        }
      }
      for (let i = 0; i < rng.int(2, 4); i++) crate(inset.x + rng.int(0, inset.w - 1), inset.y + rng.int(0, inset.h - 1), false);
    } else if (l.role === 'machine') {
      // ENGINEERING holds big enough get TURBINES: floor-to-ceiling drive
      // cylinders ranked down the hold, glowing hot — the engine room reads
      // as an engine room from the doorway
      const along = l.w >= l.h;
      if (theme.id === 'engineering' && inset.w >= 5 && inset.h >= 5) {
        const n = Math.max(2, Math.floor((along ? inset.w : inset.h) / 4));
        for (let i = 0; i < n; i++) {
          const t = (along ? inset.x : inset.y) + 2 + i * 4;
          const cx2 = along ? t : l.cx + rng.int(-1, 1), cy2 = along ? l.cy + rng.int(-1, 1) : t;
          if (!free(cx2, cy2) || !free(cx2 + (along ? 1 : 0), cy2 + (along ? 0 : 1))) continue;
          colliders.push({ x: cx2 * CELL, z: cy2 * CELL, r: 2.3, y0: 0, h: 6.4, noMesh: true });
          shipDecor.push({ kind: 'turbine', x: cx2 * CELL, z: cy2 * CELL, w: 4.6, d: 4.6, h: 6.4, yaw: 0 });
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) occupied.add(idxOf(cx2 + dx, cy2 + dy));
        }
      }
      // machinery ranks with a wide center aisle down the long axis
      const aisleLo = (along ? l.cy : l.cx) - 1, aisleHi = (along ? l.cy : l.cx) + 1;
      for (let y = inset.y + 1; y < inset.y + inset.h - 1; y += 2) {
        for (let x = inset.x + 1; x < inset.x + inset.w - 1; x += 2) {
          const lane = along ? y : x;
          if (lane >= aisleLo && lane <= aisleHi) continue;
          if (!free(x, y) || !rng.chance(0.7)) continue;
          colliders.push({ x: x * CELL, z: y * CELL, hx: 1.7, hz: 1.7, y0: 0, h: 3 });
          shipDecor.push({ kind: 'machine', x: x * CELL, z: y * CELL, w: 3.4, d: 3.4, h: 3, yaw: rng.int(0, 3) * Math.PI / 2, lit: rng.chance(0.5) });
          occupied.add(idxOf(x, y));
        }
      }
    } else if (l.role === 'barracks') {
      // low clutter: bunks and tables — cover you can vault
      const n = rng.int(4, 8);
      for (let i = 0; i < n; i++) {
        const x = inset.x + rng.int(0, inset.w - 1), y = inset.y + rng.int(0, inset.h - 1);
        if (!free(x, y)) continue;
        const bunk = rng.chance(0.6), flip = rng.chance(0.5);
        colliders.push({
          x: x * CELL, z: y * CELL,
          hx: bunk ? (flip ? 0.9 : 1.6) : 1.0, hz: bunk ? (flip ? 1.6 : 0.9) : 1.0,
          y0: 0, h: bunk ? 0.9 : 1.05, noMesh: bunk, // bunks draw their own frame
        });
        shipDecor.push({ kind: bunk ? 'bunk' : 'table', x: x * CELL, z: y * CELL, w: bunk ? (flip ? 1.8 : 3.2) : 2, d: bunk ? (flip ? 3.2 : 1.8) : 2, h: bunk ? 0.9 : 1.05, yaw: 0 });
        occupied.add(idxOf(x, y));
      }
    }
  }

  // ---- spawn point: the hull breach, in the spawn hold's corner-most cell ----
  let spawnCell = { x: spawnHold.cx, y: spawnHold.cy };
  {
    const corner = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]
      .sort((a, b) => ((a[0] - spawnHold.cx) ** 2 + (a[1] - spawnHold.cy) ** 2) - ((b[0] - spawnHold.cx) ** 2 + (b[1] - spawnHold.cy) ** 2))[0];
    let best = null, bd = Infinity;
    for (let y = spawnHold.y; y < spawnHold.y + spawnHold.h; y++) {
      for (let x = spawnHold.x; x < spawnHold.x + spawnHold.w; x++) {
        if (at(x, y) !== FLOOR || elev[idxOf(x, y)] || occupied.has(idxOf(x, y))) continue;
        const d = (x - corner[0]) ** 2 + (y - corner[1]) ** 2;
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    if (best) spawnCell = best;
  }
  clearAround(spawnCell.x, spawnCell.y, 1);
  shipDecor.push({ kind: 'breach', x: spawnCell.x * CELL, z: spawnCell.y * CELL, w: 6, d: 6, h: 8, yaw: 0 });
  const spawnYaw = Math.atan2(spawnHold.cx - spawnCell.x, spawnHold.cy - spawnCell.y) + Math.PI;

  // ---- the lift (stairs cell) on the lift hold's far wall ----
  const edgeCandidates = [];
  for (let y = liftHold.y; y < liftHold.y + liftHold.h; y++) {
    for (let x = liftHold.x; x < liftHold.x + liftHold.w; x++) {
      if (at(x, y) !== FLOOR || elev[idxOf(x, y)] || occupied.has(idxOf(x, y))) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || at(nx, ny) === SOLID) {
          edgeCandidates.push({ x, y, dx, dy, d: (x - spawnCell.x) ** 2 + (y - spawnCell.y) ** 2 });
        }
      }
    }
  }
  edgeCandidates.sort((a, b) => b.d - a.d); // farthest edge cell from the breach
  const portal = edgeCandidates.length
    ? edgeCandidates[Math.min(rng.int(0, 3), edgeCandidates.length - 1)]
    : { x: liftHold.cx, y: liftHold.cy, dx: 0, dy: -1 };
  set(portal.x, portal.y, STAIRS);
  clearAround(portal.x, portal.y, 1);

  // ---- shock plates (traps) at the breach chokepoints ----
  const traps = [];
  const maxTraps = Math.min(1 + Math.floor(floor / 2), 5);
  for (const b of breachCells) {
    if (traps.length >= maxTraps) break;
    if (at(b.x, b.y) !== FLOOR || !rng.chance(0.18)) continue;
    set(b.x, b.y, TRAP);
    traps.push({ x: b.x * CELL, z: b.y * CELL, cx: b.x, cy: b.y, cd: 0 });
  }

  // ---- hanging cables (the rope system, re-dressed by the art pass) ----
  const ropes = [];
  for (const l of holds) {
    if ((l.role !== 'gantry' && l.role !== 'hangar') || !rng.chance(0.5)) continue;
    const rx = l.cx + rng.int(-2, 2), ry = l.cy + rng.int(-2, 2);
    if (at(rx, ry) !== FLOOR || elev[idxOf(rx, ry)] || occupied.has(idxOf(rx, ry))) continue;
    ropes.push({ x: rx * CELL + rng.next() * 1.5 - 0.75, z: ry * CELL + rng.next() * 1.5 - 0.75, ay: 7.4, len: 5.0 });
  }

  // ================= placements (temporary: existing pieces) =================
  const placements = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const place = (piece, x, y, z, yaw = 0, scale = 1) => {
    Q.setFromAxisAngle(V.set(0, 1, 0), yaw);
    const sv = Array.isArray(scale) ? S.set(scale[0], scale[1], scale[2]) : S.setScalar(scale);
    M.compose(new THREE.Vector3(x, y, z), Q.clone(), sv.clone());
    placements.push({ piece, matrix: M.clone() });
  };
  const torches = [];
  const wallDirs = [
    { dx: 1, dy: 0, yaw: Math.PI / 2 }, { dx: -1, dy: 0, yaw: Math.PI / 2 },
    { dx: 0, dy: 1, yaw: 0 }, { dx: 0, dy: -1, yaw: 0 },
  ];
  const torchEvery = Math.max(4, Math.round(6 / (mutator?.torchMult ?? 1)));
  let torchStep = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c === SOLID) continue;
    const wx = x * CELL, wz = y * CELL;
    if (c === TRAP) {
      place('floor_tile_large', wx, 0, wz);
      place('floor_tile_grate', wx, 0.03, wz, 0, 1.6);
    } else {
      place('floor_tile_large', wx, 0, wz, rng.int(0, 3) * Math.PI / 2);
    }
    for (const d of wallDirs) {
      const nx = x + d.dx, ny = y + d.dy;
      const neighbor = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
      if (neighbor !== SOLID) continue;
      const ex = wx + d.dx * CELL / 2, ez = wz + d.dy * CELL / 2;
      if (c === STAIRS && d.dx === portal.dx && d.dy === portal.dy) {
        place('wall_doorway', ex, 0, ez, d.yaw);
        place('wall', ex, PLATFORM_H, ez, d.yaw);
        place('wall', ex, PLATFORM_H * 2, ez, d.yaw);
        continue;
      }
      // holds are CATHEDRAL-tall: bulkheads stack three walls high
      place('wall', ex, 0, ez, d.yaw);
      place('wall', ex, PLATFORM_H, ez, d.yaw);
      place('wall', ex, PLATFORM_H * 2, ez, d.yaw);
      torchStep++;
      if (torchStep % torchEvery === 0 && c !== STAIRS) {
        const inx = -d.dx, inz = -d.dy;
        place('torch_mounted', ex + inx * 0.1, 2.6, ez + inz * 0.1, Math.atan2(inx, inz));
        torches.push({ x: ex + inx * 0.5, y: 3.45, z: ez + inz * 0.5 });
      }
    }
  }
  // catwalk decks, rails, ramps, supports (identical mechanics to platforms)
  for (const p of platforms) {
    const isPlat = (x, y) => x >= 0 && y >= 0 && x < w && y < h && elev[idxOf(x, y)] === 1;
    const isRampCell = (x, y) => p.ramps.some(r => r.x === x && r.y === y);
    for (const c of p.cells) {
      place('floor_tile_large', c.x * CELL, PLATFORM_H, c.y * CELL);
      for (const d of wallDirs) {
        const nx = c.x + d.dx, ny = c.y + d.dy;
        const nc = (nx < 0 || ny < 0 || nx >= w || ny >= h) ? SOLID : at(nx, ny);
        if (nc === SOLID || isPlat(nx, ny) || isRampCell(nx, ny)) continue;
        place('barrier', c.x * CELL + d.dx * CELL / 2, PLATFORM_H, c.y * CELL + d.dy * CELL / 2, d.yaw);
      }
    }
    for (const r of p.ramps) {
      place('stairs', r.x * CELL + r.dx * CELL / 2, 0, r.y * CELL + r.dy * CELL / 2, Math.atan2(-r.dx, -r.dy), [0.8, PLATFORM_H / 5.1, 1]);
    }
  }
  // stand-in visuals for the semantic decor (the art pass replaces these)
  for (const d of shipDecor) {
    if (d.kind === 'crate') place('crates_stacked', d.x, 0, d.z, d.yaw, [d.w / 2.6, d.h / 1.4, d.d / 2.6]);
    else if (d.kind === 'machine') place('box_large', d.x, 0, d.z, d.yaw, [1.6, 2.4, 1.6]);
    else if (d.kind === 'drum') place('barrel_large', d.x, 0, d.z, 0, 1.3);
    else if (d.kind === 'bunk') place('shelf_small', d.x, 0, d.z, d.w > d.d ? Math.PI / 2 : 0, 1.2);
    else if (d.kind === 'table') place('table_medium', d.x, 0, d.z, d.yaw);
    else if (d.kind === 'shuttle') {
      for (let ox = -d.w / 2 + 2; ox <= d.w / 2 - 2; ox += 4) {
        place('crates_stacked', d.x + (d.yaw ? 0 : ox), 0, d.z + (d.yaw ? ox : 0), 0, [1.5, 2.3, 1.5]);
      }
    }
  }

  // ================= enemies =================
  const enemySpawns = [];
  const pool = mutator?.poolOverride ? mutator.poolOverride.slice() : enemyPool(floor).concat(theme.bias);
  const eChance = eliteChance(floor);
  const countMult = mutator?.countMult ?? 1;
  // early decks are a beachhead, not a meat grinder
  const floorScale = floor === 1 ? 0.55 : floor === 2 ? 0.8 : 1;
  const baseFor = (l) => (l.role === 'hangar' ? rng.int(4, 7)
    : l.role === 'bay' ? rng.int(6, 9)
    : l.role === 'cargo' ? rng.int(3, 5)
    : l.role === 'machine' || l.role === 'foundry' ? rng.int(2, 4)
    : rng.int(2, 3)) * floorScale;
  for (const l of holds) {
    if (l === spawnHold) continue;
    const n = Math.round((l === liftHold && isBossFloor ? 1 : baseFor(l)) * countMult);
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 8; tries++) {
        const x = rng.int(l.x, l.x + l.w - 1), y = rng.int(l.y, l.y + l.h - 1);
        if (at(x, y) !== FLOOR || elev[idxOf(x, y)] || occupied.has(idxOf(x, y))) continue;
        enemySpawns.push({ type: rng.pick(pool), x: x * CELL + rng.next() * 2 - 1, z: y * CELL + rng.next() * 2 - 1, y: 0, elite: rng.chance(eChance) });
        break;
      }
    }
  }
  for (const p of platforms) { // overwatch on the catwalks
    const nA = rng.int(1, 2);
    for (let i = 0; i < nA; i++) {
      const c = rng.pick(p.cells);
      enemySpawns.push({ type: rng.pick(ARCHERS), x: c.x * CELL, z: c.y * CELL, y: PLATFORM_H, elite: rng.chance(eChance + 0.06) });
    }
  }
  if (isBossFloor) {
    enemySpawns.push({ type: bossType, x: liftHold.cx * CELL, z: liftHold.cy * CELL, y: 0 });
  }
  const packSpawns = [];
  for (const s of enemySpawns) {
    if (TRIO.has(s.type)) {
      for (let i = 0; i < 2; i++) {
        // the offset must stay on walkable ground — a parent near a cell edge
        // plus a 1.5u jitter used to bury pack members inside the wall
        const px = s.x + rng.next() * 3 - 1.5, pz = s.z + rng.next() * 3 - 1.5;
        const ok = at(Math.round(px / CELL), Math.round(pz / CELL)) !== SOLID;
        packSpawns.push({ ...s, x: ok ? px : s.x, z: ok ? pz : s.z, elite: false });
      }
    }
  }
  enemySpawns.push(...packSpawns);

  // ================= loot =================
  const lootSpawns = [];
  const freeHoldCell = (l, wantPlat = false) => {
    for (let tries = 0; tries < 24; tries++) {
      const x = rng.int(l.x, l.x + l.w - 1), y = rng.int(l.y, l.y + l.h - 1);
      const plat = elev[idxOf(x, y)] === 1;
      if (wantPlat && plat) return { x, y, py: PLATFORM_H };
      if (!wantPlat && at(x, y) === FLOOR && !plat && !occupied.has(idxOf(x, y))) return { x, y, py: 0 };
    }
    return null;
  };
  const chestHolds = holds.filter(l => l !== spawnHold);
  const nChests = Math.min(2 + Math.floor(floor / 2), 5) + (mutator?.extraChests ?? 0);
  for (let i = 0; i < nChests && chestHolds.length; i++) {
    const c = freeHoldCell(rng.pick(chestHolds));
    if (c) lootSpawns.push({ kind: 'chest', x: c.x * CELL, z: c.y * CELL, y: c.py, yaw: rng.next() * Math.PI * 2 });
  }
  for (const p of platforms) {
    const c = freeHoldCell(p.room, true);
    if (c) lootSpawns.push({ kind: 'chest', x: c.x * CELL + 1, z: c.y * CELL, y: PLATFORM_H, yaw: rng.next() * Math.PI * 2 });
    const c2 = rng.pick(p.cells);
    lootSpawns.push({ kind: 'coinstack', x: c2.x * CELL - 1, z: c2.y * CELL + 1, y: PLATFORM_H });
  }
  const gc = freeHoldCell(rng.pick(chestHolds.length ? chestHolds : holds));
  if (gc) {
    lootSpawns.push({ kind: 'goldchest', x: gc.x * CELL, z: gc.y * CELL, y: gc.py, yaw: rng.next() * Math.PI * 2 });
    const kc = freeHoldCell(rng.pick(chestHolds.length ? chestHolds : holds));
    if (kc) lootSpawns.push({ kind: 'key', x: kc.x * CELL + 1, z: kc.y * CELL + 1, y: kc.py });
  }
  const nCoins = rng.int(7, 12) + (mutator?.extraCoins ?? 0);
  for (let i = 0; i < nCoins; i++) {
    const c = freeHoldCell(rng.pick(holds));
    if (c) lootSpawns.push({ kind: rng.chance(0.3) ? 'coinstack' : 'coin', x: c.x * CELL + rng.next() * 2 - 1, z: c.y * CELL + rng.next() * 2 - 1, y: c.py });
  }
  for (let i = 0; i < rng.int(1, 3); i++) {
    const c = freeHoldCell(rng.pick(holds));
    if (c) lootSpawns.push({ kind: 'potion', x: c.x * CELL + rng.next() * 2 - 1, z: c.y * CELL + rng.next() * 2 - 1, y: c.py });
  }

  // ================= assemble =================
  // THE MOUTH: the hangar's whole south wall opens onto space — a force field
  // holds the air in, the starfield shows through, ships nose toward it
  const mouth = [];
  if (hangarMode) {
    const hang = holds.find(l => l.role === 'bay');
    if (hang) {
      const cy = hang.y + hang.h - 1;
      for (let x = hang.x + 2; x < hang.x + hang.w - 2; x++) {
        if (at(x, cy) === FLOOR && at(x, cy + 1) === SOLID) mouth.push({ cx: x, cy, dx: 0, dy: 1 });
      }
    }
  }

  const grid = {
    w, h, cells, elev, ramps, rooms: holds, colliders,
    mouth,
    spawn: { x: spawnCell.x * CELL, z: spawnCell.y * CELL },
    spawnYaw,
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: isBossFloor,
    portal: { dx: portal.dx, dy: portal.dy, yaw: wallDirs.find(d => d.dx === portal.dx && d.dy === portal.dy).yaw },
    ship: { deckType: theme.id, accent: theme.accent },
    shipDecor,
  };
  return {
    grid, torches, traps, ropes, placements, enemySpawns, lootSpawns,
    explored: new Uint8Array(w * h), hadBoss: isBossFloor,
    theme, mutator, layoutId: 'deck:' + theme.id,
  };
}

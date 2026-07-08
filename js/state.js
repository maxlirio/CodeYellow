// Central mutable game state, shared by all modules (imported everywhere, no imports here).
export const G = {
  // three.js core
  scene: null, camera: null, renderer: null,

  // loaded assets
  assets: null,

  // run state
  mode: 'menu',            // menu | lobby | playing | merchant | dead | victory | paused | transition
  seed: '',
  floor: 1,
  endless: false,

  // dungeon
  grid: null,              // { w, h, cells(Uint8Array), rooms, spawn:{x,z}, stairs:{x,z,cx,cy}, group }
  explored: null,          // Uint8Array fog-of-war for minimap
  torches: [],             // {x, y, z} flame positions
  traps: [],               // {x, z, cd}

  // entities
  player: null,            // local player entity
  remotes: new Map(),      // peerId -> remote player entity
  enemies: [],
  loots: [],
  projectiles: [],

  // meta progression for this run
  run: {
    gold: 0, potions: 1, keys: 0, atkBonus: 0, hpBonus: 0, speedBonus: 0, speedBuys: 0,
    level: 1, xp: 0, kills: 0, chests: 0, startTime: 0, buys: {},
  },

  // networking
  net: { role: 'solo', peer: null, conns: [], code: '', players: new Map(), started: false },

  // input
  keys: {}, mouse: { locked: false },

  settings: { mute: false },

  // per-frame hooks other modules register
  paused: false,
  time: 0,
};

export function cellIndex(cx, cy) { return cy * G.grid.w + cx; }
export function cellAtWorld(x, z) {
  const cx = Math.round(x / 4), cy = Math.round(z / 4);
  if (!G.grid || cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return 0;
  return G.grid.cells[cy * G.grid.w + cx];
}
export function isWalkable(x, z) { const c = cellAtWorld(x, z); return c === 1 || c === 3 || c === 4; }

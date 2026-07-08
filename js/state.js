// Central mutable game state, shared by all modules (imported everywhere, no imports here).
export const G = {
  // three.js core
  scene: null, camera: null, renderer: null,

  // loaded assets
  assets: null,

  // run state
  mode: 'menu',            // menu | lobby | playing | merchant | dead | victory | paused | transition
  seed: '',
  floor: 1,                // MY current floor (teammates can be on different ones)
  endless: false,
  pendingVictory: false,

  // per-floor world registry (data + entities for every floor someone has visited)
  floors: new Map(),       // n -> floor state record, see floorState()

  // aliases into MY current floor's record (rebound on floor change)
  grid: null,              // { w, h, cells, elev, ramps, rooms, spawn, stairs, stairsLocked }
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

  // equipment & inventory
  inv: { weapon: null, offhand: null, trinket1: null, trinket2: null, bag: [] },

  // appearance customization (synced to co-op peers)
  look: { cape: true, helmet: true, capeColor: 0 },

  // networking
  net: { role: 'solo', peer: null, conns: [], code: '', players: new Map(), started: false },

  // input
  keys: {}, mouse: { locked: false },

  settings: { mute: false },

  // per-frame hooks other modules register
  paused: false,
  time: 0,
};

// registry accessor: one record per floor, created on demand
export function floorState(n) {
  let fs = G.floors.get(n);
  if (!fs) {
    fs = {
      n, grid: null, torches: [], traps: [], placements: null,
      enemySpawns: [], lootSpawns: [],
      enemies: [], loots: [], summons: [], drops: [],
      meshGroup: null, enemyGroup: null, lootGroup: null,
      explored: null, built: false, spawned: false, hadBoss: false,
      nextSummonId: 0, nextLootId: 0,
    };
    G.floors.set(n, fs);
  }
  return fs;
}

// point the global aliases at MY current floor
export function setFloorAliases(fs) {
  G.grid = fs.grid;
  G.enemies = fs.enemies;
  G.loots = fs.loots;
  G.traps = fs.traps;
  G.torches = fs.torches;
  G.explored = fs.explored;
}

export function cellIndex(cx, cy) { return cy * G.grid.w + cx; }
export function cellAtWorld(x, z) {
  const cx = Math.round(x / 4), cy = Math.round(z / 4);
  if (!G.grid || cx < 0 || cy < 0 || cx >= G.grid.w || cy >= G.grid.h) return 0;
  return G.grid.cells[cy * G.grid.w + cx];
}
export function isWalkable(x, z) { const c = cellAtWorld(x, z); return c === 1 || c === 3 || c === 4; }

// FORWARD STAGING BAY — floor 0 of the boarding action.
// The breach team's toehold: a pressurized cargo bay bolted to the hulk's hull.
// Reuses the whole town NPC/shop system (fs.npcs + shop ids) with new bodies:
// the Quartermaster sells steel, the Medtech sells stims, the Crew Deck hires
// troopers, the Mission Console hosts co-op — and the breach chute drops you
// onto deck 1.
import { CELL } from './config.js';
import { pieceColliders } from './assets.js';

const SOLID = 0, FLOOR = 1, STAIRS = 3;

export const BAY_THEME = {
  id: 'bay', name: 'FORWARD STAGING BAY', fog: 0x0c1016, density: 0.008,
  hemi: 0xd5e4f4, amb: 0x93a1b8, torch: 0x9fd8ec, accent: 0x2fd6c8, sun: true, // floodlit — this is the safe room
  portal: 0x2fd6c8,
  tiles: [], props: [], banners: [], bias: [],
};

export function generateBayData() {
  const w = 24, h = 20;
  const cells = new Uint8Array(w * h);
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const colliders = [];
  const set = (x, y, v) => { cells[y * w + x] = v; };

  // the bay hall
  for (let y = 3; y <= 16; y++) for (let x = 3; x <= 20; x++) set(x, y, FLOOR);

  // the breach chute north-center: the way INTO the hulk
  const portal = { x: 11, y: 3, dx: 0, dy: -1 };
  set(portal.x, portal.y, STAIRS);

  // ---- set dressing: real Kenney props with measured colliders ----
  // Kenney props are modelled TINY (a barrel is 0.25u) — scales are from
  // measured bboxes, aiming at believable world sizes
  const props = [
    // the boarding skiff that brought you here, parked along the west wall
    { piece: 'craft_speederA', x: 5.6, z: 11.5, yaw: Math.PI / 2, scale: 3.0 },   // ~6u skiff
    // power plant humming in the north-east corner
    { piece: 'machine_generatorLarge', x: 18.4, z: 4.8, yaw: -Math.PI / 2, scale: 4.0 }, // ~2.7 tall
    { piece: 'machine_wirelessCable', x: 15.8, z: 4.4, yaw: Math.PI, scale: 3.4 },
    { piece: 'satelliteDish', x: 19.4, z: 7.2, yaw: -2.2, scale: 3.2 },
    // comms/ops desks by the mission console
    { piece: 'desk_computerScreen', x: 17.6, z: 13.4, yaw: -Math.PI / 2, scale: 3.0 },
    { piece: 'desk_computer', x: 17.6, z: 12.2, yaw: -Math.PI / 2, scale: 3.0 },
    // fuel and supplies
    { piece: 'barrels', x: 4.8, z: 5.2, yaw: 0.5, scale: 4.0 },
    { piece: 'machine_barrelLarge', x: 4.4, z: 7.4, yaw: 0, scale: 3.2 },
    { piece: 'craft_cargoA', x: 8.2, z: 4.6, yaw: 2.6, scale: 2.6 },
  ];
  const shipProps = [];
  for (const pr of props) {
    shipProps.push({ ...pr, x: pr.x * CELL, z: pr.z * CELL });
    // noMesh: the REAL model is drawn above — without it the renderer also
    // draws its generic crate/machine box on top of every dressed prop
    colliders.push(...pieceColliders(pr.piece, { x: pr.x * CELL, z: pr.z * CELL, yaw: pr.yaw, scale: pr.scale })
      .map(c => ({ ...c, noMesh: true })));
  }

  // ---- the crew (reuses the town shop/dialog ids wholesale) ----
  const npcs = [
    { model: 'RobotExpressive', name: 'Quartermaster BRASS-9', shop: 'blacksmith', mscale: 0.5,
      label: '⚒ Armory', tints: [], x: 8 * CELL, z: 6 * CELL },
    { model: 'Character_Hazmat', name: 'Medtech Sova', shop: 'alchemist', mscale: 0.85,
      label: '🧪 Med Station', tints: [], x: 13.5 * CELL, z: 6 * CELL },
    { model: 'Astronaut_FinnTheFrog', name: 'Artificer Hale', shop: 'arcanum', mscale: 0.62,
      label: '🔮 Requisitions', tints: [], x: 16 * CELL, z: 8.5 * CELL },
    { model: 'Character_Soldier', name: 'Sgt. Vasquez', shop: 'tavern', mscale: 0.85,
      label: '🍺 Crew Deck', tints: [], x: 10 * CELL, z: 12 * CELL },
    { model: null, noModel: true, name: 'Mission Console', shop: 'board',
      label: '📡 Mission Console', x: 17.8 * CELL, z: 14.8 * CELL },
    { model: null, noModel: true, name: 'Sim Pods', shop: 'mode',
      label: '⚔ Change Venture', x: 14.5 * CELL, z: 14.8 * CELL },
    { model: 'Astronaut_BarbaraTheBee', name: 'Drill Instructor Okoye', shop: 'codex', mscale: 0.62,
      label: '📖 Combat numbers', tints: [], x: 6.5 * CELL, z: 14.5 * CELL },
    { model: 'RobotExpressive', name: 'Threat Analyst VIGIL', shop: 'bestiary', mscale: 0.44,
      label: '👁 Threat catalog', tints: [], x: 8.2 * CELL, z: 14.8 * CELL },
  ];

  const grid = {
    w, h, cells, elev, ramps, colliders,
    ship: true, bay: true, shipProps,
    rooms: [{ x: 3, y: 3, w: 18, h: 14, cx: 11, cy: 9 }],
    spawn: { x: 11 * CELL, z: 14 * CELL }, spawnYaw: Math.PI,
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: false,
    portal: { dx: portal.dx, dy: portal.dy, yaw: 0 },
  };
  return {
    grid,
    torches: [], traps: [], ropes: [], placements: [],
    enemySpawns: [], lootSpawns: [],
    explored: new Uint8Array(w * h), hadBoss: false,
    theme: BAY_THEME, mutator: null, layoutId: 'bay',
    npcs, doors: [], homes: [], interiors: [],
  };
}

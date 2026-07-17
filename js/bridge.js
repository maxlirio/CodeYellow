// THE BRIDGE — floor 0. No dealers, no village: a warship control room.
// The north wall is a viewport onto open space. A hologram wall-screen SHOWS
// your operative status and mission log (the content is on the screen, not
// behind a click). The mission console at the back sounds the red alert; the
// breach portal on the east pad only opens once a sortie is confirmed.
import * as THREE from 'three';
import { CELL } from './config.js';
import { G } from './state.js';

const SOLID = 0, FLOOR = 1, STAIRS = 3;

export const BRIDGE_THEME = {
  id: 'bridge', name: 'THE BRIDGE', fog: 0x0a0e14, density: 0.006,
  hemi: 0xd5e4f4, amb: 0x93a1b8, torch: 0x9fd8ec, accent: 0x2fd6c8, portal: 0x2fd6c8,
  sun: true, boost: 1.15,
  tiles: [], props: [], banners: [], bias: [],
};

export function generateBridgeData() {
  // a ROUND command deck: viewport arc forward, holo table center, portal aft.
  // No furniture scattered around — every station is built into the wall.
  const w = 15, h = 15, C = 7, R = 5.6;
  const cells = new Uint8Array(w * h);
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const inR = (x, y) => (x - C) ** 2 + (y - C) ** 2 <= R * R;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inR(x, y)) cells[y * w + x] = FLOOR;

  // breach portal pad on the aft rim — INERT until a sortie is confirmed
  const portal = { x: 5, y: 12 };
  cells[portal.y * w + portal.x] = STAIRS;

  // panoramic viewport: every wall face on the forward hemisphere shows space
  const windows = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cells[y * w + x] !== FLOOR) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || cells[ny * w + nx] !== 0) continue;
      if (y + dy * 0.5 < C - 0.2) windows.push({ cx: x, cy: y, dx, dy });
    }
  }

  // the holo table IS the collision — you lean on it, you don't walk through it
  const colliders = [{ x: C * CELL, z: C * CELL, r: 1.95, y0: 0, h: 1.05, noMesh: true }];

  // stations: interaction points only — the SCREENS are the visuals (sign: false)
  const npcs = [
    { model: null, noModel: true, sign: false, name: 'Holo Table', shop: 'missions',
      label: 'HOLO TABLE — TACTICAL', x: C * CELL, z: C * CELL },
    { model: null, noModel: true, sign: false, name: 'Comms', shop: 'board',
      label: 'COMMS — JOINT OPS', x: 11.9 * CELL, z: C * CELL },
    { model: null, noModel: true, sign: false, name: 'Sim Deck', shop: 'mode',
      label: 'SIM DECK — CHANGE VENTURE', x: 9 * CELL, z: 11.7 * CELL },
    { model: null, noModel: true, sign: false, name: 'Training', shop: 'training',
      label: 'TRAINING — SPEND SKILL POINTS', x: 4.4 * CELL, z: 10.9 * CELL },
  ];

  const grid = {
    w, h, cells, elev, ramps, colliders,
    ship: true, bridge: true, windows, shipProps: [],
    // wall screens: status hologram west, comms east, sim deck aft
    screens: [
      { kind: 'status', x: 1.5 * CELL + 0.15, z: C * CELL, ry: Math.PI / 2 },
      { kind: 'comms', x: 12.5 * CELL - 0.15, z: C * CELL, ry: -Math.PI / 2 },
      { kind: 'sim', x: 9 * CELL, z: 12.5 * CELL - 0.15, ry: Math.PI },
      { kind: 'training', x: 4 * CELL, z: 11.5 * CELL + 0.15, ry: Math.PI },
    ],
    rooms: [{ x: 2, y: 2, w: 11, h: 11, cx: C, cy: C }],
    spawn: { x: C * CELL, z: 9.6 * CELL }, spawnYaw: 0, // wake facing table + stars
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: false,
    portal: { dx: 0, dy: 1, yaw: 0 },
    portalIdle: true, // missions.js lights it when a sortie is confirmed
  };
  return {
    grid,
    torches: [], traps: [], ropes: [], placements: [],
    enemySpawns: [], lootSpawns: [],
    explored: new Uint8Array(w * h), hadBoss: false,
    theme: BRIDGE_THEME, mutator: null, layoutId: 'bridge',
    npcs, doors: [], homes: [], interiors: [],
  };
}

// ---- the hologram status wall ----
// One canvas, one texture; missions.js and equip changes call renderHologram()
// and the wall updates in place. THE CONTENT IS THE SCREEN.
let holoCanvas = null, holoTex = null;

export function getHoloTexture() {
  if (!holoTex) {
    holoCanvas = document.createElement('canvas');
    holoCanvas.width = 1024; holoCanvas.height = 512;
    holoTex = new THREE.CanvasTexture(holoCanvas);
    holoTex.colorSpace = THREE.SRGBColorSpace;
  }
  return holoTex;
}

export function loadReports() {
  try { return JSON.parse(localStorage.getItem('codeyellow_reports') || '[]'); } catch { return []; }
}
export function saveReport(r) {
  const all = [r, ...loadReports()].slice(0, 6);
  try { localStorage.setItem('codeyellow_reports', JSON.stringify(all)); } catch {}
  renderHologram();
}

export function renderHologram() {
  getHoloTexture();
  const c = holoCanvas.getContext('2d');
  const W = holoCanvas.width, H = holoCanvas.height;
  c.clearRect(0, 0, W, H);
  // pane
  c.fillStyle = 'rgba(8, 22, 30, 0.92)';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = '#2fd6c8'; c.lineWidth = 6;
  c.strokeRect(6, 6, W - 12, H - 12);
  c.fillStyle = '#2fd6c8';
  c.font = 'bold 34px Menlo, monospace';
  c.fillText('OPERATIVE STATUS', 36, 58);
  c.fillRect(36, 72, W - 72, 3);

  const p = G.player, run = G.run || {};
  const rows = [];
  if (p) {
    rows.push(`${p.name || 'OPERATIVE'} — ${p.cls?.name?.toUpperCase() || ''} · LV ${run.level ?? 1}`);
    rows.push(`WEAPON   ${G.inv?.weapon?.name?.toUpperCase() || 'STANDARD ISSUE'}`);
    rows.push(`OFFHAND  ${G.inv?.offhand?.name?.toUpperCase() || '—'}`);
    rows.push(`IMPLANT  ${G.inv?.trinket?.name?.toUpperCase() || '—'}`);
    rows.push(`CREDITS ${run.gold ?? 0} · CELLS ${run.arrows ?? 0} · STIMS ${run.potions ?? 0}`);
  } else {
    rows.push('AWAITING OPERATIVE…');
  }
  c.font = '26px Menlo, monospace';
  c.fillStyle = '#bfeeea';
  rows.forEach((r, i) => c.fillText(r, 36, 118 + i * 38));

  c.fillStyle = '#2fd6c8';
  c.font = 'bold 30px Menlo, monospace';
  c.fillText('MISSION LOG', 36, 320);
  c.fillRect(36, 332, W - 72, 3);
  const reps = loadReports();
  c.font = '22px Menlo, monospace';
  if (!reps.length) {
    c.fillStyle = '#6f9a96';
    c.fillText('NO SORTIES ON RECORD. THE HULK WAITS.', 36, 368);
  } else {
    reps.slice(0, 4).forEach((r, i) => {
      c.fillStyle = r.result === 'CLEARED' ? '#7fe8a0' : '#ff8a7a';
      c.fillText(`${r.result === 'CLEARED' ? '[OK]' : '[KIA]'}`, 36, 368 + i * 32);
      c.fillStyle = '#bfeeea';
      c.fillText(`${r.section}  kills ${r.kills}  credits +${r.credits}  ${r.time}s`, 130, 368 + i * 32);
    });
  }
  holoTex.needsUpdate = true;
}

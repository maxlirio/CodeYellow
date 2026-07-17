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
  const w = 24, h = 16;
  const cells = new Uint8Array(w * h);
  const elev = new Uint8Array(w * h);
  const ramps = new Map();
  const colliders = [];
  const set = (x, y, v) => { cells[y * w + x] = v; };

  // the command deck
  for (let y = 3; y <= 12; y++) for (let x = 3; x <= 20; x++) set(x, y, FLOOR);

  // breach portal pad, east side — INERT until a sortie is confirmed
  const portal = { x: 18, y: 7 };
  set(portal.x, portal.y, STAIRS);

  // the VIEWPORT: north-wall window segments (rendered as glass by shipmeshes;
  // the cells behind stay SOLID so nobody walks into space)
  const windows = [];
  for (let x = 5; x <= 15; x++) windows.push({ cx: x, cy: 3, dx: 0, dy: -1 });

  // consoles & furniture (Kenney props, measured colliders flagged noMesh)
  const props = [
    // forward operations rows, facing the stars
    { piece: 'desk_computerScreen', x: 7, z: 4.6, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computer', x: 9.5, z: 4.6, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computerScreen', x: 12, z: 4.6, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computer', x: 14.5, z: 4.6, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computerScreen', x: 17, z: 4.6, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computerScreen', x: 8.2, z: 6.4, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computer', x: 11, z: 6.4, yaw: Math.PI, scale: 3.0 },
    { piece: 'desk_computerScreen', x: 13.8, z: 6.4, yaw: Math.PI, scale: 3.0 },
    // THE MISSION CONSOLE — at the back, under the alert light
    // (Kenney pivots sit at a corner: geometry runs ~5u along +z at yaw 0,
    // so back-row pieces anchor a cell and a half off the south wall)
    { piece: 'desk_computerScreen', x: 10.9, z: 10.4, yaw: 0, scale: 3.6 },
    { piece: 'machine_wirelessCable', x: 13.2, z: 10.6, yaw: 0, scale: 3.0 },
    // comms station gear (west back wall, by the Comms sprite)
    { piece: 'desk_computer', x: 5.6, z: 10.4, yaw: 0, scale: 3.0 },
    { piece: 'satelliteDish', x: 4.2, z: 9.6, yaw: 0.8, scale: 3.0 },
    // sim pods: parked training capsules by the east back wall
    { piece: 'craft_cargoA', x: 15.6, z: 10.6, yaw: 2.4, scale: 2.6 },
    { piece: 'craft_cargoA', x: 17.2, z: 10.2, yaw: 1.9, scale: 2.6 },
    // power + comms gear by the east pad
    { piece: 'machine_generatorLarge', x: 19.4, z: 10.2, yaw: -Math.PI / 2, scale: 3.4 },
    { piece: 'barrels', x: 4.6, z: 4.6, yaw: 0.5, scale: 3.6 },
    { piece: 'machine_barrelLarge', x: 4.2, z: 6.2, yaw: 0, scale: 3.2 },
  ];
  const shipProps = [];
  for (const pr of props) {
    shipProps.push({ ...pr, x: pr.x * CELL, z: pr.z * CELL });
  }

  // stations reuse the interaction system — no dealers, only consoles
  const npcs = [
    { model: null, noModel: true, name: 'Mission Console', shop: 'missions',
      label: 'MISSION CONSOLE', x: 11.5 * CELL, z: 11.3 * CELL },
    { model: null, noModel: true, name: 'Comms', shop: 'board',
      label: 'COMMS — JOINT OPS', x: 6.5 * CELL, z: 11.3 * CELL },
    { model: null, noModel: true, name: 'Sim Pods', shop: 'mode',
      label: 'SIM PODS', x: 16.5 * CELL, z: 11.3 * CELL },
  ];

  const grid = {
    w, h, cells, elev, ramps, colliders,
    ship: true, bridge: true, shipProps, windows,
    rooms: [{ x: 3, y: 3, w: 18, h: 10, cx: 11, cy: 7 }],
    spawn: { x: 11 * CELL, z: 8.5 * CELL }, spawnYaw: Math.PI, // wake facing the stars
    stairs: { x: portal.x * CELL, z: portal.y * CELL, cx: portal.x, cy: portal.y },
    stairsLocked: false,
    portal: { dx: 1, dy: 0, yaw: Math.PI / 2 },
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

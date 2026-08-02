// DIEGETIC TOUCH SCREENS — the station UI lives ON the wall screen. Your
// crosshair becomes a cursor that moves across the glass; the buttons you
// press are part of the world, not an overlay. (The overlay stations still
// exist for things that need typing — joining a room — and via E as a
// fallback.)
import * as THREE from 'three';
import { G } from './state.js';
import { SHOP_ITEMS, SHOP_TABLES, SKILLS } from './config.js';
import { skillRank } from './player.js';
import { sfx } from './audio.js';

const SCREENS = new Map(); // mesh -> screen state
let actions = {}; // { buyItem, buySkill, switchMode, openBoard }
export function setTouchActions(a) { actions = { ...actions, ...a }; }

const TEAL = '#2fd6c8', DIM = '#175a54', TXT = '#bfeeea', BAD = '#7f4a44', GOLD = '#ffce2e';

export function registerTouchScreen(mesh, kind) {
  if (SCREENS.has(mesh)) return SCREENS.get(mesh);
  const W = 640, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;
  const scr = { mesh, kind, canvas, tex, W, H, buttons: [], cursor: null, hover: null, flashT: 0, flashLabel: null };
  SCREENS.set(mesh, scr);
  draw(scr);
  return scr;
}

export function isTouchScreen(mesh) { return SCREENS.has(mesh); }

// called every frame with the crosshair ray's hit (or null)
export function updateTouchCursor(mesh, uv) {
  let hoveredAny = false;
  for (const [m, scr] of SCREENS) {
    if (m === mesh && uv) {
      scr.cursor = { x: uv.x * scr.W, y: (1 - uv.y) * scr.H };
      scr.hover = scr.buttons.find((b) =>
        scr.cursor.x >= b.x && scr.cursor.x <= b.x + b.w && scr.cursor.y >= b.y && scr.cursor.y <= b.y + b.h) || null;
      hoveredAny = true;
      draw(scr);
    } else if (scr.cursor) {
      scr.cursor = null; scr.hover = null;
      draw(scr);
    }
  }
  return hoveredAny;
}

// click the screen the crosshair is on; true if the screen consumed it
export function touchScreenClick(mesh, uv = null) {
  const scr = SCREENS.get(mesh);
  if (!scr) return false;
  // resolve the pressed button from THIS click's uv against freshly drawn
  // buttons — never from a cached hover (staleness = phantom dead buttons)
  if (uv) scr.cursor = { x: uv.x * scr.W, y: (1 - uv.y) * scr.H };
  draw(scr);
  const hit = scr.cursor && scr.buttons.find((b) =>
    scr.cursor.x >= b.x && scr.cursor.x <= b.x + b.w && scr.cursor.y >= b.y && scr.cursor.y <= b.y + b.h);
  if (hit?.cb) {
    scr.flashT = 0.35;
    scr.flashLabel = hit.label;
    sfx.key();
    hit.cb();
    draw(scr);
  }
  return true; // aiming at a touch screen never falls through to the gun
}

export function tickTouchScreens(dt) {
  for (const scr of SCREENS.values()) {
    if (scr.flashT > 0) { scr.flashT -= dt; if (scr.flashT <= 0) draw(scr); }
  }
}

// wipe registrations when a floor's meshes are torn down
export function clearTouchScreens() { SCREENS.clear(); }

// ---------------- drawing ----------------
function frame(scr, title, sub) {
  const c = scr.canvas.getContext('2d');
  c.clearRect(0, 0, scr.W, scr.H);
  c.fillStyle = 'rgba(6, 18, 24, 0.96)';
  c.fillRect(0, 0, scr.W, scr.H);
  c.strokeStyle = TEAL; c.lineWidth = 4;
  c.strokeRect(4, 4, scr.W - 8, scr.H - 8);
  c.fillStyle = TEAL;
  c.font = 'bold 30px Menlo, monospace';
  c.textAlign = 'left';
  c.fillText(title, 26, 44);
  c.textAlign = 'right';
  c.font = '20px Menlo, monospace';
  c.fillStyle = GOLD;
  if (sub) c.fillText(sub, scr.W - 26, 44);
  c.fillStyle = DIM;
  c.fillRect(24, 56, scr.W - 48, 2);
  return c;
}

function button(scr, c, b) {
  const hot = scr.hover?.label === b.label; // by label — arrays rebuild every frame
  const flash = scr.flashT > 0 && scr.flashLabel === b.label;
  c.fillStyle = flash ? TEAL : hot ? 'rgba(47,214,200,0.22)' : 'rgba(47,214,200,0.07)';
  c.fillRect(b.x, b.y, b.w, b.h);
  c.strokeStyle = b.off ? BAD : hot ? TEAL : DIM;
  c.lineWidth = hot ? 3 : 2;
  c.strokeRect(b.x, b.y, b.w, b.h);
  c.textAlign = 'left';
  c.font = 'bold 20px Menlo, monospace';
  c.fillStyle = flash ? '#04121a' : b.off ? BAD : TXT;
  c.fillText(b.label, b.x + 14, b.y + 27);
  if (b.right) {
    c.textAlign = 'right';
    c.fillStyle = flash ? '#04121a' : b.off ? BAD : GOLD;
    c.fillText(b.right, b.x + b.w - 14, b.y + 27);
  }
  if (b.desc) {
    c.textAlign = 'left';
    c.font = '15px Menlo, monospace';
    c.fillStyle = flash ? '#0a2630' : '#6f9a96';
    c.fillText(b.desc, b.x + 14, b.y + 47);
  }
}

function cursorDot(scr, c) {
  if (!scr.cursor) return;
  c.beginPath();
  c.arc(scr.cursor.x, scr.cursor.y, 7, 0, Math.PI * 2);
  c.strokeStyle = '#ffffff'; c.lineWidth = 2.5;
  c.stroke();
  c.beginPath();
  c.arc(scr.cursor.x, scr.cursor.y, 2, 0, Math.PI * 2);
  c.fillStyle = TEAL;
  c.fill();
}

function draw(scr) {
  scr.buttons = [];
  if (scr.kind === 'armory') drawArmory(scr);
  else if (scr.kind === 'training') drawTraining(scr);
  else if (scr.kind === 'sim') drawSim(scr);
  else if (scr.kind === 'comms') drawComms(scr);
  scr.tex.needsUpdate = true;
}

function drawArmory(scr) {
  const c = frame(scr, 'THE ARMORY', `${G.run?.gold ?? 0} CREDITS`);
  const ids = SHOP_TABLES.armory.items;
  const colW = (scr.W - 48 - 12) / 2;
  ids.forEach((id, i) => {
    const item = SHOP_ITEMS.find((x) => x.id === id);
    if (!item) return;
    const bought = G.run?.buys?.[item.id] || 0;
    const price = item.base + bought * item.grow;
    const afford = (G.run?.gold ?? 0) >= price;
    const col = i % 2, row = (i / 2) | 0;
    const b = {
      x: 24 + col * (colW + 12), y: 72 + row * 62, w: colW, h: 54,
      label: item.name, right: `${price}c`, desc: item.desc.slice(0, 34), off: !afford,
      cb: () => { if (afford) actions.buyItem?.(item.id, price); draw(scr); },
    };
    scr.buttons.push(b);
    button(scr, c, b);
  });
  cursorDot(scr, c);
}

function drawTraining(scr) {
  const pts = G.run?.skillPts || 0;
  const c = frame(scr, 'TRAINING', `${pts} POINT${pts === 1 ? '' : 'S'}`);
  const colW = (scr.W - 48 - 12) / 2;
  SKILLS.forEach((sk, i) => {
    const r = skillRank(sk.id);
    const maxed = r >= sk.max;
    const can = !maxed && pts > 0;
    const col = i % 2, row = (i / 2) | 0;
    const b = {
      x: 24 + col * (colW + 12), y: 72 + row * 74, w: colW, h: 64,
      label: sk.name, right: maxed ? 'MAX' : '●'.repeat(r) + '○'.repeat(sk.max - r),
      desc: sk.desc.slice(0, 34), off: !can,
      cb: () => { if (can) actions.buySkill?.(sk.id); draw(scr); },
    };
    scr.buttons.push(b);
    button(scr, c, b);
  });
  cursorDot(scr, c);
}

function drawSim(scr) {
  const c = frame(scr, 'SIM DECK', G.runMode?.toUpperCase());
  const modes = [
    { id: 'campaign', label: 'CAMPAIGN', desc: 'clear the sections, win the war' },
    { id: 'horde', label: 'LAST STAND', desc: 'build and survive the waves' },
    { id: 'duel', label: 'DUEL', desc: 'PvP in the arena' },
  ];
  modes.forEach((m, i) => {
    const active = G.runMode === m.id;
    const b = {
      x: 24, y: 80 + i * 84, w: scr.W - 48, h: 70,
      label: m.label + (active ? '  — RUNNING' : ''), desc: m.desc, off: active,
      cb: () => { if (!active) actions.switchMode?.(m.id); },
    };
    scr.buttons.push(b);
    button(scr, c, b);
  });
  cursorDot(scr, c);
}

function drawComms(scr) {
  const c = frame(scr, 'COMMS — JOINT OPS', G.net.role.toUpperCase());
  c.textAlign = 'left';
  c.font = '18px Menlo, monospace';
  c.fillStyle = TXT;
  c.fillText('Open rooms live on the board. Joining', 26, 100);
  c.fillText('needs a code — the board opens full-size.', 26, 126);
  const b = {
    x: 24, y: 160, w: scr.W - 48, h: 70,
    label: 'OPEN THE JOINT-OPS BOARD', desc: 'host, join, or browse open rooms',
    cb: () => actions.openBoard?.(),
  };
  scr.buttons.push(b);
  button(scr, c, b);
  cursorDot(scr, c);
}


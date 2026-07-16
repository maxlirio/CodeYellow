// Commander view (M): between Last Stand waves and in duels, an overhead map
// of the whole field. Click one of your minions, then click ground to station
// them there; click your own marker (or "All follow me") to recall them.
import { G } from './state.js';
import { minions } from './minions.js';
import { machines } from './machines.js';
import { netSend, isAuthority, myId } from './net.js';
import { addMsg, show, hide } from './ui.js';

const CELL = 4;
export const commander = { open: false };
let canvas = null, selected = null, raf = 0;

function layout() {
  const fs = G.floors.get(G.floor);
  if (!fs?.grid) return null;
  const g = fs.grid;
  const s = Math.min(canvas.width / (g.w * CELL), canvas.height / (g.h * CELL));
  return { fs, g, s };
}
const toPx = (L, x, z) => [x * L.s, z * L.s];

function draw() {
  const L = layout();
  if (!L) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d0a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { g } = L;
  const cs = CELL * L.s;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const c = g.cells[y * g.w + x];
    if (c === 0) continue;
    ctx.fillStyle = g.elev[y * g.w + x] ? '#3d3a52' : c === 5 ? '#5a4a33' : '#242030';
    ctx.fillRect(x * cs - cs / 2, y * cs - cs / 2, cs - 1, cs - 1);
  }
  // player builds & machines
  const b = g.builds;
  if (b) {
    ctx.fillStyle = '#8a6a3d';
    for (const p of b.pieces) {
      const [px, pz] = toPx(L, p.x, p.z);
      ctx.fillRect(px - 3, pz - 3, 6, 6);
    }
  }
  ctx.font = `${Math.max(10, cs * 0.9)}px serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const m of machines) {
    if (m.f !== G.floor) continue;
    const [px, pz] = toPx(L, m.x, m.z);
    ctx.fillText(m.kind === 'cannon' ? '' : '', px, pz);
  }
  // enemies (mid-combat pvp view)
  const fs = L.fs;
  ctx.fillStyle = '#cc4444';
  for (const e of fs.enemies || []) {
    if (e.state === 'dead' || e.state === 'inactive') continue;
    const [px, pz] = toPx(L, e.obj.position.x, e.obj.position.z);
    ctx.beginPath(); ctx.arc(px, pz, 3, 0, Math.PI * 2); ctx.fill();
  }
  // my minions (workers gray, fighters blue), stations, selection ring
  for (const m of minions) {
    if (m.dead || m.floor !== G.floor) continue;
    const [px, pz] = toPx(L, m.obj.position.x, m.obj.position.z);
    if (m.order && !m.workPost) {
      const [ox, oz] = toPx(L, m.order.x, m.order.z);
      ctx.strokeStyle = '#5588cc55'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, pz); ctx.lineTo(ox, oz); ctx.stroke();
      ctx.strokeStyle = '#88bbff';
      ctx.strokeRect(ox - 4, oz - 4, 8, 8);
    }
    ctx.fillStyle = m.cfg.worker ? '#aaa89f' : m.owner === myId() ? '#5ab0ff' : '#3d7fbf';
    ctx.beginPath(); ctx.arc(px, pz, 5, 0, Math.PI * 2); ctx.fill();
    if (m === selected) {
      ctx.strokeStyle = '#ffd35c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, pz, 8, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // me + party
  const drawP = (pos, color) => {
    const [px, pz] = toPx(L, pos.x, pos.z);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(px, pz, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, pz, 6, 0, Math.PI * 2); ctx.stroke();
  };
  for (const r of G.remotes.values()) if (!r.dead && r.floor === G.floor) drawP(r.obj.position, '#4fd67f');
  if (G.player && !G.player.dead) drawP(G.player.obj.position, '#7fe860');

  if (commander.open) raf = requestAnimationFrame(draw);
}

function setOrder(m, order) {
  if (isAuthority()) m.order = order;
  else netSend({ t: 'morder', id: m.id, x: order ? order.x : null, z: order ? order.z : null });
  if (!isAuthority()) m.order = order; // optimistic, host confirms by behavior
}

function onClick(ev) {
  const L = layout();
  if (!L) return;
  const r = canvas.getBoundingClientRect();
  const mx = (ev.clientX - r.left) * (canvas.width / r.width);
  const mz = (ev.clientY - r.top) * (canvas.height / r.height);
  // pick one of MY minions first
  let hit = null, hd = 12;
  for (const m of minions) {
    if (m.dead || m.floor !== G.floor || m.owner !== myId() || m.cfg.worker || m.cfg.phantom) continue;
    const [px, pz] = toPx(L, m.obj.position.x, m.obj.position.z);
    const d = Math.hypot(px - mx, pz - mz);
    if (d < hd) { hd = d; hit = m; }
  }
  if (hit) { selected = hit; return; }
  if (!selected) return;
  // clicked my own marker → follow me again
  if (G.player) {
    const [px, pz] = toPx(L, G.player.obj.position.x, G.player.obj.position.z);
    if (Math.hypot(px - mx, pz - mz) < 14) {
      setOrder(selected, null);
      addMsg(`${selected.cfg.name} falls in behind you.`);
      selected = null;
      return;
    }
  }
  // station at the clicked spot
  const wx = mx / L.s, wz = mz / L.s;
  const cx = Math.round(wx / CELL), cy = Math.round(wz / CELL);
  if (cx < 1 || cy < 1 || cx >= L.g.w - 1 || cy >= L.g.h - 1 || L.g.cells[cy * L.g.w + cx] === 0) return;
  setOrder(selected, { x: wx, z: wz });
  addMsg(`${selected.cfg.name} will hold that ground.`);
  selected = null;
}

export function initCommander() {
  canvas = document.getElementById('cmdCanvas');
  canvas.addEventListener('click', onClick);
  document.getElementById('btnCmdFollowAll').onclick = () => {
    for (const m of minions) {
      if (m.dead || m.owner !== myId() || m.cfg.worker || m.cfg.phantom) continue;
      setOrder(m, null);
    }
    addMsg('Your company falls in behind you.');
  };
}

export function openCommandMap() {
  if (commander.open) return;
  commander.open = true;
  selected = null;
  G.mode = 'merchant';
  document.exitPointerLock?.();
  show('commandMap');
  draw();
}

export function closeCommandMap() {
  if (!commander.open) return;
  commander.open = false;
  cancelAnimationFrame(raf);
  hide('commandMap');
}

// host applies a guest's order for their own minion
export function applyMinionOrder(m, pid) {
  const mn = minions.find(x => x.id === m.id);
  if (!mn || mn.owner !== pid) return;
  mn.order = m.x == null ? null : { x: m.x, z: m.z };
}

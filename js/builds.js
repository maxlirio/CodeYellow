// Fortnite-style structural building (Last Stand): POSTS snap to the corner
// lattice and stack on floors; FLOORS lock in only when four posts form a
// rectangle beneath and fit themselves to it; RAMPS place anywhere but snap
// against floors; WALLS snap to the edge between two posts. Multi-storey towers
// work: build posts on a floor, another floor on those, and so on.
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { makePiece } from './assets.js';
import { groundHeightAt, hasLineOfSight, FLOOR } from './dungeon.js';
import { PLATFORM_H } from './config.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { netSend } from './net.js';
import { placeWall } from './walls.js';
import { spawnBurst } from './fx.js';

const CELL = 4, LVL = 4, MAX_H = 12;

export const BUILD_PIECES = [
  { id: 'post', label: 'Post', cost: 10, icon: '𝖨', hint: 'snaps to corners; stack them on floors' },
  { id: 'floor', label: 'Floor', cost: 20, icon: '▦', hint: 'needs 4 posts in a rectangle beneath' },
  { id: 'ramp', label: 'Ramp', cost: 15, icon: '◢', hint: 'anywhere; snaps against floors' },
  { id: 'wall', label: 'Wall', cost: 25, icon: '▮', hint: 'snaps between two posts' },
  { id: 'barricade', label: 'Barricade', cost: 30, icon: '▣', hint: 'crate pile; enemies smash it' },
];

export const buildState = { on: false, idx: 0, ghost: null, ghostKey: '', valid: false, target: null };

function ensureBuilds(fs) {
  if (!fs.grid.builds) {
    fs.grid.builds = {
      posts: new Map(),   // 'i,j' -> Set(topHeights)
      floors: new Map(),  // cellIdx -> [heights]
      ramps: new Map(),   // cellIdx -> {dx,dy,base}
      walls: new Set(),   // edgeKey
    };
  }
  return fs.grid.builds;
}

export function clearBuilds() {
  buildState.on = false;
  if (buildState.ghost) { G.scene.remove(buildState.ghost); buildState.ghost = null; }
}

const cornerWorld = (i, j) => ({ x: i * CELL - CELL / 2, z: j * CELL - CELL / 2 });
const postTops = (b, i, j) => b.posts.get(i + ',' + j) || new Set();

// ---------- aim & snapping ----------
// look down to build near, look up to build far: the aim ray is projected onto
// the ground plane at your feet, clamped to range and line of sight
function aimPoint(range = 11) {
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  const from = G.player.obj.position;
  const flat = Math.hypot(dir.x, dir.z) || 0.001;
  let dist = range;
  if (dir.y < -0.06) dist = Math.min(range, (1.62 / -dir.y) * flat);
  dist = Math.max(2.2, dist);
  let hit = null;
  for (let d = 2.2; d <= dist; d += 0.5) {
    const px = from.x + (dir.x / flat) * d, pz = from.z + (dir.z / flat) * d;
    if (!hasLineOfSight(from.x, from.z, px, pz)) break;
    hit = { x: px, z: pz };
  }
  return hit;
}

// what would this piece do right now? returns {valid, ...placement} or null
export function planPiece(pieceId) {
  const fs = G.floors.get(G.floor);
  if (!fs?.grid) return null;
  const b = ensureBuilds(fs);
  const hit = aimPoint();
  if (!hit) return null;
  const py = G.player.obj.position.y;

  if (pieceId === 'post') {
    // snap to the nearest lattice corner; base = whatever you'd stand on there
    const i = Math.round((hit.x + CELL / 2) / CELL), j = Math.round((hit.z + CELL / 2) / CELL);
    const cw = cornerWorld(i, j);
    const base = groundHeightAt(cw.x, cw.z, py, fs.grid);
    const top = base + LVL;
    const tops = postTops(b, i, j);
    const valid = top <= MAX_H && !tops.has(top) && cellOpen(fs, cw.x, cw.z);
    return { valid, kind: 'post', i, j, base, x: cw.x, z: cw.z };
  }

  if (pieceId === 'floor') {
    const cx = Math.round(hit.x / CELL), cy = Math.round(hit.z / CELL);
    // the floor locks to the rectangle of posts beneath: all 4 corners must
    // carry posts topping out at the same height
    const sets = [postTops(b, cx, cy), postTops(b, cx + 1, cy), postTops(b, cx, cy + 1), postTops(b, cx + 1, cy + 1)];
    let h = null;
    for (const cand of [...sets[0]].sort((a, c) => a - c)) {
      if (sets.every(s => s.has(cand)) && !(b.floors.get(cy * fs.grid.w + cx) || []).includes(cand)) { h = cand; break; }
    }
    return { valid: h !== null, kind: 'floor', cx, cy, h: h ?? py + LVL, x: cx * CELL, z: cy * CELL };
  }

  if (pieceId === 'ramp') {
    const cx = Math.round(hit.x / CELL), cy = Math.round(hit.z / CELL);
    const idx = cy * fs.grid.w + cx;
    const base = groundHeightAt(cx * CELL, cy * CELL, py, fs.grid);
    // lock the ramp against an adjacent floor one level up, if there is one
    let dir = null;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nIdx = (cy + d[1]) * fs.grid.w + (cx + d[0]);
      const fls = b.floors.get(nIdx) || [];
      const plat = fs.grid.elev[nIdx] === 1 && base === 0;
      if (fls.includes(base + LVL) || plat) { dir = { dx: d[0], dy: d[1] }; break; }
    }
    if (!dir) {
      // free placement: face away from the camera
      const v = new THREE.Vector3();
      G.camera.getWorldDirection(v);
      dir = Math.abs(v.x) > Math.abs(v.z) ? { dx: Math.sign(v.x), dy: 0 } : { dx: 0, dy: Math.sign(v.z) };
    }
    const valid = !b.ramps.has(idx) && !fs.grid.ramps.has(idx) && fs.grid.cells[idx] === FLOOR && cellOpen(fs, cx * CELL, cy * CELL);
    return { valid, kind: 'ramp', cx, cy, base, dir, x: cx * CELL, z: cy * CELL };
  }

  if (pieceId === 'wall') {
    // snap to the nearest cell edge (the line between two lattice posts)
    const cx = Math.round(hit.x / CELL), cy = Math.round(hit.z / CELL);
    const ox = hit.x - cx * CELL, oz = hit.z - cy * CELL;
    const d = Math.abs(ox) > Math.abs(oz)
      ? { dx: Math.sign(ox) || 1, dy: 0 }
      : { dx: 0, dy: Math.sign(oz) || 1 };
    const ex = cx * CELL + d.dx * CELL / 2, ez = cy * CELL + d.dy * CELL / 2;
    const base = groundHeightAt(cx * CELL, cy * CELL, py, fs.grid);
    const key = `${cx},${cy},${d.dx},${d.dy},${base}`;
    const altKey = `${cx + d.dx},${cy + d.dy},${-d.dx},${-d.dy},${base}`;
    const valid = !b.walls.has(key) && !b.walls.has(altKey);
    return { valid, kind: 'wall', cx, cy, d, base, key, x: ex, z: ez, yaw: d.dx !== 0 ? Math.PI / 2 : 0 };
  }

  if (pieceId === 'barricade') {
    const cx = Math.round(hit.x / CELL), cy = Math.round(hit.z / CELL);
    const idx = cy * fs.grid.w + cx;
    const valid = fs.grid.cells[idx] === FLOOR && !fs.grid.elev[idx] &&
      Math.hypot(cx * CELL - G.player.obj.position.x, cy * CELL - G.player.obj.position.z) > 2;
    return { valid, kind: 'barricade', cx, cy, x: cx * CELL, z: cy * CELL };
  }
  return null;
}

function cellOpen(fs, x, z) {
  const cx = Math.round(x / CELL), cy = Math.round(z / CELL);
  if (cx < 1 || cy < 1 || cx >= fs.grid.w - 1 || cy >= fs.grid.h - 1) return false;
  return fs.grid.cells[cy * fs.grid.w + cx] === FLOOR;
}

// ---------- apply (local + mirrored to peers) ----------
export function applyBuild(m, broadcast = true) {
  const fs = G.floors.get(m.f ?? G.floor);
  if (!fs?.grid) return false;
  const b = ensureBuilds(fs);
  const group = fs.meshGroup || G.scene;

  if (m.kind === 'post') {
    const key = m.i + ',' + m.j;
    if (!b.posts.has(key)) b.posts.set(key, new Set());
    const top = m.base + LVL;
    if (b.posts.get(key).has(top)) return false;
    b.posts.get(key).add(top);
    const obj = makePiece('pillar');
    obj.scale.set(0.55, 1, 0.55);
    obj.position.set(m.x, m.base, m.z);
    group.add(obj);
    fs.grid.colliders.push({ x: m.x, z: m.z, r: 0.42 });
  } else if (m.kind === 'floor') {
    const idx = m.cy * fs.grid.w + m.cx;
    if (!b.floors.has(idx)) b.floors.set(idx, []);
    if (b.floors.get(idx).includes(m.h)) return false;
    b.floors.get(idx).push(m.h);
    const obj = makePiece('floor_wood_large');
    obj.position.set(m.x, m.h, m.z);
    group.add(obj);
  } else if (m.kind === 'ramp') {
    const idx = m.cy * fs.grid.w + m.cx;
    if (b.ramps.has(idx)) return false;
    b.ramps.set(idx, { dx: m.dir.dx, dy: m.dir.dy, base: m.base });
    const obj = makePiece('stairs');
    obj.scale.set(0.8, PLATFORM_H / 5.1, 1);
    obj.position.set(m.x + m.dir.dx * CELL / 2, m.base, m.z + m.dir.dy * CELL / 2);
    obj.rotation.y = Math.atan2(-m.dir.dx, -m.dir.dy);
    group.add(obj);
  } else if (m.kind === 'wall') {
    if (b.walls.has(m.key)) return false;
    b.walls.add(m.key);
    const obj = makePiece('wall');
    obj.position.set(m.x, m.base, m.z);
    obj.rotation.y = m.yaw;
    group.add(obj);
    // three colliders approximate the wall line
    const alongX = m.yaw === 0 ? 1 : 0, alongZ = m.yaw === 0 ? 0 : 1;
    for (const o of [-1.35, 0, 1.35]) {
      fs.grid.colliders.push({ x: m.x + alongX * o, z: m.z + alongZ * o, r: 0.6 });
    }
  }
  if ((m.f ?? G.floor) === G.floor) { sfx.bones(); spawnBurst(new THREE.Vector3(m.x, (m.base ?? m.h ?? 0) + 1, m.z), 0xccbb88, 8, 3, 0.1, 0.35); }
  if (broadcast) netSend({ t: 'build', ...m, f: G.floor });
  return true;
}

// ---------- build mode UI ----------
export function toggleBuildMode(force = null) {
  const want = force ?? !buildState.on;
  if (want === buildState.on) return;
  buildState.on = want;
  if (!want && buildState.ghost) { G.scene.remove(buildState.ghost); buildState.ghost = null; }
  if (want) {
    const bp = BUILD_PIECES[buildState.idx];
    addMsg(`🔨 BUILD — ${bp.label} (${bp.cost}g): ${bp.hint}. Scroll to switch, click to place, B to exit.`);
  }
}

export function cycleBuildPiece(dir) {
  if (!buildState.on) return;
  buildState.idx = (buildState.idx + dir + BUILD_PIECES.length) % BUILD_PIECES.length;
  if (buildState.ghost) { G.scene.remove(buildState.ghost); buildState.ghost = null; }
  const bp = BUILD_PIECES[buildState.idx];
  addMsg(`🔨 ${bp.label} — ${bp.cost}g · ${bp.hint}`);
}

function makeGhostFor(plan) {
  let obj;
  if (plan.kind === 'post') { obj = makePiece('pillar'); obj.scale.set(0.55, 1, 0.55); }
  else if (plan.kind === 'floor') obj = makePiece('floor_wood_large');
  else if (plan.kind === 'ramp') { obj = makePiece('stairs'); obj.scale.set(0.8, PLATFORM_H / 5.1, 1); }
  else if (plan.kind === 'wall') obj = makePiece('wall');
  else { obj = makePiece('crates_stacked'); obj.scale.set(1.25, 1.15, 1.25); }
  obj.traverse((n) => {
    if (n.isMesh) {
      n.material = n.material.clone();
      n.material.transparent = true;
      n.material.opacity = 0.45;
      n.material.side = THREE.DoubleSide;
    }
  });
  G.scene.add(obj);
  return obj;
}

export function updateBuildGhost() {
  if (!buildState.on || !G.player || G.player.dead) return;
  const bp = BUILD_PIECES[buildState.idx];
  const plan = planPiece(bp.id);
  buildState.target = plan;
  if (!plan) { if (buildState.ghost) buildState.ghost.visible = false; buildState.valid = false; return; }
  const key = bp.id;
  if (!buildState.ghost || buildState.ghostKey !== key) {
    if (buildState.ghost) G.scene.remove(buildState.ghost);
    buildState.ghost = makeGhostFor(plan);
    buildState.ghostKey = key;
  }
  const g = buildState.ghost;
  g.visible = true;
  if (plan.kind === 'post') g.position.set(plan.x, plan.base, plan.z);
  else if (plan.kind === 'floor') g.position.set(plan.x, plan.h, plan.z);
  else if (plan.kind === 'ramp') {
    g.position.set(plan.x + plan.dir.dx * CELL / 2, plan.base, plan.z + plan.dir.dy * CELL / 2);
    g.rotation.y = Math.atan2(-plan.dir.dx, -plan.dir.dy);
  } else if (plan.kind === 'wall') {
    g.position.set(plan.x, plan.base, plan.z);
    g.rotation.y = plan.yaw;
  } else g.position.set(plan.x, 0, plan.z);
  buildState.valid = plan.valid && G.run.gold >= bp.cost;
  const tint = buildState.valid ? 0x66ff88 : 0xff5555;
  g.traverse((n) => { if (n.isMesh) n.material.color.setHex(tint); });
}

// click while in build mode; returns true if the click was consumed
export function placeCurrentBuild() {
  if (!buildState.on) return false;
  const bp = BUILD_PIECES[buildState.idx];
  const plan = buildState.target;
  if (!plan || !plan.valid) { addMsg('It won’t fit there.', 'bad'); return true; }
  if (G.run.gold < bp.cost) { addMsg(`Need ${bp.cost}g.`, 'bad'); return true; }
  let ok = false;
  if (plan.kind === 'barricade') {
    ok = placeWall(G.floor, plan.cx, plan.cy, { barricade: true, hp: 80, dur: Infinity, piece: 'crates_stacked' });
  } else {
    ok = applyBuild(plan);
  }
  if (ok) {
    G.run.gold -= bp.cost;
    addMsg(`${bp.label} built (-${bp.cost}g)`);
    refreshHud();
  }
  return true;
}

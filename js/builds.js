// Fortnite-style structural building (Last Stand): POSTS snap to the corner
// lattice and stack on floors; FLOORS lock in only when four posts form a
// rectangle beneath and fit themselves to it; RAMPS place anywhere but snap
// against floors; WALLS snap to the edge between two posts. Multi-storey towers
// work: build posts on a floor, another floor on those, and so on.
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { makePiece } from './assets.js';
import { groundHeightAt, hasLineOfSight, FLOOR, cellOccupied, pointOccupied } from './dungeon.js';
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

// every placed piece has HP — enemies smash what stands in their way
export const BUILD_HP = { post: 60, floor: 90, ramp: 70, wall: 140 };

export function ensureBuilds(fs) {
  if (!fs.grid.builds) {
    fs.grid.builds = {
      posts: new Map(),   // 'i,j' -> Set(topHeights)
      floors: new Map(),  // cellIdx -> [heights]
      ramps: new Map(),   // cellIdx -> {dx,dy,base}
      walls: new Set(),   // edgeKey
      pieces: [],         // {key, kind, f, hp, maxHp, obj, cols, ...placement}
    };
  }
  if (!fs.grid.builds.pieces) fs.grid.builds.pieces = [];
  return fs.grid.builds;
}

// pieces are identified by a content key (kind + position + height), identical
// on every peer regardless of message order
const postKey = (i, j, top) => `p:${i},${j}:${top}`;
const floorKey = (idx, h) => `f:${idx}:${h}`;
const rampKey = (idx) => `r:${idx}`;

export function pieceByKey(f, key) {
  const fs = G.floors.get(f);
  return fs?.grid?.builds?.pieces.find(p => p.key === key) || null;
}

// nearest attackable piece (post/wall/ramp/machine — floors are hit via posts)
export function nearestBuildPiece(f, x, z, maxD = 2.4, y = 0) {
  const fs = G.floors.get(f);
  const pieces = fs?.grid?.builds?.pieces;
  if (!pieces) return null;
  let best = null, bd = maxD;
  for (const p of pieces) {
    if (p.kind === 'floor') continue;
    if (p.base !== undefined && (y < p.base - 1 || y > p.base + 5)) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// the structurally weakest piece nearby — what a sieger goes for ("weak spots":
// already-damaged pieces first, then whatever is closest)
export function weakestBuildPieceNear(f, x, z, maxD = 26) {
  const fs = G.floors.get(f);
  const pieces = fs?.grid?.builds?.pieces;
  if (!pieces?.length) return null;
  let best = null, bs = Infinity;
  for (const p of pieces) {
    if (p.kind === 'floor') continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d > maxD) continue;
    const score = (p.hp / p.maxHp) * 40 + d;
    if (score < bs) { bs = score; best = p; }
  }
  return best;
}

export function damageBuild(p, amount, fromNet = false) {
  if (!p || p.dead) return;
  p.hp -= amount;
  const fs = G.floors.get(p.f);
  if (p.f === G.floor) spawnBurst(new THREE.Vector3(p.x, (p.base ?? 0) + 1.4, p.z), 0xbb9966, 6, 3, 0.1, 0.3);
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'bhp', f: p.f, key: p.key, hp: p.hp });
  if (p.hp <= 0) destroyBuild(p, fromNet);
}

// cascade=true for pieces destroyed BY a collapse — every peer derives those
// from the same trigger, so they are not re-broadcast
export function destroyBuild(p, fromNet = false, cascade = false) {
  if (!p || p.dead) return;
  const fs = G.floors.get(p.f);
  if (!fs?.grid?.builds) return;
  const b = fs.grid.builds;
  p.dead = true;
  const pi = b.pieces.indexOf(p);
  if (pi >= 0) b.pieces.splice(pi, 1);
  p.obj?.parent?.remove(p.obj);
  if (p.cols) fs.grid.colliders = fs.grid.colliders.filter(c => !p.cols.includes(c));
  if (p.kind === 'post') b.posts.get(p.i + ',' + p.j)?.delete(p.base + LVL);
  else if (p.kind === 'floor') {
    const fl = b.floors.get(p.idx);
    if (fl) { const k = fl.indexOf(p.h); if (k >= 0) fl.splice(k, 1); }
  } else if (p.kind === 'ramp') b.ramps.delete(p.idx);
  else if (p.kind === 'wall') b.walls.delete(p.wkey);
  else if (p.kind === 'machine') p.onDestroy?.(p);
  if (p.f === G.floor) {
    spawnBurst(new THREE.Vector3(p.x, (p.base ?? p.h ?? 0) + 1.2, p.z), 0xccaa77, 16, 5, 0.14, 0.5);
    sfx.bones();
  }
  if (G.net.role === 'host' && !fromNet && !cascade) netSend({ t: 'bdie', f: p.f, key: p.key });
  // a felled post can bring a storey down with it — but supports crumbled BY a
  // collapse must not re-trigger it (the storey is already coming down)
  if (p.kind === 'post' && !cascade) checkCollapse(fs, p);
}

// ---- structural collapse ----
// A floor slab needs its 4 corner posts. Lose a post and drop to half support
// (2 or fewer): the storey gives way — its remaining supports crumble, and the
// slab plus EVERYTHING stacked above drops onto whatever surface is next below.
function checkCollapse(fs, post) {
  const b = fs.grid.builds;
  const top = post.base + LVL;
  for (const [cx, cy] of [[post.i - 1, post.j - 1], [post.i, post.j - 1], [post.i - 1, post.j], [post.i, post.j]]) {
    const idx = cy * fs.grid.w + cx;
    const fl = b.floors.get(idx);
    if (!fl || !fl.includes(top)) continue;
    const corners = [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]];
    const supports = corners.filter(([i, j]) => (b.posts.get(i + ',' + j) || new Set()).has(top)).length;
    if (supports > 2) continue;
    collapseStorey(fs, cx, cy, top);
  }
}

function collapseStorey(fs, cx, cy, h) {
  const b = fs.grid.builds;
  const idx = cy * fs.grid.w + cx;
  // where does it land? the next surface below: another slab, a platform, or dirt
  let landing = fs.grid.elev[idx] ? PLATFORM_H : 0;
  for (const fh of (b.floors.get(idx) || [])) if (fh < h) landing = Math.max(landing, fh);
  const delta = h - landing;
  if (delta <= 0) return;
  const corners = [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]];
  const isCorner = (p) => corners.some(([i, j]) => p.i === i && p.j === j);
  const nearCell = (p) => Math.abs(p.x - cx * CELL) <= CELL * 0.75 && Math.abs(p.z - cy * CELL) <= CELL * 0.75;
  // 1) the storey's remaining supports crumble (posts topping at h, walls of that storey)
  for (const p of [...b.pieces]) {
    if (p.kind === 'post' && isCorner(p) && p.base + LVL === h) destroyBuild(p, true, true);
    else if (p.kind === 'wall' && nearCell(p) && p.base === h - LVL) destroyBuild(p, true, true);
  }
  // 2) everything at or above h on this cell rides down by delta and lands
  for (const p of b.pieces) {
    if (p.f !== fs.n) continue;
    let drop = false;
    if (p.kind === 'floor' && p.idx === idx && p.h >= h) {
      const fl = b.floors.get(idx);
      const k = fl.indexOf(p.h);
      if (k >= 0) fl[k] = p.h - delta;
      p.h -= delta; p.key = floorKey(idx, p.h); drop = true;
    } else if (p.kind === 'post' && isCorner(p) && p.base >= h) {
      const set = b.posts.get(p.i + ',' + p.j);
      set?.delete(p.base + LVL); set?.add(p.base - delta + LVL);
      p.base -= delta; p.key = postKey(p.i, p.j, p.base + LVL); drop = true;
    } else if ((p.kind === 'wall' || p.kind === 'machine') && nearCell(p) && (p.base ?? 0) >= h) {
      if (p.kind === 'wall') {
        b.walls.delete(p.wkey);
        p.wkey = p.wkey.replace(/,[^,]*$/, ',' + (p.base - delta));
        b.walls.add(p.wkey);
        p.key = 'w:' + p.wkey;
      }
      p.base -= delta; drop = true;
    }
    if (drop && p.obj) p.obj.position.y -= delta;
    if (drop && p.cols) for (const c of p.cols) { if (c.y0 !== undefined) c.y0 -= delta; if (c.h !== undefined) c.h -= delta; }
  }
  // 3) dust and thunder
  if (fs.n === G.floor) {
    for (let i = 0; i < 3; i++) {
      spawnBurst(new THREE.Vector3(cx * CELL + (i - 1) * 1.4, landing + 0.8 + i * 0.7, cy * CELL + (i - 1) * 1.1), 0xb9a684, 26, 6, 0.2, 0.9);
    }
    sfx.rumble();
    addMsg('💨 A tower storey gives way!', 'bad');
  }
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
    const valid = top <= MAX_H && !tops.has(top) && cellOpen(fs, cw.x, cw.z) &&
      !pointOccupied(G.floor, cw.x, cw.z, 0.6); // never post through a teammate
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
    const valid = !b.ramps.has(idx) && !fs.grid.ramps.has(idx) && fs.grid.cells[idx] === FLOOR &&
      cellOpen(fs, cx * CELL, cy * CELL) && !cellOccupied(G.floor, cx, cy);
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
    const valid = !b.walls.has(key) && !b.walls.has(altKey) &&
      !pointOccupied(G.floor, ex, ez, 1.4); // its colliders span the edge — don't wall anyone in
    return { valid, kind: 'wall', cx, cy, d, base, key, x: ex, z: ez, yaw: d.dx !== 0 ? Math.PI / 2 : 0 };
  }

  if (pieceId === 'barricade') {
    const cx = Math.round(hit.x / CELL), cy = Math.round(hit.z / CELL);
    const idx = cy * fs.grid.w + cx;
    const valid = fs.grid.cells[idx] === FLOOR && !fs.grid.elev[idx] &&
      !cellOccupied(G.floor, cx, cy) && // the distance test below only saw the LOCAL player
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
    const col = { x: m.x, z: m.z, r: 0.42, y0: m.base, h: m.base + LVL };
    fs.grid.colliders.push(col);
    b.pieces.push({ key: postKey(m.i, m.j, top), kind: 'post', f: m.f ?? G.floor, i: m.i, j: m.j, base: m.base, x: m.x, z: m.z, hp: BUILD_HP.post, maxHp: BUILD_HP.post, obj, cols: [col] });
  } else if (m.kind === 'floor') {
    const idx = m.cy * fs.grid.w + m.cx;
    if (!b.floors.has(idx)) b.floors.set(idx, []);
    if (b.floors.get(idx).includes(m.h)) return false;
    b.floors.get(idx).push(m.h);
    const obj = makePiece('floor_wood_large');
    obj.position.set(m.x, m.h, m.z);
    group.add(obj);
    b.pieces.push({ key: floorKey(idx, m.h), kind: 'floor', f: m.f ?? G.floor, idx, h: m.h, x: m.x, z: m.z, hp: BUILD_HP.floor, maxHp: BUILD_HP.floor, obj, cols: [] });
  } else if (m.kind === 'ramp') {
    const idx = m.cy * fs.grid.w + m.cx;
    if (b.ramps.has(idx)) return false;
    b.ramps.set(idx, { dx: m.dir.dx, dy: m.dir.dy, base: m.base });
    const obj = makePiece('stairs');
    obj.scale.set(0.8, PLATFORM_H / 5.1, 1);
    obj.position.set(m.x + m.dir.dx * CELL / 2, m.base, m.z + m.dir.dy * CELL / 2);
    obj.rotation.y = Math.atan2(-m.dir.dx, -m.dir.dy);
    group.add(obj);
    b.pieces.push({ key: rampKey(idx), kind: 'ramp', f: m.f ?? G.floor, idx, base: m.base, x: m.x, z: m.z, hp: BUILD_HP.ramp, maxHp: BUILD_HP.ramp, obj, cols: [] });
  } else if (m.kind === 'wall') {
    if (b.walls.has(m.key)) return false;
    b.walls.add(m.key);
    const obj = makePiece('wall');
    obj.position.set(m.x, m.base, m.z);
    obj.rotation.y = m.yaw;
    group.add(obj);
    // three colliders approximate the wall line; the top edge is standable
    const alongX = m.yaw === 0 ? 1 : 0, alongZ = m.yaw === 0 ? 0 : 1;
    const cols = [];
    for (const o of [-1.35, 0, 1.35]) {
      const col = { x: m.x + alongX * o, z: m.z + alongZ * o, r: 0.6, y0: m.base, h: m.base + PLATFORM_H };
      fs.grid.colliders.push(col);
      cols.push(col);
    }
    b.pieces.push({ key: 'w:' + m.key, kind: 'wall', f: m.f ?? G.floor, wkey: m.key, base: m.base, x: m.x, z: m.z, hp: BUILD_HP.wall, maxHp: BUILD_HP.wall, obj, cols });
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

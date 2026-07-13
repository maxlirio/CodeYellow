// Placeable walls: the Bone Wall spell (temporary) and horde-mode barricades
// (permanent but destructible — enemies attack them when blocked).
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { makePiece } from './assets.js';
import { OBSTACLE, FLOOR, cellOccupied } from './dungeon.js';
import { spawnBurst } from './fx.js';
import { sfx } from './audio.js';
import { netSend } from './net.js';

export const activeWalls = []; // {f, cx, cy, prevCell, obj, t, rising, hp, barricade}

export function clearWalls() {
  for (const w of activeWalls) removeWallVisual(w);
  activeWalls.length = 0;
}

export function wallAt(f, cx, cy) {
  return activeWalls.find(w => w.f === f && w.cx === cx && w.cy === cy);
}

// Place a wall on a floor cell. Returns false if the cell can't hold one.
export function placeWall(f, cx, cy, { dur = 10, yaw = 0, barricade = false, hp = 60, piece = null, broadcast = true } = {}) {
  const fs = G.floors.get(f);
  if (!fs || !fs.grid) return false;
  const idx = cy * fs.grid.w + cx;
  if (cx < 1 || cy < 1 || cx >= fs.grid.w - 1 || cy >= fs.grid.h - 1) return false;
  const prev = fs.grid.cells[idx];
  if (prev !== FLOOR) return false;
  if (fs.grid.elev[idx]) return false;
  if (wallAt(f, cx, cy)) return false;
  // never raise a wall on someone — that traps them inside it
  if (cellOccupied(f, cx, cy)) return false;

  fs.grid.cells[idx] = OBSTACLE;
  const pieceName = piece || (barricade ? 'crates_stacked' : 'wall');
  const obj = makePiece(pieceName);
  if (pieceName === 'wall' && !barricade) obj.scale.set(0.92, 0.55, 1.4); // bone wall: low & wide
  else if (pieceName === 'wall') obj.scale.set(0.96, 0.98, 1.5);          // stone wall: full height
  else obj.scale.set(1.25, 1.15, 1.25);
  obj.position.set(cx * 4, -2.2, cy * 4);
  obj.rotation.y = yaw;
  (fs.meshGroup || G.scene).add(obj);
  const w = { f, cx, cy, prevCell: prev, obj, t: barricade ? Infinity : dur, rise: 0, hp, maxHp: hp, barricade };
  activeWalls.push(w);
  if (f === G.floor) sfx.bones();
  if (broadcast) netSend({ t: 'wall', f, cx, cy, dur, yaw, barricade, hp, piece });
  return true;
}

export function damageWall(w, amount, fromNet = false) {
  if (!w || !w.barricade) return;
  w.hp -= amount;
  if (w.f === G.floor) spawnBurst(new THREE.Vector3(w.cx * 4, 1.2, w.cy * 4), 0xbb8855, 6, 3, 0.1, 0.3);
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'wallhp', f: w.f, cx: w.cx, cy: w.cy, hp: w.hp });
  if (w.hp <= 0) breakWall(w, fromNet);
}

export function breakWall(w, fromNet = false) {
  const i = activeWalls.indexOf(w);
  if (i < 0) return;
  activeWalls.splice(i, 1);
  restoreCell(w);
  if (w.f === G.floor) {
    spawnBurst(new THREE.Vector3(w.cx * 4, 1.2, w.cy * 4), 0xccaa77, 18, 5, 0.14, 0.5);
    sfx.bones();
  }
  removeWallVisual(w);
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'wallbreak', f: w.f, cx: w.cx, cy: w.cy });
}

function restoreCell(w) {
  const fs = G.floors.get(w.f);
  if (!fs?.grid) return;
  const idx = w.cy * fs.grid.w + w.cx;
  if (fs.grid.cells[idx] === OBSTACLE) fs.grid.cells[idx] = w.prevCell;
}

function removeWallVisual(w) {
  w.obj?.parent?.remove(w.obj);
}

export function updateWalls(dt) {
  for (let i = activeWalls.length - 1; i >= 0; i--) {
    const w = activeWalls[i];
    // rise out of the ground
    if (w.rise < 1) {
      w.rise = Math.min(1, w.rise + dt * 4);
      w.obj.position.y = -2.2 + w.rise * 2.2;
    }
    if (w.t !== Infinity) {
      w.t -= dt;
      if (w.t <= 0) {
        activeWalls.splice(i, 1);
        restoreCell(w);
        if (w.f === G.floor) spawnBurst(new THREE.Vector3(w.cx * 4, 0.8, w.cy * 4), 0xddddcc, 10, 3, 0.1, 0.4);
        removeWallVisual(w);
      }
    }
  }
}

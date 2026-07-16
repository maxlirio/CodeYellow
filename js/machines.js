// Crewed war machines (Last Stand & duels): V opens the machine menu — a bolt
// TURRET (fast single bolts) and a CANNON (slow, splashy shells). A machine is
// dead metal until a WORKER stands at the crank; workers are a hireable minion
// (Last Stand only) and enemies can cut them down — replace them or the gun
// falls silent. Machines register as build pieces, so enemies smash them too.
import * as THREE from 'three';
import { G } from './state.js';
import { makePiece, makeWeaponModel } from './assets.js';
import { groundHeightAt, hasLineOfSight, FLOOR, cellOccupied } from './dungeon.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { netSend, isAuthority } from './net.js';
import { ensureBuilds } from './builds.js';
import { damageEnemy } from './enemies.js';
import { spawnBolt } from './projectiles.js';
import { spawnBurst } from './fx.js';
import { minions } from './minions.js';

const CELL = 4;
export const MACHINES = [
  { id: 'turret', label: 'Laser Turret', cost: 90, icon: '', hp: 120, dmg: 9, range: 16, rate: 0.75, hint: 'fast pulses — needs a rig hand at the console' },
  { id: 'cannon', label: 'Laser Cannon', cost: 160, icon: '', hp: 160, dmg: 26, range: 22, rate: 3.0, aoe: 3.4, hint: 'slow & splashy plasma — needs a rig hand' },
];

export const machineState = { on: false, idx: 0, ghost: null, ghostKey: '', valid: false, target: null };
export const machines = []; // {key, kind, cfg, f, cx, cy, x, z, base, obj, head, flag, cd, workerId}
const shells = [];          // cannon shells in flight: {f, x, z, y, tx, tz, t, dur, cfg}

export function clearMachines() {
  machineState.on = false;
  if (machineState.ghost) { G.scene.remove(machineState.ghost); machineState.ghost = null; }
  for (const m of machines) m.obj?.parent?.remove(m.obj);
  machines.length = 0;
  shells.length = 0;
}

export function machineByKey(key) { return machines.find(m => m.key === key); }

// ---------- placement ----------
function buildMachineVisual(kind) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a525c, metalness: 0.55, roughness: 0.5 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2b3138, metalness: 0.6, roughness: 0.45 });
  const glow = (c) => new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: new THREE.Color(c), emissiveIntensity: 1.8, toneMapped: false,
  });
  if (kind === 'turret') {
    // LASER TURRET: tripod pedestal, twin emitter barrels, charge ring
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.2, 8), steel);
    pedestal.position.y = 0.6;
    g.add(pedestal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 16), glow(0x66d9ff));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.16;
    g.add(ring);
    const head = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.7), trim);
    head.add(housing);
    for (const side of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.0, 8), steel);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(side * 0.17, 0.04, 0.62);
      head.add(barrel);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8), glow(0x8fe4ff));
      tip.rotation.x = Math.PI / 2;
      tip.position.set(side * 0.17, 0.04, 1.14);
      head.add(tip);
    }
    head.position.y = 1.5;
    g.add(head);
    g.userData.head = head;
  } else {
    // LASER CANNON: broad emplacement base, one heavy emitter with charge coils
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.5), steel);
    base.position.y = 0.35;
    g.add(base);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 1.7), trim);
    skirt.position.y = 0.09;
    g.add(skirt);
    const head = new THREE.Group();
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), trim);
    head.add(cradle);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.9, 10), steel);
    barrel.rotation.x = Math.PI / 2 - 0.22; // muzzle up
    barrel.position.set(0, 0.25, 0.55);
    head.add(barrel);
    for (const t of [0.35, 0.7, 1.05]) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 8, 12), glow(0xff9a5e));
      coil.rotation.x = -0.22;
      coil.position.set(0, 0.25 + Math.sin(0.22) * t * 0 + t * Math.sin(Math.PI / 2 - 0.22) * 0.21, 0.55 + t * 0.9 * 0.5);
      // place coils along the barrel axis
      coil.position.set(0, 0.25 + t * Math.cos(Math.PI / 2 - 0.22) * 0, 0.55);
      coil.position.z = 0.55 + t * Math.sin(Math.PI / 2 - 0.22) * 0.95;
      coil.position.y = 0.25 + t * Math.cos(Math.PI / 2 - 0.22) * 0.95;
      head.add(coil);
    }
    head.position.y = 1.0;
    g.add(head);
    g.userData.head = head;
  }
  return g;
}

export function planMachine(kindId) {
  const fs = G.floors.get(G.floor);
  if (!fs?.grid || !G.player) return null;
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  const from = G.player.obj.position;
  const flat = Math.hypot(dir.x, dir.z) || 0.001;
  const hx = from.x + (dir.x / flat) * 6, hz = from.z + (dir.z / flat) * 6;
  const cx = Math.round(hx / CELL), cy = Math.round(hz / CELL);
  const idx = cy * fs.grid.w + cx;
  if (cx < 1 || cy < 1 || cx >= fs.grid.w - 1 || cy >= fs.grid.h - 1) return null;
  const base = groundHeightAt(cx * CELL, cy * CELL, G.player.obj.position.y, fs.grid);
  const valid = fs.grid.cells[idx] === FLOOR && !machines.some(m => m.f === G.floor && m.cx === cx && m.cy === cy) &&
    !cellOccupied(G.floor, cx, cy) && // never build a turret around a teammate
    hasLineOfSight(from.x, from.z, cx * CELL, cy * CELL, fs.grid);
  return { valid, kind: kindId, cx, cy, base, x: cx * CELL, z: cy * CELL };
}

export function applyMachine(m, broadcast = true) {
  const f = m.f ?? G.floor;
  const fs = G.floors.get(f);
  if (!fs?.grid) return false;
  const key = `m:${m.cx},${m.cy}`;
  if (machineByKey(key)) return false;
  const cfg = MACHINES.find(x => x.id === m.kind) || MACHINES[0];
  const obj = buildMachineVisual(m.kind);
  obj.position.set(m.x, m.base || 0, m.z);
  (fs.meshGroup || G.scene).add(obj);
  obj.visible = f === G.floor;
  const col = { x: m.x, z: m.z, hx: 0.95, hz: 0.95, y0: m.base || 0, h: (m.base || 0) + 1.5 };
  fs.grid.colliders.push(col);
  const rec = {
    key, kind: m.kind, cfg, f, cx: m.cx, cy: m.cy, x: m.x, z: m.z, base: m.base || 0,
    obj, head: obj.userData.head, flag: obj.userData.flag, cd: 1, workerId: null,
  };
  machines.push(rec);
  // registered as a build piece: enemies can target and smash it
  const b = ensureBuilds(fs);
  b.pieces.push({
    key, kind: 'machine', f, base: m.base || 0, x: m.x, z: m.z,
    hp: cfg.hp, maxHp: cfg.hp, obj, cols: [col],
    onDestroy: () => removeMachine(rec),
  });
  if (f === G.floor) { sfx.bones(); spawnBurst(new THREE.Vector3(m.x, (m.base || 0) + 1, m.z), 0xccbb88, 10, 3, 0.12, 0.4); }
  if (broadcast) netSend({ t: 'mach', kind: m.kind, cx: m.cx, cy: m.cy, x: m.x, z: m.z, base: m.base || 0, f });
  return true;
}

function removeMachine(rec) {
  const i = machines.indexOf(rec);
  if (i >= 0) machines.splice(i, 1);
  rec.obj?.parent?.remove(rec.obj);
  // free its worker for the next machine
  for (const mn of minions) if (mn.workPost && mn.workPost.key === rec.key) mn.workPost = null;
  if (rec.f === G.floor) addMsg('A war machine is destroyed!', 'bad');
}

// ---------- machine-build mode (V) ----------
export function toggleMachineMode(force = null) {
  const want = force ?? !machineState.on;
  if (want === machineState.on) return;
  machineState.on = want;
  if (!want && machineState.ghost) { G.scene.remove(machineState.ghost); machineState.ghost = null; }
  if (want) {
    const mc = MACHINES[machineState.idx];
    addMsg(`MACHINES — ${mc.label} (${mc.cost}g): ${mc.hint}. Scroll to switch, click to place, V to exit.`);
  }
}

export function cycleMachine(dir) {
  if (!machineState.on) return;
  machineState.idx = (machineState.idx + dir + MACHINES.length) % MACHINES.length;
  if (machineState.ghost) { G.scene.remove(machineState.ghost); machineState.ghost = null; }
  const mc = MACHINES[machineState.idx];
  addMsg(`${mc.label} — ${mc.cost}g · ${mc.hint}`);
}

export function updateMachineGhost() {
  if (!machineState.on || !G.player || G.player.dead) return;
  const mc = MACHINES[machineState.idx];
  const plan = planMachine(mc.id);
  machineState.target = plan;
  if (!plan) { if (machineState.ghost) machineState.ghost.visible = false; machineState.valid = false; return; }
  if (!machineState.ghost || machineState.ghostKey !== mc.id) {
    if (machineState.ghost) G.scene.remove(machineState.ghost);
    const g = buildMachineVisual(mc.id);
    g.userData.flag.visible = false;
    g.traverse((n) => {
      if (n.isMesh) { n.material = n.material.clone(); n.material.transparent = true; n.material.opacity = 0.45; }
    });
    G.scene.add(g);
    machineState.ghost = g;
    machineState.ghostKey = mc.id;
  }
  const g = machineState.ghost;
  g.visible = true;
  g.position.set(plan.x, plan.base, plan.z);
  machineState.valid = plan.valid && G.run.gold >= mc.cost;
  const tint = machineState.valid ? 0x66ff88 : 0xff5555;
  g.traverse((n) => { if (n.isMesh) n.material.color?.setHex(tint); });
}

export function placeCurrentMachine() {
  if (!machineState.on) return false;
  const mc = MACHINES[machineState.idx];
  const plan = machineState.target;
  if (!plan || !plan.valid) { addMsg('It won’t fit there.', 'bad'); return true; }
  if (G.run.gold < mc.cost) { addMsg(`Need ${mc.cost}g.`, 'bad'); return true; }
  if (applyMachine(plan)) {
    G.run.gold -= mc.cost;
    addMsg(`${mc.label} built (-${mc.cost}g) — it needs a worker to fire`);
    refreshHud();
  }
  return true;
}

// ---------- simulation ----------
function workerOf(m) {
  return minions.find(mn => !mn.dead && mn.cfg.worker && mn.workPost && mn.workPost.key === m.key) || null;
}

function claimWorker(m) {
  let best = null, bd = 70;
  for (const mn of minions) {
    if (mn.dead || !mn.cfg.worker || mn.workPost || mn.floor !== m.f) continue;
    const d = Math.hypot(mn.obj.position.x - m.x, mn.obj.position.z - m.z);
    if (d < bd) { bd = d; best = mn; }
  }
  if (best) best.workPost = { key: m.key, x: m.x + 1.1, z: m.z + 1.1 };
  return best;
}

export function updateMachines(dt) {
  // shells land where they were aimed
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.t += dt;
    if (s.t < s.dur) continue;
    shells.splice(i, 1);
    if (s.f === G.floor) { spawnBurst(new THREE.Vector3(s.tx, 1, s.tz), 0xff8844, 26, 7, 0.18, 0.6); sfx.trap(); }
    netSend({ t: 'fx', f: s.f, x: s.tx, y: 1, z: s.tz, color: 0xff8844, big: 1 });
    if (isAuthority()) {
      const fs = G.floors.get(s.f);
      for (const e of fs?.enemies || []) {
        if (e.state === 'dead' || e.state === 'inactive') continue;
        const d = Math.hypot(e.obj.position.x - s.tx, e.obj.position.z - s.tz);
        if (d < s.cfg.aoe) damageEnemy(e, Math.round(s.cfg.dmg * (d < s.cfg.aoe * 0.5 ? 1 : 0.65)), false, false, 'none');
      }
    }
  }

  if (!isAuthority()) {
    // guests don't simulate crews — hide the warning flags rather than lie
    for (const m of machines) if (m.flag) m.flag.visible = false;
    return;
  }
  for (const m of machines) {
    const fs = G.floors.get(m.f);
    if (!fs?.grid) continue;
    let w = workerOf(m);
    if (!w) w = claimWorker(m);
    const manned = w && Math.hypot(w.obj.position.x - m.x, w.obj.position.z - m.z) < 2.6;
    if (m.flag) m.flag.visible = !manned;
    if (!manned) continue;
    m.cd -= dt;

    // nearest live enemy in range with a clear shot
    let target = null, td = m.cfg.range;
    for (const e of fs.enemies) {
      if (e.state === 'dead' || e.state === 'inactive') continue;
      const d = Math.hypot(e.obj.position.x - m.x, e.obj.position.z - m.z);
      if (d < td && hasLineOfSight(m.x, m.z, e.obj.position.x, e.obj.position.z, fs.grid)) { td = d; target = e; }
    }
    if (!target) continue;
    if (m.head) m.head.rotation.y = Math.atan2(target.obj.position.x - m.x, target.obj.position.z - m.z);
    if (m.cd > 0) continue;
    m.cd = m.cfg.rate;

    const from = { x: m.x, y: m.base + 1.5, z: m.z };
    const to = target.obj.position;
    if (m.kind === 'turret') {
      const dir = new THREE.Vector3(to.x - from.x, to.y + 1.1 - from.y, to.z - from.z).normalize();
      const bolt = { x: from.x + dir.x * 0.8, y: from.y, z: from.z + dir.z * 0.8, dirX: dir.x, dirY: dir.y, dirZ: dir.z, speed: 30, dmg: 0, owner: 'fx', vis: 'laser', color: 0x8fe4ff };
      if (m.f === G.floor) { spawnBolt(bolt); sfx.bolt(); }
      netSend({ t: 'bolt', f: m.f, b: bolt });
      damageEnemy(target, m.cfg.dmg, Math.random() < 0.08, false, 'none');
    } else {
      const dist = td;
      const dur = Math.max(0.5, dist / 16);
      shells.push({ f: m.f, tx: to.x, tz: to.z, t: 0, dur, cfg: m.cfg });
      const dir = new THREE.Vector3(to.x - from.x, 3.5, to.z - from.z).normalize();
      const bolt = { x: from.x, y: from.y, z: from.z, dirX: dir.x, dirY: dir.y, dirZ: dir.z, speed: dist / dur * 0.9, dmg: 0, owner: 'fx', vis: 'fireball', size: 0.8, color: 0xff7733 };
      if (m.f === G.floor) { spawnBolt(bolt); sfx.cannon(); }
      netSend({ t: 'bolt', f: m.f, b: bolt });
    }
  }
}

export function refreshMachineVisibility() {
  for (const m of machines) m.obj.visible = m.f === G.floor;
}

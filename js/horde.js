// Last Stand mode: waves pour through the arena gates; build barricades and hire
// mercenaries between waves; survive as long as you can. Host-authoritative.
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { spawnEnemy, setEnemyState } from './enemies.js';
import { spawnMinion } from './minions.js';
import { makePiece } from './assets.js';
import { placeWall } from './walls.js';
import { netSend, isAuthority, myId } from './net.js';
import { addMsg, refreshHud, showWaveBanner, updateWaveHud } from './ui.js';
import { sfx } from './audio.js';
import { hasLineOfSight, FLOOR } from './dungeon.js';

export const horde = { active: false, wave: 0, phase: 'build', t: 0, spawned: 0 };
const BUILD_TIME = 22, FIRST_BUILD = 14;
const BARRICADE_COST = 30, MERC_COST = 120;

export function startHorde() {
  horde.active = true;
  horde.wave = 0;
  horde.phase = 'build';
  horde.t = FIRST_BUILD;
  addMsg('🏰 LAST STAND — build barricades (B), hire mercenaries (H), survive.', 'gold');
  addMsg(`First wave in ${FIRST_BUILD}s. Gold buys walls (${BARRICADE_COST}g) and sellswords (${MERC_COST}g).`);
}
export function stopHorde() { if (buildState.on) toggleBuildMode(false); horde.active = false; }

function wavePool(w) {
  if (w <= 2) return ['minion', 'minion', 'rogue'];
  if (w <= 5) return ['minion', 'rogue', 'warrior', 'bomber'];
  if (w <= 8) return ['minion', 'rogue', 'warrior', 'bomber', 'mage', 'ghost', 'brute'];
  return ['rogue', 'warrior', 'bomber', 'mage', 'ghost', 'berserker', 'plaguebearer', 'sniper', 'juggernaut', 'shade'];
}

function spawnWave() {
  const fs = floorState(1);
  const gates = fs.grid.gates;
  const n = 5 + horde.wave * 3;
  const pool = wavePool(horde.wave);
  const eliteCh = Math.min(0.3, horde.wave * 0.03);
  for (let i = 0; i < n; i++) {
    const g = gates[i % gates.length];
    const x = g.x * 4 + (Math.random() - 0.5) * 2, z = g.y * 4 + (Math.random() - 0.5) * 2;
    const type = horde.wave % 5 === 0 && i === 0 && horde.wave > 0 ? 'boss' : pool[Math.floor(Math.random() * pool.length)];
    const id = 1000 + fs.nextSummonId++;
    const e = spawnEnemy(fs, type, x, z, { y: 0, elite: Math.random() < eliteCh, id });
    setEnemyState(e, 'awaken');
    fs.summons.push({ id, type, x, z, y: 0 });
    netSend({ t: 'espawn', f: 1, id, type, x, z, y: 0 });
  }
  netSend({ t: 'wave', n: horde.wave, phase: 'combat' });
  showWaveBanner(horde.wave);
  sfx.bossroar();
}

export function updateHorde(dt) {
  if (!horde.active) return;
  updateWaveHud(horde);
  if (!isAuthority()) return;

  const fs = floorState(1);
  if (horde.phase === 'build') {
    horde.t -= dt;
    if (horde.t <= 0) {
      horde.wave++;
      horde.phase = 'combat';
      spawnWave();
    }
  } else {
    // combat ends when every wave enemy is down
    const alive = fs.enemies.some(e => e.state !== 'dead');
    if (!alive) {
      horde.phase = 'build';
      horde.t = BUILD_TIME;
      const bonus = 20 + horde.wave * 10;
      G.run.gold += bonus;
      addMsg(`🌊 Wave ${horde.wave} cleared! +${bonus}g — next wave in ${BUILD_TIME}s`, 'gold');
      netSend({ t: 'wave', n: horde.wave, phase: 'build', t: BUILD_TIME, bonus });
      refreshHud();
      sfx.victory();
    }
  }
}

// guest-side wave state from host
export function applyWaveMsg(m) {
  horde.wave = m.n;
  horde.phase = m.phase;
  if (m.t) horde.t = m.t;
  if (m.phase === 'combat') { showWaveBanner(m.n); sfx.bossroar(); }
  else if (m.bonus) { G.run.gold += m.bonus; addMsg(`🌊 Wave ${m.n} cleared! +${m.bonus}g`, 'gold'); refreshHud(); }
}

// ---- Fortnite-style build mode: ghost preview, wheel to cycle, click to place ----
export const BUILD_PIECES = [
  { id: 'barricade', label: 'Barricade', cost: 30, hp: 80, piece: 'crates_stacked' },
  { id: 'stonewall', label: 'Stone Wall', cost: 50, hp: 160, piece: 'wall' },
];
export const buildState = { on: false, idx: 0, ghost: null, valid: false, cx: 0, cy: 0 };

export function toggleBuildMode(force = null) {
  if (!horde.active && force !== false) return;
  const want = force ?? !buildState.on;
  if (want === buildState.on) return;
  buildState.on = want;
  if (!want && buildState.ghost) {
    G.scene.remove(buildState.ghost);
    buildState.ghost = null;
  }
  addMsg(want ? '🔨 BUILD MODE — click to place, scroll to switch, B to exit' : 'Build mode off');
}

export function cycleBuildPiece(dir) {
  if (!buildState.on) return;
  buildState.idx = (buildState.idx + dir + BUILD_PIECES.length) % BUILD_PIECES.length;
  if (buildState.ghost) { G.scene.remove(buildState.ghost); buildState.ghost = null; }
  const bp = BUILD_PIECES[buildState.idx];
  addMsg(`🔨 ${bp.label} — ${bp.cost}g (${bp.hp} hp)`);
}

function makeGhost(bp) {
  const g = makePiece(bp.piece);
  if (bp.piece === 'wall') g.scale.set(0.96, 0.98, 1.5);
  else g.scale.set(1.25, 1.15, 1.25);
  g.traverse((n) => {
    if (n.isMesh) {
      n.material = n.material.clone();
      n.material.transparent = true;
      n.material.opacity = 0.45;
    }
  });
  G.scene.add(g);
  return g;
}

export function updateBuildGhost() {
  if (!buildState.on || !G.player || G.player.dead) return;
  const bp = BUILD_PIECES[buildState.idx];
  if (!buildState.ghost) buildState.ghost = makeGhost(bp);
  const dir = new THREE.Vector3();
  G.camera.getWorldDirection(dir);
  const from = G.player.obj.position;
  let hit = null;
  for (let d = 3; d < 12; d += 0.5) {
    const px = from.x + dir.x * d, pz = from.z + dir.z * d;
    if (!hasLineOfSight(from.x, from.z, px, pz)) break;
    hit = { x: px, z: pz };
  }
  if (!hit) { buildState.valid = false; buildState.ghost.visible = false; return; }
  const cx = Math.round(hit.x / 4), cy = Math.round(hit.z / 4);
  buildState.cx = cx; buildState.cy = cy;
  const fs = G.floors.get(G.floor);
  const idx = cy * fs.grid.w + cx;
  const free = fs.grid.cells[idx] === FLOOR && !fs.grid.elev[idx] &&
    Math.hypot(cx * 4 - from.x, cy * 4 - from.z) > 2;
  buildState.valid = free && G.run.gold >= bp.cost;
  buildState.ghost.visible = true;
  buildState.ghost.position.set(cx * 4, 0, cy * 4);
  const tint = buildState.valid ? 0x66ff88 : 0xff5555;
  buildState.ghost.traverse((n) => { if (n.isMesh) n.material.color.setHex(tint); });
}

// click while in build mode
export function placeCurrentBuild() {
  if (!buildState.on) return false;
  const bp = BUILD_PIECES[buildState.idx];
  if (!buildState.valid) { addMsg(G.run.gold < bp.cost ? `Need ${bp.cost}g.` : 'No room there.', 'bad'); return true; }
  if (placeWall(G.floor, buildState.cx, buildState.cy, { barricade: true, hp: bp.hp, dur: Infinity, piece: bp.piece })) {
    G.run.gold -= bp.cost;
    addMsg(`${bp.label} built (-${bp.cost}g)`);
    refreshHud();
  }
  return true;
}

// H: hire a mercenary (also sold at the tavern in campaign mode)
export function tryHireMerc(kind = null) {
  if (!G.player || G.player.dead) return;
  if (G.run.gold < MERC_COST) { addMsg(`Mercenaries cost ${MERC_COST}g.`, 'bad'); return false; }
  G.run.gold -= MERC_COST;
  const k = kind || (Math.random() < 0.5 ? 'sword' : 'bow');
  const p = G.player.obj.position;
  if (isAuthority()) {
    spawnMinion(k, myId(), G.floor, p.x + 1.5, p.z + 1.5);
  } else {
    netSend({ t: 'hire', kind: k, f: G.floor, x: p.x + 1.5, z: p.z + 1.5 });
  }
  addMsg(`🤺 A ${k === 'sword' ? 'sellsword' : 'marksman'} joins you! (-${MERC_COST}g)`, 'gold');
  refreshHud();
  return true;
}

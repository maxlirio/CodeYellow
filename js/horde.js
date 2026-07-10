// Last Stand mode: waves pour through the arena gates; build barricades and hire
// mercenaries between waves; survive as long as you can. Host-authoritative.
import { G, floorState } from './state.js';
import { spawnEnemy, setEnemyState } from './enemies.js';
import { spawnMinion } from './minions.js';
import { netSend, isAuthority, myId } from './net.js';
import { addMsg, refreshHud, showWaveBanner, updateWaveHud } from './ui.js';
import { sfx } from './audio.js';

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
export function stopHorde() { horde.active = false; }

function wavePool(w) {
  if (w <= 2) return ['minion', 'minion', 'goblin', 'rogue'];
  if (w <= 5) return ['minion', 'goblin', 'rogue', 'warrior', 'bomber', 'slime'];
  if (w <= 8) return ['minion', 'rogue', 'warrior', 'orcwar', 'bomber', 'mage', 'ghost', 'brute', 'imp'];
  return ['rogue', 'warrior', 'orcwar', 'bomber', 'mage', 'ghost', 'berserker', 'plaguebearer', 'sniper', 'juggernaut', 'shade', 'ogre', 'imp', 'drake'];
}

// squad roles: heavies besiege your structures, fast movers flank, casters
// volley from the back rank, the rest form the vanguard line
const SIEGERS = new Set(['ogre', 'juggernaut', 'brute', 'orcwar']);
function roleFor(type, cfg) {
  if (cfg.ranged) return 'archer';
  if (SIEGERS.has(type)) return 'sieger';
  // any melee can pick up a torch: ~1 in 4 joins the demolition crew, so
  // fortifications come under attack from wave 1, not just when brutes show up
  if (Math.random() < 0.25) return 'sieger';
  if (['rogue', 'goblin', 'shade', 'berserker'].includes(type)) return 'flanker';
  return 'vanguard';
}

function spawnWave() {
  const fs = floorState(1);
  const gates = fs.grid.gates;
  const n = 5 + horde.wave * 3;
  const pool = wavePool(horde.wave);
  const eliteCh = Math.min(0.3, horde.wave * 0.03);
  const ranks = gates.map(() => 0);
  for (let i = 0; i < n; i++) {
    const gi = i % gates.length;
    const g = gates[gi];
    const x = g.x * 4 + (Math.random() - 0.5) * 2, z = g.y * 4 + (Math.random() - 0.5) * 2;
    const type = horde.wave % 5 === 0 && i === 0 && horde.wave > 0 ? 'boss' : pool[Math.floor(Math.random() * pool.length)];
    const id = 1000 + fs.nextSummonId++;
    const e = spawnEnemy(fs, type, x, z, { y: 0, elite: Math.random() < eliteCh, id });
    if (!e.boss) e.tac = { role: roleFor(type, e.cfg), gate: gi, rank: ranks[gi]++ };
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

// H: hire a mercenary (also sold at the tavern in campaign mode).
// Workers (machine crew) are Last Stand-only and cheaper.
const WORKER_COST = 60;
export function tryHireMerc(kind = null) {
  if (!G.player || G.player.dead) return;
  const k = kind || (Math.random() < 0.5 ? 'sword' : 'bow');
  if (k === 'worker' && !horde.active) { addMsg('Workers only sign on for the Last Stand.', 'bad'); return false; }
  const cost = k === 'worker' ? WORKER_COST : MERC_COST;
  if (G.run.gold < cost) { addMsg(`That costs ${cost}g.`, 'bad'); return false; }
  G.run.gold -= cost;
  const p = G.player.obj.position;
  if (isAuthority()) {
    spawnMinion(k, myId(), G.floor, p.x + 1.5, p.z + 1.5);
  } else {
    netSend({ t: 'hire', kind: k, f: G.floor, x: p.x + 1.5, z: p.z + 1.5 });
  }
  addMsg(k === 'worker' ? `🔧 A worker signs on! Stand them near a machine. (-${cost}g)`
    : `🤺 A ${k === 'sword' ? 'sellsword' : 'marksman'} joins you! (-${cost}g)`, 'gold');
  refreshHud();
  return true;
}

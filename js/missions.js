// SORTIES — the Helldivers-style mission loop.
// The hulk is a MAP, not a staircase: pick a section at the mission console,
// confirm, and the breach portal on the bridge opens. Clear every hostile in
// the section, then extract — you return to the bridge, resupplied, and the
// hologram wall logs the sortie. There is no descend.
import { G } from './state.js';
import { netSend, isAuthority, broadcastFstate } from './net.js';
import { addMsg } from './ui.js';
import { sfx } from './audio.js';
import { saveReport, renderHologram } from './bridge.js';
import { setSortieOverride } from './ship.js';
import { startSpaceFlight } from './space.js';

// Each section IS a place: its theme, its hold-role mix, its threat.
// floorN drives enemy scaling and the midboss floors (3/6) and the reactor (9).
export const SECTIONS = [
  { id: 'cargo', name: 'CARGO HOLD', floorN: 1, threat: 1, theme: 'cargo',
    roles: ['cargo', 'cargo', 'cargo', 'hangar', 'barracks'],
    desc: 'Container canyons and dormant loader frames. Breach-team shakedown.' },
  { id: 'spaceport', name: 'SPACE PORT', floorN: 2, threat: 1, theme: 'landfall', special: 'hangar',
    roles: ['cargo', 'machine', 'barracks'],
    desc: 'The hangar deck — hull mouth open to space, dropships on their pads. Long sightlines.' },
  { id: 'security', name: 'SECURITY DECK', floorN: 3, threat: 2, theme: 'command',
    roles: ['brig', 'brig', 'gantry', 'machine'],
    desc: 'Cell blocks and checkpoint warrens under a warden-grade custodian. Expect a fight.' },
  { id: 'hab', name: 'HABITATION RING', floorN: 4, threat: 2, theme: 'hab',
    roles: ['barracks', 'barracks', 'cargo', 'gantry'],
    desc: 'Bunk stacks and mess halls. The crew never left.' },
  { id: 'engine', name: 'ENGINE ROOM', floorN: 5, threat: 3, theme: 'engineering',
    roles: ['machine', 'machine', 'machine', 'gantry'],
    desc: 'Turbine ranks and red-line heat. Tight aisles, heavy frames.' },
  { id: 'weapons', name: 'WEAPONS FACILITY', floorN: 6, threat: 3, theme: 'command',
    roles: ['foundry', 'foundry', 'machine', 'gantry'],
    desc: 'Assembly lines still printing the defenders. Guarded accordingly.' },
  { id: 'landfall', name: 'OPERATION LANDFALL', floorN: 9, threat: 4, theme: 'engineering',
    roles: [], special: 'landfall',
    desc: 'The carrier has arrived. A civilization below, taken. Bomb the shield grid open, then land.' },
  { id: 'district', name: 'THE PURGE', floorN: 10, threat: 5, theme: 'hab',
    roles: [], special: null },
];

// sortie state: null, or { id, name, floorN, seed, n, active, entered }
let hooks = { goto: null, disposeFloor: null, lock: null };
export function setMissionHooks(h) { hooks = { ...hooks, ...h }; }
let sortieCount = 0;
let alertT = 0, alerted = false, syncT = 0, clearT = 0, holoT = 0;
let missionStart = null; // { kills0, gold0, time0 }

export function currentSortie() { return G.sortie || null; }

function sectionById(id) { return SECTIONS.find(s => s.id === id); }

function portalSet(on) {
  const fs = G.floors.get(0);
  if (!fs?.meshGroup) return;
  for (const name of ['portalGlow', 'portalLight']) {
    const o = fs.meshGroup.getObjectByName(name);
    if (o) o.visible = on;
  }
}

// ---- start / sync ----
export function beginSortie(secId, seed = null, n = null, fromNet = false, diff = 0) {
  const sec = sectionById(secId);
  if (!sec) return;
  sortieCount = n ?? sortieCount + 1;
  if (sec.id === 'landfall') {
    // the FINALE: the ship itself moves. Jump cinematic first; the portal
    // opens only when the descent levels off (landfallPortalReady below).
    G.sortie = {
      id: sec.id, name: sec.name, floorN: sec.floorN, diff: 0,
      seed: seed || `${G.seed}:landfall`, n: sortieCount, active: true, entered: false,
    };
    setSortieOverride({ floorN: sec.floorN, theme: 'landfall', roles: ['cargo', 'machine', 'barracks'], special: 'landfall' });
    if (G.floor !== sec.floorN) hooks.disposeFloor?.(sec.floorN);
    alerted = true;
    sfx.stairs();
    hooks.landfall?.();
    if (!fromNet) netSend({ t: 'mission', sec: sec.id, seed: G.sortie.seed, n: sortieCount, diff: 0 });
    return;
  }
  G.sortie = {
    id: sec.id, name: sec.name, floorN: sec.floorN, diff,
    seed: seed || `${G.seed}:sortie${sortieCount}`, n: sortieCount,
    active: true, entered: false,
  };
  // the section IS its identity: the generator honors the section's theme/roles
  setSortieOverride({ floorN: sec.floorN, theme: sec.theme, roles: sec.roles, special: sec.special || null });
  // the section regenerates fresh every sortie (never under our own feet)
  if (G.floor !== sec.floorN) hooks.disposeFloor?.(sec.floorN);
  portalSet(true);
  alerted = true; // the alert is answered
  addMsg(`Sortie confirmed: ${sec.name}. The breach portal is open.`, 'gold');
  sfx.stairs();
  if (!fromNet) netSend({ t: 'mission', sec: sec.id, seed: G.sortie.seed, n: sortieCount, diff });
}

// the arrival cinematic ends -> the breach portal lights up
export function landfallPortalReady() {
  if (!G.sortie || G.sortie.id !== 'landfall') return;
  G.shipLoc = 'planet'; // the ship is AT the planet now — every deck shows it
  G.sortie.portalReady = true;
  portalSet(true);
  sfx.levelup();
}

export function onRemoteMission(m) {
  if (G.sortie && G.sortie.seed === m.seed) return; // self-heal duplicate
  beginSortie(m.sec, m.seed, m.n, true, m.diff || 0);
}
export function onRemoteMissionEnd() {
  if (!G.sortie) return;
  G.sortie.active = false;
  portalSet(false);
}

// player stepped on the bridge portal pad
export function enterSortie() {
  if (!G.sortie?.active) { addMsg('The breach portal is dark. Confirm a sortie at the mission console.'); return; }
  G.sortie.entered = true;
  missionStart = { gold0: G.run.gold, time0: G.time || 0 };
  hooks.goto?.(G.sortie.floorN);
}

// ---- extraction ----
export function tryExtract() {
  const fs = G.floors.get(G.floor);
  if (!G.sortie?.active || G.floor !== G.sortie.floorN) return false;
  if (fs?.grid?.stairsLocked) {
    addMsg('Extraction locked — hostiles remain in the section.', 'bad');
    return true; // handled (don't fall through to descend)
  }
  finishSortie('CLEARED');
  return true;
}

export function finishSortie(result) {
  const fs = G.floors.get(G.sortie?.floorN);
  const kills = fs ? fs.enemies.filter(e => e.state === 'dead').length : 0;
  const credits = Math.max(0, (G.run.gold ?? 0) - (missionStart?.gold0 ?? 0));
  const time = Math.round((G.time || 0) - (missionStart?.time0 ?? 0));
  saveReport({ section: G.sortie?.name || '?', result, kills, credits, time });
  if (result === 'CLEARED' && G.sortie) {
    G.run.deepest = Math.max(G.run.deepest || 0, G.sortie.floorN);
    (G.run.clearedSections ||= []).push(G.sortie.id);
    const bonus = [0, 120, 300][G.sortie.diff || 0];
    if (bonus) { G.run.gold += bonus; addMsg(`Hazard bonus: +${bonus} credits.`, 'gold'); }
  }
  G.sortie.active = false;
  if (isAuthority()) netSend({ t: 'mend' });
  portalSet(false);
  hooks.goto?.(0);
  // RESUPPLY — the ship restocks its own
  const p = G.player;
  if (p) { p.hp = p.maxHp; p.mana = p.maxMana; }
  G.run.arrows = Math.max(G.run.arrows || 0, 60);
  G.run.potions = Math.max(G.run.potions || 0, 2);
  renderHologram();
  addMsg(result === 'CLEARED'
    ? `Sortie complete — ${kills} hostiles down. Resupplied.`
    : 'Recovered to the bridge. Resupplied.', 'gold');
  alertT = -4; alerted = false; // the next alert takes a breath
}

// ---- per-frame: red alert on the bridge, clear-check in the field ----
export function updateMissions(dt) {
  // red alert: the console CALLS you
  if (G.floor === 0 && G.mode === 'playing' && !G.sortie?.active && !alerted) {
    alertT += dt;
    if (alertT > 6) {
      alerted = true;
      sfx.alarm?.();
      addMsg('RED ALERT — hostile signatures on the hulk. Report to the mission console.', 'bad');
    }
  }
  // beacon pulse while an alert is live and unanswered
  const fs0 = G.floors.get(0);
  const beacon = fs0?.meshGroup?.getObjectByName('alertBeacon');
  const wantAlert = alerted && !G.sortie?.active && G.floor === 0;
  if (beacon) beacon.intensity = wantAlert ? 8 + Math.sin((G.time || 0) * 9) * 7 : 0;
  // the holo table's hulk turns slowly; a red node pulses on it during an alert
  const holoShip = G.floor === 0 ? fs0?.meshGroup?.getObjectByName('holoShip') : null;
  if (holoShip) {
    holoShip.rotation.y += dt * 0.35;
    holoShip.position.y = 2.15 + Math.sin((G.time || 0) * 1.1) * 0.08;
    const node = holoShip.getObjectByName('holoAlert');
    if (node) {
      node.visible = wantAlert;
      if (node.visible) node.scale.setScalar(0.85 + 0.45 * Math.sin((G.time || 0) * 7));
    }
  }
  // in the field: unlock extraction when the section is clear
  if (G.sortie?.active && G.sortie.entered && G.floor === G.sortie.floorN && isAuthority()) {
    clearT += dt;
    if (clearT > 0.5) {
      clearT = 0;
      const fs = G.floors.get(G.floor);
      if (fs?.spawned && fs.grid.stairsLocked !== false) {
        const alive = fs.enemies.some(e => e.state !== 'dead');
        if (!alive) {
          fs.grid.stairsLocked = false;
          broadcastFstate(G.floor); // carries `locked` to every teammate
          addMsg('Section clear. EXTRACTION READY — the portal is live.', 'gold');
          sfx.levelup?.();
        }
      }
    }
  }
  // sortie self-heal for late joiners
  if (G.sortie?.active && isAuthority()) {
    syncT += dt;
    if (syncT > 4) { syncT = 0; netSend({ t: 'mission', sec: G.sortie.id, seed: G.sortie.seed, n: G.sortie.n }); }
  }
  // the hologram wall tracks your live loadout/credits while you're aboard
  if (G.floor === 0 && G.mode === 'playing') {
    holoT += dt;
    if (holoT > 2) { holoT = 0; renderHologram(); }
  }
}

// ---- the ship map overlay ----
export function openMissionMap() {
  const el = document.getElementById('missionMap');
  if (!el) return;
  G.mode = 'merchant';
  document.exitPointerLock?.();
  const closeBtn = document.getElementById('mmClose');
  if (closeBtn) closeBtn.onclick = closeMissionMap;
  renderMap();
  el.classList.add('show');
}
export function closeMissionMap() {
  document.getElementById('missionMap')?.classList.remove('show');
  G.mode = 'playing';
  hooks.lock?.();
}

let selectedSec = null;
function renderMap() {
  const list = document.getElementById('mmList');
  const detail = document.getElementById('mmDetail');
  if (!list) return;
  const cleared = G.run?.clearedSections || [];
  list.innerHTML = '';
  for (const sec of SECTIONS) {
    const locked = (sec.id === 'landfall' && !cleared.includes('weapons'))
      || (sec.id === 'district' && !cleared.includes('landfall'));
    const b = document.createElement('button');
    b.className = 'mm-sec' + (selectedSec === sec.id ? ' sel' : '') + (locked ? ' locked' : '');
    b.style.left = ({ cargo: '8%', spaceport: '24%', security: '38%', hab: '50%', engine: '64%', weapons: '77%', landfall: '88%', district: '88%' })[sec.id];
    b.style.top = ({ cargo: '58%', spaceport: '30%', security: '62%', hab: '34%', engine: '60%', weapons: '32%', landfall: '38%', district: '58%' })[sec.id];
    b.textContent = sec.name;
    b.dataset.threat = 'THREAT ' + '▮'.repeat(sec.threat);
    b.onclick = () => {
      if (locked) { detail.innerHTML = sec.id === 'district' ? '<p class="mm-locked">GROUNDSIDE LOCKED — win OPERATION LANDFALL first.</p>' : '<p class="mm-locked">DESTINATION LOCKED — clear the WEAPONS FACILITY first.</p>'; return; }
      selectedSec = sec.id;
      renderMap();
    };
    list.appendChild(b);
  }
  // VOID PATROL: the flight game, unlocked by clearing the SPACE PORT
  if (cleared.includes('spaceport')) {
    const b2 = document.createElement('button');
    b2.className = 'mm-sec' + (selectedSec === 'patrol' ? ' sel' : '');
    b2.style.left = '18%'; b2.style.top = '12%';
    b2.textContent = `VOID PATROL LV${(G.run.patrolLvl || 0) + 1}`;
    b2.dataset.threat = 'THREAT ▮▮';
    b2.onclick = () => { selectedSec = 'patrol'; renderMap(); };
    list.appendChild(b2);
  }
  if (selectedSec === 'patrol') {
    const lvl = (G.run.patrolLvl || 0) + 1;
    detail.innerHTML = `
      <h3>VOID PATROL — LEVEL ${lvl}</h3>
      <p class="mm-threat">FLIGHT OPS · ${lvl >= 3 ? 'BOMBERS EXPECTED — DEFEND THE CARRIER' : 'FIGHTER SWEEP'}</p>
      <p>Launch fighters inside the force-field dome and clear the intruders. Every trooper on the bridge flies. Clear the sky, then return to the docking bay.</p>
      <button id="mmConfirm">LAUNCH FIGHTERS</button>`;
    document.getElementById('mmConfirm').onclick = () => {
      closeMissionMap();
      startSpaceFlight();
    };
    return;
  }
  const sec = sectionById(selectedSec);
  if (sec) {
    // scalable sectors offer OP SCALE: bigger area, more hostiles, hazard pay.
    // The ENGINE ROOM doesn't — there is exactly one engine room on this ship.
    if (sec.id === 'landfall') {
      detail.innerHTML = `
        <h3>OPERATION LANDFALL — ACT I</h3>
        <p class="mm-threat">FLIGHT OPS · BOMBING RUN</p>
        <p>${sec.desc}</p>
        <p>Fly the bomber. LOCK a shield pylon (T), line the run up on the bombsight, release when it flashes RED (SPACE). Six bombs — rearm at the carrier's ring. Kill the grid, then land on the beacon.</p>
        <button id="mmConfirm">LAUNCH BOMBER</button>`;
      document.getElementById('mmConfirm').onclick = () => {
        if (G.net?.role === 'guest') { addMsg('Only the squad lead can task a sortie.', 'bad'); return; }
        beginSortie(sec.id);
        closeMissionMap();
      };
      return;
    }
    const scalable = ['cargo', 'security', 'hab', 'weapons'].includes(sec.id);
    const OPS = [
      { name: 'SWEEP', hint: 'compact · standard pay' },
      { name: 'ASSAULT', hint: 'larger · +120 cr bonus' },
      { name: 'PURGE', hint: 'the whole sector · +300 cr bonus' },
    ];
    detail.innerHTML = `
      <h3>${sec.name}</h3>
      <p class="mm-threat">THREAT ${'▮'.repeat(sec.threat)}${'▯'.repeat(4 - sec.threat)}</p>
      <p>${sec.desc}</p>` + (scalable
      ? OPS.map((o, i) => `<button class="mmOp" data-d="${i}">${o.name} — <small>${o.hint}</small></button>`).join('')
      : '<button id="mmConfirm">CONFIRM SORTIE</button>');
    if (scalable) {
      for (const b of detail.querySelectorAll('.mmOp')) {
        b.onclick = () => {
          if (G.net?.role === 'guest') { addMsg('Only the squad lead can task a sortie.', 'bad'); return; }
          beginSortie(sec.id, null, null, false, +b.dataset.d);
          closeMissionMap();
        };
      }
    } else {
      document.getElementById('mmConfirm').onclick = () => {
        if (G.net?.role === 'guest') { addMsg('Only the squad lead can task a sortie.', 'bad'); return; }
        beginSortie(sec.id);
        closeMissionMap();
      };
    }
  } else {
    detail.innerHTML = '<p class="mm-hint">Select an insertion point on the hulk.</p>';
  }
}

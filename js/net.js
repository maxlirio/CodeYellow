// PeerJS multiplayer (same approach as CodeBlue): the 5-letter room code IS the host's
// peer id — no backend needed, PeerJS's free public broker does signaling.
// Host-authoritative. Players can be on DIFFERENT floors: the host simulates every
// floor with a player on it; every message is floor-tagged; arriving on a floor a
// teammate already visited pulls a state snapshot (freq -> fstate).
import * as THREE from 'three';
import { G, floorState } from './state.js';
import { addMsg } from './ui.js';

const PREFIX = 'code-orange-mx2-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let callbacks = {}; // main.js: onLobbyUpdate, onStart, onGameOver, onVictory, onHostGone, onPartyDeath, onPeerFloor, onFstate, ensureFloorSim
export function setNetCallbacks(cb) { callbacks = cb; }

// handlers wired at runtime to avoid import cycles
let H = null;
export async function wireHandlers() {
  const player = await import('./player.js');
  const enemies = await import('./enemies.js');
  const loot = await import('./loot.js');
  const proj = await import('./projectiles.js');
  const fx = await import('./fx.js');
  const spells = await import('./spells.js');
  const walls = await import('./walls.js');
  const minions = await import('./minions.js');
  const horde = await import('./horde.js');
  const builds = await import('./builds.js');
  const machines = await import('./machines.js');
  const commander = await import('./commander.js');
  H = { player, enemies, loot, proj, fx, spells, walls, minions, horde, builds, machines, commander };
}

// CodeBlue lesson: if a guest ever references an entity it doesn't have (missed
// message), self-heal by re-requesting the floor snapshot — throttled per floor.
const healReq = new Map(); // floor -> last request time
function requestFloorHeal(f) {
  const fs = G.floors.get(f);
  if (!fs || !fs.spawned || G.net.role !== 'guest') return;
  const now = performance.now();
  if (now - (healReq.get(f) || 0) < 5000) return;
  healReq.set(f, now);
  netSend({ t: 'freq', n: f });
}

export function isAuthority() { return G.net.role !== 'guest'; }
export function myId() { return G.net.role === 'host' ? 'host' : (G.net.peer?.id || 'me'); }

function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function netSend(msg) {
  if (G.net.role === 'solo') return;
  if (G.net.role === 'host') {
    for (const c of G.net.conns) if (c.open) c.send(msg);
  } else if (G.net.hostConn?.open) {
    G.net.hostConn.send(msg);
  }
}
function sendTo(conn, msg) { if (conn.open) conn.send(msg); }

// ---------------- host ----------------
export function hostGame(name, classId) {
  return new Promise((resolve, reject) => {
    const code = makeCode();
    const peer = new Peer(PREFIX + code, { debug: 1 });
    peer.on('open', () => {
      G.net.role = 'host';
      G.net.peer = peer;
      G.net.code = code;
      G.net.conns = [];
      G.net.players = new Map([['host', { name, classId, ready: true, look: { ...G.look } }]]);
      G.net.started = false;
      peer.on('connection', (conn) => onGuestConnect(conn));
      resolve(code);
    });
    peer.on('error', (e) => reject(e));
  });
}

function onGuestConnect(conn) {
  conn.on('open', () => {
    if (G.net.started || G.net.conns.length >= 3) { sendTo(conn, { t: 'full' }); setTimeout(() => conn.close(), 500); return; }
    G.net.conns.push(conn);
  });
  conn.on('data', (m) => handleAsHost(conn, m));
  conn.on('close', () => {
    G.net.conns = G.net.conns.filter(c => c !== conn);
    const p = G.net.players.get(conn.peer);
    G.net.players.delete(conn.peer);
    if (p) addMsg(`${p.name} left the party`, 'bad');
    H?.player.removeRemotePlayer(conn.peer);
    broadcastLobby();
    netSend({ t: 'pleft', pid: conn.peer });
    callbacks.onLobbyUpdate?.();
  });
}

function broadcastLobby() {
  const players = [...G.net.players.entries()].map(([pid, p]) => ({ pid, name: p.name, classId: p.classId, look: p.look }));
  netSend({ t: 'lobby', players });
  callbacks.onLobbyUpdate?.();
}

export function hostStart(mode = 'campaign') {
  G.net.started = true;
  netSend({ t: 'start', seed: G.seed, mode });
}

// snapshot of everything that already happened on a floor. `ealive` carries the
// full roster so a guest that missed any spawn message can rebuild it (CodeBlue
// lesson: self-heal on miss instead of desyncing forever).
function buildFstate(n) {
  const fs = floorState(n);
  return {
    t: 'fstate', f: n,
    taken: fs.loots.filter(l => l.taken).map(l => l.id),
    dead: fs.enemies.filter(e => e.state === 'dead').map(e => e.id),
    hp: fs.enemies.filter(e => e.state !== 'dead' && e.hp < e.maxHp).map(e => [e.id, e.hp]),
    ealive: fs.enemies.filter(e => e.state !== 'dead').map(e => [e.id, e.type, +e.obj.position.x.toFixed(1), +e.obj.position.z.toFixed(1), +e.obj.position.y.toFixed(1), e.elite ? 1 : 0]),
    summons: fs.summons,
    drops: fs.drops,
    locked: fs.grid ? fs.grid.stairsLocked : false,
  };
}

function handleAsHost(conn, m) {
  const pid = conn.peer;
  switch (m.t) {
    case 'hello':
      G.net.players.set(pid, { name: m.name, classId: m.classId, ready: true, look: m.look });
      broadcastLobby();
      if (G.net.started) sendTo(conn, { t: 'full' });
      break;
    case 'pos':
      H?.player.applyRemotePos(pid, m);
      relay(conn, { ...m, pid });
      break;
    case 'pfloor':
      callbacks.onPeerFloor?.(pid, m.n);
      relay(conn, { ...m, pid });
      break;
    case 'freq':
      callbacks.ensureFloorSim?.(m.n);
      sendTo(conn, buildFstate(m.n));
      break;
    case 'bolt':
      if (m.f === G.floor) H?.proj.spawnBolt(m.b);
      relay(conn, { ...m, pid });
      break;
    case 'fx':
      if (m.f === G.floor) H?.fx.spawnBurst(new THREE.Vector3(m.x, m.y, m.z), m.color, m.big ? 26 : 14, m.big ? 7 : 4, 0.15, 0.5);
      relay(conn, { ...m, pid });
      break;
    case 'beam':
      if (m.f === G.floor) H?.spells.remoteBeam(m.a, m.b);
      relay(conn, { ...m, pid });
      break;
    case 'equip':
      H?.player.applyRemoteEquip(pid, m.meshes);
      relay(conn, { ...m, pid });
      break;
    case 'dmg': {
      const e = H?.enemies.enemyById(m.f, m.id);
      if (e) H.enemies.damageEnemy(e, m.amount, m.crit, true, pid, m.fx || null);
      break;
    }
    case 'lootReq':
      H?.loot.takeLoot(m.f, m.id, pid, true);
      break;
    case 'wall':
      H?.walls.placeWall(m.f, m.cx, m.cy, { dur: m.dur, yaw: m.yaw, barricade: m.barricade, hp: m.hp, piece: m.piece, broadcast: false });
      relay(conn, { ...m, pid });
      break;
    case 'hire':
      H?.minions.spawnMinion(m.kind, pid, m.f, m.x, m.z, null, true, m.o || {});
      break;
    case 'pheal':
      applyPheal(m);
      relay(conn, { ...m, pid });
      break;
    case 'pvp':
      if (m.target === myId()) H?.player.damageLocalPlayer(m.dmg);
      else relay(conn, m);
      break;
    case 'build':
      H?.builds.applyBuild(m, false);
      relay(conn, { ...m, pid });
      break;
    case 'mach':
      H?.machines.applyMachine(m, false);
      relay(conn, { ...m, pid });
      break;
    case 'morder':
      H?.commander.applyMinionOrder(m, pid);
      break;
    case 'pdead': {
      const p = G.net.players.get(pid);
      addMsg(`☠ ${p?.name || 'A companion'} has fallen!`, 'bad');
      relay(conn, { t: 'pdead', pid });
      callbacks.onPartyDeath?.();
      break;
    }
  }
}

function relay(fromConn, msg) {
  for (const c of G.net.conns) if (c !== fromConn && c.open) c.send(msg);
}

// ---------------- guest ----------------
export function joinGame(code, name, classId) {
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 1 });
    let settled = false;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      const timeout = setTimeout(() => { if (!settled) { settled = true; peer.destroy(); reject(new Error('No response — check the code')); } }, 8000);
      conn.on('open', () => {
        G.net.role = 'guest';
        G.net.peer = peer;
        G.net.hostConn = conn;
        G.net.code = code.toUpperCase();
        conn.send({ t: 'hello', name, classId, look: { ...G.look } });
        clearTimeout(timeout);
        if (!settled) { settled = true; resolve(); }
      });
      conn.on('data', (m) => handleAsGuest(m));
      conn.on('close', () => {
        if (G.mode === 'playing' || G.mode === 'merchant') {
          addMsg('Lost connection to the host. Continuing solo…', 'bad');
          G.net.role = 'solo';
          for (const rid of [...G.remotes.keys()]) H?.player.removeRemotePlayer(rid);
        } else callbacks.onHostGone?.();
      });
    });
    peer.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

function handleAsGuest(m) {
  switch (m.t) {
    case 'full':
      addMsg('That room is full or already playing.', 'bad');
      callbacks.onHostGone?.();
      break;
    case 'lobby':
      G.net.players = new Map(m.players.map(p => [p.pid, { name: p.name, classId: p.classId, look: p.look }]));
      callbacks.onLobbyUpdate?.();
      break;
    case 'start':
      G.net.started = true;
      callbacks.onStart?.(m.seed, m.mode || 'campaign');
      break;
    case 'wall':
      H?.walls.placeWall(m.f, m.cx, m.cy, { dur: m.dur, yaw: m.yaw, barricade: m.barricade, hp: m.hp, piece: m.piece, broadcast: false });
      break;
    case 'wallhp': {
      const w = H?.walls.wallAt(m.f, m.cx, m.cy);
      if (w) w.hp = m.hp;
      break;
    }
    case 'wallbreak': {
      const w = H?.walls.wallAt(m.f, m.cx, m.cy);
      if (w) H.walls.breakWall(w, true);
      break;
    }
    case 'mspawn':
      if (!H?.minions.minionById(m.id)) H?.minions.spawnMinion(m.kind, m.owner, m.f, m.x, m.z, m.id, false, m.o || {});
      break;
    case 'msnap':
      H?.minions.applyMinionSnapshot(m.list);
      break;
    case 'mhp': {
      const mn = H?.minions.minionById(m.id);
      if (mn) mn.hp = m.hp;
      break;
    }
    case 'mdie': {
      const mn = H?.minions.minionById(m.id);
      if (mn && !mn.dead) H.minions.damageMinion(mn, mn.hp + 999, true);
      break;
    }
    case 'wave':
      H?.horde.applyWaveMsg(m);
      break;
    case 'pos':
      ensureRemote(m.pid);
      H?.player.applyRemotePos(m.pid, m);
      break;
    case 'pfloor':
      callbacks.onPeerFloor?.(m.pid, m.n);
      break;
    case 'fstate':
      callbacks.onFstate?.(m);
      break;
    case 'bolt':
    case 'ebolt':
      if (m.f === G.floor) H?.proj.spawnBolt(m.b);
      break;
    case 'fx':
      if (m.f === G.floor) H?.fx.spawnBurst(new THREE.Vector3(m.x, m.y, m.z), m.color, m.big ? 26 : 14, m.big ? 7 : 4, 0.15, 0.5);
      break;
    case 'pheal':
      applyPheal(m);
      break;
    case 'beam':
      if (m.f === G.floor) H?.spells.remoteBeam(m.a, m.b);
      break;
    case 'equip':
      H?.player.applyRemoteEquip(m.pid, m.meshes);
      break;
    case 'ehp': {
      const e = H?.enemies.enemyById(m.f, m.id);
      if (e) e.hp = m.hp;
      else requestFloorHeal(m.f);
      break;
    }
    case 'estate': {
      const e = H?.enemies.enemyById(m.f, m.id);
      if (e) H.enemies.setEnemyState(e, m.s, true);
      else requestFloorHeal(m.f);
      break;
    }
    case 'esnap': {
      const fs = G.floors.get(m.f);
      if (!fs || !fs.spawned) break;
      for (const s of m.list) {
        const e = fs.enemies.find(en => en.id === s[0]);
        if (e) { e.netX = s[1]; e.netZ = s[2]; e.netYaw = s[3]; e.hp = s[4]; e.netY = s[5] || 0; }
        else requestFloorHeal(m.f);
      }
      break;
    }
    case 'edie': {
      const e = H?.enemies.enemyById(m.f, m.id);
      if (e) H.enemies.killEnemy(e, m.by === myId() ? 'local' : 'remote', true);
      else requestFloorHeal(m.f);
      break;
    }
    case 'espawn': {
      const fs = G.floors.get(m.f);
      if (fs && fs.spawned) {
        const e = H?.enemies.spawnEnemy(fs, m.type, m.x, m.z, { y: m.y || 0, id: m.id });
        if (e) H.enemies.setEnemyState(e, 'awaken', true);
      }
      break;
    }
    case 'phit':
      if (m.target === myId()) H?.player.damageLocalPlayer(m.dmg, m.fx || null);
      break;
    case 'pvp':
      if (m.target === myId()) H?.player.damageLocalPlayer(m.dmg);
      break;
    case 'lootTaken':
      H?.loot.takeLoot(m.f, m.id, m.by === myId() ? 'local' : 'remote', true);
      break;
    case 'build':
      H?.builds.applyBuild(m, false);
      break;
    case 'mach':
      H?.machines.applyMachine(m, false);
      break;
    case 'bhp': {
      const p = H?.builds.pieceByKey(m.f, m.key);
      if (p) p.hp = m.hp;
      break;
    }
    case 'bdie': {
      const p = H?.builds.pieceByKey(m.f, m.key);
      if (p) H.builds.destroyBuild(p, true);
      break;
    }
    case 'ldrop': {
      const fs = G.floors.get(m.f);
      if (fs && fs.spawned) H?.loot.dropItemLoot(fs, m.item, m.x, m.z, m.y, m.id);
      break;
    }
    case 'pdead': {
      const p = G.net.players.get(m.pid);
      addMsg(`☠ ${p?.name || 'A companion'} has fallen!`, 'bad');
      break;
    }
    case 'pleft':
      H?.player.removeRemotePlayer(m.pid);
      break;
    case 'gover':
      callbacks.onGameOver?.(true);
      break;
    case 'victory':
      callbacks.onVictory?.(true);
      break;
  }
}

function ensureRemote(pid) {
  if (G.remotes.has(pid) || pid === myId()) return;
  const info = G.net.players.get(pid);
  if (info) H?.player.addRemotePlayer(pid, info.name, info.classId, info.look);
}

// create remote avatars for all lobby players at game start
export function spawnRemoteAvatars() {
  for (const [pid, p] of G.net.players) {
    if (pid === myId()) continue;
    H?.player.addRemotePlayer(pid, p.name, p.classId, p.look);
  }
}

// periodic enemy snapshots from host, one message per floor guests occupy
let snapT = 0;
export function updateNet(dt) {
  if (G.net.role !== 'host' || !G.net.conns.length) return;
  snapT += dt;
  if (snapT < 0.12) return;
  snapT = 0;
  const guestFloors = new Set();
  for (const r of G.remotes.values()) guestFloors.add(r.floor);
  for (const f of guestFloors) {
    const fs = G.floors.get(f);
    if (!fs || !fs.spawned) continue;
    const list = [];
    for (const e of fs.enemies) {
      if (e.state === 'dead') continue;
      list.push([e.id, +e.obj.position.x.toFixed(2), +e.obj.position.z.toFixed(2), +e.obj.rotation.y.toFixed(2), e.hp, +e.obj.position.y.toFixed(2)]);
    }
    if (list.length) netSend({ t: 'esnap', f, list });
  }
  const mlist = H?.minions.minionSnapshot();
  if (mlist?.length) netSend({ t: 'msnap', list: mlist });
}

export function shutdownNet() {
  try { G.net.peer?.destroy(); } catch {}
  G.net = { role: 'solo', peer: null, conns: [], code: '', players: new Map(), started: false };
}

// a Life Ward pulse: heal my player if I'm standing inside it
function applyPheal(m) {
  if (m.f !== G.floor || !G.player || G.player.dead) return;
  const p = G.player.obj.position;
  if (Math.hypot(p.x - m.x, p.z - m.z) > m.r) return;
  H?.player.healLocalPlayer(m.amt);
}

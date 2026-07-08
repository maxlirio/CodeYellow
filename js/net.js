// PeerJS multiplayer (same approach as CodeBlue): the 5-letter room code IS the host's
// peer id — no backend needed, PeerJS's free public broker does signaling.
// Host-authoritative: host simulates enemies/loot; guests render snapshots.
import { G } from './state.js';
import { addMsg } from './ui.js';

const PREFIX = 'code-orange-mx-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let callbacks = {}; // set by main.js: onLobbyUpdate, onStart, onFloorChange, onGameOver, onVictory, onPeerLeft
export function setNetCallbacks(cb) { callbacks = cb; }

// handlers wired at runtime to avoid import cycles
let H = null;
export async function wireHandlers() {
  const player = await import('./player.js');
  const enemies = await import('./enemies.js');
  const loot = await import('./loot.js');
  const proj = await import('./projectiles.js');
  H = { player, enemies, loot, proj };
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
      G.net.players = new Map([['host', { name, classId, ready: true }]]);
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
  const players = [...G.net.players.entries()].map(([pid, p]) => ({ pid, name: p.name, classId: p.classId }));
  netSend({ t: 'lobby', players });
  callbacks.onLobbyUpdate?.();
}

export function hostStart() {
  G.net.started = true;
  netSend({ t: 'start', seed: G.seed });
}

function handleAsHost(conn, m) {
  const pid = conn.peer;
  switch (m.t) {
    case 'hello':
      G.net.players.set(pid, { name: m.name, classId: m.classId, ready: true });
      broadcastLobby();
      if (G.net.started) sendTo(conn, { t: 'full' });
      break;
    case 'pos':
      H?.player.applyRemotePos(pid, m);
      relay(conn, { ...m, pid });
      break;
    case 'bolt':
      H?.proj.spawnBolt(m.b);
      relay(conn, { ...m, pid });
      break;
    case 'dmg': {
      const e = H?.enemies.enemyById(m.id);
      if (e) H.enemies.damageEnemy(e, m.amount, m.crit, true, pid);
      break;
    }
    case 'lootReq':
      H?.loot.takeLoot(m.id, pid, true);
      break;
    case 'stairsReq':
      if (!G.grid.stairsLocked) callbacks.onFloorChange?.(G.floor + 1, true);
      break;
    case 'pdead': {
      const p = G.net.players.get(pid);
      addMsg(`☠ ${p?.name || 'A companion'} has fallen!`, 'bad');
      relay(conn, { t: 'pdead', pid });
      callbacks.onPartyDeath?.();
      break;
    }
    case 'prespawn':
      relay(conn, { ...m, pid });
      break;
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
        conn.send({ t: 'hello', name, classId });
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
      G.net.players = new Map(m.players.map(p => [p.pid, { name: p.name, classId: p.classId }]));
      callbacks.onLobbyUpdate?.();
      break;
    case 'start':
      G.net.started = true;
      callbacks.onStart?.(m.seed);
      break;
    case 'pos':
      ensureRemote(m.pid);
      H?.player.applyRemotePos(m.pid, m);
      break;
    case 'bolt':
      H?.proj.spawnBolt(m.b);
      break;
    case 'ebolt':
      H?.proj.spawnBolt(m.b);
      break;
    case 'ehp': {
      const e = H?.enemies.enemyById(m.id);
      if (e) e.hp = m.hp;
      break;
    }
    case 'estate': {
      const e = H?.enemies.enemyById(m.id);
      if (e) H.enemies.setEnemyState(e, m.s, true);
      break;
    }
    case 'esnap': {
      for (const s of m.list) {
        const e = H?.enemies.enemyById(s[0]);
        if (e) { e.netX = s[1]; e.netZ = s[2]; e.netYaw = s[3]; e.hp = s[4]; }
      }
      break;
    }
    case 'edie': {
      const e = H?.enemies.enemyById(m.id);
      if (e) H.enemies.killEnemy(e, m.by === myId() ? 'local' : 'remote', true);
      break;
    }
    case 'espawn':
      H?.enemies.spawnEnemy(m.type, m.x, m.z, true);
      break;
    case 'phit':
      if (m.target === myId()) H?.player.damageLocalPlayer(m.dmg);
      break;
    case 'lootTaken':
      H?.loot.takeLoot(m.id, m.by === myId() ? 'local' : 'remote', true);
      break;
    case 'floor':
      callbacks.onFloorChange?.(m.n, false);
      break;
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
  if (info) H?.player.addRemotePlayer(pid, info.name, info.classId);
}

// host: create remote avatars for all lobby players at game start
export function spawnRemoteAvatars() {
  for (const [pid, p] of G.net.players) {
    if (pid === myId()) continue;
    if (G.net.role === 'guest' && pid === 'host') H?.player.addRemotePlayer(pid, p.name, p.classId);
    else if (G.net.role === 'host') H?.player.addRemotePlayer(pid, p.name, p.classId);
    else if (G.net.role === 'guest') H?.player.addRemotePlayer(pid, p.name, p.classId);
  }
}

// periodic enemy snapshots from host
let snapT = 0;
export function updateNet(dt) {
  if (G.net.role !== 'host' || !G.net.conns.length) return;
  snapT += dt;
  if (snapT < 0.12) return;
  snapT = 0;
  const list = [];
  for (const e of G.enemies) {
    if (e.state === 'dead') continue;
    list.push([e.id, +e.obj.position.x.toFixed(2), +e.obj.position.z.toFixed(2), +e.obj.rotation.y.toFixed(2), e.hp]);
  }
  if (list.length) netSend({ t: 'esnap', list });
}

export function shutdownNet() {
  try { G.net.peer?.destroy(); } catch {}
  G.net = { role: 'solo', peer: null, conns: [], code: '', players: new Map(), started: false };
}

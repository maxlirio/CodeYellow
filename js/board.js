// The tavern notice board: a public list of joinable games with NO backend.
// The first player to open the board claims a well-known PeerJS id and serves
// the list from their tab; everyone else connects to it as a client. If the
// board host leaves, the next visitor claims the id.
import { G } from './state.js';

const BOARD_ID = 'code-orange-mx2-board0';
const TTL = 90_000;

let peer = null, role = null, conn = null;
let games = new Map(); // code -> {code, name, mode, players, ts}
let publishTimer = null, myPublish = null;

function ensureBoard() {
  return new Promise((resolve) => {
    if (peer && !peer.destroyed && (role === 'server' || conn?.open)) return resolve(role);
    try { peer?.destroy(); } catch {}
    conn = null;
    peer = new Peer(BOARD_ID, { debug: 0 });
    let settled = false;
    peer.on('open', () => {
      role = 'server';
      games = new Map();
      peer.on('connection', (c) => {
        c.on('data', (m) => {
          if (m.t === 'publish') { games.set(m.code, { ...m.info, code: m.code, ts: Date.now() }); }
          if (m.t === 'unpublish') games.delete(m.code);
          if (m.t === 'list') c.send({ t: 'games', list: currentList() });
        });
      });
      setInterval(() => {
        for (const [k, v] of games) if (Date.now() - v.ts > TTL) games.delete(k);
      }, 15000);
      if (!settled) { settled = true; resolve('server'); }
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // someone else runs the board — connect as a client
        try { peer.destroy(); } catch {}
        peer = new Peer({ debug: 0 });
        peer.on('open', () => {
          conn = peer.connect(BOARD_ID, { reliable: true });
          conn.on('open', () => { role = 'client'; if (!settled) { settled = true; resolve('client'); } });
          conn.on('error', () => { if (!settled) { settled = true; resolve(null); } });
          setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 6000);
        });
        peer.on('error', () => { if (!settled) { settled = true; resolve(null); } });
      } else if (!settled) { settled = true; resolve(null); }
    });
    setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 8000);
  });
}

function currentList() {
  return [...games.values()].filter(g => Date.now() - g.ts < TTL);
}

export async function fetchPublicGames() {
  const r = await ensureBoard();
  if (r === 'server') return currentList();
  if (r === 'client' && conn?.open) {
    return new Promise((resolve) => {
      const h = (m) => { if (m.t === 'games') { conn.off('data', h); resolve(m.list); } };
      conn.on('data', h);
      conn.send({ t: 'list' });
      setTimeout(() => resolve([]), 5000);
    });
  }
  return [];
}

export async function publishGame(code, info) {
  myPublish = { code, info };
  const r = await ensureBoard();
  const doPublish = () => {
    if (!myPublish) return;
    if (role === 'server') games.set(myPublish.code, { ...myPublish.info, code: myPublish.code, ts: Date.now() });
    else if (conn?.open) conn.send({ t: 'publish', code: myPublish.code, info: myPublish.info });
  };
  doPublish();
  clearInterval(publishTimer);
  publishTimer = setInterval(doPublish, 30000);
  return r != null;
}

export function unpublishGame() {
  if (!myPublish) return;
  if (role === 'server') games.delete(myPublish.code);
  else if (conn?.open) conn.send({ t: 'unpublish', code: myPublish.code });
  clearInterval(publishTimer);
  myPublish = null;
}

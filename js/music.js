// Streaming soundtrack with crossfades. One track per context: the village,
// dungeon crawls, quiet caverns, boss fights, and the arena. Tracks are lazy
// HTMLAudio streams (no decode-ahead cost) and start after the first user
// gesture, per browser autoplay rules.
const TRACKS = {
  town: 'assets/music/town.m4a',      // Woodland Fantasy — Matthew Pablo (CC-BY 3.0)
  dungeon: 'assets/music/dungeon.m4a',// Dark Descent — Matthew Pablo (CC-BY 3.0)
  cave: 'assets/music/cave.m4a',      // Crystal Cave — cynicmusic (CC0)
  boss: 'assets/music/boss.m4a',      // Heroic Demise — Matthew Pablo (CC-BY 3.0)
  battle: 'assets/music/battle.m4a',  // Battle Theme A — cynicmusic (CC0)
};
const VOL = { town: 0.34, dungeon: 0.32, cave: 0.42, boss: 0.36, battle: 0.34 };
const FADE = 1.6; // seconds

const players = new Map();
let baseCtx = null;
let bossOn = false;
let unlocked = false;
let muted = false;
try { muted = localStorage.getItem('codeyellow_music') === 'off'; } catch {}

function currentCtx() {
  if (!baseCtx) return null;
  return bossOn ? 'boss' : baseCtx;
}

function audioFor(ctx) {
  let a = players.get(ctx);
  if (!a) {
    a = new Audio(TRACKS[ctx]);
    a.loop = true;
    a.volume = 0;
    players.set(ctx, a);
  }
  return a;
}

// which track a floor wants: the village, the arena, or a dungeon mood
export function musicCtxFor(floor, runMode, theme) {
  if (floor === 0) return 'town';
  if (runMode === 'horde' || runMode === 'duel') return 'battle';
  return (theme === 'drowned' || theme === 'ossuary') ? 'cave' : 'dungeon';
}

export function setMusicBase(ctx) { baseCtx = ctx; }
export function setBossMusic(on) { bossOn = on; }
export function stopMusic() { baseCtx = null; bossOn = false; }

export function toggleMusic() {
  muted = !muted;
  try { localStorage.setItem('codeyellow_music', muted ? 'off' : 'on'); } catch {}
  return !muted;
}
export function musicEnabled() { return !muted; }

// called every frame: fade the active track in, everything else out
export function updateMusic(dt) {
  const want = muted ? null : currentCtx();
  for (const [ctx, a] of players) {
    const target = ctx === want ? VOL[ctx] : 0;
    if (a.volume < target) a.volume = Math.min(target, a.volume + dt / FADE * VOL[ctx]);
    else if (a.volume > target) a.volume = Math.max(target, a.volume - dt / FADE * VOL[ctx]);
    if (a.volume <= 0 && !a.paused && ctx !== want) a.pause();
  }
  if (want && unlocked) {
    const a = audioFor(want);
    if (a.paused) a.play().catch(() => {});
  }
}

// browsers refuse autoplay until a gesture; arm on the first one
function unlock() {
  unlocked = true;
}
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// introspection for tests
export function musicDebug() {
  return {
    baseCtx, bossOn, unlocked, muted,
    tracks: [...players].map(([c, a]) => [c, a.paused ? 'paused' : 'playing', +a.volume.toFixed(2), a.readyState, a.error?.code ?? null]),
  };
}

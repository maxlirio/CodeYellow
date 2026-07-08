// Boot, scene setup, input, game-flow state machine, main loop.
import * as THREE from 'three';
import { G } from './state.js';
import { WIN_FLOOR, BOSS_FLOORS } from './config.js';
import { randomSeed } from './rng.js';
import { loadAll } from './assets.js';
import { initFx, buildTorchFx, updateFx, clearTransientFx } from './fx.js';
import { initAudio, resumeAudio, toggleMute, sfx } from './audio.js';
import { generateFloor } from './dungeon.js';
import { spawnEnemies, updateEnemies, anyBossAlive, clearEnemies, damageEnemy } from './enemies.js';
import { spawnLoots, updateLoot, clearLoot } from './loot.js';
import { updateProjectiles, clearProjectiles } from './projectiles.js';
import {
  createPlayer, resetPlayerForFloor, updatePlayer, updateRemotes, tryAttack, tryDodge, tryInteract,
  drinkPotion, onMouseMove, damageLocalPlayer, sendPos, effectiveMaxHp,
} from './player.js';
import {
  show, hide, setHidden, addMsg, refreshHud, updateMinimap, updateDodgeCooldown,
  buildClassCards, renderShop, showTransition, runStatsHtml, updatePartyBar, hideBossBar,
} from './ui.js';
import {
  setNetCallbacks, wireHandlers, hostGame, joinGame, hostStart, netSend, shutdownNet,
  spawnRemoteAvatars, updateNet, isAuthority, myId,
} from './net.js';

const $ = (id) => document.getElementById(id);
let getClass = () => 'knight';

// ---------------- boot ----------------
async function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  G.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0812);
  scene.fog = new THREE.FogExp2(0x0a0812, 0.035);
  G.scene = scene;

  G.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 120);
  G.camera.position.set(0, 6, 8);

  scene.add(new THREE.HemisphereLight(0x9988bb, 0x2a2016, 0.85));
  scene.add(new THREE.AmbientLight(0x4a4260, 0.7));

  initFx();

  await wireHandlers();

  await loadAll((f, url) => {
    $('loadfill').style.width = `${Math.round(f * 100)}%`;
    $('loadtext').textContent = `Loading ${url.split('/').pop()}…`;
  });

  hide('loading');
  show('menu');
  setupMenu();
  setupInput();

  // debug/test hooks: ?auto=1 starts a solo run immediately, ?seed=xyz fixes the dungeon
  window.G = G;
  const params = new URLSearchParams(location.search);
  if (params.get('auto')) {
    initAudio();
    startRun(params.get('seed') || randomSeed());
  }
  addEventListener('resize', () => {
    G.camera.aspect = innerWidth / innerHeight;
    G.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  requestAnimationFrame(loop);
}

// ---------------- menu & lobby ----------------
function playerName() {
  const v = $('nameInput').value.trim();
  return v || 'Adventurer';
}

function setupMenu() {
  getClass = buildClassCards();
  $('nameInput').value = localStorage.getItem('codeorange_name') || '';
  $('nameInput').addEventListener('change', () => localStorage.setItem('codeorange_name', $('nameInput').value));

  $('btnSolo').onclick = () => { initAudio(); startRun(randomSeed()); };

  $('btnHost').onclick = async () => {
    initAudio();
    $('btnHost').textContent = 'Opening room…';
    try {
      const code = await hostGame(playerName(), getClass());
      hide('menu'); show('lobby');
      $('roomCode').textContent = code;
      $('lobbyStatus').textContent = 'Share this code with your friends. Up to 4 players.';
      setHidden('btnStart', false);
      renderLobby();
    } catch (e) {
      addMsg('Could not open a room (signaling server unreachable).', 'bad');
    }
    $('btnHost').textContent = '🕸 Host Co-op';
  };

  $('btnJoin').onclick = async () => {
    const code = $('joinCode').value.trim().toUpperCase();
    if (code.length !== 5) { $('joinCode').focus(); return; }
    initAudio();
    $('btnJoin').textContent = 'Joining…';
    try {
      await joinGame(code, playerName(), getClass());
      hide('menu'); show('lobby');
      $('roomCode').textContent = code;
      $('lobbyStatus').textContent = 'Waiting for the host to start…';
      setHidden('btnStart', true);
      renderLobby();
    } catch (e) {
      alert('Could not join: ' + (e.message || 'room not found'));
    }
    $('btnJoin').textContent = 'Join Co-op';
  };

  $('btnStart').onclick = () => {
    G.seed = randomSeed();
    hostStart();
    startRun(G.seed);
  };
  $('btnLeaveLobby').onclick = () => { shutdownNet(); hide('lobby'); show('menu'); };

  $('btnRestart').onclick = () => location.reload();
  $('btnMenu').onclick = () => location.reload();
  $('btnEndless').onclick = () => {
    G.endless = true;
    hide('victory');
    G.mode = 'merchant';
    show('merchant');
    renderShop(buyItem);
  };
  $('btnResume').onclick = () => { hide('pause'); G.mode = 'playing'; G.paused = false; lockPointer(); };
  $('btnQuit').onclick = () => location.reload();
  $('btnDescend').onclick = () => {
    hide('merchant');
    if (isAuthority()) doFloorChange(G.floor + 1, true);
    else netSend({ t: 'stairsReq' });
  };

  setNetCallbacks({
    onLobbyUpdate: renderLobby,
    onStart: (seed) => startRun(seed),
    onFloorChange: (n, broadcast) => doFloorChange(n, broadcast),
    onGameOver: () => gameOver(),
    onVictory: () => victory(),
    onHostGone: () => { shutdownNet(); hide('lobby'); show('menu'); },
    onPartyDeath: () => checkAllDead(),
  });
}

function renderLobby() {
  const ul = $('lobbyList');
  ul.innerHTML = '';
  for (const [pid, p] of G.net.players) {
    const li = document.createElement('li');
    const cls = p.classId || 'knight';
    li.textContent = `${pid === 'host' ? '👑 ' : ''}${p.name} — ${cls[0].toUpperCase() + cls.slice(1)}`;
    ul.appendChild(li);
  }
}

// ---------------- run flow ----------------
function startRun(seed) {
  G.seed = seed || randomSeed();
  G.floor = 1;
  G.endless = false;
  G.run = { gold: 0, potions: 1, keys: 0, atkBonus: 0, hpBonus: 0, speedBonus: 0, speedBuys: 0, level: 1, xp: 0, kills: 0, chests: 0, startTime: performance.now(), buys: {} };
  hide('menu'); hide('lobby'); hide('merchant'); hide('dead'); hide('victory');
  setHidden('hud', false);

  createPlayer(getClass(), playerName());
  G.player.maxHp = effectiveMaxHp();
  G.player.hp = G.player.maxHp;

  buildFloor(1);
  spawnRemoteAvatars();
  G.mode = 'playing';
  refreshHud();
  addMsg('Descend. Survive. Destroy the Bone King on floor 9.', 'gold');
  addMsg('Click the screen to capture the mouse.');
  lockPointer();
}

function buildFloor(n) {
  G.floor = n;
  clearTransientFx();
  clearProjectiles();
  clearEnemies();
  clearLoot();
  const { enemySpawns, lootSpawns } = generateFloor(G.seed, n);
  G.hadBoss = !!BOSS_FLOORS[n] || (G.endless && n % 3 === 0);
  spawnEnemies(enemySpawns);
  spawnLoots(lootSpawns);
  buildTorchFx();
  resetPlayerForFloor();
  // co-op teammates also reset to spawn — their pos messages will move them
  for (const r of G.remotes.values()) {
    r.obj.position.set(G.grid.spawn.x, 0, G.grid.spawn.z);
    r.netX = G.grid.spawn.x; r.netZ = G.grid.spawn.z;
    r.dead = false;
  }
  // endless mode: reuse boss cadence past floor 9
  if (G.endless && n > WIN_FLOOR && n % 3 === 0) {
    G.grid.stairsLocked = true;
  }
  refreshHud();
  sendPos(true);
}

// Called by stairs interaction (E). Opens the merchant first.
function onStairsUsed() {
  if (G.mode !== 'playing') return;
  sfx.stairs();
  G.mode = 'merchant';
  document.exitPointerLock?.();
  show('merchant');
  renderShop(buyItem);
}

function buyItem(id, price) {
  if (G.run.gold < price) return;
  G.run.gold -= price;
  G.run.buys[id] = (G.run.buys[id] || 0) + 1;
  const p = G.player;
  switch (id) {
    case 'potion': G.run.potions++; break;
    case 'atk': G.run.atkBonus += 3; break;
    case 'hp': G.run.hpBonus += 20; p.maxHp = effectiveMaxHp(); p.hp = Math.min(p.maxHp, p.hp + 20); break;
    case 'speed': if (G.run.speedBuys < 3) { G.run.speedBonus += 0.5; G.run.speedBuys++; } break;
  }
  sfx.coin();
  refreshHud();
}

function doFloorChange(n, broadcast) {
  if (G.net.role === 'host' && broadcast) netSend({ t: 'floor', n });
  hide('merchant');
  G.mode = 'transition';
  showTransition(n, () => {
    buildFloor(n);
    G.mode = 'playing';
    lockPointer();
  });
}

function victory(fromNet = false) {
  if (G.mode === 'victory') return;
  G.mode = 'victory';
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'victory' });
  sfx.victory();
  G.player?.anim.play('Cheer', { once: false });
  document.exitPointerLock?.();
  $('victoryStats').innerHTML = runStatsHtml();
  show('victory');
}

function gameOver(fromNet = false) {
  if (G.mode === 'dead') return;
  G.mode = 'dead';
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'gover' });
  document.exitPointerLock?.();
  $('deadTitle').textContent = G.net.role === 'solo' ? 'You have fallen…' : 'The whole party has fallen…';
  $('deadStats').innerHTML = runStatsHtml();
  setHidden('respawnMsg', true);
  setHidden('btnRestart', false);
  show('dead');
}

function checkAllDead() {
  if (!isAuthority()) return;
  const meDead = !G.player || G.player.dead;
  let anyAlive = !meDead;
  for (const r of G.remotes.values()) if (!r.dead) anyAlive = true;
  if (!anyAlive) gameOver();
}

// ---------------- input ----------------
function lockPointer() {
  if (G.mode !== 'playing') return;
  try {
    const r = $('game').requestPointerLock?.();
    if (r && r.catch) r.catch(() => {});
  } catch {}
}

function setupInput() {
  const canvas = $('game');
  canvas.addEventListener('click', () => {
    if (G.mode === 'playing') {
      resumeAudio();
      if (!document.pointerLockElement) lockPointer();
      else tryAttack();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    G.mouse.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (G.mouse.locked && G.mode === 'playing') onMouseMove(e.movementX, e.movementY);
  });
  addEventListener('keydown', (e) => {
    G.keys[e.code] = true;
    if (e.code === 'Space') { e.preventDefault(); tryDodge(); }
    if (e.code === 'KeyF') tryAttack();
    if (e.code === 'KeyE') tryInteract(onStairsUsed);
    if (e.code === 'KeyQ') drinkPotion();
    if (e.code === 'KeyM') { const m = toggleMute(); addMsg(m ? 'Muted 🔇' : 'Sound on 🔊'); }
    if (e.code === 'Escape' && G.mode === 'playing') {
      G.mode = 'paused';
      G.paused = true;
      show('pause');
    }
  });
  addEventListener('keyup', (e) => { G.keys[e.code] = false; });
}

// ---------------- respawn (co-op) ----------------
let respawnT = 0;
function updateDeath(dt) {
  const p = G.player;
  if (!p || !p.dead || G.mode !== 'playing') return;
  if (G.net.role === 'solo') {
    if (p.deadT > 2.2) gameOver();
    return;
  }
  // co-op: respawn if a teammate is alive
  let teamAlive = false;
  for (const r of G.remotes.values()) if (!r.dead) teamAlive = true;
  if (!teamAlive) { checkAllDead(); return; }
  respawnT = 8 - p.deadT;
  if (p.deadT > 8) {
    p.dead = false;
    p.hp = Math.round(p.maxHp * 0.5);
    p.iframes = 2;
    p.obj.position.set(G.grid.spawn.x, 0, G.grid.spawn.z);
    p.anim.play('Idle');
    addMsg('You rise again at the entrance.', 'gold');
    refreshHud();
    sendPos(true);
  } else {
    setHidden('respawnMsg', false);
  }
}

// ---------------- main loop ----------------
let last = 0, minimapT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  G.time = t / 1000;

  const simActive = G.mode === 'playing' || (G.mode !== 'menu' && G.net.role !== 'solo' && G.net.started && G.mode !== 'transition');

  if (G.mode === 'playing') {
    updatePlayer(dt);
    updateDeath(dt);
  } else if (G.player && simActive) {
    G.player.anim.update(dt);
  }

  if (simActive) {
    updateEnemies(dt);
    updateRemotes(dt);
    updateLoot(dt);
    updateProjectiles(dt, { damageEnemy, damageLocalPlayer });
    updateFx(dt);
    updateNet(dt);

    // victory check (authority)
    if (isAuthority() && G.hadBoss && G.floor === WIN_FLOOR && !G.endless && G.mode === 'playing' && !anyBossAlive()) {
      victory();
    }

    minimapT += dt;
    if (minimapT > 0.12) { minimapT = 0; updateMinimap(); updateDodgeCooldown(); }
    if (G.player?.dead && G.net.role !== 'solo' && respawnT > 0) {
      $('respawnMsg').textContent = `Respawning in ${Math.ceil(respawnT)}…`;
    }
    if (G.player?.maxMana > 0 && G.mode === 'playing') refreshHudManaOnly();
  }

  if (G.scene && G.camera) G.renderer.render(G.scene, G.camera);
}

let manaT = 0;
function refreshHudManaOnly() {
  manaT++;
  if (manaT % 6 !== 0) return;
  const p = G.player;
  document.getElementById('manafill').style.width = `${(p.mana / p.maxMana) * 100}%`;
}

boot().catch((e) => {
  document.getElementById('loadtext').textContent = 'Failed to load: ' + e.message;
  console.error(e);
});

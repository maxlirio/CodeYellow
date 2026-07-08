// Boot, scene setup, input, game-flow state machine, main loop.
import * as THREE from 'three';
import { G, floorState, setFloorAliases } from './state.js';
import { CLASSES } from './config.js';
import { randomSeed } from './rng.js';
import { loadAll, makeCharacter, applyLook } from './assets.js';
import { initFx, buildTorchFx, updateFx, clearTransientFx } from './fx.js';
import { initAudio, resumeAudio, toggleMute, sfx } from './audio.js';
import { generateFloorData, buildFloorMeshes, disposeAllFloors } from './dungeon.js';
import { spawnEnemiesForFloor, updateEnemies, damageEnemy, spawnEnemy, setEnemyState, killEnemy, refreshBossBarForFloor } from './enemies.js';
import { spawnLootsForFloor, updateLoot, applyTakenSilently, dropItemLoot } from './loot.js';
import { updateProjectiles, clearProjectiles } from './projectiles.js';
import { castSpell, updateSpells, updateBeams, resetCooldowns, cooldowns } from './spells.js';
import { giveStartingGear, equipItem, salvageItem, rollTrinket, addToBag, rarityOf } from './items.js';
import {
  createPlayer, resetPlayerForFloor, updatePlayer, updateRemotes, tryAttack, tryDodge, tryInteract,
  drinkPotion, onMouseMove, damageLocalPlayer, sendPos, effectiveMaxHp, effectiveDamage,
  effectiveSpeed, effectiveCrit, effectiveArmor, effectiveManaRegen, refreshEquipVisuals,
  refreshRemoteVisibility,
} from './player.js';
import {
  show, hide, setHidden, addMsg, refreshHud, updateMinimap, updateDodgeCooldown,
  buildClassCards, renderShop, showTransition, runStatsHtml, hideBossBar,
  updateSpellBar, renderInventory, buildLookControls, setCrosshairAiming,
} from './ui.js';
import {
  setNetCallbacks, wireHandlers, hostGame, joinGame, hostStart, netSend, shutdownNet,
  spawnRemoteAvatars, updateNet, isAuthority,
} from './net.js';

const $ = (id) => document.getElementById(id);
let getClass = () => 'knight';
let invOpen = false;

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
  scene.fog = new THREE.FogExp2(0x0a0812, 0.03);
  G.scene = scene;

  G.camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.08, 130);
  G.camera.position.set(0, 6, 8);
  G.camera.rotation.order = 'YXZ';

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
  setupPreview();
  setupInput();
  addEventListener('resize', () => {
    G.camera.aspect = innerWidth / innerHeight;
    G.camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // debug/test hooks: ?auto=1 starts a solo run immediately, ?seed=xyz fixes the dungeon
  window.G = G;
  const params = new URLSearchParams(location.search);
  if (params.get('auto')) {
    initAudio();
    startRun(params.get('seed') || randomSeed());
  }

  requestAnimationFrame(loop);
}

// ---------------- menu preview (appearance customization) ----------------
let pvRenderer = null, pvScene = null, pvCam = null, pvChar = null;
function setupPreview() {
  const canvas = $('lookPreview');
  pvRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  pvRenderer.setSize(150, 170, false);
  pvRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  pvScene = new THREE.Scene();
  pvCam = new THREE.PerspectiveCamera(35, 150 / 170, 0.1, 20);
  pvCam.position.set(0, 1.5, 4.6);
  pvCam.lookAt(0, 1.0, 0);
  pvScene.add(new THREE.HemisphereLight(0xbbaadd, 0x332619, 1.6));
  const key = new THREE.PointLight(0xffb066, 30, 15);
  key.position.set(2, 3, 3);
  pvScene.add(key);
  rebuildPreview();
}
function rebuildPreview() {
  if (!pvScene) return;
  if (pvChar) pvScene.remove(pvChar);
  const classId = getClass();
  const cls = CLASSES[classId];
  const modelName = classId === 'rogue' && G.look.helmet ? 'Rogue_Hooded' : cls.model;
  const { obj } = makeCharacter('char', modelName, cls.show);
  applyLook(obj, G.look);
  pvChar = obj;
  pvScene.add(obj);
}

// ---------------- menu & lobby ----------------
function playerName() {
  const v = $('nameInput').value.trim();
  return v || 'Adventurer';
}

function setupMenu() {
  getClass = buildClassCards(() => rebuildPreview());
  buildLookControls(() => rebuildPreview());
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
    descendTo(G.floor + 1);
  };
  $('btnCloseInv').onclick = () => toggleInventory(false);

  setNetCallbacks({
    onLobbyUpdate: renderLobby,
    onStart: (seed) => startRun(seed),
    onGameOver: () => gameOver(true),
    onVictory: () => victory(true),
    onHostGone: () => { shutdownNet(); hide('lobby'); show('menu'); },
    onPartyDeath: () => checkAllDead(),
    // a teammate moved to floor n: host must simulate it; everyone updates the party bar
    onPeerFloor: (pid, n) => {
      if (isAuthority()) ensureFloor(n);
      const p = G.net.players.get(pid);
      addMsg(`${p?.name || 'A teammate'} ${n > 1 ? 'descended to' : 'is on'} floor ${n}`);
    },
    ensureFloorSim: (n) => ensureFloor(n),
    onFstate: (m) => applyFstate(m),
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
  G.pendingVictory = false;
  G.run = { gold: 0, potions: 1, keys: 0, atkBonus: 0, hpBonus: 0, speedBonus: 0, speedBuys: 0, level: 1, xp: 0, kills: 0, chests: 0, startTime: performance.now(), buys: {} };
  resetCooldowns();
  hide('menu'); hide('lobby'); hide('merchant'); hide('dead'); hide('victory'); hide('inventory');
  invOpen = false;
  setHidden('hud', false);

  disposeAllFloors();
  clearTransientFx();
  clearProjectiles();

  const classId = getClass();
  giveStartingGear(classId);
  createPlayer(classId, playerName());
  G.player.maxHp = effectiveMaxHp();
  G.player.hp = G.player.maxHp;

  setLocalFloor(1);
  spawnRemoteAvatars();
  refreshRemoteVisibility();
  G.mode = 'playing';
  refreshHud();
  addMsg('Descend. Survive. Destroy the Bone King on floor 9.', 'gold');
  addMsg('Click the screen to capture the mouse.');
  lockPointer();
}

// make sure a floor's data + entities exist (no visuals) — used by the host for
// floors teammates are on, and locally before entering one
function ensureFloor(n) {
  const fs = floorState(n);
  if (!fs.grid) {
    Object.assign(fs, generateFloorData(G.seed, n));
  }
  if (!fs.spawned) {
    spawnEnemiesForFloor(fs);
    spawnLootsForFloor(fs);
    fs.spawned = true;
  }
  return fs;
}

// move MY view/simulation to floor n
function setLocalFloor(n) {
  const prev = G.floors.get(G.floor);
  if (prev) {
    if (prev.meshGroup) prev.meshGroup.visible = false;
    if (prev.enemyGroup) prev.enemyGroup.visible = false;
    if (prev.lootGroup) prev.lootGroup.visible = false;
  }
  const fs = ensureFloor(n);
  buildFloorMeshes(fs);
  fs.meshGroup.visible = true;
  fs.enemyGroup.visible = true;
  fs.lootGroup.visible = true;
  G.floor = n;
  setFloorAliases(fs);
  clearTransientFx();
  clearProjectiles();
  buildTorchFx();
  resetPlayerForFloor();
  refreshRemoteVisibility();
  refreshBossBarForFloor();
  refreshHud();
  sendPos(true);
  netSend({ t: 'pfloor', n });
  if (G.net.role === 'guest') netSend({ t: 'freq', n });
}

// apply the host's snapshot of what already happened on my new floor
function applyFstate(m) {
  const fs = G.floors.get(m.f);
  if (!fs || !fs.spawned) return;
  for (const s of m.summons) {
    if (!fs.enemies.find(e => e.id === s.id)) {
      const e = spawnEnemy(fs, s.type, s.x, s.z, { y: s.y, id: s.id });
      setEnemyState(e, 'awaken', true);
    }
  }
  for (const d of m.drops) {
    if (!fs.loots.find(l => l.id === d.id)) dropItemLoot(fs, d.item, d.x, d.z, d.y, d.id);
  }
  for (const id of m.dead) {
    const e = fs.enemies.find(x => x.id === id);
    if (e && e.state !== 'dead') {
      killEnemy(e, 'remote', true);
      e.deadT = 5;
      e.obj.visible = false;
    }
  }
  for (const [id, hp] of m.hp) {
    const e = fs.enemies.find(x => x.id === id);
    if (e) { e.hp = hp; }
  }
  applyTakenSilently(fs, m.taken);
  if (fs.grid) fs.grid.stairsLocked = m.locked;
  if (m.f === G.floor) refreshBossBarForFloor();
}

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
  const p = G.player;
  if (id === 'relic') {
    if (G.inv.bag.length >= 12) { addMsg('Your bag is full!', 'bad'); return; }
    G.run.gold -= price;
    G.run.buys[id] = (G.run.buys[id] || 0) + 1;
    const item = rollTrinket(G.floor, 0.3);
    addToBag(item);
    addMsg(`The merchant hands you <span style="color:${rarityOf(item).color}">${item.name}</span>`, 'gold');
    sfx.chest();
    refreshHud();
    return;
  }
  G.run.gold -= price;
  G.run.buys[id] = (G.run.buys[id] || 0) + 1;
  switch (id) {
    case 'potion': G.run.potions++; break;
    case 'atk': G.run.atkBonus += 3; break;
    case 'hp': G.run.hpBonus += 20; p.maxHp = effectiveMaxHp(); p.hp = Math.min(p.maxHp, p.hp + 20); break;
  }
  sfx.coin();
  refreshHud();
}

// personal descent: only I change floors; teammates stay where they are
function descendTo(n) {
  G.mode = 'transition';
  showTransition(n, () => {
    setLocalFloor(n);
    G.mode = 'playing';
    lockPointer();
  });
}

function victory(fromNet = false) {
  if (G.mode === 'victory') return;
  G.mode = 'victory';
  if (G.net.role === 'host' && !fromNet) netSend({ t: 'victory' });
  sfx.victory();
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

// ---------------- inventory ----------------
function invStatsHtml() {
  return `⚔ Damage: <b>${effectiveDamage()}</b><br>` +
    `🎯 Crit: <b>${Math.round(effectiveCrit() * 100)}%</b> · 🛡 Reduction: <b>${Math.round(effectiveArmor() * 100)}%</b><br>` +
    `👢 Speed: <b>${effectiveSpeed().toFixed(1)}</b> · 🔮 Mana/s: <b>${effectiveManaRegen().toFixed(1)}</b><br>` +
    `❤ Max HP: <b>${effectiveMaxHp()}</b>`;
}
function rerenderInventory() {
  renderInventory({
    onEquip: (item) => {
      if (item.classId && item.classId !== G.player.classId) { addMsg('Your class can’t use that.', 'bad'); return; }
      equipItem(item);
      refreshEquipVisuals();
      sfx.key();
      rerenderInventory();
    },
    onSalvage: (item) => {
      const v = salvageItem(item);
      if (v) { addMsg(`Salvaged for ${v} gold`, 'gold'); sfx.coin(); refreshHud(); rerenderInventory(); }
    },
    statsHtml: invStatsHtml(),
  });
}
function toggleInventory(open = !invOpen) {
  if (G.mode !== 'playing' && !invOpen) return;
  invOpen = open;
  if (invOpen) {
    document.exitPointerLock?.();
    rerenderInventory();
    show('inventory');
  } else {
    hide('inventory');
    lockPointer();
  }
}

// ---------------- input ----------------
function lockPointer() {
  if (G.mode !== 'playing' || invOpen) return;
  try {
    const r = $('game').requestPointerLock?.();
    if (r && r.catch) r.catch(() => {});
  } catch {}
}

function setupInput() {
  const canvas = $('game');
  canvas.addEventListener('click', () => {
    if (G.mode === 'playing' && !invOpen) {
      resumeAudio();
      if (!document.pointerLockElement) lockPointer();
      else tryAttack();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    G.mouse.locked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (G.mouse.locked && G.mode === 'playing' && !invOpen) onMouseMove(e.movementX, e.movementY);
  });
  addEventListener('keydown', (e) => {
    G.keys[e.code] = true;
    if (e.code === 'Tab') { e.preventDefault(); toggleInventory(); return; }
    if (invOpen) { if (e.code === 'Escape') toggleInventory(false); return; }
    if (e.code === 'Space') { e.preventDefault(); tryDodge(); }
    if (e.code === 'KeyF') tryAttack();
    if (e.code === 'KeyE') tryInteract(onStairsUsed);
    if (e.code === 'KeyQ') drinkPotion();
    if (e.code === 'Digit1') castSpell(0, effectiveDamage);
    if (e.code === 'Digit2') castSpell(1, effectiveDamage);
    if (e.code === 'Digit3') castSpell(2, effectiveDamage);
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
    if (p.deadT > 2.6) gameOver();
    return;
  }
  let teamAlive = false;
  for (const r of G.remotes.values()) if (!r.dead) teamAlive = true;
  if (!teamAlive) { checkAllDead(); return; }
  respawnT = 8 - p.deadT;
  if (p.deadT > 8) {
    p.dead = false;
    p.hp = Math.round(p.maxHp * 0.5);
    p.iframes = 2;
    p.obj.position.set(G.grid.spawn.x, 0, G.grid.spawn.z);
    p.obj.visible = false;
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
    setCrosshairAiming(!!G.player?.aiming);
  } else if (G.player && simActive) {
    G.player.anim.update(dt);
  }

  if (simActive) {
    updateEnemies(dt);
    updateRemotes(dt);
    updateLoot(dt);
    updateProjectiles(dt, { damageEnemy, damageLocalPlayer });
    updateSpells(dt);
    updateBeams(dt);
    updateFx(dt);
    updateNet(dt);

    if (G.pendingVictory) {
      G.pendingVictory = false;
      victory();
    }

    minimapT += dt;
    if (minimapT > 0.12) {
      minimapT = 0;
      updateMinimap();
      updateDodgeCooldown();
      updateSpellBar(cooldowns);
      refreshHudManaOnly();
    }
    if (G.player?.dead && G.net.role !== 'solo' && respawnT > 0) {
      $('respawnMsg').textContent = `Respawning in ${Math.ceil(respawnT)}…`;
    }
  }

  // menu preview spin
  if (G.mode === 'menu' || $('menu').classList.contains('show')) {
    if (pvChar) {
      pvChar.rotation.y += dt * 0.8;
      pvRenderer.render(pvScene, pvCam);
    }
  }

  if (G.scene && G.camera) G.renderer.render(G.scene, G.camera);
}

function refreshHudManaOnly() {
  const p = G.player;
  if (!p || p.maxMana <= 0) return;
  document.getElementById('manafill').style.width = `${(p.mana / p.maxMana) * 100}%`;
}

boot().catch((e) => {
  document.getElementById('loadtext').textContent = 'Failed to load: ' + e.message;
  console.error(e);
});

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
import { castSpell, updateSpells, updateBeams, resetCooldowns, cooldowns, dealSpells, rerollSpell } from './spells.js';
import { giveStartingGear, equipItem, salvageItem, rollTrinket, rollWeapon, rollOffhand, addToBag, rarityOf } from './items.js';
import { SPELLS, SHOP_TABLES } from './config.js';
import { generateTownData, generateArenaData, spawnTownNpcs, updateTownNpcs } from './town.js';
import { initViewmodel, updateViewmodel } from './viewmodel.js';
import { updateWalls, clearWalls } from './walls.js';
import { initFloorTraps, updateTraps } from './traps.js';
import { buildRopesForFloor, updateRopes } from './ropes.js';
import { updateMinions, clearMinions, moveMinionsToFloor, refreshMinionVisibility } from './minions.js';
import { horde, startHorde, stopHorde, updateHorde, tryHireMerc } from './horde.js';
import { toggleBuildMode, cycleBuildPiece, updateBuildGhost, placeCurrentBuild, buildState, clearBuilds } from './builds.js';
import { themeFor } from './dungeon.js';
import { fetchPublicGames, publishGame, unpublishGame } from './board.js';
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
  renderBoardList, renderStash,
} from './ui.js';
import {
  setNetCallbacks, wireHandlers, hostGame, joinGame, hostStart, netSend, shutdownNet,
  spawnRemoteAvatars, updateNet, isAuthority, myId,
} from './net.js';

const $ = (id) => document.getElementById(id);
let getClass = () => 'knight';
let invOpen = false;
let runMode = 'campaign';

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

  const hemi = new THREE.HemisphereLight(0x9988bb, 0x2a2016, 0.85);
  const amb = new THREE.AmbientLight(0x4a4260, 0.7);
  const sun = new THREE.DirectionalLight(0xfff1cc, 0); // only shines in town
  sun.position.set(40, 70, 25);
  scene.add(hemi, amb, sun);
  G.lights = { hemi, amb, sun };

  initFx();
  initViewmodel();
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
  window.jumpFloor = (n) => descendTo(n);
  const params = new URLSearchParams(location.search);
  if (params.get('auto')) {
    initAudio();
    startRun(params.get('seed') || randomSeed(), params.get('mode') || 'campaign');
  } else if (params.get('join')) {
    history.replaceState(null, '', location.pathname);
    $('joinCode').value = params.get('join').toUpperCase();
    setTimeout(() => $('btnJoin').click(), 300);
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

  // game mode selector
  document.querySelectorAll('.modebtn').forEach((el) => {
    el.onclick = () => {
      document.querySelectorAll('.modebtn').forEach(b => b.classList.remove('sel'));
      el.classList.add('sel');
      runMode = el.dataset.mode;
    };
  });

  // tavern board (public games)
  const openBoard = async () => {
    show('tavernBoard');
    $('boardList').innerHTML = '<div class="board-empty">Checking the board…</div>';
    const games = await fetchPublicGames();
    renderBoardList(games.filter(g => g.code !== G.net.code), (code) => {
      if (G.mode !== 'menu' || G.net.role !== 'solo') {
        // mid-run: hand off to a clean session that auto-joins
        location.href = location.pathname + '?join=' + code;
        return;
      }
      hide('tavernBoard');
      $('joinCode').value = code;
      $('btnJoin').click();
    });
  };
  $('btnBoard').onclick = openBoard;
  window.openTavernBoard = openBoard; // the in-town notice board uses this too
  $('btnBoardRefresh').onclick = openBoard;
  $('btnBoardClose').onclick = () => { hide('tavernBoard'); if (G.mode === 'playing') lockPointer(); };

  $('btnSolo').onclick = () => { initAudio(); startRun(randomSeed(), runMode); };

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
      if ($('pubToggle').checked) {
        publishGame(code, { name: playerName(), mode: runMode, players: 1 });
      }
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
    unpublishGame();
    hostStart(runMode);
    startRun(G.seed, runMode);
  };
  $('btnLeaveLobby').onclick = () => { unpublishGame(); shutdownNet(); hide('lobby'); show('menu'); };

  $('btnRestart').onclick = () => location.reload();
  $('btnMenu').onclick = () => location.reload();
  $('btnEndless').onclick = () => {
    G.endless = true;
    hide('victory');
    descendTo(G.floor + 1);
  };
  $('btnResume').onclick = () => { hide('pause'); G.mode = 'playing'; G.paused = false; lockPointer(); };
  $('btnQuit').onclick = () => location.reload();

  // stairs choice (dungeon floors)
  $('btnGoDown').onclick = () => { hide('stairsDialog'); descendTo(G.floor + 1); };
  $('btnToTown').onclick = () => { hide('stairsDialog'); descendTo(0); };
  $('btnStayHere').onclick = () => { hide('stairsDialog'); G.mode = 'playing'; lockPointer(); };

  // shop overlay
  $('btnCloseShop').onclick = () => { hide('merchant'); G.mode = 'playing'; lockPointer(); };
  $('btnCloseStash').onclick = () => { hide('stash'); G.mode = 'playing'; lockPointer(); };
  $('btnHireSword').onclick = () => { hide('hireDialog'); tryHireMerc('sword'); lockPointer(); };
  $('btnHireBow').onclick = () => { hide('hireDialog'); tryHireMerc('bow'); lockPointer(); };
  $('btnHireCancel').onclick = () => { hide('hireDialog'); lockPointer(); };
  $('btnFloorCancel').onclick = () => { hide('floorSelect'); G.mode = 'playing'; lockPointer(); };
  $('btnCloseInv').onclick = () => toggleInventory(false);

  setNetCallbacks({
    onLobbyUpdate: renderLobby,
    onStart: (seed, mode) => startRun(seed, mode),
    onGameOver: () => gameOver(true),
    onVictory: () => victory(true),
    onHostGone: () => { shutdownNet(); hide('lobby'); show('menu'); },
    onPartyDeath: () => checkAllDead(),
    // a teammate moved to floor n: host must simulate it; everyone updates the party bar
    onPeerFloor: (pid, n) => {
      if (isAuthority()) {
        ensureFloor(n);
        moveMinionsToFloor(pid, n);
      }
      const p = G.net.players.get(pid);
      addMsg(`${p?.name || 'A teammate'} ${n === 0 ? 'returned to town' : 'moved to floor ' + n}`);
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
function startRun(seed, mode = 'campaign') {
  G.seed = seed || randomSeed();
  runMode = mode;
  G.runMode = mode;
  G.floor = mode === 'horde' ? 1 : 0;
  G.endless = false;
  G.pendingVictory = false;
  G.run = { gold: mode === 'horde' ? 60 : 0, potions: 1, keys: 0, atkBonus: 0, hpBonus: 0, speedBonus: 0, speedBuys: 0, level: 1, xp: 0, kills: 0, chests: 0, startTime: performance.now(), buys: {}, deepest: 0 };
  resetCooldowns();
  stopHorde();
  hide('menu'); hide('lobby'); hide('merchant'); hide('dead'); hide('victory'); hide('inventory'); hide('stairsDialog'); hide('tavernBoard');
  invOpen = false;
  setHidden('hud', false);

  disposeAllFloors();
  clearTransientFx();
  clearProjectiles();
  clearWalls();
  clearMinions();
  clearBuilds();
  G.run.arrows = 40;

  const classId = getClass();
  giveStartingGear(classId);
  createPlayer(classId, playerName());
  G.player.maxHp = effectiveMaxHp();
  G.player.hp = G.player.maxHp;
  const spells = dealSpells(classId);
  addMsg(`Your spells this run: ${spells.map(s => `${SPELLS[s].icon} ${SPELLS[s].name}`).join(' · ')}`, 'gold');

  if (mode === 'horde') {
    setLocalFloor(1);
    startHorde();
  } else if (mode === 'duel') {
    G.run.gold = 300;
    setLocalFloor(1);
    addMsg('⚔ DUEL — build with B, fight your rivals. Gold trickles in over time.', 'gold');
  } else {
    setLocalFloor(0);
    addMsg('Welcome to Emberlight Village. The dungeon gate is in the north wall.', 'gold');
    addMsg('Visit the shops — then descend and destroy the Bone King on floor 9.');
  }
  spawnRemoteAvatars();
  refreshRemoteVisibility();
  G.mode = 'playing';
  refreshHud();
  addMsg('Click the screen to capture the mouse.');
  lockPointer();
}

// make sure a floor's data + entities exist (no visuals) — used by the host for
// floors teammates are on, and locally before entering one.
// Floor 0 is the town; in horde mode floor 1 is the arena.
function ensureFloor(n) {
  const fs = floorState(n);
  if (!fs.grid) {
    if (n === 0) Object.assign(fs, generateTownData());
    else if (runMode !== 'campaign') Object.assign(fs, generateArenaData());
    else Object.assign(fs, generateFloorData(G.seed, n));
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
  initFloorTraps(fs);
  buildRopesForFloor(fs);
  if (fs.npcs) spawnTownNpcs(fs);
  fs.meshGroup.visible = true;
  fs.enemyGroup.visible = true;
  fs.lootGroup.visible = true;
  G.floor = n;
  setFloorAliases(fs);
  applyThemeAtmosphere(fs);
  clearTransientFx();
  clearProjectiles();
  buildTorchFx();
  resetPlayerForFloor();
  refreshRemoteVisibility();
  refreshMinionVisibility();
  if (G.net.role !== 'guest') moveMinionsToFloor(myId(), n);
  refreshBossBarForFloor();
  refreshHud();
  if (fs.mutator) addMsg(`⚠ ${fs.mutator.name}: ${fs.mutator.desc}`, 'bad');
  sendPos(true);
  netSend({ t: 'pfloor', n });
  if (G.net.role === 'guest') netSend({ t: 'freq', n });
}

// every theme recolors the whole floor's atmosphere
function applyThemeAtmosphere(fs) {
  const th = fs.theme;
  if (!th) return;
  G.scene.fog.color.setHex(th.fog);
  G.scene.fog.density = th.density * (fs.mutator?.torchMult ? 1.25 : 1);
  G.scene.background.setHex(th.fog);
  G.lights.hemi.color.setHex(th.hemi);
  G.lights.amb.color.setHex(th.amb);
  const dark = fs.mutator?.torchMult ?? 1;
  const sunny = th.sun ? 1.35 : 1;
  G.lights.hemi.intensity = 0.85 * (dark < 1 ? 0.55 : 1) * sunny;
  G.lights.amb.intensity = 0.7 * (dark < 1 ? 0.55 : 1) * sunny;
  G.lights.sun.intensity = th.sun ? 1.2 : 0; // daylight only above ground
  G.torchColor = th.torch;
}

// apply the host's snapshot of what already happened on my new floor
function applyFstate(m) {
  const fs = G.floors.get(m.f);
  if (!fs || !fs.spawned) return;
  // self-heal: rebuild ANY living enemy we somehow don't have (missed message)
  for (const s of m.ealive || []) {
    if (!fs.enemies.find(e => e.id === s[0])) {
      const e = spawnEnemy(fs, s[1], s[2], s[3], { y: s[4], elite: !!s[5], id: s[0] });
      setEnemyState(e, 'awaken', true);
    }
  }
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
  if (G.grid.town) {
    openFloorSelect(); // pick any floor you've reached (or the next one down)
    return;
  }
  G.mode = 'merchant';
  document.exitPointerLock?.();
  $('stairsSub').textContent = `Floor ${G.floor} cleared? Floor ${G.floor + 1} awaits below — or head home to spend your gold.`;
  show('stairsDialog');
}

// shopkeeper interaction (E in town)
// claim a house / open your persistent stash
function loadStash() {
  try { return JSON.parse(localStorage.getItem('codeorange_stash') || '[]'); } catch { return []; }
}
function saveStash(s) { localStorage.setItem('codeorange_stash', JSON.stringify(s)); }

function onHomeDoor(home) {
  const mine = localStorage.getItem('codeorange_home');
  if (mine === null) {
    localStorage.setItem('codeorange_home', String(home.idx));
    addMsg('🏠 This house is yours now! Your stash lives inside — items stored there survive between runs.', 'gold');
    sfx.chest();
    return;
  }
  if (+mine !== home.idx) return;
  openStash();
}

function openStash() {
  G.mode = 'merchant';
  document.exitPointerLock?.();
  const rerender = () => {
    const stash = loadStash();
    renderStash({
      stash,
      onToStash: (item) => {
        const s = loadStash();
        if (s.length >= 12) { addMsg('Stash is full!', 'bad'); return; }
        const i = G.inv.bag.indexOf(item);
        if (i >= 0) G.inv.bag.splice(i, 1);
        s.push(item);
        saveStash(s);
        sfx.coin();
        rerender();
      },
      onToBag: (item) => {
        if (G.inv.bag.length >= 12) { addMsg('Bag is full!', 'bad'); return; }
        const s = loadStash();
        const i = s.findIndex(x => x.uid === item.uid && x.name === item.name);
        if (i >= 0) s.splice(i, 1);
        saveStash(s);
        G.inv.bag.push(item);
        sfx.coin();
        rerender();
      },
    });
  };
  rerender();
  show('stash');
}

// choose which mercenary to hire
function openHireDialog() {
  if (!G.player || G.player.dead) return;
  document.exitPointerLock?.();
  show('hireDialog');
}

// pick a dungeon floor at the village gate: anywhere you've been, plus the next
function openFloorSelect() {
  document.exitPointerLock?.();
  G.mode = 'merchant';
  const wrap = $('floorButtons');
  wrap.innerHTML = '';
  const maxPick = Math.max(1, (G.run.deepest || 0) + 1);
  for (let n = 1; n <= maxPick; n++) {
    const btn = document.createElement('button');
    btn.className = 'floorbtn';
    const boss = n === 3 || n === 6 || n === 9 || (n > 9 && n % 3 === 0);
    btn.innerHTML = `<b>Floor ${n}</b><span>${themeFor(G.seed, n).name}${boss ? ' · 💀 boss' : ''}${n === maxPick && n > (G.run.deepest || 0) ? ' · unexplored' : ''}</span>`;
    btn.onclick = () => { hide('floorSelect'); descendTo(n); };
    wrap.appendChild(btn);
  }
  show('floorSelect');
}

function onShopOpened(type) {
  if (type === 'board') { document.exitPointerLock?.(); window.openTavernBoard(); return; }
  const table = SHOP_TABLES[type];
  if (!table) return;
  G.mode = 'merchant';
  document.exitPointerLock?.();
  renderShop(buyItem, table);
  show('merchant');
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
  if (id === 'tome') {
    const r = rerollSpell();
    if (!r) { addMsg('You already know every spell of your school.', 'bad'); return; }
    G.run.gold -= price;
    G.run.buys[id] = (G.run.buys[id] || 0) + 1;
    addMsg(`The tome unbinds <b>${r.old}</b> and teaches you ${r.icon} <b>${r.now}</b>!`, 'gold');
    sfx.levelup();
    refreshHud();
    return;
  }
  if (id === 'reforge' || id === 'offhand') {
    if (G.inv.bag.length >= 12) { addMsg('Your bag is full!', 'bad'); return; }
    G.run.gold -= price;
    G.run.buys[id] = (G.run.buys[id] || 0) + 1;
    const item = id === 'reforge'
      ? rollWeapon(p.classId, Math.max(G.floor, G.run.deepest), 0.4)
      : rollOffhand(p.classId, Math.max(G.floor, G.run.deepest), 0.4);
    addToBag(item);
    addMsg(`Forged: <span style="color:${rarityOf(item).color}">${item.name}</span> — Tab to equip`, 'gold');
    sfx.chest();
    refreshHud();
    return;
  }
  if (id === 'merc') {
    openHireDialog(); // choose sellsword or marksman
    return;
  }
  if (id === 'arrows') {
    if (G.run.gold < price) { addMsg('Not enough gold.', 'bad'); return; }
    G.run.gold -= price;
    G.run.arrows = (G.run.arrows || 0) + 25;
    addMsg('+25 arrows 🏹', 'gold');
    sfx.coin();
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

// personal descent (or a trip home): only I change floors; teammates stay put
function descendTo(n) {
  G.mode = 'transition';
  if (n > 0) G.run.deepest = Math.max(G.run.deepest || 1, n);
  const fs = ensureFloor(n); // peek at what awaits for the banner
  showTransition(n, () => {
    setLocalFloor(n);
    G.mode = 'playing';
    lockPointer();
  }, fs.theme?.name, fs.mutator ? `${fs.mutator.name} — ${fs.mutator.desc}` : null);
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
  $('deadStats').innerHTML = (horde.active ? `🌊 Waves survived: <b>${Math.max(0, horde.wave - (horde.phase === 'combat' ? 1 : 0))}</b><br>` : '') + runStatsHtml();
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
      if (!document.pointerLockElement) { lockPointer(); return; }
      if (buildState.on) { placeCurrentBuild(); return; } // build mode: click places
      tryAttack();
    }
  });
  addEventListener('wheel', (e) => {
    if (buildState.on && G.mode === 'playing') cycleBuildPiece(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });
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
    if (e.code === 'KeyE') tryInteract(onStairsUsed, onShopOpened, onHomeDoor);
    if (e.code === 'KeyQ') drinkPotion();
    if (e.code === 'KeyB' && (horde.active || G.runMode === 'duel')) toggleBuildMode();
    if (e.code === 'KeyH' && horde.active) openHireDialog();
    if (e.code === 'KeyP' && (horde.active || G.runMode === 'duel')) buyItem('arrows', 20);
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
  if (G.runMode === 'duel') {
    // duels always respawn you at your corner
    if (p.deadT > 5) {
      p.dead = false;
      p.hp = p.maxHp;
      p.iframes = 2;
      p.obj.position.set(G.grid.spawn.x + (Math.random() * 12 - 6), 0, G.grid.spawn.z + (Math.random() * 6 - 3));
      p.obj.visible = false;
      p.anim.play('Idle');
      addMsg('Back into the fray!', 'gold');
      refreshHud();
      sendPos(true);
    } else {
      setHidden('respawnMsg', false);
      $('respawnMsg').textContent = `Respawning in ${Math.ceil(5 - p.deadT)}…`;
    }
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
let last = 0, minimapT = 0, duelGoldT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  G.time = t / 1000;

  // CodeBlue lesson: in co-op the world NEVER pauses for one player's overlays —
  // the host keeps simulating through its own pause/transition/inventory/death.
  const simActive = G.mode === 'playing' || (G.mode !== 'menu' && G.net.role !== 'solo' && G.net.started);

  if (G.mode === 'playing') {
    updatePlayer(dt);
    updateDeath(dt);
    setCrosshairAiming(!!G.player?.aiming);
  } else if (G.player && simActive) {
    G.player.anim.update(dt);
  }
  updateViewmodel(dt);

  if (simActive) {
    updateEnemies(dt);
    updateRemotes(dt);
    updateLoot(dt);
    updateProjectiles(dt, { damageEnemy, damageLocalPlayer });
    updateSpells(dt);
    updateBeams(dt);
    updateFx(dt);
    updateWalls(dt);
    updateTraps(dt);
    updateRopes(dt);
    updateTownNpcs(dt);
    updateMinions(dt);
    updateHorde(dt);
    updateBuildGhost();
    if (G.runMode === 'duel' && G.mode === 'playing') {
      duelGoldT += dt;
      if (duelGoldT > 5) {
        duelGoldT = 0;
        G.run.gold += 15;
        refreshHud();
      }
      const wh = document.getElementById('waveHud');
      wh.classList.remove('hidden');
      wh.textContent = '⚔ DUEL — B build · P arrows · last one standing';
    }
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

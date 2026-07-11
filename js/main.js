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
import { castSpell, castSignature, updateSpells, updateBeams, resetCooldowns, cooldowns, dealSpells, rerollSpell } from './spells.js';
import { giveStartingGear, equipItem, salvageItem, rollTrinket, rollWeapon, rollOffhand, addToBag, rarityOf } from './items.js';
import { SPELLS, SHOP_TABLES, ENEMIES, RARITIES } from './config.js';
import { generateTownData, generateArenaData, spawnTownNpcs, updateTownNpcs } from './town.js';
import { initViewmodel, updateViewmodel } from './viewmodel.js';
import { updateWalls, clearWalls } from './walls.js';
import { initFloorTraps, updateTraps } from './traps.js';
import { buildRopesForFloor, updateRopes } from './ropes.js';
import { updateMinions, clearMinions, moveMinionsToFloor, refreshMinionVisibility } from './minions.js';
import { horde, startHorde, stopHorde, updateHorde, tryHireMerc } from './horde.js';
import { toggleBuildMode, cycleBuildPiece, updateBuildGhost, placeCurrentBuild, buildState, clearBuilds } from './builds.js';
import { toggleMachineMode, cycleMachine, updateMachineGhost, placeCurrentMachine, machineState, updateMachines, clearMachines, refreshMachineVisibility } from './machines.js';
import { initCommander, openCommandMap, closeCommandMap, commander } from './commander.js';
import { themeFor } from './dungeon.js';
import { setMusicBase, setBossMusic, musicCtxFor, toggleMusic, updateMusic } from './music.js';
import { fetchPublicGames, publishGame, unpublishGame } from './board.js';
import {
  createPlayer, resetPlayerForFloor, updatePlayer, updateRemotes, tryAttack, tryDodge, tryInteract,
  drinkPotion, onMouseMove, damageLocalPlayer, sendPos, effectiveMaxHp, effectiveDamage,
  effectiveSpeed, effectiveCrit, effectiveArmor, effectiveManaRegen, refreshEquipVisuals,
  refreshRemoteVisibility, effectiveAttackTime, weaponHitEffects, addSigCharge,
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
    // ?boss=1 — playtest kit: a seasoned delver dropped at the dragon's door
    if (params.get('boss')) {
      const classId = getClass();
      G.run.level = 10;
      G.run.gold = 500; G.run.potions = 6; G.run.arrows = 150;
      G.run.atkBonus = 8; G.run.hpBonus = 60; G.run.deepest = 9;
      let w = null;
      for (let i = 0; i < 600; i++) {
        const c = rollWeapon(classId, 9, 9);
        if (c.rarity === 'legendary' && c.sig) { w = c; break; }
        if (!w || RARITIES.findIndex(r => r.id === c.rarity) > RARITIES.findIndex(r => r.id === w.rarity)) w = c;
      }
      G.inv.weapon = w;
      G.inv.offhand = rollOffhand(classId, 9, 9);
      G.inv.trinket = rollTrinket(classId, 9, 9);
      refreshEquipVisuals();
      G.player.maxHp = effectiveMaxHp();
      G.player.hp = G.player.maxHp;
      G.player.mana = G.player.maxMana;
      refreshHud();
      addMsg(`⚔ Playtest kit: Lv10, ${w.name}`, 'gold');
      setTimeout(() => descendTo(9), 800);
      if (params.get('spectate')) {
        G.spectate = true;
        const placeChampion = setInterval(() => {
          const d = G.enemies.find(en => en.cfg?.dragon);
          if (!d || G.floor !== 9) return;
          clearInterval(placeChampion);
          G.player.obj.position.set(d.obj.position.x, 0, d.obj.position.z + 14);
          addMsg('🎬 Spectating: the Champion duels EMBERWING', 'gold');
        }, 500);
      }
    }
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
  $('btnPauseMode').onclick = () => { hide('pause'); G.paused = false; openModeDialog(); };
  $('btnQuit').onclick = () => location.reload();

  // stairs choice (dungeon floors)
  $('btnGoDown').onclick = () => { hide('stairsDialog'); descendTo(G.floor + 1); };
  $('btnToTown').onclick = () => { hide('stairsDialog'); descendTo(0); };
  $('btnStayHere').onclick = () => { hide('stairsDialog'); G.mode = 'playing'; lockPointer(); };

  // shop overlay
  $('btnCloseShop').onclick = () => { hide('merchant'); G.mode = 'playing'; lockPointer(); };
  $('btnCloseCodex').onclick = () => { hide('codexDialog'); G.mode = 'playing'; lockPointer(); };
  $('btnCloseStash').onclick = () => { hide('stash'); G.mode = 'playing'; lockPointer(); };
  $('btnHireSword').onclick = () => { hide('hireDialog'); tryHireMerc('sword'); lockPointer(); };
  $('btnHireBow').onclick = () => { hide('hireDialog'); tryHireMerc('bow'); lockPointer(); };
  $('btnHireWorker').onclick = () => { hide('hireDialog'); tryHireMerc('worker'); lockPointer(); };
  $('btnHireCancel').onclick = () => { hide('hireDialog'); lockPointer(); };
  $('btnCloseCmd').onclick = () => { closeCommandMap(); G.mode = 'playing'; lockPointer(); };
  initCommander();
  $('btnFloorCancel').onclick = () => { hide('floorSelect'); G.mode = 'playing'; lockPointer(); };
  $('btnModeCampaign').onclick = () => switchMode('campaign');
  $('btnModeHorde').onclick = () => switchMode('horde');
  $('btnModeDuel').onclick = () => switchMode('duel');
  $('btnModeCancel').onclick = () => { hide('modeDialog'); G.mode = 'playing'; lockPointer(); };
  $('btnCloseInv').onclick = () => toggleInventory(false);

  setNetCallbacks({
    onLobbyUpdate: renderLobby,
    onStart: (seed, mode) => startRun(seed, mode),
    onModeSwitch: (mode) => { applyModeSwitch(mode); },
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
  hide('menu'); hide('lobby'); hide('merchant'); hide('dead'); hide('victory'); hide('inventory'); hide('stairsDialog'); hide('tavernBoard'); hide('modeDialog'); hide('tomeDialog');
  invOpen = false;
  setHidden('hud', false);

  disposeAllFloors();
  clearTransientFx();
  clearProjectiles();
  clearWalls();
  clearMinions();
  clearBuilds();
  clearMachines();
  G.run.arrows = 40;

  const classId = getClass();
  giveStartingGear(classId);
  createPlayer(classId, playerName());
  G.player.maxHp = effectiveMaxHp();
  G.player.hp = G.player.maxHp;
  const spells = dealSpells(classId);
  const kitWord = CLASSES[classId].physical ? 'abilities' : 'spells';
  addMsg(`Your ${kitWord} this run: ${spells.map(s => `${SPELLS[s].icon} ${SPELLS[s].name}`).join(' · ')}`, 'gold');

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
    addMsg('Visit the shops — then descend and slay the dragon Emberwing on floor 9.');
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
  setMusicBase(musicCtxFor(n, G.runMode, fs.theme?.id));
  clearTransientFx();
  clearProjectiles();
  buildTorchFx();
  resetPlayerForFloor();
  refreshRemoteVisibility();
  refreshMinionVisibility();
  refreshMachineVisibility();
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
  // the dragon's lair burns clearer — you must SEE her across the hall
  const lairMult = fs.n > 0 && fs.n % 9 === 0 ? 0.55 : 1;
  G.scene.fog.density = th.density * (fs.mutator?.torchMult ? 1.25 : 1) * lairMult;
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

// choose which mercenary to hire (workers only muster for the Last Stand)
function openHireDialog() {
  if (!G.player || G.player.dead) return;
  document.exitPointerLock?.();
  setHidden('btnHireWorker', !horde.active);
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

// ---- the training corner: exact numbers straight out of the combat code ----
const pct = (x) => Math.round(x * 100) + '%';
const statLine = (k, v) => `<b>${k}:</b> ${v}<br>`;

function spellDetail(sp, dmg, p) {
  const sd = Math.round(dmg * (sp.dmgMult || 1));
  const bits = [];
  switch (sp.type) {
    case 'proj': {
      bits.push(`${sp.count || 1} projectile${(sp.count || 1) > 1 ? 's' : ''} × <b>${sd}</b> dmg, speed ${sp.speed}`);
      if (sp.aoe) bits.push(`${sp.aoe}u blast on impact`);
      if (sp.pierce) bits.push('pierces through enemies');
      if (sp.bounce) bits.push(`bounces ${sp.bounce} times`);
      if (sp.poison) bits.push(`poisons: <b>${Math.round(sd * sp.poison.mult)}</b>/s for ${sp.poison.dur}s`);
      if (sp.slow) bits.push(`chills: foes move at ${pct(sp.slow.mult)} for ${sp.slow.dur}s`);
      break;
    }
    case 'cone': bits.push(`<b>${sd}</b> dmg in a ${sp.range}u cone, knockback ${sp.knockback}, stun ${sp.stun}s`); break;
    case 'heal': bits.push(`heals <b>${Math.round(p.maxHp * sp.frac)}</b> HP (${pct(sp.frac)} of max) to allies within ${sp.radius}u`); break;
    case 'targetaoe': {
      bits.push(`<b>${sd}</b> dmg in ${sp.radius}u, aimed up to ${sp.range}u away, lands after ${sp.delay}s`);
      if (sp.burn) bits.push(`burns: <b>${Math.max(2, Math.round(sd * sp.burn.mult))}</b>/s for ${sp.burn.dur}s`);
      break;
    }
    case 'aoe': {
      if (sd > 0) bits.push(`<b>${sd}</b> dmg in ${sp.radius}u around you`);
      else bits.push(`no damage, ${sp.radius}u around you`);
      if (sp.stun) bits.push(`stuns ${sp.stun}s`);
      if (sp.slowAll) bits.push(`chills all: ${pct(sp.slowAll.mult)} speed for ${sp.slowAll.dur}s`);
      if (sp.burn) bits.push(`burns: <b>${Math.max(2, Math.round(sd * sp.burn.mult))}</b>/s for ${sp.burn.dur}s`);
      if (sp.selfIframes) bits.push(`you are untouchable for ${sp.selfIframes}s`);
      break;
    }
    case 'buff': {
      if ((sp.dmgMult || 1) > 1) bits.push(`+${Math.round((sp.dmgMult - 1) * 100)}% damage`);
      if ((sp.speedMult || 1) > 1) bits.push(`+${Math.round((sp.speedMult - 1) * 100)}% speed`);
      if (sp.armorAdd) bits.push(`+${pct(sp.armorAdd)} damage reduction`);
      if (sp.lifesteal) bits.push(`heal ${pct(sp.lifesteal)} of damage dealt`);
      bits.push(`for ${sp.dur}s`);
      break;
    }
    case 'blink': {
      bits.push(`teleports you ${sp.dist}u forward`);
      if (sp.landAoe) bits.push(`landing: <b>${Math.round(dmg * sp.landAoe.dmgMult)}</b> dmg in ${sp.landAoe.radius}u, stun ${sp.landAoe.stun}s`);
      break;
    }
    case 'chain': bits.push(`<b>${sd}</b> dmg, jumps to ${sp.jumps} more foes, ×${sp.falloff} per jump`); break;
    case 'mark': bits.push(`marked foe (up to ${sp.range}u) takes ×${sp.vuln} damage for ${sp.dur}s`); break;
    case 'phantoms': bits.push(`${sp.count} spectral copies of you fight for ${sp.dur}s, hitting for <b>${Math.max(3, Math.round(dmg * sp.dmgMult))}</b>`); break;
    case 'lightning': bits.push(`<b>${sd}</b> dmg bolt (${sp.range}u), forks to ${sp.forks} foes within ${sp.forkRange}u for <b>${Math.round(sd * sp.forkMult)}</b>, stuns ${sp.stun}s`); break;
    case 'vortex': bits.push(`drags every foe within ${sp.radius}u to its heart for ${sp.dur}s; <b>${sd}</b> dmg at the core`); break;
    case 'ward': bits.push(`heals <b>${Math.max(2, Math.round(p.maxHp * sp.frac))}</b> HP every ${sp.tick}s for ${sp.dur}s, within ${sp.radius}u`); break;
    case 'wall': bits.push(`raises a bone wall for ${sp.dur}s, up to ${sp.range}u away`); break;
    case 'charge': bits.push(`dash ${sp.dist}u forward — <b>${sd}</b> dmg and knockback to everything in your path`); break;
    case 'banner': bits.push(`plant a banner: +${Math.round((sp.dmgAura - 1) * 100)}% damage within ${sp.radius}u for ${sp.dur}s`); break;
    case 'hook': bits.push(`yank a foe (up to ${sp.range}u) to your feet — <b>${sd}</b> dmg, stun ${sp.stun}s`); break;
    case 'lash': bits.push(`turns YOUR gravity toward the aimed surface (${sp.range}u) — you fall onto it and walk it; no mana regen + 2/s upkeep until released`); break;
    case 'trap': bits.push(`set a steel trap (max ${sp.max}): <b>${sd}</b> dmg and roots ${sp.root}s`); break;
    case 'freeze': bits.push(`freezes every foe within ${sp.radius}u of the mark for ${sp.dur}s`); break;
    case 'swap': bits.push(`teleport behind your mark (${sp.range}u); next strike deals double`); break;
    case 'decoy': bits.push(`a straw double (${sp.hp} HP) draws attacks for ${sp.dur}s`); break;
    case 'prison': bits.push(`entombs the mark in ice: ${sp.dur}s frozen and taking bonus damage`); break;
    case 'sight': bits.push(`see every enemy through the walls for ${sp.dur}s`); break;
    case 'levitate': bits.push(`float above the ground for ${sp.dur}s`); break;
    case 'trail': bits.push(`your footsteps burn for ${sp.dur}s — <b>${sd}</b> dmg to pursuers`); break;
    case 'sanctuary': bits.push(`a dome (${sp.radius}u) that blocks all enemy projectiles for ${sp.dur}s`); break;
  }
  return bits.join(' · ');
}

function openCodex() {
  const p = G.player;
  if (!p) return;
  G.mode = 'merchant';
  document.exitPointerLock?.();
  const cls = p.cls;
  const dmg = effectiveDamage();
  const atkTime = effectiveAttackTime();
  const critCh = effectiveCrit();
  const wfx = weaponHitEffects(dmg) || {}; // null when the weapon carries no effects
  const w = G.inv.weapon;
  const rangedAtk = w?.ranged || !!cls.manaAttack;
  let html = '';
  let atk = statLine('Damage per hit', `<b>${dmg}</b>`);
  atk += statLine('Crit', `${pct(critCh)} chance → <b>${Math.round(dmg * 1.8)}</b> dmg (×1.8)`);
  atk += statLine('Attack speed', `${(1 / atkTime).toFixed(2)}/s (one swing every ${atkTime.toFixed(2)}s)`);
  if (!rangedAtk) {
    atk += statLine('Reach', `${cls.attackRange}u, ${Math.round(cls.attackArc * 2 * 180 / Math.PI)}° arc — hits EVERY enemy inside it`);
  } else if (w?.ranged || cls.name === 'Ranger') {
    atk += statLine('Projectile', `arrow, speed 28u/s, costs 1 arrow (you have ${G.run.arrows || 0})`);
  } else if (cls.manaAttack) {
    const full = Math.ceil(p.maxMana * cls.manaAttack);
    atk += statLine('Projectile', `bolt, speed 20u/s`);
    atk += statLine('Mana', `a full-power bolt burns <b>${full}</b> mana; with an empty pool it fires at 25% power (<b>${Math.max(1, Math.round(dmg * 0.25))}</b> dmg)`);
  }
  if (wfx.poison) atk += statLine('Weapon burn', `<b>${wfx.poison.dps}</b>/s for ${wfx.poison.dur}s on every hit`);
  if (wfx.slow) atk += statLine('Weapon chill', `foes move at ${pct(wfx.slow.mult)} for ${wfx.slow.dur}s`);
  if (wfx.lifesteal) atk += statLine('Lifesteal', `heals ${pct(wfx.lifesteal)} of damage dealt`);
  html += `<div class="codex-entry"><h3>${cls.icon} Basic attack — ${w ? w.name : cls.name + "'s starting arms"}</h3><div class="codex-stats">${atk}</div></div>`;

  const spells = (G.run.spells && G.run.spells.length ? G.run.spells : cls.spellPool);
  for (const id of spells) {
    const sp = SPELLS[id];
    if (!sp) continue;
    html += `<div class="codex-entry"><h3>${sp.icon} ${sp.name}</h3><div class="codex-stats">`
      + statLine('Cost', `${sp.mana} mana · ${sp.cd}s cooldown`)
      + statLine('Effect', spellDetail(sp, dmg, p))
      + '</div></div>';
  }
  $('codexTitle').textContent = '⚔ Drillmaster Otho';
  $('codexSub').textContent = '“No rumors here. These are your numbers, exactly as they land.”';
  $('codexBody').innerHTML = html;
  show('codexDialog');
}

const MONSTER_NAMES = {
  minion: 'Skeleton Minion', rogue: 'Skeleton Rogue', warrior: 'Skeleton Warrior', mage: 'Skeleton Mage',
  bomber: 'Bomber', frostmage: 'Frost Mage', ghost: 'Ghost', shade: 'Shade', necromancer: 'Necromancer',
  berserker: 'Berserker', juggernaut: 'Juggernaut', plaguebearer: 'Plaguebearer', sniper: 'Sniper',
  brute: 'Brute', goblin: 'Goblin', orcwar: 'Orc Warrior', ogre: 'Ogre', imp: 'Imp',
  slime: 'Slime', slimelet: 'Slimelet', glub: 'Glub', drake: 'Drake',
};

function monsterTraits(e) {
  const t = [];
  if (e.explode) t.push(`charges you and EXPLODES: <b>${e.dmg}</b> dmg within ${e.explode}u — that blast is its only attack`);
  else if (e.ranged) t.push(`shoots from up to ${e.range}u, one bolt every ${e.attackTime}s for <b>${e.dmg}</b>`);
  else t.push(`melee, ${e.range}u reach, one hit every ${e.attackTime}s for <b>${e.dmg}</b>`);
  if (e.slowBolt) t.push('its bolts chill you to 50% speed for 2.5s');
  if (e.ghost) t.push('spectral — drifts through walls and always sees you');
  if (e.summons) t.push(`raises a ${MONSTER_NAMES[e.summonType] || e.summonType} every ${e.summonEvery}s`);
  if (e.enrage) t.push('fights faster as it bleeds — up to +90% speed near death');
  if (e.stalwart) t.push('too massive to stun or knock back');
  if (e.plague) t.push(`hits infect you: ${e.plague.dps}/s poison for ${e.plague.dur}s (stronger on deep floors)`);
  if (e.deathCloud) t.push(`bursts into a ${e.deathCloud}u poison cloud when slain — stand back`);
  if (e.kbHit) t.push('its blows hurl you backwards');
  if (e.splitInto) t.push(`splits into two ${MONSTER_NAMES[e.splitInto] || e.splitInto}s when slain`);
  if (e.trio) t.push('hunts in packs of three');
  if (e.fly) t.push('airborne');
  return t;
}

function openBestiary() {
  if (!G.player) return;
  G.mode = 'merchant';
  document.exitPointerLock?.();
  let html = `<div class="codex-note">Base numbers shown. Every floor deeper multiplies HP by +22% and damage by +13% of base
    (floor 3: HP ×${(1 + 0.22 * 2).toFixed(2)}, dmg ×${(1 + 0.13 * 2).toFixed(2)}).
    Gold-glowing ELITES: ×2.4 HP, ×1.5 damage, ×2 gold. Bosses? “Some things you meet unspoiled.”</div>`;
  for (const [id, e] of Object.entries(ENEMIES)) {
    if (e.boss) continue;
    html += `<div class="codex-entry"><h3>${MONSTER_NAMES[id] || id}</h3><div class="codex-stats">`
      + statLine('Stats', `<b>${e.hp}</b> HP · speed ${e.speed} · notices you at ${e.aggro}u · ${e.xp} XP · ${e.gold[0]}–${e.gold[1]}g`)
      + statLine('Behavior', monsterTraits(e).join(' · '))
      + '</div></div>';
  }
  $('codexTitle').textContent = '🏹 Maren the Hunter';
  $('codexSub').textContent = '“Know a beast and it is already half dead.”';
  $('codexBody').innerHTML = html;
  show('codexDialog');
}

// ---- the wayfarer post: change ventures, keep your character ----
function openModeDialog() {
  if (G.net.role === 'guest') { addMsg('Only the host can change the venture.', 'bad'); return; }
  G.mode = 'merchant';
  document.exitPointerLock?.();
  show('modeDialog');
}

function switchMode(mode) {
  hide('modeDialog');
  if (mode === G.runMode) { G.mode = 'playing'; lockPointer(); return; }
  if (G.net.role === 'host') netSend({ t: 'modeswitch', mode });
  applyModeSwitch(mode);
  lockPointer();
}

// rebuild the world for the new mode, but the character travels:
// gold, gear, bag, potions, keys, levels, spells, campaign progress
function applyModeSwitch(mode) {
  const keep = { ...G.run };
  const inv = { weapon: G.inv.weapon, offhand: G.inv.offhand, trinket: G.inv.trinket, bag: [...G.inv.bag] };
  startRun(G.seed, mode);
  Object.assign(G.run, {
    gold: keep.gold, potions: keep.potions, keys: keep.keys,
    arrows: mode === 'campaign' ? keep.arrows : Math.max(keep.arrows || 0, 40),
    level: keep.level, xp: keep.xp, kills: keep.kills, chests: keep.chests,
    atkBonus: keep.atkBonus, hpBonus: keep.hpBonus, speedBonus: keep.speedBonus,
    speedBuys: keep.speedBuys, buys: keep.buys, deepest: keep.deepest,
    spells: keep.spells,
  });
  G.inv.weapon = inv.weapon; G.inv.offhand = inv.offhand; G.inv.trinket = inv.trinket; G.inv.bag = inv.bag;
  refreshEquipVisuals();
  G.player.maxHp = effectiveMaxHp();
  G.player.hp = G.player.maxHp;
  updateSpellBar(cooldowns);
  refreshHud();
  addMsg('⚔ Venture changed — your gold, gear and levels travelled with you.', 'gold');
}

function onShopOpened(type) {
  if (type === 'board') { document.exitPointerLock?.(); window.openTavernBoard(); return; }
  if (type === 'mode') { openModeDialog(); return; }
  if (type === 'codex') { openCodex(); return; }
  if (type === 'bestiary') { openBestiary(); return; }
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
    const pool = G.player.cls.spellPool.filter(s => !G.run.spells.includes(s));
    if (!pool.length) { addMsg('You already know every spell of your school.', 'bad'); return; }
    // choose which spell the tome unbinds
    hide('merchant');
    (G.run.spells || []).forEach((sid, i) => {
      const b = $(`btnTome${i}`);
      if (!b) return;
      const sp = SPELLS[sid];
      b.textContent = `${sp.icon} ${sp.name} — unbind this`;
      b.onclick = () => {
        hide('tomeDialog');
        const r = rerollSpell(i);
        G.run.gold -= price;
        G.run.buys[id] = (G.run.buys[id] || 0) + 1;
        addMsg(`The tome unbinds <b>${r.old}</b> and teaches you ${r.icon} <b>${r.now}</b>!`, 'gold');
        sfx.levelup();
        refreshHud();
        G.mode = 'playing';
        lockPointer();
      };
    });
    $('btnTomeCancel').onclick = () => { hide('tomeDialog'); G.mode = 'playing'; lockPointer(); };
    show('tomeDialog');
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
      if (machineState.on) { placeCurrentMachine(); return; } // machine mode: click places
      if (buildState.on) { placeCurrentBuild(); return; }     // build mode: click places
      tryAttack();
    }
  });
  // trackpads fire dozens of tiny wheel events per swipe — accumulate and
  // only step the selector once per real notch of scrolling
  let wheelAccum = 0, wheelLastT = 0;
  addEventListener('wheel', (e) => {
    if (G.mode !== 'playing' || (!machineState.on && !buildState.on)) { wheelAccum = 0; return; }
    const now = performance.now();
    if (now - wheelLastT > 250) wheelAccum = 0; // a new gesture starts clean
    wheelLastT = now;
    wheelAccum += e.deltaY;
    while (Math.abs(wheelAccum) >= 90) {
      const dir = wheelAccum > 0 ? 1 : -1;
      if (machineState.on) cycleMachine(dir);
      else cycleBuildPiece(dir);
      wheelAccum -= dir * 90;
    }
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
    if (e.code === 'KeyB' && (horde.active || G.runMode === 'duel')) { toggleMachineMode(false); toggleBuildMode(); }
    if (e.code === 'KeyV' && (horde.active || G.runMode === 'duel')) { toggleBuildMode(false); toggleMachineMode(); }
    if (e.code === 'KeyH' && horde.active) openHireDialog();
    if (e.code === 'KeyM') {
      // commander view between waves & in duels; music toggle everywhere else
      if (commander.open) { closeCommandMap(); G.mode = 'playing'; lockPointer(); }
      else if ((horde.active && horde.phase === 'build') || G.runMode === 'duel') openCommandMap();
      else addMsg(toggleMusic() ? '🎵 Music on' : '🔇 Music off');
    }
    if (e.code === 'KeyN') { const m = toggleMute(); addMsg(m ? 'Muted 🔇' : 'Sound on 🔊'); }
    if (e.code === 'KeyP' && (horde.active || G.runMode === 'duel')) buyItem('arrows', 20);
    if (e.code === 'Digit1') castSpell(0, effectiveDamage);
    if (e.code === 'Digit2') castSpell(1, effectiveDamage);
    if (e.code === 'Digit3') castSpell(2, effectiveDamage);
    if (e.code === 'Digit4' || e.code === 'KeyR') castSignature(effectiveDamage);
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
  let dt = Math.min(0.05, (t - last) / 1000 || 0.016);
  last = t;
  // cinematic slow-motion beats (solo only — netplay stays realtime)
  if (G.slowmo > 0 && G.net.role === 'solo') {
    G.slowmo -= dt;
    dt *= 0.35;
  }
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
    updateProjectiles(dt, { damageEnemy, damageLocalPlayer, onBasicHit: () => addSigCharge(1) });
    updateSpells(dt);
    updateBeams(dt);
    updateFx(dt);
    updateWalls(dt);
    updateTraps(dt);
    updateRopes(dt);
    updateTownNpcs(dt);
    updateMinions(dt);
    updateMachines(dt);
    updateHorde(dt);
    updateBuildGhost();
    updateMachineGhost();
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
    updateMusic(dt);

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

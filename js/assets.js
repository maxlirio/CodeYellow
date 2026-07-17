import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { makeGlowSprite } from './fx.js';
import { WEAPON_MESHES, CAPE_COLORS } from './config.js';

const CHAR_MODELS = ['Knight', 'Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian'];
const ENEMY_MODELS = ['Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage'];
// Quaternius Ultimate Monsters (CC0) — same low-poly big-head style as KayKit
// only the shapes the machine roster still wears (Slime = the Nanite Mass blob);
// the fantasy menagerie (orcs, mushrooms, dragons-as-models) is gone
const MONSTER_MODELS = ['Slime'];
// ---- sci-fi packs (branch: scifi) — Quaternius + Kenney, all CC0 ----
const SCIFI_CHARS = ['Astronaut_BarbaraTheBee', 'Astronaut_FernandoTheFlamingo', 'Astronaut_FinnTheFrog', 'Astronaut_RaeTheRedPanda'];
const SCIFI_TOON = ['Character_Soldier', 'Character_Hazmat', 'Character_Enemy']; // self-contained .gltf
const SCIFI_BOTS = ['RobotExpressive', 'George', 'Leela', 'Mike', 'Stan', 'Enemy_Small', 'Enemy_ExtraSmall', 'Enemy_Flying', 'Enemy_Large',
  'Cyber_Enemy_2Legs_Gun', 'Cyber_Enemy_Flying_Gun', 'Cyber_Enemy_Large', 'Cyber_Character'];
const SCIFI_GUNS = ['blaster-a', 'blaster-b', 'blaster-c', 'blaster-d', 'blaster-e', 'blaster-f', 'blaster-g', 'blaster-h', 'blaster-i', 'blaster-j', 'blaster-k', 'blaster-n', 'blaster-p', 'blaster-r'];
const SCIFI_PROPS = ['machine_generator', 'machine_generatorLarge', 'machine_wirelessCable', 'machine_barrelLarge', 'desk_computer', 'desk_computerScreen', 'barrel', 'barrels', 'craft_speederA', 'craft_cargoA', 'satelliteDish'];

const WEAPON2_MODELS = [
  'Sword', 'Sword_big', 'Sword_Golden', 'Sword_big_Golden', 'Sword_2', 'Claymore',
  'Axe', 'Axe_Double', 'Axe_small', 'Axe_Double_Golden', 'Hammer_Double', 'Hammer_Double_Golden', 'Hammer_Small',
  'Dagger', 'Dagger_Golden', 'Dagger_2', 'Scythe', 'Spear',
  'Bow_Wooden', 'Bow_Golden', 'Bow_Evil',
  'Crystal1', 'Crystal3', 'Crystal5', 'Skull',
  'Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Staff', 'Skeleton_Crossbow',
];
const WEAPON_MODELS = ['sword_1handed', 'sword_2handed', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand', 'shield_round', 'shield_badge', 'shield_spikes', 'crossbow_1handed', 'crossbow_2handed', 'arrow'];
// village assets (KayKit Medieval Hexagon / Halloween / Furniture packs, CC0)
const TOWN_PIECES = {
  town_home_red: 'building_home_A_red', town_home_blue: 'building_home_A_blue',
  town_home_green: 'building_home_B_green', town_home_yellow: 'building_home_B_yellow',
  town_home_green2: 'building_home_A_green',
  town_blacksmith: 'building_blacksmith_red', town_tavern: 'building_tavern_yellow',
  town_church: 'building_church_blue', town_well: 'building_well_red',
  town_windmill: 'building_windmill_blue', town_market: 'building_market_green',
  town_grain: 'building_grain',
  town_tree: 'tree_single_A', town_trees: 'trees_B_medium',
  town_fence: 'fence_wood_straight', town_fence_gate: 'fence_wood_straight_gate',
  town_lantern: 'lantern_standing',
  town_rug: 'rug_rectangle_A', town_cabinet: 'cabinet_medium_decorated', town_stool: 'chair_stool_wood',
};
const DUNGEON_PIECES = [
  'wall', 'wall_corner', 'wall_doorway', 'wall_endcap', 'wall_Tsplit', 'wall_crossing', 'wall_broken', 'wall_cracked', 'wall_gated',
  'floor_tile_large', 'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B',
  'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_small_decorated', 'floor_tile_large_rocks',
  'floor_dirt_large', 'floor_dirt_large_rocky', 'floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C', 'floor_dirt_small_D',
  'floor_wood_large', 'floor_wood_small', 'floor_wood_large_dark', 'floor_wood_small_dark',
  'pillar', 'pillar_decorated', 'torch_mounted', 'torch_lit', 'stairs',
  'barrier', 'barrier_half', 'barrier_corner', 'barrier_column',
  'chest', 'chest_gold', 'key', 'coin', 'coin_stack_small', 'coin_stack_medium', 'coin_stack_large',
  'barrel_large', 'barrel_small', 'box_small', 'box_large', 'crates_stacked', 'table_medium', 'chair',
  'banner_patternA_red', 'banner_patternA_blue', 'bottle_A_green', 'bottle_A_brown', 'bottle_B_brown',
  'candle_lit', 'candle_triple', 'floor_tile_big_spikes', 'floor_tile_grate', 'shelf_small', 'keyring',
];

export async function loadAll(onProgress) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress?.(loaded / total, url);
  const loader = new GLTFLoader(manager);
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco); // the Ultimate Space Kit rigs are Draco-compressed
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  const jobs = [];
  const assets = { char: {}, enemy: {}, piece: {}, weapon: {}, lair: {} };
  for (const m of CHAR_MODELS) jobs.push(load(`assets/characters/${m}.glb`).then(g => assets.char[m] = g));
  for (const m of ENEMY_MODELS) jobs.push(load(`assets/enemies/${m}.glb`).then(g => assets.enemy[m] = g));
  for (const m of MONSTER_MODELS) jobs.push(load(`assets/monsters/${m}.glb`).then(g => assets.enemy[m] = g));
  for (const p of DUNGEON_PIECES) jobs.push(load(`assets/dungeon/${p}.glb`).then(g => assets.piece[p] = g));
  for (const [key, file] of Object.entries(TOWN_PIECES)) jobs.push(load(`assets/town/${file}.gltf`).then(g => assets.piece[key] = g));
  for (const w of WEAPON_MODELS) jobs.push(load(`assets/weapons/${w}.gltf`).then(g => assets.weapon[w] = g));
  for (const r of ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_5', 'Rock_6', 'Rock_7']) {
    jobs.push(load(`assets/lair/${r}.glb`).then(g => assets.lair[r] = g));
  }
  for (const m of SCIFI_CHARS) jobs.push(load(`assets/scifi/chars/${m}.glb`).then(g => { assets.char[m] = g; assets.enemy[m] = g; }));
  for (const m of SCIFI_TOON) jobs.push(load(`assets/scifi/chars/${m}.gltf`).then(g => { assets.char[m] = g; assets.enemy[m] = g; }));
  for (const m of SCIFI_BOTS) jobs.push(load(`assets/scifi/chars/${m}.glb`).then(g => { assets.enemy[m] = g; assets.char[m] = g; }));
  for (const w of SCIFI_GUNS) jobs.push(load(`assets/scifi/guns/${w}.glb`).then(g => assets.weapon[w] = g));
  for (const p2 of SCIFI_PROPS) jobs.push(load(`assets/scifi/props/${p2}.glb`).then(g => assets.piece[p2] = g));
  for (const w of WEAPON2_MODELS) {
    const ext = w.startsWith('Skeleton_') ? 'gltf' : 'glb';
    jobs.push(load(`assets/weapons2/${w}.${ext}`).then(g => assets.weapon[w] = g));
  }
  await Promise.all(jobs);

  // the necromancer and his Risen wear enemy skeleton rigs — alias them into
  // the char registry so makeCharacter('char', 'Skeleton_*') just works
  for (const m of ENEMY_MODELS) if (m.startsWith('Skeleton_')) assets.char[m] = assets.enemy[m];

  // Pre-bake static piece geometry (world-transform applied, attributes normalized)
  // so dungeon.js can merge thousands of placements into a handful of draw calls.
  for (const name of [...DUNGEON_PIECES, ...Object.keys(TOWN_PIECES), ...SCIFI_PROPS]) {
    const gltf = assets.piece[name];
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse((n) => {
      if (!n.isMesh) return;
      const geo = n.geometry.clone().applyMatrix4(n.matrixWorld);
      for (const key of Object.keys(geo.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
      }
      n.material.side = THREE.DoubleSide; // floors/roofs must be opaque from below
      parts.push({ geo, mat: n.material });
    });
    gltf.baked = parts;
    // measured collision shapes: one local-space AABB per mesh part, so
    // colliders can match what the model actually looks like (walls vs roof
    // vs chimney), not a hand-tuned circle.
    gltf.bounds = parts.map(({ geo }) => {
      geo.computeBoundingBox();
      return geo.boundingBox.clone();
    });
  }
  G.assets = assets;
  return assets;
}

// World-space collider boxes for a placed piece, measured from the real model:
// one {x, z, hx, hz, y0, h} box per solid mesh part (y0 = base, h = top — tops
// are standable, see dungeon.js). Flat decals and wafer-thin trim are skipped.
// Arbitrary yaw expands each part to its rotated AABB.
export function pieceColliders(name, { x = 0, z = 0, y = 0, yaw = 0, scale = 1 } = {}) {
  const gltf = G.assets?.piece?.[name];
  const sx = Array.isArray(scale) ? scale[0] : scale;
  const sy = Array.isArray(scale) ? scale[1] : scale;
  const sz = Array.isArray(scale) ? scale[2] : scale;
  if (!gltf?.bounds) return [{ x, z, r: 0.8 * Math.max(sx, sz), y0: y, h: y + 2.5 * sy }];
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const out = [];
  for (const b of gltf.bounds) {
    const cx = ((b.min.x + b.max.x) / 2) * sx, cz = ((b.min.z + b.max.z) / 2) * sz;
    const hx0 = ((b.max.x - b.min.x) / 2) * sx, hz0 = ((b.max.z - b.min.z) / 2) * sz;
    const hx = Math.abs(hx0 * cos) + Math.abs(hz0 * sin);
    const hz = Math.abs(hx0 * sin) + Math.abs(hz0 * cos);
    const y0 = y + b.min.y * sy, h = y + b.max.y * sy;
    if (hx < 0.16 || hz < 0.16) continue; // wafer-thin trim
    if (h - y0 < 0.3) continue;           // flat decals / rugs
    out.push({ x: x + cx * cos + cz * sin, z: z - cx * sin + cz * cos, hx, hz, y0, h });
  }
  // largest parts first, capped — walls & roofs matter, door trim is noise
  out.sort((a, b) => (b.hx * b.hz * (b.h - b.y0)) - (a.hx * a.hz * (a.h - a.y0)));
  return out.slice(0, 8);
}

// ---- clip aliases: sci-fi rigs answer to the KayKit names the game speaks ----
// player.js/minions.js/net replay a small closed set of KayKit clip names
// (Idle, Running_A, Jump_Idle, Death_A, the attackAnims). Rather than teach
// every call site every pack's vocabulary, the Animator translates.
const MELEE_ANIMS = ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop',
  '2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice',
  'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab'];
const alias = (idle, run, jump, death, melee, shoot) => {
  const t = { Idle: idle, Running_A: run, Jump_Idle: jump, Death_A: death,
    '2H_Ranged_Shoot': shoot, Spellcast_Shoot: shoot };
  for (const m of MELEE_ANIMS) t[m] = melee;
  return t;
};
const QAC = 'CharacterArmature|'; // the Cyberpunk kit prefixes every clip
const CLIP_ALIASES = {
  usk: alias('Idle_Gun', 'Run_Gun', 'Jump_Idle', 'Death', 'Punch', 'Weapon'),
  toon: alias('Idle', 'Run_Gun', 'Jump_Idle', 'Death', 'Punch', 'Idle_Shoot'),
  robot: alias('Idle', 'Running', 'Jump', 'Death', 'Punch', 'Punch'),
  mech: alias('Idle', 'Run', 'Jump', 'Death', 'SwordSlash', 'Shoot'),
  cyberhero: alias(QAC + 'Idle_Sword', QAC + 'Run', QAC + 'Idle_Sword', QAC + 'Death', QAC + 'Sword_Slash', QAC + 'Gun_Shoot'),
};
function packOf(model) {
  if (model.startsWith('Astronaut_')) return 'usk';
  if (model.startsWith('Character_')) return 'toon';
  if (model === 'RobotExpressive') return 'robot';
  if (['George', 'Leela', 'Mike', 'Stan'].includes(model)) return 'mech';
  if (model === 'Cyber_Character') return 'cyberhero';
  return null;
}

// class paint job: painted panels for robots (Main material only), a light
// multiplier tint for textured rigs — same rules the enemy roster follows
export function applyClassFinish(obj, cls) {
  if (cls.paint) tintCharacter(obj, cls.paint, { only: /^Main$/ });
  else if (cls.tint) tintCharacter(obj, cls.tint);
}

// ---- character instancing ----
export function makeCharacter(kind, modelName, showMeshes = []) {
  const src = kind === 'enemy' ? G.assets.enemy[modelName] : G.assets.char[modelName];
  const obj = SkeletonUtils.clone(src.scene);
  obj.traverse((n) => {
    if (n.isMesh || n.isSkinnedMesh) n.frustumCulled = false; // skinned bounds are unreliable once animated
    // arsenal gating by NAME, whatever the node type: some rigs bake weapons
    // as meshes, others (Character_Enemy) as GROUPS of anonymous cubes
    if (WEAPON_MESHES.includes(n.name)) n.visible = showMeshes.includes(n.name);
  });
  const pack = packOf(modelName);
  const anim = new Animator(obj, src.animations, pack ? CLIP_ALIASES[pack] : null);
  return { obj, anim };
}

// show exactly this set of weapon/offhand meshes on a character rig
export function setEquipMeshes(obj, meshes) {
  obj.traverse((n) => {
    if (WEAPON_MESHES.includes(n.name)) n.visible = meshes.includes(n.name);
  });
}

// tint every mesh of a rig (elite/ghost/monster variants)
export function tintCharacter(obj, color, { ghost = false, emissive = 0, only = null } = {}) {
  obj.traverse((n) => {
    if (!n.isMesh && !n.isSkinnedMesh) return;
    if (n.material.isMeshBasicMaterial) return; // blob shadows / glows — no emissive uniform
    // `only`: paint just the matching material (e.g. RobotExpressive's 'Main'
    // body panels) and leave the trim alone — replacing EVERY material's color
    // flattened whole rigs to one clay hue
    if (only && !(n.material.name || '').match(only)) return;
    n.material = n.material.clone();
    if (color) n.material.color = new THREE.Color(color);
    if (emissive) { n.material.emissive = new THREE.Color(emissive); n.material.emissiveIntensity = 0.55; }
    if (ghost) {
      n.material.transparent = true;
      n.material.opacity = 0.45;
      n.material.depthWrite = false;
    }
  });
}

// appearance customization: capes / helmets / hats + cape color
export function applyLook(obj, look) {
  obj.traverse((n) => {
    if (!n.isMesh && !n.isSkinnedMesh) return;
    if (/Cape|Hood$/.test(n.name)) {
      n.visible = !!look.cape;
      if (look.cape) {
        n.material = n.material.clone();
        n.material.color = new THREE.Color(CAPE_COLORS[look.capeColor % CAPE_COLORS.length].hex);
      }
    }
    if (/Helmet|Hat/.test(n.name)) n.visible = !!look.helmet;
  });
}

export class Animator {
  constructor(root, clips, aliases = null) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.aliases = aliases;
    for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c);
    this.current = null;
    this.currentName = '';
  }
  resolve(name) {
    if (this.actions[name]) return name; // a literal clip always wins
    return this.aliases?.[name] ?? name;
  }
  has(name) { return !!this.actions[this.resolve(name)]; }
  play(name, { fade = 0.16, timeScale = 1, once = false, clamp = false } = {}) {
    name = this.resolve(name);
    const next = this.actions[name];
    if (!next) return null;
    if (this.current === next && !once) { next.timeScale = timeScale; return next; }
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = clamp;
    next.timeScale = timeScale;
    next.enabled = true;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
    this.currentName = name;
    return next;
  }
  onFinished(cb) {
    const h = (e) => cb(e.action);
    this.mixer.addEventListener('finished', h);
    return () => this.mixer.removeEventListener('finished', h);
  }
  update(dt) { this.mixer.update(dt); }
}

// ---- static geometry merging ----
// placements: [{ piece, matrix }]. Returns a Group with one merged mesh per material.
export function buildMergedStatic(placements) {
  const byMat = new Map();
  for (const { piece, matrix } of placements) {
    const gltf = G.assets.piece[piece];
    if (!gltf) continue;
    for (const { geo, mat } of gltf.baked) {
      const key = mat.uuid;
      if (!byMat.has(key)) byMat.set(key, { mat, geos: [] });
      byMat.get(key).geos.push(geo.clone().applyMatrix4(matrix));
    }
  }
  const group = new THREE.Group();
  for (const { mat, geos } of byMat.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    for (const g of geos) g.dispose();
  }
  return group;
}

// A single (non-merged) instance of a piece, for interactive props.
export function makePiece(name) {
  const gltf = G.assets.piece[name];
  return gltf.scene.clone(true);
}

// A weapon/shield model instance (for ground drops & previews).
// pack models come in wildly different scales — normalize to a hand-sized length
const WEAPON_LEN = {
  Sword: 1.1, Sword_big: 1.35, Sword_Golden: 1.1, Sword_big_Golden: 1.35, Sword_2: 1.3, Claymore: 1.55,
  Axe: 1.3, Axe_Double: 1.25, Axe_small: 0.85, Axe_Double_Golden: 1.25,
  Hammer_Double: 1.25, Hammer_Double_Golden: 1.25, Hammer_Small: 1.35,
  Dagger: 0.62, Dagger_Golden: 0.62, Dagger_2: 0.7, Scythe: 1.7, Spear: 2.0,
  Bow_Wooden: 1.15, Bow_Golden: 1.15, Bow_Evil: 1.3,
  Skeleton_Blade: 0.95, Skeleton_Axe: 1.0, Skeleton_Staff: 1.45, Skeleton_Crossbow: 0.8,
  Crystal1: 0.3, Crystal3: 0.3, Crystal5: 0.3, Skull: 0.32,
};


// ---- procedural energy weapons (branch: scifi) ----
// No pack has melee that fits a boarding action, so we build it: a dark hilt,
// a humming emissive blade, a hot core line. All point +Y with the grip at the
// origin, matching the KayKit convention every held/viewmodel path expects.
const ENERGY_WEAPONS = {
  arcblade:   { blade: 1.15, w: 0.085, color: 0x55ccff, hilt: 0.24 },
  plasrend:   { blade: 1.6,  w: 0.13,  color: 0xff7733, hilt: 0.34 },
  vibro:      { blade: 0.6,  w: 0.05,  color: 0xbfefff, hilt: 0.16 },
  monoedge:   { blade: 0.95, w: 0.06,  color: 0xd6ffe8, hilt: 0.2 },
  phasepike:  { blade: 1.4,  w: 0.055, color: 0x9fd4ff, hilt: 0.75 },
};
function buildEnergyBlade(kind) {
  const cfg = ENERGY_WEAPONS[kind];
  const g = new THREE.Group();
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, cfg.hilt, 6),
    new THREE.MeshStandardMaterial({ color: 0x272b31, metalness: 0.6, roughness: 0.5 })
  );
  grip.position.y = cfg.hilt / 2;
  g.add(grip);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.05, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.45 })
  );
  guard.position.y = cfg.hilt;
  g.add(guard);
  // blade: a translucent energy sheath around a white-hot core line
  const sheath = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.w, cfg.blade, cfg.w * 2.4),
    new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: new THREE.Color(cfg.color), emissiveIntensity: 1.7,
      transparent: true, opacity: 0.85, toneMapped: false,
    })
  );
  sheath.position.y = cfg.hilt + cfg.blade / 2;
  g.add(sheath);
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.w * 0.35, cfg.blade * 0.96, cfg.w * 0.9),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  );
  core.position.copy(sheath.position);
  g.add(core);
  return g;
}
function buildBreachMaul() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.5 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.05, 6), steel);
  shaft.position.y = 0.52;
  g.add(shaft);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.26), steel);
  head.position.y = 1.1;
  g.add(head);
  // the charge core glows between the striking faces
  const coreRing = new THREE.Mesh(
    new THREE.BoxGeometry(0.57, 0.09, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x66aaff, emissiveIntensity: 1.8, toneMapped: false })
  );
  coreRing.position.y = 1.1;
  g.add(coreRing);
  return g;
}
function buildMonoScythe() {
  const g = new THREE.Group();
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 1.35, 6),
    new THREE.MeshStandardMaterial({ color: 0x272b31, metalness: 0.6, roughness: 0.5 })
  );
  rod.position.y = 0.675;
  g.add(rod);
  // a hooked emissive cutting arc at the top
  const arc = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.045, 6, 10, Math.PI * 0.9),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x9dff70, emissiveIntensity: 1.7, toneMapped: false })
  );
  arc.position.set(0.3, 1.32, 0);
  arc.rotation.z = -1.1;
  g.add(arc);
  return g;
}

// Kenney blasters ship untextured white — dress them as ship-tech: gunmetal
// body + an emissive power cell so they read in dark holds.
function dressBlaster(obj, name) {
  obj.traverse((n) => {
    if (!n.isMesh) return;
    n.material = new THREE.MeshStandardMaterial({ color: 0x4a525c, metalness: 0.55, roughness: 0.5 });
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const ctr = box.getCenter(new THREE.Vector3());
  const cell = new THREE.Mesh(
    new THREE.BoxGeometry(size.x + 0.015, 0.05, Math.min(0.22, size.z * 0.3)),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x7ddcff, emissiveIntensity: 1.8, toneMapped: false })
  );
  cell.position.set(ctr.x, ctr.y + size.y * 0.18, ctr.z);
  obj.add(cell);
  return obj;
}

export function makeWeaponModel(name) {
  if (name === 'bow') return buildBowModel();
  if (ENERGY_WEAPONS[name]) return buildEnergyBlade(name);
  if (name === 'riotplate') {
    // a curved riot plate with an energy edge
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.9, 10, 1, true, 0, Math.PI * 1.15),
      new THREE.MeshStandardMaterial({ color: 0x5b6470, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
    plate.position.y = 0.45;
    g.add(plate);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.03, 6, 14, Math.PI * 1.15),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x59c7ff, emissiveIntensity: 1.6, toneMapped: false }));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.9;
    g.add(edge);
    return g;
  }
  if (name === 'implant') {
    // a data implant: chip + glowing traces
    const g = new THREE.Group();
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.55, roughness: 0.45 }));
    chip.position.y = 0.2;
    g.add(chip);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xbb66ff, emissiveIntensity: 1.8, toneMapped: false }));
    core.position.y = 0.22;
    g.add(core);
    return g;
  }
  if (name === 'breachmaul') return buildBreachMaul();
  if (name === 'monoscythe') return buildMonoScythe();
  if (name === 'skullstaff' || name === 'crystalscepter') return buildComposedStaff(name);
  const gltf = G.assets.weapon[name];
  if (!gltf) return makePiece('key');
  const obj = gltf.scene.clone(true);
  if (name.startsWith('blaster-')) return dressBlaster(obj, name);
  const target = WEAPON_LEN[name];
  if (target) {
    const box = new THREE.Box3().setFromObject(obj);
    const s = new THREE.Vector3(); box.getSize(s);
    const m = target / Math.max(s.x, s.y, s.z, 0.001);
    const wrap = new THREE.Group();
    obj.scale.setScalar(m);
    // ground the grip at the wrap origin (models often center oddly)
    const box2 = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box2.min.y;
    wrap.add(obj);
    return wrap;
  }
  return obj;
}

// mage exotics assembled from parts: a dark rod crowned with a skull / crystal
function buildComposedStaff(kind) {
  const g = new THREE.Group();
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 1.35, 6),
    new THREE.MeshStandardMaterial({ color: kind === 'skullstaff' ? 0x3a2c22 : 0x5a4632, roughness: 0.85 })
  );
  rod.position.y = 0.675;
  g.add(rod);
  const topper = makeWeaponModel(kind === 'skullstaff' ? 'Skull' : 'Crystal1');
  topper.position.y = 1.32;
  g.add(topper);
  const glowCol = kind === 'skullstaff' ? 0x88ff66 : 0x66ccff;
  const glow = makeGlowSprite(glowCol, 0.55);
  glow.position.y = 1.5;
  g.add(glow);
  if (kind === 'crystalscepter') {
    const c = topper.children[0];
    c?.traverse?.((n) => { if (n.isMesh) { n.material = n.material.clone(); n.material.emissive = new THREE.Color(0x3388cc); n.material.emissiveIntensity = 0.8; } });
  }
  return g;
}

// Procedural recurve bow — no pack has one, so we build it: curved wooden limb,
// leather grip, and a REAL string whose nock point animates when you draw.
export function buildBowModel() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.85 });
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0.55, 0.08),
    new THREE.Vector3(0, 0, -0.18),
    new THREE.Vector3(0, -0.55, 0.08)
  );
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.026, 6), wood));
  // limb tips
  for (const ty of [0.55, -0.55]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), wood);
    tip.position.set(0, ty, 0.08);
    g.add(tip);
  }
  // the string: three vertices — top tip, NOCK (animated), bottom tip
  const stringGeo = new THREE.BufferGeometry();
  stringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0.55, 0.08, 0, 0, 0.08, 0, -0.55, 0.08,
  ]), 3));
  const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xe8e2d0 }));
  string.frustumCulled = false;
  g.add(string);
  g.userData.stringGeo = stringGeo;
  g.userData.nockRest = 0.08;
  return g;
}

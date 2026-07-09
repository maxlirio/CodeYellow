import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { WEAPON_MESHES, CAPE_COLORS } from './config.js';

const CHAR_MODELS = ['Knight', 'Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian'];
const ENEMY_MODELS = ['Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage'];
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
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  const jobs = [];
  const assets = { char: {}, enemy: {}, piece: {}, weapon: {} };
  for (const m of CHAR_MODELS) jobs.push(load(`assets/characters/${m}.glb`).then(g => assets.char[m] = g));
  for (const m of ENEMY_MODELS) jobs.push(load(`assets/enemies/${m}.glb`).then(g => assets.enemy[m] = g));
  for (const p of DUNGEON_PIECES) jobs.push(load(`assets/dungeon/${p}.glb`).then(g => assets.piece[p] = g));
  for (const [key, file] of Object.entries(TOWN_PIECES)) jobs.push(load(`assets/town/${file}.gltf`).then(g => assets.piece[key] = g));
  for (const w of WEAPON_MODELS) jobs.push(load(`assets/weapons/${w}.gltf`).then(g => assets.weapon[w] = g));
  await Promise.all(jobs);

  // Pre-bake static piece geometry (world-transform applied, attributes normalized)
  // so dungeon.js can merge thousands of placements into a handful of draw calls.
  for (const name of [...DUNGEON_PIECES, ...Object.keys(TOWN_PIECES)]) {
    const gltf = assets.piece[name];
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse((n) => {
      if (!n.isMesh) return;
      const geo = n.geometry.clone().applyMatrix4(n.matrixWorld);
      for (const key of Object.keys(geo.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') geo.deleteAttribute(key);
      }
      parts.push({ geo, mat: n.material });
    });
    gltf.baked = parts;
  }
  G.assets = assets;
  return assets;
}

// ---- character instancing ----
export function makeCharacter(kind, modelName, showMeshes = []) {
  const src = kind === 'enemy' ? G.assets.enemy[modelName] : G.assets.char[modelName];
  const obj = SkeletonUtils.clone(src.scene);
  obj.traverse((n) => {
    if (n.isMesh || n.isSkinnedMesh) {
      n.frustumCulled = false; // skinned bounds are unreliable once animated
      if (WEAPON_MESHES.includes(n.name)) n.visible = showMeshes.includes(n.name);
    }
  });
  const anim = new Animator(obj, src.animations);
  return { obj, anim };
}

// show exactly this set of weapon/offhand meshes on a character rig
export function setEquipMeshes(obj, meshes) {
  obj.traverse((n) => {
    if ((n.isMesh || n.isSkinnedMesh) && WEAPON_MESHES.includes(n.name)) n.visible = meshes.includes(n.name);
  });
}

// tint every mesh of a rig (elite/ghost/monster variants)
export function tintCharacter(obj, color, { ghost = false, emissive = 0 } = {}) {
  obj.traverse((n) => {
    if (!n.isMesh && !n.isSkinnedMesh) return;
    if (n.material.isMeshBasicMaterial) return; // blob shadows / glows — no emissive uniform
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
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const c of clips) this.actions[c.name] = this.mixer.clipAction(c);
    this.current = null;
    this.currentName = '';
  }
  has(name) { return !!this.actions[name]; }
  play(name, { fade = 0.16, timeScale = 1, once = false, clamp = false } = {}) {
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
export function makeWeaponModel(name) {
  const gltf = G.assets.weapon[name];
  return gltf ? gltf.scene.clone(true) : makePiece('key');
}

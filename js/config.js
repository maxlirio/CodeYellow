// Tuning constants and data tables.
export const CELL = 4;              // world units per grid cell (KayKit tile size)
export const WALL_H = 4;
export const PLATFORM_H = 4;        // height of climbable platforms

export const CLASSES = {
  knight: {
    name: 'Knight', icon: '🛡', model: 'Knight',
    desc: 'Sturdy sword & board. Balanced damage, high health.',
    hp: 125, dmg: 16, speed: 8.2, crit: 0.06, attackAnims: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'],
    attackTime: 0.7, attackRange: 3.0, attackArc: 1.1, mana: 60, manaRegen: 5,
    show: ['1H_Sword', 'Round_Shield'],
    spells: ['holybolt', 'shieldbash', 'warcry'],
  },
  barbarian: {
    name: 'Barbarian', icon: '🪓', model: 'Barbarian',
    desc: 'Massive two-handed axe. Slow swings, huge damage.',
    hp: 150, dmg: 26, speed: 7.7, crit: 0.1, attackAnims: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'],
    attackTime: 0.92, attackRange: 3.4, attackArc: 1.35, mana: 60, manaRegen: 5,
    show: ['2H_Axe'],
    spells: ['axethrow', 'groundslam', 'rage'],
  },
  rogue: {
    name: 'Rogue', icon: '🗡', model: 'Rogue',
    desc: 'Twin daggers. Fast, fragile, deadly crits.',
    hp: 92, dmg: 11, speed: 9.4, crit: 0.28, attackAnims: ['Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab'],
    attackTime: 0.44, attackRange: 2.6, attackArc: 1.0, mana: 70, manaRegen: 6,
    show: ['Knife', 'Knife_Offhand'],
    spells: ['knifefan', 'shadowstep', 'venomvial'],
  },
  mage: {
    name: 'Mage', icon: '🔮', model: 'Mage',
    desc: 'Arcane staff. Hurls fire bolts from afar.',
    hp: 84, dmg: 20, speed: 8.4, crit: 0.08, attackAnims: ['Spellcast_Shoot'],
    attackTime: 0.55, attackRange: 26, attackArc: 0, mana: 110, manaRegen: 9,
    show: ['2H_Staff'], ranged: true,
    spells: ['fireball', 'frostshard', 'chainlightning'],
  },
};

// ---------------- spells (keys 1/2/3) ----------------
export const SPELLS = {
  holybolt:   { name: 'Holy Bolt', icon: '✨', mana: 12, cd: 3,  type: 'proj', dmgMult: 1.35, speed: 24, color: 0xffe08a, size: 1.1 },
  shieldbash: { name: 'Shield Bash', icon: '🛡', mana: 15, cd: 6, type: 'cone', dmgMult: 1.0, range: 4.5, arc: 1.2, knockback: 9, stun: 1.2 },
  warcry:     { name: 'Warcry', icon: '❤️‍🔥', mana: 25, cd: 18, type: 'heal', frac: 0.35, radius: 9 },
  axethrow:   { name: 'Axe Throw', icon: '🪓', mana: 12, cd: 4,  type: 'proj', dmgMult: 1.8, speed: 18, color: 0xff8844, size: 1.5 },
  groundslam: { name: 'Ground Slam', icon: '💥', mana: 18, cd: 8, type: 'aoe', dmgMult: 1.3, radius: 5.5, stun: 1.0 },
  rage:       { name: 'Battle Rage', icon: '😤', mana: 20, cd: 16, type: 'buff', dmgMult: 1.45, speedMult: 1.25, dur: 6 },
  knifefan:   { name: 'Fan of Knives', icon: '🔪', mana: 14, cd: 5, type: 'proj', dmgMult: 0.65, speed: 21, color: 0xcccccc, count: 5, spread: 0.55 },
  shadowstep: { name: 'Shadow Step', icon: '🌀', mana: 12, cd: 7, type: 'blink', dist: 9 },
  venomvial:  { name: 'Venom Vial', icon: '☠️', mana: 16, cd: 8, type: 'proj', dmgMult: 0.5, speed: 15, color: 0x66ff44, aoe: 2.8, poison: { mult: 0.45, dur: 5 } },
  fireball:   { name: 'Fireball', icon: '🔥', mana: 18, cd: 5, type: 'proj', dmgMult: 1.5, speed: 19, color: 0xff5522, size: 1.4, aoe: 3.5 },
  frostshard: { name: 'Frost Shard', icon: '❄️', mana: 12, cd: 3.5, type: 'proj', dmgMult: 0.9, speed: 22, color: 0x88d4ff, slow: { mult: 0.45, dur: 3 } },
  chainlightning: { name: 'Chain Lightning', icon: '⚡', mana: 24, cd: 9, type: 'chain', dmgMult: 0.95, range: 20, jumps: 4, falloff: 0.78 },
};

// ---------------- items & rarity ----------------
export const RARITIES = [
  { id: 'common',    name: 'Common',    mult: 1.0,  color: '#b8b8b8', glow: 0x999999, w: 46 },
  { id: 'fine',      name: 'Fine',      mult: 1.18, color: '#6fdc6f', glow: 0x44cc44, w: 30 },
  { id: 'rare',      name: 'Rare',      mult: 1.4,  color: '#5aa0ff', glow: 0x3377ff, w: 16 },
  { id: 'epic',      name: 'Epic',      mult: 1.65, color: '#c05aff', glow: 0x9933ff, w: 6 },
  { id: 'legendary', name: 'Legendary', mult: 2.0,  color: '#ff9a2a', glow: 0xff8811, w: 2 },
];

// weapon archetypes per class: rig mesh(es) to show + ground-drop model
export const WEAPON_TYPES = {
  knight: [
    { id: 'sword1h', noun: 'Sword', mesh: ['1H_Sword', 'OFFHAND'], model: 'sword_1handed' },
    { id: 'sword2h', noun: 'Greatsword', mesh: ['2H_Sword'], model: 'sword_2handed', dmgBonus: 1.15 },
  ],
  barbarian: [
    { id: 'axe1h', noun: 'Axe', mesh: ['1H_Axe', 'OFFHAND'], model: 'axe_1handed' },
    { id: 'axe2h', noun: 'Great Axe', mesh: ['2H_Axe'], model: 'axe_2handed', dmgBonus: 1.15 },
  ],
  rogue: [
    { id: 'daggers', noun: 'Daggers', mesh: ['Knife', 'Knife_Offhand'], model: 'dagger' },
  ],
  mage: [
    { id: 'staff', noun: 'Staff', mesh: ['2H_Staff'], model: 'staff' },
    { id: 'wand', noun: 'Wand', mesh: ['1H_Wand'], model: 'wand', dmgBonus: 0.9, speedBonus: true },
  ],
};
// offhand item per class (shown when weapon is 1-handed)
export const OFFHAND_TYPES = {
  knight: { noun: 'Shield', meshes: ['Round_Shield', 'Badge_Shield', 'Spike_Shield'], models: ['shield_round', 'shield_badge', 'shield_spikes'], stat: 'armor' },
  barbarian: { noun: 'Shield', meshes: ['Barbarian_Round_Shield'], models: ['shield_round'], stat: 'armor' },
  rogue: { noun: 'Offhand Blade', meshes: ['Knife_Offhand'], models: ['dagger'], stat: 'crit' },
  mage: { noun: 'Spellbook', meshes: ['Spellbook'], models: ['wand'], stat: 'mregen' },
};

export const NAME_PREFIX = {
  common: ['Rusty', 'Worn', 'Plain', 'Chipped'],
  fine: ['Sturdy', 'Polished', 'Keen', 'Balanced'],
  rare: ['Cruel', 'Gleaming', 'Runed', 'Vicious'],
  epic: ['Bonewrought', 'Gravechilled', 'Sinister', 'Marrowbane'],
  legendary: ['Kingsbane', 'Doomforged', 'Eternal', 'Bonelord’s'],
};
export const NAME_SUFFIX = ['', '', 'of Embers', 'of the Crypt', 'of Marrow', 'of the Deep', 'of Echoes', 'of the Fallen King'];
export const TRINKET_NAMES = ['Ring', 'Amulet', 'Charm', 'Talisman', 'Signet'];
export const TRINKET_STATS = [
  { stat: 'crit', min: 4, max: 12, label: '% crit chance', icon: '🎯' },
  { stat: 'speed', min: 0.3, max: 0.9, label: ' move speed', icon: '👢' },
  { stat: 'hp', min: 12, max: 40, label: ' max HP', icon: '❤' },
  { stat: 'mregen', min: 2, max: 6, label: ' mana/s', icon: '🔮' },
  { stat: 'armor', min: 4, max: 12, label: '% damage reduction', icon: '🛡' },
];

// ---------------- enemies ----------------
export const ENEMIES = {
  minion:   { model: 'Skeleton_Minion',  hp: 32, dmg: 9,  speed: 4.8, range: 2.2, xp: 12, gold: [2, 7],  attackTime: 0.9, aggro: 11, scale: 1 },
  rogue:    { model: 'Skeleton_Rogue',   hp: 26, dmg: 7,  speed: 6.6, range: 2.1, xp: 15, gold: [3, 8],  attackTime: 0.7, aggro: 13, scale: 1 },
  warrior:  { model: 'Skeleton_Warrior', hp: 62, dmg: 14, speed: 3.9, range: 2.4, xp: 24, gold: [5, 12], attackTime: 1.1, aggro: 10, scale: 1.08 },
  mage:     { model: 'Skeleton_Mage',    hp: 38, dmg: 11, speed: 3.6, range: 14,  xp: 26, gold: [6, 12], attackTime: 1.4, aggro: 15, scale: 1, ranged: true },
  bomber:   { model: 'Skeleton_Minion',  hp: 24, dmg: 22, speed: 6.6, range: 1.8, xp: 20, gold: [4, 9],  attackTime: 0.4, aggro: 13, scale: 0.95, tint: 0x77ff55, explode: 3.6 },
  frostmage:{ model: 'Skeleton_Mage',    hp: 40, dmg: 9,  speed: 3.4, range: 14,  xp: 30, gold: [7, 14], attackTime: 1.5, aggro: 15, scale: 1, ranged: true, tint: 0x77bbff, slowBolt: true },
  ghost:    { model: 'Skeleton_Minion',  hp: 34, dmg: 13, speed: 3.1, range: 2.0, xp: 32, gold: [8, 15], attackTime: 0.9, aggro: 17, scale: 1.05, ghost: true },
  boss:     { model: 'Skeleton_Warrior', hp: 380, dmg: 22, speed: 4.6, range: 3.4, xp: 170, gold: [60, 90], attackTime: 1.1, aggro: 30, scale: 1.65, boss: true },
  boneking: { model: 'Skeleton_Mage',    hp: 620, dmg: 26, speed: 4.2, range: 16,  xp: 420, gold: [150, 220], attackTime: 1.3, aggro: 40, scale: 1.9, ranged: true, boss: true, summons: true },
};

// spawn pools per floor band (archers listed separately for platforms)
export function enemyPool(floor) {
  if (floor === 1) return ['minion', 'minion', 'minion', 'rogue'];
  if (floor === 2) return ['minion', 'minion', 'rogue', 'warrior', 'bomber'];
  if (floor <= 4) return ['minion', 'minion', 'rogue', 'warrior', 'mage', 'bomber', 'ghost'];
  if (floor <= 6) return ['minion', 'rogue', 'rogue', 'warrior', 'warrior', 'mage', 'bomber', 'frostmage', 'ghost'];
  return ['rogue', 'rogue', 'warrior', 'warrior', 'mage', 'mage', 'bomber', 'bomber', 'frostmage', 'ghost', 'ghost'];
}
export const ARCHERS = ['mage', 'frostmage', 'rogue'];
export const eliteChance = (floor) => Math.min(0.25, 0.04 + floor * 0.025);

export const BOSS_FLOORS = { 3: 'boss', 6: 'boss', 9: 'boneking' };
export const WIN_FLOOR = 9;
export const BOSS_NAMES = { 3: 'GRAVEBOUND CHAMPION', 6: 'THE MARROW WARDEN', 9: 'THE BONE KING' };

export const FLOOR_NAMES = [
  '', 'The Mossy Gate', 'Forgotten Cellars', 'Champion’s Crypt', 'The Rat Warrens',
  'Drowned Archives', 'Warden’s Maw', 'The Silent Ossuary', 'Roots of the World', 'Throne of the Bone King',
];

// difficulty scaling per floor
export const scaleHp = (hp, floor) => Math.round(hp * (1 + 0.22 * (floor - 1)));
export const scaleDmg = (dmg, floor) => Math.round(dmg * (1 + 0.13 * (floor - 1)));

export const XP_FOR_LEVEL = (lv) => Math.round(45 * Math.pow(lv, 1.35));

export const SHOP_ITEMS = [
  { id: 'potion', icon: '🧪', name: 'Health Potion', desc: 'Restores 45% HP. Drink with Q.', base: 25, grow: 6 },
  { id: 'atk', icon: '⚔', name: 'Whetstone', desc: '+3 damage for this run.', base: 40, grow: 22 },
  { id: 'hp', icon: '❤', name: 'Bone Charm', desc: '+20 max HP and heal 20.', base: 40, grow: 22 },
  { id: 'relic', icon: '💍', name: 'Mystery Relic', desc: 'A random trinket. Rarity scales with depth.', base: 70, grow: 25 },
];

// Weapon-ish meshes we hide by default; equipment then re-shows its kit.
export const WEAPON_MESHES = [
  '1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield',
  '1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Barbarian_Round_Shield', 'Mug',
  'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff',
  'Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable',
];

export const CAPE_COLORS = [
  { name: 'Crimson', hex: 0xb03030 }, { name: 'Royal Blue', hex: 0x3355bb }, { name: 'Forest', hex: 0x2f7d3a },
  { name: 'Violet', hex: 0x7a3fd0 }, { name: 'Gold', hex: 0xcc9922 }, { name: 'Ash', hex: 0x666677 },
];

// Tuning constants and data tables.
export const CELL = 4;              // world units per grid cell (KayKit tile size)
export const WALL_H = 4;

export const CLASSES = {
  knight: {
    name: 'Knight', icon: '🛡', model: 'Knight',
    desc: 'Sturdy sword & board. Balanced damage, high health.',
    hp: 120, dmg: 16, speed: 8.2, crit: 0.06, attackAnims: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'],
    attackTime: 0.72, attackRange: 2.6, attackArc: 1.1, mana: 0,
    show: ['1H_Sword', 'Round_Shield'],
  },
  barbarian: {
    name: 'Barbarian', icon: '🪓', model: 'Barbarian',
    desc: 'Massive two-handed axe. Slow swings, huge damage.',
    hp: 145, dmg: 26, speed: 7.7, crit: 0.1, attackAnims: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'],
    attackTime: 0.95, attackRange: 3.0, attackArc: 1.35, mana: 0,
    show: ['2H_Axe'],
  },
  rogue: {
    name: 'Rogue', icon: '🗡', model: 'Rogue',
    desc: 'Twin daggers. Fast, fragile, deadly crits.',
    hp: 90, dmg: 11, speed: 9.4, crit: 0.28, attackAnims: ['Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab'],
    attackTime: 0.45, attackRange: 2.3, attackArc: 1.0, mana: 0,
    show: ['Knife', 'Knife_Offhand'],
  },
  mage: {
    name: 'Mage', icon: '🔮', model: 'Mage',
    desc: 'Arcane staff. Hurls fire bolts from afar. Uses mana.',
    hp: 82, dmg: 21, speed: 8.4, crit: 0.08, attackAnims: ['Spellcast_Shoot'],
    attackTime: 0.6, attackRange: 22, attackArc: 0, mana: 100, manaCost: 12, manaRegen: 9,
    show: ['2H_Staff'], ranged: true,
  },
};

// Weapon-ish meshes we hide by default; each class then re-shows its own kit.
export const WEAPON_MESHES = [
  '1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield',
  '1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Barbarian_Round_Shield', 'Mug',
  'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff',
  'Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable',
];

export const ENEMIES = {
  minion:  { model: 'Skeleton_Minion',  hp: 32, dmg: 9,  speed: 4.8, range: 2.2, xp: 12, gold: [2, 7],  attackTime: 0.9, aggro: 11, scale: 1 },
  rogue:   { model: 'Skeleton_Rogue',   hp: 26, dmg: 7,  speed: 6.6, range: 2.1, xp: 15, gold: [3, 8],  attackTime: 0.7, aggro: 13, scale: 1 },
  warrior: { model: 'Skeleton_Warrior', hp: 60, dmg: 14, speed: 3.9, range: 2.4, xp: 24, gold: [5, 12], attackTime: 1.1, aggro: 10, scale: 1.08 },
  mage:    { model: 'Skeleton_Mage',    hp: 38, dmg: 11, speed: 3.6, range: 13,  xp: 26, gold: [6, 12], attackTime: 1.4, aggro: 14, scale: 1, ranged: true },
  boss:    { model: 'Skeleton_Warrior', hp: 340, dmg: 22, speed: 4.6, range: 3.2, xp: 160, gold: [60, 90], attackTime: 1.1, aggro: 30, scale: 1.65, boss: true },
  boneking:{ model: 'Skeleton_Mage',    hp: 560, dmg: 26, speed: 4.2, range: 15,  xp: 400, gold: [150, 220], attackTime: 1.3, aggro: 40, scale: 1.9, ranged: true, boss: true, summons: true },
};

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
  { id: 'speed', icon: '👢', name: 'Swift Boots', desc: '+0.5 move speed (max 3).', base: 55, grow: 30 },
];

// Tuning constants and data tables.
export const CELL = 4;              // world units per grid cell (KayKit tile size)
export const WALL_H = 4;
export const PLATFORM_H = 4;        // height of climbable platforms

export const CLASSES = {
  knight: {
    name: 'Knight', icon: '🛡', model: 'Knight',
    desc: 'Sturdy sword & board. No magic — raw martial power-ups.',
    physical: true,
    hp: 125, dmg: 16, speed: 8.2, crit: 0.06, attackAnims: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'],
    attackTime: 0.7, attackRange: 3.0, attackArc: 1.1, mana: 60, manaRegen: 2,
    show: ['1H_Sword', 'Round_Shield'],
    spellPool: ['shieldbash', 'warcry', 'bulwark', 'bullcharge', 'warbanner', 'executioner', 'chainhook'],
  },
  barbarian: {
    name: 'Barbarian', icon: '🪓', model: 'Barbarian',
    desc: 'Massive two-handed axe. No magic — raw martial power-ups.',
    physical: true,
    hp: 150, dmg: 26, speed: 7.7, crit: 0.1, attackAnims: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'],
    attackTime: 0.92, attackRange: 3.4, attackArc: 1.35, mana: 60, manaRegen: 2,
    show: ['2H_Axe'],
    spellPool: ['axethrow', 'groundslam', 'rage', 'whirlwind', 'leap', 'bloodlust', 'bullcharge', 'sunderstomp', 'chainhook', 'executioner'],
  },
  rogue: {
    name: 'Rogue', icon: '🗡', model: 'Rogue',
    desc: 'Twin daggers. Fast, fragile, deadly crits.',
    hp: 92, dmg: 11, speed: 9.4, crit: 0.28, attackAnims: ['Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Stab'],
    attackTime: 0.44, attackRange: 2.6, attackArc: 1.0, mana: 70, manaRegen: 2.5,
    show: ['Knife', 'Knife_Offhand'],
    spellPool: ['knifefan', 'shadowstep', 'venomvial', 'smokebomb', 'deathmark', 'shurikenstorm', 'bonewall', 'mirrorimage', 'ricochet', 'shadowswap', 'decoy', 'beartrap', 'embertrail'],
  },
  mage: {
    name: 'Mage', icon: '🔮', model: 'Mage',
    desc: 'Arcane staff. Bolts burn mana — they hit like a cannon when your reserves are full.',
    hp: 84, dmg: 26, speed: 8.4, crit: 0.08, attackAnims: ['Spellcast_Shoot'],
    attackTime: 0.55, attackRange: 26, attackArc: 0, mana: 110, manaRegen: 3.5, manaAttack: 0.2,
    show: ['2H_Staff'], ranged: true, boltVis: 'fire',
    spellPool: ['fireball', 'frostshard', 'chainlightning', 'meteor', 'blizzard', 'arcaneorb', 'bonewall', 'stormlance', 'mirrorimage', 'gravitywell', 'ricochet', 'gravitylash', 'chronobubble', 'frostprison', 'levitate', 'sanctuary'],
  },
  ranger: {
    name: 'Ranger', icon: '🏹', model: 'Rogue_Hooded',
    desc: 'Hooded archer. Draws a true bow — arrows fly where you aim.',
    hp: 95, dmg: 14, speed: 9.0, crit: 0.15, attackAnims: ['2H_Ranged_Shoot'],
    attackTime: 0.95, attackRange: 28, attackArc: 0, mana: 80, manaRegen: 2.5,
    show: [], ranged: true, boltVis: 'arrow',
    spellPool: ['powershot', 'multishot', 'rainarrows', 'shadowstep', 'smokebomb', 'bonewall', 'lifeward', 'beartrap', 'truesight', 'decoy', 'embertrail', 'sanctuary'],
  },
};

// ---------------- spells (each run deals you a random 3 from your class pool) ----------------
export const SPELLS = {
  // knight
  holybolt:   { name: 'Holy Bolt', icon: '✨', mana: 18, cd: 3,  type: 'proj', dmgMult: 1.35, speed: 24, color: 0xffe08a, size: 1.1, vis: 'holy' },
  shieldbash: { name: 'Shield Bash', icon: '🛡', mana: 22, cd: 6, type: 'cone', dmgMult: 1.0, range: 4.5, arc: 1.2, knockback: 9, stun: 1.2 },
  warcry:     { name: 'Warcry', icon: '❤️‍🔥', mana: 38, cd: 18, type: 'heal', frac: 0.35, radius: 9 },
  judgement:  { name: 'Judgement', icon: '⚖️', mana: 30, cd: 8, type: 'targetaoe', dmgMult: 1.6, radius: 3.2, range: 20, delay: 0.5, color: 0xffe08a },
  consecrate: { name: 'Consecrate', icon: '🕯️', mana: 27, cd: 10, type: 'aoe', dmgMult: 0.7, radius: 5, burn: { mult: 0.35, dur: 4 }, color: 0xffcc66 },
  bulwark:    { name: 'Bulwark', icon: '🧱', mana: 24, cd: 14, type: 'buff', armorAdd: 0.5, dmgMult: 1, speedMult: 1, dur: 5 },
  // barbarian
  axethrow:   { name: 'Axe Throw', icon: '🪓', mana: 18, cd: 4,  type: 'proj', dmgMult: 1.8, speed: 18, color: 0xff8844, size: 1.5, vis: 'axe', phys: true },
  groundslam: { name: 'Ground Slam', icon: '💥', mana: 27, cd: 8, type: 'aoe', dmgMult: 1.3, radius: 5.5, stun: 1.0 },
  rage:       { name: 'Battle Rage', icon: '😤', mana: 30, cd: 16, type: 'buff', dmgMult: 1.45, speedMult: 1.25, dur: 6 },
  whirlwind:  { name: 'Whirlwind', icon: '🌪️', mana: 30, cd: 7, type: 'aoe', dmgMult: 1.7, radius: 4.2, color: 0xffbb66 },
  leap:       { name: 'Savage Leap', icon: '🦵', mana: 24, cd: 9, type: 'blink', dist: 10, landAoe: { dmgMult: 1.1, radius: 4, stun: 0.6 } },
  bloodlust:  { name: 'Bloodlust', icon: '🩸', mana: 33, cd: 18, type: 'buff', dmgMult: 1.15, speedMult: 1.1, lifesteal: 0.25, dur: 7 },
  // rogue
  knifefan:   { name: 'Fan of Knives', icon: '🔪', mana: 21, cd: 5, type: 'proj', dmgMult: 0.65, speed: 21, color: 0xcccccc, count: 5, spread: 0.55, vis: 'knife' },
  shadowstep: { name: 'Shadow Step', icon: '🌀', mana: 18, cd: 7, type: 'blink', dist: 9 },
  venomvial:  { name: 'Venom Vial', icon: '☠️', mana: 24, cd: 8, type: 'proj', dmgMult: 0.5, speed: 15, color: 0x66ff44, aoe: 2.8, poison: { mult: 0.45, dur: 5 }, vis: 'vial' },
  smokebomb:  { name: 'Smoke Bomb', icon: '💨', mana: 22, cd: 12, type: 'aoe', dmgMult: 0, radius: 6, stun: 2.2, selfIframes: 1.2, color: 0x99aabb },
  deathmark:  { name: 'Death Mark', icon: '🎯', mana: 21, cd: 10, type: 'mark', range: 22, vuln: 1.5, dur: 6 },
  shurikenstorm: { name: 'Shuriken Storm', icon: '✴️', mana: 30, cd: 9, type: 'proj', dmgMult: 0.45, speed: 19, color: 0xbbccdd, count: 9, spread: 1.6, vis: 'knife' },
  // mage
  fireball:   { name: 'Fireball', icon: '🔥', mana: 27, cd: 5, type: 'proj', dmgMult: 1.5, speed: 19, color: 0xff5522, size: 1.4, aoe: 3.5, vis: 'fireball' },
  frostshard: { name: 'Frost Shard', icon: '❄️', mana: 18, cd: 3.5, type: 'proj', dmgMult: 0.9, speed: 22, color: 0x88d4ff, slow: { mult: 0.45, dur: 3 }, vis: 'shard' },
  chainlightning: { name: 'Chain Lightning', icon: '⚡', mana: 36, cd: 9, type: 'chain', dmgMult: 0.95, range: 20, jumps: 4, falloff: 0.78 },
  meteor:     { name: 'Meteor', icon: '☄️', mana: 39, cd: 11, type: 'targetaoe', dmgMult: 2.2, radius: 4.5, range: 24, delay: 0.9, color: 0xff6622, burn: { mult: 0.3, dur: 3 }, fall: 'fireball' },
  blizzard:   { name: 'Blizzard', icon: '🌨️', mana: 33, cd: 10, type: 'aoe', dmgMult: 0.6, radius: 7, slowAll: { mult: 0.4, dur: 4 }, color: 0xaaddff },
  arcaneorb:  { name: 'Arcane Orb', icon: '🔮', mana: 30, cd: 8, type: 'proj', dmgMult: 1.1, speed: 10, color: 0xcc66ff, size: 2.2, pierce: true, vis: 'orb' },
  // ranger
  powershot:  { name: 'Power Shot', icon: '🎯', mana: 21, cd: 5, type: 'proj', dmgMult: 2.0, speed: 34, color: 0xd8e6b0, pierce: true, vis: 'arrow', arrows: 1 },
  multishot:  { name: 'Multishot', icon: '🏹', mana: 24, cd: 6, type: 'proj', dmgMult: 0.8, speed: 28, color: 0xd8e6b0, count: 3, spread: 0.35, vis: 'arrow', arrows: 3 },
  rainarrows: { name: 'Rain of Arrows', icon: '🌧️', mana: 36, cd: 10, type: 'targetaoe', dmgMult: 1.4, radius: 4.5, range: 26, delay: 0.7, color: 0xd8e6b0, fall: 'arrowrain', arrows: 7 },
  // ---- physical power-up abilities (knight & barbarian) ----
  bullcharge:  { name: 'Charge', icon: '🐗', mana: 24, cd: 9, type: 'charge', dist: 9, dmgMult: 1.2, phys: true },
  warbanner:   { name: 'War Banner', icon: '🚩', mana: 30, cd: 18, type: 'banner', dur: 10, radius: 7, dmgAura: 1.25, phys: true },
  executioner: { name: "Executioner's Arc", icon: '🪓', mana: 27, cd: 10, type: 'cone', dmgMult: 1.3, range: 4.5, arc: 1.4, knockback: 4, execute: 0.3, execMult: 3, phys: true },
  sunderstomp: { name: 'Sunder Stomp', icon: '🦶', mana: 24, cd: 9, type: 'aoe', dmgMult: 0.9, radius: 5.5, vulnAll: 4, slowAll: { mult: 0.6, dur: 2.5 }, phys: true },
  chainhook:   { name: 'Chain Hook', icon: '⛓', mana: 21, cd: 8, type: 'hook', range: 16, dmgMult: 0.8, stun: 0.6, phys: true },
  // ---- exotic effect spells ----
  gravitylash: { name: 'Gravity Lash', icon: '🧲', mana: 27, cd: 0, type: 'lash', range: 22 },
  beartrap:    { name: 'Steel Trap', icon: '🪤', mana: 15, cd: 6, type: 'trap', dmgMult: 1.2, root: 2.5, max: 3 },
  chronobubble:{ name: 'Chrono Bubble', icon: '⏳', mana: 33, cd: 16, type: 'freeze', radius: 6, range: 20, dur: 3.5 },
  shadowswap:  { name: 'Shadow Swap', icon: '🌑', mana: 21, cd: 9, type: 'swap', range: 18, critDur: 3 },
  decoy:       { name: 'Straw Double', icon: '🎭', mana: 24, cd: 14, type: 'decoy', hp: 140, dur: 9 },
  frostprison: { name: 'Frost Prison', icon: '🧊', mana: 27, cd: 11, type: 'prison', range: 20, dur: 4, vuln: 4 },
  truesight:   { name: 'True Sight', icon: '👁', mana: 15, cd: 18, type: 'sight', dur: 12 },
  levitate:    { name: 'Levitate', icon: '🎈', mana: 24, cd: 14, type: 'levitate', dur: 4.5 },
  embertrail:  { name: 'Ember Trail', icon: '🔥', mana: 21, cd: 12, type: 'trail', dur: 6, dmgMult: 0.5 },
  sanctuary:   { name: 'Sanctuary', icon: '🛡', mana: 27, cd: 16, type: 'sanctuary', radius: 5.5, dur: 6 },
  // new schools
  mirrorimage: { name: 'Mirror Legion', icon: '👥', mana: 51, cd: 20, type: 'phantoms', count: 2, dur: 12, dmgMult: 0.5 },
  stormlance: { name: 'Storm Lance', icon: '⚡', mana: 30, cd: 6, type: 'lightning', dmgMult: 1.7, range: 18, forks: 3, forkRange: 8, forkMult: 0.75, stun: 0.6 },
  gravitywell: { name: 'Gravity Well', icon: '🌀', mana: 39, cd: 12, type: 'vortex', dmgMult: 1.1, radius: 6.5, range: 22, dur: 2.6, color: 0xbb66ff },
  ricochet:   { name: 'Ricochet Orb', icon: '🪩', mana: 21, cd: 5, type: 'proj', dmgMult: 1.05, speed: 15, color: 0x66ffee, size: 1.3, vis: 'orb', bounce: 4 },
  lifeward:   { name: 'Life Ward', icon: '💠', mana: 36, cd: 16, type: 'ward', frac: 0.07, radius: 6, dur: 8, tick: 1.0 },
  // universal
  bonewall:   { name: 'Bone Wall', icon: '🦴', mana: 24, cd: 12, type: 'wall', dur: 10, range: 12 },
};

// ---------------- weapon affixes (rare+ weapons) ----------------
export const AFFIXES = [
  { id: 'flaming', name: 'Flaming', desc: 'burns targets', burn: { mult: 0.3, dur: 3 } },
  { id: 'frost', name: 'Frostbound', desc: 'chills targets', slow: { mult: 0.55, dur: 2 } },
  { id: 'vampiric', name: 'Vampiric', desc: 'heals 8% of damage', lifesteal: 0.08 },
  { id: 'swift', name: 'Swift', desc: '+18% attack speed', atkSpeed: 1.18 },
  { id: 'brutal', name: 'Brutal', desc: '+10% crit', crit: 10 },
];

// ---------------- items & rarity ----------------
export const RARITIES = [
  { id: 'common',    name: 'Common',    mult: 1.0,  color: '#b8b8b8', glow: 0x999999, w: 46 },
  { id: 'fine',      name: 'Fine',      mult: 1.18, color: '#6fdc6f', glow: 0x44cc44, w: 30 },
  { id: 'rare',      name: 'Rare',      mult: 1.4,  color: '#5aa0ff', glow: 0x3377ff, w: 16 },
  { id: 'epic',      name: 'Epic',      mult: 1.65, color: '#c05aff', glow: 0x9933ff, w: 6 },
  { id: 'legendary', name: 'Legendary', mult: 2.0,  color: '#ff9a2a', glow: 0xff8811, w: 2 },
];

// weapon archetypes: rig mesh(es) + drop model; `ranged` swaps your basic attack style
// Every archetype swings differently (verb -> viewmodel anim), has its own
// stats, and lists which signature powers it can roll at rare+ quality.
// mesh = KayKit rig meshes; held = a GLB attached to the hand instead.
export const WEAPON_TYPES = {
  knight: [
    { id: 'sword1h', noun: 'Sword', mesh: ['1H_Sword', 'OFFHAND'], model: 'sword_1handed', verb: 'slash', sigPool: ['radiantbeam', 'frostwave'] },
    { id: 'sword2h', noun: 'Greatsword', mesh: ['2H_Sword'], model: 'sword_2handed', verb: 'cleave', dmgBonus: 1.15, sigPool: ['radiantbeam', 'earthsplitter'] },
    { id: 'knightblade', noun: 'Blade', mesh: [], held: 'Sword', model: 'Sword', verb: 'slash', dmgBonus: 0.95, atkTime: 0.6, critAdd: 0.05, sigPool: ['radiantbeam', 'frostwave'] },
    { id: 'claymore', noun: 'Claymore', mesh: [], held: 'Claymore', model: 'Claymore', verb: 'cleave', dmgBonus: 1.45, atkTime: 1.1, sigPool: ['earthsplitter', 'thunderclap'] },
    { id: 'warhammer', noun: 'Warhammer', mesh: [], held: 'Hammer_Double', model: 'Hammer_Double', verb: 'smash', dmgBonus: 1.3, atkTime: 1.0, stunHit: 0.4, sigPool: ['thunderclap', 'earthsplitter'] },
    { id: 'spear', noun: 'Spear', mesh: [], held: 'Spear', model: 'Spear', verb: 'stab', dmgBonus: 1.05, rangeAdd: 1.3, sigPool: ['frostwave', 'radiantbeam'] },
    { id: 'runesword', noun: 'Runeblade', mesh: [], held: 'Sword_Golden', model: 'Sword_Golden', verb: 'slash', dmgBonus: 1.1, atkTime: 0.62, critAdd: 0.08, minRarity: 2, sigPool: ['radiantbeam', 'dragonsbreath'] },
  ],
  barbarian: [
    { id: 'axe1h', noun: 'Axe', mesh: ['1H_Axe', 'OFFHAND'], model: 'axe_1handed', verb: 'slash', sigPool: ['firenova', 'dragonsbreath'] },
    { id: 'axe2h', noun: 'Great Axe', mesh: ['2H_Axe'], model: 'axe_2handed', verb: 'cleave', dmgBonus: 1.15, sigPool: ['firenova', 'earthsplitter'] },
    { id: 'waraxe', noun: 'War Axe', mesh: [], held: 'Axe', model: 'Axe', verb: 'cleave', dmgBonus: 1.25, atkTime: 1.0, sigPool: ['firenova', 'thunderclap'] },
    { id: 'doubleaxe', noun: 'Twinblade Axe', mesh: [], held: 'Axe_Double', model: 'Axe_Double', verb: 'cleave', dmgBonus: 1.2, arcAdd: 0.3, sigPool: ['firenova', 'earthsplitter'] },
    { id: 'maul', noun: 'Maul', mesh: [], held: 'Hammer_Small', model: 'Hammer_Small', verb: 'smash', dmgBonus: 1.5, atkTime: 1.25, stunHit: 0.5, sigPool: ['thunderclap', 'earthsplitter'] },
    { id: 'scythe', noun: 'Reaper Scythe', mesh: [], held: 'Scythe', model: 'Scythe', verb: 'sweep', dmgBonus: 1.15, arcAdd: 0.5, rangeAdd: 0.6, sigPool: ['lifedrain', 'dragonsbreath'], minRarity: 1 },
    { id: 'boneaxe', noun: 'Bone Cleaver', mesh: [], held: 'Skeleton_Axe', model: 'Skeleton_Axe', verb: 'cleave', dmgBonus: 1.1, lifestealAdd: 0.05, sigPool: ['lifedrain', 'firenova'] },
  ],
  // rogues are blade-work only — bows and arrows belong to the ranger
  rogue: [
    { id: 'daggers', noun: 'Daggers', mesh: ['Knife', 'Knife_Offhand'], model: 'dagger', verb: 'stab', sigPool: ['shadowflurry', 'frostwave'] },
    { id: 'fangs', noun: 'Twin Fangs', mesh: [], held: 'Dagger', held2: true, model: 'Dagger', verb: 'stab', dmgBonus: 0.9, atkTime: 0.4, critAdd: 0.07, sigPool: ['shadowflurry', 'dragonsbreath'] },
    { id: 'shadowfangs', noun: 'Shadow Fangs', mesh: [], held: 'Dagger_2', held2: true, model: 'Dagger_2', verb: 'stab', dmgBonus: 1.05, atkTime: 0.45, critAdd: 0.1, minRarity: 2, sigPool: ['shadowflurry', 'lifedrain'] },
    { id: 'boneblade', noun: 'Bone Shiv', mesh: [], held: 'Skeleton_Blade', model: 'Skeleton_Blade', verb: 'slash', dmgBonus: 1.0, lifestealAdd: 0.06, sigPool: ['lifedrain', 'shadowflurry'] },
    { id: 'goldfang', noun: 'Gilded Fang', mesh: [], held: 'Dagger_Golden', model: 'Dagger_Golden', verb: 'slash', dmgBonus: 1.15, critAdd: 0.06, minRarity: 2, sigPool: ['shadowflurry', 'radiantbeam'] },
  ],
  mage: [
    { id: 'staff', noun: 'Staff', mesh: ['2H_Staff'], model: 'staff', verb: 'cast', sigPool: ['voidrip', 'frostwave'] },
    { id: 'wand', noun: 'Wand', mesh: ['1H_Wand'], model: 'wand', verb: 'cast', dmgBonus: 0.82, atkTime: 0.38, speedAdd: 0.4, sigPool: ['voidrip', 'dragonsbreath'] },
    { id: 'skullstaff', noun: 'Skull Staff', mesh: [], held: 'skullstaff', model: 'skullstaff', verb: 'cast', dmgBonus: 1.15, atkTime: 0.65, lifestealAdd: 0.05, sigPool: ['lifedrain', 'voidrip'] },
    { id: 'crystalscepter', noun: 'Crystal Scepter', mesh: [], held: 'crystalscepter', model: 'crystalscepter', verb: 'cast', dmgBonus: 0.95, atkTime: 0.45, manaRegenAdd: 1.5, sigPool: ['frostwave', 'voidrip'], minRarity: 1 },
    { id: 'bonestaff', noun: 'Grave Staff', mesh: [], held: 'Skeleton_Staff', model: 'Skeleton_Staff', verb: 'cast', dmgBonus: 1.05, lifestealAdd: 0.06, sigPool: ['lifedrain', 'thunderclap'] },
  ],
  ranger: [
    { id: 'bow', noun: 'Bow', mesh: [], model: 'bow', verb: 'bowshoot', ranged: true, sigPool: ['arrowstorm', 'frostwave'] },
    { id: 'crossbow', noun: 'Crossbow', mesh: ['2H_Crossbow'], model: 'crossbow_2handed', verb: 'shoot', dmgBonus: 1.15, ranged: true, atkTime: 1.1, sigPool: ['arrowstorm', 'thunderclap'] },
    { id: 'longbow', noun: 'Longbow', mesh: [], held: 'Bow_Wooden', model: 'Bow_Wooden', verb: 'bowshoot', ranged: true, dmgBonus: 1.2, atkTime: 1.05, sigPool: ['arrowstorm', 'frostwave'] },
    { id: 'goldenbow', noun: 'Sunstrand Bow', mesh: [], held: 'Bow_Golden', model: 'Bow_Golden', verb: 'bowshoot', ranged: true, dmgBonus: 1.0, atkTime: 0.7, critAdd: 0.06, minRarity: 2, sigPool: ['radiantbeam', 'arrowstorm'] },
    { id: 'evilbow', noun: 'Dreadbow', mesh: [], held: 'Bow_Evil', model: 'Bow_Evil', verb: 'bowshoot', ranged: true, dmgBonus: 1.35, atkTime: 1.15, lifestealAdd: 0.05, minRarity: 1, sigPool: ['dragonsbreath', 'lifedrain'] },
  ],
};

// ---------------- weapon signature powers ----------------
// Rare+ weapons can roll one: landing basic hits builds charge; at full charge
// the weapon glows and key 4 unleashes it (costing mana + the charge).
export const SIGNATURES = {
  radiantbeam:   { name: 'Radiant Beam', icon: '🌟', mana: 20, hits: 8, desc: 'a piercing lance of light burns through everything in a line' },
  firenova:      { name: 'Fire Nova', icon: '💥', mana: 22, hits: 9, desc: 'an explosion of flame erupts around you, igniting the pack' },
  thunderclap:   { name: 'Thunderclap', icon: '🌩', mana: 22, hits: 9, desc: 'a stunning shockwave of thunder around you' },
  voidrip:       { name: 'Void Rip', icon: '🕳', mana: 25, hits: 10, desc: 'tear a hungry vortex open at your crosshair' },
  lifedrain:     { name: 'Life Drain', icon: '🩸', mana: 18, hits: 8, desc: 'siphon the life from every foe near you' },
  arrowstorm:    { name: 'Arrow Storm', icon: '🌪', mana: 20, hits: 8, desc: 'a fan of seven arrows in one draw' },
  frostwave:     { name: 'Frost Wave', icon: '❄️', mana: 20, hits: 8, desc: 'a freezing cone that chills all it touches' },
  shadowflurry:  { name: 'Shadow Flurry', icon: '🌑', mana: 22, hits: 9, desc: 'blink between the three nearest foes, striking each' },
  earthsplitter: { name: 'Earthsplitter', icon: '⛰', mana: 24, hits: 10, desc: 'a rupturing line of stone spikes ahead of you' },
  dragonsbreath: { name: "Dragon's Breath", icon: '🐉', mana: 24, hits: 10, desc: 'exhale a cone of dragonfire that keeps burning' },
};
export const OFFHAND_TYPES = {
  knight: { noun: 'Shield', meshes: ['Round_Shield', 'Badge_Shield', 'Spike_Shield'], models: ['shield_round', 'shield_badge', 'shield_spikes'], stat: 'armor' },
  barbarian: { noun: 'Shield', meshes: ['Barbarian_Round_Shield'], models: ['shield_round'], stat: 'armor' },
  rogue: { noun: 'Offhand Blade', meshes: ['Knife_Offhand'], models: ['dagger'], stat: 'crit' },
  mage: { noun: 'Spellbook', meshes: ['Spellbook'], models: ['wand'], stat: 'mregen' },
  ranger: { noun: 'Hunting Knife', meshes: ['Knife_Offhand'], models: ['dagger'], stat: 'crit' },
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
  { stat: 'mregen', min: 1, max: 3, label: ' mana/s', icon: '🔮' },
  { stat: 'armor', min: 4, max: 12, label: '% damage reduction', icon: '🛡' },
];

// ---------------- enemies ----------------
// animation-name maps for the Quaternius monster rigs (KayKit rigs use defaults)
const QA = 'CharacterArmature|';
export const ANIM_GROUND = { idle: QA + 'Idle', walk: QA + 'Walk', run: QA + 'Run', attack: [QA + 'Punch', QA + 'Weapon'], hit: QA + 'HitReact', death: QA + 'Death' };
export const ANIM_CRITTER = { idle: QA + 'Idle', walk: QA + 'Walk', run: QA + 'Walk', attack: [QA + 'Bite_Front'], hit: QA + 'HitRecieve', death: QA + 'Death' };
export const ANIM_FLYER = { idle: QA + 'Flying_Idle', walk: QA + 'Fast_Flying', run: QA + 'Fast_Flying', attack: [QA + 'Headbutt', QA + 'Punch'], hit: QA + 'HitReact', death: QA + 'Death' };
export const ENEMIES = {
  minion:   { model: 'Skeleton_Minion',  hp: 32, dmg: 9,  speed: 4.8, range: 2.2, xp: 12, gold: [2, 7],  attackTime: 0.9, aggro: 11, scale: 1 },
  rogue:    { model: 'Skeleton_Rogue',   hp: 26, dmg: 7,  speed: 6.6, range: 2.1, xp: 15, gold: [3, 8],  attackTime: 0.7, aggro: 13, scale: 1 },
  warrior:  { model: 'Skeleton_Warrior', hp: 62, dmg: 14, speed: 3.9, range: 2.4, xp: 24, gold: [5, 12], attackTime: 1.1, aggro: 10, scale: 1.08 },
  mage:     { model: 'Skeleton_Mage',    hp: 38, dmg: 11, speed: 3.6, range: 14,  xp: 26, gold: [6, 12], attackTime: 1.4, aggro: 15, scale: 1, ranged: true },
  bomber:   { model: 'Skeleton_Minion',  hp: 24, dmg: 22, speed: 6.6, range: 1.8, xp: 20, gold: [4, 9],  attackTime: 0.4, aggro: 13, scale: 0.95, tint: 0x77ff55, explode: 3.6 },
  frostmage:{ model: 'Skeleton_Mage',    hp: 40, dmg: 9,  speed: 3.4, range: 14,  xp: 30, gold: [7, 14], attackTime: 1.5, aggro: 15, scale: 1, ranged: true, tint: 0x77bbff, slowBolt: true },
  ghost:    { model: 'Skeleton_Minion',  hp: 34, dmg: 13, speed: 3.1, range: 2.0, xp: 32, gold: [8, 15], attackTime: 0.9, aggro: 17, scale: 1.05, ghost: true },
  shade:    { model: 'Skeleton_Rogue',   hp: 28, dmg: 10, speed: 5.4, range: 2.0, xp: 34, gold: [8, 16], attackTime: 0.6, aggro: 18, scale: 1, ghost: true, tint: 0x334455 },
  necromancer: { model: 'Skeleton_Mage', hp: 46, dmg: 10, speed: 3.2, range: 13, xp: 42, gold: [10, 20], attackTime: 1.5, aggro: 15, scale: 1.1, ranged: true, tint: 0xbb66ff, summons: true, summonEvery: 12, summonType: 'minion', summonCount: 1 },
  berserker:{ model: 'Skeleton_Rogue',   hp: 44, dmg: 11, speed: 5.6, range: 2.2, xp: 36, gold: [8, 16], attackTime: 0.55, aggro: 14, scale: 1.05, tint: 0xff5544, enrage: true },
  juggernaut:{ model: 'Skeleton_Warrior', hp: 120, dmg: 18, speed: 2.7, range: 2.6, xp: 55, gold: [14, 26], attackTime: 1.3, aggro: 10, scale: 1.28, tint: 0x666677, stalwart: true },
  plaguebearer:{ model: 'Skeleton_Minion', hp: 38, dmg: 8, speed: 4.4, range: 2.2, xp: 38, gold: [9, 17], attackTime: 0.95, aggro: 12, scale: 1.05, tint: 0x66aa44, plague: { dps: 4, dur: 4 }, deathCloud: 3.2 },
  sniper:   { model: 'Skeleton_Rogue',   hp: 26, dmg: 13, speed: 4.5, range: 18,  xp: 34, gold: [8, 15], attackTime: 1.7, aggro: 20, scale: 1, ranged: true, tint: 0xccbb88, boltSpeed: 24, heldModel: 'crossbow_1handed', boltVis: 'arrow' },
  brute:    { model: 'Skeleton_Minion',  hp: 55, dmg: 15, speed: 4.0, range: 2.4, xp: 30, gold: [7, 14], attackTime: 1.1, aggro: 11, scale: 1.3, tint: 0xcc9966, kbHit: 7 },
  // ---- the greenskin & monster menagerie (Quaternius rigs) ----
  goblin:   { model: 'Goblin', hp: 20, dmg: 6, speed: 6.8, range: 1.9, xp: 10, gold: [2, 5], attackTime: 0.7, aggro: 13, scale: 0.55, animMap: 'critter', trio: true },
  orcwar:   { model: 'Orc', hp: 55, dmg: 13, speed: 5.2, range: 2.4, xp: 26, gold: [6, 12], attackTime: 0.95, aggro: 12, scale: 0.8, animMap: 'ground' },
  ogre:     { model: 'Ogre', hp: 140, dmg: 24, speed: 3.4, range: 2.9, xp: 60, gold: [15, 28], attackTime: 1.5, aggro: 11, scale: 1.3, animMap: 'ground', stalwart: true, kbHit: 8 },
  imp:      { model: 'Imp', hp: 30, dmg: 10, speed: 5.5, range: 9, xp: 28, gold: [7, 13], attackTime: 1.3, aggro: 15, scale: 0.55, animMap: 'flyer', fly: true, ranged: true, boltVis: 'wisp' },
  slime:    { model: 'Slime', hp: 40, dmg: 8, speed: 3.4, range: 2.0, xp: 24, gold: [5, 10], attackTime: 1.0, aggro: 11, scale: 0.7, animMap: 'critter', splitInto: 'slimelet' },
  slimelet: { model: 'Slime', hp: 14, dmg: 5, speed: 5.4, range: 1.7, xp: 8, gold: [1, 3], attackTime: 0.8, aggro: 14, scale: 0.4, animMap: 'critter' },
  glub:     { model: 'Glub', hp: 34, dmg: 11, speed: 4.6, range: 2.2, xp: 30, gold: [8, 14], attackTime: 1.0, aggro: 15, scale: 0.62, animMap: 'flyer', fly: true },
  drake:    { model: 'Drake', hp: 90, dmg: 18, speed: 6.0, range: 10, xp: 70, gold: [20, 35], attackTime: 1.4, aggro: 18, scale: 1.0, animMap: 'flyer', fly: true, ranged: true, boltVis: 'fireball', boltSpeed: 15 },
  // bosses (floor 3/6 rolls one archetype; floor 9 is always the Bone King)
  boss:     { model: 'Skeleton_Warrior', hp: 380, dmg: 22, speed: 4.6, range: 3.4, xp: 170, gold: [60, 90], attackTime: 1.1, aggro: 30, scale: 1.65, boss: true, bossName: 'GRAVEBOUND CHAMPION', stalwart: true },
  necrolord:{ model: 'Skeleton_Mage',    hp: 300, dmg: 18, speed: 3.8, range: 15, xp: 180, gold: [60, 95], attackTime: 1.3, aggro: 30, scale: 1.6, boss: true, ranged: true, tint: 0xbb66ff, summons: true, summonEvery: 8, summonType: 'minion', summonCount: 2, bossName: 'THE NECROLORD', bossMsg: 'raises the dead' },
  reaper:   { model: 'Skeleton_Rogue',   hp: 320, dmg: 20, speed: 6.8, range: 2.8, xp: 180, gold: [60, 95], attackTime: 0.6, aggro: 32, scale: 1.55, boss: true, ghost: true, tint: 0x223344, bossName: 'THE PALE REAPER' },
  boneking: { model: 'Skeleton_Mage',    hp: 620, dmg: 26, speed: 4.2, range: 16,  xp: 420, gold: [150, 220], attackTime: 1.3, aggro: 40, scale: 1.9, ranged: true, boss: true, summons: true, summonEvery: 9, summonType: 'minion', summonCount: 2, bossName: 'THE BONE KING' },
  mushking: { model: 'MushroomKing', hp: 350, dmg: 20, speed: 4.4, range: 3.0, xp: 190, gold: [70, 100], attackTime: 1.2, aggro: 30, scale: 1.35, animMap: 'ground', boss: true, stalwart: true, summons: true, summonEvery: 10, summonType: 'slimelet', summonCount: 3, bossName: 'THE MYCELIC KING', bossMsg: 'spawns spores' },
  dragon:   { model: 'Red_Dragon', hp: 2400, dmg: 24, speed: 5.5, range: 30, xp: 900, gold: [340, 480], attackTime: 1.2, aggro: 55, scale: 0.85, bodyR: 4.5, meshY: 3.4, singleClip: 'flying', boss: true, dragon: true, stalwart: true, bossName: 'EMBERWING THE UNDYING' },
};
export const MIDBOSS_TYPES = ['boss', 'necrolord', 'reaper', 'mushking', 'boneking'];

// base pool per floor band; themes then bias it
export function enemyPool(floor) {
  if (floor === 1) return ['minion', 'minion', 'goblin', 'goblin', 'rogue'];
  if (floor === 2) return ['minion', 'goblin', 'rogue', 'warrior', 'bomber', 'slime', 'orcwar'];
  if (floor <= 4) return ['minion', 'goblin', 'rogue', 'warrior', 'mage', 'bomber', 'ghost', 'brute', 'orcwar', 'slime', 'imp'];
  if (floor <= 6) return ['minion', 'goblin', 'rogue', 'warrior', 'warrior', 'mage', 'bomber', 'frostmage', 'ghost', 'brute', 'berserker', 'sniper', 'plaguebearer', 'orcwar', 'orcwar', 'imp', 'ogre'];
  return ['rogue', 'warrior', 'warrior', 'mage', 'mage', 'bomber', 'frostmage', 'ghost', 'berserker', 'juggernaut', 'plaguebearer', 'sniper', 'necromancer', 'shade', 'brute', 'orcwar', 'ogre', 'imp', 'drake', 'glub'];
}
export const ARCHERS = ['mage', 'frostmage', 'sniper', 'sniper'];
export const eliteChance = (floor) => Math.min(0.25, 0.04 + floor * 0.025);

export const BOSS_FLOORS = { 3: true, 6: true, 9: true };
export const WIN_FLOOR = 9;

// ---------------- floor themes ----------------
export const THEMES = [
  {
    id: 'crypt', name: 'The Crypts', fog: 0x0a0812, density: 0.030,
    hemi: 0x9988bb, amb: 0x4a4260, torch: 0xffb066,
    tiles: ['floor_tile_large', 'floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_decorated', 'floor_tile_small_broken_B'],
    props: ['barrel_large', 'box_large', 'crates_stacked', 'table_medium', 'shelf_small'],
    banners: ['banner_patternA_red', 'banner_patternA_blue'],
    bias: [],
  },
  {
    id: 'cellars', name: 'The Rotten Cellars', fog: 0x120c06, density: 0.032,
    hemi: 0xbb9977, amb: 0x554433, torch: 0xffc080,
    tiles: ['floor_wood_large', 'floor_wood_large', 'floor_wood_small', 'floor_wood_large_dark', 'floor_wood_small_dark'],
    props: ['barrel_large', 'barrel_small', 'crates_stacked', 'box_large', 'box_small', 'table_medium'],
    banners: ['banner_patternA_red'],
    bias: ['rogue', 'berserker', 'goblin', 'goblin', 'orcwar'],
  },
  {
    id: 'drowned', name: 'The Drowned Deep', fog: 0x061210, density: 0.038,
    hemi: 0x77bbaa, amb: 0x2f4a44, torch: 0xaaffcc,
    tiles: ['floor_tile_large', 'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_small_weeds_A', 'floor_tile_large_rocks'],
    props: ['barrel_large', 'box_small', 'shelf_small'],
    banners: ['banner_patternA_blue'],
    bias: ['ghost', 'plaguebearer', 'slime', 'slime', 'glub'],
  },
  {
    id: 'ossuary', name: 'The Silent Ossuary', fog: 0x14121a, density: 0.026,
    hemi: 0xccccdd, amb: 0x555566, torch: 0xffe0aa,
    tiles: ['floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_decorated'],
    props: ['table_medium', 'shelf_small', 'chair'],
    banners: ['banner_patternA_blue'],
    bias: ['ghost', 'ghost', 'shade', 'necromancer'],
  },
  {
    id: 'forge', name: 'The Ember Forge', fog: 0x160804, density: 0.034,
    hemi: 0xcc7755, amb: 0x552211, torch: 0xff6633,
    tiles: ['floor_tile_large', 'floor_tile_large_rocks', 'floor_dirt_large_rocky', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B'],
    props: ['crates_stacked', 'box_large', 'barrel_large'],
    banners: ['banner_patternA_red'],
    bias: ['bomber', 'berserker', 'imp', 'imp', 'ogre'],
  },
  {
    id: 'frozen', name: 'The Frostbound Halls', fog: 0x0a1018, density: 0.030,
    hemi: 0x88aadd, amb: 0x334466, torch: 0x99ccff,
    tiles: ['floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_decorated'],
    props: ['box_large', 'crates_stacked', 'shelf_small'],
    banners: ['banner_patternA_blue'],
    bias: ['frostmage', 'frostmage', 'juggernaut', 'sniper'],
  },
  {
    id: 'warrens', name: 'The Rat Warrens', fog: 0x0c0a06, density: 0.036,
    hemi: 0xaa9977, amb: 0x443b2a, torch: 0xffb066,
    tiles: ['floor_dirt_large', 'floor_dirt_small_A', 'floor_dirt_small_B', 'floor_dirt_small_C', 'floor_dirt_small_D', 'floor_dirt_large_rocky'],
    props: ['barrel_small', 'box_small', 'crates_stacked'],
    bias: ['goblin', 'goblin', 'goblin', 'orcwar'],
    banners: [],
  },
];

// ---------------- floor mutators ----------------
export const MUTATORS = [
  { id: 'infested', name: 'INFESTED', desc: 'The dead are legion — half again as many foes.', countMult: 1.5 },
  { id: 'cursed', name: 'CURSED', desc: 'Foes are hardier, but their bones drip with gold.', hpMult: 1.4, goldMult: 1.8 },
  { id: 'treasure', name: 'TREASURE VAULT', desc: 'Riches beyond counting hide here.', extraChests: 3, extraCoins: 8 },
  { id: 'haunted', name: 'HAUNTED', desc: 'Spirits drift through these halls.', poolOverride: ['ghost', 'ghost', 'shade', 'shade', 'necromancer'] },
  { id: 'swift', name: 'SWIFT DEATH', desc: 'Everything here is faster. Everything.', speedMult: 1.3, xpMult: 1.4 },
  { id: 'darkness', name: 'PITCH DARK', desc: 'The torches have all but died.', torchMult: 0.35 },
];
export const MUTATOR_CHANCE = 0.45;

export const LAYOUTS = ['rooms', 'warrens', 'cavern', 'hall'];

// difficulty scaling per floor
export const scaleHp = (hp, floor) => Math.round(hp * (1 + 0.22 * (floor - 1)));
export const scaleDmg = (dmg, floor) => Math.round(dmg * (1 + 0.13 * (floor - 1)));

export const XP_FOR_LEVEL = (lv) => Math.round(45 * Math.pow(lv, 1.35));

export const SHOP_ITEMS = [
  { id: 'potion', icon: '🧪', name: 'Health Potion', desc: 'Restores 45% HP. Drink with Q.', base: 25, grow: 6 },
  { id: 'atk', icon: '⚔', name: 'Whetstone', desc: '+3 damage for this run.', base: 40, grow: 22 },
  { id: 'hp', icon: '❤', name: 'Bone Charm', desc: '+20 max HP and heal 20.', base: 40, grow: 22 },
  { id: 'relic', icon: '💍', name: 'Mystery Relic', desc: 'A random trinket. Rarity scales with depth.', base: 70, grow: 25 },
  { id: 'tome', icon: '📖', name: 'Spell Tome', desc: 'Replace one of your spells with another from your school.', base: 55, grow: 20 },
  { id: 'reforge', icon: '🔨', name: 'Reforge Weapon', desc: 'A brand-new random weapon for your class.', base: 60, grow: 18 },
  { id: 'offhand', icon: '🛡', name: 'Forge Offhand', desc: 'A random offhand item for your class.', base: 45, grow: 15 },
  { id: 'merc', icon: '🤺', name: 'Hire Mercenary', desc: 'A sellsword or marksman fights beside you until slain.', base: 120, grow: 60 },
  { id: 'arrows', icon: '🏹', name: 'Bundle of Arrows', desc: '+25 arrows for bows and crossbows.', base: 20, grow: 0 },
];

// which building sells what (the old floor-merchant is gone — shop in town)
export const SHOP_TABLES = {
  blacksmith: { title: '⚒ The Blacksmith', greet: '“Steel solves most problems.”', items: ['atk', 'reforge', 'offhand', 'arrows'] },
  alchemist: { title: '🧪 The Alchemist', greet: '“Drink up. Probably not poison.”', items: ['potion', 'hp'] },
  arcanum: { title: '🔮 The Arcanum', greet: '“Knowledge has a price.”', items: ['tome', 'relic'] },
  tavern: { title: '🍺 The Cracked Flagon', greet: '“Swords for hire, ale for sale.”', items: ['merc', 'potion', 'arrows'] },
};

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

// Tuning constants and data tables.
export const CELL = 4;              // world units per grid cell (KayKit tile size)
export const WALL_H = 4;
export const PLATFORM_H = 4;        // height of climbable platforms

// NO CLASSES — you muster as a trooper and BECOME something at the training
// station: skills bought with points earned in the field shape your build,
// and any weapon the hulk drops is yours to use.
export const CLASSES = {
  trooper: {
    name: 'Trooper', icon: '', model: 'Character_Soldier', scale: 0.85,
    desc: 'A boarding trooper of the breach corps. No preset kit, no ceiling — train the skills, carry the guns, become the operative you want.',
    hp: 115, dmg: 16, speed: 8.8, crit: 0.1, attackAnims: ['1H_Melee_Attack_Slice_Horizontal', '2H_Melee_Attack_Chop'],
    attackTime: 0.7, attackRange: 3.0, attackArc: 1.15, mana: 90, manaRegen: 3,
    show: [], boltVis: 'laser', boltColor: 0x8cf2ff,
    spellPool: [],
  },
};

// the training station's catalog: each rank costs one point earned by leveling
export const SKILLS = [
  { id: 'plating', name: 'Ablative Plating', max: 2, desc: '+8% damage reduction per rank' },
  { id: 'frame', name: 'Reinforced Frame', max: 2, desc: '+22 hull per rank; rank 2 braces you against knockback' },
  { id: 'servos', name: 'Servo Legs', max: 2, desc: '+0.5 move speed per rank' },
  { id: 'optics', name: 'Overclock Optics', max: 2, desc: '+6% critical chance per rank' },
  { id: 'drills', name: 'Weapon Drills', max: 2, desc: '+9% weapon damage per rank' },
  { id: 'capacitors', name: 'Capacitor Bank', max: 2, desc: '+25 energy and +1 energy regen per rank' },
  { id: 'nanorepair', name: 'Nano-Repair', max: 2, desc: 'hull self-repairs +0.5/s per rank' },
  { id: 'escort', name: 'Escort Protocol', max: 1, desc: 'a Blade Trooper prints immediately and fights beside you' },
];

// ---------------- spells (each run deals you a random 3 from your class pool) ----------------
export const SPELLS = {
  // knight
  holybolt:   { name: 'Holy Bolt', icon: '', mana: 18, cd: 3,  type: 'proj', dmgMult: 1.35, speed: 24, color: 0xffe08a, size: 1.1, vis: 'holy' },
  shieldbash: { name: 'Shield Bash', icon: '', mana: 22, cd: 6, type: 'cone', dmgMult: 1.0, range: 4.5, arc: 1.2, knockback: 9, stun: 1.2 },
  warcry:     { name: 'Warcry', icon: '', mana: 38, cd: 18, type: 'heal', frac: 0.35, radius: 9 },
  judgement:  { name: 'Judgement', icon: '', mana: 30, cd: 8, type: 'targetaoe', dmgMult: 1.6, radius: 3.2, range: 20, delay: 0.5, color: 0xffe08a },
  consecrate: { name: 'Consecrate', icon: '', mana: 27, cd: 10, type: 'aoe', dmgMult: 0.7, radius: 5, burn: { mult: 0.35, dur: 4 }, color: 0xffcc66 },
  bulwark:    { name: 'Bulwark', icon: '', mana: 24, cd: 14, type: 'buff', armorAdd: 0.5, dmgMult: 1, speedMult: 1, dur: 5 },
  // barbarian
  axethrow:   { name: 'Axe Throw', icon: '', mana: 18, cd: 4,  type: 'proj', dmgMult: 1.8, speed: 18, color: 0xff8844, size: 1.5, vis: 'axe', phys: true },
  groundslam: { name: 'Ground Slam', icon: '', mana: 27, cd: 8, type: 'aoe', dmgMult: 1.3, radius: 5.5, stun: 1.0 },
  rage:       { name: 'Battle Rage', icon: '', mana: 30, cd: 16, type: 'buff', dmgMult: 1.45, speedMult: 1.25, dur: 6 },
  whirlwind:  { name: 'Whirlwind', icon: '', mana: 30, cd: 7, type: 'aoe', dmgMult: 1.7, radius: 4.2, color: 0xffbb66 },
  leap:       { name: 'Savage Leap', icon: '', mana: 24, cd: 9, type: 'blink', dist: 10, landAoe: { dmgMult: 1.1, radius: 4, stun: 0.6 } },
  bloodlust:  { name: 'Bloodlust', icon: '', mana: 33, cd: 18, type: 'buff', dmgMult: 1.15, speedMult: 1.1, lifesteal: 0.25, dur: 7 },
  // rogue
  knifefan:   { name: 'Fan of Knives', icon: '', mana: 21, cd: 5, type: 'proj', dmgMult: 0.65, speed: 21, color: 0xcccccc, count: 5, spread: 0.55, vis: 'knife' },
  shadowstep: { name: 'Shadow Step', icon: '', mana: 18, cd: 7, type: 'blink', dist: 9 },
  venomvial:  { name: 'Venom Vial', icon: '', mana: 24, cd: 8, type: 'proj', dmgMult: 0.5, speed: 15, color: 0x66ff44, aoe: 2.8, poison: { mult: 0.45, dur: 5 }, vis: 'vial' },
  smokebomb:  { name: 'Smoke Bomb', icon: '', mana: 22, cd: 12, type: 'aoe', dmgMult: 0, radius: 6, stun: 2.2, selfIframes: 1.2, color: 0x99aabb },
  deathmark:  { name: 'Death Mark', icon: '', mana: 21, cd: 10, type: 'mark', range: 22, vuln: 1.5, dur: 6 },
  shurikenstorm: { name: 'Shuriken Storm', icon: '', mana: 30, cd: 9, type: 'proj', dmgMult: 0.45, speed: 19, color: 0xbbccdd, count: 9, spread: 1.6, vis: 'knife' },
  // mage
  fireball:   { name: 'Fireball', icon: '', mana: 27, cd: 5, type: 'proj', dmgMult: 1.5, speed: 19, color: 0xff5522, size: 1.4, aoe: 3.5, vis: 'fireball' },
  frostshard: { name: 'Frost Shard', icon: '', mana: 18, cd: 3.5, type: 'proj', dmgMult: 0.9, speed: 22, color: 0x88d4ff, slow: { mult: 0.45, dur: 3 }, vis: 'shard' },
  chainlightning: { name: 'Chain Lightning', icon: '', mana: 36, cd: 9, type: 'chain', dmgMult: 0.95, range: 20, jumps: 4, falloff: 0.78 },
  meteor:     { name: 'Meteor', icon: '', mana: 39, cd: 11, type: 'targetaoe', dmgMult: 2.2, radius: 4.5, range: 24, delay: 0.9, color: 0xff6622, burn: { mult: 0.3, dur: 3 }, fall: 'fireball' },
  blizzard:   { name: 'Blizzard', icon: '', mana: 33, cd: 10, type: 'aoe', dmgMult: 0.6, radius: 7, slowAll: { mult: 0.4, dur: 4 }, color: 0xaaddff },
  arcaneorb:  { name: 'Arcane Orb', icon: '', mana: 30, cd: 8, type: 'proj', dmgMult: 1.1, speed: 10, color: 0xcc66ff, size: 2.2, pierce: true, vis: 'orb' },
  // ranger
  powershot:  { name: 'Power Shot', icon: '', mana: 21, cd: 5, type: 'proj', dmgMult: 2.0, speed: 34, color: 0xd8e6b0, pierce: true, vis: 'arrow', arrows: 1 },
  multishot:  { name: 'Multishot', icon: '', mana: 24, cd: 6, type: 'proj', dmgMult: 0.8, speed: 28, color: 0xd8e6b0, count: 3, spread: 0.35, vis: 'arrow', arrows: 3 },
  rainarrows: { name: 'Rain of Arrows', icon: '', mana: 36, cd: 10, type: 'targetaoe', dmgMult: 1.4, radius: 4.5, range: 26, delay: 0.7, color: 0xd8e6b0, fall: 'arrowrain', arrows: 7 },
  // ---- physical power-up abilities (knight & barbarian) ----
  bullcharge:  { name: 'Charge', icon: '', mana: 24, cd: 9, type: 'charge', dist: 9, dmgMult: 1.2, phys: true },
  warbanner:   { name: 'War Banner', icon: '', mana: 30, cd: 18, type: 'banner', dur: 10, radius: 7, dmgAura: 1.25, phys: true },
  executioner: { name: "Executioner's Arc", icon: '', mana: 27, cd: 10, type: 'cone', dmgMult: 1.3, range: 4.5, arc: 1.4, knockback: 4, execute: 0.3, execMult: 3, phys: true },
  sunderstomp: { name: 'Sunder Stomp', icon: '', mana: 24, cd: 9, type: 'aoe', dmgMult: 0.9, radius: 5.5, vulnAll: 4, slowAll: { mult: 0.6, dur: 2.5 }, phys: true },
  chainhook:   { name: 'Chain Hook', icon: '', mana: 21, cd: 8, type: 'hook', range: 16, dmgMult: 0.8, stun: 0.6, phys: true },
  // ---- exotic effect spells ----
  gravitylash: { name: 'Gravity Lash', icon: '', mana: 27, cd: 0, type: 'lash', range: 22 },
  beartrap:    { name: 'Arc Snare', icon: '', mana: 15, cd: 6, type: 'trap', dmgMult: 1.2, root: 2.5, max: 3 },
  chronobubble:{ name: 'Chrono Bubble', icon: '', mana: 33, cd: 16, type: 'freeze', radius: 6, range: 20, dur: 3.5 },
  shadowswap:  { name: 'Shadow Swap', icon: '', mana: 21, cd: 9, type: 'swap', range: 18, critDur: 3 },
  decoy:       { name: 'Holo Double', icon: '', mana: 24, cd: 14, type: 'decoy', hp: 140, dur: 9 },
  frostprison: { name: 'Frost Prison', icon: '', mana: 27, cd: 11, type: 'prison', range: 20, dur: 4, vuln: 4 },
  truesight:   { name: 'True Sight', icon: '', mana: 15, cd: 18, type: 'sight', dur: 12 },
  levitate:    { name: 'Levitate', icon: '', mana: 24, cd: 14, type: 'levitate', dur: 4.5 },
  embertrail:  { name: 'Ember Trail', icon: '', mana: 21, cd: 12, type: 'trail', dur: 6, dmgMult: 0.5 },
  sanctuary:   { name: 'Sanctuary', icon: '', mana: 27, cd: 16, type: 'sanctuary', radius: 5.5, dur: 6 },
  // ---- the necromancer's school + shared dark exotics ----
  raisedead:  { name: 'Raise Dead', icon: '', mana: 33, cd: 6, type: 'raise', cap: 4, dmgMult: 0.45 },
  dominate:   { name: 'Dominate', icon: '', mana: 36, cd: 14, type: 'charm', range: 20, dur: 9 },
  soulharvest:{ name: 'Soul Harvest', icon: '', mana: 30, cd: 11, type: 'harvest', radius: 8, dmgMult: 1.0, healFrac: 0.5 },
  bloodpact:  { name: 'Blood Pact', icon: '', mana: 0, cd: 9, type: 'pact', hpCost: 0.2, manaGain: 0.4 },
  deathcoil:  { name: 'Death Coil', icon: '', mana: 21, cd: 5, type: 'proj', dmgMult: 1.25, speed: 17, color: 0x77ff88, size: 1.2, vis: 'wisp', lifesteal: 0.5 },
  // new schools
  mirrorimage: { name: 'Mirror Legion', icon: '', mana: 51, cd: 20, type: 'phantoms', count: 2, dur: 12, dmgMult: 0.5 },
  stormlance: { name: 'Storm Lance', icon: '', mana: 30, cd: 6, type: 'lightning', dmgMult: 1.7, range: 18, forks: 3, forkRange: 8, forkMult: 0.75, stun: 0.6 },
  gravitywell: { name: 'Gravity Well', icon: '', mana: 39, cd: 12, type: 'vortex', dmgMult: 1.1, radius: 6.5, range: 22, dur: 2.6, color: 0xbb66ff },
  ricochet:   { name: 'Ricochet Orb', icon: '', mana: 21, cd: 5, type: 'proj', dmgMult: 1.05, speed: 15, color: 0x66ffee, size: 1.3, vis: 'orb', bounce: 4 },
  lifeward:   { name: 'Life Ward', icon: '', mana: 36, cd: 16, type: 'ward', frac: 0.07, radius: 6, dur: 8, tick: 1.0 },
  // universal
  bonewall:   { name: 'Bone Wall', icon: '', mana: 24, cd: 12, type: 'wall', dur: 10, range: 12 },
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
// ONE armory, no class gates: a trooper picks up whatever the hulk drops.
// `ranged` shoots cells; `cast: true` burns energy instead (weapon carries its
// own bolt look + energy cost). Melee entries define their own swing feel.
export const WEAPON_TYPES = {
  trooper: [
    // blades & mauls
    { id: 'arcblade', noun: 'Arc-Blade', mesh: [], held: 'arcblade', model: 'arcblade', verb: 'slash', sigPool: ['radiantbeam', 'frostwave'] },
    { id: 'monokatana', noun: 'Mono-Katana', mesh: [], held: 'monoedge', model: 'monoedge', verb: 'slash', dmgBonus: 1.1, critAdd: 0.04, sigPool: ['shadowflurry', 'dragonsbreath'] },
    { id: 'vibropair', noun: 'Vibro-Blades', mesh: [], held: 'vibro', held2: true, model: 'vibro', verb: 'stab', dmgBonus: 0.85, atkTime: 0.42, critAdd: 0.08, sigPool: ['shadowflurry', 'frostwave'] },
    { id: 'plasrend', noun: 'Plas-Render', mesh: [], held: 'plasrend', model: 'plasrend', verb: 'cleave', dmgBonus: 1.45, atkTime: 1.1, sigPool: ['earthsplitter', 'thunderclap'] },
    { id: 'breachmaul', noun: 'Breach Maul', mesh: [], held: 'breachmaul', model: 'breachmaul', verb: 'smash', dmgBonus: 1.35, atkTime: 1.05, stunHit: 0.4, sigPool: ['thunderclap', 'earthsplitter'] },
    { id: 'phasepike', noun: 'Phase Pike', mesh: [], held: 'phasepike', model: 'phasepike', verb: 'stab', dmgBonus: 1.05, rangeAdd: 1.3, sigPool: ['frostwave', 'radiantbeam'] },
    { id: 'monoscythe', noun: 'Salvage Scythe', mesh: [], held: 'monoscythe', model: 'monoscythe', verb: 'sweep', dmgBonus: 1.15, arcAdd: 0.5, rangeAdd: 0.6, sigPool: ['lifedrain', 'dragonsbreath'], minRarity: 1 },
    { id: 'ghostfangs', noun: 'Ghost Fangs', mesh: [], held: 'vibro', held2: true, model: 'vibro', verb: 'stab', dmgBonus: 1.0, atkTime: 0.45, critAdd: 0.12, minRarity: 2, sigPool: ['shadowflurry', 'lifedrain'] },
    // guns (spend cells)
    { id: 'sidearm', noun: 'Pulse Sidearm', mesh: [], model: 'blaster-a', verb: 'shoot', ranged: true, dmgBonus: 0.85, atkTime: 0.55, sigPool: ['radiantbeam', 'dragonsbreath'] },
    { id: 'pulsecarbine', noun: 'Pulse Carbine', mesh: ['AK'], model: 'blaster-d', verb: 'shoot', ranged: true, sigPool: ['arrowstorm', 'frostwave'] },
    { id: 'longlas', noun: 'Long-Las', mesh: ['Sniper'], model: 'blaster-e', verb: 'shoot', ranged: true, dmgBonus: 1.4, atkTime: 1.2, critAdd: 0.08, sigPool: ['arrowstorm', 'thunderclap'] },
    { id: 'needler', noun: 'Needler', mesh: ['SMG'], model: 'blaster-j', verb: 'shoot', ranged: true, dmgBonus: 0.8, atkTime: 0.45, sigPool: ['arrowstorm', 'frostwave'] },
    { id: 'scattergun', noun: 'Scattergun', mesh: ['Shotgun'], model: 'blaster-g', verb: 'shoot', ranged: true, dmgBonus: 1.35, atkTime: 1.2, sigPool: ['firenova', 'earthsplitter'] },
    { id: 'marauder', noun: 'Marauder Rifle', mesh: ['Sniper_2'], model: 'blaster-f', verb: 'shoot', ranged: true, dmgBonus: 1.2, atkTime: 1.0, critAdd: 0.06, minRarity: 2, sigPool: ['radiantbeam', 'arrowstorm'] },
    // projectors (spend energy — a dry tank fires sparks)
    { id: 'arcprojector', noun: 'Arc Projector', mesh: [], model: 'blaster-h', verb: 'cast', cast: true, manaAttack: 0.2, boltVis: 'laser', boltColor: 0x55ddff, dmgBonus: 1.35, sigPool: ['voidrip', 'frostwave'] },
    { id: 'fluxcaster', noun: 'Flux Caster', mesh: [], model: 'blaster-k', verb: 'cast', cast: true, manaAttack: 0.12, boltVis: 'laser', boltColor: 0xbb88ff, dmgBonus: 0.95, atkTime: 0.4, sigPool: ['voidrip', 'dragonsbreath'] },
    { id: 'gravtool', noun: 'Grav Inductor', mesh: [], model: 'blaster-r', verb: 'cast', cast: true, manaAttack: 0.18, boltVis: 'wisp', boltColor: 0x77ff88, dmgBonus: 1.3, atkTime: 0.65, lifestealAdd: 0.05, sigPool: ['lifedrain', 'voidrip'] },
    { id: 'coolantlance', noun: 'Coolant Lance', mesh: [], model: 'blaster-b', verb: 'cast', cast: true, manaAttack: 0.15, boltVis: 'laser', boltColor: 0x88d4ff, dmgBonus: 1.1, atkTime: 0.5, manaRegenAdd: 1.5, sigPool: ['frostwave', 'voidrip'], minRarity: 1 },
    { id: 'nanoseeder', noun: 'Nano-Seeder', mesh: [], model: 'blaster-c', verb: 'cast', cast: true, manaAttack: 0.16, boltVis: 'wisp', boltColor: 0x77ff88, dmgBonus: 1.25, lifestealAdd: 0.05, sigPool: ['lifedrain', 'voidrip'] },
  ],
};

// ---------------- weapon signature powers ----------------
// Rare+ weapons can roll one: landing basic hits builds charge; at full charge
// the weapon glows and key 4 unleashes it (costing mana + the charge).
export const SIGNATURES = {
  radiantbeam:   { name: 'Lance Array', icon: '', mana: 20, hits: 8, desc: 'a piercing energy lance burns through everything in a line' },
  firenova:      { name: 'Core Burst', icon: '', mana: 22, hits: 9, desc: 'your power core vents — plasma ignites the pack around you' },
  thunderclap:   { name: 'Concussion Pulse', icon: '', mana: 22, hits: 9, desc: 'a stunning shockwave slams outward from your frame' },
  voidrip:       { name: 'Singularity', icon: '', mana: 25, hits: 10, desc: 'collapse a hungry gravity well at your crosshair' },
  lifedrain:     { name: 'Leech Field', icon: '', mana: 18, hits: 8, desc: 'siphon power from every hostile near you' },
  arrowstorm:    { name: 'Full Auto', icon: '', mana: 20, hits: 8, desc: 'a fan of seven bolts in one trigger pull' },
  frostwave:     { name: 'Cryo Sweep', icon: '', mana: 20, hits: 8, desc: 'a coolant flood that chills all it touches' },
  shadowflurry:  { name: 'Ghost Protocol', icon: '', mana: 22, hits: 9, desc: 'phase-skip between the three nearest hostiles, striking each' },
  earthsplitter: { name: 'Seismic Line', icon: '', mana: 24, hits: 10, desc: 'a rupturing line of deck plating ahead of you' },
  dragonsbreath: { name: 'Promethium Burn', icon: '', mana: 24, hits: 10, desc: 'a cone of promethium fire that keeps burning' },
};
// classless: the offhand ROLL decides its own flavor (plate, blade, or core)
export const OFFHAND_TYPES = {
  trooper: { noun: 'Riot Plate', meshes: [], models: ['riotplate'], stat: 'armor' },
};
// EXOTIC gear: equippable tech that GRANTS an ability into your 1-3 slots.
// The old spellbook, reborn as hardware — nothing medieval survives.
export const EXOTICS = [
  { id: 'gravtether', name: 'Grav Tether', grant: 'gravitylash', desc: 'grants GRAV LASH: fire a gravity line, reel and swing' },
  { id: 'blinkmodule', name: 'Blink Module', grant: 'shadowstep', desc: 'grants BLINK: short-range teleport' },
  { id: 'ricomatrix', name: 'Ricochet Matrix', grant: 'ricochet', desc: 'grants RICOCHET ORB: a bolt that bounces off bulkheads' },
  { id: 'stasisproj', name: 'Stasis Projector', grant: 'chronobubble', desc: 'grants STASIS FIELD: freeze hostiles in a bubble' },
  { id: 'decoyemitter', name: 'Decoy Emitter', grant: 'decoy', desc: 'grants HOLO DOUBLE: a dummy frame that draws fire' },
  { id: 'arcsnare', name: 'Arc Snare', grant: 'beartrap', desc: 'grants ARC SNARE: a trap that roots what steps in' },
  { id: 'smokevent', name: 'Smoke Vent', grant: 'smokebomb', desc: 'grants SMOKE VENT: a blinding, stunning cloud' },
  { id: 'gravboots', name: 'Grav Boots', grant: 'levitate', desc: 'grants LEVITATE: glide above the deck plates' },
  { id: 'aegisdome', name: 'Aegis Dome', grant: 'sanctuary', desc: 'grants AEGIS DOME: a shelter hostiles cannot enter' },
  { id: 'stormcoil', name: 'Storm Coil', grant: 'stormlance', desc: 'grants STORM LANCE: a forking lightning strike' },
];

export const OFFHAND_ROLLS = [
  { noun: 'Riot Plate', models: ['riotplate'], stat: 'armor' },
  { noun: 'Holdout Blade', models: ['vibro'], stat: 'crit' },
  { noun: 'Capacitor Cell', models: ['blaster-b'], stat: 'mregen' },
];

export const NAME_PREFIX = {
  common: ['Rusty', 'Salvaged', 'Surplus', 'Dented'],
  fine: ['Tuned', 'Milspec', 'Keen', 'Balanced'],
  rare: ['Cruel', 'Overclocked', 'Etched', 'Vicious'],
  epic: ['Voidwrought', 'Cryoforged', 'Sinister', 'Hullbane'],
  legendary: ['Wardenbane', 'Doomforged', 'Eternal', 'Tyrant’s'],
};
export const NAME_SUFFIX = ['', '', 'of Embers', 'of the Hold', 'of the Core', 'of the Deep Void', 'of Echoes', 'of the Fallen Fleet'];
export const TRINKET_NAMES = ['Ring', 'Amulet', 'Charm', 'Talisman', 'Signet'];
export const TRINKET_STATS = [
  { stat: 'crit', min: 4, max: 12, label: '% crit chance', icon: '' },
  { stat: 'speed', min: 0.3, max: 0.9, label: ' move speed', icon: '' },
  { stat: 'hp', min: 12, max: 40, label: ' max HP', icon: '' },
  { stat: 'mregen', min: 1, max: 3, label: ' mana/s', icon: '' },
  { stat: 'armor', min: 4, max: 12, label: '% damage reduction', icon: '' },
];

// ---------------- enemies ----------------
// animation-name maps for the Quaternius monster rigs (KayKit rigs use defaults)
const QA = 'CharacterArmature|';
// sci-fi rigs (no armature prefix on their clips)
export const ANIM_ROBOT = { idle: 'Idle', walk: 'Walking', run: 'Running', attack: ['Punch'], hit: 'No', death: 'Death' };
export const ANIM_MECH = { idle: 'Idle', walk: 'Walk', run: 'Run', attack: ['Kick', 'Punch', 'SwordSlash'], hit: 'HitRecieve_1', death: 'Death' };
export const ANIM_TROOP = { idle: 'Idle', walk: 'Walk', run: 'Run_Gun', attack: ['Idle_Shoot', 'Punch'], hit: 'HitReact', death: 'Death' };
// cyberpunk kit (QA-prefixed clips; the flyer says 'Dead', the rest 'Death')
export const ANIM_CYBER = { idle: QA + 'Idle', walk: QA + 'Walk', run: QA + 'Run', attack: [QA + 'Attack', QA + 'Attack.001'], hit: QA + 'Jump', death: QA + 'Death' };
export const ANIM_CYBERFLY = { idle: QA + 'Idle', walk: QA + 'Run', run: QA + 'Run', attack: [QA + 'Attack', QA + 'Shoot'], hit: QA + 'Idle', death: QA + 'Dead' };
export const ANIM_CYBERHERO = { idle: QA + 'Idle_Sword', walk: QA + 'Walk', run: QA + 'Run', attack: [QA + 'Sword_Slash', QA + 'Kick_Right'], hit: QA + 'HitRecieve', death: QA + 'Death' };
export const ANIM_HUSK = { idle: 'Idle', walk: 'Walk', run: 'Run', attack: ['Punch'], hit: 'HitReact', death: 'Death' };
export const ANIM_VOID = { idle: 'Flying_Idle', walk: 'Fast_Flying', run: 'Fast_Flying', attack: ['Headbutt', 'Punch'], hit: 'HitReact', death: 'Death' };
export const ANIM_GROUND = { idle: QA + 'Idle', walk: QA + 'Walk', run: QA + 'Run', attack: [QA + 'Punch', QA + 'Weapon'], hit: QA + 'HitReact', death: QA + 'Death' };
export const ANIM_CRITTER = { idle: QA + 'Idle', walk: QA + 'Walk', run: QA + 'Walk', attack: [QA + 'Bite_Front'], hit: QA + 'HitRecieve', death: QA + 'Death' };
export const ANIM_FLYER = { idle: QA + 'Flying_Idle', walk: QA + 'Fast_Flying', run: QA + 'Fast_Flying', attack: [QA + 'Headbutt', QA + 'Punch'], hit: QA + 'HitReact', death: QA + 'Death' };
export const ENEMIES = {
  // ---- the hulk's machine crew (RobotExpressive family: one rig, many frames) ----
  minion:   { name: 'Scrap Drone', model: 'RobotExpressive', animMap: 'robot', hp: 32, dmg: 9,  speed: 4.8, range: 2.2, xp: 12, gold: [2, 7],  attackTime: 0.9, aggro: 11, scale: 0.42, paint: 0x4aa8ff },
  rogue:    { name: 'Scuttle Unit', model: 'RobotExpressive', animMap: 'robot', hp: 26, dmg: 7,  speed: 6.6, range: 2.1, xp: 15, gold: [3, 8],  attackTime: 0.7, aggro: 13, scale: 0.36, paint: 0x2fe8d0 },
  warrior:  { name: 'Warframe', model: 'Cyber_Enemy_2Legs_Gun', animMap: 'cyber', hp: 62, dmg: 12, speed: 3.9, range: 12, xp: 24, gold: [5, 12], attackTime: 1.3, aggro: 12, scale: 2.0, ranged: true, boltVis: 'laser', boltColor: 0x7fffd0, boltSpeed: 27, muzzleY: 1.0 },
  bomber:   { name: 'Volatile Cell', model: 'RobotExpressive', animMap: 'robot', hp: 24, dmg: 22, speed: 6.6, range: 1.8, xp: 20, gold: [4, 9],  attackTime: 0.4, aggro: 13, scale: 0.34, paint: 0x8aff2e, explode: 3.6 },
  berserker:{ name: 'Feral Husk', model: 'Enemy_Large', animMap: 'husk', hp: 44, dmg: 11, speed: 5.6, range: 2.2, xp: 36, gold: [8, 16], attackTime: 0.55, aggro: 14, scale: 0.7, tint: 0xffb4a4, enrage: true },
  brute:    { name: 'Loader Frame', model: 'Cyber_Enemy_Large', animMap: 'cyber', hp: 55, dmg: 15, speed: 4.0, range: 2.4, xp: 30, gold: [7, 14], attackTime: 1.1, aggro: 11, scale: 2.1, kbHit: 7 },
  goblin:   { name: 'Scuttle Swarm', model: 'RobotExpressive', animMap: 'robot', hp: 20, dmg: 6, speed: 6.8, range: 1.9, xp: 10, gold: [2, 5], attackTime: 0.7, aggro: 13, scale: 0.28, paint: 0xd6ff2e, trio: true },
  orcwar:   { name: 'Vault Scavenger', model: 'Character_Hazmat', animMap: 'troop', show: ['Shovel'], hp: 55, dmg: 13, speed: 5.2, range: 2.4, xp: 26, gold: [6, 12], attackTime: 0.95, aggro: 12, scale: 0.85 },
  // ---- the scavenger crews still living aboard (toon-shooter rigs, guns baked in) ----
  mage:     { name: 'Hull Raider', model: 'Character_Enemy', animMap: 'troop', show: ['AK'], hp: 38, dmg: 11, speed: 3.6, range: 14,  xp: 26, gold: [6, 12], attackTime: 1.4, aggro: 15, scale: 0.85, ranged: true, boltVis: 'laser', boltColor: 0xff5533, boltSpeed: 30 },
  frostmage:{ name: 'Cryo Raider', model: 'Character_Enemy', animMap: 'troop', show: ['ShortCannon'], hp: 40, dmg: 9,  speed: 3.4, range: 14,  xp: 30, gold: [7, 14], attackTime: 1.5, aggro: 15, scale: 0.85, ranged: true, slowBolt: true, boltVis: 'laser', boltColor: 0x77ddff, boltSpeed: 28 },
  sniper:   { name: 'Marksman Unit', model: 'Character_Enemy', animMap: 'troop', show: ['Sniper'], hp: 26, dmg: 13, speed: 4.5, range: 18,  xp: 34, gold: [8, 15], attackTime: 1.7, aggro: 20, scale: 0.85, ranged: true, boltSpeed: 34, boltVis: 'laser', boltColor: 0xffe14d },
  // ---- corrupted holograms: the ship remembers its crew ----
  ghost:    { name: 'Echo', model: 'Astronaut_RaeTheRedPanda', animMap: 'troop', hp: 34, dmg: 13, speed: 3.1, range: 2.0, xp: 32, gold: [8, 15], attackTime: 0.9, aggro: 17, scale: 0.62, ghost: true },
  shade:    { name: 'Phantom Signal', model: 'Character_Enemy', animMap: 'troop', show: ['Knife_1'], hp: 28, dmg: 10, speed: 5.4, range: 2.0, xp: 34, gold: [8, 16], attackTime: 0.6, aggro: 18, scale: 0.85, ghost: true },
  // ---- fabrication: the hulk prints its own defenders ----
  necromancer: { name: 'Fabricator Unit', model: 'Leela', animMap: 'mech', hp: 46, dmg: 10, speed: 3.2, range: 13, xp: 42, gold: [10, 20], attackTime: 1.5, aggro: 15, scale: 0.5, ranged: true, tint: 0xddaaff, boltVis: 'laser', boltColor: 0xbb66ff, boltSpeed: 26, summons: true, summonEvery: 12, summonType: 'minion', summonCount: 1 },
  plaguebearer:{ name: 'Blight Drifter', model: 'Enemy_Flying', animMap: 'void', hp: 38, dmg: 8, speed: 4.4, range: 2.2, xp: 38, gold: [9, 17], attackTime: 0.95, aggro: 12, scale: 0.6, fly: true, tint: 0xa8e090, plague: { dps: 4, dur: 4 }, deathCloud: 3.2 },
  juggernaut:{ name: 'Siegewalker', model: 'Mike', animMap: 'mech', hp: 120, dmg: 18, speed: 2.7, range: 2.6, xp: 55, gold: [14, 26], attackTime: 1.3, aggro: 10, scale: 0.55, tint: 0xb8b8cc, stalwart: true },
  ogre:     { name: 'Wrecking Frame', model: 'Stan', animMap: 'mech', hp: 140, dmg: 24, speed: 3.4, range: 2.9, xp: 60, gold: [15, 28], attackTime: 1.5, aggro: 11, scale: 0.58, stalwart: true, kbHit: 8 },
  // ---- void vermin: what got in through the breaches ----
  imp:      { name: 'Gun Drone', model: 'Cyber_Enemy_Flying_Gun', animMap: 'cyberfly', hp: 30, dmg: 10, speed: 5.5, range: 9, xp: 28, gold: [7, 13], attackTime: 1.3, aggro: 15, scale: 1.7, fly: true, ranged: true, boltVis: 'laser', boltColor: 0x88ccff, boltSpeed: 26, muzzleY: 0.5 },
  slime:    { name: 'Nanite Mass', model: 'Slime', animMap: 'critter', hp: 40, dmg: 8, speed: 3.4, range: 2.0, xp: 24, gold: [5, 10], attackTime: 1.0, aggro: 11, scale: 0.7, tint: 0xa8fff0, splitInto: 'slimelet' },
  slimelet: { name: 'Nanite Glob', model: 'Slime', animMap: 'critter', hp: 14, dmg: 5, speed: 5.4, range: 1.7, xp: 8, gold: [1, 3], attackTime: 0.8, aggro: 14, scale: 0.4, tint: 0xd0fff6 },
  glub:     { name: 'Void Drifter', model: 'Enemy_Flying', animMap: 'void', hp: 34, dmg: 11, speed: 4.6, range: 2.2, xp: 30, gold: [8, 14], attackTime: 1.0, aggro: 15, scale: 0.55, fly: true },
  drake:    { name: 'Plasma Wraith', model: 'Enemy_Flying', animMap: 'void', hp: 90, dmg: 18, speed: 6.0, range: 10, xp: 70, gold: [20, 35], attackTime: 1.4, aggro: 18, scale: 0.85, fly: true, ranged: true, tint: 0xffb0a0, boltVis: 'fireball', boltSpeed: 22 },
  // bosses (deck 3/6 rolls one archetype; deck 9 is still the old god below)
  boss:     { model: 'George', animMap: 'mech', hp: 380, dmg: 22, speed: 4.6, range: 3.4, xp: 170, gold: [60, 90], attackTime: 1.1, aggro: 30, scale: 0.62, boss: true, bossName: 'THE HULK WARDEN', stalwart: true },
  necrolord:{ model: 'Leela', animMap: 'mech', hp: 300, dmg: 18, speed: 3.8, range: 15, xp: 180, gold: [60, 95], attackTime: 1.3, aggro: 30, scale: 0.68, boss: true, ranged: true, tint: 0xddaaff, boltVis: 'laser', boltColor: 0xbb66ff, boltSpeed: 28, summons: true, summonEvery: 8, summonType: 'minion', summonCount: 2, bossName: 'FABRICATOR PRIME', bossMsg: 'prints fresh frames' },
  reaper:   { model: 'Cyber_Character', animMap: 'cyberhero', hp: 320, dmg: 20, speed: 6.8, range: 2.8, xp: 180, gold: [60, 95], attackTime: 0.6, aggro: 32, scale: 2.3, boss: true, ghost: true, bossName: 'THE SILENT PROTOCOL' },
  boneking: { model: 'George', animMap: 'mech', hp: 620, dmg: 26, speed: 4.2, range: 16,  xp: 420, gold: [150, 220], attackTime: 1.3, aggro: 40, scale: 0.8, ranged: true, boltVis: 'laser', boltColor: 0xff3322, boltSpeed: 30, boss: true, summons: true, summonEvery: 9, summonType: 'minion', summonCount: 2, tint: 0xffb8a8, bossName: 'THE FOUNDRY TYRANT' },
  mushking: { model: 'Enemy_Small', animMap: 'void', fly: true, hp: 350, dmg: 20, speed: 4.6, range: 3.0, xp: 190, gold: [70, 100], attackTime: 1.2, aggro: 30, scale: 1.5, boss: true, stalwart: true, tint: 0x9fe8d8, summons: true, summonEvery: 10, summonType: 'slimelet', summonCount: 3, bossName: 'THE NANITE HIVE', bossMsg: 'sheds nanite globs' },
  // deck 9: the old god of the reactor — still the dragon, pending its own rebuild
  // solidR = her TORSO: you must walk around it. bodyR (4.5) is her whole reach,
  // wings and tail included — those you can duck under.
  dragon:   { model: 'proc', hp: 2400, dmg: 24, speed: 5.5, range: 30, xp: 900, gold: [340, 480], attackTime: 1.2, aggro: 55, scale: 1.7, bodyR: 4.5, solidR: 2.2, procDragon: true, boss: true, dragon: true, stalwart: true, bossName: 'EMBERWING THE UNDYING' },
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
    id: 'crypt', name: 'The Crypts', fog: 0x141024, density: 0.018,
    hemi: 0xd0b9fe, amb: 0x9484c0, torch: 0xffb066,
    tiles: ['floor_tile_large', 'floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_decorated', 'floor_tile_small_broken_B'],
    props: ['barrel_large', 'box_large', 'crates_stacked', 'table_medium', 'shelf_small'],
    banners: ['banner_patternA_red', 'banner_patternA_blue'],
    bias: [],
  },
  {
    id: 'cellars', name: 'The Rotten Cellars', fog: 0x24180c, density: 0.019,
    hemi: 0xffd0a2, amb: 0xaa8866, torch: 0xffc080,
    tiles: ['floor_wood_large', 'floor_wood_large', 'floor_wood_small', 'floor_wood_large_dark', 'floor_wood_small_dark'],
    props: ['barrel_large', 'barrel_small', 'crates_stacked', 'box_large', 'box_small', 'table_medium'],
    banners: ['banner_patternA_red'],
    bias: ['rogue', 'berserker', 'goblin', 'goblin', 'orcwar'],
  },
  {
    id: 'drowned', name: 'The Drowned Deep', fog: 0x0c2420, density: 0.022,
    hemi: 0x9bf3dd, amb: 0x5e9488, torch: 0xaaffcc,
    tiles: ['floor_tile_large', 'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_small_weeds_A', 'floor_tile_large_rocks'],
    props: ['barrel_large', 'box_small', 'shelf_small'],
    banners: ['banner_patternA_blue'],
    bias: ['ghost', 'plaguebearer', 'slime', 'slime', 'glub'],
  },
  {
    id: 'ossuary', name: 'The Silent Ossuary', fog: 0x282434, density: 0.016,
    hemi: 0xeaeafe, amb: 0xaaaacc, torch: 0xffe0aa,
    tiles: ['floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_decorated'],
    props: ['table_medium', 'shelf_small', 'chair'],
    banners: ['banner_patternA_blue'],
    bias: ['ghost', 'ghost', 'shade', 'necromancer'],
  },
  {
    id: 'forge', name: 'The Ember Forge', fog: 0x2c1008, density: 0.020,
    hemi: 0xff946a, amb: 0xaa4422, torch: 0xff6633,
    tiles: ['floor_tile_large', 'floor_tile_large_rocks', 'floor_dirt_large_rocky', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B'],
    props: ['crates_stacked', 'box_large', 'barrel_large'],
    banners: ['banner_patternA_red'],
    bias: ['bomber', 'berserker', 'imp', 'imp', 'ogre'],
  },
  {
    id: 'frozen', name: 'The Frostbound Halls', fog: 0x142030, density: 0.018,
    hemi: 0x9cc3fe, amb: 0x6688cc, torch: 0x99ccff,
    tiles: ['floor_tile_large', 'floor_tile_large', 'floor_tile_small_broken_A', 'floor_tile_small_decorated'],
    props: ['box_large', 'crates_stacked', 'shelf_small'],
    banners: ['banner_patternA_blue'],
    bias: ['frostmage', 'frostmage', 'juggernaut', 'sniper'],
  },
  {
    id: 'warrens', name: 'The Rat Warrens', fog: 0x18140c, density: 0.021,
    hemi: 0xffe5b2, amb: 0x887654, torch: 0xffb066,
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
  { id: 'potion', icon: '', name: 'Combat Stim', desc: 'Restores 45% HP. Use with Q.', base: 25, grow: 6 },
  { id: 'atk', icon: '', name: 'Fire-Control Chip', desc: '+3 damage for this run.', base: 40, grow: 22 },
  { id: 'hp', icon: '', name: 'Dermal Plating', desc: '+20 max HP and heal 20.', base: 40, grow: 22 },
  { id: 'relic', icon: '', name: 'Sealed Requisition', desc: 'A random implant. Rarity scales with depth.', base: 70, grow: 25 },
  { id: 'tome', icon: '', name: 'Firmware Patch', desc: 'Replace one of your abilities with another from your kit.', base: 55, grow: 20 },
  { id: 'reforge', icon: '', name: 'Refit Weapon', desc: 'A brand-new random weapon for your class.', base: 60, grow: 18 },
  { id: 'offhand', icon: '', name: 'Fabricate Offhand', desc: 'A random offhand item for your class.', base: 45, grow: 15 },
  { id: 'merc', icon: '', name: 'Hire Trooper', desc: 'A blade or rifle trooper fights beside you until slain.', base: 120, grow: 60 },
  { id: 'arrows', icon: '', name: 'Cell Magazine', desc: '+25 cells for your guns.', base: 20, grow: 0 },
];

// which building sells what (the old floor-merchant is gone — shop in town)
export const SHOP_TABLES = {
  blacksmith: { title: 'The Armory', greet: '“Firepower solves most problems.”', items: ['atk', 'reforge', 'offhand', 'arrows'] },
  alchemist: { title: 'The Med Station', greet: '“Inject it. Probably not coolant.”', items: ['potion', 'hp'] },
  arcanum: { title: 'Requisitions', greet: '“Exotic hardware has a price.”', items: ['relic', 'potion'] },
  tavern: { title: 'The Crew Deck', greet: '“Guns for hire, rations for sale.”', items: ['merc', 'potion', 'arrows'] },
  armory: { title: 'THE ARMORY', greet: 'Cleared sectors pay for better hardware. Rolls scale with your deepest clear.', items: ['reforge', 'offhand', 'relic', 'arrows', 'potion', 'hp', 'atk'] },
};

// Weapon-ish meshes we hide by default; equipment then re-shows its kit.
export const WEAPON_MESHES = [
  'Pistol', // Ultimate Space Kit astronauts carry a toggleable sidearm mesh
  // Toon-shooter rigs ship a WHOLE ARSENAL parented to the right hand — all
  // visible unless hidden here. (This was the sword+gun+launcher overlap.)
  'AK', 'GrenadeLauncher', 'Knife_1', 'Knife_2', 'Revolver', 'Revolver_Small',
  'RocketLauncher', 'ShortCannon', 'Shotgun', 'Shovel', 'SMG', 'Sniper', 'Sniper_2',
  '1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield',
  '1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Barbarian_Round_Shield', 'Mug',
  'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff',
  'Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable',
  // Cyber_Character's built-in mono-katana (the Ronin's default kit; an
  // equipped held model hides it)
  'Sword_1', 'Sword_2', 'Sword_3', 'Sword_4',
];

export const CAPE_COLORS = [
  { name: 'Crimson', hex: 0xb03030 }, { name: 'Royal Blue', hex: 0x3355bb }, { name: 'Forest', hex: 0x2f7d3a },
  { name: 'Violet', hex: 0x7a3fd0 }, { name: 'Gold', hex: 0xcc9922 }, { name: 'Ash', hex: 0x666677 },
];

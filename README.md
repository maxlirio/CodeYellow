# CodeOrange — Wrath of Emberwing

A 3D co-op dungeon crawler that runs entirely in the browser. No build step, no backend.

**Play it: https://maxlirio.github.io/CodeOrange/**

![genre](https://img.shields.io/badge/genre-dungeon%20crawler-orange) ![stack](https://img.shields.io/badge/three.js-r165-blue) ![mp](https://img.shields.io/badge/co--op-PeerJS-purple)

## The game

A **first-person roguelike** crawl through 9 procedurally generated floors — slay **Emberwing the Undying**, the dragon on floor 9. She fights like a D&D dragon — a colossal grounded beast that prowls with real weight (she turns slowly: flank her!), swipes with her claws, coils and LUNGES, whips her tail at anyone dancing behind her, buffets the crowd off her chest with her wings, and rears up to rake a sweeping cone of dragonfire across the hall. She takes wing only with purpose — at health thresholds, or when melee punishes her too hard — strafes the floor with fire, then crashes down in a landing slam. Threat-based targeting: hurt her and she remembers. Below a quarter health she enrages, summons imps, and rains meteors while airborne. Bosses guard floors 3, 6 and 9; the way down stays locked until they fall. After floor 9, keep going in endless mode. **Every floor rolls its own identity**, so no two runs feel alike.

You start above ground in **Emberlight Village** — a real walled village — timber-and-plaster houses with roofs, a barrel-shaped tavern, a windmill, pine trees, market stalls, a well, lantern-lit dirt paths — with four shops you enter through their doors, each staffed by a uniquely-skinned keeper. Every staircase offers a choice: press deeper, or **return to town** to spend your gold. The tavern's notice board lists **public games** you can join with one click — and hosts can list theirs (peer-to-peer, no backend: the first tavern visitor's tab serves the board).

**Two game modes**: the ⚔ **Campaign** above, or 🏰 **Last Stand** — an arena horde mode where waves pour through four gates, you build destructible barricades (B), hire sellsword/marksman mercenaries (H) who fight beside you, and see how many waves you survive.

You can *see* yourself fight now — your equipped weapon is in-hand Minecraft-style with slash/recoil/cast animations, walk bob, and mouse sway. Dungeons also grew **swinging ropes** (grab with E, pump with W, release with Space to fly), a **Bone Wall** spell every class can roll (raise a wall so monsters can't get you), and traps are now **pressure plates** — a click, a beat, then spikes: dodge off in time.

- **7 floor themes** — the Crypts, Rotten Cellars, Drowned Deep, Silent Ossuary, Ember Forge, Frostbound Halls, Rat Warrens: each with its own fog, lighting, torch color, floor tiles, props, and monster mix
- **4 layout generators** — classic rooms & corridors, cramped trap-riddled warrens, organic caverns grown by cellular automata, and vast pillared great halls
- **Floor mutators** — INFESTED, CURSED, TREASURE VAULT, HAUNTED, SWIFT DEATH, PITCH DARK: random modifiers announced as you descend
- **6 classes with deep spell schools, dealt 3 per run** — your loadout is random every run (30 spells: fireballs, meteors called onto your crosshair, chain lightning, **Storm Lance** (a forked bolt ripping from your staff), **Mirror Legion** (spectral copies of yourself that fight beside you), **Gravity Well** (a vortex that drags the pack into a heap), **Ricochet Orb** (bounces off walls down corridors), **Life Ward** (a crystal that pulses party-wide healing), piercing arcane orbs, blizzards, whirlwinds, savage leaps, smoke bombs, death marks…). The merchant's Spell Tome rerolls a slot mid-run.
- **30 weapon archetypes with SIGNATURE powers** — claymores, warhammers, reaper scythes, spears, twin fangs, skull staves, crystal scepters, dreadbows, grave crossbows and more (Quaternius + KayKit models, every archetype swings differently). Rare+ weapons can roll a **signature**: land hits to charge it, the weapon **glows**, then key **4** unleashes it — Radiant Beam, Fire Nova, Thunderclap, Void Rip, Life Drain, Arrow Storm, Frost Wave, Shadow Flurry, Earthsplitter, Dragon's Breath.
- **Exotic spells, not just projectiles** — Gravity Lash (lash yourself to a wall and fight from your perch), Chrono Bubble (freeze time in a dome), Shadow Swap (blink behind your mark), Frost Prison, Steel Traps, a Straw Double decoy, True Sight through walls, Levitation, Ember Trail, Sanctuary.
- **The Necromancer is a skeleton who refused to stay down** — green soul bolts, **Raise Dead** (a standing squad of up to four Risen swordsmen who fight in formation and scout ahead), **Dominate** (turn a monster against its own pack), **Soul Harvest**, **Blood Pact** (pay HP for mana), and **Death Coil**.
- **Warriors don't cast — they ERUPT**: Knight and Barbarian have physical power-up abilities instead of magic (Charge, War Banner, Chain Hook, Sunder Stomp, Executioner's Arc that triples damage on wounded foes).
- **Change ventures mid-run** — the **Wayfarer Post** in the tavern (or the pause menu) switches between Campaign, Last Stand and Duel **without losing your character**: gold, gear, bag, potions, levels and campaign progress all travel with you. In co-op the host switches everyone together.
- **First-person combat** — crosshair that flares on targets, **Shift to aim** (FOV zoom, steadier shots), dodge dash with i-frames, hit markers, crits, knockback, slows, poison, burns
- **Verticality** — climbable staircases lead to railed platforms, central islands with twin stairs, and wall balconies where skeleton archers guard treasure
- **26 monster types** — the skeleton legion (minions, rogues, warriors, mages, exploding bombers, frost mages, ghosts, dark shades, necromancers that raise the dead mid-fight, berserkers, juggernauts, plaguebearers, snipers, brutes) plus a living bestiary: **goblins** that hunt in packs of three, **orc warriors**, **ogres** whose club sends you flying, fire-spitting **imps** and **drakes** on the wing, gliding **glubs**, and **slimes** that split when killed — mid-boss floors roll the Gravebound Champion, the Necrolord, the Pale Reaper, the Mycelic King (a spore-spawning mushroom tyrant), or the Bone King
- **Equipment & inventory (Tab)** — weapon / offhand / two trinket slots plus a 12-slot bag. Drops in 5 rarity tiers with **affixes** (Flaming, Frostbound, Vampiric, Swift, Brutal). Rogues can find **crossbows** that turn their basic attack ranged; mages can find fast-casting wands. Right-click to salvage for gold.
- **Appearance customization** — helmet/hood and cape toggles plus six cape colors, with a live 3D preview in the menu; your look syncs to co-op teammates
- **Loot & economy** — coins, chests, potions, a locked golden chest per floor (find the key), equipment drops from elites/bosses, and the Bone Merchant between floors
- **Progression** — XP levels, upgrades, escalating difficulty per floor
- **Co-op multiplayer (up to 4)** — host gets a 5-letter room code, friends join with it. Peer-to-peer via PeerJS, host-authoritative, shared dungeon seed. Fallen players respawn while a teammate lives. **Descending is personal**: race ahead and leave your teammates behind — everyone can be on a different floor, the party bar shows where each player is, and arriving on a floor a teammate already cleared shows its true state (opened chests, slain skeletons, unlocked boss gates).
- **Procedural audio** — every sound is synthesized with WebAudio; no audio files

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| M | Music on/off |
| Mouse | Look (click canvas to capture) |
| Left click / F | Attack |
| Shift | Aim (zoom + accuracy) |
| 1 / 2 / 3 | Cast spells |
| Space | Dodge dash (i-frames) |
| E | Open chest / take item / descend |
| Q | Drink potion |
| Tab | Inventory & equipment |
| M | Mute |
| Esc | Pause |

## Run locally

Any static server works:

```sh
python3 -m http.server 8899
# open http://localhost:8899
```

Debug hooks: `?auto=1&seed=myseed` auto-starts a solo run with a fixed dungeon seed.

## Tech notes

- **three.js r165** (ES modules from CDN, import map) — no bundler
- Static dungeon geometry is merged per-material into a handful of draw calls (~90 total)
- Multiplayer: the room code *is* the host's PeerJS id (`code-orange-mx-<CODE>`), so no signaling backend is needed beyond PeerJS's free public broker
- Guests simulate nothing: the host owns enemies/loot; guests render snapshots and send inputs/damage events. Dungeons are identical on all peers via the shared seed.

## Credits

- **Models & animations:** [KayKit](https://kaylousberg.com) — Dungeon Remastered, Adventurers, and Skeletons packs (CC0)
- **Monsters & dragon:** [Quaternius](https://quaternius.com) — Ultimate Monsters pack (CC0)
- **Emberwing (boss dragon):** Black Dragon by [3DHaupt / Dennis Haupt](https://free3d.com/3d-model/black-dragon-rigged-and-game-ready-92023.html) (personal/non-commercial use)
- **Weapons:** [Quaternius](https://quaternius.com) — RPG Items & Medieval Weapons packs (CC0)
- **Music:** "Woodland Fantasy", "Dark Descent" & "Heroic Demise" by [Matthew Pablo](http://www.matthewpablo.com) (CC-BY 3.0, via OpenGameArt); "Crystal Cave" & "Battle Theme A" by [cynicmusic](https://cynicmusic.com) (CC0, via OpenGameArt)
- **Engine:** [three.js](https://threejs.org) · **Networking:** [PeerJS](https://peerjs.com)
- Built with Claude Code

# CodeOrange — Depths of the Bone King

A 3D co-op dungeon crawler that runs entirely in the browser. No build step, no backend.

**Play it: https://maxlirio.github.io/CodeOrange/**

![genre](https://img.shields.io/badge/genre-dungeon%20crawler-orange) ![stack](https://img.shields.io/badge/three.js-r165-blue) ![mp](https://img.shields.io/badge/co--op-PeerJS-purple)

## The game

A **first-person roguelike** crawl through 9 procedurally generated floors — destroy **the Bone King** on floor 9. Bosses guard floors 3, 6 and 9; the way down stays locked until they fall. After floor 9, keep going in endless mode. **Every floor rolls its own identity**, so no two runs feel alike.

You start above ground in **Emberlight Village** — a real walled village — timber-and-plaster houses with roofs, a barrel-shaped tavern, a windmill, pine trees, market stalls, a well, lantern-lit dirt paths — with four shops you enter through their doors, each staffed by a uniquely-skinned keeper. Every staircase offers a choice: press deeper, or **return to town** to spend your gold. The tavern's notice board lists **public games** you can join with one click — and hosts can list theirs (peer-to-peer, no backend: the first tavern visitor's tab serves the board).

**Two game modes**: the ⚔ **Campaign** above, or 🏰 **Last Stand** — an arena horde mode where waves pour through four gates, you build destructible barricades (B), hire sellsword/marksman mercenaries (H) who fight beside you, and see how many waves you survive.

You can *see* yourself fight now — your equipped weapon is in-hand Minecraft-style with slash/recoil/cast animations, walk bob, and mouse sway. Dungeons also grew **swinging ropes** (grab with E, pump with W, release with Space to fly), a **Bone Wall** spell every class can roll (raise a wall so monsters can't get you), and traps are now **pressure plates** — a click, a beat, then spikes: dodge off in time.

- **7 floor themes** — the Crypts, Rotten Cellars, Drowned Deep, Silent Ossuary, Ember Forge, Frostbound Halls, Rat Warrens: each with its own fog, lighting, torch color, floor tiles, props, and monster mix
- **4 layout generators** — classic rooms & corridors, cramped trap-riddled warrens, organic caverns grown by cellular automata, and vast pillared great halls
- **Floor mutators** — INFESTED, CURSED, TREASURE VAULT, HAUNTED, SWIFT DEATH, PITCH DARK: random modifiers announced as you descend
- **4 classes × 6-spell schools, dealt 3 per run** — your loadout is random every run (24 spells total: fireballs, meteors called onto your crosshair, chain lightning, piercing arcane orbs, blizzards, whirlwinds, savage leaps, smoke bombs, death marks, consecrated ground, bulwarks, bloodlust…). The merchant's Spell Tome rerolls a slot mid-run.
- **First-person combat** — crosshair that flares on targets, **Shift to aim** (FOV zoom, steadier shots), dodge dash with i-frames, hit markers, crits, knockback, slows, poison, burns
- **Verticality** — climbable staircases lead to railed platforms, central islands with twin stairs, and wall balconies where skeleton archers guard treasure
- **17 monster types** — minions, rogues, warriors, mages, exploding bombers, frost mages, ghosts, dark shades, necromancers that raise the dead mid-fight, berserkers that frenzy at low HP, unstoppable juggernauts, plaguebearers that burst into poison clouds, snipers, brutes, elite champions — and boss floors roll the Gravebound Champion, the Necrolord, or the Pale Reaper
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
- **Engine:** [three.js](https://threejs.org) · **Networking:** [PeerJS](https://peerjs.com)
- Built with Claude Code

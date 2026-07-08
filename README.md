# CodeOrange — Depths of the Bone King

A 3D co-op dungeon crawler that runs entirely in the browser. No build step, no backend.

**Play it: https://maxlirio.github.io/CodeOrange/**

![genre](https://img.shields.io/badge/genre-dungeon%20crawler-orange) ![stack](https://img.shields.io/badge/three.js-r165-blue) ![mp](https://img.shields.io/badge/co--op-PeerJS-purple)

## The game

A **first-person** crawl through 9 procedurally generated floors — destroy **the Bone King** on floor 9. Bosses guard floors 3, 6 and 9; the way down stays locked until they fall. After floor 9, keep going in endless mode.

- **4 classes, 12 spells** — Knight, Barbarian, Rogue, Mage. Each class has a basic attack plus three spells on keys 1/2/3: fireballs, chain lightning, frost shards, fan of knives, shadow-step blinks, ground slams, shield bashes, battle rage, heals…
- **First-person combat** — crosshair that flares on targets, **Shift to aim** (FOV zoom, steadier shots), dodge dash with i-frames, hit markers, crits, knockback, slows, poison
- **Verticality** — climbable staircases lead to railed platforms where skeleton archers guard treasure; walk under them, climb up, rain bolts down
- **A bigger horde** — minions, rogues, warriors, mages, exploding **bombers**, slowing **frost mages**, **ghosts** that drift through obstacles, glowing **elite champions**, and summoning bosses
- **Equipment & inventory (Tab)** — weapon / offhand / two trinket slots plus a 12-slot bag. Procedurally named drops in 5 rarity tiers (Common → Legendary) with damage, crit, armor, speed, HP and mana-regen stats. Right-click to salvage for gold.
- **Appearance customization** — helmet/hood and cape toggles plus six cape colors, with a live 3D preview in the menu; your look syncs to co-op teammates
- **Loot & economy** — coins, chests, potions, a locked golden chest per floor (find the key), equipment drops from elites/bosses, and the Bone Merchant between floors
- **Progression** — XP levels, upgrades, escalating difficulty per floor
- **Co-op multiplayer (up to 4)** — host gets a 5-letter room code, friends join with it. Peer-to-peer via PeerJS, host-authoritative, shared dungeon seed. Fallen players respawn while a teammate lives.
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

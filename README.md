# CodeOrange — Depths of the Bone King

A 3D co-op dungeon crawler that runs entirely in the browser. No build step, no backend.

**Play it: https://maxlirio.github.io/CodeOrange/**

![genre](https://img.shields.io/badge/genre-dungeon%20crawler-orange) ![stack](https://img.shields.io/badge/three.js-r165-blue) ![mp](https://img.shields.io/badge/co--op-PeerJS-purple)

## The game

Descend through 9 procedurally generated floors of the dungeon and destroy **the Bone King**. Bosses guard floors 3, 6 and 9 — the way down stays locked until they fall. After floor 9, keep going in endless mode.

- **4 classes** — Knight (sword & board), Barbarian (huge 2H axe), Rogue (fast twin daggers, crits), Mage (ranged fire bolts, mana)
- **Real-time combat** — melee arcs, projectiles, dodge rolls with i-frames, crits, hit reactions
- **Skeleton horde** — minions, rogues, warriors, mages; they sleep until you get close. Bosses summon adds.
- **Loot & economy** — coins, chests, potions, a locked golden chest per floor (find the key), and the Bone Merchant between floors
- **Progression** — XP levels, damage/HP/speed upgrades, escalating difficulty per floor
- **Dungeon features** — fog-of-war minimap, spike traps, torches, banners, props, boss health bars
- **Co-op multiplayer (up to 4)** — host gets a 5-letter room code, friends join with it. Peer-to-peer via PeerJS, host-authoritative, shared dungeon seed. Fallen players respawn while a teammate lives.
- **Procedural audio** — every sound is synthesized with WebAudio; no audio files

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look (click canvas to capture) |
| Left click / F | Attack |
| Space | Dodge roll (i-frames) |
| E | Open chest / descend |
| Q | Drink potion |
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

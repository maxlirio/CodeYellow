# CodeYellow — Boarding Action

A 3D co-op **boarding-action roguelike** that runs entirely in the browser. No build step, no backend. Cut your way through a derelict void-hulk, deck by deck.

**Play it: https://maxlirio.github.io/CodeYellow/**

![genre](https://img.shields.io/badge/genre-boarding%20action-yellow) ![stack](https://img.shields.io/badge/three.js-r165-blue) ![mp](https://img.shields.io/badge/co--op-PeerJS-purple)

## The game

You are a breach team cutting into a derelict ship the size of a city. Gear up in the **Forward Staging Bay**, take the breach chute, and fight down through eight decks of cathedral holds — crate-maze cargo bays, open hangars, catwalk gantries, machine rooms — toward the reactor. The hulk's machine crew is awake: scrap drones and warframes, hull-raider scavengers, void vermin that drifted in through the breaches, siege mechs, and the fabricators that print fresh defenders while you fight. Midbosses hold decks 3 and 6. Deck 9 holds something older.

- **Six boarding archetypes** — Breacher, Wrecker, Splicer, Technician, Marksman, Fabricator — each with its own arsenal: cell-fed blasters (pulse carbines, long-las rifles, scatterguns) and energy melee (arc-blades, breach mauls, vibro pairs).
- **Signature weapon systems** at rare+ quality: Full Auto, Cryo Sweep, Singularity, Promethium Burn.
- **Co-op up to 4** over PeerJS — same seed, same ship; crews can split across decks.
- **Every deck rolls its own identity**: layout, flavor (cargo / habitation / engineering / command), lighting and threat mix.
- Loot rarities and affixes, credits and trooper hires, a persistent tech tree of gear between runs.

## Controls

WASD move · mouse look · click attack · Shift aim · Space jump · Q stim · Tab gear · E interact · 4/R signature · M music

## Tech

Buildless three.js (r165 via CDN import map) + PeerJS. Procedural deck generator (BSP holds, no corridors), procedural ship architecture (~10 draw calls a deck, prop meshes derived from their own colliders), CC0 art (Kenney, Quaternius, three.js sample assets — see SCIFI_NOTES.md and asset provenance).

Forked from the fantasy crawler **[CodeOrange](https://github.com/maxlirio/CodeOrange)** — same engine brain, rebuilt world.

# Sci-fi branch (`scifi`) — state of the conversion

One huge derelict ship, boarded deck by deck. The **brain is untouched** —
floors/co-op/AI/loot/bosses/builds all run as before; the world, the art and
the arsenal are new. Everything below is CC0 (Kenney, Quaternius, three.js
sample robot); provenance in `~/Developer/SCIFI_ASSETS/SOURCES.md`.

## What's done
- **World**: `js/ship.js` generates boarding-action decks (huge holds, wide
  breaches, crate mazes, hangars, catwalk gantries, machine rooms) for floors
  1-8; `js/shipmeshes.js` renders them procedurally (~10 draw calls/deck) and
  derives prop meshes FROM colliders so art and hitbox can't disagree. Deck
  flavors: cargo (amber) → hab (teal) → engineering (red) → command (violet).
- **Hub**: `js/bay.js` — Forward Staging Bay, floor 0. Same shop/dialog ids as
  the old town (Armory/Med Station/Requisitions/Crew Deck/Mission Console/Sim
  Pods/codex/bestiary), new crew, Kenney set dressing.
- **Roster**: every enemy KEY kept (pools/summons/net intact), every BODY
  swapped — RobotExpressive frame family, toon-shooter raiders (guns baked
  into the rigs), USK void vermin flyers, mech-pack heavies, George as THE
  HULK WARDEN / THE FOUNDRY TYRANT. New animMaps: robot/mech/troop/void.
- **Classes**: Breacher/Wrecker/Splicer/Technician/Marksman/Fabricator on
  astronaut/soldier/hazmat rigs (`cls.scale`), via a clip-ALIAS layer in
  assets.js (sci-fi rigs answer to the KayKit animation names the code speaks).
- **Arsenal**: Kenney blasters dressed gunmetal + emissive cell (they fire
  along their own -z — dedicated `_gun`/`_guncast` viewmodel styles), and
  procedural energy melee (arc-blade/plas-render/breach maul/phase pike/
  vibro pairs/mono-scythe) built in assets.js. Laser bolt = cylinder halo.
- **Spells CUT** at the deal (`G.run.spells = []`); signatures (renamed to
  ship-tech), stims and second wind carry the kit. The ability system returns
  later under a tech name.
- **Text**: credits / cells (⚡) / stims / trooper hires; shop tables and item
  names reskinned. Mechanics identical.
- **Tests**: `_test.html` now 41 asserts (adds deck connectivity ×3, crew
  density, bay shape) — all green.

## Known leftovers (deliberate, not forgotten)
- **Deck 9 is still Emberwing's lair** — fantasy dragon, fantasy cave. Needs
  its own rebuild (reactor core + a machine god). The fight brain is reusable.
- **Loot/prop visuals in decks**: chests, gold coins, potion bottles, keys
  still use fantasy models; torch anchors render as flames. Wants a pass
  (data crates / credit chits / stim injectors / wall lamps).
- **Horde/duel arena** (`generateArenaData`) is still the fantasy lawn keep.
- **Bestiary/codex text** partially fantasy-flavored; enemy `name` fields are
  in config, the overlay copy isn't rewritten.
- **Music** unchanged (fantasy tracks).
- **Tint rule learned the hard way**: `cfg.tint` REPLACES material color —
  fine on RobotExpressive (light texture), flattens toon-shooter rigs to clay
  (many solid-color materials), and MULTIPLIES textured USK/mech rigs (use
  light tints only there, e.g. 0xffb0a0, never dark ones).
- Splicer vibro-blades read white rather than glowing — bump emissive later.
- Menu screen (class cards) shows the new archetypes but the menu art/copy is
  still the fantasy layout.

## Probes (scratchpad of the build session)
boot.mjs (bay+deck1 smoke), vmcheck.mjs (all-class viewmodels), firefight.mjs
(live gun kill), rogues.mjs (25-enemy photo gallery), gallery.mjs (deck
flavors + midboss), runtests.mjs (suite runner).

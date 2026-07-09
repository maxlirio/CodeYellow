// Pressure-plate traps: a flat grate that ARMS with a click when stepped on,
// then spikes snap up after a beat — dodge off in time or take the hit.
import { G } from './state.js';
import { makePiece } from './assets.js';
import { sfx } from './audio.js';
import { addMsg } from './ui.js';
import { damageLocalPlayer } from './player.js';

// create the pop-up spike objects for a floor (called once per floor build)
export function initFloorTraps(fs) {
  for (const t of fs.traps) {
    if (t.spike) continue;
    const spike = makePiece('floor_tile_big_spikes');
    spike.position.set(t.x, 0.02, t.z);
    spike.scale.y = 0.02;
    fs.meshGroup.add(spike);
    t.spike = spike;
    t.state = 'idle'; // idle | arming | up | cooldown
    t.t = 0;
  }
}

function playerOnPlate(t) {
  const p = G.player;
  if (!p || p.dead || p.obj.position.y > 0.6) return false;
  return Math.abs(p.obj.position.x - t.x) < 1.5 && Math.abs(p.obj.position.z - t.z) < 1.5;
}

export function updateTraps(dt) {
  const fs = G.floors.get(G.floor);
  if (!fs) return;
  for (const t of fs.traps) {
    if (!t.spike) continue;
    switch (t.state) {
      case 'idle':
        if (playerOnPlate(t)) {
          t.state = 'arming';
          t.t = 0.45;
          sfx.key(); // metallic click
          addMsg('⚠ *click* — a pressure plate!', 'bad');
        }
        break;
      case 'arming':
        t.t -= dt;
        // plate rattles while arming
        t.spike.scale.y = 0.02 + Math.abs(Math.sin(t.t * 40)) * 0.03;
        if (t.t <= 0) {
          t.state = 'up';
          t.t = 0.9;
          t.spike.scale.y = 1;
          sfx.trap();
          if (playerOnPlate(t) && G.player.iframes <= 0 && G.player.trapCd <= 0) {
            G.player.trapCd = 1.0;
            damageLocalPlayer(Math.round(8 + G.floor * 1.6));
            addMsg('Impaled by spikes!', 'bad');
          }
        }
        break;
      case 'up':
        t.t -= dt;
        // walking onto raised spikes still hurts
        if (playerOnPlate(t) && G.player.iframes <= 0 && G.player.trapCd <= 0) {
          G.player.trapCd = 1.0;
          damageLocalPlayer(Math.round(6 + G.floor * 1.2));
        }
        if (t.t <= 0) {
          t.state = 'cooldown';
          t.t = 1.6;
        }
        break;
      case 'cooldown':
        t.spike.scale.y = Math.max(0.02, t.spike.scale.y - dt * 3);
        t.t -= dt;
        if (t.t <= 0) t.state = 'idle';
        break;
    }
  }
}

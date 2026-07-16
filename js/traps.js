// Pressure-plate traps: a flat grate that ARMS with a click when stepped on,
// then spikes snap up after a beat — dodge off in time or take the hit.
import { G } from './state.js';
import * as THREE from 'three';
import { makePiece } from './assets.js';

// ship decks trap with electricity, not spikes: a scorched plate whose arc
// coil snaps up on the same scale.y animation the spikes used
function buildShockPlate() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.06, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c333c, metalness: 0.4, roughness: 0.7 }));
  plate.position.y = 0.03;
  g.add(plate);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 1.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x66d9ff, emissiveIntensity: 1.8, toneMapped: false }));
  coil.position.y = 0.85;
  g.add(coil);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x66d9ff, emissiveIntensity: 1.4, toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  return g;
}
import { sfx } from './audio.js';
import { addMsg } from './ui.js';
import { damageLocalPlayer } from './player.js';

// create the pop-up spike objects for a floor (called once per floor build)
export function initFloorTraps(fs) {
  for (const t of fs.traps) {
    if (t.spike) continue;
    const spike = G.grid?.ship ? buildShockPlate() : makePiece('floor_tile_big_spikes');
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
          addMsg('*click* — a pressure plate!', 'bad');
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
            addMsg(G.grid?.ship ? 'Shock plate discharge!' : 'Impaled by spikes!', 'bad');
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

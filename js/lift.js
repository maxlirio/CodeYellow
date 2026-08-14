// THE GRAV LIFT, played straight: press the call button, the doors part,
// you walk in on your own feet, they seal behind you, the deck numbers
// tick past, and the doors open somewhere else. You walk out; they close.
// No teleports — the floor swap happens while you stand in a sealed cab.
import { G } from './state.js';
import { sfx } from './audio.js';
import { addMsg } from './ui.js';

let ride = null; // { fs, lift, target, phase, t, commit, onDone }
let setFloorFn = null;
export function setLiftHooks({ setFloor }) { setFloorFn = setFloor; }

export function liftBusy() { return !!ride; }

// E on the pad = pressing the CALL button
export function summonLift(target, { commit = null, onDone = null } = {}) {
  const fs = G.floors.get(G.floor);
  const lift = fs?.lift;
  if (!lift) { instantTravel(target, commit, onDone); return; } // no lobby (dev floors)
  if (ride) return;
  ride = { fs, lift, target, phase: 'opening', t: 0, commit, onDone, dwell: 0 };
  sfx.key();
  addMsg('Lift called — step in.', 'gold');
}

// dev/probe path: ?auto flows can skip the ceremony
export function instantTravel(target, commit, onDone) {
  commit?.();
  G.mode = 'transition';
  setFloorFn?.(target);
  G.mode = 'playing';
  onDone?.();
}

const drawTicker = (lift, label, sub) => {
  const c = lift.ticker.canvas, x = c.getContext('2d');
  x.fillStyle = '#04121a'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#2fd6c8'; x.lineWidth = 3; x.strokeRect(3, 3, c.width - 6, c.height - 6);
  x.fillStyle = '#2fd6c8'; x.textAlign = 'center';
  x.font = 'bold 26px Menlo, monospace';
  x.fillText(label, c.width / 2, 34);
  if (sub) { x.font = '12px Menlo, monospace'; x.fillStyle = '#7fb8b2'; x.fillText(sub, c.width / 2, 52); }
  lift.ticker.tex.needsUpdate = true;
};

function setDoors(lift, k) { // 0 sealed .. 1 parted
  lift.doorK = k;
  lift.doorL.position.x = -0.66 - k * 1.18;
  lift.doorR.position.x = 0.66 + k * 1.18;
  lift.doorCol.off = k > 0.55; // passable once mostly open
}

function playerInCab(lift) {
  const p = G.player;
  if (!p) return false;
  return Math.hypot(p.obj.position.x - lift.cab.x, p.obj.position.z - lift.cab.z) < 1.15;
}

export function updateLifts(dt) {
  if (!ride) return;
  const { lift } = ride;
  ride.t += dt;
  switch (ride.phase) {
    case 'opening': {
      setDoors(lift, Math.min(1, ride.t / 0.8));
      drawTicker(lift, `DECK ${G.floor}`, 'BOARD');
      if (ride.t >= 0.8) { ride.phase = 'open'; ride.t = 0; sfx.key(); }
      break;
    }
    case 'open': {
      if (playerInCab(lift)) { ride.phase = 'boarding'; ride.t = 0; break; }
      if (ride.t > 10) { ride.phase = 'cancel'; ride.t = 0; addMsg('Lift released.', 'gold'); }
      break;
    }
    case 'boarding': { // you're in — the doors seal behind you
      setDoors(lift, Math.max(0, 1 - ride.t / 0.8));
      if (!playerInCab(lift) && ride.t < 0.75) {
        // stepped back out mid-close — the doors give way again
        ride.phase = 'opening'; ride.t = 0.8 * (1 - lift.doorK);
        break;
      }
      if (ride.t >= 0.8) {
        ride.phase = 'riding'; ride.t = 0;
        // NO mode change: the cab is a ROOM, not a cutscene — walk around,
        // look around; the world changes outside the sealed doors
        ride.commit?.();
        sfx.stairs();
        sfx.rumble?.();
      }
      break;
    }
    case 'riding': {
      G.shake = Math.max(G.shake || 0, 0.045);
      if (ride.from === undefined) ride.from = G.floor;
      const passing = Math.round(ride.from + (ride.target - ride.from) * Math.min(1, ride.t / 2.4));
      drawTicker(ride.lift2 || lift, `DECK ${passing}`, ride.target > ride.from ? '▼ DESCENDING' : '▲ ASCENDING');
      if (ride.t >= 1.3 && !ride.swapped) {
        ride.swapped = true;
        const p = G.player;
        // remember WHERE IN THE CAB you're standing and where you're looking,
        // relative to the origin lobby's frame
        const o = lift;
        const relX = p ? p.obj.position.x - o.cab.x : 0;
        const relZ = p ? p.obj.position.z - o.cab.z : 0;
        const co = Math.cos(-o.yaw), so = Math.sin(-o.yaw);
        const lx = relX * co + relZ * so, lz = -relX * so + relZ * co; // into lobby-local
        const relYaw = p ? p.camYaw - o.outYaw : 0;
        setFloorFn?.(ride.target); // the world changes outside the sealed doors
        const dest = G.floors.get(ride.target)?.lift;
        if (dest && p) {
          // same spot in the SAME room — new deck beyond the doors
          const cd = Math.cos(dest.yaw), sd = Math.sin(dest.yaw);
          p.obj.position.set(dest.cab.x + lx * cd + lz * sd, 0, dest.cab.z - lx * sd + lz * cd);
          p.camYaw = dest.outYaw + relYaw;
          setDoors(dest, 0);
          ride.lift2 = dest;
        }
      }
      if (ride.t >= 2.6) { ride.phase = 'arrive'; ride.t = 0; sfx.key(); }
      break;
    }
    case 'arrive': { // doors part on the new deck — walk out
      const dest = ride.lift2 || lift;
      setDoors(dest, Math.min(1, ride.t / 0.8));
      drawTicker(dest, `DECK ${ride.target}`, 'ARRIVED');
      if (ride.t >= 0.8) { ride.phase = 'exit'; ride.t = 0; }
      break;
    }
    case 'exit': {
      const dest = ride.lift2 || lift;
      const gone = !playerInCab(dest);
      if (gone) ride.dwell += dt; else ride.dwell = 0;
      if (ride.dwell > 0.5 || ride.t > 15) { ride.phase = 'shut'; ride.t = 0; }
      break;
    }
    case 'shut': { // and they close behind you
      const dest = ride.lift2 || lift;
      setDoors(dest, Math.max(0, 1 - ride.t / 0.8));
      if (ride.t >= 0.8) {
        const done = ride.onDone;
        ride = null;
        done?.();
      }
      break;
    }
    case 'cancel': {
      setDoors(lift, Math.max(0, 1 - ride.t / 0.8));
      if (ride.t >= 0.8) ride = null;
      break;
    }
  }
}

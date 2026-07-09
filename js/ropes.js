// Swinging ropes: grab with E, pendulum physics while attached, release (E/Space)
// flings you with your momentum — swing across rooms or up onto platforms.
import * as THREE from 'three';
import { G } from './state.js';
import { groundHeightAt, moveWithCollision } from './dungeon.js';
import { sfx } from './audio.js';
import { addMsg } from './ui.js';

const HAND = 1.5; // attach point above player origin

export function buildRopesForFloor(fs) {
  if (!fs.ropes) return;
  for (const r of fs.ropes) {
    if (r.obj) continue;
    const geo = new THREE.CylinderGeometry(0.035, 0.035, r.len, 5);
    geo.translate(0, -r.len / 2, 0); // pivot at top
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 1 });
    const obj = new THREE.Mesh(geo, mat);
    obj.position.set(r.x, r.ay, r.z);
    // small knot at the bottom
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat);
    knot.position.y = -r.len;
    obj.add(knot);
    fs.meshGroup.add(obj);
    r.obj = obj;
  }
}

export function nearestRope(pos) {
  const fs = G.floors.get(G.floor);
  if (!fs?.ropes) return null;
  for (const r of fs.ropes) {
    const botY = r.ay - r.len;
    const d = Math.hypot(pos.x - r.x, pos.z - r.z);
    if (d < 1.4 && pos.y + HAND + 1.0 >= botY && pos.y < botY + 1.5) return r;
  }
  return null;
}

export function grabRope(rope) {
  const p = G.player;
  if (!p || p.rope) return;
  p.rope = { rope, vel: new THREE.Vector3(p.dodgeDirX * 2, 0, p.dodgeDirZ * 2) };
  p.vy = 0;
  sfx.dodge();
  addMsg('You grab the rope — swing with W, release with E or Space');
}

export function releaseRope(boost = 1.15) {
  const p = G.player;
  if (!p?.rope) return;
  const v = p.rope.vel;
  p.airVX = v.x * boost;
  p.airVZ = v.z * boost;
  p.vy = Math.max(v.y, 0) * boost + 2.2;
  p.rope = null;
  sfx.dodge();
}

export function updateRopePhysics(dt) {
  const p = G.player;
  const R = p.rope;
  if (!R) return;
  const rope = R.rope;
  const anchor = new THREE.Vector3(rope.x, rope.ay, rope.z);
  const v = R.vel;

  // pump: W accelerates along the camera's horizontal forward
  if (G.keys['KeyW']) {
    const f = new THREE.Vector3();
    G.camera.getWorldDirection(f);
    f.y = 0; f.normalize();
    v.addScaledVector(f, 7.5 * dt);
  }
  v.y -= 22 * dt;
  v.multiplyScalar(1 - 0.12 * dt);

  const pos = p.obj.position;
  const prevX = pos.x, prevZ = pos.z;
  pos.x += v.x * dt;
  pos.y += v.y * dt;
  pos.z += v.z * dt;

  // constrain hand to the rope length
  const hand = new THREE.Vector3(pos.x, pos.y + HAND, pos.z);
  const r = hand.sub(anchor);
  const d = r.length();
  if (d > rope.len) {
    r.multiplyScalar(rope.len / d);
    pos.set(anchor.x + r.x, anchor.y + r.y - HAND, anchor.z + r.z);
    const rn = r.normalize();
    v.addScaledVector(rn, -v.dot(rn)); // kill radial velocity
  }

  // walls stop the swing
  const tryPos = { x: prevX, z: prevZ, y: pos.y };
  moveWithCollision(tryPos, pos.x - prevX, pos.z - prevZ, 0.5, { y: pos.y });
  if (Math.abs(tryPos.x - pos.x) > 0.01) { pos.x = tryPos.x; v.x = 0; }
  if (Math.abs(tryPos.z - pos.z) > 0.01) { pos.z = tryPos.z; v.z = 0; }

  // touching the ground detaches
  const ground = groundHeightAt(pos.x, pos.z, pos.y);
  if (pos.y <= ground + 0.05) {
    pos.y = ground;
    p.rope = null;
  }

  // rope visual bends toward the player
  if (rope.obj) {
    const to = new THREE.Vector3(pos.x, pos.y + HAND, pos.z).sub(new THREE.Vector3(rope.x, rope.ay, rope.z));
    rope.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.normalize());
  }
}

// ease idle ropes back to vertical
export function updateRopes(dt) {
  const fs = G.floors.get(G.floor);
  if (!fs?.ropes) return;
  for (const r of fs.ropes) {
    if (!r.obj || G.player?.rope?.rope === r) continue;
    r.obj.quaternion.slerp(new THREE.Quaternion(), Math.min(1, dt * 3));
  }
}

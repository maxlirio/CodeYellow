// First-person viewmodel: your equipped weapon (and a simple arm) visible in-hand,
// Minecraft-style — walk bob, mouse sway, and procedural swing/recoil/cast animations.
import * as THREE from 'three';
import { G } from './state.js';
import { makeWeaponModel } from './assets.js';

let rig = null, holder = null, weaponObj = null, armObj = null;
let currentModel = '';
let swing = null; // { t, dur, kind, dir }
let swingDir = 1;
let lastYaw = 0, lastPitch = 0, swayX = 0, swayY = 0;

const REST_POS = new THREE.Vector3(0.36, -0.34, -0.62);
const REST_ROT = new THREE.Euler(-0.5, Math.PI + 0.45, 0.18); // tipped forward, angled in

export function initViewmodel() {
  G.scene.add(G.camera); // children of the camera only render if the camera is in the scene
  rig = new THREE.Group();
  rig.position.copy(REST_POS);
  G.camera.add(rig);
  holder = new THREE.Group();
  rig.add(holder);
}

export function setViewmodelWeapon(modelName) {
  if (!holder || modelName === currentModel) return;
  currentModel = modelName;
  if (weaponObj) holder.remove(weaponObj);
  weaponObj = makeWeaponModel(modelName);
  weaponObj.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
  weaponObj.rotation.set(REST_ROT.x, REST_ROT.y, REST_ROT.z);
  weaponObj.scale.setScalar(0.42);
  holder.add(weaponObj);
}

// kind: 'melee' | 'ranged' | 'cast' | 'drink'
export function triggerSwing(kind, dur = 0.45) {
  if (!rig) return;
  swingDir = -swingDir;
  swing = { t: 0, dur: Math.max(0.22, dur), kind, dir: swingDir };
}

export function updateViewmodel(dt) {
  if (!rig) return;
  const p = G.player;
  const active = p && !p.dead && (G.mode === 'playing' || G.mode === 'merchant');
  rig.visible = active;
  if (!active) return;

  // mouse sway (lags behind camera turns)
  const dYaw = p.camYaw - lastYaw, dPitch = p.camPitch - lastPitch;
  lastYaw = p.camYaw; lastPitch = p.camPitch;
  swayX += (THREE.MathUtils.clamp(dYaw * 2.2, -0.06, 0.06) - swayX) * Math.min(1, dt * 8);
  swayY += (THREE.MathUtils.clamp(dPitch * 2.2, -0.05, 0.05) - swayY) * Math.min(1, dt * 8);

  // walk bob
  const bob = p.moving && p.dodgeT <= 0 ? Math.sin(p.bobT * 1.05) * 0.028 : 0;
  const bobX = p.moving && p.dodgeT <= 0 ? Math.cos(p.bobT * 0.525) * 0.02 : 0;

  let px = REST_POS.x + swayX + bobX;
  let py = REST_POS.y + swayY + bob;
  let pz = REST_POS.z;
  let rx = 0, ry = 0, rz = 0;

  if (swing) {
    swing.t += dt;
    const k = Math.min(1, swing.t / swing.dur);
    const arc = Math.sin(k * Math.PI); // 0→1→0
    if (swing.kind === 'melee') {
      // diagonal slash across the view, alternating direction
      rx = -arc * 1.5;
      ry = swing.dir * arc * 0.9;
      rz = swing.dir * arc * 0.6;
      px += swing.dir * -arc * 0.28;
      py += arc * 0.06;
      pz -= arc * 0.22;
    } else if (swing.kind === 'ranged') {
      pz += arc * 0.16; // recoil back
      rx = arc * 0.35;
    } else if (swing.kind === 'cast') {
      py += arc * 0.22;
      rx = -arc * 0.8;
      pz -= arc * 0.12;
    } else if (swing.kind === 'drink') {
      py += arc * 0.2;
      rx = -arc * 1.1;
      px -= arc * 0.2;
    }
    if (k >= 1) swing = null;
  }

  // aiming tucks the weapon toward center
  if (p.aiming) { px -= 0.14; py += 0.05; pz += 0.06; }

  rig.position.set(px, py, pz);
  rig.rotation.set(rx, ry, rz);
}

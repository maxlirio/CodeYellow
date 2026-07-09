// First-person viewmodel with per-weapon-type animations:
//   swords SLASH in a horizontal arc, axes CLEAVE overhead, daggers come as a
//   PAIR and STAB, crossbows recoil then visibly RELOAD a bolt, staves/wands
//   push forward on cast. Treasure weapons swap the in-hand model on equip.
import * as THREE from 'three';
import { G } from './state.js';
import { makeWeaponModel } from './assets.js';

let rig = null, holder = null, offholder = null;
let weaponObj = null, offhandObj = null, boltObj = null;
let currentKey = '';
let anim = null; // { t, dur, kind, dir }
let swingDir = 1;
let lastYaw = 0, lastPitch = 0, swayX = 0, swayY = 0;

const REST_POS = new THREE.Vector3(0.36, -0.34, -0.62);
const OFF_POS = new THREE.Vector3(-0.36, -0.36, -0.6);

// per-weapon-type hold pose + attack style
const STYLES = {
  sword1h: { rot: [-0.5, Math.PI + 0.45, 0.18], scale: 0.42, attack: 'slash' },
  sword2h: { rot: [-0.55, Math.PI + 0.4, 0.22], scale: 0.46, attack: 'slash' },
  axe1h: { rot: [-0.45, Math.PI + 0.5, 0.15], scale: 0.42, attack: 'cleave' },
  axe2h: { rot: [-0.5, Math.PI + 0.45, 0.2], scale: 0.46, attack: 'cleave' },
  daggers: { rot: [-0.9, Math.PI + 0.3, 0.05], scale: 0.4, attack: 'stab', dual: true },
  crossbow: { rot: [-0.12, Math.PI, 0], scale: 0.42, attack: 'shoot', bolt: true, pos: [0.3, -0.3, -0.58] },
  staff: { rot: [-0.35, Math.PI + 0.25, 0.3], scale: 0.4, attack: 'cast' },
  wand: { rot: [-0.55, Math.PI + 0.35, 0.15], scale: 0.45, attack: 'cast' },
  bow: { rot: [0, Math.PI / 2, 0.12], scale: 0.85, attack: 'bowshoot', bow: true, pos: [0.3, -0.28, -0.6] },
};

export function initViewmodel() {
  G.scene.add(G.camera); // children of the camera only render if the camera is in the scene
  rig = new THREE.Group();
  rig.position.copy(REST_POS);
  G.camera.add(rig);
  holder = new THREE.Group();
  rig.add(holder);
  offholder = new THREE.Group();
  offholder.position.set(OFF_POS.x - REST_POS.x, OFF_POS.y - REST_POS.y, OFF_POS.z - REST_POS.z);
  rig.add(offholder);
}

export function setViewmodelWeapon(modelName, wtype = 'sword1h') {
  if (!holder) return;
  const key = modelName + ':' + wtype;
  if (key === currentKey) return;
  currentKey = key;
  const style = STYLES[wtype] || STYLES.sword1h;
  rig.userData.style = style;
  if (weaponObj) holder.remove(weaponObj);
  if (offhandObj) { offholder.remove(offhandObj); offhandObj = null; }
  if (boltObj) { holder.remove(boltObj); boltObj = null; }

  weaponObj = makeWeaponModel(modelName);
  weaponObj.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
  weaponObj.rotation.set(...style.rot);
  weaponObj.scale.setScalar(style.scale);
  holder.add(weaponObj);
  if (style.pos) holder.position.set(style.pos[0] - REST_POS.x, style.pos[1] - REST_POS.y, style.pos[2] - REST_POS.z);
  else holder.position.set(0, 0, 0);

  // daggers come as a pair — the offhand mirrors the main
  if (style.dual) {
    offhandObj = makeWeaponModel(modelName);
    offhandObj.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
    offhandObj.rotation.set(style.rot[0], Math.PI - 0.3, -style.rot[2]);
    offhandObj.scale.setScalar(style.scale);
    offholder.add(offhandObj);
  }
  // bows nock a visible arrow against the string
  if (style.bow) {
    boltObj = makeWeaponModel('arrow');
    boltObj.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
    boltObj.rotation.set(Math.PI / 2, 0, 0); // along -z, nock at string
    boltObj.scale.setScalar(0.55);
    boltObj.position.set(0, 0, 0.08);
    weaponObj.add(boltObj);
  }
  // crossbows carry a visible bolt that fires and reloads
  if (style.bolt) {
    boltObj = makeWeaponModel('arrow');
    boltObj.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
    boltObj.rotation.set(Math.PI / 2 - 0.12, Math.PI, 0);
    boltObj.scale.setScalar(0.4);
    boltObj.position.set(0, 0.03, -0.1);
    holder.add(boltObj);
  }
}

// kind: 'attack' resolves per-weapon; or explicit 'cast' | 'drink'
export function triggerSwing(kind, dur = 0.45) {
  if (!rig) return;
  const style = rig.userData.style || STYLES.sword1h;
  const resolved = kind === 'attack' ? style.attack : kind;
  swingDir = -swingDir;
  anim = { t: 0, dur: Math.max(0.22, dur), kind: resolved, dir: swingDir };
  if (resolved === 'shoot' && boltObj) boltObj.visible = false; // the bolt flies
}

export function updateViewmodel(dt) {
  if (!rig) return;
  const p = G.player;
  const active = p && !p.dead && (G.mode === 'playing' || G.mode === 'merchant');
  rig.visible = active;
  if (!active) return;

  const dYaw = p.camYaw - lastYaw, dPitch = p.camPitch - lastPitch;
  lastYaw = p.camYaw; lastPitch = p.camPitch;
  swayX += (THREE.MathUtils.clamp(dYaw * 2.2, -0.06, 0.06) - swayX) * Math.min(1, dt * 8);
  swayY += (THREE.MathUtils.clamp(dPitch * 2.2, -0.05, 0.05) - swayY) * Math.min(1, dt * 8);

  const bob = p.moving && p.dodgeT <= 0 ? Math.sin(p.bobT * 1.05) * 0.028 : 0;
  const bobX = p.moving && p.dodgeT <= 0 ? Math.cos(p.bobT * 0.525) * 0.02 : 0;

  let px = REST_POS.x + swayX + bobX;
  let py = REST_POS.y + swayY + bob;
  let pz = REST_POS.z;
  let rx = 0, ry = 0, rz = 0;
  let offRx = 0, offPz = 0;

  if (anim) {
    anim.t += dt;
    const k = Math.min(1, anim.t / anim.dur);
    switch (anim.kind) {
      case 'slash': {
        // wind up briefly, then sweep flat across the view
        const wind = Math.min(1, k / 0.25);
        const sweep = k < 0.25 ? 0 : (k - 0.25) / 0.75;
        const arc = Math.sin(sweep * Math.PI);
        ry = anim.dir * (0.55 * wind - sweep * 2.0 * 0.9);
        rz = anim.dir * arc * 0.25;
        rx = -arc * 0.35;
        px += anim.dir * (0.18 * wind - sweep * 0.5);
        pz -= arc * 0.28;
        break;
      }
      case 'cleave': {
        // raise high overhead, then slam straight down
        const raise = Math.min(1, k / 0.35);
        const slam = k < 0.35 ? 0 : Math.min(1, (k - 0.35) / 0.4);
        rx = raise * 1.1 - slam * 2.3;
        py += raise * 0.28 - slam * 0.5;
        pz -= slam * 0.25;
        if (k > 0.72) { // impact judder
          px += Math.sin(k * 90) * 0.012;
          py += Math.sin(k * 70) * 0.01;
        }
        break;
      }
      case 'stab': {
        // alternating quick thrusts, main then offhand
        const arc = Math.sin(k * Math.PI);
        if (anim.dir > 0) { pz -= arc * 0.42; rx = -arc * 0.15; }
        else { offPz = -arc * 0.42; offRx = -arc * 0.15; }
        break;
      }
      case 'shoot': {
        // recoil, dip to reload, bolt slides back in, snap up
        if (k < 0.18) {
          const r = Math.sin((k / 0.18) * Math.PI);
          pz += r * 0.14; rx = r * 0.2;
        } else {
          const rl = (k - 0.18) / 0.82;
          const dip = Math.sin(rl * Math.PI);
          rx = -dip * 0.55;
          py -= dip * 0.16;
          px += dip * 0.08;
          if (boltObj) {
            if (rl > 0.35 && !boltObj.visible) boltObj.visible = true;
            if (boltObj.visible && rl <= 0.9) {
              const slide = Math.min(1, (rl - 0.35) / 0.55);
              boltObj.position.z = -0.35 + slide * 0.25; // bolt slides into the rail
            } else boltObj.position.z = -0.1;
          }
        }
        break;
      }
      case 'bowshoot': {
        // draw: the string and arrow pull back together; release snaps them home
        const geo = weaponObj?.userData.stringGeo;
        const rest = weaponObj?.userData.nockRest ?? 0.08;
        let nock = rest;
        if (k < 0.5) {
          const draw = k / 0.5;
          nock = rest + draw * 0.34;
          rx = draw * 0.06;
          pz += draw * 0.05; // lean into the draw
          if (boltObj) { boltObj.visible = true; boltObj.position.z = nock; }
        } else if (k < 0.6) {
          const snap = (k - 0.5) / 0.1;
          nock = rest + (1 - snap) * 0.34;
          if (boltObj) boltObj.visible = false; // arrow is away
          pz -= (1 - snap) * 0.02;
        } else {
          nock = rest;
          if (boltObj && k > 0.85) { boltObj.visible = true; boltObj.position.z = rest; } // re-nock
        }
        if (geo) {
          geo.attributes.position.array[5] = nock; // nock vertex z
          geo.attributes.position.needsUpdate = true;
        }
        break;
      }
      case 'cast': {
        const arc = Math.sin(k * Math.PI);
        py += arc * 0.2;
        rx = -arc * 0.7;
        pz -= arc * 0.16;
        rz = anim.dir * arc * 0.1;
        break;
      }
      case 'drink': {
        const arc = Math.sin(k * Math.PI);
        py += arc * 0.2;
        rx = -arc * 1.1;
        px -= arc * 0.2;
        break;
      }
    }
    if (k >= 1) {
      if (boltObj) { boltObj.visible = true; boltObj.position.z = -0.1; }
      anim = null;
    }
  }

  if (p.aiming) { px -= 0.14; py += 0.05; pz += 0.06; }

  rig.position.set(px, py, pz);
  rig.rotation.set(rx, ry, rz);
  if (offholder) {
    offholder.position.z = (OFF_POS.z - REST_POS.z) + offPz;
    offholder.rotation.x = offRx;
    offholder.visible = !!offhandObj;
  }
}

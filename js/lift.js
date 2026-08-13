// THE GRAV LIFT — deck travel as a RIDE, not a screen fade. An enclosed car
// builds itself around the camera, the shaft rushes past the window slits
// while the destination deck streams in unseen behind the shell, and the
// doors open on the far side. One ship, no cuts.
import * as THREE from 'three';
import { G } from './state.js';
import { sfx } from './audio.js';

let ride = null;

export function liftBusy() { return !!ride; }

export function liftRide(targetFloor, { swap, onDone, downward = true } = {}) {
  if (ride) return;
  const cam = G.camera;
  const car = new THREE.Group();
  car.position.copy(cam.position);
  // deterministic frame: car axes = world axes, camera looks down -z at the
  // doors. The car is sealed — exterior orientation is irrelevant.
  cam.rotation.set(0, 0, 0);

  const wallM = new THREE.MeshBasicMaterial({ color: 0x11161d, side: THREE.DoubleSide, fog: false });
  const panelM = new THREE.MeshBasicMaterial({ color: 0x1c2530, side: THREE.DoubleSide, fog: false });
  const trimM = new THREE.MeshBasicMaterial({ color: 0x2fd6c8, toneMapped: false, fog: false });
  const B = (sx, sy, sz, x, y, z, mat = wallM) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    car.add(m); return m;
  };
  // the capsule: floor, roof, back, flanks with window slits, DOORS forward
  B(3.2, 0.2, 3.2, 0, -1.7, 0, panelM);            // floor plate
  B(3.2, 0.2, 3.2, 0, 1.5, 0, panelM);             // roof
  B(3.2, 0.06, 3.2, 0, 1.42, 0, trimM);            // roof light panel
  B(3.2, 3.2, 0.2, 0, -0.1, 1.6);                  // back wall
  for (const sx of [-1, 1]) {                       // flanks: solid below/above a slit
    B(0.2, 1.1, 3.2, sx * 1.6, -1.25, 0);
    B(0.2, 1.4, 3.2, sx * 1.6, 0.9, 0);
    B(0.16, 0.1, 3.2, sx * 1.62, -0.66, 0, trimM); // slit sills glow
    B(0.16, 0.1, 3.2, sx * 1.62, 0.16, 0, trimM);
  }
  const doorM = new THREE.MeshBasicMaterial({ color: 0x27313e, side: THREE.DoubleSide, fog: false });
  const doorL = B(0.9, 3.2, 0.16, -0.45, -0.1, -1.6, doorM);
  const doorR = B(0.9, 3.2, 0.16, 0.45, -0.1, -1.6, doorM);
  // the doors READ as doors: meeting-edge glow + a waist stripe on each leaf
  const edgeL = B(0.05, 2.8, 0.18, -0.03, -0.1, -1.59, trimM);
  const edgeR = B(0.05, 2.8, 0.18, 0.03, -0.1, -1.59, trimM);
  const stripeL = B(0.8, 0.1, 0.18, -0.45, -0.3, -1.59, trimM);
  const stripeR = B(0.8, 0.1, 0.18, 0.45, -0.3, -1.59, trimM);
  B(0.7, 3.2, 0.2, -1.45, -0.1, -1.6);             // door frame posts
  B(0.7, 3.2, 0.2, 1.45, -0.1, -1.6);

  // the SHAFT beyond the slits: a big dark tube with light bands that scroll
  const shaftM = new THREE.MeshBasicMaterial({ color: 0x05080c, side: THREE.BackSide, fog: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 60, 12, 1, true), shaftM);
  car.add(shaft);
  const bands = [];
  const bandM = new THREE.MeshBasicMaterial({ color: 0x2fd6c8, toneMapped: false, transparent: true, opacity: 0.7, side: THREE.BackSide, fog: false });
  for (let i = 0; i < 10; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.25, 12, 1, true), bandM);
    band.position.y = -30 + i * 6;
    car.add(band); bands.push(band);
  }
  // the car screen: deck ticker
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.55),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }));
  screen.position.set(0, 0.95, -1.48);
  car.add(screen);
  const drawScreen = (label) => {
    const x = c.getContext('2d');
    x.fillStyle = '#04121a'; x.fillRect(0, 0, 256, 96);
    x.strokeStyle = '#2fd6c8'; x.lineWidth = 4; x.strokeRect(4, 4, 248, 88);
    x.fillStyle = '#2fd6c8'; x.font = 'bold 30px Menlo, monospace'; x.textAlign = 'center';
    x.fillText(label, 128, 44);
    x.font = '18px Menlo, monospace'; x.fillStyle = '#7fb8b2';
    x.fillText('GRAV LIFT', 128, 74);
    tex.needsUpdate = true;
  };
  drawScreen(`DECK ${G.floor}`);
  G.scene.add(car);

  sfx.stairs();
  sfx.rumble?.();
  const DUR = 3.7, t0 = performance.now();
  let swapped = false;
  ride = { car };
  const tick = () => {
    if (!ride) return;
    const t = (performance.now() - t0) / 1000;
    const k = Math.min(1, t / DUR);
    // doors: shut fast at the start, open at the end
    const doorK = t < 0.5 ? 1 - t / 0.5 : k > 0.86 ? (k - 0.86) / 0.14 : 0;
    doorL.position.x = -0.45 - doorK * 0.92;
    doorR.position.x = 0.45 + doorK * 0.92;
    edgeL.position.x = -0.03 - doorK * 0.92;
    edgeR.position.x = 0.03 + doorK * 0.92;
    stripeL.position.x = -0.45 - doorK * 0.92;
    stripeR.position.x = 0.45 + doorK * 0.92;
    // the shaft rushes past — ease in, ease out
    const speed = Math.sin(Math.min(Math.PI, (t / DUR) * Math.PI)) * 26;
    for (const band of bands) {
      band.position.y += (downward ? 1 : -1) * speed * 0.016;
      if (band.position.y > 30) band.position.y -= 60;
      if (band.position.y < -30) band.position.y += 60;
    }
    if (t > 0.6 && t < DUR - 0.7) G.shake = Math.max(G.shake || 0, 0.05);
    // mid-ride: the destination builds behind the shell, and the car quietly
    // relocates to the destination spawn — the windows never let on
    if (!swapped && t > DUR * 0.42) {
      swapped = true;
      swap?.();
      const p = G.player;
      if (p) {
        car.position.set(p.obj.position.x, p.obj.position.y + 1.55, p.obj.position.z);
        G.camera.position.copy(car.position);
        G.camera.rotation.set(0, 0, 0);
        // when the doors open, the first playing frame snaps to the player's
        // camYaw — align the player to the car so there is no pop
        p.camYaw = Math.PI; // world -z, straight out the doors
      }
      drawScreen(`DECK ${targetFloor}`);
      sfx.key();
    }
    if (k >= 1) {
      G.scene.remove(car);
      ride = null;
      onDone?.();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

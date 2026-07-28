// VOID PATROL — the flight game. Leveled defense missions inside the carrier's
// force-field dome: fighters fly STRAFING RUNS, bombers press torpedo attacks
// on the carrier itself (lose it and the campaign dies with it), everything
// explodes properly, and when the sky is clear you fly home to the docking
// bay. Co-op: everyone on the bridge launches together; the host simulates
// the foes, wingmates see each other's fighters and lasers.
import * as THREE from 'three';
import { G } from './state.js';
import { addMsg, refreshHud, hidePrompt } from './ui.js';
import { sfx } from './audio.js';
import { spawnBurst } from './fx.js';
import { saveReport } from './bridge.js';
import { netSend, myId } from './net.js';
import { CELL } from './config.js';

const ORIGIN = new THREE.Vector3(0, 800, 0);
const FIELD_R = 380;
const CAP = new THREE.Vector3(0, -70, -150);   // the carrier, group-local
const DOCK = new THREE.Vector3(30, -64, -119);   // bay mouth, mid-hull flank (+z face)
const BAYIN = new THREE.Vector3(30, -64, -131);  // inside the launch room
// hull-segment colliders (group-local): fore+mid hull, prow, aft+engines, tower
const CARRIER_BOXES = [
  { x: CAP.x + 20, y: CAP.y, z: CAP.z, hx: 101, hy: 20, hz: 29 },   // fore + mid hull (+ keel)
  { x: CAP.x + 150, y: CAP.y, z: CAP.z, hx: 32, hy: 9, hz: 15 },    // prow wedge
  { x: CAP.x - 128, y: CAP.y, z: CAP.z, hx: 55, hy: 20, hz: 31 },   // aft block + engines
  { x: CAP.x - 18, y: CAP.y + 31, z: CAP.z, hx: 37, hy: 15, hz: 18 }, // superstructure + bridge
];
// switchable fighter weapons — keys 1/2/3 in the cockpit
const WEAPONS = [
  { name: 'PULSE', cd: 0.16 },
  { name: 'SCATTER', cd: 0.75 },
  { name: 'SEEKERS', cd: 1.5 },
];
let S = null;
let hooks = { onCarrierLost: null };

// FOUR ships on every flight deck, one color per squad member — you fly
// YOURS, solo or co-op. Slot 0 is the host / solo pilot.
export const SHIP_SLOTS = [
  { name: 'TEAL', trim: 0x4fe8e0, body: 0x8f9aa8 },
  { name: 'AMBER', trim: 0xffce2e, body: 0x9a948a },
  { name: 'MAGENTA', trim: 0xff4fa0, body: 0x9a8f9c },
  { name: 'VIRIDIAN', trim: 0x8aff5c, body: 0x8c9a90 },
];
function slotIds() {
  const ids = [...(G.net.players?.keys() || [])];
  if (!ids.includes('host')) ids.push('host');
  return ids.sort((a, b) => (a === 'host' ? -1 : b === 'host' ? 1 : a < b ? -1 : 1));
}
export function mySlot() {
  if (G.net.role === 'solo') return 0;
  const i = slotIds().indexOf(myId());
  return i < 0 ? 0 : i % 4;
}
export function slotOf(pid) {
  const i = slotIds().indexOf(pid);
  return i < 0 ? 0 : i % 4;
}
export function setSpaceHooks(h) { hooks = { ...hooks, ...h }; }

// fighter difficulty TIERS — like sector depth, but for the sky
const TIERS = {
  raider:      { hp: 3, spd: 30, spdV: 6, scale: 1.0, body: 0xe8734d, trim: 0xff3322, cad: 0.5, cadV: 0.4, burst: 1, boltC: 0xff5533 },
  interceptor: { hp: 2, spd: 45, spdV: 5, scale: 0.85, body: 0xe86ad8, trim: 0xff44ff, cad: 0.35, cadV: 0.3, burst: 1, boltC: 0xff66ee },
  gunship:     { hp: 8, spd: 21, spdV: 3, scale: 1.65, body: 0xb066e8, trim: 0x9933ff, cad: 1.4, cadV: 0.6, burst: 3, boltC: 0xbb66ff },
};

// patrol level -> enemy composition (tiers AND counts climb with your record)
function compositionFor(lvl) {
  if (lvl <= 1) return { name: 'SWEEP', list: [['raider', 4]], bombers: 0 };
  if (lvl === 2) return { name: 'SWEEP II', list: [['raider', 3], ['interceptor', 2]], bombers: 0 };
  if (lvl === 3) return { name: 'BOMBER INTERCEPT', list: [['raider', 3]], bombers: 2 };
  if (lvl === 4) return { name: 'BOMBER INTERCEPT II', list: [['interceptor', 3], ['gunship', 1]], bombers: 3 };
  return { name: `SIEGE ${lvl - 4}`, list: [['raider', 3], ['interceptor', 3], ['gunship', 2]], bombers: Math.min(4 + (lvl - 5), 7) };
}

function starSphere() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#020409';
  ctx.fillRect(0, 0, 2048, 1024);
  let seed = 777;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2600; i++) {
    const b = rnd();
    ctx.fillStyle = b > 0.94 ? '#bfe6ff' : b > 0.7 ? '#ffffff' : '#7d8ba0';
    const r = b > 0.97 ? 2.4 : b > 0.85 ? 1.5 : 0.8;
    ctx.fillRect(rnd() * 2048, rnd() * 1024, r, r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 16),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, toneMapped: false, fog: false }));
}

// ---- THE CARRIER: an actual warship, not two boxes ----
export function buildCarrier(aperture = null) {
  const ship = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x77828e, metalness: 0.45, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a525c, metalness: 0.4, roughness: 0.7 });
  const teal = new THREE.MeshBasicMaterial({ color: 0x4fe8e0, toneMapped: false });
  const amber = new THREE.MeshBasicMaterial({ color: 0xffce2e, toneMapped: false });
  const B = (mat, sx, sy, sz, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    ship.add(m); return m;
  };
  // hull line, prow (+x) to engines (-x): tapered segments
  const prow = new THREE.Mesh(new THREE.ConeGeometry(16, 60, 4), hull);
  prow.rotation.z = -Math.PI / 2;
  prow.rotation.y = Math.PI / 4;
  prow.scale.z = 2.2;
  prow.position.set(150, 0, 0);
  ship.add(prow);
  B(hull, 90, 22, 40, 76, 0, 0);       // fore hull
  if (aperture) {
    // same outer volume as the single mid-hull box, with a notch through the
    // +z flank where a hangar mouth opens (landfall's deck sits inside)
    const { x0, x1, y0, y1 } = aperture; // local coords on the mid-hull flank
    B(hull, 120, 30, 27, -20, 0, -13.5);                                  // back half, solid
    const fz = 13.5, fd = 27;                                             // front half, framed
    if (x0 > -80) B(hull, x0 - (-80), 30, fd, (-80 + x0) / 2, 0, fz);     // left of the mouth
    if (40 > x1) B(hull, 40 - x1, 30, fd, (x1 + 40) / 2, 0, fz);          // right of the mouth
    if (y0 > -15) B(hull, x1 - x0, y0 - (-15), fd, (x0 + x1) / 2, (-15 + y0) / 2, fz); // below
    if (15 > y1) B(hull, x1 - x0, 15 - y1, fd, (x0 + x1) / 2, (y1 + 15) / 2, fz);      // above
    B(teal, x1 - x0 + 2, 1.2, 1.2, (x0 + x1) / 2, y1 + 0.6, 27);          // mouth header glow
    B(teal, x1 - x0 + 2, 1.2, 1.2, (x0 + x1) / 2, y0 - 0.6, 27);          // mouth sill glow
  } else B(hull, 120, 30, 54, -20, 0, 0); // mid hull
  B(dark, 70, 36, 60, -110, 0, 0);     // aft block
  B(dark, 26, 26, 44, -158, 0, 0);     // engine housing
  for (const oz of [-14, 0, 14]) {     // engine bells + glow
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(6, 7.5, 10, 8), dark);
    bell.rotation.z = Math.PI / 2;
    bell.position.set(-176, 0, oz);
    ship.add(bell);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(5.4, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fd8ff, toneMapped: false }));
    glow.rotation.y = -Math.PI / 2;
    glow.position.set(-181.5, 0, oz);
    ship.add(glow);
  }
  // dorsal superstructure + bridge tower
  B(hull, 70, 10, 34, -10, 20, 0);
  B(hull, 34, 16, 22, -28, 33, 0);
  B(dark, 14, 12, 12, -20, 47, 0);     // bridge
  B(teal, 12, 0.9, 0.9, -20, 44, 6.4); // bridge window strips
  B(teal, 12, 0.9, 0.9, -20, 44, -6.4);
  B(dark, 2, 26, 2, -44, 46, 0);       // comm mast
  B(amber, 1.4, 1.4, 1.4, -44, 60, 0); // mast beacon
  // ventral keel
  B(dark, 90, 14, 8, -10, -20, 0);
  // side sponsons, turrets, window rows, edge strips.
  // When a bay APERTURE is cut into the +z flank, that side loses its sponson
  // and turrets — a launch bay replaces them (they were a wall across the mouth).
  for (const sz of [-1, 1]) {
    if (!(aperture && sz === 1)) {
      B(dark, 130, 10, 10, -14, -2, sz * 32);
      for (const tx of [40, -5, -60]) {
        B(dark, 8, 5, 8, tx, 17, sz * 20);
        B(dark, 10, 1.6, 1.6, tx + 6, 18, sz * 20); // barrels
      }
    }
    for (const wy of [4, -4]) B(amber, 100, 0.7, 0.7, 10, wy, sz * 27.4);
    B(teal, 200, 0.8, 0.8, -30, 15.4, sz * 27.5);
    B(teal, 200, 0.8, 0.8, -30, -15.4, sz * 27.5);
  }
  // THE DOCKING BAY: Star Wars style — a lit mouth in the flank with a real
  // launch room behind it. You take off out of it and the tractor sets you
  // back down inside it.
  const bay = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(26, 15, 1.8), teal);
  bay.add(frame);
  // the opening (dark) + interior room: floor, walls, roof, back wall, pad lights
  const roomD = 16;
  const irM = new THREE.MeshStandardMaterial({ color: 0x39414c, metalness: 0.3, roughness: 0.8 });
  const mk = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), irM);
    m.position.set(x, y, z); bay.add(m); return m;
  };
  mk(23, 1, roomD, 0, -6.5, -roomD / 2);      // floor
  mk(23, 1, roomD, 0, 6.5, -roomD / 2);       // roof
  mk(1, 13, roomD, -11.5, 0, -roomD / 2);     // walls
  mk(1, 13, roomD, 11.5, 0, -roomD / 2);
  mk(23, 13, 1, 0, 0, -roomD);                // back wall
  const padGlow = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 8),
    new THREE.MeshBasicMaterial({ color: 0x2fa89e, toneMapped: false }));
  padGlow.position.set(0, -5.9, -roomD / 2);
  bay.add(padGlow);
  const bayLight = new THREE.PointLight(0x9fdcff, 140, 40, 1.7);
  bayLight.position.set(0, 4, -roomD / 2);
  bay.add(bayLight);
  const bayLight2 = new THREE.PointLight(0x4fe8e0, 700, 110, 1.8);
  bayLight2.position.z = 10;
  bay.add(bayLight2);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x7fffee, toneMapped: false }));
  beacon.name = 'dockBeacon';
  beacon.position.z = 5;
  bay.add(beacon);
  bay.position.copy(DOCK).sub(CAP);
  ship.add(bay);
  // guidance pillar: a light column you can see across the dome (dock phase only)
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 260, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x7fffee, transparent: true, opacity: 0.25, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  pillar.name = 'dockPillar';
  pillar.visible = false;
  pillar.position.copy(DOCK).sub(CAP).add(new THREE.Vector3(0, 130, 0));
  ship.add(pillar);
  ship.position.copy(CAP);
  return ship;
}

// a boxy dart fighter; hostile = hi-vis orange, friendly wingmates get blue trim.
// Nose along -z for everyone.
export function buildFighter(hostile = false, friendly = false, tier = null, tint = null) {
  const grp = new THREE.Group();
  const vis = new THREE.Group();
  vis.rotation.y = Math.PI;
  if (tier) vis.scale.setScalar(tier.scale);
  grp.add(vis);
  grp.userData.vis = vis;
  const body = new THREE.MeshStandardMaterial({ color: hostile ? (tier?.body ?? 0xe8734d) : (tint?.body ?? 0x9aa6b4), metalness: 0.3, roughness: 0.55 });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: hostile ? (tier?.trim ?? 0xff3322) : (tint?.trim ?? (friendly ? 0x7fd8ff : 0x4fe8e0)),
    emissiveIntensity: hostile ? 2.6 : 1.6, toneMapped: false,
  });
  const M = (geo, mat, x, y, z, rx = 0, rz = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    vis.add(m); return m;
  };
  // slim spine, needle nose, bubble canopy, big SWEPT deltas, canted twin
  // tails, buried nacelles — a dart, not a shipping crate
  M(new THREE.BoxGeometry(0.82, 0.44, 3.6), body, 0, 0, 0.6);       // spine
  M(new THREE.BoxGeometry(0.6, 0.3, 1.4), body, 0, -0.1, -1.5);    // tail boat
  const nose = M(new THREE.ConeGeometry(0.4, 2.6, 6), body, 0, -0.03, 3.6, Math.PI / 2);
  nose.scale.x = 1.15; nose.scale.z = 0.55;                        // flattened needle
  M(new THREE.BoxGeometry(0.46, 0.26, 1.05), trim, 0, 0.3, 1.35).name = 'canopy';
  M(new THREE.BoxGeometry(0.5, 0.18, 0.5), body, 0, 0.26, 2.05, 0, 0, 0);   // windscreen fairing
  for (const sx of [-1, 1]) {
    M(new THREE.BoxGeometry(0.5, 0.07, 2.1), body, sx * 0.55, -0.06, 2.1, 0, 0, sx * -0.14); // chine strakes
    // delta wing: broad thin inner panel + raked tip, both swept hard back
    M(new THREE.BoxGeometry(2.3, 0.055, 2.2), body, sx * 1.3, -0.06, -0.15, 0, 0, sx * 0.62);
    M(new THREE.BoxGeometry(1.1, 0.05, 1.25), body, sx * 2.5, -0.06, -1.1, 0, 0, sx * 0.62);
    M(new THREE.BoxGeometry(0.14, 0.32, 0.95), trim, sx * 2.95, 0, -1.55, 0, 0, sx * 0.62); // wingtip blade
    M(new THREE.CylinderGeometry(0.24, 0.32, 2.0, 8), body, sx * 0.46, 0.02, -1.95, Math.PI / 2); // nacelle
    M(new THREE.BoxGeometry(0.42, 0.42, 0.12), trim, sx * 0.46, 0.02, -3.0);              // exhaust glow
    M(new THREE.BoxGeometry(0.07, 0.72, 1.15), hostile ? trim : body, sx * 0.34, 0.5, -1.7, 0, sx * -0.42); // canted tails
  }
  if (hostile) for (const sx of [-1, 1]) M(new THREE.BoxGeometry(0.07, 0.07, 1.7), trim, sx * 0.24, -0.22, 2.7); // chin cannons
  return grp;
}

// THE HEAVY: a strike bomber in the SAME family as the dart — stretched
// spine, broad swept deltas, four buried nacelles, a ventral bomb bay.
// Friendly hulls take squad tints; hostiles wear the raiders' burnt scheme
// with their own silhouette tells (intake ram, torpedo cheeks).
export function buildBomber(hostile = true, tint = null) {
  const grp = new THREE.Group();
  const vis = new THREE.Group();
  vis.rotation.y = Math.PI;
  grp.add(vis);
  grp.userData.vis = vis;
  const body = new THREE.MeshStandardMaterial({
    color: hostile ? 0xd8864a : (tint?.body ?? 0x8f9aa8), metalness: 0.35, roughness: 0.55,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: hostile ? 0xff4422 : (tint?.trim ?? 0x4fe8e0),
    emissiveIntensity: hostile ? 2.4 : 1.6, toneMapped: false,
  });
  const M = (geo, mat, x, y, z, rx = 0, rz = 0, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    vis.add(m); return m;
  };
  M(new THREE.BoxGeometry(1.15, 0.55, 5.4), body, 0, 0, 0.5);      // long spine
  M(new THREE.BoxGeometry(0.85, 0.4, 1.6), body, 0, -0.08, -2.4);  // tail boat
  const nose = M(new THREE.ConeGeometry(0.52, 2.8, 6), body, 0, -0.02, 4.4, Math.PI / 2);
  nose.scale.x = 1.2; nose.scale.z = 0.55;
  M(new THREE.BoxGeometry(0.6, 0.3, 1.35), trim, 0, 0.4, 1.9).name = 'canopy';
  M(new THREE.BoxGeometry(0.66, 0.2, 0.6), body, 0, 0.36, 2.75);   // windscreen fairing
  for (const sx of [-1, 1]) {
    M(new THREE.BoxGeometry(0.6, 0.09, 2.6), body, sx * 0.68, -0.06, 2.7, 0, 0, sx * -0.12); // chines
    // broad swept deltas, inner + raked tip + tip blade
    M(new THREE.BoxGeometry(3.0, 0.07, 2.9), body, sx * 1.7, -0.05, -0.3, 0, 0, sx * 0.55);
    M(new THREE.BoxGeometry(1.4, 0.06, 1.6), body, sx * 3.3, -0.05, -1.5, 0, 0, sx * 0.55);
    M(new THREE.BoxGeometry(0.16, 0.4, 1.2), trim, sx * 3.85, 0, -2.05, 0, 0, sx * 0.55);
    // four buried nacelles (two per side), exhaust glow
    for (const [nx, ny] of [[0.52, 0.12], [1.35, -0.02]]) {
      M(new THREE.CylinderGeometry(0.26, 0.34, 2.3, 8), body, sx * nx, ny, -2.5, Math.PI / 2);
      M(new THREE.BoxGeometry(0.46, 0.46, 0.14), trim, sx * nx, ny, -3.7);
    }
    M(new THREE.BoxGeometry(0.08, 0.85, 1.3), hostile ? trim : body, sx * 0.42, 0.55, -2.2, 0, sx * -0.4); // canted tails
  }
  // ventral bomb bay: the reason she flies
  M(new THREE.BoxGeometry(0.95, 0.42, 2.8), body, 0, -0.48, 0.7);
  M(new THREE.BoxGeometry(0.8, 0.06, 2.5), trim, 0, -0.7, 0.7);
  if (hostile) { // hostile tells: ram intake + torpedo cheeks
    M(new THREE.BoxGeometry(0.5, 0.5, 1.4), trim, 0, -0.3, 3.4);
    for (const sx of [-1, 1]) M(new THREE.CylinderGeometry(0.16, 0.16, 1.9, 6), trim, sx * 0.75, -0.3, 2.2, Math.PI / 2);
  }
  return grp;
}

// wraps a hangar deck in REAL space: star sphere + the colossal hull with
// the mouth aperture — the first brick of the one-world space patrol
export function buildSpaceAround(group, grid) {
  const xs = grid.mouth.map((m) => m.cx * 4);
  const mouthX0 = Math.min(...xs) - 2, mouthX1 = Math.max(...xs) + 2;
  const mouthZ = (grid.mouth[0].cy + 0.5) * 4;
  const W = grid.w * 4;
  const stars = starSphere();
  stars.scale.setScalar(2.6); // r ~2300 — beyond the hull
  stars.position.set(W / 2, 0, mouthZ / 2);
  group.add(stars);
  const S6 = 6;
  const C = new THREE.Vector3(W / 2 + 120, 20, mouthZ + 8 - 27 * S6);
  const aperture = {
    x0: (mouthX0 - 14 - C.x) / S6, x1: (mouthX1 + 14 - C.x) / S6,
    y0: (-10 - C.y) / S6, y1: (26 - C.y) / S6,
  };
  const hull = buildCarrier(aperture);
  hull.position.copy(C);
  hull.scale.setScalar(S6);
  group.add(hull);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.2);
  sun.position.set(-500, 400, 600);
  group.add(sun);
}

export function inSpace() { return !!S; }
export function _dbg() { return S ? { phase: S.phase, speed: +S.speed.toFixed(1), z: +S.ship.position.z.toFixed(1), kw: !!G.keys.KeyW } : (SB ? { boarding: SB.phase, t: +SB.t.toFixed(1) } : null); }

// ---- BOARDING: press E at a parked fighter — the canopy slides open, you
// climb in, it seals over you, the reactor spools, and HOLD W flies the ship
// itself across the hangar and out the mouth. ----
let SB = null;
const _sv = new THREE.Vector3();
// a LANDFALL deck hands the takeoff to landfall.js (registered there — no
// import cycle) — same scene, same coordinates, no seam
let landfallHook = null;
export function setLandfallHook(fn) { landfallHook = fn; }
const shipUp = (id) => (G.run?.shipUps?.[id] || 0);

export function startBoarding(npc, drill = false) {
  if (S || SB) return;
  const fs = G.floors.get(G.floor);
  const bs = fs?.boardShips?.find((b) => {
    const u = b.userData.boardShip;
    return (u.x - npc.x) ** 2 + (u.z - npc.z) ** 2 < 260;
  });
  if (!bs) { // no physical ship on this deck — legacy instant launch
    startSpaceFlight(null, false, drill, { x: npc.x, z: npc.z, floor: G.floor });
    return;
  }
  const ud = bs.userData.boardShip;
  if (ud.slot !== undefined && ud.slot !== mySlot()) {
    addMsg(`That's the ${SHIP_SLOTS[ud.slot]?.name || '?'} bird — yours is the ${SHIP_SLOTS[mySlot()].name} one.`, 'bad');
    return;
  }
  ud.open = true; // canopy slides back (dungeon animates it)
  bs.updateMatrixWorld(true);
  const eye = bs.userData.seatEye || new THREE.Vector3(0, 2.0, 2.6);
  SB = {
    phase: 'canopy', t: 0, bs, ud, speed: 0, drill,
    boardAt: { x: npc.x, z: npc.z, floor: G.floor, yaw: ud.yaw },
    from: G.camera.position.clone(), fromQ: G.camera.quaternion.clone(),
    seat: bs.localToWorld(eye.clone()),
    seatQ: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ud.yaw + Math.PI, 0)),
  };
  G.mode = 'space';
  for (const c of G.camera.children) c.visible = false;
  hidePrompt();
  sfx.chest();
  addMsg('Canopy open — climbing in…');
}

// ---- THE COCKPIT KIT: the furniture you see from the pilot seat. ONE
// builder used by the flight fighter AND the parked deck fighter, so the
// view when you climb in is EXACTLY the view when you fly — and it sits LOW
// so it never crowds the windshield. Frame: eye at origin, forward -z.
export function cockpitKit() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b3038, metalness: 0.4, roughness: 0.7 });
  const scrM = new THREE.MeshBasicMaterial({ color: 0x1f6e66, toneMapped: false });
  const amberM = new THREE.MeshBasicMaterial({ color: 0x8a5a24, toneMapped: false });
  const B = (mat, sx, sy, sz, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m); return m;
  };
  B(dark, 1.9, 0.3, 0.55, 0, -0.64, -1.15);                        // slim dash
  for (const wx of [-0.62, 0.62]) B(scrM, 0.34, 0.04, 0.18, wx, -0.47, -1.1, 0.35);
  for (const wx of [-0.3, 0, 0.3]) B(amberM, 0.1, 0.04, 0.07, wx, -0.5, -1.34);
  for (const sx of [-1, 1]) B(dark, 0.08, 1.3, 0.08, sx * 0.95, 0.07, -1.0, 0, sx * 0.42); // A-pillars
  B(dark, 1.7, 0.07, 0.07, 0, 0.74, -0.85);                        // top rail
  // THE MONITOR: a real screen on the dash — the radar/bombsight render HERE,
  // in the cockpit, not in a corner of your visor
  const mc = document.createElement('canvas');
  mc.width = 256; mc.height = 200;
  const mctx = mc.getContext('2d');
  mctx.fillStyle = '#04090b';
  mctx.fillRect(0, 0, 256, 200);
  const mtex = new THREE.CanvasTexture(mc);
  mtex.colorSpace = THREE.SRGBColorSpace;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.5, 0.05), dark);
  bezel.position.set(0, -0.36, -1.06);
  bezel.rotation.x = 0.42;
  g.add(bezel);
  const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.44),
    new THREE.MeshBasicMaterial({ map: mtex, toneMapped: false }));
  mon.position.set(0, -0.355, -1.028);
  mon.rotation.x = 0.42;
  g.add(mon);
  g.userData.monitor = { canvas: mc, tex: mtex };
  return g;
}

export function flashScreen() {
  let d = document.getElementById('launchflash');
  if (!d) {
    d = document.createElement('div');
    d.id = 'launchflash';
    d.style.cssText = 'position:fixed;inset:0;background:#eafcff;pointer-events:none;z-index:60;opacity:0';
    document.body.appendChild(d);
  }
  d.style.transition = 'none';
  d.style.opacity = '0.9';
  requestAnimationFrame(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; });
}

function launchHandoff(sealedHold = false) {
  const { drill, boardAt, speed, ud, bs, pre } = SB;
  // LANDFALL deck: no scene swap at all — the flight continues in the same
  // world the deck lives in, from the exact spot you crossed the mouth
  if (G.floors.get(G.floor)?.grid?.landfall && landfallHook) {
    const from = {
      pos: bs.position.clone().add(new THREE.Vector3(0, 1.85, 0)),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ud.yaw + Math.PI, 0)),
      speed, boardAt,
    };
    bs.position.set(ud.x, 0, ud.z);
    ud.open = false;
    if (bs.userData.canopyGroup) bs.userData.canopyGroup.position.copy(bs.userData.canClosed);
    for (const ch of bs.children) ch.visible = true; // whole again for the return
    bs.visible = false;                               // the pad is EMPTY while you fly
    from.boardAt.bsId = ud.id;
    SB = null;
    landfallHook(from);
    return;
  }
  // put the fighter back on its pad, canopy sealed, for your return
  bs.position.set(ud.x, 0, ud.z);
  ud.open = false;
  if (bs.userData.canopyGroup) bs.userData.canopyGroup.position.copy(bs.userData.canClosed);
  for (const ch of bs.children) ch.visible = true; // whole again for the return
  bs.visible = false;                               // …but GONE — you're flying it
  boardAt.bsId = ud.id;
  SB = null;
  // no flash: the sky was prebuilt during the spool — the cut is invisible
  startSpaceFlight(null, false, drill, boardAt, { pre, ...(sealedHold ? {} : { carrySpeed: Math.max(26, speed) }) });
}

function updateBoarding(dt) {
  SB.t += dt;
  const t = SB.t, ud = SB.ud, bs = SB.bs;
  const ease = (k) => k * k * (3 - 2 * k);
  if (G.keys['Escape'] && SB.phase !== 'takeoff') { // climb back out — no soft-lock
    G.keys['Escape'] = false;
    G.camera.quaternion.copy(SB.fromQ);
    for (const c of G.camera.children) c.visible = true;
    document.getElementById('waveHud')?.classList.add('hidden');
    ud.open = false; // canopy seals behind you
    for (const ch of bs.children) ch.visible = true; // the parked ship is whole again
    if (SB.pre) SB.pre.scene.group.traverse((n) => { if (n.isMesh) n.geometry.dispose(); });
    G.mode = 'playing';
    SB = null;
    addMsg('Climbed back out.');
    return;
  }
  if (SB.phase === 'canopy') {
    if (t >= 0.7) { SB.phase = 'mount'; SB.t = 0; }
  } else if (SB.phase === 'mount') {
    const k = ease(Math.min(1, t / 1.2));
    G.camera.position.lerpVectors(SB.from, SB.seat, k);
    G.camera.quaternion.slerpQuaternions(SB.fromQ, SB.seatQ, k);
    if (t >= 1.2) {
      SB.phase = 'power'; SB.t = 0;
      ud.open = false; // the canopy slides shut over you
      // seated view === flight view: hide everything but the cockpit kit
      for (const ch of bs.children) ch.visible = (ch === bs.userData.kit);
      const mon = bs.userData.kit?.userData?.monitor;
      if (mon) { // pre-flight boot screen until the flight system takes over
        const mx = mon.canvas.getContext('2d');
        mx.fillStyle = '#04090b';
        mx.fillRect(0, 0, mon.canvas.width, mon.canvas.height);
        mx.strokeStyle = 'rgba(79,232,224,0.7)';
        mx.lineWidth = 2;
        mx.strokeRect(3, 3, mon.canvas.width - 6, mon.canvas.height - 6);
        mx.fillStyle = '#7fffee';
        mx.font = '600 16px Menlo, monospace';
        mx.textAlign = 'center';
        mx.fillText('PRE-FLIGHT', mon.canvas.width / 2, mon.canvas.height / 2 - 10);
        mx.fillText('SYSTEMS GREEN', mon.canvas.width / 2, mon.canvas.height / 2 + 14);
        mon.tex.needsUpdate = true;
      }
      sfx.chest();
      sfx.rumble();
      G.shake = Math.max(G.shake || 0, 0.3);
      addMsg('Canopy sealed. Reactor spooling… systems green.', 'gold');
      // build the ENTIRE space scene NOW, while the reactor spools — the
      // launch handoff is then instant (this is what killed the black gap).
      // A LANDFALL deck skips this: its world is ALREADY out the mouth.
      if (!G.floors.get(G.floor)?.grid?.landfall) {
        const lvl = (G.run.patrolLvl || 0) + 1;
        const comp = SB.drill ? { name: 'DOCKING DRILL', list: [], bombers: 0 } : compositionFor(lvl);
        SB.pre = { lvl, comp, drill: SB.drill, scene: buildSpaceScene(lvl, comp) };
      }
    }
  } else if (SB.phase === 'power') {
    if (t >= 1.4) {
      SB.phase = 'ready'; SB.t = 0;
      document.getElementById('waveHud')?.classList.remove('hidden');
    }
  } else if (SB.phase === 'ready') {
    const wh = document.getElementById('waveHud');
    if (wh) wh.textContent = 'HOLD W TO LAUNCH';
    if (G.keys['KeyW']) {
      SB.phase = 'takeoff'; SB.t = 0;
      const fs = G.floors.get(G.floor);
      SB.mouthZ = fs?.grid?.mouth?.length ? (fs.grid.mouth[0].cy + 1.5) * CELL : null;
      sfx.stairs();
    }
  } else if (SB.phase === 'takeoff') {
    if (G.keys['KeyW']) SB.speed = Math.min(40, SB.speed + 16 * dt);
    else SB.speed = Math.max(4, SB.speed - 10 * dt);
    bs.position.y = Math.min(1.6, bs.position.y + 1.1 * dt); // off the pad
    const wh = document.getElementById('waveHud');
    if (SB.mouthZ != null) {
      // fly the REAL hangar: it streams past the canopy on the way out
      const s0 = Math.sin(ud.yaw), c0 = Math.cos(ud.yaw);
      bs.position.x += s0 * SB.speed * dt;
      bs.position.z += c0 * SB.speed * dt;
      G.shake = Math.max(G.shake || 0, Math.min(0.2, SB.speed * 0.004));
      if (wh) wh.textContent = SB.speed < 6 ? 'HOLD W TO LAUNCH' : 'LAUNCHING…';
      if (bs.position.z > SB.mouthZ + 4) { launchHandoff(false); return; }
    } else {
      // a sealed hold — no mouth to fly out of; punch out on instruments
      if (wh) wh.textContent = 'LAUNCHING…';
      G.shake = Math.max(G.shake || 0, 0.25);
      if (t > 1.5) { launchHandoff(true); return; }
    }
    // camera riveted to the seat
    bs.updateMatrixWorld(true);
    const eye = bs.userData.seatEye || _sv.set(0, 2.0, 2.6);
    G.camera.position.copy(bs.localToWorld(_sv.copy(eye)));
    G.camera.quaternion.copy(SB.seatQ);
  }
}

// everything in the sky, built once — either during the reactor spool
// (instant handoff) or on demand (?fly=1 direct links)
function buildSpaceScene(lvl, comp) {
  const group = new THREE.Group();
  group.position.copy(ORIGIN);
  group.add(starSphere());
  group.add(buildCarrier());
  // THE FORCE FIELD: the dome the raiders punched through — you defend inside it
  const field = new THREE.Mesh(
    new THREE.SphereGeometry(FIELD_R, 32, 20),
    new THREE.MeshBasicMaterial({ color: 0x4fe8e0, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false, toneMapped: false }));
  field.name = 'field';
  group.add(field);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(300, 200, 100);
  group.add(sun, new THREE.AmbientLight(0x445066, 1.4));

  const ship = buildFighter(false);
  ship.userData.vis.visible = false; // pure window cockpit
  const kit = cockpitKit(); // the same console you climbed into on the deck
  kit.position.set(0, 0.78, -0.35);
  ship.add(kit);
  ship.userData.monitor = kit.userData.monitor;
  // you launch FROM the bay room, nose out (+z)
  ship.position.copy(BAYIN);
  ship.quaternion.setFromEuler(new THREE.Euler(0, Math.PI, 0)); // nose -z flipped => flying +z
  group.add(ship);

  // the intruders
  const foes = [];
  let idx = 0;
  const place = (f, r) => {
    const a = Math.random() * Math.PI * 2;
    f.position.set(Math.cos(a) * r, (Math.random() - 0.5) * 80, Math.sin(a) * r - 40);
    f.quaternion.setFromEuler(new THREE.Euler(0, a + Math.PI / 2, 0));
  };
  for (const [tierId, n] of comp.list) {
    const tier = TIERS[tierId];
    for (let i = 0; i < n; i++) {
      const f = buildFighter(true, false, tier);
      f.scale.setScalar(1.8); // space ships match the ones on the deck
      place(f, 150);
      f.userData = {
        ...f.userData, i: idx++, type: 'fighter', tier: tierId, hp: tier.hp,
        state: 'lineup', stateT: 0, fireT: 1, burstLeft: 0,
        speed: (tier.spd + Math.random() * tier.spdV) * (lvl >= 5 ? 1.12 : 1),
      };
      group.add(f); foes.push(f);
    }
  }
  for (let i = 0; i < comp.bombers; i++) {
    const f = buildBomber(true);
    f.scale.setScalar(1.7);
    place(f, 260);
    f.userData = { ...f.userData, i: idx++, type: 'bomber', hp: 8, state: 'attack', stateT: 0, fireT: 2, speed: 13, aim: CAP.clone().add(new THREE.Vector3((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 30)) };
    group.add(f); foes.push(f);
  }
  // YOUR SIDE flies too: allied darts working their own corners of the fight
  // (they chip in, they don't carry you)
  const allies = [];
  if (comp.list.length) {
    for (let i = 0; i < 3; i++) {
      const a = buildFighter(false, true);
      a.scale.setScalar(1.8);
      place(a, 120);
      a.userData = { ...a.userData, type: 'ally', aiT: Math.random() * 2, fireT: 1 + Math.random() * 2, target: null, speed: 30 + Math.random() * 8 };
      group.add(a); allies.push(a);
    }
  }
  return { group, ship, foes, allies };
}

export function startSpaceFlight(level = null, fromNet = false, drill = false, boardAt = null, opts = null) {
  if (S) return;
  if (fromNet && G.mode !== 'playing') { addMsg('The patrol launched without you.'); return; }
  const pre = opts?.pre;
  const lvl = pre?.lvl ?? level ?? (G.run.patrolLvl || 0) + 1;
  const comp = pre?.comp ?? (drill ? { name: 'DOCKING DRILL', list: [], bombers: 0 } : compositionFor(lvl));
  // prebuilt during the reactor spool (instant, no black gap) or built now
  const { group, ship, foes, allies } = pre?.scene ?? buildSpaceScene(lvl, comp);
  G.scene.add(group);

  S = {
    group, ship, foes, allies: allies || [], bolts: [], fx: [], remote: new Map(),
    speed: 0, vel: new THREE.Vector3(0, 0, 0), bank: 0, weapon: 0, lock: null,
    hull: 100 + 25 * shipUp('hull'), maxHull: 100 + 25 * shipUp('hull'),
    maxSpeed: 70 + 8 * shipUp('engine'),
    carrierHp: 100, kills: 0, t: 0, fireCd: 0, level: lvl, comp,
    phase: 'launch', afterLaunch: drill ? 'dock' : 'fight', drill, boardAt, netT: 0, foeT: 0, scrapeT: 0,
    time0: G.time || 0, prevFog: G.scene.fog.density, prevBg: G.scene.background.getHex(), prevFar: G.camera.far,
    isHost: G.net.role !== 'guest',
  };
  // the deck you launched from is not scenery in the void — hide the floor
  // (it read as a moon with an unreachable battle below the dome)
  const fsHide = G.floors.get(G.floor);
  S.hidFs = fsHide || null;
  if (fsHide) for (const grp2 of [fsHide.meshGroup, fsHide.enemyGroup, fsHide.lootGroup]) {
    if (grp2) grp2.visible = false;
  }
  G.camera.far = 2400;
  G.camera.updateProjectionMatrix();
  G.scene.fog.density = 0.00012;
  G.scene.background.setHex(0x020409);
  G.mode = 'space';
  for (const c of G.camera.children) c.visible = false;
  document.getElementById('waveHud')?.classList.remove('hidden');
  const tr = document.getElementById('topright');
  if (tr) tr.style.display = 'none'; // the radar lives on the dash monitor now
  if (opts?.carrySpeed) {
    // you already flew out of a hangar mouth under your own power — pick up
    // just outside the carrier bay at the speed you left with
    S.ship.position.set(DOCK.x, DOCK.y, DOCK.z + 16);
    S.speed = opts.carrySpeed;
    S.phase = S.afterLaunch;
    addMsg(drill ? 'You punch out into open space. Fly the pattern, then come home to the beacon.'
      : 'You punch out into open space — hostiles in the dome. Good hunting.', 'gold');
  }
  if (drill) {
    addMsg('DOCKING DRILL — empty sky. ARROWS steer, W/S throttle. Follow the light pillar to the bay and fly in.', 'gold');
  } else {
    addMsg(`VOID PATROL LV${lvl} — ${comp.name}. ARROWS steer, W/S throttle, A/D roll, SPACE fires, T locks a target.`, 'gold');
    if (comp.bombers) addMsg('BOMBERS INBOUND — they are here for the CARRIER. Lose her and the campaign is over.', 'bad');
  }
  sfx.stairs();
  if (!fromNet && G.net.role !== 'solo') netSend({ t: 'spatrol', lvl });
}

function endSpaceFlight(result) {
  if (!S) return;
  if (S.drill && result === 'CLEARED') result = 'DOCKED';
  const credits = result === 'CLEARED' ? 100 + S.level * 40 + S.kills * 25 : 0;
  G.run.gold += credits;
  if (result === 'CLEARED') G.run.patrolLvl = Math.max(G.run.patrolLvl || 0, S.level);
  saveReport({ section: `VOID PATROL LV${S.level}`, result, kills: S.kills, credits, time: Math.round((G.time || 0) - S.time0) });
  if (G.net.role !== 'solo') netSend({ t: 'sleave' });
  if (S.hidFs) for (const grp2 of [S.hidFs.meshGroup, S.hidFs.enemyGroup, S.hidFs.lootGroup]) {
    if (grp2) grp2.visible = true;
  }
  // your bird comes home with you
  if (S.boardAt?.bsId && S.hidFs?.boardShips) {
    const bsBack = S.hidFs.boardShips.find((b) => b.userData.boardShip.id === S.boardAt.bsId);
    if (bsBack) bsBack.visible = true;
  }
  G.scene.remove(S.group);
  G.scene.fog.density = S.prevFog;
  G.scene.background.setHex(S.prevBg);
  G.camera.far = S.prevFar;
  G.camera.updateProjectionMatrix();
  G.keys['Escape'] = false;
  for (const c of G.camera.children) c.visible = true;
  document.getElementById('waveHud')?.classList.add('hidden');
  const trE = document.getElementById('topright');
  if (trE) trE.style.display = '';
  hideLockWidgets();
  const lost = result === 'CARRIER LOST';
  const boardAt = S.boardAt;
  S = null;
  G.mode = 'playing';
  if (boardAt && G.floor === boardAt.floor && G.player) {
    // set down beside the dropship you took off in — same room, same pad
    G.player.obj.position.set(boardAt.x, 0, boardAt.z + 2);
    G.player.obj.position.y = 0;
    if (boardAt.yaw !== undefined) G.player.camYaw = boardAt.yaw; // face the hangar, not the sealed ramp
    addMsg('The tractor sets you down on the hangar pad.', 'gold');
  }
  if (result === 'DOCKED') { addMsg('Docked clean. Drill complete.', 'gold'); sfx.levelup(); }
  else if (result === 'CLEARED') { addMsg(`Docked. Patrol LV${G.run.patrolLvl} clear — +${credits} credits.`, 'gold'); sfx.victory(); }
  else if (!lost) addMsg('Fighter recovered by tether.', 'bad');
  refreshHud();
  if (lost) hooks.onCarrierLost?.();
}

// ---- explosions that FEEL like explosions ----
function explode(pos, big = false) {
  if (!S) return;
  spawnBurst(pos.clone().add(ORIGIN), 0xffcc66, big ? 34 : 22, big ? 10 : 7, 0.16, big ? 1.1 : 0.8);
  spawnBurst(pos.clone().add(ORIGIN), 0xff5522, big ? 24 : 14, big ? 7 : 5, 0.14, 0.7);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 3.4 : 2.0, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, toneMapped: false }));
  flash.position.copy(pos);
  S.group.add(flash);
  S.fx.push({ mesh: flash, t: 0, dur: 0.45, kind: 'flash' });
  for (let i = 0; i < (big ? 7 : 4); i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.5 + Math.random() * 0.6, 0.4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x66564a, metalness: 0.4, roughness: 0.8 }));
    d.position.copy(pos);
    d.userData.v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(9 + Math.random() * 14);
    d.userData.rot = new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5);
    S.group.add(d);
    S.fx.push({ mesh: d, t: 0, dur: 1.5, kind: 'debris' });
  }
  sfx.cannon();
  if (big) sfx.rumble();
}

function killFoe(f, broadcast = true, byAlly = false) {
  if (f.userData.hp > 0) f.userData.hp = 0;
  explode(f.position, f.userData.type === 'bomber');
  f.visible = false;
  if (!byAlly) S.kills++;
  if (broadcast && S.isHost && G.net.role !== 'solo') netSend({ t: 'sboom', i: f.userData.i });
}

function hurtPlayer(n) {
  S.hull -= n;
  G.shake = Math.max(G.shake || 0, 0.5);
  sfx.hurt();
  if (S.hull <= 0) endSpaceFlight('RECOVERED');
}

function hurtCarrier(n, at) {
  S.carrierHp -= n;
  explode(at || CAP.clone().add(new THREE.Vector3(0, 20, 0)), true);
  addMsg(`The CARRIER is hit! Integrity ${Math.max(0, Math.round(S.carrierHp))}%`, 'bad');
  if (S.carrierHp <= 0) {
    // she goes up — and the campaign goes with her
    for (let i = 0; i < 6; i++) {
      explode(CAP.clone().add(new THREE.Vector3((Math.random() - 0.5) * 220, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 50)), true);
    }
    if (S.isHost && G.net.role !== 'solo') netSend({ t: 'slost' });
    endSpaceFlight('CARRIER LOST');
  }
}

export function spaceMouse() { /* flight is fully button-driven */ }

// ---- TARGET LOCK: never lose the bandit again. T cycles targets; the lock
// gets a bracket when on screen and an edge arrow when it isn't, seekers
// prefer it, and the cube radar rings it. Landfall reuses the same widgets. ----
export function lockWidgets() {
  let br = document.getElementById('lockbr');
  if (!br) {
    br = document.createElement('div');
    br.id = 'lockbr';
    br.style.cssText = 'position:fixed;width:46px;height:46px;border:2px solid #7fffee;border-radius:4px;pointer-events:none;z-index:40;display:none;box-shadow:0 0 8px rgba(127,255,238,.5)';
    const lab = document.createElement('div');
    lab.id = 'lockbrLab';
    lab.style.cssText = 'position:absolute;top:48px;left:50%;transform:translateX(-50%);color:#7fffee;font:600 11px Menlo,monospace;text-shadow:0 0 4px #000;white-space:nowrap';
    br.appendChild(lab);
    document.body.appendChild(br);
  }
  let ar = document.getElementById('lockarrow');
  if (!ar) {
    ar = document.createElement('div');
    ar.id = 'lockarrow';
    ar.style.cssText = 'position:fixed;color:#7fffee;font-size:30px;pointer-events:none;z-index:40;display:none;text-shadow:0 0 8px rgba(127,255,238,.8)';
    ar.textContent = '➤';
    document.body.appendChild(ar);
  }
  return { br, ar };
}
export function hideLockWidgets() {
  const br = document.getElementById('lockbr'), ar = document.getElementById('lockarrow');
  if (br) br.style.display = 'none';
  if (ar) ar.style.display = 'none';
}
const _lp = new THREE.Vector3();
// place bracket/arrow for a WORLD position; label e.g. "412m"
export function drawLockAt(worldPos, label, color = '#7fffee') {
  const { br, ar } = lockWidgets();
  _lp.copy(worldPos).project(G.camera);
  const behind = _lp.z > 1;
  const onScreen = !behind && Math.abs(_lp.x) < 0.93 && Math.abs(_lp.y) < 0.9;
  if (onScreen) {
    br.style.display = 'block';
    ar.style.display = 'none';
    br.style.borderColor = color;
    br.style.left = `${(_lp.x + 1) / 2 * innerWidth - 23}px`;
    br.style.top = `${(1 - _lp.y) / 2 * innerHeight - 23}px`;
    const lab = document.getElementById('lockbrLab');
    if (lab) { lab.textContent = label; lab.style.color = color; }
  } else {
    // clamp to the screen edge, point the arrow at it
    br.style.display = 'none';
    ar.style.display = 'block';
    ar.style.color = color;
    let dx = behind ? -_lp.x : _lp.x, dy = behind ? -_lp.y : _lp.y;
    const m = Math.max(Math.abs(dx), Math.abs(dy), 0.0001);
    dx /= m; dy /= m;
    const px = (dx * 0.88 + 1) / 2 * innerWidth, py = (1 - dy * 0.88) / 2 * innerHeight;
    ar.style.left = `${px - 15}px`;
    ar.style.top = `${py - 15}px`;
    ar.style.transform = `rotate(${Math.atan2(-dy, dx)}rad)`;
  }
}

// R: lock HOME — the docking bay gets the bracket/arrow so it's never lost
export function spaceHomeLock() {
  if (!S) return;
  S.homeLock = !S.homeLock;
  if (S.homeLock) { S.lock = null; addMsg('NAV LOCK: the docking bay.', 'gold'); }
  else hideLockWidgets();
  sfx.key();
}

export function spaceCycleLock() {
  if (!S) return;
  const alive = S.foes.filter((f) => f.userData.hp > 0);
  if (!alive.length) { S.lock = null; hideLockWidgets(); addMsg('No contacts to lock.'); return; }
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
  alive.sort((a, b) => {
    const aa = a.position.clone().sub(S.ship.position).normalize().angleTo(nose);
    const bb = b.position.clone().sub(S.ship.position).normalize().angleTo(nose);
    return aa - bb;
  });
  S.homeLock = false;
  const i = alive.indexOf(S.lock);
  S.lock = alive[(i + 1) % alive.length];
  const ud = S.lock.userData;
  addMsg(`LOCK: ${ud.type === 'bomber' ? 'BOMBER' : (ud.tier || 'fighter').toUpperCase()}`, 'gold');
  sfx.key();
}

export function spaceSetWeapon(i) {
  if (!S || i < 0 || i >= WEAPONS.length || S.weapon === i) return;
  S.weapon = i;
  addMsg(`Weapon: ${WEAPONS[i].name}`);
  sfx.key();
}

function mkBolt(pos, dir, { color = 0x4fe8e0, vel = 230, life = 1.1, dmg = 1, seek = null, wide = false } = {}) {
  const b = wide
    ? new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }))
    : new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  b.position.copy(pos);
  if (wide) b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  else b.lookAt(pos.clone().add(dir));
  b.userData = { dir: dir.clone(), vel, life, dmg, mine: true, seek };
  S.group.add(b);
  S.bolts.push(b);
  return b;
}

export function spaceFire() {
  if (!S || S.fireCd > 0) return;
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
  const w = S.weapon;
  S.fireCd = WEAPONS[w].cd * (1 - 0.12 * shipUp('guns'));
  if (w === 0) {
    // PULSE: twin fast lasers off the wingtips
    for (const side of [-1, 1]) {
      const off = new THREE.Vector3(side * 2.95, 0, -1.5).applyQuaternion(S.ship.quaternion);
      mkBolt(S.ship.position.clone().add(off), dir, { dmg: 1 + Math.floor(shipUp('guns') / 2) });
    }
  } else if (w === 1) {
    // SCATTER: a cone of six short-lived bolts — brutal up close
    for (let i = 0; i < 6; i++) {
      const jd = dir.clone()
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.24, (Math.random() - 0.5) * 0.24))
        .normalize();
      mkBolt(S.ship.position.clone().addScaledVector(dir, 2), jd, { color: 0xffce2e, vel: 190, life: 0.45 });
    }
  } else {
    // SEEKERS: one homing missile — your LOCK first, else nearest to the nose
    let target = (S.lock && S.lock.userData.hp > 0
      && dir.angleTo(S.lock.position.clone().sub(S.ship.position).normalize()) < 0.9) ? S.lock : null;
    let best = 0.5;
    if (!target) for (const f of S.foes) {
      if (f.userData.hp <= 0) continue;
      const to = f.position.clone().sub(S.ship.position).normalize();
      const ang = dir.angleTo(to);
      if (ang < best) { best = ang; target = f; }
    }
    mkBolt(S.ship.position.clone().addScaledVector(dir, 2).add(new THREE.Vector3(0, -0.6, 0)),
      dir, { color: 0xff8855, vel: 85, life: 4.5, dmg: 3, seek: target, wide: true });
    addMsg(target ? `Seeker away — locked on the ${target.userData.type === 'bomber' ? 'bomber' : target.userData.tier}.` : 'Seeker away — no lock, flying straight.');
  }
  sfx.bolt();
  if (G.net.role !== 'solo') {
    const p = S.ship.position;
    netSend({ t: 'sbolt', p: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], d: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)], k: w });
  }
}

// wingmates, remote fire, host foe sync — every s* message lands here
export function onSpaceNet(m, pid) {
  if (m.t === 'spatrol') { startSpaceFlight(m.lvl, true); return; }
  if (!S) return;
  const who = m.pid || pid;
  if (m.t === 'sp') {
    let r = S.remote.get(who);
    if (!r) {
      const grp = buildFighter(false, true, null, SHIP_SLOTS[slotOf(who)]);
      grp.scale.setScalar(1.8);
      S.group.add(grp);
      r = { grp, tp: new THREE.Vector3(), tq: new THREE.Quaternion() };
      S.remote.set(who, r);
    }
    r.tp.fromArray(m.p);
    r.tq.fromArray(m.q);
  } else if (m.t === 'sbolt') {
    const kind = m.k || 0;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, kind === 2 ? 1.8 : 2.6),
      new THREE.MeshBasicMaterial({ color: kind === 1 ? 0xffe08a : kind === 2 ? 0xffaa77 : 0x7fd8ff, toneMapped: false }));
    b.position.fromArray(m.p);
    b.userData = { dir: new THREE.Vector3().fromArray(m.d), vel: kind === 2 ? 85 : 230, life: kind === 2 ? 4.5 : 1.1, mine: false, cosmetic: true };
    b.lookAt(b.position.clone().add(b.userData.dir));
    S.group.add(b);
    S.bolts.push(b);
  } else if (m.t === 'sdmg' && S.isHost) {
    const f = S.foes[m.i];
    if (f && f.userData.hp > 0) {
      f.userData.hp -= m.d;
      if (f.userData.hp <= 0) killFoe(f);
    }
  } else if (m.t === 'sfoe' && !S.isHost) {
    for (const row of m.f) {
      const f = S.foes[row[0]];
      if (!f) continue;
      f.position.set(row[1], row[2], row[3]);
      f.quaternion.set(row[4], row[5], row[6], row[7]);
      if (row[8] <= 0 && f.userData.hp > 0) { f.userData.hp = 0; f.visible = false; }
      else f.userData.hp = row[8];
    }
    if (m.c !== undefined) S.carrierHp = m.c;
  } else if (m.t === 'sboom') {
    const f = S.foes[m.i];
    if (f && f.visible) { f.userData.hp = 0; killFoe(f, false); }
  } else if (m.t === 'slost' && !S.isHost) {
    endSpaceFlight('CARRIER LOST');
  } else if (m.t === 'sleave') {
    const r = S.remote.get(who);
    if (r) { S.group.remove(r.grp); S.remote.delete(who); }
  }
}

export function updateSpace(dt) {
  window.__sph = SB ? 'sb:' + SB.phase : (S ? S.phase : null); // probe hook
  if (SB) { updateBoarding(dt); return; }
  if (!S) return;
  S.t += dt;
  S.fireCd -= dt;
  if (G.keys['Escape'] && S.phase !== 'tractor') { endSpaceFlight('RECOVERED'); return; }

  // LAUNCH: sitting in the bay — HOLD W and punch out through the mouth
  if (S.phase === 'launch') {
    if (G.keys['KeyW']) S.speed = Math.min(46, S.speed + 22 * dt);
    else S.speed = Math.max(0, S.speed - 30 * dt);
    const fwdL = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
    S.vel.copy(fwdL).multiplyScalar(S.speed);
    S.ship.position.addScaledVector(S.vel, dt);
    const upL = new THREE.Vector3(0, 1, 0).applyQuaternion(S.ship.quaternion);
    G.camera.position.copy(S.ship.position).addScaledVector(upL, 0.78).addScaledVector(fwdL, 0.35).add(ORIGIN);
    G.camera.quaternion.copy(S.ship.quaternion);
    const wh0 = document.getElementById('waveHud');
    if (wh0) wh0.textContent = S.speed < 2 ? 'HOLD W TO LAUNCH' : 'LAUNCHING…';
    if (S.ship.position.z > DOCK.z + 10) {
      S.phase = S.afterLaunch;
      S.speed = Math.max(S.speed, 26);
      addMsg(S.drill ? 'Clear of the bay. Fly the pattern, then come home to the beacon.' : 'Clear of the bay — hostiles in the dome. Good hunting.', 'gold');
    }
    return;
  }

  // TRACTOR: the bay has you — hands off, it sets you down inside
  if (S.phase === 'tractor') {
    S.trT += dt;
    const k = Math.min(1, S.trT / 3.4);
    const ease = k * k * (3 - 2 * k);
    const mid = DOCK.clone().add(new THREE.Vector3(0, 0, 14));
    const p1 = new THREE.Vector3().lerpVectors(S.trFrom, mid, ease);
    const p2 = new THREE.Vector3().lerpVectors(mid, BAYIN, ease);
    S.ship.position.lerpVectors(p1, p2, ease);
    const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)); // nose inward
    S.ship.quaternion.slerp(tq, Math.min(1, dt * 2.5));
    const fwdT = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
    const upT = new THREE.Vector3(0, 1, 0).applyQuaternion(S.ship.quaternion);
    G.camera.position.copy(S.ship.position).addScaledVector(upT, 0.78).addScaledVector(fwdT, 0.35).add(ORIGIN);
    G.camera.quaternion.copy(S.ship.quaternion);
    const whT = document.getElementById('waveHud');
    if (whT) whT.textContent = 'TRACTOR LOCK — the bay has you';
    if (k >= 1) endSpaceFlight('CLEARED');
    return;
  }

  // FULLY BUTTON-DRIVEN, TRUE COCKPIT AXES — loops, rolls, inverted, all of it
  if (G.keys['KeyW']) S.speed = Math.min(S.maxSpeed, S.speed + 30 * dt);
  if (G.keys['KeyS']) S.speed = Math.max(12, S.speed - 34 * dt);
  const yawIn = (G.keys['ArrowLeft'] ? 1 : 0) - (G.keys['ArrowRight'] ? 1 : 0);
  const pitchIn = (G.keys['ArrowUp'] ? 1 : 0) - (G.keys['ArrowDown'] ? 1 : 0);
  const rollIn = (G.keys['KeyA'] ? 1 : 0) - (G.keys['KeyD'] ? 1 : 0);
  if (G.keys['Space']) spaceFire();
  const qd = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchIn * 1.35 * dt, yawIn * 1.6 * dt, rollIn * 3.2 * dt, 'YXZ'));
  S.ship.quaternion.multiply(qd);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.ship.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(S.ship.quaternion);
  S.vel.lerp(fwd.clone().multiplyScalar(S.speed), Math.min(1, dt * 4));
  S.ship.position.addScaledVector(S.vel, dt);
  S.bank = S.bank + ((yawIn * 0.4) - S.bank) * Math.min(1, dt * 5);

  // the force field is the wall — and you can SEE it complain
  if (S.ship.position.length() > FIELD_R - 4) {
    const n = S.ship.position.clone().normalize();
    const out = S.vel.dot(n);
    if (out > 0) S.vel.addScaledVector(n, -out);
    S.ship.position.setLength(FIELD_R - 4);
    const field = S.group.getObjectByName('field');
    if (field) field.material.opacity = 0.16;
  }
  const fieldM = S.group.getObjectByName('field');
  if (fieldM && fieldM.material.opacity > 0.05) fieldM.material.opacity = Math.max(0.05, fieldM.material.opacity - dt * 0.3);

  // cockpit camera
  const camPos = S.ship.position.clone().addScaledVector(up, 0.78).addScaledVector(fwd, 0.35).add(ORIGIN);
  G.camera.position.copy(camPos);
  G.camera.quaternion.copy(S.ship.quaternion);
  G.camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, S.bank)));

  // the carrier is SOLID — per-SEGMENT boxes that hug the hull, not one slab.
  // During the dock phase the bay tractor owns the last 40m: no collision there,
  // or the approach corridor would bounce you off the deck you're landing on.
  const docking = (S.phase === 'dock' || S.phase === 'tractor') && S.ship.position.distanceTo(DOCK) < 55;
  if (!docking) {
    const hp2 = S.ship.position;
    for (const HB of CARRIER_BOXES) {
      if (Math.abs(hp2.x - HB.x) >= HB.hx || Math.abs(hp2.y - HB.y) >= HB.hy || Math.abs(hp2.z - HB.z) >= HB.hz) continue;
      const dx = HB.hx - Math.abs(hp2.x - HB.x), dy = HB.hy - Math.abs(hp2.y - HB.y), dz = HB.hz - Math.abs(hp2.z - HB.z);
      const sgn = (v) => (v >= 0 ? 1 : -1);
      if (dx < dy && dx < dz) { hp2.x += sgn(hp2.x - HB.x) * (dx + 0.5); S.vel.x *= -0.4; }
      else if (dy < dz) { hp2.y += sgn(hp2.y - HB.y) * (dy + 0.5); S.vel.y *= -0.4; }
      else { hp2.z += sgn(hp2.z - HB.z) * (dz + 0.5); S.vel.z *= -0.4; }
      if (S.t > S.scrapeT) { S.scrapeT = S.t + 0.6; hurtPlayer(10); }
      if (!S) return;
      spawnBurst(hp2.clone().add(ORIGIN), 0xffaa55, 14, 5, 0.14, 0.5);
      break;
    }
  }

  // wingmates drift toward their reported positions
  for (const r of S.remote.values()) {
    r.grp.position.lerp(r.tp, Math.min(1, dt * 8));
    r.grp.quaternion.slerp(r.tq, Math.min(1, dt * 8));
  }

  // ---- foes (host simulates; guests render synced state) ----
  if (S.isHost) {
    for (const f of S.foes) {
      const ud = f.userData;
      if (ud.hp <= 0) continue;
      const toP = S.ship.position.clone().sub(f.position);
      const d = toP.length();
      toP.normalize();
      const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quaternion);
      ud.stateT += dt;
      if (ud.type === 'fighter') {
        // STRAFING RUNS: line up far out, run STRAIGHT, egress straight, repeat
        if (ud.state === 'lineup') {
          const dir = S.ship.position.clone().sub(f.position).normalize();
          const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
          f.quaternion.rotateTowards(tq, 0.7 * dt);
          f.position.addScaledVector(nose, ud.speed * 0.55 * dt);
          if (nose.angleTo(dir) < 0.12) { ud.state = 'run'; ud.stateT = 0; }
        } else if (ud.state === 'run') {
          // dead straight, a whisper of tracking, guns hot
          const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), toP);
          f.quaternion.rotateTowards(tq, 0.15 * dt);
          f.position.addScaledVector(nose, ud.speed * dt);
          ud.fireT -= dt;
          const tier = TIERS[ud.tier] || TIERS.raider;
          if (ud.burstLeft > 0 && ud.fireT <= 0) {
            ud.burstLeft--;
            ud.fireT = 0.12;
            foeShot(f, nose, tier.boltC);
          } else if (ud.fireT <= 0 && d < 120 && nose.angleTo(toP) < 0.3) {
            ud.fireT = tier.cad + Math.random() * tier.cadV;
            ud.burstLeft = tier.burst - 1;
            foeShot(f, nose, tier.boltC);
          }
          if (toP.dot(nose) < -0.2 || ud.stateT > 7) { ud.state = 'egress'; ud.stateT = 0; }
        } else { // egress: straight out, no turning — the flyby
          f.position.addScaledVector(nose, ud.speed * dt);
          if (ud.stateT > 2.6 + (ud.i % 3) * 0.5) { ud.state = 'lineup'; ud.stateT = 0; }
        }
      } else {
        // BOMBER: bore straight in on the carrier, loose torpedoes, swing out
        const toC = ud.aim.clone().sub(f.position);
        const dc = toC.length();
        toC.normalize();
        if (ud.state === 'attack') {
          const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), toC);
          f.quaternion.rotateTowards(tq, 0.35 * dt);
          f.position.addScaledVector(nose, ud.speed * dt);
          ud.fireT -= dt;
          if (ud.fireT <= 0 && dc < 130 && nose.angleTo(toC) < 0.35) {
            ud.fireT = 2.6;
            torpedo(f, toC);
          }
          if (dc < 46) { ud.state = 'egress'; ud.stateT = 0; }
        } else {
          f.position.addScaledVector(nose, ud.speed * 1.4 * dt);
          const sideq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3 * dt, 0));
          f.quaternion.multiply(sideq);
          if (ud.stateT > 5) { ud.state = 'attack'; ud.stateT = 0; }
        }
      }
      // collision with the player: metal on metal, never intentional
      if (d < 4.4) {
        ud.hp -= 2;
        explode(f.position, false);
        if (ud.hp <= 0) killFoe(f);
        hurtPlayer(14);
        if (!S) return;
        const away = S.ship.position.clone().sub(f.position).normalize();
        S.vel.addScaledVector(away, 26);
        f.position.addScaledVector(away, -3);
      }
    }
    // broadcast foe state to wingmates
    if (G.net.role !== 'solo') {
      S.foeT -= dt;
      if (S.foeT <= 0) {
        S.foeT = 0.18;
        netSend({
          t: 'sfoe', c: Math.round(S.carrierHp),
          f: S.foes.map(f => [f.userData.i,
            +f.position.x.toFixed(1), +f.position.y.toFixed(1), +f.position.z.toFixed(1),
            +f.quaternion.x.toFixed(3), +f.quaternion.y.toFixed(3), +f.quaternion.z.toFixed(3), +f.quaternion.w.toFixed(3),
            f.userData.hp]),
        });
      }
    }
  }

  // position sync out
  if (G.net.role !== 'solo') {
    S.netT -= dt;
    if (S.netT <= 0) {
      S.netT = 0.09;
      const p = S.ship.position, q = S.ship.quaternion;
      netSend({ t: 'sp', p: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], q: [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)] });
    }
  }

  // ALLIED DARTS: your side works its own corners of the sky. They pick a
  // bandit, run it, and chip in — the fight is not yours alone.
  for (const a of S.allies) {
    const au = a.userData;
    au.aiT -= dt;
    if (!au.target || au.target.userData.hp <= 0 || au.aiT <= 0) {
      const alive = S.foes.filter((f) => f.userData.hp > 0);
      au.target = alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
      au.aiT = 4 + Math.random() * 4;
    }
    const noseA = new THREE.Vector3(0, 0, -1).applyQuaternion(a.quaternion);
    if (au.target) {
      const dirA = au.target.position.clone().sub(a.position);
      const dA = dirA.length();
      dirA.normalize();
      const tqA = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dirA);
      a.quaternion.rotateTowards(tqA, (dA < 40 ? 0.35 : 0.8) * dt);
      a.position.addScaledVector(noseA, au.speed * dt);
      au.fireT -= dt;
      if (au.fireT <= 0 && dA < 110 && noseA.angleTo(dirA) < 0.25) {
        au.fireT = 2.2 + Math.random() * 2.2;
        const bA = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 2.4),
          new THREE.MeshBasicMaterial({ color: 0x7fffd8, toneMapped: false }));
        bA.position.copy(a.position).addScaledVector(noseA, 4);
        bA.lookAt(a.position.clone().add(noseA));
        // allies only deal REAL damage on the authoritative sim — guests see fire
        bA.userData = S.isHost
          ? { dir: noseA.clone(), vel: 190, life: 1.4, dmg: 1, mine: true, ally: true }
          : { dir: noseA.clone(), vel: 190, life: 1.4, cosmetic: true, dir2: true };
        S.group.add(bA);
        S.bolts.push(bA);
      }
    } else {
      a.position.addScaledVector(noseA, au.speed * 0.6 * dt);
    }
    if (a.position.length() > FIELD_R - 20) { // stay inside the dome
      const inward = a.position.clone().negate().normalize();
      const tqA = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), inward);
      a.quaternion.rotateTowards(tqA, 1.2 * dt);
    }
  }

  // ---- bolts & torpedoes ----
  for (let i = S.bolts.length - 1; i >= 0; i--) {
    const b = S.bolts[i];
    b.userData.life -= dt;
    if (b.userData.seek && b.userData.seek.userData.hp > 0) {
      const to = b.userData.seek.position.clone().sub(b.position).normalize();
      b.userData.dir.lerp(to, Math.min(1, dt * 2.4)).normalize();
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.userData.dir);
    }
    b.position.addScaledVector(b.userData.dir, b.userData.vel * dt);
    let dead = b.userData.life <= 0;
    if (!dead && b.userData.torp) {
      if (b.position.distanceTo(b.userData.aim) < 24) {
        if (S.isHost) { hurtCarrier(8, b.position.clone()); if (!S) return; }
        dead = true;
      }
    } else if (!dead && b.userData.mine) {
      for (const f of S.foes) {
        if (f.userData.hp <= 0) continue;
        const rad = (f.userData.type === 'bomber' ? 3.4 : 2.4 * (TIERS[f.userData.tier]?.scale ?? 1)) * 1.8;
        if (b.position.distanceTo(f.position) < rad) {
          if (S.isHost) {
            f.userData.hp -= (b.userData.dmg || 1);
            if (f.userData.hp <= 0) killFoe(f, true, !!b.userData.ally);
          } else {
            netSend({ t: 'sdmg', i: f.userData.i, d: b.userData.dmg || 1 });
          }
          spawnBurst(f.position.clone().add(ORIGIN), 0xffaa55, 10, 4, 0.12, 0.5);
          dead = true;
          break;
        }
      }
    } else if (!dead && !b.userData.mine && !b.userData.cosmetic) {
      if (b.position.distanceTo(S.ship.position) < 2.2) { hurtPlayer(9); if (!S) return; dead = true; }
    }
    if (dead) { S.group.remove(b); S.bolts.splice(i, 1); }
  }

  // explosion fx lifecycle
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const e = S.fx[i];
    e.t += dt;
    const k = e.t / e.dur;
    if (e.kind === 'flash') {
      e.mesh.scale.setScalar(1 + k * 6);
      e.mesh.material.opacity = 0.9 * (1 - k);
    } else {
      e.mesh.position.addScaledVector(e.mesh.userData.v, dt);
      e.mesh.rotation.x += e.mesh.userData.rot.x * dt;
      e.mesh.rotation.y += e.mesh.userData.rot.y * dt;
    }
    if (k >= 1) { S.group.remove(e.mesh); S.fx.splice(i, 1); }
  }

  // ---- phase & HUD ----
  const alive = S.foes.filter(f => f.userData.hp > 0).length;
  const torps = S.bolts.some(b => b.userData.torp);
  if (S.phase === 'fight' && alive === 0 && !torps) {
    S.phase = 'dock';
    addMsg('PATROL CLEAR — return to the DOCKING BAY (the glowing mouth on the carrier).', 'gold');
    sfx.levelup();
  }
  const beacon = S.group.getObjectByName('dockBeacon');
  if (beacon) {
    beacon.visible = S.phase === 'dock';
    if (beacon.visible) beacon.scale.setScalar(1 + 0.5 * Math.sin(S.t * 6));
  }
  const pillar = S.group.getObjectByName('dockPillar');
  if (pillar) pillar.visible = S.phase === 'dock';
  // target lock: track it, drop it when it dies, reacquire the next threat
  if (S.lock && S.lock.userData.hp <= 0) {
    S.lock = null;
    const alive = S.foes.filter((f) => f.userData.hp > 0);
    if (alive.length) spaceCycleLock();
  }
  if (S.homeLock) {
    const dHome = S.ship.position.distanceTo(DOCK);
    drawLockAt(DOCK.clone().add(ORIGIN), `DOCK ${Math.round(dHome)}m`, '#ffd166');
  } else if (S.lock && S.lock.userData.hp > 0) {
    S.lock.getWorldPosition(_lp);
    const d = S.lock.position.distanceTo(S.ship.position);
    drawLockAt(_lp.clone(), `${Math.round(d)}m`);
  } else hideLockWidgets();

  if (!S.leftBay && S.ship.position.distanceTo(DOCK) > 70) S.leftBay = true;
  if (S.phase === 'dock' && S.leftBay) {
    const approach = DOCK.clone().add(new THREE.Vector3(0, 0, 22));
    if (S.ship.position.distanceTo(approach) < 20) {
      S.phase = 'tractor';
      S.trT = 0;
      S.trFrom = S.ship.position.clone();
      addMsg('TRACTOR LOCK — the bay is bringing you in.', 'gold');
      sfx.stairs();
      return;
    }
  }
  const wh = document.getElementById('waveHud');
  if (wh) {
    const cap = S.comp.bombers ? ` · CARRIER ${Math.max(0, Math.round(S.carrierHp))}%` : '';
    wh.textContent = S.phase === 'dock'
      ? `RETURN TO DOCK — range ${Math.round(S.ship.position.distanceTo(DOCK.clone().add(new THREE.Vector3(0, 0, 22))))}m`
      : `PATROL LV${S.level} — [${S.weapon + 1}] ${WEAPONS[S.weapon].name} · HOSTILES ${alive}${cap} · VEL ${Math.round(S.vel.length())} m/s`;
  }
  // the health bar is your SHIP now
  const hpfill = document.getElementById('hpfill'), hptext = document.getElementById('hptext');
  if (hpfill) hpfill.style.width = `${Math.max(0, (S.hull / S.maxHull) * 100)}%`;
  if (hptext) hptext.textContent = `HULL ${Math.max(0, Math.round(S.hull))} / ${S.maxHull}`;
  drawDomeRadar(alive);
}

// ---- the CUBE RADAR: the dome was hard to read, so — a box. Isometric
// wireframe cube of the battle volume, you at the center; every contact is a
// little CUBE with a stalk down to the mid-plane (stalk length = how far
// above/below you it is; grid square = where it is around you) ----
function drawDomeRadar(alive) {
  const mon = S.ship.userData.monitor;
  if (!mon) return;
  const cv = mon.canvas;
  const ctx = cv.getContext('2d');
  mon.tex.needsUpdate = true;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(4, 12, 16, 0.85)';
  ctx.fillRect(0, 0, W, H);
  const R = FIELD_R;
  const cx = W / 2, cy = H / 2 + 6;
  const sc = (W / 2 - 10) / (2 * R * 0.72);
  const P = (x, y, z) => { // clamp into the cube, then isometric-project
    x = Math.max(-R, Math.min(R, x)); y = Math.max(-R, Math.min(R, y)); z = Math.max(-R, Math.min(R, z));
    return [cx + (x - z) * 0.72 * sc, cy + (x + z) * 0.38 * sc - y * 0.5 * sc];
  };
  const edge = (a, b, alpha) => {
    ctx.strokeStyle = `rgba(79, 232, 224, ${alpha})`;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  };
  ctx.lineWidth = 1;
  const C = {};
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) C[`${sx},${sy},${sz}`] = P(sx * R, sy * R, sz * R);
  // bottom face bright, top face + verticals faint
  edge(C['-1,-1,-1'], C['1,-1,-1'], 0.5); edge(C['1,-1,-1'], C['1,-1,1'], 0.5);
  edge(C['1,-1,1'], C['-1,-1,1'], 0.5); edge(C['-1,-1,1'], C['-1,-1,-1'], 0.5);
  edge(C['-1,1,-1'], C['1,1,-1'], 0.18); edge(C['1,1,-1'], C['1,1,1'], 0.18);
  edge(C['1,1,1'], C['-1,1,1'], 0.18); edge(C['-1,1,1'], C['-1,1,-1'], 0.18);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edge(C[`${sx},-1,${sz}`], C[`${sx},1,${sz}`], 0.14);
  // the mid-plane (your plane): a faint diamond with a cross
  edge(P(-R, 0, -R), P(R, 0, -R), 0.28); edge(P(R, 0, -R), P(R, 0, R), 0.28);
  edge(P(R, 0, R), P(-R, 0, R), 0.28); edge(P(-R, 0, R), P(-R, 0, -R), 0.28);
  edge(P(-R, 0, 0), P(R, 0, 0), 0.12); edge(P(0, 0, -R), P(0, 0, R), 0.12);
  // a contact: stalk to the mid-plane, then a solid CUBE glyph
  const blip = (p, color, s2 = 3) => {
    const rel = { x: p.x - S.ship.position.x, y: p.y - S.ship.position.y, z: p.z - S.ship.position.z };
    const at = P(rel.x, rel.y, rel.z), base = P(rel.x, 0, rel.z);
    ctx.strokeStyle = color; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(at[0], at[1]); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillRect(at[0] - s2, at[1] - s2, s2 * 2, s2 * 2);              // front face
    ctx.beginPath();                                                   // top face (lighter)
    ctx.moveTo(at[0] - s2, at[1] - s2); ctx.lineTo(at[0] - s2 + s2, at[1] - s2 - s2 * 0.7);
    ctx.lineTo(at[0] + s2 + s2, at[1] - s2 - s2 * 0.7); ctx.lineTo(at[0] + s2, at[1] - s2);
    ctx.closePath();
    ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
  };
  // the carrier: a slab, relative to you like everything else
  const cb = P(CAP.x - S.ship.position.x, CAP.y - S.ship.position.y, CAP.z - S.ship.position.z);
  ctx.fillStyle = 'rgba(170, 185, 200, 0.9)';
  ctx.fillRect(cb[0] - 12, cb[1] - 2, 24, 4);
  if (S.phase === 'dock') blip(DOCK, '#7fffee', 3.5);
  for (const f of S.foes) {
    if (f.userData.hp <= 0) continue;
    const c = f.userData.type === 'bomber' ? '#88ff55' : ({ raider: '#ff8855', interceptor: '#ff66ee', gunship: '#bb66ff' })[f.userData.tier] || '#ff8855';
    blip(f.position, c, f.userData.type === 'bomber' || f.userData.tier === 'gunship' ? 3.4 : 2.6);
    if (f === S.lock) { // ring the locked contact
      const rel = { x: f.position.x - S.ship.position.x, y: f.position.y - S.ship.position.y, z: f.position.z - S.ship.position.z };
      const at = P(rel.x, rel.y, rel.z);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(at[0] - 6, at[1] - 6, 12, 12);
    }
  }
  for (const b of S.bolts) if (b.userData.torp) blip(b.position, '#caff70', 2);
  for (const r of S.remote.values()) blip(r.grp.position, '#7fd8ff', 3);
  // YOU: always dead center of the cube
  ctx.fillStyle = '#5cff8a';
  ctx.fillRect(cx - 3, cy - 3, 6, 6);
  ctx.strokeStyle = 'rgba(92, 255, 138, 0.5)';
  ctx.strokeRect(cx - 5, cy - 5, 10, 10);
}

function foeShot(f, nose, color = 0xff5533) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.2),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  b.position.copy(f.position);
  b.userData = { dir: nose.clone(), vel: 115, life: 2.0, mine: false };
  b.lookAt(f.position.clone().add(nose));
  S.group.add(b);
  S.bolts.push(b);
}

function torpedo(f, dir) {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 6),
    new THREE.MeshBasicMaterial({ color: 0x88ff55, toneMapped: false }));
  b.position.copy(f.position);
  b.userData = { dir: dir.clone(), vel: 30, life: 9, torp: true, aim: f.userData.aim.clone() };
  b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  S.group.add(b);
  S.bolts.push(b);
  addMsg('Torpedo away — it is tracking the CARRIER!', 'bad');
}

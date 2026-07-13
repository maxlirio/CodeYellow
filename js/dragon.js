// EMBERWING, hand-built: a procedural low-poly dragon with real articulation.
// No asset pack could give us this — her wings actually flap, her legs walk,
// her tail sways and whips, her jaw opens when she breathes, her eyes burn.
// The fight code drives the pose every frame from her state and motion.
import * as THREE from 'three';
import { G } from './state.js';

const BODY = 0x8a1f12;      // deep crimson scales
const BODY_DARK = 0x611109; // shading segments
const MEMBRANE = 0x45100a;  // wing leather
const HORN = 0xd8c9a8;      // bone
const CLAW = 0x2a2320;      // talon black
const EYE = 0xffa020;       // furnace

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, flatShading: true, ...extra });
}

// one wing: bone ridge + a jagged membrane fan, pivot at the shoulder
function buildWing(side) {
  const wing = new THREE.Group();
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 5.6, 5), mat(BODY_DARK));
  ridge.rotation.z = Math.PI / 2;
  ridge.position.x = side * 2.8;
  wing.add(ridge);
  const elbowSpike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.8, 4), mat(HORN));
  elbowSpike.position.set(side * 5.5, 0.25, 0);
  wing.add(elbowSpike);
  // membrane: a fan of triangles sweeping back from the ridge
  const pts = [
    [0, 0, 0.2],
    [side * 5.6, 0, 0],
    [side * 5.2, 0, 2.6],
    [side * 3.6, 0, 3.4],
    [side * 1.8, 0, 2.9],
    [side * 0.4, 0, 2.0],
  ];
  const verts = [];
  for (let i = 1; i < pts.length - 1; i++) {
    verts.push(...pts[0], ...pts[i], ...pts[i + 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mem = new THREE.Mesh(geo, mat(MEMBRANE, { side: THREE.DoubleSide, roughness: 0.95 }));
  wing.add(mem);
  return wing;
}

function buildLeg(side, rear) {
  const leg = new THREE.Group(); // pivot at the hip
  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 1.5, 5), mat(BODY));
  thigh.position.y = -0.7;
  leg.add(thigh);
  const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.15, 5), mat(BODY_DARK));
  shin.position.y = -1.75;
  leg.add(shin);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.3, 0.95), mat(BODY_DARK));
  foot.position.set(0, -2.35, -0.18);
  leg.add(foot);
  for (let c = -1; c <= 1; c++) {
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 4), mat(CLAW));
    claw.rotation.x = -Math.PI / 2.15;
    claw.position.set(c * 0.24, -2.38, -0.75);
    leg.add(claw);
  }
  leg.userData.rear = rear;
  return leg;
}

export function buildDragonModel() {
  const root = new THREE.Group(); // origin at the ground between her feet
  const body = new THREE.Group();
  body.position.y = 2.45;
  body.rotation.y = Math.PI; // built head-to--z; the game faces +z — turn her around
  root.add(body);
  const parts = { body, wings: [], legs: [], tail: [], neck: [] };

  // ---- torso ----
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.1, 4.6, 7), mat(BODY));
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1.42, 7, 6), mat(BODY));
  chest.scale.set(1, 0.92, 1.15);
  chest.position.set(0, -0.08, -1.9);
  body.add(chest);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(1.08, 7, 6), mat(BODY_DARK));
  hips.scale.set(1, 0.9, 1.25);
  hips.position.set(0, -0.06, 2.15);
  body.add(hips);
  // spine spikes
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.75, 4), mat(HORN));
    sp.position.set(0, 1.35 - i * 0.04, -2.2 + i * 0.95);
    body.add(sp);
  }

  // ---- neck (3 chained segments) + head ----
  let prev = body;
  let anchor = new THREE.Vector3(0, 0.5, -3.0);
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.copy(anchor);
    prev.add(seg);
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5 - i * 0.28, 1.05 - i * 0.12, 1.85), mat(i % 2 ? BODY_DARK : BODY));
    m.rotation.x = Math.PI / 2 - 1.05;
    m.position.set(0, 0.28, -0.6);
    seg.add(m);
    parts.neck.push(seg);
    prev = seg;
    anchor = new THREE.Vector3(0, 0.62, -1.3);
  }
  const head = new THREE.Group();
  head.position.set(0, 0.75, -1.25);
  prev.add(head);
  parts.head = head;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 1.4), mat(BODY));
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 1.15), mat(BODY_DARK));
  snout.position.set(0, -0.08, -1.15);
  head.add(snout);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.34, -0.55);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 1.5), mat(BODY_DARK));
  jawMesh.position.set(0, -0.1, -0.75);
  jaw.add(jawMesh);
  parts.jaw = jaw;
  // teeth
  for (const tx of [-0.24, 0, 0.24]) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), mat(HORN));
    tooth.rotation.x = Math.PI;
    tooth.position.set(tx, -0.32, -1.55);
    head.add(tooth);
  }
  // horns
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.15, 5), mat(HORN));
    horn.rotation.x = -0.9;
    horn.position.set(s * 0.42, 0.5, 0.55);
    head.add(horn);
  }
  // burning eyes + mouth furnace
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a0a00, emissive: EYE, emissiveIntensity: 2.2 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), eyeMat);
    eye.position.set(s * 0.42, 0.12, -0.62);
    head.add(eye);
  }
  const mouthGlow = new THREE.PointLight(0xff7722, 0, 9);
  mouthGlow.position.set(0, -0.2, -1.7);
  head.add(mouthGlow);
  parts.mouthGlow = mouthGlow;

  // ---- wings ----
  for (const s of [-1, 1]) {
    const wing = buildWing(s);
    wing.position.set(s * 1.15, 0.9, -1.5);
    body.add(wing);
    parts.wings.push(wing);
  }

  // ---- legs (front pair smaller, rear pair heavy) ----
  const legAnchors = [
    [-1.25, -0.4, -1.7, false], [1.25, -0.4, -1.7, false],
    [-1.3, -0.35, 1.7, true], [1.3, -0.35, 1.7, true],
  ];
  for (const [x, y, z, rear] of legAnchors) {
    const leg = buildLeg(Math.sign(x), rear);
    leg.position.set(x, y, z);
    body.add(leg);
    parts.legs.push(leg);
  }

  // ---- tail (5 chained segments, spiked tip) ----
  prev = body;
  anchor = new THREE.Vector3(0, 0.1, 3.1);
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.copy(anchor);
    prev.add(seg);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.65 - i * 0.11, 0.85 - i * 0.12, 1.7, 6), mat(i % 2 ? BODY_DARK : BODY));
    m.rotation.x = Math.PI / 2 + 0.12;
    m.position.z = 0.7;
    seg.add(m);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 4), mat(HORN));
    fin.position.set(0, 0.55 - i * 0.06, 0.7);
    seg.add(fin);
    parts.tail.push(seg);
    prev = seg;
    anchor = new THREE.Vector3(0, -0.06, 1.55);
  }
  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.2, 4), mat(HORN));
  stinger.rotation.x = Math.PI / 2 + 0.3;
  stinger.position.set(0, 0, 1.5);
  prev.add(stinger);

  root.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
  root.userData.dragonParts = parts;
  return root;
}

// ---- the living pose: driven every frame from state + motion ----
export function animateDragon(e, dt) {
  const parts = e.obj.userData.dragonParts;
  if (!parts) return;
  const t = G.time;
  const st = e.ds?.state || (e.state === 'inactive' ? 'sleep' : e.obj.position.y > 2.5 ? 'circle' : 'prowl');
  const flying = e.obj.position.y > 2.0 || ['takeoff', 'circle', 'roostfly', 'landing'].includes(st);
  const speed = e.ds?.spd ?? 0;
  const sleeping = st === 'sleep';
  const roosting = st === 'roost';
  const breathing = !!(e.ds?.sweep || e.ds?.breath) || st === 'rearup';

  // wings: thunder in flight, lazy balance on the ground, mantled at roost/sleep
  let amp, freq, base;
  if (flying) { amp = 0.85; freq = 7; base = 0.15; }
  else if (roosting || sleeping) { amp = 0.03; freq = 1.1; base = -1.05; } // folded
  else { amp = 0.14; freq = 2.2; base = -0.45; } // half-folded on the prowl
  const flap = base + Math.sin(t * freq) * amp;
  parts.wings[0].rotation.z = -flap;
  parts.wings[1].rotation.z = flap;

  // legs: tucked in flight, striding when she moves, planted at rest
  const stride = Math.min(1, speed / 4);
  for (let i = 0; i < parts.legs.length; i++) {
    const leg = parts.legs[i];
    if (flying) leg.rotation.x += (0.85 - leg.rotation.x) * Math.min(1, dt * 4); // tucked back
    else {
      const phase = (i % 2 === 0 ? 0 : Math.PI) + (leg.userData.rear ? Math.PI / 2 : 0);
      const want = stride > 0.05 ? Math.sin(t * 6 + phase) * 0.5 * stride : 0;
      leg.rotation.x += (want - leg.rotation.x) * Math.min(1, dt * 8);
    }
  }

  // body: settles low on the ground, pitches into flight, breathes at rest
  const wantBodyY = flying ? 2.9 : sleeping ? 1.55 : 2.45;
  parts.body.position.y += (wantBodyY - parts.body.position.y) * Math.min(1, dt * 3);
  // nose follows the climb/dive; the whole body BANKS into turns
  const dy = e.obj.position.y - (e._lastY ?? e.obj.position.y);
  e._lastY = e.obj.position.y;
  const climb = Math.max(-0.45, Math.min(0.45, -dy * 2.5));
  const wantPitch = flying ? -(0.15 + climb) : 0;
  parts.body.rotation.x += (wantPitch - parts.body.rotation.x) * Math.min(1, dt * 3);
  let dyaw = e.obj.rotation.y - (e._lastYaw ?? e.obj.rotation.y);
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  e._lastYaw = e.obj.rotation.y;
  const wantBank = flying ? Math.max(-0.6, Math.min(0.6, -(dyaw / Math.max(dt, 0.001)) * 0.45)) : 0;
  parts.body.rotation.z += (wantBank - parts.body.rotation.z) * Math.min(1, dt * 2.5);
  parts.body.position.y += Math.sin(t * (sleeping ? 1 : 2.2)) * 0.04;

  // tail: a travelling sway, whipping harder with speed
  const sway = 0.16 + stride * 0.2 + (st === 'tailsweep' ? 0.9 : 0);
  for (let i = 0; i < parts.tail.length; i++) {
    parts.tail[i].rotation.y = Math.sin(t * (2 + stride * 3) - i * 0.7) * sway;
  }

  // neck: curls down in sleep, cranes in menace/rearup
  const curl = sleeping ? 0.55 : st === 'rearup' ? -0.3 : st === 'menace' ? -0.12 : 0.05;
  for (const seg of parts.neck) {
    seg.rotation.x += (curl - seg.rotation.x) * Math.min(1, dt * 3);
  }

  // jaw + furnace: she opens wide when the fire comes
  const jawOpen = breathing ? 0.75 : st === 'lunge' || st === 'claw' ? 0.4 : 0.06;
  parts.jaw.rotation.x += (jawOpen - parts.jaw.rotation.x) * Math.min(1, dt * 10);
  const glow = breathing ? 3.2 + Math.random() * 2.4 : 0; // the furnace gutters
  parts.mouthGlow.intensity += (glow - parts.mouthGlow.intensity) * Math.min(1, dt * 12);

  // her HEAD follows the fire. e.ds.aim is the breath's world yaw; the head turns
  // to it (in her body's frame) so the jet reads as something she is pointing,
  // not something the game is drawing near her face.
  const aim = e.ds?.aim;
  let headYaw = 0;
  if (aim != null && breathing) {
    headYaw = aim - e.yaw;
    while (headYaw > Math.PI) headYaw -= Math.PI * 2;
    while (headYaw < -Math.PI) headYaw += Math.PI * 2;
    headYaw = Math.max(-0.9, Math.min(0.9, headYaw));
  }
  // the body is built facing -z and turned around, so the head's yaw is negated
  parts.head.rotation.y += (-headYaw - parts.head.rotation.y) * Math.min(1, dt * 8);
}

// Where her fire comes OUT. World position of the muzzle and the direction it
// points — the jet is anchored here so the flame has an actual source.
export function dragonMuzzle(e, outPos, outDir) {
  const parts = e.obj.userData.dragonParts;
  if (!parts) return false;
  parts.mouthGlow.getWorldPosition(outPos);
  // the head's local -z is forward (she was built head-toward -z)
  outDir.set(0, 0, -1).applyQuaternion(parts.head.getWorldQuaternion(_q)).normalize();
  return true;
}
const _q = new THREE.Quaternion();

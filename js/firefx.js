// LOW-POLY DRAGONFIRE.
//
// The old "fire" was two soft glow billboards planted on the ground wherever the
// breath happened to do damage — orbs that popped into being around her and
// faded. Nothing ever left her mouth.
//
// This is built the other way round: fire is a JET that starts at her muzzle and
// is thrown outward. Everything is faceted and unlit — chunky tetrahedral embers
// and hard-edged cones, flat colours stepped along a heat ramp, additively
// blended. No soft sprites, no smooth spheres: it should read like the rest of
// the game's geometry, lit from within.
//
// All embers share ONE InstancedMesh, so the whole effect — jet, ground fire,
// fireball trails, impacts — costs a single draw call no matter how much of it
// is on screen. That matters: she is already ~100 meshes on her own.
import * as THREE from 'three';
import { G } from './state.js';

// heat ramp, hottest first — an ember cools as it flies
const RAMP = [
  new THREE.Color(0xfff6d8), // white-hot, right at the muzzle
  new THREE.Color(0xffd23f), // yellow
  new THREE.Color(0xff8a1f), // orange
  new THREE.Color(0xef3d11), // red
  new THREE.Color(0x8c2a0d), // dying ember
  new THREE.Color(0x2b2320), // smoke
];
const _c = new THREE.Color();
function heat(t) { // t: 0 = just born (hottest) → 1 = spent
  const f = Math.min(0.999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(f);
  return _c.copy(RAMP[i]).lerp(RAMP[i + 1], f - i);
}

const MAX_EMBERS = 360;
let embers = null;      // InstancedMesh
let pool = [];          // particle records
let cursor = 0;
const jets = [];        // active flame jets
const fires = [];       // burning ground patches

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

export function initFireFx() {
  if (embers) return;
  // a tetrahedron is the bluntest solid there is — 4 flat faces, so every ember
  // catches the light as a hard-edged chip rather than a fuzzy blob
  const geo = new THREE.TetrahedronGeometry(0.5, 0);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 1, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  embers = new THREE.InstancedMesh(geo, mat, MAX_EMBERS);
  embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  embers.frustumCulled = false;
  embers.renderOrder = 3;
  embers.count = MAX_EMBERS;
  for (let i = 0; i < MAX_EMBERS; i++) {
    embers.setColorAt(i, RAMP[0]);
    pool.push({ live: false, t: 0, life: 1, floor: -1, size: 1, spin: 0, drag: 1, rise: 0,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), rot: 0 });
  }
  hideAll();
  G.scene.add(embers);
}

function hideAll() {
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < MAX_EMBERS; i++) embers.setMatrixAt(i, _m);
  embers.instanceMatrix.needsUpdate = true;
}

// Spawn one ember. Recycles the oldest slot when full, so a long breath never
// starves the impacts of particles.
function ember(pos, vel, life, size, floor, rise = 2.4, drag = 1.6) {
  if (!embers) return;
  const p = pool[cursor];
  cursor = (cursor + 1) % MAX_EMBERS;
  p.live = true; p.t = 0; p.life = life; p.size = size; p.floor = floor;
  p.rise = rise; p.drag = drag;
  p.pos.copy(pos);
  p.vel.copy(vel);
  p.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  p.spin = (Math.random() - 0.5) * 14;
  p.rot = Math.random() * 6.28;
}

// ---------------------------------------------------------------------------
// THE JET: fire leaving her mouth.
// A pair of nested open cones (a white-hot inner throat inside a wider orange
// body) anchored at the muzzle and thrown along the aim, plus a stream of embers
// that keep flying after the cone ends — so the fire has a source, a body, and a
// spray, instead of appearing where it lands.
// ---------------------------------------------------------------------------
function coneMesh(color, radius, opacity) {
  // unit radius + unit height: scale.x/z IS the flare radius, scale.y IS the
  // throw, so the cone can be shaped directly in world units.
  // openEnded: we never want to see a flat cap floating in her throat
  const g = new THREE.ConeGeometry(1, 1, 7, 1, true);
  const m = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export function spawnFireJet(floor, opts = {}) {
  initFireFx();
  const jet = {
    floor,
    origin: new THREE.Vector3(),
    dir: new THREE.Vector3(0, 0, 1),
    t: 0,
    dur: opts.dur ?? 1.6,
    reach: opts.reach ?? 16,
    width: opts.width ?? 1.0,
    rate: opts.rate ?? 90,     // embers per second
    speed: opts.speed ?? 26,
    acc: 0,
    // warm, not white: an additive white core blows out to a laser beam. Keep
    // both layers thin — additive geometry stacks, and at point-blank range an
    // opaque cone becomes a flat wall of colour instead of fire.
    inner: coneMesh(0xffb733, 1, 0.3),
    outer: coneMesh(0xff3d0d, 1, 0.22),
    light: new THREE.PointLight(0xff7a22, 0, 26),
    dead: false,
  };
  G.scene.add(jet.inner, jet.outer, jet.light);
  jets.push(jet);
  return jet;
}

export function endFireJet(jet) { if (jet) jet.dead = true; }

function updateJet(j, dt) {
  j.t += dt;
  const k = j.t / j.dur;
  const on = !j.dead && k < 1;
  const show = on && j.floor === G.floor;

  // throttle: swells fast, holds, then gutters out
  const gut = on ? Math.min(1, j.t / 0.18) * Math.min(1, (1 - k) / 0.22 + 0.25) : 0;

  j.inner.visible = j.outer.visible = show && gut > 0.02;
  j.light.visible = show;
  j.light.intensity = gut * 7 + Math.random() * gut * 2.5;
  j.light.position.copy(j.origin).addScaledVector(j.dir, 2.5);

  if (j.inner.visible) {
    // the cone's apex sits AT the muzzle and its mouth opens downrange: align the
    // cone's -y (its base) with the aim, then push it half a length forward
    _q.setFromUnitVectors(_down, j.dir);
    const len = j.reach * gut * (0.9 + Math.random() * 0.16); // flicker the throw
    // FLARE hard: a cone this long has to open to several units across or it
    // reads as a thin beam. Roughly a 1:4 flare — a gout, not a needle.
    for (const [mesh, flare, op] of [[j.inner, 0.12, 0.30], [j.outer, 0.24, 0.22]]) {
      mesh.quaternion.copy(_q);
      mesh.position.copy(j.origin).addScaledVector(j.dir, len * 0.5);
      const wob = 0.85 + Math.random() * 0.3;
      const r = len * flare * j.width * wob;
      mesh.scale.set(r, len, r);
      mesh.material.opacity = op * gut;
    }
  }

  // the ember spray
  if (on) {
    j.acc += j.rate * gut * dt;
    while (j.acc >= 1) {
      j.acc -= 1;
      // cone spread around the aim
      _v.copy(j.dir).multiplyScalar(j.speed * (0.7 + Math.random() * 0.6));
      _v.x += (Math.random() - 0.5) * 7 * j.width;
      _v.y += (Math.random() - 0.5) * 5 * j.width;
      _v.z += (Math.random() - 0.5) * 7 * j.width;
      _s.copy(j.origin).addScaledVector(j.dir, Math.random() * 1.2);
      ember(_s, _v, 0.42 + Math.random() * 0.4, 0.4 + Math.random() * 0.55, j.floor, 3.2, 1.5);
    }
  }

  if (!on && j.t > j.dur + 0.4) {
    G.scene.remove(j.inner, j.outer, j.light);
    j.inner.geometry.dispose(); j.inner.material.dispose();
    j.outer.geometry.dispose(); j.outer.material.dispose();
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GROUND FIRE: where the breath landed, the floor keeps burning.
// A scorched disc plus a lick of flame that FEEDS off the shared ember pool, so
// a whole raked floor costs one draw call and a handful of discs.
// ---------------------------------------------------------------------------
export function spawnGroundFire(floor, x, z, y = 0, dur = 2.8) {
  initFireFx();
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 7),
    new THREE.MeshBasicMaterial({ color: 0x1a0d07, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(x, y + 0.04, z);
  scorch.renderOrder = 1;
  G.scene.add(scorch);
  const fire = { floor, x, z, y, t: 0, dur, acc: 0, scorch, light: null };
  // only the first few patches carry a light — a raked floor would otherwise
  // blow straight past the renderer's light limit
  if (fires.filter(f => f.light).length < 4) {
    fire.light = new THREE.PointLight(0xff6a20, 2.2, 11);
    fire.light.position.set(x, y + 1.1, z);
    G.scene.add(fire.light);
  }
  fires.push(fire);
  return fire;
}

function updateFire(f, dt) {
  f.t += dt;
  const k = f.t / f.dur;
  const show = f.floor === G.floor;
  const fade = Math.min(1, (1 - k) * 2.2);
  f.scorch.visible = show;
  f.scorch.material.opacity = 0.85 * Math.min(1, k * 6);
  if (f.light) {
    f.light.visible = show;
    f.light.intensity = (2.2 + Math.sin(f.t * 17) * 0.9) * fade;
  }
  if (show && k < 1) {
    f.acc += 26 * fade * dt;
    while (f.acc >= 1) {
      f.acc -= 1;
      const a = Math.random() * 6.28, r = Math.random() * 1.25;
      _s.set(f.x + Math.cos(a) * r, f.y + 0.1, f.z + Math.sin(a) * r);
      _v.set((Math.random() - 0.5) * 1.2, 3.2 + Math.random() * 2.6, (Math.random() - 0.5) * 1.2);
      ember(_s, _v, 0.5 + Math.random() * 0.45, 0.3 + Math.random() * 0.4, f.floor, 4.2, 0.9);
    }
  }
  if (k >= 1) {
    G.scene.remove(f.scorch);
    if (f.light) G.scene.remove(f.light);
    f.scorch.geometry.dispose(); f.scorch.material.dispose();
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// FIREBALL: a faceted molten core in a counter-spinning shell, shedding embers.
// ---------------------------------------------------------------------------
export function buildFireballVisual(size = 1) {
  initFireFx();
  const obj = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.36 * size, 0), // 20 flat faces — chunky, not a ball
    new THREE.MeshBasicMaterial({ color: 0xfff0c0, toneMapped: false })
  );
  obj.add(core);
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.62 * size, 0),
    new THREE.MeshBasicMaterial({
      color: 0xff5a14, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    })
  );
  obj.add(shell);
  const light = new THREE.PointLight(0xff7326, 3.2, 12);
  obj.add(light);
  obj.userData.fire = { core, shell, light, t: 0, size };
  return obj;
}

// call each frame for a fireball built above
export function animateFireball(obj, dt, floor) {
  const f = obj.userData.fire;
  if (!f) return;
  f.t += dt;
  f.core.rotation.x += dt * 5.5; f.core.rotation.y += dt * 4.0;
  f.shell.rotation.x -= dt * 2.6; f.shell.rotation.z += dt * 3.4;
  const pulse = 1 + Math.sin(f.t * 26) * 0.12;
  f.shell.scale.setScalar(pulse);
  f.light.intensity = 3.2 + Math.sin(f.t * 22) * 1.1;
  // shed embers that fall away behind it
  obj.getWorldPosition(_s);
  if (Math.random() < dt * 55) {
    _v.set((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4 + 0.6, (Math.random() - 0.5) * 2.4);
    ember(_s, _v, 0.35 + Math.random() * 0.3, 0.22 + Math.random() * 0.3, floor ?? G.floor, 2.0, 2.2);
  }
}

// a burst of shrapnel + a hard flash — used when a fireball lands
export function spawnFireImpact(pos, floor, power = 1) {
  initFireFx();
  const n = Math.round(26 * power);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, up = Math.random() * 0.9;
    const sp = (7 + Math.random() * 13) * power;
    _v.set(Math.cos(a) * sp, up * sp * 0.75 + 2, Math.sin(a) * sp);
    ember(pos, _v, 0.4 + Math.random() * 0.45, (0.35 + Math.random() * 0.6) * power, floor ?? G.floor, 2.2, 2.0);
  }
}

// ---------------------------------------------------------------------------
export function updateFireFx(dt) {
  if (!embers) return;
  if (embers.parent !== G.scene) G.scene.add(embers); // survive a scene rebuild
  for (let i = jets.length - 1; i >= 0; i--) if (!updateJet(jets[i], dt)) jets.splice(i, 1);
  for (let i = fires.length - 1; i >= 0; i--) if (!updateFire(fires[i], dt)) fires.splice(i, 1);

  for (let i = 0; i < MAX_EMBERS; i++) {
    const p = pool[i];
    if (!p.live) continue;
    p.t += dt;
    const k = p.t / p.life;
    if (k >= 1 || p.floor !== G.floor) {
      if (k >= 1) p.live = false;
      _m.makeScale(0, 0, 0);
      embers.setMatrixAt(i, _m);
      continue;
    }
    // drag bleeds the throw off; buoyancy lifts what's left — fire rises
    const d = Math.max(0, 1 - p.drag * dt);
    p.vel.multiplyScalar(d);
    p.vel.y += p.rise * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.rot += p.spin * dt;
    // swells as it ignites, then collapses to nothing
    const grow = k < 0.22 ? k / 0.22 : 1 - (k - 0.22) / 0.78;
    const s = Math.max(0.001, p.size * (0.35 + grow * 0.85));
    _q.setFromAxisAngle(p.axis, p.rot);
    _m.compose(p.pos, _q, _s.set(s, s, s));
    embers.setMatrixAt(i, _m);
    embers.setColorAt(i, heat(k));
  }
  embers.instanceMatrix.needsUpdate = true;
  if (embers.instanceColor) embers.instanceColor.needsUpdate = true;
}

export function clearFireFx() {
  for (const j of jets) { G.scene.remove(j.inner, j.outer, j.light); }
  jets.length = 0;
  for (const f of fires) { G.scene.remove(f.scorch); if (f.light) G.scene.remove(f.light); }
  fires.length = 0;
  for (const p of pool) p.live = false;
  if (embers) hideAll();
}

// Visual effects: damage numbers, particle bursts, torch flames/lights, blob shadows, projectiles' glow.
import * as THREE from 'three';
import { G } from './state.js';

const dmgNumbers = [];
const bursts = [];
let flameTex = null, blobTex = null, glowTex = null;

function makeCanvasTex(draw, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function initFx() {
  flameTex = makeCanvasTex((g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.35, 'rgba(255,160,40,0.85)');
    grad.addColorStop(0.8, 'rgba(200,60,10,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  });
  blobTex = makeCanvasTex((g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(0.8, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  });
  glowTex = flameTex;
}

// ---- blob shadow ----
export function makeBlobShadow(radius = 0.9) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  m.renderOrder = 1;
  return m;
}

// ---- damage numbers ----
export function spawnDamageNumber(pos, text, color = '#ffd35c', big = false) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = `bold ${big ? 44 : 32}px Trebuchet MS`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = '#000'; g.lineWidth = 6;
  g.strokeText(text, 64, 32);
  g.fillStyle = color;
  g.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(big ? 2.6 : 1.8, big ? 1.3 : 0.9, 1);
  sp.position.copy(pos);
  sp.position.x += (Math.random() - 0.5) * 0.6;
  G.scene.add(sp);
  dmgNumbers.push({ sp, life: 0, tex });
}

// ---- particle bursts ----
export function spawnBurst(pos, color = 0xffaa33, count = 14, speed = 5, size = 0.14, life = 0.55) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const vels = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    vels.push(new THREE.Vector3(Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + speed * 0.4, Math.sin(a) * Math.cos(e) * s));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  G.scene.add(pts);
  bursts.push({ pts, vels, life: 0, maxLife: life });
}

// ---- torches ----
const LIGHT_POOL = 7;
let torchLights = [], torchFlames = null, flameData = [];

export function buildTorchFx() {
  // clear old
  for (const l of torchLights) G.scene.remove(l);
  torchLights = [];
  if (torchFlames) { G.scene.remove(torchFlames); torchFlames = null; }
  flameData = [];
  const torchColor = G.torchColor ?? 0xff8c2a;
  for (let i = 0; i < LIGHT_POOL; i++) {
    const l = new THREE.PointLight(torchColor, 0, 16, 1.8);
    G.scene.add(l);
    torchLights.push(l);
  }
  // ship decks hang LAMPS, not flames: an emissive bar per anchor, no fire
  if (G.grid?.ship) {
    const lampGroup = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: G.torchColor ?? 0x9fd8ec, toneMapped: false });
    for (const t of G.torches) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), mat);
      bar.position.set(t.x, t.y + 0.4, t.z);
      lampGroup.add(bar);
    }
    G.scene.add(lampGroup);
    torchFlames = lampGroup; // reuse the flame slot so floor swaps clean it up
    return;
  }
  // one sprite per torch (cheap)
  const n = G.torches.length;
  if (!n) return;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(n * 3);
  G.torches.forEach((t, i) => {
    positions[i * 3] = t.x; positions[i * 3 + 1] = t.y; positions[i * 3 + 2] = t.z;
    flameData.push(Math.random() * 10);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: flameTex, color: G.torchColor ?? 0xffc060, size: 1.15, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  torchFlames = new THREE.Points(geo, mat);
  G.scene.add(torchFlames);
}

export function updateFx(dt) {
  const t = G.time;
  // torch lights: assign pool to nearest torches
  if (G.player && G.torches.length) {
    const px = G.player.obj.position.x, pz = G.player.obj.position.z;
    const sorted = G.torches
      .map((tc) => ({ tc, d: (tc.x - px) * (tc.x - px) + (tc.z - pz) * (tc.z - pz) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, LIGHT_POOL);
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = torchLights[i];
      if (i < sorted.length) {
        const { tc } = sorted[i];
        l.position.set(tc.x, tc.y + 0.15, tc.z);
        l.intensity = 22 + Math.sin(t * 9 + tc.x * 7.1) * 4 + Math.sin(t * 23 + tc.z * 3.3) * 3;
      } else l.intensity = 0;
    }
  }
  if (torchFlames && torchFlames.isPoints) { // ship decks hang lamp GROUPS — no flicker size
    torchFlames.material.size = 1.05 + Math.sin(t * 11) * 0.12;
  }
  // damage numbers
  for (let i = dmgNumbers.length - 1; i >= 0; i--) {
    const d = dmgNumbers[i];
    d.life += dt;
    d.sp.position.y += dt * 1.6;
    d.sp.material.opacity = Math.max(0, 1 - d.life / 0.9);
    if (d.life > 0.9) {
      G.scene.remove(d.sp); d.sp.material.dispose(); d.tex.dispose();
      dmgNumbers.splice(i, 1);
    }
  }
  // bursts
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.life += dt;
    const pos = b.pts.geometry.attributes.position;
    for (let j = 0; j < b.vels.length; j++) {
      b.vels[j].y -= 12 * dt;
      pos.array[j * 3] += b.vels[j].x * dt;
      pos.array[j * 3 + 1] = Math.max(0.05, pos.array[j * 3 + 1] + b.vels[j].y * dt);
      pos.array[j * 3 + 2] += b.vels[j].z * dt;
    }
    pos.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 1 - b.life / b.maxLife);
    if (b.life > b.maxLife) {
      G.scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose();
      bursts.splice(i, 1);
    }
  }
}

export function makeGlowSprite(color = 0xff7722, scale = 1) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sp.scale.set(scale, scale, 1);
  return sp;
}

export function clearTransientFx() {
  for (const d of dmgNumbers) { G.scene.remove(d.sp); d.sp.material.dispose(); d.tex.dispose(); }
  dmgNumbers.length = 0;
  for (const b of bursts) { G.scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); }
  bursts.length = 0;
}

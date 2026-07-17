// Procedural WebAudio sound: no audio files needed.
import { G } from './state.js';

let ctx = null, master = null, ambGain = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  startAmbience();
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function toggleMute() {
  G.settings.mute = !G.settings.mute;
  if (master) master.gain.value = G.settings.mute ? 0 : 0.5;
  return G.settings.mute;
}

function env(gainNode, t0, a, peak, d) {
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.exponentialRampToValueAtTime(peak, t0 + a);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function osc(type, freq, t0, dur, peak = 0.2, freqEnd = null) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  env(g, t0, 0.008, peak, dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(t0, dur, peak = 0.2, filterFreq = 1200, type = 'lowpass', q = 1) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t0, 0.005, peak, dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

export const sfx = {
  swing() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.16, 0.14, 2400, 'bandpass', 2.5); },
  hit() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.1, 0.3, 700); osc('triangle', 160, t, 0.12, 0.2, 60); },
  hurt() { if (!ctx) return; const t = ctx.currentTime; osc('sawtooth', 220, t, 0.2, 0.18, 90); noise(t, 0.12, 0.18, 500); },
  crit() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.12, 0.3, 1400, 'highpass'); osc('square', 90, t, 0.18, 0.25, 40); },
  bones() { if (!ctx) return; const t = ctx.currentTime; for (let i = 0; i < 4; i++) noise(t + i * 0.05, 0.06, 0.16, 2600 - i * 400, 'bandpass', 4); },
  coin() { if (!ctx) return; const t = ctx.currentTime; osc('sine', 1046, t, 0.09, 0.13); osc('sine', 1568, t + 0.07, 0.16, 0.13); },
  potion() { if (!ctx) return; const t = ctx.currentTime; for (let i = 0; i < 3; i++) osc('sine', 300 + i * 120, t + i * 0.08, 0.1, 0.12); },
  chest() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.25, 0.14, 300); osc('sine', 523, t + 0.18, 0.14, 0.12); osc('sine', 784, t + 0.3, 0.2, 0.12); },
  key() { if (!ctx) return; const t = ctx.currentTime; osc('square', 1200, t, 0.06, 0.07); osc('square', 1600, t + 0.07, 0.08, 0.07); },
  levelup() { if (!ctx) return; const t = ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => osc('triangle', f, t + i * 0.09, 0.22, 0.16)); },
  stairs() { if (!ctx) return; const t = ctx.currentTime; [400, 320, 250, 180].forEach((f, i) => osc('triangle', f, t + i * 0.12, 0.2, 0.13)); },
  bolt() { if (!ctx) return; const t = ctx.currentTime; osc('sawtooth', 880, t, 0.18, 0.1, 220); noise(t, 0.14, 0.08, 3000, 'highpass'); },
  trap() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.08, 0.25, 4000, 'highpass'); osc('sawtooth', 130, t, 0.15, 0.2, 60); },
  death() { if (!ctx) return; const t = ctx.currentTime; [300, 230, 170, 110, 70].forEach((f, i) => osc('sawtooth', f, t + i * 0.16, 0.26, 0.14)); },
  bossroar() { if (!ctx) return; const t = ctx.currentTime; osc('sawtooth', 70, t, 0.9, 0.3, 45); noise(t, 0.7, 0.2, 250); },
  rumble() { if (!ctx) return; const t = ctx.currentTime; osc('sawtooth', 42, t, 1.1, 0.3, 26); noise(t, 1.2, 0.32, 130, 'lowpass'); for (let i = 0; i < 6; i++) noise(t + i * 0.13, 0.09, 0.18, 320 + i * 70); },
  cannon() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.3, 0.35, 500, 'lowpass'); osc('sawtooth', 90, t, 0.35, 0.25, 35); },
  victory() { if (!ctx) return; const t = ctx.currentTime; [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => osc('triangle', f, t + i * 0.14, 0.3, 0.15)); },
  dodge() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.12, 0.1, 1800, 'bandpass', 1.5); },
  // ship klaxon: three two-tone whoops
  alarm() { if (!ctx) return; const t = ctx.currentTime; for (let i = 0; i < 3; i++) { osc('sawtooth', 520, t + i * 0.55, 0.26, 0.12, 320); osc('sawtooth', 330, t + i * 0.55 + 0.27, 0.26, 0.12, 220); } },
};

// Low, quiet dungeon drone.
function startAmbience() {
  ambGain = ctx.createGain();
  ambGain.gain.value = 0.05;
  ambGain.connect(master);
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.7;
  const g1 = ctx.createGain(); g1.gain.value = 0.5;
  o1.connect(g1); o2.connect(g1); g1.connect(ambGain);
  o1.start(); o2.start();
  // slow wind noise
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  src.connect(f); f.connect(g2); g2.connect(ambGain);
  src.start();
  // slow LFO on the wind
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.15;
  lfo.connect(lfoG); lfoG.connect(g2.gain);
  lfo.start();
}

// THE TRAINING STATION — where a trooper becomes SOMETHING. Skill points come
// from field experience (one per level); ranks are bought here and shape the
// build: plating, servos, optics, drills, capacitors, nano-repair, an escort.
import { G } from './state.js';
import { SKILLS } from './config.js';
import { addMsg, refreshHud } from './ui.js';
import { sfx } from './audio.js';
import { skillRank, effectiveMaxHp, effectiveMaxMana } from './player.js';
import { spawnMinion } from './minions.js';
import { netSend, myId } from './net.js';

let hooks = { lock: null };
export function setSkillHooks(h) { hooks = { ...hooks, ...h }; }

export function openTrainRoom() {
  const el = document.getElementById('trainRoom');
  if (!el) return;
  G.mode = 'merchant';
  document.exitPointerLock?.();
  const closeBtn = document.getElementById('trClose');
  if (closeBtn) closeBtn.onclick = closeTrainRoom;
  renderTrainRoom();
  el.classList.add('show');
}
export function closeTrainRoom() {
  document.getElementById('trainRoom')?.classList.remove('show');
  G.mode = 'playing';
  hooks.lock?.();
}

function buySkill(id) {
  const sk = SKILLS.find(s => s.id === id);
  const r = skillRank(id);
  if (!sk || r >= sk.max || (G.run.skillPts || 0) <= 0) return;
  G.run.skillPts--;
  G.run.skills[id] = r + 1;
  // immediate effects
  const p = G.player;
  if (p) {
    const oldMax = p.maxHp;
    p.maxHp = effectiveMaxHp();
    p.hp += Math.max(0, p.maxHp - oldMax); // new plating arrives charged
    const oldMana = p.maxMana;
    p.maxMana = effectiveMaxMana();
    p.mana += Math.max(0, p.maxMana - oldMana);
  }
  if (id === 'escort' && p) {
    const pos = p.obj.position;
    if (G.net.role !== 'guest') spawnMinion('sword', myId(), G.floor, pos.x + 1.5, pos.z + 1.5);
    else netSend({ t: 'hire', kind: 'sword', f: G.floor, x: pos.x + 1.5, z: pos.z + 1.5 });
  }
  sfx.levelup();
  addMsg(`Trained: ${sk.name} ${sk.max > 1 ? `rank ${r + 1}` : ''}`, 'gold');
  refreshHud();
  renderTrainRoom();
}

function renderTrainRoom() {
  const pts = G.run?.skillPts || 0;
  const ptsEl = document.getElementById('trPts');
  if (ptsEl) ptsEl.textContent = `${pts} training point${pts === 1 ? '' : 's'}`;
  const list = document.getElementById('trList');
  if (!list) return;
  list.innerHTML = '';
  for (const sk of SKILLS) {
    const r = skillRank(sk.id);
    const row = document.createElement('div');
    row.className = 'tr-skill' + (r >= sk.max ? ' maxed' : '');
    const pips = Array.from({ length: sk.max }, (_, i) =>
      `<span class="tr-pip${i < r ? ' on' : ''}"></span>`).join('');
    row.innerHTML = `
      <div class="tr-info"><b>${sk.name}</b> <span class="tr-pips">${pips}</span>
        <div class="tr-desc">${sk.desc}</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'tr-buy';
    btn.textContent = r >= sk.max ? 'MAXED' : 'TRAIN';
    btn.disabled = r >= sk.max || pts <= 0;
    btn.onclick = () => buySkill(sk.id);
    row.appendChild(btn);
    list.appendChild(row);
  }
}

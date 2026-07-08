// DOM HUD: bars, minimap, messages, prompts, overlays.
import { G } from './state.js';
import { CLASSES, SHOP_ITEMS, FLOOR_NAMES, XP_FOR_LEVEL } from './config.js';

const $ = (id) => document.getElementById(id);

export function show(id) { $(id).classList.add('show'); }
export function hide(id) { $(id).classList.remove('show'); }
export function setHidden(id, h) { $(id).classList.toggle('hidden', h); }

// ---------- messages ----------
export function addMsg(text, kind = '') {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.innerHTML = text;
  const box = $('msgs');
  box.appendChild(div);
  while (box.children.length > 6) box.removeChild(box.firstChild);
  setTimeout(() => div.remove(), 6100);
}

// ---------- prompt ----------
export function showPrompt(html) {
  const p = $('prompt');
  if (p.innerHTML !== html) p.innerHTML = html;
  p.classList.remove('hidden');
}
export function hidePrompt() { $('prompt').classList.add('hidden'); }

// ---------- HUD ----------
export function refreshHud() {
  const p = G.player;
  if (!p) return;
  $('hudName').textContent = `${p.name} — ${p.cls.name} · Lv ${G.run.level}`;
  $('hpfill').style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
  $('hptext').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
  if (p.maxMana > 0) {
    setHidden('manabarWrap', false);
    $('manafill').style.width = `${(p.mana / p.maxMana) * 100}%`;
  } else setHidden('manabarWrap', true);
  const need = XP_FOR_LEVEL(G.run.level);
  $('xpfill').style.width = `${Math.min(100, (G.run.xp / need) * 100)}%`;
  $('potionCount').textContent = G.run.potions;
  $('goldCount').textContent = G.run.gold;
  $('floorNum').textContent = G.floor;
}

export function updateDodgeCooldown() {
  const p = G.player;
  if (!p) return;
  const frac = p.dodgeCd > 0 ? 1 - p.dodgeCd / 1.15 : 1;
  $('dodgeCool').style.width = `${frac * 100}%`;
}

export function flashVignette() {
  const v = $('hitVignette');
  v.style.transition = 'none';
  v.style.opacity = '1';
  requestAnimationFrame(() => {
    v.style.transition = 'opacity 0.5s';
    v.style.opacity = '0';
  });
}

// ---------- boss bar ----------
export function showBossBar(name) {
  $('bossName').textContent = name;
  setHidden('bossbarWrap', false);
}
export function updateBossBar(frac) {
  $('bossfill').style.width = `${Math.max(0, frac * 100)}%`;
}
export function hideBossBar() { setHidden('bossbarWrap', true); }

// ---------- party bar (co-op) ----------
export function updatePartyBar() {
  const bar = $('partyBar');
  if (!G.remotes.size) { bar.innerHTML = ''; return; }
  let html = '';
  for (const r of G.remotes.values()) {
    html += `<div class="pcard ${r.dead ? 'dead' : ''}">
      <span class="pname">${r.cls.icon} ${escapeHtml(r.name)}</span>
      <div class="pbar"><div class="pfill" style="width:${Math.max(0, (r.hp / r.maxHp) * 100)}%"></div></div>
    </div>`;
  }
  bar.innerHTML = html;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---------- minimap ----------
const MAP_RANGE = 22; // cells visible around player
export function updateMinimap() {
  const c = $('minimap');
  const ctx = c.getContext('2d');
  const p = G.player;
  if (!p || !G.grid) return;
  ctx.clearRect(0, 0, c.width, c.height);
  const { w, h, cells } = G.grid;
  const pcx = p.obj.position.x / 4, pcy = p.obj.position.z / 4;
  const scale = c.width / MAP_RANGE;

  // reveal around player
  const rcx = Math.round(pcx), rcy = Math.round(pcy);
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const x = rcx + dx, y = rcy + dy;
    if (x >= 0 && y >= 0 && x < w && y < h && dx * dx + dy * dy <= 26) G.explored[y * w + x] = 1;
  }

  const x0 = pcx - MAP_RANGE / 2, y0 = pcy - MAP_RANGE / 2;
  for (let y = Math.floor(y0); y < y0 + MAP_RANGE + 1; y++) {
    for (let x = Math.floor(x0); x < x0 + MAP_RANGE + 1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (!G.explored[y * w + x]) continue;
      const cell = cells[y * w + x];
      if (cell === 0) continue;
      const sx = (x - x0) * scale, sy = (y - y0) * scale;
      if (cell === 3) ctx.fillStyle = G.grid.stairsLocked ? '#7a3fd0' : '#ff8c1a';
      else if (cell === 4) ctx.fillStyle = '#7d4040';
      else if (cell === 5) ctx.fillStyle = '#3a3348';
      else ctx.fillStyle = '#4c445e';
      ctx.fillRect(sx, sy, scale + 0.5, scale + 0.5);
    }
  }
  // loot dots
  for (const l of G.loots) {
    if (l.taken || (l.kind !== 'chest' && l.kind !== 'goldchest')) continue;
    const lx = (l.x / 4 - x0) * scale, ly = (l.z / 4 - y0) * scale;
    if (lx < 0 || ly < 0 || lx > c.width || ly > c.height) continue;
    if (!G.explored[Math.round(l.z / 4) * w + Math.round(l.x / 4)]) continue;
    ctx.fillStyle = '#ffd35c';
    ctx.fillRect(lx - 2, ly - 2, 4, 4);
  }
  // enemies (awake only)
  ctx.fillStyle = '#e04545';
  for (const e of G.enemies) {
    if (e.state === 'dead' || e.state === 'inactive') continue;
    const ex = (e.obj.position.x / 4 - x0) * scale, ey = (e.obj.position.z / 4 - y0) * scale;
    if (ex < 0 || ey < 0 || ex > c.width || ey > c.height) continue;
    ctx.beginPath(); ctx.arc(ex, ey, e.boss ? 4 : 2.5, 0, 7); ctx.fill();
  }
  // remote players
  ctx.fillStyle = '#55b6ff';
  for (const r of G.remotes.values()) {
    const rx = (r.obj.position.x / 4 - x0) * scale, ry = (r.obj.position.z / 4 - y0) * scale;
    if (rx >= 0 && ry >= 0 && rx <= c.width && ry <= c.height) { ctx.beginPath(); ctx.arc(rx, ry, 3, 0, 7); ctx.fill(); }
  }
  // player arrow
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(-p.obj.rotation.y);
  ctx.fillStyle = '#7dff8a';
  ctx.beginPath();
  ctx.moveTo(0, -5); ctx.lineTo(4, 4); ctx.lineTo(-4, 4);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- class cards ----------
export function buildClassCards(onSelect) {
  const wrap = $('classCards');
  wrap.innerHTML = '';
  let selected = localStorage.getItem('codeorange_class') || 'knight';
  for (const [id, c] of Object.entries(CLASSES)) {
    const div = document.createElement('div');
    div.className = 'ccard' + (id === selected ? ' sel' : '');
    div.innerHTML = `<div class="icon">${c.icon}</div><div class="cname">${c.name}</div><div class="cdesc">${c.desc}</div>`;
    div.onclick = () => {
      wrap.querySelectorAll('.ccard').forEach(el => el.classList.remove('sel'));
      div.classList.add('sel');
      selected = id;
      localStorage.setItem('codeorange_class', id);
      onSelect?.(id);
    };
    wrap.appendChild(div);
  }
  return () => selected;
}

// ---------- merchant ----------
export function renderShop(onBuy) {
  const wrap = $('shopItems');
  wrap.innerHTML = '';
  $('shopGold').textContent = G.run.gold;
  for (const item of SHOP_ITEMS) {
    const bought = G.run.buys[item.id] || 0;
    const price = item.base + bought * item.grow;
    const maxed = item.id === 'speed' && G.run.speedBuys >= 3;
    const afford = G.run.gold >= price && !maxed;
    const div = document.createElement('div');
    div.className = 'shopitem' + (afford ? '' : ' off');
    div.innerHTML = `<div class="sicon">${item.icon}</div><div class="sname">${item.name}</div>
      <div class="sdesc">${item.desc}</div><div class="sprice">${maxed ? 'SOLD OUT' : price + ' g'}</div>`;
    if (afford) div.onclick = () => { onBuy(item.id, price); renderShop(onBuy); };
    wrap.appendChild(div);
  }
}

// ---------- transitions & end screens ----------
export function showTransition(floor, cb) {
  const t = $('transition');
  $('transTitle').textContent = floor <= 9 ? `FLOOR ${floor}` : `FLOOR ${floor} — THE ENDLESS DARK`;
  $('transSub').textContent = FLOOR_NAMES[Math.min(floor, 9)] || 'Deeper still…';
  t.classList.remove('hidden');
  t.style.opacity = '1';
  setTimeout(() => {
    cb?.();
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.classList.add('hidden'), 650);
    }, 450);
  }, 700);
}

export function runStatsHtml() {
  const secs = Math.floor((performance.now() - G.run.startTime) / 1000);
  const mm = Math.floor(secs / 60), ss = (secs % 60).toString().padStart(2, '0');
  return `Floor reached: <b>${G.floor}</b><br>
    Level: <b>${G.run.level}</b> · Kills: <b>${G.run.kills}</b><br>
    Gold gathered: <b>${G.run.gold}</b> · Chests: <b>${G.run.chests}</b><br>
    Time: <b>${mm}:${ss}</b>`;
}

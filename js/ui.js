// DOM HUD: bars, minimap, messages, prompts, crosshair, spell bar, inventory, overlays.
import { G } from './state.js';
import { CLASSES, SHOP_ITEMS, XP_FOR_LEVEL, SPELLS, CAPE_COLORS } from './config.js';
import { rarityOf } from './items.js';
import { setBossMusic } from './music.js';

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
  const usesArrows = !!G.inv.weapon?.ranged;
  setHidden('slotArrows', !usesArrows);
  if (usesArrows) $('arrowCount').textContent = G.run.arrows || 0;
  $('goldCount').textContent = G.run.gold;
  $('floorNum').textContent = G.floor;
}

export function updateDodgeCooldown() {
  const p = G.player;
  if (!p) return;
  const frac = p.dodgeCd > 0 ? 1 - p.dodgeCd / 1.15 : 1;
  $('dodgeCool').style.width = `${frac * 100}%`;
}

// ---------- crosshair & hitmarker ----------
export function setCrosshairHostile(h) {
  $('crosshair').classList.toggle('hostile', h);
}
export function setCrosshairAiming(a) {
  $('crosshair').classList.toggle('aiming', a);
}
export function hitmarker(crit) {
  const m = $('hitmark');
  m.classList.toggle('crit', !!crit);
  m.classList.remove('show');
  void m.offsetWidth; // restart animation
  m.classList.add('show');
}

// ---------- spell bar ----------
export function updateSpellBar(cooldowns) {
  const p = G.player;
  if (!p || !G.run.spells) return;
  G.run.spells.forEach((spellId, i) => {
    const sp = SPELLS[spellId];
    const el = $(`spell${i}`);
    if (!el) return;
    const icon = el.querySelector('.sp-icon');
    if (icon.textContent !== sp.icon) { icon.textContent = sp.icon; el.title = `${sp.name} (${sp.mana} mana)`; }
    const cd = cooldowns[spellId] || 0;
    el.querySelector('.cdmask').style.height = cd > 0 ? `${Math.min(100, (cd / sp.cd) * 100)}%` : '0%';
    el.classList.toggle('nomana', p.mana < sp.mana);
  });
}

// ---------- inventory ----------
function itemStatsHtml(item) {
  const bits = [];
  for (const [k, v] of Object.entries(item.stats)) {
    const label = { dmg: 'damage', armor: '% dmg reduction', crit: '% crit', speed: ' speed', hp: ' max HP', mregen: ' mana/s' }[k] || k;
    bits.push(`${k === 'dmg' ? '' : '+'}${v}${label === 'damage' ? ' damage' : label}`);
  }
  return bits.join(' · ');
}
function itemHtml(item) {
  const r = rarityOf(item);
  return `<div class="item-name" style="color:${r.color}">${item.icon} ${item.name}</div>
    <div class="item-stats">${r.name} · ${itemStatsHtml(item)}</div>`;
}

export function renderInventory({ onEquip, onSalvage, statsHtml }) {
  const slots = $('equipSlots');
  const labels = { weapon: 'Weapon', offhand: 'Offhand', trinket1: 'Trinket I', trinket2: 'Trinket II' };
  slots.innerHTML = '';
  for (const key of Object.keys(labels)) {
    const it = G.inv[key];
    const div = document.createElement('div');
    div.className = 'eq-slot';
    div.innerHTML = `<div class="slot-label">${labels[key]}</div>${it ? itemHtml(it) : '<span style="color:#55503f">— empty —</span>'}`;
    slots.appendChild(div);
  }
  $('invStats').innerHTML = statsHtml;
  const grid = $('bagGrid');
  grid.innerHTML = '';
  $('bagCount').textContent = `(${G.inv.bag.length}/12)`;
  for (const item of G.inv.bag) {
    const div = document.createElement('div');
    div.className = 'bag-item';
    div.innerHTML = itemHtml(item);
    div.onclick = () => onEquip(item);
    div.oncontextmenu = (e) => { e.preventDefault(); onSalvage(item); };
    grid.appendChild(div);
  }
  if (!G.inv.bag.length) grid.innerHTML = '<div style="color:#55503f;font-size:13px">Empty — slay elites and open chests.</div>';
}

// ---------- home stash ----------
export function renderStash({ stash, onToStash, onToBag }) {
  const bagGrid = $('stashBagGrid');
  bagGrid.innerHTML = '';
  for (const item of G.inv.bag) {
    const div = document.createElement('div');
    div.className = 'bag-item';
    div.innerHTML = itemHtml(item);
    div.onclick = () => onToStash(item);
    bagGrid.appendChild(div);
  }
  if (!G.inv.bag.length) bagGrid.innerHTML = '<div style="color:#55503f;font-size:13px">Bag is empty.</div>';
  const grid = $('stashGrid');
  grid.innerHTML = '';
  $('stashCount').textContent = `(${stash.length}/12)`;
  for (const item of stash) {
    const div = document.createElement('div');
    div.className = 'bag-item';
    div.innerHTML = itemHtml(item);
    div.onclick = () => onToBag(item);
    grid.appendChild(div);
  }
  if (!stash.length) grid.innerHTML = '<div style="color:#55503f;font-size:13px">Nothing stored yet.</div>';
}

// ---------- appearance controls ----------
export function buildLookControls(onChange) {
  const saved = localStorage.getItem('codeorange_look');
  if (saved) { try { Object.assign(G.look, JSON.parse(saved)); } catch {} }
  $('lookHelmet').checked = G.look.helmet;
  $('lookCape').checked = G.look.cape;
  const persist = () => {
    localStorage.setItem('codeorange_look', JSON.stringify(G.look));
    onChange?.();
  };
  $('lookHelmet').onchange = (e) => { G.look.helmet = e.target.checked; persist(); };
  $('lookCape').onchange = (e) => { G.look.cape = e.target.checked; persist(); };
  const sw = $('capeSwatches');
  sw.innerHTML = '';
  CAPE_COLORS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'swatch' + (i === G.look.capeColor ? ' sel' : '');
    d.style.background = '#' + c.hex.toString(16).padStart(6, '0');
    d.title = c.name;
    d.onclick = () => {
      G.look.capeColor = i;
      sw.querySelectorAll('.swatch').forEach(el => el.classList.remove('sel'));
      d.classList.add('sel');
      persist();
    };
    sw.appendChild(d);
  });
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
  setBossMusic(true);
  $('bossName').textContent = name;
  setHidden('bossbarWrap', false);
}
export function updateBossBar(frac) {
  $('bossfill').style.width = `${Math.max(0, frac * 100)}%`;
}
export function hideBossBar() { setBossMusic(false); setHidden('bossbarWrap', true); }

// cinematic name card: huge letters that linger, then fade
export function showBossCard(name, sub) {
  const el = document.getElementById('bossCard');
  if (!el) return;
  el.querySelector('.bc-name').textContent = name;
  el.querySelector('.bc-sub').textContent = sub || '';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3600);
}

// ---------- party bar (co-op) ----------
export function updatePartyBar() {
  const bar = $('partyBar');
  if (!G.remotes.size) { bar.innerHTML = ''; return; }
  let html = '';
  for (const r of G.remotes.values()) {
    const here = r.floor === G.floor;
    html += `<div class="pcard ${r.dead ? 'dead' : ''}">
      <span class="pname">${r.cls.icon} ${escapeHtml(r.name)} <span style="color:${here ? '#7dff8a' : '#8d8168'};float:right">F${r.floor}</span></span>
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
      else if (cell === 6) ctx.fillStyle = '#6b5f85'; // stairs up
      else if (G.grid.elev[y * w + x]) ctx.fillStyle = '#7a7099'; // platform
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
  // remote players (same floor only)
  ctx.fillStyle = '#55b6ff';
  for (const r of G.remotes.values()) {
    if (r.floor !== G.floor) continue;
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

// ---------- shops (town buildings) ----------
export function renderShop(onBuy, table) {
  const wrap = $('shopItems');
  wrap.innerHTML = '';
  $('shopGold').textContent = G.run.gold;
  if (table) {
    $('shopTitle').textContent = table.title;
    $('shopGreet').textContent = table.greet;
  }
  const ids = table ? table.items : SHOP_ITEMS.map(i => i.id);
  for (const id of ids) {
    const item = SHOP_ITEMS.find(i => i.id === id);
    if (!item) continue;
    const bought = G.run.buys[item.id] || 0;
    const price = item.base + bought * item.grow;
    const afford = G.run.gold >= price;
    const div = document.createElement('div');
    div.className = 'shopitem' + (afford ? '' : ' off');
    div.innerHTML = `<div class="sicon">${item.icon}</div><div class="sname">${item.name}</div>
      <div class="sdesc">${item.desc}</div><div class="sprice">${price} g</div>`;
    if (afford) div.onclick = () => { onBuy(item.id, price); renderShop(onBuy, table); };
    wrap.appendChild(div);
  }
}

// ---------- horde wave HUD ----------
export function showWaveBanner(n) {
  const b = $('waveBanner');
  b.textContent = `WAVE ${n}`;
  b.classList.remove('hidden', 'show');
  void b.offsetWidth;
  b.classList.add('show');
}
export function updateWaveHud(horde) {
  const el = $('waveHud');
  if (!horde.active) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = horde.phase === 'build'
    ? `🔨 BUILD — wave ${horde.wave + 1} in ${Math.max(0, Math.ceil(horde.t))}s · B barricade · H hire`
    : `🌊 WAVE ${horde.wave} — hold the line!`;
}

// ---------- tavern board ----------
export function renderBoardList(games, onJoin) {
  const wrap = $('boardList');
  if (!games.length) {
    wrap.innerHTML = '<div class="board-empty">No public games right now. Host one and check “List my game”!</div>';
    return;
  }
  wrap.innerHTML = '';
  for (const g of games) {
    const div = document.createElement('div');
    div.className = 'board-game';
    div.innerHTML = `<div><div class="bg-name">${escapeHtml(g.name || 'Adventurer')}'s party</div>
      <div class="bg-meta">${g.mode === 'horde' ? '🏰 Last Stand' : g.mode === 'duel' ? '⚔ Duel (PvP)' : '⚔ Campaign'} · code ${g.code}</div></div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Join';
    btn.onclick = () => onJoin(g.code);
    div.appendChild(btn);
    wrap.appendChild(div);
  }
}

// ---------- transitions & end screens ----------
export function showTransition(floor, cb, subtitle = null, warning = null) {
  const t = $('transition');
  $('transTitle').textContent = floor === 0 ? 'HOMEWARD' : floor <= 9 ? `FLOOR ${floor}` : `FLOOR ${floor} — THE ENDLESS DARK`;
  $('transSub').innerHTML = (subtitle || 'Deeper still…') +
    (warning ? `<br><span style="color:#ff8c4a;letter-spacing:4px">⚠ ${warning}</span>` : '');
  t.classList.remove('hidden');
  t.style.opacity = '1';
  setTimeout(() => {
    cb?.();
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.classList.add('hidden'), 650);
    }, 450);
  }, warning ? 1100 : 700);
}

export function runStatsHtml() {
  const secs = Math.floor((performance.now() - G.run.startTime) / 1000);
  const mm = Math.floor(secs / 60), ss = (secs % 60).toString().padStart(2, '0');
  return `Floor reached: <b>${G.floor}</b><br>
    Level: <b>${G.run.level}</b> · Kills: <b>${G.run.kills}</b><br>
    Gold gathered: <b>${G.run.gold}</b> · Chests: <b>${G.run.chests}</b><br>
    Time: <b>${mm}:${ss}</b>`;
}

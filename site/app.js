const M = window.META;
const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';
const SLOTS_LEFT = [['HEAD', 'Kopf'], ['NECK', 'Hals'], ['SHOULDER', 'Schultern'], ['BACK', 'Rücken'], ['CHEST', 'Brust'], ['WRIST', 'Handgelenke'], ['MAIN_HAND', 'Waffenhand'], ['OFF_HAND', 'Schildhand']];
const SLOTS_RIGHT = [['HANDS', 'Hände'], ['WAIST', 'Taille'], ['LEGS', 'Beine'], ['FEET', 'Füße'], ['FINGER_1', 'Finger 1'], ['FINGER_2', 'Finger 2'], ['TRINKET_1', 'Schmuck 1'], ['TRINKET_2', 'Schmuck 2'], ['RANGED', 'Distanz']];
const ANIMATIONS = [['Stand', 'Stehen'], ['EmoteWave', 'Winken'], ['EmoteCheer', 'Jubeln'], ['EmoteDance', 'Tanzen'], ['Run', 'Laufen']];

const state = { data: null, history: {}, sessions: {}, chars: [], selected: null, use3d: true, tileViewers: [], loViewer: null, loToken: 0 };

try {
  state.selected = localStorage.getItem('selected');
  const pref = localStorage.getItem('use3d');
  state.use3d = pref ? pref === '1' : !matchMedia('(max-width: 760px)').matches;
} catch {}
if (!window.Model3D.supported()) state.use3d = false;

init();

async function init() {
  try {
    const optional = (f) => fetch(`${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const [data, history, sessions] = await Promise.all([
      fetch(`data.json?t=${Date.now()}`).then((r) => r.json()),
      optional('history.json'),
      optional('sessions.json'),
    ]);
    state.data = data;
    state.history = history;
    state.sessions = sessions;
  } catch (err) {
    document.getElementById('sync').textContent = 'Daten fehlen';
    return;
  }

  const roleOrder = (c) => M.ROLES[c.role]?.order ?? 9;
  state.chars = [...state.data.characters].sort((a, b) => roleOrder(a) - roleOrder(b) || (b.level ?? 0) - (a.level ?? 0) || (b.equippedIlvl ?? 0) - (a.equippedIlvl ?? 0));
  if (!state.chars.some((c) => c.key === state.selected && c.level)) state.selected = state.chars.find((c) => c.level)?.key;

  const d = state.data;
  if (d.title) {
    document.title = `${d.title} · WoW Forever`;
    document.getElementById('title').textContent = d.title;
    document.getElementById('brand').textContent = d.title.toUpperCase();
  }
  document.getElementById('brand-sub').textContent = `${d.era === 'retail' ? 'RETAIL' : 'FOREVER'} · EU · ${state.chars.length} SPIELER`;
  document.getElementById('sync').textContent = `SYNC ${new Date(d.generatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

  setupNav();
  setup3dToggle();
  renderKpis();
  renderTiles();
  renderBuffs();
  renderLoadout();
  renderProfessions();
  renderRoute();
  renderHistory();
}

// ---------------------------------------------------------------------------
// Navigation und 3D-Schalter

function setupNav() {
  const links = [...document.querySelectorAll('.nav-links a')];
  const targets = links.map((a) => document.querySelector(a.getAttribute('href')));
  const onScroll = () => {
    let idx = 0;
    targets.forEach((t, i) => { if (t && !t.hidden && t.getBoundingClientRect().top < 140) idx = i; });
    links.forEach((a, i) => a.classList.toggle('active', i === idx));
  };
  addEventListener('scroll', onScroll, { passive: true });
}

function setup3dToggle() {
  const btn = document.getElementById('toggle-3d');
  const sync = () => { btn.textContent = state.use3d ? '3D an' : '3D aus'; btn.setAttribute('aria-pressed', String(state.use3d)); };
  sync();
  if (!window.Model3D.supported()) { btn.disabled = true; btn.title = 'Dein Browser unterstützt kein WebGL.'; return; }
  btn.addEventListener('click', () => {
    state.use3d = !state.use3d;
    try { localStorage.setItem('use3d', state.use3d ? '1' : '0'); } catch {}
    sync();
    renderTiles();
    renderLoadout();
  });
}

// ---------------------------------------------------------------------------
// Kopfzahlen

function renderKpis() {
  const ok = state.chars.filter((c) => c.level);
  const levels = ok.map((c) => c.level);
  const lo = Math.min(...levels), hi = Math.max(...levels);

  document.getElementById('kpis').innerHTML = [
    countdownKpi(),
    kpi(lo === hi ? lo : `${lo}-${hi}`, 'Level-Spanne'),
    hoursKpi(ok),
    tempoKpi(),
  ].join('');
}

// Vor dem Start zählt die Zahl die Tage bis Forever, danach die Tage seit dem Start.
function countdownKpi() {
  const launch = state.data.launch ? new Date(`${state.data.launch}T00:00:00`) : null;
  if (!launch) return '';
  const days = Math.ceil((launch - Date.now()) / 864e5);
  return days > 0 ? kpi(days, days === 1 ? 'Tag bis Forever' : 'Tage bis Forever', 'hot') : kpi(`Tag ${1 - days}`, 'seit Forever-Start', 'hot');
}

// Spielstunden bis Level 60 laut Referenzkurve. Die Gruppe spielt zusammen, also zählt der niedrigste Charakter.
// Vor dem Start (Retail-Charaktere über 60) zeigt die Zahl die volle Strecke ab Level 1.
function hoursKpi(chars) {
  const preStart = state.data.era === 'retail';
  const level = preStart ? 1 : Math.min(...chars.map((c) => c.level));
  const left = Math.max(0, hoursAt(60) - hoursAt(level));
  if (!preStart && left === 0) return kpi('60', 'Alle auf Max-Level');
  return kpi(`~${Math.round(left)} h`, preStart ? 'Spielzeit bis 60' : 'Noch bis Level 60');
}

// Tempo: durchschnittlicher Level-Zuwachs je gemeinsamer Session (letzte 10 Sessions).
function tempoKpi() {
  const list = (state.sessions.list ?? []).slice(-10);
  if (!list.length) return kpi('neu', 'Level pro Session', 'txt');
  const avg = list.reduce((s, x) => s + x.gain, 0) / list.length;
  return kpi(fmtDec(avg), `Level pro Session · ${list.length}×`);
}

function hoursAt(level) {
  const pts = M.LEVEL_HOURS;
  if (level >= pts.at(-1)[0]) return pts.at(-1)[1];
  const i = pts.findIndex(([l]) => l > level);
  const [l0, h0] = pts[i - 1];
  const [l1, h1] = pts[i];
  return h0 + ((level - l0) / (l1 - l0)) * (h1 - h0);
}

function kpi(value, label, cls = '') {
  return `<div class="kpi ${cls}"><b>${value}</b><span>${label}</span></div>`;
}

// ---------------------------------------------------------------------------
// Kacheln

function renderTiles() {
  state.tileViewers.forEach((v) => window.Model3D.destroy(v));
  state.tileViewers = [];
  const el = document.getElementById('tiles');
  el.innerHTML = state.chars.map((c, i) => tileHtml(c, i)).join('');
  el.querySelectorAll('.tile[data-key]').forEach((t) => t.addEventListener('click', () => select(t.dataset.key)));
  el.querySelectorAll('img').forEach(imgFallback);
  if (state.use3d) mountTiles();
}

function tileHtml(c, i) {
  const color = classColor(c);
  if (!c.level) {
    return `<div class="tile error" style="--cls:${color};animation-delay:${i * 70}ms">
      <div class="info"><span class="name">${esc(c.name)}</span><span class="spec">${esc(c.error || 'Keine Daten')}</span></div></div>`;
  }
  const role = M.ROLES[c.role] ?? M.ROLES.DAMAGE;
  return `<button type="button" class="tile ${c.key === state.selected ? 'selected' : ''}" data-key="${esc(c.key)}" style="--cls:${color};animation-delay:${i * 70}ms" aria-label="${esc(c.name)} auswählen">
    <span class="sweep"></span>
    <span class="top"><span class="role">${role.label.toUpperCase()}</span><span class="ago">${c.lastLogin ? ago(c.lastLogin) : ''}</span></span>
    <span class="stage" data-stage="${esc(c.key)}">${c.render ? `<img class="render" src="${esc(c.render)}" alt="">` : ''}</span>
    <span class="info">
      <span class="name">${esc(c.name)}</span>
      <span class="spec">${esc(c.spec || '')} ${esc(c.className || '')}${c.stale ? ' · alter Stand' : ''}</span>
      <span class="nums"><span>LV ${c.level}</span><span class="il">${c.equippedIlvl ?? '?'}</span></span>
    </span>
  </button>`;
}

// Die Modelle starten nacheinander, damit der Browser nicht alle Dateien gleichzeitig lädt.
async function mountTiles() {
  const env = state.data.modelEnv || 'classic';
  for (const c of state.chars) {
    if (!state.use3d || !c.model) continue;
    const stage = document.querySelector(`[data-stage="${CSS.escape(c.key)}"]`);
    if (!stage) continue;
    const box = document.createElement('div');
    box.className = 'stage-3d';
    stage.append(box);
    try {
      const v = await window.Model3D.mount(box, c.model, env);
      if (!document.body.contains(box)) { window.Model3D.destroy(v); return; }
      state.tileViewers.push(v);
      stage.querySelector('img.render')?.remove();
    } catch (err) {
      box.remove();
      console.warn('3D nicht verfügbar:', err.message);
      return;
    }
  }
}

function select(key) {
  if (key !== state.selected) {
    state.selected = key;
    try { localStorage.setItem('selected', key); } catch {}
    document.querySelectorAll('.tile[data-key]').forEach((t) => t.classList.toggle('selected', t.dataset.key === key));
    renderLoadout();
  }
  document.getElementById('loadout').scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Buffs und Werkzeuge

function renderBuffs() {
  const ok = state.chars.filter((c) => c.level);
  const providers = (classes) => ok.filter((c) => classes.includes(c.classId));
  const card = (entry, kind, i, withEffect) => {
    const who = providers(entry.classes);
    const classes = entry.classes.map((id) => M.CLASSES[id]?.name).join(', ');
    const attrs = `type="button" data-kind="${kind}" data-idx="${i}" aria-haspopup="dialog"`;
    return who.length
      ? `<button ${attrs} class="buff" style="--c:${classColor(who[0])}"><b>${esc(entry.name)}</b><small>${withEffect ? `${esc(entry.effect)} · ` : ''}<span class="who">${who.map((c) => esc(c.name)).join(', ')}</span></small></button>`
      : `<button ${attrs} class="buff off"><b>${esc(entry.name)}</b><small>fehlt · ${esc(classes)}</small></button>`;
  };

  document.getElementById('buffs').innerHTML = M.BUFFS.map((b, i) => card(b, 'buff', i, true)).join('');
  document.getElementById('tools').innerHTML = M.TOOLS.map((t, i) => card(t, 'tool', i, false)).join('');
  const active = M.BUFFS.filter((b) => providers(b.classes).length).length;
  document.getElementById('buff-count').textContent = `${active} / ${M.BUFFS.length} AKTIV`;

  document.querySelectorAll('#gruppe .buff').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const entry = (el.dataset.kind === 'buff' ? M.BUFFS : M.TOOLS)[el.dataset.idx];
    togglePopover(el, popoverHtml(entry, providers(entry.classes)));
  }));
}

// Tooltip zu Buffs und Tools: öffnet per Klick unter der Karte, schließt per Klick daneben oder Escape.
function popoverHtml(entry, who) {
  const classes = entry.classes.map((id) => M.CLASSES[id]?.name).join(', ');
  return `<div class="pop-head"><b>${esc(entry.name)}</b>${entry.effect ? `<span>${esc(entry.effect)}</span>` : ''}</div>
    <p>${esc(entry.desc)}</p>
    <div class="pop-row"><small>In der Gruppe</small>${who.length ? who.map((c) => `<span style="color:${classColor(c)}">${esc(c.name)}</span>`).join(', ') : `<span class="miss">niemand · möglich mit ${esc(classes)}</span>`}</div>
    <div class="pop-row"><small>Zauber</small>${entry.spells.map(([id, name, cls]) => `<a href="https://de.wowhead.com/classic/spell=${id}" target="_blank" rel="noopener">${esc(name)}</a> <em>${esc(M.CLASSES[cls]?.name ?? '')}</em>`).join('<br>')}</div>`;
}

let popover = null;
function togglePopover(anchor, html) {
  if (popover?.anchor === anchor) return closePopover();
  closePopover();
  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'dialog');
  el.innerHTML = html;
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = Math.min(340, innerWidth - 24);
  el.style.width = `${w}px`;
  el.style.left = `${Math.max(12, Math.min(r.left, innerWidth - w - 12)) + scrollX}px`;
  el.style.top = `${r.bottom + 8 + scrollY}px`;
  anchor.classList.add('open');
  popover = { el, anchor };
  window.$WowheadPower?.refreshLinks?.();
}

function closePopover() {
  if (!popover) return;
  popover.el.remove();
  popover.anchor.classList.remove('open');
  popover = null;
}
document.addEventListener('click', (e) => { if (popover && !popover.el.contains(e.target)) closePopover(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });

// ---------------------------------------------------------------------------
// Loadout des gewählten Charakters

function renderLoadout() {
  const el = document.getElementById('loadout');
  const c = state.chars.find((x) => x.key === state.selected);
  window.Model3D.destroy(state.loViewer);
  state.loViewer = null;
  state.loToken++;
  if (!c) { el.innerHTML = ''; return; }

  const items = new Map((c.items || []).map((i) => [i.slot, i]));
  const sets = countSets(c.items || []);
  const role = M.ROLES[c.role] ?? M.ROLES.DAMAGE;
  el.style.setProperty('--cls', classColor(c));

  el.innerHTML = `
    <div class="lo-head">
      <div>
        <span class="eyebrow">// LOADOUT</span>
        <h2>${esc(c.name)}</h2>
        <p>${c.title ? `${esc(c.title)} · ` : ''}${esc(c.race || '')} · ${esc(c.spec || '')} ${esc(c.className || '')}${c.guild ? ` · &lt;${esc(c.guild)}&gt;` : ''} · ${esc(c.realmName || '')}</p>
      </div>
      <div class="chips">
        <span class="chip role-chip">${role.label}</span>
        <span class="chip">Level ${c.level}</span>
        <span class="chip epic">iLvl ${c.equippedIlvl ?? '?'}</span>
        ${sets ? `<span class="chip ok">Set ${sets.count} Teile</span>` : ''}
        ${c.lastLogin ? `<span class="chip">Aktiv ${ago(c.lastLogin)}</span>` : ''}
      </div>
    </div>
    <div class="lo-body">
      <div class="gear-col left">${SLOTS_LEFT.map(([s, l]) => gearHtml(items.get(s), l)).join('')}</div>
      <div>
        <div class="lo-stage"><div class="ring"></div><div class="beam"></div><div class="model" id="lo-model">${c.render ? `<img class="render" src="${esc(c.render)}" alt="${esc(c.name)}">` : ''}</div></div>
        <div class="anims" id="lo-anims" hidden>${ANIMATIONS.map(([a, l], i) => `<button type="button" data-anim="${a}" class="${i === 0 ? 'active' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="gear-col right">${SLOTS_RIGHT.filter(([s]) => s !== 'RANGED' || items.has(s)).map(([s, l]) => gearHtml(items.get(s), l)).join('')}</div>
    </div>
    ${detailsHtml(c)}`;

  el.querySelectorAll('img').forEach(imgFallback);
  window.$WowheadPower?.refreshLinks?.();
  if (state.use3d && c.model) mountLoadout(c);
}

async function mountLoadout(c) {
  const token = state.loToken;
  const box = document.getElementById('lo-model');
  const holder = document.createElement('div');
  holder.className = 'stage-3d';
  box.append(holder);
  try {
    const v = await window.Model3D.mount(holder, c.model, state.data.modelEnv || 'classic');
    if (token !== state.loToken) { window.Model3D.destroy(v); return; }
    state.loViewer = v;
    box.querySelector('img.render')?.remove();
    const anims = document.getElementById('lo-anims');
    anims.hidden = false;
    anims.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      window.Model3D.play(state.loViewer, b.dataset.anim);
      anims.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    }));
  } catch {
    holder.remove();
  }
}

function gearHtml(it, label) {
  if (!it) return `<div class="gear empty"><span class="ico"></span><span class="txt"><span class="nm">${label}</span><span class="meta">leer</span></span></div>`;
  const q = (it.quality || 'COMMON').toLowerCase();
  const meta = [label, it.ilvl ? `iLvl ${it.ilvl}` : null].filter(Boolean).join(' · ');
  const ench = it.enchants?.length ? ` · <span class="en">${esc(it.enchants[0].replace(/^Verzaubert: /, ''))}</span>` : '';
  return link(it, `<div class="gear"><img class="ico b-${q}" src="${esc(it.icon || FALLBACK_ICON)}" alt="" loading="lazy">
    <span class="txt"><span class="nm q-${q}">${esc(it.name)}</span><span class="meta">${meta}${ench}</span></span></div>`);
}

// Werte und Berufe unter dem Loadout: gleiche Zellen in einem Raster, eine Zeile je Gruppe.
// Einen Balken bekommt nur, was einen festen Maximalwert hat (Prozentwerte, Berufsstufen).
const PCT_STATS = [['crit', 'Kritisch'], ['haste', 'Tempo'], ['mastery', 'Meisterschaft'], ['versatility', 'Vielseitigkeit']];
const MAIN_STATS = [['strength', 'Stärke'], ['agility', 'Beweglichkeit'], ['intellect', 'Intelligenz']];

function detailsHtml(c) {
  const s = c.stats ?? {};
  const main = MAIN_STATS.map(([k, l]) => ({ l, v: s[k] ?? 0 })).sort((a, b) => b.v - a.v)[0];
  const num = (v) => Math.round(v).toLocaleString('de-DE');
  const groups = [
    ['Basis', [
      ['Leben', s.health], [s.powerType || 'Ressource', s.power], [main.l, main.v || null], ['Ausdauer', s.stamina], ['Rüstung', s.armor],
    ].filter(([, v]) => v != null).map(([l, v]) => cell(l, num(v)))],
    ['Sekundär', PCT_STATS.filter(([k]) => s[k] != null).map(([k, l]) => cell(l, `${fmtDec(s[k])} %`, Math.min(100, s[k])))],
    ['Berufe', (c.professions ?? []).map((p) => cell(profName(p.name), `${p.skill ?? '?'}/${p.max ?? '?'}`, p.max ? (p.skill / p.max) * 100 : null))],
  ].filter(([, cells]) => cells.length);
  return `<div class="details">${groups.map(([label, cells]) => `<div class="drow" style="--n:${cells.length}"><span class="dlabel">${label}</span>${cells.join('')}</div>`).join('')}</div>`;
}

function cell(label, value, pct = null) {
  return `<div class="dcell"><span>${esc(label)}</span><b>${value}</b>${pct != null ? `<i class="bar"><i style="width:${pct}%"></i></i>` : ''}</div>`;
}

function countSets(items) {
  const counts = {};
  for (const i of items) if (i.set) counts[i.set] = (counts[i.set] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? { name: top[0], count: top[1] } : null;
}

// ---------------------------------------------------------------------------
// Berufe

function renderProfessions() {
  const cols = M.PRIMARY_PROFESSIONS;
  const ok = state.chars.filter((c) => c.level);
  const skill = (c, prof) => c.professions?.find((p) => profName(p.name) === prof);
  const short = (p) => p.slice(0, 5);

  document.getElementById('profs').innerHTML = `<table>
    <thead><tr><th></th>${cols.map((p) => `<th title="${p}">${short(p)}</th>`).join('')}</tr></thead>
    <tbody>${ok.map((c) => `<tr><td class="name">${esc(c.name)}</td>${cols.map((p) => {
      const s = skill(c, p);
      if (s) return `<td class="${s.skill >= s.max ? 'max' : 'has'}" title="${p}">${s.skill}/${s.max}</td>`;
      return '<td>·</td>';
    }).join('')}</tr>`).join('')}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Leveling-Route (Classic-Zonen, aktiv ab Forever-Start)

function renderRoute() {
  const ok = state.chars.filter((c) => c.level);
  const factions = new Set(ok.map((c) => (c.faction === 'HORDE' ? 'H' : 'A')));
  const allowed = (x) => x.f === 'N' || factions.has(x.f);
  const classicLevels = state.data.era !== 'retail';
  const bands = [[1, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60]];
  const inBand = (c, a, b) => c.level >= a && (c.level < b || (b === 60 && c.level <= 60));

  document.getElementById('route-note').textContent = classicLevels ? 'PASSEND ZUM LEVEL' : 'AB FOREVER-START · VORSCHAU';

  const place = (x, range) => `<a class="place" href="https://de.wowhead.com/classic/zone=${x.id}" target="_blank" rel="noopener">
    <i class="fd ${x.f === 'A' ? 'a' : x.f === 'H' ? 'h' : ''}"></i><span class="nm">${esc(x.name)}</span><span class="rg">${range}</span></a>`;
  const who = (list) => (list.length
    ? `<div class="route-who">${list.map((c) => `<span style="--cls:${classColor(c)}">${esc(c.name)} · ${c.level}</span>`).join('')}</div>`
    : '<span class="none">niemand</span>');

  const rows = bands.map(([a, b]) => {
    const zones = M.ZONES.filter((z) => allowed(z) && z.min >= a - 5 && z.min < b && z.max > a);
    const dungeons = M.DUNGEONS.filter((d) => allowed(d) && d.min >= a && d.min < b);
    const here = classicLevels ? ok.filter((c) => inBand(c, a, b)) : [];
    return `<div class="route-row ${here.length ? 'now' : ''}">
      <span class="lv">${a}-${b}</span>
      <div class="place-list">${zones.map((z) => place(z, `${z.min}-${z.max}`)).join('')}</div>
      <div class="place-list single">${dungeons.length ? dungeons.map((d) => place(d, `${d.min}-${d.max}`)).join('') : '<span class="none">keine</span>'}</div>
      ${who(here)}
    </div>`;
  });
  const at60 = classicLevels ? ok.filter((c) => c.level >= 60) : [];
  rows.push(`<div class="route-row ${at60.length ? 'now' : ''}">
    <span class="lv">60</span>
    <div class="place-list">${M.RAIDS.map((r) => place({ ...r, f: 'N' }, `${r.size} Sp.`)).join('')}</div>
    <span class="none">Raids</span>
    ${who(at60)}
  </div>`);

  let tip = '';
  if (classicLevels && ok.length) {
    const fits = M.DUNGEONS.filter((d) => allowed(d) && ok.every((c) => c.level >= d.min - 2 && c.level <= d.max));
    const levels = ok.map((c) => c.level);
    tip = `<div class="route-tips">
      <div><small>Passt für alle</small><b>${fits.length ? fits.map((d) => d.name).join(', ') : 'kein Dungeon, der Abstand ist zu groß'}</b></div>
      <div><small>Level-Abstand</small><b>${Math.max(...levels) - Math.min(...levels)} Level</b></div>
    </div>`;
  }
  document.getElementById('route').innerHTML = `${tip}
    <div class="route">
      <div class="route-head"><span>Level</span><span>Zonen</span><span>Dungeons</span><span>Hier</span></div>
      ${rows.join('')}
    </div>`;
}

// ---------------------------------------------------------------------------
// Verlauf

function renderHistory() {
  const el = document.getElementById('history');
  const series = state.chars.filter((c) => state.history[c.key]?.length).map((c) => ({ c, pts: state.history[c.key] }));
  const days = [...new Set(series.flatMap((s) => s.pts.map((p) => p.d)))].sort();
  const first = days[0];

  // Ohne mindestens zwei Tage gibt es keine Kurve. Dann bleibt der Bereich samt Navigationspunkt ausgeblendet.
  const hasData = days.length >= 2;
  document.getElementById('verlauf').hidden = !hasData;
  document.getElementById('nav-verlauf').hidden = !hasData;
  if (!hasData) return;

  // Die Kurve zeigt den Zuwachs seit dem ersten Wert, damit unterschiedliche Startwerte vergleichbar bleiben.
  const metric = state.data.era === 'retail' ? 'ilvl' : 'level';
  const delta = (pts, p) => (p[metric] ?? 0) - (pts[0][metric] ?? 0);
  const vals = series.flatMap((s) => s.pts.map((p) => delta(s.pts, p)));
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 800, H = 260, P = 28;
  const x = (d) => P + (days.indexOf(d) / (days.length - 1)) * (W - 2 * P);
  const y = (v) => H - P - ((v - min) / Math.max(max - min, 1)) * (H - 2 * P);
  const lines = series.map(({ c, pts }) => {
    const color = classColor(c);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(delta(pts, p)).toFixed(1)}`).join(' ');
    const last = pts.at(-1);
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px ${color})"/>
      <circle cx="${x(last.d)}" cy="${y(delta(pts, last))}" r="4" fill="${color}"/>`;
  }).join('');

  const since = days.find((d) => (Date.parse(days.at(-1)) - Date.parse(d)) / 864e5 <= 7) ?? first;
  const recap = series.map(({ c, pts }) => {
    const a = pts.find((p) => p.d >= since) ?? pts[0];
    const b = pts.at(-1);
    const parts = [];
    if (b.level - a.level) parts.push(`${signed(b.level - a.level)} Level`);
    if ((b.ilvl ?? 0) - (a.ilvl ?? 0)) parts.push(`${signed(b.ilvl - a.ilvl)} iLvl`);
    if ((b.epics ?? 0) - (a.epics ?? 0)) parts.push(`${signed(b.epics - a.epics)} episch`);
    return `<div style="--cls:${classColor(c)}"><b>${esc(c.name)}</b><span>${parts.join(' · ') || 'keine Änderung'}</span></div>`;
  }).join('');

  document.getElementById('history-note').textContent = `${metric === 'ilvl' ? 'ITEMLEVEL' : 'LEVEL'}-ZUWACHS · SEIT ${fmtDay(first)}`;
  el.innerHTML = `<div><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Verlauf">${lines}</svg>
    <div class="legend">${series.map(({ c }) => `<span style="--cls:${classColor(c)}"><i></i>${esc(c.name)}</span>`).join('')}</div></div>
    <div class="recap"><h3>Letzte 7 Tage</h3>${recap}</div>`;
}

// ---------------------------------------------------------------------------
// Hilfen

function classColor(c) { return M.CLASSES[c.classId]?.color ?? '#c9c2b3'; }
function profName(n) { return M.PROFESSIONS[n] ?? n; }
function signed(n) { return n > 0 ? `+${n}` : String(n); }
function fmtDec(n) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function fmtDay(d) { return new Date(d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

function ago(ts) {
  const h = (Date.now() - ts) / 36e5;
  if (h < 1) return 'gerade eben';
  if (h < 24) return `vor ${Math.round(h)} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`;
}

function link(it, inner) {
  if (!it.id) return inner;
  const domain = state.data.wowhead ?? 'classic';
  return `<a href="https://www.wowhead.com${domain ? `/${domain}` : ''}/item=${it.id}" target="_blank" rel="noopener">${inner}</a>`;
}

function imgFallback(img) {
  img.addEventListener('error', () => { if (img.classList.contains('ico')) img.src = FALLBACK_ICON; else img.remove(); }, { once: true });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

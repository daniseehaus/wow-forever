const M = window.META;
const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';
const SLOTS_LEFT = [['HEAD', 'Kopf'], ['NECK', 'Hals'], ['SHOULDER', 'Schultern'], ['BACK', 'Rücken'], ['CHEST', 'Brust'], ['WRIST', 'Handgelenke'], ['MAIN_HAND', 'Waffenhand'], ['OFF_HAND', 'Schildhand']];
const SLOTS_RIGHT = [['HANDS', 'Hände'], ['WAIST', 'Taille'], ['LEGS', 'Beine'], ['FEET', 'Füße'], ['FINGER_1', 'Finger 1'], ['FINGER_2', 'Finger 2'], ['TRINKET_1', 'Schmuck 1'], ['TRINKET_2', 'Schmuck 2'], ['RANGED', 'Distanz']];
const ANIMATIONS = [['Stand', 'Stehen'], ['EmoteWave', 'Winken'], ['EmoteCheer', 'Jubeln'], ['EmoteDance', 'Tanzen'], ['EmoteLaugh', 'Lachen'], ['EmoteRoar', 'Brüllen'], ['Run', 'Laufen']];
const INACTIVE_DAYS = 365;

const state = { data: null, history: {}, chars: [], selected: null, use3d: true, tileViewers: [], loViewer: null, loToken: 0 };

try {
  state.selected = localStorage.getItem('selected');
  const pref = localStorage.getItem('use3d');
  state.use3d = pref ? pref === '1' : !matchMedia('(max-width: 760px)').matches;
} catch {}
if (!window.Model3D.supported()) state.use3d = false;

init();

async function init() {
  try {
    const [data, history] = await Promise.all([
      fetch(`data.json?t=${Date.now()}`).then((r) => r.json()),
      fetch(`history.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    state.data = data;
    state.history = history;
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
    document.querySelector('.brand-mark').textContent = d.title[0].toUpperCase();
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
    targets.forEach((t, i) => { if (t && t.getBoundingClientRect().top < 140) idx = i; });
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
  const cap = state.data.maxLevel || 60;
  const active = ok.filter((c) => !isInactive(c));
  const avg = (list, f) => (list.length ? list.reduce((s, c) => s + (f(c) || 0), 0) / list.length : 0);
  const ach = ok.reduce((s, c) => s + (c.achievementPoints || 0), 0);

  document.getElementById('kpis').innerHTML = [
    kpi(fmtDec(avg(ok, (c) => c.level)), 'Ø Level', 'hot'),
    kpi(`${ok.filter((c) => c.level >= cap).length}/${ok.length}`, `Auf Level ${cap}`),
    kpi(Math.round(avg(active, (c) => c.equippedIlvl)), active.length < ok.length ? 'Ø Itemlevel (aktive)' : 'Ø Itemlevel'),
    kpi(ach >= 10000 ? `${Math.round(ach / 1000)}K` : ach, 'Erfolgspunkte'),
  ].join('');
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
    <span class="ghost">${c.equippedIlvl ?? ''}</span>
    <span class="sweep"></span>
    <span class="top"><span class="role" style="background:${role.color}">${role.label.toUpperCase()}</span><span class="ago">${c.lastLogin ? ago(c.lastLogin) : ''}</span></span>
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
  if (key === state.selected) {
    document.getElementById('loadout').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  state.selected = key;
  try { localStorage.setItem('selected', key); } catch {}
  document.querySelectorAll('.tile[data-key]').forEach((t) => t.classList.toggle('selected', t.dataset.key === key));
  renderLoadout();
}

// ---------------------------------------------------------------------------
// Buffs und Werkzeuge

function renderBuffs() {
  const era = state.data.era === 'retail' ? 'retail' : 'classic';
  const ok = state.chars.filter((c) => c.level);
  const providers = (classes) => ok.filter((c) => classes.includes(c.classId));

  const buffs = M.BUFFS[era];
  let active = 0;
  document.getElementById('buffs').innerHTML = buffs.map((b) => {
    const who = providers(b.classes);
    if (who.length) active++;
    const classes = b.classes.map((id) => M.CLASSES[id]?.name).join(', ');
    return who.length
      ? `<div class="buff" style="--c:${classColor(who[0])}"><b>${esc(b.name)}</b><small>${esc(b.effect)} · <span class="who">${who.map((c) => esc(c.name)).join(', ')}</span></small></div>`
      : `<div class="buff off"><b>${esc(b.name)}</b><small>fehlt · ${esc(classes)}</small></div>`;
  }).join('');
  document.getElementById('buff-count').textContent = `${active} / ${buffs.length} AKTIV`;

  document.getElementById('tools').innerHTML = M.TOOLS[era].map((t) => {
    const who = providers(t.classes);
    return who.length
      ? `<span class="tool">${esc(t.name)}<small>${who.map((c) => esc(c.name)).join(', ')}</small></span>`
      : `<span class="tool off">${esc(t.name)}<small>fehlt</small></span>`;
  }).join('');
}

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
        <span class="chip" style="color:${role.color}">${role.label}</span>
        <span class="chip">Level ${c.level}</span>
        <span class="chip epic">iLvl ${c.equippedIlvl ?? '?'}</span>
        ${sets ? `<span class="chip ok">Set ${sets.count} Teile</span>` : ''}
        ${c.achievementPoints ? `<span class="chip">${c.achievementPoints.toLocaleString('de-DE')} Erfolgspunkte</span>` : ''}
        ${c.lastLogin ? `<span class="chip">Aktiv ${ago(c.lastLogin)}</span>` : ''}
      </div>
    </div>
    <div class="lo-body">
      <div class="gear-col left">${SLOTS_LEFT.map(([s, l]) => gearHtml(items.get(s), l)).join('')}</div>
      <div>
        <div class="lo-stage"><div class="ring"></div><div class="beam"></div><div class="model" id="lo-model">${c.render ? `<img class="render" src="${esc(c.render)}" alt="${esc(c.name)}">` : ''}</div></div>
        <div class="anims" id="lo-anims" hidden>${ANIMATIONS.map(([a, l], i) => `<button type="button" data-anim="${a}" class="${i === 0 ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="hint" id="lo-hint" hidden>Ziehen zum Drehen · Mausrad zum Zoomen</div>
      </div>
      <div class="gear-col right">${SLOTS_RIGHT.filter(([s]) => s !== 'RANGED' || items.has(s)).map(([s, l]) => gearHtml(items.get(s), l)).join('')}</div>
    </div>
    ${statsHtml(c)}
    ${c.professions?.length ? `<div class="lo-foot">${c.professions.map((p) => `<span class="chip">${esc(profName(p.name))} <span class="mono">${p.skill ?? '?'}/${p.max ?? '?'}</span></span>`).join('')}</div>` : ''}`;

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
    document.getElementById('lo-hint').hidden = false;
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

// Alle Werte mit Balken. Der Balken zeigt den Wert im Vergleich zum höchsten Wert der Gruppe.
// Ressourcen (Wut, Mana, Runenmacht …) vergleicht die Seite nur mit derselben Ressource.
const STATS = [
  { key: 'health', label: 'Leben' },
  { key: 'power', label: null },
  { key: 'main', label: null },
  { key: 'stamina', label: 'Ausdauer' },
  { key: 'crit', label: 'Kritisch', pct: true },
  { key: 'haste', label: 'Tempo', pct: true },
  { key: 'mastery', label: 'Meisterschaft', pct: true },
  { key: 'versatility', label: 'Vielseitigkeit', pct: true },
  { key: 'armor', label: 'Rüstung' },
];
const MAIN_STATS = [['strength', 'Stärke'], ['agility', 'Beweglichkeit'], ['intellect', 'Intelligenz']];

function mainStat(s) {
  return MAIN_STATS.map(([k, l]) => ({ k, l, v: s[k] ?? 0 })).sort((a, b) => b.v - a.v)[0];
}

function statValue(c, key) {
  const s = c.stats;
  if (!s) return null;
  if (key === 'main') return mainStat(s).v || null;
  return s[key] ?? null;
}

function statsHtml(c) {
  const s = c.stats;
  if (!s) return '';
  const group = state.chars.filter((x) => x.stats);
  const rows = STATS.map((st) => {
    const v = statValue(c, st.key);
    if (v == null) return null;
    const peers = st.key === 'power' ? group.filter((x) => x.stats.powerType === s.powerType) : group;
    const max = Math.max(...peers.map((x) => statValue(x, st.key) ?? 0), v, 1);
    const label = st.key === 'power' ? s.powerType || 'Ressource' : st.key === 'main' ? mainStat(s).l : st.label;
    const shown = st.pct ? `${fmtDec(v)} %` : Math.round(v).toLocaleString('de-DE');
    return `<div class="stat"><div class="row"><span>${esc(label)}</span><b>${shown}</b></div><div class="bar"><i style="width:${(v / max) * 100}%"></i></div></div>`;
  }).filter(Boolean);
  return `<div class="stats" style="--n:${rows.length}">${rows.join('')}</div><p class="stats-note">Balken: Wert im Vergleich zum Besten der Gruppe</p>`;
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
  const era = state.data.era === 'retail' ? 'retail' : 'classic';
  const cols = M.PRIMARY_PROFESSIONS[era];
  const ok = state.chars.filter((c) => c.level);
  const skill = (c, prof) => c.professions?.find((p) => profName(p.name) === prof);
  const missing = cols.filter((p) => !ok.some((c) => skill(c, p)));
  const short = (p) => p.slice(0, 5);

  document.getElementById('profs').innerHTML = `<table>
    <thead><tr><th></th>${cols.map((p) => `<th class="${missing.includes(p) ? 'miss' : ''}" title="${p}">${short(p)}</th>`).join('')}</tr></thead>
    <tbody>${ok.map((c) => `<tr style="--cls:${classColor(c)}"><td class="name">${esc(c.name)}</td>${cols.map((p) => {
      const s = skill(c, p);
      if (s) return `<td class="${s.skill >= s.max ? 'max' : 'has'}" title="${p}">${s.skill}/${s.max}</td>`;
      return `<td class="${missing.includes(p) ? 'miss' : ''}">·</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
  document.getElementById('prof-note').textContent = missing.length ? `${missing.length} FEHLEN: ${missing.join(', ').toUpperCase()}` : 'ALLE ABGEDECKT';
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
  const facTag = (f) => (f === 'A' ? '<em class="fac a">A</em>' : f === 'H' ? '<em class="fac h">H</em>' : '');

  document.getElementById('route-note').textContent = classicLevels ? 'PASSEND ZUM LEVEL' : 'AB FOREVER-START · VORSCHAU';

  // Zeitleiste 1 bis 60 mit den Charakteren als Marker.
  const pos = (lv) => ((Math.min(lv, 60) - 1) / 59) * 100;
  // Namen abwechselnd über und unter der Leiste, damit nahe Level sich nicht überdecken.
  const markers = classicLevels
    ? [...ok].sort((a, b) => a.level - b.level).map((c, i) => `<span class="mk ${i % 2 ? 'down' : ''}" style="left:${pos(c.level)}%;--cls:${classColor(c)}" title="${esc(c.name)} · Level ${c.level}"><i></i><b>${esc(c.name)} ${c.level}</b></span>`).join('')
    : '';
  const timeline = `<div class="timeline">
    <div class="track">${bands.map(([a, b]) => `<span style="left:${pos(a)}%;width:${pos(b) - pos(a)}%"></span>`).join('')}</div>
    ${markers}
    <div class="ticks">${[1, 10, 20, 30, 40, 50, 60].map((l) => `<span style="left:${pos(l)}%">${l}</span>`).join('')}</div>
  </div>`;

  const rows = bands.map(([a, b]) => {
    const zones = M.ZONES.filter((z) => allowed(z) && z.min >= a - 5 && z.min < b && z.max > a);
    const dungeons = M.DUNGEONS.filter((d) => allowed(d) && d.min >= a && d.min < b);
    const who = classicLevels ? ok.filter((c) => inBand(c, a, b)) : [];
    return `<div class="route-row ${who.length ? 'now' : ''}">
      <span class="lv">${a}-${b}</span>
      <div class="cell"><small>ZONEN</small><div class="chips-sm">${zones.map((z) => `<span>${facTag(z.f)}${esc(z.name)} <i>${z.min}-${z.max}</i></span>`).join('')}</div></div>
      <div class="cell"><small>DUNGEONS</small><div class="chips-sm dng">${dungeons.length ? dungeons.map((d) => `<span>${facTag(d.f)}${esc(d.name)} <i>${d.min}-${d.max}</i></span>`).join('') : '<span class="none">keine</span>'}</div></div>
      <div class="cell who"><small>HIER</small>${who.length ? who.map((c) => `<span style="--cls:${classColor(c)}">${esc(c.name)} ${c.level}</span>`).join('') : '<span class="none">niemand</span>'}</div>
    </div>`;
  });

  const at60 = classicLevels ? ok.filter((c) => c.level >= 60) : [];
  rows.push(`<div class="route-row raid ${at60.length ? 'now' : ''}">
    <span class="lv">60</span>
    <div class="cell wide"><small>RAIDS</small><div class="chips-sm raid">${M.RAIDS.map((r) => `<span>${esc(r.name)} <i>${r.size} Spieler</i></span>`).join('')}</div></div>
    <div class="cell who"><small>BEREIT</small>${at60.length ? at60.map((c) => `<span style="--cls:${classColor(c)}">${esc(c.name)}</span>`).join('') : '<span class="none">niemand</span>'}</div>
  </div>`);

  let tip = '';
  if (classicLevels && ok.length) {
    const fits = M.DUNGEONS.filter((d) => allowed(d) && ok.every((c) => c.level >= d.min - 2 && c.level <= d.max));
    const levels = ok.map((c) => c.level);
    const spread = Math.max(...levels) - Math.min(...levels);
    tip = `<div class="route-tips">
      <div><small>PASST FÜR ALLE</small><b>${fits.length ? fits.map((d) => d.name).join(', ') : 'kein Dungeon, der Abstand ist zu groß'}</b></div>
      <div><small>LEVEL-ABSTAND</small><b>${spread} Level</b></div>
    </div>`;
  }
  document.getElementById('route').innerHTML = `${timeline}${tip}<div class="route">${rows.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Verlauf

function renderHistory() {
  const el = document.getElementById('history');
  const series = state.chars.filter((c) => state.history[c.key]?.length).map((c) => ({ c, pts: state.history[c.key] }));
  const days = [...new Set(series.flatMap((s) => s.pts.map((p) => p.d)))].sort();
  const first = days[0];

  if (days.length < 2) {
    el.innerHTML = `<div class="empty">${first ? `Der Verlauf startet am ${fmtDay(first)}. Ab dem zweiten Tag erscheint hier die Kurve.` : 'Der Verlauf startet mit dem nächsten Lauf der GitHub Action.'}</div>`;
    document.getElementById('history-note').textContent = '';
    return;
  }

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
function isInactive(c) { return c.lastLogin && (Date.now() - c.lastLogin) / 864e5 > INACTIVE_DAYS; }
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

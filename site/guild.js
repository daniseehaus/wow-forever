// Gildenseite: Kennzahlen, Mitglieder als sortierbare Tabelle mit Klassenfilter und Suche, aufklappbares Detail
// (3D-Modell, Ausrüstung, Talentbäume, Berufe) und der Gilden-Feed.
//
// Die Seite nutzt die Hilfen aus app.js: state, esc, ago, classColor, cardHtml, boardKpis, talentsHtml,
// Tooltips, Bänder und Bloodlust. app.js startet hier nicht selbst (siehe init dort).
// state.data zeigt auf die Gilde, state.data.characters auf ihre Mitglieder. So finden die Hilfen Namen und Klassen.

const G = {
  guild: null,
  events: [],
  sort: { key: 'level', dir: -1 },
  classes: new Set(),
  query: '',
  open: null,
  viewer: null,
  feedDays: 2,
};
// Wer länger offline ist, steht blass am Ende der Liste.
const INACTIVE_MS = 14 * 864e5;
const COLUMNS = [
  ['name', 'Name'],
  ['class', 'Klasse'],
  ['race', 'Volk'],
  ['level', 'Level'],
  ['rank', 'Rang'],
  ['ilvl', 'iLvl'],
  ['profs', 'Berufe'],
  ['last', '<span class="lg">Zuletzt online</span><span class="sm">Online</span>'],
];

initGuild();

async function initGuild() {
  const optional = (f) => fetch(`${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const feedPromise = optional('guild-feed.json');
  // Die Navigation ist auf beiden Seiten gleich. Session und Prep gibt es auf der Startseite nur mit gemeinsamen Sessions.
  optional('sessions.json').then((s) => {
    const none = !s.list?.length;
    ['nav-rueckblick', 'nav-vorbereitung'].forEach((id) => { document.getElementById(id).hidden = none; });
  });
  const talentsPromise = fetch('talents.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  try {
    G.guild = await fetch(`guild.json?t=${Date.now()}`).then((r) => r.json());
  } catch {
    document.getElementById('sync').textContent = 'Daten fehlen';
    document.querySelector('.sync').classList.add('stale');
    return;
  }

  const g = G.guild;
  state.data = { ...g, characters: g.members };
  state.chars = g.members;
  document.title = `${g.name} · Gilde · WoW Forever`;
  document.querySelectorAll('.title-text').forEach((el) => { el.textContent = g.name; });
  document.getElementById('brand').textContent = g.name.toUpperCase();
  document.getElementById('brand-sub').textContent = `FOREVER · EU · ${g.members.length} MITGLIEDER`;
  renderSync();
  setInterval(renderSync, 60000);

  setupNav();
  setupGuild3d();
  renderGuildKpis();
  renderFilters();
  renderRoster();
  renderGuildFeed();
  setupReveal();
  document.body.classList.add('ready');
  setupBloodlust();

  feedPromise.then((feed) => {
    G.events = feed.events ?? [];
    renderGuildFeed();
  });
  talentsPromise.then((talents) => {
    state.talents = talents.classes ?? {};
    document.querySelectorAll('.gd .talent-content').forEach((el) => {
      el.innerHTML = talentsHtml(charByKey(el.dataset.key));
      el.querySelectorAll('img').forEach(imgFallback);
      focusMainTree(el);
    });
  });

  // Escape schließt das offene Detail. Der Fokus geht zurück auf die Zeile.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !G.open) return;
    const key = G.open;
    closeDetail();
    document.querySelector(`tr[data-key="${CSS.escape(key)}"]`)?.focus();
  });
}

// ---------------------------------------------------------------------------
// Kennzahlen

function renderGuildKpis() {
  const all = G.guild.members;
  const ok = all.filter((m) => m.level);
  const avg = ok.length ? ok.reduce((s, m) => s + m.level, 0) / ok.length : 0;
  const week = ok.filter((m) => m.lastLogin && Date.now() - m.lastLogin < 7 * 864e5).length;
  const max = ok.filter((m) => m.level >= (G.guild.maxLevel ?? 60)).length;
  document.getElementById('kpis').innerHTML = [
    kpi(all.length, 'Mitglieder'),
    kpi(ok.length ? fmtDec(avg) : '?', 'Ø Level'),
    kpi(week, 'Aktiv in 7 Tagen'),
    kpi(max, `Auf Level ${G.guild.maxLevel ?? 60}`, max ? 'hot' : 'txt'),
  ].join('');
}

// ---------------------------------------------------------------------------
// Filter: Klassen-Icons und Suche. Berufe findet man über die Sortierung der Spalte Berufe.

function renderFilters() {
  const ok = G.guild.members.filter((m) => m.level);
  const classes = [...new Set(ok.map((m) => m.classId))].sort((a, b) => (M.CLASSES[a]?.name ?? '').localeCompare(M.CLASSES[b]?.name ?? ''));
  const el = document.getElementById('gfilter');
  el.innerHTML = `
    <div class="gf-classes" role="group" aria-label="Klassen">
      ${classes.map((id) => `<button type="button" class="gf-cls" data-cls="${id}" style="--cls:${M.CLASSES[id]?.color}" aria-pressed="false" title="${esc(M.CLASSES[id]?.name ?? '')}">
        <img src="${classIcon(id)}" alt="${esc(M.CLASSES[id]?.name ?? '')}"></button>`).join('')}
    </div>
    <label class="gf-search"><span class="sr">Mitglieder suchen: Name, Klasse, Volk, Rang oder Beruf</span><input id="gf-q" type="search" placeholder="Suchen" autocomplete="off"></label>`;
  el.querySelectorAll('img').forEach(imgFallback);

  el.querySelectorAll('.gf-cls').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.cls);
    if (G.classes.has(id)) G.classes.delete(id); else G.classes.add(id);
    b.setAttribute('aria-pressed', String(G.classes.has(id)));
    el.querySelector('.gf-classes').classList.toggle('some', G.classes.size > 0);
    renderRoster();
  }));
  el.querySelector('#gf-q').addEventListener('input', (e) => {
    G.query = e.target.value.trim().toLowerCase();
    renderRoster();
  });
}

// ---------------------------------------------------------------------------
// Tabelle

function renderRoster(focusSort = null) {
  closeDetail();
  const all = G.guild.members;
  const list = all.filter(visible).sort(compare);
  document.getElementById('roster-count').textContent = list.length === all.length ? `${all.length} Mitglieder` : `${list.length} von ${all.length}`;

  const head = `<thead><tr>${COLUMNS.map(([k, label]) => {
    const on = G.sort.key === k;
    return `<th class="c-${k}" aria-sort="${on ? (G.sort.dir < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" data-sort="${k}">${label}${on ? `<i aria-hidden="true">${G.sort.dir < 0 ? '▼' : '▲'}</i>` : ''}</button></th>`;
  }).join('')}</tr></thead>`;
  // Inaktive und Mitglieder ohne Profil stehen immer unten, jede Gruppe mit eigener Trennzeile.
  // So ist klar, warum sie bei jeder Sortierung am Ende stehen.
  const SEPARATORS = { 1: `Inaktiv · länger als ${INACTIVE_MS / 864e5} Tage offline`, 2: 'Ohne Profil · noch nicht in der API' };
  let last = 0;
  const rows = list.map((m) => {
    const g = group(m);
    const sep = g !== last && SEPARATORS[g] ? `<tr class="gsep"><td colspan="${COLUMNS.length}">${SEPARATORS[g]}</td></tr>` : '';
    last = g;
    return sep + rowHtml(m);
  });
  const body = list.length
    ? rows.join('')
    : `<tr class="gempty"><td colspan="${COLUMNS.length}">Kein Mitglied passt zum Filter.</td></tr>`;

  const el = document.getElementById('roster');
  el.innerHTML = `${head}<tbody>${body}</tbody>`;
  el.querySelectorAll('img').forEach(imgFallback);
  el.querySelectorAll('th button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.sort;
    // Zahlen und Zeiten starten absteigend (zuletzt online: neueste zuerst), Texte aufsteigend.
    const desc = ['level', 'ilvl', 'last'].includes(k);
    G.sort = G.sort.key === k ? { key: k, dir: -G.sort.dir } : { key: k, dir: desc ? -1 : 1 };
    renderRoster(k);
  }));
  // Nach dem Sortieren bleibt der Fokus auf dem Knopf der Spalte.
  if (focusSort) el.querySelector(`th button[data-sort="${focusSort}"]`)?.focus();
  el.querySelectorAll('tr.grow-m[data-key]').forEach((tr) => {
    tr.addEventListener('click', (e) => { if (!e.target.closest('a')) toggleDetail(tr.dataset.key); });
    tr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleDetail(tr.dataset.key);
    });
  });
}

// Die Suche findet Name, Klasse, Volk, Rang und Berufe.
function visible(m) {
  if (G.classes.size && !G.classes.has(m.classId)) return false;
  if (!G.query) return true;
  const text = [fullName(m), m.className, m.race, m.rank, ...(m.professions ?? []).map((p) => profName(p.name))].join(' ').toLowerCase();
  return text.includes(G.query);
}

function isActive(m) { return !!m.level && !!m.lastLogin && Date.now() - m.lastLogin < INACTIVE_MS; }

// Gruppe in der Tabelle: 0 aktiv, 1 inaktiv, 2 ohne Profil.
function group(m) { return !m.level ? 2 : isActive(m) ? 0 : 1; }

// Aktive zuerst, dann Inaktive, zuletzt Mitglieder ohne Profil. Innerhalb der Gruppe gilt die gewählte Spalte.
function compare(a, b) {
  const g = group(a) - group(b);
  if (g) return g;
  const va = sortValue(a);
  const vb = sortValue(b);
  const r = typeof va === 'string' ? va.localeCompare(vb, 'de') : (va ?? -1) - (vb ?? -1);
  return r * G.sort.dir || fullName(a).localeCompare(fullName(b), 'de');
}

function sortValue(m) {
  switch (G.sort.key) {
    case 'name': return fullName(m);
    case 'class': return m.className ?? '';
    case 'race': return m.race ?? '';
    case 'level': return m.level ?? null;
    case 'rank': {
      const i = (G.guild.ranks ?? []).indexOf(m.rank);
      return i < 0 ? 99 : i;
    }
    case 'ilvl': return m.equippedIlvl ?? null;
    // Gruppiert nach Hauptberuf (alphabetisch), im selben Beruf der höchste Skill zuerst.
    case 'profs': {
      const p = [...primaries(m)].sort((a, b) => profName(a.name).localeCompare(profName(b.name), 'de'))[0];
      return p ? `${profName(p.name)} ${String(999 - (p.skill ?? 0)).padStart(3, '0')}` : '\uffff';
    }
    case 'last': return m.lastLogin ?? null;
    default: return 0;
  }
}

function rowHtml(m) {
  const color = classColor(m);
  if (!m.level) {
    return `<tr class="grow-m missing" style="--cls:${color}">
      <td class="c-name"><span class="gname">${nameHtml(m)}</span></td>
      <td colspan="${COLUMNS.length - 1}" class="c-missing"><span data-tip="${esc(fullName(m))}\n${esc(m.error ?? 'Keine Daten')}" data-tip-plain tabindex="0">Profil noch nicht sichtbar</span>${m.rank ? ` · ${esc(m.rank)}` : ''}</td></tr>`;
  }
  const active = isActive(m);
  const profs = [...primaries(m)].sort((a, b) => profName(a.name).localeCompare(profName(b.name), 'de'));
  return `<tr class="grow-m${active ? '' : ' inactive'}" data-key="${esc(m.key)}" tabindex="0" aria-expanded="false" aria-label="${esc(fullName(m))}, Details aufklappen" style="--cls:${color}">
    <td class="c-name"><span class="gname">${nameHtml(m)}</span>${m.stale ? '<small class="gstale">alter Stand</small>' : ''}</td>
    <td class="c-class"><span class="gclass"><img src="${classIcon(m.classId)}" alt="" loading="lazy"><span>${esc(m.className ?? '')}</span></span></td>
    <td class="c-race">${esc(m.race ?? '')}</td>
    <td class="c-level"><b>${m.level}</b></td>
    <td class="c-rank">${esc(m.rank ?? '')}</td>
    <td class="c-ilvl">${m.equippedIlvl ?? '?'}</td>
    <td class="c-profs">${profs.length ? profs.map((p) => profChip(m, p)).join('') : '<span class="gnone">keine</span>'}</td>
    <td class="c-last"${m.lastLogin ? ` title="${esc(`${fmtDay(m.lastLogin)}, ${fmtTime(m.lastLogin)}`)}"` : ''}>${m.lastLogin ? ago(m.lastLogin) : '?'}</td>
  </tr>`;
}

function profChip(m, p) {
  const name = profName(p.name);
  // title statt data-tip: Der Tooltip von app.js fängt den Klick ab, die Zeile soll aber aufklappen.
  return `<span class="gprof" title="${esc(`${name} ${p.skill ?? '?'} / ${p.max ?? '?'}`)}">
    <img src="https://wow.zamimg.com/images/wow/icons/small/${FEED_ICONS.prof[name] ?? 'inv_misc_note_01'}.jpg" alt="${esc(name)}" loading="lazy"><span class="pn">${esc(name)}</span> <b>${p.skill ?? '?'}</b></span>`;
}

function primaries(m) { return (m.professions ?? []).filter((p) => p.kind === 'primary'); }

// ---------------------------------------------------------------------------
// Detail: Klick auf eine Zeile klappt darunter Modell, Ausrüstung, Berufe und Talentbäume auf.
// Es ist immer nur ein Detail offen. So läuft höchstens ein 3D-Modell.

function toggleDetail(key) {
  const same = G.open === key;
  closeDetail();
  if (same) return;
  const m = charByKey(key);
  const tr = document.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  if (!m.level || !tr) return;
  G.open = key;
  tr.classList.add('open');
  tr.setAttribute('aria-expanded', 'true');
  const row = document.createElement('tr');
  row.className = 'gdetail';
  row.innerHTML = `<td colspan="${COLUMNS.length}">${detailHtml(m)}</td>`;
  tr.after(row);
  row.querySelectorAll('img').forEach(imgFallback);
  focusMainTree(row);
  window.$WowheadPower?.refreshLinks?.();
  mountDetail3d(m, row.querySelector('.gd-stage'));
  // Die Zeile bleibt oben im Bild, das Detail klappt darunter auf.
  const top = tr.getBoundingClientRect().top;
  if (top < 90 || top > innerHeight * 0.6) tr.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDetail() {
  if (G.viewer) {
    window.Model3D.destroy(G.viewer);
    state.tileViewers = state.tileViewers.filter((v) => v !== G.viewer);
    G.viewer = null;
  }
  hideTip();
  document.querySelectorAll('tr.gdetail').forEach((r) => r.remove());
  document.querySelectorAll('tr.grow-m.open').forEach((r) => { r.classList.remove('open'); r.setAttribute('aria-expanded', 'false'); });
  G.open = null;
}

// Links Porträt, darunter Werte und Berufe. Rechts Kopf, Kennzahlen und Ausrüstung. Darunter über die ganze Breite die Talentbäume.
function detailHtml(m) {
  const items = new Map((m.items ?? []).map((i) => [i.slot, i]));
  const sets = countSets(m.items ?? []);
  const role = M.ROLES[m.role] ?? M.ROLES.DAMAGE;
  const slots = boardSlots(items);
  const maxIlvl = Math.max(1, ...(m.items ?? []).map((i) => i.ilvl ?? 0));
  const profs = profRows(m);
  const stats = statRows(m.stats);
  return `<div class="gd" style="--cls:${classColor(m)}">
    <div class="gd-top">
      <aside class="gd-side">
        <div class="gd-stage">${stageFxHtml()}${stageImg(m)}</div>
        ${stats ? `<div class="gd-sec"><span class="gd-label">Werte</span><dl class="gd-stats">${stats}</dl></div>` : ''}
        ${profs ? `<div class="gd-sec"><span class="gd-label">Berufe</span><div class="gd-profs">${profs}</div></div>` : ''}
      </aside>
      <div class="gd-main">
        <div class="lo-head">
          <div>
            <h2>${esc(m.name)}${m.surname ? ` <span class="surname">${esc(m.surname)}</span>` : ''}</h2>
            <p>${esc(m.race || '')} · ${esc(m.spec || '')} ${esc(m.className || '')}${m.rank ? ` · ${esc(m.rank)}` : ''}</p>
          </div>
          <div class="chips">
            <span class="chip role-chip">${role.label}</span>
            <span class="chip lv">Level ${m.level}</span>
            ${m.lastLogin ? `<span class="chip">Aktiv ${ago(m.lastLogin)}</span>` : ''}
          </div>
        </div>
        ${boardKpis(m, items, sets)}
        <div class="board">${slots.map(([s, l]) => cardHtml(items.get(s), l, maxIlvl)).join('')}</div>
      </div>
    </div>
    <div class="talent-content" data-key="${esc(m.key)}">${talentsHtml(m)}</div>
  </div>`;
}

// Das Modell lädt mit Vorrang. Bis es fertig ist, zeigt die Bühne den Loading-Balken über dem 2D-Render.
async function mountDetail3d(m, stage) {
  if (!state.use3d || !m.model || !stage) return;
  stage.classList.add('loading-3d');
  const band = loadingBand(stage);
  const box = document.createElement('div');
  box.className = 'stage-3d';
  stage.append(box);
  try {
    const v = await window.Model3D.mount(box, m.model, G.guild.modelEnv || 'classic', { priority: true });
    if (!document.body.contains(box) || G.open !== m.key) { window.Model3D.destroy(v); return; }
    v.charKey = m.key;
    G.viewer = v;
    state.tileViewers.push(v);
    if (document.body.classList.contains('lust')) fight(v);
    stage.querySelector('img.render, img.stage-icon')?.remove();
  } catch (err) {
    box.remove();
    if (document.body.contains(stage)) console.warn('3D nicht verfügbar:', err.message);
  } finally {
    stage.classList.remove('loading-3d');
    hideBand(band);
  }
}

// Gleiche Regel wie auf der Startseite (want3d in app.js). Der Schalter baut nur das offene Detail neu auf.
function setupGuild3d() {
  const btn = document.getElementById('toggle-3d');
  const sync = () => { btn.textContent = state.use3d ? '3D an' : '3D aus'; btn.setAttribute('aria-pressed', String(state.use3d)); };
  const apply = (on) => {
    if (on === state.use3d) return;
    state.use3d = on;
    sync();
    const key = G.open;
    if (key) { closeDetail(); toggleDetail(key); }
  };
  sync();
  if (!window.Model3D.supported()) { btn.disabled = true; btn.title = 'Dein Browser unterstützt kein WebGL.'; return; }
  btn.addEventListener('click', () => {
    pref3d = state.use3d ? '0' : '1';
    try { localStorage.setItem('use3d', pref3d); } catch {}
    apply(pref3d === '1');
  });
}

// ---------------------------------------------------------------------------
// Gilden-Feed: Beitritt, Austritt, Rangwechsel, Level-Meilensteine und epische Items, neueste zuerst

function renderGuildFeed() {
  const events = [...G.events].sort((a, b) => b.t - a.t);
  document.getElementById('gildenfeed').hidden = !events.length;
  if (!events.length) return;

  const days = new Map();
  for (const e of events) {
    const day = new Date(e.t).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(e);
  }
  const shown = [...days].slice(0, G.feedDays);
  const rest = days.size - shown.length;
  const week = events.filter((e) => Date.now() - e.t < 7 * 864e5).length;
  document.getElementById('gfeed-note').textContent = `${plural(week, 'EREIGNIS', 'EREIGNISSE')} IN 7 TAGEN`;

  const el = document.getElementById('gfeed');
  el.innerHTML = shown.map(([day, list]) => `<div class="feed-day"><h3>${day}<span>${plural(list.length, 'Ereignis', 'Ereignisse')}</span></h3><ul>${list.map(guildEventHtml).join('')}</ul></div>`).join('')
    + (rest ? `<button type="button" class="chip-btn feed-more">Vorherigen Tag zeigen · noch ${rest}</button>` : '');
  el.querySelectorAll('img').forEach(imgFallback);
  el.querySelector('.feed-more')?.addEventListener('click', () => { G.feedDays++; renderGuildFeed(); });
  window.$WowheadPower?.refreshLinks?.();
}

function guildEventHtml(e) {
  const time = new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  // Ausgetretene stehen nicht mehr in der Liste. Ihr Name kommt aus dem Ereignis.
  const m = G.guild.members.find((x) => x.key === e.key) ?? { name: e.name ?? e.key, surname: e.surname, classId: e.classId };
  const color = classColor(m);
  const who = `<b class="who" style="--cls:${color}">${esc(fullName(m))}</b>`;
  const row = (cls, icon, text, tip = '') => `<li class="ev ${cls}" style="--cls:${color}"${tip ? ` data-tip="${esc(tip)}"` : ''}><time>${time}</time><span class="ev-ico">${icon}</span><span class="ev-txt">${who} ${text}</span></li>`;
  const ranks = G.guild.ranks ?? [];

  switch (e.type) {
    case 'found':
      return `<li class="ev ev-guild ev-found"><time>${time}</time><span class="ev-ico">${feedIcon(FEED_ICONS.guild)}</span><span class="ev-txt"><strong>Gildengründung</strong> · &lt;${esc(e.guild ?? G.guild.name ?? '')}&gt;</span></li>`;
    case 'join':
      return row('ev-guild', feedIcon(FEED_ICONS.guild), `tritt der Gilde bei${e.rank ? ` · ${esc(e.rank)}` : ''}`);
    case 'leave':
      return row('ev-guild ev-leave', feedIcon(FEED_ICONS.leave), 'verlässt die Gilde');
    case 'rank': {
      // Oben in der Rangliste steht der höchste Rang. Fehlt ein Rang in der Liste, ist die Richtung unbekannt.
      const [to, from] = [ranks.indexOf(e.to), ranks.indexOf(e.from)];
      const dir = to < 0 || from < 0 ? 0 : from - to;
      const text = dir > 0 ? `wird zum <strong>${esc(e.to)}</strong> befördert` : dir < 0 ? `wird zum <strong>${esc(e.to)}</strong> zurückgestuft` : `ist jetzt <strong>${esc(e.to)}</strong>`;
      return row('ev-rank', feedIcon(dir < 0 ? 'inv_misc_note_01' : 'inv_misc_note_02'), text, `Rangwechsel\n${e.from} → ${e.to}`);
    }
    case 'milestone':
      if (e.max) return row('ev-max', feedIcon(FEED_ICONS.max, e.level), `erreicht <strong>Level ${e.level}</strong>, Max-Level!`);
      return row('ev-level', feedIcon(FEED_ICONS.level, e.level), `erreicht <strong>Level ${e.level}</strong>${e.level === 40 ? ' · Reiten' : ''}`);
    case 'item': {
      const q = (e.quality || 'COMMON').toLowerCase();
      const img = `<img class="ico sm b-${q}" src="${esc(e.icon || FALLBACK_ICON)}" alt="" loading="lazy">`;
      return row('ev-item', img, `trägt ${link(e, `<span class="q-${q}">${esc(e.name)}</span>`)}`);
    }
    default:
      return '';
  }
}

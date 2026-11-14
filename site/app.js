const M = window.META;
const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';
const SLOTS_LEFT = [['HEAD', 'Kopf'], ['NECK', 'Hals'], ['SHOULDER', 'Schultern'], ['BACK', 'Rücken'], ['CHEST', 'Brust'], ['WRIST', 'Handgelenke'], ['MAIN_HAND', 'Waffenhand'], ['OFF_HAND', 'Schildhand']];
const SLOTS_RIGHT = [['HANDS', 'Hände'], ['WAIST', 'Taille'], ['LEGS', 'Beine'], ['FEET', 'Füße'], ['FINGER_1', 'Finger 1'], ['FINGER_2', 'Finger 2'], ['TRINKET_1', 'Schmuck 1'], ['TRINKET_2', 'Schmuck 2'], ['RANGED', 'Distanz']];
// Laufende Streifen des Bands als eigene Ebene. Sie bewegt sich per transform, das kostet keinen Hauptthread.
const BAND_TEX = '<i class="band-tex" aria-hidden="true"></i>';
// Das Namensband startet sofort beim Klick und deckt den Aufbau des Loadouts ab.
const SWAP_MS = 1700;

const state = { data: null, talents: {}, sessions: null, feed: { events: [] }, questLog: [], feedDays: 3, routeAll: false, craft: { who: null, dir: 'to', all: false }, recapIdx: null, chars: [], selected: null, use3d: true, tileViewers: [] };

let pref3d = null;
// Das Loadout startet eingeklappt. Erst ein Klick auf eine Kachel wählt einen Charakter (select).
try {
  pref3d = localStorage.getItem('use3d');
} catch {}
state.use3d = want3d();

// Modelldateien und Renders ändern sich nie. Der Service Worker hält sie über den Besuch hinaus vor (sw.js).
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

// Vom Home-Bildschirm oder aus einem alten Tab bleibt die Seite im Speicher stehen und zeigt alten Code und alte Daten.
// Kommt man nach mehr als 15 Minuten zurück, lädt sie neu.
const LOADED_AT = Date.now();
function reloadIfOld() {
  if (document.visibilityState === 'visible' && Date.now() - LOADED_AT > 15 * 6e4) location.reload();
}
document.addEventListener('visibilitychange', reloadIfOld);
addEventListener('pageshow', (e) => { if (e.persisted) reloadIfOld(); });

// 3D läuft auch auf Handys. Nur „Daten sparen“ startet mit 2D, der Schalter schaltet 3D ein. Sonst gilt die letzte Wahl.
// Ohne 3D zeigt die Bühne den 2D-Render (von Blizzard oder als Schnappschuss des 3D-Modells, mirror-models.mjs).
function want3d() {
  if (!window.Model3D.supported()) return false;
  if (pref3d) return pref3d === '1';
  return !navigator.connection?.saveData;
}

// Die Gildenseite (gilde.html) nutzt die Hilfen dieser Datei und startet mit guild.js selbst.
if (document.getElementById('tiles')) init();

async function init() {
  const optional = (f) => fetch(`${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // Die Zusatzdaten starten parallel, halten aber die Charakterkacheln nicht auf.
  const sessionsPromise = optional('sessions.json');
  const feedPromise = optional('feed.json');
  const questLogPromise = optional('quest-log.json');
  const talentsPromise = fetch('talents.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  try {
    state.data = await fetch(`data.json?t=${Date.now()}`).then((r) => r.json());
  } catch (err) {
    document.getElementById('foot-stamp').textContent = 'Daten fehlen';
    document.getElementById('foot-stamp').classList.add('stale');
    return;
  }

  // Feste Reihenfolge wie in config.json (characters bzw. forever.characters).
  state.chars = [...state.data.characters];

  const d = state.data;
  if (d.title) {
    document.title = `${d.title} · WoW Forever`;
    document.querySelectorAll('.title-text').forEach((el) => { el.textContent = d.title; });
    document.getElementById('brand').textContent = d.title.toUpperCase();
  }
  renderSync();
  setInterval(renderSync, 60000);

  setupNav();
  setup3dToggle();
  renderKpis();
  renderTiles();
  renderCrafts();
  renderQuests();
  renderLoadout();
  renderRecap();
  renderPrep();
  renderRoute();
  renderFeed();

  setupReveal();
  // Erst jetzt wird der Inhalt sichtbar. So springt beim Laden nichts (siehe style.css, body.ready).
  document.body.classList.add('ready');
  startCountdown();
  setupBloodlust();

  const sessionsReady = sessionsPromise.then((sessions) => {
    state.sessions = sessions;
    renderKpis();
  });
  const feedReady = feedPromise.then((feed) => {
    state.feed = { events: feed.events ?? [] };
    renderFeed();
  });
  // Prep braucht die letzte Session, darum erst nach sessions.json.
  sessionsReady.then(() => renderPrep());
  const questsReady = questLogPromise.then((log) => { state.questLog = log.events ?? []; renderQuests(); });
  // Die Session-Karte zählt Items aus dem Feed und Quests aus dem Quest-Verlauf.
  Promise.all([sessionsReady, feedReady, questsReady]).then(() => renderRecap());
  talentsPromise.then((talents) => {
    state.talents = talents.classes ?? {};
    refreshTalents();
  });
}

// Stand der Daten, nur in der Fußzeile. Rot ab 2 Stunden ohne neuen Abruf.
function renderSync() {
  const t = new Date(state.data.generatedAt);
  const el = document.getElementById('foot-stamp');
  el.classList.toggle('stale', Date.now() - t > 2 * 36e5);
  el.title = ago(t.getTime());
  el.textContent = `Stand ${fmtDay(t)}, ${fmtTime(t)}`;
}

// ---------------------------------------------------------------------------
// Navigation und 3D-Schalter

// Der aktive Punkt folgt dem Abschnitt unter der Navigation. Die Positionen stehen im Speicher und
// werden nur neu gemessen, wenn sich die Höhe der Seite ändert. Beim Scrollen liest die Seite kein Layout.
function setupNav() {
  // Nur Sprungmarken auf dieser Seite. Links zur anderen Seite (Gilde, Gruppe) werden nie aktiv.
  const links = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  const targets = links.map((a) => document.querySelector(a.getAttribute('href')));
  let tops = [];
  const onScroll = () => {
    let idx = 0;
    tops.forEach((top, i) => { if (top < scrollY + 140) idx = i; });
    if (links[idx].classList.contains('active')) return;
    links.forEach((a, i) => a.classList.toggle('active', i === idx));
    // Auf schmalen Bildschirmen scrollt die Navigation seitlich. Der aktive Punkt bleibt sichtbar.
    const bar = links[idx].parentElement;
    if (bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: links[idx].offsetLeft - bar.clientWidth / 2 + links[idx].offsetWidth / 2, behavior: 'smooth' });
  };
  // offsetTop statt getBoundingClientRect: Die Einblende-Animation verschiebt Abschnitte kurz nach unten.
  const pageTop = (el) => { let y = 0; for (let n = el; n; n = n.offsetParent) y += n.offsetTop; return y; };
  new ResizeObserver(() => {
    tops = targets.map((t) => (t && !t.hidden ? pageTop(t) : Infinity));
    onScroll();
  }).observe(document.querySelector('main'));
  addEventListener('scroll', onScroll, { passive: true });

  // Passt die Navigation nicht in die Zeile, blendet sie am Rand aus. So sieht man, dass sie seitlich weitergeht.
  // Beim ersten Überlauf rückt der aktive Punkt ins Bild (Gildenseite: Guild steht ganz rechts).
  // Die Links werden mit beobachtet: Ihre Breite ändert sich, wenn die Schrift nachlädt oder Session und Prep erscheinen.
  const bar = document.querySelector('.nav-links');
  let centered = false;
  const fade = () => {
    const more = bar.scrollWidth - bar.clientWidth;
    if (!centered && more > 1) {
      centered = true;
      const cur = bar.querySelector('a.active');
      if (cur) bar.scrollLeft = cur.offsetLeft - bar.offsetLeft - bar.clientWidth / 2 + cur.offsetWidth / 2;
    }
    bar.classList.toggle('fade-l', more > 1 && bar.scrollLeft > 1);
    bar.classList.toggle('fade-r', more > 1 && bar.scrollLeft < more - 1);
  };
  bar.addEventListener('scroll', fade, { passive: true });
  const ro = new ResizeObserver(fade);
  [bar, ...bar.children].forEach((el) => ro.observe(el));
}

function setup3dToggle() {
  const btn = document.getElementById('toggle-3d');
  const sync = () => { btn.textContent = state.use3d ? '3D an' : '3D aus'; btn.setAttribute('aria-pressed', String(state.use3d)); };
  const apply = (on) => {
    if (on === state.use3d) return;
    state.use3d = on;
    sync();
    renderTiles();
    renderLoadout();
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
// Kopfzahlen

function renderKpis() {
  const ok = state.chars.filter((c) => c.level);
  document.getElementById('kpis').innerHTML = [
    tempoKpi(),
    avgKpi(ok),
    hoursKpi(ok),
  ].join('');
}

// Durchschnittslevel der Gruppe, wie auf der Gildenseite. Vor dem Start (Retail-Charaktere) zählt es nicht.
function avgKpi(chars) {
  if (!chars.length || state.data.era === 'retail') return kpi('?', 'Ø Level', 'txt');
  return kpi(fmtDec(chars.reduce((s, c) => s + c.level, 0) / chars.length), 'Ø Level');
}

function launchTime() { return state.data.launch ? new Date(`${state.data.launch}T00:00:00`).getTime() : null; }

// Zum Start läuft das Forever-Band über die Seite. Am Starttag sieht es jeder Besucher einmal, mit ?live auch vorab.
function startCountdown() {
  const launch = launchTime();
  if (!launch) return;
  const live = () => {
    if (Date.now() >= launch) try { localStorage.setItem('forever-live', '1'); } catch {}
    burst('Forever ist live', { dur: 3600 });
  };
  let seen = false;
  try { seen = localStorage.getItem('forever-live') === '1'; } catch {}
  const since = Date.now() - launch;
  if (new URLSearchParams(location.search).has('live') || (since >= 0 && since < 864e5 && !seen)) setTimeout(live, 900);
  if (since >= 0) return;

  // Bleibt die Seite über den Start offen, springt die Kennzahl auf „Tag 1“.
  const timer = setInterval(() => {
    if (Date.now() < launch) return;
    clearInterval(timer);
    renderKpis();
    live();
  }, 15000);
}

// Spielstunden bis Level 60 laut Referenzkurve. Die Gruppe spielt zusammen, also zählt der niedrigste Charakter.
// Vor dem Start (Retail-Charaktere über 60) zeigt die Zahl die volle Strecke ab Level 1.
function hoursKpi(chars) {
  const preStart = state.data.era === 'retail';
  // Ohne Charakter mit Daten (z. B. nur Platzhalter) gilt Level 1.
  const level = preStart || !chars.length ? 1 : Math.min(...chars.map((c) => c.level));
  const left = Math.max(0, hoursAt(60) - hoursAt(level));
  if (!preStart && left === 0) return kpi('60', 'Alle auf Max-Level');
  return kpi(`~${Math.round(left)} h`, preStart ? 'Spielzeit bis 60' : 'Noch bis Level 60');
}

// Tempo: durchschnittlicher Level-Zuwachs je gemeinsamer Session (letzte 10 Sessions).
// Die Baseline (Sessions vor der Erkennung, config sessionBaseline) zählt mit, solange es weniger als 10 erkannte Sessions gibt.
function tempoKpi() {
  if (!state.sessions) return kpi('…', 'Level pro Session', 'txt');
  const list = (state.sessions.list ?? []).slice(-10);
  const base = list.length < 10 ? state.sessions.baseline : null;
  const count = list.length + (base?.count ?? 0);
  const total = (state.sessions.list ?? []).length + (state.sessions.baseline?.count ?? 0);
  // Vor der ersten gemeinsamen Session gibt es kein Tempo. Die Kennzahl zählt dann die Sessions.
  if (!count) return kpi('0', 'Gemeinsame Sessions', 'txt');
  const avg = (list.reduce((s, x) => s + x.gain, 0) + (base?.levels ?? 0)) / count;
  return kpi(fmtDec(avg), `Level pro Session · ${total}×`);
}

// Anteil der Spielzeit bis 60 in Prozent, laut Referenzkurve.
function progress(level) { return (hoursAt(level) / hoursAt(60)) * 100; }

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
  el.querySelectorAll('.tile[data-key]').forEach((t) => t.addEventListener('click', () => { workerVoice(t.dataset.key); select(t.dataset.key); }));
  el.querySelectorAll('img').forEach(imgFallback);
  showSelectedTile();
  if (state.use3d) mountTiles();
}

// Auf dem Handy laufen die Kacheln seitlich. Die gewählte Kachel steht dann im Bild, nicht hinter dem Rand.
function showSelectedTile(smooth = false) {
  const row = document.getElementById('tiles');
  const tile = row.querySelector('.tile.selected');
  if (!tile || row.scrollWidth <= row.clientWidth) return;
  const left = tile.offsetLeft - row.offsetLeft - parseFloat(getComputedStyle(row).scrollPaddingLeft || 0);
  const inView = tile.offsetLeft - row.offsetLeft >= row.scrollLeft && tile.offsetLeft - row.offsetLeft + tile.offsetWidth <= row.scrollLeft + row.clientWidth;
  if (!inView) row.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
}

function tileHtml(c, i) {
  const color = classColor(c);
  // --i staffelt Einblenden und Bloodlust-Puls (siehe style.css).
  if (!c.level) {
    return `<div class="tile error${c.placeholder ? ' placeholder' : ''}" style="--cls:${color};--i:${i}">
      <div class="info"><span class="name">${nameHtml(c)}</span><span class="spec">${esc(c.error || 'Keine Daten')}</span></div></div>`;
  }
  const role = M.ROLES[c.role] ?? M.ROLES.DAMAGE;
  return `<button type="button" class="tile ${c.key === state.selected ? 'selected' : ''}" data-key="${esc(c.key)}" style="--cls:${color};--i:${i}" aria-label="${esc(fullName(c))} auswählen">
    ${stageFxHtml()}
    <span class="sweep"></span>
    <span class="top"><span class="role">${role.label.toUpperCase()}</span><span class="ago">${c.lastLogin ? ago(c.lastLogin) : ''}</span></span>
    <span class="stage" data-stage="${esc(c.key)}">${stageImg(c, 'fetchpriority="high"')}</span>
    <span class="info">
      <span class="name">${nameHtml(c)}</span>
      <span class="spec">${esc(c.spec || '')} ${esc(c.className || '')}${c.stale ? ' · alter Stand' : ''}</span>
      <span class="nums"><span>LV ${c.level}</span><span class="il">iLvl ${c.equippedIlvl ?? '?'}</span></span>
    </span>
  </button>`;
}

// Model3D lädt die Modelle nacheinander. Alle Kacheln zeigen sofort Loading und erst danach ihr fertiges 3D-Modell.
// Schlägt ein Modell fehl, erscheint stattdessen sein 2D-Render.
// Alle Modelle zeichnen höchstens 60 Bilder pro Sekunde, auch auf 120-Hz-Displays (pace in model3d.js).
async function mountTiles() {
  const env = state.data.modelEnv || 'classic';
  const jobs = [];
  for (const c of state.chars) {
    if (!state.use3d || !c.model) continue;
    const stage = document.querySelector(`[data-stage="${CSS.escape(c.key)}"]`);
    if (!stage) continue;
    stage.classList.add('loading-3d');
    const band = loadingBand(stage);
    jobs.push({ c, stage, band });
  }
  for (const { c, stage, band } of jobs) {
    const box = document.createElement('div');
    box.className = 'stage-3d';
    stage.append(box);
    try {
      const v = await window.Model3D.mount(box, c.model, env);
      if (!document.body.contains(box)) { window.Model3D.destroy(v); return; }
      v.charKey = c.key;
      state.tileViewers.push(v);
      if (document.body.classList.contains('lust')) fight(v);
      stage.querySelector('img.render, img.stage-icon')?.remove();
      stage.classList.remove('loading-3d');
      hideBand(band);
    } catch (err) {
      box.remove();
      stage.classList.remove('loading-3d');
      hideBand(band);
      console.warn('3D nicht verfügbar:', err.message);
    }
  }
}

// Bild auf der Bühne: der 2D-Render, ohne Render das große Klassen-Icon. So bleibt die Bühne nie leer (3D aus oder lädt nicht).
// renderSnap: Schnappschuss des 3D-Modells (mirror-models.mjs), eng zugeschnitten. Er braucht eine eigene Platzierung (snap in style.css).
function stageImg(c, attrs = '') {
  return c.render
    ? `<img class="render${c.renderSnap ? ' snap' : ''}" src="${esc(c.render)}" alt="" ${attrs}>`
    : `<img class="stage-icon" src="${classIcon(c.classId, 'large')}" alt="" ${attrs}>`;
}

// Bühne hinter dem Modell (Kachel und Gilden-Detail): pulsierender Schein in Klassenfarbe und Glühwürmchen,
// die langsam aufsteigen. Alles bewegt sich nur per transform und opacity (siehe style.css, .stage-fx).
function stageFxHtml() {
  const r = (a, b) => (a + Math.random() * (b - a)).toFixed(1);
  const flies = Array.from({ length: 14 }, () => `<i class="fly" style="left:${r(6, 94)}%;top:${r(45, 92)}%;--s:${r(2, 4.5)}px;--x:${r(-26, 26)}px;--d:${r(7, 13)}s;--w:-${r(0, 13)}s"></i>`).join('');
  return `<span class="stage-fx" aria-hidden="true"><i class="stage-glow"></i>${flies}</span>`;
}

// Schräger Balken statt des 2D-Renders, solange das 3D-Modell lädt.
function loadingBand(el) {
  const band = document.createElement('span');
  band.className = 'loading-band';
  band.innerHTML = `<span class="band-strip">${BAND_TEX}<span>Loading</span></span>`;
  el.append(band);
  return band;
}

function hideBand(band) {
  if (!band) return;
  band.classList.add('done');
  setTimeout(() => band.remove(), 400);
}

// Klick auf eine Kachel: Das Band startet sofort, während Scrollen und Aufbau im Hintergrund laufen.
// Ein zweiter Klick auf die gewählte Kachel klappt das Loadout wieder ein.
function select(key) {
  const el = document.getElementById('loadout');
  if (key === state.selected) {
    state.selected = null;
    document.querySelectorAll('.tile[data-key]').forEach((t) => t.classList.remove('selected'));
    releaseHover(el);
    el.classList.remove('swap');
    renderLoadout();
    return;
  }
  state.selected = key;
  document.querySelectorAll('.tile[data-key]').forEach((t) => t.classList.toggle('selected', t.dataset.key === key));
  showSelectedTile(true);
  swapBand();
  el.scrollIntoView({ behavior: 'smooth' });
  // Zwei Bilder geben dem Band Zeit, sichtbar zu werden, bevor das Loadout neu aufgebaut wird.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (state.selected !== key) return;
    releaseHover(el);
    renderLoadout();
    el.classList.add('swap');
  }));
}

// Vor dem Wechsel offene Tooltips schließen. Der Wowhead-Tooltip schließt erst mit einem mouseout auf seinem Link.
function releaseHover(el) {
  hideTip();
  [...el.querySelectorAll(':hover')].pop()?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
}

// Beim Wechsel zieht der Name als Band in Klassenfarbe über den Bildschirm.
function swapBand() {
  const el = document.getElementById('loadout');
  const c = state.chars.find((x) => x.key === state.selected);
  if (!c) return;
  el.classList.remove('swap');
  el.classList.add('swapping');
  clearTimeout(state.swapTimer);
  state.swapTimer = setTimeout(() => el.classList.remove('swapping'), SWAP_MS);
  // Das Band läuft über den ganzen Bildschirm. So ist es auch auf dem Handy sichtbar, wo das Loadout länger als der Bildschirm ist.
  // Bei schnellem Klicken ersetzt das neue Band das alte.
  state.swapBurst?.remove();
  state.swapBurst = burst(fullName(c), { color: classColor(c), dur: SWAP_MS });
}

// ---------------------------------------------------------------------------
// Bänder, Hochzählen und Einblenden

// Band als Durchzug, auf der ganzen Seite oder in einem Element (into). Farbe und Schrift folgen der Klassenfarbe.
function burst(text, { into = null, color = null, dur = 2600, icon = null, y = null } = {}) {
  const box = document.createElement('div');
  box.className = `burst${into ? ' local' : ''}`;
  box.setAttribute('aria-hidden', 'true');
  const strip = document.createElement('span');
  strip.className = 'band-strip';
  strip.style.setProperty('--dur', `${dur}ms`);
  if (y != null) strip.style.setProperty('--y', `${Math.round(y)}px`);
  if (color) {
    const dark = isLight(color);
    strip.style.setProperty('--band', color);
    strip.style.setProperty('--band-ink', dark ? '#07090c' : '#fff');
    strip.classList.toggle('dark', dark);
  }
  strip.innerHTML = `${BAND_TEX}${icon ? `<img src="${esc(icon)}" alt="">` : ''}<span>${esc(text)}</span>`;
  box.append(strip);
  (into ?? document.body).append(box);
  into?.querySelectorAll(':scope > .burst').forEach((b) => b !== box && b.remove());
  setTimeout(() => box.remove(), dur + 100);
  return box;
}

// Helle Klassenfarben (Priester, Schurke) bekommen dunkle Schrift auf dem Band.
function isLight(hex) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 165;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Panels gleiten beim Scrollen ins Bild, ihre Zeilen folgen gestaffelt.
// Danach gilt der Abschnitt als ruhig (settled): Baut er neu auf („Ganze Route zeigen“), blenden die Zeilen nicht noch einmal ein.
function setupReveal() {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('in');
    setTimeout(() => en.target.classList.add('settled'), 1200);
    io.unobserve(en.target);
  }), { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('main > .loadout, main > .panel').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
}

// ---------------------------------------------------------------------------
// Arbeiter-Stimmen aus Warcraft III, deutsche Fassung (Peon, Acolyte, Peasant). Klick auf eine Kachel spielt eine zufällige Antwort.
// Wer dieselbe Kachel schnell hintereinander anklickt, macht den Arbeiter wütend.

const VOICE = {
  what: [['peon', 4], ['acolyte', 5], ['peasant', 4]].flatMap(([w, n]) => Array.from({ length: n }, (_, i) => `${w}-what${i + 1}`)),
  pissed: [['peon', 4], ['acolyte', 8], ['peasant', 5]].flatMap(([w, n]) => Array.from({ length: n }, (_, i) => `${w}-pissed${i + 1}`)),
  audio: null, key: null, clicks: 0, last: 0, prev: null,
};

function workerVoice(key) {
  const now = Date.now();
  VOICE.clicks = key === VOICE.key && now - VOICE.last < 1500 ? VOICE.clicks + 1 : 1;
  VOICE.key = key;
  VOICE.last = now;
  const pool = VOICE.clicks >= 4 ? VOICE.pissed : VOICE.what;
  let name;
  do name = pool[Math.floor(Math.random() * pool.length)]; while (name === VOICE.prev);
  VOICE.prev = name;
  VOICE.audio?.pause();
  VOICE.audio = new Audio(`sounds/workers/${name}.mp3`);
  VOICE.audio.volume = 0.7;
  VOICE.audio.play().catch(() => {});
}

// ---------------------------------------------------------------------------
// Bloodlust: Klick auf das Logo. 15 Sekunden Kampfrausch, danach 60 Sekunden „Gesättigt“.

const LUST = { dur: 15000, sated: 60000, until: 0, satedUntil: 0, timer: null, sound: null };

function setupBloodlust() {
  LUST.sound = new Audio('sounds/bloodlust.mp3');
  LUST.sound.preload = 'auto';
  LUST.sound.volume = 0.8;
  document.querySelector('.brand-logo').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); bloodlust(); });
}

function bloodlust() {
  const now = Date.now();
  if (now < LUST.satedUntil) {
    burst(`Gesättigt · ${Math.ceil((LUST.satedUntil - now) / 1000)} s`, { color: '#2a3038', dur: 1500 });
    return;
  }
  LUST.until = now + LUST.dur;
  LUST.satedUntil = now + LUST.sated;
  LUST.sound.currentTime = 0;
  LUST.sound.play().catch(() => {});
  burst('Bloodlust', { color: '#c41e3a', icon: 'icons/bloodlust.jpg', dur: 2400 });
  document.body.classList.add('lust', 'lust-hit');
  setTimeout(() => document.body.classList.remove('lust-hit'), 600);
  lustTempo(true);
  state.tileViewers.forEach(fight);
  clearTimeout(LUST.timer);
  LUST.timer = setTimeout(() => {
    document.body.classList.remove('lust');
    lustTempo(false);
    state.tileViewers.forEach(calm);
  }, LUST.dur);
}

// Im Rausch laufen Scan-Linie, Titel-Glanz, Kachel-Schimmer und Sync-Punkt schneller.
// Das Tempo ändert sich über die Web Animations API. Eine neue animation-duration würde die Animationen springen lassen.
const LUST_TEMPO = { scan: 5, shimmer: 5.7, sweep: 5, blink: 4, 'glow-pulse': 3, firefly: 2.5 };
function lustTempo(on) {
  for (const a of document.getAnimations()) {
    const rate = LUST_TEMPO[a.animationName];
    if (rate) a.updatePlaybackRate(on ? rate : 1);
  }
}

// Kampfhaltung und Angriff passend zur Waffe. Die API nennt keinen Waffentyp, darum zählen Klasse und Schildhand.
function combatAnims(c) {
  const main = (c.items ?? []).find((i) => i.slot === 'RANGED') ?? (c.items ?? []).find((i) => i.slot === 'MAIN_HAND');
  if (c.classId === 3) {
    const n = (main?.name ?? '').toLowerCase();
    if (n.includes('armbrust')) return ['ReadyCrossbow', 'AttackCrossbow'];
    if (/gewehr|büchse|flinte|muskete/.test(n)) return ['ReadyRifle', 'AttackRifle'];
    return ['ReadyBow', 'AttackBow'];
  }
  if ([5, 8, 9].includes(c.classId)) return ['ReadySpellDirected', 'SpellCastDirected'];
  if ((c.items ?? []).some((i) => i.slot === 'OFF_HAND')) return ['Ready1H', 'Attack1H'];
  return ['Ready2H', 'Attack2H'];
}

// Bloodlust: erst Kampfschrei, dann im Wechsel Kampfhaltung und Angriff. Jede Figur mit eigenem Takt.
function fight(v) {
  const [ready, attack] = combatAnims(charByKey(v.charKey));
  clearTimeout(v.fightTimer);
  window.Model3D.play(v, 'BattleRoar');
  let swing = false;
  const next = () => {
    if (!document.body.classList.contains('lust')) return;
    swing = !swing;
    window.Model3D.play(v, swing ? attack : ready);
    v.fightTimer = setTimeout(next, swing ? 950 : 700 + Math.random() * 900);
  };
  v.fightTimer = setTimeout(next, 1500 + Math.random() * 400);
}

function calm(v) {
  clearTimeout(v.fightTimer);
  window.Model3D.play(v, 'Stand');
}


// ---------------------------------------------------------------------------
// Herstellen: Was kann der Squad füreinander herstellen? Grundlage sind nur die gelernten Rezepte (state.data.crafts, buildCrafts in fetch.mjs).
// 1. Ausrüstung: Ein Item zählt, wenn der Charakter es tragen kann und seine Werte für Klasse und Rolle besser sind als im Slot.
//    Liegt das Mindestlevel bis zu 3 Level über dem Charakter, steht es als „bald“ in der Liste.
//    Items, die beim Aufheben binden (bind „ON_ACQUIRE“), zählen nur für den Hersteller selbst.
// 2. Verbesserungen: Rüstungssets und Zielfernrohre für angelegte Items ohne Verzauberung.
//    Verzauberungen (enhance.kind „enchant“, etwa Ausdauer auf Brust) zeigt die Liste vorerst nicht.

// Inventartyp des Items → Slots der Ausrüstung.
const CRAFT_SLOTS = {
  HEAD: ['HEAD'], NECK: ['NECK'], SHOULDER: ['SHOULDER'], CLOAK: ['BACK'], CHEST: ['CHEST'], ROBE: ['CHEST'], WRIST: ['WRIST'], HAND: ['HANDS'],
  WAIST: ['WAIST'], LEGS: ['LEGS'], FEET: ['FEET'], FINGER: ['FINGER_1', 'FINGER_2'], TRINKET: ['TRINKET_1', 'TRINKET_2'],
  WEAPON: ['MAIN_HAND'], WEAPONMAINHAND: ['MAIN_HAND'], TWOHWEAPON: ['MAIN_HAND'], WEAPONOFFHAND: ['OFF_HAND'], SHIELD: ['OFF_HAND'], HOLDABLE: ['OFF_HAND'],
  RANGED: ['RANGED'], RANGEDRIGHT: ['RANGED'], THROWN: ['RANGED'],
};
// Waffenfertigkeiten je Klasse wie in Classic (Unterklassen der Waffen: 0 Axt, 1 Zweihandaxt, 2 Bogen, 3 Gewehr, 4 Streitkolben,
// 5 Zweihandstreitkolben, 6 Stangenwaffe, 7 Schwert, 8 Zweihandschwert, 10 Stab, 13 Faustwaffe, 15 Dolch, 16 Wurfwaffe, 18 Armbrust, 19 Zauberstab).
const WEAPON_SKILLS = {
  1: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18], 2: [0, 1, 4, 5, 6, 7, 8], 3: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18],
  4: [2, 3, 4, 7, 13, 15, 16, 18], 5: [4, 10, 15, 19], 7: [0, 1, 4, 5, 10, 13, 15], 8: [7, 10, 15, 19], 9: [7, 10, 15, 19], 11: [4, 5, 10, 13, 15],
};
// Gewichte der Werte je Spielweise: Wie viel ist 1 Punkt wert, gemessen an 1 Punkt des Hauptwerts. Grobe Erfahrungswerte fürs Leveln,
// angelehnt an die Classic-Umrechnung (Krieger: 1 Stärke = 2 AP, Jäger und Schurke: 1 Beweglichkeit = 2 AP plus Krit).
// Rüstung zählt wenig. Waffenschaden pro Sekunde: dps für Nahkampfwaffen, rdps für den Fernkampf-Slot (Bogen, Gewehr, Zauberstab).
// Krieger, Paladine und Schurken ziehen mit der Fernkampfwaffe nur, Jäger machen damit ihren Schaden, Stoffträger nutzen den Zauberstab.
// Unbekannte Werte und Effekte (Krit, Trefferchance, „Bei Treffer“) zählen nicht.
const STAT_WEIGHTS = {
  str: { STRENGTH: 1, AGILITY: 0.5, STAMINA: 0.5, ATTACK_POWER: 0.5, INTELLECT: 0.05, SPIRIT: 0.05, armor: 0.01, dps: 3, rdps: 0.2 },
  tank: { STRENGTH: 0.7, AGILITY: 0.6, STAMINA: 1, ATTACK_POWER: 0.3, INTELLECT: 0.05, SPIRIT: 0.05, EXTRA_ARMOR: 0.05, armor: 0.04, dps: 2, rdps: 0.2 },
  agi: { AGILITY: 1, STRENGTH: 0.5, STAMINA: 0.5, ATTACK_POWER: 0.5, INTELLECT: 0.1, SPIRIT: 0.05, armor: 0.01, dps: 3, rdps: 0.3 },
  hunter: { AGILITY: 1, INTELLECT: 0.4, STAMINA: 0.5, ATTACK_POWER: 0.45, STRENGTH: 0.1, SPIRIT: 0.1, armor: 0.01, dps: 0.7, rdps: 3 },
  caster: { INTELLECT: 1, SPIRIT: 0.6, STAMINA: 0.5, SPELL_POWER: 1.2, SPELL_DAMAGE_DONE: 1.2, SPELL_HEALING_DONE: 0.3, armor: 0.005, dps: 0.2, rdps: 1 },
  healer: { INTELLECT: 1, SPIRIT: 0.8, STAMINA: 0.4, SPELL_HEALING_DONE: 1, SPELL_POWER: 1, SPELL_DAMAGE_DONE: 0.3, armor: 0.005, dps: 0.2, rdps: 0.5 },
};
// Fernkampf-Slot: angelegt (slot) oder herstellbar (inv).
const isRanged = (it) => it?.slot === 'RANGED' || ['RANGED', 'RANGEDRIGHT', 'THROWN'].includes(it?.inv);
// Gewichte für ein Item: dps je nach Slot aus dps oder rdps.
function weightsFor(c, it) {
  const w = STAT_WEIGHTS[playstyle(c)];
  return isRanged(it) ? { ...w, dps: w.rdps } : w;
}
const SLOT_LABELS = Object.fromEntries([...SLOTS_LEFT, ...SLOTS_RIGHT]);
// Diese Werte zeigt die Seite als Unterschied. Rüstung nur, wenn sie für die Spielweise zählt.
const STAT_SHORT = { STRENGTH: 'Stä', AGILITY: 'Bew', STAMINA: 'Aus', INTELLECT: 'Int', SPIRIT: 'Wil', ATTACK_POWER: 'AP', SPELL_POWER: 'ZM', SPELL_DAMAGE_DONE: 'ZS', SPELL_HEALING_DONE: 'Heil', armor: 'Rüst', dps: 'DPS' };

function playstyle(c) {
  if (c.role === 'HEALER') return 'healer';
  if (c.role === 'TANK') return 'tank';
  const spec = (c.spec ?? '').toLowerCase();
  if (c.classId === 3) return 'hunter';
  if (c.classId === 4) return 'agi';
  if (c.classId === 11) return /wild/.test(spec) ? 'agi' : 'caster';
  if (c.classId === 7) return /verstärk/.test(spec) ? 'str' : 'caster';
  if ([5, 8, 9].includes(c.classId)) return 'caster';
  return 'str';
}

// Wert eines Items für den Charakter. Ohne Werte (alter Datenstand) zählt das Itemlevel.
function itemScore(c, it) {
  if (!it) return 0;
  if (!it.stats) return it.ilvl ?? 0;
  const w = weightsFor(c, it);
  let score = (it.armor ?? 0) * (w.armor ?? 0) + (it.dps ?? 0) * (w.dps ?? 0);
  for (const [k, v] of Object.entries(it.stats)) score += v * (w[k] ?? 0);
  return score;
}

// Unterschied neu minus alt je Wert, nur Werte, die für die Spielweise zählen. Größter Gewinn zuerst.
function statDiff(c, neu, alt) {
  const w = weightsFor(c, neu);
  const keys = new Set([...Object.keys(neu.stats ?? {}), ...Object.keys(alt?.stats ?? {}), 'armor', 'dps']);
  const out = [];
  for (const k of keys) {
    const a = k === 'armor' || k === 'dps' ? (neu[k] ?? 0) : (neu.stats?.[k] ?? 0);
    const b = k === 'armor' || k === 'dps' ? (alt?.[k] ?? 0) : (alt?.stats?.[k] ?? 0);
    const d = Math.round((a - b) * 10) / 10;
    if (!d || !(w[k] >= 0.1 || (k === 'armor' && w.armor >= 0.04))) continue;
    out.push([k, d, d * (w[k] ?? 0)]);
  }
  return out.sort((x, y) => y[2] - x[2]);
}
function statName(k) { return k === 'armor' ? 'Rüstung' : k === 'dps' ? 'Schaden pro Sekunde' : state.data.statNames?.[k] ?? k; }

// Rüstungsarten: Stoff alle, Leder alle außer Stoffträgern, Kette und Platte je nach Klasse, Kette für Jäger und Schamanen und Platte erst ab 40.
function canWear(c, it) {
  if (it.cls === 2) return (WEAPON_SKILLS[c.classId] ?? []).includes(it.sub);
  const id = c.classId;
  switch (it.sub) {
    case 0: case 1: return true;
    case 2: return ![5, 8, 9].includes(id);
    case 3: return [1, 2].includes(id) || ([3, 7].includes(id) && c.level >= 40);
    case 4: return [1, 2].includes(id) && c.level >= 40;
    case 6: return [1, 2, 7].includes(id);
    default: return false;
  }
}

// Je Charakter: beste Ausrüstung je Slot (größter Gewinn zuerst) und mögliche Verbesserungen je Slot.
function craftUpgrades() {
  const crafts = state.data.crafts ?? [];
  const ok = state.chars.filter((c) => c.level);
  return ok.map((c) => {
    const items = new Map((c.items ?? []).map((i) => [i.slot, i]));
    // Kandidaten je Slot. Jetzt tragbar vor „bald“, dann größter Gewinn. Dasselbe Item von mehreren Herstellern zählt einmal.
    const bySlot = new Map();
    for (const cr of crafts.filter((x) => x.item)) {
      const it = cr.item;
      if (!canWear(c, it) || it.req > c.level + 3) continue;
      // Beim Aufheben gebunden: Nur der Hersteller selbst kann das Item tragen.
      if (it.bind === 'ON_ACQUIRE' && cr.by !== c.key) continue;
      if (it.inv === 'TWOHWEAPON' && items.has('OFF_HAND')) continue;
      // Ringe und Schmuck: der schwächere der beiden Slots. Schurken tragen zwei Waffen, dort zählt die schwächere Hand.
      let slots = CRAFT_SLOTS[it.inv] ?? [];
      if (it.inv === 'WEAPON' && c.classId === 4) slots = ['MAIN_HAND', 'OFF_HAND'];
      const slot = [...slots].sort((x, y) => itemScore(c, items.get(x)) - itemScore(c, items.get(y)))[0];
      if (!slot || (c.items ?? []).some((x) => x.id === it.id)) continue;
      const cur = items.get(slot);
      const gain = itemScore(c, it) - itemScore(c, cur);
      // Kleine Unterschiede (unter einem halben Punkt Hauptwert) lohnen das Herstellen nicht.
      if (gain < 0.5) continue;
      if (!bySlot.has(slot)) bySlot.set(slot, new Map());
      const same = bySlot.get(slot).get(it.id);
      if (same) { same.by.push(cr.by); continue; }
      bySlot.get(slot).set(it.id, { slot, craft: cr, by: [cr.by], gain, diff: statDiff(c, it, cur), soon: it.req > c.level, cur });
    }
    const best = [...bySlot.values()].map((m) => {
      const [top, ...rest] = [...m.values()].sort((x, y) => x.soon - y.soon || y.gain - x.gain);
      return { ...top, others: rest };
    });
    // Verbesserungen nur für angelegte Items ohne Verzauberung, je Slot mit allen Möglichkeiten. Ein Item mit Mindestlevel zählt erst ab diesem Level.
    const enhance = new Map();
    for (const cr of crafts.filter((x) => x.enhance && x.enhance.kind !== 'enchant')) {
      if ((cr.enhance.req ?? 0) > c.level) continue;
      for (const slot of cr.enhance.slots) {
        const cur = items.get(slot);
        if (!cur || cur.enchants?.length) continue;
        if (!enhance.has(slot)) enhance.set(slot, new Map());
        const key = cr.enhance.id ?? cr.enhance.name;
        const m = enhance.get(slot);
        if (m.has(key)) m.get(key).by.push(cr.by); else m.set(key, { ...cr.enhance, by: [cr.by] });
      }
    }
    // Slots mit denselben Möglichkeiten (Rüstungsset für Brust, Beine, Hände, Füße) stehen in einer Zeile. Die beste Möglichkeit zuerst.
    const rows = new Map();
    for (const [slot, m] of enhance) {
      const opts = [...m.values()].sort((a, b) => (b.req ?? 0) - (a.req ?? 0) || (b.ilvl ?? 0) - (a.ilvl ?? 0));
      const key = opts.map((o) => o.id ?? o.name).join('|');
      if (rows.has(key)) rows.get(key)[0].push(slot); else rows.set(key, [[slot], opts]);
    }
    return { c, items: best.sort((a, b) => a.soon - b.soon || b.gain - a.gain), enhance: [...rows.values()] };
  });
}

// Crafting als eine Liste gleich großer Zeilen. Jede Zeile beginnt mit dem Hersteller, dann der Empfänger: „Bernhard → Lokk“.
// Sortiert nach Gewinn (größtes Upgrade zuerst), „bald“ und Verbesserungen am Ende.
// Verbesserungen, die mehrere bekommen können (Rüstungsset), stehen einmal mit allen Empfängern.
function craftRows() {
  const order = new Map(state.chars.map((c, i) => [c.key, i]));
  const rows = [];
  const enh = new Map();
  for (const { c, items, enhance } of craftUpgrades()) {
    for (const x of items) rows.push({ kind: 'item', ...x, by: [...new Set(x.by)], to: [c.key] });
    for (const [slots, opts] of enhance) {
      const key = opts.map((o) => o.id ?? o.name).join('|');
      if (!enh.has(key)) enh.set(key, { kind: 'enhance', by: [...new Set(opts.flatMap((o) => o.by))], to: [], slotsOf: {}, opts, gain: 0, soon: false });
      const r = enh.get(key);
      r.to.push(c.key);
      r.slotsOf[c.key] = slots;
    }
  }
  rows.push(...enh.values());
  // Wer selbst herstellen kann, steht als Hersteller vorne. So gruppiert die Liste nach dem, der die Arbeit macht.
  const lead = (r) => (r.kind === 'item' && r.by.includes(r.to[0]) ? r.to[0] : [...r.by].sort((x, y) => order.get(x) - order.get(y))[0]);
  return rows.map((r) => ({ ...r, lead: lead(r) }))
    .sort((a, b) => a.soon - b.soon || (a.kind === 'enhance') - (b.kind === 'enhance') || b.gain - a.gain || order.get(a.lead) - order.get(b.lead));
}

// Filter: ein Spieler, dann „bekommt“ (Empfänger) oder „stellt her“ (Hersteller). Ohne Filter nur die größten Upgrades, der Rest auf Klick.
// Die Seite merkt sich die Auswahl nicht (wie beim Loadout).
const CRAFT_TOP = 8;
function renderCrafts() {
  const all = craftRows();
  const f = state.craft;
  const el = document.getElementById('crafts');
  if (!all.length) {
    document.getElementById('craft-count').textContent = 'nichts offen';
    el.innerHTML = `<p class="craft-none">${(state.data.crafts ?? []).length ? 'Im Moment kann niemand im Squad einen Slot verbessern.' : 'Noch kann niemand im Squad tragbare Ausrüstung herstellen.'}</p>`;
    return;
  }
  const side = (r) => (f.dir === 'by' ? r.by : r.to);
  let rows = f.who ? all.filter((r) => side(r).includes(f.who)) : all;
  // Im Blick „stellt her“ steht der gewählte Spieler als Hersteller vorne. Im Blick „bekommt“ nennt ein Rüstungsset nur ihn als Empfänger.
  if (f.who && f.dir === 'by') rows = rows.map((r) => ({ ...r, lead: f.who }));
  if (f.who && f.dir === 'to') rows = rows.map((r) => (r.kind === 'enhance' ? { ...r, to: [f.who] } : r));
  const now = rows.filter((r) => !r.soon).length;
  document.getElementById('craft-count').textContent = now ? plural(now, 'Upgrade', 'Upgrades') : 'nichts offen';
  const hidden = !f.who && !f.all ? Math.max(0, rows.length - CRAFT_TOP) : 0;
  const shown = hidden ? rows.slice(0, CRAFT_TOP) : rows;

  const squadChars = state.chars.filter((c) => c.level);
  const nTo = (key) => all.filter((r) => !r.soon && r.to.includes(key)).length;
  const filter = `<div class="craft-filter">
    <div class="craft-players" role="group" aria-label="Spieler">
      <button type="button" class="chip-btn" data-who="" aria-pressed="${!f.who}">Alle</button>
      ${squadChars.map((c) => `<button type="button" class="chip-btn craft-pl" data-who="${esc(c.key)}" style="--cls:${classColor(c)}" aria-pressed="${f.who === c.key}">${esc(c.name)}<small>${nTo(c.key)}</small></button>`).join('')}
    </div>
    ${f.who ? `<div class="craft-dir" role="group" aria-label="Richtung">
      <button type="button" class="chip-btn" data-dir="to" aria-pressed="${f.dir === 'to'}">bekommt</button>
      <button type="button" class="chip-btn" data-dir="by" aria-pressed="${f.dir === 'by'}">stellt her</button>
    </div>` : ''}
  </div>`;

  const tag = (key) => { const c = charByKey(key); return `<span class="tag" style="--cls:${classColor(c)}">${esc(c.name ?? key)}</span>`; };
  // Die Icons verlinken auf Wowhead, der Wowhead-Tooltip ist hier aus. Den Vergleich zeigt der eigene Tooltip der Zeile.
  const icon = (it) => link(it, `<img class="ico sm b-${(it.quality || 'COMMON').toLowerCase()}" src="${esc(it.icon || FALLBACK_ICON)}" alt="" loading="lazy">`)
    .replace('<a ', '<a data-disable-wowhead-tooltip="true" ');
  // Rang links wie die Uhrzeit in der Aktivität: 1 ist das größte Upgrade. Verbesserungen (Rüstungsset) haben keinen Rang.
  const val = (r, i) => `<span class="craft-val">${r.kind === 'item' ? `${i + 1}.` : ''}</span>`;
  const fmt = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE')}`;
  // Hersteller links, Empfänger rechts vom Pfeil: „Bernhard → Lokk“, „Lokk → selbst“, „Bernhard → alle“ (alle im Squad).
  const squad = state.chars.filter((c) => c.level).length;
  const who = (r) => {
    const self = r.kind === 'item' && r.by.includes(r.to[0]);
    const to = self ? '<span class="tag craft-self">selbst</span>'
      : r.to.length === squad && squad > 2 ? '<span class="tag craft-all">alle</span>' : r.to.map(tag).join('');
    return `<span class="craft-who">${tag(r.lead)}<span class="craft-arrow">→</span>${to}</span>`;
  };
  const itemRow = (r, i) => {
    const it = r.craft.item;
    const q = (it.quality || 'COMMON').toLowerCase();
    const key = `html:craft-${i}`;
    tipHtml.set(key, `${tipItem(r.cur, 'Jetzt', r.cur ? SLOT_LABELS[r.slot] ?? r.slot : '')}<span class="tc-arrow">→</span>${tipItem(it, 'Neu', it.subName)}`);
    const chips = r.diff.slice(0, 2).map(([k, d]) => `<span class="${d > 0 ? 'up' : 'down'}">${fmt(d)} ${STAT_SHORT[k] ?? statName(k)}</span>`).join('');
    const old = r.cur ? `<span class="craft-old">${icon(r.cur)}</span>` : '<span class="craft-old empty" aria-label="leer"></span>';
    return `<div class="craft${r.soon ? ' soon' : ''}" tabindex="0" data-tip="${key}">
      ${val(r, i)}${who(r)}
      <span class="craft-item">${old}<span class="craft-arrow">→</span>${icon(it)}<span class="craft-txt"><span class="q-${q}">${esc(it.name)}</span>
        <small>${esc(SLOT_LABELS[r.slot] ?? r.slot)}${r.soon ? ` · ab Level ${it.req}` : ''}</small></span><span class="craft-diff">${chips}</span></span></div>`;
  };
  const enhanceRow = (r) => {
    const best = r.opts[0];
    const slots = [...new Set(Object.values(r.slotsOf).flat())].map((x) => SLOT_LABELS[x] ?? x);
    const tip = [best.name, ...r.to.map((k) => `${charByKey(k).name}: ${r.slotsOf[k].map((x) => SLOT_LABELS[x] ?? x).join(', ')}`),
      ...r.opts.slice(0, 6).map((o) => `${o.name}${o.desc ? `: ${o.desc.replace(/^Benutzen: /, '').replace(/ \(.*?Abklingzeit\)/, '')}` : ''}`)].join('\n');
    const ico = best.icon ? icon(best) : `<span class="ench-ico">${feedIcon(FEED_ICONS.prof.Verzauberkunst)}</span>`;
    return `<div class="craft ench" tabindex="0" data-tip="${esc(tip)}">
      ${val(r, 0)}${who(r)}
      <span class="craft-item"><span class="craft-old"></span><span></span>${ico}<span class="craft-txt"><span>${esc(best.name)}</span>
        <small>${esc(slots.join(', '))}${r.opts.length > 1 ? ` · ${plural(r.opts.length - 1, 'weitere Möglichkeit', 'weitere Möglichkeiten')}` : ''}</small></span></span></div>`;
  };
  const who0 = f.who ? charByKey(f.who).name : '';
  const empty = `<p class="craft-none">${f.dir === 'by' ? `${esc(who0)} kann im Moment niemandem etwas Besseres herstellen.` : `Für ${esc(who0)} kann im Moment niemand etwas Besseres herstellen.`}</p>`;
  el.innerHTML = filter + (shown.length ? `<div class="craft-list">${shown.map((r, i) => (r.kind === 'item' ? itemRow(r, i) : enhanceRow(r))).join('')}</div>` : empty)
    + (hidden || (f.all && !f.who && rows.length > CRAFT_TOP)
      ? `<button type="button" class="chip-btn craft-more">${f.all ? 'Nur die größten Upgrades zeigen' : `Alle zeigen · noch ${hidden}`}</button>` : '');
  el.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.who || null;
    state.craft.who = key && key !== f.who ? key : null;
    renderCrafts();
  }));
  el.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { state.craft.dir = b.dataset.dir; renderCrafts(); }));
  el.querySelector('.craft-more')?.addEventListener('click', () => { state.craft.all = !state.craft.all; renderCrafts(); });
  el.querySelectorAll('img').forEach(imgFallback);
  window.$WowheadPower?.refreshLinks?.();
}

// Ein Item im Vergleichs-Tooltip: Name in Qualitätsfarbe, Art und Itemlevel, Rüstung, Schaden, Werte und Verzauberung.
function tipItem(it, label, kind) {
  if (!it) return `<div class="tc-item"><small>${label}</small><b class="tc-empty">leer</b></div>`;
  const n = (v, d = 0) => v.toLocaleString('de-DE', { maximumFractionDigits: d });
  const lines = [
    it.armor ? `${n(it.armor)} Rüstung` : '',
    it.dps ? `${n(it.dps, 1)} Schaden pro Sekunde` : '',
    ...Object.entries(it.stats ?? {}).map(([k, v]) => `${v > 0 ? '+' : '−'}${n(Math.abs(v))} ${statName(k)}`),
  ].filter(Boolean);
  return `<div class="tc-item"><small>${label}</small><b class="q-${(it.quality || 'COMMON').toLowerCase()}">${esc(it.name)}</b>
    <span class="tc-meta">${esc([kind, it.ilvl ? `iLvl ${it.ilvl}` : ''].filter(Boolean).join(' · '))}</span>
    ${it.bind === 'ON_ACQUIRE' ? '<span>Beim Aufheben gebunden</span>' : ''}${lines.map((l) => `<span>${esc(l)}</span>`).join('')}${(it.enchants ?? []).map((e) => `<span class="tc-ench">${esc(e)}</span>`).join('')}</div>`;
}

// Hinweis auf der Karte im Loadout: Diesen Slot kann jemand im Squad besser herstellen. Nennt den größten Gewinn.
function craftHints(c) {
  const mine = craftUpgrades().find((x) => x.c.key === c.key);
  const fmt = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('de-DE')}`;
  return new Map((mine?.items ?? []).filter((x) => !x.soon).map((x) => {
    const who = x.by.includes(c.key) ? 'Selbst herstellen' : `${charByKey(x.by[0]).name} stellt her`;
    const d = x.diff[0];
    return [x.slot, `${who}${d ? `: ${fmt(d[1])} ${statName(d[0])}` : ''}`];
  }));
}

// ---------------------------------------------------------------------------
// Quests: nur „Verpasst“. Was andere im Log abgestimmt haben, klärt der Squad live.
// Je Charakter eine Karte mit den Quests, die mindestens 2 andere abgeschlossen haben, seit er zuletzt online war (Quest-Verlauf aus fetch.mjs).
// Klassenquests (k) und Quests ohne Zone (Berufsquests) betreffen nur einen Charakter und zählen nicht. Gleiche Titel in einer Zone stehen einmal.
// Die API kennt kein Quest-Level. Als Quest-Level gilt das niedrigste Level der anderen beim Abschluss (lv).
// Liegt es 5 oder mehr Level unter dem eigenen Level, ist die Quest grau und zählt nicht.
// Eine Quest lässt sich je Charakter ignorieren (×). Das merkt sich nur dieser Browser (localStorage), die Seite hat keinen Server.

const QUEST_IGNORE_KEY = 'questIgnore';
function questIgnored() {
  try { return new Set(JSON.parse(localStorage.getItem(QUEST_IGNORE_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveQuestIgnored(set) {
  try { localStorage.setItem(QUEST_IGNORE_KEY, JSON.stringify([...set])); } catch {}
}

function questMissed() {
  const info = state.data.questInfo ?? {};
  const chars = state.chars.filter((c) => c.level && c.quests);
  const ignored = questIgnored();
  let hidden = 0;
  const list = chars.map((c) => {
    const since = c.lastLogin ?? 0;
    const done = new Set(c.quests.done);
    const map = new Map();
    for (const e of state.questLog) {
      if (e.t <= since || e.key === c.key || !info[e.id]?.z || info[e.id].k || done.has(e.id)) continue;
      // Schlüssel aus Charakter, Zone und Titel. So gilt „ignorieren“ auch für Varianten derselben Quest.
      const k = `${c.key}|${info[e.id].z}|${info[e.id].t}`;
      if (!map.has(k)) map.set(k, { id: e.id, key: k, by: new Set(), lv: Infinity });
      const x = map.get(k);
      x.by.add(e.key);
      x.lv = Math.min(x.lv, e.lv ?? charByKey(e.key)?.level ?? Infinity);
    }
    const all = [...map.values()].filter((x) => x.by.size >= 2 && !(x.lv <= c.level - 5));
    hidden += all.filter((x) => ignored.has(x.key)).length;
    return { c, since, list: all.filter((x) => !ignored.has(x.key)).map((x) => ({ ...x, by: [...x.by] })) };
  }).filter((x) => x.list.length).sort((a, b) => b.list.length - a.list.length);
  return { list, hidden };
}

function renderQuests() {
  const el = document.getElementById('quests');
  const info = state.data.questInfo ?? {};
  const has = state.chars.some((c) => c.level && c.quests);
  document.getElementById('quests-panel').hidden = !has;
  document.getElementById('nav-quests').hidden = !has;
  if (!has) return;
  const { list: missed, hidden } = questMissed();
  document.getElementById('quests-note').textContent = missed.length ? `${plural(missed.length, 'Charakter', 'Charaktere')} mit verpassten Quests` : '';
  const restore = hidden ? `<button type="button" class="q-restore">${plural(hidden, 'ignorierte Quest', 'ignorierte Quests')} wieder zeigen</button>` : '';
  const bind = () => {
    el.querySelectorAll('.q-x').forEach((b) => b.addEventListener('click', () => {
      const set = questIgnored();
      set.add(b.dataset.ign);
      saveQuestIgnored(set);
      hideTip();
      renderQuests();
    }));
    el.querySelector('.q-restore')?.addEventListener('click', () => { saveQuestIgnored(new Set()); renderQuests(); });
  };
  if (!missed.length) { el.innerHTML = `<p class="q-empty">Niemand hat etwas verpasst.</p>${restore}`; bind(); return; }

  const tag = (key) => { const c = charByKey(key); return `<span class="tag" style="--cls:${classColor(c)}">${esc(c.name)}</span>`; };
  const row = (q) => `<div class="q-row"><a href="${wh(state.data.wowhead, `quest=${q.id}`)}" target="_blank" rel="noopener">${esc(info[q.id].t)}</a>
    <span class="tags">${q.by.map(tag).join('')}<button type="button" class="q-x" data-ign="${esc(q.key)}" aria-label="${esc(info[q.id].t)} ignorieren" title="Ignorieren">×</button></span></div>`;
  // Je Karte nach Zonen, Zonen mit den meisten Quests zuerst. Ab 8 Quests klappt der Rest auf.
  const card = ({ c, since, list }) => {
    const zones = new Map();
    for (const q of list) { const z = info[q.id].z; if (!zones.has(z)) zones.set(z, []); zones.get(z).push(q); }
    const groups = [...zones].sort((a, b) => b[1].length - a[1].length);
    let left = 8;
    const shown = [];
    const hidden = [];
    for (const [z, qs] of groups) {
      const n = Math.max(0, Math.min(qs.length, left));
      left -= n;
      if (n) shown.push([z, qs.slice(0, n)]);
      if (qs.length > n) hidden.push([z, qs.slice(n)]);
    }
    // Die Zahl hinter der Zone zeigt die Sortierung: Zonen mit den meisten Quests zuerst.
    const count = new Map(groups.map(([z, qs]) => [z, qs.length]));
    const block = ([z, qs]) => `<div class="q-zone"><span class="q-zname">${esc(z)}<i>${count.get(z)}</i></span>${qs.map(row).join('')}</div>`;
    const rest = hidden.reduce((n, [, qs]) => n + qs.length, 0);
    // data-w: geschätzte Höhe in Zeilen (Kopf, Zonen, Quests). Danach verteilt fitQuestColumns die Karten.
    const weight = 2 + shown.length + shown.reduce((n, [, qs]) => n + qs.length, 0) + (rest ? 1 : 0);
    // Höchstens eine Spalte je 4 Quests in der Karte. So steht eine Zonen-Überschrift nie allein in einer Spalte.
    const bodyCols = Math.min(3, Math.ceil(Math.min(list.length, 8) / 4));
    return `<article class="q-card" data-w="${weight}" data-n="${list.length}" style="--cls:${classColor(c)};--qb:${bodyCols}">
      <header><b>${esc(c.name)}</b><span>${plural(list.length, 'Quest', 'Quests')} verpasst</span><small>offline ${ago(since)}</small></header>
      <div class="q-body">${shown.map(block).join('')}</div>
      ${rest ? `<details class="q-more"><summary>${plural(rest, 'weitere Quest', 'weitere Quests')}</summary><div class="q-body">${hidden.map(block).join('')}</div></details>` : ''}
    </article>`;
  };
  el.innerHTML = `<div class="q-cards">${missed.map(card).join('')}</div>${restore}`;
  fitQuestColumns(el.querySelector('.q-cards'), missed.length);
  bind();
  window.$WowheadPower?.refreshLinks?.();
}

// Spalten der Quest-Karten: so viele, wie Karten da sind und nebeneinander passen (je mindestens 380 px).
// Mauerwerk: Jede Karte kommt in der Reihenfolge der Liste in die bisher kürzeste Spalte (Gewicht data-w).
// So bleibt unter kurzen Karten keine Lücke. Eine einzelne Karte nutzt die ganze Breite nur ab 5 Quests, ihre Zonen stehen dann in Spalten (.q-body).
// Mit bis zu 4 Quests ist sie so breit wie eine Karte unter mehreren, sonst stünden Titel und Tags weit auseinander.
let questResize = null;
function fitQuestColumns(box, count) {
  questResize?.disconnect();
  if (!box) return;
  const cards = [...box.querySelectorAll('.q-card')];
  const fit = () => {
    const byWidth = Math.max(1, Math.floor((box.clientWidth + 12) / (380 + 12)));
    const small = count === 1 && Number(cards[0]?.dataset.n) <= 4;
    const cols = small ? byWidth : Math.min(count, byWidth);
    if (Number(box.dataset.cols) === cols) return;
    box.dataset.cols = cols;
    box.style.setProperty('--qcols', cols);
    const columns = Array.from({ length: cols }, () => Object.assign(document.createElement('div'), { className: 'q-col' }));
    const heights = new Array(cols).fill(0);
    for (const card of cards) {
      const i = heights.indexOf(Math.min(...heights));
      columns[i].append(card);
      heights[i] += Number(card.dataset.w) || 1;
    }
    box.replaceChildren(...columns);
  };
  fit();
  questResize = new ResizeObserver(fit);
  questResize.observe(box);
}

// Hover-Tooltip für alles mit data-tip: Maus zeigt beim Überfahren, Touch und Tastatur per Tippen bzw. Fokus.
let tipEl = null;
// Ein Tooltip mit eigenem HTML (Vergleich im Crafting) liegt in tipHtml, data-tip nennt dann den Schlüssel als „html:…“.
const tipHtml = new Map();
function showTip(anchor) {
  hideTip();
  tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.setAttribute('role', 'tooltip');
  const html = tipHtml.get(anchor.dataset.tip);
  if (html) {
    tipEl.classList.add('tip-cmp');
    tipEl.innerHTML = html;
  } else {
    const [head, ...rest] = anchor.dataset.tip.split('\n');
    // Bei mehreren Zeilen ist die letzte der Hinweis (Zauber, nächster Schritt) und steht farbig.
    tipEl.innerHTML = `<b>${esc(head)}</b>${rest.map((l, i) => `<span${rest.length > 1 && i === rest.length - 1 && !anchor.hasAttribute('data-tip-plain') ? ' class="tip-foot"' : ''}>${esc(l)}</span>`).join('')}`;
  }
  document.body.append(tipEl);
  const r = anchor.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  tipEl.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + scrollX}px`;
  const above = r.top - tipEl.offsetHeight - 8;
  tipEl.style.top = `${(above > 60 ? above : r.bottom + 8) + scrollY}px`;
  tipEl.anchor = anchor;
}
function hideTip() { tipEl?.remove(); tipEl = null; }
document.addEventListener('pointerover', (e) => { const a = e.target.closest?.('[data-tip]'); if (a && e.pointerType === 'mouse' && tipEl?.anchor !== a) showTip(a); });
document.addEventListener('pointerout', (e) => { const a = e.target.closest?.('[data-tip]'); if (a && e.pointerType === 'mouse' && !a.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('focusin', (e) => { if (e.target.dataset?.tip && e.target.matches(':focus-visible')) showTip(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.dataset?.tip) hideTip(); });
// Auf Touch zeigt ein Tippen den Tooltip, ein Tippen daneben schließt ihn.
// Die Zeigerart kommt vom pointerdown, weil Safari sie am click nicht verlässlich mitgibt.
let lastPointer = '';
document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-tip]');
  if (!a) return hideTip();
  e.stopPropagation();
  if (lastPointer === 'mouse') return;
  if (tipEl?.anchor === a) hideTip(); else showTip(a);
}, true);
addEventListener('scroll', hideTip, { passive: true });

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

// ---------------------------------------------------------------------------
// Loadout des gewählten Charakters

// Loadout als Gear-Board: keine Figur (die zeigt die Kachel), oben Kennzahlen, darunter alle Slots als Karten.
// Ohne eigenes 3D-Modell spart das Loadout Speicher, und der Charakterwechsel baut nichts neu auf.
const ENCHANT_SLOTS = ['HEAD', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'LEGS', 'FEET', 'MAIN_HAND', 'OFF_HAND'];

function renderLoadout() {
  const el = document.getElementById('loadout');
  const c = state.chars.find((x) => x.key === state.selected);
  // Eingeklappt: nur die Überschrift. So hat der Link „Loadout“ in der Navigation ein Ziel.
  el.classList.toggle('closed', !c);
  if (!c) {
    el.style.removeProperty('--cls');
    el.innerHTML = `<div class="lo-closed"><span class="eyebrow">// LOADOUT</span></div>`;
    return;
  }

  const items = new Map((c.items || []).map((i) => [i.slot, i]));
  const sets = countSets(c.items || []);
  const role = M.ROLES[c.role] ?? M.ROLES.DAMAGE;
  el.style.setProperty('--cls', classColor(c));
  const slots = boardSlots(items);
  const maxIlvl = Math.max(1, ...(c.items ?? []).map((i) => i.ilvl ?? 0));
  const hints = craftHints(c);

  el.innerHTML = `
    <div class="lo-head">
      <div>
        <span class="eyebrow">// LOADOUT</span>
        <h2>${esc(c.name)}${c.surname ? ` <span class="surname">${esc(c.surname)}</span>` : ''}</h2>
        <p>${c.title ? `${esc(c.title)} · ` : ''}${esc(c.race || '')} · ${esc(c.spec || '')} ${esc(c.className || '')}${c.guild ? ` · &lt;${esc(c.guild)}&gt;` : ''}${c.realmName ? ` · ${esc(c.realmName)}` : ''}</p>
      </div>
      <div class="chips">
        <span class="chip role-chip">${role.label}</span>
        <span class="chip lv">Level ${c.level}</span>
        ${c.lastLogin ? `<span class="chip">Aktiv ${ago(c.lastLogin)}</span>` : ''}
      </div>
    </div>
    ${xpBarHtml(c)}
    ${boardKpis(c, items, sets)}
    ${loInfoHtml(c)}
    <div class="board">${slots.map(([s, l]) => cardHtml(items.get(s), l, maxIlvl, hints.get(s))).join('')}</div>
    <div class="talent-content" data-key="${esc(c.key)}">${talentsHtml(c)}</div>`;

  el.querySelectorAll('img').forEach(imgFallback);
  focusMainTree(el);
  window.$WowheadPower?.refreshLinks?.();
}

// Levelfortschritt unter dem Kopf (Squad-Loadout und Gilden-Detail): XP im Level gegen die XP bis zum nächsten Level.
// Ohne XP aus dem Profil oder auf dem Höchstlevel entfällt der Balken.
function xpBarHtml(c) {
  const need = M.XP_TO_NEXT?.[c.level];
  if (c.xp == null || !need || c.level >= (state.data.maxLevel ?? 60)) return '';
  const pct = Math.min(100, Math.max(0, (c.xp / need) * 100));
  const n = (v) => Math.round(v).toLocaleString('de-DE');
  return `<div class="xp-bar" title="noch ${n(Math.max(0, need - c.xp))} XP bis Level ${c.level + 1}">
    <span class="xp-lv">Level ${c.level}</span>
    <i class="bar"><i style="width:${pct.toFixed(1)}%"></i></i>
    <span class="xp-lv next">${c.level + 1}</span>
    <span class="xp-num">${n(c.xp)} / ${n(need)} XP · ${Math.floor(pct)} %</span>
  </div>`;
}

// Werte und Berufe zwischen Kennzahlen und Ausrüstung, wie im Gilden-Detail unter dem Porträt.
function loInfoHtml(c) {
  const stats = statRows(c.stats);
  const profs = profRows(c);
  const pets = petRows(c);
  if (!stats && !profs && !pets) return '';
  return `<div class="lo-info">
    ${stats ? `<div class="gd-sec"><span class="gd-label">Werte</span><dl class="gd-stats lo-stats">${stats}</dl></div>` : ''}
    ${profs || pets ? `<div class="lo-side">
      ${profs ? `<div class="gd-sec"><span class="gd-label">Berufe</span><div class="gd-profs">${profs}</div></div>` : ''}
      ${pets ? petSec(pets) : ''}
    </div>` : ''}
  </div>`;
}

// Nur die Talentbäume ersetzen, wenn ihre Zusatzdatei nach dem Loadout eintrifft.
function refreshTalents() {
  const el = document.querySelector('.talent-content');
  if (!el) return;
  const c = state.chars.find((x) => x.key === el.dataset.key);
  if (!c) return;
  el.innerHTML = talentsHtml(c);
  el.querySelectorAll('img').forEach(imgFallback);
  focusMainTree(el);
  window.$WowheadPower?.refreshLinks?.();
}

// Bis 760 px stehen die Bäume nebeneinander zum Wischen. Sichtbar ist zuerst der Baum mit den meisten Punkten.
function focusMainTree(root) {
  requestAnimationFrame(() => root.querySelectorAll('.ttrees').forEach((row) => {
    if (row.scrollWidth <= row.clientWidth) return;
    const trees = [...row.children];
    const pts = trees.map((t) => Number(t.querySelector('.ttree-head b')?.textContent) || 0);
    const main = trees[pts.indexOf(Math.max(...pts))];
    row.scrollLeft = main ? main.offsetLeft - row.offsetLeft : 0;
  }));
}

// Werte aus der Charakter-API (Squad-Loadout und Gilden-Detail). Angriffskraft und Zaubermacht nur, wenn sie zählen. Leere Werte fallen weg.
function statRows(s) {
  if (!s) return '';
  const n = (v) => (v == null ? null : Math.round(v).toLocaleString('de-DE'));
  const pct = (v) => (v ? `${fmtDec(v)} %` : null);
  const rows = [
    ['Gesundheit', n(s.health)],
    [s.powerType ?? 'Mana', n(s.power)],
    ['Stärke', n(s.strength)],
    ['Beweglichkeit', n(s.agility)],
    ['Ausdauer', n(s.stamina)],
    ['Intelligenz', n(s.intellect)],
    ['Willenskraft', n(s.spirit)],
    ['Rüstung', n(s.armor)],
    s.spellPower > (s.attackPower ?? 0) ? ['Zaubermacht', n(s.spellPower)] : ['Angriffskraft', n(s.attackPower)],
    ['Kritisch', pct(s.crit)],
  ].filter(([, v]) => v != null);
  return rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

// Berufe mit Skill und Balken (Squad-Loadout und Gilden-Detail).
function profRows(c) {
  return (c.professions ?? []).map((p) => {
    const pct = p.max ? Math.round(((p.skill ?? 0) / p.max) * 100) : 0;
    return `<div class="gd-prof"><span>${esc(profName(p.name))}</span><b>${p.skill ?? '?'}<small> / ${p.max ?? '?'}</small></b><i class="bar"><i style="width:${pct}%"></i></i></div>`;
  }).join('');
}

// Begleiter der Jäger (Squad-Loadout und Gilden-Detail): Name, Level und Art mit Link zu Wowhead. Der aktive steht vorne, die übrigen sind blass.
function petRows(c) {
  return (c.pets ?? []).map((p) => {
    const kind = p.creatureId
      ? `<a href="${wh(state.data.wowhead || 'classic', `npc=${p.creatureId}`)}" target="_blank" rel="noopener">${esc(p.creature ?? 'Begleiter')}</a>`
      : esc(p.creature ?? '');
    return `<div class="gd-pet${p.active ? '' : ' off'}"><span>${esc(p.name ?? p.creature ?? 'Begleiter')}</span><b>${p.level ? `LV ${p.level}` : ''}</b><small>${kind}</small></div>`;
  }).join('');
}
function petSec(rows) { return `<div class="gd-sec"><span class="gd-label">Begleiter</span><div class="gd-profs">${rows}</div></div>`; }

// Slots auf dem Board. Distanz und Schildhand erscheinen nur mit Item: Zweihandwaffen und Jäger lassen die Schildhand frei.
function boardSlots(items) {
  return [...SLOTS_LEFT, ...SLOTS_RIGHT].filter(([s]) => !['RANGED', 'OFF_HAND'].includes(s) || items.has(s));
}

// Kennzahlen über den Karten: Itemlevel, Set-Teile, verzauberte Slots und der schwächste Slot (leer oder niedrigstes iLvl).
function boardKpis(c, items, sets) {
  const enchantable = ENCHANT_SLOTS.filter((s) => items.has(s));
  const enchanted = enchantable.filter((s) => items.get(s).enchants?.length).length;
  const all = [...SLOTS_LEFT, ...SLOTS_RIGHT].filter(([s]) => s !== 'RANGED');
  // Leere Schildhand zählt nicht: Zweihandwaffen und Jäger lassen sie frei.
  const empties = all.filter(([s]) => s !== 'OFF_HAND' && !items.has(s));
  const empty = empties[0];
  const weakest = [...items.values()].filter((i) => i.ilvl != null && i.slot !== 'RANGED').sort((a, b) => a.ilvl - b.ilvl)[0];
  // Haben alle Items dasselbe iLvl, gibt es keinen schwächsten Slot.
  const even = weakest && [...items.values()].every((i) => i.slot === 'RANGED' || i.ilvl === weakest.ilvl);
  const weakLabel = empties.length > 1 ? `${empties.length} Slots` : empty ? empty[1] : even ? 'keiner' : weakest ? all.find(([s]) => s === weakest.slot)?.[1] ?? weakest.slot : '?';
  const kpis = [
    [c.equippedIlvl ?? '?', 'Itemlevel'],
    [sets ? `${sets.count} Teile` : 'keins', 'Set'],
    [`${enchanted} / ${enchantable.length}`, 'Verzaubert'],
    [weakLabel, empties.length > 1 ? 'Leere Slots' : empty ? 'Leerer Slot' : even ? 'Schwächster Slot' : `Schwächster · iLvl ${weakest?.ilvl ?? '?'}`],
  ];
  const tip = empties.length > 1 ? ` title="${esc(empties.map(([, l]) => l).join(', '))}"` : '';
  return `<div class="board-kpis">${kpis.map(([v, l], i) => `<div class="bk${i === 3 && (empty || !even) ? ' weak' : ''}"${i === 3 ? tip : ''}><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
}

// Karte je Slot: Rand in Qualitätsfarbe, Balken zeigt das iLvl im Verhältnis zum besten Item des Charakters.
function cardHtml(it, label, maxIlvl, hint = null) {
  const craft = hint ? `<span class="craft-hint">${esc(hint)}</span>` : '';
  if (!it) return `<div class="card empty"><span class="ico"></span><span class="txt"><span class="nm">${label}</span><span class="meta">leer</span>${craft}</span></div>`;
  const q = (it.quality || 'COMMON').toLowerCase();
  const meta = [label, it.ilvl ? `iLvl ${it.ilvl}` : null].filter(Boolean).join(' · ');
  const ench = it.enchants?.length ? `<span class="en">${esc(it.enchants[0].replace(/^Verzaubert: /, ''))}</span>` : '';
  const pct = it.ilvl ? Math.round((it.ilvl / maxIlvl) * 100) : 0;
  return link(it, `<div class="card c-${q}"><img class="ico b-${q}" src="${esc(it.icon || FALLBACK_ICON)}" alt="" loading="lazy">
    <span class="txt"><span class="nm q-${q}">${esc(it.name)}</span><span class="meta">${meta}</span>${ench}${craft}<i class="bar"><i style="width:${pct}%"></i></i></span></div>`);
}

// Talente: Classic zeigt die drei Bäume im Raster des Spiels (4 Spalten, 7 Reihen), Retail die Spezialisierung und Heldentalente.
// Die Position der Talente kommt aus talents.json, die API nennt nur die gewählten Talente.
function talentsHtml(c) {
  const t = c.talents;
  if (!t) return '';
  const layout = t.trees?.length ? state.talents[c.classId] : null;
  if (layout) return talentTreesHtml(c, t, layout);
  const max = Math.max(1, (state.data.maxLevel ?? 60) - 9);
  const cells = t.trees?.length
    ? t.trees.map((tr) => cell(tr.name ?? '?', tr.points, (tr.points / max) * 100))
    : [cell('Spezialisierung', esc(c.spec ?? '?')), t.hero ? cell('Heldentalente', esc(t.hero)) : '', cell('Talente gewählt', t.total ?? t.picks.length)].filter(Boolean);
  const split = t.trees?.length ? `<b class="split">${t.trees.map((tr) => tr.points).join(' / ')}</b>` : '';
  const picks = (t.picks ?? []).map((p) => {
    const name = `${esc(p.name)}${p.rank > 1 ? ` <em>${p.rank}</em>` : ''}`;
    return p.spell ? `<a href="${wh(state.data.wowhead, `spell=${p.spell}`)}" target="_blank" rel="noopener">${name}</a>` : `<span>${name}</span>`;
  }).join('');
  return `<div class="talents">
    <div class="drow" style="--n:${cells.length}"><span class="dlabel">Talente ${split}</span>${cells.join('')}</div>
    ${picks || t.calc ? `<div class="talent-list">${picks}${t.calc ? `<a class="tcalc" href="${esc(whDe(t.calc))}" target="_blank" rel="noopener">${t.trees?.length ? 'Talentrechner' : 'Build im Talentrechner'} ↗</a>` : ''}</div>` : ''}
  </div>`;
}

function talentTreesHtml(c, t, layout) {
  // Gewählte Ränge je Talent: zuerst über die Talent-ID, sonst über den Zauber des Rangs.
  const ranks = new Map();
  const maxRank = new Map(layout.flatMap((tree) => tree.talents.map((x) => [x.id, x.ranks.length || 1])));
  const bySpell = new Map(layout.flatMap((tree) => tree.talents.flatMap((x) => x.ranks.map((s, i) => [s, [x.id, i + 1]]))));
  // Forever nennt den Zauber von Rang 1 und den Rang getrennt. Darum zählt der höhere der beiden Ränge.
  for (const p of t.picks ?? []) {
    const hit = p.id && layout.some((tree) => tree.talents.some((x) => x.id === p.id)) ? [p.id, p.rank] : bySpell.get(p.spell);
    // Nie mehr als der Höchstrang des Talents, auch wenn die API mehr meldet.
    if (hit) ranks.set(hit[0], Math.min(maxRank.get(hit[0]) ?? 1, Math.max(ranks.get(hit[0]) ?? 0, hit[1] ?? 1, p.rank ?? 1)));
  }
  const domain = state.data.wowhead || 'classic';
  const points = layout.map((tree) => tree.talents.reduce((a, x) => a + (ranks.get(x.id) ?? 0), 0));

  // Rechner-Link mit Build: je Baum die Ränge in Reihenfolge Reihe, Spalte, ohne Nullen am Ende.
  // Der Forever-Rechner von Wowhead kodiert den Build anders. Dort öffnet der Link den Talentrechner der Klasse ohne Build.
  const build = domain === 'forever' ? '' : layout.map((tree) => tree.talents.map((x) => ranks.get(x.id) ?? 0).join('').replace(/0+$/, '')).join('-').replace(/-+$/, '');
  const calc = t.calc ? `${whDe(t.calc)}${build ? `/${build}` : ''}` : null;

  const trees = layout.map((tree, ti) => {
    const pos = new Map(tree.talents.map((x) => [x.id, x]));
    const arrows = tree.talents.filter((x) => pos.has(x.req)).map((x) => {
      const r = pos.get(x.req);
      const on = (ranks.get(r.id) ?? 0) >= r.ranks.length;
      const [x1, y1, x2, y2] = r.tier === x.tier
        ? [(r.col < x.col ? r.col + 1 : r.col) * 100, r.tier * 100 + 50, (r.col < x.col ? x.col : x.col + 1) * 100, x.tier * 100 + 50]
        : [r.col * 100 + 50, r.tier * 100 + 100, x.col * 100 + 50, x.tier * 100];
      const path = x1 === x2 || y1 === y2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}V${y2 - 30}H${x2}V${y2}`;
      return `<path class="${on ? 'on' : ''}" d="${path}"/>`;
    }).join('');
    const nodes = tree.talents.map((x) => {
      const r = ranks.get(x.id) ?? 0;
      const cls = r >= x.ranks.length ? 'full' : r ? 'part' : '';
      const spell = x.ranks[Math.max(0, r - 1)];
      return `<a class="tal ${cls}" style="--x:${x.col};--y:${x.tier}" href="${wh(domain, `spell=${spell}`)}" target="_blank" rel="noopener" aria-label="${esc(x.name)} ${r}/${x.ranks.length}">
        <img src="https://wow.zamimg.com/images/wow/icons/medium/${esc(x.icon)}.jpg" alt="" loading="lazy"><i>${r}/${x.ranks.length}</i></a>`;
    }).join('');
    return `<div class="ttree${points[ti] ? '' : ' empty'}">
      <div class="ttree-head"><span>${esc(tree.name)}</span><b>${points[ti]}</b></div>
      <div class="ttree-grid"><svg viewBox="0 0 400 700" preserveAspectRatio="none" aria-hidden="true">${arrows}</svg>${nodes}</div>
    </div>`;
  }).join('');

  return `<div class="talents">
    <div class="talents-head">
      <span class="dlabel">Talente <b class="split">${points.join(' / ')}</b></span>
      ${calc ? `<a class="tcalc" href="${esc(calc)}" target="_blank" rel="noopener">${build ? 'Build im Talentrechner' : 'Talentrechner'} ↗</a>` : ''}
    </div>
    <div class="ttrees">${trees}</div>
  </div>`;
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
// Letzte Session: eine Karte je gemeinsamer Session. Items kommen aus dem Feed (Logout im Zeitraum der Session),
// Level, Berufspunkte, Logouts und Umskillen aus den Werten der Session.

const QUALITY_NAMES = { EPIC: 'lila', RARE: 'blau', UNCOMMON: 'grün' };

// Erkannte Sessions mit Nummer. Die Nummer zählt die Baseline mit: Nach 2 Sessions aus der Baseline ist die erste erkannte Session Nummer 3.
function sessionList() {
  const offset = state.sessions?.baseline?.count ?? 0;
  return (state.sessions?.list ?? []).map((s, i, all) => {
    // Zeitraum je Spieler: ab seinem Logout vor der Session (since) bis zu seinem Logout danach (auch als Nachzügler).
    // Ältere Sessions ohne since zählen ab dem Ende der Session davor.
    const from = i ? all[i - 1].end : s.start - 6 * 36e5;
    const inSession = (e) => {
      if (!s.players.includes(e.key)) return false;
      const st = s.stats?.[e.key];
      return e.t > (st?.since ?? from) && e.t <= Math.max(s.end, st?.logout ?? 0);
    };
    const items = state.feed.events.filter((e) => e.type === 'item' && inSession(e));
    // Quests im selben Zeitraum. Der Quest-Verlauf reicht 30 Tage zurück, ältere Sessions zeigen darum weniger.
    const quests = state.questLog.filter(inSession);
    return { ...s, nr: offset + i + 1, idx: i, items, quests };
  });
}

function renderRecap() {
  const list = sessionList();
  const el = document.getElementById('rueckblick');
  el.hidden = !list.length;
  document.getElementById('nav-rueckblick').hidden = !list.length;
  if (!list.length) return;

  const idx = state.recapIdx ?? list.length - 1;
  const s = list[idx];
  const older = list.filter((x) => x !== s).reverse().slice(0, 4);
  document.getElementById('recap').innerHTML = recapCardHtml(s, list) + (older.length ? `<div class="recap-older">${older.map((x) => {
    const aw = awards(x, list)[0];
    return `<button type="button" class="recap-row" data-idx="${x.idx}">
      <span class="recap-row-top"><b>Session ${x.nr}</b><span class="mono">${fmtDay(x.end)}</span></span>
      <span class="mono recap-sum">${x.items.length} Items${aw ? ` · ${aw.title} ${esc(aw.who.map(charName).join(', '))}` : ''}</span>
    </button>`;
  }).join('')}</div>` : '');

  // Datum und Schluss der gezeigten Session stehen oben rechts im Kopf des Abschnitts.
  const end = sessionEnd(s);
  document.getElementById('recap-when').textContent = `${fmtDay(end)} · Schluss ${fmtTime(end)}`;
  document.querySelectorAll('#recap .recap-row').forEach((b) => b.addEventListener('click', () => { state.recapIdx = Number(b.dataset.idx); renderRecap(); }));
  document.querySelectorAll('#recap img').forEach(imgFallback);
  window.$WowheadPower?.refreshLinks?.();
}

function recapCardHtml(s, list) {
  const stats = Object.values(s.stats ?? {});
  const byQ = Object.entries(QUALITY_NAMES).map(([q, n]) => [s.items.filter((e) => e.quality === q).length, n]).filter(([k]) => k);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const lvlTo = avg(stats.map((x) => x.level?.[1]).filter(Boolean));
  const ilvls = stats.filter((x) => x.ilvl?.[1] != null);
  const ilvlGain = avg(ilvls.map((x) => x.ilvl[1] - (x.ilvl[0] ?? x.ilvl[1])));
  const ilvlTo = avg(ilvls.map((x) => x.ilvl[1]));

  // Vier Kacheln in derselben Reihenfolge wie die Spalten der Spielerzeilen darunter: Items, Level, Quests, Itemlevel.
  const tiles = [
    [s.items.length, 'Neue Items', byQ.map(([k, n]) => `${k} ${n}`).join(' · ') || 'keine', 'items'],
    [fmtGain(s.gain), 'Level', lvlTo ? `Ø ${Math.round(lvlTo)} · Weg bis 60: ${Math.round(progress(lvlTo))} %` : ''],
    [s.quests.length, 'Quests', topZone(s.quests) ? `meist ${topZone(s.quests)}` : ''],
    [ilvlGain != null ? fmtGain(ilvlGain) : '?', 'Itemlevel', ilvlTo != null ? `jetzt Ø ${Math.round(ilvlTo)}` : ''],
  ];

  const unlocks = recapUnlocks(s);
  const aw = awards(s, list).slice(0, 4);
  // Beute rechts in der Karte: beste Qualität und höchstes Itemlevel zuerst.
  const qOrder = ['LEGENDARY', 'EPIC', 'RARE', 'UNCOMMON', 'COMMON'];
  const loot = [...s.items].sort((a, b) => qOrder.indexOf(a.quality) - qOrder.indexOf(b.quality) || (b.ilvl ?? 0) - (a.ilvl ?? 0));
  const lootShown = loot.slice(0, 6);
  const lootHtml = loot.length ? `<div class="recap-loot"><div class="recap-label">Beute</div><ul>${lootShown.map((e) => {
    const q = (e.quality || 'COMMON').toLowerCase();
    const c = charByKey(e.key);
    const up = e.ilvl != null && e.prev != null && e.ilvl > e.prev ? ` · +${e.ilvl - e.prev} iLvl` : '';
    return `<li>${link(e, `<img class="ico sm b-${q}" src="${esc(e.icon || FALLBACK_ICON)}" alt="" loading="lazy">`)}
      <span class="loot-txt">${link(e, `<span class="q-${q}">${esc(e.name)}</span>`)}<small><span style="color:${classColor(c)}">${esc(charName(e.key))}</span>${e.slot ? ` · ${esc(e.slot)}` : ''}${up}</small></span></li>`;
  }).join('')}</ul>${loot.length > lootShown.length ? `<span class="mono loot-more">+${loot.length - lootShown.length} weitere</span>` : ''}</div>` : '';

  return `<article class="recap-card">
    <div class="recap-top"><h3>Session ${s.nr}</h3></div>
    <div class="recap-body${loot.length ? '' : ' solo'}"><div class="recap-main">
    <div class="recap-stats">${tiles.map(([v, l, sub, cls]) => `<div class="rstat ${cls ?? ''}"><b>${v}</b><span>${l}</span><small>${esc(sub)}</small></div>`).join('')}</div>
    ${unlocks.length ? `<div class="recap-unlock">${unlocks.map((u) => `<span>${u}</span>`).join('')}</div>` : ''}
    ${recapPlayersHtml(s)}
    ${aw.length ? `<div class="recap-label">Auszeichnungen</div>
    <div class="awards">${aw.map((a) => `<div class="award"${a.tip ? ` tabindex="0" data-tip-plain data-tip="${esc(a.tip)}"` : ''}><span class="aw-title">${a.title}</span>
      <b>${a.who.map((k) => `<span style="color:${classColor(charByKey(k))}">${esc(charName(k))}</span>`).join(', ')}</b>${awardDetail(a)}</div>`).join('')}</div>` : ''}
    </div>${lootHtml}</div>
  </article>`;
}

// Unterzeile einer Auszeichnung. Beim größten Upgrade: das neue Item als Link mit Wowhead-Tooltip.
function awardDetail(a) {
  const it = a.item;
  if (!it) return `<small>${esc(a.detail)}</small>`;
  const q = (it.quality || 'COMMON').toLowerCase();
  return `<small class="aw-item">${link(it, `<span class="q-${q}">${esc(it.name)}</span>`)}</small>`;
}

// Häufigste Zone in einer Liste von Quests (Zone aus questInfo). Ohne bekannte Zone null.
function topZone(quests) {
  return questZones(quests)[0]?.[0] ?? null;
}
// Quests je Zone, meiste zuerst. Quests ohne bekannte Zone zählen nicht.
function questZones(quests) {
  const info = state.data.questInfo ?? {};
  const count = new Map();
  for (const e of quests) { const z = info[e.id]?.z; if (z) count.set(z, (count.get(z) ?? 0) + 1); }
  return [...count].sort((a, b) => b[1] - a[1]);
}

// Je Spieler eine Zeile unter den Kacheln, Spalte für Spalte bündig: Name, Level, Quests, Itemlevel. Größter Levelgewinn zuerst.
function recapPlayersHtml(s) {
  const rows = Object.entries(s.stats ?? {}).sort(([, a], [, b]) => (b.level[1] - b.level[0]) - (a.level[1] - a.level[0]) || b.level[1] - a.level[1]);
  if (!rows.length) return '';
  const span = ([a, b]) => (a === b ? `${b}` : `${a} → <b>${b}</b>`);
  // Die Quests zeigen im Tooltip die Aufteilung nach Zone.
  const questCell = (k) => {
    const mine = s.quests.filter((e) => e.key === k);
    if (!mine.length) return '<span class="mono">–</span>';
    const zones = questZones(mine);
    const tip = zones.length ? ` tabindex="0" data-tip-plain data-tip="${esc(['Quests', ...zones.map(([z, n]) => `${z} ${n}`)].join('\n'))}"` : '';
    return `<span class="mono${tip ? ' rp-tip' : ''}"${tip}>${mine.length} Quests</span>`;
  };
  return `<div class="recap-players">${rows.map(([k, x]) => `<div class="rp">
    <span class="rp-name" style="color:${classColor(charByKey(k))}">${esc(charName(k))}</span>
    <span class="mono">Lv ${span(x.level)}</span>
    ${questCell(k)}
    <span class="mono">iLvl ${span(x.ilvl.map((v) => Math.round(v ?? 0)))}</span></div>`).join('')}</div>`;
}

// Neu in Reichweite: Dungeons, deren Mindestlevel die Gruppe in dieser Session erreicht hat. Dazu Meilensteine.
function recapUnlocks(s) {
  const stats = Object.entries(s.stats ?? {});
  if (!stats.length) return [];
  const lo = (i) => Math.min(...stats.map(([, x]) => x.level?.[i] ?? 0));
  const [from, to] = [lo(0), lo(1)];
  const dungeons = M.DUNGEONS.filter((d) => d.min - 2 > from && d.min - 2 <= to).map((d) => d.name);
  const out = dungeons.length ? [`Neu in Reichweite: ${esc(dungeons.join(' · '))}`] : [];
  if (from < 40 && to >= 40) out.push('Level 40: Reiten lernen');
  if (from < 60 && to >= 60) out.push('Level 60: Max-Level');
  return out;
}

// Auszeichnungen in fester Reihenfolge. Die Karte zeigt die ersten vier mit Gewinner. Bei Gleichstand gewinnen alle.
function awards(s, list) {
  const players = s.players ?? [];
  const st = s.stats ?? {};
  const top = (score, min = 1) => {
    const vals = players.map((k) => [k, score(k)]).filter(([, v]) => v != null && v >= min);
    const best = Math.max(...vals.map(([, v]) => v));
    return { who: vals.filter(([, v]) => v === best).map(([k]) => k), best };
  };
  const itemsOf = (k) => s.items.filter((e) => e.key === k);
  const earlier = list.filter((x) => x.nr < s.nr).flatMap((x) => x.items);
  const out = [];
  const add = (title, r, detail) => { if (r.who.length && r.who.length < players.length) out.push({ title, who: r.who, detail: detail(r.best) }); };

  const firstEpic = players.filter((k) => itemsOf(k).some((e) => e.quality === 'EPIC') && !earlier.some((e) => e.key === k && e.quality === 'EPIC'));
  if (firstEpic.length) out.push({ title: 'Epischer Moment', who: firstEpic, detail: 'erstes lila Item' });
  const ups = s.items.filter((e) => e.ilvl != null && e.prev != null);
  const bestUp = top((k) => Math.max(-1, ...ups.filter((e) => e.key === k).map((e) => e.ilvl - e.prev)));
  const upItem = ups.find((e) => bestUp.who.includes(e.key) && e.ilvl - e.prev === bestUp.best);
  add('Größtes Upgrade', bestUp, (v) => `${upItem?.slot ?? 'Item'} +${v} iLvl`);
  // Die Karte zeigt statt des Texts das neue Item als Link mit Wowhead-Tooltip (awardDetail).
  if (upItem && out.at(-1)?.title === 'Größtes Upgrade') out.at(-1).item = upItem;
  add('Loot-Goblin', top((k) => itemsOf(k).length, 2), (v) => `${v} neue Items`);
  add('Berufs-Streber', top((k) => st[k]?.prof, 10), (v) => `+${v} Punkte`);
  // Tooltip mit den Punkten je Beruf. Ältere Sessions kennen nur die Summe (ohne profs).
  const streber = out.at(-1)?.title === 'Berufs-Streber' ? out.at(-1) : null;
  if (streber) {
    const lines = streber.who.map((k) => Object.entries(st[k]?.profs ?? {}).sort(([, a], [, b]) => b - a).map(([n, g]) => `${profName(n)} +${g}`).join(', ')).filter(Boolean);
    if (lines.length) streber.tip = ['Berufspunkte', ...lines].join('\n');
  }
  const respec = players.filter((k) => st[k]?.respec);
  if (respec.length) out.push({ title: 'Umskiller', who: respec, detail: 'Talente neu verteilt' });
  if (s.items.length) add('Pechvogel', { who: players.filter((k) => !itemsOf(k).length) }, () => 'kein neues Item');
  const logouts = players.map((k) => st[k]?.logout).filter(Boolean);
  if (logouts.length > 1 && Math.max(...logouts) - Math.min(...logouts) >= 10 * 60e3) {
    add('Licht aus', top((k) => st[k]?.logout, 0), (v) => `letzter Logout ${fmtTime(v)}`);
    add('Fluchtwagen', top((k) => (st[k]?.logout ? -st[k].logout : null), -Infinity), (v) => `erster Logout ${fmtTime(-v)}`);
  }
  return out;
}

// Schluss einer Session: der letzte Logout der Spieler.
function sessionEnd(s) { return Math.max(...Object.values(s.stats ?? {}).map((x) => x.logout ?? 0), s.end); }

// ---------------------------------------------------------------------------
// Vor dem nächsten Abend: offene Punkte je Charakter aus dem letzten Abend und dem aktuellen Stand.
// Rot sind Klassenquests und Berufe am Limit, die übrigen Punkte sind Routine.

function renderPrep() {
  const last = sessionList().at(-1);
  const el = document.getElementById('vorbereitung');
  const chars = state.chars.filter((c) => c.level);
  const tasks = chars.map((c) => {
    const st = last?.stats?.[c.key];
    // Die API kennt keine gelernten Zauber. Wer sich nach der Session neu einloggt, war vermutlich beim Lehrer.
    return [c, prepTasks(c, st?.level, c.lastLogin > (st?.logout ?? last?.end ?? Infinity))];
  });
  const total = tasks.reduce((a, [, t]) => a + t.length, 0);
  el.hidden = !last;
  document.getElementById('nav-vorbereitung').hidden = !last;
  if (!last) return;
  document.getElementById('prep-count').textContent = total ? `${total} offen` : 'alles erledigt';
  document.getElementById('prep').style.setProperty('--n', tasks.length);
  document.getElementById('prep').innerHTML = tasks.map(([c, list]) => `<div class="prep-col" style="--cls:${classColor(c)}">
    <b>${esc(fullName(c))}</b>
    ${list.length ? list.map(([text, hot, path]) => (path
      ? `<a class="task${hot ? ' hot' : ''}" href="${wh(state.data.wowhead || 'classic', path)}" target="_blank" rel="noopener">${esc(text)} ↗</a>`
      : `<span class="task${hot ? ' hot' : ''}">${esc(text)}</span>`)).join('') : '<span class="task done">nichts offen</span>'}
  </div>`).join('');
}

function prepTasks(c, range, trained = false) {
  const [from, to] = range ?? [c.level, c.level];
  const crossed = (lv) => from < lv && to >= lv;
  const out = [];
  for (const [lv, text, hot, path] of M.CLASS_TASKS[c.classId] ?? []) if (crossed(lv)) out.push([text, hot, path]);
  // Forever: Mit dem Reiten gibt es das Reittier dazu. Ab 40 auch die zweite Talentverteilung (Dualspezialisierung).
  if (crossed(40)) out.push(['Reiten lernen', true], ['Dualspezialisierung freischalten', false]);
  for (const p of c.professions ?? []) {
    const next = M.PROF_RANKS[p.max];
    if (!next || p.skill < p.max - 25 || c.level < next[1]) continue;
    const spell = M.PROF_RANK_SPELLS[p.name]?.[p.max];
    out.push([`${profName(p.name)}: ${next[0]} lernen`, p.skill >= p.max, spell ? `spell=${spell}#taught-by-npc` : null]);
  }
  // Neue Zauber gibt es in Classic auf geraden Leveln.
  if (!trained) for (let lv = to; lv > from; lv--) if (lv % 2 === 0) { out.push([`Lehrer: Level ${lv}`, false]); break; }
  const free = c.talents?.trees?.length ? Math.max(0, c.level - 9 - c.talents.trees.reduce((a, t) => a + t.points, 0)) : 0;
  if (free) out.push([`${free} ${free === 1 ? 'Talentpunkt' : 'Talentpunkte'} frei`, false]);
  return out.sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Leveling-Route (Forever-Zonen und -Dungeons aus meta.js)

function renderRoute() {
  const ok = state.chars.filter((c) => c.level);
  const classicLevels = state.data.era !== 'retail';
  const bands = [[1, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60]];
  const inBand = (c, a, b) => c.level >= a && (c.level < b || (b === 60 && c.level <= 60));

  const lvs = ok.map((c) => c.level);
  const lo = Math.min(...lvs), hi = Math.max(...lvs);
  document.getElementById('route-note').textContent = !classicLevels ? 'AB FOREVER-START · VORSCHAU'
    : !lvs.length ? '' : lo === hi ? `Gruppe LV ${lo}` : `Gruppe LV ${lo} bis ${hi}`;

  // Tipp: je Spalte der beste Ort für die ganze Gruppe. Bewertet nach Spielern im Levelbereich,
  // bei Gleichstand nach dem Abstand der Mitten. Spieler dürfen 2 Level unter dem Minimum liegen.
  const forAll = (x) => ok.every((c) => c.level >= x.min - 2 && c.level <= x.max);
  const inside = (x) => ok.filter((c) => c.level >= x.min && c.level <= x.max).length;
  const gap = (x) => Math.abs((x.min + x.max) / 2 - (lo + hi) / 2);
  const best = (list) => list.filter(forAll).sort((x, y) => inside(y) - inside(x) || gap(x) - gap(y))[0];
  // Steht die Gruppe schon in einer Zone (offene Quests), bleibt sie der Tipp, solange das Level passt.
  // Zonen, die nicht über ihre Stufe hinausgehen (Brachland: Silberwald), fallen als Tipp ganz weg.
  const inZone = classicLevels ? currentZone(ok) : null;
  const zoneTip = inZone && lo <= inZone.max ? inZone : best(inZone ? M.ZONES.filter((z) => z.max > inZone.max) : M.ZONES);
  const tips = new Set(classicLevels && ok.length ? [zoneTip, best(M.DUNGEONS)].filter(Boolean) : []);

  // Ohne Wowhead-ID (neuer Raid ohne Eintrag) steht der Ort ohne Link.
  const place = (x, range, mark = false) => {
    const next = mark && tips.has(x);
    const inner = `<i class="fd ${x.f === 'A' ? 'a' : x.f === 'H' ? 'h' : ''}"></i><span class="nm">${esc(x.name)}</span>${next ? `<em>${x === inZone ? 'Aktuell' : 'Als Nächstes'}</em>` : ''}<span class="rg">${range}</span>`;
    return x.id
      ? `<a class="place${next ? ' next' : ''}" href="${wh(state.data.wowhead || 'classic', `zone=${x.id}`)}" target="_blank" rel="noopener">${inner}</a>`
      : `<span class="place">${inner}</span>`;
  };

  const rows = bands.map(([a, b]) => {
    const here = classicLevels && ok.some((c) => inBand(c, a, b));
    // Markiert wird nur in der Stufe der Gruppe, dort steht der Tipp vorne in seiner Liste.
    const tipFirst = (x, y) => (here ? tips.has(y) - tips.has(x) : 0);
    const zones = M.ZONES.filter((z) => z.min >= a - 5 && z.min < b && z.max > a).sort(tipFirst);
    const dungeons = M.DUNGEONS.filter((d) => d.min >= a && d.min < b).sort(tipFirst);
    return `<div class="route-row ${here ? 'now' : ''}">
      <span class="lv">${a}-${b}</span>
      <div class="place-list" data-label="Zonen">${zones.map((z) => place(z, `${z.min}-${z.max}`, here)).join('')}</div>
      <div class="place-list single" data-label="Dungeons">${dungeons.length ? dungeons.map((d) => place(d, `${d.min}-${d.max}`, here)).join('') : '<span class="none">keine</span>'}</div>
    </div>`;
  });
  const at60 = classicLevels && ok.some((c) => c.level >= 60);
  rows.push(`<div class="route-row ${at60 ? 'now' : ''}">
    <span class="lv">60</span>
    <div class="place-list" data-label="Raids">${M.RAIDS.map((r) => place({ ...r, f: 'N' }, `${r.size} Sp.`)).join('')}</div>
    <span class="none route-raids">Raids</span>
  </div>`);

  // Eingeklappt zeigt die Route nur die Stufen, in denen jemand aus der Gruppe steht, und die Stufe danach.
  // Stufen hinter der Gruppe fallen weg, auch zwischen zwei weit auseinander liegenden Charakteren.
  const now = rows.map((r, i) => (r.includes('route-row now') ? i : -1)).filter((i) => i >= 0);
  const keep = now.length ? new Set([...now, Math.min(rows.length - 1, now.at(-1) + 1)]) : new Set(rows.keys());
  const hidden = rows.length - keep.size;
  const visible = state.routeAll ? rows : rows.filter((_, i) => keep.has(i));
  const el = document.getElementById('route');
  el.innerHTML = `<div class="route">
      <div class="route-head"><span>Level</span><span>Zonen</span><span>Dungeons</span></div>
      ${visible.join('')}
    </div>
    ${hidden ? `<button type="button" class="chip-btn route-more">${state.routeAll ? 'Nur aktuelle Stufen zeigen' : `Ganze Route zeigen · ${plural(hidden, 'weitere Stufe', 'weitere Stufen')}`}</button>` : ''}`;
  el.querySelector('.route-more')?.addEventListener('click', () => { state.routeAll = !state.routeAll; renderRoute(); });
}

// Aktuelle Zone der Gruppe: die Zone mit den meisten offenen Quests im Questlog aller Charaktere.
// Erst ab 5 offenen Quests, damit ein einzelner Auftrag aus einer anderen Zone nicht zählt.
function currentZone(chars) {
  const info = state.data.questInfo ?? {};
  const count = new Map();
  for (const c of chars) for (const id of c.quests?.open ?? []) {
    const z = M.ZONES.find((x) => x.name === info[id]?.z);
    if (z) count.set(z, (count.get(z) ?? 0) + 1);
  }
  const [zone, n] = [...count].sort((a, b) => b[1] - a[1])[0] ?? [];
  return n >= 5 ? zone : null;
}

// ---------------------------------------------------------------------------
// Aktivität: Level-Ups, neue Items, Berufe, Gilde und gemeinsame Sessions, neueste zuerst

function renderFeed() {
  const events = feedEvents(state.feed.events);
  document.getElementById('aktivitaet').hidden = !events.length;
  document.getElementById('nav-aktivitaet').hidden = !events.length;
  if (!events.length) return;
  renderFeedList(events, {
    list: document.getElementById('feed'), note: document.getElementById('feed-note'),
    days: state.feedDays, itemHtml: feedItemHtml, more: () => { state.feedDays++; renderFeed(); },
  });
}

// Ereignisse der Aktivität, neueste zuerst. Grüne Items zählen nur in „Letzte Session“.
function feedEvents(events) {
  return events.filter((e) => !(e.type === 'item' && e.quality === 'UNCOMMON')).sort((a, b) => b.t - a.t);
}

// Liste der Aktivität für Squad und Gilde. Gezeigt werden die neuesten Tage, ältere Tage kommen per Knopf dazu.
function renderFeedList(events, { list, note, days, itemHtml, more }) {
  const byDay = new Map();
  for (const e of events) {
    const day = new Date(e.t).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const shown = [...byDay].slice(0, days);
  const rest = byDay.size - shown.length;
  const week = events.filter((e) => e.type === 'level' && Date.now() - e.t < 7 * 864e5).reduce((n, e) => n + (e.to - e.from), 0);
  note.textContent = week ? `${week} LEVEL IN 7 TAGEN` : plural(events.length, 'EREIGNIS', 'EREIGNISSE');

  list.innerHTML = shown.map(([day, evs]) => `<div class="feed-day"><h3>${day}<span>${plural(evs.length, 'Ereignis', 'Ereignisse')}</span></h3><ul>${evs.map(itemHtml).join('')}</ul></div>`).join('')
    + (rest ? `<button type="button" class="chip-btn feed-more">Vorherigen Tag zeigen · noch ${rest}</button>` : '');
  list.querySelectorAll('img').forEach(imgFallback);
  list.querySelector('.feed-more')?.addEventListener('click', more);
  window.$WowheadPower?.refreshLinks?.();
}

// Spiel-Icons für die Aktivität. Level-Ups tragen die neue Stufe als Badge.
const FEED_ICONS = {
  level: 'spell_holy_surgeoflight', max: 'achievement_level_60', session: 'inv_misc_groupneedmore', guild: 'inv_shirt_guildtabard_01', leave: 'ability_vanish',
  prof: {
    Alchemie: 'trade_alchemy', Schmiedekunst: 'trade_blacksmithing', Verzauberkunst: 'trade_engraving', Ingenieurskunst: 'trade_engineering',
    Kräuterkunde: 'trade_herbalism', Lederverarbeitung: 'trade_leatherworking', Bergbau: 'trade_mining', Kürschnerei: 'inv_misc_pelt_wolf_01',
    Schneiderei: 'trade_tailoring', Kochkunst: 'inv_misc_food_15', Angeln: 'trade_fishing', 'Erste Hilfe': 'spell_holy_sealofsacrifice',
  },
};
function feedIcon(name, badge = '') {
  return `<span class="wi"><img src="https://wow.zamimg.com/images/wow/icons/medium/${name}.jpg" alt="" loading="lazy">${badge !== '' ? `<b>${badge}</b>` : ''}</span>`;
}

function feedItemHtml(e) {
  const time = new Date(e.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const c = state.data.characters.find((x) => x.key === e.key);
  const name = (key) => esc(charName(key));
  const who = c ? `<b class="who" style="--cls:${classColor(c)}">${esc(fullName(c))}</b>` : e.key ? `<b class="who">${name(e.key)}</b>` : '';
  // Jeder Eintrag ist eine Zeile. Was nicht passt, kürzt die Seite ab, Details zeigt der Tooltip.
  const row = (cls, icon, text, tip = '') => `<li class="ev ${cls}"${c ? ` style="--cls:${classColor(c)}"` : ''}${tip ? ` data-tip="${esc(tip)}"` : ''}><time>${time}</time><span class="ev-ico">${icon}</span><span class="ev-txt">${who} ${text}</span></li>`;

  switch (e.type) {
    case 'level':
      if (e.max) return row('ev-max', feedIcon(FEED_ICONS.max, e.to), `erreicht <strong>Level ${e.to}</strong>, Max-Level!`);
      return row('ev-level', feedIcon(FEED_ICONS.level, e.to), e.to - e.from > 1 ? `steigt von ${e.from} auf <strong>Level ${e.to}</strong>` : `erreicht <strong>Level ${e.to}</strong>`);
    case 'item': {
      const q = (e.quality || 'COMMON').toLowerCase();
      const img = `<img class="ico sm b-${q}" src="${esc(e.icon || FALLBACK_ICON)}" alt="" loading="lazy">`;
      return row('ev-item', img, `trägt ${link(e, `<span class="q-${q}">${esc(e.name)}</span>`)}`);
    }
    case 'prof':
      return row('ev-prof', feedIcon(FEED_ICONS.prof[profName(e.name)] ?? 'inv_misc_note_01'), e.learned ? `lernt <strong>${esc(profName(e.name))}</strong>` : `${esc(profName(e.name))} auf <strong>${e.skill}</strong>`);
    case 'achievement': {
      const ico = `<span class="wi"><img src="${esc(e.icon || FALLBACK_ICON)}" alt="" loading="lazy"></span>`;
      const name = `<strong>${esc(e.name)}</strong>`;
      return row('ev-ach', ico, `erhält den Erfolg ${e.id ? `<a href="${wh(state.data.wowhead, `achievement=${e.id}`)}" target="_blank" rel="noopener">${name}</a>` : name}`,
        e.desc ? `${e.name}\n${e.desc}` : '');
    }
    case 'found':
      return `<li class="ev ev-guild ev-found"><time>${time}</time><span class="ev-ico">${feedIcon(FEED_ICONS.guild)}</span><span class="ev-txt"><strong>Gildengründung</strong> · &lt;${esc(e.guild ?? '')}&gt;</span></li>`;
    case 'guild':
      return row('ev-guild', feedIcon(FEED_ICONS.guild), e.guild ? `tritt <strong>&lt;${esc(e.guild)}&gt;</strong> bei` : `verlässt <strong>&lt;${esc(e.from ?? '')}&gt;</strong>`);
    case 'session': {
      const hours = e.start ? Math.max(0, (e.t - e.start) / 36e5) : null;
      const players = (e.players ?? []).map(charName);
      const lv = Math.round(e.gain ?? 0) ? ` · ${fmtGain(e.gain)} Level` : '';
      return row('ev-session', feedIcon(FEED_ICONS.session), `<strong>Gemeinsame Session</strong> · ${players.length} Spieler${lv}`,
        `Gemeinsame Session\n${players.join(', ')}${hours >= 0.5 ? `\nLogouts über ${fmtDec(hours)} Std.` : ''}`);
    }
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Hilfen

function charByKey(k) { return state.data.characters.find((x) => x.key === k) ?? {}; }
function charName(k) { const c = charByKey(k); return c.name ? fullName(c) : k.split('/').pop(); }
// Kachel: Nachname klein in der zweiten Zeile.
function nameHtml(c) { return `${esc(c.name)}${c.surname ? `<small class="surname">${esc(c.surname)}</small>` : ''}`; }
// Voller Name: In Forever gehört der Nachname dazu.
function fullName(c) { return [c.name, c.surname].filter(Boolean).join(' '); }
// Die Gruppe levelt gemeinsam, der Zuwachs zählt darum in ganzen Leveln.
function fmtGain(n) { const r = Math.round(n ?? 0); return `${r > 0 ? '+' : ''}${r}`; }
function fmtDay(t) { return new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }); }
function fmtTime(t) { return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
const CLASS_ICONS = { 1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue', 5: 'priest', 7: 'shaman', 8: 'mage', 9: 'warlock', 11: 'druid' };
function classIcon(id, size = 'medium') { return `https://wow.zamimg.com/images/wow/icons/${size}/classicon_${CLASS_ICONS[id] ?? 'warrior'}.jpg`; }
function classColor(c) { return M.CLASSES[c.classId]?.color ?? '#c9c2b3'; }
function profName(n) { return M.PROFESSIONS[n] ?? n; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function fmtDec(n) { return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

function ago(ts) {
  const h = (Date.now() - ts) / 36e5;
  if (h < 1) return 'gerade eben';
  if (h < 24) return `vor ${Math.round(h)} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`;
}

function link(it, inner) {
  if (!it.id) return inner;
  return `<a href="${wh(state.data.wowhead ?? 'classic', `item=${it.id}`)}" target="_blank" rel="noopener">${inner}</a>`;
}

// Wowhead auf Deutsch: Forever unter /forever/de/, Classic unter /classic/de/, Retail unter /de/. Die Tooltips folgen der Sprache des Links.
function wh(env, path) { return `https://www.wowhead.com/${env ? `${env}/` : ''}de/${path}`; }
function whDe(url) {
  if (/^https:\/\/www\.wowhead\.com\/(?:(?:classic|forever)\/)?de\//.test(url)) return url;
  return url.replace(/^(https:\/\/www\.wowhead\.com\/(?:(?:classic|forever)\/)?)/, '$1de/');
}

function imgFallback(img) {
  img.addEventListener('error', () => { if (img.classList.contains('ico')) img.src = FALLBACK_ICON; else img.remove(); }, { once: true });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

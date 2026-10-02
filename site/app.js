const M = window.META;
const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';
const SLOTS_LEFT = [['HEAD', 'Kopf'], ['NECK', 'Hals'], ['SHOULDER', 'Schultern'], ['BACK', 'Rücken'], ['CHEST', 'Brust'], ['WRIST', 'Handgelenke'], ['MAIN_HAND', 'Waffenhand'], ['OFF_HAND', 'Schildhand']];
const SLOTS_RIGHT = [['HANDS', 'Hände'], ['WAIST', 'Taille'], ['LEGS', 'Beine'], ['FEET', 'Füße'], ['FINGER_1', 'Finger 1'], ['FINGER_2', 'Finger 2'], ['TRINKET_1', 'Schmuck 1'], ['TRINKET_2', 'Schmuck 2'], ['RANGED', 'Distanz']];
const ANIMATIONS = [['Stand', 'Stehen'], ['EmoteWave', 'Winken'], ['EmoteCheer', 'Jubeln'], ['EmoteDance', 'Tanzen'], ['Run', 'Laufen']];

const state = { data: null, talents: {}, sessions: {}, feed: { events: [] }, feedDays: 1, routeAll: false, recapIdx: null, chars: [], selected: null, use3d: true, tileViewers: [], loViewer: null, loToken: 0 };

try {
  state.selected = localStorage.getItem('selected');
  const pref = localStorage.getItem('use3d');
  state.use3d = pref ? pref === '1' : true;
} catch {}
// Auf Handys bleibt es bei den 2D-Renders, der Schalter ist dort ausgeblendet (siehe style.css).
if (!window.Model3D.supported() || matchMedia('(max-width: 760px)').matches) state.use3d = false;

init();

async function init() {
  try {
    const optional = (f) => fetch(`${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const [data, sessions, feed, talents] = await Promise.all([
      fetch(`data.json?t=${Date.now()}`).then((r) => r.json()),
      optional('sessions.json'),
      optional('feed.json'),
      fetch('talents.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    state.data = data;
    state.talents = talents.classes ?? {};
    state.sessions = sessions;
    state.feed = { events: feed.events ?? [] };
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
  document.getElementById('brand-sub').textContent = `${d.simulated ? 'VORSCHAU' : d.era === 'retail' ? 'RETAIL' : 'FOREVER'} · EU · ${state.chars.length} SPIELER`;
  const time = new Date(d.generatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('sync').textContent = `SYNC ${time}`;
  document.getElementById('foot-stamp').textContent = `Stand ${time}`;

  setupNav();
  setup3dToggle();
  renderKpis();
  renderTiles();
  renderGroup();
  renderLoadout();
  renderRecap();
  renderPrep();
  renderRoute();
  renderFeed();

  setupReveal();
  countIn(document.querySelector('main'));
  startCountdown();
  setupBloodlust();
}

// ---------------------------------------------------------------------------
// Navigation und 3D-Schalter

function setupNav() {
  const links = [...document.querySelectorAll('.nav-links a')];
  const targets = links.map((a) => document.querySelector(a.getAttribute('href')));
  const onScroll = () => {
    let idx = 0;
    targets.forEach((t, i) => { if (t && !t.hidden && t.getBoundingClientRect().top < 140) idx = i; });
    if (links[idx].classList.contains('active')) return;
    links.forEach((a, i) => a.classList.toggle('active', i === idx));
    // Auf schmalen Bildschirmen scrollt die Navigation seitlich. Der aktive Punkt bleibt sichtbar.
    const bar = links[idx].parentElement;
    if (bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: links[idx].offsetLeft - bar.clientWidth / 2 + links[idx].offsetWidth / 2, behavior: 'smooth' });
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
  document.getElementById('kpis').innerHTML = [
    countdownKpi(),
    tempoKpi(),
    hoursKpi(ok),
  ].join('');
}

// Vor dem Start zählt die Zahl die Tage bis Forever, danach die Tage seit dem Start.
function launchTime() { return state.data.launch ? new Date(`${state.data.launch}T00:00:00`).getTime() : null; }

function countdownKpi() {
  const launch = launchTime();
  if (!launch) return '';
  const days = Math.ceil((launch - Date.now()) / 864e5);
  return days > 0 ? kpi(days, days === 1 ? 'Tag bis Forever' : 'Tage bis Forever', 'hot') : kpi(`Tag ${1 - days}`, 'seit Forever-Start', 'hot');
}

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
      <span class="nums"><span>LV ${c.level}</span><span class="il">iLvl ${c.equippedIlvl ?? '?'}</span></span>
    </span>
  </button>`;
}

// Model3D lädt die Modelle nacheinander. Der 2D-Render bleibt stehen, bis das Modell fertig ist.
async function mountTiles() {
  const env = state.data.modelEnv || 'classic';
  const jobs = [];
  for (const c of state.chars) {
    if (!state.use3d || !c.model) continue;
    const stage = document.querySelector(`[data-stage="${CSS.escape(c.key)}"]`);
    if (stage) jobs.push({ c, stage, band: loadingBand(stage) });
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
      stage.querySelector('img.render')?.remove();
      hideBand(band);
    } catch (err) {
      box.remove();
      jobs.forEach((j) => hideBand(j.band));
      console.warn('3D nicht verfügbar:', err.message);
      return;
    }
  }
}

// Schräger Balken über dem 2D-Render, solange das 3D-Modell wartet oder lädt.
function loadingBand(el) {
  const band = document.createElement('span');
  band.className = 'loading-band';
  band.innerHTML = '<span class="band-strip">Loading</span>';
  el.append(band);
  return band;
}

function hideBand(band) {
  band.classList.add('done');
  setTimeout(() => band.remove(), 400);
}

// Klick auf eine Kachel: erst zum Loadout scrollen, dann wechselt der Charakter mit dem Band. So sieht man den Effekt ganz.
function select(key) {
  const el = document.getElementById('loadout');
  if (key === state.selected) { el.scrollIntoView({ behavior: 'smooth' }); return; }
  state.selected = key;
  try { localStorage.setItem('selected', key); } catch {}
  document.querySelectorAll('.tile[data-key]').forEach((t) => t.classList.toggle('selected', t.dataset.key === key));
  const swap = () => { if (state.selected === key) { renderLoadout(); swapBand(); } };
  const top = el.getBoundingClientRect().top;
  if (Math.abs(top - 90) < 40) { swap(); return; }
  // Ende des Scrollens: Position steht drei Bilder lang still (Safari kennt kein scrollend). Spätestens nach 1,5 s.
  el.scrollIntoView({ behavior: 'smooth' });
  const t0 = performance.now();
  let lastY = -1;
  let still = 0;
  const wait = () => {
    still = scrollY === lastY ? still + 1 : 0;
    lastY = scrollY;
    if (still >= 3 || performance.now() - t0 > 1500) swap();
    else requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}

// Beim Wechsel zieht der Name als Band in Klassenfarbe durch das Loadout.
function swapBand() {
  const el = document.getElementById('loadout');
  const c = state.chars.find((x) => x.key === state.selected);
  if (!c) return;
  el.classList.remove('swap');
  void el.offsetWidth;
  el.classList.add('swap', 'swapping');
  clearTimeout(state.swapTimer);
  state.swapTimer = setTimeout(() => el.classList.remove('swapping'), 1300);
  burst(c.name, { into: el, color: classColor(c), dur: 1300 });
}

// ---------------------------------------------------------------------------
// Bänder, Hochzählen und Einblenden

// Band als Durchzug, auf der ganzen Seite oder in einem Element (into). Farbe und Schrift folgen der Klassenfarbe.
function burst(text, { into = null, color = null, dur = 2600, icon = null } = {}) {
  const box = document.createElement('div');
  box.className = `burst${into ? ' local' : ''}`;
  box.setAttribute('aria-hidden', 'true');
  const strip = document.createElement('span');
  strip.className = 'band-strip';
  strip.style.setProperty('--dur', `${dur}ms`);
  if (color) {
    const dark = isLight(color);
    strip.style.setProperty('--band', color);
    strip.style.setProperty('--band-ink', dark ? '#07090c' : '#fff');
    strip.classList.toggle('dark', dark);
  }
  strip.innerHTML = `${icon ? `<img src="${esc(icon)}" alt="">` : ''}<span>${esc(text)}</span>`;
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

// Zahlen zählen beim ersten Sichtbarwerden von 0 hoch. Text davor und danach bleibt stehen (z. B. „LV 90“, „~150 h“).
const COUNT_SEL = [
  '.kpi b', '.tile .nums span', '.rstat b', '.lo-head .chip.lv', '.lo-head .chip.il', '.gear .num', '.dcell b', '.split', '.ttree-head b',
  '.route-tips b', '.gcount', '.wi b', '#group-count', '#prep-count', '#feed-note',
].join(', ');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function countIn(root) {
  if (!root || reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const els = [...root.querySelectorAll(COUNT_SEL)].filter((el) => !el.children.length && !el.dataset.countTo && /\d/.test(el.textContent));
  // Was gleichzeitig ins Bild kommt, startet leicht versetzt. So läuft die Welle von oben nach unten.
  const io = new IntersectionObserver((entries) => entries.filter((en) => en.isIntersecting).forEach((en, k) => {
    io.unobserve(en.target);
    setTimeout(() => countUp(en.target), Math.min(k, 16) * 45);
  }), { threshold: 0.4 });
  els.forEach((el) => { el.dataset.countTo = el.textContent; el.textContent = el.textContent.replace(/\d+(?:,\d+)?/g, '0'); io.observe(el); });
}

// Alle Zahlen im Text zählen gleichzeitig hoch (z. B. „13 / 29 abgedeckt“). Am Ende blitzt der Wert kurz auf.
function countUp(el, dur = 2000) {
  const full = el.dataset.countTo;
  const parts = full.split(/(\d+(?:,\d+)?)/);
  const nums = parts.map((x, i) => (i % 2 ? { v: Number(x.replace(',', '.')), d: x.includes(',') ? x.split(',')[1].length : 0 } : null));
  let last = null;
  let elapsed = 0;
  el.dataset.counting = '1';
  const step = (t) => {
    if (!el.isConnected) return;
    // Je Bild höchstens 34 ms Fortschritt. Ruckelt die Seite (z. B. beim Laden eines 3D-Modells), springt die Zahl nicht.
    if (last != null) elapsed += Math.min(34, Math.max(0, t - last));
    last = t;
    const p = Math.min(1, elapsed / dur);
    const ease = p < 0.5 ? 2 * p * p : 1 - (2 - 2 * p) ** 2 / 2;
    el.textContent = parts.map((x, i) => (nums[i]
      ? (nums[i].v * ease).toLocaleString('de-DE', { minimumFractionDigits: nums[i].d, maximumFractionDigits: nums[i].d, useGrouping: false })
      : x)).join('');
    if (p < 1) { requestAnimationFrame(step); return; }
    el.textContent = full;
    delete el.dataset.counting;
    el.dataset.counted = '1';
    el.classList.add('count-flash');
    setTimeout(() => el.classList.remove('count-flash'), 700);
  };
  requestAnimationFrame(step);
}

// Panels gleiten beim Scrollen ins Bild.
function setupReveal() {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('in');
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
  [...state.tileViewers, state.loViewer].filter(Boolean).forEach(fight);
  clearTimeout(LUST.timer);
  LUST.timer = setTimeout(() => {
    document.body.classList.remove('lust');
    [...state.tileViewers, state.loViewer].filter(Boolean).forEach(calm);
  }, LUST.dur);
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
  window.Model3D.play(v, v === state.loViewer ? document.querySelector('#lo-anims .active')?.dataset.anim ?? 'Stand' : 'Stand');
}


// ---------------------------------------------------------------------------
// Gruppe: Buffs, Tools und Berufe

// Buffs, Tools und Berufe in einer Kachel: je Eintrag eine Zeile, rechts die Charaktere als Tags.
const GATHERING = ['Kräuterkunde', 'Bergbau', 'Kürschnerei'];
const SECONDARY = ['Kochkunst', 'Angeln', 'Erste Hilfe'];
const PROF_RANK_NAMES = { 75: 'Lehrling', 150: 'Geselle', 225: 'Experte', 300: 'Fachmann' };

function renderGroup() {
  const ok = state.chars.filter((c) => c.level);
  const providers = (classes) => ok.filter((c) => classes.includes(c.classId));
  const classNames = (ids) => ids.map((id) => M.CLASSES[id]?.name).join(', ');
  const tag = (c, tip) => `<span class="tag" style="--cls:${classColor(c)}" tabindex="0" data-tip="${esc(tip)}">${esc(c.name)}</span>`;
  const row = (name, sub, who, tags, attrs = '', tip = '') => `<div class="grow"${attrs}${tip ? ` data-tip="${esc(tip)}"` : ''} style="--hl:${classColor(who[0])}">
    <span class="nm"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="tags">${tags}</span></div>`;

  // Buffs und Tools: Tag-Tooltip nennt Klasse und Zauber des Charakters.
  const spellTip = (entry, c) => {
    const spells = entry.spells.filter(([, , cls]) => cls === c.classId).map(([, n]) => n);
    return `${c.name} · ${M.CLASSES[c.classId]?.name ?? ''}\n${spells.length ? spells.join(', ') : entry.name}`;
  };
  // Was niemand mitbringt, nennt der Tooltip am Zähler der Spalte, gruppiert nach der Klasse, die es mitbringt.
  const entries = (list, sub) => {
    const rows = [];
    const miss = new Map();
    list.forEach((entry) => {
      const who = providers(entry.classes);
      if (!who.length) {
        const key = classNames(entry.classes);
        miss.set(key, [...(miss.get(key) ?? []), entry.name]);
        return;
      }
      const spells = [...new Set(entry.spells.map(([, n]) => n))].join(', ');
      rows.push(row(entry.name, sub(entry), who, who.map((c) => tag(c, spellTip(entry, c))).join(''), ' tabindex="0"', `${entry.name}\n${entry.desc}${spells !== entry.name ? `\n${spells}` : ''}`));
    });
    rows.miss = [...miss].map(([cls, names]) => `${cls}: ${names.join(', ')}`);
    return rows;
  };
  const buffs = entries(M.BUFFS, (e) => e.effect);
  const tools = entries(M.TOOLS, (e) => classNames(e.classes));

  // Berufe: der Tooltip am Tag zeigt Punkte, Stufe und nächsten Schritt.
  const profTip = (c, p, name) => {
    const rank = PROF_RANK_NAMES[p.max];
    const next = M.PROF_RANKS[p.max];
    const step = p.skill < p.max ? `noch ${p.max - p.skill} Punkte bis ${p.max}`
      : next ? `Stufe voll · ${next[0]} ab Level ${next[1]}` : 'Maximum erreicht';
    return `${c.name} · ${name}\n${p.skill} / ${p.max}${rank ? ` · ${rank}` : ''}\n${step}`;
  };
  const profList = [...new Set([...M.PRIMARY_PROFESSIONS, ...ok.flatMap((c) => (c.professions ?? []).map((p) => profName(p.name)))])];
  const profRows = [];
  const missProfs = [];
  for (const name of profList) {
    const has = ok.map((c) => [c, c.professions?.find((p) => profName(p.name) === name)]).filter(([, p]) => p)
      .sort((x, y) => (y[1].skill ?? 0) - (x[1].skill ?? 0));
    if (!has.length) {
      if (M.PRIMARY_PROFESSIONS.includes(name)) missProfs.push(name);
      continue;
    }
    const kind = SECONDARY.includes(name) ? 'Sekundär' : GATHERING.includes(name) ? 'Sammeln' : 'Herstellen';
    profRows.push([kind === 'Sekundär' ? 2 : kind === 'Sammeln' ? 0 : 1, row(name, kind, has.map(([c]) => c),
      has.map(([c, p]) => tag(c, profTip(c, p, name))).join(''), '',
      `${name} · ${kind}\n${has.map(([c, p]) => `${c.name} ${p.skill} / ${p.max}`).join('\n')}`)]);
  }
  profRows.sort((x, y) => x[0] - y[0]);
  const primaryHave = M.PRIMARY_PROFESSIONS.length - missProfs.length;

  const col = (title, rows, count, miss) => {
    const tip = miss.length ? `Fehlt in der Gruppe\n${miss.join('\n')}` : 'Alles da';
    return `<div class="gcol"><div class="gsec"><span>${title}</span><b class="gcount" tabindex="0" data-tip="${esc(tip)}" data-tip-plain>${count}</b></div>${rows.join('')}</div>`;
  };

  document.getElementById('group-count').textContent = `${buffs.length + tools.length + primaryHave} / ${M.BUFFS.length + M.TOOLS.length + M.PRIMARY_PROFESSIONS.length} abgedeckt`;
  const el = document.getElementById('group');
  el.innerHTML = `<div class="g3">
      ${col('Buffs', buffs, `${buffs.length} / ${M.BUFFS.length}`, buffs.miss)}
      ${col('Tools', tools, `${tools.length} / ${M.TOOLS.length}`, tools.miss)}
      ${col('Berufe', profRows.map(([, r]) => r), `${primaryHave} / ${M.PRIMARY_PROFESSIONS.length}`, missProfs)}
    </div>`;
}

// Hover-Tooltip für alles mit data-tip: Maus zeigt beim Überfahren, Touch und Tastatur per Tippen bzw. Fokus.
let tipEl = null;
function showTip(anchor) {
  hideTip();
  const [head, ...rest] = anchor.dataset.tip.split('\n');
  tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.setAttribute('role', 'tooltip');
  // Bei mehreren Zeilen ist die letzte der Hinweis (Zauber, nächster Schritt) und steht farbig.
  tipEl.innerHTML = `<b>${esc(head)}</b>${rest.map((l, i) => `<span${rest.length > 1 && i === rest.length - 1 && !anchor.hasAttribute('data-tip-plain') ? ' class="tip-foot"' : ''}>${esc(l)}</span>`).join('')}`;
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
        <span class="chip lv">Level ${c.level}</span>
        <span class="chip il">iLvl ${c.equippedIlvl ?? '?'}</span>
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
    ${talentsHtml(c)}`;

  el.querySelectorAll('img').forEach(imgFallback);
  window.$WowheadPower?.refreshLinks?.();
  if (state.use3d && c.model) mountLoadout(c);
  countIn(el);
}

async function mountLoadout(c) {
  const token = state.loToken;
  const box = document.getElementById('lo-model');
  const holder = document.createElement('div');
  holder.className = 'stage-3d';
  box.append(holder);
  const band = loadingBand(box);
  try {
    const v = await window.Model3D.mount(holder, c.model, state.data.modelEnv || 'classic', { priority: true });
    if (token !== state.loToken) { window.Model3D.destroy(v); return; }
    state.loViewer = v;
    v.charKey = c.key;
    if (document.body.classList.contains('lust')) fight(v);
    box.querySelector('img.render')?.remove();
    hideBand(band);
    const anims = document.getElementById('lo-anims');
    anims.hidden = false;
    anims.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      window.Model3D.play(state.loViewer, b.dataset.anim);
      anims.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    }));
  } catch {
    holder.remove();
    hideBand(band);
  }
}

function gearHtml(it, label) {
  if (!it) return `<div class="gear empty"><span class="ico"></span><span class="txt"><span class="nm">${label}</span><span class="meta">leer</span></span></div>`;
  const q = (it.quality || 'COMMON').toLowerCase();
  const meta = [label, it.ilvl ? `iLvl <span class="num">${it.ilvl}</span>` : null].filter(Boolean).join(' · ');
  const ench = it.enchants?.length ? ` · <span class="en">${esc(it.enchants[0].replace(/^Verzaubert: /, ''))}</span>` : '';
  return link(it, `<div class="gear"><img class="ico b-${q}" src="${esc(it.icon || FALLBACK_ICON)}" alt="" loading="lazy">
    <span class="txt"><span class="nm q-${q}">${esc(it.name)}</span><span class="meta">${meta}${ench}</span></span></div>`);
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
    ${picks || t.calc ? `<div class="talent-list">${picks}${t.calc ? `<a class="tcalc" href="${esc(whDe(t.calc))}" target="_blank" rel="noopener">${t.trees?.length ? 'Rechner der Klasse' : 'Build im Rechner'} ↗</a>` : ''}</div>` : ''}
  </div>`;
}

function talentTreesHtml(c, t, layout) {
  // Gewählte Ränge je Talent: zuerst über die Talent-ID, sonst über den Zauber des Rangs.
  const ranks = new Map();
  const bySpell = new Map(layout.flatMap((tree) => tree.talents.flatMap((x) => x.ranks.map((s, i) => [s, [x.id, i + 1]]))));
  for (const p of t.picks ?? []) {
    const hit = p.id && layout.some((tree) => tree.talents.some((x) => x.id === p.id)) ? [p.id, p.rank] : bySpell.get(p.spell);
    if (hit) ranks.set(hit[0], Math.max(ranks.get(hit[0]) ?? 0, hit[1] ?? 1));
  }
  const domain = state.data.wowhead || 'classic';
  const points = layout.map((tree) => tree.talents.reduce((a, x) => a + (ranks.get(x.id) ?? 0), 0));

  // Rechner-Link mit Build: je Baum die Ränge in Reihenfolge Reihe, Spalte, ohne Nullen am Ende.
  const build = layout.map((tree) => tree.talents.map((x) => ranks.get(x.id) ?? 0).join('').replace(/0+$/, '')).join('-').replace(/-+$/, '');
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
      ${calc ? `<a class="tcalc" href="${esc(calc)}" target="_blank" rel="noopener">Build im Rechner ↗</a>` : ''}
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

function sessionList() {
  return (state.sessions.list ?? []).map((s, i, all) => {
    const from = i ? all[i - 1].end : s.start - 6 * 36e5;
    const items = state.feed.events.filter((e) => e.type === 'item' && e.t > from && e.t <= s.end && s.players.includes(e.key));
    return { ...s, nr: i + 1, items };
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
    return `<button type="button" class="recap-row" data-idx="${x.nr - 1}">
      <span class="recap-row-top"><b>Session ${x.nr}</b><span class="mono">${fmtDay(x.end)}</span></span>
      <span class="mono recap-sum">${x.items.length} Items${aw ? ` · ${aw.title} ${esc(aw.who.map(charName).join(', '))}` : ''}</span>
    </button>`;
  }).join('')}</div>` : '');

  const share = document.getElementById('recap-share');
  share.href = `https://wa.me/?text=${encodeURIComponent(shareText(s, list))}`;
  document.querySelectorAll('#recap .recap-row').forEach((b) => b.addEventListener('click', () => { state.recapIdx = Number(b.dataset.idx); renderRecap(); }));
  countIn(document.getElementById('recap'));
  document.querySelectorAll('#recap img').forEach(imgFallback);
  window.$WowheadPower?.refreshLinks?.();
}

function recapCardHtml(s, list) {
  const stats = Object.values(s.stats ?? {});
  const byQ = Object.entries(QUALITY_NAMES).map(([q, n]) => [s.items.filter((e) => e.quality === q).length, n]).filter(([k]) => k);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const lvlFrom = avg(stats.map((x) => x.level?.[0]).filter(Boolean));
  const prof = stats.reduce((a, x) => a + (x.prof ?? 0), 0);
  const profNames = new Set(state.feed.events.filter((e) => e.type === 'prof' && s.players.includes(e.key) && e.t > s.start - 6 * 36e5 && e.t <= s.end).map((e) => e.name));
  const lvlTo = avg(stats.map((x) => x.level?.[1]).filter(Boolean));
  const end = Math.max(...stats.map((x) => x.logout ?? 0), s.end);

  const tiles = [
    [s.items.length, 'Neue Items', byQ.map(([k, n]) => `${k} ${n}`).join(' · ') || 'keine', 'items'],
    lvlTo ? [`+${Math.round(progress(lvlTo) - progress(lvlFrom ?? lvlTo))} %`, 'Weg bis 60', `jetzt ${Math.round(progress(lvlTo))} % geschafft`] : null,
    [`+${prof}`, 'Berufspunkte', profNames.size ? `${profNames.size} ${profNames.size === 1 ? 'Beruf' : 'Berufe'}` : ''],
    [fmtGain(s.gain), 'Level', lvlTo ? `jetzt Level ${Math.round(lvlTo)}` : ''],
  ].filter(Boolean);

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
    <div class="recap-top"><h3>Session ${s.nr}</h3><span class="mono">${fmtDay(end)} · Schluss ${fmtTime(end)}</span></div>
    <div class="recap-body${loot.length ? '' : ' solo'}"><div class="recap-main">
    <div class="recap-stats">${tiles.map(([v, l, sub, cls]) => `<div class="rstat ${cls ?? ''}"><b>${v}</b><span>${l}</span><small>${esc(sub)}</small></div>`).join('')}</div>
    ${unlocks.length ? `<div class="recap-unlock">${unlocks.map((u) => `<span>${u}</span>`).join('')}</div>` : ''}
    ${aw.length ? `<div class="recap-label">Auszeichnungen</div>
    <div class="awards">${aw.map((a) => `<div class="award"><span class="aw-title">${a.title}</span>
      <b>${a.who.map((k) => `<span style="color:${classColor(charByKey(k))}">${esc(charName(k))}</span>`).join(', ')}</b><small>${esc(a.detail)}</small></div>`).join('')}</div>` : ''}
    </div>${lootHtml}</div>
  </article>`;
}

// Neu in Reichweite: Dungeons, deren Mindestlevel die Gruppe in dieser Session erreicht hat. Dazu Meilensteine.
function recapUnlocks(s) {
  const stats = Object.entries(s.stats ?? {});
  if (!stats.length) return [];
  const lo = (i) => Math.min(...stats.map(([, x]) => x.level?.[i] ?? 0));
  const [from, to] = [lo(0), lo(1)];
  const factions = new Set(state.chars.map((c) => (c.faction === 'HORDE' ? 'H' : 'A')));
  const dungeons = M.DUNGEONS.filter((d) => (d.f === 'N' || factions.has(d.f)) && d.min - 2 > from && d.min - 2 <= to).map((d) => d.name);
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
  add('Loot-Goblin', top((k) => itemsOf(k).length, 2), (v) => `${v} neue Items`);
  add('Berufs-Streber', top((k) => st[k]?.prof, 10), (v) => `+${v} Punkte`);
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

function shareText(s, list) {
  const aw = awards(s, list).slice(0, 3).map((a) => `${a.title}: ${a.who.map(charName).join(', ')}`);
  const url = `${location.origin}${location.pathname}#rueckblick`;
  return [`Session ${s.nr} im Kasten: ${s.items.length} neue Items, ${fmtGain(s.gain)} Level.`, ...aw, url].join('\n');
}

// ---------------------------------------------------------------------------
// Vor dem nächsten Abend: offene Punkte je Charakter aus dem letzten Abend und dem aktuellen Stand.
// Rot sind Klassenquests und Berufe am Limit, die übrigen Punkte sind Routine.

function renderPrep() {
  const last = sessionList().at(-1);
  const el = document.getElementById('vorbereitung');
  const chars = state.chars.filter((c) => c.level);
  const tasks = chars.map((c) => [c, prepTasks(c, last?.stats?.[c.key]?.level)]);
  const total = tasks.reduce((a, [, t]) => a + t.length, 0);
  el.hidden = !last;
  if (!last) return;
  document.getElementById('prep-count').textContent = total ? `${total} offen` : 'alles erledigt';
  document.getElementById('prep').style.setProperty('--n', tasks.length);
  document.getElementById('prep').innerHTML = tasks.map(([c, list]) => `<div class="prep-col" style="--cls:${classColor(c)}">
    <b>${esc(c.name)}</b>
    ${list.length ? list.map(([text, hot]) => `<span class="task${hot ? ' hot' : ''}">${esc(text)}</span>`).join('') : '<span class="task done">nichts offen</span>'}
  </div>`).join('');
}

function prepTasks(c, range) {
  const [from, to] = range ?? [c.level, c.level];
  const crossed = (lv) => from < lv && to >= lv;
  const out = [];
  for (const [lv, text, hot] of M.CLASS_TASKS[c.classId] ?? []) if (crossed(lv)) out.push([text, hot]);
  if (crossed(40)) out.push(['Reiten lernen', true]);
  for (const p of c.professions ?? []) {
    const next = M.PROF_RANKS[p.max];
    if (!next || p.skill < p.max - 25 || c.level < next[1]) continue;
    out.push([`${profName(p.name)}: ${next[0]} lernen`, p.skill >= p.max]);
  }
  // Neue Zauber gibt es in Classic auf geraden Leveln.
  for (let lv = to; lv > from; lv--) if (lv % 2 === 0) { out.push([`Lehrer: Level ${lv}`, false]); break; }
  const free = c.talents?.trees?.length ? Math.max(0, c.level - 9 - c.talents.trees.reduce((a, t) => a + t.points, 0)) : 0;
  if (free) out.push([`${free} ${free === 1 ? 'Talentpunkt' : 'Talentpunkte'} frei`, false]);
  return out.sort((a, b) => b[1] - a[1]);
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

  const lvs = ok.map((c) => c.level);
  const lo = Math.min(...lvs), hi = Math.max(...lvs);
  document.getElementById('route-note').textContent = !classicLevels ? 'AB FOREVER-START · VORSCHAU'
    : !lvs.length ? '' : lo === hi ? `Gruppe LV ${lo}` : `Gruppe LV ${lo} bis ${hi}`;

  const place = (x, range) => `<a class="place" href="${wh('classic', `zone=${x.id}`)}" target="_blank" rel="noopener">
    <i class="fd ${x.f === 'A' ? 'a' : x.f === 'H' ? 'h' : ''}"></i><span class="nm">${esc(x.name)}</span><span class="rg">${range}</span></a>`;
  const who = (list) => (list.length
    ? `<div class="route-who">${list.map((c) => `<span style="--cls:${classColor(c)}">${esc(c.name)} · ${c.level}</span>`).join('')}</div>`
    : '');

  const rows = bands.map(([a, b]) => {
    const zones = M.ZONES.filter((z) => allowed(z) && z.min >= a - 5 && z.min < b && z.max > a);
    const dungeons = M.DUNGEONS.filter((d) => allowed(d) && d.min >= a && d.min < b);
    const here = classicLevels ? ok.filter((c) => inBand(c, a, b)) : [];
    return `<div class="route-row ${here.length ? 'now' : ''}">
      <span class="lv">${a}-${b}</span>
      <div class="place-list" data-label="Zonen">${zones.map((z) => place(z, `${z.min}-${z.max}`)).join('')}</div>
      <div class="place-list single" data-label="Dungeons">${dungeons.length ? dungeons.map((d) => place(d, `${d.min}-${d.max}`)).join('') : '<span class="none">keine</span>'}</div>
      ${who(here)}
    </div>`;
  });
  const at60 = classicLevels ? ok.filter((c) => c.level >= 60) : [];
  rows.push(`<div class="route-row ${at60.length ? 'now' : ''}">
    <span class="lv">60</span>
    <div class="place-list" data-label="Raids">${M.RAIDS.map((r) => place({ ...r, f: 'N' }, `${r.size} Sp.`)).join('')}</div>
    <span class="none route-raids">Raids</span>
    ${who(at60)}
  </div>`);

  let tip = '';
  if (classicLevels && ok.length) {
    // Nächster Ort: Dungeons für alle, sonst Zonen für alle. Die Leiste nutzt die ganze Breite.
    const forAll = (x) => allowed(x) && ok.every((c) => c.level >= x.min - 2 && c.level <= x.max);
    const dungeons = M.DUNGEONS.filter(forAll);
    const fits = dungeons.length ? dungeons : M.ZONES.filter(forAll);
    tip = `<div class="route-next">
      <small>Nächster Ort</small>
      <div class="next-list">${fits.length ? fits.map((x) => place(x, `${x.min}-${x.max}`)).join('') : '<span class="none">kein Ort für alle, der Abstand ist zu groß</span>'}</div>
      <span class="next-note">${fits.length ? `${dungeons.length ? 'Dungeon' : 'Zone'} · passt für alle ${ok.length}` : ''}</span>
    </div>`;
  }
  // Eingeklappt zeigt die Route nur die Stufen der Gruppe und die nächste Stufe.
  const now = rows.map((r, i) => (r.includes('route-row now') ? i : -1)).filter((i) => i >= 0);
  const [from, to] = now.length ? [now[0], Math.min(rows.length - 1, now.at(-1) + 1)] : [0, rows.length - 1];
  const hidden = rows.length - (to - from + 1);
  const visible = state.routeAll ? rows : rows.slice(from, to + 1);
  const el = document.getElementById('route');
  el.innerHTML = `${tip}
    <div class="route">
      <div class="route-head"><span>Level</span><span>Zonen</span><span>Dungeons</span><span>Hier</span></div>
      ${visible.join('')}
    </div>
    ${hidden ? `<button type="button" class="chip-btn route-more">${state.routeAll ? 'Nur aktuelle Stufen zeigen' : `Ganze Route zeigen · ${hidden} weitere Stufen`}</button>` : ''}`;
  el.querySelector('.route-more')?.addEventListener('click', () => { state.routeAll = !state.routeAll; renderRoute(); });
}

// ---------------------------------------------------------------------------
// Aktivität: Level-Ups, neue Items, Berufe, Gilde und gemeinsame Sessions, neueste zuerst

function renderFeed() {
  // Grüne Items zählen nur in „Letzte Session“.
  const events = state.feed.events.filter((e) => !(e.type === 'item' && e.quality === 'UNCOMMON')).sort((a, b) => b.t - a.t);
  document.getElementById('aktivitaet').hidden = !events.length;
  document.getElementById('nav-aktivitaet').hidden = !events.length;
  if (!events.length) return;

  // Gezeigt wird der neueste Tag, ältere Tage kommen per Knopf dazu.
  const days = new Map();
  for (const e of events) {
    const day = new Date(e.t).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(e);
  }
  const shown = [...days].slice(0, state.feedDays);
  const rest = days.size - shown.length;
  const week = events.filter((e) => e.type === 'level' && Date.now() - e.t < 7 * 864e5).reduce((n, e) => n + (e.to - e.from), 0);
  document.getElementById('feed-note').textContent = week ? `${week} LEVEL IN 7 TAGEN` : `${events.length} EREIGNISSE`;

  const el = document.getElementById('feed');
  el.innerHTML = shown.map(([day, list]) => `<div class="feed-day"><h3>${day}<span>${list.length} Ereignisse</span></h3><ul>${list.map(feedItemHtml).join('')}</ul></div>`).join('')
    + (rest ? `<button type="button" class="chip-btn feed-more">Vorherigen Tag zeigen · noch ${rest}</button>` : '');
  el.querySelectorAll('img').forEach(imgFallback);
  el.querySelector('.feed-more')?.addEventListener('click', () => { state.feedDays++; renderFeed(); });
  window.$WowheadPower?.refreshLinks?.();
}

// Spiel-Icons für die Aktivität. Level-Ups tragen die neue Stufe als Badge.
const FEED_ICONS = {
  level: 'spell_holy_surgeoflight', max: 'achievement_level_60', session: 'inv_misc_groupneedmore', guild: 'inv_shirt_guildtabard_01',
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
  const name = (key) => esc(state.data.characters.find((x) => x.key === key)?.name ?? key.split('/').pop());
  const who = c ? `<b class="who" style="--cls:${classColor(c)}">${esc(c.name)}</b>` : e.key ? `<b class="who">${name(e.key)}</b>` : '';
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
    case 'guild':
      return row('ev-guild', feedIcon(FEED_ICONS.guild), e.guild ? `tritt <strong>&lt;${esc(e.guild)}&gt;</strong> bei` : `verlässt <strong>&lt;${esc(e.from ?? '')}&gt;</strong>`);
    case 'session': {
      const hours = e.start ? Math.max(0, (e.t - e.start) / 36e5) : null;
      const players = (e.players ?? []).map((k) => charByKey(k).name ?? k.split('/').pop());
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
function charName(k) { return charByKey(k).name ?? k.split('/').pop(); }
// Die Gruppe levelt gemeinsam, der Zuwachs zählt darum in ganzen Leveln.
function fmtGain(n) { const r = Math.round(n ?? 0); return `${r > 0 ? '+' : ''}${r}`; }
function fmtDay(t) { return new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }); }
function fmtTime(t) { return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
function classColor(c) { return M.CLASSES[c.classId]?.color ?? '#c9c2b3'; }
function profName(n) { return M.PROFESSIONS[n] ?? n; }
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

// Wowhead auf Deutsch: Classic unter /classic/de/, Retail unter /de/. Die Tooltips folgen der Sprache des Links.
function wh(env, path) { return `https://www.wowhead.com/${env ? `${env}/` : ''}de/${path}`; }
function whDe(url) { return url.replace(/^(https:\/\/www\.wowhead\.com\/(?:classic\/)?)(?!de\/)/, '$1de/'); }

function imgFallback(img) {
  img.addEventListener('error', () => { if (img.classList.contains('ico')) img.src = FALLBACK_ICON; else img.remove(); }, { once: true });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

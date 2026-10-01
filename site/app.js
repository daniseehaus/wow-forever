const CLASS_COLORS = {
  1: '#C69B6D', 2: '#F48CBA', 3: '#AAD372', 4: '#FFF468', 5: '#FFFFFF', 6: '#C41E3A',
  7: '#0070DD', 8: '#3FC7EB', 9: '#8788EE', 10: '#00FF98', 11: '#FF7C0A', 12: '#A330C9', 13: '#33937F',
};

// Reihenfolge wie im Charakterfenster: links, rechts, unten.
const SLOTS = [
  ['HEAD', 'Kopf'], ['NECK', 'Hals'], ['SHOULDER', 'Schultern'], ['BACK', 'Rücken'],
  ['CHEST', 'Brust'], ['SHIRT', 'Hemd'], ['TABARD', 'Wappenrock'], ['WRIST', 'Handgelenke'],
  ['HANDS', 'Hände'], ['WAIST', 'Taille'], ['LEGS', 'Beine'], ['FEET', 'Füße'],
  ['FINGER_1', 'Finger 1'], ['FINGER_2', 'Finger 2'], ['TRINKET_1', 'Schmuck 1'], ['TRINKET_2', 'Schmuck 2'],
  ['MAIN_HAND', 'Waffenhand'], ['OFF_HAND', 'Schildhand'], ['RANGED', 'Distanz'],
];
const MATRIX_SLOTS = SLOTS.filter(([s]) => s !== 'SHIRT' && s !== 'TABARD');
const FALLBACK_ICON = 'https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg';

const state = { data: null, view: 'cards', sort: 'level', open: new Set() };

try {
  state.view = localStorage.getItem('view') || state.view;
  state.sort = localStorage.getItem('sort') || state.sort;
} catch {}

init();

async function init() {
  document.querySelectorAll('.seg button').forEach((b) =>
    b.addEventListener('click', () => { state.view = b.dataset.view; save('view', state.view); render(); }));
  const sort = document.getElementById('sort');
  sort.value = state.sort;
  sort.addEventListener('change', () => { state.sort = sort.value; save('sort', state.sort); render(); });

  try {
    const res = await fetch(`data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    document.getElementById('meta').textContent = `Daten konnten nicht geladen werden (${err.message}).`;
    return;
  }

  const { title, generatedAt } = state.data;
  if (title) { document.getElementById('title').textContent = title; document.title = title; }
  document.getElementById('meta').textContent =
    `Stand: ${new Date(generatedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} Uhr`;
  render();
}

function render() {
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const chars = sorted(state.data.characters);
  renderStats(chars);
  const view = document.getElementById('view');
  view.innerHTML = state.view === 'matrix' ? matrixHtml(chars) : `<div class="cards">${chars.map(cardHtml).join('')}</div>`;

  view.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.toggle;
    state.open.has(k) ? state.open.delete(k) : state.open.add(k);
    render();
  }));
  view.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => { img.src = FALLBACK_ICON; }, { once: true }));
  window.$WowheadPower?.refreshLinks?.();
}

function renderStats(chars) {
  const ok = chars.filter((c) => c.level);
  const avg = (f) => ok.length ? ok.reduce((s, c) => s + (f(c) || 0), 0) / ok.length : 0;
  const cap = state.data.maxLevel || 60;
  const max = ok.filter((c) => c.level >= cap).length;
  document.getElementById('stats').innerHTML = [
    ['Charaktere', chars.length],
    ['Ø Level', avg((c) => c.level).toFixed(1)],
    [`Auf Level ${cap}`, max],
    ['Ø Itemlevel', avg((c) => c.equippedIlvl).toFixed(1)],
  ].map(([l, v]) => `<div class="stat"><span>${l}</span><strong>${v}</strong></div>`).join('');
}

function sorted(chars) {
  const by = {
    level: (a, b) => (b.level ?? 0) - (a.level ?? 0) || (b.equippedIlvl ?? 0) - (a.equippedIlvl ?? 0),
    ilvl: (a, b) => (b.equippedIlvl ?? 0) - (a.equippedIlvl ?? 0),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    class: (a, b) => (a.className ?? '').localeCompare(b.className ?? '', 'de') || (b.level ?? 0) - (a.level ?? 0),
  }[state.sort];
  return [...chars].sort(by);
}

function cardHtml(c) {
  const color = CLASS_COLORS[c.classId] || '#c9c2b3';
  const open = state.open.has(c.key);
  const items = new Map((c.items || []).map((i) => [i.slot, i]));

  if (!c.level) {
    return `<article class="card error"><div class="head"><div class="avatar">?</div>
      <div><h2>${esc(c.name)}</h2><p class="sub">${esc(c.realmName || '')}</p></div></div>
      <p class="warn">${esc(c.error || 'Keine Daten')}</p></article>`;
  }

  return `<article class="card ${open ? 'open' : ''}" style="--cls:${color}">
    <button class="head" data-toggle="${esc(c.key)}" aria-expanded="${open}">
      ${c.avatar ? `<img class="avatar" src="${esc(c.avatar)}" alt="">` : `<div class="avatar">${esc(c.name[0])}</div>`}
      <div class="who">
        <h2>${esc(c.name)}</h2>
        <p class="sub">${esc(c.race || '')} ${esc(c.className || '')}${c.guild ? ` · &lt;${esc(c.guild)}&gt;` : ''}</p>
      </div>
      <div class="lvl"><strong>${c.level}</strong><span>Level</span></div>
    </button>
    <div class="facts">
      <span>Itemlevel <b>${fmt(c.equippedIlvl)}</b></span>
      <span>${esc(c.realmName || '')}</span>
      <span>${c.lastLogin ? ago(c.lastLogin) : ''}</span>
    </div>
    ${c.stale ? `<p class="warn">Alter Stand, letzter Abruf fehlgeschlagen.</p>` : ''}
    <div class="strip">${MATRIX_SLOTS.map(([s, l]) => iconHtml(items.get(s), l, 'sm')).join('')}</div>
    ${open ? `<ul class="gear">${SLOTS.filter(([s]) => items.has(s)).map(([s, l]) => gearRow(items.get(s), l)).join('')}</ul>` : ''}
  </article>`;
}

function gearRow(it, label) {
  return `<li>${iconHtml(it, label, 'md')}
    <div><span class="slot">${label}</span>
    ${link(it, `<span class="q-${(it.quality || 'COMMON').toLowerCase()}">${esc(it.name)}</span>`)}
    ${it.enchants?.length ? `<span class="ench">${it.enchants.map(esc).join(', ')}</span>` : ''}</div>
    ${it.ilvl ? `<span class="il">${it.ilvl}</span>` : ''}</li>`;
}

function matrixHtml(chars) {
  const rows = chars.filter((c) => c.level).map((c) => {
    const items = new Map((c.items || []).map((i) => [i.slot, i]));
    return `<tr><th style="color:${CLASS_COLORS[c.classId] || 'inherit'}">${esc(c.name)}<small>${c.level} · ${esc(c.className || '')}</small></th>
      ${MATRIX_SLOTS.map(([s, l]) => `<td>${iconHtml(items.get(s), l, 'md')}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="matrix"><table><thead><tr><th></th>${MATRIX_SLOTS.map(([, l]) => `<th><span>${l}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function iconHtml(it, label, size) {
  if (!it) return `<span class="ico ${size} empty" title="${label}: leer"></span>`;
  const img = `<img class="ico ${size} b-${(it.quality || 'COMMON').toLowerCase()}" src="${esc(it.icon || FALLBACK_ICON)}" alt="${esc(it.name)}" title="${esc(it.name)}" loading="lazy">`;
  return link(it, img);
}

function link(it, inner) {
  if (!it.id) return inner;
  // Leerer Wert bedeutet Retail, dort hat Wowhead kein Pfadpräfix.
  const domain = state.data.wowhead ?? 'classic';
  return `<a href="https://www.wowhead.com${domain ? `/${domain}` : ''}/item=${it.id}" target="_blank" rel="noopener">${inner}</a>`;
}

function ago(ts) {
  const h = (Date.now() - ts) / 36e5;
  if (h < 1) return 'gerade online';
  if (h < 24) return `vor ${Math.round(h)} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

function fmt(n) { return n == null ? '?' : Math.round(n); }
function save(k, v) { try { localStorage.setItem(k, v); } catch {} }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

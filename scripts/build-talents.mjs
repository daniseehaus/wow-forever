// Baut site/talents.json: die Classic-Talentbäume aller Klassen mit Position, Rängen und Icons.
// Die API liefert nur die gewählten Talente, nicht ihre Position im Baum. Die Daten ändern sich in Classic nicht,
// das Skript läuft deshalb nur bei Bedarf (npm run build-talents) und die Datei liegt im Repo.
// Quellen: Talent und TalentTab aus den Spieldaten (wago.tools), deutsche Namen und Icons aus den Wowhead-Tooltips.

import { writeFile } from 'node:fs/promises';

const BUILD = process.argv[2] ?? '1.15.9.70003';
const OUT = new URL('../site/talents.json', import.meta.url);

async function csv(table, locale = '') {
  const res = await fetch(`https://wago.tools/db2/${table}/csv?build=${BUILD}${locale ? `&locale=${locale}` : ''}`);
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  const [head, ...rows] = parseCsv(await res.text());
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function tooltip(spell) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://nether.wowhead.com/classic/tooltip/spell/${spell}?locale=3`);
      if (res.ok) {
        const j = await res.json();
        return { name: j.name ?? null, icon: j.icon ?? null };
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return { name: null, icon: null };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const tabs = await csv('TalentTab', 'deDE');
const talents = await csv('Talent');
const n = (v) => Number(v) || 0;
// Einige deutsche Baumnamen sind in den Spieldaten gekürzt.
const TREE_NAMES = { 'Verstärk': 'Verstärkung', 'Wiederherst': 'Wiederherstellung' };

const tips = new Map();
const firstRanks = [...new Set(talents.map((t) => n(t.SpellRank_0)).filter(Boolean))];
const results = await pool(firstRanks, 8, tooltip);
firstRanks.forEach((s, i) => tips.set(s, results[i]));

const classes = {};
for (const tab of tabs) {
  const mask = n(tab.ClassMask);
  if (!mask) continue;
  const classId = Math.log2(mask) + 1;
  const list = talents
    .filter((t) => n(t.TabID) === n(tab.ID))
    .map((t) => {
      const ranks = Array.from({ length: 9 }, (_, i) => n(t[`SpellRank_${i}`])).filter(Boolean);
      const tip = tips.get(ranks[0]) ?? {};
      const req = n(t.PrereqTalent_0);
      return { id: n(t.ID), tier: n(t.TierID), col: n(t.ColumnIndex), ranks, name: tip.name, icon: tip.icon, ...(req ? { req } : {}) };
    })
    .sort((a, b) => a.tier - b.tier || a.col - b.col);
  (classes[classId] ??= []).push({ id: n(tab.ID), order: n(tab.OrderIndex), name: TREE_NAMES[tab.Name_lang] ?? tab.Name_lang, bg: tab.BackgroundFile, talents: list });
}
for (const trees of Object.values(classes)) trees.sort((a, b) => a.order - b.order).forEach((t) => delete t.order);

const missing = talents.filter((t) => !tips.get(n(t.SpellRank_0))?.icon).length;
await writeFile(OUT, `${JSON.stringify({ build: BUILD, classes })}\n`);
console.log(`talents.json: ${Object.keys(classes).length} Klassen, ${talents.length} Talente, ${missing} ohne Icon`);

// Baut site/talents.json: die Forever-Talentbäume aller Klassen mit Position, Rängen und Icons.
// Die Charakter-API liefert nur die gewählten Talente, nicht ihre Position im Baum. Die Bäume ändern sich nur mit einem Patch,
// das Skript läuft deshalb nur bei Bedarf (npm run build-talents) und die Datei liegt im Repo.
//
// Quelle: Battle.net API im Namespace static-forever-eu (talent-tree je Klasse und Spezialisierung).
// Forever hat eigene Bäume: neue, geänderte und verschobene Talente gegenüber Classic. Die Talent-IDs passen zur Charakter-API.
// Namen kommen deutsch aus der API, Icons aus den Wowhead-Tooltips von Forever.
// Braucht BLIZZARD_CLIENT_ID und BLIZZARD_CLIENT_SECRET (.env).
//
// Position: Die API nennt je Talent Reihe und Spalte im gemeinsamen Raster aller drei Bäume (Spalte 1 bis 4, 7 bis 10, 14 bis 17)
// und die Lage in Pixeln. Einzelne Einträge sind fehlerhaft (z. B. Reihe 63), siehe position().

import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

const OUT = new URL('../site/talents.json', import.meta.url);
const NS = 'static-forever-eu';
// Erste Spalte und linke Kante je Baum, Abstand zwischen zwei Talenten in Pixeln.
const COL0 = [1, 7, 14];
const X0 = [1020, 5020, 9080];
const Y0 = 2130;
const STEP = 600;

loadDotEnv(new URL('../.env', import.meta.url));
const api = await connect();

const index = await api('/data/wow/talent-tree/index');
const classes = {};
let warnings = 0;
for (const ct of index.class_talent_trees ?? []) {
  const classTree = await api(path(ct.key.href));
  const specs = [];
  for (const st of classTree.spec_talent_trees ?? []) specs.push(await api(path(st.key.href)));
  // Links nach rechts: der Baum mit der kleinsten Spalte zuerst, wie im Spiel.
  specs.sort((a, b) => minCol(a) - minCol(b));
  const classId = specs[0]?.playable_class?.id;
  if (!classId) continue;
  classes[classId] = specs.map((spec, i) => {
    const byNode = new Map(spec.spec_talent_nodes.map((n) => [n.id, n.ranks?.[0]?.tooltip?.talent?.id]));
    const talents = spec.spec_talent_nodes.map((n) => {
      const first = n.ranks?.[0]?.tooltip ?? {};
      const [tier, col] = position(n, i);
      if (tier == null) { warnings++; console.warn(`Position unklar: ${spec.name} ${first.talent?.name} (Reihe ${n.display_row}, Spalte ${n.display_col})`); }
      const req = byNode.get(n.locked_by?.[0]);
      return {
        id: first.talent?.id ?? null,
        tier, col,
        ranks: (n.ranks ?? []).map((r) => r.tooltip?.spell_tooltip?.spell?.id).filter(Boolean),
        name: first.talent?.name ?? first.spell_tooltip?.spell?.name ?? null,
        ...(req ? { req } : {}),
      };
    }).filter((t) => t.id && t.tier != null);
    check(spec.name, talents);
    return { id: spec.id, name: spec.name, talents: talents.sort((a, b) => a.tier - b.tier || a.col - b.col) };
  });
}

// Icons und fehlende Namen aus den Wowhead-Tooltips von Forever.
const all = Object.values(classes).flat().flatMap((tree) => tree.talents);
await pool(all, 8, async (t) => {
  const tip = await tooltip(t.ranks[0]);
  t.icon = tip.icon;
  t.name ??= tip.name;
});

const missing = all.filter((t) => !t.icon).length;
await writeFile(OUT, `${JSON.stringify({ build: 'forever', source: `Battle.net API ${NS}`, created: new Date().toISOString().slice(0, 10), classes })}\n`);
console.log(`talents.json: ${Object.keys(classes).length} Klassen, ${all.length} Talente, ${missing} ohne Icon, ${warnings} ohne Position`);

// ---------------------------------------------------------------------------

// Prüft den Baum. Eine Voraussetzung steht über dem Talent oder in derselben Reihe daneben.
// Die API nennt manche Paare gegenseitig als Voraussetzung (z. B. Gleichgewicht: Erhabenheit der Natur und Pracht der Natur).
// Dann gilt nur die Richtung von oben nach unten, die andere fällt weg. Zwei Talente im selben Feld meldet das Skript.
function check(specName, talents) {
  const byId = new Map(talents.map((t) => [t.id, t]));
  const cells = new Map();
  for (const t of talents) {
    if (t.tier == null) continue;
    const cell = `${t.tier}/${t.col}`;
    if (cells.has(cell)) { warnings++; console.warn(`Gleiches Feld: ${specName} ${t.name} und ${cells.get(cell)}`); }
    cells.set(cell, t.name);
    const req = byId.get(t.req);
    if (req && req.tier > t.tier) {
      console.warn(`Voraussetzung unter dem Talent entfernt: ${specName} ${t.name} (braucht ${req.name})`);
      delete t.req;
    }
  }
}

function minCol(spec) {
  const cols = spec.spec_talent_nodes.map((n) => n.display_col).sort((a, b) => a - b);
  return cols[Math.floor(cols.length / 2)];
}

// Reihe 0 bis 6 und Spalte 0 bis 3 im Baum. Je Achse gilt der erste gültige Wert: Raster der API, Lage in Pixeln,
// Lage in Pixeln geteilt durch 10 (manche Werte sind zehnfach zu groß). Ohne gültigen Wert fällt das Talent weg
// (in 1.60.1 nur ein doppelter Eintrag „Heiligspezialisierung“ ohne Platz im Baum).
function position(n, i) {
  const pick = (list, max) => list.map(Math.round).find((v) => v >= 0 && v <= max) ?? null;
  const row = pick([n.display_row - 1, (n.raw_position_y - Y0) / STEP, (n.raw_position_y / 10 - Y0) / STEP], 6);
  const col = pick([n.display_col - COL0[i], (n.raw_position_x - X0[i]) / STEP, (n.raw_position_x / 10 - X0[i]) / STEP], 3);
  return row == null || col == null ? [null, null] : [row, col];
}

async function tooltip(spell) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://nether.wowhead.com/forever/tooltip/spell/${spell}?locale=3`);
      if (res.ok) {
        const j = await res.json();
        return { name: j.name ?? null, icon: j.icon ?? null };
      }
      if (res.status === 404) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  // Ohne Wowhead: Icon aus Blizzards Spell-Media (Dateiname ohne Endung).
  const media = await api(`/data/wow/media/spell/${spell}`).catch(() => null);
  const url = media?.assets?.find((x) => x.key === 'icon')?.value;
  return { name: null, icon: url ? url.split('/').pop().replace(/\.jpg$/, '') : null };
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// Pfad ohne Host und Namespace aus einem API-Link.
function path(href) { return new URL(href).pathname; }

async function connect() {
  const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('BLIZZARD_CLIENT_ID und BLIZZARD_CLIENT_SECRET fehlen (.env).');
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token-Abruf fehlgeschlagen: HTTP ${res.status}`);
  const token = (await res.json()).access_token;
  return async (p) => {
    const r = await fetch(`https://eu.api.blizzard.com${p}?namespace=${NS}&locale=de_DE`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status} bei ${p}`);
    return r.json();
  };
}

function loadDotEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Vorschau bis zum Start: echte Retail-Charaktere als Classic-Charaktere darstellen.
// Name, Klasse, Volk, Gilde, Aussehen und Ausrüstung bleiben echt. Level, Talente, Berufe, Werte und Itemlevel sind simuliert.
// Dazu kommt ein Showcase-Verlauf für Aktivität und Sessions, damit die Seite wie nach zwei Wochen Forever aussieht.
// Alle Werte hängen nur vom Namen und vom Tag ab, damit sie von Abruf zu Abruf gleich bleiben.

import { readFileSync } from 'node:fs';

const CLASSIC_PROFESSIONS = new Set(['Alchemy', 'Blacksmithing', 'Enchanting', 'Engineering', 'Herbalism', 'Leatherworking', 'Mining', 'Skinning', 'Tailoring', 'Cooking', 'Fishing', 'First Aid']);
const CLASSIC_ARMOR = { 1: 1100, 2: 1000, 3: 450, 4: 450, 5: 180, 7: 450, 8: 180, 9: 180, 11: 400 };
const QUALITY_DOWN = { LEGENDARY: 'EPIC', ARTIFACT: 'EPIC', HEIRLOOM: 'RARE', EPIC: 'RARE', RARE: 'UNCOMMON' };
const QUALITY_ILVL = { POOR: -6, COMMON: -3, UNCOMMON: 2, RARE: 5, EPIC: 10 };
const CLASS_SLUGS = { 1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue', 5: 'priest', 7: 'shaman', 8: 'mage', 9: 'warlock', 11: 'druid' };

// Leveling-Builds je Baum: Talent und Zielrang in der Reihenfolge, in der Spieler sie in Classic nehmen.
// Bäume ohne eigenen Build füllt die Seite von oben nach unten.
const BUILDS = {
  'Frost': [
    ['Verbesserter Frostblitz', 5], ['Eissplitter', 5], ['Stechendes Eis', 3], ['Kälteeinbruch', 1], ['Verbesserter Blizzard', 1],
    ['Frost-Kanalisierung', 3], ['Elementare Präzision', 2], ['Eisblock', 1], ['Verbesserter Kältekegel', 1], ['Elementare Präzision', 3],
    ['Erfrierung', 2], ['Winterkälte', 5], ['Eisbarriere', 1],
  ],
  'Schatten': [
    ['Willensentzug', 5], ['Verbessertes Schattenwort: Schmerz', 2], ['Schattenfokus', 3], ['Gedankenschinden', 1],
    ['Verbesserter Gedankenschlag', 5], ['Schattenfokus', 5], ['Schattenwirken', 2], ['Vampirumarmung', 1], ['Schattenwirken', 5],
    ['Verbesserte Vampirumarmung', 1], ['Dunkelheit', 5], ['Schattengestalt', 1],
  ],
  'Verstärkung': [
    ['Wissen der Ahnen', 5], ['Donnernde Stöße', 5], ['Verbesserter Geisterwolf', 2], ['Zweihandäxte und -Streitkolben', 1],
    ['Stärkungstotems', 2], ['Schlaghagel', 5], ['Elementarwaffen', 3], ['Vorahnung', 2], ['Waffenbeherrschung', 5], ['Sturmschlag', 1],
  ],
  'Treffsicherheit': [
    ['Effizienz', 5], ['Tödliche Schüsse', 5], ['Gezielter Schuss', 1], ['Verbesserter arkaner Schuss', 4], ['Todbringende Schüsse', 5],
    ['Streuschuss', 1], ['Verbesserter arkaner Schuss', 5], ['Sperrfeuer', 3], ['Distanzwaffen-Spezialisierung', 5], ['Aura des Volltreffers', 1],
  ],
  // Schutz des Kriegers. Der Paladin hat ebenfalls einen Baum Schutz, darum mit Klasse.
  '1:Schutz': [
    ['Schild-Spezialisierung', 5], ['Zähigkeit', 5], ['Verbesserte Rache', 3], ['Verbesserter Blutrausch', 2], ['Letztes Gefecht', 1],
    ['Trotz', 5], ['Verbesserter Schildblock', 3], ['Erschütternder Schlag', 1], ['Einhandwaffen-Spezialisierung', 5], ['Schildschlag', 1],
  ],
};

export function simulateClassic(data, opts, classicRole) {
  const layout = JSON.parse(readFileSync(new URL('../site/talents.json', import.meta.url), 'utf8')).classes;
  const [lo, hi] = opts.levels ?? [25, 27];
  const characters = data.characters.map((c) => (c.error || c.simulated ? c : simulateChar(c, layout, lo, hi, classicRole)));
  const showcase = buildShowcase(characters, Date.parse(data.generatedAt) || Date.now());
  // Letzter Login: Ende des letzten Showcase-Abends, je Charakter ein paar Minuten versetzt.
  const withLogin = characters.map((c) => (c.simulated ? { ...c, lastLogin: showcase.lastLogin + seeded(c.name)(40, 3) * 60e3 } : c));
  return { data: { ...data, simulated: true, characters: withLogin }, showcase };
}

function seeded(name) {
  const seed = [...name.toLowerCase()].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return (n, salt = 0) => (((seed >>> salt) ^ Math.imul(seed, salt + 3)) >>> 0) % n;
}

function simulateChar(c, layout, lo, hi, classicRole) {
  const rand = seeded(c.name);
  const level = lo + rand(hi - lo + 1, 5);
  const trees = layout[c.classId] ?? [];

  // Alle Punkte in den Baum der Retail-Spezialisierung, sonst in einen festen Baum je Name.
  const own = trees.findIndex((t) => t.name === c.spec);
  const main = own > -1 ? own : rand(trees.length || 1, 4);
  const { picks, points } = spendTalents(trees, main, level - 9, BUILDS[`${c.classId}:${trees[main]?.name}`] ?? BUILDS[trees[main]?.name] ?? []);
  const spec = trees[main]?.name ?? null;

  const items = (c.items ?? []).map((it) => {
    const quality = QUALITY_DOWN[it.quality] ?? it.quality;
    return { ...it, quality, ilvl: Math.max(1, level + (QUALITY_ILVL[quality] ?? 0)), enchants: [], sockets: 0, set: null };
  });
  const ilvl = items.length ? Math.round(items.reduce((a, it) => a + it.ilvl, 0) / items.length) : level;

  const s = c.stats ?? {};
  const mains = ['strength', 'agility', 'intellect'];
  const top = Math.max(1, ...mains.map((k) => s[k] ?? 0));
  const stamina = Math.round(level * 2.4 + 15 + rand(10, 8));
  const rage = c.classId === 1, energy = c.classId === 4;

  return {
    ...c,
    simulated: true,
    level,
    title: null,
    spec,
    role: classicRole(c.classId, spec),
    avgIlvl: ilvl,
    equippedIlvl: ilvl,
    items,
    professions: (c.professions ?? []).filter((p) => CLASSIC_PROFESSIONS.has(p.name)).map((p) => ({
      ...p, skill: Math.max(1, Math.round(((p.skill ?? 0) / (p.max || 100)) * 150)), max: 150,
    })),
    stats: {
      health: level * 18 + stamina * 10,
      power: rage || energy ? 100 : level * 25 + 100,
      powerType: rage ? 'Wut' : energy ? 'Energie' : 'Mana',
      ...Object.fromEntries(mains.map((k) => [k, Math.round(((s[k] ?? 0) / top) * (level * 1.8 + 20))])),
      stamina,
      armor: Math.round(((CLASSIC_ARMOR[c.classId] ?? 300) * level) / 26),
      crit: 4 + rand(30, 12) / 10,
      haste: null, mastery: null, versatility: null,
    },
    talents: {
      trees: points, hero: null, picks, total: level - 9,
      calc: CLASS_SLUGS[c.classId] ? `https://www.wowhead.com/classic/talent-calc/${CLASS_SLUGS[c.classId]}` : null,
    },
  };
}

// Verteilt die Punkte im Hauptbaum nach dem Build. Reihen (5 Punkte je Reihe) und Voraussetzungen gelten wie im Spiel.
// Was der Build nicht abdeckt, füllt der Baum von oben nach unten auf.
function spendTalents(trees, main, total, build) {
  const tree = trees[main];
  if (!tree) return { picks: [], points: [] };
  const ranks = new Map();
  let left = total, spent = 0;
  const add = (t, target) => {
    const have = ranks.get(t.id) ?? 0;
    const req = tree.talents.find((x) => x.id === t.req);
    if (!left || t.tier * 5 > spent || target <= have || (req && ranks.get(req.id) !== req.ranks.length)) return;
    const step = Math.min(target, t.ranks.length) - have;
    const n = Math.min(step, left);
    ranks.set(t.id, have + n);
    left -= n;
    spent += n;
  };
  for (const [name, target] of build) {
    const t = tree.talents.find((x) => x.name === name);
    if (t) add(t, target);
  }
  for (const t of tree.talents) add(t, t.ranks.length);

  const picks = tree.talents.filter((t) => ranks.has(t.id)).map((t) => {
    const rank = ranks.get(t.id);
    return { id: t.id, name: t.name, spell: t.ranks[rank - 1], rank, tree: tree.name };
  });
  return { picks, points: trees.map((t, i) => ({ name: t.name, points: i === main ? spent : 0 })) };
}

// Showcase: sieben gemeinsame Abende in den letzten zwei Wochen, jeweils 19 bis 23:30 Uhr deutscher Zeit.
// Jeder Charakter steigt dabei von Level 1 auf sein simuliertes Level. Dazu kommen Items, Berufe und die Sessions selbst.
// Die Zeiten hängen am Tag des Abrufs, nicht an der Stunde. So bleibt der Verlauf einen Tag lang gleich.
function buildShowcase(characters, now) {
  const H = 3600 * 1000;
  const today = Math.floor(now / (24 * H)) * 24 * H;
  const nights = [13, 11, 9, 7, 5, 3, 1].map((d) => ({ start: today - d * 24 * H + 17 * H, end: today - d * 24 * H + 21.5 * H }));
  const chars = characters.filter((c) => c.simulated && c.level);
  const events = [];
  const sessions = [];
  const levelAt = (c, i) => (i < 0 ? 1 : Math.round(1 + (c.level - 1) * ((i + 1) / nights.length) ** 0.8));

  nights.forEach((night, i) => {
    const gains = [];
    for (const c of chars) {
      const rand = seeded(`${c.name}${i}`);
      const at = (frac) => Math.round(night.start + frac * (night.end - night.start) + rand(20, 2) * 60e3);
      const from = levelAt(c, i - 1), to = levelAt(c, i);
      gains.push(to - from);
      // Je Abend zwei Level-Meldungen, wie sie der stündliche Abruf liefern würde.
      const mid = Math.round((from + to) / 2);
      if (mid > from) events.push({ t: at(0.4), key: c.key, type: 'level', from, to: mid, max: false });
      if (to > mid) events.push({ t: at(0.9), key: c.key, type: 'level', from: mid, to, max: false });

      if (i === 0) for (const p of c.professions ?? []) events.push({ t: at(0.2), key: c.key, type: 'prof', name: p.name, skill: 1, learned: true });
      for (const p of c.professions ?? []) {
        if (i === 3 && p.skill >= 75) events.push({ t: at(0.6), key: c.key, type: 'prof', name: p.name, skill: 75 });
        if (i === nights.length - 1 && p.skill >= p.max) events.push({ t: at(0.7), key: c.key, type: 'prof', name: p.name, skill: p.max });
      }
    }
    sessions.push({ start: night.start, end: night.end, gain: gains.reduce((a, b) => a + b, 0) / Math.max(1, gains.length), players: chars.map((c) => c.key) });
    events.push({ t: night.end + 15 * 60e3, type: 'session', start: night.start, gain: sessions.at(-1).gain, players: chars.map((c) => c.key) });
  });

  // Bis zu drei gute Items je Charakter, verteilt auf die zweite Hälfte der Abende.
  for (const c of chars) {
    const rand = seeded(c.name);
    const good = (c.items ?? []).filter((it) => it.id && ['RARE', 'EPIC'].includes(it.quality)).slice(0, 3);
    good.forEach((it, k) => {
      const night = nights[3 + ((rand(3, k + 1) + k) % 4)];
      events.push({ t: night.start + (0.3 + 0.2 * k) * (night.end - night.start), key: c.key, type: 'item', id: it.id, name: it.name, quality: it.quality, icon: it.icon, slot: it.slotName ?? it.slot });
    });
  }

  const lastLogin = nights.at(-1).end;
  return { events: events.sort((a, b) => a.t - b.t), sessions, lastLogin };
}

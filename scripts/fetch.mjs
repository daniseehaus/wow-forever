// Holt Charakterdaten von der Battle.net API und schreibt site/data.json.
//
// Aufruf:
//   node scripts/fetch.mjs          echte Daten (braucht BLIZZARD_CLIENT_ID und BLIZZARD_CLIENT_SECRET)
//   node scripts/fetch.mjs --demo   Beispieldaten ohne API, zum lokalen Testen der Seite
//   node scripts/fetch.mjs --config andere.json   andere Konfiguration nutzen
//   node scripts/fetch.mjs --forever   Forever-Einstellungen schon vor dem Start nutzen (zum Testen)
//
// Optional: PREVIOUS_DATA_URL zeigt auf die zuletzt veröffentlichte data.json.
// Schlägt ein Charakter fehl, bleibt dann sein letzter bekannter Stand erhalten.
//
// Jeder echte Abruf schreibt außerdem einen Tageswert je Charakter nach data/history.json
// (Level, Itemlevel, epische Items), erkennt gemeinsame Sessions für data/sessions.json und
// hält Änderungen wie Level-Ups und neue Items in data/feed.json fest.
// Das passiert nur in der GitHub Action.
//
// Ab dem Starttag (config.launch) gelten die Werte aus config.forever. Wechselt dabei die Spielversion
// (era), wandern Verlauf, Sessions und Feed nach data/archive/ und beginnen neu.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolveConfig } from './config.mjs';

const root = new URL('../', import.meta.url);
const outFile = new URL('site/data.json', root);

loadDotEnv(new URL('.env', root));

const configArg = process.argv.indexOf('--config');
const configFile = configArg > -1 ? process.argv[configArg + 1] : 'config.json';
const config = resolveConfig(JSON.parse(await readFile(new URL(configFile, root), 'utf8')), process.argv.includes('--forever'));
const demo = process.argv.includes('--demo');
const era = config.era ?? 'classic';

const data = demo ? buildDemo() : await buildLive();
await mkdir(new URL('site/', root), { recursive: true });
await writeFile(outFile, JSON.stringify(data, null, 2) + '\n');
const history = demo ? {} : await updateHistory(data);
await writeFile(new URL('site/history.json', root), JSON.stringify(history) + '\n');
const sessions = demo ? {} : await updateSessions(data);
await writeFile(new URL('site/sessions.json', root), JSON.stringify(sessions) + '\n');
const feed = demo ? demoFeed(data) : await updateFeed(data, sessions);
await writeFile(new URL('site/feed.json', root), JSON.stringify({ era: feed.era, events: feed.events }) + '\n');

const failed = data.characters.filter((c) => c.error).length;
console.log(`data.json geschrieben (${data.era}): ${data.characters.length} Charaktere, ${failed} mit Fehler.`);

// ---------------------------------------------------------------------------

async function buildLive() {
  const { BLIZZARD_CLIENT_ID: id, BLIZZARD_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) {
    console.error('BLIZZARD_CLIENT_ID und BLIZZARD_CLIENT_SECRET fehlen (.env oder GitHub Secrets).');
    process.exit(1);
  }

  const token = await getToken(id, secret);
  const api = createApi(token);
  const previous = await loadPrevious();
  const caches = { icons: new Map(), specs: new Map(), displays: new Map() };

  const characters = [];
  for (const entry of config.characters) {
    const key = charKey(entry);
    try {
      characters.push(await fetchCharacter(api, entry, caches));
      console.log(`ok      ${key}`);
    } catch (err) {
      console.warn(`fehler  ${key}: ${err.message}`);
      const old = previous.get(key);
      characters.push(old ? { ...old, stale: true, error: err.message } : { key, name: entry.name, realmName: entry.realm, error: err.message });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    title: config.title,
    launch: config.launch ?? null,
    era,
    modelEnv: config.modelEnv ?? 'classic',
    wowhead: config.wowhead,
    maxLevel: config.maxLevel,
    characters,
  };
}

async function fetchCharacter(api, entry, caches) {
  const base = `/profile/wow/character/${realmSlug(entry.realm)}/${encodeURIComponent(entry.name.toLowerCase())}`;
  const ns = config.namespaces.profile;
  const optional = (path) => api(`${base}${path}`, ns).catch(() => null);

  const [summary, equipment, media, stats, specs, profs, appearance] = await Promise.all([
    api(base, ns),
    api(`${base}/equipment`, ns),
    optional('/character-media'),
    optional('/statistics'),
    optional('/specializations'),
    optional('/professions'),
    optional('/appearance'),
  ]);

  const items = [];
  for (const it of equipment.equipped_items ?? []) {
    items.push({
      slot: it.slot?.type,
      slotName: it.slot?.name,
      id: it.item?.id,
      name: it.name,
      quality: it.quality?.type,
      ilvl: it.level?.value ?? null,
      enchants: (it.enchantments ?? []).map((e) => stripMarkup(e.display_string)).filter(Boolean),
      sockets: (it.sockets ?? []).length,
      set: it.set?.item_set?.name ?? null,
      icon: await itemIcon(api, it.item?.id, caches.icons),
    });
  }

  const asset = (k) => media?.assets?.find((a) => a.key === k)?.value ?? null;
  const spec = await resolveSpec(api, summary, specs, caches.specs);

  return {
    key: charKey(entry),
    name: summary.name,
    realmName: summary.realm?.name ?? entry.realm,
    level: summary.level,
    classId: summary.character_class?.id,
    className: summary.character_class?.name,
    race: summary.race?.name,
    gender: summary.gender?.type ?? null,
    faction: summary.faction?.type,
    guild: summary.guild?.name ?? null,
    title: summary.active_title?.display_string?.replace('{name}', summary.name) ?? null,
    avgIlvl: summary.average_item_level ?? null,
    equippedIlvl: summary.equipped_item_level ?? null,
    lastLogin: summary.last_login_timestamp ?? null,
    spec: spec.name,
    role: spec.role,
    avatar: asset('avatar'),
    render: asset('main-raw') ?? asset('main') ?? asset('inset'),
    stats: pickStats(stats),
    professions: pickProfessions(profs),
    talents: pickTalents(specs, summary),
    model: await modelData(api, appearance, caches.displays),
    items,
  };
}

// Inventartypen in der Zählung des Wowhead-Modellviewers.
function modelSlot(type) {
  return {
    HEAD: 1, SHOULDER: 3, BODY: 4, CHEST: 5, WAIST: 6, LEGS: 7, FEET: 8, WRIST: 9, HAND: 10,
    WEAPON: 13, SHIELD: 14, RANGED: 15, CLOAK: 16, TWOHWEAPON: 17, TABARD: 19, ROBE: 20,
    WEAPONMAINHAND: 21, WEAPONOFFHAND: 22, HOLDABLE: 23, RANGEDRIGHT: 26,
  }[type];
}

// Daten für das 3D-Modell: Rasse, Geschlecht, Aussehen und sichtbare Items (inklusive Transmog).
// Die Display-IDs liefert Blizzard über die Item-Appearance-API.
async function modelData(api, appearance, cache) {
  if (!appearance?.playable_race?.id) return null;
  const items = [];
  for (const it of appearance.items ?? []) {
    if (!cache.has(it.id)) cache.set(it.id, itemDisplay(api, it.id));
    const display = await cache.get(it.id);
    if (display) items.push(display);
  }
  return {
    race: appearance.playable_race.id,
    gender: appearance.gender?.type === 'FEMALE' ? 1 : 0,
    options: (appearance.customizations ?? []).map((c) => ({ optionId: c.option.id, choiceId: c.choice.id })),
    items,
  };
}

async function itemDisplay(api, id) {
  try {
    const item = await api(`/data/wow/item/${id}`, config.namespaces.static);
    const slot = modelSlot(item.inventory_type?.type);
    const appearanceId = item.appearances?.[0]?.id;
    if (!slot || !appearanceId) return null;
    const ap = await api(`/data/wow/item-appearance/${appearanceId}`, config.namespaces.static);
    return ap.item_display_info_id ? [slot, ap.item_display_info_id] : null;
  } catch {
    return null;
  }
}

// Retail liefert die aktive Spezialisierung samt Rolle. Classic kennt nur Talentbäume,
// dort gilt der Baum mit den meisten Punkten.
async function resolveSpec(api, summary, specs, cache) {
  const id = summary.active_spec?.id;
  if (id) {
    if (!cache.has(id)) {
      cache.set(id, api(`/data/wow/playable-specialization/${id}`, config.namespaces.static).then((s) => s.role?.type).catch(() => null));
    }
    return { name: summary.active_spec.name, role: (await cache.get(id)) ?? 'DAMAGE' };
  }
  const trees = specs?.specialization_groups?.find((g) => g.is_active)?.specializations ?? specs?.specialization_groups?.[0]?.specializations ?? [];
  const top = [...trees].sort((a, b) => (b.spent_points ?? 0) - (a.spent_points ?? 0))[0];
  const name = top?.specialization_name ?? null;
  return { name, role: classicRole(summary.character_class?.id, name) };
}

function classicRole(classId, tree) {
  const t = (tree ?? '').toLowerCase();
  if ((classId === 1 || classId === 2) && /schutz|protection/.test(t)) return 'TANK';
  if (/heilig|holy|disziplin|discipline|wiederherstellung|restoration/.test(t)) return 'HEALER';
  return 'DAMAGE';
}

// Talente. Retail liefert den Import-Code des aktiven Loadouts, den der Wowhead-Rechner direkt öffnet.
// Classic liefert je Baum die verteilten Punkte und die gewählten Talente, aber nicht ihre Position im Baum.
// Ohne Position lässt sich kein Rechner-Link mit Build bauen, der Link öffnet dort den Rechner der Klasse.

function pickTalents(specs, summary) {
  const CLASS_SLUGS = { 1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue', 5: 'priest', 6: 'death-knight', 7: 'shaman', 8: 'mage', 9: 'warlock', 10: 'monk', 11: 'druid', 12: 'demon-hunter', 13: 'evoker' };
  if (!specs) return null;
  const site = `https://www.wowhead.com${config.wowhead ? `/${config.wowhead}` : ''}`;
  const pick = (t, tree = null) => ({
    name: t.tooltip?.talent?.name ?? t.spell_tooltip?.spell?.name ?? t.talent?.name ?? null,
    spell: t.tooltip?.spell_tooltip?.spell?.id ?? t.spell_tooltip?.spell?.id ?? null,
    rank: t.rank ?? t.talent_rank ?? 1,
    tree,
  });

  const retail = specs.specializations?.find((s) => s.specialization?.id === summary.active_spec?.id);
  if (retail) {
    const lo = retail.loadouts?.find((l) => l.is_active) ?? retail.loadouts?.[0];
    if (!lo) return null;
    const hero = lo.selected_hero_talent_tree?.name ?? null;
    return {
      trees: [],
      hero,
      picks: [
        ...(lo.selected_spec_talents ?? []).map((t) => pick(t, retail.specialization?.name ?? null)),
        ...(lo.selected_hero_talents ?? []).map((t) => pick(t, hero)),
      ].filter((t) => t.name),
      total: (lo.selected_class_talents?.length ?? 0) + (lo.selected_spec_talents?.length ?? 0) + (lo.selected_hero_talents?.length ?? 0),
      calc: lo.talent_loadout_code ? `${site}/talent-calc/blizzard/${lo.talent_loadout_code}` : null,
    };
  }

  const group = specs.specialization_groups?.find((g) => g.is_active) ?? specs.specialization_groups?.[0];
  if (!group) return null;
  const trees = (group.specializations ?? []).map((s) => ({ name: s.specialization_name ?? null, points: s.spent_points ?? 0 }));
  const picks = (group.specializations ?? []).flatMap((s) => (s.talents ?? []).map((t) => pick(t, s.specialization_name ?? null))).filter((t) => t.name);
  const cls = CLASS_SLUGS[summary.character_class?.id];
  return {
    trees,
    hero: null,
    picks,
    total: trees.reduce((a, t) => a + t.points, 0),
    calc: cls ? `https://www.wowhead.com/${config.wowhead || 'classic'}/talent-calc/${cls}` : null,
  };
}

function pickStats(s) {
  if (!s) return null;
  const v = (x) => (typeof x === 'object' && x ? x.effective ?? x.value ?? null : x ?? null);
  const pct = (x) => (typeof x === 'object' && x ? x.value ?? null : x ?? null);
  return {
    health: s.health ?? null,
    power: s.power ?? null,
    powerType: s.power_type?.name ?? null,
    strength: v(s.strength),
    agility: v(s.agility),
    intellect: v(s.intellect),
    stamina: v(s.stamina),
    armor: v(s.armor),
    crit: Math.max(pct(s.melee_crit) ?? 0, pct(s.spell_crit) ?? 0, pct(s.ranged_crit) ?? 0) || null,
    haste: Math.max(pct(s.melee_haste) ?? 0, pct(s.spell_haste) ?? 0, pct(s.ranged_haste) ?? 0) || null,
    mastery: pct(s.mastery),
    versatility: s.versatility_damage_done_bonus ?? null,
  };
}

// Retail gliedert Berufe in Erweiterungsstufen (tiers), Classic liefert die Werte direkt.
function pickProfessions(p) {
  if (!p) return [];
  const one = (e, kind) => {
    const tier = e.tiers?.at(-1);
    return {
      name: e.profession?.name,
      kind,
      skill: tier?.skill_points ?? e.skill_points ?? null,
      max: tier?.max_skill_points ?? e.max_skill_points ?? null,
    };
  };
  return [...(p.primaries ?? []).map((e) => one(e, 'primary')), ...(p.secondaries ?? []).map((e) => one(e, 'secondary'))].filter((x) => x.name);
}

async function itemIcon(api, id, cache) {
  if (!id) return null;
  if (!cache.has(id)) cache.set(id, resolveIcon(api, id));
  return cache.get(id);
}

// Blizzards Render-Server kennt nicht jedes neue Icon. Dann liefert Wowhead den Icon-Namen.
async function resolveIcon(api, id) {
  const blizzard = await api(`/data/wow/media/item/${id}`, config.namespaces.static)
    .then((m) => m.assets?.find((a) => a.key === 'icon')?.value ?? null)
    .catch(() => null);
  if (blizzard && (await fetch(blizzard).then((r) => r.ok).catch(() => false))) return blizzard;
  const name = await fetch(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.icon)
    .catch(() => null);
  return name ? `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg` : blizzard;
}

async function getToken(id, secret) {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Token-Abruf fehlgeschlagen: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

function createApi(token) {
  const host = `https://${config.region}.api.blizzard.com`;
  return async function api(path, namespace, attempt = 1) {
    const url = `${host}${path}?namespace=${namespace}&locale=${config.locale}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return api(path, namespace, attempt + 1);
    }
    if (res.status === 404) throw new Error('nicht gefunden (Name, Realm oder Namespace prüfen; Profil erst nach Logout sichtbar)');
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${path}`);
    return res.json();
  };
}

async function loadPrevious() {
  const map = new Map();
  const url = process.env.PREVIOUS_DATA_URL;
  try {
    const prev = url
      ? await fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      : existsSync(outFile) ? JSON.parse(await readFile(outFile, 'utf8')) : null;
    // Nach dem Wechsel der Spielversion passt der alte Stand nicht mehr, auch bei gleichem Namen.
    if ((prev?.era ?? era) !== era) return map;
    for (const c of prev?.characters ?? []) if (c.key && !c.demo) map.set(c.key, c);
  } catch {
    // Kein alter Stand vorhanden, das ist beim ersten Lauf normal.
  }
  return map;
}

// Verlauf, Sessions und Feed liegen in data/ und gehören zu einer Spielversion (era).
// Wechselt sie, wandert die alte Datei nach data/archive/<era>-<name>.json und die neue beginnt leer.
// Dateien ohne era stammen aus der Zeit vor dieser Kennzeichnung und gehören zur aktuellen Version.
async function loadState(name, empty) {
  const file = new URL(`data/${name}.json`, root);
  const raw = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
  if (!raw) return { era, ...empty() };
  const state = raw.era ? raw : { era, ...(name === 'history' ? { chars: raw } : raw) };
  if (state.era === era) return state;
  if (process.env.GITHUB_ACTIONS) {
    await mkdir(new URL('data/archive/', root), { recursive: true });
    await writeFile(new URL(`data/archive/${state.era}-${name}.json`, root), JSON.stringify(state, null, 1) + '\n');
    console.log(`${name}: Spielversion ${state.era} → ${era}, alter Stand archiviert.`);
  }
  return { era, ...empty() };
}

async function saveState(name, state) {
  await mkdir(new URL('data/', root), { recursive: true });
  await writeFile(new URL(`data/${name}.json`, root), JSON.stringify(state, null, 1) + '\n');
}

// Ein Eintrag je Charakter und Tag. Mehrere Abrufe am selben Tag überschreiben den Tageswert.
async function updateHistory(data) {
  const history = await loadState('history', () => ({ chars: {} }));
  // Nur die GitHub Action schreibt den Verlauf, lokale Testläufe lesen ihn nur.
  if (!process.env.GITHUB_ACTIONS) return history;
  const day = new Date().toISOString().slice(0, 10);
  for (const c of data.characters) {
    if (c.error || !c.level) continue;
    const point = {
      d: day,
      level: c.level,
      ilvl: c.equippedIlvl,
      epics: c.items.filter((i) => ['EPIC', 'LEGENDARY'].includes(i.quality)).length,
    };
    const list = (history.chars[c.key] ??= []);
    if (list.at(-1)?.d === day) list[list.length - 1] = point;
    else list.push(point);
  }
  await saveState('history', history);
  return history;
}

// Gemeinsame Sessions: Die API kennt keine Spielzeit, nur den letzten Logout je Charakter.
// Haben sich seit der letzten erkannten Session mindestens 4 Charaktere (bei kleinerer Gruppe alle)
// innerhalb von 3 Stunden ausgeloggt, zählt das als gemeinsame Session. Erkannt wird sie erst, wenn
// seit dem letzten Logout eine Stunde vergangen ist, damit Nachzügler noch dazukommen.
// Der durchschnittliche Level-Zuwachs der Beteiligten seit dem letzten Stand ist ihr Ergebnis.
async function updateSessions(data) {
  const SESSION_WINDOW = 3 * 3600 * 1000;
  const QUIET = 3600 * 1000;
  const state = await loadState('sessions', () => ({ lastEnd: 0, levels: {}, list: [] }));
  if (!process.env.GITHUB_ACTIONS) return state;

  const chars = data.characters.filter((c) => c.level && !c.error);
  const minPlayers = Math.max(2, Math.min(4, chars.length));
  const levels = Object.fromEntries(chars.map((c) => [c.key, c.level]));

  if (!Object.keys(state.levels).length) {
    state.levels = levels;
    state.lastEnd = Math.max(0, ...chars.map((c) => c.lastLogin ?? 0));
  } else {
    const fresh = chars.filter((c) => c.lastLogin > state.lastEnd);
    const end = Math.max(0, ...fresh.map((c) => c.lastLogin));
    const players = fresh.filter((c) => end - c.lastLogin <= SESSION_WINDOW);
    if (players.length >= minPlayers && Date.now() - end >= QUIET) {
      const gains = players.filter((c) => state.levels[c.key] != null).map((c) => c.level - state.levels[c.key]);
      if (gains.length) {
        state.list.push({
          start: Math.min(...players.map((c) => c.lastLogin)),
          end,
          gain: gains.reduce((a, b) => a + b, 0) / gains.length,
          players: players.map((c) => c.key),
        });
      }
      // Auch Level aus Solo-Spiel der übrigen gelten damit als verbucht.
      state.levels = levels;
      state.lastEnd = end;
    }
  }
  await saveState('sessions', state);
  return state;
}

// Aktivitäts-Feed: Jeder Abruf wird mit dem letzten Stand je Charakter verglichen (snapshot),
// Änderungen werden Ereignisse. Sie bekommen den Zeitpunkt des Logouts, in dem sie passiert sind,
// sonst den des Abrufs. Level-Ups sind damit auf die Stunde genau.
async function updateFeed(data, sessions) {
  const FEED_LIMIT = 500;
  const FEED_QUALITIES = ['RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT'];
  const feed = await loadState('feed', () => ({ snapshot: {}, events: [] }));
  if (!process.env.GITHUB_ACTIONS) return feed;
  const now = Date.now();
  const add = (e) => feed.events.push(e);

  for (const c of data.characters) {
    if (c.error || !c.level) continue;
    const snap = {
      level: c.level,
      lastLogin: c.lastLogin ?? null,
      guild: c.guild ?? null,
      items: Object.fromEntries(c.items.filter((i) => i.id).map((i) => [i.slot, i.id])),
      profs: Object.fromEntries((c.professions ?? []).map((p) => [p.name, p.skill ?? 0])),
    };
    const old = feed.snapshot[c.key];
    feed.snapshot[c.key] = snap;
    if (!old) continue;

    const t = c.lastLogin && c.lastLogin > (old.lastLogin ?? 0) ? c.lastLogin : now;
    const base = { t, key: c.key };
    if (c.level > old.level) add({ ...base, type: 'level', from: old.level, to: c.level, max: c.level >= config.maxLevel });
    for (const it of c.items) {
      if (!it.id || old.items[it.slot] === it.id || !FEED_QUALITIES.includes(it.quality)) continue;
      // Ringe und Schmuckstücke tauschen beim Umsortieren nur den Platz.
      if (Object.values(old.items).includes(it.id)) continue;
      add({ ...base, type: 'item', id: it.id, name: it.name, quality: it.quality, icon: it.icon, slot: it.slotName ?? it.slot });
    }
    for (const p of c.professions ?? []) {
      const before = old.profs[p.name];
      const skill = p.skill ?? 0;
      // Meilensteine alle 75 Punkte (Classic-Stufen) und beim Erreichen des Maximums.
      if (before == null) add({ ...base, type: 'prof', name: p.name, skill, learned: true });
      else if (Math.floor(skill / 75) > Math.floor(before / 75) || (p.max && skill >= p.max && before < p.max)) add({ ...base, type: 'prof', name: p.name, skill });
    }
    if ((c.guild ?? null) !== (old.guild ?? null)) add({ ...base, type: 'guild', guild: c.guild ?? null, from: old.guild ?? null });
  }

  const last = sessions.list?.at(-1);
  if (last && !feed.events.some((e) => e.type === 'session' && e.t === last.end)) {
    add({ t: last.end, type: 'session', start: last.start, gain: last.gain, players: last.players ?? [] });
  }

  feed.events.sort((a, b) => a.t - b.t);
  feed.events = feed.events.slice(-FEED_LIMIT);
  await saveState('feed', feed);
  return feed;
}

// Blizzard-Slugs: klein, ohne Akzente und Apostrophe, Leerzeichen als Bindestrich.
function realmSlug(realm) {
  return realm.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').trim().replace(/\s+/g, '-');
}

// Entfernt Spiel-Markup wie |A:Icon|a oder Farbcodes |cffxxxxxx ... |r.
function stripMarkup(text) {
  return (text ?? '').replace(/\|A:[^|]*\|a/g, '').replace(/\|c[0-9a-f]{8}|\|r/gi, '').trim();
}

function charKey(entry) {
  return `${realmSlug(entry.realm)}/${entry.name.toLowerCase()}`;
}

function loadDotEnv(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------------------------------------------------------------------------
// Demo-Daten

function buildDemo() {
  const icon = (n) => `https://wow.zamimg.com/images/wow/icons/large/${n}.jpg`;
  const gear = (q) => [
    ['HEAD', 'Kopf', 'Helm der Wacht', 'inv_helmet_03'],
    ['NECK', 'Hals', 'Amulett des Morgens', 'inv_jewelry_necklace_01'],
    ['SHOULDER', 'Schultern', 'Schulterstücke des Sturms', 'inv_shoulder_02'],
    ['BACK', 'Rücken', 'Umhang des Wanderers', 'inv_misc_cape_02'],
    ['CHEST', 'Brust', 'Brustplatte der Tapferkeit', 'inv_chest_plate16'],
    ['WRIST', 'Handgelenke', 'Armschienen des Eifers', 'inv_bracer_07'],
    ['HANDS', 'Hände', 'Stulpen der Macht', 'inv_gauntlets_04'],
    ['WAIST', 'Taille', 'Gürtel des Bären', 'inv_belt_13'],
    ['LEGS', 'Beine', 'Beinschützer des Falken', 'inv_pants_04'],
    ['FEET', 'Füße', 'Stiefel der Eile', 'inv_boots_05'],
    ['FINGER_1', 'Finger', 'Ring der Ausdauer', 'inv_jewelry_ring_03'],
    ['FINGER_2', 'Finger', 'Siegel des Adlers', 'inv_jewelry_ring_03'],
    ['TRINKET_1', 'Schmuck', 'Talisman der Ruhe', 'inv_jewelry_talisman_07'],
    ['MAIN_HAND', 'Waffenhand', 'Klinge des Nordens', 'inv_sword_04'],
    ['OFF_HAND', 'Schildhand', 'Schild der Wacht', 'inv_shield_06'],
  ].map(([slot, slotName, name, ic], i) => ({
    slot, slotName, id: null, name, quality: q[i % q.length], ilvl: 30 + i, enchants: i === 4 ? ['+4 Werte'] : [], icon: icon(ic),
  }));

  const chars = [
    ['Thoradin', 60, 1, 'Krieger', 'Zwerg', 'ALLIANCE', 'Die Unbeugsamen', ['EPIC', 'RARE', 'RARE', 'EPIC']],
    ['Lunaria', 58, 8, 'Magier', 'Gnom', 'ALLIANCE', 'Die Unbeugsamen', ['RARE', 'UNCOMMON', 'RARE']],
    ['Kaelwyn', 47, 3, 'Jäger', 'Nachtelf', 'ALLIANCE', null, ['UNCOMMON', 'RARE', 'COMMON']],
    ['Brumhild', 52, 2, 'Paladin', 'Mensch', 'ALLIANCE', 'Die Unbeugsamen', ['RARE', 'UNCOMMON']],
    ['Schattenfell', 33, 4, 'Schurke', 'Mensch', 'ALLIANCE', null, ['UNCOMMON', 'COMMON']],
  ];

  const trees = {
    1: ['Waffen', 'Furor', 'Schutz'], 8: ['Arkan', 'Feuer', 'Frost'], 3: ['Tierherrschaft', 'Treffsicherheit', 'Überleben'],
    2: ['Heilig', 'Schutz', 'Vergeltung'], 4: ['Meucheln', 'Kampf', 'Täuschung'],
  };
  const talents = (classId, level) => {
    const points = Math.max(0, level - 9);
    const split = [Math.ceil(points * 0.6), Math.floor(points * 0.4), 0];
    return {
      trees: trees[classId].map((name, i) => ({ name, points: split[i] })),
      hero: null,
      picks: [[12294, 'Tödlicher Stoß'], [12328, 'Todeswunsch'], [12296, 'Wutanfall']].map(([spell, name], i) => ({ name, spell, rank: i + 1, tree: trees[classId][0] })),
      total: points,
      calc: `https://www.wowhead.com/classic/talent-calc/${{ 1: 'warrior', 8: 'mage', 3: 'hunter', 2: 'paladin', 4: 'rogue' }[classId]}`,
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    title: config.title,
    launch: config.launch ?? null,
    era: 'classic',
    modelEnv: 'classic',
    wowhead: 'classic',
    maxLevel: 60,
    characters: chars.map(([name, level, classId, className, race, faction, guild, q], i) => ({
      key: `demo/${name.toLowerCase()}`,
      demo: true,
      name, realmName: 'Demo-Realm', level, classId, className, race, faction, guild,
      avgIlvl: 30 + level / 2, equippedIlvl: 28 + level / 2,
      lastLogin: Date.now() - i * 5 * 3600 * 1000,
      avatar: null,
      items: gear(q).slice(0, 15 - i),
      professions: [{ name: 'Mining', kind: 'primary', skill: 150 + i * 20, max: 225 }, { name: 'Cooking', kind: 'secondary', skill: 75, max: 150 }],
      talents: talents(classId, level),
    })),
  };
}

// Beispiel-Feed für die Demo: ein paar Tage mit Level-Ups, Items, Berufen und einer Session.
function demoFeed(data) {
  const chars = data.characters;
  const h = 3600 * 1000;
  const start = Date.now() - 4 * 24 * h;
  const events = [];
  chars.forEach((c, i) => {
    for (let lv = Math.max(1, c.level - 6); lv < c.level; lv++) {
      events.push({ t: start + (lv - c.level + 6) * 14 * h + i * 900e3, key: c.key, type: 'level', from: lv, to: lv + 1, max: lv + 1 >= 60 });
    }
    const it = c.items.find((x) => x.quality === 'EPIC' || x.quality === 'RARE');
    if (it) events.push({ t: start + 50 * h + i * h, key: c.key, type: 'item', id: 1, name: it.name, quality: it.quality, icon: it.icon, slot: it.slotName });
  });
  events.push({ t: start + 30 * h, key: chars[1].key, type: 'prof', name: 'Mining', skill: 150 });
  events.push({ t: start + 31 * h, key: chars[4].key, type: 'guild', guild: 'Die Unbeugsamen', from: null });
  events.push({ t: start + 70 * h, type: 'session', start: start + 66 * h, gain: 2.5, players: chars.slice(0, 4).map((c) => c.key) });
  return { era: 'classic', events: events.sort((a, b) => a.t - b.t) };
}

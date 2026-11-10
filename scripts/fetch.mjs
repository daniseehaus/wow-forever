// Holt Charakterdaten von der Battle.net API und schreibt site/data.json.
//
// Aufruf:
//   node scripts/fetch.mjs          echte Daten (braucht BLIZZARD_CLIENT_ID und BLIZZARD_CLIENT_SECRET)
//   node scripts/fetch.mjs --demo   Beispieldaten ohne API, zum lokalen Testen der Seite
//   node scripts/fetch.mjs --config andere.json   andere Konfiguration nutzen
//   node scripts/fetch.mjs --forever   Forever-Einstellungen schon vor dem Start nutzen (zum Testen)
//   node scripts/fetch.mjs --guild-demo   echte Daten, die Gilde mit Beispiel-Mitgliedern auf 15 aufgefüllt,
//                                         der Squad mit denselben Test-Charakteren (zum Vergleich)
//
// Gilde: Forever kennt keine Gilden in der API (kein Gildenfeld, kein Roster). Die Mitglieder stehen deshalb
// in config.guild.members. Die Gilde umfasst diese Liste und alle Charaktere aus characters (ohne Platzhalter).
// Der Abruf schreibt site/guild.json und hält Beitritte, Austritte und die Aktivität wie im Squad
// (Level-Ups, Items, Berufe, Erfolge) in data/guild-feed.json fest.
//
// Vorschau: Mit config.simulate wandelt der Abruf die echten Retail-Charaktere in Classic-Charaktere um
// (Level, Talentbäume, Berufe, Werte, Itemlevel) und ergänzt einen Showcase-Verlauf für Aktivität und Sessions.
// So zeigt die Seite bis zum Start ein Bild wie in Forever. Details in preview.mjs.
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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from './config.mjs';
import { simulateClassic } from './preview.mjs';

const root = new URL('../', import.meta.url);
const outFile = new URL('site/data.json', root);

loadDotEnv(new URL('.env', root));

const configArg = process.argv.indexOf('--config');
const configFile = configArg > -1 ? process.argv[configArg + 1] : 'config.json';
const config = resolveConfig(JSON.parse(await readFile(new URL(configFile, root), 'utf8')), process.argv.includes('--forever'));
const demo = process.argv.includes('--demo');
const guildDemo = process.argv.includes('--guild-demo');
const era = config.era ?? 'classic';
// API-Zugang und Caches des echten Abrufs. Die Gilde nutzt sie mit.
const ctx = {};

const live = demo ? null : await buildLive();
const preview = live && config.simulate ? simulateClassic(live, config.simulate, classicRole) : null;
const data = demo ? buildDemo() : preview?.data ?? live;
await mkdir(new URL('site/', root), { recursive: true });
if (!demo) await localRenders(data.characters);
if (ctx.api) {
  data.crafts = await buildCrafts(data.characters);
  data.statNames = ctx.statNames ?? {};
  data.questInfo = await buildQuests(data.characters);
}
await writeFile(outFile, JSON.stringify(data, null, 2) + '\n');

// Gilde: eigene Datei, eigener Feed. In der Vorschau (Retail-Charaktere) gibt es keine Gilde.
const guild = config.guild && !preview ? (demo ? buildDemoGuild([]) : await buildGuild(live)) : null;
if (guild) {
  if (guildDemo) buildDemoGuild(guild.members);
  if (!demo) await localRenders(guild.members);
  if (guildDemo) await fillSquad(data, guild);
  await writeFile(new URL('site/guild.json', root), JSON.stringify(guild, null, 2) + '\n');
  const guildFeed = demo || guildDemo ? demoGuildFeed(guild) : await updateGuildFeed(guild);
  await writeFile(new URL('site/guild-feed.json', root), JSON.stringify({ era: guildFeed.era, events: guildFeed.events }) + '\n');
  console.log(`guild.json geschrieben: ${guild.members.length} Mitglieder, ${guild.members.filter((m) => m.error).length} ohne Profil.`);
}
const history = demo ? {} : await updateHistory(data);
await writeFile(new URL('site/history.json', root), JSON.stringify(history) + '\n');
// In der Vorschau stammen die Sessions nur aus dem Showcase, der Feed aus Showcase und echten Änderungen.
const sessions = demo ? {} : preview ? { list: preview.showcase.sessions } : await updateSessions(data);
// Baseline: gemeinsame Sessions vor der Erkennung (config sessionBaseline). Die Seite zählt sie mit, zeigt aber keine Karte dafür.
const baseline = config.sessionBaseline ? { count: config.sessionBaseline.count ?? 0, levels: config.sessionBaseline.levels ?? 0 } : null;
await writeFile(new URL('site/sessions.json', root), JSON.stringify({ ...sessions, baseline }) + '\n');
// Mit --guild-demo zeigt die Aktivität Beispiele und die echten Erfolge der echten Charaktere.
const feed = demo ? demoFeed(data) : guildDemo ? await withAchievements(demoFeed(data), data) : await updateFeed(data, preview ? {} : sessions);
const events = preview ? [...preview.showcase.events, ...feed.events].sort((a, b) => a.t - b.t) : feed.events;
await writeFile(new URL('site/feed.json', root), JSON.stringify({ era: feed.era, events }) + '\n');
// Quest-Verlauf: wer wann welche Quest abgeschlossen hat. Grundlage für „Verpasst“ im Abschnitt Quests.
const questLog = demo ? { events: [] } : guildDemo ? demoQuestLog(data) : await updateQuestLog(data, history);
await writeFile(new URL('site/quest-log.json', root), JSON.stringify({ events: questLog.events }) + '\n');

const failed = data.characters.filter((c) => c.error && !c.placeholder).length;
const open = data.characters.filter((c) => c.placeholder).length;
console.log(`data.json geschrieben (${data.era}): ${data.characters.length} Charaktere, ${failed} mit Fehler, ${open} Platzhalter.`);

// ---------------------------------------------------------------------------

// Blizzard liefert die 2D-Renders als PNG mit 1600 × 1200 px, zusammen fast 3 MB. Sie sind das größte Bild beim Laden.
// Die Seite bekommt sie als WebP in gleicher Größe (je etwa 45 KB) unter site/renders/.
// Der Name enthält einen Hash der Quelle: Ändert sich das Aussehen, ändert sich der Name, und kein Cache zeigt das alte Bild.
// renderSrc merkt sich die Quelle. Übernimmt der nächste Lauf einen alten Stand (Abruf fehlgeschlagen), baut er das Bild daraus neu.
// Ohne sharp (lokal ohne npm install) oder bei einem Fehler bleibt der Link zu Blizzard.
async function localRenders(chars) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.warn('sharp fehlt (npm install), die Renders bleiben bei Blizzard.');
    return;
  }
  const dir = new URL('site/renders/', root);
  await mkdir(dir, { recursive: true });
  for (const c of chars) {
    const src = c.renderSrc ?? (/^https?:/.test(c.render ?? '') ? c.render : null);
    if (!src) continue;
    const file = `${c.key.replace(/[^a-z0-9]+/gi, '-')}-${createHash('sha1').update(src).digest('hex').slice(0, 8)}.webp`;
    try {
      if (!existsSync(new URL(file, dir))) {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await sharp(Buffer.from(await res.arrayBuffer())).webp({ quality: 80, effort: 6 }).toFile(fileURLToPath(new URL(file, dir)));
      }
      c.renderSrc = src;
      c.render = `renders/${file}`;
    } catch (err) {
      console.warn(`Render ${c.key} bleibt bei Blizzard: ${err.message}`);
      c.render = src;
    }
  }
}

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
  Object.assign(ctx, { api, caches });

  const characters = [];
  for (const entry of config.characters) {
    const key = charKey(entry);
    // Platzhalter: nur ein Name, noch ohne Realm oder Nachnamen. Kein Abruf.
    if (!entry.realm && !entry.surname) {
      console.log(`offen   ${key}`);
      characters.push({ key, name: entry.name, placeholder: true, error: 'Charakter folgt' });
      continue;
    }
    try {
      characters.push(await fetchCharacter(api, entry, caches));
      console.log(`ok      ${key}`);
    } catch (err) {
      console.warn(`fehler  ${key}: ${err.message}`);
      const old = previous.get(key);
      characters.push(old ? { ...old, stale: true, error: err.message } : { key, name: entry.name, surname: entry.surname ?? null, realmName: entry.realm ?? null, error: err.message });
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
  const base = `/profile/wow/character/${charPath(entry)}`;
  const ns = config.namespaces.profile;
  const optional = (path) => api(`${base}${path}`, ns).catch(() => null);

  const [summary, equipment, media, stats, specs, profs, appearance, achievements, questsOpen, questsDone] = await Promise.all([
    api(base, ns),
    api(`${base}/equipment`, ns),
    optional('/character-media'),
    optional('/statistics'),
    optional('/specializations'),
    optional('/professions'),
    optional('/appearance'),
    optional('/achievements'),
    optional('/quests'),
    optional('/quests/completed'),
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
      // Werte für den Vergleich mit herstellbaren Items (Crafting).
      stats: statMap(it.stats),
      armor: it.armor?.value ?? null,
      dps: it.weapon?.dps?.value ?? null,
      sockets: (it.sockets ?? []).length,
      set: it.set?.item_set?.name ?? null,
      icon: await itemIcon(api, it.item?.id, caches.icons),
    });
  }

  const asset = (k) => media?.assets?.find((a) => a.key === k)?.value ?? null;
  const spec = await resolveSpec(api, summary, specs, caches.specs);

  return {
    key: charKey(entry),
    // Feste ID des Charakters bei Blizzard. Der Gilden-Feed erkennt daran eine Namenskorrektur in config.json.
    id: summary.id ?? null,
    name: summary.name,
    surname: summary.surname ?? entry.surname ?? null,
    realmName: summary.realm?.name ?? entry.realm ?? null,
    level: summary.level,
    classId: summary.character_class?.id,
    className: summary.character_class?.name,
    race: raceName(summary.race?.name),
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
    // Gelernte Rezepte aller Berufe (IDs), auch Kochen und Erste Hilfe. Was sie herstellen, klärt buildCrafts.
    recipes: [...(profs?.primaries ?? []), ...(profs?.secondaries ?? [])].flatMap((e) => (e.tiers ?? []).flatMap((t) => (t.known_recipes ?? []).map((r) => r.id))),
    talents: pickTalents(specs, summary),
    model: await modelData(api, appearance, caches.displays),
    // Abgeschlossene Erfolge als [ID, Zeitpunkt], älteste zuerst. Namen und Icons holt erst der Feed, nur für neue Erfolge.
    achievements: pickAchievements(achievements),
    // Questlog: offene und abgeschlossene Quests (IDs). Titel und Zone holt buildQuests.
    quests: questsOpen || questsDone ? { open: (questsOpen?.in_progress ?? []).map((q) => q.id), done: (questsDone?.quests ?? []).map((q) => q.id) } : null,
    items,
  };
}

function pickAchievements(a) {
  if (!a?.achievements) return null;
  return a.achievements.filter((x) => x.id && x.completed_timestamp).map((x) => [x.id, x.completed_timestamp]).sort((x, y) => x[1] - y[1]);
}

// ---------------------------------------------------------------------------
// Herstellen im Squad: Was kann jeder mit seinen Rezepten herstellen, das man tragen kann (Rüstung und Waffen),
// und welche Verzauberungen kennt er. Den Abgleich mit der Ausrüstung macht die Seite (crafts in app.js).
// Rezepte ändern sich nur mit einem Patch. Ihre Daten liegen darum in data/recipes.json und werden nur für neue Rezepte abgerufen.
// Die Action speichert die Datei, ein lokaler Lauf nur im Speicher.


async function buildCrafts(chars) {
  // Format der Datei. Ändert sich das, was recipeInfo speichert, die Zahl erhöhen.
  const RECIPE_VERSION = 3;
  const file = new URL('data/recipes.json', root);
  const ns = config.namespaces.static;
  const stored = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
  // Neuer Patch (anderer Namespace) oder neues Format (v): Rezepte neu abrufen.
  const cache = stored?.ns === ns && stored?.v === RECIPE_VERSION ? stored.recipes : {};
  let fresh = 0;
  const out = [];
  for (const c of chars) {
    for (const id of c.recipes ?? []) {
      if (!(id in cache)) {
        const info = await recipeInfo(id).catch((err) => { console.warn(`Rezept ${id}: ${err.message}`); return undefined; });
        if (info === undefined) continue;
        cache[id] = info;
        fresh++;
      }
      if (cache[id]) out.push({ by: c.key, recipe: id, ...cache[id] });
    }
  }
  if (fresh && process.env.GITHUB_ACTIONS) {
    await mkdir(new URL('data/', root), { recursive: true });
    await writeFile(file, JSON.stringify({ ns, v: RECIPE_VERSION, recipes: cache }) + '\n');
  }
  const n = (k) => out.filter((x) => x[k]).length;
  console.log(`Herstellen: ${n('item')} Ausrüstung, ${n('enhance')} Verbesserungen (${fresh} Rezepte neu abgerufen).`);
  return out;
}

// Werte eines Items als { STRENGTH: 5, ... }. Die deutschen Namen sammelt ctx.statNames für die Seite.
function statMap(list) {
  const out = {};
  for (const s of list ?? []) {
    const type = s.type?.type;
    if (!type || s.value == null || s.is_negated) continue;
    out[type] = (out[type] ?? 0) + s.value;
    if (s.type?.name) (ctx.statNames ??= {})[type] = s.type.name;
  }
  return out;
}


// Was ein Rezept herstellt. Zwei Arten, null für alles andere (Barren, Leder, Taschen, Verbrauchsgüter):
// item: tragbare Ausrüstung mit Werten. enhance: dauerhafte Verbesserung eines Slots (Verzauberung, Rüstungsset, Zielfernrohr).
async function recipeInfo(id) {
  const ns = config.namespaces.static;
  const r = await ctx.api(`/data/wow/recipe/${id}`, ns);
  const reagents = (r.reagents ?? []).map((x) => [x.reagent?.name, x.quantity]);
  if (!r.crafted_item) {
    const [, prefix] = (r.name ?? '').match(/^(.+?) - /) ?? [];
    // Verzauberungen nennen ihren Slot vorne im Namen, z. B. „Armschiene - Ausdauer“.
    const slot = { Armschiene: 'WRIST', Brust: 'CHEST', Umhang: 'BACK', Stiefel: 'FEET', Handschuhe: 'HANDS', Schild: 'OFF_HAND', Waffe: 'MAIN_HAND', '2H-Waffe': 'MAIN_HAND', Zweihandwaffe: 'MAIN_HAND' }[prefix];
    return slot ? { enhance: { kind: 'enchant', slots: [slot], two: /2H|Zweihand/.test(prefix), name: r.name, desc: r.description ?? null }, reagents } : null;
  }
  const it = await ctx.api(`/data/wow/item/${r.crafted_item.id}`, ns);
  const cls = it.item_class?.id;
  const base = { id: it.id, name: it.name, quality: it.quality?.type ?? null, ilvl: it.level ?? null, req: it.required_level ?? 0, icon: await itemIcon(ctx.api, it.id, ctx.caches.icons) };
  const desc = (it.preview_item?.spells ?? []).map((s) => s.description).filter(Boolean).join(' ') || null;
  if (cls === 0) {
    if (it.item_subclass?.id === 6) {
      // Slots, die eine dauerhafte Verbesserung nennt (Rüstungsset, Zielfernrohr): „…auf der Brust, an den Beinen, Händen oder Füßen…“.
      const words = [['CHEST', /Brust/], ['LEGS', /Beine/], ['HANDS', /Hände|Händen|Handschuh/], ['FEET', /Füße|Füßen|Stiefel/],
        ['WRIST', /Armschiene|Handgelenk/], ['BACK', /Umhang|Rücken/], ['HEAD', /Kopf/], ['SHOULDER', /Schulter/], ['RANGED', /Fernkampf|Zielfernrohr/],
        ['OFF_HAND', /Schild/], ['MAIN_HAND', /Waffe|Nahkampf/]];
      const slots = words.filter(([, re]) => re.test(desc ?? '')).map(([s]) => s);
      return slots.length ? { enhance: { kind: 'item', slots, ...base, desc }, reagents } : null;
    }
    // Verbrauchsgüter (Tränke, Essen, Verbände) zeigt die Seite vorerst nicht.
    return null;
  }
  if (![2, 4].includes(cls) || it.inventory_type?.type === 'NON_EQUIP') return null;
  const p = it.preview_item ?? {};
  return {
    item: {
      ...base,
      inv: it.inventory_type?.type ?? null,
      cls,
      sub: it.item_subclass?.id ?? null,
      subName: it.item_subclass?.name ?? null,
      lines: (p.stats ?? []).map((s) => s.display?.display_string).filter(Boolean),
      stats: statMap(p.stats),
      armor: p.armor?.value ?? null,
      dps: p.weapon?.dps?.value ?? null,
    },
    reagents,
  };
}

// Name, Beschreibung und Icon eines Erfolgs aus den Spieldaten von Forever (deutsch). Das Profil nennt die Namen nur englisch.
async function achievementInfo(id) {
  ctx.achievements ??= new Map();
  if (!ctx.achievements.has(id)) {
    ctx.achievements.set(id, (async () => {
      const ns = config.namespaces.static;
      const [a, media] = await Promise.all([
        ctx.api(`/data/wow/achievement/${id}`, ns).catch(() => null),
        ctx.api(`/data/wow/media/achievement/${id}`, ns).catch(() => null),
      ]);
      return { name: a?.name ?? null, desc: a?.description ?? null, icon: media?.assets?.find((x) => x.key === 'icon')?.value ?? null };
    })());
  }
  return ctx.achievements.get(id);
}

async function achievementEvent(key, id, t) {
  const info = await achievementInfo(id);
  return info.name ? { t, key, type: 'achievement', id, ...info } : null;
}

// Inventartypen in der Zählung des Wowhead-Modellviewers.
// Lange Volksnamen kürzen, damit sie in die Tabelle passen: „Himmelsgeborener der Windformer“ → „Himmelsgeborener“.
function raceName(name) {
  return name ? name.replace(/^(Himmelsgeboren\S*) der .+$/, '$1') : name;
}

// Eine Funktion statt Konstante: Der Abruf läuft schon oben im Modul, bevor Konstanten weiter unten gesetzt sind.
function modelSlotIds() {
  return {
    HEAD: 1, SHOULDER: 3, BODY: 4, CHEST: 5, WAIST: 6, LEGS: 7, FEET: 8, WRIST: 9, HAND: 10,
    WEAPON: 13, SHIELD: 14, RANGED: 15, CLOAK: 16, TWOHWEAPON: 17, TABARD: 19, ROBE: 20,
    WEAPONMAINHAND: 21, WEAPONOFFHAND: 22, HOLDABLE: 23, RANGEDRIGHT: 26,
  };
}
function modelSlot(type) {
  return modelSlotIds()[type];
}

// Daten für das 3D-Modell: Rasse, Geschlecht, Aussehen und sichtbare Items (inklusive Transmog).
// Die Display-IDs liefert itemDisplay (Blizzard-Spieldaten, sonst Wowhead).
async function modelData(api, appearance, cache) {
  if (!appearance?.playable_race?.id) return null;
  const items = [];
  for (const it of appearance.items ?? []) {
    if (!cache.has(it.id)) cache.set(it.id, itemDisplay(api, it.id));
    const display = await cache.get(it.id);
    // Eine Einhandwaffe (13) in der Nebenhand gehört auf den Nebenhand-Slot (22), sonst überdeckt sie die Haupthand.
    if (display) items.push(it.slot?.type === 'OFF_HAND' && display[0] === 13 ? [22, display[1]] : display);
  }
  return {
    race: appearance.playable_race.id,
    gender: appearance.gender?.type === 'FEMALE' ? 1 : 0,
    options: (appearance.customizations ?? []).map((c) => ({ optionId: c.option.id, choiceId: c.choice.id })),
    items,
  };
}

// Display-ID und Slot eines Items für das 3D-Modell, in dieser Reihenfolge:
// 1. Spieldaten der Saison (Forever). Sie kennen nicht jedes Item (404 bei Questbelohnungen und neuen Forever-Items).
// 2. Wowhead-XML (/forever/item=<id>&xml). Es kennt auch neue Forever-Items, die Display-IDs stimmen mit 1. überein.
// 3. Retail-Spieldaten (static-<region>), falls Wowhead nicht antwortet.
async function itemDisplay(api, id) {
  const fromApi = async (ns) => {
    try {
      const item = await api(`/data/wow/item/${id}`, ns);
      const slot = modelSlot(item.inventory_type?.type);
      const appearanceId = item.appearances?.[0]?.id;
      if (!slot) return false;
      if (!appearanceId) return null;
      const ap = await api(`/data/wow/item-appearance/${appearanceId}`, ns);
      return ap.item_display_info_id ? [slot, ap.item_display_info_id] : null;
    } catch {
      return null;
    }
  };
  const fromWowhead = async () => {
    try {
      const env = config.wowhead ? `${config.wowhead}/` : '';
      const xml = await fetch(`https://www.wowhead.com/${env}item=${id}&xml`).then((r) => (r.ok ? r.text() : ''));
      const display = Number(xml.match(/displayId="(\d+)"/)?.[1]);
      const slot = Number(xml.match(/<inventorySlot id="(\d+)"/)?.[1]);
      return display && Object.values(modelSlotIds()).includes(slot) ? [slot, display] : null;
    } catch {
      return null;
    }
  };
  // false: Das Item ist nicht sichtbar (Ring, Hals, Schmuck). Dann ist keine weitere Quelle nötig.
  const first = await fromApi(config.namespaces.static);
  if (first !== null) return first || null;
  return (await fromWowhead()) ?? (await fromApi(`static-${config.region}`)) ?? null;
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
// Die Position kommt aus site/talents.json (build-talents.mjs). Die Seite baut daraus Baum und Rechner-Link.

function classSlug(id) {
  return { 1: 'warrior', 2: 'paladin', 3: 'hunter', 4: 'rogue', 5: 'priest', 6: 'death-knight', 7: 'shaman', 8: 'mage', 9: 'warlock', 10: 'monk', 11: 'druid', 12: 'demon-hunter', 13: 'evoker' }[id];
}

function pickTalents(specs, summary) {
  if (!specs) return null;
  const site = `https://www.wowhead.com${config.wowhead ? `/${config.wowhead}` : ''}`;
  const pick = (t, tree = null) => ({
    id: t.talent?.id ?? null,
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
  const cls = classSlug(summary.character_class?.id);
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
    spirit: v(s.spirit),
    armor: v(s.armor),
    attackPower: s.attack_power ?? null,
    spellPower: s.spell_power ?? null,
    dodge: pct(s.dodge),
    defense: v(s.defense),
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

// Blizzards Render-Server kennt nicht jedes neue Icon. Dann liefert Wowhead den Icon-Namen (in Forever aus /forever/).
async function resolveIcon(api, id) {
  const blizzard = await api(`/data/wow/media/item/${id}`, config.namespaces.static)
    .then((m) => m.assets?.find((a) => a.key === 'icon')?.value ?? null)
    .catch(() => null);
  if (blizzard && (await fetch(blizzard).then((r) => r.ok).catch(() => false))) return blizzard;
  const env = config.wowhead ? `${config.wowhead}/` : '';
  const name = await fetch(`https://nether.wowhead.com/${env}tooltip/item/${id}?locale=0`)
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
    if (res.status === 404) throw new Error('nicht gefunden (Profil erst ab Level 10 und nach Logout sichtbar; sonst Name und Nachname prüfen)');
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${path}`);
    return res.json();
  };
}

async function loadPrevious(url = process.env.PREVIOUS_DATA_URL, file = outFile, list = 'characters') {
  const map = new Map();
  try {
    const prev = url
      ? await fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      : existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
    // Nach dem Wechsel der Spielversion passt der alte Stand nicht mehr, auch bei gleichem Namen.
    if ((prev?.era ?? era) !== era) return map;
    for (const c of prev?.[list] ?? []) if (c.key && !c.demo) map.set(c.key, c);
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
// Für den Abend-Rückblick hält jede Session je Spieler Level, Itemlevel, Berufspunkte, Logout und Umskillen fest.
async function updateSessions(data) {
  const SESSION_WINDOW = 3 * 3600 * 1000;
  const QUIET = 3600 * 1000;
  const state = await loadState('sessions', () => ({ lastEnd: 0, levels: {}, base: {}, list: [] }));
  if (!process.env.GITHUB_ACTIONS) return state;

  const chars = data.characters.filter((c) => c.level && !c.error);
  const minPlayers = Math.max(2, Math.min(4, chars.length));
  const levels = Object.fromEntries(chars.map((c) => [c.key, c.level]));
  const base = Object.fromEntries(chars.map((c) => [c.key, sessionBase(c)]));

  if (!Object.keys(state.levels).length) {
    state.levels = levels;
    state.base = base;
    state.lastEnd = Math.max(0, ...chars.map((c) => c.lastLogin ?? 0));
  } else {
    const fresh = chars.filter((c) => c.lastLogin > state.lastEnd);
    const end = Math.max(0, ...fresh.map((c) => c.lastLogin));
    const players = fresh.filter((c) => end - c.lastLogin <= SESSION_WINDOW);
    if (players.length >= minPlayers && Date.now() - end >= QUIET) {
      const gains = players.filter((c) => state.levels[c.key] != null).map((c) => c.level - state.levels[c.key]);
      // Sessions bis sessionBaseline.until stecken schon in der Baseline. Sie setzen nur den Stand, ohne eigene Session.
      const counted = Date.parse(config.sessionBaseline?.until ?? '') || 0;
      if (gains.length && end >= counted) {
        state.list.push({
          start: Math.min(...players.map((c) => c.lastLogin)),
          end,
          gain: gains.reduce((a, b) => a + b, 0) / gains.length,
          players: players.map((c) => c.key),
          stats: Object.fromEntries(players.map((c) => [c.key, sessionStats(state.base?.[c.key], base[c.key], state.levels[c.key], c)])),
        });
      }
      // Auch Level aus Solo-Spiel der übrigen gelten damit als verbucht.
      state.levels = levels;
      state.base = base;
      state.lastEnd = end;
    }
  }
  await saveState('sessions', state);
  return state;
}

// Stand je Charakter zum Ende einer Session: Itemlevel, Berufspunkte und Talentränge.
function sessionBase(c) {
  return {
    ilvl: c.equippedIlvl ?? null,
    profs: Object.fromEntries((c.professions ?? []).map((p) => [p.name, p.skill ?? 0])),
    talents: Object.fromEntries((c.talents?.picks ?? []).filter((p) => p.id ?? p.spell).map((p) => [p.id ?? p.spell, p.rank ?? 1])),
  };
}

// Werte eines Spielers für eine Session. Umskillen heißt: Ein Talent hat danach weniger Ränge als vorher.
// profs: Punkte je Beruf (nur mit Zuwachs), für die Kachel Berufspunkte und den Tooltip je Spieler.
function sessionStats(before, now, levelBefore, c) {
  const profs = Object.fromEntries(Object.entries(now.profs).map(([n, v]) => [n, Math.max(0, v - (before?.profs?.[n] ?? v))]).filter(([, g]) => g > 0));
  const profGain = Object.values(profs).reduce((a, g) => a + g, 0);
  const respec = Object.entries(before?.talents ?? {}).some(([id, r]) => (now.talents[id] ?? 0) < r);
  return { level: [levelBefore ?? c.level, c.level], ilvl: [before?.ilvl ?? now.ilvl, now.ilvl], prof: profGain, profs, logout: c.lastLogin, respec };
}

// Stand eines Charakters für die Aktivität. Squad und Gilde vergleichen ihn bei jedem Abruf mit dem letzten Stand.
// Fehlt die Liste der Erfolge (Abruf fehlgeschlagen), bleibt die alte. So meldet der nächste Lauf nicht alle Erfolge neu.
function activitySnapshot(c, old) {
  const items = (c.items ?? []).filter((i) => i.id);
  return {
    level: c.level,
    lastLogin: c.lastLogin ?? null,
    items: Object.fromEntries(items.map((i) => [i.slot, i.id])),
    ilvls: Object.fromEntries(items.map((i) => [i.slot, i.ilvl ?? null])),
    // Namen der angelegten Items. Ein neues Item merkt sich so den Namen des alten (prevName im Ereignis), die Seite zeigt ihn derzeit nicht.
    names: Object.fromEntries(items.map((i) => [i.slot, i.name ?? null])),
    profs: Object.fromEntries((c.professions ?? []).map((p) => [p.name, p.skill ?? 0])),
    achs: c.achievements ? c.achievements.map(([id]) => id) : old?.achs ?? null,
  };
}

// Ereignisse aus dem Vergleich: Level-Ups, neue Items, Berufe und Erfolge.
// Fehlt ein Teil im alten Stand, legt dieser Lauf ihn nur fest, ohne Ereignisse.
// Ein Ereignis bekommt den Zeitpunkt des Logouts, in dem es passiert ist, sonst den des Abrufs.
async function activityEvents(c, old, now, qualities) {
  const out = [];
  const t = c.lastLogin && c.lastLogin > (old.lastLogin ?? 0) ? c.lastLogin : now;
  const base = { t, key: c.key };
  if (old.level != null && c.level > old.level) out.push({ ...base, type: 'level', from: old.level, to: c.level, max: c.level >= config.maxLevel });
  if (old.items) {
    for (const it of c.items ?? []) {
      if (!it.id || old.items[it.slot] === it.id || !qualities.includes(it.quality)) continue;
      // Ringe und Schmuckstücke tauschen beim Umsortieren nur den Platz.
      if (Object.values(old.items).includes(it.id)) continue;
      out.push({ ...base, type: 'item', id: it.id, name: it.name, quality: it.quality, icon: it.icon, slot: it.slotName ?? it.slot, ilvl: it.ilvl ?? null, prev: old.ilvls?.[it.slot] ?? null, prevName: old.names?.[it.slot] ?? null });
    }
  }
  if (old.profs) {
    for (const p of c.professions ?? []) {
      const before = old.profs[p.name];
      const skill = p.skill ?? 0;
      // Meilensteine alle 75 Punkte (Classic-Stufen) und beim Erreichen des Maximums.
      if (before == null) out.push({ ...base, type: 'prof', name: p.name, skill, learned: true });
      else if (Math.floor(skill / 75) > Math.floor(before / 75) || (p.max && skill >= p.max && before < p.max)) out.push({ ...base, type: 'prof', name: p.name, skill });
    }
  }
  // Neue Erfolge mit ihrem genauen Zeitpunkt.
  if (old.achs && c.achievements) {
    for (const [id, at] of c.achievements) {
      if (old.achs.includes(id)) continue;
      const e = await achievementEvent(c.key, id, at);
      if (e) out.push(e);
    }
  }
  return out;
}

// Aktivitäts-Feed des Squads: Jeder Abruf wird mit dem letzten Stand je Charakter verglichen (snapshot),
// Änderungen werden Ereignisse (activityEvents). Dazu kommen Gildenwechsel und gemeinsame Sessions.
async function updateFeed(data, sessions) {
  const FEED_LIMIT = 1500;
  // Grüne Items zählen nur für den Abend-Rückblick. Die Aktivität zeigt sie nicht.
  const FEED_QUALITIES = ['UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT'];
  const feed = await loadState('feed', () => ({ snapshot: {}, events: [] }));
  if (!process.env.GITHUB_ACTIONS) return feed;
  const now = Date.now();
  const add = (e) => feed.events.push(e);

  for (const c of data.characters) {
    if (c.error || !c.level) continue;
    const old = feed.snapshot[c.key];
    feed.snapshot[c.key] = { ...activitySnapshot(c, old), guild: c.guild ?? null };
    if (!old) continue;

    for (const e of await activityEvents(c, old, now, FEED_QUALITIES)) add(e);
    // Steht derselbe Wechsel schon als letztes Gilden-Ereignis im Feed (Gildengründung von Hand eingetragen), kommt kein zweites.
    const lastGuild = feed.events.filter((e) => e.key === c.key && e.type === 'guild').at(-1);
    if ((c.guild ?? null) !== (old.guild ?? null) && (lastGuild?.guild ?? null) !== (c.guild ?? null)) {
      const t = c.lastLogin && c.lastLogin > (old.lastLogin ?? 0) ? c.lastLogin : now;
      add({ t, key: c.key, type: 'guild', guild: c.guild ?? null, from: old.guild ?? null });
    }
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

// ---------------------------------------------------------------------------
// Gilde

// Mitglieder: config.guild.members und die Charaktere aus characters (ohne Platzhalter), die laut Profil in der Gilde sind.
// Ein Gruppen-Charakter zählt erst, wenn sein Profil die Gilde nennt (Feld guild, siehe buildGuild).
// Ein Eintrag in members mit gleichem Namen wie ein Gruppen-Charakter nimmt ihn fest auf.
// Gruppen-Charaktere ruft der Abruf nicht zweimal ab. Schlägt ein Mitglied fehl, bleibt sein letzter Stand.
function guildEntries() {
  const g = config.guild;
  const ranks = g.ranks ?? [];
  const fallback = ranks.includes('Mitglied') ? 'Mitglied' : ranks.at(-1) ?? 'Mitglied';
  const list = new Map();
  for (const e of config.characters) {
    if (!e.realm && !e.surname) continue;
    list.set(charKey(e), { ...e, squadOnly: true, rank: e.rank ?? fallback });
  }
  for (const e of g.members ?? []) {
    if (!e.realm && !e.surname) continue;
    const key = charKey(e);
    list.set(key, { ...list.get(key), ...e, squadOnly: false, rank: e.rank ?? list.get(key)?.rank ?? fallback });
  }
  return [...list.values()];
}

function guildMeta(members) {
  return {
    generatedAt: new Date().toISOString(),
    name: config.guild.name ?? config.title,
    era,
    modelEnv: config.modelEnv ?? 'classic',
    wowhead: config.wowhead,
    maxLevel: config.maxLevel,
    ranks: config.guild.ranks ?? [],
    members,
  };
}

async function buildGuild(data) {
  const previous = await loadPrevious(previousGuildUrl(), new URL('site/guild.json', root), 'members');
  const group = new Map(data.characters.map((c) => [c.key, c]));
  const members = [];
  for (const entry of guildEntries()) {
    const key = charKey(entry);
    try {
      // Gruppen-Charaktere kommen aus data.json, auch ihr Fehler. Kein zweiter Abruf.
      // Hat data.json einen alten Stand (stale), gilt dieser auch hier. Sonst greift der letzte Stand der Gilde.
      const squad = group.get(key);
      // Gruppen-Charakter ohne Gilde im Profil: (noch) kein Mitglied. Das Profil zeigt die Gilde erst nach dem nächsten Logout.
      if (entry.squadOnly && (!squad?.level || (squad.guild ?? null) !== (config.guild.name ?? config.title))) {
        console.log(`gilde   ${key} nicht in der Gilde (Profil: ${squad?.guild ?? 'keine'})`);
        continue;
      }
      if (squad?.error && !squad.level) throw new Error(squad.error);
      const c = squad ?? (await fetchCharacter(ctx.api, entry, ctx.caches));
      members.push({ ...c, rank: entry.rank });
      if (!group.has(key)) console.log(`gilde   ${key}`);
    } catch (err) {
      console.warn(`gilde   ${key}: ${err.message}`);
      const old = previous.get(key);
      members.push(old ? { ...old, rank: entry.rank, stale: true, error: err.message } : { key, name: entry.name, surname: entry.surname ?? null, rank: entry.rank, error: err.message });
    }
  }
  return guildMeta(members);
}

// Die letzte veröffentlichte guild.json liegt neben der data.json.
function previousGuildUrl() {
  const url = process.env.PREVIOUS_DATA_URL;
  return url ? url.replace(/data\.json$/, 'guild.json') : null;
}

// ---------------------------------------------------------------------------
// Quests des Squads. Die Profile nennen nur IDs, Titel und Zone kommen deutsch aus den Spieldaten (/data/wow/quest).
// Quests ändern sich nur mit einem Patch. Ihre Daten liegen darum in data/quests.json, die Action speichert sie, ein lokaler Lauf nur im Speicher.
// k markiert Klassenquests: Die Quest verlangt höchstens 3 Klassen. Einträge ohne k stammen von früher und kommen neu.
async function buildQuests(chars) {
  const file = new URL('data/quests.json', root);
  const ns = config.namespaces.static;
  const stored = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
  const cache = stored?.ns === ns ? stored.quests : {};
  const ids = [...new Set(chars.flatMap((c) => [...(c.quests?.open ?? []), ...(c.quests?.done ?? [])]))];
  const missing = ids.filter((id) => !(id in cache) || (cache[id] && !('k' in cache[id])));
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < missing.length) {
      const id = missing[next++];
      const q = await ctx.api(`/data/wow/quest/${id}`, ns).catch(() => null);
      const classes = q?.requirements?.classes?.length ?? 0;
      cache[id] = q ? { t: q.title ?? null, z: q.area?.name ?? null, k: classes > 0 && classes <= 3 } : null;
    }
  }));
  if (missing.length && process.env.GITHUB_ACTIONS) {
    await mkdir(new URL('data/', root), { recursive: true });
    await writeFile(file, JSON.stringify({ ns, quests: cache }) + '\n');
  }
  console.log(`Quests: ${ids.length} bekannt (${missing.length} neu abgerufen).`);
  return Object.fromEntries(ids.filter((id) => cache[id]?.t).map((id) => [id, cache[id]]));
}

// Jeder Abruf vergleicht die abgeschlossenen Quests mit dem letzten Stand. Neue bekommen den Zeitpunkt des letzten Logouts
// und das Level des Charakters (lv). Die API kennt kein Quest-Level, das Level beim Abschluss ersetzt es.
// Ältere Einträge ohne lv bekommen das Level aus dem Verlauf (history) am Tag des Logouts.
// Der Verlauf hält 30 Tage. Der erste Lauf je Charakter legt nur den Stand fest.
async function updateQuestLog(data, history) {
  const log = await loadState('quest-log', () => ({ snapshot: {}, events: [] }));
  if (!process.env.GITHUB_ACTIONS) return log;
  const now = Date.now();
  const levelAt = (key, t) => {
    const day = new Date(t).toISOString().slice(0, 10);
    const list = history?.chars?.[key] ?? [];
    const point = list.filter((p) => p.d <= day).at(-1) ?? list[0];
    return point?.level ?? data.characters.find((c) => c.key === key)?.level ?? null;
  };
  for (const e of log.events) if (e.lv == null) e.lv = levelAt(e.key, e.t);
  for (const c of data.characters) {
    if (c.error || !c.quests?.done) continue;
    const old = log.snapshot[c.key];
    log.snapshot[c.key] = c.quests.done;
    if (!old) continue;
    const before = new Set(old);
    const t = c.lastLogin ?? now;
    for (const id of c.quests.done) if (!before.has(id)) log.events.push({ t, key: c.key, id, lv: c.level ?? null });
  }
  log.events = log.events.filter((e) => now - e.t < 30 * 864e5).sort((a, b) => a.t - b.t);
  await saveState('quest-log', log);
  return log;
}

// Testdaten: Beispiel-Charaktere bekommen Teile der echten Questlogs, damit sich die Questlogs vergleichen lassen.
function demoQuests(chars) {
  const real = chars.filter((c) => !c.demo && c.quests);
  if (!real.length) return;
  chars.filter((c) => c.demo && !c.quests).forEach((c, i) => {
    const a = real[i % real.length].quests;
    const b = real[(i + 1) % real.length].quests;
    c.quests = { open: [...a.open.slice(0, 10), ...b.open.slice(3, 9)], done: [...new Set([...a.done.slice(0, Math.floor(a.done.length * 0.7)), ...b.done.slice(0, 40)])] };
  });
}

// Testverlauf: Der Charakter, der am längsten offline ist, hat die letzte Runde verpasst. Die anderen schließen in der Zeit Quests ab.
function demoQuestLog(data) {
  const chars = data.characters.filter((c) => c.level && c.quests);
  const away = [...chars].sort((a, b) => (a.lastLogin ?? 0) - (b.lastLogin ?? 0))[0];
  if (!away) return { events: [] };
  const mine = new Set([...(away.quests.done ?? []), ...(away.quests.open ?? [])]);
  const start = Math.max(away.lastLogin ?? 0, Date.now() - 12 * 36e5) + 36e5;
  // Die Seite zeigt nur Quests, die mindestens 2 andere abgeschlossen haben. Darum nimmt der Test solche Quests.
  const others = chars.filter((c) => c !== away);
  const count = new Map();
  for (const c of others) for (const id of c.quests.done) count.set(id, (count.get(id) ?? 0) + 1);
  const ids = [...count].filter(([id, n]) => n >= 2 && !mine.has(id) && data.questInfo?.[id]?.z && !data.questInfo[id].k).map(([id]) => id).slice(-12);
  const events = [];
  ids.forEach((id, k) => others.filter((c) => c.quests.done.includes(id)).forEach((c, i) => events.push({ t: start + (k * 3 + i) * 600e3, key: c.key, id, lv: c.level })));
  return { events: events.sort((a, b) => a.t - b.t) };
}

// Nur mit --guild-demo: Squad-Charaktere ohne Profil (und Platzhalter) übernehmen Gildenmitglieder mit Daten,
// erst die echten, dann die Beispiele. So zeigen Squad und Gilde dieselben Charaktere und lassen sich vergleichen.
// Dazu kommt ein Beispiel-Feed für die Startseite. data/ bleibt unberührt.
async function fillSquad(data, guild) {
  const used = new Set(data.characters.filter((c) => !c.error).map((c) => c.key));
  const spare = guild.members.filter((m) => !m.error && m.level && !used.has(m.key)).sort((a, b) => !!a.demo - !!b.demo);
  data.characters = data.characters.map((c) => (c.error && spare.length ? spare.shift() : c));
  demoQuests(data.characters);
  data.crafts = await buildCrafts(data.characters);
  data.statNames = ctx.statNames ?? {};
  data.questInfo = await buildQuests(data.characters);
  await writeFile(outFile, JSON.stringify(data, null, 2) + '\n');
  await writeFile(new URL('site/feed.json', root), JSON.stringify(demoFeed(data)) + '\n');
  console.log(`Squad mit Test-Charakteren gefüllt: ${data.characters.map((c) => c.name).join(', ')}`);
}

// Gilden-Feed: Jeder Abruf vergleicht die Mitgliederliste und je Mitglied den Stand wie im Squad (activityEvents):
// jedes Level-Up, neue Items ab Rar, Berufe und Erfolge. Die Gilde ist klein, darum steht alles im Feed.
// Wer aus config.guild.members verschwindet, gilt als ausgetreten. Das Ereignis trägt den Namen, weil der Eintrag fehlt.
// Eine Namenskorrektur in config.json ist kein Austritt mit Beitritt: Verschwindet ein Eintrag und kommt im selben Lauf
// ein neuer dazu, mit gleicher Charakter-ID, gleichem Vornamen oder ohne je geladenes Profil, zieht nur der Stand um.
async function updateGuildFeed(guild) {
  const FEED_LIMIT = 1500;
  // Ohne grüne Items: Die Gilde hat keinen Abend-Rückblick, der sie braucht.
  const FEED_QUALITIES = ['RARE', 'EPIC', 'LEGENDARY', 'ARTIFACT'];
  const feed = await loadState('guild-feed', () => ({ members: null, snapshot: {}, events: [] }));
  if (!process.env.GITHUB_ACTIONS) return feed;
  const now = Date.now();
  const add = (e) => feed.events.push(e);
  const keys = guild.members.map((m) => m.key);

  if (feed.members) {
    const added = guild.members.filter((m) => !feed.members.includes(m.key));
    const renamed = new Set();
    const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
    for (const k of feed.members) {
      if (keys.includes(k)) continue;
      const snap = feed.snapshot[k] ?? {};
      const to = added.find((m) => !renamed.has(m.key) && ((snap.id && m.id === snap.id) || same(m.name, snap.name) || snap.level == null));
      delete feed.snapshot[k];
      if (to) {
        renamed.add(to.key);
        feed.snapshot[to.key] = snap;
        console.log(`gilde   ${k} heißt jetzt ${to.key}`);
        continue;
      }
      // Ein Eintrag ohne je geladenes Profil war nie sichtbar. Sein Wegfall ist kein Austritt.
      if (snap.level == null) continue;
      add({ t: now, key: k, type: 'leave', name: snap.name ?? k, surname: snap.surname ?? null, classId: snap.classId ?? null });
    }
    for (const m of added) if (!renamed.has(m.key)) add({ t: now, key: m.key, type: 'join' });
  }
  feed.members = keys;

  for (const m of guild.members) {
    const old = feed.snapshot[m.key];
    const snap = { ...old, id: m.id ?? old?.id ?? null, name: m.name, surname: m.surname ?? null, classId: m.classId ?? old?.classId ?? null, rank: m.rank };
    // Ein Fehler oder ein alter Stand (stale) ändert nichts. Sonst kämen beim nächsten Abruf alte Änderungen erneut.
    const fresh = !m.error && !m.stale && m.level;
    if (fresh) Object.assign(snap, activitySnapshot(m, old));
    feed.snapshot[m.key] = snap;
    if (!old || !fresh) continue;
    for (const e of await activityEvents(m, old, now, FEED_QUALITIES)) add(e);
  }

  feed.events.sort((a, b) => a.t - b.t);
  feed.events = feed.events.slice(-FEED_LIMIT);
  await saveState('guild-feed', feed);
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

// Forever kennt keine Realms: Dort heißt der Charakter "name-nachname" (klein, Umlaute bleiben).
function charKey(entry) {
  if (!entry.realm && !entry.surname) return `offen/${entry.name.toLowerCase()}`;
  if (entry.surname) return `${entry.name}-${entry.surname}`.toLowerCase().replace(/\s+/g, '-');
  return `${realmSlug(entry.realm)}/${entry.name.toLowerCase()}`;
}

function charPath(entry) {
  if (entry.surname) return encodeURIComponent(charKey(entry));
  return `${realmSlug(entry.realm)}/${encodeURIComponent(entry.name.toLowerCase())}`;
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
  const chars = [
    ['Thoradin', 60, 1, 'Krieger', 'Zwerg', 'ALLIANCE', 'Die Unbeugsamen', ['EPIC', 'RARE', 'RARE', 'EPIC']],
    ['Lunaria', 58, 8, 'Magier', 'Gnom', 'ALLIANCE', 'Die Unbeugsamen', ['RARE', 'UNCOMMON', 'RARE']],
    ['Kaelwyn', 47, 3, 'Jäger', 'Nachtelf', 'ALLIANCE', null, ['UNCOMMON', 'RARE', 'COMMON']],
    ['Brumhild', 52, 2, 'Paladin', 'Mensch', 'ALLIANCE', 'Die Unbeugsamen', ['RARE', 'UNCOMMON']],
    ['Schattenfell', 33, 4, 'Schurke', 'Mensch', 'ALLIANCE', null, ['UNCOMMON', 'COMMON']],
  ];

  return {
    generatedAt: new Date().toISOString(),
    title: config.title,
    launch: config.launch ?? null,
    era: 'classic',
    modelEnv: config.modelEnv ?? 'classic',
    wowhead: config.wowhead || 'classic',
    maxLevel: 60,
    characters: chars.map(([name, level, classId, className, race, faction, guild, q], i) => ({
      key: `demo/${name.toLowerCase()}`,
      demo: true,
      name, realmName: 'Demo-Realm', level, classId, className, race, faction, guild,
      avgIlvl: 30 + level / 2, equippedIlvl: 28 + level / 2,
      lastLogin: Date.now() - i * 5 * 3600 * 1000,
      avatar: null,
      items: demoGear(q).slice(0, 15 - i),
      professions: [{ name: 'Mining', kind: 'primary', skill: 150 + i * 20, max: 225 }, { name: 'Cooking', kind: 'secondary', skill: 75, max: 150 }],
      talents: demoTalents(classId, level),
      stats: demoStats(classId, level),
    })),
  };
}

// Ausrüstung für Beispiel-Charaktere: q gibt die Qualitäten reihum vor, base das niedrigste Itemlevel.
function demoGear(q, base = 30) {
  const icon = (n) => `https://wow.zamimg.com/images/wow/icons/large/${n}.jpg`;
  return [
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
    slot, slotName, id: null, name, quality: q[i % q.length], ilvl: base + i, enchants: i === 4 ? ['+4 Werte'] : [], icon: icon(ic),
  }));
}

// Talente für Beispiel-Charaktere. Verteilt die Punkte von oben nach unten auf die echten Bäume (60 / 40 / 0),
// damit die Demo vollständige Bäume zeigt. main wählt den Baum mit den meisten Punkten.
function demoTalents(classId, level, main = 0) {
  const layout = JSON.parse(readFileSync(new URL('../site/talents.json', import.meta.url), 'utf8')).classes;
  const points = Math.max(0, level - 9);
  const split = [0, 0, 0];
  split[main] = Math.ceil(points * 0.6);
  split[(main + 1) % 3] = Math.floor(points * 0.4);
  const picks = [];
  const trees = layout[classId].map((tree, i) => {
    let left = split[i], spent = 0;
    for (const t of tree.talents) {
      if (!left || t.tier * 5 > spent) continue;
      const rank = Math.min(t.ranks.length, left);
      picks.push({ id: t.id, name: t.name, spell: t.ranks[rank - 1], rank, tree: tree.name });
      left -= rank;
      spent += rank;
    }
    return { name: tree.name, points: spent };
  });
  return { trees, hero: null, picks, total: points, calc: `https://www.wowhead.com/${config.wowhead || 'classic'}/talent-calc/${classSlug(classId)}` };
}

// Beispiel-Feed für die Demo: ein paar Tage mit Level-Ups, Items, Berufen und einer Session.
async function withAchievements(feed, data) {
  for (const c of data.characters) {
    if (c.demo) continue;
    for (const [id, at] of c.achievements ?? []) {
      const e = await achievementEvent(c.key, id, at);
      if (e) feed.events.push(e);
    }
  }
  feed.events.sort((a, b) => a.t - b.t);
  return feed;
}

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

// Beispiel-Gilde: füllt members mit erfundenen Horde-Charakteren auf 15 Mitglieder auf (verändert die Liste).
// Mit --demo gibt es nur Beispiel-Mitglieder, mit --guild-demo kommen sie zu den echten dazu.
// Das Aussehen leihen sie sich von einem echten Mitglied gleichen Volks, sonst nur Volk und Geschlecht.
// Zwei Mitglieder sind länger als 14 Tage offline, damit die Seite den Zustand „inaktiv“ zeigt.
function buildDemoGuild(members) {
  const h = 3600 * 1000;
  const RACES = { 2: 'Orc', 5: 'Untoter', 6: 'Tauren', 8: 'Troll' };
  const CLASS_NAMES = { 1: 'Krieger', 3: 'Jäger', 4: 'Schurke', 5: 'Priester', 7: 'Schamane', 8: 'Magier', 9: 'Hexenmeister', 11: 'Druide' };
  const prof = (name, skill, kind = 'primary') => ({ name, kind, skill, max: skill < 75 ? 75 : skill < 150 ? 150 : 225 });
  const list = [
    ['Grimbart', 'Grollzahn', 1, 2, 0, 34, 'Offizier', 3, ['Mining', 160], ['Blacksmithing', 145], 2, ['RARE', 'UNCOMMON']],
    ['Ilsa', 'Funkenschlag', 8, 8, 1, 41, 'Veteran', 20, ['Tailoring', 205], ['Enchanting', 180], 0, ['EPIC', 'RARE', 'UNCOMMON']],
    ['Mira', 'Moorlicht', 5, 5, 1, 31, 'Mitglied', 6, ['Herbalism', 150], ['Alchemy', 140], 1, ['UNCOMMON', 'RARE']],
    ['Tusk', 'Donnerhuf', 11, 6, 0, 29, 'Mitglied', 30, ['Skinning', 140], ['Leatherworking', 130], 2, ['UNCOMMON']],
    ['Zalja', 'Knochenruf', 7, 8, 1, 27, 'Mitglied', 52, ['Mining', 120], ['Engineering', 110], 2, ['UNCOMMON', 'COMMON']],
    ['Hogar', 'Hufschlag', 1, 6, 0, 15, 'Rekrut', 20 * 24, ['Mining', 60], ['Blacksmithing', 45], 0, ['COMMON']],
    ['Nekra', 'Nachtsang', 4, 5, 1, 12, 'Mitglied', 35 * 24, ['Skinning', 40], ['Herbalism', 35], 1, ['COMMON']],
    ['Vex', 'Schattenschritt', 9, 5, 0, 24, 'Mitglied', 75, ['Tailoring', 105], ['Enchanting', 90], 1, ['UNCOMMON', 'COMMON']],
    ['Gromma', 'Gerstensaft', 7, 2, 1, 19, 'Rekrut', 110, ['Herbalism', 85], ['Alchemy', 70], 1, ['COMMON', 'UNCOMMON']],
    ['Brakk', 'Eisenfaust', 3, 2, 0, 22, 'Rekrut', 400, ['Skinning', 100], ['Leatherworking', 95], 1, ['UNCOMMON', 'COMMON']],
  ];
  const models = members.filter((m) => m.model);
  for (const [name, surname, classId, raceId, gender, level, rank, hoursAgo, p1, p2, main, q] of list) {
    if (members.length >= 15) break;
    const talents = demoTalents(classId, level, main);
    const spec = [...talents.trees].sort((a, b) => b.points - a.points)[0]?.name ?? null;
    const borrow = models.find((m) => m.model.race === raceId) ?? models[0];
    const ilvl = Math.max(5, Math.round(level * 0.75));
    members.push({
      key: `demo/${name.toLowerCase()}-${surname.toLowerCase()}`,
      demo: true,
      name, surname, level, classId, className: CLASS_NAMES[classId], race: RACES[raceId],
      gender: gender ? 'FEMALE' : 'MALE', faction: 'HORDE', rank,
      avgIlvl: ilvl, equippedIlvl: ilvl,
      lastLogin: Date.now() - hoursAgo * h,
      spec, role: classicRole(classId, spec),
      render: null,
      items: demoGear(q, ilvl - 7).slice(0, 10 + (level % 6)),
      professions: [prof(...p1), prof(...p2), prof('Cooking', Math.min(225, level * 4), 'secondary'), prof('First Aid', Math.min(225, level * 5), 'secondary')],
      talents,
      stats: demoStats(classId, level),
      model: borrow ? { race: raceId, gender, options: borrow.model.race === raceId && borrow.model.gender === gender ? borrow.model.options : [], items: borrow.model.items } : null,
    });
  }
  return guildMeta(members);
}

// Beispiel-Feed der Gilde: Beitritte, ein Austritt, Level-Ups, Items und Berufe der letzten Tage.
function demoGuildFeed(guild) {
  const h = 3600 * 1000;
  const now = Date.now();
  const ok = guild.members.filter((m) => m.level);
  const events = [];
  ok.forEach((m, i) => {
    const t = now - (i % 5) * 22 * h - (i + 1) * 1.3 * h;
    for (let lv = Math.max(1, m.level - 2); lv < m.level; lv++) {
      events.push({ t: t - (m.level - lv) * 3 * h, key: m.key, type: 'level', from: lv, to: lv + 1, max: lv + 1 >= 60 });
    }
    if (i % 3 === 2) events.push({ t: t - 30 * h, key: m.key, type: 'join' });
    const it = (m.items ?? []).find((x) => x.quality === 'EPIC' || x.quality === 'RARE');
    if (it) events.push({ t: t + 0.5 * h, key: m.key, type: 'item', id: it.id, name: it.name, quality: it.quality, icon: it.icon, slot: it.slotName });
    const p = (m.professions ?? [])[0];
    if (p && i % 2) events.push({ t: t + h, key: m.key, type: 'prof', name: p.name, skill: Math.floor((p.skill ?? 0) / 75) * 75 || p.skill });
  });
  events.push({ t: now - 50 * h, key: 'demo/durotan-dauerafk', type: 'leave', name: 'Durotan', surname: 'Dauerafk', classId: 1 });
  return { era: guild.era, events: events.sort((a, b) => a.t - b.t) };
}

// Werte für Beispiel-Charaktere: grob nach Level und Klasse, damit Loadout und Detail die Werte-Liste zeigen.
function demoStats(classId, level) {
  const caster = [5, 8, 9].includes(classId);
  const power = { 1: 'Wut', 4: 'Energie' }[classId] ?? 'Mana';
  const main = Math.round(20 + level * 2.2);
  const low = Math.round(15 + level * 1.1);
  return {
    health: 60 + level * 32, power: power === 'Mana' ? 80 + level * 30 : 100, powerType: power,
    strength: caster ? low : main, agility: [3, 4].includes(classId) ? main : low, intellect: caster ? main : low,
    stamina: Math.round(20 + level * 1.8), spirit: low, armor: (caster ? 20 : 45) * level,
    attackPower: caster ? 0 : level * 8, spellPower: caster ? level * 2 : 0, crit: 5 + level / 10, dodge: 3 + level / 20, defense: level * 5,
  };
}

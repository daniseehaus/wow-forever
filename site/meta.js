// Spielwissen für die abgeleiteten Ansichten (Berufe, Zonen, Dungeons, Klassenaufgaben).
// Alles bezieht sich auf WoW Forever: 9 Klassen (Krieger, Paladin, Jäger, Schurke, Priester, Schamane,
// Magier, Hexenmeister, Druide), Level 60. Paladin und Schamane gibt es in beiden Fraktionen.
// Stand Forever 1.60.1 (geprüft am 08.11.2026): neue Zonen, Dungeons und Raids aus Wowhead Forever (IDs) und
// den Leveling-Guides (Stufen). Stufen ohne offizielle Angabe sind als unbestätigt markiert.

window.META = (() => {
  // Todesritter, Mönch, Dämonenjäger und Rufer gibt es in Forever nicht. Sie bleiben nur für die
  // Farben der aktuellen Retail-Testcharaktere in der Liste.
  const CLASSES = {
    1: { name: 'Krieger', color: '#C69B6D' },
    2: { name: 'Paladin', color: '#F48CBA' },
    3: { name: 'Jäger', color: '#AAD372' },
    4: { name: 'Schurke', color: '#FFF468' },
    5: { name: 'Priester', color: '#F0F0FF' },
    6: { name: 'Todesritter', color: '#FF3A5E' },
    7: { name: 'Schamane', color: '#2E8FFF' },
    8: { name: 'Magier', color: '#3FC7EB' },
    9: { name: 'Hexenmeister', color: '#8788EE' },
    10: { name: 'Mönch', color: '#00FF98' },
    11: { name: 'Druide', color: '#FF7C0A' },
    12: { name: 'Dämonenjäger', color: '#A330C9' },
    13: { name: 'Rufer', color: '#33937F' },
  };

  const PROFESSIONS = {
    Alchemy: 'Alchemie', Blacksmithing: 'Schmiedekunst', Enchanting: 'Verzauberkunst', Engineering: 'Ingenieurskunst',
    Herbalism: 'Kräuterkunde', Inscription: 'Inschriftenkunde', Jewelcrafting: 'Juwelierskunst', Leatherworking: 'Lederverarbeitung',
    Mining: 'Bergbau', Skinning: 'Kürschnerei', Tailoring: 'Schneiderei', Cooking: 'Kochkunst', Fishing: 'Angeln',
    Archaeology: 'Archäologie', 'First Aid': 'Erste Hilfe',
  };

  const PRIMARY_PROFESSIONS = ['Alchemie', 'Schmiedekunst', 'Verzauberkunst', 'Ingenieurskunst', 'Kräuterkunde', 'Lederverarbeitung', 'Bergbau', 'Kürschnerei', 'Schneiderei'];

  // Fraktion: A = Allianz, H = Horde, N = beide.
  // Wir spielen Horde: Allianz-Gebiete und -Dungeons stehen nicht in der Liste.
  const ZONES = [
    { name: 'Durotar', id: 14, min: 1, max: 10, f: 'H' },
    // Forever: Startgebiet der Himmelsgeborenen.
    { name: 'Die Insel Zephras', id: 16593, min: 1, max: 12, f: 'N' },
    { name: 'Mulgore', id: 215, min: 1, max: 10, f: 'H' }, { name: 'Tirisfal', id: 85, min: 1, max: 10, f: 'H' },
    { name: 'Brachland', id: 17, min: 10, max: 25, f: 'H' },
    { name: 'Silberwald', id: 130, min: 10, max: 20, f: 'H' },
    { name: 'Steinkrallengebirge', id: 406, min: 15, max: 27, f: 'N' }, { name: 'Ashenvale', id: 331, min: 18, max: 30, f: 'N' },
    { name: 'Vorgebirge von Hillsbrad', id: 267, min: 20, max: 30, f: 'N' }, { name: 'Tausend Nadeln', id: 400, min: 25, max: 35, f: 'N' },
    { name: 'Arathihochland', id: 45, min: 30, max: 40, f: 'N' }, { name: 'Desolace', id: 405, min: 30, max: 40, f: 'N' },
    // Forever: Flusslande laut Blizzard Mitte 30 bis Mitte 40. Shen'dralas zwischen Mulgore und Desolace, Stufe aus der Beta (unbestätigt).
    { name: 'Flusslande', id: 16591, min: 36, max: 44, f: 'N' }, { name: "Shen'dralas", id: 16651, min: 38, max: 43, f: 'N' },
    { name: 'Schlingendorntal', id: 33, min: 30, max: 45, f: 'N' }, { name: 'Marschen von Dustwallow', id: 15, min: 35, max: 45, f: 'N' },
    { name: 'Ödland', id: 3, min: 35, max: 45, f: 'N' }, { name: 'Sümpfe des Elends', id: 8, min: 35, max: 45, f: 'N' },
    { name: 'Feralas', id: 357, min: 40, max: 50, f: 'N' }, { name: 'Tanaris', id: 440, min: 40, max: 50, f: 'N' },
    { name: 'Hinterland', id: 47, min: 40, max: 50, f: 'N' }, { name: 'Sengende Schlucht', id: 51, min: 43, max: 50, f: 'N' },
    { name: 'Azshara', id: 16, min: 45, max: 55, f: 'N' }, { name: 'Verwüstete Lande', id: 4, min: 45, max: 55, f: 'N' },
    { name: "Un'Goro-Krater", id: 490, min: 48, max: 55, f: 'N' }, { name: 'Teufelswald', id: 361, min: 48, max: 55, f: 'N' },
    { name: 'Brennende Steppe', id: 46, min: 50, max: 58, f: 'N' }, { name: 'Westliche Pestländer', id: 28, min: 51, max: 58, f: 'N' },
    { name: 'Östliche Pestländer', id: 139, min: 53, max: 60, f: 'N' }, { name: 'Winterspring', id: 618, min: 55, max: 60, f: 'N' },
    { name: 'Silithus', id: 1377, min: 55, max: 60, f: 'N' },
    // Forever: Berg Hyjal nach Archimonde, Stufe laut Fanseiten (unbestätigt).
    { name: 'Hyjal', id: 616, min: 55, max: 60, f: 'N' },
  ];

  const DUNGEONS = [
    { name: 'Ragefireabgrund', id: 2437, min: 13, max: 18, f: 'H' },
    // Forever: neun neue Dungeons. Die Halle der Thanen liegt unter Ironforge (Allianz) und fehlt deshalb.
    { name: 'Die Ruinen von Lordaeron', id: 16611, min: 15, max: 20, f: 'H' },
    { name: 'Die Höhlen des Wehklagens', id: 718, min: 17, max: 24, f: 'N' }, { name: 'Burg Shadowfang', id: 209, min: 22, max: 30, f: 'N' },
    { name: 'Blackfathom-Tiefe', id: 719, min: 24, max: 32, f: 'N' },
    { name: 'Ausgrabungsstätte: Sumpfland', id: 16732, min: 24, max: 29, f: 'N' }, { name: 'Dalaran', id: 16560, min: 28, max: 33, f: 'N' },
    { name: 'Die Versunkene Stadt', id: 16550, min: 35, max: 40, f: 'N' }, { name: "Feste Krol'dok", id: 16842, min: 40, max: 45, f: 'N' },
    { name: 'Gefängnis von Alcaz', id: 16620, min: 48, max: 53, f: 'N' }, { name: 'Die Schwarzschlundfeste', id: 16554, min: 55, max: 60, f: 'N' },
    { name: 'Die Terrasse des Formers', id: 16667, min: 58, max: 60, f: 'N' },
    { name: 'Gnomeregan', id: 721, min: 29, max: 38, f: 'N' }, { name: 'Der Kral von Razorfen', id: 491, min: 29, max: 38, f: 'N' },
    { name: 'Das Scharlachrote Kloster', id: 796, min: 28, max: 45, f: 'N' }, { name: 'Die Hügel von Razorfen', id: 722, min: 37, max: 46, f: 'N' },
    { name: 'Uldaman', id: 1337, min: 41, max: 51, f: 'N' }, { name: "Zul'Farrak", id: 1176, min: 44, max: 54, f: 'N' },
    { name: 'Maraudon', id: 2100, min: 46, max: 55, f: 'N' }, { name: "Der Tempel von Atal'Hakkar", id: 1477, min: 50, max: 56, f: 'N' },
    { name: 'Blackrocktiefen', id: 1584, min: 52, max: 60, f: 'N' }, { name: 'Blackrockspitze', id: 1583, min: 55, max: 60, f: 'N' },
    { name: 'Düsterbruch', id: 2557, min: 55, max: 60, f: 'N' }, { name: 'Stratholme', id: 2017, min: 58, max: 60, f: 'N' },
    { name: 'Scholomance', id: 2057, min: 58, max: 60, f: 'N' },
  ];

  // Raids ab Level 60. Forever: Barrow Deeps (10 Spieler) und Hyjalgipfel (20 Spieler) öffnen am 09.12.2026.
  // Barrow Deeps hat noch keinen deutschen Namen und keine Wowhead-ID, darum ohne Link.
  const RAIDS = [
    { name: 'Geschmolzener Kern', id: 2717, size: 40 }, { name: 'Onyxias Hort', id: 2159, size: 40 },
    { name: 'Barrow Deeps', id: null, size: 10 }, { name: 'Hyjalgipfel', id: 16004, size: 20 },
    { name: "Zul'Gurub", id: 1977, size: 20 }, { name: 'Pechschwingenhort', id: 2677, size: 40 },
    { name: "Ruinen von Ahn'Qiraj", id: 3429, size: 20 }, { name: "Ahn'Qiraj", id: 3428, size: 40 },
    { name: 'Naxxramas', id: 3456, size: 40 },
  ];

  // Erfahrungswerte Classic: Spielstunden vom Start bis zum jeweiligen Level (durchschnittlicher Spieler,
  // Gruppenspiel). Zwischenwerte rechnet die Seite linear aus. Forever nutzt dieselbe Erfahrungskurve wie Classic.
  const LEVEL_HOURS = [[1, 0], [10, 5], [20, 18], [30, 38], [40, 65], [50, 100], [60, 150]];

  // Rollen erscheinen einheitlich in der Highlight-Farbe der Seite.
  const ROLES = {
    TANK: { label: 'Tank', order: 0 },
    HEALER: { label: 'Heal', order: 1 },
    DAMAGE: { label: 'DPS', order: 2 },
  };

  // Klassenquests und Lehrer-Meilensteine: Level, Aufgabe. Die Vorbereitung zeigt sie,
  // wenn der letzte Abend das Level erreicht hat. Rot (hot) heißt: Quest oder Kauf mit Aufwand.
  // Forever: Priester lernen Furchtzauberschutz (jedes Volk) und Göttlicher Willen beim Lehrer,
  // Schamanen bekommen die Totemleisten Ruf der Elemente, der Geister und der Ahnen.
  const CLASS_TASKS = {
    1: [[10, 'Klassenquest: Verteidigungshaltung', true], [30, 'Klassenquest: Berserkerhaltung', true], [30, 'Klassenquest: Wirbelwindaxt', true]],
    2: [[12, 'Klassenquest: Erlösung', true], [40, 'Schlachtross beim Lehrer', true], [60, 'Klassenquest: Streitross', true]],
    3: [[10, 'Klassenquest: Begleiter zähmen', true]],
    4: [[16, 'Klassenquest: Schlossknacken', true], [20, 'Klassenquest: Gifte', true]],
    5: [[20, 'Lehrer: Furchtzauberschutz', false], [30, 'Lehrer: Göttlicher Willen', false]],
    7: [[4, 'Klassenquest: Totem der Erde', true], [10, 'Klassenquest: Totem des Feuers', true], [20, 'Klassenquest: Totem des Wassers', true], [30, 'Klassenquest: Totem der Luft', true],
      [20, 'Lehrer: Ruf der Elemente', false], [30, 'Lehrer: Ruf der Geister', false], [40, 'Lehrer: Ruf der Ahnen', false]],
    9: [[10, 'Klassenquest: Leerwandler', true], [20, 'Klassenquest: Sukkubus', true], [30, 'Klassenquest: Teufelsjäger', true], [40, 'Teufelsross beim Lehrer', true], [60, 'Klassenquest: Schreckensross', true]],
    11: [[10, 'Klassenquest: Bärengestalt', true], [14, 'Klassenquest: Vergiftung heilen', true], [16, 'Klassenquest: Wassergestalt', true]],
  };

  // Berufsstufen (Classic und Forever, Skill bis 300): Maximalwert der Stufe, nächste Stufe, Mindestlevel dafür.
  // Ab 25 Punkten unter dem Maximum lässt sich die nächste Stufe lernen.
  const PROF_RANKS = { 75: ['Geselle', 10], 150: ['Experte', 20], 225: ['Fachmann', 35] };

  // Die Leveling-Route zeigt Zonen und Dungeons in dieser Reihenfolge.
  for (const list of [ZONES, DUNGEONS]) list.sort((a, b) => a.min - b.min || a.max - b.max);

  return { CLASSES, PROFESSIONS, PRIMARY_PROFESSIONS, ZONES, DUNGEONS, RAIDS, LEVEL_HOURS, ROLES, CLASS_TASKS, PROF_RANKS };
})();

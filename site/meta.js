// Spielwissen für die abgeleiteten Ansichten (Buffs, Werkzeuge, Berufe, Zonen, Dungeons).
// "era" in config.json wählt den passenden Satz. Neue Forever-Zonen und -Dungeons
// nach der Bekanntgabe unten in ZONES und DUNGEONS ergänzen.

window.META = (() => {
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

  const BUFFS = {
    retail: [
      { name: 'Machtwort: Seelenstärke', effect: 'Ausdauer', classes: [5] },
      { name: 'Schlachtruf', effect: 'Angriffskraft', classes: [1] },
      { name: 'Arkane Intelligenz', effect: 'Intelligenz', classes: [8] },
      { name: 'Mal der Wildnis', effect: 'Vielseitigkeit', classes: [11] },
      { name: 'Aura der Hingabe', effect: 'Schadensreduktion', classes: [2] },
      { name: 'Mal des Jägers', effect: 'Schaden am Ziel', classes: [3] },
      { name: 'Mystische Berührung', effect: 'Körperlicher Schaden', classes: [10] },
      { name: 'Chaosbrandmal', effect: 'Magischer Schaden', classes: [12] },
      { name: 'Segen der Bronze', effect: 'Bewegung', classes: [13] },
      { name: 'Himmelszorn', effect: 'Meisterschaft', classes: [7] },
    ],
    classic: [
      { name: 'Machtwort: Seelenstärke', effect: 'Ausdauer', classes: [5] },
      { name: 'Arkane Intelligenz', effect: 'Intelligenz', classes: [8] },
      { name: 'Mal der Wildnis', effect: 'Alle Werte, Rüstung', classes: [11] },
      { name: 'Segen der Macht', effect: 'Angriffskraft', classes: [2] },
      { name: 'Segen der Könige', effect: 'Alle Werte +10 %', classes: [2] },
      { name: 'Schlachtruf', effect: 'Angriffskraft', classes: [1] },
      { name: 'Totem der Stärke der Erde', effect: 'Stärke', classes: [7] },
      { name: 'Göttlicher Willen', effect: 'Willenskraft', classes: [5] },
    ],
  };

  const TOOLS = {
    retail: [
      { name: 'Kampfwiederbelebung', classes: [6, 11, 9, 2] },
      { name: 'Kampfrausch', classes: [7, 8, 3, 13] },
      { name: 'Portale', classes: [8] },
      { name: 'Gesundheitsstein', classes: [9] },
    ],
    classic: [
      { name: 'Wiederbelebung', classes: [5, 2, 7] },
      { name: 'Wiedergeburt im Kampf', classes: [11] },
      { name: 'Seelenstein', classes: [9] },
      { name: 'Beschwören', classes: [9] },
      { name: 'Portale', classes: [8] },
      { name: 'Essen und Wasser', classes: [8] },
      { name: 'Gift heilen', classes: [11, 7] },
      { name: 'Fluch aufheben', classes: [8, 11] },
    ],
  };

  const PROFESSIONS = {
    Alchemy: 'Alchemie', Blacksmithing: 'Schmiedekunst', Enchanting: 'Verzauberkunst', Engineering: 'Ingenieurskunst',
    Herbalism: 'Kräuterkunde', Inscription: 'Inschriftenkunde', Jewelcrafting: 'Juwelierskunst', Leatherworking: 'Lederverarbeitung',
    Mining: 'Bergbau', Skinning: 'Kürschnerei', Tailoring: 'Schneiderei', Cooking: 'Kochkunst', Fishing: 'Angeln',
    Archaeology: 'Archäologie', 'First Aid': 'Erste Hilfe',
  };

  const PRIMARY_PROFESSIONS = {
    retail: ['Alchemie', 'Schmiedekunst', 'Verzauberkunst', 'Ingenieurskunst', 'Kräuterkunde', 'Inschriftenkunde', 'Juwelierskunst', 'Lederverarbeitung', 'Bergbau', 'Kürschnerei', 'Schneiderei'],
    classic: ['Alchemie', 'Schmiedekunst', 'Verzauberkunst', 'Ingenieurskunst', 'Kräuterkunde', 'Lederverarbeitung', 'Bergbau', 'Kürschnerei', 'Schneiderei'],
  };

  // Fraktion: A = Allianz, H = Horde, N = beide.
  const ZONES = [
    { name: 'Wald von Elwynn', id: 12, min: 1, max: 10, f: 'A' }, { name: 'Dun Morogh', id: 1, min: 1, max: 10, f: 'A' },
    { name: 'Teldrassil', id: 141, min: 1, max: 10, f: 'A' }, { name: 'Durotar', id: 14, min: 1, max: 10, f: 'H' },
    { name: 'Mulgore', id: 215, min: 1, max: 10, f: 'H' }, { name: 'Tirisfal', id: 85, min: 1, max: 10, f: 'H' },
    { name: 'Westfall', id: 40, min: 10, max: 20, f: 'A' }, { name: 'Loch Modan', id: 38, min: 10, max: 20, f: 'A' },
    { name: 'Dunkelküste', id: 148, min: 10, max: 20, f: 'A' }, { name: 'Brachland', id: 17, min: 10, max: 25, f: 'H' },
    { name: 'Silberwald', id: 130, min: 10, max: 20, f: 'H' }, { name: 'Rotkammgebirge', id: 44, min: 15, max: 25, f: 'A' },
    { name: 'Steinkrallengebirge', id: 406, min: 15, max: 27, f: 'N' }, { name: 'Ashenvale', id: 331, min: 18, max: 30, f: 'N' },
    { name: 'Dämmerwald', id: 10, min: 18, max: 30, f: 'A' }, { name: 'Sumpfland', id: 11, min: 20, max: 30, f: 'A' },
    { name: 'Vorgebirge von Hillsbrad', id: 267, min: 20, max: 30, f: 'N' }, { name: 'Tausend Nadeln', id: 400, min: 25, max: 35, f: 'N' },
    { name: 'Arathihochland', id: 45, min: 30, max: 40, f: 'N' }, { name: 'Desolace', id: 405, min: 30, max: 40, f: 'N' },
    { name: 'Schlingendorntal', id: 33, min: 30, max: 45, f: 'N' }, { name: 'Marschen von Dustwallow', id: 15, min: 35, max: 45, f: 'N' },
    { name: 'Ödland', id: 3, min: 35, max: 45, f: 'N' }, { name: 'Sümpfe des Elends', id: 8, min: 35, max: 45, f: 'N' },
    { name: 'Feralas', id: 357, min: 40, max: 50, f: 'N' }, { name: 'Tanaris', id: 440, min: 40, max: 50, f: 'N' },
    { name: 'Hinterland', id: 47, min: 40, max: 50, f: 'N' }, { name: 'Sengende Schlucht', id: 51, min: 43, max: 50, f: 'N' },
    { name: 'Azshara', id: 16, min: 45, max: 55, f: 'N' }, { name: 'Verwüstete Lande', id: 4, min: 45, max: 55, f: 'N' },
    { name: "Un'Goro-Krater", id: 490, min: 48, max: 55, f: 'N' }, { name: 'Teufelswald', id: 361, min: 48, max: 55, f: 'N' },
    { name: 'Brennende Steppe', id: 46, min: 50, max: 58, f: 'N' }, { name: 'Westliche Pestländer', id: 28, min: 51, max: 58, f: 'N' },
    { name: 'Östliche Pestländer', id: 139, min: 53, max: 60, f: 'N' }, { name: 'Winterspring', id: 618, min: 55, max: 60, f: 'N' },
    { name: 'Silithus', id: 1377, min: 55, max: 60, f: 'N' },
  ];

  const DUNGEONS = [
    { name: 'Ragefireabgrund', id: 2437, min: 13, max: 18, f: 'H' }, { name: 'Die Todesminen', id: 1581, min: 17, max: 26, f: 'A' },
    { name: 'Die Höhlen des Wehklagens', id: 718, min: 17, max: 24, f: 'N' }, { name: 'Burg Shadowfang', id: 209, min: 22, max: 30, f: 'N' },
    { name: 'Blackfathom-Tiefe', id: 719, min: 24, max: 32, f: 'N' }, { name: 'Das Verlies', id: 717, min: 24, max: 32, f: 'A' },
    { name: 'Gnomeregan', id: 721, min: 29, max: 38, f: 'N' }, { name: 'Der Kral von Razorfen', id: 491, min: 29, max: 38, f: 'N' },
    { name: 'Das Scharlachrote Kloster', id: 796, min: 28, max: 45, f: 'N' }, { name: 'Die Hügel von Razorfen', id: 722, min: 37, max: 46, f: 'N' },
    { name: 'Uldaman', id: 1337, min: 41, max: 51, f: 'N' }, { name: "Zul'Farrak", id: 1176, min: 44, max: 54, f: 'N' },
    { name: 'Maraudon', id: 2100, min: 46, max: 55, f: 'N' }, { name: "Der Tempel von Atal'Hakkar", id: 1477, min: 50, max: 56, f: 'N' },
    { name: 'Blackrocktiefen', id: 1584, min: 52, max: 60, f: 'N' }, { name: 'Blackrockspitze', id: 1583, min: 55, max: 60, f: 'N' },
    { name: 'Düsterbruch', id: 2557, min: 55, max: 60, f: 'N' }, { name: 'Stratholme', id: 2017, min: 58, max: 60, f: 'N' },
    { name: 'Scholomance', id: 2057, min: 58, max: 60, f: 'N' },
  ];

  // Raids ab Level 60. Die zwei neuen Forever-Raids nach der Bekanntgabe ergänzen.
  const RAIDS = [
    { name: 'Geschmolzener Kern', id: 2717, size: 40 }, { name: 'Onyxias Hort', id: 2159, size: 40 },
    { name: "Zul'Gurub", id: 1977, size: 20 }, { name: 'Pechschwingenhort', id: 2677, size: 40 },
    { name: "Ruinen von Ahn'Qiraj", id: 3429, size: 20 }, { name: "Ahn'Qiraj", id: 3428, size: 40 },
    { name: 'Naxxramas', id: 3456, size: 40 },
  ];

  const ROLES = {
    TANK: { label: 'Tank', order: 0, color: '#5ec8ff' },
    HEALER: { label: 'Heal', order: 1, color: '#3aff9b' },
    DAMAGE: { label: 'DD', order: 2, color: '#ff7a3a' },
  };

  return { CLASSES, BUFFS, TOOLS, PROFESSIONS, PRIMARY_PROFESSIONS, ZONES, DUNGEONS, RAIDS, ROLES };
})();

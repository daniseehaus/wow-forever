# WoW Forever

## Zweck

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung der Gruppen-Charaktere.

## Stack

Node.js-Skripte, GitHub Action, GitHub Pages, Battle.net API.

## Befehle

| Zweck | Befehl |
|---|---|
| Daten holen | `npm run fetch` |
| Testdaten Squad und Gilde | `node scripts/fetch.mjs --guild-demo` (echte Mitglieder plus Beispiele, Squad mit denselben Charakteren), danach `node scripts/mirror-models.mjs` |
| Talente bauen | `npm run build-talents` (Forever-Bäume aus der Battle.net API, braucht `.env`) |
| Icons bauen | `npm run build-icons` |
| Testen | keine automatischen Tests, Prüfung von Hand: siehe `## Prüfung` |

## Prüfung

Entwurf, bitte bestätigen oder anpassen.

1. `npm run fetch` lokal ausführen und `index.html` öffnen. Nach dem Push: `gh run list -L 1` zeigt einen grünen Lauf.

## Deploy

GitHub Action `.github/workflows/update.yml` holt die Daten alle 5 Minuten und veröffentlicht auf GitHub Pages. Den Takt gibt der Pi vor (`wow-anstossen.timer` in `pi-homeserver`), der Zeitplan von GitHub ist nur die stündliche Reserve.

## Struktur

Siehe `README.md`.

## Projektregeln

Noch keine.

## Entscheidungen

Datum und Entscheidung, je eine Zeile. Neueste oben.

- 2026-11-09: Die Aktivität der Gilde zeigt dasselbe wie der Squad (jedes Level-Up, Items ab Rar, Berufe, Erfolge), dazu Beitritt und Austritt. Die Gilde ist klein. Die Kennzahl „Aktiv in 7 Tagen“ entfällt.
- 2026-11-09: Das Loadout startet eingeklappt und öffnet erst mit einem Klick auf eine Kachel. Die Seite merkt sich keine Auswahl mehr.
- 2026-11-09: Squad-Charaktere gehören erst zur Gilde, wenn ihr Profil die Gilde nennt (Orkward ist noch nicht beigetreten). Aktivität zeigt mindestens 3 Tage. Crafting zeigt vorerst keine Verzauberungen.
- 2026-11-09: Gilde gegründet am 08.11.2026 um 21:59, alle damaligen Mitglieder mit Beitritt um 22:00. Ereignisse davor stehen nicht im Feed. Die Gildenseite zeigt keine Ränge. Berufe in der Tabelle als zwei Spalten mit Balken. Volk „Himmelsgeborener der Windformer“ heißt kurz „Himmelsgeborener“.
- 2026-11-09: Abschnitt Squad (Buffs und Tools) entfällt. 3D läuft auch auf Handys. Ohne 3D zeigt die Bühne den 2D-Render, bei fehlendem Blizzard-Render einen Schnappschuss des 3D-Modells, nicht das Klassen-Icon.
- 2026-11-09: Forever-API: Das Charakterprofil nennt jetzt die Gilde (`guild`), eine Mitgliederliste (Roster) gibt es weiter nicht (404). Mitglieder bleiben in `config.json` unter `guild`.
- 2026-11-09: Der Pi stößt den Abruf alle 5 statt 15 Minuten an.
- 2026-11-09: „Verpasst“ zeigt eine Quest nur, wenn mindestens 2 andere Squad-Charaktere sie abgeschlossen haben. Keine Klassenquests (höchstens 3 Klassen erlaubt). Quests 5 oder mehr Level unter dem eigenen Level fallen weg. Die API kennt kein Quest-Level, als Ersatz gilt das niedrigste Level der Abschließenden beim Abschluss.
- 2026-11-08: Neue Baseline für Sessions: 2 gemeinsame Sessions (die letzte und heute, Level 1 bis 10). Die automatische Erkennung beginnt danach (`sessionBaseline` in `config.json`).
- 2026-11-08: Squad bekommt Crafting (nur gelernte Rezepte, Wertevergleich nach Spielweise statt Itemlevel, auch Verzauberungen und Rüstungssets, keine Verbrauchsgüter, Liste „Hersteller → Empfänger“) und Quests (nur „Verpasst seit dem Logout“, den Rest stimmt der Squad live ab). Keine Beute-Wunschliste, die API kennt keine Forever-Dungeonbeute. Erfolge stehen ohne Punkte in der Aktivität. Bühne der Modelle ohne Runenkreis, nur Schein und Glühwürmchen.
- 2026-11-08: Beide Seiten haben dieselbe Navigation (Abschnitte der Startseite, „Guild“ am Ende). Talentbäume bis 760 px zum Wischen, kein Karussell, darüber unverändert. Eine Namenskorrektur in `config.json` erzeugt im Gilden-Feed kein Ereignis.
- 2026-11-08: Die ganze Seite folgt Forever: Talentbäume aus der Battle.net API (`talent-tree`), Wowhead-Links und Tooltips unter `/forever/`, Zonen, Dungeons, Raids, Buffs und Klassenaufgaben in `meta.js` auf Stand 1.60.1.
- 2026-11-08: Gildenseite als eigene Seite `gilde.html`: ganze Gilde, sortierbare Tabelle ohne Talente-Spalte, Kennzahlen, Filter nur Klasse und Suche (Berufe über die Sortierung), Detail mit 3D für alle Mitglieder und kompletten Talentbäumen, Gilden-Feed (Beitritt, Austritt, Rang, Level-Meilensteine, epische Items). Inaktiv ab 14 Tagen, blass am Ende. Kein Standort, nur „zuletzt online“. Keine Twink-Zuordnung, kein Berufe-Verzeichnis, keine Diagramme, kein Dungeon-Finder, keine Ranglisten.
- 2026-11-08: 3D für Forever über den Live-Viewer (`forever.modelEnv: "live"`). Der Classic-Viewer lädt `.mo3`-Dateien, die Wowhead nicht mehr liefert.
- 2026-11-08: Forever-API kennt keine Gilden (kein Gildenfeld, kein Roster). Mitglieder und Ränge stehen in `config.json` unter `guild`.

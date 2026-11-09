# WoW Forever · Gruppenübersicht

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung unserer Charaktere.
Eine GitHub Action holt die Daten alle 5 Minuten von der Battle.net API und veröffentlicht die Seite auf GitHub Pages.
Den Takt gibt der Pi vor (`wow-anstossen.timer` in `pi-homeserver`, Minute 5, 20, 35, 50), der Zeitplan von GitHub ist nur die stündliche Reserve.
Blizzard aktualisiert ein Profil erst nach dem Logout, häufiger abzufragen bringt darum wenig.

## Aufbau

| Datei | Zweck |
|---|---|
| `config.json` | Region, Sprache, Namespaces, Charakterliste, Forever-Einstellungen (`forever`) |
| `scripts/fetch.mjs` | Abruf der API, schreibt `site/data.json`, Verlauf, Sessions und Aktivitäts-Feed, wandelt die 2D-Renders in WebP um |
| `scripts/config.mjs` | Wählt ab dem Starttag die Forever-Einstellungen |
| `scripts/switch-forever.mjs` | Übernimmt die Forever-Einstellungen fest in `config.json` (`npm run switch-forever`) |
| `scripts/preview.mjs` | Vorschau bis zum Start: simulierte Classic-Werte und Showcase-Verlauf |
| `scripts/build-talents.mjs` | Baut `site/talents.json` mit den Forever-Talentbäumen aus der Battle.net API (`npm run build-talents`) |
| `scripts/mirror-models.mjs` | Spiegelt die 3D-Modelldateien von Wowhead nach `site/modelviewer/` |
| `scripts/model-proxy.mjs` | Lokaler Proxy für 3D-Tests ohne Spiegelung |
| `site/` | Die Seite (HTML, CSS, JS ohne Build-Schritt) |
| `site/renders/` | 2D-Renders der Charaktere als WebP, schreibt `fetch.mjs` (mit `sharp`, nicht im Repo) |
| `site/sw.js` | Service Worker: hält 3D-Modelldateien und Renders dauerhaft im Browser |
| `site/sounds/` | Bloodlust-Sound des Schamanen (Wowhead, Datei 568812, als MP3) |
| `site/sounds/workers/` | Arbeiter-Stimmen aus Warcraft III, deutsch: Peon, Acolyte und Peasant (aus [Old German Voice Lines](https://www.hiveworkshop.com/threads/old-german-voice-lines-alte-deutsche-voice-lines.371972/), als MP3) |
| `site/gilde.html`, `site/guild.js` | Gildenseite: Mitgliederliste, Filter, Detail mit 3D und Talenten, Gilden-Feed (nutzt die Hilfen aus `app.js`) |
| `site/meta.js` | Spielwissen für Forever: Berufe, Zonen, Dungeons, Raids, Stunden bis 60 |
| `data/history.json` | Tageswerte je Charakter, schreibt nur die Action |
| `data/sessions.json` | Erkannte gemeinsame Sessions (ab 4 Spielern) mit Level-Zuwachs, schreibt nur die Action |
| `data/feed.json` | Aktivitäts-Feed: Level-Ups (stundengenau), neue Items, Berufe, Gilde, Sessions; schreibt nur die Action |
| `data/guild-feed.json` | Gilden-Feed: Gründung, Beitritt, Austritt, Level-Meilensteine, epische Items; schreibt nur die Action |
| `data/recipes.json` | Was die Rezepte des Squads herstellen (tragbare Items, Verzauberungen); schreibt nur die Action, neu je Patch |
| `data/quests.json` | Titel und Zone der Quests im Squad (deutsch); schreibt nur die Action, neu je Patch |
| `data/quest-log.json` | Wer wann welche Quest abgeschlossen hat (30 Tage), Grundlage für „Verpasst“; schreibt nur die Action |
| `data/archive/` | Verlauf, Sessions und Feed der vorherigen Spielversion |
| `.github/workflows/update.yml` | Abruf alle 5 Minuten, 3D-Spiegelung und Deployment |

## Charaktere eintragen

In `config.json` unter `characters` je Charakter Realm und Name eintragen:

```json
{ "realm": "Everlook", "name": "Thoradin" }
```

Forever kennt keine Realms. Dort steht statt des Realms der Nachname:

```json
{ "name": "Zukk", "surname": "Sturmzüngler" }
```

Die API sucht den Charakter dann unter `/profile/wow/character/zukk-sturmzüngler` (klein, Umlaute bleiben) im Namespace `profile-forever-eu`.

Die API zeigt ein Profil erst ab Level 10 und nach dem ersten Logout des Charakters.

Ein Eintrag nur mit Namen (`{ "name": "Daniel" }`) ist ein Platzhalter. Die Seite zeigt ihn als „Charakter folgt“ und fragt die API nicht ab.

## Gilde

Die Gildenseite liegt unter `gilde.html`. Beide Seiten haben dieselbe Navigation: die Abschnitte der Startseite und „Guild“ am Ende.
Auf der Gildenseite führen die Abschnitte zur Startseite, „Guild“ ist aktiv.

Forever kennt in der API keine Gilden: Das Profil hat kein Gildenfeld, und es gibt keinen Roster-Endpunkt (geprüft am 08.11.2026).
Zu dem Zeitpunkt war noch kein Charakter in einer Gilde. Das Profil hat auch kein Realm-Feld, und `/data/wow/guild/...` sowie
`/data/wow/realm/index` antworten mit 404. Steht die Gilde im Spiel, erneut prüfen: Liefert das Profil dann ein Feld `guild` mit Link,
kann der Abruf die Mitglieder vielleicht selbst lesen. `fetch.mjs` liest `guild` schon heute mit.
Die Mitglieder stehen deshalb in `config.json` unter `guild`:

```json
"guild": {
  "name": "Geilbleiber",
  "ranks": ["Gildenmeister", "Offizier", "Veteran", "Mitglied", "Rekrut"],
  "members": [
    { "name": "Hammer", "surname": "Hanno", "rank": "Offizier" }
  ]
}
```

- Zur Gilde gehören alle Charaktere aus `characters` (ohne Platzhalter) und alle Einträge in `members`.
- Ein Eintrag in `members` mit dem Namen eines Gruppen-Charakters setzt nur dessen Rang. Ohne Rang gilt „Mitglied“.
- `ranks` legt die Reihenfolge der Ränge fest (oben der höchste). Danach sortiert die Spalte „Rang“.
- Wer aus `members` verschwindet, gilt im Gilden-Feed als ausgetreten. Ein neuer Eintrag gilt als Beitritt.
- Eine Namenskorrektur ist kein Austritt mit Beitritt. Verschwindet ein Eintrag und kommt im selben Lauf ein neuer dazu, zieht nur der Stand um.
  Bedingung: gleiche Charakter-ID bei Blizzard, gleicher Vorname oder ein alter Eintrag, der nie ein Profil hatte.
  Ein Eintrag ohne je geladenes Profil verschwindet ohne Austritt.

Die Seite zeigt:

- **Kennzahlen:** Mitglieder, Durchschnittslevel, aktiv in 7 Tagen, Anzahl auf Max-Level.
- **Tabelle:** Name, Klasse, Volk, Level, Rang, Itemlevel, Hauptberufe, zuletzt online.
  Ein Klick auf eine Spaltenüberschrift sortiert. „Berufe“ gruppiert nach Hauptberuf, im selben Beruf steht der höchste Skill oben.
  Wer länger als 14 Tage offline ist, steht blass am Ende unter der Trennzeile „Inaktiv“. Mitglieder ohne sichtbares Profil (unter Level 10)
  stehen ganz unten unter „Ohne Profil“. Die Spaltenbreiten sind je Bildschirmbreite gemessen. Unter 900 px zeigen die Berufe nur Icon und Skill.
- **Filter:** Klassen-Icons und „Suchen“ (findet Name, Klasse, Volk, Rang und Beruf).
- **Detail:** Ein Klick auf eine Zeile klappt das Detail auf: links 3D-Modell, darunter Werte (aus `/statistics`) und alle Berufe, rechts Kennzahlen und Ausrüstung, darunter die drei Talentbäume. Es ist immer nur ein Detail offen, Escape schließt es.
  Ist 3D aus oder lädt nicht, steht der 2D-Render auf der Bühne (siehe „3D-Modelle“). Nur ohne jedes Bild erscheint das Klassen-Icon.
- **Gilden-Feed:** Gildengründung, Beitritt, Austritt, Level 20, 30, 40, 50 und 60 sowie neue epische Items.
  Gegründet am 08.11.2026 um 21:59, alle Mitglieder bis dahin mit Beitritt um 22:00 (auch in der Aktivität der Startseite).

Den aktuellen Standort eines Charakters kennt die API nicht. Die Spalte „zuletzt online“ zeigt den letzten Logout.

Die 3D-Spiegelung umfasst auch die Gildenmitglieder. Bei 15 Mitgliedern sind das etwa 200 MB auf GitHub Pages.

Lokal mit Testdaten: `node scripts/fetch.mjs --guild-demo` holt die echten Mitglieder und füllt die Gilde mit Beispiel-Mitgliedern auf 15 auf
(darunter zwei inaktive). Squad-Charaktere ohne Profil übernehmen dabei Gildenmitglieder mit Daten, erst die echten, dann die Beispiele.
So zeigen Squad und Gilde dieselben Charaktere zum Vergleich. Dazu kommen Beispiel-Feeds für beide Seiten. `data/` bleibt unberührt. `node scripts/fetch.mjs --demo` erzeugt eine Gilde ganz ohne API.
Danach `node scripts/mirror-models.mjs` für 3D.

## Umstellung auf Forever

Der Namespace wählt die Spielversion. Bis zum Start von Forever läuft die Seite mit Retail (`profile-eu`, `static-eu`).

Die Werte für Forever stehen in `config.json` im Block `forever`. Ab dem Starttag (`launch`, 00:00 UTC) nutzt die Action
sie von selbst. `forever.switchAt` (z. B. `"2026-11-04T17:00:00+01:00"`) legt bei Bedarf einen genauen Zeitpunkt fest.

Vor dem Start prüfen:

- `forever.namespaces` zeigt auf `profile-forever-eu` und `static-forever-eu` (seit dem Start in der API, Region „CAMWOW Europa“, Patch 1.60.1)
- `forever.characters` mit den neuen Charakteren füllen. Bleibt die Liste leer, gilt die normale Charakterliste.
- `forever.modelEnv` steht auf `live`. Der Classic-Viewer von Wowhead fragt Modelle als `.mo3` an, Wowhead liefert sie aber nur noch als `.m2` (geprüft am 08.11.2026). Der Live-Viewer zeigt die Forever-Charaktere richtig.

Wechselt die Spielversion (`era`), verschiebt die Action Verlauf, Sessions und Feed nach `data/archive/` und beginnt neu.
Alte Retail-Daten zu gleichnamigen Charakteren werden nicht weiter angezeigt.

Lokal lässt sich die Umstellung vorab mit `node scripts/fetch.mjs --forever` testen. Nach dem Start übernimmt
`npm run switch-forever` die Werte fest in `config.json` und entfernt den Block `forever`.

## Vorschau bis zum Start

Bis zum Start zeigt die Seite unsere Retail-Charaktere als Classic-Charaktere. Das steuert `simulate` in `config.json`
(`"levels": [25, 27]`). Echt bleiben Name, Klasse, Volk, Gilde, Aussehen, Ausrüstung und letzter Login. Simuliert sind:

- **Level:** fest je Name zwischen 25 und 27
- **Talente:** feste Leveling-Builds je Baum (`BUILDS` in `preview.mjs`), gültig nach Reihen und Voraussetzungen. Bäume ohne Build füllt das Skript von oben nach unten.
- **Berufe:** nur Classic-Berufe, Fortschritt auf 150 umgerechnet
- **Werte und Itemlevel:** passend zum Level, Qualität der Items eine Stufe tiefer
- **Showcase:** sieben gemeinsame Abende in den letzten zwei Wochen mit Level-Ups, Items, Berufen und Sessions. Daraus kommen Aktivität,
  „Level pro Session“ und der letzte Login. Der Showcase landet nur in `site/`, nie in `data/`.

Die Vorschau läuft als eigene Spielversion `preview`. Feed, Sessions und Verlauf aus Retail wandern beim ersten Lauf nach `data/archive/`.
Echte Änderungen (neue Items, Berufe) erscheinen zusätzlich zum Showcase in der Aktivität.
Am Starttag setzt der Block `forever` die Vorschau ab (`"simulate": null`).

## Sessions, Feed und Talente

- **Sessions:** Die API kennt keine Spielzeit, nur den letzten Logout. Loggen sich mindestens 4 Charaktere (bei kleinerer Gruppe alle)
  innerhalb von 3 Stunden aus, zählt das als gemeinsame Session. Erkannt wird sie eine Stunde nach dem letzten Logout.
  **Baseline:** `sessionBaseline` im Block `forever` der `config.json` zählt Sessions, die vor der Erkennung lagen (Profile erst ab Level 10
  sichtbar): `count` Sessions mit zusammen `levels` Level. Sessions, die vor `until` enden, setzen nur den Stand und zählen nicht doppelt.
  Stand 08.11.2026: 2 Sessions, Level 1 bis 10, bis 09.11.2026 06:00. Die erste erkannte Session ist dann Session 3.
  „Level pro Session“ rechnet die Baseline mit, solange es weniger als 10 erkannte Sessions gibt.
- **Aktivität:** Jeder Abruf wird mit dem vorigen verglichen. Level-Ups bekommen den Zeitpunkt des Logouts, in dem sie
  passiert sind. Neue Items erscheinen ab Qualität „selten“. Grüne Items zählen nur in „Letzte Session“.
  Neue Erfolge erscheinen mit ihrem genauen Zeitpunkt, ohne Punkte. Das Profil nennt die Erfolge nur englisch, Name, Beschreibung
  und Icon kommen deutsch aus den Spieldaten von Forever (`/data/wow/achievement`, `/data/wow/media/achievement`), nur für neue Erfolge.
  Der erste Lauf nach der Umstellung legt nur den Stand fest, ohne Ereignisse.
- **Letzte Session:** Je Session eine Karte mit neuen Items (ab grün), Fortschritt auf dem Weg bis 60, Berufspunkten und Level pro Char.
  Dazu bis zu vier Auszeichnungen (z. B. Größtes Upgrade, Loot-Goblin, Licht aus). Die Werte je Spieler hält die Session in `stats` fest.
  Der Knopf „Teilen“ öffnet WhatsApp mit fertigem Text und Link.
- **Loadout:** Kopf, Kennzahlen, Werte (aus `/statistics`) und Berufe, darunter Ausrüstung und Talentbäume. Werte und Berufe nutzen dieselben Bausteine wie das Gilden-Detail (`statRows`, `profRows` in `app.js`).
  Die Kennzahl „Leere Slots“ zählt alle leeren Slots, ohne Schildhand. Eine leere Schildhand erscheint auch nicht als Karte (Zweihandwaffe, Jäger).
  Item-Namen dürfen zwei Zeilen haben. Vor der ersten gemeinsamen Session zeigt die Kopfzahl „Gemeinsame Sessions“ statt „Level pro Session“.
- **Kopfzahlen Squad:** Level pro Session, Ø Level (Mitte) und Spielzeit bis 60. Auf dem Handy stehen die drei in einer Reihe.
- **Crafting:** Was der Squad füreinander herstellen kann, nur aus gelernten Rezepten (`known_recipes` aller Berufe).
  Der Abruf holt zu jedem Rezept das Ergebnis aus den Spieldaten (`buildCrafts`, `recipeInfo` in `fetch.mjs`, Ablage `data/recipes.json`).
  - **Ausrüstung:** Die Seite vergleicht die Werte mit dem Item im Slot (`craftUpgrades` in `app.js`). Jeder Wert hat ein Gewicht je Spielweise
    (Stärke, Beweglichkeit, Jäger, Zauber, Heiler, Tank, aus Klasse, Rolle und Spezialisierung, `STAT_WEIGHTS`). Dazu zählen Rüstung und
    Waffenschaden pro Sekunde. Ein Item zählt, wenn es tragbar ist (Rüstungsart und Waffenfertigkeit wie in Classic) und mindestens einen
    halben Punkt Hauptwert bringt. Die Zeile zeigt die zwei wichtigsten Unterschiede, der Tooltip alle. Bis 3 Level zu früh steht es blass.
  - **Verbesserungen:** Verzauberungen (erkannt am Namen „Armschiene - Ausdauer“) und dauerhafte Verbesserungen wie Rüstungssets und
    Zielfernrohre (erkannt an den Slots in der Beschreibung), nur für angelegte Items ohne Verzauberung. Gleiche Möglichkeiten für mehrere
    Slots stehen in einer Zeile, die beste zuerst.
  - **Anzeige:** eine Liste gleich großer Zeilen, links Hersteller und Empfänger („Bernhard → Lokk“, „Lokk → selbst“,
    „Bernhard → alle“), rechts Item und Unterschied der Werte.
    Sortiert nach Hersteller, dann nach Gewinn.
    Verbrauchsgüter (Tränke, Essen, Verbände) zeigt die Seite vorerst nicht, der Abruf speichert sie nicht.
  Das Loadout markiert Slots mit Upgrade und nennt den wichtigsten Gewinn.
- **Quests:** nur „Verpasst“, alles andere stimmt der Squad live ab (`renderQuests` in `app.js`). Je Charakter, der etwas verpasst hat,
  eine Karte mit den Quests, die andere abgeschlossen haben, seit er zuletzt online war. Nach Zonen gruppiert, ab 8 Quests klappt der
  Rest auf. Daneben steht, wer die Quest erledigt hat. Hat niemand etwas verpasst, steht dort nur eine Zeile.
  Mit × lässt sich eine Quest je Charakter ignorieren, „wieder zeigen“ holt alle zurück. Das merkt sich nur der eigene Browser
  (localStorage `questIgnore`), die Seite hat keinen Server.
  Grundlage ist der Quest-Verlauf der Action (`data/quest-log.json`). Quests ohne Zone (meist Klassen- und Berufsquests) zählen nicht,
  gleiche Titel in einer Zone stehen einmal. Der Abruf liest `/quests` und `/quests/completed` je Charakter, Titel und Zone kommen aus
  `/data/wow/quest`. Mit `--guild-demo` bekommen die Beispiel-Charaktere Teile der echten Questlogs und einen Testverlauf.
- **Beute aus Dungeons:** vorerst weggelassen. Geprüft am 08.11.2026, mit der API nicht möglich. Forever hat noch kein Dungeon-Journal
  (`journal-instance` ist leer), und die Classic-Beute aus dem Retail-Journal gibt es in Forever nicht (0 von 158 Items).
- **Leveling:** Eingeklappt zeigt die Route nur die Stufen, in denen jemand aus der Gruppe steht, und die Stufe danach.
- **Bühne der Modelle:** Hinter Kachel und Gilden-Detail pulsiert ein Schein in Klassenfarbe, Glühwürmchen steigen langsam auf und flackern
  (`stageFxHtml` in `app.js`, `.stage-fx` in `style.css`). Ein Runenkreis am Boden war im Test, er fällt weg: Die Modelle stehen je nach Größe
  unterschiedlich hoch, ein Kreis macht das sichtbar. Alles bewegt sich nur per `transform` und `opacity`.
  Bei Bloodlust läuft es schneller, bei „Bewegung reduzieren“ steht es still.
- **Handy:** Die Navigation blendet am Rand aus, wenn sie seitlich weitergeht. Die gewählte Kachel steht beim Laden und beim Wechsel im Bild.
- **Vor dem nächsten Abend:** Offene Punkte je Charakter: Klassenquests und Reiten (`CLASS_TASKS` in `meta.js`), nächste Berufsstufe
  (`PROF_RANKS`), Lehrer bei geraden Leveln und freie Talentpunkte.
- **Talente:** Forever hat eigene Talentbäume (neue, geänderte und verschobene Talente gegenüber Classic). Die Charakter-API liefert
  die Punkte je Baum und die gewählten Talente, aber nicht ihre Position im Baum. Die Positionen, Ränge und Icons stehen deshalb in
  `site/talents.json`. Die Seite zeigt damit die drei Bäume wie im Spiel. Die Datei baut `npm run build-talents` aus der Battle.net API
  (`static-forever-eu`, Endpunkt `talent-tree`, braucht `.env`) und den Icons der Wowhead-Tooltips von Forever.
  Ein Neubau ist nur nach einem Patch nötig, der die Bäume ändert.
  Die API nennt manche Talentpaare gegenseitig als Voraussetzung. `build-talents` behält dann nur die Richtung von oben nach unten
  und meldet Talente im selben Feld. Ein gewählter Rang ist nie höher als der Höchstrang des Talents.
  Bis 760 px stehen die Bäume zum Wischen nebeneinander, zuerst sichtbar ist der Baum mit den meisten Punkten.
  Der Forever-Rechner von Wowhead kodiert Builds anders als der Classic-Rechner. Der Link „Talentrechner“ öffnet darum den Rechner der Klasse ohne Build.
- **Wowhead:** Links und Tooltips zeigen auf Wowhead Forever (`forever.wowhead: "forever"`, Pfad `/forever/de/`).
- **Spielwissen:** `meta.js` folgt Forever 1.60.1 (Stand 08.11.2026): neue Zonen (Insel Zephras, Flusslande, Shen'dralas, Hyjal),
  neun neue Dungeons (ohne die Halle der Thanen, sie liegt auf Allianz-Seite), die Raids Barrow Deeps und Hyjalgipfel (nach Onyxias Hort),
  Buffs ohne Talentpflicht (Segen der Könige, Göttlicher Willen, verbessertes Mal der Wildnis) und neue Lehrer-Zauber für Priester und Schamanen.
  IDs stammen aus Wowhead Forever, Stufen aus den Leveling-Guides. Shen'dralas und Hyjal haben noch keine offizielle Stufe.

## Effekte

Die Charakterkacheln erscheinen, sobald `data.json` geladen ist. Sessions, Aktivität und Talentdetails werden danach ergänzt.

- **Band:** Das schräge Band mit laufenden Streifen ist das Stilmittel der Seite (`burst()` in `app.js`). Beim Start zeigen alle
  3D-Kacheln sofort „Loading“. Das fertige Modell ersetzt den Balken. Schlägt der Aufbau fehl, erscheint der 2D-Render.
- **Forever-Start:** Zum Start und einmal am Starttag läuft „Forever ist live“ über die Seite. `?live` zeigt das Band vorab.
- **Charakterwechsel:** Ein Klick auf eine Kachel startet sofort das Namensband und scrollt zum Loadout. Das Loadout baut während
  des Bands neu auf und wird sichtbar, wenn das Band ausläuft.
- **Einblenden:** Die Abschnitte gleiten beim Scrollen ins Bild. Zahlen stehen sofort fest, ohne Hochzählen.
- **Bloodlust:** Ein Klick auf das Logo startet 15 Sekunden Bloodlust mit Sound, rotem Lauf-Rahmen um die Seite und pulsierenden Kacheln. Danach gilt 60 Sekunden „Gesättigt“.
- **Sync:** Der Punkt neben der Uhrzeit ist grün, solange der Abruf läuft, und rot ab 2 Stunden Rückstand. Ältere Stände zeigen das Datum.
- Bei „Bewegung reduzieren“ im System bleiben alle Effekte aus.
- Dauer-Animationen laufen nur über `transform` und `opacity`. So rechnet sie die Grafikkarte, nicht der Hauptthread.
  Das Tempo im Bloodlust ändert `lustTempo()` über die Web Animations API, eine neue `animation-duration` ließe die Animationen springen.

## 3D-Modelle

Die animierten Modelle nutzen den Modellviewer von Wowhead. Die Daten dafür kommen von Blizzard:
Aussehen und Transmog über `/appearance`, die Display-IDs über `/item-appearance`. Kennen die Forever-Spieldaten ein Item nicht (404),
kommt die Display-ID aus dem Wowhead-XML (`/forever/item=<id>&xml`), danach aus den Retail-Spieldaten.
Wowhead erlaubt keinen direkten Abruf aus fremden Seiten. Die Action spiegelt deshalb alle benötigten
Dateien (etwa 70 MB für 5 Charaktere) nach GitHub Pages. Ändert sich am Aussehen nichts, übernimmt sie die Dateien aus dem Cache
und überspringt Browser-Installation und Spiegelung (`mirror-models.mjs --hash` und `--restore`). 3D läuft auf allen Geräten, auch auf Handys.
Ohne WebGL zeigt die Seite die 2D-Renders. „Daten sparen“ startet mit 2D, der Schalter „3D an/aus“ schaltet 3D ein. Sonst gilt die letzte Wahl.

2D-Ersatz: Blizzard liefert nicht für jeden Charakter einen 2D-Render (Media-API 404). Beim Spiegeln fotografiert `mirror-models.mjs`
jedes Modell in der Grundhaltung (transparent, zugeschnitten, WebP). Charaktere ohne Blizzard-Render bekommen dieses Bild
(`render`, `renderSnap` in `data.json` und `guild.json`). Neue Schnappschüsse für alle: `SNAP_VERSION` erhöhen.

Jeder Viewer zeichnet in einer eigenen Schleife. Damit fünf Modelle den Hauptthread nicht füllen, begrenzt `pace()` in `model3d.js`
die Bildrate auf 60 Bilder pro Sekunde (auch auf 120-Hz-Displays) und lässt Modelle aus, die weit außerhalb des Bildes liegen.
Sichtbare Modelle bewegen sich immer. Ein Rand von 200 px aktiviert das Zeichnen kurz vor dem Scrollen.

GitHub Pages erlaubt nur 10 Minuten Cache. Der Service Worker (`sw.js`) hält Modelldateien und Renders darum dauerhaft vor.
Ab dem zweiten Besuch lädt die Seite keine Modelldaten mehr. Wechselt die Modell-Umgebung (Vorschau, dann Forever), löscht er den alten Cache.

Der Wowhead-Viewer ist inoffiziell. Ändert Wowhead ihn, kann 3D ausfallen. Die Seite fällt dann auf die Renders zurück.
Ein vorübergehender Fehler beim Laden des Viewer-Skripts blockiert spätere Versuche nicht.

## Lokal testen

```bash
npm install
node scripts/fetch.mjs
node scripts/mirror-models.mjs
python3 -m http.server -d site 8080
```

Für `fetch.mjs` vorher `.env.example` nach `.env` kopieren und die Werte eintragen. Ohne API-Zugang liefert `node scripts/fetch.mjs --demo` Beispieldaten.

## Einrichtung auf GitHub

1. Im [Blizzard Developer Portal](https://community.developer.battle.net/access/clients) einen Client anlegen.
2. Client-ID und Secret als Repository Secrets `BLIZZARD_CLIENT_ID` und `BLIZZARD_CLIENT_SECRET` speichern.
3. Unter Settings → Pages als Quelle „GitHub Actions“ wählen.
4. Unter Actions den Workflow einmal per „Run workflow“ starten.

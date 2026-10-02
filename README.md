# WoW Forever · Gruppenübersicht

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung unserer Charaktere.
Eine GitHub Action holt die Daten stündlich von der Battle.net API und veröffentlicht die Seite auf GitHub Pages.

## Aufbau

| Datei | Zweck |
|---|---|
| `config.json` | Region, Sprache, Namespaces, Charakterliste, Forever-Einstellungen (`forever`) |
| `scripts/fetch.mjs` | Abruf der API, schreibt `site/data.json`, Verlauf, Sessions und Aktivitäts-Feed, wandelt die 2D-Renders in WebP um |
| `scripts/config.mjs` | Wählt ab dem Starttag die Forever-Einstellungen |
| `scripts/switch-forever.mjs` | Übernimmt die Forever-Einstellungen fest in `config.json` (`npm run switch-forever`) |
| `scripts/preview.mjs` | Vorschau bis zum Start: simulierte Classic-Werte und Showcase-Verlauf |
| `scripts/build-talents.mjs` | Baut `site/talents.json` mit den Classic-Talentbäumen (`npm run build-talents`) |
| `scripts/mirror-models.mjs` | Spiegelt die 3D-Modelldateien von Wowhead nach `site/modelviewer/` |
| `scripts/model-proxy.mjs` | Lokaler Proxy für 3D-Tests ohne Spiegelung |
| `site/` | Die Seite (HTML, CSS, JS ohne Build-Schritt) |
| `site/renders/` | 2D-Renders der Charaktere als WebP, schreibt `fetch.mjs` (mit `sharp`, nicht im Repo) |
| `site/sw.js` | Service Worker: hält 3D-Modelldateien und Renders dauerhaft im Browser |
| `site/sounds/` | Bloodlust-Sound des Schamanen (Wowhead, Datei 568812, als MP3) |
| `site/sounds/workers/` | Arbeiter-Stimmen aus Warcraft III, deutsch: Peon, Acolyte und Peasant (aus [Old German Voice Lines](https://www.hiveworkshop.com/threads/old-german-voice-lines-alte-deutsche-voice-lines.371972/), als MP3) |
| `site/meta.js` | Spielwissen für Forever: Buffs, Tools, Berufe, Zonen, Dungeons, Raids, Stunden bis 60 |
| `data/history.json` | Tageswerte je Charakter, schreibt nur die Action |
| `data/sessions.json` | Erkannte gemeinsame Sessions (ab 4 Spielern) mit Level-Zuwachs, schreibt nur die Action |
| `data/feed.json` | Aktivitäts-Feed: Level-Ups (stundengenau), neue Items, Berufe, Gilde, Sessions; schreibt nur die Action |
| `data/archive/` | Verlauf, Sessions und Feed der vorherigen Spielversion |
| `.github/workflows/update.yml` | Stündlicher Abruf, 3D-Spiegelung und Deployment |

## Charaktere eintragen

In `config.json` unter `characters` je Charakter Realm und Name eintragen:

```json
{ "realm": "Everlook", "name": "Thoradin" }
```

Die API zeigt ein Profil erst nach dem ersten Logout des Charakters.

## Umstellung auf Forever

Der Namespace wählt die Spielversion. Bis zum Start von Forever läuft die Seite mit Retail (`profile-eu`, `static-eu`).

Die Werte für Forever stehen in `config.json` im Block `forever`. Ab dem Starttag (`launch`, 00:00 UTC) nutzt die Action
sie von selbst. `forever.switchAt` (z. B. `"2026-11-04T17:00:00+01:00"`) legt bei Bedarf einen genauen Zeitpunkt fest.

Vor dem Start prüfen:

- `forever.namespaces` auf den Forever-Namespace setzen, sobald Blizzard ihn nennt (eingetragen ist Classic Era: `profile-classic1x-eu`, `static-classic1x-eu`)
- `forever.characters` mit den neuen Charakteren füllen. Bleibt die Liste leer, gilt die normale Charakterliste.
- `forever.modelEnv` auf `classic` lassen, falls Wowhead die Modelle unter `modelviewer/classic/` führt

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
- **Aktivität:** Jeder stündliche Abruf wird mit dem vorigen verglichen. Level-Ups bekommen den Zeitpunkt des Logouts, in dem sie
  passiert sind. Neue Items erscheinen ab Qualität „selten“. Grüne Items zählen nur in „Letzte Session“.
- **Letzte Session:** Je Session eine Karte mit neuen Items (ab grün), Fortschritt auf dem Weg bis 60, Berufspunkten und Level pro Char.
  Dazu bis zu vier Auszeichnungen (z. B. Größtes Upgrade, Loot-Goblin, Licht aus). Die Werte je Spieler hält die Session in `stats` fest.
  Der Knopf „Teilen“ öffnet WhatsApp mit fertigem Text und Link.
- **Vor dem nächsten Abend:** Offene Punkte je Charakter: Klassenquests und Reiten (`CLASS_TASKS` in `meta.js`), nächste Berufsstufe
  (`PROF_RANKS`), Lehrer bei geraden Leveln und freie Talentpunkte.
- **Talente:** Retail verlinkt den genauen Build im Wowhead-Rechner. Classic liefert die Punkte je Baum und die gewählten Talente,
  aber nicht ihre Position im Baum. Die Positionen, Ränge und Icons stehen deshalb in `site/talents.json`. Die Seite zeigt damit
  die drei Bäume wie im Spiel und verlinkt den genauen Build im Wowhead-Rechner. Die Datei baut `npm run build-talents`
  aus den Spieldaten (wago.tools) und den deutschen Wowhead-Tooltips. Die Classic-Bäume ändern sich nicht, ein Neubau ist nur bei
  einer neuen Spielversion nötig (Build als Argument, z. B. `node scripts/build-talents.mjs 1.15.9.70003`).

## Effekte

- **Band:** Das schräge Band mit laufenden Streifen ist das Stilmittel der Seite (`burst()` in `app.js`). Als Ladebalken läuft es als Welle
  durch die Kacheln: Es erscheint nur auf der Kachel, deren 3D-Modell gerade aufbaut.
- **Forever-Start:** Zum Start und einmal am Starttag läuft „Forever ist live“ über die Seite. `?live` zeigt das Band vorab.
- **Charakterwechsel:** Ein Klick auf eine Kachel scrollt zum Loadout. Dort zieht der Name als Band in Klassenfarbe durch.
  Das neue 3D-Modell baut erst danach auf, sonst ruckelt das Band.
- **Hochzählen und Einblenden:** Zahlen zählen beim ersten Sichtbarwerden von 0 hoch und blitzen am Ende kurz auf (`COUNT_SEL` in `app.js`). Die Abschnitte gleiten beim Scrollen ins Bild.
- **Bloodlust:** Ein Klick auf das Logo startet 15 Sekunden Bloodlust mit Sound, rotem Lauf-Rahmen um die Seite und pulsierenden Kacheln. Danach gilt 60 Sekunden „Gesättigt“.
- **Sync:** Der Punkt neben der Uhrzeit ist grün, solange der stündliche Abruf läuft, und rot ab 2 Stunden Rückstand. Ältere Stände zeigen das Datum.
- Bei „Bewegung reduzieren“ im System bleiben alle Effekte aus.
- Dauer-Animationen laufen nur über `transform` und `opacity`. So rechnet sie die Grafikkarte, nicht der Hauptthread.
  Das Tempo im Bloodlust ändert `lustTempo()` über die Web Animations API, eine neue `animation-duration` ließe die Animationen springen.

## 3D-Modelle

Die animierten Modelle nutzen den Modellviewer von Wowhead. Die Daten dafür kommen von Blizzard:
Aussehen und Transmog über `/appearance`, die Display-IDs über `/item-appearance`.
Wowhead erlaubt keinen direkten Abruf aus fremden Seiten. Die Action spiegelt deshalb alle benötigten
Dateien (etwa 70 MB für 5 Charaktere) nach GitHub Pages. Ändert sich am Aussehen nichts, übernimmt sie die Dateien aus dem Cache
und überspringt Browser-Installation und Spiegelung (`mirror-models.mjs --hash` und `--restore`). Auf schmalen Bildschirmen und ohne WebGL zeigt
die Seite immer die 2D-Renders, auf Handys gibt es den Schalter „3D an/aus“ nicht. Tablets (Touch) und „Daten sparen“ starten mit 2D,
der Schalter schaltet 3D dort ein. Sonst gilt die letzte Wahl am Schalter.

Jeder Viewer zeichnet in einer eigenen Schleife. Damit sechs Modelle den Hauptthread nicht füllen, begrenzt `pace()` in `model3d.js`
die Bildrate auf 60 Bilder pro Sekunde (auch auf 120-Hz-Displays) und lässt Modelle aus, die weit außerhalb des Bildes liegen.
Sichtbare Modelle bewegen sich immer. Ein Rand von 200 px startet ein Modell, bevor es ins Bild scrollt.

GitHub Pages erlaubt nur 10 Minuten Cache. Der Service Worker (`sw.js`) hält Modelldateien und Renders darum dauerhaft vor.
Ab dem zweiten Besuch lädt die Seite keine Modelldaten mehr. Wechselt die Modell-Umgebung (Vorschau, dann Forever), löscht er den alten Cache.

Der Wowhead-Viewer ist inoffiziell. Ändert Wowhead ihn, kann 3D ausfallen. Die Seite fällt dann auf die Renders zurück.

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

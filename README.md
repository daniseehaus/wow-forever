# WoW Forever · Gruppenübersicht

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung unserer Charaktere.
Eine GitHub Action holt die Daten stündlich von der Battle.net API und veröffentlicht die Seite auf GitHub Pages.

## Aufbau

| Datei | Zweck |
|---|---|
| `config.json` | Region, Sprache, Namespaces, Charakterliste, Forever-Einstellungen (`forever`) |
| `scripts/fetch.mjs` | Abruf der API, schreibt `site/data.json`, Verlauf, Sessions und Aktivitäts-Feed |
| `scripts/config.mjs` | Wählt ab dem Starttag die Forever-Einstellungen |
| `scripts/switch-forever.mjs` | Übernimmt die Forever-Einstellungen fest in `config.json` (`npm run switch-forever`) |
| `scripts/mirror-models.mjs` | Spiegelt die 3D-Modelldateien von Wowhead nach `site/modelviewer/` |
| `scripts/model-proxy.mjs` | Lokaler Proxy für 3D-Tests ohne Spiegelung |
| `site/` | Die Seite (HTML, CSS, JS ohne Build-Schritt) |
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

## Sessions, Feed und Talente

- **Sessions:** Die API kennt keine Spielzeit, nur den letzten Logout. Loggen sich mindestens 4 Charaktere (bei kleinerer Gruppe alle)
  innerhalb von 3 Stunden aus, zählt das als gemeinsame Session. Erkannt wird sie eine Stunde nach dem letzten Logout.
- **Aktivität:** Jeder stündliche Abruf wird mit dem vorigen verglichen. Level-Ups bekommen den Zeitpunkt des Logouts, in dem sie
  passiert sind. Die Verlaufskurve nutzt sie für eine stundengenaue Level-Treppe. Neue Items erscheinen ab Qualität „selten“.
- **Talente:** Retail verlinkt den genauen Build im Wowhead-Rechner. Classic liefert die Punkte je Baum und die gewählten Talente,
  aber nicht ihre Position im Baum. Der Link öffnet dort den Rechner der Klasse.

## 3D-Modelle

Die animierten Modelle nutzen den Modellviewer von Wowhead. Die Daten dafür kommen von Blizzard:
Aussehen und Transmog über `/appearance`, die Display-IDs über `/item-appearance`.
Wowhead erlaubt keinen direkten Abruf aus fremden Seiten. Die Action spiegelt deshalb alle benötigten
Dateien (etwa 70 MB für 5 Charaktere) nach GitHub Pages. Ändert sich am Aussehen nichts, übernimmt sie die Dateien aus dem Cache
und überspringt Browser-Installation und Spiegelung (`mirror-models.mjs --hash` und `--restore`). Auf schmalen Bildschirmen und ohne WebGL zeigt
die Seite die 2D-Renders. Der Schalter „3D an/aus“ in der Navigation überschreibt das.

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

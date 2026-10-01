# WoW Forever · Gruppenübersicht

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung unserer Charaktere.
Eine GitHub Action holt die Daten stündlich von der Battle.net API und veröffentlicht die Seite auf GitHub Pages.

## Aufbau

| Datei | Zweck |
|---|---|
| `config.json` | Region, Sprache, Namespaces, Charakterliste |
| `scripts/fetch.mjs` | Abruf der API, schreibt `site/data.json` und den Verlauf |
| `scripts/mirror-models.mjs` | Spiegelt die 3D-Modelldateien von Wowhead nach `site/modelviewer/` |
| `scripts/model-proxy.mjs` | Lokaler Proxy für 3D-Tests ohne Spiegelung |
| `site/` | Die Seite (HTML, CSS, JS ohne Build-Schritt) |
| `site/meta.js` | Spielwissen: Buffs, Werkzeuge, Berufe, Zonen, Dungeons |
| `data/history.json` | Tageswerte je Charakter, schreibt nur die Action |
| `.github/workflows/update.yml` | Stündlicher Abruf, 3D-Spiegelung und Deployment |

## Charaktere eintragen

In `config.json` unter `characters` je Charakter Realm und Name eintragen:

```json
{ "realm": "Everlook", "name": "Thoradin" }
```

Die API zeigt ein Profil erst nach dem ersten Logout des Charakters.

## Namespace

Der Namespace wählt die Spielversion. Bis zum Start von Forever läuft die Seite mit Retail (`profile-eu`, `static-eu`).

Zum Start von Forever in `config.json` anpassen:

- `namespaces.profile` und `namespaces.static` auf den Forever-Namespace (Classic Era wäre `profile-classic1x-eu` und `static-classic1x-eu`)
- `maxLevel` auf 60
- `wowhead` auf das passende Wowhead-Präfix (Retail leer, Classic Era `classic`)
- `era` auf `classic` (Buffs, Berufe und Leveling-Route nach Classic-Regeln)
- `modelEnv` auf `classic`, falls Wowhead die Modelle unter `modelviewer/classic/` führt
- `characters` auf die neuen Charaktere

## 3D-Modelle

Die animierten Modelle nutzen den Modellviewer von Wowhead. Die Daten dafür kommen von Blizzard:
Aussehen und Transmog über `/appearance`, die Display-IDs über `/item-appearance`.
Wowhead erlaubt keinen direkten Abruf aus fremden Seiten. Die Action spiegelt deshalb alle benötigten
Dateien (etwa 70 MB für 5 Charaktere) nach GitHub Pages. Auf schmalen Bildschirmen und ohne WebGL zeigt
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

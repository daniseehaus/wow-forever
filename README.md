# WoW Forever · Gruppenübersicht

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung unserer Charaktere.
Eine GitHub Action holt die Daten stündlich von der Battle.net API und veröffentlicht die Seite auf GitHub Pages.

## Aufbau

| Datei | Zweck |
|---|---|
| `config.json` | Region, Sprache, Namespaces, Charakterliste |
| `scripts/fetch.mjs` | Abruf der API, schreibt `site/data.json` |
| `site/` | Die Seite (HTML, CSS, JS ohne Build-Schritt) |
| `.github/workflows/update.yml` | Stündlicher Abruf und Deployment |

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
- `characters` auf die neuen Charaktere

## Lokal testen

```bash
node scripts/fetch.mjs --demo
python3 -m http.server -d site 8080
```

Mit echten Daten: `.env.example` nach `.env` kopieren, Werte eintragen, dann `node scripts/fetch.mjs`.

## Einrichtung auf GitHub

1. Im [Blizzard Developer Portal](https://community.developer.battle.net/access/clients) einen Client anlegen.
2. Client-ID und Secret als Repository Secrets `BLIZZARD_CLIENT_ID` und `BLIZZARD_CLIENT_SECRET` speichern.
3. Unter Settings → Pages als Quelle „GitHub Actions“ wählen.
4. Unter Actions den Workflow einmal per „Run workflow“ starten.

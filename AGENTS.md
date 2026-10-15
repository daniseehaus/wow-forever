# WoW Forever

## Zweck

Statische Seite mit Level, Klasse, Itemlevel und Ausrüstung der Gruppen-Charaktere.

## Stack

Node.js-Skripte, GitHub Action, GitHub Pages, Battle.net API.

## Befehle

| Zweck | Befehl |
|---|---|
| Daten holen | `npm run fetch` |
| Talente bauen | `npm run build-talents` |
| Icons bauen | `npm run build-icons` |
| Testen | keine automatischen Tests, Prüfung von Hand: siehe `## Prüfung` |

## Prüfung

Entwurf, bitte bestätigen oder anpassen.

1. `npm run fetch` lokal ausführen und `index.html` öffnen. Nach dem Push: `gh run list -L 1` zeigt einen grünen Lauf.

## Deploy

GitHub Action `.github/workflows/update.yml` holt die Daten stündlich und veröffentlicht auf GitHub Pages.

## Struktur

Siehe `README.md`.

## Projektregeln

Noch keine.

## Entscheidungen

Datum und Entscheidung, je eine Zeile. Neueste oben.

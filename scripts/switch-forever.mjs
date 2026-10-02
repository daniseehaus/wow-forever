// Übernimmt den Block forever aus config.json fest in die Konfiguration.
//
// Aufruf: npm run switch-forever
//
// Nötig ist das nicht: Ab dem Starttag nutzt fetch.mjs die Werte aus forever von selbst.
// Das Skript räumt danach auf, damit config.json wieder nur eine Einstellung enthält.
// Verlauf, Sessions und Feed archiviert die Action beim nächsten Lauf automatisch.

import { readFile, writeFile } from 'node:fs/promises';
import { resolveConfig } from './config.mjs';

const file = new URL('../config.json', import.meta.url);
const base = JSON.parse(await readFile(file, 'utf8'));
if (!base.forever) {
  console.log('config.json enthält keinen Block forever, nichts zu tun.');
  process.exit(0);
}
if (!base.forever.characters?.length) {
  console.warn('Hinweis: forever.characters ist leer, die bisherige Charakterliste bleibt.');
}

const next = resolveConfig(base, true);
// Die Vorschau (simulate) endet mit dem Start.
delete next.simulate;
await writeFile(file, JSON.stringify(next, null, 2) + '\n');
console.log(`config.json umgestellt: era ${base.era} → ${next.era}, Namespace ${next.namespaces.profile}, Max-Level ${next.maxLevel}.`);

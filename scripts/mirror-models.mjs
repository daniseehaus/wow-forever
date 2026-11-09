// Spiegelt die 3D-Dateien aller Charaktere (Gruppe aus data.json, Gilde aus guild.json) nach site/modelviewer/.
//
// Wowhead erlaubt keinen direkten Abruf aus fremden Webseiten (keine CORS-Header).
// Das Skript öffnet deshalb einen unsichtbaren Browser, baut jedes Modell einmal auf
// und speichert jede Datei, die der Viewer dabei anfordert. Die Live-Seite lädt danach
// alles von GitHub Pages.
//
// Aufruf:
//   node scripts/mirror-models.mjs            spiegeln (nach scripts/fetch.mjs)
//   node scripts/mirror-models.mjs --hash     Kennung des aktuellen 3D-Stands ausgeben
//   node scripts/mirror-models.mjs --restore  Dateien ohne Browser aus .model-cache/ übernehmen,
//                                             wenn sich am 3D-Stand nichts geändert hat
//
// Bereits geladene Dateien liegen in .model-cache/ und werden nicht erneut geholt.
// .model-cache/manifest.json merkt sich, welche Dateien zu welchem 3D-Stand gehören.
//
// 2D-Ersatz: Blizzard liefert nicht für jeden Charakter einen 2D-Render (Media-API 404).
// Das Skript fotografiert darum jedes Modell in der Grundhaltung (transparenter Hintergrund)
// und trägt das Bild bei Charakteren ohne Render in data.json und guild.json ein (render, renderSnap).
// Die Seite zeigt es, wenn 3D aus ist oder nicht lädt.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const data = JSON.parse(await readFile(new URL('site/data.json', root), 'utf8'));
const env = data.modelEnv ?? 'classic';
const ORIGIN = 'https://mirror.local';
const UPSTREAM = 'https://wow.zamimg.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
};
// Diese Animationen bietet die Seite an. Der Viewer lädt manche davon erst beim Abspielen.
const ANIMATIONS = ['Stand', 'EmoteWave', 'EmoteCheer', 'EmoteDance', 'EmoteLaugh', 'EmoteRoar', 'Run'];
const MANIFEST = new URL('.model-cache/manifest.json', root);
// Erhöhen, wenn sich die Schnappschüsse ändern sollen. Ändert den 3D-Stand und erzwingt ein neues Spiegeln.
const SNAP_VERSION = 1;

// Gruppe und Gilde. Gruppen-Charaktere stehen in beiden Dateien, sie zählen einmal.
const dataFile = new URL('site/data.json', root);
const guildFile = new URL('site/guild.json', root);
const guild = existsSync(guildFile) ? JSON.parse(await readFile(guildFile, 'utf8')) : { members: [] };
const models = [...new Map([...data.characters, ...guild.members].filter((c) => c.model).map((c) => [c.key, { key: c.key, ...c.model }])).values()];
const hash = stateHash();

if (process.argv.includes('--hash')) {
  console.log(hash);
  process.exit(0);
}

if (process.argv.includes('--restore')) {
  const restored = await restore();
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `restored=${restored}\n`);
  process.exit(0);
}

if (!models.length) {
  console.log('Keine 3D-Daten vorhanden, nichts zu spiegeln.');
  process.exit(0);
}

const { chromium } = await import('playwright');
const files = new Set();
let saved = 0;
let fetched = 0;
let failed = 0;
let lastRequest = Date.now();

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// Doppelte Pixeldichte: Der Schnappschuss bleibt auch auf Handys scharf.
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.warn('Seitenfehler:', e.message));

await page.route(`${ORIGIN}/**`, async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ contentType: 'text/html', body: harness() });
  lastRequest = Date.now();
  const body = await mirrorFile(path);
  if (!body) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, body, headers: { 'Access-Control-Allow-Origin': '*' } });
});

await page.goto(`${ORIGIN}/`);
await page.waitForFunction(() => typeof window.ZamModelViewer === 'function', null, { timeout: 60000 });

const snaps = {};
for (const m of models) {
  console.log(`Modell ${m.key}`);
  await page.evaluate(async (m) => window.buildModel(m), m);
  await settle();
  try {
    snaps[m.key] = await snapshot(m);
  } catch (err) {
    console.warn(`Schnappschuss ${m.key} fehlgeschlagen: ${err.message}`);
  }
  for (const anim of ANIMATIONS) {
    await page.evaluate((a) => window.playAnimation(a), anim);
    await settle(1500);
  }
}

await browser.close();
await mkdir(new URL('.model-cache/', root), { recursive: true });
await writeFile(MANIFEST, JSON.stringify({ hash, created: Date.now(), failed, files: [...files].sort(), snaps }, null, 1) + '\n');
console.log(`Spiegelung fertig: ${saved} Dateien gespeichert (${fetched} neu geladen, ${failed} nicht gefunden).`);
await applySnaps(snaps);

// ---------------------------------------------------------------------------

// Kennung des 3D-Stands: ändert sich, sobald ein Charakter anders aussieht, andere Items trägt
// oder die Seite andere Animationen anbietet.
function stateHash() {
  const state = { env, animations: ANIMATIONS, snap: SNAP_VERSION, models: [...models].sort((a, b) => a.key.localeCompare(b.key)) };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16);
}

// Übernimmt die Dateien des letzten Spiegelns, wenn der 3D-Stand gleich geblieben ist.
async function restore() {
  if (!models.length) {
    console.log('Keine 3D-Daten vorhanden, nichts zu übernehmen.');
    return true;
  }
  const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : null;
  if (manifest?.hash !== hash) {
    console.log('3D-Stand hat sich geändert, neu spiegeln.');
    return false;
  }
  // Fehlten beim letzten Spiegeln Dateien, gibt es alle 6 Stunden einen neuen Versuch.
  if (manifest.failed && Date.now() - (manifest.created ?? 0) > 6 * 3600 * 1000) {
    console.log(`Beim letzten Spiegeln fehlten ${manifest.failed} Dateien, neuer Versuch.`);
    return false;
  }
  const missing = manifest.files.filter((p) => !existsSync(new URL(`.model-cache${p}`, root)));
  if (missing.length || !manifest.files.length) {
    console.log(`${missing.length} Dateien fehlen im Cache, neu spiegeln.`);
    return false;
  }
  for (const p of manifest.files) {
    const out = new URL(`site${p}`, root);
    await mkdir(dirname(fileURLToPath(out)), { recursive: true });
    await copyFile(new URL(`.model-cache${p}`, root), out);
  }
  console.log(`3D-Stand unverändert, ${manifest.files.length} Dateien aus dem Cache übernommen.`);
  await applySnaps(manifest.snaps ?? {});
  return true;
}

// Fotografiert das Modell in der Grundhaltung. Das Feld ist quadratisch, damit Waffen und Schilde nicht abgeschnitten werden. Ablage: .model-cache/snaps/ (Cache) und site/renders/ (Seite).
// Der Name enthält einen Hash des Modells: Ändert sich das Aussehen, ändert sich der Name, und kein Cache zeigt das alte Bild.
async function snapshot(m) {
  await page.evaluate((a) => window.playAnimation(a), 'Stand');
  await new Promise((r) => setTimeout(r, 1500));
  const png = await page.locator('#mv').screenshot({ omitBackground: true, type: 'png' });
  const id = createHash('sha1').update(JSON.stringify(m)).digest('hex').slice(0, 8);
  const base = `3d-${m.key.replace(/[^a-z0-9]+/gi, '-')}-${id}`;
  let file = `${base}.png`;
  let body = png;
  try {
    const sharp = (await import('sharp')).default;
    body = await sharp(png).trim({ threshold: 0 }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
    file = `${base}.webp`;
  } catch {
    // ohne sharp bleibt das PNG
  }
  await mkdir(new URL('.model-cache/snaps/', root), { recursive: true });
  await writeFile(new URL(`.model-cache/snaps/${file}`, root), body);
  return file;
}

// Trägt die Schnappschüsse bei Charakteren ohne Blizzard-Render ein und kopiert sie nach site/renders/.
async function applySnaps(snaps) {
  let used = 0;
  await mkdir(new URL('site/renders/', root), { recursive: true });
  for (const [file, json, list] of [[dataFile, data, 'characters'], [guildFile, guild, 'members']]) {
    if (!existsSync(file)) continue;
    let changed = false;
    for (const c of json[list] ?? []) {
      const snap = snaps[c.key];
      if (!snap || (c.render && !c.renderSnap)) continue;
      const src = new URL(`.model-cache/snaps/${snap}`, root);
      if (!existsSync(src)) continue;
      await copyFile(src, new URL(`site/renders/${snap}`, root));
      c.render = `renders/${snap}`;
      c.renderSnap = true;
      changed = true;
      used++;
    }
    if (changed) await writeFile(file, JSON.stringify(json, null, 2) + '\n');
  }
  console.log(`2D-Ersatz: ${used} Schnappschüsse eingetragen.`);
}

// Wartet, bis der Viewer eine Weile keine Datei mehr anfordert.
async function settle(quiet = 3000) {
  lastRequest = Date.now();
  while (Date.now() - lastRequest < quiet) await new Promise((r) => setTimeout(r, 250));
}

async function mirrorFile(path) {
  if (!path.startsWith(`/modelviewer/${env}/`)) return null;
  const cacheFile = new URL(`.model-cache${path}`, root);
  const outFile = new URL(`site${path}`, root);
  if (!existsSync(cacheFile)) {
    const res = await fetch(UPSTREAM + path, { headers: HEADERS }).catch(() => null);
    if (!res?.ok) {
      failed++;
      return null;
    }
    await mkdir(dirname(fileURLToPath(cacheFile)), { recursive: true });
    await writeFile(cacheFile, Buffer.from(await res.arrayBuffer()));
    fetched++;
  }
  files.add(path);
  if (!existsSync(outFile)) {
    await mkdir(dirname(fileURLToPath(outFile)), { recursive: true });
    await copyFile(cacheFile, outFile);
    saved++;
  }
  return readFile(cacheFile);
}

function harness() {
  return `<!doctype html><html><head>
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script>
window.CONTENT_PATH = '${ORIGIN}/modelviewer/${env}/';
window.WH = { debug() {}, defaultAnimation: 'Stand', WebP: { getImageExtension: () => '.webp' },
  Wow: { Item: { INVENTORY_TYPE_SHOULDERS: 3, INVENTORY_TYPE_ROBE: 20, INVENTORY_TYPE_CHEST: 5 } } };
</script>
<script src="${ORIGIN}/modelviewer/${env}/viewer/viewer.min.js"></script>
</head><body><div id="mv" style="width:600px;height:600px"></div>
<script>
window.buildModel = async (m) => {
  if (window.viewer) { try { window.viewer.destroy(); } catch {} document.getElementById('mv').innerHTML = ''; }
  window.viewer = await new ZamModelViewer({
    type: 2, contentPath: window.CONTENT_PATH, container: jQuery('#mv'), aspect: 1, hd: ${env === 'live'},
    ${env === 'classic' ? "dataEnv: 'classic', env: 'classic', gameDataEnv: 'classic'," : ''}
    models: { id: m.race * 2 - 1 + m.gender, type: 16 },
    charCustomization: { options: m.options }, items: m.items,
  });
};
window.playAnimation = (a) => { try { window.viewer.renderer.actors[0].setAnimation(a); } catch {} };
</script></body></html>`;
}

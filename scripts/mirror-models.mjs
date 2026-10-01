// Spiegelt die 3D-Dateien aller Charaktere nach site/modelviewer/.
//
// Wowhead erlaubt keinen direkten Abruf aus fremden Webseiten (keine CORS-Header).
// Das Skript öffnet deshalb einen unsichtbaren Browser, baut jedes Modell einmal auf
// und speichert jede Datei, die der Viewer dabei anfordert. Die Live-Seite lädt danach
// alles von GitHub Pages.
//
// Aufruf: node scripts/mirror-models.mjs   (nach scripts/fetch.mjs)
// Bereits geladene Dateien liegen in .model-cache/ und werden nicht erneut geholt.

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const models = data.characters.filter((c) => c.model).map((c) => ({ key: c.key, ...c.model }));
if (!models.length) {
  console.log('Keine 3D-Daten vorhanden, nichts zu spiegeln.');
  process.exit(0);
}

let saved = 0;
let fetched = 0;
let failed = 0;
let lastRequest = Date.now();

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
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

for (const m of models) {
  console.log(`Modell ${m.key}`);
  await page.evaluate(async (m) => window.buildModel(m), m);
  await settle();
  for (const anim of ANIMATIONS) {
    await page.evaluate((a) => window.playAnimation(a), anim);
    await settle(1500);
  }
}

await browser.close();
console.log(`Spiegelung fertig: ${saved} Dateien gespeichert (${fetched} neu geladen, ${failed} nicht gefunden).`);

// ---------------------------------------------------------------------------

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
</head><body><div id="mv" style="width:400px;height:600px"></div>
<script>
window.buildModel = async (m) => {
  if (window.viewer) { try { window.viewer.destroy(); } catch {} document.getElementById('mv').innerHTML = ''; }
  window.viewer = await new ZamModelViewer({
    type: 2, contentPath: window.CONTENT_PATH, container: jQuery('#mv'), aspect: 0.66, hd: ${env === 'live'},
    ${env === 'classic' ? "dataEnv: 'classic', env: 'classic', gameDataEnv: 'classic'," : ''}
    models: { id: m.race * 2 - 1 + m.gender, type: 16 },
    charCustomization: { options: m.options }, items: m.items,
  });
};
window.playAnimation = (a) => { try { window.viewer.renderer.actors[0].setAnimation(a); } catch {} };
</script></body></html>`;
}

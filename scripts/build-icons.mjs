// Baut die Icons der Seite aus site/icons/bloodlust.jpg: Favicon, Apple-Touch-Icon, Manifest-Icons und Link-Vorschau.
// Das Quell-Icon von Wowhead hat nur 56 px. Die großen Formate setzen es deshalb mittig auf einen dunklen Grund mit rotem Schein.
// Die Dateien liegen im Repo, das Skript läuft nur bei Bedarf (npm run build-icons).

import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const DIR = new URL('../site/icons/', import.meta.url);
const SRC = `data:image/jpeg;base64,${(await readFile(new URL('bloodlust.jpg', DIR))).toString('base64')}`;
const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@800&family=IBM+Plex+Mono:wght@500&display=swap';

const BASE = `* { margin: 0; box-sizing: border-box; } body { background: #07090c; overflow: hidden; }
  .ico { display: block; background: url(${SRC}) center / cover; }`;

// Favicon: nur das Icon, leicht gerundet.
const favicon = (s) => `<style>${BASE} body { background: transparent; }
  .ico { width: ${s}px; height: ${s}px; border-radius: ${Math.round(s * 0.18)}px; }</style><span class="ico"></span>`;

// App-Icon: volle Fläche (iOS und Android runden selbst), Icon in der sicheren Zone für maskable.
const app = (s) => `<style>${BASE}
  body { width: ${s}px; height: ${s}px; display: grid; place-items: center;
    background: radial-gradient(circle, rgba(255,58,94,.45), transparent 62%), #07090c; }
  .ico { width: ${s * 0.58}px; height: ${s * 0.58}px; border-radius: ${s * 0.1}px;
    box-shadow: 0 0 0 ${s / 90}px rgba(255,58,94,.6), 0 0 ${s * 0.22}px rgba(255,58,94,.5); }</style><span class="ico"></span>`;

// Link-Vorschau (Open Graph), 1200 × 630.
const og = `<link href="${FONTS}" rel="stylesheet"><style>${BASE}
  body { width: 1200px; height: 630px; display: flex; align-items: center; gap: 60px; padding: 0 90px; position: relative;
    background: radial-gradient(circle at 22% 50%, rgba(255,58,94,.4), transparent 45%), linear-gradient(135deg, #0e1217, #07090c); }
  body::before { content: ""; position: absolute; inset: 0;
    background: repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 2px, transparent 2px 6px); }
  .ico { width: 270px; height: 270px; flex: none; border-radius: 46px;
    box-shadow: 0 0 0 5px rgba(255,58,94,.6), 0 0 100px rgba(255,58,94,.55); }
  h1 { font: 800 134px/.9 'Barlow Condensed', sans-serif; letter-spacing: .04em; color: #e6edf3; }
  p { margin-top: 18px; font: 500 32px 'IBM Plex Mono', monospace; letter-spacing: .12em; color: #ff6b84; }</style>
  <span class="ico"></span><div><h1>GEILBLEIBER</h1><p>WOW FOREVER · EU</p></div>`;

const jobs = [
  ['favicon-32.png', 32, 32, favicon(32), true],
  ['favicon-16.png', 16, 16, favicon(16), true],
  ['apple-touch-icon.png', 180, 180, app(180)],
  ['icon-192.png', 192, 192, app(192)],
  ['icon-512.png', 512, 512, app(512)],
  ['og.jpg', 1200, 630, og],
];

const browser = await chromium.launch();
for (const [name, width, height, html, transparent] of jobs) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(name, DIR).pathname, omitBackground: !!transparent, ...(name.endsWith('.jpg') && { type: 'jpeg', quality: 90 }) });
  await page.close();
  console.log(name);
}
await browser.close();

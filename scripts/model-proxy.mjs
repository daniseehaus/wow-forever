// Lokaler Proxy für die 3D-Dateien von Wowhead (wow.zamimg.com).
// Wowhead sendet keine CORS-Header, der Browser darf die Dateien deshalb nicht direkt laden.
// Der Proxy holt sie serverseitig und ergänzt die Header.
//
// Aufruf: node scripts/model-proxy.mjs   (lauscht auf http://localhost:3001)

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 3001);
const UPSTREAM = 'https://wow.zamimg.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br',
};

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.end();
  if (!req.url.startsWith('/modelviewer/')) {
    res.statusCode = 404;
    return res.end();
  }
  try {
    const up = await fetch(UPSTREAM + req.url, { headers: HEADERS });
    res.statusCode = up.status;
    res.setHeader('Content-Type', up.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (err) {
    res.statusCode = 502;
    res.end(String(err));
  }
}).listen(PORT, () => console.log(`Model-Proxy auf http://localhost:${PORT}`));

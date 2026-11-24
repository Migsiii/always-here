// Tiny static file server for local dev and tests. No dependencies.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root) || file.includes('node_modules')) throw new Error('forbidden');
    const body = await readFile(file);
    let out = body;
    if (file.endsWith('index.html')) { // tests talk to a local PeerJS server; production CSP does not list it
      out = Buffer.from(body.toString('utf8').replace("wss://0.peerjs.com", "wss://0.peerjs.com http://localhost:9000 ws://localhost:9000"));
    }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(out);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));

// Serves the fixture pages for the browser tests: node tests/e2e/server.mjs
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, PORT } from './origin.mjs';

const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
// The built extension, so the popup page can be opened like any other page in harness mode.
const built = fileURLToPath(new URL('../../.output/chrome-mv3/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };

createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path === '/__blob-fixtures') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    return response.end('ok');
  }
  if (path === '/favicon.ico') {
    response.writeHead(204);
    return response.end();
  }
  // Every /spa route serves the same document, like a real single-page app.
  const file = path === '/' ? 'index.html' : path.startsWith('/spa') ? 'spa.html' : path.slice(1);
  try {
    const body = await readFile(join(root, file)).catch(() => readFile(join(built, file)));
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'text/plain', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Fixtures on ${ORIGIN}`));
